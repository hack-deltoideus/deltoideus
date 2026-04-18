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

	type TrendPoint = {
		day: string;
		value: number;
	};

	type HistoryEntry = {
		time: string;
		title: string;
		icon: string;
		tone?: 'calm' | 'alert' | 'muted';
		tags: string[];
		path: string;
	};

	type HistoryGroup = {
		dayLabel: string;
		summary: string;
		moodIcon: string;
		tone: 'calm' | 'alert' | 'balanced';
		entries?: HistoryEntry[];
		collapsedNote?: string;
	};

	let currentSession = $state<Session | null>(null);
	let currentUser = $state<User | null>(null);
	let authStatus = $state('');
	let isSigningIn = $state<OAuthProvider | null>(null);

	const displayName = $derived(getDisplayName(currentUser));
	const streakDays = 12;

	const trendPoints: TrendPoint[] = [
		{ day: 'Mon', value: 74 },
		{ day: 'Tue', value: 38 },
		{ day: 'Wed', value: 58 },
		{ day: 'Thu', value: 26 },
		{ day: 'Fri', value: 48 },
		{ day: 'Sat', value: 34 },
		{ day: 'Sun', value: 16 }
	];

	const historyGroups: HistoryGroup[] = [
		{
			dayLabel: 'Yesterday',
			summary: 'Daily average: Focused and happy',
			moodIcon: 'sentiment_very_satisfied',
			tone: 'calm',
			entries: [
				{
					time: '2:30 PM',
					title: 'Deep Focus Session',
					icon: 'bolt',
					tags: ['15m Flow', 'HR 62 bpm'],
					path: 'M0,28 L24,22 L48,30 L72,10 L96,18 L120,6 L144,24 L168,14 L192,28 L216,12 L240,18'
				},
				{
					time: '10:15 AM',
					title: 'Morning Mindfulness',
					icon: 'self_improvement',
					tags: ['Calm Breath'],
					path: 'M0,20 Q60,2 120,18 T240,20'
				}
			]
		},
		{
			dayLabel: 'October 24',
			summary: 'Daily average: High stress',
			moodIcon: 'sentiment_dissatisfied',
			tone: 'alert',
			entries: [
				{
					time: '4:45 PM',
					title: 'Anxiety Spike',
					icon: 'warning',
					tone: 'alert',
					tags: ['Immediate action required'],
					path: 'M0,30 L18,4 L36,30 L54,4 L72,30 L90,4 L108,30 L126,4 L144,30 L162,4 L240,4'
				},
				{
					time: '8:00 AM',
					title: 'Neutral Wake-up',
					icon: 'bedtime',
					tone: 'muted',
					tags: ['7h Sleep'],
					path: 'M0,20 L240,20'
				}
			]
		},
		{
			dayLabel: 'October 23',
			summary: 'Daily average: Balanced',
			moodIcon: 'sentiment_neutral',
			tone: 'balanced',
			collapsedNote: '3 logs recorded on this day. Tap to expand history.'
		}
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

	function getDisplayName(user: User | null): string {
		if (!user) {
			return 'Friend';
		}

		const metadata = user.user_metadata as Record<string, unknown> | undefined;
		const fullName = typeof metadata?.full_name === 'string' ? metadata.full_name.trim() : '';
		const name = typeof metadata?.name === 'string' ? metadata.name.trim() : '';
		const givenName = typeof metadata?.given_name === 'string' ? metadata.given_name.trim() : '';

		if (givenName) {
			return givenName;
		}

		if (fullName) {
			return fullName.split(' ')[0] ?? fullName;
		}

		if (name) {
			return name.split(' ')[0] ?? name;
		}

		if (user.email) {
			return user.email.split('@')[0] ?? 'Friend';
		}

		return 'Friend';
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
					redirectTo: `${window.location.origin}/app/history`
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

	function trendPath(points: TrendPoint[]): string {
		return points
			.map((point, index) => {
				const x = index * 120;
				const y = 180 - point.value * 2;
				return `${index === 0 ? 'M' : 'L'}${x},${y}`;
			})
			.join(' ');
	}

	function trendAreaPath(points: TrendPoint[]): string {
		const line = trendPath(points);
		const maxX = (points.length - 1) * 120;
		return `${line} L${maxX},200 L0,200 Z`;
	}
</script>

<svelte:head>
	<title>Sanctuary | History</title>
</svelte:head>

{#if !currentUser}
	<main class="auth-shell">
		<section class="auth-card">
			<p class="eyebrow">History</p>
			<h1>Sign in to see your journey.</h1>
			<p class="auth-copy">
				Your history page groups past check-ins, highlights stress trends, and keeps your progress easy to revisit.
			</p>

			<div class="auth-actions">
				<button class="button" onclick={() => signInWithProvider('google')} disabled={isSigningIn !== null || !hasSupabaseConfig}>
					{isSigningIn === 'google' ? 'Connecting Google...' : 'Continue with Google'}
				</button>
				<a class="button button-subtle" href="/app">Back to dashboard</a>
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
	<main class="history-page">
		<section class="history-frame">
			<header class="page-head">
				<div>
					<p class="eyebrow">Your Journey</p>
					<h1>Looking back at your growth and resilience.</h1>
				</div>
				<div class="head-actions">
					<div class="streak-card">
						<div class="streak-icon">
							<span class="material-symbols-outlined">celebration</span>
						</div>
						<div>
							<p>Daily Streak</p>
							<strong>{streakDays} DAYS</strong>
						</div>
					</div>
				</div>
			</header>

			<AppSectionNav />

			<section class="journey-main">
				<section class="trend-card">
					<div class="section-heading">
						<div>
							<h3>Stress Trends</h3>
							<p>Last 7 days progression</p>
						</div>
						<div class="trend-actions">
							<span class="view-chip">Weekly View</span>
							<a class="calendar-link" href="/app/calendar" aria-label="Open calendar view">
								<span class="material-symbols-outlined">calendar_month</span>
							</a>
						</div>
					</div>

					<div class="chart-shell">
						<svg class="trend-chart" viewBox="0 0 720 200" preserveAspectRatio="none" aria-label="Stress trend chart">
							<defs>
								<linearGradient id="historyGradient" x1="0%" y1="0%" x2="0%" y2="100%">
									<stop offset="0%" stop-color="rgba(0,103,92,0.22)" />
									<stop offset="100%" stop-color="rgba(0,103,92,0)" />
								</linearGradient>
							</defs>
							<path class="area" d={trendAreaPath(trendPoints)} />
							<path class="line" d={trendPath(trendPoints)} />
							{#each trendPoints as point, index}
								<circle cx={index * 120} cy={180 - point.value * 2} r="5" />
							{/each}
						</svg>

						<div class="chart-labels">
							{#each trendPoints as point}
								<span>{point.day}</span>
							{/each}
						</div>
					</div>
				</section>

				<section class="history-groups">
					{#each historyGroups as group}
						<article class="day-group">
							<div class="day-head">
								<div class={`mood-badge ${group.tone}`}>
									<span class="material-symbols-outlined filled">{group.moodIcon}</span>
								</div>
								<div>
									<h4>{group.dayLabel}</h4>
									<p>{group.summary}</p>
								</div>
							</div>

							{#if group.entries}
								<div class="entry-stack">
									{#each group.entries as entry}
										<div class={`entry-card ${entry.tone ?? ''}`}>
											<div class="entry-top">
												<div>
													<span>{entry.time}</span>
													<h5>{entry.title}</h5>
												</div>
												<span class="material-symbols-outlined">{entry.icon}</span>
											</div>

											<div class="sparkline">
												<svg viewBox="0 0 240 40" preserveAspectRatio="none">
													<path d={entry.path} />
												</svg>
											</div>

											<div class="tag-row">
												{#each entry.tags as tag}
													<span>{tag}</span>
												{/each}
											</div>
										</div>
									{/each}
								</div>
							{:else}
								<div class="collapsed-note">
									<p>{group.collapsedNote}</p>
								</div>
							{/if}
						</article>
					{/each}
				</section>

				<section class="insight-card">
					<div class="insight-copy">
						<p class="eyebrow light">AI Insight</p>
						<h3>Your resilience is peaking in the afternoons.</h3>
						<p>
							Based on your recent rhythm, mid-day movement sessions are still the point where your stress curve softens fastest.
						</p>
					</div>
					<div class="insight-photo">
						<img
							src="https://lh3.googleusercontent.com/aida-public/AB6AXuAShCyzxUslE9SVx-yccqmf8VYnXKIKCfG4T6nsPXmzmyI4wiGJcXI3IrkANmXSxzSsLKht1FaGr1abSqZ2kxxTniABdsV2sDiI9wIN6fmEzFVQWdE6Kq0lMYAzDh1G7e61BZlxjxlG4IP0yThIDZOCy731Mlh-OeCbl20ifdpDbsvlAAREySOYRSJADWowhm3HRwu2tMNrrGt5iSLn1w8RPCyxjFzP11hC5IltzfZNYtkYhsy9pvQXnzuSxNtywIddS1VAIuIMUoo"
							alt="Person meditating"
						/>
					</div>
				</section>
			</section>
		</section>
	</main>
{/if}

<style>
	:global(body) {
		margin: 0;
		font-family: 'Plus Jakarta Sans', sans-serif;
		background:
			radial-gradient(circle at top left, rgba(91, 244, 222, 0.24), transparent 26%),
			radial-gradient(circle at top right, rgba(183, 211, 255, 0.85), transparent 30%),
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

	.auth-shell {
		min-height: calc(100vh - 5rem);
		display: grid;
		place-items: center;
		padding: 1.5rem;
	}

	.auth-card {
		width: min(100%, 44rem);
		padding: 2rem;
		border-radius: 2rem;
		background: rgba(255, 255, 255, 0.82);
		border: 1px solid rgba(160, 174, 197, 0.3);
		box-shadow: 0 20px 45px rgba(31, 47, 82, 0.12);
		backdrop-filter: blur(18px);
	}

	.eyebrow {
		margin: 0;
		font-size: 0.78rem;
		font-weight: 800;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		color: #00675c;
	}

	.eyebrow.light {
		color: rgba(193, 255, 242, 0.86);
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
	.section-heading p,
	.day-head p,
	.insight-copy p {
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
	.log-button,
	.calendar-link {
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

	.button,
	.log-button {
		background: linear-gradient(135deg, #00675c, #128d7f);
		color: #ffffff;
		box-shadow: 0 6px 0 rgba(0, 103, 92, 0.22);
	}

	.button-subtle {
		background: rgba(201, 222, 255, 0.7);
		color: #212f42;
	}

	.history-page {
		padding: 1.2rem 1.5rem 1.6rem;
	}

	.history-frame {
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
		max-width: 34rem;
	}

	.head-actions {
		display: flex;
		align-items: center;
		gap: 0.9rem;
	}

	.streak-card {
		display: flex;
		align-items: center;
		gap: 0.9rem;
		padding: 1rem 1.15rem;
		border-radius: 1.4rem;
		background: rgba(211, 228, 255, 0.72);
		border: 1px solid rgba(160, 174, 197, 0.18);
	}

	.streak-card p {
		margin: 0;
		font-size: 0.88rem;
		font-weight: 700;
		color: #4e5c71;
	}

	.streak-card strong {
		display: block;
		margin-top: 0.15rem;
		font-size: 1.15rem;
		color: #00675c;
	}

	.streak-icon,
	.calendar-link,
	.mood-badge {
		display: grid;
		place-items: center;
	}

	.streak-icon {
		width: 3rem;
		height: 3rem;
		border-radius: 1rem;
		background: #00675c;
		color: white;
	}

	.calendar-link {
		width: 3.35rem;
		height: 3.35rem;
		padding: 0;
		border-radius: 1.2rem;
		background: rgba(91, 244, 222, 0.22);
		color: #00675c;
		box-shadow: 0 10px 24px rgba(0, 103, 92, 0.12);
	}

	.journey-main {
		display: grid;
		gap: 1.25rem;
	}

	.trend-card,
	.day-group,
	.collapsed-note {
		background: rgba(255, 255, 255, 0.84);
		border: 1px solid rgba(160, 174, 197, 0.24);
		box-shadow: 0 20px 45px rgba(31, 47, 82, 0.08);
		backdrop-filter: blur(18px);
	}

	.section-heading h3,
	.day-head h4,
	.insight-copy h3 {
		margin: 0;
	}
	.history-groups {
		display: grid;
		gap: 1.25rem;
	}

	.trend-card,
	.day-group,
	.insight-card {
		border-radius: 2rem;
		padding: 1.6rem;
	}

	.section-heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
	}

	.trend-actions {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 0.65rem;
	}

	.section-heading h3 {
		font-size: 1.3rem;
	}

	.view-chip {
		padding: 0.55rem 0.9rem;
		border-radius: 999px;
		background: rgba(0, 103, 92, 0.08);
		color: #00675c;
		font-size: 0.78rem;
		font-weight: 800;
	}

	.chart-shell {
		margin-top: 1.4rem;
	}

	.trend-chart {
		width: 100%;
		height: 16rem;
	}

	.trend-chart .area {
		fill: url(#historyGradient);
	}

	.trend-chart .line {
		fill: none;
		stroke: #00675c;
		stroke-width: 4;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.trend-chart circle {
		fill: #00675c;
	}

	.chart-labels {
		display: grid;
		grid-template-columns: repeat(7, minmax(0, 1fr));
		margin-top: 0.55rem;
		font-size: 0.78rem;
		font-weight: 800;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #6a788d;
	}

	.day-head {
		display: flex;
		align-items: center;
		gap: 1rem;
	}

	.day-head h4 {
		font-size: 1.7rem;
		letter-spacing: -0.03em;
	}

	.mood-badge {
		width: 4rem;
		height: 4rem;
		border-radius: 999px;
	}

	.mood-badge.calm {
		background: rgba(91, 244, 222, 0.24);
		color: #00594f;
	}

	.mood-badge.alert {
		background: rgba(251, 81, 81, 0.14);
		color: #b31b25;
		border: 3px solid rgba(251, 81, 81, 0.28);
	}

	.mood-badge.balanced {
		background: rgba(252, 192, 37, 0.22);
		color: #755600;
		border: 3px solid rgba(252, 192, 37, 0.28);
	}

	.filled {
		font-variation-settings:
			'FILL' 1,
			'wght' 500,
			'GRAD' 0,
			'opsz' 24;
	}

	.entry-stack {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 1rem;
		margin-top: 1.25rem;
		padding-left: 1.1rem;
		border-left: 4px solid rgba(211, 228, 255, 0.95);
	}

	.entry-card {
		padding: 1.25rem;
		border-radius: 1.45rem;
		background: #eaf1ff;
		transition:
			transform 160ms ease,
			background 160ms ease;
	}

	.entry-card:hover {
		transform: translateY(-2px);
		background: #dce9ff;
	}

	.entry-card.alert {
		border-left: 4px solid #b31b25;
	}

	.entry-card.muted {
		opacity: 0.78;
	}

	.entry-top {
		display: flex;
		align-items: start;
		justify-content: space-between;
		gap: 1rem;
	}

	.entry-top span:first-child {
		display: block;
		font-size: 0.72rem;
		font-weight: 900;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: #6a788d;
	}

	.entry-top h5 {
		margin: 0.35rem 0 0;
		font-size: 1.1rem;
		color: #00675c;
	}

	.entry-card.alert .entry-top h5,
	.entry-card.alert .entry-top > span:last-child {
		color: #b31b25;
	}

	.entry-card.muted .entry-top h5,
	.entry-card.muted .entry-top > span:last-child {
		color: #6a788d;
	}

	.sparkline {
		margin: 1rem 0;
		height: 2.5rem;
		overflow: hidden;
	}

	.sparkline svg {
		width: 100%;
		height: 100%;
	}

	.sparkline path {
		fill: none;
		stroke: #00675c;
		stroke-width: 2.5;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.entry-card.alert .sparkline path {
		stroke: #b31b25;
	}

	.entry-card.muted .sparkline path {
		stroke: #6a788d;
	}

	.tag-row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.tag-row span {
		padding: 0.4rem 0.65rem;
		border-radius: 0.8rem;
		background: rgba(255, 255, 255, 0.62);
		font-size: 0.75rem;
		font-weight: 700;
		color: #212f42;
	}

	.entry-card.alert .tag-row span {
		background: rgba(179, 27, 37, 0.08);
		color: #b31b25;
		text-transform: uppercase;
	}

	.collapsed-note {
		margin-top: 1.25rem;
		padding: 1.1rem 1.25rem 1.1rem 2.2rem;
		border-left: 4px solid rgba(211, 228, 255, 0.5);
	}

	.collapsed-note p {
		margin: 0;
		font-style: italic;
		color: #4e5c71;
	}

	.insight-card {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1.5rem;
		background: linear-gradient(135deg, #00675c, #00594f);
		color: #c1fff2;
		box-shadow: 0 16px 34px rgba(0, 90, 80, 0.24);
	}

	.insight-copy {
		max-width: 40rem;
	}

	.insight-copy h3 {
		margin-top: 0.45rem;
		font-size: clamp(1.8rem, 4vw, 2.8rem);
		line-height: 1.05;
		letter-spacing: -0.03em;
		color: white;
	}

	.insight-copy p:last-child {
		margin-top: 0.8rem;
		color: rgba(193, 255, 242, 0.88);
	}

	.insight-photo {
		position: relative;
		width: 11rem;
		height: 11rem;
		flex-shrink: 0;
	}

	.insight-photo::before {
		content: '';
		position: absolute;
		inset: 0;
		border-radius: 999px;
		background: rgba(91, 244, 222, 0.24);
		filter: blur(26px);
	}

	.insight-photo img {
		position: relative;
		width: 100%;
		height: 100%;
		object-fit: cover;
		border-radius: 999px;
		border: 4px solid #5bf4de;
	}

	@media (max-width: 780px) {
		.history-page {
			padding-inline: 1rem;
		}

		.page-head,
		.insight-card {
			flex-direction: column;
			align-items: start;
		}

		.head-actions {
			width: 100%;
			justify-content: space-between;
		}

		.section-heading {
			flex-direction: column;
			align-items: flex-start;
		}

		.trend-actions {
			align-items: flex-start;
		}

		.entry-stack {
			grid-template-columns: 1fr;
		}
	}
</style>
