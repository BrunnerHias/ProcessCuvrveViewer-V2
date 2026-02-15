// ============================================================
// File Importer Service - Handles file/folder/drag-drop imports
// Supports both browser and Electron environments
// ============================================================

import { parseXmlString } from './xmlParser';
import { extractXmlFromZpg, isZpgFile, isXmlFile } from './zpgHandler';
import type { ImportedFile } from '../types';

export interface ImportProgress {
  current: number;
  total: number;
  filename: string;
}

export type ProgressCallback = (progress: ImportProgress) => void;

/**
 * Process a single File object and return the parsed ImportedFile.
 */
export async function processFile(file: File): Promise<ImportedFile | null> {
  try {
    if (isZpgFile(file.name)) {
      const buffer = await file.arrayBuffer();
      const xmlString = extractXmlFromZpg(buffer);
      return parseXmlString(xmlString, file.name);
    } else if (isXmlFile(file.name)) {
      const xmlString = await file.text();
      return parseXmlString(xmlString, file.name);
    }
    return null;
  } catch (err) {
    console.error(`Error processing file ${file.name}:`, err);
    return null;
  }
}

/**
 * Process multiple File objects with progress reporting.
 * Supports cancellation via AbortSignal.
 * Calls onBatch with each batch of parsed files for incremental store updates.
 */
export async function processFiles(
  files: FileList | File[],
  onProgress?: ProgressCallback,
  signal?: AbortSignal,
  onBatch?: (batch: ImportedFile[]) => void,
): Promise<ImportedFile[]> {
  const fileArray = Array.from(files);
  const total = fileArray.length;
  const results: ImportedFile[] = [];

  // Process in batches — larger batches reduce async overhead
  const BATCH_SIZE = 50;
  for (let i = 0; i < fileArray.length; i += BATCH_SIZE) {
    if (signal?.aborted) break;
    const batch = fileArray.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(batch.map(processFile));
    const validResults: ImportedFile[] = [];
    for (const result of batchResults) {
      if (result) {
        results.push(result);
        validResults.push(result);
      }
    }
    // Incremental store update — UI shows progress immediately
    if (validResults.length > 0 && onBatch) {
      onBatch(validResults);
    }
    // Report progress after each batch
    const done = Math.min(i + BATCH_SIZE, total);
    const lastFile = batch[batch.length - 1];
    onProgress?.({ current: done, total, filename: lastFile.name });
    // Yield to UI thread so progress bar can repaint
    await new Promise((r) => setTimeout(r, 0));
  }

  return results;
}

/**
 * Synchronously capture File objects from a DataTransfer.
 * MUST be called during the drop event handler (synchronously),
 * because Chrome clears DataTransfer data after the event returns.
 * On file:// origin, only dataTransfer.files works (Entry API returns null).
 */
export function captureDroppedFiles(dataTransfer: DataTransfer): File[] {
  const files: File[] = [];

  // 1. Always grab from dataTransfer.files first (most reliable, works on file://)
  if (dataTransfer.files) {
    for (let i = 0; i < dataTransfer.files.length; i++) {
      const file = dataTransfer.files[i];
      if (isXmlFile(file.name) || isZpgFile(file.name)) {
        files.push(file);
      }
    }
  }

  // 2. If dataTransfer.files was empty, try items (some browsers populate only items)
  if (files.length === 0 && dataTransfer.items) {
    for (let i = 0; i < dataTransfer.items.length; i++) {
      const item = dataTransfer.items[i];
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file && (isXmlFile(file.name) || isZpgFile(file.name))) {
          files.push(file);
        }
      }
    }
  }

  return files;
}

/**
 * Synchronously capture FileSystemEntry handles from DataTransfer items.
 * MUST be called during the drop event (Chrome clears DataTransfer after).
 * Returns entries that can be traversed asynchronously afterwards.
 * Returns null if the Entry API is not available or we're on file:// origin
 * (where the Entry API returns handles but then fails on async reads).
 */
export function captureDroppedEntries(dataTransfer: DataTransfer): FileSystemEntry[] | null {
  // Entry API is broken on file:// origin — it returns entries but then
  // throws EncodingError when trying to read them asynchronously.
  if (window.location.protocol === 'file:') return null;

  if (!dataTransfer.items) return null;

  const entries: FileSystemEntry[] = [];
  for (let i = 0; i < dataTransfer.items.length; i++) {
    const item = dataTransfer.items[i];
    if (item.kind === 'file') {
      // webkitGetAsEntry is the standard way to get directory handles
      const entry = item.webkitGetAsEntry?.();
      if (entry) entries.push(entry);
    }
  }

  return entries.length > 0 ? entries : null;
}

/**
 * Check if any dropped items contain directories.
 * Must be called synchronously during the drop event.
 * Works on both http:// and file:// origins.
 */
export function hasDirectoryEntries(dataTransfer: DataTransfer): boolean {
  // On file://, webkitGetAsEntry may work for detection even though reads fail
  if (dataTransfer.items) {
    for (let i = 0; i < dataTransfer.items.length; i++) {
      const item = dataTransfer.items[i];
      if (item.kind === 'file') {
        const entry = item.webkitGetAsEntry?.();
        if (entry?.isDirectory) return true;
      }
    }
  }
  // Fallback: check dataTransfer.files for items with no extension and size 0
  // (directories appear as 0-byte files with no recognizable extension)
  if (dataTransfer.files) {
    for (let i = 0; i < dataTransfer.files.length; i++) {
      const f = dataTransfer.files[i];
      if (f.size === 0 && !f.name.includes('.')) return true;
    }
  }
  return false;
}

/**
 * Recursively read all xml/zpg File objects from FileSystemEntry handles.
 * Works with both file and directory entries.
 * Individual entry errors are caught and logged (won't abort the whole scan).
 */
export async function readFilesFromEntries(entries: FileSystemEntry[]): Promise<File[]> {
  const files: File[] = [];

  async function readEntry(entry: FileSystemEntry): Promise<void> {
    try {
      if (entry.isFile) {
        const fileEntry = entry as FileSystemFileEntry;
        const file = await new Promise<File>((resolve, reject) => {
          fileEntry.file(resolve, reject);
        });
        if (isXmlFile(file.name) || isZpgFile(file.name)) {
          files.push(file);
        }
      } else if (entry.isDirectory) {
        const dirEntry = entry as FileSystemDirectoryEntry;
        const reader = dirEntry.createReader();
        // readEntries may return partial results, must call repeatedly until empty
        let batch: FileSystemEntry[] = [];
        do {
          batch = await new Promise<FileSystemEntry[]>((resolve, reject) => {
            reader.readEntries(resolve, reject);
          });
          for (const child of batch) {
            await readEntry(child);
          }
        } while (batch.length > 0);
      }
    } catch (err) {
      console.warn(`[fileImporter] Failed to read entry "${entry.name}":`, err);
    }
  }

  // Process entries sequentially to avoid overwhelming the filesystem API
  for (const entry of entries) {
    await readEntry(entry);
  }
  return files;
}

// ============================================================
// Electron-specific functions — use Node.js fs via IPC
// ============================================================

/** Check if running inside Electron */
export function isElectron(): boolean {
  return !!window.electronAPI?.isElectron;
}

/**
 * In Electron: get absolute paths from dropped File objects.
 * Uses webUtils.getPathForFile() via preload bridge (required with contextIsolation).
 */
export function getDroppedPaths(dataTransfer: DataTransfer): string[] {
  const api = window.electronAPI;
  if (!api) return [];
  const paths: string[] = [];
  if (dataTransfer.files) {
    for (let i = 0; i < dataTransfer.files.length; i++) {
      try {
        const p = api.getPathForFile(dataTransfer.files[i]);
        if (p) paths.push(p);
      } catch (err) {
        console.warn('[fileImporter] getPathForFile failed for', dataTransfer.files[i].name, err);
      }
    }
  }
  return paths;
}

/**
 * In Electron: process dropped paths (files and/or folders).
 * Uses Node.js via IPC to recursively read directories.
 */
export async function processDroppedPaths(
  paths: string[],
  onProgress?: ProgressCallback,
  signal?: AbortSignal,
  onBatch?: (batch: ImportedFile[]) => void,
): Promise<ImportedFile[]> {
  const api = window.electronAPI;
  if (!api) throw new Error('Not running in Electron');

  // 1. Expand directories into file lists
  const allFilePaths: string[] = [];
  for (const p of paths) {
    if (signal?.aborted) break;
    const isDir = await api.isDirectory(p);
    if (isDir) {
      const dirFiles = await api.readDirectory(p);
      for (const f of dirFiles) {
        allFilePaths.push(f.path);
      }
    } else {
      const name = p.split(/[\\/]/).pop() || p;
      if (isXmlFile(name) || isZpgFile(name)) {
        allFilePaths.push(p);
      }
    }
  }

  if (allFilePaths.length === 0) return [];

  const total = allFilePaths.length;
  const results: ImportedFile[] = [];

  // ── Prefer worker-thread parallel parsing (Electron with worker pool) ──
  if (api.parseFilesParallel && api.onParseBatch) {
    // Listen for incremental batch events from the worker pool
    const cleanup = api.onParseBatch((batch) => {
      if (batch.results.length > 0) {
        // Convert plain arrays from worker to Float64Array (expected by CurveChannel)
        const converted = convertBatchArrays(batch.results);
        results.push(...converted);
        onBatch?.(converted);
      }
      const lastName = allFilePaths[Math.min(batch.completed, total) - 1]?.split(/[\\/]/).pop() || '';
      onProgress?.({ current: batch.completed, total, filename: lastName });
    });

    try {
      await api.parseFilesParallel(allFilePaths);
    } finally {
      cleanup(); // Remove IPC listener
    }
    return results;
  }

  // ── Fallback: single-threaded read → parse in renderer ──

  // 2. Read and parse files in batches with read-ahead pipeline
  const BATCH_SIZE = 50;
  // Pre-fetch first batch
  let nextBatchPromise: Promise<Array<{ name: string; data?: ArrayBuffer; text?: string } | null>> | null =
    api.readFilesBatch(allFilePaths.slice(0, BATCH_SIZE));

  for (let i = 0; i < allFilePaths.length; i += BATCH_SIZE) {
    if (signal?.aborted) break;

    // Await current batch (already pre-fetched)
    const batchData = await nextBatchPromise!;

    // Start pre-fetching next batch while we parse
    const nextStart = i + BATCH_SIZE;
    nextBatchPromise = nextStart < allFilePaths.length
      ? api.readFilesBatch(allFilePaths.slice(nextStart, nextStart + BATCH_SIZE))
      : null;

    const batchResults: ImportedFile[] = [];
    for (const fileData of batchData) {
      if (!fileData) continue;
      try {
        let parsed: ImportedFile | null = null;
        if (isZpgFile(fileData.name) && fileData.data) {
          const xmlString = extractXmlFromZpg(fileData.data);
          parsed = parseXmlString(xmlString, fileData.name);
        } else if (isXmlFile(fileData.name) && fileData.text) {
          parsed = parseXmlString(fileData.text, fileData.name);
        }
        if (parsed) {
          results.push(parsed);
          batchResults.push(parsed);
        }
      } catch (err) {
        console.error(`[fileImporter] Error processing ${fileData.name}:`, err);
      }
    }

    // Incremental store update
    if (batchResults.length > 0 && onBatch) {
      onBatch(batchResults);
    }

    const done = Math.min(i + BATCH_SIZE, total);
    const lastName = allFilePaths[Math.min(i + BATCH_SIZE, total) - 1]?.split(/[\\/]/).pop() || '';
    onProgress?.({ current: done, total, filename: lastName });
    // Yield to UI thread
    await new Promise((r) => setTimeout(r, 0));
  }

  return results;
}

/**
 * Convert worker-thread results (plain arrays) to the expected
 * Float64Array format for CurveChannel.pointsX / pointsY.
 */
function convertBatchArrays(files: ImportedFile[]): ImportedFile[] {
  for (const file of files) {
    for (const curve of file.curves) {
      if (Array.isArray(curve.pointsX)) {
        curve.pointsX = Float64Array.from(curve.pointsX as unknown as number[]);
      }
      if (Array.isArray(curve.pointsY)) {
        curve.pointsY = Float64Array.from(curve.pointsY as unknown as number[]);
      }
    }
  }
  return files;
}
