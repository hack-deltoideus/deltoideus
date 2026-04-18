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
	let helperQuestion = $state('I am overwhelmed with deadlines. What should I do in the next 10 minutes?');
	let helperReply = $state('');
	let helperStatus = $state('');
	let isAskingHelper = $state(false);

	let isConnecting = $state(false);
	let isSensorConnected = $state(false);
	let canUseBluetooth = $state(false);
	let sensorStatus = $state('Disconnected');

	let stopSensor = $state<(() => Promise<void>) | null>(null);

	const levelClass = $derived(`level-${stressLevel}`);

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

			geminiStatus = 'AI intervention generated.';
		} catch (error) {
			geminiStatus = error instanceof Error ? error.message : 'Failed to generate plan.';
		} finally {
			isGeneratingPlan = false;
		}
	}

	async function askGeminiHelper() {
		helperStatus = '';
		helperReply = '';

		const question = helperQuestion.trim();
		if (!question) {
			helperStatus = 'Add a question for Kelp first.';
			return;
		}

		isAskingHelper = true;

		try {
			const response = await fetch('/api/gemini-helper', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({
					question,
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

			helperStatus = 'Kelp replied.';
		} catch (error) {
			helperStatus = error instanceof Error ? error.message : 'Failed to ask helper.';
		} finally {
			isAskingHelper = false;
		}
	}
</script>

<main class="shell">
	<section class="hero">
		<p class="eyebrow">Stress Buddy MVP</p>
		<h1>Catch stress early. Trigger action now.</h1>
		<p>
			Live Polar H10 signal + 10-second student check-in + immediate intervention.
		</p>
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
			</div>

			<div class="actions">
				<button onclick={connectSensor} disabled={!canUseBluetooth || isConnecting || isSensorConnected}>
					{isConnecting ? 'Connecting...' : 'Connect Polar H10'}
				</button>
				<button class="ghost" onclick={disconnectSensor} disabled={!isSensorConnected}>
					Disconnect
				</button>
				<button class="ghost" onclick={simulateSpike}>Simulate Spike</button>
			</div>

			{#if !canUseBluetooth}
				<p class="hint">Use Chrome or Edge over HTTPS/localhost for Web Bluetooth.</p>
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

			<button onclick={submitCheckIn} disabled={isSubmitting || !hasSupabaseConfig}>
				{isSubmitting ? 'Saving...' : 'Save Check-in'}
			</button>

			{#if !hasSupabaseConfig}
				<p class="hint">Set PUBLIC_SUPABASE_URL and PUBLIC_SUPABASE_ANON_KEY in .env.</p>
			{/if}

			{#if submitStatus}
				<p class="status">{submitStatus}</p>
			{/if}
		</article>

		<article class="card score {levelClass}">
			<h2>Stress Detection</h2>
			<p class="score-value">{stressScore}</p>
			<p class="badge">{stressLevel.toUpperCase()}</p>
			<p class="intervention">{intervention}</p>
			<button class="ghost" onclick={generateGeminiPlan} disabled={isGeneratingPlan}>
				{isGeneratingPlan ? 'Generating AI Plan...' : 'Generate Gemini Plan'}
			</button>

			{#if geminiStatus}
				<p class="status">{geminiStatus}</p>
			{/if}

			{#if geminiPlan}
				<pre class="ai-plan">{geminiPlan}</pre>
			{/if}
		</article>

		<article class="card helper">
			<h2>Ask Kelp (Gemini Helper)</h2>
			<p class="muted">Personality: warm, direct, practical coach.</p>

			<label>
				Your question
				<textarea bind:value={helperQuestion} rows="4" maxlength="400"></textarea>
			</label>

			<button class="ghost" onclick={askGeminiHelper} disabled={isAskingHelper}>
				{isAskingHelper ? 'Kelp is thinking...' : 'Ask Kelp'}
			</button>

			{#if helperStatus}
				<p class="status">{helperStatus}</p>
			{/if}

			{#if helperReply}
				<pre class="ai-plan">{helperReply}</pre>
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

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
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

	button:disabled {
		cursor: not-allowed;
		opacity: 0.55;
	}

	.score {
		text-align: center;
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
		padding: 0.75rem;
		text-align: left;
		white-space: pre-wrap;
		border-radius: 0.7rem;
		border: 1px solid rgba(155, 214, 198, 0.3);
		background: rgba(10, 24, 35, 0.6);
		color: #d9f5ee;
		font-family: 'IBM Plex Mono', 'Menlo', monospace;
		font-size: 0.85rem;
	}

	@media (max-width: 640px) {
		.shell {
			padding-top: 1.2rem;
		}

		.metrics {
			grid-template-columns: 1fr;
		}
	}
</style>
