"""
KalshiPRO Backend v5 - FastAPI proxy with RSA-PSS signing + WebSocket proxy
"""
import os, base64, time, json, asyncio
import httpx
from datetime import datetime, timezone
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.backends import default_backend

KALSHI_BASE   = "https://api.elections.kalshi.com/trade-api/v2"
KALSHI_WS_URL = "wss://api.elections.kalshi.com/trade-api/ws/v2"
API_KEY_ID      = os.environ.get("KALSHI_API_KEY_ID", "")
PRIVATE_KEY_PEM = os.environ.get("KALSHI_PRIVATE_KEY", "")

app = FastAPI(title="KalshiPRO", version="5.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=False,
                   allow_methods=["*"], allow_headers=["*"])

def get_private_key():
    if not PRIVATE_KEY_PEM:
        raise HTTPException(500, "KALSHI_PRIVATE_KEY not set")
    pem = PRIVATE_KEY_PEM.replace("\\n", "\n").encode()
    return serialization.load_pem_private_key(pem, password=None, backend=default_backend())

def make_signature(method, path, ts):
    clean = path.split("?")[0]
    full  = f"/trade-api/v2{clean}" if not clean.startswith("/trade-api") else clean
    msg   = ts + method.upper() + full
    key   = get_private_key()
    sig   = key.sign(msg.encode(), padding.PSS(mgf=padding.MGF1(hashes.SHA256()),
                     salt_length=padding.PSS.DIGEST_LENGTH), hashes.SHA256())
    return base64.b64encode(sig).decode()

def auth_headers(method, path):
    ts = str(int(time.time() * 1000))
    return {"Content-Type": "application/json",
            "KALSHI-ACCESS-KEY": API_KEY_ID,
            "KALSHI-ACCESS-TIMESTAMP": ts,
            "KALSHI-ACCESS-SIGNATURE": make_signature(method, path, ts)}

async def kget(path, params=None, auth=True):
    fp = path
    if params:
        qs = "&".join(f"{k}={v}" for k,v in params.items() if v is not None)
        if qs: fp = f"{path}?{qs}"
    h = auth_headers("GET", fp) if auth else {"Content-Type": "application/json"}
    async with httpx.AsyncClient(timeout=15) as c:
        r = await c.get(f"{KALSHI_BASE}{fp}", headers=h)
        if not r.is_success: raise HTTPException(r.status_code, r.text)
        return r.json()

async def kpost(path, body):
    bs = json.dumps(body)
    async with httpx.AsyncClient(timeout=15) as c:
        r = await c.post(f"{KALSHI_BASE}{path}", headers=auth_headers("POST", path), content=bs)
        if not r.is_success: raise HTTPException(r.status_code, r.text)
        return r.json()

async def kdelete(path):
    async with httpx.AsyncClient(timeout=10) as c:
        r = await c.delete(f"{KALSHI_BASE}{path}", headers=auth_headers("DELETE", path))
        if not r.is_success: raise HTTPException(r.status_code, r.text)
        return r.json()

@app.get("/health")
async def health():
    return {"status": "ok", "configured": bool(API_KEY_ID and PRIVATE_KEY_PEM),
            "key_id_preview": API_KEY_ID[:8]+"..." if API_KEY_ID else "NOT SET",
            "version": "5.0.0", "timestamp": datetime.now(timezone.utc).isoformat()}

@app.get("/markets")
async def get_markets(limit: int=25, status: str="open", cursor: Optional[str]=None,
                      event_ticker: Optional[str]=None, series_ticker: Optional[str]=None):
    p = {"limit": limit, "status": status}
    if cursor: p["cursor"] = cursor
    if event_ticker: p["event_ticker"] = event_ticker
    if series_ticker: p["series_ticker"] = series_ticker
    return await kget("/markets", p, auth=False)

@app.get("/markets/{ticker}")
async def get_market(ticker: str): return await kget(f"/markets/{ticker}", auth=False)

@app.get("/markets/{ticker}/orderbook")
async def get_orderbook(ticker: str, depth: int=10):
    return await kget(f"/markets/{ticker}/orderbook", {"depth": depth}, auth=False)

@app.get("/events")
async def get_events(limit: int=100, status: str="open", cursor: Optional[str]=None):
    p = {"limit": limit, "status": status}
    if cursor: p["cursor"] = cursor
    return await kget("/events", p, auth=False)

@app.get("/portfolio/balance")
async def get_balance(): return await kget("/portfolio/balance")

@app.get("/portfolio/positions")
async def get_positions(limit: int=100, cursor: Optional[str]=None):
    p = {"limit": limit}
    if cursor: p["cursor"] = cursor
    return await kget("/portfolio/positions", p)

@app.get("/portfolio/orders")
async def get_orders(status: Optional[str]=None, limit: int=100):
    p = {"limit": limit}
    if status: p["status"] = status
    return await kget("/portfolio/orders", p)

@app.get("/portfolio/fills")
async def get_fills(limit: int=50): return await kget("/portfolio/fills", {"limit": limit})

class OrderRequest(BaseModel):
    ticker: str; action: str; side: str; count: int; type: str
    yes_price: Optional[int]=None; no_price: Optional[int]=None
    client_order_id: Optional[str]=None

class AmendRequest(BaseModel):
    count: Optional[int]=None; yes_price: Optional[int]=None; no_price: Optional[int]=None

@app.post("/portfolio/orders")
async def place_order(o: OrderRequest):
    b = {"ticker": o.ticker, "action": o.action, "side": o.side, "count": o.count, "type": o.type}
    if o.yes_price is not None: b["yes_price"] = o.yes_price
    if o.no_price is not None: b["no_price"] = o.no_price
    if o.client_order_id: b["client_order_id"] = o.client_order_id
    return await kpost("/portfolio/orders", b)

@app.delete("/portfolio/orders/{order_id}")
async def cancel_order(order_id: str): return await kdelete(f"/portfolio/orders/{order_id}")

@app.post("/portfolio/orders/{order_id}/amend")
async def amend_order(order_id: str, req: AmendRequest):
    return await kpost(f"/portfolio/orders/{order_id}/amend",
                       {k: v for k,v in req.dict().items() if v is not None})

@app.get("/exchange/status")
async def exchange_status(): return await kget("/exchange/status", auth=False)

import websockets

@app.websocket("/ws")
async def ws_proxy(ws: WebSocket):
    await ws.accept()
    ts  = str(int(time.time() * 1000))
    sig = make_signature("GET", "/ws", ts)
    hdrs = {"KALSHI-ACCESS-KEY": API_KEY_ID,
            "KALSHI-ACCESS-TIMESTAMP": ts,
            "KALSHI-ACCESS-SIGNATURE": sig}

    async def run_proxy(kws):
        async def to_client():
            async for msg in kws:
                try: await ws.send_text(msg if isinstance(msg, str) else msg.decode())
                except: break
        async def to_kalshi():
            try:
                while True:
                    data = await ws.receive_text()
                    await kws.send(data)
            except: pass
        await asyncio.gather(to_client(), to_kalshi())

    try:
        try:
            async with websockets.connect(KALSHI_WS_URL, additional_headers=hdrs) as kws:
                await run_proxy(kws)
        except TypeError:
            async with websockets.connect(KALSHI_WS_URL, extra_headers=hdrs) as kws:
                await run_proxy(kws)
    except Exception as e:
        try: await ws.send_text(json.dumps({"type": "error", "msg": str(e)}))
        except: pass
    finally:
        try: await ws.close()
        except: pass
