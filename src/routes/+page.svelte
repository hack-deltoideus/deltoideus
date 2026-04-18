<svelte:head>
	<title>Sanctuary | Your Space for Peace</title>
</svelte:head>

<script lang="ts">
	const navLinks = [
		{ label: 'Features', href: '#features', active: true },
		{ label: 'Science', href: '#science' },
		{ label: 'Journal', href: '#journal' },
		{ label: 'Pricing', href: '#pricing' }
	];

	const footerLinks = [
		{ label: 'Privacy Policy', href: '#' },
		{ label: 'Terms of Service', href: '#' },
		{ label: 'Help Center', href: '#' },
		{ label: 'Contact Us', href: '#' }
	];
</script>

<main class="landing-shell">
	<header class="topbar">
		<nav class="topbar-inner">
			<a class="brand" href="/">Sanctuary</a>

			<div class="nav-links" aria-label="Primary">
				{#each navLinks as link}
					<a class:active={link.active} href={link.href}>{link.label}</a>
				{/each}
			</div>

			<a class="nav-cta" href="/app">Login</a>
		</nav>
	</header>

	<section class="hero">
		<div class="hero-copy">
			<h1>
				Your quiet corner
				<br />
				in a <span>noisy</span> world.
			</h1>
			<p>
				A sanctuary designed to help you breathe, reflect, and grow. Science-backed tools
				wrapped in an experience that feels like a soft exhale.
			</p>
		</div>

		<div class="hero-stage" aria-label="Experience the calm preview">
			<div class="hero-orb orb-left"></div>
			<div class="hero-orb orb-right"></div>
			<div class="play-center">
				<div class="play-button">
					<span class="material-symbols-outlined filled-icon">play_arrow</span>
				</div>
				<p>Experience the Calm</p>
			</div>
			<div class="stage-frame"></div>
		</div>

		<div class="hero-actions">
			<a class="primary-action" href="/app">
				<span>Login</span>
				<span class="material-symbols-outlined">arrow_forward</span>
			</a>
			<p>
				New here?
				<a href="#pricing">Join the waitlist</a>
			</p>
		</div>
	</section>

	<section class="bento-grid" id="features">
		<article class="bento-card bento-wide">
			<div>
				<h3>Mindful Journaling</h3>
				<p>
					Our AI-powered prompts help you dig deeper into your thoughts without the pressure
					of a blank page.
				</p>
			</div>
			<div class="tag-row">
				<span>Reflective</span>
				<span>Private</span>
			</div>
			<div class="card-bloom"></div>
		</article>

		<article class="bento-card bento-tertiary">
			<span class="material-symbols-outlined">colors_spark</span>
			<div>
				<h3>Growth Tracking</h3>
				<p>Visualize your progress with our kinetic mood maps.</p>
			</div>
		</article>

		<article class="bento-card bento-center" id="science">
			<div class="science-badge">
				<span class="material-symbols-outlined">verified_user</span>
			</div>
			<h3>Science First</h3>
			<p>Built with clinical psychologists for real results.</p>
		</article>

		<article class="bento-card bento-wide bento-split" id="journal">
			<div class="split-copy">
				<h3>A sanctuary for your eyes.</h3>
				<p>
					We've eliminated the clutter. No notifications, no social pressure. Just you and
					your thoughts.
				</p>
			</div>
			<div class="wireframe-panel">
				<div></div>
				<div></div>
				<div></div>
			</div>
		</article>
	</section>

	<section class="final-cta" id="pricing">
		<div class="dot-grid"></div>
		<div class="cta-content">
			<h2>Start your journey today.</h2>
			<p>
				Join thousands of others finding their daily balance in the Sanctuary.
			</p>
			<a class="secondary-action" href="/app">Get Started for Free</a>
		</div>
	</section>
</main>

<footer class="site-footer">
	<div class="footer-inner">
		<div class="footer-brand">
			<span>Sanctuary</span>
			<p>© 2024 Sanctuary Wellness. Designed for Peace.</p>
		</div>

		<div class="footer-links">
			{#each footerLinks as link}
				<a href={link.href}>{link.label}</a>
			{/each}
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
	}

	:global(body) {
		margin: 0;
		font-family: 'Plus Jakarta Sans', sans-serif;
		background:
			radial-gradient(circle at top left, rgba(91, 244, 222, 0.32), transparent 28%),
			radial-gradient(circle at top right, rgba(252, 192, 37, 0.12), transparent 25%),
			linear-gradient(180deg, #fbfdff 0%, var(--background) 45%, #eff5ff 100%);
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

	.filled-icon {
		font-variation-settings:
			'FILL' 1,
			'wght' 500,
			'GRAD' 0,
			'opsz' 24;
	}

	.landing-shell {
		padding: 0 1.5rem 6rem;
	}

	.topbar {
		position: sticky;
		top: 0;
		z-index: 50;
		padding-top: 1rem;
	}

	.topbar-inner {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		max-width: 78rem;
		margin: 0 auto;
		padding: 1rem 1.4rem;
		background: rgba(255, 255, 255, 0.48);
		backdrop-filter: blur(18px);
		border: 1px solid rgba(255, 255, 255, 0.6);
		border-radius: 999px;
		box-shadow: 0 10px 28px rgba(33, 47, 66, 0.08);
	}

	.brand {
		font-size: 1.6rem;
		font-weight: 800;
		letter-spacing: -0.06em;
		color: #0f8a79;
		text-decoration: none;
	}

	.nav-links {
		display: flex;
		align-items: center;
		gap: 1.8rem;
	}

	.nav-links a,
	.footer-links a,
	.hero-actions p a {
		color: var(--on-surface-variant);
		text-decoration: none;
		transition:
			color 160ms ease,
			transform 160ms ease,
			border-color 160ms ease;
	}

	.nav-links a:hover,
	.footer-links a:hover,
	.hero-actions p a:hover {
		color: var(--primary);
	}

	.nav-links a.active {
		color: var(--primary);
		font-weight: 700;
		padding-bottom: 0.35rem;
		border-bottom: 2px solid #14b8a6;
	}

	.nav-cta,
	.primary-action,
	.secondary-action {
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

	.nav-cta {
		padding: 0.8rem 1.5rem;
		border-radius: 999px;
		background: var(--primary);
		color: var(--on-primary);
	}

	.nav-cta:hover,
	.primary-action:hover,
	.secondary-action:hover {
		transform: translateY(-1px) scale(1.01);
		filter: brightness(1.03);
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

	.hero-stage {
		position: relative;
		overflow: hidden;
		max-width: 64rem;
		margin: 3rem auto 0;
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

	.play-center {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		align-content: center;
		gap: 1rem;
	}

	.play-button {
		display: grid;
		place-items: center;
		width: 6rem;
		height: 6rem;
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.65);
		backdrop-filter: blur(14px);
		color: var(--primary);
		box-shadow: 0 16px 35px rgba(33, 47, 66, 0.12);
	}

	.play-button .material-symbols-outlined {
		font-size: 2.2rem;
	}

	.play-center p {
		margin: 0;
		font-size: 0.82rem;
		font-weight: 700;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--on-surface-variant);
	}

	.stage-frame {
		position: absolute;
		inset: 0;
		border: 12px solid rgba(255, 255, 255, 0.45);
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

	.hero-actions p a {
		color: var(--primary);
		text-decoration: underline;
		text-underline-offset: 0.25rem;
		text-decoration-color: rgba(0, 103, 92, 0.25);
	}

	.bento-grid {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 1.5rem;
		max-width: 78rem;
		margin: 8rem auto 0;
	}

	.bento-card {
		position: relative;
		overflow: hidden;
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
		padding: 2.4rem;
		border-radius: 1.6rem;
		background: rgba(255, 255, 255, 0.78);
		box-shadow: 0 18px 40px rgba(33, 47, 66, 0.08);
	}

	.bento-card h3 {
		margin: 0 0 0.8rem;
		font-size: clamp(1.5rem, 3vw, 2rem);
		line-height: 1.05;
	}

	.bento-card p {
		margin: 0;
		color: var(--on-surface-variant);
		line-height: 1.65;
	}

	.bento-wide {
		grid-column: span 2;
	}

	.tag-row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.7rem;
	}

	.tag-row span {
		padding: 0.7rem 1rem;
		border-radius: 999px;
		background: var(--surface-container-high);
		font-size: 0.72rem;
		font-weight: 800;
		letter-spacing: 0.14em;
		text-transform: uppercase;
	}

	.card-bloom {
		position: absolute;
		right: -3rem;
		bottom: -3rem;
		width: 12rem;
		height: 12rem;
		border-radius: 999px;
		background: rgba(0, 103, 92, 0.05);
		transition: transform 400ms ease;
	}

	.bento-card:hover .card-bloom {
		transform: scale(1.25);
	}

	.bento-tertiary {
		background: var(--tertiary-container);
		color: var(--on-tertiary-container);
	}

	.bento-tertiary p,
	.bento-tertiary h3 {
		color: inherit;
	}

	.bento-tertiary .material-symbols-outlined {
		font-size: 2.5rem;
	}

	.bento-center {
		align-items: center;
		justify-content: center;
		text-align: center;
		background: var(--surface-container-highest);
	}

	.science-badge {
		display: grid;
		place-items: center;
		width: 4rem;
		height: 4rem;
		border-radius: 999px;
		background: white;
		color: var(--primary);
		box-shadow: 0 10px 20px rgba(33, 47, 66, 0.08);
	}

	.bento-split {
		flex-direction: row;
		align-items: center;
		gap: 2rem;
		padding: 0.45rem;
		background: white;
	}

	.split-copy {
		flex: 1;
		padding: 2rem;
	}

	.wireframe-panel {
		flex: 1;
		display: grid;
		gap: 1rem;
		padding: 2rem;
		border-radius: 1.75rem;
		background: var(--surface-container-low);
	}

	.wireframe-panel div {
		height: 1rem;
		border-radius: 999px;
		background: var(--surface-container);
	}

	.wireframe-panel div:nth-child(1) {
		width: 74%;
	}

	.wireframe-panel div:nth-child(2) {
		width: 52%;
	}

	.wireframe-panel div:nth-child(3) {
		width: 84%;
	}

	.final-cta {
		position: relative;
		overflow: hidden;
		max-width: 64rem;
		margin: 8rem auto 0;
		padding: 5rem 2rem;
		border-radius: 1.7rem;
		background: var(--primary);
		color: var(--on-primary);
		text-align: center;
	}

	.dot-grid {
		position: absolute;
		inset: 0;
		opacity: 0.1;
		background-image: radial-gradient(circle at 2px 2px, white 1px, transparent 0);
		background-size: 24px 24px;
	}

	.cta-content {
		position: relative;
		z-index: 1;
	}

	.final-cta h2 {
		margin: 0;
		font-size: clamp(2.2rem, 5vw, 4rem);
		line-height: 1;
	}

	.final-cta p {
		max-width: 38rem;
		margin: 1.25rem auto 0;
		font-size: 1.1rem;
		line-height: 1.7;
		color: rgba(193, 255, 242, 0.84);
	}

	.secondary-action {
		margin-top: 2rem;
		padding: 1rem 2.2rem;
		border-radius: 999px;
		background: white;
		color: var(--primary);
		font-size: 1.05rem;
		box-shadow: 0 18px 30px rgba(0, 0, 0, 0.15);
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

	.footer-links {
		display: flex;
		flex-wrap: wrap;
		gap: 1.4rem;
	}

	@media (max-width: 960px) {
		.nav-links {
			display: none;
		}

		.bento-grid {
			grid-template-columns: 1fr;
		}

		.bento-wide {
			grid-column: span 1;
		}

		.bento-split {
			flex-direction: column;
			padding: 1.25rem;
		}

		.split-copy,
		.wireframe-panel {
			width: 100%;
			padding: 1.25rem;
		}

		.footer-inner {
			flex-direction: column;
			text-align: center;
		}
	}

	@media (max-width: 640px) {
		.landing-shell {
			padding-inline: 1rem;
		}

		.topbar-inner {
			padding: 0.9rem 1rem;
		}

		.nav-cta {
			padding-inline: 1rem;
		}

		.hero {
			padding-top: 2.4rem;
		}

		.hero-stage {
			margin-top: 2rem;
		}

		.bento-card,
		.final-cta {
			padding-inline: 1.25rem;
		}

		.primary-action,
		.secondary-action {
			width: 100%;
		}
	}
</style>
