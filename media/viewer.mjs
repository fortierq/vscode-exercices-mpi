const vscode = acquireVsCodeApi();
const status = document.getElementById('status');
const frames = new Map();
for (const id of ['switch', 'save', 'source', 'sync', 'restart']) {
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
  document.getElementById('switch').textContent = data.variant === 'corrige' ? 'Corrigé ⇄' : 'Énoncé ⇄';
  status.hidden = frames.has(data.variant);
});
vscode.postMessage({ type: 'ready' });
