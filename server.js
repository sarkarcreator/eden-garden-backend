require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");

let stripe;
try {
  stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
  console.log("Stripe initialized");
} catch(e) {
  console.error("Stripe init failed:", e.message);
  stripe = null;
}

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/health", (req, res) => res.json({ status: "ok" }));

const PRODUCTS = {
  visit: { name: "Schedule a Property Visit", amount: 50000, currency: "usd" },
  holiday_day: { name: "Holiday Home - Daily Stay", amount: 100000, currency: "usd" },
  holiday_week: { name: "Holiday Home - 1 Week Stay", amount: 280000, currency: "usd" },
  holiday_month: { name: "Holiday Home - Monthly Stay", amount: 600000, currency: "usd" },
};

app.post("/create-checkout-session", async (req, res) => {
  try {
    if (!stripe) return res.status(500).json({ error: "Stripe not configured" });
    const { type, email } = req.body;
    if (!type || !PRODUCTS[type]) return res.status(400).json({ error: "Invalid type" });
    const product = PRODUCTS[type];
    const BASE_URL = process.env.BASE_URL || "https://egardenp.com";
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [{ price_data: { currency: product.currency, unit_amount: product.amount, product_data: { name: product.name } }, quantity: 1 }],
      mode: "payment",
      success_url: BASE_URL + "/success.html?session_id={CHECKOUT_SESSION_ID}",
      cancel_url: BASE_URL + "/cancel.html",
      customer_email: email || undefined,
    });
    res.json({ url: session.url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/session-details", async (req, res) => {
  try {
    if (!stripe) return res.status(500).json({ error: "Stripe not configured" });
    const session = await stripe.checkout.sessions.retrieve(req.query.session_id);
    res.json({
      customerEmail: session.customer_details?.email || "N/A",
      amount: (session.amount_total / 100).toFixed(2),
      currency: session.currency.toUpperCase(),
      productName: PRODUCTS[session.metadata?.product_type]?.name || "Payment",
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const server = app.listen(process.env.PORT || 3000, "0.0.0.0", () => {
  console.log("Server running on port " + server.address().port);
});

process.on("SIGTERM", () => {
  console.log("SIGTERM received. Shutting down gracefully.");
  server.close(() => {
    console.log("Server closed.");
    process.exit(0);
  });
});
