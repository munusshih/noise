export interface Quake {
    id: string;
    mag: number;
    place: string;
    depth: number;
    time: number;
    freq: number;
}

export const state = {
    quakes: [] as Quake[],
    playingId: null as string | null,
    sequenceTimer: null as ReturnType<typeof setTimeout> | null,
    sequenceIndex: 0,
    isSequencing: false,
};
