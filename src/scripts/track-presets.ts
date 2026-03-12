/**
 * Sound generation presets for each track.
 *
 * Each preset implements a simple adapter interface:
 *   startPreset(preset, runtime) → stopFn
 *
 * Add new API integrations here by:
 *   1. Adding a new ApiPreset value in track-state.ts
 *   2. Adding a case in startPreset()
 *   3. Implementing a start* function that connects to runtime.gainNode
 */

import type { ApiPreset, TrackRuntime } from './track-state';
import { getAudioContext } from './track-engine';

/** Starts the audio for a preset. Returns a function that stops it. */
export function startPreset(preset: ApiPreset, runtime: TrackRuntime): () => void {
    const ctx = getAudioContext();
    switch (preset) {
        case 'oscillator': return startOscillator(ctx, runtime);
        case 'noise': return startNoise(ctx, runtime);
        case 'drone': return startDrone(ctx, runtime);
        case 'ping': return startPing(ctx, runtime);
        case 'pulse': return startPulse(ctx, runtime);
        default: return () => { };
    }
}

// ── Preset Implementations ───────────────────────────────────────────────────

/** Simple sine oscillator at 110 Hz */
function startOscillator(ctx: AudioContext, rt: TrackRuntime): () => void {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 110;
    osc.connect(rt.gainNode);
    osc.start();
    return () => { try { osc.stop(); } catch { /* already stopped */ } };
}

/** Looping white noise buffer */
function startNoise(ctx: AudioContext, rt: TrackRuntime): () => void {
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.connect(rt.gainNode);
    src.start();
    return () => { try { src.stop(); } catch { /* already stopped */ } };
}

/** Two slightly-detuned sawtooth oscillators for a thick drone */
function startDrone(ctx: AudioContext, rt: TrackRuntime): () => void {
    const o1 = ctx.createOscillator();
    const o2 = ctx.createOscillator();
    o1.type = 'sawtooth';
    o2.type = 'sawtooth';
    o1.frequency.value = 55;
    o2.frequency.value = 55.5; // slight detune → beating effect
    o1.connect(rt.gainNode);
    o2.connect(rt.gainNode);
    o1.start();
    o2.start();
    return () => {
        try { o1.stop(); } catch { /* already stopped */ }
        try { o2.stop(); } catch { /* already stopped */ }
    };
}

/** Random pitched pings at irregular intervals */
function startPing(ctx: AudioContext, rt: TrackRuntime): () => void {
    let stopped = false;
    function fire() {
        if (stopped) return;
        const osc = ctx.createOscillator();
        const env = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = 330 + Math.random() * 880;
        env.gain.setValueAtTime(1, ctx.currentTime);
        env.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.9);
        osc.connect(env);
        env.connect(rt.gainNode);
        osc.start();
        osc.stop(ctx.currentTime + 0.95);
        setTimeout(fire, 600 + Math.random() * 1400);
    }
    fire();
    return () => { stopped = true; };
}

/** Square wave with LFO-modulated frequency (pulsing effect) */
function startPulse(ctx: AudioContext, rt: TrackRuntime): () => void {
    const osc = ctx.createOscillator();
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();

    osc.type = 'square';
    osc.frequency.value = 80;

    lfo.type = 'sine';
    lfo.frequency.value = 4;
    lfoGain.gain.value = 50; // ±50 Hz pitch wobble

    lfo.connect(lfoGain);
    lfoGain.connect(osc.frequency);
    osc.connect(rt.gainNode);
    osc.start();
    lfo.start();

    return () => {
        try { osc.stop(); } catch { /* already stopped */ }
        try { lfo.stop(); } catch { /* already stopped */ }
    };
}
