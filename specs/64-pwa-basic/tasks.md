# 64-pwa-basic — tasks.md

Checklist de implementación de la feature 64 (PWA básica) con enfoque manual
(service worker vanilla). Cada task tiene criterio de "hecho" y mapea a
requisitos `R<n>`. Las verificaciones de PWA se hacen con Lighthouse audit
manual (`pnpm build && pnpm start`, luego DevTools > Lighthouse > PWA).

Convención: `[P]` = paralelizable con sus hermanas una vez cumplida su
dependencia.

---

## [x] T1 — Web App Manifest (`public/manifest.json`)

- [x] Crear `public/manifest.json` con los campos: `name: "Ordenex"`, `short_name:
  "Ordenex"`, `description: "Plataforma de logística y entregas Ordenex"`,
  `start_url: "/"`, `scope: "/"`, `display: "standalone"`, `orientation:
  "portrait-primary"`, `theme_color: "#0d2444"`, `background_color: "#f7f8fc"`,
  `categories: ["business", "productivity"]`.
- [x] Incluir array `icons` con dos entradas: `{ src: "/icons/icon-192.png", sizes:
  "192x192", type: "image/png", purpose: "any maskable" }` y `{ src:
  "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any
  maskable" }`.
- **Hecho:** el archivo existe en `public/`, parsea como JSON válido, y
  `http://localhost:3000/manifest.json` devuelve el contenido con Content-Type
  `application/manifest+json` (cortesía del servidor de Next.js para archivos en
  `public/`). Lighthouse PWA audit marca "Installable" como passed (una vez
  completadas T2, T3 y T4).
- **Cubre:** R1, R2.
- **Depende de:** T4 (los íconos deben existir para que el manifiesto sea
  válido; se puede crear el JSON antes, pero Lighthouse fallará hasta que T4
  esté lista).

---

## [x] T2 — Service Worker (`public/sw.js`) [P]

- Crear `public/sw.js` con las siguientes secciones:
  - `CACHE_NAMES` con `next-static-v1` y `pages-cache-v1`.
  - `PRECACHE_URLS` con `["/", "/offline.html"]` (R6).
  - Evento `install`: abrir caché `pages-cache-v1`, añadir `PRECACHE_URLS` con
    `cache.addAll()`, llamar `self.skipWaiting()` (R7).
  - Evento `activate`: llamar `self.clients.claim()` (R7).
  - Evento `fetch`:

    1. Si la URL incluye `/api/` o el host es `*.supabase.co` → **return
       fetch(request)** sin cachear (R5).
    2. Si `request.mode === "navigate"` → network-first: intentar `fetch`,
       si ok cachear en `pages-cache-v1` y devolver; si error, buscar en
       `pages-cache-v1`; si tampoco está → devolver `caches.match("/offline.html")`
       (R4, R12).
    3. Si la URL contiene `/_next/static/` → cache-first: buscar en
       `next-static-v1`; si está → devolver; si no → fetch, cachear en
       `next-static-v1`, devolver (R3).
    4. Otras peticiones → `fetch(request)` sin cachear.

- **Hecho:** el archivo existe en `public/sw.js` con sintaxis JS válida. Al
  hacer build + start, `chrome://serviceworker-internals/` o DevTools >
  Application > Service Workers muestra el SW registrado con scope `/`. Las
  peticiones a `/_next/static/` se sirven desde caché en la segunda carga
  (verificable en la pestaña Network, tamaño "from ServiceWorker").
- **Cubre:** R3, R4, R5, R6, R7.
- **Depende de:** T3 (necesita `public/offline.html` para el precacheo y el
  fallback offline).
- **Nota:** T2 puede escribirse en paralelo con T3 conociendo la ruta
  `/offline.html`. La dependencia es solo para la verificación completa.

---

## [x] T3 — Página offline (`public/offline.html`) [P]

- Crear `public/offline.html` autocontenido:
  - `<meta charset="UTF-8">`, `<meta name="viewport"
    content="width=device-width, initial-scale=1.0">`, `<meta name="theme-color"
    content="#0d2444">`.
  - `<title>Ordenex — Sin conexión</title>`.
  - CSS inline en `<style>`: fondo `#f7f8fc`, texto centrado vertical y
    horizontal con flexbox, color de texto `#12233f`, acento `#f26419`, color
    secundario `#8a94ad`. Tipografía: `system-ui, -apple-system, sans-serif`.
    Sin Google Fonts.
  - SVG inline (icono wifi-off simplificado) en `#8a94ad`, 64×64 px aprox.
  - `<h1>Sin conexión</h1>` en `#f26419`.
  - `<p>Parece que no tienes conexión a internet. Revisa tu red e inténtalo de nuevo.</p>`
    en `#4a5368`.
  - `<button onclick="location.reload()" style="...">Reintentar</button>`
    estilizado con fondo `#f26419`, texto blanco, borde redondeado.
- **Hecho:** el archivo existe en `public/offline.html`. Al navegar a
  `http://localhost:3000/offline.html` se muestra la página estilizada. En modo
  offline (DevTools > Network > Offline), al recargar cualquier ruta de la app
  se muestra esta página como fallback (una vez T2 esté completa).
- **Cubre:** R12.
- **Depende de:** —

---

## [x] T4 — Meta tags y registro del SW (`app/layout.tsx`)

- Modificar `app/layout.tsx`:
  - En el objeto `metadata`, añadir `metadataBase: new
    URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000")` para que
    las URLs relativas del manifiesto resuelvan correctamente.
  - Añadir en el `<head>` (vía metadata export o JSX en el layout):
    - `<link rel="manifest" href="/manifest.json">` (R8).
    - `<meta name="theme-color" content="#0d2444">` (R9).
    - `<meta name="apple-mobile-web-app-capable" content="yes">` (R10).
    - `<meta name="apple-mobile-web-app-status-bar-style"
      content="black-translucent">` (R10).
    - `<meta name="apple-mobile-web-app-title" content="Ordenex">` (R10).
    - `<link rel="apple-touch-icon" href="/icons/icon-192.png">` (R10).
  - Añadir `<Script>` de Next.js para el registro del SW (R11):
    ```tsx
    import Script from "next/script";
    // ...
    <Script id="sw-register" strategy="afterInteractive">
      {`
        if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
          window.addEventListener('load', () => {
            navigator.serviceWorker.register('/sw.js').catch(() => {});
          });
        }
      `}
    </Script>
    ```
    Colocar el `<Script>` dentro del `<body>`, después de `{children}` (o al
    final del body).
- **Hecho:** `pnpm typecheck` y `pnpm lint` pasan sin errores. El HTML servido
  en `http://localhost:3000` incluye los meta tags (verificable con View Page
  Source). En DevTools > Application > Manifest se detecta el manifiesto
  correctamente. El SW aparece registrado en Application > Service Workers.
- **Cubre:** R8, R9, R10, R11.
- **Depende de:** T1 (necesita `manifest.json`) y T2 (necesita `sw.js`).

---

## [x] T5 — Generación de íconos PWA (`public/icons/`) [P]

- Crear `scripts/generate-pwa-icons.mjs`:
  - Leer `public/next.svg`.
  - Renderizar el SVG (con fill blanco `#ffffff`) centrado sobre un fondo
    `#f26419` en 512×512.
  - Generar dos tamaños: 192×192 (`icon-192.png`) y 512×512 (`icon-512.png`).
  - Escribir los archivos en `public/icons/`.
  - Usar `sharp` si está disponible en el proyecto (`npx sharp` o import de
    `sharp`). Si no, el script debe ser ejecutable manualmente con instrucciones
    en su encabezado.
- Alternativa manual (documentar en el script):
  ```bash
  npx sharp-cli -i public/next.svg -o public/icons/icon-512.png resize 512 512 --background "#f26419"
  ```
  O usar un servicio online/svg2png si `sharp` no está disponible y se prefiere
  no instalarlo.
- **Hecho:** los archivos `public/icons/icon-192.png` y `public/icons/icon-512.png`
  existen, son PNGs válidos de los tamaños especificados, y muestran el logo de
  Next.js (blanco) sobre fondo naranja. Lighthouse PWA audit detecta los íconos
  correctamente (no emite warning de "Does not have a 192px icon" ni "Does not
  have a 512px icon").
- **Cubre:** R13.
- **Depende de:** —
- **Nota:** si el proyecto no tiene `sharp` en `node_modules`, esta task se
  reduce a ejecutar el comando manual de generación con `npx sharp-cli` o
  ImageMagick y documentar el comando usado en `progress/impl_64-pwa-basic.md`.

---

## [x] T6 — Verificación de no regresiones y lint

- Ejecutar `pnpm typecheck` y verificar que pase sin errores (R15).
- Ejecutar `pnpm lint` y verificar que pase sin errores.
- Ejecutar `pnpm test` y verificar que todos los tests existentes pasen sin
  regresiones (R16).
- Ejecutar `pnpm build` y verificar que compile sin errores (R14).
- **Hecho:** los 4 comandos terminan en verde. No hay fallos nuevos introducidos
  por los cambios.
- **Cubre:** R14, R15, R16.
- **Depende de:** T4 (necesita los cambios en `layout.tsx` para verificar
  typecheck y build).

---

## [x] T7 — Lighthouse PWA audit

- Build de producción: `pnpm build && pnpm start`.
- Abrir Chrome DevTools > Lighthouse, seleccionar solo la categoría "PWA"
  (Progressive Web App), ejecutar auditoría en `http://localhost:3000`.
- Verificar que el puntaje es >= 90/100 y que los criterios "Installable" y
  "Is configured for a custom splash screen" están en verde (R17).
- Simular offline: DevTools > Network > Offline. Recargar la página y verificar
  que se muestra la página offline (`/offline.html`). Verificar que los assets
  previamente visitados (CSS/JS de `/_next/static/`) se sirven desde caché.
- **Hecho:** Lighthouse PWA >= 90. La app es instalable desde Chrome (ícono en
  la barra de direcciones o menú > "Instalar Ordenex"). La experiencia offline
  muestra la página offline genérica.
- **Cubre:** R17.
- **Depende de:** T1–T6 (todas las anteriores).

---

## [x] T8 — Trazabilidad y documentación

- Escribir `progress/impl_64-pwa-basic.md` con:
  - Lista de archivos creados/modificados.
  - Mapa `R<n> → verificación` (ver tabla abajo, R1–R17).
  - Salida de los comandos `pnpm typecheck`, `pnpm lint`, `pnpm test` y `pnpm
    build`.
  - Resultado resumido del Lighthouse PWA audit.
- **Hecho:** el archivo existe y cubre todos los `R<n>` con su verificación
  concreta.
- **Depende de:** T6, T7.

---

## Mapa R → verificación

| R | Verificación |
| --- | --- |
| R1 | `public/manifest.json` contiene name, short_name, display, theme_color, background_color, start_url, scope |
| R2 | `manifest.json` incluye array icons con icon-192.png (192×192) e icon-512.png (512×512) con type y purpose |
| R3 | SW cachea `/_next/static/*` con cache-first (verificable en DevTools > Application > Cache Storage > next-static-v1) |
| R4 | SW usa network-first para navegación; offline devuelve `/offline.html` (verificable en DevTools > Network > Offline) |
| R5 | SW no toca `/api/*` ni `*.supabase.co` (verificable en pestaña Network: esas requests no dicen "from ServiceWorker") |
| R6 | SW precachea `/` y `/offline.html` en evento install (verificable en Cache Storage > pages-cache-v1 post-install) |
| R7 | SW llama `skipWaiting()` + `clients.claim()` (verificable: SW se activa sin necesidad de "Update on reload") |
| R8 | `<link rel="manifest" href="/manifest.json">` en `<head>` (View Page Source) |
| R9 | `<meta name="theme-color" content="#0d2444">` en `<head>` (View Page Source) |
| R10 | Meta tags apple-mobile-web-app y apple-touch-icon en `<head>` (View Page Source) |
| R11 | Script inline registra `sw.js` solo en browser (verificable: SW aparece en Application > Service Workers) |
| R12 | `public/offline.html` existe, autocontenido, estilizado con colores de la app |
| R13 | `public/icons/icon-192.png` y `icon-512.png` existen con tamaños correctos |
| R14 | `pnpm build` pasa sin errores |
| R15 | `pnpm typecheck` pasa sin errores |
| R16 | `pnpm test` pasa sin regresiones |
| R17 | Lighthouse PWA audit >= 90, "Installable" y "splash screen" en verde |

---

## Notas de implementación

- El SW debe usar la API `self` y no `window`. Todo el código del SW corre en el
  scope del worker.
- Las URLs de Supabase a excluir incluyen el proyecto específico configurado en
  `NEXT_PUBLIC_SUPABASE_URL`. Usar `self.location.host` o una variable de
  configuración si se necesita excluir más dominios en el futuro.
- La verificación de T7 (Lighthouse) es **manual** porque Lighthouse requiere un
  servidor corriendo y una instancia de Chrome. No se puede automatizar en CI
  sin herramientas adicionales (Lighthouse CI). Para esta feature low-complexity,
  la verificación manual es suficiente.
- El script `scripts/generate-pwa-icons.mjs` se ejecuta una sola vez. Los PNGs
  generados se comitean al repo. En el futuro, si `next.svg` cambia, se
  re-ejecuta el script.
- `metadataBase` en `layout.tsx` debe usar `NEXT_PUBLIC_SITE_URL` si existe en
  `.env`, con fallback a `http://localhost:3000`. Esto asegura que las URLs del
  manifiesto resuelvan correctamente en producción (Vercel).
