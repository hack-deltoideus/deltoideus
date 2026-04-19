export type MockEcgSample = {
	elapsedSeconds: number;
	heartRate: number;
	rrMs: number;
};

export type MockEcgSession = {
	id: string;
	title: string;
	subtitle: string;
	description: string;
	durationMinutes: number;
	intensity: 'low' | 'moderate' | 'high';
	samples: MockEcgSample[];
};

type SessionBlueprint = {
	id: string;
	title: string;
	subtitle: string;
	description: string;
	durationMinutes: number;
	baseHeartRate: number;
	heartRateVariance: number;
	baseRrMs: number;
	rrVariance: number;
	intensity: MockEcgSession['intensity'];
};

const SESSION_SAMPLE_INTERVAL_SECONDS = 2;

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

function buildSamples(blueprint: SessionBlueprint): MockEcgSample[] {
	const sampleCount = Math.max(
		1,
		Math.floor((blueprint.durationMinutes * 60) / SESSION_SAMPLE_INTERVAL_SECONDS)
	);

	return Array.from({ length: sampleCount }, (_, index) => {
		const progress = index / Math.max(1, sampleCount - 1);
		const waveA = Math.sin(progress * Math.PI * 5.2);
		const waveB = Math.sin(progress * Math.PI * 13.4 + 0.8);
		const waveC = Math.cos(progress * Math.PI * 3.1 - 0.45);
		const drift = (progress - 0.5) * blueprint.heartRateVariance * 0.8;
		const heartRate = clamp(
			Math.round(
				blueprint.baseHeartRate +
					waveA * blueprint.heartRateVariance * 0.7 +
					waveB * blueprint.heartRateVariance * 0.25 +
					drift
			),
			48,
			148
		);
		const rrMs = clamp(
			Math.round(
				blueprint.baseRrMs +
					waveC * blueprint.rrVariance * 0.72 -
					waveB * blueprint.rrVariance * 0.22 -
					drift * 4.5
			),
			420,
			1320
		);

		return {
			elapsedSeconds: index * SESSION_SAMPLE_INTERVAL_SECONDS,
			heartRate,
			rrMs
		};
	});
}

function buildSession(blueprint: SessionBlueprint): MockEcgSession {
	return {
		id: blueprint.id,
		title: blueprint.title,
		subtitle: blueprint.subtitle,
		description: blueprint.description,
		durationMinutes: blueprint.durationMinutes,
		intensity: blueprint.intensity,
		samples: buildSamples(blueprint)
	};
}

export const mockEcgSessions: MockEcgSession[] = [
	buildSession({
		id: 'recovery-reset',
		title: 'Recovery Reset',
		subtitle: 'Slow, steady breathing pattern',
		description: 'A calmer mock session with longer RR intervals and a softer artificial strip.',
		durationMinutes: 6,
		baseHeartRate: 61,
		heartRateVariance: 6,
		baseRrMs: 980,
		rrVariance: 120,
		intensity: 'low'
	}),
	buildSession({
		id: 'focus-sprint',
		title: 'Focus Sprint',
		subtitle: 'Working rhythm with light variability',
		description: 'A medium-intensity dev session that feels active without becoming chaotic.',
		durationMinutes: 8,
		baseHeartRate: 78,
		heartRateVariance: 10,
		baseRrMs: 760,
		rrVariance: 96,
		intensity: 'moderate'
	}),
	buildSession({
		id: 'deadline-wave',
		title: 'Deadline Wave',
		subtitle: 'Elevated stress simulation',
		description: 'A higher-intensity mock session with faster beats and tighter RR spacing.',
		durationMinutes: 5,
		baseHeartRate: 104,
		heartRateVariance: 12,
		baseRrMs: 585,
		rrVariance: 82,
		intensity: 'high'
	})
];

export const mockEcgSampleIntervalSeconds = SESSION_SAMPLE_INTERVAL_SECONDS;
