import { SearchFilters } from "../types";
import { MemoryCard } from "../types";

export interface ReinforceEntry {
  id: string;
  accessCount: number;
  lastAccessedSession: number;
  recentAccessSessions: number[];
}

export interface VectorStore {
  insert(cards: MemoryCard[]): Promise<void>;
  search(
    queryVector: number[],
    topK: number,
    filters?: SearchFilters,
  ): Promise<Array<{ id: string; score: number; card: MemoryCard }>>;
  get(id: string): Promise<MemoryCard | null>;
  update(id: string, card: Partial<MemoryCard>): Promise<void>;
  delete(id: string): Promise<void>;
  list(
    filters?: SearchFilters,
    topK?: number,
  ): Promise<[MemoryCard[], number]>;
  deleteAll(filters?: SearchFilters): Promise<void>;
  rebuildIndex(): Promise<void>;
  initialize(): Promise<void>;
  reinforceBatch?(entries: ReinforceEntry[]): Promise<void>;
  batchUpdateStatus?(ids: string[], status: string, updatedAt: string): Promise<void>;
  close?(): Promise<void>;
}
