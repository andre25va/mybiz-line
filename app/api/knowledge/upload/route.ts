/**
 * POST /api/knowledge/upload
 * Admin panel upload — PDF or plain text
 * Auth: session cookie required
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth-check';
import { storeKnowledge, listDocuments, deleteDocument } from '@/lib/knowledge';

export const dynamic = 'force-dynamic';

async function extractText(file: File): Promise<string> {
  const buffer = Buffer.from(await file.arrayBuffer());
  if (file.type === 'application/pdf') {
    const pdfParse = (await import('pdf-parse')).default;
    const result = await pdfParse(buffer);
    return result.text;
  }
  return buffer.toString('utf-8');
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const authResult = await requireAuth(req);
  if (authResult instanceof NextResponse) return authResult;

  const userId = authResult.userId;

  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const rawText = formData.get('text') as string | null;

    if (!file && !rawText) {
      return NextResponse.json({ error: 'file or text required' }, { status: 400 });
    }

    let text: string;
    let filename: string;

    if (file) {
      filename = file.name;
      text = await extractText(file);
    } else {
      filename = `text-${Date.now()}.txt`;
      text = rawText!;
    }

    if (!text.trim()) {
      return NextResponse.json({ error: 'No readable text found in file' }, { status: 422 });
    }

    const { docId, chunkCount } = await storeKnowledge({ userId, filename, text, source: 'upload' });
    return NextResponse.json({ success: true, docId, chunkCount, filename });
  } catch (err: any) {
    console.error('[knowledge/upload]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const authResult = await requireAuth(req);
  if (authResult instanceof NextResponse) return authResult;

  const userId = authResult.userId;
  const docs = await listDocuments(userId);
  return NextResponse.json({ documents: docs });
}

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const authResult = await requireAuth(req);
  if (authResult instanceof NextResponse) return authResult;

  const userId = authResult.userId;
  const { searchParams } = new URL(req.url);
  const docId = searchParams.get('id');
  if (!docId) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const ok = await deleteDocument(userId, docId);
  return NextResponse.json({ success: ok });
}
