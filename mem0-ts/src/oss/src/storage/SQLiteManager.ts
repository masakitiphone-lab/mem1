import Database from "better-sqlite3";
import { HistoryManager, HistoryEntry } from "./base";
import { ensureSQLiteDirectory } from "../utils/sqlite";

export class SQLiteManager implements HistoryManager {
  private db: Database.Database;

  constructor(dbPath: string) {
    ensureSQLiteDirectory(dbPath);
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        card_id TEXT NOT NULL,
        action TEXT NOT NULL,
        previous_text TEXT,
        new_text TEXT,
        created_at TEXT NOT NULL
      )
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_history_card ON memory_history(card_id)
    `);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_scope TEXT NOT NULL UNIQUE,
        counter INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      )
    `);
  }

  async addHistory(entry: HistoryEntry): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO memory_history (card_id, action, previous_text, new_text, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        entry.cardId,
        entry.action,
        entry.previousText,
        entry.newText,
        entry.createdAt,
      );
  }

  async getHistory(cardId: string): Promise<HistoryEntry[]> {
    const rows = this.db
      .prepare(
        `SELECT * FROM memory_history WHERE card_id = ? ORDER BY id ASC`,
      )
      .all(cardId) as Array<{
      card_id: string;
      action: "ADD" | "UPDATE" | "MERGE" | "DELETE" | "ARCHIVE";
      previous_text: string | null;
      new_text: string | null;
      created_at: string;
    }>;
    return rows.map((r) => ({
      cardId: r.card_id,
      action: r.action,
      previousText: r.previous_text,
      newText: r.new_text,
      createdAt: r.created_at,
    }));
  }

  async getSessionCounter(scope: string): Promise<number> {
    const row = this.db
      .prepare("SELECT counter FROM sessions WHERE session_scope = ?")
      .get(scope) as { counter: number } | undefined;
    return row?.counter ?? 0;
  }

  async incrementSessionCounter(scope: string): Promise<number> {
    const now = new Date().toISOString();
    const result = this.db
      .prepare(
        `INSERT INTO sessions (session_scope, counter, updated_at)
         VALUES (?, 1, ?)
         ON CONFLICT(session_scope) DO UPDATE SET
           counter = counter + 1,
           updated_at = excluded.updated_at
         RETURNING counter`,
      )
      .get(scope, now) as { counter: number } | undefined;
    return result?.counter ?? 0;
  }

  async reset(): Promise<void> {
    this.db.exec("DROP TABLE IF EXISTS memory_history");
    this.db.exec("DROP TABLE IF EXISTS sessions");
    this.init();
  }

  close(): void {
    this.db.close();
  }
}
