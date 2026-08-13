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
  /** 🔒 `null` = **未宣言**（`meta.json` から取り込まれていない）。`false` と区別する */
  isAiGenerated: boolean | null
  /** AI 生成の開示に使う（生成した人）。帰属義務があるという意味ではない */
  authors: string[]
  count: number
}

/**
 * 🔒 **帰属不要と認めるライセンス表記の完全一致リスト**（prd/05 §1.1）。
 *
 * ⚠ **前方一致にしない。** `OpenAI; MIT` や `MIT / generated with OpenAI` のような複合表記が
 * 「OpenAI で始まる／を含むから帰属不要」と判定されると、
 * **MIT の表示義務を落としたまま公開してしまう。**
 *
 * 完全一致は表記が増えるたびに追記が要るが、**漏れたときに倒れる向きが安全側**
 * （見慣れない表記＝帰属必須）なので、この形にしている。
 *
 * ⚠ **恒久的には、ライセンスを自由文字列ではなく種別の enum に分けるべき**
 * （`TODO(spec):` prd/05 §1.1 に種別の一覧が無い）。ここは自由文字列に対する防波堤。
 */
const ATTRIBUTION_FREE_LICENSES: ReadonlySet<string> = new Set([
  'CC0',
  'CC0 1.0',
  'CC0 1.0 UNIVERSAL',
  'PUBLIC DOMAIN',
  'OPENAI 出力',
  '自作',
])

/**
 * 🔒 **帰属義務のあるライセンスか**（prd/05 §1.1）。
 * これが公開プールに 1 点でも残っていたら公開してはいけない（prd/05 §1.4, §7）。
 *
 * `meta.json` の `license` は自由文字列なので、**判定できないものは安全側**（帰属必須）に倒す。
 * 「分からないから公開してよい」にすると、表記が増えたときに黙って漏れる。
 */
export function requiresAttribution(license: string): boolean {
  const normalized = license
    .trim()
    .toUpperCase()
    // 末尾の注記だけは落とす（「OpenAI 出力（生成者に権利帰属）」の括弧部分）。
    // ⚠ 落とすのは**末尾の 1 つだけ**。中間に現れる注記は表記の一部として扱う
    .replace(/[（(][^（()）]*[)）]\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim()

  return !ATTRIBUTION_FREE_LICENSES.has(normalized)
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
    .select({ source: question.source, isAiGenerated: question.isAiGenerated })
    .from(question)
    .where(eq(question.status, 'published'))

  const groups = new Map<string, CreditGroup>()
  for (const row of rows) {
    const source = (row.source ?? {}) as SourceJson
    const site = asString(source.site) ?? '不明'
    const license = asString(source.license) ?? '不明'
    // AI 生成の別も束ねる鍵に含める（同じ出典・同じライセンスでも別に数えるべきもの）
    const key = `${site} :: ${license} :: ${row.isAiGenerated}`

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
      // 🔒 **`meta.json` の宣言が唯一の根拠。** サイト名から推測しない（prd/05 §1.1）
      isAiGenerated: row.isAiGenerated,
      authors: author ? [author] : [],
      count: 1,
    })
  }

  return [...groups.values()].sort((a, b) =>
    a.site === b.site ? a.license.localeCompare(b.license) : a.site.localeCompare(b.site),
  )
}
