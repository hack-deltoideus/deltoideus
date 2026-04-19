import { deriveAmplitudeProfile, sampleSyntheticBeat } from '$lib/ecg/template';
import type { BeatGeometry, EcgSample } from '$lib/ecg/types';

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

export function createBeatGeometry(sample: EcgSample, height: number): BeatGeometry {
	const rrMs = clamp(sample.rrMs, 420, 1320);
	const heartRate = clamp(sample.heartRate, 48, 148);
	const profile = deriveAmplitudeProfile(rrMs, heartRate);
	const beatEnergy = clamp(((heartRate - 72) / 42) * 0.45 + ((900 - rrMs) / 420) * 0.55, -1, 1);

	return {
		durationMs: clamp(rrMs * 0.34, 190, 460),
		amplitudePx: height * (0.22 + beatEnergy * 0.025),
		profile: {
			p: profile.p,
			q: profile.q,
			r: profile.r,
			s: profile.s,
			t: profile.t
		}
	};
}

export function beatValueAtProgress(progress: number, geometry: BeatGeometry): number {
	return sampleSyntheticBeat(progress, {
		baseline: 0,
		p: geometry.profile.p,
		q: geometry.profile.q,
		r: geometry.profile.r,
		s: geometry.profile.s,
		t: geometry.profile.t
	});
}
