if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}

const AG = (() => {
  const ORDER_STEPS = [
    "awaiting_verification",
    "preparing",
    "ready",
    "delivered",
  ];
  const STEP_LABELS = {
    awaiting_verification: "Awaiting Verification",
    preparing: "Preparing",
    ready: "Ready",
    delivered: "Delivered",
  };
  const RECEIPT_MAX_BYTES = 5 * 1024 * 1024;
  const RECEIPT_PDF_MAX_BYTES = 200 * 1024;
  const RECEIPT_EXT_TO_KIND = {
    jpg: "jpeg",
    jpeg: "jpeg",
    png: "png",
    pdf: "pdf",
  };
  const RECEIPT_MIME_TO_KIND = {
    "image/jpeg": "jpeg",
    "image/jpg": "jpeg",
    "image/png": "png",
    "application/pdf": "pdf",
  };
  const BLOCKED_PAYMENT_STATUSES = new Set([
    "paid",
    "verified",
    "confirmed",
  ]);

  const STAFF = {
    admin: {
      id: "ADMIN001",
      role: "admin",
      name: "Admin Warisan Cafe",
    },
    rider: {
      id: "RIDER001",
      role: "rider",
      name: "Ahmad Rider",
      phone: "",
    },
  };

  const DEFAULT_MENU = [];

  const DEFAULT_BATCHES = [];

  const DELIVERY_OPTIONS = [
    {
      id: "normal",
      name: "Normal Delivery",
      price: 1,
      desc: "Standard delivery",
    },
    {
      id: "fast",
      name: "Fast Delivery",
      price: 2,
      desc: "Priority, faster drop-off",
    },
    {
      id: "door",
      name: "Door to Door Delivery",
      price: 3,
      desc: "Rider brings the order to your door",
    },
  ];

  let app = null,
    auth = null,
    db = null,
    storage = null;
  let appReady = false,
    useFirebase = false;
  const subscribed = new Set();
  const ADMIN_DATA = ["menu", "batches", "orders", "riders"];
  const RIDER_DATA = ["orders", "riders"];
  const cache = {
    menu: [],
    batches: [],
    orders: [],
    notifications: [],
    chatMessages: [],
    riders: [],
  };
  const unsubscribers = [];

  function localGet(k, fb) {
    try {
      const v = localStorage.getItem(k);
      return v === null ? fb : (JSON.parse(v) ?? fb);
    } catch {
      return fb;
    }
  }
  function localSet(k, v) {
    localStorage.setItem(k, JSON.stringify(v));
    window.dispatchEvent(new Event("ag-data"));
  }
  function makeId(prefix) {
    return (
      prefix +
      Date.now().toString().slice(-8) +
      Math.floor(Math.random() * 90 + 10)
    );
  }
  function firebaseEnabled() {
    return Boolean(
      window.USE_FIREBASE &&
      window.firebaseConfig &&
      window.firebaseConfig.apiKey &&
      !window.firebaseConfig.apiKey.includes("PASTE") &&
      window.firebase,
    );
  }
  function nowISO() {
    return new Date().toISOString();
  }

  function toast(title, msg = "") {
    let wrap = document.querySelector(".toast-wrap");
    if (!wrap) {
      wrap = document.createElement("div");
      wrap.className = "toast-wrap";
      document.body.appendChild(wrap);
    }
    const el = document.createElement("div");
    el.className = "ag-toast";
    el.innerHTML = `<strong>${title}</strong><small>${msg}</small>`;
    wrap.appendChild(el);
    setTimeout(() => el.remove(), 5200);
  }

  function session() {
    return localGet("agSession", null);
  }

  async function logout(options) {
    try {
      await init();
      if (useFirebase && auth && auth.currentUser) await auth.signOut();
    } catch (e) {
      console.warn("Logout warning:", e);
    }
    localStorage.removeItem("agSession");
    if (!(options && options.stay)) window.location.href = "login1.html";
  }

  function waitForAuth() {
    if (!auth) return Promise.resolve(null);
    if (auth.currentUser) return Promise.resolve(auth.currentUser);
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(auth.currentUser), 2200);
      const unsub = auth.onAuthStateChanged((user) => {
        clearTimeout(timer);
        unsub();
        resolve(user);
      });
    });
  }

  async function restoreSessionFromAuth() {
    if (!useFirebase || !auth) return session();
    const user = await waitForAuth();
    if (!user) {
      localStorage.removeItem("agSession");
      return null;
    }
    let s = session();
    if (s && s.uid && s.uid !== user.uid) {
      localStorage.removeItem("agSession");
      s = null;
    }
    if (s && s.role) return s;
    try {
      const staffSnap = await db.collection("staff").doc(user.uid).get();
      if (staffSnap.exists) {
        const account = staffSnap.data() || {};
        s = {
          role: account.role,
          uid: user.uid,
          id: staffSnap.id,
          name: account.name || user.displayName || "Staff",
          email: user.email || account.email || "",
          phone: account.phone || "",
        };
        localSet("agSession", s);
        return s;
      }
    } catch (e) {
      console.warn("staff session restore skipped", e);
    }
    try {
      const custSnap = await db.collection("customers").doc(user.uid).get();
      const profile = custSnap.exists
        ? custSnap.data()
        : {
            name: user.displayName || "Customer",
            email: user.email,
            phone: "",
            address: "",
          };
      s = {
        ...profile,
        uid: user.uid,
        email: user.email,
        role: "customer",
      };
      localSet("agSession", s);
      return s;
    } catch (e) {
      console.warn("customer session restore skipped", e);
    }
    return session();
  }

  async function requireRole(allowedRoles, collections) {
    await init();
    let s = useFirebase ? await restoreSessionFromAuth() : session();
    const allowed = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];
    const loginPage =
      allowed.includes("admin") || allowed.includes("rider")
        ? "staff-login1.html"
        : "login1.html";
    if (useFirebase && auth && !(await waitForAuth())) {
      localStorage.removeItem("agSession");
      window.location.href = loginPage;
      return null;
    }
    if (!s || !s.role) {
      window.location.href = loginPage;
      return null;
    }
    if (!allowed.includes(s.role)) {
      const wantsCustomer =
        allowed.includes("customer") && !allowed.includes("admin");
      if (wantsCustomer && (s.role === "admin" || s.role === "rider")) {
        window.location.href = "login1.html";
        return null;
      }
      if (s.role === "admin") window.location.href = "admin-dashboard1.html";
      else if (s.role === "rider")
        window.location.href = "rider-dashboard1.html";
      else window.location.href = "cust-menu1.html";
      return null;
    }
    let needed = collections;
    if (needed === undefined) {
      if (s.role === "admin") needed = ADMIN_DATA;
      else if (s.role === "rider") needed = RIDER_DATA;
      else needed = [];
    }
    if (needed.length) await init(needed);
    if (s.role === "customer") await requireEmailPhone();
    return session() || s;
  }

  function header(title, role = "") {
    const home =
      role === "admin"
        ? "admin-dashboard1.html"
        : role === "rider"
          ? "rider-dashboard1.html"
          : "cust-menu1.html";
    const displayRole = role ? role.toUpperCase() : "CUSTOMER";
    const s = session() || {};
    const firstName = (s.name || "there").split(" ")[0];
    const hour = new Date().getHours();
    const greet =
      hour < 12
        ? "Good Morning"
        : hour < 18
          ? "Good Afternoon"
          : "Good Evening";
    return `<div class="app-header"><div class="header-row"><a class="brand" href="${home}"><img src="images/logo.png?v=warisan" alt="Warisan Cafe"><div class="brand-text"><span class="greeting">${greet}, ${firstName}</span><span class="brand-name">${title}</span></div></a><div class="header-actions"><span class="role-chip">${displayRole}</span><button class="icon-btn" type="button" title="Logout" onclick="AG.logout()"><i class="bi bi-box-arrow-right"></i></button></div></div></div>`;
  }

  async function initLocal() {
    if (!localStorage.getItem("agMenu")) localSet("agMenu", DEFAULT_MENU);
    if (!localStorage.getItem("agBatches"))
      localSet("agBatches", DEFAULT_BATCHES);
    if (!localStorage.getItem("agOrders")) localSet("agOrders", []);
    if (!localStorage.getItem("agNotifications"))
      localSet("agNotifications", []);
    if (!localStorage.getItem("agChatMessages")) localSet("agChatMessages", []);
    if (!localStorage.getItem("agRiders")) localSet("agRiders", []);
    cache.menu = localGet("agMenu", DEFAULT_MENU);
    cache.batches = localGet("agBatches", DEFAULT_BATCHES);
    cache.orders = localGet("agOrders", []);
    cache.notifications = localGet("agNotifications", []);
    cache.chatMessages = localGet("agChatMessages", []);
    cache.riders = localGet("agRiders", []);
  }

  function applySnapshot(name, arr) {
    if (name === "menu") {
      cache.menu = arr
        .map(normalizeMenuItem)
        .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    } else if (name === "batches") {
      cache.batches = arr.sort((a, b) =>
        (a.start || "").localeCompare(b.start || ""),
      );
    } else if (name === "orders") {
      cache.orders = arr.sort(
        (a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0),
      );
    } else if (name === "notifications") {
      cache.notifications = arr.sort(
        (a, b) => new Date(b.at || 0) - new Date(a.at || 0),
      );
    } else if (name === "chatMessages") {
      cache.chatMessages = arr.sort(
        (a, b) => new Date(a.at || 0) - new Date(b.at || 0),
      );
    } else if (name === "riders") {
      cache.riders = arr.sort((a, b) =>
        String(a.name || "").localeCompare(String(b.name || "")),
      );
    }
  }

  async function bootFirebase() {
    if (appReady) return;
    useFirebase = firebaseEnabled();
    if (!useFirebase) {
      await initLocal();
      appReady = true;
      return;
    }
    try {
      app = firebase.apps.length
        ? firebase.app()
        : firebase.initializeApp(window.firebaseConfig);
      auth = firebase.auth();
      db = firebase.firestore();
      storage = firebase.storage ? firebase.storage() : null;
      appReady = true;
    } catch (err) {
      console.error("Firebase init failed:", err);
      toast("Firebase init failed", err.message);
      await initLocal();
      useFirebase = false;
      appReady = true;
    }
  }

  const ORDER_LIST_LIMIT = 250;
  const CUSTOMER_ORDER_LIMIT = 20;

  function slimOrder(raw) {
    const o = { ...(raw || {}) };
    if (o.receiptDataUrl) {
      o.hasReceipt = true;
      o.receiptDataUrl = "";
    }
    if (typeof o.proof === "string" && o.proof.length > 180) {
      o.hasProof = true;
      o.proof = "";
    }
    return o;
  }

  function ordersRefForSession() {
    const s = session();
    let ref = db.collection("orders");
    if (s && s.role === "customer") {
      if (s.uid) ref = ref.where("customerUid", "==", s.uid);
      else if (s.email) ref = ref.where("email", "==", s.email);
      return ref.limit(CUSTOMER_ORDER_LIMIT);
    }
    return ref.orderBy("createdAt", "desc").limit(ORDER_LIST_LIMIT);
  }

  function listenOrders() {
    if (!db || subscribed.has("orders")) return Promise.resolve();
    subscribed.add("orders");
    return new Promise((resolve) => {
      let first = true;
      const finish = () => {
        if (!first) return;
        first = false;
        resolve();
      };
      let usedFallback = false;
      const attach = (ref, isFallback) => {
        const unsub = ref.onSnapshot(
          (snap) => {
            try {
              const arr = [];
              snap.forEach((doc) =>
                arr.push(slimOrder({ id: doc.id, ...doc.data() })),
              );
              applySnapshot("orders", arr);
              window.dispatchEvent(new Event("ag-data"));
            } catch (err) {
              console.error("orders snapshot", err);
            }
            finish();
          },
          (err) => {
            console.warn("orders listen failed", err && err.message);
            if (!usedFallback && !isFallback) {
              usedFallback = true;
              attach(db.collection("orders").limit(ORDER_LIST_LIMIT), true);
              return;
            }
            finish();
          },
        );
        unsubscribers.push(unsub);
      };
      try {
        attach(ordersRefForSession(), false);
      } catch (err) {
        attach(db.collection("orders").limit(ORDER_LIST_LIMIT), true);
      }
    });
  }

  function listenCollection(name) {
    if (name === "orders") return listenOrders();
    if (!db || subscribed.has(name)) return Promise.resolve();
    subscribed.add(name);
    return new Promise((resolve) => {
      let first = true;
      const finish = () => {
        if (!first) return;
        first = false;
        resolve();
      };
      const unsub = db.collection(name).onSnapshot(
        (snap) => {
          try {
            const arr = [];
            snap.forEach((doc) => arr.push({ id: doc.id, ...doc.data() }));
            applySnapshot(name, arr);
            window.dispatchEvent(new Event("ag-data"));
          } catch (err) {
            console.error(`${name} snapshot`, err);
          }
          finish();
        },
        (err) => {
          console.warn(`Firebase read skipped: ${name}`, err && err.message);
          finish();
        },
      );
      unsubscribers.push(unsub);
    });
  }

  async function subscribeCollections(names) {
    await bootFirebase();
    if (!useFirebase || !db) return;
    const needed = [...new Set(names)].filter(Boolean);
    await Promise.race([
      Promise.all(needed.map((name) => listenCollection(name))),
      new Promise((r) => setTimeout(r, 400)),
    ]);
  }

  async function init(collections) {
    await bootFirebase();
    if (Array.isArray(collections) && collections.length) {
      await subscribeCollections(collections);
    }
  }

  async function seedDefaultsIfNeeded() {
    return;
  }

  function normalizeMenuItem(item) {
    const m = { ...item };
    if (!m.variationGroups) {
      m.variationGroups = [
        {
          name: "Option",
          options: (m.variations || [{ name: "Normal", price: 0 }]).map(
            (v) => ({ name: v.name, price: Number(v.price || 0) }),
          ),
        },
      ];
    }
    m.variationGroups = (m.variationGroups || [])
      .map((g) => {
        const type = g.type === "addon" ? "addon" : "single";
        return {
          name: g.name || (type === "addon" ? "Add On" : "Option"),
          type,
          required: type === "single" ? g.required !== false : false,
          options: (g.options || []).map((o) => ({
            name: o.name || "Normal",
            price: Number(o.price || 0),
          })),
        };
      })
      .filter((g) => g.options.length);
    if (!m.variationGroups.length)
      m.variationGroups = [
        { name: "Option", options: [{ name: "Normal", price: 0 }] },
      ];
    return m;
  }

  function customerContact(s = session()) {
    const p = s || {};
    return {
      email: String(p.email || "").trim(),
      phone: String(p.phone || "").trim(),
      address: String(p.addressDetail || p.address || "").trim(),
    };
  }

  function needsCustomerIdentity(s = session()) {
    const c = customerContact(s);
    return !c.phone || !c.address;
  }

  function validCustomerEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim());
  }

  function validCustomerPhone(phone) {
    const digits = String(phone || "").replace(/\D/g, "");
    return digits.length >= 8 && digits.length <= 15;
  }

  let identityPrompt = null;

  function openIdentityOverlay(s, onSaved) {
    const old = document.getElementById("agIdentityOverlay");
    if (old) old.remove();
    const overlay = document.createElement("div");
    overlay.id = "agIdentityOverlay";
    overlay.innerHTML =
      '<style>' +
      "#agIdentityOverlay{position:fixed;inset:0;z-index:1080;background:rgba(20,16,16,.55);display:flex;align-items:center;justify-content:center;padding:18px}" +
      "#agIdentityCard{width:min(100%,400px);background:#fffdf8;border-radius:22px;box-shadow:0 14px 40px rgba(27,122,61,.18);padding:22px 20px 18px}" +
      "#agIdentityCard h5{font-weight:800;margin:0 0 6px;text-align:center}" +
      "#agIdentityCard p{color:#6c757d;font-size:.86rem;text-align:center;margin:0 0 16px}" +
      "#agIdentityCard label{font-size:.8rem;font-weight:700;margin-bottom:4px}" +
      "#agIdentityCard .form-control{border-radius:12px}" +
      "#agIdentityAddress{min-height:88px;resize:vertical}" +
      "#agIdentityErr{display:none;color:#c62828;font-size:.8rem;margin:0 0 10px;text-align:center}" +
      "</style>" +
      '<div id="agIdentityCard" role="dialog" aria-modal="true" aria-labelledby="agIdentityTitle">' +
      '<h5 id="agIdentityTitle">Complete your details</h5>' +
      "<p>Phone number and delivery address are required before you can order.</p>" +
      '<div class="mb-3 text-start"><label class="form-label" for="agIdentityPhone">Phone</label>' +
      '<input id="agIdentityPhone" type="tel" class="form-control" placeholder="e.g. 0123456789" autocomplete="tel" required></div>' +
      '<div class="mb-3 text-start"><label class="form-label" for="agIdentityAddress">Delivery address</label>' +
      '<textarea id="agIdentityAddress" class="form-control" placeholder="House number, street, area" autocomplete="street-address" required></textarea></div>' +
      '<p id="agIdentityErr"></p>' +
      '<button type="button" class="btn btn-brand w-100 py-2" id="agIdentitySave">Save and continue</button>' +
      "</div>";
    document.body.appendChild(overlay);
    document.body.style.overflow = "hidden";
    const phoneInput = document.getElementById("agIdentityPhone");
    const addressInput = document.getElementById("agIdentityAddress");
    const err = document.getElementById("agIdentityErr");
    const saveBtn = document.getElementById("agIdentitySave");
    phoneInput.value = String((s && s.phone) || "").trim();
    addressInput.value = String((s && (s.addressDetail || s.address)) || "").trim();
    phoneInput.focus();

    saveBtn.onclick = async () => {
      const phone = phoneInput.value.trim();
      const address = addressInput.value.trim();
      if (!validCustomerPhone(phone)) {
        err.textContent = "Please enter a valid phone number.";
        err.style.display = "block";
        return;
      }
      if (!address) {
        err.textContent = "Please enter your delivery address.";
        err.style.display = "block";
        return;
      }
      try {
        saveBtn.disabled = true;
        await updateCustomerProfile({
          email: (s && s.email) || (auth && auth.currentUser && auth.currentUser.email) || "",
          phone,
          name: (s && s.name) || "Customer",
          address,
          addressDetail: address,
          addressArea: (s && s.addressArea) || "",
        });
        overlay.remove();
        document.body.style.overflow = "";
        if (onSaved) onSaved();
      } catch (e) {
        err.textContent = e.message || "Could not save your details.";
        err.style.display = "block";
      } finally {
        saveBtn.disabled = false;
      }
    };
  }

  function requireEmailPhone() {
    const s = session();
    if (!s || s.role !== "customer") return Promise.resolve(s);
    const page = String(location.pathname || "").toLowerCase();
    if (page.endsWith("cust-profile1.html")) return Promise.resolve(s);
    if (!needsCustomerIdentity(s)) return Promise.resolve(s);
    if (identityPrompt) return identityPrompt;
    identityPrompt = new Promise((resolve) => {
      openIdentityOverlay(s, () => {
        identityPrompt = null;
        resolve(session());
      });
    });
    return identityPrompt;
  }

  function assertCustomerContact(s = session(), extra = {}) {
    const current = customerContact(s);
    const phone =
      extra.phone !== undefined ? String(extra.phone || "").trim() : current.phone;
    const address =
      extra.address !== undefined
        ? String(extra.address || "").trim()
        : current.address;
    const missing = [];
    if (!phone) missing.push("phone number");
    if (!address) missing.push("delivery address");
    if (missing.length) {
      throw new Error("Please add your " + missing.join(" and ") + ".");
    }
    return { phone, address };
  }

  function needsCustomerContact(s = session()) {
    try {
      assertCustomerContact(s);
      return false;
    } catch (e) {
      return true;
    }
  }

  async function getRiderPhone() {
    await init();
    const assigned = String(localGet("agRiderPhone", "") || "").trim();
    const fromList = riders()[0] && riders()[0].phone;
    const fallback = String(fromList || assigned || STAFF.rider.phone || "").trim();
    if (!useFirebase || !db) return fallback;
    try {
      const list = riders();
      if (list.length) return String(list[0].phone || "").trim();
      const doc = await db.collection("staff").doc("RIDER001").get();
      return String((doc.exists && doc.data().phone) || fallback).trim();
    } catch (e) {
      return fallback;
    }
  }

  async function saveRiderPhone(phone) {
    const clean = String(phone || "").trim();
    if (!clean) throw new Error("Please add the rider phone number.");
    await init();
    localSet("agRiderPhone", clean);
    STAFF.rider.phone = clean;
    if (useFirebase && db) {
      await db
        .collection("staff")
        .doc("RIDER001")
        .set({ phone: clean, id: "RIDER001", role: "rider" }, { merge: true });
    }
    return clean;
  }

  async function getCustomerProfile() {
    await init();
    const s = session();
    if (useFirebase && auth && auth.currentUser) {
      const user = auth.currentUser;
      const ref = db.collection("customers").doc(user.uid);
      const doc = await ref.get();
      const profile = doc.exists
        ? { ...doc.data(), uid: user.uid, email: user.email, role: "customer" }
        : {
            uid: user.uid,
            name: user.displayName || "Customer",
            email: user.email,
            phone: "",
            address: "",
            role: "customer",
            provider: "google",
            createdAt: nowISO(),
          };
      await ref.set(profile, { merge: true });
      localSet("agSession", profile);
      return profile;
    }
    return s;
  }

  async function updateCustomerProfile(data) {
    await init();
    const s = session();
    if (!s) throw new Error("No customer session found.");
    const addressArea   = data.addressArea   !== undefined ? data.addressArea   : (s.addressArea   || "");
    const addressDetail = data.addressDetail !== undefined ? data.addressDetail : (s.addressDetail || "");
    const address = addressArea
      ? (addressDetail ? addressDetail + ", " + addressArea : addressArea)
      : (data.address || s.address || "");
    const phone = data.phone !== undefined ? data.phone : s.phone;
    const email = String(
      data.email !== undefined
        ? data.email
        : s.email || (auth && auth.currentUser && auth.currentUser.email) || "",
    ).trim();
    if (email && !validCustomerEmail(email)) {
      throw new Error("Please add a valid email address.");
    }
    if (!validCustomerPhone(phone)) {
      throw new Error("Please add a valid phone number.");
    }
    if (!String(addressDetail || address || "").trim()) {
      throw new Error("Please add your delivery address.");
    }
    const updated = {
      ...s,
      name: data.name || s.name || "Customer",
      email,
      phone: String(phone || "").trim(),
      address: String(address || "").trim(),
      addressArea,
      addressDetail: String(addressDetail || address || "").trim(),
      role: "customer",
      updatedAt: nowISO(),
    };
    if (useFirebase) {
      const uid =
        updated.uid || (auth && auth.currentUser ? auth.currentUser.uid : null);
      if (!uid) throw new Error("Firebase user not found.");
      updated.uid = uid;
      await db.collection("customers").doc(uid).set(updated, { merge: true });
    }
    localSet("agSession", updated);
    return updated;
  }

  async function registerCustomer(data) {
    await init();
    const phone = String(data.phone || "").trim();
    const address = String(data.address || data.addressDetail || "").trim();
    assertCustomerContact({}, { phone, address });
    if (useFirebase) {
      const cred = await auth.createUserWithEmailAndPassword(
        data.email,
        data.password,
      );
      await cred.user.updateProfile({ displayName: data.name });
      const safe = {
        uid: cred.user.uid,
        name: data.name,
        email: data.email,
        phone,
        address,
        addressDetail: address,
        role: "customer",
        createdAt: nowISO(),
      };
      await db
        .collection("customers")
        .doc(cred.user.uid)
        .set(safe, { merge: true });
      localSet("agSession", safe);
      return safe;
    }
    const users = localGet("agCustomers", []);
    if (users.some((u) => u.email === data.email))
      throw new Error("Email already registered.");
    users.push(data);
    localSet("agCustomers", users);
    const safe = {
      role: "customer",
      name: data.name,
      email: data.email,
      address,
      addressDetail: address,
      phone,
    };
    localSet("agSession", safe);
    return safe;
  }

  async function loginCustomer(email, password) {
    await init();
    if (useFirebase) {
      const cred = await auth.signInWithEmailAndPassword(email, password);
      const staffHit = await staffRecordForUser(cred.user);
      if (staffHit) {
        await auth.signOut();
        throw new Error("This email is a staff account. Use Staff login.");
      }
      const doc = await db.collection("customers").doc(cred.user.uid).get();
      const profile = doc.exists
        ? doc.data()
        : {
            uid: cred.user.uid,
            name: cred.user.displayName || "Customer",
            email: cred.user.email,
            phone: "",
            address: "",
            role: "customer",
          };
      localSet("agSession", {
        ...profile,
        uid: cred.user.uid,
        email: cred.user.email,
        role: "customer",
      });
      return profile;
    }
    const u = localGet("agCustomers", []).find(
      (x) => x.email === email && x.password === password,
    );
    if (!u) throw new Error("Wrong email or password.");
    const safe = {
      role: "customer",
      name: u.name,
      email: u.email,
      address: u.address || "",
      phone: u.phone || "",
    };
    localSet("agSession", safe);
    return safe;
  }

  async function googleLogin() {
    await init();
    if (!useFirebase) {
      throw new Error(
        "Firebase is not configured. Google login requires Firebase Authentication.",
      );
    }
    const provider = new firebase.auth.GoogleAuthProvider();
    const cred = await auth.signInWithPopup(provider);
    const user = cred.user;
    const staffHit = await staffRecordForUser(user);
    if (staffHit) {
      await auth.signOut();
      throw new Error("This email is a staff account. Use Staff login.");
    }
    const ref = db.collection("customers").doc(user.uid);
    const doc = await ref.get();
    const profile = doc.exists
      ? {
          ...doc.data(),
          uid: user.uid,
          name: doc.data().name || user.displayName || "Customer",
          email: user.email,
          role: "customer",
          provider: "google",
        }
      : {
          uid: user.uid,
          name: user.displayName || "Customer",
          email: user.email,
          phone: "",
          address: "",
          role: "customer",
          provider: "google",
          createdAt: nowISO(),
        };
    await ref.set(profile, { merge: true });
    localSet("agSession", profile);
    return profile;
  }

  async function staffRecordForUser(user) {
    if (!user || !db) return null;
    const byUid = await db.collection("staff").doc(user.uid).get();
    if (byUid.exists) return { id: byUid.id, ...(byUid.data() || {}) };
    const email = String(user.email || "").trim();
    if (!email) return null;
    const q = await db
      .collection("staff")
      .where("email", "==", email)
      .limit(1)
      .get();
    if (q.empty) return null;
    const doc = q.docs[0];
    return { id: doc.id, ...(doc.data() || {}) };
  }

  async function loginStaff(emailVal, password) {
    await init();
    const email = String(emailVal || "").trim();
    const staffPassword = String(password || "").trim();
    if (!email || !staffPassword) {
      throw new Error("Enter staff email and password.");
    }
    if (!useFirebase || !auth) {
      throw new Error("Staff login requires Firebase Authentication.");
    }
    const cred = await auth.signInWithEmailAndPassword(email, staffPassword);
    const account = await staffRecordForUser(cred.user);
    if (!account || (account.role !== "admin" && account.role !== "rider")) {
      await auth.signOut();
      throw new Error(
        "This account is not registered as staff. In Firestore, add collection staff, document ID = this user's UID, field role = admin or rider.",
      );
    }
    localSet("agSession", {
      role: account.role,
      uid: cred.user.uid,
      id: account.id,
      name: account.name || cred.user.displayName || "Staff",
      email: cred.user.email || account.email || email,
      phone: account.phone || "",
    });
    return account.role;
  }

  function menu() {
    return (
      cache.menu.length ? cache.menu : localGet("agMenu", DEFAULT_MENU)
    ).map(normalizeMenuItem);
  }

  function pruneCartAgainstMenu() {
    const live = menu();
    if (!live.length) return localGet("ayamGepukCart", []);
    const allowed = new Set(live.map((m) => m.id));
    const cart = localGet("ayamGepukCart", []);
    if (!Array.isArray(cart) || !cart.length) return cart;
    const next = cart.filter((item) => {
      if (!item || !item.id) return true;
      if (String(item.name || "").startsWith("Delivery")) return true;
      return allowed.has(item.id);
    });
    if (next.length !== cart.length) localSet("ayamGepukCart", next);
    return next;
  }
  function riders() {
    return cache.riders.length ? cache.riders : localGet("agRiders", []);
  }

  async function saveRider(rider) {
    await init();
    const name = String(rider.name || "").trim();
    const phone = String(rider.phone || "").trim();
    if (!name || !phone) {
      throw new Error("Please add the rider name and phone number.");
    }
    const item = {
      id: rider.id || makeId("RDR"),
      name,
      phone,
      updatedAt: nowISO(),
      createdAt: rider.createdAt || nowISO(),
    };
    if (useFirebase && db) {
      await db.collection("riders").doc(item.id).set(item, { merge: true });
    }
    const all = riders().filter((r) => r.id !== item.id);
    all.push(item);
    cache.riders = all.sort((a, b) =>
      String(a.name || "").localeCompare(String(b.name || "")),
    );
    localSet("agRiders", cache.riders);
    window.dispatchEvent(new Event("ag-data"));
    return item;
  }

  async function deleteRider(riderId) {
    await init();
    if (!riderId) return;
    if (useFirebase && db) {
      await db.collection("riders").doc(riderId).delete();
    }
    cache.riders = riders().filter((r) => r.id !== riderId);
    localSet("agRiders", cache.riders);
    window.dispatchEvent(new Event("ag-data"));
  }

  async function acceptJob(orderId, rider) {
    await init();
    const name = String((rider && rider.name) || "").trim();
    const phone = String((rider && rider.phone) || "").trim();
    if (!name || !phone) {
      throw new Error("Choose a rider with a name and phone number first.");
    }
    const fields = {
      riderId: rider.id || "",
      riderName: name,
      riderPhone: phone,
      riderAcceptedAt: nowISO(),
      updatedAt: nowISO(),
    };
    if (useFirebase && db) {
      await db.collection("orders").doc(orderId).set(fields, { merge: true });
    }
    cache.orders = orders().map((o) =>
      o.id === orderId ? { ...o, ...fields } : o,
    );
    localSet("agOrders", cache.orders);
    window.dispatchEvent(new Event("ag-data"));
    return cache.orders.find((o) => o.id === orderId);
  }

  function batches() {
    return cache.batches.length
      ? cache.batches
      : localGet("agBatches", DEFAULT_BATCHES);
  }

  function orders() {
    return cache.orders.length ? cache.orders : localGet("agOrders", []);
  }
  function notifications() {
    return cache.notifications.length
      ? cache.notifications
      : localGet("agNotifications", []);
  }
  function chatMessages() {
    return cache.chatMessages.length
      ? cache.chatMessages
      : localGet("agChatMessages", []);
  }

  function getChatMessages(orderId) {
    return chatMessages()
      .filter((m) => m.orderId === orderId)
      .sort((a, b) => new Date(a.at || 0) - new Date(b.at || 0));
  }

  function currentReaderId() {
    const s = session() || {};
    return s.uid || s.id || s.email || s.role || "guest";
  }

  function unreadChatCount(orderId = "", role = "") {
    const s = session() || {};
    const reader = currentReaderId();
    const userRole = role || s.role || "";
    return chatMessages().filter((m) => {
      if (orderId && m.orderId !== orderId) return false;
      if (m.senderId === reader) return false;
      if (userRole && m.senderRole === userRole) return false;
      if (Array.isArray(m.readBy) && m.readBy.includes(reader)) return false;
      if (
        s.role === "customer" &&
        s.uid &&
        m.customerUid &&
        m.customerUid !== s.uid
      )
        return false;
      if (s.role === "rider" && s.id && m.riderId && m.riderId !== s.id)
        return false;
      return true;
    }).length;
  }

  async function markChatRead(orderId) {
    await init();
    if (!orderId) return;
    const reader = currentReaderId();
    const unread = getChatMessages(orderId).filter(
      (m) => !(Array.isArray(m.readBy) && m.readBy.includes(reader)),
    );
    if (useFirebase) {
      await Promise.all(
        unread.map((m) =>
          db
            .collection("chatMessages")
            .doc(m.id)
            .set(
              { readBy: firebase.firestore.FieldValue.arrayUnion(reader) },
              { merge: true },
            )
            .catch(() => null),
        ),
      );
      cache.chatMessages = cache.chatMessages.map((m) =>
        m.orderId === orderId
          ? { ...m, readBy: Array.from(new Set([...(m.readBy || []), reader])) }
          : m,
      );
      window.dispatchEvent(new Event("ag-data"));
    } else {
      const arr = chatMessages().map((m) =>
        m.orderId === orderId
          ? { ...m, readBy: Array.from(new Set([...(m.readBy || []), reader])) }
          : m,
      );
      cache.chatMessages = arr;
      localSet("agChatMessages", arr);
    }
  }

  async function sendChatMessage(orderId, text, senderRole = "") {
    await init();
    const s = session() || {};
    const cleanText = String(text || "").trim();
    if (!orderId) throw new Error("Order ID missing.");
    if (!cleanText) throw new Error("Please type a message.");
    const order = orders().find((o) => o.id === orderId) || {};
    const role = senderRole || s.role || "customer";
    const msg = {
      id: makeId("MSG"),
      orderId,
      text: cleanText,
      senderRole: role,
      senderId: s.uid || s.id || s.email || role,
      senderName: s.name || (role === "rider" ? "Runner" : "Customer"),
      customerUid: order.customerUid || "",
      email: order.email || "",
      riderId: order.riderId || "RIDER001",
      at: nowISO(),
      readBy: [s.uid || s.id || s.email || role],
    };
    if (useFirebase) {
      await db.collection("chatMessages").doc(msg.id).set(msg);
      cache.chatMessages = [
        ...cache.chatMessages.filter((m) => m.id !== msg.id),
        msg,
      ].sort((a, b) => new Date(a.at || 0) - new Date(b.at || 0));
      window.dispatchEvent(new Event("ag-data"));
    } else {
      const arr = chatMessages();
      arr.push(msg);
      cache.chatMessages = arr;
      localSet("agChatMessages", arr);
    }
    const targetRole = role === "customer" ? "rider" : "customer";
    return msg;
  }

  async function saveMenu(arr) {
    await init();
    const clean = arr.map((m) =>
      normalizeMenuItem({ ...m, updatedAt: Date.now() }),
    );
    if (!useFirebase) {
      cache.menu = clean;
      localSet("agMenu", clean);
      return;
    }
    const batch = db.batch();
    const old = await db.collection("menu").get();
    old.forEach((d) => batch.delete(d.ref));
    clean.forEach((m) => batch.set(db.collection("menu").doc(m.id), m));
    await batch.commit();
  }

  async function saveMenuItem(item) {
    await init();
    const clean = normalizeMenuItem({ ...item, updatedAt: Date.now() });

    if (!useFirebase) {
      const all = menu();
      const index = all.findIndex((m) => m.id === clean.id);
      if (index >= 0) all[index] = clean;
      else all.push(clean);
      cache.menu = all;
      localSet("agMenu", all);
      return clean;
    }

    await db.collection("menu").doc(clean.id).set(clean, { merge: true });

    const index = cache.menu.findIndex((m) => m.id === clean.id);
    if (index >= 0) cache.menu[index] = clean;
    else cache.menu.push(clean);
    cache.menu = cache.menu.sort(
      (a, b) => (a.createdAt || 0) - (b.createdAt || 0),
    );
    window.dispatchEvent(new Event("ag-data"));
    return clean;
  }

  async function deleteMenuItem(menuId) {
    await init();

    if (!useFirebase) {
      const all = menu().filter((m) => m.id !== menuId);
      cache.menu = all;
      localSet("agMenu", all);
      return;
    }

    await db.collection("menu").doc(menuId).delete();
    cache.menu = cache.menu.filter((m) => m.id !== menuId);
    window.dispatchEvent(new Event("ag-data"));
  }

  async function saveBatches(arr) {
    await init();
    if (!useFirebase) {
      cache.batches = arr;
      localSet("agBatches", arr);
      return;
    }
    const batch = db.batch();
    const old = await db.collection("batches").get();
    old.forEach((d) => batch.delete(d.ref));
    arr.forEach((b) => batch.set(db.collection("batches").doc(b.id), b));
    await batch.commit();
  }

  async function saveOrders(arr) {
    await init();
    if (!useFirebase) {
      cache.orders = arr;
      localSet("agOrders", arr);
      return;
    }
    const batch = db.batch();
    const old = await db.collection("orders").get();
    old.forEach((d) => batch.delete(d.ref));
    arr.forEach((o) => batch.set(db.collection("orders").doc(o.id), o));
    await batch.commit();
  }

  async function addNotification(
    orderId,
    title,
    msg,
    role = "customer",
    target = {},
  ) {
    const n = {
      id: makeId("n"),
      orderId,
      title,
      msg,
      role,
      customerUid: target.customerUid || "",
      email: target.email || "",
      readBy: [],
      read: false,
      at: nowISO(),
    };
    if (useFirebase) await db.collection("notifications").doc(n.id).set(n);
    else {
      const arr = localGet("agNotifications", []);
      arr.unshift(n);
      localSet("agNotifications", arr);
    }
    toast(title, msg);
    return n;
  }

  async function createOrder(cart, payment, batchId, extra = {}) {
    await init();
    const s = session() || {};
    const total = cart.reduce(
      (a, i) => a + Number(i.price || 0) * Number(i.quantity || 1),
      0,
    );
    const orderNotes = cart
      .map((i) => (i.note ? `${i.quantity}x ${i.name}: ${i.note}` : ""))
      .filter(Boolean)
      .join(" | ");
    const requestedPay = String(extra.paymentStatus || "").toLowerCase();
    if (BLOCKED_PAYMENT_STATUSES.has(requestedPay)) {
      throw new Error("Customers cannot mark a payment as paid or verified.");
    }
    const contact = assertCustomerContact(s);
    if (!validCustomerEmail(s.email)) {
      throw new Error("Please add your email address before ordering.");
    }
    if (useFirebase) {
      if (!auth || !auth.currentUser) {
        throw new Error("Please sign in again before placing an order.");
      }
    }
    const receiptId = extra.receiptId || makeId("RCP");
    const order = {
      id: makeId("ORD"),
      customer: s.name || "Guest",
      customerUid: useFirebase && auth.currentUser ? auth.currentUser.uid : s.uid || "",
      email: s.email || "",
      phone: contact.phone,
      address: contact.address,
      items: cart,
      total,
      payment: payment || "QR",
      paymentStatus: "awaiting_verification",
      paymentProvider: "QR",
      paymentRef: null,
      receiptId,
      receiptFileName: extra.receiptFileName || "",
      receiptContentType: extra.receiptContentType || "",
      receiptUploadedAt: extra.receiptUploadedAt || nowISO(),
      receiptPath: extra.receiptPath || "",
      receiptUrl: extra.receiptUrl || "",
      receiptDataUrl: "",
      batchId,
      deliveryType: extra.deliveryType || "",
      deliveryName: extra.deliveryName || "",
      status: "awaiting_verification",
      riderId: "RIDER001",
      proof: null,
      proofUrl: null,
      notes: orderNotes,
      orderNotes,
      createdAt: nowISO(),
      updatedAt: nowISO(),
      history: [{ status: "awaiting_verification", at: nowISO() }],
    };
    if (useFirebase) {
      await db.collection("orders").doc(order.id).set(order);
      const pax = cart
        .filter((i) => !String(i.name || "").startsWith("Delivery"))
        .reduce((a, i) => a + Number(i.quantity || 1), 0);
      if (batchId && pax && firebase.firestore.FieldValue) {
        try {
          await db.collection("batches").doc(batchId).set(
            { usedPax: firebase.firestore.FieldValue.increment(pax) },
            { merge: true },
          );
        } catch (e) {
          console.warn("batch usedPax skip", e);
        }
      }
      cache.orders = [
        slimOrder(order),
        ...cache.orders.filter((o) => o.id !== order.id),
      ];
      window.dispatchEvent(new Event("ag-data"));
    } else {
      const all = orders();
      all.unshift(order);
      cache.orders = all;
      localSet("agOrders", all);
    }
    await addNotification(
      order.id,
      "Payment submitted",
      `Order ${order.id} is waiting for admin payment verification.`,
      "customer",
      order,
    );
    await addNotification(
      order.id,
      "Awaiting verification",
      `Order ${order.id} has a payment receipt to verify.`,
      "admin",
      order,
    );
    return order;
  }

  async function updateOrderStatus(orderId, status, notes = "", proofUrl = "") {
    await init();
    const now = nowISO();
    if (status !== "awaiting_verification") status = kitchenStatus(status);
    if (useFirebase) {
      const ref = db.collection("orders").doc(orderId);
      const snap = await ref.get();
      if (!snap.exists) throw new Error("Order not found.");
      const oldOrder = snap.data();
      assertKitchenStatusAllowed(oldOrder, status);
      const history = oldOrder.history || [];
      history.push({ status, at: now });
      const data = { status, history, updatedAt: now };
      if (status === "ready") data.riderPhone = await getRiderPhone();
      if (notes) data.notes = notes;
      if (proofUrl) {
        data.proof = proofUrl;
        data.proofUrl = proofUrl;
        if (String(proofUrl).startsWith("data:image"))
          data.proofBase64 = proofUrl;
      }
      await ref.update(data);
      const updatedOrder = { id: orderId, ...oldOrder, ...data };
      const index = cache.orders.findIndex((o) => o.id === orderId);
      if (index >= 0) cache.orders[index] = updatedOrder;
      else cache.orders.unshift(updatedOrder);
      window.dispatchEvent(new Event("ag-data"));
      await addNotification(
        orderId,
        STEP_LABELS[status] || "Order Updated",
        `Order ${orderId}: ${STEP_LABELS[status] || status}`,
        "customer",
        updatedOrder,
      );
      return updatedOrder;
    }
    const all = orders();
    const order = all.find((o) => o.id === orderId);
    if (!order) throw new Error("Order not found.");
    assertKitchenStatusAllowed(order, status);
    order.status = status;
    order.updatedAt = now;
    if (notes) order.notes = notes;
    if (proofUrl) {
      order.proof = proofUrl;
      order.proofUrl = proofUrl;
      if (String(proofUrl).startsWith("data:image"))
        order.proofBase64 = proofUrl;
    }
    order.history = order.history || [];
    order.history.push({ status, at: now });
    if (status === "ready") order.riderPhone = await getRiderPhone();
    cache.orders = all;
    localSet("agOrders", all);
    window.dispatchEvent(new Event("ag-data"));
    await addNotification(
      orderId,
      STEP_LABELS[status] || "Order Updated",
      `Order ${orderId}: ${STEP_LABELS[status] || status}`,
      "customer",
      order,
    );
    return order;
  }

  function assertKitchenStatusAllowed(order, status) {
    const pay = order.paymentStatus || "";
    if (
      pay === "awaiting_verification" &&
      status !== "awaiting_verification"
    ) {
      throw new Error(
        "Verify payment before updating kitchen status.",
      );
    }
  }

  function receiptKindFromName(name) {
    const ext = String(name || "")
      .trim()
      .split(".")
      .pop()
      .toLowerCase();
    return RECEIPT_EXT_TO_KIND[ext] || "";
  }

  function receiptKindFromMime(mime) {
    return RECEIPT_MIME_TO_KIND[String(mime || "").toLowerCase()] || "";
  }

  function receiptKindFromBytes(bytes) {
    if (!bytes || bytes.length < 4) return "";
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
      return "jpeg";
    if (
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47
    )
      return "png";
    if (
      bytes[0] === 0x25 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x44 &&
      bytes[3] === 0x46
    )
      return "pdf";
    return "";
  }

  async function validateReceiptFile(file) {
    if (!file) throw new Error("Please choose a payment receipt file.");
    if (file.size > RECEIPT_MAX_BYTES) {
      throw new Error("Receipt file must be 5 MB or smaller.");
    }
    const extKind = receiptKindFromName(file.name);
    if (!extKind) {
        throw new Error(
        "Only screenshots (JPG, JPEG, PNG) and PDF receipts are allowed.",
      );
    }
    const mimeKind = receiptKindFromMime(file.type);
    if (mimeKind && extKind !== mimeKind) {
      throw new Error(
        "File extension and file type do not match. Receipt rejected.",
      );
    }
    const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    const magicKind = receiptKindFromBytes(header);
    if (!magicKind) {
      throw new Error(
        "This file is not a valid screenshot (JPG, JPEG, PNG) or PDF.",
      );
    }
    if (magicKind !== extKind) {
      throw new Error(
        "The file content does not match the selected format. Receipt rejected.",
      );
    }
    if (magicKind === "pdf" && file.size > RECEIPT_PDF_MAX_BYTES) {
      throw new Error(
        "PDF must be 200 KB or smaller. Compress it, or upload a JPG or PNG screenshot.",
      );
    }
    const mime =
      magicKind === "jpeg"
        ? "image/jpeg"
        : magicKind === "png"
          ? "image/png"
          : "application/pdf";
    return { kind: magicKind, contentType: mime };
  }

  function receiptFileExtension(kind) {
    if (kind === "png") return ".png";
    if (kind === "pdf") return ".pdf";
    return ".jpg";
  }

  async function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("Failed to read receipt file."));
      reader.readAsDataURL(file);
    });
  }

  async function encodeReceiptPreview(file, kind) {
    if (kind === "pdf") {
      if (file.size > RECEIPT_PDF_MAX_BYTES) return "";
      return fileToDataUrl(file);
    }
    return compressImageToBase64(file, {
      maxWidth: 640,
      maxHeight: 640,
      quality: 0.42,
    });
  }

  async function uploadPaymentReceiptFile(file, orderId, receiptId, kind) {
    await init();
    if (!useFirebase || !storage) {
      throw new Error(
        "Receipt upload requires Firebase Storage. Sign in and try again.",
      );
    }
    const path = `receipts/${orderId}/${receiptId}${receiptFileExtension(kind)}`;
    const ref = storage.ref(path);
    await ref.put(file, {
      contentType:
        kind === "jpeg"
          ? "image/jpeg"
          : kind === "png"
            ? "image/png"
            : "application/pdf",
    });
    let receiptUrl = "";
    try {
      receiptUrl = await ref.getDownloadURL();
    } catch (err) {
      console.warn("Receipt download URL unavailable:", err);
    }
    return { receiptPath: path, receiptUrl };
  }

  async function persistOrderReceipt(orderId, receiptFields) {
    await init();
    const applyLocal = () => {
      const index = cache.orders.findIndex((o) => o.id === orderId);
      if (index >= 0)
        cache.orders[index] = { ...cache.orders[index], ...receiptFields };
      window.dispatchEvent(new Event("ag-data"));
    };
    if (useFirebase) {
      try {
        await db.collection("orders").doc(orderId).set(receiptFields, {
          merge: true,
        });
      } catch (err) {
        if (!receiptFields.receiptDataUrl) throw err;
        const rest = { ...receiptFields, receiptDataUrl: "" };
        await db.collection("orders").doc(orderId).set(rest, { merge: true });
        receiptFields = rest;
      }
      applyLocal();
      return;
    }
    const all = orders().map((o) =>
      o.id === orderId ? { ...o, ...receiptFields } : o,
    );
    cache.orders = all;
    localSet("agOrders", all);
  }

  async function submitQrPayment(file) {
    await init();
    const s = session();
    if (!s || s.role !== "customer") {
      throw new Error("Please log in as a customer to submit payment.");
    }
    const checkout = localGet("agPendingCheckout", null);
    if (!checkout || !checkout.cart || !checkout.cart.length) {
      throw new Error("No pending checkout found. Return to cart and try again.");
    }
    const validated = await validateReceiptFile(file);
    const receiptId = makeId("RCP");
    const uploadedAt = nowISO();
    let receiptDataUrl = "";
    try {
      receiptDataUrl = await encodeReceiptPreview(file, validated.kind);
      if (receiptDataUrl.length > 280000) {
        receiptDataUrl = await compressImageToBase64(file, {
          maxWidth: 480,
          maxHeight: 480,
          quality: 0.32,
        });
      }
      if (receiptDataUrl.length > 280000) receiptDataUrl = "";
    } catch (e) {
      receiptDataUrl = "";
    }
    if (!receiptDataUrl) {
      throw new Error("Receipt could not be saved. Use a JPG or PNG screenshot (not a large PDF).");
    }
    const order = await createOrder(
      checkout.cart,
      "QR",
      checkout.batchId,
      {
        receiptId,
        receiptFileName: file.name || "",
        receiptContentType: validated.contentType,
        receiptUploadedAt: uploadedAt,
        deliveryType: checkout.deliveryType || "",
        deliveryName: checkout.deliveryName || "",
      },
    );
    await persistOrderReceipt(order.id, {
      receiptPath: "",
      receiptUrl: "",
      receiptDataUrl,
      receiptFileName: file.name || "",
      receiptContentType: validated.contentType,
      receiptUploadedAt: uploadedAt,
      updatedAt: nowISO(),
    });
    localSet("ayamGepukReceipt", checkout.cart);
    localSet("lastOrderId", order.id);
    localStorage.removeItem("ayamGepukCart");
    localStorage.removeItem("agPendingCheckout");
    return order;
  }

  async function verifyPayment(orderId) {
    await init();
    const s = session();
    if (!s || s.role !== "admin") {
      throw new Error("Only admin can verify payment.");
    }
    const now = nowISO();
    const verified = {
      paymentStatus: "verified",
      status: "preparing",
      updatedAt: now,
    };
    if (useFirebase) {
      const ref = db.collection("orders").doc(orderId);
      const snap = await ref.get();
      if (!snap.exists) throw new Error("Order not found.");
      const oldOrder = snap.data();
      if (oldOrder.paymentStatus === "verified") return { id: orderId, ...oldOrder };
      const history = oldOrder.history || [];
      history.push({ status: "preparing", at: now });
      await ref.update({ ...verified, history });
      const updatedOrder = { id: orderId, ...oldOrder, ...verified, history };
      const index = cache.orders.findIndex((o) => o.id === orderId);
      if (index >= 0) cache.orders[index] = updatedOrder;
      else cache.orders.unshift(updatedOrder);
      window.dispatchEvent(new Event("ag-data"));
      await addNotification(
        orderId,
        "Payment verified",
        `Order ${orderId} is verified. Kitchen is preparing your food.`,
        "customer",
        updatedOrder,
      );
      return updatedOrder;
    }
    const all = orders();
    const order = all.find((o) => o.id === orderId);
    if (!order) throw new Error("Order not found.");
    order.paymentStatus = "verified";
    order.status = "preparing";
    order.updatedAt = now;
    order.history = order.history || [];
    order.history.push({ status: "preparing", at: now });
    cache.orders = all;
    localSet("agOrders", all);
    window.dispatchEvent(new Event("ag-data"));
    await addNotification(
      orderId,
      "Payment verified",
      `Order ${orderId} is confirmed. Kitchen can start preparing.`,
      "customer",
      order,
    );
    return order;
  }

  async function rejectPayment(orderId) {
    await init();
    const s = session();
    if (!s || s.role !== "admin") {
      throw new Error("Only admin can reject payment.");
    }
    const now = nowISO();
    const rejected = {
      paymentStatus: "rejected",
      status: "awaiting_verification",
      updatedAt: now,
    };
    if (useFirebase) {
      const ref = db.collection("orders").doc(orderId);
      const snap = await ref.get();
      if (!snap.exists) throw new Error("Order not found.");
      const oldOrder = snap.data();
      await ref.set(rejected, { merge: true });
      const updatedOrder = { id: orderId, ...oldOrder, ...rejected };
      const index = cache.orders.findIndex((o) => o.id === orderId);
      if (index >= 0) cache.orders[index] = slimOrder(updatedOrder);
      window.dispatchEvent(new Event("ag-data"));
      return updatedOrder;
    }
    const all = orders();
    const order = all.find((o) => o.id === orderId);
    if (!order) throw new Error("Order not found.");
    Object.assign(order, rejected);
    cache.orders = all;
    localSet("agOrders", all);
    window.dispatchEvent(new Event("ag-data"));
    return order;
  }

  function receiptSrc(order) {
    if (!order) return "";
    return (
      order.receiptDataUrl ||
      order.receiptUrl ||
      order.receiptBase64 ||
      ""
    );
  }

  function openReceiptFile(order) {
    const src = receiptSrc(order);
    if (!src) throw new Error("No receipt file is available for this order.");
    return src;
  }

  async function loadOrderReceipt(orderId) {
    await init();
    const cached = orders().find((o) => o.id === orderId);
    if (cached && receiptSrc(cached)) return cached;
    if (useFirebase && db && orderId) {
      const snap = await db.collection("orders").doc(orderId).get();
      if (snap.exists) {
        return { id: snap.id, ...snap.data() };
      }
    }
    return cached || null;
  }

  async function compressImageToBase64(file, options = {}) {
    await init();
    if (!file) return "";

    const maxWidth = Number(options.maxWidth || 900);
    const maxHeight = Number(options.maxHeight || 900);
    const quality = Number(options.quality || 0.72);

    return await new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onerror = () => reject(new Error("Failed to read image file."));
      reader.onload = () => {
        const img = new Image();

        img.onerror = () => reject(new Error("Invalid image file."));
        img.onload = () => {
          let width = img.width;
          let height = img.height;
          const ratio = Math.min(maxWidth / width, maxHeight / height, 1);

          width = Math.round(width * ratio);
          height = Math.round(height * ratio);

          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;

          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, width, height);

          resolve(canvas.toDataURL("image/jpeg", quality));
        };

        img.src = reader.result;
      };

      reader.readAsDataURL(file);
    });
  }

  // FYP-friendly image storage: compressed Base64 is saved in Firestore.
  // This avoids Firebase Storage/Blaze requirement for menu images and rider proof.
  const uploadMenuImage = (file, menuId) =>
    compressImageToBase64(file, {
      maxWidth: 900,
      maxHeight: 900,
      quality: 0.72,
    });
  const uploadProof = (file, orderId) =>
    compressImageToBase64(file, {
      maxWidth: 700,
      maxHeight: 700,
      quality: 0.62,
    });

  function imageSrc(image) {
    if (!image) return "images/food1.png";
    if (
      image.startsWith("http") ||
      image.startsWith("data:image") ||
      image.startsWith("blob:") ||
      image.startsWith("images/")
    )
      return image;
    return `images/${image}`;
  }

  function orderDetails(o) {
    return (o.items || [])
      .map((i) => {
        const variation = i.variationText || i.variation || "";
        const note = i.note ? ` — Note: ${i.note}` : "";
        return `${i.quantity}x ${i.name}${variation ? ` (${variation})` : ""}${note}`;
      })
      .join(", ");
  }

  function batchName(bid) {
    const b = batches().find((x) => x.id === bid);
    return b ? `${b.name} (${b.start}-${b.end})` : "No batch";
  }
  function kitchenStatus(status) {
    if (status === "awaiting_verification") return "awaiting_verification";
    if (status === "delivered") return "delivered";
    if (
      status === "ready" ||
      status === "picked_up" ||
      status === "out_for_delivery"
    )
      return "ready";
    return "preparing";
  }

  function statusBadge(status) {
    const shown = kitchenStatus(status);
    const map = {
      awaiting_verification: "warning text-dark",
      preparing: "warning text-dark",
      ready: "info",
      delivered: "success",
    };
    return `<span class="badge bg-${map[shown] || "secondary"}">${STEP_LABELS[shown] || shown}</span>`;
  }

  function paymentBadge(paymentStatus) {
    const label =
      paymentStatus === "verified"
        ? "Verified"
        : paymentStatus === "awaiting_verification"
          ? "Awaiting Verification"
          : paymentStatus || "Unknown";
    const cls =
      paymentStatus === "verified"
        ? "success"
        : paymentStatus === "awaiting_verification"
          ? "warning text-dark"
          : "secondary";
    return `<span class="badge bg-${cls}">${label}</span>`;
  }

  async function fetchCustomerOrderHistory(limitN = 12) {
    await init();
    const s = session();
    if (!s || s.role !== "customer") return [];
    if (!useFirebase || !db) {
      return getCustomerOrders(s).slice(0, limitN);
    }
    try {
      let ref = db.collection("orders");
      if (s.uid) ref = ref.where("customerUid", "==", s.uid);
      else if (s.email) ref = ref.where("email", "==", s.email);
      const snap = await ref.limit(Number(limitN) || 12).get();
      const arr = [];
      snap.forEach((doc) => arr.push(slimOrder({ id: doc.id, ...doc.data() })));
      arr.sort(
        (a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0),
      );
      if (!subscribed.has("orders")) cache.orders = arr;
      return arr;
    } catch (err) {
      console.warn("order history skip", err);
      return getCustomerOrders(s).slice(0, limitN);
    }
  }

  function getCustomerOrders(customer = session()) {
    const s = customer || {};
    return orders().filter(
      (o) =>
        (s.uid && o.customerUid === s.uid) || (s.email && o.email === s.email),
    );
  }

  function favouriteMenus(customer = session()) {
    const counts = {};
    getCustomerOrders(customer).forEach((o) =>
      (o.items || []).forEach((i) => {
        if (!i.name || i.name.startsWith("Delivery Fee")) return;
        counts[i.name] = (counts[i.name] || 0) + Number(i.quantity || 1);
      }),
    );
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count }));
  }

  async function checkNotifications(forceLoad) {
    if (!session()) return;
    await init();
    if (useFirebase && !subscribed.has("notifications")) {
      if (!forceLoad) return;
      await init(["notifications"]);
    }
    const s = session();
    if (!s) return;
    const target = notifications()
      .filter((n) => {
        if (
          Array.isArray(n.readBy) &&
          n.readBy.includes(s.uid || s.id || s.email)
        )
          return false;
        if (n.read && !Array.isArray(n.readBy)) return false;
        if (n.role !== s.role) return false;
        if (s.role === "customer")
          return (
            (!n.customerUid && !n.email) ||
            n.customerUid === s.uid ||
            n.email === s.email
          );
        return true;
      })
      .slice(0, 3);
    for (const n of target) {
      toast(n.title, n.msg);
      const reader = s.uid || s.id || s.email || s.role;
      if (useFirebase) {
        try {
          await db
            .collection("notifications")
            .doc(n.id)
            .set(
              {
                readBy: firebase.firestore.FieldValue.arrayUnion(reader),
                read: true,
              },
              { merge: true },
            );
        } catch (err) {
          console.warn("Notification update failed:", err);
        }
      } else {
        const arr = localGet("agNotifications", []);
        const x = arr.find((a) => a.id === n.id);
        if (x) {
          x.read = true;
          x.readBy = [...(x.readBy || []), reader];
        }
        localSet("agNotifications", arr);
      }
    }
  }

  function createCheckoutSession(cart, payment, batchId, extra = {}) {
    const checkout = {
      id: makeId("CHK"),
      cart,
      payment,
      batchId,
      deliveryType: extra.deliveryType || "",
      deliveryName: extra.deliveryName || "",
      total: cart.reduce(
        (a, i) => a + Number(i.price || 0) * Number(i.quantity || 1),
        0,
      ),
      createdAt: nowISO(),
    };
    localSet("agPendingCheckout", checkout);
    return checkout;
  }

  async function confirmPendingPayment() {
    throw new Error(
      "Stripe checkout is no longer used. Pay with QR and upload your receipt.",
    );
  }

  async function seedDemoData() {
    await init();
    if (useFirebase) {
      await seedDefaultsIfNeeded();
      await init(ADMIN_DATA);
      toast("Firebase seeded", "Default staff created.");
    } else {
      await initLocal();
      toast("Local data ready", "Default staff ready.");
    }
  }

  function aiInventoryReply(question = "") {
    const q = String(question || "").toLowerCase();
    const allOrders = orders().filter((o) => o.status !== "cancelled");
    const completed = allOrders.filter((o) => o.status === "delivered");
    const active = allOrders.filter((o) => o.status !== "delivered");
    const itemCount = {};
    const batchCount = {};
    const revenueByDay = {};

    allOrders.forEach((order) => {
      const day = (order.createdAt || nowISO()).slice(0, 10);
      revenueByDay[day] = (revenueByDay[day] || 0) + Number(order.total || 0);
      batchCount[order.batchId || "No batch"] =
        (batchCount[order.batchId || "No batch"] || 0) + 1;
      (order.items || []).forEach((item) => {
        itemCount[item.name] =
          (itemCount[item.name] || 0) + Number(item.quantity || 1);
      });
    });

    const totalRevenue = allOrders.reduce(
      (a, o) => a + Number(o.total || 0),
      0,
    );
    const totalUnits = Object.values(itemCount).reduce((a, b) => a + b, 0);
    const best = Object.entries(itemCount).sort((a, b) => b[1] - a[1])[0];
    const busiest = Object.entries(batchCount).sort((a, b) => b[1] - a[1])[0];
    const avgOrder = allOrders.length ? totalRevenue / allOrders.length : 0;
    const buffer = Math.max(3, Math.ceil(totalUnits * 0.25));

    if (!allOrders.length) {
      return `I don’t have order data yet. Once customers start ordering, I can forecast menu demand, estimate chicken/rice/sambal prep, and identify peak batches.`;
    }

    if (
      /grocery|groceries|ingredient|purchase|buy|beli|stok|stock|ayam|beras|sambal|inventory/.test(
        q,
      )
    ) {
      const chicken = Math.ceil(totalUnits * 1.25);
      const riceKg = Math.max(1, Math.ceil(totalUnits * 0.2));
      const sambalKg = Math.max(1, Math.ceil(totalUnits * 0.08));
      return `Inventory suggestion based on ${totalUnits} sold units: prepare about ${chicken} chicken portions, ${riceKg}kg rice and ${sambalKg}kg sambal. I included a 25% buffer (${buffer} extra portions) for sudden demand. Best seller is ${best ? best[0] : "not clear yet"}.`;
    }

    if (/predict|forecast|ramal|future|tomorrow|next/.test(q)) {
      const forecastUnits = Math.ceil(totalUnits * 1.2);
      return `Forecast: current pattern suggests around ${forecastUnits} food units for the next comparable sales period. Prioritize ${best ? best[0] : "your main menu"} and keep extra stock for ${busiest ? batchName(busiest[0]) : "peak batch"}. Confidence: medium, because forecast is based on available order history only.`;
    }

    if (/batch|time|peak|busy|pax/.test(q)) {
      return busiest
        ? `Peak batch is ${batchName(busiest[0])} with ${busiest[1]} orders. Recommendation: assign rider earlier and prepare ingredients 20–30 minutes before this batch.`
        : `No clear batch demand yet.`;
    }

    if (/sales|revenue|sale|jual|income|performance/.test(q)) {
      return `Sales monitor: total revenue RM ${totalRevenue.toFixed(2)}, total orders ${allOrders.length}, active orders ${active.length}, delivered ${completed.length}, average order value RM ${avgOrder.toFixed(2)}. Best seller: ${best ? `${best[0]} (${best[1]} units)` : "-"}.`;
    }

    return `Quick analysis: ${allOrders.length} orders, RM ${totalRevenue.toFixed(2)} sales, ${totalUnits} items sold. Best seller is ${best ? `${best[0]} (${best[1]} units)` : "-"}. Ask me about “groceries to buy”, “predict tomorrow orders”, or “peak batch”.`;
  }

  window.addEventListener("storage", () =>
    checkNotifications().catch(() => {}),
  );
  setInterval(() => {
    if (!session()) return;
    if (useFirebase && !subscribed.has("notifications")) return;
    checkNotifications().catch(() => {});
  }, 15000);

  return {
    ORDER_STEPS,
    STEP_LABELS,
    STAFF,
    DELIVERY_OPTIONS,
    init,
    seedDemoData,
    get: localGet,
    set: localSet,
    toast,
    header,
    logout,
    session,
    requireRole,
    getCustomerProfile,
    needsCustomerContact,
    needsCustomerIdentity,
    requireEmailPhone,
    riders,
    saveRider,
    deleteRider,
    acceptJob,
    getRiderPhone,
    saveRiderPhone,
    updateCustomerProfile,
    registerCustomer,
    loginCustomer,
    googleLogin,
    loginStaff,
    menu,
    pruneCartAgainstMenu,
    saveMenu,
    saveMenuItem,
    deleteMenuItem,
    batches,
    saveBatches,
    orders,
    saveOrders,
    notifications,
    chatMessages,
    getChatMessages,
    unreadChatCount,
    markChatRead,
    sendChatMessage,
    createOrder,
    updateOrderStatus,
    validateReceiptFile,
    submitQrPayment,
    verifyPayment,
    rejectPayment,
    openReceiptFile,
    loadOrderReceipt,
    paymentBadge,
    uploadMenuImage,
    uploadProof,
    orderDetails,
    batchName,
    statusBadge,
    kitchenStatus,
    checkNotifications,
    imageSrc,
    getCustomerOrders,
    fetchCustomerOrderHistory,
    favouriteMenus,
    createCheckoutSession,
    confirmPendingPayment,
    isFirebase: () => useFirebase,
  };
})();
