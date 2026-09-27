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

  // ⭑ FICHA 433 — LOS 31 `.md` DE LA AYUDA TIENEN QUE VIAJAR AL SERVIDOR DE PRODUCCION.
  //
  // El modulo de ayuda lee `docs/ayuda/**` con `fs` (ver el porque en `lib/ayuda/catalogo.ts`:
  // los `.md` son la unica fuente y no se copian a ningun sitio). En Vercel el sistema de
  // archivos en runtime NO es el del repositorio: solo se sube lo que el trazado de
  // dependencias de `next build` detecta siguiendo los `import`. Y aqui no hay ningun `import`
  // que seguir — la ruta se arma con `path.join(process.cwd(), "docs", "ayuda")` en tiempo de
  // ejecucion, asi que el trazado no ve nada y los archivos se quedan fuera del bundle.
  //
  // Sin estas lineas el modulo funciona perfectamente en local y devuelve 404 en produccion,
  // que es el fallo mudo clasico de leer archivos en serverless: el build pasa en verde, el
  // typecheck pasa en verde y el rojo solo aparece cuando un usuario abre la ayuda.
  //
  // EL PATRON ES `/**` —TODAS las paginas— y no solo `/ayuda`, a proposito: el trazado es POR
  // PAGINA y un layout NO hereda el de sus hijos, asi que declarar solo las dos rutas del
  // modulo dejaria sin archivos al layout del portal, que es quien calcula el mapa del boton
  // «?» en las 29 pantallas. El coste es ~90 KB de texto replicados por funcion; el de
  // equivocarse es que el «?» desaparezca en produccion y en ningun otro sitio.
  outputFileTracingIncludes: {
    "/**": ["./docs/ayuda/**/*.md"],
  },

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
