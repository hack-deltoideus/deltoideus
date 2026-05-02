import { browser } from '$app/environment';
import { connectHeartRateMonitor } from '$lib/polar';
import { supabase } from '$lib/supabase';
import { get, writable } from 'svelte/store';

export type DiagnosticSample = {
	recorded_at: string;
	elapsed_ms: number;
	heart_rate: number;
	rr_ms: number | null;
	hrv_ms: number | null;
	rr_intervals_ms?: number[];
};

export type SessionSegment = {
	index: number;
	startedAt: string;
	endedAt: string;
	durationSeconds: number;
	sampleCount: number;
	averageHeartRate: number | null;
	averageRrMs: number | null;
	averageHrvMs: number | null;
};

export type BodyLoadState = 'settling' | 'steady' | 'activated' | 'recovering';
export type BodyLoadConfidence = 'low' | 'possible' | 'likely';
export type BodyLoadFeedbackLabel =
	| 'felt_stressed'
	| 'normal_focus'
	| 'caffeine_illness_sleep';

export type SignalQuality = {
	level: 'poor' | 'fair' | 'good';
	sampleCount: number;
	validRrCount: number;
	artifactRatePercent: number;
};

export type RobustMetricRange = {
	median: number | null;
	lower: number | null;
	upper: number | null;
	sampleCount: number;
	method: 'rolling_percentile' | 'single_window' | 'insufficient';
};

export type RollingBodyLoadMetrics = {
	windowSeconds: number;
	sampleCount: number;
	validRrCount: number;
	averageHeartRate: number | null;
	rmssdMs: number | null;
	rmssdDeltaPercent: number | null;
	heartRateDeltaBpm: number | null;
};

export type BodyLoadEvent = {
	id: string;
	kind: 'activation' | 'recovery';
	startedAt: string;
	endedAt: string | null;
	elapsedSeconds: number;
	baselineRmssdMs: number | null;
	currentRmssdMs: number | null;
	rmssdDeltaPercent: number | null;
	heartRate: number | null;
	confidence: BodyLoadConfidence;
	signalQuality: SignalQuality;
	feedbackLabel?: BodyLoadFeedbackLabel;
	contextTags?: string[];
};

export type BodyLoadFeedback = {
	id: string;
	recordedAt: string;
	elapsedSeconds: number;
	label: BodyLoadFeedbackLabel;
	bodyLoadState: BodyLoadState;
	confidence: BodyLoadConfidence;
	signalQuality: SignalQuality;
	relatedEventId: string | null;
	contextTags: string[];
};

export type SessionSummaryPayload = {
	sessionId: string;
	userId: string;
	deviceInfo: {
		name: string;
	} | null;
	captureType: string;
	startedAt: string;
	endedAt: string;
	durationSeconds: number;
	sampleCount: number;
	averageHeartRate: number | null;
	averageRrMs: number | null;
	averageHrvMs: number | null;
	lastHrvMs: number | null;
	maxHeartRate: number | null;
	baselineRmssdMs?: number | null;
	baselineRmssdRange?: RobustMetricRange;
	baselineHeartRateRange?: RobustMetricRange;
	rmssdDiagnosisWindowSeconds?: number;
	baselineCaptureSeconds?: number;
	stressThresholdDropPercent?: number;
	bodyLoadState?: BodyLoadState;
	bodyLoadScore?: number;
	bodyLoadConfidence?: BodyLoadConfidence;
	burnoutScore?: number;
	sustainedStressSeconds?: number;
	signalQuality?: SignalQuality;
	currentWindow?: RollingBodyLoadMetrics;
	activationEvents?: BodyLoadEvent[];
	recoveryEvents?: BodyLoadEvent[];
	feedback?: BodyLoadFeedback[];
	bestFocusStretchSeconds?: number;
	firstRecoverySeconds?: number | null;
	nextSessionSuggestion?: string;
	segmentLengthSeconds: number;
	segments: SessionSegment[];
};

export type SavedDiagnosticSession = {
	id: string;
	created_at: string;
	started_at: string;
	ended_at: string | null;
	duration_seconds: number | null;
	avg_heart_rate: number | null;
	avg_rr_ms: number | null;
	avg_hrv_ms: number | null;
	last_hrv_ms: number | null;
	max_heart_rate: number | null;
	sample_count: number;
	device_name: string | null;
	capture_type: string | null;
	raw_data_path: string | null;
	summary_payload: SessionSummaryPayload | null;
};

export type RmssdDiagnosis = 'building-baseline' | 'steady' | 'stressed' | 'recovering';

type SensorSessionState = {
	heartRate: number | undefined;
	rrMs: number | undefined;
	hrvMs: number | undefined;
	baselineRmssdMs: number | undefined;
	baselineRmssdRange: RobustMetricRange;
	baselineHeartRateRange: RobustMetricRange;
	currentRmssdMs: number | undefined;
	rmssdDeltaPercent: number | undefined;
	rmssdDiagnosis: RmssdDiagnosis;
	overallStressScore: number;
	bodyLoadState: BodyLoadState;
	bodyLoadScore: number;
	bodyLoadConfidence: BodyLoadConfidence;
	burnoutScore: number;
	sustainedStressSeconds: number;
	signalQuality: SignalQuality;
	currentWindow: RollingBodyLoadMetrics | null;
	bodyLoadEvents: BodyLoadEvent[];
	bodyLoadFeedback: BodyLoadFeedback[];
	activationCandidateStartedAtMs: number | null;
	rmssdThresholdDropPercent: number;
	baselineProgressPercent: number;
	baselineCaptureSeconds: number;
	diagnosisWindowSeconds: number;
	isConnecting: boolean;
	isSavingSession: boolean;
	isSensorConnected: boolean;
	canUseBluetooth: boolean;
	sensorStatus: string;
	sessionStartedAt: string | null;
	sessionDeviceName: string | null;
	sessionSamples: DiagnosticSample[];
};

type EndSessionResult = {
	savedSession: SavedDiagnosticSession | null;
	warning: string;
};

const initialState: SensorSessionState = {
	heartRate: undefined,
	rrMs: undefined,
	hrvMs: undefined,
	baselineRmssdMs: undefined,
	baselineRmssdRange: {
		median: null,
		lower: null,
		upper: null,
		sampleCount: 0,
		method: 'insufficient'
	},
	baselineHeartRateRange: {
		median: null,
		lower: null,
		upper: null,
		sampleCount: 0,
		method: 'insufficient'
	},
	currentRmssdMs: undefined,
	rmssdDeltaPercent: undefined,
	rmssdDiagnosis: 'building-baseline',
	overallStressScore: 0,
	bodyLoadState: 'settling',
	bodyLoadScore: 0,
	bodyLoadConfidence: 'low',
	burnoutScore: 0,
	sustainedStressSeconds: 0,
	signalQuality: {
		level: 'poor',
		sampleCount: 0,
		validRrCount: 0,
		artifactRatePercent: 0
	},
	currentWindow: null,
	bodyLoadEvents: [],
	bodyLoadFeedback: [],
	activationCandidateStartedAtMs: null,
	rmssdThresholdDropPercent: 22,
	baselineProgressPercent: 0,
	baselineCaptureSeconds: 90,
	diagnosisWindowSeconds: 60,
	isConnecting: false,
	isSavingSession: false,
	isSensorConnected: false,
	canUseBluetooth: browser && typeof navigator !== 'undefined' && 'bluetooth' in navigator,
	sensorStatus: 'Disconnected',
	sessionStartedAt: null,
	sessionDeviceName: null,
	sessionSamples: []
};

const store = writable<SensorSessionState>(initialState);
let stopSensor: (() => Promise<void>) | null = null;

const MIN_VALID_RR_MS = 300;
const MAX_VALID_RR_MS = 2000;
const MIN_VALID_RR_FOR_WINDOW = 10;
const ACTIVATION_SUSTAINED_MS = 20_000;
const BURNOUT_RISK_WINDOW_SECONDS = 15 * 60;
const MAX_SESSION_SAMPLES = 7200;

function patchState(patch: Partial<SensorSessionState>) {
	store.update((state) => ({ ...state, ...patch }));
}

function averageOf(values: number[]): number | null {
	if (values.length === 0) {
		return null;
	}

	return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2));
}

function roundMetric(value: number): number {
	return Number(value.toFixed(2));
}

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

function percentile(values: number[], percentileValue: number): number | null {
	if (values.length === 0) {
		return null;
	}

	const sorted = [...values].sort((left, right) => left - right);
	const index = (sorted.length - 1) * percentileValue;
	const lowerIndex = Math.floor(index);
	const upperIndex = Math.ceil(index);

	if (lowerIndex === upperIndex) {
		return roundMetric(sorted[lowerIndex] ?? 0);
	}

	const lower = sorted[lowerIndex] ?? 0;
	const upper = sorted[upperIndex] ?? lower;
	const weight = index - lowerIndex;
	return roundMetric(lower + (upper - lower) * weight);
}

function removeIqrOutliers(values: number[]): number[] {
	if (values.length < 4) {
		return values;
	}

	const q1 = percentile(values, 0.25);
	const q3 = percentile(values, 0.75);
	if (q1 === null || q3 === null) {
		return values;
	}

	const iqr = q3 - q1;
	const lowerFence = q1 - iqr * 1.5;
	const upperFence = q3 + iqr * 1.5;
	const filtered = values.filter((value) => value >= lowerFence && value <= upperFence);

	return filtered.length > 0 ? filtered : values;
}

function buildRobustRange(values: number[], fallbackSpreadPercent: number, minSpread: number): RobustMetricRange {
	const cleaned = removeIqrOutliers(values.filter((value) => Number.isFinite(value) && value > 0));
	if (cleaned.length === 0) {
		return {
			median: null,
			lower: null,
			upper: null,
			sampleCount: 0,
			method: 'insufficient'
		};
	}

	const medianValue = percentile(cleaned, 0.5) ?? cleaned[0] ?? 0;
	if (cleaned.length < 3) {
		const spread = Math.max(minSpread, medianValue * fallbackSpreadPercent);
		return {
			median: roundMetric(medianValue),
			lower: roundMetric(Math.max(1, medianValue - spread)),
			upper: roundMetric(medianValue + spread),
			sampleCount: cleaned.length,
			method: 'single_window'
		};
	}

	const lowerPercentile = percentile(cleaned, 0.2) ?? medianValue;
	const upperPercentile = percentile(cleaned, 0.8) ?? medianValue;
	const spread = Math.max(minSpread, medianValue * 0.05);

	return {
		median: roundMetric(medianValue),
		lower: roundMetric(Math.max(1, lowerPercentile - spread)),
		upper: roundMetric(upperPercentile + spread),
		sampleCount: cleaned.length,
		method: 'rolling_percentile'
	};
}

function cleanRrIntervals(rrValues: number[]): number[] {
	return rrValues.filter((value) => value >= MIN_VALID_RR_MS && value <= MAX_VALID_RR_MS);
}

function flattenRrIntervals(samples: DiagnosticSample[], clean = true): number[] {
	const flattened: number[] = [];

	for (const sample of samples) {
		if (sample.rr_intervals_ms?.length) {
			flattened.push(...sample.rr_intervals_ms);
			continue;
		}

		if (typeof sample.rr_ms === 'number') {
			flattened.push(sample.rr_ms);
		}
	}

	return clean ? cleanRrIntervals(flattened) : flattened;
}

function computeRmssd(rrValues: number[]): number | undefined {
	const cleaned = cleanRrIntervals(rrValues);
	if (cleaned.length < 3) {
		return undefined;
	}

	let squaredDiffTotal = 0;
	for (let index = 1; index < cleaned.length; index += 1) {
		const diff = cleaned[index] - cleaned[index - 1];
		squaredDiffTotal += diff * diff;
	}

	return Number(Math.sqrt(squaredDiffTotal / (cleaned.length - 1)).toFixed(2));
}

function samplesWithinWindow(
	samples: DiagnosticSample[],
	rangeStartMs: number,
	rangeEndMs: number
): DiagnosticSample[] {
	return samples.filter(
		(sample) => sample.elapsed_ms >= rangeStartMs && sample.elapsed_ms <= rangeEndMs
	);
}

function deriveSignalQuality(samples: DiagnosticSample[]): SignalQuality {
	const rawRrValues = flattenRrIntervals(samples, false);
	const validRrValues = cleanRrIntervals(rawRrValues);
	const artifactRatePercent =
		rawRrValues.length > 0
			? Number((((rawRrValues.length - validRrValues.length) / rawRrValues.length) * 100).toFixed(1))
			: 0;

	let level: SignalQuality['level'] = 'good';
	if (
		samples.length < 8 ||
		validRrValues.length < MIN_VALID_RR_FOR_WINDOW ||
		artifactRatePercent >= 35
	) {
		level = 'poor';
	} else if (validRrValues.length < 20 || artifactRatePercent >= 15) {
		level = 'fair';
	}

	return {
		level,
		sampleCount: samples.length,
		validRrCount: validRrValues.length,
		artifactRatePercent
	};
}

function deriveBaselineRmssdRange(samples: DiagnosticSample[]): RobustMetricRange {
	if (samples.length === 0) {
		return initialState.baselineRmssdRange;
	}

	const lastElapsedMs = samples.at(-1)?.elapsed_ms ?? 0;
	const windowMs = 30_000;
	const stepMs = 10_000;
	const windowValues: number[] = [];

	for (let startMs = 0; startMs + windowMs <= lastElapsedMs; startMs += stepMs) {
		const windowSamples = samplesWithinWindow(samples, startMs, startMs + windowMs);
		const rmssd = computeRmssd(flattenRrIntervals(windowSamples));
		if (typeof rmssd === 'number') {
			windowValues.push(rmssd);
		}
	}

	if (windowValues.length === 0) {
		const aggregate = computeRmssd(flattenRrIntervals(samples));
		return buildRobustRange(typeof aggregate === 'number' ? [aggregate] : [], 0.15, 3);
	}

	return buildRobustRange(windowValues, 0.15, 3);
}

function deriveBaselineHeartRateRange(samples: DiagnosticSample[]): RobustMetricRange {
	const heartRates = samples.map((sample) => sample.heart_rate);
	return buildRobustRange(heartRates, 0.12, 5);
}

function computeOverallStressScore(
	rmssdDiagnosis: RmssdDiagnosis,
	rmssdDeltaPercent: number | undefined
): number {
	if (rmssdDiagnosis === 'building-baseline' || typeof rmssdDeltaPercent !== 'number') {
		return 0;
	}

	if (rmssdDiagnosis === 'recovering') {
		return 10;
	}

	return Math.max(0, Math.min(100, Math.round(-rmssdDeltaPercent)));
}

function computeBodyLoadScore(
	bodyLoadState: BodyLoadState,
	rmssdDeltaPercent: number | undefined,
	heartRateDeltaBpm: number | null,
	signalQuality: SignalQuality
): number {
	if (bodyLoadState === 'settling' || typeof rmssdDeltaPercent !== 'number') {
		return 0;
	}

	const rmssdLoad = Math.max(0, -rmssdDeltaPercent);
	const heartRateLoad = Math.max(0, heartRateDeltaBpm ?? 0) * 1.5;
	const qualityPenalty = signalQuality.level === 'poor' ? 0.55 : signalQuality.level === 'fair' ? 0.8 : 1;
	const recoveryDiscount = bodyLoadState === 'recovering' ? 0.4 : 1;

	return Math.round(clamp((rmssdLoad + heartRateLoad) * qualityPenalty * recoveryDiscount, 0, 100));
}

function calculateSustainedStressSeconds(events: BodyLoadEvent[], lastElapsedMs: number): number {
	return events
		.filter((event) => event.kind === 'activation')
		.reduce((total, event) => {
			const durationSeconds = event.endedAt
				? Math.round((new Date(event.endedAt).getTime() - new Date(event.startedAt).getTime()) / 1000)
				: Math.round(lastElapsedMs / 1000) - event.elapsedSeconds;
			return total + Math.max(0, durationSeconds);
		}, 0);
}

function computeBurnoutScore(
	bodyLoadScore: number,
	sustainedStressSeconds: number,
	durationSeconds: number
): number {
	if (durationSeconds < 5 * 60 || sustainedStressSeconds <= 0) {
		return 0;
	}

	const sustainedComponent = clamp(sustainedStressSeconds / BURNOUT_RISK_WINDOW_SECONDS, 0, 1) * 70;
	const intensityComponent = clamp(bodyLoadScore / 100, 0, 1) * 30;
	return Math.round(clamp(sustainedComponent + intensityComponent, 0, 100));
}

function chooseBodyLoadConfidence(
	bodyLoadState: BodyLoadState,
	signalQuality: SignalQuality,
	isActivationCandidate: boolean
): BodyLoadConfidence {
	if (bodyLoadState === 'settling' || signalQuality.level === 'poor') {
		return 'low';
	}

	if (bodyLoadState === 'activated' && signalQuality.level === 'good') {
		return 'likely';
	}

	if (bodyLoadState === 'activated' || isActivationCandidate || bodyLoadState === 'recovering') {
		return 'possible';
	}

	return signalQuality.level === 'good' ? 'likely' : 'possible';
}

function mapBodyLoadToLegacyDiagnosis(bodyLoadState: BodyLoadState): RmssdDiagnosis {
	if (bodyLoadState === 'settling') {
		return 'building-baseline';
	}

	if (bodyLoadState === 'activated') {
		return 'stressed';
	}

	return bodyLoadState;
}

function buildEvent(
	kind: BodyLoadEvent['kind'],
	state: SensorSessionState,
	elapsedMs: number,
	baselineRmssdMs: number | undefined,
	currentRmssdMs: number | undefined,
	rmssdDeltaPercent: number | undefined,
	heartRate: number | null,
	confidence: BodyLoadConfidence,
	signalQuality: SignalQuality
): BodyLoadEvent {
	const startedAt = state.sessionStartedAt
		? new Date(new Date(state.sessionStartedAt).getTime() + elapsedMs).toISOString()
		: new Date().toISOString();

	return {
		id: crypto.randomUUID(),
		kind,
		startedAt,
		endedAt: null,
		elapsedSeconds: Math.round(elapsedMs / 1000),
		baselineRmssdMs: baselineRmssdMs ?? null,
		currentRmssdMs: currentRmssdMs ?? null,
		rmssdDeltaPercent: rmssdDeltaPercent ?? null,
		heartRate,
		confidence,
		signalQuality
	};
}

function closeOpenActivationEvents(events: BodyLoadEvent[], endedAt: string): BodyLoadEvent[] {
	return events.map((event) =>
		event.kind === 'activation' && event.endedAt === null ? { ...event, endedAt } : event
	);
}

function deriveRmssdState(state: SensorSessionState): Partial<SensorSessionState> {
	if (!state.sessionStartedAt || state.sessionSamples.length === 0) {
		return {
			hrvMs: undefined,
			baselineRmssdMs: undefined,
			baselineRmssdRange: initialState.baselineRmssdRange,
			baselineHeartRateRange: initialState.baselineHeartRateRange,
			currentRmssdMs: undefined,
			rmssdDeltaPercent: undefined,
			rmssdDiagnosis: 'building-baseline',
			overallStressScore: 0,
			bodyLoadState: 'settling',
			bodyLoadScore: 0,
			bodyLoadConfidence: 'low',
			burnoutScore: 0,
			sustainedStressSeconds: 0,
			currentWindow: null,
			signalQuality: initialState.signalQuality,
			activationCandidateStartedAtMs: null,
			baselineProgressPercent: 0
		};
	}

	const lastElapsedMs = state.sessionSamples.at(-1)?.elapsed_ms ?? 0;
	const baselineWindowMs = state.baselineCaptureSeconds * 1000;
	const diagnosisWindowMs = state.diagnosisWindowSeconds * 1000;
	const baselineProgressPercent = clamp((lastElapsedMs / baselineWindowMs) * 100, 0, 100);

	const baselineSamples = samplesWithinWindow(state.sessionSamples, 0, baselineWindowMs);
	const baselineRmssdRange = deriveBaselineRmssdRange(baselineSamples);
	const baselineHeartRateRange = deriveBaselineHeartRateRange(baselineSamples);
	const baselineRmssdMs = baselineRmssdRange.median ?? undefined;

	const currentWindowStartMs = Math.max(0, lastElapsedMs - diagnosisWindowMs);
	const currentSamples = samplesWithinWindow(state.sessionSamples, currentWindowStartMs, lastElapsedMs);
	const currentRmssdMs = computeRmssd(flattenRrIntervals(currentSamples));
	const signalQuality = deriveSignalQuality(currentSamples);
	const currentAverageHeartRate = averageOf(currentSamples.map((sample) => sample.heart_rate));
	const baselineAverageHeartRate = baselineHeartRateRange.median;
	const heartRateDeltaBpm =
		typeof currentAverageHeartRate === 'number' && typeof baselineAverageHeartRate === 'number'
			? Number((currentAverageHeartRate - baselineAverageHeartRate).toFixed(1))
			: null;

	if (baselineProgressPercent < 100 || typeof baselineRmssdMs !== 'number') {
		const currentWindow: RollingBodyLoadMetrics | null =
			typeof currentRmssdMs === 'number'
				? {
						windowSeconds: state.diagnosisWindowSeconds,
						sampleCount: currentSamples.length,
						validRrCount: signalQuality.validRrCount,
						averageHeartRate: currentAverageHeartRate,
						rmssdMs: currentRmssdMs,
						rmssdDeltaPercent: null,
						heartRateDeltaBpm: null
					}
				: null;

		return {
			hrvMs: currentRmssdMs,
			baselineRmssdMs,
			baselineRmssdRange,
			baselineHeartRateRange,
			currentRmssdMs,
			rmssdDeltaPercent: undefined,
			rmssdDiagnosis: 'building-baseline',
			overallStressScore: 0,
			bodyLoadState: 'settling',
			bodyLoadScore: 0,
			bodyLoadConfidence: 'low',
			burnoutScore: 0,
			sustainedStressSeconds: 0,
			signalQuality,
			currentWindow,
			activationCandidateStartedAtMs: null,
			baselineProgressPercent: Number(baselineProgressPercent.toFixed(1))
		};
	}

	if (typeof currentRmssdMs !== 'number') {
		return {
			hrvMs: undefined,
			baselineRmssdMs,
			baselineRmssdRange,
			baselineHeartRateRange,
			currentRmssdMs: undefined,
			rmssdDeltaPercent: undefined,
			rmssdDiagnosis: 'steady',
			overallStressScore: 0,
			bodyLoadState: 'steady',
			bodyLoadScore: 0,
			bodyLoadConfidence: 'low',
			burnoutScore: 0,
			sustainedStressSeconds: 0,
			signalQuality,
			currentWindow: {
				windowSeconds: state.diagnosisWindowSeconds,
				sampleCount: currentSamples.length,
				validRrCount: signalQuality.validRrCount,
				averageHeartRate: currentAverageHeartRate,
				rmssdMs: null,
				rmssdDeltaPercent: null,
				heartRateDeltaBpm
			},
			activationCandidateStartedAtMs: null,
			baselineProgressPercent: 100
		};
	}

	const rmssdDeltaPercent = Number(
		(((currentRmssdMs - baselineRmssdMs) / baselineRmssdMs) * 100).toFixed(1)
	);
	const currentWindow: RollingBodyLoadMetrics = {
		windowSeconds: state.diagnosisWindowSeconds,
		sampleCount: currentSamples.length,
		validRrCount: signalQuality.validRrCount,
		averageHeartRate: currentAverageHeartRate,
		rmssdMs: currentRmssdMs,
		rmssdDeltaPercent,
		heartRateDeltaBpm
	};
	const isActivationCandidate =
		signalQuality.level !== 'poor' &&
		((typeof baselineRmssdRange.lower === 'number' &&
			currentRmssdMs < Math.min(
				baselineRmssdRange.lower,
				baselineRmssdMs * (1 - state.rmssdThresholdDropPercent / 100)
			)) ||
			(typeof baselineRmssdRange.lower === 'number' &&
				currentRmssdMs < baselineRmssdRange.lower &&
				((heartRateDeltaBpm ?? 0) >= 10 ||
					(typeof baselineHeartRateRange.upper === 'number' &&
						typeof currentAverageHeartRate === 'number' &&
						currentAverageHeartRate > baselineHeartRateRange.upper))));
	const nextActivationCandidateStartedAtMs = isActivationCandidate
		? (state.activationCandidateStartedAtMs ?? lastElapsedMs)
		: null;
	const activationHasPersisted =
		isActivationCandidate &&
		nextActivationCandidateStartedAtMs !== null &&
		lastElapsedMs - nextActivationCandidateStartedAtMs >= ACTIVATION_SUSTAINED_MS;
	const hasPriorActivation = state.bodyLoadEvents.some((event) => event.kind === 'activation');
	const isRecovering =
		hasPriorActivation &&
		!isActivationCandidate &&
		(state.bodyLoadState === 'activated' || state.bodyLoadState === 'recovering') &&
		(rmssdDeltaPercent >= -8 || currentRmssdMs >= baselineRmssdMs);

	let bodyLoadState: BodyLoadState = 'steady';
	if (activationHasPersisted) {
		bodyLoadState = 'activated';
	} else if (isRecovering) {
		bodyLoadState = 'recovering';
	}
	const bodyLoadConfidence = chooseBodyLoadConfidence(
		bodyLoadState,
		signalQuality,
		isActivationCandidate
	);
	const bodyLoadScore = computeBodyLoadScore(
		bodyLoadState,
		rmssdDeltaPercent,
		heartRateDeltaBpm,
		signalQuality
	);

	let bodyLoadEvents = state.bodyLoadEvents;
	const eventHeartRate = typeof currentAverageHeartRate === 'number' ? currentAverageHeartRate : null;
	if (state.bodyLoadState !== 'activated' && bodyLoadState === 'activated') {
		bodyLoadEvents = [
			...bodyLoadEvents,
			buildEvent(
				'activation',
				state,
				nextActivationCandidateStartedAtMs ?? lastElapsedMs,
				baselineRmssdMs,
				currentRmssdMs,
				rmssdDeltaPercent,
				eventHeartRate,
				bodyLoadConfidence,
				signalQuality
			)
		];
	} else if (state.bodyLoadState === 'activated' && bodyLoadState === 'recovering') {
		const endedAt = new Date(
			new Date(state.sessionStartedAt).getTime() + lastElapsedMs
		).toISOString();
		bodyLoadEvents = [
			...closeOpenActivationEvents(bodyLoadEvents, endedAt),
			buildEvent(
				'recovery',
				state,
				lastElapsedMs,
				baselineRmssdMs,
				currentRmssdMs,
				rmssdDeltaPercent,
				eventHeartRate,
				bodyLoadConfidence,
				signalQuality
			)
		];
	} else if (state.bodyLoadState === 'activated' && bodyLoadState !== 'activated') {
		const endedAt = new Date(
			new Date(state.sessionStartedAt).getTime() + lastElapsedMs
		).toISOString();
		bodyLoadEvents = closeOpenActivationEvents(bodyLoadEvents, endedAt);
	}

	const rmssdDiagnosis = mapBodyLoadToLegacyDiagnosis(bodyLoadState);
	const overallStressScore = computeOverallStressScore(rmssdDiagnosis, rmssdDeltaPercent);
	const sustainedStressSeconds = calculateSustainedStressSeconds(bodyLoadEvents, lastElapsedMs);
	const burnoutScore = computeBurnoutScore(
		bodyLoadScore,
		sustainedStressSeconds,
		Math.round(lastElapsedMs / 1000)
	);

	return {
		hrvMs: currentRmssdMs,
		baselineRmssdMs,
		baselineRmssdRange,
		baselineHeartRateRange,
		currentRmssdMs,
		rmssdDeltaPercent,
		rmssdDiagnosis,
		overallStressScore,
		bodyLoadState,
		bodyLoadScore,
		bodyLoadConfidence,
		burnoutScore,
		sustainedStressSeconds,
		signalQuality,
		currentWindow,
		bodyLoadEvents,
		activationCandidateStartedAtMs: nextActivationCandidateStartedAtMs,
		baselineProgressPercent: 100
	};
}

function chooseSegmentLengthSeconds(durationSeconds: number): number {
	return durationSeconds < 20 * 60 ? 60 : 300;
}

function buildSessionSegments(
	samples: DiagnosticSample[],
	startedAt: string,
	durationSeconds: number
): SessionSegment[] {
	const segmentLengthSeconds = chooseSegmentLengthSeconds(durationSeconds);
	const segmentBuckets = new Map<number, DiagnosticSample[]>();

	for (const sample of samples) {
		const segmentIndex = Math.floor(sample.elapsed_ms / (segmentLengthSeconds * 1000));
		const existing = segmentBuckets.get(segmentIndex) ?? [];
		existing.push(sample);
		segmentBuckets.set(segmentIndex, existing);
	}

	return Array.from(segmentBuckets.entries())
		.sort(([left], [right]) => left - right)
		.map(([segmentIndex, bucket]) => {
			const segmentStartedMs = new Date(startedAt).getTime() + segmentIndex * segmentLengthSeconds * 1000;
			const heartRates = bucket.map((sample) => sample.heart_rate);
			const rrValues = bucket
				.map((sample) => sample.rr_ms)
				.filter((value): value is number => typeof value === 'number');
			const hrvValues = bucket
				.map((sample) => sample.hrv_ms)
				.filter((value): value is number => typeof value === 'number');
			const endedAtMs = bucket.at(-1)
				? new Date(startedAt).getTime() + (bucket.at(-1)?.elapsed_ms ?? 0)
				: segmentStartedMs;

			return {
				index: segmentIndex + 1,
				startedAt: new Date(segmentStartedMs).toISOString(),
				endedAt: new Date(endedAtMs).toISOString(),
				durationSeconds: Math.max(1, Math.round((endedAtMs - segmentStartedMs) / 1000)),
				sampleCount: bucket.length,
				averageHeartRate: averageOf(heartRates),
				averageRrMs: averageOf(rrValues),
				averageHrvMs: averageOf(hrvValues)
			};
		});
}

function calculateBestFocusStretchSeconds(
	segments: SessionSegment[],
	activationEvents: BodyLoadEvent[]
): number {
	if (segments.length === 0) {
		return 0;
	}

	const activationRanges = activationEvents
		.filter((event) => event.kind === 'activation')
		.map((event) => ({
			startMs: new Date(event.startedAt).getTime(),
			endMs: event.endedAt ? new Date(event.endedAt).getTime() : Number.POSITIVE_INFINITY
		}));
	let bestStretchSeconds = 0;

	for (const segment of segments) {
		const startMs = new Date(segment.startedAt).getTime();
		const endMs = new Date(segment.endedAt).getTime();
		const overlapsActivation = activationRanges.some(
			(range) => startMs <= range.endMs && endMs >= range.startMs
		);

		if (!overlapsActivation) {
			bestStretchSeconds += segment.durationSeconds;
		}
	}

	return bestStretchSeconds;
}

function calculateFirstRecoverySeconds(events: BodyLoadEvent[]): number | null {
	const firstActivation = events.find((event) => event.kind === 'activation');
	const firstRecovery = events.find((event) => event.kind === 'recovery');

	if (!firstActivation || !firstRecovery) {
		return null;
	}

	return Math.max(
		0,
		Math.round((new Date(firstRecovery.startedAt).getTime() - new Date(firstActivation.startedAt).getTime()) / 1000)
	);
}

function buildNextSessionSuggestion(state: SensorSessionState): string {
	if (state.bodyLoadEvents.some((event) => event.kind === 'activation')) {
		return 'Try a planned 60-second reset before the next long study block reaches the same stress pattern.';
	}

	if (state.bodyLoadFeedback.some((feedback) => feedback.label === 'normal_focus')) {
		return 'This looked like a steadier focus block, so keep the same setup and compare another session.';
	}

	return 'Capture one more study block at a similar time of day so your personal baseline gets more useful.';
}

function describeError(error: unknown, fallback: string): string {
	if (error instanceof Error && error.message) {
		return error.message;
	}

	if (error && typeof error === 'object') {
		const candidate = error as {
			message?: string;
			details?: string;
			hint?: string;
			code?: string;
		};
		const parts = [candidate.message, candidate.details, candidate.hint].filter(Boolean);
		if (parts.length > 0) {
			return parts.join(' ');
		}

		if (candidate.code) {
			return `${fallback} (${candidate.code})`;
		}
	}

	return fallback;
}

export const sensorSession = {
	subscribe: store.subscribe
};

export async function connectSharedSensor() {
	const state = get(store);
	if (!state.canUseBluetooth || state.isConnecting || state.isSensorConnected) {
		return;
	}

	patchState({ isConnecting: true, sensorStatus: 'Connecting...' });

	try {
		stopSensor = await connectHeartRateMonitor((reading) => {
			store.update((current) => {
				const next: SensorSessionState = {
					...current,
					heartRate: reading.heartRate,
					rrMs: reading.rrMs,
					hrvMs: reading.hrvMs
				};

				if (current.sessionStartedAt) {
					const recordedAt = new Date().toISOString();
					const elapsedMs = Math.max(
						0,
						new Date(recordedAt).getTime() - new Date(current.sessionStartedAt).getTime()
					);
					next.sessionSamples = [
						...current.sessionSamples,
						{
							recorded_at: recordedAt,
							elapsed_ms: elapsedMs,
							heart_rate: reading.heartRate,
							rr_ms: reading.rrMs ?? null,
							hrv_ms: reading.hrvMs ?? null,
							rr_intervals_ms: reading.rrIntervalsMs ?? []
						}
					].slice(-MAX_SESSION_SAMPLES);

					Object.assign(next, deriveRmssdState(next));
				}

				return next;
			});
		});

		patchState({
			sessionDeviceName: 'Polar H9',
			isSensorConnected: true,
			sensorStatus: get(store).sessionStartedAt
				? 'Connected to heart rate monitor. Session is recording.'
				: 'Connected to heart rate monitor. Start a session when you are ready.'
		});
	} catch (error) {
		patchState({ sensorStatus: describeError(error, 'Could not connect to sensor') });
	} finally {
		patchState({ isConnecting: false });
	}
}

export function startSharedSession(isSignedIn: boolean) {
	if (!isSignedIn) {
		patchState({ sensorStatus: 'Sign in to start a session.' });
		return;
	}

	const state = get(store);
	if (state.sessionStartedAt) {
		return;
	}

	patchState({
		sessionStartedAt: new Date().toISOString(),
		sessionSamples: [],
		baselineRmssdMs: undefined,
		baselineRmssdRange: initialState.baselineRmssdRange,
		baselineHeartRateRange: initialState.baselineHeartRateRange,
		currentRmssdMs: undefined,
		rmssdDeltaPercent: undefined,
		rmssdDiagnosis: 'building-baseline',
		overallStressScore: 0,
		bodyLoadState: 'settling',
		bodyLoadScore: 0,
		bodyLoadConfidence: 'low',
		burnoutScore: 0,
		sustainedStressSeconds: 0,
		signalQuality: initialState.signalQuality,
		currentWindow: null,
		bodyLoadEvents: [],
		bodyLoadFeedback: [],
		activationCandidateStartedAtMs: null,
		baselineProgressPercent: 0,
		sensorStatus: state.isSensorConnected
			? `Study session started. Stay settled for ${state.baselineCaptureSeconds} seconds so we can capture your stress baseline.`
			: 'Session started. Connect a device or simulate readings to capture data.'
	});
}

function feedbackLabelToContextTags(label: BodyLoadFeedbackLabel): string[] {
	if (label === 'caffeine_illness_sleep') {
		return ['caffeine', 'illness_or_sleep'];
	}

	return [];
}

function latestBodyLoadEventId(events: BodyLoadEvent[]): string | null {
	return events.at(-1)?.id ?? null;
}

export function markSharedDetectionFeedback(feedback: BodyLoadFeedbackLabel | 'stress' | 'normal') {
	store.update((state) => {
		if (!state.sessionStartedAt) {
			return {
				...state,
				sensorStatus: 'Start a session first so feedback can tune your stress signal.'
			};
		}

		const label: BodyLoadFeedbackLabel =
			feedback === 'stress'
				? 'felt_stressed'
				: feedback === 'normal'
					? 'normal_focus'
					: feedback;
		const elapsedSeconds = Math.max(
			0,
			Math.round((Date.now() - new Date(state.sessionStartedAt).getTime()) / 1000)
		);
		const contextTags = feedbackLabelToContextTags(label);
		const feedbackRecord: BodyLoadFeedback = {
			id: crypto.randomUUID(),
			recordedAt: new Date().toISOString(),
			elapsedSeconds,
			label,
			bodyLoadState: state.bodyLoadState,
			confidence: state.bodyLoadConfidence,
			signalQuality: state.signalQuality,
			relatedEventId: latestBodyLoadEventId(state.bodyLoadEvents),
			contextTags
		};
		const nextThreshold =
			label === 'felt_stressed'
				? clamp(state.rmssdThresholdDropPercent - 3, 10, 35)
				: label === 'normal_focus'
					? clamp(state.rmssdThresholdDropPercent + 3, 10, 35)
					: state.rmssdThresholdDropPercent;
		const feedbackCopy: Record<BodyLoadFeedbackLabel, string> = {
			felt_stressed: `Feedback saved. The stress signal is now a little more sensitive at ${nextThreshold}% below baseline.`,
			normal_focus: `Feedback saved. Normal focus will need a clearer shift next time; threshold is now ${nextThreshold}% below baseline.`,
			caffeine_illness_sleep: `Feedback saved as context. Caffeine, illness, and sleep can all shift this signal.`
		};

		const nextState: SensorSessionState = {
			...state,
			rmssdThresholdDropPercent: nextThreshold,
			bodyLoadFeedback: [...state.bodyLoadFeedback, feedbackRecord],
			bodyLoadEvents: state.bodyLoadEvents.map((event) =>
				event.id === feedbackRecord.relatedEventId
					? { ...event, feedbackLabel: label, contextTags }
					: event
			),
			sensorStatus: feedbackCopy[label]
		};

		return {
			...nextState,
			...deriveRmssdState(nextState)
		};
	});
}

export function resetSharedDetectionTuning() {
	store.update((state) => {
		const nextState: SensorSessionState = {
			...state,
			rmssdThresholdDropPercent: initialState.rmssdThresholdDropPercent,
			sensorStatus: `Stress-score tuning reset to the default ${initialState.rmssdThresholdDropPercent}% RMSSD drop threshold.`
		};

		return {
			...nextState,
			...deriveRmssdState(nextState)
		};
	});
}

export async function disconnectSharedSensor() {
	if (!stopSensor) {
		return;
	}

	await stopSensor();
	stopSensor = null;

	const state = get(store);
	patchState({
		isSensorConnected: false,
		sensorStatus: state.sessionStartedAt
			? 'Sensor disconnected. Your session is still open until you end it.'
			: 'Disconnected from heart rate monitor.'
	});
}

export async function endSharedSession(userId: string | null): Promise<EndSessionResult> {
	const state = get(store);
	if (!state.sessionStartedAt || state.isSavingSession) {
		return { savedSession: null, warning: '' };
	}

	patchState({ isSavingSession: true });

	if (stopSensor) {
		await disconnectSharedSensor();
	}

	if (!supabase) {
		patchState({
			sensorStatus: 'Session ended. Supabase is not configured, so diagnostics were not saved.',
			sessionStartedAt: null,
			sessionSamples: [],
			baselineRmssdMs: undefined,
			baselineRmssdRange: initialState.baselineRmssdRange,
			baselineHeartRateRange: initialState.baselineHeartRateRange,
			currentRmssdMs: undefined,
			rmssdDeltaPercent: undefined,
			overallStressScore: 0,
			bodyLoadState: 'settling',
			bodyLoadScore: 0,
			bodyLoadConfidence: 'low',
			burnoutScore: 0,
			sustainedStressSeconds: 0,
			currentWindow: null,
			bodyLoadEvents: [],
			bodyLoadFeedback: [],
			activationCandidateStartedAtMs: null,
			isSavingSession: false
		});
		return { savedSession: null, warning: '' };
	}

	if (!userId) {
		patchState({
			sensorStatus: 'Session ended. Sign in to save diagnostics.',
			sessionStartedAt: null,
			sessionSamples: [],
			baselineRmssdMs: undefined,
			baselineRmssdRange: initialState.baselineRmssdRange,
			baselineHeartRateRange: initialState.baselineHeartRateRange,
			currentRmssdMs: undefined,
			rmssdDeltaPercent: undefined,
			overallStressScore: 0,
			bodyLoadState: 'settling',
			bodyLoadScore: 0,
			bodyLoadConfidence: 'low',
			burnoutScore: 0,
			sustainedStressSeconds: 0,
			currentWindow: null,
			bodyLoadEvents: [],
			bodyLoadFeedback: [],
			activationCandidateStartedAtMs: null,
			isSavingSession: false
		});
		return { savedSession: null, warning: '' };
	}

	const endedAt = new Date().toISOString();
	const durationSeconds = Math.max(
		0,
		Math.round((new Date(endedAt).getTime() - new Date(state.sessionStartedAt).getTime()) / 1000)
	);
	const heartRates = state.sessionSamples.map((sample) => sample.heart_rate);
	const rrValues = state.sessionSamples
		.map((sample) => sample.rr_ms)
		.filter((value): value is number => typeof value === 'number');
	const hrvValues = state.sessionSamples
		.map((sample) => sample.hrv_ms)
		.filter((value): value is number => typeof value === 'number');
	const sessionId = crypto.randomUUID();
	const segmentLengthSeconds = chooseSegmentLengthSeconds(durationSeconds);
	const segments = buildSessionSegments(state.sessionSamples, state.sessionStartedAt, durationSeconds);
	const activationEvents = state.bodyLoadEvents.filter((event) => event.kind === 'activation');
	const recoveryEvents = state.bodyLoadEvents.filter((event) => event.kind === 'recovery');
	const summaryPayload = {
		sessionId,
		userId,
		deviceInfo: {
			name: state.sessionDeviceName ?? 'Polar H9'
		},
		captureType: 'polar_h9_hr_hrv',
		startedAt: state.sessionStartedAt,
		endedAt,
		durationSeconds,
		sampleCount: state.sessionSamples.length,
		averageHeartRate: averageOf(heartRates),
		averageRrMs: averageOf(rrValues),
		averageHrvMs: averageOf(hrvValues),
		lastHrvMs: hrvValues.at(-1) ?? null,
		maxHeartRate: heartRates.length > 0 ? Math.max(...heartRates) : null,
		baselineRmssdMs: state.baselineRmssdMs ?? null,
		baselineRmssdRange: state.baselineRmssdRange,
		baselineHeartRateRange: state.baselineHeartRateRange,
		rmssdDiagnosisWindowSeconds: state.diagnosisWindowSeconds,
		baselineCaptureSeconds: state.baselineCaptureSeconds,
		stressThresholdDropPercent: state.rmssdThresholdDropPercent,
		bodyLoadState: state.bodyLoadState,
		bodyLoadScore: state.bodyLoadScore,
		bodyLoadConfidence: state.bodyLoadConfidence,
		burnoutScore: state.burnoutScore,
		sustainedStressSeconds: state.sustainedStressSeconds,
		signalQuality: state.signalQuality,
		currentWindow: state.currentWindow,
		activationEvents,
		recoveryEvents,
		feedback: state.bodyLoadFeedback,
		bestFocusStretchSeconds: calculateBestFocusStretchSeconds(segments, activationEvents),
		firstRecoverySeconds: calculateFirstRecoverySeconds(state.bodyLoadEvents),
		nextSessionSuggestion: buildNextSessionSuggestion(state),
		segmentLengthSeconds,
		segments
	};
	const rawPayload = {
		sessionId,
		userId,
		deviceInfo: {
			name: state.sessionDeviceName ?? 'Polar H9'
		},
		captureType: 'polar_h9_hr_hrv',
		startedAt: state.sessionStartedAt,
		endedAt,
		durationSeconds,
		sampleCount: state.sessionSamples.length,
		baselineRmssdMs: state.baselineRmssdMs ?? null,
		baselineRmssdRange: state.baselineRmssdRange,
		baselineHeartRateRange: state.baselineHeartRateRange,
		rmssdDiagnosisWindowSeconds: state.diagnosisWindowSeconds,
		baselineCaptureSeconds: state.baselineCaptureSeconds,
		stressThresholdDropPercent: state.rmssdThresholdDropPercent,
		bodyLoadState: state.bodyLoadState,
		bodyLoadScore: state.bodyLoadScore,
		bodyLoadConfidence: state.bodyLoadConfidence,
		burnoutScore: state.burnoutScore,
		sustainedStressSeconds: state.sustainedStressSeconds,
		signalQuality: state.signalQuality,
		currentWindow: state.currentWindow,
		bodyLoadEvents: state.bodyLoadEvents,
		bodyLoadFeedback: state.bodyLoadFeedback,
		readings: state.sessionSamples
	};
	const rawDataPath = `${userId}/${sessionId}.json`;
	let uploadedRawDataPath: string | null = null;
	let uploadWarning = '';
	let feedbackWarning = '';

	try {
		const { error: uploadError } = await supabase.storage
			.from('diagnostic-raw')
			.upload(rawDataPath, JSON.stringify(rawPayload, null, 2), {
				contentType: 'application/json',
				upsert: true
			});

		if (uploadError) {
			uploadWarning = describeError(uploadError, 'Raw session JSON could not be uploaded.');
		} else {
			uploadedRawDataPath = rawDataPath;
		}

		const { data, error } = await supabase
			.from('sensor_sessions')
			.insert({
				id: sessionId,
				user_id: userId,
				started_at: state.sessionStartedAt,
				ended_at: endedAt,
				duration_seconds: durationSeconds,
				avg_heart_rate: summaryPayload.averageHeartRate,
				avg_rr_ms: summaryPayload.averageRrMs,
				avg_hrv_ms: summaryPayload.averageHrvMs,
				last_hrv_ms: summaryPayload.lastHrvMs,
				max_heart_rate: summaryPayload.maxHeartRate,
				sample_count: summaryPayload.sampleCount,
				device_name: summaryPayload.deviceInfo?.name ?? null,
				capture_type: summaryPayload.captureType,
				body_load_state: summaryPayload.bodyLoadState,
				body_load_score: summaryPayload.bodyLoadScore,
				body_load_confidence: summaryPayload.bodyLoadConfidence,
				burnout_score: summaryPayload.burnoutScore,
				sustained_stress_seconds: summaryPayload.sustainedStressSeconds,
				signal_quality: summaryPayload.signalQuality,
				activation_event_count: activationEvents.length,
				recovery_event_count: recoveryEvents.length,
				diagnostic_payload: rawPayload,
				raw_data_path: uploadedRawDataPath,
				summary_payload: summaryPayload
			})
			.select(
				'id, created_at, started_at, ended_at, duration_seconds, avg_heart_rate, avg_rr_ms, avg_hrv_ms, last_hrv_ms, max_heart_rate, sample_count, device_name, capture_type, raw_data_path, summary_payload'
			)
			.single();

		if (error) {
			throw error;
		}

		if (state.bodyLoadFeedback.length > 0) {
			const { error: feedbackError } = await supabase.from('body_load_feedback').insert(
				state.bodyLoadFeedback.map((feedback) => ({
					id: feedback.id,
					user_id: userId,
					sensor_session_id: sessionId,
					created_at: feedback.recordedAt,
					session_elapsed_seconds: feedback.elapsedSeconds,
					label: feedback.label,
					body_load_state: feedback.bodyLoadState,
					body_load_confidence: feedback.confidence,
					signal_quality: feedback.signalQuality,
					related_event_id: feedback.relatedEventId,
					context_tags: feedback.contextTags
				}))
			);

			if (feedbackError) {
				feedbackWarning = describeError(feedbackError, 'Stress feedback labels could not be saved separately.');
			}
		}

		patchState({
			sensorStatus:
				uploadWarning || feedbackWarning
					? `Session ended and saved (${data.id.slice(0, 8)}...). Some supporting data was skipped.`
					: `Session ended and saved (${data.id.slice(0, 8)}...).`,
			sessionStartedAt: null,
			sessionSamples: [],
			overallStressScore: 0,
			bodyLoadState: 'settling',
			bodyLoadScore: 0,
			bodyLoadConfidence: 'low',
			burnoutScore: 0,
			sustainedStressSeconds: 0,
			currentWindow: null,
			bodyLoadEvents: [],
			bodyLoadFeedback: [],
			activationCandidateStartedAtMs: null,
			isSavingSession: false
		});

		return {
			savedSession: data as SavedDiagnosticSession,
			warning: [uploadWarning, feedbackWarning].filter(Boolean).join(' ')
		};
	} catch (error) {
		patchState({
			sensorStatus: describeError(error, 'Session ended, but failed to save diagnostics.'),
			sessionStartedAt: null,
			sessionSamples: [],
			overallStressScore: 0,
			bodyLoadState: 'settling',
			bodyLoadScore: 0,
			bodyLoadConfidence: 'low',
			burnoutScore: 0,
			sustainedStressSeconds: 0,
			currentWindow: null,
			bodyLoadEvents: [],
			bodyLoadFeedback: [],
			activationCandidateStartedAtMs: null,
			isSavingSession: false
		});
		return { savedSession: null, warning: '' };
	}
}

export function simulateSharedSpike() {
	const randomHr = 95 + Math.floor(Math.random() * 26);
	const randomRr = 520 + Math.floor(Math.random() * 120);
	const randomHrv = 18 + Math.floor(Math.random() * 28);

	store.update((state) => {
		const next: SensorSessionState = {
			...state,
			heartRate: randomHr,
			rrMs: randomRr,
			hrvMs: randomHrv,
			sensorStatus: 'Simulated stress signal loaded'
		};

		if (state.sessionStartedAt) {
			const recordedAt = new Date().toISOString();
			const elapsedMs = Math.max(
				0,
				new Date(recordedAt).getTime() - new Date(state.sessionStartedAt).getTime()
			);
			next.sessionSamples = [
				...state.sessionSamples,
				{
					recorded_at: recordedAt,
					elapsed_ms: elapsedMs,
					heart_rate: randomHr,
					rr_ms: randomRr,
					hrv_ms: randomHrv,
					rr_intervals_ms: [randomRr]
				}
			].slice(-MAX_SESSION_SAMPLES);

			Object.assign(next, deriveRmssdState(next));
		}

		return next;
	});
}
