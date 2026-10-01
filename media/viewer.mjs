const vscode = acquireVsCodeApi();
const status = document.getElementById('status');
const frames = new Map();
for (const id of ['enonce', 'corrige', 'save', 'source', 'jumps', 'theme', 'restart']) {
  document.getElementById(id).onclick = () => vscode.postMessage({ type: id });
}
window.addEventListener('message', ({ data }) => {
  if (data?.channel !== document.body.dataset.channel) return;
  if (data.type === 'reset') { for (const frame of frames.values()) frame.remove(); frames.clear(); }
  if (data.type === 'status') { status.textContent = data.message; status.hidden = false; }
  if (data.type !== 'show') return;
  for (const [variant, url] of Object.entries(data.sessions)) {
    if (!frames.has(variant)) {
      const frame = document.createElement('iframe');
      frame.title = variant === 'enonce' ? 'Énoncé — Tinymist' : 'Corrigé — Tinymist';
      frame.src = url;
      frame.addEventListener('load', () => vscode.postMessage({ type: 'frameReady', variant }));
      frames.set(variant, frame);
      document.getElementById('viewers').append(frame);
    }
  }
  for (const [variant, frame] of frames) frame.hidden = variant !== data.variant;
  for (const variant of ['enonce', 'corrige']) document.getElementById(variant).setAttribute('aria-pressed', String(variant === data.variant));
  document.getElementById('jumps').setAttribute('aria-pressed', String(data.jumps));
  document.getElementById('theme').setAttribute('aria-pressed', String(data.dark));
  status.hidden = frames.has(data.variant);
});
vscode.postMessage({ type: 'ready' });
