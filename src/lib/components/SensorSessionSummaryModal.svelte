<script lang="ts">
	import { browser } from '$app/environment';
	import { onDestroy, tick } from 'svelte';
	import RiveCharacter from '$lib/components/RiveCharacter.svelte';
	import type { SavedDiagnosticSession } from '$lib/sensor-session';

	type CharacterController = {
		setIdle: () => void;
		setReading: () => void;
		setTalking: () => void;
	};

	type SummaryMessage = {
		role: 'assistant';
		text: string;
	};

	type SummaryResponse = {
		reply?: string;
		warning?: string;
		error?: string;
	};

	const TYPEWRITER_BASE_DELAY_MS = 9;

	let {
		open = false,
		session = null,
		displayName = 'Friend',
		onClose = () => {}
	}: {
		open?: boolean;
		session?: SavedDiagnosticSession | null;
		displayName?: string;
		onClose?: () => void;
	} = $props();

	let character: CharacterController | null = $state(null);
	let helperThread: HTMLDivElement | null = $state(null);
	let helperHistory = $state<SummaryMessage[]>([]);
	let helperStatus = $state('');
	let isReplyAnimating = $state(false);
	let isAwaitingAnalysis = $state(false);
	let isVisible = $state(false);
	let activeSessionId = $state<string | null>(null);
	let flowToken = 0;

	$effect(() => {
		if (!browser) {
			return;
		}

		if (open && session && session.id !== activeSessionId) {
			activeSessionId = session.id;
			isVisible = true;
			void beginSummaryFlow(session);
		}

		if (!open) {
			activeSessionId = null;
			isVisible = false;
			flowToken += 1;
			isReplyAnimating = false;
			isAwaitingAnalysis = false;
			helperHistory = [];
			helperStatus = '';
			syncCharacterState();
		}
	});

	$effect(() => {
		if (!browser) {
			return;
		}

		if (!isVisible) {
			return;
		}

		const previousOverflow = document.body.style.overflow;
		document.body.style.overflow = 'hidden';

		const handleKeydown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				requestClose();
			}
		};

		window.addEventListener('keydown', handleKeydown);

		return () => {
			document.body.style.overflow = previousOverflow;
			window.removeEventListener('keydown', handleKeydown);
		};
	});

	onDestroy(() => {
		flowToken += 1;
		document.body.style.overflow = '';
	});

	function requestClose() {
		onClose();
	}

	function syncCharacterState() {
		if (isReplyAnimating) {
			character?.setTalking();
			return;
		}

		if (isAwaitingAnalysis) {
			character?.setReading();
			return;
		}

		character?.setIdle();
	}

	function getTypewriterDelay(character: string) {
		if (/[.!?]/.test(character)) {
			return TYPEWRITER_BASE_DELAY_MS * 6;
		}

		if (/[,\n;]/.test(character)) {
			return TYPEWRITER_BASE_DELAY_MS * 3;
		}

		if (character === ' ') {
			return TYPEWRITER_BASE_DELAY_MS;
		}

		return TYPEWRITER_BASE_DELAY_MS * 2;
	}

	function buildTypingTimeline(reply: string) {
		const characters = Array.from(reply);
		const delays = characters.map((character) => getTypewriterDelay(character));
		return { characters, delays };
	}

	async function scrollHelperToBottom() {
		await tick();

		if (!helperThread) {
			return;
		}

		helperThread.scrollTo({
			top: helperThread.scrollHeight,
			behavior: 'smooth'
		});
	}

	async function typeAssistantReply(baseHistory: SummaryMessage[], reply: string, token: number) {
		const { characters, delays } = buildTypingTimeline(reply);
		let visibleReply = '';

		isReplyAnimating = true;
		syncCharacterState();
		helperHistory = [...baseHistory, { role: 'assistant', text: '' }];
		await scrollHelperToBottom();

		for (const [index, character] of characters.entries()) {
			if (token !== flowToken) {
				return;
			}

			visibleReply += character;
			helperHistory = [...baseHistory, { role: 'assistant', text: visibleReply }];

			if (index === characters.length - 1 || index % 4 === 0) {
				void scrollHelperToBottom();
			}

			await new Promise((resolve) => {
				setTimeout(resolve, delays[index] ?? TYPEWRITER_BASE_DELAY_MS);
			});
		}

		isReplyAnimating = false;
		syncCharacterState();
	}

	async function beginSummaryFlow(targetSession: SavedDiagnosticSession) {
		const token = ++flowToken;
		const optimisticReply = buildOptimisticReply(targetSession, displayName);

		helperHistory = [];
		helperStatus = '';
		isReplyAnimating = false;
		isAwaitingAnalysis = true;
		syncCharacterState();

		const summaryPromise = fetchSummaryAnalysis(targetSession);
		await typeAssistantReply([], optimisticReply, token);

		if (token !== flowToken) {
			return;
		}

		const summaryResult = await summaryPromise;
		if (token !== flowToken) {
			return;
		}

		isAwaitingAnalysis = false;
		syncCharacterState();

		const reply = summaryResult.reply?.trim() || fallbackAnalysis(targetSession);
		helperStatus = summaryResult.warning ?? '';

		await typeAssistantReply([{ role: 'assistant', text: optimisticReply }], reply, token);
	}

	async function fetchSummaryAnalysis(targetSession: SavedDiagnosticSession): Promise<SummaryResponse> {
		try {
			const response = await fetch('/api/session-summary', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({
					displayName,
					session: {
						id: targetSession.id,
						startedAt: targetSession.summary_payload?.startedAt ?? targetSession.started_at,
						endedAt: targetSession.summary_payload?.endedAt ?? targetSession.ended_at,
						durationSeconds:
							targetSession.summary_payload?.durationSeconds ?? targetSession.duration_seconds ?? 0,
						sampleCount: targetSession.summary_payload?.sampleCount ?? targetSession.sample_count,
						averageHeartRate:
							targetSession.summary_payload?.averageHeartRate ?? targetSession.avg_heart_rate,
						averageHrvMs: targetSession.summary_payload?.averageHrvMs ?? targetSession.avg_hrv_ms,
						averageRrMs: targetSession.summary_payload?.averageRrMs ?? targetSession.avg_rr_ms,
						lastHrvMs: targetSession.summary_payload?.lastHrvMs ?? targetSession.last_hrv_ms,
						maxHeartRate: targetSession.summary_payload?.maxHeartRate ?? targetSession.max_heart_rate,
						deviceName: targetSession.summary_payload?.deviceInfo?.name ?? targetSession.device_name,
						captureType: targetSession.summary_payload?.captureType ?? targetSession.capture_type,
						segmentLengthSeconds: targetSession.summary_payload?.segmentLengthSeconds ?? null,
						segments: targetSession.summary_payload?.segments ?? []
					}
				})
			});

			const payload = (await response.json()) as SummaryResponse;
			if (!response.ok) {
				return {
					reply: fallbackAnalysis(targetSession),
					warning: payload?.error ?? 'Oy could not generate the live analysis, so a local summary was used.'
				};
			}

			return payload;
		} catch {
			return {
				reply: fallbackAnalysis(targetSession),
				warning: 'Oy could not reach the live analysis service, so a local summary was used.'
			};
		}
	}

	function buildOptimisticReply(targetSession: SavedDiagnosticSession, name: string) {
		const summary = targetSession.summary_payload;
		const durationSeconds = summary?.durationSeconds ?? targetSession.duration_seconds ?? 0;
		const sampleCount = summary?.sampleCount ?? targetSession.sample_count;
		const averageHeartRate = summary?.averageHeartRate ?? targetSession.avg_heart_rate;
		const averageHrvMs = summary?.averageHrvMs ?? targetSession.avg_hrv_ms;
		const maxHeartRate = summary?.maxHeartRate ?? targetSession.max_heart_rate;

		return [
			`Nice work, ${name}. I saved your session and pulled out the key numbers.`,
			`This run lasted ${formatDuration(durationSeconds)}, captured ${sampleCount} samples, averaged ${formatMetric(averageHeartRate, 1)} bpm, and landed at ${formatMetric(averageHrvMs, 1)} ms HRV with a peak of ${formatMetric(maxHeartRate, 0)} bpm.`
		].join(' ');
	}

	function fallbackAnalysis(targetSession: SavedDiagnosticSession) {
		const summary = targetSession.summary_payload;
		const averageHeartRate = summary?.averageHeartRate ?? targetSession.avg_heart_rate;
		const averageHrvMs = summary?.averageHrvMs ?? targetSession.avg_hrv_ms;
		const maxHeartRate = summary?.maxHeartRate ?? targetSession.max_heart_rate;

		if (typeof averageHeartRate === 'number' && typeof averageHrvMs === 'number') {
			if (averageHeartRate >= 95 || averageHrvMs <= 24) {
				return 'This session looked fairly activated, so your system may have been working under more load than usual. A short reset, slower breathing, or a lighter next task would be a smart follow-up.';
			}

			if (averageHeartRate <= 78 && averageHrvMs >= 35) {
				return 'This session reads relatively steady overall, with signs that your system found some stability. If you want to keep the momentum, roll into one focused task before switching contexts.';
			}
		}

		if (typeof maxHeartRate === 'number' && maxHeartRate >= 110) {
			return 'There was at least one stronger spike in this session, even if the overall averages stayed moderate. It may help to notice what was happening around that peak before you start the next block.';
		}

		return 'This snapshot gives you a clean baseline for the session, even if the pattern is mixed. The best next move is to pair the numbers with a quick note about what you were doing and how you felt.';
	}

	function formatMetric(value: number | null | undefined, digits = 0) {
		if (typeof value !== 'number' || Number.isNaN(value)) {
			return '--';
		}

		return value.toFixed(digits);
	}

	function formatDuration(durationSeconds: number) {
		if (!durationSeconds) {
			return 'under a minute';
		}

		const hours = Math.floor(durationSeconds / 3600);
		const minutes = Math.floor((durationSeconds % 3600) / 60);
		const seconds = durationSeconds % 60;

		if (hours > 0) {
			return `${hours}h ${minutes}m`;
		}

		if (minutes > 0) {
			return `${minutes}m ${seconds}s`;
		}

		return `${seconds}s`;
	}

	function formatSessionDate(dateString: string | null | undefined) {
		if (!dateString) {
			return '--';
		}

		return new Date(dateString).toLocaleString([], {
			month: 'short',
			day: 'numeric',
			hour: 'numeric',
			minute: '2-digit'
		});
	}

	function formatActivityLabel(value: string | null | undefined) {
		if (!value) {
			return 'Sensor Session';
		}

		return value
			.split(/[_-]+/)
			.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
			.join(' ');
	}
</script>

{#if isVisible && session}
	<div class="summary-overlay" role="presentation" onclick={(event) => event.target === event.currentTarget && requestClose()}>
		<div
			class="summary-modal"
			role="dialog"
			aria-modal="true"
			aria-labelledby="session-summary-title"
		>
			<div class="summary-header">
				<div>
					<p class="eyebrow">Session Complete</p>
					<h2 id="session-summary-title">Oy&apos;s quick debrief</h2>
					<p class="summary-subtitle">
						{formatActivityLabel(session.summary_payload?.captureType ?? session.capture_type)} on
						{session.summary_payload?.deviceInfo?.name ?? session.device_name ?? 'Polar H9'} at
						{formatSessionDate(session.summary_payload?.startedAt ?? session.started_at)}
					</p>
				</div>

				<button class="close-button" type="button" onclick={requestClose} aria-label="Close summary">
					<span class="material-symbols-outlined">close</span>
				</button>
			</div>

			<div class="summary-body">
				<div class="summary-stage">
					<div class="summary-mascot">
						<RiveCharacter bind:this={character} variant="spotlight" />
					</div>
				</div>

				<div class="summary-column">
					<div class="stats-grid">
						<article class="stat-card">
							<p class="stat-label">Duration</p>
							<p class="stat-value">{formatDuration(session.summary_payload?.durationSeconds ?? session.duration_seconds ?? 0)}</p>
						</article>
						<article class="stat-card">
							<p class="stat-label">Average HR</p>
							<p class="stat-value">{formatMetric(session.summary_payload?.averageHeartRate ?? session.avg_heart_rate, 1)} <span>bpm</span></p>
						</article>
						<article class="stat-card">
							<p class="stat-label">Average HRV</p>
							<p class="stat-value">{formatMetric(session.summary_payload?.averageHrvMs ?? session.avg_hrv_ms, 1)} <span>ms</span></p>
						</article>
						<article class="stat-card">
							<p class="stat-label">Peak HR</p>
							<p class="stat-value">{formatMetric(session.summary_payload?.maxHeartRate ?? session.max_heart_rate, 0)} <span>bpm</span></p>
						</article>
					</div>

					<div class="chat-shell" bind:this={helperThread}>
						{#each helperHistory as msg}
							<div class="chat-bubble">
								<p class="chat-author">Oy</p>
								<p>{msg.text}</p>
							</div>
						{/each}

						{#if isAwaitingAnalysis && !isReplyAnimating}
							<div class="chat-bubble chat-bubble-status">
								<p class="chat-author">Oy</p>
								<p>Reviewing your pattern and writing the short analysis...</p>
							</div>
						{/if}
					</div>

					<div class="summary-footer">
						<div class="meta-row">
							<p class="summary-meta">
								{session.summary_payload?.sampleCount ?? session.sample_count} samples captured
							</p>
						</div>

						{#if helperStatus}
							<p class="inline-status">{helperStatus}</p>
						{/if}
					</div>
				</div>
			</div>
		</div>
	</div>
{/if}

<style>
	.summary-overlay {
		position: fixed;
		inset: 0;
		z-index: 120;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1.25rem;
		background: rgba(5, 16, 29, 0.52);
		backdrop-filter: blur(16px);
	}

	.summary-modal {
		width: min(100%, 68rem);
		max-height: min(92vh, 58rem);
		overflow: auto;
		padding: 1.35rem;
		border-radius: 2rem;
		background: color-mix(in srgb, var(--surface, #f7f8fc) 92%, white);
		border: 1px solid color-mix(in srgb, var(--panel-border, rgba(160, 174, 197, 0.3)) 90%, white);
		box-shadow: 0 28px 60px rgba(8, 24, 38, 0.28);
	}

	.summary-header,
	.meta-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		flex-wrap: wrap;
	}

	.summary-body {
		display: grid;
		grid-template-columns: minmax(18rem, 24rem) minmax(0, 1fr);
		gap: 1.35rem;
		margin-top: 1rem;
	}

	.summary-stage,
	.summary-mascot,
	.summary-column {
		min-width: 0;
	}

	.summary-stage {
		display: grid;
		align-content: start;
		gap: 0.9rem;
		padding-top: 0.25rem;
	}

	.summary-mascot {
		background: radial-gradient(circle at 50% 18%, rgba(255, 255, 255, 0.88), transparent 58%);
	}

	.summary-column {
		display: grid;
		gap: 1rem;
	}

	.eyebrow,
	.stat-label,
	.chat-author {
		margin: 0 0 0.35rem;
		font-size: 0.78rem;
		font-weight: 800;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--on-surface-variant, #5b6b84);
	}

	h2 {
		margin: 0;
		font-size: clamp(1.8rem, 3vw, 2.6rem);
		line-height: 1.02;
	}

	.summary-subtitle,
	.summary-meta,
	.inline-status {
		margin: 0;
		color: var(--on-surface-variant, #5b6b84);
		line-height: 1.55;
	}

	.close-button {
		display: inline-grid;
		place-items: center;
		width: 2.9rem;
		height: 2.9rem;
		border: 0;
		border-radius: 999px;
		cursor: pointer;
		background: color-mix(in srgb, var(--secondary-container, #d7e4fb) 86%, white);
		color: var(--on-surface, #20314b);
	}

	.stats-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.85rem;
	}

	.stat-card,
	.chat-shell,
	.summary-footer {
		border-radius: 1.5rem;
		border: 1px solid color-mix(in srgb, var(--field-border, rgba(180, 194, 216, 0.5)) 88%, white);
		background: color-mix(in srgb, var(--surface-container-lowest, #ffffff) 92%, transparent);
	}

	.stat-card {
		padding: 1rem;
	}

	.stat-value {
		margin: 0;
		font-size: clamp(1.35rem, 3vw, 2.1rem);
		font-weight: 800;
		letter-spacing: -0.04em;
		color: var(--on-surface, #20314b);
	}

	.stat-value span {
		font-size: 0.86rem;
		letter-spacing: 0.02em;
		color: var(--on-surface-variant, #5b6b84);
	}

	.chat-shell {
		display: flex;
		flex-direction: column;
		gap: 0.9rem;
		min-height: 18rem;
		max-height: 25rem;
		padding: 1rem;
		overflow-y: auto;
		scrollbar-gutter: stable;
	}

	.chat-bubble {
		max-width: 100%;
		padding: 1rem 1.05rem;
		border-radius: 1.2rem 1.2rem 1.2rem 0.45rem;
		background: var(--chat-bubble-bg, white);
		box-shadow: 0 8px 18px rgba(31, 47, 82, 0.06);
	}

	.chat-bubble p:last-child {
		margin: 0;
		line-height: 1.6;
	}

	.chat-bubble-status {
		opacity: 0.84;
	}

	.summary-footer {
		padding: 0.9rem 1rem;
	}

	@media (max-width: 900px) {
		.summary-body {
			grid-template-columns: 1fr;
		}
	}

	@media (max-width: 640px) {
		.summary-overlay {
			padding: 0.8rem;
		}

		.summary-modal {
			padding: 1rem;
			border-radius: 1.5rem;
		}

		.stats-grid {
			grid-template-columns: 1fr;
		}
	}
</style>
