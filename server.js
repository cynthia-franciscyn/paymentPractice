// server.js — Node.js + Express backend for Razorpay integration

const express   = require("express");
const Razorpay  = require("razorpay");
const crypto    = require("crypto");   // built-in Node module for signature verification
const path      = require("path");
require("dotenv").config();            // load variables from .env

const app  = express();
const PORT = process.env.PORT || 3000;

// ─── Middleware ───────────────────────────────────────────────────────────────

app.use(express.json());                             // parse JSON request bodies
app.use(express.static(path.join(__dirname, "public"))); // serve frontend files

// ─── Razorpay client ──────────────────────────────────────────────────────────

// The secret key is ONLY used on the server — it is never sent to the browser
const razorpay = new Razorpay({
  key_id:     process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// ─── Product definition ───────────────────────────────────────────────────────

// Single source of truth for pricing — the client cannot alter this
const PRODUCT = {
  name:         "Chocolate Cake",
  priceInPaise: 100, // ₹1 = 100 paise
};

// ─── Routes ───────────────────────────────────────────────────────────────────

/**
 * POST /create-order
 * Body: { quantity: number }
 *
 * Creates a Razorpay order and returns the details needed by the frontend.
 * Amount is calculated server-side so the client cannot tamper with it.
 */
app.post("/create-order", async (req, res) => {
  try {
    const quantity = parseInt(req.body.quantity, 10);

    // Basic validation
    if (!quantity || quantity < 1) {
      return res.status(400).json({ error: "Invalid quantity" });
    }

    const amount = PRODUCT.priceInPaise * quantity; // amount in paise

    const order = await razorpay.orders.create({
      amount,
      currency: "INR",
      receipt:  `receipt_${Date.now()}`,    // unique receipt ID
    });

    // Send back only what the frontend needs (NOT the secret key)
    res.json({
      orderId:  order.id,
      amount:   order.amount,
      currency: order.currency,
      keyId:    process.env.RAZORPAY_KEY_ID, // safe to expose
    });

  } catch (err) {
    console.error("Error creating order:", err);
    res.status(500).json({ error: "Could not create order" });
  }
});

/**
 * POST /verify-payment
 * Body: { razorpay_order_id, razorpay_payment_id, razorpay_signature }
 *
 * Verifies the HMAC-SHA256 signature that Razorpay sends after a payment.
 * This prevents fake "payment successful" calls from the browser.
 */
app.post("/verify-payment", (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ success: false, error: "Missing payment fields" });
    }

    // Razorpay signature = HMAC-SHA256(order_id + "|" + payment_id, secret_key)
    const body      = razorpay_order_id + "|" + razorpay_payment_id;
    const expected  = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(body)
      .digest("hex");

    const isValid = expected === razorpay_signature;

    if (isValid) {
      // Payment is genuine — here you would save the order to a database
      console.log(`✅ Payment verified: ${razorpay_payment_id}`);
      res.json({ success: true });
    } else {
      console.warn("❌ Signature mismatch — possible tampered request");
      res.status(400).json({ success: false, error: "Invalid signature" });
    }

  } catch (err) {
    console.error("Error verifying payment:", err);
    res.status(500).json({ success: false, error: "Verification failed" });
  }
});

// ─── Start server ─────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
