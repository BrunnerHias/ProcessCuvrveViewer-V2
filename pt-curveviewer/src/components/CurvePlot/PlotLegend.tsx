// ============================================================
// PlotLegend - Sidebar tree for per-instance channel visibility
// ============================================================

import React, { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import { useFileStore } from '../../stores/fileStore';
import { useGroupStore } from '../../stores/groupStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { intColorToHex } from '../../utils/colorConverter';
import { ColorPicker } from './ColorPicker';
import type { CurveChannel, ImportedFile } from '../../types';
import './PlotLegend.css';

/* Tri-state checkbox: supports indeterminate via ref */
const IndeterminateCheckbox: React.FC<{
  checked: boolean;
  indeterminate: boolean;
  onChange: () => void;
  className?: string;
  title?: string;
}> = ({ checked, indeterminate, onChange, className, title }) => {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    <input
      ref={ref}
      type="checkbox"
      className={className}
      checked={checked}
      onChange={onChange}
      onClick={(e) => e.stopPropagation()}
      title={title}
    />
  );
};

interface LegendElementGroup {
  description: string;
  items: { description: string }[];
}

interface LegendChannelInfo {
  channelId: string;
  description: string;
  yName: string;
  color: string;
  hasLines: boolean;
  hasWindows: boolean;
  hasCircles: boolean;
  lineGroups: LegendElementGroup[];
  windowGroups: LegendElementGroup[];
  circleGroups: LegendElementGroup[];
}

interface LegendEntry {
  groupId: string;
  groupName: string;
  files: {
    fileId: string;
    filename: string;
    idString: string;
    channels: LegendChannelInfo[];
  }[];
}

export const PlotLegend: React.FC<{
  onHighlight?: (seriesNames: string[]) => void;
  onDownplay?: () => void;
}> = ({ onHighlight, onDownplay }) => {
  const files = useFileStore((s) => s.files);
  const groups = useGroupStore((s) => s.groups);
  const channelVisibility = useSettingsStore((s) => s.plotSettings.channelVisibility);
  const colorOverrides = useSettingsStore((s) => s.plotSettings.colorOverrides);
  const activeXAxis = useSettingsStore((s) => s.plotSettings.activeXAxis);
  const treeSelection = useSettingsStore((s) => s.treeSelection);
  const setChannelVisible = useSettingsStore((s) => s.setChannelVisible);
  const setChannelElementVisible = useSettingsStore((s) => s.setChannelElementVisible);
  const setChannelColorOverride = useSettingsStore((s) => s.setChannelColorOverride);
  const setGroupColorOverride = useSettingsStore((s) => s.setGroupColorOverride);
  const setMultipleChannelsVisible = useSettingsStore((s) => s.setMultipleChannelsVisible);
  const setElementGroupVisible = useSettingsStore((s) => s.setElementGroupVisible);

  // Use an "expanded" set — nodes start collapsed by default
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  // Sidebar collapsed state
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Color picker state
  const [colorPicker, setColorPicker] = useState<{
    target: 'channel' | 'group';
    channelId?: string;
    groupId?: string;
    groupChannelIds?: string[];
    currentColor: string;
    label: string;
  } | null>(null);
  const colorPickerAnchorRef = useRef<HTMLSpanElement | null>(null);

  const toggleExpand = useCallback((key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  // Build legend tree
  const legendEntries = useMemo(() => {
    const entries: LegendEntry[] = [];

    const buildChannelInfo = (channel: CurveChannel) => ({
      channelId: channel.id,
      description: channel.description || channel.yName,
      yName: channel.yName,
      color: colorOverrides[channel.id] || intColorToHex(channel.lineColor),
      hasLines: channel.graphicElements.lineGroups.length > 0,
      hasWindows: channel.graphicElements.windowGroups.length > 0,
      hasCircles: channel.graphicElements.circleGroups.length > 0,
      lineGroups: channel.graphicElements.lineGroups.map((lg) => ({
        description: lg.description || 'Lines',
        items: lg.lines.map((l) => ({ description: l.description || 'Line' })),
      })),
      windowGroups: channel.graphicElements.windowGroups.map((wg) => ({
        description: wg.description || 'Windows',
        items: wg.windows.map((w) => ({ description: w.description || 'Window' })),
      })),
      circleGroups: channel.graphicElements.circleGroups.map((cg) => ({
        description: cg.description || 'Circles',
        items: cg.circles.map((c) => ({ description: c.description || 'Circle' })),
      })),
    });

    // Active groups
    for (const group of groups) {
      if (!group.isActive) continue;
      const fileMap = new Map<string, { file: ImportedFile; channelIds: string[] }>();

      for (const ref of group.channels) {
        const file = files.find((f) => f.id === ref.fileId);
        if (!file) continue;
        const channel = file.curves.find((c) => c.id === ref.channelId);
        if (!channel || (activeXAxis && channel.xName !== activeXAxis)) continue;

        if (!fileMap.has(ref.fileId)) {
          fileMap.set(ref.fileId, { file, channelIds: [] });
        }
        fileMap.get(ref.fileId)!.channelIds.push(ref.channelId);
      }

      if (fileMap.size === 0) continue;

      const fileEntries = Array.from(fileMap.values()).map(({ file, channelIds }) => ({
        fileId: file.id,
        filename: file.filename,
        idString: file.header.idString || file.filename,
        channels: channelIds
          .map((cid) => file.curves.find((c) => c.id === cid))
          .filter(Boolean)
          .map((ch) => buildChannelInfo(ch!)),
      }));

      entries.push({
        groupId: group.id,
        groupName: group.name,
        files: fileEntries,
      });
    }

    // Ungrouped channels — those selected via tree-view checkbox (even if also in a group)
    if (treeSelection.size > 0) {
      const ungroupedFiles: LegendEntry['files'] = [];
      for (const selKey of treeSelection) {
        const [fileId, channelId] = selKey.split('::');
        const file = files.find((f) => f.id === fileId);
        const channel = file?.curves.find((c) => c.id === channelId);
        if (!file || !channel) continue;
        if (activeXAxis && channel.xName !== activeXAxis) continue;

        let fileEntry = ungroupedFiles.find((f) => f.fileId === fileId);
        if (!fileEntry) {
          fileEntry = {
            fileId: file.id,
            filename: file.filename,
            idString: file.header.idString || file.filename,
            channels: [],
          };
          ungroupedFiles.push(fileEntry);
        }
        fileEntry.channels.push(buildChannelInfo(channel));
      }

      if (ungroupedFiles.length > 0) {
        entries.push({
          groupId: 'ungrouped',
          groupName: 'Ungrouped',
          files: ungroupedFiles,
        });
      }
    }

    return entries;
  }, [files, groups, activeXAxis, colorOverrides, treeSelection]);

  // Helper: get visibility for a channel instance
  const getVisibility = useCallback(
    (groupId: string, fileId: string, channelId: string) => {
      const entry = channelVisibility.find(
        (c) => c.groupId === groupId && c.fileId === fileId && c.channelId === channelId
      );
      return entry || {
        visible: true,
        visibleElements: { lines: true, windows: true, circles: true },
        hiddenElementGroups: [] as string[],
      };
    },
    [channelVisibility]
  );

  // Compute group-level visibility (all / none / mixed)
  const getGroupVisState = useCallback(
    (entry: LegendEntry) => {
      let total = 0;
      let visibleCount = 0;
      for (const f of entry.files) {
        for (const ch of f.channels) {
          total++;
          if (getVisibility(entry.groupId, f.fileId, ch.channelId).visible) visibleCount++;
        }
      }
      return { allVisible: visibleCount === total, noneVisible: visibleCount === 0 };
    },
    [getVisibility]
  );

  // Compute file-level visibility (all / none / mixed)
  const getFileVisState = useCallback(
    (groupId: string, fileEntry: LegendEntry['files'][0]) => {
      let total = 0;
      let visibleCount = 0;
      for (const ch of fileEntry.channels) {
        total++;
        if (getVisibility(groupId, fileEntry.fileId, ch.channelId).visible) visibleCount++;
      }
      return { allVisible: visibleCount === total, noneVisible: visibleCount === 0 };
    },
    [getVisibility]
  );

  // Toggle all channels in a group
  const toggleGroupVisibility = useCallback(
    (entry: LegendEntry) => {
      const { allVisible } = getGroupVisState(entry);
      const newVisible = !allVisible;
      const entries = entry.files.flatMap((f) =>
        f.channels.map((ch) => ({ groupId: entry.groupId, fileId: f.fileId, channelId: ch.channelId }))
      );
      setMultipleChannelsVisible(entries, newVisible);
    },
    [getGroupVisState, setMultipleChannelsVisible]
  );

  // Toggle all channels of a file within a group
  const toggleFileVisibility = useCallback(
    (groupId: string, fileEntry: LegendEntry['files'][0]) => {
      const { allVisible } = getFileVisState(groupId, fileEntry);
      const newVisible = !allVisible;
      const entries = fileEntry.channels.map((ch) => ({
        groupId,
        fileId: fileEntry.fileId,
        channelId: ch.channelId,
      }));
      setMultipleChannelsVisible(entries, newVisible);
    },
    [getFileVisState, setMultipleChannelsVisible]
  );

  // Build series name for highlight (must match CurvePlot naming)
  const getSeriesName = useCallback(
    (fileId: string, channelId: string) => {
      const file = files.find((f) => f.id === fileId);
      const channel = file?.curves.find((c) => c.id === channelId);
      if (!file || !channel) return '';
      return `${file.header.idString || file.filename} - ${channel.description || channel.yName}`;
    },
    [files]
  );

  // Mouse-over handlers
  const handleMouseEnterChannel = useCallback(
    (fileId: string, channelId: string) => {
      const name = getSeriesName(fileId, channelId);
      if (name && onHighlight) onHighlight([name]);
    },
    [getSeriesName, onHighlight]
  );

  const handleMouseEnterFile = useCallback(
    (_groupId: string, fileId: string, channels: { channelId: string }[]) => {
      const names = channels.map((ch) => getSeriesName(fileId, ch.channelId)).filter(Boolean);
      if (names.length > 0 && onHighlight) onHighlight(names);
    },
    [getSeriesName, onHighlight]
  );

  const handleMouseEnterGroup = useCallback(
    (entry: LegendEntry) => {
      const names: string[] = [];
      for (const fileEntry of entry.files) {
        for (const ch of fileEntry.channels) {
          const name = getSeriesName(fileEntry.fileId, ch.channelId);
          if (name) names.push(name);
        }
      }
      if (names.length > 0 && onHighlight) onHighlight(names);
    },
    [getSeriesName, onHighlight]
  );

  const handleMouseLeave = useCallback(() => {
    if (onDownplay) onDownplay();
  }, [onDownplay]);

  if (legendEntries.length === 0) {
    return (
      <div className={`plot-legend-wrapper ${sidebarOpen ? 'open' : 'closed'}`}>
        <button
          className="legend-toggle-btn"
          onClick={() => setSidebarOpen((v) => !v)}
          title={sidebarOpen ? 'Hide legend' : 'Show legend'}
        >
          {sidebarOpen ? '▶' : '◀'}
        </button>
        {sidebarOpen && (
          <div className="plot-legend">
            <div className="legend-header">Legend</div>
            <div className="legend-empty">No data to display</div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={`plot-legend-wrapper ${sidebarOpen ? 'open' : 'closed'}`}>
      <button
        className="legend-toggle-btn"
        onClick={() => setSidebarOpen((v) => !v)}
        title={sidebarOpen ? 'Hide legend' : 'Show legend'}
      >
        {sidebarOpen ? '▶' : '◀'}
      </button>
      {sidebarOpen && (
        <div className="plot-legend">
          <div className="legend-header">Legend</div>
          <div className="legend-tree">
            {legendEntries.map((entry) => {
              const groupKey = `group-${entry.groupId}`;
              const isGroupExpanded = expanded.has(groupKey);
              const groupVis = getGroupVisState(entry);

              return (
                <div key={entry.groupId} className="legend-group">
                  {/* Group Header */}
                  <div
                    className="legend-row legend-group-header"
                    onClick={() => toggleExpand(groupKey)}
                    onMouseEnter={() => handleMouseEnterGroup(entry)}
                    onMouseLeave={handleMouseLeave}
                  >
                    <span className={`collapse-icon ${!isGroupExpanded ? 'collapsed' : ''}`}>▾</span>
                    <IndeterminateCheckbox
                      className="legend-checkbox"
                      checked={groupVis.allVisible}
                      indeterminate={!groupVis.allVisible && !groupVis.noneVisible}
                      onChange={() => toggleGroupVisibility(entry)}
                      title="Toggle all channels in this group"
                    />
                    {entry.groupId !== 'ungrouped' && (
                      <span
                        className="legend-color-swatch legend-color-swatch--clickable"
                        style={{ background: entry.files[0]?.channels[0]?.color || 'var(--text-muted)' }}
                        title="Change group color"
                        ref={(el) => {
                          if (colorPicker?.target === 'group' && colorPicker.groupId === entry.groupId) {
                            colorPickerAnchorRef.current = el;
                          }
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          const allChannelIds = entry.files.flatMap((f) => f.channels.map((c) => c.channelId));
                          setColorPicker({
                            target: 'group',
                            groupId: entry.groupId,
                            groupChannelIds: allChannelIds,
                            currentColor: entry.files[0]?.channels[0]?.color || '#339af0',
                            label: entry.groupName,
                          });
                          colorPickerAnchorRef.current = e.currentTarget as HTMLSpanElement;
                        }}
                      />
                    )}
                    <span className="legend-group-name">{entry.groupName}</span>
                    <span className="legend-count">
                      ({entry.files.reduce((sum, f) => sum + f.channels.length, 0)})
                    </span>
                  </div>

                  {isGroupExpanded &&
                    entry.files.map((fileEntry) => {
                      const fileKey = `file-${entry.groupId}-${fileEntry.fileId}`;
                      const isFileExpanded = expanded.has(fileKey);
                      const fileVis = getFileVisState(entry.groupId, fileEntry);

                      return (
                        <div key={fileEntry.fileId} className="legend-file">
                          {/* File Header */}
                          <div
                            className="legend-row legend-file-header"
                            onClick={() => toggleExpand(fileKey)}
                            onMouseEnter={() =>
                              handleMouseEnterFile(entry.groupId, fileEntry.fileId, fileEntry.channels)
                            }
                            onMouseLeave={handleMouseLeave}
                          >
                            <span className={`collapse-icon ${!isFileExpanded ? 'collapsed' : ''}`}>
                              ▾
                            </span>
                            <IndeterminateCheckbox
                              className="legend-checkbox"
                              checked={fileVis.allVisible}
                              indeterminate={!fileVis.allVisible && !fileVis.noneVisible}
                              onChange={() => toggleFileVisibility(entry.groupId, fileEntry)}
                              title="Toggle all channels in this file"
                            />
                            <span className="legend-file-name" title={fileEntry.filename}>
                              {fileEntry.idString}
                            </span>
                          </div>

                          {isFileExpanded &&
                            fileEntry.channels.map((ch) => {
                              const vis = getVisibility(entry.groupId, fileEntry.fileId, ch.channelId);
                              const chKey = `ch-${entry.groupId}-${fileEntry.fileId}-${ch.channelId}`;
                              const isChExpanded = expanded.has(chKey);

                              return (
                                <div key={ch.channelId} className="legend-channel">
                                  {/* Channel Row */}
                                  <div
                                    className="legend-row legend-channel-row"
                                    onMouseEnter={() =>
                                      handleMouseEnterChannel(fileEntry.fileId, ch.channelId)
                                    }
                                    onMouseLeave={handleMouseLeave}
                                  >
                                    <span
                                      className={`collapse-icon small ${!isChExpanded ? 'collapsed' : ''}`}
                                      style={(ch.hasLines || ch.hasWindows || ch.hasCircles) ? undefined : { visibility: 'hidden' }}
                                      onClick={(ch.hasLines || ch.hasWindows || ch.hasCircles) ? () => toggleExpand(chKey) : undefined}
                                    >
                                      ▾
                                    </span>
                                    <input
                                      type="checkbox"
                                      className="legend-checkbox"
                                      checked={vis.visible}
                                      onChange={() =>
                                        setChannelVisible(
                                          entry.groupId,
                                          fileEntry.fileId,
                                          ch.channelId,
                                          !vis.visible
                                        )
                                      }
                                      onClick={(e) => e.stopPropagation()}
                                    />
                                    <span
                                      className="legend-color-swatch legend-color-swatch--clickable"
                                      style={{ background: ch.color }}
                                      title="Change channel color"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setColorPicker({
                                          target: 'channel',
                                          channelId: ch.channelId,
                                          currentColor: ch.color,
                                          label: ch.description,
                                        });
                                        colorPickerAnchorRef.current = e.currentTarget as HTMLSpanElement;
                                      }}
                                    />
                                    <span
                                      className={`legend-channel-name ${!vis.visible ? 'dimmed' : ''}`}
                                      onClick={(ch.hasLines || ch.hasWindows || ch.hasCircles) ? () => toggleExpand(chKey) : undefined}
                                      title={ch.description}
                                    >
                                      {ch.description}
                                    </span>
                                  </div>

                                  {/* Graphic Elements Sub-tree */}
                                  {isChExpanded && (ch.hasLines || ch.hasWindows || ch.hasCircles) && (() => {
                                    const hiddenSet = new Set(vis.hiddenElementGroups || []);
                                    const channelHidden = !vis.visible;

                                    const renderElementSection = (
                                      type: 'windows' | 'lines' | 'circles',
                                      label: string,
                                      groups: LegendElementGroup[],
                                      typeVisible: boolean,
                                    ) => {
                                      // Check how many sub-groups are hidden
                                      const subHiddenCount = groups.filter((_, i) => hiddenSet.has(`${type}-${i}`)).length;
                                      const allSubHidden = subHiddenCount === groups.length && groups.length > 0;
                                      const someSubHidden = subHiddenCount > 0 && subHiddenCount < groups.length;

                                      return (
                                        <div className="legend-element-group" key={type}>
                                          <div
                                            className={`legend-row legend-element-row ${channelHidden ? 'legend-row--disabled' : ''}`}
                                            onMouseEnter={() => handleMouseEnterChannel(fileEntry.fileId, ch.channelId)}
                                            onMouseLeave={handleMouseLeave}
                                          >
                                            <span className="collapse-icon tiny" style={{ visibility: 'hidden' }}>▾</span>
                                            <IndeterminateCheckbox
                                              className="legend-checkbox"
                                              checked={typeVisible && !allSubHidden}
                                              indeterminate={typeVisible && someSubHidden}
                                              onChange={() =>
                                                setChannelElementVisible(
                                                  entry.groupId,
                                                  fileEntry.fileId,
                                                  ch.channelId,
                                                  type,
                                                  !typeVisible
                                                )
                                              }
                                              title={`Toggle ${label}`}
                                            />
                                            <span className={`legend-element-label ${channelHidden || !typeVisible ? 'dimmed' : ''}`}>{label}</span>
                                          </div>
                                          {groups.map((g, i) => {
                                            const gKey = `${type.substring(0,2)}-${chKey}-${i}`;
                                            const isGExpanded = expanded.has(gKey);
                                            const subVisible = !hiddenSet.has(`${type}-${i}`);
                                            return (
                                              <div key={i} className="legend-subgroup">
                                                <div
                                                  className={`legend-row legend-subelement-row clickable ${channelHidden || !typeVisible ? 'legend-row--disabled' : ''}`}
                                                  onClick={() => toggleExpand(gKey)}
                                                  onMouseEnter={() => handleMouseEnterChannel(fileEntry.fileId, ch.channelId)}
                                                  onMouseLeave={handleMouseLeave}
                                                >
                                                  <span className={`collapse-icon tiny ${!isGExpanded ? 'collapsed' : ''}`}>▾</span>
                                                  <input
                                                    type="checkbox"
                                                    className="legend-checkbox legend-checkbox--small"
                                                    checked={subVisible && typeVisible}
                                                    disabled={!typeVisible}
                                                    onChange={() =>
                                                      setElementGroupVisible(
                                                        entry.groupId,
                                                        fileEntry.fileId,
                                                        ch.channelId,
                                                        `${type}-${i}`,
                                                        !subVisible
                                                      )
                                                    }
                                                    onClick={(e) => e.stopPropagation()}
                                                  />
                                                  <span className={`legend-subelement-name ${!subVisible || !typeVisible || channelHidden ? 'dimmed' : ''}`}>
                                                    {g.description} ({g.items.length})
                                                  </span>
                                                </div>
                                                {isGExpanded && g.items.map((item, j) => {
                                                  const itemKey = `${type}-${i}-${j}`;
                                                  const itemVisible = !hiddenSet.has(itemKey);
                                                  return (
                                                    <div
                                                      key={j}
                                                      className={`legend-row legend-item-row ${channelHidden || !typeVisible || !subVisible ? 'legend-row--disabled' : ''}`}
                                                      onMouseEnter={() => handleMouseEnterChannel(fileEntry.fileId, ch.channelId)}
                                                      onMouseLeave={handleMouseLeave}
                                                    >
                                                      <input
                                                        type="checkbox"
                                                        className="legend-checkbox legend-checkbox--small"
                                                        checked={itemVisible && subVisible && typeVisible}
                                                        disabled={!typeVisible || !subVisible}
                                                        onChange={() =>
                                                          setElementGroupVisible(
                                                            entry.groupId,
                                                            fileEntry.fileId,
                                                            ch.channelId,
                                                            itemKey,
                                                            !itemVisible
                                                          )
                                                        }
                                                        onClick={(e) => e.stopPropagation()}
                                                      />
                                                      <span className={`legend-item-name ${!itemVisible || !subVisible || !typeVisible || channelHidden ? 'dimmed' : ''}`}>{item.description}</span>
                                                    </div>
                                                  );
                                                })}
                                              </div>
                                            );
                                          })}
                                        </div>
                                      );
                                    };

                                    return (
                                      <div className="legend-elements">
                                        {ch.hasWindows && renderElementSection('windows', 'Windows', ch.windowGroups, vis.visibleElements.windows)}
                                        {ch.hasLines && renderElementSection('lines', 'Lines', ch.lineGroups, vis.visibleElements.lines)}
                                        {ch.hasCircles && renderElementSection('circles', 'Circles', ch.circleGroups, vis.visibleElements.circles)}
                                      </div>
                                    );
                                  })()}
                                </div>
                              );
                            })}
                        </div>
                      );
                    })}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Color Picker Popup */}
      {colorPicker && (
        <ColorPicker
          currentColor={colorPicker.currentColor}
          label={colorPicker.label}
          anchorEl={colorPickerAnchorRef.current}
          onColorChange={(color) => {
            if (colorPicker.target === 'channel' && colorPicker.channelId) {
              setChannelColorOverride(colorPicker.channelId, color);
            } else if (colorPicker.target === 'group' && colorPicker.groupId) {
              setGroupColorOverride(
                colorPicker.groupId,
                color,
                colorPicker.groupChannelIds,
              );
            }
            setColorPicker((prev) => prev ? { ...prev, currentColor: color } : null);
          }}
          onClose={() => setColorPicker(null)}
        />
      )}
    </div>
  );
};
