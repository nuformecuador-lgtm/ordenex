# Implementación — Feature 117: filtro de órdenes por cantón y distrito (mensajero)

> Frontend 100% en cliente, sin backend. Última del lote mensajero. Compone en AND con
> el buscador (114) y preserva 113/114/115/116.

## Archivos tocados

Nuevos:
- `lib/utils/filtro-canton-distrito.ts` — lógica PURA (sin React): `derivarCantones`
  (label "Cantón (Provincia)", dedup por cantón+provincia normalizado, orden es),
  `derivarDistritos` (del cantón elegido, sin nulos), `filtrarAsignaciones({canton,
  distrito})` (R6/R7). Reusa `normalizeName`.
- `app/(app)/mis-asignaciones/_components/useFiltroCantonDistrito.ts` — hook de estado:
  `canton`/`distrito` (`""`=todos), `setCantonYReset` (R5), opciones memoizadas
  (R2/R4/R13), `hayFiltro` (R9), `limpiar` (R8), `aplicar(lista)` (R6/R7).
- `app/(app)/mis-asignaciones/_components/FiltroCantonDistrito.tsx` — presentación: dos
  `Select` (base-ui) con `aria-label` "Filtrar por cantón" / "Filtrar por distrito";
  distrito `disabled` sin cantón (R3); opción centinela `__todos__` → `""` (R8); botón
  "Limpiar filtros" solo si `hayFiltro` (R9). Textos en constantes (i18n-ready).
- `tests/unit/filtro-canton-distrito.test.ts` — unit de la lógica pura (R2/R4/R6/R7/R13).

Editados:
- `app/(app)/mis-asignaciones/_components/MisAsignacionesModule.tsx` — integración:
  monta `<FiltroCantonDistrito>` en la vista de lista (no en modo foco), compone el
  filtro con el buscador y añade los mensajes "sin coincidencias" (R11).
- `tests/components/MisAsignacionesModule.test.tsx` — 15 tests nuevos de la 117.
- `specs/117-filtro-canton-distrito/tasks.md` — tareas marcadas `[x]`.

## Composición con el buscador (114) — cómo se hizo

El pipeline de 114 ya dejaba `porRecogerFiltrado` y `porGestionarFiltrado` como únicas
fuentes de grilla, `paradasMapa` y `detalleOrden`. La 117 se integra SOBRE ese pipeline
(no lo duplica):

- `porRecogerFiltrado = aplicarFiltroZona(filtrarAsignaciones(porRecoger, query))` —
  buscador(texto) ∧ filtro(cantón/distrito), en cadena (AND).
- `porGestionarFiltrado`: primero el buscador (con la orden en gestión siempre incluida),
  luego `aplicarFiltroZona` en AND. Salvaguarda R10/R14: si el filtro cantón/distrito
  deja fuera la orden en gestión, se reinserta preservando el orden de ruta (nunca se
  oculta la gestión en curso). Al alimentar `paradasMapa`/`detalleOrden`/grilla desde
  esa lista, el mapa y el panel reflejan el conjunto filtrado (R14).
- Con `canton === ""` el filtro devuelve la lista intacta ⇒ el comportamiento previo de
  114 queda idéntico (sus tests siguen verdes).

Opciones (R13): se derivan de la UNIÓN `[...porRecoger, ...porGestionar]` SIN filtrar,
para que la selección actual no borre otras opciones de cantón.

## Preservación de 113/114/115/116

- 113 (detalle inline + modo foco): el filtro solo se renderiza en la vista de lista;
  en modo foco no se monta. La grilla, el detalle inline y el colapso a foco intactos.
- 114 (buscador): se compone en AND; sin filtro cantón/distrito el resultado es idéntico.
  Los 9 tests de 114 (incluida la salvaguarda R9 y la coherencia mapa) siguen verdes.
- 115 (gestionar más tarde): `porGestionarVisual` sigue ordenando sobre el conjunto
  filtrado; badge/toggle/sort intactos.
- 116 (mi nota): el indicador de la card y el editor del detalle no se tocan.

## Mapa requisito → prueba

| Req | Prueba |
| --- | --- |
| R1  | unit N/A; comp "117/R1: renderiza los selects de Cantón y Distrito…" (+ "en modo foco NO se renderiza…") |
| R2  | unit "derivarCantones (R2/R13)" (3 casos: etiqueta+orden, dedup insensible, homónimos); comp "117/R2: etiqueta 'Cantón (Provincia)'…" |
| R3  | comp "117/R3: sin cantón elegido, el select de Distrito está deshabilitado" |
| R4  | unit "derivarDistritos (R4)" (2 casos); comp "117/R4: al elegir un cantón, Distrito ofrece solo…" |
| R5  | comp "117/R5: cambiar de cantón resetea el distrito a 'todos'" |
| R6  | unit "filtrarAsignaciones (R6/R7)" (incl. excluye distrito nulo); comp "117/R6: filtrar por cantón+distrito…" |
| R7  | unit "R7: sin cantón devuelve la MISMA lista sin filtrar" |
| R8  | comp "117/R8: 'Limpiar filtros' restaura…" + "117/R8: elegir 'Todos los cantones'…" |
| R9  | comp "117/R9: 'Limpiar filtros' solo aparece cuando hay un filtro activo" |
| R10 | comp "117/R10: la orden EN GESTIÓN sigue visible (lista y mapa) aunque el filtro no la incluya" |
| R11 | comp "117/R11: filtro sin coincidencias muestra el mensaje 'coincide con el filtro'…" |
| R12 | unit (funciones puras, sin red/Server Actions); comp "117/R12 + 114: se COMPONE en AND con el buscador" |
| R13 | unit "estabilidad de opciones (R13)"; comp "117/R2" (dedup sobre el conjunto completo) |
| R14 | comp "117/R14: panel de detalle y mapa reflejan el conjunto filtrado" (+ mapa en R10) |

## Verificación

- `./init.sh`: **verde** (== init OK ==).
  - typecheck (`tsc --noEmit`): sin errores (tras regenerar el cliente Prisma desde el
    schema del worktree; el stale del store previo daba falsos negativos locales).
  - lint: 0 errores (143 warnings pre-existentes, ninguno en archivos de la 117).
  - test (`vitest run`): **482 archivos, 4804 tests, 4804 passed**.
- Suite acotada de la feature (unit 117 + módulo del mensajero): **87 passed**.

Nota: `migraciones sin down.sql` es un warning pre-existente (migraciones de chat/
whatsapp), ajeno a esta feature frontend.
