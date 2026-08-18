import type { Instrumentation } from 'next'

/**
 * サーバエラーの観測（prd/02 §7）。**構造化ログ（1 行 1 JSON）で stdout に出す**だけ。
 * `docker compose logs web` で追える。外部 SaaS には送らない。
 *
 * 🔒 ヘッダ・Cookie・ボディはログに残さない（セッションの `secret` が Cookie に載っている）。
 * 記録するのはメソッド・パス・ルートとエラーの内容だけ。
 */

export function register(): void {
  // 起動時に 1 行出す。instrumentation が読み込まれていること自体を運用ログで確認できるようにする
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: 'info',
      event: 'instrumentation-registered',
    }),
  )
}

export const onRequestError: Instrumentation.onRequestError = (error, request, context) => {
  const cause = error instanceof Error ? error : new Error(String(error))
  console.error(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: 'error',
      event: 'request-error',
      method: request.method,
      path: request.path,
      routePath: context.routePath,
      routeType: context.routeType,
      message: cause.message,
      stack: cause.stack,
    }),
  )
}
