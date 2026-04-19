type GeminiFetch = typeof fetch;

type GeminiOptions = {
	apiKey: string;
	fetch: GeminiFetch;
	prompt: string;
	systemInstruction?: string;
	temperature: number;
	maxOutputTokens: number;
	model?: string;
};

type GeminiFallbackOptions = Omit<GeminiOptions, 'model' | 'apiKey'> & {
	apiKeys: string[];
	models: string[];
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

export function collectGeminiApiKeys(values: Array<string | undefined | null>): string[] {
	return Array.from(
		new Set(
			values
				.flatMap((value) => (value ?? '').split(','))
				.map((value) => value.trim())
				.filter(Boolean)
		)
	);
}

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
	systemInstruction,
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
				...(systemInstruction
					? {
							systemInstruction: {
								parts: [{ text: systemInstruction }]
							}
						}
					: {}),
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

export async function generateGeminiTextWithFallbacks({
	apiKeys,
	fetch,
	prompt,
	systemInstruction,
	temperature,
	maxOutputTokens,
	models
}: GeminiFallbackOptions): Promise<GeminiResult> {
	let lastFailure: GeminiFailure | null = null;

	for (const apiKey of apiKeys) {
		for (const model of models) {
			const result = await generateGeminiText({
				apiKey,
				fetch,
				prompt,
				systemInstruction,
				temperature,
				maxOutputTokens,
				model
			});

			if (result.ok) {
				return result;
			}

			lastFailure = result;

			const normalized = result.message.toLowerCase();
			const shouldTryNextModelOrKey =
				result.status === 429 ||
				result.status === 500 ||
				result.status === 503 ||
				normalized.includes('quota') ||
				normalized.includes('resource exhausted') ||
				normalized.includes('rate limit') ||
				normalized.includes('temporarily unavailable') ||
				normalized.includes('high demand');

			if (!shouldTryNextModelOrKey) {
				return result;
			}
		}
	}

	return (
		lastFailure ?? {
			ok: false,
			status: 500,
			message: 'No Gemini models were available to try.',
			model: models[0] ?? 'unknown'
		}
	);
}
