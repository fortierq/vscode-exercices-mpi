const vscode = acquireVsCodeApi();
const base = document.body.dataset.pdfjs;
const status = document.getElementById('status');
const viewportElement = document.getElementById('viewport');
const pageInput = document.getElementById('page');
const zoomInput = document.getElementById('zoom');
const saved = vscode.getState() ?? {};
let pageNumber = saved.page ?? 1;
zoomInput.value = saved.zoom ?? 'fit';
let pdf, loadTask, observer;
let pages = [];
let generation = 0;
let chain = Promise.resolve();
const report = error => {
  if (error?.name === 'RenderingCancelledException') return;
  status.textContent = `Impossible d'afficher le PDF : ${error.message ?? error}`;
  vscode.postMessage({ type: 'renderError', message: status.textContent });
};
const pdfjs = await import(`${base}pdf.mjs`).catch(error => { report(error); throw error; });
pdfjs.GlobalWorkerOptions.workerSrc = `${base}pdf.worker.mjs`;
// VS Code webviews cannot load resource URLs from a worker. Fetch the standalone
// bundle in the webview, then start it from a blob (no import inside the worker).
const workerResponse = await fetch(`${base}pdf.worker.mjs`);
if (!workerResponse.ok) throw new Error('Le module du lecteur PDF est introuvable.');
const workerUrl = URL.createObjectURL(new Blob([await workerResponse.text()], { type: 'text/javascript' }));
const workerPort = new Worker(workerUrl, { type: 'module' });
const sharedWorker = new pdfjs.PDFWorker({ port: workerPort });
window.addEventListener('unload', () => { sharedWorker.destroy(); workerPort.terminate(); URL.revokeObjectURL(workerUrl); });

function remember() { vscode.setState({ page: pageNumber, zoom: zoomInput.value }); }
function goTo(number) {
  if (!pdf) return;
  pageNumber = Math.max(1, Math.min(pdf.numPages, Math.floor(number) || 1));
  const element = pages[pageNumber - 1]?.element;
  if (element) viewportElement.scrollTop = element.offsetTop - 12;
  pageInput.value = String(pageNumber); remember();
}
async function renderPage(index, version) {
  const holder = pages[index];
  if (!holder || holder.rendered || version !== generation) return;
  holder.rendered = true;
  const page = await pdf.getPage(index + 1);
  if (version !== generation) return;
  const scale = zoomInput.value === 'fit' ? Math.max(0.2, (viewportElement.clientWidth - 24) / page.getViewport({ scale: 1 }).width) : Number(zoomInput.value);
  const viewport = page.getViewport({ scale });
  holder.element.style.width = `${viewport.width}px`; holder.element.style.height = `${viewport.height}px`;
  holder.element.style.setProperty('--total-scale-factor', String(scale));
  const ratio = window.devicePixelRatio || 1;
  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(viewport.width * ratio); canvas.height = Math.floor(viewport.height * ratio);
  canvas.style.width = `${viewport.width}px`; canvas.style.height = `${viewport.height}px`;
  canvas.setAttribute('aria-label', `Page ${index + 1} sur ${pdf.numPages}`);
  holder.element.append(canvas);
  await page.render({ canvasContext: canvas.getContext('2d'), viewport, transform: ratio === 1 ? null : [ratio, 0, 0, ratio, 0, 0], intent: 'print' }).promise;
  if (version !== generation) return;
  const text = document.createElement('div'); text.className = 'textLayer'; holder.element.append(text);
  const content = await page.getTextContent();
  await new pdfjs.TextLayer({ textContentSource: content, container: text, viewport }).render();
  status.textContent = '';
  vscode.postMessage({ type: 'rendered', pages: pdf.numPages, page: index + 1 });
}
async function layout(version) {
  observer?.disconnect(); pages = []; viewportElement.replaceChildren();
  const first = await pdf.getPage(1);
  const scale = zoomInput.value === 'fit' ? Math.max(0.2, (viewportElement.clientWidth - 24) / first.getViewport({ scale: 1 }).width) : Number(zoomInput.value);
  const dimensions = first.getViewport({ scale });
  observer = new IntersectionObserver(entries => {
    for (const entry of entries) if (entry.isIntersecting) {
      const index = Number(entry.target.dataset.index);
      chain = chain.then(() => renderPage(index, version)).catch(report);
    }
  }, { root: viewportElement, rootMargin: '500px' });
  for (let i = 0; i < pdf.numPages; i++) {
    const element = document.createElement('section'); element.className = 'pdf-page'; element.dataset.index = String(i);
    element.style.width = `${dimensions.width}px`; element.style.height = `${dimensions.height}px`;
    element.setAttribute('aria-label', `Page ${i + 1}`); viewportElement.append(element);
    pages.push({ element, rendered: false }); observer.observe(element);
  }
  pageInput.max = String(pdf.numPages); document.getElementById('total').textContent = `/ ${pdf.numPages}`;
  goTo(pageNumber);
  await renderPage(pageNumber - 1, version);
}
window.addEventListener('message', event => {
  const message = event.data;
  if (message.type === 'error') { status.textContent = message.message; vscode.postMessage({ type: 'renderError', message: message.message }); return; }
  if (message.type === 'info') {
    document.getElementById('switch').textContent = `${message.variant === 'corrige' ? 'Corrigé' : 'Énoncé'} ⇄`;
    document.getElementById('watch').textContent = `● ${message.state}`; return;
  }
  if (message.type !== 'pdf') return;
  const version = ++generation;
  chain = chain.then(async () => {
    if (version !== generation) return;
    status.textContent = 'Chargement…'; observer?.disconnect();
    if (loadTask) await loadTask.destroy();
    loadTask = pdfjs.getDocument({ worker: sharedWorker, data: Uint8Array.from(atob(message.data), c => c.charCodeAt(0)), isEvalSupported: false, cMapUrl: `${base}cmaps/`, cMapPacked: true, standardFontDataUrl: `${base}standard_fonts/`, wasmUrl: `${base}wasm/`, useWasm: false });
    pdf = await loadTask.promise;
    await layout(version);
  }).catch(report);
});
pageInput.onchange = () => goTo(Number(pageInput.value));
zoomInput.onchange = () => { const version = ++generation; chain = chain.then(() => pdf && layout(version)).catch(report); };
for (const type of ['switch', 'source', 'save']) document.getElementById(type).onclick = () => vscode.postMessage({ type });
document.getElementById('refresh').onclick = () => vscode.postMessage({ type: 'compile' });
viewportElement.addEventListener('dblclick', event => {
  const span = event.target.closest('.textLayer span');
  if (span?.textContent?.trim()) vscode.postMessage({ type: 'source', text: span.textContent });
});
window.addEventListener('keydown', event => {
  if (['INPUT', 'SELECT', 'TEXTAREA'].includes(event.target.tagName) || event.ctrlKey || event.metaKey || event.altKey) return;
  if (['ArrowDown', 'ArrowRight', 'PageDown'].includes(event.key)) { event.preventDefault(); goTo(pageNumber + 1); }
  else if (['ArrowUp', 'ArrowLeft', 'PageUp'].includes(event.key)) { event.preventDefault(); goTo(pageNumber - 1); }
  else if (event.key === 'Home') { event.preventDefault(); goTo(1); }
  else if (event.key === 'End') { event.preventDefault(); goTo(pdf?.numPages ?? 1); }
});
let scrollTimer, resizeTimer;
viewportElement.addEventListener('scroll', () => {
  clearTimeout(scrollTimer); scrollTimer = setTimeout(() => {
    const top = viewportElement.getBoundingClientRect().top + 40;
    let closest = 0;
    for (let i = 0; i < pages.length; i++) if (pages[i].element.getBoundingClientRect().top <= top) closest = i;
    pageNumber = closest + 1; pageInput.value = String(pageNumber); remember();
  }, 70);
});
window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { if (pdf) zoomInput.onchange(); }, 180); });
vscode.postMessage({ type: 'ready' });
