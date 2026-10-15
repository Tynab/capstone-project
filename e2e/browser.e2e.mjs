// Test end-to-end qua TRÌNH DUYỆT THẬT.
//
// Chạy: npm run test:browser   (trong thư mục e2e, sau khi npm install)
//
// Dựng mongod thật -> backend -> frontend dev server -> Chrome thật do puppeteer
// điều khiển, rồi thao tác UI như người dùng. Không gọi API trực tiếp.
//
// Vì sao cần file này: test tầng API có thể xanh hết trong khi app vẫn trắng màn
// hình, do lệch hợp đồng giữa backend và frontend. Đã từng xảy ra thật — xem
// ghi chú ở bước "F5 sau khi thêm".

import puppeteer from 'puppeteer-core'
import { startStack, findChrome, makeRecorder } from './lib/stack.mjs'

const API_PORT = Number(process.env.E2E_API_PORT || 8124)
const WEB_PORT = Number(process.env.E2E_WEB_PORT || 3000)
const WEB = `http://localhost:${WEB_PORT}`

const { record, finish } = makeRecorder()

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let stack, browser, page
let consoleErrors = []
let exitCode = 1

try {
    const chrome = findChrome()
    if (!chrome) {
        console.log('Không tìm thấy Chrome/Edge. Đặt biến môi trường CHROME_PATH trỏ tới trình duyệt.')
        process.exit(1)
    }
    console.log('Chrome:', chrome)
    console.log('Dựng mongod + backend + frontend dev server...')
    stack = await startStack({ apiPort: API_PORT, webPort: WEB_PORT, withFrontend: true })
    console.log('Sẵn sàng.\n')

    browser = await puppeteer.launch({
        executablePath: chrome,
        headless: 'new',
        args: ['--no-sandbox', '--disable-dev-shm-usage'],
    })
    page = await browser.newPage()
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()) })
    page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message))
    // Ghi lại URL của mọi response lỗi — chỉ biết "có 403" mà không biết request nào
    // thì không sửa được.
    page.on('response', (res) => {
        if (res.status() >= 400) consoleErrors.push(`HTTP ${res.status()} ${res.request().method()} ${res.url()}`)
    })

    const text = () => page.evaluate(() => document.body.innerText)
    // So khớp KHÔNG phân biệt hoa/thường: CSS `capitalize` trên .task-title làm
    // innerText trả về "Task Tu Trinh Duyet" chứ không phải chuỗi gõ vào.
    const waitText = (needle, timeout = 15000) =>
        page.waitForFunction(
            (n) => document.body.innerText.toLowerCase().includes(n.toLowerCase()),
            { timeout }, needle)
    const waitNoText = (needle, timeout = 15000) =>
        page.waitForFunction(
            (n) => !document.body.innerText.toLowerCase().includes(n.toLowerCase()),
            { timeout }, needle)
    const hasText = async (needle) => (await text()).toLowerCase().includes(needle.toLowerCase())

    // ------------------------------------------------------------- đăng ký
    await page.goto(WEB + '/register', { waitUntil: 'networkidle0' })
    await page.waitForSelector('#nameInput')
    await page.type('#nameInput', 'Nguyen Van Test')
    await page.type('#registerEmailInput', 'browser@example.com')
    await page.type('#registerPassInput', 'matkhau12345')
    await page.click('button[type="submit"]')
    await waitText('welcome')
    record('đăng ký qua UI -> vào được trang chính', true)

    // ------------------------------------------------------------- thêm task
    await page.waitForSelector('#title')
    await page.type('#title', 'Task tu trinh duyet')
    await page.type('#description', 'tao bang puppeteer')
    await page.click('button[type="submit"]')
    await waitText('Task tu trinh duyet')
    record('thêm task qua UI -> task hiện trong danh sách', true)

    // *** Khẳng định quan trọng nhất của file này ***
    // Từng có lỗi getTasks() trả nguyên res.data thay vì res.data.tasks, nên reducer
    // nhận một object và `tasks.map` ném "tasks is not iterable" — cả app trắng màn
    // hình sau đăng nhập, trong khi mọi test tầng API vẫn xanh.
    await page.reload({ waitUntil: 'networkidle0' })
    await waitText('Task tu trinh duyet')
    record('*** F5 sau khi thêm -> task VẪN CÒN (đã lưu xuống DB)', true)

    // ------------------------------------------------------------- tick hoàn thành
    await page.click('.checkbox')
    await page.waitForFunction(() => document.querySelector('.checkbox')?.checked === true, { timeout: 15000 })
    record('tick hoàn thành -> checkbox chuyển sang checked', true)

    await page.reload({ waitUntil: 'networkidle0' })
    await page.waitForSelector('.checkbox')
    const afterReload = await page.$eval('.checkbox', (el) => el.checked)
    record('*** F5 sau khi tick -> trạng thái hoàn thành VẪN GIỮ (lỗi gốc đã hết)',
        afterReload === true, `checked=${afterReload}`)

    await page.goto(WEB + '/completed', { waitUntil: 'networkidle0' })
    await waitText('Task tu trinh duyet')
    record('tab Completed hiển thị task đã hoàn thành', true)

    // ------------------------------------------------------------- xoá
    await page.goto(WEB + '/', { waitUntil: 'networkidle0' })
    await page.waitForSelector('[aria-label^="Delete task"]')
    await page.click('[aria-label^="Delete task"]')
    await waitNoText('Task tu trinh duyet')
    record('xoá task qua UI -> task biến khỏi danh sách', true)

    await page.reload({ waitUntil: 'networkidle0' })
    await page.waitForSelector('#title')
    record('*** F5 sau khi xoá -> task KHÔNG quay lại (đã xoá trong DB)',
        !(await hasText('Task tu trinh duyet')))

    // ------------------------------------------------------------- đăng xuất
    await page.click('button.logout')
    await page.waitForSelector('#emailInput', { timeout: 15000 })
    record('đăng xuất -> quay về trang đăng nhập', true)

    const tokenAfterLogout = await page.evaluate(() => localStorage.getItem('authToken'))
    record('đăng xuất -> token bị xoá khỏi localStorage', tokenAfterLogout === null, `authToken=${tokenAfterLogout}`)

    // ------------------------------------------------------------- đăng nhập lại
    await page.type('#emailInput', 'browser@example.com')
    await page.type('#passInput', 'matkhau12345')
    await page.waitForSelector('button[type="submit"]:not([disabled])')
    await page.click('button[type="submit"]')
    await waitText('welcome')
    record('đăng nhập lại bằng tài khoản vừa tạo -> vào được', true)

    record('danh sách task trống sau khi đăng nhập lại (đúng vì đã xoá)',
        !(await hasText('Task tu trinh duyet')))

    // ------------------------------------------------------------- lỗi console
    // Tách lỗi của ứng dụng khỏi lỗi tài nguyên bên thứ ba: ảnh trong trang đăng ký
    // nằm trên pngtree.com và trả 403 — hỏng mỹ quan, không phải lỗi app.
    const isExternal = (e) => /https?:\/\/(?!localhost|127\.0\.0\.1)/.test(e)
    const external = consoleErrors.filter(isExternal)
    const realErrors = consoleErrors.filter((e) =>
        !e.includes('favicon') &&
        !e.includes('Download the React DevTools') &&
        !e.includes('Failed to load resource') &&
        !isExternal(e))
    record('không có lỗi runtime của ứng dụng trong console trình duyệt',
        realErrors.length === 0, realErrors.slice(0, 3).join(' | '))
    if (external.length) {
        console.log(`GHI NHẬN (không tính fail): ${external.length} tài nguyên bên thứ ba lỗi, ví dụ: ${external[0].slice(0, 90)}`)
    }

    exitCode = finish()
} catch (err) {
    console.log('\nLỖI KHÔNG MONG ĐỢI:', err.message)
    // Khi một bước fail, cần biết trang đang hiển thị gì — nếu không chỉ biết
    // "timeout" mà không biết vì sao.
    if (page) {
        try {
            console.log('\n--- URL hiện tại:', page.url())
            console.log('--- Nội dung trang:\n' + (await page.evaluate(() => document.body.innerText)).slice(0, 1200))
        } catch { /* trang đã đóng */ }
    }
    if (consoleErrors.length) {
        console.log('\n--- Lỗi console trình duyệt:')
        for (const e of consoleErrors.slice(0, 10)) console.log('  ' + e)
    }
} finally {
    if (browser) { try { await browser.close() } catch { /* đã đóng */ } }
    if (stack) await stack.stop()
}
process.exit(exitCode)
