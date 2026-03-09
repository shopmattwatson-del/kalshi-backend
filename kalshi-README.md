# KalshiPRO Backend — Deployment Guide

## What This Is
A FastAPI backend that securely signs Kalshi API requests using your RSA private key.
It acts as a proxy between the React frontend and Kalshi's servers.

---

## Step 1 — Get Your Kalshi API Credentials

1. Log into **kalshi.com**
2. Go to **Settings → API**
3. Click **"Create API Key"**
4. Download/copy two things:
   - **API Key ID** (looks like: `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`)
   - **Private Key** (a `.pem` file starting with `-----BEGIN PRIVATE KEY-----`)

Keep these safe. Never commit them to Git.

---

## Step 2 — Deploy to Railway

### 2a. Install Railway CLI
```bash
# Mac
brew install railway

# Windows (PowerShell)
iwr -useb https://raw.githubusercontent.com/railwayapp/setup/master/setup.ps1 | iex
```

### 2b. Create a GitHub repo and push this folder
```bash
cd kalshi-backend
git init
git add .
git commit -m "Initial KalshiPRO backend"
# Create a new repo on github.com, then:
git remote add origin https://github.com/YOUR_USERNAME/kalshi-backend.git
git push -u origin main
```

### 2c. Deploy on Railway
1. Go to **railway.app** and sign in with GitHub
2. Click **"New Project" → "Deploy from GitHub repo"**
3. Select your `kalshi-backend` repo
4. Railway auto-detects Python and deploys

### 2d. Set Environment Variables on Railway
In your Railway project dashboard:
1. Click your service → **"Variables"** tab
2. Add these two variables:

| Variable | Value |
|---|---|
| `KALSHI_API_KEY_ID` | Your API Key ID from Kalshi |
| `KALSHI_PRIVATE_KEY` | Your full PEM key (paste the entire contents, newlines included) |

**For the private key**, paste the entire `.pem` file content including the header/footer lines.
Railway handles multi-line env vars correctly.

### 2e. Get Your Railway URL
After deploy completes, click **"Settings"** in Railway → copy the public URL.
It looks like: `https://kalshi-backend-production.up.railway.app`

---

## Step 3 — Connect the Frontend

1. Open the React app (the artifact in Claude)
2. Click **⚙ CONFIG** in the top right
3. Paste your Railway URL into the input field
4. Press Tab — the status dot should turn **green** within seconds

---

## Step 4 — Verify It's Working

Visit these URLs in your browser to confirm:

```
https://YOUR-RAILWAY-URL.up.railway.app/health
→ Should return: {"status":"ok","configured":true,...}

https://YOUR-RAILWAY-URL.up.railway.app/markets?limit=5
→ Should return live Kalshi market data

https://YOUR-RAILWAY-URL.up.railway.app/portfolio/balance
→ Should return your real account balance
```

---

## Step 5 — Enable Live Order Execution (Optional)

The trading bot runs in **paper trading mode by default** — it logs signals but doesn't place real orders.

To enable real order execution, open `main.py` and the bot section in `frontend.jsx`:
- In the bot's `runBot()` function, uncomment the `fetch(...)` order placement call
- Make sure you understand Kalshi's fee structure and market liquidity before enabling

**Start with small order sizes (1-5 contracts) to test.**

---

## API Endpoints Reference

| Endpoint | Auth | Description |
|---|---|---|
| `GET /health` | None | Backend health + config status |
| `GET /markets` | None | Live open markets |
| `GET /markets/{ticker}` | None | Single market detail |
| `GET /markets/{ticker}/orderbook` | None | Live order book |
| `GET /portfolio/balance` | ✅ | Your account balance |
| `GET /portfolio/positions` | ✅ | Your open positions |
| `GET /portfolio/orders` | ✅ | Your resting orders |
| `POST /portfolio/orders` | ✅ | Place a new order |
| `DELETE /portfolio/orders/{id}` | ✅ | Cancel an order |

---

## Local Testing (Before Deploying)

```bash
# Install dependencies
pip install -r requirements.txt

# Set env vars
export KALSHI_API_KEY_ID="your-key-id"
export KALSHI_PRIVATE_KEY="$(cat /path/to/private_key.pem)"

# Run locally
uvicorn main:app --reload --port 8000

# Test
curl http://localhost:8000/health
curl http://localhost:8000/portfolio/balance
```

---

## Troubleshooting

**`configured: false` on /health**
→ KALSHI_PRIVATE_KEY or KALSHI_API_KEY_ID env vars aren't set on Railway

**401 Unauthorized from Kalshi**
→ API Key ID is wrong, or the private key doesn't match it

**`-----BEGIN PRIVATE KEY-----` formatting issues**
→ In Railway, paste the key with literal newlines (it supports multi-line values)

**CORS errors in browser**
→ The backend allows all origins by default (`allow_origins=["*"]`). This is fine for personal use.
