# ADR 0003: Retire Legacy Item Compatibility In Gates

Date: 2026-06-25

## Status

Accepted

## Context

The original item model stores many concerns in `links`: source metadata,
content, extracted Markdown, summaries, HTML notes, upload paths, thumbnails,
status, and batch metadata. LinkBox now also has `item_content`, `item_assets`,
`documents`, `document_chunks`, and `document_embeddings`.

The system still dual-writes and reads some legacy fields such as
`links.content_md`, `links.image_path`, and `link_chunks` for compatibility.
Removing them too early risks breaking exports, mobile detail views, search,
Assistant retrieval, old databases, or rollback.

## Decision

Retire legacy compatibility in explicit gates rather than one broad migration.

The compatibility fields and `link_chunks` fallback can only be narrowed after:

- item presentation and mobile responses read through canonical helpers
- exports and backup/restore read through canonical helpers
- search and Assistant flows pass against canonical data
- the canonical-only browser E2E gate stays green
- existing databases have admin repair/reindex paths
- one release cycle has passed with consistency checks clean

## Consequences

- Some duplicate writes remain intentionally.
- Migration work can proceed safely in small slices.
- Documentation must state whether a path is canonical, compatibility, or
  dual-write.
- Legacy reads should be removed only when the relevant validation gate exists.
