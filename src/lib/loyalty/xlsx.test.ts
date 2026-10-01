import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';

import { columnIndex, readXlsxRows, XlsxReadError } from './xlsx';

function workbook(sheetXml: string, sharedStrings?: string): Uint8Array {
  const files: Record<string, Uint8Array> = {
    'xl/workbook.xml': strToU8(
      '<workbook xmlns:r="r"><sheets><sheet name="Sheet0" r:id="rId3" sheetId="1"/></sheets></workbook>'
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      '<Relationships><Relationship Id="rId3" Target="worksheets/data.xml" Type="x"/></Relationships>'
    ),
    'xl/worksheets/data.xml': strToU8(sheetXml),
  };
  if (sharedStrings) files['xl/sharedStrings.xml'] = strToU8(sharedStrings);
  return zipSync(files);
}

describe('columnIndex', () => {
  it('maps column letters', () => {
    expect(columnIndex('A1')).toBe(0);
    expect(columnIndex('J19')).toBe(9);
    expect(columnIndex('AB3')).toBe(27);
  });
});

describe('readXlsxRows', () => {
  it('reads inline, shared, numeric and boolean cells, keeping gaps', () => {
    const sheet = `<worksheet><sheetData>
      <row r="1"><c r="A1" t="inlineStr"><is><t>Invoice No.</t></is></c><c r="B1" t="s"><v>0</v></c></row>
      <row r="2"><c r="A2" t="inlineStr"><is><t>TJ-26-1 </t></is></c><c r="C2"><v>1700.0</v></c><c r="D2" t="b"><v>1</v></c></row>
      <row r="3"/>
      <row r="4"><c r="A4" t="inlineStr"><is><t>Gold &amp; Silver</t></is></c></row>
    </sheetData></worksheet>`;
    const rows = readXlsxRows(
      workbook(sheet, '<sst><si><t>Net Amount</t></si></sst>')
    );
    expect(rows).toEqual([
      ['Invoice No.', 'Net Amount'],
      ['TJ-26-1', null, 1700, true],
      ['Gold & Silver'],
    ]);
  });

  it('rejects non-zip input', () => {
    expect(() => readXlsxRows(strToU8('hello'))).toThrow(XlsxReadError);
  });
});
