# 03. データモデル

プロファイル・問題・アセット・セッション・回答ログ・スコアの構造。DB は **MySQL 8.4 + Drizzle**。
出題の意味論は [01](./01-quiz-domain.md)、生成手続きは [05](./05-content-pipeline.md)。

---

## 1. 全体像

```
encode_profile ──< question_encoding >── question ──── question_display_asset   （静的・ビルド成果物）
                          │                  │      └──< question_encoded_asset
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
| `id` | varchar (PK) | `q<品質>-<サブサンプリング>-<png最適化>-v<版>`。標準は `q95-444-oxi-v1` |
| `jpeg_quality` | int | 60 / 75 / 80 / 90 / 95 |
| `chroma_subsampling` | enum | `4:2:0` / `4:4:4` |
| `png_optimize` | bool | oxipng `-o4` をかけるか |
| `is_standard` | bool | 標準プロファイルのみ true。**エイリアス ID は作らない**（[01](./01-quiz-domain.md) §3.1） |
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
| `flat_ratio` | real | **隣接ペアのうち RGB が完全一致する割合**（定義は [05](./05-content-pipeline.md) §3.1）。PNG の効きを直接説明する指標 |
| `tags` | json | `noise` / `gradient` / `flat` / `text` / `low-color` / `blurred` など |
| `is_synthetic` | bool | 意地悪問題として加工したもの |
| `derivation` | json \| null | 加工内容（元素材 ID・操作列・**背景合成の色**） |
| `source` | json | 出典 URL・作者・**ライセンス**・取得日 |
| `explanation` | text \| null | 一行解説 |
| `status` | enum | `draft` / `published` / `retired` |

- 🔒 **`color_count` / `flat_ratio` / `tags` / `is_synthetic` / `derivation` は回答前のレスポンスに含めない。**
  いずれも「PNG が効く画像か」を直接示すので、**答えの方向が漏れる**（[04](./04-session-and-integrity.md) §3.5）。
  回答前に渡してよいのは **`display` の URL・寸法・`category`** だけ（[02](./02-architecture.md) §4-2）。
  `category`（写真 / イラスト …）は**画像を見れば分かる**ので、追加の手がかりにならない。

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

## 5. 配布アセット — 2 つのテーブルに分ける

🔒 **公開タイミングが違うものを 1 つのテーブル・1 つのキー空間にまとめない。**
出題時に公開する `display` と、回答後にだけ見せる `png` / `jpeg` は、
**キーが互いに導出できてはならない**（[04](./04-session-and-integrity.md) §3.4）。

### 5.1 `question_display_asset` — 出題時に配る（プロファイル非依存）

| カラム | 型 | 備考 |
|---|---|---|
| `question_id` | varchar (PK) | 1 問につき 1 行 |
| `object_key` | varchar | R2 のキー。**内容ハッシュ由来でよい**（公開してよい） |
| `bytes` / `content_type` / `sha256` | | `content_type` は必ず `image/webp` |

### 5.2 `question_encoded_asset` — 回答後に見せる（プロファイル依存）

| カラム | 型 | 備考 |
|---|---|---|
| `id` | varchar (PK) | **暗号学的乱数**（非 null の代理キー） |
| `question_id` / `profile_id` / `kind`(`png`\|`jpeg`) | | **この 3 列に UNIQUE 制約** |
| `object_key` | varchar | 🔒 **乱数由来**。`question_id` / `profile_id` / display のキーから**導出できてはならない** |
| `bytes` / `content_type` / `sha256` | nullable | キー予約の時点では未確定。成果物の生成後に埋める |
| `uploaded_at` | timestamp \| null | R2 への同期が完了した時刻。**null = 未アップロード**（再実行で解決する） |

- ⚠ **`object_key` を内容ハッシュにしてはいけない。** 出題画像（可逆 WebP）からピクセルは復元できるので、
  同じ手順で PNG を作ればハッシュが計算でき、回答前にキーを言い当てられる。
- **このテーブルがキーの唯一の正**。キーの発行は必ず DB への行作成が先で、
  同期は成果物と `object_key` の全件一致を前提条件とする（[05](./05-content-pipeline.md) §2）。
- ⚠ MySQL の主キー列は暗黙に NOT NULL になるため、**nullable な `profile_id` を PK に含めない**
  （テーブルを分けたのはこの制約も理由の一つ）。
- `bytes` は `question_encoding` にも冗長に持つ（出題クエリで JOIN しないため）。
  **一致を CI で検査する**（[05](./05-content-pipeline.md) §6）。

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
