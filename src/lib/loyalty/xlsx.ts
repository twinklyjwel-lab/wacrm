// ============================================================
// Minimal .xlsx reader — first worksheet → grid of cells.
//
// Billing software (Vasy ERP among them) writes .xlsx zips with
// streamed entries that some unzip libraries reject ("invalid
// signature"). fflate reads them fine, so we unzip with it and parse
// the sheet XML ourselves. Pure + browser-safe; no DOMParser needed.
// ============================================================

import { strFromU8, unzipSync } from 'fflate';

import type { Cell } from './import';

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code =
        e[1] === 'x' || e[1] === 'X'
          ? parseInt(e.slice(2), 16)
          : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Concatenate every <t> run inside an <si> / <is> element. */
function textRuns(xml: string): string {
  let out = '';
  for (const m of xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) out += m[1];
  return decode(out);
}

/** "AB" → 27 (0-based column index). */
export function columnIndex(ref: string): number {
  const letters = /^[A-Z]+/i.exec(ref)?.[0].toUpperCase() ?? '';
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function attr(tag: string, name: string): string | null {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  return m ? m[1] : null;
}

function firstSheetPath(files: Record<string, Uint8Array>): string | null {
  const wb = files['xl/workbook.xml'];
  const rels = files['xl/_rels/workbook.xml.rels'];
  if (wb && rels) {
    const sheet = /<sheet\s[^>]*>/.exec(strFromU8(wb))?.[0];
    const rid = sheet ? attr(sheet, 'r:id') : null;
    if (rid) {
      for (const rel of strFromU8(rels).matchAll(/<Relationship\s[^>]*>/g)) {
        if (attr(rel[0], 'Id') === rid) {
          const target = attr(rel[0], 'Target') ?? '';
          const path = target.startsWith('/')
            ? target.slice(1)
            : `xl/${target}`;
          if (files[path]) return path;
        }
      }
    }
  }
  if (files['xl/worksheets/sheet1.xml']) return 'xl/worksheets/sheet1.xml';
  return (
    Object.keys(files).find((k) => /^xl\/worksheets\/[^/]+\.xml$/.test(k)) ??
    null
  );
}

export class XlsxReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'XlsxReadError';
  }
}

/** Read the first worksheet of an .xlsx file into rows of cells. */
export function readXlsxRows(bytes: Uint8Array): Cell[][] {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new XlsxReadError('Not a valid .xlsx file');
  }
  const sheetPath = firstSheetPath(files);
  if (!sheetPath) throw new XlsxReadError('The workbook has no worksheet');

  const shared: string[] = [];
  const sst = files['xl/sharedStrings.xml'];
  if (sst) {
    for (const m of strFromU8(sst).matchAll(/<si>([\s\S]*?)<\/si>/g))
      shared.push(textRuns(m[1]));
  }

  const xml = strFromU8(files[sheetPath]);
  const rows: Cell[][] = [];
  for (const rowMatch of xml.matchAll(
    /<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g
  )) {
    const body = rowMatch[1] ?? '';
    const row: Cell[] = [];
    let next = 0;
    for (const c of body.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const tag = `<c${c[1]}>`;
      const inner = c[2] ?? '';
      const ref = attr(tag, 'r');
      const idx = ref ? columnIndex(ref) : next;
      next = idx + 1;
      const type = attr(tag, 't');
      const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
      let value: Cell = null;
      if (type === 'inlineStr') value = textRuns(inner);
      else if (type === 's')
        value = v !== undefined ? (shared[Number(v)] ?? null) : null;
      else if (type === 'str' || type === 'e')
        value = v !== undefined ? decode(v) : null;
      else if (type === 'b') value = v === '1';
      else if (v !== undefined && v !== '') {
        const n = Number(v);
        value = Number.isFinite(n) ? n : decode(v);
      }
      while (row.length < idx) row.push(null);
      row[idx] = typeof value === 'string' ? value.trim() : value;
    }
    if (row.some((x) => x !== null && x !== '')) rows.push(row);
  }
  return rows;
}
