/* ═══════════════════════════════════════════════════════════════════
   Ledger — Personal Finance Application
   Production-Grade JavaScript Implementation
   ═══════════════════════════════════════════════════════════════════ */

// ═══════════════════════════════════════════════════════ CONFIG
const SUPABASE_URL = 'https://hubcmldbztdsxxqsoebo.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh1YmNtbGRienRkc3h4cXNvZWJvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ2MzA2MTcsImV4cCI6MjA5MDIwNjYxN30.jevxOC3NeKqM16MUCcpy4NznWH8DausdYcjyHsJcuu8';
const CURRENCY_SYMBOL = '₨';
const PAGE_SIZE = 20;
const PINNED_ACCOUNTS_KEY = 'ledger_pinned_accounts';

// ═══════════════════════════════════════════════════════ GLOBAL STATE
let supabaseClient = null;
let currentUser = null;
let currentTab = 'dashboard';
let currentPage = 0;
let confirmCallback = null;
let editingAccountId = null;
let editingVoucherId = null;
let viewingVoucherId = null;
let tempEntries = [];

// ═══════════════════════════════════════════════════════ PINNED ACCOUNTS
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

function setPinnedAccounts(ids) {
  localStorage.setItem(getPinnedKey(), JSON.stringify(ids));
}

function togglePin(accountId) {
  const pinned = getPinnedAccounts();
  const idx = pinned.indexOf(accountId);
  if (idx >= 0) {
    pinned.splice(idx, 1);
  } else {
    pinned.push(accountId);
  }
  setPinnedAccounts(pinned);
}

function isPinned(accountId) {
  return getPinnedAccounts().includes(accountId);
}

// ═══════════════════════════════════════════════════════ UTILITIES
function formatDate(date) {
  if (!date) return '';
  if (typeof date === 'string') date = new Date(date);
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatMoney(amount, sign = false) {
  if (!amount) amount = 0;
  const isNegative = amount < 0;
  const absAmount = Math.abs(amount);
  const formatted = absAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const result = `${CURRENCY_SYMBOL} ${formatted}`;
  return sign && isNegative ? `-${result}` : result;
}

function escapeHtml(text) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  return text.replace(/[&<>"']/g, m => map[m]);
}

function showToast(message, type = 'success') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = `toast ${type}`;
  setTimeout(() => toast.classList.add('hidden'), 3000);
}

function setButtonLoading(btn, loading) {
  btn.disabled = loading;
  if (loading) {
    btn.classList.add('btn-loading');
  } else {
    btn.classList.remove('btn-loading');
  }
}

// ═══════════════════════════════════════════════════════ SUPABASE INIT
async function initSupabase() {
  const { createClient } = window.supabase;
  supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // Auth listener
  supabaseClient.auth.onAuthStateChange((event, session) => {
    currentUser = session?.user || null;
    if (currentUser) {
      showApp();
      updateUserDisplay();
      if (event === 'SIGNED_IN') renderDashboard();
    } else {
      showAuthScreen();
    }
  });

  // Check initial session
  const { data: { session } } = await supabaseClient.auth.getSession();
  currentUser = session?.user || null;

  if (currentUser) {
    showApp();
    updateUserDisplay();
    renderDashboard();
  } else {
    showAuthScreen();
  }
}

// ═══════════════════════════════════════════════════════ AUTH
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
    form.innerHTML = `
      <input type="email" placeholder="Email" id="auth-email" />
      <input type="password" placeholder="Password" id="auth-password" />
    `;
    links.innerHTML = `
      <button data-mode="signup">Create Account</button>
      <button data-mode="forgot">Forgot Password?</button>
    `;
    submitBtn.textContent = 'Sign In';
  } else if (mode === 'signup') {
    title.textContent = 'Create Account';
    form.innerHTML = `
      <input type="email" placeholder="Email" id="auth-email" />
      <input type="password" placeholder="Password (min 8)" id="auth-password" />
      <input type="password" placeholder="Confirm Password" id="auth-password-confirm" />
    `;
    links.innerHTML = `
      <button data-mode="signin">Already have account?</button>
    `;
    submitBtn.textContent = 'Sign Up';
  } else if (mode === 'forgot') {
    title.textContent = 'Reset Password';
    form.innerHTML = `
      <input type="email" placeholder="Email" id="auth-email" />
    `;
    links.innerHTML = `
      <button data-mode="signin">Back to Sign In</button>
    `;
    submitBtn.textContent = 'Send Reset Link';
  }

  // Reattach event listeners
  form.querySelectorAll('input').forEach(inp => {
    inp.addEventListener('keypress', e => {
      if (e.key === 'Enter') submitAuth();
    });
  });

  links.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', e => {
      e.preventDefault();
      setAuthMode(btn.dataset.mode);
    });
  });
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
      if (password.length < 8) throw new Error('Password must be at least 8 characters');

      const { error } = await supabaseClient.auth.signUp({ email, password });
      if (error) throw error;
      errorDiv.textContent = 'Check your email to confirm signup.';
      errorDiv.style.background = 'var(--color-primary-light)';
      errorDiv.style.color = 'var(--color-primary)';
      errorDiv.style.display = 'block';
    } else if (mode === 'Reset Password') {
      const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}?mode=update-password`,
      });
      if (error) throw error;
      errorDiv.textContent = 'Check your email for reset link.';
      errorDiv.style.background = 'var(--color-primary-light)';
      errorDiv.style.color = 'var(--color-primary)';
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
  if (currentUser?.email) {
    document.getElementById('user-email').textContent = currentUser.email;
  }
}

async function logout() {
  await supabaseClient.auth.signOut();
  currentUser = null;
  showAuthScreen();
}

// ═══════════════════════════════════════════════════════ DATA LAYER — ACCOUNTS
async function getAccounts(page = 0) {
  try {
    const offset = page * PAGE_SIZE;
    const { data, count, error } = await supabaseClient
      .from('accounts')
      .select('*', { count: 'exact' })
      .eq('user_id', currentUser.id)
      .order('name')
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) throw error;
    return { data: data || [], total: count || 0 };
  } catch (err) {
    console.error('Error fetching accounts:', err);
    return { data: [], total: 0 };
  }
}

async function getAccount(id) {
  try {
    const { data, error } = await supabaseClient
      .from('accounts')
      .select('*')
      .eq('id', id)
      .eq('user_id', currentUser.id)
      .single();

    if (error) throw error;
    return data;
  } catch (err) {
    console.error('Error fetching account:', err);
    return null;
  }
}

async function saveAccount(name, openingBalance, id = null) {
  try {
    if (!name.trim()) throw new Error('Account name required');

    let record = {
      user_id: currentUser.id,
      name: name.trim(),
      opening_balance: parseFloat(openingBalance) || 0,
    };

    if (id) {
      const { error } = await supabaseClient
        .from('accounts')
        .update(record)
        .eq('id', id)
        .eq('user_id', currentUser.id);
      if (error) throw error;
    } else {
      const { error } = await supabaseClient.from('accounts').insert([record]);
      if (error) throw error;
    }

    return true;
  } catch (err) {
    console.error('Error saving account:', err);
    throw err;
  }
}

async function deleteAccount(id) {
  try {
    // Check if account used in any entries
    const { count, error: countError } = await supabaseClient
      .from('voucher_entries')
      .select('*', { count: 'exact' })
      .eq('account_id', id);

    if (countError) throw countError;
    if (count > 0) throw new Error('Cannot delete: Account has transactions');

    const { error } = await supabaseClient
      .from('accounts')
      .delete()
      .eq('id', id)
      .eq('user_id', currentUser.id);

    if (error) throw error;
    return true;
  } catch (err) {
    throw err;
  }
}

async function ensureCashAccount() {
  try {
    const { data, error } = await supabaseClient
      .from('accounts')
      .select('id')
      .eq('user_id', currentUser.id)
      .eq('name', 'Cash')
      .single();

    if (!data && !error) {
      // Cash account doesn't exist
      await saveAccount('Cash', 0);
    }
  } catch (err) {
    if (err.code !== 'PGRST116') console.error('Error ensuring cash account:', err);
  }
}

// ═══════════════════════════════════════════════════════ DATA LAYER — VOUCHERS
async function getNextVoucherId() {
  try {
    let { data, error } = await supabaseClient
      .from('counters')
      .select('next_value')
      .eq('user_id', currentUser.id)
      .eq('name', 'voucher_id')
      .single();

    if (!data) {
      // Create counter
      await supabaseClient.from('counters').insert([{
        user_id: currentUser.id,
        name: 'voucher_id',
        next_value: 1,
      }]);
      return 'V-001';
    }

    const nextVal = data.next_value;
    await supabaseClient
      .from('counters')
      .update({ next_value: nextVal + 1 })
      .eq('user_id', currentUser.id)
      .eq('name', 'voucher_id');

    return `V-${String(nextVal).padStart(3, '0')}`;
  } catch (err) {
    console.error('Error getting next voucher ID:', err);
    return null;
  }
}

async function getVouchers(page = 0) {
  try {
    const offset = page * PAGE_SIZE;
    const { data, count, error } = await supabaseClient
      .from('vouchers')
      .select('*', { count: 'exact' })
      .eq('user_id', currentUser.id)
      .order('date', { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) throw error;
    return { data: data || [], total: count || 0 };
  } catch (err) {
    console.error('Error fetching vouchers:', err);
    return { data: [], total: 0 };
  }
}

async function getVoucher(id) {
  try {
    const { data: voucher, error: vError } = await supabaseClient
      .from('vouchers')
      .select('*')
      .eq('id', id)
      .eq('user_id', currentUser.id)
      .single();

    if (vError) throw vError;

    const { data: entries, error: eError } = await supabaseClient
      .from('voucher_entries')
      .select('*')
      .eq('voucher_id', id)
      .order('sn');

    if (eError) throw eError;

    return { ...voucher, entries: entries || [] };
  } catch (err) {
    console.error('Error fetching voucher:', err);
    return null;
  }
}

async function saveVoucher(date, entries) {
  try {
    if (!date) throw new Error('Date required');
    if (entries.length === 0) throw new Error('At least one entry required');

    // Validate balance
    const debitTotal = entries.reduce((sum, e) => sum + (parseFloat(e.debit) || 0), 0);
    const creditTotal = entries.reduce((sum, e) => sum + (parseFloat(e.credit) || 0), 0);
    if (Math.abs(debitTotal - creditTotal) > 0.001) {
      throw new Error('Voucher not balanced (Debit ≠ Credit)');
    }

    // Validate all entries have account
    if (entries.some(e => !e.account_id)) {
      throw new Error('All entries must have an account');
    }

    // Validate insufficient balance
    for (const entry of entries) {
      const balance = await computeBalance(entry.account_id, date);
      if (balance + (parseFloat(entry.credit) || 0) - (parseFloat(entry.debit) || 0) < 0) {
        const acc = await getAccount(entry.account_id);
        throw new Error(`Insufficient balance in ${acc.name}`);
      }
    }

    let voucherId;
    if (editingVoucherId) {
      // Delete old entries
      await supabaseClient
        .from('voucher_entries')
        .delete()
        .eq('voucher_id', editingVoucherId);

      // Update voucher
      await supabaseClient
        .from('vouchers')
        .update({ date })
        .eq('id', editingVoucherId)
        .eq('user_id', currentUser.id);

      voucherId = editingVoucherId;
    } else {
      const newId = await getNextVoucherId();
      const { data, error } = await supabaseClient
        .from('vouchers')
        .insert([{ user_id: currentUser.id, id: newId, date }])
        .select()
        .single();

      if (error) throw error;
      voucherId = data.id;
    }

    // Insert entries
    const entryRecords = entries.map((e, idx) => ({
      voucher_id: voucherId,
      user_id: currentUser.id,
      sn: idx + 1,
      account_id: e.account_id,
      narration: e.narration?.trim() || null,
      debit: parseFloat(e.debit) || 0,
      credit: parseFloat(e.credit) || 0,
    }));

    const { error: insertError } = await supabaseClient
      .from('voucher_entries')
      .insert(entryRecords);

    if (insertError) throw insertError;
    return true;
  } catch (err) {
    throw err;
  }
}

async function deleteVoucher(id) {
  try {
    await supabaseClient
      .from('voucher_entries')
      .delete()
      .eq('voucher_id', id);

    const { error } = await supabaseClient
      .from('vouchers')
      .delete()
      .eq('id', id)
      .eq('user_id', currentUser.id);

    if (error) throw error;
    return true;
  } catch (err) {
    throw err;
  }
}

// ═══════════════════════════════════════════════════════ BALANCE & LEDGER
async function computeBalance(accountId, asOfDate = null) {
  try {
    const acc = await getAccount(accountId);
    if (!acc) return 0;

    let query = supabaseClient
      .from('voucher_entries')
      .select('debit, credit')
      .eq('account_id', accountId);

    if (asOfDate) {
      query = query.lte('created_at', new Date(asOfDate).toISOString());
    }

    const { data, error } = await query;
    if (error) throw error;

    let balance = acc.opening_balance || 0;
    if (data) {
      data.forEach(entry => {
        balance += (entry.credit || 0) - (entry.debit || 0);
      });
    }

    return balance;
  } catch (err) {
    console.error('Error computing balance:', err);
    return 0;
  }
}

async function getAccountLedger(accountId, fromDate = null, toDate = null) {
  try {
    const acc = await getAccount(accountId);
    if (!acc) return [];

    let query = supabaseClient
      .from('voucher_entries')
      .select('*, vouchers(date, id)')
      .eq('account_id', accountId);

    if (fromDate) query = query.gte('vouchers.date', fromDate);
    if (toDate) query = query.lte('vouchers.date', toDate);

    const { data, error } = await query.order('created_at');
    if (error) throw error;

    return data || [];
  } catch (err) {
    console.error('Error fetching ledger:', err);
    return [];
  }
}

// ═══════════════════════════════════════════════════════ RENDERING — DASHBOARD
async function renderDashboard() {
  try {
    currentPage = 0;
    currentTab = 'dashboard';

    // Update date
    const today = new Date();
    document.getElementById('today-date').textContent = formatDate(today);

    // Fetch accounts
    const { data: accounts } = await getAccounts(0);
    document.getElementById('dash-accounts').textContent = accounts.length;

    // Cash balance
    let cashBalance = 0;
    const cashAcc = accounts.find(a => a.name === 'Cash');
    if (cashAcc) {
      cashBalance = await computeBalance(cashAcc.id);
    }
    document.getElementById('dash-cash-balance').textContent = formatMoney(cashBalance);

    // Vouchers count
    const { total: voucherCount } = await getVouchers(0);
    document.getElementById('dash-vouchers').textContent = voucherCount;

    // Pinned accounts
    const pinnedIds = getPinnedAccounts();
    if (pinnedIds.length > 0) {
      const pinnedAccs = accounts.filter(a => pinnedIds.includes(a.id));
      const pinnedHtml = await Promise.all(pinnedAccs.map(async acc => `
        <div class="pinned-card" data-account-id="${acc.id}">
          <div class="pinned-name">${escapeHtml(acc.name)}</div>
          <div class="pinned-balance">${formatMoney(await computeBalance(acc.id))}</div>
        </div>
      `)).then(h => h.join(''));

      document.getElementById('dash-pinned').innerHTML = pinnedHtml;
      document.getElementById('dash-pinned-section').style.display = 'block';

      document.querySelectorAll('.pinned-card').forEach(card => {
        card.addEventListener('click', () => {
          const accId = card.dataset.accountId;
          viewAccountLedger(accId);
        });
      });
    } else {
      document.getElementById('dash-pinned-section').style.display = 'none';
    }

    // Recent transactions
    const { data: vouchers } = await getVouchers(0);
    const recentHtml = vouchers.slice(0, 5).map(v => `
      <div class="list-item" data-voucher-id="${v.id}">
        <div class="li-content">
          <div class="li-title">${escapeHtml(v.id)}</div>
          <div class="li-subtitle">${formatDate(v.date)}</div>
        </div>
        <div class="li-right">
          <button class="btn-icon" onclick="openVoucherView('${v.id}')">
            <svg width="16" height="16"><use href="#ic-edit"/></svg>
          </button>
        </div>
      </div>
    `).join('');

    document.getElementById('dash-recent').innerHTML = recentHtml || '<p style="padding:12px; color: var(--color-text-secondary);">No transactions yet</p>';
  } catch (err) {
    console.error('Error rendering dashboard:', err);
    showToast('Failed to load dashboard', 'error');
  }
}

// ═══════════════════════════════════════════════════════ RENDERING — ACCOUNTS
async function renderAccounts() {
  try {
    currentPage = 0;
    currentTab = 'accounts';

    const { data: accounts } = await getAccounts(currentPage);
    const listHtml = await Promise.all(accounts.map(async acc => {
      const balance = await computeBalance(acc.id);
      const pinned = isPinned(acc.id);

      return `
        <div class="list-item">
          <div class="li-content" onclick="editAccount('${acc.id}')">
            <div class="li-title">${escapeHtml(acc.name)}</div>
            <div class="li-subtitle">Opening: ${formatMoney(acc.opening_balance || 0)}</div>
          </div>
          <div class="li-right">
            <div class="li-balance ${balance >= 0 ? 'positive' : 'negative'}">${formatMoney(balance)}</div>
            <div class="li-actions">
              <button class="btn-icon ${pinned ? 'pin' : ''}" onclick="togglePin('${acc.id}'); renderAccounts()" title="Pin">
                <svg width="14" height="14"><use href="#ic-pin"/></svg>
              </button>
              <button class="btn-icon" onclick="deleteAccountConfirm('${acc.id}')">
                <svg width="14" height="14"><use href="#ic-trash"/></svg>
              </button>
            </div>
          </div>
        </div>
      `;
    }));

    document.getElementById('accounts-list').innerHTML = listHtml.join('') || '<p style="padding:12px;">No accounts yet</p>';
  } catch (err) {
    console.error('Error rendering accounts:', err);
    showToast('Failed to load accounts', 'error');
  }
}

// ═══════════════════════════════════════════════════════ RENDERING — TRANSACTIONS
async function renderTransactions() {
  try {
    currentPage = 0;
    currentTab = 'transactions';

    const { data: vouchers } = await getVouchers(currentPage);
    const listHtml = vouchers.map(v => `
      <div class="list-item" onclick="openVoucherView('${v.id}')">
        <div class="li-content">
          <div class="li-title">${escapeHtml(v.id)}</div>
          <div class="li-subtitle">${formatDate(v.date)}</div>
        </div>
        <div class="li-right">
          <button class="btn-icon" onclick="event.stopPropagation(); editVoucher('${v.id}')">
            <svg width="14" height="14"><use href="#ic-edit"/></svg>
          </button>
        </div>
      </div>
    `).join('');

    document.getElementById('vouchers-list').innerHTML = listHtml || '<p style="padding:12px;">No transactions yet</p>';
  } catch (err) {
    console.error('Error rendering transactions:', err);
    showToast('Failed to load transactions', 'error');
  }
}

// ═══════════════════════════════════════════════════════ RENDERING — REPORTS
async function renderReports() {
  try {
    currentTab = 'reports';

    const { data: accounts } = await getAccounts(0);
    const options = accounts
      .map(a => `<option value="${a.id}">${escapeHtml(a.name)}</option>`)
      .join('');

    document.getElementById('report-accounts-list').innerHTML = `
      ${accounts.map(a => `<option value="${escapeHtml(a.name)}">`).join('')}
    `;

    // Set date range
    const today = new Date();
    const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
    document.getElementById('report-from').valueAsDate = firstDay;
    document.getElementById('report-to').valueAsDate = today;
  } catch (err) {
    console.error('Error rendering reports:', err);
  }
}

// ═══════════════════════════════════════════════════════ RENDERING — SETTINGS
function renderSettings() {
  currentTab = 'settings';
  // Handled by HTML, just show the tab
}

// ═══════════════════════════════════════════════════════ MODALS
function openModal(modalId) {
  document.getElementById('modal-overlay').classList.remove('hidden');
  document.getElementById(modalId).style.display = 'flex';
}

function closeModal(modalId) {
  document.getElementById(modalId).style.display = 'none';
  const overlay = document.getElementById('modal-overlay');
  if (!overlay.querySelector('.modal[style*="display: flex"]')) {
    overlay.classList.add('hidden');
  }
}

function openAccountModal(id = null) {
  editingAccountId = id;
  document.getElementById('modal-account-title').textContent = id ? 'Edit Account' : 'New Account';
  document.getElementById('acc-name').value = '';
  document.getElementById('acc-opening').value = '';

  if (id) {
    getAccount(id).then(acc => {
      if (acc) {
        document.getElementById('acc-name').value = acc.name;
        document.getElementById('acc-opening').value = acc.opening_balance || '';
      }
    });
  }

  openModal('modal-account');
}

async function saveAccountClick() {
  const name = document.getElementById('acc-name').value;
  const opening = document.getElementById('acc-opening').value;
  const btn = document.querySelector('#modal-account .btn-primary');

  setButtonLoading(btn, true);

  try {
    await saveAccount(name, opening, editingAccountId);
    closeModal('modal-account');
    renderAccounts();
    showToast(editingAccountId ? 'Account updated' : 'Account created', 'success');
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
  showConfirm(`Delete account "${acc.name}"?`, async () => {
    try {
      await deleteAccount(id);
      renderAccounts();
      showToast('Account deleted', 'success');
    } catch (err) {
      showToast(err.message || 'Error deleting account', 'error');
    }
  });
}

// ═══════════════════════════════════════════════════════ VOUCHER MODAL
function openVoucherModal(id = null) {
  editingVoucherId = id;
  tempEntries = [];
  document.getElementById('modal-voucher-title').textContent = id ? 'Edit Voucher' : 'New Voucher';

  // Reset form
  const today = new Date().toISOString().split('T')[0];
  document.getElementById('v-date').value = today;
  document.getElementById('v-id').value = id || 'Auto';
  document.getElementById('voucher-entries').innerHTML = '';

  if (id) {
    getVoucher(id).then(v => {
      if (v) {
        document.getElementById('v-date').value = v.date;
        document.getElementById('v-id').value = v.id;
        tempEntries = v.entries.map(e => ({ ...e }));
        renderEntries();
      }
    });
  }

  openModal('modal-voucher');
}

async function editVoucher(id) {
  openVoucherModal(id);
}

function renderEntries() {
  const list = document.getElementById('voucher-entries');
  list.innerHTML = tempEntries.map((e, idx) => `
    <div class="entry-row">
      <div class="entry-sn">${idx + 1}</div>
      <select class="entry-account" data-index="${idx}">
        <option value="">— Select Account —</option>
      </select>
      <input type="text" class="entry-narration" data-index="${idx}" placeholder="Narration" value="${e.narration || ''}" />
      <input type="number" class="entry-debit" data-index="${idx}" placeholder="0.00" step="0.01" value="${e.debit || ''}" />
      <input type="number" class="entry-credit" data-index="${idx}" placeholder="0.00" step="0.01" value="${e.credit || ''}" />
      <button class="entry-remove" data-index="${idx}">×</button>
    </div>
  `).join('');

  // Populate account selects
  getAccounts(0).then(({ data: accounts }) => {
    document.querySelectorAll('.entry-account').forEach((sel, idx) => {
      const currentId = tempEntries[idx]?.account_id;
      sel.innerHTML = '<option value="">— Select Account —</option>' +
        accounts.map(a => `<option value="${a.id}" ${a.id === currentId ? 'selected' : ''}>${escapeHtml(a.name)}</option>`).join('');
    });
  });

  // Bind events
  document.querySelectorAll('.entry-account').forEach(sel => {
    sel.addEventListener('change', e => {
      tempEntries[parseInt(e.target.dataset.index)].account_id = e.target.value;
      checkBalance();
    });
  });

  document.querySelectorAll('.entry-narration').forEach(inp => {
    inp.addEventListener('change', e => {
      tempEntries[parseInt(e.target.dataset.index)].narration = e.target.value;
    });
  });

  document.querySelectorAll('.entry-debit').forEach(inp => {
    inp.addEventListener('change', e => {
      tempEntries[parseInt(e.target.dataset.index)].debit = parseFloat(e.target.value) || 0;
      checkBalance();
    });
  });

  document.querySelectorAll('.entry-credit').forEach(inp => {
    inp.addEventListener('change', e => {
      tempEntries[parseInt(e.target.dataset.index)].credit = parseFloat(e.target.value) || 0;
      checkBalance();
    });
  });

  document.querySelectorAll('.entry-remove').forEach(btn => {
    btn.addEventListener('click', e => {
      e.preventDefault();
      tempEntries.splice(parseInt(btn.dataset.index), 1);
      renderEntries();
    });
  });

  checkBalance();
}

function checkBalance() {
  const debit = tempEntries.reduce((s, e) => s + (e.debit || 0), 0);
  const credit = tempEntries.reduce((s, e) => s + (e.credit || 0), 0);
  const row = document.getElementById('balance-check-row');
  const check = document.getElementById('balance-check');

  if (Math.abs(debit - credit) < 0.001) {
    check.textContent = '✓ Balanced';
    row.classList.add('balanced');
  } else {
    check.textContent = `✗ Unbalanced (${formatMoneyWithSign(debit - credit)})`;
    row.classList.remove('balanced');
  }
}

function formatMoneyWithSign(amount) {
  const sign = amount >= 0 ? '+' : '−';
  return `${sign} ${formatMoney(Math.abs(amount))}`;
}

function addEntry() {
  tempEntries.push({ account_id: '', narration: '', debit: 0, credit: 0 });
  renderEntries();
}

async function saveVoucherClick() {
  if (tempEntries.length === 0) {
    showToast('Add at least one entry', 'error');
    return;
  }

  const date = document.getElementById('v-date').value;
  const btn = document.querySelector('#modal-voucher .btn-primary');

  setButtonLoading(btn, true);

  try {
    await saveVoucher(date, tempEntries);
    closeModal('modal-voucher');
    renderTransactions();
    showToast(editingVoucherId ? 'Voucher updated' : 'Voucher posted', 'success');
  } catch (err) {
    showToast(err.message || 'Error saving voucher', 'error');
  } finally {
    setButtonLoading(btn, false);
  }
}

async function openVoucherView(id) {
  viewingVoucherId = id;
  const v = await getVoucher(id);
  if (!v) {
    showToast('Voucher not found', 'error');
    return;
  }

  const accountNames = {};
  const { data: accounts } = await getAccounts(0);
  accounts.forEach(a => {
    accountNames[a.id] = a.name;
  });

  const entriesHtml = v.entries.map(e => `
    <tr>
      <td>${e.sn}</td>
      <td>${escapeHtml(accountNames[e.account_id] || '')}</td>
      <td>${escapeHtml(e.narration || '')}</td>
      <td style="text-align:right; color: var(--color-error)">${formatMoney(e.debit)}</td>
      <td style="text-align:right; color: var(--color-success)">${formatMoney(e.credit)}</td>
    </tr>
  `).join('');

  const debitTotal = v.entries.reduce((s, e) => s + (e.debit || 0), 0);
  const creditTotal = v.entries.reduce((s, e) => s + (e.credit || 0), 0);

  const html = `
    <div class="card">
      <div class="form-row">
        <div class="form-group">
          <label>Voucher ID</label>
          <div style="padding: 8px 12px; border: 1px solid var(--color-border); border-radius: 4px;">${escapeHtml(v.id)}</div>
        </div>
        <div class="form-group">
          <label>Date</label>
          <div style="padding: 8px 12px; border: 1px solid var(--color-border); border-radius: 4px;">${formatDate(v.date)}</div>
        </div>
      </div>

      <table style="width:100%; border-collapse:collapse; font-size:0.9rem;">
        <thead style="background: var(--color-bg-hover);">
          <tr>
            <th style="padding:8px; text-align:left; border-bottom:1px solid var(--color-border); font-weight:600">#</th>
            <th style="padding:8px; text-align:left; border-bottom:1px solid var(--color-border); font-weight:600">Account</th>
            <th style="padding:8px; text-align:left; border-bottom:1px solid var(--color-border); font-weight:600">Narration</th>
            <th style="padding:8px; text-align:right; border-bottom:1px solid var(--color-border); font-weight:600">Debit</th>
            <th style="padding:8px; text-align:right; border-bottom:1px solid var(--color-border); font-weight:600">Credit</th>
          </tr>
        </thead>
        <tbody>
          ${entriesHtml}
          <tr style="background: var(--color-bg-hover); font-weight:600;">
            <td colspan="3" style="padding:8px; border-top:2px solid var(--color-border);">Total</td>
            <td style="padding:8px; border-top:2px solid var(--color-border); text-align:right; color:var(--color-error)">${formatMoney(debitTotal)}</td>
            <td style="padding:8px; border-top:2px solid var(--color-border); text-align:right; color:var(--color-success)">${formatMoney(creditTotal)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  `;

  document.getElementById('modal-vview-body').innerHTML = html;
  openModal('modal-voucher-view');
}

async function deleteVoucherConfirm() {
  showConfirm('Delete this voucher?', async () => {
    try {
      await deleteVoucher(viewingVoucherId);
      closeModal('modal-voucher-view');
      renderTransactions();
      showToast('Voucher deleted', 'success');
    } catch (err) {
      showToast(err.message || 'Error deleting voucher', 'error');
    }
  });
}

// ═══════════════════════════════════════════════════════ CONFIRM DIALOG
function showConfirm(message, callback) {
  confirmCallback = callback;
  document.getElementById('confirm-msg').textContent = message;
  openModal('modal-confirm');
}

// ═══════════════════════════════════════════════════════ REPORT
async function generateReport() {
  const accountText = document.getElementById('report-account-text').value;
  const fromDate = document.getElementById('report-from').value;
  const toDate = document.getElementById('report-to').value;

  const { data: accounts } = await getAccounts(0);
  const acc = accounts.find(a => a.name === accountText);

  if (!acc) {
    showToast('Select a valid account', 'error');
    return;
  }

  try {
    const entries = await getAccountLedger(acc.id, fromDate, toDate);

    let balance = acc.opening_balance || 0;
    const rows = entries.map(e => {
      const debit = e.debit || 0;
      const credit = e.credit || 0;
      balance += credit - debit;

      return `
        <tr>
          <td>${formatDate(e.vouchers.date)}</td>
          <td>${escapeHtml(e.vouchers.id)}</td>
          <td>${escapeHtml(e.narration || '')}</td>
          <td style="text-align:right; color:var(--color-error)">${formatMoney(debit)}</td>
          <td style="text-align:right; color:var(--color-success)">${formatMoney(credit)}</td>
          <td style="text-align:right; font-weight:600">${formatMoney(balance)}</td>
        </tr>
      `;
    });

    const html = `
      <div class="report-content" id="print-report">
        <h2>${escapeHtml(acc.name)} — Ledger Report</h2>
        <p>Period: ${formatDate(fromDate)} to ${formatDate(toDate)}</p>

        <table style="width:100%; border-collapse:collapse; margin-top:20px; font-size:0.9rem;">
          <thead style="background:var(--color-bg-hover);">
            <tr>
              <th style="padding:8px; text-align:left; border:1px solid var(--color-border); font-weight:600">Date</th>
              <th style="padding:8px; text-align:left; border:1px solid var(--color-border); font-weight:600">Voucher ID</th>
              <th style="padding:8px; text-align:left; border:1px solid var(--color-border); font-weight:600">Narration</th>
              <th style="padding:8px; text-align:right; border:1px solid var(--color-border); font-weight:600">Debit</th>
              <th style="padding:8px; text-align:right; border:1px solid var(--color-border); font-weight:600">Credit</th>
              <th style="padding:8px; text-align:right; border:1px solid var(--color-border); font-weight:600">Balance</th>
            </tr>
          </thead>
          <tbody>
            ${rows.join('')}
          </tbody>
        </table>
      </div>
    `;

    document.getElementById('report-output').innerHTML = html;
  } catch (err) {
    showToast('Error generating report', 'error');
  }
}

function exportPDF() {
  const element = document.getElementById('print-report');
  if (!element) {
    showToast('Generate report first', 'error');
    return;
  }

  const opt = {
    margin: 10,
    filename: 'ledger-report.pdf',
    image: { type: 'png', quality: 0.98 },
    html2canvas: { scale: 2 },
    jsPDF: { orientation: 'landscape', unit: 'mm', format: 'a4' },
  };

  html2pdf().set(opt).from(element).save();
}

// ═══════════════════════════════════════════════════════ VIEW LEDGER
async function viewAccountLedger(accountId) {
  const acc = await getAccount(accountId);
  if (!acc) return;

  const entries = await getAccountLedger(accountId);
  let balance = acc.opening_balance || 0;

  const rows = entries.map(e => {
    const debit = e.debit || 0;
    const credit = e.credit || 0;
    balance += credit - debit;

    return `
      <tr>
        <td>${formatDate(e.vouchers.date)}</td>
        <td>${escapeHtml(e.vouchers.id)}</td>
        <td style="text-align:right; color:var(--color-error)">${formatMoney(debit)}</td>
        <td style="text-align:right; color:var(--color-success)">${formatMoney(credit)}</td>
        <td style="text-align:right; font-weight:600">${formatMoney(balance)}</td>
      </tr>
    `;
  });

  const html = `
    <div class="card">
      <h3>${escapeHtml(acc.name)} — Ledger</h3>
      <table style="width:100%; border-collapse:collapse; margin-top:12px; font-size:0.875rem;">
        <thead style="background:var(--color-bg-hover);">
          <tr>
            <th style="padding:6px; text-align:left; border:1px solid var(--color-border); font-weight:600">Date</th>
            <th style="padding:6px; text-align:left; border:1px solid var(--color-border); font-weight:600">Voucher</th>
            <th style="padding:6px; text-align:right; border:1px solid var(--color-border); font-weight:600">Debit</th>
            <th style="padding:6px; text-align:right; border:1px solid var(--color-border); font-weight:600">Credit</th>
            <th style="padding:6px; text-align:right; border:1px solid var(--color-border); font-weight:600">Balance</th>
          </tr>
        </thead>
        <tbody>
          ${rows.join('')}
        </tbody>
      </table>
    </div>
  `;

  document.getElementById('report-output').innerHTML = html;
  document.querySelector('[data-tab="reports"]').click();
}

// ═══════════════════════════════════════════════════════ CHANGE PASSWORD
async function changePassword() {
  const newPass = document.getElementById('new-password').value;
  const confirmPass = document.getElementById('confirm-new-password').value;
  const btn = document.getElementById('btn-change-password');

  if (newPass !== confirmPass) {
    showToast('Passwords do not match', 'error');
    return;
  }

  if (newPass.length < 8) {
    showToast('Password must be at least 8 characters', 'error');
    return;
  }

  setButtonLoading(btn, true);

  try {
    const { error } = await supabaseClient.auth.updateUser({ password: newPass });
    if (error) throw error;

    document.getElementById('new-password').value = '';
    document.getElementById('confirm-new-password').value = '';
    showToast('Password updated successfully', 'success');
  } catch (err) {
    showToast(err.message || 'Error updating password', 'error');
  } finally {
    setButtonLoading(btn, false);
  }
}

// ═══════════════════════════════════════════════════════ EVENT SETUP
function setupNav() {
  document.querySelectorAll('.nav-item, .bn-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      document.querySelectorAll('.nav-item, .bn-item').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
      document.getElementById(`tab-${tab}`).classList.add('active');

      if (tab === 'dashboard') renderDashboard();
      else if (tab === 'accounts') renderAccounts();
      else if (tab === 'transactions') renderTransactions();
      else if (tab === 'reports') renderReports();
      else if (tab === 'settings') renderSettings();
    });
  });
}

function setupModals() {
  document.querySelectorAll('[data-modal]').forEach(btn => {
    btn.addEventListener('click', () => {
      closeModal(btn.dataset.modal);
    });
  });

  document.getElementById('btn-new-account').addEventListener('click', () => openAccountModal());
  document.getElementById('btn-save-account').addEventListener('click', saveAccountClick);

  document.getElementById('btn-new-voucher').addEventListener('click', () => openVoucherModal());
  document.getElementById('btn-add-entry').addEventListener('click', addEntry);
  document.getElementById('btn-save-voucher').addEventListener('click', saveVoucherClick);

  document.getElementById('btn-vview-edit').addEventListener('click', () => {
    closeModal('modal-voucher-view');
    editVoucher(viewingVoucherId);
  });

  document.getElementById('btn-vview-delete').addEventListener('click', deleteVoucherConfirm);

  document.getElementById('confirm-ok').addEventListener('click', () => {
    closeModal('modal-confirm');
    if (confirmCallback) confirmCallback();
  });

  document.getElementById('confirm-cancel').addEventListener('click', () => {
    closeModal('modal-confirm');
  });

  document.getElementById('btn-generate-report').addEventListener('click', generateReport);
  document.getElementById('btn-print-report').addEventListener('click', exportPDF);

  document.getElementById('btn-change-password').addEventListener('click', changePassword);

  document.getElementById('btn-logout').addEventListener('click', logout);
  document.getElementById('btn-logout-top').addEventListener('click', logout);
  document.getElementById('btn-logout-settings').addEventListener('click', logout);
}

function setupSearch() {
  document.getElementById('account-search').addEventListener('input', async (e) => {
    const query = e.target.value.toLowerCase();
    if (!query) {
      renderAccounts();
      return;
    }

    const { data: accounts } = await getAccounts(0);
    const filtered = accounts.filter(a => a.name.toLowerCase().includes(query));
    const listHtml = await Promise.all(filtered.map(async acc => {
      const balance = await computeBalance(acc.id);
      return `
        <div class="list-item">
          <div class="li-content" onclick="editAccount('${acc.id}')">
            <div class="li-title">${escapeHtml(acc.name)}</div>
          </div>
          <div class="li-right">
            <div class="li-balance ${balance >= 0 ? 'positive' : 'negative'}">${formatMoney(balance)}</div>
          </div>
        </div>
      `;
    }));
    document.getElementById('accounts-list').innerHTML = listHtml.join('');
  });

  document.getElementById('voucher-search').addEventListener('input', async (e) => {
    const query = e.target.value.toLowerCase();
    if (!query) {
      renderTransactions();
      return;
    }

    const { data: vouchers } = await getVouchers(0);
    const filtered = vouchers.filter(v =>
      v.id.toLowerCase().includes(query) ||
      formatDate(v.date).toLowerCase().includes(query)
    );

    const listHtml = filtered.map(v => `
      <div class="list-item" onclick="openVoucherView('${v.id}')">
        <div class="li-content">
          <div class="li-title">${escapeHtml(v.id)}</div>
          <div class="li-subtitle">${formatDate(v.date)}</div>
        </div>
      </div>
    `).join('');

    document.getElementById('vouchers-list').innerHTML = listHtml;
  });
}

// ═══════════════════════════════════════════════════════ INIT APP
document.addEventListener('DOMContentLoaded', async () => {
  setupNav();
  setupModals();
  setupSearch();

  document.getElementById('btn-auth-submit').addEventListener('click', submitAuth);

  await initSupabase();

  // After auth, ensure cash account and render dashboard
  if (currentUser) {
    await ensureCashAccount();
    renderDashboard();
  }
});

// Close modal overlay when clicking outside
document.getElementById('modal-overlay')?.addEventListener('click', (e) => {
  if (e.target.id === 'modal-overlay') {
    document.getElementById('modal-overlay').classList.add('hidden');
    document.querySelectorAll('.modal').forEach(m => m.style.display = 'none');
  }
});
