const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('--- بدء فحص ودمج الأطراف المكررة ---');

  const parties = await prisma.party.findMany({
    include: {
      _count: { select: { transactions: true, invoices: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  const map = {};
  for (const p of parties) {
    const key = p.normalizedName || p.name.trim();
    if (!map[key]) map[key] = [];
    map[key].push(p);
  }

  let totalDeleted = 0;
  let totalMerged = 0;

  for (const [key, group] of Object.entries(map)) {
    if (group.length <= 1) continue;

    console.log(`\nمعالجة المجموعة: "${group[0].name}" (العدد: ${group.length})`);

    // اختيار الطرف الأساسي: الذي لديه حركات أو فواتير، أو الأقدم
    group.sort((a, b) => {
      const aUsage = a._count.transactions + a._count.invoices;
      const bUsage = b._count.transactions + b._count.invoices;
      if (bUsage !== aUsage) return bUsage - aUsage;
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });

    const primary = group[0];
    const duplicates = group.slice(1);

    console.log(`  الطرف الأساسي المعتمد: ID=${primary.id} (حركات: ${primary._count.transactions}, فواتير: ${primary._count.invoices})`);

    for (const dup of duplicates) {
      // 1. إعادة توجيه الفواتير إن وجدت
      if (dup._count.invoices > 0) {
        const updatedInvs = await prisma.invoice.updateMany({
          where: { partyId: dup.id },
          data: { partyId: primary.id },
        });
        console.log(`    تم نقل ${updatedInvs.count} فاتورة من ${dup.id} إلى الأساسي`);
      }

      // 2. إعادة توجيه الحركات إن وجدت
      if (dup._count.transactions > 0) {
        const updatedTxs = await prisma.transaction.updateMany({
          where: { partyId: dup.id },
          data: { partyId: primary.id },
        });
        console.log(`    تم نقل ${updatedTxs.count} حركة مالية من ${dup.id} إلى الأساسي`);
        totalMerged += updatedTxs.count;
      }

      // 3. حذف الطرف المكرر
      await prisma.party.delete({
        where: { id: dup.id },
      });
      console.log(`    🗑️ تم حذف الطرف المكرر الفارغ: ID=${dup.id}`);
      totalDeleted++;
    }
  }

  console.log(`\n✅ تم الانتهاء: تم حذف ${totalDeleted} طرف مكرر، وإعادة ربط ${totalMerged} حركة.`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('خطأ أثناء الدمج:', err);
  process.exit(1);
});
