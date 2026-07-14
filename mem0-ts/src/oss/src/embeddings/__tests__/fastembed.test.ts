// fastembed is optional peer dep - mock it as virtual
jest.mock("fastembed", () => ({
  FlagEmbedding: {
    init: jest.fn().mockResolvedValue({
      embed: jest.fn().mockImplementation(async function* (texts: string[]) {
        yield texts.map(() => Array.from({ length: 384 }, (_, i) => i / 384));
      }),
    }),
  },
}), { virtual: true });

import { FastEmbedEmbedder } from "../fastembed";

describe("FastEmbedEmbedder", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("constructor accepts valid model name", () => {
    const embedder = new FastEmbedEmbedder({ model: "fast-bge-small-en-v1.5" });
    expect(embedder).toBeInstanceOf(FastEmbedEmbedder);
  });

  test("constructor rejects invalid model name", () => {
    expect(() => new FastEmbedEmbedder({ model: "invalid-model" })).toThrow(
      /Unsupported FastEmbed model/,
    );
  });

  test("constructor uses default model when none provided", () => {
    const embedder = new FastEmbedEmbedder({});
    expect(embedder).toBeInstanceOf(FastEmbedEmbedder);
  });

  test("embed returns vector of expected length", async () => {
    const embedder = new FastEmbedEmbedder({});
    const vector = await embedder.embed("test text");
    expect(Array.isArray(vector)).toBe(true);
    expect(vector.length).toBeGreaterThan(0);
  });

  test("embedBatch returns array of vectors", async () => {
    const embedder = new FastEmbedEmbedder({});
    const vectors = await embedder.embedBatch(["hello", "world"]);
    expect(vectors).toHaveLength(2);
    expect(vectors[0].length).toBeGreaterThan(0);
  });
});
