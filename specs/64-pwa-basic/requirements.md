# 64-pwa-basic — requirements.md

Feature id 64 · zone: frontend · complexity: low · branch: feature/64-pwa-basic ·
depends_on: null

Conversión de la app en una PWA básica: instalable en dispositivos, con caché de
assets estáticos y pantalla offline genérica. Enfoque manual (service worker
vanilla en `public/sw.js`, sin dependencias externas de PWA) para evitar
incompatibilidades con Next.js 16 + Turbopack.

Notación EARS. Requisitos verificables mediante pruebas manuales de Lighthouse
PWA audit y chequeo de archivos en disco. Convenciones:

- **"El SW"** = el service worker registrado desde `public/sw.js`.
- **"El manifiesto"** = el archivo `public/manifest.json`.
- **"La app"** = la aplicación Next.js corriendo en producción (`pnpm build && pnpm start`).

---

## Manifiesto

- **R1** El manifiesto `public/manifest.json` DEBE contener los campos `name`
  (`"Ordenex"`), `short_name` (`"Ordenex"`), `display` (`"standalone"`),
  `theme_color` (`"#0d2444"`), `background_color` (`"#f7f8fc"`), `start_url`
  (`"/"`), `scope` (`"/"`).
- **R2** El manifiesto DEBE incluir un array `icons` con al menos dos entradas
  válidas: `icon-192.png` (192×192) y `icon-512.png` (512×512), con `type`
  `"image/png"` y `purpose` `"any maskable"`.

## Service Worker

- **R3** El SW `public/sw.js` DEBE interceptar peticiones `GET` hacia
  `/_next/static/*` y servirlas con estrategia **cache-first**: si el asset está
  en la caché del SW, devolverlo desde caché; en caso contrario, ir a la red,
  cachearlo y devolverlo.
- **R4** El SW DEBE interceptar peticiones de navegación (`request.mode ===
  "navigate"`) y servirlas con estrategia **network-first**: intentar la red
  primero; si falla (offline) y la ruta no está en caché, devolver una página
  HTML offline genérica (`/offline.html`).
- **R5** El SW NO DEBE interceptar rutas bajo `/api/*` ni llamadas a dominios de
  Supabase (`*.supabase.co`): las peticiones a esas rutas DEBEN pasar
  transparentemente a la red sin cacheo.
- **R6** El SW DEBE precachear los assets listados en un arreglo de precacheo
  (`PRECACHE_URLS`) durante el evento `install`, de modo que los recursos
  esenciales estén disponibles incluso en la primera carga offline. El arreglo
  DEBE incluir al menos `"/"` y `"/offline.html"`.
- **R7** El SW DEBE activarse sin esperar a que las pestañas antiguas se cierren
  (`self.skipWaiting()` en `install` + `self.clients.claim()` en `activate`).

## Head y meta tags

- **R8** El `<head>` de la app DEBE incluir `<link rel="manifest"
  href="/manifest.json">`.
- **R9** El `<head>` DEBE incluir `<meta name="theme-color" content="#0d2444">`.
- **R10** El `<head>` DEBE incluir `<meta name="apple-mobile-web-app-capable"
  content="yes">`, `<meta name="apple-mobile-web-app-status-bar-style"
  content="black-translucent">`, `<meta name="apple-mobile-web-app-title"
  content="Ordenex">` y `<link rel="apple-touch-icon"
  href="/icons/icon-192.png">`.

## Registro del SW

- **R11** El layout raíz (`app/layout.tsx`) DEBE incluir un script inline que
  registre el SW (`navigator.serviceWorker.register("/sw.js")`). El script DEBE
  ejecutarse **solo en el navegador**: debe verificar `typeof window !==
  "undefined"` y `"serviceWorker" in navigator` antes de registrar.

## Página offline

- **R12** DEBE existir `public/offline.html` con un mensaje de "Sin conexión" en
  español, estilizado con los colores de la app (fondo `#f7f8fc`, texto
  `#12233f`, acento `#f26419`), sin dependencias externas (HTML + CSS inline
  autocontenido).

## Íconos PWA

- **R13** DEBEN existir los archivos `public/icons/icon-192.png` (192×192 px) y
  `public/icons/icon-512.png` (512×512 px), generados a partir de
  `public/next.svg` sobre fondo naranja `#f26419`.

## No regresiones

- **R14** La app DEBE compilar sin errores (`pnpm build` pasa).
- **R15** El typecheck DEBE pasar sin errores (`pnpm typecheck` pasa).
- **R16** Los tests existentes NO DEBEN romperse (`pnpm test` pasa sin
  regresiones).

## Auditoría PWA

- **R17** Lighthouse PWA audit DEBE reportar un puntaje >= 90/100 para los
  criterios "Installable" e "Is configured for a custom splash screen".

---

## Decisiones cerradas (humano, 2026-07-15)

- **[RESUELTO-A] Enfoque manual, sin @serwist/next.** Verificada incompatibilidad
  de `@serwist/next` con Next.js 16 + Turbopack. Se usa SW vanilla en
  `public/sw.js`. Ver `design.md` para el detalle de la alternativa descartada.
- **[RESUELTO-B] Íconos generados desde `public/next.svg`.** El SVG del logo de
  Next.js se usa como base, renderizado sobre fondo `#f26419` en 192×192 y
  512×512.
- **[RESUELTO-C] Colores del manifiesto desde `globals.css`.** `theme_color:
  #0d2444` (--navy-deep, sidebar) y `background_color: #f7f8fc`
  (--kraft-canvas, fondo claro). Ver `design.md`.
