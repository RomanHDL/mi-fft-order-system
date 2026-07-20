/* ==========================================================================
   Preparación de Tarima por FFT — lógica de la app.
   Sin frameworks, JS moderno de navegador. QRCode y XLSX se cargan
   localmente desde /vendor (sin CDN, apto para piso de producción offline).

   Endpoints: GET/POST/DELETE /api/labels — ver api/index.js. El POST ahora
   representa un EVENTO DE IMPRESIÓN (no la creación de la etiqueta): se
   llama en el instante en que se invoca window.print(), tanto desde
   "Imprimir" como desde "Reimprimir".
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
  const printTimestampEl = document.getElementById('print-timestamp');
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
  // Evita registrar/lanzar dos impresiones por el mismo clic (doble clic,
  // Enter repetido, o el evento disparándose más de una vez).
  let printing = false;
  // Posición de scroll de la página guardada al abrir el historial, para
  // restaurarla exactamente al cerrarlo.
  let savedScrollY = 0;

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

  // ---- Utilidades de fecha (hora LOCAL del dispositivo, sin desfase UTC) ----
  function pad2(n) { return n.toString().padStart(2, '0'); }

  function todayDisplayString() {
    const d = new Date();
    return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
  }

  function todayFileToken() {
    const d = new Date();
    return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`;
  }

  // Auto-inserta "/" conforme se completan 2 dígitos de día/mes (17 -> 17/,
  // 17072026 -> 17/07/2026). Si el usuario ya escribió "/" a mano (ej. tras un
  // solo dígito de día: "9/"), se respeta tal cual — no se reconstruye desde
  // cero, sólo se limitan longitudes por segmento. Al borrar no reformatea.
  function autoFormatDateTyping(value, previousValue) {
    let raw = value.replace(/[^0-9/]/g, '');
    if (value.length < previousValue.length) return raw; // borrando: no reformatear

    let parts = raw.split('/');
    if (parts.length === 1 && parts[0].length >= 2) {
      parts = [parts[0].slice(0, 2), parts[0].slice(2)];
    }
    if (parts.length === 2 && parts[1].length >= 2) {
      parts = [parts[0], parts[1].slice(0, 2), parts[1].slice(2)];
    }
    if (parts.length > 3) parts = parts.slice(0, 3);
    if (parts[0] !== undefined) parts[0] = parts[0].slice(0, 2);
    if (parts[1] !== undefined) parts[1] = parts[1].slice(0, 2);
    if (parts[2] !== undefined) parts[2] = parts[2].slice(0, 4);
    return parts.join('/');
  }

  // Si día o mes quedaron con un solo dígito (ej. "9/4/2026"), los completa a
  // dos dígitos ("09/04/2026"). El año nunca se rellena (siempre son 4 dígitos).
  function normalizeDateSegments(raw) {
    const parts = raw.split('/');
    if (parts.length !== 3) return raw;
    let [d, m, y] = parts;
    if (d.length === 1) d = '0' + d;
    if (m.length === 1) m = '0' + m;
    return `${d}/${m}/${y}`;
  }

  // Formatea una marca de tiempo (impresión real o, para registros heredados,
  // created_at) en horario de Monterrey/Escobedo, es-MX: "20/07/2026 08:13".
  // Valor vacío/ inválido -> '' (nunca "Invalid Date" en pantalla).
  function formatPrintStamp(value) {
    if (!value) return '';
    const d = new Date(value);
    if (isNaN(d.getTime())) return '';
    const parts = new Intl.DateTimeFormat('es-MX', {
      timeZone: 'America/Monterrey',
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(d);
    const get = (type) => {
      const found = parts.find((p) => p.type === type);
      return found ? found.value : '';
    };
    let hour = get('hour');
    if (hour === '24') hour = '00'; // Intl con hour12:false a veces da "24" en medianoche
    return `${get('day')}/${get('month')}/${get('year')} ${hour}:${get('minute')}`;
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

  // Fecha automática (hoy) pero editable: mientras se escribe, se auto-inserta
  // "/" conforme avanzan los dígitos. Al salir del campo se completan con cero
  // los segmentos de un solo dígito (día/mes), nunca el año.
  let previousDateValue = dateInput.value;
  dateInput.addEventListener('input', () => {
    const formatted = autoFormatDateTyping(dateInput.value, previousDateValue);
    if (formatted !== dateInput.value) dateInput.value = formatted;
    previousDateValue = dateInput.value;
    updateLabelPreview();
  });
  dateInput.addEventListener('blur', () => {
    const normalized = normalizeDateSegments(dateInput.value.trim());
    if (normalized !== dateInput.value) {
      dateInput.value = normalized;
      previousDateValue = normalized;
      updateLabelPreviewImmediate();
    }
  });

  // ---- Mensajes de formulario ----
  function setFormMsg(text, isError) {
    formMsg.textContent = text || '';
    formMsg.classList.toggle('error', Boolean(isError));
    formMsg.classList.toggle('ok', !isError && Boolean(text));
  }

  // Validación compartida (Generar e Imprimir). El número de orden es
  // OPCIONAL, igual que la fecha: puede quedar vacío y eso NO bloquea nada —
  // sólo se valida el formato si el usuario sí escribió algo.
  function validateOrderAndDate() {
    const orderNumber = normalizeOrderValue(orderInput.value.trim());

    if (orderNumber && !ORDER_PATTERN.test(orderNumber)) {
      setFormMsg('El número de orden solo admite letras, números y guiones (ej. FBA12345, FFT-2026-001).', true);
      orderInput.focus();
      return null;
    }

    const rawDate = dateInput.value.trim();
    let labelDate = '';
    if (rawDate) {
      labelDate = normalizeDateSegments(rawDate);
      if (!DATE_PATTERN.test(labelDate)) {
        setFormMsg('La fecha debe tener formato DD/MM/AAAA, o déjala vacía si no aplica.', true);
        dateInput.focus();
        return null;
      }
      if (dateInput.value !== labelDate) {
        dateInput.value = labelDate;
        updateLabelPreviewImmediate();
      }
    }

    return { orderNumber, labelDate };
  }

  // ---- Generar ----
  // El historial ahora registra IMPRESIONES reales, no la creación de la
  // etiqueta: "Generar" ya no guarda nada en la base de datos, sólo valida
  // los datos capturados y confirma que la hoja está lista. El registro real
  // ocurre en doPrint(), al presionar Imprimir/Reimprimir.
  labelForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const validated = validateOrderAndDate();
    if (!validated) return; // mantiene lo que el usuario ya escribió
    setFormMsg('Etiqueta lista. Presiona Imprimir para generarla y registrarla en el historial.', false);
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

  // Registra el evento de impresión (POST /api/labels) con su propia marca
  // de tiempo. Si falla la escritura en el historial, la impresión continúa
  // igual — nunca se le impide imprimir al usuario por un error de red/BD.
  async function recordPrint(orderNumber, labelDate, printedAtIso, eventType) {
    try {
      const res = await fetch('/api/labels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderNumber, labelDate, printedAt: printedAtIso, eventType }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo registrar en el historial.');
      return true;
    } catch (err) {
      console.error('[recordPrint]', err);
      return false;
    }
  }

  // Núcleo del flujo de impresión/reimpresión. `eventType` es 'print' (botón
  // Imprimir) o 'reprint' (Reimprimir desde el historial). La fecha/hora de
  // impresión se calcula AQUÍ, en el instante exacto de la llamada — nunca se
  // reutiliza una fecha guardada de Generar/Vista previa/una reimpresión
  // anterior. `printing` evita registrar o lanzar dos impresiones por el
  // mismo clic (doble clic, listeners repetidos, solicitudes simultáneas).
  async function doPrint(eventType) {
    if (printing) return;
    const validated = validateOrderAndDate();
    if (!validated) return; // no imprime con datos inválidos
    const { orderNumber, labelDate } = validated;

    printing = true;
    try {
      const printedAtIso = new Date().toISOString();
      printTimestampEl.textContent = 'FECHA Y HORA DE IMPRESIÓN: ' + formatPrintStamp(printedAtIso);

      const recorded = await recordPrint(orderNumber, labelDate, printedAtIso, eventType);
      if (!recorded) {
        setFormMsg('No se pudo registrar en el historial; la etiqueta se imprimirá igual.', true);
      }

      await waitForPrintReady();
      window.print();

      fetchHistory(searchInput.value.trim());
    } finally {
      printing = false;
    }
  }

  btnPrint.addEventListener('click', () => doPrint('print'));
  btnPreviewPrint.addEventListener('click', () => doPrint('print'));

  // ---- Nueva etiqueta ----
  btnNew.addEventListener('click', () => {
    orderInput.value = '';
    dateInput.value = '';
    previousDateValue = dateInput.value;
    printTimestampEl.textContent = '';
    setFormMsg('', false);
    updateLabelPreviewImmediate();
    closePreview();
    orderInput.focus();
  });

  // ---- Modal de historial ----
  // Bloquea el scroll de la página de atrás mientras el modal está abierto:
  // fija el <body> en su posición actual (position:fixed + top negativo) en
  // vez de sólo poner overflow:hidden, que en iOS/Safari no impide el scroll
  // táctil. Al cerrar, se restaura exactamente el scroll donde estaba.
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
    fetchHistory(searchInput.value.trim());
    searchInput.focus();
  }
  function closeHistoryModal() {
    historyModal.classList.add('hidden');
    historyBackdrop.classList.add('hidden');
    unlockBodyScroll();
    // preventScroll: true — un focus() normal desplaza la página para poner
    // el botón a la vista, deshaciendo la posición de scroll recién
    // restaurada (Req 1.4: "la página debe regresar EXACTAMENTE").
    btnHistory.focus({ preventScroll: true });
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

  // ---- Historial (GET/DELETE /api/labels) ----
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
      // Registros heredados (de antes de este cambio) no tienen printed_at:
      // se muestran con su created_at, marcados como "(heredado)" — nunca se
      // afirma que fueron una impresión confirmada.
      const printedCell = label.printed_at
        ? escapeHtml(formatPrintStamp(label.printed_at))
        : `${escapeHtml(formatPrintStamp(label.created_at))} <span class="legacy-tag">(heredado)</span>`;
      tr.innerHTML = `
        <td>${escapeHtml(label.order_number)}</td>
        <td>${escapeHtml(label.label_date)}</td>
        <td>${printedCell}</td>
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
      // Reimprimir carga los datos exactos de esa etiqueta, cierra el
      // historial e imprime de inmediato con una fecha/hora nueva — no abre
      // sólo la vista previa. doPrint() ya protege contra doble clic
      // (bandera `printing`), así que un segundo clic aquí no duplica el evento.
      orderInput.value = label.order_number || '';
      dateInput.value = label.label_date || '';
      updateLabelPreviewImmediate();
      closeHistoryModal();
      doPrint('reprint');
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

  // ---- Exportar a Excel (SheetJS) ----
  btnExport.addEventListener('click', () => {
    if (!currentLabels.length) {
      alert('No hay etiquetas en el historial actual para exportar.');
      return;
    }
    const rows = currentLabels.map((l) => ({
      'No. de Orden': l.order_number,
      'Fecha de Etiqueta': l.label_date,
      'Fecha y Hora de Impresión': l.printed_at
        ? formatPrintStamp(l.printed_at)
        : formatPrintStamp(l.created_at) + ' (heredado)',
      'Tipo de Evento': l.printed_at
        ? (l.event_type === 'reprint' ? 'Reimpresión' : 'Impresión')
        : 'Heredado',
      'Usuario': l.created_by || '',
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Etiquetas FFT');
    XLSX.writeFile(wb, `etiquetas-fft-${todayFileToken()}.xlsx`);
  });

  // ---- Inicialización ----
  dateInput.value = '';
  previousDateValue = dateInput.value;
  updateLabelPreviewImmediate();
  fetchHistory('');
  orderInput.focus();
})();
