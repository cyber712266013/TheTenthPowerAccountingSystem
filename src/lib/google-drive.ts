// ============================================================
// lib/google-drive.ts — Google Drive Service Account Integration
// ============================================================

import { google } from 'googleapis';
import { Readable } from 'stream';

// ─── Auth ──────────────────────────────────────────────────

function getAuth() {
  const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!serviceAccountJson) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON غير محدد في environment variables');
  }

  const credentials = JSON.parse(serviceAccountJson);

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/drive'],
  });

  return auth;
}

function getDriveClient() {
  const auth = getAuth();
  return google.drive({ version: 'v3', auth });
}

// ─── Folder Management ─────────────────────────────────────

const FOLDER_CACHE: { id: string | null } = { id: null };

/**
 * الحصول على (أو إنشاء) مجلد رفع الملفات
 */
export async function getOrCreateUploadFolder(): Promise<string> {
  const configuredFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
  if (configuredFolderId) return configuredFolderId;

  if (FOLDER_CACHE.id) return FOLDER_CACHE.id;

  const drive = getDriveClient();
  const folderName = process.env.APP_NAME || 'نظام الحسابات - المستندات';

  // بحث عن مجلد موجود
  const searchRes = await drive.files.list({
    q: `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id, name)',
  });

  if (searchRes.data.files && searchRes.data.files.length > 0) {
    const folderId = searchRes.data.files[0].id!;
    FOLDER_CACHE.id = folderId;
    return folderId;
  }

  // إنشاء مجلد جديد
  const createRes = await drive.files.create({
    requestBody: {
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder',
    },
    fields: 'id',
  });

  const folderId = createRes.data.id!;
  FOLDER_CACHE.id = folderId;
  return folderId;
}

// ─── Upload File ────────────────────────────────────────────

export interface UploadFileOptions {
  fileName: string;
  mimeType: string;
  fileBuffer: Buffer;
  folderId?: string;
  metadata?: Record<string, string>;
}

export interface DriveUploadResult {
  fileId: string;
  fileName: string;
  mimeType: string;
  size: number;
  webViewLink: string;
  webContentLink?: string;
  createdTime: string;
}

/**
 * رفع ملف إلى Google Drive
 */
export async function uploadFileToDrive(options: UploadFileOptions): Promise<DriveUploadResult> {
  const drive = getDriveClient();

  const folderId = options.folderId || (await getOrCreateUploadFolder());

  // تحويل Buffer إلى Readable Stream
  const fileStream = new Readable();
  fileStream.push(options.fileBuffer);
  fileStream.push(null);

  const response = await drive.files.create({
    requestBody: {
      name: options.fileName,
      parents: [folderId],
      // أي metadata إضافية (مرونة)
      properties: options.metadata || {},
    },
    media: {
      mimeType: options.mimeType,
      body: fileStream,
    },
    fields: 'id, name, mimeType, size, webViewLink, webContentLink, createdTime',
  });

  const file = response.data;

  // منح صلاحية القراءة للجميع (اختياري - يمكن إزالته للخصوصية)
  // await drive.permissions.create({
  //   fileId: file.id!,
  //   requestBody: { role: 'reader', type: 'anyone' },
  // });

  return {
    fileId: file.id!,
    fileName: file.name!,
    mimeType: file.mimeType!,
    size: parseInt(file.size || '0'),
    webViewLink: file.webViewLink!,
    webContentLink: file.webContentLink || undefined,
    createdTime: file.createdTime!,
  };
}

// ─── Get File ───────────────────────────────────────────────

export interface DriveFileInfo {
  fileId: string;
  fileName: string;
  mimeType: string;
  size: number;
  webViewLink: string;
  createdTime: string;
}

/**
 * جلب معلومات ملف من Google Drive
 */
export async function getFileInfo(fileId: string): Promise<DriveFileInfo> {
  const drive = getDriveClient();

  const response = await drive.files.get({
    fileId,
    fields: 'id, name, mimeType, size, webViewLink, createdTime',
  });

  const file = response.data;
  return {
    fileId: file.id!,
    fileName: file.name!,
    mimeType: file.mimeType!,
    size: parseInt(file.size || '0'),
    webViewLink: file.webViewLink!,
    createdTime: file.createdTime!,
  };
}

/**
 * تحميل محتوى الملف من Google Drive (للتحليل بـ Gemini)
 */
export async function downloadFileBuffer(fileId: string): Promise<Buffer> {
  const drive = getDriveClient();

  const response = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'arraybuffer' }
  );

  return Buffer.from(response.data as ArrayBuffer);
}

/**
 * توليد رابط مؤقت للعرض المباشر
 */
export async function getTemporaryViewLink(fileId: string): Promise<string> {
  // بالنسبة للـ Service Account، نولد رابط عبر Drive API
  const drive = getDriveClient();

  // إنشاء رابط مشاركة مؤقت
  await drive.permissions.create({
    fileId,
    requestBody: {
      role: 'reader',
      type: 'anyone',
    },
  });

  const fileInfo = await drive.files.get({
    fileId,
    fields: 'webViewLink, webContentLink',
  });

  return fileInfo.data.webViewLink || `https://drive.google.com/file/d/${fileId}/view`;
}

/**
 * حذف ملف (للأرشفة فقط - نادرًا ما يُستخدم)
 */
export async function deleteFile(fileId: string): Promise<void> {
  const drive = getDriveClient();
  await drive.files.delete({ fileId });
}

// ─── Subfolder Per Month ────────────────────────────────────

/**
 * إنشاء مجلد فرعي بالشهر/السنة لتنظيم أفضل
 * مثلاً: 2026-09
 */
export async function getMonthlyFolder(parentFolderId: string): Promise<string> {
  const drive = getDriveClient();
  const now = new Date();
  const folderName = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const searchRes = await drive.files.list({
    q: `name='${folderName}' and '${parentFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id)',
  });

  if (searchRes.data.files && searchRes.data.files.length > 0) {
    return searchRes.data.files[0].id!;
  }

  const createRes = await drive.files.create({
    requestBody: {
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentFolderId],
    },
    fields: 'id',
  });

  return createRes.data.id!;
}
