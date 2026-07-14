import { Memory } from "../index";
import { ActrReranker } from "../../rerankers/actr";

const mockGenerateContent = jest.fn();
jest.mock("@google/genai", () => ({
  GoogleGenAI: jest.fn().mockImplementation(() => ({
    models: { generateContent: mockGenerateContent },
  })),
}));

jest.mock("../../embeddings/fastembed", () => ({
  FastEmbedEmbedder: jest.fn().mockImplementation(() => ({
    embed: jest.fn().mockResolvedValue(
      Array.from({ length: 384 }, (_, i) => Math.sin(i)),
    ),
    embedBatch: jest.fn().mockResolvedValue(
      Array.from({ length: 2 }, () =>
        Array.from({ length: 384 }, (_, i) => Math.sin(i)),
      ),
    ),
  })),
}));

describe("Memory", () => {
  let memory: Memory;

  beforeEach(() => {
    jest.clearAllMocks();
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify({
        operations: [{
          action: "ADD",
          text: "User likes dark roast coffee",
          memory_type: "preference",
          confidence: 0.9,
        }],
      }),
      functionCalls: [],
    });

    memory = new Memory(
      {
        vectorStore: {
          provider: "memory",
          config: { dimension: 384, dbPath: ":memory:" },
        },
        historyStore: {
          provider: "sqlite",
          config: { historyDbPath: ":memory:" },
        },
        llm: {
          provider: "google",
          config: { apiKey: "test" },
        },
        sessionInterval: 100,
      },
      new ActrReranker({}, 0),
    );
  });

  test("getCurrentSession starts at 0", () => {
    expect(memory.getCurrentSession()).toBe(0);
  });

  test("addSession increments counter", async () => {
    const { sessionCounter } = await memory.addSession("test-scope");
    expect(sessionCounter).toBeGreaterThan(0);
  });

  test("search returns results when cards exist", async () => {
    await memory.addSession("init");

    const result = await memory.consolidate({
      messages: [
        { role: "user", content: "I like dark roast coffee" },
        { role: "assistant", content: "Noted!" },
      ],
    });
    expect(result.operations.length).toBeGreaterThan(0);

    const { results, metrics } = await memory.search("coffee");
    expect(Array.isArray(results)).toBe(true);
    expect(metrics).not.toBeNull();
    expect(metrics!.totalMs).toBeGreaterThanOrEqual(0);
  });

  test("consolidate returns operations", async () => {
    const result = await memory.consolidate({
      messages: [
        { role: "user", content: "I love hiking" },
        { role: "assistant", content: "Great!" },
      ],
    });
    expect(result.operations).toBeDefined();
    expect(result.sessionCounter).toBeGreaterThanOrEqual(0);
  });

  test("get returns null for missing card", async () => {
    const card = await memory.get("nonexistent");
    expect(card).toBeNull();
  });

  test("getAll returns cards", async () => {
    const result = await memory.getAll();
    expect(result.results).toBeDefined();
    expect(typeof result.total).toBe("number");
  });

  test("delete throws for missing card", async () => {
    await expect(memory.delete("nonexistent")).rejects.toThrow(/not found/);
  });

  test("reset clears everything", async () => {
    await memory.addSession("test");
    await memory.reset();
    expect(memory.getCurrentSession()).toBe(0);
  });

  test("getLastMetrics returns null before search", () => {
    expect(memory.getLastMetrics()).toBeNull();
  });

  test("reinforce boosts card accessCount", async () => {
    await memory.addSession("init");
    const result = await memory.consolidate({
      messages: [
        { role: "user", content: "I like tea" },
        { role: "assistant", content: "ok" },
      ],
    });

    if (result.operations.length > 0 && result.operations[0].cardId) {
      const cardId = result.operations[0].cardId;
      const before = await memory.get(cardId);
      expect(before!.accessCount).toBe(0);

      await memory.reinforce([cardId]);

      const after = await memory.get(cardId);
      expect(after!.accessCount).toBe(1);
    }
  });

  test("archiveFaded runs without error", async () => {
    const result = await memory.archiveFaded();
    expect(typeof result.archivedCount).toBe("number");
  });

  test("consolidate returns error when LLM fails", async () => {
    mockGenerateContent.mockRejectedValue(new Error("API error"));

    const result = await memory.consolidate({
      messages: [{ role: "user", content: "Hello" }],
    });
    expect(result.error).toBeDefined();
    expect(result.error).toContain("API error");
  });
});
