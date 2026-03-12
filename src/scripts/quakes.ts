import { magToFreq } from "./audio";
import { state } from "./state";
import type { Quake } from "./state";

export async function fetchQuakes(): Promise<void> {
    try {
        const res = await fetch(
            "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson",
        );
        const json = await res.json();

        state.quakes = json.features
            .filter((f: any) => f.properties.mag !== null)
            .slice(0, 80)
            .map(
                (f: any): Quake => ({
                    id: f.id,
                    mag: f.properties.mag,
                    place: f.properties.place ?? "未知位置 / Unknown location",
                    depth: f.geometry.coordinates[2],
                    time: f.properties.time,
                    freq: magToFreq(f.properties.mag),
                }),
            );

        renderList();
    } catch (e) {
        console.error(e);
        const container = document.getElementById("quake-list");
        if (container) {
            container.innerHTML =
                '<div class="loading">抓取失敗 / Failed to fetch</div>';
        }
    }
}

function formatTime(ts: number): string {
    return new Date(ts).toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

function magClass(mag: number): string {
    if (mag < 2.5) return "low";
    if (mag < 5) return "mid";
    return "high";
}

export function renderList(): void {
    const container = document.getElementById("quake-list");
    if (!container) return;
    container.innerHTML = "";
    container.className = "";

    for (const q of state.quakes) {
        const card = document.createElement("div");
        card.className = "quake-card";
        card.dataset.id = q.id;
        if (q.id === state.playingId) card.classList.add("playing");

        card.innerHTML = `
      <div class="mag-badge ${magClass(q.mag)}">${q.mag.toFixed(1)}</div>
      <div class="quake-info">
        <div class="quake-place">${q.place}</div>
        <div class="quake-meta">
          <span>depth ${q.depth.toFixed(1)} km</span>
          <span>${formatTime(q.time)}</span>
        </div>
        <div class="quake-freq">♩ ${q.freq.toFixed(1)} Hz</div>
      </div>
    `;

        container.appendChild(card);
    }
}
