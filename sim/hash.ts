/**
 * hashState i serializacja stanu. Oba przechodza strukture generycznie
 * (obiekty w kolejnosci kluczy, tablice, tablice typowane), wiec kazde nowe pole
 * stanu automatycznie trafia do hasha i zapisu. Pola zaczynajace sie od `_`
 * to dane pochodne/pamiec podreczna - pomijane w obu.
 */

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

const TYPED_TAGS: Record<string, new (n: number) => ArrayLike<number> & { [i: number]: number }> = {
  u8: Uint8Array,
  i8: Int8Array,
  u16: Uint16Array,
  i16: Int16Array,
  u32: Uint32Array,
  i32: Int32Array,
};

function typedTag(v: unknown): string | null {
  if (v instanceof Uint8Array) return 'u8';
  if (v instanceof Int8Array) return 'i8';
  if (v instanceof Uint16Array) return 'u16';
  if (v instanceof Int16Array) return 'i16';
  if (v instanceof Uint32Array) return 'u32';
  if (v instanceof Int32Array) return 'i32';
  return null;
}

// ---------- hash ----------

class Hasher {
  h = 0x811c9dc5 | 0;
  int(v: number): void {
    // Liczby w stanie sa calkowite; |0 dla bezpieczenstwa, a starsze bity osobno.
    const lo = v | 0;
    const hi = Math.floor(v / 4294967296) | 0;
    this.h = Math.imul(this.h ^ lo, 0x01000193);
    if (hi !== 0 && hi !== -1) this.h = Math.imul(this.h ^ hi, 0x01000193);
  }
  str(s: string): void {
    this.int(s.length);
    for (let i = 0; i < s.length; i++) this.h = Math.imul(this.h ^ s.charCodeAt(i), 0x01000193);
  }
}

function hashValue(hs: Hasher, v: unknown): void {
  if (v === null || v === undefined) {
    hs.int(-7);
    return;
  }
  switch (typeof v) {
    case 'number':
      if (!Number.isInteger(v)) throw new Error(`Liczba niecalkowita w stanie: ${v}`);
      hs.int(v);
      return;
    case 'boolean':
      hs.int(v ? -3 : -4);
      return;
    case 'string':
      hs.str(v);
      return;
  }
  const tag = typedTag(v);
  if (tag) {
    const a = v as ArrayLike<number>;
    hs.int(a.length);
    // Szybka sciezka: 4 bajty naraz dla tablic bajtowych.
    for (let i = 0; i < a.length; i++) hs.h = Math.imul(hs.h ^ a[i], 0x01000193);
    return;
  }
  if (Array.isArray(v)) {
    hs.int(-5);
    hs.int(v.length);
    for (const e of v) hashValue(hs, e);
    return;
  }
  const o = v as Record<string, unknown>;
  hs.int(-6);
  for (const k in o) {
    if (k.charCodeAt(0) === 95 /* _ */) continue;
    hs.str(k);
    hashValue(hs, o[k]);
  }
}

/** 32-bitowy hash calego stanu (bez pol `_*`). */
export function hashAny(v: unknown): number {
  const hs = new Hasher();
  hashValue(hs, v);
  return hs.h >>> 0;
}

// ---------- serializacja ----------

function toJson(v: unknown): Json {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'object') return v as Json;
  const tag = typedTag(v);
  if (tag) {
    const a = v as ArrayLike<number>;
    // Kodowanie RLE: [wartosc, powtorzenia, ...] - mapy maja dlugie jednolite obszary.
    const rle: number[] = [];
    for (let i = 0; i < a.length; ) {
      const val = a[i];
      let j = i + 1;
      while (j < a.length && a[j] === val) j++;
      rle.push(val, j - i);
      i = j;
    }
    return { $t: tag, n: a.length, d: rle };
  }
  if (Array.isArray(v)) return v.map(toJson);
  const out: Record<string, Json> = {};
  const o = v as Record<string, unknown>;
  for (const k in o) {
    if (k.charCodeAt(0) === 95) continue;
    out[k] = toJson(o[k]);
  }
  return out;
}

function fromJson(v: Json): unknown {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(fromJson);
  const t = v.$t;
  if (typeof t === 'string' && TYPED_TAGS[t]) {
    const arr = new TYPED_TAGS[t](v.n as number);
    const d = v.d as number[];
    let p = 0;
    for (let i = 0; i < d.length; i += 2) {
      const val = d[i];
      const cnt = d[i + 1];
      for (let k = 0; k < cnt; k++) arr[p++] = val;
    }
    return arr;
  }
  const out: Record<string, unknown> = {};
  for (const k in v) out[k] = fromJson(v[k]);
  return out;
}

export function serialize(v: unknown): string {
  return JSON.stringify(toJson(v));
}

export function deserialize<T>(s: string): T {
  return fromJson(JSON.parse(s) as Json) as T;
}
