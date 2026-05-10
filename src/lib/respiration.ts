export type RespiratoryRateEstimate = {
	breathsPerMinute: number | null;
	confidence: number;
	qualityLabel: 'warming-up' | 'low' | 'medium' | 'high';
	peakCount: number;
	qrsRmsBpm: number | null;
	baselineBpm: number | null;
	rrIntervalBpm: number | null;
	diagnostics: {
		instantConfidence: number;
		evidenceConfidence: number;
		boostedEvidenceConfidence: number;
		evidenceBoost: number;
		confidencePromotionProgress: number;
		sourceAgreement: number;
		stabilityScore: number;
		stableSegmentCount: number;
		consecutiveStableSegmentCount: number;
		totalSegmentCount: number;
		usableSourceCount: number;
	};
};

type BeatFeature = {
	timeSeconds: number;
	qrsRms: number;
	rrMs: number | null;
};

type SpectralEstimate = {
	bpm: number;
	quality: number;
};

type SegmentEstimate = {
	index: number;
	bpmValues: number[];
	confidenceValues: number[];
};

type EstimatorOptions = {
	sampleRateHz?: number;
	bufferSeconds?: number;
	minRespirationBpm?: number;
	maxRespirationBpm?: number;
	segmentSeconds?: number;
};

const DEFAULT_SAMPLE_RATE_HZ = 130;
const DEFAULT_BUFFER_SECONDS = 45;
const DEFAULT_MIN_RESPIRATION_BPM = 8;
const DEFAULT_MAX_RESPIRATION_BPM = 24;
const DEFAULT_SEGMENT_SECONDS = 10;
const RESAMPLED_FEATURE_RATE_HZ = 4;
const HEARTBEAT_WINDOW = 16;
const FFT_LENGTH = 512;
const SEGMENT_SMOOTHING_COUNT = 4;
const SEGMENT_HISTORY_COUNT = 12;
const MIN_VALID_RR_MS = 300;
const MAX_VALID_RR_MS = 2000;
const STABLE_SEGMENT_TOLERANCE_BPM = 2.25;
const STABLE_SEGMENT_TOLERANCE_RATIO = 0.12;
const STABLE_SEGMENT_CONFIDENCE_FLOOR = 0.35;
const MATURE_SEGMENT_MIN_OBSERVATIONS = 3;
const SEGMENT_REFERENCE_WINDOW = 5;
const CONFIDENCE_PROMOTION_START_SEGMENTS = 4;
const CONFIDENCE_PROMOTION_FULL_SEGMENTS = 8;
const CONFIDENCE_PROMOTION_EVIDENCE_FLOOR = 0.7;
const CONFIDENCE_PROMOTION_EVIDENCE_CEILING = 0.9;
const EVIDENCE_BOOST_STABILITY_THRESHOLD = 0.82;
const EVIDENCE_BOOST_SEGMENT_THRESHOLD = 5;
const EVIDENCE_BOOST_MAX = 0.12;

export class RespiratoryRateEstimator {
	private readonly sampleRateHz: number;
	private readonly maxSamples: number;
	private readonly minRespirationBpm: number;
	private readonly maxRespirationBpm: number;
	private readonly segmentSamples: number;
	private samples: number[] = [];
	private totalSampleCount = 0;
	private segmentEstimates: SegmentEstimate[] = [];

	constructor(options: EstimatorOptions = {}) {
		this.sampleRateHz = options.sampleRateHz ?? DEFAULT_SAMPLE_RATE_HZ;
		this.maxSamples = Math.round((options.bufferSeconds ?? DEFAULT_BUFFER_SECONDS) * this.sampleRateHz);
		this.minRespirationBpm = options.minRespirationBpm ?? DEFAULT_MIN_RESPIRATION_BPM;
		this.maxRespirationBpm = options.maxRespirationBpm ?? DEFAULT_MAX_RESPIRATION_BPM;
		this.segmentSamples = Math.round((options.segmentSeconds ?? DEFAULT_SEGMENT_SECONDS) * this.sampleRateHz);
	}

	addSamples(nextSamples: number[]): RespiratoryRateEstimate {
		this.totalSampleCount += nextSamples.length;
		this.samples = [...this.samples, ...nextSamples].slice(-this.maxSamples);
		return this.estimate();
	}

	reset() {
		this.samples = [];
		this.totalSampleCount = 0;
		this.segmentEstimates = [];
	}

	private estimate(): RespiratoryRateEstimate {
		const warmingUp = this.samples.length < this.sampleRateHz * 12;
		const filtered = highPassMovingAverage(this.samples, Math.round(this.sampleRateHz * 0.6));
		const baseline = movingAverage(this.samples, Math.round(this.sampleRateHz * 1.5));
		const peaks = detectRPeaks(this.samples, filtered, this.sampleRateHz);
		const beatFeatures = extractBeatFeatures(filtered, peaks, this.sampleRateHz);

		const qrsEstimate = estimateQrsRmsByHeartbeatWindow(
			beatFeatures,
			this.minRespirationBpm,
			this.maxRespirationBpm
		);
		const rrEstimate = estimateFromBeatFeature(
			beatFeatures.filter((feature) => feature.rrMs !== null),
			(feature) => feature.rrMs ?? 0,
			this.minRespirationBpm,
			this.maxRespirationBpm
		);
		const baselineEstimate = estimateDominantBpm(
			downsample(baseline, this.sampleRateHz, RESAMPLED_FEATURE_RATE_HZ),
			RESAMPLED_FEATURE_RATE_HZ,
			this.minRespirationBpm,
			this.maxRespirationBpm
		);
		const fused = fuseEstimates([
			{ estimate: qrsEstimate, weight: 1.2 },
			{ estimate: baselineEstimate, weight: 0.9 },
			{ estimate: rrEstimate, weight: 0.7 }
		]);

		if (fused.bpm !== null) {
			this.addSegmentEstimate(fused.bpm, fused.confidence);
		}

		const segmentBpm = this.segmentSmoothedBpm();
		const segmentConfidence = this.segmentSmoothedConfidence();
		const segmentEvidence = this.segmentEvidence(segmentBpm);
		const baseConfidence = clamp(
			fused.confidence * 0.65 +
				(segmentConfidence ?? fused.confidence) * 0.1 +
				segmentEvidence.evidenceConfidence * 0.25,
			0,
			1
		);
		const promotionProgress = confidencePromotionProgress(
			segmentEvidence.consecutiveStableSegmentCount,
			segmentEvidence.evidenceConfidence
		);
		const promotedConfidence = lerp(
			baseConfidence,
			Math.max(baseConfidence, segmentEvidence.boostedEvidenceConfidence),
			promotionProgress
		);
		const confidence = warmingUp ? Math.min(fused.confidence, 0.25) : promotedConfidence;

		return {
			breathsPerMinute: segmentBpm === null ? null : Number(segmentBpm.toFixed(1)),
			confidence: Number(confidence.toFixed(2)),
			qualityLabel: warmingUp ? 'warming-up' : qualityLabel(confidence),
			peakCount: peaks.length,
			qrsRmsBpm: formatNullableBpm(qrsEstimate?.bpm ?? null),
			baselineBpm: formatNullableBpm(baselineEstimate?.bpm ?? null),
			rrIntervalBpm: formatNullableBpm(rrEstimate?.bpm ?? null),
			diagnostics: {
				instantConfidence: Number(fused.confidence.toFixed(2)),
				evidenceConfidence: Number(segmentEvidence.evidenceConfidence.toFixed(2)),
				boostedEvidenceConfidence: Number(segmentEvidence.boostedEvidenceConfidence.toFixed(2)),
				evidenceBoost: Number(segmentEvidence.evidenceBoost.toFixed(2)),
				confidencePromotionProgress: Number(promotionProgress.toFixed(2)),
				sourceAgreement: Number(fused.agreement.toFixed(2)),
				stabilityScore: Number(segmentEvidence.stabilityScore.toFixed(2)),
				stableSegmentCount: segmentEvidence.stableSegmentCount,
				consecutiveStableSegmentCount: segmentEvidence.consecutiveStableSegmentCount,
				totalSegmentCount: segmentEvidence.totalSegmentCount,
				usableSourceCount: fused.usableSourceCount
			}
		};
	}

	private addSegmentEstimate(bpm: number, confidence: number) {
		const index = Math.floor(this.totalSampleCount / Math.max(this.segmentSamples, 1));
		const activeSegment = this.segmentEstimates.at(-1);

		if (activeSegment?.index === index) {
			activeSegment.bpmValues.push(bpm);
			activeSegment.confidenceValues.push(confidence);
		} else {
			this.segmentEstimates.push({ index, bpmValues: [bpm], confidenceValues: [confidence] });
		}

		this.segmentEstimates = this.segmentEstimates.slice(-SEGMENT_HISTORY_COUNT);
	}

	private segmentSmoothedBpm(): number | null {
		if (this.segmentEstimates.length === 0) {
			return null;
		}

		const segmentMeans = this.segmentEstimates
			.map((segment) => mean(segment.bpmValues))
			.filter((value) => Number.isFinite(value) && value > 0);

		return segmentMeans.length > 0 ? mean(segmentMeans) : null;
	}

	private segmentSmoothedConfidence(): number | null {
		if (this.segmentEstimates.length === 0) {
			return null;
		}

		const segmentMeans = this.segmentEstimates
			.map((segment) => mean(segment.confidenceValues))
			.filter((value) => Number.isFinite(value) && value > 0);
		if (segmentMeans.length === 0) {
			return null;
		}

		const smoothedBpm = this.segmentSmoothedBpm();
		const segmentBpmValues = this.segmentEstimates
			.map((segment) => mean(segment.bpmValues))
			.filter((value) => Number.isFinite(value) && value > 0);
		const stability =
			smoothedBpm !== null && segmentBpmValues.length >= 2
				? clamp(1 - standardDeviation(segmentBpmValues) / Math.max(smoothedBpm, 1), 0, 1)
				: 0.6;

		return clamp(mean(segmentMeans) * 0.9 + mean(segmentMeans) * stability * 0.1, 0, 1);
	}

	private segmentEvidence(smoothedBpm: number | null): {
		evidenceConfidence: number;
		boostedEvidenceConfidence: number;
		evidenceBoost: number;
		stabilityScore: number;
		stableSegmentCount: number;
		consecutiveStableSegmentCount: number;
		totalSegmentCount: number;
	} {
		if (this.segmentEstimates.length === 0) {
			return {
				evidenceConfidence: 0,
				boostedEvidenceConfidence: 0,
				evidenceBoost: 0,
				stabilityScore: 0,
				stableSegmentCount: 0,
				consecutiveStableSegmentCount: 0,
				totalSegmentCount: 0
			};
		}

		const matureSegments = this.segmentEstimates.filter(
			(segment, index, segments) =>
				segment.bpmValues.length >= MATURE_SEGMENT_MIN_OBSERVATIONS ||
				index < segments.length - 1
		);
		const segmentSummaries = matureSegments
			.map((segment) => ({
				bpm: mean(segment.bpmValues),
				confidence: mean(segment.confidenceValues)
			}))
			.filter(
				(segment) =>
					Number.isFinite(segment.bpm) &&
					segment.bpm > 0 &&
					Number.isFinite(segment.confidence) &&
					segment.confidence > 0
			);
		if (segmentSummaries.length === 0) {
			return {
				evidenceConfidence: 0,
				boostedEvidenceConfidence: 0,
				evidenceBoost: 0,
				stabilityScore: 0,
				stableSegmentCount: 0,
				consecutiveStableSegmentCount: 0,
				totalSegmentCount: 0
			};
		}

		const globalReferenceBpm = smoothedBpm ?? mean(segmentSummaries.map((segment) => segment.bpm));
		const stableSegments = segmentSummaries.map((segment, index) => {
			const localReferenceBpm = rollingMedianBpm(segmentSummaries, index, globalReferenceBpm);
			const tolerance = Math.max(
				STABLE_SEGMENT_TOLERANCE_BPM,
				localReferenceBpm * STABLE_SEGMENT_TOLERANCE_RATIO
			);
			const closeToReference = Math.abs(segment.bpm - localReferenceBpm) <= tolerance;
			const confidentEnough = segment.confidence >= STABLE_SEGMENT_CONFIDENCE_FLOOR;
			return closeToReference && confidentEnough;
		});
		const stableSegmentCount = stableSegments.filter(Boolean).length;
		let consecutiveStableSegmentCount = 0;
		for (let index = stableSegments.length - 1; index >= 0; index -= 1) {
			if (!stableSegments[index]) {
				break;
			}

			consecutiveStableSegmentCount += 1;
		}

		const stabilityScore =
			globalReferenceBpm > 0 && segmentSummaries.length >= 2
				? clamp(
						1 -
							standardDeviation(segmentSummaries.map((segment) => segment.bpm)) /
								Math.max(globalReferenceBpm, 1),
						0,
						1
					)
				: 0.6;
		const persistenceScore = clamp(stableSegmentCount / 8, 0, 1);
		const recencyScore = clamp(consecutiveStableSegmentCount / 5, 0, 1);
		const averageStableConfidence =
			stableSegmentCount > 0
				? mean(
						segmentSummaries
							.filter((_, index) => stableSegments[index])
							.map((segment) => segment.confidence)
					)
				: 0;
		const evidenceConfidence = clamp(
			averageStableConfidence * 0.45 +
				stabilityScore * 0.25 +
				persistenceScore * 0.15 +
				recencyScore * 0.15,
			0,
			1
		);
		const evidenceBoostProgress = clamp(
			Math.min(
				(stabilityScore - EVIDENCE_BOOST_STABILITY_THRESHOLD) /
					Math.max(1 - EVIDENCE_BOOST_STABILITY_THRESHOLD, 0.001),
				(consecutiveStableSegmentCount - EVIDENCE_BOOST_SEGMENT_THRESHOLD) /
					Math.max(CONFIDENCE_PROMOTION_FULL_SEGMENTS - EVIDENCE_BOOST_SEGMENT_THRESHOLD, 1)
			),
			0,
			1
		);
		const evidenceBoost = EVIDENCE_BOOST_MAX * evidenceBoostProgress;
		const boostedEvidenceConfidence = clamp(evidenceConfidence + evidenceBoost, 0, 1);

		return {
			evidenceConfidence,
			boostedEvidenceConfidence,
			evidenceBoost,
			stabilityScore,
			stableSegmentCount,
			consecutiveStableSegmentCount,
			totalSegmentCount: segmentSummaries.length
		};
	}
}

function extractBeatFeatures(samples: number[], peaks: number[], sampleRateHz: number): BeatFeature[] {
	const halfWindowSamples = Math.max(2, Math.round(sampleRateHz * 0.04));

	return peaks.map((peakIndex, index) => {
		const start = Math.max(0, peakIndex - halfWindowSamples);
		const end = Math.min(samples.length - 1, peakIndex + halfWindowSamples);
		const window = samples.slice(start, end + 1);
		const qrsRms = Math.sqrt(window.reduce((sum, sample) => sum + sample * sample, 0) / window.length);
		const previousPeak = peaks[index - 1];
		const rrMs =
			typeof previousPeak === 'number'
				? ((peakIndex - previousPeak) / sampleRateHz) * 1000
				: null;

		return {
			timeSeconds: peakIndex / sampleRateHz,
			qrsRms,
			rrMs:
				rrMs !== null && rrMs >= MIN_VALID_RR_MS && rrMs <= MAX_VALID_RR_MS
					? Number(rrMs.toFixed(1))
					: null
		};
	});
}

function detectRPeaks(rawSamples: number[], filteredSamples: number[], sampleRateHz: number): number[] {
	if (filteredSamples.length < sampleRateHz * 3) {
		return [];
	}

	const qrsWindowSamples = Math.max(1, Math.round(0.12 * sampleRateHz));
	const beatWindowSamples = Math.max(1, Math.round(0.6 * sampleRateHz));
	const minBlockSamples = Math.max(1, Math.round(0.08 * sampleRateHz));
	const refractorySamples = Math.round(sampleRateHz * 0.3);
	const absolute = filteredSamples.map((sample) => Math.abs(sample));
	const qrsAverage = trailingMovingAverage(absolute, qrsWindowSamples);
	const beatAverage = trailingMovingAverage(absolute, beatWindowSamples);
	const peaks: number[] = [];
	let blockStart: number | null = null;

	for (let index = 1; index < filteredSamples.length; index += 1) {
		const previousInBlock = (qrsAverage[index - 1] ?? 0) > (beatAverage[index - 1] ?? 0);
		const inBlock = (qrsAverage[index] ?? 0) > (beatAverage[index] ?? 0);

		if (!previousInBlock && inBlock) {
			blockStart = index;
			continue;
		}

		if (previousInBlock && !inBlock && blockStart !== null) {
			const blockEnd = index - 1;
			if (blockEnd - blockStart > minBlockSamples) {
				const detectedPeak = maxIndex(filteredSamples, blockStart, blockEnd);
				const correctedPeak = correctRPeak(rawSamples, detectedPeak);

				if (peaks.length === 0 || correctedPeak - peaks.at(-1)! > refractorySamples) {
					peaks.push(correctedPeak);
				}
			}

			blockStart = null;
		}
	}

	return peaks;
}

function estimateQrsRmsByHeartbeatWindow(
	features: BeatFeature[],
	minBpm: number,
	maxBpm: number
): SpectralEstimate | null {
	if (features.length <= HEARTBEAT_WINDOW) {
		return null;
	}

	const section = features.slice(-HEARTBEAT_WINDOW);
	const rrValues = section
		.map((feature) => feature.rrMs)
		.filter((rrMs): rrMs is number => rrMs !== null);
	if (rrValues.length < HEARTBEAT_WINDOW - 2) {
		return null;
	}

	const medianRrMs = median(rrValues);
	if (medianRrMs <= 100) {
		return null;
	}

	const values = section.map((feature) => feature.qrsRms);
	const centered = values.map((value) => value - mean(values));
	const frequencyVector = Array.from({ length: FFT_LENGTH / 2 + 1 }, (_, index) => index / FFT_LENGTH);
	const candidateIndexes = frequencyVector
		.map((frequency, index) => ({ frequency, index }))
		.filter(
			(item) =>
				item.frequency > (minBpm * medianRrMs) / 60000 &&
				item.frequency < (maxBpm * medianRrMs) / 60000
		)
		.map((item) => item.index);

	if (candidateIndexes.length === 0) {
		return null;
	}

	const powers = dftPower(centered, FFT_LENGTH);
	const bestIndex = candidateIndexes.reduce((best, index) =>
		(powers[index] ?? 0) > (powers[best] ?? 0) ? index : best
	);
	const bpm = (frequencyVector[bestIndex] * 60000) / medianRrMs;
	const candidatePowers = candidateIndexes.map((index) => ({
		bpm: (frequencyVector[index] * 60000) / medianRrMs,
		power: powers[index] ?? 0
	}));
	const quality = spectralPeakQuality(candidatePowers, bpm, 1);

	return { bpm, quality };
}

function estimateFromBeatFeature(
	features: BeatFeature[],
	selectValue: (feature: BeatFeature) => number,
	minBpm: number,
	maxBpm: number
): SpectralEstimate | null {
	if (features.length < 12) {
		return null;
	}

	const resampled = resampleFeatures(features, selectValue, RESAMPLED_FEATURE_RATE_HZ);
	return estimateDominantBpm(resampled, RESAMPLED_FEATURE_RATE_HZ, minBpm, maxBpm);
}

function resampleFeatures(
	features: BeatFeature[],
	selectValue: (feature: BeatFeature) => number,
	targetRateHz: number
): number[] {
	const startTime = features[0]?.timeSeconds ?? 0;
	const endTime = features.at(-1)?.timeSeconds ?? 0;
	const length = Math.floor((endTime - startTime) * targetRateHz);
	const values: number[] = [];
	let featureIndex = 0;

	for (let index = 0; index < length; index += 1) {
		const time = startTime + index / targetRateHz;
		while (
			featureIndex < features.length - 2 &&
			(features[featureIndex + 1]?.timeSeconds ?? 0) < time
		) {
			featureIndex += 1;
		}

		const left = features[featureIndex];
		const right = features[Math.min(featureIndex + 1, features.length - 1)];
		if (!left || !right) {
			continue;
		}

		const span = Math.max(right.timeSeconds - left.timeSeconds, 0.001);
		const ratio = clamp((time - left.timeSeconds) / span, 0, 1);
		values.push(selectValue(left) + (selectValue(right) - selectValue(left)) * ratio);
	}

	return values;
}

function dftPower(values: number[], fftLength: number): number[] {
	const powers: number[] = [];

	for (let bin = 0; bin <= fftLength / 2; bin += 1) {
		let real = 0;
		let imaginary = 0;

		for (let index = 0; index < fftLength; index += 1) {
			const sample = values[index] ?? 0;
			const angle = (2 * Math.PI * bin * index) / fftLength;
			real += sample * Math.cos(angle);
			imaginary -= sample * Math.sin(angle);
		}

		powers.push(real * real + imaginary * imaginary);
	}

	return powers;
}

function estimateDominantBpm(
	values: number[],
	sampleRateHz: number,
	minBpm: number,
	maxBpm: number
): SpectralEstimate | null {
	if (values.length < sampleRateHz * 10) {
		return null;
	}

	const meanValue = mean(values);
	const detrended = values.map((value) => value - meanValue);
	const powers: Array<{ bpm: number; power: number }> = [];

	for (let bpm = minBpm; bpm <= maxBpm; bpm += 0.5) {
		const frequencyHz = bpm / 60;
		let real = 0;
		let imaginary = 0;

		for (let index = 0; index < detrended.length; index += 1) {
			const window = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / (detrended.length - 1));
			const angle = (2 * Math.PI * frequencyHz * index) / sampleRateHz;
			const sample = (detrended[index] ?? 0) * window;
			real += sample * Math.cos(angle);
			imaginary -= sample * Math.sin(angle);
		}

		powers.push({ bpm, power: real * real + imaginary * imaginary });
	}

	const sorted = [...powers].sort((left, right) => right.power - left.power);
	const peak = sorted[0];
	if (!peak || peak.power <= 0) {
		return null;
	}

	const averagePower = mean(powers.map((item) => item.power));
	const quality = Math.max(
		spectralPeakQuality(powers, peak.bpm, 1.5),
		clamp((peak.power / Math.max(averagePower, 1) - 1) / 10, 0, 1)
	);

	return { bpm: peak.bpm, quality };
}

function fuseEstimates(
	items: Array<{ estimate: SpectralEstimate | null; weight: number }>
): { bpm: number | null; confidence: number; agreement: number; usableSourceCount: number } {
	const usable = items.filter(
		(item): item is { estimate: SpectralEstimate; weight: number } =>
			item.estimate !== null && item.estimate.quality > 0.05
	);

	if (usable.length === 0) {
		return { bpm: null, confidence: 0, agreement: 0, usableSourceCount: 0 };
	}

	const totalWeight = usable.reduce(
		(sum, item) => sum + item.weight * Math.max(item.estimate.quality, 0.05),
		0
	);
	const bpm =
		usable.reduce(
			(sum, item) => sum + item.estimate.bpm * item.weight * Math.max(item.estimate.quality, 0.05),
			0
		) / totalWeight;
	const agreement =
		usable.length < 2
			? 0.55
			: clamp(
					1 -
						standardDeviation(usable.map((item) => item.estimate.bpm)) /
							Math.max(mean(usable.map((item) => item.estimate.bpm)), 1),
					0,
					1
				);
	const sourceQuality =
		usable.reduce(
			(sum, item) =>
				sum +
				item.estimate.quality *
					item.weight *
					Math.max(item.estimate.quality, 0.05),
			0
		) / Math.max(totalWeight, 0.001);
	const confidence = sourceQuality * 0.7 + agreement * 0.3;

	return {
		bpm,
		confidence: clamp(confidence, 0, 1),
		agreement,
		usableSourceCount: usable.length
	};
}

function spectralPeakQuality(
	powers: Array<{ bpm: number; power: number }>,
	peakBpm: number,
	competitorGapBpm: number
): number {
	const peak = powers.reduce((nearest, item) =>
		Math.abs(item.bpm - peakBpm) < Math.abs(nearest.bpm - peakBpm) ? item : nearest
	);
	if (!peak || peak.power <= 0) {
		return 0;
	}

	const medianPower = median(powers.map((item) => item.power));
	const competitorPower =
		powers
			.filter((item) => Math.abs(item.bpm - peakBpm) >= competitorGapBpm)
			.sort((left, right) => right.power - left.power)[0]?.power ?? medianPower;
	const noiseSeparation = (peak.power - medianPower) / Math.max(peak.power, 1);
	const peakProminence = (peak.power - competitorPower) / Math.max(peak.power, 1);

	return clamp(noiseSeparation * 0.55 + peakProminence * 0.45, 0, 1);
}

function rollingMedianBpm(
	segments: Array<{ bpm: number; confidence: number }>,
	index: number,
	fallbackBpm: number
): number {
	const start = Math.max(0, index - Math.floor(SEGMENT_REFERENCE_WINDOW / 2));
	const end = Math.min(segments.length, start + SEGMENT_REFERENCE_WINDOW);
	const window = segments.slice(start, end).map((segment) => segment.bpm);
	return window.length > 0 ? median(window) : fallbackBpm;
}

function confidencePromotionProgress(
	consecutiveStableSegmentCount: number,
	evidenceConfidence: number
): number {
	const segmentProgress = clamp(
		(consecutiveStableSegmentCount - CONFIDENCE_PROMOTION_START_SEGMENTS) /
			Math.max(
				CONFIDENCE_PROMOTION_FULL_SEGMENTS - CONFIDENCE_PROMOTION_START_SEGMENTS,
				1
			),
		0,
		1
	);
	const evidenceProgress = clamp(
		(evidenceConfidence - CONFIDENCE_PROMOTION_EVIDENCE_FLOOR) /
			Math.max(
				CONFIDENCE_PROMOTION_EVIDENCE_CEILING - CONFIDENCE_PROMOTION_EVIDENCE_FLOOR,
				0.001
			),
		0,
		1
	);
	return Math.min(segmentProgress, evidenceProgress);
}

function lerp(start: number, end: number, progress: number): number {
	return start + (end - start) * clamp(progress, 0, 1);
}

function highPassMovingAverage(values: number[], windowSize: number): number[] {
	const lowPassed = movingAverage(values, windowSize);
	return values.map((value, index) => value - (lowPassed[index] ?? 0));
}

function movingAverage(values: number[], windowSize: number): number[] {
	if (values.length === 0) {
		return [];
	}

	const radius = Math.max(1, Math.floor(windowSize / 2));
	const result: number[] = [];
	let sum = 0;
	let left = 0;

	for (let right = 0; right < values.length; right += 1) {
		sum += values[right] ?? 0;

		while (right - left > radius * 2) {
			sum -= values[left] ?? 0;
			left += 1;
		}

		result.push(sum / (right - left + 1));
	}

	return result;
}

function trailingMovingAverage(values: number[], windowSize: number): number[] {
	const result: number[] = [];
	let sum = 0;
	let left = 0;

	for (let index = 0; index < values.length; index += 1) {
		sum += values[index] ?? 0;

		while (index - left >= windowSize) {
			sum -= values[left] ?? 0;
			left += 1;
		}

		result.push(sum / (index - left + 1));
	}

	return result;
}

function maxIndex(values: number[], start: number, end: number): number {
	let bestIndex = start;
	let bestValue = values[start] ?? Number.NEGATIVE_INFINITY;

	for (let index = start + 1; index <= end; index += 1) {
		const value = values[index] ?? Number.NEGATIVE_INFINITY;
		if (value > bestValue) {
			bestIndex = index;
			bestValue = value;
		}
	}

	return bestIndex;
}

function correctRPeak(values: number[], peakIndex: number): number {
	let corrected = peakIndex;

	while (corrected > 0 && (values[corrected] ?? 0) < (values[corrected - 1] ?? 0)) {
		corrected -= 1;
	}

	while (corrected < values.length - 1 && (values[corrected] ?? 0) < (values[corrected + 1] ?? 0)) {
		corrected += 1;
	}

	return corrected;
}

function downsample(values: number[], sourceRateHz: number, targetRateHz: number): number[] {
	const ratio = sourceRateHz / targetRateHz;
	const result: number[] = [];

	for (let index = 0; index < values.length; index += ratio) {
		const value = values[Math.floor(index)];
		if (typeof value === 'number') {
			result.push(value);
		}
	}

	return result;
}

function formatNullableBpm(value: number | null): number | null {
	return value === null ? null : Number(value.toFixed(1));
}

function qualityLabel(confidence: number): RespiratoryRateEstimate['qualityLabel'] {
	if (confidence >= 0.7) {
		return 'high';
	}

	if (confidence >= 0.35) {
		return 'medium';
	}

	return 'low';
}

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

function mean(values: number[]): number {
	if (values.length === 0) {
		return 0;
	}

	return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: number[]): number {
	if (values.length === 0) {
		return 0;
	}

	const sorted = [...values].sort((left, right) => left - right);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0 ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2 : (sorted[middle] ?? 0);
}

function standardDeviation(values: number[]): number {
	const average = mean(values);
	const variance = mean(values.map((value) => (value - average) ** 2));
	return Math.sqrt(variance);
}
