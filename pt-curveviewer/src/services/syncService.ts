// ============================================================
// Sync Service — Calculate X-offsets for channel alignment
// ============================================================

import type { ImportedFile, SyncMode } from '../types';

/**
 * For a single file, find the master channel (first channel whose yName matches
 * masterYAxis AND whose xName matches activeXAxis).  Return its pointsX array,
 * or null if no match.
 */
function findMasterPoints(file: ImportedFile, masterYAxis: string, activeXAxis: string): Float64Array | null {
  for (const ch of file.curves) {
    if (ch.xName === activeXAxis && (ch.yName === masterYAxis || ch.description === masterYAxis)) {
      return ch.pointsX;
    }
  }
  return null;
}

/**
 * Find the X-value of the first crossing where the master channel reaches
 * (or crosses) the given Y threshold.  Uses linear interpolation between
 * consecutive samples.
 */
function findFirstThresholdCrossing(
  pointsX: Float64Array,
  pointsY: Float64Array,
  threshold: number,
): number | null {
  const len = pointsX.length;
  if (len === 0) return null;

  // Exact hit on first point
  if (pointsY[0] === threshold) return pointsX[0];

  for (let i = 1; i < len; i++) {
    const y0 = pointsY[i - 1];
    const y1 = pointsY[i];

    // Exact hit
    if (y1 === threshold) return pointsX[i];

    // Crossing: sign change relative to threshold
    if ((y0 < threshold && y1 > threshold) || (y0 > threshold && y1 < threshold)) {
      // Linear interpolation to find the exact crossing X
      const ratio = (threshold - y0) / (y1 - y0);
      return pointsX[i - 1] + ratio * (pointsX[i] - pointsX[i - 1]);
    }
  }

  return null; // No crossing found
}

export interface SyncCalcResult {
  offsets: Record<string, number>; // fileId → offset
  errors: string[];                // per-file error messages
}

/**
 * Progress callback: (current, total, message) — called after each file
 */
export type SyncProgressCallback = (current: number, total: number, message: string) => void;

/**
 * Calculate X-offsets for all given files.
 *
 * - `xmin`:  offset = −min(masterChannel.pointsX)
 * - `xmax`:  offset = −max(masterChannel.pointsX)
 * - `ythreshold`:  offset = −xAtFirstCrossing(master, threshold)
 *
 * Returns an object mapping fileId → offset.
 * The function is async only to yield the event loop between files (for progress).
 */
export async function calculateSyncOffsets(
  files: ImportedFile[],
  mode: SyncMode,
  masterYAxis: string,
  activeXAxis: string,
  threshold: number,
  onProgress?: SyncProgressCallback,
): Promise<SyncCalcResult> {
  const offsets: Record<string, number> = {};
  const errors: string[] = [];
  const total = files.length;

  for (let i = 0; i < total; i++) {
    const file = files[i];
    onProgress?.(i, total, `Calculating offset for ${file.header.idString || file.filename}…`);

    const masterX = findMasterPoints(file, masterYAxis, activeXAxis);
    if (!masterX || masterX.length === 0) {
      errors.push(`${file.header.idString || file.filename}: No master channel found for Y-axis "${masterYAxis}"`);
      offsets[file.id] = 0;
      // Yield to event loop
      await new Promise((r) => setTimeout(r, 0));
      continue;
    }

    let offset = 0;

    if (mode === 'xmin') {
      let min = Infinity;
      for (let j = 0; j < masterX.length; j++) {
        if (masterX[j] < min) min = masterX[j];
      }
      offset = -min;
    } else if (mode === 'xmax') {
      let max = -Infinity;
      for (let j = 0; j < masterX.length; j++) {
        if (masterX[j] > max) max = masterX[j];
      }
      offset = -max;
    } else if (mode === 'ythreshold') {
      // Need pointsY of the same master channel
      const masterCh = file.curves.find(
        (ch) => ch.xName === activeXAxis && (ch.yName === masterYAxis || ch.description === masterYAxis),
      );
      if (!masterCh) {
        errors.push(`${file.header.idString || file.filename}: Master channel not found`);
        offsets[file.id] = 0;
        await new Promise((r) => setTimeout(r, 0));
        continue;
      }
      const crossingX = findFirstThresholdCrossing(masterCh.pointsX, masterCh.pointsY, threshold);
      if (crossingX === null) {
        errors.push(`${file.header.idString || file.filename}: Y-threshold ${threshold} not crossed`);
        offsets[file.id] = 0;
      } else {
        offset = -crossingX;
      }
    }

    offsets[file.id] = offset;

    // Yield to event loop between files for UI responsiveness
    await new Promise((r) => setTimeout(r, 0));
  }

  onProgress?.(total, total, 'Done');
  return { offsets, errors };
}

/**
 * Get the list of Y-axis names (descriptions) that exist across ALL given files
 * on the specified X-axis.  Used for Y-threshold master channel selection.
 */
export function getCommonYAxes(files: ImportedFile[], activeXAxis: string): string[] {
  if (files.length === 0) return [];

  // For each file, collect the set of yName values on the active X axis
  const perFile = files.map((f) => {
    const set = new Set<string>();
    for (const ch of f.curves) {
      if (ch.xName === activeXAxis) {
        set.add(ch.yName || ch.description);
      }
    }
    return set;
  });

  // Intersect all sets
  const first = perFile[0];
  const common: string[] = [];
  for (const yName of first) {
    if (perFile.every((s) => s.has(yName))) {
      common.push(yName);
    }
  }
  return common;
}

/**
 * Get all unique Y-axis names from the provided files on the active X axis.
 * Used for Xmin/Xmax master channel selection (any axis is fine).
 */
export function getAllYAxes(files: ImportedFile[], activeXAxis: string): string[] {
  const set = new Set<string>();
  for (const f of files) {
    for (const ch of f.curves) {
      if (ch.xName === activeXAxis) {
        set.add(ch.yName || ch.description);
      }
    }
  }
  return Array.from(set);
}
