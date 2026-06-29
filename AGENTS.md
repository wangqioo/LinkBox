# LinkBox Agent Instructions

## Evidence And Recency Protocol

When answering status, file-content, timing, deployment, or "latest" questions,
prefer current evidence over conversation memory.

Priority order:

1. Latest user message.
2. Facts just checked in this turn with tools.
3. Current Git, filesystem, server, and HTTP state.
4. Current project docs.
5. Older conversation context.

Required behavior:

- If the user asks to search, inspect, find, verify, or check a file, run
  `rg`, `sed`, `git grep`, or an equivalent read command before answering.
- If the user asks about time, "latest", "previous", "deployed", "done", or
  "current", check concrete state first: `date`, `git log`, `git status`,
  server paths, systemd status, logs, or HTTP probes as appropriate.
- Answers about project state should include anchors when available: file path,
  line number, commit hash, timestamp, deployment directory, rollback directory,
  or HTTP status.
- If old docs or old conversation conflict with current evidence, say so and
  use the current evidence as the answer.
- Do not answer explicit search or timing questions from memory unless the user
  explicitly asks for a rough recollection instead of verification.

## Deployment Rule

When changing LinkBox Assistant, Smart Agent, Local Agent, model routing, or
RK3576 adapter behavior, treat deployment as part of the task unless the user
explicitly says not to deploy.

Default release target for Agent-related work:

- RK3576/NanoPi-R76S LinkBox systemd deployment.
- Reach it from the Mac through the home server jump host:
  `ssh -J wq@150.158.146.192:6004 root@192.168.1.50`.
- App path: `/opt/linkbox`.
- Data path: `/var/lib/linkbox`.
- Public URL: `http://150.158.146.192:7130/`.

Deployment requirements:

- Run the relevant local tests and builds before deployment.
- Package from `/Users/wq` while excluding `.git`, dependency folders,
  databases, uploads, certs, and other persistent data.
- Build the new release in `/opt/linkbox-new` before stopping the live service.
- Back up the live release to `/opt/linkbox-prev-<timestamp>` before switching.
- Preserve `/var/lib/linkbox/linkbox.db` and `/var/lib/linkbox/uploads`.
- Verify local root, local mobile, public root, public mobile, and the changed
  Agent/API surface before reporting success.
- Keep rollback instructions and the backup path in the final report.
