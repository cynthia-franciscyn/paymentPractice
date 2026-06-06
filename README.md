# Chocolate Cake Shop — Razorpay Demo

A minimal Node.js + Express app that demonstrates Razorpay payment integration.

## Features
- Single product: Chocolate Cake (₹1)
- Add to Cart with quantity tracking
- Buy Now (instant single-unit purchase)
- Cart Checkout (pay for all items in cart)
- Server-side order creation & payment signature verification

---

## Quick Start

### 1. Install dependencies
```bash
npm install
```

### 2. Set up environment variables
```bash
cp .env.example .env
```
Open `.env` and paste your Razorpay API keys:
```
RAZORPAY_KEY_ID=rzp_test_XXXXXXXXXXXXXXXX
RAZORPAY_KEY_SECRET=your_secret_key
```
Get your keys at → https://dashboard.razorpay.com/app/keys  
Use **Test Mode** keys while developing.

### 3. Start the server
```bash
npm start
```

### 4. Open the app
Visit http://localhost:3000 in your browser.

---

## Folder Structure
```
project/
├── public/
│   ├── index.html   # Frontend UI
│   ├── style.css    # Minimal styles
│   └── app.js       # Frontend JS (cart + Razorpay checkout)
├── server.js        # Express server (order creation + verification)
├── package.json
├── .env.example     # Template for environment variables
└── README.md
```

---

## How It Works

### Payment Flow
1. User clicks **Buy Now** or **Checkout**
2. Frontend calls `POST /create-order` on the server
3. Server creates a Razorpay order (amount calculated server-side)
4. Server returns `order_id`, `amount`, and the public `key_id`
5. Frontend opens the Razorpay checkout modal
6. User completes payment inside the modal
7. Razorpay calls the `handler` function with payment details
8. Frontend calls `POST /verify-payment` with the signature
9. Server verifies the HMAC-SHA256 signature using the secret key
10. Server responds with success/failure

### Security Notes
- **Secret key is never sent to the browser** — it lives only in `.env` and `server.js`
- **Amount is calculated on the server** — the client sends only `quantity`
- **Signature is verified server-side** — prevents fake payment confirmations
- **No inline event handlers** — all JS uses `addEventListener`

---

## Test Cards (Razorpay Test Mode)
| Card Number         | Expiry | CVV | Result  |
|---------------------|--------|-----|---------|
| 4111 1111 1111 1111 | Any    | Any | Success |
| 5267 3181 8797 5449 | Any    | Any | Success |

UPI Test: `success@razorpay`

---

## Development (auto-restart on file changes)
```bash
npm run dev
```
Requires `nodemon` (included in devDependencies).
