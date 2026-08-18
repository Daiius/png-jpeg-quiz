import { expect, test } from '@playwright/test'

/**
 * 通し E2E: 開いた瞬間の出題 → 回答 → 正解画面 → 次問 → 完走（prd/06 §2.1, prd/04 §4）。
 *
 * ⚠ **画像の読み込みには依存しない。** dev:remote では `ASSET_BASE_URL` が認証付きの
 * 公開ホストを指し、ローカルのブラウザからは画像が取れない。DOM の遷移だけを検証する。
 *
 * 問題数はセッションの `total` 表示から読む。`DEV_QUESTION_COUNT` で短縮された
 * スタックでも、フルの practice / standard-30 でも同じテストが通る。
 */

test('開いた瞬間に出題され、全問回答して完走できる', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' })

  // 開いた瞬間に 1 問目が出ている（開始ボタンを挟まない。prd/06 §2.1）
  const pngButton = page.getByRole('button', { name: 'PNG', exact: true })
  await expect(pngButton).toBeVisible({ timeout: 30_000 })

  // 🔒 リロードで同じセッションに戻れるよう URL が差し替わる（prd/06 §2.1）
  await expect(page).toHaveURL(/\?session=/)

  const counter = page.getByText(/第 \d+ 問 \/ 全 \d+ 問/)
  const total = Number((await counter.innerText()).match(/全 (\d+) 問/)?.[1])
  expect(total).toBeGreaterThan(0)

  for (let index = 0; index < total; index++) {
    await expect(page.getByText(new RegExp(`第 ${index + 1} 問 / 全 ${total} 問`))).toBeVisible()

    // 最短回答時間（MIN_ANSWER_MS = 300ms）を下回ると 429 になる（prd/04 §5.2）
    await page.waitForTimeout(400)
    const chosen = index % 2 === 0 ? 'PNG' : 'JPEG'
    await page.getByRole('button', { name: chosen, exact: true }).click()

    // 正解画面（prd/04 §4）。正誤どちらでも「小さいのは◯◯でした」が出る
    await expect(page.getByText(/小さいのは (PNG|JPEG) でした/)).toBeVisible({ timeout: 15_000 })

    const nextLabel = index + 1 < total ? '次の問題へ' : '結果を見る'
    await page.getByRole('button', { name: nextLabel }).click()
  }

  await expect(page.getByText('おしまい')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText(/全問終わりました/)).toBeVisible()

  // 完走画面もリロードで復元される（得点の表示を含めて。prd/06 §2.1）
  const finishedText = await page.getByText(/全問終わりました/).innerText()
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.getByText('おしまい')).toBeVisible({ timeout: 30_000 })
  expect(await page.getByText(/全問終わりました/).innerText()).toBe(finishedText)
})

test('出題中にリロードすると同じ問題に戻る', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('button', { name: 'PNG', exact: true })).toBeVisible({
    timeout: 30_000,
  })
  await expect(page).toHaveURL(/\?session=/)

  const counterBefore = await page.getByText(/第 \d+ 問 \/ 全 \d+ 問/).innerText()
  // 問題の同一性は出題画像の src で見る（番号だけでは、別の問題を選び直す回帰に気づけない。
  // OCL-A29FC312。src の比較なので画像の取得成功は要らない）
  const srcBefore = await page.locator('img[alt="出題画像"]').getAttribute('src')
  expect(srcBefore).toBeTruthy()

  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('button', { name: 'PNG', exact: true })).toBeVisible({
    timeout: 30_000,
  })

  // 未回答の問題は再出題される（quiz-service の「出題済みなら同じ問題を返す」）
  const counterAfter = await page.getByText(/第 \d+ 問 \/ 全 \d+ 問/).innerText()
  expect(counterAfter).toBe(counterBefore)
  expect(await page.locator('img[alt="出題画像"]').getAttribute('src')).toBe(srcBefore)
})
