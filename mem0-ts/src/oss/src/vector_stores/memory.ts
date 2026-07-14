import Database from "better-sqlite3";
import path from "path";
import { VectorStore, ReinforceEntry } from "./base";
import { MemoryCard, SearchFilters, VectorStoreConfig } from "../types";
import {
  ensureSQLiteDirectory,
  getDefaultVectorStoreDbPath,
} from "../utils/sqlite";

const OVERFETCH_MULTIPLIER = 3;

function tryLoadVec(db: Database.Database): boolean {
  try {
    const sqliteVec = require("sqlite-vec");
    sqliteVec.load(db);
    return true;
  } catch {
    return false;
  }
}

export class MemoryVectorStore implements VectorStore {
  private db: Database.Database;
  private dimension: number;
  private dbPath: string;
  private hasVec: boolean;

  constructor(config: VectorStoreConfig) {
    this.dimension = config.dimension || 384;
    this.dbPath = config.dbPath || getDefaultVectorStoreDbPath();
    ensureSQLiteDirectory(this.dbPath);
    this.db = new Database(this.dbPath);
    this.db.pragma("journal_mode = WAL");
    this.hasVec = tryLoadVec(this.db);
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS cards (
        id TEXT PRIMARY KEY,
        text TEXT NOT NULL,
        hash TEXT NOT NULL,
        session_created INTEGER NOT NULL DEFAULT 0,
        last_reinforced_session INTEGER NOT NULL DEFAULT 0,
        base_strength REAL NOT NULL DEFAULT 1.0,
        half_life_sessions INTEGER NOT NULL DEFAULT 20,
        access_count INTEGER NOT NULL DEFAULT 0,
        last_accessed_session INTEGER NOT NULL DEFAULT 0,
        recent_access_sessions TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'active',
        memory_type TEXT,
        subject TEXT,
        property TEXT,
        value_number REAL,
        unit TEXT,
        user_id TEXT,
        agent_id TEXT,
        run_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_cards_user ON cards(user_id)
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_cards_status ON cards(status)
    `);

    if (this.hasVec) {
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS vec0 USING vec0(
          id TEXT PRIMARY KEY,
          vector FLOAT[${this.dimension}] distance_metric=cosine
        )
      `);
    } else {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS vectors (
          id TEXT PRIMARY KEY,
          vector BLOB NOT NULL,
          FOREIGN KEY (id) REFERENCES cards(id) ON DELETE CASCADE
        )
      `);
    }
  }

  private cardFromRow(row: any): MemoryCard {
    return {
      id: row.id,
      text: row.text,
      hash: row.hash,
      sessionCreated: row.session_created,
      lastReinforcedSession: row.last_reinforced_session,
      baseStrength: row.base_strength,
      halfLifeSessions: row.half_life_sessions,
      accessCount: row.access_count,
      lastAccessedSession: row.last_accessed_session,
      recentAccessSessions: JSON.parse(row.recent_access_sessions || "[]"),
      status: row.status,
      memoryType: row.memory_type,
      subject: row.subject,
      property: row.property,
      valueNumber: row.value_number,
      unit: row.unit,
      userId: row.user_id,
      agentId: row.agent_id,
      runId: row.run_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private buildWhereClause(
    filters?: SearchFilters,
  ): { where: string; params: any[] } {
    const clauses: string[] = ["status = 'active'"];
    const params: any[] = [];
    if (filters?.user_id) {
      clauses.push("user_id = ?");
      params.push(filters.user_id);
    }
    if (filters?.agent_id) {
      clauses.push("agent_id = ?");
      params.push(filters.agent_id);
    }
    if (filters?.run_id) {
      clauses.push("run_id = ?");
      params.push(filters.run_id);
    }
    return { where: clauses.join(" AND "), params };
  }

  // ---- Brute-force fallback (when sqlite-vec unavailable) ----

  private loadAllVectors(): Array<{ id: string; vector: Float32Array }> {
    const rows = this.db
      .prepare("SELECT id, vector FROM vectors")
      .all() as Array<{ id: string; vector: Buffer }>;
    return rows.map((row) => ({
      id: row.id,
      vector: new Float32Array(
        row.vector.buffer,
        row.vector.byteOffset,
        row.vector.byteLength / 4,
      ),
    }));
  }

  private cosineSimilarity(a: Float32Array, b: number[]): number {
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0 : dot / denom;
  }

  private async searchBruteForce(
    queryVector: number[],
    topK: number,
    filters?: SearchFilters,
  ): Promise<Array<{ id: string; score: number; card: MemoryCard }>> {
    const allVecs = this.loadAllVectors();
    const { where, params } = this.buildWhereClause(filters);
    const rows = this.db
      .prepare(`SELECT * FROM cards WHERE ${where}`)
      .all(...params) as any[];

    const filteredIds = new Set(rows.map((r) => r.id));
    const scored: Array<{ id: string; score: number }> = [];

    for (const entry of allVecs) {
      if (!filteredIds.has(entry.id)) continue;
      const score = this.cosineSimilarity(entry.vector, queryVector);
      scored.push({ id: entry.id, score });
    }

    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, topK);

    const cardMap = new Map(rows.map((r) => [r.id, r]));
    return top.map((s) => ({
      id: s.id,
      score: s.score,
      card: this.cardFromRow(cardMap.get(s.id)),
    }));
  }

  // ---- sqlite-vec ANN search ----

  private async searchVec(
    queryVector: number[],
    topK: number,
    filters?: SearchFilters,
  ): Promise<Array<{ id: string; score: number; card: MemoryCard }>> {
    const queryBuf = Buffer.from(new Float32Array(queryVector).buffer);
    const vecK = topK * OVERFETCH_MULTIPLIER;

    const vecResults = this.db
      .prepare("SELECT id, distance FROM vec0 WHERE vector MATCH ? AND k = ?")
      .all(queryBuf, vecK) as Array<{ id: string; distance: number }>;

    if (vecResults.length === 0) return [];

    const scored = vecResults.map((r) => ({
      id: r.id,
      score: 1 - r.distance,
    }));

    const { where, params } = this.buildWhereClause(filters);
    const ids = scored.map((s) => s.id);
    const placeholders = ids.map(() => "?").join(",");
    const cardRows = this.db
      .prepare(
        `SELECT * FROM cards WHERE id IN (${placeholders}) AND ${where}`,
      )
      .all(...ids, ...params) as any[];

    const filteredIds = new Set(cardRows.map((r) => r.id));
    const scoreMap = new Map(scored.map((s) => [s.id, s.score]));

    return cardRows
      .map((row) => ({
        id: row.id,
        score: scoreMap.get(row.id) ?? 0,
        card: this.cardFromRow(row),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  // ---- Public API ----

  async insert(cards: MemoryCard[]): Promise<void> {
    const insertCard = this.db.prepare(`
      INSERT OR REPLACE INTO cards
        (id, text, hash, session_created, last_reinforced_session,
         base_strength, half_life_sessions, access_count,
         last_accessed_session, recent_access_sessions,
         status, memory_type, subject, property, value_number, unit,
         user_id, agent_id, run_id, created_at, updated_at)
      VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertVec = !this.hasVec
      ? this.db.prepare(
          "INSERT OR REPLACE INTO vectors (id, vector) VALUES (?, ?)",
        )
      : null;
    const insertVec0 = this.hasVec
      ? this.db.prepare(
          "INSERT OR REPLACE INTO vec0(id, vector) VALUES (?, ?)",
        )
      : null;

    const txn = this.db.transaction(() => {
      for (const card of cards) {
        if (card.vector && card.vector.length !== this.dimension) {
          throw new Error(
            `Vector dimension mismatch: expected ${this.dimension}, got ${card.vector.length}`,
          );
        }
        insertCard.run(
          card.id,
          card.text,
          card.hash,
          card.sessionCreated,
          card.lastReinforcedSession,
          card.baseStrength,
          card.halfLifeSessions,
          card.accessCount,
          card.lastAccessedSession,
          JSON.stringify(card.recentAccessSessions),
          card.status,
          card.memoryType || null,
          card.subject || null,
          card.property || null,
          card.valueNumber ?? null,
          card.unit || null,
          card.userId || null,
          card.agentId || null,
          card.runId || null,
          card.createdAt,
          card.updatedAt,
        );
        if (card.vector) {
          const buf = Buffer.from(new Float32Array(card.vector).buffer);
          if (insertVec0) {
            insertVec0.run(card.id, buf);
          } else if (insertVec) {
            insertVec.run(card.id, buf);
          }
        }
      }
    });
    txn();
  }

  async search(
    queryVector: number[],
    topK: number,
    filters?: SearchFilters,
  ): Promise<Array<{ id: string; score: number; card: MemoryCard }>> {
    if (this.hasVec) {
      return this.searchVec(queryVector, topK, filters);
    }
    return this.searchBruteForce(queryVector, topK, filters);
  }

  async get(id: string): Promise<MemoryCard | null> {
    const row = this.db.prepare("SELECT * FROM cards WHERE id = ?").get(id) as
      | any
      | undefined;
    if (!row) return null;
    return this.cardFromRow(row);
  }

  async update(id: string, updates: Partial<MemoryCard>): Promise<void> {
    const existing = await this.get(id);
    if (!existing) throw new Error(`Card ${id} not found`);

    const merged = { ...existing, ...updates };
    merged.updatedAt = new Date().toISOString();

    const stmt = this.db.prepare(`
      UPDATE cards SET
        text = ?, hash = ?, session_created = ?, last_reinforced_session = ?,
        base_strength = ?, half_life_sessions = ?, access_count = ?,
        last_accessed_session = ?, recent_access_sessions = ?,
        status = ?, memory_type = ?, subject = ?, property = ?,
        value_number = ?, unit = ?, user_id = ?, agent_id = ?, run_id = ?,
        created_at = ?, updated_at = ?
      WHERE id = ?
    `);
    stmt.run(
      merged.text,
      merged.hash,
      merged.sessionCreated,
      merged.lastReinforcedSession,
      merged.baseStrength,
      merged.halfLifeSessions,
      merged.accessCount,
      merged.lastAccessedSession,
      JSON.stringify(merged.recentAccessSessions),
      merged.status,
      merged.memoryType || null,
      merged.subject || null,
      merged.property || null,
      merged.valueNumber ?? null,
      merged.unit || null,
      merged.userId || null,
      merged.agentId || null,
      merged.runId || null,
      merged.createdAt,
      merged.updatedAt,
      id,
    );

    if (updates.vector) {
      const buf = Buffer.from(new Float32Array(updates.vector).buffer);
      if (this.hasVec) {
        const txn = this.db.transaction(() => {
          this.db.prepare("DELETE FROM vec0 WHERE id = ?").run(id);
          this.db
            .prepare("INSERT INTO vec0(id, vector) VALUES (?, ?)")
            .run(id, buf);
        });
        txn();
      } else {
        this.db
          .prepare("UPDATE vectors SET vector = ? WHERE id = ?")
          .run(buf, id);
      }
    }
  }

  async delete(id: string): Promise<void> {
    const txn = this.db.transaction(() => {
      if (this.hasVec) {
        this.db.prepare("DELETE FROM vec0 WHERE id = ?").run(id);
      } else {
        this.db.prepare("DELETE FROM vectors WHERE id = ?").run(id);
      }
      this.db.prepare("DELETE FROM cards WHERE id = ?").run(id);
    });
    txn();
  }

  async list(
    filters?: SearchFilters,
    topK: number = 100,
  ): Promise<[MemoryCard[], number]> {
    const { where, params } = this.buildWhereClause(filters);

    const totalRow = this.db
      .prepare(`SELECT COUNT(*) as count FROM cards WHERE ${where}`)
      .get(...params) as { count: number };
    const total = totalRow?.count ?? 0;

    if (topK <= 0) {
      return [[], total];
    }

    const rows = this.db
      .prepare(`SELECT * FROM cards WHERE ${where} LIMIT ?`)
      .all(...params, topK) as any[];
    return [rows.map((r) => this.cardFromRow(r)), total];
  }

  async deleteAll(filters?: SearchFilters): Promise<void> {
    const txn = this.db.transaction(() => {
      if (filters?.user_id || filters?.agent_id || filters?.run_id) {
        const { where, params } = this.buildWhereClause(filters);
        const vecTable = this.hasVec ? "vec0" : "vectors";
        this.db.prepare(
          `DELETE FROM ${vecTable} WHERE id IN (SELECT id FROM cards WHERE ${where})`,
        ).run(...params);
        this.db.prepare(`DELETE FROM cards WHERE ${where}`).run(...params);
      } else {
        if (this.hasVec) {
          this.db.exec("DELETE FROM vec0");
        } else {
          this.db.exec("DELETE FROM vectors");
        }
        this.db.exec("DELETE FROM cards");
      }
    });
    txn();
  }

  async batchUpdateStatus(
    ids: string[],
    status: string,
    updatedAt: string,
  ): Promise<void> {
    if (ids.length === 0) return;
    const stmt = this.db.prepare(
      "UPDATE cards SET status = ?, updated_at = ? WHERE id = ?",
    );
    const txn = this.db.transaction(() => {
      for (const id of ids) {
        stmt.run(status, updatedAt, id);
      }
    });
    txn();
  }

  async reinforceBatch(entries: ReinforceEntry[]): Promise<void> {
    const updateStmt = this.db.prepare(`
      UPDATE cards SET
        access_count = ?,
        last_accessed_session = ?,
        last_reinforced_session = ?,
        recent_access_sessions = ?,
        updated_at = ?
      WHERE id = ?
    `);
    const now = new Date().toISOString();

    const txn = this.db.transaction(() => {
      for (const entry of entries) {
        updateStmt.run(
          entry.accessCount,
          entry.lastAccessedSession,
          entry.lastAccessedSession,
          JSON.stringify(entry.recentAccessSessions),
          now,
          entry.id,
        );
      }
    });
    txn();
  }

  async rebuildIndex(): Promise<void> {
    // vec0 manages the index automatically.
    // For the brute-force fallback, vectors are always read fresh from DB.
    // Nothing to rebuild.
  }

  async initialize(): Promise<void> {
    this.init();
  }

  async close(): Promise<void> {
    this.db.pragma("wal_checkpoint(TRUNCATE)");
    this.db.close();
  }
}
