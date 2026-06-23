#!/usr/bin/env python3
"""Minimal OpenAI-compatible adapter for the TaishanPi RKLLM Qwen-VL demo.

This first version intentionally serializes requests and shells out to the
vendor demo. It is good enough for LinkBox edge-mode validation, and can later
be replaced by a resident RKLLM runtime server without changing LinkBox.
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import pty
import re
import select
import signal
import sqlite3
import subprocess
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Lock
from urllib.parse import urlparse


HOST = os.environ.get("RKLLM_ADAPTER_HOST", "127.0.0.1")
PORT = int(os.environ.get("RKLLM_ADAPTER_PORT", "8000"))
MODEL_ID = os.environ.get("RKLLM_MODEL_ID", "qwen3-vl-2b-rk3576")
MODEL_DIR = Path(os.environ.get("RKLLM_MODEL_DIR", "/home/lckfb/ai/qwen3-vl-2b"))
DEMO_BIN = MODEL_DIR / "demo_Linux_aarch64" / "demo"
DEFAULT_IMAGE = MODEL_DIR / "demo_Linux_aarch64" / "demo.jpg"
VISION_MODEL = MODEL_DIR / "qwen3-vl-2b_vision_rk3576.rknn"
LLM_MODEL = MODEL_DIR / "qwen3-vl-2b-instruct_w4a16_g128_rk3576.rkllm"
LIB_DIR = MODEL_DIR / "demo_Linux_aarch64" / "lib"
MAX_NEW_TOKENS = os.environ.get("QWEN_VL_MAX_NEW_TOKENS", "256")
CONTEXT = os.environ.get("QWEN_VL_CONTEXT", "3072")
RKNN_CORES = os.environ.get("QWEN_VL_RKNN_CORES", "1")
REQUEST_TIMEOUT = int(os.environ.get("RKLLM_REQUEST_TIMEOUT", "90"))
BOOT_TIMEOUT = int(os.environ.get("RKLLM_BOOT_TIMEOUT", "45"))
TMP_DIR = Path(os.environ.get("RKLLM_ADAPTER_TMP", "/tmp/rkllm-openai-adapter"))
CACHE_DB = Path(os.environ.get("RKLLM_CACHE_DB", "/var/lib/rkllm-openai-adapter/cache.sqlite"))

REQUEST_LOCK = Lock()
IMAGE_ANSWER_CACHE: dict[str, str] = {}
MAX_IMAGE_CACHE_ITEMS = int(os.environ.get("RKLLM_IMAGE_CACHE_ITEMS", "128"))
STARTED_AT = time.time()
STATS = {
    "requests_total": 0,
    "chat_requests": 0,
    "failures_total": 0,
    "memory_cache_hits": 0,
    "persistent_cache_hits": 0,
    "demo_restarts": 0,
    "last_latency_ms": None,
    "last_error": "",
}


def json_response(handler: BaseHTTPRequestHandler, status: int, payload: dict) -> None:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def sse_response(handler: BaseHTTPRequestHandler, model: str, answer: str) -> None:
    handler.send_response(200)
    handler.send_header("Content-Type", "text/event-stream; charset=utf-8")
    handler.send_header("Cache-Control", "no-cache")
    handler.end_headers()

    created = int(time.time())
    chunk = {
        "id": f"chatcmpl-{uuid.uuid4().hex}",
        "object": "chat.completion.chunk",
        "created": created,
        "model": model,
        "choices": [{
            "index": 0,
            "delta": {"content": answer},
            "finish_reason": None,
        }],
    }
    done = {
        "id": chunk["id"],
        "object": "chat.completion.chunk",
        "created": created,
        "model": model,
        "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}],
    }
    for payload in [chunk, done]:
        handler.wfile.write(f"data: {json.dumps(payload, ensure_ascii=False)}\n\n".encode("utf-8"))
    handler.wfile.write(b"data: [DONE]\n\n")


def read_json(handler: BaseHTTPRequestHandler) -> dict:
    length = int(handler.headers.get("Content-Length", "0") or "0")
    raw = handler.rfile.read(length)
    if not raw:
        return {}
    return json.loads(raw.decode("utf-8"))


def init_cache_db() -> None:
    CACHE_DB.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(CACHE_DB) as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS image_answer_cache (
              image_key TEXT NOT NULL,
              prompt_hash TEXT NOT NULL,
              model TEXT NOT NULL,
              answer TEXT NOT NULL,
              created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              last_hit_at TEXT,
              hits INTEGER NOT NULL DEFAULT 0,
              PRIMARY KEY (image_key, prompt_hash, model)
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_image_answer_cache_created ON image_answer_cache(created_at)")


def cache_count() -> int:
    try:
        with sqlite3.connect(CACHE_DB) as conn:
            row = conn.execute("SELECT COUNT(*) FROM image_answer_cache").fetchone()
            return int(row[0] or 0)
    except Exception:
        return 0


def persistent_cache_get(image_key: str, prompt_hash: str) -> str | None:
    try:
        with sqlite3.connect(CACHE_DB) as conn:
            row = conn.execute(
                "SELECT answer FROM image_answer_cache WHERE image_key = ? AND prompt_hash = ? AND model = ?",
                (image_key, prompt_hash, MODEL_ID),
            ).fetchone()
            if not row:
                return None
            conn.execute(
                """
                UPDATE image_answer_cache
                SET hits = hits + 1, last_hit_at = CURRENT_TIMESTAMP
                WHERE image_key = ? AND prompt_hash = ? AND model = ?
                """,
                (image_key, prompt_hash, MODEL_ID),
            )
            STATS["persistent_cache_hits"] += 1
            return str(row[0])
    except Exception as exc:
        STATS["last_error"] = f"cache get failed: {exc}"
        return None


def persistent_cache_put(image_key: str, prompt_hash: str, answer: str) -> None:
    try:
        with sqlite3.connect(CACHE_DB) as conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO image_answer_cache
                  (image_key, prompt_hash, model, answer, created_at, last_hit_at, hits)
                VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, NULL, 0)
                """,
                (image_key, prompt_hash, MODEL_ID, answer),
            )
    except Exception as exc:
        STATS["last_error"] = f"cache put failed: {exc}"


def message_text_and_image(messages: list[dict]) -> tuple[str, Path]:
    parts: list[str] = []
    image_path = DEFAULT_IMAGE

    for message in messages:
        role = message.get("role", "user")
        content = message.get("content", "")
        prefix = "" if role == "user" else f"{role}: "

        if isinstance(content, str):
            if content.strip():
                parts.append(prefix + content.strip())
            continue

        if isinstance(content, list):
            for item in content:
                item_type = item.get("type")
                if item_type == "text" and item.get("text"):
                    parts.append(prefix + str(item["text"]).strip())
                elif item_type == "image_url":
                    url = item.get("image_url", {}).get("url", "")
                    saved = save_data_url(url)
                    if saved:
                        image_path = saved

    prompt = "\n\n".join(part for part in parts if part).strip()
    if image_path != DEFAULT_IMAGE and "<image>" not in prompt:
        prompt = "<image>\n" + prompt
    return prompt or "请用一句话介绍你自己。", image_path


def save_data_url(url: str) -> Path | None:
    match = re.match(r"^data:([^;,]+)?(;base64)?,(.*)$", url, re.S)
    if not match or not match.group(2):
        return None
    mime = match.group(1) or "image/jpeg"
    ext = {
        "image/png": ".png",
        "image/gif": ".gif",
        "image/webp": ".webp",
        "image/jpeg": ".jpg",
        "image/jpg": ".jpg",
    }.get(mime.lower(), ".jpg")
    image_bytes = base64.b64decode(match.group(3))
    digest = hashlib.sha256(image_bytes).hexdigest()
    TMP_DIR.mkdir(parents=True, exist_ok=True)
    path = TMP_DIR / f"image-{digest}{ext}"
    if not path.exists():
        path.write_bytes(image_bytes)
    return path


def run_rkllm(prompt: str, image_path: Path) -> str:
    if image_path != DEFAULT_IMAGE:
        image_key = image_path.name
        prompt_hash = hashlib.sha256(prompt.encode("utf-8")).hexdigest()
        cache_key = f"{image_key}:{prompt_hash}"
        cached = IMAGE_ANSWER_CACHE.get(cache_key)
        if cached is not None:
            STATS["memory_cache_hits"] += 1
            return cached
        cached = persistent_cache_get(image_key, prompt_hash)
        if cached is not None:
            IMAGE_ANSWER_CACHE[cache_key] = cached
            return cached
        answer = RESIDENT_DEMO.ask(prompt, image_path)
        if len(IMAGE_ANSWER_CACHE) >= MAX_IMAGE_CACHE_ITEMS:
            IMAGE_ANSWER_CACHE.pop(next(iter(IMAGE_ANSWER_CACHE)))
        IMAGE_ANSWER_CACHE[cache_key] = answer
        persistent_cache_put(image_key, prompt_hash, answer)
        return answer
    return RESIDENT_DEMO.ask(prompt, image_path)


def demo_cmd(image_path: Path) -> list[str]:
    return [
        str(DEMO_BIN),
        str(image_path),
        str(VISION_MODEL),
        str(LLM_MODEL),
        str(MAX_NEW_TOKENS),
        str(CONTEXT),
        str(RKNN_CORES),
    ]


def demo_env() -> dict:
    env = os.environ.copy()
    env["LD_LIBRARY_PATH"] = f"{LIB_DIR}:{env.get('LD_LIBRARY_PATH', '')}"
    return env


class ResidentDemo:
    def __init__(self) -> None:
        self.proc: subprocess.Popen | None = None
        self.master_fd: int | None = None
        self.booted = False
        self.image_path: Path | None = None

    def start(self, image_path: Path = DEFAULT_IMAGE) -> None:
        image_path = image_path.resolve()
        if (
            self.proc
            and self.proc.poll() is None
            and self.master_fd is not None
            and self.booted
            and self.image_path == image_path
        ):
            return
        self.stop()
        STATS["demo_restarts"] += 1
        master_fd, slave_fd = pty.openpty()
        self.proc = subprocess.Popen(
            demo_cmd(image_path),
            cwd=str(MODEL_DIR),
            stdin=slave_fd,
            stdout=slave_fd,
            stderr=slave_fd,
            env=demo_env(),
            close_fds=True,
        )
        os.close(slave_fd)
        self.master_fd = master_fd
        boot_output = self._read_until_prompt(BOOT_TIMEOUT)
        self.image_path = image_path
        self.booted = True
        print(f"resident demo booted for {image_path}, {len(boot_output)} chars", flush=True)

    def stop(self) -> None:
        if self.master_fd is not None:
            try:
                os.close(self.master_fd)
            except OSError:
                pass
            self.master_fd = None
        if self.proc and self.proc.poll() is None:
            try:
                self.proc.terminate()
                self.proc.wait(timeout=3)
            except Exception:
                try:
                    os.kill(self.proc.pid, signal.SIGKILL)
                except Exception:
                    pass
        self.proc = None
        self.booted = False
        self.image_path = None

    def ask(self, prompt: str, image_path: Path = DEFAULT_IMAGE) -> str:
        with REQUEST_LOCK:
            self.start(image_path)
            assert self.master_fd is not None
            os.write(self.master_fd, (prompt + "\n").encode("utf-8"))
            try:
                output = self._read_until_prompt(REQUEST_TIMEOUT)
            except Exception:
                self.stop()
                raise
        return extract_first_answer(output)

    def _read_until_prompt(self, timeout: int) -> str:
        assert self.master_fd is not None
        output = ""
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            ready, _, _ = select.select([self.master_fd], [], [], 0.2)
            if not ready:
                if self.proc and self.proc.poll() is not None:
                    raise RuntimeError("RKLLM resident demo exited unexpectedly")
                continue
            chunk = os.read(self.master_fd, 8192).decode("utf-8", errors="replace")
            output += chunk
            if re.search(r"\nuser:\s*$", output):
                return output
        raise TimeoutError("RKLLM resident demo timed out waiting for prompt")


def extract_first_answer(output: str) -> str:
    normalized = output.replace("\r\n", "\n")
    matches = list(re.finditer(r"robot:\s*(.*?)(?:\n\s*\nuser:\s*$|\Z)", normalized, re.S))
    match = matches[-1] if matches else None
    if not match:
        raise RuntimeError("RKLLM demo did not produce a parseable robot answer")
    text = match.group(1).strip()
    return re.sub(r"\s+\Z", "", text)


class Handler(BaseHTTPRequestHandler):
    server_version = "rkllm-openai-adapter/0.1"

    def log_message(self, fmt: str, *args) -> None:
        print(f"{self.address_string()} - {fmt % args}", flush=True)

    def do_GET(self) -> None:
        STATS["requests_total"] += 1
        path = urlparse(self.path).path
        if path == "/v1/models":
            json_response(self, 200, {
                "object": "list",
                "data": [{"id": MODEL_ID, "object": "model", "owned_by": "taishanpi"}],
            })
            return
        if path in {"/health", "/v1/health"}:
            json_response(self, 200, {
                "ok": True,
                "model": MODEL_ID,
                "uptime_seconds": round(time.time() - STARTED_AT, 1),
                "adapter_pid": os.getpid(),
                "resident": {
                    "ready": bool(RESIDENT_DEMO.booted),
                    "demo_pid": RESIDENT_DEMO.proc.pid if RESIDENT_DEMO.proc else None,
                    "image_path": str(RESIDENT_DEMO.image_path) if RESIDENT_DEMO.image_path else "",
                    "is_default_image": RESIDENT_DEMO.image_path == DEFAULT_IMAGE.resolve(),
                },
                "cache": {
                    "db_path": str(CACHE_DB),
                    "persistent_items": cache_count(),
                    "memory_items": len(IMAGE_ANSWER_CACHE),
                    "memory_cache_hits": STATS["memory_cache_hits"],
                    "persistent_cache_hits": STATS["persistent_cache_hits"],
                },
                "stats": STATS,
            })
            return
        json_response(self, 404, {"error": "not found"})

    def do_POST(self) -> None:
        STATS["requests_total"] += 1
        path = urlparse(self.path).path
        if path != "/v1/chat/completions":
            json_response(self, 404, {"error": "not found"})
            return

        try:
            started = time.monotonic()
            STATS["chat_requests"] += 1
            payload = read_json(self)
            prompt, image_path = message_text_and_image(payload.get("messages") or [])
            answer = run_rkllm(prompt, image_path)
            STATS["last_latency_ms"] = round((time.monotonic() - started) * 1000, 1)
            STATS["last_error"] = ""
            model = payload.get("model") or MODEL_ID
            if payload.get("stream"):
                sse_response(self, model, answer)
                return
            now = int(time.time())
            json_response(self, 200, {
                "id": f"chatcmpl-{uuid.uuid4().hex}",
                "object": "chat.completion",
                "created": now,
                "model": model,
                "choices": [{
                    "index": 0,
                    "message": {"role": "assistant", "content": answer},
                    "finish_reason": "stop",
                }],
                "usage": {
                    "prompt_tokens": 0,
                    "completion_tokens": 0,
                    "total_tokens": 0,
                },
            })
        except Exception as exc:
            STATS["failures_total"] += 1
            STATS["last_error"] = str(exc)
            json_response(self, 500, {"error": str(exc)})


def main() -> None:
    missing = [path for path in [DEMO_BIN, DEFAULT_IMAGE, VISION_MODEL, LLM_MODEL] if not path.exists()]
    if missing:
        raise SystemExit(f"missing RKLLM files: {', '.join(map(str, missing))}")
    init_cache_db()
    RESIDENT_DEMO.start()
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"rkllm-openai-adapter listening on http://{HOST}:{PORT}/v1", flush=True)
    server.serve_forever()


RESIDENT_DEMO = ResidentDemo()


if __name__ == "__main__":
    main()
