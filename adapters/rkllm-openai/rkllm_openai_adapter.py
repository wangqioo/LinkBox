#!/usr/bin/env python3
"""Minimal OpenAI-compatible adapter for the TaishanPi RKLLM Qwen-VL demo.

This first version intentionally serializes requests and shells out to the
vendor demo. It is good enough for LinkBox edge-mode validation, and can later
be replaced by a resident RKLLM runtime server without changing LinkBox.
"""

from __future__ import annotations

import base64
import json
import os
import re
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
TMP_DIR = Path(os.environ.get("RKLLM_ADAPTER_TMP", "/tmp/rkllm-openai-adapter"))

REQUEST_LOCK = Lock()


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
    TMP_DIR.mkdir(parents=True, exist_ok=True)
    path = TMP_DIR / f"image-{uuid.uuid4().hex}{ext}"
    path.write_bytes(base64.b64decode(match.group(3)))
    return path


def run_rkllm(prompt: str, image_path: Path) -> str:
    env = os.environ.copy()
    env["LD_LIBRARY_PATH"] = f"{LIB_DIR}:{env.get('LD_LIBRARY_PATH', '')}"
    cmd = [
        str(DEMO_BIN),
        str(image_path),
        str(VISION_MODEL),
        str(LLM_MODEL),
        str(MAX_NEW_TOKENS),
        str(CONTEXT),
        str(RKNN_CORES),
    ]

    with REQUEST_LOCK:
        try:
            proc = subprocess.run(
                cmd,
                input=prompt + "\n",
                cwd=str(MODEL_DIR),
                env=env,
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                timeout=REQUEST_TIMEOUT,
                check=False,
            )
            output = proc.stdout or ""
        except subprocess.TimeoutExpired as exc:
            output = exc.stdout or ""
            if isinstance(output, bytes):
                output = output.decode("utf-8", errors="replace")

    return extract_first_answer(output)


def extract_first_answer(output: str) -> str:
    match = re.search(r"user:\s*robot:\s*(.*?)(?:\n\s*\nuser:|\Z)", output, re.S)
    if not match:
        raise RuntimeError("RKLLM demo did not produce a parseable robot answer")
    text = match.group(1).strip()
    return re.sub(r"\s+\Z", "", text)


class Handler(BaseHTTPRequestHandler):
    server_version = "rkllm-openai-adapter/0.1"

    def log_message(self, fmt: str, *args) -> None:
        print(f"{self.address_string()} - {fmt % args}", flush=True)

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if path == "/v1/models":
            json_response(self, 200, {
                "object": "list",
                "data": [{"id": MODEL_ID, "object": "model", "owned_by": "taishanpi"}],
            })
            return
        if path in {"/health", "/v1/health"}:
            json_response(self, 200, {"ok": True, "model": MODEL_ID})
            return
        json_response(self, 404, {"error": "not found"})

    def do_POST(self) -> None:
        path = urlparse(self.path).path
        if path != "/v1/chat/completions":
            json_response(self, 404, {"error": "not found"})
            return

        try:
            payload = read_json(self)
            prompt, image_path = message_text_and_image(payload.get("messages") or [])
            answer = run_rkllm(prompt, image_path)
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
            json_response(self, 500, {"error": str(exc)})


def main() -> None:
    missing = [path for path in [DEMO_BIN, DEFAULT_IMAGE, VISION_MODEL, LLM_MODEL] if not path.exists()]
    if missing:
        raise SystemExit(f"missing RKLLM files: {', '.join(map(str, missing))}")
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"rkllm-openai-adapter listening on http://{HOST}:{PORT}/v1", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
