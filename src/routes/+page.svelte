	<script lang="ts">
	import { browser } from '$app/environment';
	import { onMount } from 'svelte';
	import { predictStressWindow, type StressWindowLabel } from '$lib/classifier';
	import { calculateHrvMetrics } from '$lib/hrv';
	import { connectHeartRateMonitor } from '$lib/polar';
	import {
		buddyStateFromSignals,
		calculateStressFromPrediction,
		cognitiveRiskFromStress,
		interventionFor,
		recoveryStatusFromStress,
		type BuddyState,
		type CognitiveStrainRisk,
		type RecoveryStatus,
		type StressLevel
	} from '$lib/stress';
	import { hasSupabaseConfig, supabase } from '$lib/supabase';

	type TimedValue = {
		value: number;
		timestamp: number;
	};

	type SavedStressWindow = {
		id: string;
		created_at: string;
		label: StressWindowLabel;
		note: string | null;
		heart_rate_avg: number | null;
		heart_rate_max: number | null;
		rr_ms: number | null;
		rr_series: number[];
		rr_count: number | null;
		rmssd_ms: number | null;
		ln_rmssd: number | null;
		sdnn_ms: number | null;
	};

	let windowNote = $state('');

	let heartRate = $state<number | undefined>(undefined);
	let rrMs = $state<number | undefined>(undefined);
	let hrBuffer = $state<TimedValue[]>([]);
	let rrBuffer = $state<TimedValue[]>([]);
	let savedWindows = $state<SavedStressWindow[]>([]);
	const currentWindowSeconds = 60;

	const currentHeartWindow = $derived(hrBuffer.map((sample) => sample.value));
	const currentRrWindow = $derived(rrBuffer.map((sample) => sample.value));
	const currentMetrics = $derived(calculateHrvMetrics(currentRrWindow));
	const windowCoverageSeconds = $derived(
		rrBuffer.length >= 2
			? Math.max(
					0,
					Math.round((rrBuffer[rrBuffer.length - 1].timestamp - rrBuffer[0].timestamp) / 1000)
				)
			: 0
	);
	const windowHeartRateAvg = $derived(
		currentHeartWindow.length > 0
			? Number(
					(
						currentHeartWindow.reduce((sum, value) => sum + value, 0) / currentHeartWindow.length
					).toFixed(1)
				)
			: undefined
	);
	const windowHeartRateMax = $derived(
		currentHeartWindow.length > 0 ? Math.max(...currentHeartWindow) : undefined
	);
	const windowPrediction = $derived(
		predictStressWindow(
			{
				heartRateAvg: windowHeartRateAvg,
				heartRateMax: windowHeartRateMax,
				rmssdMs: currentMetrics.rmssdMs,
				lnRmssd: currentMetrics.lnRmssd,
				sdnnMs: currentMetrics.sdnnMs,
				pnn25: currentMetrics.pnn25
			},
			savedWindows.map((window) => ({
				label: window.label,
				heartRateAvg: window.heart_rate_avg ?? undefined,
				heartRateMax: window.heart_rate_max ?? undefined,
				rmssdMs: window.rmssd_ms ?? undefined,
				lnRmssd: window.ln_rmssd ?? undefined,
				sdnnMs: window.sdnn_ms ?? undefined,
				pnn25: calculateHrvMetrics(window.rr_series).pnn25
			}))
		)
	);
	const calmWindowCount = $derived(savedWindows.filter((window) => window.label === 'calm').length);
	const stressedWindowCount = $derived(
		savedWindows.filter((window) => window.label === 'stressed').length
	);
	const mlReady = $derived(calmWindowCount >= 2 && stressedWindowCount >= 2);

	const stressResult = $derived(
		calculateStressFromPrediction(windowPrediction, mlReady)
	);

	const stressScore = $derived(stressResult.score);
	const stressLevel = $derived(stressResult.level as StressLevel);
	const recoveryStatus = $derived(recoveryStatusFromStress(stressResult.score) as RecoveryStatus);
	const cognitiveRisk = $derived(cognitiveRiskFromStress(stressResult.score) as CognitiveStrainRisk);
	const buddyResult = $derived(buddyStateFromSignals(stressResult.score, recoveryStatus));
	const buddyState = $derived(buddyResult.state as BuddyState);
	const intervention = $derived(interventionFor(stressResult.level));

	let isSubmitting = $state(false);
	let submitStatus = $state('');
	let lastSavedWindow = $state<SavedStressWindow | null>(null);
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
	let sensorName = $state('Polar H9');
	let sensorStatus = $state('Disconnected');

	let stopSensor = $state<(() => Promise<void>) | null>(null);

	const levelClass = $derived(`level-${stressLevel}`);
	const recoveryClass = $derived(`recovery-${recoveryStatus}`);
	const buddyClass = $derived(`buddy-${buddyState}`);
	const recoveryPillClass = $derived(`pill-${recoveryStatus}`);
	const cognitivePillClass = $derived(`pill-cognitive-${cognitiveRisk}`);
	const levelPillClass = $derived(`pill-level-${stressLevel}`);
	const levelLabel = $derived(
		stressLevel === 'low' ? 'Low' : stressLevel === 'rising' ? 'Rising' : 'High'
	);
	const levelDescriptor = $derived(
		stressResult.isModelReady
			? 'ML score from your labeled 60-second windows'
			: 'Model warming up. Aim for at least 2 calm and 2 stressed windows.'
	);
	const streakDays = $derived(Math.max(1, Math.ceil(savedWindows.length / 3)));
	const windowReady = $derived(
		windowCoverageSeconds >= currentWindowSeconds &&
			currentHeartWindow.length >= 3 &&
			currentMetrics.sampleCount >= 8
	);
	const activeContextNote = $derived(windowNote.trim());

	if (browser) {
		canUseBluetooth = typeof navigator !== 'undefined' && 'bluetooth' in navigator;
	}

	function pruneTimedWindow(values: TimedValue[], referenceTime = Date.now()): TimedValue[] {
		const cutoff = referenceTime - currentWindowSeconds * 1000;
		return values.filter((sample) => sample.timestamp >= cutoff);
	}

	function normalizeStressWindow(row: Record<string, unknown>): SavedStressWindow {
		return {
			id: String(row.id ?? ''),
			created_at: String(row.created_at ?? ''),
			label: row.label as StressWindowLabel,
			note: typeof row.note === 'string' ? row.note : null,
			heart_rate_avg: typeof row.heart_rate_avg === 'number' ? row.heart_rate_avg : null,
			heart_rate_max: typeof row.heart_rate_max === 'number' ? row.heart_rate_max : null,
			rr_ms: typeof row.rr_ms === 'number' ? row.rr_ms : null,
			rr_series: Array.isArray(row.rr_series)
				? row.rr_series
						.map((value) => Number(value))
						.filter((value) => Number.isFinite(value))
				: [],
			rr_count: typeof row.rr_count === 'number' ? row.rr_count : null,
			rmssd_ms: typeof row.rmssd_ms === 'number' ? row.rmssd_ms : null,
			ln_rmssd: typeof row.ln_rmssd === 'number' ? row.ln_rmssd : null,
			sdnn_ms: typeof row.sdnn_ms === 'number' ? row.sdnn_ms : null
		};
	}

	async function loadStressWindows() {
		if (!supabase) {
			return;
		}

		const { data, error } = await supabase
			.from('stress_windows')
			.select(
				'id, created_at, label, note, heart_rate_avg, heart_rate_max, rr_ms, rr_series, rr_count, rmssd_ms, ln_rmssd, sdnn_ms'
			)
			.order('created_at', { ascending: false })
			.limit(24);

		if (error) {
			submitStatus = error.message;
			return;
		}

		savedWindows = (data ?? []).map((row) => normalizeStressWindow(row as Record<string, unknown>));
	}

	async function saveStressWindow(label: StressWindowLabel) {
		submitStatus = '';
		lastSavedWindow = null;

		if (!supabase) {
			submitStatus = 'Supabase is not configured yet. Add PUBLIC_SUPABASE_* values in .env.';
			return;
		}

		if (
			!windowReady ||
			windowHeartRateAvg === undefined ||
			windowHeartRateMax === undefined ||
			currentMetrics.rmssdMs === undefined ||
			currentMetrics.lnRmssd === undefined ||
			currentMetrics.sdnnMs === undefined
		) {
			submitStatus = 'Collect a fuller 60-second window before labeling it.';
			return;
		}

		isSubmitting = true;

		try {
			const payload = {
				label,
				note: activeContextNote || null,
				window_seconds: currentWindowSeconds,
				heart_rate_avg: windowHeartRateAvg,
				heart_rate_max: windowHeartRateMax,
				rr_ms: rrMs ?? currentMetrics.meanRrMs ?? null,
				rr_series: currentRrWindow,
				rr_count: currentRrWindow.length,
				rmssd_ms: currentMetrics.rmssdMs,
				ln_rmssd: currentMetrics.lnRmssd,
				sdnn_ms: currentMetrics.sdnnMs
			};

			const { data, error } = await supabase
				.from('stress_windows')
				.insert(payload)
				.select(
					'id, created_at, label, note, heart_rate_avg, heart_rate_max, rr_ms, rr_series, rr_count, rmssd_ms, ln_rmssd, sdnn_ms'
				)
				.single();

			if (error) {
				throw error;
			}

			if (!data) {
				throw new Error('Window save succeeded, but the saved row was not returned.');
			}

			lastSavedWindow = normalizeStressWindow(data as Record<string, unknown>);
			windowNote = '';
			await loadStressWindows();
			submitStatus = `Saved a ${label} window with ${currentRrWindow.length} RR samples.`;
		} catch (error) {
			submitStatus = error instanceof Error ? error.message : 'Failed to save labeled window.';
		} finally {
			isSubmitting = false;
		}
	}

	onMount(() => {
		if (hasSupabaseConfig) {
			void loadStressWindows();
		}
	});

	async function connectSensor() {
		if (!canUseBluetooth || isConnecting) {
			return;
		}

		isConnecting = true;
		sensorStatus = 'Connecting...';

		try {
			const connection = await connectHeartRateMonitor(
				(reading) => {
					const timestamp = reading.timestamp ?? Date.now();
					heartRate = reading.heartRate;
					rrMs = reading.rrMs;

					hrBuffer = pruneTimedWindow(
						[...hrBuffer, { value: reading.heartRate, timestamp }],
						timestamp
					);

					if (reading.rrSeriesMs.length > 0) {
						rrBuffer = pruneTimedWindow(
							[
								...rrBuffer,
								...reading.rrSeriesMs.map((value) => ({ value, timestamp }))
							],
							timestamp
						);
					} else if (reading.rrMs !== undefined) {
						rrBuffer = pruneTimedWindow(
							[...rrBuffer, { value: reading.rrMs, timestamp }],
							timestamp
						);
					}

					sensorStatus =
						reading.contactDetected === false
							? `${sensorName} connected. Waiting for chest strap contact.`
							: `${sensorName} is streaming a live ${currentWindowSeconds}-second window.`;
				},
				() => {
					stopSensor = null;
					isSensorConnected = false;
					sensorStatus = 'Disconnected';
				}
			);

			stopSensor = connection.stop;
			sensorName = connection.deviceName;

			isSensorConnected = true;
			sensorStatus = `${connection.deviceName} connected. Waiting for live readings...`;
		} catch (error) {
			sensorStatus = error instanceof Error ? error.message : 'Could not connect to sensor';
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
		sensorStatus = 'Disconnected';
	}

	function simulateSpike() {
		const randomHr = 95 + Math.floor(Math.random() * 26);
		const randomRr = 520 + Math.floor(Math.random() * 120);
		const timestamp = Date.now();

		heartRate = randomHr;
		rrMs = randomRr;
		hrBuffer = pruneTimedWindow([...hrBuffer, { value: randomHr, timestamp }], timestamp);
		rrBuffer = pruneTimedWindow([...rrBuffer, { value: randomRr, timestamp }], timestamp);
		sensorStatus = 'Simulated stress window loaded.';
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
					heartRate,
					rrMs,
					rmssdMs: currentMetrics.rmssdMs,
					lnRmssd: currentMetrics.lnRmssd,
					sdnnMs: currentMetrics.sdnnMs,
					predictionLabel: windowPrediction.label,
					predictionConfidence: windowPrediction.confidence,
					labeledWindowCount: savedWindows.length,
					stressLevel,
					stressScore,
					recoveryStatus,
					cognitiveStrainRisk: cognitiveRisk,
					stressor: activeContextNote || null
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
			geminiStatus = error instanceof Error ? error.message : 'Failed to generate plan.';
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
					heartRate,
					rrMs,
					rmssdMs: currentMetrics.rmssdMs,
					lnRmssd: currentMetrics.lnRmssd,
					sdnnMs: currentMetrics.sdnnMs,
					predictionLabel: windowPrediction.label,
					predictionConfidence: windowPrediction.confidence,
					labeledWindowCount: savedWindows.length,
					stressLevel,
					stressScore,
					recoveryStatus,
					cognitiveStrainRisk: cognitiveRisk,
					stressor: activeContextNote || null
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
			helperStatus = error instanceof Error ? error.message : 'Failed to ask helper.';
		} finally {
			isAskingHelper = false;
		}
	}

	function applyQuickPrompt(prompt: string) {
		helperQuestion = prompt;
	}
</script>

<svelte:head>
	<title>Sanctuary | Your Mental Space</title>
</svelte:head>

<main class="app-shell">
	<header class="mobile-topbar kit-panel">
		<div>
			<p class="brand-kicker">Sanctuary</p>
			<p class="brand-subtitle">Mental space</p>
		</div>
		<button class="icon-button" type="button" aria-label="Profile">
			<span class="material-symbols-outlined">account_circle</span>
		</button>
	</header>

	<aside class="sidebar kit-panel">
		<div class="sidebar-block">
			<p class="brand-kicker">Sanctuary</p>
			<h2 class="sidebar-title">Your calm command center</h2>

			<div class="profile-card">
				<div class="avatar">A</div>
				<div>
					<p class="profile-title">Good Morning</p>
					<p class="profile-copy">Ready for your check-in?</p>
				</div>
			</div>
		</div>

		<nav class="nav-stack" aria-label="Primary">
			<a class="nav-item is-active" href="#dashboard">
				<span class="material-symbols-outlined">dashboard</span>
				<span>Dashboard</span>
			</a>
			<a class="nav-item" href="#checkin">
				<span class="material-symbols-outlined">edit_note</span>
				<span>Check-in</span>
			</a>
			<a class="nav-item" href="#kelp">
				<span class="material-symbols-outlined">psychology</span>
				<span>AI Coach</span>
			</a>
			<a class="nav-item" href="#sensor">
				<span class="material-symbols-outlined">history</span>
				<span>History</span>
			</a>
		</nav>

		<div class="sidebar-cta">
			<button class="button button-tertiary" type="button" onclick={generateGeminiPlan}>
				Start Daily Goal
			</button>
		</div>
	</aside>

	<div class="main-column">
		<section class="hero" id="dashboard">
			<div>
				<h1>Welcome back, Alex</h1>
				<p class="hero-copy">Your H9 windows, live HRV, and Monte ML readout all in one place.</p>
			</div>

			<div class="hero-streak kit-panel">
				<div class="hero-streak-icon">
					<span class="material-symbols-outlined streak-icon">celebration</span>
				</div>
				<div>
					<p class="hero-streak-label">Daily Streak</p>
					<p class="hero-streak-value">{streakDays} DAYS</p>
				</div>
			</div>
		</section>

		<section class="kit-grid">
			<article class="stress-card kit-panel {levelClass} {recoveryClass} {buddyClass}">
				<div class="card-topline">
					<p class="meta-label">Physiologic Stress</p>
					<span class="material-symbols-outlined">waves</span>
				</div>

				<div class="score-row">
					<p class="score-number">{stressScore}</p>
					<p class="score-max">/100</p>
				</div>

				<div class="pill-row">
					<p class={`pill pill-primary ${levelPillClass}`}>Level: {levelLabel}</p>
					<p class={`pill ${recoveryPillClass}`}>Recovery: {recoveryStatus.toUpperCase()}</p>
					<p class={`pill ${cognitivePillClass}`}>Cognitive Risk: {cognitiveRisk.toUpperCase()}</p>
				</div>

				<div class="coach-box">
					<p class="coach-title">{buddyResult.label}</p>
					<p class="coach-copy">{buddyResult.message}</p>
					<p class="coach-caption">{levelDescriptor}</p>
				</div>

				<div class="coach-box metrics-box">
					<p class="coach-title">Current HRV</p>
					<p class="coach-copy">
						RMSSD {currentMetrics.rmssdMs ?? '--'} ms | lnRMSSD {currentMetrics.lnRmssd ?? '--'} | SDNN {currentMetrics.sdnnMs ?? '--'} ms | pNN25 {currentMetrics.pnn25 ?? '--'}%
					</p>
					<p class="coach-caption">Live features from the current rolling {currentWindowSeconds}-second window.</p>
				</div>

				<div class="coach-box metrics-box">
					<p class="coach-title">60-Second Window Classifier</p>
					<p class="coach-copy">
						{windowPrediction.label === 'unknown'
							? 'Waiting for enough labeled windows'
							: `${windowPrediction.label.toUpperCase()} window with ${Math.round(windowPrediction.confidence * 100)}% confidence`}
					</p>
					<p class="coach-caption">{windowPrediction.reason}</p>
				</div>

				<div class="coach-box">
					<p class="coach-title">Immediate Intervention</p>
					<p class="coach-copy">{intervention}</p>
				</div>

				<div class="status-group">
					{#if geminiSource}
						<p class="source-badge {geminiSource === 'fallback' ? 'fallback' : 'live'}">
							{geminiSource === 'fallback' ? 'Fallback Mode' : 'Live Gemini'}
						</p>
					{/if}

					<button class="button button-ghost-on-dark" onclick={generateGeminiPlan} disabled={isGeneratingPlan}>
						{isGeneratingPlan ? 'Generating AI Plan...' : 'Generate Gemini Plan'}
					</button>
				</div>

				{#if geminiStatus}
					<p class="inline-status on-dark">{geminiStatus}</p>
				{/if}

				{#if geminiPlan}
					<pre class="output-panel">{geminiPlan}</pre>
				{/if}
			</article>

			<article class="checkin-card kit-panel" id="checkin">
				<div class="section-heading">
					<div>
						<h2>Label This Window</h2>
						<p class="section-copy">
							Save the last {currentWindowSeconds} seconds of Polar H9 data as a training example for Monte.
						</p>
					</div>
					<div class="badge-icon accent-primary">
						<span class="material-symbols-outlined filled-icon">favorite</span>
					</div>
				</div>

				<div class="slider-grid window-grid">
					<div class="slider-card">
						<span class="slider-title">
							<span class="material-symbols-outlined accent-primary">timer</span>
							<span>Window</span>
						</span>
						<span class="slider-scale">
							<span>Coverage</span>
							<strong>{windowCoverageSeconds}s</strong>
							<span>{windowReady ? 'Ready' : `Need ${currentWindowSeconds}s`}</span>
						</span>
					</div>

					<div class="slider-card">
						<span class="slider-title">
							<span class="material-symbols-outlined accent-secondary">monitor_heart</span>
							<span>RR Samples</span>
						</span>
						<span class="slider-scale">
							<span>Current</span>
							<strong>{currentRrWindow.length}</strong>
							<span>{windowReady ? 'Ready' : 'Building'}</span>
						</span>
					</div>

					<div class="slider-card">
						<span class="slider-title">
							<span class="material-symbols-outlined accent-tertiary">neurology</span>
							<span>Local ML</span>
						</span>
						<span class="slider-scale">
							<span>Prediction</span>
							<strong>{windowPrediction.label === 'unknown' ? '--' : windowPrediction.label}</strong>
							<span>{calmWindowCount} calm / {stressedWindowCount} stressed</span>
						</span>
					</div>
				</div>

				<label class="field">
					<span class="field-label">Quick note</span>
					<input
						bind:value={windowNote}
						placeholder="Exams, deadlines, social, sleep..."
						maxlength="120"
					/>
				</label>

				<div class="window-actions">
					<button
						class="button button-label button-calm"
						onclick={() => saveStressWindow('calm')}
						disabled={isSubmitting || !hasSupabaseConfig || !windowReady}
					>
						{isSubmitting ? 'Saving...' : 'Label Calm'}
					</button>
					<button
						class="button button-label button-stressed"
						onclick={() => saveStressWindow('stressed')}
						disabled={isSubmitting || !hasSupabaseConfig || !windowReady}
					>
						{isSubmitting ? 'Saving...' : 'Label Stressed'}
					</button>
				</div>

				<div class="action-row action-row-wrap">
					<button class="button button-subtle" type="button" onclick={simulateSpike}>Simulate Window</button>
				</div>

				{#if !hasSupabaseConfig}
					<p class="inline-hint">Set `PUBLIC_SUPABASE_URL` and `PUBLIC_SUPABASE_ANON_KEY` in `.env`.</p>
				{/if}

				{#if submitStatus}
					<p class="inline-status">{submitStatus}</p>
				{/if}

				{#if lastSavedWindow}
					<div class="saved-panel">
						<p class="saved-title">Last saved training window</p>
						<div class="saved-metrics">
							<span>{lastSavedWindow.label.toUpperCase()}</span>
							<span>Avg HR {lastSavedWindow.heart_rate_avg ?? '--'}</span>
							<span>Max HR {lastSavedWindow.heart_rate_max ?? '--'}</span>
							<span>RMSSD {lastSavedWindow.rmssd_ms ?? '--'}</span>
							<span>SDNN {lastSavedWindow.sdnn_ms ?? '--'}</span>
							<span>RR Count {lastSavedWindow.rr_count ?? '--'}</span>
						</div>
						<p class="saved-copy">
							Saved at {new Date(lastSavedWindow.created_at).toLocaleString()} with RR {lastSavedWindow.rr_ms ?? '--'} ms and lnRMSSD {lastSavedWindow.ln_rmssd ?? '--'}.
						</p>
						{#if lastSavedWindow.note}
							<p class="saved-copy">Note: {lastSavedWindow.note}</p>
						{/if}
					</div>
				{/if}
			</article>

			<article class="sensor-card kit-panel" id="sensor">
				<div class="section-heading">
					<div>
						<h3>Live Polar H9</h3>
					</div>
					<div class="live-indicator">
						<span class:dot-live={isSensorConnected} class="live-dot"></span>
						<span>{isSensorConnected ? 'Live' : 'Standby'}</span>
					</div>
				</div>

				<div class="metric-pair">
					<div class="metric-card">
						<p class="metric-label">HEART RATE</p>
						<p class="metric-value">{heartRate ?? '--'} <span>BPM</span></p>
					</div>
					<div class="metric-card">
						<p class="metric-label">LATEST RR</p>
						<p class="metric-value secondary">{rrMs ?? '--'} <span>MS</span></p>
					</div>
					<div class="metric-card">
						<p class="metric-label">RMSSD</p>
						<p class="metric-value secondary">{currentMetrics.rmssdMs ?? '--'} <span>MS</span></p>
					</div>
					<div class="metric-card">
						<p class="metric-label">SDNN</p>
						<p class="metric-value secondary">{currentMetrics.sdnnMs ?? '--'} <span>MS</span></p>
					</div>
				</div>

				<div class="metric-pair metric-pair-compact">
					<div class="metric-card">
						<p class="metric-label">WINDOW AVG HR</p>
						<p class="metric-value secondary">{windowHeartRateAvg ?? '--'} <span>BPM</span></p>
					</div>
					<div class="metric-card">
						<p class="metric-label">WINDOW RR COUNT</p>
						<p class="metric-value secondary">{currentRrWindow.length} <span>SAMPLES</span></p>
					</div>
				</div>

				<div class="stacked-actions">
					<button
						class="button button-outline"
						onclick={connectSensor}
						disabled={!canUseBluetooth || isConnecting || isSensorConnected}
					>
						<span class="material-symbols-outlined">bluetooth</span>
						<span>{isConnecting ? 'Connecting...' : 'Connect Polar H9'}</span>
					</button>

					<div class="inline-buttons">
						<button class="button button-subtle" onclick={disconnectSensor} disabled={!isSensorConnected}>
							Disconnect
						</button>
					</div>
				</div>

				<p class="section-copy">{sensorStatus}</p>
				<p class="section-copy">
					{savedWindows.length} labeled windows saved. Training set: {calmWindowCount} calm / {stressedWindowCount} stressed.
				</p>

				<details class="debug-panel">
					<summary>Debug Panel</summary>
					<div class="debug-grid">
						<div class="debug-item">
							<span class="debug-label">Window Coverage</span>
							<strong>{windowCoverageSeconds}s / {currentWindowSeconds}s</strong>
						</div>
						<div class="debug-item">
							<span class="debug-label">Window Ready</span>
							<strong>{windowReady ? 'yes' : 'no'}</strong>
						</div>
						<div class="debug-item">
							<span class="debug-label">Model Ready</span>
							<strong>{mlReady ? 'yes' : 'no'}</strong>
						</div>
						<div class="debug-item">
							<span class="debug-label">Prediction</span>
							<strong>{windowPrediction.label}</strong>
						</div>
						<div class="debug-item">
							<span class="debug-label">Confidence</span>
							<strong>{Math.round(windowPrediction.confidence * 100)}%</strong>
						</div>
						<div class="debug-item">
							<span class="debug-label">Stress Score</span>
							<strong>{stressScore}</strong>
						</div>
						<div class="debug-item">
							<span class="debug-label">Avg HR</span>
							<strong>{windowHeartRateAvg ?? '--'}</strong>
						</div>
						<div class="debug-item">
							<span class="debug-label">Max HR</span>
							<strong>{windowHeartRateMax ?? '--'}</strong>
						</div>
						<div class="debug-item">
							<span class="debug-label">Mean RR</span>
							<strong>{currentMetrics.meanRrMs ?? '--'}</strong>
						</div>
						<div class="debug-item">
							<span class="debug-label">RMSSD</span>
							<strong>{currentMetrics.rmssdMs ?? '--'}</strong>
						</div>
						<div class="debug-item">
							<span class="debug-label">lnRMSSD</span>
							<strong>{currentMetrics.lnRmssd ?? '--'}</strong>
						</div>
						<div class="debug-item">
							<span class="debug-label">SDNN</span>
							<strong>{currentMetrics.sdnnMs ?? '--'}</strong>
						</div>
						<div class="debug-item">
							<span class="debug-label">pNN25</span>
							<strong>{currentMetrics.pnn25 ?? '--'}%</strong>
						</div>
						<div class="debug-item">
							<span class="debug-label">pNN50</span>
							<strong>{currentMetrics.pnn50 ?? '--'}%</strong>
						</div>
						<div class="debug-item">
							<span class="debug-label">Calm Windows</span>
							<strong>{calmWindowCount}</strong>
						</div>
						<div class="debug-item">
							<span class="debug-label">Stressed Windows</span>
							<strong>{stressedWindowCount}</strong>
						</div>
					</div>
					<p class="debug-reason">{windowPrediction.reason}</p>
				</details>

				{#if !canUseBluetooth}
					<p class="inline-hint">Use Chrome or Edge over HTTPS or localhost for Web Bluetooth.</p>
				{/if}
			</article>

			<article class="helper-card kit-panel" id="kelp">
				<div class="section-heading">
					<div class="helper-heading">
						<div class="badge-icon accent-tertiary">
							<span class="material-symbols-outlined">smart_toy</span>
						</div>
						<div>
							<h3>Ask Kelp</h3>
							<p class="helper-subtitle">Your AI Resilience Coach</p>
						</div>
					</div>

					<label class="persona-select">
						<span class="sr-only">Personality</span>
						<select bind:value={helperPersona}>
							<option value="calm-coach">Zen Master</option>
							<option value="tough-love">Strict Trainer</option>
							<option value="study-planner">Supportive Friend</option>
						</select>
					</label>
				</div>

				<div class="chat-shell">
					{#if helperHistory.length > 0}
						{#each helperHistory as msg}
							<div class:chat-user={msg.role === 'user'} class="chat-bubble">
								<p class="chat-author">{msg.role === 'user' ? 'You' : 'Kelp'}</p>
								<p>{msg.text}</p>
							</div>
						{/each}
					{:else}
						<div class="chat-bubble">
							<p class="chat-author">Kelp</p>
							<p>
								Hello Alex! You seem exceptionally calm today. Would you like to try a deep focus meditation or log a specific win?
							</p>
						</div>
					{/if}

					{#if helperReply}
						<div class="chat-bubble">
							<p class="chat-author">Latest Reply</p>
							<p>{helperReply}</p>
						</div>
					{/if}
				</div>

				<div class="prompt-row">
					<button
						class="prompt-chip"
						type="button"
						onclick={() => applyQuickPrompt('Help me focus')}
					>
						&quot;Help me focus&quot;
					</button>
					<button
						class="prompt-chip"
						type="button"
						onclick={() => applyQuickPrompt('Log a victory')}
					>
						&quot;Log a victory&quot;
					</button>
					<button
						class="prompt-chip"
						type="button"
						onclick={() => applyQuickPrompt('Quick breathwork')}
					>
						&quot;Quick breathwork&quot;
					</button>
				</div>

				<div class="message-row">
					<input
						class="message-input"
						bind:value={helperQuestion}
						placeholder="Type a message to Kelp..."
						maxlength="700"
					/>
					<button class="send-button" onclick={askGeminiHelper} disabled={isAskingHelper} aria-label="Send message">
						<span class="material-symbols-outlined">send</span>
					</button>
				</div>

				{#if helperSource}
					<p class="source-badge {helperSource === 'fallback' ? 'fallback' : 'live'}">
						{helperSource === 'fallback' ? 'Fallback Mode' : 'Live Gemini'}
					</p>
				{/if}

				{#if helperStatus}
					<p class="inline-status">{helperStatus}</p>
				{/if}
			</article>
		</section>
	</div>

	<footer class="mobile-footer kit-panel">
		<a class="footer-item is-active" href="#dashboard">
			<span class="material-symbols-outlined">dashboard</span>
			<span>Dashboard</span>
		</a>
		<a class="footer-item" href="#checkin">
			<span class="material-symbols-outlined">edit_note</span>
			<span>Check-in</span>
		</a>
		<a class="footer-item" href="#kelp">
			<span class="material-symbols-outlined">psychology</span>
			<span>Coach</span>
		</a>
		<a class="footer-item" href="#sensor">
			<span class="material-symbols-outlined">history</span>
			<span>History</span>
		</a>
	</footer>
</main>

<style>
	:global(:root) {
		--background: #f4f6ff;
		--surface-container-lowest: #ffffff;
		--secondary: #005da7;
		--tertiary-container: #fcc025;
		--surface-container-high: #d3e4ff;
		--error: #b31b25;
		--surface-container-highest: #c9deff;
		--on-surface: #212f42;
		--on-tertiary-container: #563e00;
		--surface: #f4f6ff;
		--surface-container: #dce9ff;
		--surface-container-low: #eaf1ff;
		--on-surface-variant: #4e5c71;
		--primary-dim: #005a50;
		--outline: #6a788d;
		--primary: #00675c;
		--on-primary: #c1fff2;
		--primary-container: #5bf4de;
		--on-secondary-container: #004884;
		--secondary-container: #b7d3ff;
		--outline-variant: #a0aec5;
		--shadow-soft: 0 20px 45px rgba(31, 47, 82, 0.12);
	}

	:global(html) {
		scroll-behavior: smooth;
	}

	:global(body) {
		margin: 0;
		font-family: 'Plus Jakarta Sans', sans-serif;
		background:
			radial-gradient(circle at top left, rgba(91, 244, 222, 0.36), transparent 32%),
			radial-gradient(circle at top right, rgba(183, 211, 255, 0.9), transparent 30%),
			linear-gradient(180deg, #f8fbff 0%, var(--background) 40%, #edf4ff 100%);
		color: var(--on-surface);
	}

	:global(*) {
		box-sizing: border-box;
	}

	:global(.material-symbols-outlined) {
		font-variation-settings:
			'FILL' 0,
			'wght' 500,
			'GRAD' 0,
			'opsz' 24;
	}

	.filled-icon,
	.streak-icon {
		font-variation-settings:
			'FILL' 1,
			'wght' 500,
			'GRAD' 0,
			'opsz' 24;
	}

	.app-shell {
		display: grid;
		grid-template-columns: 18rem minmax(0, 1fr);
		gap: 1.5rem;
		min-height: 100vh;
		padding: 1.5rem;
	}

	.kit-panel {
		background: rgba(255, 255, 255, 0.76);
		border: 1px solid rgba(160, 174, 197, 0.3);
		border-radius: 2rem;
		box-shadow: var(--shadow-soft);
		backdrop-filter: blur(18px);
	}

	.mobile-topbar,
	.mobile-footer {
		display: none;
	}

	.sidebar {
		position: sticky;
		top: 1.5rem;
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
		height: calc(100vh - 3rem);
		padding: 1.5rem;
	}

	.brand-kicker,
	.meta-label {
		margin: 0;
		font-size: 0.76rem;
		font-weight: 800;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		color: var(--primary);
	}

	.brand-subtitle,
	.helper-subtitle,
	.section-copy,
	.inline-hint,
	.inline-status,
	.saved-copy {
		margin: 0;
		color: var(--on-surface-variant);
		line-height: 1.55;
	}

	.sidebar-title {
		margin: 0.3rem 0 0;
		font-size: 1.7rem;
		line-height: 1.04;
	}

	.profile-card {
		display: flex;
		align-items: center;
		gap: 0.9rem;
		margin-top: 1.25rem;
		padding: 1rem;
		border-radius: 1.5rem;
		background: var(--surface-container-low);
	}

	.avatar,
	.hero-streak-icon,
	.badge-icon,
	.icon-button {
		display: grid;
		place-items: center;
	}

	.avatar {
		width: 3rem;
		height: 3rem;
		border-radius: 999px;
		background: linear-gradient(135deg, var(--primary), var(--primary-container));
		color: white;
		font-weight: 800;
	}

	.profile-title,
	.profile-copy {
		margin: 0;
	}

	.profile-title {
		font-weight: 700;
	}

	.profile-copy {
		font-size: 0.9rem;
		color: var(--on-surface-variant);
	}

	.nav-stack {
		display: grid;
		gap: 0.7rem;
	}

	.nav-item,
	.footer-item {
		display: flex;
		align-items: center;
		gap: 0.8rem;
		padding: 0.95rem 1rem;
		border-radius: 1.3rem;
		color: var(--on-surface-variant);
		text-decoration: none;
		font-weight: 700;
		transition:
			transform 160ms ease,
			background 160ms ease,
			color 160ms ease,
			box-shadow 160ms ease;
	}

	.nav-item:hover,
	.footer-item:hover {
		transform: translateY(-1px);
		background: rgba(201, 222, 255, 0.7);
		color: var(--on-surface);
	}

	.nav-item.is-active,
	.footer-item.is-active {
		background: linear-gradient(135deg, var(--primary), #138679);
		color: white;
		box-shadow: 0 6px 0 rgba(0, 103, 92, 0.28);
	}

	.sidebar-cta {
		margin-top: auto;
	}

	.main-column {
		display: grid;
		gap: 1.5rem;
	}

	.hero {
		display: flex;
		align-items: end;
		justify-content: space-between;
		gap: 1.2rem;
		padding: 0.5rem 0.25rem 0;
	}

	.hero h1 {
		margin: 0;
		font-size: clamp(2.8rem, 6vw, 4.7rem);
		line-height: 0.95;
		letter-spacing: -0.05em;
		color: var(--primary);
	}

	.hero-copy {
		margin-top: 0.5rem;
		font-size: 1.1rem;
		font-weight: 600;
		color: var(--on-surface-variant);
	}

	.hero-streak {
		display: flex;
		align-items: center;
		gap: 1rem;
		min-width: 15rem;
		padding: 1rem 1.2rem;
		background: rgba(211, 228, 255, 0.72);
	}

	.hero-streak-icon,
	.badge-icon {
		width: 3.35rem;
		height: 3.35rem;
		border-radius: 1.15rem;
	}

	.hero-streak-icon {
		background: var(--primary);
		color: white;
	}

	.hero-streak-label,
	.metric-label,
	.saved-title {
		margin: 0;
		font-size: 0.82rem;
		font-weight: 800;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--on-surface-variant);
	}

	.hero-streak-value {
		margin: 0.25rem 0 0;
		font-size: 1.25rem;
		font-weight: 800;
		color: var(--primary);
	}

	.kit-grid {
		display: grid;
		grid-template-columns: repeat(12, minmax(0, 1fr));
		gap: 1.5rem;
	}

	.stress-card,
	.checkin-card,
	.sensor-card,
	.helper-card {
		padding: 1.8rem;
		min-width: 0;
	}

	.stress-card {
		grid-column: span 4;
		background: linear-gradient(180deg, var(--primary) 0%, #00594f 100%);
		color: var(--on-primary);
		border-color: rgba(91, 244, 222, 0.28);
		box-shadow: 0 16px 34px rgba(0, 90, 80, 0.24);
	}

	.checkin-card {
		grid-column: span 8;
		background: linear-gradient(180deg, rgba(255, 255, 255, 0.9), rgba(234, 241, 255, 0.95));
	}

	.sensor-card {
		grid-column: span 5;
		background: rgba(255, 255, 255, 0.92);
	}

	.helper-card {
		grid-column: span 7;
		background: linear-gradient(180deg, rgba(201, 222, 255, 0.78), rgba(234, 241, 255, 0.96));
	}

	.card-topline,
	.section-heading,
	.helper-heading,
	.score-row,
	.action-row,
	.metric-pair,
	.inline-buttons,
	.pill-row {
		display: flex;
	}

	.card-topline,
	.section-heading,
	.action-row {
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
	}

	.helper-heading {
		align-items: center;
		gap: 0.9rem;
	}

	.section-heading h2,
	.section-heading h3 {
		margin: 0;
		font-size: 2rem;
		line-height: 1.05;
	}

	.score-row {
		align-items: baseline;
		gap: 0.35rem;
		margin-top: 1rem;
	}

	.score-number,
	.score-max {
		margin: 0;
	}

	.score-number {
		font-size: clamp(4rem, 8vw, 5.8rem);
		font-weight: 800;
		line-height: 0.95;
	}

	.score-max {
		font-size: 1.25rem;
		font-weight: 700;
		opacity: 0.74;
	}

	.pill-row {
		margin: 1rem 0 1.2rem;
		flex-wrap: wrap;
		gap: 0.55rem;
	}

	.pill,
	.source-badge {
		display: inline-flex;
		align-items: center;
		padding: 0.45rem 0.8rem;
		border-radius: 999px;
		font-size: 0.78rem;
		font-weight: 800;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	.pill {
		background: rgba(91, 244, 222, 0.18);
		color: #e8fffa;
		border: 1px solid rgba(255, 255, 255, 0.16);
	}

	.pill-level-low,
	.pill-green {
		background: rgba(91, 244, 222, 0.18);
		color: #e8fffa;
		border-color: rgba(160, 255, 232, 0.24);
	}

	.pill-level-rising,
	.pill-yellow,
	.pill-cognitive-medium {
		background: rgba(252, 192, 37, 0.18);
		color: #fff5d7;
		border-color: rgba(255, 221, 128, 0.24);
	}

	.pill-level-high,
	.pill-red,
	.pill-cognitive-high {
		background: rgba(251, 81, 81, 0.2);
		color: #ffe2e2;
		border-color: rgba(255, 170, 170, 0.24);
	}

	.pill-cognitive-low {
		background: rgba(122, 196, 255, 0.16);
		color: #def3ff;
		border-color: rgba(181, 225, 255, 0.24);
	}

	.coach-box {
		padding: 1rem;
		border-radius: 1.5rem;
		background: rgba(0, 90, 80, 0.26);
	}

	.metrics-box {
		margin-top: 1rem;
	}

	.coach-title {
		margin: 0 0 0.3rem;
		font-weight: 800;
	}

	.coach-copy,
	.coach-caption {
		margin: 0;
		line-height: 1.55;
	}

	.coach-caption {
		margin-top: 0.5rem;
		opacity: 0.82;
	}

	.status-group {
		display: grid;
		gap: 0.8rem;
		margin-top: 1.2rem;
	}

	.output-panel {
		margin: 1rem 0 0;
		padding: 1rem;
		white-space: pre-wrap;
		background: rgba(0, 0, 0, 0.18);
		border-radius: 1.25rem;
		border: 1px solid rgba(255, 255, 255, 0.14);
		font: 500 0.95rem/1.6 'Plus Jakarta Sans', sans-serif;
		color: #f3fffc;
	}

	.slider-grid {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 1rem;
		margin-top: 1.25rem;
	}

	.slider-card,
	.metric-card {
		display: grid;
		gap: 0.8rem;
		padding: 1.1rem;
		border-radius: 1.5rem;
		border: 1px solid rgba(160, 174, 197, 0.26);
		background: rgba(255, 255, 255, 0.8);
	}

	.slider-title {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		font-weight: 700;
	}

	.slider-scale {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		font-size: 0.78rem;
		color: var(--on-surface-variant);
	}

	.slider-scale strong {
		font-size: 1rem;
		color: var(--primary);
	}

	.field {
		display: grid;
		gap: 0.5rem;
		margin-top: 1.1rem;
	}

	.field-label {
		font-weight: 700;
	}

	.field input,
	.persona-select select,
	.message-input {
		width: 100%;
		border: 1px solid rgba(160, 174, 197, 0.38);
		border-radius: 1.15rem;
		padding: 0.95rem 1rem;
		font: inherit;
		color: var(--on-surface);
		background: rgba(255, 255, 255, 0.88);
	}

	.action-row {
		margin-top: 1.2rem;
	}

	.action-row-wrap {
		flex-wrap: wrap;
	}

	.button,
	.prompt-chip,
	.icon-button,
	.send-button {
		border: none;
		font: inherit;
		cursor: pointer;
		transition:
			transform 160ms ease,
			box-shadow 160ms ease,
			background 160ms ease,
			color 160ms ease;
	}

	.button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.55rem;
		padding: 0.95rem 1.35rem;
		border-radius: 999px;
		background: linear-gradient(135deg, var(--primary), #128d7f);
		color: white;
		font-weight: 800;
		box-shadow: 0 6px 0 rgba(0, 103, 92, 0.22);
	}

	.button:hover,
	.prompt-chip:hover,
	.icon-button:hover,
	.send-button:hover {
		transform: translateY(-1px);
	}

	.button:active,
	.prompt-chip:active,
	.icon-button:active,
	.send-button:active {
		transform: translateY(2px);
		box-shadow: none;
	}

	.button:disabled,
	.send-button:disabled {
		opacity: 0.55;
		cursor: not-allowed;
		transform: none;
		box-shadow: none;
	}

	.button-tertiary {
		width: 100%;
		background: linear-gradient(135deg, var(--tertiary-container), #ffd253);
		color: var(--on-tertiary-container);
		box-shadow: 0 6px 0 rgba(179, 139, 26, 0.26);
	}

	.button-outline {
		width: 100%;
		background: rgba(0, 103, 92, 0.06);
		color: var(--primary);
		border: 2px solid rgba(0, 103, 92, 0.18);
		box-shadow: none;
	}

	.button-subtle {
		background: rgba(201, 222, 255, 0.7);
		color: var(--on-surface);
		box-shadow: none;
	}

	.button-label {
		min-width: 0;
		box-shadow: none;
	}

	.button-calm {
		background: linear-gradient(135deg, #0f8d79, #27b29d);
	}

	.button-stressed {
		background: linear-gradient(135deg, #c14343, #ef6a6a);
	}

	.button-ghost-on-dark {
		background: rgba(255, 255, 255, 0.1);
		color: #f3fffc;
		border: 1px solid rgba(255, 255, 255, 0.16);
		box-shadow: none;
	}

	.saved-panel {
		margin-top: 1rem;
		padding: 1rem;
		border-radius: 1.4rem;
		background: rgba(211, 228, 255, 0.58);
		border: 1px solid rgba(160, 174, 197, 0.24);
	}

	.saved-metrics {
		display: flex;
		flex-wrap: wrap;
		gap: 0.55rem;
		margin: 0.7rem 0;
	}

	.saved-metrics span {
		padding: 0.45rem 0.75rem;
		border-radius: 999px;
		background: white;
		font-size: 0.8rem;
		font-weight: 800;
		color: var(--primary);
	}

	.debug-panel {
		margin-top: 1rem;
		padding: 1rem;
		border-radius: 1.4rem;
		background: rgba(211, 228, 255, 0.38);
		border: 1px solid rgba(160, 174, 197, 0.24);
	}

	.debug-panel summary {
		cursor: pointer;
		font-weight: 800;
		color: var(--primary);
	}

	.debug-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.75rem;
		margin-top: 0.9rem;
	}

	.debug-item {
		display: grid;
		gap: 0.18rem;
		padding: 0.75rem 0.85rem;
		border-radius: 1rem;
		background: rgba(255, 255, 255, 0.82);
	}

	.debug-label {
		font-size: 0.75rem;
		font-weight: 800;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--on-surface-variant);
	}

	.debug-reason {
		margin: 0.9rem 0 0;
		color: var(--on-surface-variant);
		line-height: 1.5;
	}

	.metric-pair,
	.inline-buttons {
		gap: 0.9rem;
	}

	.window-actions {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.85rem;
		margin-top: 1.2rem;
	}

	.metric-pair {
		margin-top: 1.2rem;
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}

	.metric-pair-compact {
		margin-top: 0.85rem;
	}

	.metric-card {
		min-width: 0;
		background: var(--surface-container);
	}

	.metric-value {
		margin: 0;
		font-size: 2.3rem;
		font-weight: 800;
		color: var(--primary);
	}

	.metric-value.secondary {
		color: var(--secondary);
	}

	.metric-value span {
		font-size: 1rem;
		font-weight: 700;
	}

	.stacked-actions {
		display: grid;
		gap: 0.85rem;
		margin-top: 1.2rem;
	}

	.window-grid .slider-card {
		min-height: 7.25rem;
		align-content: start;
	}

	.stacked-actions .button,
	.inline-buttons .button {
		width: 100%;
	}

	.live-indicator {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.45rem 0.75rem;
		border-radius: 999px;
		background: rgba(179, 27, 37, 0.08);
		color: var(--error);
		font-size: 0.78rem;
		font-weight: 800;
		text-transform: uppercase;
		letter-spacing: 0.08em;
	}

	.live-dot {
		width: 0.55rem;
		height: 0.55rem;
		border-radius: 999px;
		background: rgba(179, 27, 37, 0.3);
	}

	.dot-live {
		background: var(--error);
		animation: pulse 1.4s infinite;
	}

	.chat-shell {
		display: grid;
		gap: 0.8rem;
		padding: 1rem;
		margin-top: 1rem;
		border-radius: 1.6rem;
		background: rgba(255, 255, 255, 0.55);
		min-height: 14rem;
	}

	.chat-bubble {
		max-width: 85%;
		padding: 0.95rem 1rem;
		border-radius: 1.2rem 1.2rem 1.2rem 0.4rem;
		background: white;
		box-shadow: 0 8px 18px rgba(31, 47, 82, 0.08);
	}

	.chat-user {
		margin-left: auto;
		border-radius: 1.2rem 1.2rem 0.4rem 1.2rem;
		background: linear-gradient(135deg, rgba(0, 103, 92, 0.12), rgba(91, 244, 222, 0.28));
	}

	.chat-author {
		margin: 0 0 0.25rem;
		font-size: 0.76rem;
		font-weight: 800;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--on-surface-variant);
	}

	.chat-bubble p:last-child {
		margin: 0;
		line-height: 1.55;
	}

	.prompt-row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.65rem;
		margin-top: 1rem;
	}

	.prompt-chip {
		padding: 0.7rem 0.95rem;
		border-radius: 999px;
		background: white;
		color: var(--primary);
		font-size: 0.78rem;
		font-weight: 800;
		box-shadow: 0 6px 16px rgba(31, 47, 82, 0.06);
	}

	.message-row {
		position: relative;
		margin-top: 1rem;
	}

	.message-input {
		padding-right: 4.2rem;
		border-radius: 1.3rem;
	}

	.send-button {
		position: absolute;
		top: 0.55rem;
		right: 0.55rem;
		display: grid;
		place-items: center;
		width: 2.75rem;
		height: 2.75rem;
		border-radius: 0.95rem;
		background: var(--primary);
		color: white;
		box-shadow: 0 2px 0 rgba(0, 77, 69, 0.25);
	}

	.source-badge {
		width: fit-content;
		margin-top: 0.9rem;
		border: 1px solid rgba(160, 174, 197, 0.34);
	}

	.source-badge.live {
		background: rgba(91, 244, 222, 0.16);
		color: var(--primary);
	}

	.source-badge.fallback {
		background: rgba(252, 192, 37, 0.18);
		color: var(--on-tertiary-container);
	}

	.inline-status.on-dark {
		color: rgba(255, 255, 255, 0.88);
	}

	.level-low {
		border-color: rgba(91, 244, 222, 0.28);
	}

	.level-rising {
		border-color: rgba(252, 192, 37, 0.42);
	}

	.level-high {
		border-color: rgba(251, 81, 81, 0.48);
	}

	.recovery-green {
		box-shadow: 0 16px 34px rgba(0, 90, 80, 0.24);
	}

	.recovery-yellow {
		box-shadow: 0 16px 34px rgba(178, 129, 0, 0.24);
	}

	.recovery-red {
		box-shadow: 0 16px 34px rgba(166, 36, 36, 0.24);
	}

	.accent-primary {
		background: rgba(91, 244, 222, 0.24);
		color: var(--primary);
	}

	.accent-secondary {
		color: var(--secondary);
	}

	.accent-tertiary {
		color: #9d7400;
	}

	.badge-icon.accent-tertiary {
		background: rgba(252, 192, 37, 0.3);
		color: var(--on-tertiary-container);
	}

	.persona-select {
		min-width: 12rem;
	}

	.icon-button {
		width: 2.9rem;
		height: 2.9rem;
		border-radius: 999px;
		background: white;
		color: var(--primary);
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}

	@keyframes pulse {
		0% {
			box-shadow: 0 0 0 0 rgba(179, 27, 37, 0.4);
		}

		70% {
			box-shadow: 0 0 0 8px rgba(179, 27, 37, 0);
		}

		100% {
			box-shadow: 0 0 0 0 rgba(179, 27, 37, 0);
		}
	}

	@media (max-width: 1080px) {
		.app-shell {
			grid-template-columns: 1fr;
			padding: 1rem;
		}

		.sidebar {
			display: none;
		}

		.mobile-topbar {
			position: sticky;
			top: 1rem;
			z-index: 10;
			display: flex;
			align-items: center;
			justify-content: space-between;
			padding: 1rem 1.2rem;
		}

		.kit-grid {
			grid-template-columns: repeat(6, minmax(0, 1fr));
			padding-bottom: 5.5rem;
		}

		.stress-card,
		.checkin-card,
		.sensor-card,
		.helper-card {
			grid-column: span 6;
		}

		.mobile-footer {
			position: fixed;
			left: 1rem;
			right: 1rem;
			bottom: 1rem;
			z-index: 20;
			display: grid;
			grid-template-columns: repeat(4, 1fr);
			padding: 0.65rem;
		}

		.footer-item {
			flex-direction: column;
			justify-content: center;
			gap: 0.3rem;
			font-size: 0.72rem;
			padding: 0.7rem 0.35rem;
		}
	}

	@media (max-width: 720px) {
		.app-shell {
			padding: 0.75rem;
		}

		.kit-panel {
			border-radius: 1.45rem;
		}

		.stress-card,
		.checkin-card,
		.sensor-card,
		.helper-card {
			padding: 1.1rem;
		}

		.hero {
			flex-direction: column;
			align-items: stretch;
		}

		.hero h1 {
			font-size: clamp(2.4rem, 12vw, 3.6rem);
		}

		.slider-grid {
			grid-template-columns: 1fr;
		}

		.window-actions {
			grid-template-columns: 1fr;
		}

		.metric-pair,
		.inline-buttons,
		.section-heading,
		.action-row {
			flex-direction: column;
			align-items: stretch;
		}

		.metric-pair {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}

		.metric-value {
			font-size: clamp(1.7rem, 8vw, 2.15rem);
			word-break: break-word;
		}

		.metric-label {
			font-size: 0.75rem;
			line-height: 1.2;
		}

		.pill {
			width: 100%;
			justify-content: center;
			text-align: center;
		}

		.output-panel {
			font-size: 0.88rem;
			padding: 0.85rem;
		}

		.chat-bubble {
			max-width: 100%;
		}

		.persona-select {
			width: 100%;
		}
	}

	@media (max-width: 520px) {
		.metric-pair {
			grid-template-columns: 1fr;
		}

		.debug-grid {
			grid-template-columns: 1fr;
		}

		.mobile-footer {
			left: 0.5rem;
			right: 0.5rem;
			bottom: 0.5rem;
		}
	}
</style>
