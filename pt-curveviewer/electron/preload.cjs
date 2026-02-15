// ============================================================
// Electron Preload Script — Exposes safe IPC bridge to renderer
// ============================================================

const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  /** Check if running inside Electron */
  isElectron: true,

  /**
   * Get the absolute filesystem path for a dropped File object.
   * Required because File.path is not available with contextIsolation: true.
   * @param file A File object from DataTransfer
   * @returns Absolute path string
   */
  getPathForFile: (file) => webUtils.getPathForFile(file),

  /**
   * Recursively read a directory and return all .xml/.zpg file infos.
   * @param dirPath Absolute path to the directory
   * @returns Promise<Array<{ path: string; name: string }>>
   */
  readDirectory: (dirPath) => ipcRenderer.invoke('read-directory', dirPath),

  /**
   * Read a single file from disk.
   * For .zpg: returns { name, data: ArrayBuffer }
   * For .xml: returns { name, text: string }
   * @param filePath Absolute path to the file
   */
  readFile: (filePath) => ipcRenderer.invoke('read-file', filePath),

  /**
   * Read multiple files at once (batch).
   * @param filePaths Array of absolute file paths
   * @returns Promise<Array<{ name, data? , text? } | null>>
   */
  readFilesBatch: (filePaths) => ipcRenderer.invoke('read-files-batch', filePaths),

  /**
   * Check if a path is a directory.
   * @param filePath Absolute path
   * @returns Promise<boolean>
   */
  isDirectory: (filePath) => ipcRenderer.invoke('is-directory', filePath),

  /**
   * Show a native open dialog.
   * @param options Electron OpenDialogOptions
   * @returns Promise<{ canceled: boolean; filePaths: string[] }>
   */
  showOpenDialog: (options) => ipcRenderer.invoke('show-open-dialog', options),

  /**
   * Parse files in parallel using worker threads.
   * Files are read, decompressed and parsed in worker_threads (all CPU cores).
   * Results are sent incrementally via 'parse-batch' events.
   * @param filePaths Array of absolute file paths
   * @returns Promise<{ total: number }>
   */
  parseFilesParallel: (filePaths) => ipcRenderer.invoke('parse-files-parallel', filePaths),

  /**
   * Listen for incremental parse-batch results from worker threads.
   * @param callback ({ results: ImportedFile[], completed: number, total: number }) => void
   * @returns Cleanup function to remove listener
   */
  onParseBatch: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('parse-batch', handler);
    return () => ipcRenderer.removeListener('parse-batch', handler);
  },
});
