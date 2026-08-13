import { createHash, randomBytes } from 'node:crypto'
import { type Database, questionEncodedAsset, questionOverlayAsset } from '@png-jpeg-quiz/database'
import { and, eq } from 'drizzle-orm'
import type { OverlayMetric } from './degradation.ts'

/**
 * 回答用アセットのキー発行（prd/05 §2「キーの発行と再利用」）。
 *
 * 🔒 **`question_encoded_asset`（DB）がキーの唯一の正。**
 * 生成物側のキーは常にその写しであり、**DB に行を作らずにキーを発行してはいけない。**
 *
 * 🔒 キーは暗号学的乱数。`question_id` / `profile_id` / display のキー / **内容ハッシュ**の
 * いずれからも導出できてはならない（prd/04 §3.4）。
 * 内容ハッシュが使えないのは、出題画像（可逆 WebP）からピクセルを完全に復元でき、
 * 同じ手順で PNG を作ればハッシュを計算できてしまうため。
 */

export type AssetKind = 'png' | 'jpeg'

const EXTENSION: Record<AssetKind, string> = { png: 'png', jpeg: 'jpg' }

/** 乱数のキー。**ここに問題 ID・プロファイル名・バイト数を混ぜない**（prd/04 §3.4） */
function randomObjectKey(kind: AssetKind): string {
  return `encoded/${randomBytes(24).toString('base64url')}.${EXTENSION[kind]}`
}

export interface ReservedKey {
  id: string
  objectKey: string
}

/**
 * 手順を「DB 先行」に固定する（prd/05 §2）:
 * 1. 照合 — `(question_id, profile_id, kind)` で既存行を引く。あればその `object_key` を使う
 * 2. 予約 — 無ければ**先に DB へ行を作って**キーを確定する（`bytes` / `sha256` はまだ null）
 *
 * こうすると、途中で失敗して残る不整合は「DB に行があるが R2 に無い」だけになり、
 * `uploaded_at IS NULL` で検出できて再実行で解決する。
 */
export async function reserveEncodedKey(
  database: Database,
  questionId: string,
  profileId: string,
  kind: AssetKind,
): Promise<ReservedKey> {
  const existing = await database
    .select({ id: questionEncodedAsset.id, objectKey: questionEncodedAsset.objectKey })
    .from(questionEncodedAsset)
    .where(
      and(
        eq(questionEncodedAsset.questionId, questionId),
        eq(questionEncodedAsset.profileId, profileId),
        eq(questionEncodedAsset.kind, kind),
      ),
    )
    .limit(1)

  const found = existing[0]
  if (found) return found

  const reserved: ReservedKey = {
    id: randomBytes(16).toString('hex'),
    objectKey: randomObjectKey(kind),
  }
  await database.insert(questionEncodedAsset).values({
    id: reserved.id,
    questionId,
    profileId,
    kind,
    objectKey: reserved.objectKey,
  })
  return reserved
}

/**
 * 生成が終わったら `bytes` / `sha256` を書き戻す（手順 3）。
 * `uploaded_at` は R2 への同期が成功してから（手順 5。M4）。
 */
export async function recordEncodedAsset(
  database: Database,
  id: string,
  values: { bytes: number; sha256: string; contentType: string },
): Promise<void> {
  await database.update(questionEncodedAsset).set(values).where(eq(questionEncodedAsset.id, id))
}

/**
 * 劣化オーバーレイのキー（prd/03 §5.3）。
 *
 * 🔒 **`question_encoded_asset` と同じ乱数方式。** 劣化量は素材の性質と相関し、
 * 素材の性質は答えと相関するので、導出可能なキーにしてはいけない（prd/04 §4.1）。
 *
 * 🔑 **`profile_id` ではなく `(jpeg_quality, chroma_subsampling, metric)` で持つ。**
 * PNG 最適化の有無は JPEG を変えないので、オーバーレイも変わらない（20 通りではなく 10 通り）。
 */
export interface OverlayKeyInput {
  questionId: string
  jpegQuality: number
  chromaSubsampling: string
  metric: OverlayMetric
  /** 🔒 配色・上限・合成方法の版。変わったら作り直す（prd/05 §6） */
  rendererVersion: string
}

export async function reserveOverlayKey(
  database: Database,
  input: OverlayKeyInput,
): Promise<ReservedKey> {
  const existing = await database
    .select({
      id: questionOverlayAsset.id,
      objectKey: questionOverlayAsset.objectKey,
      rendererVersion: questionOverlayAsset.rendererVersion,
    })
    .from(questionOverlayAsset)
    .where(
      and(
        eq(questionOverlayAsset.questionId, input.questionId),
        eq(questionOverlayAsset.jpegQuality, input.jpegQuality),
        eq(questionOverlayAsset.chromaSubsampling, input.chromaSubsampling as '4:2:0' | '4:4:4'),
        eq(questionOverlayAsset.metric, input.metric),
      ),
    )
    .limit(1)

  const found = existing[0]
  if (found) {
    if (found.rendererVersion === input.rendererVersion) {
      return { id: found.id, objectKey: found.objectKey }
    }

    /**
     * 🔒 **版が変わったら新しいキーを発行する。同じ URL の中身を差し替えない。**
     *
     * アセットは immutable キャッシュ前提で配る（prd/02 §5）。既存の URL の中身を入れ替えると、
     * CDN やブラウザに残った旧画像が配られ続ける一方で **DB は新しい `renderer_version` と
     * `sha256` を指す**ことになり、表示と記録が食い違う。
     *
     * 旧キーのオブジェクトは**消さずに残す**（既にキャッシュしている利用者のため）。
     * DB から参照されなくなるので、孤児掃除コマンドが後から回収する（prd/05 §2）。
     */
    const rekeyed = `overlay/${randomBytes(24).toString('base64url')}.webp`
    await database
      .update(questionOverlayAsset)
      .set({
        objectKey: rekeyed,
        rendererVersion: input.rendererVersion,
        // 中身はこれから作り直す。古い実測値を残さない
        bytes: null,
        sha256: null,
        uploadedAt: null,
      })
      .where(eq(questionOverlayAsset.id, found.id))
    return { id: found.id, objectKey: rekeyed }
  }

  const reserved: ReservedKey = {
    id: randomBytes(16).toString('hex'),
    objectKey: `overlay/${randomBytes(24).toString('base64url')}.webp`,
  }
  await database.insert(questionOverlayAsset).values({
    id: reserved.id,
    questionId: input.questionId,
    jpegQuality: input.jpegQuality,
    chromaSubsampling: input.chromaSubsampling as '4:2:0' | '4:4:4',
    metric: input.metric,
    objectKey: reserved.objectKey,
    rendererVersion: input.rendererVersion,
  })
  return reserved
}

export async function recordOverlayAsset(
  database: Database,
  id: string,
  values: { bytes: number; sha256: string; contentType: string },
): Promise<void> {
  await database.update(questionOverlayAsset).set(values).where(eq(questionOverlayAsset.id, id))
}

/**
 * 出題用アセットのキー（prd/03 §5.1）。
 * こちらは**内容ハッシュ由来でよい**（公開してよいもの）。
 * ⚠ ただし `display` と `encoded` を**同じ階層に置かない**（prd/05 §2）。
 *
 * ⚠ **内容ハッシュをそのまま使わない。** `question.id` も内容ハッシュ由来なので、
 * 素の値を使うと出題時に配る URL から `question_id` が読み取れてしまう。
 * ドメイン分離した別のダイジェストにして、URL と ID を無関係な文字列にする。
 */
export function displayObjectKey(contentHash: string): string {
  const digest = createHash('sha256').update(`display:${contentHash}`).digest('hex')
  return `display/${digest.slice(0, 32)}.webp`
}
