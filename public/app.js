/* ==========================================================================
   Preparación de Tarima por FFT — lógica de la app.
   Sin frameworks, JS moderno de navegador. QRCode y XLSX se cargan
   localmente desde /vendor (sin CDN, apto para piso de producción offline).
   ========================================================================== */

(function () {
  'use strict';

  const ORDER_PATTERN = /^[A-Za-z0-9-]+$/;

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

  const searchInput = document.getElementById('search-input');
  const btnRefresh = document.getElementById('btn-refresh');
  const btnExport = document.getElementById('btn-export');
  const historyBody = document.getElementById('history-body');
  const emptyMsg = document.getElementById('empty-msg');
  const errorMsg = document.getElementById('error-msg');

  let qrInstance = null;
  let currentLabels = [];
  let searchTimer = null;

  // ---- Utilidades de fecha ----
  function pad2(n) { return n.toString().padStart(2, '0'); }

  function todayDisplayString() {
    const d = new Date();
    return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
  }

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
        width: 260,
        height: 260,
        correctLevel: QRCode.CorrectLevel.M,
      });
    } else {
      qrInstance.clear();
      qrInstance.makeCode(text);
    }
  }

  function updateLabelPreview() {
    const orderNumber = orderInput.value.trim();
    const dateValue = dateInput.value.trim();
    orderValueDisplay.textContent = orderNumber || ' ';
    fechaValueDisplay.textContent = dateValue || ' ';
    updateQr(orderNumber);
  }

  orderInput.addEventListener('input', updateLabelPreview);
  dateInput.addEventListener('input', updateLabelPreview);

  // ---- Mensajes de formulario ----
  function setFormMsg(text, isError) {
    formMsg.textContent = text || '';
    formMsg.classList.toggle('error', Boolean(isError));
    formMsg.classList.toggle('ok', !isError && Boolean(text));
  }

  // ---- Generar (POST) ----
  labelForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const orderNumber = orderInput.value.trim();
    const labelDate = dateInput.value.trim();

    if (!orderNumber || !ORDER_PATTERN.test(orderNumber)) {
      setFormMsg('El número de orden solo admite letras, números y guiones (ej. FBA12345, FFT-2026-001).', true);
      orderInput.focus();
      return;
    }
    if (!labelDate) {
      setFormMsg('La fecha es requerida.', true);
      dateInput.focus();
      return;
    }

    btnGenerate.disabled = true;
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
      setFormMsg(err.message, true);
    } finally {
      btnGenerate.disabled = false;
    }
  });

  // ---- Vista previa ----
  function openPreview() {
    updateLabelPreview();
    document.body.classList.add('preview-mode');
  }
  function closePreview() {
    document.body.classList.remove('preview-mode');
  }
  btnPreview.addEventListener('click', openPreview);
  btnPreviewClose.addEventListener('click', closePreview);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.body.classList.contains('preview-mode')) closePreview();
  });

  // ---- Imprimir ----
  btnPrint.addEventListener('click', () => window.print());
  btnPreviewPrint.addEventListener('click', () => window.print());

  // ---- Nueva etiqueta ----
  btnNew.addEventListener('click', () => {
    orderInput.value = '';
    dateInput.value = todayDisplayString();
    setFormMsg('', false);
    updateLabelPreview();
    closePreview();
    orderInput.focus();
  });

  // ---- Historial ----
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
      updateLabelPreview();
      openPreview();
    } else if (btn.dataset.action === 'delete') {
      if (!confirm(`¿Eliminar la etiqueta de la orden "${label.order_number}"? Esta acción no se puede deshacer.`)) return;
      try {
        const res = await fetch('/api/labels?id=' + id, { method: 'DELETE' });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo eliminar.');
        fetchHistory(searchInput.value.trim());
      } catch (err) {
        alert('No se pudo eliminar el registro: ' + err.message);
      }
    }
  });

  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => fetchHistory(searchInput.value.trim()), 250);
  });

  btnRefresh.addEventListener('click', () => fetchHistory(searchInput.value.trim()));

  // ---- Exportar a Excel ----
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
  dateInput.value = todayDisplayString();
  updateLabelPreview();
  fetchHistory('');
})();
