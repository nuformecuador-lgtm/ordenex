# Feature 121 — Frontend (bloque F) — bitácora del frontend_dev

Rama: `flow`. Alcance: bloque F de `tasks.md` (F1–F4) + tests component. Backend (A–E) ya verde.

## Archivos creados

- `components/ui/dialog.tsx` — primitiva Dialog (modal centrado) sobre `@base-ui/react/dialog`,
  hermana de `sheet.tsx` (el repo NO tenía `components/ui/dialog.tsx`; usa `@base-ui/react`).
- `app/(app)/mis-asignaciones/_components/ubicacion-mapa-tipos.ts` — tipo `UbicacionPunto`
  (sin `leaflet`/`"use client"`), patrón de `ruta-mapa-tipos.ts`.
- `app/(app)/mis-asignaciones/_components/UbicacionMapaInner.tsx` — render Leaflet+OSM: 2
  marcadores `L.divIcon` (cliente = pin naranja; repartidor = punto azul, omitido si `null`),
  reencuadre `fitBounds`(2)/`setView`(1). Calca `RutaMapaInner.tsx` (F1).
- `app/(app)/mis-asignaciones/_components/UbicacionMapa.tsx` — wrapper `next/dynamic({ssr:false})`
  (F1, R14).
- `tests/components/UbicacionMapa.test.tsx` — F1.T.

## Archivos modificados

- `app/(app)/mis-asignaciones/_components/ChatWhatsappPanel.tsx`:
  - `Burbuja`: para `tipo==="ubicacion"` con coords → botón `MapPin` + texto "Ubicación
    compartida" (`text-xs`, más pequeño que el `text-sm` de las burbujas de texto),
    `aria-label="Ver ubicación compartida"`; coords solo alimentan el `onClick`, nunca al DOM
    (F2, R9/R15).
  - Panel: estado local `ubicacionCliente` (una sola a la vez) + `Dialog` con `UbicacionMapa`;
    GPS del repartidor pedido LAZY al abrir vía `pedirUbicacion()` de `useUbicacionActual` (P3);
    aviso no bloqueante si el GPS resuelve `null` (usa `denegado` para el copy) (F3/F4,
    R10/R11/R12/R13).
- `tests/components/ChatWhatsappPanel.test.tsx`: mocks de `useUbicacionActual` y `./UbicacionMapa`,
  fixture `UBICACION`, y tests F2.T/F3.T/F4.T.

## Mapa R → test (R9–R14, bloque F)

| R | Test (archivo :: nombre) |
| --- | --- |
| R9  | `ChatWhatsappPanel.test.tsx` :: `la burbuja de ubicación muestra un botón clicable con el texto, la de texto no, y no vuelca coordenadas` |
| R10 | `ChatWhatsappPanel.test.tsx` :: `abre el Dialog con el minimapa, pasa 2 puntos con GPS y cierra sin recargar` |
| R11 | `ChatWhatsappPanel.test.tsx` :: `abre el Dialog... pasa 2 puntos con GPS...` (GPS lazy al abrir + 2º marcador) |
| R12 | `ChatWhatsappPanel.test.tsx` :: `sin GPS del repartidor muestra un solo punto y un aviso, sin bloquear el modal` + `UbicacionMapa.test.tsx` :: `dibuja 1 marcador cuando no hay repartidor` |
| R13 | `ChatWhatsappPanel.test.tsx` :: `abre el Dialog... y cierra sin recargar` (Escape cierra, la burbuja sigue viva) |
| R14 | `UbicacionMapa.test.tsx` :: `carga el minimapa con next/dynamic ssr:false` + `dibuja 2 marcadores con cliente y repartidor` |
| R15 | `ChatWhatsappPanel.test.tsx` :: `...y no vuelca coordenadas` (queryByText de lat/lng crudas = null) |

## Salida de tests

`pnpm vitest run tests/components/UbicacionMapa.test.tsx tests/components/ChatWhatsappPanel.test.tsx`

```
Test Files  2 passed (2)
     Tests  14 passed (14)
```

(ChatWhatsappPanel: 11/11 incluyendo los 3 nuevos F2/F3/F4 sin regresión en los 8 de 120;
 UbicacionMapa: 3/3.)

## Typecheck

`pnpm exec tsc --noEmit` — sin errores en los archivos tocados (filtro `ubicacion|dialog|
ChatWhatsappPanel` = 0). Ruido preexistente de `flow` (google-auth-library / @vercel/oidc /
middleware.test) ignorado por briefing.
