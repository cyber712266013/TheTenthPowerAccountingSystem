import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { calculateBalance, directionToDebit, round4 } from '@/lib/calculations';
import { logAudit } from '@/lib/audit';
import type { OperationType, TransactionDirection, Currency } from '@/lib/types';

// ─── POST: Create manual transaction ──────────────────────

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      partyId,
      transactionDate,
      details,
      operationType,
      direction,
      amount,
      currency,
      reference,
      notes,
      documentId,
      // مرونة: أي حقول إضافية
      extraFields,
      metadata,
    } = body;

    if (!partyId || !transactionDate || !details || !direction || !amount) {
      return NextResponse.json(
        { success: false, error: 'الحقول المطلوبة: الطرف، التاريخ، البيان، الاتجاه، المبلغ' },
        { status: 400 }
      );
    }

    // Get user
    const userId = (await prisma.user.findFirst({ select: { id: true } }))?.id || '';

    // Get last balance for this party
    const party = await prisma.party.findUnique({
      where: { id: partyId },
      select: { openingBalance: true },
    });

    const lastTx = await prisma.transaction.findFirst({
      where: { partyId, status: 'approved' },
      orderBy: [{ transactionDate: 'desc' }, { createdAt: 'desc' }],
      select: { balanceAfter: true },
    });

    const balanceBefore = lastTx
      ? parseFloat(lastTx.balanceAfter.toString())
      : parseFloat((party?.openingBalance || 0).toString());

    // القاعدة الثابتة: balanceAfter = balanceBefore + onUs - forUs
    const { onUs, forUs } = directionToDebit(direction as TransactionDirection, parseFloat(amount));
    const balanceAfter = calculateBalance(balanceBefore, onUs, forUs);

    const transaction = await prisma.transaction.create({
      data: {
        partyId,
        documentId: documentId || null,
        transactionDate: new Date(transactionDate),
        details,
        reference: reference || null,
        operationType: (operationType as OperationType) || 'manual',
        direction: direction as TransactionDirection,
        amount: round4(parseFloat(amount)),
        onUs: round4(onUs),
        forUs: round4(forUs),
        balanceBefore: round4(balanceBefore),
        balanceAfter: round4(balanceAfter),
        currency: (currency as Currency) || 'SAR',
        notes: notes || null,
        status: 'approved',
        createdById: userId,
        approvedById: userId,
        approvedAt: new Date(),
        // مرونة: حقول إضافية
        extraFields: extraFields || {},
        metadata: metadata || null,
      },
    });

    await logAudit({
      userId,
      entityType: 'transaction',
      entityId: transaction.id,
      action: 'create',
      newValue: {
        partyId,
        amount,
        direction,
        onUs,
        forUs,
        balanceBefore,
        balanceAfter,
        manual: true,
      },
    });

    return NextResponse.json({
      success: true,
      transactionId: transaction.id,
      balance: { before: balanceBefore, onUs, forUs, after: balanceAfter },
    });
  } catch (error) {
    console.error('[Create Transaction]', error);
    return NextResponse.json({ success: false, error: 'فشل إنشاء الحركة المالية' }, { status: 500 });
  }
}
