// ============================================================
// ValueDetailModal — Trend chart + Histogram + Correlation
// Click a description cell → see value progression + distribution
// ============================================================

import React, { useEffect, useRef, useMemo, useCallback, useState } from 'react';
import * as echarts from 'echarts';
import { useThemeColors } from '../../utils/useThemeColors';
import type { ImportedFile } from '../../types';
import './ValueDetailModal.css';

interface ValueDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  description: string;
  rowNumber: number;
  type: 'set' | 'actual';
  files: ImportedFile[];
}

// ── Persist bin count across modal re-opens (until app restart) ──
let _persistedBinCount = 10;

// ── Histogram binning ─────────────────────────────────────────
function computeHistogramBins(values: number[], binCount = 10) {
  if (values.length === 0) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) return [{ label: String(min), count: values.length, indices: values.map((_, i) => i) }];
  const binWidth = (max - min) / binCount;
  const bins = Array.from({ length: binCount }, (_, i) => ({
    start: min + i * binWidth,
    end: min + (i + 1) * binWidth,
    count: 0,
    indices: [] as number[],
  }));
  for (let vi = 0; vi < values.length; vi++) {
    const idx = Math.min(Math.floor((values[vi] - min) / binWidth), binCount - 1);
    bins[idx].count++;
    bins[idx].indices.push(vi);
  }
  return bins.map((b) => ({
    label: `${b.start.toPrecision(4)}`,
    count: b.count,
    indices: b.indices,
  }));
}

// ── Stats ─────────────────────────────────────────────────────
function calcStats(values: number[]) {
  if (values.length === 0) return null;
  const n = values.length;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const mean = values.reduce((s, v) => s + v, 0) / n;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
  const stdDev = Math.sqrt(variance);
  return { min, max, mean, stdDev, count: n };
}

// ── Pearson correlation coefficient ───────────────────────────
function pearsonR(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  if (n < 2) return null;
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    num += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }
  const denom = Math.sqrt(dx2 * dy2);
  return denom === 0 ? null : num / denom;
}

// ── Linear regression (least squares) ─────────────────────────
function linearRegression(xs: number[], ys: number[]): { slope: number; intercept: number } | null {
  const n = xs.length;
  if (n < 2) return null;
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    num += dx * (ys[i] - my);
    den += dx * dx;
  }
  if (den === 0) return null;
  const slope = num / den;
  const intercept = my - slope * mx;
  return { slope, intercept };
}

// ── Collect all unique value descriptions across files ────────
function collectAllValueDescriptions(files: ImportedFile[]): { desc: string; rowNumber: number; type: 'set' | 'actual'; unit: string }[] {
  const seen = new Set<string>();
  const result: { desc: string; rowNumber: number; type: 'set' | 'actual'; unit: string }[] = [];
  for (const f of files) {
    for (const v of f.setValues) {
      if (v.status === 256) continue; // skip deactivated
      const key = `set|${v.rowNumber}|${v.description}`;
      if (!seen.has(key)) {
        seen.add(key);
        result.push({ desc: v.description, rowNumber: v.rowNumber, type: 'set', unit: v.unit });
      }
    }
    for (const v of f.actualValues) {
      if (v.status === 256) continue;
      const key = `act|${v.rowNumber}|${v.description}`;
      if (!seen.has(key)) {
        seen.add(key);
        result.push({ desc: v.description, rowNumber: v.rowNumber, type: 'actual', unit: v.unit });
      }
    }
  }
  return result;
}

export const ValueDetailModal: React.FC<ValueDetailModalProps> = ({
  isOpen,
  onClose,
  description,
  rowNumber,
  type,
  files,
}) => {
  const trendRef = useRef<HTMLDivElement>(null);
  const histRef = useRef<HTMLDivElement>(null);
  const corrRef = useRef<HTMLDivElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const trendChart = useRef<echarts.ECharts | null>(null);
  const histChart = useRef<echarts.ECharts | null>(null);
  const corrChart = useRef<echarts.ECharts | null>(null);
  const theme = useThemeColors();

  // ── Local state ───────────────────────────────────────────
  const [binCount, setBinCount] = useState(_persistedBinCount);
  const [trendMode, setTrendMode] = useState<'trend' | 'correlation'>('trend');
  const [corrXDesc, setCorrXDesc] = useState<string>('');
  const [isFullscreen, setIsFullscreen] = useState(true);
  const [corrSearch, setCorrSearch] = useState('');
  const [corrDropdownOpen, setCorrDropdownOpen] = useState(false);
  const corrDropdownRef = useRef<HTMLDivElement>(null);

  // ── Drag-to-move state (non-fullscreen only) ──────────────
  const [modalPos, setModalPos] = useState<{ x: number; y: number } | null>(null);
  const dragState = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);

  // ── Data extraction ───────────────────────────────────────
  const dataPoints = useMemo(() => {
    return files.map((file) => {
      const values = type === 'set' ? file.setValues : file.actualValues;
      const val = values.find((v) => v.rowNumber === rowNumber && v.status !== 256);
      const numVal = val ? parseFloat(val.value) : NaN;
      return {
        file,
        value: val,
        numericValue: numVal,
        label: file.header.idString || file.filename,
      };
    });
  }, [files, type, rowNumber]);

  const numericValues = useMemo(
    () => dataPoints.filter((d) => !isNaN(d.numericValue)).map((d) => d.numericValue),
    [dataPoints],
  );

  // Map: index in numericValues → index in dataPoints (for histogram → trend linking)
  const numericToDataIndex = useMemo(() => {
    const map: number[] = [];
    dataPoints.forEach((d, i) => {
      if (!isNaN(d.numericValue)) map.push(i);
    });
    return map;
  }, [dataPoints]);
  const stats = useMemo(() => calcStats(numericValues), [numericValues]);
  const hasNumericData = numericValues.length > 0;

  // Unit from first available value
  const unit = useMemo(() => {
    const first = dataPoints.find((d) => d.value?.unit);
    return first?.value?.unit || '';
  }, [dataPoints]);

  // ── All available value descriptions for correlation X axis ──
  const allValueDescs = useMemo(() => collectAllValueDescriptions(files), [files]);

  // Parse the correlation X-axis descriptor
  const corrXParsed = useMemo(() => {
    if (!corrXDesc) return null;
    // Format: "set|rowNumber|description" or "act|rowNumber|description"
    const parts = corrXDesc.split('|');
    if (parts.length < 3) return null;
    return {
      type: parts[0] === 'set' ? 'set' as const : 'actual' as const,
      rowNumber: parseInt(parts[1], 10),
      desc: parts.slice(2).join('|'),
    };
  }, [corrXDesc]);

  // Correlation data: (xValue, yValue) pairs per file
  const corrData = useMemo(() => {
    if (!corrXParsed) return null;
    const points: { x: number; y: number; label: string; header: ImportedFile['header']; isNOK: boolean }[] = [];
    for (const dp of dataPoints) {
      if (isNaN(dp.numericValue)) continue;
      const xValues = corrXParsed.type === 'set' ? dp.file.setValues : dp.file.actualValues;
      const xVal = xValues.find((v) => v.rowNumber === corrXParsed.rowNumber && v.status !== 256);
      const xNum = xVal ? parseFloat(xVal.value) : NaN;
      if (isNaN(xNum)) continue;
      // Mark as NOK if individual value status >= 502
      const yNOK = (dp.value?.status ?? 0) >= 502;
      const xNOK = (xVal?.status ?? 0) >= 502;
      points.push({
        x: xNum,
        y: dp.numericValue,
        label: dp.label,
        header: dp.file.header,
        isNOK: !!(yNOK || xNOK),
      });
    }
    return points;
  }, [dataPoints, corrXParsed]);

  const corrXUnit = useMemo(() => {
    if (!corrXParsed) return '';
    const entry = allValueDescs.find(
      (d) => d.type === corrXParsed.type && d.rowNumber === corrXParsed.rowNumber,
    );
    return entry?.unit || '';
  }, [corrXParsed, allValueDescs]);

  // ── Bin count persistence ─────────────────────────────────
  const handleBinCountChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value, 10);
    if (!isNaN(val) && val >= 2 && val <= 100) {
      setBinCount(val);
      _persistedBinCount = val;
    }
  }, []);

  // ── Render trend chart ────────────────────────────────────
  useEffect(() => {
    if (!isOpen || !trendRef.current || !hasNumericData || trendMode !== 'trend') return;

    const chart = echarts.init(trendRef.current, undefined, { renderer: 'canvas' });
    trendChart.current = chart;

    // Sequential numbers for X axis, tooltip shows header info
    const xLabels = dataPoints.map((_, i) => String(i + 1));
    const seriesData = dataPoints.map((d, i) => {
      const h = d.file.header;
      // NOK if individual value status >= 502
      const isNOK = (d.value?.status ?? 0) >= 502;
      return {
        value: isNaN(d.numericValue) ? null : d.numericValue,
        itemStyle: {
          color: isNOK ? '#ef5350' : '#4fc3f7',
          borderColor: isNOK ? '#c62828' : '#0288d1',
          borderWidth: 2,
        },
        _header: h,
        _index: i,
      };
    });

    const option: echarts.EChartsOption = {
      backgroundColor: 'transparent',
      grid: {
        top: 40,
        right: 24,
        bottom: 40,
        left: 70,
        containLabel: false,
      },
      toolbox: {
        show: true,
        right: 10,
        top: 4,
        itemSize: 14,
        feature: {
          dataZoom: {
            title: { zoom: 'Box Zoom', back: 'Zoom Back' },
          },
          restore: { title: 'Reset' },
        },
        iconStyle: {
          borderColor: theme.chartAxisLabel || '#999',
        },
        emphasis: {
          iconStyle: {
            borderColor: '#4fc3f7',
          },
        },
      },
      tooltip: {
        trigger: 'item',
        confine: false,
        appendTo: document.body,
        backgroundColor: theme.chartTooltipBg || 'rgba(20,20,30,0.92)',
        borderColor: theme.chartTooltipBorder || 'rgba(80,80,120,0.3)',
        textStyle: {
          color: theme.chartTooltipText || '#e0e0e0',
          fontSize: 11,
        },
        extraCssText: 'backdrop-filter:blur(10px);border-radius:10px;box-shadow:0 4px 20px rgba(0,0,0,0.3);max-width:320px;z-index:2147483647;',
        formatter: (params: unknown) => {
          const p = params as { dataIndex: number; value: number };
          const dp = dataPoints[p.dataIndex];
          if (!dp) return '';
          const h = dp.file.header;
          const lines = [
            `<b style="font-size:12px">#${p.dataIndex + 1} — ${dp.label}</b>`,
            `<span style="font-size:13px;font-weight:700">${p.value}${unit ? ' ' + unit : ''}</span>`,
            '',
            h.machineDesc ? `Machine: ${h.machineDesc}${h.machineShortDesc ? ` (${h.machineShortDesc})` : ''}` : null,
            h.moduleDesc ? `Module: ${h.moduleDesc}${h.moduleShortDesc ? ` (${h.moduleShortDesc})` : ''}` : null,
            h.nameOfMeasurePoint ? `Measure Point: ${h.nameOfMeasurePoint}` : null,
            h.diagramTitle ? `Title: ${h.diagramTitle}` : null,
            h.date ? `Date: ${h.date}` : null,
            (h.type || h.variant) ? `Type/Variant: ${h.type || '–'} / ${h.variant || '–'}` : null,
            `Value Status: <b style="color:${(dp.value?.status ?? 0) >= 502 ? '#ef5350' : '#66bb6a'}">${(dp.value?.status ?? 0) >= 502 ? 'NOK' : 'OK'}</b>`,
            `File Status: <b style="color:${h.isMarked ? '#ef5350' : '#66bb6a'}">${h.isMarked ? 'NOK' : 'OK'}</b>`,
          ].filter(Boolean);
          return lines.join('<br/>');
        },
      },
      xAxis: {
        type: 'category',
        data: xLabels,
        name: 'File #',
        nameLocation: 'middle',
        nameGap: 24,
        nameTextStyle: { fontSize: 10, color: theme.chartAxisName || '#aaa' },
        axisLabel: {
          fontSize: 9,
          color: theme.chartAxisLabel || '#999',
        },
        axisLine: { lineStyle: { color: theme.chartAxisLine || '#444' } },
        axisTick: { lineStyle: { color: theme.chartAxisTick || '#555' } },
      },
      yAxis: {
        type: 'value',
        name: unit ? `${description} [${unit}]` : description,
        nameTextStyle: {
          fontSize: 10,
          color: theme.chartAxisName || '#aaa',
          padding: [0, 0, 0, 0],
        },
        axisLabel: {
          fontSize: 10,
          color: theme.chartAxisLabel || '#999',
        },
        axisLine: { show: true, lineStyle: { color: theme.chartAxisLine || '#444' } },
        splitLine: {
          lineStyle: { color: theme.chartGridLine || '#333', type: 'dashed', opacity: 0.4 },
        },
      },
      dataZoom: [
        { type: 'inside', xAxisIndex: 0, filterMode: 'none' },
        { type: 'inside', yAxisIndex: 0, filterMode: 'none' },
      ],
      series: [
        {
          type: 'line',
          data: seriesData as unknown as echarts.LineSeriesOption['data'],
          smooth: 0.3,
          symbol: 'circle',
          symbolSize: dataPoints.length > 200 ? 4 : dataPoints.length > 80 ? 6 : 10,
          showAllSymbol: true,
          sampling: undefined,
          lineStyle: {
            color: '#4fc3f7',
            width: dataPoints.length > 200 ? 1 : 2,
            opacity: 0.7,
          },
          emphasis: {
            scale: true,
            itemStyle: {
              color: '#ffeb3b',
              borderColor: '#f57f17',
              borderWidth: 3,
              shadowBlur: 16,
              shadowColor: 'rgba(255,235,59,0.8)',
            },
          },
          // Dim non-highlighted points when histogram bin is hovered
          blur: {
            itemStyle: { opacity: 0.12 },
            lineStyle: { opacity: 0.06 },
          },
          markLine: stats ? {
            silent: true,
            symbol: 'none',
            lineStyle: { type: 'dashed', color: '#ffab40', width: 1.5, opacity: 0.7 },
            label: {
              formatter: `Mean: ${stats.mean.toPrecision(5)}`,
              fontSize: 9,
              color: '#ffab40',
            },
            data: [{ yAxis: stats.mean }],
          } : undefined,
        },
      ],
      animation: true,
      animationDuration: 400,
    };

    chart.setOption(option);

    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(trendRef.current);

    return () => {
      ro.disconnect();
      chart.dispose();
      trendChart.current = null;
    };
  }, [isOpen, dataPoints, hasNumericData, theme, description, unit, stats, trendMode]);

  // ── Render correlation scatter chart ──────────────────────
  useEffect(() => {
    if (!isOpen || !corrRef.current || trendMode !== 'correlation' || !corrData || corrData.length === 0) return;

    const chart = echarts.init(corrRef.current, undefined, { renderer: 'canvas' });
    corrChart.current = chart;

    const corrXLabel = corrXParsed ? corrXParsed.desc : '';

    // Compute Pearson r
    const xs = corrData.map((d) => d.x);
    const ys = corrData.map((d) => d.y);
    const rValue = pearsonR(xs, ys);

    // Compute linear regression for trend line
    const reg = linearRegression(xs, ys);

    // Compute axis ranges with 5% padding
    const xVals = xs;
    const yVals = ys;
    const xMin = Math.min(...xVals), xMax = Math.max(...xVals);
    const yMin = Math.min(...yVals), yMax = Math.max(...yVals);
    const xPad = (xMax - xMin) * 0.05 || Math.abs(xMin) * 0.05 || 1;
    const yPad = (yMax - yMin) * 0.05 || Math.abs(yMin) * 0.05 || 1;

    const option: echarts.EChartsOption = {
      backgroundColor: 'transparent',
      grid: {
        top: 40,
        right: 24,
        bottom: 50,
        left: 70,
        containLabel: false,
      },
      toolbox: {
        show: true,
        right: 10,
        top: 4,
        itemSize: 14,
        feature: {
          dataZoom: {
            title: { zoom: 'Box Zoom', back: 'Zoom Back' },
          },
          restore: { title: 'Reset' },
        },
        iconStyle: {
          borderColor: theme.chartAxisLabel || '#999',
        },
        emphasis: {
          iconStyle: {
            borderColor: '#4fc3f7',
          },
        },
      },
      tooltip: {
        trigger: 'item',
        confine: false,
        appendTo: document.body,
        backgroundColor: theme.chartTooltipBg || 'rgba(20,20,30,0.92)',
        borderColor: theme.chartTooltipBorder || 'rgba(80,80,120,0.3)',
        textStyle: {
          color: theme.chartTooltipText || '#e0e0e0',
          fontSize: 11,
        },
        extraCssText: 'backdrop-filter:blur(10px);border-radius:10px;box-shadow:0 4px 20px rgba(0,0,0,0.3);max-width:320px;z-index:2147483647;',
        formatter: (params: unknown) => {
          const p = params as { dataIndex: number; value: [number, number] };
          const dp = corrData[p.dataIndex];
          if (!dp) return '';
          const h = dp.header;
          return [
            `<b style="font-size:12px">${dp.label}</b>`,
            `X (${corrXLabel}): <b>${p.value[0]}${corrXUnit ? ' ' + corrXUnit : ''}</b>`,
            `Y (${description}): <b>${p.value[1]}${unit ? ' ' + unit : ''}</b>`,
            '',
            h.machineDesc ? `Machine: ${h.machineDesc}${h.machineShortDesc ? ` (${h.machineShortDesc})` : ''}` : null,
            h.moduleDesc ? `Module: ${h.moduleDesc}${h.moduleShortDesc ? ` (${h.moduleShortDesc})` : ''}` : null,
            h.nameOfMeasurePoint ? `Measure Point: ${h.nameOfMeasurePoint}` : null,
            h.diagramTitle ? `Title: ${h.diagramTitle}` : null,
            h.date ? `Date: ${h.date}` : null,
            (h.type || h.variant) ? `Type/Variant: ${h.type || '–'} / ${h.variant || '–'}` : null,
            `Value Status: <b style="color:${dp.isNOK ? '#ef5350' : '#66bb6a'}">${dp.isNOK ? 'NOK' : 'OK'}</b>`,
          ].filter(Boolean).join('<br/>');
        },
      },
      xAxis: {
        type: 'value',
        name: corrXUnit ? `${corrXLabel} [${corrXUnit}]` : corrXLabel,
        nameLocation: 'middle',
        nameGap: 30,
        nameTextStyle: { fontSize: 10, color: theme.chartAxisName || '#aaa' },
        axisLabel: { fontSize: 10, color: theme.chartAxisLabel || '#999' },
        axisLine: { show: true, lineStyle: { color: theme.chartAxisLine || '#444' } },
        splitLine: {
          lineStyle: { color: theme.chartGridLine || '#333', type: 'dashed', opacity: 0.4 },
        },
        min: xMin - xPad,
        max: xMax + xPad,
      },
      yAxis: {
        type: 'value',
        name: unit ? `${description} [${unit}]` : description,
        nameTextStyle: { fontSize: 10, color: theme.chartAxisName || '#aaa' },
        axisLabel: { fontSize: 10, color: theme.chartAxisLabel || '#999' },
        axisLine: { show: true, lineStyle: { color: theme.chartAxisLine || '#444' } },
        splitLine: {
          lineStyle: { color: theme.chartGridLine || '#333', type: 'dashed', opacity: 0.4 },
        },
        min: yMin - yPad,
        max: yMax + yPad,
      },
      dataZoom: [
        { type: 'inside', xAxisIndex: 0, filterMode: 'none' },
        { type: 'inside', yAxisIndex: 0, filterMode: 'none' },
      ],
      series: [
        {
          type: 'scatter',
          data: corrData.map((d) => ({
            value: [d.x, d.y],
            itemStyle: {
              color: d.isNOK ? '#ef5350' : '#4fc3f7',
              borderColor: d.isNOK ? '#c62828' : '#0288d1',
              borderWidth: 2,
            },
          })),
          symbolSize: 12,
          emphasis: {
            scale: true,
            itemStyle: { shadowBlur: 10, shadowColor: 'rgba(79,195,247,0.5)' },
          },
        },
        // Regression line
        ...(reg ? [{
          type: 'line' as const,
          data: [
            [xMin - xPad, reg.slope * (xMin - xPad) + reg.intercept],
            [xMax + xPad, reg.slope * (xMax + xPad) + reg.intercept],
          ],
          symbol: 'none',
          lineStyle: {
            color: '#ffab40',
            width: 2,
            type: 'dashed' as const,
            opacity: 0.8,
          },
          silent: true,
          tooltip: { show: false },
        }] : []),
      ],
      graphic: rValue !== null ? [
        {
          type: 'text',
          right: 30,
          top: 12,
          style: {
            text: `r = ${rValue.toFixed(4)}`,
            fontSize: 13,
            fontWeight: 'bold',
            fill: Math.abs(rValue) > 0.7 ? '#66bb6a' : Math.abs(rValue) > 0.4 ? '#ffab40' : '#ef5350',
          },
        },
      ] : undefined,
      animation: true,
      animationDuration: 400,
    };

    chart.setOption(option);

    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(corrRef.current);

    return () => {
      ro.disconnect();
      chart.dispose();
      corrChart.current = null;
    };
  }, [isOpen, corrData, corrXParsed, trendMode, theme, description, unit, corrXUnit]);

  // ── Render histogram ──────────────────────────────────────
  useEffect(() => {
    if (!isOpen || !histRef.current || !hasNumericData || trendMode !== 'trend') return;

    const chart = echarts.init(histRef.current, undefined, { renderer: 'canvas' });
    histChart.current = chart;

    const bins = computeHistogramBins(numericValues, binCount);

    const option: echarts.EChartsOption = {
      backgroundColor: 'transparent',
      grid: {
        top: 30,
        right: 24,
        bottom: 40,
        left: 50,
        containLabel: false,
      },
      tooltip: {
        trigger: 'axis',
        backgroundColor: theme.chartTooltipBg || 'rgba(20,20,30,0.92)',
        borderColor: theme.chartTooltipBorder || 'rgba(80,80,120,0.3)',
        textStyle: {
          color: theme.chartTooltipText || '#e0e0e0',
          fontSize: 11,
        },
        extraCssText: 'backdrop-filter:blur(10px);border-radius:10px;',
        formatter: (params: unknown) => {
          const p = (params as { data: number; name: string }[])[0];
          return `Range: <b>${p.name}</b><br/>Count: <b>${p.data}</b>`;
        },
      },
      xAxis: {
        type: 'category',
        data: bins.map((b) => b.label),
        axisLabel: {
          fontSize: 9,
          color: theme.chartAxisLabel || '#999',
          rotate: 30,
        },
        axisLine: { lineStyle: { color: theme.chartAxisLine || '#444' } },
        name: unit || '',
        nameLocation: 'middle',
        nameGap: 28,
        nameTextStyle: { fontSize: 10, color: theme.chartAxisName || '#aaa' },
      },
      yAxis: {
        type: 'value',
        name: 'Count',
        nameTextStyle: { fontSize: 10, color: theme.chartAxisName || '#aaa' },
        axisLabel: { fontSize: 10, color: theme.chartAxisLabel || '#999' },
        axisLine: { show: true, lineStyle: { color: theme.chartAxisLine || '#444' } },
        splitLine: {
          lineStyle: { color: theme.chartGridLine || '#333', type: 'dashed', opacity: 0.4 },
        },
        minInterval: 1,
      },
      series: [
        {
          type: 'bar',
          data: bins.map((b) => b.count),
          barWidth: '70%',
          itemStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: '#4fc3f7' },
              { offset: 1, color: '#0288d1' },
            ]),
            borderRadius: [4, 4, 0, 0],
          },
          emphasis: {
            itemStyle: {
              color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                { offset: 0, color: '#81d4fa' },
                { offset: 1, color: '#4fc3f7' },
              ]),
            },
          },
        },
      ],
      animation: true,
      animationDuration: 400,
    };

    chart.setOption(option);

    // ── Histogram → Trend cross-highlighting ──────────────
    chart.on('mouseover', (params: { dataIndex?: number }) => {
      const binIdx = params.dataIndex;
      if (binIdx == null || !bins[binIdx] || !trendChart.current) return;
      // Map bin's numericValues indices → dataPoints indices
      const dpIndices = bins[binIdx].indices.map((ni) => numericToDataIndex[ni]);
      trendChart.current.dispatchAction({
        type: 'highlight',
        seriesIndex: 0,
        dataIndex: dpIndices,
      });
    });

    chart.on('mouseout', () => {
      if (!trendChart.current) return;
      trendChart.current.dispatchAction({
        type: 'downplay',
        seriesIndex: 0,
      });
    });

    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(histRef.current);

    return () => {
      ro.disconnect();
      chart.dispose();
      histChart.current = null;
    };
  }, [isOpen, numericValues, numericToDataIndex, hasNumericData, theme, unit, binCount, trendMode]);

  // ── ESC key handler ───────────────────────────────────────
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  // Prevent body scroll when modal is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = ''; };
    }
  }, [isOpen]);

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setTrendMode('trend');
      setCorrXDesc('');
      setIsFullscreen(true);
      setCorrSearch('');
      setCorrDropdownOpen(false);
      setModalPos(null);
    }
  }, [isOpen]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!corrDropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (corrDropdownRef.current && !corrDropdownRef.current.contains(e.target as Node)) {
        setCorrDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [corrDropdownOpen]);

  // Resize charts when fullscreen toggles
  useEffect(() => {
    const timer = setTimeout(() => {
      trendChart.current?.resize();
      histChart.current?.resize();
      corrChart.current?.resize();
    }, 50);
    return () => clearTimeout(timer);
  }, [isFullscreen]);

  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose],
  );

  // ── Header drag handlers for free positioning ─────────────
  const handleHeaderMouseDown = useCallback((e: React.MouseEvent) => {
    if (isFullscreen) return;
    // Don't start drag on buttons
    if ((e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    const modal = modalRef.current;
    if (!modal) return;
    const rect = modal.getBoundingClientRect();
    const currentX = modalPos?.x ?? rect.left;
    const currentY = modalPos?.y ?? rect.top;
    dragState.current = { startX: e.clientX, startY: e.clientY, origX: currentX, origY: currentY };

    const onMove = (ev: MouseEvent) => {
      if (!dragState.current) return;
      const dx = ev.clientX - dragState.current.startX;
      const dy = ev.clientY - dragState.current.startY;
      setModalPos({
        x: dragState.current.origX + dx,
        y: dragState.current.origY + dy,
      });
    };
    const onUp = () => {
      dragState.current = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [isFullscreen, modalPos]);

  // ── PDF Export (jsPDF, A4 Landscape) ───────────────────────
  const handleExportPDF = useCallback(async () => {
    try {
      const { jsPDF } = await import('jspdf');
      const pdf = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
      const pw = pdf.internal.pageSize.getWidth();   // ~842
      const ph = pdf.internal.pageSize.getHeight();   // ~595
      const m = 30; // margin
      const cw = pw - 2 * m; // content width
      let y = m;

      // ── Title bar ──
      pdf.setFillColor(240, 243, 248);
      pdf.roundedRect(m, y, cw, 30, 4, 4, 'F');
      pdf.setFontSize(8);
      pdf.setFont('helvetica', 'bold');
      pdf.setTextColor(60, 130, 240);
      const tLabel = type === 'set' ? 'SET VALUE' : 'ACTUAL VALUE';
      pdf.text(tLabel, m + 8, y + 18);
      const badgeW = pdf.getTextWidth(tLabel) + 16;
      pdf.setFontSize(12);
      pdf.setTextColor(30);
      pdf.text(description + (unit ? `  [${unit}]` : ''), m + badgeW + 4, y + 19);
      y += 38;

      // ── Stats row ──
      if (stats) {
        const statItems = [
          { label: 'Files', value: String(stats.count) },
          { label: 'Min', value: stats.min.toPrecision(5) },
          { label: 'Max', value: stats.max.toPrecision(5) },
          { label: 'Mean', value: stats.mean.toPrecision(5) },
          { label: 'Std Dev', value: stats.stdDev.toPrecision(4) },
        ];
        const boxW = (cw - (statItems.length - 1) * 6) / statItems.length;
        for (let i = 0; i < statItems.length; i++) {
          const bx = m + i * (boxW + 6);
          pdf.setFillColor(248, 249, 252);
          pdf.setDrawColor(210);
          pdf.roundedRect(bx, y, boxW, 32, 3, 3, 'FD');
          pdf.setFontSize(7);
          pdf.setFont('helvetica', 'normal');
          pdf.setTextColor(120);
          pdf.text(statItems[i].label.toUpperCase(), bx + boxW / 2, y + 12, { align: 'center' });
          pdf.setFontSize(10);
          pdf.setFont('helvetica', 'bold');
          if (statItems[i].label === 'Mean') {
            pdf.setTextColor(210, 130, 0);
          } else {
            pdf.setTextColor(30, 30, 30);
          }
          pdf.text(statItems[i].value, bx + boxW / 2, y + 26, { align: 'center' });
        }
        y += 40;
      }

      // ── Helper: chart → canvas data URL ──
      const chartToImage = (chart: echarts.ECharts | null): string | null => {
        if (!chart) return null;
        try {
          // Get the internal canvas element directly for reliable image data
          const canvasEl = (chart.getDom() as HTMLElement).querySelector('canvas');
          if (!canvasEl) return null;
          // Create an offscreen canvas with white background
          const offscreen = document.createElement('canvas');
          offscreen.width = canvasEl.width;
          offscreen.height = canvasEl.height;
          const ctx = offscreen.getContext('2d');
          if (!ctx) return null;
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, offscreen.width, offscreen.height);
          ctx.drawImage(canvasEl, 0, 0);
          return offscreen.toDataURL('image/jpeg', 0.95);
        } catch {
          return null;
        }
      };

      // ── Helper: get aspect-ratio-preserving dimensions ──
      const fitImage = (chart: echarts.ECharts | null, maxW: number, maxH: number) => {
        if (!chart) return { w: maxW, h: maxH };
        const canvasEl = (chart.getDom() as HTMLElement).querySelector('canvas');
        if (!canvasEl || canvasEl.width === 0 || canvasEl.height === 0) return { w: maxW, h: maxH };
        const aspect = canvasEl.width / canvasEl.height;
        let w = maxW;
        let h = w / aspect;
        if (h > maxH) {
          h = maxH;
          w = h * aspect;
        }
        return { w, h };
      };

      // Determine which top chart to render
      const topChart = trendMode === 'correlation' ? corrChart.current : trendChart.current;
      const topLabel = trendMode === 'correlation' ? 'Correlation' : 'Value Trend';
      const showHist = trendMode === 'trend';

      // ── Top chart (trend or correlation) ──
      const topImg = chartToImage(topChart);
      if (topImg) {
        pdf.setFontSize(9);
        pdf.setFont('helvetica', 'bold');
        pdf.setTextColor(70);
        let chartLabel = topLabel;
        // Add correlation info
        if (trendMode === 'correlation' && corrXParsed && corrData) {
          const rVal = pearsonR(corrData.map((d) => d.x), corrData.map((d) => d.y));
          chartLabel += `  —  X: ${corrXParsed.desc}${corrXUnit ? ' [' + corrXUnit + ']' : ''}`;
          if (rVal !== null) {
            chartLabel += `     r = ${rVal.toFixed(4)}`;
          }
        }
        pdf.text(chartLabel, m, y + 10);
        y += 14;
        // When histogram is shown, reserve space for it; otherwise use all remaining space
        const topMaxH = showHist ? (ph - y - m - 200) : (ph - y - m);
        const { w: topW, h: topH } = fitImage(topChart, cw, Math.max(topMaxH, 120));
        const topX = m + (cw - topW) / 2; // center horizontally if narrower
        pdf.addImage(topImg, 'JPEG', topX, y, topW, topH);
        y += topH + 10;
      }

      // ── Histogram (only in trend mode) ──
      if (showHist) {
        const histImg = chartToImage(histChart.current);
        if (histImg) {
          // New page if not enough room
          const remainH = ph - y - m;
          if (remainH < 120) {
            pdf.addPage();
            y = m;
          }
          pdf.setFontSize(9);
          pdf.setFont('helvetica', 'bold');
          pdf.setTextColor(70);
          pdf.text(`Distribution  (Bins: ${binCount})`, m, y + 10);
          y += 14;
          const histMaxH = Math.min(200, ph - y - m);
          const { w: histW, h: histH } = fitImage(histChart.current, cw, histMaxH);
          const histX = m + (cw - histW) / 2;
          pdf.addImage(histImg, 'JPEG', histX, y, histW, histH);
        }
      }

      // ── Save ──
      const safeDesc = description.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 40);
      pdf.save(`${tLabel}_${safeDesc}.pdf`);
    } catch (err) {
      console.error('PDF export failed:', err);
    }
  }, [description, unit, type, stats, trendMode, corrXParsed, corrData, corrXUnit, binCount]);

  if (!isOpen) return null;

  const typeLabel = type === 'set' ? 'Set Value' : 'Actual Value';

  return (
    <div className="vdm-overlay" onClick={handleOverlayClick}>
      <div
        ref={modalRef}
        className={`vdm-modal ${isFullscreen ? 'vdm-modal--fullscreen' : ''}`}
        style={!isFullscreen && modalPos ? {
          position: 'fixed',
          left: modalPos.x,
          top: modalPos.y,
          margin: 0,
        } : undefined}
      >
        {/* Header — draggable in non-fullscreen mode */}
        <div
          className={`vdm-header ${!isFullscreen ? 'vdm-header--draggable' : ''}`}
          onMouseDown={handleHeaderMouseDown}
        >
          <div className="vdm-header-info">
            <span className="vdm-badge">{typeLabel}</span>
            <h3 className="vdm-title">{description}</h3>
            {unit && <span className="vdm-unit">[{unit}]</span>}
          </div>
          <div className="vdm-header-actions">
            <button className="vdm-action-btn" onClick={handleExportPDF} title="PDF Export">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
            </button>
            <button
              className="vdm-action-btn"
              onClick={() => {
                setIsFullscreen((f) => !f);
                setModalPos(null);
              }}
              title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
            >
              {isFullscreen ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
              )}
            </button>
            <button className="vdm-close" onClick={onClose} title="Close (Esc)">✕</button>
          </div>
        </div>

        {/* Body */}
        <div className="vdm-body">
          {hasNumericData ? (
            <>
              {/* Statistics strip */}
              {stats && (
                <div className="vdm-stats">
                  <div className="vdm-stat">
                    <span className="vdm-stat-label">Files</span>
                    <span className="vdm-stat-value">{stats.count}</span>
                  </div>
                  <div className="vdm-stat">
                    <span className="vdm-stat-label">Min</span>
                    <span className="vdm-stat-value">{stats.min.toPrecision(5)}</span>
                  </div>
                  <div className="vdm-stat">
                    <span className="vdm-stat-label">Max</span>
                    <span className="vdm-stat-value">{stats.max.toPrecision(5)}</span>
                  </div>
                  <div className="vdm-stat">
                    <span className="vdm-stat-label">Mean</span>
                    <span className="vdm-stat-value vdm-stat-mean">{stats.mean.toPrecision(5)}</span>
                  </div>
                  <div className="vdm-stat">
                    <span className="vdm-stat-label">Std Dev</span>
                    <span className="vdm-stat-value">{stats.stdDev.toPrecision(4)}</span>
                  </div>
                </div>
              )}

              {/* Trend / Correlation chart */}
              <div className="vdm-chart-section">
                <div className="vdm-section-header">
                  <span className="vdm-section-icon">{trendMode === 'trend' ? '📈' : '🔗'}</span>
                  {/* Mode toggle */}
                  <div className="vdm-mode-toggle">
                    <button
                      className={`vdm-mode-btn ${trendMode === 'trend' ? 'active' : ''}`}
                      onClick={() => setTrendMode('trend')}
                    >
                      Value Trend
                    </button>
                    <button
                      className={`vdm-mode-btn ${trendMode === 'correlation' ? 'active' : ''}`}
                      onClick={() => setTrendMode('correlation')}
                    >
                      Correlation
                    </button>
                  </div>
                  {/* Correlation X-axis selector with search */}
                  {trendMode === 'correlation' && (
                    <div className="vdm-corr-dropdown" ref={corrDropdownRef}>
                      <button
                        className="vdm-corr-trigger"
                        onClick={() => setCorrDropdownOpen((o) => !o)}
                        title="Select X-axis value"
                      >
                        {corrXDesc
                          ? (() => {
                              const parts = corrXDesc.split('|');
                              return parts.length >= 3 ? parts.slice(2).join('|') : corrXDesc;
                            })()
                          : '— Select X-axis value —'}
                        <span className="vdm-corr-arrow">{corrDropdownOpen ? '▲' : '▼'}</span>
                      </button>
                      {corrDropdownOpen && (
                        <div className="vdm-corr-panel">
                          <input
                            className="vdm-corr-search"
                            type="text"
                            placeholder="Search..."
                            value={corrSearch}
                            onChange={(e) => setCorrSearch(e.target.value)}
                            autoFocus
                            onClick={(e) => e.stopPropagation()}
                          />
                          <div className="vdm-corr-list">
                            {(() => {
                              const q = corrSearch.toLowerCase();
                              const setDescs = allValueDescs.filter(
                                (d) => d.type === 'set' && (q === '' || d.desc.toLowerCase().includes(q) || d.unit.toLowerCase().includes(q)),
                              );
                              const actDescs = allValueDescs.filter(
                                (d) => d.type === 'actual' && (q === '' || d.desc.toLowerCase().includes(q) || d.unit.toLowerCase().includes(q)),
                              );
                              return (
                                <>
                                  {setDescs.length > 0 && (
                                    <div className="vdm-corr-group">Set Values</div>
                                  )}
                                  {setDescs.map((d) => {
                                    const key = `set|${d.rowNumber}|${d.desc}`;
                                    return (
                                      <button
                                        key={key}
                                        className={`vdm-corr-option ${corrXDesc === key ? 'selected' : ''}`}
                                        onClick={() => {
                                          setCorrXDesc(key);
                                          setCorrDropdownOpen(false);
                                          setCorrSearch('');
                                        }}
                                      >
                                        {d.desc}{d.unit ? ` [${d.unit}]` : ''}
                                      </button>
                                    );
                                  })}
                                  {actDescs.length > 0 && (
                                    <div className="vdm-corr-group">Actual Values</div>
                                  )}
                                  {actDescs.map((d) => {
                                    const key = `act|${d.rowNumber}|${d.desc}`;
                                    return (
                                      <button
                                        key={key}
                                        className={`vdm-corr-option ${corrXDesc === key ? 'selected' : ''}`}
                                        onClick={() => {
                                          setCorrXDesc(key);
                                          setCorrDropdownOpen(false);
                                          setCorrSearch('');
                                        }}
                                      >
                                        {d.desc}{d.unit ? ` [${d.unit}]` : ''}
                                      </button>
                                    );
                                  })}
                                  {setDescs.length === 0 && actDescs.length === 0 && (
                                    <div className="vdm-corr-no-match">No matches</div>
                                  )}
                                </>
                              );
                            })()}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <div ref={trendRef} className="vdm-chart vdm-chart-trend" style={{ display: trendMode === 'trend' ? '' : 'none' }} />
                <div className="vdm-corr-wrapper" style={{ display: trendMode === 'correlation' ? '' : 'none' }}>
                  {corrData && corrData.length > 0 ? (
                    <div ref={corrRef} className="vdm-chart vdm-chart-trend" />
                  ) : (
                    <div className="vdm-corr-empty">
                      {corrXDesc ? 'No matching data — some files may lack values for both rows.' : 'Select a value row for the X-axis to display a correlation scatter plot.'}
                    </div>
                  )}
                </div>
              </div>

              {/* Histogram — hidden in correlation mode to free space for scatter plot */}
              <div className="vdm-chart-section" style={{ display: trendMode === 'trend' ? '' : 'none' }}>
                <div className="vdm-section-header">
                  <span className="vdm-section-icon">📊</span>
                  <span>Distribution</span>
                  <div className="vdm-bin-control">
                    <label className="vdm-bin-label">Bins:</label>
                    <input
                      type="number"
                      className="vdm-bin-input"
                      value={binCount}
                      onChange={handleBinCountChange}
                      min={2}
                      max={100}
                      step={1}
                    />
                  </div>
                </div>
                <div ref={histRef} className="vdm-chart vdm-chart-hist" />
              </div>
            </>
          ) : (
            <div className="vdm-no-data">
              <span className="vdm-no-data-icon">📋</span>
              <p>No numeric data available for this row.</p>
              <p className="vdm-no-data-sub">
                Values: {dataPoints.map((d) => d.value?.value ?? '–').join(', ')}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
