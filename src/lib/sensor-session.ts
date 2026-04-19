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
	summary_payload: {
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
		rmssdDiagnosisWindowSeconds?: number;
		baselineCaptureSeconds?: number;
		stressThresholdDropPercent?: number;
		segmentLengthSeconds: number;
		segments: SessionSegment[];
	} | null;
};

export type RmssdDiagnosis = 'building-baseline' | 'steady' | 'stressed' | 'recovering';

type SensorSessionState = {
	heartRate: number | undefined;
	rrMs: number | undefined;
	hrvMs: number | undefined;
	baselineRmssdMs: number | undefined;
	currentRmssdMs: number | undefined;
	rmssdDeltaPercent: number | undefined;
	rmssdDiagnosis: RmssdDiagnosis;
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
	currentRmssdMs: undefined,
	rmssdDeltaPercent: undefined,
	rmssdDiagnosis: 'building-baseline',
	rmssdThresholdDropPercent: 22,
	baselineProgressPercent: 0,
	baselineCaptureSeconds: 30,
	diagnosisWindowSeconds: 30,
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

function patchState(patch: Partial<SensorSessionState>) {
	store.update((state) => ({ ...state, ...patch }));
}

function averageOf(values: number[]): number | null {
	if (values.length === 0) {
		return null;
	}

	return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2));
}

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

function cleanRrIntervals(rrValues: number[]): number[] {
	return rrValues.filter((value) => value >= MIN_VALID_RR_MS && value <= MAX_VALID_RR_MS);
}

function flattenRrIntervals(samples: DiagnosticSample[]): number[] {
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

	return cleanRrIntervals(flattened);
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

function deriveRmssdState(state: SensorSessionState): Partial<SensorSessionState> {
	if (!state.sessionStartedAt || state.sessionSamples.length === 0) {
		return {
			hrvMs: undefined,
			baselineRmssdMs: undefined,
			currentRmssdMs: undefined,
			rmssdDeltaPercent: undefined,
			rmssdDiagnosis: 'building-baseline',
			baselineProgressPercent: 0
		};
	}

	const lastElapsedMs = state.sessionSamples.at(-1)?.elapsed_ms ?? 0;
	const baselineWindowMs = state.baselineCaptureSeconds * 1000;
	const diagnosisWindowMs = state.diagnosisWindowSeconds * 1000;
	const baselineProgressPercent = clamp((lastElapsedMs / baselineWindowMs) * 100, 0, 100);

	const baselineSamples = samplesWithinWindow(state.sessionSamples, 0, baselineWindowMs);
	const baselineRmssdMs = computeRmssd(flattenRrIntervals(baselineSamples));

	const currentWindowStartMs = Math.max(0, lastElapsedMs - diagnosisWindowMs);
	const currentSamples = samplesWithinWindow(state.sessionSamples, currentWindowStartMs, lastElapsedMs);
	const currentRmssdMs = computeRmssd(flattenRrIntervals(currentSamples));

	if (baselineProgressPercent < 100 || typeof baselineRmssdMs !== 'number') {
		return {
			hrvMs: currentRmssdMs,
			baselineRmssdMs: baselineRmssdMs,
			currentRmssdMs,
			rmssdDeltaPercent: undefined,
			rmssdDiagnosis: 'building-baseline',
			baselineProgressPercent: Number(baselineProgressPercent.toFixed(1))
		};
	}

	if (typeof currentRmssdMs !== 'number') {
		return {
			hrvMs: undefined,
			baselineRmssdMs,
			currentRmssdMs: undefined,
			rmssdDeltaPercent: undefined,
			rmssdDiagnosis: 'steady',
			baselineProgressPercent: 100
		};
	}

	const rmssdDeltaPercent = Number(
		(((currentRmssdMs - baselineRmssdMs) / baselineRmssdMs) * 100).toFixed(1)
	);

	let rmssdDiagnosis: RmssdDiagnosis = 'steady';
	if (rmssdDeltaPercent <= -state.rmssdThresholdDropPercent) {
		rmssdDiagnosis = 'stressed';
	} else if (rmssdDeltaPercent >= 18) {
		rmssdDiagnosis = 'recovering';
	}

	return {
		hrvMs: currentRmssdMs,
		baselineRmssdMs,
		currentRmssdMs,
		rmssdDeltaPercent,
		rmssdDiagnosis,
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
					].slice(-600);

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
		currentRmssdMs: undefined,
		rmssdDeltaPercent: undefined,
		rmssdDiagnosis: 'building-baseline',
		baselineProgressPercent: 0,
		sensorStatus: state.isSensorConnected
			? `Session started. Stay settled for ${state.baselineCaptureSeconds} seconds to capture your RMSSD baseline.`
			: 'Session started. Connect a device or simulate readings to capture data.'
	});
}

export function markSharedDetectionFeedback(feedback: 'stress' | 'normal') {
	store.update((state) => {
		if (!state.sessionStartedAt) {
			return {
				...state,
				sensorStatus: 'Start a session first so feedback can tune the RMSSD threshold.'
			};
		}

		const nextThreshold =
			feedback === 'stress'
				? clamp(state.rmssdThresholdDropPercent - 3, 10, 35)
				: clamp(state.rmssdThresholdDropPercent + 3, 10, 35);

		const nextState: SensorSessionState = {
			...state,
			rmssdThresholdDropPercent: nextThreshold,
			sensorStatus:
				feedback === 'stress'
					? `Detection tuned to be more sensitive. RMSSD stress threshold is now ${nextThreshold}% below baseline.`
					: `Detection tuned to be less sensitive. RMSSD stress threshold is now ${nextThreshold}% below baseline.`
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
			sensorStatus: `RMSSD detection reset to the default ${initialState.rmssdThresholdDropPercent}% drop threshold.`
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
			isSavingSession: false
		});
		return { savedSession: null, warning: '' };
	}

	if (!userId) {
		patchState({
			sensorStatus: 'Session ended. Sign in to save diagnostics.',
			sessionStartedAt: null,
			sessionSamples: [],
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
		rmssdDiagnosisWindowSeconds: state.diagnosisWindowSeconds,
		baselineCaptureSeconds: state.baselineCaptureSeconds,
		stressThresholdDropPercent: state.rmssdThresholdDropPercent,
		segmentLengthSeconds,
		segments: buildSessionSegments(state.sessionSamples, state.sessionStartedAt, durationSeconds)
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
		rmssdDiagnosisWindowSeconds: state.diagnosisWindowSeconds,
		baselineCaptureSeconds: state.baselineCaptureSeconds,
		stressThresholdDropPercent: state.rmssdThresholdDropPercent,
		readings: state.sessionSamples
	};
	const rawDataPath = `${userId}/${sessionId}.json`;
	let uploadedRawDataPath: string | null = null;
	let uploadWarning = '';

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

		patchState({
			sensorStatus: uploadWarning
				? `Session ended and saved (${data.id.slice(0, 8)}...). Raw file upload was skipped.`
				: `Session ended and saved (${data.id.slice(0, 8)}...).`,
			sessionStartedAt: null,
			sessionSamples: [],
			isSavingSession: false
		});

		return {
			savedSession: data as SavedDiagnosticSession,
			warning: uploadWarning
		};
	} catch (error) {
		patchState({
			sensorStatus: describeError(error, 'Session ended, but failed to save diagnostics.'),
			sessionStartedAt: null,
			sessionSamples: [],
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
			].slice(-600);

			Object.assign(next, deriveRmssdState(next));
		}

		return next;
	});
}
