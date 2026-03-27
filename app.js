let supabaseUrl = window.__SUPABASE_URL || '';
let supabaseAnonKey = window.__SUPABASE_ANON_KEY || '';
const CURRENCY_SYMBOL = 'Rs.';
const PAGE_SIZE = 20;
const PINNED_ACCOUNTS_KEY = 'ledger_pinned_accounts';

let supabaseClient = null;
let currentUser = null;
let confirmCallback = null;
let supportsAccountTypeColumn = true;

const appState = {
  currentTab: 'dashboard',
  currentPage: 0,
  editingAccountId: null,
  viewingVoucherId: null,
  voucherDraft: null,
  allAccounts: [],
};

function getNormalBalance(accountType) {
  return ['asset', 'expense'].includes(accountType) ? 'debit' : 'credit';
}

function formatDate(date) {
  if (!date) return '';
  return new Date(date).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatMoney(amount = 0) {
  const absAmount = Math.abs(Number(amount) || 0);
  return `${CURRENCY_SYMBOL} ${absAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatMoneyWithSign(amount = 0) {
  const sign = amount >= 0 ? '+' : '-';
  return `${sign} ${formatMoney(amount)}`;
}

function showToast(message, type = 'success') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = `toast ${type}`;
  setTimeout(() => toast.classList.add('hidden'), 3000);
}

function escapeHtml(text = '') {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  return String(text).replace(/[&<>"']/g, m => map[m]);
}

function setButtonLoading(btn, loading) {
  if (!btn) return;
  btn.disabled = loading;
  btn.classList.toggle('btn-loading', loading);
}

function getPinnedKey() {
  return currentUser ? `${PINNED_ACCOUNTS_KEY}_${currentUser.id}` : PINNED_ACCOUNTS_KEY;
}

function getPinnedAccounts() {
  try {
    return JSON.parse(localStorage.getItem(getPinnedKey()) || '[]');
  } catch {
    return [];
  }
}

function togglePin(accountId) {
  const pinned = getPinnedAccounts();
  const idx = pinned.indexOf(accountId);
  if (idx >= 0) pinned.splice(idx, 1);
  else pinned.push(accountId);
  localStorage.setItem(getPinnedKey(), JSON.stringify(pinned));
}

async function initSupabase() {
  if (!supabaseUrl || !supabaseAnonKey || supabaseUrl.includes('your-project.supabase.co')) {
    showToast('Supabase is not configured for this build', 'error');
    showAuthScreen();
    return;
  }
  const { createClient } = window.supabase;
  supabaseClient = createClient(supabaseUrl, supabaseAnonKey);
  await detectSchemaCapabilities();

  supabaseClient.auth.onAuthStateChange((event, session) => {
    currentUser = session?.user || null;
    if (currentUser) {
      showApp();
      updateUserDisplay();
      if (event === 'SIGNED_IN') {
        ensureCashAccount().then(renderDashboard);
      }
    } else {
      showAuthScreen();
    }
  });

  const { data: { session } } = await supabaseClient.auth.getSession();
  currentUser = session?.user || null;
  if (currentUser) {
    showApp();
    updateUserDisplay();
    await ensureCashAccount();
    await renderDashboard();
  } else {
    showAuthScreen();
  }
}

async function detectSchemaCapabilities() {
  supportsAccountTypeColumn = true;
  try {
    const { error } = await supabaseClient.from('accounts').select('id,type').limit(1);
    if (error && String(error.message || '').toLowerCase().includes("could not find the 'type' column")) {
      supportsAccountTypeColumn = false;
      showToast("Database missing accounts.type. Using compatibility mode.", 'warning');
    }
  } catch {
    supportsAccountTypeColumn = false;
  }
}

function showAuthScreen() {
  document.getElementById('auth-screen').classList.remove('hidden');
  document.getElementById('app').classList.add('hidden');
  setAuthMode('signin');
}

function showApp() {
  document.getElementById('auth-screen').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
}

function setAuthMode(mode) {
  const form = document.getElementById('auth-form');
  const title = document.getElementById('auth-title');
  const links = document.getElementById('auth-links');
  const submitBtn = document.getElementById('btn-auth-submit');
  form.innerHTML = '';
  links.innerHTML = '';

  if (mode === 'signin') {
    title.textContent = 'Sign In';
    form.innerHTML = `<input type="email" placeholder="Email" id="auth-email" /><input type="password" placeholder="Password" id="auth-password" />`;
    links.innerHTML = `<button data-mode="signup">Create Account</button><button data-mode="forgot">Forgot Password?</button>`;
    submitBtn.textContent = 'Sign In';
  } else if (mode === 'signup') {
    title.textContent = 'Create Account';
    form.innerHTML = `<input type="email" placeholder="Email" id="auth-email" /><input type="password" placeholder="Password (min 8)" id="auth-password" /><input type="password" placeholder="Confirm Password" id="auth-password-confirm" />`;
    links.innerHTML = `<button data-mode="signin">Already have account?</button>`;
    submitBtn.textContent = 'Sign Up';
  } else {
    title.textContent = 'Reset Password';
    form.innerHTML = `<input type="email" placeholder="Email" id="auth-email" />`;
    links.innerHTML = `<button data-mode="signin">Back to Sign In</button>`;
    submitBtn.textContent = 'Send Reset Link';
  }

  form.querySelectorAll('input').forEach(inp => inp.addEventListener('keypress', e => e.key === 'Enter' && submitAuth()));
  links.querySelectorAll('button').forEach(btn => btn.addEventListener('click', () => setAuthMode(btn.dataset.mode)));
}

async function submitAuth() {
  const mode = document.getElementById('auth-title').textContent;
  const email = document.getElementById('auth-email')?.value.trim();
  const password = document.getElementById('auth-password')?.value;
  const errorDiv = document.getElementById('auth-error');
  const submitBtn = document.getElementById('btn-auth-submit');
  errorDiv.textContent = '';
  setButtonLoading(submitBtn, true);
  try {
    if (mode === 'Sign In') {
      const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
      if (error) throw error;
    } else if (mode === 'Create Account') {
      const confirm = document.getElementById('auth-password-confirm')?.value;
      if (password !== confirm) throw new Error('Passwords do not match');
      if ((password || '').length < 8) throw new Error('Password must be at least 8 characters');
      const { error } = await supabaseClient.auth.signUp({ email, password });
      if (error) throw error;
      errorDiv.textContent = 'Check your email to confirm signup.';
      errorDiv.style.display = 'block';
    } else {
      const { error } = await supabaseClient.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}?mode=update-password` });
      if (error) throw error;
      errorDiv.textContent = 'Check your email for reset link.';
      errorDiv.style.display = 'block';
    }
  } catch (err) {
    errorDiv.textContent = err.message || 'Authentication failed';
    errorDiv.style.display = 'block';
  } finally {
    setButtonLoading(submitBtn, false);
  }
}

function updateUserDisplay() {
  if (currentUser?.email) document.getElementById('user-email').textContent = currentUser.email;
}

async function logout() {
  await supabaseClient.auth.signOut();
  currentUser = null;
  showAuthScreen();
}

async function getAccounts(page = 0) {
  const offset = page * PAGE_SIZE;
  const { data, count, error } = await supabaseClient.from('accounts').select('*', { count: 'exact' }).eq('user_id', currentUser.id).order('name').range(offset, offset + PAGE_SIZE - 1);
  if (error) throw error;
  return { data: data || [], total: count || 0 };
}

async function getAllAccounts() {
  const { data, error } = await supabaseClient.from('accounts').select('*').eq('user_id', currentUser.id).order('name');
  if (error) throw error;
  return data || [];
}

async function getAccount(id) {
  const { data, error } = await supabaseClient.from('accounts').select('*').eq('id', id).eq('user_id', currentUser.id).single();
  if (error) return null;
  return data;
}

async function saveAccount(name, openingBalance, accountType, id = null) {
  if (!name.trim()) throw new Error('Account name required');
  const record = { user_id: currentUser.id, name: name.trim(), opening_balance: parseFloat(openingBalance) || 0, updated_at: new Date().toISOString() };
  if (supportsAccountTypeColumn) {
    record.type = accountType || 'asset';
  }
  if (id) {
    const { error } = await supabaseClient.from('accounts').update(record).eq('id', id).eq('user_id', currentUser.id);
    if (error) throw error;
  } else {
    const { error } = await supabaseClient.from('accounts').insert([{ ...record, created_at: new Date().toISOString() }]);
    if (error) throw error;
  }
}

async function deleteAccount(id) {
  const { count, error: countError } = await supabaseClient.from('voucher_entries').select('*', { count: 'exact', head: true }).eq('account_id', id);
  if (countError) throw countError;
  if (count > 0) throw new Error('Cannot delete: account has voucher entries');
  const { error } = await supabaseClient.from('accounts').delete().eq('id', id).eq('user_id', currentUser.id);
  if (error) throw error;
}

async function ensureCashAccount() {
  const existing = await supabaseClient.from('accounts').select('id').eq('user_id', currentUser.id).eq('name', 'Cash').maybeSingle();
  if (!existing?.data) {
    await saveAccount('Cash', 0, 'asset');
  }
}

async function getNextVoucherId() {
  const { data } = await supabaseClient.from('counters').select('next_value').eq('user_id', currentUser.id).eq('name', 'voucher_id').maybeSingle();
  if (!data) {
    await supabaseClient.from('counters').insert([{ user_id: currentUser.id, name: 'voucher_id', next_value: 2 }]);
    return 'V-001';
  }
  await supabaseClient.from('counters').update({ next_value: data.next_value + 1 }).eq('user_id', currentUser.id).eq('name', 'voucher_id');
  return `V-${String(data.next_value).padStart(3, '0')}`;
}

async function getVouchers(page = 0) {
  const offset = page * PAGE_SIZE;
  const { data, count, error } = await supabaseClient.from('vouchers').select('*', { count: 'exact' }).eq('user_id', currentUser.id).order('date', { ascending: false }).range(offset, offset + PAGE_SIZE - 1);
  if (error) throw error;
  return { data: data || [], total: count || 0 };
}

async function getVoucher(id) {
  const { data: voucher, error: vError } = await supabaseClient.from('vouchers').select('*').eq('id', id).eq('user_id', currentUser.id).single();
  if (vError) return null;
  const { data: entries, error: eError } = await supabaseClient.from('voucher_entries').select('*').eq('voucher_id', id).order('sn');
  if (eError) throw eError;
  return { ...voucher, entries: entries || [] };
}

async function saveVoucher(draft, targetStatus) {
  if (!draft?.date) throw new Error('Date required');
  if (!draft.entries?.length) throw new Error('At least one entry required');
  const debitTotal = draft.entries.reduce((s, e) => s + (Number(e.debit) || 0), 0);
  const creditTotal = draft.entries.reduce((s, e) => s + (Number(e.credit) || 0), 0);
  if (targetStatus === 'posted' && Math.abs(debitTotal - creditTotal) > 0.001) {
    throw new Error('Voucher must be balanced before posting');
  }
  if (draft.entries.some(e => !e.account_id)) throw new Error('All entries must have an account');

  let voucherId = draft.id;
  const payload = { user_id: currentUser.id, date: draft.date, status: targetStatus, updated_at: new Date().toISOString() };
  if (voucherId) {
    const { error } = await supabaseClient.from('vouchers').update(payload).eq('id', voucherId).eq('user_id', currentUser.id);
    if (error) throw error;
    await supabaseClient.from('voucher_entries').delete().eq('voucher_id', voucherId);
  } else {
    voucherId = await getNextVoucherId();
    const { error } = await supabaseClient.from('vouchers').insert([{ ...payload, id: voucherId, created_at: new Date().toISOString() }]);
    if (error) throw error;
  }

  const records = draft.entries.map((e, idx) => ({
    voucher_id: voucherId,
    user_id: currentUser.id,
    sn: idx + 1,
    account_id: e.account_id,
    narration: e.narration || null,
    debit: Number(e.debit) || 0,
    credit: Number(e.credit) || 0,
  }));
  const { error: insertError } = await supabaseClient.from('voucher_entries').insert(records);
  if (insertError) throw insertError;
}

async function deleteVoucher(id) {
  await supabaseClient.from('voucher_entries').delete().eq('voucher_id', id);
  const { error } = await supabaseClient.from('vouchers').delete().eq('id', id).eq('user_id', currentUser.id);
  if (error) throw error;
}

async function computeBalance(accountId, asOfDate = null) {
  const acc = await getAccount(accountId);
  if (!acc) return 0;
  let query = supabaseClient.from('voucher_entries').select('debit,credit,vouchers!inner(date,status)').eq('account_id', accountId).eq('vouchers.user_id', currentUser.id).eq('vouchers.status', 'posted');
  if (asOfDate) query = query.lte('vouchers.date', asOfDate);
  const { data, error } = await query;
  if (error) throw error;
  const totals = (data || []).reduce((sum, e) => {
    sum.debit += Number(e.debit) || 0;
    sum.credit += Number(e.credit) || 0;
    return sum;
  }, { debit: 0, credit: 0 });
  if (getNormalBalance(acc.type || 'asset') === 'debit') {
    return (Number(acc.opening_balance) || 0) + totals.debit - totals.credit;
  }
  return (Number(acc.opening_balance) || 0) + totals.credit - totals.debit;
}

async function getAccountLedger(accountId, fromDate = null, toDate = null) {
  let query = supabaseClient.from('voucher_entries').select('sn,narration,debit,credit,vouchers!inner(id,date,status,user_id)').eq('account_id', accountId).eq('vouchers.user_id', currentUser.id).eq('vouchers.status', 'posted');
  if (fromDate) query = query.gte('vouchers.date', fromDate);
  if (toDate) query = query.lte('vouchers.date', toDate);
  query = query.order('date', { referencedTable: 'vouchers', ascending: true }).order('sn', { ascending: true });
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

async function renderDashboard() {
  appState.currentTab = 'dashboard';
  document.getElementById('today-date').textContent = formatDate(new Date());
  const accounts = await getAllAccounts();
  appState.allAccounts = accounts;
  document.getElementById('dash-accounts').textContent = accounts.length;
  const cashAcc = accounts.find(a => a.name === 'Cash');
  const cashBalance = cashAcc ? await computeBalance(cashAcc.id) : 0;
  document.getElementById('dash-cash-balance').textContent = formatMoney(cashBalance);
  const { total: voucherCount } = await getVouchers(0);
  document.getElementById('dash-vouchers').textContent = voucherCount;
  const pinned = getPinnedAccounts();
  const pinnedAccs = accounts.filter(a => pinned.includes(a.id));
  if (pinnedAccs.length) {
    const cards = await Promise.all(pinnedAccs.map(async a => `<div class="pinned-card" data-account-id="${a.id}"><div class="pinned-name">${escapeHtml(a.name)}</div><div class="pinned-balance">${formatMoney(await computeBalance(a.id))}</div></div>`));
    document.getElementById('dash-pinned').innerHTML = cards.join('');
    document.getElementById('dash-pinned-section').style.display = 'block';
    document.querySelectorAll('.pinned-card').forEach(c => c.addEventListener('click', () => viewAccountLedger(c.dataset.accountId)));
  } else {
    document.getElementById('dash-pinned-section').style.display = 'none';
  }
  const { data: vouchers } = await getVouchers(0);
  document.getElementById('dash-recent').innerHTML = vouchers.slice(0, 5).map(v => `<div class="list-item" data-voucher-id="${v.id}"><div class="li-content"><div class="li-title">${escapeHtml(v.id)}</div><div class="li-subtitle">${formatDate(v.date)} (${escapeHtml(v.status || 'posted')})</div></div><div class="li-right"><button class="btn-icon" onclick="openVoucherView('${v.id}')"><svg width="16" height="16"><use href="#ic-edit"/></svg></button></div></div>`).join('') || '<p style="padding:12px;">No transactions yet</p>';
}

async function renderAccounts() {
  appState.currentTab = 'accounts';
  const accounts = await getAllAccounts();
  appState.allAccounts = accounts;
  const html = await Promise.all(accounts.map(async acc => {
    const balance = await computeBalance(acc.id);
    return `<div class="list-item"><div class="li-content" onclick="editAccount('${acc.id}')"><div class="li-title">${escapeHtml(acc.name)}</div><div class="li-subtitle">${escapeHtml((acc.type || 'asset').toUpperCase())} • Opening: ${formatMoney(acc.opening_balance || 0)}</div></div><div class="li-right"><div class="li-balance ${balance >= 0 ? 'positive' : 'negative'}">${formatMoney(balance)}</div><div class="li-actions"><button class="btn-icon" onclick="togglePin('${acc.id}'); renderAccounts()"><svg width='14' height='14'><use href='#ic-pin'/></svg></button><button class="btn-icon" onclick="deleteAccountConfirm('${acc.id}')"><svg width='14' height='14'><use href='#ic-trash'/></svg></button></div></div></div>`;
  }));
  document.getElementById('accounts-list').innerHTML = html.join('') || '<p style="padding:12px;">No accounts yet</p>';
}

async function renderTransactions() {
  appState.currentTab = 'transactions';
  const { data: vouchers } = await getVouchers(0);
  document.getElementById('vouchers-list').innerHTML = vouchers.map(v => `<div class="list-item" onclick="openVoucherView('${v.id}')"><div class="li-content"><div class="li-title">${escapeHtml(v.id)}</div><div class="li-subtitle">${formatDate(v.date)} • ${escapeHtml(v.status || 'posted')}</div></div><div class="li-right"><button class="btn-icon" onclick="event.stopPropagation();editVoucher('${v.id}')"><svg width='14' height='14'><use href='#ic-edit'/></svg></button></div></div>`).join('') || '<p style="padding:12px;">No vouchers yet</p>';
}

async function renderReports() {
  appState.currentTab = 'reports';
  appState.allAccounts = await getAllAccounts();
  const typeFilter = document.getElementById('report-account-type')?.value || 'all';
  const filtered = appState.allAccounts.filter(a => typeFilter === 'all' || (a.type || 'asset') === typeFilter);
  document.getElementById('report-accounts-list').innerHTML = filtered.map(a => `<option value="${escapeHtml(a.name)}">${escapeHtml(a.name)}</option>`).join('');
  const today = new Date();
  document.getElementById('report-to').valueAsDate = today;
  document.getElementById('report-from').valueAsDate = new Date(today.getFullYear(), today.getMonth(), 1);
}

function renderSettings() {
  appState.currentTab = 'settings';
}

function openModal(modalId) {
  document.getElementById('modal-overlay').classList.remove('hidden');
  document.getElementById(modalId).style.display = 'flex';
}

function closeModal(modalId) {
  document.getElementById(modalId).style.display = 'none';
  const overlay = document.getElementById('modal-overlay');
  if (![...document.querySelectorAll('.modal')].some(m => m.style.display === 'flex')) overlay.classList.add('hidden');
}

function openAccountModal(id = null) {
  appState.editingAccountId = id;
  document.getElementById('modal-account-title').textContent = id ? 'Edit Account' : 'New Account';
  document.getElementById('acc-name').value = '';
  document.getElementById('acc-opening').value = '';
  document.getElementById('acc-type').value = 'asset';
  if (id) {
    getAccount(id).then(acc => {
      if (!acc) return;
      document.getElementById('acc-name').value = acc.name;
      document.getElementById('acc-opening').value = acc.opening_balance || '';
      document.getElementById('acc-type').value = acc.type || 'asset';
    });
  }
  openModal('modal-account');
}

async function saveAccountClick() {
  const btn = document.getElementById('btn-save-account');
  setButtonLoading(btn, true);
  try {
    await saveAccount(document.getElementById('acc-name').value, document.getElementById('acc-opening').value, document.getElementById('acc-type').value, appState.editingAccountId);
    closeModal('modal-account');
    await renderAccounts();
    showToast(appState.editingAccountId ? 'Account updated' : 'Account created');
  } catch (err) {
    showToast(err.message || 'Error saving account', 'error');
  } finally {
    setButtonLoading(btn, false);
  }
}

function editAccount(id) {
  openAccountModal(id);
}

async function deleteAccountConfirm(id) {
  const acc = await getAccount(id);
  showConfirm(`Delete account "${acc?.name || ''}"?`, async () => {
    try {
      await deleteAccount(id);
      await renderAccounts();
      showToast('Account deleted');
    } catch (err) {
      showToast(err.message || 'Error deleting account', 'error');
    }
  });
}

function createEmptyVoucherDraft() {
  return { id: null, date: new Date().toISOString().split('T')[0], status: 'draft', entries: [] };
}

async function openVoucherModal(id = null) {
  appState.allAccounts = await getAllAccounts();
  appState.voucherDraft = createEmptyVoucherDraft();
  document.getElementById('modal-voucher-title').textContent = id ? 'Edit Voucher' : 'New Voucher';
  if (id) {
    const voucher = await getVoucher(id);
    if (!voucher) return;
    if (voucher.status === 'posted') {
      showToast('Posted vouchers are read-only', 'warning');
      return;
    }
    appState.voucherDraft = { id: voucher.id, date: voucher.date, status: voucher.status || 'draft', entries: voucher.entries.map(e => ({ account_id: e.account_id, narration: e.narration || '', debit: Number(e.debit) || 0, credit: Number(e.credit) || 0 })) };
  }
  document.getElementById('v-date').value = appState.voucherDraft.date;
  document.getElementById('v-id').value = appState.voucherDraft.id || 'Auto';
  renderEntriesTable();
  openModal('modal-voucher');
}

async function editVoucher(id) {
  await openVoucherModal(id);
}

function renderEntriesTable() {
  const entries = appState.voucherDraft?.entries || [];
  const rows = entries.map((e, idx) => {
    const acc = appState.allAccounts.find(a => a.id === e.account_id);
    return `<div class="entry-row"><div class="entry-sn">${idx + 1}</div><div>${escapeHtml(acc?.name || '')}</div><div>${escapeHtml(e.narration || '')}</div><div class="entry-debit">${e.debit ? formatMoney(e.debit) : '-'}</div><div class="entry-credit">${e.credit ? formatMoney(e.credit) : '-'}</div><button class="entry-remove" data-index="${idx}">×</button></div>`;
  }).join('');
  document.getElementById('voucher-entries').innerHTML = rows || '<div class="entry-row"><div class="entry-sn">-</div><div>No entries yet. Click "Add Entry".</div><div></div><div></div><div></div><div></div></div>';
  document.querySelectorAll('.entry-remove').forEach(btn => btn.addEventListener('click', () => {
    const idx = Number(btn.dataset.index);
    appState.voucherDraft.entries.splice(idx, 1);
    renderEntriesTable();
  }));
  checkBalance();
}

function checkBalance() {
  const entries = appState.voucherDraft?.entries || [];
  const debit = entries.reduce((s, e) => s + (Number(e.debit) || 0), 0);
  const credit = entries.reduce((s, e) => s + (Number(e.credit) || 0), 0);
  const diff = debit - credit;
  const row = document.getElementById('balance-check-row');
  const check = document.getElementById('balance-check');
  check.textContent = `Debit ${formatMoney(debit)} | Credit ${formatMoney(credit)} | Diff ${formatMoneyWithSign(diff)}`;
  row.classList.toggle('balanced', Math.abs(diff) < 0.001);
}

function openEntryModal() {
  const sel = document.getElementById('entry-account');
  sel.innerHTML = '<option value="">— Select Account —</option>' + appState.allAccounts.map(a => `<option value="${a.id}">${escapeHtml(a.name)} (${escapeHtml((a.type || 'asset').toUpperCase())})</option>`).join('');
  document.getElementById('entry-narration').value = '';
  document.getElementById('entry-debit').value = '';
  document.getElementById('entry-credit').value = '';
  document.getElementById('entry-debit').disabled = false;
  document.getElementById('entry-credit').disabled = false;
  openModal('modal-entry');
}

function syncDebitCreditInputs() {
  const debitInput = document.getElementById('entry-debit');
  const creditInput = document.getElementById('entry-credit');
  const debitValue = Number(debitInput.value) || 0;
  const creditValue = Number(creditInput.value) || 0;
  debitInput.disabled = creditValue > 0;
  creditInput.disabled = debitValue > 0;
  if (creditValue > 0) debitInput.value = '';
  if (debitValue > 0) creditInput.value = '';
}

function saveEntryFromModal(keepOpen = true) {
  const accountId = document.getElementById('entry-account').value;
  const narration = document.getElementById('entry-narration').value.trim();
  const debit = Number(document.getElementById('entry-debit').value) || 0;
  const credit = Number(document.getElementById('entry-credit').value) || 0;
  if (!accountId) return showToast('Choose account for entry', 'error');
  if ((debit > 0 && credit > 0) || (debit === 0 && credit === 0)) return showToast('Enter either debit or credit', 'error');
  appState.voucherDraft.entries.push({ account_id: accountId, narration, debit, credit });
  renderEntriesTable();
  if (keepOpen) {
    document.getElementById('entry-account').value = '';
    document.getElementById('entry-narration').value = '';
    document.getElementById('entry-debit').value = '';
    document.getElementById('entry-credit').value = '';
    document.getElementById('entry-debit').disabled = false;
    document.getElementById('entry-credit').disabled = false;
    document.getElementById('entry-account').focus();
  } else {
    closeModal('modal-entry');
  }
}

async function persistVoucher(status) {
  if (!appState.voucherDraft) return;
  appState.voucherDraft.date = document.getElementById('v-date').value;
  const btn = status === 'posted' ? document.getElementById('btn-post-voucher') : document.getElementById('btn-save-draft-voucher');
  setButtonLoading(btn, true);
  try {
    await saveVoucher(appState.voucherDraft, status);
    closeModal('modal-voucher');
    appState.voucherDraft = null;
    await renderTransactions();
    showToast(status === 'posted' ? 'Voucher posted' : 'Draft saved');
  } catch (err) {
    showToast(err.message || 'Error saving voucher', 'error');
  } finally {
    setButtonLoading(btn, false);
  }
}

async function openVoucherView(id) {
  appState.viewingVoucherId = id;
  const v = await getVoucher(id);
  if (!v) return showToast('Voucher not found', 'error');
  appState.allAccounts = await getAllAccounts();
  const names = Object.fromEntries(appState.allAccounts.map(a => [a.id, a.name]));
  const entriesHtml = v.entries.map(e => `<tr><td>${e.sn}</td><td>${escapeHtml(names[e.account_id] || '')}</td><td>${escapeHtml(e.narration || '')}</td><td style="text-align:right; color:var(--color-error)">${formatMoney(e.debit || 0)}</td><td style="text-align:right; color:var(--color-success)">${formatMoney(e.credit || 0)}</td></tr>`).join('');
  const debitTotal = v.entries.reduce((s, e) => s + (Number(e.debit) || 0), 0);
  const creditTotal = v.entries.reduce((s, e) => s + (Number(e.credit) || 0), 0);
  document.getElementById('modal-vview-body').innerHTML = `<div class="card"><div class="form-row"><div class="form-group"><label>Voucher</label><div>${escapeHtml(v.id)}</div></div><div class="form-group"><label>Date</label><div>${formatDate(v.date)}</div></div><div class="form-group"><label>Status</label><div>${escapeHtml(v.status || 'posted')}</div></div></div><table style="width:100%; border-collapse:collapse;"><thead><tr><th>#</th><th>Account</th><th>Narration</th><th style="text-align:right">Debit</th><th style="text-align:right">Credit</th></tr></thead><tbody>${entriesHtml}<tr><td colspan="3"><strong>Total</strong></td><td style="text-align:right"><strong>${formatMoney(debitTotal)}</strong></td><td style="text-align:right"><strong>${formatMoney(creditTotal)}</strong></td></tr></tbody></table></div>`;
  const editBtn = document.getElementById('btn-vview-edit');
  editBtn.disabled = (v.status || 'posted') === 'posted';
  editBtn.title = editBtn.disabled ? 'Posted vouchers are read-only' : 'Edit voucher';
  openModal('modal-voucher-view');
}

async function deleteVoucherConfirm() {
  showConfirm('Delete this voucher?', async () => {
    try {
      await deleteVoucher(appState.viewingVoucherId);
      closeModal('modal-voucher-view');
      await renderTransactions();
      showToast('Voucher deleted');
    } catch (err) {
      showToast(err.message || 'Error deleting voucher', 'error');
    }
  });
}

function showConfirm(message, callback) {
  confirmCallback = callback;
  document.getElementById('confirm-msg').textContent = message;
  openModal('modal-confirm');
}

async function generateReport() {
  const accountName = document.getElementById('report-account-text').value.trim();
  const accountType = document.getElementById('report-account-type').value;
  const fromDate = document.getElementById('report-from').value;
  const toDate = document.getElementById('report-to').value;
  const acc = appState.allAccounts.find(a => a.name === accountName && (accountType === 'all' || (a.type || 'asset') === accountType));
  if (!acc) return showToast('Select a valid account', 'error');
  const entries = await getAccountLedger(acc.id, fromDate, toDate);
  let balance = Number(acc.opening_balance) || 0;
  const normal = getNormalBalance(acc.type || 'asset');
  const rows = entries.map(e => {
    const debit = Number(e.debit) || 0;
    const credit = Number(e.credit) || 0;
    balance += normal === 'debit' ? (debit - credit) : (credit - debit);
    return `<tr><td>${formatDate(e.vouchers.date)}</td><td>${escapeHtml(e.vouchers.id)}</td><td>${escapeHtml(e.narration || '')}</td><td style="text-align:right">${formatMoney(debit)}</td><td style="text-align:right">${formatMoney(credit)}</td><td style="text-align:right">${formatMoney(balance)}</td></tr>`;
  });
  document.getElementById('report-output').innerHTML = `<div class="report-content" id="print-report"><h2>${escapeHtml(acc.name)} Ledger</h2><table style="width:100%; border-collapse:collapse; margin-top:12px;"><thead><tr><th>Date</th><th>Voucher</th><th>Narration</th><th style="text-align:right">Debit</th><th style="text-align:right">Credit</th><th style="text-align:right">Running</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
}

async function generateTrialBalance() {
  const toDate = document.getElementById('report-to').value || new Date().toISOString().split('T')[0];
  const accountType = document.getElementById('report-account-type').value;
  const accounts = (await getAllAccounts()).filter(a => accountType === 'all' || (a.type || 'asset') === accountType);
  const rows = [];
  let totalDebit = 0;
  let totalCredit = 0;
  for (const acc of accounts) {
    const bal = await computeBalance(acc.id, toDate);
    const normal = getNormalBalance(acc.type || 'asset');
    const debitBal = normal === 'debit' ? Math.max(0, bal) : Math.max(0, -bal);
    const creditBal = normal === 'credit' ? Math.max(0, bal) : Math.max(0, -bal);
    totalDebit += debitBal;
    totalCredit += creditBal;
    rows.push(`<tr><td>${escapeHtml(acc.name)}</td><td>${escapeHtml((acc.type || 'asset').toUpperCase())}</td><td style="text-align:right">${formatMoney(debitBal)}</td><td style="text-align:right">${formatMoney(creditBal)}</td></tr>`);
  }
  document.getElementById('report-output').innerHTML = `<div class="report-content" id="print-report"><h2>Trial Balance (as of ${formatDate(toDate)})</h2><table style="width:100%; border-collapse:collapse; margin-top:12px;"><thead><tr><th>Account</th><th>Type</th><th style="text-align:right">Debit</th><th style="text-align:right">Credit</th></tr></thead><tbody>${rows.join('')}<tr><td colspan="2"><strong>Total</strong></td><td style="text-align:right"><strong>${formatMoney(totalDebit)}</strong></td><td style="text-align:right"><strong>${formatMoney(totalCredit)}</strong></td></tr></tbody></table></div>`;
}

function exportPDF() {
  const element = document.getElementById('print-report');
  if (!element) return showToast('Generate report first', 'error');
  html2pdf().set({ margin: 10, filename: 'ledger-report.pdf', image: { type: 'png', quality: 0.98 }, html2canvas: { scale: 2 }, jsPDF: { orientation: 'landscape', unit: 'mm', format: 'a4' } }).from(element).save();
}

async function viewAccountLedger(accountId) {
  document.querySelector('[data-tab="reports"]').click();
  const acc = await getAccount(accountId);
  if (acc) {
    document.getElementById('report-account-text').value = acc.name;
    await generateReport();
  }
}

async function changePassword() {
  const newPass = document.getElementById('new-password').value;
  const confirmPass = document.getElementById('confirm-new-password').value;
  if (newPass !== confirmPass) return showToast('Passwords do not match', 'error');
  if ((newPass || '').length < 8) return showToast('Password must be at least 8 characters', 'error');
  const btn = document.getElementById('btn-change-password');
  setButtonLoading(btn, true);
  try {
    const { error } = await supabaseClient.auth.updateUser({ password: newPass });
    if (error) throw error;
    document.getElementById('new-password').value = '';
    document.getElementById('confirm-new-password').value = '';
    showToast('Password updated');
  } catch (err) {
    showToast(err.message || 'Error updating password', 'error');
  } finally {
    setButtonLoading(btn, false);
  }
}

function setupNav() {
  document.querySelectorAll('.nav-item, .bn-item').forEach(btn => btn.addEventListener('click', async () => {
    const tab = btn.dataset.tab;
    document.querySelectorAll('.nav-item, .bn-item').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
    document.getElementById(`tab-${tab}`).classList.add('active');
    if (tab === 'dashboard') await renderDashboard();
    if (tab === 'accounts') await renderAccounts();
    if (tab === 'transactions') await renderTransactions();
    if (tab === 'reports') await renderReports();
    if (tab === 'settings') renderSettings();
  }));
}

function setupModals() {
  document.querySelectorAll('[data-modal]').forEach(btn => btn.addEventListener('click', () => closeModal(btn.dataset.modal)));
  document.getElementById('btn-new-account').addEventListener('click', () => openAccountModal());
  document.getElementById('btn-save-account').addEventListener('click', saveAccountClick);
  document.getElementById('btn-new-voucher').addEventListener('click', () => openVoucherModal());
  document.getElementById('btn-add-entry').addEventListener('click', openEntryModal);
  document.getElementById('btn-save-entry').addEventListener('click', () => saveEntryFromModal(true));
  document.getElementById('btn-save-draft-voucher').addEventListener('click', () => persistVoucher('draft'));
  document.getElementById('btn-post-voucher').addEventListener('click', () => persistVoucher('posted'));
  document.getElementById('btn-vview-edit').addEventListener('click', async () => {
    closeModal('modal-voucher-view');
    await editVoucher(appState.viewingVoucherId);
  });
  document.getElementById('btn-vview-delete').addEventListener('click', deleteVoucherConfirm);
  document.getElementById('confirm-ok').addEventListener('click', () => {
    closeModal('modal-confirm');
    if (confirmCallback) confirmCallback();
  });
  document.getElementById('confirm-cancel').addEventListener('click', () => closeModal('modal-confirm'));
  document.getElementById('btn-generate-report').addEventListener('click', generateReport);
  document.getElementById('btn-generate-trial-balance').addEventListener('click', generateTrialBalance);
  document.getElementById('btn-print-report').addEventListener('click', exportPDF);
  document.getElementById('btn-change-password').addEventListener('click', changePassword);
  document.getElementById('btn-logout').addEventListener('click', logout);
  document.getElementById('btn-logout-top').addEventListener('click', logout);
  document.getElementById('btn-logout-settings').addEventListener('click', logout);
  document.getElementById('entry-debit').addEventListener('input', syncDebitCreditInputs);
  document.getElementById('entry-credit').addEventListener('input', syncDebitCreditInputs);
  document.getElementById('modal-overlay').addEventListener('click', e => {
    if (e.target.id === 'modal-overlay') {
      document.querySelectorAll('.modal').forEach(m => m.style.display = 'none');
      document.getElementById('modal-overlay').classList.add('hidden');
    }
  });
}

function setupSearch() {
  document.getElementById('account-search').addEventListener('input', async e => {
    const q = e.target.value.trim().toLowerCase();
    if (!q) return renderAccounts();
    const accounts = await getAllAccounts();
    const filtered = accounts.filter(a => a.name.toLowerCase().includes(q));
    const html = await Promise.all(filtered.map(async acc => `<div class="list-item"><div class="li-content" onclick="editAccount('${acc.id}')"><div class="li-title">${escapeHtml(acc.name)}</div></div><div class="li-right"><div class="li-balance">${formatMoney(await computeBalance(acc.id))}</div></div></div>`));
    document.getElementById('accounts-list').innerHTML = html.join('');
  });
  document.getElementById('voucher-search').addEventListener('input', async e => {
    const q = e.target.value.trim().toLowerCase();
    if (!q) return renderTransactions();
    const { data: vouchers } = await getVouchers(0);
    const filtered = vouchers.filter(v => v.id.toLowerCase().includes(q) || formatDate(v.date).toLowerCase().includes(q));
    document.getElementById('vouchers-list').innerHTML = filtered.map(v => `<div class="list-item" onclick="openVoucherView('${v.id}')"><div class="li-content"><div class="li-title">${escapeHtml(v.id)}</div><div class="li-subtitle">${formatDate(v.date)} • ${escapeHtml(v.status || 'posted')}</div></div></div>`).join('');
  });
  document.getElementById('report-account-type').addEventListener('change', () => {
    document.getElementById('report-account-text').value = '';
    renderReports();
  });
}

function setupKeyboardShortcuts() {
  document.addEventListener('keydown', e => {
    const voucherOpen = document.getElementById('modal-voucher').style.display === 'flex';
    const entryOpen = document.getElementById('modal-entry').style.display === 'flex';
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a' && voucherOpen) {
      e.preventDefault();
      openEntryModal();
    }
    if (e.key === 'Enter' && entryOpen) {
      e.preventDefault();
      saveEntryFromModal(true);
    }
    if (e.key === 'Escape') {
      if (entryOpen) closeModal('modal-entry');
      else if (voucherOpen) closeModal('modal-voucher');
      else if (document.getElementById('modal-voucher-view').style.display === 'flex') closeModal('modal-voucher-view');
    }
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  setupNav();
  setupModals();
  setupSearch();
  setupKeyboardShortcuts();
  document.getElementById('btn-auth-submit').addEventListener('click', submitAuth);
  await initSupabase();
});

