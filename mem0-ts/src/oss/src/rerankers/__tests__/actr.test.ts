import { ActrReranker } from "../actr";

describe("ActrReranker", () => {
  const reranker = new ActrReranker({}, 10);

  const makeCard = (overrides: Record<string, any> = {}) => ({
    id: overrides.id ?? "card-1",
    text: overrides.text ?? "test memory",
    score: overrides.score ?? 0.8,
    payload: {
      accessCount: overrides.accessCount ?? 3,
      lastAccessedSession: overrides.lastAccessedSession ?? 5,
      recentAccessSessions: overrides.recentAccessSessions ?? [3, 5, 7],
      baseStrength: overrides.baseStrength ?? 1.0,
      halfLifeSessions: overrides.halfLifeSessions ?? 20,
      lastReinforcedSession: overrides.lastReinforcedSession ?? 7,
    },
  });

  test("rerank returns scored results sorted by score descending", async () => {
    const cards = [
      makeCard({ id: "a", score: 0.9, accessCount: 10 }),
      makeCard({ id: "b", score: 0.7, accessCount: 1 }),
    ];
    const result = await reranker.rerank("test", cards, 5);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe("a");
    expect(result[0].score).toBeGreaterThan(result[1].score);
  });

  test("rerank filters out cards below minStrength", async () => {
    const cards = [
      makeCard({ id: "strong", score: 0.9, baseStrength: 1.0, lastReinforcedSession: 10 }),
      makeCard({ id: "weak", score: 0.9, baseStrength: 0.01, lastReinforcedSession: 1 }),
    ];
    const result = await reranker.rerank("test", cards, 5);
    expect(result.map((r) => r.id)).toEqual(["strong"]);
  });

  test("rerank respects topK", async () => {
    const cards = Array.from({ length: 10 }, (_, i) =>
      makeCard({ id: `c-${i}`, score: 0.9 - i * 0.05 }),
    );
    const result = await reranker.rerank("test", cards, 3);
    expect(result).toHaveLength(3);
  });

  test("setCurrentSession changes score context", async () => {
    const r1 = new ActrReranker({}, 100);
    const r2 = new ActrReranker({}, 10);
    const card = makeCard({ lastReinforcedSession: 1, baseStrength: 1.0, halfLifeSessions: 100 });

    const [res1] = await r1.rerank("test", [card], 1);
    const [res2] = await r2.rerank("test", [card], 1);

    expect(res1.score).toBeLessThan(res2.score);
  });
});
