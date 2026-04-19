type OpenAIFetch = typeof fetch;

type OpenAIInputMessage = {
	role: 'developer' | 'user' | 'assistant';
	content: string;
};

type OpenAIOptions = {
	apiKey: string;
	fetch: OpenAIFetch;
	input: string | OpenAIInputMessage[];
	instructions?: string;
	temperature: number;
	maxOutputTokens: number;
	model?: string;
};

type OpenAISuccess = {
	ok: true;
	text: string;
	model: string;
};

type OpenAIFailure = {
	ok: false;
	status: number;
	message: string;
	model: string;
};

export type OpenAIResult = OpenAISuccess | OpenAIFailure;

function extractOpenAIError(data: unknown): string | null {
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

function extractOpenAIText(data: unknown): string {
	if (!data || typeof data !== 'object') {
		return '';
	}

	const directOutput = 'output_text' in data ? data.output_text : null;
	if (typeof directOutput === 'string' && directOutput.trim()) {
		return directOutput.trim();
	}

	const output = 'output' in data ? data.output : null;
	if (!Array.isArray(output)) {
		return '';
	}

	const fragments = output.flatMap((item: unknown) => {
		if (!item || typeof item !== 'object' || !('content' in item) || !Array.isArray(item.content)) {
			return [];
		}

		return item.content.flatMap((contentPart: unknown) => {
			if (!contentPart || typeof contentPart !== 'object') {
				return [];
			}

			const type = 'type' in contentPart ? contentPart.type : null;
			const text = 'text' in contentPart ? contentPart.text : null;
			return type === 'output_text' && typeof text === 'string' && text.trim() ? [text.trim()] : [];
		});
	});

	return fragments.join('\n').trim();
}

export async function generateOpenAIText({
	apiKey,
	fetch,
	input,
	instructions,
	temperature,
	maxOutputTokens,
	model = 'gpt-4.1-mini'
}: OpenAIOptions): Promise<OpenAIResult> {
	try {
		const response = await fetch('https://api.openai.com/v1/responses', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${apiKey}`
			},
			body: JSON.stringify({
				model,
				input,
				instructions,
				temperature,
				max_output_tokens: maxOutputTokens,
				store: false,
				text: {
					format: {
						type: 'text'
					}
				}
			})
		});

		if (!response.ok) {
			let message = `OpenAI API failed with status ${response.status}.`;

			try {
				const data = await response.json();
				const extracted = extractOpenAIError(data);
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
		const text = extractOpenAIText(data);

		if (!text) {
			return {
				ok: false,
				status: 502,
				message: 'OpenAI returned an empty response.',
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
					? `OpenAI request failed before a response was received: ${error.message}`
					: 'OpenAI request failed before a response was received.',
			model
		};
	}
}
