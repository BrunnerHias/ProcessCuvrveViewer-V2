// ============================================================
// ZPG Handler - Extract XML from .zpg files (ZIP format)
// Uses fflate for high-performance synchronous decompression
// ============================================================

import { unzipSync, strFromU8 } from 'fflate';

/**
 * Extracts the XML content from a .zpg file (which is a ZIP archive).
 * Returns the first .xml file found inside the archive.
 * Uses synchronous fflate decompression (3-10× faster than JSZip).
 */
export function extractXmlFromZpg(arrayBuffer: ArrayBuffer): string {
  const data = new Uint8Array(arrayBuffer);
  const unzipped = unzipSync(data);

  // Find the first .xml file in the archive
  const xmlKey = Object.keys(unzipped).find(
    (name) => name.toLowerCase().endsWith('.xml')
  );

  if (!xmlKey) {
    throw new Error('No XML file found in ZPG archive');
  }

  return strFromU8(unzipped[xmlKey]);
}

/**
 * Checks if a filename has .zpg extension.
 */
/** Check if filename is a temp/lock file (e.g. ~$file.zpg created by Office/OS) */
function isTempFile(filename: string): boolean {
  const base = filename.split(/[\\/]/).pop() || filename;
  return base.startsWith('~$') || base.startsWith('~');
}

export function isZpgFile(filename: string): boolean {
  return filename.toLowerCase().endsWith('.zpg') && !isTempFile(filename);
}

/**
 * Checks if a filename has .xml extension.
 */
export function isXmlFile(filename: string): boolean {
  return filename.toLowerCase().endsWith('.xml') && !isTempFile(filename);
}
