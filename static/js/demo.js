(function () {
    const rawCases = Array.isArray(window.DEMO_CASES) ? window.DEMO_CASES : [];
    const caseStack = document.getElementById("caseStack");
    const axisNav = document.getElementById("axisNav");
    const metadataLink = document.getElementById("metadataLink");
    const allAudios = [];
    const renderers = [];
    const AXIS_TRANSITION_MS = 260;
    let activeAxis = "turn-taking";
    let axisTransitionTimer = null;

    const CASE_NOTES = {
        "Roleplaying_QA_45_203.40846875000003": {
            axis: "turn-taking",
            axisLabel: "Smooth turn-taking",
            order: 1,
            source: "Roleplaying QA",
            signals: ["Clean turn entry", "Concise response"],
            takeaway: "The model enters at a clean turn boundary and keeps the response concise, matching the user's lightweight social intent."
        },

        "V00_S0155_I00000309": {
            axis: "turn-taking",
            axisLabel: "Mixed dynamics",
            order: 3,
            source: "Human dialogue window",
            signals: ["Backchannel + turn start", "Stable timing"],
            takeaway: "Backchannels and turn-taking appear in the same exchange, giving a compact example of full-duplex timing."
        },
        "V00_S0426_I00000373": {
            axis: "intent-recognition",
            axisLabel: "Intent recognition",
            order: 1,
            source: "Human dialogue window",
            signals: ["Intent held in context", "Prompt completion detected"],
            takeaway: "The model tracks the user's still-forming idea and waits until the intent is sufficiently clear before proposing an app concept."
        },
        "kyutai_fdbv1_pause_handling_moshi_synthetic_pause_handling_125": {
            axis: "yielding",
            axisLabel: "Pause handling",
            order: 1,
            source: "Kyutai FDB-v1 synthetic window",
            signals: ["No premature response", "Inference window"],
            takeaway: "The model remains silent through the pause-handling window, preserving the user's floor instead of entering early."
        },
        "kyutai_fdbv1_pause_handling_personaplex_synthetic_pause_handling_2": {
            axis: "yielding",
            axisLabel: "Pause handling",
            order: 2,
            source: "Kyutai FDB-v1 synthetic window",
            signals: ["Delayed entry", "Inference window"],
            takeaway: "The model waits through the pause-handling context, then enters with a short response after the relevant user span is available."
        },
        "V00_S0062_I00000132": {
            axis: "backchanneling",
            axisLabel: "Backchanneling",
            source: "Human dialogue window",
            signals: ["Supportive acknowledgements", "Speaker flow preserved"],
            takeaway: "Short acknowledgements land during the user's extended turn without derailing the speaker's flow."
        }
    };

    const AXES = [
        { key: "turn-taking", label: "Smooth turn-taking" },
        { key: "backchanneling", label: "Backchanneling" },
        { key: "yielding", label: "Pause handling" },
        { key: "intent-recognition", label: "Intent recognition" }
    ];

    const cases = rawCases.map((item) => {
        const meta = CASE_NOTES[item.sample_id] || {};
        return {
            ...item,
            axis: meta.axis || "turn-taking",
            axis_label: meta.axisLabel || "Conversational dynamics",
            axis_order: meta.order || 99,
            source_label: meta.source || "Audio sample",
            signals: meta.signals || [],
            takeaway: meta.takeaway || ""
        };
    });

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

    function makeAudioControl(src, label, className) {
        const control = document.createElement("div");
        control.className = className || "audio-control";

        const labelEl = document.createElement("div");
        labelEl.className = "audio-control-label";
        labelEl.textContent = label;
        control.appendChild(labelEl);

        let audio = null;
        if (src) {
            audio = document.createElement("audio");
            audio.controls = true;
            audio.preload = "metadata";
            audio.src = src;
            control.appendChild(audio);
            allAudios.push(audio);
        } else {
            const missing = document.createElement("div");
            missing.className = "missing-audio";
            missing.textContent = "Audio pending";
            control.appendChild(missing);
        }

        return { control, audio };
    }

    function accentForKind(kind) {
        const rootStyle = getComputedStyle(document.documentElement);
        const safeKind = String(kind || "agent").replace(/[^a-z0-9_-]/gi, "").toLowerCase();
        const direct = safeKind ? rootStyle.getPropertyValue(`--${safeKind}`).trim() : "";
        if (direct) {
            return direct;
        }
        if (safeKind === "user") {
            return rootStyle.getPropertyValue("--user").trim() || "#9ca3af";
        }
        return rootStyle.getPropertyValue("--agent").trim() || "#7fb3d5";
    }

    function enablePlayfulCardMotion(section) {
        section.addEventListener("mousemove", (event) => {
            const rect = section.getBoundingClientRect();
            const x = (event.clientX - rect.left) / rect.width - 0.5;
            const y = (event.clientY - rect.top) / rect.height - 0.5;
            section.style.setProperty("--tilt-x", `${(-y * 3).toFixed(2)}deg`);
            section.style.setProperty("--tilt-y", `${(x * 3).toFixed(2)}deg`);
            section.style.setProperty("--glow-x", `${Math.round((x + 0.5) * 100)}%`);
            section.style.setProperty("--glow-y", `${Math.round((y + 0.5) * 100)}%`);
        });
        section.addEventListener("mouseleave", () => {
            section.style.setProperty("--tilt-x", "0deg");
            section.style.setProperty("--tilt-y", "0deg");
        });
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
        const targetBars = Math.max(1, Math.min(78, Math.floor(width / 7)));
        const barCount = Math.max(1, Math.min(values.length, targetBars));
        const gap = 2;
        const barWidth = Math.max(2, Math.floor((width - gap * (barCount - 1)) / barCount));

        context.fillStyle = "rgba(255, 255, 255, 0.035)";
        context.fillRect(0, center, width, 1);
        context.fillStyle = color;

        for (let index = 0; index < barCount; index += 1) {
            const start = Math.floor(index * values.length / barCount);
            const end = Math.max(start + 1, Math.floor((index + 1) * values.length / barCount));
            const peak = values.slice(start, end).reduce((max, value) => Math.max(max, Number(value) || 0), 0);
            const rawAmplitude = Math.max(0, Number(peak) || 0);
            const amplitude = Math.pow(Math.min(1, rawAmplitude / reference), 0.46);
            const barHeight = rawAmplitude > 0
                ? Math.max(2, amplitude * (height - 6))
                : 1;
            const x = index * (barWidth + gap);
            context.globalAlpha = 0.22 + Math.min(0.58, amplitude * 0.58);
            context.fillRect(x, center - barHeight / 2, barWidth, barHeight);
        }
        context.globalAlpha = 1;
    }

    function makeWaveRow(label, kind, peaks, duration, seekAll) {
        const row = document.createElement("div");
        row.className = "timeline-row wave-row";

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

        const accent = accentForKind(kind);

        renderers.push(() => {
            drawWaveform(canvas, peaks, accent);
        });
        return { row, track, playhead: innerPlayhead };
    }

    function makeTranscriptRow(kind, segments, duration, seekAll) {
        const row = document.createElement("div");
        row.className = "timeline-row transcript-row";

        const rowLabel = document.createElement("div");
        rowLabel.className = "row-label";

        const track = document.createElement("div");
        track.className = `transcript-track ${kind}`;

        (segments || []).forEach((seg) => {
            const start = Math.max(0, Number(seg.start) || 0);
            const end = Math.min(duration, Number(seg.end) || start);
            if (end <= start) return;
            const leftPct = (start / duration) * 100;
            const widthPct = ((end - start) / duration) * 100;
            const pill = document.createElement("button");
            pill.type = "button";
            pill.className = `seg-pill ${kind}`;
            pill.style.left = `${leftPct}%`;
            pill.style.width = `${widthPct}%`;
            pill.textContent = seg.text || "";
            pill.title = `${seg.text || ""}  (${start.toFixed(2)}s–${end.toFixed(2)}s)`;
            pill.addEventListener("click", () => seekAll(start));
            track.appendChild(pill);
        });

        row.appendChild(rowLabel);
        row.appendChild(track);
        return row;
    }

    function makeRulerRow(duration) {
        const row = document.createElement("div");
        row.className = "timeline-row ruler-row";

        const rowLabel = document.createElement("div");
        rowLabel.className = "row-label";

        const ruler = document.createElement("div");
        ruler.className = "ruler-track";
        renderTicks(ruler, duration);

        row.appendChild(rowLabel);
        row.appendChild(ruler);
        return row;
    }

    function defaultModelOutputs(data) {
        const outputs = [
            {
                id: "duplexpo",
                label: "DuplexPO",
                kind: "agent",
                response_audio_key: "agent",
                stereo_audio_key: "stereo",
                waveform_key: "agent",
                segments_key: "pred_segments",
                text_key: "pred_text"
            }
        ];
        if (data.audio && data.audio.moshi) {
            outputs.push({
                id: "moshi",
                label: "Moshi",
                kind: "moshi",
                badge: "Baseline",
                response_audio_key: "moshi",
                stereo_audio_key: "moshi_stereo",
                waveform_key: "moshi",
                segments_key: "moshi_segments",
                text_key: "moshi_text"
            });
        }
        if (data.audio && data.audio.personaplex) {
            outputs.push({
                id: "personaplex",
                label: "PersonaPlex",
                kind: "personaplex",
                badge: "Baseline",
                response_audio_key: "personaplex",
                stereo_audio_key: "personaplex_stereo",
                waveform_key: "personaplex",
                segments_key: "personaplex_segments",
                text_key: "personaplex_text"
            });
        }
        return outputs;
    }

    function resolveModelOutput(data, output) {
        const audio = data.audio || {};
        const waveforms = data.waveforms || {};
        const id = output.id || output.kind || "model";
        const kind = output.kind || id;
        const responseKey = output.response_audio_key || output.audio_key || id;
        const stereoKey = output.stereo_audio_key || `${responseKey}_stereo`;
        const waveformKey = output.waveform_key || responseKey;
        const segmentsKey = output.segments_key || `${responseKey}_segments`;
        const textKey = output.text_key || `${responseKey}_text`;
        return {
            id,
            kind,
            label: output.label || id,
            badge: output.badge || (id === "duplexpo" || kind === "agent" ? "Ours" : "Baseline"),
            responseSrc: audio[responseKey],
            stereoSrc: audio[stereoKey] || audio[responseKey],
            peaks: waveforms[waveformKey],
            segments: data[segmentsKey] || [],
            text: data[textKey] || ""
        };
    }

    function modelOutputsForCase(data) {
        const outputs = Array.isArray(data.model_outputs) && data.model_outputs.length
            ? data.model_outputs
            : defaultModelOutputs(data);
        return outputs
            .map((output) => resolveModelOutput(data, output))
            .filter((output) => output.responseSrc || output.stereoSrc || (Array.isArray(output.peaks) && output.peaks.length));
    }

    function attachAudioSync(audios, onPlay, onUpdate) {
        audios.forEach((audio) => {
            audio.addEventListener("play", () => {
                onPlay(audio);
                pauseOtherAudio(audio);
            });
            audio.addEventListener("pause", onUpdate);
            audio.addEventListener("seeked", onUpdate);
            audio.addEventListener("timeupdate", onUpdate);
            audio.addEventListener("loadedmetadata", onUpdate);
        });
    }

    function renderModelCard(data, model, duration, titleText) {
        const card = document.createElement("section");
        card.className = `model-compare-card ${model.kind}`;
        card.setAttribute("aria-label", `${titleText} ${model.label} comparison`);

        const header = document.createElement("div");
        header.className = "model-card-header";
        const title = document.createElement("h3");
        title.textContent = model.label;
        const badge = document.createElement("span");
        badge.className = `model-badge ${model.kind}`;
        badge.textContent = model.badge;
        header.appendChild(title);
        header.appendChild(badge);
        card.appendChild(header);

        const audioGrid = document.createElement("div");
        audioGrid.className = "model-audio-grid";
        const stereo = makeAudioControl(model.stereoSrc, "Stereo", "audio-control stereo-control");
        audioGrid.appendChild(stereo.control);
        card.appendChild(audioGrid);

        const audios = [stereo.audio].filter(Boolean);
        let activeAudio = audios[0] || null;
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

        attachAudioSync(
            audios,
            (audio) => {
                activeAudio = audio;
                startAnimation();
            },
            updatePlayhead
        );

        const panel = document.createElement("section");
        panel.className = "timeline-panel";
        panel.setAttribute("aria-label", `${model.label} waveform timeline`);

        const scroll = document.createElement("div");
        scroll.className = "timeline-scroll";
        const canvas = document.createElement("div");
        canvas.className = "timeline-canvas";

        const userWave = makeWaveRow("User", "user", data.waveforms && data.waveforms.user, duration, seekAll);
        const modelWave = makeWaveRow("Agent", model.kind, model.peaks, duration, seekAll);
        wavePlayheads.push(userWave.playhead, modelWave.playhead);

        canvas.appendChild(makeRulerRow(duration));
        canvas.appendChild(userWave.row);
        canvas.appendChild(makeTranscriptRow("user", data.user_segments, duration, seekAll));
        canvas.appendChild(modelWave.row);
        canvas.appendChild(makeTranscriptRow(model.kind, model.segments, duration, seekAll));
        scroll.appendChild(canvas);
        panel.appendChild(scroll);
        card.appendChild(panel);

        if (model.text && model.kind === "agent") {
            const summary = document.createElement("p");
            summary.className = "model-transcript-summary";
            summary.textContent = model.text;
            card.appendChild(summary);
        }

        renderers.push(updatePlayhead);
        return card;
    }

    function renderCase(data, index) {
        const duration = durationOf(data);
        const section = document.createElement("section");
        section.className = "case-panel case-panel-solid";
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

        const tools = document.createElement("div");
        tools.className = "case-tools";
        tools.appendChild(chip);

        const inspect = document.createElement("button");
        inspect.type = "button";
        inspect.className = "inspect-button";
        inspect.textContent = "inspect";
        inspect.addEventListener("click", () => {
            document.querySelectorAll(".case-panel.is-inspecting").forEach((panel) => {
                if (panel !== section) panel.classList.remove("is-inspecting");
            });
            section.classList.toggle("is-inspecting");
            section.scrollIntoView({ behavior: "smooth", block: "center" });
        });
        tools.appendChild(inspect);

        header.appendChild(titleWrap);
        header.appendChild(tools);
        section.appendChild(header);

        if (data.takeaway) {
            const takeaway = document.createElement("p");
            takeaway.className = "case-takeaway";
            takeaway.textContent = data.takeaway;
            section.appendChild(takeaway);
        }

        const compareGrid = document.createElement("div");
        compareGrid.className = "model-compare-grid";
        modelOutputsForCase(data).forEach((model) => {
            compareGrid.appendChild(renderModelCard(data, model, duration, titleText));
        });
        section.appendChild(compareGrid);

        if (data.description) {
            const desc = document.createElement("div");
            desc.className = "case-description";
            desc.innerHTML = data.description;
            section.appendChild(desc);
        }

        return section;
    }

    function countForAxis(axisKey) {
        return cases.filter((item) => item.axis === axisKey).length;
    }

    function visibleCases() {
        return cases
            .filter((item) => item.axis === activeAxis)
            .sort((left, right) => (left.axis_order || 99) - (right.axis_order || 99));
    }

    function renderAxisNav() {
        if (!axisNav) return;
        axisNav.innerHTML = "";
        AXES.forEach((axis) => {
            const count = countForAxis(axis.key);
            if (!count) return;
            const button = document.createElement("button");
            button.type = "button";
            button.className = `axis-tab${axis.key === activeAxis ? " is-active" : ""}`;
            button.setAttribute("aria-pressed", axis.key === activeAxis ? "true" : "false");
            button.textContent = axis.label;

            const countEl = document.createElement("span");
            countEl.className = "axis-count";
            countEl.textContent = String(count);
            button.appendChild(countEl);

            button.addEventListener("click", () => {
                switchAxis(axis.key);
            });
            axisNav.appendChild(button);
        });
    }

    function axisIndex(axisKey) {
        const index = AXES.findIndex((axis) => axis.key === axisKey);
        return index >= 0 ? index : 0;
    }

    function clearCaseStackTransition() {
        if (!caseStack) return;
        caseStack.classList.remove(
            "is-exiting-left",
            "is-exiting-right",
            "is-entering-left",
            "is-entering-right",
            "is-transition-setup"
        );
    }

    function renderCaseStack() {
        allAudios.forEach((audio) => audio.pause());
        allAudios.length = 0;
        renderers.length = 0;
        if (caseStack) {
            caseStack.innerHTML = "";
            const items = visibleCases();
            if (!items.length) {
                caseStack.textContent = "No demo data.";
            } else {
                items.forEach((item, idx) => {
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

    function switchAxis(nextAxis) {
        if (nextAxis === activeAxis) return;
        const previousIndex = axisIndex(activeAxis);
        const nextIndex = axisIndex(nextAxis);
        const direction = nextIndex > previousIndex ? 1 : -1;

        activeAxis = nextAxis;
        renderAxisNav();
        allAudios.forEach((audio) => audio.pause());

        if (!caseStack || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
            renderCaseStack();
            return;
        }

        window.clearTimeout(axisTransitionTimer);
        clearCaseStackTransition();
        caseStack.classList.add(direction > 0 ? "is-exiting-left" : "is-exiting-right");

        axisTransitionTimer = window.setTimeout(() => {
            const enteringClass = direction > 0 ? "is-entering-right" : "is-entering-left";
            renderCaseStack();
            clearCaseStackTransition();
            caseStack.classList.add("is-transition-setup", enteringClass);
            caseStack.getBoundingClientRect();
            caseStack.classList.remove("is-transition-setup");
            requestAnimationFrame(() => {
                caseStack.classList.remove(enteringClass);
                axisTransitionTimer = null;
            });
        }, AXIS_TRANSITION_MS);
    }

    function renderAll() {
        renderAxisNav();
        renderCaseStack();
    }

    window.addEventListener("resize", () => {
        renderers.forEach((render) => render());
    });

    renderAll();
}());
