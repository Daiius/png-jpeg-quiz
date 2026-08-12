import { createHash, randomBytes } from 'node:crypto'
import { type Database, questionEncodedAsset } from '@png-jpeg-quiz/database'
import { and, eq } from 'drizzle-orm'

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
