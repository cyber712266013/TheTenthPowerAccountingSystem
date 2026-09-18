import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { downloadFileBuffer } from '@/lib/google-drive';
import path from 'path';
import fs from 'fs/promises';

const LOCAL_STORAGE_DIR = path.join(process.cwd(), 'uploads');

// ─── GET /api/documents/[id]/file — خدمة محتوى الملف ────────

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const document = await prisma.document.findUnique({
      where: { id },
      select: {
        id: true,
        fileName: true,
        mimeType: true,
        googleDriveFileId: true,
        metadata: true,
      },
    });

    if (!document) {
      return NextResponse.json({ error: 'المستند غير موجود' }, { status: 404 });
    }

    let fileBuffer: Buffer | null = null;

    // 1️⃣ جرب Google Drive
    if (document.googleDriveFileId) {
      try {
        fileBuffer = await downloadFileBuffer(document.googleDriveFileId);
      } catch {
        // نكمل للـ fallback
      }
    }

    // 2️⃣ جرب التخزين المحلي
    if (!fileBuffer) {
      const meta = document.metadata as Record<string, unknown> | null;
      const savedPath = meta?.localStoragePath as string | undefined;

      if (savedPath) {
        try {
          fileBuffer = await fs.readFile(savedPath);
        } catch { /* continue */ }
      }
    }

    // 3️⃣ بحث تلقائي في uploads/
    if (!fileBuffer) {
      try {
        const files = await fs.readdir(LOCAL_STORAGE_DIR);
        const match = files.find(f => f.startsWith(document.id));
        if (match) {
          fileBuffer = await fs.readFile(path.join(LOCAL_STORAGE_DIR, match));
        }
      } catch { /* folder doesn't exist */ }
    }

    if (!fileBuffer) {
      return NextResponse.json({ error: 'لا يمكن الوصول للملف' }, { status: 404 });
    }

    // ─── إرسال الملف ──────────────────────────────────────────
    const headers = new Headers();
    headers.set('Content-Type', document.mimeType);
    headers.set('Content-Length', String(fileBuffer.length));
    headers.set('Content-Disposition', `inline; filename="${encodeURIComponent(document.fileName)}"`);
    headers.set('Cache-Control', 'private, max-age=3600');

    return new NextResponse(new Uint8Array(fileBuffer), { status: 200, headers });
  } catch (error) {
    console.error('[File Serve Error]', error);
    return NextResponse.json({ error: 'خطأ في خدمة الملف' }, { status: 500 });
  }
}
