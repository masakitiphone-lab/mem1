export interface HistoryEntry {
  cardId: string;
  action: "ADD" | "UPDATE" | "MERGE" | "DELETE" | "ARCHIVE";
  previousText: string | null;
  newText: string | null;
  createdAt: string;
}

export interface HistoryManager {
  addHistory(entry: HistoryEntry): Promise<void>;
  getHistory(cardId: string): Promise<HistoryEntry[]>;
  getSessionCounter?(scope: string): Promise<number>;
  incrementSessionCounter?(scope: string): Promise<number>;
  reset(): Promise<void>;
  close(): void;
}
