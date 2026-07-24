import type { NextConfig } from "next";

// Cabeceras de seguridad aplicadas a TODA respuesta servida por Next.
// Se declaran aqui (y no en `vercel.json`) para que valgan igual en `next dev`,
// `next start` y en Vercel: una sola fuente de verdad.
const securityHeaders = [
  // Fuerza HTTPS en el navegador durante 2 anos. Sin `preload`: eso es un alta
  // en la lista de Chrome, dificil de revertir; ver nota en docs si se quiere.
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains",
  },
  // El navegador respeta el Content-Type declarado; corta el MIME sniffing que
  // convierte un upload inocente en un script ejecutable.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Anti-clickjacking. `frame-ancestors` es la version moderna que respetan los
  // navegadores actuales; `X-Frame-Options` cubre los viejos.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  // No filtrar la ruta interna (ej. /ordenes/<id>) al navegar a sitios externos.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Superficie de APIs del navegador. `camera=(self)` es OBLIGATORIO: el escaner
  // de guias (html5-qrcode) deja de funcionar si se bloquea.
  {
    key: "Permissions-Policy",
    value: "camera=(self), microphone=(), geolocation=(self), payment=()",
  },
  // Evita que el navegador resuelva DNS de dominios enlazados sin interaccion.
  { key: "X-DNS-Prefetch-Control", value: "off" },
];

const nextConfig: NextConfig = {
  // Sin sourcemaps de cliente en produccion: publicarlos expone el codigo
  // original (nombres de tablas, reglas de negocio, rutas de Server Actions).
  // Es el default de Next, se fija explicito para que nadie lo active sin querer.
  productionBrowserSourceMaps: false,

  // Quita el header `X-Powered-By: Next.js` (fingerprinting gratis para nadie).
  poweredByHeader: false,

  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  experimental: {
    // La evidencia de gestion (mis-asignaciones) admite fotos de hasta 5 MB
    // (GESTION_MAX_FILE_BYTES, lib/config/gestion.ts). El default de Server
    // Actions es 1 MB y tumbaba la gestion con un 413 antes de llegar al action.
    // En el caso normal la foto se comprime en el cliente (~400 KB, ver
    // GestionarOrdenPanel); este limite es solo la red de seguridad, alineado
    // con MAX_FILE_BYTES (5 MB) + holgura para el overhead del multipart.
    serverActions: {
      bodySizeLimit: "5mb",
    },
  },
};

export default nextConfig;
