// AES-256-GCM field-level encryption for sensitive payroll values (SIN, banking).
// Key: PAYROLL_ENCRYPTION_KEY env var — 64 hex chars (32 bytes). Generate per
// instance with `openssl rand -hex 32`. Never commit the key; never log values.
// Stored format: iv (12 bytes) || auth tag (16 bytes) || ciphertext, as a Buffer
// (VARBINARY column).

const crypto = require('crypto');

const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function getKey() {
  const hex = process.env.PAYROLL_ENCRYPTION_KEY;
  if (!hex || !/^[0-9a-fA-F]{64}$/.test(hex)) return null;
  return Buffer.from(hex, 'hex');
}

function hasKey() {
  return getKey() !== null;
}

function encryptField(plaintext) {
  const key = getKey();
  if (!key) throw new Error('PAYROLL_ENCRYPTION_KEY is not configured');
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
}

function decryptField(stored) {
  const key = getKey();
  if (!key) throw new Error('PAYROLL_ENCRYPTION_KEY is not configured');
  const buf = Buffer.isBuffer(stored) ? stored : Buffer.from(stored);
  const iv = buf.subarray(0, IV_LENGTH);
  const tag = buf.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = buf.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

// --- Canadian payroll field validation (strip spaces/dashes first) ---

function normalizeDigits(value) {
  return String(value || '').replace(/[\s-]/g, '');
}

// SIN: 9 digits passing the Luhn check.
function isValidSIN(value) {
  const sin = normalizeDigits(value);
  if (!/^\d{9}$/.test(sin)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    let d = parseInt(sin[i], 10);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

function isValidInstitution(value) {
  return /^\d{3}$/.test(normalizeDigits(value));
}

function isValidTransit(value) {
  return /^\d{5}$/.test(normalizeDigits(value));
}

function isValidAccount(value) {
  return /^\d{7,12}$/.test(normalizeDigits(value));
}

module.exports = {
  hasKey,
  encryptField,
  decryptField,
  normalizeDigits,
  isValidSIN,
  isValidInstitution,
  isValidTransit,
  isValidAccount,
};
