import { env } from '$env/dynamic/private';
import { generateOpenAIText } from '$lib/server/openai';
import { json, type RequestHandler } from '@sveltejs/kit';

type InterventionRequestBody = {
  mood?: number;
  workload?: number;
  sleepQuality?: number;
  heartRate?: number;
  rrMs?: number;
  stressLevel?: string;
  stressScore?: number;
  stressor?: string;
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

function buildFallbackWarning(result: { status: number; message: string; model: string }, label: string): string {
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
      ? `OpenAI is currently rate-limited for the configured API key, so Sanctuary is showing the local fallback ${label} instead. Try again in about ${retrySeconds} seconds. (${result.model})`
      : `OpenAI is currently rate-limited for the configured API key, so Sanctuary is showing the local fallback ${label} instead. (${result.model})`;
  }

  return `OpenAI is temporarily unavailable, so Sanctuary is showing the local fallback ${label} instead. (${result.model})`;
}

function fallbackInterventionPlan(body: InterventionRequestBody): string {
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
  const apiKey = env.OPENAI_API_KEY ?? env.OPENAI_KEY ?? '';
  if (!apiKey.trim()) {
    return json(
      {
        error: 'Missing OpenAI API key on server. Set OPENAI_API_KEY or OPENAI_KEY.'
      },
      { status: 500 }
    );
  }
  const model = env.OPENAI_MODEL || 'gpt-4.1-mini';

  const body = (await request.json()) as InterventionRequestBody;

  const instructions = [
    'You are Oy, the AI coach inside Sanctuary.',
    'Return only a practical action plan in exactly 4 bullets.',
    'Each bullet must be practical and take less than 5 minutes.',
    'Include one breathing step, one immediate workload step, one physical reset, and one follow-up check.',
    'Keep the total answer under 140 words.',
    'Use plain language and avoid medical claims.'
  ].join('\n');

  const input = [
    'Student state for this intervention:',
    `- Mood: ${body.mood ?? 'n/a'}/10`,
    `- Workload: ${body.workload ?? 'n/a'}/10`,
    `- Sleep quality: ${body.sleepQuality ?? 'n/a'}/10`,
    `- Heart rate: ${body.heartRate ?? 'n/a'} bpm`,
    `- RR interval: ${body.rrMs ?? 'n/a'} ms`,
    `- Stress level: ${body.stressLevel ?? 'n/a'}`,
    `- Stress score: ${body.stressScore ?? 'n/a'}`,
    `- Main stressor: ${body.stressor?.trim() || 'n/a'}`
  ].join('\n');

  const result = await generateOpenAIText({
    apiKey,
    fetch,
    input,
    instructions,
    temperature: 0.4,
    maxOutputTokens: 420,
    model
  });

  if (!result.ok && shouldUseFallback(result)) {
    return json({
      plan: fallbackInterventionPlan(body),
      warning: buildFallbackWarning(result, 'intervention plan'),
      source: 'fallback'
    });
  }

  if (!result.ok) {
    return json({ error: `${result.message} (model: ${result.model})` }, { status: 502 });
  }

  return json({ plan: result.text, source: 'openai', model: result.model });
};
