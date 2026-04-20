<script lang="ts">
	import { goto } from '$app/navigation';
	import CriticalInsightModal from '$lib/components/CriticalInsightModal.svelte';
	import favicon from '$lib/assets/favicon.svg';
	import { sensorSession } from '$lib/sensor-session';
	import { onMount } from 'svelte';

	let { children } = $props();

	const CRITICAL_SCORE_THRESHOLD = 60;
	const CRITICAL_HOLD_MS = 10_000;

	let criticalInsightVisible = $state(false);
	let currentOverallScore = $state(0);
	let isAlertSuppressed = $state(false);
	let wasAboveThreshold = $state(false);
	let hasInitializedCriticalWatch = $state(false);
	let criticalTimer: ReturnType<typeof setTimeout> | null = null;

	function clearCriticalTimer() {
		if (criticalTimer) {
			clearTimeout(criticalTimer);
			criticalTimer = null;
		}
	}

	function startCriticalTimer() {
		if (criticalTimer || criticalInsightVisible || isAlertSuppressed) {
			return;
		}

		criticalTimer = setTimeout(() => {
			criticalTimer = null;
			if (currentOverallScore > CRITICAL_SCORE_THRESHOLD && !isAlertSuppressed) {
				criticalInsightVisible = true;
			}
		}, CRITICAL_HOLD_MS);
	}

	function acknowledgeCriticalInsight() {
		criticalInsightVisible = false;
		isAlertSuppressed = true;
		clearCriticalTimer();
	}

	async function takeBreakNow() {
		acknowledgeCriticalInsight();
		await goto('/app/recovery');
	}

	onMount(() => {
		const unsubscribe = sensorSession.subscribe((state) => {
			currentOverallScore = state.overallStressScore;
			const isActiveSession = Boolean(state.sessionStartedAt);
			const isAboveThreshold = isActiveSession && state.overallStressScore > CRITICAL_SCORE_THRESHOLD;

			if (!hasInitializedCriticalWatch) {
				hasInitializedCriticalWatch = true;
				wasAboveThreshold = isAboveThreshold;

				if (!isAboveThreshold) {
					criticalInsightVisible = false;
					isAlertSuppressed = false;
				}
				return;
			}

			if (isAboveThreshold && !wasAboveThreshold) {
				startCriticalTimer();
			}

			if (isAboveThreshold) {
				wasAboveThreshold = true;
				return;
			}

			clearCriticalTimer();
			criticalInsightVisible = false;
			isAlertSuppressed = false;
			wasAboveThreshold = false;
		});

		return () => {
			clearCriticalTimer();
			unsubscribe();
		};
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link
		href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap"
		rel="stylesheet"
	/>
	<link
		href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap"
		rel="stylesheet"
	/>
</svelte:head>

{@render children()}
<CriticalInsightModal
	visible={criticalInsightVisible}
	score={currentOverallScore}
	onTakeBreak={takeBreakNow}
	onAcknowledge={acknowledgeCriticalInsight}
/>
