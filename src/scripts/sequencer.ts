import { state } from "./state";
import { triggerQuake } from "./trigger";

export function startSequence(): void {
    if (!state.quakes.length) return;
    state.isSequencing = true;
    state.sequenceIndex = 0;
    document.getElementById("play-btn")!.classList.add("active");
    step();
}

function step(): void {
    if (!state.isSequencing || state.sequenceIndex >= state.quakes.length) {
        stopSequence();
        return;
    }
    triggerQuake(state.quakes[state.sequenceIndex]);
    const dur = parseInt(
        (document.getElementById("dur-slider") as HTMLInputElement).value,
    );
    state.sequenceIndex++;
    state.sequenceTimer = setTimeout(step, dur + 200);
}

export function stopSequence(): void {
    state.isSequencing = false;
    if (state.sequenceTimer) clearTimeout(state.sequenceTimer);
    state.sequenceTimer = null;
    state.playingId = null;
    document.getElementById("play-btn")!.classList.remove("active");
    document.getElementById("now-playing")!.textContent = "— stopped —";
    document
        .querySelectorAll(".quake-card")
        .forEach((c) => c.classList.remove("playing"));
}
