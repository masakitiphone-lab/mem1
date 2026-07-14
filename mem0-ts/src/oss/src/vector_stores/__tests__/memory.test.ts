import { MemoryVectorStore } from "../memory";
import { MemoryCard } from "../../types";

function makeCard(overrides: Partial<MemoryCard> = {}): MemoryCard {
  const now = new Date().toISOString();
  return {
    id: `card-${Math.random().toString(36).slice(2, 8)}`,
    text: "test memory",
    hash: "abc123",
    vector: Array.from({ length: 384 }, (_, i) => Math.random()),
    sessionCreated: 0,
    lastReinforcedSession: 0,
    baseStrength: 1.0,
    halfLifeSessions: 20,
    accessCount: 0,
    lastAccessedSession: 0,
    recentAccessSessions: [],
    status: "active",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("MemoryVectorStore", () => {
  let store: MemoryVectorStore;

  beforeEach(() => {
    store = new MemoryVectorStore({ dimension: 384, dbPath: ":memory:" });
  });

  afterEach(async () => {
    await store.close();
  });

  test("insert and get a card", async () => {
    const card = makeCard({ text: "hello world" });
    await store.insert([card]);
    const retrieved = await store.get(card.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.text).toBe("hello world");
  });

  test("get returns null for missing card", async () => {
    const result = await store.get("nonexistent");
    expect(result).toBeNull();
  });

  test("search returns cards ordered by similarity", async () => {
    const card1 = makeCard({
      text: "coffee is delicious",
      vector: Array.from({ length: 384 }, (_, i) => (i === 0 ? 1 : 0)),
    });
    const card2 = makeCard({
      text: "tea is nice",
      vector: Array.from({ length: 384 }, (_, i) => (i === 1 ? 1 : 0)),
    });
    await store.insert([card1, card2]);

    const query = Array.from({ length: 384 }, (_, i) => (i === 1 ? 1 : 0));
    const results = await store.search(query, 2);
    expect(results).toHaveLength(2);
    expect(results[0].id).toBe(card2.id);
  });

  test("search filters by user_id", async () => {
    const card1 = makeCard({ userId: "alice" });
    const card2 = makeCard({ userId: "bob" });
    await store.insert([card1, card2]);

    const query = Array.from({ length: 384 }, () => 0.5);
    const results = await store.search(query, 10, { user_id: "alice" });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe(card1.id);
  });

  test("update card fields", async () => {
    const card = makeCard({ text: "original" });
    await store.insert([card]);
    await store.update(card.id, { text: "updated", hash: "def456" });

    const retrieved = await store.get(card.id);
    expect(retrieved!.text).toBe("updated");
    expect(retrieved!.hash).toBe("def456");
  });

  test("update throws for missing card", async () => {
    await expect(store.update("nonexistent", { text: "x" })).rejects.toThrow();
  });

  test("delete removes card", async () => {
    const card = makeCard();
    await store.insert([card]);
    await store.delete(card.id);
    const retrieved = await store.get(card.id);
    expect(retrieved).toBeNull();
  });

  test("list returns total count correctly", async () => {
    const cards = Array.from({ length: 5 }, (_, i) => makeCard({ text: `card-${i}` }));
    await store.insert(cards);

    const [results, total] = await store.list({}, 3);
    expect(results).toHaveLength(3);
    expect(total).toBe(5);
  });

  test("deleteAll removes everything", async () => {
    await store.insert([makeCard(), makeCard()]);
    await store.deleteAll();

    const [results, total] = await store.list({}, 100);
    expect(total).toBe(0);
  });

  test("deleteAll with filters only removes matching cards", async () => {
    await store.insert([makeCard({ userId: "alice" }), makeCard({ userId: "bob" })]);
    await store.deleteAll({ user_id: "alice" });

    const [results, total] = await store.list({}, 100);
    expect(total).toBe(1);
    expect(results[0].userId).toBe("bob");
  });

  test("rebuildIndex reloads vectors", async () => {
    const card = makeCard();
    await store.insert([card]);
    await store.rebuildIndex();

    const query = Array.from({ length: 384 }, () => 0.5);
    const results = await store.search(query, 1);
    expect(results).toHaveLength(1);
  });

  test("insert validates vector dimension", async () => {
    const badCard = makeCard({ vector: [1, 2, 3] });
    await expect(store.insert([badCard])).rejects.toThrow(/dimension mismatch/i);
  });

  test("list respects filters", async () => {
    await store.insert([
      makeCard({ userId: "u1", agentId: "a1" }),
      makeCard({ userId: "u2", agentId: "a1" }),
    ]);
    const [results, total] = await store.list({ user_id: "u1" }, 10);
    expect(total).toBe(1);
    expect(results[0].userId).toBe("u1");
  });
});
