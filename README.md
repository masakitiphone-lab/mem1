# Memory Card System (mem1)

ACT-R + Fade アーキテクチャを採用したローカルファーストの記憶システム。
モバイル・エッジ環境での動作を想定し、検索は **LLMを使わず0.5秒以内** を目標とします。

## アーキテクチャ

```
ユーザー発言
  │
  ├──▶ 検索（LLM不使用、<500ms）
  │      Embedding → ベクトル検索 → ACT-R+Fadeリランク → 強化 → 結果
  │
  └──▶ 記憶整理（一定セッション間隔でLLM使用）
        会話 → Gemini API → ADD / UPDATE / MERGE / IGNORE
```

### 3つの柱

| 仕組み | LLM使用 | 役割 |
|--------|---------|------|
| **検索** | ❌ 不使用 | ベクトル類似度 + ACT-R + Fade で高速検索 |
| **記憶整理** | ✅ Gemini | 会話から記憶を抽出・更新・マージ |
| **忘却（Fade）** | ❌ 不使用 | セッション経過で自動的に強度減衰、アーカイブ化 |

### 核心のスコア式（検索時）

```
最終スコア = ベクトル類似度² × (1 + 0.15 × ACT-R活性度) × (0.95 + 0.05 × Fade強度)
```

### 記憶カード（MemoryCard）

```json
{
  "id": "uuid",
  "text": "ユーザーはコーヒーが好き",
  "baseStrength": 1.0,
  "halfLifeSessions": 20,
  "accessCount": 3,
  "status": "active",
  "memoryType": "preference"
}
```

### 忘却の流れ

```
active ──▶ 強度 < 0.05 ──▶ archived ──▶ 強度 < 0.005 ──▶ deleted
```

### データストレージ

```
SQLite（正本）
├── cards テーブル: 本文、メタデータ、ACT-R履歴、Fade情報
└── vectors テーブル: ベクトル（BLOB）
      ↕ 起動時にメモリにロード（高速検索のため）
```

---

## TypeScript SDK（`mem0-ts/`）

### インストール

```bash
cd mem0-ts
npm install
# ローカルEmbeddingを使う場合（推奨）
npm install fastembed
```

### 環境変数

```bash
export GEMINI_API_KEY=your_key_here
```

### ライブラリとして使う

```ts
import { Memory } from "mem0-ts";

const mem = new Memory({
  embedder: { provider: "fastembed" },
  llm: { provider: "google", config: { apiKey: process.env.GEMINI_API_KEY } },
});

// 検索（LLM不使用）
const { results, metrics } = await mem.search("好きな食べ物は？", { topK: 5 });
console.log(metrics); // { embeddingMs, vectorSearchMs, rerankMs, totalMs }

// セッション進行（自動整理トリガー）
const { sessionCounter, consolidated } = await mem.addSession("user_1", [
  { role: "user", content: "ラーメンが好きです" },
]);

// 明示的記憶整理（LLM使用）
const result = await mem.consolidate({
  messages: [{ role: "user", content: "ラーメンが好きです" }],
  userId: "user_1",
});

// 強化
await mem.reinforce(["card-id-1", "card-id-2"]);

// Fade整理
await mem.archiveFaded({ strengthThreshold: 0.05 });
```

### APIサーバーとして使う

```bash
cd mem0-ts
npm run start
# http://localhost:3000/api/v1/health
```

```bash
# 検索
curl -X POST http://localhost:3000/api/v1/search \
  -H "Content-Type: application/json" \
  -d '{"query": "好きな食べ物は？", "topK": 5}'

# セッション
curl -X POST http://localhost:3000/api/v1/session \
  -H "Content-Type: application/json" \
  -d '{"scope": "user_1", "messages": [{"role": "user", "content": "ラーメンが好きです"}]}'
```

#### APIエンドポイント

| Method | Path | LLM使用 | 説明 |
|--------|------|---------|------|
| GET | `/api/v1/health` | ❌ | ヘルスチェック |
| GET | `/api/v1/metrics` | ❌ | 直近の検索レイテンシ |
| POST | `/api/v1/search` | ❌ | 記憶検索 |
| POST | `/api/v1/consolidate` | ✅ | 記憶整理 |
| POST | `/api/v1/session` | 条件次第 | セッション進行＋自動整理 |
| POST | `/api/v1/reinforce` | ❌ | 参照強化 |
| POST | `/api/v1/archive-faded` | ❌ | Fade整理 |
| GET | `/api/v1/cards` | ❌ | 一覧取得 |
| GET | `/api/v1/cards/:id` | ❌ | 個別取得 |
| DELETE | `/api/v1/cards/:id` | ❌ | 削除 |
| POST | `/api/v1/reset` | ❌ | 全リセット |
| POST | `/api/v1/rebuild-index` | ❌ | インデックス再構築 |

### ディレクトリ構成

```
mem0-ts/
├── src/
│   ├── index.ts                      メインエントリ
│   └── oss/src/
│       ├── memory/index.ts           Memoryクラス（全機能）
│       ├── memory/memory.types.ts    型定義
│       ├── rerankers/actr.ts         ACT-R + Fadeリランカー
│       ├── rerankers/base.ts         リランカーインターフェース
│       ├── vector_stores/memory.ts   SQLite正本 + メモリインデックス
│       ├── vector_stores/base.ts     ベクトルストアインターフェース
│       ├── embeddings/fastembed.ts   ローカルEmbedding（ONNX）
│       ├── embeddings/base.ts        Embeddingインターフェース
│       ├── llms/google.ts            Gemini API
│       ├── llms/base.ts              LLMインターフェース
│       ├── prompts/index.ts          記憶整理プロンプト
│       ├── storage/SQLiteManager.ts  履歴 + セッションカウンター
│       ├── storage/base.ts           HistoryManagerインターフェース
│       ├── config/defaults.ts        デフォルト設定
│       ├── config/manager.ts         設定マージ
│       ├── types/index.ts            MemoryCard型ほか
│       └── utils/factory.ts          ファクトリ
├── server/index.ts                   Express APIサーバー
└── package.json
```

---

## 元のMem0プロジェクトについて

このリポジトリは [mem0ai/mem0](https://github.com/mem0ai/mem0) をフォークしたものです。
元のPython SDK（`mem0/`）、FastAPIサーバー（`server/`）、Platform（`openmemory/`）などはそのまま残っています。

| ディレクトリ | 内容 |
|-------------|------|
| `mem0/` | 元のPython SDK（PyPI: mem0ai） |
| `mem0-ts/` | **本プロジェクトのTypeScript実装（ACT-R+Fade）** |
| `server/` | 元のFastAPI RESTサーバー（PostgreSQL + Neo4j） |
| `openmemory/` | 元のセルフホストプラットフォーム |
| `cli/` | CLIツール |

---

## ライセンス

Apache 2.0 — [LICENSE](LICENSE) 参照。
