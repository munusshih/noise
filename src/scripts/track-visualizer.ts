/**
 * Per-track visualizer.
 *
 * Each track renders:
 * 1) Source-specific API visualizer
 * 2) Synthesis parameter timelines (amp/freq/phase/offset/duration/envelope/mod)
 * 3) Oscilloscope (actual + model waveform)
 * 4) Translation map panel (API metric -> synthesis target)
 */

import { tracks, runtimes, DATA_SOURCES } from './track-state';
import type { DataSourceId, InputMetric, SynthesisFrame, TrackRuntime } from './track-state';
import { SYNTH_BUF_LEN } from './track-datasource';

let _started = false;

export function startTrackVisualizer(): void {
    if (_started) return;
    _started = true;
    draw();
}

function draw(): void {
    requestAnimationFrame(draw);
    const nowMs = performance.now();

    for (const track of tracks) {
        const runtime = runtimes.get(track.id) ?? null;
        try {
            _drawDataCanvas(track.id, track.dataSource, runtime, track.isPlaying, nowMs);
            _drawSynthCanvas(track.id, runtime, track.isPlaying);
            _drawWaveCanvas(track.id, runtime, track.isPlaying);
            _drawContext(track.id, track.dataSource, track.dataMode, track.soundMode, runtime, track.isPlaying);
            _drawMapping(track.id, track.dataSource, runtime);
        } catch (err) {
            console.error('track visualizer error:', err);
            _drawErrorCanvas(`data-${track.id}`, '視覺化錯誤 / Viz error');
            _drawErrorCanvas(`params-${track.id}`, '視覺化錯誤 / Viz error');
            _drawErrorCanvas(`waveform-${track.id}`, '視覺化錯誤 / Viz error');
        }
    }

    _drawNowPlaying();
}

function _drawDataCanvas(
    trackId: string,
    sourceId: DataSourceId,
    runtime: TrackRuntime | null,
    _isPlaying: boolean,
    nowMs: number,
): void {
    const canvas = document.getElementById(`data-${trackId}`) as HTMLCanvasElement | null;
    if (!canvas) return;

    const prepared = _prepareCanvas(canvas);
    if (!prepared) return;
    const { c, w, h } = prepared;

    c.fillStyle = '#040404';
    c.fillRect(0, 0, w, h);

    if (!runtime || runtime.synthBuffer.length === 0) {
        _drawIdleText(c, w, h, '等待資料輸入 / Awaiting API input');
        return;
    }

    const frames = runtime.synthBuffer.slice(-SYNTH_BUF_LEN);
    const audioLevel = _sampleAudioLevel(runtime.analyser);

    switch (sourceId) {
        case 'earthquake':
            _drawEarthquakeVisualizer(c, w, h, frames, nowMs, audioLevel, 'global');
            break;
        case 'cwa_earthquake':
            _drawEarthquakeVisualizer(c, w, h, frames, nowMs, audioLevel, 'regional');
            break;
        case 'ntu_buildings':
            _drawNtuVisualizer(c, w, h, frames, audioLevel);
            break;
        case 'taipei_noise_stations':
            _drawNoiseStationsVisualizer(c, w, h, frames, audioLevel);
            break;
        case 'taipei_rain':
            _drawRainVisualizer(c, w, h, frames, nowMs, audioLevel);
            break;
        case 'taiwan_aqi':
            _drawAqiNetworkVisualizer(c, w, h, frames, audioLevel, 'pm25', 'o3', 'taiwan');
            break;
        case 'waqi_asia':
            _drawAqiNetworkVisualizer(c, w, h, frames, audioLevel, 'uid', 'minute', 'asia');
            break;
        case 'open_meteo':
            _drawOpenMeteoVisualizer(c, w, h, frames, audioLevel);
            break;
        case 'gdelt_events':
            _drawGdeltVisualizer(c, w, h, frames, nowMs, audioLevel);
            break;
        case 'nasa_donki':
            _drawDonkiVisualizer(c, w, h, frames, nowMs, audioLevel);
            break;
        case 'nasa_apod':
            _drawApodVisualizer(c, w, h, frames, nowMs, audioLevel);
            break;
        case 'exoplanets':
            _drawExoplanetVisualizer(c, w, h, frames, nowMs, audioLevel);
            break;
        default:
            _drawIdleText(c, w, h, '未支援的資料源 / Unsupported source');
            break;
    }

    if (runtime.latestDataLabel) {
        c.fillStyle = '#d6d6d6';
        c.font = '11px "IBM Plex Mono", "JetBrains Mono", monospace';
        c.textAlign = 'right';
        c.fillText(runtime.latestDataLabel, w - 7, 12);
    }
}

function _drawEarthquakeVisualizer(
    c: CanvasRenderingContext2D,
    w: number,
    h: number,
    frames: SynthesisFrame[],
    nowMs: number,
    audioLevel: number,
    variant: 'global' | 'regional',
): void {
    const latest = frames[frames.length - 1];
    const mag = _metric(latest, 'mag');
    const depth = _metric(latest, 'depth');
    const age = _metric(latest, 'age');
    const magNorm = mag ? _metricNorm(mag) : _clamp(latest.inputValue / 8, 0, 1);
    const depthNorm = depth ? _metricNorm(depth) : 0.5;

    if (variant === 'regional') {
        const plot = { x: 12, y: 10, w: w - 24, h: h - 22 };
        _drawAxisGrid(c, plot.x, plot.y, plot.w, plot.h, 6, 4);

        const ridge = [
            [0.08, 0.72],
            [0.18, 0.6],
            [0.28, 0.66],
            [0.39, 0.48],
            [0.53, 0.56],
            [0.67, 0.42],
            [0.78, 0.5],
            [0.9, 0.36],
        ];

        c.strokeStyle = '#6e6e6e';
        c.lineWidth = 1.25;
        c.beginPath();
        ridge.forEach(([rx, ry], index) => {
            const px = plot.x + rx * plot.w;
            const py = plot.y + ry * plot.h;
            if (index === 0) c.moveTo(px, py);
            else c.lineTo(px, py);
        });
        c.stroke();

        const magSeries = _metricSeries(frames, 'mag');
        const depthSeries = _metricSeries(frames, 'depth');
        const bars = _safeSeries(magSeries.values);
        const count = Math.max(1, bars.length);
        const barW = plot.w / count;

        for (let i = 0; i < bars.length; i++) {
            const valueNorm = _toNorm(bars[i], magSeries.scale.min, magSeries.scale.max);
            const bh = (0.16 + valueNorm * 0.34) * plot.h;
            const x = plot.x + i * barW;
            const y = plot.y + plot.h - bh;
            c.fillStyle = `rgba(242, 242, 242, ${(0.16 + valueNorm * 0.42).toFixed(3)})`;
            c.fillRect(x + 1, y, Math.max(2, barW - 2), bh);
        }

        _drawLineSeries(c, depthSeries.values, depthSeries.scale, plot, '#9b9b9b', 1.1 + audioLevel * 0.9, [3, 3]);

        const ageNorm = age ? _metricNorm(age) : 0.5;
        const pulseX = plot.x + (0.18 + ageNorm * 0.68) * plot.w;
        const pulseY = plot.y + (0.2 + depthNorm * 0.58) * plot.h;
        for (let i = 0; i < 3; i++) {
            const r = 7 + i * 10 + magNorm * 18 + Math.sin(nowMs * 0.004 + i) * 1.4;
            c.strokeStyle = `rgba(242, 242, 242, ${(0.24 - i * 0.06 + audioLevel * 0.14).toFixed(3)})`;
            c.beginPath();
            c.arc(pulseX, pulseY, r, 0, Math.PI * 2);
            c.stroke();
        }

        c.fillStyle = '#ffffff';
        c.beginPath();
        c.arc(pulseX, pulseY, 4 + magNorm * 5 + audioLevel * 4, 0, Math.PI * 2);
        c.fill();

        c.fillStyle = '#9f9f9f';
        c.font = '10px "IBM Plex Mono", "JetBrains Mono", monospace';
        c.textAlign = 'left';
        c.fillText(
            `regional M ${_fmtNum(mag?.value ?? latest.inputValue)} | depth ${_fmtNum(depth?.value ?? 0)} km | age ${_fmtNum(age?.value ?? 0)} h`,
            plot.x + 6,
            plot.y + 12,
        );
        return;
    }

    const cx = Math.round(w * 0.26);
    const cy = Math.round(h * 0.5);
    const maxR = Math.min(w, h) * 0.45;

    c.strokeStyle = '#1c1c1c';
    c.lineWidth = 1;
    for (let i = 1; i <= 4; i++) {
        const r = (maxR / 4) * i;
        c.beginPath();
        c.arc(cx, cy, r, 0, Math.PI * 2);
        c.stroke();
    }

    const speed = 0.35 + magNorm * 0.75 + audioLevel * 2.2;
    const t = (nowMs * 0.001 * speed + latest.phase / (Math.PI * 2)) % 1;
    for (let i = 0; i < 4; i++) {
        const p = (t + i * 0.24) % 1;
        const r = 10 + magNorm * 28 + p * maxR;
        const alpha = (0.62 + audioLevel * 0.42) * (1 - p);
        c.strokeStyle = `rgba(242, 242, 242, ${alpha.toFixed(3)})`;
        c.lineWidth = 1.1 + magNorm * 1.6 + audioLevel * 2.8;
        c.beginPath();
        c.arc(cx, cy, r, 0, Math.PI * 2);
        c.stroke();
    }

    c.fillStyle = '#f0f0f0';
    c.beginPath();
    c.arc(cx, cy, 5 + magNorm * 9, 0, Math.PI * 2);
    c.fill();

    const series = _metricSeries(frames, 'mag');
    const plot = { x: Math.round(w * 0.46), y: 12, w: Math.round(w * 0.5) - 8, h: h - 24 };
    _drawBox(c, plot.x, plot.y, plot.w, plot.h);
    _drawLineSeries(c, series.values, series.scale, plot, '#dbdbdb', 1.4);

    c.fillStyle = '#9f9f9f';
    c.font = '10px "IBM Plex Mono", "JetBrains Mono", monospace';
    c.textAlign = 'left';
    c.fillText(`M ${_fmtNum(mag?.value ?? latest.inputValue)}  depth ${_fmtNum(depth?.value ?? 0)} km`, plot.x + 6, plot.y + 12);
}

function _drawNtuVisualizer(
    c: CanvasRenderingContext2D,
    w: number,
    h: number,
    frames: SynthesisFrame[],
    audioLevel: number,
): void {
    const xHist = _metricSeries(frames, 'x');
    const yHist = _metricSeries(frames, 'y');
    const plot = { x: 48, y: 12, w: w - 58, h: h - 26 };

    _drawAxisGrid(c, plot.x, plot.y, plot.w, plot.h, 4, 4);

    c.fillStyle = '#6d6d6d';
    c.font = '10px "IBM Plex Mono", "JetBrains Mono", monospace';
    c.textAlign = 'center';
    c.fillText('X', plot.x + plot.w * 0.5, h - 4);
    c.save();
    c.translate(12, plot.y + plot.h * 0.5);
    c.rotate(-Math.PI / 2);
    c.fillText('Y', 0, 0);
    c.restore();

    c.strokeStyle = 'rgba(232, 232, 232, 0.8)';
    c.lineWidth = 1.2;
    c.beginPath();

    const n = Math.min(xHist.values.length, yHist.values.length);
    for (let i = 0; i < n; i++) {
        const xn = _toNorm(xHist.values[i], xHist.scale.min, xHist.scale.max);
        const yn = _toNorm(yHist.values[i], yHist.scale.min, yHist.scale.max);
        const x = plot.x + xn * plot.w;
        const y = plot.y + (1 - yn) * plot.h;
        if (i === 0) c.moveTo(x, y);
        else c.lineTo(x, y);
    }
    c.stroke();

    if (n > 0) {
        const latestX = _toNorm(xHist.values[n - 1], xHist.scale.min, xHist.scale.max);
        const latestY = _toNorm(yHist.values[n - 1], yHist.scale.min, yHist.scale.max);
        const jitter = Math.sin(performance.now() * 0.005) * (audioLevel * 4.5);
        const px = plot.x + latestX * plot.w + jitter;
        const py = plot.y + (1 - latestY) * plot.h + Math.cos(performance.now() * 0.004) * (audioLevel * 3.5);
        c.fillStyle = '#f2f2f2';
        c.beginPath();
        c.arc(px, py, 4.2 + audioLevel * 7.5, 0, Math.PI * 2);
        c.fill();

        c.fillStyle = '#9f9f9f';
        c.textAlign = 'left';
        c.fillText(`x ${Math.round(xHist.values[n - 1])} / y ${Math.round(yHist.values[n - 1])}`, plot.x + 6, plot.y + 12);
    }
}

function _drawNoiseStationsVisualizer(
    c: CanvasRenderingContext2D,
    w: number,
    h: number,
    frames: SynthesisFrame[],
    audioLevel: number,
): void {
    const zoneHist = _metricSeries(frames, 'zone');
    const lonHist = _metricSeries(frames, 'lon');
    const minuteHist = _metricSeries(frames, 'minute');
    const stationHist = _metricSeries(frames, 'station');

    const plot = { x: 46, y: 10, w: w - 54, h: h - 24 };
    const lanes = 4;

    for (let i = 0; i < lanes; i++) {
        const yy = plot.y + (plot.h / lanes) * i;
        c.fillStyle = i % 2 === 0 ? '#090909' : '#0d0d0d';
        c.fillRect(plot.x, yy, plot.w, plot.h / lanes);
        c.strokeStyle = '#1e1e1e';
        c.beginPath();
        c.moveTo(plot.x, yy);
        c.lineTo(plot.x + plot.w, yy);
        c.stroke();
    }
    c.strokeStyle = '#272727';
    c.strokeRect(plot.x, plot.y, plot.w, plot.h);

    c.fillStyle = '#666';
    c.font = '10px "IBM Plex Mono", "JetBrains Mono", monospace';
    c.textAlign = 'right';
    for (let z = 1; z <= 4; z++) {
        const y = plot.y + (1 - (z - 1) / 3) * plot.h;
        c.fillText(`Z${z}`, plot.x - 5, y + 3);
    }

    const n = Math.min(
        zoneHist.values.length,
        lonHist.values.length,
        Math.max(minuteHist.values.length, stationHist.values.length),
    );
    c.strokeStyle = '#d8d8d8';
    c.lineWidth = 1.1 + audioLevel * 1.8;
    c.beginPath();

    for (let i = 0; i < n; i++) {
        const x = plot.x + _toNorm(lonHist.values[i], lonHist.scale.min, lonHist.scale.max) * plot.w;
        const zoneNorm = _toNorm(zoneHist.values[i], zoneHist.scale.min, zoneHist.scale.max);
        const y = plot.y + (1 - zoneNorm) * plot.h;
        if (i === 0) c.moveTo(x, y);
        else c.lineTo(x, y);
    }
    c.stroke();

    if (n > 0) {
        const x = plot.x + _toNorm(lonHist.values[n - 1], lonHist.scale.min, lonHist.scale.max) * plot.w;
        const zoneNorm = _toNorm(zoneHist.values[n - 1], zoneHist.scale.min, zoneHist.scale.max);
        const y = plot.y + (1 - zoneNorm) * plot.h;
        const minuteNorm = minuteHist.values.length
            ? _toNorm(minuteHist.values[n - 1], minuteHist.scale.min, minuteHist.scale.max)
            : _toNorm(stationHist.values[n - 1] ?? 0, stationHist.scale.min, stationHist.scale.max);

        c.fillStyle = '#ffffff';
        c.beginPath();
        c.arc(x, y, 3 + minuteNorm * 4 + audioLevel * 6, 0, Math.PI * 2);
        c.fill();

        c.fillStyle = '#9f9f9f';
        c.textAlign = 'left';
        c.fillText(`zone ${_fmtNum(zoneHist.values[n - 1])} / minute ${Math.round(minuteHist.values[n - 1] ?? 0)}`, plot.x + 6, plot.y + 12);
    }
}

function _drawRainVisualizer(
    c: CanvasRenderingContext2D,
    w: number,
    h: number,
    frames: SynthesisFrame[],
    nowMs: number,
    audioLevel: number,
): void {
    const rain = _metricSeries(frames, 'rain');
    const latest = rain.values[rain.values.length - 1] ?? 0;
    const latestNorm = _toNorm(latest, rain.scale.min, rain.scale.max);

    const plot = { x: 10, y: 8, w: w - 20, h: h - 24 };
    _drawBox(c, plot.x, plot.y, plot.w, plot.h);

    const n = Math.min(rain.values.length, 46);
    const barW = Math.max(1, plot.w / Math.max(1, n));
    for (let i = 0; i < n; i++) {
        const idx = rain.values.length - n + i;
        const v = rain.values[idx];
        const vn = _toNorm(v, rain.scale.min, rain.scale.max);
        const bh = vn * plot.h * 0.82;
        const x = plot.x + i * barW;
        const y = plot.y + plot.h - bh;
        c.fillStyle = i === n - 1 ? '#f2f2f2' : 'rgba(210, 210, 210, 0.55)';
        c.fillRect(x, y, Math.max(1, barW - 1), bh);
    }

    const puddleH = latestNorm * plot.h * (0.45 + audioLevel * 0.25);
    c.fillStyle = 'rgba(240, 240, 240, 0.16)';
    c.fillRect(plot.x, plot.y + plot.h - puddleH, plot.w, puddleH);

    const dropCount = 3 + Math.round(latestNorm * 16 + audioLevel * 24);
    c.strokeStyle = 'rgba(240, 240, 240, 0.65)';
    c.lineWidth = 1 + audioLevel * 1.6;
    for (let i = 0; i < dropCount; i++) {
        const seed = i * 97.23;
        const x = plot.x + ((_hash(seed) * 0.92 + 0.04) * plot.w);
        const speed = 0.5 + _hash(seed + 4.1) * 1.7;
        const phase = (nowMs * 0.001 * speed + _hash(seed + 11.7)) % 1;
        const y = plot.y + phase * plot.h;
        c.beginPath();
        c.moveTo(x, y - (5 + audioLevel * 4));
        c.lineTo(x, y + (5 + audioLevel * 4));
        c.stroke();
    }

    c.fillStyle = '#9f9f9f';
    c.font = '10px "IBM Plex Mono", "JetBrains Mono", monospace';
    c.textAlign = 'left';
    c.fillText(`rain ${_fmtNum(latest)} mm`, plot.x + 6, plot.y + 12);
}

function _drawAqiNetworkVisualizer(
    c: CanvasRenderingContext2D,
    w: number,
    h: number,
    frames: SynthesisFrame[],
    audioLevel: number,
    secondaryKey: string,
    tertiaryKey: string,
    variant: 'taiwan' | 'asia',
): void {
    const aqi = _metricSeries(frames, 'aqi');
    const secondary = _metricSeries(frames, secondaryKey);
    const tertiary = _metricSeries(frames, tertiaryKey);

    const plot = { x: 38, y: 10, w: w - 46, h: h - 24 };
    _drawAxisGrid(c, plot.x, plot.y, plot.w, plot.h, 6, 4);

    if (variant === 'taiwan') {
        const bands = [
            { from: 0, to: 50, a: 0.08 },
            { from: 51, to: 100, a: 0.13 },
            { from: 101, to: 150, a: 0.18 },
            { from: 151, to: 200, a: 0.24 },
            { from: 201, to: 300, a: 0.3 },
        ];
        for (const band of bands) {
            const y0 = plot.y + (1 - _toNorm(band.to, 0, 300)) * plot.h;
            const y1 = plot.y + (1 - _toNorm(band.from, 0, 300)) * plot.h;
            c.fillStyle = `rgba(240, 240, 240, ${band.a.toFixed(3)})`;
            c.fillRect(plot.x, y0, plot.w, Math.max(1, y1 - y0));
        }

        _drawLineSeries(c, aqi.values, aqi.scale, plot, '#f1f1f1', 1.4 + audioLevel * 1.3, []);
        _drawLineSeries(c, secondary.values, secondary.scale, plot, '#b8b8b8', 1.1 + audioLevel * 0.8, [4, 3]);
        _drawLineSeries(c, tertiary.values, tertiary.scale, plot, '#7f7f7f', 1.05 + audioLevel * 0.7, [1, 3]);

        const latestAqi = aqi.values[aqi.values.length - 1] ?? 0;
        const latestSecond = secondary.values[secondary.values.length - 1] ?? 0;
        const latestThird = tertiary.values[tertiary.values.length - 1] ?? 0;
        const scannerX = plot.x + (plot.w * 0.18) + (_toNorm(latestThird, tertiary.scale.min, tertiary.scale.max) * plot.w * 0.64);

        c.strokeStyle = `rgba(255, 255, 255, ${(0.3 + audioLevel * 0.25).toFixed(3)})`;
        c.setLineDash([5, 4]);
        c.beginPath();
        c.moveTo(scannerX, plot.y);
        c.lineTo(scannerX, plot.y + plot.h);
        c.stroke();
        c.setLineDash([]);

        c.fillStyle = '#a1a1a1';
        c.font = '10px "IBM Plex Mono", "JetBrains Mono", monospace';
        c.textAlign = 'left';
        c.fillText(
            `taiwan aqi ${_fmtNum(latestAqi)} | ${secondaryKey} ${_fmtNum(latestSecond)} | ${tertiaryKey} ${_fmtNum(latestThird)}`,
            plot.x + 6,
            plot.y + 12,
        );
        return;
    }

    const latestAqi = aqi.values[aqi.values.length - 1] ?? 0;
    const latestSecond = secondary.values[secondary.values.length - 1] ?? 0;
    const latestThird = tertiary.values[tertiary.values.length - 1] ?? 0;
    const nodes = frames.slice(-18);

    c.strokeStyle = '#1f1f1f';
    c.lineWidth = 1;
    c.beginPath();
    c.ellipse(plot.x + plot.w * 0.46, plot.y + plot.h * 0.5, plot.w * 0.35, plot.h * 0.28, 0, 0, Math.PI * 2);
    c.stroke();
    c.beginPath();
    c.ellipse(plot.x + plot.w * 0.62, plot.y + plot.h * 0.42, plot.w * 0.22, plot.h * 0.18, 0, 0, Math.PI * 2);
    c.stroke();

    let prevX = 0;
    let prevY = 0;
    nodes.forEach((frame, index) => {
        const uidMetric = _metric(frame, 'uid');
        const minuteMetric = _metric(frame, 'minute');
        const uidNorm = uidMetric ? _metricNorm(uidMetric) : index / Math.max(1, nodes.length - 1);
        const minuteNorm = minuteMetric ? _metricNorm(minuteMetric) : 0.5;
        const aqiMetric = _metric(frame, 'aqi');
        const aqiNorm = aqiMetric ? _metricNorm(aqiMetric) : 0.4;

        const x = plot.x + (0.08 + uidNorm * 0.84) * plot.w;
        const y = plot.y + (0.12 + minuteNorm * 0.76) * plot.h;
        if (index > 0) {
            c.strokeStyle = `rgba(184, 184, 184, ${(0.08 + aqiNorm * 0.22).toFixed(3)})`;
            c.beginPath();
            c.moveTo(prevX, prevY);
            c.lineTo(x, y);
            c.stroke();
        }
        prevX = x;
        prevY = y;

        c.fillStyle = `rgba(242, 242, 242, ${(0.35 + aqiNorm * 0.45).toFixed(3)})`;
        c.beginPath();
        c.arc(x, y, 1.8 + aqiNorm * 5 + audioLevel * 2.5, 0, Math.PI * 2);
        c.fill();
    });

    c.fillStyle = '#a1a1a1';
    c.font = '10px "IBM Plex Mono", "JetBrains Mono", monospace';
    c.textAlign = 'left';
    c.fillText(
        `asia mesh aqi ${_fmtNum(latestAqi)} | uid ${_fmtNum(latestSecond)} | minute ${_fmtNum(latestThird)}`,
        plot.x + 6,
        plot.y + 12,
    );
}

function _drawOpenMeteoVisualizer(
    c: CanvasRenderingContext2D,
    w: number,
    h: number,
    frames: SynthesisFrame[],
    audioLevel: number,
): void {
    const temp = _metricSeries(frames, 'temp');
    const rain = _metricSeries(frames, 'rain');
    const wind = _metricSeries(frames, 'wind');

    const plot = { x: 36, y: 12, w: w - 44, h: h - 24 };
    _drawAxisGrid(c, plot.x, plot.y, plot.w, plot.h, 5, 3);

    _drawLineSeries(c, temp.values, temp.scale, plot, '#e8e8e8', 1.3 + audioLevel * 1.2, []);
    _drawLineSeries(c, rain.values, rain.scale, plot, '#bfbfbf', 1.2 + audioLevel * 0.8, [4, 3]);
    _drawLineSeries(c, wind.values, wind.scale, plot, '#959595', 1.2 + audioLevel * 1.4, [1, 3]);

    c.font = '10px "IBM Plex Mono", "JetBrains Mono", monospace';
    c.textAlign = 'left';
    c.fillStyle = '#e8e8e8';
    c.fillText('temp', plot.x + 4, plot.y + 12);
    c.fillStyle = '#bfbfbf';
    c.fillText('rain', plot.x + 42, plot.y + 12);
    c.fillStyle = '#959595';
    c.fillText('wind', plot.x + 78, plot.y + 12);
}

function _drawDonkiVisualizer(
    c: CanvasRenderingContext2D,
    w: number,
    h: number,
    frames: SynthesisFrame[],
    nowMs: number,
    audioLevel: number,
): void {
    const body = _metricSeries(frames, 'body');
    const age = _metricSeries(frames, 'age');
    const type = _metricSeries(frames, 'type');

    const plot = { x: 10, y: 8, w: w - 20, h: h - 20 };
    _drawBox(c, plot.x, plot.y, plot.w, plot.h);

    const n = Math.min(body.values.length, 72);
    const barW = plot.w / Math.max(1, n);
    for (let i = 0; i < n; i++) {
        const idx = body.values.length - n + i;
        const b = body.values[idx] ?? 0;
        const bh = _toNorm(b, body.scale.min, body.scale.max) * plot.h;
        const x = plot.x + i * barW;
        c.fillStyle = i === n - 1 ? '#f2f2f2' : 'rgba(216, 216, 216, 0.56)';
        c.fillRect(x, plot.y + plot.h - bh, Math.max(1, barW - 1), bh);
    }

    _drawLineSeries(c, age.values.slice(-n), age.scale, plot, '#9d9d9d', 1.1 + audioLevel * 0.8, [3, 2]);
    _drawLineSeries(c, type.values.slice(-n), type.scale, plot, '#747474', 1 + audioLevel * 0.7, [1, 3]);

    const latestAge = age.values[age.values.length - 1] ?? 0;
    const pulse = (Math.sin(nowMs * 0.006) * 0.5 + 0.5) * (0.3 + audioLevel * 0.7);
    const pulseR = 6 + pulse * 14 + _toNorm(latestAge, age.scale.min, age.scale.max) * 10;
    c.strokeStyle = 'rgba(245, 245, 245, 0.76)';
    c.lineWidth = 1.3;
    c.beginPath();
    c.arc(plot.x + plot.w - 22, plot.y + 18, pulseR, 0, Math.PI * 2);
    c.stroke();

    c.fillStyle = '#a1a1a1';
    c.font = '10px "IBM Plex Mono", "JetBrains Mono", monospace';
    c.textAlign = 'left';
    c.fillText(`body ${_fmtNum(body.values[body.values.length - 1] ?? 0)} char`, plot.x + 6, plot.y + 12);
}

function _drawGdeltVisualizer(
    c: CanvasRenderingContext2D,
    w: number,
    h: number,
    frames: SynthesisFrame[],
    nowMs: number,
    audioLevel: number,
): void {
    const count = _metricSeries(frames, 'count');
    const day = _metricSeries(frames, 'day');

    const plot = { x: 10, y: 8, w: w - 20, h: h - 20 };
    _drawBox(c, plot.x, plot.y, plot.w, plot.h);

    const n = Math.min(count.values.length, 64);
    const barW = plot.w / Math.max(1, n);
    for (let i = 0; i < n; i++) {
        const idx = count.values.length - n + i;
        const vn = _toNorm(count.values[idx], count.scale.min, count.scale.max);
        const bh = vn * plot.h;
        const x = plot.x + i * barW;
        c.fillStyle = i === n - 1 ? '#f2f2f2' : `rgba(219, 219, 219, ${(0.34 + audioLevel * 0.35).toFixed(3)})`;
        c.fillRect(x, plot.y + plot.h - bh, Math.max(1, barW - 1), bh);
    }

    _drawLineSeries(c, day.values.slice(-n), day.scale, plot, '#8e8e8e', 1.1 + audioLevel * 1.2, [2, 3]);

    const sweep = (nowMs * 0.001 * (0.25 + audioLevel * 0.6)) % 1;
    const sx = plot.x + sweep * plot.w;
    c.strokeStyle = `rgba(240, 240, 240, ${(0.38 + audioLevel * 0.46).toFixed(3)})`;
    c.setLineDash([3, 3]);
    c.beginPath();
    c.moveTo(sx, plot.y);
    c.lineTo(sx, plot.y + plot.h);
    c.stroke();
    c.setLineDash([]);

    const latest = count.values[count.values.length - 1] ?? 0;
    c.fillStyle = '#9f9f9f';
    c.font = '10px "IBM Plex Mono", "JetBrains Mono", monospace';
    c.textAlign = 'left';
    c.fillText(`${Math.round(latest)} events`, plot.x + 6, plot.y + 12);
}

function _drawApodVisualizer(
    c: CanvasRenderingContext2D,
    w: number,
    h: number,
    frames: SynthesisFrame[],
    nowMs: number,
    audioLevel: number,
): void {
    const explain = _metricSeries(frames, 'explain');
    const title = _metricSeries(frames, 'title');
    const day = _metricSeries(frames, 'day');

    const plot = { x: 12, y: 10, w: w - 24, h: h - 22 };
    _drawBox(c, plot.x, plot.y, plot.w, plot.h);

    // Star texture.
    for (let i = 0; i < 42; i++) {
        const seed = i * 31.17;
        const x = plot.x + _hash(seed) * plot.w;
        const y = plot.y + _hash(seed + 2.7) * plot.h;
        const blink = 0.3 + 0.7 * (Math.sin(nowMs * 0.0012 + seed) * 0.5 + 0.5);
        c.fillStyle = `rgba(255, 255, 255, ${(0.12 + blink * 0.2).toFixed(3)})`;
        c.fillRect(x, y, 1.2, 1.2);
    }

    _drawLineSeries(c, explain.values, explain.scale, plot, '#e6e6e6', 1.35 + audioLevel * 1.1, []);
    _drawLineSeries(c, title.values, title.scale, plot, '#b0b0b0', 1.1 + audioLevel * 0.6, [4, 3]);

    const latestDay = day.values[day.values.length - 1] ?? 1;
    const angle = (latestDay / 31) * Math.PI * 2 + nowMs * 0.0004;
    const cx = plot.x + plot.w * 0.86;
    const cy = plot.y + plot.h * 0.28;
    const r = 12 + audioLevel * 6;
    c.strokeStyle = '#8f8f8f';
    c.beginPath();
    c.arc(cx, cy, r, 0, Math.PI * 2);
    c.stroke();
    c.fillStyle = '#f0f0f0';
    c.beginPath();
    c.arc(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r, 2.8 + audioLevel * 2.4, 0, Math.PI * 2);
    c.fill();

    c.fillStyle = '#a1a1a1';
    c.font = '10px "IBM Plex Mono", "JetBrains Mono", monospace';
    c.textAlign = 'left';
    c.fillText(
        `text ${_fmtNum(explain.values[explain.values.length - 1] ?? 0)} / title ${_fmtNum(title.values[title.values.length - 1] ?? 0)}`,
        plot.x + 6,
        plot.y + 12,
    );
}

function _drawExoplanetVisualizer(
    c: CanvasRenderingContext2D,
    w: number,
    h: number,
    frames: SynthesisFrame[],
    nowMs: number,
    audioLevel: number,
): void {
    const latest = frames[frames.length - 1];
    const mass = _metric(latest, 'mass');
    const orb = _metric(latest, 'orb');
    const year = _metric(latest, 'year');

    const massNorm = mass ? _metricNorm(mass) : 0.3;
    const orbNorm = orb ? _metricNorm(orb) : 0.5;
    const yearNorm = year ? _metricNorm(year) : 0.5;

    const cx = w * 0.5;
    const cy = h * 0.5;
    const orbitR = Math.min(w, h) * (0.18 + orbNorm * 0.3);

    c.fillStyle = '#f0f0f0';
    c.beginPath();
    c.arc(cx, cy, 5, 0, Math.PI * 2);
    c.fill();

    c.strokeStyle = '#2b2b2b';
    c.lineWidth = 1;
    for (let i = 0; i < 3; i++) {
        const r = orbitR * (0.7 + i * 0.28);
        c.beginPath();
        c.ellipse(cx, cy, r, r * 0.55, 0, 0, Math.PI * 2);
        c.stroke();
    }

    const angle = nowMs * 0.001 * (0.2 + (1 - orbNorm) * 0.6 + audioLevel * 1.2) + yearNorm * Math.PI * 2;
    const px = cx + Math.cos(angle) * orbitR;
    const py = cy + Math.sin(angle) * orbitR * 0.55;

    c.strokeStyle = 'rgba(220, 220, 220, 0.55)';
    c.beginPath();
    c.moveTo(cx, cy);
    c.lineTo(px, py);
    c.stroke();

    c.fillStyle = '#ffffff';
    c.beginPath();
    c.arc(px, py, 2 + massNorm * 4.5 + audioLevel * 5, 0, Math.PI * 2);
    c.fill();

    c.fillStyle = '#9f9f9f';
    c.font = '10px "IBM Plex Mono", "JetBrains Mono", monospace';
    c.textAlign = 'left';
    c.fillText(`mass ${_fmtNum(mass?.value ?? latest.inputValue)} mE  orb ${_fmtNum(orb?.value ?? 0)} d`, 8, 12);
}

function _drawSynthCanvas(
    trackId: string,
    runtime: TrackRuntime | null,
    _isPlaying: boolean,
): void {
    const canvas = document.getElementById(`params-${trackId}`) as HTMLCanvasElement | null;
    if (!canvas) return;

    const prepared = _prepareCanvas(canvas);
    if (!prepared) return;
    const { c, w, h } = prepared;

    c.fillStyle = '#040404';
    c.fillRect(0, 0, w, h);

    if (!runtime || runtime.synthBuffer.length === 0) {
        _drawIdleText(c, w, h, '等待聲音影格 / Awaiting synthesis frame');
        return;
    }

    const frames = runtime.synthBuffer.slice(-SYNTH_BUF_LEN);
    const audioLevel = _sampleAudioLevel(runtime.analyser);
    const envelopeSeries = _safeSeries(frames.map(f =>
        (f.envelopeAttack + f.envelopeRelease) / Math.max(0.01, f.duration),
    ));
    const ampSeries = _safeSeries(frames.map(f => f.amplitude));
    const freqSeries = _safeSeries(frames.map(f => f.frequency));
    const phaseSeries = _safeSeries(frames.map(f => f.phase));
    const offsetSeries = _safeSeries(frames.map(f => f.offset));
    const durSeries = _safeSeries(frames.map(f => f.duration));
    const modSeries = _safeSeries(frames.map(f => f.modulationDepth));

    if (!ampSeries.length || !freqSeries.length) {
        _drawIdleText(c, w, h, '聲音影格無效 / Invalid synthesis frame');
        return;
    }

    const lanes: {
        label: string;
        values: number[];
        scale: { min: number; max: number };
        fmt: (v: number) => string;
        dash: number[];
    }[] = [
        { label: 'amp', values: ampSeries, scale: { min: 0, max: 1 }, fmt: v => _fmtNum(v), dash: [] },
        { label: 'freq', values: freqSeries, scale: _autoScale(freqSeries), fmt: v => `${_fmtNum(v)}Hz`, dash: [4, 2] },
        { label: 'phase', values: phaseSeries, scale: { min: 0, max: Math.PI * 2 }, fmt: v => `${_fmtNum(v)}rad`, dash: [1, 2] },
        { label: 'offset', values: offsetSeries, scale: { min: -0.55, max: 0.55 }, fmt: v => _fmtNum(v), dash: [7, 3] },
        { label: 'dur', values: durSeries, scale: _autoScale(durSeries), fmt: v => `${_fmtNum(v)}s`, dash: [] },
        { label: 'env', values: envelopeSeries, scale: _autoScale(envelopeSeries), fmt: v => _fmtNum(v), dash: [3, 3] },
        { label: 'mod', values: modSeries, scale: _autoScale(modSeries), fmt: v => _fmtNum(v), dash: [1, 4] },
    ];

    const pad = { l: 58, r: 24, t: 8, b: 8 };
    const gw = Math.max(4, w - pad.l - pad.r);
    const gh = Math.max(4, h - pad.t - pad.b);
    const laneH = gh / lanes.length;

    c.strokeStyle = '#1a1a1a';
    c.lineWidth = 1;
    for (let i = 0; i <= lanes.length; i++) {
        const y = pad.t + laneH * i;
        c.beginPath();
        c.moveTo(pad.l, y);
        c.lineTo(pad.l + gw, y);
        c.stroke();
    }

    c.strokeStyle = '#242424';
    c.strokeRect(pad.l, pad.t, gw, gh);

    for (let i = 0; i < lanes.length; i++) {
        const lane = lanes[i];
        const top = pad.t + i * laneH;

        c.strokeStyle = '#e2e2e2';
        c.lineWidth = 1.1;
        c.setLineDash(lane.dash);
        c.beginPath();

        for (let j = 0; j < lane.values.length; j++) {
            const t = lane.values.length <= 1 ? 1 : j / (lane.values.length - 1);
            const x = pad.l + t * gw;
            const yNorm = _toNorm(lane.values[j], lane.scale.min, lane.scale.max);
            const y = top + (1 - yNorm) * (laneH - 2) + 1;
            if (j === 0) c.moveTo(x, y);
            else c.lineTo(x, y);
        }
        c.stroke();
        c.setLineDash([]);

        const latest = lane.values[lane.values.length - 1] ?? 0;
        c.fillStyle = '#a8a8a8';
        c.font = '10px "IBM Plex Mono", "JetBrains Mono", monospace';
        c.textAlign = 'left';
        c.fillText(lane.label, 6, top + laneH * 0.65);

        c.fillStyle = '#d0d0d0';
        c.textAlign = 'right';
        c.fillText(lane.fmt(latest), w - 25, top + laneH * 0.65);
    }

    const meterH = Math.max(2, gh * audioLevel);
    const meterX = w - 15;
    const meterY = pad.t + gh - meterH;
    c.strokeStyle = '#2f2f2f';
    c.strokeRect(meterX - 2, pad.t, 8, gh);
    c.fillStyle = '#f0f0f0';
    c.fillRect(meterX, meterY, 4, meterH);

    const f = frames[frames.length - 1];
    c.fillStyle = '#6f6f6f';
    c.font = '10px "IBM Plex Mono", "JetBrains Mono", monospace';
    c.textAlign = 'center';
    c.fillText(`env attack ${_fmtNum(f.envelopeAttack)} / release ${_fmtNum(f.envelopeRelease)} | mod rate ${_fmtNum(f.modulationRate)}Hz`, w * 0.5, h - 3);
}

function _drawWaveCanvas(
    trackId: string,
    runtime: TrackRuntime | null,
    _isPlaying: boolean,
): void {
    const canvas = document.getElementById(`waveform-${trackId}`) as HTMLCanvasElement | null;
    if (!canvas) return;

    const prepared = _prepareCanvas(canvas);
    if (!prepared) return;
    const { c, w, h } = prepared;

    c.fillStyle = '#040404';
    c.fillRect(0, 0, w, h);

    c.strokeStyle = '#191919';
    c.lineWidth = 1;
    for (let i = 1; i <= 5; i++) {
        const x = (w / 6) * i;
        c.beginPath();
        c.moveTo(x, 0);
        c.lineTo(x, h);
        c.stroke();
    }

    const mid = h * 0.5;
    c.strokeStyle = '#2a2a2a';
    c.beginPath();
    c.moveTo(0, mid);
    c.lineTo(w, mid);
    c.stroke();

    if (!runtime) {
        _drawIdleText(c, w, h, '靜音 / Silent');
        return;
    }

    const bufLen = runtime.analyser.frequencyBinCount;
    const data = new Float32Array(bufLen);
    runtime.analyser.getFloatTimeDomainData(data);

    let peak = 0;
    c.beginPath();
    const sliceW = w / Math.max(1, bufLen);
    let x = 0;
    for (let i = 0; i < bufLen; i++) {
        const sample = data[i];
        peak = Math.max(peak, Math.abs(sample));
        const y = ((sample + 1) * 0.5) * h;
        if (i === 0) c.moveTo(x, y);
        else c.lineTo(x, y);
        x += sliceW;
    }

    c.strokeStyle = '#f2f2f2';
    c.lineWidth = 1.4;
    c.stroke();

    if (runtime.latestFrame) {
        _drawModelWave(c, w, h, runtime.latestFrame);
    }

    c.fillStyle = '#adadad';
    c.font = '11px "IBM Plex Mono", "JetBrains Mono", monospace';
    c.textAlign = 'right';
    const frameTxt = runtime.latestFrame ? ` | f ${_fmtNum(runtime.latestFrame.frequency)}Hz` : '';
    c.fillText(`actual amp ${Math.round(peak * 100)}%${frameTxt}`, w - 6, 12);
}

function _drawModelWave(c: CanvasRenderingContext2D, w: number, h: number, frame: SynthesisFrame): void {
    const mid = h * 0.5;
    const ampPx = frame.amplitude * h * 0.24;
    const offsetPx = frame.offset * h * 0.22;

    c.beginPath();
    for (let i = 0; i < w; i++) {
        const t = (i / Math.max(1, w)) * Math.PI * 4;
        const mod = Math.sin(t * (frame.modulationRate * 0.06 + 0.2)) *
            (frame.modulationDepth / Math.max(1, frame.frequency));
        const y = mid + offsetPx - (Math.sin(t + frame.phase + mod) * ampPx);
        if (i === 0) c.moveTo(i, y);
        else c.lineTo(i, y);
    }
    c.strokeStyle = 'rgba(171, 171, 171, 0.95)';
    c.lineWidth = 1.1;
    c.setLineDash([5, 4]);
    c.stroke();
    c.setLineDash([]);

    c.fillStyle = '#8c8c8c';
    c.font = '10px "IBM Plex Mono", "JetBrains Mono", monospace';
    c.textAlign = 'left';
    c.fillText('模型波形 / Model wave', 6, 12);
}

function _drawContext(
    trackId: string,
    sourceId: string,
    dataMode: string,
    soundMode: string,
    runtime: TrackRuntime | null,
    isPlaying: boolean,
): void {
    const el = document.getElementById(`context-${trackId}`);
    if (!el) return;

    if (runtime?.latestContext) {
        el.textContent = runtime.latestContext;
        return;
    }

    const source = DATA_SOURCES.find(s => s.id === sourceId);
    const state = isPlaying ? '串流中 / Streaming' : '閒置 / Idle';
    el.textContent = `${source?.desc ?? sourceId} · ${_labelMode(dataMode)} · ${_labelSoundMode(soundMode)} · ${state}`;
}

function _drawMapping(trackId: string, sourceId: DataSourceId, runtime: TrackRuntime | null): void {
    const el = document.getElementById(`mapping-${trackId}`);
    if (!el) return;

    if (!runtime?.latestFrame) {
        el.innerHTML = `<div class="map-empty">等待指標對應 / Awaiting metric mapping…</div>`;
        (el as HTMLElement).dataset.frameKey = '';
        return;
    }

    const frame = runtime.latestFrame;
    const frameKey = `${frame.timestamp}:${frame.sourceMode}:${frame.soundMode}`;
    if ((el as HTMLElement).dataset.frameKey === frameKey) return;
    (el as HTMLElement).dataset.frameKey = frameKey;
    const source = DATA_SOURCES.find(s => s.id === sourceId);
    const modeText = `${_labelMode(frame.sourceMode)} / ${_labelSoundMode(frame.soundMode)}`;

    const metricRows = frame.metrics
        .map(metric => {
            const metricValue = `${_fmtNum(metric.value)}${metric.unit ? ` ${metric.unit}` : ''}`;
            const progress = Math.round(_metricNorm(metric) * 100);
            const targets = metric.affects
                .map(target => `<span class="map-target-chip">${_esc(_labelTarget(target))}</span>`)
                .join('');
            return `
                <div class="map-row">
                    <div class="map-metric">
                        <div class="map-field">
                            <strong>${_esc(_localizedMetricLabel(metric.label))}</strong>
                            <span>${_esc(metricValue)}</span>
                        </div>
                        <div class="map-meter" aria-hidden="true">
                            <span style="width:${progress}%"></span>
                        </div>
                    </div>
                    <div class="map-arrow">→</div>
                    <div class="map-targets">${targets}</div>
                </div>
            `;
        })
        .join('');

    const frameCards = [
        ['振幅 / Amplitude', _fmtNum(frame.amplitude)],
        ['頻率 / Frequency', `${_fmtNum(frame.frequency)} Hz`],
        ['相位 / Phase', _fmtNum(frame.phase)],
        ['偏移 / Offset', _fmtNum(frame.offset)],
        ['時長 / Duration', `${_fmtNum(frame.duration)} s`],
        ['包絡 / Envelope', `A ${_fmtNum(frame.envelopeAttack)} / R ${_fmtNum(frame.envelopeRelease)}`],
        ['調變 / Modulation', `${_fmtNum(frame.modulationRate)} Hz / ${_fmtNum(frame.modulationDepth)}`],
    ]
        .map(([label, value]) => `
            <div class="map-frame-card">
                <div class="map-frame-label">${_esc(label)}</div>
                <div class="map-frame-value">${_esc(value)}</div>
            </div>
        `)
        .join('');

    el.innerHTML = `
        <div class="map-head">
            <div class="map-source">
                <div class="map-kicker">translation board / 轉譯板</div>
                <strong>${_esc(source?.label ?? sourceId)}</strong>
            </div>
            <div class="map-mode">${_esc(modeText)}</div>
        </div>
        <div class="map-title">資料欄位如何推動聲音 / How API metrics push the synth</div>
        <div class="map-grid">${metricRows}</div>
        <div class="map-title">當前聲音結果 / Current synthesis frame</div>
        <div class="map-frame-grid">${frameCards}</div>
    `;
}

function _drawNowPlaying(): void {
    const el = document.getElementById('now-playing');
    if (!el) return;

    const activeTracks = tracks.filter(track => track.isPlaying);
    if (!activeTracks.length) {
        el.textContent = '尚未開始，先新增軌道再播放 / Add a track and press play';
        return;
    }

    if (activeTracks.length === 1) {
        const track = activeTracks[0];
        const runtime = runtimes.get(track.id) ?? null;
        const source = DATA_SOURCES.find(item => item.id === track.dataSource);
        const summary = runtime?.latestContext ?? `${source?.desc ?? track.dataSource} · ${_labelMode(track.dataMode)} · ${_labelSoundMode(track.soundMode)}`;
        el.textContent = `${track.name} — ${summary}`;
        return;
    }

    const mostRecent = activeTracks
        .slice()
        .sort((a, b) => {
            const aTs = runtimes.get(a.id)?.latestFrame?.timestamp ?? 0;
            const bTs = runtimes.get(b.id)?.latestFrame?.timestamp ?? 0;
            return bTs - aTs;
        })[0];

    const names = activeTracks.slice(0, 3).map(track => track.name).join(' / ');
    const extra = activeTracks.length > 3 ? ` +${activeTracks.length - 3}` : '';
    const recentRuntime = mostRecent ? (runtimes.get(mostRecent.id) ?? null) : null;
    const recentSummary = mostRecent && recentRuntime?.latestContext
        ? `${mostRecent.name}: ${recentRuntime.latestContext}`
        : `${names}${extra}`;

    el.textContent = `${activeTracks.length} 條軌道正在播放 / tracks active — ${recentSummary}`;
}

function _labelTarget(target: string): string {
    switch (target) {
        case 'amplitude': return '振幅 / Amplitude';
        case 'frequency': return '頻率 / Frequency';
        case 'phase': return '相位 / Phase';
        case 'offset': return '偏移 / Offset';
        case 'duration': return '時長 / Duration';
        case 'envelope': return '包絡 / Envelope';
        case 'modulation': return '調變 / Modulation';
        default: return target;
    }
}

function _labelMode(mode: string): string {
    return mode === 'live' ? '即時 / Live' : '快照 / Snapshot';
}

function _labelSoundMode(mode: string): string {
    return mode === 'continuous' ? '連續 / Continuous' : '步進 / Step';
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

function _drawBox(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
    c.strokeStyle = '#252525';
    c.lineWidth = 1;
    c.strokeRect(x, y, w, h);
}

function _drawAxisGrid(
    c: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    cols: number,
    rows: number,
): void {
    c.strokeStyle = '#1b1b1b';
    c.lineWidth = 1;

    for (let i = 0; i <= cols; i++) {
        const xx = x + (w / cols) * i;
        c.beginPath();
        c.moveTo(xx, y);
        c.lineTo(xx, y + h);
        c.stroke();
    }

    for (let i = 0; i <= rows; i++) {
        const yy = y + (h / rows) * i;
        c.beginPath();
        c.moveTo(x, yy);
        c.lineTo(x + w, yy);
        c.stroke();
    }

    c.strokeStyle = '#2a2a2a';
    c.strokeRect(x, y, w, h);
}

function _drawLineSeries(
    c: CanvasRenderingContext2D,
    values: number[],
    scale: { min: number; max: number },
    plot: { x: number; y: number; w: number; h: number },
    color: string,
    width: number,
    dash: number[] = [],
): void {
    if (!values.length) return;

    c.beginPath();
    for (let i = 0; i < values.length; i++) {
        const t = values.length <= 1 ? 1 : i / (values.length - 1);
        const x = plot.x + t * plot.w;
        const y = plot.y + (1 - _toNorm(values[i], scale.min, scale.max)) * plot.h;
        if (i === 0) c.moveTo(x, y);
        else c.lineTo(x, y);
    }

    c.strokeStyle = color;
    c.lineWidth = width;
    c.setLineDash(dash);
    c.stroke();
    c.setLineDash([]);
}

function _metricSeries(frames: SynthesisFrame[], key: string): { values: number[]; scale: { min: number; max: number } } {
    const values: number[] = [];

    for (const frame of frames) {
        const metric = _metric(frame, key);
        if (!metric) continue;
        values.push(metric.value);
    }

    if (!values.length) return { values, scale: { min: 0, max: 1 } };
    return { values, scale: _autoScale(values) };
}

function _safeSeries(values: number[]): number[] {
    const out: number[] = [];
    let last = 0;
    for (const value of values) {
        const clean = Number.isFinite(value) ? value : last;
        out.push(clean);
        last = clean;
    }
    return out;
}

function _metric(frame: SynthesisFrame, key: string): InputMetric | undefined {
    return frame.metrics.find(m => m.key === key);
}

function _metricNorm(metric: InputMetric): number {
    if (metric.min !== undefined && metric.max !== undefined && metric.max > metric.min) {
        return _clamp((metric.value - metric.min) / (metric.max - metric.min), 0, 1);
    }
    return 0.5;
}

function _drawIdleText(c: CanvasRenderingContext2D, w: number, h: number, text: string): void {
    c.fillStyle = '#595959';
    c.font = '11px "IBM Plex Mono", "JetBrains Mono", monospace';
    c.textAlign = 'center';
    c.fillText(text, w * 0.5, h * 0.55);
}

function _autoScale(values: number[]): { min: number; max: number } {
    if (!values.length) return { min: 0, max: 1 };

    let min = Math.min(...values);
    let max = Math.max(...values);

    if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1 };

    if (min === max) {
        const pad = Math.max(1, Math.abs(min) * 0.05);
        min -= pad;
        max += pad;
    } else {
        const pad = (max - min) * 0.08;
        min -= pad;
        max += pad;
    }

    return { min, max };
}

function _toNorm(v: number, min: number, max: number): number {
    if (!Number.isFinite(v)) return 0.5;
    if (max <= min) return 0.5;
    return _clamp((v - min) / (max - min), 0, 1);
}

function _prepareCanvas(
    canvas: HTMLCanvasElement,
): { c: CanvasRenderingContext2D; w: number; h: number } | null {
    const rect = canvas.getBoundingClientRect();
    const cssW = Math.max(1, Math.floor(rect.width));
    const cssH = Math.max(1, Math.floor(rect.height));
    const dpr = Math.max(1, Math.floor((window.devicePixelRatio || 1) * 100) / 100);

    const pxW = Math.floor(cssW * dpr);
    const pxH = Math.floor(cssH * dpr);

    if (canvas.width !== pxW || canvas.height !== pxH) {
        canvas.width = pxW;
        canvas.height = pxH;
    }

    const c = canvas.getContext('2d');
    if (!c) return null;

    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { c, w: cssW, h: cssH };
}

function _drawErrorCanvas(canvasId: string, text: string): void {
    const canvas = document.getElementById(canvasId) as HTMLCanvasElement | null;
    if (!canvas) return;
    const prepared = _prepareCanvas(canvas);
    if (!prepared) return;
    const { c, w, h } = prepared;
    c.fillStyle = '#060606';
    c.fillRect(0, 0, w, h);
    c.strokeStyle = '#2a2a2a';
    c.strokeRect(1, 1, w - 2, h - 2);
    _drawIdleText(c, w, h, text);
}

function _sampleAudioLevel(analyser: AnalyserNode): number {
    const len = analyser.frequencyBinCount;
    if (!len) return 0;
    const data = new Float32Array(len);
    analyser.getFloatTimeDomainData(data);
    let peak = 0;
    for (let i = 0; i < data.length; i++) {
        const abs = Math.abs(data[i]);
        if (abs > peak) peak = abs;
    }
    return _clamp(peak, 0, 1);
}

function _hash(v: number): number {
    const s = Math.sin(v * 1234.567 + 0.987) * 43758.5453;
    return s - Math.floor(s);
}

function _clamp(v: number, lo: number, hi: number): number {
    return Math.max(lo, Math.min(hi, v));
}

function _fmtNum(v: number): string {
    if (!Number.isFinite(v)) return '0';
    if (Math.abs(v) >= 1000) return Math.round(v).toString();
    if (Math.abs(v) >= 100) return v.toFixed(1);
    if (Math.abs(v) >= 10) return v.toFixed(2);
    return v.toFixed(3);
}

function _esc(s: string): string {
    return s
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}
