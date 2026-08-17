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
              #   劣化指標（ΔE00 / SSIM）と検証ビューのオーバーレイ描画もここ
  web/        # Next.js（App Router）。UI + Route Handlers
```

依存方向: `quiz-core` ← `database` ← `web` / `pipeline`（`quiz-core` は最上流で他に依存しない）

> 🔑 **劣化指標を `quiz-core` に置かない。** ΔE00 / SSIM はフレームワーク非依存の純関数なので
> 置けてしまうが、`quiz-core` は**実行時に web が読む**パッケージであり、
> 出題・採点の語彙に閉じておきたい。**画像を触るものは実行時に持ち込まない**（§1）という
> 線引きにも合うので、`pipeline/` 側に置く（[05](./05-content-pipeline.md) §6）。

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
| `POST /api/session` | セッション開始（mode / profile を指定。**省略時はサーバが既定を選ぶ**。[06](./06-ranking.md) §2.1） | — |
| `GET /api/session/:id/question` | 現在の問題（`display` URL・寸法・カテゴリ）＋ **そのセッションの mode / profile** | **正解 / 両形式のバイト数 / png・jpeg の URL / 難易度の数値 / 得点の重み** |
| `POST /api/session/:id/answer` | 回答 → 判定・正解・両形式の URL とバイト数・20 プロファイルの結果・解説 | — |
| `POST /api/session/:id/finish` | 確定してスコア登録 | — |
| `GET /api/leaderboard` | ランキング | — |
| `GET /api/session/:id/result` | 結果（パーセンタイル・分布・問題別正答率） | — |

詳細と対タンパ要件は [04](./04-session-and-integrity.md)。

### 4-3. 画像配信レイヤ

🔒 **公開タイミングの違う 2 種類を、別々のキー空間に置く。**

```ts
// 出題時に配る。プロファイル非依存。キーは内容ハッシュ由来でよい
interface DisplayLocator { urlFor(questionId: string): string }

// 回答後にだけ配る。キーは DB に保持した乱数で、上の URL からも ID からも導出できない
interface EncodedLocator { urlFor(assetId: string): string }
```

- 実体は R2 のカスタムドメイン。すべて不変なので `immutable` キャッシュでよい。
- 🔒 **`png` / `jpeg` のキーを `question_id` / `profile_id` / display のキーから導出しない。**
  URL をレスポンスに含めないだけでは不十分で、**パスが推測できれば回答前に HEAD で答えが取れる**。
  → キーは暗号学的乱数にして DB に保持する（[03](./03-data-model.md) §5.2）。
- ⚠ **内容ハッシュも不可**。出題画像（可逆 WebP）からピクセルは復元できるため、
  同じ手順で PNG を作ればハッシュを計算できてしまう。

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
| `pnpm dev:remote` | 同上 ＋ `.env.remote`（リモート dev 公開。→ §6.2。`:logs` / `:down` あり） |
| `pnpm typecheck` / `lint` / `format` / `test` | tsc / Biome / Vitest |
| `pnpm test:e2e` | Playwright E2E。**稼働中の dev スタックに対して**実行する（→ §6.3） |
| `pnpm db:migrate` / `db:seed` | Drizzle マイグレーション / seed。⚠ **コンテナ内で実行する**（下記） |
| `pnpm quiz:build` | 素材 → 問題データ + アセット生成（[05](./05-content-pipeline.md)） |
| `pnpm quiz:upload` | 生成アセットを R2 へ同期 |

- 環境変数の実体（`.env*`）は**コミットしない**。雛形 `*.example` を置く。

### 6.1 DB を触るコマンドは `web` コンテナの中で実行する

```bash
docker compose exec web pnpm db:migrate   # マイグレーション適用
docker compose exec web pnpm db:seed      # シード投入（冪等）
```

⚠ **ホストから直に `pnpm db:migrate` を叩いても届かない。** MySQL は compose 網内だけで動かしていて
ホストにポートを出していない（他プロジェクトとの 3306 衝突を避けるため）。`web` コンテナには
`DATABASE_URL` が注入済みで、ソースも `develop.watch` で同期されている。

- 🔒 **起動時の自動適用にはしない**（§7）。本番は使い捨てコンテナ、開発はこの `exec`。
  どちらも「適用した SQL」と「動いているコード」の版が構造的に一致する。
- ホストから直接叩きたいときは `compose.override.yaml` で db に `ports` を足し、
  `.env` の `DATABASE_URL`（`127.0.0.1:3306` 向け）を有効にする。

### 6.2 リモート dev 公開（`pnpm dev:remote`）

常駐マシン上の dev スタックを、前段プロキシ（TLS 終端＋認証を担うトンネル等）越しに手元ブラウザから
使うための構成。**ローカル dev と compose / next 設定を分けない**。単一の `compose.yaml` と
`next.config.ts` を env でパラメータ化し、remote 差分は `.env.remote` だけに集約する
（[`.env.remote.example`](../.env.remote.example)）。差分は次の 3 つのみ:

| 差分 | ローカル既定 | remote | 効かせ方 |
|---|---|---|---|
| 公開オリジン | `http://localhost:3000` | `PUBLIC_ORIGIN=https://<host>` | `next.config.ts` の `allowedDevOrigins`／絶対 URL 生成 |
| 画像のベース URL | `http://localhost:3000/assets` | `ASSET_BASE_URL=https://<host>/assets` | `web/src/env.ts`（R2 へ移すまでは web 自身が配る） |
| web のホスト公開 | `0.0.0.0:3000`（全 IF） | `127.0.0.1` の 1 ポート | compose `${WEB_BIND}:${WEB_PORT}` |

- **ホストにポートを出すのは web だけ**（db は compose 網内のみ）。前段プロキシはその 1 バインドへ
  向ける。他プロジェクトとのポート衝突も避けられる。
- ⚠ **compose は `--env-file` を渡すと既定の `.env` を読まなくなる。** そのため
  `--env-file .env --env-file .env.remote`（**後勝ち**）の 2 段で渡し、DB 認証情報などの共通の値は
  `.env` に残したまま `.env.remote` には差分だけを置く。
- ⚠ **Next 16 の dev サーバは `/_next/*`・`/__nextjs*` へのクロスオリジン要求を既定で 403 にする。**
  ページ遷移の GET は Origin を送らないので通るが、**HMR の WebSocket は Origin を送るので落ちる**
  （画面は出るのに更新が反映されない、という形で現れる）。`PUBLIC_ORIGIN` の host を
  `allowedDevOrigins` に入れて回避している。
- 公開先は**必ず前段の認証で保護する**。dev スタックは検証ビュー等の内部情報をそのまま見せる。
- 前段プロキシは compose の外で常駐させる。**公開ホスト名・ポート・その具体設定は公開リポに書かない**（§7）。

### 6.3 E2E（Playwright）

`pnpm test:e2e` は**稼働中の dev スタック**（§6）に対して実行する。サーバの起動は行わない
（CI への組み込みは M4）。接続先は `E2E_BASE_URL` で上書きできる
（既定は `http://localhost:${WEB_PORT:-3000}`）。

- **通しの完走テスト**: 開いた瞬間の出題 → 回答 → 正解画面 → 次問 → 完走。
  ⚠ 画像の読み込みには依存しない（dev:remote では `ASSET_BASE_URL` が認証付きの公開ホストを
  指すため。§6.2）。
- **出題レスポンスの契約テスト**: 回答前のレスポンスの**生 JSON** のキー集合が許可リストと
  **完全一致**すること（[04](./04-session-and-integrity.md) §3.5 / T7 の回帰防止）。
  ⚠ Zod の parse 後を見ても余計なキーの混入は見えない（スキーマが strip するため）。
- **`DEV_QUESTION_COUNT`**（dev / E2E 専用の環境変数）: セッションの問題数を上から抑え、
  完走を短時間で再現する。🔒 **本番ビルドでは無効**。`quiz-core` のモード定義には持ち込まず、
  web 側で丸める（30 問固定の意味論を汚さない）。

## 7. デプロイ姿勢

- **self-host**（Next.js standalone / docker compose）。前段にリバースプロキシ（TLS 終端）。
- **マイグレーションと seed は本番イメージに同梱**し、使い捨てコンテナとして明示的に実行する
  （適用する SQL とコードのバージョンが構造的に一致する。起動時の自動適用にはしない）。
- **本番・開発環境の具体情報（ドメイン / TLS / リバプロ / 接続先 / シークレット）は公開リポジトリに含めない。**
  ローカル限定の運用メモは gitignore 対象の `.claude/local/` に置き、「存在すれば参照」する。
