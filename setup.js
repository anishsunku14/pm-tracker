const readline = require('readline');
const bcrypt = require('bcryptjs');
const { initDb, dbRun, dbGet, dbAll } = require('./db/database');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
function ask(question) { return new Promise(resolve => rl.question(question, resolve)); }

async function setup() {
  console.log('');
  console.log('══════════════════════════════════════════════════');
  console.log('   P.M. OFFSET PRINTERS — Account Setup');
  console.log('══════════════════════════════════════════════════');
  console.log('');

  await initDb();

  const headAdmin = dbGet("SELECT * FROM users WHERE role = 'head_admin'");

  if (!headAdmin) {
    console.log('--- Setting up HEAD ADMIN account ---');
    console.log('');

    const username = await ask('Head Admin username: ');
    const password = await ask('Head Admin password: ');
    const secQuestion = await ask('Security question (for password recovery): ');
    const secAnswer = await ask('Security answer: ');

    const hashed = bcrypt.hashSync(password, 10);
    dbRun('INSERT INTO users (username, password, role, security_question, security_answer) VALUES (?, ?, ?, ?, ?)',
      [username.toLowerCase().trim(), hashed, 'head_admin', secQuestion.trim(), secAnswer.toLowerCase().trim()]);

    console.log('');
    console.log('✅ Head Admin "' + username + '" created!');
    console.log('');
  } else {
    console.log('Head Admin already exists: "' + headAdmin.username + '"');
    console.log('');
  }

  const addMore = await ask('Would you like to add a team member? (yes/no): ');

  if (addMore.toLowerCase().startsWith('y')) {
    let adding = true;
    while (adding) {
      console.log('');
      console.log('--- New Team Member ---');
      const username = await ask('Username: ');
      const password = await ask('Password: ');
      const secQuestion = await ask('Security question: ');
      const secAnswer = await ask('Security answer: ');

      const existing = dbGet('SELECT id FROM users WHERE username = ?', [username.toLowerCase().trim()]);
      if (existing) {
        console.log('⚠️  Username "' + username + '" already exists. Skipping.');
      } else {
        const hashed = bcrypt.hashSync(password, 10);
        dbRun('INSERT INTO users (username, password, role, security_question, security_answer) VALUES (?, ?, ?, ?, ?)',
          [username.toLowerCase().trim(), hashed, 'staff', secQuestion.trim(), secAnswer.toLowerCase().trim()]);
        console.log('✅ Team member "' + username + '" created!');
      }

      const more = await ask('\nAdd another team member? (yes/no): ');
      adding = more.toLowerCase().startsWith('y');
    }
  }

  const users = dbAll('SELECT username, role, created_at FROM users ORDER BY created_at ASC');
  console.log('');
  console.log('--- All Accounts ---');
  users.forEach(u => {
    console.log('  ' + (u.role === 'head_admin' ? '👑' : '👤') + ' ' + u.username + ' (' + u.role + ')');
  });

  console.log('');
  console.log('✅ Setup complete! Start the server with: npm start');
  console.log('');
  rl.close();
}

setup().catch(err => {
  console.error('Setup error:', err);
  rl.close();
  process.exit(1);
});
