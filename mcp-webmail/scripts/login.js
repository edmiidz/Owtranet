import readline from 'readline';
import { BASE_URL, TOKEN_PATH, saveToken } from '../lib/api.js';

const KEY_ENTER = ['\n', '\r'];
const KEY_CTRL_D = '';
const KEY_CTRL_C = '';
const KEY_BACKSPACE = ['', ''];

function askEmail(promptText) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(promptText, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function askPassword(promptText) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) {
      reject(new Error('No TTY available for masked password input. Set INTRANET_PASSWORD instead.'));
      return;
    }

    process.stdout.write(promptText);
    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    let password = '';

    const cleanup = () => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('data', onData);
    };

    function onData(char) {
      if (KEY_ENTER.includes(char) || char === KEY_CTRL_D) {
        cleanup();
        process.stdout.write('\n');
        resolve(password);
        return;
      }
      if (char === KEY_CTRL_C) {
        cleanup();
        process.stdout.write('\n');
        reject(new Error('Login cancelled'));
        return;
      }
      if (KEY_BACKSPACE.includes(char)) {
        if (password.length > 0) {
          password = password.slice(0, -1);
          process.stdout.write('\b \b');
        }
        return;
      }
      password += char;
      process.stdout.write('*');
    }

    stdin.on('data', onData);
  });
}

async function main() {
  console.log(`Signing in to ${BASE_URL} ...`);

  const email = process.env.INTRANET_EMAIL || (await askEmail('Intranet email or username: '));
  const password = process.env.INTRANET_PASSWORD || (await askPassword('Password: '));

  const res = await fetch(new URL('/api/auth/login', BASE_URL), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok || !data.token) {
    console.error(`Login failed (HTTP ${res.status}): ${data.error || 'unknown error'}`);
    process.exit(1);
  }

  saveToken(data.token);
  console.log(`Signed in as ${data.user?.email || email}. Token saved to ${TOKEN_PATH}.`);
  console.log('This JWT expires in 7 days — re-run "npm run login" when webmail tools start failing with an auth error.');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
