<script lang="ts">
	import { browser } from '$app/environment';
	import { onMount } from 'svelte';
	import RiveCharacter from '$lib/components/RiveCharacter.svelte';
	import SiteNav from '$lib/components/SiteNav.svelte';
	import { connectHeartRateMonitor } from '$lib/polar';
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
		stressor: string | null;
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
	let helperQuestion = $state('');
	let helperStatus = $state('');
	let isAskingHelper = $state(false);
	let helperSource = $state<'gemini' | 'fallback' | ''>('');
	let helperPersona = $state<'calm-coach' | 'tough-love' | 'study-planner'>('calm-coach');
	let helperHistory = $state<Array<{ role: 'user' | 'assistant'; text: string }>>([]);

	let isConnecting = $state(false);
	let isSensorConnected = $state(false);
	let canUseBluetooth = $state(false);
	let sensorStatus = $state('Disconnected');

	let stopSensor = $state<(() => Promise<void>) | null>(null);

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
	const avatarLetter = $derived(displayName.charAt(0).toUpperCase() || 'U');

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

	async function connectSensor() {
		if (!canUseBluetooth || isConnecting) {
			return;
		}

		isConnecting = true;
		sensorStatus = 'Connecting...';

		try {
			stopSensor = await connectHeartRateMonitor((reading) => {
				heartRate = reading.heartRate;
				rrMs = reading.rrMs;
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
		sensorStatus = 'Disconnected';
	}

	function simulateSpike() {
		const randomHr = 95 + Math.floor(Math.random() * 26);
		const randomRr = 520 + Math.floor(Math.random() * 120);

		heartRate = randomHr;
		rrMs = randomRr;
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
			const checkInPayload = {
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
					'id, created_at, mood, workload, sleep_quality, stress_score, stress_level, heart_rate, rr_ms, stressor'
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

			const reply = payload.reply ?? '';
			if (!reply) {
				throw new Error('Kelp returned an empty response.');
			}

			const updatedHistory: Array<{ role: 'user' | 'assistant'; text: string }> = [
				...nextHistory,
				{ role: 'assistant', text: reply }
			];
			helperHistory = updatedHistory.slice(-8);
			helperQuestion = '';

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

<svelte:head>
	<title>Sanctuary | Your Mental Space</title>
</svelte:head>

{#if !currentUser}
	<main class="auth-shell">
		<section class="auth-hero">
			<div class="auth-panel kit-panel">
				<p class="brand-kicker">Sanctuary</p>
				<h1>Sign in to enter your calm dashboard.</h1>
				<p class="auth-lead">
					Use the OAuth setup already connected to Supabase to open your personal space.
				</p>

				<div class="auth-actions">
					<button class="button" onclick={() => signInWithProvider('google')} disabled={isSigningIn !== null || !hasSupabaseConfig}>
						{isSigningIn === 'google' ? 'Connecting Google...' : 'Continue with Google'}
					</button>
					<button class="button button-subtle" onclick={() => signInWithProvider('github')} disabled={isSigningIn !== null || !hasSupabaseConfig}>
						{isSigningIn === 'github' ? 'Connecting GitHub...' : 'Continue with GitHub'}
					</button>
				</div>

				{#if !hasSupabaseConfig}
					<p class="inline-hint">Set `PUBLIC_SUPABASE_URL` and `PUBLIC_SUPABASE_ANON_KEY` in `.env` first.</p>
				{/if}

				{#if authStatus}
					<p class="inline-status">{authStatus}</p>
				{/if}
			</div>
		</section>
	</main>
{:else}
<SiteNav />

<main class="app-shell">

	<aside class="sidebar kit-panel">
		<div class="sidebar-block">
			<!-- <p class="brand-kicker">Sanctuary</p> -->
			<h2 class="sidebar-title">Command center</h2>

			<div class="profile-card">
				<div class="avatar">{avatarLetter}</div>
				<div>
					<p class="profile-title">Good Morning</p>
					<p class="profile-copy">{displayName} · {currentUser.email ?? 'Ready for your check-in?'}</p>
				</div>
			</div>
		</div>

		<nav class="nav-stack" aria-label="Primary">
			<a class="nav-item is-active" href="#dashboard">
				<span class="material-symbols-outlined">dashboard</span>
				<span>Dashboard</span>
			</a>
			<a class="nav-item" href="#kelp">
				<span class="material-symbols-outlined">psychology</span>
				<span>AI Coach</span>
			</a>
			<a class="nav-item" href="/app/sensor">
				<span class="material-symbols-outlined">monitor_heart</span>
				<span>Live Data</span>
			</a>
			<a class="nav-item" href="/app/history">
				<span class="material-symbols-outlined">history</span>
				<span>History</span>
			</a>
			<a class="nav-item" href="/app/calendar">
				<span class="material-symbols-outlined">calendar_month</span>
				<span>Calendar</span>
			</a>
		</nav>

	</aside>

	<div class="main-column">
		<section class="hero" id="dashboard">
			<div>
				<h1>Welcome back, {displayName}</h1>
				<!-- <p class="hero-copy">Today is a beautiful day to nurture your mind.</p> -->
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
			<article class="stress-card kit-panel {levelClass}">
				<div class="card-topline">
					<p class="meta-label">Stress Detection</p>
					<span class="material-symbols-outlined">waves</span>
				</div>

				<div class="score-row">
					<p class="score-number">{stressScore}</p>
					<p class="score-max">/100</p>
				</div>

				<div class="pill-row">
					<p class="pill pill-primary">Level: {levelLabel}</p>
				</div>

				<div class="coach-box">
					<p class="coach-title">Coach Suggestion</p>
					<p class="coach-copy">{intervention}</p>
					<p class="coach-caption">{levelDescriptor}</p>
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
						<h2>Daily Check-in</h2>
					</div>
					<div class="badge-icon accent-primary">
						<span class="material-symbols-outlined filled-icon">favorite</span>
					</div>
				</div>

				<div class="slider-grid">
					<label class="slider-card">
						<span class="slider-title">
							<span class="material-symbols-outlined accent-tertiary">sentiment_satisfied</span>
							<span>Mood</span>
						</span>
						<input type="range" min="1" max="10" bind:value={mood} />
						<span class="slider-scale">
							<span>Gloomy</span>
							<strong>{mood}</strong>
							<span>Radiant</span>
						</span>
					</label>

					<label class="slider-card">
						<span class="slider-title">
							<span class="material-symbols-outlined accent-secondary">work</span>
							<span>Workload</span>
						</span>
						<input type="range" min="1" max="10" bind:value={workload} />
						<span class="slider-scale">
							<span>Light</span>
							<strong>{workload}</strong>
							<span>Heavy</span>
						</span>
					</label>

					<label class="slider-card">
						<span class="slider-title">
							<span class="material-symbols-outlined accent-primary">bedtime</span>
							<span>Sleep</span>
						</span>
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
					<input
						bind:value={stressor}
						placeholder="Exams, deadlines, social, sleep..."
						maxlength="120"
					/>
				</label>

				<div class="action-row">
					<button class="button" onclick={submitCheckIn} disabled={isSubmitting || !hasSupabaseConfig}>
						{isSubmitting ? 'Saving...' : 'Save Check-in'}
					</button>
				</div>

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

			<article class="sensor-card kit-panel" id="sensor">
				<div class="section-heading">
					<div>
						<h3>Live Sensor</h3>
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
						<p class="metric-label">RR INTERVAL</p>
						<p class="metric-value secondary">{rrMs ?? '--'} <span>MS</span></p>
					</div>
				</div>

				<div class="stacked-actions">
					<button
						class="button button-outline"
						onclick={connectSensor}
						disabled={!canUseBluetooth || isConnecting || isSensorConnected}
					>
						<span class="material-symbols-outlined">bluetooth</span>
						<span>{isConnecting ? 'Connecting...' : 'Connect Device'}</span>
					</button>

					<div class="inline-buttons">
						<button class="button button-subtle" onclick={disconnectSensor} disabled={!isSensorConnected}>
							Disconnect
						</button>
						<button class="button button-subtle" onclick={simulateSpike}>Simulate Spike</button>
					</div>
				</div>

				<p class="section-copy">{sensorStatus}</p>

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

				<RiveCharacter />

				<div class="chat-shell">
					{#if helperHistory.length > 0}
						{#each helperHistory as msg}
							<div class:chat-user={msg.role === 'user'} class="chat-bubble">
								<p class="chat-author">{msg.role === 'user' ? 'You' : 'Kelp'}</p>
								<p>{msg.text}</p>
							</div>
						{/each}
					{:else}
						<div class="chat-empty-state">
							<p class="chat-empty-title">No messages yet.</p>
							<p class="chat-empty-copy">Send a question when you want a quick plan, perspective, or reset.</p>
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
		<a class="footer-item" href="#kelp">
			<span class="material-symbols-outlined">psychology</span>
			<span>Coach</span>
		</a>
		<a class="footer-item" href="/app/sensor">
			<span class="material-symbols-outlined">monitor_heart</span>
			<span>Live Data</span>
		</a>
		<a class="footer-item" href="/app/history">
			<span class="material-symbols-outlined">history</span>
			<span>History</span>
		</a>
		<a class="footer-item" href="/app/calendar">
			<span class="material-symbols-outlined">calendar_month</span>
			<span>Calendar</span>
		</a>
	</footer>
</main>
{/if}

<style>
	:global(:root) {
		--background: #f4f6ff;
		--body-overlay-a: rgba(91, 244, 222, 0.36);
		--body-overlay-b: rgba(183, 211, 255, 0.9);
		--body-top: #f8fbff;
		--body-bottom: #edf4ff;
		--primary-glow: #6ef0e2;
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
		--panel-bg: rgba(255, 255, 255, 0.76);
		--panel-border: rgba(160, 174, 197, 0.3);
		--hero-streak-bg: rgba(211, 228, 255, 0.72);
		--nav-hover-bg: rgba(201, 222, 255, 0.7);
		--checkin-bg: linear-gradient(180deg, rgba(255, 255, 255, 0.9), rgba(234, 241, 255, 0.95));
		--sensor-bg: rgba(255, 255, 255, 0.92);
		--helper-bg: linear-gradient(180deg, rgba(201, 222, 255, 0.78), rgba(234, 241, 255, 0.96));
		--card-surface: rgba(255, 255, 255, 0.8);
		--field-bg: rgba(255, 255, 255, 0.88);
		--saved-panel-bg: rgba(211, 228, 255, 0.58);
		--chat-shell-bg: rgba(255, 255, 255, 0.55);
		--chat-bubble-bg: #ffffff;
		--prompt-chip-bg: #ffffff;
		--icon-button-bg: #ffffff;
		--shadow-soft: 0 20px 45px rgba(31, 47, 82, 0.12);
	}

	:global(:root[data-theme='dark']) {
		--background: #091521;
		--body-overlay-a: rgba(74, 211, 188, 0.12);
		--body-overlay-b: rgba(74, 128, 120, 0.16);
		--body-top: #0d1a27;
		--body-bottom: #07111a;
		--primary-glow: #59d9c2;
		--surface-container-lowest: #0d1c2a;
		--secondary: #7ebdb2;
		--tertiary-container: #5e4600;
		--surface-container-high: #173244;
		--error: #ff8a95;
		--surface-container-highest: #1f3d52;
		--on-surface: #edf5ff;
		--on-tertiary-container: #fff0c4;
		--surface: #091521;
		--surface-container: #122636;
		--surface-container-low: #0f2231;
		--on-surface-variant: #bacbdd;
		--primary-dim: #34b7a5;
		--outline: #6f8396;
		--primary: #52d8c0;
		--on-primary: #073a35;
		--primary-container: #103f3a;
		--on-secondary-container: #d9ebff;
		--secondary-container: #1b455f;
		--outline-variant: #465a6c;
		--panel-bg: rgba(11, 24, 36, 0.82);
		--panel-border: rgba(92, 111, 127, 0.32);
		--hero-streak-bg: rgba(18, 38, 54, 0.9);
		--nav-hover-bg: rgba(27, 69, 95, 0.44);
		--checkin-bg: linear-gradient(180deg, rgba(12, 27, 40, 0.96), rgba(16, 34, 49, 0.98));
		--sensor-bg: rgba(12, 27, 40, 0.95);
		--helper-bg: linear-gradient(180deg, rgba(21, 42, 60, 0.96), rgba(14, 31, 45, 0.98));
		--card-surface: rgba(15, 34, 49, 0.92);
		--field-bg: rgba(16, 33, 46, 0.96);
		--saved-panel-bg: rgba(18, 38, 54, 0.92);
		--chat-shell-bg: rgba(10, 25, 37, 0.86);
		--chat-bubble-bg: rgba(15, 34, 49, 0.96);
		--prompt-chip-bg: rgba(15, 34, 49, 0.96);
		--icon-button-bg: rgba(15, 34, 49, 0.96);
		--shadow-soft: 0 22px 48px rgba(0, 0, 0, 0.42);
	}

	:global(html) {
		scroll-behavior: smooth;
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
		padding: 1.25rem 1.5rem 1.5rem;
	}

	.auth-shell {
		min-height: 100vh;
		display: grid;
		place-items: center;
		padding: 1.5rem;
	}

	.auth-hero {
		width: min(100%, 58rem);
	}

	.auth-panel {
		padding: 2rem;
	}

	.auth-panel h1 {
		margin: 0.35rem 0 0;
		font-size: clamp(2.2rem, 5vw, 4rem);
		line-height: 0.96;
		color: var(--primary);
	}

	.auth-lead {
		margin: 0.9rem 0 0;
		max-width: 36rem;
		font-size: 1.05rem;
		line-height: 1.6;
		color: var(--on-surface-variant);
	}

	.auth-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.85rem;
		margin-top: 1.5rem;
	}

	.kit-panel {
		background: var(--panel-bg);
		border: 1px solid var(--panel-border);
		border-radius: 2rem;
		box-shadow: var(--shadow-soft);
		backdrop-filter: blur(18px);
	}

	.mobile-footer {
		display: none;
	}

	.sidebar {
		position: sticky;
		top: 6.65rem;
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
		height: calc(100vh - 8rem);
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

	.stress-card .meta-label {
		color: rgba(232, 255, 250, 0.82);
	}

	:global(:root[data-theme='dark']) .stress-card .meta-label {
		color: rgba(236, 245, 255, 0.78);
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
		background: var(--nav-hover-bg);
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
		display: grid;
		gap: 0.75rem;
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
		background: var(--hero-streak-bg);
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
		background: var(--checkin-bg);
	}

	.sensor-card {
		grid-column: span 5;
		background: var(--sensor-bg);
	}

	.helper-card {
		grid-column: span 7;
		background: var(--helper-bg);
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

	.coach-box {
		padding: 1rem;
		border-radius: 1.5rem;
		background: rgba(0, 90, 80, 0.26);
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
		background: var(--card-surface);
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
		background: var(--field-bg);
	}

	input[type='range'] {
		width: 100%;
		accent-color: var(--primary);
	}

	.action-row {
		margin-top: 1.2rem;
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
		background: var(--nav-hover-bg);
		color: var(--on-surface);
		box-shadow: none;
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
		background: var(--saved-panel-bg);
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
		background: var(--card-surface);
		font-size: 0.8rem;
		font-weight: 800;
		color: var(--primary);
	}

	.metric-pair,
	.inline-buttons {
		gap: 0.9rem;
	}

	.metric-pair {
		margin-top: 1.2rem;
	}

	.metric-card {
		flex: 1;
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
		background: var(--chat-shell-bg);
		min-height: 14rem;
	}

	.chat-bubble {
		max-width: 85%;
		padding: 0.95rem 1rem;
		border-radius: 1.2rem 1.2rem 1.2rem 0.4rem;
		background: var(--chat-bubble-bg);
		box-shadow: 0 8px 18px rgba(31, 47, 82, 0.08);
	}

	.chat-empty-state {
		display: grid;
		place-items: center;
		align-content: center;
		min-height: 100%;
		padding: 1.1rem;
		border: 1px dashed rgba(180, 194, 216, 0.65);
		border-radius: 1.3rem;
		text-align: center;
		color: var(--on-surface-variant);
	}

	.chat-empty-title,
	.chat-empty-copy {
		margin: 0;
	}

	.chat-empty-title {
		font-weight: 700;
		color: var(--on-surface);
	}

	.chat-empty-copy {
		margin-top: 0.35rem;
		line-height: 1.55;
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
		background: var(--prompt-chip-bg);
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
		background: var(--icon-button-bg);
		color: var(--primary);
	}

	:global(:root[data-theme='dark']) .site-nav-shell {
		background: linear-gradient(180deg, rgba(7, 17, 26, 0.92), rgba(7, 17, 26, 0));
	}

	:global(:root[data-theme='dark']) .nav-item,
	:global(:root[data-theme='dark']) .footer-item {
		color: #d6e6f5;
	}

	:global(:root[data-theme='dark']) .nav-item.is-active,
	:global(:root[data-theme='dark']) .footer-item.is-active {
		box-shadow: 0 6px 0 rgba(11, 51, 46, 0.5);
	}

	:global(:root[data-theme='dark']) .stress-card {
		border-color: rgba(103, 239, 224, 0.28);
		box-shadow: 0 16px 34px rgba(2, 14, 20, 0.44);
	}

	:global(:root[data-theme='dark']) .slider-card,
	:global(:root[data-theme='dark']) .metric-card,
	:global(:root[data-theme='dark']) .saved-metrics span,
	:global(:root[data-theme='dark']) .prompt-chip,
	:global(:root[data-theme='dark']) .chat-bubble,
	:global(:root[data-theme='dark']) .icon-button {
		border-color: rgba(70, 90, 108, 0.38);
		box-shadow: none;
	}

	:global(:root[data-theme='dark']) .slider-scale,
	:global(:root[data-theme='dark']) .chat-author,
	:global(:root[data-theme='dark']) .profile-copy,
	:global(:root[data-theme='dark']) .hero-streak-label {
		color: #bacbdd;
	}

	:global(:root[data-theme='dark']) .button-ghost-on-dark {
		background: rgba(255, 255, 255, 0.08);
		color: #edf5ff;
	}

	:global(:root[data-theme='dark']) .chat-empty-state {
		border-color: rgba(70, 90, 108, 0.5);
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
		.auth-shell {
			padding-inline: 1rem;
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

		.metric-pair,
		.inline-buttons,
		.section-heading,
		.action-row {
			flex-direction: column;
			align-items: stretch;
		}

		.chat-bubble {
			max-width: 100%;
		}

		.persona-select {
			width: 100%;
		}
	}
</style>
