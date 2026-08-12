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
  /** M1 は「1 問を通す」ためのスライス。既定は標準プロファイルだけを回す */
  profileIds?: readonly string[]
  /** 素材を絞る（動作確認用） */
  only?: readonly string[]
}

export interface BuildSummary {
  questions: number
  encodings: number
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
): Promise<{ encodings: number; skipped?: string }> {
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
      // TODO(spec): 人手レビュー（prd/05 §3 ステップ 11）を通すまでは draft のはずだが、
      // M1 では出題まで通すことを優先して published で入れる。レビュー UI は M3 以降。
      status: 'published',
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
        status: 'published',
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

  return { encodings: results.length }
}

async function writeAsset(outDir: string, objectKey: string, bytes: Buffer): Promise<void> {
  const target = path.join(outDir, 'assets', objectKey)
  await mkdir(path.dirname(target), { recursive: true })
  await writeFile(target, bytes)
}

export async function build(options: BuildOptions): Promise<BuildSummary> {
  const profileIds = options.profileIds ?? [STANDARD_PROFILE_ID]
  const database = getDatabase()
  const sources = await loadSources(options.sourceDir)
  const targets = options.only?.length
    ? sources.filter((asset) => options.only?.includes(asset.name))
    : sources

  if (targets.length === 0) {
    throw new Error(`素材が 1 つも見つからない: ${options.sourceDir}`)
  }

  // 実際にエンコードしたツール版を記録する（prd/03 §2）
  const versions = toolVersions()
  for (const profileId of profileIds) {
    await database
      .update(encodeProfile)
      .set({ toolVersions: versions })
      .where(eq(encodeProfile.id, profileId))
  }

  const summary: BuildSummary = { questions: 0, encodings: 0, skipped: [] }
  for (const asset of targets) {
    const result = await buildOne(database, asset, options.outDir, profileIds)
    if (result.skipped) {
      summary.skipped.push({ name: asset.name, reason: result.skipped })
      continue
    }
    summary.questions += 1
    summary.encodings += result.encodings
    console.log(`  ✓ ${asset.name} (${result.encodings} profiles)`)
  }

  await writeFile(
    path.join(options.outDir, 'questions.json'),
    `${JSON.stringify({ builtProfiles: profileIds, summary }, null, 2)}\n`,
  )
  return summary
}

/** CLI エントリ。`pnpm quiz:build` から呼ばれる */
export async function main(argv: readonly string[]): Promise<void> {
  const repoRoot = new URL('../../../', import.meta.url).pathname
  const only = argv.filter((arg) => !arg.startsWith('-'))
  const allProfiles = argv.includes('--all-profiles')

  const summary = await build({
    sourceDir: path.join(repoRoot, 'assets/source'),
    outDir: path.join(repoRoot, 'build'),
    profileIds: allProfiles ? ENCODE_PROFILES.map((p) => p.id) : [STANDARD_PROFILE_ID],
    only,
  })

  console.log(
    `built ${summary.questions} questions / ${summary.encodings} encodings` +
      (summary.skipped.length ? ` (skipped ${summary.skipped.length})` : ''),
  )
  for (const skipped of summary.skipped) {
    console.log(`  - skipped ${skipped.name}: ${skipped.reason}`)
  }
  await closeDatabase()
}
