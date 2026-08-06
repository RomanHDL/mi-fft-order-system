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

  // Mismos campos de arriba (Turno/Fecha/Responsable) alimentando también
  // la cara frontal del modo horizontal — no hay un segundo formulario,
  // sólo un segundo destino de lectura (ver updatePreview()).
  const rphTurnoDisplay = document.getElementById('rph-turno-display');
  const rphFechaDisplay = document.getElementById('rph-fecha-display');
  const rphResponsableDisplay = document.getElementById('rph-responsable-display');

  const btnPreview = document.getElementById('rp-btn-preview');
  const btnPrint = document.getElementById('rp-btn-print');
  const btnToday = document.getElementById('rp-btn-today');

  const previewToolbar = document.getElementById('rp-preview-toolbar');
  const btnPreviewPrint = document.getElementById('rp-btn-preview-print');
  const btnPreviewClose = document.getElementById('rp-btn-preview-close');

  // ---- Selector "MODO DE IMPRESIÓN" (sólo indica cuál orientación queda
  // pre-seleccionada al abrir el modal; no oculta ninguna vista previa). ----
  const modeToggleButtons = Array.from(document.querySelectorAll('.rph-mode-btn'));
  let defaultOrientation = 'vertical';

  // ---- Modal "Elegir orientación de impresión" ----
  const orientationBackdrop = document.getElementById('rph-orientation-backdrop');
  const orientationModal = document.getElementById('rph-orientation-modal');
  const orientationClose = document.getElementById('rph-orientation-close');
  const orientationCancel = document.getElementById('rph-orientation-cancel');
  const orientationContinue = document.getElementById('rph-orientation-continue');
  const orientationCards = Array.from(document.querySelectorAll('.rph-orientation-card'));
  let selectedOrientation = null;

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
    const turno = turnoInput.value.trim() || ' ';
    const fecha = fechaInput.value.trim() || ' ';
    const responsable = responsableInput.value.trim() || ' ';
    turnoDisplay.textContent = turno;
    fechaDisplay.textContent = fecha;
    responsableDisplay.textContent = responsable;
    if (rphTurnoDisplay) rphTurnoDisplay.textContent = turno;
    if (rphFechaDisplay) rphFechaDisplay.textContent = fecha;
    if (rphResponsableDisplay) rphResponsableDisplay.textContent = responsable;
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

  // ---- Imprimir VERTICAL (sin cambios: misma función de siempre) ----
  function doPrint() {
    updatePreview();
    window.print();
  }
  // El botón "Imprimir" de la barra de captura ya no llama a doPrint()
  // directamente — primero abre el modal de orientación (ver más abajo),
  // que es quien decide si ejecuta doPrint() (vertical) o
  // doPrintHorizontal() (nuevo). El botón flotante de "Vista previa" SÍ
  // sigue llamando a doPrint() directo: esa vista previa es explícitamente
  // del modo vertical, así que "Imprimir" ahí imprime lo que se está
  // previsualizando, sin pasar por el selector de orientación.
  btnPrint.addEventListener('click', openOrientationModal);
  btnPreviewPrint.addEventListener('click', doPrint);

  // ==========================================================================
  // MODO HORIZONTAL — funcionalidad nueva y aislada. No toca doPrint() ni
  // ningún estilo/id del modo vertical (prefijo "rp-"); todo lo de aquí usa
  // el prefijo "rph-". Ver reporte-horizontal.css para el porqué del @page
  // inyectado dinámicamente en vez de vivir en un archivo cargado siempre.
  // ==========================================================================

  modeToggleButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      defaultOrientation = btn.dataset.orientation;
      modeToggleButtons.forEach((b) => b.classList.toggle('active', b === btn));
    });
  });

  function setSelectedOrientation(orientation) {
    selectedOrientation = orientation;
    orientationCards.forEach((card) => {
      card.classList.toggle('selected', card.dataset.orientation === orientation);
    });
    orientationContinue.disabled = !selectedOrientation;
  }

  function openOrientationModal() {
    setSelectedOrientation(defaultOrientation);
    orientationBackdrop.classList.remove('hidden');
    orientationModal.classList.remove('hidden');
  }
  function closeOrientationModal() {
    orientationBackdrop.classList.add('hidden');
    orientationModal.classList.add('hidden');
  }

  orientationCards.forEach((card) => {
    card.addEventListener('click', () => setSelectedOrientation(card.dataset.orientation));
  });
  orientationCancel.addEventListener('click', closeOrientationModal);
  orientationClose.addEventListener('click', closeOrientationModal);
  orientationBackdrop.addEventListener('click', closeOrientationModal);

  orientationContinue.addEventListener('click', () => {
    if (!selectedOrientation) return; // Continuar no hace nada sin selección
    const orientation = selectedOrientation;
    closeOrientationModal();
    if (orientation === 'horizontal') {
      doPrintHorizontal();
    } else {
      doPrint();
    }
  });

  // Hoja de estilos SÓLO para la impresión horizontal: se inyecta justo
  // antes de imprimir y se retira justo después (evento "afterprint"), así
  // su "@page { size: letter landscape }" nunca coexiste con el "@page
  // { size: letter portrait }" de reporte.css — quedan mutuamente
  // excluyentes en el tiempo, nunca en el mismo documento a la vez.
  const HORIZONTAL_PRINT_CSS = `
    @page { size: letter landscape; margin: 0; }
    @media print {
      html, body {
        width: 11in;
        height: auto !important;
        margin: 0 !important;
        padding: 0 !important;
        overflow: visible !important;
        background: #ffffff !important;
      }
      .no-print { display: none !important; }
      .main-content { max-width: none !important; margin: 0 !important; padding: 0 !important; }

      /* Oculta el modo VERTICAL por completo durante esta impresión */
      .rp-sheet-section, .rp-preview-panel, .rp-mode-label,
      #rp-preview-wrap-front, #rp-preview-wrap-back { display: none !important; }

      /* Restaura visibility en TODA la cadena de ancestros horizontal
         (styles.css trae un "body * { visibility: hidden }" global —
         misma lección aprendida ya en el modo vertical: no basta con
         revelar sólo la hoja, hay que revelar cada ancestro también). */
      body, .main-content, .rph-sheet-section, .rph-preview-panel,
      .rph-preview-wrap, .rph-print-page, .rph-print-page * {
        visibility: visible !important;
      }

      .rph-sheet-section, .rph-preview-panel { display: block !important; width: auto; }

      #rph-preview-wrap-front, #rph-preview-wrap-back {
        display: block !important;
        container-type: normal;
        position: static;
        width: 11in;
        height: 8.5in;
        margin: 0;
        padding: 0;
        overflow: hidden;
      }
      #rph-preview-wrap-front { page-break-after: always; break-after: page; }

      .rph-print-page {
        display: block !important;
        width: 11in;
        height: 8.5in;
        margin: 0;
        padding: 0.3in;
        box-sizing: border-box;
        overflow: hidden;
        page-break-inside: avoid;
        break-inside: avoid-page;
      }

      /* pt calibrados para 11in de ancho (11in = 792pt -> 1cqw = 7.92pt),
         mismo criterio que reporte.css usa para el vertical. */
      .rph-front-header { margin-bottom: 12.7pt; }
      .rph-front-title { font-size: 16.6pt; margin-bottom: 5.5pt; }
      .rph-front-data { font-size: 11.1pt; gap: 19pt; padding-top: 5.5pt; }
      .rph-col-title { font-size: 17.4pt; padding: 0 0 5.5pt; }

      * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  `;

  function doPrintHorizontal() {
    updatePreview();
    const styleTag = document.createElement('style');
    styleTag.id = 'rph-print-style';
    styleTag.textContent = HORIZONTAL_PRINT_CSS;
    document.head.appendChild(styleTag);

    function cleanup() {
      styleTag.remove();
      window.removeEventListener('afterprint', cleanup);
    }
    window.addEventListener('afterprint', cleanup);

    // window.print() dispara su propio layout de impresión a partir del
    // DOM/CSSOM actual en el momento en que se llama — no depende de que
    // la pantalla ya haya pintado un frame, así que no hace falta esperar
    // un requestAnimationFrame (que además puede quedar en pausa si la
    // pestaña no está visible/enfocada, retrasando la impresión sin razón).
    window.print();
  }

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!orientationModal.classList.contains('hidden')) {
      closeOrientationModal();
    } else if (document.body.classList.contains('preview-mode')) {
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
