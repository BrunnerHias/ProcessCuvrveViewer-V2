// ============================================================
// SyncPanel — Toolbar section for X-Sync channel alignment
// ============================================================

import React, { useMemo, useCallback, useState } from 'react';
import { useFileStore } from '../../stores/fileStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { calculateSyncOffsets, getCommonYAxes, getAllYAxes } from '../../services/syncService';
import type { SyncMode } from '../../types';
import './SyncPanel.css';

const MODE_LABELS: Record<SyncMode, string> = {
  off: 'Off',
  xmin: 'Sync to Xmin',
  xmax: 'Sync to Xmax',
  ythreshold: 'Sync to Y-Threshold',
};

const MODE_DESCRIPTIONS: Record<SyncMode, string> = {
  off: 'No synchronization — channels displayed at original X positions.',
  xmin: 'Shifts all channels so the master channel\'s minimum X value becomes X = 0. Ideal for aligning start points across files.',
  xmax: 'Shifts all channels so the master channel\'s maximum X value becomes X = 0. Useful for aligning end points across files.',
  ythreshold: 'Shifts all channels so the X position where the master channel first crosses a defined Y threshold becomes X = 0. Only Y-channels present in all displayed files are selectable as master.',
};

export const SyncPanel: React.FC<{ activeXAxis: string }> = ({ activeXAxis }) => {
  const files = useFileStore((s) => s.files);

  const syncMode = useSettingsStore((s) => s.syncMode);
  const syncMasterYAxis = useSettingsStore((s) => s.syncMasterYAxis);
  const syncThreshold = useSettingsStore((s) => s.syncThreshold);
  const syncIsCalculating = useSettingsStore((s) => s.syncIsCalculating);
  const syncOffsets = useSettingsStore((s) => s.syncOffsets);
  const syncErrors = useSettingsStore((s) => s.syncErrors);

  const [progress, setProgress] = useState<{ current: number; total: number; message: string } | null>(null);

  // Available Y axes depend on mode
  const availableYAxes = useMemo(() => {
    if (syncMode === 'ythreshold') {
      return getCommonYAxes(files, activeXAxis);
    }
    return getAllYAxes(files, activeXAxis);
  }, [files, activeXAxis, syncMode]);

  // Auto-select first available master axis
  const effectiveMaster = syncMasterYAxis && availableYAxes.includes(syncMasterYAxis)
    ? syncMasterYAxis
    : availableYAxes[0] || '';

  const hasOffsets = Object.keys(syncOffsets).length > 0;

  const handleModeChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const mode = e.target.value as SyncMode;
    useSettingsStore.getState().setSyncMode(mode);
    if (mode === 'off') {
      useSettingsStore.getState().resetSync();
    }
  }, []);

  const handleMasterChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    useSettingsStore.getState().setSyncMasterYAxis(e.target.value);
  }, []);

  const handleThresholdChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    if (!isNaN(val)) {
      useSettingsStore.getState().setSyncThreshold(val);
    }
  }, []);

  const handleApply = useCallback(async () => {
    const store = useSettingsStore.getState();
    const mode = store.syncMode;
    if (mode === 'off') return;
    if (!effectiveMaster) return;

    store.setSyncCalculating(true);
    setProgress({ current: 0, total: files.length, message: 'Starting…' });

    try {
      const result = await calculateSyncOffsets(
        files,
        mode,
        effectiveMaster,
        activeXAxis,
        store.syncThreshold,
        (current, total, message) => setProgress({ current, total, message }),
      );
      useSettingsStore.getState().applySyncOffsets(result.offsets, result.errors);
      // Persist the master axis used
      useSettingsStore.getState().setSyncMasterYAxis(effectiveMaster);
    } catch (err) {
      useSettingsStore.getState().applySyncOffsets({}, [`Calculation failed: ${err}`]);
    } finally {
      setProgress(null);
    }
  }, [files, activeXAxis, effectiveMaster]);

  const handleReset = useCallback(() => {
    useSettingsStore.getState().resetSync();
  }, []);

  if (files.length === 0) return null;

  return (
    <div className="toolbar-section sync-panel">
      <span className="toolbar-section-label">X-Sync</span>
      <div className="toolbar-group sync-panel-row">
        {/* Mode select */}
        <select
          className="x-axis-select sync-select"
          value={syncMode}
          onChange={handleModeChange}
          title={MODE_DESCRIPTIONS[syncMode]}
        >
          {(Object.keys(MODE_LABELS) as SyncMode[]).map((m) => (
            <option key={m} value={m} title={MODE_DESCRIPTIONS[m]}>
              {MODE_LABELS[m]}
            </option>
          ))}
        </select>

        {/* Master channel select (only when mode != off) */}
        {syncMode !== 'off' && (
          <select
            className="x-axis-select sync-select"
            value={effectiveMaster}
            onChange={handleMasterChange}
            title="Master channel (Y-axis) used for offset calculation"
          >
            {availableYAxes.length === 0 && <option value="">— no common channels —</option>}
            {availableYAxes.map((ax) => (
              <option key={ax} value={ax}>{ax}</option>
            ))}
          </select>
        )}

        {/* Threshold input (only for ythreshold mode) */}
        {syncMode === 'ythreshold' && (
          <input
            type="number"
            className="sync-threshold-input"
            value={syncThreshold}
            onChange={handleThresholdChange}
            placeholder="Y threshold"
            title="Y value at which the master channel crossing determines X = 0"
            step="any"
          />
        )}

        {/* Apply / Reset buttons */}
        {syncMode !== 'off' && (
          <>
            <button
              className="toolbar-btn sync-apply-btn"
              onClick={handleApply}
              disabled={syncIsCalculating || availableYAxes.length === 0}
              title="Calculate and apply X-offsets for all files"
            >
              {syncIsCalculating ? '⏳' : '▶'} Apply
            </button>
            {hasOffsets && (
              <button
                className="toolbar-btn sync-reset-btn"
                onClick={handleReset}
                title="Reset all offsets and return to original X positions"
              >
                ↺ Reset
              </button>
            )}
          </>
        )}
      </div>

      {/* Progress indicator */}
      {progress && progress.total > 0 && (
        <div className="sync-progress">
          <div className="sync-progress-bar">
            <div
              className="sync-progress-fill"
              style={{ width: `${Math.round((progress.current / progress.total) * 100)}%` }}
            />
          </div>
          <span className="sync-progress-text">{progress.message}</span>
        </div>
      )}

      {/* Mode description hint */}
      {syncMode !== 'off' && (
        <div className="sync-mode-hint">
          {MODE_DESCRIPTIONS[syncMode]}
        </div>
      )}

      {/* Errors */}
      {syncErrors.length > 0 && (
        <div className="sync-errors">
          {syncErrors.map((err, i) => (
            <div key={i} className="sync-error-item">⚠ {err}</div>
          ))}
        </div>
      )}
    </div>
  );
};
