// Reporte QC - VIOS / HY — módulo 4.
// Sin captura de datos ni base de datos: son etiquetas EN BLANCO que se
// imprimen 6 por hoja (igual que Control de Calidad) para que el inspector
// las llene a mano en línea (Serial, Pallet, Fecha, Observaciones, Inspector).
(function () {
  const printArea = document.getElementById('qc-print-area');
  const template = document.getElementById('qc-label-template');
  const btnPrint = document.getElementById('qc-btn-print');

  // Clona la única plantilla 6 veces — una fuente de verdad para las 6
  // etiquetas idénticas de la hoja, en vez de repetir el HTML a mano.
  for (let i = 0; i < 6; i++) {
    printArea.appendChild(template.content.cloneNode(true));
  }
  template.remove();

  btnPrint.addEventListener('click', () => {
    window.print();
  });
})();
