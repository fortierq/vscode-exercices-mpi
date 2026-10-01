const vscode = acquireVsCodeApi();
window.addEventListener('error', event => vscode.postMessage({ type: 'clientError', error: event.message }));
window.addEventListener('unhandledrejection', event => vscode.postMessage({ type: 'clientError', error: String(event.reason) }));
const status = document.getElementById('status');
const frames = new Map();
let state;
let epoch = 0;
let rendered;
let workerSource;
const controls = frame => frame.contentWindow?.postMessage({ token: state.tokens?.[frame.dataset.variant], jumps: state.jumps }, new URL(frame.src).origin);
async function pdf(data) {
  if (rendered === data) return;
  rendered = data;
  const revision = ++epoch;
  const host = document.getElementById('viewers');
  host.replaceChildren();
  const base = document.body.dataset.pdfjs;
  const pdfjs = await import(base + 'pdf.mjs');
  workerSource ??= fetch(base + 'pdf.worker.mjs').then(response => { if (!response.ok) throw new Error('Chargement du lecteur PDF impossible.'); return response.text(); });
  // Workers loaded from a Blob and font outlines avoid webview origin/font-loading stalls.
  const url = URL.createObjectURL(new Blob([await workerSource], { type: 'text/javascript' }));
  const port = new Worker(url, { type: 'module' });
  const worker = new pdfjs.PDFWorker({ port });
  const loading = pdfjs.getDocument({ worker, useWorkerFetch: false, disableFontFace: true, data: Uint8Array.from(atob(data), c => c.charCodeAt(0)), cMapUrl: base + 'cmaps/', cMapPacked: true, standardFontDataUrl: base + 'standard_fonts/', wasmUrl: base + 'wasm/' });
  try {
    const doc = await loading.promise;
    for (let n = 1; n <= doc.numPages && revision === epoch; n++) {
      const page = await doc.getPage(n);
      const scale = Math.max(0.2, (host.clientWidth - 24) / page.getViewport({ scale: 1 }).width);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas'); canvas.width = viewport.width; canvas.height = viewport.height;
      if (revision !== epoch) break;
      host.append(canvas); await page.render({ canvasContext: canvas.getContext('2d'), canvas, viewport, intent: 'print' }).promise;
    }
    if (revision === epoch) vscode.postMessage({ type: 'pdfReady', pages: doc.numPages });
  } finally { await loading.destroy(); worker.destroy(); port.terminate(); URL.revokeObjectURL(url); }
}
for (const id of ['enonce', 'corrige', 'save', 'jumps', 'theme', 'restart']) {
  document.getElementById(id).onclick = () => vscode.postMessage({ type: id });
}
window.addEventListener('message', ({ data }) => {
  if (data?.channel !== document.body.dataset.channel) return;
  if (data.type === 'reset') { ++epoch; rendered = undefined; for (const frame of frames.values()) frame.remove(); frames.clear(); }
  if (data.type === 'status') { status.textContent = data.message; status.hidden = false; }
  if (data.type !== 'show') return;
  state = data;
  document.body.classList.toggle('pdf-dark', !data.native && data.dark);
  document.getElementById('jumps').disabled = !data.native;
  document.querySelector('.watch').textContent = data.native ? '● watch' : '● à l’enregistrement';
  document.querySelector('.watch').title = data.native ? 'Mise à jour à la frappe' : 'Tinymist absent : PDF actualisé à l’enregistrement';
  if (data.pdf) { status.hidden = true; void pdf(data.pdf).catch(error => { rendered = undefined; status.textContent = String(error); status.hidden = false; vscode.postMessage({ type: 'pdfError', error: String(error) }); }); }
  for (const [variant, url] of Object.entries(data.sessions)) {
    if (!frames.has(variant)) {
      const frame = document.createElement('iframe');
      frame.title = variant === 'enonce' ? 'Énoncé — Tinymist' : 'Corrigé — Tinymist';
      frame.src = url;
      frame.dataset.variant = variant;
      frame.addEventListener('load', () => { controls(frame); vscode.postMessage({ type: 'frameReady', variant }); });
      frames.set(variant, frame);
      document.getElementById('viewers').append(frame);
    }
  }
  for (const [variant, frame] of frames) { frame.hidden = variant !== data.variant; controls(frame); }
  for (const variant of ['enonce', 'corrige']) document.getElementById(variant).setAttribute('aria-pressed', String(variant === data.variant));
  document.getElementById('jumps').setAttribute('aria-pressed', String(data.jumps));
  document.getElementById('theme').setAttribute('aria-pressed', String(data.dark));
  status.hidden = !!data.pdf || frames.has(data.variant);
});
window.addEventListener('keydown', event => {
  if (state?.native || !['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp'].includes(event.key)) return;
  event.preventDefault();
  const host = document.getElementById('viewers');
  host.scrollBy({ top: (event.key.endsWith('Down') ? 1 : -1) * (event.key.startsWith('Page') ? host.clientHeight * .9 : 60) });
});
vscode.postMessage({ type: 'ready' });
