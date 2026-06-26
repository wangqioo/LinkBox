# AI Model Routing Design

Date: 2026-06-26

## Goal

Split LinkBox AI usage by purpose so the system can use cheap or local models
for background organization while using a stronger cloud model for interactive
Assistant answers.

This should make the RK3576 deployment more reliable and make Agent answers
faster and smarter without sending the whole library to a cloud model.

## Current State

LinkBox currently has one global chat AI configuration in
`server/utils/aiConfig.js`. `callAIChat` and `streamAIChat` always resolve that
same saved provider, base URL, model, vision model, API key, temperature, and
thinking flag.

Embedding is already separate in `server/utils/embeddingConfig.js`, so document
indexing and retrieval can be configured independently from chat generation.

Assistant generation, summaries, learning notes, extraction cleanup, image
vision, and transcript punctuation can still end up sharing the same global
chat model. On the RK3576 box this means final Assistant answers can be routed
to the local RKLLM adapter, which is slow and unstable for Agent-style
generation.

## Target Model Purposes

### `organize`

Used for background and ingestion-time enrichment:

- summaries
- learning notes
- transcript punctuation or cleanup
- title/tag style metadata
- optional higher-level document annotations

This purpose can use a local model or cheaper cloud model. Failures should be
recorded as processing failures and retried through existing job recovery
paths. They should not block later retrieval or Assistant chat.

### `agent`

Used for interactive Assistant answer generation:

- `POST /api/assistant/chat`
- `POST /api/assistant/chat/stream`
- group Assistant answers
- future answer-refinement steps

This purpose should default to a stable cloud model. It receives only the
bounded evidence package produced by retrieval, not the whole library.

### `vision`

Used for image understanding. In the first implementation it may reuse
`organize` config when no dedicated vision config exists, but the public config
shape should keep vision separate because vision model choice is often
provider-specific.

### `embedding`

Remains owned by `server/utils/embeddingConfig.js`. It is not part of this
design except that Agent token savings depend on retrieval producing a small,
high-quality evidence set before the `agent` model is called.

## Configuration Model

Add purpose-scoped AI settings while keeping the old keys as compatibility
fallbacks.

New setting key families:

```text
ai:organize:provider
ai:organize:base_url
ai:organize:model
ai:organize:vision_model
ai:organize:api_key
ai:organize:temperature
ai:organize:enable_thinking

ai:agent:provider
ai:agent:base_url
ai:agent:model
ai:agent:vision_model
ai:agent:api_key
ai:agent:temperature
ai:agent:enable_thinking

ai:vision:provider
ai:vision:base_url
ai:vision:model
ai:vision:api_key
ai:vision:temperature
ai:vision:enable_thinking
```

The existing keys stay valid:

```text
ai:provider
ai:base_url
ai:model
ai:vision_model
ai:api_key
ai:temperature
ai:enable_thinking
```

Fallback rules:

1. If a purpose-specific key exists, use it.
2. Otherwise fall back to the existing global `ai:*` key.
3. Otherwise fall back to provider defaults and environment defaults.

This avoids a migration that breaks existing deployments.

## Server API

Extend the AI config helper around a purpose-aware API:

```js
getAIConfig({ purpose: 'agent', includeSecret: true })
updateAIConfig(input, { purpose: 'agent' })
testAIConfig(input, { purpose: 'agent' })

callAIChat({ purpose: 'organize', messages, ... })
streamAIChat({ purpose: 'agent', messages, ... })
```

The default purpose should be `organize` for non-interactive callers to preserve
the cheaper/background behavior. Assistant routes should pass
`purpose: 'agent'` explicitly.

The public settings response should include:

```json
{
  "purposes": {
    "organize": { "...": "..." },
    "agent": { "...": "..." },
    "vision": { "...": "..." }
  },
  "providers": []
}
```

For compatibility, the top-level fields can continue to represent the
`organize` config in the first version.

## Call-Site Routing

Initial routing:

- `server/routes/assistant.js`: `agent`
- `server/utils/aiSummarize.js`: `organize`
- `server/utils/generateLearningNote.js`: `organize`
- `server/utils/videoTranscriptExtractor.js`: `organize`
- `server/utils/llmUnderstandingAnnotations.js`: `organize`
- `server/utils/imageVisionService.js`: `vision`
- extractor shared vision/chat cleanup paths: `vision` for image input,
  `organize` for text cleanup

Any call site not migrated in the first pass should keep working through the
default purpose.

## Admin UI

Update desktop settings to make the separation visible:

- `资料整理模型`
- `问答 Agent 模型`
- `图片理解模型`
- existing `Embedding 设置`

Each model section should expose provider, base URL, model, API key,
temperature, thinking switch, and a test button. The first UI pass can reuse
the existing `AISettingsPanel` layout with a segmented purpose selector if that
keeps the change smaller.

System health should report purpose-specific AI checks:

- organize model reachable
- agent model reachable
- vision model reachable when configured

## RK3576 Deployment Defaults

For the small box:

```text
organize -> local RKLLM adapter or cheap model
agent    -> cloud OpenAI-compatible provider
vision   -> local RKLLM adapter initially, cloud if reliability is needed
embedding -> existing local hash embedding or configured embedding provider
```

This keeps interactive Assistant answers off the unstable local RKLLM adapter
while still allowing local-first background enrichment.

## Token And Latency Strategy

This design saves cloud tokens by keeping cloud Agent calls after retrieval:

```text
library -> canonical documents/chunks/metadata -> retrieval -> small evidence package -> cloud agent
```

The cloud model should never receive the full library. It receives only ranked
sources, selected chunks, memory, plan metadata, and verification guidance.

The retrieval-confidence work remains important. Low-quality embedding-only
matches should be capped or dropped before the `agent` model is called, because
bad evidence wastes tokens and produces weaker answers.

## Error Handling

- Background `organize` failures stay in job status and can be retried.
- `agent` failures are returned to chat as explicit SSE `error` events.
- Empty `agent` streams remain treated as generation errors.
- Missing `agent` config should return a clear admin-facing setup error.
- If `vision` is unset, it may fall back to `organize` in the first version.

## Validation

Backend:

```bash
cd server
node --test test/assistantRoutes.test.mjs
node --test test/settingsSystem.test.mjs
npm test
```

Frontend:

```bash
cd client && npm test && npm run build
cd mobile && npm test && npm run build
```

Operational smoke on RK3576:

```bash
curl -s http://127.0.0.1:3100/
curl -s http://127.0.0.1:3100/mobile/
curl -N http://127.0.0.1:3100/api/assistant/chat/stream ...
```

The smoke should confirm that Assistant chat uses the configured `agent`
provider and does not route final answers through RKLLM unless explicitly
configured that way.

## Non-Goals

- Do not replace SQLite or introduce a separate vector database.
- Do not remove the existing global `ai:*` settings in this pass.
- Do not solve all retrieval quality problems in the same implementation.
- Do not make a dynamic multi-model router for every question yet. First make
  the purpose boundaries explicit and testable.
