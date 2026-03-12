// ── Data Sources ─────────────────────────────────────────────────────────────
// A "data source" is an external API that provides values which get translated
// into sound. Add new sources here, then implement them in track-datasource.ts.

export type DataSourceId =
    | 'earthquake'
    | 'cwa_earthquake'
    | 'ntu_buildings'
    | 'taipei_noise_stations'
    | 'taipei_rain'
    | 'taiwan_aqi'
    | 'waqi_asia'
    | 'open_meteo'
    | 'gdelt_events'
    | 'exoplanets'
    | 'nasa_donki'
    | 'nasa_apod';

export const DATA_SOURCES: { id: DataSourceId; label: string; desc: string }[] = [
    { id: 'earthquake', label: '全球地震 / USGS', desc: 'USGS 全球地震流 / USGS real-time seismic' },
    { id: 'cwa_earthquake', label: '台灣地震 / CWA', desc: '台灣區域地震流 / Taiwan regional earthquake stream' },
    { id: 'ntu_buildings', label: '台大建物 / NTU', desc: '台大建物座標與名稱 / NTU campus building coordinates + names' },
    { id: 'taipei_noise_stations', label: '台北噪音站 / Taipei', desc: '臺北環境與交通噪音站位置 / Taipei environmental and traffic noise stations' },
    { id: 'taipei_rain', label: '台北雨量 / Rain', desc: '臺北雨量站即時資料 / Taipei rain station realtime feed' },
    { id: 'taiwan_aqi', label: '台灣 AQI / MOENV', desc: '環境部 AQI 與 PM2.5 測站網 / MOENV AQI and PM2.5 network' },
    { id: 'waqi_asia', label: '亞洲 AQI / WAQI', desc: 'WAQI 亞洲城市搜尋 / WAQI cross-city air quality search' },
    { id: 'open_meteo', label: '氣象模型 / Open-Meteo', desc: '全球氣象模型預報 / Global weather model forecast' },
    { id: 'gdelt_events', label: '事件時間線 / GDELT', desc: '全球事件量時間線 / Global event timeline' },
    { id: 'exoplanets', label: '系外行星 / Exoplanets', desc: 'NASA 系外行星資料庫 / NASA Exoplanet Archive' },
    { id: 'nasa_donki', label: '太空天氣 / DONKI', desc: 'NASA 太空天氣通知 / NASA space weather notifications' },
    { id: 'nasa_apod', label: '宇宙敘事 / APOD', desc: 'NASA 每日宇宙影像敘事 / NASA astronomy picture timeline' },
];

// ── Track Data ───────────────────────────────────────────────────────────────

export type SynthesisTarget =
    | 'amplitude'
    | 'frequency'
    | 'phase'
    | 'offset'
    | 'duration'
    | 'envelope'
    | 'modulation';

export interface InputMetric {
    key: string;
    label: string;
    value: number;
    unit?: string;
    min?: number;
    max?: number;
    affects: SynthesisTarget[];
}

export interface SynthesisFrame {
    timestamp: number;
    inputLabel: string;
    inputValue: number;
    sourceMode: 'live' | 'snapshot';
    soundMode: 'discrete' | 'continuous';
    amplitude: number;
    frequency: number;
    phase: number;
    offset: number;
    duration: number;
    envelopeAttack: number;
    envelopeRelease: number;
    modulationRate: number;
    modulationDepth: number;
    metrics: InputMetric[];
}

export interface Track {
    id: string;
    name: string;
    /** Which API provides the data values */
    dataSource: DataSourceId;
    /** How data values are rendered into sound */
    waveform: OscillatorType;
    /** Note-per-event or morphing continuous tone */
    soundMode: 'discrete' | 'continuous';
    /** Live API fetches or local snapshot playback */
    dataMode: 'live' | 'snapshot';
    isPlaying: boolean;
    volume: number;
    /** Per-track pitch offset in semitones (low-focused range) */
    pitch: number;
    /** Per-track tempo multiplier (wide range for very slow to fast playback) */
    speed: number;
    /** Zero-based index into the multi-channel output (maps to speaker N+1) */
    outputChannel: number;
}

/** Live Web Audio nodes for a track — created on demand */
export interface TrackRuntime {
    gainNode: GainNode;
    analyser: AnalyserNode;
    stopSource: (() => void) | null;
    /** Rolling buffer of raw API input values (auto-scaled in visualiser) */
    dataBuffer: number[];
    /** Rolling history of synthesis parameters derived from API input */
    synthBuffer: SynthesisFrame[];
    /** Source-specific latest metric text, drawn on the data canvas */
    latestDataLabel: string;
    /** Source-specific latest context text, shown under each track */
    latestContext: string;
    /** Source-specific metric -> synthesis mapping description */
    latestMapping: string;
    /** Last synthesis frame (for textual/graph detail) */
    latestFrame: SynthesisFrame | null;
    /** Optional continuous synth voice for smooth morphing mode */
    continuousVoice: {
        osc: OscillatorNode;
        lfo: OscillatorNode;
        lfoGain: GainNode;
        env: GainNode;
        offsetSource: ConstantSourceNode;
        offsetGain: GainNode;
    } | null;
}

// ── State ────────────────────────────────────────────────────────────────────

let _nextId = 1;

/** Mutable list of all tracks — mutate in place (push / splice) */
export const tracks: Track[] = [];

/** Map of trackId → live audio nodes */
export const runtimes = new Map<string, TrackRuntime>();

export function createTrack(outputChannel: number): Track {
    const n = _nextId++;
    return {
        id: `track-${n}`,
        name: `軌道 ${n} / Track ${n}`,
        dataSource: 'earthquake',
        waveform: 'sine',
        soundMode: 'continuous',
        dataMode: 'snapshot',
        isPlaying: false,
        volume: 0.7,
        pitch: -18,
        speed: 0.2,
        outputChannel,
    };
}
