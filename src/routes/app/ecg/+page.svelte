<script lang="ts">
	import { browser } from '$app/environment';
	import { onMount } from 'svelte';
	import HeartWaveform from '$lib/components/HeartWaveform.svelte';
	import AppSectionNav from '$lib/components/AppSectionNav.svelte';
	import SiteNav from '$lib/components/SiteNav.svelte';
	import {
		publishLiveEcgReading,
		subscribeLiveEcgReadings,
		type LiveEcgReading
	} from '$lib/live-ecg-stream';
	import { connectHeartRateMonitor, connectPolarEcgStream } from '$lib/polar';
	import { RespiratoryRateEstimator, type RespiratoryRateEstimate } from '$lib/respiration';
	let waveformSessionKey = $state(0);
	let nowMs = $state(Date.now());
	let lastReadingAtMs = $state<number | null>(null);
	let latestHeartRate = $state<number | null>(null);
	let latestRrMs = $state<number | null>(null);
	let latestEcgMicrovolts = $state<number | null>(null);
	let rawEcgPacketCount = $state(0);
	let rawEcgSampleCount = $state(0);
	let latestEcgFrameType = $state<number | null>(null);
	let latestEcgTimestampNs = $state('');
	let rawEcgLogs = $state<string[]>([]);
	let rawEcgSamples = $state<number[]>([]);
	let respiratoryEstimate = $state<RespiratoryRateEstimate | null>(null);
	let canUseBluetooth = $state(false);
	let isConnecting = $state(false);
	let isSensorConnected = $state(false);
	let sensorStatus = $state('No live device connected.');
	let stopSensor = $state<(() => Promise<void>) | null>(null);
	const respiratoryEstimator = new RespiratoryRateEstimator();

	const signalIsLive = $derived(lastReadingAtMs !== null && nowMs - lastReadingAtMs < 2500);
	const signalLabel = $derived(signalIsLive ? 'LIVE' : 'IDLE');
	const signalCopy = $derived(
		isSensorConnected
			? 'Streaming live HR/RR samples into the simulated heart visual.'
			: 'Monitor is on live standby and will react as soon as a compatible device starts sending data.'
	);
	const connectionLabel = $derived(isSensorConnected ? 'CONNECTED' : 'STANDBY');
	const connectDisabledReason = $derived(getConnectDisabledReason());
	const rawEcgPath = $derived(buildRawEcgPath(rawEcgSamples));

	onMount(() => {
		canUseBluetooth = typeof navigator !== 'undefined' && 'bluetooth' in navigator;
		if (!canUseBluetooth) {
			sensorStatus =
				'Web Bluetooth is not available here. Open this page in Chrome or Edge on localhost, and make sure Bluetooth is enabled for the browser.';
		}

		const clock = window.setInterval(() => {
			nowMs = Date.now();
		}, 250);

		const unsubscribe = subscribeLiveEcgReadings((reading) => {
			handleLiveReading(reading);
		});

		return () => {
			window.clearInterval(clock);
			if (stopSensor) {
				void stopSensor();
			}
			unsubscribe();
		};
	});

	function handleLiveReading(reading: LiveEcgReading) {
		lastReadingAtMs = reading.receivedAtMs;
		latestHeartRate = reading.heartRate;
		latestRrMs = reading.rrMs;
	}

	async function connectDevice() {
		if (!canUseBluetooth || isConnecting || isSensorConnected) {
			return;
		}

		isConnecting = true;
		sensorStatus = 'Connecting to heart rate monitor...';

		try {
			stopSensor = await connectHeartRateMonitor((reading) => {
				const nextReading: LiveEcgReading = {
					heartRate: reading.heartRate,
					rrMs: reading.rrMs ?? Math.round(60000 / Math.max(reading.heartRate, 1)),
					receivedAtMs: Date.now()
				};

				publishLiveEcgReading(nextReading);
			});

			isSensorConnected = true;
			waveformSessionKey += 1;
			sensorStatus = 'Connected. Streaming live HR/RR into the ECG monitor.';
		} catch (error) {
			sensorStatus =
				error instanceof Error ? error.message : 'Could not connect to heart rate monitor.';
		} finally {
			isConnecting = false;
		}
	}

	async function connectRawEcgDevice() {
		if (!canUseBluetooth || isConnecting || isSensorConnected) {
			return;
		}

		isConnecting = true;
		sensorStatus = 'Connecting to Polar PMD ECG stream...';
		rawEcgPacketCount = 0;
		rawEcgSampleCount = 0;
		latestEcgMicrovolts = null;
		latestEcgFrameType = null;
		latestEcgTimestampNs = '';
		rawEcgLogs = [];
		rawEcgSamples = [];
		respiratoryEstimate = null;
		respiratoryEstimator.reset();

		try {
			stopSensor = await connectPolarEcgStream((packet) => {
				const packetSamples = packet.samples.map((sample) => sample.microvolts);
				rawEcgPacketCount += 1;
				rawEcgSampleCount += packet.samples.length;
				latestEcgMicrovolts = packet.samples.at(-1)?.microvolts ?? latestEcgMicrovolts;
				latestEcgFrameType = packet.frameType;
				latestEcgTimestampNs = packet.timestampNs.toString();
				lastReadingAtMs = Date.now();
				rawEcgSamples = [...rawEcgSamples, ...packetSamples].slice(-520);
				respiratoryEstimate = respiratoryEstimator.addSamples(packetSamples);
				rawEcgLogs = [
					`Packet ${rawEcgPacketCount}: ${packet.samples.length} samples, latest ${latestEcgMicrovolts ?? '--'} uV, frame ${packet.frameType}`,
					...rawEcgLogs
				].slice(0, 8);

				console.log('Polar ECG packet', {
					frameType: packet.frameType,
					timestampNs: packet.timestampNs.toString(),
					sampleCount: packet.samples.length,
					firstSample: packet.samples[0],
					lastSample: packet.samples.at(-1),
					rawBytes: packet.rawBytes
				});
			});

			isSensorConnected = true;
			waveformSessionKey += 1;
			sensorStatus = 'Connected. Raw ECG packets are decoding below and logging to the browser console.';
		} catch (error) {
			sensorStatus = error instanceof Error ? error.message : 'Could not connect to Polar ECG stream.';
		} finally {
			isConnecting = false;
		}
	}

	async function disconnectDevice() {
		if (!stopSensor) {
			return;
		}

		await stopSensor();
		stopSensor = null;
		isSensorConnected = false;
		sensorStatus = 'Disconnected. ECG monitor is back to flatline standby.';
	}

	function getConnectDisabledReason(): string {
		if (!canUseBluetooth) {
			return 'Web Bluetooth unavailable. Use Chrome or Edge on http://127.0.0.1 or HTTPS, with Bluetooth enabled.';
		}

		if (isConnecting) {
			return 'Connection is already in progress.';
		}

		if (isSensorConnected) {
			return 'A device is already connected. Disconnect before switching modes.';
		}

		return '';
	}

	function buildRawEcgPath(samples: number[]): string {
		if (samples.length < 2) {
			return '';
		}

		const width = 720;
		const height = 220;
		const padding = 16;
		const visibleHeight = height - padding * 2;
		const min = Math.min(...samples);
		const max = Math.max(...samples);
		const range = Math.max(max - min, 1);

		return samples
			.map((sample, index) => {
				const x = (index / (samples.length - 1)) * width;
				const normalized = (sample - min) / range;
				const y = padding + (1 - normalized) * visibleHeight;
				return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
			})
			.join(' ');
	}
</script>

<svelte:head>
	<title>Sanctuary | ECG</title>
</svelte:head>

<SiteNav />

<main class="page-shell">
	<section class="hero">
		<div>
			<p class="eyebrow">Live Heart Visual</p>
			<h1>Reactive ECG-style monitor</h1>
			<p class="hero-copy">
				This screen is now dedicated to the live Polar H9 waveform. It stays in procedural
				idle motion until HR/RR readings arrive, then transitions into the reactive simulated
				ECG-style visual defined by the new signal engine.
			</p>
		</div>

		<div class="hero-card">
			<div class="hero-card-icon">
				<span class="material-symbols-outlined">monitor_heart</span>
			</div>
			<div>
				<p class="hero-card-label">Signal status</p>
				<p class="hero-card-value">{signalLabel}</p>
				<p class="hero-card-copy">{signalCopy}</p>
			</div>
		</div>
	</section>

	<AppSectionNav />

	<section class="viewer-card">
		<div class="section-heading">
			<div>
				<p class="eyebrow">Live Monitor</p>
				<h2>Streaming waveform surface</h2>
				<p class="section-copy">
					The waveform remains honest to the available data: idle motion with no signal,
					calibration while the first readings arrive, and a stylized ECG-like pulse once the
					live stream is established.
				</p>
			</div>
			<div class="status-pill">
				<span class={`status-dot status-dot-${signalIsLive ? 'live' : 'idle'}`}></span>
				<span>{signalIsLive ? 'Receiving signal' : 'Waiting for data'}</span>
			</div>
		</div>

		<div class="control-row">
			<button
				class="button"
				type="button"
				onclick={connectDevice}
				disabled={!canUseBluetooth || isConnecting || isSensorConnected}
				title={connectDisabledReason}
			>
				<span class="material-symbols-outlined">bluetooth</span>
				<span>{isConnecting ? 'Connecting...' : 'Connect Device'}</span>
			</button>

			<button
				class="button"
				type="button"
				onclick={connectRawEcgDevice}
				disabled={!canUseBluetooth || isConnecting || isSensorConnected}
				title={connectDisabledReason}
			>
				<span class="material-symbols-outlined">ecg_heart</span>
				<span>{isConnecting ? 'Connecting...' : 'Connect Raw ECG'}</span>
			</button>

			<button
				class="button button-subtle"
				type="button"
				onclick={disconnectDevice}
				disabled={!isSensorConnected}
			>
				Disconnect
			</button>
		</div>

		<p class="section-copy status-copy">{sensorStatus}</p>
		{#if connectDisabledReason}
			<p class="section-copy status-copy">{connectDisabledReason}</p>
		{/if}

		<div class="raw-ecg-panel">
			<p class="metric-label">RAW ECG PMD</p>
			<div class="raw-ecg-grid">
				<span>{rawEcgPacketCount} packets</span>
				<span>{rawEcgSampleCount} samples</span>
				<span>{latestEcgMicrovolts ?? '--'} uV</span>
				<span>Frame {latestEcgFrameType ?? '--'}</span>
			</div>
			<p class="section-copy raw-ecg-copy">
				Latest timestamp {latestEcgTimestampNs || '--'}
			</p>
			<div class="respiration-panel">
				<div>
					<p class="metric-label">RESPIRATORY RATE ESTIMATE</p>
					<p class="respiration-value">
						{respiratoryEstimate?.breathsPerMinute ?? '--'}<span> breaths/min</span>
					</p>
				</div>
				<div class="respiration-meta">
					<span>Confidence {respiratoryEstimate ? Math.round(respiratoryEstimate.confidence * 100) : 0}%</span>
					<span>{respiratoryEstimate?.qualityLabel ?? 'warming-up'}</span>
					<span>{respiratoryEstimate?.peakCount ?? 0} R peaks</span>
				</div>
				<div class="respiration-sources">
					<span>QRS RMS {respiratoryEstimate?.qrsRmsBpm ?? '--'}</span>
					<span>Baseline {respiratoryEstimate?.baselineBpm ?? '--'}</span>
					<span>RRV {respiratoryEstimate?.rrIntervalBpm ?? '--'}</span>
				</div>
			</div>
			<div class="raw-ecg-trace" aria-label="Decoded raw ECG trace">
				<svg viewBox="0 0 720 220" role="img">
					<path class="raw-ecg-midline" d="M 0 110 L 720 110" />
					{#if rawEcgPath}
						<path class="raw-ecg-wave" d={rawEcgPath} />
					{/if}
				</svg>
			</div>
			{#if rawEcgLogs.length > 0}
				<div class="raw-ecg-log" aria-label="Recent raw ECG packets">
					{#each rawEcgLogs as log}
						<p>{log}</p>
					{/each}
				</div>
			{/if}
		</div>

		{#if !canUseBluetooth}
			<p class="section-copy status-copy">
				Web Bluetooth is only available in supported browsers like Chrome or Edge over HTTPS or localhost.
			</p>
		{/if}

		<div class="ecg-card">
			<div class="ecg-card-header">
				<div>
					<p class="eyebrow">Waveform</p>
					<h3>Live ECG-style card</h3>
				</div>
				<div class="ecg-chip">
					<span class="material-symbols-outlined">ecg_heart</span>
					<span>Polar H9</span>
				</div>
			</div>

			<div class="monitor-shell">
				<HeartWaveform
					hr={latestHeartRate}
					rr={latestRrMs}
					sampleAtMs={lastReadingAtMs}
					sessionKey={waveformSessionKey}
					label="Simulated ECG-style waveform"
				/>
			</div>
		</div>

		<div class="metric-grid">
			<div class="metric-card">
				<p class="metric-label">HEART RATE</p>
				<p class="metric-value">{latestHeartRate ?? '--'}<span> BPM</span></p>
			</div>
			<div class="metric-card">
				<p class="metric-label">RR INTERVAL</p>
				<p class="metric-value secondary">{latestRrMs ?? '--'}<span> MS</span></p>
			</div>
			<div class="metric-card">
				<p class="metric-label">CONNECTION</p>
				<p class="metric-value tertiary">{connectionLabel}</p>
			</div>
		</div>
	</section>
</main>

<style>
	:global(:root) {
		--background: #f4f6ff;
		--surface: #ffffff;
		--surface-soft: #eaf1ff;
		--surface-strong: #dce9ff;
		--panel-border: #c9deff;
		--text: #212f42;
		--muted: #4e5c71;
		--accent: #00675c;
		--accent-soft: #5bf4de;
		--secondary: #005da7;
		--tertiary: #755600;
		--shadow-soft: 0 8px 0 0 #dce9ff;
		--shadow-card: 0 10px 24px rgba(33, 47, 66, 0.08);
	}

	:global(body) {
		margin: 0;
		font-family: 'Plus Jakarta Sans', sans-serif;
		background:
			radial-gradient(circle at top left, rgba(91, 244, 222, 0.28), transparent 28%),
			radial-gradient(circle at top right, rgba(183, 211, 255, 0.6), transparent 34%),
			linear-gradient(180deg, #f4f6ff 0%, #eef4ff 42%, #f8fbff 100%);
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
	}

	.page-shell {
		max-width: 88rem;
		margin: 0 auto;
		padding: 1.25rem 1.5rem 3rem;
	}

	.hero {
		display: grid;
		grid-template-columns: minmax(0, 1.25fr) minmax(16rem, 0.75fr);
		gap: 1.25rem;
		align-items: end;
	}

	.eyebrow,
	.hero-card-label {
		margin: 0;
		font-size: 0.78rem;
		font-weight: 800;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--muted);
	}

	h1,
	h2 {
		margin: 0;
	}

	h1 {
		font-size: clamp(2.6rem, 6vw, 4.7rem);
		line-height: 0.95;
		letter-spacing: -0.05em;
		color: var(--accent);
	}

	h2 {
		font-size: clamp(1.6rem, 2.6vw, 2.3rem);
		line-height: 1.05;
	}

	.hero-copy,
	.section-copy,
	.hero-card-copy {
		color: var(--muted);
	}

	.hero-copy {
		max-width: 45rem;
		margin-top: 0.95rem;
		font-size: 1.05rem;
		line-height: 1.7;
	}

	.hero-card,
	.viewer-card,
	.metric-card {
		background: color-mix(in srgb, var(--surface) 88%, var(--surface-soft));
		border: 1px solid var(--panel-border);
		box-shadow: var(--shadow-soft), var(--shadow-card);
	}

	.hero-card {
		padding: 1.4rem;
		border-radius: 2rem;
		display: flex;
		align-items: center;
		gap: 1rem;
	}

	.hero-card-icon {
		width: 3.6rem;
		height: 3.6rem;
		border-radius: 1.3rem;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--accent);
		color: #c1fff2;
		box-shadow: 0 4px 0 0 #00594f;
	}

	.hero-card-value {
		margin: 0.35rem 0 0;
		font-size: clamp(2rem, 5vw, 3.5rem);
		font-weight: 800;
		letter-spacing: -0.05em;
		color: var(--accent);
	}

	.hero-card-copy {
		margin: 0.55rem 0 0;
		line-height: 1.6;
	}

	.viewer-card {
		margin-top: 1.3rem;
		padding: 2rem;
		border-radius: 2rem;
		min-width: 0;
	}

	.section-heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		flex-wrap: wrap;
	}

	.status-pill {
		display: inline-flex;
		align-items: center;
		gap: 0.55rem;
		padding: 0.75rem 1rem;
		border-radius: 999px;
		background: var(--surface-soft);
		color: var(--text);
		font-size: 0.9rem;
		font-weight: 800;
		box-shadow: inset 0 0 0 1px rgba(160, 174, 197, 0.28);
	}

	.status-dot {
		width: 0.6rem;
		height: 0.6rem;
		border-radius: 999px;
	}

	.status-dot-live {
		background: #fb5151;
		box-shadow: 0 0 0.75rem rgba(251, 81, 81, 0.45);
	}

	.status-dot-idle {
		background: var(--accent);
		box-shadow: 0 0 0.75rem rgba(0, 103, 92, 0.2);
	}

	.monitor-shell {
		margin-top: 1.15rem;
	}

	.ecg-card {
		margin-top: 1.4rem;
		padding: 1.5rem;
		border-radius: 2rem;
		background: linear-gradient(180deg, #dce9ff 0%, #eaf1ff 100%);
		border: 1px solid #c9deff;
		box-shadow: 0 8px 0 0 #b7d3ff, var(--shadow-card);
	}

	.ecg-card-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		flex-wrap: wrap;
	}

	h3 {
		margin: 0.2rem 0 0;
		font-size: clamp(1.4rem, 2vw, 1.9rem);
		line-height: 1.05;
	}

	.ecg-chip {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		padding: 0.78rem 1rem;
		border-radius: 1.25rem;
		background: rgba(255, 255, 255, 0.9);
		color: var(--accent);
		font-size: 0.86rem;
		font-weight: 800;
		box-shadow: 0 4px 0 0 #dce9ff;
	}

	.control-row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.85rem;
		margin-top: 1rem;
	}

	.button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.55rem;
		padding: 0.9rem 1.15rem;
		border-radius: 1rem;
		border: 0;
		cursor: pointer;
		font: inherit;
		font-weight: 800;
		background: var(--accent);
		color: #c1fff2;
		box-shadow: 0 4px 0 0 #00594f;
		transition:
			transform 0.18s ease,
			box-shadow 0.18s ease,
			background 0.18s ease;
	}

	.button:hover:not(:disabled) {
		transform: translateY(-2px);
	}

	.button:active:not(:disabled) {
		transform: translateY(2px);
		box-shadow: none;
	}

	.button:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}

	.button-subtle {
		background: var(--surface);
		color: var(--text);
		box-shadow: 0 4px 0 0 #dce9ff;
		border: 1px solid #c9deff;
	}

	.status-copy {
		margin-top: 0.85rem;
		padding: 1rem 1.1rem;
		border-radius: 1.3rem;
		background: rgba(255, 255, 255, 0.68);
		border: 1px solid rgba(160, 174, 197, 0.3);
	}

	.raw-ecg-panel {
		margin-top: 0.85rem;
		padding: 1rem;
		border-radius: 1.3rem;
		background: rgba(255, 255, 255, 0.68);
		border: 1px solid rgba(160, 174, 197, 0.3);
	}

	.raw-ecg-grid {
		display: flex;
		flex-wrap: wrap;
		gap: 0.55rem;
		margin-top: 0.7rem;
	}

	.raw-ecg-grid span {
		padding: 0.45rem 0.65rem;
		border-radius: 999px;
		background: var(--surface-soft);
		color: var(--text);
		font-size: 0.9rem;
		font-weight: 800;
	}

	.raw-ecg-copy {
		margin-top: 0.7rem;
		overflow-wrap: anywhere;
	}

	.respiration-panel {
		display: grid;
		gap: 0.75rem;
		margin-top: 0.9rem;
		padding: 1rem;
		border-radius: 1rem;
		background: color-mix(in srgb, var(--surface-soft) 72%, white);
		border: 1px solid rgba(160, 174, 197, 0.32);
	}

	.respiration-value {
		margin: 0.25rem 0 0;
		font-size: clamp(2rem, 5vw, 3.1rem);
		font-weight: 800;
		letter-spacing: -0.04em;
		color: var(--accent);
	}

	.respiration-value span {
		font-size: 0.9rem;
		letter-spacing: 0;
		color: var(--muted);
	}

	.respiration-meta,
	.respiration-sources {
		display: flex;
		flex-wrap: wrap;
		gap: 0.55rem;
	}

	.respiration-meta span,
	.respiration-sources span {
		padding: 0.45rem 0.65rem;
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.7);
		color: var(--text);
		font-size: 0.9rem;
		font-weight: 800;
	}

	.respiration-sources span {
		color: var(--muted);
	}

	.raw-ecg-trace {
		margin-top: 0.9rem;
		border-radius: 1rem;
		background:
			linear-gradient(rgba(0, 103, 92, 0.08) 1px, transparent 1px),
			linear-gradient(90deg, rgba(0, 103, 92, 0.08) 1px, transparent 1px),
			#07111a;
		background-size: 28px 28px;
		overflow: hidden;
	}

	.raw-ecg-trace svg {
		display: block;
		width: 100%;
		aspect-ratio: 720 / 220;
	}

	.raw-ecg-midline,
	.raw-ecg-wave {
		fill: none;
		vector-effect: non-scaling-stroke;
	}

	.raw-ecg-midline {
		stroke: rgba(193, 255, 242, 0.2);
		stroke-width: 1;
	}

	.raw-ecg-wave {
		stroke: #5bf4de;
		stroke-width: 2;
		stroke-linecap: round;
		stroke-linejoin: round;
		filter: drop-shadow(0 0 0.45rem rgba(91, 244, 222, 0.45));
	}

	.raw-ecg-log {
		display: grid;
		gap: 0.4rem;
		margin-top: 0.8rem;
	}

	.raw-ecg-log p {
		margin: 0;
		padding: 0.55rem 0.7rem;
		border-radius: 0.8rem;
		background: rgba(255, 255, 255, 0.7);
		color: var(--muted);
		font-family: ui-monospace, SFMono-Regular, Consolas, 'Liberation Mono', monospace;
		font-size: 0.82rem;
		overflow-wrap: anywhere;
	}

	.metric-grid {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 0.85rem;
		margin-top: 1rem;
	}

	.metric-card {
		padding: 1.3rem;
		border-radius: 1.8rem;
		background: color-mix(in srgb, var(--surface-soft) 75%, white);
		box-shadow: 0 8px 0 0 #dce9ff, var(--shadow-card);
	}

	.metric-label {
		margin: 0;
		font-size: 0.78rem;
		font-weight: 800;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--muted);
	}

	.metric-value {
		margin: 0.35rem 0 0;
		font-size: clamp(2rem, 5vw, 2.8rem);
		font-weight: 800;
		letter-spacing: -0.05em;
		color: var(--accent);
	}

	.metric-value.secondary {
		color: var(--secondary);
	}

	.metric-value.tertiary {
		color: var(--tertiary);
	}

	.metric-value span {
		font-size: 0.9rem;
		color: var(--muted);
	}

	@media (max-width: 1100px) {
		.hero {
			grid-template-columns: 1fr;
		}
	}

	@media (max-width: 720px) {
		.page-shell {
			padding-inline: 1rem;
		}

		.metric-grid {
			grid-template-columns: 1fr;
		}

		.control-row {
			flex-direction: column;
		}

		.button {
			width: 100%;
		}

		.viewer-card {
			padding: 1.1rem;
			border-radius: 1.4rem;
		}

		.ecg-card {
			padding: 1.1rem;
			border-radius: 1.5rem;
		}
	}
</style>
