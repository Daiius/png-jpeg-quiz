import { type APIRequestContext, expect, test } from '@playwright/test'

/**
 * セッション状態の復元（GOAL ステップ 3 / prd/06 §2.1）。
 *
 * リロードしても得点・進行・直前の正解画面が戻ること。
 * 「得点が 0 に戻る」「回答直後のリロードで正解画面に二度と戻れない」の回帰防止。
 */

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * 既定条件の 1 問目の正解を、使い捨てセッションで調べる。
 * 出題選択は決定的（prd/01 §4.3）なので、次のセッションでも 1 問目は同じ問題になる。
 * 「正解して得点 > 0」を作るためのヘルパ（0 点同士の比較では復元の検証にならない）。
 */
async function learnFirstAnswer(request: APIRequestContext): Promise<'png' | 'jpeg'> {
  const created = await request.post('/api/session', { data: {} })
  const session = (await created.json()) as { sessionId: string }
  const first = await request.get(`/api/session/${session.sessionId}/question`)
  const body = (await first.json()) as { question: { questionId: string } }
  await wait(400)
  const answered = await request.post(`/api/session/${session.sessionId}/answer`, {
    data: { questionId: body.question.questionId, answer: 'png' },
  })
  const result = (await answered.json()) as { answer: 'png' | 'jpeg' }
  return result.answer
}

test('状態 API は得点・進行・直前の結果を返す', async ({ request }) => {
  const correct = await learnFirstAnswer(request)

  const created = await request.post('/api/session', { data: {} })
  const session = (await created.json()) as { sessionId: string }

  let state = (await (await request.get(`/api/session/${session.sessionId}`)).json()) as Record<
    string,
    unknown
  >
  expect(state['score']).toBe(0)
  expect(state['currentIndex']).toBe(0)
  expect(state['currentServed']).toBe(false)
  expect(state['lastQuestion']).toBeNull()
  expect(state['lastResult']).toBeNull()

  const first = await request.get(`/api/session/${session.sessionId}/question`)
  const body = (await first.json()) as { question: { questionId: string } }

  state = (await (await request.get(`/api/session/${session.sessionId}`)).json()) as Record<
    string,
    unknown
  >
  expect(state['currentServed']).toBe(true)

  await wait(400)
  const answered = await request.post(`/api/session/${session.sessionId}/answer`, {
    data: { questionId: body.question.questionId, answer: correct },
  })
  const result = (await answered.json()) as { correct: boolean; awardedPoints: number }
  expect(result.correct).toBe(true)
  expect(result.awardedPoints).toBeGreaterThan(0)

  // 回答直後: 得点が積まれ、直前の結果が入り、次の問題はまだ配信されていない
  state = (await (await request.get(`/api/session/${session.sessionId}`)).json()) as Record<
    string,
    unknown
  >
  expect(state['score']).toBeCloseTo(result.awardedPoints)
  expect(state['currentIndex']).toBe(1)
  expect(state['currentServed']).toBe(false)
  expect((state['lastQuestion'] as { questionId: string }).questionId).toBe(
    body.question.questionId,
  )
  expect((state['lastResult'] as { correct: boolean }).correct).toBe(true)
})

test('リロードしても得点と進行が戻る', async ({ page, request }) => {
  const correct = await learnFirstAnswer(request)

  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('button', { name: 'PNG', exact: true })).toBeVisible({
    timeout: 30_000,
  })
  // モード名が画面に出る（practice はランキング対象外。prd/06 §2）
  await expect(page.getByText('practice')).toBeVisible()

  await page.waitForTimeout(400)
  await page.getByRole('button', { name: correct === 'png' ? 'PNG' : 'JPEG', exact: true }).click()
  await expect(page.getByText(/小さいのは (PNG|JPEG) でした/)).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: '次の問題へ' }).click()
  await expect(page.getByText(/第 2 問/)).toBeVisible({ timeout: 15_000 })

  const scoreText = await page.getByText(/\d+\.\d{2} 点/).innerText()
  expect(scoreText).not.toBe('0.00 点')

  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.getByText(/第 2 問/)).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText(scoreText)).toBeVisible()
})

test('回答直後にリロードすると正解画面に戻る', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('button', { name: 'PNG', exact: true })).toBeVisible({
    timeout: 30_000,
  })

  await page.waitForTimeout(400)
  await page.getByRole('button', { name: 'PNG', exact: true }).click()
  const verdict = page.getByText(/小さいのは (PNG|JPEG) でした/)
  await expect(verdict).toBeVisible({ timeout: 15_000 })
  const verdictText = await verdict.innerText()

  // 🔒 原則 5「回答後は全部見せる・検証できる」— リロードで正解画面を失わない（prd/04 §4）
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.getByText(verdictText)).toBeVisible({ timeout: 30_000 })

  // そこから通常どおり次へ進める
  await page.getByRole('button', { name: '次の問題へ' }).click()
  await expect(page.getByText(/第 2 問/)).toBeVisible({ timeout: 15_000 })
})
