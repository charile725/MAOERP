const bcrypt = require('bcryptjs');

const password = process.argv[2];

if (!password) {
  console.error('請提供密碼作為參數');
  console.error('用法: node scripts/generate-password.js <password>');
  console.error('範例: node scripts/generate-password.js mypassword123');
  process.exit(1);
}

const hash = bcrypt.hashSync(password, 10);

console.log('\n=================================');
console.log('密碼雜湊已生成');
console.log('=================================');
console.log('\n密碼:', password);
console.log('\n雜湊:', hash);
console.log('\n使用以下 SQL 新增用戶：');
console.log('\nINSERT INTO users (username, password_hash, role, is_active)');
console.log('VALUES (');
console.log("  '你的帳號',");
console.log(`  '${hash}',`);
console.log("  'boss',  -- 或 'employee'");
console.log('  true');
console.log(');');
console.log('\n=================================\n');
