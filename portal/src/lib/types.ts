// src/lib/types.ts — Định nghĩa TypeScript types cho toàn bộ ứng dụng HeheHR Portal

export interface Payslip {
  id: string
  ma_nv: string
  thang_nam: string
  ten_cong_ty?: string
  pdf_path: string
  uploaded_at?: string
  employee_id?: string
  company_name?: string
  month?: number
  year?: number
  file_path?: string
}

export interface Employee {
  id: string
  employee_id: string        // Mã nhân viên (maNV)
  full_name: string          // Họ tên đầy đủ
  email: string              // Email Supabase: maNV@hehehr.internal
  company_name: string       // Tên công ty
  created_at: string
}

// Thông tin user từ Supabase Auth
export interface UserMetadata {
  password_changed?: boolean // Đã đổi mật khẩu chưa
  employee_id?: string       // Mã nhân viên
  full_name?: string         // Họ tên
  company_name?: string      // Tên công ty
}

// Props cho các page components
export interface PageProps {
  params: Record<string, string>
  searchParams: Record<string, string | string[] | undefined>
}
