/* ==========================================================================
   Reporte de Producción de Paletizado — lógica de esta hoja.
   Página independiente de la etiqueta FFT (index.html/app.js): no comparte
   historial ni base de datos, es sólo una hoja imprimible con Turno/Fecha/
   Responsable + las columnas TRG / Almacén en blanco para llenar a mano.
   ========================================================================== */

(function () {
  'use strict';

  const turnoInput = document.getElementById('rp-turno');
  const fechaInput = document.getElementById('rp-fecha');
  const responsableInput = document.getElementById('rp-responsable');

  const turnoDisplay = document.getElementById('rp-turno-display');
  const fechaDisplay = document.getElementById('rp-fecha-display');
  const responsableDisplay = document.getElementById('rp-responsable-display');

  const btnPreview = document.getElementById('rp-btn-preview');
  const btnPrint = document.getElementById('rp-btn-print');
  const btnToday = document.getElementById('rp-btn-today');

  const previewToolbar = document.getElementById('rp-preview-toolbar');
  const btnPreviewPrint = document.getElementById('rp-btn-preview-print');
  const btnPreviewClose = document.getElementById('rp-btn-preview-close');

  document.querySelectorAll('img.brand-logo').forEach((img) => {
    img.addEventListener('error', () => {
      console.error(`[Logo] No se encontró "${img.getAttribute('src')}".`);
    }, { once: true });
  });

  // ---- Fecha de hoy (hora LOCAL del dispositivo) ----
  function pad2(n) { return n.toString().padStart(2, '0'); }
  function todayDisplayString() {
    const d = new Date();
    return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
  }

  // Mismo auto-formateo "/" que en la etiqueta FFT, por si el responsable
  // necesita imprimir el reporte de un día distinto al de hoy.
  function autoFormatDateTyping(value, previousValue) {
    let raw = value.replace(/[^0-9/]/g, '');
    if (value.length < previousValue.length) return raw;
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

  function normalizeDateSegments(raw) {
    const parts = raw.split('/');
    if (parts.length !== 3) return raw;
    let [d, m, y] = parts;
    if (d.length === 1) d = '0' + d;
    if (m.length === 1) m = '0' + m;
    return `${d}/${m}/${y}`;
  }

  function updatePreview() {
    turnoDisplay.textContent = turnoInput.value.trim() || ' ';
    fechaDisplay.textContent = fechaInput.value.trim() || ' ';
    responsableDisplay.textContent = responsableInput.value.trim() || ' ';
  }

  turnoInput.addEventListener('input', updatePreview);
  responsableInput.addEventListener('input', updatePreview);

  let previousDateValue = fechaInput.value;
  fechaInput.addEventListener('input', () => {
    const formatted = autoFormatDateTyping(fechaInput.value, previousDateValue);
    if (formatted !== fechaInput.value) fechaInput.value = formatted;
    previousDateValue = fechaInput.value;
    updatePreview();
  });
  fechaInput.addEventListener('blur', () => {
    const normalized = normalizeDateSegments(fechaInput.value.trim());
    if (normalized !== fechaInput.value) {
      fechaInput.value = normalized;
      previousDateValue = normalized;
      updatePreview();
    }
  });

  btnToday.addEventListener('click', () => {
    fechaInput.value = todayDisplayString();
    previousDateValue = fechaInput.value;
    updatePreview();
    fechaInput.focus();
  });

  // ---- Vista previa ----
  function openPreview() {
    updatePreview();
    document.body.classList.add('preview-mode');
  }
  function closePreview() {
    document.body.classList.remove('preview-mode');
  }
  btnPreview.addEventListener('click', openPreview);
  btnPreviewClose.addEventListener('click', closePreview);

  // ---- Imprimir ----
  function doPrint() {
    updatePreview();
    window.print();
  }
  btnPrint.addEventListener('click', doPrint);
  btnPreviewPrint.addEventListener('click', doPrint);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.body.classList.contains('preview-mode')) {
      closePreview();
    }
  });

  // ---- Inicialización: la fecha llega SOLA con el día de hoy, sin que
  // nadie tenga que escribirla cada turno. ----
  fechaInput.value = todayDisplayString();
  previousDateValue = fechaInput.value;
  updatePreview();
  turnoInput.focus();
})();
