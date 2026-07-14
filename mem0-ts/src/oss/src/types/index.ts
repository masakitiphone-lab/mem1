import { z } from "zod";

export interface EmbeddingConfig {
  apiKey?: string;
  model?: string;
  baseURL?: string;
  embeddingDims?: number;
}

export interface VectorStoreConfig {
  collectionName?: string;
  dimension?: number;
  dbPath?: string;
  [key: string]: any;
}

export interface HistoryStoreConfig {
  provider: string;
  config: {
    historyDbPath?: string;
  };
}

export interface LLMConfig {
  apiKey?: string;
  model?: string;
  baseURL?: string;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  [key: string]: any;
}

export interface RerankerConfig {
  [key: string]: any;
}

export interface MemoryCard {
  id: string;
  text: string;
  hash: string;
  vector?: number[];

  sessionCreated: number;
  lastReinforcedSession: number;
  baseStrength: number;
  halfLifeSessions: number;

  accessCount: number;
  lastAccessedSession: number;
  recentAccessSessions: number[];

  status: "active" | "archived" | "deleted";

  memoryType?: "episode" | "state" | "preference";
  subject?: string;
  property?: string;
  valueNumber?: number;
  unit?: string;

  userId?: string;
  agentId?: string;
  runId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Message {
  role: string;
  content: string;
}

export interface SearchFilters {
  user_id?: string;
  agent_id?: string;
  run_id?: string;
  [key: string]: any;
}

export interface SearchResult {
  results: MemoryCard[];
}

export interface MemoryConfig {
  version?: string;
  embedder: {
    provider: string;
    config: EmbeddingConfig;
  };
  vectorStore: {
    provider: string;
    config: VectorStoreConfig;
  };
  llm: {
    provider: string;
    config: LLMConfig;
  };
  historyStore?: HistoryStoreConfig;
  disableHistory?: boolean;
  sessionInterval?: number;
}

export const MemoryConfigSchema = z.object({
  version: z.string().optional(),
  embedder: z.object({
    provider: z.string(),
    config: z.record(z.string(), z.any()),
  }),
  vectorStore: z.object({
    provider: z.string(),
    config: z.record(z.string(), z.any()),
  }),
  llm: z.object({
    provider: z.string(),
    config: z.record(z.string(), z.any()),
  }),
  historyStore: z
    .object({
      provider: z.string(),
      config: z.record(z.string(), z.any()),
    })
    .optional(),
  disableHistory: z.boolean().optional(),
  sessionInterval: z.number().optional(),
});
