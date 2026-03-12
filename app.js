/**
 * Typst Visual Element Editor — static/browser version.
 * No server. Compiles via typst WASM worker, renders via PDF.js.
 */

// ── PDF.js (ESM) ────────────────────────────────────
import * as pdfjsLib from 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.9.155/build/pdf.min.mjs';
pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.9.155/build/pdf.worker.min.mjs';

// ── State ──────────────────────────────────────────
let source = '';
let filename = 'document.typ';
let parsed = { pages: [], elements: [] };
let selectedElement = null;
let revision = 0;
let currentPdfBytes = null;
let imageFiles = {};      // path → ArrayBuffer

// Undo history
let sourceHistory = [];
const MAX_HISTORY = 20;

// Typst WASM worker
let worker = null;

// ── DOM refs ───────────────────────────────────────
const landingEl          = document.getElementById('landing');
const appEl              = document.getElementById('app');
const treeContainer      = document.getElementById('tree-container');
const svgContainer       = document.getElementById('svg-container');
const editContainer      = document.getElementById('edit-container');
const fileInput          = document.getElementById('file-input');
const imgInput           = document.getElementById('img-input');
const imgCount           = document.getElementById('img-count');
const dropZone           = document.getElementById('drop-zone');
const landingStatus      = document.getElementById('landing-status');
const fileInfo           = document.getElementById('file-info');
const compileBanner      = document.getElementById('compile-banner');
const compileStatus      = document.getElementById('compile-status');
const errorPanel         = document.getElementById('compile-error-panel');
const errorText          = document.getElementById('compile-error-text');
const previewPlaceholder = document.getElementById('preview-placeholder');
const previewPanel       = document.getElementById('preview-panel');
const btnDlTyp           = document.getElementById('btn-download-typ');
const btnDlPdf           = document.getElementById('btn-download-pdf');
const btnAddImages       = document.getElementById('btn-add-images');
const btnOpenFile        = document.getElementById('btn-open-file');

// ── Worker init ────────────────────────────────────

function initWorker() {
  worker = new Worker('./typst-worker.js', { type: 'module' });

  worker.onmessage = (e) => {
    const msg = e.data;

    if (msg.type === 'ready') {
      setCompileStatus('');
    }

    if (msg.type === 'progress') {
      setCompileStatus(msg.text);
    }

    if (msg.type === 'pdf-result') {
      currentPdfBytes = new Uint8Array(msg.pdf);
      btnDlPdf.disabled = false;
      setCompileStatus('');
      compileBanner.style.display = 'none';
      errorPanel.style.display = 'none';
      renderPdfPages(currentPdfBytes).catch(err => {
        showToast('Render error: ' + err.message, 'error');
      });
    }

    if (msg.type === 'error') {
      setCompileStatus('');
      compileBanner.style.display = 'none';
      if (previewPlaceholder) previewPlaceholder.style.display = 'none';
      errorPanel.style.display = '';
      errorText.textContent = msg.message;
      showToast('Compile error — see error panel', 'error');
      console.error('Worker error:', msg.message);
    }
  };

  worker.onerror = (e) => {
    showToast('Worker crashed: ' + e.message, 'error');
  };
}

function setCompileStatus(text) {
  if (text) {
    compileBanner.style.display = '';
    compileStatus.textContent = text;
  } else {
    compileBanner.style.display = 'none';
    compileStatus.textContent = '';
  }
}

// ── Landing ────────────────────────────────────────

function showSessionBannerIfNeeded() {
  const banner = document.getElementById('session-banner');
  const session = getTextSession();
  if (!session) {
    banner.style.display = 'none';
    return;
  }

  document.getElementById('session-filename').textContent = session.filename;
  document.getElementById('session-age').textContent = timeAgo(session.savedAt);
  const ic = session.imageCount || 0;
  document.getElementById('session-imgs').textContent =
    ic > 0 ? ` · ${ic} image${ic !== 1 ? 's' : ''}` : '';
  banner.style.display = '';

  // Clone buttons to remove any stale listeners from a previous call
  const btnResume  = document.getElementById('btn-resume-session');
  const btnDiscard = document.getElementById('btn-discard-session');
  const freshResume  = btnResume.cloneNode(true);
  const freshDiscard = btnDiscard.cloneNode(true);
  btnResume.replaceWith(freshResume);
  btnDiscard.replaceWith(freshDiscard);

  freshResume.addEventListener('click', async () => {
    banner.style.display = 'none';
    setLandingStatus('Restoring session…');
    const imgs = await loadImagesFromIDB();
    imageFiles = imgs;
    const uniqueCount = Object.keys(imageFiles).filter(k => !k.includes('/')).length;
    if (uniqueCount > 0) {
      imgCount.textContent = `${uniqueCount} image${uniqueCount !== 1 ? 's' : ''} loaded`;
    }
    enterEditor(session.source, session.filename);
    if (uniqueCount > 0) {
      showToast(`Session restored — ${uniqueCount} image${uniqueCount !== 1 ? 's' : ''} reloaded`, 'success');
    } else {
      showToast('Session restored', 'success');
    }
  });

  freshDiscard.addEventListener('click', () => {
    if (!confirm(
      `Permanently discard the saved session for "${session.filename}"?\n\nThis cannot be undone.`
    )) return;
    clearTextSession();
    clearIDB();
    banner.style.display = 'none';
  });
}

function setupLanding() {
  // Tab switching
  const tabOpen = document.getElementById('tab-open');
  const tabNew  = document.getElementById('tab-new');
  const panelOpen = document.getElementById('panel-open');
  const panelNew  = document.getElementById('panel-new');

  tabOpen.addEventListener('click', () => {
    tabOpen.classList.add('active'); tabNew.classList.remove('active');
    panelOpen.style.display = ''; panelNew.style.display = 'none';
    setLandingStatus('');
  });
  tabNew.addEventListener('click', () => {
    tabNew.classList.add('active'); tabOpen.classList.remove('active');
    panelNew.style.display = ''; panelOpen.style.display = 'none';
    setLandingStatus('');
  });

  // Session restore banner
  showSessionBannerIfNeeded();

  // Open existing: file load
  document.getElementById('btn-load-typ').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) loadTypFile(fileInput.files[0]);
  });

  imgInput.addEventListener('change', () => {
    loadImageFiles(imgInput.files);
  });

  // Open existing: drag-and-drop
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const files = Array.from(e.dataTransfer.files);
    const typFile = files.find(f => f.name.endsWith('.typ'));
    const imgFiles = files.filter(f =>
      f.type.startsWith('image/') || /\.(png|jpe?g|gif|svg|webp|bmp)$/i.test(f.name)
    );
    if (typFile) {
      loadTypFile(typFile);
    } else if (imgFiles.length > 0) {
      loadImageFiles(imgFiles);
      setLandingStatus(`${imgFiles.length} image${imgFiles.length !== 1 ? 's' : ''} loaded. Now load or drop a .typ file.`);
    } else {
      setLandingStatus('Please drop a .typ file or image files.', true);
    }
  });

  // Template picker
  buildTemplatePicker();
}

// ── Template picker ────────────────────────────────

let selectedTemplateId = null;

function buildTemplatePicker() {
  const picker = document.getElementById('template-picker');
  picker.innerHTML = '';

  for (const tpl of Templates.TEMPLATES) {
    const card = document.createElement('div');
    card.className = 'tpl-card';
    card.dataset.id = tpl.id;
    card.innerHTML = `
      <div class="tpl-abbr">${tpl.abbr}</div>
      <div class="tpl-info">
        <div class="tpl-name">${tpl.name}</div>
        <div class="tpl-desc">${tpl.description}</div>
      </div>`;
    card.addEventListener('click', () => openTemplateForm(tpl.id));
    picker.appendChild(card);
  }
}

function openTemplateForm(templateId) {
  selectedTemplateId = templateId;
  const tpl = Templates.TEMPLATES.find(t => t.id === templateId);
  if (!tpl) return;

  document.getElementById('template-picker').style.display = 'none';
  const formWrap = document.getElementById('template-form-wrap');
  formWrap.style.display = '';

  const formEl = document.getElementById('template-form');
  formEl.innerHTML = `<div class="tpl-form-title">${tpl.name}</div>`;

  // Track input refs by field id
  const inputs = {};

  for (const field of tpl.fields) {
    if (field.type === 'section-list') continue; // rendered dynamically below

    const div = document.createElement('div');
    div.className = 'edit-field';
    div.innerHTML = `<label>${field.label}</label>`;

    if (field.type === 'color') {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:8px;align-items:center';
      const cp = document.createElement('input');
      cp.type = 'color'; cp.value = field.default || '#0071c0';
      cp.id = 'tpl-' + field.id;
      const hex = document.createElement('input');
      hex.type = 'text'; hex.value = field.default || '#0071c0';
      hex.style.cssText = 'width:100px;font-family:monospace';
      hex.maxLength = 7;
      cp.addEventListener('input', () => { hex.value = cp.value; });
      hex.addEventListener('input', () => { if (/^#[0-9a-f]{6}$/i.test(hex.value)) cp.value = hex.value; });
      row.appendChild(cp); row.appendChild(hex);
      div.appendChild(row);
      inputs[field.id] = { getValue: () => cp.value };
    } else if (field.type === 'number') {
      const inp = document.createElement('input');
      inp.type = 'number';
      inp.value = field.default || '1';
      inp.min = field.min ?? 1;
      inp.max = field.max ?? 99;
      inp.style.width = '80px';
      inp.id = 'tpl-' + field.id;
      div.appendChild(inp);
      inputs[field.id] = { getValue: () => inp.value, el: inp };

      // If this field has a dependent section-list, wire the update
      const depField = tpl.fields.find(f => f.type === 'section-list' && f.dependsOn === field.id);
      if (depField) {
        inp.addEventListener('input', () => renderSectionList(formEl, inputs, depField, parseInt(inp.value) || 1));
      }
    } else {
      const inp = document.createElement('input');
      inp.type = 'text';
      inp.value = field.default || '';
      if (field.placeholder) inp.placeholder = field.placeholder;
      inp.id = 'tpl-' + field.id;
      div.appendChild(inp);
      inputs[field.id] = { getValue: () => inp.value };
    }

    formEl.appendChild(div);

    // Render initial section list if this field drives one
    const depField = tpl.fields.find(f => f.type === 'section-list' && f.dependsOn === field.id);
    if (depField) {
      renderSectionList(formEl, inputs, depField, parseInt(field.default) || 1);
    }
  }

  // Store inputs reference for "Create" button
  formEl._inputs = inputs;
  formEl._tplId  = templateId;

  document.getElementById('btn-back-picker').onclick = () => {
    formWrap.style.display = 'none';
    document.getElementById('template-picker').style.display = '';
    setLandingStatus('');
  };

  document.getElementById('btn-create-doc').onclick = () => createFromTemplate(formEl);
}

function renderSectionList(formEl, inputs, field, count) {
  const containerId = 'tpl-seclist-' + field.id;
  let container = formEl.querySelector('#' + containerId);
  if (!container) {
    container = document.createElement('div');
    container.id = containerId;
    formEl.appendChild(container);
  }
  container.innerHTML = `<div class="field-group-header">${field.label}</div>`;

  const nameInputs = [];
  for (let i = 0; i < count; i++) {
    const div = document.createElement('div');
    div.className = 'edit-field';
    div.innerHTML = `<label>Section ${i + 1}</label>`;
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.value = `Section ${i + 1}`;
    inp.placeholder = `Section ${i + 1} name`;
    div.appendChild(inp);
    container.appendChild(div);
    nameInputs.push(inp);
  }

  inputs[field.id] = { getValue: () => nameInputs.map(i => i.value || i.placeholder) };
}

function createFromTemplate(formEl) {
  const tplId  = formEl._tplId;
  const inputs = formEl._inputs || {};

  const values = {};
  for (const [key, ctrl] of Object.entries(inputs)) {
    values[key] = ctrl.getValue();
  }

  let src;
  try {
    src = Templates.generate(tplId, values);
  } catch (e) {
    setLandingStatus('Template error: ' + e.message, true);
    return;
  }

  const fname = (values.filename || (tplId + '.typ')).replace(/\.typ$/, '') + '.typ';
  setLandingStatus('Starting compiler…');
  enterEditor(src, fname);
}

function setLandingStatus(text, isError) {
  landingStatus.textContent = text;
  landingStatus.className = 'landing-status' + (isError ? ' error' : '');
}

// ── File loading ───────────────────────────────────

function enterEditor(src, fname) {
  filename = fname || 'document.typ';
  source = src;
  sourceHistory = [];
  parsed = TypstParser.parse(source);
  saveTextSession();
  showEditor();
  initWorker();
  triggerCompile();
}

function loadTypFile(file) {
  filename = file.name;
  setLandingStatus('Reading file…');
  const reader = new FileReader();
  reader.onload = (e) => {
    setLandingStatus('Starting compiler…');
    enterEditor(e.target.result, file.name);
  };
  reader.onerror = () => setLandingStatus('Failed to read file.', true);
  reader.readAsText(file);
}

async function loadImageFiles(files) {
  const loaded = [];
  for (const f of files) {
    const buf = await f.arrayBuffer();
    const name = f.name;
    // Store at the absolute path typst resolves to from /main.typ:
    // #image("../images/TechUI/processed/foo.png") → /images/TechUI/processed/foo.png
    imageFiles[`/images/TechUI/processed/${name}`] = buf;
    // Also store by bare filename for robustness
    imageFiles[name] = buf;
    loaded.push(name);
  }
  // Count unique files by bare filename (not path variants)
  const uniqueCount = Object.keys(imageFiles).filter(k => !k.includes('/')).length;
  imgCount.textContent = `${uniqueCount} image${uniqueCount !== 1 ? 's' : ''} loaded`;
  saveTextSession();
  saveImagesToIDB();
  if (appEl.style.display !== 'none') {
    showToast(`Loaded ${loaded.length} image${loaded.length !== 1 ? 's' : ''}`, 'success');
    triggerCompile();
  }
}

function showEditor() {
  landingEl.style.display = 'none';
  appEl.style.display = 'flex';
  fileInfo.textContent = filename;
  svgContainer.innerHTML = '';
  buildTree();
  editContainer.innerHTML = '<p class="placeholder">Select an element from the tree to edit its properties.</p>';
  errorPanel.style.display = 'none';
  btnDlPdf.disabled = true;
  if (previewPlaceholder) previewPlaceholder.style.display = '';
}

function openDifferentFile() {
  if (source && !confirm(
    `Close "${filename}" and return to the start page?\n\n` +
    `Your work is auto-saved and can be resumed from the landing page.`
  )) return;
  if (worker) { worker.terminate(); worker = null; }
  source = '';
  filename = 'document.typ';
  parsed = { pages: [], elements: [] };
  selectedElement = null;
  currentPdfBytes = null;
  imageFiles = {};
  sourceHistory = [];
  imgCount.textContent = '';
  btnDlPdf.disabled = true;
  // Reset inputs so the same file can be re-selected
  fileInput.value = '';
  imgInput.value = '';
  appEl.style.display = 'none';
  landingEl.style.display = '';
  setLandingStatus('');
  // Show the resume banner for the session we just left
  showSessionBannerIfNeeded();
}

// ── Compile ────────────────────────────────────────

let compileDebounceTimer = null;

function triggerCompile() {
  clearTimeout(compileDebounceTimer);
  compileDebounceTimer = setTimeout(doCompile, 300);
}

function doCompile() {
  if (!worker) return;
  setCompileStatus('Compiling…');
  compileBanner.style.display = '';

  // Copy ArrayBuffers — do NOT transfer them (would detach originals)
  const files = Object.entries(imageFiles).map(([path, data]) => ({
    path,
    data: data.slice(0),
  }));

  worker.postMessage({ type: 'compile', source, files });
}

// ── PDF.js page rendering ──────────────────────────

async function renderPdfPages(pdfBytes) {
  // PDF.js uses 72pt/inch. A4 = 595pt wide. Scale to ~500px to match SVG cards.
  const SCALE = 500 / 595;

  // Remember where we are before wiping the container
  const returnToPage = selectedElement?.page ?? null;
  const savedScrollTop = previewPanel.scrollTop;

  const loadTask = pdfjsLib.getDocument({
    data: pdfBytes,
    disableRange: true,
    disableStream: true,
  });
  const pdf = await loadTask.promise;

  svgContainer.innerHTML = '';
  if (previewPlaceholder) previewPlaceholder.style.display = 'none';

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: SCALE });

    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    canvas.style.display = 'block';

    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport }).promise;
    page.cleanup();

    const pageDiv = document.createElement('div');
    pageDiv.className = 'svg-page';
    pageDiv.dataset.page = i;
    pageDiv.appendChild(canvas);

    const label = document.createElement('div');
    label.className = 'svg-page-label';
    const pageSec = parsed.pages[i - 1];
    label.textContent = `Page ${i}` + (pageSec ? ` — ${pageSec.sectionName}` : '');
    pageDiv.appendChild(label);

    pageDiv.addEventListener('click', (e) => handlePageClick(i, e, pageDiv));
    svgContainer.appendChild(pageDiv);
  }

  // Restore position after render
  if (returnToPage !== null) {
    const pageDiv = svgContainer.querySelector(`.svg-page[data-page="${returnToPage}"]`);
    if (pageDiv) {
      pageDiv.classList.add('active');
      pageDiv.scrollIntoView({ behavior: 'instant', block: 'start' });
    }
  } else {
    previewPanel.scrollTop = savedScrollTop;
  }
}

// ── Tree building ──────────────────────────────────
function buildTree() {
  treeContainer.innerHTML = '';

  const sections = new Map();
  for (const page of parsed.pages) {
    const key = `p${page.pageNum}`;
    if (!sections.has(key)) {
      sections.set(key, { name: page.sectionName, pageNum: page.pageNum, elements: [] });
    }
  }

  for (const el of parsed.elements) {
    const key = `p${el.page}`;
    if (sections.has(key)) {
      sections.get(key).elements.push(el);
    } else {
      sections.set(key, { name: `Page ${el.page}`, pageNum: el.page, elements: [el] });
    }
  }

  for (const [, sec] of sections) {
    const sectionDiv = document.createElement('div');
    sectionDiv.className = 'tree-section';

    const header = document.createElement('div');
    header.className = 'tree-section-header';

    const arrow = document.createElement('span');
    arrow.className = 'arrow';
    arrow.textContent = '▼';
    arrow.title = 'Collapse/expand';

    const nameSpan = document.createElement('span');
    nameSpan.textContent = sec.name;

    header.appendChild(arrow);
    header.appendChild(nameSpan);

    // Arrow click → toggle collapse only
    arrow.addEventListener('click', (e) => {
      e.stopPropagation();
      header.classList.toggle('collapsed');
    });
    // Header (section name) click → scroll to page only
    header.addEventListener('click', () => {
      scrollToPage(sec.pageNum);
    });

    sectionDiv.appendChild(header);

    const items = document.createElement('div');
    items.className = 'tree-section-items';

    for (const el of sec.elements) {
      const item = document.createElement('div');
      item.className = 'tree-item';
      item.dataset.lineStart = el.lineStart;

      const badge = document.createElement('span');
      badge.className = 'type-badge' + (el.type === 'page-block' ? ' badge-page' : '');
      badge.textContent = el.type === 'page-block' ? 'cover' : el.type;
      item.appendChild(badge);

      const name = document.createElement('span');
      name.textContent = el.title || `(line ${el.lineStart})`;
      name.style.overflow = 'hidden';
      name.style.textOverflow = 'ellipsis';
      item.appendChild(name);

      item.addEventListener('click', (e) => {
        e.stopPropagation();
        selectElement(el, item);
      });
      items.appendChild(item);
    }

    const addItem = document.createElement('div');
    addItem.className = 'tree-item tree-item-add';
    addItem.textContent = '+ Add element';
    addItem.addEventListener('click', (e) => {
      e.stopPropagation();
      showInsertForm(sec.pageNum);
    });
    items.appendChild(addItem);

    sectionDiv.appendChild(items);
    treeContainer.appendChild(sectionDiv);
  }
}

function showInsertForm(pageNum) {
  treeContainer.querySelectorAll('.tree-item.selected').forEach(i => i.classList.remove('selected'));
  editContainer.innerHTML = '';
  const form = EditorPanel.buildInsertForm(pageNum, insertElement);
  editContainer.appendChild(form);
  scrollToPage(pageNum);
}

// ── Element selection ──────────────────────────────
function selectElement(el, treeItem) {
  treeContainer.querySelectorAll('.tree-item.selected').forEach(i => i.classList.remove('selected'));
  svgContainer.querySelectorAll('.svg-page.active').forEach(p => p.classList.remove('active'));

  if (treeItem) treeItem.classList.add('selected');
  selectedElement = el;

  const pageDiv = svgContainer.querySelector(`.svg-page[data-page="${el.page}"]`);
  if (pageDiv) {
    pageDiv.classList.add('active');
    pageDiv.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  const srcLines = source.split('\n');
  el._srcLines = {
    before: el.lineStart > 1 ? srcLines[el.lineStart - 2] : '',
    after: el.lineEnd < srcLines.length ? srcLines[el.lineEnd] : '',
  };

  editContainer.innerHTML = '';
  const pageElements = parsed.elements.filter(e => e.page === el.page);
  const form = EditorPanel.buildForm(el, applyEdit, pageElements);
  editContainer.appendChild(form);
}

function scrollToPage(pageNum) {
  const pageDiv = svgContainer.querySelector(`.svg-page[data-page="${pageNum}"]`);
  if (pageDiv) pageDiv.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function handlePageClick(pageNum, event, pageDiv) {
  svgContainer.querySelectorAll('.svg-page.active').forEach(p => p.classList.remove('active'));
  pageDiv.classList.add('active');
}

// ── Undo history ───────────────────────────────────

function pushHistory() {
  sourceHistory.push(source);
  if (sourceHistory.length > MAX_HISTORY) sourceHistory.shift();
}

function undoEdit() {
  if (sourceHistory.length === 0) {
    showToast('Nothing to undo', 'info');
    return;
  }
  source = sourceHistory.pop();
  revision++;
  saveTextSession();
  parsed = TypstParser.parse(source);
  buildTree();
  triggerCompile();
  editContainer.innerHTML = '<p class="placeholder">Undone. Select an element to continue editing.</p>';
  showToast(`Undone (${sourceHistory.length} step${sourceHistory.length !== 1 ? 's' : ''} remaining)`, 'success');
}

// ── Apply edit ─────────────────────────────────────
function applyEdit(el, changes) {
  let newText;
  let lineStart = el.lineStart;
  let lineEnd = el.lineEnd;

  const spacingDirty = 'v_space_before' in changes || 'v_space_after' in changes;
  if (spacingDirty) {
    const srcLines = source.split('\n');
    const vPat = /^\s*#?v\([^)]+\),?\s*$/;
    if (lineStart > 1 && vPat.test(srcLines[lineStart - 2])) lineStart--;
    if (lineEnd < srcLines.length && vPat.test(srcLines[lineEnd]))  lineEnd++;
  }

  if (changes.__delete) {
    newText = '';
  } else if (changes.__raw) {
    newText = changes.__raw;
  } else {
    if (Object.keys(changes).length === 0) {
      showToast('No changes to apply', 'info');
      return;
    }
    try {
      newText = buildNewSource(el, changes, lineStart, lineEnd);
    } catch (e) {
      showToast('Error building edit: ' + e.message, 'error');
      return;
    }
  }

  pushHistory();

  const lines = source.split('\n');
  const before = lines.slice(0, lineStart - 1);
  const after  = lines.slice(lineEnd);
  const replacement = newText !== '' ? newText.split('\n') : [];
  source = [...before, ...replacement, ...after].join('\n');
  revision++;
  saveTextSession();

  // If a ptitle title changed, sync the matching #fsec.update() and TOC entries
  let syncedExtra = false;
  if (el.type === 'ptitle' && '_title' in changes && el.title !== changes._title) {
    const oldT = el.title;
    const newT = changes._title;

    // 1. Update all #fsec.update("old title") occurrences globally (drives footer)
    const fsecPat = new RegExp('#fsec\\.update\\("' + escRx(oldT) + '"\\)', 'g');
    source = source.replace(fsecPat, `#fsec.update("${escTyp(newT)}")`);

    // 2. Update TOC text: replace "old title" as a string literal in every line
    //    that appears before this element's original position (TOC is always earlier)
    const srcLines = source.split('\n');
    const quotedOld = `"${escTyp(oldT)}"`;
    const quotedNew = `"${escTyp(newT)}"`;
    for (let i = 0; i < el.lineStart - 1; i++) {
      if (srcLines[i].includes(quotedOld)) {
        srcLines[i] = srcLines[i].replaceAll(quotedOld, quotedNew);
        syncedExtra = true;
      }
    }
    source = srcLines.join('\n');
  }

  parsed = TypstParser.parse(source);
  const toastMsg = changes.__delete
    ? 'Element deleted'
    : syncedExtra
      ? 'Applied — TOC and footer updated to match'
      : 'Applied successfully';
  showToast(toastMsg, 'success');

  buildTree();
  triggerCompile();

  if (!changes.__delete) {
    // Re-select by type + proximity (line numbers may shift slightly after edits)
    const newEl = parsed.elements.find(e =>
      e.type === el.type && Math.abs(e.lineStart - el.lineStart) <= 5
    );
    if (newEl) {
      const treeItem = treeContainer.querySelector(`.tree-item[data-line-start="${newEl.lineStart}"]`);
      selectElement(newEl, treeItem);
    }
  } else {
    editContainer.innerHTML = '<p class="placeholder">Element deleted. Select another from the tree.</p>';
  }
}

async function insertElement(pageNum, position, code) {
  const pageEls = parsed.elements.filter(e => e.page === pageNum);
  let insertLine;
  if (pageEls.length > 0) {
    insertLine = pageEls[pageEls.length - 1].lineEnd;
  } else {
    const page = parsed.pages[pageNum - 1];
    insertLine = page ? page.lineStart + 2 : 1;
  }

  pushHistory();

  const lines = source.split('\n');
  lines.splice(insertLine, 0, ...code.split('\n'));
  source = lines.join('\n');
  revision++;
  saveTextSession();

  parsed = TypstParser.parse(source);
  showToast('Element inserted', 'success');
  buildTree();
  triggerCompile();
}

// ── Source rebuilding ──────────────────────────────

function buildNewSource(el, changes, lineStart, lineEnd) {
  const lines = source.split('\n');
  let result = lines.slice(lineStart - 1, lineEnd).join('\n');

  if ('v_space_before' in changes || 'v_space_after' in changes) {
    const vLinePat = /^\s*#?v\([^)]+\),?\s*$/;
    result = result.split('\n').filter(l => !vLinePat.test(l)).join('\n');
  }

  if (changes._title !== undefined && changes._title !== el.title) {
    if (el.type === 'ptitle') {
      result = result.replace(/(#?ptitle\s*\(\s*")([^"]*)(")/, `$1${escTyp(changes._title)}$3`);
    } else if (el.type === 'sintro') {
      result = result.replace(/(sintro\s*\(\s*")([^"]*)(")/, `$1${escTyp(changes._title)}$3`);
    }
  }

  const helperCallPat = new RegExp(`(${escRx(el.type)}\\s*\\()`);
  const helperMatch = result.match(helperCallPat);
  if (helperMatch) {
    const callStart = helperMatch.index;
    const parenStart = callStart + helperMatch[0].length - 1;
    const parenEnd = TypstParser.balancedEnd(result, parenStart, '(', ')');
    if (parenEnd !== -1) {
      let argSection = result.slice(parenStart + 1, parenEnd);
      const before = result.slice(0, parenStart + 1);
      const after  = result.slice(parenEnd);

      const NAMED_ARGS = ['num','title','inset','type','label','colspan','path'];
      const allArgKeys = new Set([...NAMED_ARGS, ...Object.keys(el.args || {})]);

      for (const argName of allArgKeys) {
        if (!(argName in changes)) continue;
        const newVal = changes[argName];
        const oldVal = el.args[argName];
        if (newVal === oldVal) continue;
        if (newVal === '' && !oldVal) continue;

        const formatted = fmtArg(argName, newVal);
        const strPat  = new RegExp(`(${escRx(argName)}:\\s*)"[^"]*"`);
        const barePat = new RegExp(`(${escRx(argName)}:\\s*)([^,)\\]\\n]+)`);

        if (strPat.test(argSection)) {
          argSection = argSection.replace(strPat, `$1${formatted}`);
        } else if (barePat.test(argSection)) {
          argSection = argSection.replace(barePat, `$1${formatted}`);
        } else if (newVal && newVal !== '' && newVal !== 'none' && argName !== 'num') {
          argSection = argSection.trimEnd() + `, ${argName}: ${formatted}`;
        }
      }

      result = before + argSection + after;
    }
  }

  if (changes.path !== undefined && el.type === 'image') {
    result = result.replace(/(#image\s*\(\s*")([^"]*)(")/, `$1${changes.path}$3`);
  }

  if (changes.__body !== undefined && changes.__body !== el.body) {
    result = replaceBody(result, changes.__body);
  }

  const inCode = !result.trimStart().startsWith('#');
  if (!inCode) {
    if (changes.v_space_before && changes.v_space_before !== '') {
      const indent = result.match(/^(\s*)/)[1];
      result = `${indent}#v(${changes.v_space_before})\n` + result;
    }
    if (changes.v_space_after && changes.v_space_after !== '') {
      const indent = result.match(/^(\s*)/)[1];
      result = result + `\n${indent}#v(${changes.v_space_after})`;
    }
  }

  return result;
}

function fmtArg(name, val) {
  if (name === 'num' || name === 'colspan') return val === 'none' ? 'none' : val;
  if (name === 'label') {
    if (val === 'auto') return 'auto';
    if (val === 'none') return 'none';
    return val.startsWith('"') ? val : `"${val}"`;
  }
  if (name === 'type' || name === 'title') return `"${escTyp(val)}"`;
  if (name === 'path') return `"${val}"`;
  return val;
}

function escRx(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function escTyp(str) { return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"'); }

function replaceBody(slice, newBody) {
  for (let i = slice.length - 1; i >= 0; i--) {
    if (slice[i] === ']') {
      let j = i - 1, d = 1;
      while (j >= 0 && d > 0) {
        if (slice[j] === ']') d++;
        else if (slice[j] === '[') d--;
        j--;
      }
      const lastBracketStart = j + 1;
      const before = slice.slice(0, lastBracketStart + 1);
      const after  = slice.slice(i);
      return before + '\n' + newBody + '\n' + after;
    }
  }
  return slice;
}

// ── Downloads ──────────────────────────────────────

function downloadTyp() {
  const blob = new Blob([source], { type: 'text/plain' });
  dlBlob(blob, filename || 'document.typ');
  showToast('Downloaded .typ source', 'success');
}

function downloadPdf() {
  if (!currentPdfBytes) {
    showToast('No PDF available yet — compile first', 'error');
    return;
  }
  const blob = new Blob([currentPdfBytes], { type: 'application/pdf' });
  const pdfName = (filename || 'document.typ').replace(/\.typ$/, '.pdf');
  dlBlob(blob, pdfName);
  showToast('Downloaded PDF', 'success');
}

function dlBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// ── Session persistence ────────────────────────────
// Source + filename → localStorage  (fast, text-only)
// Images            → IndexedDB     (handles binary, larger quota)

const SESSION_KEY = 'typst-editor-session';
let idb = null;

async function openIDB() {
  if (idb) return idb;
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('typst-editor', 1);
    req.onupgradeneeded = (e) => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains('images')) d.createObjectStore('images');
    };
    req.onsuccess  = (e) => { idb = e.target.result; resolve(idb); };
    req.onerror    = ()  => reject(req.error);
  });
}

function saveTextSession() {
  try {
    const imageNames = Object.keys(imageFiles).filter(k => !k.includes('/'));
    localStorage.setItem(SESSION_KEY, JSON.stringify({
      source, filename, savedAt: Date.now(), imageCount: imageNames.length,
    }));
  } catch (_) {}
}

async function saveImagesToIDB() {
  try {
    const d = await openIDB();
    const tx = d.transaction('images', 'readwrite');
    const store = tx.objectStore('images');
    store.clear();
    for (const [path, buf] of Object.entries(imageFiles)) store.put(buf, path);
  } catch (_) {}
}

async function loadImagesFromIDB() {
  try {
    const d = await openIDB();
    return await new Promise((resolve) => {
      const tx = d.transaction('images', 'readonly');
      const result = {};
      const req = tx.objectStore('images').openCursor();
      req.onsuccess = (e) => {
        const cur = e.target.result;
        if (cur) { result[cur.key] = cur.value; cur.continue(); }
        else resolve(result);
      };
      req.onerror = () => resolve({});
    });
  } catch (_) { return {}; }
}

async function clearIDB() {
  try {
    const d = await openIDB();
    d.transaction('images', 'readwrite').objectStore('images').clear();
  } catch (_) {}
}

function getTextSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    return (s?.source && s?.filename) ? s : null;
  } catch (_) { return null; }
}

function clearTextSession() {
  localStorage.removeItem(SESSION_KEY);
}

function timeAgo(ms) {
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60)  return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} hr ago`;
  return `${Math.floor(s / 86400)} day(s) ago`;
}

// ── Toast ──────────────────────────────────────────
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

// ── Keyboard shortcuts ─────────────────────────────
document.addEventListener('keydown', (e) => {
  if (appEl.style.display === 'none') return;
  if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
    e.preventDefault();
    undoEdit();
  }
});

// ── Init ───────────────────────────────────────────
setupLanding();
btnDlTyp.addEventListener('click', downloadTyp);
btnDlPdf.addEventListener('click', downloadPdf);
btnAddImages.addEventListener('click', () => imgInput.click());
btnOpenFile.addEventListener('click', openDifferentFile);
document.getElementById('btn-dismiss-error').addEventListener('click', () => {
  errorPanel.style.display = 'none';
});
btnDlPdf.disabled = true;
