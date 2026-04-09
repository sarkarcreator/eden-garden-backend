// ============================================================
//  Eden Garden Properties — Stripe Backend
//  server.js
// ============================================================
//  HOW TO RUN:
//    1. npm install
//    2. node server.js
//    3. Open http://localhost:4242
// ============================================================

require("dotenv").config();
const express    = require("express");
let stripe;
try {
  stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
  console.log("✅ Stripe initialized");
} catch(e) {
  console.error("❌ Stripe init failed:", e.message);
  stripe = null;
}

const path       = require("path");
const cors       = require("cors");

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ──────────────────────────────────────────────
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type']
}));

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));   // serves HTML files

// ── Health check ────────────────────────────────────────────
app.get("/health", (req, res) => res.json({ status: "ok" }));

// ── CREATE CHECKOUT SESSION ──────────────────────────────────
//
//  POST /create-checkout-session
//  Body: { type: "visit" | "holiday_day" | "holiday_week" | "holiday_month" }
//
//  Pricing (AED converted to smallest currency unit — fils):
//    AED 1  = 100 fils
//    AED 500  = 50000 fils
//    AED 1000 = 100000 fils
//    etc.
//
//  NOTE: Stripe does NOT support AED (UAE Dirham) natively.
//  We use USD here for full Stripe compatibility.
//  Conversion rate: 1 AED ≈ 0.27 USD  →  multiply AED by 27 cents.
//  If your Stripe account is set to AED, change `currency` to "aed".
// ────────────────────────────────────────────────────────────
const PRODUCTS = {
  visit: {
    name        : "Schedule a Property Visit — Eden Garden Properties",
    description : "Book a private property viewing with our senior agent. Fee is refundable if cancelled 24h prior.",
    amount      : 50000,   // USD $500.00 (or AED 500 if account supports it)
    currency    : "usd",
  },
  holiday_day: {
    name        : "Holiday Home — Daily Stay",
    description : "1-day luxury holiday home experience. Includes housekeeping & concierge service.",
    amount      : 100000,  // $1,000
    currency    : "usd",
  },
  holiday_week: {
    name        : "Holiday Home — 1 Week Stay",
    description : "7-day luxury holiday home. Airport transfers, private chef access & premium WiFi included.",
    amount      : 280000,  // $2,800
    currency    : "usd",
  },
  holiday_month: {
    name        : "Holiday Home — Monthly Stay",
    description : "30-day extended luxury living. Dedicated butler, full villa privileges & exclusive benefits.",
    amount      : 600000,  // $6,000
    currency    : "usd",
  },
};

app.post("/create-checkout-session", async (req, res) => {
  try {
    if (!stripe) {
      return res.status(500).json({ error: "Stripe not configured. Check STRIPE_SECRET_KEY." });
    }
    const { type } = req.body;

    // Validate product type
    if (!type || !PRODUCTS[type]) {
      return res.status(400).json({
        error: "Invalid product type. Must be one of: visit, holiday_day, holiday_week, holiday_month",
      });
    }

    const product = PRODUCTS[type];

    // Build absolute success/cancel URLs
    const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],

      line_items: [
        {
          price_data: {
            currency    : product.currency,
            unit_amount : product.amount,           // in smallest unit (cents/fils)
            product_data: {
              name       : product.name,
              description: product.description,
              images     : [
                "https://images.unsplash.com/photo-1613977257363-707ba9348227?w=800&q=80",
              ],
            },
          },
          quantity: 1,
        },
      ],

      mode: "payment",

      // ── These pages are served from /public ──
      success_url: `${BASE_URL}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url : `${BASE_URL}/cancel.html`,

      // ── Collect customer email ──
      customer_email: req.body.email || undefined,

      // ── Metadata (useful for webhooks later) ──
      metadata: {
        product_type : type,
        source       : "eden-garden-properties",
      },
    });

    // Return session URL to frontend — frontend will redirect
    res.json({ url: session.url, sessionId: session.id });

  } catch (err) {
    console.error("❌ Stripe error:", err.message);
    res.status(500).json({ error: err.message });
  }
});


// ── RETRIEVE SESSION (for success page) ─────────────────────
app.get("/session-details", async (req, res) => {
  try {
    if (!stripe) {
      return res.status(500).json({ error: "Stripe not configured." });
    }
    const { session_id } = req.query;

    if (!session_id) return res.status(400).json({ error: "Missing session_id" });

    const session = await stripe.checkout.sessions.retrieve(session_id);
    res.json({
      customerEmail  : session.customer_details?.email || "N/A",
      amount         : (session.amount_total / 100).toFixed(2),
      currency       : session.currency.toUpperCase(),
      paymentStatus  : session.payment_status,
      productName    : PRODUCTS[session.metadata?.product_type]?.name || "Payment",
    });
  } catch (err) {
    console.error("❌ Session retrieve error:", err.message);
    res.status(500).json({ error: err.message });
  }
});


// ── WEBHOOK (optional but recommended for production) ────────
// Listens for payment confirmations from Stripe servers
// To test: stripe listen --forward-to localhost:4242/webhook
app.post(
  "/webhook",
  express.raw({ type: "application/json" }),   // raw body required for signature verification
  (req, res) => {
    const sig    = req.headers["stripe-signature"];
    const secret = process.env.STRIPE_WEBHOOK_SECRET;

    let event;
    try {
      event = stripe.webhooks.constructEvent(req.body, sig, secret);
    } catch (err) {
      console.error("⚠️  Webhook signature failed:", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        console.log("✅ Payment received!");
        console.log("   Customer:", session.customer_details?.email);
        console.log("   Amount:  ", session.amount_total / 100, session.currency.toUpperCase());
        console.log("   Type:    ", session.metadata?.product_type);
        // TODO: save to database, send confirmation email, etc.
        break;
      }
      case "payment_intent.payment_failed": {
        const intent = event.data.object;
        console.log("❌ Payment failed:", intent.last_payment_error?.message);
        break;
      }
      default:
        console.log(`ℹ️  Unhandled event: ${event.type}`);
    }

    res.json({ received: true });
  }
);


// ── START SERVER ─────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log("");
  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║   Eden Garden Properties — Payment Server        ║");
  console.log(`║   Running on: http://0.0.0.0:AED{PORT}           ║`);
  console.log("╚══════════════════════════════════════════════════╝");
  console.log("");
});

