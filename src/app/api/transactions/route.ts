import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { recalculateStatement, round4 } from '@/lib/calculations';

// ─── GET: Account Statement ────────────────────────────────

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const partyId = searchParams.get('partyId');
  const fromDate = searchParams.get('fromDate');
  const toDate = searchParams.get('toDate');
  const operationType = searchParams.get('operationType');
  const status = searchParams.get('status') || 'approved';
  const search = searchParams.get('search');
  const page = parseInt(searchParams.get('page') || '1');
  const pageSize = parseInt(searchParams.get('pageSize') || '50');

  try {
    const where: Record<string, unknown> = {};

    if (partyId) where.partyId = partyId;
    if (status) where.status = status;
    if (operationType) where.operationType = operationType;

    if (fromDate || toDate) {
      where.transactionDate = {};
      if (fromDate) (where.transactionDate as Record<string, unknown>).gte = new Date(fromDate);
      if (toDate) (where.transactionDate as Record<string, unknown>).lte = new Date(toDate + 'T23:59:59');
    }

    if (search) {
      where.OR = [
        { details: { contains: search, mode: 'insensitive' } },
        { reference: { contains: search, mode: 'insensitive' } },
        { party: { name: { contains: search, mode: 'insensitive' } } },
        { invoice: { invoiceNumber: { contains: search, mode: 'insensitive' } } },
      ];
    }

    const [transactions, total] = await Promise.all([
      prisma.transaction.findMany({
        where,
        include: {
          party: { select: { id: true, name: true, type: true } },
          invoice: { select: { id: true, invoiceNumber: true } },
          document: { select: { id: true, fileName: true, googleDriveViewLink: true } },
          createdBy: { select: { id: true, name: true } },
          approvedBy: { select: { id: true, name: true } },
        },
        orderBy: [{ transactionDate: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.transaction.count({ where }),
    ]);

    // ─── Summary ───────────────────────────────────────────
    const summary = await prisma.transaction.aggregate({
      where: { ...where, status: 'approved' },
      _sum: { onUs: true, forUs: true, amount: true },
      _count: true,
    });

    return NextResponse.json({
      success: true,
      data: {
        transactions: transactions.map(tx => ({
          id: tx.id,
          transactionDate: tx.transactionDate,
          details: tx.details,
          reference: tx.reference,
          operationType: tx.operationType,
          direction: tx.direction,
          onUs: parseFloat(tx.onUs.toString()),         // عليه
          forUs: parseFloat(tx.forUs.toString()),       // له
          balanceBefore: parseFloat(tx.balanceBefore.toString()),
          balanceAfter: parseFloat(tx.balanceAfter.toString()),
          currency: tx.currency,
          status: tx.status,
          party: tx.party,
          invoice: tx.invoice,
          document: tx.document,
          createdBy: tx.createdBy,
          approvedBy: tx.approvedBy,
          approvedAt: tx.approvedAt,
          notes: tx.notes,
        })),
        pagination: {
          page,
          pageSize,
          total,
          totalPages: Math.ceil(total / pageSize),
        },
        summary: {
          totalTransactions: summary._count,
          totalOnUs: parseFloat((summary._sum.onUs || 0).toString()),    // إجمالي عليه
          totalForUs: parseFloat((summary._sum.forUs || 0).toString()),  // إجمالي له
        },
      },
    });
  } catch (error) {
    console.error('[Statement API Error]', error);
    return NextResponse.json({ success: false, error: 'فشل جلب كشف الحساب' }, { status: 500 });
  }
}

// ─── POST: Recalculate balances ────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const { partyId } = await req.json();

    // Get all approved transactions for party
    const where = partyId
      ? { partyId, status: 'approved' as const }
      : { status: 'approved' as const };

    const transactions = await prisma.transaction.findMany({
      where,
      select: {
        id: true,
        onUs: true,
        forUs: true,
        transactionDate: true,
        createdAt: true,
        partyId: true,
      },
      orderBy: [{ transactionDate: 'asc' }, { createdAt: 'asc' }],
    });

    // Group by party
    const byParty = new Map<string, typeof transactions>();
    for (const tx of transactions) {
      if (!tx.partyId) continue;
      const list = byParty.get(tx.partyId) || [];
      list.push(tx);
      byParty.set(tx.partyId, list);
    }

    let updatedCount = 0;

    for (const [pid, txList] of byParty) {
      const party = await prisma.party.findUnique({
        where: { id: pid },
        select: { openingBalance: true },
      });

      const openingBalance = parseFloat((party?.openingBalance || 0).toString());

      const recalculated = recalculateStatement(
        txList.map(tx => ({
          id: tx.id,
          onUs: parseFloat(tx.onUs.toString()),
          forUs: parseFloat(tx.forUs.toString()),
          transactionDate: tx.transactionDate,
          createdAt: tx.createdAt,
        })),
        openingBalance
      );

      // Batch update
      for (const calc of recalculated) {
        await prisma.transaction.update({
          where: { id: calc.id },
          data: {
            balanceBefore: round4(calc.balanceBefore),
            balanceAfter: round4(calc.balanceAfter),
          },
        });
        updatedCount++;
      }
    }

    return NextResponse.json({
      success: true,
      updatedTransactions: updatedCount,
      partiesRecalculated: byParty.size,
    });
  } catch (error) {
    console.error('[Recalculate API Error]', error);
    return NextResponse.json(
      { success: false, error: 'فشل إعادة حساب الأرصدة' },
      { status: 500 }
    );
  }
}
