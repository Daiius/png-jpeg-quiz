import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // self-host（prd/02 §7）。docker イメージを小さく保つ
  output: 'standalone',
  // workspace のパッケージは TypeScript のソースのまま配っているので、web 側で変換する
  transpilePackages: ['@png-jpeg-quiz/quiz-core', '@png-jpeg-quiz/database'],
  typedRoutes: true,
}

export default nextConfig
