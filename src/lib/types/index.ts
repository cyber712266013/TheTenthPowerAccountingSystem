// ============================================================
// lib/types/index.ts — تعريفات TypeScript الكاملة للنظام
// ============================================================

// ─── Enums (mirrors Prisma) ────────────────────────────────

export type UserRole = 'admin' | 'accountant' | 'reviewer' | 'viewer';

export type PartyType = 'customer' | 'supplier' | 'person' | 'company' | 'bank' | 'both' | 'other';

export type DocumentType =
  | 'invoice'
  | 'payment_receipt'
  | 'bank_transfer'
  | 'receipt'
  | 'debit_note'
  | 'credit_note'
  | 'account_statement'
  | 'expense'
  | 'handwritten'
  | 'unknown'
  | 'other';

export type ProcessingStatus =
  | 'uploaded'
  | 'processing'
  | 'extracted'
  | 'needs_review'
  | 'approved'
  | 'rejected'
  | 'failed'
  | 'voided';

export type OperationType =
  | 'invoice'
  | 'payment'
  | 'receipt'
  | 'bank_transfer'
  | 'expense'
  | 'opening_balance'
  | 'adjustment'
  | 'credit_note'
  | 'debit_note'
  | 'manual'
  | 'other';

export type TransactionDirection = 'gave' | 'received';
export type TransactionStatus = 'pending' | 'approved' | 'voided' | 'cancelled';
export type Currency = 'SAR' | 'USD' | 'EUR' | 'AED' | 'KWD' | 'BHD' | 'OMR' | 'QAR' | 'EGP' | 'JOD' | 'other';

// ─── Confidence Field ──────────────────────────────────────
// كل حقل من Gemini يأتي مع قيمة الثقة
export interface ConfidenceField<T> {
  value: T | null;
  confidence: number; // 0.0 → 1.0
}

// ─── Gemini Extraction Result ──────────────────────────────
// النتيجة الكاملة المنظمة من Gemini
export interface GeminiExtractionResult {
  document_type: DocumentType;
  overall_confidence: number;

  invoice_number: ConfidenceField<string>;
  invoice_date: ConfidenceField<string>; // ISO date string
  due_date: ConfidenceField<string>;

  party: {
    name: ConfidenceField<string>;
    type: ConfidenceField<PartyType>;
    phone: ConfidenceField<string>;
    email: ConfidenceField<string>;
    tax_number: ConfidenceField<string>;
    commercial_registration: ConfidenceField<string>;
    bank_account: ConfidenceField<string>;
    address: ConfidenceField<string>;
  };

  items: GeminiItemResult[];

  financial: {
    subtotal: ConfidenceField<number>;
    tax_amount: ConfidenceField<number>;
    tax_rate: ConfidenceField<number>;
    discount: ConfidenceField<number>;
    total: ConfidenceField<number>;
    paid: ConfidenceField<number>;
    remaining: ConfidenceField<number>;
    currency: ConfidenceField<Currency>;
  };

  transaction: {
    operation: ConfidenceField<OperationType>;
    direction: ConfidenceField<TransactionDirection>; // gave | received
    amount: ConfidenceField<number>;
    description: ConfidenceField<string>;
  };

  // أي بيانات إضافية لا تقع في الحقول المعيارية
  extra_fields: Record<string, ConfidenceField<unknown>>;

  warnings: string[];
  raw_text_excerpt?: string;
}

export interface GeminiItemResult {
  line_number?: number;
  description: ConfidenceField<string>;
  unit: ConfidenceField<string>;
  quantity: ConfidenceField<number>;
  unit_price: ConfidenceField<number>;
  tax_rate: ConfidenceField<number>;
  tax_amount: ConfidenceField<number>;
  discount: ConfidenceField<number>;
  total: ConfidenceField<number>;
  confidence: number;
  // مرونة: أي بيانات إضافية للبند
  extra_fields?: Record<string, ConfidenceField<unknown>>;
}

// ─── Validation Result ─────────────────────────────────────
export interface ValidationResult {
  isValid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
  needsReview: boolean;
  reviewReasons: string[];
}

export interface ValidationError {
  field: string;
  message: string;
  code: string;
}

export interface ValidationWarning {
  field: string;
  message: string;
  code: string;
}

// ─── Party Match Result ─────────────────────────────────────
export interface PartyMatchResult {
  matchFound: boolean;
  confidence: number;
  party?: {
    id: string;
    name: string;
    type: PartyType;
  };
  isUncertain: boolean; // true if confidence < threshold
  alternatives: {
    id: string;
    name: string;
    confidence: number;
  }[];
}

// ─── Duplicate Detection ────────────────────────────────────
export interface DuplicateDetectionResult {
  isDuplicate: boolean;
  probability: number;
  matchedDocumentId?: string;
  matchedInvoiceNumber?: string;
  matchReasons: string[];
}

// ─── Transaction Calculation ────────────────────────────────
// القاعدة الثابتة: balanceAfter = balanceBefore + onUs - forUs
export interface TransactionCalculation {
  partyId: string;
  transactionDate: Date;
  direction: TransactionDirection;
  amount: number;
  // نتيجة الحساب
  onUs: number;        // عليه
  forUs: number;       // له
  balanceBefore: number;
  balanceAfter: number;
}

// ─── Account Statement Row ──────────────────────────────────
export interface AccountStatementRow {
  id: string;
  transactionDate: Date;
  details: string;
  reference?: string;
  operationType: OperationType;
  onUs: number;       // عليه
  forUs: number;      // له
  balanceAfter: number;
  currency: Currency;
  documentId?: string;
  invoiceNumber?: string;
  status: TransactionStatus;
}

// ─── Account Statement Summary ──────────────────────────────
export interface AccountStatementSummary {
  partyId: string;
  partyName: string;
  openingBalance: number;
  totalOnUs: number;    // إجمالي عليه
  totalForUs: number;   // إجمالي له
  closingBalance: number;
  transactionCount: number;
  fromDate?: Date;
  toDate?: Date;
}

// ─── Upload Request ─────────────────────────────────────────
export interface UploadRequest {
  file: File;
  sourceType?: 'upload' | 'camera' | 'mobile' | 'scanner';
}

export interface UploadProgress {
  phase: 'uploading' | 'saving' | 'drive' | 'analyzing' | 'done' | 'error';
  percent: number;
  message: string;
}

// ─── Review Form Data ───────────────────────────────────────
// البيانات التي يُعدّلها المستخدم في شاشة المراجعة
export interface ReviewFormData {
  documentType: DocumentType;
  invoiceNumber?: string;
  invoiceDate?: string;
  partyId?: string;
  partyName?: string;
  currency: Currency;
  subtotal: number;
  taxAmount: number;
  discount: number;
  total: number;
  paidAmount: number;
  remainingAmount: number;
  items: ReviewItemData[];
  operationType: OperationType;
  direction: TransactionDirection;
  transactionDate: string;
  details: string;
  notes?: string;
  // مرونة: أي حقول إضافية يضيفها المستخدم
  extraFields?: Record<string, string | number | boolean | null>;
}

export interface ReviewItemData {
  id?: string; // موجود إذا كان بندًا معدّلًا
  description: string;
  unit?: string;
  quantity?: number;
  unitPrice?: number;
  taxRate?: number;
  taxAmount?: number;
  discount?: number;
  total: number;
  notes?: string;
  extraFields?: Record<string, string | number | boolean | null>;
}

// ─── API Response Wrapper ───────────────────────────────────
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  details?: string;
}

// ─── Filter Options ─────────────────────────────────────────
export interface StatementFilters {
  partyId?: string;
  fromDate?: string;
  toDate?: string;
  operationType?: OperationType;
  status?: TransactionStatus;
  direction?: TransactionDirection;
  search?: string;
  page?: number;
  pageSize?: number;
}

export interface DocumentFilters {
  processingStatus?: ProcessingStatus;
  documentType?: DocumentType;
  fromDate?: string;
  toDate?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}
