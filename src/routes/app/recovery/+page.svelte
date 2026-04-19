<script lang="ts">
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { hasSupabaseConfig, supabase } from '$lib/supabase';
	import type { Session, User } from '@supabase/supabase-js';

	type SupabaseLikeError = {
		message?: string;
		details?: string;
		hint?: string;
		code?: string;
	};

	type OAuthProvider = 'google';
	type RecoveryModal = 'breathing' | 'guide' | 'grounding' | 'movement' | 'pressure' | null;

	let currentSession = $state<Session | null>(null);
	let currentUser = $state<User | null>(null);
	let authStatus = $state('');
	let isSigningIn = $state<OAuthProvider | null>(null);
	let activeModal = $state<RecoveryModal>(null);
	let currentBreathPhase = $state(0);

	const breathPhases = [
		{ label: 'Inhale...', detail: 'Inhale through your nose for 4 seconds.', durationMs: 4000 },
		{ label: 'Hold...', detail: 'Hold your breath for 7 seconds.', durationMs: 7000 },
		{ label: 'Exhale...', detail: 'Release slowly for 8 seconds. Exhale through your mouth and feel your tension release.', durationMs: 8000 }
	] as const;

	const displayName = $derived(getDisplayName(currentUser));
	const currentBreathDuration = $derived(breathPhases[currentBreathPhase]?.durationMs ?? 4000);
	const modalTitle = $derived(
		activeModal === 'breathing'
			? '4-7-8 Breath'
			: activeModal === 'guide'
				? '5-Min Focus Guide'
				: activeModal === 'grounding'
			? '5-4-3-2-1 Reset'
			: activeModal === 'movement'
				? 'Movement Reset'
				: activeModal === 'pressure'
					? 'Pressure Reset'
					: ''
	);
	const modalBody = $derived(
		activeModal === 'guide'
			? [
					'Use this short guide to calm your stress and regain some clarity.',
					'<strong>Press play when you&apos;re ready.</strong>'
				]
			: activeModal === 'movement'
			? [
					'Use gentle movement to release pent-up tension in your body.',
					'Try <strong>shaking out your arms</strong>, <strong>stretching</strong>, <strong>taking a short walk</strong>, or other light movements.',
					'These exercises help release excess energy and reconnect you with your body and the present moment.'
				]
			: activeModal === 'pressure'
				? [
					'Body Pressing or tensing can create a strong sense of stability and calm.',
					'Some options are to <strong>press your hands against a wall</strong>, <strong>clench your fists tightly for 10 seconds</strong>, or <strong>push your feet firmly into the ground</strong>.', 
					'Deep pressure, like a <strong>weighted blanket</strong>, or a <strong>tight hug</strong>, can also help your body feel more calm.'
				]
				: activeModal === 'grounding'
					? [
						'Use your senses to anchor yourself in the present moment.',
						'Notice:',
						'5 things you can see',
						'4 things you can feel',
						'3 things you can hear',
						'2 things you can smell',
						'1 thing you can taste',
						'This technique gently shifts your focus away from overwhelming thoughts and back to your surroundings.'
					]
					: []
	);

	$effect(() => {
		if (activeModal !== 'breathing') {
			currentBreathPhase = 0;
			return;
		}

		currentBreathPhase = 0;
		let timeoutId: number;
		let cancelled = false;

		const runPhaseLoop = (phaseIndex: number) => {
			if (cancelled) {
				return;
			}

			currentBreathPhase = phaseIndex;
			timeoutId = window.setTimeout(() => {
				runPhaseLoop((phaseIndex + 1) % breathPhases.length);
			}, breathPhases[phaseIndex]?.durationMs ?? 4000);
		};

		runPhaseLoop(0);

		return () => {
			cancelled = true;
			window.clearTimeout(timeoutId);
		};
	});

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
					redirectTo: `${window.location.origin}/app/recovery`
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

	async function openPanicRelief() {
		await goto('/app/sensor');
	}

	function openModal(modal: Exclude<RecoveryModal, null>) {
		activeModal = modal;
	}

	function openBreathing() {
		openModal('breathing');
	}

	function openGuide() {
		openModal('guide');
	}

	function closeModal() {
		activeModal = null;
	}
</script>

<svelte:head>
	<title>Recovery Support</title>
</svelte:head>

{#if !currentUser}
	<main class="auth-shell">
		<section class="auth-card">
			<p class="eyebrow">Reset Protocol</p>
			<h1>Sign in to enter the recovery sanctuary.</h1>
			<p class="auth-copy">
				This reset space is reserved for your live session so we can keep your recovery flow personal and uninterrupted.
			</p>

			<div class="auth-actions">
				<button class="primary-button" onclick={() => signInWithProvider('google')} disabled={isSigningIn !== null || !hasSupabaseConfig}>
					{isSigningIn === 'google' ? 'Connecting Google...' : 'Continue with Google'}
				</button>
			</div>

			{#if !hasSupabaseConfig}
				<p class="status-text">Set `PUBLIC_SUPABASE_URL` and `PUBLIC_SUPABASE_ANON_KEY` in `.env` first.</p>
			{/if}

			{#if authStatus}
				<p class="status-text">{authStatus}</p>
			{/if}
		</section>
	</main>
{:else}
	<main class="recovery-shell">
		<section class="hero-section">
			<div class="hero-copy">
				<a class="eyebrow badge badge-link" href="/app/sensor">
					<span class="material-symbols-outlined">monitor_heart</span>
					<span>Back to Live Data</span>
				</a>
				<h1>Recovery Support</h1>
				<p>
					Hi {displayName}. Take a deep breath, let's slow things down. 
					<br/>
					Below you will find options to help you reset. 
				</p>
			</div>

			<div class="hero-visual">
				<div class="hero-backdrop"></div>
				<img
					src="https://lh3.googleusercontent.com/aida/ADBb0uhukdwp-z-LXZF8jNUldQ-BTqafV_IQ6z2efF6GgK12xHa87IjAz_bwbk33zoJPpzhzSKt3tYselvjBryIdkJukqtnoUrbt9B4LcB-MJm6WyCF9Dxe7F6l4r0hcUJzlakf83sIZUqOvwkYYYf-C8wYEKJjNyBGhB5Z3CHSGlgdYTfRyftUYT0qkCoqgTLKXOruLGQ8MO40bk83BqmjijGv_m8fYIkq-Y_qOEOcC_LoRpwxOYyEHxMd0SDwyICp1cCMOJSiNU98Kgg"
					alt="Cute otter practicing mindful meditation"
				/>
			</div>
		</section>

		<section class="recovery-grid">
			<article class="recovery-card">
				<div>
					<div class="icon-circle primary">
						<span class="material-symbols-outlined filled">air</span>
					</div>
					<h2>4-7-8 Breath</h2>
					<p>A quick rhythmic session to calm the nervous system and lower cortisol.</p>
				</div>
				<button class="primary-button" onclick={openBreathing}>
					<span>Start Breathing</span>
				</button>
			</article>

			<article class="recovery-card tinted">
				<div>
					<div class="icon-circle soft">
						<span class="material-symbols-outlined">self_improvement</span>
					</div>
					<h2>5-Min Focus</h2>
					<p>A guided meditation session designed to clear brain fog and reset focus.</p>
				</div>
				<button class="secondary-button" onclick={openGuide}>
					<span>Open Guide</span>
				</button>
			</article>

			<article class="relief-card">
				<div>
					<div class="icon-circle white">
						<span class="material-symbols-outlined relief-icon">ac_unit</span>
					</div>
					<h2>Vagus Nerve Cooling</h2>
					<p>Intense cold stimulation triggers the parasympathetic nervous system to quickly calm racing thoughts,
					lower heart rate, and break the stress cycle. Some grounding techniques are found below.</p>

					<div class="relief-list">
						<div><span>Holding ice</span></div>
						<div><span>Splash cold water onto face</span></div>
						<div><span>Place ice pack on face, neck, or chest.</span></div>
					</div>
				</div>
			</article>

			<article class="physical-card">
				<div class="physical-copy">

					<h2>Physical Reset</h2>
					<p>Sometimes the mind resets through physical sensation. Try one of these anchors to reconnect with the present moment.</p>
					<div class="physical-actions">
						<button class="chip-button" onclick={() => openModal('grounding')}>
							<span class="material-symbols-outlined">accessibility_new</span>
							<span>5-4-3-2-1</span>
						</button>
						<button class="chip-button" onclick={() => openModal('movement')}>
							<span class="material-symbols-outlined">directions_walk</span>
							<span>Movement</span>
						</button>
						<button class="chip-button" onclick={() => openModal('pressure')}>
							<span class="material-symbols-outlined">back_hand</span>
							<span>Pressure</span>
						</button>
					</div>
				</div>
				<div class="physical-glow"></div>
			</article>
		</section>
	</main>

	{#if activeModal}
		<div
			class="modal-overlay"
			role="button"
			tabindex="0"
			aria-label="Close popup"
			onclick={(event) => {
				if (event.target === event.currentTarget) {
					closeModal();
				}
			}}
			onkeydown={(event) => {
				if (event.key === 'Escape' || event.key === 'Enter' || event.key === ' ') {
					event.preventDefault();
					closeModal();
				}
			}}
		>
			<div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="recovery-modal-title">
				<div class="modal-head">
					<div>
						<p class="eyebrow">Recovery Tool</p>
						<h3 id="recovery-modal-title">{modalTitle}</h3>
					</div>
					<button class="modal-close" type="button" aria-label="Close popup" onclick={closeModal}>
						<span class="material-symbols-outlined">close</span>
					</button>
				</div>

				{#if activeModal === 'breathing'}
					<div class="modal-copy breathing-copy">
						<div
							class={`breathing-orbit phase-${currentBreathPhase}`}
							style={`--breath-duration: ${currentBreathDuration}ms;`}
						>
							<div class="breathing-circle">
								<span>{breathPhases[currentBreathPhase]?.label}</span>
							</div>
						</div>
						<p class="breathing-detail">{breathPhases[currentBreathPhase]?.detail}</p>
					</div>
				{:else if activeModal === 'guide'}
					<div class="modal-copy">
						{#each modalBody as paragraph, index}
							{#if index === 1}
								<p>{@html paragraph}</p>
							{:else}
								<p>{paragraph}</p>
							{/if}
						{/each}

						<div class="guide-audio-card">
							<div class="guide-audio-icon">
								<span class="material-symbols-outlined">headset</span>
							</div>
							<div class="guide-audio-content">
								<audio class="guide-audio-player" controls preload="metadata">
									<source src="/recovery-breathing-meditation.mp3" type="audio/mpeg" />
									Your browser does not support the audio element.
								</audio>
							</div>
						</div>

						<div class="guide-steps">
							<p> Find a relaxed, comfortable position.</p>
							<p> Keep your back upright, but not too tight.</p>
							<p> Hands resting wherever they're comfortable..</p>
						</div>
					</div>
				{:else}
					<div class="modal-copy">
						{#each modalBody as paragraph, index}
							{#if activeModal === 'grounding' && index >= 2 && index <= 6}
								<p class="modal-sense-line">{paragraph}</p>
							{:else if activeModal === 'movement' && index === 1}
								<p>{@html paragraph}</p>
							{:else if activeModal === 'pressure' && (index === 1 || index === 2)}
								<p>{@html paragraph}</p>
							{:else}
								<p>{paragraph}</p>
							{/if}
						{/each}
					</div>
				{/if}

				<div class="modal-actions">
					<button class="primary-button" type="button" onclick={closeModal}>Done</button>
				</div>
			</div>
		</div>
	{/if}
{/if}

<style>
	:global(:root) {
		--background: #f4f6ff;
		--surface: #f4f6ff;
		--surface-container: #dce9ff;
		--surface-container-low: #eaf1ff;
		--surface-container-lowest: #ffffff;
		--surface-container-high: #d3e4ff;
		--surface-container-highest: #c9deff;
		--on-surface: #212f42;
		--on-surface-variant: #4e5c71;
		--primary: #00675c;
		--primary-dim: #005a50;
		--primary-container: #5bf4de;
		--on-primary: #c1fff2;
		--on-primary-container: #00594f;
		--secondary: #005da7;
		--secondary-container: #b7d3ff;
		--on-secondary-container: #004884;
		--tertiary: #0d9488;
		--tertiary-container: #ccfbf1;
		--on-tertiary-container: #0f766e;
		--outline: #6a788d;
		--outline-variant: #a0aec5;
		--error: #b31b25;
		--panel-bg: rgba(255, 255, 255, 0.82);
		--panel-border: rgba(160, 174, 197, 0.24);
		--body-overlay-a: rgba(91, 244, 222, 0.24);
		--body-overlay-b: rgba(183, 211, 255, 0.8);
		--body-top: #f8fbff;
		--body-bottom: #edf4ff;
		--shadow-soft: 0 20px 45px rgba(31, 47, 82, 0.12);
	}

	:global(:root[data-theme='dark']) {
		--background: #091521;
		--surface: #091521;
		--surface-container: #122636;
		--surface-container-low: #0f2231;
		--surface-container-lowest: #0d1c2a;
		--surface-container-high: #173244;
		--surface-container-highest: #1f3d52;
		--on-surface: #edf5ff;
		--on-surface-variant: #bacbdd;
		--primary: #52d8c0;
		--primary-dim: #34b7a5;
		--primary-container: #103f3a;
		--on-primary: #073a35;
		--on-primary-container: #d8fff8;
		--secondary: #7ebdb2;
		--secondary-container: #1b455f;
		--on-secondary-container: #d9ebff;
		--tertiary: #5eead4;
		--tertiary-container: #153f3b;
		--on-tertiary-container: #cffff6;
		--outline: #6f8396;
		--outline-variant: #465a6c;
		--error: #ff8a95;
		--panel-bg: rgba(11, 24, 36, 0.84);
		--panel-border: rgba(92, 111, 127, 0.32);
		--body-overlay-a: rgba(74, 211, 188, 0.14);
		--body-overlay-b: rgba(74, 128, 120, 0.12);
		--body-top: #0d1a27;
		--body-bottom: #07111a;
		--shadow-soft: 0 22px 48px rgba(0, 0, 0, 0.42);
	}

	:global(body) {
		margin: 0;
		font-family: 'Plus Jakarta Sans', sans-serif;
		background:
			radial-gradient(circle at top left, var(--body-overlay-a), transparent 32%),
			radial-gradient(circle at top right, var(--body-overlay-b), transparent 30%),
			linear-gradient(180deg, var(--body-top) 0%, var(--background) 40%, var(--body-bottom) 100%);
		color: var(--on-surface);
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

	.filled {
		font-variation-settings:
			'FILL' 1,
			'wght' 500,
			'GRAD' 0,
			'opsz' 24;
	}

	.auth-shell,
	.recovery-shell {
		max-width: 76rem;
		margin: 0 auto;
		padding: 2rem 1.5rem 4rem;
	}

	.auth-shell {
		min-height: 100vh;
		display: grid;
		place-items: center;
	}

	.auth-card,
	.recovery-card,
	.relief-card,
	.physical-card,
	.modal-card {
		background: var(--panel-bg);
		border: 1px solid var(--panel-border);
		border-radius: 2rem;
		box-shadow: var(--shadow-soft);
		backdrop-filter: blur(18px);
	}

	.auth-card {
		width: min(100%, 44rem);
		padding: 2rem;
	}

	.eyebrow {
		margin: 0;
		font-size: 0.76rem;
		font-weight: 800;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		color: var(--primary);
	}

	.badge {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		padding: 0.78rem 1.2rem;
		border-radius: 999px;
		background: linear-gradient(135deg, var(--primary), #128d7f);
		color: #ffffff;
		box-shadow: 0 6px 0 rgba(0, 103, 92, 0.22);
	}

	.badge-link {
		text-decoration: none;
		width: fit-content;
		text-transform: none;
		letter-spacing: normal;
		font-size: 0.98rem;
		font-weight: 800;
		transition:
			transform 160ms ease,
			box-shadow 160ms ease,
			filter 160ms ease;
	}

	.badge-link:hover {
		transform: translateY(-1px);
		filter: brightness(1.02);
	}

	.badge-link:active {
		transform: translateY(3px);
		box-shadow: none;
	}

	.auth-card h1,
	.hero-copy h1 {
		margin: 0.45rem 0 0;
		line-height: 0.96;
		letter-spacing: -0.05em;
	}

	.auth-card h1 {
		font-size: clamp(2.2rem, 5vw, 4rem);
		color: var(--primary);
	}

	.auth-copy,
	.status-text,
	.hero-copy p,
	.recovery-card p,
	.relief-card p,
	.physical-copy p {
		margin: 0;
		line-height: 1.65;
		color: var(--on-surface-variant);
	}

	.auth-actions {
		display: flex;
		gap: 0.85rem;
		margin-top: 1.5rem;
	}

	.hero-section {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(16rem, 22rem);
		gap: 2rem;
		align-items: center;
		margin-top: 1rem;
	}

	.hero-copy h1 {
		font-size: clamp(3rem, 8vw, 5.7rem);
		color: var(--primary);
	}

	.hero-copy p {
		margin-top: 1rem;
		max-width: 34rem;
		font-size: 1.15rem;
	}

	.hero-visual {
		position: relative;
		aspect-ratio: 1 / 1;
	}

	.hero-backdrop {
		position: absolute;
		inset: 0;
		border-radius: 1.6rem;
		background: var(--primary-container);
		opacity: 0.5;
		transform: rotate(3deg) scale(0.95);
	}

	.hero-visual img {
		position: relative;
		z-index: 1;
		width: 100%;
		height: 100%;
		object-fit: cover;
		border-radius: 1.6rem;
		box-shadow: 0 24px 48px rgba(33, 47, 66, 0.18);
	}

	.recovery-grid {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 1.3rem;
		margin-top: 2.5rem;
	}

	.recovery-card,
	.relief-card,
	.physical-card {
		padding: 1.8rem;
	}

	.recovery-card,
	.relief-card {
		display: flex;
		flex-direction: column;
		justify-content: space-between;
		gap: 1.4rem;
	}

	.recovery-card h2,
	.relief-card h2,
	.physical-copy h2 {
		margin: 0.8rem 0 0.45rem;
		font-size: clamp(1.8rem, 4vw, 2.4rem);
		line-height: 1;
		letter-spacing: -0.04em;
	}

	.recovery-card.tinted {
		background: color-mix(in srgb, var(--surface-container-high) 84%, transparent);
	}

	.icon-circle {
		width: 4rem;
		height: 4rem;
		display: grid;
		place-items: center;
		border-radius: 999px;
	}

	.icon-circle.primary {
		background: var(--primary-container);
		color: var(--primary);
	}

	.icon-circle.soft {
		background: var(--surface-container-highest);
		color: var(--primary);
	}

	.icon-circle.white {
		background: rgba(255, 255, 255, 0.92);
		color: var(--secondary);
	}

	.icon-circle .material-symbols-outlined {
		font-size: 2rem;
	}

	.primary-button,
	.secondary-button,
	.chip-button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.55rem;
		border: 0;
		text-decoration: none;
		cursor: pointer;
		font: inherit;
		font-weight: 800;
		transition:
			transform 160ms ease,
			box-shadow 160ms ease,
			background 160ms ease,
			color 160ms ease;
	}

	.primary-button {
		padding: 1rem 1.35rem;
		border-radius: 999px;
		color: #fff;
	}

	.primary-button {
		background: linear-gradient(135deg, var(--primary), #128d7f);
		box-shadow: 0 6px 0 var(--primary-dim);
	}

	.secondary-button {
		width: 100%;
		padding: 1rem 1.35rem;
		border-radius: 999px;
		background: var(--surface-container-lowest);
		color: var(--primary);
		border: 2px solid color-mix(in srgb, var(--primary) 20%, transparent);
	}

	.relief-card {
		grid-column: 3;
		grid-row: span 2;
		background: var(--secondary-container);
		color: var(--on-secondary-container);
	}

	.relief-card p {
		color: color-mix(in srgb, var(--on-secondary-container) 82%, transparent);
	}

	.relief-icon {
		color: var(--secondary);
	}

	.relief-list {
		display: grid;
		gap: 0.75rem;
		margin-top: 1.3rem;
	}

	.relief-list div {
		display: flex;
		align-items: center;
		gap: 0.8rem;
		padding: 0.95rem 1rem;
		border-radius: 1rem;
		background: rgba(255, 255, 255, 0.4);
		font-weight: 800;
	}

	.physical-card {
		position: relative;
		grid-column: span 2;
		overflow: hidden;
	}

	.physical-copy {
		position: relative;
		z-index: 1;
	}

	.physical-actions {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 0.75rem;
		margin-top: 1.5rem;
	}

	.chip-button {
		width: 100%;
		padding: 1rem 1.2rem;
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.9);
		color: var(--primary);
		box-shadow: 0 10px 18px rgba(33, 47, 66, 0.08);
	}

	.physical-glow {
		position: absolute;
		right: -4rem;
		bottom: -4rem;
		width: 16rem;
		height: 16rem;
		border-radius: 999px;
		background: color-mix(in srgb, var(--primary) 12%, transparent);
		filter: blur(30px);
	}

	.primary-button:hover,
	.secondary-button:hover,
	.chip-button:hover,
	.modal-close:hover {
		transform: translateY(-1px);
	}

	.primary-button:active,
	.secondary-button:active,
	.chip-button:active,
	.modal-close:active {
		transform: translateY(3px);
		box-shadow: none;
	}

	.primary-button:disabled {
		opacity: 0.6;
		cursor: wait;
	}

	.modal-overlay {
		position: fixed;
		inset: 0;
		z-index: 100;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1.5rem;
		background: rgba(1, 15, 32, 0.34);
		backdrop-filter: blur(14px);
	}

	.modal-card {
		width: min(100%, 36rem);
		padding: 1.6rem;
		background: rgba(255, 255, 255, 0.98);
		box-shadow: 0 28px 60px rgba(31, 47, 82, 0.22);
	}

	:global(:root[data-theme='dark']) .modal-card {
		background: rgba(13, 28, 42, 0.98);
	}

	.modal-head {
		display: flex;
		align-items: start;
		justify-content: space-between;
		gap: 1rem;
	}

	.modal-head h3 {
		margin: 0.35rem 0 0;
		font-size: clamp(1.8rem, 4vw, 2.4rem);
		line-height: 1;
		letter-spacing: -0.04em;
	}

	.modal-close {
		display: grid;
		place-items: center;
		width: 2.8rem;
		height: 2.8rem;
		border: 0;
		border-radius: 999px;
		background: var(--surface-container-low);
		color: var(--on-surface);
		cursor: pointer;
		transition:
			transform 160ms ease,
			background 160ms ease;
	}

	.modal-copy {
		display: grid;
		gap: 0.8rem;
		margin-top: 1.2rem;
	}

	.modal-copy p {
		margin: 0;
		line-height: 1.7;
		color: var(--on-surface-variant);
	}

	.breathing-copy {
		justify-items: center;
		text-align: center;
	}

	.breathing-orbit {
		display: grid;
		place-items: center;
		width: 15rem;
		height: 15rem;
		margin: 0.4rem auto 0;
		border-radius: 999px;
		background: radial-gradient(circle, rgba(91, 244, 222, 0.16), rgba(0, 103, 92, 0.04));
		animation-duration: var(--breath-duration, 4000ms);
		animation-timing-function: linear;
		animation-fill-mode: both;
	}

	.breathing-orbit.phase-0 {
		animation-name: orbit-inhale;
	}

	.breathing-orbit.phase-1 {
		animation-name: orbit-hold;
	}

	.breathing-orbit.phase-2 {
		animation-name: orbit-exhale;
	}

	.breathing-circle {
		display: grid;
		place-items: center;
		width: 9.25rem;
		height: 9.25rem;
		border-radius: 999px;
		background: linear-gradient(135deg, var(--primary), #128d7f);
		box-shadow:
			0 18px 34px rgba(0, 103, 92, 0.2),
			inset 0 0 0 0.35rem rgba(255, 255, 255, 0.2);
		color: white;
		font-weight: 800;
		font-size: 1.15rem;
		letter-spacing: -0.02em;
		animation-duration: var(--breath-duration, 4000ms);
		animation-timing-function: linear;
		animation-fill-mode: both;
	}

	.phase-0 .breathing-circle {
		animation-name: breathe-inhale;
	}

	.phase-1 .breathing-circle {
		animation-name: breathe-hold;
	}

	.phase-2 .breathing-circle {
		animation-name: breathe-exhale;
	}

	@keyframes breathe-inhale {
		from {
			transform: scale(0.86);
			box-shadow:
				0 12px 24px rgba(0, 103, 92, 0.16),
				inset 0 0 0 0.3rem rgba(255, 255, 255, 0.16);
		}

		to {
			transform: scale(1.18);
			box-shadow:
				0 22px 40px rgba(0, 103, 92, 0.26),
				inset 0 0 0 0.4rem rgba(255, 255, 255, 0.24);
		}
	}

	@keyframes breathe-hold {
		0%,
		100% {
			transform: scale(1.18);
			box-shadow:
				0 22px 40px rgba(0, 103, 92, 0.26),
				inset 0 0 0 0.4rem rgba(255, 255, 255, 0.24);
		}

		50% {
			transform: scale(1.2);
			box-shadow:
				0 24px 42px rgba(0, 103, 92, 0.28),
				inset 0 0 0 0.42rem rgba(255, 255, 255, 0.26);
		}
	}

	@keyframes breathe-exhale {
		from {
			transform: scale(1.18);
			box-shadow:
				0 22px 40px rgba(0, 103, 92, 0.26),
				inset 0 0 0 0.4rem rgba(255, 255, 255, 0.24);
		}

		to {
			transform: scale(0.86);
			box-shadow:
				0 12px 24px rgba(0, 103, 92, 0.16),
				inset 0 0 0 0.3rem rgba(255, 255, 255, 0.16);
		}
	}

	@keyframes orbit-inhale {
		from {
			transform: scale(1);
		}

		to {
			transform: scale(1.06);
		}
	}

	@keyframes orbit-hold {
		0%,
		100% {
			transform: scale(1.06);
		}

		50% {
			transform: scale(1.075);
		}
	}

	@keyframes orbit-exhale {
		from {
			transform: scale(1.06);
		}

		to {
			transform: scale(0.98);
		}
	}

	.breathing-detail {
		max-width: 22rem;
		text-align: center;
	}

	.guide-audio-card {
		display: flex;
		align-items: flex-start;
		gap: 0.9rem;
		padding: 0.8rem 0.9rem;
		border-radius: 1.2rem;
		background: color-mix(in srgb, var(--surface-container) 74%, white);
	}

	.guide-audio-content {
		flex: 1;
		min-width: 0;
	}

	.guide-audio-icon {
		display: grid;
		place-items: center;
		width: 3rem;
		height: 3rem;
		margin-top: 0.6rem;
		border-radius: 999px;
		background: var(--primary-container);
		color: var(--primary);
		flex-shrink: 0;
	}

	.guide-audio-title,
	.guide-audio-text {
		margin: 0;
	}

	.guide-audio-title {
		font-weight: 800;
		color: var(--on-surface);
	}

	.guide-audio-text {
		margin-top: 0.2rem;
		color: var(--on-surface-variant);
	}

	.guide-audio-player {
		width: min(100%, 34rem);
		margin-top: 0.25rem;
	}

	.guide-steps {
		display: grid;
		gap: 0.7rem;
	}

	.guide-step {
		padding: 0.9rem 1rem;
		border-radius: 1rem;
		background: color-mix(in srgb, var(--surface-container-low) 88%, white);
		color: var(--on-surface);
	}

	.modal-sense-line {
		padding-left: 0.2rem;
		color: var(--on-surface);
		font-weight: 700;
	}

	.modal-actions {
		margin-top: 1.4rem;
		display: flex;
		justify-content: flex-end;
	}

	@media (max-width: 980px) {
		.hero-section,
		.recovery-grid {
			grid-template-columns: 1fr;
		}

		.relief-card,
		.physical-card {
			grid-column: auto;
			grid-row: auto;
		}
	}

	@media (max-width: 640px) {
		.auth-shell,
		.recovery-shell {
			padding-inline: 1rem;
		}

		.physical-actions {
			grid-template-columns: 1fr;
		}

		.auth-card,
		.recovery-card,
		.relief-card,
		.physical-card,
		.modal-card {
			padding: 1.3rem;
			border-radius: 1.5rem;
		}
	}
</style>
