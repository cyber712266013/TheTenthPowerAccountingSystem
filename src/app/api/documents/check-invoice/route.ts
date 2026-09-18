import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const invoiceNumber = searchParams.get('number')?.trim();
    const excludeDocId = searchParams.get('excludeId')?.trim();

    if (!invoiceNumber) {
      return NextResponse.json({ exists: false });
    }

    // 1. ابحث عن جميع الفواتير المطابقة لرقم الفاتورة
    const matchingInvoices = await prisma.invoice.findMany({
      where: {
        invoiceNumber: {
          equals: invoiceNumber,
          mode: 'insensitive',
        },
      },
      include: {
        document: {
          select: { id: true, fileName: true, processingStatus: true, uploadedAt: true },
        },
        party: {
          select: { id: true, name: true },
        },
        transaction: {
          select: { id: true, status: true, amount: true, transactionDate: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // 2. ابحث أيضاً في الحركات المالية التي تحمل نفس المرجع (reference)
    const matchingTransactions = await prisma.transaction.findMany({
      where: {
        reference: {
          equals: invoiceNumber,
          mode: 'insensitive',
        },
      },
      include: {
        document: {
          select: { id: true, fileName: true, processingStatus: true },
        },
        party: {
          select: { id: true, name: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    let otherDoc = null;
    let currentDoc = null;

    // فحص الفواتير
    for (const inv of matchingInvoices) {
      const isApproved =
        inv.document?.processingStatus === 'approved' ||
        inv.transaction?.status === 'approved';

      const info = {
        documentId: inv.documentId,
        fileName: inv.document?.fileName || '',
        partyName: inv.party?.name || inv.partyNameRaw || '',
        total: parseFloat(inv.total.toString()),
        isApproved,
        status: inv.document?.processingStatus || 'uploaded',
        invoiceNumber: inv.invoiceNumber || invoiceNumber,
        transactionId: inv.transaction?.id,
      };

      if (excludeDocId && inv.documentId === excludeDocId) {
        if (!currentDoc) currentDoc = info;
      } else {
        if (!otherDoc || (!otherDoc.isApproved && isApproved)) {
          otherDoc = info;
        }
      }
    }

    // فحص الحركات إذا لم نجد مستنداً آخر
    if (!otherDoc) {
      for (const tx of matchingTransactions) {
        if (!tx.documentId || (excludeDocId && tx.documentId === excludeDocId)) {
          if (!currentDoc && tx.documentId === excludeDocId) {
            currentDoc = {
              documentId: tx.documentId,
              fileName: tx.document?.fileName || '',
              partyName: tx.party?.name || '',
              total: parseFloat(tx.amount.toString()),
              isApproved: tx.status === 'approved',
              status: tx.document?.processingStatus || 'approved',
              invoiceNumber,
              transactionId: tx.id,
            };
          }
          continue;
        }

        otherDoc = {
          documentId: tx.documentId,
          fileName: tx.document?.fileName || '',
          partyName: tx.party?.name || '',
          total: parseFloat(tx.amount.toString()),
          isApproved: tx.status === 'approved',
          status: tx.document?.processingStatus || 'approved',
          invoiceNumber,
          transactionId: tx.id,
        };
        break;
      }
    }

    const exists = matchingInvoices.length > 0 || matchingTransactions.length > 0;
    const isApproved = Boolean(otherDoc?.isApproved || currentDoc?.isApproved);

    return NextResponse.json({
      exists,
      isApproved,
      otherDocument: otherDoc,
      currentDocument: currentDoc,
      totalMatches: matchingInvoices.length + matchingTransactions.length,
      // للحفاظ على التوافق مع أي استدعاءات سابقة
      partyName: otherDoc?.partyName || currentDoc?.partyName,
      total: otherDoc?.total || currentDoc?.total,
      documentId: otherDoc?.documentId || currentDoc?.documentId,
      invoiceNumber,
    });
  } catch (error) {
    console.error('[Check Invoice Error]', error);
    return NextResponse.json({ exists: false, error: String(error) });
  }
}
