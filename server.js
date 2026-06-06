// server.js — Node.js + Express backend for Razorpay integration

const express  = require("express");
const Razorpay = require("razorpay");
const crypto   = require("crypto");
const path     = require("path");
const fs       = require("fs");
require("dotenv").config();

const app  = express();
const PORT = process.env.PORT || 3000;

// ─── Simple JSON-file order store ─────────────────────────────────────────────
// Orders are appended to orders.json (newline-delimited JSON).
// On read-only production filesystems this will throw — that is caught and
// logged but does NOT affect the payment success response to the user.

const ORDERS_FILE = path.join(__dirname, "orders.json");

function saveOrder(orderData) {
  const line = JSON.stringify({ ...orderData, createdAt: new Date().toISOString() }) + "\n";
  fs.appendFileSync(ORDERS_FILE, line, "utf8");
}

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ─── Razorpay client ──────────────────────────────────────────────────────────
const razorpay = new Razorpay({
  key_id:     process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// ─── Product catalogue ────────────────────────────────────────────────────────
const PRODUCTS = {
  1: { name: "Chocolate Cake",    priceInPaise: 100 },
  2: { name: "Vanilla Cake",      priceInPaise: 200 },
  3: { name: "Red Velvet Cake",   priceInPaise: 300 },
  4: { name: "Strawberry Cake",   priceInPaise: 400 },
  5: { name: "Butterscotch Cake", priceInPaise: 500 },
};

const TAX_RATE = 0.18; // 18% GST

// ─── POST /create-order ───────────────────────────────────────────────────────
app.post("/create-order", async (req, res) => {
  try {
    let subtotal = 0;
    let items    = [];
    let description;
    const customerDetails = req.body.customerDetails || {};

    if (req.body.cartItems && Array.isArray(req.body.cartItems)) {
      for (const item of req.body.cartItems) {
        const product  = PRODUCTS[item.id];
        if (!product) continue;
        const quantity = Math.max(1, parseInt(item.quantity, 10) || 1);
        const total    = product.priceInPaise * quantity;
        subtotal      += total;
        items.push({ id: item.id, name: product.name, price: product.priceInPaise, quantity, total });
      }
      if (items.length === 0) return res.status(400).json({ error: "Cart is empty or contains no valid products" });
      description = `Cart order (${items.length} product${items.length > 1 ? "s" : ""})`;

    } else if (req.body.productId && req.body.quantity) {
      const product  = PRODUCTS[req.body.productId];
      const quantity = Math.max(1, parseInt(req.body.quantity, 10) || 1);
      if (!product) return res.status(400).json({ error: "Invalid product" });
      const total = product.priceInPaise * quantity;
      subtotal    = total;
      items.push({ id: req.body.productId, name: product.name, price: product.priceInPaise, quantity, total });
      description = `${quantity} × ${product.name}`;

    } else {
      return res.status(400).json({ error: "Invalid request" });
    }

    const tax   = Math.round(subtotal * TAX_RATE);
    const total = subtotal + tax;

    const order = await razorpay.orders.create({
      amount:   total,
      currency: "INR",
      receipt:  `rcpt_${Date.now()}`,
    });

    res.json({
      orderId: order.id, amount: order.amount, currency: order.currency,
      keyId: process.env.RAZORPAY_KEY_ID,
      description, items, subtotal, tax, total,
    });

  } catch (err) {
    console.error("Error creating order:", err);
    res.status(500).json({ error: "Could not create order" });
  }
});

// ─── POST /verify-payment ─────────────────────────────────────────────────────
app.post("/verify-payment", (req, res) => {
  try {
    const {
      razorpay_order_id, razorpay_payment_id, razorpay_signature,
      items, subtotal, tax, total, customerDetails,
    } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ success: false, error: "Missing payment fields" });
    }

    // Verify HMAC-SHA256 signature
    const body     = razorpay_order_id + "|" + razorpay_payment_id;
    const expected = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(body)
      .digest("hex");

    if (expected !== razorpay_signature) {
      console.warn("❌ Signature mismatch — possible tampered request");
      return res.status(400).json({ success: false, error: "Invalid signature" });
    }

    // ── Signature is valid: payment is genuine ─────────────────────────────
    const orderData = {
      razorpay_order_id,
      razorpay_payment_id,
      items:            JSON.stringify(items || []),
      subtotal:         subtotal  || 0,
      tax:              tax       || 0,
      total:            total     || 0,
      customer_name:    customerDetails?.name    || "",
      customer_mobile:  customerDetails?.mobile  || "",
      customer_address: customerDetails?.address || "",
      status: "success",
    };

    // Respond with success IMMEDIATELY — before touching the filesystem.
    // Many production platforms (Render, Railway, Heroku) have read-only or
    // ephemeral filesystems. A save failure must NEVER turn a real, verified
    // payment into a "payment failed" response for the customer.
    res.json({ success: true, orderData });

    // Save order after responding — non-blocking, non-fatal
    try {
      saveOrder(orderData);
      console.log(`✅ Payment verified & saved: ${razorpay_payment_id}`);
    } catch (saveErr) {
      // Payment succeeded — log for manual recovery, do not alarm the user
      console.error("⚠️  Order save failed (payment WAS successful):", saveErr.message);
      console.error("   Manual recovery data:", JSON.stringify(orderData));
    }

  } catch (err) {
    console.error("Error verifying payment:", err);
    res.status(500).json({ success: false, error: "Verification failed" });
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
