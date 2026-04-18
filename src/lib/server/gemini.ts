type GeminiFetch = typeof fetch;

type GeminiOptions = {
	apiKey: string;
	fetch: GeminiFetch;
	prompt: string;
	temperature: number;
	maxOutputTokens: number;
	model?: string;
};

type GeminiSuccess = {
	ok: true;
	text: string;
	model: string;
};

type GeminiFailure = {
	ok: false;
	status: number;
	message: string;
	model: string;
};

export type GeminiResult = GeminiSuccess | GeminiFailure;

function extractGeminiError(data: unknown): string | null {
	if (!data || typeof data !== 'object') {
		return null;
	}

	const error = 'error' in data ? data.error : null;
	if (!error || typeof error !== 'object') {
		return null;
	}

	const message = 'message' in error ? error.message : null;
	return typeof message === 'string' && message.trim() ? message.trim() : null;
}

export async function generateGeminiText({
	apiKey,
	fetch,
	prompt,
	temperature,
	maxOutputTokens,
	model = 'gemini-2.5-flash-lite'
}: GeminiOptions): Promise<GeminiResult> {
	const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

	try {
		const response = await fetch(url, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'x-goog-api-key': apiKey
			},
			body: JSON.stringify({
				contents: [{ role: 'user', parts: [{ text: prompt }] }],
				generationConfig: {
					temperature,
					maxOutputTokens,
					thinkingConfig: {
						thinkingBudget: 0
					}
				}
			})
		});

		if (!response.ok) {
			let message = `Gemini API failed with status ${response.status}.`;

			try {
				const data = await response.json();
				const extracted = extractGeminiError(data);
				if (extracted) {
					message = extracted;
				}
			} catch {
				const text = await response.text().catch(() => '');
				if (text.trim()) {
					message = text.trim();
				}
			}

			return {
				ok: false,
				status: response.status,
				message,
				model
			};
		}

		const data = await response.json();
		const text =
			data?.candidates?.[0]?.content?.parts
				?.map((part: { text?: string }) => part.text ?? '')
				.join('\n')
				.trim() ?? '';

		if (!text) {
			return {
				ok: false,
				status: 502,
				message: 'Gemini returned an empty response.',
				model
			};
		}

		return {
			ok: true,
			text,
			model
		};
	} catch (error) {
		return {
			ok: false,
			status: 502,
			message:
				error instanceof Error
					? `Gemini request failed before a response was received: ${error.message}`
					: 'Gemini request failed before a response was received.',
			model
		};
	}
}
