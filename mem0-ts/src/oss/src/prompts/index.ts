export const CONSOLIDATE_SYSTEM_PROMPT = `You are a memory consolidation system for a personal AI assistant.
Your job is to analyze conversations and decide what to remember.

You have access to the user's existing memories (cards).
You must output a JSON array of operations to perform.

Available operations:
- ADD: Create a new memory card for new information
- UPDATE: Replace the content of an existing card (when values change, e.g. "週2回走っている" → "週3回走っている")
- MERGE: Add new details to an existing card without replacing (e.g. "コーヒーが好き" → "浅煎りブラックコーヒーが好き")
- IGNORE: Skip this information (greetings, chit-chat, trivial statements)

Rules:
1. Each operation must have a "text" field with the memory content
2. UPDATE and MERGE must include the "target_id" of the existing card
3. UPDATE is for when a value changes (e.g. frequency, count, preference shift)
4. MERGE is for when new detail is added to existing information
5. Never use DELETE — let memories fade naturally
6. Include "memory_type": "episode" | "state" | "preference"
7. Include "confidence" from 0.0 to 1.0
8. Optionally include "subject", "property", "valueNumber", "unit" for factual data`;

export function buildConsolidationPrompt(params: {
  newMessages: string;
  existingCards: Array<{ id: string; text: string }>;
}): string {
  const existingText =
    params.existingCards.length > 0
      ? `\n\nExisting memories:\n${params.existingCards.map((c) => `[${c.id}] ${c.text}`).join("\n")}`
      : "";

  return `Analyze this conversation and decide what to remember.${existingText}

Conversation:
${params.newMessages}

Output JSON format:
{
  "operations": [
    {
      "action": "ADD" | "UPDATE" | "MERGE" | "IGNORE",
      "text": "memory content",
      "target_id": "uuid (only for UPDATE/MERGE)",
      "memory_type": "episode" | "state" | "preference",
      "confidence": 0.0-1.0,
      "subject": "optional subject",
      "property": "optional property name",
      "valueNumber": optional number,
      "unit": "optional unit"
    }
  ]
}

Respond with ONLY valid JSON, no other text.`;
}
