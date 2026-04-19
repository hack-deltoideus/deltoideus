<script lang="ts">
	import {
		generateStreamTrace
	} from '$lib/ecg/scheduler';
	import type { ScheduledBeat } from '$lib/ecg/types';

	type Props = {
		schedule: ScheduledBeat[];
		currentTimeMs: number;
		width?: number;
		height?: number;
	};

	let {
		schedule,
		currentTimeMs,
		width = 960,
		height = 280
	}: Props = $props();

	const trace = $derived(
		generateStreamTrace(schedule, currentTimeMs, {
			width,
			height
		})
	);

	const scanLinePosition = $derived(`${((trace.headX / width) * 100).toFixed(2)}%`);
	const gridRows = Array.from({ length: 7 }, (_, index) => index);
	const gridColumns = Array.from({ length: 15 }, (_, index) => index);
</script>

<div class="monitor-shell">
	<div class="grid-overlay" aria-hidden="true">
		{#each gridRows as row}
			<span class="grid-line row" style={`--row:${row}`}></span>
		{/each}
		{#each gridColumns as column}
			<span class="grid-line column" style={`--column:${column}`}></span>
		{/each}
	</div>

	<svg
		class="waveform"
		viewBox={`0 0 ${width} ${height}`}
		preserveAspectRatio="none"
		aria-label="Artificial ECG waveform"
	>
		<path class="wave-glow" d={trace.committedPath}></path>
		<path class="wave-line" d={trace.committedPath}></path>
		<path class="active-glow" d={trace.activePath}></path>
		<path class="active-line" d={trace.activePath}></path>
		<circle class="wave-head" cx={trace.headX} cy={trace.headY} r="4.5"></circle>
	</svg>

	<div class="scan-line" style={`left:${scanLinePosition}`} aria-hidden="true"></div>
</div>

<style>
	.monitor-shell {
		position: relative;
		margin-top: 1.15rem;
		min-height: 18rem;
		border-radius: 1.5rem;
		overflow: hidden;
		background:
			radial-gradient(circle at center, rgba(76, 242, 200, 0.08), transparent 54%),
			linear-gradient(180deg, rgba(11, 31, 39, 0.96), rgba(6, 20, 26, 0.96));
		border: 1px solid rgba(76, 242, 200, 0.16);
	}

	.grid-overlay {
		position: absolute;
		inset: 0;
	}

	.grid-line {
		position: absolute;
		background: rgba(76, 242, 200, 0.08);
	}

	.grid-line.row {
		left: 0;
		right: 0;
		height: 1px;
		top: calc((var(--row) + 1) * 12.5%);
	}

	.grid-line.column {
		top: 0;
		bottom: 0;
		width: 1px;
		left: calc((var(--column) + 1) * 6.25%);
	}

	.waveform {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
	}

	.wave-glow,
	.wave-line,
	.active-glow,
	.active-line {
		fill: none;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.wave-glow {
		stroke: rgba(76, 242, 200, 0.18);
		stroke-width: 10;
		filter: blur(6px);
	}

	.wave-line {
		stroke: var(--accent, #4cf2c8);
		stroke-width: 2.6;
		filter: drop-shadow(0 0 12px rgba(76, 242, 200, 0.42));
	}

	.active-glow {
		stroke: rgba(183, 255, 240, 0.22);
		stroke-width: 11;
		filter: blur(6px);
	}

	.active-line {
		stroke: #c9fff5;
		stroke-width: 3.4;
		filter: drop-shadow(0 0 15px rgba(183, 255, 240, 0.5));
	}

	.wave-head {
		fill: #b7fff0;
		filter: drop-shadow(0 0 10px rgba(183, 255, 240, 0.6));
	}

	.scan-line {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 2px;
		transform: translateX(-50%);
		background: linear-gradient(180deg, transparent, rgba(76, 242, 200, 0.88), transparent);
		box-shadow:
			0 0 0.8rem rgba(76, 242, 200, 0.34),
			0 0 2rem rgba(76, 242, 200, 0.18);
		transition: left 70ms linear;
	}

	@media (max-width: 720px) {
		.monitor-shell {
			min-height: 14.5rem;
		}
	}
</style>
