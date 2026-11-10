import * as vscode from 'vscode';

const revisions = new Map<string, number>();
let subscription: vscode.Disposable | undefined;
let sequence = 0;
let generation = 0;

function resources(tab: vscode.Tab): string[] {
    const input = tab.input;
    if (input instanceof vscode.TabInputText) return [input.uri.toString()];
    if (input instanceof vscode.TabInputTextDiff) return [input.original.toString(), input.modified.toString()];
    return [];
}

/** TextDocument can outlive its last tab. Track that separate lifecycle, including split editors. */
export function watchEditorTargetLifecycle(): vscode.Disposable {
    if (!subscription && vscode.window.tabGroups?.onDidChangeTabs) {
        const tabs = vscode.window.tabGroups.onDidChangeTabs(event => {
            const open = new Set(vscode.window.tabGroups.all.flatMap(group => group.tabs.flatMap(resources)));
            for (const uri of new Set(event.closed.flatMap(resources))) {
                if (!open.has(uri)) revisions.set(uri, ++sequence);
            }
        });
        subscription = { dispose() { tabs.dispose(); subscription = undefined; revisions.clear(); generation = ++sequence; } };
    }
    const owned = subscription;
    return { dispose() { if (subscription === owned) owned?.dispose(); } };
}

export function targetRevision(uri: vscode.Uri): number {
    watchEditorTargetLifecycle();
    return revisions.get(uri.toString()) ?? generation;
}
