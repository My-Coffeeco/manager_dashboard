document.querySelector('#login-form').addEventListener('submit', async event => {
  event.preventDefault(); const button = event.target.querySelector('button'); const message = document.querySelector('#error');
  button.disabled = true; message.textContent = '';
  try { const values = Object.fromEntries(new FormData(event.target)); const response = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values) }); const result = await response.json(); if (!response.ok) throw new Error(result.error); location.assign('/manager'); }
  catch (error) { message.textContent = error.message || 'Could not sign in. Please try again.'; }
  finally { button.disabled = false; }
});
