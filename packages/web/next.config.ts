import type { NextConfig } from 'next'

/**
 * リモート dev 公開（`pnpm dev:remote`。prd/02 §6.1）で、前段プロキシの公開ホスト名を
 * dev サーバに許可する。
 *
 * ⚠ Next 16 の dev サーバは `/_next/*` と `/__nextjs*` への**クロスオリジン要求を既定で
 * 403 にする**。ページ遷移の GET は Origin ヘッダを持たないので通るが、**HMR の WebSocket は
 * Origin を送るのでここで落ちる**（画面は出るのに更新が反映されない、という形で現れる）。
 *
 * ローカル dev では PUBLIC_ORIGIN が localhost なので、Next 側の既定の許可で足りる。
 */
function devOriginsFromPublicOrigin(): string[] {
  const origin = process.env['PUBLIC_ORIGIN']
  if (!origin) return []
  try {
    return [new URL(origin).hostname]
  } catch {
    return []
  }
}

const nextConfig: NextConfig = {
  // self-host（prd/02 §7）。docker イメージを小さく保つ
  output: 'standalone',
  // workspace のパッケージは TypeScript のソースのまま配っているので、web 側で変換する
  transpilePackages: ['@png-jpeg-quiz/quiz-core', '@png-jpeg-quiz/database'],
  typedRoutes: true,
  allowedDevOrigins: devOriginsFromPublicOrigin(),
}

export default nextConfig
