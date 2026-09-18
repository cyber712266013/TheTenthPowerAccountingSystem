import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { isAllowedMimeType, hashFileBuffer, validateFileSize } from '@/lib/validations';
import { uploadFileToDrive, getOrCreateUploadFolder, getMonthlyFolder } from '@/lib/google-drive';
import { logAudit } from '@/lib/audit';
import path from 'path';
import fs from 'fs/promises';

// Max size: 52MB — configured in next.config.ts via serverActions.bodySizeLimit

const LOCAL_STORAGE_DIR = path.join(process.cwd(), 'uploads');

async function ensureLocalDir() {
  await fs.mkdir(LOCAL_STORAGE_DIR, { recursive: true }).catch(() => {});
}

async function saveFileLocally(documentId: string, fileBuffer: Buffer, fileName: string): Promise<string> {
  await ensureLocalDir();
  // إزالة الأحرف غير الآمنة مع الحفاظ على العربية والامتداد
  const ext = fileName.split('.').pop() || 'bin';
  const localPath = path.join(LOCAL_STORAGE_DIR, `${documentId}.${ext}`);
  await fs.writeFile(localPath, fileBuffer);
  return localPath;
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const sourceType = (formData.get('sourceType') as string) || 'upload';

    if (!file) {
      return NextResponse.json({ success: false, error: 'لم يتم إرسال ملف' }, { status: 400 });
    }

    // ─── Validate ───────────────────────────────────────────
    if (!isAllowedMimeType(file.type)) {
      return NextResponse.json(
        { success: false, error: `نوع الملف غير مدعوم: ${file.type}` },
        { status: 400 }
      );
    }
    if (!validateFileSize(file.size)) {
      return NextResponse.json(
        { success: false, error: `حجم الملف كبير جدًا (${(file.size / 1024 / 1024).toFixed(1)} MB)` },
        { status: 400 }
      );
    }

    // ─── Read file ──────────────────────────────────────────
    const fileBuffer = Buffer.from(await file.arrayBuffer());
    const fileHash = hashFileBuffer(fileBuffer);

    // ─── Duplicate check ────────────────────────────────────
    const exactDuplicate = await prisma.document.findFirst({
      where: { fileHash },
      select: { id: true, fileName: true },
    });

    // ─── Get/Create User ────────────────────────────────────
    let userId = '';
    try {
      const admin = await prisma.user.findFirst({ select: { id: true } });
      userId = admin?.id || '';
    } catch { /* ignore */ }

    if (!userId) {
      const bcrypt = await import('bcryptjs');
      const admin = await prisma.user.create({
        data: {
          name: 'المدير',
          email: 'admin@system.local',
          password: await bcrypt.hash('admin123', 12),
          role: 'admin',
        },
      });
      userId = admin.id;
    }

    // ─── Try Drive, fallback to local ───────────────────────
    let driveFileId: string | null = null;
    let driveViewLink: string | null = null;
    let localPath: string | null = null;
    let storageMode = 'pending';

    // محاولة رفع Google Drive
    try {
      const parentFolder = await getOrCreateUploadFolder();
      const monthlyFolder = await getMonthlyFolder(parentFolder);
      const driveResult = await uploadFileToDrive({
        fileName: file.name,
        mimeType: file.type,
        fileBuffer,
        folderId: monthlyFolder,
        metadata: { sourceType, uploadedAt: new Date().toISOString() },
      });
      driveFileId = driveResult.fileId;
      driveViewLink = driveResult.webViewLink;
      storageMode = 'drive';
      console.log(`[Upload] ✅ Google Drive: ${driveFileId}`);
    } catch (driveError) {
      const msg = driveError instanceof Error ? driveError.message.substring(0, 100) : 'خطأ Drive';
      console.warn(`[Upload] ⚠️ Drive فشل (${msg}) — الحفظ محلياً`);
    }

    // إذا لم يُرفع لـ Drive → احفظ محلياً (دائماً)
    if (!driveFileId) {
      try {
        // سنحتاج ID مؤقت لحفظ الملف، نستخدم hash
        const tempId = fileHash.substring(0, 20);
        localPath = await saveFileLocally(tempId, fileBuffer, file.name);
        storageMode = 'local';
        console.log(`[Upload] 💾 حُفظ محلياً مؤقتاً: ${localPath}`);
      } catch (localErr) {
        console.error('[Upload] ❌ فشل الحفظ المحلي:', localErr);
      }
    }

    // ─── Save to Database ────────────────────────────────────
    const document = await prisma.document.create({
      data: {
        fileName: file.name,
        originalFileName: file.name,
        mimeType: file.type,
        fileSizeBytes: file.size,
        fileHash,
        sourceType,
        googleDriveFileId: driveFileId,
        googleDriveViewLink: driveViewLink,
        googleDriveWebLink: null,
        processingStatus: 'uploaded',
        uploadedById: userId,
        // تصحيح: null بدلاً من undefined
        duplicateOfId: exactDuplicate?.id ?? null,
        metadata: {
          driveUploadSuccess: !!driveFileId,
          localStoragePath: null, // سيُحدَّث بعد الإنشاء
          storageMode,
          uploadedAt: new Date().toISOString(),
        },
      },
    });

    // ─── إعادة تسمية الملف المحلي باستخدام documentId الحقيقي ──
    if (localPath && !driveFileId) {
      try {
        const ext = file.name.split('.').pop() || 'bin';
        const finalPath = path.join(LOCAL_STORAGE_DIR, `${document.id}.${ext}`);
        await fs.rename(localPath, finalPath);
        localPath = finalPath;
        console.log(`[Upload] 💾 تم إعادة التسمية: ${finalPath}`);
      } catch (renameErr) {
        console.warn('[Upload] تعذّر إعادة التسمية، المسار القديم محفوظ:', renameErr);
      }

      // تحديث المسار في DB
      await prisma.document.update({
        where: { id: document.id },
        data: {
          metadata: {
            driveUploadSuccess: false,
            localStoragePath: localPath,
            storageMode: 'local',
            uploadedAt: new Date().toISOString(),
          },
        },
      });
    }

    await logAudit({
      userId,
      entityType: 'document',
      entityId: document.id,
      action: 'create',
      newValue: { fileName: file.name, mimeType: file.type, fileSize: file.size, storageMode },
      metadata: { sourceType, driveFileId, localPath },
    });

    return NextResponse.json({
      success: true,
      documentId: document.id,
      storageMode,
      storedLocally: !!localPath,
      isPossibleDuplicate: !!exactDuplicate,
      duplicateDocumentId: exactDuplicate?.id ?? null,
    });
  } catch (error) {
    console.error('[Upload API Error]', error);
    return NextResponse.json(
      { success: false, error: 'حدث خطأ أثناء رفع الملف' },
      { status: 500 }
    );
  }
}
