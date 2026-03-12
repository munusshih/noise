/**
 * Data source adapters — bridge between external APIs and audio tracks.
 *
 * Every API event is translated into a full synthesis frame so we can show:
 * amplitude, frequency, phase, offset, duration, envelope, modulation.
 */

import { DATA_SOURCES } from './track-state';
import type { DataSourceId, InputMetric, SynthesisFrame, Track, TrackRuntime } from './track-state';
import { state } from './state';
import { getAudioContext } from './track-engine';

/** Rolling buffer size for API input trend */
export const DATA_BUF_LEN = 120;
/** Rolling buffer size for synthesis parameter trend */
export const SYNTH_BUF_LEN = 120;

const CACHE = new Map<string, CacheEntry<unknown>>();
const LIVE_SERIES = new Map<DataSourceId, SourceDatum[]>();
const SNAPSHOT_KEY = 'noise.track.snapshots.v1';
const SNAPSHOT_LIMIT = 180;
const SNAPSHOT_STORE = _loadSnapshotStore();
let NTU_ANCHOR_NAME = '';
let NOISE_ANCHOR_ID = '';
let RAIN_ANCHOR_NO = '';
let AQI_ANCHOR_SITE = '臺北';
const SOURCE_LABEL_MAP = new Map(DATA_SOURCES.map(source => [source.id, source.label]));

interface CacheEntry<T> {
    value: T | null;
    expiresAt: number;
    pending: Promise<T> | null;
}

interface SourceDatum {
    inputKey: string;
    inputLabel: string;
    inputValue: number;
    inputUnit?: string;
    norm: number;
    baseFrequency: number;
    context: string;
    metrics: InputMetric[];
    sourceMode: 'live' | 'snapshot';
}

interface SourceLoopOpts {
    tickMs: number | ((count: number) => number);
    minTickMs?: number;
    maxTickMs?: number;
    emptyTickMs?: number;
}

interface SourceLoadResult {
    items: SourceDatum[];
    mode: 'live' | 'snapshot';
}

interface NtuWfsFeatureCollection {
    features: NtuWfsFeature[];
}

interface NtuWfsFeature {
    geometry: { coordinates: [number, number] };
    properties: {
        bldg_ch?: string;
        bldg_en?: string;
    };
}

interface RainApiResponse {
    count: number;
    data: RainApiItem[];
}

interface RainApiItem {
    stationNo: string;
    stationName: string;
    recTime: string;
    rain: number;
}

interface AllOriginsGetResponse {
    contents: string;
}

interface OpenMeteoResponse {
    hourly: {
        time: string[];
        temperature_2m: number[];
        precipitation: number[];
        wind_speed_10m: number[];
    };
}

interface GdeltTimelinePoint {
    date: string;
    value: number;
}

interface GdeltTimelineSeries {
    data: GdeltTimelinePoint[];
}

interface GdeltResponse {
    timeline?: GdeltTimelineSeries[];
}

interface ExoplanetRow {
    pl_name: string;
    disc_year: number | null;
    pl_bmasse: number | null;
    pl_orbper: number | null;
}

interface MoenvAqiRow {
    sitename: string;
    county: string;
    aqi: string;
    'pm2.5': string;
    o3_8hr: string;
    pm10: string;
    publishtime: string;
}

interface WaqiSearchResponse {
    status: string;
    data?: Array<{
        uid: number;
        aqi: string;
        time?: {
            stime?: string;
            vtime?: number;
        };
        station?: {
            name?: string;
            country?: string;
        };
    }>;
}

interface NasaDonkiItem {
    messageType?: string;
    messageIssueTime?: string;
    messageBody?: string;
    messageID?: string;
}

interface NasaApodItem {
    date?: string;
    title?: string;
    explanation?: string;
    media_type?: string;
}

interface ContinuousVoice {
    osc: OscillatorNode;
    lfo: OscillatorNode;
    lfoGain: GainNode;
    env: GainNode;
    offsetSource: ConstantSourceNode;
    offsetGain: GainNode;
}

// ── Public entry point ───────────────────────────────────────────────────────

export function startDataSource(track: Track, runtime: TrackRuntime): () => void {
    switch (track.dataSource) {
        case 'earthquake':
            return _startSource(track, runtime, 'earthquake', loadEarthquakesLive, {
                tickMs: 3400,
                minTickMs: 250,
                maxTickMs: 300_000,
            });

        case 'cwa_earthquake':
            return _startSource(track, runtime, 'cwa_earthquake', loadCwaEarthquakes, {
                tickMs: 3200,
                minTickMs: 220,
                maxTickMs: 300_000,
            });

        case 'ntu_buildings':
            return _startSource(track, runtime, 'ntu_buildings', loadNtuBuildings, {
                tickMs: 3400,
                minTickMs: 250,
                maxTickMs: 300_000,
            });

        case 'taipei_noise_stations':
            return _startSource(track, runtime, 'taipei_noise_stations', loadTaipeiNoiseStations, {
                tickMs: 3600,
                minTickMs: 250,
                maxTickMs: 300_000,
            });

        case 'taipei_rain':
            return _startSource(track, runtime, 'taipei_rain', loadTaipeiRain, {
                tickMs: 3000,
                minTickMs: 250,
                maxTickMs: 300_000,
            });

        case 'taiwan_aqi':
            return _startSource(track, runtime, 'taiwan_aqi', loadTaiwanAqi, {
                tickMs: 2600,
                minTickMs: 220,
                maxTickMs: 300_000,
            });

        case 'waqi_asia':
            return _startSource(track, runtime, 'waqi_asia', loadWaqiAsia, {
                tickMs: 2800,
                minTickMs: 220,
                maxTickMs: 300_000,
            });

        case 'open_meteo':
            return _startSource(track, runtime, 'open_meteo', loadOpenMeteo, {
                tickMs: 4200,
                minTickMs: 250,
                maxTickMs: 300_000,
            });

        case 'gdelt_events':
            return _startSource(track, runtime, 'gdelt_events', loadGdeltEvents, {
                tickMs: 4200,
                minTickMs: 250,
                maxTickMs: 300_000,
            });

        case 'exoplanets':
            return _startSource(track, runtime, 'exoplanets', loadExoplanets, {
                tickMs: 4800,
                minTickMs: 250,
                maxTickMs: 300_000,
            });

        case 'nasa_donki':
            return _startSource(track, runtime, 'nasa_donki', loadNasaDonki, {
                tickMs: 3200,
                minTickMs: 220,
                maxTickMs: 300_000,
            });

        case 'nasa_apod':
            return _startSource(track, runtime, 'nasa_apod', loadNasaApod, {
                tickMs: 3600,
                minTickMs: 220,
                maxTickMs: 300_000,
            });

        default:
            return () => {};
    }
}

function _startSource(
    track: Track,
    runtime: TrackRuntime,
    sourceId: DataSourceId,
    liveLoader: () => Promise<SourceDatum[]>,
    opts: SourceLoopOpts,
): () => void {
    const snapshotLoader = async (): Promise<SourceDatum[]> => _snapshotFor(sourceId);

    if (track.dataMode === 'snapshot') {
        return _startListSource(track, runtime, sourceId, async () => ({
            items: await snapshotLoader(),
            mode: 'snapshot',
        }), opts);
    }

    return _startListSource(
        track,
        runtime,
        sourceId,
        async () => ({ items: await liveLoader(), mode: 'live' }),
        opts,
        async () => ({ items: await snapshotLoader(), mode: 'snapshot' }),
    );
}

// ── Shared source loop ───────────────────────────────────────────────────────

function _startListSource(
    track: Track,
    runtime: TrackRuntime,
    sourceId: DataSourceId,
    primaryLoader: () => Promise<SourceLoadResult>,
    opts: SourceLoopOpts,
    fallbackLoader?: () => Promise<SourceLoadResult>,
): () => void {
    let stopped = false;
    let idx = 0;
    let data: SourceDatum[] = [];
    let timer: ReturnType<typeof setTimeout> | null = null;
    let currentMode: 'live' | 'snapshot' = 'live';

    const schedule = (baseMs: number): void => {
        if (stopped) return;
        const delay = _scaleTickMs(baseMs, track.speed, opts.minTickMs, opts.maxTickMs);
        timer = setTimeout(() => {
            void tick();
        }, delay);
    };

    const loadData = async (): Promise<void> => {
        try {
            const loaded = await primaryLoader();
            data = loaded.items.filter(_isUsableDatum);
            currentMode = loaded.mode;
            if (currentMode === 'live' && data.length) {
                _persistSnapshot(sourceId, data);
            }

            if (!data.length && fallbackLoader) {
                const fallback = await fallbackLoader();
                data = fallback.items.filter(_isUsableDatum);
                currentMode = fallback.mode;
                if (data.length) {
                    runtime.latestContext = `${_sourceLabel(sourceId)} 即時資料為空，改用快照 / Live feed empty, using snapshot`;
                }
            }
        } catch (err) {
            if (!fallbackLoader) throw err;
            const fallback = await fallbackLoader();
            data = fallback.items.filter(_isUsableDatum);
            currentMode = fallback.mode;
            runtime.latestContext = `${_sourceLabel(sourceId)} 即時資料不可用，改用快照 / Live feed unavailable, using snapshot`;
        }

        if (!data.length) {
            runtime.latestContext = `${_sourceLabel(sourceId)} 暫時沒有資料 / No records returned`;
        }
    };

    const tick = async (): Promise<void> => {
        if (stopped) return;

        if (data.length === 0) {
            try {
                await loadData();
            } catch (err) {
                console.error('data source load failed:', err);
                runtime.latestContext = `${_sourceLabel(sourceId)} 暫時無法取得 / Source unavailable`;
                schedule(opts.emptyTickMs ?? 3000);
                return;
            }

            if (!data.length) {
                schedule(opts.emptyTickMs ?? 3000);
                return;
            }
        }

        const baseMs = typeof opts.tickMs === 'function' ? opts.tickMs(data.length) : opts.tickMs;
        try {
            const item = data[idx % data.length];
            idx++;

            const frame = _buildSynthesisFrame(sourceId, item, track, currentMode);
            _pushFrame(runtime, item, frame);
            _emitSound(track, runtime, frame);
        } catch (err) {
            console.error('data source tick failed:', err);
            runtime.latestContext = `${_sourceLabel(sourceId)} 更新失敗，稍後重試 / Tick error, retrying`;
        } finally {
            schedule(baseMs);
        }

        // Refresh at end of each cycle.
        if (data.length > 0 && idx % data.length === 0 && track.dataMode === 'live') {
            void primaryLoader()
                .then(async next => {
                    if (stopped) return;

                    const nextItems = next.items.filter(_isUsableDatum);
                    if (nextItems.length) {
                        data = nextItems;
                        currentMode = next.mode;
                        if (currentMode === 'live') {
                            _persistSnapshot(sourceId, data);
                        }
                        return;
                    }

                    if (fallbackLoader) {
                        const fallback = await fallbackLoader();
                        const fallbackItems = fallback.items.filter(_isUsableDatum);
                        if (!stopped && fallbackItems.length) {
                            data = fallbackItems;
                            currentMode = fallback.mode;
                            runtime.latestContext = `${_sourceLabel(sourceId)} 即時資料為空，改用快照 / Live feed empty, using snapshot`;
                        }
                    }
                })
                .catch(async () => {
                    if (!fallbackLoader) return;
                    try {
                        const fallback = await fallbackLoader();
                        if (!stopped && fallback.items.length) {
                            data = fallback.items;
                            currentMode = fallback.mode;
                            runtime.latestContext = `${_sourceLabel(sourceId)} 即時資料不可用，改用快照 / Live feed unavailable, using snapshot`;
                        }
                    } catch {
                        // keep previous data
                    }
                });
        }
    };

    void tick();

    return () => {
        stopped = true;
        if (timer) clearTimeout(timer);
        _disposeContinuous(runtime, true);
    };
}

function _pushFrame(runtime: TrackRuntime, item: SourceDatum, frame: SynthesisFrame): void {
    runtime.dataBuffer.push(item.inputValue);
    if (runtime.dataBuffer.length > DATA_BUF_LEN) runtime.dataBuffer.shift();

    runtime.synthBuffer.push(frame);
    if (runtime.synthBuffer.length > SYNTH_BUF_LEN) runtime.synthBuffer.shift();

    runtime.latestDataLabel = `${_localizedMetricLabel(item.inputLabel)}: ${_fmtNum(item.inputValue)}${item.inputUnit ? ` ${item.inputUnit}` : ''}`;
    runtime.latestContext = item.context;
    runtime.latestFrame = frame;
    runtime.latestMapping = _buildMappingText(frame);
}

// ── Synthesis frame construction ─────────────────────────────────────────────

function _buildSynthesisFrame(
    sourceId: DataSourceId,
    item: SourceDatum,
    track: Track,
    sourceMode: 'live' | 'snapshot',
): SynthesisFrame {
    const pitchMul = Math.pow(2, track.pitch / 12);
    const speedScale = _durationScale(track.speed);

    const primary = _clamp(item.norm, 0, 1);
    const secondary = item.metrics[1] ? _metricNorm(item.metrics[1]) : primary;
    const tertiary = item.metrics[2] ? _metricNorm(item.metrics[2]) : secondary;

    let amplitude = 0.2;
    let frequency = 130;
    let phase = 0;
    let offset = 0;
    let duration = 1.2;
    let envelopeAttack = 0.04;
    let envelopeRelease = 0.6;
    let modulationRate = 0.2;
    let modulationDepth = 1.5;

    switch (sourceId) {
        case 'earthquake': {
            const mag = _metricNormByKey(item, 'mag', primary);
            const depth = _metricNormByKey(item, 'depth', secondary);
            const age = _metricNormByKey(item, 'age', tertiary);

            frequency = _clamp((54 + mag * 250 + (1 - depth) * 85) * pitchMul, 28, 720);
            amplitude = _clamp(0.1 + mag * 0.88, 0.06, 0.99);
            phase = (age * Math.PI * 2 + depth * Math.PI * 0.25) % (Math.PI * 2);
            offset = _clamp((depth - 0.5) * 0.44, -0.28, 0.28);
            duration = _clamp((0.9 + depth * 2.2 + age * 0.9) * speedScale, 0.22, 24);
            envelopeAttack = _clamp(0.01 + (1 - mag) * 0.14 + depth * 0.08, 0.01, 0.42);
            envelopeRelease = _clamp(duration * (0.32 + depth * 0.45), 0.08, Math.max(0.12, duration - 0.02));
            modulationRate = _clamp(0.08 + age * 1.4 + (1 - depth) * 0.5, 0.05, 3.4);
            modulationDepth = _clamp(frequency * (0.004 + mag * 0.02 + age * 0.01), 0.03, 38);
            break;
        }

        case 'cwa_earthquake': {
            const mag = _metricNormByKey(item, 'mag', primary);
            const depth = _metricNormByKey(item, 'depth', secondary);
            const age = _metricNormByKey(item, 'age', tertiary);

            frequency = _clamp((48 + mag * 230 + (1 - depth) * 95) * pitchMul, 24, 680);
            amplitude = _clamp(0.08 + mag * 0.85, 0.05, 0.96);
            phase = (age * Math.PI * 2 + depth * Math.PI * 0.35) % (Math.PI * 2);
            offset = _clamp((depth - 0.5) * 0.52, -0.3, 0.3);
            duration = _clamp((1.1 + depth * 2.6 + age * 1.1) * speedScale, 0.25, 28);
            envelopeAttack = _clamp(0.015 + (1 - mag) * 0.16, 0.01, 0.4);
            envelopeRelease = _clamp(duration * (0.34 + depth * 0.5), 0.1, Math.max(0.14, duration - 0.03));
            modulationRate = _clamp(0.06 + age * 1.2 + (1 - depth) * 0.9, 0.04, 3.8);
            modulationDepth = _clamp(frequency * (0.003 + mag * 0.022 + age * 0.01), 0.03, 45);
            break;
        }

        case 'ntu_buildings': {
            const x = _metricNormByKey(item, 'x', primary);
            const y = _metricNormByKey(item, 'y', secondary);
            const code = _metricNormByKey(item, 'code', tertiary);

            frequency = _clamp((88 + x * 230 + y * 30) * pitchMul, 45, 520);
            amplitude = _clamp(0.08 + x * 0.35 + y * 0.25 + code * 0.15, 0.06, 0.55);
            phase = (x * Math.PI * 2 + code * Math.PI * 0.7) % (Math.PI * 2);
            offset = _clamp((y - 0.5) * 0.24, -0.2, 0.2);
            duration = _clamp((1.4 + code * 2.6 + (1 - y) * 0.7) * speedScale, 0.35, 26);
            envelopeAttack = _clamp(0.03 + (1 - code) * 0.22, 0.02, 0.45);
            envelopeRelease = _clamp(duration * (0.45 + y * 0.35), 0.14, Math.max(0.2, duration - 0.04));
            modulationRate = _clamp(0.04 + code * 0.85 + x * 0.3, 0.03, 1.8);
            modulationDepth = _clamp(frequency * (0.002 + y * 0.006 + code * 0.006), 0.02, 16);
            break;
        }

        case 'taipei_noise_stations': {
            const zone = _metricNormByKey(item, 'zone', primary);
            const lon = _metricNormByKey(item, 'lon', secondary);
            const minute = _metricNormByKey(item, 'minute', tertiary);

            frequency = _clamp((95 + lon * 240 + zone * 70) * pitchMul, 60, 640);
            amplitude = _clamp(0.12 + zone * 0.55 + minute * 0.18, 0.08, 0.86);
            phase = (minute * Math.PI * 2 + lon * Math.PI * 0.4) % (Math.PI * 2);
            offset = _clamp((zone - 0.5) * 0.25 + Math.sin(minute * Math.PI * 2) * 0.12, -0.24, 0.24);
            duration = _clamp((0.8 + (1 - zone) * 1.4 + minute * 0.6) * speedScale, 0.25, 18);
            envelopeAttack = _clamp(0.015 + (1 - zone) * 0.12, 0.01, 0.3);
            envelopeRelease = _clamp(duration * (0.28 + zone * 0.5), 0.08, Math.max(0.14, duration - 0.02));
            modulationRate = _clamp(0.12 + zone * 2.2 + lon * 0.7 + minute * 0.8, 0.08, 4.4);
            modulationDepth = _clamp(frequency * (0.003 + minute * 0.01 + zone * 0.006), 0.05, 55);
            break;
        }

        case 'taipei_rain': {
            const rain = _metricNormByKey(item, 'rain', primary);
            const station = _metricNormByKey(item, 'station', secondary);
            const minute = _metricNormByKey(item, 'minute', tertiary);

            frequency = _clamp((64 + rain * 170 + station * 75) * pitchMul, 40, 520);
            amplitude = _clamp(0.06 + rain * 0.58 + station * 0.1, 0.05, 0.8);
            phase = (minute * Math.PI * 2) % (Math.PI * 2);
            offset = _clamp(Math.sin(minute * Math.PI * 2) * 0.16 + (station - 0.5) * 0.1, -0.24, 0.24);
            duration = _clamp((1.8 + (1 - rain) * 2.6 + minute * 0.6) * speedScale, 0.35, 24);
            envelopeAttack = _clamp(0.05 + (1 - rain) * 0.24, 0.03, 0.5);
            envelopeRelease = _clamp(duration * (0.36 + rain * 0.42), 0.12, Math.max(0.22, duration - 0.03));
            modulationRate = _clamp(0.06 + rain * 1.3 + minute * 0.8, 0.05, 2.6);
            modulationDepth = _clamp(frequency * (0.0015 + rain * 0.01 + station * 0.004), 0.03, 24);
            break;
        }

        case 'taiwan_aqi': {
            const aqi = _metricNormByKey(item, 'aqi', primary);
            const pm25 = _metricNormByKey(item, 'pm25', secondary);
            const o3 = _metricNormByKey(item, 'o3', tertiary);
            const minute = _metricNormByKey(item, 'minute', tertiary);

            frequency = _clamp((70 + aqi * 260 + o3 * 45) * pitchMul, 45, 760);
            amplitude = _clamp(0.08 + aqi * 0.62 + pm25 * 0.24, 0.06, 0.9);
            phase = (minute * Math.PI * 2 + o3 * Math.PI * 0.45) % (Math.PI * 2);
            offset = _clamp((pm25 - 0.5) * 0.36, -0.26, 0.26);
            duration = _clamp((0.9 + (1 - aqi) * 2.1 + minute * 0.8) * speedScale, 0.24, 21);
            envelopeAttack = _clamp(0.02 + (1 - pm25) * 0.15, 0.01, 0.38);
            envelopeRelease = _clamp(duration * (0.3 + aqi * 0.52), 0.09, Math.max(0.13, duration - 0.03));
            modulationRate = _clamp(0.1 + pm25 * 1.8 + o3 * 0.8, 0.05, 4.1);
            modulationDepth = _clamp(frequency * (0.002 + aqi * 0.012 + pm25 * 0.006), 0.04, 52);
            break;
        }

        case 'waqi_asia': {
            const aqi = _metricNormByKey(item, 'aqi', primary);
            const uid = _metricNormByKey(item, 'uid', secondary);
            const minute = _metricNormByKey(item, 'minute', tertiary);

            frequency = _clamp((78 + aqi * 240 + uid * 80) * pitchMul, 50, 820);
            amplitude = _clamp(0.09 + aqi * 0.64 + uid * 0.18, 0.06, 0.93);
            phase = (uid * Math.PI * 2 + minute * Math.PI * 0.4) % (Math.PI * 2);
            offset = _clamp((minute - 0.5) * 0.34, -0.24, 0.24);
            duration = _clamp((0.7 + (1 - aqi) * 1.8 + uid * 0.7) * speedScale, 0.22, 15);
            envelopeAttack = _clamp(0.012 + (1 - aqi) * 0.14, 0.008, 0.32);
            envelopeRelease = _clamp(duration * (0.26 + aqi * 0.56), 0.08, Math.max(0.12, duration - 0.02));
            modulationRate = _clamp(0.16 + aqi * 2.4 + minute * 0.6, 0.08, 4.6);
            modulationDepth = _clamp(frequency * (0.003 + uid * 0.008 + aqi * 0.013), 0.05, 66);
            break;
        }

        case 'open_meteo': {
            const temp = _metricNormByKey(item, 'temp', primary);
            const rain = _metricNormByKey(item, 'rain', secondary);
            const wind = _metricNormByKey(item, 'wind', tertiary);

            frequency = _clamp((72 + temp * 240 + wind * 55) * pitchMul, 40, 700);
            amplitude = _clamp(0.09 + temp * 0.45 + wind * 0.28, 0.06, 0.82);
            phase = (wind * Math.PI * 2 + temp * Math.PI * 0.2) % (Math.PI * 2);
            offset = _clamp((rain - 0.5) * 0.32, -0.24, 0.24);
            duration = _clamp((1.2 + rain * 2 + (1 - wind) * 1.4) * speedScale, 0.25, 20);
            envelopeAttack = _clamp(0.04 + rain * 0.2, 0.03, 0.45);
            envelopeRelease = _clamp(duration * (0.3 + rain * 0.45), 0.1, Math.max(0.16, duration - 0.03));
            modulationRate = _clamp(0.05 + wind * 1.8 + rain * 0.9, 0.04, 3.2);
            modulationDepth = _clamp(frequency * (0.002 + wind * 0.008 + rain * 0.005), 0.04, 35);
            break;
        }

        case 'gdelt_events': {
            const count = _metricNormByKey(item, 'count', primary);
            const day = _metricNormByKey(item, 'day', secondary);
            const dom = _metricNormByKey(item, 'dom', tertiary);

            frequency = _clamp((78 + count * 280 + dom * 40) * pitchMul, 50, 720);
            amplitude = _clamp(0.1 + count * 0.7, 0.07, 0.92);
            phase = (day * Math.PI * 2 + dom * Math.PI * 0.35) % (Math.PI * 2);
            offset = _clamp((dom - 0.5) * 0.4, -0.3, 0.3);
            duration = _clamp((0.7 + (1 - count) * 1.8 + day * 0.8) * speedScale, 0.22, 14);
            envelopeAttack = _clamp(0.015 + (1 - count) * 0.18, 0.01, 0.36);
            envelopeRelease = _clamp(duration * (0.24 + count * 0.58), 0.08, Math.max(0.1, duration - 0.03));
            modulationRate = _clamp(0.2 + count * 2.8 + day * 0.9, 0.08, 4.5);
            modulationDepth = _clamp(frequency * (0.003 + dom * 0.006 + count * 0.018), 0.04, 65);
            break;
        }

        case 'exoplanets': {
            const mass = _metricNormByKey(item, 'mass', primary);
            const orb = _metricNormByKey(item, 'orb', secondary);
            const year = _metricNormByKey(item, 'year', tertiary);

            frequency = _clamp((52 + mass * 210 + year * 30) * pitchMul, 28, 620);
            amplitude = _clamp(0.07 + mass * 0.5 + year * 0.2, 0.05, 0.75);
            phase = (year * Math.PI * 2 + orb * Math.PI * 0.6) % (Math.PI * 2);
            offset = _clamp((orb - 0.5) * 0.28, -0.22, 0.22);
            duration = _clamp((2.4 + orb * 3.2 + (1 - mass) * 1) * speedScale, 0.5, 26);
            envelopeAttack = _clamp(0.06 + (1 - mass) * 0.22 + orb * 0.1, 0.04, 0.62);
            envelopeRelease = _clamp(duration * (0.48 + orb * 0.32), 0.22, Math.max(0.3, duration - 0.05));
            modulationRate = _clamp(0.03 + mass * 0.9 + year * 0.25, 0.02, 1.8);
            modulationDepth = _clamp(frequency * (0.001 + orb * 0.004 + mass * 0.005), 0.02, 22);
            break;
        }

        case 'nasa_donki': {
            const body = _metricNormByKey(item, 'body', primary);
            const age = _metricNormByKey(item, 'age', secondary);
            const type = _metricNormByKey(item, 'type', tertiary);

            frequency = _clamp((48 + body * 190 + type * 140) * pitchMul, 24, 640);
            amplitude = _clamp(0.07 + body * 0.58 + type * 0.24, 0.05, 0.88);
            phase = (type * Math.PI * 2 + age * Math.PI * 0.6) % (Math.PI * 2);
            offset = _clamp((age - 0.5) * 0.36, -0.26, 0.26);
            duration = _clamp((1.5 + age * 3.1 + (1 - body) * 1.2) * speedScale, 0.35, 29);
            envelopeAttack = _clamp(0.05 + (1 - body) * 0.2, 0.03, 0.6);
            envelopeRelease = _clamp(duration * (0.42 + age * 0.33), 0.18, Math.max(0.26, duration - 0.05));
            modulationRate = _clamp(0.03 + type * 0.9 + body * 0.45, 0.02, 2.1);
            modulationDepth = _clamp(frequency * (0.001 + age * 0.006 + type * 0.006), 0.02, 24);
            break;
        }

        case 'nasa_apod': {
            const explain = _metricNormByKey(item, 'explain', primary);
            const title = _metricNormByKey(item, 'title', secondary);
            const day = _metricNormByKey(item, 'day', tertiary);
            const media = _metricNormByKey(item, 'media', tertiary);

            frequency = _clamp((44 + title * 200 + media * 95) * pitchMul, 22, 600);
            amplitude = _clamp(0.06 + explain * 0.46 + title * 0.2, 0.05, 0.78);
            phase = (day * Math.PI * 2 + media * Math.PI * 0.5) % (Math.PI * 2);
            offset = _clamp((title - 0.5) * 0.22, -0.18, 0.18);
            duration = _clamp((2 + explain * 3.5 + (1 - media) * 1.8) * speedScale, 0.5, 32);
            envelopeAttack = _clamp(0.06 + (1 - explain) * 0.22, 0.04, 0.7);
            envelopeRelease = _clamp(duration * (0.5 + day * 0.26), 0.22, Math.max(0.3, duration - 0.05));
            modulationRate = _clamp(0.02 + media * 0.7 + day * 0.4, 0.02, 1.6);
            modulationDepth = _clamp(frequency * (0.0008 + title * 0.003 + media * 0.003), 0.01, 20);
            break;
        }

        default: {
            frequency = _clamp(item.baseFrequency * pitchMul * (0.82 + primary * 0.36), 20, 1100);
            amplitude = _clamp(0.1 + primary * 0.85, 0.05, 1);
            phase = (secondary * Math.PI * 2) % (Math.PI * 2);
            offset = _clamp((tertiary - 0.5) * 1.1, -0.55, 0.55);
            duration = _clamp((1.2 + (1 - primary) * 2.2) * speedScale, 0.25, 24);
            envelopeAttack = _clamp(0.02 + (1 - secondary) * 0.28, 0.01, 0.7);
            envelopeRelease = _clamp(duration * (0.25 + primary * 0.55), 0.08, Math.max(0.12, duration - 0.03));
            modulationRate = _clamp(0.03 + primary * 1.7 + secondary * 0.7, 0.03, 4.5);
            modulationDepth = _clamp((0.004 + tertiary * 0.03) * frequency, 0.05, 120);
            break;
        }
    }

    const ampOut = _clamp(_finite(amplitude, 0.2), 0.01, 1);
    const freqOut = _clamp(_finite(frequency, 120), 20, 2000);
    const phaseOut = _finite(phase, 0) % (Math.PI * 2);
    const offsetOut = _clamp(_finite(offset, 0), -0.55, 0.55);
    const durationOut = _clamp(_finite(duration, 1), 0.12, 30);
    const attackOut = _clamp(_finite(envelopeAttack, 0.03), 0.005, durationOut);
    const releaseOut = _clamp(_finite(envelopeRelease, 0.2), 0.02, durationOut);
    const modRateOut = _clamp(_finite(modulationRate, 0.2), 0.01, 12);
    const modDepthOut = _clamp(_finite(modulationDepth, 0.1), 0, 200);

    return {
        timestamp: Date.now(),
        inputLabel: item.inputLabel,
        inputValue: item.inputValue,
        sourceMode,
        soundMode: track.soundMode,
        amplitude: ampOut,
        frequency: freqOut,
        phase: phaseOut,
        offset: offsetOut,
        duration: durationOut,
        envelopeAttack: attackOut,
        envelopeRelease: releaseOut,
        modulationRate: modRateOut,
        modulationDepth: modDepthOut,
        metrics: item.metrics,
    };
}

function _durationScale(speed: number): number {
    const safe = Math.max(0.0005, speed);
    return _clamp(Math.pow(1 / safe, 0.42), 0.35, 12);
}

function _metricNormByKey(item: SourceDatum, key: string, fallback: number): number {
    const metric = item.metrics.find(m => m.key === key);
    return metric ? _metricNorm(metric) : fallback;
}

function _metricNorm(metric: InputMetric): number {
    if (metric.min !== undefined && metric.max !== undefined && metric.max > metric.min) {
        return _clamp((metric.value - metric.min) / (metric.max - metric.min), 0, 1);
    }
    const abs = Math.abs(metric.value);
    if (abs <= 1) return _clamp((metric.value + 1) / 2, 0, 1);
    return _clamp(Math.log10(1 + abs) / 4, 0, 1);
}

function _buildMappingText(frame: SynthesisFrame): string {
    const metricLines = frame.metrics.map(m => {
        const affects = m.affects.join(', ');
        return `${_localizedMetricLabel(m.label).padEnd(18)} ${_fmtNum(m.value).padStart(8)}${m.unit ? ` ${m.unit}` : ''} -> ${affects}`;
    });

    const synthLines = [
        `amp=${_fmtNum(frame.amplitude)}  freq=${_fmtNum(frame.frequency)}Hz  phase=${_fmtNum(frame.phase)}rad`,
        `off=${_fmtNum(frame.offset)}  dur=${_fmtNum(frame.duration)}s  env(a=${_fmtNum(frame.envelopeAttack)} r=${_fmtNum(frame.envelopeRelease)})`,
        `mod(rate=${_fmtNum(frame.modulationRate)}Hz depth=${_fmtNum(frame.modulationDepth)})  mode=${frame.sourceMode}/${frame.soundMode}`,
    ];

    return [
        'API metric -> synthesis target',
        ...metricLines,
        '',
        'Current synthesis frame',
        ...synthLines,
    ].join('\n');
}

// ── Sound emission (discrete / continuous) ──────────────────────────────────

function _emitSound(track: Track, rt: TrackRuntime, frame: SynthesisFrame): void {
    if (track.soundMode === 'continuous') {
        _morphContinuous(track, rt, frame);
        return;
    }

    _disposeContinuous(rt, true);
    _playDiscrete(rt, frame, track.waveform);
}

function _playDiscrete(rt: TrackRuntime, frame: SynthesisFrame, waveform: OscillatorType): void {
    const ctx = getAudioContext();
    const now = ctx.currentTime;

    const phaseDelay = (frame.phase / (Math.PI * 2)) * Math.min(0.06, frame.duration * 0.2);
    const startAt = now + phaseDelay;

    const osc = ctx.createOscillator();
    osc.type = waveform;
    osc.frequency.value = frame.frequency;
    osc.detune.value = frame.offset * 35;

    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.type = 'sine';
    lfo.frequency.value = frame.modulationRate;
    lfoGain.gain.value = frame.modulationDepth;
    lfo.connect(lfoGain);
    lfoGain.connect(osc.frequency);

    const env = ctx.createGain();
    const base = Math.max(0, frame.offset * 0.08 + 0.005);
    env.gain.setValueAtTime(base, startAt);
    env.gain.linearRampToValueAtTime(frame.amplitude, startAt + frame.envelopeAttack);

    const releaseStart = Math.max(startAt + frame.envelopeAttack + 0.02, startAt + frame.duration - frame.envelopeRelease);
    env.gain.setValueAtTime(frame.amplitude, releaseStart);
    env.gain.linearRampToValueAtTime(0, startAt + frame.duration);

    // Explicit DC offset path (offset parameter affects waveform center).
    const offsetSource = ctx.createConstantSource();
    const offsetGain = ctx.createGain();
    offsetSource.offset.value = 1;
    offsetGain.gain.value = frame.offset * 0.08;

    osc.connect(env);
    env.connect(rt.gainNode);
    offsetSource.connect(offsetGain);
    offsetGain.connect(rt.gainNode);

    lfo.start(startAt);
    osc.start(startAt);
    offsetSource.start(startAt);

    const stopAt = startAt + frame.duration + 0.2;
    lfo.stop(stopAt);
    osc.stop(stopAt);
    offsetSource.stop(stopAt);
}

function _morphContinuous(track: Track, rt: TrackRuntime, frame: SynthesisFrame): void {
    const ctx = getAudioContext();
    const now = ctx.currentTime;

    const voice = _ensureContinuousVoice(track, rt, now);

    const glide = _clamp(frame.duration * 0.32, 0.12, 5.5);
    voice.osc.type = track.waveform;
    voice.osc.frequency.setTargetAtTime(frame.frequency, now, glide);

    const phaseDetune = Math.sin(frame.phase) * 25;
    voice.osc.detune.setTargetAtTime(phaseDetune + frame.offset * 30, now, glide * 0.5);

    voice.env.gain.setTargetAtTime(frame.amplitude, now, Math.max(0.05, frame.envelopeAttack));
    voice.offsetGain.gain.setTargetAtTime(frame.offset * 0.08, now, Math.max(0.05, frame.envelopeAttack));

    voice.lfo.frequency.setTargetAtTime(frame.modulationRate, now, 0.45);
    voice.lfoGain.gain.setTargetAtTime(frame.modulationDepth, now, 0.45);
}

function _ensureContinuousVoice(
    track: Track,
    rt: TrackRuntime,
    now: number,
): ContinuousVoice {
    if (rt.continuousVoice) return rt.continuousVoice;

    const ctx = getAudioContext();

    const osc = ctx.createOscillator();
    osc.type = track.waveform;
    osc.frequency.value = 110;

    const env = ctx.createGain();
    env.gain.setValueAtTime(0, now);

    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.15;

    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 1.8;

    const offsetSource = ctx.createConstantSource();
    offsetSource.offset.value = 1;

    const offsetGain = ctx.createGain();
    offsetGain.gain.value = 0;

    lfo.connect(lfoGain);
    lfoGain.connect(osc.frequency);

    osc.connect(env);
    env.connect(rt.gainNode);

    offsetSource.connect(offsetGain);
    offsetGain.connect(rt.gainNode);

    osc.start(now);
    lfo.start(now);
    offsetSource.start(now);

    rt.continuousVoice = { osc, lfo, lfoGain, env, offsetSource, offsetGain };
    return rt.continuousVoice;
}

function _disposeContinuous(rt: TrackRuntime, immediate = false): void {
    const voice = rt.continuousVoice;
    if (!voice) return;

    const ctx = getAudioContext();
    const now = ctx.currentTime;

    try {
        voice.env.gain.cancelScheduledValues(now);
        voice.env.gain.setTargetAtTime(0, now, immediate ? 0.03 : 0.2);
        voice.offsetGain.gain.cancelScheduledValues(now);
        voice.offsetGain.gain.setTargetAtTime(0, now, immediate ? 0.03 : 0.2);
    } catch {
        // no-op
    }

    const stopAt = immediate ? now + 0.08 : now + 0.5;
    try { voice.osc.stop(stopAt); } catch { /* already stopped */ }
    try { voice.lfo.stop(stopAt); } catch { /* already stopped */ }
    try { voice.offsetSource.stop(stopAt); } catch { /* already stopped */ }

    setTimeout(() => {
        voice.osc.disconnect();
        voice.lfo.disconnect();
        voice.lfoGain.disconnect();
        voice.env.disconnect();
        voice.offsetSource.disconnect();
        voice.offsetGain.disconnect();
    }, immediate ? 120 : 650);

    rt.continuousVoice = null;
}

// ── Live loaders ─────────────────────────────────────────────────────────────

async function loadEarthquakesLive(): Promise<SourceDatum[]> {
    if (!state.quakes.length) return [];

    const byTime = state.quakes
        .slice()
        .sort((a, b) => a.time - b.time)
        .slice(-120);

    return byTime.map(q => {
        const ageHours = _clamp((Date.now() - q.time) / 3_600_000, 0, 48);
        const mag = q.mag;
        const depth = q.depth;

        return {
            inputKey: 'mag',
            inputLabel: 'Magnitude',
            inputValue: mag,
            inputUnit: 'Mw',
            norm: _safeNorm(mag, 0, 8),
            baseFrequency: q.freq,
            context: `${q.place} | ${_fmtIsoMinute(q.time)}Z | depth ${depth.toFixed(1)}km`,
            sourceMode: 'live',
            metrics: [
                _metric('mag', 'Magnitude', mag, 'Mw', 0, 8, ['amplitude', 'frequency', 'duration']),
                _metric('depth', 'Depth', depth, 'km', 0, 700, ['envelope', 'offset']),
                _metric('age', 'Age', ageHours, 'h', 0, 48, ['phase', 'modulation']),
            ],
        };
    });
}

async function loadCwaEarthquakes(): Promise<SourceDatum[]> {
    const now = new Date();
    const start = new Date(now.getTime() - 36 * 60 * 60 * 1000).toISOString();
    const end = now.toISOString();
    const url = [
        'https://earthquake.usgs.gov/fdsnws/event/1/query',
        '?format=geojson',
        `&starttime=${encodeURIComponent(start)}`,
        `&endtime=${encodeURIComponent(end)}`,
        '&minlatitude=21',
        '&maxlatitude=26',
        '&minlongitude=119',
        '&maxlongitude=123',
        '&orderby=time',
        '&limit=120',
    ].join('');

    const json = await _cachedJson<{ features?: any[] }>(url, 6 * 60_000, async () => {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Taiwan quake stream ${res.status}`);
        return res.json() as Promise<{ features?: any[] }>;
    });

    const features = Array.isArray(json.features) ? json.features : [];
    if (!features.length) return [];

    const byTime = features
        .filter(f => f?.properties?.mag !== null && Number.isFinite(f?.properties?.mag))
        .sort((a, b) => Number(a.properties.time) - Number(b.properties.time))
        .slice(-120);

    return byTime.map((f, i) => {
        const mag = Number(f.properties.mag) || 0;
        const time = Number(f.properties.time) || Date.now();
        const depth = Number(f.geometry?.coordinates?.[2]) || 0;
        const ageHours = _clamp((Date.now() - time) / 3_600_000, 0, 72);
        const place = String(f.properties.place || `taiwan-quake-${i + 1}`);

        return {
            inputKey: 'mag',
            inputLabel: 'Magnitude',
            inputValue: mag,
            inputUnit: 'Mw',
            norm: _safeNorm(mag, 0, 8),
            baseFrequency: 58 + _safeNorm(mag, 0, 8) * 190,
            context: `${place} | ${_fmtIsoMinute(time)}Z | depth ${depth.toFixed(1)}km | CWA尺度`,
            sourceMode: 'live',
            metrics: [
                _metric('mag', 'Magnitude', mag, 'Mw', 0, 8, ['amplitude', 'frequency', 'duration']),
                _metric('depth', 'Depth', depth, 'km', 0, 700, ['envelope', 'offset']),
                _metric('age', 'Age', ageHours, 'h', 0, 72, ['phase', 'modulation']),
            ],
        };
    });
}

async function loadTaiwanAqi(): Promise<SourceDatum[]> {
    const url = [
        'https://data.moenv.gov.tw/api/v2/aqx_p_432',
        '?api_key=af57253c-e838-46da-a1f5-12b43afd75f3',
        '&limit=1000',
        '&sort=ImportDate%20desc',
        '&format=json',
    ].join('');

    const rows = await _cachedJson<MoenvAqiRow[]>(url, 30 * 60_000, async () => {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`MOENV AQI ${res.status}`);
        return res.json() as Promise<MoenvAqiRow[]>;
    });

    if (!Array.isArray(rows) || rows.length === 0) return [];

    const taipeiRows = rows.filter(r => r.county === '臺北市' || r.county === '新北市');
    const pool = taipeiRows.length ? taipeiRows : rows;
    let anchor = pool[0];
    if (AQI_ANCHOR_SITE) {
        const found = pool.find(r => r.sitename === AQI_ANCHOR_SITE);
        if (found) anchor = found;
    }
    AQI_ANCHOR_SITE = anchor.sitename;

    const aqi = parseFloat(anchor.aqi) || 0;
    const pm25 = parseFloat(anchor['pm2.5']) || 0;
    const o3 = parseFloat(anchor.o3_8hr) || 0;
    const pm10 = parseFloat(anchor.pm10) || 0;
    const minute = _minuteFromSlashTime(anchor.publishtime);

    const datum: SourceDatum = {
        inputKey: 'aqi',
        inputLabel: 'AQI',
        inputValue: aqi,
        inputUnit: '',
        norm: _safeNorm(aqi, 0, 300),
        baseFrequency: 74 + _safeNorm(pm25, 0, 80) * 180,
        context: `${anchor.county} ${anchor.sitename} | ${anchor.publishtime} | PM2.5 ${pm25.toFixed(1)}`,
        sourceMode: 'live',
        metrics: [
            _metric('aqi', 'AQI', aqi, '', 0, 300, ['amplitude', 'frequency']),
            _metric('pm25', 'PM2.5', pm25, 'ug/m3', 0, 120, ['offset', 'envelope']),
            _metric('o3', 'O3(8h)', o3, 'ppb', 0, 160, ['modulation', 'phase']),
            _metric('minute', 'Minute', minute, 'm', 0, 59, ['duration']),
            _metric('pm10', 'PM10', pm10, 'ug/m3', 0, 250, ['phase']),
        ],
    };

    return _pushLiveSeries('taiwan_aqi', datum);
}

async function loadWaqiAsia(): Promise<SourceDatum[]> {
    const keyword = encodeURIComponent('Asia');
    const url = `https://api.waqi.info/search/?token=demo&keyword=${keyword}`;

    const payload = await _cachedJson<WaqiSearchResponse>(url, 12 * 60_000, async () => {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`WAQI search ${res.status}`);
        return res.json() as Promise<WaqiSearchResponse>;
    });

    if (payload.status !== 'ok' || !payload.data?.length) return [];

    const picks = payload.data
        .filter(row => row.station?.country && ['TW', 'KR', 'IN', 'TH', 'ID', 'PH', 'JP', 'VN'].includes(row.station.country))
        .slice(0, 60);

    const source = picks.length ? picks : payload.data.slice(0, 60);
    return source.map((row, i) => {
        const aqi = parseFloat(row.aqi) || 0;
        const minute = row.time?.stime ? _minuteFromDashTime(row.time.stime) : ((row.time?.vtime ?? 0) % 3600) / 60;
        const city = row.station?.name?.split(';')[0]?.trim() || `asia-city-${i + 1}`;
        const country = row.station?.country || 'AS';
        const uid = row.uid || i;

        return {
            inputKey: 'aqi',
            inputLabel: 'AQI',
            inputValue: aqi,
            inputUnit: '',
            norm: _safeNorm(aqi, 0, 300),
            baseFrequency: 78 + _safeNorm(uid, 0, 30000) * 210,
            context: `${city} (${country}) | AQI ${aqi.toFixed(0)} | WAQI demo`,
            sourceMode: 'live',
            metrics: [
                _metric('aqi', 'AQI', aqi, '', 0, 300, ['amplitude', 'frequency']),
                _metric('uid', 'UID', uid, '', 0, 30000, ['phase', 'offset']),
                _metric('minute', 'Minute', minute, 'm', 0, 59, ['duration', 'modulation', 'envelope']),
            ],
        };
    });
}

async function loadNasaDonki(): Promise<SourceDatum[]> {
    const now = new Date();
    const start = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
    const startDate = start.toISOString().slice(0, 10);
    const endDate = now.toISOString().slice(0, 10);
    const url = `https://api.nasa.gov/DONKI/notifications?api_key=DEMO_KEY&startDate=${startDate}&endDate=${endDate}`;

    const rows = await _cachedJson<NasaDonkiItem[]>(url, 20 * 60_000, async () => {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`NASA DONKI ${res.status}`);
        return res.json() as Promise<NasaDonkiItem[]>;
    });

    if (!Array.isArray(rows) || rows.length === 0) return [];

    return rows.slice(-100).map((row, i) => {
        const bodyLen = (row.messageBody || '').length;
        const typeNum = _hashNum(row.messageType || 'report');
        const time = row.messageIssueTime ? Date.parse(row.messageIssueTime) : Date.now();
        const ageHours = _clamp((Date.now() - time) / 3_600_000, 0, 14 * 24);
        const minute = new Date(time).getUTCMinutes();

        return {
            inputKey: 'body',
            inputLabel: 'Body',
            inputValue: bodyLen,
            inputUnit: 'char',
            norm: _safeNorm(bodyLen, 80, 8000),
            baseFrequency: 62 + _safeNorm(typeNum, 0, 1000) * 210,
            context: `${row.messageType || `DONKI-${i + 1}`} | ${_fmtIsoMinute(time)}Z | ${bodyLen} chars`,
            sourceMode: 'live',
            metrics: [
                _metric('body', 'BodyLen', bodyLen, 'char', 0, 9000, ['amplitude', 'frequency']),
                _metric('age', 'Age', ageHours, 'h', 0, 14 * 24, ['duration', 'envelope']),
                _metric('type', 'Type#', typeNum, '', 0, 1000, ['offset', 'modulation']),
                _metric('minute', 'Minute', minute, 'm', 0, 59, ['phase']),
            ],
        };
    });
}

async function loadNasaApod(): Promise<SourceDatum[]> {
    const now = new Date();
    const start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const startDate = start.toISOString().slice(0, 10);
    const endDate = now.toISOString().slice(0, 10);
    const url = `https://api.nasa.gov/planetary/apod?api_key=DEMO_KEY&start_date=${startDate}&end_date=${endDate}`;

    const rows = await _cachedJson<NasaApodItem[]>(url, 60 * 60_000, async () => {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`NASA APOD ${res.status}`);
        return res.json() as Promise<NasaApodItem[]>;
    });

    if (!Array.isArray(rows) || rows.length === 0) return [];

    const ordered = rows
        .slice()
        .sort((a, b) => (Date.parse(a.date || '') || 0) - (Date.parse(b.date || '') || 0));

    return ordered.map((row, i) => {
        const titleLen = (row.title || '').length;
        const expLen = (row.explanation || '').length;
        const date = row.date || startDate;
        const ts = Date.parse(`${date}T00:00:00Z`) || Date.now();
        const day = new Date(ts).getUTCDate();
        const media = _hashNum(row.media_type || 'image');

        return {
            inputKey: 'explain',
            inputLabel: 'APOD text',
            inputValue: expLen,
            inputUnit: 'char',
            norm: _safeNorm(expLen, 100, 9000),
            baseFrequency: 56 + _safeNorm(titleLen, 0, 120) * 150 + _safeNorm(media, 0, 1000) * 80,
            context: `${date} | ${(row.title || `APOD-${i + 1}`).slice(0, 52)}`,
            sourceMode: 'live',
            metrics: [
                _metric('explain', 'ExplainLen', expLen, 'char', 0, 10000, ['amplitude', 'duration']),
                _metric('title', 'TitleLen', titleLen, 'char', 0, 140, ['frequency', 'envelope']),
                _metric('day', 'Day', day, '', 1, 31, ['phase', 'modulation']),
                _metric('media', 'Media#', media, '', 0, 1000, ['offset']),
            ],
        };
    });
}

async function loadNtuBuildings(): Promise<SourceDatum[]> {
    const url = [
        'https://map.ntu.edu.tw/geontupublic/wfs',
        '?service=WFS',
        '&version=1.0.0',
        '&request=GetFeature',
        '&typeName=ntu_build_name',
        '&maxFeatures=600',
        '&outputFormat=application/json',
    ].join('');

    const json = await _cachedJson<NtuWfsFeatureCollection>(url, 15 * 60_000, async () => {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`NTU WFS ${res.status}`);
        return res.json() as Promise<NtuWfsFeatureCollection>;
    });

    const named = json.features
        .map((f, i) => {
            const [x, y] = f.geometry.coordinates;
            const zh = (f.properties.bldg_ch ?? '').trim();
            const en = (f.properties.bldg_en ?? '').trim();
            const name = zh || en || `building-${i + 1}`;
            const codeNum = _codeNumber(name);
            return { x, y, name, codeNum };
        })
        .filter(f => f.name.trim().length > 0);
    if (!named.length) return [];

    const xs = named.map(f => f.x);
    const ys = named.map(f => f.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    const centerX = (minX + maxX) * 0.5;
    const centerY = (minY + maxY) * 0.5;
    const byCenter = named
        .slice()
        .sort((a, b) => ((a.x - centerX) ** 2 + (a.y - centerY) ** 2) - ((b.x - centerX) ** 2 + (b.y - centerY) ** 2));

    let anchor = byCenter[0];
    if (NTU_ANCHOR_NAME) {
        const found = named.find(f => f.name === NTU_ANCHOR_NAME);
        if (found) anchor = found;
    }
    NTU_ANCHOR_NAME = anchor.name;

    const now = new Date();
    const minuteOfDay = now.getHours() * 60 + now.getMinutes();
    const xNorm = _safeNorm(anchor.x, minX, maxX);
    const yNorm = _safeNorm(anchor.y, minY, maxY);

    const datum: SourceDatum = {
        inputKey: 'minute',
        inputLabel: 'Minute',
        inputValue: minuteOfDay,
        inputUnit: 'min',
        norm: _safeNorm(minuteOfDay, 0, 1439),
        baseFrequency: 90 + xNorm * 190 + yNorm * 25,
        context: `${anchor.name} | ${now.toISOString().slice(11, 16)} local | fixed-site temporal scan`,
        sourceMode: 'live',
        metrics: [
            _metric('x', 'X', anchor.x, 'm', minX, maxX, ['frequency', 'offset']),
            _metric('y', 'Y', anchor.y, 'm', minY, maxY, ['phase', 'modulation']),
            _metric('minute', 'Minute', minuteOfDay, 'm', 0, 1439, ['duration', 'envelope', 'amplitude']),
        ],
    };

    return _pushLiveSeries('ntu_buildings', datum);
}

async function loadTaipeiNoiseStations(): Promise<SourceDatum[]> {
    const rawUrl =
        'https://data.taipei/api/frontstage/tpeod/dataset/resource.download?rid=ac5e1557-5590-4bec-8709-e5f0f8d4bd1e';
    const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(rawUrl)}`;

    const csv = await _cachedText(proxyUrl, 60 * 60_000, async () => {
        const res = await fetch(proxyUrl);
        if (!res.ok) throw new Error(`Taipei noise CSV ${res.status}`);
        const buf = await res.arrayBuffer();
        return _decodeBig5(buf);
    });

    const lines = csv
        .split(/\r?\n/)
        .map(s => s.trim())
        .filter(Boolean);

    if (lines.length < 2) return [];

    const rows = lines
        .slice(1)
        .map(_parseCsvLine)
        .filter(cols => cols.length >= 7)
        .map(cols => {
            const name = cols[0].trim();
            const stationId = cols[1].trim();
            const address = cols[2].trim();
            const zoneRaw = cols[3].trim();
            const lon = parseFloat(cols[5]);
            const lat = parseFloat(cols[6]);
            return { name, stationId, address, zoneRaw, lon, lat };
        })
        .filter(r => Number.isFinite(r.lon) && Number.isFinite(r.lat));

    if (!rows.length) return [];

    const sortedRows = rows.slice().sort((a, b) => a.stationId.localeCompare(b.stationId, 'en', { numeric: true }));
    let anchor = sortedRows[0];
    if (NOISE_ANCHOR_ID) {
        const found = sortedRows.find(r => r.stationId === NOISE_ANCHOR_ID);
        if (found) anchor = found;
    }
    NOISE_ANCHOR_ID = anchor.stationId;

    const zone = _zoneToLevel(anchor.zoneRaw);
    const stationNum = parseInt(anchor.stationId.replace(/\D+/g, ''), 10) || 0;
    const lonNorm = _safeNorm(anchor.lon, 121.45, 121.66);
    const latNorm = _safeNorm(anchor.lat, 24.95, 25.22);
    const now = new Date();
    const minute = now.getMinutes();

    const datum: SourceDatum = {
        inputKey: 'minute',
        inputLabel: 'Minute',
        inputValue: minute,
        inputUnit: 'm',
        norm: _safeNorm(minute, 0, 59),
        baseFrequency: 85 + lonNorm * 170 + latNorm * 70,
        context: `${anchor.name || 'station'} (${anchor.stationId}) | ${anchor.address} | minute ${minute}`,
        sourceMode: 'live',
        metrics: [
            _metric('zone', 'Zone', zone, '', 1, 4, ['amplitude', 'duration']),
            _metric('lon', 'Lon', anchor.lon, '', 121.45, 121.66, ['frequency', 'phase']),
            _metric('minute', 'Minute', minute, 'm', 0, 59, ['offset', 'modulation', 'envelope']),
            _metric('station', 'Station#', stationNum, '', 0, 999999, ['phase']),
        ],
    };

    return _pushLiveSeries('taipei_noise_stations', datum);
}

async function loadTaipeiRain(): Promise<SourceDatum[]> {
    const url =
        'https://wic.heo.taipei/OpenData/API/Rain/Get?stationNo=&loginId=open_rain&dataKey=85452C1D';
    const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`;

    const wrap = await _cachedJson<AllOriginsGetResponse>(proxyUrl, 60_000, async () => {
        const res = await fetch(proxyUrl);
        if (!res.ok) throw new Error(`Taipei rain proxy ${res.status}`);
        return res.json() as Promise<AllOriginsGetResponse>;
    });

    const payload = JSON.parse(wrap.contents) as RainApiResponse;
    if (!payload.data?.length) return [];

    const rows = payload.data.slice();
    if (!rows.length) return [];

    let anchor = rows[0];
    if (RAIN_ANCHOR_NO) {
        const found = rows.find(r => r.stationNo === RAIN_ANCHOR_NO);
        if (found) anchor = found;
    }
    RAIN_ANCHOR_NO = anchor.stationNo;

    const rain = Number(anchor.rain) || 0;
    const station = parseInt(anchor.stationNo, 10) || 0;
    const minute = _minuteOfRecTime(anchor.recTime);

    const datum: SourceDatum = {
        inputKey: 'rain',
        inputLabel: 'Rain',
        inputValue: rain,
        inputUnit: 'mm',
        norm: _safeNorm(rain, 0, 30),
        baseFrequency: 80 + _safeNorm(station, 0, 50) * 180,
        context: `${anchor.stationName} (${anchor.stationNo}) | ${_fmtRainTime(anchor.recTime)} | rain ${rain.toFixed(1)}mm`,
        sourceMode: 'live',
        metrics: [
            _metric('rain', 'Rain', rain, 'mm', 0, 30, ['amplitude', 'frequency']),
            _metric('station', 'Station#', station, '', 0, 50, ['phase', 'offset']),
            _metric('minute', 'Minute', minute, 'm', 0, 59, ['duration', 'modulation', 'envelope']),
        ],
    };

    return _pushLiveSeries('taipei_rain', datum);
}

async function loadOpenMeteo(): Promise<SourceDatum[]> {
    const url = [
        'https://api.open-meteo.com/v1/forecast',
        '?latitude=25.0376',
        '&longitude=121.5637',
        '&hourly=temperature_2m,precipitation,wind_speed_10m',
        '&forecast_days=2',
        '&timezone=Asia%2FTaipei',
    ].join('');

    const data = await _cachedJson<OpenMeteoResponse>(url, 30 * 60_000, async () => {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
        return res.json() as Promise<OpenMeteoResponse>;
    });

    const t = data.hourly.temperature_2m;
    const p = data.hourly.precipitation;
    const w = data.hourly.wind_speed_10m;
    const times = data.hourly.time;

    const n = Math.min(times.length, t.length, p.length, w.length, 72);
    if (n === 0) return [];

    const out: SourceDatum[] = [];
    for (let i = 0; i < n; i++) {
        const temp = Number(t[i]) || 0;
        const rain = Number(p[i]) || 0;
        const wind = Number(w[i]) || 0;

        const tempNorm = _safeNorm(temp, 0, 36);
        const windNorm = _safeNorm(wind, 0, 20);

        out.push({
            inputKey: 'temp',
            inputLabel: 'Temp',
            inputValue: temp,
            inputUnit: 'C',
            norm: _clamp(tempNorm * 0.55 + windNorm * 0.45, 0, 1),
            baseFrequency: 95 + tempNorm * 180,
            context: `${times[i]?.replace('T', ' ').slice(0, 16) ?? `slot-${i + 1}`} | rain ${rain.toFixed(1)}mm | wind ${wind.toFixed(1)}m/s`,
            sourceMode: 'live',
            metrics: [
                _metric('temp', 'Temp', temp, 'C', 0, 36, ['frequency', 'amplitude']),
                _metric('rain', 'Rain', rain, 'mm', 0, 20, ['offset', 'envelope']),
                _metric('wind', 'Wind', wind, 'm/s', 0, 20, ['modulation', 'duration', 'phase']),
            ],
        });
    }

    return out;
}

async function loadGdeltEvents(): Promise<SourceDatum[]> {
    const url =
        'https://api.gdeltproject.org/api/v2/doc/doc?query=protest%20OR%20strike%20OR%20demonstration&mode=TimelineVolRaw&format=json';

    const json = await _cachedJson<GdeltResponse>(url, 20 * 60_000, async () => {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`GDELT ${res.status}`);
        return res.json() as Promise<GdeltResponse>;
    });

    const series = json.timeline?.find(s => s.data?.length)?.data ?? [];
    if (!series.length) return [];

    const max = Math.max(...series.map(p => p.value), 1);
    return series.map((point, i) => {
        const value = point.value;
        const dayIndex = i;
        const dayOfMonth = _dayOfGdelt(point.date);

        return {
            inputKey: 'articles',
            inputLabel: 'Articles',
            inputValue: value,
            inputUnit: 'count',
            norm: _safeNorm(value, 0, max),
            baseFrequency: 95 + _safeNorm(value, 0, max) * 240,
            context: `${_fmtGdeltDate(point.date)} | ${value} articles`,
            sourceMode: 'live',
            metrics: [
                _metric('count', 'Count', value, '', 0, max, ['amplitude', 'frequency']),
                _metric('day', 'DayIdx', dayIndex, '', 0, Math.max(1, series.length - 1), ['phase', 'duration']),
                _metric('dom', 'DayOfMon', dayOfMonth, '', 1, 31, ['offset', 'modulation', 'envelope']),
            ],
        };
    });
}

async function loadExoplanets(): Promise<SourceDatum[]> {
    const query = encodeURIComponent(
        'select top 120 pl_name,disc_year,pl_bmasse,pl_orbper from pscomppars order by disc_year desc',
    );
    const base = `http://exoplanetarchive.ipac.caltech.edu/TAP/sync?query=${query}&format=json`;
    const proxy = `https://r.jina.ai/${base}`;

    const wrapped = await _cachedText(proxy, 30 * 60_000, async () => {
        const res = await fetch(proxy);
        if (!res.ok) throw new Error(`Exoplanet proxy ${res.status}`);
        return res.text();
    });

    const rows = _parseJinaJsonArray<ExoplanetRow>(wrapped);
    if (!rows.length) return [];

    const ordered = rows
        .slice()
        .sort((a, b) => (a.disc_year ?? 0) - (b.disc_year ?? 0));

    const yearMin = Math.min(...ordered.map(r => r.disc_year ?? 2010));
    const yearMax = Math.max(...ordered.map(r => r.disc_year ?? 2010));

    return ordered.map((row, i) => {
        const mass = row.pl_bmasse && row.pl_bmasse > 0 ? row.pl_bmasse : 1;
        const orb = row.pl_orbper && row.pl_orbper > 0 ? row.pl_orbper : 1;
        const year = row.disc_year ?? yearMin;
        const massNorm = _clamp(Math.log10(1 + mass) / Math.log10(1 + 3000), 0, 1);

        return {
            inputKey: 'mass',
            inputLabel: 'Mass',
            inputValue: mass,
            inputUnit: 'mE',
            norm: massNorm,
            baseFrequency: 80 + massNorm * 340,
            context: `${row.pl_name || `planet-${i + 1}`} | y${year} | orb ${orb.toFixed(1)}d`,
            sourceMode: 'live',
            metrics: [
                _metric('mass', 'Mass', mass, 'mE', 0, 3000, ['frequency', 'amplitude']),
                _metric('orb', 'OrbitalP', orb, 'd', 0, 4000, ['duration', 'modulation']),
                _metric('year', 'Year', year, '', yearMin, yearMax, ['phase', 'offset', 'envelope']),
            ],
        };
    });
}

// ── Snapshot data ────────────────────────────────────────────────────────────

function _snapshotFor(source: DataSourceId): SourceDatum[] {
    const saved = _snapshotFromStore(source);
    if (saved.length) return saved;

    switch (source) {
        case 'earthquake': {
            if (state.quakes.length) {
                return state.quakes.slice(0, 40).map(q => ({
                    inputKey: 'mag',
                    inputLabel: 'Magnitude',
                    inputValue: q.mag,
                    inputUnit: 'Mw',
                    norm: _safeNorm(q.mag, 0, 8),
                    baseFrequency: q.freq,
                    context: `snapshot | ${q.place} | ${_fmtIsoMinute(q.time)}Z`,
                    sourceMode: 'snapshot',
                    metrics: [
                        _metric('mag', 'Magnitude', q.mag, 'Mw', 0, 8, ['amplitude', 'frequency', 'duration']),
                        _metric('depth', 'Depth', q.depth, 'km', 0, 700, ['envelope', 'offset']),
                        _metric('age', 'Age', _clamp((Date.now() - q.time) / 3_600_000, 0, 48), 'h', 0, 48, ['phase', 'modulation']),
                    ],
                }));
            }

            return [
                _snapDatum('Magnitude', 'mag', 1.8, 'Mw', 0.23, 72, 'snapshot | Pacific Rim archive', [
                    _metric('mag', 'Magnitude', 1.8, 'Mw', 0, 8, ['amplitude', 'frequency', 'duration']),
                    _metric('depth', 'Depth', 40, 'km', 0, 700, ['envelope', 'offset']),
                    _metric('age', 'Age', 12, 'h', 0, 48, ['phase', 'modulation']),
                ]),
                _snapDatum('Magnitude', 'mag', 3.2, 'Mw', 0.4, 118, 'snapshot | Pacific Rim archive', [
                    _metric('mag', 'Magnitude', 3.2, 'Mw', 0, 8, ['amplitude', 'frequency', 'duration']),
                    _metric('depth', 'Depth', 140, 'km', 0, 700, ['envelope', 'offset']),
                    _metric('age', 'Age', 8, 'h', 0, 48, ['phase', 'modulation']),
                ]),
                _snapDatum('Magnitude', 'mag', 4.5, 'Mw', 0.56, 168, 'snapshot | Pacific Rim archive', [
                    _metric('mag', 'Magnitude', 4.5, 'Mw', 0, 8, ['amplitude', 'frequency', 'duration']),
                    _metric('depth', 'Depth', 33, 'km', 0, 700, ['envelope', 'offset']),
                    _metric('age', 'Age', 4, 'h', 0, 48, ['phase', 'modulation']),
                ]),
            ];
        }

        case 'cwa_earthquake':
            return [
                _snapDatum('Magnitude', 'mag', 3.1, 'Mw', 0.39, 118, 'snapshot | CWA scale | 花蓮近海', [
                    _metric('mag', 'Magnitude', 3.1, 'Mw', 0, 8, ['amplitude', 'frequency', 'duration']),
                    _metric('depth', 'Depth', 18, 'km', 0, 700, ['envelope', 'offset']),
                    _metric('age', 'Age', 3, 'h', 0, 72, ['phase', 'modulation']),
                ]),
                _snapDatum('Magnitude', 'mag', 4.2, 'Mw', 0.52, 154, 'snapshot | CWA scale | 宜蘭外海', [
                    _metric('mag', 'Magnitude', 4.2, 'Mw', 0, 8, ['amplitude', 'frequency', 'duration']),
                    _metric('depth', 'Depth', 64, 'km', 0, 700, ['envelope', 'offset']),
                    _metric('age', 'Age', 7, 'h', 0, 72, ['phase', 'modulation']),
                ]),
                _snapDatum('Magnitude', 'mag', 2.7, 'Mw', 0.33, 102, 'snapshot | CWA scale | 台東近海', [
                    _metric('mag', 'Magnitude', 2.7, 'Mw', 0, 8, ['amplitude', 'frequency', 'duration']),
                    _metric('depth', 'Depth', 11, 'km', 0, 700, ['envelope', 'offset']),
                    _metric('age', 'Age', 10, 'h', 0, 72, ['phase', 'modulation']),
                ]),
            ];

        case 'ntu_buildings':
            return [
                _snapDatum('X coord', 'x', 303120, 'm', 0.35, 152, 'snapshot | NTU 文學院', [
                    _metric('x', 'X', 303120, 'm', 302800, 305500, ['frequency', 'phase']),
                    _metric('y', 'Y', 2769120, 'm', 2767600, 2770700, ['offset', 'modulation']),
                    _metric('code', 'Code#', 5, '', 0, 100, ['duration', 'envelope']),
                ]),
                _snapDatum('X coord', 'x', 303540, 'm', 0.47, 176, 'snapshot | NTU 土木系', [
                    _metric('x', 'X', 303540, 'm', 302800, 305500, ['frequency', 'phase']),
                    _metric('y', 'Y', 2768840, 'm', 2767600, 2770700, ['offset', 'modulation']),
                    _metric('code', 'Code#', 7, '', 0, 100, ['duration', 'envelope']),
                ]),
                _snapDatum('X coord', 'x', 304880, 'm', 0.63, 218, 'snapshot | NTU 全球變遷中心', [
                    _metric('x', 'X', 304880, 'm', 302800, 305500, ['frequency', 'phase']),
                    _metric('y', 'Y', 2768320, 'm', 2767600, 2770700, ['offset', 'modulation']),
                    _metric('code', 'Code#', 41, '', 0, 100, ['duration', 'envelope']),
                ]),
            ];

        case 'taipei_noise_stations':
            return [
                _snapDatum('Zone', 'zone', 1, 'class', 0.22, 128, 'snapshot | 湖田點', [
                    _metric('zone', 'Zone', 1, '', 1, 4, ['amplitude', 'duration']),
                    _metric('lon', 'Lon', 121.538867, '', 121.45, 121.66, ['frequency', 'phase']),
                    _metric('station', 'Station#', 2534420011, '', 0, 9999999999, ['offset', 'modulation']),
                ]),
                _snapDatum('Zone', 'zone', 2, 'class', 0.48, 192, 'snapshot | 永樂點', [
                    _metric('zone', 'Zone', 2, '', 1, 4, ['amplitude', 'duration']),
                    _metric('lon', 'Lon', 121.509977, '', 121.45, 121.66, ['frequency', 'phase']),
                    _metric('station', 'Station#', 2533820202, '', 0, 9999999999, ['offset', 'modulation']),
                ]),
                _snapDatum('Zone', 'zone', 3, 'class', 0.74, 244, 'snapshot | 福星點', [
                    _metric('zone', 'Zone', 3, '', 1, 4, ['amplitude', 'duration']),
                    _metric('lon', 'Lon', 121.508, '', 121.45, 121.66, ['frequency', 'phase']),
                    _metric('station', 'Station#', 2533720013, '', 0, 9999999999, ['offset', 'modulation']),
                ]),
            ];

        case 'taipei_rain':
            return [
                _snapDatum('Rain', 'rain', 0.6, 'mm', 0.02, 86, 'snapshot | 湖田國小', [
                    _metric('rain', 'Rain', 0.6, 'mm', 0, 30, ['amplitude', 'frequency']),
                    _metric('station', 'Station#', 1, '', 0, 50, ['phase', 'offset']),
                    _metric('minute', 'Minute', 10, 'm', 0, 59, ['duration', 'modulation', 'envelope']),
                ]),
                _snapDatum('Rain', 'rain', 2.6, 'mm', 0.09, 112, 'snapshot | 桃源國中', [
                    _metric('rain', 'Rain', 2.6, 'mm', 0, 30, ['amplitude', 'frequency']),
                    _metric('station', 'Station#', 3, '', 0, 50, ['phase', 'offset']),
                    _metric('minute', 'Minute', 0, 'm', 0, 59, ['duration', 'modulation', 'envelope']),
                ]),
                _snapDatum('Rain', 'rain', 4.5, 'mm', 0.15, 130, 'snapshot | 陽明高中', [
                    _metric('rain', 'Rain', 4.5, 'mm', 0, 30, ['amplitude', 'frequency']),
                    _metric('station', 'Station#', 5, '', 0, 50, ['phase', 'offset']),
                    _metric('minute', 'Minute', 0, 'm', 0, 59, ['duration', 'modulation', 'envelope']),
                ]),
            ];

        case 'taiwan_aqi':
            return [
                _snapDatum('AQI', 'aqi', 38, '', 0.13, 138, 'snapshot | 臺北 | PM2.5 15', [
                    _metric('aqi', 'AQI', 38, '', 0, 300, ['amplitude', 'frequency']),
                    _metric('pm25', 'PM2.5', 15, 'ug/m3', 0, 120, ['offset', 'envelope']),
                    _metric('o3', 'O3(8h)', 41, 'ppb', 0, 160, ['modulation', 'phase']),
                    _metric('minute', 'Minute', 12, 'm', 0, 59, ['duration']),
                    _metric('pm10', 'PM10', 18, 'ug/m3', 0, 250, ['phase']),
                ]),
                _snapDatum('AQI', 'aqi', 62, '', 0.21, 164, 'snapshot | 新北 | PM2.5 24', [
                    _metric('aqi', 'AQI', 62, '', 0, 300, ['amplitude', 'frequency']),
                    _metric('pm25', 'PM2.5', 24, 'ug/m3', 0, 120, ['offset', 'envelope']),
                    _metric('o3', 'O3(8h)', 52, 'ppb', 0, 160, ['modulation', 'phase']),
                    _metric('minute', 'Minute', 24, 'm', 0, 59, ['duration']),
                    _metric('pm10', 'PM10', 39, 'ug/m3', 0, 250, ['phase']),
                ]),
                _snapDatum('AQI', 'aqi', 112, '', 0.37, 208, 'snapshot | 高雄 | PM2.5 46', [
                    _metric('aqi', 'AQI', 112, '', 0, 300, ['amplitude', 'frequency']),
                    _metric('pm25', 'PM2.5', 46, 'ug/m3', 0, 120, ['offset', 'envelope']),
                    _metric('o3', 'O3(8h)', 66, 'ppb', 0, 160, ['modulation', 'phase']),
                    _metric('minute', 'Minute', 36, 'm', 0, 59, ['duration']),
                    _metric('pm10', 'PM10', 86, 'ug/m3', 0, 250, ['phase']),
                ]),
            ];

        case 'waqi_asia':
            return [
                _snapDatum('AQI', 'aqi', 165, '', 0.55, 232, 'snapshot | Bengaluru (IN) | WAQI demo', [
                    _metric('aqi', 'AQI', 165, '', 0, 300, ['amplitude', 'frequency']),
                    _metric('uid', 'UID', 12441, '', 0, 30000, ['phase', 'offset']),
                    _metric('minute', 'Minute', 0, 'm', 0, 59, ['duration', 'modulation', 'envelope']),
                ]),
                _snapDatum('AQI', 'aqi', 102, '', 0.34, 186, 'snapshot | Jakarta (ID) | WAQI demo', [
                    _metric('aqi', 'AQI', 102, '', 0, 300, ['amplitude', 'frequency']),
                    _metric('uid', 'UID', 9183, '', 0, 30000, ['phase', 'offset']),
                    _metric('minute', 'Minute', 10, 'm', 0, 59, ['duration', 'modulation', 'envelope']),
                ]),
                _snapDatum('AQI', 'aqi', 74, '', 0.24, 160, 'snapshot | Manila (PH) | WAQI demo', [
                    _metric('aqi', 'AQI', 74, '', 0, 300, ['amplitude', 'frequency']),
                    _metric('uid', 'UID', 7331, '', 0, 30000, ['phase', 'offset']),
                    _metric('minute', 'Minute', 22, 'm', 0, 59, ['duration', 'modulation', 'envelope']),
                ]),
            ];

        case 'open_meteo':
            return [
                _snapDatum('Temp', 'temp', 19.2, 'C', 0.44, 164, 'snapshot | 03-11 07:00 | rain 0.0mm | wind 2.8m/s', [
                    _metric('temp', 'Temp', 19.2, 'C', 0, 36, ['frequency', 'amplitude']),
                    _metric('rain', 'Rain', 0, 'mm', 0, 20, ['offset', 'envelope']),
                    _metric('wind', 'Wind', 2.8, 'm/s', 0, 20, ['modulation', 'duration', 'phase']),
                ]),
                _snapDatum('Temp', 'temp', 21.8, 'C', 0.52, 182, 'snapshot | 03-11 13:00 | rain 0.1mm | wind 3.8m/s', [
                    _metric('temp', 'Temp', 21.8, 'C', 0, 36, ['frequency', 'amplitude']),
                    _metric('rain', 'Rain', 0.1, 'mm', 0, 20, ['offset', 'envelope']),
                    _metric('wind', 'Wind', 3.8, 'm/s', 0, 20, ['modulation', 'duration', 'phase']),
                ]),
                _snapDatum('Temp', 'temp', 17.0, 'C', 0.37, 150, 'snapshot | 03-11 22:00 | rain 0.0mm | wind 1.7m/s', [
                    _metric('temp', 'Temp', 17.0, 'C', 0, 36, ['frequency', 'amplitude']),
                    _metric('rain', 'Rain', 0, 'mm', 0, 20, ['offset', 'envelope']),
                    _metric('wind', 'Wind', 1.7, 'm/s', 0, 20, ['modulation', 'duration', 'phase']),
                ]),
            ];

        case 'gdelt_events':
            return [
                _snapDatum('Articles', 'articles', 522, 'count', 0.35, 162, 'snapshot | 2025-12-20 | 522 articles', [
                    _metric('count', 'Count', 522, '', 0, 1000, ['amplitude', 'frequency']),
                    _metric('day', 'DayIdx', 0, '', 0, 4, ['phase', 'duration']),
                    _metric('dom', 'DayOfMon', 20, '', 1, 31, ['offset', 'modulation', 'envelope']),
                ]),
                _snapDatum('Articles', 'articles', 728, 'count', 0.48, 206, 'snapshot | 2025-12-23 | 728 articles', [
                    _metric('count', 'Count', 728, '', 0, 1000, ['amplitude', 'frequency']),
                    _metric('day', 'DayIdx', 3, '', 0, 4, ['phase', 'duration']),
                    _metric('dom', 'DayOfMon', 23, '', 1, 31, ['offset', 'modulation', 'envelope']),
                ]),
                _snapDatum('Articles', 'articles', 552, 'count', 0.37, 170, 'snapshot | 2025-12-24 | 552 articles', [
                    _metric('count', 'Count', 552, '', 0, 1000, ['amplitude', 'frequency']),
                    _metric('day', 'DayIdx', 4, '', 0, 4, ['phase', 'duration']),
                    _metric('dom', 'DayOfMon', 24, '', 1, 31, ['offset', 'modulation', 'envelope']),
                ]),
            ];

        case 'exoplanets':
            return [
                _snapDatum('Mass', 'mass', 3.6, 'mE', 0.19, 124, 'snapshot | Kepler-1167 b | y2016 | orb 5.2d', [
                    _metric('mass', 'Mass', 3.6, 'mE', 0, 3000, ['frequency', 'amplitude']),
                    _metric('orb', 'OrbitalP', 5.2, 'd', 0, 4000, ['duration', 'modulation']),
                    _metric('year', 'Year', 2016, '', 1990, 2026, ['phase', 'offset', 'envelope']),
                ]),
                _snapDatum('Mass', 'mass', 11.0, 'mE', 0.31, 166, 'snapshot | Kepler-1740 b | y2021 | orb 23.8d', [
                    _metric('mass', 'Mass', 11.0, 'mE', 0, 3000, ['frequency', 'amplitude']),
                    _metric('orb', 'OrbitalP', 23.8, 'd', 0, 4000, ['duration', 'modulation']),
                    _metric('year', 'Year', 2021, '', 1990, 2026, ['phase', 'offset', 'envelope']),
                ]),
                _snapDatum('Mass', 'mass', 18.7, 'mE', 0.36, 178, 'snapshot | Kepler-1752 b | y2021 | orb 31.9d', [
                    _metric('mass', 'Mass', 18.7, 'mE', 0, 3000, ['frequency', 'amplitude']),
                    _metric('orb', 'OrbitalP', 31.9, 'd', 0, 4000, ['duration', 'modulation']),
                    _metric('year', 'Year', 2021, '', 1990, 2026, ['phase', 'offset', 'envelope']),
                ]),
            ];

        case 'nasa_donki':
            return [
                _snapDatum('Body', 'body', 1240, 'char', 0.31, 142, 'snapshot | DONKI Weekly Report | 2026-03-10', [
                    _metric('body', 'BodyLen', 1240, 'char', 0, 9000, ['amplitude', 'frequency']),
                    _metric('age', 'Age', 18, 'h', 0, 14 * 24, ['duration', 'envelope']),
                    _metric('type', 'Type#', 411, '', 0, 1000, ['offset', 'modulation']),
                    _metric('minute', 'Minute', 30, 'm', 0, 59, ['phase']),
                ]),
                _snapDatum('Body', 'body', 2860, 'char', 0.59, 188, 'snapshot | DONKI Alert | 2026-03-08', [
                    _metric('body', 'BodyLen', 2860, 'char', 0, 9000, ['amplitude', 'frequency']),
                    _metric('age', 'Age', 42, 'h', 0, 14 * 24, ['duration', 'envelope']),
                    _metric('type', 'Type#', 670, '', 0, 1000, ['offset', 'modulation']),
                    _metric('minute', 'Minute', 52, 'm', 0, 59, ['phase']),
                ]),
                _snapDatum('Body', 'body', 540, 'char', 0.16, 108, 'snapshot | DONKI Note | 2026-03-07', [
                    _metric('body', 'BodyLen', 540, 'char', 0, 9000, ['amplitude', 'frequency']),
                    _metric('age', 'Age', 66, 'h', 0, 14 * 24, ['duration', 'envelope']),
                    _metric('type', 'Type#', 214, '', 0, 1000, ['offset', 'modulation']),
                    _metric('minute', 'Minute', 12, 'm', 0, 59, ['phase']),
                ]),
            ];

        case 'nasa_apod':
            return [
                _snapDatum('APOD text', 'explain', 890, 'char', 0.22, 116, 'snapshot | 2026-03-10 | Spiral Galaxy', [
                    _metric('explain', 'ExplainLen', 890, 'char', 0, 10000, ['amplitude', 'duration']),
                    _metric('title', 'TitleLen', 18, 'char', 0, 140, ['frequency', 'envelope']),
                    _metric('day', 'Day', 10, '', 1, 31, ['phase', 'modulation']),
                    _metric('media', 'Media#', 431, '', 0, 1000, ['offset']),
                ]),
                _snapDatum('APOD text', 'explain', 1320, 'char', 0.31, 148, 'snapshot | 2026-03-11 | Comet Trail', [
                    _metric('explain', 'ExplainLen', 1320, 'char', 0, 10000, ['amplitude', 'duration']),
                    _metric('title', 'TitleLen', 22, 'char', 0, 140, ['frequency', 'envelope']),
                    _metric('day', 'Day', 11, '', 1, 31, ['phase', 'modulation']),
                    _metric('media', 'Media#', 431, '', 0, 1000, ['offset']),
                ]),
                _snapDatum('APOD text', 'explain', 2140, 'char', 0.49, 186, 'snapshot | 2026-03-12 | Nebula Core', [
                    _metric('explain', 'ExplainLen', 2140, 'char', 0, 10000, ['amplitude', 'duration']),
                    _metric('title', 'TitleLen', 19, 'char', 0, 140, ['frequency', 'envelope']),
                    _metric('day', 'Day', 12, '', 1, 31, ['phase', 'modulation']),
                    _metric('media', 'Media#', 431, '', 0, 1000, ['offset']),
                ]),
            ];

        default:
            return [];
    }
}

function _snapDatum(
    inputLabel: string,
    inputKey: string,
    inputValue: number,
    inputUnit: string,
    norm: number,
    baseFrequency: number,
    context: string,
    metrics: InputMetric[],
): SourceDatum {
    return {
        inputKey,
        inputLabel,
        inputValue,
        inputUnit,
        norm,
        baseFrequency,
        context,
        metrics,
        sourceMode: 'snapshot',
    };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function _isUsableDatum(item: SourceDatum): boolean {
    if (!item) return false;
    if (!Number.isFinite(item.inputValue) || !Number.isFinite(item.norm) || !Number.isFinite(item.baseFrequency)) {
        return false;
    }
    if (!Array.isArray(item.metrics) || item.metrics.length === 0) return false;
    return item.metrics.every(m => Number.isFinite(m.value));
}

function _pushLiveSeries(source: DataSourceId, point: SourceDatum, max = SYNTH_BUF_LEN): SourceDatum[] {
    const prev = LIVE_SERIES.get(source) ?? [];
    const next = prev.concat(_cloneDatum(point, 'live')).slice(-max);
    LIVE_SERIES.set(source, next);
    return next.map(item => _cloneDatum(item, 'live'));
}

function _persistSnapshot(source: DataSourceId, items: SourceDatum[]): void {
    const clean = items
        .filter(_isUsableDatum)
        .slice(-SNAPSHOT_LIMIT)
        .map(item => _cloneDatum(item, 'snapshot'));
    if (!clean.length) return;

    SNAPSHOT_STORE[source] = clean;
    _saveSnapshotStore();
}

function _snapshotFromStore(source: DataSourceId): SourceDatum[] {
    const saved = SNAPSHOT_STORE[source];
    if (!saved?.length) return [];
    return saved.map(item => _cloneDatum(item, 'snapshot'));
}

function _loadSnapshotStore(): Partial<Record<DataSourceId, SourceDatum[]>> {
    if (typeof window === 'undefined' || !window.localStorage) return {};

    try {
        const raw = window.localStorage.getItem(SNAPSHOT_KEY);
        if (!raw) return {};

        const parsed = JSON.parse(raw) as Partial<Record<DataSourceId, SourceDatum[]>>;
        const out: Partial<Record<DataSourceId, SourceDatum[]>> = {};
        for (const source of _allSourceIds()) {
            const rows = parsed[source];
            if (!Array.isArray(rows)) continue;
            const clean = rows
                .filter(row => !!row)
                .map(row => _cloneDatum(row as SourceDatum, 'snapshot'))
                .filter(_isUsableDatum)
                .slice(-SNAPSHOT_LIMIT);
            if (clean.length) out[source] = clean;
        }
        return out;
    } catch {
        return {};
    }
}

function _saveSnapshotStore(): void {
    if (typeof window === 'undefined' || !window.localStorage) return;
    try {
        window.localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(SNAPSHOT_STORE));
    } catch {
        // localStorage full/blocked
    }
}

function _allSourceIds(): DataSourceId[] {
    return [
        'earthquake',
        'cwa_earthquake',
        'ntu_buildings',
        'taipei_noise_stations',
        'taipei_rain',
        'taiwan_aqi',
        'waqi_asia',
        'open_meteo',
        'gdelt_events',
        'exoplanets',
        'nasa_donki',
        'nasa_apod',
    ];
}

function _cloneDatum(item: SourceDatum, sourceMode: 'live' | 'snapshot' = item.sourceMode): SourceDatum {
    return {
        inputKey: item.inputKey,
        inputLabel: item.inputLabel,
        inputValue: Number(item.inputValue) || 0,
        inputUnit: item.inputUnit,
        norm: Number(item.norm) || 0,
        baseFrequency: Number(item.baseFrequency) || 0,
        context: item.context,
        sourceMode,
        metrics: (item.metrics ?? []).map(metric => ({
            key: metric.key,
            label: metric.label,
            value: Number(metric.value) || 0,
            unit: metric.unit,
            min: metric.min,
            max: metric.max,
            affects: Array.isArray(metric.affects) ? metric.affects.slice() : [],
        })),
    };
}

function _sourceLabel(source: DataSourceId): string {
    return SOURCE_LABEL_MAP.get(source) ?? source;
}

function _localizedMetricLabel(label: string): string {
    switch (label) {
        case 'Magnitude': return '震級 / Magnitude';
        case 'Depth': return '深度 / Depth';
        case 'Age': return '時間差 / Age';
        case 'AQI': return '空氣品質 / AQI';
        case 'PM2.5': return '細懸浮微粒 / PM2.5';
        case 'O3(8h)': return '臭氧 / O3(8h)';
        case 'PM10': return '懸浮微粒 / PM10';
        case 'Minute': return '分鐘 / Minute';
        case 'Articles': return '文章量 / Articles';
        case 'Body': return '文字長度 / Body';
        case 'APOD text': return '敘事文字 / APOD text';
        case 'Rain': return '雨量 / Rain';
        case 'Station#': return '測站編號 / Station';
        case 'Zone': return '分區 / Zone';
        case 'Lon': return '經度 / Longitude';
        case 'Temp': return '溫度 / Temp';
        case 'Wind': return '風速 / Wind';
        case 'UID': return '測站編號 / UID';
        case 'Count': return '事件量 / Count';
        case 'DayIdx': return '日序 / DayIdx';
        case 'DayOfMon': return '日期 / DayOfMonth';
        case 'BodyLen': return '文字長度 / Body';
        case 'Type#': return '類型雜湊 / Type';
        case 'ExplainLen': return '敘事長度 / Explanation';
        case 'TitleLen': return '標題長度 / Title';
        case 'Day': return '日期 / Day';
        case 'Media#': return '媒介雜湊 / Media';
        case 'Mass': return '質量 / Mass';
        case 'OrbitalP': return '軌道週期 / Orbital Period';
        case 'Year': return '年份 / Year';
        case 'X': return 'X 座標 / X';
        case 'Y': return 'Y 座標 / Y';
        case 'Code#': return '代碼 / Code';
        default: return label;
    }
}

function _metric(
    key: string,
    label: string,
    value: number,
    unit: string,
    min: number,
    max: number,
    affects: InputMetric['affects'],
): InputMetric {
    return { key, label, value, unit, min, max, affects };
}

async function _cachedJson<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
    return _cached(key, ttlMs, loader);
}

async function _cachedText(key: string, ttlMs: number, loader: () => Promise<string>): Promise<string> {
    return _cached(key, ttlMs, loader);
}

async function _cached<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const prev = CACHE.get(key) as CacheEntry<T> | undefined;

    if (prev && prev.value !== null && prev.expiresAt > now) return prev.value;
    if (prev?.pending) return prev.pending;

    const pending = loader()
        .then(value => {
            CACHE.set(key, { value, expiresAt: Date.now() + ttlMs, pending: null });
            return value;
        })
        .catch(err => {
            CACHE.delete(key);
            throw err;
        });

    CACHE.set(key, {
        value: prev?.value ?? null,
        expiresAt: prev?.expiresAt ?? 0,
        pending,
    });

    return pending;
}

function _scaleTickMs(base: number, speed: number, min = 600, max = 90_000): number {
    const safeSpeed = _clamp(Number.isFinite(speed) ? speed : 1, 0.0005, 8);
    const factor = Math.pow(1 / safeSpeed, 0.55);
    const effectiveMax = Math.min(max, 25_000);
    return _clamp(base * factor, min, effectiveMax);
}

function _safeNorm(v: number, min: number, max: number): number {
    if (!Number.isFinite(v) || !Number.isFinite(min) || !Number.isFinite(max) || max <= min) return 0;
    return _clamp((v - min) / (max - min), 0, 1);
}

function _clamp(v: number, lo: number, hi: number): number {
    return Math.max(lo, Math.min(hi, v));
}

function _finite(v: number, fallback: number): number {
    return Number.isFinite(v) ? v : fallback;
}

function _fmtIsoMinute(ts: number): string {
    return new Date(ts).toISOString().replace('T', ' ').slice(0, 16);
}

function _fmtRainTime(raw: string): string {
    if (!/^\d{12}$/.test(raw)) return raw;
    return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)} ${raw.slice(8, 10)}:${raw.slice(10, 12)}`;
}

function _fmtGdeltDate(raw: string): string {
    const m = raw.match(/^(\d{4})(\d{2})(\d{2})/);
    if (!m) return raw;
    return `${m[1]}-${m[2]}-${m[3]}`;
}

function _minuteOfRecTime(raw: string): number {
    if (!/^\d{12}$/.test(raw)) return 0;
    return parseInt(raw.slice(10, 12), 10) || 0;
}

function _dayOfGdelt(raw: string): number {
    const m = raw.match(/^\d{6}(\d{2})/);
    return m ? parseInt(m[1], 10) : 1;
}

function _minuteFromSlashTime(raw: string): number {
    const m = raw.match(/\b(\d{1,2}):(\d{2})/);
    if (!m) return 0;
    const mm = parseInt(m[2], 10);
    return Number.isFinite(mm) ? _clamp(mm, 0, 59) : 0;
}

function _minuteFromDashTime(raw: string): number {
    const ts = Date.parse(raw);
    if (Number.isFinite(ts)) return new Date(ts).getUTCMinutes();
    return _minuteFromSlashTime(raw);
}

function _hashNum(raw: string): number {
    let hash = 0;
    for (let i = 0; i < raw.length; i++) {
        hash = (hash * 31 + raw.charCodeAt(i)) % 1000;
    }
    return hash;
}

function _zoneToLevel(raw: string): number {
    const txt = (raw || '').trim();
    if (!txt) return 2;
    const m = txt.match(/\d+/);
    if (m) return _clamp(parseInt(m[0], 10) || 2, 1, 4);

    if (txt.includes('第一') || txt.includes('一類')) return 1;
    if (txt.includes('第二') || txt.includes('二類')) return 2;
    if (txt.includes('第三') || txt.includes('三類')) return 3;
    if (txt.includes('第四') || txt.includes('四類')) return 4;
    return 2;
}

function _codeNumber(name: string): number {
    const m = name.match(/^[A-Z](\d{1,2})\*/i);
    return m ? parseInt(m[1], 10) : 0;
}

function _fmtNum(v: number): string {
    if (!Number.isFinite(v)) return '0';
    if (Math.abs(v) >= 1000) return Math.round(v).toString();
    if (Math.abs(v) >= 100) return v.toFixed(1);
    if (Math.abs(v) >= 10) return v.toFixed(2);
    return v.toFixed(3);
}

function _decodeBig5(buf: ArrayBuffer): string {
    try {
        return new TextDecoder('big5').decode(buf);
    } catch {
        return new TextDecoder().decode(buf);
    }
}

function _parseCsvLine(line: string): string[] {
    const out: string[] = [];
    let cell = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
            if (inQuotes && line[i + 1] === '"') {
                cell += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
            continue;
        }
        if (ch === ',' && !inQuotes) {
            out.push(cell);
            cell = '';
            continue;
        }
        cell += ch;
    }
    out.push(cell);
    return out;
}

function _parseJinaJsonArray<T>(wrappedText: string): T[] {
    const marker = 'Markdown Content:';
    const source = wrappedText.includes(marker)
        ? wrappedText.slice(wrappedText.indexOf(marker) + marker.length)
        : wrappedText;

    const start = source.indexOf('[');
    const end = source.lastIndexOf(']');
    if (start === -1 || end === -1 || end <= start) return [];

    const jsonText = source.slice(start, end + 1).trim();
    try {
        const parsed = JSON.parse(jsonText) as unknown;
        return Array.isArray(parsed) ? (parsed as T[]) : [];
    } catch {
        return [];
    }
}
