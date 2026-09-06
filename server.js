require("dotenv").config();
const express = require("express");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { exec } = require("child_process");
const Stripe = require("stripe");

const app = express();
const PORT = process.env.PORT || 5500;
const APP_BASE_URL = (
  process.env.APP_BASE_URL || `http://localhost:${PORT}`
).replace(/\/$/, "");

if (!process.env.STRIPE_SECRET_KEY) {
  console.warn(
    "WARNING: STRIPE_SECRET_KEY is missing. Stripe checkout will fail until .env is configured.",
  );
}

const stripe = Stripe(process.env.STRIPE_SECRET_KEY || "sk_test_missing");

app.use(express.json({ limit: "2mb" }));

app.use(express.static(__dirname));

function toStripeAmountRM(amount) {
  return Math.max(100, Math.round(Number(amount || 0) * 100));
}

/* ── Local GepukAI engine (no external API needed) ─────────────────────── */
function gepukAI(message, ctx) {
  const q = message.toLowerCase();
  const {
    totalOrders = 0, totalRevenue = 0, totalUnits = 0,
    avgOrder = 0, bestSeller = "N/A", busiestBatch = "N/A",
    activeBatches = 0, revenueByDay = {}, itemCount = {},
  } = ctx;

  if (!totalOrders) {
    return `No orders recorded yet, Boss! Once customers start placing orders, I can analyse stock needs, forecast demand, and identify your best sellers. Start by opening a batch and sharing the menu link. 🚀`;
  }

  const chicken = Math.ceil(totalUnits * 1.25);
  const rice    = Math.max(1, Math.ceil(totalUnits * 0.20));
  const sambal  = Math.max(1, Math.ceil(totalUnits * 0.08));
  const forecastUnits = Math.ceil(totalUnits * 1.2);
  const forecastChicken = Math.ceil(forecastUnits * 1.25);
  const forecastRice = Math.max(1, Math.ceil(forecastUnits * 0.20));
  const forecastSambal = Math.max(1, Math.ceil(forecastUnits * 0.08));

  /* Revenue trend — last 7 days slope */
  const revKeys = Object.keys(revenueByDay).sort().slice(-7);
  const revVals = revKeys.map(k => revenueByDay[k]);
  const revAvg  = revVals.length ? revVals.reduce((a, b) => a + b, 0) / revVals.length : 0;
  const revLast = revVals.length ? revVals[revVals.length - 1] : 0;
  const trendWord = revLast >= revAvg * 1.1 ? "📈 rising" : revLast <= revAvg * 0.9 ? "📉 slowing" : "➡️ steady";

  /* Top items */
  const topItems = Object.entries(itemCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([n, v], i) => `${["🥇","🥈","🥉"][i]} **${n}** (${v} units)`)
    .join(", ");

  /* ── Intent matching ── */

  if (/stock|stok|grocery|ingredient|buy|beli|ayam|beras|rice|sambal|purchase|order supply|berapa/.test(q)) {
    return `**Stock recommendation** based on **${totalUnits} units** sold:\n\n🍗 **Chicken** → **${chicken} portions**\n🍚 **Nasi Putih** → **${rice} kg**\n🌶 **Sambal** → **${sambal} kg**\n\nAll figures include a **25% safety buffer**. Top priority item: ${bestSeller}. Buy stock **1–2 hours before** your busiest batch (${busiestBatch}).`;
  }

  if (/predict|forecast|tomorrow|next|future|ramal|demand|expect/.test(q)) {
    return `**Demand forecast for next period:**\n\nExpected demand: **~${forecastUnits} units** (+20% over current history)\n\n📦 Prepare:\n🍗 **${forecastChicken} portions** chicken\n🍚 **${forecastRice} kg** rice\n🌶 **${forecastSambal} kg** sambal\n\nRevenue trend is ${trendWord}. Focus on **${bestSeller}** — it drives your highest volume. Confidence: **medium** (based on ${totalOrders} orders so far).`;
  }

  if (/batch|peak|busy|time|slot|pax|masa/.test(q)) {
    const batchOrders = busiestBatch !== "N/A" ? busiestBatch : "not identified yet";
    return `**Peak batch insight:**\n\nBusiest slot: **${batchOrders}**\n\n✅ Recommendations:\n• Prep kitchen stock **30 min before** this batch\n• Assign rider **early** to avoid delay\n• Keep **${Math.ceil(chicken * 0.4)} extra portions** of chicken on standby\n• Active batches now open: **${activeBatches}**`;
  }

  if (/sales|revenue|performance|jual|income|earning|profit|duit|wang/.test(q)) {
    const days = revKeys.length;
    const dailyAvg = days ? (totalRevenue / days).toFixed(2) : "0.00";
    return `**Sales performance report:**\n\n💰 Total revenue: **RM ${totalRevenue.toFixed(2)}**\n📦 Total orders: **${totalOrders}**\n🍱 Units sold: **${totalUnits}**\n📊 Avg order value: **RM ${avgOrder.toFixed(2)}**\n📅 Daily avg (${days}d): **RM ${dailyAvg}**\n\nRevenue trend: ${trendWord}\nBest seller: ${bestSeller}`;
  }

  if (/best|popular|seller|favourite|top|laris|menu/.test(q)) {
    return `**Best seller analysis:**\n\nTop 3 items: ${topItems}\n\n🎯 **${bestSeller}** is your star — make sure you always have extra stock for it. Consider promoting it in your next batch to maximise revenue per order (current avg: **RM ${avgOrder.toFixed(2)}**).`;
  }

  if (/summary|report|overview|status|update|semua|all/.test(q)) {
    return `**GepukGO Quick Summary:**\n\n💰 Revenue: **RM ${totalRevenue.toFixed(2)}** (${trendWord})\n📦 Orders: **${totalOrders}** · Units: **${totalUnits}**\n⭐ Best seller: **${bestSeller}**\n⏰ Peak batch: **${busiestBatch}**\n\n📦 Stock to buy now:\n🍗 **${chicken} portions** · 🍚 **${rice} kg** rice · 🌶 **${sambal} kg** sambal\n\nForecast next period: **~${forecastUnits} units** needed.`;
  }

  if (/hello|hi|hey|salam|apa khabar|helo/.test(q)) {
    return `Hello, Boss! 👋 I'm **GepukAI**, your inventory assistant running live via ngrok.\n\nYou currently have **${totalOrders} orders** and **RM ${totalRevenue.toFixed(2)}** in sales. Ask me about **stock**, **forecast**, **peak batch**, or **sales performance**!`;
  }

  if (/why|how come|kenapa|sikit|low|slow|only|sedikit|kurang|less|few|drop|turun|not enough/.test(q)) {
    const hour = new Date().getHours();
    const timeReason =
      hour < 10 ? "It's still early morning — most customers order closer to lunch or dinner time." :
      hour < 12 ? "Morning rush hasn't peaked yet — lunch batch usually drives the most orders." :
      hour < 14 ? "Lunch window is open — orders should pick up soon if batches are active." :
      hour < 17 ? "Mid-afternoon lull is normal — dinner batch typically sees the highest demand." :
      hour < 20 ? "Dinner peak is now — if orders are still low, check that the batch link is shared." :
      "It's late evening — lower order volume at this hour is expected.";

    const peakHint = busiestBatch !== "N/A"
      ? `Your historically busiest slot is **${busiestBatch}** — make sure it's open and shared.`
      : "No peak batch identified yet — open more batch slots to collect demand data.";

    const avgHint = avgOrder > 0
      ? `Average order value is **RM ${avgOrder.toFixed(2)}** — consider a bundle promo to push it higher.`
      : "No average order data yet.";

    return `Here's why orders might be low right now:\n\n⏰ **Timing** — ${timeReason}\n\n📢 **Visibility** — Customers may not have the ordering link. Share it on WhatsApp, Instagram, or your group chat now.\n\n📦 **Batch status** — ${peakHint}\n\n💡 **Promo tip** — ${avgHint}\n\n🍗 **Best seller boost** — Highlight **${bestSeller}** in your next post. High-demand items attract repeat customers.\n\n📊 Current snapshot: **${totalOrders} orders**, **RM ${totalRevenue.toFixed(2)}** revenue, trend is ${trendWord}.`;
  }

  /* Default: full mini-report */
  return `**Quick analysis** for GepukGO:\n\n📊 **${totalOrders}** orders · **RM ${totalRevenue.toFixed(2)}** revenue · **${totalUnits}** units sold\n⭐ Best seller: **${bestSeller}** · Peak: **${busiestBatch}**\n\n📦 Buy today: 🍗 **${chicken} portions** · 🍚 **${rice} kg** · 🌶 **${sambal} kg**\n\nTry asking: *"How much stock should I buy?"*, *"Predict tomorrow's demand"*, or *"Give me a sales report"*.`;
}

/* ── Routes ── */

app.post("/api/create-checkout-session", async (req, res) => {
  try {
    const { checkout, customer } = req.body || {};
    if (!checkout || !Array.isArray(checkout.cart) || !checkout.cart.length) {
      return res.status(400).json({ error: "Cart is empty." });
    }

    const lineItems = checkout.cart.map((item) => {
      const desc = [
        item.variationText || item.variation || "",
        item.note ? `Note: ${item.note}` : "",
      ].filter(Boolean).join(" | ").slice(0, 250);
      return {
        price_data: {
          currency: "myr",
          product_data: {
            name: item.name || "Ayam Gepuk Item",
            ...(desc && { description: desc }),
          },
          unit_amount: toStripeAmountRM(item.price),
        },
        quantity: Math.max(1, Number(item.quantity || 1)),
      };
    });

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["fpx"],
      line_items: lineItems,
      customer_email: customer && customer.email ? customer.email : undefined,
      success_url: `${APP_BASE_URL}/stripe-return1.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${APP_BASE_URL}/cust-cart1.html?payment=cancelled`,
      metadata: {
        checkoutId: checkout.id || "",
        batchId: checkout.batchId || "",
        customerUid: customer && customer.uid ? customer.uid : "",
        customerEmail: customer && customer.email ? customer.email : "",
      },
    });

    res.json({ id: session.id, url: session.url });
  } catch (err) {
    console.error("Stripe session error:", err);
    res.status(500).json({ error: err.message || "Stripe checkout failed." });
  }
});

app.get("/api/checkout-session/:id", async (req, res) => {
  try {
    const session = await stripe.checkout.sessions.retrieve(req.params.id);
    res.json({
      id: session.id,
      payment_status: session.payment_status,
      status: session.status,
      amount_total: session.amount_total,
      currency: session.currency,
    });
  } catch (err) {
    console.error("Stripe verify error:", err);
    res.status(500).json({ error: err.message || "Unable to verify Stripe session." });
  }
});

app.post("/api/ai-chat", (req, res) => {
  try {
    const { message, context } = req.body || {};
    if (!message) return res.status(400).json({ error: "No message provided." });
    const reply = gepukAI(message, context || {});
    res.json({ reply });
  } catch (err) {
    console.error("AI chat error:", err);
    res.status(500).json({ error: err.message || "AI engine error." });
  }
});

/* ── Receipt formatter (32-char wide, works on thermal + regular printers) ── */
function formatReceipt(order) {
  const W = 32;
  const LINE  = "=".repeat(W);
  const DASH  = "-".repeat(W);
  const pad   = (l, r, total) => {
    l = String(l || ""); r = String(r || "");
    const gap = Math.max(1, total - l.length - r.length);
    return l + " ".repeat(gap) + r;
  };
  const center = (str, w = W) => {
    str = String(str || "").slice(0, w);
    const sp = Math.floor((w - str.length) / 2);
    return " ".repeat(sp) + str;
  };

  const dateStr = order.createdAt
    ? new Date(order.createdAt).toLocaleString("en-MY", { hour12: true })
    : new Date().toLocaleString("en-MY", { hour12: true });

  const itemLines = (order.items || []).map(item => {
    const qty   = Number(item.quantity || 1);
    const price = (Number(item.price || 0) * qty).toFixed(2);
    const name  = String(item.name || "Item").slice(0, 22);
    const detail = [
      item.variationText || item.variation || "",
      item.note ? "Note: " + item.note : "",
    ].filter(Boolean).join(", ").slice(0, W - 2);
    const lines = [pad(qty + "x " + name, "RM" + price, W)];
    if (detail) lines.push("  " + detail);
    return lines.join("\n");
  }).join("\n");

  return [
    "\n",
    LINE,
    center("GEPUKGO ORDER SLIP"),
    center("Ayam Gepuk Pagoh"),
    LINE,
    "ID   : " + String(order.id || "-").slice(0, W - 7),
    "Date : " + dateStr.slice(0, W - 7),
    "Batch: " + String(order.batchName || order.batchId || "-").slice(0, W - 7),
    DASH,
    "Name : " + String(order.customer || "-").slice(0, W - 7),
    "Phone: " + String(order.phone || "-").slice(0, W - 7),
    order.address ? "Addr : " + String(order.address).slice(0, W - 7) : null,
    DASH,
    itemLines,
    DASH,
    pad("TOTAL:", "RM " + Number(order.total || 0).toFixed(2), W),
    LINE,
    center("Terima kasih!"),
    center("Thank you :)"),
    LINE,
    "\n\n\n",
  ].filter(l => l !== null).join("\n");
}

/* /api/printers — list installed Windows printers */
app.get("/api/printers", (req, res) => {
  exec(
    `powershell -Command "Get-Printer | Select-Object -ExpandProperty Name"`,
    (err, stdout) => {
      if (err) return res.json({ printers: [] });
      const printers = stdout.split("\n").map(p => p.trim()).filter(Boolean);
      res.json({ printers });
    }
  );
});

/* /api/print — send receipt to a physical printer */
app.post("/api/print", (req, res) => {
  try {
    const { order, printerName } = req.body || {};
    if (!order) return res.status(400).json({ error: "No order data provided." });

    const receipt  = formatReceipt(order);
    const tmpFile  = path.join(os.tmpdir(), `gepukgo-${Date.now()}.txt`).replace(/\\/g, "/");
    fs.writeFileSync(tmpFile, receipt, "utf8");

    const target = printerName
      ? `-Name "${printerName.replace(/"/g, "")}"`
      : "";
    const cmd = `powershell -Command "Get-Content '${tmpFile}' | Out-Printer ${target}"`;

    exec(cmd, (err) => {
      try { fs.unlinkSync(tmpFile); } catch (_) {}
      if (err) {
        console.error("Print error:", err.message);
        return res.status(500).json({ error: "Print failed: " + err.message });
      }
      console.log(`Printed order ${order.id} → ${printerName || "default printer"}`);
      res.json({ ok: true });
    });
  } catch (err) {
    console.error("Print error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`GepukGO running at ${APP_BASE_URL}/index1.html`);
  console.log(`GepukAI endpoint:  ${APP_BASE_URL}/api/ai-chat`);
  console.log(`Print endpoint:    ${APP_BASE_URL}/api/print`);
});
