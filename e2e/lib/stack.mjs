// Dựng môi trường test THẬT cho dự án: một mongod thật + backend đã chạy,
// và tuỳ chọn thêm frontend dev server.
//
// Không mock gì cả — test phải chạy trên đúng thứ sẽ được deploy. Đây là lý do
// dùng mongodb-memory-server thay vì giả lập Mongoose: nó tải và chạy một binary
// mongod thật, nên hành vi Mongo (ví dụ `null` khớp cả field bị thiếu) là thật.

import { spawn, spawnSync } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { MongoMemoryServer } from 'mongodb-memory-server'

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const REPO_ROOT = path.resolve(HERE, '..', '..')
export const BACKEND_DIR = path.join(REPO_ROOT, 'backend')
export const FRONTEND_DIR = path.join(REPO_ROOT, 'frontend')

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const waitHttp = async (url, tries = 120) => {
    for (let i = 0; i < tries; i++) {
        try { await fetch(url); return true } catch { await sleep(500) }
    }
    return false
}

// Chrome/Edge có sẵn trên máy. Đặt CHROME_PATH để ghi đè.
export const findChrome = () => {
    const candidates = [
        process.env.CHROME_PATH,
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        '/usr/bin/google-chrome',
        '/usr/bin/chromium',
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ].filter(Boolean)
    return candidates.find((p) => fs.existsSync(p)) || null
}

export const startStack = async ({ apiPort, webPort, withFrontend = false }) => {
    const procs = []
    const logs = {}

    const spawnLogged = (name, cmd, args, opts) => {
        const p = spawn(cmd, args, { ...opts, stdio: ['ignore', 'pipe', 'pipe'] })
        logs[name] = ''
        p.stdout.on('data', (d) => { logs[name] += d })
        p.stderr.on('data', (d) => { logs[name] += d })
        procs.push(p)
        return p
    }

    const mongod = await MongoMemoryServer.create()

    spawnLogged('backend', process.execPath, ['server.js'], {
        cwd: BACKEND_DIR,
        env: {
            ...process.env,
            MONGO_URI: mongod.getUri(),
            PORT: String(apiPort),
            // Secret riêng cho test, KHÔNG dùng JWT_SECRET thật trong .env.
            JWT_SECRET: 'e2e-test-secret-'.padEnd(48, 'x'),
            GMAIL_USERNAME: '',
            GMAIL_PASSWORD: '',
            // Cho phép origin của frontend test, để không phụ thuộc cổng mặc định.
            CORS_ORIGIN: `http://localhost:${webPort}`,
        },
    })

    if (!(await waitHttp(`http://127.0.0.1:${apiPort}/api/user/login`))) {
        throw new Error('backend không khởi động được:\n' + logs.backend)
    }

    if (withFrontend) {
        spawnLogged('frontend', 'npm', ['start'], {
            cwd: FRONTEND_DIR,
            shell: true,
            env: {
                ...process.env,
                PORT: String(webPort),
                CI: 'false',
                // Ứng dụng luôn gọi đường dẫn tương đối /api; dev server Vite proxy
                // /api sang backend của bộ test. Đích proxy đọc trong Node nên không
                // dính chuyện Vite không đưa process.env.VITE_* vào import.meta.env
                // ở chế độ dev (từng làm e2e đỏ vì app gọi nhầm localhost:8000).
                VITE_PROXY_TARGET: `http://127.0.0.1:${apiPort}`,
            },
        })
        if (!(await waitHttp(`http://localhost:${webPort}/`, 240))) {
            throw new Error('frontend không khởi động được:\n' + logs.frontend)
        }
    }

    return {
        mongoUri: mongod.getUri(),
        logs,
        stop: async () => {
            for (const p of procs) {
                // Trên Windows, dev server frontend được spawn qua shell (`npm start`
                // -> cmd.exe -> node/vite). Giết shell KHÔNG giết tiến trình con, nên
                // cổng 3000 vẫn bị giữ lại sau khi test xong; lần chạy sau gặp
                // strictPort của Vite (không được nhảy cổng) và đỏ rất khó hiểu — đã
                // gặp thật. Phải `taskkill /T` giết CẢ CÂY, và phải làm TRƯỚC khi giết
                // shell: shell chết rồi thì không còn ai để truy ra các con của nó.
                if (process.platform === 'win32' && p.pid) {
                    try { spawnSync('taskkill', ['/PID', String(p.pid), '/T', '/F'], { stdio: 'ignore' }) }
                    catch { /* không giết được thì thôi, không che lỗi test */ }
                }
                try { p.kill('SIGKILL') } catch { /* tiến trình đã chết */ }
            }
            try { await mongod.stop() } catch { /* mongod đã dừng */ }
        },
    }
}

export const makeRecorder = () => {
    const results = []
    const record = (name, pass, detail = '') => {
        results.push({ name, pass, detail })
        console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`)
    }
    const finish = () => {
        const failed = results.filter((r) => !r.pass)
        console.log(`\n===== KẾT QUẢ: ${results.length - failed.length}/${results.length} PASS =====`)
        for (const f of failed) console.log(`  FAIL: ${f.name}  ${f.detail}`)
        return failed.length ? 1 : 0
    }
    return { record, finish, results }
}
