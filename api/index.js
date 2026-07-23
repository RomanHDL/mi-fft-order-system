const path = require('path');
const express = require('express');
const cors = require('cors');
const { neon } = require('@neondatabase/serverless');

const app = express();
app.use(cors());
app.use(express.json());

// Sirve los archivos estáticos (index.html, css, js, logo, vendor/) — útil en
// dev local (node server.js). En Vercel, los estáticos se sirven directo
// desde /public vía vercel.json, así que esto no interfiere en producción.
app.use(express.static(path.join(__dirname, '..', 'public')));

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('[DB] Falta la variable de entorno DATABASE_URL (cadena de conexión de Neon).');
}
const sql = DATABASE_URL ? neon(DATABASE_URL) : null;

// Crea la tabla si no existe (idempotente). Se ejecuta una sola vez por
// instancia de función gracias al cacheo en `schemaReady`.
//
// `printed_at`/`event_type` se agregan con ALTER TABLE ... IF NOT EXISTS para
// no romper filas ya existentes (quedan NULL = registros heredados de cuando
// el historial se llenaba al "Generar", no al imprimir). No se borra nada.
let schemaReady = null;
async function ensureSchema() {
  if (!sql) throw new Error('DATABASE_URL no está configurada.');
  if (!schemaReady) {
    schemaReady = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS labels (
          id BIGSERIAL PRIMARY KEY,
          order_number TEXT NOT NULL,
          label_date TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          created_by TEXT
        )
      `;
      await sql`ALTER TABLE labels ADD COLUMN IF NOT EXISTS printed_at TIMESTAMPTZ`;
      await sql`ALTER TABLE labels ADD COLUMN IF NOT EXISTS event_type TEXT`;
      await sql`CREATE INDEX IF NOT EXISTS idx_labels_order_number ON labels (order_number)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_labels_created_at ON labels (created_at DESC)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_labels_printed_at ON labels (printed_at DESC)`;
    })();
  }
  return schemaReady;
}

// Acepta letras, números y guiones en cualquier combinación (FBA12345,
// FFT-2026-001, ABC123, 123456789, A1B2C3...). No se limita a solo números.
// El número de orden es OPCIONAL: vacío/ausente es válido; sólo se valida
// el patrón cuando el usuario sí escribió algo.
const ORDER_NUMBER_PATTERN = /^[A-Za-z0-9 -]+$/;

function validateOrderNumber(value) {
  if (value === undefined || value === null) return true;
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed) return true;
  return ORDER_NUMBER_PATTERN.test(trimmed);
}

// GET /api/labels?search=<texto>
// Orden: impresión más reciente primero. Los registros heredados (sin
// printed_at, de cuando el historial se llenaba al "Generar") se ordenan por
// su created_at — COALESCE evita que queden fuera de orden al fondo.
app.get('/api/labels', async (req, res) => {
  try {
    await ensureSchema();
    const search = (req.query.search || '').toString().trim();
    const rows = search
      ? await sql`
          SELECT id, order_number, label_date, created_at, created_by, printed_at, event_type
          FROM labels
          WHERE order_number ILIKE ${'%' + search + '%'}
          ORDER BY COALESCE(printed_at, created_at) DESC
          LIMIT 500
        `
      : await sql`
          SELECT id, order_number, label_date, created_at, created_by, printed_at, event_type
          FROM labels
          ORDER BY COALESCE(printed_at, created_at) DESC
          LIMIT 500
        `;
    res.json({ success: true, labels: rows });
  } catch (err) {
    console.error('[GET /api/labels]', err);
    res.status(500).json({ success: false, error: 'Error al consultar el historial.' });
  }
});

// Tipos de evento válidos para un registro del historial. 'print' = botón
// Imprimir; 'reprint' = Reimprimir desde el historial.
const EVENT_TYPES = new Set(['print', 'reprint']);

// POST /api/labels  { orderNumber, labelDate, printedAt, eventType, createdBy? }
// Cada llamada representa UN evento real de impresión (no la creación/edición
// de una etiqueta): se invoca en el instante en que el cliente dispara
// window.print(), con su propia marca de tiempo `printedAt`.
app.post('/api/labels', async (req, res) => {
  try {
    await ensureSchema();
    const { orderNumber, labelDate, createdBy, printedAt, eventType } = req.body || {};

    if (!validateOrderNumber(orderNumber)) {
      return res.status(400).json({
        success: false,
        error: 'Número de orden inválido. Usa letras, números y guiones (ej. FBA12345, FFT-2026-001, ABC123).',
      });
    }

    // El número de orden es opcional: si no se captura, se guarda vacío (no
    // se rechaza la solicitud). La fecha es opcional: si no se captura, se
    // guarda vacía (no se fuerza la fecha del día ni se rechaza la solicitud).
    const trimmedOrder = (orderNumber && String(orderNumber).trim()) || '';
    const date = (labelDate && String(labelDate).trim()) || '';

    // printedAt llega en ISO desde el cliente (hora exacta al invocar la
    // impresión). Si por algún motivo no llega, se usa la hora del servidor
    // como respaldo — nunca se deja el registro sin marca de impresión.
    const printedAtDate = printedAt ? new Date(printedAt) : null;
    const printedAtValue = printedAtDate && !isNaN(printedAtDate.getTime()) ? printedAtDate : new Date();
    const normalizedEventType = EVENT_TYPES.has(eventType) ? eventType : 'print';

    const rows = await sql`
      INSERT INTO labels (order_number, label_date, created_by, printed_at, event_type)
      VALUES (${trimmedOrder}, ${date}, ${createdBy || null}, ${printedAtValue.toISOString()}, ${normalizedEventType})
      RETURNING id, order_number, label_date, created_at, created_by, printed_at, event_type
    `;
    res.status(201).json({ success: true, label: rows[0] });
  } catch (err) {
    console.error('[POST /api/labels]', err);
    res.status(500).json({ success: false, error: 'Error al guardar la etiqueta.' });
  }
});

// DELETE /api/labels?id=<id>
app.delete('/api/labels', async (req, res) => {
  try {
    await ensureSchema();
    const id = Number(req.query.id);
    if (!id || Number.isNaN(id)) {
      return res.status(400).json({ success: false, error: 'ID inválido.' });
    }
    const rows = await sql`DELETE FROM labels WHERE id = ${id} RETURNING id`;
    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Registro no encontrado.' });
    }
    res.json({ success: true, id: rows[0].id });
  } catch (err) {
    console.error('[DELETE /api/labels]', err);
    res.status(500).json({ success: false, error: 'Error al eliminar el registro.' });
  }
});

// Diagnóstico rápido de salud / conexión a la BD.
app.get('/api/health', (req, res) => {
  res.json({ success: true, status: 'ok', dbConfigured: Boolean(DATABASE_URL) });
});

module.exports = app;
