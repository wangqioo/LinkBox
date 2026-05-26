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
```

## Adapter limits

The adapter is intentionally first-version:

- OpenAI-compatible streaming is emulated by returning one SSE delta after the
  vendor demo finishes
- one RKLLM request at a time
- keeps one default-image vendor demo process resident for text requests, so the
  RKLLM model is loaded once at service startup
- parses each answer between `robot:` and the next `user:` prompt
- supports OpenAI-style base64 `image_url` by writing a temporary image file;
  image requests still use a one-shot demo process because the demo binds the
  image path at startup

A production-quality version should replace the shell-out path with a resident
RKLLM runtime process.
