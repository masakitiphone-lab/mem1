# Mem1 - Memory Card System with ACT-R + Fade Architecture

A local-first memory system for AI apps, using **ACT-R activation** + **Fade decay** for session-based forgetting. No LLM used for search (<500ms target). LLM (Gemini) used only for consolidation.

Forked from [mem0ai/mem0](https://github.com/mem0ai/mem0), completely rewritten in TypeScript.

## Architecture

```
User Query → Embedding (FastEmbed) → Vector Search → ACT-R+Fade Rerank → Results
                                          ↕
Session Counter → Fade Decay (strength = baseStrength × 2^(-elapsed/halfLife))
                                          ↕
        LLM Consolidation (every N sessions) → ADD/UPDATE/MERGE cards
```

- **MemoryCard**: text + vector + ACT-R metadata (accessCount, baseStrength, halfLifeSessions, etc.)
- **Search**: vector cosine similarity → ACT-R activation boost → Fade strength filter
- **Fade**: `strength = baseStrength × 2^(-elapsedSessions / halfLifeSessions)`
- **ACT-R**: `finalScore = vectorSim² × (1 + 0.15 × actrActivation) × (0.95 + 0.05 × fadeStrength)`
- **Status lifecycle**: `active` → `archived` (strength < 0.05) → `deleted`
- **Consolidation**: LLM decides ADD / UPDATE / MERGE / IGNORE based on conversation

## Installation

```bash
npm install mem1
# Optional: for local embeddings
npm install fastembed
```

Requires Node >= 18.

## Quick Start

```typescript
import { Memory } from "mem1";

const memory = new Memory({
  llm: {
    config: { apiKey: process.env.GEMINI_API_KEY },
  },
});

// Add a session (auto-triggers consolidation every 20 sessions)
await memory.addSession("chat-1", [
  { role: "user", content: "I like dark roast coffee" },
  { role: "assistant", content: "Noted! I'll remember that." },
]);

// Search (no LLM used)
const { results, metrics } = await memory.search("coffee preferences");
console.log(results, metrics);

// Force consolidation
const result = await memory.consolidate({
  messages: [
    { role: "user", content: "I prefer light roast actually" },
    { role: "assistant", content: "Updated!" },
  ],
});

// Manually reinforce cards
await memory.reinforce(["card-id-1", "card-id-2"]);

// Archive faded cards
await memory.archiveFaded();

// CRUD
const card = await memory.get("card-id-1");
const { results, total } = await memory.getAll({ user_id: "user-1" });
await memory.delete("card-id-1");
await memory.reset();
```

## API

### `new Memory(config?, reranker?)`

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `config` | `Partial<MemoryConfig>` | Default config | See Config below |
| `reranker` | `Reranker` | `ActrReranker` | Optional custom reranker |

### Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `search(query, options)` | `{ results, metrics }` | Semantic search (no LLM, <500ms target) |
| `consolidate(options)` | `ConsolidateResult` | LLM-based memory consolidation |
| `addSession(scope, messages?)` | `{ sessionCounter, consolidated }` | Increment session, auto-consolidate at interval |
| `reinforce(cardIds, session?)` | `void` | Boost card strength |
| `archiveFaded(options?)` | `{ archivedCount }` | Archive/delete decayed cards |
| `get(id)` | `MemoryCard \| null` | Get card by ID |
| `getAll(filters?, topK?)` | `{ results, total }` | List active cards |
| `delete(id)` | `void` | Delete card permanently |
| `reset()` | `void` | Delete all data |
| `rebuildIndex()` | `void` | Rebuild in-memory vector index |
| `getLastMetrics()` | `SearchMetrics \| null` | Last search latency breakdown |
| `getCurrentSession()` | `number` | Current session counter |

### Config

```typescript
interface MemoryConfig {
  version?: string;
  embedder: {
    provider: "fastembed";
    config: { model?: string; embeddingDims?: number };
  };
  vectorStore: {
    provider: "memory";
    config: { dimension?: number; dbPath?: string };
  };
  llm: {
    provider: "google" | "gemini";
    config: { apiKey?: string; model?: string };
  };
  historyStore?: {
    provider: "sqlite";
    config: { historyDbPath?: string };
  };
  disableHistory?: boolean;
  sessionInterval?: number; // default: 20
}
```

Environment variables: `GEMINI_API_KEY`, `MEMORY_DB_PATH`, `HISTORY_DB_PATH`, `SESSION_INTERVAL`.

### ConsolidateResult

```typescript
interface ConsolidateResult {
  operations: Array<{
    action: "ADD" | "UPDATE" | "MERGE";
    cardId?: string;
    text: string;
    confidence: number;
  }>;
  archivedCount: number;
  sessionCounter: number;
  error?: string; // present if LLM call failed
}
```

## Express API Server

```bash
GEMINI_API_KEY=your_key npm start
# Server at http://localhost:3000
```

Endpoints: `GET /api/v1/health`, `POST /api/v1/search`, `POST /api/v1/consolidate`, `POST /api/v1/session`, `POST /api/v1/reinforce`, `POST /api/v1/archive-faded`, `GET /api/v1/cards`, `GET /api/v1/cards/:id`, `DELETE /api/v1/cards/:id`, `POST /api/v1/reset`, `POST /api/v1/rebuild-index`.

## License

Apache-2.0
