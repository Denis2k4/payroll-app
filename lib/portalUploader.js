// portalUploader.js
// Module upload phiếu lương lên Supabase Portal.
// Dùng Node.js built-in `https` — KHÔNG phụ thuộc @supabase/supabase-js.

'use strict';

const https = require('https');
const http  = require('http');
const { URL } = require('url');

// ----------------------------------------------------------------
// Helper: slugify tháng/năm  "06/2026" hoặc "Tháng 06/2026" → "06-2026" hoặc "Thang-06-2026"
// Chuẩn hóa loại bỏ dấu tiếng Việt và ký tự đặc biệt an toàn cho URL Storage
// ----------------------------------------------------------------
function slugThangNam(thangNam) {
  return String(thangNam || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'ky-luong';
}

// ----------------------------------------------------------------
// Helper HTTP/HTTPS request trả về Promise<{ status, body }>
// body là object nếu JSON parse được, nguyên văn string nếu không.
// ----------------------------------------------------------------
function supabaseRequest(urlStr, method, body, headers) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(urlStr);
    } catch (err) {
      return reject(new Error(`URL không hợp lệ: ${urlStr}`));
    }

    const isHttps = parsed.protocol === 'https:';
    const lib = isHttps ? https : http;

    const bodyBuffer = body instanceof Buffer
      ? body
      : body !== undefined && body !== null
        ? Buffer.from(typeof body === 'string' ? body : JSON.stringify(body), 'utf8')
        : null;

    const reqHeaders = {
      'Content-Type': 'application/json',
      ...headers,
    };

    if (bodyBuffer) {
      reqHeaders['Content-Length'] = bodyBuffer.length;
    }

    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: method || 'GET',
      headers: reqHeaders,
    };

    const req = lib.request(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let parsed2;
        try { parsed2 = JSON.parse(raw); } catch { parsed2 = raw; }
        resolve({ status: res.statusCode, body: parsed2 });
      });
    });

    req.on('error', reject);

    if (bodyBuffer) {
      req.write(bodyBuffer);
    }
    req.end();
  });
}

// ----------------------------------------------------------------
// Tải một nhân viên lên portal:
//   1. Upsert employees
//   2. Tạo auth user nếu chưa có
//   3. Update employees.user_id
//   4. Upload PDF → storage
//   5. Upsert payslips
// ----------------------------------------------------------------
async function uploadOneEmployee({ supabaseUrl, serviceRoleKey, employee }) {
  const baseUrl = supabaseUrl.replace(/\/$/, '');
  const authHeader = {
    'apikey': serviceRoleKey,
    'Authorization': `Bearer ${serviceRoleKey}`,
  };

  const {
    maNV,
    hoTen,
    boPhan,
    khoi,
    coSo,
    pdfBuffer,
    thangNam,
    tenCongTy,
  } = employee;

  const cleanMaNV = String(maNV || '').trim();
  if (!cleanMaNV) {
    throw new Error('Mã nhân viên trống.');
  }

  const slug = slugThangNam(thangNam);
  const email = `${cleanMaNV.toLowerCase()}@hehehr.internal`;

  // 1. Upsert employee record (on_conflict=ma_nv để cập nhật nếu nhân viên đã tồn tại)
  const empRes = await supabaseRequest(
    `${baseUrl}/rest/v1/employees?on_conflict=ma_nv`,
    'POST',
    {
      ma_nv: cleanMaNV,
      ho_ten: hoTen || cleanMaNV,
      bo_phan: boPhan || '',
      khoi: khoi || '',
      co_so: coSo || '',
    },
    {
      ...authHeader,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates,return=representation',
    },
  );

  if (empRes.status >= 400) {
    const errMsg = typeof empRes.body === 'object' ? (empRes.body.message || empRes.body.error || JSON.stringify(empRes.body)) : String(empRes.body);
    throw new Error(`Đồng bộ bảng employees thất bại (${empRes.status}): ${errMsg}`);
  }

  // 2. Lấy hoặc tạo Supabase Auth user
  let userId = empRes.body?.[0]?.user_id || null;

  if (!userId) {
    // Kiểm tra xem nhân viên đã có user_id chưa
    const existingEmp = await supabaseRequest(
      `${baseUrl}/rest/v1/employees?ma_nv=eq.${encodeURIComponent(cleanMaNV)}&select=user_id`,
      'GET',
      null,
      authHeader,
    );
    userId = existingEmp.body?.[0]?.user_id || null;
  }

  if (!userId) {
    // Supabase Auth yêu cầu mật khẩu tối thiểu 6 ký tự
    const authPassword = cleanMaNV.length >= 6 ? cleanMaNV : `${cleanMaNV}123456`.slice(0, 8);

    // Tạo mới auth user
    const createRes = await supabaseRequest(
      `${baseUrl}/auth/v1/admin/users`,
      'POST',
      {
        email,
        password: authPassword,
        email_confirm: true,
        user_metadata: { ma_nv: cleanMaNV, password_changed: false },
      },
      {
        ...authHeader,
        'Content-Type': 'application/json',
      },
    );

    if (createRes.status < 400) {
      userId = createRes.body?.id || createRes.body?.user?.id;
    } else {
      // Nếu user đã tồn tại (lỗi 422), tìm ID trong danh sách auth users
      try {
        const listRes = await supabaseRequest(
          `${baseUrl}/auth/v1/admin/users?per_page=1000`,
          'GET',
          null,
          authHeader,
        );
        if (listRes.status === 200) {
          const users = listRes.body?.users || (Array.isArray(listRes.body) ? listRes.body : []);
          const matched = users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
          if (matched) {
            userId = matched.id;
          }
        }
      } catch {
        // Bỏ qua lỗi tìm user ID
      }
    }
  }

  // 3. Update employees.user_id nếu lấy được ID
  if (userId) {
    try {
      await supabaseRequest(
        `${baseUrl}/rest/v1/employees?ma_nv=eq.${encodeURIComponent(cleanMaNV)}`,
        'PATCH',
        { user_id: userId },
        {
          ...authHeader,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal',
        },
      );
    } catch {
      // Bỏ qua nếu không update được user_id
    }
  }

  // 4. Upload PDF lên Storage (nếu có dữ liệu pdfBuffer; nếu dùng cơ chế JSON thì bỏ qua bước này để tối ưu tốc độ)
  let storagePath = null;
  if (employee.pdfBuffer && employee.pdfBuffer.length) {
    const safeMaNV = encodeURIComponent(cleanMaNV);
    const safeSlug = encodeURIComponent(slug);
    const pdfPath = `${baseUrl}/storage/v1/object/payslips/${safeMaNV}/${safeSlug}.pdf`;
    const storageUploadHeaders = {
      ...authHeader,
      'Content-Type': 'application/pdf',
      'Content-Length': employee.pdfBuffer.length,
      'x-upsert': 'true',
    };

    let uploadRes = await supabaseRequest(
      pdfPath,
      'PUT',
      employee.pdfBuffer,
      storageUploadHeaders,
    );

    // Nếu bucket payslips chưa có (HTTP 404 hoặc Bucket not found), tự động tạo bucket payslips rồi thử lại
    if (uploadRes.status === 404 || (uploadRes.body && JSON.stringify(uploadRes.body).includes('Bucket not found'))) {
      await supabaseRequest(
        `${baseUrl}/storage/v1/bucket`,
        'POST',
        { id: 'payslips', name: 'payslips', public: false },
        { ...authHeader, 'Content-Type': 'application/json' }
      );

      uploadRes = await supabaseRequest(
        pdfPath,
        'PUT',
        employee.pdfBuffer,
        storageUploadHeaders,
      );
    }

    if (uploadRes.status < 400) {
      storagePath = `${cleanMaNV}/${slug}.pdf`;
    } else {
      const errMsg = typeof uploadRes.body === 'object' ? (uploadRes.body.message || uploadRes.body.error || JSON.stringify(uploadRes.body)) : String(uploadRes.body);
      console.warn(`Upload PDF lên Storage thất bại (${uploadRes.status}): ${errMsg}`);
    }
  }

  // 5. Upsert vào bảng payslips (lưu dữ liệu có cấu trúc JSON trong cột data)
  let payslipBody = {
    ma_nv: cleanMaNV,
    thang_nam: thangNam,
    ten_cong_ty: tenCongTy,
    pdf_path: storagePath || '',
    data: employee.data || null,
    uploaded_at: new Date().toISOString(),
    status: 'active',
    revoked_at: null,
  };

  let payslipRes = await supabaseRequest(
    `${baseUrl}/rest/v1/payslips?on_conflict=ma_nv,thang_nam`,
    'POST',
    payslipBody,
    {
      ...authHeader,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates,return=representation',
    },
  );

  // Nếu database Supabase chưa có cột data, status hoặc revoked_at, tự động retry bỏ các cột này
  if (payslipRes.status >= 400) {
    const errBodyStr = JSON.stringify(payslipRes.body || '');
    if (errBodyStr.includes('data')) {
      delete payslipBody.data;
    }
    if (errBodyStr.includes('status') || errBodyStr.includes('revoked_at')) {
      delete payslipBody.status;
      delete payslipBody.revoked_at;
    }
    payslipRes = await supabaseRequest(
      `${baseUrl}/rest/v1/payslips?on_conflict=ma_nv,thang_nam`,
      'POST',
      payslipBody,
      {
        ...authHeader,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates,return=representation',
      },
    );
  }

  if (payslipRes.status >= 400) {
    const errMsg = typeof payslipRes.body === 'object' ? (payslipRes.body.message || payslipRes.body.error || JSON.stringify(payslipRes.body)) : String(payslipRes.body);
    throw new Error(`Lưu phiếu lương vào bảng payslips thất bại (${payslipRes.status}): ${errMsg}`);
  }

  return { maNV: cleanMaNV, success: true };
}

// ----------------------------------------------------------------
// Export chính: uploadToPortal
// ----------------------------------------------------------------
async function uploadToPortal({ supabaseUrl, serviceRoleKey, employees, onProgress }) {
  const total = employees.length;
  const results = [];

  for (let i = 0; i < employees.length; i++) {
    const employee = employees[i];
    const maNV = employee.maNV;

    if (typeof onProgress === 'function') {
      onProgress(i, total, maNV, 'uploading');
    }

    try {
      await uploadOneEmployee({ supabaseUrl, serviceRoleKey, employee });
      results.push({ maNV, success: true });
      if (typeof onProgress === 'function') {
        onProgress(i + 1, total, maNV, 'done');
      }
    } catch (err) {
      results.push({ maNV, success: false, error: err.message || String(err) });
      if (typeof onProgress === 'function') {
        onProgress(i + 1, total, maNV, 'error');
      }
    }
  }

  return results;
}

// ----------------------------------------------------------------
// QUẢN LÝ PHIẾU LƯƠNG: Lấy danh sách phiếu lương từ Supabase
// ----------------------------------------------------------------
async function fetchPayslips({ supabaseUrl, serviceRoleKey, thangNam }) {
  const baseUrl = supabaseUrl.replace(/\/$/, '');
  const authHeader = {
    'apikey': serviceRoleKey,
    'Authorization': `Bearer ${serviceRoleKey}`,
  };

  let payslipsUrl = `${baseUrl}/rest/v1/payslips?select=*&order=uploaded_at.desc`;
  if (thangNam && thangNam !== 'all') {
    payslipsUrl += `&thang_nam=eq.${encodeURIComponent(thangNam)}`;
  }

  const [payslipsRes, employeesRes] = await Promise.all([
    supabaseRequest(payslipsUrl, 'GET', null, authHeader),
    supabaseRequest(`${baseUrl}/rest/v1/employees?select=ma_nv,ho_ten,bo_phan,khoi,co_so`, 'GET', null, authHeader),
  ]);

  if (payslipsRes.status >= 400) {
    throw new Error(`Không thể lấy danh sách phiếu lương (${payslipsRes.status}): ${JSON.stringify(payslipsRes.body)}`);
  }

  const payslips = Array.isArray(payslipsRes.body) ? payslipsRes.body : [];
  const empMap = new Map();
  if (employeesRes.status === 200 && Array.isArray(employeesRes.body)) {
    employeesRes.body.forEach((emp) => {
      if (emp.ma_nv) empMap.set(emp.ma_nv.toUpperCase(), emp);
    });
  }

  const merged = payslips.map((p) => {
    const emp = empMap.get((p.ma_nv || '').toUpperCase()) || {};
    return {
      id: p.id,
      ma_nv: p.ma_nv,
      thang_nam: p.thang_nam,
      ten_cong_ty: p.ten_cong_ty,
      pdf_path: p.pdf_path,
      uploaded_at: p.uploaded_at,
      status: p.status || 'active',
      revoked_at: p.revoked_at || null,
      ho_ten: emp.ho_ten || p.ma_nv,
      bo_phan: emp.bo_phan || '',
      khoi: emp.khoi || '',
      co_so: emp.co_so || '',
    };
  });

  return merged;
}

// ----------------------------------------------------------------
// QUẢN LÝ PHIẾU LƯƠNG: Thu hồi phiếu lương (chuyển status='revoked')
// ----------------------------------------------------------------
async function revokePayslips({ supabaseUrl, serviceRoleKey, ids }) {
  if (!ids || !ids.length) return { ok: true, count: 0 };
  const baseUrl = supabaseUrl.replace(/\/$/, '');
  const authHeader = {
    'apikey': serviceRoleKey,
    'Authorization': `Bearer ${serviceRoleKey}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation',
  };

  const idFilter = ids.map(encodeURIComponent).join(',');
  
  // 1. Thử cập nhật cả status và revoked_at
  let res = await supabaseRequest(
    `${baseUrl}/rest/v1/payslips?id=in.(${idFilter})`,
    'PATCH',
    { status: 'revoked', revoked_at: new Date().toISOString() },
    authHeader
  );

  // 2. Nếu thiếu cột revoked_at, thử lại chỉ với status
  if (res.status >= 400 && JSON.stringify(res.body || '').includes('revoked_at')) {
    res = await supabaseRequest(
      `${baseUrl}/rest/v1/payslips?id=in.(${idFilter})`,
      'PATCH',
      { status: 'revoked' },
      authHeader
    );
  }

  if (res.status >= 400) {
    const bodyStr = JSON.stringify(res.body || '');
    if (bodyStr.includes('PGRST204') || bodyStr.includes('status') || bodyStr.includes('revoked_at')) {
      const err = new Error(
        "Cơ sở dữ liệu Supabase chưa được thêm cột 'status' và 'revoked_at'. Vui lòng bấm nút '📋 Cập nhật SQL Database' trên giao diện để copy câu lệnh chạy trong Supabase SQL Editor."
      );
      err.code = "NEEDS_SQL_MIGRATION";
      throw err;
    }
    throw new Error(`Thu hồi phiếu lương thất bại (${res.status}): ${bodyStr}`);
  }
  return { ok: true, count: Array.isArray(res.body) ? res.body.length : ids.length };
}

// ----------------------------------------------------------------
// QUẢN LÝ PHIẾU LƯƠNG: Khôi phục phiếu lương (chuyển status='active')
// ----------------------------------------------------------------
async function restorePayslips({ supabaseUrl, serviceRoleKey, ids }) {
  if (!ids || !ids.length) return { ok: true, count: 0 };
  const baseUrl = supabaseUrl.replace(/\/$/, '');
  const authHeader = {
    'apikey': serviceRoleKey,
    'Authorization': `Bearer ${serviceRoleKey}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation',
  };

  const idFilter = ids.map(encodeURIComponent).join(',');
  
  // 1. Thử cập nhật cả status và revoked_at
  let res = await supabaseRequest(
    `${baseUrl}/rest/v1/payslips?id=in.(${idFilter})`,
    'PATCH',
    { status: 'active', revoked_at: null },
    authHeader
  );

  // 2. Nếu thiếu cột revoked_at, thử lại chỉ với status
  if (res.status >= 400 && JSON.stringify(res.body || '').includes('revoked_at')) {
    res = await supabaseRequest(
      `${baseUrl}/rest/v1/payslips?id=in.(${idFilter})`,
      'PATCH',
      { status: 'active' },
      authHeader
    );
  }

  if (res.status >= 400) {
    const bodyStr = JSON.stringify(res.body || '');
    if (bodyStr.includes('PGRST204') || bodyStr.includes('status') || bodyStr.includes('revoked_at')) {
      const err = new Error(
        "Cơ sở dữ liệu Supabase chưa được thêm cột 'status' và 'revoked_at'. Vui lòng bấm nút '📋 Cập nhật SQL Database' trên giao diện để copy câu lệnh chạy trong Supabase SQL Editor."
      );
      err.code = "NEEDS_SQL_MIGRATION";
      throw err;
    }
    throw new Error(`Khôi phục phiếu lương thất bại (${res.status}): ${bodyStr}`);
  }
  return { ok: true, count: Array.isArray(res.body) ? res.body.length : ids.length };
}

// ----------------------------------------------------------------
// QUẢN LÝ PHIẾU LƯƠNG: Xóa phiếu lương (xóa cả Storage và Database)
// ----------------------------------------------------------------
async function deletePayslips({ supabaseUrl, serviceRoleKey, items }) {
  if (!items || !items.length) return { ok: true, count: 0 };
  const baseUrl = supabaseUrl.replace(/\/$/, '');
  const authHeader = {
    'apikey': serviceRoleKey,
    'Authorization': `Bearer ${serviceRoleKey}`,
  };

  const ids = items.map((it) => (typeof it === 'object' ? it.id : it)).filter(Boolean);
  const pdfPaths = items
    .map((it) => (typeof it === 'object' ? it.pdf_path : null))
    .filter(Boolean)
    .map((p) => p.replace(/^payslips\//, ''));

  // 1. Xóa file trong Storage nếu có
  if (pdfPaths.length) {
    try {
      await supabaseRequest(
        `${baseUrl}/storage/v1/object/payslips`,
        'DELETE',
        { prefixes: pdfPaths },
        { ...authHeader, 'Content-Type': 'application/json' }
      );
    } catch (e) {
      console.warn('Lỗi khi xóa file PDF trong Storage bucket (vẫn tiếp tục xóa DB):', e.message);
    }
  }

  // 2. Xóa bản ghi trong Database
  const idFilter = ids.map(encodeURIComponent).join(',');
  const res = await supabaseRequest(
    `${baseUrl}/rest/v1/payslips?id=in.(${idFilter})`,
    'DELETE',
    null,
    { ...authHeader, 'Prefer': 'return=representation' }
  );

  if (res.status >= 400) {
    throw new Error(`Xóa phiếu lương thất bại (${res.status}): ${JSON.stringify(res.body)}`);
  }

  return { ok: true, count: Array.isArray(res.body) ? res.body.length : ids.length };
}

// ----------------------------------------------------------------
// QUẢN LÝ PHIẾU LƯƠNG: Tạo link xem trước (Signed URL)
// ----------------------------------------------------------------
async function createSignedUrl({ supabaseUrl, serviceRoleKey, pdfPath, expiresIn = 3600 }) {
  const baseUrl = supabaseUrl.replace(/\/$/, '');
  const authHeader = {
    'apikey': serviceRoleKey,
    'Authorization': `Bearer ${serviceRoleKey}`,
    'Content-Type': 'application/json',
  };

  const cleanPath = pdfPath.replace(/^payslips\//, '');
  const res = await supabaseRequest(
    `${baseUrl}/storage/v1/object/sign/payslips/${cleanPath}`,
    'POST',
    { expiresIn },
    authHeader
  );

  if (res.status >= 400 || !res.body?.signedURL) {
    throw new Error(`Không tạo được signed URL (${res.status}): ${JSON.stringify(res.body)}`);
  }

  const signedURL = res.body.signedURL.startsWith('http')
    ? res.body.signedURL
    : `${baseUrl}/storage/v1${res.body.signedURL}`;

  return { signedUrl: signedURL };
}

// ----------------------------------------------------------------
// QUẢN LÝ TÀI KHOẢN NHÂN VIÊN TRÊN SUPABASE
// ----------------------------------------------------------------
function getDefaultPassword(maNV) {
  const clean = String(maNV || '').trim();
  if (clean.length >= 6) return clean;
  return `${clean}123456`.slice(0, 8);
}

async function fetchAccounts({ supabaseUrl, serviceRoleKey }) {
  const baseUrl = supabaseUrl.replace(/\/$/, '');
  const authHeader = {
    'apikey': serviceRoleKey,
    'Authorization': `Bearer ${serviceRoleKey}`,
  };

  // 1. Tải song song: employees, auth users, và payslips
  const [empRes, usersRes, payslipsRes] = await Promise.all([
    supabaseRequest(`${baseUrl}/rest/v1/employees?select=*&order=ma_nv.asc`, 'GET', null, authHeader),
    supabaseRequest(`${baseUrl}/auth/v1/admin/users?per_page=1000`, 'GET', null, authHeader),
    supabaseRequest(`${baseUrl}/rest/v1/payslips?select=ma_nv,status`, 'GET', null, authHeader),
  ]);

  if (empRes.status >= 400) {
    throw new Error(`Không thể lấy danh sách nhân viên (${empRes.status}): ${JSON.stringify(empRes.body)}`);
  }

  const employees = Array.isArray(empRes.body) ? empRes.body : [];
  const rawUsers = usersRes.body?.users || (Array.isArray(usersRes.body) ? usersRes.body : []);
  const payslips = Array.isArray(payslipsRes.body) ? payslipsRes.body : [];

  // Map auth users theo id và theo email (chữ thường)
  const userById = new Map();
  const userByEmail = new Map();
  rawUsers.forEach((u) => {
    if (u.id) userById.set(u.id, u);
    if (u.email) userByEmail.set(u.email.toLowerCase(), u);
  });

  // Map số lượng phiếu lương
  const payslipStats = new Map();
  payslips.forEach((p) => {
    const ma = (p.ma_nv || '').toUpperCase();
    if (!payslipStats.has(ma)) {
      payslipStats.set(ma, { total: 0, active: 0 });
    }
    const stat = payslipStats.get(ma);
    stat.total += 1;
    if (p.status !== 'revoked') {
      stat.active += 1;
    }
  });

  // Tập hợp danh sách tài khoản hợp nhất
  const processedMaNVs = new Set();
  const accounts = [];

  employees.forEach((emp) => {
    const maNV = emp.ma_nv || '';
    const cleanMaNV = maNV.trim();
    processedMaNVs.add(cleanMaNV.toUpperCase());
    const expectedEmail = `${cleanMaNV.toLowerCase()}@hehehr.internal`;

    // Tìm auth user qua user_id hoặc email
    const authUser = (emp.user_id && userById.get(emp.user_id)) || userByEmail.get(expectedEmail);

    const isBanned = authUser?.banned_until ? new Date(authUser.banned_until) > new Date() : false;
    const passwordChanged = authUser?.user_metadata?.password_changed === true;
    const stat = payslipStats.get(cleanMaNV.toUpperCase()) || { total: 0, active: 0 };

    accounts.push({
      id: emp.id,
      ma_nv: cleanMaNV,
      ho_ten: emp.ho_ten || cleanMaNV,
      bo_phan: emp.bo_phan || '',
      khoi: emp.khoi || '',
      co_so: emp.co_so || '',
      user_id: authUser?.id || emp.user_id || null,
      email: expectedEmail,
      has_account: !!authUser,
      password_changed: passwordChanged,
      is_banned: isBanned,
      default_password: getDefaultPassword(cleanMaNV),
      last_sign_in_at: authUser?.last_sign_in_at || null,
      auth_created_at: authUser?.created_at || null,
      created_at: emp.created_at || null,
      payslip_count: stat.total,
      active_payslip_count: stat.active,
    });
  });

  // Nếu có auth users đuôi @hehehr.internal mà chưa có trong bảng employees
  rawUsers.forEach((u) => {
    const email = u.email || '';
    if (email.endsWith('@hehehr.internal')) {
      const maNV = email.replace('@hehehr.internal', '').toUpperCase();
      if (!processedMaNVs.has(maNV)) {
        processedMaNVs.add(maNV);
        const stat = payslipStats.get(maNV) || { total: 0, active: 0 };
        accounts.push({
          id: null,
          ma_nv: maNV,
          ho_ten: u.user_metadata?.ma_nv || maNV,
          bo_phan: '',
          khoi: '',
          co_so: '',
          user_id: u.id,
          email: email.toLowerCase(),
          has_account: true,
          password_changed: u.user_metadata?.password_changed === true,
          is_banned: u.banned_until ? new Date(u.banned_until) > new Date() : false,
          default_password: getDefaultPassword(maNV),
          last_sign_in_at: u.last_sign_in_at || null,
          auth_created_at: u.created_at || null,
          created_at: u.created_at || null,
          payslip_count: stat.total,
          active_payslip_count: stat.active,
        });
      }
    }
  });

  return accounts;
}

async function createAccountForEmployee({ supabaseUrl, serviceRoleKey, employee, customPassword }) {
  const baseUrl = supabaseUrl.replace(/\/$/, '');
  const authHeader = {
    'apikey': serviceRoleKey,
    'Authorization': `Bearer ${serviceRoleKey}`,
    'Content-Type': 'application/json',
  };

  const cleanMaNV = String(employee.ma_nv || employee.maNV || '').trim();
  if (!cleanMaNV) throw new Error('Mã nhân viên trống.');

  const hoTen = employee.ho_ten || employee.hoTen || cleanMaNV;
  const boPhan = employee.bo_phan || employee.boPhan || '';
  const khoi = employee.khoi || '';
  const coSo = employee.co_so || employee.coSo || '';

  const email = `${cleanMaNV.toLowerCase()}@hehehr.internal`;
  const password = customPassword || getDefaultPassword(cleanMaNV);

  // 1. Tạo auth user
  const createRes = await supabaseRequest(
    `${baseUrl}/auth/v1/admin/users`,
    'POST',
    {
      email,
      password,
      email_confirm: true,
      user_metadata: { ma_nv: cleanMaNV, password_changed: false },
    },
    authHeader
  );

  let userId = null;
  if (createRes.status < 400) {
    userId = createRes.body?.id || createRes.body?.user?.id;
  } else {
    // Nếu user đã tồn tại (HTTP 422), lấy user id hiện có và cập nhật lại password
    const listRes = await supabaseRequest(
      `${baseUrl}/auth/v1/admin/users?per_page=1000`,
      'GET',
      null,
      authHeader
    );
    const users = listRes.body?.users || (Array.isArray(listRes.body) ? listRes.body : []);
    const matched = users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (matched) {
      userId = matched.id;
      // Cập nhật lại mật khẩu và metadata
      await supabaseRequest(
        `${baseUrl}/auth/v1/admin/users/${userId}`,
        'PUT',
        {
          password,
          user_metadata: { ma_nv: cleanMaNV, password_changed: false },
        },
        authHeader
      );
    } else {
      const errMsg = typeof createRes.body === 'object' ? (createRes.body.message || createRes.body.error || JSON.stringify(createRes.body)) : String(createRes.body);
      throw new Error(`Tạo tài khoản thất bại: ${errMsg}`);
    }
  }

  // 2. Upsert employee và cập nhật user_id
  await supabaseRequest(
    `${baseUrl}/rest/v1/employees?on_conflict=ma_nv`,
    'POST',
    {
      ma_nv: cleanMaNV,
      ho_ten: hoTen,
      bo_phan: boPhan,
      khoi,
      co_so: coSo,
      user_id: userId,
    },
    {
      ...authHeader,
      'Prefer': 'resolution=merge-duplicates,return=representation',
    }
  );

  return { ok: true, maNV: cleanMaNV, userId, password };
}

async function createAccountsBatch({ supabaseUrl, serviceRoleKey, employees }) {
  if (!employees || !employees.length) return { ok: true, successCount: 0, failCount: 0 };
  let successCount = 0;
  let failCount = 0;
  const errors = [];

  for (const emp of employees) {
    try {
      await createAccountForEmployee({ supabaseUrl, serviceRoleKey, employee: emp });
      successCount++;
    } catch (err) {
      failCount++;
      errors.push(`${emp.ma_nv || emp.maNV}: ${err.message}`);
    }
  }
  return { ok: true, successCount, failCount, errors };
}

async function resetPassword({ supabaseUrl, serviceRoleKey, userId, maNV, newPassword }) {
  const baseUrl = supabaseUrl.replace(/\/$/, '');
  const authHeader = {
    'apikey': serviceRoleKey,
    'Authorization': `Bearer ${serviceRoleKey}`,
    'Content-Type': 'application/json',
  };

  const cleanMaNV = String(maNV || '').trim();
  const password = newPassword || getDefaultPassword(cleanMaNV);

  let targetUserId = userId;
  if (!targetUserId && cleanMaNV) {
    const email = `${cleanMaNV.toLowerCase()}@hehehr.internal`;
    const listRes = await supabaseRequest(
      `${baseUrl}/auth/v1/admin/users?per_page=1000`,
      'GET',
      null,
      authHeader
    );
    const users = listRes.body?.users || (Array.isArray(listRes.body) ? listRes.body : []);
    const matched = users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (matched) targetUserId = matched.id;
  }

  if (!targetUserId) {
    throw new Error('Không tìm thấy tài khoản người dùng trên Supabase Auth để đặt lại mật khẩu.');
  }

  const res = await supabaseRequest(
    `${baseUrl}/auth/v1/admin/users/${targetUserId}`,
    'PUT',
    {
      password,
      user_metadata: { ma_nv: cleanMaNV, password_changed: false },
    },
    authHeader
  );

  if (res.status >= 400) {
    const errMsg = typeof res.body === 'object' ? (res.body.message || res.body.error || JSON.stringify(res.body)) : String(res.body);
    throw new Error(`Đặt lại mật khẩu thất bại: ${errMsg}`);
  }

  return { ok: true, newPassword: password };
}

async function resetPasswordsBatch({ supabaseUrl, serviceRoleKey, accounts }) {
  if (!accounts || !accounts.length) return { ok: true, count: 0 };
  let count = 0;
  for (const acc of accounts) {
    try {
      await resetPassword({
        supabaseUrl,
        serviceRoleKey,
        userId: acc.user_id,
        maNV: acc.ma_nv,
      });
      count++;
    } catch (e) {
      console.warn(`Lỗi reset password cho ${acc.ma_nv}:`, e.message);
    }
  }
  return { ok: true, count };
}

async function toggleBanAccount({ supabaseUrl, serviceRoleKey, userId, ban }) {
  const baseUrl = supabaseUrl.replace(/\/$/, '');
  const authHeader = {
    'apikey': serviceRoleKey,
    'Authorization': `Bearer ${serviceRoleKey}`,
    'Content-Type': 'application/json',
  };

  if (!userId) throw new Error('Thiếu User ID của tài khoản.');

  const res = await supabaseRequest(
    `${baseUrl}/auth/v1/admin/users/${userId}`,
    'PUT',
    {
      ban_duration: ban ? '876000h' : 'none',
    },
    authHeader
  );

  if (res.status >= 400) {
    const errMsg = typeof res.body === 'object' ? (res.body.message || res.body.error || JSON.stringify(res.body)) : String(res.body);
    throw new Error(`Khóa / mở khóa tài khoản thất bại: ${errMsg}`);
  }

  return { ok: true, is_banned: ban };
}

async function deleteAccount({ supabaseUrl, serviceRoleKey, maNV, userId, deleteEmployeeRecord = false }) {
  const baseUrl = supabaseUrl.replace(/\/$/, '');
  const authHeader = {
    'apikey': serviceRoleKey,
    'Authorization': `Bearer ${serviceRoleKey}`,
    'Content-Type': 'application/json',
  };

  const cleanMaNV = String(maNV || '').trim();

  // 1. Xóa Auth user nếu có
  if (userId) {
    try {
      await supabaseRequest(
        `${baseUrl}/auth/v1/admin/users/${userId}`,
        'DELETE',
        null,
        authHeader
      );
    } catch (e) {
      console.warn('Lỗi khi xóa Auth user:', e.message);
    }
  }

  // 2. Xóa hoặc cập nhật bảng employees
  if (cleanMaNV) {
    if (deleteEmployeeRecord) {
      await supabaseRequest(
        `${baseUrl}/rest/v1/employees?ma_nv=eq.${encodeURIComponent(cleanMaNV)}`,
        'DELETE',
        null,
        authHeader
      );
    } else {
      await supabaseRequest(
        `${baseUrl}/rest/v1/employees?ma_nv=eq.${encodeURIComponent(cleanMaNV)}`,
        'PATCH',
        { user_id: null },
        { ...authHeader, 'Prefer': 'return=minimal' }
      );
    }
  }

  return { ok: true };
}

async function deleteAccountsBatch({ supabaseUrl, serviceRoleKey, items, deleteEmployeeRecord = false }) {
  if (!items || !items.length) return { ok: true, count: 0 };
  let count = 0;
  for (const item of items) {
    try {
      await deleteAccount({
        supabaseUrl,
        serviceRoleKey,
        maNV: item.ma_nv,
        userId: item.user_id,
        deleteEmployeeRecord,
      });
      count++;
    } catch (e) {
      console.warn(`Lỗi khi xóa tài khoản ${item.ma_nv}:`, e.message);
    }
  }
  return { ok: true, count };
}

async function upsertEmployee({ supabaseUrl, serviceRoleKey, employee, createAuthAccount = true, customPassword = '' }) {
  const baseUrl = supabaseUrl.replace(/\/$/, '');
  const authHeader = {
    'apikey': serviceRoleKey,
    'Authorization': `Bearer ${serviceRoleKey}`,
    'Content-Type': 'application/json',
  };

  const cleanMaNV = String(employee.ma_nv || '').trim();
  if (!cleanMaNV) throw new Error('Mã nhân viên không được để trống.');

  const hoTen = String(employee.ho_ten || cleanMaNV).trim();
  const boPhan = String(employee.bo_phan || '').trim();
  const khoi = String(employee.khoi || '').trim();
  const coSo = String(employee.co_so || '').trim();

  // 1. Upsert vào bảng employees
  const empRes = await supabaseRequest(
    `${baseUrl}/rest/v1/employees?on_conflict=ma_nv`,
    'POST',
    {
      ma_nv: cleanMaNV,
      ho_ten: hoTen,
      bo_phan: boPhan,
      khoi,
      co_so: coSo,
    },
    {
      ...authHeader,
      'Prefer': 'resolution=merge-duplicates,return=representation',
    }
  );

  if (empRes.status >= 400) {
    const errMsg = typeof empRes.body === 'object' ? (empRes.body.message || empRes.body.error || JSON.stringify(empRes.body)) : String(empRes.body);
    throw new Error(`Lưu thông tin nhân viên thất bại: ${errMsg}`);
  }

  let userId = empRes.body?.[0]?.user_id || null;

  // 2. Nếu người dùng chọn cấp tài khoản và chưa có userId
  if (createAuthAccount && !userId) {
    const accResult = await createAccountForEmployee({
      supabaseUrl,
      serviceRoleKey,
      employee: { ma_nv: cleanMaNV, ho_ten: hoTen, bo_phan: boPhan, khoi, co_so: coSo },
      customPassword,
    });
    userId = accResult.userId;
  }

  return { ok: true, ma_nv: cleanMaNV, user_id: userId };
}

module.exports = {
  uploadToPortal,
  slugThangNam,
  fetchPayslips,
  revokePayslips,
  restorePayslips,
  deletePayslips,
  createSignedUrl,
  getDefaultPassword,
  fetchAccounts,
  createAccountForEmployee,
  createAccountsBatch,
  resetPassword,
  resetPasswordsBatch,
  toggleBanAccount,
  deleteAccount,
  deleteAccountsBatch,
  upsertEmployee,
};
