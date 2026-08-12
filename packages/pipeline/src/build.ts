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
} from '@png-jpeg-quiz/database'
import { ENCODE_PROFILES, STANDARD_PROFILE_ID } from '@png-jpeg-quiz/quiz-core'
import { eq } from 'drizzle-orm'
import { encodeDisplay, encodeForProfile, toolVersions } from './encode.ts'
import { displayObjectKey, recordEncodedAsset, reserveEncodedKey } from './keys.ts'
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
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
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
      derivation,
      source: asset.meta.source,
      explanation: asset.meta.explanation ?? null,
      // status は最後に決める（20 プロファイルが揃って初めて published にする）
    })
    .onDuplicateKeyUpdate({
      set: {
        width: image.width,
        height: image.height,
        category: asset.meta.category,
        colorCount: Math.min(image.colorCount, 257),
        flatRatio: image.flatRatio,
        tags: asset.meta.tags,
        derivation,
        source: asset.meta.source,
        explanation: asset.meta.explanation ?? null,
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

  for (const result of results) {
    const encodingValues = {
      pngBytes: result.pngBytes,
      jpegBytes: result.jpegBytes,
      answer: result.answer,
      log2Ratio: result.log2Ratio,
      difficulty: result.difficulty,
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

  // TODO(spec): 本来はここで draft に入れ、人手レビュー（prd/05 §3 ステップ 11）を経て
  // published にする。レビュー UI は M3 以降なので、当面は揃った時点で published にする。
  const status = ENCODE_PROFILES.every((profile) => presentIds.has(profile.id))
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

  const summary: BuildSummary = { questions: 0, encodings: 0, draft: 0, skipped: [] }
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
      (summary.skipped.length ? ` (skipped ${summary.skipped.length})` : ''),
  )
  for (const skipped of summary.skipped) {
    console.log(`  - skipped ${skipped.name}: ${skipped.reason}`)
  }
  await closeDatabase()
}
