const $ = selector => document.querySelector(selector);
const imageInput = $('#image');
const mediaInput = $('#media');
const motionInput = $('#motion');
const form = $('#generator');
let approvedFiles = null;
let resultUrl = null;
let customVoiceReferenceId = null;
let mouthPoint = { x: .5, y: .58 };

imageInput.addEventListener('change', () => {
  if (!imageInput.files[0]) return;
  const url = URL.createObjectURL(imageInput.files[0]);
  $('#preview').src = url;
  $('#imageDrop').classList.add('has-file');
  const stage = $('.preview-stage');
  stage.style.backgroundImage = `linear-gradient(0deg,rgba(5,7,9,.18),rgba(5,7,9,.05)),url("${url}")`;
  stage.style.backgroundSize = 'cover'; stage.style.backgroundPosition = 'center';
  $('.empty-state').style.display = 'none';
});

mediaInput.addEventListener('change', () => {
  if (mediaInput.files[0]) $('#mediaName').textContent = mediaInput.files[0].name;
});
motionInput.addEventListener('change', () => {
  if (motionInput.files[0]) $('#motionName').textContent = motionInput.files[0].name;
});

const speechText = $('#speechText');
speechText.addEventListener('input', () => { $('#charCount').textContent = `${speechText.value.length} / 2000`; });

document.querySelectorAll('.suggestions button').forEach(button => button.addEventListener('click', () => {
  const examples = {
    'Apresentação profissional': 'Olá! É um prazer receber você. Hoje vou apresentar uma solução criada para tornar seu trabalho mais simples, rápido e eficiente.',
    'Convite para evento': 'Você é nosso convidado especial! Reserve esta data e venha viver uma experiência inesquecível com a gente. Esperamos por você!',
    'Vídeo para redes sociais': 'Você já imaginou transformar uma única foto em um vídeo pronto para publicar? Veja como é simples criar conteúdo com inteligência artificial.'
  };
  speechText.value = examples[button.textContent] || '';
  speechText.dispatchEvent(new Event('input'));
  speechText.focus();
}));

$('#enhance').addEventListener('click', () => {
  const value = speechText.value.trim();
  if (!value) { speechText.value = 'Olá! Hoje eu quero compartilhar uma ideia especial com você. Em poucos instantes, vamos descobrir juntos uma nova forma de criar, comunicar e inspirar.'; }
  else if (!/[.!?]$/.test(value)) speechText.value = `${value}.`;
  speechText.value = speechText.value.replace(/^./, first => first.toUpperCase());
  speechText.dispatchEvent(new Event('input'));
  speechText.focus();
});

document.querySelectorAll('.segmented button').forEach(button => button.addEventListener('click', () => {
  button.parentElement.querySelectorAll('button').forEach(item => item.classList.remove('active'));
  button.classList.add('active');
}));

document.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', () => {
  const mode = button.dataset.mode;
  document.querySelectorAll('.mode-tab').forEach(tab => tab.classList.toggle('active', tab.dataset.mode === mode));
}));

async function speechFile(forceText = false) {
  if (mediaInput.files[0] && !forceText) {
    return mediaInput.files[0];
  }
  const text = $('#speechText').value.trim();
  if (text.length < 2) throw new Error('Digite a fala que deseja gerar.');
  const response = await fetch('/api/tts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, voice: $('#voice').value, referenceId: customVoiceReferenceId }) });
  if (!response.ok) { const data = await response.json(); throw new Error(data.error || 'Não foi possível gerar a voz.'); }
  return new File([await response.blob()], 'fala.wav', { type: 'audio/wav' });
}

$('#previewVoice').addEventListener('click', async () => {
  const button = $('#previewVoice'); button.disabled = true; button.textContent = 'Gerando voz…';
  try {
    const file = await speechFile(true); const audio = $('#voicePreview');
    audio.src = URL.createObjectURL(file); audio.hidden = false; await audio.play();
  } catch (error) { alert(error.message); }
  finally {
    button.disabled = false;
    button.innerHTML = $('#voice').value === 'custom-xtts' ? '<span>▶</span> Ouvir prévia da minha voz' : '<span>▶</span> Ouvir prévia da voz';
  }
});

$('#voice').addEventListener('change', () => {
  $('#previewVoice').innerHTML = $('#voice').value === 'custom-xtts' ? '<span>▶</span> Ouvir prévia da minha voz' : '<span>▶</span> Ouvir prévia da voz';
});

let voiceRecorder = null;
let voiceStream = null;
let voiceChunks = [];
let recordStartedAt = 0;
let voiceTimer = null;

$('#recordVoice').addEventListener('click', async () => {
  const status = $('#recordStatus');
  try {
    voiceStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
    voiceRecorder = new MediaRecorder(voiceStream, { mimeType }); voiceChunks = []; recordStartedAt = Date.now();
    voiceRecorder.ondataavailable = event => { if (event.data.size) voiceChunks.push(event.data); };
    voiceRecorder.onstop = async () => {
      clearTimeout(voiceTimer);
      voiceStream.getTracks().forEach(track => track.stop());
      const seconds = (Date.now() - recordStartedAt) / 1000;
      if (seconds < 3) { status.textContent = 'A gravação ficou curta. Grave pelo menos 6 segundos.'; return; }
      status.textContent = 'Preparando a referência de voz…';
      try {
        const file = new File(voiceChunks, 'minha-voz.webm', { type: mimeType });
        const response = await fetch('/api/voice-references?name=minha-voz.webm', { method: 'PUT', body: file });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Não foi possível salvar a gravação.');
        customVoiceReferenceId = data.id;
        let option = $('#voice').querySelector('option[value="custom-xtts"]');
        if (!option) { option = document.createElement('option'); option.value = 'custom-xtts'; option.textContent = 'Minha voz · Clone XTTS'; $('#voice').prepend(option); }
        $('#voice').value = 'custom-xtts'; $('#voice').dispatchEvent(new Event('change'));
        status.textContent = `Voz gravada (${Math.round(seconds)}s). Escreva um texto e clique abaixo para ouvir sua voz clonada.`;
      } catch (error) { status.textContent = error.message; }
    };
    voiceRecorder.start(250);
    voiceTimer = setTimeout(() => { if (voiceRecorder.state === 'recording') { voiceRecorder.stop(); $('#recordVoice').hidden = false; $('#stopVoice').hidden = true; } }, 15000);
    $('#recordVoice').hidden = true; $('#stopVoice').hidden = false; status.textContent = 'Gravando… fale naturalmente por 6 a 15 segundos.';
  } catch (error) { status.textContent = 'Não foi possível acessar o microfone. Autorize-o no navegador.'; }
});

$('#stopVoice').addEventListener('click', () => {
  if (voiceRecorder && voiceRecorder.state === 'recording') voiceRecorder.stop();
  $('#recordVoice').hidden = false; $('#stopVoice').hidden = true;
});

document.querySelectorAll('.drop').forEach(drop => {
  ['dragenter', 'dragover'].forEach(name => drop.addEventListener(name, () => drop.classList.add('drag')));
  ['dragleave', 'drop'].forEach(name => drop.addEventListener(name, () => drop.classList.remove('drag')));
});

const loadImage = file => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = () => reject(new Error('Não consegui abrir a imagem.'));
  img.src = URL.createObjectURL(file);
});

const waitEvent = (element, name) => new Promise((resolve, reject) => {
  element.addEventListener(name, resolve, { once: true });
  element.addEventListener('error', () => reject(new Error('Não consegui abrir o áudio ou MP4.')), { once: true });
});

function roundedRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
}

function drawCover(ctx, img, x, y, width, height) {
  const ratio = Math.max(width / img.width, height / img.height);
  const sw = width / ratio;
  const sh = height / ratio;
  const sx = (img.width - sw) / 2;
  const sy = Math.max(0, (img.height - sh) * 0.28);
  ctx.drawImage(img, sx, sy, sw, sh, x, y, width, height);
}

function drawAvatar(ctx, base, time, energy, width, height) {
  const talking = Math.min(1, Math.max(0, (energy - .015) * 8));
  const breathe = Math.sin(time * 1.55);
  ctx.save();
  ctx.fillStyle = '#111'; ctx.fillRect(0, 0, width, height);
  ctx.translate(width / 2, height / 2); ctx.rotate(Math.sin(time * .72) * .0025);
  const zoom = 1.012 + breathe * .0025; ctx.scale(zoom, zoom);
  ctx.drawImage(base, -width / 2, -height / 2 + breathe * 1.2);
  ctx.restore();

  if (talking > .035) {
    const mx = mouthPoint.x * width, my = mouthPoint.y * height;
    const patchW = 86, patchH = 38, gap = Math.min(13, talking * 13);
    ctx.save();
    ctx.beginPath(); ctx.ellipse(mx, my, patchW * .52, patchH * .7 + gap, 0, 0, Math.PI * 2); ctx.clip();
    ctx.drawImage(base, mx-patchW/2, my-patchH/2, patchW, patchH/2, mx-patchW/2, my-patchH/2-gap*.1, patchW, patchH/2);
    const shade = ctx.createLinearGradient(0, my-2, 0, my+gap+3);
    shade.addColorStop(0, 'rgba(50,15,18,.3)'); shade.addColorStop(.5, 'rgba(18,6,8,.75)'); shade.addColorStop(1, 'rgba(90,35,38,.4)');
    ctx.fillStyle = shade; ctx.beginPath(); ctx.ellipse(mx, my+gap*.25, 32, Math.max(1, gap*.45), 0, 0, Math.PI*2); ctx.fill();
    ctx.drawImage(base, mx-patchW/2, my, patchW, patchH/2, mx-patchW/2, my+gap, patchW, patchH/2);
    ctx.restore();
  }
}

async function createAvatar(photoFile, soundFile, onProgress, maxDuration = Infinity) {
  if (!window.MediaRecorder) throw new Error('Use Chrome ou Edge atualizado para gerar o avatar.');
  const photo = await loadImage(photoFile);
  const base = document.createElement('canvas'); base.width = 720; base.height = 720;
  drawCover(base.getContext('2d'), photo, 0, 0, 720, 720);
  const player = document.createElement(soundFile.type.startsWith('video/') ? 'video' : 'audio');
  player.src = URL.createObjectURL(soundFile); player.preload = 'auto'; player.muted = false;
  await waitEvent(player, 'loadedmetadata');
  if (!Number.isFinite(player.duration) || player.duration <= 0) throw new Error('O arquivo não possui áudio válido.');

  const audioContext = new AudioContext();
  const source = audioContext.createMediaElementSource(player);
  const analyser = audioContext.createAnalyser(); analyser.fftSize = 512; analyser.smoothingTimeConstant = .72;
  const destination = audioContext.createMediaStreamDestination();
  source.connect(analyser); analyser.connect(destination);

  const canvas = document.createElement('canvas'); canvas.width = 720; canvas.height = 720;
  const ctx = canvas.getContext('2d');
  const canvasStream = canvas.captureStream(30);
  const stream = new MediaStream([...canvasStream.getVideoTracks(), ...destination.stream.getAudioTracks()]);
  const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus') ? 'video/webm;codecs=vp9,opus' : 'video/webm;codecs=vp8,opus';
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 2800000 });
  const chunks = [];
  recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
  const finished = new Promise(resolve => recorder.onstop = () => resolve(new Blob(chunks, { type: 'video/webm' })));
  const samples = new Uint8Array(analyser.fftSize);
  const previewDuration = Math.min(player.duration, maxDuration);
  let frame; let stopped = false;
  const stopRecording = () => {
    if (stopped) return;
    stopped = true; cancelAnimationFrame(frame); player.pause();
    setTimeout(() => { if (recorder.state !== 'inactive') recorder.stop(); }, 180);
  };
  const render = () => {
    analyser.getByteTimeDomainData(samples);
    let power = 0;
    for (const sample of samples) { const normalized = (sample - 128) / 128; power += normalized * normalized; }
    const energy = Math.sqrt(power / samples.length);
    drawAvatar(ctx, base, player.currentTime, energy, 720, 720);
    onProgress(player.currentTime, previewDuration);
    if (player.currentTime >= previewDuration || player.ended) stopRecording();
    else frame = requestAnimationFrame(render);
  };
  player.onended = stopRecording;
  await audioContext.resume(); recorder.start(500); await player.play(); render();
  const blob = await finished;
  stream.getTracks().forEach(track => track.stop()); await audioContext.close();
  URL.revokeObjectURL(player.src);
  return blob;
}

async function apiJson(url, options) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Não foi possível comunicar com o gerador.');
  return data;
}

async function createNeuralVideo(photoFile, soundFile, onStatus, mode = 'full') {
  const { id } = await apiJson(`/api/jobs?mode=${mode}`, { method: 'POST' });
  const upload = async (kind, file) => {
    const response = await fetch(`/api/jobs/${id}/${kind}?name=${encodeURIComponent(file.name)}`, { method: 'PUT', body: file });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Não foi possível enviar ${kind === 'image' ? 'a imagem' : 'o áudio'}.`);
  };
  onStatus('Enviando imagem e áudio com segurança…', 1);
  await Promise.all([upload('image', photoFile), upload('media', soundFile)]);
  if (motionInput.files[0]) await upload('motion', motionInput.files[0]);
  await apiJson(`/api/jobs/${id}/start`, { method: 'POST' });
  while (true) {
    await new Promise(resolve => setTimeout(resolve, 2000));
    const job = await apiJson(`/api/jobs/${id}`);
    onStatus(job.message, job.progress || 0);
    if (job.status === 'done') {
      const response = await fetch(job.videoUrl);
      if (!response.ok) throw new Error('O vídeo foi gerado, mas não pôde ser carregado.');
      return await response.blob();
    }
    if (job.status === 'error') throw new Error(job.message);
  }
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  const button = $('#generate'); const result = $('#result');
  if (!imageInput.files[0]) return;
  button.disabled = true; result.hidden = false; result.className = 'result';
  $('#video').hidden = true; $('#download').hidden = true; $('#approve').hidden = true;
  $('#statusPercent').textContent = '0%'; $('#progressBar').style.width = '0%';
  $('#statusTitle').textContent = 'Dando vida ao avatar…';
  $('#statusMessage').textContent = 'O vídeo é criado localmente e acompanha a duração do áudio.';
  result.scrollIntoView({ behavior: 'smooth' });
  try {
    $('#statusMessage').textContent = mediaInput.files[0] ? 'Usando o áudio do arquivo enviado…' : 'Gerando a voz escolhida…';
    const generatedSpeech = await speechFile();
    approvedFiles = { photo: imageInput.files[0], speech: generatedSpeech };
    $('#statusMessage').textContent = 'Gerando uma amostra neural realista de 5 segundos…';
    const blob = await createNeuralVideo(approvedFiles.photo, approvedFiles.speech, (message, progress) => {
      $('#statusMessage').textContent = message;
      $('#statusPercent').textContent = `${progress}%`;
      $('#progressBar').style.width = `${progress}%`;
    }, 'preview');
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    resultUrl = URL.createObjectURL(blob);
    const video = $('#video'); video.src = resultUrl; video.hidden = false;
    $('#approve').hidden = false;
    result.classList.add('done'); $('#statusTitle').textContent = 'Amostra pronta!';
    $('#statusPercent').textContent = '100%'; $('#progressBar').style.width = '100%';
    $('#statusMessage').textContent = 'Confira a voz feminina e os movimentos neurais antes de aprovar o vídeo completo.';
  } catch (error) {
    $('#statusTitle').textContent = 'Não foi possível gerar'; $('#statusMessage').textContent = error.message;
  } finally { button.disabled = false; }
});

$('#approve').addEventListener('click', async () => {
  if (!approvedFiles) return;
  const approve = $('#approve'); const result = $('#result');
  approve.disabled = true; approve.hidden = true; result.classList.remove('done'); $('#download').hidden = true;
  $('#statusTitle').textContent = 'Gerando vídeo completo…';
  $('#statusPercent').textContent = '0%'; $('#progressBar').style.width = '0%';
  try {
    const blob = await createNeuralVideo(approvedFiles.photo, approvedFiles.speech, (message, progress) => {
      $('#statusMessage').textContent = message;
      $('#statusPercent').textContent = `${progress}%`;
      $('#progressBar').style.width = `${progress}%`;
    }, 'full');
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    resultUrl = URL.createObjectURL(blob);
    const video = $('#video'); video.src = resultUrl; video.hidden = false;
    const download = $('#download'); download.href = resultUrl; download.download = 'lumae-video.mp4'; download.hidden = false;
    result.classList.add('done'); $('#statusTitle').textContent = 'Vídeo completo pronto!';
    $('#statusPercent').textContent = '100%'; $('#progressBar').style.width = '100%';
    $('#statusMessage').textContent = 'Processamento final concluído com qualidade neural.';
  } catch (error) {
    $('#statusTitle').textContent = 'Não foi possível gerar'; $('#statusMessage').textContent = error.message;
  } finally { approve.disabled = false; }
});
