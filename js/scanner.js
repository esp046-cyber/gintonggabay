// High precision loupe scanner with Torch support, High-DPI canvas & touch pan
const $ = (id) => document.getElementById(id);
const S = {
  stream: null,
  track: null,
  torch: false,
  torchSupported: false,
  zoom: 1,
  snapZ: 1,
  snapHc: false,
  img: null,
  panX: 0,
  panY: 0,
  isDragging: false,
  startX: 0,
  startY: 0
};

export async function initScanner() {
  $('camStart').onclick = startCamera;
  $('camStop').onclick = stopCamera;
  $('snap').onclick = takeSnapshot;
  $('torchBtn').onclick = toggleTorch;
  
  $('z1').onclick = () => setDigitalZoom(1);
  $('z2').onclick = () => setDigitalZoom(2);
  $('z4').onclick = () => setDigitalZoom(4);
  
  $('sz1').onclick = () => setSnapZoom(1);
  $('sz2').onclick = () => setSnapZoom(2);
  $('sz4').onclick = () => setSnapZoom(4);
  $('sz8').onclick = () => setSnapZoom(8);
  
  $('snapHc').onclick = toggleSnapContrast;
  $('snapClose').onclick = () => $('snapWrap').classList.add('hidden');
  $('snapSave').onclick = saveSnap;
  
  $('camFile').onchange = loadFileImage;
  
  setupTouchPan();
}

async function startCamera() {
  stopCamera();
  const msg = $('camMsg');
  msg.textContent = 'Binubuksan ang kamera...';
  
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1920 },
        height: { ideal: 1080 }
      },
      audio: false
    });
    
    S.stream = stream;
    S.track = stream.getVideoTracks()[0];
    const video = $('cam');
    video.srcObject = stream;
    await video.play();
    
    // Check torch capability
    const caps = S.track.getCapabilities ? S.track.getCapabilities() : {};
    S.torchSupported = !!caps.torch;
    $('torchBtn').classList.toggle('hidden', !S.torchSupported);
    
    msg.textContent = 'Kamera aktibo. Itutok sa hallmark stamp.';
  } catch (err) {
    console.error(err);
    msg.textContent = 'Hindi mabuksan ang camera: ' + (err.name === 'NotAllowedError' ? 'Kailangan ng pahintulot sa Settings.' : err.message);
  }
}

export function stopCamera() {
  if (S.track) {
    if (S.torch) toggleTorch();
    S.track.stop();
  }
  if (S.stream) {
    S.stream.getTracks().forEach((t) => t.stop());
  }
  S.stream = null;
  S.track = null;
  const video = $('cam');
  if (video) video.srcObject = null;
  $('camMsg').textContent = 'Naka-off ang kamera.';
}

async function toggleTorch() {
  if (!S.track || !S.torchSupported) return;
  S.torch = !S.torch;
  try {
    await S.track.applyConstraints({ advanced: [{ torch: S.torch }] });
    $('torchBtn').setAttribute('aria-pressed', String(S.torch));
  } catch (e) {
    console.warn('Torch error:', e);
  }
}

function setDigitalZoom(z) {
  S.zoom = z;
  [1, 2, 4].forEach((v) => $('z' + v).setAttribute('aria-pressed', String(v === z)));
  $('cam').style.transform = `scale(${z})`;
}

function takeSnapshot() {
  const video = $('cam');
  if (!video || !video.videoWidth) return;
  
  const c = document.createElement('canvas');
  c.width = video.videoWidth;
  c.height = video.videoHeight;
  const ctx = c.getContext('2d');
  ctx.drawImage(video, 0, 0);
  
  const img = new Image();
  img.onload = () => {
    S.img = img;
    S.snapZ = 1;
    S.panX = 0;
    S.panY = 0;
    $('snapWrap').classList.remove('hidden');
    renderSnap();
  };
  img.src = c.toDataURL('image/png');
}

function loadFileImage(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const r = new FileReader();
  r.onload = (evt) => {
    const img = new Image();
    img.onload = () => {
      S.img = img;
      S.snapZ = 1;
      S.panX = 0;
      S.panY = 0;
      $('snapWrap').classList.remove('hidden');
      renderSnap();
    };
    img.src = evt.target.result;
  };
  r.readAsDataURL(file);
}

function renderSnap() {
  if (!S.img) return;
  const canvas = $('snapCanvas');
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, rect.width, rect.height);
  
  const w = rect.width * S.snapZ;
  const h = (rect.width / (S.img.width / S.img.height)) * S.snapZ;
  
  const x = (rect.width - w) / 2 + S.panX;
  const y = (rect.height - h) / 2 + S.panY;
  
  ctx.drawImage(S.img, x, y, w, h);
  
  if (S.snapHc) {
    applyHighContrast(ctx, rect.width, rect.height, dpr);
  }
}

function applyHighContrast(ctx, w, h, dpr) {
  const imgData = ctx.getImageData(0, 0, w * dpr, h * dpr);
  const d = imgData.data;
  for (let i = 0; i < d.length; i += 4) {
    const avg = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114);
    const val = avg > 110 ? 255 : 0;
    d[i] = val;
    d[i + 1] = val;
    d[i + 2] = val;
  }
  ctx.putImageData(imgData, 0, 0);
}

function setSnapZoom(z) {
  S.snapZ = z;
  [1, 2, 4, 8].forEach((v) => $('sz' + v).setAttribute('aria-pressed', String(v === z)));
  renderSnap();
}

function toggleSnapContrast() {
  S.snapHc = !S.snapHc;
  $('snapHc').setAttribute('aria-pressed', String(S.snapHc));
  renderSnap();
}

function setupTouchPan() {
  const v = $('snapView');
  const onStart = (e) => {
    S.isDragging = true;
    const p = e.touches ? e.touches[0] : e;
    S.startX = p.clientX - S.panX;
    S.startY = p.clientY - S.panY;
  };
  const onMove = (e) => {
    if (!S.isDragging) return;
    e.preventDefault();
    const p = e.touches ? e.touches[0] : e;
    S.panX = p.clientX - S.startX;
    S.panY = p.clientY - S.startY;
    renderSnap();
  };
  const onEnd = () => { S.isDragging = false; };
  
  v.addEventListener('mousedown', onStart);
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onEnd);
  
  v.addEventListener('touchstart', onStart, { passive: false });
  window.addEventListener('touchmove', onMove, { passive: false });
  window.addEventListener('touchend', onEnd);
}

function saveSnap() {
  const canvas = $('snapCanvas');
  const a = document.createElement('a');
  a.download = `hallmark-loupe-${Date.now()}.png`;
  a.href = canvas.toDataURL('image/png');
  a.click();
}