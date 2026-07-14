import { Reranker } from "./base";

interface ActrConfig {
  baseLevelDecay: number;
  weight: number;
  fadeWeight: number;
  vectorWeight: number;
  minStrength: number;
}

const DEFAULT_ACTR_CONFIG: ActrConfig = {
  baseLevelDecay: 0.5,
  weight: 0.15,
  fadeWeight: 0.05,
  vectorWeight: 1.0,
  minStrength: 0.05,
};

/**
 * ACT-R + Fade リランカー
 *
 * スコア式:
 *   finalScore = vectorSimilarity^2
 *     × (1 + actrWeight × actrActivation)
 *     × (0.95 + fadeWeight × fadeStrength)
 *
 * ACT-R activation:
 *   activation = ln(Σ accessCount × currentSession^(-baseLevelDecay))
 *   normalized = sigmoid(activation)
 *
 * Fade strength:
 *   strength = baseStrength × 2^(-elapsedSessions / halfLifeSessions)
 */
export class ActrReranker implements Reranker {
  private config: ActrConfig;
  private currentSession: number;

  constructor(
    config: Partial<ActrConfig> = {},
    currentSession: number = 0,
  ) {
    this.config = { ...DEFAULT_ACTR_CONFIG, ...config };
    this.currentSession = currentSession;
  }

  setCurrentSession(session: number) {
    this.currentSession = session;
  }

  private sigmoid(x: number): number {
    return 1 / (1 + Math.exp(-x));
  }

  private computeActrActivation(card: {
    accessCount: number;
    lastAccessedSession: number;
    recentAccessSessions: number[];
  }): number {
    const { baseLevelDecay } = this.config;
    const now = this.currentSession;
    let activation = 0;
    const accessTimes = [
      ...card.recentAccessSessions,
      card.lastAccessedSession,
    ].filter((s) => s > 0);
    for (const session of accessTimes) {
      const elapsed = Math.max(now - session, 0.5);
      activation += elapsed ** (-baseLevelDecay);
    }
    const normalized = this.sigmoid(activation);
    return normalized;
  }

  private computeFadeStrength(card: {
    baseStrength: number;
    halfLifeSessions: number;
    lastReinforcedSession: number;
  }): number {
    const elapsed = Math.max(
      this.currentSession - card.lastReinforcedSession,
      0,
    );
    if (card.halfLifeSessions <= 0) return 1;
    return card.baseStrength * Math.pow(2, -elapsed / card.halfLifeSessions);
  }

  async rerank(
    query: string,
    cards: Array<{
      id: string;
      text: string;
      score: number;
      payload: Record<string, any>;
    }>,
    topK: number,
  ): Promise<
    Array<{
      id: string;
      text: string;
      score: number;
      payload: Record<string, any>;
    }>
  > {
    const startMs = Date.now();
    const { weight, fadeWeight, minStrength } = this.config;

    const scored = cards
      .map((card) => {
        const p = card.payload;
        const actrActivation = this.computeActrActivation({
          accessCount: p.accessCount ?? 0,
          lastAccessedSession: p.lastAccessedSession ?? 0,
          recentAccessSessions: p.recentAccessSessions ?? [],
        });
        const fadeStrength = this.computeFadeStrength({
          baseStrength: p.baseStrength ?? 1.0,
          halfLifeSessions: p.halfLifeSessions ?? 20,
          lastReinforcedSession: p.lastReinforcedSession ?? 0,
        });
        const vectorSim = card.score;

        // Fade threshold check
        if (fadeStrength < minStrength) {
          return null;
        }

        const finalScore =
          vectorSim * vectorSim *
          (1 + weight * actrActivation) *
          (0.95 + fadeWeight * fadeStrength);

        return {
          ...card,
          score: finalScore,
        };
      })
      .filter((c): c is NonNullable<typeof c> => c !== null);

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }
}


