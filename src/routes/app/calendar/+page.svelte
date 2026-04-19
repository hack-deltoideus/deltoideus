<script lang="ts">
	import { browser } from '$app/environment';
	import { onMount } from 'svelte';
	import AppSectionNav from '$lib/components/AppSectionNav.svelte';
	import SiteNav from '$lib/components/SiteNav.svelte';
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
		dateValue: string | null;
		day: number | null;
		isSelected: boolean;
		hasSessions: boolean;
		sessionCount: number;
	};

	type SessionSummaryPayload = {
		startedAt: string;
		durationSeconds: number;
		averageHeartRate: number | null;
		captureType: string;
	};

	type SensorSessionRecord = {
		id: string;
		started_at: string;
		duration_seconds: number | null;
		avg_heart_rate: number | null;
		capture_type: string | null;
		summary_payload: SessionSummaryPayload | null;
	};

	let currentSession = $state<Session | null>(null);
	let currentUser = $state<User | null>(null);
	let authStatus = $state('');
	let isSigningIn = $state<OAuthProvider | null>(null);
	let isLoadingSessions = $state(false);
	let calendarStatus = $state('');
	let selectedDate = $state('');
	let visibleMonth = $state(getMonthStart(new Date()));
	let sessions = $state<SensorSessionRecord[]>([]);

	const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
	const monthLabel = $derived(
		visibleMonth.toLocaleDateString([], {
			month: 'long',
			year: 'numeric'
		})
	);
	const sessionCountsByDate = $derived(
		sessions.reduce<Record<string, number>>((counts, session) => {
			const dateValue = getSessionDateValue(session.summary_payload?.startedAt ?? session.started_at);
			counts[dateValue] = (counts[dateValue] ?? 0) + 1;
			return counts;
		}, {})
	);
	const calendarDays = $derived(buildCalendarDays(visibleMonth, selectedDate, sessionCountsByDate));
	const selectedDaySessions = $derived(
		selectedDate
			? sessions.filter(
					(session) =>
						getSessionDateValue(session.summary_payload?.startedAt ?? session.started_at) === selectedDate
				)
			: []
	);
	const selectedAverageHeartRate = $derived(averageHeartRateForSessions(selectedDaySessions));
	const selectedTotalDurationMinutes = $derived(totalDurationMinutes(selectedDaySessions));
	const selectedActivityLabel = $derived(primaryActivityLabel(selectedDaySessions));

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
			if (data.session?.user) {
				void loadCalendarSessions(data.session.user.id);
			}
		});

		const {
			data: { subscription }
		} = supabase.auth.onAuthStateChange((_event, session) => {
			currentSession = session;
			currentUser = session?.user ?? null;
			authStatus = '';
			if (session?.user) {
				void loadCalendarSessions(session.user.id);
			} else {
				sessions = [];
				selectedDate = '';
				visibleMonth = getMonthStart(new Date());
			}
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

	async function loadCalendarSessions(userId: string) {
		if (!supabase) {
			return;
		}

		isLoadingSessions = true;
		calendarStatus = '';

		try {
			const { data, error } = await supabase
				.from('sensor_sessions')
				.select('id, started_at, duration_seconds, avg_heart_rate, capture_type, summary_payload')
				.eq('user_id', userId)
				.order('started_at', { ascending: false })
				.limit(120);

			if (error) {
				throw error;
			}

			sessions = (data ?? []) as SensorSessionRecord[];

			const latestSessionDate = sessions[0]
				? new Date(sessions[0].summary_payload?.startedAt ?? sessions[0].started_at)
				: new Date();
			visibleMonth = getMonthStart(latestSessionDate);

			if (sessions.length > 0) {
				selectedDate = getSessionDateValue(sessions[0].summary_payload?.startedAt ?? sessions[0].started_at);
			} else {
				selectedDate = '';
			}
		} catch (error) {
			calendarStatus = describeError(error, 'Failed to load calendar sessions.');
		} finally {
			isLoadingSessions = false;
		}
	}

	function getMonthStart(date: Date): Date {
		return new Date(date.getFullYear(), date.getMonth(), 1);
	}

	function getSessionDateValue(dateString: string): string {
		return new Date(dateString).toISOString().slice(0, 10);
	}

	function buildCalendarDays(
		month: Date,
		activeDate: string,
		countsByDate: Record<string, number>
	): CalendarDay[] {
		const year = month.getFullYear();
		const monthIndex = month.getMonth();
		const firstDay = new Date(year, monthIndex, 1);
		const startOffset = (firstDay.getDay() + 6) % 7;
		const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
		const cells: CalendarDay[] = [];

		for (let index = 0; index < startOffset; index += 1) {
			cells.push({
				dateValue: null,
				day: null,
				isSelected: false,
				hasSessions: false,
				sessionCount: 0
			});
		}

		for (let day = 1; day <= daysInMonth; day += 1) {
			const dateValue = new Date(Date.UTC(year, monthIndex, day)).toISOString().slice(0, 10);
			const sessionCount = countsByDate[dateValue] ?? 0;

			cells.push({
				dateValue,
				day,
				isSelected: activeDate === dateValue,
				hasSessions: sessionCount > 0,
				sessionCount
			});
		}

		return cells;
	}

	function goToPreviousMonth() {
		visibleMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() - 1, 1);
	}

	function goToNextMonth() {
		visibleMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 1);
	}

	function selectCalendarDay(day: CalendarDay) {
		if (!day.dateValue) {
			return;
		}

		selectedDate = day.dateValue;
	}

	function formatSelectedDate(dateValue: string): string {
		return new Date(`${dateValue}T12:00:00`).toLocaleDateString([], {
			month: 'long',
			day: 'numeric',
			year: 'numeric'
		});
	}

	function averageHeartRateForSessions(daySessions: SensorSessionRecord[]): number | null {
		const values = daySessions
			.map((session) => session.summary_payload?.averageHeartRate ?? session.avg_heart_rate)
			.filter((value): value is number => typeof value === 'number' && !Number.isNaN(value));

		if (values.length === 0) {
			return null;
		}

		return values.reduce((total, value) => total + value, 0) / values.length;
	}

	function totalDurationMinutes(daySessions: SensorSessionRecord[]): number {
		return Math.round(
			daySessions.reduce(
				(total, session) =>
					total + ((session.summary_payload?.durationSeconds ?? session.duration_seconds ?? 0) / 60),
				0
			)
		);
	}

	function formatMetric(value: number | null | undefined, digits = 0): string {
		if (typeof value !== 'number' || Number.isNaN(value)) {
			return '--';
		}

		return value.toFixed(digits);
	}

	function formatActivityLabel(value: string | null | undefined): string {
		if (!value) {
			return 'Sensor Session';
		}

		return value
			.split(/[_-]+/)
			.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
			.join(' ');
	}

	function primaryActivityLabel(daySessions: SensorSessionRecord[]): string {
		if (daySessions.length === 0) {
			return 'No activity logged';
		}

		return formatActivityLabel(daySessions[0]?.summary_payload?.captureType ?? daySessions[0]?.capture_type);
	}
</script>

<svelte:head>
	<title>Sanctuary | Calendar</title>
</svelte:head>

{#if !currentUser}
	<SiteNav />
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
	<SiteNav />
	<main class="calendar-page">
		<section class="calendar-frame">
			<AppSectionNav />

			{#if calendarStatus}
				<p class="inline-status">{calendarStatus}</p>
			{/if}

			<div class="calendar-layout">
				<section class="calendar-main">
					<div class="month-bar">
						<button type="button" aria-label="Previous month" onclick={goToPreviousMonth}>
							<span class="material-symbols-outlined">chevron_left</span>
						</button>
						<strong>{monthLabel}</strong>
						<button type="button" aria-label="Next month" onclick={goToNextMonth}>
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
									{#if cell.dateValue}
										<button
											type="button"
											class:active={cell.isSelected}
											class="day-pill"
											onclick={() => selectCalendarDay(cell)}
											aria-label={`${cell.day}, ${cell.sessionCount} session${cell.sessionCount === 1 ? '' : 's'}`}
										>
											{cell.day}
										</button>
										{#if cell.hasSessions}
											<div class="day-dot"></div>
										{/if}
									{/if}
								</div>
							{/each}
						</div>
					</div>
				</section>

				<aside class="summary-panel">
					<h2>{selectedDate ? formatSelectedDate(selectedDate) : monthLabel}</h2>

					<div class="stat-stack">
						<div class="stat-card primary-border">
							<p>Average Heart Rate</p>
							<div>
								<strong>{formatMetric(selectedAverageHeartRate, 0)}</strong>
								<span>bpm</span>
							</div>
						</div>
						<div class="stat-card primary-border">
							<p>Sessions</p>
							<div>
								<strong>{selectedDaySessions.length}</strong>
								<span>saved</span>
							</div>
						</div>
						<div class="stat-card primary-border">
							<p>Tracked Activity</p>
							<div class="stat-copy">
								<strong>{selectedActivityLabel}</strong>
							</div>
						</div>
						<div class="stat-card primary-border">
							<p>Total Time</p>
							<div>
								<strong>{selectedTotalDurationMinutes}</strong>
								<span>min</span>
							</div>
						</div>
					</div>

					<p class="summary-copy">
						{#if isLoadingSessions}
							Loading your saved sessions...
						{:else if selectedDate && selectedDaySessions.length > 0}
							Select another day to inspect a different set of saved sessions.
						{:else if selectedDate}
							No saved sessions for this day yet.
						{:else}
							Choose a day on the calendar to inspect it.
						{/if}
					</p>
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

	.auth-shell {
		min-height: calc(100vh - 5rem);
		display: grid;
		place-items: center;
		padding: 1.5rem;
	}

	.auth-card,
	.calendar-card,
	.summary-panel,
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

	.auth-card h1 {
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

	.button-subtle {
		background: rgba(201, 222, 255, 0.7);
		color: #212f42;
	}

	.calendar-page {
		padding: 1.2rem 1.5rem 1.6rem;
	}

	.calendar-frame {
		display: grid;
		gap: 1.35rem;
		max-width: 84rem;
		margin: 0 auto;
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
	.summary-panel {
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
		padding: 0;
		border: 0;
		border-radius: 999px;
		background: transparent;
		font-weight: 700;
		font: inherit;
		color: #212f42;
		cursor: pointer;
		transition:
			transform 160ms ease,
			background 160ms ease,
			box-shadow 160ms ease;
	}

	.day-pill:hover {
		transform: translateY(-1px);
		background: rgba(183, 211, 255, 0.35);
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

	.summary-panel h2 {
		margin: 0;
	}

	.summary-panel {
		display: grid;
		gap: 1.2rem;
	}

	.summary-panel h2 {
		font-size: 1.5rem;
	}

	.stat-stack {
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

	.stat-copy {
		align-items: flex-start;
	}

	.stat-card strong {
		font-size: 2.6rem;
		line-height: 1;
	}

	.stat-card span {
		color: #4e5c71;
		font-weight: 600;
	}

	.stat-copy strong {
		font-size: 1.1rem;
		line-height: 1.45;
	}

	.summary-copy {
		margin: 0;
		line-height: 1.55;
		color: #4e5c71;
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

	}
</style>
