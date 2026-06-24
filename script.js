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
const adminUsersList = document.getElementById('admin-users');
const userSummary = document.getElementById('user-summary');
const itemFilter = document.getElementById('item-filter');
const itemIdInput = document.getElementById('item-id');
const itemSubmitBtn = document.getElementById('item-submit-btn');
const appContent = document.getElementById('app-content');

const ACCESS_KEY = 'du557_private_session';
const USERS_KEY = 'du557_users';
const LOGIN_LOG_KEY = 'du557_login_log';
const ITEMS_PREFIX = 'du557_items_';
const FIREBASE_DATABASE_URL = (window.FIREBASE_DATABASE_URL || 'https://du557-330de-default-rtdb.firebaseio.com').replace(/\/$/, '');
const SESSION_DURATION_MS = 30 * 60 * 1000;

let remoteUsers = {};
let remoteLoginLog = [];
let remoteItems = {};
let remoteReady = false;

if (logoutBtn) {
  logoutBtn.hidden = true;
}

if (googleBtn) {
  googleBtn.hidden = true;
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

function getStoredUsers() {
  const raw = localStorage.getItem(USERS_KEY);
  return raw ? JSON.parse(raw) : {};
}

function saveStoredUsers(users) {
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
}

function getStoredLoginLog() {
  const raw = localStorage.getItem(LOGIN_LOG_KEY);
  return raw ? JSON.parse(raw) : [];
}

function getCurrentSessionEmail() {
  const raw = sessionStorage.getItem(ACCESS_KEY);
  if (!raw) return '';

  try {
    const parsed = JSON.parse(raw);
    if (parsed?.email) {
      if (parsed.expiresAt && Date.now() > parsed.expiresAt) {
        sessionStorage.removeItem(ACCESS_KEY);
        return '';
      }
      return String(parsed.email).toLowerCase();
    }
  } catch (error) {
    const legacyEmail = String(raw).trim().toLowerCase();
    return legacyEmail;
  }

  return '';
}

function saveSession(email) {
  sessionStorage.setItem(ACCESS_KEY, JSON.stringify({
    email: String(email).toLowerCase(),
    issuedAt: Date.now(),
    expiresAt: Date.now() + SESSION_DURATION_MS
  }));
}

function clearSession() {
  sessionStorage.removeItem(ACCESS_KEY);
}

function saveStoredLoginLog(entries) {
  localStorage.setItem(LOGIN_LOG_KEY, JSON.stringify(entries));
}

function getStoredItems(username) {
  const storageKey = getItemsKey(username);
  const raw = localStorage.getItem(storageKey);
  return raw ? JSON.parse(raw) : [];
}

function saveStoredItems(storageKey, items) {
  localStorage.setItem(storageKey, JSON.stringify(items));
}

function getItemsKey(username) {
  return `${ITEMS_PREFIX}${username}`;
}

function getSafeFirebaseKey(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '_')
    .replace(/^_+|_+$/g, '') || 'item';
}

function getUsers() {
  return remoteUsers;
}

function saveUsers(users) {
  remoteUsers = users;
  saveStoredUsers(users);
  const firebaseUsers = Object.fromEntries(
    Object.entries(users).map(([email, user]) => [getSafeFirebaseKey(email), { ...user, email }])
  );
  syncFirebaseData('/users', firebaseUsers);
}

function getLoginLog() {
  return remoteLoginLog;
}

function saveLoginLog(entries) {
  remoteLoginLog = entries;
  saveStoredLoginLog(entries);
  syncFirebaseData('/loginLog', entries);
}

function addLoginLog(email, source = 'local') {
  const log = getLoginLog();
  log.unshift({
    email: maskEmail(email),
    source,
    time: new Date().toLocaleString('pt-BR')
  });
  saveLoginLog(log.slice(0, 20));
}

function loadItems(username) {
  const storageKey = getItemsKey(username);
  if (remoteItems[storageKey]) {
    return remoteItems[storageKey];
  }
  return getStoredItems(username);
}

function saveItems(username, items) {
  const storageKey = getItemsKey(username);
  remoteItems[storageKey] = items;
  saveStoredItems(storageKey, items);
  syncFirebaseData(`/items/${getSafeFirebaseKey(storageKey)}`, { storageKey, items });
}

async function syncFirebaseData(path, payload) {
  if (!window.firebaseDb || !window.firebaseRefs) {
    return;
  }

  try {
    const { ref, set } = window.firebaseRefs;
    await set(ref(window.firebaseDb, path), payload);
  } catch (error) {
    console.warn('Não foi possível sincronizar com o Firebase.', error);
    if (path.includes('/users') || path.includes('/loginLog') || path.includes('/items')) {
      authStatus.textContent = 'A sincronização ficou indisponível por enquanto.';
    }
  }
}

function loadItemsFromStorage() {
  const items = {};
  Object.keys(localStorage).forEach((storageKey) => {
    if (storageKey.startsWith(ITEMS_PREFIX)) {
      try {
        items[storageKey] = JSON.parse(localStorage.getItem(storageKey));
      } catch (error) {
        console.warn('Item inválido no cache local.', error);
      }
    }
  });
  return items;
}

async function loadRemoteData() {
  remoteUsers = getStoredUsers();
  remoteLoginLog = getStoredLoginLog();
  remoteItems = loadItemsFromStorage();
  remoteReady = true;

  if (!window.firebaseDb || !window.firebaseRefs) {
    return;
  }

  try {
    const { ref, get } = window.firebaseRefs;
    const [usersSnap, logSnap, itemsSnap] = await Promise.all([
      get(ref(window.firebaseDb, 'users')),
      get(ref(window.firebaseDb, 'loginLog')),
      get(ref(window.firebaseDb, 'items'))
    ]);

    const usersPayload = usersSnap.exists() ? usersSnap.val() : {};
    const log = logSnap.exists() ? logSnap.val() : [];
    const itemsPayload = itemsSnap.exists() ? itemsSnap.val() : {};

    remoteUsers = Object.fromEntries(
      Object.entries(usersPayload).map(([safeKey, user]) => [user?.email || safeKey, user || {}])
    );
    remoteLoginLog = Array.isArray(log) ? log : [];
    remoteItems = Object.fromEntries(
      Object.entries(itemsPayload).map(([safeKey, entry]) => {
        const storageKey = entry?.storageKey || safeKey;
        const itemsList = Array.isArray(entry?.items) ? entry.items : [];
        return [storageKey, itemsList];
      })
    );
    saveStoredUsers(remoteUsers);
    saveStoredLoginLog(remoteLoginLog);
    Object.entries(remoteItems).forEach(([storageKey, itemsList]) => {
      saveStoredItems(storageKey, itemsList || []);
    });
  } catch (error) {
    console.warn('Usando armazenamento local porque o Firebase não respondeu.', error);
    if (authStatus) {
      authStatus.textContent = 'A sincronização com o banco está indisponível no momento.';
    }
  }
}

if (menuToggle && topNav) {
  menuToggle.addEventListener('click', () => {
    topNav.classList.toggle('open');
  });
}

async function ensureUserProfile(user, fallbackName = '') {
  const normalizedEmail = user.email?.toLowerCase();
  if (!normalizedEmail) return;

  const users = getUsers();
  const name = fallbackName || user.displayName || normalizedEmail.split('@')[0] || 'Usuário';
  users[normalizedEmail] = {
    name,
    email: normalizedEmail,
    lastLoginAt: new Date().toISOString(),
    provider: user.providerData?.[0]?.providerId || 'firebase'
  };

  saveUsers(users);
}

async function verifyCredentials(email, password) {
  if (!window.firebaseAuth || !window.firebaseAuthHelpers) return false;

  try {
    const credential = await window.firebaseAuthHelpers.signInWithEmailAndPassword(window.firebaseAuth, email, password);
    return Boolean(credential.user);
  } catch (error) {
    console.warn('Falha no login com e-mail.', error);
    return false;
  }
}

async function createAccount(name, email, password) {
  if (!window.firebaseAuth || !window.firebaseAuthHelpers) {
    throw new Error('Firebase Auth não inicializado.');
  }

  const credential = await window.firebaseAuthHelpers.createUserWithEmailAndPassword(window.firebaseAuth, email, password);
  if (credential.user) {
    await ensureUserProfile(credential.user, name);
    return credential.user;
  }

  throw new Error('Não foi possível criar a conta.');
}

function renderAdminPanel(currentEmail) {
  const users = getUsers();
  const log = getLoginLog();
  const entries = Object.entries(users).map(([email, user]) => ({
    email,
    name: user.name || 'Sem nome',
    status: currentEmail === email ? 'Online agora' : 'Em espera'
  }));

  const activeCount = entries.filter((entry) => entry.status === 'Online agora').length;
  const currentUser = users[currentEmail] || null;

  if (userSummary) {
    userSummary.className = 'user-summary';
    userSummary.innerHTML = currentUser ? `
      <strong>${escapeHtml(currentUser.name || currentEmail)}</strong>
      <span>${escapeHtml(maskEmail(currentEmail))}</span>
      <span>Status: ${escapeHtml(currentUser.provider || 'firebase')}</span>
    ` : '<span>Nenhum usuário ativo.</span>';
  }

  if (adminUsersList) {
    adminUsersList.innerHTML = `
      <div class="dashboard-grid">
        <div class="dashboard-card">
          <strong>${entries.length}</strong>
          <span>Usuários</span>
        </div>
        <div class="dashboard-card">
          <strong>${activeCount}</strong>
          <span>Ativos</span>
        </div>
        <div class="dashboard-card">
          <strong>${entries.length - activeCount}</strong>
          <span>Em espera</span>
        </div>
      </div>
      <div class="admin-panel">
        <h4>Segurança</h4>
        <ul class="saved-list">
          <li class="saved-item">
            <div>
              <strong>Sessão protegida</strong>
              <span>Seu acesso fica restrito ao usuário autenticado.</span>
              <span>Os dados sensíveis não são expostos em listas públicas.</span>
            </div>
          </li>
        </ul>
      </div>
    `;
  }
}

function renderItems(username) {
  const items = loadItems(username);
  const filter = itemFilter ? itemFilter.value : 'all';
  const visibleItems = items.filter((item) => filter === 'all' || (item.tag || '').toLowerCase().includes(filter));

  if (!savedItemsList) return;

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

function showVault(userEmail) {
  loginCard.hidden = true;
  vaultCard.hidden = false;
  logoutBtn.hidden = false;
  if (appContent) {
    appContent.hidden = false;
  }
  if (panelTitle) {
    panelTitle.textContent = 'Painel privado';
  }
  document.body.classList.remove('locked-view');
  renderAdminPanel(userEmail);
  renderItems(userEmail);
}

function showLogin(message = '') {
  loginCard.hidden = false;
  vaultCard.hidden = true;
  if (logoutBtn) {
    logoutBtn.hidden = true;
  }
  if (appContent) {
    appContent.hidden = true;
  }
  if (panelTitle) {
    panelTitle.textContent = 'Entrar';
  }
  document.body.classList.add('locked-view');
  if (message) {
    authStatus.textContent = message;
  }
}

function initAuthStateListener() {
  if (!window.firebaseAuth || !window.firebaseAuthHelpers) {
    showLogin('Acesso privado. Entre ou crie sua conta.');
    return;
  }

  window.firebaseAuthHelpers.onAuthStateChanged(window.firebaseAuth, async (user) => {
    if (!user) {
      clearSession();
      showLogin('Acesso privado. Entre ou crie sua conta.');
      return;
    }

    const normalizedEmail = user.email.toLowerCase();
    saveSession(normalizedEmail);
    await loadRemoteData();
    await ensureUserProfile(user, user.displayName || 'Usuário');
    addLoginLog(normalizedEmail, user.providerData?.[0]?.providerId || 'firebase');
    showVault(normalizedEmail);
  });
}

async function restoreSession() {
  await loadRemoteData();
  initAuthStateListener();
}

if (loginForm) {
  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    await loadRemoteData();
    const email = document.getElementById('login-email').value.trim().toLowerCase();
    const password = document.getElementById('login-password').value;
    const valid = await verifyCredentials(email, password);

    if (!valid) {
      authStatus.textContent = 'E-mail ou senha inválidos.';
      return;
    }

    authStatus.textContent = 'Login realizado com sucesso.';
    if (window.firebaseAuth && window.firebaseAuthHelpers) {
      const currentUser = window.firebaseAuth.currentUser;
      if (currentUser) {
        const normalizedEmail = currentUser.email.toLowerCase();
        saveSession(normalizedEmail);
        await ensureUserProfile(currentUser, currentUser.displayName || 'Usuário');
        showVault(normalizedEmail);
      }
    }
  });
}

if (signupForm) {
  signupForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    await loadRemoteData();
    const name = document.getElementById('signup-name').value.trim();
    const email = document.getElementById('signup-email').value.trim().toLowerCase();
    const password = document.getElementById('signup-password').value;

    if (!name || !email || !password) {
      authStatus.textContent = 'Preencha todos os campos.';
      return;
    }

    try {
      const user = await createAccount(name, email, password);
      const normalizedEmail = user.email.toLowerCase();
      saveSession(normalizedEmail);
      await ensureUserProfile(user, name);
      addLoginLog(normalizedEmail, 'signup');
      showVault(normalizedEmail);
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
    modeButtons.forEach((btn) => btn.classList.remove('active'));
    button.classList.add('active');

    const mode = button.dataset.mode;
    const loginForm = document.getElementById('login-form');
    const signupForm = document.getElementById('signup-form');

    if (!loginForm || !signupForm) return;

    if (mode === 'signup') {
      loginForm.hidden = true;
      signupForm.hidden = false;
      signupForm.querySelector('input')?.focus();
    } else {
      loginForm.hidden = false;
      signupForm.hidden = true;
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
      const result = await window.firebaseAuthHelpers.signInWithPopup(window.firebaseAuth, provider);
      const user = result.user;
      const normalizedEmail = user.email.toLowerCase();
      saveSession(normalizedEmail);
      await ensureUserProfile(user, user.displayName || 'Usuário');
      addLoginLog(normalizedEmail, 'google');
      showVault(normalizedEmail);
      authStatus.textContent = 'Login com Google realizado.';
    } catch (error) {
      const message = error?.message || '';
      if (message.includes('unauthorized-domain') || message.includes('domain')) {
        authStatus.textContent = 'Acesso com Google indisponível por enquanto.';
      } else {
        authStatus.textContent = 'Não foi possível entrar com o Google.';
      }
    }
  });
}

if (itemForm && savedItemsList) {
  itemForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const email = getCurrentSessionEmail();
    if (!email) {
      showLogin('Entre para salvar itens.');
      return;
    }

    const normalizedEmail = email.toLowerCase();
    const users = getUsers();
    if (!users[normalizedEmail]) {
      users[normalizedEmail] = {
        name: normalizedEmail.split('@')[0] || 'Usuário',
        email: normalizedEmail,
        lastLoginAt: new Date().toISOString(),
        provider: 'firebase'
      };
      saveUsers(users);
    }

    const name = document.getElementById('item-name').value.trim();
    const tag = document.getElementById('item-tag').value.trim();
    const notes = document.getElementById('item-notes').value.trim();
    const editingId = itemIdInput ? Number(itemIdInput.value) : null;
    if (!name) return;

    const items = loadItems(normalizedEmail);
    if (editingId) {
      const index = items.findIndex((item) => item.id === editingId);
      if (index >= 0) {
        items[index] = { ...items[index], name, tag, notes };
      }
    } else {
      items.unshift({
        id: Date.now(),
        name,
        tag,
        notes,
        favorite: false
      });
    }

    saveItems(normalizedEmail, items);
    renderItems(normalizedEmail);
    authStatus.textContent = editingId ? `Item atualizado: ${name}` : `Item salvo: ${name}`;
    itemForm.reset();
    if (itemIdInput) itemIdInput.value = '';
    if (itemSubmitBtn) itemSubmitBtn.textContent = 'Salvar item';
  });

  savedItemsList.addEventListener('click', (event) => {
    const target = event.target;
    if (target.tagName !== 'BUTTON') return;
    const email = getCurrentSessionEmail();
    if (!email) return;

    const normalizedEmail = email.toLowerCase();

    if (target.dataset.edit) {
      const id = Number(target.dataset.edit);
      const item = loadItems(normalizedEmail).find((entry) => entry.id === id);
      if (item) {
        document.getElementById('item-name').value = item.name || '';
        document.getElementById('item-tag').value = item.tag || '';
        document.getElementById('item-notes').value = item.notes || '';
        if (itemIdInput) itemIdInput.value = item.id;
        if (itemSubmitBtn) itemSubmitBtn.textContent = 'Atualizar item';
        authStatus.textContent = `Editando: ${item.name}`;
      }
      return;
    }

    if (target.dataset.favorite) {
      const id = Number(target.dataset.favorite);
      const items = loadItems(normalizedEmail).map((item) => item.id === id ? { ...item, favorite: !item.favorite } : item);
      saveItems(normalizedEmail, items);
      renderItems(normalizedEmail);
      authStatus.textContent = 'Favorito atualizado.';
      return;
    }

    if (target.dataset.copy) {
      const id = Number(target.dataset.copy);
      const item = loadItems(normalizedEmail).find((entry) => entry.id === id);
      if (item) {
        navigator.clipboard.writeText(`${item.name}\n${item.tag || ''}\n${item.notes || ''}`);
        authStatus.textContent = `Copiado: ${item.name}`;
      }
      return;
    }

    const id = Number(target.dataset.id);
    const items = loadItems(normalizedEmail).filter((item) => item.id !== id);
    saveItems(normalizedEmail, items);
    renderItems(normalizedEmail);
    authStatus.textContent = 'Item removido.';
  });
}

if (adminUsersList) {
  adminUsersList.addEventListener('click', (event) => {
    const target = event.target;
    if (target.tagName !== 'BUTTON') return;
    const email = target.dataset.email;
    if (!email) return;
    authStatus.textContent = `Visualizando ${email}`;
  });
}

if (itemFilter) {
  itemFilter.addEventListener('change', () => {
    const email = getCurrentSessionEmail();
    if (email) {
      renderItems(email.toLowerCase());
    }
  });
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

restoreSession();
