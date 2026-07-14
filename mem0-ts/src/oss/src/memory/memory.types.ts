import { SearchFilters } from "../types";

export interface SearchOptions {
  query: string;
  topK?: number;
  filters?: SearchFilters;
  threshold?: number;
  candidateCount?: number;
}

export interface ConsolidateOptions {
  messages: Array<{ role: string; content: string }>;
  userId?: string;
  agentId?: string;
  runId?: string;
  metadata?: Record<string, any>;
}

export interface ReinforceOptions {
  cardIds: string[];
  currentSession: number;
}

export interface ArchiveOptions {
  strengthThreshold?: number;
}

export interface SearchMetrics {
  embeddingMs: number;
  vectorSearchMs: number;
  rerankMs: number;
  reinforceMs: number;
  totalMs: number;
}

export interface ConsolidateResult {
  operations: Array<{
    action: string;
    cardId?: string;
    text: string;
    confidence: number;
  }>;
  archivedCount: number;
  sessionCounter: number;
  error?: string;
}
