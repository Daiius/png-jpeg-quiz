import { expect, test } from '@playwright/test'

/**
 * 通信失敗からの回復（GOAL ステップ 2）。
 *
 * 🔑 セッションはサーバに残っている。瞬断・再送・進行ずれのどれでも、
 * **セッションを破棄せずに**続けられることを検証する。
 */

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

test('同一回答の再送には保存済みの結果が返る（冪等）。異なる回答は 409', async ({ request }) => {
  const created = await request.post('/api/session', { data: {} })
  expect(created.ok()).toBe(true)
  const session = (await created.json()) as { sessionId: string }

  const first = await request.get(`/api/session/${session.sessionId}/question`)
  const body = (await first.json()) as { question: { questionId: string; index: number } }

  await wait(400)
  const payload = { questionId: body.question.questionId, answer: 'png' }
  const answered = await request.post(`/api/session/${session.sessionId}/answer`, {
    data: payload,
  })
  expect(answered.status()).toBe(200)
  const result = (await answered.json()) as Record<string, unknown>

  // 応答を失った想定の再送。二重採点にならず、同じ結果が返る
  const replayed = await request.post(`/api/session/${session.sessionId}/answer`, {
    data: payload,
  })
  expect(replayed.status()).toBe(200)
  const replayedResult = (await replayed.json()) as Record<string, unknown>
  expect(replayedResult['correct']).toBe(result['correct'])
  expect(replayedResult['awardedPoints']).toBe(result['awardedPoints'])
  expect(replayedResult['pngBytes']).toBe(result['pngBytes'])

  // 進行は最初の受付から進んでいない（再送で 2 問目に飛ばない）
  const next = await request.get(`/api/session/${session.sessionId}/question`)
  const nextBody = (await next.json()) as { question: { index: number } }
  expect(nextBody.question.index).toBe(1)

  // ⚠ 異なる回答の再送は受け付けない（回答は 1 回だけ。prd/03 §7）
  const flipped = await request.post(`/api/session/${session.sessionId}/answer`, {
    data: { questionId: body.question.questionId, answer: 'jpeg' },
  })
  expect(flipped.status()).toBe(409)
})

test('同一回答の並行 POST は、どちらの順序でも両方 200 になる', async ({ request }) => {
  const created = await request.post('/api/session', { data: {} })
  const session = (await created.json()) as { sessionId: string }
  const first = await request.get(`/api/session/${session.sessionId}/question`)
  const body = (await first.json()) as { question: { questionId: string } }

  await wait(400)
  const payload = { questionId: body.question.questionId, answer: 'jpeg' }
  // 意図的に並行させる（OCL-0C8DBA59 の競合の窓を通す）。勝者は正規経路、
  // 敗者は「回答済み行を読む」いずれかの経路に入るが、どちらも同じ結果を返すこと
  const [a, b] = await Promise.all([
    request.post(`/api/session/${session.sessionId}/answer`, { data: payload }),
    request.post(`/api/session/${session.sessionId}/answer`, { data: payload }),
  ])
  expect(a.status()).toBe(200)
  expect(b.status()).toBe(200)
  const resultA = (await a.json()) as Record<string, unknown>
  const resultB = (await b.json()) as Record<string, unknown>
  expect(resultB['correct']).toBe(resultA['correct'])
  expect(resultB['awardedPoints']).toBe(resultA['awardedPoints'])

  // 進行は 1 問ぶんだけ（二重採点になっていない）
  const next = await request.get(`/api/session/${session.sessionId}/question`)
  const nextBody = (await next.json()) as { question: { index: number } }
  expect(nextBody.question.index).toBe(1)
})

test('速すぎる回答は 429 になるが、セッションは壊れない', async ({ request }) => {
  const created = await request.post('/api/session', { data: {} })
  const session = (await created.json()) as { sessionId: string }
  const first = await request.get(`/api/session/${session.sessionId}/question`)
  const body = (await first.json()) as { question: { questionId: string } }

  // MIN_ANSWER_MS（300ms）未満の即答
  const tooFast = await request.post(`/api/session/${session.sessionId}/answer`, {
    data: { questionId: body.question.questionId, answer: 'png' },
  })
  expect(tooFast.status()).toBe(429)

  // 待ってから答え直せば、同じ問題がそのまま受け付けられる
  await wait(400)
  const retried = await request.post(`/api/session/${session.sessionId}/answer`, {
    data: { questionId: body.question.questionId, answer: 'png' },
  })
  expect(retried.status()).toBe(200)
})

test('出題取得の通信断は、セッションを保ったまま再試行できる', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('button', { name: 'PNG', exact: true })).toBeVisible({
    timeout: 30_000,
  })
  const sessionUrl = page.url()

  // 1 問答えてから、次の出題取得を通信断にする
  await page.waitForTimeout(400)
  await page.getByRole('button', { name: 'PNG', exact: true }).click()
  await expect(page.getByText(/小さいのは (PNG|JPEG) でした/)).toBeVisible({ timeout: 15_000 })

  await page.route('**/api/session/*/question', (route) => route.abort())
  await page.getByRole('button', { name: '次の問題へ' }).click()
  await expect(page.getByText(/通信に失敗しました/)).toBeVisible()

  // 🔑 既定の出口は再試行。復帰後も同じセッション（URL 不変・第 2 問から）
  await page.unroute('**/api/session/*/question')
  await page.getByRole('button', { name: 'もう一度試す' }).click()
  await expect(page.getByText(/第 2 問/)).toBeVisible({ timeout: 15_000 })
  expect(page.url()).toBe(sessionUrl)
})

test('回答送信の通信断は、同じ選択肢の押し直しで回復する', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('button', { name: 'PNG', exact: true })).toBeVisible({
    timeout: 30_000,
  })

  await page.route('**/api/session/*/answer', (route) => route.abort())
  await page.waitForTimeout(400)
  await page.getByRole('button', { name: 'PNG', exact: true }).click()
  await expect(page.getByText(/「PNG」をもう一度押すと/)).toBeVisible()

  // 🔒 応答不明の間、反対の選択肢は塞がる（押せると受理済み回答の正解画面を永久に失う）
  await expect(page.getByRole('button', { name: 'JPEG', exact: true })).toBeDisabled()

  // 同じ選択肢は生きている。押し直せば（サーバ受理済みでも冪等なので）正解画面に到達する
  await page.unroute('**/api/session/*/answer')
  await page.getByRole('button', { name: 'PNG', exact: true }).click()
  await expect(page.getByText(/小さいのは (PNG|JPEG) でした/)).toBeVisible({ timeout: 15_000 })
})

test('cookie が無い回では、新規開始だけが出口になる', async ({ page, context }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('button', { name: 'PNG', exact: true })).toBeVisible({
    timeout: 30_000,
  })

  await page.waitForTimeout(400)
  await page.getByRole('button', { name: 'PNG', exact: true }).click()
  await expect(page.getByText(/小さいのは (PNG|JPEG) でした/)).toBeVisible({ timeout: 15_000 })

  // 所有証明（HttpOnly cookie）を失った状態で次へ進もうとする
  await context.clearCookies()
  await page.getByRole('button', { name: '次の問題へ' }).click()
  await expect(page.getByText(/この回には参加できません/)).toBeVisible()
  await expect(page.getByRole('link', { name: '新しく始める' })).toBeVisible()
  // この回には戻れないので、再試行は出さない
  await expect(page.getByRole('button', { name: 'もう一度試す' })).not.toBeVisible()
})
