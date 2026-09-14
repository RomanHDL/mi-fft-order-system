/* ==========================================================================
   Procesado VIOS a HY — hoja en blanco para llenar a mano. Sin formulario,
   sin datos capturados: sólo imprime la hoja Carta horizontal en blanco,
   igual patrón que reporte-qc-vios-hy.js. IIFE aislado, sin dependencias de
   otros módulos.
   ========================================================================== */

(function () {
  'use strict';

  const btnPrint = document.getElementById('pvh-btn-print');

  // ---- Aviso técnico si falta el logo ----
  document.querySelectorAll('img.brand-logo').forEach((img) => {
    img.addEventListener('error', () => {
      console.error(
        `[Logo] No se encontró "${img.getAttribute('src')}". Coloca el logo oficial de ` +
        'Mi Technologies en public/logo-mitech.png — aparecerá automáticamente sin tocar código.'
      );
    }, { once: true });
  });

  btnPrint.addEventListener('click', () => {
    window.print();
  });
})();
