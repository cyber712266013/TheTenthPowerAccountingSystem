import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// Export account statement as Excel/CSV/PDF

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const format = searchParams.get('format') || 'excel';
  const partyId = searchParams.get('partyId') || '';
  const fromDate = searchParams.get('fromDate') || '';
  const toDate = searchParams.get('toDate') || '';

  const where: Record<string, unknown> = { status: 'approved' };
  if (partyId) where.partyId = partyId;
  if (fromDate || toDate) {
    where.transactionDate = {};
    if (fromDate) (where.transactionDate as Record<string, unknown>).gte = new Date(fromDate);
    if (toDate) (where.transactionDate as Record<string, unknown>).lte = new Date(toDate + 'T23:59:59');
  }

  const transactions = await prisma.transaction.findMany({
    where,
    include: {
      party: { select: { name: true } },
      invoice: { select: { invoiceNumber: true } },
    },
    orderBy: [{ transactionDate: 'asc' }, { createdAt: 'asc' }],
  });

  const rows = transactions.map(tx => ({
    التاريخ: tx.transactionDate.toLocaleDateString('ar-SA'),
    الطرف: tx.party?.name || '',
    البيان: tx.details,
    'رقم الفاتورة': tx.invoice?.invoiceNumber || '',
    'نوع العملية': tx.operationType,
    عليه: parseFloat(tx.onUs.toString()),
    له: parseFloat(tx.forUs.toString()),
    الرصيد: parseFloat(tx.balanceAfter.toString()),
    العملة: tx.currency,
  }));

  if (format === 'csv') {
    const headers = Object.keys(rows[0] || {}).join(',');
    const csvRows = rows.map(r => Object.values(r).join(','));
    const csv = [headers, ...csvRows].join('\n');

    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="statement-${Date.now()}.csv"`,
      },
    });
  }

  if (format === 'excel') {
    const xlsx = await import('xlsx');
    const ws = xlsx.utils.json_to_sheet(rows);
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, 'كشف الحساب');

    const buf = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });

    return new NextResponse(buf, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="statement-${Date.now()}.xlsx"`,
      },
    });
  }

  // PDF — basic text for now
  return new NextResponse(JSON.stringify({ transactions: rows }, null, 2), {
    headers: { 'Content-Type': 'application/json' },
  });
}
