// ============================================================
// lib/gemini.ts — Gemini AI Client للتحليل المستندات المالية
// ============================================================

import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import type {
  GeminiExtractionResult,
  DocumentType,
  PartyType,
  Currency,
  OperationType,
  TransactionDirection,
} from './types';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

// ─── نماذج Gemini المتاحة (بالترتيب من الأفضل للاحتياطي) ───
// يتم تجربة النماذج بالترتيب حتى يعمل أحدها
const FALLBACK_MODELS = [
  process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-3.1-flash-lite-preview',
  'gemini-flash-latest',
'gemini-3.5-flash-lite',
  'gemini-3.8-flash',
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
];

// إزالة التكرار
const MODELS_TO_TRY = [...new Set(FALLBACK_MODELS)];

// ─── System Prompt المتخصص والمحكم مالياً ومحاسبياً ─────────

const FINANCIAL_DOCUMENT_SYSTEM_PROMPT = `أنت خبير ومحاسب مالي قانوني متخصص في تدقيق وتحليل الفواتير والمستندات المالية والبنكية (في المملكة العربية السعودية ودول الخليج).
تتقن قراءة وفحص الفواتير الضريبية (ZATCA)، إيصالات التحويل البنكي، سندات القبض والصرف، كشوفات الحساب، والمستندات المكتوبة بخط اليد باللغتين العربية والإنجليزية.

مهمتك: قراءة وتحليل المستند المرفق واستخراج كافة البيانات المالية والمحاسبية بمنتهى الدقة والاحترافية.

════════════════════════════════════════════════════════════════
قواعد صارمة وإلزامية يجب الالتزام بها دون استثناء:
════════════════════════════════════════════════════════════════

### 1. لغة المخرجات والتحذيرات (بالعربية حصراً):
- جميع التحذيرات (warnings)، والوصف، والملاحظات يجب أن تُكتب حصراً بـ **اللغة العربية الفصحى السليمة والواضحة**.
- يُمنع منعاً باتاً كتابة أي تحذير أو ملاحظة باللغة الإنجليزية. إذا كان هناك تحذير ترجمه وصِغه بالعربية المحاسبية الدقيقة.

### 2. منع الهلوسة والتخمين:
- إذا لم تجد معلومة بشكل قاطع ومؤكد في المستند، ضع: {"value": null, "confidence": 0}.
- لا تخترع أرقاماً أو أسماءً أو تواريخ غير موجودة فعلياً في المستند.
- لا تملأ حقلاً بقيمة افتراضية من عندك ما لم تكن مطبوعة أو مكتوبة في المستند.

### 3. نسب الثقة (Confidence Score):
- 0.95 - 1.0: مقروء ومؤكد 100% وبخط واضح.
- 0.80 - 0.94: مقروء بجودة جيدة، شبه مؤكد.
- 0.50 - 0.79: غير واضح كلياً، يحتاج إلى تدقيق بشري.
- 0.0: غير موجود في المستند إطلاقاً.

### 4. تحديد هوية الطرف (المؤسسة مقابل الطرف الآخر):
- نظام الحسابات هذا يعمل لصالح مؤسستنا (مثال: مؤسسة القوة العاشرة للمقاولات أو الجهة المديرة للحساب).
- حقل الطرف (party): يجب أن يحتوي دائماً على بيانات **الطرف الخارجي المقابل** في المعاملة (العميل، المورد، المقاول، الموظف، المستفيد، أو المحوّل):
  * في فاتورة المبيعات الصادرة من مؤسستنا: الطرف هو "العميل / المشتري".
  * في فاتورة المشتريات المستلمة من مورد: الطرف هو "المورد / البائع".
  * في إيصالات التحويل البنكي (Bank Transfer):
    - إذا كان التحويل صادراً من حسابنا إلى طرف آخر: الطرف هو "المستفيد (Beneficiary)".
    - إذا كان التحويل وارداً لحسابنا من طرف آخر: الطرف هو "المحوّل (Sender)".

### 5. تحديد نوع المستند (document_type):
- invoice: فاتورة تجارية أو ضريبية (مبيعات أو مشتريات) تحتوي عادةً على جدول بنود وضريبة.
- bank_transfer: إشعار أو إيصال تحويل بنكي (تحويل إلكتروني، سريع، دولي، تحويل داخل البنك).
- payment_receipt: سند قبض أو سند صرف رسمي ورقي أو إلكتروني.
- receipt: إيصال نقد، وصل استلام، أو فاتورة كاش مبسطة.
- account_statement: كشف حساب دوري أو مطابقة رصيد.
- debit_note: إشعار مدين.
- credit_note: إشعار دائن.
- expense: إيصال مصروف نثري أو تشغيلي أو وقود.
- handwritten: مستند أو بيان مكتوب بخط اليد.
- other: أي مستند مالي آخر لا يقع تحت ما سبق.

### 6. التمييز الذكي بين الفواتير والحوالات البنكية:
- إيصالات التحويل البنكي (bank_transfer) وسندات الصرف/القبض:
  * لا تحتوي على بنود أو أصناف (items)، اترك مصفوفة items فارغة [] تلقائياً.
  * لا تحتوي على ضرائب أو خصم عادةً؛ اجعل subtotal = null و tax_amount = null.
  * ضع قيمة الحوالة المحولة مباشرة في: financial.total و transaction.amount.
  * استخرج الرقم المرجعي للتحويل، اسم البنك، والآيبان وضعها في extra_fields.

### 7. تحديد اتجاه الحركة المحاسبية (direction: gave / received):
معادلة كشف الحساب في النظام: (الرصيد الجديد = الرصيد السابق + عليه - له).
- gave (عليه / مدين):
  * عندما تدفع المؤسسة للمستفيد أو تحول له مبلغاً بنكياً (حوالة صادرة).
  * عندما تبيع المؤسسة بضاعة أو تقدم خدمة للعميل بالأجل (فاتورة مبيعات مستحقة عليه).
  * عندما تصرف المؤسسة عهدة أو سلفة لموظف.
- received (له / دائن):
  * عندما تستلم المؤسسة دفعة نقدية أو حوالة بنكية واردة من عميل.
  * عندما تشتري المؤسسة بضاعة أو تستلم خدمة من مورد بالأجل (فاتورة مشتريات مستحقة له في ذمتنا).

### 8. معايير استخراج التواريخ:
- استخرج التاريخ دائماً بالتقويم الميلادي بصيغة ISO القياسية: YYYY-MM-DD (مثال: 2026-03-15).
- إذا كان التاريخ في المستند هجرياً (مثلاً: 1447/09/20هـ)، اذكره كما هو في extra_fields، وحوله للميلادي في حقل invoice_date إن أمكن.

### 9. معايير استخراج الأرقام والمبالغ:
- استخرج المبالغ دائماً كـ **أرقام عددية نقية (Numbers)** وليس نصوص.
- احذف فواصل الآلاف ورموز العملات (مثلاً: "8,879.15 ر.س" تُستخرج كـ 8879.15).
- تأكد أن الضريبة في السعودية هي 15% للفواتير الضريبية القياسية، وتأكد من مطابقة: (المجموع الفرعي + الضريبة - الخصم = الإجمالي).

### 10. الحقول الإضافية الهامة (extra_fields):
استخرج كل تفصيل إضافي مهم وضعه في extra_fields ككائن: {"value": ..., "confidence": ...}:
- رقم الحوالة المرجعي (Transfer Reference Number)
- اسم البنك المحول منه والبنك المحول إليه
- رقم الحساب أو الآيبان (IBAN)
- رقم أمر الشراء (PO Number) أو رقم المشروع / العقد
- شروط السداد، أو اسم المحاسب/المعتمد.`;

// ─── JSON Schema لـ Gemini ──────────────────────────────────

const EXTRACTION_SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    document_type: { type: SchemaType.STRING },
    overall_confidence: { type: SchemaType.NUMBER },

    invoice_number: {
      type: SchemaType.OBJECT,
      properties: {
        value: { type: SchemaType.STRING, nullable: true },
        confidence: { type: SchemaType.NUMBER },
      },
    },
    invoice_date: {
      type: SchemaType.OBJECT,
      properties: {
        value: { type: SchemaType.STRING, nullable: true },
        confidence: { type: SchemaType.NUMBER },
      },
    },
    due_date: {
      type: SchemaType.OBJECT,
      properties: {
        value: { type: SchemaType.STRING, nullable: true },
        confidence: { type: SchemaType.NUMBER },
      },
    },

    party: {
      type: SchemaType.OBJECT,
      properties: {
        name: {
          type: SchemaType.OBJECT,
          properties: {
            value: { type: SchemaType.STRING, nullable: true },
            confidence: { type: SchemaType.NUMBER },
          },
        },
        type: {
          type: SchemaType.OBJECT,
          properties: {
            value: { type: SchemaType.STRING, nullable: true },
            confidence: { type: SchemaType.NUMBER },
          },
        },
        phone: {
          type: SchemaType.OBJECT,
          properties: {
            value: { type: SchemaType.STRING, nullable: true },
            confidence: { type: SchemaType.NUMBER },
          },
        },
        email: {
          type: SchemaType.OBJECT,
          properties: {
            value: { type: SchemaType.STRING, nullable: true },
            confidence: { type: SchemaType.NUMBER },
          },
        },
        tax_number: {
          type: SchemaType.OBJECT,
          properties: {
            value: { type: SchemaType.STRING, nullable: true },
            confidence: { type: SchemaType.NUMBER },
          },
        },
        commercial_registration: {
          type: SchemaType.OBJECT,
          properties: {
            value: { type: SchemaType.STRING, nullable: true },
            confidence: { type: SchemaType.NUMBER },
          },
        },
        bank_account: {
          type: SchemaType.OBJECT,
          properties: {
            value: { type: SchemaType.STRING, nullable: true },
            confidence: { type: SchemaType.NUMBER },
          },
        },
        address: {
          type: SchemaType.OBJECT,
          properties: {
            value: { type: SchemaType.STRING, nullable: true },
            confidence: { type: SchemaType.NUMBER },
          },
        },
      },
    },

    items: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          line_number: { type: SchemaType.NUMBER, nullable: true },
          description: {
            type: SchemaType.OBJECT,
            properties: {
              value: { type: SchemaType.STRING, nullable: true },
              confidence: { type: SchemaType.NUMBER },
            },
          },
          unit: {
            type: SchemaType.OBJECT,
            properties: {
              value: { type: SchemaType.STRING, nullable: true },
              confidence: { type: SchemaType.NUMBER },
            },
          },
          quantity: {
            type: SchemaType.OBJECT,
            properties: {
              value: { type: SchemaType.NUMBER, nullable: true },
              confidence: { type: SchemaType.NUMBER },
            },
          },
          unit_price: {
            type: SchemaType.OBJECT,
            properties: {
              value: { type: SchemaType.NUMBER, nullable: true },
              confidence: { type: SchemaType.NUMBER },
            },
          },
          tax_rate: {
            type: SchemaType.OBJECT,
            properties: {
              value: { type: SchemaType.NUMBER, nullable: true },
              confidence: { type: SchemaType.NUMBER },
            },
          },
          tax_amount: {
            type: SchemaType.OBJECT,
            properties: {
              value: { type: SchemaType.NUMBER, nullable: true },
              confidence: { type: SchemaType.NUMBER },
            },
          },
          discount: {
            type: SchemaType.OBJECT,
            properties: {
              value: { type: SchemaType.NUMBER, nullable: true },
              confidence: { type: SchemaType.NUMBER },
            },
          },
          total: {
            type: SchemaType.OBJECT,
            properties: {
              value: { type: SchemaType.NUMBER, nullable: true },
              confidence: { type: SchemaType.NUMBER },
            },
          },
          confidence: { type: SchemaType.NUMBER },
        },
      },
    },

    financial: {
      type: SchemaType.OBJECT,
      properties: {
        subtotal: {
          type: SchemaType.OBJECT,
          properties: {
            value: { type: SchemaType.NUMBER, nullable: true },
            confidence: { type: SchemaType.NUMBER },
          },
        },
        tax_amount: {
          type: SchemaType.OBJECT,
          properties: {
            value: { type: SchemaType.NUMBER, nullable: true },
            confidence: { type: SchemaType.NUMBER },
          },
        },
        tax_rate: {
          type: SchemaType.OBJECT,
          properties: {
            value: { type: SchemaType.NUMBER, nullable: true },
            confidence: { type: SchemaType.NUMBER },
          },
        },
        discount: {
          type: SchemaType.OBJECT,
          properties: {
            value: { type: SchemaType.NUMBER, nullable: true },
            confidence: { type: SchemaType.NUMBER },
          },
        },
        total: {
          type: SchemaType.OBJECT,
          properties: {
            value: { type: SchemaType.NUMBER, nullable: true },
            confidence: { type: SchemaType.NUMBER },
          },
        },
        paid: {
          type: SchemaType.OBJECT,
          properties: {
            value: { type: SchemaType.NUMBER, nullable: true },
            confidence: { type: SchemaType.NUMBER },
          },
        },
        remaining: {
          type: SchemaType.OBJECT,
          properties: {
            value: { type: SchemaType.NUMBER, nullable: true },
            confidence: { type: SchemaType.NUMBER },
          },
        },
        currency: {
          type: SchemaType.OBJECT,
          properties: {
            value: { type: SchemaType.STRING, nullable: true },
            confidence: { type: SchemaType.NUMBER },
          },
        },
      },
    },

    transaction: {
      type: SchemaType.OBJECT,
      properties: {
        operation: {
          type: SchemaType.OBJECT,
          properties: {
            value: { type: SchemaType.STRING, nullable: true },
            confidence: { type: SchemaType.NUMBER },
          },
        },
        direction: {
          type: SchemaType.OBJECT,
          properties: {
            value: { type: SchemaType.STRING, nullable: true },
            confidence: { type: SchemaType.NUMBER },
          },
        },
        amount: {
          type: SchemaType.OBJECT,
          properties: {
            value: { type: SchemaType.NUMBER, nullable: true },
            confidence: { type: SchemaType.NUMBER },
          },
        },
        description: {
          type: SchemaType.OBJECT,
          properties: {
            value: { type: SchemaType.STRING, nullable: true },
            confidence: { type: SchemaType.NUMBER },
          },
        },
      },
    },

    warnings: {
      type: SchemaType.ARRAY,
      items: { type: SchemaType.STRING },
    },
    raw_text_excerpt: { type: SchemaType.STRING, nullable: true },
  },
};

// ─── Main Analysis Function ────────────────────────────────

export interface AnalyzeDocumentOptions {
  mimeType: string;
  fileData: string; // base64 encoded
  fileName?: string;
}

export interface AnalyzeDocumentResult {
  success: boolean;
  extraction?: GeminiExtractionResult;
  rawResponse?: string;
  error?: string;
  processingTime?: number;
  modelUsed?: string; // أي نموذج استُخدم فعلياً
}

// ─── مساعدة لضمان سلامة هيكل البيانات المستخرجة ───────────
function normalizeExtraction(raw: any): GeminiExtractionResult {
  const safeField = <T>(val: any, defaultVal: T = null as unknown as T, defaultConf = 0.5) => {
    if (val && typeof val === 'object' && 'value' in val) {
      return {
        value: val.value !== undefined ? (val.value as T) : defaultVal,
        confidence: typeof val.confidence === 'number' ? val.confidence : defaultConf,
      };
    }
    return {
      value: val !== undefined ? (val as T) : defaultVal,
      confidence: defaultConf,
    };
  };

  const fin = raw?.financial || {};
  const party = raw?.party || {};
  const txn = raw?.transaction || {};

  return {
    document_type: (raw?.document_type as DocumentType) || 'other',
    overall_confidence: typeof raw?.overall_confidence === 'number' ? raw?.overall_confidence : 0.7,

    invoice_number: safeField<string | null>(raw?.invoice_number, null),
    invoice_date: safeField<string | null>(raw?.invoice_date, null),
    due_date: safeField<string | null>(raw?.due_date, null),

    party: {
      name: safeField<string | null>(party.name, null),
      type: safeField<PartyType>(party.type, 'other'),
      phone: safeField<string | null>(party.phone, null),
      email: safeField<string | null>(party.email, null),
      tax_number: safeField<string | null>(party.tax_number, null),
      commercial_registration: safeField<string | null>(party.commercial_registration, null),
      bank_account: safeField<string | null>(party.bank_account, null),
      address: safeField<string | null>(party.address, null),
    },

    items: Array.isArray(raw?.items)
      ? raw.items.map((it: any, idx: number) => ({
          line_number: typeof it?.line_number === 'number' ? it.line_number : idx + 1,
          description: safeField<string>(it?.description, ''),
          unit: safeField<string>(it?.unit, ''),
          quantity: safeField<number | null>(it?.quantity, null),
          unit_price: safeField<number | null>(it?.unit_price, null),
          tax_rate: safeField<number | null>(it?.tax_rate, null),
          tax_amount: safeField<number | null>(it?.tax_amount, null),
          discount: safeField<number | null>(it?.discount, null),
          total: safeField<number | null>(it?.total, null),
          confidence: typeof it?.confidence === 'number' ? it.confidence : 0.8,
        }))
      : [],

    financial: {
      subtotal: safeField<number | null>(fin.subtotal, null),
      tax_amount: safeField<number | null>(fin.tax_amount, null),
      tax_rate: safeField<number | null>(fin.tax_rate, null),
      discount: safeField<number | null>(fin.discount, null),
      total: safeField<number | null>(fin.total, null),
      paid: safeField<number | null>(fin.paid, null),
      remaining: safeField<number | null>(fin.remaining, null),
      currency: safeField<Currency>(fin.currency, 'SAR'),
    },

    transaction: {
      operation: safeField<OperationType>(txn.operation, 'invoice'),
      direction: safeField<TransactionDirection>(txn.direction, 'gave'),
      amount: safeField<number | null>(txn.amount, null),
      description: safeField<string>(txn.description, ''),
    },

    extra_fields: raw?.extra_fields && typeof raw.extra_fields === 'object' ? raw.extra_fields : {},
    warnings: Array.isArray(raw?.warnings) ? raw.warnings : [],
    raw_text_excerpt: raw?.raw_text_excerpt || '',
  };
}

export async function analyzeDocument(
  options: AnalyzeDocumentOptions
): Promise<AnalyzeDocumentResult> {
  const startTime = Date.now();

  const prompt = `حلل هذا المستند المالي واستخرج جميع البيانات الممكنة بدقة محاسبية وقانونية عالية.
اسم الملف: ${options.fileName || 'غير معروف'}
نوع الملف: ${options.mimeType}

المطلوب بدقة:
1. حدد نوع المستند بدقة (فاتورة / تحويل بنكي / سند قبض أو صرف / كشف حساب...).
2. استخرج الطرف المقابل (المورد أو العميل أو المستفيد/المحوّل) وتفاصيله (الاسم، الضريبي، البنك...).
3. استخرج المبالغ المالية بدقة كأرقام عددية نيرة (المجموع، الضريبة، الخصم، الإجمالي، المدفوع، المتبقي).
4. استخرج البنود التفصيلية إن وجدت في الفواتير (واتركها فارغة إذا كان تحويلاً بنكياً أو سنداً).
5. حدد اتجاه العملية المحاسبية (gave: عليه / received: له) بدقة متناهية وفق القواعد المحاسبية.
6. اكتب جميع التحذيرات (warnings) والملاحظات باللغة العربية الفصحى حصراً، ولا تكتب أي نص بالإنجليزية.
7. ضع أي بيانات إضافية مهمة كالأرقام المرجعية والآيبان في extra_fields.`;

  let lastError = '';

  // ─── تجربة النماذج بالترتيب حتى يعمل أحدها ───────────────
  for (const modelName of MODELS_TO_TRY) {
    try {
      console.log(`[Gemini] محاولة النموذج: ${modelName}`);
      const model = genAI.getGenerativeModel({
        model: modelName,
        systemInstruction: FINANCIAL_DOCUMENT_SYSTEM_PROMPT,
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: EXTRACTION_SCHEMA as any,
          temperature: 0.1,
          maxOutputTokens: 8192,
        },
      });

      const result = await model.generateContent([
        {
          inlineData: {
            mimeType: options.mimeType,
            data: options.fileData,
          },
        },
        prompt,
      ]);

      const rawText = result.response.text();
      const processingTime = Date.now() - startTime;
      console.log(`[Gemini] ✅ نجح النموذج: ${modelName} (${processingTime}ms)`);

      let extraction: GeminiExtractionResult;
      try {
        const parsed = JSON.parse(rawText);
        extraction = normalizeExtraction(parsed);
      } catch {
        return {
          success: false,
          rawResponse: rawText,
          error: 'فشل في تحليل نتيجة الذكاء الاصطناعي',
          processingTime,
        };
      }

      return {
        success: true,
        extraction,
        rawResponse: rawText,
        processingTime,
        modelUsed: modelName,
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      lastError = errMsg;
      // إذا كان 503 (مشغول) أو 404 (غير متاح) — جرب النموذج التالي
      const shouldFallback = errMsg.includes('503') || errMsg.includes('503') ||
        errMsg.includes('404') || errMsg.includes('overloaded') || errMsg.includes('demand');
      if (shouldFallback) {
        console.warn(`[Gemini] ⚠️ ${modelName} غير متاح (${errMsg.substring(0, 60)}) — جرب التالي`);
        continue;
      }
      // أي خطأ آخر → أوقف مباشرة
      return {
        success: false,
        error: errMsg,
        processingTime: Date.now() - Date.now(),
      };
    }
  }

  // كل النماذج فشلت
  return {
    success: false,
    error: `جميع نماذج Gemini غير متاحة حالياً. آخر خطأ: ${lastError}`,
    processingTime: Date.now() - Date.now(),
  };
}

// ─── Party Matching via Gemini ──────────────────────────────

export async function matchPartyWithGemini(
  extractedName: string,
  existingParties: { id: string; name: string; normalizedName: string }[]
): Promise<{ bestMatchId: string | null; confidence: number; alternatives: { id: string; confidence: number }[] }> {
  if (!extractedName || existingParties.length === 0) {
    return { bestMatchId: null, confidence: 0, alternatives: [] };
  }

  try {
    const model = genAI.getGenerativeModel({
      model: process.env.GEMINI_MODEL || 'gemini-3.8-flash',
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0,
      },
    });

    const partiesText = existingParties
      .map((p) => `{"id":"${p.id}","name":"${p.name}"}`)
      .join('\n');

    const prompt = `قارن الاسم التالي مع قائمة الأطراف الموجودة وأعطِ نسبة تطابق لكل طرف.

الاسم المستخرج: "${extractedName}"

الأطراف الموجودة:
${partiesText}

أعد JSON بهذا الشكل فقط:
{"best_match_id": "ID_OR_NULL", "best_confidence": 0.0, "alternatives": [{"id": "...", "confidence": 0.0}]}

ملاحظات:
- تجاهل الاختلافات البسيطة في التهجئة
- اعتبر الاختصارات والأسماء الكاملة متطابقة إذا كانت لنفس الجهة
- الثقة 0.95+ تعني تطابق شبه مؤكد
- الثقة أقل من 0.70 تعني غير متأكد`;

    const result = await model.generateContent(prompt);
    const data = JSON.parse(result.response.text());

    return {
      bestMatchId: data.best_match_id || null,
      confidence: data.best_confidence || 0,
      alternatives: data.alternatives || [],
    };
  } catch {
    return { bestMatchId: null, confidence: 0, alternatives: [] };
  }
}
