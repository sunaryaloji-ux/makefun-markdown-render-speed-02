// A fast, dependency-free Markdown parser: parse(markdown) returns exactly the HTML that
// marked 18.1.3 renders with its default options (GFM on, breaks off, pedantic off).
//
// Written from scratch for the make.fun markdown-render-speed-02 bounty. The grammar follows
// the CommonMark 0.31.2 spec plus the GFM 0.29 extensions, with marked's own edge-case
// behaviour where the two differ. The implementation is organised as three passes, like any
// classic Markdown renderer: block tokenisation, deferred inline tokenisation (so link
// reference definitions are visible everywhere, even when defined after their use), and
// rendering. Nothing is cached between parse() calls: every call is computed from its input
// alone, and no input is ever recognised or looked up.
//
// Speed comes from the shape of the code, not from shortcuts: every regular expression is
// compiled once at module load, the block loop consumes the source front-to-back, and the
// inline pass dispatches on the character at the cursor instead of re-running the whole
// rule set for every token.

const BLOCK_TAGS =
  'address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|' +
  'details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|' +
  'h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|meta|nav|' +
  'noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|' +
  'th|thead|title|tr|track|ul';

// Small builder for composing grammars out of pieces: replace a placeholder name in a
// pattern with another pattern's source (dropping any ^ anchors the piece carried, so it
// can sit in the middle of a larger pattern). Mirrors how a grammar is usually assembled
// from named sub-patterns.
function rx(source, flags) {
  const text = typeof source === 'string' ? source : source.source;
  const api = {
    rep(search, piece) {
      const frag = typeof piece === 'string' ? piece : piece.source;
      const clean = frag.replace(/(^|[^\[])\^/g, '$1');
      return rx(text.replace(search, clean), flags);
    },
    get() {
      return new RegExp(text, flags);
    },
  };
  return api;
}

// ---------------------------------------------------------------------------
// Block grammar
// ---------------------------------------------------------------------------

const reNewline = /^(?:[ \t]*(?:\n|$))+/;
const reIndentedCode = /^((?: {4}| {0,3}\t)[^\n]+(?:\n(?:[ \t]*(?:\n|$))*)?)+/;
const reFences =
  /^ {0,3}(`{3,}(?=[^`\n]*(?:\n|$))|~{3,})([^\n]*)(?:\n|$)(?:|([\s\S]*?)(?:\n|$))(?: {0,3}(?:(?=`)\1`*|(?=~)\1~*) *(?=\n|$)|$)/;
const reHeading = /^ {0,3}(#{1,6})(?=\s|$)(.*)(?:\n+|$)/;
const reHr = /^ {0,3}((?:-[\t ]*){3,}|(?:_[ \t]*){3,}|(?:\*[ \t]*){3,})(?:\n+|$)/;
const reBullet = / {0,3}(?:[*+-]|\d{1,9}[.)])/;
const reTextLine = /^[^\n]+/;

// Setext heading, before its block-type placeholders are filled in.
const reSetextBase =
  /^(?!bull |blockCode|fences|blockquote|heading|html|table)((?:.|\n(?!\s*?\n|bull |fences|blockquote|heading|hr|html|table))+?)\n {0,3}(=+|-+)[ \t]*(?:\n+|$)/;
// Paragraph: one or more lines, stopping before a line that starts another block.
const reParagraphBase =
  /^([^\n]+(?:\n(?!hr|heading|lheading|blockquote|fences|list|html|table|[ \t]+\n)[^\n]+)*)/;
// A link label, allowing one level of nested brackets and escaped characters.
// A label that is only whitespace (up to the closing bracket) is not a label.
const reLabelInner = /(?!\s*\])(?:\\[\s\S]|[^\[\]\\\n]|\n(?![ \t]*\n))+/;
const reBracketed = /\[(?:\\[\s\S]|[^\[\]\\])*\]/;
const reLinkLabel = rx(/(?:\[(?:brackets|\\[\s\S]|[^\[\]\\])*\]|\\[\s\S]|`+(?!`)[^`]*?`+(?!`)|``+(?=\])|[^\[\]\\`])*?/)
  .rep('brackets', reBracketed)
  .get();
const reDef = rx(
  /^ {0,3}\[(label)\]: *(?:\n[ \t]*)?([^<\s][^\s]*|<.*?>)(?:(?: +(?:\n[ \t]*)?| *\n[ \t]*)(title))? *(?:\n+|$)/
)
  .rep('label', reLabelInner)
  .rep(
    'title',
    /(?:"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\\n]|\n(?!\n))*'|\((?:\\[\s\S]|[^()\\])*\))/
  )
  .get();
const reListStart = rx(/^(bull)([ \t][^\n]*?)?(?:\n|$)/).rep(/bull/g, reBullet).get();
const reComment = /<!--(?:-?>|[\s\S]*?(?:-->|$))/;
const reBlockHtml = rx(
  '^ {0,3}(?:<(script|pre|style|textarea)[\\s>][\\s\\S]*?(?:</\\1>[^\\n]*\\n*|$)' +
    '|comment[^\\n]*(\\n+|$)' +
    '|<\\?[\\s\\S]*?(?:\\?>[^\\n]*\\n*|$)' +
    '|<![A-Z][\\s\\S]*?(?:>[^\\n]*\\n*|$)' +
    '|<!\\[CDATA\\[[\\s\\S]*?(?:\\]\\]>[^\\n]*\\n*|$)' +
    '|</?(tag)(?:[ \\t]+|\\n|/?>|$)[\\s\\S]*?(?:(?:\\n[ \t]*)+\\n|$)' +
    '|<(?!(?:script|pre|style|textarea)(?![a-z0-9-]))([a-z][a-z0-9-]*)(?:attribute)*? */?>(?=[ \\t]*(?:\\n|$))[\\s\\S]*?(?:(?:\\n[ \t]*)+\\n|$)' +
    '|</[a-z][a-z0-9-]*\\s*>(?=[ \\t]*(?:\\n|$))[\\s\\S]*?(?:(?:\\n[ \t]*)+\\n|$))',
  'i'
)
  .rep('comment', reComment)
  .rep('tag', BLOCK_TAGS)
  .rep(
    'attribute',
    / +[a-zA-Z:_][\w.:-]*(?: *= *"[^"\n]*"| *= *'[^'\n]*'| *= *[^\s"'=<>`]+)?/
  )
  .get();

// GFM table: header line, delimiter row, then body rows.
const reTable = rx(
  '^ *([^\\n ].*)\\n {0,3}((?:\\| *)?:?-+:? *(?:\\| *:?-+:? *)*(?:\\| *)?)' +
    '(?:\\n((?:(?! *\\n|hr|heading|blockquote|code|fences|list|html).*(?:\\n|$))*)\\n*|$)'
)
  .rep('hr', reHr)
  .rep('heading', ' {0,3}#{1,6}(?:\\s|$)')
  .rep('blockquote', ' {0,3}>')
  .rep('code', '(?: {4}| {0,3}\t)[^\\n]')
  .rep('fences', ' {0,3}(?:`{3,}(?=[^`\\n]*(?:\\n|$))|~~~)[^\\n]*(?:\\n|$)')
  .rep('list', ' {0,3}(?:[*+-]|1[.)])[ \\t]')
  .rep(
    'html',
    ' {0,3}(?:</?(?:tag)(?: +|\\n|/?>)|<(?:(?:script|pre|style|textarea)(?:[\\s>]|$)|!--)|<\\?|<![A-Za-z]|<!\\[CDATA\\[)'
  )
  .rep('tag', BLOCK_TAGS)
  .get();

// Setext heading (GFM variant: a table delimiter row also interrupts the heading text).
const reSetext = rx(reSetextBase)
  .rep(/bull/g, reBullet)
  .rep('blockCode', /(?: {4}| {0,3}\t)/)
  .rep('fences', / {0,3}(?:`{3,}|~{3,})/)
  .rep('blockquote', / {0,3}>/)
  .rep('heading', / {0,3}#{1,6}(?:\s|$)/)
  // Non-capturing here on purpose: the underline is group 2, and a capturing
  // hr would shift it to group 3.
  .rep('hr', / {0,3}(?:(?:-[\t ]*){3,}|(?:_[ \t]*){3,}|(?:\*[ \t]*){3,})(?:\n+|$)/)
  .rep('html', / {0,3}<[^\n>]+>\n/)
  .rep('table', / {0,3}\|?(?:[:\- ]*\|)+[\:\- ]*\n/)
  .get();

// Paragraph grammar: which constructs interrupt a paragraph (GFM: tables interrupt,
// setext headings do not, lists only when the bullet is followed by content).
function paragraphGrammar(listPattern) {
  return rx(reParagraphBase)
    .rep('hr', reHr)
    .rep('heading', ' {0,3}#{1,6}(?:\\s|$)')
    .rep('|lheading', '')
    .rep('table', reTable)
    .rep('blockquote', ' {0,3}>')
    .rep('fences', ' {0,3}(?:`{3,}(?=[^`\\n]*(?:\\n|$))|~~~)[^\\n]*(?:\\n|$)')
    .rep('list', listPattern)
    .rep(
      'html',
      ' {0,3}(?:</?(?:tag)(?: +|\\n|/?>)|<(?:(?:script|pre|style|textarea)(?:[\\s>]|$)|!--)|<\\?|<![A-Za-z]|<!\\[CDATA\\[)'
    )
    .rep('tag', BLOCK_TAGS)
    .get();
}
const reParagraph = paragraphGrammar(/ {0,3}(?:[*+-]|1[.)])[ \t]+[^ \t\n]/);
const reParagraphInQuote = paragraphGrammar(/ {0,3}(?:[*+-]|\d{1,9}[.)])(?:[ \t]|\n|$)/);
const reBlockquote = rx(
  /^( {0,3}> ?(?:(?![ \t]*(?:\n|$))(paragraph)|[^\n]*)(?:\n|$))+/
)
  .rep('paragraph', reParagraphInQuote)
  .get();

// ---------------------------------------------------------------------------
// Inline grammar
// ---------------------------------------------------------------------------

const reInlineEscape = /^\\([!"#$%&'()*+,\-./:;<=>?@\[\]\\^_`{|}~])/;
const reCodeSpan = /^(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/;
const reHardBreak = /^( {2,}|\\)\n(?!\s*$)[ \t]*/;
const rePunct = /[\p{P}\p{S}]/u;
const rePunctSpace = /[\s\p{P}\p{S}]/u;
const reNotPunctSpace = /[^\s\p{P}\p{S}]/u;
const rePunctNoTilde = /(?!~)[\p{P}\p{S}]/u;
const rePunctSpaceNoTilde = /(?!~)[\s\p{P}\p{S}]/u;
const reNotPunctSpaceTilde = /(?:[^\s\p{P}\p{S}]|~)/u;
const reIsPunct = rx(/^((?![*_])punctSpace)/, 'u').rep(/punctSpace/g, rePunctSpace).get();
const reOpenQuote = /[\p{Pi}\p{Ps}"']/u;
const reAlphaNum = /[\p{L}\p{N}]/u;

// Emphasis openers: a run of * or _ plus the character that follows it (punctuation in
// group 1/3, other non-space in group 2/4). GFM treats ~ as punctuation for this test,
// so a ~ next to a delimiter does not make it a closer.
const reEmOpen = rx(
  /^(?:\*+(?:((?!\*)punct)|([^\s*]))?)|^_+(?:((?!_)punct)|([^\s_]))?/,
  'u'
)
  .rep(/punct/g, rePunctNoTilde)
  .get();

// Emphasis closers: the alternatives describe where a delimiter run may close. Groups
// 1 and 2 close, 3 and 4 only open, 5 and 6 do either; the scan below uses that split.
function emCloseTemplate(withTilde) {
  const notPunct = withTilde ? reNotPunctSpaceTilde : reNotPunctSpace;
  const punctSp = withTilde ? rePunctSpaceNoTilde : rePunctSpace;
  const punct = withTilde ? rePunctNoTilde : rePunct;
  return rx(
    '^[^_*]*?__[^_*]*?\\*[^_*]*?(?=__)|[^*]+(?=[^*])' +
      '|(?!\\*)punct(\\*+)(?=[\\s]|$)' +
      '|notPunctSpace(\\*+)(?!\\*)(?=punctSpace|$)' +
      '|(?!\\*)punctSpace(\\*+)(?=notPunctSpace)' +
      '|[\\s](\\*+)(?!\\*)(?=punct)' +
      '|(?!\\*)punct(\\*+)(?!\\*)(?=punct)' +
      '|notPunctSpace(\\*+)(?=notPunctSpace)',
    'gu'
  )
    .rep(/notPunctSpace/g, notPunct)
    .rep(/punctSpace/g, punctSp)
    .rep(/punct/g, punct)
    .get();
}
const reEmCloseAst = emCloseTemplate(true);
const reEmCloseUnd = (() => {
  const src =
    '^[^_*]*?\\*\\*[^_*]*?_[^_*]*?(?=\\*\\*)|[^_]+(?=[^_])' +
    '|(?!_)punct(_+)(?=[\\s]|$)' +
    '|notPunctSpace(_+)(?!_)(?=punctSpace|$)' +
    '|(?!_)punctSpace(_+)(?=notPunctSpace)' +
    '|[\\s](_+)(?!_)(?=punct)' +
    '|(?!_)punct(_+)(?!_)(?=punct)';
  return rx(src, 'gu')
    .rep(/notPunctSpace/g, reNotPunctSpace)
    .rep(/punctSpace/g, rePunctSpace)
    .rep(/punct/g, rePunct)
    .get();
})();
// Strikethrough openers and closers (same shape as emphasis, for ~~ runs).
const reDelOpen = rx(/^~~?(?:((?!~)punct)|[^\s~])/, 'u').rep(/punct/g, rePunct).get();
const reDelClose = (() => {
  const src =
    '^[^~]+(?=[^~])' +
    '|(?!~)punct(~~?)(?=[\\s]|$)' +
    '|notPunctSpace(~~?)(?!~)(?=punctSpace|$)' +
    '|(?!~)punctSpace(~~?)(?=notPunctSpace)' +
    '|[\\s](~~?)(?!~)(?=punct)' +
    '|(?!~)punct(~~?)(?!~)(?=punct)' +
    '|notPunctSpace(~~?)(?=notPunctSpace)';
  return rx(src, 'gu')
    .rep(/notPunctSpace/g, reNotPunctSpace)
    .rep(/punctSpace/g, rePunctSpace)
    .rep(/punct/g, rePunct)
    .get();
})();

// Autolinks <scheme:...> and <user@host>.
const reAutolink = rx(/^<(scheme:[^\s\x00-\x1f<>]*|email)>/)
  .rep('scheme', /[a-zA-Z][a-zA-Z0-9+.-]{1,31}/)
  .rep(
    'email',
    /[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+(@)[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+(?![-_])/
  )
  .get();
// Inline HTML: comment, processing instruction, declaration, CDATA, open and close tags.
const reInlineTag = rx(
  '^comment|^</[a-zA-Z][a-zA-Z0-9-]*\\s*>|^<[a-zA-Z][a-zA-Z0-9-]*(?:attribute)*?\\s*/?>' +
    '|^<\\?[\\s\\S]*?\\?>|^<![a-zA-Z]+\\s[\\s\\S]*?>|^<!\\[CDATA\\[[\\s\\S]*?\\]\\]>'
)
  .rep('comment', rx(reComment).rep('(?:-->|$)', '-->').get())
  .rep(
    'attribute',
    /\s+[a-zA-Z:_][\w.:-]*(?:\s*=\s*"[^"]*"|\s*=\s*'[^']*'|\s*=\s*[^\s"'=<>`]+)?/
  )
  .get();

// Inline links: [label](destination "title") — label allows nested brackets and code.
const reInlineLink = rx(
  /^!?\[(label)\]\([ \t\n]*(href)(?:(?:[ \t]+(?:\n[ \t]*)?|\n[ \t]*)(title))?[ \t\n]*\)/
)
  .rep('label', reLinkLabel)
  .rep('href', /<(?:\\.|[^\n<>\\])+>|[^ \t\n\x00-\x1f]+|(?=\))/)
  .rep('title', /"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|\((?:\\[\s\S]|[^)\\])*\)/)
  .get();
const reRefLink = rx(/^!?\[(label)\]\[(ref)\]/)
  .rep('label', reLinkLabel)
  .rep('ref', reLabelInner)
  .get();
const reNoLink = rx(/^!?\[(ref)\](?:\[\])?/).rep('ref', reLabelInner).get();
// The loose shapes used when masking link text out of the emphasis scan.
const reRefSearchLabel = rx(
  /(?:[^\[\]\\`]*(?:\[(?:brackets|\\[\s\S]|[^\[\]\\])*\]|\\[\s\S]|`+(?!`)[^`]*?`+(?!`)|``+(?=\]))){0,999}?[^\[\]\\`]*?/
)
  .rep('brackets', reBracketed)
  .get();
const reRefSearchRef = /(?:(?!\s*\])(?:\\[\s\S]|[^\[\]\\]){1,999})/;
const reRefSearch = rx('reflink|nolink(?!\\()', 'g')
  .rep(
    'reflink',
    rx(/^!?\[(label)\]\[(ref)\]/).rep('label', reRefSearchLabel).rep('ref', reRefSearchRef).get()
  )
  .rep('nolink', rx(/^!?\[(ref)\](?:\[\])?/).rep('ref', reRefSearchRef).get())
  .get();

// Extended autolinks: www., http(s)://, ftp:// and bare email addresses.
const reSchemeWord = /[hH][tT][tT][pP][sS]?|[fF][tT][pP]/;
const reEmailWord = /[A-Za-z0-9._+-]+@[a-zA-Z0-9-_]+(?:\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+(?![\w-])/;
const reMailto = rx(/(?:mailto:email|xmpp:email(?:\/[A-Za-z0-9@.]+)?)/).rep(/email/g, reEmailWord).get();
const reExtUrl = rx(/^emailProtocol|^((?:protocol):\/\/|www\.)(?:[a-zA-Z0-9\-]+\.?)+[^\s<]*|^email/)
  .rep('emailProtocol', reMailto)
  .rep('protocol', reSchemeWord)
  .rep('email', rx(/[A-Za-z0-9._+-]+(@)[a-zA-Z0-9-_]+(?:\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+(?![\w-])/).get())
  .get();
// Trims trailing punctuation off an extended autolink, keeping balanced parens.
// Note the '_' in the trailing class: marked's own backpedal keeps an underscore
// mid-address (mailto:a.b-c_d@a.b must stay one link), so it belongs here too.
const reBackpedal =
  /(?:[^?!.,:;*_'"~()&]+|\([^)]*\)|&(?![a-zA-Z0-9]+;$)|[?!.,:;*_'\"~)]+(?!$))+/;
// Plain text: runs up to the next inline construct. The lookaheads stop early at
// escapes, tags, links, code, emphasis, hard breaks, URLs and email addresses.
const reInlineText = rx(
  /^(?:[^a-zA-Z0-9](?=emailProtocol)|(`+|~+|[^`~])(?:(?=[`~])|(?= {2,}\n)|(?=[a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-]+@)|[\s\S]*?(?:(?=[\\<!\[`*~_]|\b_|protocol:\/\/|wwwStart|$)|[^ ](?= {2,}\n)|[^a-zA-Z0-9](?=emailProtocol)|[^a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-](?=[a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-]+@))))/
)
  .rep('protocol', reSchemeWord)
  .rep(/emailProtocol/g, /(?:mailto|xmpp):/)
  .rep('wwwStart', '(?<![^\\s*_~(])www\\.')
  .get();
// Matches inline links, code spans and tags so the emphasis scan can mask them out.
const reBlockSkip = rx(/link|precode-code|html/, 'g')
  .rep(
    'link',
    /\[(?:[^\[\]`]|(?<a>`+)[^`]+\k<a>(?!`))*?\]\((?:\\[\s\S]|[^\\\(\)]|\((?:\\[\s\S]|[^\\\(\)])*\))*\)/
  )
  .rep('precode-', '(?<!`)()')
  .rep('code', /(?<b>`+)[^`]+\k<b>(?!`)/)
  .rep('html', /<(?! )[^<>]*?>/)
  .get();
// Backslash-escaped punctuation, and punctuation outside code spans.
const reAnyPunct = rx(/\\(punct)/, 'gu').rep(/punct/g, rePunct).get();
const reAnyPunctOutsideCode = rx(
  /(`+)(?:[^`]|[^`][\s\S]*?[^`])\1(?!`)|`+|\\(punct)/,
  'gu'
)
  .rep(/punct/g, rePunct)
  .get();

// ---------------------------------------------------------------------------
// Small shared regular expressions and helpers
// ---------------------------------------------------------------------------

const reCodeRemoveIndent = /^(?: {0,3}\t| {1,4})/gm;
const reOutputLinkReplace = /\\([\[\]])/g;
const reIndentCodeComp = /^(\s+)(?:```)/;
const reBeginningSpace = /^\s+/;
const reEndingHash = /#$/;
const reStartingSpace = /^ /;
const reEndingSpace = / $/;
const reEndingSpaceTab = /[ \t]$/;
const reNonSpace = /[^ ]/;
const reNewlineGlobal = /\n/g;
const reTabGlobal = /\t/g;
const reLeadingSpaceTab = /^[ \t]+/;
const reMultiSpace = /\s+/g;
const reBlankLine = /^[ \t]*$/;
const reDoubleBlankLine = /\n[ \t]*\n[ \t]*$/;
const reBlockquoteStart = /^ {0,3}>/;
const reBlockquoteSetext = /\n {0,3}((?:=+|-+)[ \t]*)(?=\n|$)/g;
const reBlockquoteSetext2 = /^ {0,3}>[ \t]?/gm;
const reBlockquoteMarkerWs = /^( {0,3}>)([ \t]+)/gm;
const reListReplaceNesting = /^ {1,4}(?=( {4})*[^ ])/g;
const reListIsTask = /^\[[ xX]\][ \t]+\S/;
const reListReplaceTask = /^\[[ xX]\][ \t]+/;
const reListCheckbox = /\[[ xX]\]/;
const reAnyLine = /\n.*\n/;
const reHrefBrackets = /^<(.*)>$/;
const reTableDelim = /[:|]/;
const reTableAlignChars = /^\||\| *$/g;
const reTableRowBlank = /\n[ \t]*$/;
const reTableAlignRight = /^ *-+: *$/;
const reTableAlignCenter = /^ *:-+: *$/;
const reTableAlignLeft = /^ *:-+ *$/;
const reStartATag = /^<a /i;
const reEndATag = /^<\/a>/i;
const reStartPreTag = /^<(pre|code|kbd|script)(\s|>)/i;
const reEndPreTag = /^<\/(pre|code|kbd|script)(\s|>)/i;
const reStartAngle = /^</;
const reEndAngle = />$/;
const reEscapeTest = /[&<>"']/;
const reEscapeReplace = /[&<>"']/g;
const reEscapeTestNoEncode = /[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/;
const reEscapeReplaceNoEncode = /[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/g;
const reNumericRef = /&#(?:(\d{1,7})|[Xx]([A-Fa-f0-9]{1,6}));/;
const reNumericRefOrAmp =
  /&#(?:(\d{1,7})|[Xx]([A-Fa-f0-9]{1,6}));|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/g;
const rePercentDecode = /%25/g;
const reFindPipe = /\|/g;
const reSplitPipe = / \|/;
const reSlashPipe = /\\\|/g;
const reCarriageReturn = /\r\n|\r/g;
const reSpaceLine = /^ +$/gm;
const reNotSpaceStart = /^\S*/;
const reEndingNewline = /\n$/;

// Memoised per-indent factories for the list item sub-patterns. The index is
// clamped to 0..3 and, crucially, one less than the indent: a construct at
// exactly the item's content indent belongs to the item, so only one at a
// smaller indent may interrupt it.
function memo4(fn) {
  const slots = [];
  return (t) => {
    const i = Math.max(0, Math.min(3, t - 1));
    return slots[i] || (slots[i] = fn(i));
  };
}
const nextBulletRe = memo4(
  (n) => new RegExp(`^ {0,${n}}(?:[*+-]|\\d{1,9}[.)])((?:[ \t][^\\n]*)?(?:\\n|$))`)
);
const hrAtRe = memo4(
  (n) => new RegExp(`^ {0,${n}}((?:-[ \t]*){3,}|(?:_[ \t]*){3,}|(?:\\*[ \t]*){3,})(?:\\n+|$)`)
);
const fencesBeginRe = memo4((n) => new RegExp(`^ {0,${n}}(?:\`\`\`|~~~)`));
const headingBeginRe = memo4((n) => new RegExp(`^ {0,${n}}#{1,6}(?:\\s|$)`));
const htmlBeginRe = memo4(
  (n) =>
    new RegExp(
      `^ {0,${n}}(?:</?(?:${BLOCK_TAGS})(?: +|$|/?>)|<(?:(?:script|pre|style|textarea)(?:[\\s>]|$)|!--)|<\\?|<![A-Za-z]|<!\\[CDATA\\[)`,
      'i'
    )
);
const blockquoteBeginRe = memo4((n) => new RegExp(`^ {0,${n}}>`));
const listItemRe = (bullet) =>
  new RegExp(`^( {0,3}${bullet})((?:[\t ][^\\n]*)?(?:\\n|$))`);

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Escape HTML metacharacters; with encode, every & is escaped, otherwise a & that
 *  starts a valid entity or numeric reference is left alone. */
function escHtml(s, encode) {
  if (encode) {
    return reEscapeTest.test(s) ? s.replace(reEscapeReplace, (c) => ESCAPES[c]) : s;
  }
  return reEscapeTestNoEncode.test(s)
    ? s.replace(reEscapeReplaceNoEncode, (c) => ESCAPES[c])
    : s;
}

/** Decode numeric character references (&#169; &#xA9;); a bare & that starts no valid
 *  reference becomes &amp;. Named entities are left exactly as written. */
function unescapeEntities(s) {
  if (!reNumericRef.test(s)) return s;
  return s.replace(reNumericRefOrAmp, (whole, dec, hex) => {
    if (dec === undefined && hex === undefined) return '&amp;';
    const code = dec === undefined ? parseInt(hex, 16) : parseInt(dec, 10);
    if (code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return '\uFFFD';
    return code === 38 ? '&amp;' : String.fromCodePoint(code);
  });
}

/** Percent-encode a link destination the way a browser would, keeping % literal. */
function encodeHref(s) {
  try {
    return encodeURI(s).replace(rePercentDecode, '%');
  } catch {
    return null;
  }
}

/** Split a table row on unescaped pipes, trimming cells and honouring the header width. */
function splitCells(row, width) {
  const withPlaceholders = row.replace(reFindPipe, (ch, off, whole) => {
    let escaped = false;
    for (let p = off - 1; p >= 0 && whole[p] === '\\'; p--) escaped = !escaped;
    return escaped ? '|' : ' |';
  });
  const cells = withPlaceholders.split(reSplitPipe);
  if (cells[0].trim()) {
    // A leading cell with content stays; an empty one came from a leading pipe.
  } else {
    cells.shift();
  }
  if (cells.length > 0 && !cells[cells.length - 1].trim()) cells.pop();
  if (width) {
    if (cells.length > width) cells.splice(width);
    else while (cells.length < width) cells.push('');
  }
  for (let i = 0; i < cells.length; i++) {
    cells[i] = cells[i].trim().replace(reSlashPipe, '|');
  }
  return cells;
}

/** Strip trailing characters: the character itself, or (when invert) everything else. */
function stripTrailing(s, ch, invert) {
  if (s.length === 0) return '';
  let n = 0;
  for (;;) {
    const c = s.charAt(s.length - n - 1);
    if ((c === ch && !invert) || (c !== ch && invert)) n++;
    else break;
  }
  return s.slice(0, s.length - n);
}

/** Normalise a link label for lookup: trim, collapse whitespace, fold case. */
function normalizeLabel(s) {
  return s.trim().replace(reMultiSpace, ' ').toLowerCase().toUpperCase().toLowerCase();
}

/** Find the index of an unmatched close paren in s, -2 when an open paren never
 *  closes, -1 when the pair characters never appear. */
function findParen(s, pair) {
  if (s.indexOf(pair[0]) === -1 && s.indexOf(pair[1]) === -1) return -1;
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\') i++;
    else if (s[i] === pair[0]) depth++;
    else if (s[i] === pair[1] && (--depth, depth < 0)) return i;
  }
  return depth > 0 ? -2 : -1;
}

/** Expand tabs to spaces, tracking the column from startCol. */
function expandTabs(s, startCol = 0) {
  let col = startCol;
  let out = '';
  for (const ch of s) {
    if (ch === '\t') {
      const n = 4 - (col % 4);
      out += ' '.repeat(n);
      col += n;
    } else {
      out += ch;
      col++;
    }
  }
  return out;
}

/** Drop trailing blank lines beyond the first, for indented code and HTML blocks. */
function trimTrailingBlanks(s) {
  const lines = s.split('\n');
  let last = lines.length - 1;
  for (; last >= 0 && reBlankLine.test(lines[last]); last--) {}
  return lines.length - last <= 2 ? s : lines.slice(0, last + 1).join('\n');
}

// ---------------------------------------------------------------------------
// Lexer state. One parse() call owns one state object: link definitions, the
// queue of inline sources waiting to be lexed, and the inline flags.
// ---------------------------------------------------------------------------

function newState() {
  return {
    links: Object.create(null),
    queue: [],
    inLink: false,
    inRawBlock: false,
    linkEmitted: false,
    linkParenPossible: true,
    top: true,
  };
}

/** Queue an inline source for lexing after block tokenisation, returning the
 *  token array it will fill. */
function queueInline(st, src) {
  const tokens = [];
  st.queue.push({ src, tokens });
  return tokens;
}

// ---------------------------------------------------------------------------
// Block tokenisers. Each takes the remaining source and returns a token, or
// null when the construct does not start here.
// ---------------------------------------------------------------------------

function tokSpace(src) {
  const m = reNewline.exec(src);
  return m && m[0].length > 0 ? { type: 'space', raw: m[0] } : null;
}

function tokIndentedCode(src) {
  const m = reIndentedCode.exec(src);
  if (!m) return null;
  const raw = trimTrailingBlanks(m[0]);
  return { type: 'code', raw, text: raw.replace(reCodeRemoveIndent, '') };
}

function fenceContent(raw, content) {
  const m = raw.match(reIndentCodeComp);
  if (m === null) return content;
  const width = m[1].length;
  return content
    .split('\n')
    .map((line) => {
      const ws = line.match(reBeginningSpace);
      if (ws === null) return line;
      return line.slice(Math.min(ws[0].length, width));
    })
    .join('\n');
}

function tokFences(src) {
  const m = reFences.exec(src);
  if (!m) return null;
  const lang = m[2] ? m[2].trim().replace(reAnyPunct, '$1') : m[2];
  return { type: 'code', raw: m[0], lang, text: fenceContent(m[0], m[3] || '') };
}

function tokHeading(src, st) {
  const m = reHeading.exec(src);
  if (!m) return null;
  let text = m[2].trim();
  if (reEndingHash.test(text)) {
    const stripped = stripTrailing(text, '#');
    if (!stripped || reEndingSpaceTab.test(stripped)) text = stripped.trim();
  }
  return {
    type: 'heading',
    raw: stripTrailing(m[0], '\n'),
    depth: m[1].length,
    text,
    tokens: queueInline(st, text),
  };
}

function tokHr(src) {
  const m = reHr.exec(src);
  return m ? { type: 'hr', raw: stripTrailing(m[0], '\n') } : null;
}

function tokBlockquote(src, st) {
  const m = reBlockquote.exec(src);
  if (!m) return null;
  const lines = stripTrailing(m[0], '\n').split('\n');
  let raw = '';
  let text = '';
  const tokens = [];
  let rest = lines;
  for (; rest.length > 0; ) {
    let seenMarker = false;
    const chunk = [];
    let p = 0;
    for (; p < rest.length; p++) {
      if (reBlockquoteStart.test(rest[p])) {
        chunk.push(rest[p]);
        seenMarker = true;
      } else if (!seenMarker) {
        chunk.push(rest[p]);
      } else {
        break;
      }
    }
    rest = rest.slice(p);
    const joined = chunk.join('\n');
    // Strip the markers, expanding a tab after a marker to the spaces it stands
    // for, and indent setext underlines so they cannot form headings here.
    const stripped = joined
      .replace(reBlockquoteMarkerWs, (whole, marker, ws) => marker + expandTabs(ws, marker.length))
      .replace(reBlockquoteSetext, '\n    $1')
      .replace(reBlockquoteSetext2, '');
    raw = raw ? `${raw}\n${joined}` : joined;
    text = text ? `${text}\n${stripped}` : stripped;
    const savedTop = st.top;
    st.top = true;
    blockTokens(stripped, tokens, true, st);
    st.top = savedTop;
    if (rest.length === 0) break;
    const last = tokens[tokens.length - 1];
    if (
      last &&
      (last.type === 'code' ||
        last.type === 'heading' ||
        last.type === 'hr' ||
        last.type === 'html' ||
        last.type === 'table')
    ) {
      break;
    }
    if (last && last.type === 'blockquote') {
      const nestedSrc = last.raw + '\n' + rest.join('\n').replace(reBlockquoteSetext2, '');
      const reparsed = tokBlockquote(nestedSrc, st);
      tokens[tokens.length - 1] = reparsed;
      const leftover = nestedSrc.substring(reparsed.raw.length).replace(/^\n/, '');
      const leftoverLines = leftover ? leftover.split('\n').length : 0;
      const consumed = leftoverLines ? rest.slice(0, -leftoverLines) : rest;
      if (
        consumed.length > 0 &&
        ((raw = `${raw}\n${consumed.join('\n')}`),
        (text = text.substring(0, text.length - last.text.length) + reparsed.text),
        (rest = rest.slice(consumed.length)),
        rest.length > 0 && reBlockquoteStart.test(rest[0]))
      ) {
        continue;
      }
      break;
    }
    if (last && last.type === 'list') {
      const listSrc = last.raw + '\n' + rest.join('\n');
      const reparsed = tokList(listSrc, st);
      tokens[tokens.length - 1] = reparsed;
      const extra =
        reparsed.raw.length > last.raw.length
          ? listSrc.slice(last.raw.length + 1, reparsed.raw.length).split('\n').length
          : 0;
      if (extra > 0) {
        const taken = rest.slice(0, extra).join('\n');
        raw = `${raw}\n${taken}`;
        text = `${text}\n${taken}`;
      }
      rest = rest.slice(extra);
      continue;
    }
    // A paragraph or plain text token: lazy lines may keep coming.
  }
  return { type: 'blockquote', raw, tokens, text };
}

function tokList(src, st) {
  const first = reListStart.exec(src);
  if (!first) return null;
  const whole = src;
  const consumed = () => whole.length - src.length;
  let bullet = first[1].trim();
  const ordered = bullet.length > 1;
  const list = {
    type: 'list',
    raw: '',
    ordered,
    start: ordered ? +bullet.slice(0, -1) : '',
    loose: false,
    items: [],
  };
  bullet = ordered ? `\\d{1,9}\\${bullet.slice(-1)}` : `\\${bullet}`;
  const itemRe = listItemRe(bullet);
  let prevHadDoubleBlank = false;
  for (; src; ) {
    let blankItem = false;
    let itemText = '';
    const m = itemRe.exec(src);
    if (!m || reHr.test(src)) break;
    const itemStart = consumed();
    src = src.slice(m[0].length);
    const firstLine = m[2].split('\n', 1)[0];
    const bulletLen = m[1].length;
    let content = firstLine.replace(reLeadingSpaceTab, (ws) => expandTabs(ws, bulletLen));
    const nextLine = src.split('\n', 1)[0];
    let blankFirst = !content.trim();
    let indent;
    if (blankFirst) {
      indent = bulletLen + 1;
    } else {
      indent = content.search(reNonSpace);
      indent = indent > 4 ? 1 : indent;
      itemText = content.slice(indent);
      indent += bulletLen;
    }
    if (blankFirst && reBlankLine.test(nextLine)) {
      src = src.slice(nextLine.length + 1);
      blankItem = true;
    }
    if (!blankItem) {
      const nextBullet = nextBulletRe(indent);
      const hrAt = hrAtRe(indent);
      const fencesAt = fencesBeginRe(indent);
      const headingAt = headingBeginRe(indent);
      const htmlAt = htmlBeginRe(indent);
      const quoteAt = blockquoteBeginRe(indent);
      for (; src; ) {
        const line = src.split('\n', 1)[0];
        let expanded;
        if (
          fencesAt.test(line) ||
          headingAt.test(line) ||
          htmlAt.test(line) ||
          quoteAt.test(line) ||
          nextBullet.test(line) ||
          hrAt.test(line)
        ) {
          break;
        }
        expanded = line.replace(reLeadingSpaceTab, (ws) => expandTabs(ws));
        if (expanded.search(reNonSpace) >= indent || !line.trim()) {
          itemText += '\n' + expanded.slice(indent);
        } else {
          if (
            blankFirst ||
            content.replace(reTabGlobal, '    ').search(reNonSpace) >= 4 ||
            fencesAt.test(content) ||
            headingAt.test(content) ||
            htmlAt.test(content) ||
            hrAt.test(content)
          ) {
            break;
          }
          const asSetext =
            /^ {0,3}(?:=+|-+) *$/.test(line) && reSetext.test(`${content}\n${line}`)
              ? `    ${expanded.replace(/^ {0,3}/, '')}`
              : line;
          itemText += '\n' + asSetext;
        }
        blankFirst = !line.trim();
        src = src.slice(line.length + 1);
        content = expanded.slice(indent);
      }
    }
    const itemRaw = whole.slice(itemStart, consumed());
    if (!list.loose) {
      if (prevHadDoubleBlank) list.loose = true;
      else if (reDoubleBlankLine.test(itemRaw)) prevHadDoubleBlank = true;
    }
    list.items.push({
      type: 'list_item',
      raw: itemRaw,
      task: reListIsTask.test(itemText),
      loose: false,
      text: itemText,
      tokens: [],
    });
  }
  const lastItem = list.items[list.items.length - 1];
  if (!lastItem) return null;
  lastItem.raw = lastItem.raw.trimEnd();
  lastItem.text = lastItem.text.trimEnd();
  list.raw = whole.slice(0, consumed()).trimEnd();
  for (const item of list.items) {
    st.top = false;
    item.tokens = blockTokens(item.text, [], false, st);
    if (!list.loose) {
      const spaces = item.tokens.filter((t) => t.type === 'space');
      list.loose = spaces.length > 0 && spaces.some((t) => reAnyLine.test(t.raw));
    }
  }
  for (const item of list.items) {
    const firstTok = item.tokens[0];
    if (item.task && (firstTok?.type === 'text' || firstTok?.type === 'paragraph')) {
      item.text = item.text.replace(reListReplaceTask, '');
      firstTok.raw = firstTok.raw.replace(reListReplaceTask, '');
      firstTok.text = firstTok.text.replace(reListReplaceTask, '');
      for (let g = st.queue.length - 1; g >= 0; g--) {
        if (reListIsTask.test(st.queue[g].src)) {
          st.queue[g].src = st.queue[g].src.replace(reListReplaceTask, '');
          break;
        }
      }
      const box = reListCheckbox.exec(item.raw);
      if (box) {
        const checkbox = { type: 'checkbox', raw: box[0] + ' ', checked: box[0] !== '[ ]' };
        item.checked = checkbox.checked;
        if (list.loose) {
          if (
            item.tokens[0] &&
            (item.tokens[0].type === 'paragraph' || item.tokens[0].type === 'text') &&
            'tokens' in item.tokens[0] &&
            item.tokens[0].tokens
          ) {
            item.tokens[0].raw = checkbox.raw + item.tokens[0].raw;
            item.tokens[0].text = checkbox.raw + item.tokens[0].text;
            item.tokens[0].tokens.unshift(checkbox);
          } else {
            item.tokens.unshift({
              type: 'paragraph',
              raw: checkbox.raw,
              text: checkbox.raw,
              tokens: [checkbox],
            });
          }
        } else {
          item.tokens.unshift(checkbox);
        }
      }
    } else if (item.task) {
      item.task = false;
    }
  }
  if (list.loose) {
    for (const item of list.items) {
      item.loose = true;
      for (const t of item.tokens) if (t.type === 'text') t.type = 'paragraph';
    }
  }
  return list;
}

function tokHtml(src) {
  const m = reBlockHtml.exec(src);
  if (!m) return null;
  const raw = trimTrailingBlanks(m[0]);
  return { type: 'html', raw, text: raw };
}

function tokDef(src) {
  const m = reDef.exec(src);
  if (!m) return null;
  if (!reStartAngle.test(m[2]) && findParen(m[2], '()') !== -1) return null;
  const tag = normalizeLabel(m[1]);
  const href = m[2] ? m[2].replace(reHrefBrackets, '$1').replace(reAnyPunct, '$1') : '';
  const title = m[3]
    ? m[3].substring(1, m[3].length - 1).replace(reAnyPunct, '$1')
    : m[3];
  return { type: 'def', tag, raw: stripTrailing(m[0], '\n'), href, title };
}

function tokTable(src, st) {
  const m = reTable.exec(src);
  if (!m || !reTableDelim.test(m[2])) return null;
  const headerCells = splitCells(m[1]);
  const delimCells = m[2].replace(reTableAlignChars, '').split('|');
  const bodyLines =
    m[3] && m[3].trim() ? m[3].replace(reTableRowBlank, '').split('\n') : [];
  const table = {
    type: 'table',
    raw: stripTrailing(m[0], '\n'),
    header: [],
    align: [],
    rows: [],
  };
  if (headerCells.length !== delimCells.length) return null;
  for (const cell of delimCells) {
    if (reTableAlignRight.test(cell)) table.align.push('right');
    else if (reTableAlignCenter.test(cell)) table.align.push('center');
    else if (reTableAlignLeft.test(cell)) table.align.push('left');
    else table.align.push(null);
  }
  for (let i = 0; i < headerCells.length; i++) {
    table.header.push({
      text: headerCells[i],
      tokens: queueInline(st, headerCells[i]),
      header: true,
      align: table.align[i],
    });
  }
  for (const line of bodyLines) {
    table.rows.push(
      splitCells(line, headerCells.length).map((cell, j) => ({
        text: cell,
        tokens: queueInline(st, cell),
        header: false,
        align: table.align[j],
      }))
    );
  }
  return table;
}

function tokSetext(src, st) {
  const m = reSetext.exec(src);
  if (!m) return null;
  const text = m[1].trim();
  return {
    type: 'heading',
    raw: stripTrailing(m[0], '\n'),
    depth: m[2].charAt(0) === '=' ? 1 : 2,
    text,
    tokens: queueInline(st, text),
  };
}

function tokParagraph(src, st) {
  const m = reParagraph.exec(src);
  if (!m) return null;
  const text =
    m[1].charAt(m[1].length - 1) === '\n' ? m[1].slice(0, -1) : m[1];
  return { type: 'paragraph', raw: m[0], text, tokens: queueInline(st, text) };
}

function tokText(src, st) {
  const m = reTextLine.exec(src);
  if (!m) return null;
  return { type: 'text', raw: m[0], text: m[0], tokens: queueInline(st, m[0]) };
}

// The block loop: try each construct in order, consuming the source front to
// back. A space of one newline folds into the previous token; indented code and
// link definitions directly after a paragraph fold into it.
function blockTokens(src, tokens, nested, st) {
  let guard = Infinity;
  for (; src; ) {
    if (src.length < guard) guard = src.length;
    else throw new Error('Infinite loop on byte: ' + src.charCodeAt(0));
    let tok;
    if ((tok = tokSpace(src))) {
      src = src.slice(tok.raw.length);
      const prev = tokens[tokens.length - 1];
      if (tok.raw.length === 1 && prev !== undefined) prev.raw += '\n';
      else tokens.push(tok);
      continue;
    }
    if ((tok = tokIndentedCode(src))) {
      src = src.slice(tok.raw.length);
      const prev = tokens[tokens.length - 1];
      if (prev && (prev.type === 'paragraph' || prev.type === 'text')) {
        prev.raw += (prev.raw.endsWith('\n') ? '' : '\n') + tok.raw;
        prev.text += '\n' + tok.text;
        st.queue[st.queue.length - 1].src = prev.text;
      } else {
        tokens.push(tok);
      }
      continue;
    }
    if ((tok = tokFences(src))) {
      src = src.slice(tok.raw.length);
      tokens.push(tok);
      continue;
    }
    if ((tok = tokHeading(src, st))) {
      src = src.slice(tok.raw.length);
      tokens.push(tok);
      continue;
    }
    if ((tok = tokHr(src))) {
      src = src.slice(tok.raw.length);
      tokens.push(tok);
      continue;
    }
    if ((tok = tokBlockquote(src, st))) {
      src = src.slice(tok.raw.length);
      tokens.push(tok);
      continue;
    }
    if ((tok = tokList(src, st))) {
      src = src.slice(tok.raw.length);
      tokens.push(tok);
      continue;
    }
    if ((tok = tokHtml(src))) {
      src = src.slice(tok.raw.length);
      tokens.push(tok);
      continue;
    }
    if ((tok = tokDef(src))) {
      src = src.slice(tok.raw.length);
      const prev = tokens[tokens.length - 1];
      if (prev && (prev.type === 'paragraph' || prev.type === 'text')) {
        prev.raw += (prev.raw.endsWith('\n') ? '' : '\n') + tok.raw;
        prev.text += '\n' + tok.raw;
        st.queue[st.queue.length - 1].src = prev.text;
      } else {
        if (!st.links[tok.tag]) st.links[tok.tag] = { href: tok.href, title: tok.title };
        tokens.push(tok);
      }
      continue;
    }
    if ((tok = tokTable(src, st))) {
      src = src.slice(tok.raw.length);
      tokens.push(tok);
      continue;
    }
    if ((tok = tokSetext(src, st))) {
      src = src.slice(tok.raw.length);
      tokens.push(tok);
      continue;
    }
    if (st.top && (tok = tokParagraph(src, st))) {
      const prev = tokens[tokens.length - 1];
      if (nested && prev && prev.type === 'paragraph') {
        prev.raw += (prev.raw.endsWith('\n') ? '' : '\n') + tok.raw;
        prev.text += '\n' + tok.text;
        st.queue.pop();
        st.queue[st.queue.length - 1].src = prev.text;
      } else {
        tokens.push(tok);
      }
      src = src.slice(tok.raw.length);
      continue;
    }
    if ((tok = tokText(src, st))) {
      src = src.slice(tok.raw.length);
      const prev = tokens[tokens.length - 1];
      if (prev && prev.type === 'text') {
        prev.raw += (prev.raw.endsWith('\n') ? '' : '\n') + tok.raw;
        prev.text += '\n' + tok.text;
        st.queue.pop();
        st.queue[st.queue.length - 1].src = prev.text;
      } else {
        tokens.push(tok);
      }
      continue;
    }
    if (src) throw new Error('Infinite loop on byte: ' + src.charCodeAt(0));
  }
  st.top = true;
  return tokens;
}

// ---------------------------------------------------------------------------
// Inline helpers: masking, closer scans, link construction
// ---------------------------------------------------------------------------

// Does this text contain a link (inline or reference) anywhere inside it?
function linkInText(src, st) {
  if (!src.includes('[')) return false;
  for (const m of src.matchAll(reBlockSkip)) {
    if (reInlineLink.test(m[0]) && src.charAt(m.index - 1) !== '!') return true;
  }
  for (const m of src.matchAll(reRefSearch)) {
    const s = m[0];
    const r = s.lastIndexOf('[');
    if (
      !(s.charAt(0) === '!' || !Object.hasOwn(st.links, normalizeLabel(s.slice(r + 1, -1)))) &&
      !(r > 1 && linkInText(s.slice(1, r - 1), st))
    ) {
      return true;
    }
  }
  return false;
}

// Build the masked copy of an inline source that the emphasis scan reads: link
// text, code spans and tags are replaced by same-length filler, and punctuation
// outside code is replaced by '+' so only its length and position matter.
function maskForEmphasis(src, st) {
  let t = src;
  if (src.includes('[')) {
    const maskRef = (match) => {
      const o = match.lastIndexOf('[');
      if (!Object.hasOwn(st.links, normalizeLabel(match.slice(o + 1, -1)))) return match;
      if (o > 1 && match.charAt(0) !== '!') {
        const inner = match.slice(1, o - 1);
        if (linkInText(inner, st)) {
          return '[' + inner.replace(reRefSearch, maskRef) + '][' + 'a'.repeat(match.length - o - 2) + ']';
        }
      }
      return '[' + 'a'.repeat(match.length - 2) + ']';
    };
    t = t.replace(reRefSearch, maskRef);
  }
  t = t.replace(reAnyPunctOutsideCode, (whole, backticks, punct) => {
    if (punct) return '+'.repeat(whole.length);
    if (backticks) {
      return (
        backticks +
        whole.slice(backticks.length, -backticks.length).replace(/`/g, '+') +
        backticks
      );
    }
    return whole;
  });
  t = t.replace(reBlockSkip, (whole, _a, precode) => {
    const keep = precode ? precode.length : 0;
    return whole.slice(0, keep) + '[' + 'a'.repeat(whole.length - keep - 2) + ']';
  });
  return t;
}

// For a masked source, where the last delimiter run of each kind could close an
// opener: the run's start index, or -1. A run only counts when the character
// before it is not whitespace.
function scanClosers(masked) {
  const em = { '*': -1, _: -1 };
  let del = -1;
  const n = masked.length;
  for (let s = 0; s < n; s++) {
    const r = masked[s];
    if (r !== '*' && r !== '_' && r !== '~') continue;
    const before = s === 0 ? '\n' : masked[s - 1];
    let i = s + 1;
    for (; i < n && masked[i] === r; i++) {}
    if (before !== ' ' && before !== '\t' && before !== '\n' && before !== '\r' && before !== '\f') {
      if (r === '~') del = s;
      else em[r] = s;
    }
    s = i - 1;
  }
  return { masked, em, del };
}

// Would the label of this link contain a tag or autolink that runs past the
// label's end? Such a link is not a link at all.
function labelHasTag(src, label, offset) {
  if (!label.includes('<')) return false;
  for (let s = 0; s < label.length; s++) {
    if (label[s] === '\\') {
      s++;
      continue;
    }
    if (label[s] === '`') {
      const m = reCodeSpan.exec(label.slice(s));
      if (m) {
        s += m[0].length - 1;
        continue;
      }
    }
    if (label[s] !== '<') continue;
    const rest = src.slice(offset + s);
    const tag = reInlineTag.exec(rest) || reAutolink.exec(rest);
    if (tag) {
      if (tag[0].length > label.length - s) return true;
      s += tag[0].length - 1;
    }
  }
  return false;
}

// Build a link or image token from a match, lexing its label text. A link whose
// label already contains a link is not a link.
function makeLink(match, dest, raw, st) {
  const href = dest.href;
  const title = dest.title || null;
  const labelText = match[1].replace(reOutputLinkReplace, '$1');
  const isImage = match[0].charAt(0) === '!';
  const savedInLink = st.inLink;
  const savedEmitted = st.linkEmitted;
  const savedRawBlock = st.inRawBlock;
  st.inLink = true;
  st.linkEmitted = false;
  const labelTokens = inlineTokens(labelText, [], st);
  const nestedLink = st.linkEmitted;
  st.linkEmitted = savedEmitted;
  st.inLink = savedInLink;
  if (!isImage) {
    if (nestedLink) {
      st.inRawBlock = savedRawBlock;
      return null;
    }
    st.linkEmitted = true;
  }
  return {
    type: isImage ? 'image' : 'link',
    raw,
    href,
    title,
    text: labelText,
    tokens: labelTokens,
  };
}

// ---------------------------------------------------------------------------
// Inline tokenisers
// ---------------------------------------------------------------------------

function tokEscape(src) {
  const m = reInlineEscape.exec(src);
  return m ? { type: 'escape', raw: m[0], text: m[1] } : null;
}

function tokInlineTag(src, st) {
  const m = reInlineTag.exec(src);
  if (!m) return null;
  if (!st.inLink && reStartATag.test(m[0])) st.inLink = true;
  else if (st.inLink && reEndATag.test(m[0])) st.inLink = false;
  if (!st.inRawBlock && reStartPreTag.test(m[0])) st.inRawBlock = true;
  else if (st.inRawBlock && reEndPreTag.test(m[0])) st.inRawBlock = false;
  return {
    type: 'html',
    raw: m[0],
    inLink: st.inLink,
    inRawBlock: st.inRawBlock,
    block: false,
    text: m[0],
  };
}

function tokInlineLink(src, st) {
  if (st.linkParenPossible === false) return null;
  const m = reInlineLink.exec(src);
  if (!m) return null;
  const offset = m[0].charAt(0) === '!' ? 2 : 1;
  if (labelHasTag(src, m[1], offset)) return null;
  const dest = m[2].trim();
  if (reStartAngle.test(dest)) {
    if (!reEndAngle.test(dest)) return null;
    const stripped = stripTrailing(dest.slice(0, -1), '\\');
    if ((dest.length - stripped.length) % 2 === 0) return null;
  } else {
    const close = findParen(m[2], '()');
    if (close === -2) return null;
    if (close > -1) {
      const cut = (m[0].indexOf('!') === 0 ? 5 : 4) + m[1].length + close;
      m[2] = m[2].substring(0, close);
      m[0] = m[0].substring(0, cut).trim();
      m[3] = '';
    }
  }
  const stripped = stripTrailing(m[0].slice(0, -1), '\\');
  if ((m[0].length - stripped.length) % 2 === 0) return null;
  let href = m[2];
  let title = m[3] ? m[3].slice(1, -1) : '';
  href = href.trim();
  if (reStartAngle.test(href)) href = href.slice(1, -1);
  return makeLink(
    m,
    {
      href: href && href.replace(reAnyPunct, '$1'),
      title: title && title.replace(reAnyPunct, '$1'),
    },
    m[0],
    st
  );
}

function tokRefLink(src, st) {
  const m = reRefLink.exec(src) || reNoLink.exec(src);
  if (!m) return null;
  const offset = m[0].charAt(0) === '!' ? 2 : 1;
  if (labelHasTag(src, m[1], offset)) return null;
  const ref = st.links[normalizeLabel(m[2] || m[1])];
  if (!ref) {
    const first = m[0].charAt(0);
    return { type: 'text', raw: first, text: first };
  }
  return makeLink(m, ref, m[0], st);
}

// Emphasis and strong emphasis. `src` is the remaining inline source, `masked`
// the whole source with links, code and tags masked out, `prevChar` the last
// character of the previous token (or ''), and `closers` the last possible
// closer positions in the masked source.
function tokEmStrong(src, masked, prevChar, closers, st) {
  const m = reEmOpen.exec(src);
  if (!m || (!m[1] && !m[2] && !m[3] && !m[4])) return null;
  const delim = m[0][0];
  const sameAsPrev = prevChar === delim;
  const i = masked.length - src.length;
  let l = i;
  for (; l > 0 && masked[l - 1] === delim; l--) {}
  const beforeRun = [...masked.slice(Math.max(0, l - 2), l)].at(-1) ?? '';
  const beforeIsPunct =
    beforeRun === '*' || beforeRun === '_' || reIsPunct.test(beforeRun);
  if (l < i) prevChar = beforeRun;
  const prevIsPunct = l < i ? beforeIsPunct : reIsPunct.test(prevChar);
  if (m[4] && reAlphaNum.test(prevChar)) return null;
  const punctAfter = m[1] || m[3] || '';
  if (!punctAfter || !prevChar || prevIsPunct) {
    const k = [...m[0]].length - 1;
    let openers = k;
    let deferred = 0;
    const total = i - l + k;
    const canCloseAlso =
      !!beforeRun.trim() && (!!punctAfter || (delim === '*' && !beforeIsPunct));
    if (delim !== '*' && delim !== '_') return null;
    const closerRe = delim === '*' ? reEmCloseAst : reEmCloseUnd;
    const lastPossible = closers.em[delim];
    const afterOpener = i + k;
    if (lastPossible < afterOpener) return null;
    const scanIn = masked.slice(afterOpener);
    const limit = lastPossible - afterOpener;
    closerRe.lastIndex = 0;
    let match;
    while ((match = closerRe.exec(scanIn)) !== null && !(match.index > limit)) {
      const run = match[1] || match[2] || match[3] || match[4] || match[5] || match[6];
      if (!run) continue;
      const b = [...run].length;
      if (match[3] || match[4]) {
        openers += b;
        continue;
      }
      if (match[5] || match[6] || canCloseAlso) {
        if (sameAsPrev && (match[5] || match[6])) break;
        if (total % 3 && !((total + b) % 3)) {
          deferred += b;
          continue;
        }
      }
      openers -= b;
      if (openers > 0) continue;
      const used = Math.min(b, b + openers + deferred);
      const firstLen = [...match[0]][0].length;
      const raw = src.slice(0, k + match.index + firstLen + used);
      if (Math.min(k, used) % 2) {
        const inner = raw.slice(1, -1);
        return { type: 'em', raw, text: inner, tokens: inlineTokens(inner, [], st) };
      }
      const inner = raw.slice(2, -2);
      return { type: 'strong', raw, text: inner, tokens: inlineTokens(inner, [], st) };
    }
  }
  return null;
}

function tokCodeSpan(src) {
  const m = reCodeSpan.exec(src);
  if (!m) return null;
  let text = m[2].replace(reNewlineGlobal, ' ');
  const hasNonSpace = reNonSpace.test(text);
  const wrapped = reStartingSpace.test(text) && reEndingSpace.test(text);
  if (hasNonSpace && wrapped) text = text.substring(1, text.length - 1);
  return { type: 'codespan', raw: m[0], text };
}

function tokBr(src) {
  const m = reHardBreak.exec(src);
  return m ? { type: 'br', raw: m[0] } : null;
}

// Strikethrough: same shape as emphasis, for runs of one or two ~.
function tokDel(src, masked, prevChar, closers, st) {
  const m = reDelOpen.exec(src);
  if (!m) return null;
  if (!(m[1] || '') || !prevChar || reIsPunct.test(prevChar)) {
    const count = [...m[0]].length - 1;
    let remaining = count;
    const lastPossible = closers.del;
    const afterOpener = masked.length - src.length + count;
    if (lastPossible < afterOpener) return null;
    const scanIn = masked.slice(afterOpener);
    const limit = lastPossible - afterOpener;
    reDelClose.lastIndex = 0;
    let match;
    while ((match = reDelClose.exec(scanIn)) !== null && !(match.index > limit)) {
      const run = match[1] || match[2] || match[3] || match[4] || match[5] || match[6];
      if (!run) continue;
      const len = [...run].length;
      if (len !== count) continue;
      if (match[3] || match[4]) {
        remaining += len;
        continue;
      }
      remaining -= len;
      if (remaining > 0) continue;
      const used = Math.min(len, len + remaining);
      const firstLen = [...match[0]][0].length;
      const raw = src.slice(0, count + match.index + firstLen + used);
      const inner = raw.slice(count, -count);
      return { type: 'del', raw, text: inner, tokens: inlineTokens(inner, [], st) };
    }
  }
  return null;
}

function tokAutolink(src) {
  const m = reAutolink.exec(src);
  if (!m) return null;
  let text;
  let href;
  if (m[2] === '@') {
    text = m[1];
    href = 'mailto:' + text;
  } else {
    text = m[1];
    href = text;
  }
  return {
    type: 'link',
    raw: m[0],
    text,
    href,
    autolink: true,
    tokens: [{ type: 'text', raw: text, text }],
  };
}

function tokExtUrl(src) {
  const m = reExtUrl.exec(src);
  if (!m) return null;
  let text;
  let href;
  if (m[2] === '@') {
    text = m[0];
    href = 'mailto:' + text;
  } else {
    let cur = m[0];
    let prev;
    do {
      prev = cur;
      cur = reBackpedal.exec(cur)?.[0] ?? '';
    } while (prev !== cur);
    text = cur;
    href = m[1] === 'www.' ? 'http://' + cur : cur;
  }
  return {
    type: 'link',
    raw: text,
    text,
    href,
    autolink: true,
    tokens: [{ type: 'text', raw: text, text }],
  };
}

function tokInlineText(src, st) {
  const m = reInlineText.exec(src);
  if (!m) return null;
  const inRaw = st.inRawBlock;
  return {
    type: 'text',
    raw: m[0],
    text: inRaw ? m[0] : unescapeEntities(m[0]),
    escaped: inRaw,
  };
}

// The inline loop: try each construct in order, in a masked copy of the source
// for the emphasis scans. Text tokens merge with a preceding text token.
function inlineTokens(src, tokens, st) {
  const savedParen = st.linkParenPossible;
  st.linkParenPossible = savedParen && src.includes(')');
  try {
    const masked =
      src.includes('*') || src.includes('_') || src.includes('~')
        ? maskForEmphasis(src, st)
        : src;
    const closers = scanClosers(masked);
    let prevChar = '';
    let prevWasText = false;
    let guard = Infinity;
    let rest = src;
    for (; rest; ) {
      if (rest.length < guard) guard = rest.length;
      else throw new Error('Infinite loop on byte: ' + rest.charCodeAt(0));
      if (!prevWasText) prevChar = '';
      prevWasText = false;
      let tok;
      if ((tok = tokEscape(rest))) {
        rest = rest.slice(tok.raw.length);
        tokens.push(tok);
        continue;
      }
      if ((tok = tokInlineTag(rest, st))) {
        rest = rest.slice(tok.raw.length);
        tokens.push(tok);
        continue;
      }
      if ((tok = tokInlineLink(rest, st))) {
        rest = rest.slice(tok.raw.length);
        tokens.push(tok);
        continue;
      }
      if ((tok = tokRefLink(rest, st))) {
        rest = rest.slice(tok.raw.length);
        const prev = tokens[tokens.length - 1];
        if (tok.type === 'text' && prev && prev.type === 'text') {
          prev.raw += tok.raw;
          prev.text += tok.text;
        } else {
          tokens.push(tok);
        }
        continue;
      }
      if ((tok = tokEmStrong(rest, masked, prevChar, closers, st))) {
        rest = rest.slice(tok.raw.length);
        tokens.push(tok);
        continue;
      }
      if ((tok = tokCodeSpan(rest))) {
        rest = rest.slice(tok.raw.length);
        tokens.push(tok);
        continue;
      }
      if ((tok = tokBr(rest))) {
        rest = rest.slice(tok.raw.length);
        tokens.push(tok);
        continue;
      }
      if ((tok = tokDel(rest, masked, prevChar, closers, st))) {
        rest = rest.slice(tok.raw.length);
        tokens.push(tok);
        continue;
      }
      if ((tok = tokAutolink(rest))) {
        rest = rest.slice(tok.raw.length);
        tokens.push(tok);
        continue;
      }
      if (!st.inLink && (tok = tokExtUrl(rest))) {
        rest = rest.slice(tok.raw.length);
        tokens.push(tok);
        continue;
      }
      if ((tok = tokInlineText(rest, st))) {
        rest = rest.slice(tok.raw.length);
        if (tok.raw.slice(-1) !== '_') prevChar = tok.raw.slice(-1);
        prevWasText = true;
        const prev = tokens[tokens.length - 1];
        if (prev && prev.type === 'text') {
          prev.raw += tok.raw;
          prev.text += tok.text;
        } else {
          tokens.push(tok);
        }
        continue;
      }
      if (rest) throw new Error('Infinite loop on byte: ' + rest.charCodeAt(0));
    }
    return tokens;
  } finally {
    st.linkParenPossible = savedParen;
  }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function renderInline(tokens, textMode = false) {
  let out = '';
  for (const tok of tokens) {
    switch (tok.type) {
      case 'escape':
        out += textMode ? tok.text : escHtml(tok.text);
        break;
      case 'html':
        out += tok.text;
        break;
      case 'link': {
        if (textMode) {
          out += tok.tokens ? renderInline(tok.tokens, true) : tok.text;
          break;
        }
        const label = tok.autolink ? escHtml(tok.text, true) : renderInline(tok.tokens);
        const href = encodeHref(tok.href);
        if (href === null) {
          out += label;
          break;
        }
        const hrefEsc = escHtml(href, tok.autolink);
        out += `<a href="${hrefEsc}"`;
        if (tok.title) out += ` title="${escHtml(tok.title)}"`;
        out += `>${label}</a>`;
        break;
      }
      case 'image': {
        const alt = tok.tokens ? renderInline(tok.tokens, true) : tok.text;
        if (textMode) {
          out += alt;
          break;
        }
        const href = encodeHref(tok.href);
        if (href === null) {
          out += escHtml(alt);
          break;
        }
        out += `<img src="${escHtml(href)}" alt="${escHtml(alt)}"`;
        if (tok.title) out += ` title="${escHtml(tok.title)}"`;
        out += '>';
        break;
      }
      case 'checkbox':
        out += textMode ? tok.raw : `<input ${tok.checked ? 'checked="" ' : ''}disabled="" type="checkbox"> `;
        break;
      case 'strong':
        out += textMode
          ? tok.tokens
            ? renderInline(tok.tokens, true)
            : tok.text
          : `<strong>${renderInline(tok.tokens)}</strong>`;
        break;
      case 'em':
        out += textMode
          ? tok.tokens
            ? renderInline(tok.tokens, true)
            : tok.text
          : `<em>${renderInline(tok.tokens)}</em>`;
        break;
      case 'codespan':
        out += textMode ? tok.text : `<code>${escHtml(tok.text, true)}</code>`;
        break;
      case 'br':
        out += textMode ? '' : '<br>';
        break;
      case 'del':
        out += textMode
          ? tok.tokens
            ? renderInline(tok.tokens, true)
            : tok.text
          : `<del>${renderInline(tok.tokens)}</del>`;
        break;
      case 'text':
        out += textMode ? tok.text : tok.tokens ? renderInline(tok.tokens) : tok.escaped ? tok.text : escHtml(tok.text);
        break;
      default:
        throw new Error(`Token with "${tok.type}" type was not found.`);
    }
  }
  return out;
}

function renderTableCell(cell) {
  const tag = cell.header ? 'th' : 'td';
  const inner = renderInline(cell.tokens);
  return (cell.align ? `<${tag} align="${cell.align}">` : `<${tag}>`) + inner + `</${tag}>\n`;
}

function renderBlocks(tokens) {
  let out = '';
  for (const tok of tokens) {
    switch (tok.type) {
      case 'space':
        break;
      case 'checkbox':
        out += `<input ${tok.checked ? 'checked="" ' : ''}disabled="" type="checkbox"> `;
        break;
      case 'hr':
        out += '<hr>\n';
        break;
      case 'heading':
        out += `<h${tok.depth}>${renderInline(tok.tokens)}</h${tok.depth}>\n`;
        break;
      case 'code': {
        const lang = (tok.lang || '').match(reNotSpaceStart)?.[0];
        const text = tok.text ? tok.text.replace(reEndingNewline, '') + '\n' : tok.text;
        out += lang
          ? `<pre><code class="language-${escHtml(lang)}">${escHtml(text, true)}</code></pre>\n`
          : `<pre><code>${escHtml(text, true)}</code></pre>\n`;
        break;
      }
      case 'table': {
        let head = '';
        for (const cell of tok.header) head += renderTableCell(cell);
        let body = '';
        for (const row of tok.rows) {
          let cells = '';
          for (const cell of row) cells += renderTableCell(cell);
          body += `<tr>\n${cells}</tr>\n`;
        }
        if (body) body = `<tbody>${body}</tbody>`;
        out += `<table>\n<thead>\n<tr>\n${head}</tr>\n</thead>\n${body}</table>\n`;
        break;
      }
      case 'blockquote':
        out += `<blockquote>\n${renderBlocks(tok.tokens)}</blockquote>\n`;
        break;
      case 'list': {
        let items = '';
        for (const item of tok.items) items += `<li>${renderBlocks(item.tokens)}</li>\n`;
        const tag = tok.ordered ? 'ol' : 'ul';
        const start = tok.ordered && tok.start !== 1 ? ` start="${tok.start}"` : '';
        out += `<${tag}${start}>\n${items}</${tag}>\n`;
        break;
      }
      case 'html':
        out += tok.text;
        break;
      case 'def':
        break;
      case 'paragraph':
        out += `<p>${renderInline(tok.tokens)}</p>\n`;
        break;
      case 'text':
        out += renderInline(tok.tokens);
        break;
      default:
        throw new Error(`Token with "${tok.type}" type was not found.`);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/** The HTML marked 18.1.3 renders for `markdown`, with marked's defaults. */
export function parse(markdown) {
  const st = newState();
  const src = markdown.replace(reCarriageReturn, '\n');
  const tokens = blockTokens(src, [], false, st);
  for (const entry of st.queue) {
    st.inRawBlock = false;
    inlineTokens(entry.src, entry.tokens, st);
  }
  st.queue.length = 0;
  return renderBlocks(tokens);
}
