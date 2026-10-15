// Test end-to-end tầng API.
//
// Chạy: npm run test:api   (trong thư mục e2e, sau khi npm install)
//
// Mỗi khẳng định ở đây từng là một kết luận suy ra từ việc ĐỌC code. Mục đích của
// file này là chuyển chúng thành thứ chạy được: nếu ai sửa hỏng một guard bảo mật,
// test đỏ ngay thay vì phải đọc lại và tự suy luận.

import path from 'node:path'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
import { BACKEND_DIR, startStack, makeRecorder } from './lib/stack.mjs'

// Dùng đúng bản mongoose mà backend dùng, để test không lệch hành vi với app.
const requireBackend = createRequire(path.join(BACKEND_DIR, 'package.json'))
const mongoose = requireBackend('mongoose')

const API_PORT = Number(process.env.E2E_API_PORT || 8123)
const WEB_PORT = Number(process.env.E2E_WEB_PORT || 3000)
const BASE = `http://127.0.0.1:${API_PORT}/api`

const { record, finish } = makeRecorder()

const req = async (method, path_, { body, token, origin } = {}) => {
    const headers = {}
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    if (token) headers['Authorization'] = `Bearer ${token}`
    if (origin) headers['Origin'] = origin
    const res = await fetch(`${BASE}${path_}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
    })
    let data = null
    try { data = await res.json() } catch { /* body rỗng hoặc không phải JSON */ }
    return { status: res.status, data, headers: res.headers }
}

const sha256 = (t) => crypto.createHash('sha256').update(t).digest('hex')

let stack
let exitCode = 1
try {
    console.log('Dựng mongod + backend...')
    stack = await startStack({ apiPort: API_PORT, webPort: WEB_PORT })
    console.log('Sẵn sàng.\n')

    // ------------------------------------------------------------- đăng ký
    let r = await req('POST', '/user/register', {
        body: { name: 'Alice', email: 'alice@example.com', password: 'matkhau123' },
    })
    record('register: tạo tài khoản hợp lệ -> 200', r.status === 200, `status=${r.status}`)
    const aliceToken = r.data?.token
    record('register: trả về token', typeof aliceToken === 'string' && aliceToken.length > 20)
    record('register: response KHÔNG lộ password/resetToken/tokenVersion',
        r.data?.user && !('password' in r.data.user) &&
        !('resetToken' in r.data.user) && !('tokenVersion' in r.data.user),
        JSON.stringify(Object.keys(r.data?.user || {})))

    r = await req('POST', '/user/register', {
        body: { name: 'Alice2', email: 'alice@example.com', password: 'matkhau123' },
    })
    record('register: email trùng -> 400', r.status === 400, `status=${r.status}`)

    r = await req('POST', '/user/register', {
        body: { name: 'Bob', email: { $ne: null }, password: 'matkhau123' },
    })
    record('register: operator injection email={$ne:null} -> 400', r.status === 400, `status=${r.status}`)

    r = await req('POST', '/user/register', {
        body: { name: 'Shorty', email: 'shorty@example.com', password: 'a' },
    })
    record('register: mật khẩu quá ngắn -> 400', r.status === 400, `status=${r.status}`)

    // ------------------------------------------------------------- đăng nhập
    r = await req('POST', '/user/login', { body: { email: 'alice@example.com', password: 'matkhau123' } })
    record('login: đúng mật khẩu -> 200', r.status === 200, `status=${r.status}`)
    const aliceToken2 = r.data?.token

    r = await req('POST', '/user/login', { body: { email: 'alice@example.com', password: 'saibet' } })
    const wrongPwMsg = r.data?.message

    r = await req('POST', '/user/login', { body: { email: 'khongton@example.com', password: 'saibet' } })
    record('login: email không tồn tại trả CÙNG thông báo với sai mật khẩu (chống dò email)',
        r.data?.message === wrongPwMsg, `"${r.data?.message}" vs "${wrongPwMsg}"`)

    r = await req('POST', '/user/login', { body: { email: { $ne: null }, password: 'x' } })
    record('login: operator injection email={$ne:null} -> 400', r.status === 400, `status=${r.status}`)

    // ------------------------------------------------------------- guard JWT
    r = await req('GET', '/user/getuser')
    record('getuser: không token -> 401', r.status === 401, `status=${r.status}`)

    r = await req('GET', '/user/getuser', { token: 'token.rac.khong.hop.le' })
    record('getuser: token rác -> 401 (không phải 500)', r.status === 401, `status=${r.status}`)

    r = await req('GET', '/user/getuser', { token: aliceToken2 })
    record('getuser: token hợp lệ -> 200, không lộ password',
        r.status === 200 && r.data?.user && !('password' in r.data.user), `status=${r.status}`)

    // Frontend gọi /user/getUser (chữ U hoa) còn route đăng ký /getuser (chữ thường).
    // Cặp này chỉ khớp nhờ Express mặc định không phân biệt hoa/thường.
    r = await req('GET', '/user/getUser', { token: aliceToken2 })
    record('Express khớp route không phân biệt hoa/thường (/user/getUser)',
        r.status === 200, `status=${r.status}`)

    // ------------------------------------------------------------- healthcheck
    // Endpoint này dùng cho HEALTHCHECK của image, healthcheck của swarm và
    // blackbox-exporter. Công khai, không được lộ thông tin nội bộ.
    r = await req('GET', '/health')
    record('health: trả 200 {status:ok} không cần token',
        r.status === 200 && r.data?.status === 'ok',
        `status=${r.status} body=${JSON.stringify(r.data)}`)

    // ------------------------------------------------------------- task + phân quyền
    r = await req('POST', '/user/register', {
        body: { name: 'Bob', email: 'bob@example.com', password: 'matkhau456' },
    })
    const bobToken = r.data?.token

    r = await req('POST', '/task/addTask', {
        token: aliceToken2, body: { title: 'Task của Alice', description: 'nội dung' },
    })
    record('addTask: tạo task -> 201 kèm _id', r.status === 201 && typeof r.data?.task?._id === 'string',
        `status=${r.status}`)
    const taskId = r.data?.task?._id

    r = await req('POST', '/task/addTask', { token: aliceToken2, body: {} })
    record('addTask: body rỗng -> 400 (không lộ ValidationError)',
        r.status === 400, `status=${r.status} body=${JSON.stringify(r.data)}`)

    r = await req('GET', '/task/getTask', { token: aliceToken2 })
    record('getTask: trả { tasks: [...] } của chính mình',
        r.status === 200 && Array.isArray(r.data?.tasks) && r.data.tasks.length === 1,
        `status=${r.status}`)

    r = await req('DELETE', `/task/removeTask/${taskId}`, { token: bobToken })
    record('PHÂN QUYỀN: Bob không xoá được task của Alice -> 404', r.status === 404, `status=${r.status}`)

    r = await req('GET', '/task/getTask', { token: aliceToken2 })
    record('PHÂN QUYỀN: task của Alice vẫn còn', r.data?.tasks?.length === 1, `còn ${r.data?.tasks?.length}`)

    r = await req('DELETE', '/task/removeTask/khong-phai-objectid', { token: aliceToken2 })
    record('removeTask: id sai định dạng -> 404 (không lộ CastError)', r.status === 404, `status=${r.status}`)

    r = await req('PATCH', `/task/updateTask/${taskId}`, { token: aliceToken2, body: { completed: true } })
    record('updateTask: đánh dấu hoàn thành -> 200', r.status === 200, `status=${r.status}`)

    r = await req('GET', '/task/getTask', { token: aliceToken2 })
    record('updateTask: trạng thái ĐÃ lưu xuống DB', r.data?.tasks?.[0]?.completed === true,
        `completed=${r.data?.tasks?.[0]?.completed}`)

    r = await req('PATCH', `/task/updateTask/${taskId}`, { token: bobToken, body: { completed: false } })
    record('PHÂN QUYỀN: Bob không sửa được task của Alice -> 404', r.status === 404, `status=${r.status}`)

    // ------------------------------------------------------------- quên mật khẩu
    r = await req('POST', '/forgotPassword/forgotPassword', { body: { email: { $ne: null } } })
    record('forgotPassword: operator injection email={$ne:null} -> 400', r.status === 400, `status=${r.status}`)

    r = await req('POST', '/forgotPassword/forgotPassword', { body: { email: 'khongton@example.com' } })
    const unknownForgotMsg = r.data?.message

    r = await req('POST', '/forgotPassword/forgotPassword', { body: { email: 'alice@example.com' } })
    record('forgotPassword: email không tồn tại trả CÙNG thông báo với email tồn tại',
        r.status === 200 && r.data?.message === unknownForgotMsg, `"${r.data?.message}"`)

    // ------------------------------------------------------------- reset token
    // Lỗ hổng nghiêm trọng nhất từng có: token=null khớp mọi user chưa có resetToken,
    // nghĩa là chiếm tài khoản không cần xác thực.
    r = await req('POST', '/forgotPassword/resetPassword', { body: { token: null, password: 'hacked12345' } })
    record('*** resetPassword: token=null -> 400 (lỗ hổng chiếm tài khoản)', r.status === 400, `status=${r.status}`)

    r = await req('POST', '/forgotPassword/resetPassword', { body: { token: { $ne: null }, password: 'hacked12345' } })
    record('*** resetPassword: token={$ne:null} -> 400', r.status === 400, `status=${r.status}`)

    r = await req('POST', '/forgotPassword/resetPassword', { body: { token: 'khongtontai', password: 'hacked12345' } })
    record('resetPassword: token rác -> 400', r.status === 400, `status=${r.status}`)

    r = await req('POST', '/user/login', { body: { email: 'alice@example.com', password: 'matkhau123' } })
    record('*** Sau loạt tấn công, mật khẩu Alice KHÔNG đổi', r.status === 200, `status=${r.status}`)

    // Gmail credentials trống nên mail không gửi được; gieo thẳng hash token vào DB
    // để kiểm chứng vế còn lại: token đúng, dùng một lần, hết hạn.
    await mongoose.connect(stack.mongoUri)
    const users = mongoose.connection.collection('users')

    const rawToken = crypto.randomBytes(20).toString('hex')
    await users.updateOne({ email: 'alice@example.com' },
        { $set: { resetToken: sha256(rawToken), resetTokenExpiry: new Date(Date.now() + 15 * 60 * 1000) } })

    r = await req('POST', '/forgotPassword/resetPassword', { body: { token: rawToken, password: 'matkhaumoi999' } })
    record('resetPassword: token hợp lệ -> 200', r.status === 200, `status=${r.status}`)

    r = await req('POST', '/forgotPassword/resetPassword', { body: { token: rawToken, password: 'matkhaucuatoi' } })
    record('resetPassword: DÙNG LẠI cùng token -> 400 (dùng một lần)', r.status === 400, `status=${r.status}`)

    const expiredToken = crypto.randomBytes(20).toString('hex')
    await users.updateOne({ email: 'bob@example.com' },
        { $set: { resetToken: sha256(expiredToken), resetTokenExpiry: new Date(Date.now() - 60 * 1000) } })

    r = await req('POST', '/forgotPassword/resetPassword', { body: { token: expiredToken, password: 'matkhaumoi999' } })
    record('resetPassword: token HẾT HẠN -> 400', r.status === 400, `status=${r.status}`)

    // ------------------------------------------------------------- tokenVersion
    r = await req('GET', '/user/getuser', { token: aliceToken2 })
    record('*** JWT cũ bị vô hiệu hoá sau khi đổi mật khẩu -> 401', r.status === 401, `status=${r.status}`)

    r = await req('POST', '/user/login', { body: { email: 'alice@example.com', password: 'matkhaumoi999' } })
    record('login: mật khẩu MỚI -> 200', r.status === 200, `status=${r.status}`)
    const aliceNewToken = r.data?.token

    r = await req('POST', '/user/login', { body: { email: 'alice@example.com', password: 'matkhau123' } })
    record('login: mật khẩu CŨ -> 400', r.status === 400, `status=${r.status}`)

    r = await req('GET', '/user/getuser', { token: aliceNewToken })
    record('getuser: token mới sau reset -> 200', r.status === 200, `status=${r.status}`)

    // ------------------------------------------------------------- CORS
    r = await req('POST', '/user/login', {
        body: { email: 'a@b.c', password: 'x' }, origin: 'https://ke-tan-cong.example',
    })
    record('CORS: origin lạ KHÔNG được cấp Access-Control-Allow-Origin',
        !r.headers.get('access-control-allow-origin'), `ACAO=${r.headers.get('access-control-allow-origin')}`)

    r = await req('POST', '/user/login', {
        body: { email: 'a@b.c', password: 'x' }, origin: `http://localhost:${WEB_PORT}`,
    })
    record('CORS: origin hợp lệ ĐƯỢC cấp Access-Control-Allow-Origin',
        r.headers.get('access-control-allow-origin') === `http://localhost:${WEB_PORT}`,
        `ACAO=${r.headers.get('access-control-allow-origin')}`)

    // ------------------------------------------------------------- rate limit (cuối cùng,
    // vì các lần login phía trên đã tiêu một phần ngân sách của cùng một bucket)
    let got429 = false
    let attempts = 0
    for (let i = 0; i < 12 && !got429; i++) {
        attempts++
        const res = await req('POST', '/user/login', { body: { email: 'alice@example.com', password: 'sai' } })
        if (res.status === 429) got429 = true
    }
    record('rate limit: /login trả 429 sau khi vượt ngưỡng', got429,
        `429 sau ${attempts} lần thử (các lần login trước đó đã dùng chung bucket)`)

    r = await req('GET', '/task/getTask', { token: aliceNewToken })
    record('rate limit: không ảnh hưởng route khác (getTask vẫn 200)', r.status === 200, `status=${r.status}`)

    exitCode = finish()
} catch (err) {
    console.log('\nLỖI KHÔNG MONG ĐỢI:', err.message)
    if (stack?.logs?.backend) console.log('--- log backend:\n' + stack.logs.backend.slice(-2000))
} finally {
    if (stack) await stack.stop()
}
process.exit(exitCode)
