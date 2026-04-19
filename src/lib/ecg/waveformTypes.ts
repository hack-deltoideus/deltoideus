export type WaveformState = 'IDLE' | 'CALIBRATING' | 'LIVE' | 'SIGNAL_LOST';

export type NormalizedHeartSample = {
	hr: number;
	rr: number;
	timestamp: number;
};

export type BaselineStats = {
	baselineHr: number;
	baselineRr: number;
	isReady: boolean;
};

export type WaveVisualParams = {
	amplitude: number;
	beatIntervalMs: number;
	pulseWidth: number;
	preBump: number;
	postDip: number;
	jitter: number;
	energy: number;
};

export type WaveformEngineOutput = {
	state: WaveformState;
	params: WaveVisualParams;
	baseline: BaselineStats;
	smoothedHrDelta: number;
	smoothedRrDelta: number;
};
