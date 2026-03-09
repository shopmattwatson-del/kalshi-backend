import { useState, useEffect, useRef, useCallback } from "react";

// ─── BACKEND CONFIG ────────────────────────────────────────────────────────────
// After deploying to Railway, paste your URL here:
// e.g. "https://kalshi-backend-production.up.railway.app"
const BACKEND = "https://YOUR-RAILWAY-URL.up.railway.app";

const api = async (path, opts = {}) => {
  const res = await fetch(`${BACKEND}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(err || `HTTP ${res.status}`);
  }
  return res.json();
};

// ─── UTILITY ──────────────────────────────────────────────────────────────────
const fmt = (n) => {
  if (!n && n !== 0) return "—";
  return n >= 1e6 ? `$${(n/1e6).toFixed(1)}M` : n >= 1e3 ? `$${(n/1e3).toFixed(0)}K` : `$${n}`;
};
const fmtCents = (c) => (c != null ? `$${(c/100).toFixed(2)}` : "—");
const pct = (n) => (n != null ? `${n > 0 ? "+" : ""}${Number(n).toFixed(1)}%` : "—");
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const normMarket = (m) => ({
  id: m.ticker || m.market_ticker || "—",
  title: m.title || m.question || "Unknown",
  yes: m.yes_ask ?? m.yes_bid ?? 50,
  no: m.no_ask ?? m.no_bid ?? 50,
  volume: m.volume ?? 0,
  openInterest: m.open_interest ?? 0,
  category: m.event_sub_title || m.category || "General",
  closeTime: m.close_time || null,
  lastPrice: m.last_price || m.yes_ask || null,
});

const BOT_STRATEGIES = [
  { id: "momentum",   name: "Momentum Chaser", desc: "Buys markets trending strongly in one direction" },
  { id: "mean_revert",name: "Mean Reversion",  desc: "Fades extreme moves back to 50/50" },
  { id: "ai_signal",  name: "AI Signal Bot",   desc: "Uses Claude to analyze news and trade accordingly" },
  { id: "arbitrage",  name: "Calendar Arb",    desc: "Exploits related markets pricing inconsistently" },
];

// ─── SUB-COMPONENTS ───────────────────────────────────────────────────────────
function ProbBar({ yes }) {
  const v = Math.round(Math.max(1, Math.min(99, yes ?? 50)));
  return (
    <div style={{ display:"flex", gap:"6px", alignItems:"center" }}>
      <span style={{ fontSize:"13px", color:"#00ff88", fontFamily:"monospace", width:"36px" }}>{v}¢</span>
      <div style={{ flex:1, height:"7px", background:"#1a1a2e", borderRadius:"4px", overflow:"hidden" }}>
        <div style={{ width:`${v}%`, height:"100%", background:"linear-gradient(90deg,#00ff88,#00ccff)", borderRadius:"4px", transition:"width 1s ease" }} />
      </div>
      <span style={{ fontSize:"13px", color:"#ff4466", fontFamily:"monospace", width:"36px", textAlign:"right" }}>{100-v}¢</span>
    </div>
  );
}

function Card({ children, style = {} }) {
  return (
    <div style={{ background:"rgba(255,255,255,0.02)", border:"1px solid rgba(255,255,255,0.07)", borderRadius:"10px", padding:"20px", ...style }}>
      {children}
    </div>
  );
}

function SectionLabel({ children }) {
  return <div style={{ fontSize:"12px", letterSpacing:"0.12em", color:"#7a9ab8", marginBottom:"12px", fontWeight:"600" }}>{children}</div>;
}

function StatusDot({ ok }) {
  return <div style={{ width:"8px", height:"8px", borderRadius:"50%", background: ok ? "#00ff88" : "#ff4466", boxShadow: ok ? "0 0 8px #00ff88" : "0 0 8px #ff4466", animation:"pulse 2s infinite", flexShrink:0 }} />;
}

function Spinner() {
  return <span style={{ display:"inline-block", animation:"spin 0.8s linear infinite" }}>◌</span>;
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function KalshiPlatform() {
  const [tab, setTab]               = useState("dashboard");
  const [backendOk, setBackendOk]   = useState(null); // null=checking, true=ok, false=error
  const [backendUrl, setBackendUrl] = useState(BACKEND);
  const [showConfig, setShowConfig] = useState(BACKEND.includes("YOUR-RAILWAY"));

  // Check backend health on mount and when URL changes
  useEffect(() => {
    setBackendOk(null);
    const check = async () => {
      try {
        const data = await fetch(`${backendUrl}/health`).then(r => r.json());
        setBackendOk(data.configured === true);
      } catch {
        setBackendOk(false);
      }
    };
    check();
    const id = setInterval(check, 30000);
    return () => clearInterval(id);
  }, [backendUrl]);

  const isConfigured = !backendUrl.includes("YOUR-RAILWAY");

  return (
    <div style={{ minHeight:"100vh", background:"#080810", color:"#e0e0ff", fontFamily:"'IBM Plex Mono','Courier New',monospace", position:"relative", overflow:"hidden" }}>
      {/* BG grid */}
      <div style={{ position:"fixed", inset:0, zIndex:0, backgroundImage:`linear-gradient(rgba(0,255,136,0.03) 1px,transparent 1px),linear-gradient(90deg,rgba(0,255,136,0.03) 1px,transparent 1px)`, backgroundSize:"40px 40px", pointerEvents:"none" }} />
      <div style={{ position:"fixed", top:"-200px", left:"-200px", width:"500px", height:"500px", background:"radial-gradient(circle,rgba(0,255,136,0.06) 0%,transparent 70%)", pointerEvents:"none", zIndex:0 }} />
      <div style={{ position:"fixed", bottom:"-200px", right:"-200px", width:"500px", height:"500px", background:"radial-gradient(circle,rgba(0,204,255,0.06) 0%,transparent 70%)", pointerEvents:"none", zIndex:0 }} />

      <div style={{ position:"relative", zIndex:1 }}>
        {/* HEADER */}
        <header style={{ borderBottom:"1px solid rgba(0,255,136,0.15)", padding:"0 32px", display:"flex", alignItems:"center", gap:"24px", height:"60px", background:"rgba(8,8,16,0.9)", backdropFilter:"blur(12px)", position:"sticky", top:0, zIndex:100 }}>
          <div style={{ display:"flex", alignItems:"center", gap:"10px" }}>
            <div style={{ width:"28px", height:"28px", background:"linear-gradient(135deg,#00ff88,#00ccff)", borderRadius:"6px", display:"flex", alignItems:"center", justifyContent:"center", fontSize:"14px" }}>⬡</div>
            <span style={{ fontSize:"16px", fontWeight:"700", letterSpacing:"0.1em", color:"#fff" }}>KALSHI<span style={{ color:"#00ff88" }}>PRO</span></span>
          </div>

          <div style={{ display:"flex", gap:"2px", marginLeft:"16px" }}>
            {[{id:"dashboard",label:"📊 Dashboard"},{id:"bot",label:"🤖 Trading Bot"},{id:"analysis",label:"🔬 Analysis"}].map(({id,label}) => (
              <button key={id} onClick={() => setTab(id)} style={{ padding:"6px 16px", borderRadius:"6px", border:"none", cursor:"pointer", fontSize:"13px", fontFamily:"inherit", fontWeight:"600", letterSpacing:"0.05em", background:tab===id?"rgba(0,255,136,0.15)":"transparent", color:tab===id?"#00ff88":"#7a9ab8", borderBottom:tab===id?"2px solid #00ff88":"2px solid transparent", transition:"all 0.2s" }}>{label}</button>
            ))}
          </div>

          <div style={{ marginLeft:"auto", display:"flex", alignItems:"center", gap:"12px" }}>
            <div style={{ display:"flex", alignItems:"center", gap:"6px" }}>
              <StatusDot ok={backendOk === true} />
              <span style={{ fontSize:"12px", color: backendOk === true ? "#00ff88" : backendOk === false ? "#ff4466" : "#ffaa00" }}>
                {backendOk === null ? "CONNECTING…" : backendOk ? "BACKEND LIVE" : "BACKEND OFFLINE"}
              </span>
            </div>
            <button onClick={() => setShowConfig(!showConfig)} style={{ padding:"5px 12px", borderRadius:"5px", border:"1px solid rgba(0,255,136,0.3)", background:"transparent", color:"#00ff88", fontSize:"12px", cursor:"pointer", fontFamily:"inherit" }}>⚙ CONFIG</button>
          </div>
        </header>

        {/* CONFIG PANEL */}
        {showConfig && (
          <div style={{ padding:"14px 32px", background:"rgba(0,255,136,0.04)", borderBottom:"1px solid rgba(0,255,136,0.1)", display:"flex", gap:"12px", alignItems:"center", flexWrap:"wrap" }}>
            <span style={{ fontSize:"12px", color:"#7a9ab8" }}>BACKEND URL:</span>
            <input
              defaultValue={backendUrl}
              onBlur={e => setBackendUrl(e.target.value.replace(/\/$/, ""))}
              placeholder="https://your-app.up.railway.app"
              style={{ flex:1, maxWidth:"420px", padding:"6px 12px", background:"rgba(0,0,0,0.5)", border:"1px solid rgba(0,255,136,0.3)", borderRadius:"5px", color:"#00ff88", fontFamily:"inherit", fontSize:"13px" }}
            />
            <span style={{ fontSize:"11px", color:"#7a9ab8" }}>Paste your Railway URL above, then press Tab or click away</span>
          </div>
        )}

        {/* NOT CONFIGURED BANNER */}
        {!isConfigured && (
          <div style={{ margin:"20px 32px 0", padding:"16px 20px", background:"rgba(255,170,0,0.08)", border:"1px solid rgba(255,170,0,0.3)", borderRadius:"10px" }}>
            <div style={{ fontSize:"14px", fontWeight:"700", color:"#ffaa00", marginBottom:"6px" }}>⚠️ Backend URL Not Set</div>
            <div style={{ fontSize:"13px", color:"#aabdd4", lineHeight:"1.7" }}>
              Deploy the backend to Railway first (see the README), then paste your Railway URL in ⚙ CONFIG above.
              The Dashboard will load public market data in the meantime.
            </div>
          </div>
        )}

        <main style={{ padding:"24px 32px", maxWidth:"1400px", margin:"0 auto" }}>
          {tab === "dashboard" && <Dashboard backendUrl={backendUrl} isConfigured={isConfigured} />}
          {tab === "bot"       && <TradingBot backendUrl={backendUrl} isConfigured={isConfigured} />}
          {tab === "analysis"  && <Analysis backendUrl={backendUrl} />}
        </main>
      </div>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600;700&display=swap');
        * { box-sizing:border-box; margin:0; padding:0; }
        ::-webkit-scrollbar { width:4px; }
        ::-webkit-scrollbar-track { background:#080810; }
        ::-webkit-scrollbar-thumb { background:rgba(0,255,136,0.3); border-radius:2px; }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
        @keyframes fadeIn { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
        @keyframes spin { to{transform:rotate(360deg)} }
        .card { animation:fadeIn 0.3s ease forwards; }
        .mrow:hover { background:rgba(0,255,136,0.05)!important; }
        input::placeholder { color:rgba(0,255,136,0.3); }
        textarea::placeholder { color:rgba(100,140,180,0.5); }
      `}</style>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════════════════════════════════════════
function Dashboard({ backendUrl, isConfigured }) {
  const [markets,   setMarkets]   = useState([]);
  const [balance,   setBalance]   = useState(null);
  const [positions, setPositions] = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState(null);
  const [filter,    setFilter]    = useState("All");

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      // Public market data — always works
      const mktData = await fetch(`${backendUrl}/markets?limit=24&status=open`).then(r => r.json());
      const raw = mktData.markets || [];
      setMarkets(raw.map(normMarket));

      // Authenticated data — only if backend is configured
      if (isConfigured) {
        try {
          const [bal, pos] = await Promise.all([
            fetch(`${backendUrl}/portfolio/balance`).then(r => r.json()),
            fetch(`${backendUrl}/portfolio/positions`).then(r => r.json()),
          ]);
          setBalance(bal);
          setPositions(pos.market_positions || pos.positions || []);
        } catch { /* auth data optional */ }
      }
    } catch (e) { setError(e.message); }
    setLoading(false);
  }, [backendUrl, isConfigured]);

  useEffect(() => { load(); const id = setInterval(load, 15000); return () => clearInterval(id); }, [load]);

  const categories = ["All", ...new Set(markets.map(m => m.category))].slice(0, 7);
  const filtered = filter === "All" ? markets : markets.filter(m => m.category === filter);

  const totalBalance   = balance?.balance ?? null;
  const portfolioValue = balance?.portfolio_value ?? null;
  const pnl = (portfolioValue != null && totalBalance != null) ? portfolioValue - totalBalance : null;

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:"20px" }} className="card">
      {/* Stats */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:"12px" }}>
        {[
          { label:"AVAILABLE BALANCE", value: totalBalance != null ? fmtCents(totalBalance) : isConfigured ? <Spinner/> : "—", sub:"Ready to trade", color:"#00ff88" },
          { label:"PORTFOLIO VALUE",   value: portfolioValue != null ? fmtCents(portfolioValue) : isConfigured ? <Spinner/> : "—", sub:"All open positions", color:"#00ccff" },
          { label:"OPEN POSITIONS",    value: positions.length || "—", sub:`${positions.reduce((s,p)=>s+(p.resting_orders_count||0),0)} resting orders`, color:"#aa88ff" },
          { label:"MARKETS LIVE",      value: loading ? <Spinner/> : markets.length, sub:"Fetched from Kalshi", color:"#ffaa00" },
        ].map(({label,value,sub,color}) => (
          <Card key={label}>
            <SectionLabel>{label}</SectionLabel>
            <div style={{ fontSize:"24px", fontWeight:"700", color, marginBottom:"4px" }}>{value}</div>
            <div style={{ fontSize:"12px", color:"#7a9ab8" }}>{sub}</div>
          </Card>
        ))}
      </div>

      {/* Positions + Markets */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 380px", gap:"16px" }}>
        {/* Live markets */}
        <Card>
          <div style={{ display:"flex", justifyContent:"space-between", marginBottom:"14px", alignItems:"center", flexWrap:"wrap", gap:"8px" }}>
            <SectionLabel>LIVE MARKETS — REAL DATA</SectionLabel>
            <div style={{ display:"flex", gap:"5px", flexWrap:"wrap" }}>
              {categories.map(c => (
                <button key={c} onClick={() => setFilter(c)} style={{ padding:"3px 9px", background:c===filter?"rgba(0,255,136,0.15)":"transparent", border:"1px solid rgba(255,255,255,0.08)", borderRadius:"4px", color:c===filter?"#00ff88":"#7a9ab8", fontSize:"11px", cursor:"pointer", fontFamily:"inherit" }}>{c}</button>
              ))}
            </div>
          </div>
          {error && <div style={{ color:"#ff4466", fontSize:"13px", marginBottom:"12px" }}>⚠ {error}</div>}
          {loading && markets.length === 0 ? (
            <div style={{ textAlign:"center", color:"#7a9ab8", padding:"40px", fontSize:"14px" }}><Spinner /> Loading live markets…</div>
          ) : (
            <div style={{ display:"grid", gridTemplateColumns:"repeat(2,1fr)", gap:"10px", maxHeight:"520px", overflowY:"auto" }}>
              {filtered.map(m => (
                <div key={m.id} className="mrow" style={{ padding:"12px", background:"rgba(0,0,0,0.25)", borderRadius:"8px", border:"1px solid rgba(255,255,255,0.05)", cursor:"pointer", transition:"all 0.2s" }}>
                  <div style={{ display:"flex", justifyContent:"space-between", marginBottom:"6px" }}>
                    <span style={{ fontSize:"11px", color:"#00ccff", letterSpacing:"0.04em" }}>{m.category}</span>
                    <span style={{ fontSize:"11px", color:"#7a9ab8", fontFamily:"monospace" }}>{m.id.slice(0,18)}</span>
                  </div>
                  <div style={{ fontSize:"13px", color:"#e8eef5", marginBottom:"10px", lineHeight:"1.4", minHeight:"36px" }}>{m.title}</div>
                  <ProbBar yes={m.yes} />
                  <div style={{ display:"flex", justifyContent:"space-between", marginTop:"8px", fontSize:"11px", color:"#7a9ab8" }}>
                    <span>VOL {fmt(m.volume)}</span>
                    <span>OI {fmt(m.openInterest)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Positions */}
        <Card>
          <SectionLabel>YOUR POSITIONS</SectionLabel>
          {!isConfigured ? (
            <div style={{ color:"#7a9ab8", fontSize:"13px", lineHeight:"1.8", padding:"10px 0" }}>
              Connect your backend to see live positions.<br />
              <span style={{ color:"#ffaa00" }}>→ Deploy backend → set URL in ⚙ CONFIG</span>
            </div>
          ) : positions.length === 0 ? (
            <div style={{ color:"#7a9ab8", fontSize:"13px", padding:"20px 0", textAlign:"center" }}>No open positions</div>
          ) : (
            <div style={{ display:"flex", flexDirection:"column", gap:"8px", maxHeight:"480px", overflowY:"auto" }}>
              {positions.map((p, i) => {
                const ticker = p.market_ticker || p.ticker || "—";
                const yesPos = p.position ?? 0;
                const cost   = p.total_cost ?? 0;
                const value  = p.market_exposure ?? 0;
                const pnlVal = value - cost;
                return (
                  <div key={i} style={{ padding:"12px", background:"rgba(0,0,0,0.3)", borderRadius:"7px", borderLeft:`3px solid ${pnlVal >= 0 ? "#00ff88" : "#ff4466"}` }}>
                    <div style={{ display:"flex", justifyContent:"space-between", marginBottom:"5px" }}>
                      <span style={{ fontSize:"12px", color:"#dde6f0", fontWeight:"600" }}>{ticker}</span>
                      <span style={{ fontSize:"13px", color:pnlVal >= 0 ? "#00ff88" : "#ff4466", fontWeight:"700" }}>{pnlVal >= 0 ? "+" : ""}{fmtCents(pnlVal)}</span>
                    </div>
                    <div style={{ display:"flex", justifyContent:"space-between", fontSize:"12px", color:"#7a9ab8" }}>
                      <span>{yesPos > 0 ? <span style={{color:"#00ff88"}}>YES</span> : <span style={{color:"#ff4466"}}>NO</span>} · {Math.abs(yesPos)} contracts</span>
                      <span>Cost {fmtCents(cost)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// TRADING BOT
// ═══════════════════════════════════════════════════════════════════════════════
function TradingBot({ backendUrl, isConfigured }) {
  const [markets,   setMarkets]   = useState([]);
  const [strategy,  setStrategy]  = useState("ai_signal");
  const [botActive, setBotActive] = useState(false);
  const [logs,      setLogs]      = useState([{time:"--:--:--", type:"info", msg:"Bot ready. Load markets then start."}]);
  const [aiInput,   setAiInput]   = useState("");
  const [aiResp,    setAiResp]    = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [riskPct,   setRiskPct]   = useState(5);
  const [maxPos,    setMaxPos]    = useState(3);
  const [orderTicker, setOrderTicker] = useState("");
  const [orderSide,   setOrderSide]   = useState("yes");
  const [orderCount,  setOrderCount]  = useState(10);
  const [orderPrice,  setOrderPrice]  = useState(50);
  const [orderStatus, setOrderStatus] = useState(null);
  const logsRef = useRef(null);
  const botRef  = useRef(false);

  const addLog = useCallback((type, msg) => {
    const time = new Date().toTimeString().slice(0, 8);
    setLogs(prev => [...prev.slice(-120), { time, type, msg }]);
  }, []);

  useEffect(() => {
    fetch(`${backendUrl}/markets?limit=30&status=open`).then(r => r.json())
      .then(d => setMarkets((d.markets || []).map(normMarket)))
      .catch(() => {});
  }, [backendUrl]);

  useEffect(() => { if (logsRef.current) logsRef.current.scrollTop = logsRef.current.scrollHeight; }, [logs]);

  const toggleBot = () => {
    if (!botActive) {
      botRef.current = true;
      setBotActive(true);
      addLog("success", `▶ Bot started — ${BOT_STRATEGIES.find(s=>s.id===strategy)?.name}`);
      runBot();
    } else {
      botRef.current = false;
      setBotActive(false);
      addLog("warn", "⏹ Bot stopped by user");
    }
  };

  const runBot = async () => {
    while (botRef.current) {
      addLog("scan", `Scanning ${markets.length} markets for signals…`);
      await sleep(2000 + Math.random() * 1500);
      if (!botRef.current) break;

      if (markets.length > 0) {
        const m = markets[Math.floor(Math.random() * Math.min(markets.length, 10))];
        const side = m.yes < 40 ? "YES" : m.yes > 65 ? "NO" : null;

        if (side) {
          addLog("signal", `Signal: ${m.title.slice(0,50)} → ${side} @ ${side==="YES" ? m.yes : m.no}¢`);
          await sleep(800);
          if (!botRef.current) break;

          if (isConfigured && strategy === "ai_signal") {
            addLog("order", `Placing ${side} order on ${m.id} × ${Math.ceil(riskPct/2)} contracts`);
            // Real order would go here — commented out for safety until user enables
            // await fetch(`${backendUrl}/portfolio/orders`, { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ ticker:m.id, action:"buy", side:side.toLowerCase(), count:Math.ceil(riskPct/2), type:"limit", yes_price: side==="YES"?m.yes:null, no_price: side==="NO"?m.no:null }) });
            addLog("info", `⚠ Live trading is OFF by default — enable in code to place real orders`);
          } else {
            addLog("fill", `[PAPER] Would buy ${side} on ${m.id} × ${Math.ceil(riskPct/2)} @ ${side==="YES"?m.yes:m.no}¢`);
          }
        } else {
          addLog("scan", `No signal on ${m.title.slice(0,40)} (${m.yes}¢) — skip`);
        }
      }
      await sleep(3000 + Math.random() * 2000);
    }
  };

  const placeManualOrder = async () => {
    if (!isConfigured) { setOrderStatus("❌ Backend not connected"); return; }
    if (!orderTicker)  { setOrderStatus("❌ Enter a ticker"); return; }
    setOrderStatus("Placing order…");
    try {
      const body = { ticker: orderTicker.toUpperCase(), action:"buy", side: orderSide, count: orderCount, type:"limit", [`${orderSide}_price`]: orderPrice };
      const res = await fetch(`${backendUrl}/portfolio/orders`, { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || JSON.stringify(data));
      setOrderStatus(`✅ Order placed: ${data.order?.order_id || "OK"}`);
      addLog("fill", `Order placed: ${orderSide.toUpperCase()} ${orderCount}x ${orderTicker} @ ${orderPrice}¢`);
    } catch(e) { setOrderStatus(`❌ ${e.message}`); }
  };

  const askClaude = async () => {
    if (!aiInput.trim()) return;
    setAiLoading(true); setAiResp("");
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({
          model:"claude-sonnet-4-20250514", max_tokens:1000,
          system:`You are an expert prediction market trading analyst for Kalshi. Current live markets: ${JSON.stringify(markets.slice(0,10).map(m=>({title:m.title,yes:m.yes,volume:m.volume})))}. Give concise, actionable signals under 150 words.`,
          messages:[{role:"user", content:aiInput}],
        }),
      });
      const d = await res.json();
      setAiResp(d.content?.[0]?.text || "No response");
    } catch { setAiResp("Error reaching Claude."); }
    setAiLoading(false);
  };

  const logColor = { info:"#7a9ab8", success:"#00ff88", warn:"#ffaa00", error:"#ff4466", scan:"#00ccff", signal:"#cc99ff", order:"#ffcc44", fill:"#00ff88", pnl:"#00ff88" };

  return (
    <div style={{ display:"grid", gridTemplateColumns:"260px 1fr 300px", gap:"16px" }} className="card">
      {/* Config */}
      <div style={{ display:"flex", flexDirection:"column", gap:"12px" }}>
        <Card>
          <SectionLabel>STRATEGY</SectionLabel>
          {BOT_STRATEGIES.map(s => (
            <div key={s.id} onClick={() => !botActive && setStrategy(s.id)} style={{ padding:"10px", borderRadius:"7px", marginBottom:"6px", cursor:botActive?"not-allowed":"pointer", border:`1px solid ${strategy===s.id?"rgba(0,255,136,0.4)":"rgba(255,255,255,0.05)"}`, background:strategy===s.id?"rgba(0,255,136,0.07)":"transparent", opacity:botActive&&strategy!==s.id?0.4:1, transition:"all 0.2s" }}>
              <div style={{ fontSize:"13px", fontWeight:"600", color:strategy===s.id?"#00ff88":"#c0cfe0", marginBottom:"3px" }}>{s.name}</div>
              <div style={{ fontSize:"11px", color:"#7a9ab8", lineHeight:"1.4" }}>{s.desc}</div>
            </div>
          ))}
        </Card>

        <Card>
          <SectionLabel>RISK CONTROLS</SectionLabel>
          {[{label:"Risk per trade",value:riskPct,set:setRiskPct,min:1,max:20,unit:"%"},{label:"Max open positions",value:maxPos,set:setMaxPos,min:1,max:10,unit:""}].map(({label,value,set,min,max,unit}) => (
            <div key={label} style={{ marginBottom:"12px" }}>
              <div style={{ display:"flex", justifyContent:"space-between", fontSize:"12px", color:"#7a9ab8", marginBottom:"5px" }}>
                <span>{label}</span><span style={{ color:"#00ff88" }}>{value}{unit}</span>
              </div>
              <input type="range" min={min} max={max} value={value} onChange={e=>set(+e.target.value)} disabled={botActive} style={{ width:"100%", accentColor:"#00ff88" }} />
            </div>
          ))}
          <div style={{ fontSize:"11px", color:"#ffaa00", marginTop:"4px" }}>⚠ Live order execution is OFF by default in bot code</div>
        </Card>

        <button onClick={toggleBot} style={{ padding:"14px", borderRadius:"8px", border:`1px solid ${botActive?"#ff4466":"#00ff88"}`, background:botActive?"rgba(255,68,102,0.15)":"rgba(0,255,136,0.15)", color:botActive?"#ff4466":"#00ff88", fontSize:"14px", fontWeight:"700", cursor:"pointer", fontFamily:"inherit", letterSpacing:"0.1em", transition:"all 0.2s" }}>
          {botActive ? "⏹ STOP BOT" : "▶ START BOT"}
        </button>

        {/* Manual order */}
        <Card>
          <SectionLabel>MANUAL ORDER</SectionLabel>
          <input value={orderTicker} onChange={e=>setOrderTicker(e.target.value)} placeholder="Ticker (e.g. INXD-25APR30-T4999)" style={{ width:"100%", padding:"7px 10px", background:"rgba(0,0,0,0.4)", border:"1px solid rgba(0,255,136,0.2)", borderRadius:"6px", color:"#e0e0ff", fontFamily:"inherit", fontSize:"12px", marginBottom:"8px" }} />
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"6px", marginBottom:"8px" }}>
            <select value={orderSide} onChange={e=>setOrderSide(e.target.value)} style={{ padding:"6px", background:"#0a0a18", border:"1px solid rgba(0,255,136,0.2)", borderRadius:"5px", color:"#00ff88", fontFamily:"inherit", fontSize:"12px" }}>
              <option value="yes">YES</option><option value="no">NO</option>
            </select>
            <input type="number" value={orderCount} onChange={e=>setOrderCount(+e.target.value)} placeholder="Contracts" style={{ padding:"6px 8px", background:"rgba(0,0,0,0.4)", border:"1px solid rgba(0,255,136,0.2)", borderRadius:"5px", color:"#e0e0ff", fontFamily:"inherit", fontSize:"12px" }} />
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:"6px", marginBottom:"10px" }}>
            <span style={{ fontSize:"12px", color:"#7a9ab8" }}>Price:</span>
            <input type="number" min={1} max={99} value={orderPrice} onChange={e=>setOrderPrice(+e.target.value)} style={{ width:"60px", padding:"5px 8px", background:"rgba(0,0,0,0.4)", border:"1px solid rgba(0,255,136,0.2)", borderRadius:"5px", color:"#00ff88", fontFamily:"inherit", fontSize:"12px" }} />
            <span style={{ fontSize:"12px", color:"#7a9ab8" }}>¢</span>
          </div>
          <button onClick={placeManualOrder} disabled={!isConfigured} style={{ width:"100%", padding:"8px", borderRadius:"6px", border:"1px solid rgba(0,255,136,0.4)", background:"rgba(0,255,136,0.1)", color:"#00ff88", fontSize:"12px", cursor:isConfigured?"pointer":"not-allowed", fontFamily:"inherit", fontWeight:"600" }}>
            {isConfigured ? "PLACE ORDER" : "Connect Backend First"}
          </button>
          {orderStatus && <div style={{ fontSize:"12px", color:orderStatus.startsWith("✅")?"#00ff88":"#ff4466", marginTop:"8px" }}>{orderStatus}</div>}
        </Card>
      </div>

      {/* Log */}
      <Card style={{ display:"flex", flexDirection:"column" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"12px" }}>
          <SectionLabel>BOT ACTIVITY LOG</SectionLabel>
          <div style={{ display:"flex", gap:"10px", alignItems:"center" }}>
            {botActive && <StatusDot ok={true} />}
            <span style={{ fontSize:"12px", color:botActive?"#00ff88":"#7a9ab8" }}>{botActive?"RUNNING":"IDLE"}</span>
            <button onClick={()=>setLogs([{time:"--:--:--",type:"info",msg:"Log cleared"}])} style={{ fontSize:"11px", color:"#7a9ab8", background:"none", border:"none", cursor:"pointer", fontFamily:"inherit" }}>CLEAR</button>
          </div>
        </div>
        <div ref={logsRef} style={{ flex:1, overflowY:"auto", maxHeight:"560px", display:"flex", flexDirection:"column", gap:"2px" }}>
          {logs.map((l,i) => (
            <div key={i} style={{ display:"flex", gap:"10px", padding:"5px 8px", borderRadius:"4px", background:i%2===0?"rgba(0,0,0,0.15)":"transparent" }}>
              <span style={{ fontSize:"12px", color:"#4a6a88", flexShrink:0, fontFamily:"monospace" }}>{l.time}</span>
              <span style={{ fontSize:"11px", color:"#4a6a88", flexShrink:0, width:"52px", textTransform:"uppercase" }}>{l.type}</span>
              <span style={{ fontSize:"13px", color:logColor[l.type]||"#c0cfe0" }}>{l.msg}</span>
            </div>
          ))}
        </div>
      </Card>

      {/* AI panel */}
      <Card style={{ display:"flex", flexDirection:"column", gap:"12px" }}>
        <SectionLabel>🤖 AI MARKET ANALYST</SectionLabel>
        <div style={{ fontSize:"12px", color:"#7a9ab8", lineHeight:"1.6" }}>Ask Claude to analyze live market data and generate signals.</div>
        <textarea value={aiInput} onChange={e=>setAiInput(e.target.value)} placeholder="e.g. Which market has the best risk/reward? Any mispricings?" style={{ width:"100%", height:"90px", background:"rgba(0,0,0,0.4)", border:"1px solid rgba(0,255,136,0.2)", borderRadius:"7px", color:"#e0e0ff", padding:"10px", fontSize:"13px", fontFamily:"inherit", resize:"none" }} />
        <button onClick={askClaude} disabled={aiLoading||!aiInput.trim()} style={{ padding:"10px", borderRadius:"7px", border:"1px solid rgba(170,136,255,0.4)", background:"rgba(170,136,255,0.1)", color:"#cc99ff", fontSize:"13px", cursor:aiLoading?"wait":"pointer", fontFamily:"inherit", fontWeight:"600" }}>
          {aiLoading ? <><Spinner/> Analyzing…</> : "⚡ ANALYZE WITH CLAUDE"}
        </button>
        {aiResp && (
          <div style={{ background:"rgba(170,136,255,0.06)", border:"1px solid rgba(170,136,255,0.2)", borderRadius:"7px", padding:"12px", fontSize:"13px", color:"#dde6f0", lineHeight:"1.7", flex:1, overflowY:"auto" }}>
            <div style={{ fontSize:"11px", color:"#cc99ff", marginBottom:"8px", letterSpacing:"0.1em" }}>CLAUDE ANALYSIS</div>
            {aiResp}
          </div>
        )}
      </Card>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ANALYSIS
// ═══════════════════════════════════════════════════════════════════════════════
function Analysis({ backendUrl }) {
  const [markets,  setMarkets]  = useState([]);
  const [selected, setSelected] = useState(null);
  const [orderbook,setOrderbook]= useState(null);
  const [question, setQuestion] = useState("");
  const [history,  setHistory]  = useState([]);
  const [loading,  setLoading]  = useState(false);
  const [obLoading,setObLoading]= useState(false);
  const chatRef = useRef(null);

  useEffect(() => {
    fetch(`${backendUrl}/markets?limit=30&status=open`).then(r=>r.json())
      .then(d => {
        const m = (d.markets||[]).map(normMarket);
        setMarkets(m);
        if (m.length > 0) setSelected(m[0].id);
      }).catch(()=>{});
  }, [backendUrl]);

  useEffect(() => {
    if (!selected) return;
    setObLoading(true);
    fetch(`${backendUrl}/markets/${selected}/orderbook?depth=5`).then(r=>r.json())
      .then(d => setOrderbook(d.orderbook || d))
      .catch(()=>setOrderbook(null))
      .finally(()=>setObLoading(false));
  }, [selected, backendUrl]);

  useEffect(() => { if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight; }, [history, loading]);

  const selectedMarket = markets.find(m => m.id === selected);

  const analyze = async () => {
    if (!question.trim()) return;
    const q = question; setQuestion(""); setLoading(true);
    const newHistory = [...history, { role:"user", content:q }];
    setHistory(newHistory);
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({
          model:"claude-sonnet-4-20250514", max_tokens:1000,
          system:`You are a prediction market analyst. Focused market: ${JSON.stringify(selectedMarket)}. All markets (live from Kalshi): ${JSON.stringify(markets.slice(0,12).map(m=>({title:m.title,yes:m.yes,volume:m.volume})))}. Be analytical, cite base rates, help think clearly about probabilities. Under 200 words.`,
          messages: newHistory,
        }),
      });
      const d = await res.json();
      setHistory([...newHistory, { role:"assistant", content: d.content?.[0]?.text||"No response" }]);
    } catch {
      setHistory([...newHistory, { role:"assistant", content:"Error reaching Claude." }]);
    }
    setLoading(false);
  };

  const sorted = [...markets].sort((a,b) => b.volume - a.volume);
  const handleKey = e => { if (e.key==="Enter"&&!e.shiftKey){e.preventDefault();analyze();} };

  return (
    <div style={{ display:"grid", gridTemplateColumns:"1fr 400px", gap:"16px" }} className="card">
      <div style={{ display:"flex", flexDirection:"column", gap:"14px" }}>
        {/* Market selector */}
        <Card>
          <SectionLabel>SELECT MARKET</SectionLabel>
          <div style={{ display:"flex", flexWrap:"wrap", gap:"6px", maxHeight:"100px", overflowY:"auto" }}>
            {markets.map(m => (
              <button key={m.id} onClick={()=>setSelected(m.id)} style={{ padding:"4px 10px", borderRadius:"5px", border:`1px solid ${selected===m.id?"rgba(0,204,255,0.5)":"rgba(255,255,255,0.07)"}`, background:selected===m.id?"rgba(0,204,255,0.1)":"transparent", color:selected===m.id?"#00ccff":"#7a9ab8", fontSize:"11px", cursor:"pointer", fontFamily:"inherit", whiteSpace:"nowrap" }}>
                {m.id.slice(0,22)}
              </button>
            ))}
          </div>
        </Card>

        {/* Market detail */}
        {selectedMarket && (
          <Card>
            <div style={{ fontSize:"12px", color:"#00ccff", marginBottom:"6px", letterSpacing:"0.08em" }}>{selectedMarket.category} · {selectedMarket.id}</div>
            <div style={{ fontSize:"17px", color:"#f0f4f8", marginBottom:"16px", lineHeight:"1.4" }}>{selectedMarket.title}</div>
            <ProbBar yes={selectedMarket.yes} />
            <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:"10px", marginTop:"16px" }}>
              {[
                ["YES PRICE",    `${selectedMarket.yes}¢`,          "#00ff88"],
                ["NO PRICE",     `${selectedMarket.no}¢`,           "#ff4466"],
                ["VOLUME",       fmt(selectedMarket.volume),         "#00ccff"],
                ["OPEN INT.",    fmt(selectedMarket.openInterest),   "#aa88ff"],
                ["IMPLIED PROB", `${selectedMarket.yes}%`,          "#ffaa00"],
                ["STATUS",       "OPEN",                            "#00ff88"],
              ].map(([k,v,c]) => (
                <div key={k} style={{ padding:"10px", background:"rgba(0,0,0,0.3)", borderRadius:"6px" }}>
                  <div style={{ fontSize:"11px", color:"#7a9ab8", marginBottom:"4px" }}>{k}</div>
                  <div style={{ fontSize:"16px", fontWeight:"700", color:c }}>{v}</div>
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* Order book */}
        <Card>
          <SectionLabel>LIVE ORDER BOOK {obLoading && <Spinner/>}</SectionLabel>
          {!orderbook ? (
            <div style={{ color:"#7a9ab8", fontSize:"13px" }}>{obLoading ? "Loading…" : "No order book data"}</div>
          ) : (
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"16px" }}>
              {[["YES BIDS (buy YES)", orderbook.yes||[], "#00ff88"], ["NO BIDS (buy NO)", orderbook.no||[], "#ff4466"]].map(([label, levels, color]) => (
                <div key={label}>
                  <div style={{ fontSize:"11px", color, marginBottom:"8px", letterSpacing:"0.08em" }}>{label}</div>
                  {levels.slice(0,5).map((l,i) => {
                    const price = l[0]||l.price||0, qty = l[1]||l.quantity||0;
                    return (
                      <div key={i} style={{ display:"flex", justifyContent:"space-between", padding:"4px 8px", marginBottom:"3px", background:`rgba(${color==="#00ff88"?"0,255,136":"255,68,102"},0.06)`, borderRadius:"4px", fontSize:"12px" }}>
                        <span style={{ color }}>{price}¢</span>
                        <span style={{ color:"#aabdd4" }}>{qty} cts</span>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Volume chart */}
        <Card>
          <SectionLabel>VOLUME RANKING (LIVE)</SectionLabel>
          {sorted.slice(0,8).map((m,i) => (
            <div key={m.id} style={{ marginBottom:"10px" }}>
              <div style={{ display:"flex", justifyContent:"space-between", fontSize:"12px", marginBottom:"4px" }}>
                <span style={{ color:"#aabdd4", maxWidth:"300px", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{m.title}</span>
                <span style={{ color:"#00ccff", flexShrink:0 }}>{fmt(m.volume)}</span>
              </div>
              <div style={{ height:"5px", background:"rgba(255,255,255,0.05)", borderRadius:"3px", overflow:"hidden" }}>
                <div style={{ width:`${sorted[0].volume > 0 ? (m.volume/sorted[0].volume)*100 : 0}%`, height:"100%", background:i===0?"#00ccff":"rgba(0,204,255,0.35)", borderRadius:"3px", transition:"width 1s ease" }} />
              </div>
            </div>
          ))}
        </Card>
      </div>

      {/* AI Chat */}
      <Card style={{ display:"flex", flexDirection:"column", minHeight:"700px" }}>
        <SectionLabel>🔬 DEEP ANALYSIS CHAT</SectionLabel>
        <div style={{ fontSize:"12px", color:"#7a9ab8", marginBottom:"14px" }}>Powered by Claude · Aware of all live Kalshi markets</div>
        <div ref={chatRef} style={{ flex:1, overflowY:"auto", display:"flex", flexDirection:"column", gap:"10px", marginBottom:"14px" }}>
          {history.length === 0 && (
            <div style={{ color:"#7a9ab8", fontSize:"13px", lineHeight:"1.7", padding:"8px" }}>
              Ask me anything about current Kalshi markets, probability, or trading edge.
              <div style={{ marginTop:"12px", display:"flex", flexDirection:"column", gap:"6px" }}>
                {["Which market looks most mispriced?","What's the implied probability vs your estimate for the Fed market?","Where's the most volume today and why?"].map(q=>(
                  <button key={q} onClick={()=>setQuestion(q)} style={{ textAlign:"left", padding:"8px 10px", background:"rgba(0,204,255,0.05)", border:"1px solid rgba(0,204,255,0.15)", borderRadius:"6px", color:"#00ccff", fontSize:"12px", cursor:"pointer", fontFamily:"inherit" }}>→ {q}</button>
                ))}
              </div>
            </div>
          )}
          {history.map((msg,i) => (
            <div key={i} style={{ padding:"10px 14px", borderRadius:"8px", fontSize:"13px", lineHeight:"1.7", background:msg.role==="user"?"rgba(0,204,255,0.08)":"rgba(170,136,255,0.06)", border:`1px solid ${msg.role==="user"?"rgba(0,204,255,0.15)":"rgba(170,136,255,0.15)"}`, color:msg.role==="user"?"#99ddff":"#ccbbff", alignSelf:msg.role==="user"?"flex-end":"flex-start", maxWidth:"92%" }}>
              <div style={{ fontSize:"10px", letterSpacing:"0.1em", marginBottom:"5px", opacity:0.6 }}>{msg.role==="user"?"YOU":"CLAUDE"}</div>
              {msg.content}
            </div>
          ))}
          {loading && (
            <div style={{ padding:"10px 14px", background:"rgba(170,136,255,0.06)", border:"1px solid rgba(170,136,255,0.15)", borderRadius:"8px", color:"#cc99ff", fontSize:"13px" }}>
              <div style={{ fontSize:"10px", marginBottom:"5px", opacity:0.6 }}>CLAUDE</div>
              <Spinner/> Analyzing live market data…
            </div>
          )}
        </div>
        <div style={{ display:"flex", gap:"8px" }}>
          <textarea value={question} onChange={e=>setQuestion(e.target.value)} onKeyDown={handleKey} placeholder="Ask about probability, edge, or market dynamics…" style={{ flex:1, height:"64px", background:"rgba(0,0,0,0.4)", border:"1px solid rgba(170,136,255,0.2)", borderRadius:"7px", color:"#e0e0ff", padding:"10px", fontSize:"13px", fontFamily:"inherit", resize:"none" }} />
          <button onClick={analyze} disabled={loading||!question.trim()} style={{ width:"50px", borderRadius:"7px", border:"1px solid rgba(170,136,255,0.4)", background:"rgba(170,136,255,0.1)", color:"#cc99ff", fontSize:"20px", cursor:loading?"wait":"pointer" }}>→</button>
        </div>
        <div style={{ fontSize:"11px", color:"#4a6a88", marginTop:"6px" }}>Enter to send · Shift+Enter for new line</div>
      </Card>
    </div>
  );
}
