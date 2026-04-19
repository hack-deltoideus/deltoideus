import type { StressLevel } from '$lib/stress';

export type BiofeedbackStateName = 'focus' | 'stress' | 'fatigue';

type SampleLike = {
	heart_rate: number;
	hrv_ms: number | null;
};

type BiofeedbackInputs = {
	heartRate?: number;
	hrvMs?: number;
	stressLevel: StressLevel;
	baselineHeartRate?: number;
	sessionStartedAt?: string | null;
	sessionSamples?: SampleLike[];
};

type BiofeedbackState = {
	state: BiofeedbackStateName;
	label: 'Focus' | 'Stress' | 'Fatigue';
	reason: string;
	cue: string;
};

function average(values: number[]): number | null {
	if (values.length === 0) {
		return null;
	}

	return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function summarizeTrends(samples: SampleLike[]) {
	const recent = samples.slice(-10);
	const prior = samples.slice(-20, -10);
	const recentHr = average(recent.map((sample) => sample.heart_rate));
	const priorHr = average(prior.map((sample) => sample.heart_rate));
	const recentHrv = average(
		recent.map((sample) => sample.hrv_ms).filter((value): value is number => typeof value === 'number')
	);
	const priorHrv = average(
		prior.map((sample) => sample.hrv_ms).filter((value): value is number => typeof value === 'number')
	);

	return {
		hrTrend: recentHr !== null && priorHr !== null ? recentHr - priorHr : 0,
		hrvTrend: recentHrv !== null && priorHrv !== null ? recentHrv - priorHrv : 0,
		averageHrv: recentHrv
	};
}

export function classifyBiofeedbackState({
	heartRate,
	hrvMs,
	stressLevel,
	baselineHeartRate = 65,
	sessionStartedAt,
	sessionSamples = []
}: BiofeedbackInputs): BiofeedbackState {
	const durationMinutes = sessionStartedAt
		? Math.max(0, (Date.now() - new Date(sessionStartedAt).getTime()) / 60000)
		: 0;
	const { hrTrend, hrvTrend, averageHrv } = summarizeTrends(sessionSamples);
	const effectiveHrv = hrvMs ?? averageHrv ?? null;
	const effectiveHeartRate = heartRate ?? null;

	if (
		stressLevel === 'high' ||
		(effectiveHeartRate !== null && effectiveHeartRate >= baselineHeartRate + 18) ||
		(effectiveHrv !== null && effectiveHrv <= 28)
	) {
		return {
			state: 'stress',
			label: 'Stress',
			reason: 'Heart rate is elevated and HRV is compressed, so Oy switches to a sharper alert cue.',
			cue: 'Fast consonants and short bursts'
		};
	}

	if (
		durationMinutes >= 6 &&
		effectiveHrv !== null &&
		effectiveHrv >= 38 &&
		hrvTrend >= 3 &&
		hrTrend <= 1
	) {
		return {
			state: 'fatigue',
			label: 'Fatigue',
			reason: 'Time-on-task is building while HRV is drifting upward, so Oy slows down into a softer cue.',
			cue: 'Long vowels and slower pacing'
		};
	}

	return {
		state: 'focus',
		label: 'Focus',
		reason: 'Signals look stable enough for a light rhythmic cue that keeps momentum without adding pressure.',
		cue: 'Rhythmic minimal syllables'
	};
}
