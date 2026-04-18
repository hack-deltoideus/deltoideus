export type StressLevel = 'low' | 'rising' | 'high';

export type StressInputs = {
  mood: number;
  workload: number;
  sleepQuality: number;
  heartRate?: number;
  baselineHeartRate?: number;
  rrMs?: number;
};

export type StressResult = {
  score: number;
  level: StressLevel;
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function calculateStress(inputs: StressInputs): StressResult {
  const moodRisk = (10 - clamp(inputs.mood, 1, 10)) * 5;
  const workloadRisk = clamp(inputs.workload, 1, 10) * 4;
  const sleepRisk = (10 - clamp(inputs.sleepQuality, 1, 10)) * 4;

  const baseline = inputs.baselineHeartRate ?? 65;
  const hrDelta = inputs.heartRate ? Math.max(0, inputs.heartRate - baseline) : 0;
  const heartRateRisk = Math.min(hrDelta * 1.8, 18);

  const rrRisk = inputs.rrMs && inputs.rrMs < 700 ? Math.min((700 - inputs.rrMs) / 8, 10) : 0;

  const score = Number(clamp(moodRisk + workloadRisk + sleepRisk + heartRateRisk + rrRisk, 0, 100).toFixed(2));

  if (score >= 70) {
    return { score, level: 'high' };
  }

  if (score >= 45) {
    return { score, level: 'rising' };
  }

  return { score, level: 'low' };
}

export function interventionFor(level: StressLevel): string {
  if (level === 'high') {
    return 'Start a 60-second breathing reset now.';
  }

  if (level === 'rising') {
    return 'Take a 2-minute break and do a cold-water face splash.';
  }

  return 'You are stable. Keep momentum and check in again later.';
}
