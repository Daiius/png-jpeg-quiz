import { expect, test } from '@playwright/test'

/**
 * キーボードと支援技術（GOAL ステップ 5）。
 *
 * 2 択クイズは入力系を極限まで良くできる。「1 / 2（P / J）で回答、Enter で次へ」が
 * 30 問の反復を「見る → 打つ」のリズムにする（prd/README「身体感覚として鍛える」）。
 */

test('キーボードだけで回答して次へ進める', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('button', { name: 'PNG', exact: true })).toBeVisible({
    timeout: 30_000,
  })

  // 1 = PNG で回答 → 判定の行にフォーカスが移る
  await page.waitForTimeout(400)
  await page.keyboard.press('1')
  const verdict = page.locator('p').filter({ hasText: /小さいのは (PNG|JPEG) でした/ })
  await expect(verdict).toBeVisible({ timeout: 15_000 })
  await expect(verdict).toBeFocused()

  // Enter で次の問題へ
  await page.keyboard.press('Enter')
  await expect(page.getByText(/第 2 問/)).toBeVisible({ timeout: 15_000 })

  // J = JPEG でも回答できる
  await page.waitForTimeout(400)
  await page.keyboard.press('j')
  await expect(page.locator('p').filter({ hasText: /小さいのは (PNG|JPEG) でした/ })).toBeVisible({
    timeout: 15_000,
  })
})

test('ダイアログ表示中はショートカットが効かない', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('button', { name: 'PNG', exact: true })).toBeVisible({
    timeout: 30_000,
  })

  await page.waitForTimeout(400)
  await page.getByRole('button', { name: '拡大して細部を見る' }).click()
  await expect(page.getByRole('dialog', { name: '拡大表示' })).toBeVisible()

  // ダイアログの上で 1 を押しても回答は送られない
  await page.keyboard.press('1')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: '拡大表示' })).not.toBeVisible()
  // まだ第 1 問の出題中のまま
  await expect(page.getByText(/第 1 問/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'PNG', exact: true })).toBeVisible()
})

test('トグル群は aria-pressed で状態を示す', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('button', { name: 'PNG', exact: true })).toBeVisible({
    timeout: 30_000,
  })

  await page.getByRole('button', { name: '拡大して細部を見る' }).click()
  const dialog = page.getByRole('dialog', { name: '拡大表示' })
  await expect(dialog).toBeVisible()

  // 倍率トグル: fit（全体）が押下状態で始まり、1:1 を押すと状態が移る
  await expect(dialog.getByRole('button', { name: '全体' })).toHaveAttribute('aria-pressed', 'true')
  await dialog.getByRole('button', { name: '1:1' }).click()
  await expect(dialog.getByRole('button', { name: '1:1' })).toHaveAttribute('aria-pressed', 'true')
  await expect(dialog.getByRole('button', { name: '全体' })).toHaveAttribute(
    'aria-pressed',
    'false',
  )
})

/**
 * 色数ヒントの 2 度押し（prd/06 §7.5）。確認ダイアログは使わず、同じボタンを 2 度押させる。
 * 1 度目で出す警告は live region に載せる——読み上げ環境でも「押すと何が起きるか」が届く。
 */
test('色数ヒントは同じボタンの 2 度押しで開示される', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' })

  const hintButton = page.getByRole('button', { name: 'ヒントを見る' })
  await expect(hintButton).toBeVisible({ timeout: 30_000 })
  // 🔒 ラベルに括弧書きの減点表示を持たせない（「減点なし」が「見ても減点されない」と読める）
  await expect(hintButton).toHaveText('ヒントを見る')

  const notice = page.locator('#hint-notice')
  const badge = page.locator('p').filter({ hasText: '色数ヒント:' })

  // 1 度目は警告だけ。開示はされない
  await hintButton.click()
  await expect(notice).toHaveAttribute('aria-live', 'polite')
  await expect(notice).toHaveText(/もう一度押すと表示します/)
  await expect(badge).toHaveCount(0)

  // 2 度目で開示（2 段階レンジ。prd/06 §7.1）。開示直後はバッジにフォーカスが移る
  await hintButton.click()
  await expect(badge).toBeVisible({ timeout: 15_000 })
  await expect(badge).toContainText(/256 色(以下|超)/)
  await expect(badge).toBeFocused()
})
