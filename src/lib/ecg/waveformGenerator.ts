import type { WaveVisualParams } from '$lib/ecg/waveformTypes';
import { BEAT_TEMPLATE, clamp, lerp, WAVEFORM_CONFIG } from '$lib/ecg/waveformUtils';

export type PreparedWaveBeat = {
	template: Array<{ x: number; y: number }>;
	amplitudePx: number;
	durationMs: number;
};

function warpTemplate(
	template: typeof BEAT_TEMPLATE,
	params: WaveVisualParams,
	seed: number
) {
	const widthScale = params.pulseWidth / WAVEFORM_CONFIG.basePulseWidth;
	const jitterStrength = params.jitter * 0.01;
	const energyScale = 0.85 + params.energy * 0.45;

	return template.map((point, index) => {
		const center = 0.32;
		const widthAdjustedX = clamp(center + (point.x - center) * widthScale, 0, 1);
		let y: number = point.y;

		if (index === 2) {
			y = params.preBump;
		} else if (index === 3) {
			y = -params.preBump * (0.68 + params.energy * 0.08);
		} else if (index === 4) {
			y = point.y * energyScale;
		} else if (index === 5) {
			y = -params.postDip * (0.92 + params.energy * 0.18);
		} else if (index === 6) {
			y = params.postDip * (0.48 + params.energy * 0.12);
		}

		const jitter =
			index > 1 && index < template.length - 2
				? Math.sin(seed * 0.003 + index * 0.9) * jitterStrength
				: 0;

		return {
			x: widthAdjustedX,
			y: y + jitter
		};
	});
}

function sampleTemplate(
	template: Array<{ x: number; y: number }>,
	progress: number
): number {
	const clampedProgress = clamp(progress, 0, 1);

	for (let index = 0; index < template.length - 1; index += 1) {
		const left = template[index];
		const right = template[index + 1];

		if (clampedProgress <= right.x) {
			const local = (clampedProgress - left.x) / Math.max(right.x - left.x, 0.0001);
			return lerp(left.y, right.y, local);
		}
	}

	return template.at(-1)?.y ?? 0;
}

export function sampleIdleOffset(worldX: number, time: number): number {
	return (
		Math.sin((worldX + time * 0.08) * 0.02) * WAVEFORM_CONFIG.idleNoiseAmplitude +
		Math.sin((worldX + time * 0.05) * 0.009) * WAVEFORM_CONFIG.idleNoiseAmplitude * 0.7
	);
}

export function prepareBeat(params: WaveVisualParams, seed: number): PreparedWaveBeat {
	return {
		template: warpTemplate(BEAT_TEMPLATE, params, seed),
		amplitudePx: params.amplitude * (2.9 + params.energy * 0.35),
		durationMs: clamp(params.beatIntervalMs * 0.62, 300, 980)
	};
}

export function sampleBeatOffset(beat: PreparedWaveBeat, progress: number): number {
	const normalizedY = sampleTemplate(beat.template, progress);
	return normalizedY * beat.amplitudePx;
}
