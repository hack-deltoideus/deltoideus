export type HrvMetrics = {
	rmssdMs?: number;
	lnRmssd?: number;
	sdnnMs?: number;
	meanRrMs?: number;
	pnn25?: number;
	pnn50?: number;
	sampleCount: number;
};

export type BaselineReading = {
	id: string;
	created_at: string;
	reading_label: string | null;
	heart_rate: number | null;
	rr_ms: number | null;
	rmssd_ms: number | null;
	ln_rmssd: number | null;
	sdnn_ms: number | null;
	sample_count: number | null;
};

export type BaselineProfile = {
	heartRate: number;
	lnRmssd: number;
	sdnnMs: number;
	heartRateSd: number;
	lnRmssdSd: number;
	sdnnSd: number;
	sampleCount: number;
	readingCount: number;
};

function mean(values: number[]): number | undefined {
	if (values.length === 0) {
		return undefined;
	}

	return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: number[]): number | undefined {
	if (values.length === 0) {
		return undefined;
	}

	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	if (sorted.length % 2 === 0) {
		return (sorted[middle - 1] + sorted[middle]) / 2;
	}

	return sorted[middle];
}

function sampleStandardDeviation(values: number[], floor = 1): number {
	if (values.length < 2) {
		return floor;
	}

	const avg = mean(values);
	if (avg === undefined) {
		return floor;
	}

	const variance =
		values.reduce((sum, value) => sum + (value - avg) * (value - avg), 0) / (values.length - 1);

	return Math.max(Math.sqrt(variance), floor);
}

export function calculateHrvMetrics(rrSeriesMs: number[]): HrvMetrics {
	if (rrSeriesMs.length === 0) {
		return {
			sampleCount: 0
		};
	}

	const meanRrMs = mean(rrSeriesMs);
	const diffs: number[] = [];
	for (let index = 1; index < rrSeriesMs.length; index += 1) {
		diffs.push(rrSeriesMs[index] - rrSeriesMs[index - 1]);
	}

	const squaredDiffs = diffs.map((value) => value * value);
	const rmssdBase = mean(squaredDiffs);
	const rmssdMs = rmssdBase !== undefined ? Math.sqrt(rmssdBase) : undefined;
	const lnRmssd = rmssdMs && rmssdMs > 0 ? Number(Math.log(rmssdMs).toFixed(3)) : undefined;
	const diffMagnitudes = diffs.map((value) => Math.abs(value));
	const pnn25 =
		diffs.length > 0
			? Number(((diffMagnitudes.filter((value) => value > 25).length / diffs.length) * 100).toFixed(2))
			: undefined;
	const pnn50 =
		diffs.length > 0
			? Number(((diffMagnitudes.filter((value) => value > 50).length / diffs.length) * 100).toFixed(2))
			: undefined;

	const avg = meanRrMs;
	const sdnnVariance =
		avg !== undefined
			? rrSeriesMs.reduce((sum, value) => sum + (value - avg) * (value - avg), 0) / rrSeriesMs.length
			: undefined;
	const sdnnMs = sdnnVariance !== undefined ? Number(Math.sqrt(sdnnVariance).toFixed(2)) : undefined;

	return {
		rmssdMs: rmssdMs !== undefined ? Number(rmssdMs.toFixed(2)) : undefined,
		lnRmssd,
		sdnnMs,
		meanRrMs: meanRrMs !== undefined ? Number(meanRrMs.toFixed(1)) : undefined,
		pnn25,
		pnn50,
		sampleCount: rrSeriesMs.length
	};
}

export function deriveBaselineProfile(readings: BaselineReading[]): BaselineProfile | undefined {
	const usable = readings
		.filter(
			(reading) =>
				typeof reading.heart_rate === 'number' &&
				typeof reading.ln_rmssd === 'number' &&
				typeof reading.sdnn_ms === 'number'
		)
		.slice(0, 3);

	if (usable.length === 0) {
		return undefined;
	}

	const heartRates = usable.map((reading) => Number(reading.heart_rate));
	const lnRmssdValues = usable.map((reading) => Number(reading.ln_rmssd));
	const sdnnValues = usable.map((reading) => Number(reading.sdnn_ms));
	const sampleCount = usable.reduce((sum, reading) => sum + (reading.sample_count ?? 0), 0);

	const heartRate = median(heartRates);
	const lnRmssd = median(lnRmssdValues);
	const sdnnMs = median(sdnnValues);

	if (heartRate === undefined || lnRmssd === undefined || sdnnMs === undefined) {
		return undefined;
	}

	return {
		heartRate: Number(heartRate.toFixed(1)),
		lnRmssd: Number(lnRmssd.toFixed(3)),
		sdnnMs: Number(sdnnMs.toFixed(2)),
		heartRateSd: Number(sampleStandardDeviation(heartRates, 3).toFixed(2)),
		lnRmssdSd: Number(sampleStandardDeviation(lnRmssdValues, 0.12).toFixed(3)),
		sdnnSd: Number(sampleStandardDeviation(sdnnValues, 4).toFixed(2)),
		sampleCount,
		readingCount: usable.length
	};
}

export function defaultBaselineLabel(date = new Date()): string {
	const hour = date.getHours();
	if (hour < 11) {
		return 'morning calm';
	}

	if (hour < 17) {
		return 'midday calm';
	}

	return 'evening calm';
}
