// src/lib/supabase/client.ts — Supabase client dùng ở phía browser (Client Components)
// Sử dụng @supabase/ssr để quản lý cookie đúng chuẩn Next.js App Router

import { createBrowserClient } from '@supabase/ssr'

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
