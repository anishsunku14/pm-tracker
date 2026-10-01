// Keeps sign-ins in a small file (data/sessions.json) so they survive server restarts.
const fs = require('fs');
const path = require('path');
const session = require('express-session');

class FileSessionStore extends session.Store {
  constructor(file) {
    super();
    this.file = file;
    this.data = {};
    this.timer = null;
    try {
      this.data = JSON.parse(fs.readFileSync(file, 'utf8')) || {};
    } catch (e) {
      this.data = {};
    }
    this.prune();
    // Clear out expired sign-ins once an hour
    setInterval(() => this.prune(), 60 * 60 * 1000).unref();
  }

  expired(s) {
    return s && s.cookie && s.cookie.expires && new Date(s.cookie.expires) < new Date();
  }

  // Write at most once a second, and atomically (temp file, then rename)
  persist() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      const tmp = this.file + '.tmp';
      fs.writeFile(tmp, JSON.stringify(this.data), { mode: 0o600 }, (err) => {
        if (!err) fs.rename(tmp, this.file, () => {});
      });
    }, 1000);
  }

  prune() {
    let changed = false;
    Object.keys(this.data).forEach((sid) => {
      if (this.expired(this.data[sid])) { delete this.data[sid]; changed = true; }
    });
    if (changed) this.persist();
  }

  get(sid, cb) {
    const s = this.data[sid];
    if (!s) return cb(null, null);
    if (this.expired(s)) {
      delete this.data[sid];
      this.persist();
      return cb(null, null);
    }
    cb(null, JSON.parse(JSON.stringify(s)));
  }

  set(sid, sess, cb) {
    this.data[sid] = JSON.parse(JSON.stringify(sess));
    this.persist();
    if (cb) cb(null);
  }

  destroy(sid, cb) {
    delete this.data[sid];
    this.persist();
    if (cb) cb(null);
  }

  touch(sid, sess, cb) {
    if (this.data[sid]) {
      this.data[sid].cookie = JSON.parse(JSON.stringify(sess.cookie));
      this.persist();
    }
    if (cb) cb(null);
  }
}

function createStore(dataDir) {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  return new FileSessionStore(path.join(dataDir, 'sessions.json'));
}

module.exports = { createStore, FileSessionStore };
