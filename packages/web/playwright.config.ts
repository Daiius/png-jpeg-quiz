import { defineConfig } from '@playwright/test'

/**
 * E2E は**稼働中の dev スタック**（docker compose）に対して実行する。
 * サーバの起動はこの設定では行わない（CI への組み込みは M4）。
 *
 * 接続先は `E2E_BASE_URL` で上書きできる。既定は compose の既定ポート 3000。
 * `.env` で `WEB_PORT` を変えている場合はそちらに合わせること。
 */
const baseURL =
  process.env['E2E_BASE_URL'] ?? `http://localhost:${process.env['WEB_PORT'] ?? '3000'}`

export default defineConfig({
  testDir: './e2e',
  // 完走テストは問題数ぶんの回答（1 問 300ms 超）を積むので、既定 30 秒では足りない
  timeout: 300_000,
  use: {
    baseURL,
    trace: 'retain-on-failure',
  },
  // ⚠ dev スタック（HMR あり）相手なので、失敗の再試行はしない。壊れたら壊れたと分かるほうが良い
  retries: 0,
})
