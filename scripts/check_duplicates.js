const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const parties = await prisma.party.findMany({
    include: { _count: { select: { transactions: true, invoices: true } } }
  });

  const map = {};
  for (const p of parties) {
    const key = p.normalizedName || p.name.trim();
    if (!map[key]) map[key] = [];
    map[key].push(p);
  }

  const duplicates = Object.entries(map).filter(([k, list]) => list.length > 1);
  console.log('Duplicate groups found:', duplicates.length);

  for (const [k, list] of duplicates) {
    console.log(`\nGroup: "${k}" (count: ${list.length})`);
    list.forEach(p => {
      console.log(`  ID: ${p.id} | Name: "${p.name}" | TX: ${p._count.transactions} | INV: ${p._count.invoices}`);
    });
  }

  await prisma.$disconnect();
}

main().catch(console.error);
