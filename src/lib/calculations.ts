// ============================================================
// lib/calculations.ts — حسابات الرصيد المالي
// ============================================================
// القاعدة الثابتة: balance = previous_balance + on_us - for_us
// هذا الملف هو المصدر الوحيد للحسابات المالية في النظام
// ============================================================

import { TransactionDirection } from './types';

// ─── القاعدة الأساسية ──────────────────────────────────────

/**
 * حساب الرصيد الجديد
 * القاعدة: balanceAfter = balanceBefore + onUs - forUs
 * لا تتغير هذه القاعدة أبدًا
 */
export function calculateBalance(
  balanceBefore: number,
  onUs: number,  // عليه
  forUs: number  // له
): number {
  // نستخدم الجمع بالأرقام الصحيحة لتجنب float precision errors
  const result = round4(balanceBefore) + round4(onUs) - round4(forUs);
  return round4(result);
}

/**
 * تحويل اتجاه العملية إلى عليه/له
 */
export function directionToDebit(
  direction: TransactionDirection,
  amount: number
): { onUs: number; forUs: number } {
  if (direction === 'gave') {
    return { onUs: round4(amount), forUs: 0 };
  } else {
    return { onUs: 0, forUs: round4(amount) };
  }
}

// ─── التحقق من الحسابات ────────────────────────────────────

/**
 * التحقق من صحة مبالغ الفاتورة
 * المعادلة: subtotal + taxAmount - discount = total
 * وإذا كان هناك paid: remaining = total - paid
 */
export interface InvoiceAmounts {
  subtotal: number;
  taxAmount: number;
  discount: number;
  total: number;
  paidAmount?: number;
  remainingAmount?: number;
}

export interface AmountValidationResult {
  isValid: boolean;
  calculatedTotal: number;
  calculatedRemaining?: number;
  totalDiscrepancy?: number;
  remainingDiscrepancy?: number;
  warnings: string[];
}

export function validateInvoiceAmounts(amounts: InvoiceAmounts): AmountValidationResult {
  const { subtotal, taxAmount, discount, total, paidAmount, remainingAmount } = amounts;
  const warnings: string[] = [];

  const calculatedTotal = round4(subtotal + taxAmount - discount);
  const totalDiscrepancy = Math.abs(calculatedTotal - total);
  const TOLERANCE = 0.01; // تسامح ريال واحد (قد تكون فروق تقريب)

  let isValid = totalDiscrepancy <= TOLERANCE;

  if (!isValid) {
    warnings.push(
      `يوجد اختلاف في الإجمالي: المحسوب ${formatAmount(calculatedTotal)}، المسجل ${formatAmount(total)}`
    );
  }

  let calculatedRemaining: number | undefined;
  let remainingDiscrepancy: number | undefined;

  if (paidAmount !== undefined) {
    calculatedRemaining = round4(total - paidAmount);

    if (remainingAmount !== undefined) {
      remainingDiscrepancy = Math.abs(calculatedRemaining - remainingAmount);
      if (remainingDiscrepancy > TOLERANCE) {
        warnings.push(
          `يوجد اختلاف في المبلغ المتبقي: المحسوب ${formatAmount(calculatedRemaining)}، المسجل ${formatAmount(remainingAmount)}`
        );
        isValid = false;
      }
    }
  }

  return {
    isValid,
    calculatedTotal,
    calculatedRemaining,
    totalDiscrepancy,
    remainingDiscrepancy,
    warnings,
  };
}

/**
 * التحقق من مجموع بنود الفاتورة
 */
export function validateItemsTotal(
  items: { total: number }[],
  subtotal: number
): { isValid: boolean; itemsSum: number; discrepancy: number; warning?: string } {
  const itemsSum = round4(items.reduce((sum, item) => sum + round4(item.total), 0));
  const discrepancy = Math.abs(itemsSum - subtotal);
  const TOLERANCE = 0.01;

  if (discrepancy > TOLERANCE) {
    return {
      isValid: false,
      itemsSum,
      discrepancy,
      warning: `مجموع البنود (${formatAmount(itemsSum)}) لا يساوي الإجمالي الفرعي (${formatAmount(subtotal)})`,
    };
  }

  return { isValid: true, itemsSum, discrepancy: 0 };
}

// ─── إعادة حساب كشف الحساب ────────────────────────────────

export interface TransactionForRecalc {
  id: string;
  onUs: number;
  forUs: number;
  transactionDate: Date;
  createdAt: Date;
}

export interface RecalculatedTransaction {
  id: string;
  balanceBefore: number;
  balanceAfter: number;
}

/**
 * إعادة حساب كشف الحساب الكامل لطرف معين
 * يُستخدم عند: تعديل حركة، حذف، تغيير تاريخ، أو إدخال بأثر رجعي
 */
export function recalculateStatement(
  transactions: TransactionForRecalc[],
  openingBalance: number
): RecalculatedTransaction[] {
  // ترتيب العمليات: حسب تاريخ الحركة، ثم createdAt، ثم id
  const sorted = [...transactions].sort((a, b) => {
    const dateCompare = a.transactionDate.getTime() - b.transactionDate.getTime();
    if (dateCompare !== 0) return dateCompare;
    const createdCompare = a.createdAt.getTime() - b.createdAt.getTime();
    if (createdCompare !== 0) return createdCompare;
    return a.id.localeCompare(b.id);
  });

  let runningBalance = round4(openingBalance);
  const result: RecalculatedTransaction[] = [];

  for (const tx of sorted) {
    const balanceBefore = runningBalance;
    const balanceAfter = calculateBalance(runningBalance, tx.onUs, tx.forUs);
    result.push({ id: tx.id, balanceBefore, balanceAfter });
    runningBalance = balanceAfter;
  }

  return result;
}

// ─── اختبار القاعدة ────────────────────────────────────────

/**
 * يجب أن ينجح هذا الاختبار دائمًا
 * 6497.50 + 722636.43 - 533180.86 = 195953.07
 */
export function testBalanceCalculation(): boolean {
  const openingBalance = 6497.50;
  const totalOnUs = 722636.43;
  const totalForUs = 533180.86;
  const expectedFinal = 195953.07;

  const result = calculateBalance(openingBalance, totalOnUs, totalForUs);
  return Math.abs(result - expectedFinal) < 0.01;
}

// ─── Utilities ─────────────────────────────────────────────

/** تقريب لـ 4 خانات عشرية لتجنب float errors */
export function round4(num: number): number {
  return Math.round(num * 10000) / 10000;
}

/** تقريب لـ 2 خانات عشرية للعرض */
export function round2(num: number): number {
  return Math.round(num * 100) / 100;
}

/** تنسيق المبلغ للعرض */
export function formatAmount(amount: number, currency = 'SAR'): string {
  return new Intl.NumberFormat('ar-SA', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(amount);
}

/** تنسيق المبلغ بدون رمز العملة */
export function formatNumber(amount: number): string {
  return new Intl.NumberFormat('ar-SA', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(amount);
}
