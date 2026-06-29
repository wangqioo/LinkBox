# LinkBox Agent Instructions

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
