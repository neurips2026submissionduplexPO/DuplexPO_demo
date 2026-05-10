(function () {
    const cases = Array.isArray(window.DEMO_CASES) ? window.DEMO_CASES : [];
    const caseStack = document.getElementById("caseStack");
    const metadataLink = document.getElementById("metadataLink");
    const allAudios = [];
    const renderers = [];

    function fmt(time) {
        const value = Number(time);
        return Number.isFinite(value) ? `${value.toFixed(2)}s` : "0.00s";
    }

    function durationOf(data) {
        const value = Number(data.duration);
        return Number.isFinite(value) && value > 0 ? value : 1;
    }

    function pauseOtherAudio(current) {
        allAudios.forEach((audio) => {
            if (audio !== current && !audio.paused) {
                audio.pause();
            }
        });
    }

    function makeStereoControl(src) {
        const control = document.createElement("div");
        control.className = "stereo-control";

        const audio = document.createElement("audio");
        audio.controls = true;
        audio.preload = "metadata";
        audio.src = src;

        control.appendChild(audio);
        allAudios.push(audio);
        return { control, audio };
    }

    function pickTickStep(duration) {
        if (duration <= 8) return 1;
        if (duration <= 20) return 2;
        if (duration <= 45) return 5;
        if (duration <= 120) return 10;
        return 20;
    }

    function renderTicks(track, duration) {
        const step = pickTickStep(duration);
        for (let tickTime = 0; tickTime <= duration + 0.001; tickTime += step) {
            const tick = document.createElement("div");
            tick.className = "tick";
            tick.style.left = `${(tickTime / duration) * 100}%`;
            tick.textContent = `${Math.round(tickTime)}s`;
            track.appendChild(tick);
        }
    }

    function drawWaveform(canvas, peaks, color) {
        const rect = canvas.getBoundingClientRect();
        const width = Math.max(1, Math.round(rect.width));
        const height = Math.max(1, Math.round(rect.height));
        const dpr = window.devicePixelRatio || 1;
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);

        const context = canvas.getContext("2d");
        context.setTransform(dpr, 0, 0, dpr, 0, 0);
        context.clearRect(0, 0, width, height);
        const values = Array.isArray(peaks) && peaks.length ? peaks : [0];
        const sorted = values
            .map((value) => Math.max(0, Number(value) || 0))
            .filter((value) => value > 0)
            .sort((left, right) => left - right);
        const reference = sorted.length
            ? Math.max(0.004, sorted[Math.floor(sorted.length * 0.9)])
            : 1;
        const center = height / 2;
        const xScale = width / values.length;

        context.fillStyle = "rgba(15, 23, 42, 0.08)";
        context.fillRect(0, center, width, 1);
        context.fillStyle = color;

        values.forEach((peak, index) => {
            const rawAmplitude = Math.max(0, Number(peak) || 0);
            const amplitude = Math.pow(Math.min(1, rawAmplitude / reference), 0.46);
            const barHeight = rawAmplitude > 0
                ? Math.max(2, amplitude * (height - 6))
                : 1;
            const x = Math.floor(index * xScale);
            const barWidth = Math.max(1, Math.ceil(xScale));
            context.fillRect(x, center - barHeight / 2, barWidth, barHeight);
        });
    }

    function makeWaveRow(label, kind, peaks, duration, seekAll) {
        const row = document.createElement("div");
        row.className = "timeline-row";

        const rowLabel = document.createElement("div");
        rowLabel.className = "row-label";
        rowLabel.textContent = label;

        const track = document.createElement("button");
        track.type = "button";
        track.className = `wave-track ${kind}`;
        track.setAttribute("aria-label", `${label} waveform`);

        const canvas = document.createElement("canvas");
        canvas.className = "wave-canvas";
        track.appendChild(canvas);

        const innerPlayhead = document.createElement("div");
        innerPlayhead.className = "wave-playhead";
        track.appendChild(innerPlayhead);

        track.addEventListener("click", (event) => {
            const rect = track.getBoundingClientRect();
            seekAll(((event.clientX - rect.left) / rect.width) * duration);
        });

        row.appendChild(rowLabel);
        row.appendChild(track);

        const accent = kind === "user"
            ? getComputedStyle(document.documentElement).getPropertyValue("--user").trim() || "#9ca3af"
            : getComputedStyle(document.documentElement).getPropertyValue("--agent").trim() || "#7fb3d5";

        renderers.push(() => {
            drawWaveform(canvas, peaks, accent);
        });
        return { row, track, playhead: innerPlayhead };
    }

    function makeRulerRow(duration) {
        const row = document.createElement("div");
        row.className = "timeline-row";

        const rowLabel = document.createElement("div");
        rowLabel.className = "row-label";

        const ruler = document.createElement("div");
        ruler.className = "ruler-track";
        renderTicks(ruler, duration);

        row.appendChild(rowLabel);
        row.appendChild(ruler);
        return row;
    }

    function renderCase(data, index) {
        const duration = durationOf(data);
        const section = document.createElement("section");
        section.className = "case-panel";
        section.id = data.id || data.sample_id;
        const titleText = data.display_name || data.title || `Example ${index + 1}`;

        const header = document.createElement("div");
        header.className = "case-header";

        const titleWrap = document.createElement("div");
        titleWrap.className = "case-title";

        const title = document.createElement("h2");
        title.textContent = titleText;
        titleWrap.appendChild(title);

        const chip = document.createElement("span");
        chip.className = "sample-chip";
        chip.textContent = fmt(duration);

        header.appendChild(titleWrap);
        header.appendChild(chip);
        section.appendChild(header);

        const panel = document.createElement("section");
        panel.className = "timeline-panel";
        panel.setAttribute("aria-label", `${titleText} waveform timeline`);

        const scroll = document.createElement("div");
        scroll.className = "timeline-scroll";

        const canvas = document.createElement("div");
        canvas.className = "timeline-canvas";

        const stereo = makeStereoControl(data.audio.stereo);
        const audios = [stereo.audio];
        let activeAudio = stereo.audio;
        let rafId = null;
        const wavePlayheads = [];

        function updatePlayhead() {
            const time = activeAudio ? activeAudio.currentTime || 0 : 0;
            const pct = Math.max(0, Math.min(1, time / duration)) * 100;
            wavePlayheads.forEach((p) => {
                p.style.left = `${pct}%`;
            });
        }

        function startAnimation() {
            if (rafId) {
                return;
            }
            const step = () => {
                updatePlayhead();
                rafId = activeAudio && !activeAudio.paused ? requestAnimationFrame(step) : null;
            };
            rafId = requestAnimationFrame(step);
        }

        function seekAll(time) {
            const clamped = Math.max(0, Math.min(duration, time));
            audios.forEach((audio) => {
                if (Number.isFinite(audio.duration) || audio.readyState > 0) {
                    audio.currentTime = clamped;
                }
            });
            updatePlayhead();
        }

        audios.forEach((audio) => {
            audio.addEventListener("play", () => {
                activeAudio = audio;
                pauseOtherAudio(audio);
                startAnimation();
            });
            audio.addEventListener("pause", updatePlayhead);
            audio.addEventListener("seeked", updatePlayhead);
            audio.addEventListener("timeupdate", updatePlayhead);
            audio.addEventListener("loadedmetadata", updatePlayhead);
        });

        const audioRow = document.createElement("div");
        audioRow.className = "audio-row";
        audioRow.appendChild(stereo.control);
        section.appendChild(audioRow);

        const userWave = makeWaveRow("User", "user", data.waveforms && data.waveforms.user, duration, seekAll);
        const agentWave = makeWaveRow("Agent", "agent", data.waveforms && data.waveforms.agent, duration, seekAll);
        wavePlayheads.push(userWave.playhead, agentWave.playhead);

        canvas.appendChild(makeRulerRow(duration));
        canvas.appendChild(userWave.row);
        canvas.appendChild(agentWave.row);
        scroll.appendChild(canvas);
        panel.appendChild(scroll);
        section.appendChild(panel);

        if (data.description) {
            const desc = document.createElement("div");
            desc.className = "case-description";
            desc.innerHTML = data.description;
            section.appendChild(desc);
        }

        renderers.push(updatePlayhead);
        return section;
    }

    function makeCategoryHeading(name) {
        const wrap = document.createElement("div");
        wrap.className = "category-heading";

        const title = document.createElement("h2");
        title.className = "category-title";
        title.textContent = name;

        wrap.appendChild(title);
        return wrap;
    }

    function renderAll() {
        if (caseStack) {
            caseStack.innerHTML = "";
            if (!cases.length) {
                caseStack.textContent = "No demo data.";
            } else {
                let lastCategory = null;
                cases.forEach((item, idx) => {
                    const cat = item.category || "";
                    if (cat && cat !== lastCategory) {
                        caseStack.appendChild(makeCategoryHeading(cat));
                        lastCategory = cat;
                    }
                    caseStack.appendChild(renderCase(item, idx));
                });
            }
        }
        if (metadataLink) {
            metadataLink.href = "static/data/demo_cases.json";
        }
        requestAnimationFrame(() => {
            renderers.forEach((render) => render());
        });
    }

    window.addEventListener("resize", () => {
        renderers.forEach((render) => render());
    });

    renderAll();
}());
