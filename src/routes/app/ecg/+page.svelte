<script lang="ts">
	import { browser } from '$app/environment';
	import { onMount } from 'svelte';
	import EcgMonitor from '$lib/components/EcgMonitor.svelte';
	import AppSectionNav from '$lib/components/AppSectionNav.svelte';
	import SiteNav from '$lib/components/SiteNav.svelte';
	import {
		mockEcgSessions,
		type MockEcgSample,
		type MockEcgSession
	} from '$lib/mock/ecg';
	import {
		buildBeatSchedule,
		findCurrentSample,
		getScheduleDurationMs
	} from '$lib/ecg/scheduler';
	import { hasSupabaseConfig, supabase } from '$lib/supabase';
	import type { Session, User } from '@supabase/supabase-js';

	type SupabaseLikeError = {
		message?: string;
		details?: string;
		hint?: string;
		code?: string;
	};

	let currentSession = $state<Session | null>(null);
	let currentUser = $state<User | null>(null);
	let authStatus = $state('');
	let selectedSessionId = $state(mockEcgSessions[0]?.id ?? '');
	let isPlaying = $state(true);
	let speedMultiplier = $state(1);
	let currentTimeMs = $state(0);

	let playbackFrame: number | null = null;
	let lastFrameTimeMs: number | null = null;

	const displayName = $derived(getDisplayName(currentUser));
	const selectedSession = $derived(
		mockEcgSessions.find((session) => session.id === selectedSessionId) ?? mockEcgSessions[0]
	);
	const beatSchedule = $derived(buildBeatSchedule(selectedSession.samples, { height: 280 }));
	const totalDurationMs = $derived(getScheduleDurationMs(beatSchedule));
	const selectedSample = $derived(
		findCurrentSample(beatSchedule, currentTimeMs) ?? selectedSession.samples[0]
	);
	const sampleIndex = $derived(
		Math.max(
			0,
			selectedSession.samples.findIndex(
			(sample) =>
				sample.elapsedSeconds === selectedSample.elapsedSeconds &&
				sample.heartRate === selectedSample.heartRate &&
				sample.rrMs === selectedSample.rrMs
			)
		)
	);
	const progress = $derived(
		totalDurationMs > 0 ? currentTimeMs / totalDurationMs : 0
	);
	const progressPercent = $derived(`${Math.round(progress * 100)}%`);
	const elapsedLabel = $derived(formatElapsed(Math.floor(currentTimeMs / 1000)));

	onMount(() => {
		if (supabase) {
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
			});

			if (browser) {
				startPlaybackLoop();
			}

			return () => {
				subscription.unsubscribe();
				stopPlaybackLoop();
			};
		}

		if (browser) {
			startPlaybackLoop();
		}

		return () => {
			stopPlaybackLoop();
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
			return 'Developer';
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
			return user.email.split('@')[0] ?? 'Developer';
		}

		return 'Developer';
	}

	function formatElapsed(totalSeconds: number): string {
		const minutes = Math.floor(totalSeconds / 60);
		const seconds = totalSeconds % 60;
		return `${minutes}:${seconds.toString().padStart(2, '0')}`;
	}

	function formatIntensity(intensity: MockEcgSession['intensity']): string {
		return intensity === 'low' ? 'Low strain' : intensity === 'moderate' ? 'Moderate load' : 'High load';
	}

	function averageHeartRate(samples: MockEcgSample[]): number {
		return Math.round(samples.reduce((sum, sample) => sum + sample.heartRate, 0) / samples.length);
	}

	function averageRr(samples: MockEcgSample[]): number {
		return Math.round(samples.reduce((sum, sample) => sum + sample.rrMs, 0) / samples.length);
	}

	function selectSession(sessionId: string) {
		selectedSessionId = sessionId;
		currentTimeMs = 0;
		lastFrameTimeMs = null;
	}

	function restartPlayback() {
		currentTimeMs = 0;
		lastFrameTimeMs = null;
	}

	function togglePlayback() {
		isPlaying = !isPlaying;

		if (isPlaying) {
			startPlaybackLoop();
			return;
		}

		stopPlaybackLoop();
	}

	function animatePlayback(timestamp: number) {
		if (!isPlaying || totalDurationMs <= 0) {
			lastFrameTimeMs = timestamp;
			playbackFrame = null;
			return;
		}

		if (lastFrameTimeMs === null) {
			lastFrameTimeMs = timestamp;
		}

		const deltaMs = timestamp - lastFrameTimeMs;
		lastFrameTimeMs = timestamp;
		currentTimeMs = (currentTimeMs + deltaMs * speedMultiplier) % totalDurationMs;
		playbackFrame = window.requestAnimationFrame(animatePlayback);
	}

	function startPlaybackLoop() {
		if (!browser || playbackFrame !== null || !isPlaying) {
			return;
		}

		playbackFrame = window.requestAnimationFrame(animatePlayback);
	}

	function stopPlaybackLoop() {
		if (playbackFrame !== null) {
			window.cancelAnimationFrame(playbackFrame);
			playbackFrame = null;
		}

		lastFrameTimeMs = null;
	}

	function updateSpeed(event: Event) {
		const nextValue = Number((event.currentTarget as HTMLSelectElement).value);
		speedMultiplier = Number.isFinite(nextValue) && nextValue > 0 ? nextValue : 1;
	}
</script>

<svelte:head>
	<title>Sanctuary | ECG</title>
</svelte:head>

<SiteNav />

<main class="page-shell">
	<section class="hero">
		<div>
			<p class="eyebrow">ECG Playground</p>
			<h1>Artificial ECG playback for {displayName}</h1>
			<p class="hero-copy">
				This strip is intentionally synthetic. It animates a general ECG-like waveform from mock
				HR and RR values so we can build the live experience before wiring real Supabase samples.
			</p>
		</div>

		<div class="hero-card">
			<p class="hero-card-label">Data source</p>
			<p class="hero-card-value">MOCK</p>
			<p class="hero-card-copy">Ready for a future `heart_rate_samples` adapter.</p>
		</div>
	</section>

	<AppSectionNav />

	<section class="grid">
		<article class="viewer-card">
			<div class="section-heading">
				<div>
					<p class="eyebrow">Animated Strip</p>
					<h2>{selectedSession.title}</h2>
					<p class="section-copy">{selectedSession.description}</p>
				</div>

				<div class="session-badges">
					<span class={`badge badge-${selectedSession.intensity}`}>
						{formatIntensity(selectedSession.intensity)}
					</span>
					<span class="badge badge-muted">{selectedSession.durationMinutes} min</span>
				</div>
			</div>

			<div class="monitor-shell">
				<EcgMonitor
					schedule={beatSchedule}
					currentTimeMs={currentTimeMs}
				/>
			</div>

			<div class="progress-block">
				<div class="progress-meta">
					<p>Playback progress</p>
					<span>{elapsedLabel} / {selectedSession.durationMinutes}:00</span>
				</div>
				<div class="progress-bar" aria-hidden="true">
					<div class="progress-fill" style={`width:${progressPercent}`}></div>
				</div>
			</div>

			<div class="metric-grid">
				<div class="metric-card">
					<p class="metric-label">HEART RATE</p>
					<p class="metric-value">{selectedSample.heartRate}<span> BPM</span></p>
				</div>
				<div class="metric-card">
					<p class="metric-label">RR INTERVAL</p>
					<p class="metric-value secondary">{selectedSample.rrMs}<span> MS</span></p>
				</div>
				<div class="metric-card">
					<p class="metric-label">SAMPLE</p>
					<p class="metric-value tertiary">{sampleIndex + 1}<span> / {selectedSession.samples.length}</span></p>
				</div>
			</div>

			<div class="control-row">
				<button class="button" type="button" onclick={togglePlayback}>
					<span class="material-symbols-outlined">
						{isPlaying ? 'pause_circle' : 'play_circle'}
					</span>
					<span>{isPlaying ? 'Pause playback' : 'Resume playback'}</span>
				</button>

				<button class="button button-subtle" type="button" onclick={restartPlayback}>
					Restart
				</button>

				<label class="speed-select">
					<span>Speed</span>
					<select bind:value={speedMultiplier} onchange={updateSpeed}>
						<option value={0.75}>0.75x</option>
						<option value={1}>1x</option>
						<option value={1.5}>1.5x</option>
						<option value={2}>2x</option>
					</select>
				</label>
			</div>
		</article>

		<aside class="sidebar-card">
			<div class="section-heading sidebar-head">
				<div>
					<p class="eyebrow">Mock Sessions</p>
					<h2>Development inputs</h2>
				</div>
			</div>

			<div class="session-list" role="list">
				{#each mockEcgSessions as session}
					<button
						type="button"
						class:selected={session.id === selectedSessionId}
						class="session-item"
						onclick={() => selectSession(session.id)}
					>
						<div class="session-item-top">
							<div>
								<p class="session-title">{session.title}</p>
								<p class="session-subtitle">{session.subtitle}</p>
							</div>
							<span class={`dot dot-${session.intensity}`}></span>
						</div>

						<div class="session-chips">
							<span>{session.durationMinutes} min</span>
							<span>{averageHeartRate(session.samples)} bpm avg</span>
							<span>{averageRr(session.samples)} ms avg RR</span>
						</div>
					</button>
				{/each}
			</div>

			<div class="note-card">
				<p class="note-title">Implementation note</p>
				<p class="note-copy">
					The waveform is not clinical ECG data. It is a stylized beat template whose cadence and
					variability respond to HR and RR only.
				</p>
			</div>

			<div class="note-card">
				<p class="note-title">Next adapter</p>
				<p class="note-copy">
					Swap `mockEcgSessions` for a loader that groups `heart_rate_samples` into sessions, then
					feed those samples into this same playback view.
				</p>
			</div>

			{#if authStatus}
				<p class="inline-status">{authStatus}</p>
			{/if}

			{#if !hasSupabaseConfig}
				<p class="inline-hint">
					Running in local mock mode because Supabase public keys are not configured.
				</p>
			{/if}
		</aside>
	</section>
</main>

<style>
	:global(:root) {
		--background: #06141a;
		--surface: #0b1f27;
		--surface-alt: #102a34;
		--panel-bg: rgba(8, 22, 30, 0.86);
		--panel-border: rgba(89, 133, 149, 0.22);
		--text: #e8fcff;
		--muted: #95b8c4;
		--accent: #4cf2c8;
		--accent-strong: #1adfae;
		--accent-soft: rgba(76, 242, 200, 0.18);
		--warning: #ffb347;
		--danger: #ff7d7d;
		--shadow-soft: 0 24px 48px rgba(0, 0, 0, 0.28);
	}

	:global(body) {
		margin: 0;
		font-family: 'Plus Jakarta Sans', sans-serif;
		background:
			radial-gradient(circle at top left, rgba(26, 223, 174, 0.12), transparent 30%),
			radial-gradient(circle at top right, rgba(12, 98, 132, 0.28), transparent 28%),
			linear-gradient(180deg, #08151b 0%, #071018 38%, #050c12 100%);
		color: var(--text);
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

	.page-shell {
		max-width: 88rem;
		margin: 0 auto;
		padding: 1.25rem 1.5rem 3rem;
	}

	.hero {
		display: grid;
		grid-template-columns: minmax(0, 1.25fr) minmax(16rem, 0.75fr);
		gap: 1.25rem;
		align-items: end;
	}

	.eyebrow,
	.metric-label,
	.hero-card-label,
	.note-title,
	.progress-meta p {
		margin: 0;
		font-size: 0.78rem;
		font-weight: 800;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--muted);
	}

	h1,
	h2 {
		margin: 0;
	}

	h1 {
		font-size: clamp(2.6rem, 6vw, 4.7rem);
		line-height: 0.95;
		letter-spacing: -0.05em;
		color: #f3fffd;
	}

	h2 {
		font-size: clamp(1.6rem, 2.6vw, 2.3rem);
		line-height: 1.05;
	}

	.hero-copy,
	.section-copy,
	.note-copy,
	.inline-hint,
	.inline-status,
	.hero-card-copy,
	.session-subtitle,
	.progress-meta span {
		color: var(--muted);
	}

	.hero-copy {
		max-width: 45rem;
		margin-top: 0.95rem;
		font-size: 1.05rem;
		line-height: 1.7;
	}

	.hero-card,
	.viewer-card,
	.sidebar-card,
	.note-card,
	.metric-card,
	.session-item {
		background: var(--panel-bg);
		border: 1px solid var(--panel-border);
		box-shadow: var(--shadow-soft);
		backdrop-filter: blur(18px);
	}

	.hero-card {
		padding: 1.3rem;
		border-radius: 1.6rem;
	}

	.hero-card-value {
		margin: 0.35rem 0 0;
		font-size: clamp(2rem, 5vw, 3.5rem);
		font-weight: 800;
		letter-spacing: -0.05em;
		color: var(--accent);
	}

	.hero-card-copy {
		margin: 0.55rem 0 0;
		line-height: 1.6;
	}

	.grid {
		display: grid;
		grid-template-columns: minmax(0, 1.35fr) minmax(20rem, 0.9fr);
		gap: 1.25rem;
		margin-top: 1.3rem;
	}

	.viewer-card,
	.sidebar-card {
		padding: 1.4rem;
		border-radius: 1.8rem;
		min-width: 0;
	}

	.section-heading,
	.session-item-top,
	.progress-meta,
	.control-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.85rem;
		flex-wrap: wrap;
	}

	.session-badges,
	.session-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.55rem;
	}

	.badge,
	.session-chips span {
		display: inline-flex;
		align-items: center;
		padding: 0.45rem 0.75rem;
		border-radius: 999px;
		font-size: 0.8rem;
		font-weight: 700;
	}

	.badge-low {
		background: rgba(76, 242, 200, 0.14);
		color: var(--accent);
	}

	.badge-moderate {
		background: rgba(255, 179, 71, 0.16);
		color: var(--warning);
	}

	.badge-high {
		background: rgba(255, 125, 125, 0.16);
		color: var(--danger);
	}

	.badge-muted,
	.session-chips span {
		background: rgba(255, 255, 255, 0.05);
		color: var(--muted);
	}

	.monitor-shell {
		margin-top: 1.15rem;
	}

	.progress-block {
		margin-top: 1rem;
	}

	.progress-meta span {
		font-size: 0.9rem;
	}

	.progress-bar {
		height: 0.7rem;
		margin-top: 0.55rem;
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.06);
		overflow: hidden;
	}

	.progress-fill {
		height: 100%;
		border-radius: inherit;
		background: linear-gradient(90deg, var(--accent-soft), var(--accent));
	}

	.metric-grid {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 0.85rem;
		margin-top: 1rem;
	}

	.metric-card {
		padding: 1rem;
		border-radius: 1.25rem;
	}

	.metric-value {
		margin: 0.35rem 0 0;
		font-size: clamp(2rem, 5vw, 2.8rem);
		font-weight: 800;
		letter-spacing: -0.05em;
		color: #f4fffd;
	}

	.metric-value.secondary {
		color: #92ddff;
	}

	.metric-value.tertiary {
		color: #ffd48c;
	}

	.metric-value span {
		font-size: 0.9rem;
		color: var(--muted);
	}

	.control-row {
		margin-top: 1rem;
		align-items: end;
	}

	.button,
	.speed-select select {
		border: 0;
		font: inherit;
	}

	.button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.55rem;
		padding: 0.9rem 1.1rem;
		border-radius: 1rem;
		cursor: pointer;
		background: linear-gradient(135deg, #1adfae, #0cb4a5);
		color: #05221d;
		font-weight: 800;
	}

	.button-subtle {
		background: rgba(255, 255, 255, 0.08);
		color: var(--text);
	}

	.speed-select {
		display: grid;
		gap: 0.35rem;
		font-size: 0.88rem;
		color: var(--muted);
	}

	.speed-select select {
		padding: 0.85rem 1rem;
		border-radius: 0.95rem;
		background: rgba(255, 255, 255, 0.06);
		color: var(--text);
		border: 1px solid rgba(255, 255, 255, 0.1);
	}

	.sidebar-card {
		display: grid;
		gap: 1rem;
		align-content: start;
	}

	.sidebar-head {
		align-items: start;
	}

	.session-list {
		display: grid;
		gap: 0.8rem;
	}

	.session-item {
		display: grid;
		gap: 0.75rem;
		width: 100%;
		padding: 1rem;
		border-radius: 1.2rem;
		text-align: left;
		cursor: pointer;
		color: inherit;
	}

	.session-item.selected {
		border-color: rgba(76, 242, 200, 0.44);
		box-shadow:
			var(--shadow-soft),
			0 0 0 1px rgba(76, 242, 200, 0.12) inset;
	}

	.session-title,
	.note-title {
		margin: 0;
		font-weight: 800;
	}

	.session-title {
		font-size: 1rem;
		color: #f3fffd;
	}

	.session-subtitle {
		margin: 0.28rem 0 0;
		font-size: 0.9rem;
	}

	.dot {
		width: 0.8rem;
		height: 0.8rem;
		border-radius: 999px;
		flex-shrink: 0;
	}

	.dot-low {
		background: var(--accent);
	}

	.dot-moderate {
		background: var(--warning);
	}

	.dot-high {
		background: var(--danger);
	}

	.note-card {
		padding: 1rem;
		border-radius: 1.2rem;
	}

	.note-copy,
	.inline-hint,
	.inline-status {
		margin: 0.45rem 0 0;
		line-height: 1.6;
	}

	@media (max-width: 1100px) {
		.hero,
		.grid {
			grid-template-columns: 1fr;
		}
	}

	@media (max-width: 720px) {
		.page-shell {
			padding-inline: 1rem;
		}

		.metric-grid {
			grid-template-columns: 1fr;
		}

		.viewer-card,
		.sidebar-card {
			padding: 1.1rem;
			border-radius: 1.4rem;
		}
	}
</style>
