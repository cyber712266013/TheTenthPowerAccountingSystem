import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { recalculateStatement, round4 } from '@/lib/calculations';
import { logAudit } from '@/lib/audit';

// ─── Void a transaction ────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { reason } = await req.json();
    const userId = (await prisma.user.findFirst({ select: { id: true } }))?.id || '';

    const tx = await prisma.transaction.findUnique({
      where: { id },
      select: { id: true, status: true, partyId: true, onUs: true, forUs: true },
    });

    if (!tx) return NextResponse.json({ success: false, error: 'الحركة غير موجودة' }, { status: 404 });
    if (tx.status !== 'approved') {
      return NextResponse.json({ success: false, error: 'يمكن إلغاء الحركات المعتمدة فقط' });
    }

    await prisma.transaction.update({
      where: { id },
      data: { status: 'voided', voidedAt: new Date(), voidReason: reason },
    });

    // Recalculate balances for the party
    if (tx.partyId) {
      const allTx = await prisma.transaction.findMany({
        where: { partyId: tx.partyId, status: 'approved' },
        select: { id: true, onUs: true, forUs: true, transactionDate: true, createdAt: true },
        orderBy: [{ transactionDate: 'asc' }, { createdAt: 'asc' }],
      });

      const party = await prisma.party.findUnique({
        where: { id: tx.partyId },
        select: { openingBalance: true },
      });

      const recalculated = recalculateStatement(
        allTx.map(t => ({
          id: t.id,
          onUs: parseFloat(t.onUs.toString()),
          forUs: parseFloat(t.forUs.toString()),
          transactionDate: t.transactionDate,
          createdAt: t.createdAt,
        })),
        parseFloat((party?.openingBalance || 0).toString())
      );

      for (const calc of recalculated) {
        await prisma.transaction.update({
          where: { id: calc.id },
          data: { balanceBefore: round4(calc.balanceBefore), balanceAfter: round4(calc.balanceAfter) },
        });
      }
    }

    await logAudit({
      userId,
      entityType: 'transaction',
      entityId: id,
      action: 'void',
      reason,
      oldValue: { status: 'approved' },
      newValue: { status: 'voided' },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Void Transaction]', error);
    return NextResponse.json({ success: false, error: 'فشل إلغاء الحركة' }, { status: 500 });
  }
}
