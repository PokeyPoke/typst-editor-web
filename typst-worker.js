/**
 * Typst WASM compile worker.
 * Runs as an ES module worker: new Worker('./typst-worker.js', { type: 'module' })
 *
 * Messages in:
 *   { type: 'compile', source, files: [{path, data: ArrayBuffer}] }
 *
 * Messages out:
 *   { type: 'ready' }
 *   { type: 'pdf-result', pdf: ArrayBuffer }
 *   { type: 'error', message }
 *   { type: 'progress', text }
 */

// ── CDN URLs ────────────────────────────────────────
// 0.7.0-rc2 tracks typst ≥ 0.12; same API surface as 0.5.x
const COMPILER_JS   = 'https://cdn.jsdelivr.net/npm/@myriaddreamin/typst-ts-web-compiler@0.7.0-rc2/pkg/typst_ts_web_compiler.mjs';
const COMPILER_WASM = 'https://cdn.jsdelivr.net/npm/@myriaddreamin/typst-ts-web-compiler@0.7.0-rc2/pkg/typst_ts_web_compiler_bg.wasm';

// Typst bundled fonts from the official typst-assets GitHub repo
const FONTS_BASE = 'https://cdn.jsdelivr.net/gh/typst/typst-assets@v0.13.0/files/fonts/';
const TYPST_FONTS = [
  'DejaVuSansMono.ttf',
  'DejaVuSansMono-Bold.ttf',
  'DejaVuSansMono-BoldOblique.ttf',
  'DejaVuSansMono-Oblique.ttf',
  'LibertinusSerif-Bold.otf',
  'LibertinusSerif-BoldItalic.otf',
  'LibertinusSerif-Italic.otf',
  'LibertinusSerif-Regular.otf',
  'LibertinusSerif-Semibold.otf',
  'LibertinusSerif-SemiboldItalic.otf',
  'NewCM10-Bold.otf',
  'NewCM10-BoldItalic.otf',
  'NewCM10-Italic.otf',
  'NewCM10-Regular.otf',
  'NewCMMath-Bold.otf',
  'NewCMMath-Book.otf',
  'NewCMMath-Regular.otf',
];

// Source Sans 3 and Noto Sans from fontsource CDN.
// The document uses "Source Sans 3" as primary, "Noto Sans" as fallback.
const FONTSOURCE_BASE = 'https://cdn.jsdelivr.net/npm/';
const SOURCE_SANS_FONTS = [
  '@fontsource/source-sans-3@5.0.3/files/source-sans-3-latin-300-normal.woff2',
  '@fontsource/source-sans-3@5.0.3/files/source-sans-3-latin-400-normal.woff2',
  '@fontsource/source-sans-3@5.0.3/files/source-sans-3-latin-600-normal.woff2',
  '@fontsource/source-sans-3@5.0.3/files/source-sans-3-latin-700-normal.woff2',
  '@fontsource/source-sans-3@5.0.3/files/source-sans-3-latin-400-italic.woff2',
  '@fontsource/source-sans-3@5.0.3/files/source-sans-3-latin-700-italic.woff2',
];
const NOTO_SANS_FONTS = [
  '@fontsource/noto-sans@5.0.12/files/noto-sans-latin-400-normal.woff2',
  '@fontsource/noto-sans@5.0.12/files/noto-sans-latin-700-normal.woff2',
  '@fontsource/noto-sans@5.0.12/files/noto-sans-latin-400-italic.woff2',
  '@fontsource/noto-sans@5.0.12/files/noto-sans-latin-700-italic.woff2',
];

// ── State ───────────────────────────────────────────
let compiler = null;

// ── Messaging helpers ───────────────────────────────
function postProgress(text)         { self.postMessage({ type: 'progress', text }); }
function postError(message, flags)  { self.postMessage({ type: 'error', message, ...flags }); }
function postReady()                { self.postMessage({ type: 'ready' }); }

// ── Font fetching ────────────────────────────────────
async function fetchFont(url) {
  try {
    const resp = await fetch(url);
    if (!resp.ok) return null;
    return new Uint8Array(await resp.arrayBuffer());
  } catch (_) {
    return null;
  }
}

// ── Compiler init ────────────────────────────────────
async function initCompiler() {
  postProgress('Loading Typst compiler…');
  const mod = await import(COMPILER_JS);
  const typstInit = mod.default;
  const TypstCompilerBuilder = mod.TypstCompilerBuilder;

  postProgress('Loading compiler (WASM)…');
  await typstInit(COMPILER_WASM);

  const builder = new TypstCompilerBuilder();
  builder.set_dummy_access_model();

  postProgress('Downloading fonts (1/3)…');
  let fontCount = 0;
  for (const name of TYPST_FONTS) {
    const buf = await fetchFont(FONTS_BASE + name);
    if (buf) { await builder.add_raw_font(buf); fontCount++; }
  }

  postProgress('Downloading fonts (2/3)…');
  for (const rel of SOURCE_SANS_FONTS) {
    const buf = await fetchFont(FONTSOURCE_BASE + rel);
    if (buf) { await builder.add_raw_font(buf); fontCount++; }
  }

  postProgress('Downloading fonts (3/3)…');
  for (const rel of NOTO_SANS_FONTS) {
    const buf = await fetchFont(FONTSOURCE_BASE + rel);
    if (buf) { await builder.add_raw_font(buf); fontCount++; }
  }

  postProgress('Compiler ready.');
  compiler = await builder.build();
  postReady();
}

// ── Placeholder image helpers ────────────────────────

// Minimal 1×1 gray PNG fallback for environments without OffscreenCanvas
const MINIMAL_PNG = (() => {
  const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQAABjE+ibYAAAAASUVORK5CYII=';
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
})();

// Generate a visible colored placeholder image in the correct format for the path
async function makePlaceholderForPath(path) {
  const ext = (path.split('.').pop() || '').toLowerCase();
  if (ext === 'svg') {
    return new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="60">' +
      '<rect width="100" height="60" fill="#c8d8e8"/>' +
      '<rect x="2" y="2" width="96" height="56" fill="none" stroke="#6699bb" stroke-width="2"/>' +
      '</svg>'
    );
  }
  try {
    const canvas = new OffscreenCanvas(100, 60);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#c8d8e8';
    ctx.fillRect(0, 0, 100, 60);
    ctx.strokeStyle = '#6699bb';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, 98, 58);
    const mime = (ext === 'jpg' || ext === 'jpeg') ? 'image/jpeg' : 'image/png';
    const blob = await canvas.convertToBlob({ type: mime });
    return new Uint8Array(await blob.arrayBuffer());
  } catch (_) {
    return MINIMAL_PNG;
  }
}

// ── Compile ─────────────────────────────────────────
async function doCompile(source, files) {
  if (!compiler) await initCompiler();

  // Rewrite "../foo/bar" → "/foo/bar" in string literals so all paths stay
  // within the virtual root "/". Images are mapped at /images/…
  const compileSrc = source.replace(/"\.\.\/([^"]*)"/g, '"/$1"');

  const extractBytes = (result) => {
    if (result instanceof Uint8Array) return result;
    if (result?.result instanceof Uint8Array) return result.result;
    if (result?.result) return new Uint8Array(result.result);
    return null;
  };

  const formatThrown = (e) => {
    if (e == null) return 'Unknown error';
    if (typeof e === 'string') return e || '(empty error)';
    if (e instanceof Error) return e.message || e.toString();
    const a = toArr(e);
    if (a) {
      // Filter out "failed to load file" errors — handled by placeholder logic
      const errors = a.filter(d => String(d?.severity) === 'Error' &&
                                   !String(d?.message).includes('failed to load file'));
      const allErrors = a.filter(d => String(d?.severity) === 'Error');
      const target = errors.length ? errors : allErrors.length ? allErrors : a;
      return target.map(d => d?.message ? `error: ${d.message}${d.hints?.length ? '\nhint: ' + d.hints[0] : ''}` : String(d)).join('\n');
    }
    const s = String(e);
    return (s && s !== '[object Object]') ? s : JSON.stringify(e);
  };

  // Handle WASM iterables that may not pass Array.isArray (wasm-bindgen Vec<T>)
  const toArr = (e) => {
    if (Array.isArray(e)) return e;
    if (e && typeof e === 'object' && typeof e[Symbol.iterator] === 'function') {
      try { return [...e]; } catch (_) {}
    }
    return null;
  };

  const isTypstDiagnostics = (e) => {
    const a = toArr(e);
    return a !== null && a.length > 0 && a[0]?.message !== undefined;
  };

  const isMissingFileError = (e) => {
    const check = s => typeof s === 'string' && s.includes('failed to load file');
    const a = toArr(e);
    if (a) return a.some(d => check(d?.message));
    if (e instanceof Error) return check(e.message);
    return check(String(e));
  };

  // ── The WASM dummy access model logs the actual file path to console.error
  // in the format: "...read_all failure <path> Error: Dummy AccessModel..."
  // Intercept console.error to capture these paths, since the SourceDiagnostic
  // message only says "failed to load file (access denied)" with no path.
  const capturedMissing = new Set();
  const origConsoleError = console.error;
  console.error = (...args) => {
    const msg = args.map(a => typeof a === 'string' ? a : '').join(' ');
    const m = msg.match(/read_all failure\s+(.+?)\s+Error:/);
    if (m) capturedMissing.add(m[1].trim());
    origConsoleError.apply(console, args);
  };

  const placeholders = new Map();
  const providedSet = new Set((files || []).map(f => f.path));

  // Pre-scan: map placeholders for all literal image paths in source before
  // the first compile attempt. This handles direct #image("path") references
  // without needing any retries.
  const litPat = /"(\/[^"]+\.(?:png|jpg|jpeg|gif|svg|webp))"/gi;
  for (const [, p] of compileSrc.matchAll(litPat)) {
    if (!providedSet.has(p) && !placeholders.has(p)) {
      placeholders.set(p, await makePlaceholderForPath(p));
    }
  }

  const MAX_ROUNDS = 30;

  try {
    for (let round = 0; round <= MAX_ROUNDS; round++) {
      capturedMissing.clear();

      // Reset virtual filesystem
      try { compiler.reset(); } catch (_) {
        try { compiler.reset_shadow(); } catch (_2) { /* ignore */ }
      }

      compiler.add_source('/main.typ', compileSrc);

      for (const f of files || []) {
        try { compiler.map_shadow(f.path, new Uint8Array(f.data)); }
        catch (e) { origConsoleError('[typst-worker] Failed to map file', f.path, e); }
      }

      for (const [path, data] of placeholders) {
        try { compiler.map_shadow(path, data); } catch (_) {}
      }

      let pdfBytes = null;
      let diagnostics = null;

      try {
        const result = compiler.compile('/main.typ', undefined, 'pdf', 1);
        pdfBytes = extractBytes(result);
        diagnostics = result?.diagnostics ?? null;
      } catch (compileErr) {
        // Check whether console.error captured any new missing-file paths
        const newPaths = [...capturedMissing].filter(p => !placeholders.has(p));
        if (newPaths.length > 0) {
          for (const p of newPaths) {
            placeholders.set(p, await makePlaceholderForPath(p));
          }
          continue; // retry with placeholders mapped
        }

        // No new paths captured — check if it's a pure missing-file diagnostic
        // (can happen if the WASM doesn't log, e.g. a non-image access error)
        if (isMissingFileError(compileErr) && isTypstDiagnostics(compileErr)) {
          throw new Error(formatThrown(compileErr));
        }

        if (isTypstDiagnostics(compileErr)) {
          throw new Error(formatThrown(compileErr));
        }

        // Fallback: snapshot → get_artifact('pdf', 1)
        try {
          const world = compiler.snapshot(undefined, '/main.typ', undefined);
          const result = world.get_artifact('pdf', 1);
          if (typeof world.free === 'function') world.free();
          pdfBytes = extractBytes(result);
          diagnostics = result?.diagnostics ?? null;
        } catch (snapshotErr) {
          throw new Error(formatThrown(compileErr) + '\n---\n' + formatThrown(snapshotErr));
        }
      }

      if (!pdfBytes || pdfBytes.length === 0) {
        const diagMsg = diagnostics ? JSON.stringify(diagnostics) : 'no output';
        throw new Error('Compilation produced no PDF output. ' + diagMsg);
      }

      return { pdfBytes, diagnostics, placeholderCount: placeholders.size };
    }

    throw new Error('Compilation aborted: too many missing files.');
  } finally {
    console.error = origConsoleError;
  }
}

// ── Message handler ──────────────────────────────────
self.onmessage = async (e) => {
  const msg = e.data;

  if (msg.type === 'init') {
    try {
      await initCompiler();
    } catch (err) {
      postError(err.message);
    }
    return;
  }

  if (msg.type === 'compile') {
    try {
      const { pdfBytes, diagnostics, placeholderCount } = await doCompile(msg.source, msg.files || []);
      const buf = pdfBytes.buffer.slice(
        pdfBytes.byteOffset,
        pdfBytes.byteOffset + pdfBytes.byteLength
      );
      self.postMessage({ type: 'pdf-result', pdf: buf, placeholderCount }, [buf]);

      if (diagnostics?.length) {
        console.warn('[typst-worker] Diagnostics:', diagnostics);
      }
    } catch (err) {
      postError(err.message);
    }
  }
};
