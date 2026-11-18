const mysql = require('mysql2/promise');
const { EmailCrypto } = require('../emailUtils');
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

async function addEmailPassword(emailAddress, password) {
  const db = mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
  });

  const crypto = new EmailCrypto();
  
  try {
    const encryptedPassword = crypto.encryptPassword(password);
    
    const [result] = await db.execute(
      'UPDATE server_email_accounts SET email_password_encrypted = ? WHERE email_address = ?',
      [encryptedPassword, emailAddress]
    );

    if (result.affectedRows > 0) {
      console.log(`✅ Password added for ${emailAddress}`);
      
      // Test decryption
      const decrypted = crypto.decryptPassword(encryptedPassword);
      console.log(`🔍 Decryption test: ${decrypted === password ? 'PASSED' : 'FAILED'}`);
    } else {
      console.log(`❌ Email account ${emailAddress} not found`);
    }
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await db.end();
  }
}

// Usage: node add-email-password.js email@example.com password123
if (process.argv.length < 4) {
  console.log('Usage: node add-email-password.js <email> <password>');
  process.exit(1);
}

const email = process.argv[2];
const password = process.argv[3];

addEmailPassword(email, password);