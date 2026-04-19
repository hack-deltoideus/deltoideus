export type BeatVertexId = 'baseline' | 'p' | 'q' | 'r' | 's' | 't';

export type BeatTemplatePoint = {
	id: BeatVertexId;
	t: number;
	y: number;
};

export type BeatAmplitudeProfile = Record<BeatVertexId, number>;

export const syntheticBeatTemplate: BeatTemplatePoint[] = [
	{ id: 'baseline', t: 0, y: 0 },
	{ id: 'baseline', t: 0.08, y: 0 },
	{ id: 'p', t: 0.16, y: 0.11 },
	{ id: 'baseline', t: 0.23, y: 0 },
	{ id: 'q', t: 0.29, y: -0.12 },
	{ id: 'r', t: 0.32, y: 1 },
	{ id: 's', t: 0.355, y: -0.3 },
	{ id: 'baseline', t: 0.43, y: 0 },
	{ id: 't', t: 0.65, y: 0.24 },
	{ id: 'baseline', t: 0.82, y: 0 },
	{ id: 'baseline', t: 1, y: 0 }
];

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

function smoothstep(value: number): number {
	return value * value * (3 - 2 * value);
}

export function deriveAmplitudeProfile(rrMs: number, heartRate: number): BeatAmplitudeProfile {
	const rrInfluence = clamp((900 - rrMs) / 380, -1, 1);
	const hrInfluence = clamp((heartRate - 72) / 42, -1, 1);
	const combined = clamp(rrInfluence * 0.72 + hrInfluence * 0.28, -1, 1);

	return {
		baseline: 0,
		p: 0.1 * (1 + combined * 0.08),
		q: -0.12 * (1 + combined * 0.16),
		r: 1 * (1 + combined * 0.34),
		s: -0.3 * (1 + combined * 0.2),
		t: 0.24 * (1 - combined * 0.08)
	};
}

export function sampleSyntheticBeat(
	phase: number,
	profile: BeatAmplitudeProfile,
	template: BeatTemplatePoint[] = syntheticBeatTemplate
): number {
	const normalizedPhase = clamp(phase, 0, 1);
	const points = template.map((point) => ({
		t: point.t,
		y: point.id === 'baseline' ? 0 : profile[point.id]
	}));

	if (normalizedPhase <= points[0].t) {
		return points[0].y;
	}

	for (let index = 0; index < points.length - 1; index += 1) {
		const left = points[index];
		const right = points[index + 1];

		if (normalizedPhase <= right.t) {
			const localProgress = (normalizedPhase - left.t) / Math.max(right.t - left.t, 0.0001);
			const easedProgress = smoothstep(localProgress);
			return left.y + (right.y - left.y) * easedProgress;
		}
	}

	return points.at(-1)?.y ?? 0;
}
