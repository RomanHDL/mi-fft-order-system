# Mi FFT Order System

Aplicación web **completamente funcional** para generar e imprimir etiquetas de
**"PREPARACIÓN DE TARIMA POR FFT"** del área FFT TV de **Mi Technologies
Internacional S.A. de C.V.**, replicando el formato físico usado en línea de
producción: título, No. de Orden, Fecha, código QR y recuadro de CALIDAD.

Sin login (página abierta), lista para producción, historial en base de datos
real (Neon/Postgres), exportable a Excel.

## Cómo cambiar el logo

El logo se toma de **`public/logo-mitech.png`**. Para cambiarlo, sustituye ese
archivo (mismo nombre) por el logo que quieras usar — aparecerá automáticamente
en la app y en la etiqueta impresa, sin tocar código.

## Requisitos

- Node.js 18+
- Una base de datos [Neon](https://neon.tech) (plan gratuito es suficiente)
- (Para producción) cuenta de [Vercel](https://vercel.com)

## Configuración local

```bash
npm install
cp .env.example .env
# Edita .env y coloca tu DATABASE_URL de Neon
npm run dev
```

Abre `http://localhost:3000`. La tabla `labels` se crea automáticamente la
primera vez que se usa la API (no hay que correr migraciones a mano).

## Uso

1. Escribe el **No. de Orden** (acepta letras, números y guiones: `FBA12345`,
   `FFT-2026-001`, `ABC123`, `123456789`, `A1B2C3`...). El **QR se genera en
   vivo** con el texto exacto conforme escribes.
2. La **Fecha** se autocompleta con el día actual (formato `DD/MM/AAAA`) y se
   puede editar libremente.
3. **Generar** → guarda la etiqueta en el historial (Neon).
4. **Vista previa** → muestra la etiqueta tal como saldrá impresa, centrada,
   sin botones ni menús.
5. **Imprimir** → abre el diálogo de impresión; solo la etiqueta sale en la
   hoja carta, centrada y con las proporciones fijas del formato original.
6. **Nueva etiqueta** → limpia el formulario y reinicia la fecha a hoy.

### Historial

- Buscar por número de orden.
- Reimprimir cualquier etiqueta guardada (abre vista previa lista para imprimir).
- Eliminar registros.
- Exportar el historial visible a Excel (`.xlsx`).

## Despliegue en Vercel

1. Crea un proyecto en [Neon](https://neon.tech) y copia el **connection
   string** (usa la versión "pooled" si está disponible).
2. Sube el repo a GitHub e impórtalo en Vercel, o despliega directo con:
   ```bash
   vercel --prod
   ```
3. En el proyecto de Vercel, agrega la variable de entorno:
   - `DATABASE_URL` → tu connection string de Neon.
4. Cada `git push` a `main` (si el repo está conectado a Vercel) vuelve a
   desplegar automáticamente.

## Estructura del proyecto

```
mi-fft-order-system/
├── api/index.js        # API Express (Neon) — función serverless en Vercel
├── server.js            # Arranque local (node server.js) — no se usa en Vercel
├── public/
│   ├── index.html        # UI + etiqueta imprimible
│   ├── styles.css         # Estilos de pantalla + @media print
│   ├── app.js              # Lógica: QR en vivo, historial, exportar Excel
│   ├── logo-mitech.png     # Logo oficial (reemplazable)
│   └── vendor/              # qrcode.min.js y xlsx.full.min.js (sin CDN)
├── db/schema.sql          # Esquema de referencia de la tabla `labels`
└── vercel.json            # Config de build/rutas para Vercel
```

## Tecnologías

HTML5 · CSS3 · JavaScript moderno (sin frameworks) · Node.js · Express ·
Neon (Postgres) · QR generado localmente (sin llamadas externas) · SheetJS
(exportación a Excel).
