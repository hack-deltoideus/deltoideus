<script lang="ts">
	import { browser } from '$app/environment';
	import { onMount } from 'svelte';
	import AppSectionNav from '$lib/components/AppSectionNav.svelte';
	import SiteNav from '$lib/components/SiteNav.svelte';
	import { publishLiveEcgReading } from '$lib/live-ecg-stream';
	import { connectHeartRateMonitor } from '$lib/polar';
	import {
		connectSharedSensor,
		disconnectSharedSensor,
		endSharedSession,
		sensorSession,
		simulateSharedSpike,
		startSharedSession,
		type DiagnosticSample,
		type SavedDiagnosticSession
	} from '$lib/sensor-session';
	import { hasSupabaseConfig, supabase } from '$lib/supabase';
	import type { Session, User } from '@supabase/supabase-js';

	type SupabaseLikeError = {
		message?: string;
		details?: string;
		hint?: string;
		code?: string;
	};

	type OAuthProvider = 'google';

	let currentSession = $state<Session | null>(null);
	let currentUser = $state<User | null>(null);
	let authStatus = $state('');
	let isSigningIn = $state<OAuthProvider | null>(null);

	let heartRate = $state<number | undefined>(undefined);
	let rrMs = $state<number | undefined>(undefined);
	let hrvMs = $state<number | undefined>(undefined);
	let isConnecting = $state(false);
	let isSavingSession = $state(false);
	let isSensorConnected = $state(false);
	let canUseBluetooth = $state(false);
	let sensorStatus = $state('Disconnected');
	let sessionStartedAt = $state<string | null>(null);
	let sessionDeviceName = $state<string | null>(null);
	let sessionSamples = $state<DiagnosticSample[]>([]);
	let lastSavedDiagnosticSession = $state<SavedDiagnosticSession | null>(null);
	let diagnosticSessions = $state<SavedDiagnosticSession[]>([]);
	let selectedDiagnosticSessionId = $state<string | null>(null);
	let diagnosticStatus = $state('');
	let isLoadingDiagnostics = $state(false);
	let showEntryAlert = $state(false);

	const displayName = $derived(getDisplayName(currentUser));
	const selectedDiagnosticSession = $derived(
		diagnosticSessions.find((session) => session.id === selectedDiagnosticSessionId) ?? null
	);

	if (browser) {
		canUseBluetooth = typeof navigator !== 'undefined' && 'bluetooth' in navigator;
	}

	onMount(() => {
		const unsubscribeSensor = sensorSession.subscribe((state) => {
			heartRate = state.heartRate;
			rrMs = state.rrMs;
			hrvMs = state.hrvMs;
			isConnecting = state.isConnecting;
			isSavingSession = state.isSavingSession;
			isSensorConnected = state.isSensorConnected;
			canUseBluetooth = state.canUseBluetooth;
			sensorStatus = state.sensorStatus;
			sessionStartedAt = state.sessionStartedAt;
			sessionDeviceName = state.sessionDeviceName;
			sessionSamples = state.sessionSamples;
		});

		if (!supabase) {
			return () => {
				unsubscribeSensor();
			};
		}

		void supabase.auth.getSession().then(({ data, error }) => {
			if (error) {
				authStatus = describeError(error, 'Failed to restore session.');
				return;
			}

			currentSession = data.session;
			currentUser = data.session?.user ?? null;
			if (data.session?.user) {
				void loadDiagnosticSessions(data.session.user.id);
			}
		});

		const {
			data: { subscription }
		} = supabase.auth.onAuthStateChange((_event, session) => {
			currentSession = session;
			currentUser = session?.user ?? null;
			if (session?.user) {
				void loadDiagnosticSessions(session.user.id);
			} else {
				diagnosticSessions = [];
				selectedDiagnosticSessionId = null;
			}
		});

		return () => {
			subscription.unsubscribe();
			unsubscribeSensor();
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

	function getDisplayName(user: User | null): string {
		if (!user) {
			return 'Friend';
		}

		const metadata = user.user_metadata as Record<string, unknown> | undefined;
		const fullName = typeof metadata?.full_name === 'string' ? metadata.full_name.trim() : '';
		const name = typeof metadata?.name === 'string' ? metadata.name.trim() : '';
		const givenName = typeof metadata?.given_name === 'string' ? metadata.given_name.trim() : '';

		if (givenName) {
			return givenName;
		}

		if (fullName) {
			return fullName.split(' ')[0] ?? fullName;
		}

		if (name) {
			return name.split(' ')[0] ?? name;
		}

		if (user.email) {
			return user.email.split('@')[0] ?? 'Friend';
		}

		return 'Friend';
	}

	function formatSessionDate(dateString: string): string {
		return new Date(dateString).toLocaleString([], {
			month: 'short',
			day: 'numeric',
			hour: 'numeric',
			minute: '2-digit'
		});
	}

	function formatMetric(value: number | null | undefined, digits = 0): string {
		if (typeof value !== 'number') {
			return '--';
		}

		return value.toFixed(digits);
	}

	function formatFullTimestamp(dateString: string | null): string {
		if (!dateString) {
			return '--';
		}

		return new Date(dateString).toLocaleString([], {
			month: 'short',
			day: 'numeric',
			year: 'numeric',
			hour: 'numeric',
			minute: '2-digit'
		});
	}

	async function loadDiagnosticSessions(userId: string) {
		if (!supabase) {
			return;
		}

		isLoadingDiagnostics = true;
		diagnosticStatus = '';

		try {
			const { data, error } = await supabase
				.from('sensor_sessions')
				.select(
					'id, created_at, started_at, ended_at, duration_seconds, avg_heart_rate, avg_rr_ms, avg_hrv_ms, last_hrv_ms, max_heart_rate, sample_count, device_name, capture_type, raw_data_path, summary_payload'
				)
				.eq('user_id', userId)
				.order('started_at', { ascending: false })
				.limit(24);

			if (error) {
				throw error;
			}

			diagnosticSessions = (data ?? []) as SavedDiagnosticSession[];
			selectedDiagnosticSessionId =
				selectedDiagnosticSessionId && diagnosticSessions.some((session) => session.id === selectedDiagnosticSessionId)
					? selectedDiagnosticSessionId
					: diagnosticSessions[0]?.id ?? null;
		} catch (error) {
			diagnosticStatus = describeError(error, 'Failed to load diagnostic sessions.');
		} finally {
			isLoadingDiagnostics = false;
		}
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
					redirectTo: `${window.location.origin}/app/sensor`
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

	async function connectSensor() {
		await connectSharedSensor();
	}

		try {
			const startedAt = new Date().toISOString();
			sessionStartedAt = startedAt;
			sessionSamples = [];
			lastSavedDiagnosticSession = null;

			stopSensor = await connectHeartRateMonitor((reading) => {
				heartRate = reading.heartRate;
				rrMs = reading.rrMs;
				hrvMs = reading.hrvMs;
				publishLiveEcgReading({
					heartRate: reading.heartRate,
					rrMs: reading.rrMs ?? Math.round(60000 / Math.max(reading.heartRate, 1)),
					receivedAtMs: Date.now()
				});

				const recordedAt = new Date().toISOString();
				const elapsedMs = Math.max(0, new Date(recordedAt).getTime() - new Date(startedAt).getTime());
				sessionSamples = [
					...sessionSamples,
					{
						recorded_at: recordedAt,
						elapsed_ms: elapsedMs,
						heart_rate: reading.heartRate,
						rr_ms: reading.rrMs ?? null,
						hrv_ms: reading.hrvMs ?? null
					}
				].slice(-600);
			});
	function startSession() {
		startSharedSession(Boolean(currentUser));
		lastSavedDiagnosticSession = null;
	}

	async function endSession() {
		const result = await endSharedSession(currentUser?.id ?? null);
		diagnosticStatus = result.warning;
		if (result.savedSession) {
			lastSavedDiagnosticSession = result.savedSession;
			diagnosticSessions = [
				result.savedSession,
				...diagnosticSessions.filter((session) => session.id !== result.savedSession?.id)
			];
			selectedDiagnosticSessionId = result.savedSession.id;
		}
	}

	async function disconnectSensor() {
		await disconnectSharedSensor();
	}

	function simulateSpike() {
		simulateSharedSpike();
	}

	async function deleteDiagnosticSession(session: SavedDiagnosticSession) {
		if (!supabase || !currentUser) {
			return;
		}

		const confirmed = browser
			? window.confirm('Delete this saved session and its raw JSON file, if one exists?')
			: false;

		if (!confirmed) {
			return;
		}

		diagnosticStatus = '';

		try {
			let storageWarning = '';

			if (session.raw_data_path) {
				const { error: storageError } = await supabase.storage
					.from('diagnostic-raw')
					.remove([session.raw_data_path]);

				if (storageError) {
					storageWarning = describeError(storageError, 'Raw session file could not be deleted.');
				}
			}

			const { data: deletedRows, error } = await supabase
				.from('sensor_sessions')
				.delete()
				.select('id')
				.eq('id', session.id)
				.eq('user_id', currentUser.id);

			if (error) {
				throw error;
			}

			if (!deletedRows || deletedRows.length === 0) {
				throw new Error('No matching session was deleted. Check row-level permissions for sensor_sessions.');
			}

			await loadDiagnosticSessions(currentUser.id);
			if (lastSavedDiagnosticSession?.id === session.id) {
				lastSavedDiagnosticSession = null;
			}
			diagnosticStatus = storageWarning
				? `Saved session deleted. ${storageWarning}`
				: 'Saved session deleted.';
		} catch (error) {
			diagnosticStatus = describeError(error, 'Failed to delete saved session.');
		}
	}

	function simulateSpike() {
		const randomHr = 95 + Math.floor(Math.random() * 26);
		const randomRr = 520 + Math.floor(Math.random() * 120);
		const randomHrv = 18 + Math.floor(Math.random() * 28);

		heartRate = randomHr;
		rrMs = randomRr;
		hrvMs = randomHrv;
		publishLiveEcgReading({
			heartRate: randomHr,
			rrMs: randomRr,
			receivedAtMs: Date.now()
		});

		if (sessionStartedAt) {
			const recordedAt = new Date().toISOString();
			const elapsedMs = Math.max(0, new Date(recordedAt).getTime() - new Date(sessionStartedAt).getTime());
			sessionSamples = [
				...sessionSamples,
				{
					recorded_at: recordedAt,
					elapsed_ms: elapsedMs,
					heart_rate: randomHr,
					rr_ms: randomRr,
					hrv_ms: randomHrv
				}
			].slice(-600);
		}
	function acknowledgeAlert() {
		showEntryAlert = false;
	}

	function takeBreak() {
		sensorStatus = 'Break mode suggested. Step away, hydrate, and take a short reset.';
		showEntryAlert = false;
	}
</script>

<svelte:head>
	<title>Sanctuary | Live Data</title>
</svelte:head>

{#if !currentUser}
	<SiteNav />
	<main class="auth-shell">
		<section class="auth-panel">
			<p class="eyebrow">Live Data</p>
			<h1>Sign in to open sensor monitoring.</h1>
			<p class="hero-copy">
				This page streams live heart metrics and gives you a dedicated place to review saved diagnostic sessions.
			</p>

			<div class="auth-actions">
				<button class="button" onclick={() => signInWithProvider('google')} disabled={isSigningIn !== null || !hasSupabaseConfig}>
					{isSigningIn === 'google' ? 'Connecting Google...' : 'Continue with Google'}
				</button>
			</div>

			{#if !hasSupabaseConfig}
				<p class="inline-hint">Set `PUBLIC_SUPABASE_URL` and `PUBLIC_SUPABASE_ANON_KEY` in `.env` first.</p>
			{/if}

			{#if authStatus}
				<p class="inline-status">{authStatus}</p>
			{/if}
		</section>
	</main>
{:else}
	<SiteNav />
	<main class="page-shell">
		<AppSectionNav />

		<section class="grid">
			<article class="sensor-card">
				<div class="section-heading">
					<div>
						<p class="eyebrow">Live Sensor</p>
						<h2>Current device stream</h2>
					</div>
					<div class="live-indicator">
						<span class:dot-live={isSensorConnected} class="live-dot"></span>
						<span>{isSensorConnected ? 'Live' : 'Standby'}</span>
					</div>
				</div>

				<div class="metric-grid">
					<div class="metric-card">
						<p class="metric-label">HEART RATE</p>
						<p class="metric-value">{heartRate ?? '--'} <span>BPM</span></p>
					</div>
					<div class="metric-card">
						<p class="metric-label">RR INTERVAL</p>
						<p class="metric-value secondary">{rrMs ?? '--'} <span>MS</span></p>
					</div>
					<div class="metric-card">
						<p class="metric-label">HRV</p>
						<p class="metric-value secondary">{hrvMs ?? '--'} <span>MS</span></p>
					</div>
				</div>

				<div class="action-stack">
					<button class="button" onclick={connectSensor} disabled={!canUseBluetooth || isConnecting || isSensorConnected}>
						<span class="material-symbols-outlined">bluetooth</span>
						<span>{isConnecting ? 'Connecting...' : 'Connect Device'}</span>
					</button>

					<button class="button session-button" onclick={sessionStartedAt ? endSession : startSession} disabled={isSavingSession || !currentUser}>
						<span class="material-symbols-outlined">{sessionStartedAt ? 'stop_circle' : 'play_circle'}</span>
						<span>
							{sessionStartedAt
								? isSavingSession
									? 'Ending Session...'
									: 'End Session'
								: 'Start Session'}
						</span>
					</button>

					<div class="inline-buttons">
						<button class="button button-subtle" onclick={disconnectSensor} disabled={!isSensorConnected}>
							Disconnect
						</button>
						<button class="button button-subtle" onclick={simulateSpike}>Simulate Spike</button>
					</div>
				</div>

				<p class="section-copy">{sensorStatus}</p>

				<div class="saved-panel">
					<div class:active={Boolean(sessionStartedAt)} class="recording-banner">
						<span class:dot-live={Boolean(sessionStartedAt)} class="recording-dot"></span>
						<span>{sessionStartedAt ? 'Recording in progress' : 'No active recording'}</span>
					</div>
					<p class="saved-title">Session status</p>
					<div class="saved-metrics">
						<span>{sessionStartedAt ? 'Session is live' : 'Waiting to start'}</span>
						<span>Started {formatFullTimestamp(sessionStartedAt)}</span>
						<span>{sessionSamples.length} captured samples</span>
					</div>
				</div>

				{#if lastSavedDiagnosticSession}
					<div class="saved-panel">
						<p class="saved-title">Last diagnostic session</p>
						<div class="saved-metrics">
							<span>{lastSavedDiagnosticSession.capture_type ?? 'polar_h9_hr_hrv'}</span>
							<span>{lastSavedDiagnosticSession.sample_count} samples</span>
							<span>{lastSavedDiagnosticSession.duration_seconds ?? 0}s</span>
							<span>Avg HR {formatMetric(lastSavedDiagnosticSession.avg_heart_rate)}</span>
							<span>Avg HRV {formatMetric(lastSavedDiagnosticSession.avg_hrv_ms, 1)}</span>
						</div>
						<p class="saved-copy">
							Started {new Date(lastSavedDiagnosticSession.started_at).toLocaleString()} on {lastSavedDiagnosticSession.device_name ?? 'Polar H9'}.
						</p>
					</div>
				{/if}

				{#if !canUseBluetooth}
					<p class="inline-hint">Use Chrome or Edge over HTTPS or localhost for Web Bluetooth.</p>
				{/if}
			</article>

			<article class="data-card">
				<div class="section-heading">
					<div>
						<p class="eyebrow">Saved Sessions</p>
						<h2>Session data explorer</h2>
					</div>
					{#if isLoadingDiagnostics}
						<p class="inline-hint loading-hint">Loading...</p>
					{/if}
				</div>

				<div class="data-layout">
					{#if diagnosticSessions.length > 0}
						<div class="session-list" role="list">
							{#each diagnosticSessions as session, index}
								<article class:selected={session.id === selectedDiagnosticSessionId} class="session-item">
									<button class="session-select" type="button" onclick={() => (selectedDiagnosticSessionId = session.id)}>
										<span class="session-index">S{index + 1}</span>
										<span class="session-item-date">{formatSessionDate(session.started_at)}</span>
										<span class="session-item-meta">
											{formatMetric(session.avg_heart_rate)} bpm · {formatMetric(session.avg_hrv_ms, 1)} ms HRV
										</span>
									</button>
									<button class="session-delete" type="button" onclick={() => deleteDiagnosticSession(session)}>
										Delete
									</button>
								</article>
							{/each}
						</div>
					{:else}
						<p class="inline-hint">Save a sensor session to populate your data view.</p>
					{/if}

					{#if diagnosticStatus}
						<p class="inline-status">{diagnosticStatus}</p>
					{/if}

					{#if selectedDiagnosticSession}
						<div class="saved-panel data-summary">
							<p class="saved-title">Selected session</p>
							<div class="saved-metrics">
								<span>{formatSessionDate(selectedDiagnosticSession.started_at)}</span>
								<span>{selectedDiagnosticSession.duration_seconds ?? 0}s</span>
								<span>{selectedDiagnosticSession.sample_count} samples</span>
								<span>{selectedDiagnosticSession.device_name ?? 'Polar H9'}</span>
							</div>

							<div class="metric-grid compact">
								<div class="metric-card">
									<p class="metric-label">AVG HEART RATE</p>
									<p class="metric-value">{formatMetric(selectedDiagnosticSession.avg_heart_rate, 1)} <span>BPM</span></p>
								</div>
								<div class="metric-card">
									<p class="metric-label">AVG HRV</p>
									<p class="metric-value secondary">{formatMetric(selectedDiagnosticSession.avg_hrv_ms, 1)} <span>MS</span></p>
								</div>
								<div class="metric-card">
									<p class="metric-label">AVG RR</p>
									<p class="metric-value secondary">{formatMetric(selectedDiagnosticSession.avg_rr_ms, 1)} <span>MS</span></p>
								</div>
								<div class="metric-card">
									<p class="metric-label">MAX HEART RATE</p>
									<p class="metric-value">{formatMetric(selectedDiagnosticSession.max_heart_rate)} <span>BPM</span></p>
								</div>
							</div>

							<p class="saved-copy">Raw JSON file: {selectedDiagnosticSession.raw_data_path ?? 'Not available'}</p>
						</div>

						<div class="segment-panel">
							<div class="section-heading segment-head">
								<div>
									<p class="saved-title">Segmented data</p>
									<p class="inline-hint">
										{selectedDiagnosticSession.summary_payload?.segmentLengthSeconds ?? 0}s windows
									</p>
								</div>
							</div>

							{#if selectedDiagnosticSession.summary_payload?.segments.length}
								<div class="segment-grid">
									{#each selectedDiagnosticSession.summary_payload.segments as segment}
										<div class="segment-card">
											<div class="segment-header">
												<p class="segment-title">Segment {segment.index}</p>
												<p class="segment-time">{formatSessionDate(segment.startedAt)}</p>
											</div>
											<div class="segment-metrics">
												<span>Avg HR {formatMetric(segment.averageHeartRate, 1)} bpm</span>
												<span>HRV {formatMetric(segment.averageHrvMs, 1)} ms</span>
												<span>RR {formatMetric(segment.averageRrMs, 1)} ms</span>
												<span>{segment.sampleCount} samples</span>
											</div>
										</div>
									{/each}
								</div>
							{:else}
								<p class="inline-hint">No segment summary is available for this session yet.</p>
							{/if}
						</div>
					{:else}
						<div class="saved-panel data-summary">
							<p class="saved-title">No data selected</p>
							<p class="saved-copy">Choose a saved session to inspect its summary JSON and segment metrics.</p>
						</div>
					{/if}
				</div>
			</article>
		</section>
	</main>

	{#if showEntryAlert}
		<div class="alert-overlay">
			<div class="alert-modal">
				<div class="alert-icon-wrap">
					<span class="material-symbols-outlined alert-icon">error</span>
				</div>
				<h2>Critical Insight</h2>
				<p>
					Your heart rate indicates you have reached <strong>cognitive decline</strong>. It&apos;s
					time to pause and reset.
				</p>
				<div class="alert-actions">
					<button class="button alert-primary" onclick={takeBreak}>Take a break</button>
					<button class="button button-subtle alert-secondary" onclick={acknowledgeAlert}>
						Acknowledge
					</button>
				</div>
				<p class="alert-footnote">Safety protocols active</p>
			</div>
		</div>
	{/if}
{/if}

<style>
	:global(:root) {
		--background: #f4f6ff;
		--surface: #f4f6ff;
		--surface-container: #dce9ff;
		--surface-container-low: #eaf1ff;
		--on-surface: #212f42;
		--on-surface-variant: #4e5c71;
		--primary: #00675c;
		--on-primary: #c1fff2;
		--secondary-container: #b7d3ff;
		--outline-variant: #a0aec5;
		--panel-bg: rgba(255, 255, 255, 0.78);
		--panel-border: rgba(160, 174, 197, 0.3);
		--field-bg: rgba(255, 255, 255, 0.88);
		--field-border: rgba(160, 174, 197, 0.38);
		--body-overlay-a: rgba(91, 244, 222, 0.36);
		--body-overlay-b: rgba(183, 211, 255, 0.9);
		--body-top: #f8fbff;
		--body-bottom: #edf4ff;
		--shadow-soft: 0 20px 45px rgba(31, 47, 82, 0.12);
	}

	:global(:root[data-theme='dark']) {
		--background: #091521;
		--surface: #0b1723;
		--surface-container: #122636;
		--surface-container-low: #0f2231;
		--on-surface: #edf5ff;
		--on-surface-variant: #bacbdd;
		--primary: #67efe0;
		--on-primary: #073a35;
		--secondary-container: #1b455f;
		--outline-variant: #465a6c;
		--panel-bg: rgba(11, 24, 36, 0.82);
		--panel-border: rgba(92, 111, 127, 0.3);
		--field-bg: rgba(16, 33, 46, 0.96);
		--field-border: rgba(81, 103, 121, 0.42);
		--body-overlay-a: rgba(91, 244, 222, 0.14);
		--body-overlay-b: rgba(82, 120, 170, 0.18);
		--body-top: #0d1a27;
		--body-bottom: #07111a;
		--shadow-soft: 0 22px 48px rgba(0, 0, 0, 0.42);
	}

	:global(body) {
		margin: 0;
		font-family: 'Plus Jakarta Sans', sans-serif;
		background:
			radial-gradient(circle at top left, var(--body-overlay-a), transparent 32%),
			radial-gradient(circle at top right, var(--body-overlay-b), transparent 30%),
			linear-gradient(180deg, var(--body-top) 0%, var(--background) 40%, var(--body-bottom) 100%);
		color: var(--on-surface);
	}

	:global(*) {
		box-sizing: border-box;
	}

	.page-shell,
	.auth-shell {
		padding: 1.2rem 1.5rem 3rem;
	}

	.auth-shell {
		max-width: 84rem;
		margin: 0 auto;
		min-height: 100vh;
		display: grid;
		place-items: center;
	}

	.page-shell > :global(.section-nav),
	.page-shell > .grid {
		width: min(100%, 84rem);
		margin-inline: auto;
	}

	.auth-panel,
	.sensor-card,
	.data-card {
		background: var(--panel-bg);
		border: 1px solid var(--panel-border);
		border-radius: 2rem;
		box-shadow: var(--shadow-soft);
		backdrop-filter: blur(18px);
	}

	.auth-panel {
		width: min(100%, 44rem);
		padding: 2rem;
	}

	.eyebrow,
	.metric-label,
	.saved-title {
		margin: 0 0 0.45rem;
		font-size: 0.78rem;
		font-weight: 800;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--on-surface-variant);
	}

	h1,
	h2 {
		margin: 0;
	}

	h1 {
		font-size: clamp(2.5rem, 6vw, 4.8rem);
		line-height: 0.96;
		letter-spacing: -0.05em;
		color: var(--primary);
	}

	.hero-copy,
	.saved-copy,
	.inline-hint,
	.inline-status,
	.section-copy {
		color: var(--on-surface-variant);
	}

	.hero-copy {
		max-width: 44rem;
		margin-top: 0.9rem;
		font-size: 1.05rem;
		line-height: 1.65;
	}

	.sensor-card,
	.data-card {
		padding: 1.45rem;
	}

	.grid {
		display: grid;
		grid-template-columns: minmax(0, 0.92fr) minmax(0, 1.08fr);
		gap: 1.2rem;
		margin-top: 1.25rem;
	}

	.grid > * {
		min-width: 0;
	}

	.section-heading,
	.saved-metrics,
	.auth-actions,
	.inline-buttons {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.8rem;
		flex-wrap: wrap;
	}

	.live-indicator {
		display: inline-flex;
		align-items: center;
		gap: 0.55rem;
		padding: 0.45rem 0.7rem;
		border-radius: 999px;
		background: color-mix(in srgb, var(--surface-container, #dce9ff) 72%, white);
		font-weight: 700;
	}

	.live-dot {
		width: 0.7rem;
		height: 0.7rem;
		border-radius: 999px;
		background: #94a3b8;
	}

	.live-dot.dot-live {
		background: #10b981;
		box-shadow: 0 0 0 0.22rem rgba(16, 185, 129, 0.2);
	}

	.recording-banner {
		display: inline-flex;
		align-items: center;
		gap: 0.55rem;
		padding: 0.55rem 0.8rem;
		border-radius: 999px;
		background: rgba(148, 163, 184, 0.16);
		color: var(--on-surface-variant);
		font-size: 0.8rem;
		font-weight: 800;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	.recording-banner.active {
		background: rgba(179, 27, 37, 0.1);
		color: var(--error);
	}

	.recording-dot {
		width: 0.62rem;
		height: 0.62rem;
		border-radius: 999px;
		background: rgba(148, 163, 184, 0.5);
	}

	.metric-grid {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 0.85rem;
		margin-top: 1rem;
	}

	.metric-grid.compact {
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}

	.metric-card,
	.saved-panel,
	.segment-card,
	.session-item {
		border-radius: 1.35rem;
	}

	.metric-card {
		padding: 1rem;
		background: color-mix(in srgb, var(--surface-container, #dce9ff) 68%, white);
	}

	.metric-value {
		margin: 0;
		font-size: 2rem;
		font-weight: 800;
		letter-spacing: -0.04em;
	}

	.metric-value span {
		font-size: 0.9rem;
		letter-spacing: 0.08em;
		color: var(--on-surface-variant);
	}

	.secondary {
		color: var(--primary);
	}

	.action-stack {
		display: grid;
		gap: 0.8rem;
		margin-top: 1rem;
	}

	.button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.55rem;
		padding: 0.9rem 1.15rem;
		border-radius: 1rem;
		border: 0;
		text-decoration: none;
		cursor: pointer;
		font: inherit;
		font-weight: 800;
		background: linear-gradient(135deg, var(--primary), #128d7f);
		color: var(--on-primary);
		box-shadow: 0 6px 0 rgba(0, 103, 92, 0.22);
		transition:
			transform 160ms ease,
			box-shadow 160ms ease,
			background 160ms ease,
			color 160ms ease;
	}

	.button-subtle {
		background: var(--secondary-container);
		color: var(--on-surface);
		box-shadow: none;
	}

	.button:hover {
		transform: translateY(-1px);
	}

	.button:active {
		transform: translateY(2px);
		box-shadow: none;
	}

	.button:disabled {
		opacity: 0.55;
		cursor: not-allowed;
		transform: none;
		box-shadow: none;
	}

	.session-button {
		width: 100%;
	}

	.saved-panel,
	.segment-panel {
		margin-top: 1rem;
		padding: 1rem;
		background: color-mix(in srgb, var(--surface-container, #dce9ff) 68%, white);
	}

	.saved-metrics {
		justify-content: flex-start;
	}

	.saved-metrics span,
	.segment-metrics span {
		padding: 0.42rem 0.65rem;
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.58);
		font-size: 0.9rem;
	}

	.data-layout {
		display: grid;
		gap: 1rem;
		margin-top: 1rem;
	}

	.session-list {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
		gap: 0.75rem;
	}

	.session-item {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: center;
		gap: 0.75rem;
		width: 100%;
		padding: 0.75rem;
		border: 1px solid transparent;
		background: color-mix(in srgb, var(--surface-container-low, #eaf1ff) 76%, white);
	}

	.session-item.selected {
		border-color: color-mix(in srgb, var(--primary, #00675c) 56%, transparent);
		background: color-mix(in srgb, var(--primary, #00675c) 14%, white);
	}

	.session-select {
		display: grid;
		gap: 0.25rem;
		width: 100%;
		padding: 0.2rem 0.25rem;
		text-align: left;
		border: 0;
		background: transparent;
		cursor: pointer;
		font: inherit;
		color: inherit;
	}

	.session-index {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		margin: 0 0 0.45rem;
		padding: 0.32rem 0.58rem;
		border-radius: 999px;
		background: color-mix(in srgb, var(--primary, #00675c) 12%, white);
		color: var(--primary, #00675c);
		font-size: 0.78rem;
		font-weight: 800;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		width: fit-content;
	}

	.session-item-date {
		font-weight: 700;
	}

	.session-item-meta {
		font-size: 0.92rem;
		color: var(--on-surface-variant);
	}

	.session-delete {
		border: 0;
		border-radius: 999px;
		padding: 0.55rem 0.8rem;
		background: rgba(179, 27, 37, 0.1);
		color: var(--error, #b31b25);
		font: inherit;
		font-weight: 800;
		cursor: pointer;
	}

	.segment-grid {
		display: grid;
		gap: 0.75rem;
		margin-top: 0.85rem;
	}

	.segment-card {
		padding: 0.95rem 1rem;
		background: color-mix(in srgb, var(--surface-container-low, #eaf1ff) 76%, white);
	}

	.segment-header,
	.segment-metrics {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.7rem;
		flex-wrap: wrap;
	}

	.segment-title,
	.segment-time {
		margin: 0;
	}

	.segment-title {
		font-weight: 700;
	}

	.segment-time {
		color: var(--on-surface-variant);
	}

	.loading-hint,
	.inline-status,
	.inline-hint,
	.section-copy,
	.saved-copy {
		margin: 0.7rem 0 0;
		line-height: 1.6;
	}

	.alert-overlay {
		position: fixed;
		inset: 0;
		z-index: 100;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1.5rem;
		background: rgba(1, 15, 32, 0.34);
		backdrop-filter: blur(14px);
	}

	.alert-modal {
		width: min(100%, 22rem);
		padding: 2rem 1.6rem 1.5rem;
		border-radius: 2rem;
		background: rgba(255, 255, 255, 0.96);
		border: 1px solid rgba(179, 27, 37, 0.08);
		box-shadow: 0 28px 60px rgba(31, 47, 82, 0.22);
		text-align: center;
	}

	.alert-icon-wrap {
		width: 4.6rem;
		height: 4.6rem;
		margin: 0 auto 1.1rem;
		display: grid;
		place-items: center;
		border-radius: 999px;
		background: rgba(251, 81, 81, 0.18);
	}

	.alert-icon {
		font-size: 2.8rem;
		color: var(--error, #b31b25);
		font-variation-settings:
			'FILL' 1,
			'wght' 500,
			'GRAD' 0,
			'opsz' 24;
	}

	.alert-modal h2 {
		margin: 0;
		font-size: 1.55rem;
		line-height: 1;
		letter-spacing: -0.04em;
		color: var(--on-surface);
	}

	.alert-modal p {
		margin: 0.9rem 0 0;
		line-height: 1.65;
		color: var(--on-surface-variant);
	}

	.alert-modal strong {
		color: var(--error, #b31b25);
	}

	.alert-actions {
		display: grid;
		gap: 0.8rem;
		margin-top: 1.35rem;
	}

	.alert-primary,
	.alert-secondary {
		width: 100%;
		border-radius: 999px;
	}

	.alert-secondary {
		background: rgba(183, 211, 255, 0.72);
	}

	.alert-footnote {
		font-size: 0.72rem;
		font-weight: 800;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--outline, #6a788d);
	}

	@media (max-width: 1180px) {
		.grid {
			grid-template-columns: 1fr;
		}
	}

	@media (max-width: 700px) {
		.metric-grid,
		.metric-grid.compact {
			grid-template-columns: 1fr;
		}
	}

	@media (max-width: 640px) {
		.page-shell,
		.auth-shell {
			padding-inline: 1rem;
		}

		.auth-panel,
		.sensor-card,
		.data-card {
			padding: 1.2rem;
			border-radius: 1.5rem;
		}
	}
</style>
