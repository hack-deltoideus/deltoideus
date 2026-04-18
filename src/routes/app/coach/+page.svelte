<script lang="ts">
	import { browser } from '$app/environment';
	import { onMount, tick } from 'svelte';
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

	let currentSession = $state<Session | null>(null);
	let currentUser = $state<User | null>(null);
	let authStatus = $state('');
	let isSigningIn = $state<OAuthProvider | null>(null);
	let helperQuestion = $state('');
	let helperStatus = $state('');
	let isAskingHelper = $state(false);
	let helperSource = $state<'gemini' | 'fallback' | ''>('');
	let helperPersona = $state<'calm-coach' | 'tough-love' | 'study-planner'>('calm-coach');
	let helperHistory = $state<Array<{ role: 'user' | 'assistant'; text: string }>>([]);
	let helperThread: HTMLDivElement | null = $state(null);

	const displayName = $derived(getDisplayName(currentUser));

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
					redirectTo: `${window.location.origin}/app/coach`
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

	async function scrollHelperToBottom() {
		await tick();

		if (!helperThread) {
			return;
		}

		helperThread.scrollTo({
			top: helperThread.scrollHeight,
			behavior: 'smooth'
		});
	}

	async function askGeminiHelper() {
		helperStatus = '';
		helperSource = '';

		const question = helperQuestion.trim();
		if (!question) {
			helperStatus = 'Add a question for Kelp first.';
			return;
		}

		isAskingHelper = true;

		try {
			const nextHistory: Array<{ role: 'user' | 'assistant'; text: string }> = [
				...helperHistory,
				{ role: 'user', text: question }
			];

			const response = await fetch('/api/gemini-helper', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({
					question,
					persona: helperPersona,
					history: helperHistory
				})
			});

			const payload = await response.json();
			if (!response.ok) {
				throw new Error(payload?.error ?? 'Failed to get helper response');
			}

			const reply = payload.reply ?? '';
			if (!reply) {
				throw new Error('Kelp returned an empty response.');
			}

			const updatedHistory: Array<{ role: 'user' | 'assistant'; text: string }> = [
				...nextHistory,
				{ role: 'assistant', text: reply }
			];
			helperHistory = updatedHistory.slice(-12);
			helperQuestion = '';
			void scrollHelperToBottom();
			helperSource = payload?.source === 'fallback' ? 'fallback' : 'gemini';
			helperStatus = payload?.warning ?? 'Kelp replied.';
		} catch (error) {
			helperStatus = describeError(error, 'Failed to ask helper.');
		} finally {
			isAskingHelper = false;
		}
	}

	function applyQuickPrompt(prompt: string) {
		helperQuestion = prompt;
	}

	function handleHelperComposerKeydown(event: KeyboardEvent) {
		if (event.key !== 'Enter' || event.shiftKey) {
			return;
		}

		event.preventDefault();
		void askGeminiHelper();
	}
</script>

<svelte:head>
	<title>Sanctuary | Kelp Coach</title>
</svelte:head>

{#if !currentUser}
	<SiteNav />
	<main class="auth-shell">
		<section class="auth-card">
			<p class="eyebrow">Kelp Coach</p>
			<h1>Sign in to open your dedicated coaching space.</h1>
			<p class="auth-copy">
				Kelp works best when it can stay with your conversation, so this screen is reserved for your signed-in session.
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
	<SiteNav />
	<main class="coach-shell">
		<section class="coach-hero">
			<div>
				<p class="eyebrow">AI Coach</p>
				<h1>Kelp, in a dedicated workspace</h1>
				<p class="hero-copy">
					Ask for grounding, planning, or perspective. The thread stays readable while the composer stays anchored.
				</p>
			</div>
			<div class="hero-actions">
				<a class="button button-subtle" href="/app">Back to dashboard</a>
			</div>
		</section>

		<AppSectionNav />

		<section class="coach-panel">
			<div class="coach-header">
				<div>
					<h2>Ask Kelp</h2>
					<p class="coach-subtitle">Support for {displayName}, one step at a time.</p>
				</div>

				<label class="persona-select">
					<span class="sr-only">Personality</span>
					<select bind:value={helperPersona}>
						<option value="calm-coach">Zen Master</option>
						<option value="tough-love">Strict Trainer</option>
						<option value="study-planner">Supportive Friend</option>
					</select>
				</label>
			</div>

			<div class="chat-shell" bind:this={helperThread}>
				{#if helperHistory.length > 0}
					{#each helperHistory as msg}
						<div class:chat-user={msg.role === 'user'} class="chat-bubble">
							<p class="chat-author">{msg.role === 'user' ? 'You' : 'Kelp'}</p>
							<p>{msg.text}</p>
						</div>
					{/each}
				{:else}
					<div class="chat-empty-state">
						<p class="chat-empty-title">Start the conversation when you're ready.</p>
						<p class="chat-empty-copy">Ask for grounding, planning, focus help, or a quick reset.</p>
					</div>
				{/if}

				{#if isAskingHelper}
					<div class="chat-bubble chat-bubble-status">
						<p class="chat-author">Kelp</p>
						<p>Thinking through this...</p>
					</div>
				{/if}
			</div>

			<div class="helper-composer">
				<div class="prompt-row" aria-label="Suggested prompts">
					<button class="prompt-chip" type="button" onclick={() => applyQuickPrompt('Help me focus')}>
						Help me focus
					</button>
					<button class="prompt-chip" type="button" onclick={() => applyQuickPrompt('Log a victory')}>
						Log a victory
					</button>
					<button class="prompt-chip" type="button" onclick={() => applyQuickPrompt('Quick breathwork')}>
						Quick breathwork
					</button>
				</div>

				<div class="message-row">
					<textarea
						class="message-input"
						bind:value={helperQuestion}
						placeholder="Message Kelp..."
						maxlength="700"
						rows="3"
						onkeydown={handleHelperComposerKeydown}
					></textarea>
					<button class="send-button" onclick={askGeminiHelper} disabled={isAskingHelper} aria-label="Send message">
						<span class="material-symbols-outlined">send</span>
					</button>
				</div>

				<div class="helper-meta">
					<p class="composer-hint">Press Enter to send. Shift+Enter adds a new line.</p>
					{#if helperSource}
						<p class="source-badge {helperSource === 'fallback' ? 'fallback' : 'live'}">
							{helperSource === 'fallback' ? 'Fallback Mode' : 'Live Gemini'}
						</p>
					{/if}
				</div>

				{#if helperStatus}
					<p class="inline-status">{helperStatus}</p>
				{/if}
			</div>
		</section>
	</main>
{/if}

<style>
	:global(:root) {
		--background: #f7f8fc;
		--surface: #f7f8fc;
		--surface-container-lowest: #ffffff;
		--surface-container: #e4ebf8;
		--on-surface: #20314b;
		--on-surface-variant: #5b6b84;
		--primary: #0a766a;
		--on-primary: #c1fff2;
		--secondary-container: #d7e4fb;
		--field-bg: rgba(255, 255, 255, 0.92);
		--field-border: rgba(180, 194, 216, 0.5);
		--chat-shell-bg: rgba(248, 250, 255, 0.82);
		--chat-bubble-bg: white;
		--prompt-chip-bg: white;
		--panel-bg: rgba(255, 255, 255, 0.88);
		--panel-border: rgba(180, 194, 216, 0.45);
		--body-overlay-a: rgba(64, 209, 182, 0.12);
		--body-overlay-b: rgba(137, 174, 235, 0.2);
		--body-top: #fbfcff;
		--body-bottom: #eef3fb;
		--shadow-soft: 0 16px 36px rgba(31, 47, 82, 0.08);
	}

	:global(:root[data-theme='dark']) {
		--background: #091521;
		--surface: #0b1723;
		--surface-container-lowest: #0d1c2a;
		--surface-container: #122636;
		--on-surface: #edf5ff;
		--on-surface-variant: #bacbdd;
		--primary: #67efe0;
		--on-primary: #073a35;
		--secondary-container: #1b455f;
		--field-bg: rgba(16, 33, 46, 0.96);
		--field-border: rgba(81, 103, 121, 0.42);
		--chat-shell-bg: rgba(13, 28, 40, 0.72);
		--chat-bubble-bg: rgba(16, 33, 46, 0.96);
		--prompt-chip-bg: rgba(16, 33, 46, 0.96);
		--panel-bg: rgba(11, 24, 36, 0.82);
		--panel-border: rgba(92, 111, 127, 0.3);
		--body-overlay-a: rgba(91, 244, 222, 0.14);
		--body-overlay-b: rgba(82, 120, 170, 0.18);
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

	.auth-shell,
	.coach-shell {
		max-width: 84rem;
		margin: 0 auto;
		padding: 1.25rem 1.5rem 3.2rem;
	}

	.auth-shell {
		min-height: 100vh;
		display: grid;
		place-items: center;
	}

	.auth-card,
	.coach-panel {
		background: var(--panel-bg);
		border: 1px solid var(--panel-border);
		border-radius: 1.75rem;
		box-shadow: var(--shadow-soft);
		backdrop-filter: blur(18px);
	}

	.auth-card {
		width: min(100%, 48rem);
		padding: 2rem;
	}

	.eyebrow,
	.chat-author {
		margin: 0 0 0.4rem;
		font-size: 0.78rem;
		font-weight: 800;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--on-surface-variant);
	}

	.auth-card h1,
	.coach-hero h1 {
		margin: 0;
		font-size: clamp(2.8rem, 5.8vw, 4.6rem);
		line-height: 0.98;
		letter-spacing: -0.05em;
		color: var(--primary);
		max-width: 12ch;
	}

	.auth-copy,
	.hero-copy,
	.coach-subtitle,
	.composer-hint {
		color: var(--on-surface-variant);
	}

	.auth-copy,
	.hero-copy {
		margin-top: 0.95rem;
		font-size: 1.1rem;
		line-height: 1.68;
		max-width: 40rem;
	}

	.auth-actions,
	.helper-meta,
	.coach-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		flex-wrap: wrap;
	}

	.auth-actions {
		margin-top: 1.4rem;
	}

	.button,
	.prompt-chip,
	.send-button,
	.persona-select select {
		font: inherit;
		border: 0;
	}

	.button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.55rem;
		padding: 0.92rem 1.16rem;
		border-radius: 1rem;
		text-decoration: none;
		cursor: pointer;
		background: var(--primary);
		color: var(--on-primary);
		font-weight: 800;
	}

	.button-subtle {
		background: var(--secondary-container);
		color: var(--on-surface);
	}

	.coach-hero {
		display: flex;
		align-items: end;
		justify-content: space-between;
		gap: 1.4rem;
		padding: 0.8rem 0.1rem 1.35rem;
	}

	.coach-panel {
		display: grid;
		grid-template-rows: auto minmax(0, 1fr) auto;
		gap: 1.15rem;
		min-height: calc(100vh - 16rem);
		padding: 1.55rem;
	}

	.coach-header h2 {
		margin: 0;
		font-size: clamp(2rem, 3vw, 2.5rem);
		line-height: 1.05;
	}

	.coach-subtitle {
		margin: 0.45rem 0 0;
	}

	.persona-select select,
	.message-input {
		width: 100%;
		border: 1px solid var(--field-border);
		border-radius: 1.15rem;
		padding: 0.95rem 1rem;
		color: var(--on-surface);
		background: var(--field-bg);
	}

	.chat-shell {
		display: flex;
		flex-direction: column;
		gap: 0.9rem;
		padding: 1.15rem;
		border-radius: 1.6rem;
		background: var(--chat-shell-bg);
		min-height: 18rem;
		max-height: 30rem;
		overflow-y: auto;
		scrollbar-gutter: stable;
	}

	.chat-bubble {
		max-width: 85%;
		padding: 1rem 1.05rem;
		border-radius: 1.2rem 1.2rem 1.2rem 0.4rem;
		background: var(--chat-bubble-bg);
		box-shadow: 0 8px 18px rgba(31, 47, 82, 0.06);
	}

	.chat-empty-state {
		display: grid;
		place-items: center;
		align-content: center;
		min-height: 100%;
		padding: 1.25rem;
		border: 1px dashed var(--field-border);
		border-radius: 1.3rem;
		text-align: center;
		color: var(--on-surface-variant);
	}

	.chat-empty-title,
	.chat-empty-copy {
		margin: 0;
	}

	.chat-empty-title {
		font-size: 1rem;
		font-weight: 700;
		color: var(--on-surface);
	}

	.chat-empty-copy {
		margin-top: 0.35rem;
		line-height: 1.55;
	}

	.chat-bubble-status {
		opacity: 0.84;
	}

	.chat-user {
		margin-left: auto;
		border-radius: 1.2rem 1.2rem 0.4rem 1.2rem;
		background: linear-gradient(135deg, rgba(10, 118, 106, 0.12), rgba(64, 209, 182, 0.22));
	}

	.chat-bubble p:last-child {
		margin: 0;
		line-height: 1.55;
	}

	.helper-composer {
		display: grid;
		gap: 0.9rem;
		padding: 1.1rem;
		border-radius: 1.6rem;
		background: color-mix(in srgb, var(--surface, #ffffff) 92%, transparent);
		border: 1px solid var(--field-border);
		backdrop-filter: blur(16px);
	}

	.prompt-row {
		display: flex;
		gap: 0.65rem;
		overflow-x: auto;
		padding-bottom: 0.15rem;
		scrollbar-width: none;
	}

	.prompt-row::-webkit-scrollbar {
		display: none;
	}

	.prompt-chip {
		flex: 0 0 auto;
		padding: 0.72rem 0.98rem;
		border-radius: 999px;
		background: var(--prompt-chip-bg);
		color: var(--primary);
		font-size: 0.78rem;
		font-weight: 800;
		cursor: pointer;
		box-shadow: 0 6px 16px rgba(31, 47, 82, 0.06);
	}

	.message-row {
		position: relative;
	}

	.message-input {
		min-height: 5rem;
		padding: 1rem 4.2rem 1rem 1rem;
		border-radius: 1.35rem;
		line-height: 1.55;
		resize: none;
	}

	.send-button {
		position: absolute;
		right: 0.55rem;
		bottom: 0.55rem;
		display: grid;
		place-items: center;
		width: 2.75rem;
		height: 2.75rem;
		border-radius: 0.95rem;
		background: var(--primary);
		color: white;
		cursor: pointer;
		box-shadow: 0 10px 18px rgba(10, 118, 106, 0.22);
	}

	.composer-hint,
	.inline-hint,
	.inline-status {
		margin: 0;
		font-size: 0.86rem;
		line-height: 1.5;
	}

	.source-badge {
		display: inline-flex;
		align-items: center;
		padding: 0.45rem 0.8rem;
		border-radius: 999px;
		font-size: 0.78rem;
		font-weight: 800;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		border: 1px solid rgba(160, 174, 197, 0.34);
	}

	.source-badge.live {
		background: rgba(91, 244, 222, 0.16);
		color: var(--primary);
	}

	.source-badge.fallback {
		background: rgba(252, 192, 37, 0.18);
		color: #8a5d00;
	}

	.inline-status {
		color: var(--on-surface);
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		border: 0;
	}

	@media (max-width: 820px) {
		.coach-shell,
		.auth-shell {
			padding-inline: 1rem;
		}

		.coach-hero {
			flex-direction: column;
			align-items: start;
		}

		.coach-hero h1 {
			max-width: none;
		}

		.coach-panel {
			min-height: calc(100vh - 12rem);
			padding: 1rem;
		}
	}
</style>
