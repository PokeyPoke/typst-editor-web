/**
 * Typst source parser — bracket-balanced element extraction.
 * Parses ptitle, sintro, tcard, ibox, and standalone images from source.
 */

const TypstParser = (() => {

  /**
   * Find the matching closing character, respecting nesting and strings.
   * @param {string} src - full source
   * @param {number} start - index of opening char
   * @param {string} open - opening char '(' or '['
   * @param {string} close - closing char ')' or ']'
   * @returns {number} index of closing char, or -1
   */
  function balancedEnd(src, start, open, close) {
    let depth = 1;
    let i = start + 1;
    // When matching brackets [], content is Typst markup where " is literal.
    // Only skip strings when matching parens () (code context).
    const skipStrings = (open === '(');
    while (i < src.length && depth > 0) {
      const ch = src[i];
      if (skipStrings && ch === '"') {
        // skip string in code context
        i++;
        while (i < src.length && src[i] !== '"') {
          if (src[i] === '\\') i++; // skip escaped char
          i++;
        }
      } else if (ch === open) {
        depth++;
      } else if (ch === close) {
        depth--;
      }
      i++;
    }
    return depth === 0 ? i - 1 : -1;
  }

  /**
   * Get line number (1-based) for a character index.
   */
  function lineAt(src, idx) {
    let line = 1;
    for (let i = 0; i < idx && i < src.length; i++) {
      if (src[i] === '\n') line++;
    }
    return line;
  }

  /**
   * Get character index for start of line (1-based).
   */
  function lineStartIdx(src, lineNum) {
    let line = 1;
    for (let i = 0; i < src.length; i++) {
      if (line === lineNum) return i;
      if (src[i] === '\n') line++;
    }
    return src.length;
  }

  /**
   * Parse named arguments from a paren-enclosed argument string.
   * e.g. 'num: 1, title: "Foo"' → {num: '1', title: 'Foo'}
   */
  function parseArgs(argStr) {
    const args = {};
    let i = 0;
    const len = argStr.length;

    while (i < len) {
      // skip whitespace
      while (i < len && /\s/.test(argStr[i])) i++;
      if (i >= len) break;

      // find key
      let keyStart = i;
      while (i < len && argStr[i] !== ':' && argStr[i] !== ',' && argStr[i] !== '(' && argStr[i] !== '[') i++;

      if (i >= len || argStr[i] !== ':') {
        // positional arg or end — skip to next comma
        while (i < len && argStr[i] !== ',') {
          if (argStr[i] === '"') { i++; while (i < len && argStr[i] !== '"') { if (argStr[i] === '\\') i++; i++; } }
          if (argStr[i] === '(') { i = balancedEnd(argStr, i, '(', ')') + 1; continue; }
          if (argStr[i] === '[') { i = balancedEnd(argStr, i, '[', ']') + 1; continue; }
          i++;
        }
        i++; // skip comma
        continue;
      }

      const key = argStr.slice(keyStart, i).trim();
      i++; // skip ':'

      // skip whitespace
      while (i < len && /\s/.test(argStr[i])) i++;

      // parse value
      let value = '';
      let valStart = i;

      if (argStr[i] === '"') {
        // string value
        i++;
        let str = '';
        while (i < len && argStr[i] !== '"') {
          if (argStr[i] === '\\') { str += argStr[i + 1]; i += 2; }
          else { str += argStr[i]; i++; }
        }
        i++; // skip closing "
        value = str;
      } else {
        // non-string value — read until comma or end
        while (i < len && argStr[i] !== ',') {
          if (argStr[i] === '(') { const end = balancedEnd(argStr, i, '(', ')'); i = end + 1; continue; }
          if (argStr[i] === '[') { const end = balancedEnd(argStr, i, '[', ']'); i = end + 1; continue; }
          i++;
        }
        value = argStr.slice(valStart, i).trim();
      }

      args[key] = value;

      // skip comma
      while (i < len && (argStr[i] === ',' || /\s/.test(argStr[i]))) i++;
    }

    return args;
  }

  /**
   * Extract body text from bracket content, stripping leading/trailing whitespace
   * and Typst formatting for display.
   */
  function extractBody(src, bracketStart, bracketEnd) {
    // Content between [ and ]
    let body = src.slice(bracketStart + 1, bracketEnd);
    // Trim leading/trailing whitespace lines
    body = body.replace(/^\s*\n/, '').replace(/\n\s*$/, '');
    return body;
  }

  /**
   * Find all elements in the source.
   */
  function parse(src) {
    const elements = [];
    const lines = src.split('\n');

    // Find page boundaries and section names
    const pages = []; // {lineStart, sectionName}
    let currentSection = '';
    let pageNum = 0;

    // Page 1 starts at line 1 (Cover uses #page(...)[...] block)
    pages.push({ lineStart: 1, sectionName: 'Cover', pageNum: 1 });

    // Find end of #page(...)[ ] cover block to mark page 2
    // Match #page( at start of line (not #set page, not #pagebreak)
    const pageBlockMatch = src.match(/^#page\s*\(/m);
    if (pageBlockMatch) {
      const pStart = pageBlockMatch.index;
      const openParen = src.indexOf('(', pStart);
      const pParenEnd = balancedEnd(src, openParen, '(', ')');
      if (pParenEnd !== -1) {
        // Find the [...] content block after the parens
        let si = pParenEnd + 1;
        while (si < src.length && /\s/.test(src[si])) si++;
        if (src[si] === '[') {
          const bracketEnd = balancedEnd(src, si, '[', ']');
          if (bracketEnd !== -1) {
            const coverEndLine = lineAt(src, bracketEnd);
            // Lookahead for fsec.update after cover
            let pageSec = '';
            for (let ahead = coverEndLine; ahead <= coverEndLine + 8 && ahead <= lines.length; ahead++) {
              const aheadMatch = (lines[ahead - 1] || '').trim().match(/#fsec\.update\("([^"]*)"\)/);
              if (aheadMatch) {
                pageSec = aheadMatch[1];
                currentSection = pageSec;
                break;
              }
            }
            pages.push({ lineStart: coverEndLine + 1, sectionName: pageSec || 'Table of Contents', pageNum: 2 });
            // Add the cover block as an editable element (source-only)
            elements.push({
              type: 'page-block',
              title: 'Cover Page',
              args: {},
              body: src.slice(si + 1, bracketEnd),
              lineStart: lineAt(src, pStart),
              lineEnd: coverEndLine,
              bodyLineStart: lineAt(src, si + 1),
              bodyLineEnd: coverEndLine,
              page: 1,
              sourceSlice: src.slice(pStart, bracketEnd + 1),
            });
          }
        }
      }
    }

    for (let li = 0; li < lines.length; li++) {
      const line = lines[li];
      const trimmed = line.trim();

      // Track section names
      const secMatch = trimmed.match(/#fsec\.update\("([^"]*)"\)/);
      if (secMatch) {
        currentSection = secMatch[1];
      }

      // Track page breaks
      if (trimmed.startsWith('#pagebreak(')) {
        pageNum = pages.length + 1;
        // Lookahead: fsec.update usually appears 1-3 lines after pagebreak
        let pageSec = currentSection;
        for (let ahead = 1; ahead <= 4 && li + ahead < lines.length; ahead++) {
          const aheadMatch = lines[li + ahead].trim().match(/#fsec\.update\("([^"]*)"\)/);
          if (aheadMatch) {
            pageSec = aheadMatch[1];
            currentSection = pageSec;
            break;
          }
        }
        pages.push({ lineStart: li + 2, sectionName: pageSec || `Page ${pageNum}`, pageNum });
      }
    }

    // Dynamically find where helper definitions end
    // Scan for the last #let definition of any known helper, then add a buffer
    let definitionEndLine = 30;
    const letDefPat = /#let\s+(ptitle|sintro|tcard|ibox|badge|tabimg|fpg|fsec)\b/g;
    let letM;
    while ((letM = letDefPat.exec(src)) !== null) {
      const defLine = lineAt(src, letM.index);
      // Add 60 lines buffer to cover the entire function body
      definitionEndLine = Math.max(definitionEndLine, defLine + 60);
    }

    // Now find elements using regex + balanced parsing
    const helperPattern = /#?(ptitle|sintro|tcard|ibox)\s*\(/g;
    let match;

    while ((match = helperPattern.exec(src)) !== null) {
      const type = match[1];
      const callStart = match.index;

      // Skip helper definitions (#let ptitle, #let tcard, etc.)
      const lineBegin = src.lastIndexOf('\n', callStart) + 1;
      const lineTxt = src.slice(lineBegin, callStart).trim();
      if (lineTxt.startsWith('#let') || lineTxt.startsWith('//')) continue;
      // Also skip if inside a let definition body
      const ln = lineAt(src, callStart);
      if (ln <= definitionEndLine) continue;

      const parenStart = src.indexOf('(', callStart + type.length);

      if (parenStart === -1) continue;

      // Find balanced closing paren
      const parenEnd = balancedEnd(src, parenStart, '(', ')');
      if (parenEnd === -1) continue;

      // Parse arguments
      const argStr = src.slice(parenStart + 1, parenEnd);
      const args = parseArgs(argStr);

      // Check for trailing content block [...]
      let bodyStart = -1, bodyEnd = -1;
      let searchIdx = parenEnd + 1;

      // For ptitle, the content is inside the parens as a positional arg
      // For others, look for [...] after parens
      if (type !== 'ptitle') {
        // Skip whitespace after paren
        while (searchIdx < src.length && /\s/.test(src[searchIdx])) searchIdx++;

        if (src[searchIdx] === '[') {
          bodyStart = searchIdx;
          bodyEnd = balancedEnd(src, searchIdx, '[', ']');
        }
      }

      const lineStart = lineAt(src, callStart);
      const lineEnd = lineAt(src, bodyEnd !== -1 ? bodyEnd : parenEnd);

      // Determine which page this element is on
      let page = 1;
      for (let p = pages.length - 1; p >= 0; p--) {
        if (lineStart >= pages[p].lineStart) {
          page = p + 1;
          break;
        }
      }

      // Build display title
      let title = '';
      if (type === 'ptitle') {
        // First positional string argument
        const pMatch = argStr.match(/"([^"]*)"/);
        title = pMatch ? pMatch[1] : argStr.trim().replace(/^"(.*)"$/, '$1');
      } else if (type === 'tcard' || type === 'sintro') {
        title = args.title || '';
        // For sintro, first positional arg is title
        if (type === 'sintro' && !title) {
          const pMatch = argStr.match(/"([^"]*)"/);
          title = pMatch ? pMatch[1] : '';
        }
      } else if (type === 'ibox') {
        title = `${(args.type || 'note')} box`;
      }

      const body = bodyStart !== -1 && bodyEnd !== -1
        ? extractBody(src, bodyStart, bodyEnd)
        : '';

      elements.push({
        type,
        title,
        args,
        body,
        lineStart,
        lineEnd,
        bodyLineStart: bodyStart !== -1 ? lineAt(src, bodyStart) : lineStart,
        bodyLineEnd: bodyEnd !== -1 ? lineAt(src, bodyEnd) : lineEnd,
        page,
        sourceSlice: src.slice(callStart, (bodyEnd !== -1 ? bodyEnd : parenEnd) + 1),
      });

      // Advance regex past the entire element to avoid matching inside bodies
      const elementEnd = (bodyEnd !== -1 ? bodyEnd : parenEnd) + 1;
      helperPattern.lastIndex = elementEnd;
    }

    // Find standalone images (not inside helper bodies — approximate)
    const imgPattern = /#image\("([^"]+)"[^)]*\)/g;
    while ((match = imgPattern.exec(src)) !== null) {
      const imgLineStart = lineAt(src, match.index);
      // Skip images inside helper definitions
      if (imgLineStart <= definitionEndLine) continue;

      let page = 1;
      for (let p = pages.length - 1; p >= 0; p--) {
        if (imgLineStart >= pages[p].lineStart) {
          page = p + 1;
          break;
        }
      }

      const pathStr = match[1];
      const filename = pathStr.split('/').pop();

      // Parse width/height from the call
      const args = {};
      const whMatch = match[0].match(/width:\s*([^,)]+)/);
      if (whMatch) args.width = whMatch[1].trim();
      const hMatch = match[0].match(/height:\s*([^,)]+)/);
      if (hMatch) args.height = hMatch[1].trim();
      args.path = pathStr;

      elements.push({
        type: 'image',
        title: filename,
        args,
        body: '',
        lineStart: imgLineStart,
        lineEnd: lineAt(src, match.index + match[0].length - 1),
        bodyLineStart: imgLineStart,
        bodyLineEnd: imgLineStart,
        page,
        sourceSlice: match[0],
      });
    }

    // Sort by line number
    elements.sort((a, b) => a.lineStart - b.lineStart);

    return { pages, elements };
  }

  return { parse, parseArgs, balancedEnd, lineAt };

})();
