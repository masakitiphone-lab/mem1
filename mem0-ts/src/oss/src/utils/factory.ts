import { FastEmbedEmbedder } from "../embeddings/fastembed";
import { GoogleLLM } from "../llms/google";
import { MemoryVectorStore } from "../vector_stores/memory";
import { SQLiteManager } from "../storage/SQLiteManager";
import { Embedder } from "../embeddings/base";
import { LLM } from "../llms/base";
import { VectorStore } from "../vector_stores/base";
import { HistoryManager } from "../storage/base";
import {
  EmbeddingConfig,
  LLMConfig,
  VectorStoreConfig,
  HistoryStoreConfig,
} from "../types";

export class EmbedderFactory {
  static create(provider: string, config: EmbeddingConfig): Embedder {
    switch (provider.toLowerCase()) {
      case "fastembed":
        return new FastEmbedEmbedder(config);
      default:
        throw new Error(`Unsupported embedder: ${provider}`);
    }
  }
}

export class LLMFactory {
  static create(provider: string, config: LLMConfig): LLM {
    switch (provider.toLowerCase()) {
      case "google":
      case "gemini":
        return new GoogleLLM(config);
      default:
        throw new Error(`Unsupported LLM: ${provider}`);
    }
  }
}

export class VectorStoreFactory {
  static create(
    provider: string,
    config: VectorStoreConfig,
  ): VectorStore {
    switch (provider.toLowerCase()) {
      case "memory":
        return new MemoryVectorStore(config);
      default:
        throw new Error(`Unsupported vector store: ${provider}`);
    }
  }
}

export class HistoryManagerFactory {
  static create(
    provider: string,
    config: HistoryStoreConfig,
  ): HistoryManager {
    switch (provider.toLowerCase()) {
      case "sqlite":
        return new SQLiteManager(
          config.config.historyDbPath || ":memory:",
        );
      default:
        throw new Error(`Unsupported history store: ${provider}`);
    }
  }
}
