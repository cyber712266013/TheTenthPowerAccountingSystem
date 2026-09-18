import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  try {
    const [
      totalDocuments,
      pendingReview,
      failedAnalysis,
      totalTransactions,
      aggregates,
      recentTransactions,
    ] = await Promise.all([
      prisma.document.count(),
      prisma.document.count({ where: { processingStatus: 'needs_review' } }),
      prisma.document.count({ where: { processingStatus: 'failed' } }),
      prisma.transaction.count({ where: { status: 'approved' } }),
      prisma.transaction.aggregate({
        where: { status: 'approved' },
        _sum: { onUs: true, forUs: true },
      }),
      prisma.transaction.findMany({
        where: { status: 'approved' },
        orderBy: [{ transactionDate: 'desc' }, { createdAt: 'desc' }],
        take: 10,
        include: {
          party: { select: { name: true } },
        },
      }),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        totalDocuments,
        pendingReview,
        failedAnalysis,
        totalTransactions,
        totalOnUs: parseFloat((aggregates._sum.onUs || 0).toString()),
        totalForUs: parseFloat((aggregates._sum.forUs || 0).toString()),
        recentTransactions: recentTransactions.map(tx => ({
          id: tx.id,
          transactionDate: tx.transactionDate,
          details: tx.details,
          onUs: parseFloat(tx.onUs.toString()),
          forUs: parseFloat(tx.forUs.toString()),
          balanceAfter: parseFloat(tx.balanceAfter.toString()),
          party: tx.party,
        })),
      },
    });
  } catch (error) {
    console.error('[Dashboard API]', error);
    return NextResponse.json({ success: false, error: 'فشل تحميل البيانات' }, { status: 500 });
  }
}
