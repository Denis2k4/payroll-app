// src/lib/supabase/server.ts — Supabase client dùng ở phía server (Server Components, Route Handlers)
// Sử dụng cookies() từ next/headers để đọc/ghi session

import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet: { name: string; value: string; options?: CookieOptions }[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // setAll có thể bị gọi từ Server Component — bỏ qua lỗi này
            // Middleware sẽ xử lý việc refresh session
          }
        },
      },
    }
  )
}
