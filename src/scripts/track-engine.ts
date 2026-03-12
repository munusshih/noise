/**
 * Multi-channel audio engine for the track system.
 *
 * Architecture:
 *   Each track: source → gainNode → analyser → ChannelMerger[ch] → destination
 *
 * The ChannelMerger has one input per output speaker channel, so Track 1
 * goes to Speaker 1, Track 2 to Speaker 2, etc. Up to maxChannelCount
 * (hardware limit, capped at 8).
 */

import type { Track, TrackRuntime } from './track-state';
import { runtimes } from './track-state';

export const AUDIO_READY_EVENT = 'noise:audio-ready';

let _ctx: AudioContext | null = null;
let _merger: ChannelMergerNode | null = null;
let _maxChannels = 2;

// ── Context & Routing ────────────────────────────────────────────────────────

export function getAudioContext(): AudioContext {
    if (!_ctx) {
        _ctx = new AudioContext();

        // Use as many hardware output channels as available (max 8 to be safe)
        _maxChannels = Math.min(_ctx.destination.maxChannelCount, 8);
        _ctx.destination.channelCount = _maxChannels;
        _ctx.destination.channelCountMode = 'explicit';
        _ctx.destination.channelInterpretation = 'discrete';

        // One input per output channel; each input is mono
        _merger = _ctx.createChannelMerger(_maxChannels);
        _merger.connect(_ctx.destination);
        _emitAudioReady();
    }
    if (_ctx.state === 'suspended') _ctx.resume();
    return _ctx;
}

export function getMaxChannels(): number {
    return _maxChannels;
}

// ── Per-track Nodes ──────────────────────────────────────────────────────────

export function ensureTrackRuntime(track: Track): TrackRuntime {
    const existing = runtimes.get(track.id);
    if (existing) return existing;

    const ctx = getAudioContext();

    const gainNode = ctx.createGain();
    gainNode.gain.value = track.volume;

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.8;

    // route: gainNode → analyser → merger[outputChannel]
    gainNode.connect(analyser);
    _connectAnalyserToChannel(analyser, track.outputChannel);

    const runtime: TrackRuntime = {
        gainNode,
        analyser,
        stopSource: null,
        dataBuffer: [],
        synthBuffer: [],
        latestDataLabel: '',
        latestContext: '',
        latestMapping: '',
        latestFrame: null,
        continuousVoice: null,
    };
    runtimes.set(track.id, runtime);
    return runtime;
}

/** Reconnect a track's analyser to a different output channel (speaker). */
export function rerouteTrack(trackId: string, newChannel: number): void {
    const runtime = runtimes.get(trackId);
    if (!runtime || !_merger || !_ctx) return;
    runtime.analyser.disconnect();
    _connectAnalyserToChannel(runtime.analyser, newChannel);
}

export function removeTrackRuntime(trackId: string): void {
    const runtime = runtimes.get(trackId);
    if (!runtime) return;
    if (runtime.stopSource) {
        try { runtime.stopSource(); } catch { /* already stopped */ }
        runtime.stopSource = null;
    }
    runtime.gainNode.disconnect();
    runtime.analyser.disconnect();
    if (runtime.continuousVoice) {
        try { runtime.continuousVoice.osc.stop(); } catch { /* already stopped */ }
        try { runtime.continuousVoice.lfo.stop(); } catch { /* already stopped */ }
        try { runtime.continuousVoice.offsetSource.stop(); } catch { /* already stopped */ }
        runtime.continuousVoice.osc.disconnect();
        runtime.continuousVoice.lfo.disconnect();
        runtime.continuousVoice.lfoGain.disconnect();
        runtime.continuousVoice.env.disconnect();
        runtime.continuousVoice.offsetSource.disconnect();
        runtime.continuousVoice.offsetGain.disconnect();
        runtime.continuousVoice = null;
    }
    runtimes.delete(trackId);
}

// ── Internal helpers ─────────────────────────────────────────────────────────

function _connectAnalyserToChannel(analyser: AnalyserNode, channel: number): void {
    if (!_merger) return;
    const ch = Math.max(0, Math.min(channel, _maxChannels - 1));
    // analyser output 0 → merger input ch (mono)
    analyser.connect(_merger, 0, ch);
}

function _emitAudioReady(): void {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent(AUDIO_READY_EVENT, {
        detail: { maxChannels: _maxChannels },
    }));
}
