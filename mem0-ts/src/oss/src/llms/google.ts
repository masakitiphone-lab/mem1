import { GoogleGenAI } from "@google/genai";
import { LLM, LLMResponse, ToolDef } from "./base";
import { LLMConfig, Message } from "../types";

export class GoogleLLM implements LLM {
  private google: GoogleGenAI;
  private model: string;
  private timeoutMs: number;
  private retryCount: number;

  constructor(config: LLMConfig) {
    if (!config.apiKey) {
      throw new Error(
        "Gemini API key is required. Set GEMINI_API_KEY environment variable or pass apiKey in config.",
      );
    }
    this.google = new GoogleGenAI({ apiKey: config.apiKey });
    this.model = config.model || "gemini-2.0-flash";
    this.timeoutMs = config.timeoutMs ?? 30000;
    this.retryCount = config.retryCount ?? 2;
  }

  private async fetchWithRetry<T>(
    request: () => Promise<T>,
  ): Promise<T> {
    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= this.retryCount; attempt++) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);
        try {
          const result = await request();
          return result;
        } finally {
          clearTimeout(timer);
        }
      } catch (e: unknown) {
        lastError = e as Error;
        if (attempt < this.retryCount) {
          const delay = Math.min(1000 * Math.pow(2, attempt), 8000);
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    }
    throw lastError;
  }

  private formatContents(messages: Message[]) {
    return messages
      .filter((msg) => msg.role !== "system")
      .map((msg) => ({
        parts: [
          {
            text:
              typeof msg.content === "string"
                ? msg.content
                : JSON.stringify(msg.content),
          },
        ],
        role: msg.role === "assistant" ? "model" : "user",
      }));
  }

  private getSystemInstruction(messages: Message[]): string | undefined {
    const systemMsg = messages.find((msg) => msg.role === "system");
    return systemMsg?.content;
  }

  async generateResponse(
    messages: Message[],
    responseFormat?: { type: string },
    tools?: ToolDef[],
  ): Promise<string | LLMResponse> {
    const contents = this.formatContents(messages);
    const systemInstruction = this.getSystemInstruction(messages);

    const config: Record<string, any> = {};
    if (systemInstruction) {
      config.systemInstruction = systemInstruction;
    }
    if (responseFormat?.type === "json_object") {
      config.responseMimeType = "application/json";
    }
    if (tools && tools.length > 0) {
      config.tools = [
        {
          functionDeclarations: tools.map((tool) => ({
            name: tool.function.name,
            description: tool.function.description,
            parameters: tool.function.parameters,
          })),
        },
      ];
    }

    const completion = await this.fetchWithRetry(() =>
      this.google.models.generateContent({
        contents,
        model: this.model,
        config: Object.keys(config).length > 0 ? config : undefined,
      }),
    );

    if (completion.functionCalls && completion.functionCalls.length > 0) {
      return {
        content: completion.text || "",
        role: "assistant",
        toolCalls: completion.functionCalls.map((call: { name?: string; args?: Record<string, unknown> }) => ({
          name: call.name ?? "",
          arguments: JSON.stringify(call.args),
        })),
      };
    }

    const text = completion.text
      ?.replace(/^```(?:json)?\n?/, "")
      .replace(/\n```$/, "");

    return text || "";
  }

  async generateChat(messages: Message[]): Promise<LLMResponse> {
    const systemInstruction = this.getSystemInstruction(messages);
    const config: Record<string, any> = {};
    if (systemInstruction) {
      config.systemInstruction = systemInstruction;
    }

    const completion = await this.fetchWithRetry(() =>
      this.google.models.generateContent({
        contents: this.formatContents(messages),
        model: this.model,
        config: Object.keys(config).length > 0 ? config : undefined,
      }),
    );

    const response = completion.candidates?.[0]?.content;
    const content =
      response?.parts?.map((part: { text?: string }) => part.text || "").join("") ||
      completion.text ||
      "";

    return {
      content,
      role: response?.role || "assistant",
    };
  }
}
