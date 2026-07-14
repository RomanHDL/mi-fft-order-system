-- Esquema de referencia para la tabla de etiquetas FFT.
-- Se crea automáticamente y de forma idempotente desde api/index.js (ensureSchema),
-- este archivo queda como documentación / para ejecutarlo manualmente en Neon si se desea.

CREATE TABLE IF NOT EXISTS labels (
  id          BIGSERIAL PRIMARY KEY,
  order_number TEXT NOT NULL,
  label_date  TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  TEXT
);

CREATE INDEX IF NOT EXISTS idx_labels_order_number ON labels (order_number);
CREATE INDEX IF NOT EXISTS idx_labels_created_at ON labels (created_at DESC);
