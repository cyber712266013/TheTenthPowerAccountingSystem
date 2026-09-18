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

// ─── PATCH /api/documents/[id] — تعديل بيانات المستند ────────

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json();

    const document = await prisma.document.findUnique({
      where: { id },
      select: { id: true, fileName: true, customFields: true, metadata: true },
    });

    if (!document) {
      return NextResponse.json({ success: false, error: 'المستند غير موجود' }, { status: 404 });
    }

    const oldCustomFields = (document.customFields as Record<string, unknown>) || {};
    const oldMeta = (document.metadata as Record<string, unknown>) || {};

    const updateData: Record<string, unknown> = {};
    if (body.fileName !== undefined && body.fileName.trim()) {
      updateData.fileName = body.fileName.trim();
    }
    if (body.notes !== undefined) {
      updateData.metadata = { ...oldMeta, notes: body.notes };
    }
    if (body.customFields !== undefined) {
      updateData.customFields = { ...oldCustomFields, ...body.customFields };
    }
    if (body.processingStatus !== undefined) {
      updateData.processingStatus = body.processingStatus;
    }

    const updated = await prisma.document.update({ where: { id }, data: updateData });

    const userId = (await prisma.user.findFirst({ select: { id: true } }))?.id || '';
    await logAudit({
      userId,
      entityType: 'document',
      entityId: id,
      action: 'update',
      oldValue: { fileName: document.fileName, customFields: oldCustomFields },
      newValue: updateData,
    });

    return NextResponse.json({ success: true, data: { id: updated.id, fileName: updated.fileName } });
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
