<script lang="ts">
	import { browser } from '$app/environment';
	import { onMount } from 'svelte';
	import { connectHeartRateMonitor } from '$lib/polar';
	import { calculateStress, interventionFor, type StressLevel } from '$lib/stress';
	import { hasSupabaseConfig, supabase } from '$lib/supabase';
	import type { Session, User } from '@supabase/supabase-js';

	type SavedCheckIn = {
		id: string;
		created_at: string;
		sensor_session_id: string | null;
		mood: number;
		workload: number;
		sleep_quality: number;
		stress_score: number;
		stress_level: StressLevel;
		heart_rate: number | null;
		rr_ms: number | null;
		hrv_ms: number | null;
		session_elapsed_seconds: number | null;
		stressor: string | null;
	};

	type SavedSensorSession = {
		id: string;
		started_at: string;
		ended_at: string | null;
		duration_seconds: number | null;
		avg_heart_rate: number | null;
		avg_rr_ms: number | null;
		rr_variability_ms: number | null;
		avg_hrv_ms: number | null;
		last_hrv_ms: number | null;
		max_heart_rate: number | null;
		sample_count: number;
		session_summary: SessionSummary | null;
	};

	type SessionSummary = {
		sessionId: string;
		startedAt: string;
		endedAt: string;
		durationSeconds: number;
		sampleCount: number;
		averageHeartRate: number | null;
		averageRrMs: number | null;
		rrVariabilityMs: number | null;
		averageHrvMs: number | null;
		maxHeartRate: number | null;
		lastHeartRate: number | null;
		lastRrMs: number | null;
		lastHrvMs: number | null;
	};

	type SupabaseLikeError = {
		message?: string;
		details?: string;
		hint?: string;
		code?: string;
	};

	type OAuthProvider = 'google' | 'github';

	let mood = $state(5);
	let workload = $state(5);
	let sleepQuality = $state(5);
	let stressor = $state('');

	let heartRate = $state<number | undefined>(undefined);
	let rrMs = $state<number | undefined>(undefined);
	let hrvMs = $state<number | undefined>(undefined);
	let baselineHeartRate = $state(65);

	const stressResult = $derived(
		calculateStress({
			mood,
			workload,
			sleepQuality,
			heartRate,
			baselineHeartRate,
			rrMs
		})
	);

	const stressScore = $derived(stressResult.score);
	const stressLevel = $derived(stressResult.level as StressLevel);
	const intervention = $derived(interventionFor(stressResult.level));

	let isSubmitting = $state(false);
	let submitStatus = $state('');
	let lastSavedCheckIn = $state<SavedCheckIn | null>(null);
	let currentSession = $state<Session | null>(null);
	let currentUser = $state<User | null>(null);
	let authStatus = $state('');
	let isSigningIn = $state<OAuthProvider | null>(null);
	let isSigningOut = $state(false);
	let isGeneratingPlan = $state(false);
	let geminiPlan = $state('');
	let geminiStatus = $state('');
	let geminiSource = $state<'gemini' | 'fallback' | ''>('');
	let helperQuestion = $state('I am overwhelmed with deadlines. What should I do in the next 10 minutes?');
	let helperReply = $state('');
	let helperStatus = $state('');
	let isAskingHelper = $state(false);
	let helperSource = $state<'gemini' | 'fallback' | ''>('');
	let helperPersona = $state<'calm-coach' | 'tough-love' | 'study-planner'>('calm-coach');
	let helperHistory = $state<Array<{ role: 'user' | 'assistant'; text: string }>>([]);

	let isConnecting = $state(false);
	let isSensorConnected = $state(false);
	let canUseBluetooth = $state(false);
	let sensorStatus = $state('Disconnected');
	let sensorPersistenceStatus = $state('');
	let activeSensorSessionId = $state<string | null>(null);
	let activeSessionStartedAt = $state<string | null>(null);
	let lastSavedSensorSession = $state<SavedSensorSession | null>(null);
	let liveSessionSampleCount = $state(0);
	let liveSessionMaxHeartRate = $state<number | null>(null);
	let liveSessionAvgHeartRate = $state<number | null>(null);
	let liveSessionAvgRrMs = $state<number | null>(null);
	let liveSessionRrVariabilityMs = $state<number | null>(null);
	let liveSessionAvgHrvMs = $state<number | null>(null);

	let stopSensor = $state<(() => Promise<void>) | null>(null);
	let liveSessionHeartRateTotal = 0;
	let liveSessionRrTotal = 0;
	let liveSessionHrvTotal = 0;
	let liveSessionHrvCount = 0;
	let liveSessionRrCount = 0;
	let liveSessionPrevRrMs: number | null = null;
	let liveSessionSquaredDiffTotal = 0;
	let liveSessionRrDiffCount = 0;
	let sessionStartPromise: Promise<string | null> | null = null;
	let isStartingSession = $state(false);
	let isEndingSession = $state(false);

	const levelClass = $derived(`level-${stressLevel}`);

	if (browser) {
		canUseBluetooth = typeof navigator !== 'undefined' && 'bluetooth' in navigator;
	}

	onMount(() => {
		if (!supabase) {
			return;
		}

		void supabase.auth.getSession().then(({ data, error }) => {
			if (error) {
				authStatus = describeError(error, 'Failed to restore session.');
				return;
			}

			currentSession = data.session;
			currentUser = data.session?.user ?? null;
		});

		const {
			data: { subscription }
		} = supabase.auth.onAuthStateChange((_event, session) => {
			currentSession = session;
			currentUser = session?.user ?? null;
			authStatus = session?.user ? '' : authStatus;
		});

		return () => {
			subscription.unsubscribe();
		};
	});

	function describeError(error: unknown, fallback: string): string {
		if (error instanceof Error && error.message) {
			return error.message;
		}

		if (error && typeof error === 'object') {
			const candidate = error as SupabaseLikeError;
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

	function resetLiveSensorSessionStats() {
		liveSessionSampleCount = 0;
		liveSessionHeartRateTotal = 0;
		liveSessionMaxHeartRate = null;
		liveSessionAvgHeartRate = null;
		liveSessionAvgRrMs = null;
		liveSessionRrVariabilityMs = null;
		liveSessionAvgHrvMs = null;
		liveSessionRrTotal = 0;
		liveSessionHrvTotal = 0;
		liveSessionHrvCount = 0;
		liveSessionRrCount = 0;
		liveSessionPrevRrMs = null;
		liveSessionSquaredDiffTotal = 0;
		liveSessionRrDiffCount = 0;
	}

	async function signInWithProvider(provider: OAuthProvider) {
		if (!supabase || !browser || isSigningIn) {
			return;
		}

		isSigningIn = provider;
		authStatus = '';

		try {
			const { error } = await supabase.auth.signInWithOAuth({
				provider,
				options: {
					redirectTo: window.location.origin
				}
			});

			if (error) {
				throw error;
			}
		} catch (error) {
			authStatus = describeError(error, `Failed to sign in with ${provider}.`);
		} finally {
			isSigningIn = null;
		}
	}

	async function signOut() {
		if (!supabase || isSigningOut) {
			return;
		}

		isSigningOut = true;
		authStatus = '';

		try {
			const { error } = await supabase.auth.signOut();
			if (error) {
				throw error;
			}

			currentSession = null;
			currentUser = null;
			activeSensorSessionId = null;
			activeSessionStartedAt = null;
			lastSavedSensorSession = null;
			lastSavedCheckIn = null;
			sensorPersistenceStatus = '';
			submitStatus = '';
		} catch (error) {
			authStatus = describeError(error, 'Failed to sign out.');
		} finally {
			isSigningOut = false;
		}
	}

	async function startSensorSession(): Promise<string | null> {
		if (!supabase) {
			sensorPersistenceStatus = 'Sensor data is local only until Supabase is configured.';
			return null;
		}

		if (!currentUser) {
			sensorPersistenceStatus = 'Sign in first to start a session.';
			return null;
		}

		if (activeSensorSessionId) {
			return activeSensorSessionId;
		}

		if (sessionStartPromise) {
			return sessionStartPromise;
		}

		sessionStartPromise = (async () => {
			resetLiveSensorSessionStats();
			const startedAt = new Date().toISOString();
			const { data, error } = await supabase
				.from('sensor_sessions')
				.insert({ user_id: currentUser.id, started_at: startedAt })
				.select(
					'id, started_at, ended_at, duration_seconds, avg_heart_rate, avg_rr_ms, rr_variability_ms, avg_hrv_ms, last_hrv_ms, max_heart_rate, sample_count, session_summary'
				)
				.single();

			if (error) {
				throw error;
			}

			if (!data) {
				throw new Error('Sensor session save succeeded, but no session row was returned.');
			}

			activeSensorSessionId = data.id;
			activeSessionStartedAt = data.started_at ?? startedAt;
			lastSavedSensorSession = data as SavedSensorSession;
			sensorPersistenceStatus = `Session started (${data.id.slice(0, 8)}...). Click End Session to save the summary.`;

			return data.id;
		})()
			.catch((error) => {
				sensorPersistenceStatus = describeError(error, 'Failed to start sensor session.');
				return null;
			})
			.finally(() => {
				sessionStartPromise = null;
			});

		return sessionStartPromise;
	}

	async function handleStartSession() {
		if (isStartingSession || activeSensorSessionId) {
			return;
		}

		isStartingSession = true;
		try {
			await startSensorSession();
		} finally {
			isStartingSession = false;
		}
	}

	function recordSensorReading(reading: { heartRate: number; rrMs?: number; hrvMs?: number }) {
		liveSessionSampleCount += 1;
		liveSessionHeartRateTotal += reading.heartRate;
		liveSessionMaxHeartRate =
			liveSessionMaxHeartRate === null
				? reading.heartRate
				: Math.max(liveSessionMaxHeartRate, reading.heartRate);

		liveSessionAvgHeartRate = Number(
			(liveSessionHeartRateTotal / liveSessionSampleCount).toFixed(2)
		);

		if (typeof reading.rrMs === 'number') {
			liveSessionRrTotal += reading.rrMs;
			liveSessionRrCount += 1;
			liveSessionAvgRrMs = Number((liveSessionRrTotal / liveSessionRrCount).toFixed(2));

			if (liveSessionPrevRrMs !== null) {
				const diff = reading.rrMs - liveSessionPrevRrMs;
				liveSessionSquaredDiffTotal += diff * diff;
				liveSessionRrDiffCount += 1;
				liveSessionRrVariabilityMs = Number(
					Math.sqrt(liveSessionSquaredDiffTotal / liveSessionRrDiffCount).toFixed(2)
				);
			}

			liveSessionPrevRrMs = reading.rrMs;
		}

		if (typeof reading.hrvMs === 'number') {
			liveSessionHrvTotal += reading.hrvMs;
			liveSessionHrvCount += 1;
			liveSessionAvgHrvMs = Number((liveSessionHrvTotal / liveSessionHrvCount).toFixed(2));
		}

		sensorPersistenceStatus = `Tracking session locally: ${liveSessionSampleCount} sample${liveSessionSampleCount === 1 ? '' : 's'} captured.`;
	}

	function queueSensorReading(reading: { heartRate: number; rrMs?: number; hrvMs?: number }) {
		heartRate = reading.heartRate;
		rrMs = reading.rrMs;
		hrvMs = reading.hrvMs;

		if (activeSensorSessionId) {
			recordSensorReading(reading);
		}
	}

	async function endSensorSession() {
		if (!activeSensorSessionId || !supabase) {
			return;
		}

		const endedAt = new Date().toISOString();
		const startedAt = activeSessionStartedAt ?? endedAt;
		const durationSeconds = Math.max(
			0,
			Math.round((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 1000)
		);
		const sampleCount = liveSessionSampleCount;
		const avgHeartRate =
			sampleCount > 0 ? Number((liveSessionHeartRateTotal / sampleCount).toFixed(2)) : null;
		const avgRrMs = liveSessionRrCount > 0 ? Number((liveSessionRrTotal / liveSessionRrCount).toFixed(2)) : null;
		const rrVariabilityMs =
			liveSessionRrDiffCount > 0
				? Number(Math.sqrt(liveSessionSquaredDiffTotal / liveSessionRrDiffCount).toFixed(2))
				: null;
		const summary: SessionSummary = {
			sessionId: activeSensorSessionId,
			startedAt,
			endedAt,
			durationSeconds,
			sampleCount,
			averageHeartRate: avgHeartRate,
			averageRrMs: avgRrMs,
			rrVariabilityMs,
			averageHrvMs: liveSessionAvgHrvMs,
			maxHeartRate: liveSessionMaxHeartRate,
			lastHeartRate: heartRate ?? null,
			lastRrMs: rrMs ?? null,
			lastHrvMs: hrvMs ?? null
		};

		const { data, error } = await supabase
			.from('sensor_sessions')
			.update({
				ended_at: endedAt,
				duration_seconds: durationSeconds,
				avg_heart_rate: avgHeartRate,
				avg_rr_ms: avgRrMs,
				rr_variability_ms: rrVariabilityMs,
				avg_hrv_ms: liveSessionAvgHrvMs,
				last_hrv_ms: hrvMs ?? null,
				max_heart_rate: liveSessionMaxHeartRate,
				sample_count: sampleCount,
				session_summary: summary
			})
			.eq('id', activeSensorSessionId)
			.select(
				'id, started_at, ended_at, duration_seconds, avg_heart_rate, avg_rr_ms, rr_variability_ms, avg_hrv_ms, last_hrv_ms, max_heart_rate, sample_count, session_summary'
			)
			.single();

		if (error) {
			sensorPersistenceStatus = describeError(error, 'Failed to finalize sensor session.');
			return;
		}

		if (data) {
			lastSavedSensorSession = data as SavedSensorSession;
			sensorPersistenceStatus = `Sensor session saved with ${data.sample_count} sample${data.sample_count === 1 ? '' : 's'}.`;
		}

		activeSensorSessionId = null;
		activeSessionStartedAt = null;
		resetLiveSensorSessionStats();
	}

	async function handleEndSession() {
		if (isEndingSession || !activeSensorSessionId) {
			return;
		}

		isEndingSession = true;
		try {
			await endSensorSession();
		} finally {
			isEndingSession = false;
		}
	}

	async function connectSensor() {
		if (!canUseBluetooth || isConnecting) {
			return;
		}

		isConnecting = true;
		sensorStatus = 'Connecting...';

		try {
			stopSensor = await connectHeartRateMonitor((reading) => {
				queueSensorReading(reading);
			});

			isSensorConnected = true;
			sensorStatus = 'Connected to heart rate monitor';
		} catch (error) {
			sensorStatus = describeError(error, 'Could not connect to sensor');
		} finally {
			isConnecting = false;
		}
	}

	async function disconnectSensor() {
		if (!stopSensor) {
			return;
		}

		await stopSensor();
		stopSensor = null;
		isSensorConnected = false;
		sensorStatus = activeSensorSessionId
			? 'Disconnected. Session is still active until you end it.'
			: 'Disconnected';
	}

	function simulateSpike() {
		const randomHr = 95 + Math.floor(Math.random() * 26);
		const randomRr = 520 + Math.floor(Math.random() * 120);

		queueSensorReading({ heartRate: randomHr, rrMs: randomRr });
		sensorStatus = 'Simulated stress signal loaded';
	}

	async function submitCheckIn() {
		submitStatus = '';
		lastSavedCheckIn = null;

		if (!supabase) {
			submitStatus = 'Supabase is not configured yet. Add PUBLIC_SUPABASE_* values in .env.';
			return;
		}

		if (!currentUser) {
			submitStatus = 'Sign in first to save a check-in.';
			return;
		}

		isSubmitting = true;

		try {
			const sessionElapsedSeconds = activeSessionStartedAt
				? Math.max(
						0,
						Math.round((Date.now() - new Date(activeSessionStartedAt).getTime()) / 1000)
					)
				: null;

			const checkInPayload = {
				user_id: currentUser.id,
				sensor_session_id: activeSensorSessionId,
				mood,
				workload,
				sleep_quality: sleepQuality,
				stress_score: stressScore,
				stress_level: stressLevel,
				heart_rate: heartRate,
				rr_ms: rrMs,
				hrv_ms: hrvMs ?? null,
				session_elapsed_seconds: sessionElapsedSeconds,
				stressor: stressor.trim() || null
			};

			const { data: savedCheckIn, error: checkInError } = await supabase
				.from('check_ins')
				.insert(checkInPayload)
				.select(
					'id, created_at, sensor_session_id, mood, workload, sleep_quality, stress_score, stress_level, heart_rate, rr_ms, hrv_ms, session_elapsed_seconds, stressor'
				)
				.single();

			if (checkInError) {
				throw checkInError;
			}

			if (!savedCheckIn) {
				throw new Error('Check-in save succeeded, but the saved row was not returned.');
			}

			lastSavedCheckIn = savedCheckIn as SavedCheckIn;

			if (stressLevel === 'rising' || stressLevel === 'high') {
				const { error: interventionError } = await supabase.from('interventions').insert({
					user_id: currentUser.id,
					sensor_session_id: savedCheckIn.sensor_session_id,
					check_in_id: savedCheckIn.id,
					intervention_type: stressLevel === 'high' ? 'breathing_reset' : 'micro_break',
					trigger_level: stressLevel,
					notes: intervention
				});

				if (interventionError) {
					throw interventionError;
				}
			}

			submitStatus = `Check-in saved and verified in Supabase (id: ${savedCheckIn.id.slice(0, 8)}...).`;
		} catch (error) {
			submitStatus = describeError(error, 'Failed to save check-in');
		} finally {
			isSubmitting = false;
		}
	}

	async function generateGeminiPlan() {
		isGeneratingPlan = true;
		geminiStatus = '';
		geminiSource = '';

		try {
			const response = await fetch('/api/gemini-intervention', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({
					mood,
					workload,
					sleepQuality,
					heartRate,
					rrMs,
					stressLevel,
					stressScore,
					stressor
				})
			});

			const payload = await response.json();
			if (!response.ok) {
				throw new Error(payload?.error ?? 'Failed to generate AI plan');
			}

			geminiPlan = payload.plan ?? '';
			if (!geminiPlan) {
				throw new Error('Gemini returned an empty plan.');
			}

			geminiSource = payload?.source === 'fallback' ? 'fallback' : 'gemini';
			geminiStatus = payload?.warning ?? 'AI intervention generated.';
		} catch (error) {
			geminiStatus = describeError(error, 'Failed to generate plan.');
		} finally {
			isGeneratingPlan = false;
		}
	}

	async function askGeminiHelper() {
		helperStatus = '';
		helperReply = '';
		helperSource = '';

		const question = helperQuestion.trim();
		if (!question) {
			helperStatus = 'Add a question for Kelp first.';
			return;
		}

		isAskingHelper = true;

		try {
			const nextHistory: Array<{ role: 'user' | 'assistant'; text: string }> = [
				...helperHistory,
				{ role: 'user', text: question }
			];

			const response = await fetch('/api/gemini-helper', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({
					question,
					persona: helperPersona,
					history: helperHistory,
					mood,
					workload,
					sleepQuality,
					heartRate,
					rrMs,
					stressLevel,
					stressor
				})
			});

			const payload = await response.json();
			if (!response.ok) {
				throw new Error(payload?.error ?? 'Failed to get helper response');
			}

			helperReply = payload.reply ?? '';
			if (!helperReply) {
				throw new Error('Kelp returned an empty response.');
			}

			const updatedHistory: Array<{ role: 'user' | 'assistant'; text: string }> = [
				...nextHistory,
				{ role: 'assistant', text: helperReply }
			];
			helperHistory = updatedHistory.slice(-8);

			helperSource = payload?.source === 'fallback' ? 'fallback' : 'gemini';
			helperStatus = payload?.warning ?? 'Kelp replied.';
		} catch (error) {
			helperStatus = describeError(error, 'Failed to ask helper.');
		} finally {
			isAskingHelper = false;
		}
	}

	function applyQuickPrompt(prompt: string) {
		helperQuestion = prompt;
	}
</script>

<main class="shell">
	<section class="hero">
		<div class="hero-top">
			<div>
				<p class="eyebrow">Stress Buddy MVP</p>
				<h1>Catch stress early. Trigger action now.</h1>
				<p>
					Live Polar H10 signal + 10-second student check-in + immediate intervention.
				</p>
			</div>
			<div class="auth-card">
				<p class="label">Account</p>
				{#if currentUser}
					<p class="auth-copy">
						Signed in as <strong>{currentUser.email ?? currentUser.id}</strong>
					</p>
					<button class="ghost" onclick={signOut} disabled={isSigningOut}>
						{isSigningOut ? 'Signing out...' : 'Sign out'}
					</button>
				{:else}
					<p class="auth-copy">Sign in to save sessions, check-ins, and interventions to your account.</p>
					<div class="actions">
						<button onclick={() => signInWithProvider('google')} disabled={isSigningIn !== null || !hasSupabaseConfig}>
							{isSigningIn === 'google' ? 'Connecting Google...' : 'Continue with Google'}
						</button>
						<button class="ghost" onclick={() => signInWithProvider('github')} disabled={isSigningIn !== null || !hasSupabaseConfig}>
							{isSigningIn === 'github' ? 'Connecting GitHub...' : 'Continue with GitHub'}
						</button>
					</div>
				{/if}

				{#if authStatus}
					<p class="status">{authStatus}</p>
				{/if}
			</div>
		</div>
	</section>

	<section class="grid">
		<article class="card sensor">
			<h2>Live Sensor</h2>
			<p class="muted">{sensorStatus}</p>

			<div class="metrics">
				<div>
					<span class="label">Heart rate</span>
					<strong>{heartRate ?? '--'} bpm</strong>
				</div>
				<div>
					<span class="label">RR interval</span>
					<strong>{rrMs ?? '--'} ms</strong>
				</div>
				<div>
					<span class="label">HRV (RMSSD)</span>
					<strong>{hrvMs ?? '--'} ms</strong>
				</div>
			</div>

			<div class="actions">
				<button onclick={connectSensor} disabled={!canUseBluetooth || isConnecting || isSensorConnected}>
					{isConnecting ? 'Connecting...' : 'Connect Polar H10'}
				</button>
				{#if activeSensorSessionId}
					<button class="ghost" onclick={disconnectSensor} disabled={!isSensorConnected}>
						Disconnect
					</button>
					<button class="ghost" onclick={simulateSpike}>Simulate Spike</button>
				{/if}
			</div>

			<div class="actions session-actions">
				{#if isSensorConnected && !activeSensorSessionId}
					<button onclick={handleStartSession} disabled={isStartingSession || !hasSupabaseConfig || !currentUser}>
						{isStartingSession ? 'Starting Session...' : 'Start Session'}
					</button>
				{/if}
				{#if activeSensorSessionId}
					<button class="ghost" onclick={handleEndSession} disabled={isEndingSession}>
						{isEndingSession ? 'Ending Session...' : 'End Session'}
					</button>
				{/if}
			</div>

			{#if sensorPersistenceStatus}
				<p class="status">{sensorPersistenceStatus}</p>
			{/if}

			{#if activeSensorSessionId}
				<div class="saved-preview">
					<p class="label">Active sensor session</p>
					<p class="saved-row">
						<strong>{activeSensorSessionId.slice(0, 8)}...</strong>
						<span>{liveSessionSampleCount} samples</span>
						<span>Avg {liveSessionAvgHeartRate ?? '--'} bpm</span>
						<span>Peak {liveSessionMaxHeartRate ?? '--'} bpm</span>
					</p>
					<p class="muted saved-meta">
						Started {activeSessionStartedAt ? new Date(activeSessionStartedAt).toLocaleString() : '--'}.
					</p>
					<p class="muted saved-meta">
						Average RR {liveSessionAvgRrMs ?? '--'} ms. HRV {liveSessionAvgHrvMs ?? '--'} ms. Variability {liveSessionRrVariabilityMs ?? '--'} ms.
					</p>
				</div>
			{:else if lastSavedSensorSession}
				<div class="saved-preview">
					<p class="label">Last saved sensor session</p>
					<p class="saved-row">
						<strong>{lastSavedSensorSession.id.slice(0, 8)}...</strong>
						<span>{lastSavedSensorSession.sample_count} samples</span>
						<span>Avg {lastSavedSensorSession.avg_heart_rate ?? '--'} bpm</span>
						<span>Avg RR {lastSavedSensorSession.avg_rr_ms ?? '--'} ms</span>
						<span>Var {lastSavedSensorSession.rr_variability_ms ?? '--'} ms</span>
						<span>Peak {lastSavedSensorSession.max_heart_rate ?? '--'} bpm</span>
					</p>
					<p class="muted saved-meta">
						Started {new Date(lastSavedSensorSession.started_at).toLocaleString()}
						{#if lastSavedSensorSession.ended_at}
							. Ended {new Date(lastSavedSensorSession.ended_at).toLocaleString()}
						{/if}
					</p>
					<p class="muted saved-meta">
						Duration {lastSavedSensorSession.duration_seconds ?? '--'}s. Avg HRV {lastSavedSensorSession.avg_hrv_ms ?? '--'} ms. Last HRV {lastSavedSensorSession.last_hrv_ms ?? '--'} ms.
					</p>
					{#if lastSavedSensorSession.session_summary}
						<p class="muted saved-meta">
							Avg HRV {lastSavedSensorSession.session_summary.averageHrvMs ?? '--'} ms. Last HRV {lastSavedSensorSession.session_summary.lastHrvMs ?? '--'} ms.
						</p>
					{/if}
					{#if lastSavedSensorSession.session_summary}
						<pre class="ai-plan session-json">{JSON.stringify(lastSavedSensorSession.session_summary, null, 2)}</pre>
					{/if}
				</div>
			{/if}

				{#if !canUseBluetooth}
					<p class="hint">Use Chrome or Edge over HTTPS/localhost for Web Bluetooth.</p>
				{/if}
				{#if !currentUser}
					<p class="hint">Sign in before starting a session if you want sensor data saved to your account.</p>
				{/if}
		</article>

		<article class="card checkin">
			<h2>10-Second Check-in</h2>

			<label>
				Mood: {mood}
				<input type="range" min="1" max="10" bind:value={mood} />
			</label>

			<label>
				Workload: {workload}
				<input type="range" min="1" max="10" bind:value={workload} />
			</label>

			<label>
				Sleep quality: {sleepQuality}
				<input type="range" min="1" max="10" bind:value={sleepQuality} />
			</label>

			<label>
				Main stressor
				<input bind:value={stressor} placeholder="Exams, deadlines, social, sleep..." maxlength="120" />
			</label>

			<button onclick={submitCheckIn} disabled={isSubmitting || !hasSupabaseConfig || !currentUser}>
				{isSubmitting ? 'Saving...' : 'Save Check-in'}
			</button>

			{#if !hasSupabaseConfig}
				<p class="hint">Set PUBLIC_SUPABASE_URL and PUBLIC_SUPABASE_ANON_KEY in .env.</p>
			{/if}

			{#if !currentUser}
				<p class="hint">Sign in with OAuth to save check-ins to your account.</p>
			{/if}

			{#if submitStatus}
				<p class="status">{submitStatus}</p>
			{/if}

			{#if lastSavedCheckIn}
				<div class="saved-preview">
					<p class="label">Last saved check-in</p>
					<p class="saved-row">
						<strong>{lastSavedCheckIn.stress_level.toUpperCase()}</strong>
						<span>{lastSavedCheckIn.stress_score}</span>
						<span>Mood {lastSavedCheckIn.mood}</span>
						<span>Workload {lastSavedCheckIn.workload}</span>
						<span>Sleep {lastSavedCheckIn.sleep_quality}</span>
					</p>
					<p class="muted saved-meta">
						Saved at {new Date(lastSavedCheckIn.created_at).toLocaleString()} with HR {lastSavedCheckIn.heart_rate ?? '--'} bpm, RR {lastSavedCheckIn.rr_ms ?? '--'} ms, and HRV {lastSavedCheckIn.hrv_ms ?? '--'} ms.
					</p>
					<p class="muted saved-meta">
						Sensor session: {lastSavedCheckIn.sensor_session_id ? `${lastSavedCheckIn.sensor_session_id.slice(0, 8)}...` : 'Not attached'}
					</p>
					<p class="muted saved-meta">
						Session elapsed: {lastSavedCheckIn.session_elapsed_seconds ?? '--'}s
					</p>
					{#if lastSavedCheckIn.stressor}
						<p class="muted saved-meta">Stressor: {lastSavedCheckIn.stressor}</p>
					{/if}
				</div>
			{/if}
		</article>

		<article class="card score {levelClass}">
			<div class="card-header">
				<h2>Stress Detection</h2>
				{#if geminiSource}
					<span class="source-badge {geminiSource === 'fallback' ? 'is-fallback' : 'is-live'}">
						{geminiSource === 'fallback' ? 'Fallback Mode' : 'Live Gemini'}
					</span>
				{/if}
			</div>
			<p class="score-value">{stressScore}</p>
			<p class="badge">{stressLevel.toUpperCase()}</p>
			<p class="intervention">{intervention}</p>
			<p class="muted ai-copy">Turn the current stress signal into a clean 4-step AI intervention.</p>
			<button class="ghost ai-trigger" onclick={generateGeminiPlan} disabled={isGeneratingPlan}>
				{isGeneratingPlan ? 'Generating AI Plan...' : 'Generate Gemini Plan'}
			</button>

			{#if geminiStatus}
				<p class="status">{geminiStatus}</p>
			{/if}

			{#if geminiPlan}
				<div class="ai-surface">
					<div class="ai-surface-header">
						<span>AI Intervention Plan</span>
						<span class="muted">Structured for immediate action</span>
					</div>
					<pre class="ai-plan">{geminiPlan}</pre>
				</div>
			{/if}
		</article>

		<article class="card helper ai-studio">
			<div class="ai-studio-head">
				<div>
					<p class="eyebrow studio-kicker">AI Coach</p>
					<h2>Ask Kelp (Gemini Helper)</h2>
					<p class="muted studio-copy">Longer guidance, cleaner formatting, and room for full replies.</p>
				</div>
				{#if helperSource}
					<span class="source-badge {helperSource === 'fallback' ? 'is-fallback' : 'is-live'}">
						{helperSource === 'fallback' ? 'Fallback Mode' : 'Live Gemini'}
					</span>
				{/if}
			</div>
			<p class="muted">Powered by Gemini via server route using GEMINI_KEY.</p>

			<label>
				Personality
				<select bind:value={helperPersona}>
					<option value="calm-coach">Calm Coach</option>
					<option value="tough-love">Tough Love</option>
					<option value="study-planner">Study Planner</option>
				</select>
			</label>

			<div class="quick-prompts">
				<button class="ghost chip" onclick={() => applyQuickPrompt('Build me a 15-minute plan to reduce stress before studying.')}>15-minute reset plan</button>
				<button class="ghost chip" onclick={() => applyQuickPrompt('I keep procrastinating. Give me one concrete start routine.')}>Beat procrastination</button>
				<button class="ghost chip" onclick={() => applyQuickPrompt('I am anxious before an exam. Give me a 3-step focus sequence.')}>Pre-exam focus</button>
			</div>

			<label>
				Your question
				<textarea bind:value={helperQuestion} rows="5" maxlength="700"></textarea>
			</label>

			<button class="ghost ai-trigger" onclick={askGeminiHelper} disabled={isAskingHelper}>
				{isAskingHelper ? 'Kelp is thinking...' : 'Ask Kelp'}
			</button>

			{#if helperStatus}
				<p class="status">{helperStatus}</p>
			{/if}

			{#if helperReply}
				<div class="ai-surface">
					<div class="ai-surface-header">
						<span>Kelp Response</span>
						<span class="muted">Expanded AI guidance</span>
					</div>
					<pre class="ai-plan ai-plan-helper">{helperReply}</pre>
				</div>
			{/if}

			{#if helperHistory.length > 0}
				<div class="history">
					<p class="label">Recent chat</p>
					{#each helperHistory as msg}
						<p class="msg"><strong>{msg.role === 'user' ? 'You' : 'Kelp'}:</strong> {msg.text}</p>
					{/each}
				</div>
			{/if}
		</article>
	</section>
</main>

<style>
	:global(body) {
		margin: 0;
		font-family: 'Space Grotesk', 'Avenir Next', 'Segoe UI', sans-serif;
		background: radial-gradient(circle at 20% 20%, #1f4f46, #11262f 45%, #0b1521 100%);
		color: #ebf7f4;
	}

	.shell {
		max-width: 1100px;
		margin: 0 auto;
		padding: 2rem 1rem 3rem;
	}

	.hero h1 {
		margin: 0.2rem 0 0.75rem;
		font-size: clamp(1.8rem, 4vw, 3rem);
		letter-spacing: 0.02em;
	}

	.hero-top {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		align-items: flex-start;
		gap: 1rem;
	}

	.hero p {
		margin: 0;
		max-width: 52ch;
		color: #cae8df;
	}

	.eyebrow {
		margin: 0;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		font-size: 0.75rem;
		color: #81d4bf;
	}

	.grid {
		margin-top: 1.5rem;
		display: grid;
		gap: 1rem;
		grid-template-columns: repeat(auto-fit, minmax(290px, 1fr));
	}

	.card {
		background: linear-gradient(145deg, rgba(18, 42, 53, 0.92), rgba(10, 24, 35, 0.95));
		border: 1px solid rgba(129, 212, 191, 0.22);
		border-radius: 1rem;
		padding: 1rem;
		box-shadow: 0 10px 28px rgba(2, 8, 15, 0.36);
	}

	.card-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.6rem;
		margin-bottom: 0.4rem;
	}

	.source-badge {
		font-size: 0.72rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		padding: 0.2rem 0.45rem;
		border-radius: 999px;
		border: 1px solid rgba(255, 255, 255, 0.28);
	}

	.source-badge.is-fallback {
		background: rgba(255, 196, 99, 0.18);
		color: #ffe2aa;
		border-color: rgba(255, 196, 99, 0.5);
	}

	.source-badge.is-live {
		background: rgba(92, 230, 176, 0.18);
		color: #bfffe4;
		border-color: rgba(92, 230, 176, 0.46);
	}

	.muted,
	.hint {
		color: #9ec8bc;
	}

	.metrics {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.75rem;
		margin: 0.8rem 0;
	}

	.label {
		display: block;
		font-size: 0.8rem;
		color: #9ec8bc;
		margin-bottom: 0.2rem;
	}

	.auth-card {
		min-width: min(100%, 320px);
		max-width: 360px;
		padding: 1rem;
		border-radius: 1rem;
		background: rgba(7, 18, 30, 0.55);
		border: 1px solid rgba(129, 212, 191, 0.18);
	}

	.auth-copy {
		margin: 0 0 0.8rem;
		color: #cae8df;
	}

	.saved-preview {
		margin-top: 0.9rem;
		padding-top: 0.9rem;
		border-top: 1px solid rgba(129, 212, 191, 0.18);
	}

	.saved-row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.6rem;
		margin: 0.35rem 0 0;
	}

	.saved-meta {
		margin: 0.45rem 0 0;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.session-actions {
		margin-top: 0.75rem;
	}

	label {
		display: grid;
		gap: 0.4rem;
		margin-bottom: 0.7rem;
		font-size: 0.95rem;
	}

	input[type='range'] {
		accent-color: #4dc6a8;
	}

	input {
		border: 1px solid rgba(137, 226, 201, 0.35);
		background: rgba(11, 30, 39, 0.75);
		color: #e6f8f4;
		border-radius: 0.6rem;
		padding: 0.55rem 0.65rem;
	}

	select {
		border: 1px solid rgba(137, 226, 201, 0.35);
		background: rgba(11, 30, 39, 0.75);
		color: #e6f8f4;
		border-radius: 0.6rem;
		padding: 0.55rem 0.65rem;
	}

	textarea {
		border: 1px solid rgba(137, 226, 201, 0.35);
		background: rgba(11, 30, 39, 0.75);
		color: #e6f8f4;
		border-radius: 0.6rem;
		padding: 0.65rem;
		resize: vertical;
	}

	button {
		border: none;
		border-radius: 0.65rem;
		padding: 0.6rem 0.9rem;
		background: linear-gradient(125deg, #3acba8, #2e99c2);
		color: #03141d;
		font-weight: 700;
		cursor: pointer;
	}

	button.ghost {
		background: rgba(67, 117, 129, 0.24);
		color: #d6f4ec;
		border: 1px solid rgba(155, 214, 198, 0.22);
	}

	.quick-prompts {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
		margin-bottom: 0.7rem;
	}

	.chip {
		font-size: 0.82rem;
		padding: 0.4rem 0.6rem;
	}

	button:disabled {
		cursor: not-allowed;
		opacity: 0.55;
	}

	.score {
		text-align: center;
	}

	.ai-copy {
		margin-top: 0.9rem;
		margin-bottom: 0.9rem;
	}

	.ai-trigger {
		width: 100%;
		justify-content: center;
	}

	.score-value {
		margin: 0.35rem 0;
		font-size: clamp(2rem, 6vw, 3.5rem);
		font-weight: 800;
	}

	.badge {
		display: inline-block;
		margin: 0;
		padding: 0.2rem 0.6rem;
		border-radius: 999px;
		font-size: 0.8rem;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		border: 1px solid rgba(255, 255, 255, 0.26);
	}

	.intervention {
		margin-top: 0.9rem;
		color: #d2eee8;
	}

	.level-low {
		border-color: rgba(91, 218, 172, 0.45);
	}

	.level-rising {
		border-color: rgba(255, 194, 89, 0.48);
	}

	.level-high {
		border-color: rgba(255, 111, 111, 0.55);
	}

	.status {
		margin-top: 0.8rem;
		font-size: 0.92rem;
		color: #9de4d0;
	}

	.ai-plan {
		margin-top: 0.8rem;
		padding: 1rem;
		text-align: left;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		word-break: break-word;
		border-radius: 0.7rem;
		border: 1px solid rgba(155, 214, 198, 0.3);
		background: rgba(7, 18, 30, 0.82);
		color: #d9f5ee;
		font-family: 'IBM Plex Mono', 'Menlo', monospace;
		font-size: 0.9rem;
		line-height: 1.6;
		max-height: 24rem;
		overflow: auto;
	}

	.ai-plan-helper {
		max-height: 30rem;
	}

	.session-json {
		margin-top: 0.75rem;
		max-height: 220px;
		font-size: 0.8rem;
	}

	.ai-surface {
		margin-top: 0.9rem;
		padding: 0.85rem;
		border-radius: 1rem;
		background:
			linear-gradient(180deg, rgba(43, 103, 114, 0.18), rgba(9, 21, 33, 0.72)),
			radial-gradient(circle at top right, rgba(106, 236, 212, 0.15), transparent 38%);
		border: 1px solid rgba(120, 228, 205, 0.22);
		box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
	}

	.ai-surface-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.7rem;
		font-size: 0.78rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #c4f4e8;
	}

	.ai-studio {
		grid-column: span 2;
		background:
			linear-gradient(150deg, rgba(15, 41, 55, 0.97), rgba(7, 17, 28, 0.98)),
			radial-gradient(circle at top left, rgba(107, 237, 214, 0.08), transparent 34%);
		border-color: rgba(110, 231, 207, 0.28);
	}

	.ai-studio-head {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 1rem;
		margin-bottom: 0.6rem;
	}

	.studio-kicker {
		margin-bottom: 0.35rem;
	}

	.studio-copy {
		margin-top: 0.2rem;
	}

	.history {
		margin-top: 0.8rem;
		padding-top: 0.7rem;
		border-top: 1px dashed rgba(155, 214, 198, 0.3);
	}

	.msg {
		margin: 0.35rem 0;
		font-size: 0.88rem;
		color: #cdebe4;
	}

	@media (max-width: 640px) {
		.shell {
			padding-top: 1.2rem;
		}

		.metrics {
			grid-template-columns: 1fr;
		}

		.ai-studio {
			grid-column: auto;
		}

		.ai-studio-head,
		.ai-surface-header {
			flex-direction: column;
			align-items: flex-start;
		}
	}
</style>
