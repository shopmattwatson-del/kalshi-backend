"""
KalshiPRO Backend — FastAPI proxy that handles RSA-PSS signing for Kalshi API
Deploy to Railway or Render. Set env vars: KALSHI_API_KEY_ID, KALSHI_PRIVATE_KEY
"""

import os
import base64
import hashlib
import time
import json
import httpx
from datetime import datetime, timezone

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import Optional
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.backends import default_backend

# ── CONFIG ────────────────────────────────────────────────────────────────────
KALSHI_BASE = "https://api.elections.kalshi.com/trade-api/v2"
API_KEY_ID  = os.environ.get("KALSHI_API_KEY_ID", "")
PRIVATE_KEY_PEM = os.environ.get("KALSHI_PRIVATE_KEY", "")  # Full PEM string

app = FastAPI(title="KalshiPRO Backend", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],   # Tighten this to your frontend domain after deploy
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── RSA-PSS SIGNING ───────────────────────────────────────────────────────────
def get_private_key():
    if not PRIVATE_KEY_PEM:
        raise HTTPException(500, "KALSHI_PRIVATE_KEY env var not set")
    pem = PRIVATE_KEY_PEM.replace("\\n", "\n").encode()
    return serialization.load_pem_private_key(pem, password=None, backend=default_backend())

def make_signature(method: str, path: str, timestamp_ms: str, body: str = "") -> str:
    """Create RSA-PSS signature as required by Kalshi API."""
    msg = timestamp_ms + method.upper() + path + body
    private_key = get_private_key()
    signature = private_key.sign(
        msg.encode("utf-8"),
        padding.PSS(
            mgf=padding.MGF1(hashes.SHA256()),
            salt_length=padding.PSS.DIGEST_LENGTH,
        ),
        hashes.SHA256(),
    )
    return base64.b64encode(signature).decode()

def auth_headers(method: str, path: str, body: str = "") -> dict:
    if not API_KEY_ID:
        raise HTTPException(500, "KALSHI_API_KEY_ID env var not set")
    ts = str(int(time.time() * 1000))
    sig = make_signature(method, path, ts, body)
    return {
        "Content-Type": "application/json",
        "KALSHI-ACCESS-KEY": API_KEY_ID,
        "KALSHI-ACCESS-TIMESTAMP": ts,
        "KALSHI-ACCESS-SIGNATURE": sig,
    }

# ── HELPERS ───────────────────────────────────────────────────────────────────
async def kalshi_get(path: str, params: dict = None, require_auth: bool = True):
    full_path = path
    if params:
        qs = "&".join(f"{k}={v}" for k, v in params.items() if v is not None)
        if qs:
            full_path = f"{path}?{qs}"
    headers = auth_headers("GET", full_path) if require_auth else {"Content-Type": "application/json"}
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.get(f"{KALSHI_BASE}{full_path}", headers=headers)
        if not r.is_success:
            raise HTTPException(r.status_code, r.text)
        return r.json()

async def kalshi_post(path: str, body: dict):
    body_str = json.dumps(body)
    headers = auth_headers("POST", path, body_str)
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.post(f"{KALSHI_BASE}{path}", headers=headers, content=body_str)
        if not r.is_success:
            raise HTTPException(r.status_code, r.text)
        return r.json()

async def kalshi_delete(path: str):
    headers = auth_headers("DELETE", path)
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.delete(f"{KALSHI_BASE}{path}", headers=headers)
        if not r.is_success:
            raise HTTPException(r.status_code, r.text)
        return r.json()

# ── PUBLIC ENDPOINTS (no auth) ────────────────────────────────────────────────
@app.get("/health")
async def health():
    configured = bool(API_KEY_ID and PRIVATE_KEY_PEM)
    return {"status": "ok", "configured": configured, "timestamp": datetime.now(timezone.utc).isoformat()}

@app.get("/markets")
async def get_markets(limit: int = 25, status: str = "open", cursor: Optional[str] = None):
    params = {"limit": limit, "status": status}
    if cursor:
        params["cursor"] = cursor
    return await kalshi_get("/markets", params, require_auth=False)

@app.get("/markets/{ticker}")
async def get_market(ticker: str):
    return await kalshi_get(f"/markets/{ticker}", require_auth=False)

@app.get("/markets/{ticker}/orderbook")
async def get_orderbook(ticker: str, depth: int = 10):
    return await kalshi_get(f"/markets/{ticker}/orderbook", {"depth": depth}, require_auth=False)

@app.get("/events")
async def get_events(limit: int = 20, status: str = "open"):
    return await kalshi_get("/events", {"limit": limit, "status": status}, require_auth=False)

# ── AUTHENTICATED ENDPOINTS ───────────────────────────────────────────────────
@app.get("/portfolio/balance")
async def get_balance():
    return await kalshi_get("/portfolio/balance")

@app.get("/portfolio/positions")
async def get_positions(limit: int = 100, cursor: Optional[str] = None):
    params = {"limit": limit}
    if cursor:
        params["cursor"] = cursor
    return await kalshi_get("/portfolio/positions", params)

@app.get("/portfolio/orders")
async def get_orders(status: Optional[str] = None, limit: int = 100):
    params = {"limit": limit}
    if status:
        params["status"] = status
    return await kalshi_get("/portfolio/orders", params)

@app.get("/portfolio/fills")
async def get_fills(limit: int = 50):
    return await kalshi_get("/portfolio/fills", {"limit": limit})

# ── ORDER MODELS ──────────────────────────────────────────────────────────────
class OrderRequest(BaseModel):
    ticker: str
    action: str          # "buy" or "sell"
    side: str            # "yes" or "no"
    count: int           # number of contracts
    type: str            # "limit" or "market"
    yes_price: Optional[int] = None   # cents (1-99), required for limit
    no_price: Optional[int] = None
    client_order_id: Optional[str] = None

class AmendRequest(BaseModel):
    count: Optional[int] = None
    yes_price: Optional[int] = None
    no_price: Optional[int] = None

# ── ORDER ENDPOINTS ───────────────────────────────────────────────────────────
@app.post("/portfolio/orders")
async def place_order(order: OrderRequest):
    body = {
        "ticker": order.ticker,
        "action": order.action,
        "side": order.side,
        "count": order.count,
        "type": order.type,
    }
    if order.yes_price is not None:
        body["yes_price"] = order.yes_price
    if order.no_price is not None:
        body["no_price"] = order.no_price
    if order.client_order_id:
        body["client_order_id"] = order.client_order_id
    return await kalshi_post("/portfolio/orders", body)

@app.delete("/portfolio/orders/{order_id}")
async def cancel_order(order_id: str):
    return await kalshi_delete(f"/portfolio/orders/{order_id}")

@app.post("/portfolio/orders/{order_id}/amend")
async def amend_order(order_id: str, req: AmendRequest):
    body = {k: v for k, v in req.dict().items() if v is not None}
    return await kalshi_post(f"/portfolio/orders/{order_id}/amend", body)

# ── EXCHANGE STATUS ───────────────────────────────────────────────────────────
@app.get("/exchange/status")
async def exchange_status():
    return await kalshi_get("/exchange/status", require_auth=False)
