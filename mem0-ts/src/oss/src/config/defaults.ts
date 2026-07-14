import { MemoryConfig } from "../types";

export const DEFAULT_MEMORY_CONFIG: MemoryConfig = {
  version: "v2.0",
  embedder: {
    provider: "fastembed",
    config: {
      model: "fast-bge-small-en-v1.5",
    },
  },
  vectorStore: {
    provider: "memory",
    config: {
      collectionName: "memories",
      dimension: 384,
    },
  },
  llm: {
    provider: "google",
    config: {
      model: "gemini-2.0-flash",
      apiKey: process.env.GEMINI_API_KEY || "",
    },
  },
  historyStore: {
    provider: "sqlite",
    config: {
      historyDbPath: "memory.db",
    },
  },
  sessionInterval: 20,
};
