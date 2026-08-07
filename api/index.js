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

      // Control de Calidad - No Conforme. Ver db/schema.sql para el detalle
      // completo; se crea aquí también para que quede lista sin migraciones
      // manuales, igual que `labels`.
      await sql`CREATE SEQUENCE IF NOT EXISTS nc_report_seq START 1`;
      await sql`
        CREATE TABLE IF NOT EXISTS nc_reports (
          id BIGSERIAL PRIMARY KEY,
          report_number TEXT NOT NULL UNIQUE,
          report_date TEXT NOT NULL,
          lpn TEXT NOT NULL,
          sku TEXT NOT NULL,
          defects TEXT[] NOT NULL DEFAULT '{}',
          defect_other TEXT,
          origin TEXT NOT NULL,
          inspector TEXT NOT NULL,
          received_by TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pendiente',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          created_by TEXT,
          printed_at TIMESTAMPTZ,
          reprint_count INT NOT NULL DEFAULT 0
        )
      `;
      await sql`CREATE INDEX IF NOT EXISTS idx_nc_reports_status ON nc_reports (status)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_nc_reports_lpn ON nc_reports (lpn)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_nc_reports_sku ON nc_reports (sku)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_nc_reports_created_at ON nc_reports (created_at DESC)`;
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

// ==========================================================================
// Control de Calidad - No Conforme
// ==========================================================================

const NC_DEFECT_KEYS = new Set([
  'duplicado',
  'pulgada_incorrecta',
  'clasificacion_incorrecta',
  'marca_incorrecta',
  'caida',
  'salida',
  'otro',
]);

function cleanText(value) {
  return (value && String(value).trim()) || '';
}

// Valida el cuerpo de un reporte de No Conforme. Devuelve { error } si algo
// falta o es inválido, o los campos ya normalizados listos para insertar.
function validateNcReportBody(body) {
  const reportDate = cleanText(body.reportDate);
  const lpn = cleanText(body.lpn);
  const sku = cleanText(body.sku);
  const origin = cleanText(body.origin);
  const inspector = cleanText(body.inspector);
  const receivedBy = cleanText(body.receivedBy);
  const defectOtherRaw = cleanText(body.defectOther);

  const defects = Array.isArray(body.defects)
    ? [...new Set(body.defects.map((d) => String(d).trim().toLowerCase()))].filter(Boolean)
    : [];

  if (!reportDate) return { error: 'La fecha es obligatoria.' };
  if (!lpn) return { error: 'El LPN es obligatorio.' };
  if (!sku) return { error: 'El SKU es obligatorio.' };
  if (!defects.length) return { error: 'Selecciona al menos un defecto detectado.' };
  if (!defects.every((d) => NC_DEFECT_KEYS.has(d))) return { error: 'Defecto detectado inválido.' };
  if (!origin) return { error: 'El origen del hallazgo es obligatorio.' };
  if (!inspector) return { error: 'El inspector es obligatorio.' };
  if (!receivedBy) return { error: 'La firma de recibido es obligatoria.' };
  if (defects.includes('otro') && !defectOtherRaw) {
    return { error: 'Especifica el defecto cuando seleccionas "Otro".' };
  }

  // Orden estable para que la comparación de duplicados sea consistente sin
  // importar el orden en que se marcaron las casillas en el formulario.
  defects.sort();

  return {
    reportDate,
    lpn,
    sku,
    origin,
    inspector,
    receivedBy,
    defects,
    defectOther: defects.includes('otro') ? defectOtherRaw : null,
  };
}

// GET /api/nc-reports?status=pendiente|impreso|all&search=&date=&defect=
// Sin status (u "otro" valor) devuelve todo; usado tanto por la bandeja
// (status=pendiente) como por el historial (status=all + filtros).
app.get('/api/nc-reports', async (req, res) => {
  try {
    await ensureSchema();
    const status = cleanText(req.query.status) || 'all';
    const search = cleanText(req.query.search);
    const date = cleanText(req.query.date);
    const defect = cleanText(req.query.defect).toLowerCase();

    const rows = await sql`
      SELECT id, report_number, report_date, lpn, sku, defects, defect_other,
             origin, inspector, received_by, status, created_at, created_by,
             printed_at, reprint_count
      FROM nc_reports
      WHERE (${status} = 'all' OR status = ${status})
        AND (${search} = '' OR report_number ILIKE ${'%' + search + '%'}
             OR lpn ILIKE ${'%' + search + '%'} OR sku ILIKE ${'%' + search + '%'})
        AND (${date} = '' OR report_date = ${date})
        AND (${defect} = '' OR ${defect} = ANY(defects))
      ORDER BY COALESCE(printed_at, created_at) DESC
      LIMIT 500
    `;
    res.json({ success: true, reports: rows });
  } catch (err) {
    console.error('[GET /api/nc-reports]', err);
    res.status(500).json({ success: false, error: 'Error al consultar los reportes de No Conforme.' });
  }
});

// GET /api/nc-reports/next-number
// Sólo para mostrar en pantalla el folio que se asignará al siguiente
// reporte (campo "ID Reporte", deshabilitado). NO consume la secuencia — el
// folio real y definitivo se asigna con nextval() dentro de POST /api/nc-reports.
app.get('/api/nc-reports/next-number', async (req, res) => {
  try {
    await ensureSchema();
    const rows = await sql`
      SELECT CASE WHEN is_called THEN last_value + 1 ELSE last_value END AS n
      FROM nc_report_seq
    `;
    const n = rows[0] ? Number(rows[0].n) : 1;
    res.json({ success: true, reportNumber: 'NC-' + String(n).padStart(6, '0') });
  } catch (err) {
    console.error('[GET /api/nc-reports/next-number]', err);
    res.status(500).json({ success: false, error: 'Error al calcular el siguiente folio.' });
  }
});

// GET /api/nc-reports/lookup-sku?lpn=<lpn>
// No existe en el proyecto un catálogo/API externa de SKUs por LPN; el mejor
// dato "ya disponible" es el propio historial de Control de Calidad — si ese
// LPN ya se reportó antes, se reutiliza el SKU capturado la última vez. Si no
// hay coincidencia, el frontend deja el campo abierto para captura manual.
app.get('/api/nc-reports/lookup-sku', async (req, res) => {
  try {
    await ensureSchema();
    const lpn = cleanText(req.query.lpn);
    if (!lpn) return res.json({ success: true, sku: null });
    const rows = await sql`
      SELECT sku FROM nc_reports WHERE lpn ILIKE ${lpn} ORDER BY created_at DESC LIMIT 1
    `;
    res.json({ success: true, sku: rows[0] ? rows[0].sku : null });
  } catch (err) {
    console.error('[GET /api/nc-reports/lookup-sku]', err);
    res.status(500).json({ success: false, error: 'Error al buscar el SKU.' });
  }
});

// POST /api/nc-reports  { reportDate, lpn, sku, defects[], defectOther, origin, inspector, receivedBy, createdBy? }
// Crea el reporte YA en la bandeja (status='pendiente') con folio consecutivo
// asignado en este momento (nc_report_seq) — así el folio nunca se repite ni
// se pierde al recargar la página, y la bandeja sobrevive el reload al vivir
// en la base de datos, no en memoria.
app.post('/api/nc-reports', async (req, res) => {
  try {
    await ensureSchema();
    const validated = validateNcReportBody(req.body || {});
    if (validated.error) {
      return res.status(400).json({ success: false, error: validated.error });
    }
    const { reportDate, lpn, sku, origin, inspector, receivedBy, defects, defectOther } = validated;
    const createdBy = cleanText(req.body && req.body.createdBy) || null;

    // Evita registrar dos veces exactamente el mismo reporte por error
    // (doble clic, doble submit): mismo LPN/SKU/defectos/origen/inspector/
    // recibido/fecha, todavía pendiente de imprimir.
    const dup = await sql`
      SELECT id FROM nc_reports
      WHERE status = 'pendiente' AND lpn = ${lpn} AND sku = ${sku} AND origin = ${origin}
        AND inspector = ${inspector} AND received_by = ${receivedBy} AND report_date = ${reportDate}
        AND defects = ${defects}::text[]
      LIMIT 1
    `;
    if (dup.length) {
      return res.status(409).json({
        success: false,
        error: 'Ya existe un reporte idéntico en la bandeja de impresión (mismo LPN, SKU, defecto(s), origen, inspector y recibido).',
      });
    }

    const seqRows = await sql`SELECT nextval('nc_report_seq') AS n`;
    const reportNumber = 'NC-' + String(seqRows[0].n).padStart(6, '0');

    const rows = await sql`
      INSERT INTO nc_reports
        (report_number, report_date, lpn, sku, defects, defect_other, origin, inspector, received_by, created_by)
      VALUES
        (${reportNumber}, ${reportDate}, ${lpn}, ${sku}, ${defects}::text[], ${defectOther}, ${origin}, ${inspector}, ${receivedBy}, ${createdBy})
      RETURNING id, report_number, report_date, lpn, sku, defects, defect_other,
                origin, inspector, received_by, status, created_at, created_by,
                printed_at, reprint_count
    `;
    res.status(201).json({ success: true, report: rows[0] });
  } catch (err) {
    console.error('[POST /api/nc-reports]', err);
    res.status(500).json({ success: false, error: 'Error al guardar el reporte de No Conforme.' });
  }
});

// POST /api/nc-reports/print  { ids: [1,2,3] }
// Marca como 'impreso' (primera impresión) los reportes pendientes indicados
// y los retira de la bandeja. Sólo toca filas que sigan 'pendiente' — si
// alguna ya se imprimió por otra sesión mientras tanto, no se duplica.
app.post('/api/nc-reports/print', async (req, res) => {
  try {
    await ensureSchema();
    const ids = Array.isArray(req.body && req.body.ids)
      ? req.body.ids.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0)
      : [];
    if (!ids.length) {
      return res.status(400).json({ success: false, error: 'No se recibieron reportes para marcar como impresos.' });
    }
    const rows = await sql`
      UPDATE nc_reports
      SET status = 'impreso', printed_at = now()
      WHERE id = ANY(${ids}) AND status = 'pendiente'
      RETURNING id, report_number, report_date, lpn, sku, defects, defect_other,
                origin, inspector, received_by, status, created_at, created_by,
                printed_at, reprint_count
    `;
    res.json({ success: true, reports: rows });
  } catch (err) {
    console.error('[POST /api/nc-reports/print]', err);
    res.status(500).json({ success: false, error: 'Error al registrar la impresión.' });
  }
});

// POST /api/nc-reports/:id/reprint
// Reimpresión desde el historial: NO crea un reporte nuevo ni cambia el
// folio, sólo actualiza printed_at y aumenta reprint_count. Sólo aplica a
// reportes que ya estén 'impreso' (un pendiente se imprime con /print).
app.post('/api/nc-reports/:id/reprint', async (req, res) => {
  try {
    await ensureSchema();
    const id = Number(req.params.id);
    if (!id || Number.isNaN(id)) {
      return res.status(400).json({ success: false, error: 'ID inválido.' });
    }
    const rows = await sql`
      UPDATE nc_reports
      SET printed_at = now(), reprint_count = reprint_count + 1
      WHERE id = ${id} AND status = 'impreso'
      RETURNING id, report_number, report_date, lpn, sku, defects, defect_other,
                origin, inspector, received_by, status, created_at, created_by,
                printed_at, reprint_count
    `;
    if (!rows.length) {
      return res.status(404).json({ success: false, error: 'Reporte no encontrado o todavía no se ha impreso.' });
    }
    res.json({ success: true, report: rows[0] });
  } catch (err) {
    console.error('[POST /api/nc-reports/:id/reprint]', err);
    res.status(500).json({ success: false, error: 'Error al registrar la reimpresión.' });
  }
});

// DELETE /api/nc-reports/:id
// Sólo permite eliminar reportes todavía 'pendiente' (de la bandeja, antes de
// imprimirse) — un reporte ya impreso es un registro de calidad y se
// conserva en el historial sin opción de borrado.
app.delete('/api/nc-reports/:id', async (req, res) => {
  try {
    await ensureSchema();
    const id = Number(req.params.id);
    if (!id || Number.isNaN(id)) {
      return res.status(400).json({ success: false, error: 'ID inválido.' });
    }
    const rows = await sql`
      DELETE FROM nc_reports WHERE id = ${id} AND status = 'pendiente' RETURNING id
    `;
    if (!rows.length) {
      return res.status(404).json({ success: false, error: 'Reporte no encontrado o ya fue impreso.' });
    }
    res.json({ success: true, id: rows[0].id });
  } catch (err) {
    console.error('[DELETE /api/nc-reports/:id]', err);
    res.status(500).json({ success: false, error: 'Error al eliminar el reporte.' });
  }
});

// Diagnóstico rápido de salud / conexión a la BD.
app.get('/api/health', (req, res) => {
  res.json({ success: true, status: 'ok', dbConfigured: Boolean(DATABASE_URL) });
});

// ==========================================================================
// Integraciones server-a-server (solo lectura) — preparado 2026-08-06 para
// que otros proyectos (ej. mitechnologies-rt) puedan consumir estos datos
// reales sin necesitar sesión de usuario. NO reemplaza ni modifica los
// endpoints públicos de arriba (/api/labels, /api/nc-reports), que siguen
// abiertos tal cual para el propio frontend de este proyecto — estos son
// endpoints NUEVOS y ADITIVOS, mismo dato, gateados con una llave.
//
// Header requerido: x-integration-key == process.env.FFT_INTEGRATIONS_KEY
// Si esa variable no está configurada, estos endpoints quedan deshabilitados
// (503) en vez de abiertos por accidente.
function requireIntegrationKey(req, res) {
  const expected = process.env.FFT_INTEGRATIONS_KEY;
  if (!expected) {
    res.status(503).json({ success: false, error: 'FFT_INTEGRATIONS_KEY no configurada en este ambiente.' });
    return false;
  }
  const provided = req.get('x-integration-key') || '';
  if (!provided || provided.length !== expected.length || !timingSafeEqualStr(provided, expected)) {
    res.status(401).json({ success: false, error: 'Llave de integración inválida.' });
    return false;
  }
  return true;
}

function timingSafeEqualStr(a, b) {
  const { timingSafeEqual } = require('crypto');
  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

// GET /api/integrations/labels?search= — mismo dato que GET /api/labels.
app.get('/api/integrations/labels', async (req, res) => {
  if (!requireIntegrationKey(req, res)) return;
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
    console.error('[GET /api/integrations/labels]', err);
    res.status(500).json({ success: false, error: 'Error al consultar el historial.' });
  }
});

// GET /api/integrations/nc-reports?status=&search=&date=&defect= — mismo
// dato que GET /api/nc-reports.
app.get('/api/integrations/nc-reports', async (req, res) => {
  if (!requireIntegrationKey(req, res)) return;
  try {
    await ensureSchema();
    const status = cleanText(req.query.status) || 'all';
    const search = cleanText(req.query.search);
    const date = cleanText(req.query.date);
    const defect = cleanText(req.query.defect).toLowerCase();

    const rows = await sql`
      SELECT id, report_number, report_date, lpn, sku, defects, defect_other,
             origin, inspector, received_by, status, created_at, created_by,
             printed_at, reprint_count
      FROM nc_reports
      WHERE (${status} = 'all' OR status = ${status})
        AND (${search} = '' OR report_number ILIKE ${'%' + search + '%'}
             OR lpn ILIKE ${'%' + search + '%'} OR sku ILIKE ${'%' + search + '%'})
        AND (${date} = '' OR report_date = ${date})
        AND (${defect} = '' OR ${defect} = ANY(defects))
      ORDER BY COALESCE(printed_at, created_at) DESC
      LIMIT 500
    `;
    res.json({ success: true, reports: rows });
  } catch (err) {
    console.error('[GET /api/integrations/nc-reports]', err);
    res.status(500).json({ success: false, error: 'Error al consultar los reportes de No Conforme.' });
  }
});

module.exports = app;
