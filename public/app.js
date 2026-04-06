
// QIC Messenger - Frontend Application
const EMOJIS = ['😊','😂','😍','😢','😎','😡','😱','🤔','👍','👎','❤️','💔','🔥','⭐','🎉','🙏','😴','🤣','😘','🥰','😏','🤗','🙄','😤','😭','👋','✌️','🤞','💪','🎵','💤'];

let token = localStorage.getItem('qic_token');
let myUin = localStorage.getItem('qic_uin');
let myNickname = localStorage.getItem('qic_nick');
let socket = null;
let contacts = [];
let openChats = {};
let selectedAddContact = null;
let typingTimers = {};
let audioCtx = null;
let myCurrentStatus = 'online';
let chatZIndex = 100;

// ─── AUDIO ───
function getAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}
function playBeep(f1, f2, dur) {
  try {
    const ctx = getAudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.frequency.setValueAtTime(f1, ctx.currentTime);
    if (f2) osc.frequency.linearRampToValueAtTime(f2, ctx.currentTime + dur * 0.5);
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + dur);
    osc.start(ctx.currentTime); osc.stop(ctx.currentTime + dur);
  } catch(e) {}
}
function playMessageSound() { playBeep(440, 880, 0.3); }
function playOnlineSound() { playBeep(600, 900, 0.15); }

// ─── UTILS ───
function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function linkify(text) {
  return esc(text).replace(/(https?:\/\/[^\s]+)/g,'<a href="$1" target="_blank">$1</a>');
}
function formatTime(dt) {
  return new Date(dt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
}
function formatDateTime(dt) {
  const d = new Date(dt);
  return d.toLocaleDateString([],{day:'2-digit',month:'2-digit',year:'numeric'}) + ' ' + formatTime(dt);
}
function statusLabel(s) {
  const m = {online:'Online',away:'Away',na:'Not Available',dnd:'Do Not Disturb',ffc:'Free for Chat',invisible:'Invisible',offline:'Offline'};
  return m[s] || 'Offline';
}
function getInitials(nick) {
  return (nick || '?').charAt(0).toUpperCase();
}

async function api(method, path, body) {
  const opts = {method, headers:{'Content-Type':'application/json'}};
  if (token) opts.headers['Authorization'] = 'Bearer ' + token;
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(path, opts);
  const json = await r.json();
  if (!r.ok) throw new Error(json.error || 'Error');
  return json;
}

// ─── AUTH ───
function switchAuthTab(tab) {
  document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
  document.querySelector(`[onclick="switchAuthTab('${tab}')"]`).classList.add('active');
  document.getElementById('tab-' + tab).classList.add('active');
}

async function doLogin() {
  const uin = document.getElementById('login-uin').value.trim();
  const password = document.getElementById('login-password').value;
  const errEl = document.getElementById('login-error');
  errEl.textContent = '';
  if (!uin || !password) { errEl.textContent = 'Please enter UIN and password.'; return; }
  try {
    const data = await api('POST', '/api/login', {uin, password});
    token = data.token; myUin = data.uin; myNickname = data.nickname;
    localStorage.setItem('qic_token', token);
    localStorage.setItem('qic_uin', myUin);
    localStorage.setItem('qic_nick', myNickname);
    await startApp();
  } catch(e) { errEl.textContent = e.message; }
}

async function doRegister() {
  const nickname = document.getElementById('reg-nickname').value.trim();
  const password = document.getElementById('reg-password').value;
  const email = document.getElementById('reg-email').value.trim();
  const first_name = document.getElementById('reg-firstname').value.trim();
  const last_name = document.getElementById('reg-lastname').value.trim();
  const age = parseInt(document.getElementById('reg-age').value) || 0;
  const gender = document.getElementById('reg-gender').value;
  const country = document.getElementById('reg-country').value.trim();
  const city = document.getElementById('reg-city').value.trim();
  const errEl = document.getElementById('reg-error');
  errEl.textContent = '';
  if (!nickname || !password) { errEl.textContent = 'Nickname and password required.'; return; }
  try {
    const data = await api('POST', '/api/register', {nickname, password, email, first_name, last_name, age, gender, country, city});
    token = data.token; myUin = data.uin; myNickname = data.nickname;
    localStorage.setItem('qic_token', token);
    localStorage.setItem('qic_uin', myUin);
    localStorage.setItem('qic_nick', myNickname);
    await startApp();
  } catch(e) { errEl.textContent = e.message; }
}

function doLogout() {
  if (socket) socket.disconnect();
  socket = null;
  token = null; myUin = null; myNickname = null;
  localStorage.removeItem('qic_token');
  localStorage.removeItem('qic_uin');
  localStorage.removeItem('qic_nick');
  // Close all chats
  Object.keys(openChats).forEach(u => {
    if (openChats[u].window) openChats[u].window.remove();
  });
  openChats = {};
  contacts = [];
  document.getElementById('contacts-area').innerHTML = '<div class="contacts-loading">Connecting to QIC network...</div>';
  closeDialog('status-menu');
  showScreen('screen-auth');
}

// ─── SCREENS ───
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

// ─── START APP ───
async function startApp() {
  showScreen('screen-main');
  document.getElementById('my-nickname').textContent = myNickname || myUin;
  document.getElementById('my-uin-display').textContent = 'UIN: ' + myUin;
  document.getElementById('my-avatar-img').textContent = getInitials(myNickname);
  document.getElementById('profile-uin-num').textContent = myUin;
  initSocket();
  await refreshContacts();
  loadUnread();
  makeDraggable(document.getElementById('main-window'));
}

// ─── SOCKET ───
function initSocket() {
  socket = io({auth: {token}});
  socket.on('connect', () => {
    console.log('QIC connected, socket:', socket.id);
    setMyStatusDot('online');
    myCurrentStatus = 'online';
  });
  socket.on('disconnect', () => setMyStatusDot('offline'));

  socket.on('new_message', (msg) => {
    const chat = openChats[msg.sender_uin];
    if (chat) {
      appendMessage(chat, msg, false);
      if (!chat.focused) {
        chat.unread = (chat.unread || 0) + 1;
        flashChatWindow(chat.window);
        playMessageSound();
        showNotification(chat.nickname, msg.message.substring(0, 80));
      }
    } else {
      playMessageSound();
      const senderNick = getContactNick(msg.sender_uin) || ('UIN ' + msg.sender_uin);
      showNotification(senderNick, msg.message.substring(0, 80));
      incrementUnreadBadge(msg.sender_uin);
    }
    updatePageTitle();
  });

  socket.on('message_sent', (msg) => {
    const chat = openChats[msg.receiver_uin];
    if (chat) appendMessage(chat, msg, true);
  });

  socket.on('contact_status', ({uin, status}) => {
    updateContactStatus(uin, status);
    const chat = openChats[uin];
    if (chat) updateChatStatusBar(chat, status);
    if (status === 'online' || status === 'ffc') playOnlineSound();
  });

  socket.on('user_typing', ({from}) => {
    const chat = openChats[from];
    if (!chat) return;
    const ind = chat.window.querySelector('.chat-typing-indicator');
    const txt = chat.window.querySelector('.typing-text');
    if (ind && txt) {
      txt.textContent = (chat.nickname || from) + ' is typing...';
      ind.classList.remove('hidden');
    }
  });

  socket.on('user_stop_typing', ({from}) => {
    const chat = openChats[from];
    if (!chat) return;
    const ind = chat.window && chat.window.querySelector('.chat-typing-indicator');
    if (ind) ind.classList.add('hidden');
  });
}

function setMyStatusDot(status) {
  const dot = document.getElementById('my-status-dot');
  if (dot) dot.className = 'status-dot ' + status;
}

// ─── STATUS ───
function openStatusMenu() {
  const menu = document.getElementById('status-menu');
  menu.classList.toggle('hidden');
  if (!menu.classList.contains('hidden')) {
    document.addEventListener('click', closeStatusMenuOnOutside, {once: true, capture: true});
  }
}
function closeStatusMenuOnOutside(e) {
  const menu = document.getElementById('status-menu');
  const icon = document.querySelector('.my-status-icon');
  if (!menu.contains(e.target) && !icon.contains(e.target)) {
    menu.classList.add('hidden');
  }
}
function setMyStatus(status) {
  myCurrentStatus = status;
  if (socket) socket.emit('set_status', status);
  setMyStatusDot(status === 'offline' ? 'invisible' : status);
  document.getElementById('status-menu').classList.add('hidden');
}
function toggleMinimize() {
  const area = document.getElementById('contacts-area');
  const toolbar = document.querySelector('.toolbar');
  const bottom = document.querySelector('.bottom-bar');
  [area, toolbar, bottom].forEach(el => el && el.classList.toggle('hidden'));
}

// ─── CONTACTS ───
async function refreshContacts() {
  try {
    contacts = await api('GET', '/api/contacts');
    renderContacts();
    document.getElementById('bottom-info').textContent = 'Contacts: ' + contacts.length;
  } catch(e) { console.error('Load contacts:', e); }
}

async function loadUnread() {
  try {
    const unread = await api('GET', '/api/unread');
    unread.forEach(u => incrementUnreadBadge(u.sender_uin, u.count));
  } catch(e) {}
}

function getContactNick(uin) {
  const c = contacts.find(c => c.uin === uin);
  return c ? (c.custom_nick || c.nickname) : null;
}

function renderContacts() {
  const area = document.getElementById('contacts-area');
  if (!contacts.length) {
    area.innerHTML = '<div class="contacts-loading">No contacts yet.<br>Click + to add someone.</div>';
    return;
  }
  // Group contacts
  const groups = {};
  contacts.forEach(c => {
    const g = c.group_name || 'General';
    if (!groups[g]) groups[g] = [];
    groups[g].push(c);
  });
  // Sort: online first within each group
  Object.values(groups).forEach(arr => {
    arr.sort((a,b) => {
      const online = ['online','ffc','away'];
      const aO = online.includes(a.status) ? 0 : 1;
      const bO = online.includes(b.status) ? 0 : 1;
      return aO - bO || (a.nickname||'').localeCompare(b.nickname||'');
    });
  });
  let html = '';
  Object.entries(groups).forEach(([groupName, members]) => {
    const onlineCount = members.filter(m => m.status && m.status !== 'offline').length;
    html += `<div class="contact-group">
      <div class="contact-group-header" onclick="toggleGroup(this)">
        <span class="group-arrow">▼</span>
        ${esc(groupName)}
        <span class="group-count">${onlineCount}/${members.length}</span>
      </div>
      <div class="contact-group-list">`;
    members.forEach(c => {
      const nick = c.custom_nick || c.nickname;
      const status = c.status || 'offline';
      const isOffline = status === 'offline' || status === 'invisible';
      html += `<div class="contact-item ${isOffline ? 'offline' : ''}" data-uin="${esc(c.uin)}"
        onclick="openChat('${esc(c.uin)}')"
        oncontextmenu="showContactMenu(event,'${esc(c.uin)}')">
        <div class="contact-item-avatar">${esc(getInitials(nick))}</div>
        <div class="contact-item-info">
          <div class="contact-name">${esc(nick)}</div>
          <div class="contact-status-msg">${esc(c.status_message || statusLabel(status))}</div>
        </div>
        <span class="status-dot ${status}"></span>
        <span class="contact-unread-badge hidden" data-uin="${esc(c.uin)}"></span>
      </div>`;
    });
    html += '</div></div>';
  });
  area.innerHTML = html;
}

function toggleGroup(header) {
  const list = header.nextElementSibling;
  const arrow = header.querySelector('.group-arrow');
  list.classList.toggle('collapsed');
  arrow.classList.toggle('collapsed');
}

function updateContactStatus(uin, status) {
  // Update contacts array
  const c = contacts.find(c => c.uin === uin);
  if (c) c.status = status;
  // Update DOM
  const items = document.querySelectorAll(`.contact-item[data-uin="${uin}"]`);
  items.forEach(item => {
    const dot = item.querySelector('.status-dot');
    if (dot) { dot.className = 'status-dot ' + status; }
    const isOffline = status === 'offline' || status === 'invisible';
    item.classList.toggle('offline', isOffline);
    const msgEl = item.querySelector('.contact-status-msg');
    const c2 = contacts.find(c => c.uin === uin);
    if (msgEl && c2) msgEl.textContent = c2.status_message || statusLabel(status);
  });
}

function incrementUnreadBadge(uin, count) {
  const badges = document.querySelectorAll(`.contact-unread-badge[data-uin="${uin}"]`);
  badges.forEach(b => {
    const cur = parseInt(b.textContent) || 0;
    const newCount = count !== undefined ? count : cur + 1;
    if (newCount > 0) { b.textContent = newCount; b.classList.remove('hidden'); }
    else { b.textContent = ''; b.classList.add('hidden'); }
  });
}

function clearUnreadBadge(uin) {
  document.querySelectorAll(`.contact-unread-badge[data-uin="${uin}"]`).forEach(b => {
    b.textContent = ''; b.classList.add('hidden');
  });
  if (openChats[uin]) openChats[uin].unread = 0;
  updatePageTitle();
}

function updatePageTitle() {
  let total = 0;
  Object.values(openChats).forEach(c => { total += (c.unread || 0); });
  document.title = total > 0 ? `(${total}) QIC Messenger` : 'QIC Messenger';
}

// ─── CHAT WINDOWS ───
async function openChat(uin) {
  // If already open, focus it
  if (openChats[uin]) {
    bringToFront(openChats[uin].window);
    openChats[uin].window.querySelector('.chat-input').focus();
    clearUnreadBadge(uin);
    return;
  }
  const contact = contacts.find(c => c.uin === uin);
  const nick = contact ? (contact.custom_nick || contact.nickname) : ('UIN ' + uin);
  const status = contact ? (contact.status || 'offline') : 'offline';

  const tmpl = document.getElementById('chat-window-template');
  const win = tmpl.content.cloneNode(true).querySelector('.chat-window');
  win.dataset.uin = uin;

  win.querySelector('.chat-title').textContent = nick;
  win.querySelector('.chat-username').textContent = nick;
  win.querySelector('.chat-avatar .avatar-placeholder').textContent = getInitials(nick);
  const statusDot = win.querySelector('.chat-status-line .status-dot');
  statusDot.className = 'status-dot small ' + status;
  win.querySelector('.chat-status-text').textContent = statusLabel(status);

  // Position window
  const offset = Object.keys(openChats).length;
  win.style.left = (80 + offset * 20) + 'px';
  win.style.top = (60 + offset * 20) + 'px';
  win.style.zIndex = ++chatZIndex;

  // Store chat state
  openChats[uin] = {window: win, nickname: nick, focused: true, unread: 0};

  // Wire up close button
  win.querySelector('.close-btn').onclick = () => closeChat(uin);

  // Wire up info button
  win.querySelector('.info-btn').onclick = () => openUserInfo(uin);

  // Wire up send button
  const input = win.querySelector('.chat-input');
  const sendBtn = win.querySelector('.btn-send');
  const counter = win.querySelector('.char-counter');

  sendBtn.onclick = () => sendMessage(uin);

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(uin);
    }
  });

  input.addEventListener('input', () => {
    counter.textContent = input.value.length;
    if (socket) {
      socket.emit('typing', {to: uin});
      clearTimeout(typingTimers[uin]);
      typingTimers[uin] = setTimeout(() => {
        if (socket) socket.emit('stop_typing', {to: uin});
      }, 2000);
    }
  });

  // Focus tracking
  win.addEventListener('mousedown', () => {
    openChats[uin] && (openChats[uin].focused = true);
    bringToFront(win);
    clearUnreadBadge(uin);
  });

  // Emoji picker setup
  const emojiGrid = win.querySelector('.emoji-grid');
  EMOJIS.forEach(em => {
    const btn = document.createElement('button');
    btn.className = 'emoji-btn-item';
    btn.textContent = em;
    btn.title = em;
    btn.onclick = () => {
      input.value += em;
      input.focus();
      counter.textContent = input.value.length;
      win.querySelector('.emoji-picker').classList.add('hidden');
    };
    emojiGrid.appendChild(btn);
  });

  // Draggable
  makeDraggable(win, win.querySelector('.win-titlebar'));

  // Add to DOM
  document.getElementById('chat-windows-container').appendChild(win);

  // Load history
  try {
    const msgs = await api('GET', '/api/messages/' + uin);
    const messagesEl = win.querySelector('.chat-messages');
    if (msgs.length === 0) {
      messagesEl.innerHTML = '<div class="system-message">No messages yet. Say hello!</div>';
    } else {
      msgs.forEach(m => appendMessage(openChats[uin], m, m.sender_uin === myUin));
    }
  } catch(e) { console.error('Load messages:', e); }

  clearUnreadBadge(uin);
  input.focus();
}

function closeChat(uin) {
  const chat = openChats[uin];
  if (!chat) return;
  chat.window.remove();
  delete openChats[uin];
  updatePageTitle();
}

function sendMessage(uin) {
  const chat = openChats[uin];
  if (!chat || !socket) return;
  const input = chat.window.querySelector('.chat-input');
  const text = input.value.trim();
  if (!text) return;
  socket.emit('send_message', {to: uin, message: text, message_type: 'text'});
  input.value = '';
  chat.window.querySelector('.char-counter').textContent = '0';
  socket.emit('stop_typing', {to: uin});
}

function appendMessage(chat, msg, isMe) {
  const el = chat.window.querySelector('.chat-messages');
  // Remove "no messages" placeholder
  const placeholder = el.querySelector('.system-message');
  if (placeholder) placeholder.remove();

  const div = document.createElement('div');
  div.className = 'message-block';
  const nick = isMe ? (myNickname || myUin) : (chat.nickname || msg.sender_uin);
  div.innerHTML = `
    <div class="message-header">
      <span class="message-sender ${isMe ? 'me' : 'them'}">${esc(nick)}</span>
      <span class="message-time">${formatDateTime(msg.sent_at)}</span>
    </div>
    <div class="message-text">${linkify(msg.message)}</div>`;
  el.appendChild(div);
  el.scrollTop = el.scrollHeight;
}

function updateChatStatusBar(chat, status) {
  if (!chat.window) return;
  const dot = chat.window.querySelector('.chat-status-line .status-dot');
  const txt = chat.window.querySelector('.chat-status-text');
  if (dot) dot.className = 'status-dot small ' + status;
  if (txt) txt.textContent = statusLabel(status);
}

function flashChatWindow(win) {
  win.classList.add('flashing');
  setTimeout(() => win.classList.remove('flashing'), 2000);
}

function bringToFront(win) {
  win.style.zIndex = ++chatZIndex;
}

// ─── FORMAT TEXT IN CHAT ───
function formatText(btn, type) {
  // Find parent chat window
  const win = btn.closest('.chat-window');
  if (!win) return;
  const input = win.querySelector('.chat-input');
  const start = input.selectionStart;
  const end = input.selectionEnd;
  const sel = input.value.substring(start, end);
  if (!sel) return;
  let wrapped = sel;
  if (type === 'bold') wrapped = '**' + sel + '**';
  if (type === 'italic') wrapped = '_' + sel + '_';
  input.value = input.value.substring(0, start) + wrapped + input.value.substring(end);
  input.focus();
}

// ─── EMOJI PICKER ───
function toggleEmojiPicker(btn) {
  const win = btn.closest('.chat-window');
  if (!win) return;
  const picker = win.querySelector('.emoji-picker');
  picker.classList.toggle('hidden');
}

// ─── DRAGGABLE WINDOWS ───
function makeDraggable(win, handle) {
  handle = handle || win.querySelector('.win-titlebar');
  if (!handle) return;
  let startX, startY, startL, startT;
  handle.addEventListener('mousedown', (e) => {
    if (e.target.classList.contains('win-btn') || e.target.closest('.win-btn')) return;
    e.preventDefault();
    bringToFront(win);
    startX = e.clientX; startY = e.clientY;
    const rect = win.getBoundingClientRect();
    startL = rect.left; startT = rect.top;
    win.classList.add('dragging');
    const onMove = (e2) => {
      const dx = e2.clientX - startX;
      const dy = e2.clientY - startY;
      win.style.left = Math.max(0, startL + dx) + 'px';
      win.style.top = Math.max(0, startT + dy) + 'px';
    };
    const onUp = () => {
      win.classList.remove('dragging');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

// ─── DIALOGS ───
function openDialog(id) { document.getElementById(id).classList.remove('hidden'); }
function closeDialog(id) { document.getElementById(id).classList.add('hidden'); }

// ─── ADD CONTACT ───
function openAddContact() {
  selectedAddContact = null;
  document.getElementById('add-uin-input').value = '';
  document.getElementById('add-error').textContent = '';
  document.getElementById('add-search-results').innerHTML = '';
  document.getElementById('add-confirm-btn').disabled = true;
  showAddStep(1);
  openDialog('dialog-add-contact');
}

function showAddStep(n) {
  document.querySelectorAll('#dialog-add-contact .wizard-step').forEach(s => s.classList.add('hidden'));
  document.getElementById('add-step-' + n).classList.remove('hidden');
}

async function searchForAdd() {
  const q = document.getElementById('add-uin-input').value.trim();
  const errEl = document.getElementById('add-error');
  errEl.textContent = '';
  if (!q) { errEl.textContent = 'Enter UIN or nickname.'; return; }
  try {
    const results = await api('GET', '/api/search?q=' + encodeURIComponent(q));
    const container = document.getElementById('add-search-results');
    if (!results.length) {
      container.innerHTML = '<div style="padding:10px;text-align:center;color:#666;font-size:11px">No users found.</div>';
    } else {
      container.innerHTML = results.map(u => `
        <div class="search-result-item" data-uin="${esc(u.uin)}" onclick="selectAddResult(this,'${esc(u.uin)}')">
          <span class="status-dot small ${u.status || 'offline'}"></span>
          <div>
            <div><strong>${esc(u.nickname)}</strong> ${esc(u.first_name)} ${esc(u.last_name)}</div>
            <div class="search-result-uin">UIN: ${esc(u.uin)}</div>
          </div>
        </div>`).join('');
    }
    showAddStep(2);
  } catch(e) { errEl.textContent = e.message; }
}

function selectAddResult(el, uin) {
  document.querySelectorAll('#add-search-results .search-result-item').forEach(i => i.classList.remove('selected'));
  el.classList.add('selected');
  selectedAddContact = uin;
  document.getElementById('add-confirm-btn').disabled = false;
}

async function confirmAddContact() {
  if (!selectedAddContact) return;
  try {
    await api('POST', '/api/contacts', {contact_uin: selectedAddContact, group_name: 'General'});
    closeDialog('dialog-add-contact');
    await refreshContacts();
    showNotification('Contact Added', 'Contact added to your list!');
  } catch(e) {
    document.getElementById('add-error').textContent = e.message;
    showAddStep(1);
  }
}

// ─── SEARCH ───
function openSearch() {
  document.getElementById('search-nickname').value = '';
  document.getElementById('search-uin-field').value = '';
  document.getElementById('search-results-area').innerHTML = '';
  openDialog('dialog-search');
}

async function doSearch() {
  const nick = document.getElementById('search-nickname').value.trim();
  const uin = document.getElementById('search-uin-field').value.trim();
  const q = uin || nick;
  const container = document.getElementById('search-results-area');
  container.innerHTML = '<div style="padding:10px;text-align:center;font-size:11px;color:#666">Searching...</div>';
  try {
    const results = await api('GET', '/api/search?q=' + encodeURIComponent(q || ' '));
    if (!results.length) {
      container.innerHTML = '<div style="padding:10px;text-align:center;color:#666;font-size:11px">No results found.</div>';
    } else {
      container.innerHTML = results.map(u => `
        <div class="search-result-item" onclick="openChatFromSearch('${esc(u.uin)}')">
          <span class="status-dot small ${u.status || 'offline'}"></span>
          <div style="flex:1">
            <div><strong>${esc(u.nickname)}</strong> ${esc(u.first_name||'')} ${esc(u.last_name||'')}</div>
            <div class="search-result-uin">UIN: ${esc(u.uin)} | ${esc(u.country||'')} ${esc(u.city||'')}</div>
          </div>
          <button class="btn-primary" onclick="event.stopPropagation();addFromSearch('${esc(u.uin)}')" style="font-size:9px;padding:2px 8px">Add</button>
        </div>`).join('');
    }
  } catch(e) {
    container.innerHTML = `<div style="padding:10px;color:#cc0000;font-size:11px">${esc(e.message)}</div>`;
  }
}

async function addFromSearch(uin) {
  try {
    await api('POST', '/api/contacts', {contact_uin: uin, group_name: 'General'});
    await refreshContacts();
    showNotification('Contact Added', 'Contact added to your list!');
  } catch(e) { showNotification('Error', e.message); }
}

async function openChatFromSearch(uin) {
  closeDialog('dialog-search');
  // If not in contacts, add temporarily
  const inContacts = contacts.some(c => c.uin === uin);
  if (!inContacts) {
    try {
      const user = await api('GET', '/api/users/' + uin);
      contacts.push({uin, nickname: user.nickname, status: user.status, group_name: 'General'});
    } catch(e) {}
  }
  openChat(uin);
}

function clearSearch() {
  document.getElementById('search-nickname').value = '';
  document.getElementById('search-uin-field').value = '';
  document.getElementById('search-results-area').innerHTML = '';
}

// ─── CONTEXT MENU ───
let activeContextMenu = null;
function showContactMenu(e, uin) {
  e.preventDefault();
  e.stopPropagation();
  if (activeContextMenu) activeContextMenu.remove();
  const contact = contacts.find(c => c.uin === uin);
  const nick = contact ? (contact.custom_nick || contact.nickname) : uin;
  const menu = document.createElement('div');
  menu.className = 'context-menu';
  menu.style.position = 'fixed';
  menu.style.left = e.clientX + 'px';
  menu.style.top = e.clientY + 'px';
  menu.style.zIndex = 9999;
  menu.innerHTML = `
    <div class="cm-item" onclick="openChat('${esc(uin)}');this.closest('.context-menu').remove()">Send Message</div>
    <div class="cm-item" onclick="openUserInfo('${esc(uin)}');this.closest('.context-menu').remove()">View Info</div>
    <div class="cm-sep"></div>
    <div class="cm-item" onclick="deleteContact('${esc(uin)}');this.closest('.context-menu').remove()">Delete Contact</div>`;
  document.body.appendChild(menu);
  activeContextMenu = menu;
  setTimeout(() => {
    document.addEventListener('click', () => { menu.remove(); activeContextMenu = null; }, {once: true});
  }, 0);
}

async function deleteContact(uin) {
  if (!confirm('Remove this contact from your list?')) return;
  try {
    await api('DELETE', '/api/contacts/' + uin);
    await refreshContacts();
  } catch(e) { showNotification('Error', e.message); }
}

// ─── USER INFO ───
async function openUserInfo(uin) {
  try {
    const user = await api('GET', '/api/users/' + uin);
    document.getElementById('user-info-title').textContent = 'Info: ' + esc(user.nickname);
    const body = document.getElementById('user-info-body');
    body.innerHTML = `
      <div class="user-info-avatar">${esc(getInitials(user.nickname))}</div>
      <div class="user-info-grid">
        <div class="user-info-label">Nickname:</div><div class="user-info-val">${esc(user.nickname)}</div>
        <div class="user-info-label">UIN:</div><div class="user-info-val">${esc(user.uin)}</div>
        <div class="user-info-label">Name:</div><div class="user-info-val">${esc((user.first_name||'') + ' ' + (user.last_name||''))}</div>
        <div class="user-info-label">Age:</div><div class="user-info-val">${user.age ? esc(String(user.age)) : '-'}</div>
        <div class="user-info-label">Gender:</div><div class="user-info-val">${esc(user.gender||'-')}</div>
        <div class="user-info-label">Country:</div><div class="user-info-val">${esc(user.country||'-')}</div>
        <div class="user-info-label">City:</div><div class="user-info-val">${esc(user.city||'-')}</div>
        <div class="user-info-label">Status:</div><div class="user-info-val"><span class="status-dot small ${user.status||'offline'}"></span> ${esc(statusLabel(user.status))}</div>
        ${user.status_message ? `<div class="user-info-label">Status msg:</div><div class="user-info-val">${esc(user.status_message)}</div>` : ''}
        ${user.homepage ? `<div class="user-info-label">Homepage:</div><div class="user-info-val"><a href="${esc(user.homepage)}" target="_blank">${esc(user.homepage)}</a></div>` : ''}
        ${user.about ? `<div class="user-info-label">About:</div><div class="user-info-val">${esc(user.about)}</div>` : ''}
        <div class="user-info-label">Last seen:</div><div class="user-info-val">${user.last_seen ? formatDateTime(user.last_seen) : '-'}</div>
        <div class="user-info-label">Member since:</div><div class="user-info-val">${user.created_at ? formatDateTime(user.created_at) : '-'}</div>
      </div>
      <div class="dialog-buttons" style="margin-top:10px">
        <button class="btn-secondary" onclick="closeDialog('dialog-user-info')">Close</button>
        <button class="btn-primary" onclick="closeDialog('dialog-user-info');openChat('${esc(uin)}')">Send Message</button>
      </div>`;
    openDialog('dialog-user-info');
  } catch(e) { showNotification('Error', e.message); }
}

// ─── MY PROFILE ───
async function openMyProfile() {
  try {
    const user = await api('GET', '/api/users/' + myUin);
    document.getElementById('profile-nickname').value = user.nickname || '';
    document.getElementById('profile-firstname').value = user.first_name || '';
    document.getElementById('profile-lastname').value = user.last_name || '';
    document.getElementById('profile-age').value = user.age || '';
    document.getElementById('profile-gender').value = user.gender || 'unknown';
    document.getElementById('profile-status-msg').value = user.status_message || '';
    document.getElementById('profile-country').value = user.country || '';
    document.getElementById('profile-city').value = user.city || '';
    document.getElementById('profile-homepage').value = user.homepage || '';
    document.getElementById('profile-about').value = user.about || '';
    document.getElementById('profile-uin-num').textContent = myUin;
    document.getElementById('profile-error').textContent = '';
    switchProfileTab('general');
    openDialog('dialog-my-profile');
  } catch(e) { showNotification('Error', e.message); }
}

async function saveProfile() {
  const body = {
    nickname: document.getElementById('profile-nickname').value.trim(),
    first_name: document.getElementById('profile-firstname').value.trim(),
    last_name: document.getElementById('profile-lastname').value.trim(),
    age: parseInt(document.getElementById('profile-age').value) || 0,
    gender: document.getElementById('profile-gender').value,
    status_message: document.getElementById('profile-status-msg').value.trim(),
    country: document.getElementById('profile-country').value.trim(),
    city: document.getElementById('profile-city').value.trim(),
    homepage: document.getElementById('profile-homepage').value.trim(),
    about: document.getElementById('profile-about').value.trim()
  };
  if (!body.nickname) { document.getElementById('profile-error').textContent = 'Nickname required'; return; }
  try {
    await api('PUT', '/api/profile', body);
    myNickname = body.nickname;
    localStorage.setItem('qic_nick', myNickname);
    document.getElementById('my-nickname').textContent = myNickname;
    document.getElementById('my-avatar-img').textContent = getInitials(myNickname);
    closeDialog('dialog-my-profile');
    showNotification('Profile Saved', 'Your profile has been updated.');
  } catch(e) { document.getElementById('profile-error').textContent = e.message; }
}

function switchProfileTab(tab) {
  document.querySelectorAll('.profile-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.profile-tab-content').forEach(c => c.classList.remove('active'));
  document.querySelector(`.profile-tab[onclick="switchProfileTab('${tab}')"]`).classList.add('active');
  document.getElementById('profile-tab-' + tab).classList.add('active');
}

// ─── NOTIFICATIONS ───
let notifTimer = null;
function showNotification(title, text) {
  document.getElementById('notif-title').textContent = title;
  document.getElementById('notif-text').textContent = text;
  const notif = document.getElementById('notification-popup');
  notif.classList.remove('hidden');
  if (notifTimer) clearTimeout(notifTimer);
  notifTimer = setTimeout(hideNotification, 5000);
}
function hideNotification() {
  document.getElementById('notification-popup').classList.add('hidden');
}

// ─── INIT ───
document.addEventListener('DOMContentLoaded', async () => {
  // Auto-login if token stored
  if (token && myUin) {
    try {
      // Verify token still valid
      await api('GET', '/api/users/' + myUin);
      await startApp();
      return;
    } catch(e) {
      localStorage.removeItem('qic_token');
      localStorage.removeItem('qic_uin');
      localStorage.removeItem('qic_nick');
      token = null; myUin = null; myNickname = null;
    }
  }
  showScreen('screen-auth');
});

// Enter key on login form
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('login-password').addEventListener('keydown', e => {
    if (e.key === 'Enter') doLogin();
  });
  document.getElementById('login-uin').addEventListener('keydown', e => {
    if (e.key === 'Enter') doLogin();
  });
});

// Close dialogs on overlay click
document.addEventListener('DOMContentLoaded', () => {
  ['dialog-add-contact','dialog-search','dialog-user-info','dialog-my-profile'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', (e) => {
      if (e.target === el) closeDialog(id);
    });
  });
});

console.log('%cQIC Messenger 2.0 - I seek you!', 'color:#7cb900;font-size:16px;font-weight:bold');
