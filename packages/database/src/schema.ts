import {
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
  isSynthetic: boolean('is_synthetic').notNull().default(false),
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
    /** 🔒 経過時間の基準はサーバのこの時刻（クライアント申告値は使わない） */
    servedAt: timestamp('served_at').notNull().defaultNow(),
    answeredAt: timestamp('answered_at'),
    answer: mysqlEnum('answer', ['png', 'jpeg']),
    isCorrect: boolean('is_correct'),
    elapsedMs: int('elapsed_ms'),
    awardedPoints: double('awarded_points'),
    /** 出題時点の静的難易度（後で式を変えても再計算できるように） */
    difficultyAtServe: double('difficulty_at_serve').notNull(),
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
  session,
  sessionQuestion,
  questionStats,
  scoreEntry,
}
