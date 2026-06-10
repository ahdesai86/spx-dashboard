import { useState, useEffect, useRef, useCallback } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// CONFIG
// Local dev:   SERVER = "http://localhost:3001"
// Production:  SERVER = "https://your-app.up.railway.app"
// ─────────────────────────────────────────────────────────────────────────────
const SERVER    = typeof window !== "undefined" && window.location.hostname === "localhost"
  ? "http://localhost:3001"
  : "https://spy-command-production.up.railway.app";
const DEMO_MODE = !SERVER;

// ── Demo data ─────────────────────────────────────────────────────────────────
const DEMO_GEX = {
  regime: "positive",
  gammaFlip: 591.00,
  netGex: 2847000000,
  spotPrice: 592.45,
  callWalls: [
    { price: 595, gex: 1820000 },
    { price: 597, gex: 1240000 },
    { price: 600, gex: 980000  },
  ],
  putWalls: [
    { price: 589, gex: 1650000 },
    { price: 587, gex: 1120000 },
    { price: 585, gex: 870000  },
  ],
  updatedAt: new Date().toISOString(),
  source: "alpaca-calculated",
};

const DEMO_SIGNALS = [
  {
    id: 1001,
    time: "09:47:22",
    symbol: "SPY", direction: "LONG", right: "C",
    strike: 592, spyEntry: 592.30,
    stop: 590.20, tp1: 595.00, tp2: 597.00,
    gexTarget: 595, gexReason: "LONG → call wall $595 | regime: positive",
    expiry: "20260610",
    contracts: 2, midPrice: 1.85, totalCost: 370, fillPrice: 1.87,
    stopPrice: 0.94, tp1Price: 3.74,
    optionSymbol: "SPY260610C00592000",
    trigger: "ORB Breakout + VWAP", confidence: "HIGH",
    status: "FILLED", trailedToBreakeven: false,
    rr: "2.4:1",
  },
  {
    id: 1002,
    time: "10:23:11",
    symbol: "SPY", direction: "SHORT", right: "P",
    strike: 590, spyEntry: 590.10,
    stop: 592.00, tp1: 587.00, tp2: 585.00,
    gexTarget: 587, gexReason: "SHORT → put wall $587 | regime: positive",
    expiry: "20260610",
    contracts: 2, midPrice: 1.65, totalCost: 330, fillPrice: 1.68,
    stopPrice: 0.84, tp1Price: 3.36,
    optionSymbol: "SPY260610P00590000",
    trigger: "VWAP Rejection + ORB Fade", confidence: "MEDIUM",
    status: "PENDING", trailedToBreakeven: false,
    rr: "1.8:1",
  },
];

const DEMO_LOGS = [
  { time: "09:25:10", tag: "GEX",    msg: "Calculated ✓ Regime: POSITIVE | Flip: $591.00 | Net: +$2,847M" },
  { time: "09:30:00", tag: "ALPACA", msg: "Connected — PAPER | Balance: $100,000 | Buying power: $400,000" },
  { time: "09:47:20", tag: "WEBHOOK",msg: '{"symbol":"SPY","direction":"LONG","entry":592.3}' },
  { time: "09:47:21", tag: "GEX",    msg: "Signal ALLOWED — LONG → call wall $595" },
  { time: "09:47:22", tag: "AUTO",   msg: "Executing #1001 | LONG SPY $592 C" },
  { time: "09:47:23", tag: "ALPACA", msg: "Mid price: $1.85 | Contracts: 2 | Total: $370" },
  { time: "09:47:26", tag: "FILL",   msg: "Filled @ $1.87 | placing exits..." },
  { time: "09:47:27", tag: "EXIT",   msg: "Stop $0.94 | TP1 $3.74" },
];

// ── Colors ────────────────────────────────────────────────────────────────────
const T = {
  bg:       "#07090c",
  panel:    "#0c1017",
  border:   "#151d28",
  accent:   "#e8f4fd",
  bull:     "#2dd4a0",
  bear:     "#f05b6d",
  yellow:   "#f5c842",
  purple:   "#9d7ff5",
  blue:     "#4db8ff",
  dim:      "#2a3545",
  muted:    "#4a5e74",
  text:     "#d4e4f4",
  textDim:  "#5a7a94",
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtPnl(v) {
  if (v == null) return null;
  return (v >= 0 ? "+" : "") + "$" + Math.abs(v).toFixed(0);
}
function fmtGex(v) {
  if (!v) return "—";
  const m = Math.abs(v) / 1e6;
  return (v >= 0 ? "+" : "-") + "$" + m.toFixed(0) + "M";
}
function fmtExpiry(raw) {
  if (!raw || raw.length !== 8) return raw || "—";
  return raw.slice(4,6) + "/" + raw.slice(6) + "/" + raw.slice(0,4);
}
function getETTime() {
  return new Date().toLocaleTimeString("en-US", { hour12: false, timeZone: "America/New_York" });
}
function getETDate() {
  return new Date().toLocaleDateString("en-US", { timeZone: "America/New_York", month:"short", day:"numeric", year:"numeric" });
}

// ── API ───────────────────────────────────────────────────────────────────────
async function apiCall(method, path) {
  if (DEMO_MODE) return { status: "demo" };
  const r = await fetch(SERVER + path, { method });
  if (!r.ok) { const e = await r.json().catch(()=>({})); throw new Error(e.error || r.status); }
  return r.json();
}

// ── SSE ───────────────────────────────────────────────────────────────────────
function useSSE(onEvent) {
  const esRef = useRef(null);
  const cbRef = useRef(onEvent);
  cbRef.current = onEvent;
  const connect = useCallback(() => {
    if (DEMO_MODE) return;
    if (esRef.current) esRef.current.close();
    const es = new EventSource(SERVER + "/events");
    esRef.current = es;
    es.onmessage = e => { try { cbRef.current(JSON.parse(e.data)); } catch(_) {} };
    es.onerror   = () => { es.close(); setTimeout(connect, 3000); };
  }, []);
  useEffect(() => { connect(); return () => esRef.current?.close(); }, [connect]);
  return { reconnect: connect };
}

// ── GEX Visualizer ────────────────────────────────────────────────────────────
function GEXPanel({ gex, compact }) {
  if (!gex) return (
    <div style={{ padding: compact ? "12px 16px" : "20px 24px",
      background: T.panel, border: "1px solid " + T.border,
      borderRadius: 10, height: compact ? "auto" : 280,
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", gap: 8 }}>
      <div style={{ color: T.dim, fontSize: 28 }}>◎</div>
      <div style={{ color: T.muted, fontSize: 11, fontFamily: "monospace", textAlign: "center" }}>
        GEX calculates at 9:25 AM ET
      </div>
      <div style={{ color: T.dim, fontSize: 10, fontFamily: "monospace" }}>
        From Alpaca option chain
      </div>
    </div>
  );

  const isPositive = gex.regime === "positive";
  const regimeColor = isPositive ? T.bull : T.bear;
  const spot = gex.spotPrice || 0;

  // Build visual wall bars
  const allLevels = [
    ...gex.callWalls.map(w => ({ ...w, type: "call" })),
    ...gex.putWalls.map(w => ({ ...w, type: "put"  })),
  ].sort((a, b) => b.price - a.price);

  const maxGex = Math.max(...allLevels.map(w => w.gex), 1);

  return (
    <div style={{ background: T.panel, border: "1px solid " + T.border,
      borderRadius: 10, overflow: "hidden" }}>

      {/* Header */}
      <div style={{ padding: "12px 16px",
        borderBottom: "1px solid " + T.border,
        display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%",
            background: regimeColor,
            boxShadow: "0 0 8px " + regimeColor,
            animation: "pip 2s infinite" }} />
          <span style={{ color: T.text, fontSize: 12, fontFamily: "monospace", fontWeight: 700 }}>
            GEX · {gex.regime.toUpperCase()} REGIME
          </span>
        </div>
        <div style={{ display: "flex", gap: 16 }}>
          <div style={{ textAlign: "right" }}>
            <div style={{ color: T.muted, fontSize: 9, fontFamily: "monospace", letterSpacing: 1 }}>NET GEX</div>
            <div style={{ color: regimeColor, fontSize: 13, fontFamily: "monospace", fontWeight: 700 }}>
              {fmtGex(gex.netGex)}
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ color: T.muted, fontSize: 9, fontFamily: "monospace", letterSpacing: 1 }}>FLIP</div>
            <div style={{ color: T.yellow, fontSize: 13, fontFamily: "monospace", fontWeight: 700 }}>
              ${gex.gammaFlip}
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ color: T.muted, fontSize: 9, fontFamily: "monospace", letterSpacing: 1 }}>SPY SPOT</div>
            <div style={{ color: T.text, fontSize: 13, fontFamily: "monospace", fontWeight: 700 }}>
              ${spot.toFixed(2)}
            </div>
          </div>
        </div>
      </div>

      {/* GEX Regime explanation */}
      <div style={{ padding: "8px 16px",
        background: regimeColor + "08",
        borderBottom: "1px solid " + T.border }}>
        <span style={{ color: regimeColor, fontSize: 10, fontFamily: "monospace" }}>
          {isPositive
            ? "▲ POSITIVE GEX — Dealers long gamma · Price magnetic to walls · Range-bound expected"
            : "▼ NEGATIVE GEX — Dealers short gamma · Moves amplified · Trending conditions"}
        </span>
      </div>

      {/* Wall bars */}
      <div style={{ padding: "12px 16px" }}>
        <div style={{ display: "flex", justifyContent: "space-between",
          marginBottom: 8 }}>
          <span style={{ color: T.muted, fontSize: 9, fontFamily: "monospace", letterSpacing: 1 }}>
            STRIKE LEVEL
          </span>
          <span style={{ color: T.muted, fontSize: 9, fontFamily: "monospace", letterSpacing: 1 }}>
            GEX MAGNITUDE
          </span>
        </div>

        {allLevels.map((wall, i) => {
          const isCall    = wall.type === "call";
          const color     = isCall ? T.bull : T.bear;
          const barWidth  = (wall.gex / maxGex) * 100;
          const isAbove   = wall.price > spot;
          const isBelow   = wall.price < spot;
          const isNearest = i === 0 || (isAbove && i === allLevels.findIndex(w => w.price > spot)) ||
                            (isBelow && i === allLevels.findIndex(w => w.price < spot));

          return (
            <div key={i} style={{ marginBottom: 6 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {/* Strike label */}
                <div style={{ width: 52, textAlign: "right",
                  color: isNearest ? color : T.muted,
                  fontSize: 11, fontFamily: "monospace", fontWeight: isNearest ? 700 : 400,
                  flexShrink: 0 }}>
                  ${wall.price}
                </div>

                {/* Type badge */}
                <div style={{ width: 30, textAlign: "center",
                  background: color + "18",
                  border: "1px solid " + color + "33",
                  borderRadius: 3, padding: "1px 4px",
                  color, fontSize: 8, fontFamily: "monospace",
                  flexShrink: 0 }}>
                  {isCall ? "CALL" : "PUT"}
                </div>

                {/* Bar */}
                <div style={{ flex: 1, height: 14,
                  background: T.dim, borderRadius: 2,
                  overflow: "hidden", position: "relative" }}>
                  <div style={{
                    width: barWidth + "%", height: "100%",
                    background: isNearest
                      ? color
                      : color + "66",
                    borderRadius: 2,
                    transition: "width 0.5s ease",
                  }} />
                  {/* Spot line overlay */}
                </div>

                {/* GEX value */}
                <div style={{ width: 52, color: T.muted,
                  fontSize: 9, fontFamily: "monospace", flexShrink: 0 }}>
                  ${(wall.gex/1e6).toFixed(1)}M
                </div>

                {/* Nearest indicator */}
                {isNearest && (
                  <div style={{ color, fontSize: 9,
                    fontFamily: "monospace", flexShrink: 0 }}>
                    {isCall ? "▲ target" : "▼ target"}
                  </div>
                )}
              </div>

              {/* Spot price line between above/below */}
              {i < allLevels.length - 1 &&
               allLevels[i].price > spot &&
               allLevels[i+1].price <= spot && (
                <div style={{ display: "flex", alignItems: "center",
                  gap: 8, margin: "6px 0" }}>
                  <div style={{ width: 52 }} />
                  <div style={{ width: 30 }} />
                  <div style={{ flex: 1, display: "flex",
                    alignItems: "center", gap: 6 }}>
                    <div style={{ flex: 1, height: 1,
                      background: T.yellow + "44" }} />
                    <span style={{ color: T.yellow, fontSize: 9,
                      fontFamily: "monospace", whiteSpace: "nowrap" }}>
                      SPY ${spot.toFixed(2)} ← HERE
                    </span>
                    <div style={{ flex: 1, height: 1,
                      background: T.yellow + "44" }} />
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Compare hint */}
      <div style={{ padding: "8px 16px",
        borderTop: "1px solid " + T.border,
        display: "flex", justifyContent: "space-between",
        alignItems: "center" }}>
        <span style={{ color: T.dim, fontSize: 9, fontFamily: "monospace" }}>
          Source: Alpaca option chain (self-calculated)
        </span>
        <span style={{ color: T.muted, fontSize: 9, fontFamily: "monospace" }}>
          Compare → TradeEcho / Unusual Whales
        </span>
        <span style={{ color: T.dim, fontSize: 9, fontFamily: "monospace" }}>
          Updated: {gex.updatedAt ? new Date(gex.updatedAt).toLocaleTimeString("en-US", { hour12: false, timeZone: "America/New_York" }) + " ET" : "—"}
        </span>
      </div>
    </div>
  );
}

// ── Signal Card ───────────────────────────────────────────────────────────────
function SignalCard({ signal, onCancel }) {
  const [cancelBusy, setCancelBusy] = useState(false);

  const isLong    = signal.direction === "LONG";
  const dirColor  = isLong ? T.bull : T.bear;
  const isClosed  = ["STOPPED","EOD_CLOSED","CANCELLED","TP1_HIT"].includes(signal.status);
  const isActive  = ["FILLED","TP1_HIT"].includes(signal.status);
  const isPending = signal.status === "PENDING";
  const isSent    = signal.status === "SENT" || signal.status === "EXECUTING";

  const statusColors = {
    PENDING:    T.yellow,
    EXECUTING:  T.blue,
    SENT:       T.purple,
    FILLED:     T.bull,
    TP1_HIT:    T.bull,
    STOPPED:    T.bear,
    EOD_CLOSED: T.muted,
    CANCELLED:  T.dim,
  };
  const statusLabels = {
    PENDING:    "PENDING",
    EXECUTING:  "PLACING ORDER...",
    SENT:       "ORDER SENT",
    FILLED:     "LIVE",
    TP1_HIT:    "TP1 HIT ✓",
    STOPPED:    "STOPPED ✗",
    EOD_CLOSED: "EOD CLOSED",
    CANCELLED:  "CANCELLED",
  };

  const sColor = statusColors[signal.status] || T.muted;
  const pnl    = signal.closePnl;
  const unrealizedPct = signal.fillPrice
    ? (((signal.midPrice || signal.fillPrice) - signal.fillPrice) / signal.fillPrice * 100).toFixed(1)
    : null;

  const doCancel = async () => {
    setCancelBusy(true);
    try { await onCancel(signal.id); } finally { setCancelBusy(false); }
  };

  return (
    <div style={{
      background: T.panel,
      border: "1px solid " + (isClosed ? T.dim : dirColor + "33"),
      borderLeft: "3px solid " + (isClosed ? T.dim : dirColor),
      borderRadius: 9, padding: "14px 16px",
      opacity: isClosed ? 0.6 : 1,
      transition: "opacity 0.3s",
    }}>
      {/* Header row */}
      <div style={{ display: "flex", justifyContent: "space-between",
        alignItems: "flex-start", marginBottom: 12 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center",
            gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
            <span style={{ fontFamily: "monospace", fontSize: 16,
              fontWeight: 700, color: T.text, letterSpacing: 2 }}>
              SPY
            </span>
            <span style={{ background: dirColor + "18", color: dirColor,
              border: "1px solid " + dirColor + "33",
              borderRadius: 3, padding: "1px 8px",
              fontSize: 10, fontFamily: "monospace", fontWeight: 700 }}>
              {signal.direction}
            </span>
            <span style={{ color: T.textDim, fontSize: 12,
              fontFamily: "monospace" }}>
              ${signal.strike} {signal.right === "C" ? "CALL" : "PUT"}
            </span>
            {signal.confidence && (
              <span style={{ background: T.dim, color: T.muted,
                borderRadius: 3, padding: "1px 6px",
                fontSize: 9, fontFamily: "monospace" }}>
                {signal.confidence}
              </span>
            )}
            {pnl != null && (
              <span style={{ background: (pnl >= 0 ? T.bull : T.bear) + "18",
                color: pnl >= 0 ? T.bull : T.bear,
                border: "1px solid " + (pnl >= 0 ? T.bull : T.bear) + "33",
                borderRadius: 3, padding: "1px 8px",
                fontSize: 10, fontFamily: "monospace", fontWeight: 700 }}>
                {fmtPnl(pnl)}
              </span>
            )}
          </div>
          <div style={{ color: T.textDim, fontSize: 10,
            fontFamily: "monospace" }}>
            {signal.trigger} · {signal.time} ET
          </div>
        </div>
        <div style={{ background: sColor + "15", color: sColor,
          border: "1px solid " + sColor + "30",
          borderRadius: 4, padding: "3px 10px",
          fontSize: 9, fontFamily: "monospace",
          display: "flex", alignItems: "center", gap: 5,
          flexShrink: 0 }}>
          {isActive && <div style={{ width: 5, height: 5,
            borderRadius: "50%", background: sColor,
            animation: "pip 1.5s infinite" }} />}
          {statusLabels[signal.status] || signal.status}
        </div>
      </div>

      {/* Option symbol */}
      {signal.optionSymbol && (
        <div style={{ marginBottom: 10, padding: "5px 10px",
          background: T.bg, borderRadius: 4,
          border: "1px solid " + T.border }}>
          <span style={{ color: T.muted, fontSize: 9,
            fontFamily: "monospace", letterSpacing: 1 }}>CONTRACT </span>
          <span style={{ color: T.purple, fontSize: 11,
            fontFamily: "monospace" }}>{signal.optionSymbol}</span>
          {signal.contracts && (
            <>
              <span style={{ color: T.dim, fontSize: 9,
                fontFamily: "monospace" }}> · </span>
              <span style={{ color: T.text, fontSize: 11,
                fontFamily: "monospace" }}>x{signal.contracts}</span>
            </>
          )}
          {signal.totalCost && (
            <>
              <span style={{ color: T.dim, fontSize: 9,
                fontFamily: "monospace" }}> · total cost </span>
              <span style={{ color: T.yellow, fontSize: 11,
                fontFamily: "monospace" }}>${signal.totalCost}</span>
            </>
          )}
        </div>
      )}

      {/* Price grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)",
        gap: 4, marginBottom: 8 }}>
        {[
          { k: "ENTRY",    v: signal.spyEntry ? "$" + signal.spyEntry?.toFixed(2) : "—", c: T.text  },
          { k: "STOP",     v: signal.stop ? "$" + signal.stop?.toFixed(2) : "—",          c: T.bear  },
          { k: "TP1",      v: signal.tp1  ? "$" + signal.tp1?.toFixed(2)  : "—",          c: T.blue  },
          { k: "TP2",      v: signal.tp2  ? "$" + signal.tp2?.toFixed(2)  : "—",          c: T.purple},
        ].map(({ k, v, c }) => (
          <div key={k} style={{ background: T.bg, borderRadius: 4,
            padding: "7px 9px", border: "1px solid " + T.border }}>
            <div style={{ color: T.dim, fontSize: 8,
              fontFamily: "monospace", letterSpacing: 1, marginBottom: 3 }}>{k}</div>
            <div style={{ color: c, fontSize: 12,
              fontFamily: "monospace", fontWeight: 600 }}>{v}</div>
          </div>
        ))}
      </div>

      {/* Premium grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)",
        gap: 4, marginBottom: 10 }}>
        {[
          { k: "PREM PAID",  v: signal.fillPrice ? "$" + signal.fillPrice?.toFixed(2) : signal.midPrice ? "$" + signal.midPrice?.toFixed(2) : "—", c: T.text  },
          { k: "PREM STOP",  v: signal.stopPrice ? "$" + signal.stopPrice?.toFixed(2) : "—",  c: T.bear  },
          { k: "PREM TP1",   v: signal.tp1Price  ? "$" + signal.tp1Price?.toFixed(2)  : "—",  c: T.blue  },
          { k: "R:R",        v: signal.rr || "—",                                              c: T.yellow},
        ].map(({ k, v, c }) => (
          <div key={k} style={{ background: T.bg, borderRadius: 4,
            padding: "7px 9px",
            border: "1px dashed " + T.border }}>
            <div style={{ color: T.dim, fontSize: 8,
              fontFamily: "monospace", letterSpacing: 1, marginBottom: 3 }}>{k}</div>
            <div style={{ color: c, fontSize: 12,
              fontFamily: "monospace", fontWeight: 600 }}>{v}</div>
          </div>
        ))}
      </div>

      {/* GEX target */}
      {signal.gexReason && (
        <div style={{ padding: "6px 10px", marginBottom: 10,
          background: T.dim + "44", borderRadius: 4,
          border: "1px solid " + T.dim }}>
          <span style={{ color: T.muted, fontSize: 9,
            fontFamily: "monospace", letterSpacing: 1 }}>GEX </span>
          <span style={{ color: T.textDim, fontSize: 10,
            fontFamily: "monospace" }}>{signal.gexReason}</span>
        </div>
      )}

      {/* Trail status */}
      {signal.trailedToBreakeven && (
        <div style={{ padding: "6px 10px", marginBottom: 10,
          background: T.bull + "08",
          border: "1px solid " + T.bull + "20",
          borderRadius: 4 }}>
          <span style={{ color: T.bull, fontSize: 10,
            fontFamily: "monospace" }}>
            ✓ Stop trailed to breakeven ${signal.fillPrice?.toFixed(2)}
          </span>
        </div>
      )}

      {/* Status bar */}
      {isActive && (
        <div style={{ display: "flex", alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 10px",
          background: T.bull + "08",
          border: "1px solid " + T.bull + "20",
          borderRadius: 5 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ width: 5, height: 5, borderRadius: "50%",
              background: T.bull, animation: "pip 1.5s infinite" }} />
            <span style={{ color: T.bull, fontSize: 10,
              fontFamily: "monospace" }}>
              {DEMO_MODE
                ? "Position live · bracket orders active"
                : "Live on Alpaca · stop + TP1 active"}
            </span>
          </div>
          <button onClick={doCancel} disabled={cancelBusy} style={{
            background: T.bear + "0f",
            border: "1px solid " + T.bear + "30",
            borderRadius: 4, color: T.bear,
            padding: "2px 8px", fontSize: 9,
            fontFamily: "monospace", cursor: "pointer",
          }}>
            {cancelBusy ? "..." : "CLOSE"}
          </button>
        </div>
      )}

      {isSent && (
        <div style={{ padding: "8px 10px",
          background: T.purple + "08",
          border: "1px solid " + T.purple + "20",
          borderRadius: 5, color: T.purple,
          fontFamily: "monospace", fontSize: 10 }}>
          ⟳ Order sent to Alpaca · waiting for fill...
        </div>
      )}

      {isPending && (
        <div style={{ display: "flex", gap: 6 }}>
          <div style={{ flex: 1, padding: "8px",
            background: T.dim + "44",
            border: "1px solid " + T.border,
            borderRadius: 5, color: T.muted,
            fontFamily: "monospace", fontSize: 10,
            textAlign: "center" }}>
            Waiting for auto-execute...
          </div>
          <button onClick={doCancel} style={{
            padding: "8px 14px",
            background: "transparent",
            border: "1px solid " + T.bear + "30",
            borderRadius: 5, color: T.bear,
            fontFamily: "monospace", fontSize: 10,
            cursor: "pointer",
          }}>✕ SKIP</button>
        </div>
      )}

      {isClosed && (
        <div style={{ padding: "8px 10px",
          background: sColor + "08",
          border: "1px solid " + sColor + "20",
          borderRadius: 5, color: sColor,
          fontFamily: "monospace", fontSize: 10 }}>
          {signal.status === "TP1_HIT"   && "✓ Target hit · Position closed"}
          {signal.status === "STOPPED"   && "✗ Stop triggered · Position closed"}
          {signal.status === "EOD_CLOSED"&& "⏱ Force closed at 3:45 PM ET"}
          {signal.status === "CANCELLED" && "— Cancelled · No position taken"}
        </div>
      )}
    </div>
  );
}

// ── Log Feed ──────────────────────────────────────────────────────────────────
function LogFeed({ logs }) {
  const ref = useRef();
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [logs]);

  const TC = {
    GEX: T.bull, "GEX ERR": T.bear, ALPACA: T.blue,
    WEBHOOK: T.yellow, SIGNAL: T.bull, AUTO: T.purple,
    FILL: T.bull, EXIT: T.blue, TRAIL: T.bull,
    STOP: T.bear, TP1: T.bull, EOD: T.yellow,
    ERROR: T.bear, CANCEL: T.bear, SYNC: T.muted,
    GUARD: T.bear, WARN: T.yellow, PRICE: T.blue,
  };

  return (
    <div style={{ background: T.panel,
      border: "1px solid " + T.border,
      borderRadius: 10, padding: 14,
      height: 180 }}>
      <div style={{ display: "flex", justifyContent: "space-between",
        marginBottom: 8 }}>
        <span style={{ color: T.muted, fontSize: 9,
          fontFamily: "monospace", letterSpacing: 2 }}>
          LIVE LOG · RAILWAY → ALPACA
        </span>
        <span style={{ color: T.dim, fontSize: 9,
          fontFamily: "monospace" }}>{logs.length} events</span>
      </div>
      <div ref={ref} style={{ overflowY: "auto", height: 132 }}>
        {logs.length === 0
          ? <div style={{ color: T.dim, fontSize: 10,
              fontFamily: "monospace" }}>
              {DEMO_MODE ? "Demo mode — sample logs shown above" : "Connecting to server..."}
            </div>
          : [...logs].reverse().map((l, i) => (
              <div key={i} style={{ fontSize: 10, fontFamily: "monospace",
                marginBottom: 3, display: "flex", gap: 8,
                animation: i === 0 ? "fadein 0.2s ease" : "none" }}>
                <span style={{ color: T.dim, flexShrink: 0 }}>{l.time}</span>
                <span style={{ color: TC[l.tag] || T.muted, flexShrink: 0,
                  minWidth: 60 }}>[{l.tag}]</span>
                <span style={{ color: T.textDim }}>{l.msg}</span>
              </div>
            ))
        }
      </div>
    </div>
  );
}

// ── P&L Bar ───────────────────────────────────────────────────────────────────
function PnLBar({ sessionPnL, dailyLoss, accountSize, riskBudget, signals }) {
  const pnlColor  = sessionPnL >= 0 ? T.bull : T.bear;
  const lossLimit = accountSize * 0.06;
  const lossPct   = lossLimit > 0 ? Math.min(100, (dailyLoss / lossLimit) * 100) : 0;
  const wins      = signals.filter(s => (s.closePnl || 0) > 0).length;
  const losses    = signals.filter(s => (s.closePnl || 0) < 0).length;
  const total     = wins + losses;
  const winRate   = total > 0 ? Math.round((wins / total) * 100) : null;

  return (
    <div style={{ display: "grid",
      gridTemplateColumns: "repeat(6,1fr)",
      background: T.panel,
      border: "1px solid " + T.border,
      borderRadius: 10, overflow: "hidden",
      marginBottom: 14 }}>
      {[
        { k: "SESSION P&L",   v: (sessionPnL >= 0 ? "+" : "") + "$" + Math.abs(sessionPnL).toFixed(0), c: pnlColor },
        { k: "DAILY LOSS",    v: "$" + dailyLoss.toFixed(0), c: dailyLoss > 0 ? T.bear : T.dim },
        { k: "LOSS LIMIT",    v: "$" + lossLimit.toFixed(0), c: T.muted },
        { k: "RISK/TRADE",    v: "$" + (riskBudget || 500).toFixed(0), c: T.yellow },
        { k: "WIN RATE",      v: winRate != null ? winRate + "%" : "—", c: T.blue },
        { k: "TRADES",        v: total > 0 ? wins + "W / " + losses + "L" : "—", c: T.muted },
      ].map(({ k, v, c }, i) => (
        <div key={k} style={{ padding: "11px 14px",
          borderRight: i < 5 ? "1px solid " + T.border : "none" }}>
          <div style={{ color: T.dim, fontSize: 8,
            fontFamily: "monospace", letterSpacing: 1.2,
            marginBottom: 4 }}>{k}</div>
          <div style={{ color: c, fontSize: 13,
            fontFamily: "monospace", fontWeight: 700 }}>{v}</div>
        </div>
      ))}
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function App() {
  const [signals,    setSignals]    = useState(DEMO_MODE ? DEMO_SIGNALS : []);
  const [logs,       setLogs]       = useState(DEMO_MODE ? DEMO_LOGS    : []);
  const [gex,        setGex]        = useState(DEMO_MODE ? DEMO_GEX     : null);
  const [alpacaOk,   setAlpacaOk]   = useState(false);
  const [sseOk,      setSseOk]      = useState(false);
  const [sessionPnL, setSessionPnL] = useState(0);
  const [dailyLoss,  setDailyLoss]  = useState(0);
  const [riskBudget, setRiskBudget] = useState(500);
  const [clock,      setClock]      = useState("");
  const [activeTab,  setActiveTab]  = useState("signals"); // signals | gex
  const accountSize = 100000;

  useEffect(() => {
    const t = () => setClock(getETTime() + " ET");
    t(); const id = setInterval(t, 1000); return () => clearInterval(id);
  }, []);

  const handleEvent = useCallback(ev => {
    setSseOk(true);
    switch (ev.type) {
      case "init":
        if (ev.signals)    setSignals(ev.signals);
        if (ev.gex)        setGex(ev.gex);
        if (ev.riskBudget) setRiskBudget(ev.riskBudget);
        setSessionPnL(parseFloat(ev.sessionPnL) || 0);
        setDailyLoss(parseFloat(ev.dailyLoss)   || 0);
        break;
      case "alpaca_status": setAlpacaOk(ev.connected); break;
      case "gex_update":    setGex(ev); break;
      case "new_signal":    setSignals(p => [ev.signal, ...p]); break;
      case "signal_update":
        setSignals(p => p.map(s => s.id === ev.id ? { ...s, ...ev } : s));
        if (ev.pnl != null) {
          setSessionPnL(p => p + ev.pnl);
          if (ev.pnl < 0) setDailyLoss(p => p + Math.abs(ev.pnl));
        }
        break;
      case "log":
        setLogs(p => [...p.slice(-299), ev]);
        break;
    }
  }, []);

  useSSE(handleEvent);

  const handleCancel = async (id) => {
    await apiCall("POST", "/cancel/" + id);
    if (DEMO_MODE) setSignals(p => p.map(s => s.id === id ? { ...s, status: "CANCELLED" } : s));
  };

  const handleForceClose = async () => {
    await apiCall("POST", "/closeall");
  };

  const pending = signals.filter(s => s.status === "PENDING").length;
  const active  = signals.filter(s => ["SENT","FILLED","TP1_HIT","EXECUTING"].includes(s.status)).length;
  const closed  = signals.filter(s => ["STOPPED","EOD_CLOSED","CANCELLED"].includes(s.status)).length;

  return (
    <div style={{ minHeight: "100vh", background: T.bg, color: T.text }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;700&family=Space+Mono:wght@400;700&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: ${T.bg}; }
        @keyframes pip  { 0%,100%{opacity:1} 50%{opacity:0.2} }
        @keyframes fadein { from{opacity:0;transform:translateY(3px)} to{opacity:1;transform:none} }
        ::-webkit-scrollbar { width: 3px; }
        ::-webkit-scrollbar-thumb { background: ${T.dim}; border-radius: 2px; }
        button { transition: filter 0.15s; }
        button:hover:not(:disabled) { filter: brightness(1.2); }
      `}</style>

      {/* Top bar */}
      <div style={{ background: T.panel,
        borderBottom: "1px solid " + T.border,
        padding: "10px 20px",
        display: "flex", alignItems: "center",
        justifyContent: "space-between",
        position: "sticky", top: 0, zIndex: 100 }}>

        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          {/* Logo */}
          <div>
            <div style={{ fontFamily: "'Space Grotesk', sans-serif",
              fontSize: 17, fontWeight: 700,
              color: T.text, letterSpacing: 0.5 }}>
              <span style={{ color: T.bull }}>SPX</span> COMMAND
            </div>
            <div style={{ color: T.dim, fontSize: 9,
              fontFamily: "'Space Mono', monospace",
              letterSpacing: 1.5 }}>
              SPY 0DTE · ALPACA PAPER
            </div>
          </div>

          {/* Tab switcher */}
          <div style={{ display: "flex", background: T.bg,
            border: "1px solid " + T.border,
            borderRadius: 6, overflow: "hidden" }}>
            {[["signals","SIGNALS"],["gex","GEX LEVELS"]].map(([k,l]) => (
              <button key={k} onClick={() => setActiveTab(k)} style={{
                padding: "5px 14px", fontSize: 10,
                background: activeTab === k ? T.dim : "transparent",
                color: activeTab === k ? T.text : T.muted,
                border: "none", cursor: "pointer",
                fontFamily: "'Space Mono', monospace",
                letterSpacing: 0.8,
              }}>{l}</button>
            ))}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {/* Signal counts */}
          <div style={{ display: "flex", gap: 5 }}>
            {pending > 0 && (
              <span style={{ background: T.yellow + "15", color: T.yellow,
                border: "1px solid " + T.yellow + "30",
                borderRadius: 4, padding: "2px 8px",
                fontSize: 9, fontFamily: "monospace" }}>
                {pending} PENDING
              </span>
            )}
            {active > 0 && (
              <span style={{ background: T.bull + "15", color: T.bull,
                border: "1px solid " + T.bull + "30",
                borderRadius: 4, padding: "2px 8px",
                fontSize: 9, fontFamily: "monospace" }}>
                {active} ACTIVE
              </span>
            )}
            {closed > 0 && (
              <span style={{ background: T.dim, color: T.muted,
                border: "1px solid " + T.border,
                borderRadius: 4, padding: "2px 8px",
                fontSize: 9, fontFamily: "monospace" }}>
                {closed} CLOSED
              </span>
            )}
          </div>

          {/* Connection status */}
          <div style={{ display: "flex", alignItems: "center", gap: 8,
            background: DEMO_MODE ? T.yellow + "0f" : alpacaOk ? T.bull + "0f" : T.bear + "0f",
            border: "1px solid " + (DEMO_MODE ? T.yellow : alpacaOk ? T.bull : T.bear) + "25",
            borderRadius: 6, padding: "5px 11px" }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%",
              background: DEMO_MODE ? T.yellow : alpacaOk ? T.bull : T.bear,
              animation: "pip 2s infinite" }} />
            <span style={{ color: DEMO_MODE ? T.yellow : alpacaOk ? T.bull : T.bear,
              fontSize: 9, fontFamily: "monospace" }}>
              {DEMO_MODE ? "DEMO" : alpacaOk ? "ALPACA PAPER · LIVE" : "CONNECTING..."}
            </span>
          </div>

          {/* Force close button */}
          {!DEMO_MODE && active > 0 && (
            <button onClick={handleForceClose} style={{
              background: T.bear + "0f",
              border: "1px solid " + T.bear + "30",
              borderRadius: 6, color: T.bear,
              padding: "5px 12px", fontSize: 9,
              fontFamily: "monospace", cursor: "pointer",
            }}>CLOSE ALL</button>
          )}

          <span style={{ color: T.dim, fontSize: 11,
            fontFamily: "monospace" }}>{clock}</span>
        </div>
      </div>

      <div style={{ padding: "14px 20px", maxWidth: 1100, margin: "0 auto" }}>

        {/* Demo banner */}
        {DEMO_MODE && (
          <div style={{ background: T.yellow + "08",
            border: "1px solid " + T.yellow + "20",
            borderRadius: 7, padding: "9px 14px",
            marginBottom: 12,
            display: "flex", gap: 10, alignItems: "flex-start" }}>
            <span style={{ color: T.yellow, fontSize: 10,
              fontFamily: "monospace", fontWeight: 700,
              flexShrink: 0 }}>DEMO</span>
            <span style={{ color: T.muted, fontSize: 10,
              fontFamily: "monospace" }}>
              Showing sample data. To go live: open this dashboard at{" "}
              <span style={{ color: T.yellow }}>localhost:3000</span> with{" "}
              <span style={{ color: T.yellow }}>server.js</span> running,
              or update SERVER to your Railway URL.
            </span>
          </div>
        )}

        {/* P&L bar */}
        <PnLBar
          sessionPnL={sessionPnL}
          dailyLoss={dailyLoss}
          accountSize={accountSize}
          riskBudget={riskBudget}
          signals={signals}
        />

        {/* Main content — two column layout */}
        <div style={{ display: "grid",
          gridTemplateColumns: "1fr 360px",
          gap: 14 }}>

          {/* Left column */}
          <div>
            {activeTab === "signals" ? (
              <>
                <div style={{ display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center", marginBottom: 10 }}>
                  <span style={{ color: T.muted, fontSize: 9,
                    fontFamily: "monospace", letterSpacing: 2 }}>
                    LIVE SIGNALS
                  </span>
                  <span style={{ color: T.dim, fontSize: 9,
                    fontFamily: "monospace" }}>
                    {signals.length} total · 3:45 PM ET force close
                  </span>
                </div>

                {signals.length === 0 ? (
                  <div style={{ textAlign: "center",
                    padding: "48px 20px",
                    border: "1px dashed " + T.border,
                    borderRadius: 10, color: T.dim,
                    fontFamily: "monospace", fontSize: 11 }}>
                    Waiting for TradingView ORB breakout signal...
                  </div>
                ) : (
                  <div style={{ display: "flex",
                    flexDirection: "column", gap: 10 }}>
                    {signals.map(s => (
                      <div key={s.id} style={{ animation: "fadein 0.25s ease" }}>
                        <SignalCard signal={s} onCancel={handleCancel} />
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <>
                <div style={{ marginBottom: 10,
                  display: "flex", justifyContent: "space-between",
                  alignItems: "center" }}>
                  <span style={{ color: T.muted, fontSize: 9,
                    fontFamily: "monospace", letterSpacing: 2 }}>
                    GEX LEVELS · SELF-CALCULATED FROM ALPACA CHAIN
                  </span>
                  <span style={{ color: T.dim, fontSize: 9,
                    fontFamily: "monospace" }}>
                    Compare against TradeEcho / Unusual Whales
                  </span>
                </div>
                <GEXPanel gex={gex} />

                {/* Comparison guide */}
                <div style={{ marginTop: 12,
                  background: T.panel,
                  border: "1px solid " + T.border,
                  borderRadius: 10, padding: "14px 16px" }}>
                  <div style={{ color: T.muted, fontSize: 9,
                    fontFamily: "monospace", letterSpacing: 2,
                    marginBottom: 10 }}>
                    HOW TO VERIFY GEX ACCURACY
                  </div>
                  <div style={{ display: "grid",
                    gridTemplateColumns: "1fr 1fr 1fr",
                    gap: 10 }}>
                    {[
                      {
                        source: "TradeEcho",
                        url: "tradeecho.com",
                        check: "Compare call/put walls and gamma flip level",
                        color: T.blue,
                      },
                      {
                        source: "Unusual Whales",
                        url: "unusualwhales.com/gex",
                        check: "Compare net GEX value and regime (positive/negative)",
                        color: T.purple,
                      },
                      {
                        source: "SpotGamma",
                        url: "spotgamma.com",
                        check: "Compare key strike levels and flip point",
                        color: T.yellow,
                      },
                    ].map(({ source, url, check, color }) => (
                      <div key={source} style={{ background: T.bg,
                        borderRadius: 6, padding: "10px 12px",
                        border: "1px solid " + T.border }}>
                        <div style={{ color, fontSize: 11,
                          fontFamily: "monospace", fontWeight: 700,
                          marginBottom: 4 }}>{source}</div>
                        <div style={{ color: T.dim, fontSize: 9,
                          fontFamily: "monospace",
                          marginBottom: 6 }}>{url}</div>
                        <div style={{ color: T.textDim, fontSize: 10,
                          fontFamily: "monospace",
                          lineHeight: 1.5 }}>{check}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ marginTop: 10, padding: "8px 10px",
                    background: T.dim + "33",
                    borderRadius: 5 }}>
                    <span style={{ color: T.muted, fontSize: 9,
                      fontFamily: "monospace" }}>
                      ⚡ WHAT TO LOOK FOR: Call wall at $
                      {gex?.callWalls?.[0]?.price || "—"} should appear as a resistance level on both services.
                      Put wall at ${gex?.putWalls?.[0]?.price || "—"} should appear as support.
                      Gamma flip at ${gex?.gammaFlip || "—"} should match their "zero GEX" or "flip level".
                      Regime ({gex?.regime || "—"}) should match their market condition indicator.
                    </span>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Right column */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

            {/* Compact GEX summary */}
            <div style={{ background: T.panel,
              border: "1px solid " + T.border,
              borderRadius: 10, padding: "12px 16px" }}>
              <div style={{ color: T.muted, fontSize: 9,
                fontFamily: "monospace", letterSpacing: 2,
                marginBottom: 10 }}>GEX SUMMARY</div>

              {!gex ? (
                <div style={{ color: T.dim, fontSize: 10,
                  fontFamily: "monospace", textAlign: "center",
                  padding: "12px 0" }}>
                  Calculates at 9:25 AM ET
                </div>
              ) : (
                <>
                  <div style={{ display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 8, marginBottom: 10 }}>
                    {[
                      { k: "REGIME",  v: gex.regime?.toUpperCase(), c: gex.regime === "positive" ? T.bull : T.bear },
                      { k: "FLIP",    v: "$" + gex.gammaFlip,        c: T.yellow },
                      { k: "NET GEX", v: fmtGex(gex.netGex),         c: gex.netGex >= 0 ? T.bull : T.bear },
                      { k: "SPY",     v: "$" + gex.spotPrice?.toFixed(2), c: T.text },
                    ].map(({ k, v, c }) => (
                      <div key={k} style={{ background: T.bg,
                        borderRadius: 5, padding: "7px 9px",
                        border: "1px solid " + T.border }}>
                        <div style={{ color: T.dim, fontSize: 8,
                          fontFamily: "monospace", letterSpacing: 1,
                          marginBottom: 3 }}>{k}</div>
                        <div style={{ color: c, fontSize: 12,
                          fontFamily: "monospace", fontWeight: 700 }}>{v}</div>
                      </div>
                    ))}
                  </div>

                  <div style={{ marginBottom: 6 }}>
                    <div style={{ color: T.muted, fontSize: 8,
                      fontFamily: "monospace", letterSpacing: 1,
                      marginBottom: 5 }}>CALL WALLS</div>
                    {gex.callWalls?.slice(0, 3).map((w, i) => (
                      <div key={i} style={{ display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center", marginBottom: 4 }}>
                        <span style={{ color: i === 0 ? T.bull : T.muted,
                          fontSize: 11, fontFamily: "monospace",
                          fontWeight: i === 0 ? 700 : 400 }}>
                          ${w.price}
                        </span>
                        <div style={{ flex: 1, height: 3,
                          background: T.dim, borderRadius: 1,
                          margin: "0 8px", overflow: "hidden" }}>
                          <div style={{ width: (i === 0 ? 100 : i === 1 ? 65 : 40) + "%",
                            height: "100%",
                            background: T.bull + (i === 0 ? "" : "66") }} />
                        </div>
                        <span style={{ color: T.muted, fontSize: 9,
                          fontFamily: "monospace" }}>
                          ${(w.gex/1e6).toFixed(0)}M
                        </span>
                      </div>
                    ))}
                  </div>

                  <div>
                    <div style={{ color: T.muted, fontSize: 8,
                      fontFamily: "monospace", letterSpacing: 1,
                      marginBottom: 5 }}>PUT WALLS</div>
                    {gex.putWalls?.slice(0, 3).map((w, i) => (
                      <div key={i} style={{ display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center", marginBottom: 4 }}>
                        <span style={{ color: i === 0 ? T.bear : T.muted,
                          fontSize: 11, fontFamily: "monospace",
                          fontWeight: i === 0 ? 700 : 400 }}>
                          ${w.price}
                        </span>
                        <div style={{ flex: 1, height: 3,
                          background: T.dim, borderRadius: 1,
                          margin: "0 8px", overflow: "hidden" }}>
                          <div style={{ width: (i === 0 ? 100 : i === 1 ? 65 : 40) + "%",
                            height: "100%",
                            background: T.bear + (i === 0 ? "" : "66") }} />
                        </div>
                        <span style={{ color: T.muted, fontSize: 9,
                          fontFamily: "monospace" }}>
                          ${(w.gex/1e6).toFixed(0)}M
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Config strip */}
            <div style={{ background: T.panel,
              border: "1px solid " + T.border,
              borderRadius: 10, padding: "12px 16px" }}>
              <div style={{ color: T.muted, fontSize: 9,
                fontFamily: "monospace", letterSpacing: 2,
                marginBottom: 10 }}>CONFIG</div>
              {[
                ["Risk/trade",  "$" + riskBudget + " fixed"],
                ["Stop",        "50% of premium"],
                ["TP1",         "2× premium"],
                ["Trail",       "Breakeven after TP1"],
                ["Force close", "3:45 PM ET daily"],
                ["GEX refresh", "9:25, 10:30, 12:00, 2:00"],
              ].map(([k, v]) => (
                <div key={k} style={{ display: "flex",
                  justifyContent: "space-between",
                  marginBottom: 5 }}>
                  <span style={{ color: T.dim, fontSize: 9,
                    fontFamily: "monospace" }}>{k}</span>
                  <span style={{ color: T.muted, fontSize: 9,
                    fontFamily: "monospace" }}>{v}</span>
                </div>
              ))}
            </div>

            {/* Log feed */}
            <LogFeed logs={logs} />
          </div>
        </div>
      </div>
    </div>
  );
}
