import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  calculateBalance,
  directionToDebit,
  validateInvoiceAmounts,
  validateItemsTotal,
  round4,
  recalculateStatement,
} from '@/lib/calculations';
import { normalizeArabicText } from '@/lib/validations';
import { logAudit, logFieldChanges } from '@/lib/audit';
import type { ReviewFormData } from '@/lib/types';

function parseNumeric(val: unknown): number | null {
  if (val === null || val === undefined) return null;
  if (typeof val === 'object' && val !== null && 'value' in val) {
    return parseNumeric((val as { value: unknown }).value);
  }
  if (typeof val === 'number') return isNaN(val) ? null : val;
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (!trimmed) return null;
    const num = parseFloat(trimmed);
    return isNaN(num) ? null : num;
  }
  return null;
}

function parseString(val: unknown): string | null {
  if (val === null || val === undefined) return null;
  if (typeof val === 'object' && val !== null && 'value' in val) {
    return parseString((val as { value: unknown }).value);
  }
  if (typeof val === 'string') return val;
  return String(val);
}

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
      include: {
        invoice: true,
        transactions: {
          select: { id: true, status: true },
          take: 1,
        },
      },
    });

    if (!document) {
      return NextResponse.json({ success: false, error: 'المستند غير موجود' }, { status: 404 });
    }

    const userId = body.userId || (await prisma.user.findFirst())?.id || '';

    // ─── Handle Party ─────────────────────────────────────────
    let partyId = body.partyId;

    if (!partyId && body.partyName && body.partyName.trim()) {
      const trimmedName = body.partyName.trim();
      const norm = normalizeArabicText(trimmedName);

      // فحص هل الطرف موجود مسبقاً لمنع التكرار
      const existingParty = await prisma.party.findFirst({
        where: {
          OR: [
            { normalizedName: norm },
            { name: { equals: trimmedName, mode: 'insensitive' } },
          ],
        },
      });

      if (existingParty) {
        partyId = existingParty.id;
      } else {
        const newParty = await prisma.party.create({
          data: {
            name: trimmedName,
            normalizedName: norm,
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
          newValue: { name: trimmedName, source: 'document_review' },
          documentId: id,
        });
      }
    }

    const bodySubtotal = parseNumeric(body.subtotal) ?? 0;
    const bodyTaxAmount = parseNumeric(body.taxAmount) ?? 0;
    const bodyDiscount = parseNumeric(body.discount) ?? 0;
    const bodyTotal = parseNumeric(body.total) ?? 0;
    const bodyPaidAmount = parseNumeric(body.paidAmount) ?? 0;
    const bodyRemainingAmount = parseNumeric(body.remainingAmount) ?? 0;

    // ─── Server-side amount validation ────────────────────────
    const amountValidation = validateInvoiceAmounts({
      subtotal: bodySubtotal,
      taxAmount: bodyTaxAmount,
      discount: bodyDiscount,
      total: bodyTotal,
      paidAmount: bodyPaidAmount,
      remainingAmount: bodyRemainingAmount,
    });

    // ─── Validate items ───────────────────────────────────────
    const itemsValidation =
      body.items.length > 0
        ? validateItemsTotal(body.items, bodySubtotal)
        : { isValid: true, itemsSum: bodySubtotal, discrepancy: 0 };

    // ─── Get party's last balance ─────────────────────────────
    let balanceBefore = 0;
    if (partyId) {
      const party = await prisma.party.findUnique({
        where: { id: partyId },
        select: { openingBalance: true },
      });

      const existingTxId = document.transactions?.[0]?.id;
      const lastTx = await prisma.transaction.findFirst({
        where: {
          partyId,
          status: { in: ['approved'] },
          ...(existingTxId ? { NOT: { id: existingTxId } } : {}),
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
    const { onUs, forUs } = directionToDebit(body.direction, bodyTotal);
    const balanceAfter = calculateBalance(balanceBefore, onUs, forUs);

    // ─── Prepare invoice and item data ────────────────────────
    const invoiceData = {
      partyId,
      partyNameRaw: body.partyName,
      invoiceNumber: body.invoiceNumber || null,
      invoiceDate: body.invoiceDate ? new Date(body.invoiceDate) : null,
      currency: body.currency,
      subtotal: bodySubtotal,
      taxAmount: bodyTaxAmount,
      discount: bodyDiscount,
      total: bodyTotal,
      paidAmount: bodyPaidAmount,
      remainingAmount: amountValidation.calculatedRemaining ?? bodyRemainingAmount,
      itemsTotalCalculated: itemsValidation.itemsSum,
      hasMathDiscrepancy: !amountValidation.isValid || !itemsValidation.isValid,
      discrepancyDetails: [
        ...(amountValidation.warnings || []),
        ...(itemsValidation.warning ? [itemsValidation.warning] : []),
      ].join('; ') || null,
      notes: body.notes || null,
      extraFields: body.extraFields || {},
    };

    const rawItems = Array.isArray(body.items) ? body.items : [];
    const preparedItems = rawItems.map((item: any, idx: number) => {
      const rawRate = parseNumeric(item.taxRate ?? item.tax_rate);
      const taxRate = rawRate != null ? (rawRate > 1 ? rawRate / 100 : rawRate) : null;
      return {
        lineNumber: idx + 1,
        description: parseString(item.description) || '',
        unit: parseString(item.unit) || null,
        quantity: parseNumeric(item.quantity),
        unitPrice: parseNumeric(item.unitPrice ?? item.unit_price),
        taxRate,
        taxAmount: parseNumeric(item.taxAmount ?? item.tax_amount),
        discount: parseNumeric(item.discount),
        total: parseNumeric(item.total) ?? 0,
        notes: parseString(item.notes) || null,
        extraFields:
          typeof item.extraFields === 'object' && item.extraFields !== null && !('value' in item.extraFields)
            ? item.extraFields
            : {},
      };
    });

    const existingTx = document.transactions?.[0];

    // ─── Database Transaction ─────────────────────────────────
    const result = await prisma.$transaction(
      async (tx) => {
        // 1. Upsert Invoice
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
        if (preparedItems.length > 0) {
          await tx.invoiceItem.createMany({
            data: preparedItems.map((item) => ({
              invoiceId: invoice!.id,
              ...item,
            })),
          });
        }

        // 3. Upsert Transaction (update if already exists, else create)
        // القاعدة: balanceAfter = balanceBefore + onUs - forUs
        const txPayload = {
          partyId,
          documentId: id,
          invoiceId: invoice.id,
          transactionDate: new Date(body.transactionDate || body.invoiceDate || new Date()),
          details: body.details || body.notes || 'فاتورة معتمدة',
          operationType: body.operationType || 'invoice',
          direction: body.direction || 'gave',
          amount: bodyTotal,
          onUs: round4(onUs),        // عليه
          forUs: round4(forUs),      // له
          balanceBefore: round4(balanceBefore),
          balanceAfter: round4(balanceAfter),
          currency: body.currency || 'SAR',
          notes: body.notes || null,
          extraFields: body.extraFields || {},
          status: 'approved' as const,
          approvedById: userId,
          approvedAt: new Date(),
        };

        let transaction;
        if (existingTx) {
          transaction = await tx.transaction.update({
            where: { id: existingTx.id },
            data: txPayload,
          });
        } else {
          transaction = await tx.transaction.create({
            data: {
              ...txPayload,
              createdById: userId,
            },
          });
        }

        // 4. Update document status
        await tx.document.update({
          where: { id },
          data: { processingStatus: 'approved' },
        });

        return { invoice, transaction };
      },
      {
        maxWait: 15000,
        timeout: 45000,
      }
    );

    // ─── Recalculate Party Statement if needed ───────────────
    if (partyId) {
      try {
        const partyTx = await prisma.transaction.findMany({
          where: { partyId, status: 'approved' },
          select: { id: true, onUs: true, forUs: true, transactionDate: true, createdAt: true },
          orderBy: [{ transactionDate: 'asc' }, { createdAt: 'asc' }],
        });

        const partyObj = await prisma.party.findUnique({
          where: { id: partyId },
          select: { openingBalance: true },
        });

        const recalculated = recalculateStatement(
          partyTx.map((t) => ({
            id: t.id,
            onUs: parseFloat(t.onUs.toString()),
            forUs: parseFloat(t.forUs.toString()),
            transactionDate: t.transactionDate,
            createdAt: t.createdAt,
          })),
          parseFloat((partyObj?.openingBalance || 0).toString())
        );

        for (const calc of recalculated) {
          await prisma.transaction.update({
            where: { id: calc.id },
            data: { balanceBefore: round4(calc.balanceBefore), balanceAfter: round4(calc.balanceAfter) },
          });
        }
      } catch (err) {
        console.warn('[Approve] Error recalculating party statement:', err);
      }
    }

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
      {
        success: false,
        error: 'حدث خطأ أثناء اعتماد المستند',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
