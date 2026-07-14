// Punto de entrada SOLO para desarrollo local (node server.js / npm run dev).
// En producción (Vercel), api/index.js se monta directo como función serverless
// y este archivo no se ejecuta.
require('dotenv').config();

const app = require('./api/index.js');

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`✅ Servidor FFT escuchando en http://localhost:${PORT}`);
  if (!process.env.DATABASE_URL) {
    console.warn('⚠️  DATABASE_URL no está definida. Copia .env.example a .env y agrega tu cadena de conexión de Neon.');
  }
});
