-- ============================================================
-- HeheHR Portal — Supabase Schema
-- Chạy file này trong Supabase SQL Editor:
-- Dashboard → SQL Editor → New query → paste → Run
-- ============================================================

-- ==============================
-- 1. BẢNG NHÂN VIÊN
-- ==============================
create table if not exists public.employees (
  id          uuid primary key default gen_random_uuid(),
  ma_nv       text unique not null,
  ho_ten      text not null,
  bo_phan     text,
  khoi        text,
  co_so       text,
  user_id     uuid references auth.users(id) on delete set null,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

comment on table public.employees is 'Danh sách nhân viên — được đồng bộ từ HeheHR Desktop khi upload phiếu lương';
comment on column public.employees.user_id is 'Liên kết với tài khoản Supabase Auth của nhân viên';

-- ==============================
-- 2. BẢNG PHIẾU LƯƠNG
-- ==============================
create table if not exists public.payslips (
  id          uuid primary key default gen_random_uuid(),
  ma_nv       text not null references public.employees(ma_nv) on delete cascade,
  thang_nam   text not null,          -- "06/2026"
  ten_cong_ty text,
  pdf_path    text not null,          -- đường dẫn trong Storage bucket
  uploaded_at timestamptz default now(),
  status      text not null default 'active', -- 'active' (đang phát hành) | 'revoked' (đã thu hồi)
  revoked_at  timestamptz,
  unique(ma_nv, thang_nam)
);

-- Tự động thêm cột status và revoked_at nếu bảng đã được tạo trước đó:
alter table public.payslips add column if not exists status text not null default 'active';
alter table public.payslips add column if not exists revoked_at timestamptz;

comment on table public.payslips is 'Phiếu lương đã upload lên portal';
comment on column public.payslips.pdf_path is 'Đường dẫn file PDF trong bucket: payslips/{ma_nv}/{thang_nam_slug}.pdf';
comment on column public.payslips.status is 'Trạng thái phiếu lương: active (đang phát hành) hoặc revoked (đã thu hồi)';
comment on column public.payslips.revoked_at is 'Thời điểm thu hồi phiếu lương';

-- ==============================
-- 3. STORAGE BUCKET
-- ==============================
-- Chạy trong Supabase Dashboard → Storage → New bucket
-- Tên bucket: payslips
-- Public: TẮT (private — chỉ truy cập qua signed URL)

insert into storage.buckets (id, name, public)
values ('payslips', 'payslips', false)
on conflict (id) do nothing;

-- ==============================
-- 4. ROW LEVEL SECURITY (RLS)
-- ==============================

-- Bật RLS
alter table public.employees enable row level security;
alter table public.payslips enable row level security;

-- Xóa policy cũ nếu có để tránh trùng lặp khi chạy lại
drop policy if exists "employee_self_read_employees" on public.employees;
drop policy if exists "employee_self_read_payslips" on public.payslips;
drop policy if exists "service_role_all_employees" on public.employees;
drop policy if exists "service_role_all_payslips" on public.payslips;
drop policy if exists "employee_read_own_payslip" on storage.objects;
drop policy if exists "service_role_upload_payslip" on storage.objects;
drop policy if exists "service_role_update_payslip" on storage.objects;

-- Policy: nhân viên chỉ đọc được thông tin của chính mình
create policy "employee_self_read_employees"
  on public.employees for select
  using (user_id = auth.uid());

-- Policy: nhân viên đọc phiếu lương của chính mình (chỉ đọc phiếu đang phát hành 'active')
create policy "employee_self_read_payslips"
  on public.payslips for select
  using (
    (status = 'active' or status is null)
    and (
      lower(ma_nv) = lower(split_part(auth.jwt() ->> 'email', '@', 1))
      or
      ma_nv in (
        select ma_nv from public.employees where user_id = auth.uid()
      )
    )
  );

-- Policy: service_role có toàn quyền (dùng cho desktop app upload)
create policy "service_role_all_employees"
  on public.employees for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create policy "service_role_all_payslips"
  on public.payslips for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- ==============================
-- 5. STORAGE POLICIES
-- ==============================

-- Nhân viên chỉ đọc được file PDF của chính mình
create policy "employee_read_own_payslip"
  on storage.objects for select
  using (
    bucket_id = 'payslips'
    and (
      lower(split_part(name, '/', 1)) = lower(split_part(auth.jwt() ->> 'email', '@', 1))
      or
      auth.uid() in (
        select user_id from public.employees
        where lower(ma_nv) = lower(split_part(name, '/', 1))
          and user_id is not null
      )
    )
  );

-- service_role upload tất cả (INSERT trong PostgreSQL bắt buộc dùng WITH CHECK)
create policy "service_role_upload_payslip"
  on storage.objects for insert
  with check (bucket_id = 'payslips' and auth.role() = 'service_role');

create policy "service_role_update_payslip"
  on storage.objects for update
  using (bucket_id = 'payslips' and auth.role() = 'service_role')
  with check (bucket_id = 'payslips' and auth.role() = 'service_role');

-- ==============================
-- 6. TRIGGER: tự cập nhật updated_at
-- ==============================
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger employees_updated_at
  before update on public.employees
  for each row execute function public.set_updated_at();

-- ==============================
-- 7. HELPER FUNCTION: lấy ma_nv từ user hiện tại
-- ==============================
create or replace function public.get_my_ma_nv()
returns text language sql security definer as $$
  select ma_nv from public.employees where user_id = auth.uid() limit 1;
$$;
