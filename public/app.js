// ─── State ───────────────────────────────────────────────────────────────────
// cart: { productId: { name, price, quantity } }
const cart = {};

// Holds order details between /create-order and /verify-payment
let currentOrderDetails = null;

// Razorpay instance — kept so we can close it programmatically
let rzpInstance = null;

// Tracks whether payment completed successfully.
// Razorpay fires ondismiss even after a successful payment (it closes its own
// modal), so without this flag ondismiss would overwrite the success result.
let paymentSucceeded = false;

// When Buy Now is clicked, we need to remember which product to pay for
// after the customer fills in their details
let pendingBuyNow = null; // { id, name, price }

// ─── DOM references ───────────────────────────────────────────────────────────
const cartBadge           = document.getElementById("cartBadge");
const cartItemsEl         = document.getElementById("cartItems");
const cartTotalEl         = document.getElementById("cartTotal");
const statusMsg           = document.getElementById("statusMsg");
const formError           = document.getElementById("formError");

// ─── Cart UI helpers ──────────────────────────────────────────────────────────

function updateCartUI() {
  const entries = Object.entries(cart);

  // Render items list inside cart modal
  if (entries.length === 0) {
    cartItemsEl.innerHTML = "<p>Your cart is empty.</p>";
  } else {
    cartItemsEl.innerHTML = entries.map(([id, item]) => `
      <div class="cart-item">
        <span>${item.name} × ${item.quantity}</span>
        <span>₹${item.price * item.quantity}</span>
      </div>
    `).join("");
  }

  // Recalculate totals
  const total      = entries.reduce((s, [, i]) => s + i.price * i.quantity, 0);
  const totalItems = entries.reduce((s, [, i]) => s + i.quantity, 0);

  cartTotalEl.textContent      = total;
  cartBadge.textContent        = totalItems;
  cartBadge.style.display      = totalItems > 0 ? "flex" : "none";
}

// ─── Status / error helpers ───────────────────────────────────────────────────

function showStatus(msg, isError = false) {
  statusMsg.textContent = msg;
  statusMsg.style.color = isError ? "#c0392b" : "#2d6a4f";
}

function showFormError(msg) {
  formError.textContent = msg;
  formError.style.color = "#c0392b";
}

function clearFormError() {
  formError.textContent = "";
}

// ─── Modal helpers ────────────────────────────────────────────────────────────

function openModal(id)  { document.getElementById(id).style.display = "flex"; }
function closeModal(id) { document.getElementById(id).style.display = "none"; }

// Read and validate the checkout form fields.
// Returns { name, mobile, address } on success, or null on failure.
function readCheckoutForm() {
  const name    = document.getElementById("customerName").value.trim();
  const mobile  = document.getElementById("customerMobile").value.trim();
  const address = document.getElementById("customerAddress").value.trim();

  if (!name) {
    showFormError("Please enter your name.");
    return null;
  }
  if (!/^[0-9]{10}$/.test(mobile)) {
    showFormError("Please enter a valid 10-digit mobile number.");
    return null;
  }
  if (!address) {
    showFormError("Please enter your delivery address.");
    return null;
  }

  clearFormError();
  return { name, mobile, address };
}

// Clear checkout form fields (called after a successful payment)
function resetCheckoutForm() {
  document.getElementById("customerName").value    = "";
  document.getElementById("customerMobile").value  = "";
  document.getElementById("customerAddress").value = "";
  clearFormError();
}

// ─── Order confirmation display ───────────────────────────────────────────────

function showOrderResult(orderData, isSuccess) {
  const modalStatus = document.getElementById("modalStatus");
  const orderDetails = document.getElementById("orderDetails");
  const modalTitle   = document.getElementById("modalTitle");

  if (isSuccess) {
    modalStatus.textContent = "✅ Order Successful!";
    modalStatus.className   = "modal-status success";
    modalTitle.textContent  = "Order Confirmation";
  } else {
    modalStatus.textContent = "❌ Payment was not completed.";
    modalStatus.className   = "modal-status failure";
    modalTitle.textContent  = "Order Not Placed";
  }

  if (orderData && orderData.items) {
    // items may arrive as a JSON string (from DB) or already as an array
    const items = typeof orderData.items === "string"
      ? JSON.parse(orderData.items)
      : orderData.items;

    orderDetails.innerHTML = `
      <div class="order-details">
        ${items.map(item => `
          <div class="order-item">
            <span>${item.name} × ${item.quantity}</span>
            <span>₹${(item.total / 100).toFixed(2)}</span>
          </div>
        `).join("")}
        <div class="order-summary">
          <div class="summary-row">
            <span>Subtotal:</span>
            <span>₹${(orderData.subtotal / 100).toFixed(2)}</span>
          </div>
          <div class="summary-row">
            <span>Tax (18% GST):</span>
            <span>₹${(orderData.tax / 100).toFixed(2)}</span>
          </div>
          <div class="summary-row total">
            <span>Total:</span>
            <span>₹${(orderData.total / 100).toFixed(2)}</span>
          </div>
        </div>
      </div>
    `;
  } else {
    orderDetails.innerHTML = "";
  }

  openModal("orderModal");
}

// ─── Razorpay payment flow ────────────────────────────────────────────────────

/**
 * Creates a server-side Razorpay order then opens the checkout modal.
 *
 * Pass EITHER:
 *   { productId, quantity, customerDetails }   — for Buy Now (single item)
 *   { cartItems, customerDetails }             — for cart checkout
 */
async function startPayment(payload) {
  showStatus("Creating order…");

  try {
    // 1. Create order on server (amount always calculated server-side)
    const orderRes = await fetch("/create-order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const orderData = await orderRes.json();

    if (!orderRes.ok) {
      throw new Error(orderData.error || "Failed to create order");
    }

    // Save for use in the verify step
    currentOrderDetails = {
      items:           orderData.items,
      subtotal:        orderData.subtotal,
      tax:             orderData.tax,
      total:           orderData.total,
      customerDetails: payload.customerDetails,
    };

    // 2. Open Razorpay modal
    const options = {
      key:         orderData.keyId,
      amount:      orderData.amount,
      currency:    orderData.currency,
      name:        "Chocolate Cake Shop",
      description: orderData.description || "Order",
      order_id:    orderData.orderId,

      // Called by Razorpay after the user pays successfully
      handler: async function (response) {
        paymentSucceeded = true; // flag so ondismiss doesn't overwrite this
        showStatus("Verifying payment…");

        const verifyRes = await fetch("/verify-payment", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            razorpay_order_id:   response.razorpay_order_id,
            razorpay_payment_id: response.razorpay_payment_id,
            razorpay_signature:  response.razorpay_signature,
            items:               currentOrderDetails.items,
            subtotal:            currentOrderDetails.subtotal,
            tax:                 currentOrderDetails.tax,
            total:               currentOrderDetails.total,
            customerDetails:     currentOrderDetails.customerDetails,
          }),
        });

        const verifyData = await verifyRes.json();
        showStatus("");

        if (verifyRes.ok && verifyData.success) {
          // Clear cart and form, then show success
          Object.keys(cart).forEach(k => delete cart[k]);
          updateCartUI();
          resetCheckoutForm();
          pendingBuyNow = null;
          showOrderResult(verifyData.orderData, true);
        } else {
          showOrderResult(currentOrderDetails, false);
        }
      },

      modal: {
        ondismiss: function () {
          // intentionally empty — no message shown when user closes Razorpay
        },
      },
    };

    paymentSucceeded = false; // reset before opening a new Razorpay modal
    rzpInstance = new Razorpay(options);
    rzpInstance.open();
    showStatus(""); // clear "Creating order…" now that modal is open

  } catch (err) {
    console.error(err);
    showStatus("Error: " + err.message, true);
  }
}

// ─── Product card helpers ─────────────────────────────────────────────────────

function getProductInfo(button) {
  const card = button.closest(".product-card");
  return {
    id:    card.dataset.productId,
    name:  card.dataset.productName,
    price: parseInt(card.dataset.productPrice, 10),
  };
}

// ─── Event listeners ──────────────────────────────────────────────────────────

// Add to Cart buttons
document.querySelectorAll(".addToCartBtn").forEach(btn => {
  btn.addEventListener("click", function () {
    const p = getProductInfo(this);

    if (cart[p.id]) {
      cart[p.id].quantity += 1;
    } else {
      cart[p.id] = { name: p.name, price: p.price, quantity: 1 };
    }

    updateCartUI();
    const total = Object.values(cart).reduce((s, i) => s + i.quantity, 0);
    showStatus(`Added to cart! (${total} item${total !== 1 ? "s" : ""} in cart)`);
  });
});

// Buy Now buttons — open checkout form first, then pay
document.querySelectorAll(".buyNowBtn").forEach(btn => {
  btn.addEventListener("click", function () {
    pendingBuyNow = getProductInfo(this); // remember which product
    clearFormError();
    openModal("checkoutFormModal");
  });
});

// Cart icon — toggle cart modal
document.getElementById("cartIconBtn").addEventListener("click", function () {
  const totalItems = Object.values(cart).reduce((s, i) => s + i.quantity, 0);
  if (totalItems === 0) {
    showStatus("Your cart is empty.", true);
    return;
  }
  openModal("cartModal");
});

// Close buttons (no inline onclick in HTML)
document.getElementById("closeCartBtn").addEventListener("click",         () => closeModal("cartModal"));
document.getElementById("closeCheckoutFormBtn").addEventListener("click", () => closeModal("checkoutFormModal"));
document.getElementById("closeOrderBtn").addEventListener("click",        () => closeModal("orderModal"));
document.getElementById("orderDoneBtn").addEventListener("click",         () => closeModal("orderModal"));

// Cart → Next button: move to checkout form
document.getElementById("checkoutBtn").addEventListener("click", function () {
  const totalItems = Object.values(cart).reduce((s, i) => s + i.quantity, 0);
  if (totalItems === 0) {
    showStatus("Your cart is empty.", true);
    return;
  }
  closeModal("cartModal");
  clearFormError();
  openModal("checkoutFormModal");
});

// "Proceed to Payment" button — THIS was broken before because it was inside a <form>
// Now it's inside a plain <div>, so clicking it never submits / reloads the page.
document.getElementById("proceedToPaymentBtn").addEventListener("click", function () {
  const customerDetails = readCheckoutForm();
  if (!customerDetails) return; // validation failed; error already shown

  closeModal("checkoutFormModal");

  if (pendingBuyNow) {
    // Buy Now flow: single product, quantity 1
    const p = pendingBuyNow;
    pendingBuyNow = null;
    startPayment({
      productId:       p.id,
      quantity:        1,
      customerDetails,
    });
  } else {
    // Cart checkout flow: all items in cart
    const cartItems = Object.entries(cart).map(([id, item]) => ({
      id,
      name:     item.name,
      price:    item.price,
      quantity: item.quantity,
    }));
    startPayment({ cartItems, customerDetails });
  }
});

// Close modals when clicking the dark backdrop
window.addEventListener("click", function (e) {
  ["cartModal", "checkoutFormModal", "orderModal"].forEach(id => {
    const modal = document.getElementById(id);
    if (e.target === modal) closeModal(id);
  });
});

// Initialize cart badge on load
updateCartUI();
