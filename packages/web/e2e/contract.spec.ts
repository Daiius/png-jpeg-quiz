import { expect, test } from '@playwright/test'

/**
 * 出題レスポンスの契約テスト（prd/04 §3.5 / T7 の回帰防止）。
 *
 * 🔒 回答前にクライアントへ渡してよいのは `display` の URL・寸法・カテゴリと
 * セッション文脈（mode / profileId）**だけ**。ここのキー集合が増えるときは、
 * ほぼ確実に漏洩なので、このテストは意図的に「厳しすぎる」方向に倒してある。
 *
 * ⚠ Zod の parse 後のオブジェクトではなく **HTTP レスポンスの生 JSON** を検査する。
 * スキーマは知らないキーを strip するので、parse 後を見ても余計なキーの混入は見えない。
 */

/** ネストも含めて「キー名」を全部集める（値は見ない。キー名だけが検査対象） */
function collectKeys(value: unknown, path: string, out: Array<{ path: string; key: string }>) {
  if (Array.isArray(value)) {
    for (const [i, item] of value.entries()) collectKeys(item, `${path}[${i}]`, out)
    return
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      out.push({ path: `${path}.${key}`, key })
      collectKeys(child, `${path}.${key}`, out)
    }
  }
}

/** 答えの方向を示しうる語（prd/03 §3・§4 の非公開カラムに由来） */
const FORBIDDEN_KEY =
  /answer|correct|bytes|png|jpeg|difficult|ratio|de00|ssim|win|score|point|explan|source|tag|flat|color|synthetic|generated|license|derivation/i

test('回答前のレスポンスは、許可されたキーだけを含む', async ({ request }) => {
  const created = await request.post('/api/session', { data: {} })
  expect(created.ok()).toBe(true)
  const session = (await created.json()) as Record<string, unknown>
  expect(Object.keys(session).sort()).toEqual(['mode', 'profileId', 'questionCount', 'sessionId'])

  const response = await request.get(`/api/session/${String(session['sessionId'])}/question`)
  expect(response.ok()).toBe(true)
  const body = (await response.json()) as Record<string, unknown>

  // 🔒 キー集合の**完全一致**。許可リストに無いキーは、たとえ値が無害でも通さない
  expect(Object.keys(body).sort()).toEqual(['mode', 'profileId', 'question', 'status'])
  const question = body['question'] as Record<string, unknown>
  expect(Object.keys(question).sort()).toEqual([
    'category',
    'displayUrl',
    'height',
    'index',
    'questionId',
    'total',
    'width',
  ])

  // 深い階層（source 等の入れ子）も含めて、答えの方向を示す語をキーに含まない
  const keys: Array<{ path: string; key: string }> = []
  collectKeys(body, '$', keys)
  const leaked = keys.filter((entry) => FORBIDDEN_KEY.test(entry.key)).map((entry) => entry.path)
  expect(leaked).toEqual([])

  // 🔒 display と encoded はキー空間を分ける（prd/05 §2）。出題 URL は display 側だけを指す
  expect(String(question['displayUrl'])).toContain('/display/')
})
