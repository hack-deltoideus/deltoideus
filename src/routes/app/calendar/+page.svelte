<script lang="ts">
	import { browser } from '$app/environment';
	import { onMount } from 'svelte';
	import AppSectionNav from '$lib/components/AppSectionNav.svelte';
	import { hasSupabaseConfig, supabase } from '$lib/supabase';
	import type { Session, User } from '@supabase/supabase-js';

	type SupabaseLikeError = {
		message?: string;
		details?: string;
		hint?: string;
		code?: string;
	};

	type OAuthProvider = 'google';

	type CalendarDay = {
		day: number | null;
		active?: boolean;
		hasDot?: boolean;
	};

	let currentSession = $state<Session | null>(null);
	let currentUser = $state<User | null>(null);
	let authStatus = $state('');
	let isSigningIn = $state<OAuthProvider | null>(null);

	const monthLabel = 'October 2023';
	const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
	const calendarDays: CalendarDay[] = [
		{ day: null },
		{ day: null },
		{ day: null },
		{ day: null },
		{ day: 1 },
		{ day: 2, hasDot: true },
		{ day: 3, hasDot: true },
		{ day: 4 },
		{ day: 5, hasDot: true },
		{ day: 6 },
		{ day: 7 },
		{ day: 8, hasDot: true },
		{ day: 9, active: true, hasDot: true },
		{ day: 10 },
		{ day: 11, hasDot: true },
		{ day: 12 },
		{ day: 13, hasDot: true },
		{ day: 14, hasDot: true },
		{ day: 15 },
		{ day: 16 },
		{ day: 17, hasDot: true },
		{ day: 18 },
		{ day: 19, hasDot: true },
		{ day: 20 },
		{ day: 21, hasDot: true },
		{ day: 22 },
		{ day: 23, hasDot: true },
		{ day: 24 }
	];

	onMount(() => {
		if (!supabase) {
			return;
		}

		void supabase.auth.getSession().then(({ data, error }) => {
			if (error) {
				authStatus = describeError(error, 'Failed to restore session.');
				return;
			}

			currentSession = data.session;
			currentUser = data.session?.user ?? null;
		});

		const {
			data: { subscription }
		} = supabase.auth.onAuthStateChange((_event, session) => {
			currentSession = session;
			currentUser = session?.user ?? null;
			authStatus = '';
		});

		return () => {
			subscription.unsubscribe();
		};
	});

	function describeError(error: unknown, fallback: string): string {
		if (error instanceof Error && error.message) {
			return error.message;
		}

		if (error && typeof error === 'object') {
			const candidate = error as SupabaseLikeError;
			const parts = [candidate.message, candidate.details, candidate.hint].filter(Boolean);
			if (parts.length > 0) {
				return parts.join(' ');
			}

			if (candidate.code) {
				return `${fallback} (${candidate.code})`;
			}
		}

		return fallback;
	}

	async function signInWithProvider(provider: OAuthProvider) {
		if (!supabase || !browser || isSigningIn) {
			return;
		}

		isSigningIn = provider;
		authStatus = '';

		try {
			const { error } = await supabase.auth.signInWithOAuth({
				provider,
				options: {
					redirectTo: `${window.location.origin}/app/calendar`
				}
			});

			if (error) {
				throw error;
			}
		} catch (error) {
			authStatus = describeError(error, `Failed to sign in with ${provider}.`);
		} finally {
			isSigningIn = null;
		}
	}
</script>

<svelte:head>
	<title>Sanctuary | Calendar</title>
</svelte:head>

{#if !currentUser}
	<main class="auth-shell">
		<section class="auth-card">
			<p class="eyebrow">Calendar</p>
			<h1>Sign in to open your calendar view.</h1>
			<p class="auth-copy">
				See how your check-ins cluster across the month and jump back into your recent history from one place.
			</p>

			<div class="auth-actions">
				<button class="button" onclick={() => signInWithProvider('google')} disabled={isSigningIn !== null || !hasSupabaseConfig}>
					{isSigningIn === 'google' ? 'Connecting Google...' : 'Continue with Google'}
				</button>
				<a class="button button-subtle" href="/app/history">Back to history</a>
			</div>

			{#if !hasSupabaseConfig}
				<p class="inline-hint">Set `PUBLIC_SUPABASE_URL` and `PUBLIC_SUPABASE_ANON_KEY` in `.env` first.</p>
			{/if}

			{#if authStatus}
				<p class="inline-status">{authStatus}</p>
			{/if}
		</section>
	</main>
{:else}
	<main class="calendar-page">
		<section class="calendar-frame">
			<header class="page-head">
				<div>
					<p class="eyebrow">Sanctuary Calendar</p>
					<h1>Visualize your journey to inner peace.</h1>
				</div>
				<a class="back-link" href="/app/history">
					<span class="material-symbols-outlined">history</span>
					<span>Back to history</span>
				</a>
			</header>

			<AppSectionNav />

			<div class="calendar-layout">
				<section class="calendar-main">
					<div class="month-bar">
						<button type="button" aria-label="Previous month">
							<span class="material-symbols-outlined">chevron_left</span>
						</button>
						<strong>{monthLabel}</strong>
						<button type="button" aria-label="Next month">
							<span class="material-symbols-outlined">chevron_right</span>
						</button>
					</div>

					<div class="calendar-card">
						<div class="calendar-grid weekday-row">
							{#each dayNames as day}
								<div>{day}</div>
							{/each}
						</div>

						<div class="calendar-grid day-grid">
							{#each calendarDays as cell}
								<div class="day-cell">
									{#if cell.day}
										<div class:active={cell.active} class="day-pill">{cell.day}</div>
										{#if cell.hasDot}
											<div class="day-dot"></div>
										{/if}
									{/if}
								</div>
							{/each}
						</div>
					</div>

					<div class="insight-grid">
						<article class="mini-card primary">
							<div class="icon-wrap">
								<span class="material-symbols-outlined">auto_awesome</span>
							</div>
							<div>
								<h3>Consistent Streak!</h3>
								<p>You've checked in for 5 days straight. Your focus is improving.</p>
							</div>
						</article>

						<article class="mini-card tertiary">
							<div class="icon-wrap">
								<span class="material-symbols-outlined filled">lightbulb</span>
							</div>
							<div>
								<h3>Sanctuary Tip</h3>
								<p>Tuesdays are your most active days. Try a deeper meditation next week.</p>
							</div>
						</article>
					</div>
				</section>

				<aside class="summary-panel">
					<h2>October Summary</h2>

					<div class="stat-stack">
						<div class="stat-card primary-border">
							<p>Total Activity</p>
							<div>
								<strong>14</strong>
								<span>Sessions</span>
							</div>
						</div>

						<div class="stat-card tertiary-border">
							<p>Average Mood</p>
							<div class="mood-row">
								<span class="material-symbols-outlined filled">sentiment_very_satisfied</span>
								<strong>Happy</strong>
							</div>
						</div>

						<div class="stat-card secondary-border">
							<p>Mindful Minutes</p>
							<div>
								<strong>320</strong>
								<span>min</span>
							</div>
						</div>
					</div>

					<div class="quote-stack">
						<h3>Journal Highlights</h3>
						<div class="quote-card">
							<p>"Felt a great sense of calm after the forest soundscape session today."</p>
							<span>OCT 09</span>
						</div>
						<div class="quote-card">
							<p>"Grateful for the support system I've built this month."</p>
							<span>OCT 06</span>
						</div>
					</div>
				</aside>
			</div>
		</section>
	</main>
{/if}

<style>
	:global(body) {
		margin: 0;
		font-family: 'Plus Jakarta Sans', sans-serif;
		background:
			radial-gradient(circle at top left, rgba(91, 244, 222, 0.22), transparent 25%),
			radial-gradient(circle at top right, rgba(183, 211, 255, 0.82), transparent 28%),
			linear-gradient(180deg, #f8fbff 0%, #f4f6ff 42%, #edf4ff 100%);
		color: #212f42;
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

	.filled {
		font-variation-settings:
			'FILL' 1,
			'wght' 500,
			'GRAD' 0,
			'opsz' 24;
	}

	.auth-shell {
		min-height: calc(100vh - 5rem);
		display: grid;
		place-items: center;
		padding: 1.5rem;
	}

	.auth-card,
	.calendar-card,
	.summary-panel,
	.mini-card,
	.stat-card {
		background: rgba(255, 255, 255, 0.84);
		border: 1px solid rgba(160, 174, 197, 0.24);
		box-shadow: 0 20px 45px rgba(31, 47, 82, 0.08);
		backdrop-filter: blur(18px);
	}

	.auth-card {
		width: min(100%, 44rem);
		padding: 2rem;
		border-radius: 2rem;
	}

	.eyebrow {
		margin: 0;
		font-size: 0.78rem;
		font-weight: 800;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		color: #00675c;
	}

	.auth-card h1,
	.page-head h1 {
		margin: 0.35rem 0 0;
		line-height: 0.96;
		letter-spacing: -0.04em;
	}

	.auth-card h1 {
		font-size: clamp(2.2rem, 5vw, 4rem);
		color: #00675c;
	}

	.auth-copy,
	.inline-hint,
	.inline-status,
	.page-head p,
	.mini-card p,
	.quote-card p,
	.stat-card p {
		margin: 0;
		line-height: 1.55;
		color: #4e5c71;
	}

	.auth-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.85rem;
		margin-top: 1.5rem;
	}

	.button,
	.button-subtle,
	.back-link,
	.month-bar button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.55rem;
		border: none;
		border-radius: 999px;
		padding: 0.95rem 1.3rem;
		text-decoration: none;
		font: inherit;
		font-weight: 800;
		cursor: pointer;
	}

	.button {
		background: linear-gradient(135deg, #00675c, #128d7f);
		color: #ffffff;
		box-shadow: 0 6px 0 rgba(0, 103, 92, 0.22);
	}

	.button-subtle,
	.back-link {
		background: rgba(201, 222, 255, 0.7);
		color: #212f42;
	}

	.calendar-page {
		padding: 1.2rem 1.5rem 1.6rem;
	}

	.calendar-frame {
		display: grid;
		gap: 1.35rem;
		max-width: 96rem;
		margin: 0 auto;
	}

	.page-head {
		display: flex;
		align-items: end;
		justify-content: space-between;
		gap: 1rem;
		padding-top: 0.4rem;
	}

	.page-head h1 {
		font-size: clamp(2.5rem, 5vw, 4.5rem);
		color: #212f42;
		max-width: 38rem;
	}

	.calendar-layout {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 22rem;
		gap: 1.5rem;
		align-items: start;
	}

	.calendar-main {
		display: grid;
		gap: 1.25rem;
	}

	.month-bar {
		display: inline-flex;
		align-items: center;
		gap: 0.8rem;
		padding: 0.45rem;
		border-radius: 999px;
		background: rgba(234, 241, 255, 0.96);
		width: fit-content;
	}

	.month-bar button {
		width: 2.9rem;
		height: 2.9rem;
		padding: 0;
		background: transparent;
		color: #212f42;
	}

	.month-bar strong {
		padding: 0 0.8rem;
		font-size: 1.2rem;
	}

	.calendar-card,
	.summary-panel,
	.mini-card {
		border-radius: 2rem;
		padding: 1.6rem;
	}

	.calendar-grid {
		display: grid;
		grid-template-columns: repeat(7, minmax(0, 1fr));
	}

	.weekday-row {
		margin-bottom: 1.5rem;
	}

	.weekday-row div {
		text-align: center;
		font-size: 0.78rem;
		font-weight: 800;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: #6a788d;
	}

	.day-grid {
		row-gap: 1.75rem;
	}

	.day-cell {
		min-height: 5rem;
		display: flex;
		flex-direction: column;
		align-items: center;
	}

	.day-pill {
		width: 3rem;
		height: 3rem;
		display: grid;
		place-items: center;
		border-radius: 999px;
		font-weight: 700;
		color: #212f42;
	}

	.day-pill.active {
		background: #5bf4de;
		color: #00594f;
		box-shadow: 0 10px 24px rgba(0, 103, 92, 0.12);
	}

	.day-dot {
		width: 0.4rem;
		height: 0.4rem;
		margin-top: 0.35rem;
		border-radius: 999px;
		background: #00675c;
	}

	.insight-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 1rem;
	}

	.mini-card {
		display: flex;
		align-items: center;
		gap: 1rem;
	}

	.mini-card.primary {
		background: rgba(91, 244, 222, 0.16);
	}

	.mini-card.tertiary {
		background: rgba(252, 192, 37, 0.16);
	}

	.icon-wrap {
		width: 4rem;
		height: 4rem;
		display: grid;
		place-items: center;
		border-radius: 999px;
		background: #00675c;
		color: white;
		flex-shrink: 0;
	}

	.mini-card.tertiary .icon-wrap {
		background: #fcc025;
		color: #3d2b00;
	}

	.mini-card h3,
	.summary-panel h2,
	.quote-stack h3 {
		margin: 0;
	}

	.summary-panel {
		display: grid;
		gap: 1.2rem;
	}

	.summary-panel h2 {
		font-size: 1.5rem;
	}

	.stat-stack,
	.quote-stack {
		display: grid;
		gap: 0.9rem;
	}

	.stat-card {
		padding: 1.2rem;
		border-radius: 1.45rem;
		border-bottom-width: 4px;
		border-bottom-style: solid;
	}

	.primary-border {
		border-bottom-color: #00675c;
	}

	.tertiary-border {
		border-bottom-color: #fcc025;
	}

	.secondary-border {
		border-bottom-color: #b7d3ff;
	}

	.stat-card p {
		font-size: 0.74rem;
		font-weight: 800;
		letter-spacing: 0.14em;
		text-transform: uppercase;
	}

	.stat-card div {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
		margin-top: 0.4rem;
	}

	.stat-card strong {
		font-size: 2.6rem;
		line-height: 1;
	}

	.stat-card span {
		color: #4e5c71;
		font-weight: 600;
	}

	.mood-row {
		align-items: center;
	}

	.mood-row .material-symbols-outlined {
		font-size: 2rem;
		color: #755600;
	}

	.quote-card {
		padding: 1rem 1.1rem;
		border-radius: 1.25rem;
		background: rgba(255, 255, 255, 0.54);
	}

	.quote-card span {
		display: block;
		margin-top: 0.55rem;
		font-size: 0.7rem;
		font-weight: 800;
		letter-spacing: 0.12em;
		color: #00675c;
	}

	@media (max-width: 980px) {
		.calendar-layout {
			grid-template-columns: 1fr;
		}
	}

	@media (max-width: 780px) {
		.calendar-page {
			padding-inline: 1rem;
		}

		.page-head {
			flex-direction: column;
			align-items: start;
		}

		.insight-grid {
			grid-template-columns: 1fr;
		}
	}
</style>
