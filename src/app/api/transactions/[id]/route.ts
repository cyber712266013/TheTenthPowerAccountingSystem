import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// ─── GET /api/transactions/[id] — تفاصيل حركة مالية ─────────

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const tx = await prisma.transaction.findUnique({
      where: { id },
      include: {
        party: { select: { id: true, name: true, type: true } },
        document: { select: { id: true, fileName: true, mimeType: true } },
        createdBy:  { select: { id: true, name: true } },
        approvedBy: { select: { id: true, name: true } },
        invoice: {
          select: {
            id: true,
            invoiceNumber: true,
            invoiceDate: true,
            total: true,
            paidAmount: true,
            remainingAmount: true,
          },
        },
      },
    });

    if (!tx) {
      return NextResponse.json({ success: false, error: 'الحركة المالية غير موجودة' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      data: {
        id: tx.id,
        transactionDate: tx.transactionDate,
        details: tx.details,
        reference: tx.reference,
        operationType: tx.operationType,
        direction: tx.direction,
        amount: parseFloat(tx.amount.toString()),
        onUs: parseFloat(tx.onUs.toString()),
        forUs: parseFloat(tx.forUs.toString()),
        balanceBefore: parseFloat(tx.balanceBefore.toString()),
        balanceAfter: parseFloat(tx.balanceAfter.toString()),
        currency: tx.currency,
        status: tx.status,
        notes: tx.notes,
        extraFields: tx.extraFields,
        metadata: tx.metadata,
        createdAt: tx.createdAt,
        approvedAt: tx.approvedAt,
        voidedAt: tx.voidedAt,
        voidReason: tx.voidReason,
        party: tx.party,
        document: tx.document,
        invoice: tx.invoice ? {
          ...tx.invoice,
          total: parseFloat(tx.invoice.total.toString()),
          paidAmount: parseFloat(tx.invoice.paidAmount.toString()),
          remainingAmount: parseFloat(tx.invoice.remainingAmount.toString()),
        } : null,
        createdBy: tx.createdBy,
        approvedBy: tx.approvedBy,
      },
    });
  } catch (error) {
    console.error('[Transaction GET]', error);
    return NextResponse.json({ success: false, error: 'فشل تحميل الحركة' }, { status: 500 });
  }
}
