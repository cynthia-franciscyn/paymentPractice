// ─── State ───────────────────────────────────────────────────────────────────
// Cart holds the current quantity of Chocolate Cake
const cart = {
  productName: "Chocolate Cake",
  pricePerUnit: 1, // ₹1
  quantity: 0,
};

// ─── DOM references ───────────────────────────────────────────────────────────
const addToCartBtn  = document.getElementById("addToCartBtn");
const buyNowBtn     = document.getElementById("buyNowBtn");
const checkoutBtn   = document.getElementById("checkoutBtn");
const cartSection   = document.getElementById("cartSection");
const cartQuantity  = document.getElementById("cartQuantity");
const cartTotal     = document.getElementById("cartTotal");
const statusMsg     = document.getElementById("statusMsg");

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Update the cart UI to reflect current state
function updateCartUI() {
  cartQuantity.textContent = cart.quantity;
  cartTotal.textContent    = cart.quantity * cart.pricePerUnit;

  // Show cart section only when there is at least 1 item
  cartSection.style.display = cart.quantity > 0 ? "block" : "none";
}

// Show a status message (success / error)
function showStatus(msg, isError = false) {
  statusMsg.textContent = msg;
  statusMsg.style.color = isError ? "#c0392b" : "#2d6a4f";
}

// ─── Razorpay helper ──────────────────────────────────────────────────────────

/**
 * Creates a Razorpay order on the server, then opens the Razorpay
 * checkout modal.  On success it verifies the payment with the server.
 *
 * @param {number} quantity  Number of units being purchased
 */
async function startPayment(quantity) {
  showStatus("Creating order…");

  try {
    // 1. Ask the server to create a Razorpay order
    //    Amount is always calculated server-side (never trust the client)
    const orderRes = await fetch("/create-order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quantity }),
    });

    const orderData = await orderRes.json();

    if (!orderRes.ok) {
      throw new Error(orderData.error || "Failed to create order");
    }

    // 2. Configure and open the Razorpay checkout popup
    const options = {
      key: orderData.keyId,           // Razorpay Key ID (safe to expose)
      amount: orderData.amount,       // Amount in paise (returned by server)
      currency: orderData.currency,
      name: "Chocolate Cake Shop",
      description: `${quantity} × Chocolate Cake`,
      order_id: orderData.orderId,    // Razorpay order ID from server

      // Called when the user completes payment
      handler: async function (response) {
        showStatus("Verifying payment…");

        // 3. Send payment details to server for signature verification
        const verifyRes = await fetch("/verify-payment", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            razorpay_order_id:   response.razorpay_order_id,
            razorpay_payment_id: response.razorpay_payment_id,
            razorpay_signature:  response.razorpay_signature,
          }),
        });

        const verifyData = await verifyRes.json();

        if (verifyRes.ok && verifyData.success) {
          showStatus("✅ Payment successful! Thank you for your order.");
          // Reset cart after a successful purchase
          cart.quantity = 0;
          updateCartUI();
        } else {
          showStatus("❌ Payment verification failed.", true);
        }
      },

      // Called when the user closes the modal without paying
      modal: {
        ondismiss: function () {
          showStatus("Payment cancelled.", true);
        },
      },
    };

    const rzp = new Razorpay(options);
    rzp.open();
    showStatus(""); // Clear the "Creating order…" message once modal is open

  } catch (err) {
    console.error(err);
    showStatus("Error: " + err.message, true);
  }
}

// ─── Event listeners ──────────────────────────────────────────────────────────

// Add to Cart: increase quantity and update UI
addToCartBtn.addEventListener("click", function () {
  cart.quantity += 1;
  updateCartUI();
  showStatus(`Added to cart! (${cart.quantity} in cart)`);
});

// Buy Now: purchase exactly 1 unit immediately (ignores cart)
buyNowBtn.addEventListener("click", function () {
  startPayment(1);
});

// Checkout: purchase however many items are in the cart
checkoutBtn.addEventListener("click", function () {
  if (cart.quantity === 0) {
    showStatus("Your cart is empty.", true);
    return;
  }
  startPayment(cart.quantity);
});
