import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { VectorStore } from "./base";
import { MemoryCard, SearchFilters, VectorStoreConfig } from "../types";
import {
  ensureSQLiteDirectory,
  getDefaultVectorStoreDbPath,
} from "../utils/sqlite";

interface IndexEntry {
  id: string;
  vector: Float32Array;
}

export class MemoryVectorStore implements VectorStore {
  private db: Database.Database;
  private dimension: number;
  private dbPath: string;

  private index: IndexEntry[] = [];
  private indexLoaded = false;

  constructor(config: VectorStoreConfig) {
    this.dimension = config.dimension || 384;
    this.dbPath = config.dbPath || getDefaultVectorStoreDbPath();
    ensureSQLiteDirectory(this.dbPath);
    this.db = new Database(this.dbPath);
    this.db.pragma("journal_mode = WAL");
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
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS vectors (
        id TEXT PRIMARY KEY,
        vector BLOB NOT NULL,
        FOREIGN KEY (id) REFERENCES cards(id)
      )
    `);
  }

  private loadIndex(): void {
    if (this.indexLoaded) return;
    const rows = this.db
      .prepare("SELECT id, vector FROM vectors")
      .all() as Array<{ id: string; vector: Buffer }>;
    this.index = rows.map((row) => ({
      id: row.id,
      vector: new Float32Array(
        row.vector.buffer,
        row.vector.byteOffset,
        row.vector.byteLength / 4,
      ),
    }));
    this.indexLoaded = true;
  }

  private invalidateIndex(): void {
    this.indexLoaded = false;
    this.index = [];
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
    const insertVector = this.db.prepare(
      "INSERT OR REPLACE INTO vectors (id, vector) VALUES (?, ?)",
    );

    const txn = this.db.transaction(() => {
      for (const card of cards) {
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
          insertVector.run(card.id, buf);
        }
      }
    });
    txn();
    this.invalidateIndex();
  }

  async search(
    queryVector: number[],
    topK: number,
    filters?: SearchFilters,
  ): Promise<Array<{ id: string; score: number; card: MemoryCard }>> {
    this.loadIndex();

    const { where, params } = this.buildWhereClause(filters);
    const rows = this.db
      .prepare(`SELECT * FROM cards WHERE ${where}`)
      .all(...params) as any[];

    const filteredIds = new Set(rows.map((r) => r.id));

    const scored: Array<{
      id: string;
      score: number;
      vector: Float32Array;
    }> = [];
    for (const entry of this.index) {
      if (!filteredIds.has(entry.id)) continue;
      const score = this.cosineSimilarity(entry.vector, queryVector);
      scored.push({ id: entry.id, score, vector: entry.vector });
    }

    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, topK);

    const cardMap = new Map<string, any>();
    for (const row of rows) {
      cardMap.set(row.id, row);
    }

    return top.map((s) => ({
      id: s.id,
      score: s.score,
      card: this.cardFromRow(cardMap.get(s.id)),
    }));
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
      this.db
        .prepare("UPDATE vectors SET vector = ? WHERE id = ?")
        .run(buf, id);
    }
    this.invalidateIndex();
  }

  async delete(id: string): Promise<void> {
    this.db.prepare("DELETE FROM cards WHERE id = ?").run(id);
    this.db.prepare("DELETE FROM vectors WHERE id = ?").run(id);
    this.invalidateIndex();
  }

  async list(
    filters?: SearchFilters,
    topK: number = 100,
  ): Promise<[MemoryCard[], number]> {
    const { where, params } = this.buildWhereClause(filters);
    const rows = this.db
      .prepare(`SELECT * FROM cards WHERE ${where} LIMIT ?`)
      .all(...params, topK) as any[];
    return [rows.map((r) => this.cardFromRow(r)), rows.length];
  }

  async deleteAll(filters?: SearchFilters): Promise<void> {
    const { where, params } = this.buildWhereClause(filters);
    this.db.prepare(`DELETE FROM cards WHERE ${where}`).run(...params);
    this.db.prepare(`DELETE FROM vectors WHERE id NOT IN (SELECT id FROM cards)`).run();
    this.invalidateIndex();
  }

  async rebuildIndex(): Promise<void> {
    this.invalidateIndex();
    this.loadIndex();
  }

  async initialize(): Promise<void> {
    this.init();
  }

  async close(): Promise<void> {
    this.db.close();
  }
}
