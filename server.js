const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');

const db = require('./src/database');
const { generateUIN } = require('./src/uin');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: { origin: '*' }
});

const JWT_SECRET = 'qic-secret-key-2001';
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Active socket connections: uin -> socket.id
const onlineUsers = new Map(); // uin -> { socketId, status }

function verifyToken(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ error: 'No token' });
  try {
    req.user = jwt.verify(auth.split(' ')[1], JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// ─── AUTH ─────────────────────────────────────────────────────────────────

app.post('/api/register', async (req, res) => {
  const { nickname, email, password, first_name, last_name, age, gender, country, city } = req.body;
  if (!nickname || !password) return res.status(400).json({ error: 'Nickname and password required' });

  try {
    const uin = generateUIN();
    const hash = await bcrypt.hash(password, 10);
    db.prepare(`
      INSERT INTO users (uin, nickname, email, password_hash, first_name, last_name, age, gender, country, city)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(uin, nickname, email || null, hash,
      first_name || '', last_name || '', age || 0,
      gender || 'unknown', country || '', city || '');

    const token = jwt.sign({ uin }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ uin, token, nickname });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(400).json({ error: 'Email already registered' });
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/login', async (req, res) => {
  const { uin, password } = req.body;
  if (!uin || !password) return res.status(400).json({ error: 'UIN and password required' });

  const user = db.prepare('SELECT * FROM users WHERE uin = ?').get(uin);
  if (!user) return res.status(401).json({ error: 'Invalid UIN or password' });

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return res.status(401).json({ error: 'Invalid UIN or password' });

  const token = jwt.sign({ uin: user.uin }, JWT_SECRET, { expiresIn: '30d' });
  res.json({
    uin: user.uin, token, nickname: user.nickname,
    first_name: user.first_name, last_name: user.last_name
  });
});

// ─── USER PROFILE ─────────────────────────────────────────────────────────

app.get('/api/users/:uin', verifyToken, (req, res) => {
  const user = db.prepare(
    'SELECT uin, nickname, first_name, last_name, age, gender, country, city, homepage, about, status, status_message, avatar, created_at, last_seen FROM users WHERE uin = ?'
  ).get(req.params.uin);
  if (!user) return res.status(404).json({ error: 'User not found' });

  // Override status with live data
  if (onlineUsers.has(user.uin)) {
    user.status = onlineUsers.get(user.uin).status || 'online';
  } else {
    user.status = 'offline';
  }
  res.json(user);
});

app.put('/api/profile', verifyToken, (req, res) => {
  const { nickname, first_name, last_name, age, gender, country, city, homepage, about, status_message } = req.body;
  db.prepare(`
    UPDATE users SET nickname=?, first_name=?, last_name=?, age=?, gender=?, country=?, city=?, homepage=?, about=?, status_message=?
    WHERE uin=?
  `).run(nickname || '', first_name || '', last_name || '', age || 0,
    gender || 'unknown', country || '', city || '', homepage || '',
    about || '', status_message || '', req.user.uin);
  res.json({ success: true });
});

// ─── SEARCH ───────────────────────────────────────────────────────────────

app.get('/api/search', verifyToken, (req, res) => {
  const { q, nickname, email } = req.query;
  let users;
  if (q) {
    const term = `%${q}%`;
    users = db.prepare(`
      SELECT uin, nickname, first_name, last_name, age, gender, country, city, status
      FROM users WHERE uin != ? AND (uin LIKE ? OR nickname LIKE ? OR first_name LIKE ? OR last_name LIKE ?)
      LIMIT 50
    `).all(req.user.uin, term, term, term, term);
  } else {
    users = db.prepare(`
      SELECT uin, nickname, first_name, last_name, age, gender, country, city, status
      FROM users WHERE uin != ? LIMIT 50
    `).all(req.user.uin);
  }

  // Update with live status
  users.forEach(u => {
    if (onlineUsers.has(u.uin)) {
      u.status = onlineUsers.get(u.uin).status || 'online';
    } else {
      u.status = 'offline';
    }
  });

  res.json(users);
});

// ─── CONTACTS ─────────────────────────────────────────────────────────────

app.get('/api/contacts', verifyToken, (req, res) => {
  const contacts = db.prepare(`
    SELECT c.contact_uin as uin, c.nickname as custom_nick, c.group_name,
           u.nickname, u.first_name, u.last_name, u.status_message, u.avatar
    FROM contacts c JOIN users u ON c.contact_uin = u.uin
    WHERE c.owner_uin = ?
    ORDER BY c.group_name, u.nickname
  `).all(req.user.uin);

  contacts.forEach(c => {
    if (onlineUsers.has(c.uin)) {
      c.status = onlineUsers.get(c.uin).status || 'online';
    } else {
      c.status = 'offline';
    }
  });

  res.json(contacts);
});

app.post('/api/contacts', verifyToken, (req, res) => {
  const { contact_uin, nickname, group_name } = req.body;
  if (!contact_uin) return res.status(400).json({ error: 'contact_uin required' });

  const target = db.prepare('SELECT uin FROM users WHERE uin = ?').get(contact_uin);
  if (!target) return res.status(404).json({ error: 'User not found' });
  if (contact_uin === req.user.uin) return res.status(400).json({ error: 'Cannot add yourself' });

  try {
    db.prepare(`
      INSERT INTO contacts (owner_uin, contact_uin, nickname, group_name)
      VALUES (?, ?, ?, ?)
    `).run(req.user.uin, contact_uin, nickname || '', group_name || 'General');
    res.json({ success: true });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(400).json({ error: 'Already in contacts' });
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/contacts/:uin', verifyToken, (req, res) => {
  db.prepare('DELETE FROM contacts WHERE owner_uin = ? AND contact_uin = ?')
    .run(req.user.uin, req.params.uin);
  res.json({ success: true });
});

// ─── MESSAGES ─────────────────────────────────────────────────────────────

app.get('/api/messages/:contactUin', verifyToken, (req, res) => {
  const messages = db.prepare(`
    SELECT * FROM messages
    WHERE (sender_uin = ? AND receiver_uin = ?) OR (sender_uin = ? AND receiver_uin = ?)
    ORDER BY sent_at ASC
    LIMIT 200
  `).all(req.user.uin, req.params.contactUin, req.params.contactUin, req.user.uin);

  // Mark as read
  db.prepare(`
    UPDATE messages SET is_read = 1
    WHERE sender_uin = ? AND receiver_uin = ? AND is_read = 0
  `).run(req.params.contactUin, req.user.uin);

  res.json(messages);
});

app.get('/api/unread', verifyToken, (req, res) => {
  const unread = db.prepare(`
    SELECT sender_uin, COUNT(*) as count FROM messages
    WHERE receiver_uin = ? AND is_read = 0
    GROUP BY sender_uin
  `).all(req.user.uin);
  res.json(unread);
});

// ─── SOCKET.IO ────────────────────────────────────────────────────────────

io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) return next(new Error('Authentication error'));
  try {
    socket.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    next(new Error('Authentication error'));
  }
});

io.on('connection', (socket) => {
  const uin = socket.user.uin;
  onlineUsers.set(uin, { socketId: socket.id, status: 'online' });

  db.prepare('UPDATE users SET status = ?, last_seen = CURRENT_TIMESTAMP WHERE uin = ?')
    .run('online', uin);

  // Notify contacts that this user came online
  broadcastStatusToContacts(uin, 'online');

  socket.on('set_status', (status) => {
    const validStatuses = ['online', 'away', 'na', 'dnd', 'ffc', 'invisible', 'offline'];
    if (!validStatuses.includes(status)) return;

    const userData = onlineUsers.get(uin) || {};
    userData.status = status === 'offline' ? 'invisible' : status;
    onlineUsers.set(uin, { ...userData, socketId: socket.id });

    db.prepare('UPDATE users SET status = ? WHERE uin = ?').run(status, uin);
    broadcastStatusToContacts(uin, status);
  });

  socket.on('send_message', (data) => {
    const { to, message, message_type } = data;
    if (!to || !message || message.trim().length === 0) return;
    if (message.length > 2000) return;
    if (!db.prepare('SELECT 1 FROM users WHERE uin = ?').get(to)) return;

    db.prepare(`
      INSERT OR IGNORE INTO contacts (owner_uin, contact_uin, group_name)
      VALUES (?, ?, 'Not in list')
    `).run(to, uin);

    const result = db.prepare(`
      INSERT INTO messages (sender_uin, receiver_uin, message, message_type)
      VALUES (?, ?, ?, ?)
    `).run(uin, to, message.trim(), message_type || 'text');

    const msgData = {
      id: result.lastInsertRowid,
      sender_uin: uin,
      receiver_uin: to,
      message: message.trim(),
      message_type: message_type || 'text',
      sent_at: new Date().toISOString()
    };

    // Send to recipient if online
    const recipientData = onlineUsers.get(to);
    if (recipientData) {
      io.to(recipientData.socketId).emit('new_message', msgData);
    }

    // Echo back to sender
    socket.emit('message_sent', msgData);
  });

  socket.on('typing', (data) => {
    const recipientData = onlineUsers.get(data.to);
    if (recipientData) {
      io.to(recipientData.socketId).emit('user_typing', { from: uin });
    }
  });

  socket.on('stop_typing', (data) => {
    const recipientData = onlineUsers.get(data.to);
    if (recipientData) {
      io.to(recipientData.socketId).emit('user_stop_typing', { from: uin });
    }
  });

  socket.on('disconnect', () => {
    onlineUsers.delete(uin);
    db.prepare('UPDATE users SET status = ?, last_seen = CURRENT_TIMESTAMP WHERE uin = ?')
      .run('offline', uin);
    broadcastStatusToContacts(uin, 'offline');
  });
});

function broadcastStatusToContacts(uin, status) {
  const contacts = db.prepare('SELECT owner_uin FROM contacts WHERE contact_uin = ?').all(uin);
  contacts.forEach(c => {
    const ownerData = onlineUsers.get(c.owner_uin);
    if (ownerData) {
      io.to(ownerData.socketId).emit('contact_status', { uin, status });
    }
  });
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`QIC Server running on http://0.0.0.0:${PORT}`);
});
