// src/app/dashboard/page.tsx — Trang danh sách phiếu lương (Server Component)
// Hiển thị tất cả phiếu lương của nhân viên đang đăng nhập

import { createClient } from '../../lib/supabase/server'
import { redirect } from 'next/navigation'
import type { Payslip } from '../../lib/types'
import DashboardClient from './DashboardClient'

// Helper tính điểm sắp xếp theo năm và tháng: YYYYMM (ví dụ 06/2026 -> 202606)
function getPayslipSortScore(p: Payslip): number {
  if (p.year && p.month) {
    return Number(p.year) * 100 + Number(p.month)
  }

  const str = String(p.thang_nam || '').trim()
  if (str) {
    // MM/YYYY hoặc M/YYYY (ví dụ: 06/2026, 6/2026, Tháng 06/2026, 06-2026)
    const m1 = str.match(/(\d{1,2})\s*[/._-]\s*(\d{4})/)
    if (m1) {
      const month = parseInt(m1[1], 10)
      const year = parseInt(m1[2], 10)
      if (month >= 1 && month <= 12 && year >= 2000 && year <= 2100) {
        return year * 100 + month
      }
    }

    // YYYY/MM hoặc YYYY-MM
    const m2 = str.match(/(\d{4})\s*[/._-]\s*(\d{1,2})/)
    if (m2) {
      const year = parseInt(m2[1], 10)
      const month = parseInt(m2[2], 10)
      if (month >= 1 && month <= 12 && year >= 2000 && year <= 2100) {
        return year * 100 + month
      }
    }

    // Dạng "Tháng 6 năm 2026"
    const m3 = str.match(/(?:tháng\s*)?(\d{1,2})\D+(\d{4})/i)
    if (m3) {
      const month = parseInt(m3[1], 10)
      const year = parseInt(m3[2], 10)
      if (month >= 1 && month <= 12 && year >= 2000 && year <= 2100) {
        return year * 100 + month
      }
    }
  }

  if (p.uploaded_at) {
    const time = new Date(p.uploaded_at).getTime()
    if (!isNaN(time)) return time
  }

  return 0
}

export default async function DashboardPage() {
  const supabase = await createClient()

  // Lấy thông tin user đang đăng nhập
  const { data: { user }, error: userError } = await supabase.auth.getUser()

  if (userError || !user) {
    redirect('/')
  }

  // Trích xuất mã NV từ email hoặc metadata (hỗ trợ cả chữ hoa và chữ thường)
  const emailMaNV = user.email?.replace('@hehehr.internal', '') ?? ''
  const metaMaNV = user.user_metadata?.ma_nv ?? ''
  const searchMaNV = metaMaNV || emailMaNV

  // Lấy thông tin nhân viên từ bảng employees (dùng ilike để không phân biệt HOA/thường)
  const { data: empData } = await supabase
    .from('employees')
    .select('ma_nv, ho_ten, bo_phan')
    .or(`user_id.eq.${user.id},ma_nv.ilike.${searchMaNV}`)
    .maybeSingle()

  const actualMaNV = empData?.ma_nv ?? metaMaNV ?? emailMaNV
  const tenNV = empData?.ho_ten ?? user.user_metadata?.full_name ?? actualMaNV
  const tenCongTy = user.user_metadata?.company_name ?? 'HeheHR'

  // Lấy danh sách phiếu lương từ database (ilike để khớp cả HOA lẫn thường)
  let payslips: Payslip[] = []
  let fetchError: string | null = null

  try {
    const { data, error } = await supabase
      .from('payslips')
      .select('*')
      .ilike('ma_nv', actualMaNV)
      .or('status.eq.active,status.is.null')
      .order('uploaded_at', { ascending: false })

    if (error) {
      console.error('Lỗi lấy phiếu lương:', error)
      fetchError = 'Không thể tải danh sách phiếu lương. Vui lòng thử lại.'
    } else {
      payslips = (data ?? []).sort((a, b) => {
        const scoreA = getPayslipSortScore(a)
        const scoreB = getPayslipSortScore(b)
        if (scoreB !== scoreA) return scoreB - scoreA
        const timeA = a.uploaded_at ? new Date(a.uploaded_at).getTime() : 0
        const timeB = b.uploaded_at ? new Date(b.uploaded_at).getTime() : 0
        return timeB - timeA
      })
    }
  } catch {
    fetchError = 'Lỗi kết nối mạng. Vui lòng kiểm tra kết nối và thử lại.'
  }

  return (
    <DashboardClient
      payslips={payslips}
      maNV={actualMaNV}
      tenNV={tenNV}
      tenCongTy={tenCongTy}
      fetchError={fetchError}
    />
  )
}
