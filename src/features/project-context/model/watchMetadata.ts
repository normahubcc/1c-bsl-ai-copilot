import * as vscode from 'vscode';
import { MetadataScanner } from '../../../metadataScanner';
import { clearInlineCompletionContextCache } from '../../../inlineCompletionContext';
import { invalidateProjectContext } from '../../../entities/project-context/model/contextEpoch';

/** Object XML changes do not necessarily touch Configuration.xml. */
export function watchMetadataChanges(): vscode.Disposable[] {
    if (typeof vscode.workspace.createFileSystemWatcher !== 'function') return [];
    const subscriptions: vscode.Disposable[] = [];
    const invalidate = (uri: vscode.Uri) => {
        const root = vscode.workspace.getWorkspaceFolder(uri)?.uri.fsPath;
        MetadataScanner.clearCache(root);
        invalidateProjectContext(root);
        clearInlineCompletionContextCache();
    };
    for (const pattern of ['**/*.{xml,mdo}', '**/metadata.json']) {
        const watcher = vscode.workspace.createFileSystemWatcher(pattern);
        subscriptions.push(watcher, watcher.onDidChange(invalidate), watcher.onDidCreate(invalidate), watcher.onDidDelete(invalidate));
    }
    return subscriptions;
}
