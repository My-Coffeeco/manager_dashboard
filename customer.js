'use strict';
(() => {
  // Explicit sample data, in memory only. Never saved, synced or sent to Shopify.
  const customer = { name: 'Aarav Mehta', email: 'aarav.mehta@example.com', phone: '' };
  const sections = [
    { id: 'dashboard', label: 'Dashboard', icon: 'grid', title: 'MY ACCOUNT DASHBOARD', description: 'A little overview of your account. Everything in one place.' },
    { id: 'orders', label: 'My Orders', icon: 'box', title: 'MY ORDERS', description: 'Your coffee orders, all together.' },
    { id: 'profile', label: 'My Profile', icon: 'user', title: 'MY PROFILE', description: 'Your details and preferences, at a glance.' },
    { id: 'wishlist', label: 'My Wishlist', icon: 'heart', title: 'MY WISHLIST', description: 'Keep your next coffee favourites close.' },
    { id: 'recent', label: 'Recently Viewed', icon: 'clock', title: 'RECENTLY VIEWED', description: 'A little reminder of what caught your eye.' },
    { id: 'subscription', label: 'My Subscription', icon: 'repeat', title: 'MY SUBSCRIPTION', description: 'A space for your regular coffee routine.' },
    { id: 'password', label: 'Change Password', icon: 'lock', title: 'ACCOUNT SECURITY', description: 'Your sign-in, managed securely by Shopify.' }
  ];
  const paths = {
    grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
    box: '<path d="m12 3 9 5v9l-9 5-9-5V8l9-5Z M3 8l9 5 9-5 M12 13v9 M7.5 5.5l9 5v4"/>',
    heart: '<path d="M20.8 4.7a5.5 5.5 0 0 0-7.8 0L12 5.8l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.5a5.5 5.5 0 0 0 0-7.8Z"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    repeat: '<path d="m17 2 4 4-4 4 M3 11V8a2 2 0 0 1 2-2h16 M7 22l-4-4 4-4 M21 13v3a2 2 0 0 1-2 2H3"/>',
    lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4 M12 14v3"/>',
    logout: '<path d="M9 4H4v16h5 M8 12h13 m-4-4 4 4-4 4"/>',
    wallet: '<path d="M20 8V5H5a2 2 0 0 0 0 4h16v11H5a2 2 0 0 1-2-2V7 M21 12h-5v5h5 M17 14.5h1"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 6 9 7 9-7"/>',
    phone: '<path d="m7 3 3 5-3 3a16 16 0 0 0 6 6l3-3 5 3c0 3-2 5-5 4C9 19 5 15 3 8 2 5 4 3 7 3Z"/>',
    edit: '<path d="m15 4 5 5 M4 20l5-1L21 7a2 2 0 0 0-5-5L4 14l-1 7 M13 21h8"/>',
    shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z m-4 9 3 3 5-6"/>',
    search: '<circle cx="10.5" cy="10.5" r="7"/><path d="m16 16 5 5"/>',
    bag: '<path d="M5 7h14l2 14H3L5 7Z M8 8V6a4 4 0 0 1 8 0v2"/>',
    chevron: '<path d="m6 9 6 6 6-6"/>', menu: '<path d="M3 6h18 M3 12h18 M3 18h18"/>', close: '<path d="m6 6 12 12 M6 18 18 6"/>'
  };
  const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${paths[name] || paths.user}</svg>`;
  const nav = document.querySelector('#account-navigation');
  // The HTML interpolations below use fixed navigation/icon data, never profile input.
  nav.innerHTML = sections.map(s => `<a class="account-nav-link" href="#${s.id}" data-section="${s.id}">${icon(s.icon)}<span>${s.label}</span></a>`).join('') + `<div class="account-logout-wrap"><button class="account-logout" id="account-logout" type="button">${icon('logout')}<span>Logout</span></button></div>`;
  document.querySelectorAll('[data-icon]').forEach(node => { node.innerHTML = icon(node.dataset.icon); });
  document.querySelector('#total-spent').textContent = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(0);
  const sidebar = document.querySelector('.account-sidebar'), menuToggle = document.querySelector('#account-menu-toggle');
  function closeMenu() { sidebar.classList.remove('menu-open'); menuToggle.setAttribute('aria-expanded', 'false'); }
  menuToggle.addEventListener('click', () => { const open = menuToggle.getAttribute('aria-expanded') !== 'true'; menuToggle.setAttribute('aria-expanded', String(open)); sidebar.classList.toggle('menu-open', open); });
  function renderSection(moveFocus = false) {
    const section = sections.find(item => `#${item.id}` === location.hash) || sections[0];
    document.querySelectorAll('.account-section').forEach(node => { node.hidden = node.id !== `section-${section.id}`; });
    nav.querySelectorAll('[data-section]').forEach(link => { if (link.dataset.section === section.id) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current'); });
    document.querySelector('#section-title').textContent = section.title;
    document.querySelector('#section-description').textContent = section.description;
    document.querySelector('#mobile-section-label').textContent = section.label;
    closeMenu();
    if (moveFocus) document.querySelector('#account-main').focus({ preventScroll: true });
  }
  window.addEventListener('hashchange', () => renderSection(true));
  nav.addEventListener('click', event => { if (event.target.closest('a')) { closeMenu(); document.querySelector('#account-main').focus({ preventScroll: true }); } });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && sidebar.classList.contains('menu-open')) { closeMenu(); menuToggle.focus(); } });
  document.addEventListener('click', event => { if (!sidebar.contains(event.target)) closeMenu(); });
  function showProfile() {
    const initials = customer.name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase();
    for (const [key, value] of Object.entries(customer)) document.querySelectorAll(`[data-customer-${key}]`).forEach(node => { node.textContent = value || 'Not added yet'; });
    document.querySelectorAll('[data-initials]').forEach(node => { node.textContent = initials; });
  }
  const profileDialog = document.querySelector('#profile-dialog'), utilityDialog = document.querySelector('#utility-dialog');
  let dialogOpener = null, toastTimer;
  function openDialog(dialog, opener) { dialogOpener = opener; dialog.showModal(); }
  document.querySelectorAll('dialog').forEach(dialog => {
    dialog.addEventListener('keydown', event => {
      if (event.key !== 'Tab') return;
      const controls = [...dialog.querySelectorAll('a[href],button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]')].filter(node => node.getClientRects().length);
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) { event.preventDefault(); first?.focus(); }
    });
    dialog.querySelectorAll('[data-close-dialog]').forEach(button => button.addEventListener('click', () => dialog.close()));
    dialog.addEventListener('close', () => { dialogOpener?.focus({ preventScroll: true }); });
    dialog.addEventListener('click', event => { if (event.target === dialog) { const b = dialog.getBoundingClientRect(); if (event.clientX < b.left || event.clientX > b.right || event.clientY < b.top || event.clientY > b.bottom) dialog.close(); } });
  });
  document.querySelectorAll('[data-edit-profile]').forEach(button => button.addEventListener('click', () => {
    for (const key of Object.keys(customer)) document.querySelector(`#profile-${key}`).value = customer[key];
    document.querySelector('#profile-name').setCustomValidity('');
    openDialog(profileDialog, button); document.querySelector('#profile-name').focus();
  }));
  document.querySelector('#profile-name').addEventListener('input', event => event.target.setCustomValidity(''));
  document.querySelector('#profile-form').addEventListener('submit', event => {
    event.preventDefault(); const input = document.querySelector('#profile-name');
    if (!input.value.trim()) { input.setCustomValidity('Please enter a name.'); input.reportValidity(); return; }
    const values = new FormData(event.target);
    for (const key of Object.keys(customer)) customer[key] = String(values.get(key) || '').trim();
    showProfile(); profileDialog.close();
    const toast = document.querySelector('#account-toast'); toast.textContent = 'Sample profile updated. The live account is unchanged.'; toast.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { toast.hidden = true; }, 5500);
  });
  function utility(title, html, opener) { document.querySelector('#utility-title').textContent = title; document.querySelector('#utility-content').innerHTML = html; openDialog(utilityDialog, opener); }
  document.querySelector('#open-search').addEventListener('click', event => utility('Search the store', '<p>Store search is not connected to this private account preview. You can explore the existing store in a separate tab.</p><a class="blue-button" href="https://mycoffeeco.com/collections/coffee-beans" target="_blank" rel="noopener noreferrer">Visit coffee collection ↗</a>', event.currentTarget));
  document.querySelector('#open-cart').addEventListener('click', event => utility('Your preview cart is empty', '<p>There are no items in this sample cart. The live Shopify cart and checkout have not been changed.</p><p>Shopping and checkout will continue to use Shopify after the account design is approved.</p>', event.currentTarget));
  document.querySelector('#open-store-menu').addEventListener('click', event => {
    const links = [...document.querySelectorAll('.store-links a')].map(link => `<a href="${link.href}" target="_blank" rel="noopener noreferrer">${link.textContent}<span aria-hidden="true">↗</span></a>`).join('');
    utility('Explore My Coffee Co.', `<p>These links open the existing store in a new tab.</p><nav class="utility-nav" aria-label="Store navigation">${links}</nav>`, event.currentTarget);
    document.querySelectorAll('.utility-nav a').forEach(link => link.addEventListener('click', () => utilityDialog.close()));
  });
  document.querySelector('#account-logout').addEventListener('click', event => {
    if (document.body.dataset.runtime === 'shopify-editor') return utility('Shopify editor preview', '<p>No customer is signed in to this design preview. Close the theme editor to finish reviewing. Your Shopify admin session is unchanged.</p>', event.currentTarget);
    utility('End your preview session?', '<p>This signs you out of the private preview, not your Shopify customer or admin account.</p><div class="dialog-actions"><button class="outline-button" id="cancel-preview-logout" type="button">Cancel</button><button class="blue-button" id="confirm-preview-logout" type="button">Sign out of preview</button></div><p id="logout-error" role="alert"></p>', event.currentTarget);
    document.querySelector('#cancel-preview-logout').addEventListener('click', () => utilityDialog.close());
    document.querySelector('#confirm-preview-logout').addEventListener('click', async click => {
      click.currentTarget.disabled = true;
      try {
        const stateResponse = await fetch('/api/overview');
        if (stateResponse.status === 401) { location.assign('/login'); return; }
        if (!stateResponse.ok) throw new Error('Could not check your preview session. Please try again.');
        const state = await stateResponse.json();
        const response = await fetch('/api/logout', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': state.csrf }, body: '{}' });
        if (!response.ok) throw new Error('Could not sign out. Please try again.');
        location.assign('/login');
      } catch (error) { document.querySelector('#logout-error').textContent = error.message; document.querySelector('#confirm-preview-logout').disabled = false; }
    });
  });
  renderSection(); showProfile();
})();
