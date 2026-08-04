-- Esquema de referencia para la tabla de etiquetas FFT.
-- Se crea automáticamente y de forma idempotente desde api/index.js (ensureSchema),
-- este archivo queda como documentación / para ejecutarlo manualmente en Neon si se desea.
--
-- printed_at / event_type: cada fila representa un EVENTO DE IMPRESIÓN real
-- (botón Imprimir o Reimprimir), no la creación/edición de una etiqueta.
-- Filas anteriores a este cambio no tienen printed_at (quedan NULL = "heredado",
-- se muestran con su created_at en el historial) — no se les borra ni se les
-- inventa una fecha de impresión que nunca ocurrió.

CREATE TABLE IF NOT EXISTS labels (
  id          BIGSERIAL PRIMARY KEY,
  order_number TEXT NOT NULL,
  label_date  TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  TEXT,
  printed_at  TIMESTAMPTZ,
  event_type  TEXT
);

CREATE INDEX IF NOT EXISTS idx_labels_order_number ON labels (order_number);
CREATE INDEX IF NOT EXISTS idx_labels_created_at ON labels (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_labels_printed_at ON labels (printed_at DESC);

-- ==========================================================================
-- Control de Calidad - No Conforme
-- ==========================================================================
-- Cada fila es un reporte de No Conforme. Se crea con estado 'pendiente' al
-- agregarse a la bandeja de impresión (folio ya asignado, consecutivo,
-- tomado de la secuencia nc_report_seq — no se repite aunque se recargue la
-- página). Al confirmarse la impresión de la hoja pasa a 'impreso'. Una
-- reimpresión desde el historial NO crea un reporte nuevo ni cambia su folio:
-- sólo actualiza printed_at y aumenta reprint_count.

CREATE SEQUENCE IF NOT EXISTS nc_report_seq START 1;

CREATE TABLE IF NOT EXISTS nc_reports (
  id             BIGSERIAL PRIMARY KEY,
  report_number  TEXT NOT NULL UNIQUE,
  report_date    TEXT NOT NULL,
  lpn            TEXT NOT NULL,
  sku            TEXT NOT NULL,
  defects        TEXT[] NOT NULL DEFAULT '{}',
  defect_other   TEXT,
  origin         TEXT NOT NULL,
  inspector      TEXT NOT NULL,
  received_by    TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'pendiente',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by     TEXT,
  printed_at     TIMESTAMPTZ,
  reprint_count  INT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_nc_reports_status ON nc_reports (status);
CREATE INDEX IF NOT EXISTS idx_nc_reports_lpn ON nc_reports (lpn);
CREATE INDEX IF NOT EXISTS idx_nc_reports_sku ON nc_reports (sku);
CREATE INDEX IF NOT EXISTS idx_nc_reports_created_at ON nc_reports (created_at DESC);
