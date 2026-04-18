import { env } from '$env/dynamic/private';
import { generateGeminiText } from '$lib/server/gemini';
import { json, type RequestHandler } from '@sveltejs/kit';

type GeminiRequestBody = {
  mood?: number;
  workload?: number;
  sleepQuality?: number;
  heartRate?: number;
  rrMs?: number;
  stressLevel?: string;
  stressScore?: number;
  stressor?: string;
};

function fallbackInterventionPlan(body: GeminiRequestBody): string {
  const high = body.stressLevel === 'high' || (body.stressScore ?? 0) >= 70;

  return [
    '- Do 60 seconds of box breathing (inhale 4, hold 4, exhale 4, hold 4).',
    high
      ? '- Pause all non-urgent work and choose only one 5-minute task to start.'
      : '- Pick one 10-minute task and ignore all others until it is done.',
    '- Do a physical reset: cold water on face or stand and stretch for 2 minutes.',
    `- Follow-up check in 15 minutes and re-rate stress (current stressor: ${body.stressor?.trim() || 'not specified'}).`
  ].join('\n');
}

export const POST: RequestHandler = async ({ request, fetch }) => {
  const apiKey = env.GEMINI_KEY || env.GEMINI_API_KEY || env.GOOGLE_API_KEY;
  if (!apiKey) {
    return json(
      { error: 'Missing Gemini API key on server. Set GEMINI_KEY, GEMINI_API_KEY, or GOOGLE_API_KEY.' },
      { status: 500 }
    );
  }
  const model = env.GEMINI_MODEL || 'gemini-2.5-flash-lite';

  const body = (await request.json()) as GeminiRequestBody;

  const prompt = [
    'You are a calm student stress coach for a hackathon MVP.',
    'Return only a practical action plan in 4 bullets.',
    'Each bullet must be practical and take less than 5 minutes.',
    'Include one breathing step, one immediate workload step, one physical reset, and one follow-up check.',
    'Keep the total answer under 140 words.',
    '',
    'Current state:',
    `- Mood: ${body.mood ?? 'n/a'}/10`,
    `- Workload: ${body.workload ?? 'n/a'}/10`,
    `- Sleep quality: ${body.sleepQuality ?? 'n/a'}/10`,
    `- Heart rate: ${body.heartRate ?? 'n/a'} bpm`,
    `- RR interval: ${body.rrMs ?? 'n/a'} ms`,
    `- Stress level: ${body.stressLevel ?? 'n/a'}`,
    `- Stress score: ${body.stressScore ?? 'n/a'}`,
    `- Main stressor: ${body.stressor?.trim() || 'n/a'}`
  ].join('\n');

  const result = await generateGeminiText({
    apiKey,
    fetch,
    prompt,
    temperature: 0.4,
    maxOutputTokens: 420,
    model
  });

  if (!result.ok && result.status === 429) {
    return json({
      plan: fallbackInterventionPlan(body),
      warning: 'Gemini rate-limited (429). Showing local fallback intervention plan.',
      source: 'fallback'
    });
  }

  if (!result.ok) {
    return json({ error: `${result.message} (model: ${result.model})` }, { status: 502 });
  }

  return json({ plan: result.text, source: 'gemini', model: result.model });
};
