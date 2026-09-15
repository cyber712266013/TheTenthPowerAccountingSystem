// ============================================================
// lib/gemini.ts — Gemini AI Client للتحليل المستندات المالية
// ============================================================

import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import type { GeminiExtractionResult } from './types';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

// ─── System Prompt المتخصص ─────────────────────────────────

const FINANCIAL_DOCUMENT_SYSTEM_PROMPT = `أنت محلل مستندات مالية متخصص ومتعدد اللغات (عربي وإنجليزي).

مهمتك: قراءة وتحليل المستند المالي المرفق واستخراج جميع البيانات الممكنة بدقة عالية.

## قواعد صارمة يجب الالتزام بها:

### 1. لا تخترع بيانات
- إذا لم تجد معلومة، أعد: {"value": null, "confidence": 0}
- لا تكتب تخمينات داخل البيانات النهائية
- لا تملأ حقلًا بقيمة افتراضية إلا إذا كانت موجودة فعلًا في المستند

### 2. أعط confidence دقيقة لكل حقل
- 0.99-1.0: مكتوب بوضوح تام، مقروء بشكل مؤكد
- 0.80-0.98: مقروء بجودة جيدة، شبه مؤكد
- 0.50-0.79: يحتاج مراجعة، قد يكون خطأ
- 0.10-0.49: غير واضح، تخمين
- 0.0: غير موجود أو غير مقروء إطلاقًا

### 3. أنواع المستندات المدعومة
- invoice: فاتورة مبيعات أو مشتريات
- payment_receipt: إيصال دفع أو سند قبض
- bank_transfer: إيصال تحويل بنكي
- receipt: وصل استلام
- debit_note: إشعار مدين
- credit_note: إشعار دائن
- account_statement: كشف حساب
- expense: مصروف
- handwritten: مستند بخط اليد
- unknown: لا يمكن تحديد النوع
- other: نوع آخر

### 4. تحديد اتجاه العملية
- gave (عليه): المؤسسة باعت أو قدمت خدمة → المال مستحق عليها للمستند
- received (له): المؤسسة دفعت أو استلمت دفعة → المال دخل إليها

### 5. التعامل مع الفواتير العربية
- قد يكون التاريخ هجريًا أو ميلاديًا
- إذا كان هجريًا، اذكر ذلك في extra_fields
- قد تكون الأرقام عربية (٢٠٢٦) أو لاتينية

### 6. المستند الذي يحتوي عدة بنود
- استخرج كل بند منفصلًا
- لا تدمج بنودًا مختلفة في بند واحد
- إذا كانت الكمية أو السعر غير واضح، ضعها null وليس 0

### 7. التحذيرات
- أضف تحذيرات واضحة إذا:
  * صورة مائلة أو منخفضة الجودة
  * خط يد يصعب قراءته
  * مبالغ متناقضة (مثلاً: مجموع البنود لا يساوي الإجمالي)
  * تواريخ غير منطقية
  * بيانات مفقودة مهمة

### 8. extra_fields — البيانات الإضافية
إذا وجدت بيانات مهمة لا تقع في الحقول المعيارية، ضعها في extra_fields:
- رقم أمر الشراء (PO Number)
- رقم العقد
- مركز التكلفة
- رقم المشروع
- الفترة المشمولة
- شروط الدفع
- ملاحظات خاصة
- أي بيانات أخرى مهمة

لا تترك بيانات مهمة خارج الـ JSON.`;

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
}

export async function analyzeDocument(
  options: AnalyzeDocumentOptions
): Promise<AnalyzeDocumentResult> {
  const startTime = Date.now();

  try {
    const model = genAI.getGenerativeModel({
      model: process.env.GEMINI_MODEL || 'gemini-1.5-pro',
      systemInstruction: FINANCIAL_DOCUMENT_SYSTEM_PROMPT,
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: EXTRACTION_SCHEMA as any,
        temperature: 0.1, // منخفضة لدقة أعلى
        maxOutputTokens: 8192,
      },
    });

    const prompt = `حلل هذا المستند المالي واستخرج جميع البيانات الممكنة.
اسم الملف: ${options.fileName || 'غير معروف'}
نوع الملف: ${options.mimeType}

المطلوب:
1. حدد نوع المستند
2. استخرج جميع البيانات المالية
3. استخرج بيانات الطرف (المورد/العميل)
4. استخرج جميع بنود الفاتورة
5. حدد اتجاه العملية (gave/received)
6. أضف أي بيانات إضافية في extra_fields
7. أضف تحذيرات إذا كانت الصورة غير واضحة أو البيانات متناقضة`;

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

    let extraction: GeminiExtractionResult;
    try {
      extraction = JSON.parse(rawText);
    } catch {
      // إذا فشل parse الـ JSON، أرجع خطأ
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
    };
  } catch (error) {
    const processingTime = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'خطأ غير متوقع';
    
    return {
      success: false,
      error: errorMessage,
      processingTime,
    };
  }
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
      model: 'gemini-1.5-flash', // نموذج أسرع لمهام البحث البسيطة
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
