import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import './globals.css'

export const metadata: Metadata = {
  title: 'PNG / JPEG どっちが小さい？',
  description:
    '表示された画像を、指定の条件で PNG と JPEG にエンコードしたとき、どちらが小さいかを当てる 2 択クイズ。',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja">
      <body className="min-h-dvh bg-white text-slate-900 antialiased">{children}</body>
    </html>
  )
}
