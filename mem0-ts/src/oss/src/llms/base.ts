import { Message } from "../types";

export interface LLMResponse {
  content: string;
  role: string;
  toolCalls?: Array<{
    name: string;
    arguments: string;
  }>;
}

export interface ToolDef {
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface LLM {
  generateResponse(
    messages: Array<{ role: string; content: string }>,
    response_format?: { type: string },
    tools?: ToolDef[],
  ): Promise<string | LLMResponse>;
  generateChat(messages: Message[]): Promise<LLMResponse>;
}
