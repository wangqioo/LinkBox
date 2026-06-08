import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseSharedStrings,
  parseSheetNames,
  sheetRowsToMarkdown,
  worksheetRows,
} from '../utils/spreadsheetXmlUtils.js';

test('parseSharedStrings decodes plain shared string values', () => {
  const xml = `
    <sst>
      <si><t>名称</t></si>
      <si><t>Tom &amp; Jerry</t></si>
    </sst>
  `;

  assert.deepEqual(parseSharedStrings(xml), ['名称', 'Tom & Jerry']);
});

test('parseSheetNames decodes workbook sheet names', () => {
  const xml = `
    <workbook>
      <sheets>
        <sheet name="收入&amp;成本" sheetId="1" r:id="rId1"/>
        <sheet sheetId="2" name="Sheet 2" r:id="rId2"></sheet>
      </sheets>
    </workbook>
  `;

  assert.deepEqual(parseSheetNames(xml), ['收入&成本', 'Sheet 2']);
});

test('worksheetRows resolves inline, shared, and numeric cell values', () => {
  const xml = `
    <worksheet>
      <sheetData>
        <row r="1">
          <c t="inlineStr"><is><t>名称</t></is></c>
          <c t="s"><v>0</v></c>
          <c><v>42</v></c>
        </row>
        <row r="2">
          <c t="s"><v>1</v></c>
          <c><v></v></c>
        </row>
      </sheetData>
    </worksheet>
  `;

  assert.deepEqual(worksheetRows(xml, ['数量', '苹果']), [
    ['名称', '数量', '42'],
    ['苹果', ''],
  ]);
});

test('sheetRowsToMarkdown formats named sheets and falls back to generated names', () => {
  assert.equal(
    sheetRowsToMarkdown([['名称', '数量'], ['苹果']], '库存'),
    [
      '### 库存',
      '',
      '| 名称 | 数量 |',
      '| --- | --- |',
      '| 苹果 |  |',
    ].join('\n'),
  );

  assert.equal(
    sheetRowsToMarkdown([['A']], ''),
    [
      '### Sheet',
      '',
      '| A |',
      '| --- |',
    ].join('\n'),
  );
});
