let state, activePage = null, previousFocus;
const $ = selector => document.querySelector(selector);
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const badge = status => `<span class="badge ${status === 'live' ? 'blue' : ''}">${status === 'live' ? 'Live in preview' : escape(status)}</span>`;
const panel = (title, text, label = 'NOT CONNECTED') => `<section class="empty-view panel"><span class="eyebrow">${label}</span><div class="empty-symbol" aria-hidden="true">↗</div><h2>${title}</h2><p>${text}</p><a class="secondary" href="#overview">Back to overview</a></section>`;
async function api(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': state?.csrf || '', ...options.headers } });
  if (response.status === 401) { location.assign('/login'); throw new Error('Your preview session has expired.'); }
  const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Request failed.'); return data;
}
const pageRows = () => state.pages.map(page => `<article class="page-card"><div class="page-card-top"><span class="eyebrow">${escape(state.sources.find(s => s.id === page.source).kind)}</span>${badge(page.status)}</div><h3>${escape(page.title)}</h3><p class="small muted">Production status: not connected</p><p class="page-path">/preview/pages/${escape(page.slug)}</p><div class="page-actions"><button class="primary small-button" data-edit="${page.id}">Edit preview</button><a class="secondary small-button" href="/preview/pages/${escape(page.slug)}" target="_blank" rel="noopener">View ↗</a><a class="export" href="/api/pages/${page.id}/export" aria-label="Export ${escape(page.title)} theme JSON">Export JSON</a></div></article>`).join('');
function render() {
  const known = ['overview','pages','orders','customers','whatsapp','analytics','audit'];
  const current = known.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'overview';
  document.querySelectorAll('[data-nav]').forEach(link => { if (link.dataset.nav === current) link.setAttribute('aria-current','page'); else link.removeAttribute('aria-current'); });
  const title = { overview: 'The day, in perspective.', pages: 'Places. People. Possibilities.', orders: 'Orders & fulfilment', customers: 'Customer support', whatsapp: 'WhatsApp workspace', analytics: 'Performance, with context.', audit: 'A clear record of every change.' }[current];
  let content = '';
  if (current === 'overview') content = `<section class="overview-hero"><div><span class="eyebrow">WELCOME TO YOUR OPERATIONS DESK</span><h1>${title}</h1><p>A quieter place to manage the details that make My Coffee Co. feel like My Coffee Co.</p><a class="button yellow-button" href="#pages">Explore landing pages →</a></div><div class="hero-note"><span class="large-number">${state.sources.length.toString().padStart(2,'0')}</span><span>existing source templates<br>ready for private review</span></div></section><div class="summary-grid"><article class="panel"><span class="eyebrow">YOUR WEB PRESENCE</span><h2>${state.pages.length} preview pages</h2><p>Drafts, paused pages and reviewer-only previews.</p><a href="#pages">Manage pages →</a></article><article class="panel"><span class="eyebrow">NEXT IN THE WORKFLOW</span><h2>Shiprocket</h2><p>Orders and fulfilment are intentionally deferred.</p><a href="#orders">See integration state →</a></article><article class="panel"><span class="eyebrow">YOUR ANALYTICS SOURCE</span><h2>Shopify</h2><p>Selected by you. No metrics have been imported.</p><a href="#analytics">See what is pending →</a></article></div><section class="panel"><div class="panel-head"><div><span class="eyebrow">BUILD WITH CONFIDENCE</span><h2>The preview boundary</h2></div><span class="badge blue">Production disconnected</span></div><div class="boundary-grid"><div><h3>Try page changes</h3><p>Create, edit and pause protected preview pages. Each action is logged.</p></div><div><h3>Review the customer space</h3><p>Mobile-first design, with honest empty states for pending integrations.</p><a href="/customer">Open customer preview ↗</a></div><div><h3>Approve before connecting</h3><p>No Shopify writes, customer data, notifications or production deployments.</p></div></div></section>`;
  if (current === 'pages') content = `<div class="heading-row"><div><span class="eyebrow">LANDING PAGES</span><h1>${title}</h1><p>Reuse existing Liquid sections. Changes here never publish to Shopify.</p></div><button class="primary" id="new-page">Create preview page +</button></div><div class="callout">“Live in preview” means visible to signed-in reviewers only. Draft pages return 404; paused pages return 410. Production status is not being read.</div><div class="page-grid">${pageRows()}</div>`;
  if (current === 'orders') content = panel('Waiting for Shiprocket.', 'You asked to wait for the fulfilment workflow. Order history, stuck/unfulfilled alerts and live courier status will be wired afterwards. No invented orders or shipping statuses are displayed.', 'DEFERRED BY YOUR REQUEST');
  if (current === 'customers') content = panel('Support starts with the right access.', 'Customer search, order counts and last-order details will come from Shopify after approval and the required access is configured. No customer data is copied into this preview.');
  if (current === 'whatsapp') content = panel('A place for the conversations.', 'Bot health, opt-ins and failures will appear when the WhatsApp build supplies an authenticated monitoring source. There are no live conversations or message-sending controls in this preview.');
  if (current === 'analytics') content = panel('Shopify is your source of truth.', 'Shopify Analytics is the confirmed source. Per-page traffic and conversions remain hidden until access, report definitions and page attribution are verified after approval. No placeholder performance numbers are shown.', 'SOURCE SELECTED · NOT CONNECTED');
  if (current === 'audit') content = `<div class="heading-row"><div><span class="eyebrow">ACTIVITY LOG</span><h1>${title}</h1><p>Actor, action and UTC time for preview changes. Page edits and audit records commit together.</p></div></div><div class="callout">${escape(state.persistence)} Durable storage and named staff accounts are required before production.</div><section class="audit-list">${state.audit.map(item => `<article class="audit-item"><span class="audit-dot"></span><div><h3>${escape(item.action.replaceAll('_',' '))}</h3><p>${escape(item.actor)} · ${escape(item.at)} <span class="small">UTC</span></p><details><summary>View change details</summary><pre>${escape(JSON.stringify({ target: item.target, before: JSON.parse(item.before_value), after: JSON.parse(item.after_value) }, null, 2))}</pre></details></div></article>`).join('')}</section>`;
  $('#view').innerHTML = content;
  document.querySelectorAll('[data-edit]').forEach(button => button.addEventListener('click', () => openEditor(button.dataset.edit)));
  $('#new-page')?.addEventListener('click', () => openEditor());
}
function renderFields(values) {
  const source = state.sources.find(source => source.id === $('#page-source').value);
  $('#source-fields').innerHTML = `<h3>Existing template content</h3><p class="small muted">Only plain-text fields are editable in this first preview. Existing photographs, CSS and structure are preserved.</p>` + source.fields.map(field => `<label>${escape(field.label)}<textarea data-setting="${escape(field.id)}" maxlength="1500" rows="2">${escape((values || source.settings)[field.id] || '')}</textarea></label>`).join('');
}
function openEditor(id) {
  activePage = id ? state.pages.find(page => page.id === id) : null; previousFocus = document.activeElement;
  $('#page-form').reset(); $('#save-error').textContent = '';
  $('#editor-title').textContent = activePage ? 'Edit preview page' : 'Create a preview page';
  $('#page-source').innerHTML = state.sources.map(source => `<option value="${source.id}">${escape(source.title)}</option>`).join('');
  $('#page-source').value = activePage?.source || state.sources[0].id; $('#page-source').disabled = !!activePage;
  $('#page-title').value = activePage?.title || ''; $('#page-slug').value = activePage?.slug || ''; $('#page-status').value = activePage?.status || 'draft'; renderFields(activePage?.settings);
  $('#editor').showModal(); $('#page-title').focus();
}
function closeEditor() { $('#editor').close(); previousFocus?.focus(); }
$('#close-editor').addEventListener('click', closeEditor); $('#cancel-editor').addEventListener('click', closeEditor);
$('#editor').addEventListener('cancel', event => { event.preventDefault(); closeEditor(); });
$('#page-source').addEventListener('change', () => renderFields());
$('#page-form').addEventListener('submit', async event => {
  event.preventDefault(); const button = event.target.querySelector('[type=submit]'); button.disabled = true; $('#save-error').textContent = '';
  try {
    const input = { title: $('#page-title').value, slug: $('#page-slug').value, source: $('#page-source').value, status: $('#page-status').value, settings: Object.fromEntries([...document.querySelectorAll('[data-setting]')].map(field => [field.dataset.setting, field.value])), version: activePage?.version };
    await api(activePage ? `/api/pages/${activePage.id}` : '/api/pages', { method: activePage ? 'PATCH' : 'POST', body: JSON.stringify(input) });
    state = await api('/api/overview'); closeEditor(); render(); $('#toast').textContent = 'Saved to preview only. Your production website is unchanged.'; $('#toast').hidden = false; setTimeout(() => { $('#toast').hidden = true; }, 5000);
  } catch (error) { $('#save-error').textContent = error.message; } finally { button.disabled = false; }
});
$('#logout').addEventListener('click', async () => { try { await api('/api/logout', { method: 'POST', body: '{}' }); location.assign('/login'); } catch (error) { $('#toast').textContent = error.message; $('#toast').hidden = false; } });
window.addEventListener('hashchange', () => { if (state) render(); });
api('/api/overview').then(result => { state = result; render(); }).catch(error => { $('#view').textContent = error.message; });
