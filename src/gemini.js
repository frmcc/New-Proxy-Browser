// Gemini API, called straight from the browser with the user's own key.

const BASE = 'https://generativelanguage.googleapis.com/v1beta';
const VARIANT_KEY = 'pdf-tut.thinking.';

export class GeminiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'GeminiError';
    this.status = status;
  }
}

// Thinking adds seconds before the first word. How to switch it off depends on
// the model generation, so try the likely spelling first and fall back.
function thinkingVariants(model) {
  const off = { thinkingBudget: 0 };
  const minimal = { thinkingLevel: 'minimal' };
  if (/2\.5/.test(model)) return [off, null];
  if (/2\.0|1\.5/.test(model)) return [null];
  return [minimal, off, null];
}

function friendly(status, message, model) {
  if (/api key/i.test(message) || status === 401 || status === 403)
    return 'Gemini rejected the API key. Check it in Settings.';
  if (status === 404) return `The model "${model}" is not available for this key. Pick another in Settings.`;
  if (status === 429) return 'Gemini rate limit reached. Wait a moment and try again.';
  if (status >= 500) return 'Gemini is having trouble right now. Try again in a moment.';
  return message || `Gemini returned an error (${status}).`;
}

async function readError(res, model) {
  let message = '';
  try {
    message = (await res.json())?.error?.message ?? '';
  } catch {}
  return { raw: message, error: new GeminiError(friendly(res.status, message, model), res.status) };
}

async function* readSse(res) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let produced = false;
  let stopReason = null;
  const handle = function* (line) {
    if (!line.startsWith('data:')) return;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') return;
    const data = JSON.parse(payload);
    if (data.error) throw new GeminiError(data.error.message || 'Gemini returned an error.', data.error.code);
    if (data.promptFeedback?.blockReason)
      throw new GeminiError(`Gemini declined this slide (${data.promptFeedback.blockReason}).`);
    const candidate = data.candidates?.[0];
    for (const part of candidate?.content?.parts ?? []) {
      if (part.thought || !part.text) continue;
      produced = true;
      yield part.text;
    }
    if (candidate?.finishReason) stopReason = candidate.finishReason;
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trimEnd();
      buffer = buffer.slice(nl + 1);
      yield* handle(line);
    }
  }
  yield* handle(buffer.trim());
  if (!produced) {
    throw new GeminiError(
      stopReason && stopReason !== 'STOP'
        ? `Gemini stopped without an answer (${stopReason}).`
        : 'Gemini returned an empty answer. Try again.',
    );
  }
}

// Sends one request, working out on the way how this model wants thinking
// switched off. Resolves with the successful Response.
async function post(method, { apiKey, model, system, parts, fast, signal, config }) {
  const variants = fast ? thinkingVariants(model) : [null];
  let start = Number(localStorage.getItem(VARIANT_KEY + model) ?? 0);
  if (!(start >= 0 && start < variants.length)) start = 0;

  for (let i = start; ; i++) {
    const generationConfig = { ...config };
    if (variants[i]) generationConfig.thinkingConfig = variants[i];
    let res;
    try {
      res = await fetch(`${BASE}/models/${encodeURIComponent(model)}:${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts }],
          generationConfig,
        }),
        signal,
      });
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      throw new GeminiError('Could not reach Gemini. Check the internet connection.');
    }
    if (res.ok) {
      if (fast) localStorage.setItem(VARIANT_KEY + model, String(i));
      return res;
    }
    const { raw, error } = await readError(res, model);
    // A 400 that complains about thinking means this model wants a
    // different spelling; anything else is a real failure.
    if (res.status === 400 && /think/i.test(raw) && i < variants.length - 1) continue;
    throw error;
  }
}

// The study note: streamed, so the first words show up at once.
export async function* streamGenerate(request) {
  const res = await post('streamGenerateContent?alt=sse', {
    ...request,
    config: { temperature: 0.4, maxOutputTokens: 4096 },
  });
  yield* readSse(res);
}

// A short one-shot answer (used to read handwriting).
export async function generateText(request) {
  const res = await post('generateContent', { ...request, config: { temperature: 0, maxOutputTokens: 512 } });
  const data = await res.json();
  return (data.candidates?.[0]?.content?.parts ?? [])
    .filter((part) => !part.thought && part.text)
    .map((part) => part.text)
    .join('');
}

export async function listFlashModels(apiKey) {
  const res = await fetch(`${BASE}/models?pageSize=200`, { headers: { 'x-goog-api-key': apiKey } });
  if (!res.ok) throw (await readError(res, '')).error;
  const { models = [] } = await res.json();
  return models
    .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
    .map((m) => m.name.replace(/^models\//, ''))
    .filter((n) => /flash/.test(n) && !/tts|image|live|audio|embedding/.test(n))
    .sort();
}
