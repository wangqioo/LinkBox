# LinkBox on RK3576 4GB Box

This document records the stable deployment baseline used for a 4 GB RAM / 64 GB
storage RK3576 box. The goal is not maximum model context. The goal is a usable
LinkBox appliance: local AI answers, image understanding, video transcription,
mobile access, FRP exposure, and acceptable stability on a small memory budget.

## Device Baseline

- Board/SoC: RK3576
- Memory/storage: 4 GB RAM, 64 GB storage
- OS: Debian 13, Linux 6.1.y
- LinkBox app: `/opt/linkbox`
- LinkBox data: `/var/lib/linkbox`
- LinkBox local URL: `http://0.0.0.0:3100`
- Local LLM API: `http://127.0.0.1:8000/v1`
- Whisper API: `http://127.0.0.1:8080`
- FRP client config: `/opt/frp/frpc.toml`

## System Services

Expected services:

```sh
systemctl is-active linkbox rkllm-openai-adapter whisper frpc zram-swap
```

Important paths:

```sh
/opt/linkbox
/var/lib/linkbox/linkbox.db
/var/lib/linkbox/uploads
/opt/rkllm-openai-adapter/rkllm_openai_adapter.py
/opt/qwen3-vl-2b
/opt/whisper/whisper.cpp
/opt/frp/frpc.toml
```

## Memory Strategy

This board is memory-bound. A Qwen3-VL 2B RKLLM process with vision support can
reach about 3.2-3.4 GB service peak memory. Do not tune it like a desktop or
server deployment.

Use zram swap:

```sh
swapon --show
free -h
```

The deployed baseline uses a 2 GB zram swap device. Avoid a regular swapfile on
overlay-style storage unless the filesystem is known to support it correctly.

## RKLLM Adapter

The adapter exposes the RKLLM/RKNN vendor demo as an OpenAI-compatible API.

Systemd environment baseline:

```sh
RKLLM_ADAPTER_HOST=127.0.0.1
RKLLM_ADAPTER_PORT=8000
RKLLM_MODEL_ID=qwen3-vl-2b-rk3576
RKLLM_MODEL_DIR=/opt/qwen3-vl-2b
RKLLM_DEFAULT_IMAGE=/opt/qwen3-vl-2b/demo.jpg
RKLLM_VISION_MODEL=/opt/qwen3-vl-2b/qwen3-vl_vision_rk3576.rknn
RKLLM_LLM_MODEL=/opt/qwen3-vl-2b/qwen3-vl-2b-instruct_w8a8_rk3576.rkllm
QWEN_VL_CONTEXT=2048
QWEN_VL_MAX_NEW_TOKENS=192
QWEN_VL_RKNN_CORES=1
RKLLM_REQUEST_TIMEOUT=300
RKLLM_BOOT_TIMEOUT=300
RKLLM_DISABLE_THINKING=1
RKLLM_REWARM_DEFAULT_AFTER_IMAGE=0
RKLLM_CACHE_DB=/var/lib/rkllm-openai-adapter/cache.sqlite
RKLLM_IMAGE_CACHE_ITEMS=128
```

Why these limits:

- `QWEN_VL_CONTEXT=2048` is the stable target for 4 GB RAM.
- `QWEN_VL_MAX_NEW_TOKENS=192` keeps answers short and reduces failure risk.
- `RKLLM_REWARM_DEFAULT_AFTER_IMAGE=0` avoids loading a second demo in the
  background after image requests.
- `RKLLM_DISABLE_THINKING=1` keeps Qwen thinking mode permanently disabled.

The adapter now supports real SSE streaming by reading the vendor demo pty while
`robot:` output is being generated and forwarding deltas as OpenAI-compatible
chat chunks. If the demo crashes during streaming, the adapter sends an SSE
error payload so LinkBox can retry with compact context.

Health check:

```sh
curl -s http://127.0.0.1:8000/v1/health
```

Direct streaming test:

```sh
curl -sS --no-buffer http://127.0.0.1:8000/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"model":"qwen3-vl-2b-rk3576","stream":true,"messages":[{"role":"user","content":"用中文写三条很短的建议。"}],"max_tokens":80}'
```

## LinkBox AI Settings

In the LinkBox AI settings UI:

- Provider: `自定义 / 本地 OpenAI 兼容`
- Base URL: `http://127.0.0.1:8000/v1`
- Text model: `qwen3-vl-2b-rk3576`
- Vision model: `qwen3-vl-2b-rk3576`
- API key: empty
- Temperature: `0.3`
- Enable local Qwen thinking mode: off

The base URL is used by the LinkBox backend running on the RK3576 box, so
`127.0.0.1` means the device itself, not the user's phone or laptop.

## LinkBox Edge Limits

Systemd environment baseline:

```sh
BACKGROUND_QUEUE_CONCURRENCY=1
NODE_OPTIONS=--max-old-space-size=256
WEB_IMAGE_VISION_TIMEOUT_MS=90000
ASSISTANT_MAX_CONTEXT_CHARS=2500
ASSISTANT_MAX_FIELD_CHARS=1200
ASSISTANT_MAX_SOURCES=2
ASSISTANT_MAX_FALLBACK_SOURCES=1
ASSISTANT_MAX_TOKENS=220
```

These limits intentionally keep retrieved assistant context small. On this
device, long articles, image descriptions, and video transcripts can crash the
RKLLM demo if passed through uncompressed.

The assistant path includes two additional safeguards:

- Context cleanup removes long image Markdown and long URLs before calling the
  local model.
- If RKLLM returns `Input/output error` or a stream error, LinkBox retries once
  with a compact context and shorter output. The retry path is also streaming.

## Whisper Transcription

Whisper is exposed through a local server:

```sh
WHISPER_SERVER_URL=http://127.0.0.1:8080
```

Recommended on this 4 GB device:

- Run whisper with low thread count, normally 2 threads.
- Keep LinkBox background queue concurrency at 1.
- Avoid running video transcription and long assistant answers at the same time.

Required video dependency:

```sh
yt-dlp --version
```

If Bilibili transcription fails with `spawn yt-dlp ENOENT`, install `yt-dlp` on
the device and restart LinkBox.

## FRP Exposure

The deployed FRP tunnel exposes LinkBox through a public server:

```toml
[[proxies]]
name = "r76s-linkbox"
type = "tcp"
localIP = "127.0.0.1"
localPort = 3100
remotePort = 7130
```

Service checks:

```sh
systemctl is-active frpc
journalctl -u frpc -n 80 --no-pager
```

Desktop and mobile URLs depend on the public FRP server. For local LAN testing,
prefer:

```text
http://192.168.1.50:3100/
http://192.168.1.50:3100/mobile
```

SSE streaming is sensitive to mobile network switches, lock screen, and proxy
timeouts. If LAN is stable but public FRP shows `network error`, investigate the
FRP path before changing model parameters.

## Runtime Checks

General health:

```sh
systemctl is-active linkbox rkllm-openai-adapter whisper frpc
free -h
swapon --show
curl -s http://127.0.0.1:8000/v1/health
curl -s http://127.0.0.1:3100/api/settings/system
```

Recent logs:

```sh
journalctl -u linkbox -u rkllm-openai-adapter --since '30 minutes ago' --no-pager
journalctl -u whisper -u frpc -n 120 --no-pager
```

Memory-heavy processes:

```sh
ps -eo pid,ppid,user,stat,pcpu,pmem,rss,args --sort=-rss | head -25
systemctl show rkllm-openai-adapter -p Environment -p MemoryCurrent -p MemoryPeak --no-pager
systemctl show linkbox -p Environment -p MemoryCurrent -p MemoryPeak --no-pager
```

## Expected Behavior

Text chat:

- Short warm requests can answer quickly.
- The first request after restart or image-mode switching can take 15-40 seconds.
- Long assistant requests may take longer before the first token.

Assistant:

- Uses local retrieval with at most 2 main sources.
- Streams once tokens begin.
- Automatically retries compactly after RKLLM pty errors.

Images:

- Static image understanding works.
- GIFs should be skipped for vision description.
- Multiple images should be processed serially through the background queue.

Video:

- `yt-dlp` extracts audio.
- Whisper server transcribes audio.
- LinkBox can summarize the resulting transcript, but long transcripts should be
  chunked or summarized conservatively.

## Known Limits

- 4 GB RAM is enough for this baseline, but not enough for large local context.
- Do not raise `QWEN_VL_CONTEXT` above 2048 unless you are explicitly testing
  stability.
- `3072` context may boot but is more likely to crash under mixed LinkBox load.
- `4096+` context is not a realistic target on this 4 GB vision-model setup.
- Local RKLLM demo crashes are surfaced as `Input/output error`; LinkBox can
  retry, but a browser or FRP disconnect may still show `network error`.

## Recommended Tuning Order

If the system feels slow or unstable, tune in this order:

1. Reduce retrieved context and source count.
2. Reduce output tokens.
3. Keep background concurrency at 1.
4. Keep Qwen thinking mode disabled.
5. Add or verify zram swap.
6. Only then experiment with model context.

Avoid making the context larger as a first response. On this device, larger
context usually makes first-token latency and crash rate worse.
