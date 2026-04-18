import { env } from '$env/dynamic/private';
import { json, type RequestHandler } from '@sveltejs/kit';

type HelperRequestBody = {
  question?: string;
  mood?: number;
  workload?: number;
  sleepQuality?: number;
  heartRate?: number;
  rrMs?: number;
  stressLevel?: string;
  stressor?: string;
};

export const POST: RequestHandler = async ({ request, fetch }) => {
  const apiKey = env.GEMINI_KEY;
  if (!apiKey) {
    return json({ error: 'Missing GEMINI_KEY on server.' }, { status: 500 });
  }

  const body = (await request.json()) as HelperRequestBody;
  const question = body.question?.trim();
  if (!question) {
    return json({ error: 'Question is required.' }, { status: 400 });
  }

  const prompt = [
    'You are Kelp, a confident and warm student stress coach inside the Stress Buddy app.',
    'Personality rules:',
    '- Sound calm, friendly, and practical.',
    '- Never be cringe or overly formal.',
    '- Keep answers short and action-focused.',
    '- Use plain language and avoid medical claims.',
    '- End with one best next step prefixed with "Next step:".',
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
    `Student question: ${question}`
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
          temperature: 0.6,
          maxOutputTokens: 260
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

  return json({ reply: text });
};
