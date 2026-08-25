/**
 * HTTP 面：把提醒快照与自定义音频暴露给浏览器。
 *
 * - `GET /plugins/dsh-inform/api/state?since=<cursor>` — 增量状态快照（`no-store`）；
 * - `GET /plugins/dsh-inform/api/sound` — 自定义音频代理；
 *   都挂在 `/plugins/<id>/` 命名空间下：加固部署的鉴权栏只放行已知前缀，
 *   `/plugins/*` 是模块加载器证实可达的通道；exact 注册优先于一切前缀路由。
 *
 * webServer 是可选服务：headless 组合里注入保持挂起，不产生任何副作用。
 * 路由经 `ctx.effect` 登记在惰性子上下文上——webServer 消失或插件卸载都会摘除。
 */
import { createReadStream, promises as fsp } from 'node:fs';
import { homedir } from 'node:os';
import nodePath from 'node:path';
export const STATE_PATH = '/plugins/dsh-inform/api/state';
/** 自定义提醒音频代理端点：浏览器无法直接读盘，由宿主按当前设置代读。 */
export const SOUND_PATH = '/plugins/dsh-inform/api/sound';
/** 音频上传端点：设置页「选择本地文件」的字节落点。 */
export const SOUND_UPLOAD_PATH = '/plugins/dsh-inform/api/sound/upload';
const SOUND_MIME = {
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.oga': 'audio/ogg',
    '.m4a': 'audio/mp4',
    '.flac': 'audio/flac',
    '.aac': 'audio/aac',
    '.webm': 'audio/webm',
};
const MAX_SOUND_BYTES = 30 * 1024 * 1024;
function sendJson(res, status, body) {
    if (res.headersSent) {
        res.destroy();
        return;
    }
    const payload = JSON.stringify(body);
    res.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
    });
    res.end(payload);
}
export function handleStateRequest(tracker, req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
        sendJson(res, 405, { error: 'method not allowed' });
        return;
    }
    let since = 0;
    try {
        const url = new URL(req.url ?? '/', 'http://dsh-inform.local');
        const raw = url.searchParams.get('since');
        if (raw !== null) {
            since = Number(raw);
            if (!Number.isFinite(since) || since < 0 || !Number.isInteger(since)) {
                sendJson(res, 400, { error: 'since must be a non-negative integer' });
                return;
            }
        }
    }
    catch {
        sendJson(res, 400, { error: 'malformed request url' });
        return;
    }
    try {
        sendJson(res, 200, tracker.snapshot(since));
    }
    catch (error) {
        sendJson(res, 500, { error: `snapshot failed: ${String(error)}` });
    }
}
/** `soundPath` 的保留哨兵值：使用设置页上传的音频文件。 */
export const STORED_SENTINEL = '@stored';
/** 插件在 DSH home 下的数据目录（存上传的音频）。 */
export function soundStoreDir(home) {
    return nodePath.join(home, 'dsh-inform');
}
async function resolveSoundFile(getSound, getHome) {
    const config = getSound();
    const raw = config.path.trim();
    if (!config.enabled || raw === '')
        return null;
    if (raw === STORED_SENTINEL) {
        // 上传槽：找 dsh-inform/sound.<ext>（最新一次上传，单槽覆盖）。
        try {
            const entries = await fsp.readdir(soundStoreDir(getHome()));
            const hit = entries.find((name) => /^sound\.[a-z0-9]+$/i.test(name));
            if (!hit)
                return null;
            return nodePath.join(soundStoreDir(getHome()), hit);
        }
        catch {
            return null;
        }
    }
    if (/^https?:\/\//i.test(raw))
        return raw;
    if (raw.startsWith('~/'))
        return pathJoin(homedir(), raw.slice(2));
    return raw;
}
/** 音频代理：按当前设置把本地音频文件（或重定向 http(s) URL）喂给 <audio>。
 *  只在 soundEnabled 且配置了来源时服务；扩展名白名单 + 大小上限，防误当任意文件网关。 */
export async function handleSoundRequest(getSound, req, res, getHome) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
        sendJson(res, 405, { error: 'method not allowed' });
        return;
    }
    let resolved = await resolveSoundFile(getSound, getHome ?? (() => homedir()));
    if (resolved === null) {
        sendJson(res, 404, { error: 'sound not configured' });
        return;
    }
    // http(s) 来源直接 302 交给浏览器加载（媒体元素无 CORS 限制）。
    if (/^https?:\/\//i.test(resolved)) {
        res.writeHead(302, { location: resolved, 'cache-control': 'no-store' });
        res.end();
        return;
    }
    try {
        const stat = await fsp.stat(resolved);
        if (!stat.isFile()) {
            sendJson(res, 404, { error: 'sound is not a regular file' });
            return;
        }
        if (stat.size > MAX_SOUND_BYTES) {
            sendJson(res, 413, { error: 'sound file exceeds 30MB limit' });
            return;
        }
        const mime = SOUND_MIME[nodePath.extname(resolved).toLowerCase()];
        if (mime === undefined) {
            sendJson(res, 415, { error: `unsupported audio extension: ${nodePath.extname(resolved) || '(none)'}` });
            return;
        }
        res.writeHead(200, {
            'content-type': mime,
            'content-length': stat.size,
            'cache-control': 'no-store',
            'accept-ranges': 'none',
        });
        if (req.method === 'HEAD') {
            res.end();
            return;
        }
        const stream = createReadStream(resolved);
        stream.on('error', () => { res.destroy(); });
        res.on('close', () => { stream.destroy(); });
        stream.pipe(res);
    }
    catch {
        sendJson(res, 404, { error: 'sound file not found' });
    }
}
const UPLOAD_EXT_WHITELIST = new Set(['mp3', 'wav', 'ogg', 'oga', 'm4a', 'flac', 'aac', 'webm']);
/** 音频上传：设置页「选择本地文件」后，前端读字节 POST 到这里，
 *  宿主存进 <DSH_HOME>/dsh-inform/sound.<ext>（单槽覆盖），随后 soundPath 置 '@stored'。 */
export async function handleSoundUpload(req, res, getHome) {
    if (req.method !== 'POST') {
        sendJson(res, 405, { error: 'method not allowed; use POST' });
        return;
    }
    const url = new URL(req.url ?? '/', 'http://dsh-inform.local');
    const ext = (url.searchParams.get('ext') ?? '').toLowerCase().replace(/^\./, '');
    if (!UPLOAD_EXT_WHITELIST.has(ext)) {
        sendJson(res, 415, { error: `unsupported audio extension: ${ext || '(none)'}` });
        return;
    }
    const chunks = [];
    let total = 0;
    let aborted = false;
    req.on('data', (chunk) => {
        total += chunk.length;
        if (total > MAX_SOUND_BYTES) {
            aborted = true;
            sendJson(res, 413, { error: 'upload exceeds 30MB limit' });
            req.destroy();
            return;
        }
        chunks.push(chunk);
    });
    req.on('error', () => { aborted = true; });
    req.on('end', async () => {
        if (aborted)
            return;
        try {
            const dir = soundStoreDir(getHome());
            await fsp.mkdir(dir, { recursive: true });
            // 清掉旧扩展名的槽文件，保持"只有一份"。
            for (const name of await fsp.readdir(dir).catch(() => [])) {
                if (/^sound\.[a-z0-9]+$/i.test(name))
                    await fsp.rm(nodePath.join(dir, name), { force: true });
            }
            const target = nodePath.join(dir, `sound.${ext}`);
            await fsp.writeFile(target, Buffer.concat(chunks));
            sendJson(res, 200, { ok: true, size: total, ext });
        }
        catch (error) {
            sendJson(res, 500, { error: `store failed: ${String(error)}` });
        }
    });
}
function pathJoin(base, rest) {
    // node:path/win32 与 posix 在绝对盘符上的差异不影响本用例；统一走平台 join。
    return nodePath.isAbsolute(rest) ? rest : nodePath.join(base, rest);
}
/** 把 HTTP 面挂到可选的 webServer 上；没有 webServer 的组合里保持等待。 */
export function attachWebServer(ctx, tracker, options) {
    ctx.inject(['webServer'], (scoped) => {
        scoped.effect(() => scoped.webServer.register({
            kind: 'exact',
            path: STATE_PATH,
            handler: (req, res) => handleStateRequest(tracker, req, res),
        }), 'dsh-inform: state route');
        if (options?.getSound) {
            const getSound = options.getSound;
            const getHome = options.getHome ?? (() => homedir());
            scoped.effect(() => scoped.webServer.register({
                kind: 'exact',
                path: SOUND_PATH,
                handler: (req, res) => { void handleSoundRequest(getSound, req, res, getHome); },
            }), 'dsh-inform: sound route');
            scoped.effect(() => scoped.webServer.register({
                kind: 'exact',
                path: SOUND_UPLOAD_PATH,
                handler: (req, res) => { void handleSoundUpload(req, res, getHome); },
            }), 'dsh-inform: sound upload route');
        }
    });
}
