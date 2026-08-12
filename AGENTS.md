# AGENTS.md

> このファイルがリポジトリの**正典**です（使用する各コーディングエージェント共通）。簡潔・リンク中心に保つこと。
> 詳細仕様は [`prd/`](./prd/)。コーディング規約（`.claude/rules/`）は**実装着手時に追加**する。

## プロジェクト目的

表示された画像を、**指定されたオプションで PNG / JPEG にエンコードしたとき、
どちらの配布サイズが小さいか**を当てる 2 択クイズ。**社外公開の一般向け。**
1 セッション 30 問、難易度が段階的に上がり、サプライザル得点でランキングを競う。
→ 詳細は [`prd/README.md`](./prd/README.md)。

## 現在のフェーズ

🚧 **Phase 0 完了 / Phase 1（MVP 実装）着手前**。主要仕様は確定済み、実装コードはまだ無い。

- 決定の**根拠と経緯**は [`prd/_grilling/decisions.md`](./prd/_grilling/decisions.md)。
  仕様に関わる判断をする前に読む（「なぜそうしなかったか」が書いてある）。
- エンコード条件の**実測データ**は [`prd/_grilling/measurements.md`](./prd/_grilling/measurements.md)。
  数値を語るときはここを参照する（推測で書かない）。

## ドキュメント（PRD）

| 文書 | 内容 |
|---|---|
| [prd/README.md](./prd/README.md) | 目的 / 体験の骨子 / 確定スタック / スコープ / 索引 |
| [prd/01-quiz-domain.md](./prd/01-quiz-domain.md) | 出題の定義 / **エンコードプロファイル** / 難易度 / 意地悪問題 |
| [prd/02-architecture.md](./prd/02-architecture.md) | 構成 / パッケージ / **モード抽象** / 画像配信 / デプロイ |
| [prd/03-data-model.md](./prd/03-data-model.md) | プロファイル / 問題 / アセット / セッション / **回答ログ** / スコア |
| [prd/04-session-and-integrity.md](./prd/04-session-and-integrity.md) | セッション / **脅威モデル T1〜T7** / 正解画面 |
| [prd/05-content-pipeline.md](./prd/05-content-pipeline.md) | 素材 → エンコード → 正解確定 → 難易度 → 蓄積 |
| [prd/06-ranking.md](./prd/06-ranking.md) | **得点式** / モード / ランキング / 結果統計 / 分析 |
| [prd/07-roadmap.md](./prd/07-roadmap.md) | フェーズ分け |

## 🔒 絶対に外さない設計原則

アプリの成立条件。**実装の都合で崩さない。**

1. **正解はサーバだけが持つ。採点もサーバ。** 回答を受け取るまで、正解・両形式のバイト数・
   PNG/JPEG アセットの URL を**クライアントへ一切渡さない**（[prd/04](./prd/04-session-and-integrity.md) §2）。
2. **答えの方向を示す情報を、回答前に出さない（T7）。** 秘匿対象は正解だけではない。
   **静的難易度の数値・得点の重み・問題別の実測正答率**も漏洩経路になる。
   二択では「みんなが間違える」＝「直感と逆が正解」が一意に決まるため、
   **実測正答率を得点や難易度に混ぜない**（[prd/04](./prd/04-session-and-integrity.md) §3.5）。
3. **出題画像は可逆 WebP で配る。PNG を直に配らない**（`png_bytes` が丸見えになる）。
   （[prd/04](./prd/04-session-and-integrity.md) §3）
4. **正解は事前に実測して確定する。** 実行時にエンコードしない。エンコーダのバージョンを記録し、
   版が変われば問題を作り直す（[prd/03](./prd/03-data-model.md) §2）。
5. **回答後は全部見せる。** PNG / JPEG 両方の実物とバイト数、20 プロファイルの結果を提示し、
   開発者ツールで検証できる状態にする（[prd/04](./prd/04-session-and-integrity.md) §4）。
   これは仕様であって、消してよい装飾ではない。
6. **モードは差し替え可能に保つ。** 競技基準は遊びながら足していく前提。
   `quiz-core` を**フレームワーク非依存の純関数**に保つ（[prd/02](./prd/02-architecture.md) §4-1）。

## 技術スタック

- **Next.js（App Router）** / **MySQL 8.4 + Drizzle** / **Cloudflare R2**（画像）/ **self-host**
- TypeScript(ESM, strict) / Zod / TailwindCSS v4 / Biome / Vitest / pnpm（workspace + catalog）
- 画像処理（sharp / oxipng / mozjpeg）は**オフラインのパイプライン専用**。実行時には持ち込まない。
- Vite + Hono 版は **Phase 2**（`quiz-core` / `database` を共有して載せる）。

### ⚠ 実装時に必ず踏む落とし穴

- **`sharp.png()` は `effort` を明示しないと 4 倍のサイズになる。** `compressionLevel` はほぼ効かず、
  `palette: false` を明示すると `effort` 指定が無視される。
- **可逆パレット化は oxipng が担う。** sharp の `palette: true` は非可逆量子化なので使わない。
- **リサイズは PNG を大きく不利にする。** 素材は原寸で扱う。
- 根拠はすべて [`prd/_grilling/measurements.md`](./prd/_grilling/measurements.md)。

## パッケージ構成（予定）

```
packages/
  quiz-core/  # モード定義・出題選択・採点・得点計算・Zod スキーマ【フレームワーク非依存】
  database/   # Drizzle スキーマ・マイグレーション・seed
  pipeline/   # 素材 → エンコード → 正解確定 → アセット生成（オフライン専用）
  web/        # Next.js（App Router）。UI + Route Handlers
```

## 開発コマンド（予定）

```bash
pnpm dev          # docker compose watch（db + web）
pnpm typecheck    # 全パッケージ tsc --noEmit
pnpm lint         # Biome lint
pnpm format       # Biome format
pnpm test         # Vitest
pnpm db:migrate   # Drizzle マイグレーション適用
pnpm db:seed      # encode_profile などのシード投入（冪等）
pnpm quiz:build   # 素材 → 問題データ + アセット生成
pnpm quiz:upload  # 生成アセットを R2 へ同期
```

## 運用上の約束

- **環境変数の実体（`.env*`）はコミットしない。** 雛形は `*.example` を置く。
- **本番・開発環境の具体情報（ドメイン / TLS / リバプロ / 接続先 / シークレット）は公開リポジトリに含めない。**
- 素材は**出典・作者・ライセンスが取れるものだけ**採用する（[prd/05](./prd/05-content-pipeline.md) §1）。
- **生成アセットはコミットしない**（R2 が正）。

## ローカル専用メモ（任意）

`.claude-personal/`（gitignore 対象）が**存在する場合は**、その中のファイルも参照してよい。
リポジトリに残したくないローカル限定のルール・運用情報をそこに置く。

- **作業の続き**: `.claude-personal/TASKS.md` が**あれば、セッション開始時に必ず読む**。
