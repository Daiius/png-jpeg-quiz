import { encodeProfile, getDatabase, question, questionEncoding } from '@png-jpeg-quiz/database'
import { ENCODE_PROFILES, STANDARD_PROFILE_ID } from '@png-jpeg-quiz/quiz-core'
import { eq } from 'drizzle-orm'

/**
 * 選べる条件の一覧（prd/06 §2）。
 *
 * 🔒 出してよいのは**プロファイル全体の偏り**まで。個別問題について何も語らないので
 * 公開してよく、むしろ戦略性になる（prd/04 §3.5）。**問題を特定できる情報は載せない。**
 */
export interface ProfileChoice {
  id: string
  label: string
  jpegQuality: number
  chromaSubsampling: string
  pngOptimize: boolean
  isStandard: boolean
  /** そのプロファイルのプールでの PNG 正解率 */
  pngWinRate: number
  poolSize: number
  /**
   * 答えが片方に寄りきっている条件は選ばせない。
   * `-log2(0)` が発散して得点が計算できないため（prd/06 §1）。
   */
  playable: boolean
}

export async function listProfileChoices(): Promise<ProfileChoice[]> {
  const database = getDatabase()

  const stored = await database
    .select({
      id: encodeProfile.id,
      pngWinRate: encodeProfile.pngWinRate,
      publishedLabel: encodeProfile.publishedLabel,
      isStandard: encodeProfile.isStandard,
    })
    .from(encodeProfile)

  const published = await database
    .select({ profileId: questionEncoding.profileId })
    .from(questionEncoding)
    .innerJoin(question, eq(question.id, questionEncoding.questionId))
    .where(eq(question.status, 'published'))

  const poolSize = new Map<string, number>()
  for (const row of published) {
    poolSize.set(row.profileId, (poolSize.get(row.profileId) ?? 0) + 1)
  }

  return ENCODE_PROFILES.flatMap((profile) => {
    const row = stored.find((entry) => entry.id === profile.id)
    if (!row) return []
    const size = poolSize.get(profile.id) ?? 0
    return [
      {
        id: profile.id,
        label: row.publishedLabel,
        jpegQuality: profile.jpegQuality,
        chromaSubsampling: profile.chromaSubsampling,
        pngOptimize: profile.pngOptimize,
        isStandard: row.isStandard,
        pngWinRate: row.pngWinRate,
        poolSize: size,
        playable: size > 0 && row.pngWinRate > 0 && row.pngWinRate < 1,
      },
    ]
  })
}

/**
 * 開始する条件を決める（prd/06 §2.1）。
 *
 * - **指定あり**: その条件が遊べるときだけ返す（遊べなければ `undefined`）。
 * - **省略（おまかせ開始）**: 標準条件。それが遊べないときは遊べるものの先頭。
 *   ⚠ ここで `undefined` が返るのは**プール全体が空**か、全条件で答えが片方に寄りきっている場合。
 */
export async function resolveStartProfile(profileId?: string): Promise<ProfileChoice | undefined> {
  const choices = await listProfileChoices()
  if (profileId !== undefined) {
    return choices.find((choice) => choice.id === profileId && choice.playable)
  }
  const standard = choices.find((choice) => choice.id === STANDARD_PROFILE_ID)
  if (standard?.playable) return standard
  return choices.find((choice) => choice.playable)
}
