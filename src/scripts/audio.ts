export interface AudioNodes {
    ctx: AudioContext;
    masterGain: GainNode;
    analyser: AnalyserNode;
    reverbNode: ConvolverNode;
    reverbGain: GainNode;
    dryGain: GainNode;
}

let nodes: AudioNodes | null = null;

export function getAudioNodes(): AudioNodes | null {
    return nodes;
}

export function ensureAudio(): AudioNodes {
    if (nodes) return nodes;

    const ctx = new AudioContext();

    const masterGain = ctx.createGain();
    masterGain.gain.value = 0.7;

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.85;

    const dryGain = ctx.createGain();
    dryGain.gain.value = 0.6;

    const reverbGain = ctx.createGain();
    reverbGain.gain.value = 0.4;

    const reverbNode = ctx.createConvolver();
    reverbNode.buffer = buildImpulse(ctx, 3.5, 3.0);

    // routing: masterGain → dry → analyser → destination
    //          masterGain → reverb → reverbGain → analyser → destination
    masterGain.connect(dryGain);
    masterGain.connect(reverbNode);
    dryGain.connect(analyser);
    reverbNode.connect(reverbGain);
    reverbGain.connect(analyser);
    analyser.connect(ctx.destination);

    nodes = { ctx, masterGain, analyser, reverbNode, reverbGain, dryGain };
    return nodes;
}

function buildImpulse(ctx: AudioContext, duration: number, decay: number): AudioBuffer {
    const sr = ctx.sampleRate;
    const len = Math.floor(sr * duration);
    const buf = ctx.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
        const data = buf.getChannelData(ch);
        for (let i = 0; i < len; i++) {
            data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
        }
    }
    return buf;
}

export function magToFreq(mag: number): number {
    // Map magnitude 0–10 → 20–220 Hz (pure bass range)
    const clamped = Math.max(0, Math.min(10, mag));
    return 20 + (clamped / 10) * 200;
}

export interface PlayOptions {
    frequency: number;
    waveform: OscillatorType;
    duration: number;
    lfoRate: number;
}

export function playBass({ frequency, waveform, duration, lfoRate }: PlayOptions): void {
    const n = getAudioNodes();
    if (!n) return;

    const now = n.ctx.currentTime;
    const attack = 0.12;
    const release = Math.min(1.8, duration * 0.0004);
    const sustain = duration / 1000 - attack - release;

    // ── Oscillator
    const osc = n.ctx.createOscillator();
    osc.type = waveform;
    osc.frequency.setValueAtTime(frequency, now);

    // ── LFO (pitch wobble)
    const lfo = n.ctx.createOscillator();
    const lfoGain = n.ctx.createGain();
    lfo.frequency.value = lfoRate;
    lfoGain.gain.value = frequency * 0.015; // ±1.5% pitch drift
    lfo.connect(lfoGain);
    lfoGain.connect(osc.frequency);
    lfo.start(now);
    lfo.stop(now + duration / 1000 + 0.1);

    // ── Envelope
    const env = n.ctx.createGain();
    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(1.0, now + attack);
    env.gain.setValueAtTime(1.0, now + attack + Math.max(0, sustain));
    env.gain.linearRampToValueAtTime(0, now + attack + Math.max(0, sustain) + release);

    // ── Low-pass filter (keep it bassy)
    const lpf = n.ctx.createBiquadFilter();
    lpf.type = "lowpass";
    lpf.frequency.value = 280;
    lpf.Q.value = 1.2;

    // ── Signal chain
    osc.connect(lpf);
    lpf.connect(env);
    env.connect(n.masterGain);

    osc.start(now);
    osc.stop(now + duration / 1000 + 0.5);
}
