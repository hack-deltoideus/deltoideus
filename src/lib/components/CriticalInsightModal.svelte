<script lang="ts">
	let {
		visible = false,
		score = 0,
		onTakeBreak = () => {},
		onAcknowledge = () => {}
	}: {
		visible?: boolean;
		score?: number;
		onTakeBreak?: () => void;
		onAcknowledge?: () => void;
	} = $props();
</script>

{#if visible}
	<div class="overlay" role="presentation">
		<div
			class="modal-card"
			role="alertdialog"
			aria-modal="true"
			aria-labelledby="critical-insight-title"
			aria-describedby="critical-insight-copy"
		>
			<div class="icon-wrap" aria-hidden="true">
				<div class="icon-inner">!</div>
			</div>

			<h2 id="critical-insight-title">Stress-score check-in</h2>
			<p id="critical-insight-copy" class="copy">
				Your stress score has stayed above <span>60</span> and currently reads
				<span>{score}</span>. Since this is a seated study session, pause for a quick reset
				and label whether this felt stressful, like normal focus, or like a caffeine, sleep, or illness effect.
			</p>

			<div class="actions">
				<button class="button button-break" type="button" onclick={onTakeBreak}>
					Take a break
				</button>
				<button class="button button-ack" type="button" onclick={onAcknowledge}>
					Acknowledge
				</button>
			</div>

			<p class="footer">Recovery prompt active</p>
		</div>
	</div>
{/if}

<style>
	.overlay {
		position: fixed;
		inset: 0;
		z-index: 1100;
		display: grid;
		place-items: center;
		padding: 1.25rem;
		background: rgba(14, 24, 38, 0.46);
		backdrop-filter: blur(8px);
	}

	.modal-card {
		width: min(100%, 22.5rem);
		padding: 1.55rem 1.35rem 1.2rem;
		border-radius: 2rem;
		background: rgba(255, 255, 255, 0.97);
		box-shadow: 0 28px 72px rgba(14, 24, 38, 0.28);
		text-align: center;
	}

	.icon-wrap {
		width: 5.1rem;
		height: 5.1rem;
		margin: 0 auto 1rem;
		display: grid;
		place-items: center;
		border-radius: 999px;
		background: rgba(229, 57, 53, 0.14);
	}

	.icon-inner {
		width: 2.6rem;
		height: 2.6rem;
		display: grid;
		place-items: center;
		border-radius: 999px;
		background: #bf1f2f;
		color: white;
		font-size: 1.45rem;
		font-weight: 800;
	}

	h2 {
		margin: 0;
		font-size: 2rem;
		line-height: 1.02;
		color: #24344d;
	}

	.copy {
		margin: 1rem 0 0;
		font-size: 1rem;
		line-height: 1.65;
		color: #5c6f89;
	}

	.copy span {
		color: #d32f2f;
		font-weight: 800;
	}

	.actions {
		margin-top: 1.4rem;
		display: grid;
		gap: 0.85rem;
	}

	.button {
		border: 0;
		border-radius: 999px;
		padding: 1rem 1.15rem;
		font: inherit;
		font-size: 1.05rem;
		font-weight: 800;
		cursor: pointer;
		transition:
			transform 0.18s ease,
			box-shadow 0.18s ease,
			opacity 0.18s ease;
	}

	.button:hover {
		transform: translateY(-1px);
	}

	.button:active {
		transform: translateY(1px);
	}

	.button-break {
		background: linear-gradient(180deg, #118377, #0f7c71);
		color: white;
		box-shadow: 0 6px 0 #49ccb7;
	}

	.button-ack {
		background: #bcd0f5;
		color: #24344d;
	}

	.footer {
		margin: 1.1rem 0 0;
		font-size: 0.82rem;
		font-weight: 800;
		letter-spacing: 0.18em;
		text-transform: uppercase;
		color: #5c6f89;
	}

	@media (max-width: 480px) {
		.modal-card {
			padding: 1.35rem 1rem 1rem;
			border-radius: 1.6rem;
		}

		h2 {
			font-size: 1.75rem;
		}
	}
</style>
