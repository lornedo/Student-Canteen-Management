// js1: Small same-Wi-Fi data server for the admin and customer pages.
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 8080);
const DATA_FILE = path.join(ROOT, 'canteen-data.json');
const defaults = {
  inventory: [
    { id: 1, name: 'Chicken Adobo Rice', category: 'Rice Meal', price: 65, stock: 20, unit: 'servings', expiry: '2026-10-25', intendedUse: 'Complete lunch meal' },
    { id: 2, name: 'Bottled Mineral Water', category: 'Beverages', price: 15, stock: 45, unit: 'bottles', expiry: '2026-12-31', intendedUse: 'Ready-to-drink beverage' },
    { id: 3, name: 'Iced Tea', category: 'Beverages', price: 20, stock: 25, unit: 'cups', expiry: '2026-10-28', intendedUse: 'Cold drink served with meals' }
  ],
  archived: [],
  transactions: []
};
const clients = new Set();

function readState() {
  try {
    const state = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    return {
      inventory: Array.isArray(state.inventory) ? state.inventory : defaults.inventory,
      archived: Array.isArray(state.archived) ? state.archived : [],
      transactions: Array.isArray(state.transactions) ? state.transactions : []
    };
  } catch (_) { return JSON.parse(JSON.stringify(defaults)); }
}
let state = readState();
function publish() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2));
  const message = `data: ${JSON.stringify(state)}\n\n`;
  for (const client of clients) client.write(message);
}
function json(res, value, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(value));
}

http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' });
    return res.end();
  }
  if (req.url === '/api/state' && req.method === 'GET') return json(res, state);
  if (req.url === '/api/reset' && req.method === 'POST') {
    state = JSON.parse(JSON.stringify(defaults));
    publish();
    return json(res, { ok: true });
  }
  if (req.url === '/api/state' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > 10_000_000) req.destroy(); });
    req.on('end', () => {
      try {
        const update = JSON.parse(body);
        const next = update.next;
        if (!Array.isArray(next.inventory) || !Array.isArray(next.archived) || !Array.isArray(next.transactions)) return json(res, { error: 'Invalid shared state' }, 400);
        const baseRows = [...(update.base?.inventory || []), ...(update.base?.archived || [])];
        const currentRows = [...state.inventory, ...state.archived];
        const baseById = new Map(baseRows.map(item => [String(item.id), item]));
        const currentById = new Map(currentRows.map(item => [String(item.id), item]));
        const mergeRows = rows => rows.map(item => {
          const previous = baseById.get(String(item.id));
          const current = currentById.get(String(item.id));
          const merged = { ...(current || {}), ...item };
          // js2: Keep a checkout's stock deduction when an admin edit was based on an older view.
          if (previous && current && Number(item.stock) === Number(previous.stock)) merged.stock = current.stock;
          return merged;
        });
        state = {
          inventory: mergeRows(next.inventory),
          archived: mergeRows(next.archived),
          transactions: state.transactions
        };
        publish();
        json(res, { ok: true });
      } catch (_) { json(res, { error: 'Invalid JSON' }, 400); }
    });
    return;
  }
  if (req.url === '/api/order' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > 100_000) req.destroy(); });
    req.on('end', () => {
      try {
        const request = JSON.parse(body);
        const customerName = String(request.customerName || '').trim();
        if (!customerName || !Array.isArray(request.items) || !request.items.length) return json(res, { error: 'Enter your name and add at least one item.' }, 400);
        const quantities = new Map();
        for (const line of request.items) quantities.set(Number(line.id), (quantities.get(Number(line.id)) || 0) + Number(line.qty));
        let total = 0;
        const purchased = [];
        const planned = [];
        for (const [id, qty] of quantities) {
          const item = state.inventory.find(entry => Number(entry.id) === id);
          const dateParts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
          const today = `${dateParts.find(part => part.type === 'year').value}-${dateParts.find(part => part.type === 'month').value}-${dateParts.find(part => part.type === 'day').value}`;
          if (!item || !Number.isInteger(qty) || qty < 1 || Number(item.stock) < qty || !item.expiry || item.expiry <= today) {
            return json(res, { error: `"${item?.name || 'An item'}" is unavailable or has insufficient stock. Refresh the menu and try again.` }, 409);
          }
          planned.push({ item, qty });
          total += Number(item.price) * qty;
          purchased.push(`${item.name} x${qty}`);
        }
        planned.forEach(({ item, qty }) => { item.stock -= qty; });
        const order = {
          orderNumber: Math.floor(1000 + Math.random() * 9000),
          customerName,
          items: purchased,
          total,
          timestamp: new Date().toLocaleString('en-PH', { timeZone: 'Asia/Manila' })
        };
        state.transactions.push(order);
        publish();
        json(res, { ok: true, order, state });
      } catch (_) { json(res, { error: 'Invalid order data.' }, 400); }
    });
    return;
  }
  if (req.url === '/api/events' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'Access-Control-Allow-Origin': '*' });
    res.write(`data: ${JSON.stringify(state)}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  const pathname = decodeURIComponent((req.url || '/').split('?')[0]);
  const relative = pathname === '/' ? 'admin.html' : pathname.slice(1);
  const filename = path.resolve(ROOT, relative);
  if (!filename.startsWith(ROOT + path.sep) || !fs.existsSync(filename) || !fs.statSync(filename).isFile()) return json(res, { error: 'Not found' }, 404);
  const type = filename.endsWith('.html') ? 'text/html' : filename.endsWith('.js') ? 'text/javascript' : 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` });
  fs.createReadStream(filename).pipe(res);
}).listen(PORT, '0.0.0.0', () => console.log(`Canteen app ready at http://localhost:admin.html`));
