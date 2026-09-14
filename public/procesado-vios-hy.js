/* ==========================================================================
   Procesado VIOS a HY — lógica del módulo. Sin frameworks, JS vanilla,
   aislado en su propio IIFE. No depende de app.js, reporte.js ni
   control-calidad.js, y no los modifica.
   ========================================================================== */

(function () {
  'use strict';

  const DATE_PATTERN = /^[0-9]{2}\/[0-9]{2}\/[0-9]{4}$/;

  // ---- Referencias del DOM ----
  const fechaInput = document.getElementById('pvh-fecha');
  const cantidadInput = document.getElementById('pvh-cantidad');
  const palletInput = document.getElementById('pvh-pallet');
  const responsableInput = document.getElementById('pvh-responsable');

  const printFecha = document.getElementById('pvh-print-fecha');
  const printCantidad = document.getElementById('pvh-print-cantidad');
  const printPallet = document.getElementById('pvh-print-pallet');
  const printResponsable = document.getElementById('pvh-print-responsable');

  const formMsg = document.getElementById('pvh-form-msg');
  const btnPreview = document.getElementById('pvh-btn-preview');
  const btnPrint = document.getElementById('pvh-btn-print');
  const btnToday = document.getElementById('pvh-btn-today');
  const sheetSection = document.getElementById('pvh-sheet-section');

  let printing = false;

  // ---- Aviso técnico si falta el logo ----
  document.querySelectorAll('img.brand-logo').forEach((img) => {
    img.addEventListener('error', () => {
      console.error(
        `[Logo] No se encontró "${img.getAttribute('src')}". Coloca el logo oficial de ` +
        'Mi Technologies en public/logo-mitech.png — aparecerá automáticamente sin tocar código.'
      );
    }, { once: true });
  });

  // ---- Utilidades de fecha (hora LOCAL del dispositivo) ----
  function pad2(n) { return n.toString().padStart(2, '0'); }

  function todayDisplayString() {
    const d = new Date();
    return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
  }

  // Auto-inserta "/" conforme se completan 2 dígitos de día/mes.
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

  // Completa a 2 dígitos día/mes al perder foco.
  function normalizeDateSegments(raw) {
    const parts = raw.split('/');
    if (parts.length !== 3) return raw;
    let [d, m, y] = parts;
    if (d.length === 1) d = '0' + d;
    if (m.length === 1) m = '0' + m;
    return `${d}/${m}/${y}`;
  }

  // ---- Vista previa en vivo (los valores capturados se reflejan en la hoja) ----
  function updatePreview() {
    printFecha.textContent = fechaInput.value.trim() || ' ';
    printCantidad.textContent = cantidadInput.value.trim() || ' ';
    printPallet.textContent = palletInput.value.trim() || ' ';
    printResponsable.textContent = responsableInput.value.trim() || ' ';
  }

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

  let previousDateValue = fechaInput.value;

  [cantidadInput, palletInput, responsableInput].forEach((input) => {
    input.addEventListener('input', updatePreview);
  });

  // ---- Mensajes de formulario ----
  function setFormMsg(text, isError) {
    formMsg.textContent = text || '';
    formMsg.classList.toggle('error', Boolean(isError));
    formMsg.classList.toggle('ok', !isError && Boolean(text));
  }

  function clearFieldErrors() {
    [fechaInput, cantidadInput, palletInput, responsableInput].forEach((input) => {
      input.classList.remove('pvh-field-invalid');
    });
  }

  // Valida los 4 campos obligatorios. Devuelve los datos normalizados si todo
  // es válido, o null si falta/está mal algún campo (ya deja el mensaje y el
  // foco puestos en el primer campo inválido).
  function validateForm() {
    clearFieldErrors();

    const rawDate = fechaInput.value.trim();
    if (!rawDate) {
      setFormMsg('La fecha es obligatoria.', true);
      fechaInput.classList.add('pvh-field-invalid');
      fechaInput.focus();
      return null;
    }
    const fecha = normalizeDateSegments(rawDate);
    if (!DATE_PATTERN.test(fecha)) {
      setFormMsg('La fecha debe tener formato DD/MM/AAAA.', true);
      fechaInput.classList.add('pvh-field-invalid');
      fechaInput.focus();
      return null;
    }
    if (fechaInput.value !== fecha) {
      fechaInput.value = fecha;
      previousDateValue = fecha;
    }

    const cantidadRaw = cantidadInput.value.trim();
    const cantidad = Number(cantidadRaw);
    if (!cantidadRaw || !Number.isFinite(cantidad) || cantidad <= 0) {
      setFormMsg('La cantidad es obligatoria y debe ser mayor que 0.', true);
      cantidadInput.classList.add('pvh-field-invalid');
      cantidadInput.focus();
      return null;
    }

    const pallet = palletInput.value.trim();
    if (!pallet) {
      setFormMsg('El No. de Pallet es obligatorio.', true);
      palletInput.classList.add('pvh-field-invalid');
      palletInput.focus();
      return null;
    }

    const responsable = responsableInput.value.trim();
    if (!responsable) {
      setFormMsg('El Responsable es obligatorio.', true);
      responsableInput.classList.add('pvh-field-invalid');
      responsableInput.focus();
      return null;
    }

    setFormMsg('', false);
    return { fecha, cantidad, pallet, responsable };
  }

  // ---- Vista previa (botón): valida sin bloquear, refresca y muestra la hoja ----
  btnPreview.addEventListener('click', () => {
    updatePreview();
    validateForm();
    sheetSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  // ---- Hoy ----
  btnToday.addEventListener('click', () => {
    fechaInput.value = todayDisplayString();
    previousDateValue = fechaInput.value;
    clearFieldErrors();
    setFormMsg('', false);
    updatePreview();
  });

  // ---- Imprimir ----
  function waitForPrintReady() {
    const logoImg = document.querySelector('#pvh-print-area .pvh-logo');
    if (!logoImg || logoImg.complete) return Promise.resolve();
    return new Promise((resolve) => {
      logoImg.addEventListener('load', resolve, { once: true });
      logoImg.addEventListener('error', resolve, { once: true });
    });
  }

  async function doPrint() {
    if (printing) return;
    const validated = validateForm();
    if (!validated) return; // no imprime con campos incompletos/ inválidos

    printing = true;
    try {
      updatePreview();
      await waitForPrintReady();
      window.print();
    } finally {
      printing = false;
    }
  }

  btnPrint.addEventListener('click', doPrint);

  // ---- Inicialización: la fecha aparece con el día de hoy por defecto ----
  fechaInput.value = todayDisplayString();
  previousDateValue = fechaInput.value;
  updatePreview();
})();
