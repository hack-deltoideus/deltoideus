import { beatValueAtProgress, createBeatGeometry } from '$lib/ecg/beat';
import type { EcgSample, ScheduledBeat, StreamTrace } from '$lib/ecg/types';

type Point = {
	x: number;
	y: number;
};

export type ScheduleOptions = {
	height: number;
	initialDelayMs?: number;
	idlePaddingMs?: number;
};

export type RenderOptions = {
	width: number;
	height: number;
	leadRatio?: number;
	lookbackMs?: number;
	lookaheadMs?: number;
	pointsPerBeat?: number;
	baselineRatio?: number;
};

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

function lerp(left: number, right: number, ratio: number): number {
	return left + (right - left) * ratio;
}

function smoothstep(value: number): number {
	const clamped = clamp(value, 0, 1);
	return clamped * clamped * (3 - 2 * clamped);
}

function formatNumber(value: number): string {
	return value.toFixed(2);
}

function toSmoothPath(points: Point[]): string {
	if (points.length === 0) {
		return '';
	}

	if (points.length === 1) {
		return `M${formatNumber(points[0].x)},${formatNumber(points[0].y)}`;
	}

	let path = `M${formatNumber(points[0].x)},${formatNumber(points[0].y)}`;

	for (let index = 1; index < points.length - 1; index += 1) {
		const current = points[index];
		const next = points[index + 1];
		const midpointX = (current.x + next.x) / 2;
		const midpointY = (current.y + next.y) / 2;
		path += ` Q${formatNumber(current.x)},${formatNumber(current.y)} ${formatNumber(midpointX)},${formatNumber(midpointY)}`;
	}

	const secondLast = points[points.length - 2];
	const last = points[points.length - 1];
	path += ` Q${formatNumber(secondLast.x)},${formatNumber(secondLast.y)} ${formatNumber(last.x)},${formatNumber(last.y)}`;

	return path;
}

function baselineY(height: number, baselineRatio: number): number {
	return height * baselineRatio;
}

function buildBeatY(progress: number, beat: ScheduledBeat, height: number, baselineRatio: number): number {
	const baseline = baselineY(height, baselineRatio);
	const drift = Math.sin((beat.startTimeMs + beat.geometry.durationMs * progress) / 1450) * height * 0.003;
	return baseline - beatValueAtProgress(progress, beat.geometry) * beat.geometry.amplitudePx + drift;
}

function buildFlatlinePoint(timeMs: number, startTimeMs: number, endTimeMs: number, width: number, height: number, baselineRatio: number): Point {
	const x = ((timeMs - startTimeMs) / Math.max(endTimeMs - startTimeMs, 1)) * width;
	return {
		x,
		y: baselineY(height, baselineRatio)
	};
}

function sampleToPoint(
	timeMs: number,
	startTimeMs: number,
	endTimeMs: number,
	width: number,
	y: number
): Point {
	return {
		x: ((timeMs - startTimeMs) / Math.max(endTimeMs - startTimeMs, 1)) * width,
		y
	};
}

function appendPoint(points: Point[], point: Point) {
	const lastPoint = points.at(-1);
	if (lastPoint && Math.abs(lastPoint.x - point.x) < 0.01 && Math.abs(lastPoint.y - point.y) < 0.01) {
		return;
	}

	points.push(point);
}

function appendFlatlineSegment(
	points: Point[],
	segmentStartMs: number,
	segmentEndMs: number,
	viewportStartMs: number,
	viewportEndMs: number,
	width: number,
	height: number,
	baselineRatio: number
) {
	const startMs = Math.max(segmentStartMs, viewportStartMs);
	const endMs = Math.min(segmentEndMs, viewportEndMs);

	if (endMs <= startMs) {
		return;
	}

	appendPoint(points, buildFlatlinePoint(startMs, viewportStartMs, viewportEndMs, width, height, baselineRatio));
	appendPoint(points, buildFlatlinePoint(endMs, viewportStartMs, viewportEndMs, width, height, baselineRatio));
}

function appendBeatSegment(
	points: Point[],
	beat: ScheduledBeat,
	segmentStartMs: number,
	segmentEndMs: number,
	viewportStartMs: number,
	viewportEndMs: number,
	width: number,
	height: number,
	pointsPerBeat: number,
	baselineRatio: number
) {
	const startMs = Math.max(segmentStartMs, beat.startTimeMs, viewportStartMs);
	const endMs = Math.min(segmentEndMs, beat.endTimeMs, viewportEndMs);

	if (endMs <= startMs) {
		return;
	}

	for (let pointIndex = 0; pointIndex <= pointsPerBeat; pointIndex += 1) {
		const ratio = pointIndex / Math.max(pointsPerBeat, 1);
		const timeMs = lerp(startMs, endMs, ratio);
		const beatProgress = clamp((timeMs - beat.startTimeMs) / Math.max(beat.endTimeMs - beat.startTimeMs, 1), 0, 1);
		const easedProgress = smoothstep(beatProgress);
		const y = buildBeatY(easedProgress, beat, height, baselineRatio);
		appendPoint(points, sampleToPoint(timeMs, viewportStartMs, viewportEndMs, width, y));
	}
}

export function findBeatAtTime(schedule: ScheduledBeat[], timeMs: number): ScheduledBeat | null {
	for (const beat of schedule) {
		if (timeMs >= beat.startTimeMs && timeMs <= beat.endTimeMs) {
			return beat;
		}
	}

	return null;
}

export function findCurrentSample(schedule: ScheduledBeat[], timeMs: number): EcgSample | null {
	let current: EcgSample | null = null;

	for (const beat of schedule) {
		if (timeMs >= beat.startTimeMs) {
			current = beat.sample;
			continue;
		}

		break;
	}

	return current ?? schedule[0]?.sample ?? null;
}

export function buildBeatSchedule(
	samples: EcgSample[],
	options: ScheduleOptions
): ScheduledBeat[] {
	const { height, initialDelayMs = 420, idlePaddingMs = 620 } = options;

	if (samples.length === 0) {
		return [];
	}

	const schedule: ScheduledBeat[] = [];
	let cursorTimeMs = initialDelayMs;

	for (let index = 0; index < samples.length; index += 1) {
		const sample = samples[index];
		const nextSample = samples[index + 1] ?? null;
		const geometry = createBeatGeometry(sample, height);
		const nextSpacingMs = nextSample
			? clamp(sample.rrMs * 0.58 + nextSample.rrMs * 0.42, 460, 1380)
			: clamp(sample.rrMs, 460, 1380);
		const startTimeMs = cursorTimeMs;
		const endTimeMs = startTimeMs + geometry.durationMs;
		const nextStartTimeMs = startTimeMs + nextSpacingMs;

		schedule.push({
			sample,
			startTimeMs,
			endTimeMs,
			nextStartTimeMs,
			geometry
		});

		cursorTimeMs = nextStartTimeMs;
	}

	const lastBeat = schedule.at(-1);
	if (lastBeat) {
		lastBeat.nextStartTimeMs += idlePaddingMs;
	}

	return schedule;
}

export function getScheduleDurationMs(schedule: ScheduledBeat[]): number {
	if (schedule.length === 0) {
		return 0;
	}

	return schedule.at(-1)?.nextStartTimeMs ?? 0;
}

export function generateStreamTrace(
	schedule: ScheduledBeat[],
	currentTimeMs: number,
	options: RenderOptions
): StreamTrace {
	const {
		width,
		height,
		leadRatio = 0.68,
		lookbackMs = 2200,
		lookaheadMs = 900,
		pointsPerBeat = 48,
		baselineRatio = 0.58
	} = options;

	const totalDurationMs = getScheduleDurationMs(schedule);
	const safeCurrentTimeMs = clamp(currentTimeMs, 0, Math.max(0, totalDurationMs));
	const headRatio = clamp(leadRatio, 0.1, 0.9);
	const viewportDurationMs = lookbackMs + lookaheadMs;
	const startTimeMs = Math.max(0, safeCurrentTimeMs - viewportDurationMs * headRatio);
	const endTimeMs = startTimeMs + viewportDurationMs;
	const committedPoints: Point[] = [];
	const activePoints: Point[] = [];
	const activeBeat = findBeatAtTime(schedule, safeCurrentTimeMs);
	const currentSample = findCurrentSample(schedule, safeCurrentTimeMs);
	let previousBoundaryMs = startTimeMs;

	for (const beat of schedule) {
		if (beat.nextStartTimeMs < startTimeMs) {
			continue;
		}

		if (beat.startTimeMs > endTimeMs) {
			break;
		}

		appendFlatlineSegment(
			committedPoints,
			previousBoundaryMs,
			Math.min(beat.startTimeMs, safeCurrentTimeMs),
			startTimeMs,
			endTimeMs,
			width,
			height,
			baselineRatio
		);

		if (safeCurrentTimeMs > beat.startTimeMs) {
			const beatRenderEndMs = Math.min(beat.endTimeMs, safeCurrentTimeMs);
			const targetPoints = activeBeat?.startTimeMs === beat.startTimeMs ? activePoints : committedPoints;
			appendBeatSegment(
				targetPoints,
				beat,
				beat.startTimeMs,
				beatRenderEndMs,
				startTimeMs,
				endTimeMs,
				width,
				height,
				pointsPerBeat,
				baselineRatio
			);
		}

		previousBoundaryMs = beat.nextStartTimeMs;
	}

	appendFlatlineSegment(
		activeBeat ? activePoints : committedPoints,
		previousBoundaryMs,
		safeCurrentTimeMs,
		startTimeMs,
		endTimeMs,
		width,
		height,
		baselineRatio
	);

	const baseline = baselineY(height, baselineRatio);
	const headX = ((safeCurrentTimeMs - startTimeMs) / Math.max(endTimeMs - startTimeMs, 1)) * width;
	const headY = activeBeat
		? buildBeatY(
			smoothstep(
				clamp(
					(safeCurrentTimeMs - activeBeat.startTimeMs) /
						Math.max(activeBeat.endTimeMs - activeBeat.startTimeMs, 1),
					0,
					1
				)
			),
			activeBeat,
			height,
			baselineRatio
		)
		: baseline;

	return {
		committedPath: toSmoothPath(committedPoints),
		activePath: toSmoothPath(activePoints),
		headX,
		headY,
		startTimeMs,
		endTimeMs,
		activeBeat,
		currentSample
	};
}
