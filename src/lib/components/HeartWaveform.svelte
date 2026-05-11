<script lang="ts">
	import { onMount } from 'svelte';
	import { WaveformSignalEngine } from '$lib/ecg/waveformSignalEngine';
	import type { WaveformEngineOutput } from '$lib/ecg/waveformTypes';
	import {
		prepareBeat,
		sampleBeatOffset,
		sampleIdleOffset,
		type PreparedWaveBeat
	} from '$lib/ecg/waveformGenerator';
	import { normalizeRr, toSmoothSvgPath } from '$lib/ecg/waveformUtils';

	type Props = {
		hr: number | null;
		rr: number[] | number | null;
		ecgSamples?: number[] | null;
		ecgSampleRateHz?: number;
		ecgSampleAtMs?: number | null;
		width?: number;
		height?: number;
		label?: string;
		showMeta?: boolean;
		sessionKey?: number;
		sampleAtMs?: number | null;
	};

	let {
		hr,
		rr,
		ecgSamples = null,
		ecgSampleRateHz = 130,
		ecgSampleAtMs = null,
		width = 960,
		height = 360,
		label = 'Simulated ECG-style waveform',
		showMeta = true,
		sessionKey = 0,
		sampleAtMs = null
	}: Props = $props();

	const engine = new WaveformSignalEngine();
	const RAW_DISPLAY_RATE_HZ = 130;
	const RAW_VISIBLE_SECONDS = 4;
	const RAW_MAX_POINTS = RAW_DISPLAY_RATE_HZ * RAW_VISIBLE_SECONDS;
	const RAW_INITIAL_BUFFER_SECONDS = 5;
	const RAW_INITIAL_BUFFER_SAMPLES = RAW_DISPLAY_RATE_HZ * RAW_INITIAL_BUFFER_SECONDS;
	const RAW_QUEUE_MAX = RAW_INITIAL_BUFFER_SAMPLES + RAW_MAX_POINTS * 2;
	const RAW_SIGNAL_TIMEOUT_MS = 3000;
	const STREAM_SPEED_PX_PER_SECOND = 210;
	const SAMPLE_STEP_PX = 5;
	const RAW_MORPH_IN_SECONDS = 2.4;
	const RAW_MORPH_OUT_SECONDS = 1.2;
	const RAW_NORMALIZATION_CENTER_SMOOTHING = 0.08;
	const RAW_NORMALIZATION_RANGE_SMOOTHING = 0.12;
	const RAW_MIN_HALF_RANGE = 60;

	let simulatedPath = $state('');
	let rawPath = $state('');
	let animationFrame: number | null = null;
	const initialNow = Date.now();
	let output = $state<WaveformEngineOutput>(engine.getOutput(initialNow));
	let renderNow = $state(initialNow);
	let lastAcceptedKey = $state('');
	let lastRawSampleKey = $state('');
	let lastSessionKey = $state<number | null>(null);
	let lastRawPacketAt = $state(0);
	let cursorY = $state(0);
	const cursorX = $derived(width * 0.92);
	let worldCursorX = 0;
	let lastFrameAt = initialNow;
	let trailPoints: Array<{ x: number; y: number }> = [];
	let activeBeat = $state<{ beat: PreparedWaveBeat; startedAt: number } | null>(null);
	let pendingBeats = $state<PreparedWaveBeat[]>([]);
	let rawDisplayQueue: number[] = [];
	let rawRollingValues: Array<{ value: number; morph: number }> = [];
	let rawSampleAccumulator = 0;
	let rawEcgMorph = $state(0);
	let rawBufferPrimed = $state(false);
	let rawBufferedSampleCount = 0;
	let rawDisplayCenter = $state(0);
	let rawDisplayHalfRange = $state(RAW_MIN_HALF_RANGE);

	$effect(() => {
		if (lastSessionKey === null) {
			lastSessionKey = sessionKey;
			return;
		}

		if (sessionKey !== lastSessionKey) {
			engine.reset();
			lastAcceptedKey = '';
			lastRawSampleKey = '';
			lastSessionKey = sessionKey;
			activeBeat = null;
			pendingBeats = [];
			rawDisplayQueue = [];
			rawRollingValues = [];
			rawSampleAccumulator = 0;
			lastRawPacketAt = 0;
			rawEcgMorph = 0;
			rawBufferPrimed = false;
			rawBufferedSampleCount = 0;
			rawDisplayCenter = 0;
			rawDisplayHalfRange = RAW_MIN_HALF_RANGE;
			lastFrameAt = Date.now();
			cursorY = height * 0.5;
		}
	});

	$effect(() => {
		const normalizedRr = normalizeRr(rr);
		if (hr === null || normalizedRr === null || sampleAtMs === null) {
			return;
		}

		const sampleKey = `${sampleAtMs}:${hr}:${normalizedRr}`;
		if (sampleKey === lastAcceptedKey) {
			return;
		}

		lastAcceptedKey = sampleKey;
		engine.addSample({
			hr,
			rr: normalizedRr,
			timestamp: sampleAtMs
		});
		output = engine.getOutput(sampleAtMs);

		if (output.state === 'LIVE') {
			pendingBeats = [...pendingBeats, prepareBeat(output.params, sampleAtMs)];
		}
	});

	$effect(() => {
		if (!ecgSamples?.length || ecgSampleAtMs === null) {
			return;
		}

		const sampleKey = `${ecgSampleAtMs}:${ecgSamples.length}:${ecgSamples[0]}:${ecgSamples.at(-1)}`;
		if (sampleKey === lastRawSampleKey) {
			return;
		}

		const resumingAfterGap =
			lastRawPacketAt === 0 || ecgSampleAtMs - lastRawPacketAt > RAW_SIGNAL_TIMEOUT_MS;
		lastRawSampleKey = sampleKey;
		lastRawPacketAt = ecgSampleAtMs;
		activeBeat = null;
		pendingBeats = [];

		if (resumingAfterGap) {
			rawDisplayQueue = [];
			rawRollingValues = Array.from({ length: RAW_MAX_POINTS }, () => ({ value: 0, morph: 0 }));
			rawSampleAccumulator = 0;
			rawEcgMorph = 0;
			rawBufferPrimed = false;
			rawBufferedSampleCount = 0;
			rawDisplayCenter = 0;
			rawDisplayHalfRange = RAW_MIN_HALF_RANGE;
		}

		rawDisplayQueue = [...rawDisplayQueue, ...ecgSamples].slice(-RAW_QUEUE_MAX);
		rawBufferedSampleCount = Math.min(
			rawBufferedSampleCount + ecgSamples.length,
			RAW_INITIAL_BUFFER_SAMPLES
		);
		rawBufferPrimed = rawBufferedSampleCount >= RAW_INITIAL_BUFFER_SAMPLES;

		if (rawRollingValues.length === 0) {
			rawRollingValues = Array.from({ length: RAW_MAX_POINTS }, () => ({ value: 0, morph: 0 }));
		}
	});

	function startNextBeat(now: number): PreparedWaveBeat | null {
		if (activeBeat || pendingBeats.length === 0) {
			return activeBeat ? activeBeat.beat : null;
		}

		const [nextBeat, ...rest] = pendingBeats;
		activeBeat = {
			beat: nextBeat,
			startedAt: now
		};
		pendingBeats = rest;
		return nextBeat;
	}

	function sampleCurrentOffset(now: number): number {
		if (activeBeat) {
			const progress = (now - activeBeat.startedAt) / activeBeat.beat.durationMs;
			if (progress >= 1) {
				activeBeat = null;
				startNextBeat(now);
				return sampleIdleOffset(worldCursorX, now);
			}

			return sampleBeatOffset(activeBeat.beat, progress);
		}

		const nextBeat = startNextBeat(now);
		if (nextBeat) {
			return sampleBeatOffset(nextBeat, 0);
		}

		return sampleIdleOffset(worldCursorX, now);
	}

	function rawSignalIsFresh(now: number): boolean {
		return lastRawPacketAt > 0 && now - lastRawPacketAt < RAW_SIGNAL_TIMEOUT_MS;
	}

	function clamp(value: number, min: number, max: number): number {
		return Math.max(min, Math.min(max, value));
	}

	function lerp(from: number, to: number, amount: number): number {
		return from + (to - from) * amount;
	}

	function median(values: number[]): number {
		if (values.length === 0) {
			return 0;
		}

		const sorted = [...values].sort((left, right) => left - right);
		const middle = Math.floor(sorted.length / 2);
		return sorted.length % 2 === 0 ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2 : (sorted[middle] ?? 0);
	}

	function percentile(values: number[], ratio: number): number {
		if (values.length === 0) {
			return 0;
		}

		const sorted = [...values].sort((left, right) => left - right);
		const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * ratio)));
		return sorted[index] ?? 0;
	}

	function appendPoint(x: number, y: number) {
		trailPoints = [...trailPoints, { x, y }];
		const minWorldX = worldCursorX - width - SAMPLE_STEP_PX * 4;
		trailPoints = trailPoints.filter((point) => point.x >= minWorldX);
	}

	function buildSimulatedPath(): string {
		const viewportStartX = worldCursorX - cursorX;
		const visiblePoints = trailPoints
			.filter((point) => point.x >= viewportStartX - SAMPLE_STEP_PX)
			.map((point) => ({
				x: point.x - viewportStartX,
				y: point.y
			}));

		if (visiblePoints.length === 0 || visiblePoints[visiblePoints.length - 1].x < cursorX - 0.5) {
			visiblePoints.push({ x: cursorX, y: cursorY });
		}

		return toSmoothSvgPath(visiblePoints);
	}

	function buildRawPath(): string {
		if (rawRollingValues.length < 2) {
			return '';
		}

		const topPadding = height * 0.16;
		const usableHeight = height * 0.68;
		const rawValues = rawRollingValues.map((sample) => sample.value);
		const visibleFloor = percentile(rawValues, 0.02);
		const visibleCeiling = percentile(rawValues, 0.995);
		const targetCenter = median(rawValues);
		const targetHalfRange = Math.max(
			visibleCeiling - targetCenter,
			targetCenter - visibleFloor,
			RAW_MIN_HALF_RANGE
		);
		rawDisplayCenter = lerp(
			rawDisplayCenter,
			targetCenter,
			RAW_NORMALIZATION_CENTER_SMOOTHING
		);
		rawDisplayHalfRange = lerp(
			rawDisplayHalfRange,
			targetHalfRange,
			RAW_NORMALIZATION_RANGE_SMOOTHING
		);
		const baselineY = topPadding + usableHeight * 0.5;
		const rawPoints = rawRollingValues.map((sample, index) => {
			const normalized = clamp(
				((rawValues[index] ?? sample.value) - rawDisplayCenter) /
					Math.max(rawDisplayHalfRange, RAW_MIN_HALF_RANGE),
				-1,
				1
			);
			const rawY = baselineY - normalized * usableHeight * 0.5;
			return {
				x: (cursorX * index) / Math.max(rawRollingValues.length - 1, 1),
				y: lerp(baselineY, rawY, sample.morph)
			};
		});

		cursorY = rawPoints.at(-1)?.y ?? height * 0.5;
		return toSmoothSvgPath(rawPoints);
	}

	onMount(() => {
		cursorY = height * 0.5;
		const tick = () => {
			const now = Date.now();
			renderNow = now;
			const deltaSeconds = Math.min((now - lastFrameAt) / 1000, 0.05);
			lastFrameAt = now;
			output = engine.getOutput(now);
			const morphDelta =
				deltaSeconds /
				(rawSignalIsFresh(now) ? RAW_MORPH_IN_SECONDS : RAW_MORPH_OUT_SECONDS);
			rawEcgMorph = clamp(
				rawEcgMorph + (rawSignalIsFresh(now) ? morphDelta : -morphDelta),
				0,
				1
			);

			if (rawSignalIsFresh(now)) {
				rawSampleAccumulator += deltaSeconds * RAW_DISPLAY_RATE_HZ;
				const samplesToDraw = Math.min(Math.floor(rawSampleAccumulator), rawDisplayQueue.length);
				rawSampleAccumulator = Math.max(0, rawSampleAccumulator - samplesToDraw);

				for (let index = 0; index < samplesToDraw; index += 1) {
					const sample = rawDisplayQueue.shift();
					if (typeof sample !== 'number') {
						continue;
					}

					rawRollingValues = [...rawRollingValues, { value: sample, morph: rawEcgMorph }].slice(
						-RAW_MAX_POINTS
					);
				}

				rawPath = buildRawPath();
			}

			if (rawSignalIsFresh(now) && rawBufferPrimed) {
				animationFrame = window.requestAnimationFrame(tick);
				return;
			}

			if (!rawSignalIsFresh(now)) {
				rawSampleAccumulator = 0;
				rawBufferedSampleCount = 0;
				rawBufferPrimed = false;
			}

			worldCursorX += STREAM_SPEED_PX_PER_SECOND * deltaSeconds;
			const baselineY = height * 0.5;
			const offset = sampleCurrentOffset(now);
			cursorY = baselineY - offset;
			appendPoint(worldCursorX, cursorY);
			simulatedPath = buildSimulatedPath();
			if (!rawSignalIsFresh(now)) {
				rawPath = '';
			}

			animationFrame = window.requestAnimationFrame(tick);
		};

		tick();

		return () => {
			if (animationFrame !== null) {
				window.cancelAnimationFrame(animationFrame);
			}
		};
	});

	const stateLabel = $derived(
		rawSignalIsFresh(renderNow) && !rawBufferPrimed
			? 'Buffering raw ECG'
			: rawSignalIsFresh(renderNow) || rawEcgMorph > 0
			? 'Raw ECG signal'
			: output.state === 'IDLE'
				? 'Waiting for heart signal'
				: output.state === 'CALIBRATING'
					? 'Calibrating waveform'
					: output.state === 'LIVE'
						? 'Live pulse visual'
						: 'Signal lost'
	);
	const stateClass = $derived(
		rawSignalIsFresh(renderNow) && !rawBufferPrimed
			? 'calibrating'
			: rawSignalIsFresh(renderNow) || rawEcgMorph > 0
				? 'raw'
				: output.state.toLowerCase()
	);
</script>

<div class="wave-shell">
	{#if showMeta}
		<div class="wave-meta">
			<p class="wave-title">{label}</p>
			<p class={`wave-state state-${stateClass}`}>{stateLabel}</p>
		</div>
	{/if}

	<div class="monitor-shell">
		<div class="grid-overlay" aria-hidden="true">
			{#each Array.from({ length: 8 }, (_, index) => index) as row}
				<span class="grid-line row" style={`--row:${row}`}></span>
			{/each}
			{#each Array.from({ length: 19 }, (_, index) => index) as column}
				<span class="grid-line column" style={`--column:${column}`}></span>
			{/each}
		</div>

		<svg
			class="waveform"
			viewBox={`0 0 ${width} ${height}`}
			preserveAspectRatio="none"
			aria-label={label}
		>
			<line class="cursor-beam" x1={cursorX} x2={cursorX} y1="0" y2={height}></line>
			{#if rawSignalIsFresh(renderNow) || rawEcgMorph > 0}
				<path class="wave-glow" d={rawPath}></path>
				<path class="wave-line" d={rawPath}></path>
			{:else}
				<path class="wave-glow" d={simulatedPath}></path>
				<path class="wave-line" d={simulatedPath}></path>
			{/if}
			<circle class="cursor-dot" cx={cursorX} cy={cursorY} r="5.8"></circle>
		</svg>
	</div>

	{#if showMeta}
		<p class="wave-caption">Visual uses raw Polar H10 ECG when available, with HR/RR fallback. Not a medical ECG trace.</p>
	{/if}
</div>

<style>
	.wave-shell {
		display: grid;
		gap: 0.8rem;
	}

	.wave-meta {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		flex-wrap: wrap;
	}

	.wave-title,
	.wave-caption {
		margin: 0;
	}

	.wave-title {
		font-size: 0.92rem;
		font-weight: 700;
		color: var(--muted, #4e5c71);
	}

	.wave-state {
		margin: 0;
		padding: 0.45rem 0.72rem;
		border-radius: 999px;
		font-size: 0.75rem;
		font-weight: 800;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	.state-idle,
	.state-calibrating {
		background: rgba(255, 255, 255, 0.72);
		color: var(--muted, #4e5c71);
		box-shadow: inset 0 0 0 1px rgba(160, 174, 197, 0.3);
	}

	.state-live {
		background: rgba(91, 244, 222, 0.55);
		color: #00594f;
		box-shadow: inset 0 0 0 1px rgba(0, 103, 92, 0.14);
	}

	.state-raw {
		background: rgba(122, 45, 99, 0.14);
		color: #7a2d63;
		box-shadow: inset 0 0 0 1px rgba(122, 45, 99, 0.16);
	}

	.state-signal_lost {
		background: rgba(252, 192, 37, 0.32);
		color: #614700;
		box-shadow: inset 0 0 0 1px rgba(117, 86, 0, 0.14);
	}

	.monitor-shell {
		position: relative;
		min-height: 24rem;
		border-radius: 1.5rem;
		overflow: hidden;
		background:
			radial-gradient(circle at top, rgba(91, 244, 222, 0.18), transparent 42%),
			linear-gradient(180deg, rgba(255, 255, 255, 0.92), rgba(234, 241, 255, 0.96));
		border: 1px solid rgba(160, 174, 197, 0.38);
		box-shadow:
			inset 0 1px 0 rgba(255, 255, 255, 0.65),
			0 8px 0 0 #dce9ff;
	}

	.grid-overlay {
		position: absolute;
		inset: 0;
	}

	.grid-line {
		position: absolute;
		background: rgba(0, 103, 92, 0.1);
	}

	.grid-line.row {
		left: 0;
		right: 0;
		height: 1px;
		top: calc((var(--row) + 1) * 11.11%);
	}

	.grid-line.column {
		top: 0;
		bottom: 0;
		width: 1px;
		left: calc((var(--column) + 1) * 5%);
	}

	.waveform {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
	}

	.cursor-beam {
		stroke: rgba(0, 103, 92, 0.18);
		stroke-width: 1.5;
		stroke-dasharray: 8 8;
	}

	.wave-glow,
	.wave-line {
		fill: none;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.wave-glow {
		stroke: rgba(0, 103, 92, 0.18);
		stroke-width: 11;
		filter: blur(7px);
	}

	.wave-line {
		stroke: var(--accent, #00675c);
		stroke-width: 4.1;
		filter: drop-shadow(0 0 10px rgba(91, 244, 222, 0.38));
	}

	.cursor-dot {
		fill: #ffffff;
		filter:
			drop-shadow(0 0 8px rgba(91, 244, 222, 0.95))
			drop-shadow(0 0 18px rgba(0, 103, 92, 0.28));
	}

	.wave-caption {
		font-size: 0.85rem;
		line-height: 1.55;
		color: var(--muted, #4e5c71);
	}

	@media (max-width: 720px) {
		.monitor-shell {
			min-height: 20rem;
		}
	}
</style>
