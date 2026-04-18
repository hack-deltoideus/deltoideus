<script lang="ts">
	import { browser } from '$app/environment';
	import { connectHeartRateMonitor } from '$lib/polar';
	import { calculateStress, interventionFor, type StressLevel } from '$lib/stress';
	import { hasSupabaseConfig, supabase } from '$lib/supabase';

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

	if (browser) {
		canUseBluetooth = typeof navigator !== 'undefined' && 'bluetooth' in navigator;
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

		heartRate = randomHr;
		rrMs = randomRr;
		sensorStatus = 'Simulated stress signal loaded';
	}

	async function submitCheckIn() {
		submitStatus = '';

		if (!supabase) {
			submitStatus = 'Supabase is not configured yet. Add PUBLIC_SUPABASE_* values in .env.';
			return;
		}

		isSubmitting = true;

		try {
			const { error: checkInError } = await supabase.from('check_ins').insert({
				mood,
				workload,
				sleep_quality: sleepQuality,
				stress_score: stressScore,
				stress_level: stressLevel,
				heart_rate: heartRate,
				rr_ms: rrMs,
				stressor: stressor.trim() || null
			});

			if (checkInError) {
				throw checkInError;
			}

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

			submitStatus = 'Check-in saved. You are demo-ready.';
		} catch (error) {
			submitStatus = error instanceof Error ? error.message : 'Failed to save check-in';
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
				<span class="material-symbols-outlined">smart_toy</span>
				<span>AI Coach</span>
			</a>
			<a class="nav-item" href="#sensor">
				<span class="material-symbols-outlined">sensors</span>
				<span>Sensor</span>
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
				<p class="eyebrow">Stress Buddy MVP</p>
				<h1>Catch stress early. Trigger action now.</h1>
				<p class="hero-copy">
					A Sanctuary-flavored UI kit for live sensor intake, check-ins, and fast intervention
					flows.
				</p>
			</div>

			<div class="hero-streak kit-panel">
				<div class="hero-streak-icon">
					<span class="material-symbols-outlined">celebration</span>
				</div>
				<div>
					<p class="meta-label">Daily streak</p>
					<p class="hero-streak-value">{streakDays} days</p>
				</div>
			</div>
		</section>

		<section class="kit-grid">
			<article class="stress-card kit-panel {levelClass}">
				<div class="card-topline">
					<p class="meta-label">Stress detection</p>
					<span class="material-symbols-outlined">waves</span>
				</div>

				<div class="score-row">
					<p class="score-number">{stressScore}</p>
					<p class="score-max">/100</p>
				</div>

				<div class="pill-row">
					<p class="pill pill-primary">Level: {levelLabel}</p>
					<p class="pill">{levelDescriptor}</p>
				</div>

				<p class="stress-copy">{intervention}</p>

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
					<p class="inline-status">{geminiStatus}</p>
				{/if}

				{#if geminiPlan}
					<pre class="output-panel">{geminiPlan}</pre>
				{/if}
			</article>

			<article class="checkin-card kit-panel" id="checkin">
				<div class="section-heading">
					<div>
						<p class="meta-label">Daily ritual</p>
						<h2>10-second check-in</h2>
					</div>
					<div class="badge-icon accent-primary">
						<span class="material-symbols-outlined">favorite</span>
					</div>
				</div>

				<div class="slider-grid">
					<label class="slider-card">
						<span class="slider-title">
							<span class="material-symbols-outlined accent-tertiary">sentiment_satisfied</span>
							<span>Mood</span>
						</span>
						<strong>{mood}</strong>
						<input type="range" min="1" max="10" bind:value={mood} />
						<span class="slider-scale">
							<span>Gloomy</span>
							<span>Radiant</span>
						</span>
					</label>

					<label class="slider-card">
						<span class="slider-title">
							<span class="material-symbols-outlined accent-secondary">work</span>
							<span>Workload</span>
						</span>
						<strong>{workload}</strong>
						<input type="range" min="1" max="10" bind:value={workload} />
						<span class="slider-scale">
							<span>Light</span>
							<span>Heavy</span>
						</span>
					</label>

					<label class="slider-card">
						<span class="slider-title">
							<span class="material-symbols-outlined accent-primary">bedtime</span>
							<span>Sleep</span>
						</span>
						<strong>{sleepQuality}</strong>
						<input type="range" min="1" max="10" bind:value={sleepQuality} />
						<span class="slider-scale">
							<span>Restless</span>
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

					{#if !hasSupabaseConfig}
						<p class="inline-hint">Set `PUBLIC_SUPABASE_URL` and `PUBLIC_SUPABASE_ANON_KEY` in `.env`.</p>
					{/if}
				</div>

				{#if submitStatus}
					<p class="inline-status">{submitStatus}</p>
				{/if}
			</article>

			<article class="sensor-card kit-panel" id="sensor">
				<div class="section-heading">
					<div>
						<p class="meta-label">Live feed</p>
						<h2>Sensor bridge</h2>
					</div>
					<div class="live-indicator">
						<span class:dot-live={isSensorConnected} class="live-dot"></span>
						<span>{isSensorConnected ? 'Live' : 'Standby'}</span>
					</div>
				</div>

				<p class="section-copy">{sensorStatus}</p>

				<div class="metric-pair">
					<div class="metric-card">
						<p class="meta-label">Heart rate</p>
						<p class="metric-value">{heartRate ?? '--'} <span>BPM</span></p>
					</div>
					<div class="metric-card">
						<p class="meta-label">RR interval</p>
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
						<span>{isConnecting ? 'Connecting...' : 'Connect Polar H10'}</span>
					</button>

					<div class="inline-buttons">
						<button class="button button-subtle" onclick={disconnectSensor} disabled={!isSensorConnected}>
							Disconnect
						</button>
						<button class="button button-subtle" onclick={simulateSpike}>Simulate Spike</button>
					</div>
				</div>

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
							<p class="meta-label">Ask Kelp</p>
							<h2>AI resilience coach</h2>
						</div>
					</div>

					<label class="persona-select">
						<span class="sr-only">Personality</span>
						<select bind:value={helperPersona}>
							<option value="calm-coach">Calm Coach</option>
							<option value="tough-love">Tough Love</option>
							<option value="study-planner">Study Planner</option>
						</select>
					</label>
				</div>

				<p class="section-copy">
					Powered by Gemini through your server routes, with graceful fallback when the live model is unavailable.
				</p>

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
							<p class="chat-author">Latest reply</p>
							<p>{helperReply}</p>
						</div>
					{/if}
				</div>

				<div class="prompt-row">
					<button
						class="prompt-chip"
						type="button"
						onclick={() => applyQuickPrompt('Build me a 15-minute plan to reduce stress before studying.')}
					>
						15-minute reset
					</button>
					<button
						class="prompt-chip"
						type="button"
						onclick={() => applyQuickPrompt('I keep procrastinating. Give me one concrete start routine.')}
					>
						Beat procrastination
					</button>
					<button
						class="prompt-chip"
						type="button"
						onclick={() => applyQuickPrompt('I am anxious before an exam. Give me a 3-step focus sequence.')}
					>
						Pre-exam focus
					</button>
				</div>

				<label class="field">
					<span class="field-label">Your question</span>
					<textarea bind:value={helperQuestion} rows="4" maxlength="400"></textarea>
				</label>

				<div class="action-row">
					<button class="button" onclick={askGeminiHelper} disabled={isAskingHelper}>
						{isAskingHelper ? 'Kelp is thinking...' : 'Ask Kelp'}
					</button>

					{#if helperSource}
						<p class="source-badge {helperSource === 'fallback' ? 'fallback' : 'live'}">
							{helperSource === 'fallback' ? 'Fallback Mode' : 'Live Gemini'}
						</p>
					{/if}
				</div>

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
			<span>Sensor</span>
		</a>
	</footer>
</main>

<style>
	:global(:root) {
		--background: #f4f6ff;
		--surface: #ffffff;
		--surface-low: #eaf1ff;
		--surface-high: #dce9ff;
		--surface-highest: #c9deff;
		--surface-deep: #212f42;
		--primary: #00675c;
		--primary-strong: #00594f;
		--primary-soft: #5bf4de;
		--secondary: #005da7;
		--tertiary: #fcc025;
		--tertiary-ink: #563e00;
		--error: #b31b25;
		--text: #212f42;
		--text-muted: #4e5c71;
		--outline: #a0aec5;
		--shadow-soft: 0 20px 45px rgba(31, 47, 82, 0.12);
		--shadow-press: 0 6px 0 rgba(0, 103, 92, 0.24);
	}

	:global(html) {
		scroll-behavior: smooth;
	}

	:global(body) {
		margin: 0;
		font-family: 'Plus Jakarta Sans', sans-serif;
		background:
			radial-gradient(circle at top left, rgba(91, 244, 222, 0.4), transparent 32%),
			radial-gradient(circle at 100% 0%, rgba(183, 211, 255, 0.85), transparent 28%),
			linear-gradient(180deg, #f8fbff 0%, var(--background) 38%, #edf4ff 100%);
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
		font-size: 1.2rem;
	}

	.app-shell {
		display: grid;
		grid-template-columns: 18rem minmax(0, 1fr);
		gap: 1.5rem;
		min-height: 100vh;
		padding: 1.5rem;
	}

	.kit-panel {
		background: rgba(255, 255, 255, 0.72);
		border: 1px solid rgba(160, 174, 197, 0.34);
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
		padding: 1.5rem;
		height: calc(100vh - 3rem);
	}

	.sidebar-block {
		display: grid;
		gap: 1rem;
	}

	.brand-kicker,
	.eyebrow,
	.meta-label {
		margin: 0;
		font-size: 0.78rem;
		font-weight: 800;
		letter-spacing: 0.16em;
		text-transform: uppercase;
	}

	.brand-kicker,
	.eyebrow {
		color: var(--primary);
	}

	.brand-subtitle,
	.meta-label {
		color: var(--text-muted);
	}

	.sidebar-title {
		margin: 0;
		font-size: 1.7rem;
		line-height: 1.05;
	}

	.profile-card {
		display: flex;
		align-items: center;
		gap: 0.9rem;
		padding: 1rem;
		background: var(--surface-low);
		border-radius: 1.5rem;
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
		background: linear-gradient(135deg, var(--primary), var(--primary-soft));
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
		color: var(--text-muted);
		font-size: 0.92rem;
	}

	.nav-stack {
		display: grid;
		gap: 0.6rem;
	}

	.nav-item,
	.footer-item {
		display: flex;
		align-items: center;
		gap: 0.8rem;
		padding: 0.9rem 1rem;
		border-radius: 1.35rem;
		color: var(--text-muted);
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
		color: var(--text);
	}

	.nav-item.is-active,
	.footer-item.is-active {
		background: linear-gradient(135deg, var(--primary), #128e80);
		color: #eefef9;
		box-shadow: 0 6px 0 rgba(0, 89, 79, 0.34);
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
		padding: 1rem 0.25rem 0;
	}

	.hero h1 {
		margin: 0.35rem 0 0.6rem;
		font-size: clamp(2.7rem, 6vw, 4.8rem);
		line-height: 0.95;
		letter-spacing: -0.05em;
		max-width: 11ch;
		color: var(--primary);
	}

	.hero-copy,
	.section-copy,
	.stress-copy,
	.inline-hint,
	.inline-status {
		margin: 0;
		color: var(--text-muted);
		line-height: 1.6;
	}

	.hero-streak {
		display: flex;
		align-items: center;
		gap: 1rem;
		padding: 1rem 1.2rem;
		min-width: 14rem;
	}

	.hero-streak-icon,
	.badge-icon {
		width: 3.5rem;
		height: 3.5rem;
		border-radius: 1.2rem;
	}

	.hero-streak-icon {
		background: linear-gradient(135deg, var(--primary), #33bba8);
		color: white;
	}

	.hero-streak-value {
		margin: 0.2rem 0 0;
		font-size: 1.4rem;
		font-weight: 800;
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
		padding: 1.7rem;
	}

	.stress-card {
		grid-column: span 4;
		background: linear-gradient(180deg, #00756a 0%, #005b52 100%);
		color: #effffb;
		border-color: rgba(91, 244, 222, 0.24);
		box-shadow: 0 16px 34px rgba(0, 90, 80, 0.26);
	}

	.checkin-card {
		grid-column: span 8;
		background: linear-gradient(180deg, rgba(255, 255, 255, 0.88), rgba(234, 241, 255, 0.92));
	}

	.sensor-card {
		grid-column: span 5;
	}

	.helper-card {
		grid-column: span 7;
		background: linear-gradient(180deg, rgba(201, 222, 255, 0.75), rgba(234, 241, 255, 0.95));
	}

	.card-topline,
	.section-heading,
	.helper-heading,
	.score-row,
	.action-row,
	.pill-row,
	.metric-pair,
	.inline-buttons {
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

	.section-heading h2 {
		margin: 0.2rem 0 0;
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
		opacity: 0.72;
	}

	.pill-row {
		flex-wrap: wrap;
		gap: 0.6rem;
		margin: 1.2rem 0 1rem;
	}

	.pill,
	.source-badge {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.45rem 0.8rem;
		border-radius: 999px;
		font-size: 0.78rem;
		font-weight: 800;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	.pill {
		background: rgba(255, 255, 255, 0.1);
		color: rgba(239, 255, 251, 0.9);
		border: 1px solid rgba(255, 255, 255, 0.16);
	}

	.pill-primary {
		background: rgba(91, 244, 222, 0.2);
		color: #dffff8;
	}

	.status-group,
	.stacked-actions {
		display: grid;
		gap: 0.8rem;
		margin-top: 1.25rem;
	}

	.output-panel {
		margin: 1rem 0 0;
		padding: 1rem;
		white-space: pre-wrap;
		background: rgba(0, 0, 0, 0.18);
		border-radius: 1.3rem;
		border: 1px solid rgba(255, 255, 255, 0.14);
		font: 500 0.95rem/1.55 'Plus Jakarta Sans', sans-serif;
		color: #effffb;
	}

	.slider-grid {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 1rem;
		margin-top: 1.25rem;
	}

	.slider-card,
	.metric-card,
	.chat-shell,
	.field input,
	.field textarea,
	.persona-select select {
		background: rgba(255, 255, 255, 0.8);
	}

	.slider-card,
	.metric-card {
		display: grid;
		gap: 0.8rem;
		padding: 1.1rem;
		border-radius: 1.5rem;
		border: 1px solid rgba(160, 174, 197, 0.3);
	}

	.slider-title {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-weight: 700;
	}

	.slider-card strong {
		font-size: 2rem;
		color: var(--primary);
	}

	.slider-scale {
		display: flex;
		justify-content: space-between;
		font-size: 0.78rem;
		font-weight: 700;
		color: var(--text-muted);
	}

	.field {
		display: grid;
		gap: 0.55rem;
		margin-top: 1.15rem;
	}

	.field-label {
		font-size: 0.9rem;
		font-weight: 700;
		color: var(--text);
	}

	.field input,
	.field textarea,
	.persona-select select {
		width: 100%;
		border: 1px solid rgba(160, 174, 197, 0.42);
		border-radius: 1.1rem;
		padding: 0.95rem 1rem;
		font: inherit;
		color: var(--text);
		box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.56);
	}

	.field textarea {
		resize: vertical;
		min-height: 7rem;
	}

	input[type='range'] {
		width: 100%;
		accent-color: var(--primary);
	}

	.action-row {
		margin-top: 1.25rem;
		flex-wrap: wrap;
	}

	.button,
	.prompt-chip,
	.icon-button {
		border: none;
		font: inherit;
		cursor: pointer;
		transition:
			transform 160ms ease,
			box-shadow 160ms ease,
			background 160ms ease,
			color 160ms ease,
			border-color 160ms ease;
	}

	.button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.55rem;
		padding: 0.95rem 1.35rem;
		border-radius: 999px;
		background: linear-gradient(135deg, var(--primary), #128e80);
		color: #effffb;
		font-weight: 800;
		box-shadow: var(--shadow-press);
	}

	.button:hover,
	.prompt-chip:hover,
	.icon-button:hover {
		transform: translateY(-1px);
	}

	.button:active,
	.prompt-chip:active,
	.icon-button:active {
		transform: translateY(2px);
		box-shadow: none;
	}

	.button:disabled {
		opacity: 0.55;
		cursor: not-allowed;
		transform: none;
		box-shadow: none;
	}

	.button-tertiary {
		width: 100%;
		background: linear-gradient(135deg, var(--tertiary), #ffcf52);
		color: var(--tertiary-ink);
		box-shadow: 0 6px 0 rgba(117, 86, 0, 0.22);
	}

	.button-outline {
		background: rgba(0, 103, 92, 0.08);
		color: var(--primary);
		border: 2px solid rgba(0, 103, 92, 0.18);
		box-shadow: none;
	}

	.button-subtle {
		background: rgba(201, 222, 255, 0.7);
		color: var(--text);
		box-shadow: none;
	}

	.button-ghost-on-dark {
		background: rgba(255, 255, 255, 0.1);
		color: #f3fffc;
		border: 1px solid rgba(255, 255, 255, 0.18);
		box-shadow: none;
	}

	.metric-pair,
	.inline-buttons {
		gap: 0.9rem;
	}

	.metric-pair {
		margin-top: 1.25rem;
	}

	.metric-card {
		flex: 1;
	}

	.metric-value {
		margin: 0;
		font-size: 2.2rem;
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

	.live-indicator {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.45rem 0.75rem;
		border-radius: 999px;
		background: rgba(179, 27, 37, 0.08);
		color: var(--error);
		font-size: 0.82rem;
		font-weight: 800;
		text-transform: uppercase;
		letter-spacing: 0.08em;
	}

	.live-dot {
		width: 0.55rem;
		height: 0.55rem;
		border-radius: 999px;
		background: rgba(179, 27, 37, 0.32);
	}

	.dot-live {
		background: var(--error);
		box-shadow: 0 0 0 0 rgba(179, 27, 37, 0.4);
		animation: pulse 1.4s infinite;
	}

	.chat-shell {
		display: grid;
		gap: 0.8rem;
		padding: 1rem;
		margin-top: 1.3rem;
		border-radius: 1.6rem;
		border: 1px solid rgba(160, 174, 197, 0.3);
		min-height: 15rem;
	}

	.chat-bubble {
		max-width: 85%;
		padding: 0.9rem 1rem;
		border-radius: 1.2rem 1.2rem 1.2rem 0.35rem;
		background: white;
		box-shadow: 0 8px 20px rgba(31, 47, 82, 0.08);
	}

	.chat-user {
		margin-left: auto;
		border-radius: 1.2rem 1.2rem 0.35rem 1.2rem;
		background: linear-gradient(135deg, rgba(0, 103, 92, 0.12), rgba(91, 244, 222, 0.25));
	}

	.chat-author {
		margin: 0 0 0.25rem;
		font-size: 0.78rem;
		font-weight: 800;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--text-muted);
	}

	.chat-bubble p:last-child {
		margin: 0;
		line-height: 1.55;
	}

	.prompt-row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.65rem;
		margin-top: 1.1rem;
	}

	.prompt-chip {
		padding: 0.7rem 0.95rem;
		border-radius: 999px;
		background: white;
		color: var(--primary);
		font-weight: 800;
		border: 1px solid rgba(0, 103, 92, 0.1);
		box-shadow: 0 6px 16px rgba(31, 47, 82, 0.07);
	}

	.source-badge {
		border: 1px solid rgba(160, 174, 197, 0.38);
	}

	.source-badge.live {
		background: rgba(91, 244, 222, 0.18);
		color: var(--primary-strong);
	}

	.source-badge.fallback {
		background: rgba(252, 192, 37, 0.2);
		color: var(--tertiary-ink);
	}

	.level-low {
		border-color: rgba(91, 244, 222, 0.24);
	}

	.level-rising {
		border-color: rgba(252, 192, 37, 0.4);
	}

	.level-high {
		border-color: rgba(251, 81, 81, 0.46);
	}

	.accent-primary {
		color: var(--primary);
	}

	.accent-secondary {
		color: var(--secondary);
	}

	.accent-tertiary {
		color: #9d7400;
	}

	.badge-icon.accent-primary {
		background: rgba(91, 244, 222, 0.2);
	}

	.badge-icon.accent-tertiary {
		background: rgba(252, 192, 37, 0.28);
		color: var(--tertiary-ink);
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
		box-shadow: 0 10px 20px rgba(31, 47, 82, 0.08);
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

		.hero {
			padding-top: 0.4rem;
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
		.hero {
			flex-direction: column;
			align-items: stretch;
		}

		.hero h1 {
			max-width: 100%;
			font-size: clamp(2.3rem, 12vw, 3.5rem);
		}

		.slider-grid,
		.metric-pair {
			grid-template-columns: 1fr;
			flex-direction: column;
		}

		.section-heading,
		.action-row {
			align-items: stretch;
			flex-direction: column;
		}

		.persona-select {
			width: 100%;
		}

		.chat-bubble {
			max-width: 100%;
		}
	}
</style>
