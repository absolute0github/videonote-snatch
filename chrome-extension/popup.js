// ClipMark Chrome Extension - Popup
const $ = id => document.getElementById(id);

const DEFAULT_SERVER = 'https://clipmark.top';

// Load saved settings and check connection
document.addEventListener('DOMContentLoaded', async () => {
  const data = await chrome.storage.sync.get(['serverUrl', 'authToken', 'username']);
  const serverUrl = data.serverUrl || DEFAULT_SERVER;
  $('serverUrl').value = serverUrl;

  if (data.authToken) {
    await checkConnection(serverUrl, data.authToken, data.username);
  } else {
    showLoginForm();
    checkServerReachable(serverUrl);
  }
});

// Login button
$('loginBtn').addEventListener('click', async () => {
  const serverUrl = $('serverUrl').value.replace(/\/+$/, '') || DEFAULT_SERVER;
  const username = $('username').value.trim();
  const password = $('password').value;

  if (!username || !password) {
    showMsg('error', 'Username and password required');
    return;
  }

  $('loginBtn').disabled = true;
  $('loginBtn').textContent = 'Logging in...';

  try {
    const resp = await fetch(`${serverUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    const data = await resp.json();

    if (resp.ok && data.token) {
      await chrome.storage.sync.set({
        serverUrl,
        authToken: data.token,
        username: data.username || username
      });
      showMsg('success', 'Logged in!');
      setTimeout(() => checkConnection(serverUrl, data.token, data.username || username), 500);
    } else {
      showMsg('error', data.error || 'Login failed');
    }
  } catch (e) {
    showMsg('error', 'Cannot reach server');
  }

  $('loginBtn').disabled = false;
  $('loginBtn').textContent = 'Log in';
});

// Save manual token
$('saveTokenBtn').addEventListener('click', async () => {
  const serverUrl = $('serverUrl').value.replace(/\/+$/, '') || DEFAULT_SERVER;
  const token = $('tokenInput').value.trim();

  if (!token) {
    showMsg('error', 'Token is required');
    return;
  }

  await chrome.storage.sync.set({ serverUrl, authToken: token });
  showMsg('success', 'Token saved');
  setTimeout(() => checkConnection(serverUrl, token), 500);
});

// Logout
$('logoutBtn').addEventListener('click', async () => {
  const data = await chrome.storage.sync.get(['serverUrl', 'authToken']);
  if (data.authToken && data.serverUrl) {
    try {
      await fetch(`${data.serverUrl}/auth/logout`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${data.authToken}` }
      });
    } catch (e) { /* ignore */ }
  }
  await chrome.storage.sync.remove(['authToken', 'username']);
  showLoginForm();
  setStatus('disconnected', 'Logged out');
});

// Check connection with saved token
async function checkConnection(serverUrl, token, username) {
  setStatus('checking', 'Checking...');
  try {
    const resp = await fetch(`${serverUrl}/auth/check`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (resp.ok) {
      const data = await resp.json();
      const name = data.username || username || 'User';
      await chrome.storage.sync.set({ username: name });
      showLoggedIn(name);
      setStatus('connected', `Connected to ${new URL(serverUrl).hostname}`);
    } else {
      showLoginForm();
      setStatus('disconnected', 'Token expired — log in again');
      await chrome.storage.sync.remove(['authToken', 'username']);
    }
  } catch (e) {
    showLoginForm();
    setStatus('disconnected', 'Cannot reach server');
  }
}

async function checkServerReachable(serverUrl) {
  try {
    const resp = await fetch(`${serverUrl}/api/status`);
    if (resp.ok) {
      setStatus('disconnected', 'Server reachable — log in');
    } else {
      setStatus('disconnected', 'Server error');
    }
  } catch (e) {
    setStatus('disconnected', 'Cannot reach server');
  }
}

function showLoginForm() {
  $('loginSection').className = 'login-section active';
  $('loggedInSection').className = 'logged-in-section';
}

function showLoggedIn(username) {
  $('loginSection').className = 'login-section';
  $('loggedInSection').className = 'logged-in-section active';
  $('usernameDisplay').textContent = username;
}

function setStatus(state, text) {
  $('statusDot').className = `status-dot ${state}`;
  $('statusText').textContent = text;
}

function showMsg(type, text) {
  const el = $('loginMsg');
  el.className = `msg ${type}`;
  el.textContent = text;
  setTimeout(() => { el.className = 'msg'; }, 4000);
}
