if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}

const AG = (() => {
  const ORDER_STEPS = [
    "confirmed",
    "preparing",
    "ready",
    "picked_up",
    "out_for_delivery",
    "delivered",
  ];
  const STEP_LABELS = {
    confirmed: "Order Confirmed",
    preparing: "Preparing Food",
    ready: "Ready for Pickup",
    picked_up: "Picked Up by Rider",
    out_for_delivery: "Out for Delivery",
    delivered: "Delivered",
  };

  const STAFF = {
    admin: {
      id: "ADMIN001",
      password: "admin123",
      role: "admin",
      name: "Admin Ayam Gepuk",
    },
    rider: {
      id: "RIDER001",
      password: "rider123",
      role: "rider",
      name: "Ahmad Rider",
    },
  };

  const DEFAULT_MENU = [];

  const DEFAULT_BATCHES = [];

  let app = null,
    auth = null,
    db = null,
    storage = null;
  let ready = false,
    useFirebase = false;
  const cache = {
    menu: [],
    batches: [],
    orders: [],
    notifications: [],
    chatMessages: [],
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

  async function logout() {
    try {
      await init();
      if (useFirebase && auth && auth.currentUser) await auth.signOut();
    } catch (e) {
      console.warn("Logout warning:", e);
    }
    localStorage.removeItem("agSession");
    window.location.href = "login1.html";
  }

  async function requireRole(allowedRoles) {
    await init();
    const s = session();
    const allowed = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];
    const loginPage =
      allowed.includes("admin") || allowed.includes("rider")
        ? "staff-login1.html"
        : "login1.html";
    if (!s || !s.role) {
      window.location.href = loginPage;
      return null;
    }
    if (!allowed.includes(s.role)) {
      if (s.role === "admin") window.location.href = "admin-dashboard1.html";
      else if (s.role === "rider")
        window.location.href = "rider-dashboard1.html";
      else window.location.href = "cust-menu1.html";
      return null;
    }
    return s;
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
    const unread = notifications().filter((n) => {
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
    }).length;
    const bellBadge =
      unread > 0
        ? `<span class="position-absolute top-0 end-0 translate-middle badge rounded-pill bg-warning" style="font-size:.6rem;padding:3px 5px;">${unread > 9 ? "9+" : unread}</span>`
        : "";
    return `<div class="app-header"><div class="header-row"><a class="brand" href="${home}"><img src="images/logo.png" alt="logo"><div class="brand-text"><span class="greeting">${greet}, ${firstName}</span><span class="brand-name">${title}</span></div></a><div class="header-actions"><span class="role-chip">${displayRole}</span><button class="icon-btn" type="button" title="Notifications" onclick="AG.checkNotifications()"><i class="bi bi-bell-fill"></i>${bellBadge}</button><button class="icon-btn" type="button" title="Logout" onclick="AG.logout()"><i class="bi bi-box-arrow-right"></i></button></div></div></div>`;
  }

  async function initLocal() {
    if (!localStorage.getItem("agMenu")) localSet("agMenu", DEFAULT_MENU);
    if (!localStorage.getItem("agBatches"))
      localSet("agBatches", DEFAULT_BATCHES);
    if (!localStorage.getItem("agOrders")) localSet("agOrders", []);
    if (!localStorage.getItem("agNotifications"))
      localSet("agNotifications", []);
    if (!localStorage.getItem("agChatMessages")) localSet("agChatMessages", []);
    cache.menu = localGet("agMenu", DEFAULT_MENU);
    cache.batches = localGet("agBatches", DEFAULT_BATCHES);
    cache.orders = localGet("agOrders", []);
    cache.notifications = localGet("agNotifications", []);
    cache.chatMessages = localGet("agChatMessages", []);
  }

  async function init() {
    if (ready) return;
    useFirebase = firebaseEnabled();
    if (!useFirebase) {
      await initLocal();
      ready = true;
      return;
    }
    try {
      app = firebase.apps.length
        ? firebase.app()
        : firebase.initializeApp(window.firebaseConfig);
      auth = firebase.auth();
      db = firebase.firestore();
      storage = firebase.storage ? firebase.storage() : null;
      await seedDefaultsIfNeeded();
      let coreReady = 0;
      let resolveCore;
      const corePromise = new Promise((r) => (resolveCore = r));
      function onCoreFirst() { if (++coreReady >= 2) resolveCore(); }

      listenCollection("menu", (arr) => {
        cache.menu = arr
          .map(normalizeMenuItem)
          .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      });
      listenCollection("batches", (arr) => {
        cache.batches = arr.sort((a, b) =>
          (a.start || "").localeCompare(b.start || ""),
        );
      }, onCoreFirst);
      listenCollection("orders", (arr) => {
        cache.orders = arr.sort(
          (a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0),
        );
      }, onCoreFirst);
      listenCollection("notifications", (arr) => {
        cache.notifications = arr.sort(
          (a, b) => new Date(b.at || 0) - new Date(a.at || 0),
        );
      });
      listenCollection("chatMessages", (arr) => {
        cache.chatMessages = arr.sort(
          (a, b) => new Date(a.at || 0) - new Date(b.at || 0),
        );
      });
      await Promise.race([corePromise, new Promise((r) => setTimeout(r, 200))]);
      ready = true;
    } catch (err) {
      console.error("Firebase init failed:", err);
      toast("Firebase init failed", err.message);
      await initLocal();
      useFirebase = false;
      ready = true;
    }
  }

  function listenCollection(name, cb, onFirst) {
    let firstFired = false;
    const unsub = db.collection(name).onSnapshot(
      (snap) => {
        const arr = [];
        snap.forEach((doc) => arr.push({ id: doc.id, ...doc.data() }));
        cb(arr);
        window.dispatchEvent(new Event("ag-data"));
        if (!firstFired) { firstFired = true; if (onFirst) onFirst(); }
      },
      (err) => {
        console.error(`Firebase read error: ${name}`, err);
        toast("Firebase read error", err.message);
      },
    );
    unsubscribers.push(unsub);
  }

  async function seedDefaultsIfNeeded() {
    // No default menu and batch.
    // Admin must create menu and batch manually from admin dashboard.

    await db
      .collection("staff")
      .doc("ADMIN001")
      .set(STAFF.admin, { merge: true });

    await db
      .collection("staff")
      .doc("RIDER001")
      .set(STAFF.rider, { merge: true });
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
    const updated = {
      ...s,
      name: data.name || s.name || "Customer",
      phone: data.phone || "",
      address,
      addressArea,
      addressDetail,
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
        phone: data.phone || "",
        address: data.address || "",
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
      address: data.address || "",
      phone: data.phone || "",
    };
    localSet("agSession", safe);
    return safe;
  }

  async function loginCustomer(email, password) {
    await init();
    if (useFirebase) {
      const cred = await auth.signInWithEmailAndPassword(email, password);
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

  async function loginStaff(idVal, password) {
    await init();
    const staffId = String(idVal || "")
      .trim()
      .toUpperCase();
    const staffPassword = String(password || "").trim();
    if (staffId === "ADMIN001" && staffPassword === "admin123") {
      const s = { role: "admin", id: "ADMIN001", name: "Admin Ayam Gepuk" };
      localSet("agSession", s);
      return "admin";
    }
    if (staffId === "RIDER001" && staffPassword === "rider123") {
      const s = { role: "rider", id: "RIDER001", name: "Ahmad Rider" };
      localSet("agSession", s);
      return "rider";
    }
    if (useFirebase && db) {
      try {
        const doc = await db.collection("staff").doc(staffId).get();
        if (doc.exists && doc.data().password === staffPassword) {
          const account = { id: staffId, ...doc.data() };
          localSet("agSession", {
            role: account.role,
            id: account.id,
            name: account.name || account.id,
          });
          return account.role;
        }
      } catch (e) {
        console.warn("Firestore staff login skipped:", e);
      }
    }
    throw new Error("Invalid staff ID or password.");
  }

  function menu() {
    return (
      cache.menu.length ? cache.menu : localGet("agMenu", DEFAULT_MENU)
    ).map(normalizeMenuItem);
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
    await addNotification(
      orderId,
      role === "customer" ? "Customer message" : "Runner message",
      cleanText,
      targetRole,
      order,
    );
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
    const order = {
      id: makeId("ORD"),
      customer: s.name || "Guest",
      customerUid: s.uid || "",
      email: s.email || "",
      phone: s.phone || "",
      address: s.address || "Kolej Kediaman Hub Pagoh",
      items: cart,
      total,
      payment,
      paymentStatus: extra.paymentStatus || "paid",
      paymentProvider: extra.paymentProvider || "Internal Checkout",
      paymentRef: extra.paymentRef || "",
      batchId,
      status: "confirmed",
      riderId: "RIDER001",
      proof: null,
      proofUrl: null,
      notes: orderNotes,
      orderNotes,
      createdAt: nowISO(),
      updatedAt: nowISO(),
      history: [{ status: "confirmed", at: nowISO() }],
    };
    if (useFirebase) {
      await db.collection("orders").doc(order.id).set(order);
      // Update local cache immediately; Firestore listener will sync again shortly.
      cache.orders = [order, ...cache.orders.filter((o) => o.id !== order.id)];
      window.dispatchEvent(new Event("ag-data"));
    } else {
      const all = orders();
      all.unshift(order);
      cache.orders = all;
      localSet("agOrders", all);
    }
    await addNotification(
      order.id,
      "Order confirmed",
      `Order ${order.id} received. Admin will prepare your food.`,
      "customer",
      order,
    );
    return order;
  }

  async function updateOrderStatus(orderId, status, notes = "", proofUrl = "") {
    await init();
    const now = nowISO();
    if (useFirebase) {
      const ref = db.collection("orders").doc(orderId);
      const snap = await ref.get();
      if (!snap.exists) throw new Error("Order not found.");
      const oldOrder = snap.data();
      const history = oldOrder.history || [];
      if (!history.some((h) => h.status === status))
        history.push({ status, at: now });
      else history.push({ status, at: now });
      const data = { status, history, updatedAt: now };
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
  function statusBadge(status) {
    const map = {
      confirmed: "secondary",
      preparing: "warning text-dark",
      ready: "info",
      picked_up: "primary",
      out_for_delivery: "primary",
      delivered: "success",
    };
    return `<span class="badge bg-${map[status] || "secondary"}">${STEP_LABELS[status] || status}</span>`;
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

  async function checkNotifications() {
    await init();
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

  function createCheckoutSession(cart, payment, batchId) {
    const checkout = {
      id: makeId("CHK"),
      cart,
      payment,
      batchId,
      total: cart.reduce(
        (a, i) => a + Number(i.price || 0) * Number(i.quantity || 1),
        0,
      ),
      createdAt: nowISO(),
    };
    localSet("agPendingCheckout", checkout);
    return checkout;
  }

  async function confirmPendingPayment(providerData = {}) {
    const checkout = localGet("agPendingCheckout", null);
    if (!checkout || !checkout.cart || !checkout.cart.length)
      throw new Error("No pending checkout found.");
    const order = await createOrder(
      checkout.cart,
      checkout.payment,
      checkout.batchId,
      {
        paymentStatus: providerData.paymentStatus || "paid",
        paymentProvider: providerData.paymentProvider || "Stripe FPX",
        paymentRef: providerData.paymentRef || "",
      },
    );
    localSet("ayamGepukReceipt", checkout.cart);
    localSet("lastOrderId", order.id);
    localStorage.removeItem("ayamGepukCart");
    localStorage.removeItem("agPendingCheckout");
    return order;
  }

  async function seedDemoData() {
    await init();
    if (useFirebase) {
      await seedDefaultsIfNeeded();
      toast("Firebase seeded", "Default staff, menu and batch created.");
    } else {
      await initLocal();
      toast("Local data ready", "Default staff, menu and batch created.");
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
  setInterval(() => checkNotifications().catch(() => {}), 5000);

  return {
    ORDER_STEPS,
    STEP_LABELS,
    STAFF,
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
    updateCustomerProfile,
    registerCustomer,
    loginCustomer,
    googleLogin,
    loginStaff,
    menu,
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
    uploadMenuImage,
    uploadProof,
    orderDetails,
    batchName,
    statusBadge,
    checkNotifications,
    imageSrc,
    getCustomerOrders,
    favouriteMenus,
    createCheckoutSession,
    confirmPendingPayment,
    aiInventoryReply,
    isFirebase: () => useFirebase,
  };
})();
