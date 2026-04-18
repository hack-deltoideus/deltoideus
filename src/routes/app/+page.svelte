<script lang="ts">
	import { browser } from '$app/environment';
	import { onMount } from 'svelte';
	import AppSectionNav from '$lib/components/AppSectionNav.svelte';
	import SiteNav from '$lib/components/SiteNav.svelte';
	import { calculateStress, interventionFor, type StressLevel } from '$lib/stress';
	import { hasSupabaseConfig, supabase } from '$lib/supabase';
	import type { Session, User } from '@supabase/supabase-js';

	type SavedCheckIn = {
		id: string;
		created_at: string;
		mood: number;
		workload: number;
		sleep_quality: number;
		stress_score: number;
		stress_level: StressLevel;
		heart_rate: number | null;
		rr_ms: number | null;
		hrv_ms: number | null;
		stressor: string | null;
	};

	type SupabaseLikeError = {
		message?: string;
		details?: string;
		hint?: string;
		code?: string;
	};

	type OAuthProvider = 'google';

	let mood = $state(5);
	let workload = $state(5);
	let sleepQuality = $state(5);
	let stressor = $state('');

	let heartRate = $state<number | undefined>(undefined);
	let rrMs = $state<number | undefined>(undefined);
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
	let isGeneratingPlan = $state(false);
	let geminiPlan = $state('');
	let geminiStatus = $state('');
	let geminiSource = $state<'gemini' | 'fallback' | ''>('');

	const levelClass = $derived(`level-${stressLevel}`);
	const levelLabel = $derived(
		stressLevel === 'low' ? 'Low' : stressLevel === 'rising' ? 'Rising' : 'High'
	);
	const levelDescriptor = $derived(
		stressLevel === 'low'
			? 'Steady state'
			: stressLevel === 'rising'
				? 'Pressure building'
				: 'Action recommended'
	);
	const streakDays = $derived(Math.max(1, Math.round((mood + sleepQuality) / 1.5)));
	const displayName = $derived(getDisplayName(currentUser));
	const profileCopy = $derived(currentUser?.email ?? 'Ready for your check-in?');

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
					redirectTo: `${window.location.origin}/app`
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

	async function persistCheckIn(options?: { silent?: boolean }): Promise<boolean> {
		const silent = options?.silent ?? false;

		if (!silent) {
			submitStatus = '';
			lastSavedCheckIn = null;
		}

		if (!supabase) {
			if (!silent) {
				submitStatus = 'Supabase is not configured yet. Add PUBLIC_SUPABASE_* values in .env.';
			}
			return false;
		}

		if (!currentUser) {
			if (!silent) {
				submitStatus = 'Sign in first to save a check-in.';
			}
			return false;
		}

		isSubmitting = true;

		try {
			const checkInPayload = {
				user_id: currentUser.id,
				mood,
				workload,
				sleep_quality: sleepQuality,
				stress_score: stressScore,
				stress_level: stressLevel,
				heart_rate: heartRate,
				rr_ms: rrMs,
				stressor: stressor.trim() || null
			};

			const { data: savedCheckIn, error: checkInError } = await supabase
				.from('check_ins')
				.insert(checkInPayload)
				.select(
					'id, created_at, mood, workload, sleep_quality, stress_score, stress_level, heart_rate, rr_ms, hrv_ms, stressor'
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
					intervention_type: stressLevel === 'high' ? 'breathing_reset' : 'micro_break',
					trigger_level: stressLevel,
					notes: intervention
				});

				if (interventionError) {
					throw interventionError;
				}
			}

			submitStatus = `Check-in saved and verified in Supabase (id: ${savedCheckIn.id.slice(0, 8)}...).`;
			return true;
		} catch (error) {
			if (!silent) {
				submitStatus = describeError(error, 'Failed to save check-in');
			}
			return false;
		} finally {
			isSubmitting = false;
		}
	}

	async function generateGeminiPlan() {
		isGeneratingPlan = true;
		geminiStatus = '';
		geminiSource = '';

		try {
			const didSaveCheckIn = await persistCheckIn({ silent: true });

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
			geminiStatus =
				payload?.warning ??
				(didSaveCheckIn
					? 'AI intervention generated and check-in saved.'
					: 'AI intervention generated.');
		} catch (error) {
			geminiStatus = describeError(error, 'Failed to generate plan.');
		} finally {
			isGeneratingPlan = false;
		}
	}
</script>

<svelte:head>
	<title>Sanctuary | Dashboard</title>
</svelte:head>

{#if !currentUser}
	<SiteNav />
	<main class="auth-shell">
		<section class="auth-panel">
			<p class="eyebrow">Sanctuary</p>
			<h1>Sign in to open your dashboard.</h1>
			<p class="hero-copy">
				Check in, read your stress score, and generate a grounded next-step plan without mixing it with the live sensor screen.
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
		<section class="hero">
			<div>
				<p class="eyebrow">Dashboard</p>
				<h1>Welcome back, {displayName}</h1>
				<p class="hero-copy">Your check-in and action plan live here. Sensor streaming and saved diagnostics now have their own page.</p>
			</div>

			<div class="hero-card">
				<p class="hero-card-label">Daily Streak</p>
				<p class="hero-card-value">{streakDays} DAYS</p>
				<p class="hero-card-copy">{profileCopy}</p>
			</div>
		</section>

		<AppSectionNav />

		<section class="grid">
			<article class="stress-card {levelClass}">
				<div class="card-topline">
					<p class="eyebrow">Stress Detection</p>
					<span class="material-symbols-outlined">waves</span>
				</div>

				<div class="score-row">
					<p class="score-number">{stressScore}</p>
					<p class="score-max">/100</p>
				</div>

				<div class="pill-row">
					<p class="pill">Level: {levelLabel}</p>
					<p class="pill pill-secondary">{levelDescriptor}</p>
				</div>

				<div class="coach-box">
					<p class="coach-title">Coach Suggestion</p>
					<p class="coach-copy">{intervention}</p>
				</div>

				<div class="action-row">
					<button class="button button-ghost" onclick={generateGeminiPlan} disabled={isGeneratingPlan}>
						{isGeneratingPlan ? 'Generating AI Plan...' : 'Generate Gemini Plan'}
					</button>
					<a class="button button-subtle" href="/app/sensor">Open Live Data</a>
				</div>

				{#if geminiSource}
					<p class="source-badge {geminiSource === 'fallback' ? 'fallback' : 'live'}">
						{geminiSource === 'fallback' ? 'Fallback Mode' : 'Live Gemini'}
					</p>
				{/if}

				{#if geminiStatus}
					<p class="inline-status on-dark">{geminiStatus}</p>
				{/if}

				{#if geminiPlan}
					<pre class="output-panel">{geminiPlan}</pre>
				{/if}
			</article>

			<article class="checkin-card">
				<div class="section-heading">
					<div>
						<p class="eyebrow">Daily Check-in</p>
						<h2>Capture how today feels</h2>
					</div>
					<div class="badge-icon">
						<span class="material-symbols-outlined">favorite</span>
					</div>
				</div>

				<div class="slider-grid">
					<label class="slider-card">
						<span class="slider-title">Mood</span>
						<input type="range" min="1" max="10" bind:value={mood} />
						<span class="slider-scale">
							<span>Gloomy</span>
							<strong>{mood}</strong>
							<span>Radiant</span>
						</span>
					</label>

					<label class="slider-card">
						<span class="slider-title">Workload</span>
						<input type="range" min="1" max="10" bind:value={workload} />
						<span class="slider-scale">
							<span>Light</span>
							<strong>{workload}</strong>
							<span>Heavy</span>
						</span>
					</label>

					<label class="slider-card">
						<span class="slider-title">Sleep</span>
						<input type="range" min="1" max="10" bind:value={sleepQuality} />
						<span class="slider-scale">
							<span>Restless</span>
							<strong>{sleepQuality}</strong>
							<span>Deep</span>
						</span>
					</label>
				</div>

				<label class="field">
					<span class="field-label">Main stressor</span>
					<input bind:value={stressor} placeholder="Exams, deadlines, social, sleep..." maxlength="120" />
				</label>

				<p class="inline-hint">
					Your stress score updates live here. Generating an AI plan also saves this check-in automatically.
				</p>

				{#if !hasSupabaseConfig}
					<p class="inline-hint">Set `PUBLIC_SUPABASE_URL` and `PUBLIC_SUPABASE_ANON_KEY` in `.env`.</p>
				{/if}

				{#if submitStatus}
					<p class="inline-status">{submitStatus}</p>
				{/if}

				{#if lastSavedCheckIn}
					<div class="saved-panel">
						<p class="saved-title">Last saved check-in</p>
						<div class="saved-metrics">
							<span>{lastSavedCheckIn.stress_level.toUpperCase()}</span>
							<span>Score {lastSavedCheckIn.stress_score}</span>
							<span>Mood {lastSavedCheckIn.mood}</span>
							<span>Workload {lastSavedCheckIn.workload}</span>
							<span>Sleep {lastSavedCheckIn.sleep_quality}</span>
						</div>
						<p class="saved-copy">
							Saved at {new Date(lastSavedCheckIn.created_at).toLocaleString()} with HR {lastSavedCheckIn.heart_rate ?? '--'} bpm and RR {lastSavedCheckIn.rr_ms ?? '--'} ms.
						</p>
						{#if lastSavedCheckIn.stressor}
							<p class="saved-copy">Stressor: {lastSavedCheckIn.stressor}</p>
						{/if}
					</div>
				{/if}
			</article>
		</section>
	</main>
{/if}

<style>
	:global(:root) {
		--background: #f7f8fc;
		--surface: #f7f8fc;
		--surface-container: #e4ebf8;
		--surface-container-low: #eef3fb;
		--on-surface: #20314b;
		--on-surface-variant: #5b6b84;
		--primary: #0a766a;
		--on-primary: #c1fff2;
		--secondary-container: #d7e4fb;
		--outline-variant: #bcc8dc;
		--panel-bg: rgba(255, 255, 255, 0.88);
		--panel-border: rgba(180, 194, 216, 0.45);
		--field-bg: rgba(255, 255, 255, 0.88);
		--field-border: rgba(180, 194, 216, 0.5);
		--body-overlay-a: rgba(64, 209, 182, 0.12);
		--body-overlay-b: rgba(137, 174, 235, 0.2);
		--body-top: #fbfcff;
		--body-bottom: #eef3fb;
		--shadow-soft: 0 16px 36px rgba(31, 47, 82, 0.08);
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
		max-width: 84rem;
		margin: 0 auto;
		padding: 1.25rem 1.5rem 3.5rem;
	}

	.auth-shell {
		min-height: 100vh;
		display: grid;
		place-items: center;
	}

	.auth-panel,
	.hero-card,
	.stress-card,
	.checkin-card {
		background: var(--panel-bg);
		border: 1px solid var(--panel-border);
		border-radius: 1.75rem;
		box-shadow: var(--shadow-soft);
		backdrop-filter: blur(18px);
	}

	.auth-panel {
		width: min(100%, 44rem);
		padding: 2rem;
	}

	.hero {
		display: grid;
		grid-template-columns: minmax(0, 1.4fr) minmax(18rem, 0.8fr);
		gap: 1.5rem;
		align-items: stretch;
		padding-top: 0.8rem;
	}

	.eyebrow {
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
		font-size: clamp(2.8rem, 5.8vw, 4.6rem);
		line-height: 0.98;
		letter-spacing: -0.05em;
		color: var(--primary);
		max-width: 11ch;
	}

	.hero-copy,
	.saved-copy,
	.inline-hint,
	.inline-status {
		color: var(--on-surface-variant);
	}

	.hero-copy {
		max-width: 38rem;
		margin-top: 1rem;
		font-size: 1.1rem;
		line-height: 1.7;
	}

	.hero-card {
		padding: 1.65rem 1.7rem;
		display: grid;
		align-content: center;
		gap: 0.65rem;
		min-height: 14rem;
	}

	.hero-card-label,
	.saved-title,
	.field-label,
	.slider-title,
	.coach-title {
		margin: 0;
		font-size: 0.8rem;
		font-weight: 800;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--on-surface-variant);
	}

	.hero-card-value,
	.score-number {
		margin: 0;
		font-size: clamp(2.3rem, 4.8vw, 3.8rem);
		font-weight: 800;
		letter-spacing: -0.05em;
	}

	.hero-card-copy {
		margin: 0;
		line-height: 1.6;
	}

	.grid {
		display: grid;
		grid-template-columns: minmax(0, 0.96fr) minmax(0, 1.04fr);
		gap: 1.5rem;
		margin-top: 1.5rem;
	}

	.grid > * {
		min-width: 0;
	}

	.stress-card,
	.checkin-card {
		padding: 1.6rem;
	}

	.stress-card {
		background:
			linear-gradient(180deg, rgba(13, 124, 111, 0.96), rgba(10, 98, 91, 1)),
			var(--panel-bg);
		color: #fff;
	}

	:global(:root[data-theme='dark']) .stress-card {
		background:
			linear-gradient(180deg, rgba(18, 98, 89, 0.96), rgba(7, 58, 53, 0.98)),
			var(--panel-bg);
	}

	.card-topline,
	.section-heading,
	.saved-metrics,
	.action-row,
	.auth-actions,
	.slider-scale,
	.pill-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		flex-wrap: wrap;
	}

	.score-row {
		display: flex;
		align-items: flex-end;
		gap: 0.5rem;
		margin-top: 1.35rem;
	}

	.score-max {
		margin: 0 0 0.45rem;
		font-size: 1rem;
		opacity: 0.78;
	}

	.pill {
		margin: 0;
		padding: 0.6rem 0.88rem;
		border-radius: 999px;
		font-weight: 700;
		background: rgba(255, 255, 255, 0.18);
	}

	.pill-secondary {
		background: rgba(255, 255, 255, 0.12);
	}

	.coach-box,
	.saved-panel {
		margin-top: 1.2rem;
		padding: 1.15rem 1.2rem;
		border-radius: 1.4rem;
		background: rgba(255, 255, 255, 0.14);
	}

	.saved-panel {
		background: color-mix(in srgb, var(--surface-container, #dce9ff) 58%, white);
	}

	.coach-copy {
		margin: 0.55rem 0 0;
		line-height: 1.75;
		font-size: 1.02rem;
	}

	.button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.55rem;
		padding: 0.92rem 1.2rem;
		border-radius: 1rem;
		border: 0;
		text-decoration: none;
		cursor: pointer;
		font: inherit;
		font-weight: 800;
		background: var(--primary);
		color: var(--on-primary);
	}

	.button-subtle {
		background: var(--secondary-container);
		color: var(--on-surface);
	}

	.button-ghost {
		background: rgba(255, 255, 255, 0.18);
		color: #fff;
		border: 1px solid rgba(255, 255, 255, 0.22);
	}

	.slider-grid {
		display: grid;
		gap: 1rem;
		margin-top: 1.1rem;
	}

	.slider-card,
	.field {
		display: grid;
		gap: 0.65rem;
	}

	.slider-card {
		padding: 1.05rem 1.1rem;
		border-radius: 1.35rem;
		background: color-mix(in srgb, var(--surface-container-low, #eaf1ff) 58%, white);
	}

	.field {
		margin-top: 1.15rem;
	}

	.field input {
		width: 100%;
		border: 1px solid var(--field-border);
		background: var(--field-bg);
		color: var(--on-surface);
		border-radius: 1rem;
		padding: 0.95rem 1rem;
		font: inherit;
	}

	input[type='range'] {
		width: 100%;
		accent-color: var(--primary);
	}

	.saved-metrics {
		justify-content: flex-start;
	}

	.saved-metrics span {
		padding: 0.5rem 0.75rem;
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.68);
		font-size: 0.92rem;
	}

	.saved-copy,
	.inline-status,
	.inline-hint {
		margin: 0.8rem 0 0;
		line-height: 1.6;
	}

	.source-badge {
		width: fit-content;
		margin-top: 1rem;
		padding: 0.4rem 0.75rem;
		border-radius: 999px;
		font-size: 0.78rem;
		font-weight: 800;
		background: rgba(255, 255, 255, 0.14);
	}

	.source-badge.fallback {
		background: rgba(255, 209, 102, 0.22);
	}

	.output-panel {
		margin: 1.15rem 0 0;
		padding: 1.05rem 1.1rem;
		white-space: pre-wrap;
		line-height: 1.6;
		border-radius: 1.2rem;
		background: rgba(6, 28, 26, 0.24);
		border: 1px solid rgba(255, 255, 255, 0.16);
		color: inherit;
	}

	.on-dark {
		color: rgba(255, 255, 255, 0.88);
	}

	.badge-icon {
		display: grid;
		place-items: center;
		width: 3rem;
		height: 3rem;
		border-radius: 1rem;
		background: color-mix(in srgb, var(--surface-container, #dce9ff) 42%, white);
	}

	.checkin-card .section-heading {
		margin-bottom: 0.35rem;
	}

	.checkin-card h2 {
		font-size: clamp(1.9rem, 3vw, 2.4rem);
		line-height: 1.06;
		letter-spacing: -0.04em;
	}

	.action-row {
		margin-top: 1.2rem;
	}

	.section-nav {
		margin-top: 1.4rem;
	}

	@media (max-width: 900px) {
		.hero,
		.grid {
			grid-template-columns: 1fr;
		}
	}

	@media (max-width: 640px) {
		.page-shell,
		.auth-shell {
			padding-inline: 1rem;
		}

		h1 {
			font-size: clamp(2.5rem, 14vw, 3.5rem);
			max-width: none;
		}

		.stress-card,
		.checkin-card,
		.auth-panel {
			padding: 1.2rem;
			border-radius: 1.5rem;
		}
	}
</style>
