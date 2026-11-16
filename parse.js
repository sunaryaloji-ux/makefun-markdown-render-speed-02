// parse.js — hand-written Markdown renderer, byte-compatible with marked 18.1.3
// (GFM on, breaks off, pedantic off). Dependency-free ES module.
// Block phase builds a node tree (collecting link reference definitions first,
// exactly like marked lexes before it parses); render phase emits HTML.
// Inline phase is a single left-to-right scan with a CommonMark delimiter
// stack for emphasis / strikethrough and a bracket stack for links/images.
'use strict';

// ---- named entities (HTML5 subset used by the spec examples and docs) ----
const ENT = {
  AElig: 'Æ', AMP: '&', Aacute: 'Á', Acirc: 'Â', Agrave: 'À', Aring: 'Å', Atilde: 'Ã',
  Auml: 'Ä', Ccedil: 'Ç', Dcaron: 'Ď', ETH: 'Ð', Eacute: 'É', Ecirc: 'Ê', Egrave: 'È',
  Euml: 'Ë', Iacute: 'Í', Icirc: 'Î', Igrave: 'Ì', Iuml: 'Ï', Ntilde: 'Ñ', Oacute: 'Ó',
  Ocirc: 'Ô', Ograve: 'Ò', Oslash: 'Ø', Otilde: 'Õ', Ouml: 'Ö', THORN: 'Þ', Uacute: 'Ú',
  Ucirc: 'Û', Ugrave: 'Ù', Uuml: 'Ü', Yacute: 'Ý', aacute: 'á', acirc: 'â', aelig: 'æ',
  agrave: 'à', amp: '&', aring: 'å', atilde: 'ã', auml: 'ä', brvbar: '¦', ccedil: 'ç',
  cedil: '¸', cent: '¢', copy: '©', curren: '¤', deg: '°', divide: '÷', eacute: 'é',
  ecirc: 'ê', egrave: 'è', eth: 'ð', euml: 'ë', frac12: '½', frac14: '¼', frac34: '¾',
  gt: '>', hellip: '…', iacute: 'í', icirc: 'î', iexcl: '¡', igrave: 'ì', iquest: '¿',
  iuml: 'ï', laquo: '«', lt: '<', mdash: '—', micro: 'µ', middot: '·', nbsp: ' ',
  ndash: '–', not: '¬', ntilde: 'ñ', oacute: 'ó', ocirc: 'ô', ograve: 'ò', ordf: 'ª',
  ordm: 'º', oslash: 'ø', otilde: 'õ', ouml: 'ö', para: '¶', plusmn: '±', pound: '£',
  quot: '"', raquo: '»', reg: '®', sect: '§', shy: '­', sup1: '¹', sup2: '²', sup3: '³',
  szlig: 'ß', thorn: 'þ', times: '×', uacute: 'ú', ucirc: 'û', ugrave: 'ù', uml: '¨',
  uuml: 'ü', yacute: 'ý', yen: '¥', yuml: 'ÿ', apos: "'", lsquo: '‘', rsquo: '’',
  sbquo: '‚', ldquo: '“', rdquo: '”', bdquo: '„', dagger: '†', Dagger: '‡', permil: '‰',
  lsaquo: '‹', rsaquo: '›', euro: '€', trade: '™', bull: '•', lowast: '∗', oline: '‾',
  frasl: '⁄', ensp: ' ', emsp: ' ', thinsp: ' ', zwnj: '‌', zwj: '‍', lrm: '‎',
  rlm: '‏', alefsym: 'ℵ', larr: '←', uarr: '↑', rarr: '→', darr: '↓', harr: '↔',
  crarr: '↵', lArr: '⇐', uArr: '⇑', rArr: '⇒', dArr: '⇓', hArr: '⇔', forall: '∀',
  part: '∂', exist: '∃', empty: '∅', nabla: '∇', isin: '∈', notin: '∉', ni: '∋',
  prod: '∏', sum: '∑', infin: '∞', cap: '∩', cup: '∪', int: '∫', there4: '∴',
  sim: '∼', cong: '≅', asymp: '≈', ne: '≠', equiv: '≡', le: '≤', ge: '≥',
  sub: '⊂', sup: '⊃', nsub: '⊄', sube: '⊆', supe: '⊇', oplus: '⊕', otimes: '⊗',
  perp: '⊥', sdot: '⋅', lceil: '⌈', rceil: '⌉', lfloor: '⌊', rfloor: '⌋',
  lang: '⟨', rang: '⟩', loz: '◊', spades: '♠', clubs: '♣', hearts: '♥', diams: '♦',
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', zeta: 'ζ', eta: 'η',
  theta: 'θ', iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ',
  omicron: 'ο', pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ', upsilon: 'υ', phi: 'φ',
  chi: 'χ', psi: 'ψ', omega: 'ω', Alpha: 'Α', Beta: 'Β', Gamma: 'Γ', Delta: 'Δ',
  Epsilon: 'Ε', Zeta: 'Ζ', Eta: 'Η', Theta: 'Θ', Iota: 'Ι', Kappa: 'Κ', Lambda: 'Λ',
  Mu: 'Μ', Nu: 'Ν', Xi: 'Ξ', Omicron: 'Ο', Pi: 'Π', Rho: 'Ρ', Sigma: 'Σ', Tau: 'Τ',
  Upsilon: 'Υ', Phi: 'Φ', Chi: 'Χ', Psi: 'Ψ', Omega: 'Ω', thetasym: 'ϑ', upsih: 'ϒ',
  piv: 'ϖ', acute: '´', ClockwiseContourIntegral: '∲', DifferentialD: 'ⅆ',
  HilbertSpace: 'ℋ', ngE: '≧̸', QUOT: '"', GT: '>', LT: '<'
};

// ---- small helpers ----
const PUNCT = '!\"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~';
function isPunct(c) { return c !== '' && PUNCT.indexOf(c) >= 0; }
function isSpace(c) { return c === ' ' || c === '\t' || c === '\n' || c === '\r'; }
function isDigit(c) { return c >= '0' && c <= '9'; }
function isAlphaNum(c) {
  return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || isDigit(c);
}

// Escape text the way marked does: & < > " ' .
function esc(s) {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 38) out += '&amp;';
    else if (c === 60) out += '&lt;';
    else if (c === 62) out += '&gt;';
    else if (c === 34) out += '&quot;';
    else if (c === 39) out += '&#39;';
    else out += s[i];
  }
  return out;
}

// Try to decode an entity starting at s[i] === '&'. Returns [decoded, endIndex]
// or null when no valid entity starts here.
function decodeEntityAt(s, i) {
  const n = s.length;
  if (i + 1 >= n) return null;
  if (s[i + 1] === '#') {
    let j = i + 2, hex = false, num = 0, digits = 0;
    if (s[j] === 'x' || s[j] === 'X') { hex = true; j++; }
    const start = j;
    while (j < n) {
      const c = s.charCodeAt(j);
      if (hex ? (c >= 48 && c <= 57) || (c >= 97 && c <= 102) || (c >= 65 && c <= 70)
              : (c >= 48 && c <= 57)) {
        num = num * (hex ? 16 : 10) + (c >= 48 && c <= 57 ? c - 48 : (c | 32) - 87);
        j++; digits++;
        if (num > 0x10FFFF) { /* keep scanning to the ';' */ }
      } else break;
    }
    if (digits === 0 || j >= n || s[j] !== ';' || j - start > 8) return null;
    if (num === 0 || num > 0x10FFFF || (num >= 0xD800 && num <= 0xDFFF)) return ['�', j + 1];
    return [String.fromCodePoint(num), j + 1];
  }
  let j = i + 1;
  while (j < n && j < i + 33 && isAlphaNum(s[j])) j++;
  if (j < n && s[j] === ';') {
    const name = s.slice(i + 1, j);
    const v = ENT[name];
    if (v !== undefined) return [v, j + 1];
  }
  return null;
}

// Percent-encode a link destination the way marked does: space and
// " < > [ ] { } | ^ ` \ plus controls become %XX; ' becomes &#39; after
// escaping; & that starts a well-formed entity stays raw, else &amp;.
function encodeHref(u) {
  let out = '';
  for (let i = 0; i < u.length; i++) {
    const c = u.charCodeAt(i);
    if (c === 38) {
      const d = decodeEntityAt(u, i);
      if (d) { out += u.slice(i, d[1]); i = d[1] - 1; }
      else out += '&amp;';
    } else if (c === 39) out += '&#39;';
    else if (c === 32 || c === 34 || c < 32 || c === 60 || c === 62 || c === 91 ||
             c === 92 || c === 93 || c === 94 || c === 96 || c === 123 || c === 124 ||
             c === 125) {
      out += '%' + (c < 16 ? '0' : '') + c.toString(16).toUpperCase();
    } else out += u[i];
  }
  return out;
}

// Normalise a link label: collapse whitespace runs to one space, lowercase,
// trim. (marked lowercases with .toLowerCase() on the collapsed label.)
function normalizeLabel(s) {
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

// Expand tabs in `line` to spaces, tab stops every 4 columns, starting at col.
function expandTabs(line, col) {
  if (line.indexOf('\t') < 0) return line;
  let out = '', c = col;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '\t') {
      const n = 4 - (c % 4);
      out += '    '.slice(0, n); c += n;
    } else { out += ch; c++; }
  }
  return out;
}

// Count leading spaces of a line after tab expansion to columns.
function indentOf(line) {
  let n = 0, c = 0;
  while (n < line.length) {
    const ch = line[n];
    if (ch === ' ') { n++; c++; }
    else if (ch === '\t') { c += 4 - (c % 4); n++; }
    else break;
  }
  return c;
}

// Strip `n` columns from the front of a raw line (a tab is dropped whole when
// it straddles the cut; tabs starting at/after the cut stay raw).
function stripIndent(line, n) {
  let c = 0, i = 0;
  while (i < line.length && c < n) {
    if (line[i] === '\t') { const w = 4 - (c % 4); if (c + w > n) break; c += w; i++; }
    else if (line[i] === ' ') { c++; i++; }
    else break;
  }
  return line.slice(i);
}

// Is the line blank (only spaces/tabs)?
function isBlank(line) {
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch !== ' ' && ch !== '\t') return false;
  }
  return true;
}

export function parse(md) {
  const src = String(md).replace(/\r\n?/g, '\n');
  // ---------- small helpers ----------
  const PUNCT = /[!-/:-@\[-`{-~]/; // ASCII punctuation (backslash escapes, flanking)
  const UNI_PUNCT = /[\p{P}\p{S}]/u;
  const UNI_WS = /\s/;
  const ESC5 = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function decodeNum(m) {
    let cp;
    if (m[2] === 'x' || m[2] === 'X') cp = parseInt(m.slice(3, -1), 16);
    else cp = parseInt(m.slice(2, -1), 10);
    if (!cp || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return '\uFFFD';
    return String.fromCodePoint(cp);
  }
  // text escaping: decode numeric refs, then escape & < > " ' (valid named entities kept verbatim)
  function escT(s) {
    if (s.indexOf('&') !== -1) s = s.replace(/&#[xX][0-9a-fA-F]+;|&#\d+;/g, decodeNum);
    return s.replace(/&(?!(?:#\d+|#[xX][0-9a-fA-F]+|\w+);)|[<>"']/g, (ch) => ESC5[ch]);
  }
  // code escaping: escape all five unconditionally, no entity decoding
  function escC(s) { return s.replace(/[&<>"']/g, (ch) => ESC5[ch]); }
  // attribute value escaping (href/src after cleanUrl, alt text pieces)
  function escA(s) {
    return s.replace(/&(?!(?:#\d+|#[xX][0-9a-fA-F]+|\w+);)|["<>]/g, (ch) => ch === '&' ? '&amp;' : ESC5[ch]);
  }
  function cleanUrl(href) {
    try { return encodeURI(href).replace(/%25/g, '%'); } catch (e) { return null; }
  }
  // column width of leading whitespace (tab advances to next multiple of 4)
  function indentCols(line) {
    let col = 0;
    for (let k = 0; k < line.length; k++) {
      const c = line[k];
      if (c === ' ') col++;
      else if (c === '\t') col += 4 - (col % 4);
      else break;
    }
    return col;
  }
  // remove n columns of leading indent; a tab cut through becomes spaces
  function stripCols(line, n) {
    let col = 0, k = 0;
    while (k < line.length && col < n) {
      const c = line[k];
      if (c === ' ') { col++; k++; }
      else if (c === '\t') {
        const w = 4 - (col % 4);
        if (col + w > n) return ' '.repeat(col + w - n) + line.slice(k + 1);
        col += w; k++;
      } else break;
    }
    return line.slice(k);
  }
  // remove n columns from the start of a line, whatever they are (marker + spaces);
  // a tab cut through becomes spaces
  function dropCols(line, n) {
    let col = 0, k = 0;
    while (k < line.length && col < n) {
      const c = line[k];
      if (c === '\t') {
        const w = 4 - (col % 4);
        if (col + w > n) return ' '.repeat(col + w - n) + line.slice(k + 1);
        col += w; k++;
      } else { col++; k++; }
    }
    return line.slice(k);
  }
  function blankLine(line) { return /^[ \t]*$/.test(line); }
  // ---------- link destination / title / label scanners ----------
  // parseDest(s, i): link destination at i. Returns [dest, next] or null.
  function parseDest(s, i) {
    const n = s.length;
    if (s[i] === '<') {
      let j = i + 1, out = '';
      while (j < n) {
        const c = s[j];
        if (c === '\n') return null;
        if (c === '>') return [out, j + 1];
        if (c === '<') return null;
        if (c === '\\' && j + 1 < n && PUNCT.test(s[j + 1])) { out += s[j + 1]; j += 2; continue; }
        out += c; j++;
      }
      return null;
    }
    let j = i, depth = 0, out = '';
    while (j < n) {
      const c = s[j];
      if (c === ' ' || c === '\t' || c === '\n') break;
      if (c === '(') { depth++; out += c; j++; continue; }
      if (c === ')') { if (depth === 0) break; depth--; out += c; j++; continue; }
      if (c === '\\' && j + 1 < n && PUNCT.test(s[j + 1])) { out += s[j + 1]; j += 2; continue; }
      out += c; j++;
    }
    return [out, j];
  }
  // parseTitle(s, i): link title at i ('"' or "'" or '('). Returns [title, next] or null.
  function parseTitle(s, i) {
    const n = s.length;
    const q = s[i];
    if (q === '"' || q === "'") {
      let j = i + 1, out = '';
      while (j < n) {
        const c = s[j];
        if (c === q) return [out, j + 1];
        if (c === '\\' && j + 1 < n && PUNCT.test(s[j + 1])) { out += s[j + 1]; j += 2; continue; }
        out += c; j++;
      }
      return null;
    }
    let j = i + 1, out = '';
    while (j < n) {
      const c = s[j];
      if (c === ')') return [out, j + 1];
      if (c === '(') return null;
      if (c === '\\' && j + 1 < n && PUNCT.test(s[j + 1])) { out += s[j + 1]; j += 2; continue; }
      out += c; j++;
    }
    return null;
  }
  // parseLabel(s, i): reference label at i ('['). Returns [rawLabel, next] or null.
  function parseLabel(s, i) {
    const n = s.length;
    let j = i + 1, out = '';
    while (j < n) {
      const c = s[j];
      if (c === '\\' && j + 1 < n && PUNCT.test(s[j + 1])) { out += s[j + 1]; j += 2; continue; }
      if (c === '[') return null;
      if (c === ']') return [out, j + 1];
      if (c === '\n' && s[j + 1] === '\n') return null;
      out += c; j++;
      if (out.length > 999) return null;
    }
    return null;
  }
  function normLabel(l) { return l.replace(/\s+/g, ' ').trim().toLowerCase(); }
  // label from the raw link text between brackets (for shortcut / collapsed refs)
  function labelFromRaw(s, brk, closeIdx) {
    const start = brk.img ? brk.pos + 2 : brk.pos + 1;
    let raw = s.slice(start, closeIdx);
    raw = raw.replace(/\\([!-/:-@\[-`{-~])/g, '$1');
    return normLabel(raw);
  }
  // ---------- autolinks and raw HTML tags (inline) ----------
  const RE_SCHEME = /<([a-zA-Z][a-zA-Z0-9+.-]{1,31}:[^<>\s]*)>/y;
  const RE_EMAIL_ANGLE = /<([a-zA-Z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*)>/y;
  function tryAutolink(s, i) {
    RE_SCHEME.lastIndex = i;
    let m = RE_SCHEME.exec(s);
    if (m) return { node: { k: 'auto', href: m[1], text: m[1] }, next: i + m[0].length };
    RE_EMAIL_ANGLE.lastIndex = i;
    m = RE_EMAIL_ANGLE.exec(s);
    if (m) return { node: { k: 'auto', href: 'mailto:' + m[1], text: m[1] }, next: i + m[0].length };
    return null;
  }
  // raw HTML tag / comment / PI / CDATA / declaration starting at i. Returns {text, next} or null.
  function tryHtmlTag(s, i) {
    if (s.startsWith('<!--', i)) {
      const e = s.indexOf('-->', i + 4);
      if (e !== -1) return { text: s.slice(i, e + 3), next: e + 3 };
      return null;
    }
    if (s.startsWith('<?', i)) {
      const e = s.indexOf('?>', i + 2);
      if (e !== -1) return { text: s.slice(i, e + 2), next: e + 2 };
      return null;
    }
    if (s.startsWith('<![CDATA[', i)) {
      const e = s.indexOf(']]>', i + 9);
      if (e !== -1) return { text: s.slice(i, e + 3), next: e + 3 };
      return null;
    }
    if (s.startsWith('<!', i) && /[A-Z]/.test(s[i + 2] || '')) {
      const e = s.indexOf('>', i + 2);
      if (e !== -1) return { text: s.slice(i, e + 1), next: e + 1 };
      return null;
    }
    const n = s.length;
    let j = i + 1;
    if (s[j] === '/') j++;
    if (!/[a-zA-Z]/.test(s[j] || '')) return null;
    while (j < n && /[a-zA-Z0-9-]/.test(s[j])) j++;
    while (j < n) {
      const c = s[j];
      if (c === '>') return { text: s.slice(i, j + 1), next: j + 1 };
      if (c === '/' && s[j + 1] === '>') return { text: s.slice(i, j + 2), next: j + 2 };
      if (c === ' ' || c === '\t' || c === '\n') { j++; continue; }
      if (!/[a-zA-Z_:]/.test(c)) return null;
      let k = j;
      while (k < n && /[a-zA-Z0-9_.:-]/.test(s[k])) k++;
      if (k === j) return null;
      j = k;
      while (j < n && (s[j] === ' ' || s[j] === '\t' || s[j] === '\n')) j++;
      if (s[j] === '=') {
        j++;
        while (j < n && (s[j] === ' ' || s[j] === '\t' || s[j] === '\n')) j++;
        const q = s[j];
        if (q === '"' || q === "'") {
          j++;
          while (j < n && s[j] !== q) j++;
          if (j >= n) return null;
          j++;
        } else {
          const vstart = j;
          while (j < n && !/[ \t\n"'=<>`]/.test(s[j])) j++;
          if (j === vstart) return null;
        }
      }
    }
    return null;
  }
  // GFM autolink: www. / http(s):// URL, or bare email, starting at i.
  // Returns {href, text, next} or null. prevCh is the char before i ('' at start).
  function tryGfmAutolink(s, i, prevCh) {
    const n = s.length;
    // email: scan back is done by the caller; here i is the email start.
    // marked's GFM email: local [A-Za-z0-9._+-]+, domain labels [A-Za-z0-9-_],
    // last label alnum, and no word char / hyphen may follow the match.
    // The match may start after a non-local char inside the scanned word
    // (e.g. a!b@c.d links only b@c.d), so search unanchored.
    if (/[a-zA-Z0-9.!#$%&'*+\/=?^_`{|}~-]/.test(s[i] || '')) {
      let j = i;
      while (j < n && /[a-zA-Z0-9.!#$%&'*+\/=?^_`{|}~@-]/.test(s[j])) j++;
      const word = s.slice(i, j);
      const em = /[A-Za-z0-9._+-]+@[a-zA-Z0-9-_]+(?:\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+(?![\w-])/.exec(word);
      if (em) {
        const abs = i + em.index;
        const pc = abs > 0 ? s[abs - 1] : '';
        if (pc === '' || !/[a-zA-Z0-9]/.test(pc)) {
          let start = abs, text = em[0], href = 'mailto:' + em[0], next = abs + em[0].length;
          let scheme = null;
          if (abs >= 7 && s.slice(abs - 7, abs) === 'mailto:') scheme = 'mailto:';
          else if (abs >= 5 && s.slice(abs - 5, abs) === 'xmpp:') scheme = 'xmpp:';
          if (scheme) {
            const bs = abs - scheme.length - 1;
            if (bs < 0 || !/[a-zA-Z0-9]/.test(s[bs])) {
              start = abs - scheme.length;
              text = scheme + em[0];
              href = scheme + em[0];
              if (scheme === 'xmpp:') {
                const rm = /^\/[A-Za-z0-9@.]+/.exec(s.slice(next));
                if (rm) { text += rm[0]; href += rm[0]; next += rm[0].length; }
              }
            }
          }
          return { href, text, next, start };
        }
      }
    }
    // www. / http(s)://
    let m = /^(?:www\.|https?:\/\/)/.exec(s.slice(i, i + 8));
    if (!m) return null;
    if (prevCh !== '' && /[a-zA-Z0-9]/.test(prevCh)) return null;
    const rest = s.slice(i + m[0].length);
    const dm = /^([a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?)*\.[a-zA-Z]{2,})/.exec(rest);
    if (!dm) return null;
    let url = m[0] + dm[1];
    let k = i + url.length;
    while (k < n && !/[ \t\n<>]/.test(s[k])) { url += s[k]; k++; }
    // trim trailing punctuation, unbalanced ')', entity-like ';' (loop until stable)
    for (;;) {
      let changed = false;
      while (url.length && '?!.,:*_~'.includes(url[url.length - 1])) { url = url.slice(0, -1); changed = true; }
      if (url.endsWith(')')) {
        const open = (url.match(/\(/g) || []).length, close = (url.match(/\)/g) || []).length;
        if (close > open) { url = url.slice(0, -1); changed = true; }
      }
      if (url.endsWith(';')) {
        const amp = url.lastIndexOf('&');
        if (amp !== -1 && /^[\w]+$/.test(url.slice(amp + 1, -1))) { url = url.slice(0, amp); changed = true; }
      }
      if (!changed) break;
    }
    if (!url) return null;
    const href = m[0].startsWith('www.') ? 'http://' + url : url;
    return { href, text: url, next: i + url.length, start: i };
  }
  // tryLink(s, j, brk, refs): attempt a link whose ']' ends at j-1. j = index after ']'.
  // Returns {href, title, next} or null.
  function tryLink(s, j, brk, refs) {
    const n = s.length;
    let i = j;
    if (s[i] === '(') {
      i++;
      while (i < n && (s[i] === ' ' || s[i] === '\t' || s[i] === '\n')) i++;
      let dest = '';
      if (i < n && s[i] !== ')') {
        const d = parseDest(s, i);
        if (!d) return null;
        dest = d[0]; i = d[1];
      }
      let m = i;
      while (m < n && (s[m] === ' ' || s[m] === '\t' || s[m] === '\n')) m++;
      let title = null;
      if (m < n && (s[m] === '"' || s[m] === "'" || s[m] === '(')) {
        const t = parseTitle(s, m);
        if (!t) return null;
        title = t[0]; m = t[1];
        let q = m;
        q = skipDefWS(s, q);
        m = q;
      }
      if (m < n && s[m] === ')') {
        const href = cleanUrl(dest);
        if (href === null) return null;
        return { href, title, next: m + 1 };
      }
      return null;
    }
    if (s[i] === '[') {
      const lab = parseLabel(s, i);
      if (!lab) return null;
      const key = lab[0] === '' ? labelFromRaw(s, brk, j - 1) : normLabel(lab[0]);
      const ref = refs.get(key);
      if (!ref) return null;
      const href = cleanUrl(ref.dest);
      if (href === null) return null;
      return { href, title: ref.title, next: lab[1] };
    }
    const key = labelFromRaw(s, brk, j - 1);
    const ref = refs.get(key);
    if (!ref) return null;
    const href = cleanUrl(ref.dest);
    if (href === null) return null;
    return { href, title: ref.title, next: j };
  }
  // ---------- inline parsing ----------
  // Node kinds: t=text, code, br, html, link, img, auto, em, strong, del,
  //   d=emphasis delimiter, b=bracket opener (renders '[' / '![' when unused)
  function inline(s, refs) {
    const nodes = [];
    const delims = []; // live delimiter stack (d and b nodes)
    const allDelims = []; // all emphasis delimiters in creation order
    let i = 0;
    const n = s.length;
    let buf = '';
    const flush = () => {
      if (buf) {
        const last = nodes[nodes.length - 1];
        if (last && last.k === 't') last.s += buf; else nodes.push({ k: 't', s: buf });
        buf = '';
      }
    };
    const flank = (i, j) => {
      const prev = i > 0 ? s[i - 1] : '';
      const next = j < n ? s[j] : '';
      const prevWS = prev === '' || UNI_WS.test(prev);
      const nextWS = next === '' || UNI_WS.test(next);
      const prevP = prev !== '' && UNI_PUNCT.test(prev);
      const nextP = next !== '' && UNI_PUNCT.test(next);
      return {
        left: !nextWS && (!nextP || prevWS || prevP),
        right: !prevWS && (!prevP || nextWS || nextP)
      };
    };
    while (i < n) {
      const c = s[i];
      if (c === '\n') {
        if (buf.length >= 2 && / +$/.test(buf) && i + 1 < n) {
          buf = buf.replace(/ +$/, '');
          flush(); nodes.push({ k: 'br' });
        } else buf += '\n';
        i++;
        continue;
      }
      if (c === '\\') {
        const d = s[i + 1];
        if (d === '\n') { flush(); nodes.push({ k: 'br' }); i += 2; continue; }
        if (d !== undefined && PUNCT.test(d)) { buf += d; i += 2; continue; }
        buf += '\\'; i++; continue;
      }
      if (c === '`') {
        let j = i; while (j < n && s[j] === '`') j++;
        const run = j - i;
        let k = j, close = -1;
        while (k < n) {
          if (s[k] === '`') {
            let m = k; while (m < n && s[m] === '`') m++;
            if (m - k === run) { close = k; break; }
            k = m;
          } else k++;
        }
        if (close === -1) { buf += '`'.repeat(run); i = j; continue; }
        let content = s.slice(j, close);
        content = content.replace(/\n/g, ' ');
        if (content.length >= 2 && content[0] === ' ' && content[content.length - 1] === ' ' && /[^ ]/.test(content)) content = content.slice(1, -1);
        flush(); nodes.push({ k: 'code', s: content });
        i = close + run;
        continue;
      }
      if (c === '*' || c === '_') {
        let j = i; while (j < n && s[j] === c) j++;
        const run = j - i;
        const f = flank(i, j);
        let open = false, close = false;
        if (c === '*') { open = f.left; close = f.right; }
        else { open = f.left && (!f.right || UNI_PUNCT.test(s[i - 1] || '')); close = f.right && (!f.left || UNI_PUNCT.test(s[j] || '')); }
        flush();
        const nd = { k: 'd', ch: c, len: run, open, close, li: nodes };
        nodes.push(nd); delims.push(nd); allDelims.push(nd);
        i = j; continue;
      }
      if (c === '~') {
        let j = i; while (j < n && s[j] === '~') j++;
        const run = j - i;
        if (run >= 2) {
          const f = flank(i, j);
          flush();
          const nd = { k: 'd', ch: '~', len: run, open: f.left, close: f.right, li: nodes };
          nodes.push(nd); delims.push(nd); allDelims.push(nd);
          i = j; continue;
        }
        buf += '~'; i++; continue;
      }
      if (c === '[') {
        flush();
        const nd = { k: 'b', img: false, active: true, pos: i, li: nodes };
        nodes.push(nd); delims.push(nd);
        i++; continue;
      }
      if (c === '!' && s[i + 1] === '[') {
        flush();
        const nd = { k: 'b', img: true, active: true, pos: i, li: nodes };
        nodes.push(nd); delims.push(nd);
        i += 2; continue;
      }
      if (c === ']') {
        flush();
        let bi = -1;
        for (let d = delims.length - 1; d >= 0; d--) {
          if (delims[d].k === 'b' && delims[d].active) { bi = d; break; }
        }
        if (bi === -1) { buf += ']'; i++; continue; }
        const brk = delims[bi];
        const link = tryLink(s, i + 1, brk, refs);
        if (!link) {
          brk.active = false;
          delims.splice(bi, 1);
          buf += ']'; i++; continue;
        }
        const ni = nodes.indexOf(brk);
        const kids = nodes.slice(ni + 1);
        if (!brk.img && kids.some((kd) => kd.k === 'link')) {
          // A link cannot contain a link: the closer is literal, opener dead.
          // (An image may contain links: they flatten to text in its alt.)
          brk.active = false;
          delims.splice(bi, 1);
          buf += ']'; i++; continue;
        }
        nodes.splice(ni + 1);
        for (const kd of kids) if (kd.k === 'd' || kd.k === 'b') kd.li = kids;
        delims.splice(bi, 1);
        nodes[ni] = brk.img
          ? { k: 'img', src: link.href, title: link.title, kids }
          : { k: 'link', href: link.href, title: link.title, kids };
        i = link.next;
        continue;
      }
      if (c === '<') {
        const al = tryAutolink(s, i);
        if (al) { flush(); nodes.push(al.node); i = al.next; continue; }
        const ht = tryHtmlTag(s, i);
        if (ht) { flush(); nodes.push({ k: 'html', s: ht.text }); i = ht.next; continue; }
        buf += '<'; i++; continue;
      }
      if (c === '&') {
        const em = /^&(?:#\d+|#[xX][0-9a-fA-F]+|\w+);/.exec(s.slice(i, i + 40));
        if (em) { buf += em[0]; i += em[0].length; continue; }
        buf += '&'; i++; continue;
      }
      // plain text run, with GFM autolink detection inside it
      let j = i;
      while (j < n) {
        const ch = s[j];
        if (ch === '_') {
          // An inert '_' run (can neither open nor close emphasis) is plain
          // text: keep it in the run so emails/URLs spanning it still link.
          let k = j; while (k < n && s[k] === '_') k++;
          const f = flank(j, k);
          const canOpen = f.left && (!f.right || UNI_PUNCT.test(s[j - 1] || ''));
          const canClose = f.right && (!f.left || UNI_PUNCT.test(s[k] || ''));
          if (canOpen || canClose) break;
          j = k; continue;
        }
        if (ch === '\\' || ch === '`' || ch === '*' || ch === '[' || ch === ']' || ch === '<' || ch === '&' || ch === '~' || ch === '\n') break;
        if (ch === '!' && s[j + 1] === '[') break;
        j++;
      }
      let p = i, done = false;
      while (p < j && !done) {
        let cp = -1, ck = 0;
        const iw = s.indexOf('www.', p);
        if (iw !== -1 && iw < j && (cp === -1 || iw < cp)) { cp = iw; ck = 0; }
        const ih = s.indexOf('http', p);
        if (ih !== -1 && ih < j && (cp === -1 || ih < cp)) { cp = ih; ck = 1; }
        const ia = s.indexOf('@', p);
        if (ia !== -1 && ia < j && (cp === -1 || ia < cp)) { cp = ia; ck = 2; }
        if (cp === -1) { buf += s.slice(p, j); p = j; break; }
        if (ck === 2) {
          let st = cp;
          while (st > i && /[a-zA-Z0-9.!#$%&'*+\/=?^_`{|}~-]/.test(s[st - 1])) st--;
          if (st < p) { buf += s.slice(p, cp + 1); p = cp + 1; continue; }
          const g = tryGfmAutolink(s, st, st > 0 ? s[st - 1] : '');
          if (g) {
            buf += s.slice(p, g.start); flush();
            nodes.push({ k: 'auto', href: g.href, text: g.text });
            i = g.next; done = true;
          } else { buf += s.slice(p, cp + 1); p = cp + 1; }
        } else {
          const g = tryGfmAutolink(s, cp, cp > 0 ? s[cp - 1] : '');
          if (g) {
            buf += s.slice(p, cp); flush();
            nodes.push({ k: 'auto', href: g.href, text: g.text });
            i = g.next; done = true;
          } else { buf += s.slice(p, cp + 1); p = cp + 1; }
        }
      }
      if (!done) i = j;
    }
    flush();
    processEmphasis(allDelims);
    return renderInline(nodes);
  }
  // CommonMark delimiter-stack emphasis processing (phase 2)
  function processEmphasis(allDelims) {
    for (let di = 0; di < allDelims.length; di++) {
      const D = allDelims[di];
      if (D.len === 0 || !D.close) continue;
      while (D.len > 0 && D.close) {
        if (D.ch === '~' && D.len < 2) break;
        let O = null;
        for (let oj = di - 1; oj >= 0; oj--) {
          const cand = allDelims[oj];
          if (cand.len === 0 || cand.ch !== D.ch || !cand.open || cand.li !== D.li) continue;
          if (D.ch === '~' && cand.len < 2) continue;
          if (cand.open && cand.close && D.open && D.close && (cand.len + D.len) % 3 === 0) continue;
          O = cand; break;
        }
        if (!O) break;
        const use = D.ch === '~' ? 2 : ((O.len >= 2 && D.len >= 2) ? 2 : 1);
        const L = D.li;
        const oi = L.indexOf(O), ci = L.indexOf(D);
        if (oi === -1 || ci === -1 || oi >= ci) break;
        const kids = L.splice(oi + 1, ci - oi - 1);
        for (const kd of kids) if (kd.k === 'd' || kd.k === 'b') kd.li = kids;
        const kind = D.ch === '~' ? 'del' : (use === 2 ? 'strong' : 'em');
        const emNode = { k: kind, kids };
        O.len -= use; D.len -= use;
        if (O.len === 0) L.splice(oi, 1, emNode); else L.splice(oi + 1, 0, emNode);
        if (D.len === 0) { const di2 = L.indexOf(D); if (di2 !== -1) L.splice(di2, 1); }
      }
    }
  }
  // plain-text rendering of link/image children (for alt attributes): markers dropped
  function altText(kids) {
    let out = '';
    for (const nd of kids) {
      switch (nd.k) {
        case 't': out += escT(nd.s); break;
        case 'code': out += escC(nd.s); break;
        case 'link': case 'em': case 'strong': case 'del': case 'img': out += altText(nd.kids); break;
        case 'b': out += nd.img ? '![' : '['; break;
        case 'auto': out += escT(nd.text); break;
        default: break;
      }
    }
    return out;
  }
  function renderInline(nodes) {
    let out = '';
    for (const nd of nodes) {
      switch (nd.k) {
        case 't': out += escT(nd.s); break;
        case 'code': out += '<code>' + escC(nd.s) + '</code>'; break;
        case 'br': out += '<br>'; break;
        case 'html': out += nd.s; break;
        case 'link':
          out += '<a href="' + escA(nd.href) + '"';
          if (nd.title != null) out += ' title="' + escT(nd.title) + '"';
          out += '>' + renderInline(nd.kids) + '</a>';
          break;
        case 'img':
          out += '<img src="' + escA(nd.src) + '" alt="' + altText(nd.kids) + '"';
          if (nd.title != null) out += ' title="' + escT(nd.title) + '"';
          out += '>';
          break;
        case 'auto':
          out += '<a href="' + escA(nd.href) + '">' + escT(nd.text) + '</a>';
          break;
        case 'em': out += '<em>' + renderInline(nd.kids) + '</em>'; break;
        case 'strong': out += '<strong>' + renderInline(nd.kids) + '</strong>'; break;
        case 'del': out += '<del>' + renderInline(nd.kids) + '</del>'; break;
        case 'd': out += nd.ch.repeat(nd.len); break;
        case 'b': out += nd.img ? '![' : '['; break;
        default: break;
      }
    }
    return out;
  }
  // ---------- block parsing ----------
  const BLOCK_TAGS = new Set('address article aside base basefont blockquote body caption center col colgroup dd details dialog dir div dl dt fieldset figcaption figure footer form frame frameset h1 h2 h3 h4 h5 h6 head header hr html iframe legend li link main menu menuitem nav noframes ol optgroup option p param search section summary table tbody td tfoot th thead title tr track ul'.split(' '));
  // isSetextLine: 0 = no, 1 = '=' underline, 2 = '-' underline
  function isSetextLine(line) {
    const ind = indentCols(line);
    if (ind > 3) return 0;
    const c = stripCols(line, ind);
    if (/^=+[ \t]*$/.test(c)) return 1;
    if (/^-+[ \t]*$/.test(c)) return 2;
    return 0;
  }
  function isHRLine(c) {
    return /^((?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})[ \t]*$/.test(c);
  }
  // htmlBlockType(content): 0 = not a start, 1..7 = CommonMark html block type
  function htmlBlockType(c) {
    if (/^<(script|pre|style|textarea)([ \t>]|\/>|$)/i.test(c)) return 1;
    if (c.startsWith('<!--')) return 2;
    if (c.startsWith('<?')) return 3;
    if (/^<![A-Z]/.test(c)) return 4;
    if (c.startsWith('<![CDATA[')) return 5;
    const bm = /^<\/?([a-zA-Z][a-zA-Z0-9-]*)/.exec(c);
    if (bm && BLOCK_TAGS.has(bm[1].toLowerCase())) {
      const after = c[bm[0].length];
      if (after === undefined || after === ' ' || after === '\t' || after === '>' || (after === '/' && c[bm[0].length + 1] === '>')) return 6;
    }
    const ht = tryHtmlTag(c, 0);
    if (ht && ht.next === c.length) return 7;
    return 0;
  }
  function htmlEndFor(type) {
    if (type === 1) return 'tag';
    if (type === 2) return '-->';
    if (type === 3) return '?>';
    if (type === 4) return '>';
    if (type === 5) return ']]>';
    return 'blank';
  }
  // matchListMarker(line, ind): null or {ordered, start, bullet, contentIndent, markerCol, rest}
  function matchListMarker(line, ind) {
    const c = stripCols(line, ind);
    let m = /^([-*+])[ \t]/.exec(c) || /^([-*+])$/.exec(c);
    let ordered = false, start = 0, bullet = '', markerLen = 0;
    if (m) { bullet = m[1]; markerLen = 1; }
    else {
      m = /^(\d{1,9})([.)])[ \t]/.exec(c) || /^(\d{1,9})([.)])$/.exec(c);
      if (!m) return null;
      ordered = true; start = parseInt(m[1], 10); bullet = m[2]; markerLen = m[1].length + 1;
    }
    let p = markerLen, col = ind + markerLen, spaces = 0;
    while (p < c.length && (c[p] === ' ' || c[p] === '\t')) {
      if (c[p] === ' ') { spaces++; col++; p++; }
      else { const w = 4 - (col % 4); spaces += w; col += w; p++; }
    }
    const rest = c.slice(p);
    let contentIndent;
    if (rest === '') contentIndent = ind + markerLen + 1;
    else if (spaces >= 5) contentIndent = ind + markerLen + 1;
    else contentIndent = col;
    return { ordered, start, bullet, markerLen, rest, contentIndent, markerCol: ind };
  }
  // can a list marker interrupt a paragraph? (bullet, or ordered starting at 1, and non-empty item)
  function listCanInterrupt(m) {
    return (!m.ordered || m.start === 1) && m.rest !== '';
  }
  // isInterrupt(content, ind): can this line start a block that interrupts a paragraph?
  // (a backtick fence whose info string contains a backtick is not a fence at all)
  function isInterrupt(c, ind) {
    const fm0 = /^(`{3,}|~{3,})/.exec(c);
    if (fm0) {
      const info0 = c.slice(fm0[1].length).trim();
      if (!(fm0[1][0] === '`' && info0.includes('`'))) return true;
    }
    if (/^(#{1,6})(?:[ \t]+|[ \t]*$)/.test(c)) return true;
    if (isHRLine(c)) return true;
    const ht = htmlBlockType(c);
    if (ht >= 1 && ht <= 6) return true;
    if (/^>/.test(c)) return true;
    const m = matchListMarker(c, 0);
    if (m && listCanInterrupt(m)) return true;
    return false;
  }
  // isBlockStart(content, ind): can this line start any block at block level?
  function isBlockStart(c, ind) {
    if (ind >= 4) return true;
    const fm0 = /^(`{3,}|~{3,})/.exec(c);
    if (fm0) {
      const info0 = c.slice(fm0[1].length).trim();
      if (!(fm0[1][0] === '`' && info0.includes('`'))) return true;
    }
    if (/^(#{1,6})(?:[ \t]+|[ \t]*$)/.test(c)) return true;
    if (isHRLine(c)) return true;
    if (htmlBlockType(c)) return true;
    if (/^>/.test(c)) return true;
    if (matchListMarker(c, 0)) return true;
    return false;
  }
  // parseTableDelim(line): null or array of alignments ('l'|'c'|'r'|null)
  function parseTableDelim(line) {
    const ind = indentCols(line);
    if (ind > 3) return null;
    let s = stripCols(line, ind).trim();
    if (s.startsWith('|')) s = s.slice(1);
    if (s.endsWith('|')) s = s.slice(0, -1);
    const cells = s.split('|');
    const aligns = [];
    for (const cell of cells) {
      const t = cell.trim();
      const m = /^(:?)-+(:?)$/.exec(t);
      if (!m) return null;
      aligns.push(m[1] && m[2] ? 'c' : m[1] ? 'l' : m[2] ? 'r' : null);
    }
    return aligns;
  }
  function splitTableRow(line) {
    const ind = indentCols(line);
    const c = stripCols(line, ind);
    const cells = [];
    let cur = '', k = 0;
    if (c[0] === '|') k = 1;
    while (k < c.length) {
      const ch = c[k];
      if (ch === '\\' && k + 1 < c.length && PUNCT.test(c[k + 1])) { cur += c[k + 1]; k += 2; continue; }
      if (ch === '|') { cells.push(cur.trim()); cur = ''; k++; continue; }
      cur += ch; k++;
    }
    cells.push(cur.trim());
    const trimmed = c.replace(/[ \t]+$/, '');
    if (trimmed.endsWith('|') && !trimmed.endsWith('\\|')) cells.pop();
    return cells;
  }
  // tryParseDef(lines, i, i1, refs): parse a link reference definition at lines[i].
  // Returns lines consumed (0 if not a def). Registers into refs (first definition wins).
  function tryParseDef(lines, i, i1, refs) {
    const line = lines[i];
    const ind = indentCols(line);
    if (ind > 3) return 0;
    const c = stripCols(line, ind);
    if (c[0] !== '[') return 0;
    let s = c, avail = 1;
    for (let a = 1; a < 8 && i + a < i1; a++) { s += '\n' + lines[i + a]; avail = a + 1; }
    const lab = parseLabel(s, 0);
    if (!lab || lab[0] === '') return 0;
    const key = normLabel(lab[0]);
    let p = lab[1];
    if (s[p] !== ':') return 0;
    p++;
    while (p < s.length && (s[p] === ' ' || s[p] === '\t' || s[p] === '\n')) p++;
    if (p >= s.length) return 0;
    const d = parseDest(s, p);
    if (!d) return 0;
    if (d[0] === '' && s[p] !== '<') return 0;
    const dest = d[0];
    p = d[1];
    let q = p;
    // spaces/tabs after the destination on its own line
    while (q < s.length && (s[q] === ' ' || s[q] === '\t')) q++;
    let title = null;
    if (q < s.length && s[q] === '\n') {
      // Title may sit on the next line; if it is malformed or followed by
      // junk, the def still stands without a title (spec ex. 210) and the
      // title line is left as content.
      const destLineEnd = q;
      let r = q + 1;
      while (r < s.length && (s[r] === ' ' || s[r] === '\t')) r++;
      if (r < s.length && (s[r] === '"' || s[r] === "'" || s[r] === '(')) {
        const t = parseTitle(s, r);
        if (t) {
          let e = t[1];
          while (e < s.length && (s[e] === ' ' || s[e] === '\t')) e++;
          if (e >= s.length || s[e] === '\n') { title = t[0]; q = e; }
        }
      }
      if (title === null) q = destLineEnd;
    } else if (q < s.length && (s[q] === '"' || s[q] === "'" || s[q] === '(')) {
      // Same-line title: a failed parse or trailing junk voids the whole def.
      const t = parseTitle(s, q);
      if (!t) return 0;
      title = t[0];
      q = t[1];
      while (q < s.length && (s[q] === ' ' || s[q] === '\t')) q++;
      if (q < s.length && s[q] !== '\n') return 0;
    } else if (q < s.length && s[q] !== '\n') {
      return 0; // junk on the destination's line (spec ex. 201)
    }
    if (q < s.length && s[q] !== '\n') return 0;
    const consumed = s.slice(0, q).split('\n').length;
    if (consumed > avail) return 0;
    for (let k = 0; k < consumed; k++) if (blankLine(lines[i + k])) return 0;
    if (!refs.has(key)) refs.set(key, { dest, title });
    return consumed;
  }
  // lexLines(lines, i0, i1, refs, lazySet, nextLine): block-lex a line range.
  // lazySet: indices (into lines) of lazy continuation lines (setext does not apply to them).
  // nextLine: the line following this range in the outer context (null at EOF).
  function lexLines(lines, i0, i1, refs, lazySet, nextLine) {
    const nodes = [];
    const lazy = lazySet || new Set();
    let i = i0;
    while (i < i1) {
      const line = lines[i];
      if (blankLine(line)) { i++; continue; }
      const ind = indentCols(line);
      if (ind >= 4) {
        const cl = [];
        let j = i;
        while (j < i1) {
          const l2 = lines[j];
          if (blankLine(l2)) {
            let k = j + 1;
            while (k < i1 && blankLine(lines[k])) k++;
            if (k < i1 && indentCols(lines[k]) >= 4) { cl.push(''); j++; continue; }
            break;
          }
          if (indentCols(l2) >= 4) { cl.push(stripCols(l2, 4)); j++; continue; }
          break;
        }
        nodes.push({ t: 'code', lang: null, c: cl.join('\n') + '\n' });
        i = j;
        continue;
      }
      const content = stripCols(line, ind);
      const fm = /^(`{3,}|~{3,})/.exec(content);
      if (fm) {
        const fence = fm[1], fch = fence[0], flen = fence.length;
        const info = content.slice(flen).trim();
        if (!(fch === '`' && info.includes('`'))) {
          const cl = [];
          let j = i + 1;
          while (j < i1) {
            const l2 = lines[j];
            const ind2 = indentCols(l2);
            const c2 = stripCols(l2, Math.min(ind2, 3));
            const cm = /^(`{3,}|~{3,})[ \t]*$/.exec(c2);
            if (cm && cm[1][0] === fch && cm[1].length >= flen) { j++; break; }
            cl.push(stripCols(l2, ind));
            j++;
          }
          let c = cl.join('\n');
          if (cl.length && cl[cl.length - 1] !== '') c += '\n';
          const lang = info.split(/[ \t]+/)[0] || null;
          nodes.push({ t: 'code', lang, c });
          i = j;
          continue;
        }
      }
      const hm = /^(#{1,6})(?:[ \t]+|[ \t]*$)/.exec(content);
      if (hm) {
        let text = content.slice(hm[0].length);
        text = text.replace(/[ \t]+#+[ \t]*$/, '').replace(/[ \t]+$/, '');
        nodes.push({ t: 'h', l: hm[1].length, c: text });
        i++;
        continue;
      }
      if (isHRLine(content)) {
        nodes.push({ t: 'hr' });
        i++;
        continue;
      }
      const ht = htmlBlockType(content);
      if (ht) {
        const hl = [];
        let j = i;
        if (ht === 1) {
          const tag = /^<([a-zA-Z][a-zA-Z0-9-]*)/.exec(content)[1].toLowerCase();
          const closeRe = new RegExp('</' + tag + '\\s*>', 'i');
          while (j < i1) { hl.push(lines[j]); if (closeRe.test(lines[j])) { j++; break; } j++; }
        } else if (ht === 2) {
          while (j < i1) { hl.push(lines[j]); if (lines[j].includes('-->')) { j++; break; } j++; }
        } else if (ht === 3) {
          while (j < i1) { hl.push(lines[j]); if (lines[j].includes('?>')) { j++; break; } j++; }
        } else if (ht === 4) {
          while (j < i1) { hl.push(lines[j]); if (lines[j].includes('>')) { j++; break; } j++; }
        } else if (ht === 5) {
          while (j < i1) { hl.push(lines[j]); if (lines[j].includes(']]>')) { j++; break; } j++; }
        } else {
          while (j < i1 && !blankLine(lines[j])) { hl.push(lines[j]); j++; }
        }
        let c = hl.join('\n');
        if (j >= i1 ? srcEndsNL : !blankLine(lines[j])) c += '\n';
        nodes.push({ t: 'html', c });
        i = j;
        continue;
      }
      if (ind <= 3 && line[ind] === '>') {
        const res = parseQuote(lines, i, i1, refs);
        nodes.push(res.node);
        i = res.next;
        continue;
      }
      const lm = matchListMarker(line, ind);
      if (lm) {
        const res = parseList(lines, i, i1, refs);
        nodes.push(res.node);
        i = res.next;
        continue;
      }
      // paragraph (with leading link reference definitions)
      i = parseParagraph(lines, i, i1, refs, lazy, nodes);
    }
    return nodes;
  }
  // parseQuote: collect a blockquote starting at lines[i]. Returns {node, next}.
  function parseQuote(lines, i, i1, refs) {
    const inner = [];
    const innerLazy = new Set();
    let j = i;
    let inPara = false;
    let fence = null; // {ch, len}
    let html = null; // {end} end: 'blank' | marker string | 'tag'
    const noteLine = (l) => {
      if (fence) {
        const ind = indentCols(l);
        const c = stripCols(l, Math.min(ind, 3));
        const cm = /^(`{3,}|~{3,})[ \t]*$/.exec(c);
        if (cm && cm[1][0] === fence.ch && cm[1].length >= fence.len) fence = null;
        inPara = false;
        return;
      }
      if (html) {
        if (html.end === 'blank') { if (blankLine(l)) html = null; }
        else if (html.end === 'tag') {
          const m = /^<([a-zA-Z][a-zA-Z0-9-]*)/.exec(stripCols(l, Math.min(indentCols(l), 3)));
          if (m && new RegExp('</' + m[1].toLowerCase() + '\\s*>', 'i').test(l)) html = null;
        } else if (l.includes(html.end)) html = null;
        inPara = false;
        return;
      }
      if (blankLine(l)) { inPara = false; return; }
      const ind = indentCols(l);
      if (ind >= 4) { inPara = false; return; }
      const c = stripCols(l, ind);
      const fm = /^(`{3,}|~{3,})/.exec(c);
      if (fm && !(fm[1][0] === '`' && c.slice(fm[1].length).trim().includes('`'))) {
        fence = { ch: fm[1][0], len: fm[1].length };
        inPara = false; return;
      }
      if (/^(#{1,6})(?:[ \t]+|[ \t]*$)/.test(c)) { inPara = false; return; }
      if (isHRLine(c)) { inPara = false; return; }
      const ht = htmlBlockType(c);
      if (ht) {
        if (ht === 1) {
          const tag = /^<([a-zA-Z][a-zA-Z0-9-]*)/.exec(c)[1].toLowerCase();
          if (!new RegExp('</' + tag + '\\s*>', 'i').test(l)) html = { end: 'tag' };
        } else html = { end: htmlEndFor(ht) };
        inPara = false; return;
      }
      if (isSetextLine(l)) { inPara = false; return; }
      const m = matchListMarker(l, ind);
      if (m && listCanInterrupt(m)) { inPara = false; return; }
      inPara = true;
    };
    while (j < i1) {
      const lq = lines[j];
      const indq = indentCols(lq);
      if (indq <= 3 && lq[indq] === '>') {
        let k = indq + 1;
        if (lq[k] === ' ' || lq[k] === '\t') k++;
        const innerLine = lq.slice(k);
        inner.push(innerLine);
        noteLine(innerLine);
        j++;
        continue;
      }
      if (blankLine(lq)) { inner.push(''); noteLine(''); j++; continue; }
      if (inPara && !isInterrupt(stripCols(lq, Math.min(indq, 3)), indq) && !isHRLine(stripCols(lq, Math.min(indq, 3))) && !isSetextLine(lq)) {
        inner.push(lq);
        innerLazy.add(inner.length - 1);
        noteLine(lq);
        j++;
        continue;
      }
      break;
    }
    while (inner.length && blankLine(inner[inner.length - 1])) inner.pop();
    const nextLine = j < i1 ? lines[j] : null;
    const kids = lexLines(inner, 0, inner.length, refs, innerLazy, nextLine);
    return { node: { t: 'bq', kids }, next: j };
  }
  // parseList: collect a list starting at lines[i]. Returns {node, next}.
  function parseList(lines, i, i1, refs) {
    const first = matchListMarker(lines[i], indentCols(lines[i]));
    const ordered = first.ordered, bullet = first.bullet, markerCol = first.markerCol;
    const items = [];
    let loose = false;
    let j = i;
    while (j < i1) {
      let k = j, blanks = 0;
      while (k < i1 && blankLine(lines[k])) { blanks++; k++; }
      if (k >= i1) break;
      const m = matchListMarker(lines[k], indentCols(lines[k]));
      if (!m || m.ordered !== ordered || m.bullet !== bullet || indentCols(lines[k]) !== markerCol) break;
      if (blanks > 0 && items.length > 0) loose = true;
      const ci = m.contentIndent;
      const itemLines = [dropCols(lines[k], ci)];
      let q = k + 1;
      while (q < i1) {
        const lq = lines[q];
        if (blankLine(lq)) {
          let r = q + 1;
          while (r < i1 && blankLine(lines[r])) r++;
          if (r >= i1) break;
          const mr = matchListMarker(lines[r], indentCols(lines[r]));
          if (mr && mr.ordered === ordered && mr.bullet === bullet && indentCols(lines[r]) === markerCol) break;
          if (indentCols(lines[r]) >= ci) {
            for (let b = q; b < r; b++) itemLines.push('');
            q = r;
            continue;
          }
          break;
        }
        if (indentCols(lq) >= ci) { itemLines.push(stripCols(lq, ci)); q++; continue; }
        const mq = matchListMarker(lq, indentCols(lq));
        if (mq && mq.ordered === ordered && mq.bullet === bullet && indentCols(lq) === markerCol) break;
        break;
      }
      while (itemLines.length && blankLine(itemLines[itemLines.length - 1])) itemLines.pop();
      // blank line between two blocks inside this item -> loose
      for (let b = 1; b < itemLines.length - 1; b++) {
        if (blankLine(itemLines[b]) && !blankLine(itemLines[b - 1]) && !blankLine(itemLines[b + 1])) { loose = true; break; }
      }
      let task = false, checked = false, cb = null;
      const tlines = itemLines.slice();
      if (tlines.length) {
        const tm = /^\[([ xX])\] /.exec(tlines[0]);
        if (tm) {
          task = true; checked = tm[1] !== ' ';
          cb = checked ? '<input checked="" disabled="" type="checkbox">' : '<input disabled="" type="checkbox">';
          tlines[0] = tlines[0].slice(4);
        }
      }
      const nextLine = q < i1 ? lines[q] : null;
      const kids = lexLines(tlines, 0, tlines.length, refs, null, nextLine);
      items.push({ task, checked, cb, kids });
      j = q;
    }
    return {
      node: { t: 'list', ordered, start: first.start, loose, items },
      next: j
    };
  }
  // parseParagraph: link-ref defs + paragraph / setext heading / table starting at lines[i].
  // Pushes nodes into `nodes`, returns the next line index.
  function parseParagraph(lines, i, i1, refs, lazy, nodes) {
    let j = i;
    while (j < i1) {
      const consumed = tryParseDef(lines, j, i1, refs);
      if (consumed === 0) break;
      j += consumed;
    }
    const para = [];
    let k = j;
    while (k < i1) {
      const l = lines[k];
      if (blankLine(l)) break;
      const indk = indentCols(l);
      const ck = stripCols(l, Math.min(indk, 3));
      if (para.length === 0 && isBlockStart(ck, indk)) break;
      if (para.length > 0) {
        const sl = isSetextLine(l);
        if (sl && !lazy.has(k)) {
          nodes.push({ t: 'h', l: sl, c: para.join('\n').replace(/[ \t]+$/, '') });
          return k + 1;
        }
        if (para.length === 1) {
          const td = parseTableDelim(l);
          if (td) {
            const headCells = splitTableRow(para[0]);
            if (headCells.length === td.length) {
              const rows = [];
              let r = k + 1;
              while (r < i1) {
                const lr = lines[r];
                if (blankLine(lr)) break;
                const indr = indentCols(lr);
                if (isInterrupt(stripCols(lr, Math.min(indr, 3)), indr)) break;
                const cells = splitTableRow(lr);
                while (cells.length < headCells.length) cells.push('');
                rows.push(cells.slice(0, headCells.length));
                r++;
              }
              nodes.push({ t: 'table', align: td, head: headCells, rows });
              return r;
            }
          }
        }
        if (isInterrupt(ck, indk)) break;
      }
      para.push(l);
      k++;
    }
    if (para.length) nodes.push({ t: 'p', c: para.join('\n') });
    if (k === i && para.length === 0) {
      // safety net: never return without consuming a line (a non-block line is a paragraph line)
      nodes.push({ t: 'p', c: stripCols(lines[i], Math.min(indentCols(lines[i]), 3)) });
      return i + 1;
    }
    return k;
  }
  // ---------- rendering ----------
  function renderItemKids(kids, loose, cb, refs) {
    let out = '';
    for (let idx = 0; idx < kids.length; idx++) {
      const kd = kids[idx];
      if (kd.t === 'p') {
        const inner = (idx === 0 && cb ? cb + ' ' : '') + inline(kd.c, refs);
        out += loose ? '<p>' + inner + '</p>\n' : inner;
      } else {
        if (idx === 0 && cb) out += cb + ' ';
        out += renderBlocks([kd], refs);
      }
    }
    return out;
  }
  function renderBlocks(nodes, refs) {
    let out = '';
    for (const nd of nodes) {
      switch (nd.t) {
        case 'p': out += '<p>' + inline(nd.c, refs) + '</p>\n'; break;
        case 'h': out += '<h' + nd.l + '>' + inline(nd.c, refs) + '</h' + nd.l + '>\n'; break;
        case 'code':
          out += '<pre><code';
          if (nd.lang) out += ' class="language-' + escT(nd.lang) + '"';
          out += '>' + escC(nd.c) + '</code></pre>\n';
          break;
        case 'hr': out += '<hr>\n'; break;
        case 'html': out += nd.c; break;
        case 'bq': out += '<blockquote>\n' + renderBlocks(nd.kids, refs) + '</blockquote>\n'; break;
        case 'list': {
          out += nd.ordered
            ? '<ol' + (nd.start !== 1 ? ' start="' + nd.start + '"' : '') + '>\n'
            : '<ul>\n';
          for (const it of nd.items) {
            out += '<li>' + renderItemKids(it.kids, nd.loose, it.cb, refs) + '</li>\n';
          }
          out += nd.ordered ? '</ol>\n' : '</ul>\n';
          break;
        }
        case 'table': {
          const al = (a) => a === 'l' ? 'left' : a === 'c' ? 'center' : 'right';
          out += '<table>\n<thead>\n<tr>\n';
          for (let ci = 0; ci < nd.head.length; ci++) {
            const a = nd.align[ci];
            out += '<th' + (a ? ' align="' + al(a) + '"' : '') + '>' + inline(nd.head[ci], refs) + '</th>\n';
          }
          out += '</tr>\n</thead>\n<tbody>';
          for (const row of nd.rows) {
            out += '<tr>\n';
            for (let ci = 0; ci < nd.head.length; ci++) {
              const a = nd.align[ci];
              out += '<td' + (a ? ' align="' + al(a) + '"' : '') + '>' + inline(row[ci] || '', refs) + '</td>\n';
            }
            out += '</tr>\n';
          }
          out += '</tbody></table>\n';
          break;
        }
        default: break;
      }
    }
    return out;
  }
  // ---------- run ----------
  const refs = new Map();
  const lines = src.split('\n');
  const srcEndsNL = src.endsWith('\n');
  if (srcEndsNL) lines.pop();
  const nodes = lexLines(lines, 0, lines.length, refs, null, null);
  return renderBlocks(nodes, refs);
}

function skipDefWS(s, q) {
  const n = s.length;
  let seenNL = false;
  while (q < n) {
    const c = s[q];
    if (c === ' ' || c === '\t') { q++; continue; }
    if (c === '\n') {
      if (seenNL) return -1;
      seenNL = true;
      q++;
      continue;
    }
    break;
  }
  return q;
}
