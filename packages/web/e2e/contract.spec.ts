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

  // 🔒 キー集合の**完全一致**。許可リストに無いキーは、たとえ値が無害でも通さない。
  // `hint` は色数ヒント（prd/06 §7）の**支払い済みレンジの再表示**用で、未払いなら必ず null
  expect(Object.keys(body).sort()).toEqual(['hint', 'mode', 'profileId', 'question', 'status'])
  expect(body['hint']).toBeNull()
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

test('セッション状態レスポンスは、未回答の問題の情報を持たない', async ({ request }) => {
  const created = await request.post('/api/session', { data: {} })
  const session = (await created.json()) as Record<string, unknown>

  const response = await request.get(`/api/session/${String(session['sessionId'])}`)
  expect(response.ok()).toBe(true)
  const body = (await response.json()) as Record<string, unknown>

  expect(Object.keys(body).sort()).toEqual([
    'correctCount',
    'currentIndex',
    'currentServed',
    'lastQuestion',
    'lastResult',
    'mode',
    'profileId',
    'questionCount',
    'score',
    'status',
  ])
  // 何も回答していないセッションでは、問題に関する情報が一切入らない
  expect(body['lastQuestion']).toBeNull()
  expect(body['lastResult']).toBeNull()

  // 🔒 出題を受けた後も、増えるのは「配信済み」の真偽値だけ。未回答の問題の中身は入らない
  await request.get(`/api/session/${String(session['sessionId'])}/question`)
  const after = (await (
    await request.get(`/api/session/${String(session['sessionId'])}`)
  ).json()) as Record<string, unknown>
  expect(after['currentServed']).toBe(true)
  expect(after['lastQuestion']).toBeNull()
  expect(after['lastResult']).toBeNull()
})

test('色数ヒントは記録してからレンジだけを返し、再要求に冪等（prd/06 §7.3）', async ({
  request,
}) => {
  const created = await request.post('/api/session', { data: {} })
  const session = (await created.json()) as Record<string, unknown>
  const sessionId = String(session['sessionId'])

  const questionBody = (await (
    await request.get(`/api/session/${sessionId}/question`)
  ).json()) as Record<string, unknown>
  const question = questionBody['question'] as Record<string, unknown>
  const questionId = String(question['questionId'])

  // 開示。🔒 返るのはレンジだけ（実数の color_count や他の属性は返らない）
  const first = await request.post(`/api/session/${sessionId}/hint`, { data: { questionId } })
  expect(first.ok()).toBe(true)
  const firstBody = (await first.json()) as Record<string, unknown>
  expect(Object.keys(firstBody).sort()).toEqual(['colorRange'])
  expect(['le256', 'gt256']).toContain(firstBody['colorRange'])

  // 冪等: 再要求は同じレンジ（二重減点しない。減点の検証はサーバ内部値なので単体テスト側）
  const second = await request.post(`/api/session/${sessionId}/hint`, { data: { questionId } })
  expect(second.ok()).toBe(true)
  expect(((await second.json()) as Record<string, unknown>)['colorRange']).toBe(
    firstBody['colorRange'],
  )

  // 支払い済みのヒントは出題レスポンスで復元される（prd/06 §7.3 のリロード復元）
  const reloaded = (await (
    await request.get(`/api/session/${sessionId}/question`)
  ).json()) as Record<string, unknown>
  expect(reloaded['hint']).toBe(firstBody['colorRange'])

  // 最短回答時間（MIN_ANSWER_MS = 300ms）を下回ると 429 になる（prd/04 §5.2）
  await new Promise((resolve) => setTimeout(resolve, 400))

  // 回答すると開示側に色数の実数とヒント使用が載る（prd/04 §4）
  const answered = await request.post(`/api/session/${sessionId}/answer`, {
    data: { questionId, answer: 'png' },
  })
  expect(answered.ok()).toBe(true)
  const result = (await answered.json()) as Record<string, unknown>
  expect(result['hintUsed']).toBe(true)
  expect(typeof result['colorCount']).toBe('number')

  // 🔒 回答済みの行へのヒント要求は拒否される（prd/06 §7.3）
  const late = await request.post(`/api/session/${sessionId}/hint`, { data: { questionId } })
  expect(late.status()).toBe(409)
})
