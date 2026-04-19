import type { NormalizedHeartSample } from '$lib/ecg/waveformTypes';

export const WAVEFORM_CONFIG = {
	baselineSampleCount: 5,
	signalLostTimeoutMs: 3000,
	signalLostFadeMs: 1800,
	hrScale: 15,
	rrScale: 140,
	smoothingHr: 0.18,
	smoothingRr: 0.16,
	baseAmplitude: 18,
	amplitudeGain: 20,
	basePulseWidth: 26,
	widthGain: 16,
	idleNoiseAmplitude: 1.2
} as const;

export const BEAT_TEMPLATE = [
	{ x: 0.0, y: 0.0 },
	{ x: 0.1, y: 0.0 },
	{ x: 0.18, y: 0.08 },
	{ x: 0.24, y: -0.05 },
	{ x: 0.3, y: 1.0 },
	{ x: 0.36, y: -0.35 },
	{ x: 0.48, y: 0.18 },
	{ x: 0.62, y: 0.03 },
	{ x: 0.8, y: 0.0 },
	{ x: 1.0, y: 0.0 }
] as const;

export function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

export function avg(values: number[]): number {
	if (values.length === 0) {
		return 0;
	}

	return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function lerp(a: number, b: number, t: number): number {
	return a + (b - a) * t;
}

export function normalizeRr(rr: number[] | number | null): number | null {
	if (Array.isArray(rr)) {
		const validValues = rr.filter((value) => Number.isFinite(value));
		return validValues.length > 0 ? avg(validValues) : null;
	}

	return typeof rr === 'number' && Number.isFinite(rr) ? rr : null;
}

export function isValidHeartSample(sample: NormalizedHeartSample): boolean {
	return (
		Number.isFinite(sample.hr) &&
		Number.isFinite(sample.rr) &&
		sample.hr >= 30 &&
		sample.hr <= 220 &&
		sample.rr >= 250 &&
		sample.rr <= 2000
	);
}

export function toSmoothSvgPath(points: Array<{ x: number; y: number }>): string {
	if (points.length === 0) {
		return '';
	}

	if (points.length === 1) {
		return `M${points[0].x.toFixed(2)},${points[0].y.toFixed(2)}`;
	}

	let path = `M${points[0].x.toFixed(2)},${points[0].y.toFixed(2)}`;

	for (let index = 1; index < points.length - 1; index += 1) {
		const current = points[index];
		const next = points[index + 1];
		const midpointX = (current.x + next.x) / 2;
		const midpointY = (current.y + next.y) / 2;
		path += ` Q${current.x.toFixed(2)},${current.y.toFixed(2)} ${midpointX.toFixed(2)},${midpointY.toFixed(2)}`;
	}

	const secondLast = points[points.length - 2];
	const last = points[points.length - 1];
	path += ` Q${secondLast.x.toFixed(2)},${secondLast.y.toFixed(2)} ${last.x.toFixed(2)},${last.y.toFixed(2)}`;

	return path;
}
