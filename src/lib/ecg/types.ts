export type EcgSample = {
	elapsedSeconds: number;
	heartRate: number;
	rrMs: number;
};

export type BeatGeometry = {
	durationMs: number;
	amplitudePx: number;
	profile: {
		p: number;
		q: number;
		r: number;
		s: number;
		t: number;
	};
};

export type ScheduledBeat = {
	sample: EcgSample;
	startTimeMs: number;
	endTimeMs: number;
	nextStartTimeMs: number;
	geometry: BeatGeometry;
};

export type StreamViewport = {
	startTimeMs: number;
	endTimeMs: number;
	headX: number;
	headY: number;
};

export type StreamTrace = {
	committedPath: string;
	activePath: string;
	headX: number;
	headY: number;
	startTimeMs: number;
	endTimeMs: number;
	activeBeat: ScheduledBeat | null;
	currentSample: EcgSample | null;
};
