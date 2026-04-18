export type StressWindowLabel = 'calm' | 'okay' | 'stressed';

export type WindowFeatures = {
	heartRateAvg?: number;
	heartRateMax?: number;
	rmssdMs?: number;
	lnRmssd?: number;
	sdnnMs?: number;
	pnn25?: number;
};

export type WindowTrainingExample = WindowFeatures & {
	label: StressWindowLabel;
};

export type WindowPrediction = {
	label: StressWindowLabel | 'unknown';
	confidence: number;
	reason: string;
};

type Centroid = {
	label: StressWindowLabel;
	vector: number[];
	count: number;
};

function featureVector(features: WindowFeatures): number[] | undefined {
	if (
		features.heartRateAvg === undefined ||
		features.rmssdMs === undefined ||
		features.lnRmssd === undefined ||
		features.sdnnMs === undefined ||
		features.pnn25 === undefined
	) {
		return undefined;
	}

	return [
		features.heartRateAvg,
		features.heartRateMax ?? features.heartRateAvg,
		features.rmssdMs,
		features.lnRmssd,
		features.sdnnMs,
		features.pnn25
	];
}

function distance(a: number[], b: number[]): number {
	let sum = 0;
	for (let index = 0; index < a.length; index += 1) {
		const delta = a[index] - b[index];
		sum += delta * delta;
	}

	return Math.sqrt(sum);
}

function centroidFor(label: StressWindowLabel, examples: WindowTrainingExample[]): Centroid | undefined {
	const vectors = examples
		.filter((example) => example.label === label)
		.map(featureVector)
		.filter((vector): vector is number[] => vector !== undefined);

	if (vectors.length === 0) {
		return undefined;
	}

	const summed = new Array(vectors[0].length).fill(0);
	for (const vector of vectors) {
		for (let index = 0; index < vector.length; index += 1) {
			summed[index] += vector[index];
		}
	}

	return {
		label,
		vector: summed.map((value) => value / vectors.length),
		count: vectors.length
	};
}

export function predictStressWindow(
	features: WindowFeatures,
	examples: WindowTrainingExample[]
): WindowPrediction {
	const currentVector = featureVector(features);
	if (!currentVector) {
		return {
			label: 'unknown',
			confidence: 0,
			reason: 'Need more RR samples before classifying this 60-second window.'
		};
	}

	const centroids = (['calm', 'stressed'] as StressWindowLabel[])
		.map((label) => centroidFor(label, examples))
		.filter((centroid): centroid is Centroid => centroid !== undefined);

	if (centroids.length < 2) {
		return {
			label: 'unknown',
			confidence: 0,
			reason: 'Label at least one calm and one stressed window before local ML can classify the current window.'
		};
	}

	const ranked = centroids
		.map((centroid) => ({
			...centroid,
			distance: distance(currentVector, centroid.vector)
		}))
		.sort((left, right) => left.distance - right.distance);

	const best = ranked[0];
	const second = ranked[1];
	const margin = second ? second.distance - best.distance : best.distance;
	const confidence = Number(
		Math.max(0.15, Math.min(0.98, 0.55 + margin / Math.max(second?.distance ?? 1, 1))).toFixed(2)
	);

	return {
		label: best.label,
		confidence,
		reason: `Closest to your ${best.label} training windows (${best.count} saved).`
	};
}
