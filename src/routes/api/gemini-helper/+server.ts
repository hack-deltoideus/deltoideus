import { env } from '$env/dynamic/private';
import { generateGeminiText } from '$lib/server/gemini';
import { json, type RequestHandler } from '@sveltejs/kit';

type HelperRequestBody = {
  question?: string;
  persona?: 'calm-coach' | 'tough-love' | 'study-planner';
  history?: Array<{ role: 'user' | 'assistant'; text: string }>;
  mood?: number;
  workload?: number;
  sleepQuality?: number;
  heartRate?: number;
  rrMs?: number;
  stressLevel?: string;
  stressor?: string;
};

function fallbackHelperReply(body: HelperRequestBody, question: string): string {
  const persona = body.persona ?? 'calm-coach';
  const opener =
    persona === 'tough-love'
      ? 'You are not stuck, you are overloaded. We fix that right now.'
      : persona === 'study-planner'
        ? 'Let us turn this into a short, clear plan.'
        : 'You are carrying a lot right now, and we can stabilize quickly.';

  const stressHint =
    body.stressLevel === 'high'
      ? 'Start with a 60-second breathing reset before any task.'
      : 'Take a 2-minute reset, then begin one tiny task.';

  return [
    opener,
    '',
    `Based on your question: "${question}"`,
    `1. ${stressHint}`,
    '2. Pick exactly one next task that takes 5 minutes or less.',
    '3. Put your phone away for the next 10 minutes and do only that task.',
    `4. If the stressor is "${body.stressor?.trim() || 'general overload'}", write one sentence on what can wait until tomorrow.`,
    'Next step: Start a 10-minute timer and do the smallest possible first task now.'
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
  const model = env.GEMINI_MODEL || 'gemini-2.5-flash';

  const body = (await request.json()) as HelperRequestBody;
  const question = body.question?.trim();
  if (!question) {
    return json({ error: 'Question is required.' }, { status: 400 });
  }

  const persona = body.persona ?? 'calm-coach';
  const personaDescription =
    persona === 'tough-love'
      ? 'direct, firm, no-excuses coach who is still respectful'
      : persona === 'study-planner'
        ? 'structured planner focused on short concrete study actions'
        : 'warm, calm, practical coach';

  const recentHistory = (body.history ?? [])
    .filter((entry) => entry && (entry.role === 'user' || entry.role === 'assistant') && entry.text?.trim())
    .slice(-6)
    .map((entry) => `- ${entry.role === 'user' ? 'Student' : 'Kelp'}: ${entry.text.trim()}`)
    .join('\n');

  const prompt = [
    'You are Kelp, a student stress coach inside the Stress Buddy app.',
    'Personality rules:',
    `- Style: ${personaDescription}.`,
    '- Never be cringe or overly formal.',
    '- Keep answers short and action-focused.',
    '- Use plain language and avoid medical claims.',
    '- End with one best next step prefixed with "Next step:".',
    '- If stress sounds severe, suggest contacting a trusted person or campus support.',
    '',
    'Current student state:',
    `- Mood: ${body.mood ?? 'n/a'}/10`,
    `- Workload: ${body.workload ?? 'n/a'}/10`,
    `- Sleep quality: ${body.sleepQuality ?? 'n/a'}/10`,
    `- Heart rate: ${body.heartRate ?? 'n/a'} bpm`,
    `- RR interval: ${body.rrMs ?? 'n/a'} ms`,
    `- Stress level: ${body.stressLevel ?? 'n/a'}`,
    `- Main stressor: ${body.stressor?.trim() || 'n/a'}`,
    '',
    'Recent conversation:',
    recentHistory || '- No prior conversation yet.',
    '',
    `Student question: ${question}`
  ].join('\n');

  const result = await generateGeminiText({
    apiKey,
    fetch,
    prompt,
    temperature: 0.6,
    maxOutputTokens: 260,
    model
  });

  if (!result.ok && result.status === 429) {
    return json({
      reply: fallbackHelperReply(body, question),
      warning: 'Gemini rate-limited (429). Showing local fallback coach response.',
      source: 'fallback'
    });
  }

  if (!result.ok) {
    return json({ error: `${result.message} (model: ${result.model})` }, { status: 502 });
  }

  return json({ reply: result.text, source: 'gemini', model: result.model });
};
