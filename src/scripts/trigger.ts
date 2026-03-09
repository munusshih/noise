import { ensureAudio, playBass } from "./audio";
import { state } from "./state";
import type { Quake } from "./state";

export function triggerQuake(q: Quake): void {
    const n = ensureAudio();
    if (n.ctx.state === "suspended") n.ctx.resume();

    state.playingId = q.id;

    document.querySelectorAll<HTMLElement>(".quake-card").forEach((card) => {
        card.classList.toggle("playing", card.dataset.id === q.id);
    });

    const dur = parseInt(
        (document.getElementById("dur-slider") as HTMLInputElement).value,
    );
    const lfoRate = parseFloat(
        (document.getElementById("lfo-slider") as HTMLInputElement).value,
    );
    const waveform =
        (
            (document.querySelector("#wave-btns .btn.active") as HTMLButtonElement)
                ?.dataset.wave as OscillatorType
        ) ?? "sine";

    document.getElementById("now-playing")!.textContent =
        `▶ M${q.mag.toFixed(1)}  ${q.freq.toFixed(1)} Hz  —  ${q.place}`;

    playBass({ frequency: q.freq, waveform, duration: dur, lfoRate });
}
