/**
 * GET /api/grok/knowledge?q=question&userId=uuid
 * Grok-facing endpoint to query the knowledge base
 * Auth: MYBIZ_API_KEY (Bearer)
 */
import { NextRequest, NextResponse } from 'next/server';
import { validateGrokKey } from '@/lib/grok-auth';
import { queryKnowledge, listDocuments } from '@/lib/knowledge';

export async function GET(req: NextRequest) {
  const err = validateGrokKey(req);
  if (err) return err;

  const { searchParams } = new URL(req.url);
  const question = searchParams.get('q');
  const userId = searchParams.get('userId');

  if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 });

  // List mode
  if (!question) {
    const docs = await listDocuments(userId);
    return NextResponse.json({ documents: docs });
  }

  // Search mode
  const context = await queryKnowledge(userId, question);
  return NextResponse.json({
    context,
    hasKnowledge: context.length > 0,
  });
}
