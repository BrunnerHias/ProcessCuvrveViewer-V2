// ============================================================
// TypeScript declarations for the Electron preload API
// ============================================================

export interface ElectronFileInfo {
  path: string;
  name: string;
}

export interface ElectronFileData {
  name: string;
  /** ArrayBuffer for binary files (.zpg) */
  data?: ArrayBuffer;
  /** UTF-8 text for text files (.xml) */
  text?: string;
}

export interface ElectronOpenDialogResult {
  canceled: boolean;
  filePaths: string[];
}

export interface ParseBatchEvent {
  results: import('../types').ImportedFile[];
  completed: number;
  total: number;
}

export interface ElectronAPI {
  isElectron: true;
  getPathForFile: (file: File) => string;
  readDirectory: (dirPath: string) => Promise<ElectronFileInfo[]>;
  readFile: (filePath: string) => Promise<ElectronFileData>;
  readFilesBatch: (filePaths: string[]) => Promise<(ElectronFileData | null)[]>;
  isDirectory: (filePath: string) => Promise<boolean>;
  showOpenDialog: (options: {
    properties?: string[];
    filters?: { name: string; extensions: string[] }[];
    title?: string;
  }) => Promise<ElectronOpenDialogResult>;
  parseFilesParallel: (filePaths: string[]) => Promise<{ total: number }>;
  onParseBatch: (callback: (batch: ParseBatchEvent) => void) => () => void;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}
