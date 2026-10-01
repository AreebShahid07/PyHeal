import * as vscode from 'vscode';
import { healIndentation, healIndentationVerified } from './healer';

export function activate(context: vscode.ExtensionContext) {
    let disposable = vscode.commands.registerCommand('extension.healPython', () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) { return; }

        const document = editor.document;
        const selections = editor.selections;

        editor.edit(editBuilder => {
            selections.forEach(selection => {
                const range = selection.isEmpty ? document.validateRange(new vscode.Range(0, 0, document.lineCount, 0)) : selection;

                const originalText = document.getText(range);
                const fixedText = healIndentation(originalText);

                editBuilder.replace(range, fixedText);
            });
        });
    });

    let smartPasteDisposable = vscode.commands.registerCommand('extension.smartPaste', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) { return; }

        try {
            const clipboardText = await vscode.env.clipboard.readText();
            // M4: smart paste uses the verified path — Python ast.parse check
            // with candidate retry when an interpreter is available; identical
            // silent behavior when it is not (v2 default output).
            const fixedText = await healIndentationVerified(clipboardText);

            editor.edit(editBuilder => {
                editor.selections.forEach(selection => {
                    editBuilder.replace(selection, fixedText);
                });
            });
        } catch (error) {
            vscode.window.showErrorMessage('Failed to read clipboard');
        }
    });

    context.subscriptions.push(disposable);
    context.subscriptions.push(smartPasteDisposable);
}

export function deactivate() { }


