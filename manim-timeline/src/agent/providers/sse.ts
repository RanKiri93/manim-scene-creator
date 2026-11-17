/** One server-sent event: its `event:` name (empty when absent) and joined `data:` lines. */
export interface SseEvent {
  event: string;
  data: string;
}

/** Split a fetch response body into server-sent events as they arrive. */
export async function* readSse(res: Response): AsyncGenerator<SseEvent> {
  if (!res.body) throw new Error('The response has no body to stream.');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let event = '';
  let data: string[] = [];
  const takeLine = function* (line: string): Generator<SseEvent> {
    if (line === '') {
      if (data.length) yield { event, data: data.join('\n') };
      event = '';
      data = [];
      return;
    }
    if (line.startsWith(':')) return;
    const colon = line.indexOf(':');
    const field = colon < 0 ? line : line.slice(0, colon);
    const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '');
    if (field === 'event') event = value;
    else if (field === 'data') data.push(value);
  };
  for (;;) {
    const { done, value } = await reader.read();
    buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.search(/\r?\n/)) >= 0) {
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(buffer[nl] === '\r' ? nl + 2 : nl + 1);
      yield* takeLine(line);
    }
    if (done) {
      if (buffer) yield* takeLine(buffer);
      yield* takeLine('');
      return;
    }
  }
}

/**
 * The value of a string field in JSON that is still arriving (a tool call's arguments), as far as
 * it has come: `{"reply": "Added the ti` gives `Added the ti`. Undefined until the field starts.
 */
export function partialJsonStringField(json: string, field: string): string | undefined {
  const m = new RegExp(`"${field}"\\s*:\\s*"`).exec(json);
  if (!m) return undefined;
  let out = '';
  for (let i = m.index + m[0].length; i < json.length; i++) {
    const c = json[i]!;
    if (c === '"') return out;
    if (c !== '\\') {
      out += c;
      continue;
    }
    const next = json[i + 1];
    if (next == null) return out;
    if (next === 'u') {
      const hex = json.slice(i + 2, i + 6);
      if (hex.length < 4) return out;
      out += String.fromCharCode(parseInt(hex, 16));
      i += 5;
      continue;
    }
    out += ({ n: '\n', t: '\t', r: '\r', b: '\b', f: '\f' } as Record<string, string>)[next] ?? next;
    i += 1;
  }
  return out;
}
