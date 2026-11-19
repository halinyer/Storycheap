"use client";

/**
 * Manages a tracked child Window reference for ZenoBank hosted checkouts.
 *
 * Why this exists:
 * ZenoBank's hosted page (pay.zenobank.io) only auto-redirects on exact-amount
 * matches. When a customer sends a Binance Pay overpayment (or any amount
 * reconciled directly by our Binance Pay API), ZenoBank leaves its checkout
 * page open indefinitely. By opening ZenoBank from our StoryCheap tab WITHOUT
 * `noopener` (while StoryCheap stays open on `/order/[id]` polling live status),
 * we retain cross-origin permission to set `childWin.location.href` and
 * automatically redirect that open ZenoBank tab straight to `/order/[id]` the
 * instant our server confirms the payment or overpayment.
 */

const ZENO_WINDOW_NAME = "storycheap_zenobank_pay";
const trackedWindows = new Map<string, Window>();
let lastTrackedWindow: Window | null = null;

function isUsableWindow(win: Window | null | undefined): win is Window {
  if (!win) return false;
  try {
    return !win.closed;
  } catch {
    return false;
  }
}

/**
 * Must be called synchronously inside a user click/submit event handler BEFORE
 * awaiting `/api/checkout` so browser popup blockers allow opening the tab.
 */
export function preOpenZenoWindow(): Window | null {
  if (typeof window === "undefined") return null;
  try {
    const win = window.open("", ZENO_WINDOW_NAME);
    if (!win) return null;

    // Render an immediate dark loading placeholder while /api/checkout responds
    try {
      win.document.open();
      win.document.write(`<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Conectando con ZenoBank · StoryCheap</title>
  <style>
    body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
      background:#090b10; color:#f8fafc; font-family:system-ui,-apple-system,sans-serif; padding:24px; }
    .card { max-width:420px; width:100%; border-radius:24px; background:#11131c;
      border:1px solid rgba(56,189,248,0.25); padding:32px; text-align:center; }
    .spinner { width:36px; height:36px; border:3px solid rgba(56,189,248,0.2);
      border-top-color:#38bdf8; border-radius:50%; margin:0 auto 18px;
      animation:spin 0.8s linear infinite; }
    @keyframes spin { to { transform:rotate(360deg); } }
    h1 { font-size:18px; margin:0 0 8px; font-weight:800; }
    p { font-size:13px; color:#94a3b8; margin:0; line-height:1.5; }
  </style>
</head>
<body>
  <div class="card">
    <div class="spinner"></div>
    <h1>Abriendo ZenoBank...</h1>
    <p>Tu orden en StoryCheap se está preparando. Cuando completes el pago (incluso con sobrepago en Binance Pay), te redirigiremos automáticamente a tu entrega.</p>
  </div>
</body>
</html>`);
      win.document.close();
    } catch {
      // Ignore cross-origin error if named window already points to an external origin
    }

    lastTrackedWindow = win;
    return win;
  } catch {
    return null;
  }
}

export function closeZenoWindow(win: Window | null | undefined): void {
  if (!win) return;
  try {
    if (!win.closed) {
      win.close();
    }
  } catch {
    // Ignore close errors
  }
  if (lastTrackedWindow === win) {
    lastTrackedWindow = null;
  }
  for (const [key, value] of trackedWindows.entries()) {
    if (value === win) {
      trackedWindows.delete(key);
    }
  }
}

/**
 * Navigates an already pre-opened ZenoBank tab (or opens a new one if needed)
 * and tracks it under `orderId`.
 */
export function navigateZenoWindow(
  orderId: string,
  preOpened: Window | null,
  checkoutUrl: string
): boolean {
  if (typeof window === "undefined") return false;
  let win = isUsableWindow(preOpened) ? preOpened : null;
  if (!win) {
    try {
      win = window.open(checkoutUrl, ZENO_WINDOW_NAME);
    } catch {
      win = null;
    }
  } else {
    try {
      win.location.href = checkoutUrl;
      win.focus();
    } catch {
      win = null;
    }
  }

  if (isUsableWindow(win)) {
    trackedWindows.set(orderId, win);
    lastTrackedWindow = win;
    return true;
  }
  return false;
}

/**
 * Opens ZenoBank directly from a user click on `/order/[id]` and tracks the tab.
 */
export function openAndTrackZenoWindow(
  orderId: string,
  checkoutUrl: string
): boolean {
  if (typeof window === "undefined") return false;
  try {
    const win = window.open(checkoutUrl, ZENO_WINDOW_NAME);
    if (isUsableWindow(win)) {
      try {
        win.focus();
      } catch {
        // Ignore focus errors
      }
      trackedWindows.set(orderId, win);
      lastTrackedWindow = win;
      return true;
    }
  } catch {
    // Ignore
  }
  return false;
}

export function hasTrackedZenoWindow(orderId: string): boolean {
  const win = trackedWindows.get(orderId) ?? lastTrackedWindow;
  return isUsableWindow(win);
}

/**
 * Redirects the open ZenoBank checkout tab straight back to `/order/[id]`
 * once payment (or Binance Pay overpayment) is confirmed by StoryCheap.
 * Returns true if an open ZenoBank window was redirected.
 */
export function redirectZenoWindowToOrder(orderId: string): boolean {
  if (typeof window === "undefined") return false;
  const win = trackedWindows.get(orderId) ?? lastTrackedWindow;
  if (!isUsableWindow(win)) {
    trackedWindows.delete(orderId);
    if (lastTrackedWindow === win) lastTrackedWindow = null;
    return false;
  }

  const targetUrl = `${window.location.origin}/order/${encodeURIComponent(orderId)}?settled=1`;
  try {
    win.location.href = targetUrl;
    try {
      win.focus();
    } catch {
      // Some browsers restrict focus() outside user gesture; redirect still succeeds
    }
    trackedWindows.delete(orderId);
    if (lastTrackedWindow === win) lastTrackedWindow = null;
    return true;
  } catch {
    return false;
  }
}
