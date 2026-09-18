// ============================================================
// lib/audit.ts — سجل التدقيق المالي
// ============================================================

import { prisma } from './prisma';

export interface AuditEntry {
  userId?: string;
  entityType: string;
  entityId: string;
  action: 'create' | 'update' | 'approve' | 'reject' | 'void' | 'delete' | 'view' | 'export' | 're_analyze';
  fieldName?: string;
  oldValue?: unknown;
  newValue?: unknown;
  reason?: string;
  ipAddress?: string;
  userAgent?: string;
  documentId?: string;
  // مرونة: أي بيانات سياق إضافية
  metadata?: Record<string, unknown>;
}

/**
 * تسجيل حدث في سجل التدقيق
 * لا تحذف سجلات التدقيق أبدًا
 */
export async function logAudit(entry: AuditEntry): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId: entry.userId,
        entityType: entry.entityType,
        entityId: entry.entityId,
        action: entry.action,
        fieldName: entry.fieldName,
        oldValue: entry.oldValue !== undefined ? JSON.parse(JSON.stringify(entry.oldValue)) : undefined,
        newValue: entry.newValue !== undefined ? JSON.parse(JSON.stringify(entry.newValue)) : undefined,
        reason: entry.reason,
        ipAddress: entry.ipAddress,
        userAgent: entry.userAgent,
        documentId: entry.documentId,
        metadata: entry.metadata ? JSON.parse(JSON.stringify(entry.metadata)) : undefined,
      },
    });
  } catch (error) {
    // سجل التدقيق لا يجب أن يوقف العملية الرئيسية
    console.error('[Audit] فشل تسجيل الحدث:', error);
  }
}

/**
 * تسجيل تغييرات متعددة الحقول مرة واحدة
 */
export async function logFieldChanges(
  userId: string,
  entityType: string,
  entityId: string,
  changes: { field: string; oldValue: unknown; newValue: unknown }[],
  reason?: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  const entries = changes
    .filter((c) => JSON.stringify(c.oldValue) !== JSON.stringify(c.newValue))
    .map((c) => ({
      userId,
      entityType,
      entityId,
      action: 'update' as const,
      fieldName: c.field,
      oldValue: c.oldValue,
      newValue: c.newValue,
      reason,
      metadata,
    }));

  if (entries.length === 0) return;

  await Promise.all(entries.map(logAudit));
}

/**
 * استرجاع سجل التدقيق لسجل معين
 */
export async function getEntityAuditLog(entityType: string, entityId: string) {
  return prisma.auditLog.findMany({
    where: { entityType, entityId },
    include: {
      user: { select: { id: true, name: true, email: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
}
