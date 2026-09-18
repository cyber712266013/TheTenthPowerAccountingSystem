// Full Gemini invoice analysis test
require('dotenv').config({ path: '.env.local' });
const { GoogleGenerativeAI, SchemaType } = require('@google/generative-ai');
const fs = require('fs');
const path = require('path');

const API_KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';

console.log(`API Key: ${API_KEY?.substring(0, 15)}...`);
console.log(`Model: ${MODEL}\n`);

const genAI = new GoogleGenerativeAI(API_KEY);

async function test() {
  const model = genAI.getGenerativeModel({
    model: MODEL,
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.1,
      maxOutputTokens: 1024,
    }
  });

  const result = await model.generateContent([
    { text: 'أنت محلل فواتير. حلل هذا النص كفاتورة وأعد JSON يحتوي: {document_type, amount, currency, party_name, invoice_number}' },
    { text: 'فاتورة رقم: 2024/001\nمن: شركة الأنظمة التقنية\nإلى: مؤسسة الرياض\nالمبلغ: 5000 ريال\nالتاريخ: 2024-01-15' }
  ]);

  const text = result.response.text();
  console.log('✅ Gemini يعمل!\n');
  console.log('النتيجة:', JSON.parse(text));
}

test().catch(e => {
  console.error('❌ خطأ:', e.message);
});
