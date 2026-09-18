// ============================================================
// lib/validations.ts — طبقة التحقق والأعمال التجارية
// ============================================================

import { createHash } from 'crypto';
import type { GeminiExtractionResult, ValidationResult } from './types';
import { validateInvoiceAmounts, validateItemsTotal } from './calculations';
import { prisma } from './prisma';

const CONFIDENCE_THRESHOLD = parseFloat(process.env.CONFIDENCE_THRESHOLD || '0.80');

// ─── التحقق من نتيجة Gemini ────────────────────────────────

export function validateGeminiExtraction(
  extraction: GeminiExtractionResult
): ValidationResult {
  const errors: ValidationResult['errors'] = [];
  const warnings: ValidationResult['warnings'] = [];
  const reviewReasons: string[] = [];

  // 1. تحقق من وجود نوع المستند
  if (!extraction?.document_type) {
    errors.push({
      field: 'document_type',
      message: 'لم يتم تحديد نوع المستند',
      code: 'MISSING_DOCUMENT_TYPE',
    });
  }

  // 2. فحص الثقة الكلية
  if ((extraction?.overall_confidence ?? 0) < CONFIDENCE_THRESHOLD) {
    reviewReasons.push(
      `الثقة الكلية منخفضة: ${Math.round((extraction?.overall_confidence ?? 0) * 100)}% (الحد الأدنى: ${Math.round(CONFIDENCE_THRESHOLD * 100)}%)`
    );
  }

  // 3. فحص ثقة الطرف
  if ((extraction?.party?.name?.confidence ?? 0) < CONFIDENCE_THRESHOLD) {
    reviewReasons.push(`اسم الطرف غير مؤكد: ${Math.round((extraction?.party?.name?.confidence ?? 0) * 100)}%`);
  }

  // 4. فحص ثقة التاريخ
  if ((extraction?.invoice_date?.confidence ?? 0) < CONFIDENCE_THRESHOLD && extraction?.invoice_date?.value) {
    reviewReasons.push(`تاريخ المستند غير مؤكد: ${Math.round((extraction?.invoice_date?.confidence ?? 0) * 100)}%`);
  }

  // 5. تحقق من صحة التاريخ
  if (extraction?.invoice_date?.value) {
    const date = new Date(extraction.invoice_date.value);
    if (isNaN(date.getTime())) {
      errors.push({
        field: 'invoice_date',
        message: `تاريخ غير صحيح: ${extraction.invoice_date.value}`,
        code: 'INVALID_DATE',
      });
    } else {
      const now = new Date();
      const twoYearsAgo = new Date(now.getFullYear() - 2, now.getMonth(), now.getDate());
      const oneYearFuture = new Date(now.getFullYear() + 1, now.getMonth(), now.getDate());

      if (date < twoYearsAgo) {
        warnings.push({
          field: 'invoice_date',
          message: `تاريخ الفاتورة قديم جدًا: ${extraction.invoice_date.value}`,
          code: 'OLD_DATE',
        });
        reviewReasons.push('تاريخ الفاتورة أقدم من سنتين');
      }
      if (date > oneYearFuture) {
        warnings.push({
          field: 'invoice_date',
          message: `تاريخ الفاتورة في المستقبل البعيد: ${extraction.invoice_date.value}`,
          code: 'FUTURE_DATE',
        });
        reviewReasons.push('تاريخ الفاتورة في المستقبل');
      }
    }
  }

  // 6. تحقق من المبالغ
  const fin = extraction?.financial;
  const totalVal = fin?.total?.value;
  if (totalVal !== null && totalVal !== undefined && totalVal > 0) {
    if (totalVal < 0) {
      errors.push({
        field: 'financial.total',
        message: 'المبلغ الإجمالي لا يمكن أن يكون سالبًا',
        code: 'NEGATIVE_AMOUNT',
      });
    }

    // تحقق من تطابق المبالغ إذا كانت متوفرة
    if (
      fin?.subtotal?.value !== null && fin?.subtotal?.value !== undefined &&
      fin?.tax_amount?.value !== null && fin?.tax_amount?.value !== undefined &&
      fin?.discount?.value !== null && fin?.discount?.value !== undefined
    ) {
      const amountValidation = validateInvoiceAmounts({
        subtotal: fin.subtotal.value,
        taxAmount: fin.tax_amount.value,
        discount: fin.discount.value,
        total: totalVal,
        paidAmount: fin.paid?.value ?? undefined,
        remainingAmount: fin.remaining?.value ?? undefined,
      });

      if (!amountValidation.isValid) {
        amountValidation.warnings.forEach((w) => {
          warnings.push({ field: 'financial', message: w, code: 'AMOUNT_DISCREPANCY' });
          reviewReasons.push(w);
        });
      }
    }

    // تحقق من مجموع البنود
    if (Array.isArray(extraction?.items) && extraction.items.length > 0 && fin?.subtotal?.value !== null && fin?.subtotal?.value !== undefined) {
      const itemTotals = extraction.items
        .filter((i) => i?.total?.value !== null && i?.total?.value !== undefined)
        .map((i) => ({ total: i.total.value! }));

      if (itemTotals.length > 0) {
        const itemValidation = validateItemsTotal(itemTotals, fin.subtotal.value);
        if (!itemValidation.isValid && itemValidation.warning) {
          warnings.push({
            field: 'items',
            message: itemValidation.warning,
            code: 'ITEMS_TOTAL_MISMATCH',
          });
          reviewReasons.push(itemValidation.warning);
        }
      }
    }
  }

  // 7. تحقق من الاتجاه
  if (!extraction?.transaction?.direction?.value) {
    reviewReasons.push('لم يتم تحديد اتجاه العملية (عليه/له)');
  }

  // 8. تحذيرات Gemini
  if (Array.isArray(extraction?.warnings) && extraction.warnings.length > 0) {
    extraction.warnings.forEach((w) => {
      warnings.push({ field: 'document', message: w, code: 'GEMINI_WARNING' });
    });
    reviewReasons.push(...extraction.warnings);
  }

  const needsReview = reviewReasons.length > 0 || errors.length > 0;

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    needsReview,
    reviewReasons,
  };
}

// ─── Duplicate Detection ────────────────────────────────────

export interface DuplicateCheckInput {
  fileHash?: string;
  invoiceNumber?: string;
  partyName?: string;
  invoiceDate?: string;
  total?: number;
  uploadedById: string;
  excludeDocumentId?: string;
}

export interface DuplicateCheckResult {
  isDuplicate: boolean;
  probability: number;
  matchedDocumentId?: string;
  matchedInvoiceNumber?: string;
  matchReasons: string[];
}

export async function checkForDuplicates(
  input: DuplicateCheckInput
): Promise<DuplicateCheckResult> {
  const matchReasons: string[] = [];
  let maxProbability = 0;
  let matchedDocumentId: string | undefined;
  let matchedInvoiceNumber: string | undefined;

  // 1. فحص Hash الملف (أقوى مؤشر)
  if (input.fileHash) {
    const existing = await prisma.document.findFirst({
      where: {
        fileHash: input.fileHash,
        ...(input.excludeDocumentId ? { id: { not: input.excludeDocumentId } } : {}),
      },
      select: { id: true, fileName: true },
    });

    if (existing) {
      return {
        isDuplicate: true,
        probability: 1.0,
        matchedDocumentId: existing.id,
        matchReasons: ['ملف مطابق تمامًا (hash متطابق)'],
      };
    }
  }

  // 2. فحص رقم الفاتورة + الطرف
  if (input.invoiceNumber) {
    const existing = await prisma.invoice.findFirst({
      where: {
        invoiceNumber: input.invoiceNumber,
        ...(input.excludeDocumentId ? { documentId: { not: input.excludeDocumentId } } : {}),
        party: input.partyName
          ? {
              normalizedName: {
                contains: normalizeArabicText(input.partyName),
                mode: 'insensitive',
              },
            }
          : undefined,
      },
      select: { id: true, invoiceNumber: true, documentId: true },
    });

    if (existing) {
      matchReasons.push(`رقم فاتورة مطابق: ${input.invoiceNumber}`);
      maxProbability = Math.max(maxProbability, 0.95);
      matchedDocumentId = existing.documentId;
      matchedInvoiceNumber = existing.invoiceNumber || undefined;
    }
  }

  // 3. فحص الطرف + التاريخ + المبلغ
  if (input.partyName && input.invoiceDate && input.total) {
    const dateStart = new Date(input.invoiceDate);
    dateStart.setHours(0, 0, 0, 0);
    const dateEnd = new Date(input.invoiceDate);
    dateEnd.setHours(23, 59, 59, 999);

    const existing = await prisma.invoice.findFirst({
      where: {
        ...(input.excludeDocumentId ? { documentId: { not: input.excludeDocumentId } } : {}),
        invoiceDate: { gte: dateStart, lte: dateEnd },
        total: input.total,
        party: {
          normalizedName: {
            contains: normalizeArabicText(input.partyName),
            mode: 'insensitive',
          },
        },
      },
      select: { id: true, invoiceNumber: true, documentId: true },
    });

    if (existing) {
      matchReasons.push('نفس الطرف والتاريخ والمبلغ');
      maxProbability = Math.max(maxProbability, 0.90);
      matchedDocumentId = existing.documentId;
    }
  }

  return {
    isDuplicate: maxProbability >= 0.90,
    probability: maxProbability,
    matchedDocumentId,
    matchedInvoiceNumber,
    matchReasons,
  };
}

// ─── Party Matching ─────────────────────────────────────────

export interface PartyMatchInput {
  name: string;
  taxNumber?: string;
  phone?: string;
  email?: string;
}

export interface PartyMatchResult {
  matchFound: boolean;
  confidence: number;
  partyId?: string;
  partyName?: string;
  isUncertain: boolean;
  alternatives: { id: string; name: string; confidence: number }[];
}

export async function matchParty(input: PartyMatchInput): Promise<PartyMatchResult> {
  const normalizedInput = normalizeArabicText(input.name);

  // 1. بحث بالرقم الضريبي (الأكثر دقة)
  if (input.taxNumber) {
    const byTax = await prisma.party.findFirst({
      where: { taxNumber: input.taxNumber },
      select: { id: true, name: true },
    });
    if (byTax) {
      return {
        matchFound: true,
        confidence: 0.99,
        partyId: byTax.id,
        partyName: byTax.name,
        isUncertain: false,
        alternatives: [],
      };
    }
  }

  // 2. بحث بالاسم المطابق تمامًا
  const exactMatch = await prisma.party.findFirst({
    where: { normalizedName: normalizedInput },
    select: { id: true, name: true },
  });
  if (exactMatch) {
    return {
      matchFound: true,
      confidence: 0.98,
      partyId: exactMatch.id,
      partyName: exactMatch.name,
      isUncertain: false,
      alternatives: [],
    };
  }

  // 3. بحث بالاسم المضمّن (contains)
  const partialMatches = await prisma.party.findMany({
    where: {
      OR: [
        { normalizedName: { contains: normalizedInput, mode: 'insensitive' } },
        {
          normalizedName: {
            contains: normalizedInput.split(' ')[0],
            mode: 'insensitive',
          },
        },
      ],
    },
    select: { id: true, name: true, normalizedName: true },
    take: 5,
  });

  if (partialMatches.length === 0) {
    return {
      matchFound: false,
      confidence: 0,
      isUncertain: true,
      alternatives: [],
    };
  }

  // حساب درجة التشابه لكل نتيجة
  const scoredMatches = partialMatches.map((p) => ({
    id: p.id,
    name: p.name,
    confidence: calculateNameSimilarity(normalizedInput, p.normalizedName),
  })).sort((a, b) => b.confidence - a.confidence);

  const best = scoredMatches[0];
  const isUncertain = best.confidence < CONFIDENCE_THRESHOLD;

  return {
    matchFound: best.confidence > 0.5,
    confidence: best.confidence,
    partyId: isUncertain ? undefined : best.id,
    partyName: isUncertain ? undefined : best.name,
    isUncertain,
    alternatives: scoredMatches.map((m) => ({ id: m.id, name: m.name, confidence: m.confidence })),
  };
}

// ─── Utilities ─────────────────────────────────────────────

/** تطبيع النص العربي للبحث والمقارنة */
export function normalizeArabicText(text: string): string {
  return text
    .trim()
    .toLowerCase()
    // إزالة التشكيل
    .replace(/[\u064B-\u065F]/g, '')
    // توحيد ألفات
    .replace(/[أإآ]/g, 'ا')
    // توحيد هاء/تاء مربوطة
    .replace(/[ةه]/g, 'ه')
    // إزالة حروف غير ضرورية في المقارنة
    .replace(/\s+/g, ' ');
}

/** حساب درجة تشابه اسمين */
function calculateNameSimilarity(a: string, b: string): number {
  if (a === b) return 1.0;

  const longer = a.length > b.length ? a : b;
  const shorter = a.length > b.length ? b : a;

  if (longer.length === 0) return 1.0;

  const editDistance = levenshteinDistance(longer, shorter);
  const similarity = (longer.length - editDistance) / longer.length;

  // bonus إذا أحدهما يحتوي الآخر
  if (longer.includes(shorter)) {
    return Math.max(similarity, 0.85);
  }

  return similarity;
}

/** Levenshtein Distance */
function levenshteinDistance(s1: string, s2: string): number {
  const m = s1.length;
  const n = s2.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        s1[i - 1] === s2[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }

  return dp[m][n];
}

/** SHA-256 hash للملف */
export function hashFileBuffer(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

/** حجم الملف بصيغة قابلة للقراءة */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** أنواع الملفات المسموح بها */
export const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'application/pdf',
] as const;

export type AllowedMimeType = typeof ALLOWED_MIME_TYPES[number];

export function isAllowedMimeType(mimeType: string): mimeType is AllowedMimeType {
  return ALLOWED_MIME_TYPES.includes(mimeType as AllowedMimeType);
}

export const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE_BYTES || '52428800');

export function validateFileSize(sizeBytes: number): boolean {
  return sizeBytes <= MAX_FILE_SIZE;
}
