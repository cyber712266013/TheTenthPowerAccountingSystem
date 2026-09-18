import { NextRequest, NextResponse } from 'next/server';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { prisma } = await import('@/lib/prisma');
  const { logAudit } = await import('@/lib/audit');
  const { id } = await params;

  const document = await prisma.document.findUnique({
    where: { id },
    select: { id: true, processingStatus: true, uploadedById: true },
  });

  if (!document) {
    return NextResponse.json({ success: false, error: 'المستند غير موجود' }, { status: 404 });
  }

  await prisma.document.update({
    where: { id },
    data: { processingStatus: 'rejected' },
  });

  await logAudit({
    entityType: 'document',
    entityId: id,
    action: 'reject',
    newValue: { status: 'rejected' },
    documentId: id,
  });

  return NextResponse.json({ success: true });
}
