# ADR 0002: Overwrite Canonical Markdown Per Item And Parser Version

Date: 2026-06-25

## Status

Accepted until audit or rollback becomes a product requirement

## Context

LinkBox turns saved items into canonical Markdown documents, then chunks and
indexes those documents for Assistant retrieval. A future append-only document
version table could preserve every parser output and support rollback or
reproducible historical AI answers.

Today the product need is a current, useful knowledge base. Adding document
history would increase schema, UI, indexing, and cleanup complexity.

## Decision

Keep the current overwrite-in-place behavior for canonical documents keyed by
item and parser version.

Do not add `document_versions` until there is a clear product need for audit,
rollback, or reproducible historical Assistant answers.

## Consequences

- Reindexing and repair flows stay simple.
- The current document is the only retrieval target for an item/parser version.
- Older parser outputs are not preserved.
- If versioning is needed later, add it as a new migration and keep the current
  `documents` table as the latest-version read model.
