const READ_METHODS = new Set(['Runtime.evaluate', 'Runtime.releaseObjectGroup', 'DOM.enable', 'DOM.disable', 'DOM.getDocument', 'DOM.requestNode', 'CSS.enable', 'CSS.disable', 'CSS.getMatchedStylesForNode']);

export async function discoverTargets(port = 9222) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(4000), redirect: 'error' });
  if (!response.ok) throw Error('CDP_UNAVAILABLE');
  const text = await response.text();
  if (text.length > 1_000_000) throw Error('CDP_TARGET_LIST_TOO_LARGE');
  const targets = JSON.parse(text);
  if (!Array.isArray(targets)) throw Error('CDP_INVALID_TARGET_LIST');
  const counts = { page: 0, 'tab-bar': 0 };
  return targets.flatMap(target => {
    try {
      if (target.type !== 'page') return [];
      const url = new URL(target.url);
      const isPage = url.origin === 'https://app.notion.com';
      const isTabBar = target.title === 'Tab Bar' && url.protocol === 'file:' && url.hostname === '' && /\/Notion\.app\/Contents\/Resources\/.*\/renderer\/tabs\/index\.html$/.test(url.pathname);
      if (!isPage && !isTabBar) return [];
      const socket = new URL(target.webSocketDebuggerUrl);
      if (socket.protocol !== 'ws:' || socket.hostname !== '127.0.0.1' || Number(socket.port) !== port || !/^\/devtools\/page\/[^/]+$/.test(socket.pathname) || socket.username || socket.password || socket.search || socket.hash) return [];
      const kind = isTabBar ? 'tab-bar' : 'page';
      // Raw titles, page URLs and target IDs are never included in saved metadata.
      return [{ renderer: `${kind}-${++counts[kind]}`, kind, socket: socket.href }];
    } catch { return []; }
  });
}

export async function connect(target) {
  const timeout = 5000;
  const socket = new WebSocket(target.socket);
  const pending = new Map(); let sequence = 0;
  const rejectPending = () => {
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(Error('CDP_CONNECTION_CLOSED')); }
    pending.clear();
  };
  socket.addEventListener('message', event => {
    let message; try { message = JSON.parse(event.data); } catch { rejectPending(); socket.close(); return; }
    const item = pending.get(message.id); if (!item) return;
    clearTimeout(item.timer); pending.delete(message.id);
    // Do not expose remote exception/error text, which can include private URLs.
    message.error ? item.reject(Error('CDP_METHOD_FAILED')) : item.resolve(message.result);
  });
  socket.addEventListener('close', rejectPending);
  socket.addEventListener('error', rejectPending);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.close(); reject(Error('CDP_CONNECT_TIMEOUT')); }, timeout);
    socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
    socket.addEventListener('error', () => { clearTimeout(timer); socket.close(); reject(Error('CDP_CONNECT_FAILED')); }, { once: true });
    socket.addEventListener('close', () => { clearTimeout(timer); reject(Error('CDP_CONNECTION_CLOSED')); }, { once: true });
  });
  return {
    send(method, params = {}) {
      if (!READ_METHODS.has(method)) return Promise.reject(Error('CDP_METHOD_NOT_ALLOWED'));
      if (method === 'Runtime.evaluate' && params.allowUnsafeEvalBlockedByCSP !== false) return Promise.reject(Error('CDP_CSP_BYPASS_NOT_ALLOWED'));
      if (socket.readyState !== WebSocket.OPEN) return Promise.reject(Error('CDP_CONNECTION_CLOSED'));
      return new Promise((resolve, reject) => {
        const id = ++sequence;
        const timer = setTimeout(() => { pending.delete(id); reject(Error('CDP_REQUEST_TIMEOUT')); }, timeout);
        pending.set(id, { resolve, reject, timer });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    close() { rejectPending(); socket.close(); },
  };
}
