const mockGenerateContent = jest.fn();
const mockGoogleGenAI = jest.fn().mockImplementation(() => ({
  models: { generateContent: mockGenerateContent },
}));

jest.mock("@google/genai", () => ({
  GoogleGenAI: mockGoogleGenAI,
}));

import { GoogleLLM } from "../google";

describe("GoogleLLM", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGenerateContent.mockResolvedValue({
      text: "mock response",
      functionCalls: [],
      candidates: [{
        content: { role: "model", parts: [{ text: "mock chat response" }] },
      }],
    });
  });

  test("constructor throws without apiKey", () => {
    expect(() => new GoogleLLM({})).toThrow(/API key/i);
  });

  test("generateResponse returns text", async () => {
    const llm = new GoogleLLM({ apiKey: "test-key" });
    const result = await llm.generateResponse([
      { role: "system", content: "You are a helpful assistant." },
      { role: "user", content: "Hello" },
    ]);
    expect(result).toBe("mock response");
  });

  test("generateResponse strips JSON code fences", async () => {
    mockGenerateContent.mockResolvedValue({
      text: "```json\n{\"key\": \"value\"}\n```",
      functionCalls: [],
    });

    const llm = new GoogleLLM({ apiKey: "test-key" });
    const result = await llm.generateResponse(
      [{ role: "user", content: "test" }],
      { type: "json_object" },
    );
    expect(result).toBe('{"key": "value"}');
  });

  test("generateResponse passes systemInstruction correctly", async () => {
    const llm = new GoogleLLM({ apiKey: "test-key" });
    await llm.generateResponse([
      { role: "system", content: "You are a bot." },
      { role: "user", content: "Hi" },
    ]);

    const callArgs = mockGenerateContent.mock.calls[0][0];
    expect(callArgs.config.systemInstruction).toBe("You are a bot.");
    expect(callArgs.contents).toHaveLength(1);
    expect(callArgs.contents[0].role).toBe("user");
  });

  test("generateChat returns LLMResponse", async () => {
    const llm = new GoogleLLM({ apiKey: "test-key" });
    const result = await llm.generateChat([
      { role: "user", content: "Hello" },
    ]);
    expect(result.content).toBe("mock chat response");
    expect(result.role).toBe("model");
  });

  test("generateResponse sets responseMimeType for json_object", async () => {
    const llm = new GoogleLLM({ apiKey: "test-key" });
    await llm.generateResponse(
      [{ role: "user", content: "test" }],
      { type: "json_object" },
    );

    const callArgs = mockGenerateContent.mock.calls[0][0];
    expect(callArgs.config.responseMimeType).toBe("application/json");
  });
});
