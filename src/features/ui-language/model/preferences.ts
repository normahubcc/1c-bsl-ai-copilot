import * as vscode from 'vscode';
import { isUiLanguage, UiLanguage } from '../../../shared/i18n/translator';

export const UI_LANGUAGE_KEY = 'normahub1c.uiLanguage';

export function preferredUiLanguage(context: vscode.ExtensionContext): UiLanguage {
    const stored = context.globalState?.get<string>(UI_LANGUAGE_KEY);
    if (isUiLanguage(stored)) return stored;
    return (vscode.env?.language || 'ru').toLowerCase().startsWith('ru') ? 'ru' : 'en';
}

export async function saveUiLanguage(context: vscode.ExtensionContext, value: unknown): Promise<UiLanguage> {
    if (!isUiLanguage(value)) throw new Error('Unsupported interface language.');
    await context.globalState.update(UI_LANGUAGE_KEY, value);
    return value;
}
