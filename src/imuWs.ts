export type IMUSample = { y: number; p: number; r: number; ax: number; ay: number; az: number; am: number };
export type WsConn = { close: () => void };

export function connectIMUWS(
  url: string,
  onSample: (s: IMUSample) => void,
  onStatus?: (s: 'connecting' | 'connected' | 'closed' | 'error') => void
): WsConn {
  const ws = new WebSocket(url);
  onStatus?.('connecting');
  ws.onopen = () => onStatus?.('connected');
  ws.onmessage = e => {
    try {
      const parsed = JSON.parse(String(e.data)) as Partial<IMUSample>;
      if (typeof parsed.y === 'number') {
        onSample({
          y: parsed.y || 0,
          p: parsed.p || 0,
          r: parsed.r || 0,
          ax: parsed.ax || 0,
          ay: parsed.ay || 0,
          az: parsed.az || 0,
          am: parsed.am || 0,
        });
      }
    } catch {}
  };
  ws.onerror = () => onStatus?.('error');
  ws.onclose = () => onStatus?.('closed');
  return { close: () => { try { ws.close(); } catch {} } };
}


