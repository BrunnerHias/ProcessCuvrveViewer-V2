// ============================================================
// useThemeColors - Read CSS variables for ECharts theming
// ============================================================

import { useMemo } from 'react';
import { useSettingsStore } from '../stores/settingsStore';

export interface ThemeColors {
  bgChart: string;
  bgPanel: string;
  bgSurface: string;
  bgSecondary: string;
  chartEmphasisBg: string;
  chartEmphasisText: string;
  chartTooltipBg: string;
  chartTooltipBorder: string;
  chartTooltipText: string;
  chartTooltipShadow: string;
  chartLegendText: string;
  chartLegendInactive: string;
  chartCrosshair: string;
  chartDatazoomBorder: string;
  chartDatazoomBg: string;
  chartDatazoomFiller: string;
  chartDatazoomText: string;
  chartDatazoomHandle: string;
  chartGridLine: string;
  chartAxisLine: string;
  chartAxisLabel: string;
  chartAxisName: string;
  chartAxisTick: string;
  textPrimary: string;
  border: string;
}

/**
 * Reads CSS custom property values from the document root.
 * Re-evaluates whenever the theme changes.
 */
export function useThemeColors(): ThemeColors {
  // Subscribe to theme so we re-compute when it changes
  const theme = useSettingsStore((s) => s.theme);

  return useMemo(() => {
    const style = getComputedStyle(document.documentElement);
    const get = (v: string) => style.getPropertyValue(v).trim();

    return {
      bgChart: get('--bg-chart') || '#161622',
      bgPanel: get('--bg-panel') || 'rgba(20, 20, 30, 0.95)',
      bgSurface: get('--bg-surface') || '#1e1e2e',
      bgSecondary: get('--bg-secondary') || '#1a1a2e',
      chartEmphasisBg: get('--chart-emphasis-bg') || 'rgba(30,30,46,0.9)',
      chartEmphasisText: get('--chart-emphasis-text') || '#e0e0e0',
      chartTooltipBg: get('--chart-tooltip-bg') || 'rgba(18, 18, 30, 0.92)',
      chartTooltipBorder: get('--chart-tooltip-border') || 'rgba(255,255,255,0.08)',
      chartTooltipText: get('--chart-tooltip-text') || '#e0e0ea',
      chartTooltipShadow: get('--chart-tooltip-shadow') || 'rgba(0,0,0,0.5)',
      chartLegendText: get('--chart-legend-text') || '#bbb',
      chartLegendInactive: get('--chart-legend-inactive') || '#555',
      chartCrosshair: get('--chart-crosshair') || 'rgba(160,170,200,0.45)',
      chartDatazoomBorder: get('--chart-datazoom-border') || 'rgba(255,255,255,0.06)',
      chartDatazoomBg: get('--chart-datazoom-bg') || 'rgba(26,26,46,0.6)',
      chartDatazoomFiller: get('--chart-datazoom-filler') || 'rgba(79,195,247,0.15)',
      chartDatazoomText: get('--chart-datazoom-text') || '#8888a0',
      chartDatazoomHandle: get('--chart-datazoom-handle') || 'rgba(160,180,220,0.4)',
      chartGridLine: get('--chart-grid-line') || 'rgba(255,255,255,0.04)',
      chartAxisLine: get('--chart-axis-line') || 'rgba(255,255,255,0.08)',
      chartAxisLabel: get('--chart-axis-label') || '#70708a',
      chartAxisName: get('--chart-axis-name') || '#8888a8',
      chartAxisTick: get('--chart-axis-tick') || 'rgba(255,255,255,0.06)',
      textPrimary: get('--text-primary') || '#e0e0e0',
      border: get('--border') || '#333',
    };
  }, [theme]);
}
