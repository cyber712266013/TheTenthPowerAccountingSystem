import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import path from 'path';
import fs from 'fs/promises';

const LOCAL_STORAGE_DIR = path.join(process.cwd(), 'uploads');

// ─── GET /api/documents/[id] ─────────────────────────────────

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const document = await prisma.document.findUnique({
      where: { id },
      include: {
        uploadedBy: { select: { id: true, name: true, email: true } },
        invoice: {
          include: { items: true, party: { select: { id: true, name: true, type: true } } },
        },
        transactions: {
          include: {
            party: { select: { id: true, name: true } },
            createdBy: { select: { name: true } },
            approvedBy: { select: { name: true } },
          },
          orderBy: { createdAt: 'desc' },
        },
        auditLogs: {
          include: { user: { select: { name: true } } },
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
      },
    });

    if (!document) {
      return NextResponse.json({ success: false, error: 'المستند غير موجود' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      data: {
        id: document.id,
        fileName: document.fileName,
        originalFileName: document.originalFileName,
        mimeType: document.mimeType,
        fileSizeBytes: document.fileSizeBytes,
        processingStatus: document.processingStatus,
        overallConfidence: document.overallConfidence
          ? parseFloat(document.overallConfidence.toString())
          : null,
        warnings: document.warnings,
        googleDriveFileId: document.googleDriveFileId,
        googleDriveViewLink: document.googleDriveViewLink,
        rawExtraction: document.rawExtraction,
        extractedData: document.extractedData,
        processingError: document.processingError,
        processingAttempts: document.processingAttempts,
        uploadedAt: document.uploadedAt,
        uploadedBy: document.uploadedBy,
        invoice: document.invoice,
        transactions: document.transactions.map(tx => ({
          ...tx,
          onUs: parseFloat(tx.onUs.toString()),
          forUs: parseFloat(tx.forUs.toString()),
          balanceBefore: parseFloat(tx.balanceBefore.toString()),
          balanceAfter: parseFloat(tx.balanceAfter.toString()),
          amount: parseFloat(tx.amount.toString()),
        })),
        auditLogs: document.auditLogs,
        metadata: document.metadata,
        customFields: document.customFields,
      },
    });
  } catch (error) {
    console.error('[Document GET]', error);
    return NextResponse.json({ success: false, error: 'فشل تحميل المستند' }, { status: 500 });
  }
}

import { directionToDebit, recalculateStatement, round4 } from '@/lib/calculations';
import { normalizeArabicText } from '@/lib/validations';

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

// ─── PATCH /api/documents/[id] — تعديل بيانات المستند والحركة المرتبطة ───

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json();

    const document = await prisma.document.findUnique({
      where: { id },
      include: {
        invoice: { include: { items: true } },
        transactions: true,
      },
    });

    if (!document) {
      return NextResponse.json({ success: false, error: 'المستند غير موجود' }, { status: 404 });
    }

    const oldCustomFields = (document.customFields as Record<string, unknown>) || {};
    const oldMeta = (document.metadata as Record<string, unknown>) || {};
    const oldExtracted = (document.extractedData as Record<string, unknown>) || {};

    const updateDocData: Record<string, unknown> = {};
    if (body.fileName !== undefined && body.fileName.trim()) {
      updateDocData.fileName = body.fileName.trim();
    }
    if (body.notes !== undefined) {
      updateDocData.metadata = { ...oldMeta, notes: body.notes };
    }
    if (body.customFields !== undefined) {
      updateDocData.customFields = { ...oldCustomFields, ...body.customFields };
    }
    if (body.processingStatus !== undefined) {
      updateDocData.processingStatus = body.processingStatus;
    }

    // ─── التعامل مع الطرف (Party) ──────────────────────────
    let partyId = body.partyId;
    if (!partyId && body.partyName && body.partyName.trim()) {
      const trimmed = body.partyName.trim();
      const norm = normalizeArabicText(trimmed);
      let p = await prisma.party.findFirst({
        where: {
          OR: [
            { normalizedName: norm },
            { name: { equals: trimmed, mode: 'insensitive' } },
          ],
        },
      });
      if (!p) {
        p = await prisma.party.create({
          data: {
            name: trimmed,
            normalizedName: norm,
            type: 'other',
            metadata: { createdFromDocument: id },
          },
        });
      }
      partyId = p.id;
    }

    // ─── تحديث الفاتورة (Invoice) إن وُجدت مبالغ أو بيانات مالية ───
    const hasFinancialData =
      body.total !== undefined ||
      body.invoiceNumber !== undefined ||
      body.invoiceDate !== undefined ||
      partyId !== undefined;

    if (hasFinancialData) {
      const invoiceValues = {
        partyId: partyId !== undefined ? partyId : document.invoice?.partyId,
        partyNameRaw: body.partyName !== undefined ? body.partyName : document.invoice?.partyNameRaw,
        invoiceNumber: body.invoiceNumber !== undefined ? (body.invoiceNumber || null) : document.invoice?.invoiceNumber,
        invoiceDate: body.invoiceDate ? new Date(body.invoiceDate) : document.invoice?.invoiceDate,
        currency: body.currency || document.invoice?.currency || 'SAR',
        subtotal: body.subtotal !== undefined ? body.subtotal : (document.invoice?.subtotal || 0),
        taxAmount: body.taxAmount !== undefined ? body.taxAmount : (document.invoice?.taxAmount || 0),
        discount: body.discount !== undefined ? body.discount : (document.invoice?.discount || 0),
        total: body.total !== undefined ? body.total : (document.invoice?.total || 0),
        paidAmount: body.paidAmount !== undefined ? body.paidAmount : (document.invoice?.paidAmount || 0),
        remainingAmount: body.remainingAmount !== undefined ? body.remainingAmount : (document.invoice?.remainingAmount || 0),
        notes: body.notes !== undefined ? body.notes : document.invoice?.notes,
      };

      let currentInvoiceId = document.invoice?.id;
      if (!currentInvoiceId) {
        const createdInv = await prisma.invoice.create({
          data: {
            documentId: id,
            ...invoiceValues,
          },
        });
        currentInvoiceId = createdInv.id;
      } else {
        await prisma.invoice.update({
          where: { id: currentInvoiceId },
          data: invoiceValues,
        });
      }

      // تحديث البنود إذا تم تمريرها
      if (Array.isArray(body.items)) {
        await prisma.invoiceItem.deleteMany({ where: { invoiceId: currentInvoiceId } });
        if (body.items.length > 0) {
          await prisma.invoiceItem.createMany({
            data: body.items.map((it: any, idx: number) => {
              const rawRate = parseNumeric(it.taxRate ?? it.tax_rate);
              const taxRate = rawRate != null ? (rawRate > 1 ? rawRate / 100 : rawRate) : null;
              return {
                invoiceId: currentInvoiceId!,
                lineNumber: idx + 1,
                description: parseString(it.description) || '',
                unit: parseString(it.unit) || null,
                quantity: parseNumeric(it.quantity),
                unitPrice: parseNumeric(it.unitPrice ?? it.unit_price),
                taxRate,
                taxAmount: parseNumeric(it.taxAmount ?? it.tax_amount),
                discount: parseNumeric(it.discount),
                total: parseNumeric(it.total) ?? 0,
                notes: parseString(it.notes) || null,
                extraFields: (typeof it.extraFields === 'object' && it.extraFields !== null && !('value' in it.extraFields)) ? it.extraFields : {},
              };
            }),
          });
        }
      }
    }

    // ─── تحديث البيانات المستخرجة في المستند (extractedData) ───
    updateDocData.extractedData = {
      ...oldExtracted,
      document_type: body.documentType || oldExtracted.document_type || 'invoice',
      invoice_number: { value: body.invoiceNumber ?? oldExtracted.invoice_number ?? null, confidence: 1 },
      invoice_date: { value: body.invoiceDate ?? oldExtracted.invoice_date ?? null, confidence: 1 },
      party: {
        name: { value: body.partyName ?? (oldExtracted as any)?.party?.name?.value ?? null, confidence: 1 },
        type: { value: 'other', confidence: 1 },
      },
      financial: {
        subtotal: { value: body.subtotal ?? (oldExtracted as any)?.financial?.subtotal?.value ?? 0, confidence: 1 },
        tax_amount: { value: body.taxAmount ?? (oldExtracted as any)?.financial?.tax_amount?.value ?? 0, confidence: 1 },
        discount: { value: body.discount ?? (oldExtracted as any)?.financial?.discount?.value ?? 0, confidence: 1 },
        total: { value: body.total ?? (oldExtracted as any)?.financial?.total?.value ?? 0, confidence: 1 },
        paid: { value: body.paidAmount ?? (oldExtracted as any)?.financial?.paid?.value ?? 0, confidence: 1 },
        remaining: { value: body.remainingAmount ?? (oldExtracted as any)?.financial?.remaining?.value ?? 0, confidence: 1 },
        currency: { value: body.currency || 'SAR', confidence: 1 },
      },
      transaction: {
        direction: { value: body.direction || 'gave', confidence: 1 },
        operation: { value: body.operationType || 'invoice', confidence: 1 },
        amount: { value: body.total ?? 0, confidence: 1 },
        description: { value: body.details || body.notes || '', confidence: 1 },
      },
      items: Array.isArray(body.items) ? body.items : (oldExtracted.items || []),
    };

    const updated = await prisma.document.update({
      where: { id },
      data: updateDocData,
    });

    // ─── إذا كان المستند معتمداً بالفعل وله حركات مالية: حدّث الحركة فوراً في كشف الحساب ───
    if (document.transactions && document.transactions.length > 0) {
      for (const tx of document.transactions) {
        const oldPartyId = tx.partyId;
        const newPartyId = partyId || tx.partyId;
        const newTotal = body.total !== undefined ? parseFloat(String(body.total)) : parseFloat(tx.amount.toString());
        const newDirection = body.direction || tx.direction;
        const { onUs, forUs } = directionToDebit(newDirection, newTotal);
        const newDate = body.transactionDate || body.invoiceDate
          ? new Date(body.transactionDate || body.invoiceDate)
          : tx.transactionDate;
        const newDetails = body.details || body.notes || tx.details;
        const newOperation = body.operationType || tx.operationType;

        await prisma.transaction.update({
          where: { id: tx.id },
          data: {
            partyId: newPartyId,
            amount: newTotal,
            onUs: round4(onUs),
            forUs: round4(forUs),
            direction: newDirection,
            operationType: newOperation,
            transactionDate: newDate,
            details: newDetails,
            currency: body.currency || tx.currency,
          },
        });

        // إعادة حساب أرصدة الطرف أو الطرفين (إذا تغيّر الطرف)
        const partiesToRecalc = Array.from(new Set([oldPartyId, newPartyId].filter(Boolean))) as string[];
        for (const pId of partiesToRecalc) {
          const partyTx = await prisma.transaction.findMany({
            where: { partyId: pId, status: 'approved' },
            select: { id: true, onUs: true, forUs: true, transactionDate: true, createdAt: true },
            orderBy: [{ transactionDate: 'asc' }, { createdAt: 'asc' }],
          });

          const partyObj = await prisma.party.findUnique({
            where: { id: pId },
            select: { openingBalance: true },
          });

          const recalculated = recalculateStatement(
            partyTx.map(t => ({
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
        }
      }
    }

    const userId = (await prisma.user.findFirst({ select: { id: true } }))?.id || '';
    await logAudit({
      userId,
      entityType: 'document',
      entityId: id,
      action: 'update',
      oldValue: { fileName: document.fileName, status: document.processingStatus },
      newValue: { ...updateDocData, partyId, total: body.total },
    });

    return NextResponse.json({
      success: true,
      message: 'تم حفظ التعديلات بنجاح في نفس المستند وتحديث كشف الحساب',
      data: { id: updated.id, fileName: updated.fileName },
    });
  } catch (error) {
    console.error('[Document PATCH]', error);
    return NextResponse.json({ success: false, error: 'فشل تعديل المستند' }, { status: 500 });
  }
}

// ─── DELETE /api/documents/[id] — حذف المستند ───────────────

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const document = await prisma.document.findUnique({
      where: { id },
      select: {
        id: true,
        fileName: true,
        metadata: true,
        transactions: { select: { id: true, status: true } },
      },
    });

    if (!document) {
      return NextResponse.json({ success: false, error: 'المستند غير موجود' }, { status: 404 });
    }

    // منع حذف مستند عليه حركات معتمدة
    const approvedTx = document.transactions.filter(t => t.status === 'approved');
    if (approvedTx.length > 0) {
      return NextResponse.json({
        success: false,
        error: `لا يمكن حذف المستند — عليه ${approvedTx.length} حركة مالية معتمدة. يجب إلغاؤها أولاً.`,
      }, { status: 400 });
    }

    // حذف الملف المحلي
    try {
      const meta = document.metadata as Record<string, unknown> | null;
      const localPath = meta?.localStoragePath as string | undefined;
      if (localPath) {
        await fs.unlink(localPath).catch(() => {});
      } else {
        const files = await fs.readdir(LOCAL_STORAGE_DIR).catch(() => [] as string[]);
        const match = files.find(f => f.startsWith(id));
        if (match) await fs.unlink(path.join(LOCAL_STORAGE_DIR, match)).catch(() => {});
      }
    } catch { /* ignore */ }

    // حذف cascade
    await prisma.$transaction([
      prisma.auditLog.deleteMany({ where: { documentId: id } }),
      prisma.transaction.deleteMany({ where: { documentId: id } }),
      prisma.invoiceItem.deleteMany({ where: { invoice: { documentId: id } } }),
      prisma.invoice.deleteMany({ where: { documentId: id } }),
      prisma.document.delete({ where: { id } }),
    ]);

    return NextResponse.json({ success: true, message: 'تم حذف المستند بنجاح' });
  } catch (error) {
    console.error('[Document DELETE]', error);
    return NextResponse.json({ success: false, error: 'فشل حذف المستند' }, { status: 500 });
  }
}
