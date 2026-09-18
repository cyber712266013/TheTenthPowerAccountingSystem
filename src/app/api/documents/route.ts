import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// ─── GET /api/documents — قائمة المستندات مع فلترة ──────────

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const status = searchParams.get('status');
  const page = parseInt(searchParams.get('page') || '1');
  const pageSize = parseInt(searchParams.get('pageSize') || '20');
  const search = searchParams.get('search');

  try {
    const where: Record<string, unknown> = {};

    if (status) where.processingStatus = status;

    if (search) {
      where.OR = [
        { fileName: { contains: search, mode: 'insensitive' } },
        { originalFileName: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [documents, total] = await Promise.all([
      prisma.document.findMany({
        where,
        orderBy: { uploadedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          fileName: true,
          originalFileName: true,
          mimeType: true,
          fileSizeBytes: true,
          processingStatus: true,
          overallConfidence: true,
          warnings: true,
          uploadedAt: true,
          processingError: true,
          uploadedBy: { select: { id: true, name: true } },
        },
      }),
      prisma.document.count({ where }),
    ]);

    return NextResponse.json({
      success: true,
      data: documents.map(d => ({
        ...d,
        overallConfidence: d.overallConfidence ? parseFloat(d.overallConfidence.toString()) : null,
      })),
      pagination: {
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      },
    });
  } catch (error) {
    console.error('[Documents GET]', error);
    return NextResponse.json(
      { success: false, error: 'فشل في جلب المستندات' },
      { status: 500 }
    );
  }
}
