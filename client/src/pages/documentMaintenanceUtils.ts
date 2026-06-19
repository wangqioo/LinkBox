import type { DocumentMaintenanceStats, StorageConsistencyIssue } from '../api/client';

export function consistencyIssueTotal(stats: DocumentMaintenanceStats | null | undefined) {
  const consistency = stats?.consistency;
  if (!consistency) return 0;
  return (
    (consistency.missing_documents?.count || 0)
    + (consistency.missing_content_rows?.count || 0)
    + (consistency.missing_asset_rows?.count || 0)
  );
}

export function issueSampleLabel(issue: StorageConsistencyIssue) {
  const base = `#${issue.id} ${issue.title || issue.type || 'Item'}`;
  if (issue.public_path) return `${base} · ${issue.kind || 'asset'} ${issue.public_path}`;
  return base;
}
