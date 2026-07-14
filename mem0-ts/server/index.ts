import express from "express";
import cors from "cors";
import { Memory } from "../src";

const app = express();
const PORT = parseInt(process.env.PORT || "3000", 10);
const HOST = process.env.HOST || "0.0.0.0";

app.use(cors());
app.use(express.json({ limit: "1mb" }));

// Memory instance - initialized on first request
let memory: Memory | null = null;
let initPromise: Promise<void> | null = null;

async function getMemory(): Promise<Memory> {
  if (memory) return memory;
  if (!initPromise) {
    initPromise = (async () => {
      const config: Record<string, any> = {};
      if (process.env.GEMINI_API_KEY) {
        config.llm = { provider: "google", config: { apiKey: process.env.GEMINI_API_KEY } };
      }
      if (process.env.EMBEDDER_PROVIDER) {
        config.embedder = { provider: process.env.EMBEDDER_PROVIDER };
      }
      if (process.env.MEMORY_DB_PATH) {
        config.vectorStore = { provider: "memory", config: { dbPath: process.env.MEMORY_DB_PATH } };
      }
      if (process.env.HISTORY_DB_PATH) {
        config.historyStore = { provider: "sqlite", config: { historyDbPath: process.env.HISTORY_DB_PATH } };
      }
      if (process.env.SESSION_INTERVAL) {
        config.sessionInterval = parseInt(process.env.SESSION_INTERVAL, 10);
      }
      memory = new Memory(config);
    })();
  }
  await initPromise;
  return memory!;
}

// === Health ===
app.get("/api/v1/health", (_req, res) => {
  res.json({
    status: "ok",
    memory: memory !== null,
    session: memory?.getCurrentSession() ?? 0,
  });
});

// === Metrics ===
app.get("/api/v1/metrics", (_req, res) => {
  const m = memory?.getLastMetrics();
  if (!m) return res.status(404).json({ error: "No metrics available yet" });
  res.json(m);
});

// === Search (LLM不使用) ===
app.post("/api/v1/search", async (req, res) => {
  try {
    const mem = await getMemory();
    const { query, topK, filters, threshold, candidateCount } = req.body;
    if (!query || typeof query !== "string") {
      return res.status(400).json({ error: "query is required" });
    }
    const { results, metrics } = await mem.search(query, {
      query,
      topK: topK ?? 5,
      filters,
      threshold: threshold ?? 0.0,
      candidateCount: candidateCount ?? 32,
    });
    res.json({ results, metrics });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// === Consolidate (LLM使用) ===
app.post("/api/v1/consolidate", async (req, res) => {
  try {
    const mem = await getMemory();
    const { messages, userId, agentId, runId } = req.body;
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "messages array is required" });
    }
    const result = await mem.consolidate({ messages, userId, agentId, runId });
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// === Add Session ===
app.post("/api/v1/session", async (req, res) => {
  try {
    const mem = await getMemory();
    const { scope, messages } = req.body;
    const result = await mem.addSession(scope ?? "default", messages);
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// === Reinforce ===
app.post("/api/v1/reinforce", async (req, res) => {
  try {
    const mem = await getMemory();
    const { cardIds, session } = req.body;
    if (!cardIds || !Array.isArray(cardIds) || cardIds.length === 0) {
      return res.status(400).json({ error: "cardIds array is required" });
    }
    await mem.reinforce(cardIds, session);
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// === Archive Faded ===
app.post("/api/v1/archive-faded", async (req, res) => {
  try {
    const mem = await getMemory();
    const { strengthThreshold } = req.body;
    const result = await mem.archiveFaded({ strengthThreshold });
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// === Get Card ===
app.get("/api/v1/cards/:id", async (req, res) => {
  try {
    const mem = await getMemory();
    const card = await mem.get(req.params.id);
    if (!card) return res.status(404).json({ error: "Card not found" });
    res.json(card);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// === List Cards ===
app.get("/api/v1/cards", async (req, res) => {
  try {
    const mem = await getMemory();
    const filters: Record<string, any> = {};
    if (req.query.user_id) filters.user_id = req.query.user_id as string;
    if (req.query.agent_id) filters.agent_id = req.query.agent_id as string;
    if (req.query.run_id) filters.run_id = req.query.run_id as string;
    const topK = req.query.topK ? parseInt(req.query.topK as string, 10) : 100;
    const result = await mem.getAll(filters, topK);
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// === Delete Card ===
app.delete("/api/v1/cards/:id", async (req, res) => {
  try {
    const mem = await getMemory();
    await mem.delete(req.params.id);
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// === Reset ===
app.post("/api/v1/reset", async (_req, res) => {
  try {
    const mem = await getMemory();
    await mem.reset();
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// === Rebuild Index ===
app.post("/api/v1/rebuild-index", async (_req, res) => {
  try {
    const mem = await getMemory();
    await mem.rebuildIndex();
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, HOST, () => {
  console.log(`🃏 Memory Card API running at http://${HOST}:${PORT}`);
  console.log(`   Health: http://localhost:${PORT}/api/v1/health`);
});
