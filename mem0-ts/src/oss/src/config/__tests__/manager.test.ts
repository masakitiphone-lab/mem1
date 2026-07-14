import { ConfigManager } from "../manager";

describe("ConfigManager", () => {
  test("mergeConfig returns default config when empty", () => {
    const config = ConfigManager.mergeConfig({});
    expect(config.embedder.provider).toBe("fastembed");
    expect(config.llm.provider).toBe("google");
    expect(config.vectorStore.provider).toBe("memory");
    expect(config.sessionInterval).toBe(20);
    expect(config.vectorStore.config.dimension).toBe(384);
  });

  test("mergeConfig merges user config over defaults", () => {
    const config = ConfigManager.mergeConfig({
      embedder: { provider: "fastembed", config: { model: "fast-bge-base-en" } },
      llm: { provider: "google", config: { model: "gemini-2.5-flash" } },
      sessionInterval: 50,
    });
    expect(config.embedder.config.model).toBe("fast-bge-base-en");
    expect(config.llm.config.model).toBe("gemini-2.5-flash");
    expect(config.sessionInterval).toBe(50);
  });

  test("mergeConfig uses embeddingDims when dimension not set", () => {
    const config = ConfigManager.mergeConfig({
      vectorStore: { provider: "memory", config: {} },
      embedder: { provider: "fastembed", config: { embeddingDims: 768 } },
    });
    expect(config.vectorStore.config.dimension).toBe(768);
  });

  test("mergeConfig validates via zod", () => {
    expect(() =>
      ConfigManager.mergeConfig({ embedder: { provider: 123 as any, config: { model: "x" } } }),
    ).toThrow();
  });

  test("historyStore defaults to sqlite when not set", () => {
    const config = ConfigManager.mergeConfig({});
    expect(config.historyStore?.provider).toBe("sqlite");
  });

  test("disableHistory is honored", () => {
    const config = ConfigManager.mergeConfig({ disableHistory: true });
    expect(config.disableHistory).toBe(true);
  });
});
