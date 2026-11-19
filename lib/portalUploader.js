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

  // 4. Upload PDF lên Storage (x-upsert: true cho phép ghi đè file cũ nếu cập nhật lại phiếu)
  if (!pdfBuffer || !pdfBuffer.length) {
    throw new Error('Dữ liệu file PDF trống.');
  }

  const safeMaNV = encodeURIComponent(cleanMaNV);
  const safeSlug = encodeURIComponent(slug);
  const pdfPath = `${baseUrl}/storage/v1/object/payslips/${safeMaNV}/${safeSlug}.pdf`;
  const storageUploadHeaders = {
    ...authHeader,
    'Content-Type': 'application/pdf',
    'Content-Length': pdfBuffer.length,
    'x-upsert': 'true',
  };

  let uploadRes = await supabaseRequest(
    pdfPath,
    'PUT',
    pdfBuffer,
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
      pdfBuffer,
      storageUploadHeaders,
    );
  }

  if (uploadRes.status >= 400) {
    const errMsg = typeof uploadRes.body === 'object' ? (uploadRes.body.message || uploadRes.body.error || JSON.stringify(uploadRes.body)) : String(uploadRes.body);
    throw new Error(`Upload PDF lên Storage thất bại (${uploadRes.status}): ${errMsg}`);
  }

  const storagePath = `${cleanMaNV}/${slug}.pdf`;

  // 5. Upsert vào bảng payslips (on_conflict=ma_nv,thang_nam cho phép ghi đè/cập nhật phiếu lương tháng đó)
  let payslipBody = {
    ma_nv: cleanMaNV,
    thang_nam: thangNam,
    ten_cong_ty: tenCongTy,
    pdf_path: storagePath,
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

  // Nếu database Supabase chưa có cột status hoặc revoked_at (chưa chạy migration SQL), tự động retry bỏ 2 cột này
  if (payslipRes.status >= 400 && (JSON.stringify(payslipRes.body || '').includes('status') || JSON.stringify(payslipRes.body || '').includes('revoked_at'))) {
    delete payslipBody.status;
    delete payslipBody.revoked_at;
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

module.exports = {
  uploadToPortal,
  slugThangNam,
  fetchPayslips,
  revokePayslips,
  restorePayslips,
  deletePayslips,
  createSignedUrl,
};
