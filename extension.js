const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

/**
 * Finds Python cache directories
 
 * @param {string} directoryPath - Directory path to scan
 * @returns {Promise<string[]>} - List of found __pycache__ directories
*/

async function findPyCacheDirectories(directoryPath) {
    const cacheDirectories = [];
    
    try {
        const entries = await fs.promises.readdir(directoryPath, { withFileTypes: true });
        
        for (const entry of entries) {
            const fullPath = path.join(directoryPath, entry.name);
            
            if (entry.isDirectory()) {
                if (entry.name === '__pycache__') {
                    cacheDirectories.push(fullPath);
                } else if (entry.name !== 'node_modules' && entry.name !== '.git') {
                    const subDirCaches = await findPyCacheDirectories(fullPath);
                    cacheDirectories.push(...subDirCaches);
                }
            }
        }
    } catch (error) {
        console.error(`Error scanning directory: ${directoryPath}`, error);
    }
    
    return cacheDirectories;
}

/**
 * Deletes all files and folders in the specified directory
 
 * @param {string} directoryPath - Directory path to delete
 * @returns {Promise<void>}
*/
async function deleteCacheDirectory(directoryPath) {
    try {
        const entries = await fs.promises.readdir(directoryPath, { withFileTypes: true });
        
        for (const entry of entries) {
            const fullPath = path.join(directoryPath, entry.name);
            
            if (entry.isDirectory()) {
                await deleteCacheDirectory(fullPath);
            } else {
                await fs.promises.unlink(fullPath);
            }
        }
        
        await fs.promises.rmdir(directoryPath);
    } catch (error) {
        console.error(`Error deleting directory: ${directoryPath}`, error);
        throw error;
    }
}

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
    console.log('PyCacheCleaner extension is active!');

    const findCacheCommand = vscode.commands.registerCommand('pycacheclear.findCacheFiles', async function () {
        try {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            
            if (!workspaceFolders || workspaceFolders.length === 0) {
                vscode.window.showWarningMessage('No open workspace found!');
                return;
            }
            
            vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: "Searching for Python cache files...",
                cancellable: false
            }, async () => {
                try {
                    let allCacheDirectories = [];
                    
                    for (const folder of workspaceFolders) {
                        const cacheDirectories = await findPyCacheDirectories(folder.uri.fsPath);
                        allCacheDirectories = [...allCacheDirectories, ...cacheDirectories];
                    }
                    
                    if (allCacheDirectories.length === 0) {
                        vscode.window.showInformationMessage('No __pycache__ directories found.');
                    } else {
                        const message = `Found ${allCacheDirectories.length} __pycache__ directories.`;
                        const cleanOption = 'Clean';
                        
                        const selected = await vscode.window.showInformationMessage(message, cleanOption);
                        
                        if (selected === cleanOption) {
                            vscode.commands.executeCommand('pycacheclear.cleanCache');
                        }
                    }
                } catch (error) {
                    console.error('Error searching for cache files:', error);
                    vscode.window.showErrorMessage(`Error: ${error.message}`);
                }
            });
        } catch (error) {
            console.error('Error running command:', error);
            vscode.window.showErrorMessage(`Unexpected error: ${error.message}`);
        }
    });

    const cleanCacheCommand = vscode.commands.registerCommand('pycacheclear.cleanCache', async function (resource) {
        try {
            let targetPath;
            
            if (resource && resource.fsPath) {
                targetPath = resource.fsPath;
            } else {
                const workspaceFolders = vscode.workspace.workspaceFolders;
                
                if (!workspaceFolders || workspaceFolders.length === 0) {
                    vscode.window.showWarningMessage('No open workspace found!');
                    return;
                }
                
                if (workspaceFolders.length === 1) {
                    targetPath = workspaceFolders[0].uri.fsPath;
                } else {
                    const folderOptions = workspaceFolders.map(folder => ({
                        label: folder.name,
                        description: folder.uri.fsPath,
                        fsPath: folder.uri.fsPath
                    }));
                    
                    const selected = await vscode.window.showQuickPick(folderOptions, {
                        placeHolder: 'Which workspace should have its cache files cleaned?'
                    });
                    
                    if (!selected) {
                        return;
                    }
                    
                    targetPath = selected.fsPath;
                }
            }
            
            vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: "Cleaning Python cache files...",
                cancellable: false
            }, async (progress) => {
                try {
                    const cacheDirectories = await findPyCacheDirectories(targetPath);
                    
                    if (cacheDirectories.length === 0) {
                        vscode.window.showInformationMessage('No __pycache__ directories found.');
                        return;
                    }
                    
                    const confirmMessage = `Found ${cacheDirectories.length} __pycache__ directories. Do you want to clean them?`;
                    const confirmOption = 'Yes, Clean';
                    
                    const confirmed = await vscode.window.showWarningMessage(confirmMessage, { modal: true }, confirmOption);
                    
                    if (confirmed !== confirmOption) {
                        return;
                    }
                    
                    let deletedCount = 0;
                    let totalSize = 0;
                    
                    for (const cacheDir of cacheDirectories) {
                        try {
                            const stats = await fs.promises.stat(cacheDir);
                            totalSize += stats.size;

                            await deleteCacheDirectory(cacheDir);
                            deletedCount++;
                    
                            progress.report({ 
                                message: `Cleaned ${deletedCount}/${cacheDirectories.length}`,
                                increment: (1 / cacheDirectories.length) * 100
                            });
                        } catch (error) {
                            console.error(`Error deleting directory: ${cacheDir}`, error);
                        }
                    }
                    
                    const sizeInKB = (totalSize / 1024).toFixed(2);
                    vscode.window.showInformationMessage(`Cleaning completed! Deleted ${deletedCount} __pycache__ directories (${sizeInKB} KB).`);
                } catch (error) {
                    console.error('Error cleaning cache files:', error);
                    vscode.window.showErrorMessage(`Error: ${error.message}`);
                }
            });
        } catch (error) {
            console.error('Error running command:', error);
            vscode.window.showErrorMessage(`Unexpected error: ${error.message}`);
        }
    });

    context.subscriptions.push(findCacheCommand, cleanCacheCommand);
}

function deactivate() {}

module.exports = {
    activate,
    deactivate
}
