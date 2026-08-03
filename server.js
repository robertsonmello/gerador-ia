'use strict';

const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { URL } = require('url');

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const DATA = path.join(ROOT, 'data');
const MAX_UPLOAD = 200 * 1024 * 1024;
const jobs = new Map();
const voiceReferences = new Map();

const mime = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4', '.json': 'application/json'
};

function reply(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
}

function safeExt(name, allowed) {
  const ext = path.extname(name || '').toLowerCase();
  return allowed.includes(ext) ? ext : '';
}

async function readJson(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 20000) throw new Error('Texto muito grande.');
  }
  return JSON.parse(body || '{}');
}

function synthesize(text, voice, output, customReference) {
  if (voice === 'custom-xtts' || voice === 'female-clara-xtts' || voice === 'female-mel') {
    const reference = voice === 'custom-xtts' ? customReference : path.join(ROOT, 'public/clara.mp3');
    if (!reference) return Promise.reject(new Error('Grave uma referência de voz antes de sintetizar.'));
    return new Promise((resolve, reject) => {
      const python = spawn(path.join(ROOT, '.venv-xtts/bin/python'), [
        path.join(ROOT, 'scripts/xtts_tts.py'), reference, output
      ], {
        env: {
          ...process.env,
          COQUI_TOS_AGREED: '1',
          TTS_HOME: path.join(ROOT, '.cache/tts'),
          HF_HOME: path.join(ROOT, '.cache/huggingface'),
          MPLCONFIGDIR: path.join(ROOT, 'data/.matplotlib-xtts')
        }
      });
      let error = '';
      python.stderr.on('data', chunk => { error = (error + chunk).slice(-10000); });
      python.on('error', reject);
      python.on('close', code => code === 0 ? resolve() : reject(new Error(error || 'Falha na voz XTTS.')));
      python.stdin.end(text);
    });
  }
  if (voice === 'female-luna' || voice === 'female-clara') {
    return new Promise((resolve, reject) => {
      const raw = `${output}.raw.wav`;
      const python = spawn(path.join(ROOT, '.venv-sadtalker/bin/python'), [path.join(ROOT, 'scripts/mms_tts.py'), raw], {
        env: { ...process.env, HF_HOME: path.join(ROOT, '.cache/huggingface') }
      });
      let error = '';
      python.stderr.on('data', chunk => { error += chunk; });
      python.on('error', reject);
      python.on('close', code => {
        if (code !== 0) return reject(new Error(error || 'Falha na voz feminina.'));
        const voiceFilter = 'rubberband=tempo=1.04:pitch=1.26:formant=shifted:transients=smooth:pitchq=quality,highpass=f=110,equalizer=f=220:t=q:w=1.0:g=-2,equalizer=f=3800:t=q:w=1.1:g=3,acompressor=threshold=-18dB:ratio=2.2:attack=12:release=120:makeup=2,loudnorm=I=-16:TP=-1.5:LRA=8';
        const ffmpeg = spawn(process.env.FFMPEG_PATH || 'ffmpeg', [
          '-y', '-i', raw, '-af', voiceFilter,
          '-ar', '24000', '-ac', '1', output
        ]);
        ffmpeg.on('error', reject);
        ffmpeg.on('close', async result => {
          await fsp.rm(raw, { force: true });
          result === 0 ? resolve() : reject(new Error('Falha ao finalizar a voz feminina.'));
        });
      });
      python.stdin.end(text);
    });
  }
  const voices = {
    'male-cadu': ['pt_BR-cadu-medium', false],
    'male-faber': ['pt_BR-faber-medium', false]
  };
  const selected = voices[voice] || voices['male-cadu'];
  const raw = `${output}.raw.wav`;
  return new Promise((resolve, reject) => {
    const piper = spawn(path.join(ROOT, 'vendor/piper/piper'), ['--model', path.join(ROOT, 'voices', `${selected[0]}.onnx`), '--output_file', raw]);
    let error = '';
    piper.stderr.on('data', chunk => { error += chunk; });
    piper.on('error', reject);
    piper.on('close', code => {
      if (code !== 0) return reject(new Error(error || 'Falha ao gerar voz.'));
      const ffmpeg = spawn('ffmpeg', ['-y', '-i', raw, '-ar', '22050', '-ac', '1', output]);
      ffmpeg.on('error', reject);
      ffmpeg.on('close', async result => {
        await fsp.rm(raw, { force: true });
        result === 0 ? resolve() : reject(new Error('Falha ao finalizar a voz.'));
      });
    });
    piper.stdin.end(text);
  });
}

async function saveBody(req, destination) {
  let size = 0;
  const out = fs.createWriteStream(destination, { flags: 'wx' });
  return new Promise((resolve, reject) => {
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_UPLOAD) req.destroy(new Error('Arquivo maior que 200 MB'));
    });
    req.pipe(out);
    out.on('finish', resolve);
    out.on('error', reject);
    req.on('error', reject);
  });
}

function spawnTask(command, args, options = {}, onOutput) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, options);
    let errors = '';
    child.stderr.on('data', data => {
      const text = data.toString();
      errors = (errors + text).slice(-12000);
      if (onOutput) onOutput(text);
    });
    child.stdout.on('data', data => { if (onOutput) onOutput(data.toString()); });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(errors) : reject(new Error(errors || `${command} terminou com código ${code}.`)));
  });
}

function captureTask(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args);
    let stdout = ''; let stderr = '';
    child.stdout.on('data', data => { stdout += data; });
    child.stderr.on('data', data => { stderr += data; });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(stdout.trim()) : reject(new Error(stderr || `${command} terminou com código ${code}.`)));
  });
}

async function mediaDuration(file) {
  const value = await captureTask('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file]);
  const duration = Number(value);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('Não foi possível medir a duração da mídia.');
  return duration;
}

async function runJob(job) {
  if (job.motion) return runWanJob(job);
  job.status = 'processing';
  job.progress = 1;
  job.message = 'Preparando o áudio para sincronização labial…';
  const output = path.join(job.dir, 'resultado.mp4');
  const audio = path.join(job.dir, 'audio-16khz.wav');
  const neuralDir = path.join(job.dir, 'neural');
  const sadTalker = path.join(ROOT, 'vendor/SadTalker');
  try {
    await fsp.mkdir(neuralDir, { recursive: true });
    const audioArgs = ['-y', '-i', job.media, '-vn'];
    if (job.mode === 'preview') audioArgs.push('-t', '5');
    audioArgs.push('-ac', '1', '-ar', '16000', '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', audio);
    await spawnTask(process.env.FFMPEG_PATH || 'ffmpeg', audioArgs);
    job.progress = 5;
    job.message = 'Gerando expressões, piscadas e movimentos naturais… Em CPU esta etapa pode demorar.';
    await spawnTask(path.join(ROOT, '.venv-sadtalker/bin/python'), [
      'inference.py', '--driven_audio', audio, '--source_image', job.image,
      '--checkpoint_dir', 'checkpoints', '--result_dir', neuralDir,
      '--size', '256', '--batch_size', '4', '--preprocess', 'full', '--still', '--pose_style', '0', '--expression_scale', '0.88', '--cpu'
    ], { cwd: sadTalker, env: { ...process.env, MPLCONFIGDIR: path.join(job.dir, '.matplotlib') } }, chunk => {
      const percentMatches = [...chunk.matchAll(/(landmark Det|3DMM Extraction In Video|audio2exp|Face Renderer)::\s+(\d+)%/g)];
      for (const match of percentMatches) {
        const value = Number(match[2]);
        if (match[1] === 'landmark Det') {
          job.progress = Math.max(job.progress, 5 + Math.round(value * .08));
          job.message = `Detectando pontos do rosto… ${value}%`;
        } else if (match[1] === '3DMM Extraction In Video') {
          job.progress = Math.max(job.progress, 13 + Math.round(value * .07));
          job.message = `Mapeando expressões faciais… ${value}%`;
        } else if (match[1] === 'audio2exp') {
          job.progress = Math.max(job.progress, 20 + Math.round(value * .10));
          job.message = `Sincronizando voz e expressões… ${value}%`;
        } else if (match[1] === 'Face Renderer') {
          job.progress = Math.max(job.progress, 30 + Math.round(value * .60));
          job.message = `Renderizando o vídeo neural… ${value}%`;
        }
      }
    });
    const generated = (await fsp.readdir(neuralDir)).filter(name => name.endsWith('.mp4')).sort().pop();
    if (!generated) throw new Error('O modelo neural não produziu um arquivo de vídeo.');
    job.progress = 92;
    job.message = 'Finalizando sem recortes e preservando o enquadramento original…';
    const videoFilter = [
      '[0:v]split=2[background][portrait]',
      '[background]scale=512:512:force_original_aspect_ratio=increase:flags=lanczos,crop=512:512,gblur=sigma=24,eq=brightness=-0.12:saturation=0.75[bg]',
      '[portrait]scale=492:492:force_original_aspect_ratio=decrease:flags=lanczos[person]',
      '[bg][person]overlay=(W-w)/2:(H-h)/2:format=auto,eq=contrast=1.01:saturation=1.015,unsharp=5:5:0.16:3:3:0.05,format=yuv420p[v]'
    ].join(';');
    await spawnTask(process.env.FFMPEG_PATH || 'ffmpeg', [
      '-y', '-i', path.join(neuralDir, generated),
      '-filter_complex', videoFilter, '-map', '[v]', '-map', '0:a?',
      '-c:v', 'libx264', '-preset', process.env.FFMPEG_PRESET || 'veryfast', '-crf', '20',
      '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', output
    ]);
    job.progress = 100; job.status = 'done'; job.message = 'Seu vídeo neural está pronto.'; job.output = output;
  } catch (error) {
    job.status = 'error'; job.progress = 0;
    job.message = String(error.message).includes('Can\'t get the coeffs')
      ? 'Não foi possível detectar um rosto. Use uma foto frontal, nítida e bem iluminada.'
      : 'A geração neural falhou. Confira se a imagem contém um rosto frontal e se o áudio é válido.';
    console.error(`Job neural ${job.id}:`, error);
  }
}

async function runWanJob(job) {
  job.status = 'processing'; job.progress = 1;
  const wanRoot = path.join(ROOT, 'vendor/Wan2.2');
  const python = path.join(ROOT, '.venv-wan/bin/python');
  const checkpoints = process.env.WAN_CHECKPOINT_DIR || path.join(ROOT, 'models/Wan2.2-Animate-14B');
  const output = path.join(job.dir, 'resultado.mp4');
  const rawOutput = path.join(job.dir, 'wan-sem-audio.mp4');
  const processed = path.join(job.dir, 'wan-input');
  try {
    if (!fs.existsSync(python) || !fs.existsSync(path.join(checkpoints, 'process_checkpoint'))) {
      throw new Error('WAN_NOT_READY');
    }
    const motion = path.join(job.dir, 'movimento-centralizado.mp4');
    job.message = 'Posicionando o movimento dos braços no meio da fala…'; job.progress = 5;
    const [audioDuration, guideDuration] = await Promise.all([mediaDuration(job.media), mediaDuration(job.motion)]);
    const targetDuration = job.mode === 'preview' ? Math.min(5, audioDuration) : audioDuration;
    const usableGuide = Math.min(guideDuration, targetDuration);
    const startPad = Math.max(0, (targetDuration - usableGuide) / 2);
    const endPad = Math.max(0, targetDuration - usableGuide - startPad);
    const alignFilter = `trim=duration=${usableGuide.toFixed(3)},setpts=PTS-STARTPTS,tpad=start_mode=clone:start_duration=${startPad.toFixed(3)}:stop_mode=clone:stop_duration=${endPad.toFixed(3)},fps=16`;
    await spawnTask(process.env.FFMPEG_PATH || 'ffmpeg', [
      '-y', '-i', job.motion, '-an', '-vf', alignFilter, '-t', targetDuration.toFixed(3),
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '19', '-pix_fmt', 'yuv420p', motion
    ]);
    job.message = 'Extraindo rosto, mãos e pose do vídeo-guia…'; job.progress = 10;
    await spawnTask(python, [
      './wan/modules/animate/preprocess/preprocess_data.py', '--ckpt_path', checkpoints,
      '--video_path', motion, '--refer_path', job.image, '--save_path', processed,
      '--resolution_area', '512', '512', '--fps', '16', '--retarget_flag'
    ], { cwd: wanRoot, env: { ...process.env, PYTHONUNBUFFERED: '1' } });
    job.message = 'Gerando movimentos corporais e expressões com Wan Animate…'; job.progress = 35;
    await spawnTask(python, [
      'generate.py', '--task', 'animate-14B', '--ckpt_dir', checkpoints,
      '--src_root_path', processed, '--refert_num', '1', '--save_file', rawOutput
    ], { cwd: wanRoot, env: { ...process.env, PYTHONUNBUFFERED: '1' } });
    job.message = 'Sincronizando a voz e finalizando o vídeo…'; job.progress = 92;
    await spawnTask(process.env.FFMPEG_PATH || 'ffmpeg', [
      '-y', '-i', rawOutput, '-i', job.media, '-map', '0:v:0', '-map', '1:a:0',
      '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', output
    ]);
    job.progress = 100; job.status = 'done'; job.message = 'Animação corporal pronta.'; job.output = output;
  } catch (error) {
    job.status = 'error'; job.progress = 0;
    job.message = error.message === 'WAN_NOT_READY'
      ? 'Wan Animate local ainda não está pronto: instale a GPU, o ambiente .venv-wan e os pesos em models/Wan2.2-Animate-14B.'
      : 'A animação corporal falhou. Confira o vídeo-guia, a GPU CUDA e os pesos do Wan Animate.';
    console.error(`Job Wan ${job.id}:`, error);
  }
}

async function api(req, res, url) {
  if (req.method === 'POST' && url.pathname === '/api/tts') {
    const body = await readJson(req);
    const text = String(body.text || '').trim();
    if (text.length < 2 || text.length > 2000) return reply(res, 400, { error: 'Digite uma fala entre 2 e 2.000 caracteres.' });
    const output = path.join(DATA, `voz-${crypto.randomUUID()}.wav`);
    const reference = voiceReferences.get(String(body.referenceId || ''));
    try { await synthesize(text, String(body.voice || ''), output, reference); }
    catch (error) { console.error(error); return reply(res, 500, { error: 'Não foi possível sintetizar esta voz.' }); }
    const stat = await fsp.stat(output);
    res.writeHead(200, { 'content-type': 'audio/wav', 'content-length': stat.size, 'cache-control': 'no-store' });
    return fs.createReadStream(output).pipe(res);
  }
  if (req.method === 'PUT' && url.pathname === '/api/voice-references') {
    const ext = safeExt(url.searchParams.get('name'), ['.webm', '.wav', '.mp3', '.m4a', '.ogg']);
    if (!ext) return reply(res, 415, { error: 'Formato de gravação não suportado.' });
    const id = crypto.randomUUID();
    const file = path.join(DATA, `voz-referencia-${id}${ext}`);
    try { await saveBody(req, file); }
    catch (error) { await fsp.rm(file, { force: true }); return reply(res, 413, { error: error.message }); }
    voiceReferences.set(id, file);
    return reply(res, 201, { id });
  }
  const createMatch = url.pathname.match(/^\/api\/jobs\/([a-f0-9-]+)\/(image|media|motion)$/);
  if (req.method === 'POST' && url.pathname === '/api/jobs') {
    const id = crypto.randomUUID();
    const dir = path.join(DATA, id);
    await fsp.mkdir(dir, { recursive: true });
    const mode = url.searchParams.get('mode') === 'preview' ? 'preview' : 'full';
    jobs.set(id, { id, dir, mode, status: 'uploading', progress: 0, message: 'Aguardando arquivos…' });
    return reply(res, 201, { id });
  }
  if (req.method === 'PUT' && createMatch) {
    const [, id, kind] = createMatch;
    const job = jobs.get(id);
    if (!job || job.status !== 'uploading') return reply(res, 404, { error: 'Envio não encontrado.' });
    const allowed = kind === 'image' ? ['.jpg', '.jpeg', '.png', '.webp'] : kind === 'motion' ? ['.mp4', '.webm', '.mov', '.m4v'] : ['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.mp4', '.webm'];
    const ext = safeExt(url.searchParams.get('name'), allowed);
    if (!ext) return reply(res, 415, { error: kind === 'image' ? 'Imagem inválida.' : kind === 'motion' ? 'Vídeo-guia inválido.' : 'Áudio ou MP4 inválido.' });
    const file = path.join(job.dir, `${kind}${ext}`);
    try { await saveBody(req, file); } catch (e) { await fsp.rm(file, { force: true }); return reply(res, 413, { error: e.message }); }
    job[kind] = file;
    return reply(res, 200, { ok: true });
  }
  const startMatch = url.pathname.match(/^\/api\/jobs\/([a-f0-9-]+)\/start$/);
  if (req.method === 'POST' && startMatch) {
    const job = jobs.get(startMatch[1]);
    if (!job || !job.image || !job.media) return reply(res, 400, { error: 'Envie a imagem e o áudio antes de gerar.' });
    if (job.status !== 'uploading') return reply(res, 409, { error: 'Este trabalho já foi iniciado.' });
    runJob(job); return reply(res, 202, { status: job.status });
  }
  const jobMatch = url.pathname.match(/^\/api\/jobs\/([a-f0-9-]+)$/);
  if (req.method === 'GET' && jobMatch) {
    const job = jobs.get(jobMatch[1]);
    if (!job) return reply(res, 404, { error: 'Vídeo não encontrado.' });
    return reply(res, 200, { id: job.id, status: job.status, progress: job.progress || 0, message: job.message, videoUrl: job.status === 'done' ? `/api/jobs/${job.id}/video` : null });
  }
  const videoMatch = url.pathname.match(/^\/api\/jobs\/([a-f0-9-]+)\/video$/);
  if (req.method === 'GET' && videoMatch) {
    const job = jobs.get(videoMatch[1]);
    if (!job || job.status !== 'done') return reply(res, 404, { error: 'Vídeo ainda não está pronto.' });
    const stat = await fsp.stat(job.output);
    res.writeHead(200, { 'content-type': 'video/mp4', 'content-length': stat.size, 'content-disposition': 'inline; filename="foto-falando.mp4"' });
    return fs.createReadStream(job.output).pipe(res);
  }
  reply(res, 404, { error: 'Rota não encontrada.' });
}

async function handler(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    const relative = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const file = path.resolve(PUBLIC, relative);
    if (!file.startsWith(PUBLIC + path.sep)) return reply(res, 403, 'Proibido', 'text/plain');
    const body = await fsp.readFile(file);
    reply(res, 200, body, mime[path.extname(file)] || 'application/octet-stream');
  } catch (e) {
    if (e.code === 'ENOENT') return reply(res, 404, 'Não encontrado', 'text/plain');
    console.error(e); reply(res, 500, { error: 'Erro interno.' });
  }
}

fs.mkdirSync(DATA, { recursive: true });
http.createServer(handler).listen(PORT, () => console.log(`FalaFoto em http://localhost:${PORT}`));
