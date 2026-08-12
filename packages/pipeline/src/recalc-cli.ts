import { closeDatabase, getDatabase } from '@png-jpeg-quiz/database'
import { playableProfiles, recalcWinRates } from './win-rate.ts'

/**
 * `pnpm quiz:recalc` — `encode_profile.png_win_rate` の再計算（prd/05 §3 ステップ 12）。
 *
 * ⚠ **問題プールが変わったら必ず流す。** 得点式の `p` はここから来る（prd/06 §1）。
 */
const database = getDatabase()
const rates = await recalcWinRates(database)
const playable = new Set(await playableProfiles(database))

for (const [profileId, rate] of [...rates].sort(([a], [b]) => (a < b ? -1 : 1))) {
  const mark = playable.has(profileId) ? '  ' : '⚠ '
  console.log(`${mark}${profileId}  PNG 勝率 ${(rate * 100).toFixed(1)}%`)
}

const unplayable = [...rates.keys()].filter((id) => !playable.has(id))
if (unplayable.length > 0) {
  console.log(
    `\n⚠ ${unplayable.length} 件のプロファイルは答えが片方に寄りきっていて出題できない` +
      '（得点計算が -log2(0) で発散する）。素材を足すこと。',
  )
}

await closeDatabase()
