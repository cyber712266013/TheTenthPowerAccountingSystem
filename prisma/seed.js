// Quick seed script — creates admin user and sample parties
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 إنشاء بيانات أولية...\n');

  // Admin user
  const hash = await bcrypt.hash('admin123', 12);
  const admin = await prisma.user.upsert({
    where: { email: 'admin@system.local' },
    update: {},
    create: {
      name: 'المدير',
      email: 'admin@system.local',
      password: hash,
      role: 'admin',
    },
  });
  console.log('✓ المستخدم:', admin.email);
  console.log('  كلمة المرور: admin123');

  // Sample parties
  const partiesData = [
    { name: 'شركة الأنظمة التقنية', type: 'supplier' },
    { name: 'مؤسسة الرياض للتجارة', type: 'customer' },
    { name: 'أحمد محمد العمري', type: 'person' },
  ];

  for (const p of partiesData) {
    await prisma.party.create({
      data: {
        name: p.name,
        normalizedName: p.name.replace(/[ًٌٍَُِّْ]/g, '').toLowerCase(),
        type: p.type,
        openingBalance: 0,
        aliases: [],
      },
    }).catch(() => {});
  }
  console.log('✓ تم إنشاء', partiesData.length, 'طرف تجريبي');

  console.log('\n✅ جاهز! افتح: http://localhost:3000/login');
}

main()
  .catch(e => { console.error('❌ خطأ:', e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
