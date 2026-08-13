import { getDatabase, question } from '@png-jpeg-quiz/database'
import { eq } from 'drizzle-orm'

/**
 * クレジット（prd/05 §1.4）。
 *
 * 🔒 **「素材の集合」としてしか開示しない。** 個別行・サムネイル・出典リンク・ファイル名の
 * いずれも出さない。帰属表示は本質的に「原本へ到達できること」を含むので、
 * 一覧に載せた時点で、回答前に出題画像と原本を突き合わせて素性を割り出せてしまう（T7）。
 *
 * → だから**公開プールは帰属義務の無い素材（CC0 / AI 生成 / 自作）だけ**で構成し、
 * 個別の帰属は**回答後の画面**で出す（prd/05 §1.3）。
 *
 * **`meta.json` が唯一の情報源。** パイプラインが `question.source` に写したものを集計するだけで、
 * 手書きの一覧を別に持たない（二重管理はライセンス表記の欠落を生む）。
 */

export interface CreditGroup {
  site: string
  license: string
  licenseUrl: string | null
  isAiGenerated: boolean
  /** AI 生成の開示に使う（生成した人）。帰属義務があるという意味ではない */
  authors: string[]
  count: number
}

/**
 * 🔒 **帰属義務のあるライセンス**（prd/05 §1.1）。
 * これが公開プールに 1 点でも残っていたら公開してはいけない（prd/05 §1.4, §7）。
 *
 * ⚠ **表記ゆれに強い形で判定する。** `meta.json` の `license` は自由文字列なので、
 * 「CC BY 4.0」「CC BY-SA 4.0」のような接頭辞で拾う。
 * 判定できないものは**安全側**（帰属必須）に倒す。
 */
export function requiresAttribution(license: string): boolean {
  const normalized = license.trim().toUpperCase()
  if (normalized.startsWith('CC0')) return false
  if (normalized.startsWith('CC BY')) return true
  // 帰属不要と分かっているもの（AI 生成 / パブリックドメイン / 自作）以外は安全側に倒す
  return !(
    normalized.includes('OPENAI') ||
    normalized.includes('PUBLIC DOMAIN') ||
    normalized.includes('自作')
  )
}

interface SourceJson {
  site?: unknown
  author?: unknown
  license?: unknown
  license_url?: unknown
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

/**
 * 公開中の問題の素材を、`(出典サイト, ライセンス)` で束ねて数える。
 * ⚠ **並び順に素材の性質を混ぜない**（順序自体が漏洩経路になる。prd/05 §1.4）。
 * 出典サイト → ライセンスの辞書順で固定する。
 */
export async function loadCredits(): Promise<CreditGroup[]> {
  const rows = await getDatabase()
    .select({ source: question.source, isSynthetic: question.isSynthetic })
    .from(question)
    .where(eq(question.status, 'published'))

  const groups = new Map<string, CreditGroup>()
  for (const row of rows) {
    const source = (row.source ?? {}) as SourceJson
    const site = asString(source.site) ?? '不明'
    const license = asString(source.license) ?? '不明'
    const key = `${site} :: ${license}`

    const existing = groups.get(key)
    const author = asString(source.author)
    if (existing) {
      existing.count += 1
      if (author && !existing.authors.includes(author)) existing.authors.push(author)
      continue
    }
    groups.set(key, {
      site,
      license,
      licenseUrl: asString(source.license_url),
      // `is_ai_generated` は meta.json のフラグだが、DB には持っていない。
      // 出典サイトで判断する（生成サービス名が入っている）
      isAiGenerated: /openai|chatgpt|生成/i.test(site),
      authors: author ? [author] : [],
      count: 1,
    })
  }

  return [...groups.values()].sort((a, b) =>
    a.site === b.site ? a.license.localeCompare(b.license) : a.site.localeCompare(b.site),
  )
}
