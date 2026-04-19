<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import riveCanvas from '@rive-app/canvas';
	import otterRiv from '../../assets/otter_boy.riv?url';

	type Variant = 'card' | 'hero' | 'stacked';
	let { variant = 'card' }: { variant?: Variant } = $props();

	type RiveInstance = InstanceType<(typeof riveCanvas)['Rive']>;
	type ViewModelInstance = InstanceType<(typeof riveCanvas)['ViewModelInstance']>;
	const { Rive } = riveCanvas;

	const ARTBOARD = 'Artboard';
	const STATE_MACHINE = 'State Machine 1';
	const VIEW_MODEL = 'ViewModel1';
	const VIEW_MODEL_INSTANCE = 'Instance';
	const CLICK_TRIGGER = 'on_click';

	let canvas: HTMLCanvasElement;
	let host: HTMLDivElement;
	let rive: RiveInstance | null = null;
	let viewModelInstance: ViewModelInstance | null = null;
	let resizeObserver: ResizeObserver | null = null;
	let isLoaded = $state(false);
	let loadError = $state('');

	function resizeSurface() {
		rive?.resizeDrawingSurfaceToCanvas();
	}

	function resolveViewModelInstance() {
		const viewModel = rive?.viewModelByName(VIEW_MODEL);
		viewModelInstance =
			viewModel?.instanceByName(VIEW_MODEL_INSTANCE) ?? viewModel?.defaultInstance() ?? null;
		rive?.bindViewModelInstance(viewModelInstance);
	}

	function fireOnClick() {
		viewModelInstance?.trigger(CLICK_TRIGGER)?.trigger();
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key !== 'Enter' && event.key !== ' ') {
			return;
		}

		event.preventDefault();
		fireOnClick();
	}

	onMount(() => {
		rive = new Rive({
			src: otterRiv,
			canvas,
			artboard: ARTBOARD,
			stateMachines: STATE_MACHINE,
			autoplay: true,
			onLoad: () => {
				isLoaded = true;
				loadError = '';
				resolveViewModelInstance();
				rive?.setupRiveListeners();
				resizeSurface();
			},
			onLoadError: (event) => {
				loadError = typeof event?.data === 'string' ? event.data : 'Unable to load Oy.';
			}
		});

		resizeObserver = new ResizeObserver(() => {
			resizeSurface();
		});
		resizeObserver.observe(host);

		window.addEventListener('resize', resizeSurface);

		return () => {
			window.removeEventListener('resize', resizeSurface);
			resizeObserver?.disconnect();
			resizeObserver = null;
		};
	});

	onDestroy(() => {
		rive?.removeRiveListeners();
		rive?.cleanup();
		rive = null;
		viewModelInstance?.cleanup();
		viewModelInstance = null;
	});
</script>

<div class:rive-card={variant === 'card' || variant === 'stacked'} class:rive-hero={variant === 'hero'} class:rive-stacked={variant === 'stacked'}>
	<div
		bind:this={host}
		class="rive-shell"
		role="button"
		tabindex="0"
		onkeydown={handleKeydown}
		aria-label="Tap Oy to animate"
	>
		<canvas bind:this={canvas} class="rive-canvas" width={500} height={369}></canvas>
	</div>

	{#if variant === 'card'}
		<div class="rive-copy">
			<p class="rive-title">Tap Oy</p>
			<p class="rive-subtitle">
				A quick click plays Oy&apos;s reaction while the chat stays ready below.
			</p>
			{#if loadError}
				<p class="rive-status rive-status-error">{loadError}</p>
			{:else if !isLoaded}
				<p class="rive-status">Loading Oy...</p>
			{/if}
		</div>
	{:else}
		{#if loadError}
			<p class="rive-hero-status rive-status-error">{loadError}</p>
		{:else if !isLoaded}
			<p class="rive-hero-status">Loading Oy...</p>
		{/if}
	{/if}
</div>

<style>
	.rive-hero {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		padding: 1.5rem;
	}

	.rive-card {
		display: grid;
		grid-template-columns: minmax(0, 13rem) minmax(0, 1fr);
		gap: 1rem;
		align-items: center;
		margin-top: 1rem;
		padding: 1rem;
		border-radius: 1.6rem;
		background:
			radial-gradient(circle at top left, rgba(255, 255, 255, 0.65), transparent 52%),
			linear-gradient(135deg, rgba(255, 255, 255, 0.72), rgba(211, 228, 255, 0.62));
		border: 1px solid rgba(160, 174, 197, 0.26);
	}

	.rive-shell {
		width: 100%;
		padding: 0;
		border: 0;
		border-radius: 1.35rem;
		background:
			radial-gradient(circle at top, rgba(255, 255, 255, 0.78), transparent 58%),
			linear-gradient(180deg, rgba(255, 255, 255, 0.92), rgba(234, 241, 255, 0.95));
		box-shadow: 0 12px 24px rgba(31, 47, 82, 0.08);
		cursor: pointer;
		overflow: hidden;
	}

	.rive-hero .rive-shell {
		width: min(100%, 36rem);
		background: transparent;
		box-shadow: none;
	}

	.rive-shell:focus-visible {
		outline: 3px solid rgba(0, 103, 92, 0.28);
		outline-offset: 4px;
	}

	.rive-canvas {
		display: block;
		width: 100%;
		height: auto;
		aspect-ratio: 500 / 369;
	}

	.rive-copy {
		display: grid;
		gap: 0.35rem;
	}

	.rive-stacked {
		grid-template-columns: 1fr;
	}

	.rive-stacked .rive-copy {
		order: -1;
	}

	.rive-hero-status {
		position: absolute;
		left: 50%;
		bottom: 1.5rem;
		transform: translateX(-50%);
		margin: 0;
		padding: 0.45rem 0.75rem;
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.78);
		color: var(--on-surface-variant);
		font-size: 0.85rem;
		font-weight: 600;
	}

	.rive-title,
	.rive-subtitle,
	.rive-status {
		margin: 0;
	}

	.rive-title {
		font-size: 0.85rem;
		font-weight: 800;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--primary);
	}

	.rive-subtitle,
	.rive-status {
		line-height: 1.55;
		color: var(--on-surface-variant);
	}

	.rive-status-error {
		color: var(--error);
	}

	@media (max-width: 720px) {
		.rive-card {
			grid-template-columns: 1fr;
		}
	}

	@media (max-width: 980px) {
		.rive-card {
			grid-template-columns: 1fr;
		}

		.rive-copy {
			order: -1;
		}
	}
</style>
