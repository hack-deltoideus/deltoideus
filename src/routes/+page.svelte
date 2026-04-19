<svelte:head>
	<title>Stude Buddy | Your Space for Peace</title>
</svelte:head>

<script lang="ts">
	import { browser } from '$app/environment';
	import RiveCharacter from '$lib/components/RiveCharacter.svelte';
	import SiteNav from '$lib/components/SiteNav.svelte';
	import { supabase } from '$lib/supabase';
	import { onMount } from 'svelte';
	import type { Session, User } from '@supabase/supabase-js';

	let currentSession = $state<Session | null>(null);
	let currentUser = $state<User | null>(null);
	let authStatus = $state('');
	let isSigningIn = $state(false);

	onMount(() => {
		if (!browser || !supabase) {
			return;
		}

		void supabase.auth.getSession().then(({ data }) => {
			currentSession = data.session;
			currentUser = data.session?.user ?? null;
		});

		const {
			data: { subscription }
		} = supabase.auth.onAuthStateChange((_event, session) => {
			currentSession = session;
			currentUser = session?.user ?? null;
		});

		return () => {
			subscription.unsubscribe();
		};
	});

	async function signInWithGoogle() {
		if (!browser || !supabase || isSigningIn) {
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
			authStatus = error instanceof Error ? error.message : 'Failed to start Google sign-in.';
		} finally {
			isSigningIn = false;
		}
	}
</script>

<main class="landing-shell">
	<SiteNav />

	<section class="hero">
		<div class="hero-copy">
			<h1>
				Study
				<span>smarter</span>, 
				<br />not harder.
			</h1>
			<p>
				It's important to study with intention, not just pushing through burnout.
				Track your focus, mood, and other real-time signals to know when it’s time to take a break.
			</p>
		</div>

		<div class="hero-mascot-row">
			<div class="hero-mascot-copy">
				<p class="hero-mascot-kicker">Meet Oy</p>
				<p class="hero-mascot-text">Oy is the companion and mascot of Study Buddy. He is your study buddy.</p>
				<p class="hero-mascot-prompt">Click Oy to say hi!</p>
			</div>

			<div class="hero-stage" aria-label="Mascot preview on landing page">
				<div class="hero-orb orb-left"></div>
				<div class="hero-orb orb-right"></div>
				<RiveCharacter variant="hero" />
				<div class="stage-frame"></div>
			</div>
		</div>

		{#if !currentSession || !currentUser}
			<div class="hero-actions">
				<button class="primary-action" type="button" onclick={signInWithGoogle} disabled={isSigningIn}>
					<span>{isSigningIn ? 'Connecting...' : 'Login'}</span>
					<span class="material-symbols-outlined">arrow_forward</span>
				</button>
				<p>
					New here?
					<button class="inline-auth-link" type="button" onclick={signInWithGoogle} disabled={isSigningIn}>
						Make an account
					</button>
				</p>
				{#if authStatus}
					<p class="hero-auth-status">{authStatus}</p>
				{/if}
			</div>
		{/if}
	</section>
</main>

<footer class="site-footer">
	<div class="footer-inner">
		<div class="footer-brand">
			<span>Study Buddy</span>
			<p>© 2026 Study Buddy. Designed to improve student burn out.</p>
		</div>
	</div>
</footer>

<style>
	:global(:root) {
		--surface-container-lowest: #ffffff;
		--on-secondary-container: #004884;
		--surface-bright: #f4f6ff;
		--secondary-fixed: #b7d3ff;
		--tertiary-fixed-dim: #edb210;
		--secondary-fixed-dim: #9fc6ff;
		--primary-fixed: #5bf4de;
		--primary-fixed-dim: #48e5d0;
		--surface-container-low: #eaf1ff;
		--tertiary-fixed: #fcc025;
		--surface-container-high: #d3e4ff;
		--on-secondary-fixed-variant: #005294;
		--on-secondary: #eef3ff;
		--inverse-on-surface: #8f9eb4;
		--secondary: #005da7;
		--error-dim: #9f0519;
		--error-container: #fb5151;
		--primary-container: #5bf4de;
		--surface-tint: #00675c;
		--on-tertiary-fixed-variant: #614700;
		--outline: #6a788d;
		--inverse-surface: #010f20;
		--secondary-container: #b7d3ff;
		--outline-variant: #a0aec5;
		--surface-container-highest: #c9deff;
		--surface-variant: #c9deff;
		--on-surface: #212f42;
		--on-error: #ffefee;
		--on-tertiary: #fff1db;
		--surface-dim: #bfd6f9;
		--on-primary-fixed-variant: #006358;
		--error: #b31b25;
		--on-background: #212f42;
		--on-tertiary-container: #563e00;
		--surface: #f4f6ff;
		--tertiary: #755600;
		--on-primary-fixed: #00443c;
		--on-secondary-fixed: #003563;
		--on-surface-variant: #4e5c71;
		--on-tertiary-fixed: #3d2b00;
		--on-error-container: #570008;
		--tertiary-dim: #674b00;
		--tertiary-container: #fcc025;
		--inverse-primary: #65fde6;
		--primary: #00675c;
		--secondary-dim: #005192;
		--surface-container: #dce9ff;
		--background: #f4f6ff;
		--primary-dim: #005a50;
		--on-primary: #c1fff2;
		--on-primary-container: #00594f;
		--body-overlay-a: rgba(91, 244, 222, 0.32);
		--body-overlay-b: rgba(252, 192, 37, 0.12);
		--body-top: #fbfdff;
		--body-bottom: #eff5ff;
		--card-bg: rgba(255, 255, 255, 0.78);
		--card-shadow: 0 18px 40px rgba(33, 47, 66, 0.08);
		--play-bg: rgba(255, 255, 255, 0.65);
		--play-shadow: 0 16px 35px rgba(33, 47, 66, 0.12);
		--stage-border: rgba(255, 255, 255, 0.45);
	}

	:global(:root[data-theme='dark']) {
		--surface-container-lowest: #0d1c2a;
		--on-secondary-container: #d9ebff;
		--surface-bright: #0e1b28;
		--secondary-fixed: #1b455f;
		--tertiary-fixed-dim: #c89200;
		--secondary-fixed-dim: #16394f;
		--primary-fixed: #67efe0;
		--primary-fixed-dim: #49d7c9;
		--surface-container-low: #0f2231;
		--tertiary-fixed: #f0b91d;
		--surface-container-high: #173244;
		--on-secondary-fixed-variant: #d9ebff;
		--on-secondary: #e8f2ff;
		--inverse-on-surface: #0b1825;
		--secondary: #8ac3ff;
		--error-dim: #c95b67;
		--error-container: #5d1d25;
		--primary-container: #103f3a;
		--surface-tint: #67efe0;
		--on-tertiary-fixed-variant: #fff0c4;
		--outline: #6f8396;
		--inverse-surface: #eef4ff;
		--secondary-container: #1b455f;
		--outline-variant: #465a6c;
		--surface-container-highest: #1f3d52;
		--surface-variant: #173244;
		--on-surface: #edf5ff;
		--on-error: #ffeff1;
		--on-tertiary: #fff4df;
		--surface-dim: #091521;
		--on-primary-fixed-variant: #d8fff8;
		--error: #ff8a95;
		--on-background: #edf5ff;
		--on-tertiary-container: #fff0c4;
		--surface: #091521;
		--tertiary: #f0b91d;
		--on-primary-fixed: #052f2b;
		--on-secondary-fixed: #e8f2ff;
		--on-surface-variant: #bacbdd;
		--on-tertiary-fixed: #4a3400;
		--on-error-container: #ffd9dd;
		--tertiary-dim: #dba200;
		--tertiary-container: #5e4600;
		--inverse-primary: #00675c;
		--primary: #67efe0;
		--secondary-dim: #6baee9;
		--surface-container: #122636;
		--background: #091521;
		--primary-dim: #49d7c9;
		--on-primary: #073a35;
		--on-primary-container: #d8fff8;
		--body-overlay-a: rgba(91, 244, 222, 0.14);
		--body-overlay-b: rgba(240, 185, 29, 0.08);
		--body-top: #0d1a27;
		--body-bottom: #07111a;
		--card-bg: rgba(11, 24, 36, 0.82);
		--card-shadow: 0 22px 48px rgba(0, 0, 0, 0.35);
		--play-bg: rgba(16, 33, 46, 0.9);
		--play-shadow: 0 18px 42px rgba(0, 0, 0, 0.3);
		--stage-border: rgba(186, 203, 221, 0.16);
	}

	:global(body) {
		margin: 0;
		font-family: 'Plus Jakarta Sans', sans-serif;
		background:
			radial-gradient(circle at top left, var(--body-overlay-a), transparent 28%),
			radial-gradient(circle at top right, var(--body-overlay-b), transparent 25%),
			linear-gradient(180deg, var(--body-top) 0%, var(--background) 45%, var(--body-bottom) 100%);
		color: var(--on-background);
	}

	:global(*) {
		box-sizing: border-box;
	}

	:global(.material-symbols-outlined) {
		font-variation-settings:
			'FILL' 0,
			'wght' 400,
			'GRAD' 0,
			'opsz' 24;
	}

	.landing-shell {
		padding: 0 1.5rem 6rem;
	}

	.inline-auth-link {
		color: var(--on-surface-variant);
		text-decoration: none;
		font: inherit;
		font-weight: 700;
		background: none;
		border: 0;
		padding: 0;
		cursor: pointer;
		transition:
			color 160ms ease,
			transform 160ms ease,
			border-color 160ms ease;
	}

	.inline-auth-link:hover {
		color: var(--primary);
	}

	.primary-action {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.6rem;
		text-decoration: none;
		font-weight: 800;
		transition:
			transform 160ms ease,
			box-shadow 160ms ease,
			filter 160ms ease;
	}

	.primary-action:hover {
		transform: translateY(-1px) scale(1.01);
		filter: brightness(1.03);
	}

	.primary-action:disabled,
	.inline-auth-link:disabled {
		opacity: 0.65;
		cursor: wait;
	}

	.hero-auth-status {
		margin: 0;
		color: var(--error);
		font-weight: 600;
	}

	.hero {
		max-width: 78rem;
		margin: 0 auto;
		padding-top: 4rem;
		text-align: center;
	}

	.hero h1 {
		margin: 0;
		font-size: clamp(3.2rem, 8vw, 6.4rem);
		line-height: 0.95;
		letter-spacing: -0.06em;
	}

	.hero h1 span {
		color: var(--primary);
		font-style: italic;
	}

	.hero-copy p {
		max-width: 42rem;
		margin: 1.4rem auto 0;
		font-size: clamp(1rem, 2vw, 1.25rem);
		line-height: 1.7;
		color: var(--on-surface-variant);
	}

	.hero-mascot-copy {
		max-width: 22rem;
		text-align: left;
	}

	.hero-mascot-row {
		display: grid;
		grid-template-columns: minmax(0, 0.42fr) minmax(0, 0.58fr);
		align-items: center;
		gap: 2rem;
		max-width: 72rem;
		margin: 3.4rem auto 0;
	}

	.hero-mascot-kicker,
	.hero-mascot-text,
	.hero-mascot-prompt {
		margin: 0;
	}

	.hero-mascot-kicker {
		font-size: 0.82rem;
		font-weight: 800;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--primary);
	}

	.hero-mascot-text {
		margin-top: 0.6rem;
		font-size: 1.02rem;
		line-height: 1.65;
		color: var(--on-surface-variant);
	}

	.hero-mascot-prompt {
		margin-top: 0.8rem;
		font-size: 0.95rem;
		font-weight: 700;
		color: var(--primary);
	}

	.hero-stage {
		position: relative;
		overflow: hidden;
		width: 100%;
		margin: 0;
		aspect-ratio: 16 / 9;
		border-radius: 1.6rem;
		background:
			linear-gradient(135deg, rgba(91, 244, 222, 0.18), rgba(244, 246, 255, 0.75), rgba(252, 192, 37, 0.1)),
			var(--surface-container-low);
		box-shadow: 0 24px 60px rgba(33, 47, 66, 0.12);
	}

	.hero-orb {
		position: absolute;
		border-radius: 999px;
		filter: blur(55px);
		opacity: 0.85;
	}

	.orb-left {
		top: 3rem;
		left: 3rem;
		width: 8rem;
		height: 8rem;
		background: rgba(91, 244, 222, 0.45);
	}

	.orb-right {
		right: 3rem;
		bottom: 3rem;
		width: 12rem;
		height: 12rem;
		background: rgba(252, 192, 37, 0.22);
	}

	.stage-frame {
		position: absolute;
		inset: 0;
		border: 12px solid var(--stage-border);
		border-radius: 1.6rem;
		pointer-events: none;
	}

	.hero-actions {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1rem;
		margin-top: 3rem;
	}

	.primary-action {
		padding: 1.2rem 2.8rem;
		border-radius: 999px;
		background: var(--primary);
		color: var(--on-primary);
		font-size: 1.15rem;
		box-shadow: 0 4px 0 0 var(--primary-dim);
	}

	.primary-action:active {
		transform: translateY(4px);
		box-shadow: 0 0 0 0 var(--primary-dim);
	}

	.hero-actions p {
		margin: 0;
		font-size: 0.95rem;
		font-weight: 500;
		color: var(--on-surface-variant);
	}

	.inline-auth-link {
		color: var(--primary);
		text-decoration: underline;
		text-underline-offset: 0.25rem;
		text-decoration-color: rgba(0, 103, 92, 0.25);
	}

	.site-footer {
		padding: 3rem 1.5rem;
		background: #f8f7f4;
	}

	.footer-inner {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 2rem;
		max-width: 78rem;
		margin: 0 auto;
	}

	.footer-brand {
		display: grid;
		gap: 0.35rem;
	}

	.footer-brand span {
		font-size: 1.1rem;
		font-weight: 800;
		color: #0f8a79;
	}

	.footer-brand p {
		margin: 0;
		color: #78716c;
		font-size: 0.92rem;
	}

	@media (max-width: 960px) {
		.footer-inner {
			flex-direction: column;
			text-align: center;
		}
	}

	@media (max-width: 640px) {
		.landing-shell {
			padding-inline: 1rem;
		}

		.hero {
			padding-top: 2.4rem;
		}

		.hero-stage {
			margin-top: 2rem;
		}

		.hero-mascot-row {
			grid-template-columns: 1fr;
			gap: 1.25rem;
		}

		.hero-mascot-copy {
			max-width: 32rem;
			margin: 0 auto;
			text-align: center;
		}

		.primary-action {
			width: 100%;
		}
	}
</style>
