import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  closeDatabase,
  type Database,
  encodeProfile,
  getDatabase,
  question,
  questionDisplayAsset,
  questionEncoding,
  questionOverlayAsset,
} from '@png-jpeg-quiz/database'
import { ENCODE_PROFILES, findProfile, STANDARD_PROFILE_ID } from '@png-jpeg-quiz/quiz-core'
import { and, eq } from 'drizzle-orm'
import {
  type De00Scalars,
  de00Map,
  de00Scalars,
  OVERLAY_METRICS,
  RENDERER_VERSION,
  renderOverlay,
  ssimMap,
} from './degradation.ts'
import {
  decodeToRaw,
  encodeDisplay,
  encodeForProfile,
  encodeOverlay,
  toolVersions,
} from './encode.ts'
import {
  displayObjectKey,
  recordEncodedAsset,
  recordOverlayAsset,
  reserveEncodedKey,
  reserveOverlayKey,
} from './keys.ts'
import { normalize } from './normalize.ts'
import { loadSources, questionIdFor, type SourceAsset } from './source.ts'

/**
 * `pnpm quiz:build` — 素材 → 問題データ + アセット（prd/05 §3）。
 *
 * ⚠ **オフライン専用。** 実行時（web）にこのコードは載らない。
 * 生成物はコミットしない（prd/05 §2）。
 */

export interface BuildOptions {
  sourceDir: string
  outDir: string
  /**
   * 🔒 **既定は 20 プロファイルすべて**（prd/05 §3 ステップ 5）。
   * 絞るのは開発中に手早く回すときだけで、その成果物で `published` にしてはいけない。
   */
  profileIds?: readonly string[]
  /** 素材を絞る（動作確認用） */
  only?: readonly string[]
}

export interface BuildSummary {
  questions: number
  encodings: number
  /** 20 プロファイルが揃わず draft のままの問題（出題されない） */
  draft: number
  skipped: { name: string; reason: string }[]
  /** 素材が `assets/source/` から消えたので取り下げた問題（素材名） */
  retired: string[]
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/** 劣化は JPEG だけで決まるので、`(品質, サブサンプリング)` を単位にする（prd/03 §5.3） */
function comboKeyOf(jpegQuality: number, chromaSubsampling: string): string {
  return `${jpegQuality}|${chromaSubsampling}`
}

async function buildOne(
  database: Database,
  asset: SourceAsset,
  outDir: string,
  profileIds: readonly string[],
): Promise<{ encodings: number; skipped?: string; status?: 'draft' | 'published' }> {
  const questionId = questionIdFor(asset.contentHash)
  const image = await normalize(asset.bytes, { flatten: asset.meta.preprocess?.flatten })

  // --- 表示用アセット（🔒 可逆 WebP。PNG は絶対に配らない。prd/04 §3.1）---
  const display = await encodeDisplay(image)
  const displayKey = displayObjectKey(asset.contentHash)
  await writeAsset(outDir, displayKey, display)

  // --- 20（M1 は 1）プロファイルのエンコードと判定 ---
  const results = []
  for (const profileId of profileIds) {
    const profile = ENCODE_PROFILES.find((p) => p.id === profileId)
    if (!profile) throw new Error(`知らないプロファイル: ${profileId}`)
    const result = await encodeForProfile(image, profile)
    // 同点の問題は採用しない（prd/01 §1）
    if (result) results.push(result)
  }
  if (results.length === 0) {
    return { encodings: 0, skipped: '全プロファイルで同点（採用しない）' }
  }

  const derivation = {
    ...(asset.meta.derivation ?? {}),
    sourceName: asset.name,
    ...(image.flattenedWith ? { flatten: image.flattenedWith } : {}),
  }

  await database
    .insert(question)
    .values({
      id: questionId,
      width: image.width,
      height: image.height,
      category: asset.meta.category,
      colorCount: Math.min(image.colorCount, 257),
      flatRatio: image.flatRatio,
      tags: asset.meta.tags,
      isSynthetic: false,
      isAiGenerated: asset.meta.is_ai_generated ?? false,
      derivation,
      source: asset.meta.source,
      explanation: asset.meta.explanation ?? null,
      // status は最後に決める（20 プロファイルとオーバーレイが揃って初めて published にする）
    })
    .onDuplicateKeyUpdate({
      set: {
        width: image.width,
        height: image.height,
        category: asset.meta.category,
        colorCount: Math.min(image.colorCount, 257),
        flatRatio: image.flatRatio,
        tags: asset.meta.tags,
        isAiGenerated: asset.meta.is_ai_generated ?? false,
        derivation,
        source: asset.meta.source,
        explanation: asset.meta.explanation ?? null,
        /**
         * 🔒 **再生成に入る前に `draft` へ落とす。**
         *
         * アセットは 1 枚ずつ更新するので、途中で例外やプロセス停止が起きると
         * **不完全なまま・`renderer_version` が混ざったまま `published` で配信され続ける**。
         * 先に降ろしておけば、最悪でも「出題されない」で止まる。
         * 揃ったかどうかはこの関数の末尾で確かめて、そこで初めて `published` に戻す。
         */
        status: 'draft',
      },
    })

  const displayValues = {
    objectKey: displayKey,
    bytes: display.byteLength,
    contentType: 'image/webp',
    sha256: sha256(display),
  }
  await database
    .insert(questionDisplayAsset)
    .values({ questionId, ...displayValues })
    .onDuplicateKeyUpdate({ set: displayValues })

  // --- 劣化の計測とオーバーレイ（prd/05 §6 / prd/04 §4.1）---
  //
  // 🔑 **PNG 最適化の有無は JPEG を変えない。** 20 プロファイルに対して
  // 実体は 10 通り（5 品質 × 2 サブサンプリング）なので、条件ごとに 1 度だけ測る。
  const degradation = new Map<string, De00Scalars>()
  for (const result of results) {
    const profile = findProfile(result.profileId)
    if (!profile) throw new Error(`知らないプロファイル: ${result.profileId}`)
    const combo = comboKeyOf(profile.jpegQuality, profile.chromaSubsampling)
    if (degradation.has(combo)) continue

    const decoded = await decodeToRaw(result.jpeg)
    const de00 = de00Map(image.raw, decoded)
    degradation.set(combo, de00Scalars(de00))

    // 🔒 オーバーレイのキーも乱数（prd/04 §4.1）。劣化量は答えと相関する
    for (const metric of OVERLAY_METRICS) {
      const map = metric === 'de00' ? de00 : ssimMap(image.raw, decoded)
      const overlay = await encodeOverlay(
        renderOverlay(decoded, map, metric),
        image.width,
        image.height,
      )
      const reserved = await reserveOverlayKey(database, {
        questionId,
        jpegQuality: profile.jpegQuality,
        chromaSubsampling: profile.chromaSubsampling,
        metric,
        rendererVersion: RENDERER_VERSION,
      })
      await writeAsset(outDir, reserved.objectKey, overlay)
      await recordOverlayAsset(database, reserved.id, {
        bytes: overlay.byteLength,
        sha256: sha256(overlay),
        contentType: 'image/webp',
      })
    }
  }

  for (const result of results) {
    const profile = findProfile(result.profileId)
    const scalars = profile
      ? degradation.get(comboKeyOf(profile.jpegQuality, profile.chromaSubsampling))
      : undefined
    const encodingValues = {
      pngBytes: result.pngBytes,
      jpegBytes: result.jpegBytes,
      answer: result.answer,
      log2Ratio: result.log2Ratio,
      difficulty: result.difficulty,
      de00Mean: scalars?.mean ?? null,
      de00P99: scalars?.p99 ?? null,
      de00Max: scalars?.max ?? null,
      de00Over2Pct: scalars?.over2Pct ?? null,
    }
    await database
      .insert(questionEncoding)
      .values({ questionId, profileId: result.profileId, ...encodingValues })
      .onDuplicateKeyUpdate({ set: encodingValues })

    // 🔒 キーは DB 先行で予約する（prd/05 §2）。生成物のキーは常に DB の写し
    for (const kind of ['png', 'jpeg'] as const) {
      const bytes = kind === 'png' ? result.png : result.jpeg
      const reserved = await reserveEncodedKey(database, questionId, result.profileId, kind)
      await writeAsset(outDir, reserved.objectKey, bytes)
      await recordEncodedAsset(database, reserved.id, {
        bytes: bytes.byteLength,
        sha256: sha256(bytes),
        contentType: kind === 'png' ? 'image/png' : 'image/jpeg',
      })
    }
  }

  // 🔒 **現行 20 プロファイルすべてが揃った問題だけを published にする**（prd/05 §3, §6）。
  // 揃っていないと正解画面が「他の条件ならどうなるか」を出せない（prd/04 §4）。
  // ⚠ **行数で数えない。** 旧版のプロファイル行が残っている運用では、
  // 20 行あっても現行プロファイルが欠けていることがある。**現行 ID の集合で確かめる。**
  const existing = await database
    .select({ profileId: questionEncoding.profileId })
    .from(questionEncoding)
    .where(eq(questionEncoding.questionId, questionId))
  const presentIds = new Set(existing.map((row) => row.profileId))

  // 🔒 **オーバーレイが 10 条件 × 2 指標そろっていることも条件**（prd/05 §7）。
  // 欠けたまま published にすると、正解画面の検証ビューが空になる。
  // ⚠ **現行の `renderer_version` のものだけを数える**（版が変われば作り直しが要る。prd/05 §6）。
  const overlays = await database
    .select({
      jpegQuality: questionOverlayAsset.jpegQuality,
      chromaSubsampling: questionOverlayAsset.chromaSubsampling,
      metric: questionOverlayAsset.metric,
    })
    .from(questionOverlayAsset)
    .where(
      and(
        eq(questionOverlayAsset.questionId, questionId),
        eq(questionOverlayAsset.rendererVersion, RENDERER_VERSION),
      ),
    )
  const presentOverlays = new Set(
    overlays.map((row) => `${comboKeyOf(row.jpegQuality, row.chromaSubsampling)}|${row.metric}`),
  )
  const overlaysComplete = ENCODE_PROFILES.every((profile) =>
    OVERLAY_METRICS.every((metric) =>
      presentOverlays.has(
        `${comboKeyOf(profile.jpegQuality, profile.chromaSubsampling)}|${metric}`,
      ),
    ),
  )

  // TODO(spec): 本来はここで draft に入れ、人手レビュー（prd/05 §3 ステップ 11）を経て
  // published にする。レビュー UI は M3 以降なので、当面は揃った時点で published にする。
  const status =
    ENCODE_PROFILES.every((profile) => presentIds.has(profile.id)) && overlaysComplete
      ? 'published'
      : 'draft'
  await database.update(question).set({ status }).where(eq(question.id, questionId))

  return { encodings: results.length, status }
}

async function writeAsset(outDir: string, objectKey: string, bytes: Buffer): Promise<void> {
  const target = path.join(outDir, 'assets', objectKey)
  await mkdir(path.dirname(target), { recursive: true })
  await writeFile(target, bytes)
}

/**
 * ⚠ **MySQL の JSON カラムはキーの順序を保持しない**（内部でソートして持つ）。
 * 書いたときの `JSON.stringify` と読んだときの文字列は一致しないので、
 * **キーを並べ替えてから比べる**。
 */
function canonicalJson(value: unknown): string {
  const entries = Object.entries((value ?? {}) as Record<string, unknown>)
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return JSON.stringify(entries)
}

/**
 * 🔒 **エンコーダの版が変わったら、既存プロファイルを黙って上書きしない**（prd/03 §2）。
 *
 * 版が変わればバイト数も変わり、**拮抗問題では正解が反転しうる**（prd/01 §3.3）。
 * それを既存の `profile_id` に上書きすると、過去のセッションが参照した条件の意味が後から変わり、
 * さらに immutable キャッシュで配った URL の中身と実体が食い違う。
 *
 * ここでは**検出して止める**だけにする。新しい版のプロファイル ID を発行して
 * 旧プロファイルを `retired` にする手順（prd/03 §2）は運用の判断なので、自動ではやらない。
 */
async function guardToolVersions(database: Database, profileIds: readonly string[]): Promise<void> {
  const versions = toolVersions()

  for (const profileId of profileIds) {
    const rows = await database
      .select({ toolVersions: encodeProfile.toolVersions })
      .from(encodeProfile)
      .where(eq(encodeProfile.id, profileId))
      .limit(1)

    const stored = rows[0]?.toolVersions
    if (!stored) {
      throw new Error(`プロファイルが seed されていない: ${profileId}（pnpm db:seed を先に流す）`)
    }

    // seed 直後は空。まだ 1 度もエンコードしていないので、ここで記録してよい
    const isUnrecorded = Object.keys(stored as Record<string, unknown>).length === 0
    if (isUnrecorded) {
      await database
        .update(encodeProfile)
        .set({ toolVersions: versions })
        .where(eq(encodeProfile.id, profileId))
      continue
    }

    if (canonicalJson(stored) !== canonicalJson(versions)) {
      throw new Error(
        [
          `エンコーダの版が ${profileId} の記録と違う（prd/03 §2）。`,
          `  記録: ${canonicalJson(stored)}`,
          `  現在: ${canonicalJson(versions)}`,
          '既存の答えを上書きしない。新しい版のプロファイル ID を発行し、旧プロファイルを retired にすること。',
        ].join('\n'),
      )
    }
  }
}

/**
 * 素材が `assets/source/` から消えた問題を `retired` にする。
 *
 * ⚠ **素材を退避しても DB の行は残る。** 実際、`ai-photo-portrait` を
 * `assets/excluded/` へ移した後も `published` のまま出題され続けていた（prd/05 §1.2）。
 * 素材を消したことが出題に反映されないと、**採らないと決めた素材が配られ続ける。**
 *
 * TODO(spec): prd/05 に「素材を取り下げたときの手順」が無い。最小の実装として、
 * **全素材を対象にしたビルドのときだけ**、現在の素材から作られる `question.id` の集合に
 * 無い `published` を `retired` にする。`--only` で絞ったビルドでは何もしない。
 *
 * 🔑 **素材名ではなく `question.id`（内容ハッシュ由来）で判定する。**
 * 素材名で見ると、**同じファイル名のまま中身を差し替えた**ときに取り下げが漏れる
 * （新しい内容ハッシュで別の問題が作られる一方、旧問題は名前が残っているので生き延びる）。
 * 不適格と分かった画像を同名で置き換える運用は普通にありうる。
 *
 * ⚠ **`derivation.sourceName` を持たない行は触らない。** 合成問題（prd/05 §4）など、
 * `assets/source/` に対応する素材が無い問題を巻き込まないため。
 *
 * ⚠ **アセットは消さない。** 過去のセッションが参照した URL を壊さないため。
 * R2 側の掃除は孤児掃除コマンドの担当（prd/05 §2）。
 */
async function retireRemovedSources(
  database: Database,
  currentQuestionIds: ReadonlySet<string>,
): Promise<string[]> {
  const rows = await database
    .select({ id: question.id, derivation: question.derivation })
    .from(question)
    .where(eq(question.status, 'published'))

  const retired: string[] = []
  for (const row of rows) {
    const name = (row.derivation as { sourceName?: unknown } | null)?.sourceName
    if (typeof name !== 'string' || currentQuestionIds.has(row.id)) continue
    await database.update(question).set({ status: 'retired' }).where(eq(question.id, row.id))
    retired.push(name)
  }
  return retired
}

export async function build(options: BuildOptions): Promise<BuildSummary> {
  const profileIds = options.profileIds ?? ENCODE_PROFILES.map((profile) => profile.id)
  const database = getDatabase()
  const sources = await loadSources(options.sourceDir)
  const targets = options.only?.length
    ? sources.filter((asset) => options.only?.includes(asset.name))
    : sources

  if (targets.length === 0) {
    throw new Error(`素材が 1 つも見つからない: ${options.sourceDir}`)
  }

  await guardToolVersions(database, profileIds)

  const summary: BuildSummary = { questions: 0, encodings: 0, draft: 0, skipped: [], retired: [] }
  for (const asset of targets) {
    const result = await buildOne(database, asset, options.outDir, profileIds)
    if (result.skipped) {
      summary.skipped.push({ name: asset.name, reason: result.skipped })
      continue
    }
    summary.questions += 1
    summary.encodings += result.encodings
    if (result.status === 'draft') summary.draft += 1
    console.log(`  ✓ ${asset.name} (${result.encodings} profiles, ${result.status})`)
  }

  // 🔒 素材を絞ったビルドでは判断できない（対象外の素材が「消えた」ように見える）
  if (!options.only?.length) {
    // ⚠ `targets` ではなく `sources` 全件から作る（同点で採用しなかった素材まで巻き込まないため）
    summary.retired = await retireRemovedSources(
      database,
      new Set(sources.map((asset) => questionIdFor(asset.contentHash))),
    )
    for (const name of summary.retired) {
      console.log(`  ⊖ retired ${name}（現在の素材から作られる問題ではない）`)
    }
  }

  await writeFile(
    path.join(options.outDir, 'questions.json'),
    `${JSON.stringify({ builtProfiles: profileIds, summary }, null, 2)}\n`,
  )
  return summary
}

/**
 * CLI エントリ。`pnpm quiz:build` から呼ばれる。
 *
 * - 引数なし: **20 プロファイルすべて**（prd/05 §3）
 * - `--standard-only`: 標準プロファイルだけ。⚠ **開発中に手早く回すためのもの**で、
 *   この成果物のまま公開してはいけない（正解画面が 20 プロファイルの結果を出せない）
 * - 素材名を並べるとその素材だけを対象にする
 */
export async function main(argv: readonly string[]): Promise<void> {
  const repoRoot = new URL('../../../', import.meta.url).pathname
  const only = argv.filter((arg) => !arg.startsWith('-'))
  const standardOnly = argv.includes('--standard-only')

  if (standardOnly) {
    console.warn('⚠ --standard-only: 標準プロファイルだけを生成する（公開用のビルドではない）')
  }

  const summary = await build({
    sourceDir: path.join(repoRoot, 'assets/source'),
    outDir: path.join(repoRoot, 'build'),
    ...(standardOnly ? { profileIds: [STANDARD_PROFILE_ID] } : {}),
    only,
  })

  console.log(
    `built ${summary.questions} questions / ${summary.encodings} encodings` +
      (summary.draft ? ` — ⚠ ${summary.draft} 件は 20 プロファイルが揃わず draft` : '') +
      (summary.skipped.length ? ` (skipped ${summary.skipped.length})` : '') +
      (summary.retired.length ? ` (retired ${summary.retired.length})` : ''),
  )
  for (const skipped of summary.skipped) {
    console.log(`  - skipped ${skipped.name}: ${skipped.reason}`)
  }
  await closeDatabase()
}
