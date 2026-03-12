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
const EXTRA_FONTS = [
  '@fontsource/source-sans-3@5.0.3/files/source-sans-3-latin-300-normal.woff2',
  '@fontsource/source-sans-3@5.0.3/files/source-sans-3-latin-400-normal.woff2',
  '@fontsource/source-sans-3@5.0.3/files/source-sans-3-latin-600-normal.woff2',
  '@fontsource/source-sans-3@5.0.3/files/source-sans-3-latin-700-normal.woff2',
  '@fontsource/source-sans-3@5.0.3/files/source-sans-3-latin-400-italic.woff2',
  '@fontsource/source-sans-3@5.0.3/files/source-sans-3-latin-700-italic.woff2',
  '@fontsource/noto-sans@5.0.12/files/noto-sans-latin-400-normal.woff2',
  '@fontsource/noto-sans@5.0.12/files/noto-sans-latin-700-normal.woff2',
  '@fontsource/noto-sans@5.0.12/files/noto-sans-latin-400-italic.woff2',
  '@fontsource/noto-sans@5.0.12/files/noto-sans-latin-700-italic.woff2',
];

// ── State ───────────────────────────────────────────
let compiler = null;

// ── Messaging helpers ───────────────────────────────
function postProgress(text)  { self.postMessage({ type: 'progress', text }); }
function postError(message)  { self.postMessage({ type: 'error', message }); }
function postReady()         { self.postMessage({ type: 'ready' }); }

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

  postProgress('Initialising WASM…');
  await typstInit(COMPILER_WASM);

  const builder = new TypstCompilerBuilder();
  builder.set_dummy_access_model();

  postProgress('Loading fonts (typst defaults)…');
  let fontCount = 0;
  for (const name of TYPST_FONTS) {
    const buf = await fetchFont(FONTS_BASE + name);
    if (buf) { await builder.add_raw_font(buf); fontCount++; }
  }

  postProgress('Loading fonts (Source Sans 3 & Noto Sans)…');
  for (const rel of EXTRA_FONTS) {
    const buf = await fetchFont(FONTSOURCE_BASE + rel);
    if (buf) { await builder.add_raw_font(buf); fontCount++; }
  }

  postProgress(`Building compiler (${fontCount} fonts loaded)…`);
  compiler = await builder.build();
  postReady();
}

// ── Compile ─────────────────────────────────────────
async function doCompile(source, files) {
  if (!compiler) await initCompiler();

  // Reset virtual filesystem
  try { compiler.reset(); } catch (_) {
    try { compiler.reset_shadow(); } catch (_2) { /* ignore */ }
  }

  // Add main source file
  compiler.add_source('/main.typ', source);

  // Add binary files (images, etc.)
  for (const f of files || []) {
    try {
      compiler.map_shadow(f.path, new Uint8Array(f.data));
    } catch (e) {
      console.warn('[typst-worker] Failed to map file', f.path, e);
    }
  }

  // Compile to PDF. The return value varies by version:
  // - Uint8Array directly, OR { result: Uint8Array, diagnostics: [...] }
  let pdfBytes = null;
  let diagnostics = null;

  const extractBytes = (result) => {
    if (result instanceof Uint8Array) return result;
    if (result?.result instanceof Uint8Array) return result.result;
    if (result?.result) return new Uint8Array(result.result);
    return null;
  };

  // Format a thrown value into a human-readable error string.
  // The WASM compiler throws an Array of SourceDiagnostic objects on Typst errors.
  const formatThrown = (e) => {
    if (e == null) return 'Unknown error';
    if (typeof e === 'string') return e || '(empty error)';
    if (e instanceof Error) return e.message || e.toString();
    // Array of SourceDiagnostic — extract only Error-severity messages
    if (Array.isArray(e)) {
      const errors = e.filter(d => String(d?.severity) === 'Error');
      const target = errors.length ? errors : e;
      return target.map(d => d?.message ? `error: ${d.message}${d.hints?.length ? '\nhint: ' + d.hints[0] : ''}` : String(d)).join('\n');
    }
    const s = String(e);
    return (s && s !== '[object Object]') ? s : JSON.stringify(e);
  };

  // When the WASM compiler throws an Array of SourceDiagnostic, that IS the
  // compile error — the fallback path will get the identical diagnostics, so
  // skip it and surface the Typst errors directly.
  const isTypstDiagnostics = (e) => Array.isArray(e) && e.length > 0 && e[0]?.message !== undefined;

  try {
    const result = compiler.compile('/main.typ', undefined, 'pdf', 1);
    pdfBytes = extractBytes(result);
    diagnostics = result?.diagnostics ?? null;
  } catch (compileErr) {
    if (isTypstDiagnostics(compileErr)) {
      throw new Error(formatThrown(compileErr));
    }
    console.error('[typst-worker] compile() threw:', compileErr);
    // Fallback: snapshot → get_artifact('pdf', 1)
    try {
      const world = compiler.snapshot(undefined, '/main.typ', undefined);
      const result = world.get_artifact('pdf', 1);
      if (typeof world.free === 'function') world.free();
      pdfBytes = extractBytes(result);
      diagnostics = result?.diagnostics ?? null;
    } catch (snapshotErr) {
      console.error('[typst-worker] snapshot() threw:', snapshotErr);
      throw new Error(formatThrown(compileErr) + '\n---\n' + formatThrown(snapshotErr));
    }
  }

  if (!pdfBytes || pdfBytes.length === 0) {
    const diagMsg = diagnostics ? JSON.stringify(diagnostics) : 'no output';
    throw new Error('Compilation produced no PDF output. ' + diagMsg);
  }

  return { pdfBytes, diagnostics };
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
      const { pdfBytes, diagnostics } = await doCompile(msg.source, msg.files || []);
      // Transfer the ArrayBuffer to avoid copying
      const buf = pdfBytes.buffer.slice(
        pdfBytes.byteOffset,
        pdfBytes.byteOffset + pdfBytes.byteLength
      );
      self.postMessage({ type: 'pdf-result', pdf: buf }, [buf]);

      if (diagnostics?.length) {
        console.warn('[typst-worker] Diagnostics:', diagnostics);
      }
    } catch (err) {
      postError(err.message);
    }
  }
};
