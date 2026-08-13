/**
 * Scale adapter.
 *
 * The plant's indicator is not wired up yet, so this module defines the single
 * interface the weighing screen talks to. Swap the implementation once the
 * plant confirms how the indicator is reachable — nothing else has to change.
 *
 *   'manual'    — operator keys the weight (works today, no hardware)
 *   'bridge'    — a small agent on the weighing PC pushes readings over a
 *                 local websocket (typical for serial/USB indicators)
 *   'webserial' — the browser talks to the indicator directly (Chrome only)
 *
 * Set NEXT_PUBLIC_SCALE_MODE and NEXT_PUBLIC_SCALE_URL to switch.
 */

export type ScaleReading = {
  weightKg: number;
  stable: boolean;
  at: number;
};

export type ScaleStatus = "connecting" | "live" | "offline" | "manual";

export type ScaleAdapter = {
  mode: string;
  start(onReading: (r: ScaleReading) => void, onStatus: (s: ScaleStatus) => void): void;
  stop(): void;
};

export function getScaleMode(): string {
  return process.env.NEXT_PUBLIC_SCALE_MODE ?? "manual";
}

/** No hardware: the operator types the weight. */
function manualAdapter(): ScaleAdapter {
  return {
    mode: "manual",
    start(_onReading, onStatus) {
      onStatus("manual");
    },
    stop() {},
  };
}

/**
 * Local bridge agent. Expects newline-delimited JSON frames of the form
 * {"weightKg": 12.34, "stable": true} on a websocket.
 */
function bridgeAdapter(url: string): ScaleAdapter {
  let ws: WebSocket | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;

  return {
    mode: "bridge",
    start(onReading, onStatus) {
      const connect = () => {
        onStatus("connecting");
        try {
          ws = new WebSocket(url);
        } catch {
          onStatus("offline");
          retry = setTimeout(connect, 4000);
          return;
        }
        ws.onopen = () => onStatus("live");
        ws.onclose = () => {
          onStatus("offline");
          retry = setTimeout(connect, 4000);
        };
        ws.onerror = () => onStatus("offline");
        ws.onmessage = (ev) => {
          try {
            const d = JSON.parse(String(ev.data));
            if (typeof d.weightKg === "number") {
              onReading({ weightKg: d.weightKg, stable: Boolean(d.stable), at: Date.now() });
            }
          } catch {
            /* ignore malformed frames */
          }
        };
      };
      connect();
    },
    stop() {
      if (retry) clearTimeout(retry);
      ws?.close();
      ws = null;
    },
  };
}

export function createScaleAdapter(): ScaleAdapter {
  const mode = getScaleMode();
  const url = process.env.NEXT_PUBLIC_SCALE_URL ?? "ws://127.0.0.1:8787";
  if (mode === "bridge") return bridgeAdapter(url);
  return manualAdapter();
}
