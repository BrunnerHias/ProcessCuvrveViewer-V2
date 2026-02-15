// ============================================================
// Parse Worker — runs in a worker_thread for parallel file parsing
// Receives file paths, reads + decompresses + parses, returns ImportedFile objects
// ============================================================

const { parentPort } = require('worker_threads');
const fs = require('fs');
const path = require('path');
const { XMLParser } = require('fast-xml-parser');
const { unzipSync, strFromU8 } = require('fflate');
const crypto = require('crypto');

// ── XML Parser (mirrors src/services/xmlParser.ts) ──────────

const parserOptions = {
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseAttributeValue: false,
  trimValues: true,
  parseTagValue: false,
  stopNodes: ['*.points'],
  isArray: (_name, _jpath) => {
    const arrayPaths = [
      'data.body.curves.curve',
      'data.body.setValues.plc.setValue',
      'data.body.actualValues.plc.actualValue',
    ];
    if (arrayPaths.includes(_jpath)) return true;
    if (_jpath.endsWith('.linegroup') || _jpath.endsWith('.windowgroup') || _jpath.endsWith('.circlegroup')) return true;
    if (_jpath.endsWith('.lines.line') || _jpath.endsWith('.windows.window') || _jpath.endsWith('.circles.circle')) return true;
    return false;
  },
};

const xmlParser = new XMLParser(parserOptions);

function str(val) {
  if (val === undefined || val === null) return '';
  return String(val);
}

function num(val, fallback = 0) {
  if (val === undefined || val === null) return fallback;
  const n = Number(val);
  return isNaN(n) ? fallback : n;
}

function bool(val, fallback = false) {
  if (val === undefined || val === null) return fallback;
  if (typeof val === 'boolean') return val;
  return String(val).toLowerCase() === 'true';
}

function mapValueStatus(rawStatus) {
  if (rawStatus === 0) return 501;
  if (rawStatus === 1) return 256;
  if (rawStatus === 2) return 502;
  return rawStatus;
}

function parseHeader(body) {
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

function parsePoints(curve) {
  const noOfPoints = num(curve.noOfPoints, 0);
  if (noOfPoints === 0 || !curve.points) {
    return { x: [], y: [], count: 0 };
  }
  const raw = typeof curve.points === 'string' ? curve.points : '';
  if (!raw) {
    return { x: [], y: [], count: 0 };
  }
  const xArr = new Array(noOfPoints);
  const yArr = new Array(noOfPoints);
  const regex = /x="([^"]+)"\s+y="([^"]+)"/g;
  let match;
  let i = 0;
  while ((match = regex.exec(raw)) !== null && i < noOfPoints) {
    xArr[i] = +match[1];
    yArr[i] = +match[2];
    i++;
  }
  if (i !== noOfPoints) {
    xArr.length = i;
    yArr.length = i;
  }
  return { x: xArr, y: yArr, count: i };
}

function parseLineGroups(linesData) {
  if (!linesData) return [];
  const plc = linesData.plc;
  if (!plc) return [];
  let groups = plc.linegroup;
  if (!groups) return [];
  if (!Array.isArray(groups)) groups = [groups];
  return groups.map((grp) => {
    let lineItems = [];
    const linesContainer = grp.lines;
    if (linesContainer) {
      const lineArray = linesContainer.line;
      if (lineArray) lineItems = Array.isArray(lineArray) ? lineArray : [lineArray];
    }
    return {
      description: str(grp.description),
      groupDescription: str(grp.groupDescription),
      color: num(grp.color),
      thickness: num(grp.thickness, 1),
      style: num(grp.style, 1),
      lines: lineItems.map((line) => {
        const sp = line['start-point'];
        const ep = line['end-point'];
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

function parseWindowGroups(windowsData) {
  if (!windowsData) return [];
  const plc = windowsData.plc;
  if (!plc) return [];
  let groups = plc.windowgroup;
  if (!groups) return [];
  if (!Array.isArray(groups)) groups = [groups];
  return groups.map((grp) => {
    let windowItems = [];
    const wc = grp.windows;
    if (wc) {
      const wa = wc.window;
      if (wa) windowItems = Array.isArray(wa) ? wa : [wa];
    }
    return {
      description: str(grp.description),
      groupDescription: str(grp.groupDescription),
      color: num(grp.color),
      thickness: num(grp.thickness, 1),
      style: num(grp.style, 1),
      isFilled: bool(grp.isFilled),
      windows: windowItems.map((win) => {
        const p1 = win.point1;
        const p2 = win.point2;
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

function parseCircleGroups(circlesData) {
  if (!circlesData) return [];
  const plc = circlesData.plc;
  if (!plc) return [];
  let groups = plc.circlegroup;
  if (!groups) return [];
  if (!Array.isArray(groups)) groups = [groups];
  return groups.map((grp) => {
    let circleItems = [];
    const cc = grp.circles;
    if (cc) {
      const ca = cc.circle;
      if (ca) circleItems = Array.isArray(ca) ? ca : [ca];
    }
    return {
      description: str(grp.description),
      groupDescription: str(grp.groupDescription),
      color: num(grp.color),
      thickness: num(grp.thickness, 1),
      style: num(grp.style, 1),
      isFilled: bool(grp.isFilled),
      circles: circleItems.map((circ) => {
        const cp = circ['center-point'];
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

function parseGraphicElements(curve) {
  return {
    lineGroups: parseLineGroups(curve.lines),
    windowGroups: parseWindowGroups(curve.windows),
    circleGroups: parseCircleGroups(curve.circles),
  };
}

function parseCoordSystem(curve) {
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

function parseCurves(curves, fileId) {
  if (!curves) return [];
  let curveArray = curves.curve;
  if (!curveArray) return [];
  if (!Array.isArray(curveArray)) curveArray = [curveArray];
  return curveArray.map((curve) => {
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
      // Use plain arrays (not Float64Array) for structured-clone IPC transfer
      pointsX: points.x,
      pointsY: points.y,
      noOfPoints: points.count,
      graphicElements: parseGraphicElements(curve),
    };
  });
}

const WHITE = 16777215;

function parseSetValues(data) {
  if (!data) return [];
  const plc = data.plc;
  if (!plc) return [];
  let values = plc.setValue;
  if (!values) return [];
  if (!Array.isArray(values)) values = [values];
  return values.map((sv) => ({
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

function parseActualValues(data) {
  if (!data) return [];
  const plc = data.plc;
  if (!plc) return [];
  let values = plc.actualValue;
  if (!values) return [];
  if (!Array.isArray(values)) values = [values];
  return values.map((av) => ({
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

function parseXmlString(xmlString, filename) {
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

// ── ZPG extraction ──────────────────────────────────────────

function extractXmlFromZpg(buffer) {
  const data = new Uint8Array(buffer);
  const unzipped = unzipSync(data);
  const xmlKey = Object.keys(unzipped).find(
    (name) => name.toLowerCase().endsWith('.xml')
  );
  if (!xmlKey) throw new Error('No XML file found in ZPG archive');
  return strFromU8(unzipped[xmlKey]);
}

// ── Message handler ─────────────────────────────────────────

parentPort.on('message', (msg) => {
  if (msg.type === 'parse-files') {
    const results = [];
    for (const filePath of msg.filePaths) {
      try {
        const name = path.basename(filePath);
        if (name.startsWith('~')) { results.push(null); continue; }
        const ext = path.extname(filePath).toLowerCase();
        const buffer = fs.readFileSync(filePath);

        let xmlString;
        if (ext === '.zpg') {
          const ab = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
          xmlString = extractXmlFromZpg(ab);
        } else {
          xmlString = buffer.toString('utf-8');
        }
        const parsed = parseXmlString(xmlString, name);
        results.push(parsed);
      } catch (err) {
        // Skip failed files
        results.push(null);
      }
    }
    parentPort.postMessage({ type: 'parse-result', requestId: msg.requestId, results });
  }
});
