import type { WindowPrediction } from '$lib/classifier';

export type StressLevel = 'low' | 'rising' | 'high';
export type RecoveryStatus = 'green' | 'yellow' | 'red';
export type CognitiveStrainRisk = 'low' | 'medium' | 'high';
export type BuddyState = 'calm' | 'focused' | 'stressed' | 'drained';

export type StressResult = {
	score: number;
	level: StressLevel;
	isModelReady: boolean;
};

export type BuddyResult = {
	state: BuddyState;
	label: string;
	message: string;
};

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

export function calculateStressFromPrediction(
	prediction: WindowPrediction,
	isModelReady: boolean
): StressResult {
	if (!isModelReady || prediction.label === 'unknown') {
		return {
			score: 50,
			level: 'rising',
			isModelReady: false
		};
	}

	const confidence = clamp(prediction.confidence, 0, 1);
	const baseScore = prediction.label === 'calm' ? 22 : 82;
	const confidenceRange = 18;
	const score =
		prediction.label === 'calm'
			? baseScore + (1 - confidence) * confidenceRange
			: baseScore - (1 - confidence) * confidenceRange;

	const rounded = Number(clamp(score, 0, 100).toFixed(2));
	return {
		score: rounded,
		level: stressLevelFromScore(rounded),
		isModelReady: true
	};
}

export function stressLevelFromScore(score: number): StressLevel {
	if (score >= 65) {
		return 'high';
	}

	if (score >= 35) {
		return 'rising';
	}

	return 'low';
}

export function recoveryStatusFromStress(score: number): RecoveryStatus {
	if (score >= 65) {
		return 'red';
	}

	if (score >= 35) {
		return 'yellow';
	}

	return 'green';
}

export function cognitiveRiskFromStress(score: number): CognitiveStrainRisk {
	if (score > 65) {
		return 'high';
	}

	if (score >= 40) {
		return 'medium';
	}

	return 'low';
}

export function buddyStateFromSignals(stressScore: number, recoveryStatus: RecoveryStatus): BuddyResult {
	if (stressScore >= 70 && recoveryStatus === 'red') {
		return {
			state: 'drained',
			label: 'Drained',
			message: 'Monte thinks this window looks like one of your high-strain patterns. Ease off and reset.'
		};
	}

	if (stressScore >= 40) {
		return {
			state: 'stressed',
			label: 'Stressed',
			message: 'Monte sees this 60-second window matching your more activated patterns. A small break now will help.'
		};
	}

	if (recoveryStatus === 'green') {
		return {
			state: 'focused',
			label: 'Focused',
			message: 'Monte sees this window lining up with your calmer training data. Good time for deep work.'
		};
	}

	return {
		state: 'calm',
		label: 'Calm',
		message: 'Monte sees a steady pattern here. Keep going and label more windows to sharpen the model.'
	};
}

export function interventionFor(level: StressLevel): string {
	if (level === 'high') {
		return 'Start a 60-second breathing reset now, then choose only one tiny next task.';
	}

	if (level === 'rising') {
		return 'Take a 2-minute break, reset posture, and narrow your workload to one target.';
	}

	return 'You look relatively recovered. Keep momentum and check in again after your next work block.';
}
