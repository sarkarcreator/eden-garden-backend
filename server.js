require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const axios = require("axios");

let stripe;
try {
  stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
  console.log("Stripe initialized");
} catch (e) {
  console.error("Stripe init failed:", e.message);
}

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok", time: new Date().toISOString() });
});

const PRODUCTS = {
  visit: { name: "Schedule a Property Visit", amount: 50000, currency: "usd" },
  holiday_day: { name: "Holiday Home - Daily Stay", amount: 100000, currency: "usd" },
  holiday_week: { name: "Holiday Home - 1 Week Stay", amount: 280000, currency: "usd" },
  holiday_month: { name: "Holiday Home - Monthly Stay", amount: 600000, currency: "usd" },
};



// ================= STRIPE =================

app.post("/create-checkout-session", async (req, res) => {
  try {
    if (!stripe) return res.status(500).json({ error: "Stripe not configured" });

    const { type, email } = req.body;
    if (!type || !PRODUCTS[type]) return res.status(400).json({ error: "Invalid type" });

    const product = PRODUCTS[type];
    const BASE_URL = process.env.BASE_URL || "https://egardenp.com";

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: product.currency,
            unit_amount: product.amount,
            product_data: { name: product.name },
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url: BASE_URL + "/success.html?session_id={CHECKOUT_SESSION_ID}",
      cancel_url: BASE_URL + "/cancel.html",
      customer_email: email || undefined,
      metadata: {
        product_type: type,
        payment_method: "stripe",
      },
    });

    res.json({ url: session.url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});



// ================= PAYPAL =================

// 🔑 Get Access Token
async function getPayPalToken() {
  const response = await axios({
    url: "https://api-m.sandbox.paypal.com/v1/oauth2/token",
    method: "post",
    auth: {
      username: process.env.PAYPAL_CLIENT_ID,
      password: process.env.PAYPAL_SECRET,
    },
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    data: "grant_type=client_credentials",
  });

  return response.data.access_token;
}

// 🛒 Create PayPal Order
app.post("/create-paypal-order", async (req, res) => {
  try {
    const { type } = req.body;

    if (!type || !PRODUCTS[type]) {
      return res.status(400).json({ error: "Invalid type" });
    }

    const product = PRODUCTS[type];
    const accessToken = await getPayPalToken();

    const response = await axios({
      url: "https://api-m.sandbox.paypal.com/v2/checkout/orders",
      method: "post",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      data: {
        intent: "CAPTURE",
        purchase_units: [
          {
            amount: {
              currency_code: product.currency.toUpperCase(),
              value: (product.amount / 100).toFixed(2),
            },
            description: product.name,
          },
        ],
      },
    });

    res.json(response.data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 💰 Capture PayPal Payment
app.post("/capture-paypal-order/:orderID", async (req, res) => {
  try {
    const accessToken = await getPayPalToken();

    const response = await axios({
      url: `https://api-m.sandbox.paypal.com/v2/checkout/orders/${req.params.orderID}/capture`,
      method: "post",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    res.json(response.data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});



// ================= STRIPE SESSION DETAILS =================

app.get("/session-details", async (req, res) => {
  try {
    if (!stripe) return res.status(500).json({ error: "Stripe not configured" });

    const session = await stripe.checkout.sessions.retrieve(req.query.session_id);

    res.json({
      customerEmail: session.customer_details?.email || "N/A",
      amount: (session.amount_total / 100).toFixed(2),
      currency: session.currency.toUpperCase(),
      productName: PRODUCTS[session.metadata?.product_type]?.name || "Payment",
      paymentMethod: "stripe",
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});



// ================= SERVER ================

const PORT = process.env.PORT || 3000;

const server = app.listen(PORT, "0.0.0.0", () => {
  console.log("Server running on port " + PORT);
});

process.on("SIGTERM", () => {
  console.log("SIGTERM received. Shutting down.");
  server.close(() => {
    console.log("Server closed.");
    process.exit(0);
  });
});

process.on("SIGINT", () => {
  console.log("SIGINT received. Shutting down.");
  server.close(() => {
    console.log("Server closed.");
    process.exit(0);
  });
});
