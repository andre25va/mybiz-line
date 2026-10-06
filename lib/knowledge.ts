/**
 * lib/knowledge.ts
 * Core knowledge base functions: chunk, embed, store, search
 * Uses Supabase pgvector + OpenAI text-embedding-3-small (1536 dimensions)
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY!;

const CHUNK_SIZE = 500;   // tokens (approx 400 words)
const CHUNK_OVERLAP = 50; // tokens overlap between chunks
const EMBED_MODEL = 'text-embedding-3-small';
const TOP_K = 5;          // chunks to return per query

// ─── Chunking ──────────────────────────────────────────────────────────────

function chunkText(text: string): string[] {
  // Simple word-based chunking approximating token counts (~0.75 words/token)
  const words = text.split(/\s+/).filter(Boolean);
  const chunkWords = Math.floor(CHUNK_SIZE * 0.75);
  const overlapWords = Math.floor(CHUNK_OVERLAP * 0.75);
  const chunks: string[] = [];

  let i = 0;
  while (i < words.length) {
    const chunk = words.slice(i, i + chunkWords).join(' ');
    if (chunk.trim()) chunks.push(chunk.trim());
    i += chunkWords - overlapWords;
  }
  return chunks;
}

// ─── Embedding ─────────────────────────────────────────────────────────────

async function embed(texts: string[]): Promise<number[][]> {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: EMBED_MODEL, input: texts }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI embed error: ${err}`);
  }
  const data = await res.json();
  return data.data.map((d: any) => d.embedding);
}

// ─── Store document + chunks ───────────────────────────────────────────────

export async function storeKnowledge({
  userId,
  filename,
  text,
  source,
}: {
  userId: string;
  filename: string;
  text: string;
  source: 'upload' | 'email' | 'sms';
}): Promise<{ docId: string; chunkCount: number }> {
  // 1. Insert document record
  const docRes = await fetch(`${SUPABASE_URL}/rest/v1/kb_documents`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
    },
    body: JSON.stringify({ user_id: userId, filename, source, char_count: text.length }),
  });
  if (!docRes.ok) throw new Error(`Failed to create kb_document: ${await docRes.text()}`);
  const [doc] = await docRes.json();
  const docId = doc.id;

  // 2. Chunk the text
  const chunks = chunkText(text);
  if (chunks.length === 0) throw new Error('No content to index');

  // 3. Embed all chunks (batch)
  const embeddings = await embed(chunks);

  // 4. Insert all chunks
  const rows = chunks.map((content, i) => ({
    doc_id: docId,
    user_id: userId,
    content,
    embedding: JSON.stringify(embeddings[i]),
    chunk_index: i,
  }));

  const chunkRes = await fetch(`${SUPABASE_URL}/rest/v1/kb_chunks`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(rows),
  });
  if (!chunkRes.ok) throw new Error(`Failed to store chunks: ${await chunkRes.text()}`);

  return { docId, chunkCount: chunks.length };
}

// ─── Search knowledge base ─────────────────────────────────────────────────

export async function queryKnowledge(userId: string, question: string): Promise<string> {
  // 1. Embed the question
  const [queryEmbedding] = await embed([question]);

  // 2. Call Supabase RPC for similarity search
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/match_kb_chunks`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query_embedding: queryEmbedding,
      match_user_id: userId,
      match_count: TOP_K,
    }),
  });
  if (!res.ok) return ''; // silently skip if KB unavailable

  const chunks = await res.json();
  if (!Array.isArray(chunks) || chunks.length === 0) return '';

  return chunks.map((c: any) => c.content).join('\n\n---\n\n');
}

// ─── List documents ────────────────────────────────────────────────────────

export async function listDocuments(userId: string) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/kb_documents?user_id=eq.${userId}&order=created_at.desc`,
    {
      headers: {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
    }
  );
  if (!res.ok) return [];
  return res.json();
}

// ─── Delete document + its chunks ─────────────────────────────────────────

export async function deleteDocument(userId: string, docId: string) {
  // Chunks cascade delete via FK
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/kb_documents?id=eq.${docId}&user_id=eq.${userId}`,
    {
      method: 'DELETE',
      headers: {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
    }
  );
  return res.ok;
}
