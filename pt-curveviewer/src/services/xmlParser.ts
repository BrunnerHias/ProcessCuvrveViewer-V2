// ============================================================
// XML Parser Service - Parses curve data XML into typed structures
// ============================================================

import { XMLParser } from 'fast-xml-parser';
import type {
  ImportedFile,
  HeaderInfo,
  CurveChannel,
  CoordSystem,
  GraphicElements,
  LineGroup,
  GraphicLine,
  WindowGroup,
  GraphicWindow,
  CircleGroup,
  GraphicCircle,
  SetValue,
  ActualValue,
} from '../types';

// Configure parser to handle attributes
const parserOptions = {
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseAttributeValue: false,
  trimValues: true,
  parseTagValue: false,
  stopNodes: ['*.points'],
  isArray: (_name: string, _jpath: string) => {
    // Force arrays for repeating elements
    const arrayPaths = [
      'data.body.curves.curve',
      'data.body.setValues.plc.setValue',
      'data.body.actualValues.plc.actualValue',
    ];
    if (arrayPaths.includes(_jpath)) return true;
    // line/window/circle groups and their children
    if (_jpath.endsWith('.linegroup') || _jpath.endsWith('.windowgroup') || _jpath.endsWith('.circlegroup')) return true;
    if (_jpath.endsWith('.lines.line') || _jpath.endsWith('.windows.window') || _jpath.endsWith('.circles.circle')) return true;
    return false;
  },
};

const xmlParser = new XMLParser(parserOptions);

function str(val: unknown): string {
  if (val === undefined || val === null) return '';
  return String(val);
}

function num(val: unknown, fallback = 0): number {
  if (val === undefined || val === null) return fallback;
  const n = Number(val);
  return isNaN(n) ? fallback : n;
}

function bool(val: unknown, fallback = false): boolean {
  if (val === undefined || val === null) return fallback;
  if (typeof val === 'boolean') return val;
  return String(val).toLowerCase() === 'true';
}

/**
 * Map XML ActSet Value status codes:
 *   Normalizes legacy raw status values to standard codes:
 *     0 → 501 (OK)
 *     1 → 256 (deactivated)
 *     2 → 502 (NOK)
 *   All other codes are kept as-is:
 *   256 = deactivated, 500 = informative, 501 = OK,
 *   502 = NOK, 503 = NOK Upper Limit, 504 = NOK Lower Limit
 *
 * Additional status values will be added with Post-Process evaluations.
 */
function mapValueStatus(rawStatus: number): number {
  if (rawStatus === 0) return 501; // normalize unset → OK
  if (rawStatus === 1) return 256; // legacy deactivated → standard deactivated
  if (rawStatus === 2) return 502; // legacy NOK → standard NOK
  return rawStatus;
}

function parseHeader(body: Record<string, unknown>): HeaderInfo {
  return {
    machineDesc: str(body.machineDesc),
    machineShortDesc: str(body.machineShortDesc),
    moduleDesc: str(body.moduleDesc),
    moduleShortDesc: str(body.moduleShortDesc),
    nameOfMeasurePoint: str(body.nameOfMeasurePoint),
    idString: str(body.idString),
    type: str(body.type),
    variant: str(body.variant),
    isIONIOClassificationOn: bool(body.isIONIOClassificationOn),
    isMarked: bool(body.isMarked),
    dataPossiblyIncorrect: bool(body.dataPossiblyIncorrect),
    diagramTitle: str(body.diagramTitle),
    date: str(body.date),
  };
}

function parsePoints(curve: Record<string, unknown>): { x: Float64Array; y: Float64Array; count: number } {
  const noOfPoints = num(curve.noOfPoints, 0);
  if (noOfPoints === 0 || !curve.points) {
    return { x: new Float64Array(0), y: new Float64Array(0), count: 0 };
  }

  // With stopNodes, curve.points is a raw XML string
  // Use regex extraction — avoids creating thousands of JS objects
  const raw = typeof curve.points === 'string' ? curve.points : '';
  if (!raw) {
    return { x: new Float64Array(0), y: new Float64Array(0), count: 0 };
  }

  const xArr = new Float64Array(noOfPoints);
  const yArr = new Float64Array(noOfPoints);
  const regex = /x="([^"]+)"\s+y="([^"]+)"/g;
  let match: RegExpExecArray | null;
  let i = 0;
  while ((match = regex.exec(raw)) !== null && i < noOfPoints) {
    xArr[i] = +match[1];
    yArr[i] = +match[2];
    i++;
  }

  // If actual count differs from declared noOfPoints, create properly sized arrays
  if (i !== noOfPoints) {
    return { x: xArr.slice(0, i), y: yArr.slice(0, i), count: i };
  }

  return { x: xArr, y: yArr, count: i };
}

function parseLineGroups(linesData: unknown): LineGroup[] {
  if (!linesData) return [];
  const data = linesData as Record<string, unknown>;
  const plc = data.plc as Record<string, unknown>;
  if (!plc) return [];

  let groups = plc.linegroup;
  if (!groups) return [];
  if (!Array.isArray(groups)) groups = [groups];

  return (groups as Array<Record<string, unknown>>).map((grp) => {
    let lineItems: Array<Record<string, unknown>> = [];
    const linesContainer = grp.lines as Record<string, unknown>;
    if (linesContainer) {
      const lineArray = linesContainer.line;
      if (lineArray) {
        lineItems = Array.isArray(lineArray) ? lineArray : [lineArray];
      }
    }

    return {
      description: str(grp.description),
      groupDescription: str(grp.groupDescription),
      color: num(grp.color),
      thickness: num(grp.thickness, 1),
      style: num(grp.style, 1),
      lines: lineItems.map((line): GraphicLine => {
        const sp = line['start-point'] as Record<string, unknown> | undefined;
        const ep = line['end-point'] as Record<string, unknown> | undefined;
        return {
          description: str(line.description),
          startX: sp ? num(sp['@_x']) : 0,
          startY: sp ? num(sp['@_y']) : 0,
          endX: ep ? num(ep['@_x']) : 0,
          endY: ep ? num(ep['@_y']) : 0,
          layer: num(line.layer),
        };
      }),
    };
  });
}

function parseWindowGroups(windowsData: unknown): WindowGroup[] {
  if (!windowsData) return [];
  const data = windowsData as Record<string, unknown>;
  const plc = data.plc as Record<string, unknown>;
  if (!plc) return [];

  let groups = plc.windowgroup;
  if (!groups) return [];
  if (!Array.isArray(groups)) groups = [groups];

  return (groups as Array<Record<string, unknown>>).map((grp) => {
    let windowItems: Array<Record<string, unknown>> = [];
    const windowsContainer = grp.windows as Record<string, unknown>;
    if (windowsContainer) {
      const windowArray = windowsContainer.window;
      if (windowArray) {
        windowItems = Array.isArray(windowArray) ? windowArray : [windowArray];
      }
    }

    return {
      description: str(grp.description),
      groupDescription: str(grp.groupDescription),
      color: num(grp.color),
      thickness: num(grp.thickness, 1),
      style: num(grp.style, 1),
      isFilled: bool(grp.isFilled),
      windows: windowItems.map((win): GraphicWindow => {
        const p1 = win.point1 as Record<string, unknown> | undefined;
        const p2 = win.point2 as Record<string, unknown> | undefined;
        return {
          description: str(win.description),
          point1X: p1 ? num(p1['@_x']) : 0,
          point1Y: p1 ? num(p1['@_y']) : 0,
          point2X: p2 ? num(p2['@_x']) : 0,
          point2Y: p2 ? num(p2['@_y']) : 0,
          layer: num(win.layer),
        };
      }),
    };
  });
}

function parseCircleGroups(circlesData: unknown): CircleGroup[] {
  if (!circlesData) return [];
  const data = circlesData as Record<string, unknown>;
  const plc = data.plc as Record<string, unknown>;
  if (!plc) return [];

  let groups = plc.circlegroup;
  if (!groups) return [];
  if (!Array.isArray(groups)) groups = [groups];

  return (groups as Array<Record<string, unknown>>).map((grp) => {
    let circleItems: Array<Record<string, unknown>> = [];
    const circlesContainer = grp.circles as Record<string, unknown>;
    if (circlesContainer) {
      const circleArray = circlesContainer.circle;
      if (circleArray) {
        circleItems = Array.isArray(circleArray) ? circleArray : [circleArray];
      }
    }

    return {
      description: str(grp.description),
      groupDescription: str(grp.groupDescription),
      color: num(grp.color),
      thickness: num(grp.thickness, 1),
      style: num(grp.style, 1),
      isFilled: bool(grp.isFilled),
      circles: circleItems.map((circ): GraphicCircle => {
        const cp = circ['center-point'] as Record<string, unknown> | undefined;
        return {
          description: str(circ.description),
          centerX: cp ? num(cp['@_x']) : 0,
          centerY: cp ? num(cp['@_y']) : 0,
          radius: num(circ.radius, 5),
          layer: num(circ.layer),
        };
      }),
    };
  });
}

function parseGraphicElements(curve: Record<string, unknown>): GraphicElements {
  return {
    lineGroups: parseLineGroups(curve.lines),
    windowGroups: parseWindowGroups(curve.windows),
    circleGroups: parseCircleGroups(curve.circles),
  };
}

function parseCoordSystem(curve: Record<string, unknown>): CoordSystem {
  return {
    minX: num(curve.coordSystemMinX),
    maxX: num(curve.coordSystemMaxX),
    minY: num(curve.coordSystemMinY),
    maxY: num(curve.coordSystemMaxY),
    minZ: num(curve.coordSystemMinZ),
    maxZ: num(curve.coordSystemMaxZ),
    originX: num(curve.coordSystemOriginX),
    originY: num(curve.coordSystemOriginY),
    originZ: num(curve.coordSystemOriginZ),
    color: num(curve.coordSystemColor),
  };
}

function parseCurves(curves: unknown, fileId: string): CurveChannel[] {
  if (!curves) return [];
  const curvesObj = curves as Record<string, unknown>;
  let curveArray = curvesObj.curve;
  if (!curveArray) return [];
  if (!Array.isArray(curveArray)) curveArray = [curveArray];

  return (curveArray as Array<Record<string, unknown>>).map((curve) => {
    const points = parsePoints(curve);
    const channelId = crypto.randomUUID();

    return {
      id: channelId,
      fileId,
      description: str(curve.description),
      groupDescription: str(curve.groupDescription),
      xName: str(curve.xName),
      yName: str(curve.yName),
      zName: str(curve.zName),
      xUnit: str(curve.xUnit),
      yUnit: str(curve.yUnit),
      zUnit: str(curve.zUnit),
      xPrecision: num(curve.xPrecision, 3),
      yPrecision: num(curve.yPrecision, 3),
      zPrecision: num(curve.zPrecision, 3),
      lineColor: num(curve.lineColor),
      pointsColor: num(curve.pointsColor),
      lineThickness: num(curve.lineThickness, 2),
      lineStyle: num(curve.lineStyle, 1),
      isLineVisible: bool(curve.isLineVisible, true),
      arePointsVisible: bool(curve.arePointsVisible),
      coordSystem: parseCoordSystem(curve),
      pointsX: points.x,
      pointsY: points.y,
      noOfPoints: points.count,
      graphicElements: parseGraphicElements(curve),
    };
  });
}

function parseSetValues(data: unknown): SetValue[] {
  if (!data) return [];
  const obj = data as Record<string, unknown>;
  const plc = obj.plc as Record<string, unknown>;
  if (!plc) return [];
  let values = plc.setValue;
  if (!values) return [];
  if (!Array.isArray(values)) values = [values];

  // 16777215 = 0xFFFFFF (white) — used as default when XML attribute is missing
  const WHITE = 16777215;
  return (values as Array<Record<string, unknown>>).map((sv) => ({
    description: str(sv.description),
    status: mapValueStatus(num(sv.status)),
    value: str(sv.value),
    dataType: num(sv.dataType),
    unit: str(sv.unit),
    precision: num(sv.precision),
    rowNumber: num(sv.rowNumber),
    textColorDescription: num(sv.textColorDescription, 0),
    backColorDescription: num(sv.backColorDescription, WHITE),
    textColorUnit: num(sv.textColorUnit, 0),
    backColorUnit: num(sv.backColorUnit, WHITE),
    textColorValue: num(sv.textColorValue, 0),
    backColorValue: num(sv.backColorValue, WHITE),
  }));
}

function parseActualValues(data: unknown): ActualValue[] {
  if (!data) return [];
  const obj = data as Record<string, unknown>;
  const plc = obj.plc as Record<string, unknown>;
  if (!plc) return [];
  let values = plc.actualValue;
  if (!values) return [];
  if (!Array.isArray(values)) values = [values];

  const WHITE = 16777215;
  return (values as Array<Record<string, unknown>>).map((av) => ({
    description: str(av.description),
    status: mapValueStatus(num(av.status)),
    value: str(av.value),
    dataType: num(av.dataType),
    unit: str(av.unit),
    precision: num(av.precision),
    rowNumber: num(av.rowNumber),
    textColorDescription: num(av.textColorDescription, 0),
    backColorDescription: num(av.backColorDescription, WHITE),
    textColorUnit: num(av.textColorUnit, 0),
    backColorUnit: num(av.backColorUnit, WHITE),
    textColorValue: num(av.textColorValue, 0),
    backColorValue: num(av.backColorValue, WHITE),
  }));
}

/**
 * Parses a single XML string into an ImportedFile.
 */
export function parseXmlString(xmlString: string, filename: string): ImportedFile {
  const parsed = xmlParser.parse(xmlString);
  const data = parsed.data || parsed;
  const body = data.body || data;
  const header = data.header || body;

  const fileId = crypto.randomUUID();

  return {
    id: fileId,
    filename,
    header: parseHeader(header),
    curves: parseCurves(body.curves, fileId),
    setValues: parseSetValues(body.setValues),
    actualValues: parseActualValues(body.actualValues),
    importedAt: Date.now(),
  };
}
