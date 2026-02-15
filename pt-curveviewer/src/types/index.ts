// ============================================================
// PT CurveViewer Gen2 - Core Type Definitions
// ============================================================

// --- Header Info ---
export interface HeaderInfo {
  machineDesc: string;
  machineShortDesc: string;
  moduleDesc: string;
  moduleShortDesc: string;
  nameOfMeasurePoint: string;
  idString: string;
  type: string;
  variant: string;
  isIONIOClassificationOn: boolean;
  isMarked: boolean;
  dataPossiblyIncorrect: boolean;
  diagramTitle: string;
  date: string;
}

// --- Graphic Elements ---
export interface GraphicLine {
  description: string;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  layer: number;
}

export interface LineGroup {
  description: string;
  groupDescription: string;
  color: number;
  thickness: number;
  style: number;
  lines: GraphicLine[];
}

export interface GraphicWindow {
  description: string;
  point1X: number;
  point1Y: number;
  point2X: number;
  point2Y: number;
  layer: number;
}

export interface WindowGroup {
  description: string;
  groupDescription: string;
  color: number;
  thickness: number;
  style: number;
  isFilled: boolean;
  windows: GraphicWindow[];
}

export interface GraphicCircle {
  description: string;
  centerX: number;
  centerY: number;
  radius: number;
  layer: number;
}

export interface CircleGroup {
  description: string;
  groupDescription: string;
  color: number;
  thickness: number;
  style: number;
  isFilled: boolean;
  circles: GraphicCircle[];
}

export interface GraphicElements {
  lineGroups: LineGroup[];
  windowGroups: WindowGroup[];
  circleGroups: CircleGroup[];
}

// --- Coordinate System ---
export interface CoordSystem {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
  originX: number;
  originY: number;
  originZ: number;
  color: number;
}

// --- Curve Channel ---
export interface CurveChannel {
  id: string;
  fileId: string;
  description: string;
  groupDescription: string;
  xName: string;        // e.g. "Time", "Position"
  yName: string;        // e.g. "Torque", "Knob Force"
  zName: string;
  xUnit: string;        // e.g. "ms", "°"
  yUnit: string;        // e.g. "Nm", "N"
  zUnit: string;
  xPrecision: number;
  yPrecision: number;
  zPrecision: number;
  lineColor: number;
  pointsColor: number;
  lineThickness: number;
  lineStyle: number;
  isLineVisible: boolean;
  arePointsVisible: boolean;
  coordSystem: CoordSystem;
  pointsX: Float64Array;
  pointsY: Float64Array;
  noOfPoints: number;
  graphicElements: GraphicElements;
}

// --- Set / Actual Values ---
export interface SetValue {
  description: string;
  status: number;
  value: string;
  dataType: number;
  unit: string;
  precision: number;
  rowNumber: number;
  textColorDescription: number;
  backColorDescription: number;
  textColorUnit: number;
  backColorUnit: number;
  textColorValue: number;
  backColorValue: number;
}

export interface ActualValue {
  description: string;
  status: number;
  value: string;
  dataType: number;
  unit: string;
  precision: number;
  rowNumber: number;
  textColorDescription: number;
  backColorDescription: number;
  textColorUnit: number;
  backColorUnit: number;
  textColorValue: number;
  backColorValue: number;
}

// --- Imported File (fully parsed) ---
export interface ImportedFile {
  id: string;
  filename: string;
  header: HeaderInfo;
  curves: CurveChannel[];
  setValues: SetValue[];
  actualValues: ActualValue[];
  importedAt: number; // Date.now() timestamp
}

// --- Grouping ---
export interface ChannelRef {
  fileId: string;
  channelId: string;
}

export interface ChannelGroup {
  id: string;
  name: string;
  channels: ChannelRef[];
  isActive: boolean;
}

// --- Visibility Settings ---
export interface VisibilitySettings {
  allElements: boolean;
  lines: boolean;
  windows: boolean;
  circles: boolean;
  showPoints: boolean;
}

// --- Per-Instance Channel Visibility ---
export interface ChannelVisibility {
  groupId: string;      // 'ungrouped' for ungrouped channels
  fileId: string;
  channelId: string;
  visible: boolean;
  visibleElements: {
    lines: boolean;
    windows: boolean;
    circles: boolean;
  };
  hiddenElementGroups?: string[];  // e.g. ["windows-0", "lines-2", "circles-1"]
}

// --- Cursor State ---
export type SnapYStrategy = 'ymax' | 'ymin';

export interface CursorState {
  id: string;
  xPosition: number;
  yPosition?: number;           // Y data-value in free mode
  freeYAxisIndex?: number;       // which yAxisIndex was used for conversion
  mode: 'free' | 'snap';
  snapFileId?: string;
  snapChannelId?: string;
  snapYStrategy: SnapYStrategy;
  showAllFiles: boolean;
  color: string;
}

// --- Zoom History ---
export interface ZoomLevel {
  xStart: number;   // dataZoom start %
  xEnd: number;     // dataZoom end %
}

// --- Plot Settings ---
export interface PlotSettings {
  activeXAxis: string;  // The currently selected xName ("Time", "Position", etc.)
  visibility: VisibilitySettings;
  channelVisibility: ChannelVisibility[];
  /** Color overrides: key = channelId, value = hex color string */
  colorOverrides: Record<string, string>;
  cursors: CursorState[];
  zoomHistory: ZoomLevel[];
  zoomIndex: number;       // current position in history
}

// --- X-Sync (Channel Reference Alignment) ---
export type SyncMode = 'off' | 'xmin' | 'xmax' | 'ythreshold';

export interface SyncState {
  mode: SyncMode;
  masterYAxis: string;              // yName of the master channel
  threshold: number;                // Y-threshold value (only for ythreshold mode)
  offsets: Record<string, number>;  // fileId → computed X-offset
  isCalculating: boolean;
}
