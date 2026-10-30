import { unzlibSync } from 'fflate';

/** A piece of text drawn on a page, in PDF user-space units (y grows upwards). */
export type TextItem = { page: number; x: number; y: number; width: number; text: string };

type PdfObject = { dict: string; stream?: Uint8Array };

const latin1 = (bytes: Uint8Array) => {
  let out = '';
  for (let index = 0; index < bytes.length; index += 8192) out += String.fromCharCode(...bytes.subarray(index, index + 8192));
  return out;
};

/** Reads every "n 0 obj … endobj" body; streams are inflated when FlateDecode. */
function readObjects(bytes: Uint8Array) {
  const source = latin1(bytes);
  const objects = new Map<number, PdfObject>();
  const pattern = /(\d+)\s+\d+\s+obj\b/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source))) {
    const start = match.index + match[0].length;
    const end = source.indexOf('endobj', start);
    if (end < 0) break;
    const body = source.slice(start, end);
    const streamAt = body.indexOf('stream');
    if (streamAt < 0) { objects.set(Number(match[1]), { dict: body }); continue; }
    const dict = body.slice(0, streamAt);
    let dataStart = start + streamAt + 'stream'.length;
    if (source[dataStart] === '\r') dataStart += 1;
    if (source[dataStart] === '\n') dataStart += 1;
    const dataEnd = source.lastIndexOf('endstream', end);
    let data = bytes.subarray(dataStart, dataEnd);
    if (/\/FlateDecode/.test(dict)) {
      try { data = unzlibSync(data); } catch { data = new Uint8Array(); }
    }
    objects.set(Number(match[1]), { dict, stream: data });
    pattern.lastIndex = end;
  }
  return objects;
}

const refOf = (dict: string, key: string) => {
  const found = new RegExp(`/${key}\\s+(\\d+)\\s+\\d+\\s+R`).exec(dict);
  return found ? Number(found[1]) : null;
};

/** ToUnicode CMap → code (as number) → text. */
function parseCMap(text: string) {
  const map = new Map<number, string>();
  const hexToText = (hex: string) => {
    let out = '';
    for (let index = 0; index + 4 <= hex.length; index += 4) out += String.fromCharCode(parseInt(hex.slice(index, index + 4), 16));
    if (hex.length === 2) out = String.fromCharCode(parseInt(hex, 16));
    return out;
  };
  for (const block of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const pair of block[1]!.matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) map.set(parseInt(pair[1]!, 16), hexToText(pair[2]!));
  }
  for (const block of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const range of block[1]!.matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(<[0-9a-fA-F]+>|\[[^\]]*\])/g)) {
      const low = parseInt(range[1]!, 16); const high = parseInt(range[2]!, 16);
      if (range[3]!.startsWith('[')) {
        const targets = [...range[3]!.matchAll(/<([0-9a-fA-F]+)>/g)].map((target) => hexToText(target[1]!));
        targets.forEach((target, offset) => map.set(low + offset, target));
      } else {
        const base = parseInt(range[3]!.slice(1, -1), 16);
        for (let code = low; code <= high; code += 1) map.set(code, String.fromCharCode(base + code - low));
      }
    }
  }
  return map;
}

/** Literal "(…)" string with PDF escapes → raw byte codes. */
function literalBytes(raw: string) {
  const codes: number[] = [];
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index]!;
    if (char !== '\\') { codes.push(char.charCodeAt(0)); continue; }
    const next = raw[++index];
    if (next === undefined) break;
    const simple: Record<string, number> = { n: 10, r: 13, t: 9, b: 8, f: 12, '(': 40, ')': 41, '\\': 92 };
    if (next in simple) { codes.push(simple[next]!); continue; }
    if (/[0-7]/.test(next)) {
      let octal = next;
      while (octal.length < 3 && /[0-7]/.test(raw[index + 1] ?? '')) octal += raw[++index];
      codes.push(parseInt(octal, 8));
      continue;
    }
    if (next === '\r' || next === '\n') { if (next === '\r' && raw[index + 1] === '\n') index += 1; continue; }
    codes.push(next.charCodeAt(0));
  }
  return codes;
}

type Token = { kind: 'num' | 'name' | 'str' | 'hex' | 'op' | 'open' | 'close'; value: string };

/** Minimal content-stream tokenizer: enough for text operators. */
function* tokens(content: string): Generator<Token> {
  let index = 0;
  while (index < content.length) {
    const char = content[index]!;
    if (/\s/.test(char)) { index += 1; continue; }
    if (char === '%') { while (index < content.length && content[index] !== '\n') index += 1; continue; }
    if (char === '(') {
      let depth = 1; let value = ''; index += 1;
      while (index < content.length && depth > 0) {
        const current = content[index]!;
        if (current === '\\') { value += current + (content[index + 1] ?? ''); index += 2; continue; }
        if (current === '(') depth += 1;
        if (current === ')') { depth -= 1; if (depth === 0) { index += 1; break; } }
        value += current; index += 1;
      }
      yield { kind: 'str', value }; continue;
    }
    if (char === '<' && content[index + 1] === '<') { index += 2; yield { kind: 'op', value: '<<' }; continue; }
    if (char === '>' && content[index + 1] === '>') { index += 2; yield { kind: 'op', value: '>>' }; continue; }
    if (char === '<') { const end = content.indexOf('>', index); yield { kind: 'hex', value: content.slice(index + 1, end).replace(/\s/g, '') }; index = end + 1; continue; }
    if (char === '[') { index += 1; yield { kind: 'open', value: '[' }; continue; }
    if (char === ']') { index += 1; yield { kind: 'close', value: ']' }; continue; }
    if (char === '/') { let value = ''; index += 1; while (index < content.length && !/[\s/[\]()<>%]/.test(content[index]!)) value += content[index++]; yield { kind: 'name', value }; continue; }
    let value = '';
    while (index < content.length && !/[\s/[\]()<>%]/.test(content[index]!)) value += content[index++];
    if (!value) { index += 1; continue; }
    yield { kind: /^[-+]?(\d+\.?\d*|\.\d+)$/.test(value) ? 'num' : 'op', value };
  }
}

type Matrix = [number, number, number, number, number, number];
type FontWidths = { first: number; widths: number[] };
const multiply = (a: Matrix, b: Matrix): Matrix => [
  a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3], a[2] * b[0] + a[3] * b[2],
  a[2] * b[1] + a[3] * b[3], a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5],
];

/**
 * Extracts positioned text from simple PDFs (single-byte fonts with ToUnicode maps, Flate streams),
 * such as the Ghostscript-produced school menus. Pure JavaScript, so it runs offline in Hermes.
 */
export function extractPdfText(bytes: Uint8Array): TextItem[] {
  const objects = readObjects(bytes);
  const cmaps = new Map<number, Map<number, string>>();
  const fontMap = (fontObject: number) => {
    if (!cmaps.has(fontObject)) {
      const toUnicode = refOf(objects.get(fontObject)?.dict ?? '', 'ToUnicode');
      const stream = toUnicode !== null ? objects.get(toUnicode)?.stream : undefined;
      cmaps.set(fontObject, stream ? parseCMap(latin1(stream)) : new Map());
    }
    return cmaps.get(fontObject)!;
  };
  const widthCache = new Map<number, FontWidths>();
  const fontWidths = (fontObject: number): FontWidths => {
    if (!widthCache.has(fontObject)) {
      const dict = objects.get(fontObject)?.dict ?? '';
      const first = Number(/\/FirstChar\s+(\d+)/.exec(dict)?.[1] ?? 0);
      const widthsRef = refOf(dict, 'Widths');
      const source = widthsRef !== null ? objects.get(widthsRef)?.dict ?? '' : /\/Widths\s*\[([^\]]*)\]/.exec(dict)?.[1] ?? '';
      widthCache.set(fontObject, { first, widths: (source.match(/-?\d+(\.\d+)?/g) ?? []).map(Number) });
    }
    return widthCache.get(fontObject)!;
  };
  const resolveDict = (dict: string, key: string) => {
    const ref = refOf(dict, key);
    if (ref !== null) return objects.get(ref)?.dict ?? '';
    const inline = new RegExp(`/${key}\\s*<<`).exec(dict);
    if (!inline) return '';
    let depth = 0; let index = inline.index + inline[0].length - 2;
    const start = index;
    for (; index < dict.length; index += 1) {
      if (dict.startsWith('<<', index)) { depth += 1; index += 1; } else if (dict.startsWith('>>', index)) { depth -= 1; index += 1; if (depth === 0) break; }
    }
    return dict.slice(start, index + 1);
  };

  const pages = [...objects.entries()].filter(([, object]) => /\/Type\s*\/Page\b/.test(object.dict)).sort(([a], [b]) => a - b);
  const items: TextItem[] = [];
  pages.forEach(([, page], pageIndex) => {
    const fonts = new Map<string, number>();
    const fontDict = resolveDict(resolveDict(page.dict, 'Resources') || page.dict, 'Font');
    for (const font of fontDict.matchAll(/\/([^\s/<>[\]]+)\s+(\d+)\s+\d+\s+R/g)) fonts.set(font[1]!, Number(font[2]));
    const contentRefs = (() => {
      const array = /\/Contents\s*\[([^\]]*)\]/.exec(page.dict);
      if (array) return [...array[1]!.matchAll(/(\d+)\s+\d+\s+R/g)].map((ref) => Number(ref[1]));
      const single = refOf(page.dict, 'Contents');
      return single !== null ? [single] : [];
    })();
    const content = contentRefs.map((ref) => latin1(objects.get(ref)?.stream ?? new Uint8Array())).join('\n');

    let ctm: Matrix = [1, 0, 0, 1, 0, 0];
    const stack: Matrix[] = [];
    let textMatrix: Matrix = [1, 0, 0, 1, 0, 0];
    let lineMatrix: Matrix = [1, 0, 0, 1, 0, 0];
    let leading = 0;
    let map = new Map<number, string>();
    let widths: FontWidths = { first: 0, widths: [] };
    let fontSize = 1;
    const operands: Token[] = [];
    let array: Token[] | null = null;
    const emit = (codes: number[], adjust = 0) => {
      const text = codes.map((code) => map.get(code) ?? String.fromCharCode(code)).join('');
      const position = multiply(textMatrix, ctm);
      // Advance in text space from the font widths, then scaled to the page like the position.
      const advance = (codes.reduce((sum, code) => sum + (widths.widths[code - widths.first] ?? 500), 0) - adjust) / 1000 * fontSize;
      const width = advance * Math.hypot(position[0], position[1]);
      if (text.trim()) items.push({ page: pageIndex + 1, x: position[4], y: position[5], width, text });
      textMatrix = multiply([1, 0, 0, 1, advance, 0], textMatrix);
    };
    const toCodes = (token: Token) => token.kind === 'hex'
      ? (token.value.match(/../g) ?? []).map((pair) => parseInt(pair, 16))
      : literalBytes(token.value);
    const nums = () => operands.map((operand) => Number(operand.value));

    for (const token of tokens(content)) {
      if (token.kind === 'open') { array = []; continue; }
      if (token.kind === 'close') { operands.push({ kind: 'op', value: '__array__' }); continue; }
      if (array && token.kind !== 'op') { array.push(token); continue; }
      if (token.kind !== 'op' || token.value === '<<' || token.value === '>>') { operands.push(token); continue; }
      const n = nums();
      switch (token.value) {
        case 'q': stack.push(ctm); break;
        case 'Q': ctm = stack.pop() ?? [1, 0, 0, 1, 0, 0]; break;
        case 'cm': if (n.length >= 6) ctm = multiply(n.slice(-6) as Matrix, ctm); break;
        case 'BT': textMatrix = [1, 0, 0, 1, 0, 0]; lineMatrix = [1, 0, 0, 1, 0, 0]; break;
        case 'Tf': { const name = operands.find((operand) => operand.kind === 'name')?.value; const ref = name ? fonts.get(name) : undefined; map = ref !== undefined ? fontMap(ref) : new Map(); widths = ref !== undefined ? fontWidths(ref) : { first: 0, widths: [] }; fontSize = n.at(-1) ?? 1; break; }
        case 'TL': leading = n[0] ?? 0; break;
        case 'Tm': if (n.length >= 6) { textMatrix = n.slice(-6) as Matrix; lineMatrix = textMatrix; } break;
        case 'Td': case 'TD': {
          const [tx = 0, ty = 0] = n.slice(-2);
          if (token.value === 'TD') leading = -ty;
          lineMatrix = multiply([1, 0, 0, 1, tx, ty], lineMatrix); textMatrix = lineMatrix; break;
        }
        case 'T*': lineMatrix = multiply([1, 0, 0, 1, 0, -leading], lineMatrix); textMatrix = lineMatrix; break;
        case 'Tj': case "'": case '"': {
          if (token.value !== 'Tj') { lineMatrix = multiply([1, 0, 0, 1, 0, -leading], lineMatrix); textMatrix = lineMatrix; }
          const text = [...operands].reverse().find((operand) => operand.kind === 'str' || operand.kind === 'hex');
          if (text) emit(toCodes(text));
          break;
        }
        case 'TJ': {
          const codes: number[] = [];
          let adjust = 0;
          for (const part of array ?? []) {
            if (part.kind === 'str' || part.kind === 'hex') codes.push(...toCodes(part));
            else if (part.kind === 'num') { adjust += Number(part.value); if (Number(part.value) < -200) codes.push(32); }
          }
          emit(codes, adjust); break;
        }
        default: break;
      }
      operands.length = 0;
      array = null;
    }
  });
  return items;
}

/** Groups items into visual lines (top to bottom, left to right) per page. */
export function toLines(items: TextItem[], tolerance = 3) {
  const lines: { page: number; y: number; parts: TextItem[] }[] = [];
  for (const item of [...items].sort((a, b) => a.page - b.page || b.y - a.y || a.x - b.x)) {
    const line = lines.find((candidate) => candidate.page === item.page && Math.abs(candidate.y - item.y) <= tolerance);
    if (line) line.parts.push(item); else lines.push({ page: item.page, y: item.y, parts: [item] });
  }
  return lines.map((line) => ({ page: line.page, y: line.y, parts: line.parts.sort((a, b) => a.x - b.x) }));
}
