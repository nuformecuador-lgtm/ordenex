# Impl 114 — Mensajero: buscador de guías asignadas

> Zona: frontend · 100% cliente, sin backend. Rama: `feature/114-buscador-guias-mensajero`.
> Base: `dev` (ya incluye 113 modo foco/detalle inline y 115 badge/toggle/sort).

## Archivos tocados

**Nuevos**
- `app/(app)/mis-asignaciones/_components/mis-asignaciones-buscador.ts` — helper PURO:
  `textoBuscable`, `coincideBusqueda(orden, queryNormalizado)`, `filtrarAsignaciones(ordenes, query)`.
  Reutiliza `normalizeName` (`lib/utils/normalize.ts`) para la coincidencia parcial insensible
  a mayúsculas/acentos. `numGuia` num→texto, `null`→""; query vacío/solo-espacios → sin filtrar.
- `tests/unit/components/mis-asignaciones-buscador.test.ts` — unit del helper (R3/R4/R5).

**Modificados**
- `app/(app)/mis-asignaciones/_components/MisAsignacionesModule.tsx`
  - Estado `query` + `<section aria-label="Buscar guías asignadas">` con `<label>` "Buscar guías" +
    `components/ui/input` `type="search"`, por encima de ambos grupos, SOLO en la vista de lista
    (dentro del fragmento "VISTA COMPLETA"; en modo foco no se renderiza).
  - `porRecogerFiltrado = useMemo(filtrarAsignaciones(porRecoger, query))`.
  - `porGestionarFiltrado = useMemo(porGestionar.filter(o => o.id === ordenEnGestionId ||
    coincideBusqueda(o, normalizeName(query))))` — R8 + salvaguarda R9.
  - `paradasMapa`, `porGestionarVisual` (sort de 115) y `detalleOrden` REcableados para DERIVAR
    de `porGestionarFiltrado` (antes leían `porGestionar` crudo) → mapa y panel reflejan el filtro.
  - Mensajes "sin resultados" por grupo (R6): «Ninguna guía por recoger/en reparto coincide con la
    búsqueda.», distintos del vacío sin búsqueda.
- `tests/components/MisAsignacionesModule.test.tsx` — 8 tests nuevos de 114 (ampliado, sin tocar los
  de 113/115/111/97/…).

## Mapa R1–R9 → test

| Req | Test | Archivo |
| --- | --- | --- |
| R1 | "114/R1: renderiza un campo de búsqueda de guías (searchbox) sobre ambos grupos" + "114/R1: en modo foco NO se renderiza el buscador" | `tests/components/MisAsignacionesModule.test.tsx` |
| R2 | "114/R2: teclear texto filtra AMBOS grupos por guía / remisión / destinatario" | `tests/components/MisAsignacionesModule.test.tsx` |
| R3 | "R3: la coincidencia es PARCIAL e insensible a mayúsculas y acentos" + "R3: filtrarAsignaciones conserva solo las coincidentes…" | `tests/unit/components/mis-asignaciones-buscador.test.ts` |
| R4 | "R4: numGuia null NO coincide por guía pero sí por remisión o destinatario" + "R4: numGuia numérico se compara como TEXTO (10 ↔ 1001)" | `tests/unit/components/mis-asignaciones-buscador.test.ts` |
| R5 | "R5: query vacío o solo-espacios devuelve la lista completa sin filtrar" (unit) + "114/R5: limpiar la búsqueda restaura TODAS las guías de ambos grupos" (componente) | ambos archivos |
| R6 | "114/R6: sin coincidencias muestra 'sin resultados' por grupo, distinto del vacío sin búsqueda" | `tests/components/MisAsignacionesModule.test.tsx` |
| R7 | "114/R7: el filtro aplica por grupo — una coincidencia de un grupo no cruza al otro" | `tests/components/MisAsignacionesModule.test.tsx` |
| R8 | "114/R8: filtrar excluye la parada de la grilla Y del mapa de ruta" (afirma `RutaMapa` recibe solo la parada que coincide) | `tests/components/MisAsignacionesModule.test.tsx` |
| R9 | "114/R9: la orden EN GESTIÓN permanece en la lista y en el mapa aunque no coincida" (con control g3 que sí se filtra) | `tests/components/MisAsignacionesModule.test.tsx` |

Nota R9: el escenario observable usa `bloqueado: true` con `ordenEnGestionId` fijado, que mantiene la
VISTA COMPLETA (grilla + mapa) SIN colapsar a modo foco (precedencia de 111), única forma de ver la
salvaguarda actuando sobre lista y mapa. El control con `g3` (ni coincide ni está en gestión, y SÍ se
filtra) prueba que la permanencia de la orden en gestión se debe a la salvaguarda, no a ausencia de filtro.

## Integración con 113 y 115 (preservadas)

- **113 (modo foco / detalle inline):** `modoFoco` sigue derivando de `ordenEnGestionId` + `detalleOrden`.
  El buscador vive dentro del fragmento de vista completa, así que en foco no aparece (no hay cards que
  filtrar). `detalleOrden` deriva de `porGestionarFiltrado`, pero la salvaguarda R9 garantiza que la orden
  en gestión siempre está en ese conjunto, por lo que el panel de foco muestra la orden activa igual que antes.
  Tests de 113 (R1–R12) siguen verdes.
- **115 (badge/toggle/sort):** `porGestionarVisual` conserva el `sort` estable por `marcarLuego`, ahora
  aplicado sobre el subconjunto FILTRADO (la grilla muestra lo filtrado). El toggle `MarcarLuegoToggle`
  y el badge "Gestionar más tarde" no se tocaron. Tests de 115 siguen verdes.
- **R8 (mapa refleja el filtro):** `paradasMapa` deriva de `porGestionarFiltrado` (antes de `porGestionar`),
  así que el mapa refleja el conjunto filtrado, con la orden en gestión siempre presente (R9).

## Salida de la suite

- `./init.sh`: **verde**. typecheck OK (tras `prisma generate` — el cliente stale daba falso negativo
  local por `scripts/**`, según memoria del proyecto), lint OK (0 errores; solo warnings preexistentes),
  test OK.
- `vitest run` (suite completa): **460 archivos, 4599 tests, todos verdes**.
- Focalizado (helper + módulo): 67 tests verdes.
