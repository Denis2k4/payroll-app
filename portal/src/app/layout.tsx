// src/app/layout.tsx — Root layout cho toàn bộ ứng dụng HeheHR Portal
// Cung cấp HTML wrapper, font, và metadata chung

import type { Metadata, Viewport } from 'next'
import './globals.css'

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  themeColor: '#10B981',
}

export const metadata: Metadata = {
  title: 'HeheHR Portal — Phiếu Lương',
  description: 'Cổng tra cứu phiếu lương nhân viên HeheHR',
  icons: {
    icon: '/logo.png',
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="vi">
      <body className="antialiased">
        {children}
      </body>
    </html>
  )
}
