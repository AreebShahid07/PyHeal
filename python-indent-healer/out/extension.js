"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = require("vscode");
const healer_1 = require("./healer");
function activate(context) {
    let disposable = vscode.commands.registerCommand('extension.healPython', () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }
        const document = editor.document;
        const selections = editor.selections;
        editor.edit(editBuilder => {
            selections.forEach(selection => {
                const range = selection.isEmpty ? document.validateRange(new vscode.Range(0, 0, document.lineCount, 0)) : selection;
                const originalText = document.getText(range);
                const fixedText = (0, healer_1.healIndentation)(originalText);
                editBuilder.replace(range, fixedText);
            });
        });
    });
    let smartPasteDisposable = vscode.commands.registerCommand('extension.smartPaste', () => __awaiter(this, void 0, void 0, function* () {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }
        try {
            const clipboardText = yield vscode.env.clipboard.readText();
            const fixedText = (0, healer_1.healIndentation)(clipboardText);
            editor.edit(editBuilder => {
                editor.selections.forEach(selection => {
                    editBuilder.replace(selection, fixedText);
                });
            });
        }
        catch (error) {
            vscode.window.showErrorMessage('Failed to read clipboard');
        }
    }));
    context.subscriptions.push(disposable);
    context.subscriptions.push(smartPasteDisposable);
}
function deactivate() { }
//# sourceMappingURL=extension.js.map