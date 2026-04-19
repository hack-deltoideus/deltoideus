<script lang="ts">
	import { onDestroy } from 'svelte';
	import AppSectionNav from '$lib/components/AppSectionNav.svelte';
	import SiteNav from '$lib/components/SiteNav.svelte';

	let secondsRemaining = $state(60);
	let isRunning = $state(false);
	let timerId: ReturnType<typeof setInterval> | null = null;

	const breathPhase = $derived.by(() => {
		if (!isRunning) {
			return 'Press start to begin a 60-second reset.';
		}

		const cyclePosition = (60 - secondsRemaining) % 10;
		if (cyclePosition < 4) {
			return 'Breathe in slowly through your nose.';
		}

		if (cyclePosition < 6) {
			return 'Hold gently.';
		}

		return 'Exhale slowly and drop your shoulders.';
	});

	function clearTimer() {
		if (timerId) {
			clearInterval(timerId);
			timerId = null;
		}
	}

	function startReset() {
		clearTimer();
		secondsRemaining = 60;
		isRunning = true;
		timerId = setInterval(() => {
			if (secondsRemaining <= 1) {
				clearTimer();
				secondsRemaining = 0;
				isRunning = false;
				return;
			}

			secondsRemaining -= 1;
		}, 1000);
	}

	function resetTimer() {
		clearTimer();
		secondsRemaining = 60;
		isRunning = false;
	}

	onDestroy(() => {
		clearTimer();
	});
</script>

<svelte:head>
	<title>Sanctuary | Recovery</title>
</svelte:head>

<SiteNav />

<main class="page-shell">
	<AppSectionNav />

	<section class="recovery-shell">
		<article class="hero-card">
			<p class="eyebrow">Recovery</p>
			<h1>Take one minute to reset.</h1>
			<p class="hero-copy">
				Your live session flagged a stress response. Use this minute to bring your breathing and focus back down before returning to work.
			</p>

			<div class="timer-card">
				<p class="timer-label">Reset timer</p>
				<p class="timer-value">{secondsRemaining}s</p>
				<p class="timer-phase">{breathPhase}</p>
			</div>

			<div class="action-row">
				<button class="button" onclick={startReset}>
					<span class="material-symbols-outlined">play_circle</span>
					<span>{isRunning ? 'Restart 60-second reset' : 'Start 60-second reset'}</span>
				</button>
				<button class="button button-subtle" onclick={resetTimer}>Reset timer</button>
				<a class="button button-outline" href="/app/sensor">Back to live data</a>
			</div>
		</article>

		<section class="tips-grid">
			<article class="tip-card">
				<p class="tip-kicker">Step 1</p>
				<h2>Drop physical tension</h2>
				<p>
					Unclench your jaw, relax your shoulders, and loosen your hands. Small tension release often helps RMSSD recover faster than pushing through.
				</p>
			</article>

			<article class="tip-card">
				<p class="tip-kicker">Step 2</p>
				<h2>Slow the breath</h2>
				<p>
					Aim for a gentle inhale, short pause, and longer exhale. Keep it comfortable. The goal is calmer, not perfect.
				</p>
			</article>

			<article class="tip-card">
				<p class="tip-kicker">Step 3</p>
				<h2>Choose the next move</h2>
				<p>
					After the minute, either return to your task with one small next step or take a longer break if your RMSSD still stays below baseline.
				</p>
			</article>
		</section>
	</section>
</main>

<style>
	.page-shell {
		padding: 1.2rem 1.5rem 3rem;
	}

	.page-shell > :global(.section-nav),
	.recovery-shell {
		width: min(100%, 84rem);
		margin-inline: auto;
	}

	.recovery-shell {
		display: grid;
		gap: 1.25rem;
		margin-top: 1.2rem;
	}

	.hero-card,
	.tip-card {
		background: var(--panel-bg, rgba(255, 255, 255, 0.82));
		border: 1px solid var(--panel-border, rgba(160, 174, 197, 0.24));
		border-radius: 2rem;
		box-shadow: var(--shadow-soft, 0 14px 32px rgba(31, 47, 82, 0.08));
		backdrop-filter: blur(18px);
	}

	.hero-card {
		padding: 1.6rem;
		display: grid;
		gap: 1rem;
	}

	.eyebrow,
	.timer-label,
	.tip-kicker {
		margin: 0;
		font-size: 0.82rem;
		font-weight: 800;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--on-surface-variant, #5d7088);
	}

	h1,
	h2,
	p {
		margin: 0;
	}

	h1 {
		font-size: clamp(2.4rem, 6vw, 4rem);
		line-height: 0.96;
		color: var(--primary, #00675c);
	}

	.hero-copy,
	.timer-phase,
	.tip-card p {
		line-height: 1.6;
		color: var(--on-surface-variant, #5d7088);
	}

	.timer-card {
		padding: 1.35rem;
		border-radius: 1.6rem;
		background: linear-gradient(135deg, rgba(0, 103, 92, 0.1), rgba(18, 141, 127, 0.16));
		display: grid;
		gap: 0.55rem;
	}

	.timer-value {
		font-size: clamp(3.5rem, 10vw, 5.2rem);
		font-weight: 800;
		line-height: 0.95;
		color: var(--primary, #00675c);
	}

	.action-row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.85rem;
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
		font: inherit;
		font-weight: 800;
		cursor: pointer;
		background: linear-gradient(135deg, var(--primary, #00675c), #128d7f);
		color: white;
		box-shadow: 0 6px 0 rgba(0, 103, 92, 0.22);
		transition:
			transform 0.18s ease,
			box-shadow 0.18s ease,
			background 0.18s ease;
	}

	.button:hover {
		transform: translateY(-1px);
	}

	.button:active {
		transform: translateY(2px);
		box-shadow: none;
	}

	.button-subtle {
		background: var(--secondary-container, #dce9ff);
		color: var(--on-surface, #212f42);
		box-shadow: none;
	}

	.button-outline {
		background: rgba(0, 103, 92, 0.06);
		color: var(--primary, #00675c);
		border: 2px solid rgba(0, 103, 92, 0.18);
		box-shadow: none;
	}

	.tips-grid {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 1rem;
	}

	.tip-card {
		padding: 1.35rem;
		display: grid;
		gap: 0.6rem;
	}

	.tip-card h2 {
		font-size: 1.35rem;
		line-height: 1.1;
	}

	@media (max-width: 900px) {
		.tips-grid {
			grid-template-columns: 1fr;
		}
	}

	@media (max-width: 640px) {
		.page-shell {
			padding-inline: 1rem;
		}

		.hero-card,
		.tip-card {
			padding: 1.2rem;
			border-radius: 1.5rem;
		}

		.action-row {
			flex-direction: column;
			align-items: stretch;
		}
	}
</style>
