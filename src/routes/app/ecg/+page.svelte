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
	import {
		connectPolarMonitor,
		POLAR_H10_ECG_SAMPLE_RATE_HZ,
		type PolarMonitorConnection
	} from '$lib/polar';
	import {
		RespiratoryRateEstimator,
		type RespiratoryRateEstimate
	} from '$lib/respiration';
	let waveformSessionKey = $state(0);
	let nowMs = $state(Date.now());
	let lastReadingAtMs = $state<number | null>(null);
	let lastEcgPacketAtMs = $state<number | null>(null);
	let latestHeartRate = $state<number | null>(null);
	let latestRrMs = $state<number | null>(null);
	let latestEcgSamples = $state<number[] | null>(null);
	let latestRespiration = $state<RespiratoryRateEstimate | null>(null);
	let ecgPacketCount = $state(0);
	let ecgSampleCount = $state(0);
	let deviceName = $state('Polar H10');
	let heartRateStreamStatus = $state('Idle');
	let ecgStreamStatus = $state('Idle');
	let canUseBluetooth = $state(false);
	let isConnecting = $state(false);
	let isSensorConnected = $state(false);
	let sensorStatus = $state('No live device connected.');
	let sensorConnection = $state<PolarMonitorConnection | null>(null);
	const respirationEstimator = new RespiratoryRateEstimator({
		sampleRateHz: POLAR_H10_ECG_SAMPLE_RATE_HZ
	});

	const ecgSignalIsLive = $derived(lastEcgPacketAtMs !== null && nowMs - lastEcgPacketAtMs < 2500);
	const signalIsLive = $derived(
		ecgSignalIsLive || (lastReadingAtMs !== null && nowMs - lastReadingAtMs < 2500)
	);
	const signalLabel = $derived(signalIsLive ? 'LIVE' : 'IDLE');
	const signalCopy = $derived(
		isSensorConnected
			? 'Streaming raw Polar H10 ECG with HR/RR support into the live visual.'
			: 'Monitor is on live standby and will react as soon as the H10 starts sending data.'
	);
	const connectionLabel = $derived(isSensorConnected ? 'CONNECTED' : 'STANDBY');

	function formatConfidencePercent(value: number | null | undefined): string {
		if (typeof value !== 'number') {
			return '--';
		}

		return `${Math.round(value * 100)}%`;
	}

	onMount(() => {
		canUseBluetooth = typeof navigator !== 'undefined' && 'bluetooth' in navigator;
		const clock = window.setInterval(() => {
			nowMs = Date.now();
		}, 250);

		const unsubscribe = subscribeLiveEcgReadings((reading) => {
			handleLiveReading(reading);
		});

		return () => {
			window.clearInterval(clock);
			if (sensorConnection) {
				void sensorConnection.disconnect();
			}
			unsubscribe();
		};
	});

	function handleLiveReading(reading: LiveEcgReading) {
		lastReadingAtMs = reading.receivedAtMs;
		if (typeof reading.heartRate === 'number') {
			latestHeartRate = reading.heartRate;
		}

		if (typeof reading.rrMs === 'number') {
			latestRrMs = reading.rrMs;
		}

		if (reading.ecgSamplesMicrovolts?.length) {
			lastEcgPacketAtMs = reading.receivedAtMs;
			latestEcgSamples = reading.ecgSamplesMicrovolts;
			ecgPacketCount += 1;
			ecgSampleCount += reading.ecgSamplesMicrovolts.length;
			latestRespiration = respirationEstimator.addSamples(reading.ecgSamplesMicrovolts);
		}
	}

	async function connectDevice() {
		if (!canUseBluetooth || isConnecting || isSensorConnected) {
			return;
		}

		isConnecting = true;
		sensorStatus = 'Connecting to Polar H10...';

		try {
			const connection = await connectPolarMonitor({
				onDevice: (name) => {
					deviceName = name;
				},
				onHeartRateStatus: (status) => {
					heartRateStreamStatus = status;
				},
				onEcgStatus: (status) => {
					ecgStreamStatus = status;
				},
				onDisconnected: () => {
					isSensorConnected = false;
					sensorConnection = null;
					sensorStatus = 'Device disconnected.';
				},
				onHeartRate: (reading) => {
					const nextReading: LiveEcgReading = {
						heartRate: reading.heartRate,
						rrMs: reading.rrMs ?? Math.round(60000 / Math.max(reading.heartRate, 1)),
						receivedAtMs: Date.now()
					};

					publishLiveEcgReading(nextReading);
				},
				onEcgPacket: (packet) => {
					const samples = packet.samples.map((sample) => sample.microvolts);
					publishLiveEcgReading({
						receivedAtMs: Date.now(),
						ecgSamplesMicrovolts: samples,
						ecgSampleRateHz: POLAR_H10_ECG_SAMPLE_RATE_HZ
					});
				}
			});
			await connection.start();
			sensorConnection = connection;

			isSensorConnected = true;
			waveformSessionKey += 1;
			respirationEstimator.reset();
			latestRespiration = null;
			ecgPacketCount = 0;
			ecgSampleCount = 0;
			sensorStatus = 'Connected. Streaming raw ECG, HR, and RR from the Polar H10.';
		} catch (error) {
			sensorStatus =
				error instanceof Error ? error.message : 'Could not connect to Polar H10.';
		} finally {
			isConnecting = false;
		}
	}

	async function disconnectDevice() {
		if (!sensorConnection) {
			return;
		}

		await sensorConnection.disconnect();
		sensorConnection = null;
		isSensorConnected = false;
		lastEcgPacketAtMs = null;
		latestEcgSamples = null;
		latestRespiration = null;
		heartRateStreamStatus = 'Stopped';
		ecgStreamStatus = 'Stopped';
		ecgPacketCount = 0;
		ecgSampleCount = 0;
		respirationEstimator.reset();
		sensorStatus = 'Disconnected. ECG monitor is back to flatline standby.';
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
				This screen is now dedicated to the live Polar H10 ECG waveform. It keeps the same
				soft monitor treatment, but the live trace is built from raw ECG samples when the belt
				is streaming.
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
					HR/RR fallback while needed, and raw ECG samples once the H10 PMD stream is active.
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
			>
				<span class="material-symbols-outlined">bluetooth</span>
				<span>{isConnecting ? 'Connecting...' : 'Connect Device'}</span>
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

		<div class="stream-status-grid">
			<div class="stream-status-card">
				<p class="metric-label">DEVICE</p>
				<p class="stream-status-value">{deviceName}</p>
			</div>
			<div class="stream-status-card">
				<p class="metric-label">HEART STREAM</p>
				<p class="stream-status-value">{heartRateStreamStatus}</p>
			</div>
			<div class="stream-status-card">
				<p class="metric-label">RAW ECG STREAM</p>
				<p class="stream-status-value">{ecgStreamStatus}</p>
			</div>
			<div class="stream-status-card">
				<p class="metric-label">ECG PACKETS</p>
				<p class="stream-status-value">{ecgPacketCount} <span>{ecgSampleCount} samples</span></p>
			</div>
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
					<span>Polar H10</span>
				</div>
			</div>

			<div class="monitor-shell">
				<HeartWaveform
					hr={latestHeartRate}
					rr={latestRrMs}
					ecgSamples={latestEcgSamples}
					ecgSampleAtMs={lastEcgPacketAtMs}
					ecgSampleRateHz={POLAR_H10_ECG_SAMPLE_RATE_HZ}
					sampleAtMs={lastReadingAtMs}
					sessionKey={waveformSessionKey}
					label="Raw ECG waveform"
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
				<p class="metric-label">RESPIRATORY RATE</p>
				<p class="metric-value respiratory">{latestRespiration?.breathsPerMinute ?? '--'}<span> BR/MIN</span></p>
				<p class="metric-subcopy">
					{latestRespiration
						? `${latestRespiration.qualityLabel} · ${formatConfidencePercent(latestRespiration.confidence)} confidence · inst ${formatConfidencePercent(latestRespiration.diagnostics.instantConfidence)} · evidence ${formatConfidencePercent(latestRespiration.diagnostics.boostedEvidenceConfidence)} · promote ${formatConfidencePercent(latestRespiration.diagnostics.confidencePromotionProgress)} · stable ${latestRespiration.diagnostics.consecutiveStableSegmentCount}/${latestRespiration.diagnostics.totalSegmentCount} seg · ${latestRespiration.peakCount} peaks`
						: 'waiting for raw ECG'}
				</p>
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

	.stream-status-grid {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 0.75rem;
		margin-top: 0.85rem;
	}

	.stream-status-card {
		padding: 0.9rem 1rem;
		border-radius: 1.2rem;
		background: rgba(255, 255, 255, 0.72);
		border: 1px solid rgba(160, 174, 197, 0.3);
	}

	.stream-status-value {
		margin: 0.2rem 0 0;
		color: var(--text);
		font-size: 1rem;
		font-weight: 800;
	}

	.stream-status-value span {
		color: var(--muted);
		font-size: 0.78rem;
	}

	.metric-grid {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
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

	.metric-value.respiratory {
		color: #7a2d63;
	}

	.metric-value span {
		font-size: 0.9rem;
		color: var(--muted);
	}

	.metric-subcopy {
		margin: 0.2rem 0 0;
		color: var(--muted);
		font-size: 0.82rem;
		font-weight: 800;
		text-transform: uppercase;
	}

	@media (max-width: 1100px) {
		.hero {
			grid-template-columns: 1fr;
		}

		.stream-status-grid,
		.metric-grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}

	@media (max-width: 720px) {
		.page-shell {
			padding-inline: 1rem;
		}

		.metric-grid {
			grid-template-columns: 1fr;
		}

		.stream-status-grid {
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
