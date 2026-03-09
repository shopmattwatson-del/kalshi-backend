# v3.1
"""
KalshiPRO Backend - FastAPI proxy that handles RSA-PSS signing for Kalshi API
Deploy to Railway. Set env vars: KALSHI_API_KEY_ID, KALSHI_PRIVATE_KEY
"""

import os
import base64
import time
import json
import httpx
from datetime import datetime, timezone

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.backends import default_backend

# CONFIG
KALSHI_BASE = "https://api.elections.kalshi.com/trade-api/v2"
API_KEY_ID  = os.environ.get("KALSHI_API_KEY_ID", "")
PRIVATE_KEY_PEM = os.environ.get("KALSHI_PRIVATE_KEY", "")

app = FastAPI(title="KalshiPRO Backend", version="3.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Key loading ──────────────────────────────────────────────────────────────

def get_private_key():
    if not PRIVATE_KEY_PEM:
        raise HTTPException(500, "KALSHI_PRIVATE_KEY env var not set")
    
    # Normalize: replace literal \n with real newlines
    pem = PRIVATE_KEY_PEM.replace("\\n", "\n").replace("\n", "\n").strip()
    pem_bytes = pem.encode("utf-8")
    
    # Try loading with RSAPublicNumbers approach for PKCS#1 (BEGIN RSA PRIVATE KEY)
    # The cryptography library needs backend=None for newer versions
    try:
        return serialization.load_pem_private_key(pem_bytes, password=None)
    except Exception as e1:
        try:
            return serialization.load_pem_private_key(pem_bytes, password=None, backend=default_backend())
        except Exception as e2:
            raise HTTPException(500, f"Key load failed: {repr(e1)}, {repr(e2)}")

# ── Signing ──────────────────────────────────────────────────────────────────

def make_signature(method: str, path: str, timestamp_ms: str) -> str:
    path_no_query = path.split("?")[0]
    if not path_no_query.startswith("/trade-api"):
        full_path = f"/trade-api/v2{path_no_query}"
    else:
        full_path = path_no_query

    msg = (timestamp_ms + method.upper() + full_path).encode("utf-8")
    private_key = get_private_key()
    signature = private_key.sign(
        msg,
        padding.PSS(
            mgf=padding.MGF1(hashes.SHA256()),
            salt_length=padding.PSS.DIGEST_LENGTH,
        ),
        hashes.SHA256(),
    )
    return base64.b64encode(signature).decode()


def auth_headers(method: str, path: str) -> dict:
    if not API_KEY_ID:
        raise HTTPException(500, "KALSHI_API_KEY_ID env var not set")
    ts = str(int(time.time() * 1000))
    sig = make_signature(method, path, ts)
    return {
        "Content-Type": "application/json",
        "KALSHI-ACCESS-KEY": API_KEY_ID,
        "KALSHI-ACCESS-TIMESTAMP": ts,
        "KALSHI-ACCESS-SIGNATURE": sig,
    }

# ── Routes ───────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    pem = PRIVATE_KEY_PEM.replace("\\n", "\n").strip()
    # Try to actually load the key and report status
    try:
        get_private_key()
        key_status = "loaded_ok"
    except Exception as e:
        key_status = f"error: {str(e)[:100]}"
    return {
        "status": "ok",
        "configured": bool(API_KEY_ID and PRIVATE_KEY_PEM),
        "key_id_preview": API_KEY_ID[:8] + "..." if API_KEY_ID else "NOT SET",
        "key_status": key_status,
        "key_length": len(pem),
        "has_begin": "BEGIN" in pem,
    }


@app.get("/markets")
async def get_markets(limit: int = 20, cursor: str = None, status: str = None,
                      series_ticker: str = None, event_ticker: str = None):
    params = {"limit": limit}
    if cursor:        params["cursor"] = cursor
    if status:        params["status"] = status
    if series_ticker: params["series_ticker"] = series_ticker
    if event_ticker:  params["event_ticker"] = event_ticker
    async with httpx.AsyncClient() as client:
        r = await client.get(f"{KALSHI_BASE}/markets", params=params, timeout=15)
    return r.json()


@app.get("/events")
async def get_events(limit: int = 20, cursor: str = None, status: str = None):
    params = {"limit": limit}
    if cursor: params["cursor"] = cursor
    if status: params["status"] = status
    async with httpx.AsyncClient() as client:
        r = await client.get(f"{KALSHI_BASE}/events", params=params, timeout=15)
    return r.json()


@app.get("/markets/{ticker}/orderbook")
async def get_orderbook(ticker: str, depth: int = 10):
    async with httpx.AsyncClient() as client:
        r = await client.get(f"{KALSHI_BASE}/markets/{ticker}/orderbook",
                             params={"depth": depth}, timeout=15)
    return r.json()


@app.get("/exchange/status")
async def exchange_status():
    async with httpx.AsyncClient() as client:
        r = await client.get(f"{KALSHI_BASE}/exchange/status", timeout=15)
    return r.json()


@app.get("/portfolio/balance")
async def get_balance():
    path = "/portfolio/balance"
    headers = auth_headers("GET", path)
    async with httpx.AsyncClient() as client:
        r = await client.get(f"{KALSHI_BASE}{path}", headers=headers, timeout=15)
    if r.status_code != 200:
        raise HTTPException(r.status_code, r.text)
    return r.json()


@app.get("/portfolio/positions")
async def get_positions(limit: int = 100, cursor: str = None, ticker: str = None):
    path = "/portfolio/positions"
    params = {"limit": limit}
    if cursor: params["cursor"] = cursor
    if ticker: params["ticker"] = ticker
    headers = auth_headers("GET", path)
    async with httpx.AsyncClient() as client:
        r = await client.get(f"{KALSHI_BASE}{path}", headers=headers,
                             params=params, timeout=15)
    if r.status_code != 200:
        raise HTTPException(r.status_code, r.text)
    return r.json()


@app.get("/portfolio/orders")
async def get_orders(limit: int = 100, cursor: str = None, ticker: str = None,
                     status: str = None):
    path = "/portfolio/orders"
    params = {"limit": limit}
    if cursor: params["cursor"] = cursor
    if ticker: params["ticker"] = ticker
    if status: params["status"] = status
    headers = auth_headers("GET", path)
    async with httpx.AsyncClient() as client:
        r = await client.get(f"{KALSHI_BASE}{path}", headers=headers,
                             params=params, timeout=15)
    if r.status_code != 200:
        raise HTTPException(r.status_code, r.text)
    return r.json()


@app.get("/portfolio/fills")
async def get_fills(limit: int = 100, cursor: str = None, ticker: str = None):
    path = "/portfolio/fills"
    params = {"limit": limit}
    if cursor: params["cursor"] = cursor
    if ticker: params["ticker"] = ticker
    headers = auth_headers("GET", path)
    async with httpx.AsyncClient() as client:
        r = await client.get(f"{KALSHI_BASE}{path}", headers=headers,
                             params=params, timeout=15)
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
    expiration_ts: Optional[int] = None
    client_order_id: Optional[str] = None


@app.post("/portfolio/orders")
async def place_order(order: OrderRequest):
    path = "/portfolio/orders"
    body_dict = order.dict(exclude_none=True)
    body_str = json.dumps(body_dict)
    headers = auth_headers("POST", path)
    async with httpx.AsyncClient() as client:
        r = await client.post(f"{KALSHI_BASE}{path}", headers=headers,
                              content=body_str, timeout=15)
    if r.status_code not in (200, 201):
        raise HTTPException(r.status_code, r.text)
    return r.json()


@app.delete("/portfolio/orders/{order_id}")
async def cancel_order(order_id: str):
    path = f"/portfolio/orders/{order_id}"
    headers = auth_headers("DELETE", path)
    async with httpx.AsyncClient() as client:
        r = await client.delete(f"{KALSHI_BASE}{path}", headers=headers, timeout=15)
    if r.status_code not in (200, 204):
        raise HTTPException(r.status_code, r.text)
    return {"cancelled": order_id}
