<script lang="ts">
	import { browser } from '$app/environment';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { supabase } from '$lib/supabase';
	import type { Session, User } from '@supabase/supabase-js';

	type SupabaseLikeError = {
		message?: string;
		details?: string;
		hint?: string;
		code?: string;
	};

	type ThemeMode = 'light' | 'dark';

	let currentSession = $state<Session | null>(null);
	let currentUser = $state<User | null>(null);
	let authStatus = $state('');
	let isSigningIn = $state(false);
	let isSigningOut = $state(false);
	let themeMode = $state<ThemeMode>('light');

	const pathname = $derived(page.url.pathname);
	const showDashboard = $derived(currentUser !== null && pathname !== '/app');
	const showHome = $derived(currentUser !== null && pathname !== '/');
	const displayName = $derived(getDisplayName(currentUser));
	const avatarLetter = $derived(displayName.charAt(0).toUpperCase() || 'U');

	onMount(() => {
		if (browser) {
			const storedTheme = window.localStorage.getItem('sanctuary-theme');
			themeMode = storedTheme === 'dark' ? 'dark' : 'light';
			document.documentElement.dataset.theme = themeMode;
		}

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

	function toggleTheme() {
		themeMode = themeMode === 'light' ? 'dark' : 'light';

		if (browser) {
			document.documentElement.dataset.theme = themeMode;
			window.localStorage.setItem('sanctuary-theme', themeMode);
		}
	}

	async function signInWithGoogle() {
		if (!supabase || !browser || isSigningIn) {
			return;
		}

		isSigningIn = true;
		authStatus = '';

		try {
			const { error } = await supabase.auth.signInWithOAuth({
				provider: 'google',
				options: {
					redirectTo: `${window.location.origin}/app`
				}
			});

			if (error) {
				throw error;
			}
		} catch (error) {
			authStatus = describeError(error, 'Failed to sign in with Google.');
		} finally {
			isSigningIn = false;
		}
	}

	async function signOut() {
		if (!supabase || isSigningOut) {
			return;
		}

		isSigningOut = true;
		authStatus = '';

		try {
			const { error } = await supabase.auth.signOut();
			if (error) {
				throw error;
			}

			currentSession = null;
			currentUser = null;
		} catch (error) {
			authStatus = describeError(error, 'Failed to sign out.');
		} finally {
			isSigningOut = false;
		}
	}
</script>

<div class="site-brand-shell">
	<a class="site-brand" href="/">Study Buddy</a>
</div>

<header class="site-nav-shell">
	<nav class="site-nav">

		<div class="site-actions">
			<button class="theme-toggle" type="button" aria-label="Toggle theme" onclick={toggleTheme}>
				<span class="material-symbols-outlined">
					{themeMode === 'dark' ? 'light_mode' : 'dark_mode'}
				</span>
			</button>

			{#if currentSession && currentUser}
				{#if showDashboard}
					<a class="site-button site-button-primary" href="/app">Dashboard</a>
				{/if}
				{#if showHome}
					<a class="site-button site-button-secondary" href="/">Home</a>
				{/if}
				<button class="site-button site-button-secondary" type="button" onclick={signOut} disabled={isSigningOut}>
					{isSigningOut ? 'Signing out...' : 'Sign out'}
				</button>
				<div class="user-chip" aria-label="Signed in user">
					<span class="user-avatar">{avatarLetter}</span>
					<span class="user-name">{displayName}</span>
				</div>
			{:else}
				<button class="site-button site-button-primary" type="button" onclick={signInWithGoogle} disabled={isSigningIn}>
					{isSigningIn ? 'Connecting Google...' : 'Login with Google'}
				</button>
			{/if}
		</div>
	</nav>

	{#if authStatus}
		<p class="site-status">{authStatus}</p>
	{/if}
</header>

<style>
	.site-brand-shell {
		max-width: 82rem;
		margin: 0 auto;
		padding: 0 1.25rem;
		min-height: 4.25rem;
		display: flex;
		align-items: center;
	}

	.site-nav-shell {
		position: sticky;
		top: 0;
		z-index: 90;
		margin-top: -4.25rem;
		padding: 0 1.25rem 0;
	}

	.site-nav {
		max-width: 82rem;
		margin: 0 auto;
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 0.9rem;
		min-height: 4.25rem;
	}

	.site-brand {
		position: relative;
		z-index: 92;
		pointer-events: auto;
		display: inline-block;
		font-size: 1.3rem;
		font-weight: 800;
		color: var(--primary, #00675c);
		text-decoration: none;
		line-height: 1;
		letter-spacing: 0.02em;
	}

	.site-actions {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.theme-toggle {
		display: grid;
		place-items: center;
		width: 2.9rem;
		height: 2.9rem;
		border: 1px solid color-mix(in srgb, var(--outline-variant, #cbd5e1) 78%, transparent);
		border-radius: 999px;
		background: color-mix(in srgb, var(--surface-container-lowest, #ffffff) 86%, transparent);
		color: var(--on-surface, #1f2937);
		cursor: pointer;
		transition:
			transform 160ms ease,
			background 160ms ease,
			border-color 160ms ease;
	}

	.theme-toggle:hover {
		transform: translateY(-1px);
		background: color-mix(in srgb, var(--primary, #00675c) 10%, var(--surface, #ffffff));
	}

	.user-chip {
		display: flex;
		align-items: center;
		gap: 0.65rem;
		padding: 0.42rem 0.8rem 0.42rem 0.45rem;
		border-radius: 999px;
		background: color-mix(in srgb, var(--primary, #00675c) 10%, transparent);
		color: var(--on-surface, #1f2937);
	}

	.user-avatar {
		display: grid;
		place-items: center;
		width: 2rem;
		height: 2rem;
		border-radius: 999px;
		background: linear-gradient(180deg, var(--primary-glow, #6ef0e2) 0%, var(--primary, #00675c) 100%);
		color: white;
		font-weight: 800;
	}

	.user-name {
		font-weight: 700;
	}

	.site-button {
		border: 0;
		border-radius: 999px;
		padding: 0.9rem 1.25rem;
		font: inherit;
		font-weight: 800;
		text-decoration: none;
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: var(--primary, #00675c);
		color: white;
		transition:
			transform 160ms ease,
			filter 160ms ease,
			box-shadow 160ms ease;
	}

	.site-button:disabled {
		opacity: 0.7;
		cursor: wait;
	}

	.site-button:hover {
		transform: translateY(-1px) scale(1.01);
		filter: brightness(1.03);
	}

	.site-button-primary {
		background: linear-gradient(135deg, var(--primary, #00675c), #128d7f);
		color: white;
		box-shadow: 0 6px 0 rgba(0, 103, 92, 0.22);
	}

	.site-button-secondary {
		background: rgba(201, 222, 255, 0.7);
		color: var(--on-surface, #1f2937);
	}

	.site-status {
		max-width: 82rem;
		margin: 0.5rem auto 0;
		padding: 0 0.75rem;
		color: var(--error, #b31b25);
		font-weight: 600;
	}

	@media (max-width: 840px) {
		.site-nav {
			flex-wrap: wrap;
			border-radius: 1.5rem;
		}

		.site-actions {
			flex-wrap: wrap;
			justify-content: flex-end;
			width: 100%;
		}
	}

	@media (max-width: 560px) {
		.site-brand-shell,
		.site-nav-shell {
			padding-inline: 0.8rem;
		}

		.site-nav {
			padding: 0.85rem;
		}

		.site-actions {
			justify-content: stretch;
		}

		.site-button,
		.site-button-secondary {
			flex: 1 1 10rem;
			text-align: center;
		}

		.user-chip {
			width: 100%;
			justify-content: center;
		}
	}
</style>
