/**
 * Track board UI — rendering and interaction.
 *
 * Each card keeps the whole translation chain visible:
 *   • title + transport
 *   • source-specific data view
 *   • synthesis and waveform views
 *   • source / sound / routing controls
 *   • runtime context
 *   • metric -> synthesis translation board
 */

import { tracks, runtimes, createTrack, DATA_SOURCES } from './track-state';
import type { Track } from './track-state';
import {
    AUDIO_READY_EVENT,
    ensureTrackRuntime,
    removeTrackRuntime,
    getMaxChannels,
    rerouteTrack,
    getAudioContext,
} from './track-engine';
import { startDataSource } from './track-datasource';
import { startTrackVisualizer } from './track-visualizer';

type UiTrackState = 'idle' | 'loading' | 'refreshing' | 'stopped' | 'streaming';

const WAVEFORMS: { id: OscillatorType; label: string }[] = [
    { id: 'sine', label: '正弦 / Sine' },
    { id: 'triangle', label: '三角 / Triangle' },
    { id: 'sawtooth', label: '鋸齒 / Saw' },
    { id: 'square', label: '方波 / Square' },
];

const DATA_SOURCE_MAP = new Map(DATA_SOURCES.map(s => [s.id, s]));
const DATA_MODES = [
    { id: 'live', label: '即時 / Live' },
    { id: 'snapshot', label: '快照 / Snapshot' },
] as const;
const SOUND_MODES = [
    { id: 'discrete', label: '步進 / Step' },
    { id: 'continuous', label: '連續 / Continuous' },
] as const;
const ICON_PLAY = `
    <span class="btn-icon" aria-hidden="true">
        <svg class="icon-fill" viewBox="0 0 16 16">
            <path d="M4 3.5v9l8-4.5z"></path>
        </svg>
    </span>
`;
const ICON_STOP = `
    <span class="btn-icon" aria-hidden="true">
        <svg class="icon-fill" viewBox="0 0 16 16">
            <rect x="4" y="4" width="8" height="8"></rect>
        </svg>
    </span>
`;
const ICON_REMOVE = `
    <span class="btn-icon" aria-hidden="true">
        <svg viewBox="0 0 16 16">
            <path d="M4 4l8 8M12 4 4 12"></path>
        </svg>
    </span>
`;

// ── Bootstrap ────────────────────────────────────────────────────────────────

export function initTrackBoard(): void {
    if (tracks.length === 0) {
        tracks.push(createTrack(0));
    }
    startTrackVisualizer();
    window.addEventListener(AUDIO_READY_EVENT, _handleAudioReady as EventListener);
    _wireGlobalControls();
    _renderTrackList();
    _updateChannelInfo();
}

// ── Global controls ──────────────────────────────────────────────────────────

function _wireGlobalControls(): void {
    document.getElementById('track-add-btn')!.addEventListener('click', () => {
        const autoChannel = tracks.length % getMaxChannels();
        tracks.push(createTrack(autoChannel));
        _renderTrackList();
        _updateChannelInfo();
    });

    document.getElementById('track-play-all-btn')!.addEventListener('click', () => {
        getAudioContext();
        for (const track of tracks) if (!track.isPlaying) _playTrack(track);
    });

    document.getElementById('track-stop-all-btn')!.addEventListener('click', () => {
        for (const track of tracks) if (track.isPlaying) _stopTrack(track);
    });
}

function _updateChannelInfo(): void {
    const el = document.getElementById('track-channel-info');
    if (!el) return;
    const channels = getMaxChannels();
    el.textContent = `輸出 ${channels} 聲道 / ${channels} ch`;
}

function _handleAudioReady(): void {
    _renderTrackList();
    _updateChannelInfo();
}

// ── Play / Stop ──────────────────────────────────────────────────────────────

function _playTrack(track: Track): void {
    if (track.isPlaying) return;
    const runtime = ensureTrackRuntime(track);
    runtime.latestContext = _contextCopy(track, 'loading');
    runtime.stopSource = startDataSource(track, runtime);
    track.isPlaying = true;
    _refreshTrackCard(track.id);
}

function _stopTrack(track: Track): void {
    if (!track.isPlaying) return;
    const runtime = runtimes.get(track.id);
    if (runtime?.stopSource) {
        try { runtime.stopSource(); } catch { /* already stopped */ }
        runtime.stopSource = null;
        runtime.latestContext = _contextCopy(track, 'stopped');
    }
    track.isPlaying = false;
    _refreshTrackCard(track.id);
}

function _removeTrack(trackId: string): void {
    if (tracks.length <= 1) return;
    const idx = tracks.findIndex(track => track.id === trackId);
    if (idx === -1) return;
    _stopTrack(tracks[idx]);
    removeTrackRuntime(trackId);
    tracks.splice(idx, 1);
    _renderTrackList();
    _updateChannelInfo();
}

// ── Render ───────────────────────────────────────────────────────────────────

function _renderTrackList(): void {
    const container = document.getElementById('track-list')!;
    if (tracks.length === 0) {
        tracks.push(createTrack(0));
    }

    container.innerHTML = '';
    const disableRemove = tracks.length <= 1;
    tracks.forEach((track, index) => {
        container.appendChild(_buildTrackEl(track, disableRemove, index));
    });
}

function _buildTrackEl(track: Track, disableRemove: boolean, index: number): HTMLElement {
    const maxCh = getMaxChannels();
    const channelOptions = Array.from({ length: maxCh }, (_, i) => {
        const selected = track.outputChannel === i ? ' selected' : '';
        return `<option value="${i}"${selected}>聲道 ${i + 1} / Ch ${i + 1}</option>`;
    }).join('');

    const sourceOptions = DATA_SOURCES.map(source => {
        const selected = track.dataSource === source.id ? ' selected' : '';
        return `<option value="${source.id}"${selected}>${source.label}</option>`;
    }).join('');

    const waveOptions = WAVEFORMS.map(wave => {
        const selected = track.waveform === wave.id ? ' selected' : '';
        return `<option value="${wave.id}"${selected}>${wave.label}</option>`;
    }).join('');

    const dataModeOptions = DATA_MODES.map(mode => {
        const selected = track.dataMode === mode.id ? ' selected' : '';
        return `<option value="${mode.id}"${selected}>${mode.label}</option>`;
    }).join('');

    const soundModeOptions = SOUND_MODES.map(mode => {
        const selected = track.soundMode === mode.id ? ' selected' : '';
        return `<option value="${mode.id}"${selected}>${mode.label}</option>`;
    }).join('');

    const div = document.createElement('div');
    div.className = `track-card${track.isPlaying ? ' playing' : ''}`;
    div.dataset.trackId = track.id;

    div.innerHTML = `
        <div class="track-header">
            <div class="track-title-block">
                <span class="track-order">軌道 ${index + 1} / Track ${index + 1}</span>
                <input class="track-name-input" type="text" value="${track.name}" spellcheck="false" />
            </div>
            <div class="track-header-actions">
                <button class="btn track-play-btn${track.isPlaying ? ' active' : ''}">
                    ${_trackPlayButtonInner(track)}
                </button>
                <button class="btn track-remove-btn" title="刪除軌道 / Remove track" ${disableRemove ? 'disabled' : ''}>${ICON_REMOVE}</button>
            </div>
        </div>

        <div class="track-context" id="context-${track.id}">
            ${_contextCopy(track, 'idle')}
        </div>

        <div class="track-viz track-viz-primary">
            <div class="track-viz-row">
                <span class="track-viz-label" id="viz-label-${track.id}">${_sourceVizLabel(track.dataSource)}</span>
                <canvas class="track-canvas track-canvas-data" id="data-${track.id}"></canvas>
            </div>
            <div class="track-viz-grid">
                <div class="track-viz-row">
                    <span class="track-viz-label">參數走勢 / Synthesis Parameters</span>
                    <canvas class="track-canvas track-canvas-params" id="params-${track.id}"></canvas>
                </div>
                <div class="track-viz-row">
                    <span class="track-viz-label">波形視窗 / Sound Waveform</span>
                    <canvas class="track-canvas track-canvas-wave" id="waveform-${track.id}"></canvas>
                </div>
            </div>
        </div>

        <div class="track-controls track-controls-grid">
            <label class="track-ctrl-group track-ctrl-group--wide">
                <span class="track-ctrl-label">資料來源 / Source</span>
                <select class="track-select" data-type="source">${sourceOptions}</select>
            </label>

            <label class="track-ctrl-group">
                <span class="track-ctrl-label">資料模式 / Data</span>
                <select class="track-select" data-type="data-mode">${dataModeOptions}</select>
            </label>

            <label class="track-ctrl-group">
                <span class="track-ctrl-label">聲音模式 / Sound</span>
                <select class="track-select" data-type="sound-mode">${soundModeOptions}</select>
            </label>

            <label class="track-ctrl-group">
                <span class="track-ctrl-label">輸出 / Output</span>
                <select class="track-select" data-type="channel">${channelOptions}</select>
            </label>

            <label class="track-ctrl-group">
                <span class="track-ctrl-label">波形 / Wave</span>
                <select class="track-select" data-type="wave">${waveOptions}</select>
            </label>

            <label class="track-ctrl-group track-ctrl-group--wide">
                <span class="track-ctrl-row">
                    <span class="track-ctrl-label">音量 / Volume</span>
                    <span class="track-ctrl-val" id="vol-val-${track.id}">${Math.round(track.volume * 100)}%</span>
                </span>
                <input type="range" class="track-vol-slider" min="0" max="1" step="0.01" value="${track.volume}" />
            </label>

            <label class="track-ctrl-group track-ctrl-group--wide">
                <span class="track-ctrl-row">
                    <span class="track-ctrl-label">音高 / Pitch</span>
                    <span class="track-ctrl-val" id="pitch-val-${track.id}">${_fmtPitch(track.pitch)}</span>
                </span>
                <input type="range" class="track-pitch-slider" min="-36" max="0" step="1" value="${track.pitch}" />
            </label>

            <label class="track-ctrl-group track-ctrl-group--wide">
                <span class="track-ctrl-row">
                    <span class="track-ctrl-label">速度 / Speed</span>
                    <span class="track-ctrl-val" id="speed-val-${track.id}">${_fmtSpeed(track.speed)}x</span>
                </span>
                <input type="range" class="track-speed-slider" min="0.0005" max="4" step="0.0005" value="${track.speed}" />
            </label>
        </div>

        <section class="track-mapping" id="mapping-${track.id}" aria-label="API to sound translation board">
            等待指標對應 / Awaiting metric mapping…
        </section>
    `;

    div.querySelector<HTMLInputElement>('.track-name-input')!
        .addEventListener('input', event => {
            track.name = (event.target as HTMLInputElement).value;
        });

    div.querySelector<HTMLButtonElement>('.track-play-btn')!
        .addEventListener('click', () => {
            track.isPlaying ? _stopTrack(track) : _playTrack(track);
        });

    div.querySelector<HTMLButtonElement>('.track-remove-btn')!
        .addEventListener('click', () => _removeTrack(track.id));

    div.querySelector<HTMLSelectElement>('[data-type="source"]')!
        .addEventListener('change', event => {
            const value = (event.target as HTMLSelectElement).value as Track['dataSource'];
            const wasPlaying = track.isPlaying;
            if (wasPlaying) _stopTrack(track);
            track.dataSource = value;
            const vizLabel = document.getElementById(`viz-label-${track.id}`);
            if (vizLabel) vizLabel.textContent = _sourceVizLabel(value);
            _resetTrackBuffers(track, wasPlaying ? 'loading' : 'idle');
            if (wasPlaying) _playTrack(track);
        });

    div.querySelector<HTMLSelectElement>('[data-type="data-mode"]')!
        .addEventListener('change', event => {
            const mode = (event.target as HTMLSelectElement).value as Track['dataMode'];
            const wasPlaying = track.isPlaying;
            if (wasPlaying) _stopTrack(track);
            track.dataMode = mode;
            _resetTrackBuffers(track, wasPlaying ? 'loading' : 'idle');
            if (wasPlaying) _playTrack(track);
        });

    div.querySelector<HTMLSelectElement>('[data-type="sound-mode"]')!
        .addEventListener('change', event => {
            const mode = (event.target as HTMLSelectElement).value as Track['soundMode'];
            const wasPlaying = track.isPlaying;
            if (wasPlaying) _stopTrack(track);
            track.soundMode = mode;
            _setTrackContext(track, wasPlaying ? 'loading' : 'idle');
            if (wasPlaying) _playTrack(track);
        });

    div.querySelector<HTMLSelectElement>('[data-type="wave"]')!
        .addEventListener('change', event => {
            track.waveform = (event.target as HTMLSelectElement).value as OscillatorType;
        });

    div.querySelector<HTMLInputElement>('.track-vol-slider')!
        .addEventListener('input', event => {
            const volume = parseFloat((event.target as HTMLInputElement).value);
            track.volume = volume;
            const runtime = runtimes.get(track.id);
            if (runtime) runtime.gainNode.gain.value = volume;
            const label = document.getElementById(`vol-val-${track.id}`);
            if (label) label.textContent = `${Math.round(volume * 100)}%`;
        });

    div.querySelector<HTMLInputElement>('.track-pitch-slider')!
        .addEventListener('input', event => {
            const pitch = parseInt((event.target as HTMLInputElement).value, 10);
            track.pitch = pitch;
            const label = document.getElementById(`pitch-val-${track.id}`);
            if (label) label.textContent = _fmtPitch(pitch);
        });

    div.querySelector<HTMLInputElement>('.track-speed-slider')!
        .addEventListener('input', event => {
            const speed = parseFloat((event.target as HTMLInputElement).value);
            track.speed = speed;
            const label = document.getElementById(`speed-val-${track.id}`);
            if (label) label.textContent = `${_fmtSpeed(speed)}x`;
        });

    div.querySelector<HTMLSelectElement>('[data-type="channel"]')!
        .addEventListener('change', event => {
            const channel = parseInt((event.target as HTMLSelectElement).value, 10);
            track.outputChannel = channel;
            rerouteTrack(track.id, channel);
        });

    return div;
}

function _refreshTrackCard(trackId: string): void {
    const card = document.querySelector<HTMLElement>(`.track-card[data-track-id="${trackId}"]`);
    if (!card) return;
    const track = tracks.find(item => item.id === trackId);
    if (!track) return;

    card.classList.toggle('playing', track.isPlaying);
    const button = card.querySelector<HTMLButtonElement>('.track-play-btn');
    if (button) {
        button.innerHTML = _trackPlayButtonInner(track);
        button.classList.toggle('active', track.isPlaying);
    }
}

function _trackPlayButtonInner(track: Track): string {
    return `${track.isPlaying ? ICON_STOP : ICON_PLAY}${track.isPlaying ? '停止 / Stop' : '播放 / Play'}`;
}

function _sourceVizLabel(sourceId: Track['dataSource']): string {
    switch (sourceId) {
        case 'earthquake': return '地殼脈衝 / Seismic Pulse';
        case 'cwa_earthquake': return '台灣震動窗 / Taiwan Seismic Window';
        case 'ntu_buildings': return '校園掃描 / Campus Scan';
        case 'taipei_noise_stations': return '城市監測版圖 / Urban Noise Map';
        case 'taipei_rain': return '雨量脈衝 / Rain Pulse';
        case 'taiwan_aqi': return '島嶼空污場 / Island AQI Field';
        case 'waqi_asia': return '跨城 AQI 網路 / Cross-city AQI Mesh';
        case 'open_meteo': return '氣象模型場 / Weather Model Field';
        case 'gdelt_events': return '事件氣候 / Event Climate';
        case 'nasa_donki': return '太空天氣通知 / Space Weather Alerts';
        case 'nasa_apod': return '宇宙敘事場 / Cosmic Narrative';
        case 'exoplanets': return '軌道劇場 / Orbital Theatre';
        default: return '資料軌跡 / Data Timeline';
    }
}

function _fmtPitch(pitch: number): string {
    const sign = pitch > 0 ? '+' : '';
    return `${sign}${pitch} 半音`;
}

function _fmtSpeed(speed: number): string {
    if (speed < 0.01) return speed.toFixed(4);
    if (speed < 0.1) return speed.toFixed(3);
    if (speed < 1) return speed.toFixed(2);
    return speed.toFixed(1);
}

function _labelDataMode(mode: Track['dataMode']): string {
    return mode === 'live' ? '即時 / Live' : '快照 / Snapshot';
}

function _labelSoundMode(mode: Track['soundMode']): string {
    return mode === 'continuous' ? '連續 / Continuous' : '步進 / Step';
}

function _labelUiState(state: UiTrackState): string {
    switch (state) {
        case 'loading': return '載入中 / Loading';
        case 'refreshing': return '重新整理 / Refreshing';
        case 'stopped': return '已停止 / Stopped';
        case 'streaming': return '串流中 / Streaming';
        default: return '閒置 / Idle';
    }
}

function _contextCopy(track: Track, state: UiTrackState): string {
    const sourceText = DATA_SOURCE_MAP.get(track.dataSource)?.desc ?? track.dataSource;
    return `${sourceText} · ${_labelDataMode(track.dataMode)} · ${_labelSoundMode(track.soundMode)} · ${_labelUiState(state)}`;
}

function _setTrackContext(track: Track, state: UiTrackState): void {
    const context = _contextCopy(track, state);
    const runtime = runtimes.get(track.id);
    if (runtime) runtime.latestContext = context;
    const contextEl = document.getElementById(`context-${track.id}`);
    if (contextEl) contextEl.textContent = context;
}

function _resetTrackBuffers(track: Track, state: UiTrackState): void {
    const runtime = runtimes.get(track.id);
    const context = _contextCopy(track, state);
    if (runtime) {
        runtime.latestDataLabel = '';
        runtime.latestContext = context;
        runtime.latestMapping = '';
        runtime.latestFrame = null;
        runtime.dataBuffer.length = 0;
        runtime.synthBuffer.length = 0;
    }

    const contextEl = document.getElementById(`context-${track.id}`);
    if (contextEl) contextEl.textContent = context;

    const mappingEl = document.getElementById(`mapping-${track.id}`);
    if (mappingEl) {
        mappingEl.textContent = '等待指標對應 / Awaiting metric mapping…';
        mappingEl.removeAttribute('data-frame-key');
    }
}
