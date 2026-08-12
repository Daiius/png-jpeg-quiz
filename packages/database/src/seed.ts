import {
  ENCODE_PROFILES,
  jpegOptionsFor,
  PREPROCESS,
  pngOptionsFor,
} from '@png-jpeg-quiz/quiz-core'
import { closeDatabase, getDatabase } from './client.ts'
import { encodeProfile } from './schema.ts'

/**
 * 20 プロファイルの投入（prd/03 §2）。**何度流しても同じ結果**になる。
 *
 * `tool_versions` はここでは埋めない。**実際にエンコードした pipeline が書き込む**
 * （版が変わればバイト数も変わり、拮抗問題では正解が反転しうる。prd/01 §3.3）。
 * `png_win_rate` も問題プールが決まってから再計算する（prd/06 §1）。
 */
async function main(): Promise<void> {
  const database = getDatabase()

  for (const profile of ENCODE_PROFILES) {
    const values = {
      id: profile.id,
      jpegQuality: profile.jpegQuality,
      chromaSubsampling: profile.chromaSubsampling,
      pngOptimize: profile.pngOptimize,
      isStandard: profile.isStandard,
      pngOptions: pngOptionsFor(profile),
      jpegOptions: jpegOptionsFor(profile),
      preprocess: PREPROCESS,
      publishedLabel: profile.publishedLabel,
    }
    await database
      .insert(encodeProfile)
      .values({ ...values, toolVersions: {} })
      .onDuplicateKeyUpdate({ set: values })
  }

  console.log(`seeded ${ENCODE_PROFILES.length} encode profiles`)
  await closeDatabase()
}

await main()
