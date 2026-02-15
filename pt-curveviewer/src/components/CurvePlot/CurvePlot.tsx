// ============================================================
// CurvePlot - High-performance multi-axis chart using ECharts
// ============================================================

import React, { useEffect, useMemo, useRef, useCallback, useState } from 'react';
import * as echarts from 'echarts';
import { useFileStore } from '../../stores/fileStore';
import { useGroupStore } from '../../stores/groupStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { intColorToHex, intColorToRgba, lineStyleToDash, lineStyleToBorderType } from '../../utils/colorConverter';
import { aggregateAxisRanges, getUniqueXAxes, getUniqueYAxes } from '../../utils/axisAggregator';
import { PlotLegend } from './PlotLegend';
import { SyncPanel } from './SyncPanel';
import { useThemeColors } from '../../utils/useThemeColors';
import type { CurveChannel, ChannelVisibility, SnapYStrategy } from '../../types';
import './CurvePlot.css';

type ZoomMode = 'off' | 'rect' | 'band';

const MOUSEMOVE_THROTTLE_MS = 50; // Throttle mouse tracking (ms)

// Cap devicePixelRatio at 2 to avoid excessive GPU load on 4K+ displays
const CAPPED_DPR = Math.min(window.devicePixelRatio || 1, 2);

/**
 * Find all Y values where the curve crosses a given X position.
 * Walks every segment (pointsX[i]→pointsX[i+1]) and interpolates Y
 * whenever the target X lies between two consecutive X values.
 * Returns the interpolated Y values (empty array if none found).
 */
function findAllCurveYAtX(
  pointsX: Float64Array,
  pointsY: Float64Array,
  noOfPoints: number,
  targetX: number,
): number[] {
  const yValues: number[] = [];
  for (let i = 0; i < noOfPoints - 1; i++) {
    const x0 = pointsX[i];
    const x1 = pointsX[i + 1];
    // Check if targetX lies within [x0, x1] or [x1, x0]
    if ((x0 <= targetX && targetX <= x1) || (x1 <= targetX && targetX <= x0)) {
      const dx = x1 - x0;
      if (Math.abs(dx) < 1e-15) {
        // Vertical segment — both Y values are valid crossings
        yValues.push(pointsY[i], pointsY[i + 1]);
      } else {
        const t = (targetX - x0) / dx;
        const y = pointsY[i] + t * (pointsY[i + 1] - pointsY[i]);
        yValues.push(y);
      }
    }
  }
  return yValues;
}

/**
 * Pick a single Y value from a set of crossing Y values using the given strategy.
 * Falls back to the nearest-point binary search if no crossings are found.
 */
function pickSnapY(
  pointsX: Float64Array,
  pointsY: Float64Array,
  noOfPoints: number,
  targetX: number,
  strategy: SnapYStrategy,
): { y: number; nearestIdx: number } {
  const crossings = findAllCurveYAtX(pointsX, pointsY, noOfPoints, targetX);
  // Also find nearest index for cursor X positioning
  let lo = 0, hi = noOfPoints - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (pointsX[mid] < targetX) lo = mid + 1; else hi = mid; }
  if (lo > 0 && lo < noOfPoints && Math.abs(pointsX[lo - 1] - targetX) < Math.abs(pointsX[lo] - targetX)) lo--;

  if (crossings.length === 0) {
    // No crossing found — fall back to nearest data point  
    return { y: pointsY[lo], nearestIdx: lo };
  }
  const y = strategy === 'ymax' ? Math.max(...crossings) : Math.min(...crossings);
  return { y, nearestIdx: lo };
}

export const CurvePlot: React.FC = () => {
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstance = useRef<echarts.ECharts | null>(null);
  const zoomTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resizeRafRef = useRef<number | null>(null);
  const lastMoveTime = useRef(0);

  const files = useFileStore((s) => s.files);
  const groups = useGroupStore((s) => s.groups);
  const plotSettings = useSettingsStore((s) => s.plotSettings);
  const setActiveXAxis = useSettingsStore((s) => s.setActiveXAxis);
  const channelVisibility = useSettingsStore((s) => s.plotSettings.channelVisibility);
  const colorOverrides = useSettingsStore((s) => s.plotSettings.colorOverrides);
  const cursors = useSettingsStore((s) => s.plotSettings.cursors);
  const activeTab = useSettingsStore((s) => s.activeTab);
  const syncOffsets = useSettingsStore((s) => s.syncOffsets);
  const treeSelection = useSettingsStore((s) => s.treeSelection);

  const [showDataPanel, setShowDataPanel] = useState(false);
  const [mouseData, setMouseData] = useState<{ x: number; values: { name: string; y: number; color: string }[] } | null>(null);
  const [tooltipInfo, setTooltipInfo] = useState<{ x: number; y: number; html: string } | null>(null);
  const cursorDragging = useRef(false);
  const cursorDragThrottle = useRef(0);
  const [zoomMode, setZoomMode] = useState<ZoomMode>('off');
  const [dragRect, setDragRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const plotContainerRef = useRef<HTMLDivElement>(null);
  // Custom snap dropdown state
  const [snapDropdownOpen, setSnapDropdownOpen] = useState<string | null>(null);
  const snapDropdownRef = useRef<HTMLDivElement>(null);

  const themeColors = useThemeColors();

  // Clear transient overlay state when navigating away from the plot tab
  useEffect(() => {
    if (activeTab !== 'plot') {
      setMouseData(null);
      setTooltipInfo(null);
      setDragRect(null);
      dragStart.current = null;
      // Hide ECharts built-in tooltip (appended to document.body)
      if (chartInstance.current) {
        chartInstance.current.dispatchAction({ type: 'hideTip' });
      }
    }
  }, [activeTab]);

  // Close snap dropdown on outside click
  useEffect(() => {
    if (!snapDropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (snapDropdownRef.current && !snapDropdownRef.current.contains(e.target as Node)) {
        setSnapDropdownOpen(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [snapDropdownOpen]);

  // Collect all relevant channels (with group context)
  // Only channels that belong to an active group OR are selected via tree-view checkbox
  const allChannels = useMemo(() => {
    const channelList: { channel: CurveChannel; file: typeof files[0]; groupId: string }[] = [];
    const seenKeys = new Set<string>();

    // Add grouped channels (only from active groups)
    for (const group of groups) {
      if (!group.isActive) continue;
      for (const ref of group.channels) {
        const file = files.find((f) => f.id === ref.fileId);
        const channel = file?.curves.find((c) => c.id === ref.channelId);
        if (file && channel) {
          const key = `${group.id}-${ref.fileId}-${ref.channelId}`;
          if (!seenKeys.has(key)) {
            seenKeys.add(key);
            channelList.push({ channel, file, groupId: group.id });
          }
        }
      }
    }

    // Add tree-view selected channels (those checked via checkbox but not already in a group)
    if (treeSelection.size > 0) {
      for (const selKey of treeSelection) {
        const [fileId, channelId] = selKey.split('::');
        const ungroupedKey = `ungrouped-${fileId}-${channelId}`;
        if (seenKeys.has(ungroupedKey)) continue;
        const file = files.find((f) => f.id === fileId);
        const channel = file?.curves.find((c) => c.id === channelId);
        if (file && channel) {
          seenKeys.add(ungroupedKey);
          channelList.push({ channel, file, groupId: 'ungrouped' });
        }
      }
    }

    return channelList;
  }, [files, groups, treeSelection]);

  // Available X axes — derive from ALL loaded files, not just active groups
  const availableXAxes = useMemo(() => {
    const allCurves = files.flatMap((f) => f.curves);
    return getUniqueXAxes(allCurves);
  }, [files]);

  // Auto-select first X axis if none selected
  useEffect(() => {
    if (availableXAxes.length > 0 && !plotSettings.activeXAxis) {
      setActiveXAxis(availableXAxes[0]);
    }
  }, [availableXAxes, plotSettings.activeXAxis, setActiveXAxis]);

  const activeXAxis = plotSettings.activeXAxis || availableXAxes[0] || '';

  // Filter channels by active X axis
  const visibleChannels = useMemo(() => {
    return allChannels.filter((c) => c.channel.xName === activeXAxis);
  }, [allChannels, activeXAxis]);

  // Per-instance visibility lookup (O(1) via Map instead of O(n) linear scan)
  const visibilityMap = useMemo(() => {
    const map = new Map<string, ChannelVisibility>();
    for (const cv of channelVisibility) {
      map.set(`${cv.groupId}|${cv.fileId}|${cv.channelId}`, cv);
    }
    return map;
  }, [channelVisibility]);

  // Apply per-instance visibility filtering
  const filteredChannels = useMemo(() => {
    return visibleChannels.filter(({ channel, file, groupId }) => {
      const cv = visibilityMap.get(`${groupId}|${file.id}|${channel.id}`);
      return cv ? cv.visible : true;
    });
  }, [visibleChannels, visibilityMap]);

  // Per-instance visibility lookup helper
  const getInstanceVisibility = useCallback(
    (groupId: string, fileId: string, channelId: string): ChannelVisibility | null => {
      return visibilityMap.get(`${groupId}|${fileId}|${channelId}`) || null;
    },
    [visibilityMap]
  );

  // Channel summary: group by description
  const channelSummary = useMemo(() => {
    const descMap = new Map<string, { description: string; color: string; count: number; allVisible: boolean }>();
    for (const { channel, file, groupId } of visibleChannels) {
      const desc = channel.description || channel.yName;
      const cv = getInstanceVisibility(groupId, file.id, channel.id);
      const isVisible = cv ? cv.visible : true;

      if (descMap.has(desc)) {
        const existing = descMap.get(desc)!;
        existing.count++;
        if (!isVisible) existing.allVisible = false;
      } else {
        descMap.set(desc, {
          description: desc,
          color: colorOverrides[channel.id] || intColorToHex(channel.lineColor),
          count: 1,
          allVisible: isVisible,
        });
      }
    }
    return Array.from(descMap.values());
  }, [visibleChannels, getInstanceVisibility, colorOverrides]);

  // Toggle all channels with a given description
  const toggleDescription = useCallback(
    (description: string) => {
      const store = useSettingsStore.getState();
      const matching = visibleChannels.filter(
        (c) => (c.channel.description || c.channel.yName) === description
      );
      // Determine new state: if all visible → hide all, else show all
      const allVisible = matching.every(({ channel, file, groupId }) => {
        const cv = store.plotSettings.channelVisibility.find(
          (c) => c.groupId === groupId && c.fileId === file.id && c.channelId === channel.id
        );
        return cv ? cv.visible : true;
      });
      const newVisible = !allVisible;
      for (const { channel, file, groupId } of matching) {
        store.setChannelVisible(groupId, file.id, channel.id, newVisible);
      }
    },
    [visibleChannels]
  );

  // Y axis grouping (by description/yName)
  const yAxisGroups = useMemo(() => {
    return getUniqueYAxes(filteredChannels.map((c) => c.channel));
  }, [filteredChannels]);

  /**
   * Determine how many decimals ECharts uses for its auto-generated "nice" ticks,
   * then format ALL labels (including the raw min/max bounds from XML) consistently.
   */
  const makeAxisLabelFormatter = useCallback((rangeMin: number, rangeMax: number) => {
    // ECharts typically generates ~5 nice ticks between min and max.
    // Compute the nice step size and derive decimal places from it.
    const span = Math.abs(rangeMax - rangeMin);
    if (span === 0) return (v: number | string) => String(v);
    const rawStep = span / 5;
    const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
    const niceStep = rawStep / mag >= 5 ? 5 * mag : rawStep / mag >= 2 ? 2 * mag : mag;
    // Decimal places from the nice step
    const decimals = niceStep >= 1 ? 0 : Math.max(0, Math.ceil(-Math.log10(niceStep) + 1e-9));
    return (v: number | string) => {
      const n = typeof v === 'string' ? parseFloat(v) : v;
      return isNaN(n) ? String(v) : n.toFixed(decimals);
    };
  }, []);

  // Build ECharts option
  const chartOption = useMemo(() => {
    if (filteredChannels.length === 0) return null;

    // Aggregate ranges for shared axes
    const channelsByYAxis = new Map<string, CurveChannel[]>();
    for (const { channel } of filteredChannels) {
      const key = channel.yName || channel.description;
      if (!channelsByYAxis.has(key)) channelsByYAxis.set(key, []);
      channelsByYAxis.get(key)!.push(channel);
    }

    // Count axes per side for margin calculation
    const leftCount = yAxisGroups.filter((_, i) => i % 2 === 0).length;
    const rightCount = yAxisGroups.filter((_, i) => i % 2 !== 0).length;
    const axisSpacing = 55; // px between stacked axes on the same side

    // Build Y axes — color-coded to match their representative channel
    const yAxes = yAxisGroups.map((yName, idx) => {
      const channels = channelsByYAxis.get(yName) || [];
      const range = aggregateAxisRanges(channels);
      const unit = channels[0]?.yUnit || '';
      const axisColor = channels[0] ? intColorToHex(channels[0].lineColor) : themeColors.chartAxisLine;
      const side = idx % 2 === 0 ? 'left' : 'right';
      const stackIdx = Math.floor(idx / 2);

      return {
        type: 'value' as const,
        name: `${yName}${unit ? ` [${unit}]` : ''}`,
        nameLocation: 'middle' as const,
        nameGap: 38 + stackIdx * 6,
        nameRotate: side === 'left' ? 90 : -90,
        position: side as 'left' | 'right',
        offset: stackIdx * axisSpacing,
        min: range.minY,
        max: range.maxY,
        axisLabel: {
          fontSize: 10,
          margin: 6,
          color: axisColor,
          fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
          formatter: makeAxisLabelFormatter(range.minY, range.maxY),
        },
        nameTextStyle: {
          fontSize: 10,
          color: axisColor,
          fontWeight: 600 as const,
          fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
        },
        splitLine: {
          show: idx === 0,
          lineStyle: {
            color: themeColors.chartGridLine,
            type: [4, 4] as [number, number],
            width: 1,
          },
        },
        axisTick: {
          show: true,
          length: 4,
          lineStyle: { color: axisColor },
        },
        axisLine: {
          show: true,
          lineStyle: { color: axisColor, width: 1 },
        },
      };
    });

    // X axis range — adjust for sync offsets
    const allVisibleChannels = filteredChannels.map((c) => c.channel);
    const baseXRange = aggregateAxisRanges(allVisibleChannels);
    const xUnit = allVisibleChannels[0]?.xUnit || '';

    // Compute effective X range considering per-file offsets
    let xRange = baseXRange;
    const hasSyncOffsets = Object.keys(syncOffsets).length > 0;
    if (hasSyncOffsets) {
      let minX = Infinity;
      let maxX = -Infinity;
      for (const { channel, file } of filteredChannels) {
        const off = syncOffsets[file.id] || 0;
        minX = Math.min(minX, channel.coordSystem.minX + off);
        maxX = Math.max(maxX, channel.coordSystem.maxX + off);
      }
      if (minX !== Infinity) {
        xRange = { ...baseXRange, minX, maxX };
      }
    }

    // Build series
    const series = filteredChannels.map(({ channel, file, groupId }) => {
      const yAxisIndex = yAxisGroups.indexOf(channel.yName || channel.description);
      const fileOffset = syncOffsets[file.id] || 0;

      // Pass ALL raw data points — ECharts handles render-level downsampling
      // via sampling: 'lttb' which is zoom-aware (preserves full detail on zoom-in)
      const len = channel.noOfPoints;
      const data: [number, number][] = new Array(len);
      for (let i = 0; i < len; i++) {
        data[i] = [channel.pointsX[i] + fileOffset, channel.pointsY[i]];
      }

      const color = colorOverrides[channel.id] || intColorToHex(channel.lineColor);
      const seriesName = `${file.header.idString || file.filename} - ${channel.description || channel.yName}`;

      // Get per-instance element visibility
      const cv = getInstanceVisibility(groupId, file.id, channel.id);
      const elemLines = cv ? cv.visibleElements.lines : true;
      const elemWindows = cv ? cv.visibleElements.windows : true;
      const hiddenEG = new Set(cv?.hiddenElementGroups || []);

      // Mark lines from graphic elements
      const markLineData: Array<Record<string, unknown>> = [];
      const markAreaData: Array<Record<string, unknown>[]> = [];

      if (plotSettings.visibility.allElements) {
        // Lines
        if (plotSettings.visibility.lines && elemLines) {
          for (let lgIdx = 0; lgIdx < channel.graphicElements.lineGroups.length; lgIdx++) {
            if (hiddenEG.has(`lines-${lgIdx}`)) continue;
            const lg = channel.graphicElements.lineGroups[lgIdx];
            const lineColor = intColorToHex(lg.color);
            for (let lineIdx = 0; lineIdx < lg.lines.length; lineIdx++) {
              if (hiddenEG.has(`lines-${lgIdx}-${lineIdx}`)) continue;
              const line = lg.lines[lineIdx];
              // ECharts markLine requires nested pairs: [[start, end], ...]
              const lineName = lg.description + (line.description ? ' – ' + line.description : '');
              markLineData.push([
                {
                  name: lineName,
                  label: {
                    show: false,
                  },
                  emphasis: {
                    label: {
                      show: true,
                      formatter: lineName,
                      fontSize: 10,
                      padding: [2, 6],
                      backgroundColor: themeColors.chartEmphasisBg,
                      borderColor: lineColor,
                      borderWidth: 1,
                      borderRadius: 3,
                      color: themeColors.chartEmphasisText,
                    },
                    lineStyle: { width: (lg.thickness || 1) + 1 },
                  },
                  lineStyle: { color: lineColor, width: lg.thickness, type: lineStyleToDash(lg.style) },
                  coord: [line.startX + fileOffset, line.startY],
                },
                {
                  coord: [line.endX + fileOffset, line.endY],
                },
              ] as unknown as Record<string, unknown>);
            }
          }
        }

        // Windows (as mark areas)
        if (plotSettings.visibility.windows && elemWindows) {
          for (let wgIdx = 0; wgIdx < channel.graphicElements.windowGroups.length; wgIdx++) {
            if (hiddenEG.has(`windows-${wgIdx}`)) continue;
            const wg = channel.graphicElements.windowGroups[wgIdx];
            const winColor = intColorToRgba(wg.color, 0.15);
            const borderColor = intColorToHex(wg.color);
            for (let winIdx = 0; winIdx < wg.windows.length; winIdx++) {
              if (hiddenEG.has(`windows-${wgIdx}-${winIdx}`)) continue;
              const win = wg.windows[winIdx];
              const winName = wg.description + (win.description ? ' – ' + win.description : '');
              markAreaData.push([
                {
                  name: winName,
                  xAxis: Math.min(win.point1X, win.point2X) + fileOffset,
                  yAxis: Math.min(win.point1Y, win.point2Y),
                  itemStyle: {
                    color: winColor,
                    borderColor: borderColor,
                    borderWidth: wg.thickness,
                    borderType: lineStyleToBorderType(wg.style),
                  },
                  label: {
                    show: false,
                  },
                  emphasis: {
                    label: {
                      show: true,
                      formatter: winName,
                      fontSize: 10,
                      position: 'insideTop',
                      padding: [2, 6],
                      backgroundColor: themeColors.chartEmphasisBg,
                      borderColor: borderColor,
                      borderWidth: 1,
                      borderRadius: 3,
                      color: themeColors.chartEmphasisText,
                    },
                    itemStyle: {
                      color: intColorToRgba(wg.color, 0.3),
                      borderWidth: (wg.thickness || 1) + 1,
                    },
                  },
                },
                {
                  xAxis: Math.max(win.point1X, win.point2X) + fileOffset,
                  yAxis: Math.max(win.point1Y, win.point2Y),
                },
              ]);
            }
          }
        }
      }

      const showPts = channel.arePointsVisible && plotSettings.visibility.showPoints;

      const seriesConfig: Record<string, unknown> = {
        name: seriesName,
        type: 'line',
        yAxisIndex,
        data,
        // symbol: 'none' completely skips symbol creation (symbolSize: 0 still allocates them)
        symbol: showPts ? 'circle' : 'none',
        showSymbol: showPts,
        symbolSize: 3,
        sampling: 'lttb',  // ECharts-native zoom-aware LTTB — no data quality loss on zoom
        clip: true,         // Don't render points outside the grid area
        emphasis: {
          disabled: false,
          lineStyle: { width: (channel.lineThickness || 1) + 1 },
        },
        lineStyle: {
          color,
          width: channel.lineThickness,
          type: lineStyleToDash(channel.lineStyle),
        },
        itemStyle: { color },
        large: true,
        largeThreshold: 2000,
        progressive: 2000,          // 5× more points per frame → faster initial render
        progressiveThreshold: 3000,
        animation: false,
      };

      if (markLineData.length > 0) {
        seriesConfig.markLine = {
          symbol: 'none',
          data: markLineData,
          animation: false,
          tooltip: {
            show: true,
            formatter: (params: { name?: string }) => params.name || '',
          },
        };
      }

      if (markAreaData.length > 0) {
        seriesConfig.markArea = {
          data: markAreaData,
          animation: false,
          tooltip: {
            show: true,
            formatter: (params: { name?: string }) => params.name || '',
          },
        };
      }

      return seriesConfig;
    });

    // Circles as graphic elements (with tooltip metadata)
    const graphicElements: Record<string, unknown>[] = [];
    if (plotSettings.visibility.allElements && plotSettings.visibility.circles) {
      for (const { channel, file, groupId } of filteredChannels) {
        const cv = getInstanceVisibility(groupId, file.id, channel.id);
        const elemCircles = cv ? cv.visibleElements.circles : true;
        if (!elemCircles) continue;

        const circleFileOffset = syncOffsets[file.id] || 0;
        const circleYAxisIndex = yAxisGroups.indexOf(channel.yName || channel.description);
        const hiddenCircleEG = new Set(cv?.hiddenElementGroups || []);
        for (let cgIdx = 0; cgIdx < channel.graphicElements.circleGroups.length; cgIdx++) {
          if (hiddenCircleEG.has(`circles-${cgIdx}`)) continue;
          const cg = channel.graphicElements.circleGroups[cgIdx];
          const circleColor = intColorToHex(cg.color);
          for (let circleIdx = 0; circleIdx < cg.circles.length; circleIdx++) {
            if (hiddenCircleEG.has(`circles-${cgIdx}-${circleIdx}`)) continue;
            const circle = cg.circles[circleIdx];
            graphicElements.push({
              type: 'circle',
              position: [0, 0],
              shape: { r: circle.radius },
              style: {
                stroke: circleColor,
                lineWidth: cg.thickness,
                fill: cg.isFilled ? intColorToRgba(cg.color, 0.3) : 'transparent',
              },
              z: 100,
              // Store data for position conversion + tooltip
              $data: {
                cx: circle.centerX + circleFileOffset,
                cy: circle.centerY,
                yAxisIndex: Math.max(0, circleYAxisIndex),
                description: circle.description || cg.description || '',
                groupDescription: cg.description || '',
              },
            });
          }
        }
      }
    }

    // Cursor lines as graphic elements
    // Each cursor is a group with: invisible wide hit-area + visible thick line + horizontal ticks
    const preChart = chartInstance.current;
    const preChartH = (preChart && !preChart.isDisposed?.()) ? preChart.getHeight() : 0;
    for (const cursor of cursors) {
      let px = 0;
      if (preChart && !preChart.isDisposed?.()) {
        try {
          const converted = preChart.convertToPixel({ xAxisIndex: 0 }, cursor.xPosition);
          if (converted !== undefined && converted !== null) px = converted as unknown as number;
        } catch { /* coordinate system may not be ready yet */ }
      }

      // Build children for the cursor group
      const children: Record<string, unknown>[] = [
        // Invisible wide hit-area rectangle (20px wide) for easy grabbing
        {
          type: 'rect',
          shape: { x: -10, y: 0, width: 20, height: preChartH },
          style: { fill: 'transparent' },
          cursor: 'ew-resize',
          z2: 1,
        },
        // Visible thick cursor line
        {
          type: 'line',
          shape: { x1: 0, y1: 0, x2: 0, y2: preChartH },
          style: {
            stroke: cursor.color,
            lineWidth: 2.5,
            opacity: 0.85,
          },
          z2: 2,
        },
      ];

      // Horizontal crosshair ticks at each channel intersection (using interpolation)
      for (const { channel, file } of filteredChannels) {
        const chOff = syncOffsets[file.id] || 0;
        const rawX = cursor.xPosition - chOff;
        const ch = channel;
        if (ch.noOfPoints < 2) continue;
        const snap = pickSnapY(ch.pointsX, ch.pointsY, ch.noOfPoints, rawX, cursor.snapYStrategy || 'ymax');
        const yAxisIdx = yAxisGroups.indexOf(ch.yName || ch.description);
        const chColor = colorOverrides[ch.id] || intColorToHex(ch.lineColor);
        const yVal = snap.y;
        children.push({
          type: 'line',
          $cursorTick: true,
          $data: {
            cx: cursor.xPosition,
            cy: yVal,
            yAxisIndex: Math.max(0, yAxisIdx),
          },
          // shape will be set by updateGraphicPositions (y relative to group)
          shape: { x1: -12, y1: 0, x2: 12, y2: 0 },
          style: {
            stroke: chColor,
            lineWidth: 2,
          },
          z2: 3,
        });
        // Small dot at intersection
        children.push({
          type: 'circle',
          $cursorTick: true,
          $data: {
            cx: cursor.xPosition,
            cy: yVal,
            yAxisIndex: Math.max(0, yAxisIdx),
          },
          shape: { r: 3.5 },
          position: [0, 0], // will be set by updateGraphicPositions
          style: {
            fill: chColor,
            stroke: '#fff',
            lineWidth: 1.5,
          },
          z2: 4,
        });
      }

      graphicElements.push({
        type: 'group',
        $cursor: true,
        $cursorId: cursor.id,
        position: [px, 0],
        z: 200,
        $data: { xPosition: cursor.xPosition, color: cursor.color },
        draggable: 'horizontal' as const,
        cursor: 'ew-resize',
        ondragstart: function () {
          cursorDragging.current = true;
          const chart = chartInstance.current;
          if (chart && !chart.isDisposed?.()) {
            chart.dispatchAction({ type: 'hideTip' });
          }
        },
        ondrag: function (this: { position: number[] }) {
          const now = performance.now();
          if (now - cursorDragThrottle.current < 33) return;
          cursorDragThrottle.current = now;
          const chart = chartInstance.current;
          if (!chart || chart.isDisposed?.()) return;
          try {
            let dataX = chart.convertFromPixel({ xAxisIndex: 0 }, this.position[0]);
            if (dataX !== undefined && dataX !== null) {
              dataX = Number(dataX);
              // In snap mode – cursor stays at the free X position,
              // the snap dot will show the Y on the selected channel.
              // No X-snapping needed; the cursor X follows the mouse freely.
              useSettingsStore.getState().updateCursorPosition(cursor.id, dataX);
            }
          } catch { /* ignore */ }
        },
        ondragend: function (this: { position: number[] }) {
          const chart = chartInstance.current;
          if (!chart || chart.isDisposed?.()) return;
          try {
            let dataX = chart.convertFromPixel({ xAxisIndex: 0 }, this.position[0]);
            if (dataX !== undefined && dataX !== null) {
              dataX = Number(dataX);
              useSettingsStore.getState().updateCursorPosition(cursor.id, dataX);
            }
          } catch { /* ignore */ }
          cursorDragging.current = false;
          requestAnimationFrame(() => {
            if (updatePosRef.current) updatePosRef.current();
          });
        },
        children,
      });

      // Determine the Y value for the horizontal crosshair line
      // In snap mode: use the snapped channel's interpolated Y
      // In free mode: use the first visible channel's interpolated Y
      let crosshairY: number | null = null;
      let crosshairYAxisIndex = 0;
      const isSnapMode = cursor.mode === 'snap' && cursor.snapFileId && cursor.snapChannelId;

      if (isSnapMode) {
        const snapEntry = filteredChannels.find(
          (fc) => fc.file.id === cursor.snapFileId && fc.channel.id === cursor.snapChannelId
        );
        if (snapEntry) {
          const snapOff = syncOffsets[snapEntry.file.id] || 0;
          const rawX = cursor.xPosition - snapOff;
          const ch = snapEntry.channel;
          const strategy = cursor.snapYStrategy || 'ymax';
          const snap = pickSnapY(ch.pointsX, ch.pointsY, ch.noOfPoints, rawX, strategy);
          const snapYAxisIdx = yAxisGroups.indexOf(ch.yName || ch.description);
          crosshairY = snap.y;
          crosshairYAxisIndex = Math.max(0, snapYAxisIdx);

          // Snap dot: show a circle on the snapped channel at the cursor's X position
          const snapColor = colorOverrides[ch.id] || intColorToHex(ch.lineColor);
          graphicElements.push({
            type: 'circle',
            $cursorSnap: true,
            $cursorId: cursor.id,
            position: [0, 0], // will be set by updateGraphicPositions
            shape: { r: 5 },
            style: {
              fill: snapColor,
              stroke: '#fff',
              lineWidth: 2,
            },
            z: 210,
            $data: {
              cx: cursor.xPosition,
              cy: snap.y,
              yAxisIndex: Math.max(0, snapYAxisIdx),
            },
          });
        }
      } else if (filteredChannels.length > 0) {
        // Free mode: pick the first channel's Y for the horizontal crosshair
        const firstCh = filteredChannels[0];
        const fOff = syncOffsets[firstCh.file.id] || 0;
        const rawX = cursor.xPosition - fOff;
        if (firstCh.channel.noOfPoints >= 2) {
          const snap = pickSnapY(firstCh.channel.pointsX, firstCh.channel.pointsY, firstCh.channel.noOfPoints, rawX, 'ymax');
          crosshairY = snap.y;
          crosshairYAxisIndex = Math.max(0, yAxisGroups.indexOf(firstCh.channel.yName || firstCh.channel.description));
        }
      }

      // Full-width horizontal crosshair line (always shown when Y is available)
      if (crosshairY !== null) {
        const chartW = preChart ? preChart.getWidth() : 0;
        graphicElements.push({
          type: 'line',
          $cursorHLine: true,
          $cursorId: cursor.id,
          position: [0, 0],
          shape: { x1: 0, y1: 0, x2: chartW, y2: 0 },
          style: {
            stroke: cursor.color,
            lineWidth: 1.5,
            opacity: 0.7,
            lineDash: [6, 4],
          },
          z: 205,
          $data: {
            cx: cursor.xPosition,
            cy: crosshairY,
            yAxisIndex: crosshairYAxisIndex,
          },
        });
      }
    }

    return {
      animation: false,
      tooltip: {
        trigger: 'axis',
        showDelay: 50,
        transitionDuration: 0,
        enterable: false,
        axisPointer: {
          type: 'line',
          lineStyle: {
            color: themeColors.chartCrosshair,
            width: 1,
            type: 'dashed',
          },
          label: {
            backgroundColor: themeColors.chartTooltipBg,
            borderColor: themeColors.chartTooltipBorder,
            borderWidth: 1,
            color: themeColors.chartAxisLabel,
            fontSize: 10,
            padding: [4, 8],
            borderRadius: 4,
            fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
          },
        },
        formatter: (params: unknown) => {
          if (cursorDragging.current) return '';
          if (!Array.isArray(params)) return '';
          const arr = params as Array<{ seriesName: string; data: [number, number]; color: string; marker: string }>;
          if (arr.length === 0) return '';
          let html = `<div style="font-family:Inter,system-ui,-apple-system,sans-serif;font-size:11px;line-height:1.6">`;
          html += `<div style="font-weight:600;margin-bottom:4px;opacity:0.7;font-size:10px">${activeXAxis}: ${arr[0].data[0]}</div>`;
          for (const p of arr) {
            html += `<div style="display:flex;align-items:center;gap:6px">`;
            html += `${p.marker}`;
            html += `<span style="flex:1;opacity:0.8">${p.seriesName}</span>`;
            html += `<span style="font-weight:600;font-variant-numeric:tabular-nums">${p.data[1]}</span>`;
            html += `</div>`;
          }
          html += `</div>`;
          return html;
        },
        backgroundColor: themeColors.chartTooltipBg,
        borderColor: themeColors.chartTooltipBorder,
        borderWidth: 1,
        borderRadius: 8,
        padding: [10, 14],
        textStyle: {
          color: themeColors.chartTooltipText,
          fontSize: 11,
          fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
        },
        extraCssText: `backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);box-shadow:0 8px 32px ${themeColors.chartTooltipShadow};`,
        confine: true,
      },
      legend: { show: false },
      grid: {
        left: 45 + Math.max(0, leftCount - 1) * axisSpacing,
        right: 45 + Math.max(0, rightCount - 1) * axisSpacing,
        top: 20,
        bottom: 28,
        containLabel: false,
      },
      xAxis: {
        type: 'value',
        name: `${activeXAxis}${xUnit ? ` [${xUnit}]` : ''}`,
        nameLocation: 'middle',
        nameGap: 22,
        min: xRange.minX,
        max: xRange.maxX,
        axisLabel: {
          fontSize: 10,
          color: themeColors.chartAxisLabel,
          fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
          formatter: makeAxisLabelFormatter(xRange.minX, xRange.maxX),
        },
        nameTextStyle: {
          fontSize: 10,
          color: themeColors.chartAxisName,
          fontWeight: 500,
          fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
        },
        splitLine: {
          show: true,
          lineStyle: {
            color: themeColors.chartGridLine,
            type: [4, 4] as [number, number],
            width: 1,
          },
        },
        axisTick: {
          show: true,
          length: 4,
          lineStyle: { color: themeColors.chartAxisTick },
        },
        axisLine: {
          show: true,
          lineStyle: { color: themeColors.chartAxisLine, width: 1 },
        },
      },
      yAxis: yAxes,
      dataZoom: [
        {
          type: 'inside',
          xAxisIndex: 0,
          filterMode: 'none',
        },
        {
          type: 'inside',
          yAxisIndex: Array.from({ length: yAxes.length }, (_, i) => i),
          filterMode: 'none',
        },
      ],
      series,
      graphic: graphicElements.length > 0 ? graphicElements : undefined,
    };
  }, [filteredChannels, yAxisGroups, activeXAxis, plotSettings.visibility, cursors, getInstanceVisibility, themeColors, colorOverrides, syncOffsets]);

  // Position circles + cursors using convertToPixel after chart renders.
  // This must be called AFTER setOption has completed so coordinate systems exist.
  const updateGraphicPositions = useCallback(() => {
    const chart = chartInstance.current;
    if (!chart || chart.isDisposed?.()) return;
    if (!chartOption?.graphic) return;

    const graphics = chartOption.graphic as Array<Record<string, unknown>>;
    const chartHeight = chart.getHeight();

    const updatedGraphics = graphics.map((g) => {
      // Handle cursor groups (vertical line + crosshair ticks)
      if (g.$cursor) {
        const data = g.$data as { xPosition: number } | undefined;
        if (!data) return g;
        try {
          const px = chart.convertToPixel({ xAxisIndex: 0 }, data.xPosition);
          if (px !== undefined) {
            // Update position of the group
            const updated: Record<string, unknown> = { ...g, position: [px, 0] };

            // Update children: resize hit-area and line to current chart height,
            // and position crosshair ticks at the correct Y pixels
            const children = (g.children as Array<Record<string, unknown>>);
            if (children) {
              updated.children = children.map((child: Record<string, unknown>) => {
                // Hit-area rect
                if (child.type === 'rect') {
                  return { ...child, shape: { x: -10, y: 0, width: 20, height: chartHeight } };
                }
                // Vertical cursor line
                if (child.type === 'line' && !child.$cursorTick) {
                  return { ...child, shape: { x1: 0, y1: 0, x2: 0, y2: chartHeight } };
                }
                // Crosshair tick lines + dots — position at Y pixel
                if (child.$cursorTick) {
                  const td = child.$data as { cx: number; cy: number; yAxisIndex?: number } | undefined;
                  if (!td) return child;
                  try {
                    const pixel = chart.convertToPixel(
                      { xAxisIndex: 0, yAxisIndex: td.yAxisIndex ?? 0 },
                      [td.cx, td.cy]
                    );
                    if (pixel) {
                      const yPx = pixel[1]; // Y pixel relative to canvas
                      if (child.type === 'circle') {
                        return { ...child, position: [0, yPx] };
                      }
                      // Horizontal tick line
                      return { ...child, shape: { x1: -12, y1: yPx, x2: 12, y2: yPx } };
                    }
                  } catch { /* ignore */ }
                }
                return child;
              });
            }
            return updated;
          }
        } catch { /* ignore */ }
        return g;
      }

      // Handle snap dots on cursors
      if (g.$cursorSnap) {
        const snapData = g.$data as { cx: number; cy: number; yAxisIndex?: number } | undefined;
        if (!snapData) return g;
        try {
          const pixel = chart.convertToPixel(
            { xAxisIndex: 0, yAxisIndex: snapData.yAxisIndex ?? 0 },
            [snapData.cx, snapData.cy]
          );
          if (pixel) return { ...g, position: pixel };
        } catch { /* ignore */ }
        return g;
      }

      // Handle horizontal crosshair line at snap Y
      if (g.$cursorHLine) {
        const hData = g.$data as { cx: number; cy: number; yAxisIndex?: number } | undefined;
        if (!hData) return g;
        try {
          const pixel = chart.convertToPixel(
            { xAxisIndex: 0, yAxisIndex: hData.yAxisIndex ?? 0 },
            [hData.cx, hData.cy]
          );
          if (pixel) {
            const yPx = pixel[1];
            const cw = chart.getWidth();
            return { ...g, position: [0, 0], shape: { x1: 0, y1: yPx, x2: cw, y2: yPx } };
          }
        } catch { /* ignore */ }
        return g;
      }

      // Handle circles
      const data = g.$data as { cx: number; cy: number; yAxisIndex?: number; description: string; groupDescription: string } | undefined;
      if (!data) return g;

      try {
        const pixel = chart.convertToPixel({ xAxisIndex: 0, yAxisIndex: data.yAxisIndex ?? 0 }, [data.cx, data.cy]);
        if (pixel) {
          const tooltipHtml = data.groupDescription
            ? (data.groupDescription + (data.description && data.description !== data.groupDescription ? ' – ' + data.description : ''))
            : data.description;
          return {
            ...g,
            position: pixel,
            // Add mouse events for circle tooltips
            onmouseover: () => {
              if (tooltipHtml) {
                const [px, py] = pixel;
                setTooltipInfo({ x: px, y: py, html: tooltipHtml });
              }
            },
            onmouseout: () => {
              setTooltipInfo(null);
            },
          };
        }
      } catch {
        // Ignore conversion errors
      }
      return g;
    });

    // Use merge mode (not replaceMerge) to safely update only the graphic elements
    chart.setOption({ graphic: updatedGraphics });
  }, [chartOption]);

  // Handle mouse position data panel
  const handleMouseMove = useCallback(
    (params: { event?: { offsetX?: number } }) => {
      if (!showDataPanel || !chartInstance.current) return;

      // Throttle: skip if called too frequently
      const now = performance.now();
      if (now - lastMoveTime.current < MOUSEMOVE_THROTTLE_MS) return;
      lastMoveTime.current = now;

      const chart = chartInstance.current;
      const offsetX = params.event?.offsetX;
      if (offsetX === undefined) return;

      try {
        const dataPoint = chart.convertFromPixel({ xAxisIndex: 0 }, offsetX);
        if (dataPoint === undefined || dataPoint === null) return;

        const xVal = typeof dataPoint === 'number' ? dataPoint : Number(dataPoint);
        const values: { name: string; y: number; color: string }[] = [];

        for (const { channel, file } of filteredChannels) {
          const fileOff = syncOffsets[file.id] || 0;
          // Subtract file sync offset to convert chart-space xVal back to raw data space
          const rawXVal = xVal - fileOff;
          // Binary search for closest x
          let lo = 0;
          let hi = channel.noOfPoints - 1;
          while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (channel.pointsX[mid] < rawXVal) lo = mid + 1;
            else hi = mid;
          }
          if (lo > 0 && lo < channel.noOfPoints) {
            const prev = Math.abs(channel.pointsX[lo - 1] - rawXVal);
            const curr = Math.abs(channel.pointsX[lo] - rawXVal);
            if (prev < curr) lo--;
          }

          if (lo >= 0 && lo < channel.noOfPoints) {
            values.push({
              name: `${file.header.idString || file.filename} - ${channel.description || channel.yName}`,
              y: channel.pointsY[lo],
              color: colorOverrides[channel.id] || intColorToHex(channel.lineColor),
            });
          }
        }

        setMouseData({ x: xVal, values });
      } catch {
        // ignore
      }
    },
    [showDataPanel, filteredChannels, colorOverrides, syncOffsets]
  );

  // Zoom history: capture dataZoom events + reposition graphic elements
  const handleDataZoom = useCallback(() => {
    const chart = chartInstance.current;
    if (!chart) return;

    // Immediately reposition graphic elements (circles, cursors)
    requestAnimationFrame(() => {
      if (!chart.isDisposed?.()) updatePosRef.current();
    });

    // Debounce zoom history captures
    if (zoomTimerRef.current) clearTimeout(zoomTimerRef.current);
    zoomTimerRef.current = setTimeout(() => {
      const option = chart.getOption() as Record<string, unknown>;
      const dataZoomArr = option.dataZoom as Array<{ start?: number; end?: number }> | undefined;
      if (dataZoomArr && dataZoomArr[0]) {
        const { start = 0, end = 100 } = dataZoomArr[0];
        useSettingsStore.getState().pushZoom({ xStart: start, xEnd: end });
      }
    }, 300);
  }, []);

  // Legend highlight/downplay – uses opacity fading via setOption
  // instead of ECharts focus:'series' which breaks multi-series highlight
  const handleHighlight = useCallback((seriesNames: string[]) => {
    const chart = chartInstance.current;
    if (!chart || chart.isDisposed?.()) return;
    // Reset any previous emphasis states
    chart.dispatchAction({ type: 'downplay' });
    const option = chart.getOption() as any;
    const allSeries = (option.series || []) as any[];
    // Fade non-target series and highlight targets
    chart.setOption({
      series: allSeries.map((s: any) => {
        const hit = seriesNames.includes(s.name);
        return {
          lineStyle: { opacity: hit ? 1 : 0.08 },
          itemStyle: { opacity: hit ? 1 : 0.08 },
        };
      }),
    });
    // Apply emphasis styling (thicker line) on target series
    if (seriesNames.length > 0) {
      chart.dispatchAction({
        type: 'highlight',
        batch: seriesNames.map((name) => ({ seriesName: name })),
      });
    }
  }, []);

  const handleDownplay = useCallback(() => {
    const chart = chartInstance.current;
    if (!chart || chart.isDisposed?.()) return;
    // Remove emphasis from all series
    chart.dispatchAction({ type: 'downplay' });
    // Restore full opacity on all series
    const option = chart.getOption() as any;
    const allSeries = (option.series || []) as any[];
    chart.setOption({
      series: allSeries.map(() => ({
        lineStyle: { opacity: 1 },
        itemStyle: { opacity: 1 },
      })),
    });
  }, []);

  // Zoom undo/redo/reset handlers
  const handleZoomUndo = useCallback(() => {
    const level = useSettingsStore.getState().undoZoom();
    if (level && chartInstance.current) {
      chartInstance.current.dispatchAction({
        type: 'dataZoom',
        dataZoomIndex: 0,
        start: level.xStart,
        end: level.xEnd,
      });
    }
  }, []);

  const handleZoomReset = useCallback(() => {
    useSettingsStore.getState().resetZoom();
    const chart = chartInstance.current;
    if (chart && !chart.isDisposed?.()) {
      // Reset X-axis dataZoom
      chart.dispatchAction({ type: 'dataZoom', dataZoomIndex: 0, start: 0, end: 100 });
      // Reset all Y-axis dataZooms (index 1 covers all Y axes)
      chart.dispatchAction({ type: 'dataZoom', dataZoomIndex: 1, start: 0, end: 100 });
    }
  }, []);

  // PDF Export
  const handleExportPDF = useCallback(async () => {
    const chart = chartInstance.current;
    if (!chart) return;

    try {
      const dataURL = chart.getDataURL({
        type: 'png',
        pixelRatio: 2,
        backgroundColor: themeColors.bgChart,
      });

      // Dynamic import jsPDF to avoid bundle bloat
      const { jsPDF } = await import('jspdf');
      const pdf = new jsPDF({
        orientation: 'landscape',
        unit: 'px',
        format: [chart.getWidth(), chart.getHeight()],
      });

      pdf.addImage(dataURL, 'PNG', 0, 0, chart.getWidth(), chart.getHeight());
      pdf.save('CurvePlot-Export.pdf');
    } catch (err) {
      console.error('PDF export failed:', err);
      alert('PDF export failed. Make sure jspdf is installed: npm install jspdf');
    }
  }, []);

  // Cursor: add cursor
  const handleAddCursor = useCallback(() => {
    useSettingsStore.getState().addCursor();
  }, []);

  // ── Drag-zoom handlers (rect + band) ──────────────────────────────
  const handleZoomMouseDown = useCallback((e: React.MouseEvent) => {
    if (zoomMode === 'off') return;
    const container = plotContainerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    dragStart.current = { x, y };
    setDragRect({ x, y, w: 0, h: 0 });
    e.preventDefault();
  }, [zoomMode]);

  const handleZoomMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragStart.current || zoomMode === 'off') return;
    const container = plotContainerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const sx = dragStart.current.x;
    const sy = dragStart.current.y;

    if (zoomMode === 'rect') {
      setDragRect({
        x: Math.min(sx, x),
        y: Math.min(sy, y),
        w: Math.abs(x - sx),
        h: Math.abs(y - sy),
      });
    } else {
      // band: full height
      setDragRect({
        x: Math.min(sx, x),
        y: 0,
        w: Math.abs(x - sx),
        h: rect.height,
      });
    }
  }, [zoomMode]);

  const handleZoomMouseUp = useCallback(() => {
    if (!dragStart.current || zoomMode === 'off' || !dragRect) {
      dragStart.current = null;
      setDragRect(null);
      return;
    }

    const chart = chartInstance.current;
    if (!chart || chart.isDisposed?.()) {
      dragStart.current = null;
      setDragRect(null);
      return;
    }

    // Minimum drag size to trigger zoom
    if (dragRect.w < 5) {
      dragStart.current = null;
      setDragRect(null);
      return;
    }

    try {
      // ── X-Axis zoom (both rect and band mode) ──
      // convertFromPixel with grid index returns [dataX, dataY]
      const coordMin = chart.convertFromPixel('grid', [dragRect.x, dragRect.y]);
      const coordMax = chart.convertFromPixel('grid', [dragRect.x + dragRect.w, dragRect.y + dragRect.h]);

      if (!coordMin || !coordMax) {
        dragStart.current = null;
        setDragRect(null);
        return;
      }

      const xMinVal = coordMin[0];
      const xMaxVal = coordMax[0];

      if (isFinite(xMinVal) && isFinite(xMaxVal)) {
        const opt = chart.getOption() as { xAxis?: Array<{ min?: number; max?: number }> };
        const xAxis = opt.xAxis?.[0];
        if (xAxis && xAxis.min !== undefined && xAxis.max !== undefined) {
          const total = xAxis.max - xAxis.min;
          if (total > 0) {
            const start = Math.max(0, ((Math.min(xMinVal, xMaxVal) - xAxis.min) / total) * 100);
            const end = Math.min(100, ((Math.max(xMinVal, xMaxVal) - xAxis.min) / total) * 100);
            chart.dispatchAction({ type: 'dataZoom', dataZoomIndex: 0, start, end });
          }
        }
      }

      // ── Y-Axis zoom (rect mode only) ──
      // Convert the top / bottom pixel rows of the drag rectangle
      // into data coordinates for EACH Y axis independently and
      // zoom via per-axis dataZoom percentages.
      if (zoomMode === 'rect' && dragRect.h > 10) {
        const yAxesOption = (chart.getOption() as { yAxis?: Array<{ min?: number; max?: number }> }).yAxis;
        if (yAxesOption && yAxesOption.length > 0) {
          // Convert the pixel y-top and y-bottom for each y axis individually
          const topPx  = dragRect.y;
          const botPx  = dragRect.y + dragRect.h;

          // Compute uniform percentage range across all Y axes
          // We use axis 0 as reference because all inside-dataZoom axes share
          // one start/end percentage. Compute per-axis then pick the
          // widest range so no axis is clipped.
          let bestStart = 100;
          let bestEnd   = 0;

          for (let ai = 0; ai < yAxesOption.length; ai++) {
            const yOpt = yAxesOption[ai];
            if (yOpt.min === undefined || yOpt.max === undefined) continue;
            const yTotal = yOpt.max - yOpt.min;
            if (yTotal <= 0) continue;

            try {
              const topCoord = chart.convertFromPixel({ yAxisIndex: ai }, topPx);
              const botCoord = chart.convertFromPixel({ yAxisIndex: ai }, botPx);
              if (!isFinite(topCoord) || !isFinite(botCoord)) continue;
              const yMin = Math.min(topCoord, botCoord);
              const yMax = Math.max(topCoord, botCoord);
              const s = Math.max(0,   ((yMin - yOpt.min) / yTotal) * 100);
              const e = Math.min(100, ((yMax - yOpt.min) / yTotal) * 100);
              bestStart = Math.min(bestStart, s);
              bestEnd   = Math.max(bestEnd,   e);
            } catch { /* axis may not support pixel conversion */ }
          }

          if (bestEnd > bestStart) {
            chart.dispatchAction({
              type: 'dataZoom',
              dataZoomIndex: 1,
              start: bestStart,
              end: bestEnd,
            });
          }
        }
      }
    } catch { /* ignore conversion errors */ }

    dragStart.current = null;
    setDragRect(null);
  }, [zoomMode, dragRect]);

  // ── Stable refs for event handlers (avoids re-registering on every change) ──
  const mouseMoveRef = useRef(handleMouseMove);
  mouseMoveRef.current = handleMouseMove;
  const dataZoomRef = useRef(handleDataZoom);
  dataZoomRef.current = handleDataZoom;
  const updatePosRef = useRef(updateGraphicPositions);
  updatePosRef.current = updateGraphicPositions;

  // Chart initialisation — runs once when the container <div> mounts
  const hasChannels = allChannels.length > 0;
  useEffect(() => {
    if (!hasChannels || !chartRef.current) return;

    const chart = echarts.init(chartRef.current, undefined, {
      renderer: 'canvas',
      useDirtyRect: true,
      devicePixelRatio: CAPPED_DPR, // Cap at 2× to avoid 4K+ GPU overhead
    });
    chartInstance.current = chart;

    // Stable event wrappers — always call latest handler via ref
    const onMouseMove = (p: unknown) =>
      mouseMoveRef.current(p as { event?: { offsetX?: number } });
    const onDataZoom = () => dataZoomRef.current();
    chart.getZr().on('mousemove', onMouseMove);
    chart.on('dataZoom', onDataZoom);

    return () => {
      chart.getZr().off('mousemove', onMouseMove);
      chart.off('dataZoom', onDataZoom);
      chart.dispose();
      chartInstance.current = null;
    };
  }, [hasChannels]);

  // Option update — pushes new options into the existing instance (NO dispose!)
  useEffect(() => {
    const chart = chartInstance.current;
    if (!chart || chart.isDisposed?.() || !chartOption) return;

    // Fully disable tooltip before replacing series to prevent "getRawIndex" /
    // "scale" errors caused by the axis pointer iterating over stale
    // series references during the replaceMerge transition.
    chart.dispatchAction({ type: 'hideTip' });
    chart.setOption({ tooltip: { show: false } });

    chart.setOption(chartOption, {
      replaceMerge: ['series', 'graphic'],
      lazyUpdate: true,
    });

    // Re-enable tooltip after the new series are in place
    chart.setOption({ tooltip: { show: true } });

    requestAnimationFrame(() => {
      if (!chart.isDisposed?.()) updateGraphicPositions();
    });
  }, [chartOption, updateGraphicPositions]);

  // Resize handler — debounced via rAF to coalesce rapid resize events
  useEffect(() => {
    if (!chartRef.current) return;
    const el = chartRef.current;

    const doResize = () => {
      const chart = chartInstance.current;
      if (!chart || chart.isDisposed?.()) return;
      chart.resize();
      requestAnimationFrame(() => {
        if (!chart.isDisposed?.()) updatePosRef.current();
      });
    };

    // Debounce: coalesce multiple resize events into one rAF callback
    const handleResize = () => {
      if (resizeRafRef.current) cancelAnimationFrame(resizeRafRef.current);
      resizeRafRef.current = requestAnimationFrame(doResize);
    };

    window.addEventListener('resize', handleResize);
    const observer = new ResizeObserver(handleResize);
    observer.observe(el);

    return () => {
      window.removeEventListener('resize', handleResize);
      observer.disconnect();
      if (resizeRafRef.current) cancelAnimationFrame(resizeRafRef.current);
    };
  }, [hasChannels]);

  // Cleanup timers on unmount (chart disposal is handled by init effect)
  useEffect(() => {
    return () => {
      if (zoomTimerRef.current) clearTimeout(zoomTimerRef.current);
      if (resizeRafRef.current) cancelAnimationFrame(resizeRafRef.current);
    };
  }, []);

  return (
    <div className="curve-plot">
      {/* Toolbar — categorised with visible section dividers */}
      <div className="plot-toolbar">
        {/* ─── Axes ─── */}
        <div className="toolbar-section">
          <span className="toolbar-section-label">Achse</span>
          <div className="toolbar-group">
            <select
              className="x-axis-select"
              value={activeXAxis}
              onChange={(e) => setActiveXAxis(e.target.value)}
            >
              {availableXAxes.map((ax) => (
                <option key={ax} value={ax}>
                  {ax}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="toolbar-divider" />

        {/* ─── X-Sync ─── */}
        <SyncPanel activeXAxis={activeXAxis} />

        <div className="toolbar-divider" />

        {/* ─── Visibility ─── */}
        <div className="toolbar-section">
          <span className="toolbar-section-label">Sichtbarkeit</span>
          <div className="toolbar-group">
            <label className="toggle-label">
              <input
                type="checkbox"
                checked={plotSettings.visibility.allElements}
                onChange={() => useSettingsStore.getState().toggleAllElements()}
              />
              Elemente
            </label>
            <label className="toggle-label">
              <input
                type="checkbox"
                checked={plotSettings.visibility.lines}
                onChange={() => useSettingsStore.getState().toggleLines()}
              />
              Linien
            </label>
            <label className="toggle-label">
              <input
                type="checkbox"
                checked={plotSettings.visibility.windows}
                onChange={() => useSettingsStore.getState().toggleWindows()}
              />
              Fenster
            </label>
            <label className="toggle-label">
              <input
                type="checkbox"
                checked={plotSettings.visibility.circles}
                onChange={() => useSettingsStore.getState().toggleCircles()}
              />
              Kreise
            </label>
            <label className="toggle-label">
              <input
                type="checkbox"
                checked={plotSettings.visibility.showPoints}
                onChange={() => useSettingsStore.getState().toggleShowPoints()}
              />
              Punkte
            </label>
          </div>
        </div>

        <div className="toolbar-divider" />

        {/* ─── Zoom ─── */}
        <div className="toolbar-section">
          <span className="toolbar-section-label">Zoom</span>
          <div className="toolbar-group">
            <button
              className={`toolbar-btn ${zoomMode === 'rect' ? 'active' : ''}`}
              onClick={() => setZoomMode(zoomMode === 'rect' ? 'off' : 'rect')}
              title="Box Zoom: Rechteck aufziehen (X + Y)"
            >
              ⬒ Box
            </button>
            <button
              className={`toolbar-btn ${zoomMode === 'band' ? 'active' : ''}`}
              onClick={() => setZoomMode(zoomMode === 'band' ? 'off' : 'band')}
              title="Band Zoom: Horizontales Band aufziehen (nur X)"
            >
              ⇔ Band
            </button>
            <button className="toolbar-btn" onClick={handleZoomUndo} title="Letzte Zoomstufe rückgängig">
              ↩
            </button>
            <button className="toolbar-btn" onClick={handleZoomReset} title="Zoom zurücksetzen">
              ↺
            </button>
          </div>
        </div>

        <div className="toolbar-divider" />

        {/* ─── Cursor ─── */}
        <div className="toolbar-section">
          <span className="toolbar-section-label">Cursor</span>
          <div className="toolbar-group">
            <button className="toolbar-btn" onClick={handleAddCursor} title="Cursor hinzufügen">
              + Cursor
            </button>
            {cursors.length > 0 && (
              <button
                className="toolbar-btn"
                onClick={() => useSettingsStore.getState().clearCursors()}
                title="Alle Cursor entfernen"
              >
                ✕ Alle
              </button>
            )}
          </div>
        </div>

        <div className="toolbar-divider" />

        {/* ─── Extras ─── */}
        <div className="toolbar-section">
          <span className="toolbar-section-label">Extras</span>
          <div className="toolbar-group">
            <button
              className={`toolbar-btn ${showDataPanel ? 'active' : ''}`}
              onClick={() => setShowDataPanel(!showDataPanel)}
              title="Daten-Panel ein-/ausblenden"
            >
              📊 Daten
            </button>
            <button className="toolbar-btn" onClick={handleExportPDF} title="Plot als PDF exportieren">
              📄 PDF
            </button>
          </div>
        </div>
      </div>

      {/* Main container: chart + legend sidebar */}
      <div className="plot-main">
        <div className="plot-chart-area">
          {/* Chart container */}
          <div
            className="plot-container"
            ref={plotContainerRef}
            onMouseDown={handleZoomMouseDown}
            onMouseMove={handleZoomMouseMove}
            onMouseUp={handleZoomMouseUp}
            onMouseLeave={() => { dragStart.current = null; setDragRect(null); }}
            style={{ cursor: zoomMode !== 'off' ? 'crosshair' : 'crosshair' }}
          >
            {allChannels.length === 0 ? (
              <div className="plot-empty">
                Import data and select channels in the Data Portal to view plots
              </div>
            ) : (
              <div ref={chartRef} className="chart-canvas" />
            )}

            {/* Zoom drag overlay */}
            {dragRect && dragRect.w > 2 && (
              <div
                className="zoom-drag-rect"
                style={{
                  left: dragRect.x,
                  top: dragRect.y,
                  width: dragRect.w,
                  height: dragRect.h,
                }}
              />
            )}

            {/* Mouse position data panel */}
            {showDataPanel && mouseData && (
              <div className="data-panel">
                <div className="data-panel-header">
                  {activeXAxis}: {mouseData.x.toFixed(3)}
                </div>
                {mouseData.values.map((v, i) => (
                  <div key={i} className="data-panel-row">
                    <span className="data-panel-color" style={{ background: v.color }} />
                    <span className="data-panel-name">{v.name}:</span>
                    <span className="data-panel-value">{v.y.toFixed(4)}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Circle tooltip overlay */}
            {tooltipInfo && (
              <div
                className="circle-tooltip"
                style={{
                  left: tooltipInfo.x + 12,
                  top: tooltipInfo.y - 20,
                }}
                dangerouslySetInnerHTML={{ __html: tooltipInfo.html }}
              />
            )}

            {/* Cursor info panels */}
            {cursors.length > 0 && (
              <div className="cursor-panel">
                {cursors.map((cursor, idx) => {
                  // Find values at cursor position — ALL channels use interpolation
                  const cursorValues: { name: string; y: number; color: string }[] = [];
                  const isSnapped = cursor.mode === 'snap' && cursor.snapFileId && cursor.snapChannelId;
                  // Filter channels: only current snap file or all files
                  const showAll = cursor.showAllFiles !== false; // default true
                  const channelsForCursor = isSnapped && !showAll
                    ? filteredChannels.filter(({ file }) => file.id === cursor.snapFileId)
                    : filteredChannels;

                  for (const { channel, file } of channelsForCursor) {
                    const cOff = syncOffsets[file.id] || 0;
                    const rawCursorX = cursor.xPosition - cOff;
                    if (channel.noOfPoints < 2) continue;
                    const snap = pickSnapY(channel.pointsX, channel.pointsY, channel.noOfPoints, rawCursorX, cursor.snapYStrategy || 'ymax');
                    cursorValues.push({
                      name: `${file.header.idString || file.filename} - ${channel.description || channel.yName}`,
                      y: snap.y,
                      color: colorOverrides[channel.id] || intColorToHex(channel.lineColor),
                    });
                  }

                  // Build option list for snap mode channel selector
                  const snapOptions: { fileId: string; channelId: string; label: string; color: string }[] = [];
                  for (const { channel: ch, file: f } of filteredChannels) {
                    snapOptions.push({
                      fileId: f.id,
                      channelId: ch.id,
                      label: `${f.header.idString || f.filename} – ${ch.description || ch.yName}`,
                      color: colorOverrides[ch.id] || intColorToHex(ch.lineColor),
                    });
                  }
                  const snapKey = cursor.snapFileId && cursor.snapChannelId
                    ? `${cursor.snapFileId}::${cursor.snapChannelId}`
                    : '';
                  const isDropdownOpen = snapDropdownOpen === cursor.id;

                  return (
                    <div key={cursor.id} className="cursor-info" style={{ borderColor: cursor.color }}>
                      <div className="cursor-info-header">
                        <span style={{ color: cursor.color }}>Cursor {idx + 1}</span>
                        <span className="cursor-x">{activeXAxis}: {cursor.xPosition.toFixed(3)}</span>
                        <button
                          className="cursor-remove-btn"
                          onClick={() => useSettingsStore.getState().removeCursor(cursor.id)}
                        >
                          ✕
                        </button>
                      </div>

                      {/* Snap-to-channel selector — fully custom dropdown */}
                      <div className="cursor-snap-row" ref={isDropdownOpen ? snapDropdownRef : undefined}>
                        <div className="cursor-snap-custom-select">
                          <button
                            className="cursor-snap-trigger"
                            onClick={() => setSnapDropdownOpen(isDropdownOpen ? null : cursor.id)}
                            title="Kanal für Cursor-Snap auswählen"
                            style={snapKey ? { borderLeftColor: snapOptions.find(o => `${o.fileId}::${o.channelId}` === snapKey)?.color || 'var(--border)', borderLeftWidth: '3px' } : undefined}
                          >
                            {snapKey ? (
                              <>
                                <span className="snap-option-color" style={{ background: snapOptions.find(o => `${o.fileId}::${o.channelId}` === snapKey)?.color || 'transparent' }} />
                                <span className="snap-option-label">{snapOptions.find(o => `${o.fileId}::${o.channelId}` === snapKey)?.label || ''}</span>
                              </>
                            ) : (
                              <span className="snap-option-label">Frei (kein Snap)</span>
                            )}
                            <span className="snap-dropdown-arrow">{isDropdownOpen ? '▲' : '▼'}</span>
                          </button>
                          {isDropdownOpen && (
                            <div className="snap-dropdown-panel">
                              <button
                                className={`snap-dropdown-option ${!snapKey ? 'selected' : ''}`}
                                onClick={() => {
                                  useSettingsStore.getState().setCursorMode(cursor.id, 'free');
                                  setSnapDropdownOpen(null);
                                }}
                              >
                                <span className="snap-option-color" style={{ background: 'transparent', border: '1px dashed var(--text-dim)' }} />
                                <span className="snap-option-label">Frei (kein Snap)</span>
                              </button>
                              {snapOptions.map((opt) => {
                                const optKey = `${opt.fileId}::${opt.channelId}`;
                                return (
                                  <button
                                    key={optKey}
                                    className={`snap-dropdown-option ${optKey === snapKey ? 'selected' : ''}`}
                                    onClick={() => {
                                      useSettingsStore.getState().setCursorMode(cursor.id, 'snap', opt.fileId, opt.channelId);
                                      setSnapDropdownOpen(null);
                                    }}
                                  >
                                    <span className="snap-option-color" style={{ background: opt.color }} />
                                    <span className="snap-option-label">{opt.label}</span>
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Y max/min strategy selector — only visible in snap mode */}
                      {isSnapped && (
                        <div className="cursor-snap-row cursor-snap-row-inline">
                          <select
                            className="cursor-snap-select"
                            value={cursor.snapYStrategy || 'ymax'}
                            onChange={(e) => {
                              useSettingsStore.getState().setCursorSnapYStrategy(
                                cursor.id,
                                e.target.value as 'ymax' | 'ymin'
                              );
                            }}
                            title="Bei mehreren Y-Schnittpunkten: Y Max oder Y Min verwenden"
                          >
                            <option value="ymax">Y Max</option>
                            <option value="ymin">Y Min</option>
                          </select>
                          <button
                            className={`cursor-filter-btn ${!showAll ? 'active' : ''}`}
                            onClick={() => useSettingsStore.getState().setCursorShowAllFiles(cursor.id, !showAll)}
                            title={showAll ? 'Nur Kanäle der Snap-Datei anzeigen' : 'Alle Dateien anzeigen'}
                          >
                            {showAll ? '📁 Alle' : '📄 Datei'}
                          </button>
                        </div>
                      )}

                      {cursorValues.map((v, i) => (
                        <div key={i} className="cursor-info-row">
                          <span className="data-panel-color" style={{ background: v.color }} />
                          <span className="cursor-info-name">{v.name}:</span>
                          <span className="cursor-info-value">{v.y.toFixed(4)}</span>
                        </div>
                      ))}
                    </div>
                  );
                })}

                {/* Delta between cursor pairs */}
                {cursors.length >= 2 && (
                  <div className="cursor-delta">
                    <div className="cursor-delta-header">Delta (C1-C2)</div>
                    <div className="cursor-delta-row">
                      Δ{activeXAxis}: {Math.abs(cursors[0].xPosition - cursors[1].xPosition).toFixed(4)}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Channel summary chips below chart */}
          {channelSummary.length > 0 && (
            <div className="channel-summary">
              {channelSummary.map((cs) => (
                <button
                  key={cs.description}
                  className={`channel-chip ${!cs.allVisible ? 'inactive' : ''}`}
                  onClick={() => toggleDescription(cs.description)}
                  title={`${cs.description} (${cs.count} channel${cs.count > 1 ? 's' : ''})`}
                >
                  <span className="chip-color" style={{ background: cs.color }} />
                  <span className="chip-label">{cs.description}</span>
                  {cs.count > 1 && <span className="chip-count">{cs.count}</span>}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Legend sidebar (self-collapsible) */}
        <PlotLegend
          onHighlight={handleHighlight}
          onDownplay={handleDownplay}
        />
      </div>
    </div>
  );
};
