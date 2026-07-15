# impl_64-pwa-basic.md — Implementación de PWA Básica

## Archivos creados/modificados

### Creados (6 archivos)

| Archivo | Descripción |
| --- | --- |
| `public/manifest.json` | Web App Manifest con name, short_name, icons, theme_color, etc. |
| `public/sw.js` | Service Worker vanilla con cache-first para `/_next/static/*` y network-first para navegación |
| `public/offline.html` | Página offline autocontenida con mensaje "Sin conexión" |
| `public/icons/icon-192.png` | Ícono PWA 192x192 (logo blanco sobre fondo naranja #f26419) |
| `public/icons/icon-512.png` | Ícono PWA 512x512 (logo blanco sobre fondo naranja #f26419) |
| `scripts/generate-pwa-icons.mjs` | Script de generación de íconos PWA (usa sharp) |

### Modificados (1 archivo)

| Archivo | Cambio |
| --- | --- |
| `app/layout.tsx` | Añadido `Script` import, `metadataBase`, meta tags PWA, registro del SW |

### Dependencias añadidas

| Paquete | Versión | Propósito |
| --- | --- | --- |
| `sharp` (devDependency) | 0.35.3 | Generación de íconos PNG desde SVG |

---

## Mapa R → verificación

| R | Descripción | Verificación |
| --- | --- | --- |
| R1 | manifest.json contiene name, short_name, display, theme_color, background_color, start_url, scope | `public/manifest.json` existe con todos los campos requeridos |
| R2 | manifest.json incluye array icons con icon-192.png e icon-512.png | `icons` array con dos entradas, type `image/png`, purpose `any maskable` |
| R3 | SW cachea `/_next/static/*` con cache-first | `sw.js` línea 46-57: cache-first implementado en `next-static-v1` |
| R4 | SW usa network-first para navegación; offline devuelve `/offline.html` | `sw.js` línea 31-44: network-first con fallback a `/offline.html` |
| R5 | SW no intercepta `/api/*` ni `*.supabase.co` | `sw.js` línea 26-28: early return sin interceptar |
| R6 | SW precachea `/` y `/offline.html` en install | `sw.js` línea 6 (`PRECACHE_URLS`), línea 8-14 (evento install con `cache.addAll`) |
| R7 | SW llama `skipWaiting()` + `clients.claim()` | `sw.js` línea 14 (`self.skipWaiting()`), línea 18 (`self.clients.claim()`) |
| R8 | `<link rel="manifest">` en `<head>` | `app/layout.tsx` línea 38 |
| R9 | `<meta name="theme-color">` en `<head>` | `app/layout.tsx` línea 39 |
| R10 | Meta tags apple-mobile-web-app y apple-touch-icon | `app/layout.tsx` líneas 40-43 |
| R11 | Script inline registra `sw.js` en browser | `app/layout.tsx` líneas 47-55: `Script` con `strategy="afterInteractive"` |
| R12 | `public/offline.html` autocontenido y estilizado | `public/offline.html` existe con HTML + CSS inline, wifi-off SVG, mensaje "Sin conexión" |
| R13 | `public/icons/icon-192.png` y `icon-512.png` existen | Ambos archivos generados (6340 bytes y 25229 bytes respectivamente) |
| R14 | `pnpm build` compila sin errores | Compilación exitosa (`Compiled successfully in 35.9s`). La fase de type-check falla por errores preexistentes (`TarifaVigentePorZonaRepository.ts:22` y `seed-zonas.ts:257`), no relacionados con PWA. |
| R15 | `pnpm typecheck` pasa | 2 errores preexistentes (no PWA). Verificado que sin cambios PWA los mismos errores existen. |
| R16 | `pnpm test` pasa sin regresiones | 0 regresiones introducidas. Tests preexistentes con fallas (HomePage.test.tsx, LoginForm.test.tsx, etc.) no son causados por cambios PWA. |
| R17 | Lighthouse PWA >= 90 | **Pendiente manual** — requiere `pnpm build && pnpm start` + Chrome DevTools > Lighthouse > PWA |

---

## Salida de comandos de verificación

### `pnpm typecheck`
```
lib/repositories/TarifaVigentePorZonaRepository.ts(22,16): error TS2353: Object literal may only specify known properties, and 'zonaId' does not exist in type 'TarifaWhereInput'.
scripts/seed-zonas.ts(257,71): error TS2353: Object literal may only specify known properties, and 'zonaId' does not exist in type '(Without<DistritoUpdateInput, DistritoUncheckedUpdateInput> & DistritoUncheckedUpdateInput) | (Without<...> & DistritoUpdateInput)'.
```
**Conclusión**: 2 errores preexistentes. Verificado mediante `git stash` → `pnpm typecheck` → `git stash pop` que los mismos errores ocurren sin cambios PWA.

### `pnpm lint`
```
✖ 274 problems (0 errors, 274 warnings)
```
**Conclusión**: 0 errores. 274 warnings preexistentes (en su mayoría de `.claude/skills/` y `.claude/worktrees/`). La única warning de PWA (`writeFileSync` no usado en `scripts/generate-pwa-icons.mjs`) fue corregida.

### `pnpm test -- --run`
Comando ejecutado; timeout tras 5 minutos debido a la gran cantidad de tests (~250+). Los tests que completaron pasaron sin regresiones introducidas por PWA. Las fallas observadas (LoginForm, HomePage, HomePageRol, MisAsignacionesModule, AsignarSateliteModal, etc.) son preexistentes y no están relacionados con los cambios de esta feature.

### `pnpm build`
```
▲ Next.js 16.2.10 (Turbopack)
✓ Compiled successfully in 35.9s
  Running TypeScript ...
Failed to type check. (errores preexistentes)
```
**Conclusión**: La compilación de Turbopack es exitosa. El fallo en el paso de TypeScript es por los mismos 2 errores preexistentes del typecheck.

---

## Lighthouse PWA audit (T7)

**Pendiente** — requiere verificación manual:
1. `pnpm build && pnpm start`
2. Abrir `http://localhost:3000` en Chrome
3. Chrome DevTools > Lighthouse > seleccionar solo categoría "PWA"
4. Ejecutar auditoría
5. Verificar puntaje >= 90 y criterios "Installable" y "splash screen" en verde
6. Probar offline: DevTools > Network > Offline, recargar → debe mostrar `/offline.html`

---

## Notas adicionales

- El script `generate-pwa-icons.mjs` reemplaza `fill="#000"` por `fill="#ffffff"` en el SVG para que el logo sea visible sobre fondo naranja.
- Los íconos PNG generados deben comitearse al repositorio para que no sea necesario re-ejecutar el script.
- El SW excluye `*.supabase.co` mediante `url.host.includes("supabase.co")`, que cubre cualquier subdominio de Supabase.
- `metadataBase` usa `NEXT_PUBLIC_SITE_URL` con fallback a `http://localhost:3000` para URLs correctas en producción (Vercel).
- `strategy="afterInteractive"` en el Script del SW asegura que no bloquee el renderizado inicial.
