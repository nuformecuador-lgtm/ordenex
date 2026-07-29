# Feature 160 — Tasks

Checklist verificable. `[P]` = paralelizable con las tareas del MISMO bloque.
Cada task lleva su criterio de "hecho" y los `R<n>` que cubre. Zona `fullstack`:
la implementación se secuencia **backend (bloques 1-3) → frontend (bloques 4-5)**;
ninguna task de frontend arranca antes de que el bloque 3 esté verde.

Sin migración en toda la feature: si alguna task obliga a tocar
`db/schema.prisma`, es señal de que el diseño se torció (R13).

## Bloque 0 — Puerta F1.4 (bloquea todo)

- [ ] **T0. Cerrar las preguntas abiertas con el humano.**
  - Q1 (¿solo `devuelta` o también `reprogramada`?), Q2 (¿`incidente` cuenta?),
    Q3 (¿umbral en el chip?), Q4 (¿otras superficies?) de `design.md §7`.
  - **Hecho:** las cuatro respuestas quedan escritas en `progress/current.md`. Si
    Q1 o Q2 se resuelven en contra de la recomendación, esta feature se DETIENE:
    cambiar el derivador afecta al cron SLA (99) y a `cobroRechazado` (56) y
    exige su propio spec, no un chip. (R14)

## Bloque 1 — Backend · repositorio de historial (depende de T0)

- [ ] **T1. Extraer el predicado de "intento vigente" a función pura.**
  - En `lib/repositories/OrdenHistorialRepository.ts`, mover el `where` inline de
    `contarPorDestinoVigentes` a `whereVigentesPorDestino(ordenId, estatusDestinoId)`
    (acepta `string` o `{ in: string[] }`), y hacer que el método existente la use.
  - Sin cambio semántico: las dos ramas (`gestionOrdenId: null` + `origenTipo notIn
    ORIGEN_TIPOS_CON_GESTION`) y (`gestion: { anuladaAt: null }`) quedan idénticas.
  - **Hecho:** la suite existente de `contarPorDestinoVigentes` pasa SIN tocar sus
    aserciones (gestión anulada no cuenta, huérfana no cuenta, `ajuste_estado` sí
    cuenta). (R3, R14)

- [ ] **T2. Método en lote `contarPorDestinoVigentesEnLote`.** (depende de T1)
  - Firma en `lib/interfaces/repositories/IOrdenHistorialRepository.ts`:
    `(ordenIds: string[], estatusDestinoId: string) => Promise<Map<string, number>>`,
    documentada (órdenes sin filas ausentes del Map; ids vacío → Map vacío).
  - Implementación con `groupBy({ by: ["ordenId"], where: whereVigentesPorDestino({ in: ids }, destino), _count: { _all: true } })`;
    fallback admitido: `findMany({ select: { ordenId: true }, where: <mismo predicado> })`
    + conteo en memoria (design §3.2).
  - Guarda temprana `ids.length === 0 → new Map()` (patrón `findMensajerosBloqueados`).
  - **Hecho:** unit tests verdes que afirman (a) con N ids, el mock de Prisma
    recibe **exactamente 1** llamada; (b) `ids = []` → 0 llamadas y Map vacío;
    (c) el `where` usado es el MISMO objeto que produce `whereVigentesPorDestino`
    (comparación directa contra el del conteo individual); (d) una orden con
    gestión anulada y otra con fila huérfana devuelven el mismo número que
    `contarPorDestinoVigentes` para esa orden. (R3, R4, R5)

## Bloque 2 — Backend · servicio de historial (depende de T2)

- [ ] **T3. `contarIntentosEnLote` en `IOrdenHistorialService` + implementación.**
  - `lib/services/OrdenHistorialService.ts`: resuelve UNA vez
    `findEstatusIdByValue(ESTATUS_DEVUELTA)`; `null` → `new Map()`; si no, delega
    en el método del repo. `contarIntentos(ordenId)` queda intacto.
  - **Hecho:** unit tests verdes: (a) catálogo sin `devuelta` → Map vacío, sin
    llamar al repo y sin excepción; (b) el id de destino resuelto se pasa tal cual
    al repo; (c) `contarIntentos` sigue verde sin cambios de aserción. (R3, R6, R14)

## Bloque 3 — Backend · exposición en los dos listados (dependen de T3)

- [ ] **T4. `[P]` Campo `intentosEntrega?` en los dos DTO.**
  - `lib/types/orden.ts`: `OrdenListItemDTO.intentosEntrega?: number` con el
    comentario del patrón aditivo (molde de `zonaEsGam?`, `:155`).
  - `lib/interfaces/services/IMisAsignacionesService.ts`:
    `MiAsignacionDTO.intentosEntrega?: number` (molde de `marcarLuego?`).
  - `OrdenDTO` NO se toca.
  - **Hecho:** `tsc` en verde y ningún fixture/mock existente roto (campo
    opcional). (R15)

- [ ] **T5. Merge en el listado de órdenes.** (depende de T4)
  - `OrdenService`: nueva dep de constructor requerida
    `Pick<IOrdenHistorialService, "contarIntentosEnLote">` (import **type-only**,
    sin ciclo).
  - `listar`: tras `repo.list`, un solo `contarIntentosEnLote(items.map(i => i.id))`
    y merge `intentosEntrega: mapa.get(id) ?? 0`.
  - Actualizar el wiring `buildOrdenService()` en `lib/actions/ordenes.ts` (molde
    de `lib/actions/orden-historial.ts:31-37`) y las ~18 construcciones
    `new OrdenService(repo)` de `tests/unit/services/orden-service.test.ts` y
    `tests/unit/services/rol-admin-satelite-authz.test.ts` con un stub.
  - **Hecho:** unit tests verdes: (a) los items salen con `intentosEntrega`
    numérico, 0 incluido; (b) los ids pasados al lote son EXACTAMENTE los items ya
    acotados por rol (adminTienda/mensajero); (c) página vacía → 0 llamadas al
    historial; (d) el resto de la suite de `listar` (paginación, orden, filtros)
    verde sin cambios de aserción. (R1, R4, R5, R7, R12, R16)

- [ ] **T6. `[P]` Merge en el portal del mensajero.** (depende de T4)
  - `MisAsignacionesService`: misma dep nueva; tras el `Promise.all`, un solo
    `contarIntentosEnLote(rows.map(r => r.id))` y merge en el `for` que ya arma el
    DTO (junto a `marcarLuego`/`notaPrivada`), para AMBOS grupos.
  - Actualizar wiring y fixtures de la acción/servicio.
  - **Hecho:** unit tests verdes: (a) `porRecoger` y `porGestionar` traen
    `intentosEntrega`; (b) una sola llamada al lote por listado; (c) suite
    existente de `/mis-asignaciones` (KPIs, orden de ruta, nota privada) verde sin
    cambios de aserción. (R2, R4, R7, R16)

- [ ] **T7. Gate de fin de fase backend.** (depende de T5, T6)
  - **Hecho:** `./init.sh` verde + suite completa verde + `git diff` sin cambios en
    `db/schema.prisma` ni `db/migrations/`. Recién aquí arranca el frontend.
    (R13, R14, R16)

## Bloque 4 — Frontend · componente del chip (depende de T7)

- [ ] **T8. `components/shared/IntentosEntregaBadge.tsx`.**
  - Presentación pura: props `{ intentos: number }`; devuelve `null` si `< 1`
    (regla de ocultamiento en UN solo sitio); `Badge` `variant="warning"`,
    `role="status"`, `aria-label={`Intentos de entrega: ${n}`}`, texto
    `1 intento` / `${n} intentos`.
  - Sin fetch, sin lógica de dominio (recibe el número por props).
  - **Hecho:** component test: `intentos = 0` → no renderiza nada; `1` → texto
    singular; `3` → plural + nombre accesible correcto. (R8, R9, R10)

## Bloque 5 — Frontend · las dos superficies (dependen de T8; `[P]` entre sí)

- [ ] **T9. `[P]` Chip en el listado de órdenes.**
  - `app/(app)/ordenes/_components/ordenes-columns.tsx`: dentro de la celda de la
    columna `estatus`, envolver `EstatusBadge` + `IntentosEntregaBadge` en un
    `flex flex-wrap items-center gap-1`. Sin columna nueva.
  - **Hecho:** component tests verdes: (a) fila con `intentosEntrega = 2` muestra
    el chip en la celda de estado; (b) fila con `0` y fila con el campo ausente
    renderizan la celda EXACTAMENTE como antes (sin chip ni placeholder); (c) los
    ids y el orden de `ordenesColumns` no cambian, y el test existente
    `ordenesColumnsReprogramada.length === ordenesColumns.length + 1` sigue verde;
    (d) el chip aparece también en el dashboard del adminTienda, que deriva de
    `ordenesColumns`. (R8, R9, R11, R16)

- [ ] **T10. `[P]` Chip en la card del mensajero.**
  - `app/(app)/mis-asignaciones/_components/pos-card/PosOrderCard.tsx`: sumar el
    chip a la fila de marcas informativas existente (líneas 71-84) y ampliar la
    guarda del contenedor con `(orden.intentosEntrega ?? 0) >= 1`.
  - **Hecho:** component tests verdes: (a) card con `intentosEntrega = 2` muestra
    el chip; (b) con `0`/ausente no aparece, y si además no hay "pendiente de
    optimizar" ni "gestionar más tarde" la fila de marcas NO se renderiza (sin
    hueco vacío); (c) los tests existentes de la card POS siguen verdes. (R9, R10, R16)

## Bloque 6 — Cierre

- [ ] **T11. `[P]` Verificar el no-alcance.**
  - Confirmar que `HistorialOrdenSheet` (drawer, feature 47),
    `/recepcion-satelite`, la revisión del maestro, el cron SLA y
    `contarIntentos(ordenId)` quedan sin cambios de comportamiento.
  - **Hecho:** suites de historial/SLA/satélite verdes sin cambios de aserción;
    `git diff` acotado a los archivos listados en T1-T10. (R14, R16)

- [ ] **T12. Trazabilidad y verificación final.** (depende de todo)
  - Completar la tabla R→test de `requirements.md` con rutas reales y documentar
    el mapa en `progress/impl_160-badge-intentos-entrega.md`.
  - **Hecho:** `./init.sh` verde + suite completa verde; cada `R1..R16` mapeado a
    ≥ 1 test concreto; sin migración nueva en el diff.

## Grafo de dependencias

```
T0 ── T1 ── T2 ── T3 ─┬─ T4 ─┬─ T5 [P] ─┐
                      │      └─ T6 [P] ─┤
                      │                 └─ T7 (gate backend) ── T8 ─┬─ T9  [P] ─┐
                                                                    ├─ T10 [P] ─┤
                                                                    └─ T11 [P] ─┴─ T12
```
