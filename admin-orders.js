(function () {
  'use strict';

  const els = {};

  function text(value) {
    return value == null || value === '' ? '-' : String(value);
  }

  function cacheEls() {
    els.orderSearchInput = document.getElementById('orderSearchInput');
    els.orderStatusFilter = document.getElementById('orderStatusFilter');
    els.orderSortSelect = document.getElementById('orderSortSelect');
    els.clearFiltersBtn = document.getElementById('clearFiltersBtn');
    els.newOrderCount = document.getElementById('newOrderCount');
    els.showingOrderCount = document.getElementById('showingOrderCount');
    els.ordersBody = document.getElementById('ordersBody');
    els.logoutBtn = document.getElementById('logoutBtn');
    els.pendingVerifyCount = document.getElementById('pendingVerifyCount');
    els.verifyQueue = document.getElementById('verifyQueue');
  }

  function getFilteredOrders() {
    const search = (els.orderSearchInput.value || '').trim().toLowerCase();
    const statusFilter = els.orderStatusFilter.value || 'all';
    const sortBy = els.orderSortSelect.value || 'newest';
    let list = [...AG.orders()];

    if (statusFilter !== 'all') {
      list = list.filter(order => AG.kitchenStatus(order.status) === statusFilter || order.status === statusFilter);
    }

    if (search) {
      list = list.filter(order => {
        const items = AG.orderDetails(order).toLowerCase();
        return String(order.id || '').toLowerCase().includes(search) ||
          String(order.customer || '').toLowerCase().includes(search) ||
          String(order.email || '').toLowerCase().includes(search) ||
          String(order.phone || '').toLowerCase().includes(search) ||
          String(order.address || '').toLowerCase().includes(search) ||
          items.includes(search);
      });
    }

    const rank = {
      awaiting_verification: 0,
      preparing: 1,
      ready: 2,
      delivered: 3
    };

    list.sort((a, b) => {
      if (sortBy === 'newest') return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
      if (sortBy === 'oldest') return new Date(a.createdAt || 0) - new Date(b.createdAt || 0);
      if (sortBy === 'total_high') return Number(b.total || 0) - Number(a.total || 0);
      if (sortBy === 'total_low') return Number(a.total || 0) - Number(b.total || 0);
      if (sortBy === 'status') return (rank[a.status] || 99) - (rank[b.status] || 99);
      if (sortBy === 'customer') return String(a.customer || '').localeCompare(String(b.customer || ''));
      return 0;
    });

    return list;
  }

  function clearOrderFilters() {
    els.orderSearchInput.value = '';
    els.orderStatusFilter.value = 'all';
    els.orderSortSelect.value = 'newest';
    renderOrders();
  }

  async function changeOrderStatus(orderId, selectEl) {
    const status = selectEl.value;
    const oldStatus = selectEl.getAttribute('data-current') || '';

    try {
      selectEl.disabled = true;
      await AG.updateOrderStatus(orderId, status);
      selectEl.setAttribute('data-current', status);
      applyStatusSelectStyle(selectEl, status);
      AG.toast('Order updated', `Order ${orderId} updated to ${AG.STEP_LABELS[status] || status}.`);
      if (status === 'ready') AG.toast('Sent to rider', `Order ${orderId} is ready for pickup.`);
      renderOrders();
    } catch (err) {
      AG.toast('Update failed', err.message || 'Failed to update order.');
      if (oldStatus) { selectEl.value = oldStatus; applyStatusSelectStyle(selectEl, oldStatus); }
    } finally {
      selectEl.disabled = false;
    }
  }

  function printOrder(id) {
    const order = AG.orders().find(item => item.id === id);
    if (!order) return;

    const rows = (order.items || []).map(item => {
      const detail = [item.variationText || item.variation || '', item.note ? 'Note: ' + item.note : ''].filter(Boolean).join(' | ');
      const amount = Number(item.price || 0) * Number(item.quantity || 1);
      return `<tr><td>${text(item.name)}<br><small>${text(detail)}</small></td><td>${text(item.quantity)}</td><td>RM ${amount.toFixed(2)}</td></tr>`;
    }).join('');

    const slipHtml = `<!DOCTYPE html><html><head><title>Order ${order.id}</title><style>body{font-family:Arial;padding:18px;color:#222}h2{margin-bottom:0}table{width:100%;border-collapse:collapse;margin-top:12px}td,th{border-bottom:1px solid #ddd;padding:8px;text-align:left}.total{font-size:20px;font-weight:bold;margin-top:18px}</style></head><body><h2>Warisan Cafe</h2><p>Order Slip</p><hr><p><b>Order ID:</b> ${order.id}<br><b>Customer:</b> ${text(order.customer)}<br><b>Phone:</b> ${text(order.phone)}<br><b>Batch:</b> ${AG.batchName(order.batchId)}<br><b>Status:</b> ${AG.STEP_LABELS[order.status] || order.status}<br><b>Order Notes:</b> ${text(order.orderNotes || order.notes)}</p><table><tr><th>Item</th><th>Qty</th><th>Amount</th></tr>${rows}</table><p class="total">Total: RM ${Number(order.total || 0).toFixed(2)}</p></body></html>`;

    const printWindow = window.open('', '_blank', 'width=420,height=600');
    if (!printWindow) {
      AG.toast('Print blocked', 'Please allow popup window to print order slip.');
      return;
    }
    printWindow.document.open();
    printWindow.document.write(slipHtml);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => printWindow.print(), 300);
  }

  function statusSelectClass(status) {
    return 'form-select form-select-sm order-status-select status-select-' + (status || 'confirmed');
  }

  function applyStatusSelectStyle(selectEl, status) {
    const base = 'form-select form-select-sm order-status-select';
    selectEl.className = base + ' status-select-' + (status || 'confirmed');
  }

  function buildStatusSelect(order) {
    const select = document.createElement('select');
    applyStatusSelectStyle(select, order.status);
    select.dataset.orderId = order.id;
    select.dataset.current = order.status;

    const waiting = order.paymentStatus === 'awaiting_verification' || order.status === 'awaiting_verification';
    const steps = waiting ? ['awaiting_verification'] : AG.ORDER_STEPS.filter(step => step !== 'awaiting_verification');

    steps.forEach(step => {
      const option = document.createElement('option');
      option.value = step;
      option.textContent = AG.STEP_LABELS[step];
      option.selected = order.status === step;
      select.appendChild(option);
    });
    if (waiting) select.disabled = true;

    return select;
  }

  function buildOrderRow(order) {
    const tr = document.createElement('tr');
    const dateText = order.createdAt ? new Date(order.createdAt).toLocaleString() : '';
    tr.innerHTML = `
      <td><strong>${text(order.id)}</strong><div class="small-muted">${dateText}</div></td>
      <td>${text(order.customer)}<div class="small-muted">${text(order.email)}</div><div class="small-muted">${text(order.phone)}</div></td>
      <td>${AG.orderDetails(order)}</td>
      <td>${text(order.orderNotes || order.notes)}</td>
      <td>${AG.batchName(order.batchId)}</td>
      <td>RM ${Number(order.total || 0).toFixed(2)}</td>
      <td>${AG.statusBadge(order.status)}</td>
      <td class="status-cell"></td>
      <td><button class="btn btn-sm btn-outline-dark print-btn" type="button" data-order-id="${order.id}"><i class="bi bi-printer"></i></button></td>
    `;
    tr.querySelector('.status-cell').appendChild(buildStatusSelect(order));
    return tr;
  }

  function buildDateDivider(label, count, open) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td colspan="9" style="background:#f1f3f5;padding:8px 14px;cursor:pointer;user-select:none;" class="date-divider-row" data-group="${label}">
        <span style="font-weight:700;font-size:.82rem;text-transform:uppercase;letter-spacing:.5px;color:#495057;">
          <i class="bi bi-calendar3 me-2" style="color:#c62828"></i>${label}
        </span>
        <span class="badge bg-secondary ms-2" style="font-size:.72rem">${count} order${count !== 1 ? 's' : ''}</span>
        <i class="bi bi-chevron-${open ? 'up' : 'down'} float-end mt-1" style="color:#6c757d"></i>
      </td>`;
    return tr;
  }

  function pendingOrders() {
    return AG.orders().filter(o =>
      (o.paymentStatus === 'awaiting_verification' || o.status === 'awaiting_verification') &&
      o.paymentStatus !== 'rejected' &&
      o.paymentStatus !== 'verified'
    );
  }

  function renderVerifyQueue(pending) {
    if (!els.verifyQueue) return;
    const list = pending || pendingOrders();
    if (!list.length) {
      els.verifyQueue.innerHTML = '<p class="verify-empty mb-0">No orders waiting for payment verification.</p>';
      return;
    }
    els.verifyQueue.innerHTML = list.map(order => {
      const dateText = order.createdAt ? new Date(order.createdAt).toLocaleString() : '';
      return `<div class="verify-item">
        <div>
          <strong>${text(order.id)}</strong>
          <div class="small-muted">${dateText}</div>
          <div>${text(order.customer)}</div>
          <div class="small-muted">${text(order.phone)}</div>
        </div>
        <div>
          <div>${AG.orderDetails(order)}</div>
          <div class="fw-bold mt-1">RM ${Number(order.total || 0).toFixed(2)}</div>
          <div class="small-muted">${text(order.receiptFileName)}</div>
        </div>
        <div class="verify-actions">
          <button class="btn btn-sm btn-outline-secondary view-receipt-btn" type="button" data-order-id="${order.id}">View slip</button>
          <button class="btn btn-sm btn-brand verify-pay-btn" type="button" data-order-id="${order.id}">Verify</button>
          <button class="btn btn-sm btn-outline-danger reject-pay-btn" type="button" data-order-id="${order.id}">Reject</button>
        </div>
      </div>`;
    }).join('');
  }

  async function showReceipt(orderId) {
    const order = await AG.loadOrderReceipt(orderId);
    const src = AG.openReceiptFile(order);
    const modal = document.getElementById('receiptModal');
    const preview = document.getElementById('receiptPreview');
    if (!modal || !preview) {
      window.open(src, '_blank', 'noopener');
      return;
    }
    preview.replaceChildren();
    const isPdf = String(src).includes('application/pdf') || String(order.receiptContentType || '').includes('pdf') || /\.pdf$/i.test(order.receiptFileName || '');
    if (isPdf && !String(src).startsWith('data:image')) {
      const frame = document.createElement('iframe');
      frame.src = src;
      frame.style.cssText = 'width:100%;min-height:70vh;border:0';
      preview.appendChild(frame);
    } else {
      const img = document.createElement('img');
      img.src = src;
      img.alt = 'Receipt';
      img.style.cssText = 'max-width:100%;height:auto;display:block;margin:0 auto';
      img.onerror = () => {
        preview.textContent = 'Receipt could not be displayed. Ask the customer to upload a JPG or PNG screenshot.';
      };
      preview.appendChild(img);
    }
    modal.style.display = 'flex';
  }

  function renderOrders() {
    if (!els.ordersBody) return;

    const all = AG.orders();
    const list = getFilteredOrders();
    const search = (els.orderSearchInput.value || '').trim();
    const statusFilter = els.orderStatusFilter.value || 'all';
    const hasFilter = search !== '' || statusFilter !== 'all';

    const pending = pendingOrders();
    els.newOrderCount.textContent = pending.length;
    if (els.pendingVerifyCount) els.pendingVerifyCount.textContent = pending.length;
    renderVerifyQueue(pending);
    els.showingOrderCount.textContent = list.length;
    els.ordersBody.innerHTML = '';

    if (!all.length) {
      els.ordersBody.innerHTML = '<tr><td colspan="9" class="text-center text-muted py-4">No orders yet.</td></tr>';
      return;
    }
    if (!list.length) {
      els.ordersBody.innerHTML = '<tr><td colspan="9" class="text-center text-muted py-4">No matching orders found.</td></tr>';
      return;
    }

    /* When a filter is active, show all matches flat (no date grouping) */
    if (hasFilter) {
      list.forEach(order => els.ordersBody.appendChild(buildOrderRow(order)));
      return;
    }

    /* ── Default view: today's orders + older grouped by date ── */
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);

    const todayOrders = list.filter(o => new Date(o.createdAt || 0) >= todayStart);
    const olderOrders = list.filter(o => new Date(o.createdAt || 0) < todayStart);

    /* Today section */
    const todayHeader = document.createElement('tr');
    todayHeader.innerHTML = `
      <td colspan="9" style="background:#fff0f0;padding:8px 14px;">
        <span style="font-weight:700;font-size:.82rem;text-transform:uppercase;letter-spacing:.5px;color:#c62828;">
          <i class="bi bi-circle-fill me-2" style="font-size:.5rem;vertical-align:middle"></i>Today
        </span>
        <span class="badge ms-2" style="background:#c62828;font-size:.72rem">${todayOrders.length} order${todayOrders.length !== 1 ? 's' : ''}</span>
      </td>`;
    els.ordersBody.appendChild(todayHeader);

    if (todayOrders.length) {
      todayOrders.forEach(order => els.ordersBody.appendChild(buildOrderRow(order)));
    } else {
      const empty = document.createElement('tr');
      empty.innerHTML = '<td colspan="9" class="text-center text-muted py-3" style="font-size:.88rem"><i class="bi bi-hourglass me-1"></i>No orders today yet — waiting for new orders.</td>';
      els.ordersBody.appendChild(empty);
    }

    /* Older orders grouped by date */
    if (olderOrders.length) {
      /* Group by date string */
      const groups = {};
      olderOrders.forEach(o => {
        const d = new Date(o.createdAt || 0);
        const yesterday = new Date(todayStart); yesterday.setDate(yesterday.getDate() - 1);
        let label;
        if (d >= yesterday && d < todayStart) {
          label = 'Yesterday · ' + d.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
        } else {
          label = d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' });
        }
        if (!groups[label]) groups[label] = [];
        groups[label].push(o);
      });

      Object.entries(groups).forEach(([label, orders]) => {
        const divider = buildDateDivider(label, orders.length, false);
        els.ordersBody.appendChild(divider);
        orders.forEach(order => {
          const row = buildOrderRow(order);
          row.dataset.group = label;
          row.style.display = 'none'; /* collapsed by default */
          els.ordersBody.appendChild(row);
        });
      });
    }
  }

  function setupEvents() {
    els.orderSearchInput.addEventListener('input', renderOrders);
    els.orderStatusFilter.addEventListener('change', renderOrders);
    els.orderSortSelect.addEventListener('change', renderOrders);
    els.clearFiltersBtn.addEventListener('click', clearOrderFilters);
    if (els.logoutBtn) els.logoutBtn.addEventListener('click', () => AG.logout());

    async function handleVerifyClicks(event) {
      const viewBtn = event.target.closest('.view-receipt-btn');
      if (viewBtn) {
        try {
          await showReceipt(viewBtn.dataset.orderId);
        } catch (err) {
          AG.toast('Receipt unavailable', err.message || 'No receipt uploaded.');
        }
        return true;
      }
      const verifyBtn = event.target.closest('.verify-pay-btn');
      if (verifyBtn) {
        verifyBtn.disabled = true;
        AG.verifyPayment(verifyBtn.dataset.orderId)
          .then(() => renderOrders())
          .catch(err => {
            AG.toast('Verify failed', err.message || 'Could not verify payment.');
            verifyBtn.disabled = false;
          });
        return true;
      }
      const rejectBtn = event.target.closest('.reject-pay-btn');
      if (rejectBtn) {
        rejectBtn.disabled = true;
        AG.rejectPayment(rejectBtn.dataset.orderId)
          .then(() => renderOrders())
          .catch(err => {
            AG.toast('Reject failed', err.message || 'Could not reject payment.');
            rejectBtn.disabled = false;
          });
        return true;
      }
      return false;
    }

    if (els.verifyQueue) {
      els.verifyQueue.addEventListener('click', handleVerifyClicks);
    }

    els.ordersBody.addEventListener('change', event => {
      if (event.target.classList.contains('order-status-select')) {
        changeOrderStatus(event.target.dataset.orderId, event.target);
      }
    });

    els.ordersBody.addEventListener('click', async event => {
      const btn = event.target.closest('.print-btn');
      if (btn) { printOrder(btn.dataset.orderId); return; }

      const viewBtn = event.target.closest('.view-receipt-btn');
      if (viewBtn) {
        try {
          await showReceipt(viewBtn.dataset.orderId);
        } catch (err) {
          AG.toast('Receipt unavailable', err.message || 'No receipt uploaded.');
        }
        return;
      }

      const verifyBtn = event.target.closest('.verify-pay-btn');
      if (verifyBtn) {
        verifyBtn.disabled = true;
        AG.verifyPayment(verifyBtn.dataset.orderId)
          .then(() => {
            renderOrders();
          })
          .catch(err => {
            AG.toast('Verify failed', err.message || 'Could not verify payment.');
            verifyBtn.disabled = false;
          });
        return;
      }

      const divider = event.target.closest('.date-divider-row');
      if (divider) {
        const group = divider.dataset.group;
        const rows = els.ordersBody.querySelectorAll(`tr[data-group="${group}"]`);
        const isOpen = rows.length && rows[0].style.display !== 'none';
        rows.forEach(r => r.style.display = isOpen ? 'none' : '');
        const icon = divider.querySelector('.bi-chevron-up, .bi-chevron-down');
        if (icon) { icon.className = `bi bi-chevron-${isOpen ? 'down' : 'up'} float-end mt-1`; }
      }
    });
  }

  /* ── Auto-print on new order ── */
  let knownOrderIds = new Set();
  let autoPrintReady = false;

  function autoPrintEnabled() {
    return localStorage.getItem('gepukgo_autoprint') === 'true';
  }

  function selectedPrinter() {
    return localStorage.getItem('gepukgo_printer') || '';
  }

  async function printToServer(order) {
    try {
      const resp = await fetch('/api/print', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order, printerName: selectedPrinter() }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Print failed');
      AG.toast('Printed', 'Order ' + order.id + ' sent to printer.');
    } catch (err) {
      AG.toast('Print error', err.message || 'Could not reach print server.');
    }
  }

  function playBeep() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.4, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
      osc.start(); osc.stop(ctx.currentTime + 0.4);
    } catch (_) {}
  }

  function showNewOrderBanner(order) {
    const banner = document.getElementById('newOrderBanner');
    if (!banner) return;
    banner.textContent = '🔔 New order: ' + order.id + ' — ' + (order.customer || '') + ' · RM ' + Number(order.total || 0).toFixed(2);
    banner.style.display = 'block';
    setTimeout(() => { banner.style.display = 'none'; }, 6000);
  }

  function checkNewOrders() {
    if (!autoPrintReady) return;
    const current = AG.orders();
    current.forEach(order => {
      if (!knownOrderIds.has(order.id)) {
        knownOrderIds.add(order.id);
        playBeep();
        showNewOrderBanner(order);
        if (autoPrintEnabled() && order.paymentStatus === 'verified') printToServer(order);
      }
    });
  }

  async function loadPrinters() {
    const sel = document.getElementById('printerSelect');
    if (!sel) return;
    try {
      const resp = await fetch('/api/printers');
      const data = await resp.json();
      sel.innerHTML = '<option value="">Default Printer</option>';
      (data.printers || []).forEach(p => {
        const opt = document.createElement('option');
        opt.value = p; opt.textContent = p;
        if (p === selectedPrinter()) opt.selected = true;
        sel.appendChild(opt);
      });
    } catch (_) {
      sel.innerHTML = '<option value="">Default Printer</option>';
    }
  }

  function setupPrintControls() {
    const toggle = document.getElementById('autoPrintToggle');
    const sel    = document.getElementById('printerSelect');
    const testBtn = document.getElementById('testPrintBtn');

    if (toggle) {
      toggle.checked = autoPrintEnabled();
      toggle.addEventListener('change', () => {
        localStorage.setItem('gepukgo_autoprint', toggle.checked);
        AG.toast('Auto-print', toggle.checked ? 'Auto-print enabled.' : 'Auto-print disabled.');
      });
    }

    if (sel) {
      sel.addEventListener('change', () => {
        localStorage.setItem('gepukgo_printer', sel.value);
      });
    }

    if (testBtn) {
      testBtn.addEventListener('click', async () => {
        const fakeOrder = {
          id: 'TEST-001', customer: 'Test Customer', phone: '012-3456789',
          batchName: 'Lunch 12–2pm', total: 12.50, createdAt: new Date().toISOString(),
          items: [{ name: 'Warisan Set', quantity: 1, price: 8.50, variation: 'Regular' },
                  { name: 'Nasi Putih', quantity: 1, price: 2.00 },
                  { name: 'Air Sirap', quantity: 1, price: 2.00 }],
        };
        await printToServer(fakeOrder);
      });
    }

    loadPrinters();
  }

  document.addEventListener('DOMContentLoaded', async () => {
    cacheEls();
    const session = await AG.requireRole(['admin']);
    if (!session) return;
    setupEvents();
    setupPrintControls();
    const closeReceipt = document.getElementById('closeReceiptModal');
    const receiptModal = document.getElementById('receiptModal');
    if (closeReceipt && receiptModal) {
      closeReceipt.addEventListener('click', () => {
        receiptModal.style.display = 'none';
        document.getElementById('receiptPreview').innerHTML = '';
      });
      receiptModal.addEventListener('click', (e) => {
        if (e.target === receiptModal) {
          receiptModal.style.display = 'none';
          document.getElementById('receiptPreview').innerHTML = '';
        }
      });
    }

    /* Seed known IDs from current orders so existing ones don't trigger auto-print */
    AG.orders().forEach(o => knownOrderIds.add(o.id));
    autoPrintReady = true;

    renderOrders();
    window.addEventListener('ag-data', () => { checkNewOrders(); renderOrders(); });
  });
})();
