<script lang="ts">
	import { page } from '$app/state';

	const pathname = $derived(page.url.pathname);

	function isActive(target: string): boolean {
		return pathname === target;
	}
</script>

<nav class="section-nav" aria-label="App sections">
	<a class:active={isActive('/app')} class="section-link" href="/app">
		<span class="material-symbols-outlined">dashboard</span>
		<span>Dashboard</span>
	</a>
	<a class:active={isActive('/app/sensor')} class="section-link" href="/app/sensor">
		<span class="material-symbols-outlined">monitor_heart</span>
		<span>Live Data</span>
	</a>
	<a class:active={isActive('/app/coach')} class="section-link" href="/app/coach">
		<span class="material-symbols-outlined">psychology</span>
		<span>AI Coach</span>
	</a>
</nav>

<style>
	.section-nav {
		display: flex;
		flex-wrap: wrap;
		gap: 0.85rem;
		margin: 1.25rem 0 0;
	}

	.section-link {
		display: inline-flex;
		align-items: center;
		gap: 0.55rem;
		padding: 0.8rem 1rem;
		border-radius: 999px;
		text-decoration: none;
		font-weight: 700;
		color: var(--on-surface, #212f42);
		background: color-mix(in srgb, var(--surface-container, #dce9ff) 72%, white);
		border: 1px solid color-mix(in srgb, var(--outline-variant, #a0aec5) 62%, transparent);
		box-shadow: 0 10px 24px rgba(31, 47, 82, 0.08);
		transition:
			transform 0.18s ease,
			background 0.18s ease,
			border-color 0.18s ease;
	}

	.section-link:hover {
		transform: translateY(-1px);
	}

	.section-link.active {
		background: var(--primary, #00675c);
		color: var(--on-primary, #c1fff2);
		border-color: transparent;
	}

	@media (max-width: 640px) {
		.section-nav {
			gap: 0.65rem;
		}

		.section-link {
			width: 100%;
			justify-content: center;
		}
	}
</style>
