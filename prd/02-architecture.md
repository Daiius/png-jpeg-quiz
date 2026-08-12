# 02. アーキテクチャ

技術構成と、後から差し替えるための境界を定める。選定の経緯は
[`_grilling/decisions.md`](./_grilling/decisions.md) §2.1。

---

## 1. このアプリの技術的な性質

スタックはこの性質から逆算している。

1. **状態が小さい。** セッション（進行中の 1 プレイ）と回答ログとスコアだけ。
2. **画像配信が支配的。** 転送量のほぼ全部が画像 → **R2 に逃がす**（§5）。
3. **問題データはビルド成果物。** 正解は事前に実測して確定する（[05](./05-content-pipeline.md)）。
   **実行時にエンコードしない** → サーバに画像処理ランタイム（sharp / oxipng）は要らない。
4. **秘匿すべき情報が明確。** 「その問題の正解」と、**答えの方向を示唆するすべての値**
   （[04](./04-session-and-integrity.md) §3）。それ以外は公開してよい。
5. **SEO / OGP に価値がある。** 結果を SNS で共有させたい（[06](./06-ranking.md) §5）。

```
[ 素材（手動 / フリー素材集） ]
            │  オフライン: 20 プロファイルでエンコードして実測 → 正解・難易度・派生アセット（05）
            ▼
   問題データ（正解入り）＋ 画像アセット ──────> Cloudflare R2（display / png / jpeg）
            │                                              │ CDN
            ▼                                              ▼
  ブラウザ ──> Next.js（Route Handlers）──> MySQL（セッション・回答ログ・スコア）
```

## 2. 技術スタック

| 領域 | 採用 | 備考 |
|---|---|---|
| 言語 | TypeScript（ESM, strict） | |
| フレームワーク | **Next.js（App Router）** | Route Handlers で API、Server Components で初期表示・OGP |
| DB | **MySQL 8.4** | self-host 環境あり |
| ORM | **Drizzle ORM** | |
| バリデーション | **Zod** | `quiz-core` に単一の真実 |
| スタイル | **TailwindCSS v4** | |
| Lint/Format | **Biome** | |
| テスト | **Vitest**（+ Playwright で E2E） | `quiz-core` の単体テスト重視 |
| パッケージ管理 | **pnpm**（workspace + catalog、`minimumReleaseAge`） | |
| 開発環境 | **docker compose watch** | |
| 画像配信 | **Cloudflare R2** + カスタムドメイン | egress 無料。§5 |
| 画像処理 | sharp / oxipng(wasm) / mozjpeg | **オフラインのパイプライン専用**。実行時には持ち込まない |

## 3. パッケージ構成（pnpm monorepo）

```
packages/
  quiz-core/  # 【フレームワーク非依存】モード定義・出題選択・採点・得点計算・Zod スキーマ
  database/   # Drizzle スキーマ・マイグレーション・DB クライアント・seed
  pipeline/   # 素材 → エンコード → 正解確定 → アセット生成（オフライン専用。05）
  web/        # Next.js（App Router）。UI + Route Handlers
```

依存方向: `quiz-core` ← `database` ← `web` / `pipeline`（`quiz-core` は最上流で他に依存しない）

> **Vite+Hono 版（Phase 2）** は `packages/web-vite` + `packages/server-hono` を足す形で載る。
> `quiz-core` と `database` はそのまま共有される。

## 4. 後から差し替えるための境界

### 4-1. `quiz-core` のモード抽象（最重要）

**遊んでみて思いついた競技基準を後から足せるようにする。** モードを次の 4 点で定義する:

```ts
interface QuizMode {
  id: string                                   // 'standard-30' | 'endless' | 'confidence' ...
  pickNext(state, pool): Question | null       // 出題選択と終了条件（null で終了）
  score(question, answer, ctx): number         // 得点計算
  allowProfileChoice: boolean                  // 条件選択を許すか
}
```

- MVP は `standard-30`（30 問・条件選択あり・サプライザル得点）のみ実装する。
- 後から足す候補: **endless（連勝）**、**confidence（確信度つき log score）**、デイリーの変則ルール。
- ⚠ **DB も HTTP も知らない純関数**に保つ。ここが Vite+Hono 版と共有される本体になる。

### 4-2. HTTP 契約

| エンドポイント | 役割 | 返してはいけないもの |
|---|---|---|
| `POST /api/session` | セッション開始（mode / profile を指定） | — |
| `GET /api/session/:id/question` | 現在の問題（`display` URL・寸法・カテゴリ） | **正解 / 両形式のバイト数 / png・jpeg の URL / 難易度の数値 / 得点の重み** |
| `POST /api/session/:id/answer` | 回答 → 判定・正解・両形式の URL とバイト数・20 プロファイルの結果・解説 | — |
| `POST /api/session/:id/finish` | 確定してスコア登録 | — |
| `GET /api/leaderboard` | ランキング | — |
| `GET /api/session/:id/result` | 結果（パーセンタイル・分布・問題別正答率） | — |

詳細と対タンパ要件は [04](./04-session-and-integrity.md)。

### 4-3. 画像配信レイヤ

```ts
type AssetKind = 'display' | 'png' | 'jpeg'
interface AssetLocator { urlFor(questionId: string, profileId: string, kind: AssetKind): string }
```

- 実体は R2 のカスタムドメイン。すべて不変なので `immutable` キャッシュでよい。
- `display` は**プロファイルに依存しない**（表示する元画像は 1 つ）。`png` / `jpeg` はプロファイル別。
- 🔒 **`png` / `jpeg` の URL は回答前のクライアントに渡さない。** 内容ハッシュ由来の推測不能な ID にする。

## 5. 画像配信（Cloudflare R2）

- **転送量のほぼ全部が画像**だが、R2 は **egress が無料**でカスタムドメイン経由で CDN に載る。
  → ホスティング側の転送量制約が消え、[04](./04-session-and-integrity.md) §3 の選択肢を狭めない。
- 総量の見積もり: 1 問あたり `display` 1 + `png` 2 + `jpeg` 10 = 13 ファイル。
  200 問で 2,600 ファイル・**数百 MB**（無料枠 10GB 内）。
- ⚠ **画像レスポンスに `Content-Encoding` を効かせない**。将来パディングを導入する場合、
  ゼロ埋めは圧縮で潰れて元サイズが漏れる（**ランダムバイトで埋める**）。

## 6. 開発環境

- `docker compose watch` で `db`（MySQL）と `web`（Next.js dev）を起動。bind mount は最小。
- 主要コマンド（予定）:

| コマンド | 内容 |
|---|---|
| `pnpm dev` | docker compose watch |
| `pnpm typecheck` / `lint` / `format` / `test` | tsc / Biome / Vitest |
| `pnpm db:migrate` / `db:seed` | Drizzle マイグレーション / seed |
| `pnpm quiz:build` | 素材 → 問題データ + アセット生成（[05](./05-content-pipeline.md)） |
| `pnpm quiz:upload` | 生成アセットを R2 へ同期 |

- 環境変数の実体（`.env*`）は**コミットしない**。雛形 `*.example` を置く。

## 7. デプロイ姿勢

- **self-host**（Next.js standalone / docker compose）。前段にリバースプロキシ（TLS 終端）。
- **マイグレーションと seed は本番イメージに同梱**し、使い捨てコンテナとして明示的に実行する
  （適用する SQL とコードのバージョンが構造的に一致する。起動時の自動適用にはしない）。
- **本番・開発環境の具体情報（ドメイン / TLS / リバプロ / 接続先 / シークレット）は公開リポジトリに含めない。**
  ローカル限定の運用メモは gitignore 対象の `.claude-personal/` に置き、「存在すれば参照」する。
