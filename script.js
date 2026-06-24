const menuToggle = document.querySelector('.menu-toggle');
const topNav = document.querySelector('.top-nav');
const loginForm = document.getElementById('login-form');
const signupForm = document.getElementById('signup-form');
const itemForm = document.getElementById('item-form');
const loginCard = document.getElementById('login-card');
const vaultCard = document.getElementById('vault-card');
const logoutBtn = document.getElementById('logout-btn');
const savedItemsList = document.getElementById('saved-items');
const authStatus = document.getElementById('auth-status');
const googleBtn = document.getElementById('google-btn');
const panelTitle = document.getElementById('panel-title');
const modeButtons = document.querySelectorAll('.toggle-btn');
const adminToggle = document.getElementById('admin-toggle');
const adminContent = document.getElementById('admin-content');
const adminTitle = document.getElementById('admin-title');
const adminHint = document.getElementById('admin-hint');
const adminUsersList = document.getElementById('admin-users');
const userSummary = document.getElementById('user-summary');
const itemFilter = document.getElementById('item-filter');
const itemIdInput = document.getElementById('item-id');
const itemSubmitBtn = document.getElementById('item-submit-btn');
const itemCancelBtn = document.getElementById('item-cancel-btn');
const appContent = document.getElementById('app-content');

const ACCESS_KEY = 'du557_private_session';
const ITEMS_PREFIX = 'du557_items_';
const SESSION_DURATION_MS = 30 * 60 * 1000;
const ADMIN_EMAILS = (window.ADMIN_EMAILS || []).map((email) => String(email).trim().toLowerCase());

// Estado da sessão atual (somente o próprio usuário).
let currentUser = null; // { uid, email, name, provider }
let currentItems = [];
let adminUsers = {}; // populado apenas para admin a partir de /users

if (logoutBtn) {
  logoutBtn.hidden = true;
}

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function maskEmail(value = '') {
  const email = String(value).trim().toLowerCase();
  if (!email.includes('@')) return 'usuário';
  const [local, domain] = email.split('@');
  if (!local || !domain) return 'usuário';
  return `${local.slice(0, 2)}***@${domain}`;
}

function isAdmin(email) {
  return ADMIN_EMAILS.includes(String(email || '').toLowerCase());
}

function getItemsKey(uid) {
  return `${ITEMS_PREFIX}${uid}`;
}

// ---- Sessão (sessionStorage, com expiração) ----
function getCurrentSession() {
  const raw = sessionStorage.getItem(ACCESS_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed?.uid) return null;
    if (parsed.expiresAt && Date.now() > parsed.expiresAt) {
      sessionStorage.removeItem(ACCESS_KEY);
      return null;
    }
    return parsed;
  } catch (error) {
    sessionStorage.removeItem(ACCESS_KEY);
    return null;
  }
}

function saveSession(user) {
  sessionStorage.setItem(ACCESS_KEY, JSON.stringify({
    uid: user.uid,
    email: String(user.email || '').toLowerCase(),
    issuedAt: Date.now(),
    expiresAt: Date.now() + SESSION_DURATION_MS
  }));
}

function clearSession() {
  sessionStorage.removeItem(ACCESS_KEY);
}

// ---- Cache local por usuário (uid) ----
function getCachedItems(uid) {
  const raw = localStorage.getItem(getItemsKey(uid));
  try {
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

function setCachedItems(uid, items) {
  localStorage.setItem(getItemsKey(uid), JSON.stringify(items));
}

// ---- Firebase (sempre por uid) ----
async function fbSet(path, payload) {
  if (!window.firebaseDb || !window.firebaseRefs) return;
  try {
    const { ref, set } = window.firebaseRefs;
    await set(ref(window.firebaseDb, path), payload);
  } catch (error) {
    console.warn(`Não foi possível gravar em ${path}.`, error);
    if (authStatus) authStatus.textContent = 'A sincronização ficou indisponível por enquanto.';
  }
}

async function fbGet(path) {
  if (!window.firebaseDb || !window.firebaseRefs) return null;
  try {
    const { ref, get } = window.firebaseRefs;
    const snap = await get(ref(window.firebaseDb, path));
    return snap.exists() ? snap.val() : null;
  } catch (error) {
    console.warn(`Não foi possível ler ${path}.`, error);
    return null;
  }
}

async function saveProfile(user, fallbackName = '') {
  const uid = user.uid;
  const email = String(user.email || '').toLowerCase();
  const name = fallbackName || user.displayName || email.split('@')[0] || 'Usuário';
  const profile = {
    name,
    email,
    provider: user.providerData?.[0]?.providerId || 'firebase',
    lastLoginAt: new Date().toISOString()
  };
  currentUser = { uid, email, name, provider: profile.provider };
  await fbSet(`users/${uid}`, profile);
  return profile;
}

async function addLoginLog(uid, source = 'local') {
  if (!window.firebaseDb || !window.firebaseRefs) return;
  const log = (await fbGet(`loginLog/${uid}`)) || [];
  const entries = Array.isArray(log) ? log : [];
  entries.unshift({ source, time: new Date().toLocaleString('pt-BR') });
  await fbSet(`loginLog/${uid}`, entries.slice(0, 20));
}

async function loadItemsForUser(uid) {
  const cached = getCachedItems(uid);
  const remote = await fbGet(`items/${uid}`);
  const items = Array.isArray(remote?.items) ? remote.items : (Array.isArray(remote) ? remote : cached);
  currentItems = items;
  setCachedItems(uid, items);
  return items;
}

async function saveItemsForUser(uid, items) {
  currentItems = items;
  setCachedItems(uid, items);
  await fbSet(`items/${uid}`, { items, updatedAt: Date.now() });
}

// Admin: tenta ler /users (só funciona se as regras permitirem o admin).
async function loadAdminUsers() {
  const payload = await fbGet('users');
  if (!payload || typeof payload !== 'object') {
    adminUsers = {};
    return adminUsers;
  }
  adminUsers = Object.fromEntries(
    Object.entries(payload).map(([uid, user]) => [uid, user || {}])
  );
  return adminUsers;
}

if (menuToggle && topNav) {
  menuToggle.addEventListener('click', () => {
    topNav.classList.toggle('open');
  });
}

async function verifyCredentials(email, password) {
  if (!window.firebaseAuth || !window.firebaseAuthHelpers) return null;
  try {
    const credential = await window.firebaseAuthHelpers.signInWithEmailAndPassword(window.firebaseAuth, email, password);
    return credential.user || null;
  } catch (error) {
    console.warn('Falha no login com e-mail.', error);
    return null;
  }
}

async function createAccount(name, email, password) {
  if (!window.firebaseAuth || !window.firebaseAuthHelpers) {
    throw new Error('Firebase Auth não inicializado.');
  }
  const credential = await window.firebaseAuthHelpers.createUserWithEmailAndPassword(window.firebaseAuth, email, password);
  if (!credential.user) throw new Error('Não foi possível criar a conta.');
  await saveProfile(credential.user, name);
  return credential.user;
}

function renderAccountSummary() {
  if (!userSummary || !currentUser) return;
  userSummary.className = 'user-summary';
  userSummary.innerHTML = `
    <strong>${escapeHtml(currentUser.name || currentUser.email)}</strong>
    <span>${escapeHtml(maskEmail(currentUser.email))}</span>
    <span>Login via: ${escapeHtml(currentUser.provider || 'firebase')}</span>
    <span>Itens salvos: ${currentItems.length}</span>
  `;
}

async function renderAdminPanel() {
  const admin = currentUser && isAdmin(currentUser.email);

  if (adminTitle) adminTitle.textContent = admin ? 'Painel Admin' : 'Minha conta';
  if (adminHint) {
    adminHint.textContent = admin
      ? 'Visão geral de usuários cadastrados (acesso restrito ao admin).'
      : 'Seus dados de acesso.';
  }

  renderAccountSummary();

  if (!adminUsersList) return;

  if (!admin) {
    adminUsersList.innerHTML = `
      <li class="saved-item">
        <div>
          <strong>Sessão protegida</strong>
          <span>Seus dados ficam restritos à sua conta (uid ${escapeHtml(currentUser.uid.slice(0, 6))}…).</span>
        </div>
      </li>
    `;
    return;
  }

  await loadAdminUsers();
  const entries = Object.entries(adminUsers);
  const list = entries.map(([uid, user]) => `
    <li class="saved-item">
      <div>
        <strong>${escapeHtml(user.name || 'Sem nome')}</strong>
        <div class="meta-row">
          <span>${escapeHtml(maskEmail(user.email || ''))}</span>
          <span>${escapeHtml(user.provider || 'firebase')}</span>
        </div>
        <span>Último acesso: ${escapeHtml(user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString('pt-BR') : '—')}</span>
      </div>
    </li>
  `).join('');

  adminUsersList.innerHTML = `
    <div class="dashboard-grid">
      <div class="dashboard-card">
        <strong>${entries.length}</strong>
        <span>Usuários</span>
      </div>
    </div>
    ${list || '<li class="saved-empty">Nenhum usuário ainda.</li>'}
  `;
}

function renderItems() {
  if (!savedItemsList) return;
  const filter = itemFilter ? itemFilter.value : 'all';
  const visibleItems = currentItems.filter((item) => filter === 'all' || (item.tag || '').toLowerCase().includes(filter));

  if (!visibleItems.length) {
    savedItemsList.innerHTML = '<li class="saved-empty">Nenhum item salvo ainda.</li>';
    return;
  }

  savedItemsList.innerHTML = visibleItems.map((item) => `
    <li class="saved-item${item.favorite ? ' favorite' : ''}">
      <div>
        <strong>${escapeHtml(item.name)}</strong>
        <div class="meta-row">
          <span>${escapeHtml(item.tag || 'item')}</span>
          <span>${item.favorite ? '★ Favorito' : '☆ Padrão'}</span>
        </div>
        <span>${escapeHtml(item.notes || 'Sem descrição')}</span>
      </div>
      <div>
        <button type="button" data-favorite="${item.id}">${item.favorite ? 'Desfavoritar' : 'Favoritar'}</button>
        <button type="button" data-edit="${item.id}">Editar</button>
        <button type="button" data-copy="${item.id}">Copiar</button>
        <button type="button" data-id="${item.id}">Excluir</button>
      </div>
    </li>
  `).join('');
}

function resetItemForm() {
  if (!itemForm) return;
  itemForm.reset();
  if (itemIdInput) itemIdInput.value = '';
  if (itemSubmitBtn) itemSubmitBtn.textContent = 'Salvar item';
  if (itemCancelBtn) itemCancelBtn.hidden = true;
}

async function showVault() {
  loginCard.hidden = true;
  vaultCard.hidden = false;
  logoutBtn.hidden = false;
  if (appContent) appContent.hidden = false;
  if (panelTitle) panelTitle.textContent = 'Painel privado';
  document.body.classList.remove('locked-view');
  await loadItemsForUser(currentUser.uid);
  await renderAdminPanel();
  renderItems();
}

function showLogin(message = '') {
  loginCard.hidden = false;
  vaultCard.hidden = true;
  if (logoutBtn) logoutBtn.hidden = true;
  if (appContent) appContent.hidden = true;
  if (panelTitle) panelTitle.textContent = 'Entrar';
  document.body.classList.add('locked-view');
  if (message && authStatus) authStatus.textContent = message;
}

function initAuthStateListener() {
  if (!window.firebaseAuth || !window.firebaseAuthHelpers) {
    showLogin('Acesso privado. Entre ou crie sua conta.');
    return;
  }

  window.firebaseAuthHelpers.onAuthStateChanged(window.firebaseAuth, async (user) => {
    if (!user) {
      currentUser = null;
      currentItems = [];
      clearSession();
      showLogin('Acesso privado. Entre ou crie sua conta.');
      return;
    }

    saveSession(user);
    await saveProfile(user, user.displayName || '');
    await addLoginLog(user.uid, currentUser.provider);
    await showVault();
  });
}

if (loginForm) {
  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const email = document.getElementById('login-email').value.trim().toLowerCase();
    const password = document.getElementById('login-password').value;
    const user = await verifyCredentials(email, password);

    if (!user) {
      authStatus.textContent = 'E-mail ou senha inválidos.';
      return;
    }
    authStatus.textContent = 'Login realizado com sucesso.';
    // onAuthStateChanged cuida do restante (sessão, perfil, vault).
  });
}

if (signupForm) {
  signupForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = document.getElementById('signup-name').value.trim();
    const email = document.getElementById('signup-email').value.trim().toLowerCase();
    const password = document.getElementById('signup-password').value;

    if (!name || !email || !password) {
      authStatus.textContent = 'Preencha todos os campos.';
      return;
    }

    try {
      await createAccount(name, email, password);
      authStatus.textContent = 'Conta criada com sucesso.';
    } catch (error) {
      authStatus.textContent = error.message || 'Não foi possível criar a conta.';
    }
  });
}

if (logoutBtn) {
  logoutBtn.addEventListener('click', async () => {
    if (window.firebaseAuth && window.firebaseAuthHelpers) {
      await window.firebaseAuthHelpers.signOut(window.firebaseAuth);
    }
    clearSession();
    showLogin('Sessão encerrada.');
  });
}

if (adminToggle && adminContent) {
  adminToggle.addEventListener('click', () => {
    const open = adminContent.hidden;
    adminContent.hidden = !open;
    adminToggle.textContent = open ? 'Ocultar' : 'Mostrar';
  });
}

modeButtons.forEach((button) => {
  button.addEventListener('click', () => {
    modeButtons.forEach((btn) => {
      btn.classList.remove('active');
      btn.setAttribute('aria-selected', 'false');
    });
    button.classList.add('active');
    button.setAttribute('aria-selected', 'true');

    const mode = button.dataset.mode;
    if (!loginForm || !signupForm) return;

    if (mode === 'signup') {
      loginForm.hidden = true;
      signupForm.hidden = false;
      if (panelTitle) panelTitle.textContent = 'Criar conta';
      signupForm.querySelector('input')?.focus();
    } else {
      loginForm.hidden = false;
      signupForm.hidden = true;
      if (panelTitle) panelTitle.textContent = 'Entrar';
      loginForm.querySelector('input')?.focus();
    }
  });
});

if (googleBtn) {
  googleBtn.addEventListener('click', async () => {
    if (!window.firebaseAuth || !window.firebaseAuthHelpers) {
      authStatus.textContent = 'Firebase Auth não está pronto.';
      return;
    }
    const provider = new window.firebaseAuthHelpers.GoogleAuthProvider();
    try {
      await window.firebaseAuthHelpers.signInWithPopup(window.firebaseAuth, provider);
      authStatus.textContent = 'Login com Google realizado.';
    } catch (error) {
      const message = error?.message || '';
      if (message.includes('unauthorized-domain') || message.includes('domain')) {
        authStatus.textContent = 'Domínio não autorizado para login com Google.';
      } else {
        authStatus.textContent = 'Não foi possível entrar com o Google.';
      }
    }
  });
}

if (itemForm && savedItemsList) {
  itemForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const session = getCurrentSession();
    if (!session || !currentUser) {
      showLogin('Entre para salvar itens.');
      return;
    }

    const name = document.getElementById('item-name').value.trim();
    const tag = document.getElementById('item-tag').value.trim();
    const notes = document.getElementById('item-notes').value.trim();
    const editingId = itemIdInput && itemIdInput.value ? Number(itemIdInput.value) : null;
    if (!name) return;

    const items = currentItems.slice();
    if (editingId) {
      const index = items.findIndex((item) => item.id === editingId);
      if (index >= 0) items[index] = { ...items[index], name, tag, notes };
    } else {
      items.unshift({ id: Date.now(), name, tag, notes, favorite: false });
    }

    await saveItemsForUser(currentUser.uid, items);
    renderItems();
    renderAccountSummary();
    authStatus.textContent = editingId ? `Item atualizado: ${name}` : `Item salvo: ${name}`;
    resetItemForm();
  });

  savedItemsList.addEventListener('click', async (event) => {
    const target = event.target;
    if (target.tagName !== 'BUTTON') return;
    if (!currentUser) return;
    const uid = currentUser.uid;

    if (target.dataset.edit) {
      const id = Number(target.dataset.edit);
      const item = currentItems.find((entry) => entry.id === id);
      if (item) {
        document.getElementById('item-name').value = item.name || '';
        document.getElementById('item-tag').value = item.tag || '';
        document.getElementById('item-notes').value = item.notes || '';
        if (itemIdInput) itemIdInput.value = item.id;
        if (itemSubmitBtn) itemSubmitBtn.textContent = 'Atualizar item';
        if (itemCancelBtn) itemCancelBtn.hidden = false;
        authStatus.textContent = `Editando: ${item.name}`;
      }
      return;
    }

    if (target.dataset.favorite) {
      const id = Number(target.dataset.favorite);
      const items = currentItems.map((item) => item.id === id ? { ...item, favorite: !item.favorite } : item);
      await saveItemsForUser(uid, items);
      renderItems();
      authStatus.textContent = 'Favorito atualizado.';
      return;
    }

    if (target.dataset.copy) {
      const id = Number(target.dataset.copy);
      const item = currentItems.find((entry) => entry.id === id);
      if (item) {
        navigator.clipboard.writeText(`${item.name}\n${item.tag || ''}\n${item.notes || ''}`);
        authStatus.textContent = `Copiado: ${item.name}`;
      }
      return;
    }

    const id = Number(target.dataset.id);
    const items = currentItems.filter((item) => item.id !== id);
    await saveItemsForUser(uid, items);
    renderItems();
    renderAccountSummary();
    authStatus.textContent = 'Item removido.';
  });
}

if (itemCancelBtn) {
  itemCancelBtn.addEventListener('click', () => {
    resetItemForm();
    authStatus.textContent = 'Edição cancelada.';
  });
}

if (itemFilter) {
  itemFilter.addEventListener('change', renderItems);
}

const reveals = document.querySelectorAll('.reveal');

if ('IntersectionObserver' in window) {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
      }
    });
  }, { threshold: 0.15 });

  reveals.forEach((item) => observer.observe(item));
} else {
  reveals.forEach((item) => item.classList.add('visible'));
}

initAuthStateListener();
