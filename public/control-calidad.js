/* ==========================================================================
   Control de Calidad - No Conforme — lógica de la app.
   Página independiente (no comparte historial con index.html/app.js ni con
   reporte-paletizado.html/reporte.js): su propia tabla `nc_reports` en Neon
   (ver api/index.js). Sin frameworks, JS moderno de navegador.

   Flujo: un reporte se crea YA en la cola (estado 'pendiente', folio
   consecutivo asignado al crearse) — así la cola sobrevive un reload
   porque vive en la base de datos, no en memoria. Al imprimir la hoja y
   confirmar que salió bien, los reportes seleccionados pasan a 'impreso' y
   se retiran de la cola; quedan disponibles en el Historial.
   ========================================================================== */

(function () {
  'use strict';

  const MAX_TRAY = 6;
  const DATE_PATTERN = /^[0-9]{2}\/[0-9]{2}\/[0-9]{4}$/;
  const LPN_DEBOUNCE_MS = 400;

  const DEFECT_ORDER = [
    'duplicado', 'pulgada_incorrecta', 'clasificacion_incorrecta',
    'marca_incorrecta', 'caida', 'salida', 'otro',
  ];
  const DEFECT_LABELS = {
    duplicado: 'Duplicado',
    pulgada_incorrecta: 'Pulgada incorrecta',
    clasificacion_incorrecta: 'Clasificación incorrecta',
    marca_incorrecta: 'Marca incorrecta',
    caida: 'Caída',
    salida: 'Salida',
    otro: 'Otro',
  };

  // ---- Referencias del DOM ----
  const form = document.getElementById('nc-form');
  const reportNumberInput = document.getElementById('nc-report-number');
  const dateInput = document.getElementById('nc-date');
  const lpnInput = document.getElementById('nc-lpn');
  const skuInput = document.getElementById('nc-sku');
  const skuHint = document.getElementById('nc-sku-hint');
  const defectGrid = document.getElementById('nc-defect-grid');
  const defectOtherInput = document.getElementById('nc-defect-other');
  const originSelect = document.getElementById('nc-origin');
  const inspectorInput = document.getElementById('nc-inspector');
  const receivedByInput = document.getElementById('nc-received-by');
  const formMsg = document.getElementById('nc-form-msg');
  const btnClear = document.getElementById('nc-btn-clear');
  const btnAdd = document.getElementById('nc-btn-add');

  const alertBox = document.getElementById('nc-alert');

  const trayList = document.getElementById('nc-tray-list');
  const trayEmpty = document.getElementById('nc-tray-empty');
  const trayCountInline = document.getElementById('nc-tray-count-inline');
  const statQueued = document.getElementById('nc-stat-queued');
  const statAvailable = document.getElementById('nc-stat-available');
  const btnPrintSheet = document.getElementById('nc-btn-print-sheet');
  const btnPrintSheetLabel = document.getElementById('nc-btn-print-sheet-label');

  const printArea = document.getElementById('nc-print-area');

  const confirmBackdrop = document.getElementById('nc-confirm-backdrop');
  const confirmModal = document.getElementById('nc-confirm-modal');
  const confirmTitle = document.getElementById('nc-confirm-title');
  const confirmBody = confirmModal.querySelector('.modal-body p');
  const btnPrintOk = document.getElementById('nc-btn-print-ok');
  const btnPrintFailed = document.getElementById('nc-btn-print-failed');

  const btnHistory = document.getElementById('nc-btn-history');
  const historyBackdrop = document.getElementById('nc-history-backdrop');
  const historyModal = document.getElementById('nc-history-modal');
  const btnCloseHistory = document.getElementById('nc-btn-close-history');
  const historySearch = document.getElementById('nc-search-input');
  const historyDateFilter = document.getElementById('nc-filter-date');
  const historyDefectFilter = document.getElementById('nc-filter-defect');
  const historyStatusFilter = document.getElementById('nc-filter-status');
  const btnRefreshHistory = document.getElementById('nc-btn-refresh-history');
  const historyBody = document.getElementById('nc-history-body');
  const historyEmpty = document.getElementById('nc-history-empty');
  const historyError = document.getElementById('nc-history-error');

  const detailBackdrop = document.getElementById('nc-detail-backdrop');
  const detailModal = document.getElementById('nc-detail-modal');
  const btnCloseDetail = document.getElementById('nc-btn-close-detail');
  const detailBody = document.getElementById('nc-detail-body');

  document.querySelectorAll('img.brand-logo').forEach((img) => {
    img.addEventListener('error', () => {
      console.error(`[Logo] No se encontró "${img.getAttribute('src')}".`);
    }, { once: true });
  });

  // ---- Estado en memoria ----
  let trayReports = [];           // reportes 'pendiente' (la cola completa); el orden de
                                   // llegada define la posición 1-6 en la hoja.
  let historyReports = [];
  let pendingPrintIds = null;     // ids que se marcarán 'impreso' al confirmar
  let pendingReprintReport = null; // reporte que se está reimprimiendo (uno solo)
  let searchTimer = null;
  let lpnLookupToken = 0;
  let savedScrollY = 0;

  // ---- Utilidades compartidas (mismo patrón que app.js/reporte.js) ----
  function pad2(n) { return n.toString().padStart(2, '0'); }
  function todayDisplayString() {
    const d = new Date();
    return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
  }

  function autoFormatDateTyping(value, previousValue) {
    let raw = value.replace(/[^0-9/]/g, '');
    if (value.length < previousValue.length) return raw;
    let parts = raw.split('/');
    if (parts.length === 1 && parts[0].length >= 2) parts = [parts[0].slice(0, 2), parts[0].slice(2)];
    if (parts.length === 2 && parts[1].length >= 2) parts = [parts[0], parts[1].slice(0, 2), parts[1].slice(2)];
    if (parts.length > 3) parts = parts.slice(0, 3);
    if (parts[0] !== undefined) parts[0] = parts[0].slice(0, 2);
    if (parts[1] !== undefined) parts[1] = parts[1].slice(0, 2);
    if (parts[2] !== undefined) parts[2] = parts[2].slice(0, 4);
    return parts.join('/');
  }
  function normalizeDateSegments(raw) {
    const parts = raw.split('/');
    if (parts.length !== 3) return raw;
    let [d, m, y] = parts;
    if (d.length === 1) d = '0' + d;
    if (m.length === 1) m = '0' + m;
    return `${d}/${m}/${y}`;
  }

  function formatPrintStamp(value) {
    if (!value) return '';
    const d = new Date(value);
    if (isNaN(d.getTime())) return '';
    const parts = new Intl.DateTimeFormat('es-MX', {
      timeZone: 'America/Monterrey',
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(d);
    const get = (type) => (parts.find((p) => p.type === type) || {}).value || '';
    let hour = get('hour');
    if (hour === '24') hour = '00';
    return `${get('day')}/${get('month')}/${get('year')} ${hour}:${get('minute')}`;
  }

  function escapeHtml(str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[ch]));
  }

  function defectsToLabel(defects, defectOther) {
    const labels = (defects || []).map((d) => DEFECT_LABELS[d] || d);
    if (defects && defects.includes('otro') && defectOther) {
      return labels.map((l) => (l === 'Otro' ? `Otro (${defectOther})` : l)).join(', ');
    }
    return labels.join(', ');
  }

  function setFormMsg(text, isError) {
    formMsg.textContent = text || '';
    formMsg.classList.toggle('error', Boolean(isError));
    formMsg.classList.toggle('ok', !isError && Boolean(text));
  }

  function setAlert(text) {
    if (!text) { alertBox.classList.add('hidden'); alertBox.textContent = ''; return; }
    alertBox.textContent = text;
    alertBox.classList.remove('hidden');
  }

  // ---- Fecha ----
  let previousDateValue = dateInput.value;
  dateInput.addEventListener('input', () => {
    const formatted = autoFormatDateTyping(dateInput.value, previousDateValue);
    if (formatted !== dateInput.value) dateInput.value = formatted;
    previousDateValue = dateInput.value;
  });
  dateInput.addEventListener('blur', () => {
    const normalized = normalizeDateSegments(dateInput.value.trim());
    if (normalized !== dateInput.value) { dateInput.value = normalized; previousDateValue = normalized; }
  });

  // ---- Folio (sólo vista previa; el real se asigna en el servidor) ----
  async function refreshNextNumberPreview() {
    try {
      const res = await fetch('/api/nc-reports/next-number');
      const data = await res.json();
      if (res.ok && data.success) reportNumberInput.value = data.reportNumber;
    } catch (err) {
      console.error('[next-number]', err);
    }
  }

  // ---- Defectos: casillas + "Otro" ----
  function syncDefectOther() {
    const otroChecked = defectGrid.querySelector('input[value="otro"]').checked;
    defectOtherInput.disabled = !otroChecked;
    if (!otroChecked) defectOtherInput.value = '';
  }
  defectGrid.addEventListener('change', syncDefectOther);

  function getCheckedDefects() {
    return Array.from(defectGrid.querySelectorAll('input[type="checkbox"]:checked')).map((cb) => cb.value);
  }

  // ---- LPN -> SKU automático ----
  let lpnDebounceTimer = null;
  lpnInput.addEventListener('input', () => {
    clearTimeout(lpnDebounceTimer);
    const lpn = lpnInput.value.trim();
    if (!lpn) { skuHint.textContent = ''; return; }
    lpnDebounceTimer = setTimeout(() => lookupSkuByLpn(lpn), LPN_DEBOUNCE_MS);
  });

  async function lookupSkuByLpn(lpn) {
    const token = ++lpnLookupToken;
    skuHint.textContent = 'Buscando SKU…';
    try {
      const res = await fetch('/api/nc-reports/lookup-sku?lpn=' + encodeURIComponent(lpn));
      const data = await res.json();
      if (token !== lpnLookupToken) return; // el usuario ya escribió otro LPN mientras esperábamos
      if (!res.ok || !data.success) throw new Error(data.error || 'Error al buscar el SKU.');
      if (data.sku) {
        if (!skuInput.value.trim()) skuInput.value = data.sku;
        skuHint.textContent = 'SKU encontrado automáticamente a partir del historial de este LPN.';
      } else {
        skuHint.textContent = 'No se encontró un SKU registrado para este LPN; captúralo manualmente.';
      }
    } catch (err) {
      if (token !== lpnLookupToken) return;
      console.error('[lookupSkuByLpn]', err);
      skuHint.textContent = 'No se pudo buscar el SKU automáticamente; captúralo manualmente.';
    }
  }

  // ---- Validación (mensajes dentro de la interfaz, no alerts) ----
  function validateForm() {
    const reportDate = normalizeDateSegments(dateInput.value.trim());
    const lpn = lpnInput.value.trim();
    const sku = skuInput.value.trim();
    const defects = getCheckedDefects();
    const defectOther = defectOtherInput.value.trim();
    const origin = originSelect.value;
    const inspector = inspectorInput.value.trim();
    const receivedBy = receivedByInput.value.trim();

    if (trayReports.length >= MAX_TRAY) {
      return { error: `La cola ya tiene ${MAX_TRAY} reportes (máximo por hoja). Imprime la hoja actual antes de agregar otro.` };
    }
    if (!reportDate || !DATE_PATTERN.test(reportDate)) return { error: 'La fecha es obligatoria y debe tener formato DD/MM/AAAA.', focus: dateInput };
    if (!lpn) return { error: 'El LPN es obligatorio.', focus: lpnInput };
    if (!sku) return { error: 'El SKU es obligatorio.', focus: skuInput };
    if (!defects.length) return { error: 'Selecciona al menos un defecto detectado.', focus: defectGrid };
    if (defects.includes('otro') && !defectOther) {
      return { error: 'Especifica el defecto cuando seleccionas "Otro".', focus: defectOtherInput };
    }
    if (!origin) return { error: 'El origen del hallazgo es obligatorio.', focus: originSelect };
    if (!inspector) return { error: 'El inspector es obligatorio.', focus: inspectorInput };
    if (!receivedBy) return { error: 'La firma de recibido es obligatoria.', focus: receivedByInput };

    return { reportDate, lpn, sku, defects, defectOther: defects.includes('otro') ? defectOther : '', origin, inspector, receivedBy };
  }

  // ---- Enviar: Agregar a cola ----
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const validated = validateForm();
    if (validated.error) {
      setFormMsg(validated.error, true);
      if (validated.focus) validated.focus.focus();
      return;
    }

    btnAdd.disabled = true;
    try {
      const res = await fetch('/api/nc-reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validated),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo agregar el reporte.');

      trayReports.push(data.report);
      renderTray();
      renderTrayPreview();
      setFormMsg(`Reporte ${data.report.report_number} agregado a la cola.`, false);

      // Limpia sólo lo necesario para el siguiente reporte; conserva
      // Inspector, Firma de Recibido y Origen del Hallazgo.
      dateInput.value = todayDisplayString();
      previousDateValue = dateInput.value;
      lpnInput.value = '';
      skuInput.value = '';
      skuHint.textContent = '';
      defectGrid.querySelectorAll('input[type="checkbox"]').forEach((cb) => { cb.checked = false; });
      syncDefectOther();
      refreshNextNumberPreview();
      lpnInput.focus();
    } catch (err) {
      console.error('[Agregar a cola]', err);
      setFormMsg(err.message, true);
    } finally {
      btnAdd.disabled = trayReports.length >= MAX_TRAY;
    }
  });

  btnClear.addEventListener('click', () => {
    form.reset();
    dateInput.value = todayDisplayString();
    previousDateValue = dateInput.value;
    defectGrid.querySelectorAll('input[type="checkbox"]').forEach((cb) => { cb.checked = false; });
    syncDefectOther();
    skuHint.textContent = '';
    setFormMsg('', false);
    lpnInput.focus();
  });

  // ---- Cola de impresión ----
  // Toda la cola se imprime junta: el orden de llegada de los reportes en
  // `trayReports` define la posición 1-6 en la hoja.
  function renderTray() {
    trayList.innerHTML = '';
    const count = trayReports.length;

    trayCountInline.textContent = String(count);
    statQueued.textContent = `${count} de ${MAX_TRAY}`;
    statAvailable.textContent = String(MAX_TRAY - count);
    trayEmpty.classList.toggle('hidden', count > 0);
    btnAdd.disabled = count >= MAX_TRAY;

    const frag = document.createDocumentFragment();
    trayReports.forEach((report, index) => {
      const row = document.createElement('div');
      row.className = 'nc-tray-row';
      row.dataset.id = report.id;
      row.innerHTML = `
        <div class="nc-tray-row-top">
          <span class="nc-tray-row-num">${index + 1}</span>
          <span class="nc-tray-row-id">${escapeHtml(report.report_number)}</span>
          <span class="nc-tray-row-date">${escapeHtml(report.report_date)}</span>
          <button type="button" class="nc-tray-row-remove" data-id="${report.id}" aria-label="Quitar ${escapeHtml(report.report_number)} de la cola">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
          </button>
        </div>
        <div class="nc-tray-row-line"><span>LPN: <b>${escapeHtml(report.lpn)}</b></span><span>SKU: <b>${escapeHtml(report.sku)}</b></span></div>
        <div class="nc-tray-row-line"><span>Inspector: <b>${escapeHtml(report.inspector)}</b></span><span>Origen: <b>${escapeHtml(report.origin)}</b></span></div>
        <span class="nc-tray-row-status">Listo para imprimir</span>`;
      frag.appendChild(row);
    });
    trayList.appendChild(frag);

    btnPrintSheet.disabled = count === 0;
    btnPrintSheetLabel.textContent = `Imprimir Hoja (${count} etiqueta${count === 1 ? '' : 's'})`;
  }

  trayList.addEventListener('click', async (e) => {
    const btn = e.target.closest('button.nc-tray-row-remove');
    if (!btn) return;
    const id = Number(btn.dataset.id);
    const report = trayReports.find((r) => r.id === id);
    if (!report) return;
    if (!confirm(`¿Eliminar el reporte "${report.report_number}" de la cola? Esta acción no se puede deshacer.`)) return;

    btn.disabled = true;
    try {
      const res = await fetch('/api/nc-reports/' + id, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo eliminar el reporte.');
      trayReports = trayReports.filter((r) => r.id !== id);
      renderTray();
      renderTrayPreview();
    } catch (err) {
      console.error('[Eliminar de cola]', err);
      alert('No se pudo eliminar el reporte: ' + err.message);
      btn.disabled = false;
    }
  });

  async function loadTray() {
    try {
      const res = await fetch('/api/nc-reports?status=pendiente');
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Error al cargar la cola.');
      trayReports = (data.reports || []).slice().sort((a, b) => a.id - b.id);
      renderTray();
      renderTrayPreview();
      setAlert('');
    } catch (err) {
      console.error('[loadTray]', err);
      setAlert('No se pudo cargar la cola de impresión. Verifica la conexión / DATABASE_URL.');
    }
  }

  // Reporte "en blanco" para las posiciones todavía sin usar en la hoja:
  // pasa por la MISMA plantilla que un reporte real (renderLabelHtml), así
  // que conserva exactamente el mismo tamaño/estructura — sólo que todos
  // los campos y los 7 defectos aparecen vacíos/desmarcados, como un
  // formulario en blanco, en vez de un placeholder gris distinto.
  const BLANK_REPORT = {
    id: null, report_number: '', report_date: '', lpn: '', sku: '',
    defects: [], defect_other: '', origin: '', inspector: '', received_by: '',
  };

  // Envuelve un valor en una "línea para llenar" (subrayado) — si viene
  // vacío se ve como una línea en blanco, igual que en el papelito físico.
  function blankField(value) {
    return `<span class="nc-label-blank">${escapeHtml(value || '')}</span>`;
  }

  // ---- Etiqueta (misma plantilla para vista previa e impresión) ----
  // Los 7 defectos del catálogo SIEMPRE se listan completos en cada
  // etiqueta (casilla marcada sólo si el reporte lo seleccionó) — nunca
  // varía cuáles aparecen, para que las 6 etiquetas de la hoja sean
  // idénticas en estructura, incluidas las posiciones aún vacías.
  function renderLabelHtml(report) {
    const defects = report.defects || [];
    const mainDefects = DEFECT_ORDER.slice(0, 6).map((key) => {
      const checked = defects.includes(key);
      return `<div class="nc-label-defect-item ${checked ? 'checked' : ''}">
        <span class="nc-label-defect-box">${checked ? '✓' : ''}</span>
        <span>${escapeHtml(DEFECT_LABELS[key])}</span>
      </div>`;
    }).join('');
    const otroChecked = defects.includes('otro');
    const otroDefect = `<div class="nc-label-defect-item nc-label-defect-otro ${otroChecked ? 'checked' : ''}">
      <span class="nc-label-defect-box">${otroChecked ? '✓' : ''}</span>
      <span>Otro:</span>
      ${blankField(otroChecked ? report.defect_other : '')}
    </div>`;

    const idValue = report.report_number ? `#${report.report_number}` : '#';

    return `
      <div class="nc-label" data-id="${report.id == null ? '' : report.id}">
        <div class="nc-label-head">
          <img src="/logo-mitech.png" alt="MI Technologies" class="nc-label-logo brand-logo">
          <span class="nc-label-brand-word">Technologies</span>
        </div>
        <div class="nc-label-title-row">
          <span class="nc-label-title-left">CONTROL DE CALIDAD</span>
          <span class="nc-label-title-right">ESTADO: NO CONFORME</span>
        </div>
        <div class="nc-label-field-row">
          <span class="nc-label-field">ID Reporte: ${blankField(idValue)}</span>
          <span class="nc-label-field">Fecha: ${blankField(report.report_date)}</span>
        </div>
        <div class="nc-label-field-row">
          <span class="nc-label-field">LPN: ${blankField(report.lpn)}</span>
          <span class="nc-label-field">SKU: ${blankField(report.sku)}</span>
        </div>
        <div class="nc-label-defects-title">Defecto detectado:</div>
        <div class="nc-label-defect-grid-3">${mainDefects}</div>
        ${otroDefect}
        <div class="nc-label-field-row nc-label-field-row-full">
          <span class="nc-label-field">Origen del Hallazgo: ${blankField(report.origin)}</span>
        </div>
        <div class="nc-label-field-row">
          <span class="nc-label-field">Inspector: ${blankField(report.inspector)}</span>
          <span class="nc-label-field">Firma de Recibido: ${blankField(report.received_by)}</span>
        </div>
      </div>`;
  }

  // Cola normal: llena la hoja con TODOS los reportes de la cola, en el
  // orden de llegada, y completa las posiciones restantes con la plantilla
  // en blanco (misma estructura y tamaño, sin datos).
  function renderTrayPreview() {
    const slots = trayReports.slice(0, MAX_TRAY).map(renderLabelHtml);
    while (slots.length < MAX_TRAY) slots.push(renderLabelHtml(BLANK_REPORT));
    printArea.innerHTML = slots.join('');
  }

  // Reimpresión desde el historial: hoja con UN solo reporte impreso y el
  // resto de posiciones en blanco — no reutiliza ni cambia el folio original.
  function renderSingleReprintPreview(report) {
    const slots = [renderLabelHtml(report)];
    while (slots.length < MAX_TRAY) slots.push(renderLabelHtml(BLANK_REPORT));
    printArea.innerHTML = slots.join('');
  }

  // ---- Impresión ----
  function waitForPrintReady() {
    const logos = Array.from(printArea.querySelectorAll('.nc-label-logo'));
    return Promise.all(logos.map((img) => (img.complete ? Promise.resolve() : new Promise((resolve) => {
      img.addEventListener('load', resolve, { once: true });
      img.addEventListener('error', resolve, { once: true });
    }))));
  }

  btnPrintSheet.addEventListener('click', async () => {
    if (!trayReports.length) return;
    pendingPrintIds = trayReports.map((r) => r.id);
    pendingReprintReport = null;
    await waitForPrintReady();
    window.print();
  });

  window.addEventListener('afterprint', () => {
    if (pendingPrintIds) {
      confirmTitle.textContent = '¿La impresión fue correcta?';
      confirmBody.textContent = 'Si confirmas, los reportes de la cola pasarán a "Impreso" y la cola quedará vacía. Si la impresión falló o la cancelaste, permanecerán en la cola para reintentar.';
      openConfirmModal();
    } else if (pendingReprintReport) {
      confirmTitle.textContent = '¿La reimpresión fue correcta?';
      confirmBody.textContent = `Si confirmas, se registrará esta reimpresión de ${escapeHtml(pendingReprintReport.report_number)}. El folio y los datos originales no cambian.`;
      openConfirmModal();
    }
  });

  function openConfirmModal() {
    confirmBackdrop.classList.remove('hidden');
    confirmModal.classList.remove('hidden');
  }
  function closeConfirmModal() {
    confirmBackdrop.classList.add('hidden');
    confirmModal.classList.add('hidden');
  }

  btnPrintOk.addEventListener('click', async () => {
    closeConfirmModal();
    if (pendingPrintIds) {
      const ids = pendingPrintIds;
      pendingPrintIds = null;
      try {
        const res = await fetch('/api/nc-reports/print', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids }),
        });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo registrar la impresión.');
        const printedIds = new Set(data.reports.map((r) => r.id));
        trayReports = trayReports.filter((r) => !printedIds.has(r.id));
        renderTray();
        renderTrayPreview();
        setFormMsg(`${printedIds.size} reporte(s) marcados como impresos.`, false);
      } catch (err) {
        console.error('[confirmar impresión]', err);
        alert('No se pudo registrar la impresión: ' + err.message);
      }
    } else if (pendingReprintReport) {
      const report = pendingReprintReport;
      pendingReprintReport = null;
      try {
        const res = await fetch(`/api/nc-reports/${report.id}/reprint`, { method: 'POST' });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo registrar la reimpresión.');
        if (!historyModal.classList.contains('hidden')) fetchHistory();
      } catch (err) {
        console.error('[confirmar reimpresión]', err);
        alert('No se pudo registrar la reimpresión: ' + err.message);
      } finally {
        renderTrayPreview();
      }
    }
  });

  btnPrintFailed.addEventListener('click', () => {
    closeConfirmModal();
    pendingPrintIds = null;
    if (pendingReprintReport) {
      pendingReprintReport = null;
      renderTrayPreview();
    }
  });

  // ---- Historial (modal) ----
  function lockBodyScroll() {
    savedScrollY = window.scrollY || window.pageYOffset || 0;
    document.body.style.top = `-${savedScrollY}px`;
    document.body.classList.add('modal-open');
  }
  function unlockBodyScroll() {
    document.body.classList.remove('modal-open');
    document.body.style.top = '';
    window.scrollTo(0, savedScrollY);
  }

  function openHistoryModal() {
    lockBodyScroll();
    historyModal.classList.remove('hidden');
    historyBackdrop.classList.remove('hidden');
    fetchHistory();
    historySearch.focus();
  }
  function closeHistoryModal() {
    historyModal.classList.add('hidden');
    historyBackdrop.classList.add('hidden');
    unlockBodyScroll();
    btnHistory.focus({ preventScroll: true });
  }
  btnHistory.addEventListener('click', openHistoryModal);
  btnCloseHistory.addEventListener('click', closeHistoryModal);
  historyBackdrop.addEventListener('click', closeHistoryModal);

  let historyDatePrevious = '';
  historyDateFilter.addEventListener('input', () => {
    const formatted = autoFormatDateTyping(historyDateFilter.value, historyDatePrevious);
    if (formatted !== historyDateFilter.value) historyDateFilter.value = formatted;
    historyDatePrevious = historyDateFilter.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(fetchHistory, 250);
  });

  async function fetchHistory() {
    try {
      const params = new URLSearchParams();
      params.set('status', historyStatusFilter.value || 'all');
      if (historySearch.value.trim()) params.set('search', historySearch.value.trim());
      if (historyDateFilter.value.trim() && DATE_PATTERN.test(historyDateFilter.value.trim())) {
        params.set('date', historyDateFilter.value.trim());
      }
      if (historyDefectFilter.value) params.set('defect', historyDefectFilter.value);

      const res = await fetch('/api/nc-reports?' + params.toString());
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Error al cargar historial.');
      renderHistory(data.reports || []);
      historyError.classList.add('hidden');
    } catch (err) {
      console.error('[fetchHistory]', err);
      historyReports = [];
      historyBody.innerHTML = '';
      historyEmpty.classList.add('hidden');
      historyError.classList.remove('hidden');
    }
  }

  function renderHistory(reports) {
    historyReports = reports;
    historyBody.innerHTML = '';

    if (!reports.length) {
      historyEmpty.classList.remove('hidden');
      return;
    }
    historyEmpty.classList.add('hidden');

    const frag = document.createDocumentFragment();
    reports.forEach((r) => {
      const tr = document.createElement('tr');
      const statusLabel = r.status === 'impreso' ? 'Impreso' : 'Pendiente';
      tr.innerHTML = `
        <td>${escapeHtml(r.report_number)}</td>
        <td>${escapeHtml(r.report_date)}</td>
        <td>${escapeHtml(r.lpn)}</td>
        <td>${escapeHtml(r.sku)}</td>
        <td class="nc-defects-cell">${escapeHtml(defectsToLabel(r.defects, r.defect_other))}</td>
        <td>${escapeHtml(r.origin)}</td>
        <td>${escapeHtml(r.inspector)}</td>
        <td>${escapeHtml(r.received_by)}</td>
        <td><span class="nc-status-pill ${r.status}">${statusLabel}</span></td>
        <td>${r.printed_at ? escapeHtml(formatPrintStamp(r.printed_at)) : '—'}</td>
        <td>${r.reprint_count || 0}</td>
        <td class="row-actions">
          <button type="button" class="link-btn" data-action="detail" data-id="${r.id}">Ver detalle</button>
          ${r.status === 'impreso' ? `<button type="button" class="link-btn" data-action="reprint" data-id="${r.id}">Reimprimir</button>` : ''}
        </td>`;
      frag.appendChild(tr);
    });
    historyBody.appendChild(frag);
  }

  historyBody.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const id = Number(btn.dataset.id);
    const report = historyReports.find((r) => r.id === id);
    if (!report) return;

    if (btn.dataset.action === 'detail') {
      openDetailModal(report);
    } else if (btn.dataset.action === 'reprint') {
      pendingReprintReport = report;
      pendingPrintIds = null;
      closeHistoryModal();
      renderSingleReprintPreview(report);
      waitForPrintReady().then(() => window.print());
    }
  });

  historySearch.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(fetchHistory, 250);
  });
  historyDefectFilter.addEventListener('change', fetchHistory);
  historyStatusFilter.addEventListener('change', fetchHistory);
  btnRefreshHistory.addEventListener('click', fetchHistory);

  // ---- Detalle ----
  function openDetailModal(report) {
    detailBody.innerHTML = `
      <dt>ID Reporte</dt><dd>${escapeHtml(report.report_number)}</dd>
      <dt>Fecha</dt><dd>${escapeHtml(report.report_date)}</dd>
      <dt>LPN</dt><dd>${escapeHtml(report.lpn)}</dd>
      <dt>SKU</dt><dd>${escapeHtml(report.sku)}</dd>
      <dt>Defecto detectado</dt><dd>${escapeHtml(defectsToLabel(report.defects, report.defect_other))}</dd>
      <dt>Origen del hallazgo</dt><dd>${escapeHtml(report.origin)}</dd>
      <dt>Inspector</dt><dd>${escapeHtml(report.inspector)}</dd>
      <dt>Firma de recibido</dt><dd>${escapeHtml(report.received_by)}</dd>
      <dt>Estado</dt><dd>${report.status === 'impreso' ? 'Impreso' : 'Pendiente'}</dd>
      <dt>Fecha y hora de impresión</dt><dd>${report.printed_at ? escapeHtml(formatPrintStamp(report.printed_at)) : '—'}</dd>
      <dt>Reimpresiones</dt><dd>${report.reprint_count || 0}</dd>`;
    detailBackdrop.classList.remove('hidden');
    detailModal.classList.remove('hidden');
  }
  function closeDetailModal() {
    detailBackdrop.classList.add('hidden');
    detailModal.classList.add('hidden');
  }
  btnCloseDetail.addEventListener('click', closeDetailModal);
  detailBackdrop.addEventListener('click', closeDetailModal);

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!detailModal.classList.contains('hidden')) closeDetailModal();
    else if (!confirmModal.classList.contains('hidden')) { /* requiere decisión explícita */ }
    else if (!historyModal.classList.contains('hidden')) closeHistoryModal();
  });

  // ---- Inicialización ----
  dateInput.value = todayDisplayString();
  previousDateValue = dateInput.value;
  syncDefectOther();
  refreshNextNumberPreview();
  // Pinta de inmediato la hoja con los 6 espacios vacíos (no espera a que
  // cargue la cola) — si loadTray() falla por conexión, la vista previa
  // no se queda en blanco.
  renderTray();
  renderTrayPreview();
  loadTray();
})();
