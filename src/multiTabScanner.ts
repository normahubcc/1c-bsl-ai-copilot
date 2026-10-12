import * as vscode from 'vscode';
import * as path from 'path';

export interface OpenModuleSummary {
    fileName: string;
    moduleName: string;
    exportedMethods: string[];
    isCommonModule: boolean;
}

/**
 * Scans open editor tabs (.bsl / .os) to provide real-time multi-file context to the LLM.
 * Gives 1C developers Cursor-grade cross-file awareness without heavy indexing.
 */
export class MultiTabScanner {
    public static getOpenModulesContext(activeDocument?: vscode.TextDocument): string {
        const openDocs = vscode.workspace.textDocuments.filter(doc => {
            if (activeDocument && doc.uri.toString() === activeDocument.uri.toString()) {
                return false;
            }
            return (
                (doc.fileName.endsWith('.bsl') || doc.fileName.endsWith('.os')) &&
                !doc.isClosed &&
                doc.getText().length > 0
            );
        });

        if (openDocs.length === 0) {
            return '';
        }

        const summaries: OpenModuleSummary[] = [];

        // Sample up to 6 most relevant open documents
        for (const doc of openDocs.slice(0, 6)) {
            const baseName = path.basename(doc.fileName, path.extname(doc.fileName));
            const text = doc.getText();
            const exportedMethods: string[] = [];

            // Fast regex to capture exported procedures and functions in 1C BSL
            const regex = /(?:Процедура|Функция)\s+([A-Za-zА-Яа-я0-9_]+)\s*\(([^)]*)\)\s*(?:Экспорт|Export)/gi;
            let match;
            while ((match = regex.exec(text)) !== null) {
                const name = match[1];
                const rawParams = match[2].trim();
                const cleanParams = rawParams ? rawParams.replace(/\s+/g, ' ') : '';
                exportedMethods.push(`${name}(${cleanParams})`);
                if (exportedMethods.length >= 8) {
                    break;
                }
            }

            summaries.push({
                fileName: path.basename(doc.fileName),
                moduleName: baseName,
                exportedMethods,
                isCommonModule: baseName.toLowerCase().includes('клиент') ||
                                baseName.toLowerCase().includes('сервер') ||
                                baseName.toLowerCase().includes('общ')
            });
        }

        if (summaries.length === 0) {
            return '';
        }

        let result = 'СМЕЖНЫЕ ОТКРЫТЫЕ МОДУЛИ В РАБОЧЕЙ ОБЛАСТИ (MULTI-TAB CONTEXT):\n';
        for (const s of summaries) {
            result += `- Модуль "${s.moduleName}" (${s.fileName}):\n`;
            if (s.exportedMethods.length > 0) {
                result += `  Экспортные методы: ${s.exportedMethods.join(', ')}\n`;
            } else {
                result += `  (Открыт в соседней вкладке)\n`;
            }
        }

        return result;
    }

    public static getOpenModulesCount(activeDocument?: vscode.TextDocument): number {
        return vscode.workspace.textDocuments.filter(doc => {
            if (activeDocument && doc.uri.toString() === activeDocument.uri.toString()) {
                return false;
            }
            return (doc.fileName.endsWith('.bsl') || doc.fileName.endsWith('.os')) && !doc.isClosed;
        }).length;
    }

    public static getOpenModulesNames(activeDocument?: vscode.TextDocument): string[] {
        return vscode.workspace.textDocuments
            .filter(doc => {
                if (activeDocument && doc.uri.toString() === activeDocument.uri.toString()) {
                    return false;
                }
                return (doc.fileName.endsWith('.bsl') || doc.fileName.endsWith('.os')) && !doc.isClosed;
            })
            .map(doc => path.basename(doc.fileName));
    }
}
