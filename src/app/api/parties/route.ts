import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { normalizeArabicText } from '@/lib/validations';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const search = searchParams.get('search') || '';
  const type = searchParams.get('type') || '';

  const where: Record<string, unknown> = {};
  if (type) where.type = type;
  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { normalizedName: { contains: normalizeArabicText(search), mode: 'insensitive' } },
    ];
  }

  const parties = await prisma.party.findMany({
    where,
    orderBy: { name: 'asc' },
    select: {
      id: true,
      name: true,
      type: true,
      phone: true,
      email: true,
      taxNumber: true,
      openingBalance: true,
      isActive: true,
    },
  });

  return NextResponse.json({
    success: true,
    data: parties.map(p => ({
      ...p,
      openingBalance: parseFloat(p.openingBalance.toString()),
    })),
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json();

  // مرونة: قبول أي حقول إضافية في metadata
  const { name, type, phone, email, taxNumber, commercialRegistration,
          address, bankName, iban, openingBalance, openingBalanceDate,
          notes, metadata, ...extraFields } = body;

  if (!name) {
    return NextResponse.json({ success: false, error: 'اسم الطرف مطلوب' }, { status: 400 });
  }

  const party = await prisma.party.create({
    data: {
      name,
      normalizedName: normalizeArabicText(name),
      type: type || 'other',
      phone: phone || null,
      email: email || null,
      taxNumber: taxNumber || null,
      commercialRegistration: commercialRegistration || null,
      address: address || null,
      bankName: bankName || null,
      iban: iban || null,
      openingBalance: openingBalance || 0,
      openingBalanceDate: openingBalanceDate ? new Date(openingBalanceDate) : null,
      notes: notes || null,
      // مرونة: حقول إضافية في metadata
      metadata: Object.keys(extraFields).length > 0
        ? { ...metadata, ...extraFields }
        : metadata || null,
    },
  });

  return NextResponse.json({ success: true, data: party });
}
