import { v4 as uuidv4 } from "uuid";
import { createHash } from "crypto";
import {
  MemoryConfig,
  MemoryCard,
  Message,
  SearchFilters,
  SearchResult,
} from "../types";
import {
  EmbedderFactory,
  LLMFactory,
  VectorStoreFactory,
  HistoryManagerFactory,
} from "../utils/factory";
import { Embedder } from "../embeddings/base";
import { LLM } from "../llms/base";
import { VectorStore } from "../vector_stores/base";
import { HistoryManager } from "../storage/base";
import { SQLiteManager } from "../storage/SQLiteManager";
import { ConfigManager } from "../config/manager";
import { ActrReranker } from "../rerankers/actr";
import { CONSOLIDATE_SYSTEM_PROMPT, buildConsolidationPrompt } from "../prompts";
import {
  SearchOptions,
  ConsolidateOptions,
  ReinforceOptions,
  ArchiveOptions,
  SearchMetrics,
  ConsolidateResult,
} from "./memory.types";

const DEFAULT_INTERVAL = 20;
const DEFAULT_HALF_LIFE_SESSIONS = 20;
const DEFAULT_BASE_STRENGTH = 1.0;
const MIN_STRENGTH = 0.05;
const LOW_CONFIDENCE = 0.55;
const MED_CONFIDENCE = 0.80;

export class Memory {
  private config: MemoryConfig;
  private embedder: Embedder;
  private vectorStore: VectorStore;
  private llm: LLM;
  private db: HistoryManager;
  private reranker: ActrReranker;

  private sessionCounter: number = 0;
  private sessionScope: string = "";
  private sessionInterval: number;
  private lastMetrics: SearchMetrics | null = null;
  private _initPromise: Promise<void>;

  constructor(config: Partial<MemoryConfig> = {}) {
    this.config = ConfigManager.mergeConfig(config);

    this.embedder = EmbedderFactory.create(
      this.config.embedder.provider,
      this.config.embedder.config,
    );
    this.llm = LLMFactory.create(
      this.config.llm.provider,
      this.config.llm.config,
    );
    this.vectorStore = VectorStoreFactory.create(
      this.config.vectorStore.provider,
      this.config.vectorStore.config,
    );

    if (this.config.disableHistory) {
      this.db = new (class implements HistoryManager {
        async addHistory() {}
        async getHistory() {
          return [];
        }
        async reset() {}
        close() {}
      })();
    } else {
      this.db = HistoryManagerFactory.create(
        this.config.historyStore!.provider,
        this.config.historyStore!,
      );
    }

    this.sessionInterval =
      this.config.sessionInterval ?? DEFAULT_INTERVAL;
    this.reranker = new ActrReranker({}, 0);

    this._initPromise = this._initialize();
  }

  private async _initialize(): Promise<void> {
    await this.vectorStore.initialize();
    if (!this.config.vectorStore.config.dimension) {
      const probe = await this.embedder.embed("dimension probe");
      (this.config.vectorStore.config as any).dimension = probe.length;
    }
  }

  private async _ensureInitialized(): Promise<void> {
    await this._initPromise;
  }

  getLastMetrics(): SearchMetrics | null {
    return this.lastMetrics;
  }

  getCurrentSession(): number {
    return this.sessionCounter;
  }

  /**
   * 検索（LLM不使用）
   * Embedding → Vector Search → ACT-R+Fadeリランク → 強化
   * 目標: totalMs < 500
   */
  async search(
    query: string,
    options: SearchOptions = { query },
  ): Promise<{ results: MemoryCard[]; metrics: SearchMetrics }> {
    const totalStart = Date.now();
    await this._ensureInitialized();

    const {
      topK = 5,
      filters,
      candidateCount = 32,
      threshold = 0.0,
    } = options;

    // 1. Embedding
    const embedStart = Date.now();
    const queryVector = await this.embedder.embed(query, "search");
    const embeddingMs = Date.now() - embedStart;

    // 2. Vector search (over-fetch)
    const searchStart = Date.now();
    const rawResults = await this.vectorStore.search(
      queryVector,
      candidateCount,
      filters,
    );
    const vectorSearchMs = Date.now() - searchStart;

    // 3. ACT-R + Fade rerank
    const rerankStart = Date.now();
    this.reranker.setCurrentSession(this.sessionCounter);
    const reranked = await this.reranker.rerank(
      query,
      rawResults.map((r) => ({
        id: r.id,
        text: r.card.text,
        score: r.score,
        payload: {
          accessCount: r.card.accessCount,
          lastAccessedSession: r.card.lastAccessedSession,
          recentAccessSessions: r.card.recentAccessSessions,
          baseStrength: r.card.baseStrength,
          halfLifeSessions: r.card.halfLifeSessions,
          lastReinforcedSession: r.card.lastReinforcedSession,
        },
      })),
      topK,
    );
    const rerankMs = Date.now() - rerankStart;

    // 4. Reinforce cards that made it to final results
    const reinforceStart = Date.now();
    const finalIds = reranked.map((r) => r.id);
    await this.reinforceInternal(finalIds);
    const reinforceMs = Date.now() - reinforceStart;

    // Map back to MemoryCard objects
    const idToCard = new Map(rawResults.map((r) => [r.id, r.card]));
    const results = reranked
      .filter((r) => (r.score ?? 0) >= threshold)
      .map((r) => ({
        ...idToCard.get(r.id)!,
      }));

    const totalMs = Date.now() - totalStart;
    this.lastMetrics = {
      embeddingMs,
      vectorSearchMs,
      rerankMs,
      reinforceMs,
      totalMs,
    };

    return { results, metrics: this.lastMetrics };
  }

  /**
   * 記憶整理（LLM使用）
   * 会話から ADD / UPDATE / MERGE / IGNORE を判断
   */
  async consolidate(
    options: ConsolidateOptions,
  ): Promise<ConsolidateResult> {
    await this._ensureInitialized();
    const { messages, userId, agentId, runId } = options;

    const filters: SearchFilters = {};
    if (userId) filters.user_id = userId;
    if (agentId) filters.agent_id = agentId;
    if (runId) filters.run_id = runId;

    // Existing cards for context
    const [existingCards] = await this.vectorStore.list(filters, 20);

    const conversationText = messages
      .map((m) => `${m.role}: ${m.content}`)
      .join("\n");

    const userPrompt = buildConsolidationPrompt({
      newMessages: conversationText,
      existingCards: existingCards.map((c) => ({ id: c.id, text: c.text })),
    });

    let response: string;
    try {
      response = (await this.llm.generateResponse(
        [
          { role: "system", content: CONSOLIDATE_SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        { type: "json_object" },
      )) as string;
    } catch (e) {
      console.error("Consolidation LLM failed:", e);
      return { operations: [], archivedCount: 0, sessionCounter: this.sessionCounter };
    }

    // Parse response
    let operations: Array<{
      action: string;
      text?: string;
      target_id?: string;
      memory_type?: string;
      confidence?: number;
      subject?: string;
      property?: string;
      valueNumber?: number;
      unit?: string;
    }> = [];

    try {
      const cleaned = response.replace(/^```json\n?/, "").replace(/\n```$/, "").trim();
      const parsed = JSON.parse(cleaned);
      operations = parsed.operations || parsed.memory || [];
    } catch {
      console.error("Failed to parse consolidation response:", response);
      return { operations: [], archivedCount: 0, sessionCounter: this.sessionCounter };
    }

    // Validate operations
    const validTargets = new Set(existingCards.map((c) => c.id));
    const executed: ConsolidateResult["operations"] = [];

    for (const op of operations) {
      const action = (op.action || "IGNORE").toUpperCase();
      const text = op.text?.trim();
      const confidence = op.confidence ?? 0;

      if (action === "IGNORE" || !text) continue;

      // Validate confidence
      if (confidence < LOW_CONFIDENCE) continue;

      if (action === "UPDATE" || action === "MERGE") {
        if (!op.target_id || !validTargets.has(op.target_id)) {
          // Target not found, fall back to ADD
          await this.addCard({
            text,
            memoryType: op.memory_type as any,
            subject: op.subject,
            property: op.property,
            valueNumber: op.valueNumber,
            unit: op.unit,
            filters,
            confidence,
          });
          executed.push({ action: "ADD", cardId: undefined, text, confidence });
          continue;
        }

        if (confidence < MED_CONFIDENCE) {
          // Low confidence for UPDATE/MERGE → ADD instead
          const cardId = await this.addCard({
            text,
            memoryType: op.memory_type as any,
            subject: op.subject,
            property: op.property,
            valueNumber: op.valueNumber,
            unit: op.unit,
            filters,
            confidence,
          });
          executed.push({ action: "ADD", cardId, text, confidence });
          continue;
        }

        const existing = existingCards.find((c) => c.id === op.target_id);
        if (!existing) continue;

        const mergedText =
          action === "MERGE" ? `${existing.text}。${text}` : text;

        const hash = createHash("md5").update(mergedText).digest("hex");

        await this.vectorStore.update(op.target_id, {
          text: mergedText,
          hash,
          memoryType: (op.memory_type as any) || existing.memoryType,
          subject: op.subject || existing.subject,
          property: op.property || existing.property,
          valueNumber: op.valueNumber ?? existing.valueNumber,
          unit: op.unit || existing.unit,
          updatedAt: new Date().toISOString(),
        });

        await this.db.addHistory({
          cardId: op.target_id,
          action: action as any,
          previousText: existing.text,
          newText: mergedText,
          createdAt: new Date().toISOString(),
        });

        executed.push({ action, cardId: op.target_id, text, confidence });
      } else {
        // ADD
        const cardId = await this.addCard({
          text,
          memoryType: op.memory_type as any,
          subject: op.subject,
          property: op.property,
          valueNumber: op.valueNumber,
          unit: op.unit,
          filters,
          confidence,
        });
        executed.push({ action: "ADD", cardId, text, confidence });
      }
    }

    // Archive faded cards
    const archivedCount = await this.archiveFadedInternal();

    return {
      operations: executed,
      archivedCount,
      sessionCounter: this.sessionCounter,
    };
  }

  /**
   * Add a single memory card
   */
  private async addCard(params: {
    text: string;
    memoryType?: "episode" | "state" | "preference";
    subject?: string;
    property?: string;
    valueNumber?: number;
    unit?: string;
    filters: SearchFilters;
    confidence: number;
  }): Promise<string> {
    const { text, memoryType, subject, property, valueNumber, unit, filters } =
      params;

    const vector = await this.embedder.embed(text, "add");
    const hash = createHash("md5").update(text).digest("hex");
    const now = new Date().toISOString();
    const cardId = uuidv4();

    const card: MemoryCard = {
      id: cardId,
      text,
      hash,
      vector,
      sessionCreated: this.sessionCounter,
      lastReinforcedSession: this.sessionCounter,
      baseStrength: DEFAULT_BASE_STRENGTH,
      halfLifeSessions: DEFAULT_HALF_LIFE_SESSIONS,
      accessCount: 0,
      lastAccessedSession: 0,
      recentAccessSessions: [],
      status: "active",
      memoryType,
      subject,
      property,
      valueNumber,
      unit,
      userId: filters.user_id,
      agentId: filters.agent_id,
      runId: filters.run_id,
      createdAt: now,
      updatedAt: now,
    };

    await this.vectorStore.insert([card]);

    await this.db.addHistory({
      cardId,
      action: "ADD",
      previousText: null,
      newText: text,
      createdAt: now,
    });

    return cardId;
  }

  /**
   * セッション追加＋自動整理トリガー
   */
  async addSession(
    scope: string = "default",
    messages?: Array<{ role: string; content: string }>,
  ): Promise<{
    sessionCounter: number;
    consolidated: ConsolidateResult | null;
  }> {
    await this._ensureInitialized();
    this.sessionScope = scope;

    if (this.db instanceof SQLiteManager) {
      this.sessionCounter = await this.db.incrementSessionCounter(scope);
    } else {
      this.sessionCounter++;
    }
    this.reranker.setCurrentSession(this.sessionCounter);

    let consolidated: ConsolidateResult | null = null;
    if (
      this.sessionCounter > 0 &&
      this.sessionCounter % this.sessionInterval === 0 &&
      messages &&
      messages.length > 0
    ) {
      consolidated = await this.consolidate({ messages });
    }

    return { sessionCounter: this.sessionCounter, consolidated };
  }

  /**
   * 内部強化処理
   */
  private async reinforceInternal(cardIds: string[]): Promise<void> {
    for (const id of cardIds) {
      const card = await this.vectorStore.get(id);
      if (!card) continue;

      const recentAccess = [...(card.recentAccessSessions || [])];
      recentAccess.push(this.sessionCounter);
      if (recentAccess.length > 5) recentAccess.shift();

      await this.vectorStore.update(id, {
        accessCount: (card.accessCount || 0) + 1,
        lastAccessedSession: this.sessionCounter,
        lastReinforcedSession: this.sessionCounter,
        recentAccessSessions: recentAccess,
        updatedAt: new Date().toISOString(),
      });
    }
  }

  /**
   * 外部強化API
   */
  async reinforce(cardIds: string[], session?: number): Promise<void> {
    await this._ensureInitialized();
    if (session !== undefined) {
      const prev = this.sessionCounter;
      this.sessionCounter = session;
      await this.reinforceInternal(cardIds);
      this.sessionCounter = prev;
    } else {
      await this.reinforceInternal(cardIds);
    }
  }

  /**
   * 内部Fade整理
   */
  private async archiveFadedInternal(
    threshold: number = MIN_STRENGTH,
  ): Promise<number> {
    const [cards] = await this.vectorStore.list({}, 10000);
    let archived = 0;

    for (const card of cards) {
      const elapsed = Math.max(
        this.sessionCounter - card.lastReinforcedSession,
        0,
      );
      const halfLife = card.halfLifeSessions || DEFAULT_HALF_LIFE_SESSIONS;
      const strength =
        card.baseStrength * Math.pow(2, -elapsed / halfLife);

      if (strength < threshold && card.status === "active") {
        await this.vectorStore.update(card.id, {
          status: "archived",
          updatedAt: new Date().toISOString(),
        });
        await this.db.addHistory({
          cardId: card.id,
          action: "ARCHIVE",
          previousText: card.text,
          newText: null,
          createdAt: new Date().toISOString(),
        });
        archived++;
      }

      if (strength < threshold * 0.1 && card.status === "archived") {
        await this.vectorStore.update(card.id, {
          status: "deleted",
          updatedAt: new Date().toISOString(),
        });
        await this.db.addHistory({
          cardId: card.id,
          action: "DELETE",
          previousText: card.text,
          newText: null,
          createdAt: new Date().toISOString(),
        });
      }
    }

    return archived;
  }

  /**
   * 外部Fade整理API
   */
  async archiveFaded(
    options: ArchiveOptions = {},
  ): Promise<{ archivedCount: number }> {
    await this._ensureInitialized();
    const count = await this.archiveFadedInternal(
      options.strengthThreshold,
    );
    return { archivedCount: count };
  }

  // ===== CRUD =====

  async get(id: string): Promise<MemoryCard | null> {
    await this._ensureInitialized();
    return this.vectorStore.get(id);
  }

  async getAll(
    filters?: SearchFilters,
    topK: number = 100,
  ): Promise<{ results: MemoryCard[]; total: number }> {
    await this._ensureInitialized();
    const [results, total] = await this.vectorStore.list(filters, topK);
    return { results, total };
  }

  async delete(id: string): Promise<void> {
    await this._ensureInitialized();
    const card = await this.vectorStore.get(id);
    if (!card) throw new Error(`Card ${id} not found`);

    await this.db.addHistory({
      cardId: id,
      action: "DELETE",
      previousText: card.text,
      newText: null,
      createdAt: new Date().toISOString(),
    });
    await this.vectorStore.delete(id);
  }

  async reset(): Promise<void> {
    await this._ensureInitialized();
    await this.vectorStore.deleteAll();
    await this.db.reset();
    this.sessionCounter = 0;
  }

  async rebuildIndex(): Promise<void> {
    await this._ensureInitialized();
    await this.vectorStore.rebuildIndex();
  }
}
