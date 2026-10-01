export class CDP {
  constructor(url) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'ws:' || !['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)) throw new Error('CDP must use loopback');
    this.url = url; this.id = 0; this.pending = new Map(); this.listeners = new Set();
  }
  async connect() {
    this.socket = new WebSocket(this.url);
    this.socket.addEventListener('message', event => {
      let message; try { message = JSON.parse(String(event.data)); } catch { return; }
      const pending = this.pending.get(message.id);
      if (pending) {
        this.pending.delete(message.id); clearTimeout(pending.timer);
        message.error ? pending.reject(new Error(message.error.message)) : pending.resolve(message.result);
      } else for (const listener of this.listeners) listener(message);
    });
    this.socket.addEventListener('close', () => {
      for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error('CDP disconnected')); }
      this.pending.clear();
    });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.socket.close(); reject(new Error('CDP connection timeout')); }, 5000);
      this.socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      this.socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('CDP connection failed')); }, { once: true });
    });
    return this;
  }
  call(method, params = {}) {
    return new Promise((resolve, reject) => {
      if (this.socket?.readyState !== WebSocket.OPEN) return reject(new Error('CDP disconnected'));
      const id = ++this.id;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 15000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const result = await this.call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text + ': ' + (result.exceptionDetails.exception?.description || ''));
    return result.result?.value;
  }
  close() { this.socket?.close(); }
}
