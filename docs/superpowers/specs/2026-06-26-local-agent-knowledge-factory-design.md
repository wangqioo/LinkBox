# Local Agent Knowledge Factory Design

Date: 2026-06-26

## Goal

Turn the RK3576 LinkBox deployment into a local-first Agent node that keeps
working after it is plugged in. The box should continuously turn messy personal
inputs into durable, searchable, structured knowledge assets, while cloud
models remain optional accelerators for high-quality interactive reasoning.

The product promise is not "a small box that chats like a large model." The
promise is:

```text
feed it articles, images, audio, video, and files
-> it keeps processing them locally
-> it creates Markdown, transcripts, descriptions, summaries, indexes, and structure
-> it reports what it did and what still needs attention
-> stronger cloud Agent calls can use the prepared evidence when needed
```

## Product Positioning

The local Agent is a private knowledge factory. Chat is only one way to call
the factory's output.

It should feel like:

- a worker that is always on;
- a local organizer that can run without cloud APIs;
- a private multimodal preprocessing pipeline;
- a memory and rules system that improves after user correction;
- a launchpad for stronger cloud reasoning when the user asks hard questions.

It should not pretend that a small local model has unlimited context or expert
reasoning. The design should instead make local work bounded, observable,
retriable, and useful even when the model is weak.

## Operating Principles

1. Local by default for ingestion work.
   - Markdown extraction, image description, transcript cleanup, summaries,
     chunking, indexing, and deterministic structure should run locally when
     possible.

2. Cloud only after evidence is compact.
   - Cloud Agent calls should receive bounded evidence packages created by
     local retrieval, not raw libraries or large multimodal payloads.

3. Automatic for reversible work.
   - The box may automatically extract, summarize, retry, describe, transcribe,
     index, and mark quality.

4. Suggest before irreversible or semantic changes.
   - New classification rules, project assignment, merging, archiving,
     deletion, and important todo creation should start as suggestions.

5. Growth comes from corrections.
   - When the user corrects classifications, summaries, topic choices, or
     importance, LinkBox should record reusable rules instead of treating the
     correction as one chat message.

## Agent Autonomy Level

The first real version should be "suggestion-led autonomy":

- It automatically runs low-risk processing jobs.
- It writes daily or session-level work reports.
- It proposes actions that would change the knowledge graph or user workflow.
- The user can accept, reject, or edit suggestions.
- Accepted suggestions become rules or memories that affect future work.

This is safer than full autonomy but more alive than a passive queue.

## Knowledge Maturity Model

Every item should have a visible maturity state. This is the core product
language that lets the user see the factory growing.

Suggested maturity levels:

| Level | Meaning | Examples |
| --- | --- | --- |
| `raw` | Item is saved but not yet processed | uploaded file, pasted URL |
| `converted` | Raw content became text/Markdown/transcript/description | PDF to Markdown, image to text |
| `indexed` | Search chunks and embeddings are ready | `document_chunks`, embeddings |
| `understood` | Deterministic structure exists | entities, topics, todos, claims |
| `summarized` | Human-friendly summary or learning note exists | summary, learning note |
| `review_needed` | Agent produced a suggestion or low-confidence result | uncertain category, failed retry |
| `reviewed` | User confirmed or corrected the result | accepted suggestion, edited tags |

The state should be derived from existing canonical storage where possible:

- `item_content`
- `item_assets`
- `documents`
- `document_chunks`
- `document_embeddings`
- `item_entities`
- `item_topics`
- `item_todos`
- `item_claims`
- summaries and learning notes
- failed or queued jobs

## Local Agent Loop

The local Agent should run a bounded loop over the library:

```text
observe -> plan -> work -> verify -> record -> report
```

### Observe

Collect a work queue from current state:

- newly saved raw items;
- files missing Markdown;
- images missing descriptions;
- videos missing transcript;
- documents missing chunks or embeddings;
- items missing structured understanding;
- failed jobs that are safe to retry;
- low-confidence or stale outputs;
- pending suggestions waiting for user review.

### Plan

Create an internal plan that groups safe jobs and suggestions:

- "process these 8 raw images";
- "retry these 2 transcript jobs";
- "backfill embeddings for 40 chunks";
- "suggest topic consolidation for these repeated themes";
- "ask for cloud Agent only if the user requests broad synthesis."

The plan should be persisted enough to audit what the Agent intended to do.
Existing `assistant_runs` are chat-oriented, so the first factory milestone
should add a lightweight `agent_runs` table for local factory runs instead of
overloading chat history.

### Work

Execute through the existing durable job queue whenever possible:

- `link.extractMarkdown`
- `link.summarize`
- `image.describe`
- `file.extractMarkdown`
- `file.summarize`
- `document.embed`
- future `item.understand`
- future `agent.suggest`

The local model should use `purpose: 'organize'` or `purpose: 'vision'`.
Interactive answer generation remains `purpose: 'agent'`.

### Verify

Verification should start simple and deterministic:

- output is non-empty;
- Markdown has enough text;
- transcript length is plausible;
- image description is not a generic failure string;
- summary references the item title or content;
- chunks were created;
- embedding row count matches chunk count;
- structure extraction produced valid JSON-like rows.

Weak results should not block the library. They should be marked as
`review_needed` or retried with a smaller prompt.

### Record

Record every meaningful result:

- item maturity transitions;
- job attempts and failures;
- generated summaries and descriptions;
- extracted structured fields;
- suggestions;
- accepted/rejected user feedback;
- reusable rules.

### Report

The Agent should produce work reports so the user feels the box is active:

- "Today I processed 12 articles, 4 images, and 1 video."
- "2 items need review because local vision returned weak descriptions."
- "I found 5 possible todos."
- "I suggest merging these two topics."
- "Cloud Agent is not configured; local processing is still running."

## Suggestions And Rules

Suggestions are the bridge from passive processing to growing intelligence.

Suggested first suggestion types:

- `tag_suggestion`: add or remove tags;
- `topic_suggestion`: assign item to a recurring topic;
- `project_suggestion`: connect item to an active project;
- `todo_suggestion`: create a todo from an extracted action;
- `duplicate_suggestion`: possible duplicate or related item;
- `rule_suggestion`: turn repeated user correction into a reusable rule;
- `retry_suggestion`: retry with cloud model or different local settings.

Each suggestion should have:

- item or scope;
- proposed action;
- reason;
- confidence;
- source evidence;
- status: `pending`, `accepted`, `rejected`, `edited`, `expired`;
- created by model or deterministic rule;
- accepted user id and timestamp.

Accepted suggestions can become rules.

Rule examples:

- "Articles mentioning Claude Code and Codex usually belong to AI/Agent."
- "Screenshots from financial apps should be tagged 财务."
- "Bilibili technical videos should keep the original transcript and add a
  short Chinese summary."
- "Do not auto-create todos from quoted article text unless the user is the
  author."

Rules should be inspectable and reversible.

## Cloud Agent Boundary

Cloud models should be used for:

- broad synthesis across many sources;
- user-facing final answers;
- difficult project reasoning;
- high-stakes summarization requested explicitly by the user;
- optional reprocessing of failed or low-confidence local outputs.

Cloud models should not be required for:

- saving items;
- converting files to Markdown;
- storing image descriptions when local vision is available;
- transcript persistence;
- search and retrieval;
- queue recovery;
- daily local work reports.

This preserves the private local loop while allowing smart responses when the
user wants speed and quality.

## UI Surfaces

### Agent Workbench

Add an admin-facing workbench that answers:

- What is the local Agent doing now?
- What did it finish today?
- What failed?
- What does it suggest?
- What rules has it learned?
- Which parts can run offline?
- Which parts need cloud configuration?

This should use dense operational UI, not a marketing-style page.

Core sections:

- queue and current jobs;
- maturity coverage;
- suggestions inbox;
- recent Agent reports;
- learned rules;
- model routing status;
- storage and health warnings.

### Item Detail

Each item should show:

- maturity state;
- generated artifacts;
- last processing run;
- source transcript/Markdown/image description;
- suggestions related to the item;
- "mark reviewed" or "correct" actions.

### Daily Report

The daily report can be generated locally from structured events first. LLM
polishing can be optional.

First version report fields:

- processed counts by type;
- failures and retryable jobs;
- new topics;
- new todos;
- low-confidence items;
- suggestions waiting for review.

## Data Model Additions

Prefer additive tables to avoid destabilizing existing ingestion paths.

Potential tables:

```text
agent_reports
  id, user_id, scope_type, scope_id, report_type, content_json, created_at

agent_runs
  id, user_id, run_type, status, plan_json, summary_json, started_at,
  completed_at, created_at

agent_suggestions
  id, user_id, item_id, suggestion_type, status, proposal_json,
  reason, confidence, evidence_json, created_at, updated_at, resolved_at

agent_rules
  id, user_id, rule_type, status, title, condition_json, action_json,
  source_suggestion_id, created_at, updated_at

item_maturity_events
  id, item_id, user_id, from_state, to_state, reason, metadata_json, created_at
```

The current `jobs`, `item_understanding_*`, `document_*`, and assistant run
tables should remain the source of truth for their own domains. New tables
should summarize Agent-level state instead of duplicating all details.

## Integration With Existing Architecture

The design builds on current LinkBox pieces:

- durable jobs in `server/utils/jobQueue.js`;
- enrichment handlers in `server/utils/enrichmentJobs.js`;
- canonical content in `item_content` and `documents`;
- chunking and embeddings in `document_chunks` and embedding utilities;
- structured understanding in `item_entities`, `item_topics`, `item_todos`,
  and `item_claims`;
- Assistant observability in `assistant_runs`;
- purpose-based model routing in `server/utils/aiConfig.js`.

The first implementation should avoid replacing those systems. It should add a
thin Agent orchestration layer that reads their state, schedules existing jobs,
and records suggestions/reports.

## Failure Handling

Local model failures are expected, not exceptional.

Handling rules:

- empty model output becomes a failed or low-confidence result, not a spinner;
- repeated local failures can create a suggestion to retry with cloud;
- failed work stays visible in the workbench;
- user can retry one item, retry a category, or ignore;
- processing partial success is acceptable: a video can have metadata and
  original transcript even if punctuation cleanup failed.

## First Milestone

The first milestone should prove that the box is alive without requiring full
autonomy.

Deliverables:

1. Derived item maturity state.
2. Agent workbench with queue, coverage, and failed work.
3. Local daily report generated from jobs and document state.
4. Suggestions table and API with accept/reject.
5. A small rule table that records accepted classification preferences.
6. One suggestion generator: tag/topic suggestions from existing
   `item_topics`.
7. Tests around maturity derivation, suggestion lifecycle, and report
   generation.

## Non-Goals For First Milestone

- No full autonomous deletion or archive.
- No complex long-horizon planning.
- No mandatory cloud dependency.
- No new vector database requirement.
- No replacement of the existing job queue.
- No claim that local RKLLM can answer every broad reasoning question.

## Success Criteria

The design is working when:

- adding mixed materials overnight results in visible processed artifacts by
  morning;
- the user can see what the box did without reading logs;
- failures are actionable and retryable;
- at least one accepted suggestion changes future organization behavior;
- cloud Agent answers are faster because evidence is already prepared locally;
- the system still works when cloud API keys are absent.
