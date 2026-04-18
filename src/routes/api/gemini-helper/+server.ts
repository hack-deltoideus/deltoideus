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

function shouldUseFallback(result: { ok: false; status: number; message: string }): boolean {
  const normalized = result.message.toLowerCase();

  return (
    result.status === 429 ||
    result.status === 500 ||
    result.status === 503 ||
    normalized.includes('high demand') ||
    normalized.includes('rate limit') ||
    normalized.includes('rate-limited') ||
    normalized.includes('resource exhausted') ||
    normalized.includes('temporarily unavailable')
  );
}

function fallbackHelperReply(body: HelperRequestBody, question: string): string {
  const persona = body.persona ?? 'calm-coach';
  const normalizedQuestion = question.toLowerCase();
  const stressor = body.stressor?.trim() || 'general overload';
  const highStress = body.stressLevel === 'high';
  const focusRequest =
    normalizedQuestion.includes('focus') ||
    normalizedQuestion.includes('deadline') ||
    normalizedQuestion.includes('study');
  const celebrationRequest =
    normalizedQuestion.includes('victory') ||
    normalizedQuestion.includes('win') ||
    normalizedQuestion.includes('progress');
  const breathingRequest =
    normalizedQuestion.includes('breath') ||
    normalizedQuestion.includes('panic') ||
    normalizedQuestion.includes('overwhelm');

  const opener =
    persona === 'tough-love'
      ? highStress
        ? 'You do not need a perfect plan. You need one steady move right now.'
        : 'You already know enough to begin. Let us make this concrete.'
      : persona === 'study-planner'
        ? 'Let us turn this into a short plan you can actually follow.'
        : highStress
          ? 'You are carrying a lot right now, so let us lower the pressure first.'
          : 'We can make this feel lighter with one clear next move.';

  const steps = breathingRequest
    ? [
        '1. Put both feet on the floor and exhale longer than you inhale for five breaths.',
        '2. Name the next tiny action out loud so your brain has one target, not ten.',
        `3. Write one sentence about what matters most with "${stressor}" in the next hour.`
      ]
    : celebrationRequest
      ? [
          '1. Write down the specific win in one sentence so it feels real.',
          '2. Note what helped you get there, because that is the part worth repeating.',
          '3. Choose one small reward or recovery step before you move to the next task.'
        ]
      : focusRequest
        ? [
            '1. Close every tab or app that is not needed for the next 10 minutes.',
            '2. Pick one task that can be started, not finished, in five minutes.',
            `3. If "${stressor}" is crowding your head, write it on paper so it stops taking up working memory.`
          ]
        : [
            highStress
              ? '1. Slow the pace for one minute before you try to solve anything.'
              : '1. Start with the smallest task that will make the rest of the day easier.',
            '2. Shrink the next action until it feels almost too easy to avoid.',
            `3. Decide what can wait until later so "${stressor}" stops feeling infinite.`
          ];

  const nextStep = breathingRequest
    ? 'Next step: Do five slow exhales right now, then send yourself a one-line plan for the next 10 minutes.'
    : celebrationRequest
      ? 'Next step: Capture the win in one sentence and choose the very next thing you want to protect that progress.'
      : focusRequest
        ? 'Next step: Start a 10-minute timer and work only on the first visible step.'
        : 'Next step: Pick one tiny action and do it before you think about the full problem again.';

  return [opener, '', `You asked: "${question}"`, ...steps, nextStep].join('\n');
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
    '- Keep answers concise but complete and action-focused.',
    '- Use plain language and avoid medical claims.',
    '- End with one best next step prefixed with "Next step:".',
    '- If stress sounds severe, suggest contacting a trusted person or campus support.',
    '- Use short paragraphs or a few numbered steps when helpful.',
    '- Keep the total answer under 220 words.',
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
    maxOutputTokens: 700,
    model
  });

  if (!result.ok && shouldUseFallback(result)) {
    return json({
      reply: fallbackHelperReply(body, question),
      warning: `Gemini is temporarily unavailable. Showing local fallback coach response instead. (${result.model})`,
      source: 'fallback'
    });
  }

  if (!result.ok) {
    return json({ error: `${result.message} (model: ${result.model})` }, { status: 502 });
  }

  return json({ reply: result.text, source: 'gemini', model: result.model });
};
