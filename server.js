require("dotenv").config();
const express = require("express");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { exec } = require("child_process");

const app = express();
const PORT = process.env.PORT || 5500;
const APP_BASE_URL = `http://localhost:${PORT}`;

app.use(express.json({ limit: "2mb" }));
app.use((req, res, next) => {
  if (String(req.path || "").toLowerCase().includes(".env")) {
    return res.status(404).end();
  }
  next();
});
app.use(express.static(__dirname, { index: false }));

function formatReceipt(order) {
  const W = 32;
  const LINE = "=".repeat(W);
  const DASH = "-".repeat(W);
  const pad = (l, r, total) => {
    l = String(l || "");
    r = String(r || "");
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

  const itemLines = (order.items || [])
    .map((item) => {
      const qty = Number(item.quantity || 1);
      const price = (Number(item.price || 0) * qty).toFixed(2);
      const name = String(item.name || "Item").slice(0, 22);
      const detail = [
        item.variationText || item.variation || "",
        item.note ? "Note: " + item.note : "",
      ]
        .filter(Boolean)
        .join(", ")
        .slice(0, W - 2);
      const lines = [pad(qty + "x " + name, "RM" + price, W)];
      if (detail) lines.push("  " + detail);
      return lines.join("\n");
    })
    .join("\n");

  return [
    "\n",
    LINE,
    center("WARISAN CAFE ORDER"),
    center("Warisan Cafe"),
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
  ]
    .filter((l) => l !== null)
    .join("\n");
}

app.get("/api/printers", (req, res) => {
  exec(
    `powershell -Command "Get-Printer | Select-Object -ExpandProperty Name"`,
    (err, stdout) => {
      if (err) return res.json({ printers: [] });
      const printers = stdout.split("\n").map((p) => p.trim()).filter(Boolean);
      res.json({ printers });
    },
  );
});

app.post("/api/print", (req, res) => {
  try {
    const { order, printerName } = req.body || {};
    if (!order) return res.status(400).json({ error: "No order data provided." });

    const receipt = formatReceipt(order);
    const tmpFile = path
      .join(os.tmpdir(), `warisan-${Date.now()}.txt`)
      .replace(/\\/g, "/");
    fs.writeFileSync(tmpFile, receipt, "utf8");

    const target = printerName
      ? `-Name "${printerName.replace(/"/g, "")}"`
      : "";
    const cmd = `powershell -Command "Get-Content '${tmpFile}' | Out-Printer ${target}"`;

    exec(cmd, (err) => {
      try {
        fs.unlinkSync(tmpFile);
      } catch (_) {}
      if (err) {
        console.error("Print error:", err.message);
        return res.status(500).json({ error: "Print failed: " + err.message });
      }
      res.json({ ok: true });
    });
  } catch (err) {
    console.error("Print error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Warisan Cafe running at ${APP_BASE_URL}/index1.html`);
});
