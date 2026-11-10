import * as vscode from 'vscode';
import * as path from 'path';
import { exportedSignatures, moduleIdentity } from './shared/bsl/moduleContext';

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
            const folders = vscode.workspace.workspaceFolders || [];
            const activeRoot = (activeDocument && vscode.workspace.getWorkspaceFolder?.(activeDocument.uri)) || (activeDocument?.uri.scheme !== 'file' && folders.length === 1 ? folders[0] : undefined);
            if (folders.length > 1 && !activeRoot) return false;
            const neighborRoot = vscode.workspace.getWorkspaceFolder?.(doc.uri);
            if (activeDocument?.uri.scheme === 'file' && !activeRoot) return false;
            if (activeRoot && neighborRoot?.uri.toString() !== activeRoot.uri.toString()) return false;
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
            const identity = moduleIdentity(doc.fileName);
            const exportedMethods = exportedSignatures(doc.getText(), 8);
            summaries.push({
                fileName: path.basename(doc.fileName),
                moduleName: identity.moduleName,
                exportedMethods,
                isCommonModule: identity.isCommonModule
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
