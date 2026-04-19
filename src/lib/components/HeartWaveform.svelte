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
		width?: number;
		height?: number;
		label?: string;
		sessionKey?: number;
		sampleAtMs?: number | null;
	};

	let {
		hr,
		rr,
		width = 960,
		height = 360,
		label = 'Simulated ECG-style waveform',
		sessionKey = 0,
		sampleAtMs = null
	}: Props = $props();

	const engine = new WaveformSignalEngine();
	let path = $state('');
	let animationFrame: number | null = null;
	const initialNow = Date.now();
	let output = $state<WaveformEngineOutput>(engine.getOutput(initialNow));
	let lastAcceptedKey = $state<string>('');
	let lastSessionKey = $state<number | null>(null);
	let cursorY = $state(0);
	let cursorX = $derived(width * 0.76);
	let worldCursorX = 0;
	let lastFrameAt = initialNow;
	let trailPoints: Array<{ x: number; y: number }> = [];
	let activeBeat = $state<{ beat: PreparedWaveBeat; startedAt: number } | null>(null);
	let pendingBeats = $state<PreparedWaveBeat[]>([]);

	const STREAM_SPEED_PX_PER_SECOND = 210;
	const SAMPLE_STEP_PX = 5;

	$effect(() => {
		if (lastSessionKey === null) {
			lastSessionKey = sessionKey;
			return;
		}

		if (sessionKey !== lastSessionKey) {
			engine.reset();
			lastAcceptedKey = '';
			lastSessionKey = sessionKey;
			activeBeat = null;
			pendingBeats = [];
			trailPoints = [];
			worldCursorX = 0;
			lastFrameAt = Date.now();
			cursorY = height * 0.5;
			path = '';
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

	function buildVisiblePath(): string {
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

	onMount(() => {
		cursorY = height * 0.5;
		const tick = () => {
			const now = Date.now();
			const deltaSeconds = Math.min((now - lastFrameAt) / 1000, 0.05);
			lastFrameAt = now;
			output = engine.getOutput(now);
			worldCursorX += STREAM_SPEED_PX_PER_SECOND * deltaSeconds;

			const baselineY = height * 0.5;
			const offset = sampleCurrentOffset(now);
			cursorY = baselineY - offset;
			trailPoints = [...trailPoints, { x: worldCursorX, y: cursorY }];
			const minWorldX = worldCursorX - width - SAMPLE_STEP_PX * 4;
			trailPoints = trailPoints.filter((point) => point.x >= minWorldX);
			path = buildVisiblePath();
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
		output.state === 'IDLE'
			? 'Waiting for heart signal'
			: output.state === 'CALIBRATING'
				? 'Calibrating waveform'
				: output.state === 'LIVE'
					? 'Live pulse visual'
					: 'Signal lost'
	);
</script>

<div class="wave-shell">
	<div class="wave-meta">
		<p class="wave-title">{label}</p>
		<p class={`wave-state state-${output.state.toLowerCase()}`}>{stateLabel}</p>
	</div>

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
			<path class="wave-glow" d={path}></path>
			<path class="wave-line" d={path}></path>
			<circle class="cursor-dot" cx={cursorX} cy={cursorY} r="5.8"></circle>
		</svg>
	</div>

	<p class="wave-caption">Visual reacts to live HR and RR data. Not a medical ECG trace.</p>
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
