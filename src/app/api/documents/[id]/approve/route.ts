import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { calculateBalance, directionToDebit, validateInvoiceAmounts, validateItemsTotal, round4 } from '@/lib/calculations';
import { normalizeArabicText } from '@/lib/validations';
import { logAudit, logFieldChanges } from '@/lib/audit';
import type { ReviewFormData } from '@/lib/types';

// ─── Approve Document & Create Transaction ─────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const body: ReviewFormData & { userId?: string } = await req.json();

    // ─── Get document ────────────────────────────────────────
    const document = await prisma.document.findUnique({
      where: { id },
      include: { invoice: true },
    });

    if (!document) {
      return NextResponse.json({ success: false, error: 'المستند غير موجود' }, { status: 404 });
    }

    const userId = body.userId || (await prisma.user.findFirst())?.id || '';

    // ─── Handle Party ─────────────────────────────────────────
    let partyId = body.partyId;

    if (!partyId && body.partyName) {
      // Create new party
      const newParty = await prisma.party.create({
        data: {
          name: body.partyName,
          normalizedName: normalizeArabicText(body.partyName),
          type: 'other',
          metadata: { createdFromDocument: id },
        },
      });
      partyId = newParty.id;

      await logAudit({
        userId,
        entityType: 'party',
        entityId: newParty.id,
        action: 'create',
        newValue: { name: body.partyName, source: 'document_review' },
        documentId: id,
      });
    }

    // ─── Server-side amount validation ────────────────────────
    const amountValidation = validateInvoiceAmounts({
      subtotal: body.subtotal,
      taxAmount: body.taxAmount,
      discount: body.discount,
      total: body.total,
      paidAmount: body.paidAmount,
      remainingAmount: body.remainingAmount,
    });

    // ─── Validate items ───────────────────────────────────────
    const itemsValidation =
      body.items.length > 0
        ? validateItemsTotal(body.items, body.subtotal)
        : { isValid: true, itemsSum: body.subtotal, discrepancy: 0 };

    // ─── Get party's last balance ─────────────────────────────
    let balanceBefore = 0;
    if (partyId) {
      const party = await prisma.party.findUnique({
        where: { id: partyId },
        select: { openingBalance: true },
      });

      const lastTx = await prisma.transaction.findFirst({
        where: {
          partyId,
          status: { in: ['approved'] },
        },
        orderBy: [{ transactionDate: 'desc' }, { createdAt: 'desc' }],
        select: { balanceAfter: true },
      });

      balanceBefore = lastTx
        ? parseFloat(lastTx.balanceAfter.toString())
        : parseFloat((party?.openingBalance || 0).toString());
    }

    // ─── Calculate transaction ────────────────────────────────
    // القاعدة الثابتة: balanceAfter = balanceBefore + onUs - forUs
    const { onUs, forUs } = directionToDebit(body.direction, body.total);
    const balanceAfter = calculateBalance(balanceBefore, onUs, forUs);

    // ─── Database Transaction ─────────────────────────────────
    const result = await prisma.$transaction(async (tx) => {
      // 1. Upsert Invoice
      const invoiceData = {
        partyId,
        partyNameRaw: body.partyName,
        invoiceNumber: body.invoiceNumber || null,
        invoiceDate: body.invoiceDate ? new Date(body.invoiceDate) : null,
        currency: body.currency,
        subtotal: body.subtotal,
        taxAmount: body.taxAmount,
        discount: body.discount,
        total: body.total,
        paidAmount: body.paidAmount,
        remainingAmount: amountValidation.calculatedRemaining ?? body.remainingAmount,
        itemsTotalCalculated: itemsValidation.itemsSum,
        hasMathDiscrepancy: !amountValidation.isValid || !itemsValidation.isValid,
        discrepancyDetails: [
          ...(amountValidation.warnings || []),
          ...(itemsValidation.warning ? [itemsValidation.warning] : []),
        ].join('; ') || null,
        notes: body.notes || null,
        extraFields: body.extraFields || {},
      };

      let invoice = document.invoice;
      if (!invoice) {
        invoice = await tx.invoice.create({
          data: {
            documentId: id,
            ...invoiceData,
          },
        });
      } else {
        invoice = await tx.invoice.update({
          where: { id: invoice.id },
          data: invoiceData,
        });
      }

      // 2. Delete and recreate items
      await tx.invoiceItem.deleteMany({ where: { invoiceId: invoice.id } });
      if (body.items.length > 0) {
        await tx.invoiceItem.createMany({
          data: body.items.map((item, idx) => ({
            invoiceId: invoice!.id,
            lineNumber: idx + 1,
            description: item.description,
            unit: item.unit || null,
            quantity: item.quantity ?? null,
            unitPrice: item.unitPrice ?? null,
            taxRate: item.taxRate ?? null,
            taxAmount: item.taxAmount ?? null,
            discount: item.discount ?? null,
            total: item.total,
            notes: item.notes || null,
            extraFields: item.extraFields || {},
          })),
        });
      }

      // 3. Create Transaction
      // القاعدة: balanceAfter = balanceBefore + onUs - forUs
      const transaction = await tx.transaction.create({
        data: {
          partyId,
          documentId: id,
          invoiceId: invoice.id,
          transactionDate: new Date(body.transactionDate),
          details: body.details,
          operationType: body.operationType,
          direction: body.direction,
          amount: body.total,
          onUs: round4(onUs),        // عليه
          forUs: round4(forUs),      // له
          balanceBefore: round4(balanceBefore),
          balanceAfter: round4(balanceAfter),
          currency: body.currency,
          notes: body.notes || null,
          extraFields: body.extraFields || {},
          status: 'approved',
          createdById: userId,
          approvedById: userId,
          approvedAt: new Date(),
        },
      });

      // 4. Update document status
      await tx.document.update({
        where: { id },
        data: { processingStatus: 'approved' },
      });

      return { invoice, transaction };
    });

    // ─── Audit Log ────────────────────────────────────────────
    await logAudit({
      userId,
      entityType: 'document',
      entityId: id,
      action: 'approve',
      newValue: {
        transactionId: result.transaction.id,
        invoiceId: result.invoice.id,
        total: body.total,
        direction: body.direction,
        onUs,
        forUs,
        balanceBefore,
        balanceAfter,
      },
      documentId: id,
    });

    return NextResponse.json({
      success: true,
      transactionId: result.transaction.id,
      invoiceId: result.invoice.id,
      balance: {
        before: balanceBefore,
        onUs,
        forUs,
        after: balanceAfter,
      },
      mathWarnings: !amountValidation.isValid ? amountValidation.warnings : [],
    });
  } catch (error) {
    console.error('[Approve API Error]', error);
    return NextResponse.json(
      { success: false, error: 'حدث خطأ أثناء اعتماد المستند' },
      { status: 500 }
    );
  }
}
