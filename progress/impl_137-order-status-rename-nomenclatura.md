# impl 135 — Rename de nomenclatura de `order_status` · BACKEND (Fase 1 de 2)

> Fase 1 (backend) COMPLETA. Fase 2 (frontend_dev) pendiente: EstatusBadge/labels (R6/R8),
> literales en componentes `app/(app)/**/_components`, `components/{shared,private}`, tests de
> componente/UI y `e2e/`, y dejar el guard de censo R13 en verde.
>
> Mapeo del gate aplicado (6 renames, conservando POSICION en `ORDER_STATUS_SEED`):
> `en_reparto`→`en_ruta` · `en_espera_aceptacion`→`por_recoger` ·
> `en_bodega`→`en_bodega_central` (igualdad EXACTA, no toca los vecinos satelite) ·
> `en_ruta_bodega_principal`→`en_ruta_bodega_central` · `devuelta_origen`→`devolviendo_a_tienda` ·
> `recibido_origen`→`devuelta_a_tienda`.

## Archivos creados (nuevos)
- `db/migrations/20260724120000_order_status_rename_nomenclatura/migration.sql` (UP, 6 UPDATE)
- `db/migrations/20260724120000_order_status_rename_nomenclatura/down.sql` (DOWN, 6 UPDATE inversos)
- `tests/integration/db/order-status-rename-nomenclatura-migration.test.ts` (R2/R3/R4)
- `tests/unit/guards/censo-order-status-rename.test.ts` (R13; ROJO hasta que frontend termine)

## Archivos modificados (122)
- Fuente de verdad: `lib/types/order-status.ts` (T1, tupla + comentarios; los 6 literales
  renombrados conservan su indice: 2/5/6/8/10/13).
- Tipos/contrato externo (R9, breaking, sin capa de traduccion): `lib/types/{webhook-eventos,
  api-orden,recepcion-origen,recepcion-satelite,orden,orden-historial,orden-guia}.ts`,
  `lib/api/openapi-spec.ts`, `docs/api/api-key-openapi.yaml`,
  `app/api/ordenes/api-key/[numGuia]/cancelar/route.ts`, `app/api/ordenes/api-key/carga/route.ts`.
- Servicios (15), repositorios (6), actions (8), interfaces `I*` (services+repos): cada literal
  de estado al nuevo `value`; nombres de constante/columna SIN cambio
  (`ESTADOS_CANCELABLES_API`, `ORIGEN_RUTEO_SATELITE`, `ESTADOS_PENDIENTES`, mapa `devuelta:[…]`,
  `ESTATUS_BODEGA_CENTRAL`, cast `as "por_recoger"` en `AsignacionSateliteService`, etc.).
- Comentarios (sin logica): `db/schema.prisma` (~350-351 y comentarios de flujo del enum de
  historial), `lib/config/ordenes.ts` (el default `en_preparacion`/`en_fulfillment` NO cambia, R11).
- Tests backend (T15/T16/T19): `tests/unit/types/order-status.test.ts` (set + posicionales),
  `tests/integration/db/order-status-enum-migration.test.ts` (T16: DESACOPLADO del seed, afirma los
  8 literales HISTORICOS), `tests/integration/db/zonas-migration.test.ts` (+ migracion nueva en la
  lista "apendida despues"), y ~110 suites de services/repos/actions/db/integration con datos y
  aserciones a los nuevos values.

## Mapa R → test (backend)
| R | Verificacion (verde) |
|---|----------------------|
| R1 | `tests/unit/types/order-status.test.ts` — set == 15 nuevos values; ausencia de los 6 antiguos. |
| R2 | `tests/integration/db/order-status-rename-nomenclatura-migration.test.ts` — UP: 6 UPDATE antiguo→nuevo, sin ALTER TYPE / recrear tabla / tocar `id`. |
| R3 | idem — DOWN: 6 UPDATE inversos + round-trip UP∘DOWN exacto. |
| R4 | idem — aplica el SQL parseado a catalogo+FK en memoria: `id` preservado, `orden`/historial sin reescritura, conteos estables. |
| R5 | `lib/types/order-status.ts` (`OrderStatusValue` deriva de la tupla) + `order-status.test.ts`. |
| R7 | Suites de services/repos/actions que ejercen guardas y sets: `guia-asignacion-*`, `cierre-dia-*`, `mis-asignaciones-*`, `asignacion-satelite-*`, `corte-diario-*`, `recepcion-origen-*`, `devolucion-origen-*`, `api-orden-cancelacion-*`, `bulk-orden-*`, etc. (todas verdes). |
| R9 | `tests/integration/api/ordenes-api-key-{listado,carga,cancelar}.route.test.ts` + `tests/unit/services/{webhook-estado-service,webhook-estado-encolado,api-orden-lectura-service}.test.ts`. |
| R10 | `tests/integration/db/order-status-enum-migration.test.ts` (8 literales historicos, desacoplado) + `gestion-orden-migration.test.ts` + `tests/unit/db/orden-num-guia-deferred.test.ts` (historicos, allowlisted). |
| R11 | `order-status-rename-nomenclatura-migration.test.ts` (WHERE exacto no toca satelite; `en_bodega` exacto) + `lib/config/ordenes.ts` default intacto + guard `en_bodega` word-boundary. |
| R12 | Todas las suites backend verdes + test NUEVO de la migracion rename. |
| R13 (backend) | `tests/unit/guards/censo-order-status-rename.test.ts` creado y CORRECTO: sus unicos offenders son archivos de frontend (ver "Pendiente frontend"); cero offenders backend. |

## Pendiente para frontend_dev (Fase 2)
- **R6/R8**: `app/(app)/ordenes/_components/EstatusBadge.tsx` (claves + TEXTO de labels = value legible),
  y literales/comparaciones en `app/(app)/**/_components/*`, `app/(app)/ordenes/page.tsx`,
  `components/shared/PrioridadResalte.tsx`, `components/private/BodegaLiberadasHoy.tsx`.
- Tests de UI: `tests/components/*`, `tests/unit/components/*` y `e2e/*` (labels nuevos: "En bodega
  central", "En ruta a bodega central", "Devuelta a tienda", "En ruta a bodega satelite",
  "En bodega satelite").
- **Guard R13 verde**: al migrar los literales frontend, `censo-order-status-rename.test.ts` pasa a
  verde (offenders == []). Allowlist ya fijado (6 tests de migracion historica/rename).

## Salida real de la verificacion (vitest DIRIGIDO — no `./init.sh`, build de UI rojo por diseno)
Cliente Prisma regenerado con URL dummy (no hay `.env`/DB local; `generate` no conecta).

`pnpm vitest run tests/unit/types tests/unit/services tests/unit/repositories tests/unit/actions tests/unit/db tests/unit/scripts tests/unit/utils tests/unit/filtro-canton-distrito.test.ts tests/integration`:
```
Test Files  322 passed (322)
     Tests  3488 passed (3488)
  Duration  ~38s
```

Guard (esperado ROJO en esta fase, solo por frontend):
```
tests/unit/guards/censo-order-status-rename.test.ts → 1 failed
  offenders: SOLO app/(app)/**, components/{shared,private}, tests/components/**,
             tests/unit/components/**, e2e/**  (ningun archivo backend)
tests/unit/guards/censo-simpe.test.ts → passed
```

- `typecheck`/`lint` de TODO el proyecto: NO ejecutados como gate (Fase 1: la UI aun usa los values
  viejos → `tsc --noEmit` del proyecto es ROJO por diseno hasta que frontend_dev termine).

## Notas / desviaciones
- **T4 (aplicar/rollback en DB real)**: DIFERIDO. No hay `.env`/`DATABASE_URL` ni Postgres local en
  este entorno; `db:migrate`/`db:rollback` no son ejecutables aqui. R2/R3/R4 quedan trazados
  estatica y en-memoria por el test nuevo (mismo criterio que el precedente `metodo_pago_rename`).
  Deuda: aplicar en local/CI tras merge (`prisma migrate deploy` + verificar rollback con `down.sql`).
- **T18 (`scripts/seed-ordenes-qa.ts`)**: el archivo NO existe en este worktree (no-op). El seed de
  catalogo (`scripts/seed-catalogos.ts`) itera `ORDER_STATUS_SEED` por `upsert(value)` y toma los
  nuevos values sin edicion.
- **Historicos preservados (allowlist del guard)**: `order-status-enum-migration.test.ts`,
  `gestion-orden-migration.test.ts`, `cierre-detail-migration.test.ts`, `zonas-migration.test.ts`,
  `orden-num-guia-deferred.test.ts` y la traza UP/DOWN `order-status-rename-nomenclatura-migration.test.ts`
  conservan literales viejos por diseno (R10/R2/R3).
- **Preexistente, fuera de alcance**: `tests/unit/guards/no-embalaje.test.ts` falla por dos lineas en
  `specs/135-.../{design,requirements}.md` (mencionan la carpeta historica
  `_rename_order_status_embalaje_en_fulfillment`). Son archivos del spec_author (commit previo), no
  del backend; `specs/` esta fuera de mi alcance.

## Veredicto (Fase 1)
Backend del rename COMPLETO y verde en sus suites dirigidas (322 archivos / 3488 tests); el guard R13
y el build quedan rojos por diseno hasta que frontend_dev cierre la Fase 2.

---

# impl 135 · FRONTEND (Fase 2 de 2) — COMPLETA

## Archivos modificados (frontend, 62)
### Producción — presentación y lógica de UI (19)
- **Bloque B (T5)** `app/(app)/ordenes/_components/EstatusBadge.tsx`: renombradas las CLAVES de
  `ORDER_STATUS_LABELS`, `ORDER_STATUS_VARIANT`, `ORDER_STATUS_CLASS` a los 6 nuevos values
  (variante/clase CONSERVADAS); TEXTO de labels alineado al value legible (R8): "En bodega central",
  "En ruta a bodega central", "Devuelta a tienda", "En ruta a bodega satélite", "En bodega satélite".
  El case dinámico `en_ruta_bodega_satelite` (`En ruta a bodega ${zonaNombre}`) queda coherente con la
  etiqueta estática nueva.
- **Bloque D (T11-T13)** literales/comparaciones/comentarios al nuevo value:
  `app/(app)/ordenes/_components/{OrdenesTabs,OrdenesRevisionMaestro,GenerarGuiaModal,OrdenesModule,
  OrdenesApartado,AsignarBodegaModal,DevolverATiendaModal,RecuperarABodegaModal,EscanerRecepcionOrigen}.tsx`,
  `app/(app)/ordenes/page.tsx` (array `EXCLUDE_POR_ROL` adminTienda: `en_bodega`→`en_bodega_central`),
  `app/(app)/mis-asignaciones/_components/{MisAsignacionesModule,EscanerRecoger,InputRecoger,useRecogerPorGuia}.ts(x)`,
  `app/(app)/recepcion-satelite/_components/RecepcionSateliteModule.tsx`,
  `components/shared/PrioridadResalte.tsx`, `components/private/BodegaLiberadasHoy.tsx`.
  Runtime tocado: `ESTADO_EN_BODEGA`/`ESTADOS_ASIGNACION` y `case` en OrdenesTabs; `estatusValue`/
  `.get("<value>")` en OrdenesRevisionMaestro; `r.estado === "<value>"` en GenerarGuiaModal.
  Los vecinos `en_bodega_satelite`/`en_ruta_bodega_satelite` NO se tocaron (R11).

### Tests UI + e2e (43)
- `tests/components/*` (23) y `tests/unit/components/*` (3): datos/fixtures/aserciones a los nuevos
  values; los tests de TEXTO de etiqueta usan los labels R8 (`EstatusLabel.test.ts` reescrito a mano:
  claves nuevas + textos legibles).
- `e2e/*` (7 specs listados): values en comentarios/constantes al nuevo nombre.
- Guard `no-embalaje` (T de saneo): whitelisted `specs/135-order-status-rename-nomenclatura/` (cita el
  folder histórico `_rename_order_status_embalaje_en_fulfillment` como precedente; no reintroduce valor).

## Mapa R → test (frontend)
| R | Verificación (verde) |
|---|----------------------|
| R6 | `tests/components/{EstatusLabel,OrdenesEstatusLabelAdminTienda,OrdenesRevisionMaestro,OrdenesApartado,HistorialOrdenTimeline,HistorialOrdenSheet}.test.tsx` — label por nueva key; variante/clase conservadas. |
| R8 | `tests/components/EstatusLabel.test.ts` (mapa hardcodeado = value legible: "En bodega central", "En ruta a bodega central", "Devuelta a tienda", "En ruta a bodega satélite", "En bodega satélite") + tests de badge/columnas. |
| R13 | `tests/unit/guards/censo-order-status-rename.test.ts` **VERDE**: offenders == []; los únicos archivos con literales viejos son los 5 de la allowlist (migraciones históricas/rename, territorio backend). |

## Salida real de la verificación (frontend)
- `pnpm run typecheck` (`tsc --noEmit`) — **VERDE** (Prisma regenerado antes; exhaustividad
  `Record<OrderStatusValue,…>` satisfecha).
- `pnpm run lint` — **0 errores** (143 warnings preexistentes, ninguno introducido).
- `pnpm run test` (`vitest run`, suite COMPLETA) — **VERDE**: `Test Files 484 passed (484)`,
  `Tests 4815 passed (4815)`.
- Guards clave: `censo-order-status-rename` (R13) y `no-embalaje` — ambos VERDES.

## Desviación (bloqueo de orquestación, NO de frontend)
- `./init.sh` NO alcanza la suite: corta en el gate "máx 2 in_progress por zona" —
  `fullstack: 107, 120, 135 (3 in_progress)`. Es estado de `feature_list.json` (lista de exclusión,
  territorio del leader), preexistente a esta fase (107 y 120 ya estaban in_progress; el leader marcó
  135 in_progress en el commit `3ab58a4`). Los pasos de calidad de init.sh (typecheck+lint+test) se
  corrieron por separado y están VERDES. Requiere que el leader baje una fullstack a `done`/otro estado
  antes de que init.sh imprima "== init OK ==". No lo resuelvo por no tocar `feature_list.json`.

## Veredicto (Fase 2)
Frontend del rename COMPLETO: type-check verde, lint sin errores, suite completa verde (484/4815),
guards R13 y no-embalaje verdes. Único pendiente ajeno al frontend: el gate max-2-por-zona de
`feature_list.json` (leader).
