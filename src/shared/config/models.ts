export const SUPPORTED_MODELS = ['deepseek-v4.1-flash-1017', 'gpt-6.1-sol', 'gpt-6-sol'] as const;
export const DEFAULT_AUTOCOMPLETE_MODEL = SUPPORTED_MODELS[0];
const LEGACY_DEEPSEEK_MODEL = 'deepseek-v4.1-flash';
export type ModelPurpose = 'autocompleteModel' | 'reasoningModel';

export function validateModel(model: unknown): string {
    if (model === LEGACY_DEEPSEEK_MODEL) return DEFAULT_AUTOCOMPLETE_MODEL;
    if (typeof model !== 'string' || !SUPPORTED_MODELS.includes(model as typeof SUPPORTED_MODELS[number])) {
        throw new Error('Выберите модель из списка настроек расширения.');
    }
    return model;
}

/** Upgrade saved legacy settings without rewriting user/workspace configuration. */
export function resolveModel(model: unknown, fallback: string = DEFAULT_AUTOCOMPLETE_MODEL): string {
    try { return validateModel(model); }
    catch { return fallback; }
}

/** Explicit tested profile for bounded interactive requests; other model routes retain their own defaults. */
export function boundedCompletionControls(model: string): { reasoning_effort?: 'low' } {
    return model === DEFAULT_AUTOCOMPLETE_MODEL ? { reasoning_effort: 'low' } : {};
}
