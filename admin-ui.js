(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  let me, storeId, lastOrders = [];
  const node = (tag, value, cls) => {
    const e = document.createElement(tag);
    if (value != null) e.textContent = value;
    if (cls) e.className = cls;
    return e;
  };
  async function api(path, body) {
    const r = await fetch(path, {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'Content-Type': 'application/json', 'X-CSRF-Token': me?.csrf || '' } : {},
      body: body ? JSON.stringify(body) : undefined
    });
    const data = await r.json();
    if (r.status === 401) {
      me = null;
      lastOrders = [];
      $('dashboard').hidden = true;
      $('logout').hidden = true;
      $('login').hidden = false;
      ['stats', 'orders', 'inquiries', 'alerts', 'detail-content', 'identity', 'role', 'count'].forEach(id => $(id)?.replaceChildren());
      if ($('order-detail')?.open) $('order-detail').close();
    }
    if (!r.ok) throw Error(data.error || 'Request failed');
    return data;
  }
  const message = e => { if ($('message')) $('message').textContent = e?.message || e || ''; };
  function form(id, fn) {
    const f = $(id);
    if (!f) return;
    f.onsubmit = async e => {
      e.preventDefault();
      const b = e.target.querySelector('button');
      if (b) b.disabled = true;
      try {
        await fn(Object.fromEntries(new FormData(e.target)));
      } catch (err) {
        message(err);
      } finally {
        if (b) b.disabled = false;
      }
    };
  }
  async function stores() {
    const values = await api('/admin/stores');
    $('store').replaceChildren(...values.map(s => {
      const o = node('option', s.name || s.id);
      o.value = s.id;
      return o;
    }));
    storeId = values.some(x => x.id === storeId) ? storeId : values[0]?.id;
    $('store').value = storeId || '';
  }
  async function refresh() {
    if (!storeId) {
      message('Create a store to begin.');
      return;
    }
    const d = await api('/admin/dashboard?store_id=' + encodeURIComponent(storeId));
    const storeName = d?.store?.name || storeId || 'My Coffee Co.';
    const roleTitle = me?.role ? me.role.replaceAll('_', ' ') : 'Manager';
    $('identity').textContent = roleTitle + ' · ' + storeName;
    $('role').textContent = 'Role: ' + (me?.role || 'store_manager');
    $('count').textContent = (d?.alerts?.length || 0) + ' unread alerts';

    const money = v => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(v / 100);
    if ($('data-notice')) $('data-notice').textContent = d?.data_notice || '';
    $('stats').replaceChildren(...[
      ["Today's revenue", d.revenue_paise == null ? null : money(d.revenue_paise), 'orders'],
      ['Open orders', d.open_orders, 'orders'],
      ['Low stock SKUs', d.low_stock, 'inventory'],
      ['Open inquiries', d.open_inquiries, 'inquiries']
    ].map(([label, value, permission]) => {
      const c = node('div', null, 'stat');
      const hasPerm = me?.permissions?.includes(permission);
      c.append(node('span', label), node('strong', value ?? (d?.sources && hasPerm ? 'Awaiting data' : 'No access')));
      return c;
    }));
    const list = (id, items, render) => {
      const target = $(id);
      target.replaceChildren();
      if (!items) return target.append(node('p', 'Your role does not have access.'));
      if (!items.length) return target.append(node('p', 'No records received yet.'));
      items.forEach(item => target.append(render(item)));
    };
    lastOrders = d.orders || [];
    renderOrders();
    list('inquiries', d.inquiries, o => {
      const r = node('div', null, 'row'), info = node('div');
      info.append(node('strong', (o.type || 'Inquiry') + ' · ' + (o.name || 'Customer')), node('p', new Date(o.submitted_at).toLocaleString('en-IN')));
      r.append(info, node('span', (o.status || '').replaceAll('_', ' '), 'badge'));
      return r;
    });
    list('alerts', d.alerts, a => {
      const r = node('div', null, 'row'), b = node('button', 'Mark read');
      b.onclick = async () => {
        try {
          await api('/admin/alerts/read', { id: a.id });
          await refresh();
        } catch (err) {
          message(err);
        }
      };
      r.append(node('span', a.message), b);
      return r;
    });
  }
  function renderOrders() {
    const target = $('orders');
    target.replaceChildren();
    if (!lastOrders) {
      target.append(node('p', 'Your role does not have order access.'));
      return;
    }
    if (!lastOrders.length) {
      target.append(node('p', 'No orders received yet.'));
      return;
    }
    const search = ($('order-search')?.value || '').toLowerCase();
    const status = $('order-filter')?.value || 'all';
    const rows = lastOrders.filter(o => (status === 'all' || o.status === status) && ((o.id || '') + ' ' + (o.customer || '')).toLowerCase().includes(search));
    if (!rows.length) target.append(node('p', 'No orders match this view.'));
    for (const o of rows) {
      const r = node('div', null, 'row'), info = node('div'), b = node('button', 'View →', 'detail-button');
      info.append(node('strong', o.id), node('p', o.customer));
      b.onclick = () => {
        const content = $('detail-content');
        const details = [
          ['Order', o.id],
          ['Customer', o.customer],
          ['Status', (o.status || '').replaceAll('_', ' ')],
          ['Total', new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(o.amount_paise / 100)]
        ].map(([k, v]) => node('p', k + ': ' + v));

        const formEl = node('form');
        formEl.style.marginTop = '16px';
        const labelEl = node('label', 'Change status');
        const sel = node('select');
        sel.name = 'status';
        [
          ['paid', 'Awaiting pack'],
          ['payment_pending', 'Payment pending'],
          ['shipped', 'In transit / Shipped'],
          ['delivered', 'Delivered'],
          ['cancelled', 'Cancelled']
        ].forEach(([st, lbl]) => {
          const opt = node('option', lbl);
          opt.value = st;
          if (st === o.status) opt.selected = true;
          sel.append(opt);
        });
        labelEl.append(sel);
        const subBtn = node('button', 'Update status');
        subBtn.style.marginTop = '10px';
        formEl.append(labelEl, subBtn);

        formEl.onsubmit = async evt => {
          evt.preventDefault();
          subBtn.disabled = true;
          try {
            const res = await api('/admin/orders/status', { id: o.id, status: sel.value });
            message('Order ' + o.id + ' status updated to ' + sel.value + (res.shopify_synced ? ' (Synced with Shopify)' : ''));
            $('order-detail')?.close();
            await refresh();
          } catch (err) {
            message(err);
          } finally {
            subBtn.disabled = false;
          }
        };

        content.replaceChildren(...details, formEl);
        $('order-detail')?.showModal();
      };
      r.append(info, node('span', ({ paid: 'Awaiting pack', payment_pending: 'Payment pending', shipped: 'In transit', delivered: 'Delivered', cancelled: 'Cancelled' })[o.status] || (o.status || '').replaceAll('_', ' '), 'badge'), b);
      target.append(r);
    }
  }
  if ($('order-search')) $('order-search').oninput = renderOrders;
  if ($('order-filter')) $('order-filter').onchange = renderOrders;
  if ($('close-detail')) $('close-detail').onclick = () => $('order-detail')?.close();
  if ($('refresh')) $('refresh').onclick = () => refresh().catch(message);
  document.querySelectorAll('[data-view]').forEach(b => b.onclick = () => {
    const view = b.dataset.view;
    document.querySelectorAll('[data-view]').forEach(x => {
      if (x === b) x.setAttribute('aria-current', 'page');
      else x.removeAttribute('aria-current');
    });
    $('view-title').textContent = { overview: "Let's get brewing.", orders: 'Every order, in focus.', inquiries: 'Your next opportunity.', alerts: 'What needs attention.' }[view] || "Let's get brewing.";
    $('stats').hidden = view !== 'overview';
    $('orders-panel').hidden = !['overview', 'orders'].includes(view);
    $('inquiries-panel').hidden = !['overview', 'inquiries'].includes(view);
    $('alerts-panel').hidden = !['overview', 'alerts'].includes(view);
    $('work-lists').classList.toggle('single', view !== 'overview');
  });
  async function init() {
    if (location.pathname.startsWith('/admin/invite/')) {
      const data = await api(location.pathname + '?validate=1');
      $('accept').hidden = false;
      $('accept').elements.name.value = data.name;
      return;
    }
    try {
      me = await api('/admin/auth/me');
    } catch {
      $('login').hidden = false;
      return;
    }
    $('dashboard').hidden = false;
    $('logout').hidden = false;
    storeId = me.store_id || 'mycoffeeco-online';
    if (me?.permissions?.includes('invite')) {
      $('administration').hidden = false;
      $('store').hidden = false;
      await stores();
    }
    await refresh();
  }
  form('login', async data => {
    await api('/admin/auth/login', data);
    location.assign('/admin');
  });
  form('accept', async data => {
    await api(location.pathname, data);
    location.assign('/admin');
  });
  form('create-store', async data => {
    await api('/admin/stores', data);
    await stores();
    await refresh();
    message('Store created.');
  });
  form('invite', async data => {
    if (!storeId) throw Error('Choose a store first.');
    await api('/admin/invite', { ...data, store_id: storeId });
    $('invite').reset();
    message('Invitation queued for email delivery.');
  });
  if ($('store')) $('store').onchange = () => { storeId = $('store').value; refresh().catch(message); };
  if ($('logout')) $('logout').onclick = async () => {
    try {
      await api('/admin/auth/logout', {});
    } catch (e) {
      /* ignore logout api error */
    }
    me = null;
    lastOrders = [];
    $('dashboard').hidden = true;
    $('logout').hidden = true;
    $('login').hidden = false;
    if ($('login')) $('login').reset();
    message('Signed out successfully.');
    location.assign('/admin');
  };
  init().catch(message);
  setInterval(() => {
    if (me && !document.hidden) refresh().catch(message);
  }, 30000);
})();
