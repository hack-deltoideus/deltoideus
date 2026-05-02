<script lang="ts">
	import { browser } from '$app/environment';
	import { onMount } from 'svelte';
	import AppSectionNav from '$lib/components/AppSectionNav.svelte';
	import SiteNav from '$lib/components/SiteNav.svelte';
	import { hasSupabaseConfig, supabase } from '$lib/supabase';
	import type { Session, User } from '@supabase/supabase-js';

	type SupabaseLikeError = {
		message?: string;
		details?: string;
		hint?: string;
		code?: string;
	};

	type OAuthProvider = 'google';

	type SessionSegment = {
		index: number;
		startedAt: string;
		endedAt: string;
		durationSeconds: number;
		sampleCount: number;
		averageHeartRate: number | null;
		averageRrMs: number | null;
		averageHrvMs: number | null;
	};

	type SessionSummaryPayload = {
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
		bodyLoadState?: 'settling' | 'steady' | 'activated' | 'recovering';
		bodyLoadScore?: number;
		bodyLoadConfidence?: 'low' | 'possible' | 'likely';
		burnoutScore?: number;
		sustainedStressSeconds?: number;
		activationEvents?: Array<unknown>;
		recoveryEvents?: Array<unknown>;
		feedback?: Array<unknown>;
		bestFocusStretchSeconds?: number;
		firstRecoverySeconds?: number | null;
		nextSessionSuggestion?: string;
		segmentLengthSeconds: number;
		segments: SessionSegment[];
	};

	type SensorSessionRecord = {
		id: string;
		created_at: string;
		started_at: string;
		ended_at: string | null;
		duration_seconds: number | null;
		avg_heart_rate: number | null;
		avg_hrv_ms: number | null;
		device_name: string | null;
		capture_type: string | null;
		raw_data_path: string | null;
		summary_payload: SessionSummaryPayload | null;
	};

	type SessionCard = {
		id: string;
		dateLabel: string;
		timeLabel: string;
		activityLabel: string;
		durationLabel: string;
		durationSeconds: number;
		avgHeartRate: number | null;
		avgHrvMs: number | null;
		bodyLoadScore: number | null;
		burnoutScore: number | null;
		bodyLoadState: string;
		activationCount: number;
		labelCount: number;
		deviceLabel: string;
		segments: SessionSegment[];
	};

	type ChartPoint = {
		label: string;
		value: number;
		display: string;
	};

	let currentSession = $state<Session | null>(null);
	let currentUser = $state<User | null>(null);
	let authStatus = $state('');
	let isSigningIn = $state<OAuthProvider | null>(null);
	let historyStatus = $state('');
	let isLoadingHistory = $state(false);
	let historySessions = $state<SensorSessionRecord[]>([]);

	const displayName = $derived(getDisplayName(currentUser));
	const filteredSessions = $derived(historySessions);
	const sessionCards = $derived(filteredSessions.map(toSessionCard));
	const averageHeartRate = $derived(averageMetric(sessionCards, 'avgHeartRate'));
	const averageHrv = $derived(averageMetric(sessionCards, 'avgHrvMs'));
	const averageBodyLoad = $derived(averageMetric(sessionCards, 'bodyLoadScore'));
	const averageBurnout = $derived(averageMetric(sessionCards, 'burnoutScore'));
	const averageDurationSeconds = $derived(
		sessionCards.length > 0
			? Math.round(sessionCards.reduce((total, session) => total + session.durationSeconds, 0) / sessionCards.length)
			: 0
	);
	const heartRateChart = $derived(
		sessionCards.map((session, index) => ({
			label: `S${index + 1}`,
			value: session.avgHeartRate ?? 0,
			display: `${formatMetric(session.avgHeartRate, 1)} bpm`
		}))
	);
	const hrvChart = $derived(
		sessionCards.map((session, index) => ({
			label: `S${index + 1}`,
			value: session.avgHrvMs ?? 0,
			display: `${formatMetric(session.avgHrvMs, 1)} ms`
		}))
	);

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
			if (data.session?.user) {
				void loadHistorySessions(data.session.user.id);
			}
		});

		const {
			data: { subscription }
		} = supabase.auth.onAuthStateChange((_event, session) => {
			currentSession = session;
			currentUser = session?.user ?? null;
			authStatus = '';
			if (session?.user) {
				void loadHistorySessions(session.user.id);
			} else {
				historySessions = [];
			}
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
					redirectTo: `${window.location.origin}/app/history`
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

	async function loadHistorySessions(userId: string) {
		if (!supabase) {
			return;
		}

		isLoadingHistory = true;
		historyStatus = '';

		try {
			const { data, error } = await supabase
				.from('sensor_sessions')
				.select(
					'id, created_at, started_at, ended_at, duration_seconds, avg_heart_rate, avg_hrv_ms, device_name, capture_type, raw_data_path, summary_payload'
				)
				.eq('user_id', userId)
				.order('started_at', { ascending: false })
				.limit(60);

			if (error) {
				throw error;
			}

			historySessions = (data ?? []) as SensorSessionRecord[];
		} catch (error) {
			historyStatus = describeError(error, 'Failed to load history sessions.');
		} finally {
			isLoadingHistory = false;
		}
	}

	function getSessionDateValue(dateString: string): string {
		return new Date(dateString).toISOString().slice(0, 10);
	}

	function formatDateLabel(dateValue: string): string {
		return new Date(`${dateValue}T12:00:00`).toLocaleDateString([], {
			month: 'long',
			day: 'numeric',
			year: 'numeric'
		});
	}

	function formatTimeLabel(dateString: string): string {
		return new Date(dateString).toLocaleTimeString([], {
			hour: 'numeric',
			minute: '2-digit'
		});
	}

	function formatMetric(value: number | null | undefined, digits = 0): string {
		if (typeof value !== 'number' || Number.isNaN(value)) {
			return '--';
		}

		return value.toFixed(digits);
	}

	function formatDuration(durationSeconds: number): string {
		if (!durationSeconds) {
			return '--';
		}

		const hours = Math.floor(durationSeconds / 3600);
		const minutes = Math.floor((durationSeconds % 3600) / 60);

		if (hours > 0) {
			return `${hours}h ${minutes}m`;
		}

		return `${Math.max(1, minutes)}m`;
	}

	function formatActivityLabel(value: string | null | undefined): string {
		if (!value) {
			return 'Sensor Session';
		}

		return value
			.split(/[_-]+/)
			.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
			.join(' ');
	}

	function toSessionCard(session: SensorSessionRecord): SessionCard {
		const payload = session.summary_payload;
		const startedAt = payload?.startedAt ?? session.started_at;
		const durationSeconds = payload?.durationSeconds ?? session.duration_seconds ?? 0;
		const avgHeartRate = payload?.averageHeartRate ?? session.avg_heart_rate ?? null;
		const avgHrvMs = payload?.averageHrvMs ?? session.avg_hrv_ms ?? null;

		return {
			id: session.id,
			dateLabel: formatDateLabel(getSessionDateValue(startedAt)),
			timeLabel: formatTimeLabel(startedAt),
			activityLabel: formatActivityLabel(payload?.captureType ?? session.capture_type),
			durationLabel: formatDuration(durationSeconds),
			durationSeconds,
			avgHeartRate,
			avgHrvMs,
			bodyLoadScore: payload?.bodyLoadScore ?? null,
			burnoutScore: payload?.burnoutScore ?? null,
			bodyLoadState: formatBodyLoadState(payload?.bodyLoadState),
			activationCount: payload?.activationEvents?.length ?? 0,
			labelCount: payload?.feedback?.length ?? 0,
			deviceLabel: payload?.deviceInfo?.name ?? session.device_name ?? 'Unknown device',
			segments: payload?.segments ?? []
		};
	}

	function averageMetric(sessions: SessionCard[], key: 'avgHeartRate' | 'avgHrvMs' | 'bodyLoadScore' | 'burnoutScore'): number | null {
		const values = sessions
			.map((session) => session[key])
			.filter((value): value is number => typeof value === 'number' && !Number.isNaN(value));

		if (values.length === 0) {
			return null;
		}

		return values.reduce((total, value) => total + value, 0) / values.length;
	}

	function formatBodyLoadState(value: SessionSummaryPayload['bodyLoadState']): string {
		if (!value) {
			return 'Not labeled';
		}

		return value
			.split(/[_-]+/)
			.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
			.join(' ');
	}

	function barHeight(value: number, maxValue: number): number {
		if (!maxValue || value <= 0) {
			return 8;
		}

		return Math.max(8, (value / maxValue) * 100);
	}

	function segmentChartPath(segments: SessionSegment[]): string {
		if (segments.length === 0) {
			return '';
		}

		return segments
			.map((segment, index) => {
				const x = segments.length === 1 ? 0 : (index / (segments.length - 1)) * 100;
				const metric = segment.averageHeartRate ?? 0;
				const y = 100 - Math.min(100, metric);
				return `${index === 0 ? 'M' : 'L'}${x},${y}`;
			})
			.join(' ');
	}

	async function deleteHistorySession(sessionId: string) {
		if (!supabase || !currentUser) {
			return;
		}

		const target = historySessions.find((session) => session.id === sessionId);
		if (!target) {
			return;
		}

		const confirmed = browser
			? window.confirm('Delete this saved session and its raw JSON file, if one exists?')
			: false;

		if (!confirmed) {
			return;
		}

		historyStatus = '';

		try {
			let storageWarning = '';

			if (target.raw_data_path) {
				const { error: storageError } = await supabase.storage
					.from('diagnostic-raw')
					.remove([target.raw_data_path]);

				if (storageError) {
					storageWarning = describeError(storageError, 'Raw session file could not be deleted.');
				}
			}

			const { data: deletedRows, error } = await supabase
				.from('sensor_sessions')
				.delete()
				.select('id')
				.eq('id', target.id)
				.eq('user_id', currentUser.id);

			if (error) {
				throw error;
			}

			if (!deletedRows || deletedRows.length === 0) {
				throw new Error('No matching session was deleted. Check row-level permissions for sensor_sessions.');
			}

			await loadHistorySessions(currentUser.id);
			historyStatus = storageWarning
				? `Saved session deleted. ${storageWarning}`
				: 'Saved session deleted.';
		} catch (error) {
			historyStatus = describeError(error, 'Failed to delete saved session.');
		}
	}
</script>

<svelte:head>
	<title>Sanctuary | History</title>
</svelte:head>

{#if !currentUser}
	<SiteNav />
	<main class="auth-shell">
		<section class="auth-card">
			<p class="eyebrow">History</p>
			<h1>Sign in to review your session history.</h1>
			<p class="auth-copy">
				History shows your saved sensor sessions with date filters, heart-rate trends, stress scores, burnout scores, duration, and tracked activity.
			</p>

			<div class="auth-actions">
				<button class="button" onclick={() => signInWithProvider('google')} disabled={isSigningIn !== null || !hasSupabaseConfig}>
					{isSigningIn === 'google' ? 'Connecting Google...' : 'Continue with Google'}
				</button>
				<a class="button button-subtle" href="/app">Back to dashboard</a>
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
	<main class="history-page">
		<section class="history-frame">
			<AppSectionNav />

			{#if historyStatus}
				<p class="inline-status">{historyStatus}</p>
			{/if}

			<section class="overview-grid">
				<article class="stat-card">
					<p class="stat-label">Average Heart Rate</p>
					<p class="stat-value">{formatMetric(averageHeartRate, 1)} <span>BPM</span></p>
				</article>
				<article class="stat-card">
					<p class="stat-label">Average Stress Score</p>
					<p class="stat-value">{formatMetric(averageBodyLoad, 0)} <span>/100</span></p>
				</article>
				<article class="stat-card">
					<p class="stat-label">Average Burnout Score</p>
					<p class="stat-value">{formatMetric(averageBurnout, 0)} <span>/100</span></p>
				</article>
				<article class="stat-card">
					<p class="stat-label">Average Session Length</p>
					<p class="stat-value">{formatDuration(averageDurationSeconds)}</p>
				</article>
			</section>

			<section class="chart-grid">
				<article class="chart-card">
					<div class="section-heading">
						<div>
							<h2>Heart rate by session</h2>
							<p>Average BPM for each saved session in the current filter.</p>
						</div>
					</div>

					{#if heartRateChart.length > 0}
						<div class="bar-chart" role="img" aria-label="Heart rate chart">
							{#each heartRateChart as point}
								<div class="bar-group">
									<div class="bar-value">{point.display}</div>
									<div class="bar-track">
										<div class="bar-fill heart" style={`height: ${barHeight(point.value, Math.max(...heartRateChart.map((item) => item.value), 1))}%`}></div>
									</div>
									<div class="bar-label">{point.label}</div>
								</div>
							{/each}
						</div>
					{:else}
						<p class="inline-hint">No saved heart-rate sessions yet.</p>
					{/if}
				</article>

				<article class="chart-card">
					<div class="section-heading">
						<div>
							<h2>Average RMSSD by session</h2>
							<p>Average RMSSD in milliseconds for each session in the current filter.</p>
						</div>
					</div>

					{#if hrvChart.length > 0}
						<div class="bar-chart" role="img" aria-label="RMSSD chart">
							{#each hrvChart as point}
								<div class="bar-group">
									<div class="bar-value">{point.display}</div>
									<div class="bar-track">
										<div class="bar-fill hrv" style={`height: ${barHeight(point.value, Math.max(...hrvChart.map((item) => item.value), 1))}%`}></div>
									</div>
									<div class="bar-label">{point.label}</div>
								</div>
							{/each}
						</div>
					{:else}
						<p class="inline-hint">No RMSSD summary is available yet.</p>
					{/if}
				</article>
			</section>

			<section class="session-list">
				<div class="section-heading">
					<div>
						<h2>Saved sessions</h2>
						<p>Every card reflects what is currently stored for this signed-in user in `summary_payload`.</p>
					</div>
					{#if isLoadingHistory}
						<p class="inline-hint">Loading...</p>
					{/if}
				</div>

				{#if sessionCards.length > 0}
					<div class="session-grid">
						{#each sessionCards as session, index}
							<article class="session-card">
								<div class="session-head">
									<div>
										<p class="session-index">S{index + 1}</p>
										<p class="session-date">{session.dateLabel}</p>
										<h3>{session.activityLabel}</h3>
									</div>
									<div class="session-head-actions">
										<p class="session-time">{session.timeLabel}</p>
										<button class="session-delete" type="button" onclick={() => deleteHistorySession(session.id)}>
											Delete
										</button>
									</div>
								</div>

								<div class="session-metrics">
									<div>
										<span class="metric-label">Heart Rate</span>
										<strong>{formatMetric(session.avgHeartRate, 1)} bpm</strong>
									</div>
									<div>
										<span class="metric-label">Burnout Score</span>
										<strong>{formatMetric(session.burnoutScore, 0)} /100</strong>
									</div>
									<div>
										<span class="metric-label">Stress Score</span>
										<strong>{formatMetric(session.bodyLoadScore, 0)} /100</strong>
									</div>
									<div>
										<span class="metric-label">State</span>
										<strong>{session.bodyLoadState}</strong>
									</div>
									<div>
										<span class="metric-label">Time</span>
										<strong>{session.durationLabel}</strong>
									</div>
									<div>
										<span class="metric-label">Device</span>
										<strong>{session.deviceLabel}</strong>
									</div>
								</div>

								<div class="saved-metrics session-tags">
									<span>{session.activationCount} activation events</span>
									<span>{session.labelCount} labels</span>
								</div>

								{#if session.segments.length > 0}
									<div class="segment-summary">
										<div class="segment-head">
											<p>Segment trend</p>
											<span>{session.segments.length} segment{session.segments.length === 1 ? '' : 's'}</span>
										</div>
										<svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="Segment heart-rate trend">
											<path d={segmentChartPath(session.segments)} />
										</svg>
									</div>
								{/if}
							</article>
						{/each}
					</div>
				{:else}
					<div class="empty-card">
						<h3>No sessions match this filter yet.</h3>
						<p>Try a different date, or save a new session from the Live Data page first.</p>
					</div>
				{/if}
			</section>
		</section>
	</main>
{/if}

<style>
	:global(:root) {
		--background: #f4f6ff;
		--surface: #f4f6ff;
		--surface-container-lowest: #ffffff;
		--surface-container-low: #eaf1ff;
		--surface-container: #dce9ff;
		--surface-container-high: #d3e4ff;
		--on-surface: #212f42;
		--on-surface-variant: #4e5c71;
		--primary: #00675c;
		--on-primary: #c1fff2;
		--secondary-container: #b7d3ff;
		--outline-variant: #a0aec5;
		--panel-bg: rgba(255, 255, 255, 0.82);
		--panel-border: rgba(160, 174, 197, 0.3);
		--field-bg: rgba(255, 255, 255, 0.9);
		--field-border: rgba(160, 174, 197, 0.4);
		--body-overlay-a: rgba(91, 244, 222, 0.26);
		--body-overlay-b: rgba(183, 211, 255, 0.86);
		--body-top: #f8fbff;
		--body-bottom: #edf4ff;
		--shadow-soft: 0 20px 45px rgba(31, 47, 82, 0.12);
	}

	:global(:root[data-theme='dark']) {
		--background: #091521;
		--surface: #0b1723;
		--surface-container-lowest: #0d1c2a;
		--surface-container-low: #0f2231;
		--surface-container: #122636;
		--surface-container-high: #173244;
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
			radial-gradient(circle at top left, var(--body-overlay-a), transparent 28%),
			radial-gradient(circle at top right, var(--body-overlay-b), transparent 30%),
			linear-gradient(180deg, var(--body-top) 0%, var(--background) 42%, var(--body-bottom) 100%);
		color: var(--on-surface);
	}

	:global(*) {
		box-sizing: border-box;
	}

	.auth-shell {
		min-height: calc(100vh - 5rem);
		display: grid;
		place-items: center;
		padding: 1.5rem;
	}

	.auth-card,
	.stat-card,
	.chart-card,
	.session-card,
	.empty-card {
		background: var(--panel-bg);
		border: 1px solid var(--panel-border);
		border-radius: 1.8rem;
		box-shadow: var(--shadow-soft);
		backdrop-filter: blur(18px);
	}

	.auth-card {
		width: min(100%, 44rem);
		padding: 2rem;
	}

	.eyebrow {
		margin: 0;
		font-size: 0.78rem;
		font-weight: 800;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		color: var(--primary);
	}

	.auth-card h1 {
		margin: 0.35rem 0 0;
		line-height: 0.96;
		letter-spacing: -0.04em;
	}

	.auth-card h1 {
		font-size: clamp(2.2rem, 5vw, 4rem);
		color: var(--primary);
	}

	.auth-copy,
	.inline-hint,
	.inline-status,
	.section-heading p,
	.empty-card p {
		margin: 0;
		line-height: 1.55;
		color: var(--on-surface-variant);
	}

	.auth-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.85rem;
		margin-top: 1.5rem;
	}

	.button,
	.button-subtle {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.55rem;
		border: none;
		border-radius: 999px;
		padding: 0.95rem 1.3rem;
		text-decoration: none;
		font: inherit;
		font-weight: 800;
		cursor: pointer;
	}

	.button {
		background: linear-gradient(135deg, var(--primary), #128d7f);
		color: #ffffff;
		box-shadow: 0 6px 0 rgba(0, 103, 92, 0.22);
	}

	.button-subtle {
		background: rgba(201, 222, 255, 0.7);
		color: var(--on-surface);
	}

	.history-page {
		padding: 1.2rem 1.5rem 1.6rem;
	}

	.history-frame {
		display: grid;
		gap: 1.35rem;
		max-width: 84rem;
		margin: 0 auto;
	}

	.metric-label,
	.stat-label,
	.bar-label,
	.session-date,
	.segment-head p {
		font-size: 0.8rem;
		font-weight: 800;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--on-surface-variant);
	}

	.overview-grid,
	.chart-grid {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 1rem;
	}

	.chart-grid {
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}

	.stat-card,
	.chart-card,
	.session-card,
	.empty-card {
		padding: 1.5rem;
	}

	.stat-value {
		margin: 0.45rem 0 0;
		font-size: clamp(1.8rem, 4vw, 2.8rem);
		font-weight: 800;
		letter-spacing: -0.04em;
		color: var(--on-surface);
	}

	.stat-value span {
		font-size: 0.9rem;
		letter-spacing: 0.02em;
		color: var(--on-surface-variant);
	}

	.section-heading {
		display: flex;
		align-items: end;
		justify-content: space-between;
		gap: 1rem;
	}

	.session-head-actions {
		display: grid;
		justify-items: end;
		gap: 0.55rem;
	}

	.section-heading h2 {
		margin: 0;
		font-size: 1.45rem;
		color: var(--on-surface);
	}

	.bar-chart {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(3.5rem, 1fr));
		gap: 0.9rem;
		align-items: end;
		margin-top: 1.4rem;
		min-height: 15rem;
	}

	.bar-group {
		display: grid;
		gap: 0.55rem;
		align-items: end;
		justify-items: center;
	}

	.bar-value {
		font-size: 0.8rem;
		font-weight: 700;
		color: var(--on-surface);
	}

	.bar-track {
		display: flex;
		align-items: end;
		justify-content: center;
		width: 100%;
		height: 10rem;
		padding: 0.35rem;
		border-radius: 1.2rem;
		background: color-mix(in srgb, var(--surface-container-low) 82%, transparent);
		border: 1px solid color-mix(in srgb, var(--outline-variant) 42%, transparent);
	}

	.bar-fill {
		width: 100%;
		border-radius: 0.9rem;
		min-height: 0.5rem;
	}

	.bar-fill.heart {
		background: linear-gradient(180deg, #ff7e87 0%, #d65a64 100%);
	}

	.bar-fill.hrv {
		background: linear-gradient(180deg, var(--primary) 0%, #128d7f 100%);
	}

	.session-list {
		display: grid;
		gap: 1rem;
	}

	.session-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(18rem, 1fr));
		gap: 1rem;
	}

	.session-head,
	.session-metrics,
	.segment-head {
		display: flex;
		justify-content: space-between;
		gap: 0.8rem;
		flex-wrap: wrap;
	}

	.session-head h3 {
		margin: 0.2rem 0 0;
		font-size: 1.25rem;
		color: var(--on-surface);
	}

	.session-time {
		margin: 0;
		font-weight: 700;
		color: var(--on-surface-variant);
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

	.session-metrics {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 1rem;
		margin-top: 1.2rem;
	}

	.session-metrics strong {
		display: block;
		margin-top: 0.25rem;
		font-size: 1.05rem;
		color: var(--on-surface);
	}

	.session-tags {
		display: flex;
		flex-wrap: wrap;
		gap: 0.55rem;
		margin-top: 1rem;
	}

	.session-tags span {
		padding: 0.42rem 0.65rem;
		border-radius: 999px;
		background: color-mix(in srgb, var(--primary, #00675c) 12%, white);
		color: var(--primary, #00675c);
		font-size: 0.82rem;
		font-weight: 800;
	}

	.segment-summary {
		margin-top: 1.3rem;
		padding-top: 1rem;
		border-top: 1px solid color-mix(in srgb, var(--outline-variant) 38%, transparent);
	}

	.segment-head span {
		font-size: 0.9rem;
		color: var(--on-surface-variant);
	}

	.segment-summary svg {
		width: 100%;
		height: 5rem;
		margin-top: 0.8rem;
		overflow: visible;
	}

	.segment-summary path {
		fill: none;
		stroke: var(--primary);
		stroke-width: 3;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.empty-card h3 {
		margin: 0;
		color: var(--on-surface);
	}

	@media (max-width: 960px) {
		.overview-grid,
		.chart-grid {
			grid-template-columns: 1fr;
		}
	}

	@media (max-width: 720px) {
		.history-page,
		.auth-shell {
			padding-inline: 1rem;
		}

		.session-metrics {
			grid-template-columns: 1fr;
		}
	}
</style>
