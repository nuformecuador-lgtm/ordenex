# Feature 41 — Reglas y bloqueos de cierre — tasks

> Checklist verificable. `[P]` = paralelizable con otras `[P]` del mismo bloque. Cada
> task trae su criterio de "hecho". Depende de features 37/38/40 (done). Baseline VERDE
> (1867 tests, init.sh OK). No se toca `feature_list.json` ni `progress/`.

## Bloque A — Modelo de datos y tipos (backend) [precede a todo]

- [x] **A1.** Añadir `vencido` a `CIERRE_ESTADO_SEED` (`lib/types/cierre.ts`) y al enum
  `CierreEstado` en `db/schema.prisma`.
  _Hecho:_ `pnpm typecheck` verde; la comprobación de exhaustividad (`_EnsureEstadoExhaustive`)
  compila con los 4 valores. (R2)

- [x] **A2.** Crear migración `db/migrations/20260712150000_cierre_estado_vencido/migration.sql`:
  `ALTER TYPE "cierre_estado" ADD VALUE 'vencido';` (fuera de tx, patrón
  `20260710150000_order_status_value_enum`) + `CREATE INDEX
  "cierre_dia_mensajero_id_estado_idx" ON "cierre_dia"("mensajero_id","estado");`.
  Añadir `@@index([mensajeroId, estado])` al modelo `CierreDia`.
  _Hecho:_ `pnpm db:migrate` aplica sin error; `prisma validate` OK. (R2/R12/R23)

- [x] **A3.** Escribir `down.sql` de A2: drop del índice + recrear el enum sin `vencido`
  (rename → create viejo → migrar columnas `cierre_dia.estado`/`cierre_bodega.estado`
  con `USING` → drop enum renombrado), con precondición documentada (no filas
  `estado='vencido'`).
  _Hecho:_ `pnpm db:rollback` round-trip OK en entorno de prueba (aplica y revierte). (R3)

## Bloque B — Helpers compartidos (backend) [P tras A1]

- [x] **B1. [P]** Extraer `resolverDestinoCierre(zonaId, centralZonaId)` a
  `lib/utils/bodega-responsable.ts` y refactorizar `CierreDiaService.solicitarCierre`
  para usarlo (sin cambiar comportamiento).
  _Hecho:_ tests existentes de 37 siguen verdes; unit nuevo cubre central vs satélite. (R1)

- [x] **B2. [P]** Mover/exportar los helpers de snapshot (`computeTotales`,
  `derivarPagos`, `derivarIngresoBodega`) a `lib/utils/cierre-totales.ts` reusable, sin
  alterar los cálculos (money-critical).
  _Hecho:_ tests de 37/39/56 verdes; import actualizado en `CierreDiaService`. (R4/R8)

## Bloque C — Corte diario (backend) [depende de A, B]

- [x] **C1.** `crearCierre` de `CierreDiaRepository` parametrizado con `estado`
  (default `solicitado`); añadir `crearCierreVencido` (o reuso con `estado='vencido'`)
  con la MISMA tx de vinculación de gestiones + snapshot; devuelve `null` si vincula 0.
  _Hecho:_ unit con doble de Prisma verifica INSERT `vencido` + UPDATE guardado; rollback
  si 0 filas. (R8/R9/R23)

- [x] **C2.** `ICorteDiarioRepository` + `CorteDiarioRepository.findMensajerosConActividadSinCierre()`
  (mensajeros con `gestion_orden.cierre_id IS NULL` y sin cierre `solicitado`).
  _Hecho:_ integración con DB de test devuelve el set correcto en 3 escenarios
  (con pendientes / con solicitado / sin actividad). (R7/R10)

- [x] **C3.** `CorteDiarioService.ejecutarCorte()`: itera mensajeros, deriva destino
  (B1), snapshot (B2), crea `vencido`; omite mensajero sin zona con log.
  _Hecho:_ unit sin DB: crea vencido para el que debía, salta el que tiene `solicitado`,
  salta el sin zona; segunda corrida = 0 nuevos. (R6/R7/R9/R10/P2)

- [x] **C4.** Route handler `app/api/cron/corte-diario/route.ts` (GET): valida
  `CRON_SECRET` (401 si falla), delega en el service, 200 con resumen; `withErrorHandler`
  + notificación de error; nunca loguea el secreto.
  _Hecho:_ integración: 401 sin/incorrecto secreto (sin efectos); 200 con secreto;
  handler sin queries ni lógica de negocio. (R5/R24)

- [x] **C5.** `vercel.json` con `crons: [{ path: "/api/cron/corte-diario", schedule:
  "0 6 * * *" }]`; documentar `CRON_SECRET` en `.env.example`.
  _Hecho:_ `vercel.json` válido; schedule = 00:00 CR (06:00 UTC) comentado en el spec/PR. (R11)

## Bloque D — Bloqueo derivado en asignación (backend) [depende de A2]

- [x] **D1.** `IOrdenRepository.findMensajerosBloqueados(ids)` +
  `existeBodegaSateliteBloqueada(zonaId)` (+ implementación en `OrdenRepository`), usando
  los índices `(mensajero_id, estado)` y `(destino_tipo, destino_zona_id)`.
  **Regla estricta R17 (F1.4-Q4):** `existeBodegaSateliteBloqueada` devuelve
  `{ bloqueada, porMensajeros, porCierreBodega }` y evalúa AMBAS causas (OR):
  (i) `EXISTS` `cierre_dia` `destino_tipo='bodega_satelite'`, `destino_zona_id=zonaId`,
  `estado IN ('solicitado','vencido')`; **O** (ii) `EXISTS` `cierre_bodega`
  `zona_id=zonaId` `estado='solicitado'` — reutilizando el repo de `CierreBodega`
  (feature 40); verificar si ya existe un lookup del `CierreBodega solicitado` por zona
  (guardia de unicidad de `SolicitarCierreBodegaService`) antes de crear
  `existeCierreBodegaPendiente(zonaId)`.
  _Hecho:_ integración: mensajero solicitado/vencido → bloqueado, rechazado/aprobado → no
  (R12/R16); bodega bloqueada por SOLO (i), por SOLO (ii), y por ambas; sin ninguna →
  `bloqueada=false`. (R12/R16/R17)

- [x] **D2.** Guarda en `GuiaAsignacionService.generarGuia` y `asignarDesdeBodega`:
  mensajero bloqueado → `conflict` con `detalle`, sin efectos parciales.
  _Hecho:_ unit con dobles: lote con un mensajero bloqueado no persiste nada. (R13/R23)

- [x] **D3.** Guardas en `AsignacionSateliteService.asignar` (feature 34), ANTES de
  cualquier escritura del lote: bodega bloqueada → resultado
  `{ status: "bodega_bloqueada", causa: { porMensajeros, porCierreBodega } }` (regla
  estricta R17: dispara si (i) cierres de sus mensajeros **O** (ii) su `CierreBodega`
  pendiente); mensajero bloqueado → `conflict`/`validation_error`. Sin efectos parciales.
  El borde traduce `causa` al mensaje accionable de R22.
  _Hecho:_ unit con dobles cubre bodega bloqueada por (i), por (ii) y por ambas; mensajero
  bloqueado; y camino feliz sin bloqueo — ninguno con efectos parciales. (R14/R18)

- [x] **D4.** Anti-TOCTOU (R23): integrar `NOT EXISTS` de cierre bloqueante en el `WHERE`
  de `asignarSateliteLote` / `generarGuiaLote` (o justificar el pre-check si el SQL del
  lote lo complica).
  _Hecho:_ integración: cierre solicitado insertado entre lectura y escritura → count no
  cubre el lote → conflicto sin efectos. (R23)

## Bloque E — Resolución del vencido y cola admin (backend) [depende de A2, D1]

- [x] **E1.** Extender la guardia de `resolverCierre` (repo feature 38) para aceptar
  `estado IN ('solicitado','vencido')` como origen; aprobar/rechazar un `vencido`
  funciona con la auditoría existente.
  _Hecho:_ integración: aprobar y rechazar un `vencido` transiciona y desbloquea; totales
  no se recalculan. (R15/R19/R4)

- [x] **E2.** `CierresAdminService`/repo: categorizar `vencido` en la cola por alcance
  rol+zona (maestro central; adminSatelite su zona).
  _Hecho:_ unit/integración: el `vencido` aparece en el alcance correcto, diferenciado. (R20)

## Bloque F — UI (frontend) [depende de D1, E2]

- [x] **F1. [P]** `/cierres-admin`: etiqueta/categoría "vencido" en el listado existente.
  _Hecho:_ el vencido se muestra diferenciado; resoluble (botones aprobar/rechazar). (R20)
  Badge `EstadoCierreBadge` (variante `destructive` para `vencido` vs `secondary` para
  `solicitado`) + columna "Estado" en la cola de pendientes de `CierresAdminModule`;
  `esPendiente` extendido a `solicitado||vencido` para exponer aprobar/rechazar.

- [x] **F2. [P]** Vista del mensajero ("Cierre del día"/"Mis asignaciones"): aviso de
  bloqueo cuando `findMensajerosBloqueados([actor])` es true (dato por props desde Server
  Component/Action).
  _Hecho:_ componente/e2e muestra el aviso cuando hay cierre bloqueante. (R21)
  Server Action `estadoBloqueoMensajero` deriva el flag `bloqueado`; la page lo pasa por
  props a `CierreDiaModule`, que muestra el aviso `role="alert"`.

- [x] **F3. [P]** Vista del adminSatelite (asignación feature 34): aviso de bodega
  bloqueada + botón asignar deshabilitado cuando `existeBodegaSateliteBloqueada().bloqueada`
  es true; el mensaje diferencia la causa según `causa.porMensajeros` /
  `causa.porCierreBodega` (regla estricta R17).
  _Hecho:_ componente/e2e muestra el aviso (con el texto correcto para cada causa) y
  deshabilita asignar. (R22)
  Server Action `estadoBloqueoBodegaSatelite` + prop `bloqueoBodega` a
  `RecepcionSateliteModule` (aviso diferenciado + "Asignar" deshabilitado); el resultado
  reactivo `bodega_bloqueada` se traduce por `bodegaBloqueadaMensaje` en el toast del modal.

## Bloque G — Verificación y trazabilidad [cierre]

- [x] **G1.** Mapa `R<n> -> test` completo en `progress/impl_41-reglas-bloqueos-cierre.md`
  (R1..R24), con salida real de tests.
  _Hecho:_ cada R tiene al menos un test que lo cubre (el reviewer lo valida).

- [x] **G2.** `pnpm typecheck` + `pnpm lint` + `pnpm test` verdes; `./init.sh` verde;
  round-trip de migración OK; sin regresión en 37/38/40.
  _Hecho:_ init.sh en verde con el nuevo total de tests; features de cierre intactas.

- [x] **G3.** E2E del flujo crítico (money/recaudo): corte crea vencido → mensajero
  bloqueado → asignación rechazada → admin resuelve → desbloqueo.
  _Hecho:_ Playwright ejercita el camino completo (CHECKPOINTS: flujo crítico exige E2E).
  `e2e/reglas-bloqueos-cierre.spec.ts` (serial, DB-mutating): paso 2 aviso mensajero
  (R21), paso 3 bodega bloqueada + "Asignar" deshabilitado (R14/R18/R22), paso 4 badge
  "Vencido" resoluble en `/cierres-admin` (R19/R20), paso 5 desbloqueo (R15). WRITTEN
  but NOT EXECUTED (diferido, igual que los demás e2e; no corre bajo `pnpm test`).

## Dependencias (resumen)

```
A (modelo) ──▶ B (helpers) ──▶ C (corte)
   │                     └─────▶ D (bloqueo) ──▶ E (resolución/cola) ──▶ F (UI)
   └──────────────────────────────────────────────────────────────────▶ G (verif)
```
