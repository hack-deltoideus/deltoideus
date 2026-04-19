import type {
	BaselineStats,
	NormalizedHeartSample,
	WaveVisualParams,
	WaveformEngineOutput,
	WaveformState
} from '$lib/ecg/waveformTypes';
import {
	avg,
	clamp,
	isValidHeartSample,
	lerp,
	WAVEFORM_CONFIG
} from '$lib/ecg/waveformUtils';

function idleParams(): WaveVisualParams {
	return {
		amplitude: 10,
		beatIntervalMs: 1000,
		pulseWidth: 24,
		preBump: 0.12,
		postDip: 0.18,
		jitter: 0.3,
		energy: 0.2
	};
}

function deriveVisualParams(
	currentHr: number,
	currentRr: number,
	smoothedHr: number,
	smoothedRr: number,
	ready: boolean
): WaveVisualParams {
	if (!ready || !currentHr) {
		return idleParams();
	}

	const amplitude = clamp(
		WAVEFORM_CONFIG.baseAmplitude + smoothedHr * WAVEFORM_CONFIG.amplitudeGain,
		7,
		48
	);
	const beatIntervalMs = clamp(
		(60000 / currentHr) * (1 + smoothedRr * 0.14),
		260,
		1500
	);
	const pulseWidth = clamp(
		WAVEFORM_CONFIG.basePulseWidth + smoothedRr * WAVEFORM_CONFIG.widthGain,
		12,
		52
	);
	const preBump = 0.14 + Math.max(0, smoothedRr) * 0.2 + Math.max(0, smoothedHr) * 0.05;
	const postDip = 0.18 + Math.abs(smoothedRr) * 0.16 + Math.abs(smoothedHr) * 0.04;
	const jitter = 0.45 + Math.abs(smoothedRr) * 1.9;
	const energy = clamp(0.42 + Math.abs(smoothedHr) * 0.58, 0.2, 1.15);

	return {
		amplitude,
		beatIntervalMs,
		pulseWidth,
		preBump,
		postDip,
		jitter,
		energy
	};
}

export class WaveformSignalEngine {
	private baselineHrSamples: number[] = [];
	private baselineRrSamples: number[] = [];
	private baselineHr = 0;
	private baselineRr = 0;
	private baselineReady = false;
	private smoothedHr = 0;
	private smoothedRr = 0;
	private currentHr = 0;
	private currentRr = 0;
	private hasSeenData = false;
	private lastSampleAt = 0;

	addSample(sample: NormalizedHeartSample) {
		if (!isValidHeartSample(sample)) {
			return;
		}

		this.hasSeenData = true;
		this.lastSampleAt = sample.timestamp;
		this.currentHr = sample.hr;
		this.currentRr = sample.rr;

		if (!this.baselineReady) {
			if (this.baselineHrSamples.length < WAVEFORM_CONFIG.baselineSampleCount) {
				this.baselineHrSamples.push(sample.hr);
			}

			if (this.baselineRrSamples.length < WAVEFORM_CONFIG.baselineSampleCount) {
				this.baselineRrSamples.push(sample.rr);
			}

			if (
				this.baselineHrSamples.length === WAVEFORM_CONFIG.baselineSampleCount &&
				this.baselineRrSamples.length === WAVEFORM_CONFIG.baselineSampleCount
			) {
				this.baselineHr = avg(this.baselineHrSamples);
				this.baselineRr = avg(this.baselineRrSamples);
				this.baselineReady = true;
			}

			return;
		}

		const deltaHr = sample.hr - this.baselineHr;
		const deltaRr = sample.rr - this.baselineRr;
		const normHr = clamp(deltaHr / WAVEFORM_CONFIG.hrScale, -1, 1);
		const normRr = clamp(deltaRr / WAVEFORM_CONFIG.rrScale, -1, 1);

		this.smoothedHr = lerp(this.smoothedHr, normHr, WAVEFORM_CONFIG.smoothingHr);
		this.smoothedRr = lerp(this.smoothedRr, normRr, WAVEFORM_CONFIG.smoothingRr);
	}

	getOutput(now: number): WaveformEngineOutput {
		let state: WaveformState = 'IDLE';

		if (!this.hasSeenData) {
			state = 'IDLE';
		} else if (!this.baselineReady) {
			state = 'CALIBRATING';
		} else if (now - this.lastSampleAt > WAVEFORM_CONFIG.signalLostTimeoutMs) {
			state = 'SIGNAL_LOST';
		} else {
			state = 'LIVE';
		}

		const targetParams = deriveVisualParams(
			this.currentHr,
			this.currentRr,
			this.smoothedHr,
			this.smoothedRr,
			this.baselineReady
		);

		let params = targetParams;

		if (state === 'SIGNAL_LOST') {
			const fade = clamp(
				(now - this.lastSampleAt - WAVEFORM_CONFIG.signalLostTimeoutMs) /
					WAVEFORM_CONFIG.signalLostFadeMs,
				0,
				1
			);
			const idle = idleParams();

			params = {
				amplitude: lerp(targetParams.amplitude, idle.amplitude, fade),
				beatIntervalMs: lerp(targetParams.beatIntervalMs, idle.beatIntervalMs, fade),
				pulseWidth: lerp(targetParams.pulseWidth, idle.pulseWidth, fade),
				preBump: lerp(targetParams.preBump, idle.preBump, fade),
				postDip: lerp(targetParams.postDip, idle.postDip, fade),
				jitter: lerp(targetParams.jitter, idle.jitter, fade),
				energy: lerp(targetParams.energy, idle.energy, fade)
			};
		}

		const baseline: BaselineStats = {
			baselineHr: this.baselineHr,
			baselineRr: this.baselineRr,
			isReady: this.baselineReady
		};

		return {
			state,
			params,
			baseline,
			smoothedHrDelta: this.smoothedHr,
			smoothedRrDelta: this.smoothedRr
		};
	}

	reset() {
		this.baselineHrSamples = [];
		this.baselineRrSamples = [];
		this.baselineHr = 0;
		this.baselineRr = 0;
		this.baselineReady = false;
		this.smoothedHr = 0;
		this.smoothedRr = 0;
		this.currentHr = 0;
		this.currentRr = 0;
		this.hasSeenData = false;
		this.lastSampleAt = 0;
	}
}
