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

	const isDashboard = $derived(page.url.pathname === '/app');
	const displayName = $derived(getDisplayName(currentUser));
	const avatarLetter = $derived(displayName.charAt(0).toUpperCase() || 'U');
	const primaryActionLabel = $derived(currentUser ? (isDashboard ? 'Home' : 'Dashboard') : 'Login');
	const primaryActionHref = $derived(currentUser ? (isDashboard ? '/' : '/app') : '/app');

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

<header class="site-nav-shell">
	<nav class="site-nav">
		<a class="site-brand" href="/">Sanctuary</a>

		<div class="site-actions">
			<button class="theme-toggle" type="button" aria-label="Toggle theme" onclick={toggleTheme}>
				<span class="material-symbols-outlined">
					{themeMode === 'dark' ? 'light_mode' : 'dark_mode'}
				</span>
			</button>

			{#if currentSession && currentUser}
				<div class="user-chip" aria-label="Signed in user">
					<span class="user-avatar">{avatarLetter}</span>
					<span class="user-name">{displayName}</span>
				</div>
				<a class="site-button site-button-secondary" href={primaryActionHref}>
					{primaryActionLabel}
				</a>
				<button class="site-button site-button-ghost" type="button" onclick={signOut} disabled={isSigningOut}>
					{isSigningOut ? 'Signing out...' : 'Sign out'}
				</button>
			{:else}
				<button class="site-button" type="button" onclick={signInWithGoogle} disabled={isSigningIn}>
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
	.site-nav-shell {
		position: sticky;
		top: 0;
		z-index: 90;
		padding: 1rem 1.25rem 0;
	}

	.site-nav {
		max-width: 82rem;
		margin: 0 auto;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.9rem;
		padding: 0.95rem 1.2rem;
		background: color-mix(in srgb, var(--surface, #ffffff) 80%, white);
		border: 1px solid color-mix(in srgb, var(--outline-variant, #cbd5e1) 70%, transparent);
		border-radius: 999px;
		backdrop-filter: blur(18px);
		box-shadow: 0 14px 38px rgba(15, 23, 42, 0.08);
	}

	.site-brand {
		font-size: 1.3rem;
		font-weight: 800;
		color: var(--primary, #00675c);
		text-decoration: none;
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
		background: linear-gradient(180deg, #6ef0e2 0%, var(--primary, #00675c) 100%);
		color: white;
		font-weight: 800;
	}

	.user-name {
		font-weight: 700;
	}

	.site-button {
		border: 0;
		border-radius: 999px;
		padding: 0.78rem 1.05rem;
		font: inherit;
		font-weight: 700;
		text-decoration: none;
		cursor: pointer;
		background: var(--primary, #00675c);
		color: white;
	}

	.site-button:disabled {
		opacity: 0.7;
		cursor: wait;
	}

	.site-button-secondary {
		background: color-mix(in srgb, var(--secondary-container, #dbeafe) 88%, white);
		color: var(--on-secondary-container, #0f172a);
	}

	.site-button-ghost {
		background: transparent;
		color: var(--on-surface-variant, #4e5c71);
		border: 1px solid color-mix(in srgb, var(--outline-variant, #cbd5e1) 78%, transparent);
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
		.site-button-secondary,
		.site-button-ghost {
			flex: 1 1 10rem;
			text-align: center;
		}

		.user-chip {
			width: 100%;
			justify-content: center;
		}
	}
</style>
