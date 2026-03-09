import { ensureAudio, getAudioNodes } from "./audio";
import { fetchQuakes } from "./quakes";
import { startSequence, stopSequence } from "./sequencer";
import { state } from "./state";

export function wireControls(): void {
    // ── Sequencer
    document.getElementById("play-btn")!.addEventListener("click", () => {
        const n = ensureAudio();
        if (n.ctx.state === "suspended") n.ctx.resume();
        state.isSequencing ? stopSequence() : startSequence();
    });

    document.getElementById("stop-btn")!.addEventListener("click", stopSequence);

    document
        .getElementById("refresh-btn")!
        .addEventListener("click", fetchQuakes);

    // ── Volume
    const volSlider = document.getElementById("vol-slider") as HTMLInputElement;
    const volVal = document.getElementById("vol-val")!;
    volSlider.addEventListener("input", () => {
        const v = parseFloat(volSlider.value);
        volVal.textContent = `${Math.round(v * 100)}%`;
        const n = getAudioNodes();
        if (n) n.masterGain.gain.value = v;
    });

    // ── Duration
    const durSlider = document.getElementById("dur-slider") as HTMLInputElement;
    const durVal = document.getElementById("dur-val")!;
    durSlider.addEventListener("input", () => {
        durVal.textContent = durSlider.value;
    });

    // ── Reverb mix
    const revSlider = document.getElementById("rev-slider") as HTMLInputElement;
    const revVal = document.getElementById("rev-val")!;
    revSlider.addEventListener("input", () => {
        const v = parseFloat(revSlider.value);
        revVal.textContent = `${Math.round(v * 100)}%`;
        const n = getAudioNodes();
        if (n) {
            n.reverbGain.gain.value = v;
            n.dryGain.gain.value = 1 - v * 0.4;
        }
    });

    // ── LFO rate
    const lfoSlider = document.getElementById("lfo-slider") as HTMLInputElement;
    const lfoVal = document.getElementById("lfo-val")!;
    lfoSlider.addEventListener("input", () => {
        lfoVal.textContent = parseFloat(lfoSlider.value).toFixed(2);
    });

    // ── Waveform selector
    document.querySelectorAll("#wave-btns .btn").forEach((btn) => {
        btn.addEventListener("click", () => {
            document
                .querySelectorAll("#wave-btns .btn")
                .forEach((b) => b.classList.remove("active"));
            btn.classList.add("active");
        });
    });
}
