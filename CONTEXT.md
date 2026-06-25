# LinkBox Context

Last updated: 2026-06-25

This file defines the project vocabulary used in planning, architecture, and
agent handoffs. Prefer these terms in docs and code comments.

## Product Terms

- **Item**: Any saved unit in LinkBox. Items may originate as links, articles,
  videos, text notes, images, audio, or uploaded documents. The compatibility
  database table is still named `links`.
- **Personal library**: A user's private collection of personal-scope items.
- **Chat-scoped material**: An item uploaded inside a private or group chat.
  It is accessible from that chat and can be retrieved by the relevant group
  Assistant, but it is not shown in the normal personal feed.
- **Group material**: An item shared into a group through `group_links`, with
  optional group-specific notes and comments.
- **Canonical Markdown**: The normalized Markdown representation used as the
  knowledge source for chunking, retrieval, embeddings, and Assistant context.
- **Document**: A canonical Markdown record in `documents`, usually derived
  from one item and one parser version.
- **Document chunk**: A heading-aware, type-aware piece of a document stored in
  `document_chunks`.
- **Legacy chunk**: A row in `link_chunks`. It remains a compatibility fallback
  until canonical document retrieval is trusted enough to retire it.
- **Assistant source**: A retrieved item, document chunk, or virtual group text
  source that can be cited in an Assistant answer.
- **Processing status**: User-facing state derived from durable jobs and item
  rows. It includes stage, label, retry eligibility, error text, and recovery
  hints.
- **Recovery hint**: A short suggestion generated from the failed job type,
  such as checking document parsing tools, AI settings, vision settings, or
  embedding configuration.

## Architectural Terms

- **Modular monolith**: The chosen deployment shape. LinkBox uses one Express
  backend, one SQLite database, one React desktop client, and one Vue mobile
  client. Avoid introducing distributed infrastructure unless a concrete
  operational need appears.
- **Compatibility table**: A table kept for existing API and migration safety.
  Today `links` is the main compatibility table for future item/content/assets
  cleanup.
- **Compatibility column**: A legacy column such as `links.content_md` or
  `links.image_path` that may still be dual-written while canonical tables
  become the preferred read path.
- **Route adapter**: An Express route module whose job is HTTP shape, auth, and
  response formatting. Business behavior should move behind testable helpers
  when the route grows.
- **Feature view**: A frontend route-level view that wires state, API calls,
  and display. Large feature views should be decomposed into composables,
  hooks, and display utilities before adding new behavior.

## Current Strategic Direction

- Keep LinkBox local-first and recoverable on low-power home hardware.
- Prefer small migrations and dual-write compatibility over risky table
  rewrites.
- Prefer canonical Markdown and document chunks for AI retrieval, while keeping
  legacy fallbacks until canonical-only validation remains green.
- Keep personal and group Assistant retrieval scopes strictly isolated.
- Treat documentation, validation gates, and ADRs as part of the architecture.
