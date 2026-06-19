import test from 'node:test';
import assert from 'node:assert/strict';
import { consistencyIssueTotal, issueSampleLabel } from './documentMaintenanceUtils.ts';

test('consistencyIssueTotal sums missing canonical storage counts', () => {
  assert.equal(consistencyIssueTotal({
    consistency: {
      missing_documents: { count: 2, samples: [] },
      missing_content_rows: { count: 3, samples: [] },
      missing_asset_rows: { count: 5, samples: [] },
    },
  }), 10);
});

test('issueSampleLabel includes asset details when present', () => {
  assert.equal(
    issueSampleLabel({
      id: 42,
      type: 'file',
      title: 'Report',
      kind: 'thumbnail',
      public_path: '/uploads/thumb.png',
    }),
    '#42 Report · thumbnail /uploads/thumb.png',
  );
});
