// js1: Shared Wi-Fi data connection used by both the admin and customer pages.
// Run server.js and open these pages through its address on both devices.
(function () {
  const endpoint = '/api';
  let state = null;
  let isHydrating = false;
  let saveTimer = null;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  // js2: Read the latest server copy before rendering or saving admin edits.
  async function getState() {
    const response = await fetch(`${endpoint}/state`);
    if (!response.ok) throw new Error('The shared data server could not be reached.');
    return response.json();
  }
  async function sendState(next, base) {
    const response = await fetch(`${endpoint}/state`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ base, next }) });
    if (!response.ok) throw new Error('Could not save shared data.');
  }
  async function resetSharedData() {
    if (!confirm('Reset inventory and transaction records to the original sample data?')) return;
    try {
      const response = await fetch(`${endpoint}/reset`, { method: 'POST' });
      if (!response.ok) showConnectionError();
    } catch (_) { showConnectionError(); }
  }
  function showConnectionError() {
    if (document.getElementById('sharedSyncNotice')) return;
    const notice = document.createElement('div');
    notice.id = 'sharedSyncNotice';
    notice.textContent = 'Live sync is unavailable. Start server.js and open this page using the server address.';
    notice.style.cssText = 'position:fixed;z-index:9999;bottom:12px;left:12px;background:#7f1d1d;color:white;padding:12px 16px;border-radius:8px;font:14px Arial;max-width:420px';
    document.body.appendChild(notice);
  }
  // js3: Convert active and archived table rows into durable inventory records.
  function rowData(row) {
    const cell = row.querySelector('.item-name-cell');
    const stock = row.querySelector('.item-stock-val');
    const expiry = row.querySelector('.item-expiry-val');
    const price = row.querySelector('.item-price-val');
    return {
      id: Number(row.dataset.itemId || Date.now() + Math.floor(Math.random() * 1000)),
      name: row.querySelector('.item-name')?.textContent.trim() || '',
      category: row.querySelector('.item-cat')?.textContent.trim() || 'Other',
      price: Number(price?.dataset.price || row.dataset.price || 0),
      stock: Number(stock?.dataset.stock || 0),
      unit: stock?.dataset.unit || 'pcs',
      expiry: expiry?.dataset.expiry || '',
      image: cell?.querySelector('img')?.src || '',
      intendedUse: row.dataset.intendedUse || cell?.querySelector('.item-intended-use')?.textContent.trim() || ''
    };
  }
  function makeActiveRow(item) {
    const tr = document.createElement('tr');
    tr.dataset.itemId = item.id;
    tr.dataset.intendedUse = item.intendedUse || '';
    tr.innerHTML = `<td class="item-name-cell"><img src="${esc(item.image || 'https://images.unsplash.com/photo-1540420773420-3366772f4999?auto=format&fit=crop&w=80&q=80')}" class="item-img-thumb" alt="item"><span class="item-name">${esc(item.name)}</span><small class="item-intended-use">${esc(item.intendedUse || '')}</small></td><td class="item-cat">${esc(item.category)}</td><td class="item-price-val" data-price="${Number(item.price) || 0}">₱${(Number(item.price) || 0).toFixed(2)}</td><td class="item-stock-val" data-stock="${Number(item.stock) || 0}" data-unit="${esc(item.unit)}">${Number(item.stock) || 0} ${esc(item.unit)}</td><td class="item-expiry-val" data-expiry="${esc(item.expiry)}">${esc(item.expiry)}</td><td class="status-cell"></td><td><button class="btn btn-edit" onclick="openEditModal(this)">Edit</button> <button class="btn btn-terminate" onclick="terminateItem(this)">Terminate Item</button></td>`;
    return tr;
  }
  function makeArchivedRow(item) {
    const tr = document.createElement('tr');
    tr.dataset.itemId = item.id;
    tr.dataset.price = Number(item.price) || 0;
    tr.dataset.intendedUse = item.intendedUse || '';
    tr.innerHTML = `<td class="item-name-cell"><img src="${esc(item.image || '')}" class="item-img-thumb" alt="item"><span class="item-name">${esc(item.name)}</span><small class="item-intended-use">${esc(item.intendedUse || '')}</small></td><td class="item-cat">${esc(item.category)}</td><td class="item-stock-val" data-stock="${Number(item.stock) || 0}" data-unit="${esc(item.unit)}">${Number(item.stock) || 0} ${esc(item.unit)}</td><td class="item-expiry-val" data-expiry="${esc(item.expiry)}">${esc(item.expiry)}</td><td><button class="btn btn-reactivate" onclick="reactivateItem(this)">Reactivate</button> <button class="btn btn-delete-perm" onclick="deletePermanently(this)">Delete Permanently</button></td>`;
    return tr;
  }
  function renderAdmin(next) {
    const active = document.getElementById('inventoryTable');
    const archived = document.getElementById('archiveTable');
    if (!active || !archived) return;
    isHydrating = true;
    active.replaceChildren(...next.inventory.map(makeActiveRow));
    archived.replaceChildren(...next.archived.map(makeArchivedRow));
    localStorage.setItem('dailyTransactions', JSON.stringify(next.transactions || []));
    if (typeof window.evaluateInventoryRealtime === 'function') window.evaluateInventoryRealtime();
    if (typeof window.renderAdminTransactions === 'function') window.renderAdminTransactions();
    isHydrating = false;
  }
  // js4: Build the customer menu from the same active inventory the admin sees.
  function renderMenu(inventory) {
    const grid = document.getElementById('menuGrid');
    if (!grid) return;
    grid.replaceChildren();
    inventory.forEach(item => {
      const expiryDate = new Date(`${item.expiry}T00:00:00`);
      const expired = !item.expiry || expiryDate < new Date(new Date().toDateString());
      const card = document.createElement('div');
      card.className = 'item-card';
      card.dataset.id = item.id; card.dataset.category = item.category; card.dataset.price = item.price;
      card.dataset.stock = item.stock; card.dataset.expiry = item.expiry; card.dataset.name = item.name;
      card.innerHTML = `<img src="${esc(item.image || 'https://images.unsplash.com/photo-1540420773420-3366772f4999?auto=format&fit=crop&w=300&q=80')}" alt="${esc(item.name)}"><div class="item-details"><div class="item-name">${esc(item.name)}</div><div class="badge-expiry ${expired ? 'badge-expired' : 'badge-good'}">${expired ? 'Expired' : 'Exp'}: ${esc(item.expiry)}</div><div class="item-stock">Intended use: ${esc(item.intendedUse || 'General sale')}</div><div class="item-stock">Stock left: <span class="stock-num">${Number(item.stock) || 0}</span> ${esc(item.unit)}</div><div class="item-price">₱${(Number(item.price) || 0).toFixed(2)}</div><button class="btn-add-tray" onclick="addToTray(${Number(item.id)})" ${expired || Number(item.stock) <= 0 ? 'disabled' : ''}>${expired || Number(item.stock) <= 0 ? 'Unavailable' : '+ Add to Tray'}</button></div>`;
      grid.appendChild(card);
    });
    if (typeof window.evaluateAlerts === 'function') window.evaluateAlerts();
  }
  function display(next) {
    state = next;
    renderAdmin(next);
    renderMenu(next.inventory || []);
    if (document.getElementById('adminTransactionTable') && typeof window.renderAdminTransactions === 'function') window.renderAdminTransactions();
  }
  async function saveAdminTables() {
    if (isHydrating || !state) return;
    const base = state;
    const inventory = [...document.querySelectorAll('#inventoryTable tr')].map(rowData);
    const archived = [...document.querySelectorAll('#archiveTable tr')].map(rowData);
    const latest = await getState();
    await sendState({ ...latest, inventory, archived }, base);
  }
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveAdminTables().catch(showConnectionError), 120);
  }
  // js5: Submit the order once so the server checks stock and broadcasts the result.
  async function placeSharedOrder() {
    const name = document.getElementById('studentName').value.trim();
    if (!Array.isArray(tray) || !tray.length) return alert('Your order tray is empty!');
    if (!name) return alert('Please enter your Full Name before checking out!');
    let response;
    let result;
    try {
      response = await fetch(`${endpoint}/order`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ customerName: name, items: tray.map(item => ({ id: item.id, qty: item.qty })) }) });
      result = await response.json();
    } catch (_) {
      showConnectionError();
      return alert('Could not reach the shared server. Your order was not placed.');
    }
    if (!response.ok) return alert(result.error || 'Could not place order. Please refresh the menu and try again.');
    const order = result.order;
    tray = [];
    document.getElementById('studentName').value = '';
    if (typeof window.renderTray === 'function') window.renderTray();
    alert(`Order confirmed!\n\nThank you ${order.customerName}.\nYour Order Number is #${order.orderNumber}.\nTotal: ₱${Number(order.total).toFixed(2)}\n\nPlease proceed to the counter for pickup.`);
  }
  // js6: Load shared state, persist admin actions, and listen for live changes.
  async function init() {
    try {
      const initial = await getState();
      display(initial);
      if (document.getElementById('inventoryTable')) {
        ['terminateItem', 'reactivateItem', 'deletePermanently', 'saveEditedItem', 'addNewItem'].forEach(name => {
          const original = window[name];
          if (typeof original !== 'function') return;
          window[name] = function (...args) { const value = original.apply(this, args); scheduleSave(); setTimeout(scheduleSave, 450); return value; };
        });
        window.resetAllData = resetSharedData;
        const adminTable = document.getElementById('inventoryTable');
        const archiveTable = document.getElementById('archiveTable');
        new MutationObserver(scheduleSave).observe(adminTable, { childList: true, subtree: true, characterData: true, attributes: true });
        new MutationObserver(scheduleSave).observe(archiveTable, { childList: true, subtree: true, characterData: true, attributes: true });
      }
      if (document.getElementById('menuGrid')) window.checkoutOrder = placeSharedOrder;
      const events = new EventSource(`${endpoint}/events`);
      events.onmessage = event => {
        document.getElementById('sharedSyncNotice')?.remove();
        try { display(JSON.parse(event.data)); } catch (_) {}
      };
      events.onerror = showConnectionError;
    } catch (_) { showConnectionError(); }
  }
  document.addEventListener('DOMContentLoaded', init);
})();
