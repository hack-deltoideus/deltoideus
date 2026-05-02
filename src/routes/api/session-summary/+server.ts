import { env } from '$env/dynamic/private';
import { generateOpenAIText } from '$lib/server/openai';
import { json, type RequestHandler } from '@sveltejs/kit';

type SessionSegment = {
	index: number;
	durationSeconds: number;
	sampleCount: number;
	averageHeartRate: number | null;
	averageRrMs: number | null;
	averageHrvMs: number | null;
};

type SessionSummaryRequest = {
	displayName?: string;
	session?: {
		id?: string;
		startedAt?: string | null;
		endedAt?: string | null;
		durationSeconds?: number | null;
		sampleCount?: number | null;
		averageHeartRate?: number | null;
		averageHrvMs?: number | null;
		averageRrMs?: number | null;
		lastHrvMs?: number | null;
		maxHeartRate?: number | null;
		deviceName?: string | null;
		captureType?: string | null;
		segmentLengthSeconds?: number | null;
		segments?: SessionSegment[];
		bodyLoadState?: string | null;
		bodyLoadScore?: number | null;
		bodyLoadConfidence?: string | null;
		burnoutScore?: number | null;
		sustainedStressSeconds?: number | null;
		activationEvents?: Array<unknown>;
		recoveryEvents?: Array<unknown>;
		feedback?: Array<unknown>;
	};
};

function shouldUseFallback(result: { ok: false; status: number; message: string }): boolean {
	const normalized = result.message.toLowerCase();

	return (
		result.status === 429 ||
		result.status === 500 ||
		result.status === 503 ||
		normalized.includes('high demand') ||
		normalized.includes('rate limit') ||
		normalized.includes('rate-limited') ||
		normalized.includes('quota') ||
		normalized.includes('temporarily unavailable')
	);
}

function buildFallbackWarning(result: { status: number; message: string; model: string }): string {
	const normalized = result.message.toLowerCase();
	const retryMatch = result.message.match(/retry in ([\d.]+)s/i);
	const retrySeconds = retryMatch ? Math.max(1, Math.ceil(Number.parseFloat(retryMatch[1] ?? '0'))) : null;

	if (
		result.status === 429 ||
		normalized.includes('quota exceeded') ||
		normalized.includes('quota') ||
		normalized.includes('rate limit')
	) {
		return retrySeconds
			? `OpenAI is rate-limited right now, so Oy is showing a local session analysis instead. Try again in about ${retrySeconds} seconds. (${result.model})`
			: `OpenAI is rate-limited right now, so Oy is showing a local session analysis instead. (${result.model})`;
	}

	return `OpenAI is temporarily unavailable, so Oy is showing a local session analysis instead. (${result.model})`;
}

function fallbackReply(body: SessionSummaryRequest): string {
	const session = body.session;
	const averageHeartRate = session?.averageHeartRate ?? null;
	const averageHrvMs = session?.averageHrvMs ?? null;
	const maxHeartRate = session?.maxHeartRate ?? null;
	const durationSeconds = session?.durationSeconds ?? 0;
	const activationCount = session?.activationEvents?.length ?? 0;
	const labelCount = session?.feedback?.length ?? 0;

	if (activationCount > 0) {
		return `This study block had ${activationCount} elevated-stress event${activationCount === 1 ? '' : 's'} across ${durationSeconds} seconds of data, with ${labelCount} user label${labelCount === 1 ? '' : 's'} saved for personalization. Treat the signal as a cue to check context, then try a short reset before the next long block.`;
	}

	if (typeof averageHeartRate === 'number' && typeof averageHrvMs === 'number') {
		if (averageHeartRate >= 95 || averageHrvMs <= 24) {
			return `Your session looks more activated than settled overall, especially across ${durationSeconds} seconds of data. A short reset before your next task would probably help more than pushing straight through.`;
		}

		if (averageHeartRate <= 78 && averageHrvMs >= 35) {
			return 'This session looks relatively steady, with signs that your system found a calmer groove. If that matches how you felt, it is a good moment to keep working in one focused block instead of context-switching.';
		}
	}

	if (typeof maxHeartRate === 'number' && maxHeartRate >= 110) {
		return 'There was at least one sharper spike in this session, even if the overall averages stayed moderate. It may be worth noting what was happening around that moment so you can spot the trigger faster next time.';
	}

	return 'This session gives you a useful baseline more than a dramatic warning sign. Pairing these numbers with a quick note about what you were doing will make the next summary much more meaningful.';
}

export const POST: RequestHandler = async ({ request, fetch }) => {
	const apiKey = env.OPENAI_API_KEY ?? env.OPENAI_KEY ?? '';
	const model = env.OPENAI_MODEL || 'gpt-4.1-mini';
	const body = (await request.json()) as SessionSummaryRequest;
	const session = body.session;

	if (!session) {
		return json({ error: 'Session summary payload is required.' }, { status: 400 });
	}

	if (!apiKey.trim()) {
		return json({
			reply: fallbackReply(body),
			source: 'fallback',
			warning: 'Missing OpenAI API key on server, so Oy used a local session analysis.'
		});
	}

	const displayName = body.displayName?.trim() || 'Friend';
	const durationSeconds = session.durationSeconds ?? 0;
	const durationMinutes = Number((durationSeconds / 60).toFixed(1));
	const averageHeartRate = session.averageHeartRate ?? 'n/a';
	const averageHrvMs = session.averageHrvMs ?? 'n/a';
	const averageRrMs = session.averageRrMs ?? 'n/a';
	const lastHrvMs = session.lastHrvMs ?? 'n/a';
	const maxHeartRate = session.maxHeartRate ?? 'n/a';
	const bodyLoadState = session.bodyLoadState ?? 'n/a';
	const bodyLoadScore = session.bodyLoadScore ?? 'n/a';
	const bodyLoadConfidence = session.bodyLoadConfidence ?? 'n/a';
	const burnoutScore = session.burnoutScore ?? 'n/a';
	const sustainedStressSeconds = session.sustainedStressSeconds ?? 'n/a';
	const activationCount = session.activationEvents?.length ?? 0;
	const recoveryCount = session.recoveryEvents?.length ?? 0;
	const feedbackCount = session.feedback?.length ?? 0;
	const segmentCount = session.segments?.length ?? 0;
	const peakSegment = session.segments?.reduce<SessionSegment | null>((peak, segment) => {
		if (peak === null) {
			return segment;
		}

		const peakValue = peak.averageHeartRate ?? -Infinity;
		const segmentValue = segment.averageHeartRate ?? -Infinity;
		return segmentValue > peakValue ? segment : peak;
	}, null);

	const instructions = [
		'You are Oy, the AI coach inside Sanctuary.',
		'Write a very brief post-session debrief after a biometric sensor session.',
		'Keep it to exactly 2 sentences and under 75 words total.',
		'Sentence 1 should describe the overall pattern in plain language.',
		'Sentence 2 should give one gentle, practical next step.',
		'Do not mention being an AI, a model, or a medical professional.',
		'Do not diagnose, warn about disorders, or make medical claims.',
		'Use stress-score language for this seated study-session app.',
		'Mention that elevated stress score can come from stress, effortful focus, caffeine, sleep loss, or illness only when useful.',
		'Use supportive, grounded language and refer to the student by name only if it feels natural.',
		'Do not use bullet points, labels, or quotation marks.'
	].join('\n');

	const context = [
		`Student name: ${displayName}`,
		`Capture type: ${session.captureType ?? 'sensor_session'}`,
		`Device: ${session.deviceName ?? 'Unknown device'}`,
		`Duration seconds: ${durationSeconds}`,
		`Duration minutes: ${durationMinutes}`,
		`Sample count: ${session.sampleCount ?? 'n/a'}`,
		`Average heart rate bpm: ${averageHeartRate}`,
		`Average HRV ms: ${averageHrvMs}`,
		`Average RR ms: ${averageRrMs}`,
		`Last HRV ms: ${lastHrvMs}`,
		`Max heart rate bpm: ${maxHeartRate}`,
		`Stress-score state: ${bodyLoadState}`,
		`Stress score: ${bodyLoadScore}`,
		`Stress-score confidence: ${bodyLoadConfidence}`,
		`Burnout score: ${burnoutScore}`,
		`Sustained elevated-stress seconds: ${sustainedStressSeconds}`,
		`Activation event count: ${activationCount}`,
		`Recovery event count: ${recoveryCount}`,
		`User feedback label count: ${feedbackCount}`,
		`Segment length seconds: ${session.segmentLengthSeconds ?? 'n/a'}`,
		`Segment count: ${segmentCount}`,
		`Highest average-HR segment index: ${peakSegment?.index ?? 'n/a'}`,
		`Highest average-HR segment bpm: ${peakSegment?.averageHeartRate ?? 'n/a'}`,
		`Highest average-HR segment HRV ms: ${peakSegment?.averageHrvMs ?? 'n/a'}`
	].join('\n');

	const result = await generateOpenAIText({
		apiKey,
		fetch,
		model,
		temperature: 0.5,
		maxOutputTokens: 180,
		instructions,
		input: [
			{
				role: 'developer',
				content: `Current session stats:\n${context}`
			},
			{
				role: 'user',
				content: 'Give me the post-session debrief.'
			}
		]
	});

	if (!result.ok && shouldUseFallback(result)) {
		return json({
			reply: fallbackReply(body),
			source: 'fallback',
			warning: buildFallbackWarning(result)
		});
	}

	if (!result.ok) {
		return json({ error: `${result.message} (model: ${result.model})` }, { status: 502 });
	}

	return json({
		reply: result.text,
		source: 'openai',
		model: result.model
	});
};
