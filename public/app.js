/* ==========================================================================
   Preparación de Tarima por FFT — lógica de la app.
   Sin frameworks, JS moderno de navegador. QRCode y XLSX se cargan
   localmente desde /vendor (sin CDN, apto para piso de producción offline).

   Endpoints (sin cambios): GET/POST/DELETE /api/labels — ver api/index.js
   ========================================================================== */

(function () {
  'use strict';

  const ORDER_PATTERN = /^[A-Za-z0-9-]+$/;
  const DATE_PATTERN = /^[0-9]{2}\/[0-9]{2}\/[0-9]{4}$/;
  const QR_DEBOUNCE_MS = 200;

  // ---- Referencias del DOM ----
  const orderInput = document.getElementById('order-number');
  const dateInput = document.getElementById('label-date');
  const orderValueDisplay = document.getElementById('order-value-display');
  const fechaValueDisplay = document.getElementById('fecha-value-display');
  const qrCanvasEl = document.getElementById('qr-canvas');

  const labelForm = document.getElementById('label-form');
  const formMsg = document.getElementById('form-msg');
  const btnGenerate = document.getElementById('btn-generate');
  const btnPreview = document.getElementById('btn-preview');
  const btnPrint = document.getElementById('btn-print');
  const btnNew = document.getElementById('btn-new');

  const previewToolbar = document.getElementById('preview-toolbar');
  const btnPreviewPrint = document.getElementById('btn-preview-print');
  const btnPreviewClose = document.getElementById('btn-preview-close');

  const btnHistory = document.getElementById('btn-history');
  const historyModal = document.getElementById('history-modal');
  const historyBackdrop = document.getElementById('history-backdrop');
  const btnCloseHistory = document.getElementById('btn-close-history');

  const searchInput = document.getElementById('search-input');
  const btnRefresh = document.getElementById('btn-refresh');
  const btnExport = document.getElementById('btn-export');
  const historyBody = document.getElementById('history-body');
  const emptyMsg = document.getElementById('empty-msg');
  const errorMsg = document.getElementById('error-msg');

  let qrInstance = null;
  let qrDebounceTimer = null;
  let currentLabels = [];
  let searchTimer = null;

  // ---- Aviso técnico si falta el logo (el componente queda listo para
  // cargarlo automáticamente en cuanto el archivo exista en /public). ----
  document.querySelectorAll('img.brand-logo').forEach((img) => {
    img.addEventListener('error', () => {
      console.error(
        `[Logo] No se encontró "${img.getAttribute('src')}". Coloca el logo oficial de ` +
        'Mi Technologies en public/logo-mitech.png — aparecerá automáticamente sin tocar código.'
      );
    }, { once: true });
  });

  // ---- Utilidades de fecha ----
  function pad2(n) { return n.toString().padStart(2, '0'); }

  function todayFileToken() {
    const d = new Date();
    return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`;
  }

  function formatCreatedAt(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[ch]));
  }

  // ---- Normalización del No. de Orden: mayúsculas, sin espacios, sólo
  // letras/números/guiones (evita caracteres innecesarios desde que se escriben) ----
  function normalizeOrderValue(raw) {
    return raw.toUpperCase().replace(/[^A-Z0-9-]/g, '');
  }

  // ---- Etiqueta / QR en vivo ----
  function updateQr(text) {
    if (!text) {
      qrCanvasEl.innerHTML = '';
      qrInstance = null;
      return;
    }
    if (!qrInstance) {
      qrCanvasEl.innerHTML = '';
      qrInstance = new QRCode(qrCanvasEl, {
        text,
        // Resolución nativa alta (no sólo el tamaño en CSS) para que el QR
        // no se vea borroso al imprimirse más grande en la hoja Carta.
        width: 480,
        height: 480,
        correctLevel: QRCode.CorrectLevel.M,
      });
    } else {
      qrInstance.clear();
      qrInstance.makeCode(text);
    }
  }

  function scheduleQrUpdate(text) {
    clearTimeout(qrDebounceTimer);
    qrDebounceTimer = setTimeout(() => updateQr(text), QR_DEBOUNCE_MS);
  }

  // Actualiza el texto (número/fecha) al instante; el QR se regenera con
  // debounce mientras se escribe para no saturar en cada tecla.
  function updateLabelPreview() {
    const orderNumber = orderInput.value.trim();
    const dateValue = dateInput.value.trim();
    orderValueDisplay.textContent = orderNumber || ' ';
    fechaValueDisplay.textContent = dateValue || ' ';
    scheduleQrUpdate(orderNumber);
  }

  // Variante sin debounce: usada en acciones puntuales (nueva etiqueta,
  // reimprimir, abrir vista previa) donde el QR debe verse correcto de inmediato.
  function updateLabelPreviewImmediate() {
    const orderNumber = orderInput.value.trim();
    const dateValue = dateInput.value.trim();
    orderValueDisplay.textContent = orderNumber || ' ';
    fechaValueDisplay.textContent = dateValue || ' ';
    clearTimeout(qrDebounceTimer);
    updateQr(orderNumber);
  }

  orderInput.addEventListener('input', () => {
    const normalized = normalizeOrderValue(orderInput.value);
    if (normalized !== orderInput.value) orderInput.value = normalized;
    updateLabelPreview();
  });

  // La fecha ya NO se genera automáticamente: el usuario la escribe a mano.
  // Sólo se permite dígitos y "/" mientras escribe; el formato completo
  // (DD/MM/AAAA) se valida antes de Generar/Imprimir.
  dateInput.addEventListener('input', () => {
    const filtered = dateInput.value.replace(/[^0-9/]/g, '');
    if (filtered !== dateInput.value) dateInput.value = filtered;
    updateLabelPreview();
  });

  // ---- Mensajes de formulario ----
  function setFormMsg(text, isError) {
    formMsg.textContent = text || '';
    formMsg.classList.toggle('error', Boolean(isError));
    formMsg.classList.toggle('ok', !isError && Boolean(text));
  }

  // Validación compartida (Generar e Imprimir la requieren por igual). La
  // fecha ya no se autocompleta: debe existir y cumplir DD/MM/AAAA.
  function validateOrderAndDate() {
    const orderNumber = normalizeOrderValue(orderInput.value.trim());
    const labelDate = dateInput.value.trim();

    if (!orderNumber || !ORDER_PATTERN.test(orderNumber)) {
      setFormMsg('El número de orden solo admite letras, números y guiones (ej. FBA12345, FFT-2026-001).', true);
      orderInput.focus();
      return null;
    }
    if (!labelDate || !DATE_PATTERN.test(labelDate)) {
      setFormMsg('Ingresa la fecha en formato DD/MM/AAAA.', true);
      dateInput.focus();
      return null;
    }
    return { orderNumber, labelDate };
  }

  // ---- Generar (POST /api/labels — sin cambios de endpoint/lógica) ----
  labelForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (btnGenerate.disabled) return; // evita doble envío por doble clic/Enter

    const validated = validateOrderAndDate();
    if (!validated) return; // no guarda: mantiene lo que el usuario ya escribió
    const { orderNumber, labelDate } = validated;

    btnGenerate.disabled = true;
    const originalLabel = btnGenerate.textContent;
    btnGenerate.textContent = 'Guardando…';
    setFormMsg('Guardando…', false);
    try {
      const res = await fetch('/api/labels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderNumber, labelDate }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo generar la etiqueta.');
      setFormMsg('Etiqueta generada y guardada en el historial. Ya puedes imprimirla.', false);
      fetchHistory(searchInput.value.trim());
    } catch (err) {
      console.error('[Generar]', err);
      setFormMsg(err.message, true);
    } finally {
      btnGenerate.disabled = false;
      btnGenerate.textContent = originalLabel;
    }
  });

  // ---- Vista previa ----
  function openPreview() {
    updateLabelPreviewImmediate();
    document.body.classList.add('preview-mode');
  }
  function closePreview() {
    document.body.classList.remove('preview-mode');
  }
  btnPreview.addEventListener('click', openPreview);
  btnPreviewClose.addEventListener('click', closePreview);

  // ---- Imprimir ----
  // Espera a que el logo (imagen real) termine de cargar antes de imprimir,
  // para evitar que salga en blanco en la primera impresión. El QR ya se
  // dibuja de forma síncrona en el DOM, no requiere espera adicional.
  function waitForPrintReady() {
    const logoImg = document.querySelector('.print-area .label-logo');
    if (!logoImg || logoImg.complete) return Promise.resolve();
    return new Promise((resolve) => {
      logoImg.addEventListener('load', resolve, { once: true });
      logoImg.addEventListener('error', resolve, { once: true });
    });
  }

  async function handlePrintClick() {
    if (!validateOrderAndDate()) return; // no imprime con datos vacíos/inválidos
    await waitForPrintReady();
    window.print();
  }

  btnPrint.addEventListener('click', handlePrintClick);
  btnPreviewPrint.addEventListener('click', handlePrintClick);

  // ---- Nueva etiqueta ----
  btnNew.addEventListener('click', () => {
    orderInput.value = '';
    dateInput.value = ''; // la fecha ya no se autocompleta: queda vacía para escribirla a mano
    setFormMsg('', false);
    updateLabelPreviewImmediate();
    closePreview();
    orderInput.focus();
  });

  // ---- Modal de historial ----
  function openHistoryModal() {
    historyModal.classList.remove('hidden');
    historyBackdrop.classList.remove('hidden');
    fetchHistory(searchInput.value.trim());
    searchInput.focus();
  }
  function closeHistoryModal() {
    historyModal.classList.add('hidden');
    historyBackdrop.classList.add('hidden');
    btnHistory.focus();
  }
  btnHistory.addEventListener('click', openHistoryModal);
  btnCloseHistory.addEventListener('click', closeHistoryModal);
  historyBackdrop.addEventListener('click', closeHistoryModal);

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (document.body.classList.contains('preview-mode')) {
      closePreview();
    } else if (!historyModal.classList.contains('hidden')) {
      closeHistoryModal();
    }
  });

  // ---- Historial (GET/DELETE /api/labels — sin cambios de endpoint/lógica) ----
  async function fetchHistory(search) {
    try {
      const url = '/api/labels' + (search ? '?search=' + encodeURIComponent(search) : '');
      const res = await fetch(url);
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Error al cargar historial.');
      renderHistory(data.labels || []);
      errorMsg.classList.add('hidden');
    } catch (err) {
      console.error('[fetchHistory]', err);
      currentLabels = [];
      historyBody.innerHTML = '';
      emptyMsg.classList.add('hidden');
      errorMsg.classList.remove('hidden');
    }
  }

  function renderHistory(labels) {
    currentLabels = labels;
    historyBody.innerHTML = '';

    if (!labels.length) {
      emptyMsg.classList.remove('hidden');
      return;
    }
    emptyMsg.classList.add('hidden');

    const frag = document.createDocumentFragment();
    labels.forEach((label) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escapeHtml(label.order_number)}</td>
        <td>${escapeHtml(label.label_date)}</td>
        <td>${formatCreatedAt(label.created_at)}</td>
        <td class="row-actions">
          <button type="button" class="link-btn" data-action="reprint" data-id="${label.id}">Reimprimir</button>
          <button type="button" class="link-btn danger" data-action="delete" data-id="${label.id}">Eliminar</button>
        </td>`;
      frag.appendChild(tr);
    });
    historyBody.appendChild(frag);
  }

  historyBody.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const id = btn.dataset.id;
    // Los IDs que devuelve Neon llegan como string (bigint serializado); comparar
    // como string evita fallos de igualdad estricta contra number.
    const label = currentLabels.find((l) => String(l.id) === String(id));
    if (!label) return;

    if (btn.dataset.action === 'reprint') {
      orderInput.value = label.order_number;
      dateInput.value = label.label_date;
      closeHistoryModal();
      openPreview();
    } else if (btn.dataset.action === 'delete') {
      if (!confirm(`¿Eliminar la etiqueta de la orden "${label.order_number}"? Esta acción no se puede deshacer.`)) return;
      btn.disabled = true;
      try {
        const res = await fetch('/api/labels?id=' + id, { method: 'DELETE' });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo eliminar.');
        fetchHistory(searchInput.value.trim());
      } catch (err) {
        console.error('[Eliminar]', err);
        alert('No se pudo eliminar el registro: ' + err.message);
        btn.disabled = false;
      }
    }
  });

  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => fetchHistory(searchInput.value.trim()), 250);
  });

  btnRefresh.addEventListener('click', () => fetchHistory(searchInput.value.trim()));

  // ---- Exportar a Excel (SheetJS — sin cambios de lógica) ----
  btnExport.addEventListener('click', () => {
    if (!currentLabels.length) {
      alert('No hay etiquetas en el historial actual para exportar.');
      return;
    }
    const rows = currentLabels.map((l) => ({
      'No. de Orden': l.order_number,
      'Fecha': l.label_date,
      'Creado': formatCreatedAt(l.created_at),
      'Usuario': l.created_by || '',
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Etiquetas FFT');
    XLSX.writeFile(wb, `etiquetas-fft-${todayFileToken()}.xlsx`);
  });

  // ---- Inicialización ----
  // La fecha ya no se autocompleta: queda vacía hasta que el usuario la escriba.
  updateLabelPreviewImmediate();
  fetchHistory('');
  orderInput.focus();
})();
