# ADR 0001: Keep LinkBox A SQLite Modular Monolith

Date: 2026-06-25

## Status

Accepted

## Context

LinkBox targets personal and small-group knowledge workflows on local or
home-server hardware. It stores private materials, runs background enrichment
jobs, serves desktop and mobile web clients, and integrates OpenAI-compatible AI
services. The current system is one Express backend, one SQLite database, one
React desktop client, and one Vue mobile client.

The project could be split into separate services for jobs, search, files,
collaboration, or AI. That would add deployment and recovery complexity before
the product needs it.

## Decision

Keep LinkBox as a SQLite-backed modular monolith.

Use modules, tests, explicit migrations, and route adapters to improve
maintainability. Do not introduce distributed infrastructure unless a concrete
operational requirement appears, such as multi-node concurrency, independent
scaling, or a storage/search workload SQLite cannot handle.

## Consequences

- Local deployment remains simple.
- Backups and rollback can remain SQLite/file-system oriented.
- Background jobs must stay durable and observable inside the same database.
- Module boundaries matter more because process boundaries will not enforce
  separation.
- Long-running AI/file tasks should remain asynchronous jobs rather than block
  item acceptance.
