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
  timeoutMs?: number;
  retryCount?: number;
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
    config: z.object({
      apiKey: z.string().optional(),
      model: z.string().optional(),
      baseURL: z.string().optional(),
      embeddingDims: z.number().optional(),
    }),
  }),
  vectorStore: z.object({
    provider: z.string(),
    config: z.object({
      collectionName: z.string().optional(),
      dimension: z.number().optional(),
      dbPath: z.string().optional(),
    }),
  }),
  llm: z.object({
    provider: z.string(),
    config: z.object({
      apiKey: z.string().optional(),
      model: z.string().optional(),
      baseURL: z.string().optional(),
      temperature: z.number().optional(),
      topP: z.number().optional(),
      maxTokens: z.number().optional(),
    }),
  }),
  historyStore: z
    .object({
      provider: z.string(),
      config: z.object({
        historyDbPath: z.string().optional(),
      }),
    })
    .optional(),
  disableHistory: z.boolean().optional(),
  sessionInterval: z.number().optional(),
});
