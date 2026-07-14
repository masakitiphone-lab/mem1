import { Embedder } from "./base";
import { EmbeddingConfig } from "../types";

const SUPPORTED_MODELS = [
  "fast-all-MiniLM-L6-v2",
  "fast-bge-base-en",
  "fast-bge-base-en-v1.5",
  "fast-bge-small-en",
  "fast-bge-small-en-v1.5",
  "fast-bge-small-zh-v1.5",
  "fast-multilingual-e5-large",
] as const;
type FastEmbedModel = (typeof SUPPORTED_MODELS)[number];
const DEFAULT_MODEL: FastEmbedModel = "fast-bge-small-en-v1.5";

export class FastEmbedEmbedder implements Embedder {
  private readonly modelName: FastEmbedModel;
  private embeddingModel?: Promise<any>;

  constructor(config: EmbeddingConfig) {
    if (typeof config.model === "string" && config.model.length > 0) {
      if (!SUPPORTED_MODELS.includes(config.model as FastEmbedModel)) {
        throw new Error(
          `Unsupported FastEmbed model "${config.model}". ` +
            `Supported models: ${SUPPORTED_MODELS.join(", ")}.`,
        );
      }
      this.modelName = config.model as FastEmbedModel;
    } else {
      this.modelName = DEFAULT_MODEL;
    }
  }

  private getEmbeddingModel(): Promise<any> {
    if (!this.embeddingModel) {
      this.embeddingModel = this.initEmbeddingModel().catch((error) => {
        this.embeddingModel = undefined;
        throw error;
      });
    }

    return this.embeddingModel;
  }

  private async initEmbeddingModel(): Promise<any> {
    let sdk: any;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      sdk = require("fastembed");
    } catch {
      throw new Error(
        "The 'fastembed' package is required to use the FastEmbed embedder. Install it with: npm install fastembed",
      );
    }

    return sdk.FlagEmbedding.init({ model: this.modelName });
  }

  private normalizeInput(text: string): string {
    return text.replace(/\n/g, " ");
  }

  async embed(text: string): Promise<number[]> {
    const normalizedText = this.normalizeInput(text);
    const model = await this.getEmbeddingModel();
    const allEmbeddings: number[][] = [];

    for await (const batch of model.embed([normalizedText])) {
      for (const emb of batch) {
        if (emb !== undefined) {
          allEmbeddings.push(emb);
        }
      }
    }

    if (allEmbeddings.length === 0) {
      throw new Error("FastEmbed embed() returned no embeddings");
    }

    return allEmbeddings[0];
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const normalizedTexts = texts.map((text) => this.normalizeInput(text));
    const model = await this.getEmbeddingModel();
    const embeddings: number[][] = [];

    for await (const batch of model.embed(normalizedTexts)) {
      embeddings.push(...batch);
    }

    return embeddings;
  }
}
