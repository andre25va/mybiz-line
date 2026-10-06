import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth-check';

export const runtime = 'nodejs';

function parseDurationSeconds(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const match = value.match(/^(\d+(?:\.\d+)?)s$/);
  if (!match) return null;
  const seconds = Math.ceil(Number(match[1]));
  return Number.isFinite(seconds) && seconds > 0 && seconds <= 86_400 ? seconds : null;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const session = requireAuth(req);
  if (session instanceof NextResponse) return session;

  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'ETA is not configured. Please contact support.' }, { status: 503 });
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }
  const body = payload as { originLat?: unknown; originLng?: unknown; destinationAddress?: unknown };
  const lat = body?.originLat;
  const lng = body?.originLng;
  const address = body?.destinationAddress;
  if (typeof lat !== 'number' || !Number.isFinite(lat) || lat < -90 || lat > 90 ||
      typeof lng !== 'number' || !Number.isFinite(lng) || lng < -180 || lng > 180 ||
      typeof address !== 'string' || !address.trim() || address.length > 500) {
    return NextResponse.json({ error: 'A valid location and contact address are required.' }, { status: 400 });
  }

  try {
    const response = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'routes.duration',
      },
      body: JSON.stringify({
        origin: { location: { latLng: { latitude: lat, longitude: lng } } },
        destination: { address: address.trim() },
        travelMode: 'DRIVE',
        routingPreference: 'TRAFFIC_AWARE',
      }),
      signal: AbortSignal.timeout(12_000),
      cache: 'no-store',
    });
    if (!response.ok) {
      return NextResponse.json({ error: 'Could not calculate a driving ETA. Please try again.' }, { status: 502 });
    }
    const data = await response.json();
    const durationSeconds = parseDurationSeconds(data?.routes?.[0]?.duration);
    if (!durationSeconds) {
      return NextResponse.json({ error: 'No driving route was found for this address.' }, { status: 502 });
    }
    return NextResponse.json({ durationSeconds });
  } catch {
    return NextResponse.json({ error: 'ETA service is temporarily unavailable. Please try again.' }, { status: 502 });
  }
}
