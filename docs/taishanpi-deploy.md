# LinkBox on TaishanPi RK3576

This deployment runs LinkBox natively with systemd and connects AI features to
the board-local Qwen3-VL-2B RKLLM/RKNN demo through a small OpenAI-compatible
adapter.

## Why native instead of Docker

Docker is not ruled out by memory alone. On this 4 GB RK3576 board, the first
version is simpler and more reliable as a native systemd deployment because
Docker is not installed yet, image builds are slow on-board, and native Node
modules such as `better-sqlite3` add avoidable build friction inside containers.

## Services

- LinkBox: `http://0.0.0.0:3100`
- RKLLM adapter: `http://127.0.0.1:8000/v1`
- Data directory: `/var/lib/linkbox`
- App checkout: `/opt/linkbox`

## Edge-mode environment

Use smaller assistant defaults than a desktop/server deployment:

```sh
PORT=3100
DATA_DIR=/var/lib/linkbox
UPLOADS_DIR=/var/lib/linkbox/uploads
DB_PATH=/var/lib/linkbox/linkbox.db
LOCAL_LLM_URL=http://127.0.0.1:8000/v1
LOCAL_LLM_MODEL=qwen3-vl-2b-rk3576
LOCAL_VISION_MODEL=qwen3-vl-2b-rk3576
ASSISTANT_MAX_SOURCES=4
ASSISTANT_MAX_CONTEXT_CHARS=6000
ASSISTANT_MAX_FIELD_CHARS=2500
ASSISTANT_MAX_TOKENS=400
BACKGROUND_QUEUE_CONCURRENCY=1
JWT_SECRET=<generate a local random secret>
```

## Adapter limits

The adapter is intentionally first-version:

- OpenAI-compatible streaming is emulated by returning one SSE delta after the
  vendor demo finishes
- one RKLLM request at a time
- keeps one vendor demo process resident for the current image path, so text
  requests and repeated requests for the same image avoid reloading RKLLM
- parses each answer between `robot:` and the next `user:` prompt
- supports OpenAI-style base64 `image_url` by writing a temporary image file;
  switching to a different image restarts the resident demo because the vendor
  demo binds the image path at startup
- caches image answers by image hash and prompt, avoiding repeated inference
  drift from the vendor demo's retained chat history

A production-quality version should replace the shell-out path with a resident
RKLLM runtime process.

## Current runtime improvements

- LinkBox background import/image/file work is serialized by
  `BACKGROUND_QUEUE_CONCURRENCY=1` so a small RK3576 board does not run several
  AI jobs at once.
- LinkBox stores background enrichment jobs in SQLite. Jobs left in `running`
  during a process restart are returned to `queued` on startup, so link
  extraction, file conversion, image description, and AI summarization are not
  lost just because the service restarts.
- Admin users can inspect LinkBox queue counts and the latest failed job through
  `/api/settings/system`.
- The adapter exposes `/health` and `/v1/health` with resident demo PID,
  currently bound image, cache counts, request counters, last latency, and last
  error.
- Image answers are cached in SQLite at
  `/var/lib/rkllm-openai-adapter/cache.sqlite`, so repeated image descriptions
  survive adapter restarts.

## Backups

Install the backup helper and timer on the board:

```sh
install -m 0755 deploy/taishanpi/linkbox-backup /usr/local/bin/linkbox-backup
install -m 0644 deploy/taishanpi/linkbox-backup.service /etc/systemd/system/
install -m 0644 deploy/taishanpi/linkbox-backup.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now linkbox-backup.timer
```

Backups are written to `/var/backups/linkbox` and retained for 14 days by
default.

## Runtime checks

Useful checks on the board:

```sh
systemctl is-active linkbox rkllm-openai-adapter linkbox-backup.timer
curl -s http://127.0.0.1:3100/api/settings/system
curl -s http://127.0.0.1:8000/v1/health
systemctl list-timers linkbox-backup.timer --no-pager
journalctl -u linkbox -u rkllm-openai-adapter -n 80 --no-pager
```

## RKLLM/RKNN SDK status

The deployed model package currently contains the compiled demo and runtime
libraries, but no headers, C/C++ sources, Python binding, or CMake examples.
That blocks replacing the vendor demo wrapper with a true RKLLM/RKNN API server
inside this repo. The next step for that work is obtaining the vendor SDK files
for `librkllmrt` and `librknnrt` integration.
