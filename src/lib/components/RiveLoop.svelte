<script lang="ts">
	import { onDestroy, onMount } from 'svelte';

	type RiveModule = typeof import('@rive-app/canvas');
	type RiveInstance = InstanceType<RiveModule['Rive']>;

	let {
		src,
		artboard,
		fit = 'contain',
		containerClass = '',
		ariaLabel = 'Animated illustration'
	}: {
		src: string;
		artboard?: string;
		fit?: 'contain' | 'cover' | 'fill';
		containerClass?: string;
		ariaLabel?: string;
	} = $props();

	let canvas: HTMLCanvasElement;
	let host: HTMLDivElement;
	let rive: RiveInstance | null = null;
	let resizeObserver: ResizeObserver | null = null;
	let loadError = $state('');

	function resizeSurface() {
		rive?.resizeDrawingSurfaceToCanvas();
	}

	onMount(() => {
		let disposed = false;

		void import('@rive-app/canvas')
			.then((riveCanvas) => {
				if (disposed) {
					return;
				}

				const { Alignment, Fit, Layout, Rive } = riveCanvas;
				const fitMode =
					fit === 'cover' ? Fit.Cover : fit === 'fill' ? Fit.Fill : Fit.Contain;

				rive = new Rive({
					src,
					canvas,
					artboard,
					autoplay: true,
					layout: new Layout({
						fit: fitMode,
						alignment: Alignment.Center
					}),
					shouldDisableRiveListeners: true,
					onLoad: () => {
						loadError = '';
						resizeSurface();
					},
					onLoadError: (event) => {
						loadError =
							typeof event?.data === 'string' ? event.data : 'Unable to load animation.';
					}
				});

				resizeObserver = new ResizeObserver(() => {
					resizeSurface();
				});
				resizeObserver.observe(host);

				window.addEventListener('resize', resizeSurface);
			})
			.catch((error) => {
				loadError = error instanceof Error ? error.message : 'Unable to load animation.';
			});

		return () => {
			disposed = true;
			window.removeEventListener('resize', resizeSurface);
			resizeObserver?.disconnect();
			resizeObserver = null;
		};
	});

	onDestroy(() => {
		rive?.cleanup();
		rive = null;
	});
</script>

<div
	bind:this={host}
	class={`rive-loop ${containerClass}`.trim()}
	role="img"
	aria-label={ariaLabel}
>
	<canvas
		bind:this={canvas}
		class="rive-loop-canvas"
		width={640}
		height={640}
		aria-hidden="true"
	></canvas>

	{#if loadError}
		<p class="rive-loop-status">{loadError}</p>
	{/if}
</div>

<style>
	.rive-loop {
		position: relative;
		width: 100%;
		height: 100%;
	}

	.rive-loop-canvas {
		display: block;
		width: 100%;
		height: 100%;
		border-radius: inherit;
	}

	.rive-loop-status {
		position: absolute;
		left: 50%;
		bottom: 1rem;
		transform: translateX(-50%);
		margin: 0;
		padding: 0.4rem 0.75rem;
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.88);
		color: var(--error, #8c2f39);
		font-size: 0.85rem;
		font-weight: 600;
		text-align: center;
	}
</style>
