export type VCardPhone = { value: string; types: string[]; pref: boolean };
export type VCardEmail = { value: string; types: string[]; pref: boolean };
export type VCardAddress = { formatted: string; types: string[]; pref: boolean };

export type VCard = {
  name: string | null;
  phones: VCardPhone[];
  emails: VCardEmail[];
  addresses: VCardAddress[];
  org: string | null;
  note: string | null;
};

type Prop = {
  group: string | null;
  key: string;
  params: Record<string, string[]>;
  value: string;
};

/** Apple shares contacts as text/x-vcard; some clients use text/vcard. */
export function isVcardContentType(contentType: string | null | undefined): boolean {
  const ct = (contentType || '').split(';')[0].trim().toLowerCase();
  return ct === 'text/vcard' || ct === 'text/x-vcard' || ct === 'text/directory' || ct.includes('vcard');
}

export function parseVCards(input: string): VCard[] {
  const unfolded = unfold(input);
  const cards: VCard[] = [];
  for (const chunk of unfolded.split(/BEGIN:VCARD/i)) {
    if (!/END:VCARD/i.test(chunk)) continue;
    const body = chunk.split(/END:VCARD/i)[0];
    const card = parseCard(body);
    if (card) cards.push(card);
  }
  return cards;
}

function unfold(input: string): string {
  let s = input.replace(/^\uFEFF/, '');
  s = s.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  // RFC 6350: a line break plus one leading space or tab is a fold.
  s = s.replace(/\n[ \t]/g, '');
  // Quoted-printable soft breaks end in "=". Don't swallow the next property
  // when base64 (PHOTO) happens to end in padding.
  const lines = s.split('\n');
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    while (line.endsWith('=') && i + 1 < lines.length && !isPropertyLine(lines[i + 1])) {
      line = line.slice(0, -1) + lines[i + 1];
      i++;
    }
    out.push(line);
  }
  return out.join('\n');
}

function isPropertyLine(line: string): boolean {
  return /^(?:[A-Za-z0-9-]+\.)?[A-Za-z0-9-]+(?:;[^:]*)?:/.test(line);
}

function parseCard(body: string): VCard | null {
  const props: Prop[] = [];
  for (const line of body.split('\n')) {
    if (!line.trim()) continue;
    const prop = parseLine(line.trimEnd());
    if (prop) props.push(prop);
  }
  if (!props.length) return null;

  const labels = new Map<string, string>();
  for (const prop of props) {
    if (prop.key === 'X-ABLABEL' && prop.group) labels.set(prop.group, prop.value.trim());
  }

  let fn = '';
  let n = '';
  const phones: VCardPhone[] = [];
  const emails: VCardEmail[] = [];
  const addresses: VCardAddress[] = [];
  let org: string | null = null;
  const notes: string[] = [];

  for (const prop of props) {
    const types = typesOf(prop, labels);
    const pref = types.some((t) => t.toLowerCase() === 'pref') || (prop.params.pref || []).some((v) => v !== '0');
    const decoded = decodeValue(prop);
    if (prop.key === 'FN' && decoded.trim()) fn = unescapeText(decoded).trim();
    else if (prop.key === 'N' && decoded.trim()) n = decoded;
    else if (prop.key === 'TEL') {
      const value = cleanPhone(decoded);
      if (value) phones.push({ value, types, pref });
    } else if (prop.key === 'EMAIL') {
      const value = cleanEmail(decoded);
      if (value) emails.push({ value, types, pref });
    } else if (prop.key === 'ADR') {
      const formatted = formatAdr(decoded);
      if (formatted) addresses.push({ formatted, types, pref });
    } else if (prop.key === 'ORG') {
      const parts = splitEscaped(decoded, ';').map((s) => s.trim()).filter(Boolean);
      if (parts[0]) org = parts[0];
    } else if (prop.key === 'NOTE') {
      const note = unescapeText(decoded).trim();
      if (note) notes.push(note);
    }
  }

  return {
    name: fn || nameFromN(n),
    phones: preferFirst(phones),
    emails: preferFirst(emails),
    addresses: preferFirst(addresses),
    org,
    note: notes.join('\n') || null,
  };
}

function parseLine(line: string): Prop | null {
  const idx = indexOfParamColon(line);
  if (idx <= 0) return null;
  const pieces = splitTop(line.slice(0, idx), ';');
  const namePart = pieces[0];
  const dot = namePart.indexOf('.');
  const group = dot >= 0 ? namePart.slice(0, dot) : null;
  const key = (dot >= 0 ? namePart.slice(dot + 1) : namePart).toUpperCase();
  if (!key || key === 'BEGIN' || key === 'END') return null;

  const params: Record<string, string[]> = {};
  for (const piece of pieces.slice(1)) {
    const eq = piece.indexOf('=');
    if (eq === -1) {
      pushParam(params, 'type', piece.trim());
      continue;
    }
    const k = piece.slice(0, eq).trim().toLowerCase();
    let v = piece.slice(eq + 1).trim();
    if (v.startsWith('"') && v.endsWith('"') && v.length >= 2) v = v.slice(1, -1);
    if (k === 'type') {
      for (const part of v.split(',')) pushParam(params, 'type', part.trim());
    } else {
      pushParam(params, k, v);
    }
  }
  return { group, key, params, value: line.slice(idx + 1) };
}

function pushParam(params: Record<string, string[]>, key: string, value: string) {
  if (!value) return;
  params[key] = params[key] || [];
  params[key].push(value);
}

function indexOfParamColon(line: string): number {
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') quoted = !quoted;
    else if (c === ':' && !quoted) return i;
  }
  return -1;
}

function splitTop(input: string, sep: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (c === '"') {
      quoted = !quoted;
      cur += c;
      continue;
    }
    if (c === '\\' && !quoted) {
      cur += c;
      if (i + 1 < input.length) {
        cur += input[i + 1];
        i++;
      }
      continue;
    }
    if (c === sep && !quoted) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += c;
  }
  out.push(cur);
  return out;
}

function decodeValue(prop: Prop): string {
  const enc = (prop.params.encoding || []).join('').toUpperCase();
  if (enc === 'QUOTED-PRINTABLE' || enc === 'Q') return decodeQuotedPrintable(prop.value);
  return prop.value;
}

function decodeQuotedPrintable(input: string): string {
  const bytes: number[] = [];
  for (let i = 0; i < input.length; i++) {
    if (input[i] === '=' && /^[0-9A-Fa-f]{2}$/.test(input.slice(i + 1, i + 3))) {
      bytes.push(parseInt(input.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      bytes.push(input.charCodeAt(i) & 0xff);
    }
  }
  return Buffer.from(bytes).toString('utf8');
}

function unescapeText(value: string): string {
  let out = '';
  for (let i = 0; i < value.length; i++) {
    if (value[i] === '\\' && i + 1 < value.length) {
      const n = value[i + 1];
      if (n === 'n' || n === 'N') out += '\n';
      else out += n;
      i++;
      continue;
    }
    out += value[i];
  }
  return out;
}

function splitEscaped(value: string, sep: string): string[] {
  const parts: string[] = [];
  let cur = '';
  for (let i = 0; i < value.length; i++) {
    if (value[i] === '\\' && i + 1 < value.length) {
      const n = value[i + 1];
      if (n === 'n' || n === 'N') cur += '\n';
      else cur += n;
      i++;
      continue;
    }
    if (value[i] === sep) {
      parts.push(cur);
      cur = '';
      continue;
    }
    cur += value[i];
  }
  parts.push(cur);
  return parts;
}

function nameFromN(value: string): string | null {
  if (!value.trim()) return null;
  const [family = '', given = '', additional = '', prefix = '', suffix = ''] = splitEscaped(value, ';').map((s) => s.trim());
  const name = [prefix, given, additional, family, suffix].filter(Boolean).join(' ').trim();
  return name || null;
}

function formatAdr(value: string): string | null {
  const [pobox = '', ext = '', street = '', city = '', region = '', postal = '', country = ''] = splitEscaped(value, ';').map((s) => s.trim());
  const line1 = [pobox, ext, street].filter(Boolean).join(' ').trim();
  const stateZip = [region, postal].filter(Boolean).join(' ').trim();
  const line2 = [city, stateZip].filter(Boolean).join(', ').trim();
  const includeCountry = country && !/^(usa|us|united states|united states of america)$/i.test(country);
  const formatted = [line1, line2, includeCountry ? country : ''].filter(Boolean).join(', ');
  return formatted || null;
}

function cleanPhone(value: string): string | null {
  const v = unescapeText(value).trim().replace(/^tel:/i, '');
  if (v.replace(/\D/g, '').length < 7) return null;
  return v;
}

function cleanEmail(value: string): string | null {
  const v = unescapeText(value).trim().replace(/^mailto:/i, '');
  if (!v.includes('@')) return null;
  return v;
}

function typesOf(prop: Prop, labels: Map<string, string>): string[] {
  const types = [...(prop.params.type || [])];
  if (prop.group && labels.has(prop.group)) types.push(labels.get(prop.group) as string);
  return types.map((t) => t.trim()).filter(Boolean);
}

function preferFirst<T extends { pref: boolean; types: string[] }>(items: T[]): T[] {
  const rank = (item: T) => {
    if (item.pref) return 0;
    const types = item.types.map((t) => t.toLowerCase());
    if (types.some((t) => t === 'cell' || t === 'iphone' || t === 'mobile')) return 1;
    if (types.includes('home')) return 2;
    return 3;
  };
  return [...items].sort((a, b) => rank(a) - rank(b));
}
