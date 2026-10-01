import { createServer } from 'node:http';
import { AddressInfo } from 'node:net';

// The upstream page owns hover effects; blocking only LSP jumps cannot disable them.
export function bridgeHtml(html: string, upstream: string, token: string): string {
  return html.replaceAll('new URL("/", window.location.href)', `new URL("/", ${JSON.stringify(upstream)})`)
    .replaceAll('.hover .typst-text {', 'html.exercices-jumps .hover .typst-text {')
    .replaceAll('.typst-text:hover {', 'html.exercices-jumps .typst-text:hover {')
    .replace('</head>', `<style>html:not(.exercices-jumps) .typst-jump-ripple,html:not(.exercices-jumps) .typst-debug-react-ripple{display:none!important}</style>
<script>addEventListener('message',event=>{if(event.source!==parent||event.data?.token!==${JSON.stringify(token)})return;document.documentElement.classList.toggle('exercices-jumps',!!event.data.jumps);if(!event.data.jumps){document.querySelectorAll('.hover').forEach(e=>e.classList.remove('hover'));getSelection()?.removeAllRanges();}});</script></head>`);
}
export async function bridge(port: number, token: string): Promise<{ url: string; dispose(): void }> {
  const upstream = `http://127.0.0.1:${port}`;
  const server = createServer(async (request, response) => {
    try {
      if (request.url !== '/' + token) { response.writeHead(404).end(); return; }
      const remote = await fetch(upstream);
      if (!remote.ok) throw new Error('Aperçu indisponible');
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(bridgeHtml(await remote.text(), upstream, token));
    } catch { response.writeHead(502).end('Aperçu indisponible'); }
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/${token}`, dispose: () => { server.closeAllConnections(); server.close(); } };
}
