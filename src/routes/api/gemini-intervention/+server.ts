import { env } from '$env/dynamic/private';
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

export const POST: RequestHandler = async ({ request, fetch }) => {
  const apiKey = env.GEMINI_KEY;
  if (!apiKey) {
    return json({ error: 'Missing GEMINI_KEY on server.' }, { status: 500 });
  }

  const body = (await request.json()) as GeminiRequestBody;

  const prompt = [
    'You are a calm student stress coach for a hackathon MVP.',
    'Return only a short action plan in 4 bullets.',
    'Each bullet must be practical and take less than 5 minutes.',
    'Include one breathing step, one immediate workload step, one physical reset, and one follow-up check.',
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

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.4,
          maxOutputTokens: 220
        }
      })
    }
  );

  if (!response.ok) {
    return json({ error: `Gemini API failed with status ${response.status}.` }, { status: 502 });
  }

  const data = await response.json();
  const text =
    data?.candidates?.[0]?.content?.parts
      ?.map((part: { text?: string }) => part.text ?? '')
      .join('\n')
      .trim() ?? '';

  if (!text) {
    return json({ error: 'Gemini returned an empty response.' }, { status: 502 });
  }

  return json({ plan: text });
};
