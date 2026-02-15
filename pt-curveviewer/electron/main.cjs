// ============================================================
// Electron Main Process — PT CurveViewer Gen2
// ============================================================

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { Worker } = require('worker_threads');

// Disable security warnings in dev (we don't use remote content)
process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'PT CurveViewer',
    icon: path.join(__dirname, '..', 'public', 'favicon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // Needed for preload to use Node.js APIs
    },
    // Modern frameless look with system title bar
    autoHideMenuBar: true,
  });

  // ── Prevent Electron from navigating when files/folders are dropped ──
  // Without this, Electron replaces the page with the dropped file content.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    // Allow only dev server reloads, block file:// navigation from drops
    if (!process.env.VITE_DEV_SERVER_URL || !url.startsWith(process.env.VITE_DEV_SERVER_URL)) {
      event.preventDefault();
    }
  });

  // ── F12 to toggle DevTools ──
  mainWindow.webContents.on('before-input-event', (_event, input) => {
    if (input.key === 'F12' && input.type === 'keyDown') {
      mainWindow.webContents.toggleDevTools();
    }
  });

  // In production, load the built index.html from dist/
  // In dev, load from Vite dev server
  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ── IPC Handlers ─────────────────────────────────────────────

/**
 * Recursively scan a directory for .xml and .zpg files.
 * Returns an array of absolute file paths.
 */
function scanDirectory(dirPath, results = []) {
  let entries;
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch (err) {
    console.warn(`[main] Cannot read directory: ${dirPath}`, err.message);
    return results;
  }

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      scanDirectory(fullPath, results);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if ((ext === '.xml' || ext === '.zpg') && !entry.name.startsWith('~')) {
        results.push(fullPath);
      }
    }
  }
  return results;
}

// Read a directory recursively → returns list of {path, name} for xml/zpg files
ipcMain.handle('read-directory', async (_event, dirPath) => {
  const filePaths = scanDirectory(dirPath);
  return filePaths.map((fp) => ({
    path: fp,
    name: path.basename(fp),
  }));
});

// Read a single file → returns { name, data: ArrayBuffer } or { name, text }
ipcMain.handle('read-file', async (_event, filePath) => {
  const name = path.basename(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const buffer = fs.readFileSync(filePath);

  if (ext === '.zpg') {
    // Return as ArrayBuffer for fflate decompression
    return { name, data: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) };
  } else {
    // Return as text for XML
    return { name, text: buffer.toString('utf-8') };
  }
});

// Read multiple files at once (batch) → returns array of results
ipcMain.handle('read-files-batch', async (_event, filePaths) => {
  const results = [];
  for (const filePath of filePaths) {
    try {
      const name = path.basename(filePath);
      const ext = path.extname(filePath).toLowerCase();
      const buffer = fs.readFileSync(filePath);

      if (ext === '.zpg') {
        results.push({ name, data: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) });
      } else {
        results.push({ name, text: buffer.toString('utf-8') });
      }
    } catch (err) {
      console.warn(`[main] Failed to read file: ${filePath}`, err.message);
      results.push(null);
    }
  }
  return results;
});

// Show a native folder picker dialog
ipcMain.handle('show-open-dialog', async (_event, options) => {
  const result = await dialog.showOpenDialog(mainWindow, options);
  return result;
});

// Check if a path is a directory
ipcMain.handle('is-directory', async (_event, filePath) => {
  try {
    const stat = fs.statSync(filePath);
    return stat.isDirectory();
  } catch {
    return false;
  }
});

// ── Worker Pool for parallel file parsing ────────────────────

const WORKER_SCRIPT = path.join(__dirname, 'parse-worker.cjs');
const POOL_SIZE = Math.max(1, os.cpus().length - 1); // Leave 1 core for main + renderer
let workerPool = [];
let workerBusy = [];      // true if worker[i] is busy
let pendingRequests = []; // queue of { filePaths, resolve }
let requestIdCounter = 0;
let activeResolvers = new Map(); // requestId → resolve

function initWorkerPool() {
  for (let i = 0; i < POOL_SIZE; i++) {
    const worker = new Worker(WORKER_SCRIPT);
    worker._index = i;
    worker.on('message', (msg) => {
      if (msg.type === 'parse-result') {
        const resolve = activeResolvers.get(msg.requestId);
        if (resolve) {
          activeResolvers.delete(msg.requestId);
          resolve(msg.results);
        }
        workerBusy[i] = false;
        processQueue();
      }
    });
    worker.on('error', (err) => {
      console.error(`[worker ${i}] Error:`, err);
      workerBusy[i] = false;
      processQueue();
    });
    workerPool.push(worker);
    workerBusy.push(false);
  }
}

function processQueue() {
  while (pendingRequests.length > 0) {
    const freeIdx = workerBusy.indexOf(false);
    if (freeIdx === -1) break; // all workers busy
    const req = pendingRequests.shift();
    workerBusy[freeIdx] = true;
    const rid = requestIdCounter++;
    activeResolvers.set(rid, req.resolve);
    workerPool[freeIdx].postMessage({ type: 'parse-files', filePaths: req.filePaths, requestId: rid });
  }
}

function parseFilesInWorker(filePaths) {
  return new Promise((resolve) => {
    const freeIdx = workerBusy.indexOf(false);
    if (freeIdx !== -1) {
      workerBusy[freeIdx] = true;
      const rid = requestIdCounter++;
      activeResolvers.set(rid, resolve);
      workerPool[freeIdx].postMessage({ type: 'parse-files', filePaths, requestId: rid });
    } else {
      pendingRequests.push({ filePaths, resolve });
    }
  });
}

/**
 * parse-files-parallel: receives all file paths, distributes across worker pool,
 * returns batches via event.sender.send() for incremental UI updates.
 */
ipcMain.handle('parse-files-parallel', async (event, allFilePaths) => {
  if (workerPool.length === 0) initWorkerPool();

  // Split files into chunks — each worker gets ~equal share
  const chunkSize = Math.max(5, Math.ceil(allFilePaths.length / POOL_SIZE));
  const chunks = [];
  for (let i = 0; i < allFilePaths.length; i += chunkSize) {
    chunks.push(allFilePaths.slice(i, i + chunkSize));
  }

  // Process all chunks in parallel across workers
  // Each chunk result is sent back as a batch for incremental UI update
  let completed = 0;
  const total = allFilePaths.length;
  const allResults = [];

  const chunkPromises = chunks.map(async (chunk) => {
    // Further split large chunks into sub-batches for progress reporting
    const SUB_BATCH = 50;
    for (let j = 0; j < chunk.length; j += SUB_BATCH) {
      const subBatch = chunk.slice(j, j + SUB_BATCH);
      const results = await parseFilesInWorker(subBatch);
      const valid = results.filter((r) => r !== null);
      completed += subBatch.length;

      if (valid.length > 0) {
        // Send batch to renderer for incremental store update
        try {
          event.sender.send('parse-batch', { results: valid, completed, total });
        } catch { /* window might be closed */ }
      } else {
        // Still send progress even if no valid results
        try {
          event.sender.send('parse-batch', { results: [], completed, total });
        } catch { /* ignore */ }
      }
      allResults.push(...valid);
    }
  });

  await Promise.all(chunkPromises);
  return { total: allResults.length };
});

// ── App lifecycle ────────────────────────────────────────────

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
