import * as vscode from "vscode";

export async function checkFileExists(filePath: string): Promise<boolean> {
  try {
    const stat = await vscode.workspace.fs.stat(vscode.Uri.file(filePath));
    return stat.type === vscode.FileType.File;
  } catch (error) {
    return false;
  }
}
