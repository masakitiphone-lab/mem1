import { MemoryConfig, MemoryConfigSchema } from "../types";
import { DEFAULT_MEMORY_CONFIG } from "./defaults";

export class ConfigManager {
  static mergeConfig(userConfig: Partial<MemoryConfig> = {}): MemoryConfig {
    const embedderProvider =
      userConfig.embedder?.provider || DEFAULT_MEMORY_CONFIG.embedder.provider;
    const embedderModel =
      embedderProvider.toLowerCase() === "fastembed"
        ? DEFAULT_MEMORY_CONFIG.embedder.config.model
        : userConfig.embedder?.config?.model ||
          DEFAULT_MEMORY_CONFIG.embedder.config.model;

    const llmProvider =
      userConfig.llm?.provider || DEFAULT_MEMORY_CONFIG.llm.provider;
    const llmModel =
      userConfig.llm?.config?.model || DEFAULT_MEMORY_CONFIG.llm.config.model;
    const llmApiKey =
      userConfig.llm?.config?.apiKey ||
      DEFAULT_MEMORY_CONFIG.llm.config.apiKey;

    const mergedConfig: MemoryConfig = {
      version:
        userConfig.version || DEFAULT_MEMORY_CONFIG.version,
      embedder: {
        provider: embedderProvider,
        config: {
          model: embedderModel,
          ...userConfig.embedder?.config,
        },
      },
      vectorStore: {
        provider:
          userConfig.vectorStore?.provider ||
          DEFAULT_MEMORY_CONFIG.vectorStore.provider,
        config: {
          ...DEFAULT_MEMORY_CONFIG.vectorStore.config,
          ...userConfig.vectorStore?.config,
        },
      },
      llm: {
        provider: llmProvider,
        config: {
          model: llmModel,
          apiKey: llmApiKey,
          ...userConfig.llm?.config,
        },
      },
      historyStore: (userConfig.historyStore ?? {
        provider: "sqlite",
        config: { historyDbPath: "memory.db" },
      }),
      disableHistory:
        userConfig.disableHistory ?? DEFAULT_MEMORY_CONFIG.disableHistory,
      sessionInterval:
        userConfig.sessionInterval ?? DEFAULT_MEMORY_CONFIG.sessionInterval,
    };

    // Probe dimension if not set
    if (!mergedConfig.vectorStore.config.dimension) {
      const probeDims = userConfig.embedder?.config?.embeddingDims;
      if (probeDims) {
        mergedConfig.vectorStore.config.dimension = probeDims;
      }
    }

    return MemoryConfigSchema.parse(mergedConfig as any);
  }
}
