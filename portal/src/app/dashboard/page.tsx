// src/app/dashboard/page.tsx — Trang danh sách phiếu lương (Server Component)
// Hiển thị tất cả phiếu lương của nhân viên đang đăng nhập

import { createClient } from '../../lib/supabase/server'
import { redirect } from 'next/navigation'
import type { Payslip } from '../../lib/types'
import DashboardClient from './DashboardClient'

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
      payslips = data ?? []
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
