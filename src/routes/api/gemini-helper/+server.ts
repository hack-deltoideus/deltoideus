import { env } from '$env/dynamic/private';
import { collectGeminiApiKeys, generateGeminiTextWithFallbacks } from '$lib/server/gemini';
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

function classifyQuestion(question: string): 'identity' | 'greeting' | 'planning' | 'reflection' | 'support' {
  const normalized = question.toLowerCase();

  if (
    normalized.includes('your name') ||
    normalized.includes('who are you') ||
    normalized.includes('what are you') ||
    normalized.includes('what can you do')
  ) {
    return 'identity';
  }

  if (
    /^(hi|hello|hey|yo|good morning|good afternoon|good evening)\b/.test(normalized) ||
    normalized === 'sup'
  ) {
    return 'greeting';
  }

  if (
    normalized.includes('plan') ||
    normalized.includes('schedule') ||
    normalized.includes('deadline') ||
    normalized.includes('focus') ||
    normalized.includes('study')
  ) {
    return 'planning';
  }

  if (
    normalized.includes('feel') ||
    normalized.includes('why') ||
    normalized.includes('stressed') ||
    normalized.includes('anxious') ||
    normalized.includes('overwhelmed')
  ) {
    return 'reflection';
  }

  return 'support';
}

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

function buildFallbackWarning(result: { status: number; message: string; model: string }, label: string): string {
  const normalized = result.message.toLowerCase();
  const retryMatch = result.message.match(/retry in ([\d.]+)s/i);
  const retrySeconds = retryMatch ? Math.max(1, Math.ceil(Number.parseFloat(retryMatch[1] ?? '0'))) : null;

  if (
    result.status === 429 ||
    normalized.includes('quota exceeded') ||
    normalized.includes('resource exhausted') ||
    normalized.includes('rate limit')
  ) {
    return retrySeconds
      ? `Gemini quota is currently exhausted for the configured API key, so Sanctuary is showing the local fallback ${label} instead. Try again in about ${retrySeconds} seconds. (${result.model})`
      : `Gemini quota is currently exhausted for the configured API key, so Sanctuary is showing the local fallback ${label} instead. (${result.model})`;
  }

  return `Gemini is temporarily unavailable, so Sanctuary is showing the local fallback ${label} instead. (${result.model})`;
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
  const apiKeys = collectGeminiApiKeys([
    env.GEMINI_KEY,
    env.GEMINI_FALLBACK_KEY,
    env.GEMINI_KEYS,
    env.GEMINI_API_KEY,
    env.GOOGLE_API_KEY
  ]);
  if (apiKeys.length === 0) {
    return json(
      {
        error:
          'Missing Gemini API key on server. Set GEMINI_KEY, GEMINI_FALLBACK_KEY, GEMINI_KEYS, GEMINI_API_KEY, or GOOGLE_API_KEY.'
      },
      { status: 500 }
    );
  }
  const model = env.GEMINI_MODEL || 'gemini-2.5-flash-lite';
  const models = Array.from(new Set([model, 'gemini-2.5-flash']));

  const body = (await request.json()) as HelperRequestBody;
  const question = body.question?.trim();
  if (!question) {
    return json({ error: 'Question is required.' }, { status: 400 });
  }

  const persona = body.persona ?? 'calm-coach';
  const questionType = classifyQuestion(question);
  const personaDescription =
    persona === 'tough-love'
      ? 'direct, firm, no-excuses coach who is still respectful'
      : persona === 'study-planner'
        ? 'structured planner focused on short concrete study actions'
        : 'warm, calm, practical coach';

  const recentHistory = (body.history ?? [])
    .filter((entry) => entry && (entry.role === 'user' || entry.role === 'assistant') && entry.text?.trim())
    .slice(-6)
    .map((entry) => `- ${entry.role === 'user' ? 'Student' : 'Oy'}: ${entry.text.trim()}`)
    .join('\n');

  const questionSpecificGuidance =
    questionType === 'identity'
      ? 'Reply in exactly 2 sentences. Start with "I\'m Oy." Then briefly say how you can help with stress, focus, or planning.'
      : questionType === 'greeting'
        ? 'Reply in 1 short paragraph. Greet the student briefly, then offer one concrete kind of help.'
        : questionType === 'planning'
          ? 'Give a short actionable plan. Prioritize concrete next steps over reassurance.'
          : questionType === 'reflection'
            ? 'Reflect the feeling briefly, then help the student name one useful next move.'
            : 'Answer directly and keep the reply specific to the student message.';

  const systemInstruction = [
    'You are Oy, the AI coach inside Sanctuary.',
    'Your name is Oy. Never claim to be any other person or assistant.',
    'You are having an ongoing chat with one student, not writing marketing copy.',
    '',
    'Core behavior:',
    `- Style: ${personaDescription}.`,
    '- Answer the student\'s actual question first.',
    '- Sound natural, specific, and conversational.',
    '- Do not repeat your full introduction after the first turn.',
    '- Do not call yourself a "student stress coach" unless the user directly asks who you are.',
    '- Do not default to asking about the main stressor unless it is truly the best next question.',
    '- Avoid filler, app names, and generic encouragement.',
    '- Use the recent conversation so replies feel like a continuation, not a reset.',
    '- Keep answers under 160 words unless the student explicitly asks for more detail.',
    '- Use plain language and avoid medical claims.',
    '',
    'Question handling rules:',
    '- If the student asks your name or who you are, answer directly in 1-2 sentences.',
    '- If asked your name, say "I\'m Oy" and briefly describe how you can help.',
    '- If the student greets you, greet them back briefly and offer one concrete way you can help.',
    '- If the student asks for a plan, give short, actionable steps.',
    '- If the student sounds highly distressed or unsafe, encourage reaching out to a trusted person or campus support.',
    '- Include "Next step:" only when it adds value. Do not force it into every response.',
    '',
    'Bad pattern to avoid:',
    '- Repeating a canned intro like "Hi there! I\'m Oy..." on multiple turns.',
    '- Repeating the same closing line across replies.'
  ].join('\n');

  const prompt = [
    `Question type: ${questionType}`,
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
    `Guidance for this reply: ${questionSpecificGuidance}`,
    '',
    'Recent conversation:',
    recentHistory || '- No prior conversation yet.',
    '',
    `Student message: ${question}`
  ].join('\n');

  const result = await generateGeminiTextWithFallbacks({
    apiKeys,
    fetch,
    prompt,
    systemInstruction,
    temperature: 0.6,
    maxOutputTokens: 700,
    models
  });

  if (!result.ok && shouldUseFallback(result)) {
    return json({
      reply: fallbackHelperReply(body, question),
      warning: buildFallbackWarning(result, 'coach response'),
      source: 'fallback'
    });
  }

  if (!result.ok) {
    return json({ error: `${result.message} (model: ${result.model})` }, { status: 502 });
  }

  return json({ reply: result.text, source: 'gemini', model: result.model });
};
