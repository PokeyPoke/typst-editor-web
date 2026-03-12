/**
 * Edit panel — full property control for all element types.
 * Web/static version: measurement panel removed (no server).
 */

const EditorPanel = (() => {

  // ── Full property definitions per element type ──
  const PROPS = {
    tcard: {
      _args: {
        num:       { label: 'Number',    type: 'num-or-none', default: 'none' },
        title:     { label: 'Title',     type: 'text',        default: '' },
        inset:     { label: 'Inset',     type: 'dimension',   default: '6mm' },
        colspan:   { label: 'Colspan',   type: 'select',      default: '1', options: [{v:'1',l:'1 (single column)'},{v:'2',l:'2 (full width)'}] },
      },
      _layout: {
        v_space_before:{ label: 'Space Before',  type: 'dimension', default: '' },
        v_space_after: { label: 'Space After',   type: 'dimension', default: '' },
      },
    },
    ibox: {
      _args: {
        type:    { label: 'Type',    type: 'select', default: 'note', options: [{v:'note',l:'Note'},{v:'warning',l:'Warning'},{v:'danger',l:'Danger'},{v:'success',l:'Success'}] },
        label:   { label: 'Label',   type: 'label-radio', default: 'auto' },
        colspan: { label: 'Colspan', type: 'select', default: '2', options: [{v:'1',l:'1 (single column)'},{v:'2',l:'2 (full width)'},{v:'3',l:'3 (Quick Ref)'}] },
      },
      _layout: {
        v_space_before:{ label: 'Space Before',  type: 'dimension', default: '' },
        v_space_after: { label: 'Space After',   type: 'dimension', default: '' },
      },
    },
    sintro: {
      _args: {
        _title:  { label: 'Title',   type: 'text',   default: '' },
        colspan: { label: 'Colspan', type: 'select', default: '2', options: [{v:'1',l:'1 (single column)'},{v:'2',l:'2 (full width)'}] },
      },
      _layout: {
        v_space_before:{ label: 'Space Before',  type: 'dimension', default: '' },
        v_space_after: { label: 'Space After',   type: 'dimension', default: '' },
      },
    },
    ptitle: {
      _args: {
        _title: { label: 'Title', type: 'text', default: '' },
      },
      _text: {
        size:   { label: 'Font Size', type: 'dimension', default: '20pt' },
        weight: { label: 'Weight',    type: 'text',      default: 'bold', hint: 'bold, semibold, 300, etc.' },
      },
      _layout: {
        v_space_after: { label: 'Space After', type: 'dimension', default: '' },
      },
    },
    image: {
      _args: {
        path:   { label: 'Path',   type: 'text',      default: '' },
        width:  { label: 'Width',  type: 'dimension', default: '' },
        height: { label: 'Height', type: 'dimension', default: '' },
      },
      _layout: {
        v_space_before:{ label: 'Space Before', type: 'dimension', default: '' },
        v_space_after: { label: 'Space After',  type: 'dimension', default: '' },
      },
    },
  };

  const GROUP_LABELS = {
    _args: 'Arguments',
    _block: 'Block Properties',
    _text: 'Text Properties',
    _layout: 'Layout & Spacing',
  };

  // ── Build form ──

  function buildForm(el, onApply, pageElements) {
    const wrap = document.createElement('div');

    const header = document.createElement('div');
    header.className = 'edit-section-title';
    header.textContent = el.type === 'page-block' ? 'COVER PAGE' : el.type.toUpperCase();
    wrap.appendChild(header);

    const info = document.createElement('div');
    info.className = 'line-info';
    info.textContent = `Lines ${el.lineStart}–${el.lineEnd} · Page ${el.page}`;
    wrap.appendChild(info);

    // page-block: source-only, no Properties tab
    const sourceOnly = el.type === 'page-block';

    // Tabs
    const tabBar = document.createElement('div');
    tabBar.className = 'tab-bar';
    const tabProps  = mkTab('Properties', !sourceOnly);
    const tabSource = mkTab('Source', sourceOnly);
    if (!sourceOnly) tabBar.appendChild(tabProps);
    tabBar.appendChild(tabSource);
    wrap.appendChild(tabBar);

    // Properties panel
    const propsPanel = document.createElement('div');
    propsPanel.className = 'tab-panel' + (sourceOnly ? ' hidden' : '');
    const fields = sourceOnly ? {} : buildPropertyFields(el, propsPanel);
    if (!sourceOnly) wrap.appendChild(propsPanel);

    // Source panel
    const sourcePanel = document.createElement('div');
    sourcePanel.className = 'tab-panel' + (sourceOnly ? '' : ' hidden');
    if (sourceOnly) {
      const hint = document.createElement('div');
      hint.style.cssText = 'font-size:11px;color:var(--muted);margin-bottom:8px;font-style:italic';
      hint.textContent = 'Edit the cover page layout directly. Changes apply to the full #page(…)[…] block.';
      sourcePanel.appendChild(hint);
    }
    const sourceTa = document.createElement('textarea');
    sourceTa.className = 'source-editor';
    sourceTa.value = el.sourceSlice;
    sourceTa.spellcheck = false;
    sourcePanel.appendChild(sourceTa);
    wrap.appendChild(sourcePanel);

    if (!sourceOnly) {
      tabProps.addEventListener('click',  () => activate(tabProps, tabSource, propsPanel, sourcePanel));
      tabSource.addEventListener('click', () => activate(tabSource, tabProps, sourcePanel, propsPanel));
    }

    // Buttons
    const btnRow = document.createElement('div');
    btnRow.className = 'btn-row';

    btnRow.appendChild(mkBtn('Apply', 'btn-primary', () => {
      if (!sourcePanel.classList.contains('hidden')) {
        onApply(el, { __raw: sourceTa.value });
      } else {
        const changes = {};
        for (const [k, f] of Object.entries(fields)) {
          if (f.isDirty()) changes[k] = f.getValue();
        }
        onApply(el, changes);
      }
    }));
    btnRow.appendChild(mkBtn('Reset', 'btn-secondary', () => {
      sourceTa.value = el.sourceSlice;
      for (const f of Object.values(fields)) f.reset();
    }));
    btnRow.appendChild(mkBtn('Delete', 'btn-danger', () => {
      if (confirm(`Delete this ${el.type}? (lines ${el.lineStart}–${el.lineEnd})`)) {
        onApply(el, { __delete: true });
      }
    }));

    wrap.appendChild(btnRow);
    return wrap;
  }

  function buildPropertyFields(el, container) {
    const propDef = PROPS[el.type];
    if (!propDef) {
      container.innerHTML = '<p class="placeholder">No properties defined for this type. Use Source tab.</p>';
      return {};
    }

    const fields = {};
    const currentVals = extractCurrentValues(el);

    for (const [groupKey, groupProps] of Object.entries(propDef)) {
      const groupLabel = GROUP_LABELS[groupKey] || groupKey;
      const gh = document.createElement('div');
      gh.className = 'field-group-header';
      gh.textContent = groupLabel;
      container.appendChild(gh);

      const inGrid = !el.sourceSlice.trimStart().startsWith('#');

      for (const [propKey, propSpec] of Object.entries(groupProps)) {
        if (inGrid && (propKey === 'v_space_before' || propKey === 'v_space_after')) continue;

        const currentVal = currentVals[propKey] ?? '';
        const displayVal = currentVal || propSpec.default || '';
        const isDefault = !currentVal;

        fields[propKey] = buildField(container, propSpec, propKey, displayVal, isDefault);
      }

      if (inGrid && groupKey === '_layout') {
        const hint = document.createElement('div');
        hint.style.cssText = 'font-size:10px;color:var(--muted);margin-bottom:6px;font-style:italic';
        hint.textContent = 'Spacing between grid items is controlled by the grid\'s gutter property. Use Source tab to adjust.';
        container.appendChild(hint);
      }
    }

    if (el.body !== undefined && el.type !== 'ptitle' && el.type !== 'image') {
      const bh = document.createElement('div');
      bh.className = 'field-group-header';
      bh.textContent = 'Body Content';
      container.appendChild(bh);
      fields['__body'] = addTextArea(container, 'body', el.body);
    }

    const ref = document.createElement('div');
    ref.className = 'field-hint-block';
    ref.innerHTML = `<strong>Units:</strong> mm, pt, cm, em, % · <strong>Colors:</strong> primary, muted, lc, ink, warn-c, ok-c, dng-c · <strong>Spacing:</strong> use Space Before/After fields, or #v()/#h() in body`;
    container.appendChild(ref);

    return fields;
  }

  function extractCurrentValues(el) {
    const vals = {};
    for (const [k, v] of Object.entries(el.args || {})) vals[k] = v;
    if (el.type === 'ptitle' || el.type === 'sintro') vals['_title'] = el.title;
    if (el._srcLines) {
      const vBefore = (el._srcLines.before || '').match(/#?v\(([^)]+)\)/);
      const vAfter  = (el._srcLines.after  || '').match(/#?v\(([^)]+)\)/);
      if (vBefore) vals['v_space_before'] = vBefore[1];
      if (vAfter)  vals['v_space_after']  = vAfter[1];
    }
    return vals;
  }

  // ── Field builders ──

  function buildField(parent, spec, key, value, isDefault) {
    switch (spec.type) {
      case 'text':       return addTextField(parent, spec.label, value, spec.hint, isDefault);
      case 'dimension':  return addTextField(parent, spec.label, value, spec.hint || 'e.g. 6mm, 10pt, 50%', isDefault);
      case 'num-or-none':return addNumField(parent, spec.label, value);
      case 'bool':       return addBoolField(parent, spec.label, value);
      case 'select':     return addSelectField(parent, spec.label, value, spec.options);
      case 'label-radio':return addLabelField(parent, spec.label, value);
      case 'textarea':   return addTextArea(parent, spec.label, value);
      default:           return addTextField(parent, spec.label, value, spec.hint, isDefault);
    }
  }

  function addTextField(parent, label, value, hint, isDefault) {
    const div = document.createElement('div');
    div.className = 'edit-field';
    div.innerHTML = `<label>${esc(label)}${isDefault ? ' <span class="default-tag">default</span>' : ''}</label>`;
    const input = document.createElement('input');
    input.type = 'text';
    input.value = value || '';
    if (hint) input.placeholder = hint;
    if (isDefault) input.classList.add('field-default');
    input.addEventListener('input', () => input.classList.remove('field-default'));
    const original = value || '';
    div.appendChild(input);
    parent.appendChild(div);
    return { getValue: () => input.value, isDirty: () => input.value !== original, reset: () => { input.value = original; } };
  }

  function addTextArea(parent, label, value) {
    const div = document.createElement('div');
    div.className = 'edit-field';
    div.innerHTML = `<label>${esc(label)}</label>`;
    const ta = document.createElement('textarea');
    ta.value = value;
    const original = value;
    div.appendChild(ta);
    parent.appendChild(div);
    return { getValue: () => ta.value, isDirty: () => ta.value !== original, reset: () => { ta.value = original; } };
  }

  function addNumField(parent, label, value) {
    const isNone = value === 'none' || value === '';
    const div = document.createElement('div');
    div.className = 'edit-field';
    div.innerHTML = `<label>${esc(label)}</label>`;
    const row = document.createElement('div');
    row.className = 'checkbox-row';
    const input = document.createElement('input');
    input.type = 'number';
    input.value = isNone ? '' : value;
    input.style.width = '80px';
    input.disabled = isNone;
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = isNone;
    cb.id = 'n-' + rnd();
    const cbl = document.createElement('label');
    cbl.htmlFor = cb.id;
    cbl.textContent = 'none';
    cbl.style.cssText = 'text-transform:none;font-weight:normal;color:var(--ink);cursor:pointer;display:inline';
    cb.addEventListener('change', () => { input.disabled = cb.checked; if (cb.checked) input.value = ''; });
    row.appendChild(input); row.appendChild(cb); row.appendChild(cbl);
    div.appendChild(row);
    parent.appendChild(div);
    const ov = value;
    const origGet = () => cb.checked ? 'none' : input.value;
    const origVal = ov === 'none' || ov === '' ? 'none' : ov;
    return {
      getValue: origGet,
      isDirty: () => origGet() !== origVal,
      reset: () => { const n = ov === 'none' || ov === ''; cb.checked = n; input.disabled = n; input.value = n ? '' : ov; },
    };
  }

  function addBoolField(parent, label, value) {
    const div = document.createElement('div');
    div.className = 'edit-field';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = value === 'true';
    cb.id = 'b-' + rnd();
    const lbl = document.createElement('label');
    lbl.htmlFor = cb.id;
    lbl.textContent = ` ${label}`;
    lbl.style.cssText = 'display:inline;cursor:pointer';
    div.appendChild(cb); div.appendChild(lbl);
    parent.appendChild(div);
    const ov = value === 'true';
    return { getValue: () => cb.checked ? 'true' : 'false', isDirty: () => cb.checked !== ov, reset: () => { cb.checked = ov; } };
  }

  function addSelectField(parent, label, value, options) {
    const div = document.createElement('div');
    div.className = 'edit-field';
    div.innerHTML = `<label>${esc(label)}</label>`;
    const sel = document.createElement('select');
    for (const o of options) {
      const opt = document.createElement('option');
      opt.value = o.v; opt.textContent = o.l;
      if (o.v === value) opt.selected = true;
      sel.appendChild(opt);
    }
    const orig = value;
    div.appendChild(sel);
    parent.appendChild(div);
    return { getValue: () => sel.value, isDirty: () => sel.value !== orig, reset: () => { sel.value = orig; } };
  }

  function addLabelField(parent, label, value) {
    const div = document.createElement('div');
    div.className = 'edit-field';
    div.innerHTML = `<label>${esc(label)}</label>`;
    const group = document.createElement('div');
    group.className = 'radio-group';
    const name = 'l-' + rnd();
    let mode = 'auto', custom = '';
    if (value === 'auto') mode = 'auto';
    else if (value === 'none') mode = 'none';
    else { mode = 'custom'; custom = value.replace(/^"|"$/g, ''); }
    const ci = document.createElement('input');
    ci.type = 'text'; ci.value = custom;
    ci.style.cssText = 'width:140px;margin-left:4px';
    ci.disabled = mode !== 'custom';
    for (const m of [{v:'auto',l:'Auto (from type)'},{v:'none',l:'None (hidden)'},{v:'custom',l:'Custom:'}]) {
      const lbl = document.createElement('label');
      const r = document.createElement('input');
      r.type = 'radio'; r.name = name; r.value = m.v;
      r.checked = m.v === mode;
      r.addEventListener('change', () => { ci.disabled = r.value !== 'custom'; });
      lbl.appendChild(r);
      lbl.appendChild(document.createTextNode(' ' + m.l));
      if (m.v === 'custom') lbl.appendChild(ci);
      group.appendChild(lbl);
    }
    div.appendChild(group);
    parent.appendChild(div);
    const om = mode, oc = custom;
    const origLabel = mode === 'auto' ? 'auto' : mode === 'none' ? 'none' : `"${custom}"`;
    const getVal = () => { const c = group.querySelector(`input[name="${name}"]:checked`).value; return c === 'auto' ? 'auto' : c === 'none' ? 'none' : `"${ci.value || ''}"`;};
    return {
      getValue: getVal,
      isDirty: () => getVal() !== origLabel,
      reset: () => { group.querySelector(`input[value="${om}"]`).checked = true; ci.value = oc; ci.disabled = om !== 'custom'; },
    };
  }

  // ── Insert form ──

  function buildInsertForm(pageNum, onInsert) {
    const wrap = document.createElement('div');
    const header = document.createElement('div');
    header.className = 'edit-section-title';
    header.textContent = 'INSERT NEW ELEMENT';
    wrap.appendChild(header);

    const info = document.createElement('div');
    info.className = 'line-info';
    info.textContent = `Will insert on page ${pageNum}`;
    wrap.appendChild(info);

    const typeSelect = document.createElement('select');
    typeSelect.innerHTML = `
      <option value="tcard">Task Card (tcard)</option>
      <option value="ibox">Info Box (ibox)</option>
      <option value="sintro">Section Intro (sintro)</option>
      <option value="ptitle">Page Title (ptitle)</option>
      <option value="image">Image</option>
      <option value="pagebreak">Page Break + New Section</option>
      <option value="custom">Custom (raw Typst)</option>`;
    addFieldTo(wrap, 'Element Type', () => typeSelect);

    const ta = document.createElement('textarea');
    ta.className = 'source-editor';
    ta.spellcheck = false;
    wrap.appendChild(ta);

    function update() { ta.value = getTemplate(typeSelect.value); }
    typeSelect.addEventListener('change', update);
    update();

    const colDiv = document.createElement('div');
    colDiv.className = 'edit-field';
    const colCb = document.createElement('input');
    colCb.type = 'checkbox'; colCb.id = 'csc';
    const colLbl = document.createElement('label');
    colLbl.htmlFor = 'csc';
    colLbl.textContent = ' Add colspan: 2 (full width)';
    colLbl.style.cssText = 'text-transform:none;font-weight:normal;display:inline;cursor:pointer';
    colDiv.appendChild(colCb); colDiv.appendChild(colLbl);
    wrap.appendChild(colDiv);

    const btnRow = document.createElement('div');
    btnRow.className = 'btn-row';
    btnRow.appendChild(mkBtn('Insert', 'btn-primary', () => {
      let code = ta.value;
      if (colCb.checked) code = code.replace(/(\w+\s*\()/, '$1colspan: 2, ');
      onInsert(pageNum, 'end', code);
    }));
    wrap.appendChild(btnRow);
    return wrap;
  }

  function getTemplate(type) {
    const T = {
      tcard: `  tcard(num: 1, title: "New Card")[
    Content goes here.
  ],`,
      ibox: `  ibox(type: "note")[
    Note content here.
  ],`,
      sintro: `  sintro("Section Title")[
    Introduction text here.
  ],`,
      ptitle: `#ptitle("Page Title")`,
      image: `  #image("../images/TechUI/processed/filename.png",
         width: 100%)`,
      pagebreak: `#pagebreak()
#fsec.update("Section N: Title")
#fpg.update("N")

#ptitle("Section N: Title")

#grid(
  columns: (1fr, 1fr),
  gutter: 5mm,
  align: top,
)`,
      custom: `  // Your Typst code here`,
    };
    return T[type] || '';
  }

  // ── Helpers ──

  function mkTab(text, active) {
    const b = document.createElement('button');
    b.className = 'tab' + (active ? ' active' : '');
    b.textContent = text;
    return b;
  }
  function mkBtn(text, cls, fn) {
    const b = document.createElement('button');
    b.className = 'btn ' + cls;
    b.textContent = text;
    b.addEventListener('click', fn);
    return b;
  }
  function activate(on, off, showPanel, hidePanel) {
    on.classList.add('active'); off.classList.remove('active');
    showPanel.classList.remove('hidden'); hidePanel.classList.add('hidden');
  }
  function addFieldTo(parent, label, mkEl) {
    const d = document.createElement('div');
    d.className = 'edit-field';
    d.innerHTML = `<label>${esc(label)}</label>`;
    d.appendChild(mkEl());
    parent.appendChild(d);
  }
  function esc(s) { return s.replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function rnd() { return Math.random().toString(36).slice(2, 6); }

  return { buildForm, buildInsertForm };
})();
