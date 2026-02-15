// ============================================================
// Axis Aggregator: Merge min/max across multiple channels
// ============================================================

import type { CurveChannel } from '../types';

export interface AggregatedRange {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/**
 * Aggregates the coordinate system ranges across multiple channels
 * that share the same axes.
 */
export function aggregateAxisRanges(channels: CurveChannel[]): AggregatedRange {
  if (channels.length === 0) {
    return { minX: 0, maxX: 1, minY: 0, maxY: 1 };
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const ch of channels) {
    minX = Math.min(minX, ch.coordSystem.minX);
    maxX = Math.max(maxX, ch.coordSystem.maxX);
    minY = Math.min(minY, ch.coordSystem.minY);
    maxY = Math.max(maxY, ch.coordSystem.maxY);
  }

  return { minX, maxX, minY, maxY };
}

/**
 * Collects all unique X axis names from a set of channels.
 */
export function getUniqueXAxes(channels: CurveChannel[]): string[] {
  const set = new Set<string>();
  for (const ch of channels) {
    if (ch.xName) set.add(ch.xName);
  }
  return Array.from(set);
}

/**
 * Collects all unique Y axis descriptions from a set of channels.
 * Used to group channels on the same Y axis.
 */
export function getUniqueYAxes(channels: CurveChannel[]): string[] {
  const set = new Set<string>();
  for (const ch of channels) {
    if (ch.yName) set.add(ch.yName);
  }
  return Array.from(set);
}
