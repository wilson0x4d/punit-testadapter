// SPDX-FileCopyrightText: © 2026 Shaun Wilson
// SPDX-License-Identifier: MIT

/**
 * Workspace configuration accessors for pUnit test adapter.
 * All functions have a single vscode dependency (getConfiguration / Uri).
 */

import * as path from 'node:path'
import * as vscode from 'vscode'

export function getTestPackageName(workspaceFolder: vscode.WorkspaceFolder): string {
    const name = `${vscode.workspace
        .getConfiguration('punit', workspaceFolder)
        .get<string>('--test-package', 'tests')}`.trim()
    return name.length === 0 ? 'tests' : name
}

export function getWatcherPattern(workspaceFolder: vscode.WorkspaceFolder): string {
    return `**/${getTestPackageName(workspaceFolder)}/**/*.py`
}

export function getJustMyCode(workspaceFolder: vscode.WorkspaceFolder): boolean {
    return vscode.workspace
        .getConfiguration('punit', workspaceFolder)
        .get<boolean>('just_my_code', true)
}

export function getParallelism(workspaceFolder: vscode.WorkspaceFolder): boolean {
    return vscode.workspace
        .getConfiguration('punit', workspaceFolder)
        .get<boolean>('parallelism', true)
}

export async function getPythonPath(workspaceFolder: vscode.WorkspaceFolder): Promise<string> {
    let configuredPythonPath = `${vscode.workspace
        .getConfiguration('punit', workspaceFolder)
        .get<string | undefined>('PYTHONPATH', undefined)}`
    if (configuredPythonPath && configuredPythonPath.length > 0) {
        vscode.workspace.workspaceFolders?.forEach(workspaceFolder => {
            configuredPythonPath = configuredPythonPath
                .replaceAll('${workspaceFolder:' + workspaceFolder.name + '}', workspaceFolder.uri.fsPath)
                .replaceAll('${workspaceFolder}', workspaceFolder.uri.fsPath)
        })
        return configuredPythonPath
    } else if (process.env.PYTHONPATH && process.env.PYTHONPATH.length > 0) {
        return process.env.PYTHONPATH
    } else {
        let computedPythonPath = workspaceFolder.uri.fsPath
        try {
            const srcStat = await vscode.workspace.fs.stat(vscode.Uri.file(path.join(computedPythonPath, 'src')))
            if (srcStat.type === vscode.FileType.Directory) {
                computedPythonPath = path.join(computedPythonPath, 'src')
            }
        } catch (_e) {
            // NOP
        }
        return computedPythonPath
    }
}

export async function whichPythonExe(workspaceFolder: vscode.WorkspaceFolder, output: vscode.OutputChannel): Promise<string> {
    try {
        const python = vscode.extensions.getExtension('ms-python.python')
        if (python) {
            if (!python.isActive) {
                await python.activate()
            }
            if (typeof python.exports?.settings?.getExecutionDetails === 'function') {
                const exedetails = await python.exports?.settings?.getExecutionDetails(workspaceFolder.uri)
                if (exedetails?.execCommand) {
                    return exedetails.execCommand[0]
                }
            }
        }
    } catch (e) {
        const err = <Error>e
        output.appendLine(err.message + '\r\n' + err.stack)
    }
    const pythonConfig = vscode.workspace.getConfiguration('python')
    const pythonPath = pythonConfig.get<string>('defaultInterpreterPath')
    if (pythonPath && pythonPath.trim().length) { return pythonPath }
    return process.platform !== 'win32' ? 'python3' : 'python'
}

export async function whichDebugpyPath(): Promise<string> {
    const pythonExtension = vscode.extensions.getExtension('ms-python.debugpy')
    return path.dirname(await pythonExtension!.exports.debug.getDebuggerPackagePath())
}
