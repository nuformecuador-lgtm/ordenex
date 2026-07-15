# 64-pwa-basic — design.md

Diseño técnico de la PWA básica (feature 64). Traza contra `requirements.md`. No
introduce tablas, RLS, migraciones, `app/api/`, Server Actions ni cambios de
schema. No hay modelo de datos ni endpoints.

## Decisión principal: enfoque manual con SW vanilla

**Decisión (humano 2026-07-15, [RESUELTO-A]):** implementar la PWA sin librerías
de terceros. El service worker se escribe a mano en `public/sw.js` y se registra
con un `<Script>` inline en `app/layout.tsx`. El manifiesto es un JSON estático
en `public/manifest.json`.

### Qué implica

- Un archivo `public/sw.js` con lógica explícita de instalación, activación,
  fetch y las dos estrategias de caché (cache-first para `/_next/static/*`,
  network-first para navegación).
- Un `<Script id="sw-register">` inline en el layout raíz con la llamada a
  `navigator.serviceWorker.register("/sw.js")`, condicionada a browser.
- Cero dependencias nuevas en `package.json`. Sin `@serwist/next`, sin
  `next-pwa`, sin `workbox-webpack-plugin`.
- Compatible con Turbopack: como el SW es un archivo estático servido desde
  `public/`, Turbopack no lo procesa; no hay conflicto.

### Alternativa descartada: `@serwist/next`

`@serwist/next` (sucesor de `next-pwa` para App Router) inyecta el SW
automáticamente y genera el worker con Workbox bajo el capó.

**Descartada porque:**
1. **Compatibilidad no verificada con Next.js 16 + Turbopack.** Al momento de
   esta especificación, `@serwist/next` no tiene soporte confirmado para
   Turbopack, que es el bundler por defecto en Next.js 16. La integración de
   plugins de webpack (que `@serwist/next` usa internamente) es incompatible con
   Turbopack.
2. **Sobre-ingeniería para una PWA básica.** La feature requiere solo dos
   estrategias de caché, un precacheo mínimo y una página offline. Workbox
   añade ~30 KB de JS y una capa de abstracción que no se justifica para este
   alcance.
3. **Dependencia evitable.** Introducir una dependencia externa para algo que
   son ~80 líneas de JS vanilla contradice el principio de "dependencia
   innecesaria" (`docs/architecture.md`).

## Estrategia de caché

La estrategia de caché se implementa completamente en el evento `fetch` del SW.

### Cache-first para `/_next/static/*`

Los assets bajo `/_next/static/` (CSS, JS chunks, fuentes) tienen **hash en el
nombre de archivo** (content-hash de Next.js). Son inmutables: una misma URL
siempre devuelve el mismo contenido. Por eso la estrategia es cache-first:

```
fetch → ¿en caché? → sí → devolver caché
                    → no  → fetch red → cachear → devolver
```

El nombre del caché es `next-static-v1`. El `v1` permite invalidar toda la caché
de assets cambiando la versión en el SW cuando se despliega una nueva versión de
la app.

### Network-first para navegación

Las peticiones de navegación (`request.mode === "navigate"`) van primero a la
red para obtener el HTML más reciente. Si la red falla (offline), se busca en
caché. Si no está en caché, se devuelve `/offline.html`:

```
navigate → fetch red → éxito → devolver HTML fresco + cachear
                     → fallo → ¿en caché? → sí → devolver caché
                                           → no  → devolver /offline.html
```

El nombre del caché de navegación es `pages-cache-v1`.

### Exclusiones explícitas (R5)

El SW **no intercepta**:
- `/api/*` — rutas de API de Next.js (datos dinámicos, no cacheables en SW)
- `*.supabase.co` — llamadas de autenticación y datos de Supabase

Estas peticiones pasan directamente a la red sin tocar la caché del SW. La
exclusión se implementa como un `if` temprano en el handler `fetch` que retorna
`fetch(request)` sin más.

## Scope del SW

El SW vive en `public/sw.js`, por lo que el navegador le asigna automáticamente
el scope `/` (raíz). Esto es correcto: queremos que el SW controle todas las
rutas de la app. El campo `scope` en el manifiesto también es `"/"`.

No se requiere configurar headers `Service-Worker-Allowed` porque el archivo
está en la raíz de `public/` y su scope natural ya es `/`.

## Registro del SW

Se usa un `<Script>` inline de Next.js en `app/layout.tsx`, después de los meta
tags. El script:

```tsx
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

Puntos clave:
- `strategy="afterInteractive"` → el script se carga después de que la página es
  interactiva; no bloquea el renderizado inicial.
- `typeof window !== 'undefined'` → guarda contra SSR (aunque `Script` con
  `afterInteractive` ya solo corre en cliente, la doble guarda es defensiva).
- `'serviceWorker' in navigator` → feature detection; no intenta registrar en
  navegadores sin soporte.
- `.catch(() => {})` — el registro del SW es una mejora progresiva; si falla, la
  app sigue funcionando normalmente.

## Íconos PWA

### Origen

El logo temporal es `public/next.svg` (el logo de Next.js en SVG negro). Se
renderiza sobre un fondo naranja `#f26419` (--brand / --primary) para generar
los PNGs.

### Tamaños y archivos

| Archivo | Tamaño | Propósito |
| --- | --- | --- |
| `public/icons/icon-192.png` | 192×192 px | Android + iOS home screen (apple-touch-icon) |
| `public/icons/icon-512.png` | 512×512 px | Android splash screen + Chrome Web Store |

Ambos se referencian en `manifest.json` con `purpose: "any maskable"` para que
Android no les aplique recorte adicional.

### Generación

Los iconos se generan con un script de Node.js (`scripts/generate-pwa-icons.mjs`)
que:
1. Carga `public/next.svg`.
2. Lo renderiza en un canvas de 512×512 centrado sobre fondo `#f26419`.
3. Redimensiona a 192×192 y 512×512.
4. Escribe los PNGs en `public/icons/`.

Se usa la librería `sharp` para la conversión SVG → PNG con redimensionamiento
si está disponible en el proyecto, o `canvas` (node-canvas). Si ninguna está
disponible, se documenta un paso manual con Inkscape/ImageMagick en las tasks.

**Nota sobre sharp y el SVG:** `public/next.svg` tiene dos paths con `fill="#000"`
(negro). Para que el ícono sea visible sobre fondo naranja, el script DEBE
sobreescribir el fill a blanco (`#ffffff`) antes de renderizar, o alternativamente
usar un color de acento que contraste (naranja sobre fondo blanco). El diseño
final usa **ícono blanco sobre fondo naranja `#f26419`**, que es la combinación
más legible y consistente con la paleta de la app.

## Colores y marca

Extraídos del archivo real `app/globals.css`:

| Campo | Valor | Token CSS | Justificación |
| --- | --- | --- | --- |
| `theme_color` | `#0d2444` | `--navy-deep` | Color del sidebar; la barra de estado del navegador se integra visualmente con la app |
| `background_color` | `#f7f8fc` | `--kraft-canvas` | Fondo claro de la app; evita flash blanco antes del splash screen |
| Acento (íconos) | `#f26419` | `--brand` / `--primary` | Naranja de botones y marca; usado como fondo de los íconos PWA |

## Página offline (`public/offline.html`)

HTML autocontenido (sin dependencias externas) con:

- Estilos inline que usan los mismos colores de `globals.css`: fondo
  `#f7f8fc`, texto `#12233f`, acento `#f26419`.
- Mensaje principal: "Sin conexión" en español.
- Mensaje secundario: "Parece que no tienes conexión a internet. Revisa tu red e
  inténtalo de nuevo."
- Un SVG inline simple (icono de desconexión/wifi-off) en color `#8a94ad`
  (--asfalto-4, gris medio).
- Tipografía: `system-ui, -apple-system, sans-serif` (sin depender de las Google
  Fonts que requieren red).
- Viewport meta tag para escalado correcto en móviles.
- Sin JavaScript, sin Service Worker (es una página estática pura).

## Archivos que se tocan

### Creados (4 archivos)

| Archivo | Descripción |
| --- | --- |
| `public/manifest.json` | Web App Manifest (R1, R2) |
| `public/sw.js` | Service Worker vanilla (R3–R7) |
| `public/offline.html` | Página offline genérica (R12) |
| `public/icons/icon-192.png` | Ícono PWA 192×192 (R13) |
| `public/icons/icon-512.png` | Ícono PWA 512×512 (R13) |
| `scripts/generate-pwa-icons.mjs` | Script para generar los íconos desde next.svg |

### Modificados (1 archivo)

| Archivo | Cambio |
| --- | --- |
| `app/layout.tsx` | Meta tags (R8–R10) + Script de registro del SW (R11) |

**Total: 6 archivos creados, 1 modificado.** Ninguno toca rutas de API, Server
Actions, componentes, hooks ni providers existentes. Riesgo de regresión: nulo
para funcionalidad existente.

## Riesgos y mitigaciones

### Riesgo 1: SW intercepta llamadas de API/auth

**Mitigación:** el SW excluye explícitamente `/api/*` y `*.supabase.co` en el
handler `fetch` (R5). Las peticiones a estas rutas pasan directo a la red sin
cacheo ni intercepción. Esto se verifica en el test manual de Lighthouse +
inspección de Network.

### Riesgo 2: SW sirve assets stale después de un deploy

**Mitigación:** los assets bajo `/_next/static/` tienen hash inmutable en el
nombre. Una nueva versión de la app genera nuevos nombres de archivo; el SW
cachea la versión nueva la primera vez que se visita. El nombre del caché
(`next-static-v1`) permite invalidación manual si fuera necesario en el futuro.
El HTML de navegación usa network-first, por lo que siempre se intenta obtener
la versión más reciente.

### Riesgo 3: NEXT.js genera archivos bajo `/_next/static/` que el SW no debería cachear

**Mitigación:** todos los archivos bajo `/_next/static/` son assets con hash
(CSS, JS chunks, WASM, media). Ninguno contiene datos de usuario ni información
dinámica. Es seguro cachearlos con cache-first.

### Riesgo 4: Íconos no se generan correctamente desde SVG

**Mitigación:** se genera un script `scripts/generate-pwa-icons.mjs` que usa
`sharp` (si está en `node_modules`) o instrucciones manuales. La task de íconos
incluye verificación visual de que los PNGs se ven correctos. Si sharp no está
disponible, se documenta un paso manual con `npx sharp` o ImageMagick.

## Fuera de alcance

- Notificaciones push (requieren backend + VAPID keys + suscripción).
- Sincronización en background (Background Sync API).
- Estrategia de caché avanzada (stale-while-revalidate, network-only).
- Instalación programática (beforeinstallprompt, botón "Instalar app").
- Splash screen custom de iOS (apple-touch-startup-image, requiere 20+ tamaños).
- Workbox, `@serwist/next`, `next-pwa` o cualquier abstracción de SW.
- Precacheo de rutas dinámicas (solo se precachean `/` y `/offline.html`).
- Analytics de instalación de PWA.
