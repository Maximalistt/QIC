const db = require('./database');

function generateUIN() {
  // ICQ UINs are numeric, starting from ~10000000 in early 2000s
  const min = 10000000;
  const max = 999999999;
  let uin;
  let attempts = 0;
  do {
    uin = String(Math.floor(Math.random() * (max - min + 1)) + min);
    attempts++;
    if (attempts > 100) throw new Error('Could not generate unique UIN');
  } while (db.prepare('SELECT id FROM users WHERE uin = ?').get(uin));
  return uin;
}

module.exports = { generateUIN };
