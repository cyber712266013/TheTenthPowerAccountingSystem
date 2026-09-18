import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';

async function main() {
  console.log('🌱 بدء Seed قاعدة البيانات...\n');

  // ─── Create admin user ─────────────────────────────────
  const adminPassword = await bcrypt.hash('admin123', 12);
  const admin = await prisma.user.upsert({
    where: { email: 'admin@system.local' },
    update: {},
    create: {
      name: 'المدير',
      email: 'admin@system.local',
      password: adminPassword,
      role: 'admin',
    },
  });
  console.log('✓ تم إنشاء المستخدم:', admin.email, '| كلمة المرور: admin123');

  // ─── Create sample parties ────────────────────────────
  const parties = [
    { name: 'شركة الأنظمة التقنية', normalizedName: 'شركة الانظمة التقنية', type: 'supplier' as const },
    { name: 'مؤسسة الرياض للتجارة', normalizedName: 'مؤسسة الرياض للتجارة', type: 'customer' as const },
    { name: 'أحمد محمد العمري', normalizedName: 'احمد محمد العمري', type: 'person' as const },
  ];

  for (const p of parties) {
    await prisma.party.upsert({
      where: { id: p.name },
      update: {},
      create: {
        id: Buffer.from(p.name).toString('base64').slice(0, 25),
        name: p.name,
        normalizedName: p.normalizedName,
        type: p.type,
        openingBalance: 0,
        aliases: [],
      },
    }).catch(async () => {
      // If ID conflict, just create
      await prisma.party.create({
        data: {
          name: p.name,
          normalizedName: p.normalizedName,
          type: p.type,
          openingBalance: 0,
          aliases: [],
        },
      });
    });
  }

  console.log('✓ تم إنشاء', parties.length, 'طرف تجريبي');
  console.log('\n✅ اكتمل Seed بنجاح!\n');
  console.log('بيانات الدخول:');
  console.log('  البريد: admin@system.local');
  console.log('  كلمة المرور: admin123');
  console.log('  الرابط: http://localhost:3000/login\n');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
