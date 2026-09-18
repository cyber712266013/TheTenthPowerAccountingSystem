import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { analyzeDocument } from '@/lib/gemini';
import { validateGeminiExtraction, checkForDuplicates, matchParty } from '@/lib/validations';
import { downloadFileBuffer } from '@/lib/google-drive';
import { logAudit } from '@/lib/audit';
import path from 'path';
import fs from 'fs/promises';

const LOCAL_STORAGE_DIR = path.join(process.cwd(), 'uploads');

// ─── قراءة الملف: من Drive أو من التخزين المحلي ─────────────
async function getFileBuffer(document: {
  id: string;
  googleDriveFileId: string | null;
  fileName: string;
  metadata: unknown;
}): Promise<Buffer> {
  // 1️⃣ جرب Google Drive أولاً
  if (document.googleDriveFileId) {
    try {
      const buf = await downloadFileBuffer(document.googleDriveFileId);
      console.log(`[Analyze] ✅ قُرئ من Drive: ${document.googleDriveFileId}`);
      return buf;
    } catch (driveErr) {
      console.warn(`[Analyze] ⚠️ فشل قراءة Drive: ${driveErr instanceof Error ? driveErr.message : driveErr}`);
    }
  }

  // 2️⃣ جرب مسار التخزين المحلي المحفوظ في metadata
  const meta = document.metadata as Record<string, unknown> | null;
  const savedPath = meta?.localStoragePath as string | undefined;

  if (savedPath) {
    try {
      const buf = await fs.readFile(savedPath);
      console.log(`[Analyze] 💾 قُرئ من التخزين المحلي: ${savedPath}`);
      return buf;
    } catch {
      console.warn(`[Analyze] ⚠️ لم يُوجد الملف في: ${savedPath}`);
    }
  }

  // 3️⃣ بحث تلقائي في مجلد uploads بالـ documentId
  try {
    const files = await fs.readdir(LOCAL_STORAGE_DIR);
    const match = files.find(f => f.startsWith(document.id));
    if (match) {
      const localPath = path.join(LOCAL_STORAGE_DIR, match);
      const buf = await fs.readFile(localPath);
      console.log(`[Analyze] 💾 وُجد محلياً بالبحث: ${localPath}`);
      return buf;
    }
  } catch { /* مجلد uploads غير موجود */ }

  throw new Error(
    'لا يمكن الوصول للملف: غير موجود في Google Drive ولا في التخزين المحلي. ' +
    'يرجى إعادة رفع المستند.'
  );
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    // ─── Get document ─────────────────────────────────────────
    const document = await prisma.document.findUnique({
      where: { id },
      include: { uploadedBy: { select: { id: true, name: true } } },
    });

    if (!document) {
      return NextResponse.json({ success: false, error: 'المستند غير موجود' }, { status: 404 });
    }

    if (!['uploaded', 'failed', 'needs_review', 'extracted'].includes(document.processingStatus)) {
      return NextResponse.json({
        success: false,
        error: `المستند في حالة "${document.processingStatus}" ولا يمكن إعادة تحليله`,
      });
    }

    // ─── Update status to processing ─────────────────────────
    await prisma.document.update({
      where: { id },
      data: {
        processingStatus: 'processing',
        processingAttempts: { increment: 1 },
        lastProcessedAt: new Date(),
      },
    });

    // ─── Get file content (Drive أو Local) ───────────────────
    let fileBuffer: Buffer;
    try {
      fileBuffer = await getFileBuffer({
        id: document.id,
        googleDriveFileId: document.googleDriveFileId,
        fileName: document.fileName,
        metadata: document.metadata,
      });
    } catch (fileErr) {
      const errMsg = fileErr instanceof Error ? fileErr.message : 'خطأ في قراءة الملف';
      await prisma.document.update({
        where: { id },
        data: { processingStatus: 'failed', processingError: errMsg },
      });
      return NextResponse.json({ success: false, error: errMsg, canManualEntry: true });
    }

    const base64Data = fileBuffer.toString('base64');

    // ─── Analyze with Gemini ──────────────────────────────────
    const analysisResult = await analyzeDocument({
      mimeType: document.mimeType,
      fileData: base64Data,
      fileName: document.fileName,
    });

    if (!analysisResult.success || !analysisResult.extraction) {
      await prisma.document.update({
        where: { id },
        data: {
          processingStatus: 'failed',
          processingError: analysisResult.error || 'فشل التحليل',
          rawExtraction: { error: analysisResult.error, rawResponse: analysisResult.rawResponse } as any,
        },
      });

      await logAudit({
        documentId: id,
        entityType: 'document',
        entityId: id,
        action: 're_analyze',
        newValue: { status: 'failed', error: analysisResult.error },
      });

      return NextResponse.json({
        success: false,
        error: analysisResult.error || 'فشل تحليل المستند',
        canManualEntry: true,
      });
    }

    const extraction = analysisResult.extraction;

    // ─── Validate extraction ──────────────────────────────────
    const validation = validateGeminiExtraction(extraction);

    // ─── Check for duplicates ─────────────────────────────────
    const duplicateCheck = await checkForDuplicates({
      fileHash: document.fileHash || undefined,
      invoiceNumber: extraction.invoice_number?.value || undefined,
      partyName: extraction.party?.name?.value || undefined,
      invoiceDate: extraction.invoice_date?.value || undefined,
      total: extraction.financial?.total?.value || undefined,
      uploadedById: document.uploadedById,
    });

    // ─── Match party ──────────────────────────────────────────
    let partyMatch = null;
    if (extraction.party?.name?.value) {
      partyMatch = await matchParty({
        name: extraction.party.name.value,
        taxNumber: extraction.party?.tax_number?.value || undefined,
        phone: extraction.party?.phone?.value || undefined,
        email: extraction.party?.email?.value || undefined,
      });
    }

    // ─── Determine final status ───────────────────────────────
    const needsReview =
      validation.needsReview ||
      duplicateCheck.isDuplicate ||
      (partyMatch?.isUncertain ?? false);

    const finalStatus = needsReview ? 'needs_review' : 'extracted';

    // ─── Save to database ─────────────────────────────────────
    await prisma.document.update({
      where: { id },
      data: {
        processingStatus: finalStatus,
        rawExtraction: JSON.parse(JSON.stringify(extraction)),
        extractedData: JSON.parse(JSON.stringify({
          ...extraction,
          validation: {
            errors: validation.errors,
            warnings: validation.warnings,
            reviewReasons: validation.reviewReasons,
          },
          duplicateCheck,
          partyMatch,
          modelUsed: analysisResult.modelUsed,
        })),
        overallConfidence: extraction.overall_confidence ?? 0,
        warnings: Array.from(new Set([
          ...(Array.isArray(extraction.warnings) ? extraction.warnings : []),
          ...validation.warnings.map(w => w.message),
          ...(duplicateCheck.isDuplicate ? [`احتمال تكرار: ${Math.round(duplicateCheck.probability * 100)}%`] : []),
        ])),
        lastProcessedAt: new Date(),
      },
    });

    await logAudit({
      documentId: id,
      entityType: 'document',
      entityId: id,
      action: 're_analyze',
      newValue: {
        status: finalStatus,
        confidence: extraction.overall_confidence ?? 0,
        documentType: extraction.document_type || 'other',
        needsReview,
        modelUsed: analysisResult.modelUsed,
      },
    });

    return NextResponse.json({
      success: true,
      documentId: id,
      status: finalStatus,
      documentType: extraction.document_type,
      confidence: extraction.overall_confidence,
      needsReview,
      reviewReasons: validation.reviewReasons,
      duplicateCheck,
      partyMatch,
      processingTime: analysisResult.processingTime,
      modelUsed: analysisResult.modelUsed,
    });
  } catch (error) {
    console.error('[Analyze API Error]', error);

    try {
      await prisma.document.update({
        where: { id },
        data: {
          processingStatus: 'failed',
          processingError: error instanceof Error ? error.message : 'خطأ غير متوقع',
        },
      });
    } catch { /* ignore secondary error */ }

    return NextResponse.json(
      { success: false, error: 'فشل تحليل المستند', canManualEntry: true },
      { status: 500 }
    );
  }
}
