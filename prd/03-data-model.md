# 03. データモデル

プロファイル・問題・アセット・セッション・回答ログ・スコアの構造。DB は **MySQL 8.4 + Drizzle**。
出題の意味論は [01](./01-quiz-domain.md)、生成手続きは [05](./05-content-pipeline.md)。

---

## 1. 全体像

```
encode_profile ──< question_encoding >── question ──< question_asset >   （静的・ビルド成果物）
                          │                  │
                          └──────────────────┴──< session_question >── session ──< score_entry
                                                          │                              （実行時）
                                                          └──> question_stats（分析用の集計）
```

**上段（問題）は不変**。パイプラインが生成し、実行時には読むだけ。
**下段（セッション・ログ）だけが可変**。バックアップ・移行の粒度もこの線で分かれる。

> 🔑 **同じ画像でも、プロファイルが違えば別の答え・別の難易度になる。**
> だから「画像の属性」（`question`）と「条件ごとの結果」（`question_encoding`）を分ける。

## 2. `encode_profile` — エンコード条件（20 行）

| カラム | 型 | 備考 |
|---|---|---|
| `id` | varchar (PK) | 例: `q80-420-oxi`（標準 = `std-v1` のエイリアス） |
| `jpeg_quality` | int | 60 / 75 / 80 / 90 / 95 |
| `chroma_subsampling` | enum | `4:2:0` / `4:4:4` |
| `png_optimize` | bool | oxipng `-o4` をかけるか |
| `is_standard` | bool | `std-v1` のみ true |
| `png_options` / `jpeg_options` / `preprocess` | json | 完全なオプション（再現用） |
| `tool_versions` | json | sharp / libvips / oxipng / mozjpeg の版 |
| `published_label` | varchar | サイトに表示する説明文 |
| `png_win_rate` | real | **このプロファイルのプールでの PNG 正解率**。得点計算に使う（[06](./06-ranking.md) §1） |

- ⚠ `png_win_rate` は**問題プールが変わるたびに再計算**する。得点式の `p` はここから来る。
- ⚠ プロファイルを更新したら**再エンコードして問題を作り直す**。既存の答えを黙って書き換えない。
  新 `id` を発行し、旧プロファイルは `retired` にする（拮抗問題は反転しうる）。

## 3. `question` — 画像そのもの（プロファイル非依存）

| カラム | 型 | 備考 |
|---|---|---|
| `id` | varchar (PK) | 内容ハッシュ由来の**推測不能な ID** |
| `width` / `height` | int | |
| `category` | enum | `photo` / `illustration` / `screenshot` / `pixel-art` / `render` / `synthetic` |
| `color_count` | int | 257 = 256 超（可逆パレット化の可否に効く） |
| `tags` | json | `noise` / `gradient` / `flat` / `text` / `low-color` / `blurred` など |
| `is_synthetic` | bool | 意地悪問題として加工したもの |
| `derivation` | json \| null | 加工内容（元素材 ID・操作列） |
| `source` | json | 出典 URL・作者・**ライセンス**・取得日 |
| `explanation` | text \| null | 一行解説 |
| `status` | enum | `draft` / `published` / `retired` |

## 4. `question_encoding` — 条件ごとの結果（問題 × プロファイル）

| カラム | 型 | 備考 |
|---|---|---|
| `question_id` / `profile_id` | 複合 PK | |
| `png_bytes` / `jpeg_bytes` | int | **実測値** |
| `answer` | enum(`png`,`jpeg`) | 派生値だが明示的に持つ（出題クエリの主役） |
| `log2_ratio` | real | `log2(png_bytes / jpeg_bytes)` |
| `difficulty` | real | **静的難易度**。`|log2_ratio|` から算出し、直感との逆行で加点 |

- **インデックス**: `(profile_id, difficulty)`（出題選択）、`(profile_id, answer)`（偏りの集計）。
- 🔒 **`difficulty` と `log2_ratio` は回答前のレスポンスに含めない**（[04](./04-session-and-integrity.md) §3.5）。

## 5. `question_asset` — 配布物

| `kind` | プロファイル依存 | 内容 | 公開タイミング |
|---|---|---|---|
| `display` | **しない** | 出題中に見せる**可逆 WebP**（[04](./04-session-and-integrity.md) §3） | 出題時 |
| `png` | する（2 通り） | その条件の PNG 実物 | **回答後のみ** |
| `jpeg` | する（10 通り） | その条件の JPEG 実物 | **回答後のみ** |

| カラム | 型 |
|---|---|
| `question_id` / `profile_id`(nullable) / `kind` | 複合 PK |
| `path` | varchar（R2 のキー） |
| `bytes` / `content_type` / `sha256` | |

> `png` / `jpeg` の `bytes` は `question_encoding` にも冗長に持つ（出題クエリで JOIN しないため）。
> **一致を CI で検査する**（[05](./05-content-pipeline.md) §6）。

## 6. `session` — 1 プレイ

| カラム | 型 | 備考 |
|---|---|---|
| `id` | varchar (PK) | 推測不能。URL に出す |
| `secret` | varchar | Cookie に入れる所有証明（[04](./04-session-and-integrity.md) §2） |
| `mode` | varchar | `standard-30` ほか。`quiz-core` のモード ID（[02](./02-architecture.md) §4-1） |
| `profile_id` | FK | **セッション開始時に固定**。途中で変えられない |
| `started_at` / `finished_at` | timestamp | |
| `status` | enum | `active` / `finished` / `abandoned` |
| `current_index` | int | |
| `correct_count` / `streak` / `max_streak` | int | **サーバが計算した値のみ** |
| `score` | real | 同上 |
| `display_name` | varchar \| null | ランキング登録時に入る |
| `client_meta` | json | UA・言語など（不正検知の材料。個人特定はしない） |

## 7. `session_question` — 出題と回答のログ（分析の土台）

**MVP で作り込むべきはここ。** 可視化は後から足せるが、取らなかったログは戻らない。

| カラム | 型 | 備考 |
|---|---|---|
| `session_id` / `index` | 複合 PK | |
| `question_id` / `profile_id` | FK | |
| `served_at` | timestamp | **サーバが出題した時刻**。経過時間の基準 |
| `answered_at` | timestamp \| null | |
| `answer` | enum \| null | ユーザーの選択 |
| `is_correct` | bool \| null | サーバ判定 |
| `elapsed_ms` | int \| null | `answered_at - served_at`（**クライアント申告値は使わない**） |
| `awarded_points` | real \| null | 実際に付与した得点 |
| `difficulty_at_serve` | real | 出題時点の静的難易度（後で式を変えても再計算できるように） |

- **`(session_id, question_id)` に一意制約**（同一セッション内の重複出題を防ぐ）。
- 回答は 1 回だけ。`answer` が既に入っている行への再 POST は拒否する。
- **インデックス**: `(question_id, profile_id)`（問題別集計）、`(answered_at)`（時系列）。

## 8. `question_stats` — 集計（分析と回答後表示のみ）

| カラム | 型 |
|---|---|
| `question_id` / `profile_id` | 複合 PK |
| `shown` / `correct` | int |
| `avg_elapsed_ms` | int |
| `updated_at` | timestamp |

- 🔒 **得点計算には使わない。**「みんなが間違える」＝「直感と逆が正解」が漏れるため
  （[04](./04-session-and-integrity.md) §3.5）。用途は**運営分析**と**回答後の表示**に限る。
- `session_question` から再計算できる派生テーブル。バッチで更新する。

## 9. `score_entry` — ランキング掲載

セッション確定時に**スナップショット**を切る（後からセッションを触っても順位が動かない）。

| カラム | 型 |
|---|---|
| `id` / `session_id` | |
| `display_name` | varchar |
| `mode` / `profile_id` | |
| `score` | real |
| `correct_count` / `max_streak` / `question_count` | int |
| `created_at` | timestamp |
| `flagged` | bool（不正疑い。集計から外す） |

- **インデックス**: `(mode, score desc)`（メインランキング）、`(mode, created_at)`（日次）。
- **プロファイルが違っても同じランキングに載る**（サプライザル正規化。[06](./06-ranking.md) §1）。
  `profile_id` は表示と分析のために持つ。

## 10. 認証とユーザー

- **MVP は認証なし**。ランキングは「表示名 + セッション」で登録する。
- **`user_id` 列は置かない**。必要になったら ALTER で足す（先回りしない）。
