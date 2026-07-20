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
