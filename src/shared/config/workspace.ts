import * as vscode from 'vscode';

export function isBslDocument(document?: vscode.TextDocument): boolean {
    return !!document && (['bsl', '1c', 'oscript'].includes(document.languageId) || /\.(bsl|os|1c)$/i.test(document.fileName));
}

export function workspaceRoot(document = vscode.window.activeTextEditor?.document): string {
    const folder = document && vscode.workspace.getWorkspaceFolder?.(document.uri);
    // A file outside the workspace must not borrow another project's configuration.
    if (document?.uri?.scheme === 'file' && !folder) return '';
    if (folder) return folder.uri.fsPath;
    const folders = vscode.workspace.workspaceFolders || [];
    return folders.length === 1 ? folders[0].uri.fsPath : '';
}
