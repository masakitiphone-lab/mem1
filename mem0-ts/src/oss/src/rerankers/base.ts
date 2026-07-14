export interface Reranker {
  setCurrentSession?(session: number): void;
  rerank(
    query: string,
    cards: Array<{ id: string; text: string; score: number; payload: Record<string, any> }>,
    topK: number,
  ): Promise<Array<{ id: string; text: string; score: number; payload: Record<string, any> }>>;
}
