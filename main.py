"""
KalshiPRO Backend - FastAPI proxy that handles RSA-PSS signing for Kalshi API
"""

import os
import base64
import time
import json
import httpx

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.backends import default_backend

KALSHI_BASE = "https://api.elections.kalshi.com/trade-api/v2"
API_KEY_ID  = os.environ.get("KALSHI_API_KEY_ID", "")
PRIVATE_KEY_PEM = os.environ.get("KALSHI_PRIVATE_KEY", "")

app = FastAPI(title="KalshiPRO Backend", version="3.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

def normalize_pem(raw: str) -> str:
    """Handle all the ways Railway might store the PEM key."""
    # Replace literal backslash-n with real newline
    pem = raw.replace("\\n", "\n").replace("\n", "\n")
    # If still no real newlines in the body, try splitting on spaces after base64 chunks
    if "-----BEGIN" in pem and pem.count("\n") < 3:
        # Try to reconstruct by splitting at standard PEM boundaries
        pem = pem.replace("-----BEGIN RSA PRIVATE KEY----- ", "-----BEGIN RSA PRIVATE KEY-----\n")
        pem = pem.replace(" -----END RSA PRIVATE KEY-----", "\n-----END RSA PRIVATE KEY-----")
    return pem.strip()

def get_private_key():
    if not PRIVATE_KEY_PEM:
        raise HTTPException(500, "KALSHI_PRIVATE_KEY env var not set")
    pem = normalize_pem(PRIVATE_KEY_PEM)
    try:
        return serialization.load_pem_private_key(pem.encode("utf-8"), password=None, backend=default_backend())
    except Exception as e:
        raise HTTPException(500, f"Key load failed: {repr(e)[:300]}")

def make_signature(method: str, path: str, timestamp_ms: str) -> str:
    path_no_query = path.split("?")[0]
    full_path = f"/trade-api/v2{path_no_query}" if not path_no_query.startswith("/trade-api") else path_no_query
    msg = (timestamp_ms + method.upper() + full_path).encode("utf-8")
    sig = get_private_key().sign(msg, padding.PSS(mgf=padding.MGF1(hashes.SHA256()), salt_length=padding.PSS.DIGEST_LENGTH), hashes.SHA256())
    return base64.b64encode(sig).decode()

def auth_headers(method: str, path: str) -> dict:
    if not API_KEY_ID:
        raise HTTPException(500, "KALSHI_API_KEY_ID not set")
    ts = str(int(time.time() * 1000))
    return {"Content-Type": "application/json", "KALSHI-ACCESS-KEY": API_KEY_ID, "KALSHI-ACCESS-TIMESTAMP": ts, "KALSHI-ACCESS-SIGNATURE": make_signature(method, path, ts)}

@app.get("/health")
def health():
    pem = PRIVATE_KEY_PEM
    return {"status": "ok", "configured": bool(API_KEY_ID and pem), "key_length": len(pem), "has_begin": "BEGIN" in pem, "newline_count": pem.count("\n"), "first_60_chars": pem[:60], "last_40_chars": pem[-40:]}

@app.get("/markets")
async def get_markets(limit: int = 20):
    async with httpx.AsyncClient() as c:
        r = await c.get(f"{KALSHI_BASE}/markets", params={"limit": limit}, timeout=15)
    return r.json()

@app.get("/events")
async def get_events(limit: int = 20):
    async with httpx.AsyncClient() as c:
        r = await c.get(f"{KALSHI_BASE}/events", params={"limit": limit}, timeout=15)
    return r.json()

@app.get("/markets/{ticker}/orderbook")
async def get_orderbook(ticker: str, depth: int = 10):
    async with httpx.AsyncClient() as c:
        r = await c.get(f"{KALSHI_BASE}/markets/{ticker}/orderbook", params={"depth": depth}, timeout=15)
    return r.json()

@app.get("/exchange/status")
async def exchange_status():
    async with httpx.AsyncClient() as c:
        r = await c.get(f"{KALSHI_BASE}/exchange/status", timeout=15)
    return r.json()

@app.get("/portfolio/balance")
async def get_balance():
    path = "/portfolio/balance"
    async with httpx.AsyncClient() as c:
        r = await c.get(f"{KALSHI_BASE}{path}", headers=auth_headers("GET", path), timeout=15)
    if r.status_code != 200:
        raise HTTPException(r.status_code, r.text)
    return r.json()

@app.get("/portfolio/positions")
async def get_positions(limit: int = 100):
    path = "/portfolio/positions"
    async with httpx.AsyncClient() as c:
        r = await c.get(f"{KALSHI_BASE}{path}", headers=auth_headers("GET", path), params={"limit": limit}, timeout=15)
    if r.status_code != 200:
        raise HTTPException(r.status_code, r.text)
    return r.json()

@app.get("/portfolio/orders")
async def get_orders(limit: int = 100, status: str = None):
    path = "/portfolio/orders"
    params = {"limit": limit}
    if status: params["status"] = status
    async with httpx.AsyncClient() as c:
        r = await c.get(f"{KALSHI_BASE}{path}", headers=auth_headers("GET", path), params=params, timeout=15)
    if r.status_code != 200:
        raise HTTPException(r.status_code, r.text)
    return r.json()

@app.get("/portfolio/fills")
async def get_fills(limit: int = 100):
    path = "/portfolio/fills"
    async with httpx.AsyncClient() as c:
        r = await c.get(f"{KALSHI_BASE}{path}", headers=auth_headers("GET", path), params={"limit": limit}, timeout=15)
    if r.status_code != 200:
        raise HTTPException(r.status_code, r.text)
    return r.json()

class OrderRequest(BaseModel):
    ticker: str
    side: str
    type: str = "limit"
    count: int = 1
    yes_price: Optional[int] = None
    no_price: Optional[int] = None
    action: str = "buy"

@app.post("/portfolio/orders")
async def place_order(order: OrderRequest):
    path = "/portfolio/orders"
    async with httpx.AsyncClient() as c:
        r = await c.post(f"{KALSHI_BASE}{path}", headers=auth_headers("POST", path), content=json.dumps(order.dict(exclude_none=True)), timeout=15)
    if r.status_code not in (200, 201):
        raise HTTPException(r.status_code, r.text)
    return r.json()

@app.delete("/portfolio/orders/{order_id}")
async def cancel_order(order_id: str):
    path = f"/portfolio/orders/{order_id}"
    async with httpx.AsyncClient() as c:
        r = await c.delete(f"{KALSHI_BASE}{path}", headers=auth_headers("DELETE", path), timeout=15)
    if r.status_code not in (200, 204):
        raise HTTPException(r.status_code, r.text)
    return {"cancelled": order_id}
