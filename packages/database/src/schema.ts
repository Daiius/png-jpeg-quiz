import {
  bigint,
  boolean,
  double,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  primaryKey,
  text,
  timestamp,
  unique,
  varchar,
} from 'drizzle-orm/mysql-core'

/**
 * prd/03 の 9 テーブル。**上段（問題）は不変**でパイプラインが作り、
 * **下段（セッション・ログ）だけが実行時に動く**。
 */

// ============================================================
// 上段: 問題（ビルド成果物・不変）
// ============================================================

/** prd/03 §2 — エンコード条件（20 行） */
export const encodeProfile = mysqlTable('encode_profile', {
  id: varchar('id', { length: 32 }).primaryKey(),
  jpegQuality: int('jpeg_quality').notNull(),
  chromaSubsampling: mysqlEnum('chroma_subsampling', ['4:2:0', '4:4:4']).notNull(),
  pngOptimize: boolean('png_optimize').notNull(),
  isStandard: boolean('is_standard').notNull().default(false),
  pngOptions: json('png_options').notNull(),
  jpegOptions: json('jpeg_options').notNull(),
  preprocess: json('preprocess').notNull(),
  toolVersions: json('tool_versions').notNull(),
  publishedLabel: varchar('published_label', { length: 255 }).notNull(),
  /** このプロファイルのプールでの PNG 正解率。得点計算に使う（prd/06 §1） */
  pngWinRate: double('png_win_rate').notNull().default(0),
})

/** prd/03 §3 — 画像そのもの（プロファイル非依存） */
export const question = mysqlTable('question', {
  id: varchar('id', { length: 64 }).primaryKey(),
  width: int('width').notNull(),
  height: int('height').notNull(),
  category: mysqlEnum('category', [
    'photo',
    'illustration',
    'screenshot',
    'pixel-art',
    'render',
    'synthetic',
  ]).notNull(),
  /** 257 = 256 超 */
  colorCount: int('color_count').notNull(),
  /** 隣接ペアのうち RGB が完全一致する割合（prd/05 §3.1） */
  flatRatio: double('flat_ratio').notNull(),
  tags: json('tags').notNull(),
  /** 🔑 **「合成問題」**（prd/05 §4 の意地悪問題）かどうか。AI 生成の別とは別物 */
  isSynthetic: boolean('is_synthetic').notNull().default(false),
  /**
   * 生成 AI で作られた素材か（`meta.json` の `is_ai_generated`）。
   *
   * 🔒 **開示義務がある**（prd/05 §1.1。人間作と偽らない）。`/credits` はこれを唯一の根拠にする。
   * ⚠ **出典サイト名から推測しない。** 表記が変わった瞬間に黙って開示が落ちる。
   * ⚠ **`is_synthetic` と混同しない。** あちらは「際どい問題として合成したか」。
   *
   * 🔒 **`null` = 未宣言**（この列より前に作られた行）。**`false` で埋めない。**
   * 既定 `false` にすると、パイプラインを流し直すまで
   * **AI 生成の問題が「AI ではない」と表示され、開示義務を静かに落とす**。
   * `null` なら「未確認」として検出でき、公開前に気づける。
   */
  isAiGenerated: boolean('is_ai_generated'),
  derivation: json('derivation'),
  source: json('source').notNull(),
  explanation: text('explanation'),
  status: mysqlEnum('status', ['draft', 'published', 'retired']).notNull().default('draft'),
})

/** prd/03 §4 — 条件ごとの結果（問題 × プロファイル） */
export const questionEncoding = mysqlTable(
  'question_encoding',
  {
    questionId: varchar('question_id', { length: 64 }).notNull(),
    profileId: varchar('profile_id', { length: 32 }).notNull(),
    pngBytes: int('png_bytes').notNull(),
    jpegBytes: int('jpeg_bytes').notNull(),
    answer: mysqlEnum('answer', ['png', 'jpeg']).notNull(),
    log2Ratio: double('log2_ratio').notNull(),
    /** 🔒 回答前のレスポンスに含めない（prd/04 §3.5） */
    difficulty: double('difficulty').notNull(),
    /**
     * JPEG が原本をどれだけ狂わせたか（prd/03 §4）。参照は可逆 PNG ＝ 原本と画素単位で同一。
     *
     * **null = 未計測**（劣化の計測より前に作られた行）。
     * 🔒 これも回答前のレスポンスに含めない。劣化量は素材の性質と相関するため（prd/04 §3.5）。
     */
    de00Mean: double('de00_mean'),
    de00P99: double('de00_p99'),
    de00Max: double('de00_max'),
    /** 🔒 検証ビューの主指標。平均は集中型素材で知覚閾値を下回る（measurements §8.2） */
    de00Over2Pct: double('de00_over2_pct'),
  },
  (table) => [
    primaryKey({ columns: [table.questionId, table.profileId] }),
    index('question_encoding_pick_idx').on(table.profileId, table.difficulty),
    index('question_encoding_answer_idx').on(table.profileId, table.answer),
  ],
)

/** prd/03 §5.1 — 出題時に配る（プロファイル非依存）。キーは内容ハッシュ由来でよい */
export const questionDisplayAsset = mysqlTable('question_display_asset', {
  questionId: varchar('question_id', { length: 64 }).primaryKey(),
  objectKey: varchar('object_key', { length: 255 }).notNull().unique(),
  bytes: int('bytes').notNull(),
  /** 🔒 必ず image/webp（prd/04 §3.1） */
  contentType: varchar('content_type', { length: 64 }).notNull(),
  sha256: varchar('sha256', { length: 64 }).notNull(),
  uploadedAt: timestamp('uploaded_at'),
})

/**
 * prd/03 §5.2 — 回答後に見せる（プロファイル依存）。
 *
 * 🔒 **このテーブルが `object_key` の唯一の正。** キーは暗号学的乱数で、
 * `question_id` / `profile_id` / display のキー / 内容ハッシュのいずれからも導出できてはならない。
 */
export const questionEncodedAsset = mysqlTable(
  'question_encoded_asset',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    questionId: varchar('question_id', { length: 64 }).notNull(),
    profileId: varchar('profile_id', { length: 32 }).notNull(),
    kind: mysqlEnum('kind', ['png', 'jpeg']).notNull(),
    objectKey: varchar('object_key', { length: 255 }).notNull().unique(),
    /** キー予約の時点では未確定。成果物の生成後に埋める */
    bytes: int('bytes'),
    contentType: varchar('content_type', { length: 64 }),
    sha256: varchar('sha256', { length: 64 }),
    /** null = 未アップロード（再実行で解決する） */
    uploadedAt: timestamp('uploaded_at'),
  },
  (table) => [
    unique('question_encoded_asset_triple_uq').on(table.questionId, table.profileId, table.kind),
  ],
)

/**
 * prd/03 §5.3 — 検証ビューの劣化オーバーレイ（回答後に見せる）。
 *
 * 🔑 **`profile_id` で持たない。** PNG 最適化の有無は JPEG を変えないので、オーバーレイも
 * 変わらない。20 プロファイルに対して**実体は 10 通り**（5 品質 × 2 サブサンプリング）。
 * プロファイル単位で持つとバイトが 2 倍重複する。
 *
 * 🔒 `object_key` は `question_encoded_asset` と同じ**乱数方式**。
 * 劣化量は素材の性質と相関し、素材の性質は答えと相関する（prd/04 §4.1）。
 */
export const questionOverlayAsset = mysqlTable(
  'question_overlay_asset',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    questionId: varchar('question_id', { length: 64 }).notNull(),
    jpegQuality: int('jpeg_quality').notNull(),
    chromaSubsampling: mysqlEnum('chroma_subsampling', ['4:2:0', '4:4:4']).notNull(),
    metric: mysqlEnum('metric', ['de00', 'ssim']).notNull(),
    objectKey: varchar('object_key', { length: 255 }).notNull().unique(),
    /**
     * 🔒 **描画器の版**（配色・上限・合成方法）。**完成品を配る**ので、
     * 変えたら全件作り直しになる。版の不一致はビルドを止める（prd/05 §6, §7）。
     */
    rendererVersion: varchar('renderer_version', { length: 64 }).notNull(),
    bytes: int('bytes'),
    contentType: varchar('content_type', { length: 64 }),
    sha256: varchar('sha256', { length: 64 }),
    uploadedAt: timestamp('uploaded_at'),
  },
  (table) => [
    unique('question_overlay_asset_quad_uq').on(
      table.questionId,
      table.jpegQuality,
      table.chromaSubsampling,
      table.metric,
    ),
  ],
)

// ============================================================
// 下段: セッションとログ（実行時に動く）
// ============================================================

/** prd/03 §6 — 1 プレイ */
export const session = mysqlTable('session', {
  id: varchar('id', { length: 64 }).primaryKey(),
  /** Cookie に入れる所有証明（prd/04 §2） */
  secret: varchar('secret', { length: 128 }).notNull(),
  mode: varchar('mode', { length: 32 }).notNull(),
  /** 🔒 セッション開始時に固定。途中で変えられない */
  profileId: varchar('profile_id', { length: 32 }).notNull(),
  startedAt: timestamp('started_at').notNull().defaultNow(),
  finishedAt: timestamp('finished_at'),
  status: mysqlEnum('status', ['active', 'finished', 'abandoned']).notNull().default('active'),
  currentIndex: int('current_index').notNull().default(0),
  questionCount: int('question_count').notNull(),
  /** 🔒 サーバが計算した値のみ */
  correctCount: int('correct_count').notNull().default(0),
  streak: int('streak').notNull().default(0),
  maxStreak: int('max_streak').notNull().default(0),
  score: double('score').notNull().default(0),
  displayName: varchar('display_name', { length: 64 }),
  clientMeta: json('client_meta'),
})

/** prd/03 §7 — 出題と回答のログ（分析の土台） */
export const sessionQuestion = mysqlTable(
  'session_question',
  {
    sessionId: varchar('session_id', { length: 64 }).notNull(),
    // `index` は MySQL の予約語なので、カラム名は question_index にする
    questionIndex: int('question_index').notNull(),
    questionId: varchar('question_id', { length: 64 }).notNull(),
    profileId: varchar('profile_id', { length: 32 }).notNull(),
    /**
     * 🔒 経過時間の基準はサーバのこの時刻（クライアント申告値は使わない）。
     *
     * ⚠ **`fsp: 3` が要る。** MySQL の TIMESTAMP は既定が秒精度で、**四捨五入される**。
     * 丸めで最大 0.5 秒未来にずれると、`elapsed_ms` が負になって
     * 「人間に不可能な速さ」（prd/04 §5）の判定に誤って引っかかる。
     */
    servedAt: timestamp('served_at', { fsp: 3 }).notNull().defaultNow(),
    answeredAt: timestamp('answered_at', { fsp: 3 }),
    answer: mysqlEnum('answer', ['png', 'jpeg']),
    isCorrect: boolean('is_correct'),
    /**
     * ⚠ **`BIGINT` が要る。** 制限時間を廃止した（prd/04 §5.1）ので経過時間に上限が無くなり、
     * 符号付き `INT` の上限 2,147,483,647ms（**約 24.9 日**）を超えうる。
     * 開きっぱなしのタブから数週間後に回答すると、範囲外エラーで
     * 回答トランザクションごと失敗し、その問題から先へ進めなくなる。
     */
    elapsedMs: bigint('elapsed_ms', { mode: 'number' }),
    /** ⚠ ヒント使用時は**減点適用後**の値（prd/06 §7.2） */
    awardedPoints: double('awarded_points'),
    /** 出題時点の静的難易度（後で式を変えても再計算できるように） */
    difficultyAtServe: double('difficulty_at_serve').notNull(),
    /**
     * 色数ヒントを開示した時刻（prd/03 §7 / prd/06 §7）。null = 未使用。
     * 🔒 **永続化が開示に先行する**——この列を書いた後にだけレンジを返す（prd/04 §3.6）。
     * 回答済み（`answered_at` 非 null）の行には書かない。
     */
    hintUsedAt: timestamp('hint_used_at', { fsp: 3 }),
  },
  (table) => [
    primaryKey({ columns: [table.sessionId, table.questionIndex] }),
    // 同一セッション内の重複出題を防ぐ
    unique('session_question_unique_question').on(table.sessionId, table.questionId),
    index('session_question_stats_idx').on(table.questionId, table.profileId),
    index('session_question_answered_idx').on(table.answeredAt),
  ],
)

/** prd/03 §8 — 集計（🔒 得点計算には使わない。分析と回答後表示のみ） */
export const questionStats = mysqlTable(
  'question_stats',
  {
    questionId: varchar('question_id', { length: 64 }).notNull(),
    profileId: varchar('profile_id', { length: 32 }).notNull(),
    shown: int('shown').notNull().default(0),
    correct: int('correct').notNull().default(0),
    avgElapsedMs: int('avg_elapsed_ms').notNull().default(0),
    updatedAt: timestamp('updated_at').notNull().defaultNow().onUpdateNow(),
  },
  (table) => [primaryKey({ columns: [table.questionId, table.profileId] })],
)

/** prd/03 §9 — ランキング掲載（セッション確定時のスナップショット） */
export const scoreEntry = mysqlTable(
  'score_entry',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    sessionId: varchar('session_id', { length: 64 }).notNull().unique(),
    displayName: varchar('display_name', { length: 64 }),
    mode: varchar('mode', { length: 32 }).notNull(),
    profileId: varchar('profile_id', { length: 32 }).notNull(),
    score: double('score').notNull(),
    correctCount: int('correct_count').notNull(),
    maxStreak: int('max_streak').notNull(),
    questionCount: int('question_count').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    /** 不正疑い。集計から外すが本人には見せる */
    flagged: boolean('flagged').notNull().default(false),
  },
  (table) => [
    index('score_entry_rank_idx').on(table.mode, table.score),
    index('score_entry_daily_idx').on(table.mode, table.createdAt),
  ],
)

export const schema = {
  encodeProfile,
  question,
  questionEncoding,
  questionDisplayAsset,
  questionEncodedAsset,
  questionOverlayAsset,
  session,
  sessionQuestion,
  questionStats,
  scoreEntry,
}
