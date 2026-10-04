import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { installGym } from './gym.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8787);
const app = express();
app.use(express.json({ limit: '64kb' }));
app.use(express.static(path.join(ROOT, 'public'), { index: 'gym.html' }));

const DEFAULT_ROOT = path.join(ROOT, 'videos');
const SETTINGS_FILE = path.join(ROOT, 'settings.json');
fs.mkdirSync(DEFAULT_ROOT, { recursive: true });
let rootPath = DEFAULT_ROOT;
try { const saved = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')); if (typeof saved.rootPath === 'string' && path.isAbsolute(saved.rootPath)) rootPath = saved.rootPath; } catch {}
const paths = [null, null, null];
let active = false;
const manualPaths = [null, null, null];
const manualTitles = ['', '', ''];
let manualActive = false;
const localAddresses = new Set(['127.0.0.1', '::1']);
for (const entries of Object.values(os.networkInterfaces())) for (const entry of entries || []) {
  if (entry.family === 'IPv4') localAddresses.add(entry.address);
}
const isServer = req => localAddresses.has((req.ip || '').replace(/^::ffff:/, ''));
installGym(app, { root: ROOT, isServer });
function adminOnly(req, res) {
  if (!isServer(req)) { res.status(403).json({ error: 'این عملیات فقط روی کامپیوتر سرور مجاز است.' }); return false; }
  return true;
}
function cleanPath(value) {
  if (typeof value !== 'string') return null;
  const normalized = path.normalize(value.trim());
  return path.isAbsolute(normalized) && fs.existsSync(normalized) && fs.statSync(normalized).isFile() ? normalized : null;
}
function mime(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return ({ '.mp4': 'video/mp4', '.webm': 'video/webm', '.ogg': 'video/ogg', '.mov': 'video/quicktime', '.m4v': 'video/mp4' })[ext] || 'application/octet-stream';
}
function videoNames() {
  if (!fs.existsSync(rootPath) || !fs.statSync(rootPath).isDirectory()) return [];
  return fs.readdirSync(rootPath, { withFileTypes: true }).filter(entry => entry.isFile() && /\.(mp4|webm|ogg|mov|m4v)$/i.test(entry.name)).map(entry => entry.name).sort((a, b) => a.localeCompare(b));
}
function resolveVideo(name) {
  if (typeof name !== 'string' || path.basename(name) !== name) return null;
  const filePath = path.join(rootPath, name);
  return fs.existsSync(filePath) && fs.statSync(filePath).isFile() && /\.(mp4|webm|ogg|mov|m4v)$/i.test(name) ? filePath : null;
}

app.get('/api/status', (req, res) => res.json({ active, canManage: isServer(req), rootPath, files: videoNames(), videos: paths.map((filePath, slot) => filePath ? { slot, name: path.basename(filePath), url: `/video/${slot}` } : null) }));
app.get('/api/folders', (req, res) => {
  if (!adminOnly(req, res)) return;
  const requested = typeof req.query.path === 'string' ? path.resolve(req.query.path) : path.parse(ROOT).root;
  if (!path.isAbsolute(requested) || !fs.existsSync(requested) || !fs.statSync(requested).isDirectory()) return res.status(400).json({ error: 'پوشه معتبر نیست.' });
  let folders = [];
  try { folders = fs.readdirSync(requested, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name).sort((a, b) => a.localeCompare(b)); } catch {}
  res.json({ current: requested, parent: path.dirname(requested) === requested ? null : path.dirname(requested), folders });
});
app.get('/api/pick-folder', async (req, res) => {
  if (!adminOnly(req, res)) return;
  const resultFile = path.join(os.tmpdir(), `lan-video-folder-${process.pid}-${Date.now()}.json`);
  fs.rmSync(resultFile, { force: true });
  const pickerArgs = ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', path.join(ROOT, 'pick-folder.ps1'), '-ResultFile', resultFile, '-InitialFolder', rootPath];
  if (req.query.file === '1') pickerArgs.push('-PickFile');
  const picker = spawn('powershell.exe', pickerArgs, { windowsHide: true, stdio: 'ignore' });
  let pickerError = null;
  let exited = false;
  picker.on('error', error => { pickerError = error; exited = true; });
  picker.on('exit', () => { exited = true; });
  picker.unref();
  try {
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
      if (fs.existsSync(resultFile)) {
        const selected = JSON.parse(fs.readFileSync(resultFile, 'utf8')).path;
        fs.rmSync(resultFile, { force: true });
        return res.json({ path: selected || null });
      }
      if (pickerError || exited) return res.status(500).json({ error: 'پنجره انتخاب پوشه اجرا نشد؛ دوباره تلاش کنید.' });
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    picker.kill();
    res.json({ path: null });
  } catch {
    res.status(500).json({ error: 'انتخاب‌گر پوشه اجرا نشد.' });
  }
});
app.post('/api/settings', (req, res) => {
  if (!adminOnly(req, res)) return;
  if (active) return res.status(409).json({ error: 'ابتدا سرویس را متوقف کنید.' });
  const candidate = typeof req.body?.rootPath === 'string' ? path.resolve(req.body.rootPath.trim()) : '';
  if (!candidate || !fs.existsSync(candidate) || !fs.statSync(candidate).isDirectory()) return res.status(400).json({ error: 'پوشه انتخاب‌شده وجود ندارد.' });
  rootPath = candidate; paths.fill(null);
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify({ rootPath }, null, 2));
  res.json({ ok: true, rootPath });
});
app.post('/api/config', (req, res) => {
  if (!adminOnly(req, res)) return;
  if (active) return res.status(409).json({ error: 'ابتدا سرویس را متوقف کنید.' });
  const incoming = Array.isArray(req.body?.names) ? req.body.names.map(resolveVideo) : [];
  if (incoming.length !== 3 || incoming.some(filePath => !filePath)) return res.status(400).json({ error: 'هر سه مسیر باید مسیر کامل یک فایل موجود روی سرور باشند.' });
  incoming.forEach((filePath, slot) => { paths[slot] = filePath; });
  res.json({ ok: true });
});
app.post('/api/delete', (req, res) => {
  if (!adminOnly(req, res)) return;
  if (active) return res.status(409).json({ error: 'برای حذف، ابتدا سرویس را متوقف کنید.' });
  const filePath = resolveVideo(req.body?.name);
  if (!filePath) return res.status(404).json({ error: 'فایل ویدئویی پیدا نشد.' });
  fs.rmSync(filePath);
  paths.forEach((selected, index) => { if (selected === filePath) paths[index] = null; });
  res.json({ ok: true });
});
app.post('/api/start', (req, res) => {
  if (!adminOnly(req, res)) return;
  if (paths.some(filePath => !filePath)) return res.status(400).json({ error: 'ابتدا مسیر هر سه ویدئو را ثبت کنید.' });
  active = true;
  res.json({ active });
});
app.post('/api/stop', (req, res) => { if (!adminOnly(req, res)) return; active = false; res.json({ active }); });
app.get('/api/manual/status', (req, res) => res.json({canManage:isServer(req),active:manualActive,videos:manualPaths.map((file,slot)=>file?{name:path.basename(file),title:manualTitles[slot],url:'/manual/video/'+slot}:null)}));
app.post('/api/manual/select', (req, res) => {
  if (!adminOnly(req,res)) return;
  if(manualActive)return res.status(409).json({error:'ابتدا اشتراک را متوقف کنید.'});
  const slot=req.body.slot;
  if(!Number.isInteger(slot)||slot<0||slot>2)return res.status(400).json({error:'جایگاه نامعتبر است.'});
  const file=cleanPath(req.body.path);
  if(!file||!/\.(mp4|webm|ogg|mov|m4v)$/i.test(file))return res.status(400).json({error:'یک فایل ویدئویی معتبر انتخاب کنید.'});
  manualPaths[slot]=file; if (typeof req.body.title === 'string') manualTitles[slot]=req.body.title.trim(); res.json({ok:true});
});
app.post('/api/manual/titles', (req,res)=>{if(!adminOnly(req,res))return;if(manualActive)return res.status(409).json({error:'ابتدا اشتراک را متوقف کنید.'});if(!Array.isArray(req.body.titles)||req.body.titles.length!==3)return res.status(400).json({error:'عنوان‌ها معتبر نیستند.'});req.body.titles.forEach((title,i)=>{manualTitles[i]=typeof title==='string'?title.trim():''});res.json({ok:true});});
app.post('/api/manual/start', (req,res)=>{
  if(!adminOnly(req,res))return;
  if(manualPaths.some(file=>!file||!fs.existsSync(file)))return res.status(400).json({error:'هر سه ویدئو را انتخاب کنید.'});
  manualActive=true;res.json({ok:true});
});
app.post('/api/manual/stop', (req,res)=>{if(!adminOnly(req,res))return;manualActive=false;res.json({ok:true});});
app.post('/api/manual/delete', (req,res)=>{
  if(!adminOnly(req,res))return;
  if(manualActive)return res.status(409).json({error:'ابتدا اشتراک را متوقف کنید.'});
  const slot=req.body.slot;
  if(!Number.isInteger(slot)||slot<0||slot>2||!manualPaths[slot])return res.status(400).json({error:'فایلی انتخاب نشده است.'});
  const file=manualPaths[slot];fs.rmSync(file,{force:true});
  manualPaths.forEach((p,i)=>{if(p===file)manualPaths[i]=null});res.json({ok:true});
});
app.get('/manual/video/:slot',(req,res)=>{
  if(!manualActive&&!isServer(req))return res.sendStatus(404);
  const slot=Number(req.params.slot);
  const file=Number.isInteger(slot)&&slot>=0&&slot<3?manualPaths[slot]:null;
  if(!file)return res.sendStatus(404);
  res.sendFile(file);
});
app.get('/preview', (req, res) => {
  if (!adminOnly(req, res)) return;
  const filePath = resolveVideo(req.query.name);
  if (!filePath) return res.sendStatus(404);
  res.sendFile(filePath);
});
app.get('/video/:slot', (req, res) => {
  if (!active) return res.sendStatus(404);
  const filePath = paths[Number(req.params.slot)];
  if (!filePath || !fs.existsSync(filePath)) return res.sendStatus(404);
  const size = fs.statSync(filePath).size;
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Type', mime(filePath));
  const range = req.headers.range;
  if (!range) { res.setHeader('Content-Length', size); return fs.createReadStream(filePath).pipe(res); }
  const [startText, endText] = range.replace('bytes=', '').split('-');
  const start = Number(startText); const end = endText ? Number(endText) : size - 1;
  if (!Number.isInteger(start) || start < 0 || end >= size || start > end) return res.sendStatus(416);
  res.status(206).set({ 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
  fs.createReadStream(filePath, { start, end }).pipe(res);
});

app.listen(PORT, '0.0.0.0', () => {
  const ips = [...localAddresses].filter(ip => /^\d+\.\d+\.\d+\.\d+$/.test(ip) && ip !== '127.0.0.1');
  console.log(`Direct video server: http://localhost:${PORT}`);
  console.log(`LAN address: ${ips.map(ip => `http://${ip}:${PORT}`).join('  ')}`);
});
