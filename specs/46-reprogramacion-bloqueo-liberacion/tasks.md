# Feature 46 — Reprogramación: bloqueo y liberación programada — tasks.md

Checklist de pasos discretos y verificables. `[P]` = paralelizable con otras `[P]`
sin dependencia. Cada task indica el/los `R<n>` que cubre y el test que lo verifica.
El implementer copia el mapa `R<n> -> test` a `progress/impl_46-...md`.

Leyenda de "hecho": la task está hecha cuando su test pasa (o, si es de
infra/verificación, cuando el comando indicado termina en verde).

---

## A. Datos / migración

- [x] **T1** — Añadir `liberadaReprogramadaAt DateTime? @map("liberada_reprogramada_at")`
  a `model Orden` en `db/schema.prisma`.
  - Cubre: R18. Hecho: `pnpm run typecheck` compila el cliente Prisma con el campo.
- [x] **T2** — Crear migración `db/migrations/<ts>_orden_liberada_reprogramada_at/`
  con `migration.sql` (ADD COLUMN + `CREATE INDEX ... WHERE liberada_reprogramada_at
  IS NOT NULL`) y `down.sql` (DROP INDEX + DROP COLUMN). Depende de T1.
  - Cubre: R18. Hecho: test de round-trip
    `tests/integration/db/orden-liberada-reprogramada-migration.test.ts`
    (aplica up, verifica columna/índice, aplica down, verifica que desaparecen).

## B. Hora CR (util)

- [x] **T3** `[P]` — Util `startOfDayCR(now?: Date): Date` en `lib/utils/fecha-cr.ts`
  (o reusar helper de fecha si ya existe). Comparación por día en America/Costa_Rica
  (UTC-6, sin DST).
  - Cubre: R9. Hecho: `tests/unit/utils/fecha-cr.test.ts` con casos frontera
    (23:59 CR = mismo día; 00:01 CR = día siguiente; instante UTC que cruza el offset).

## C. Repository de liberación

- [x] **T4** — Interfaz `ILiberacionReprogramadaRepository`
  (`lib/interfaces/repositories/`) con `findOrdenesLiberables(hoyCR)`,
  `liberarOrden(...)`, `findLiberadasHoy(...)`. Depende de T1.
  - Cubre: R10, R12, R13, R17. Hecho: typecheck.
- [x] **T5** — `LiberacionReprogramadaRepository` (`lib/repositories/`): implementa T4
  con Prisma. `findOrdenesLiberables` = `estatus.value = reprogramada` + `deletedAt
  null` + gestión `reprogramada` más reciente con `fecha_reprogramacion <= hoyCR`.
  `liberarOrden` = UPDATE guardado por `WHERE estatus_id = reprogramada` (idempotente).
  Depende de T4.
  - Cubre: R10, R11, R13, R17. Hecho:
    `tests/unit/repositories/liberacion-reprogramada-repository.test.ts`
    (selecciona solo `<= hoy`; excluye borradas; excluye futuras; UPDATE afecta 0
    filas si ya no está en `reprogramada`).

## D. Service de liberación

- [x] **T6** — Interfaz `ILiberacionReprogramadaService` + `LiberacionResult`
  (`{ evaluadas, liberadas, omitidas }`) en `lib/interfaces/services/`. `[P]` con C.
  - Cubre: R7. Hecho: typecheck.
- [x] **T7** — `LiberacionReprogramadaService.ejecutarLiberacion(hoyCR)`
  (`lib/services/`): deriva bodega con `resolverDestinoCierre` + `findCentralZonaId`,
  resuelve estatus destino, itera órdenes resiliente por ítem, marca `corridaAt`.
  Depende de T5, T6.
  - Cubre: R12 (central→en_bodega, satélite→en_bodega_satelite), R13 (limpia
    mensajero + marca), R14 (una orden que falla no aborta la corrida). Hecho:
    `tests/unit/services/liberacion-reprogramada-service.test.ts` con dobles:
    destino correcto por zona; `mensajero_asignado_id` a null; resumen de conteos;
    error en una orden ⇒ `omitidas++` y continúa.
- [x] **T8** — Verificar idempotencia a nivel service: segunda corrida no re-libera.
  Depende de T7.
  - Cubre: R17. Hecho: test en el archivo de T7 "no re-libera en segunda corrida
    (orden ya fuera de reprogramada ⇒ liberadas=0)".

## E. Endpoint cron

- [x] **T9** — Route handler `app/api/cron/liberar-reprogramadas/route.ts` clon del
  patrón `corte-diario`: `handleLiberarReprogramadas(req, deps)` + `GET`; auth
  `CRON_SECRET` (`loadCronConfig`), inyección de `getSecret`/`service`. Depende de T7.
  - Cubre: R6, R7, R19, R20. Hecho:
    `tests/integration/actions/liberar-reprogramadas-route.test.ts` (sin/incorrecto/no
    configurado → 401 sin llamar al service; correcto → 200 con resumen; no loguea el
    secreto).
- [x] **T10** — Añadir la segunda entrada de cron a `vercel.json`
  (`/api/cron/liberar-reprogramadas`, `"0 6 * * *"`). `[P]` con T9.
  - Cubre: R8. Hecho: `tests/unit/config/vercel-cron.test.ts` (o assert en el test de
    ruta) verifica path + schedule `0 6 * * *`.

## F. Guardas de bloqueo (servicios existentes)

- [x] **T11** — Constante `MSG_ORDEN_REPROGRAMADA_BLOQUEADA` compartida + guardia en
  `GuiaAsignacionService.generarGuia` y `.asignarDesdeBodega`: si alguna orden del
  lote tiene `estatusValue === "reprogramada"` → `conflict` con ese motivo, sin
  efectos. `[P]` con A–E.
  - Cubre: R1, R2, R5. Hecho: casos en
    `tests/unit/services/guia-asignacion-service.test.ts` (lote con una orden
    reprogramada ⇒ conflict, motivo tipado, 0 escrituras; en generar y en bodega).
- [x] **T12** — Guardia equivalente en `AsignacionSateliteService.asignar`. `[P]` con T11.
  - Cubre: R1, R3, R5. Hecho: caso en
    `tests/unit/services/asignacion-satelite-service.test.ts` (orden reprogramada ⇒
    conflict con motivo tipado, sin efectos).
- [x] **T13** — Test de bloqueo de envío (sin código nuevo): recoger/gestionar una
  orden `reprogramada` es rechazado por origen. `[P]`.
  - Cubre: R4. Hecho: casos en
    `tests/unit/services/mis-asignaciones-service.test.ts` (recoger y gestionar sobre
    `reprogramada` ⇒ conflict/forbidden sin efectos).

## G. Aviso derivado (frontend)

- [x] **T14** — Loader server-side: obtener "liberadas hoy" de la bodega
  (`liberada_reprogramada_at::date = hoyCR` + estatus destino + zona). Depende de T5.
  - Cubre: R15, R16. Hecho:
    `tests/unit/repositories/liberacion-reprogramada-repository.test.ts` (método
    `findLiberadasHoy` filtra por fecha CR + estatus + zona).
- [x] **T15** — Componente `private/` badge/sección "Liberadas hoy (reprogramación)"
  en la vista de bodega (maestro central / adminSatelite satélite), datos por props.
  Depende de T14.
  - Cubre: R15, R16. Hecho: `tests/components/BodegaLiberadasHoy.test.tsx` (renderiza
    la sección con las órdenes recibidas por props; vacía si no hay).

## H. E2E y verificación final

- [x] **T16** — E2E Playwright: reprogramar una orden con fecha futura ⇒ queda
  bloqueada (no asignable); simular corte de fecha ⇒ invocar el cron ⇒ la orden
  aparece en `en_bodega`/`en_bodega_satelite` y en "liberadas hoy". Depende de C–G.
  - Cubre: R1, R7, R12, R15 (flujo crítico). Hecho:
    `e2e/reprogramacion-liberacion.spec.ts` (escrito; ejecución DIFERIDA como todo el
    resto de `e2e/`: requiere dev server + DB sembrada + `CRON_SECRET`; no corre bajo
    `pnpm test`, misma convención que `reglas-bloqueos-cierre.spec.ts`).
- [x] **T17** — Confirmar fuera de alcance: no se añadió contador de intentos ni
  historial. `[P]`.
  - Cubre: R21. Hecho: nota en `progress/impl_46-...md` + ausencia de columnas/tablas
    de intentos/historial en el diff (revisión del reviewer).
- [x] **T18** — Verificación final: `./init.sh` verde (typecheck + lint + tests),
  round-trip de migración (`pnpm run db:migrate` → `pnpm run db:rollback`), mapa
  `R1..R21 -> test` en `progress/impl_46-...md`. Depende de todo.
  - Cubre: criterios de aceptación + R18. Hecho: `./init.sh` termina en verde y el
    mapa de trazabilidad está completo.

---

## Mapa de trazabilidad R -> test (resumen)

| R | Test |
| --- | --- |
| R1 | guia-asignacion-service.test.ts / asignacion-satelite-service.test.ts (bloqueo) |
| R2 | guia-asignacion-service.test.ts (generar + bodega) |
| R3 | asignacion-satelite-service.test.ts |
| R4 | mis-asignaciones-service.test.ts |
| R5 | guia-asignacion + asignacion-satelite (rechazo server-side sin efectos) |
| R6 | liberar-reprogramadas-route.test.ts (401 sin efectos) |
| R7 | liberar-reprogramadas-route.test.ts (200 + resumen) |
| R8 | vercel-cron.test.ts (path + schedule) |
| R9 | fecha-cr.test.ts (fronteras CR) |
| R10 | liberacion-reprogramada-repository.test.ts (selección) |
| R11 | liberacion-reprogramada-repository.test.ts (excluye futuras) |
| R12 | liberacion-reprogramada-service.test.ts (destino por zona) |
| R13 | liberacion-reprogramada-service.test.ts (limpia mensajero + marca) |
| R14 | liberacion-reprogramada-service.test.ts (resiliencia por orden) |
| R15 | liberacion-...-repository.test.ts + BodegaLiberadasHoy.test.tsx |
| R16 | BodegaLiberadasHoy.test.tsx (destinatario bodega) |
| R17 | liberacion-...-repository.test.ts + liberacion-...-service.test.ts (idempotencia) |
| R18 | orden-liberada-reprogramada-migration.test.ts (round-trip) |
| R19 | liberar-reprogramadas-route.test.ts (sin secreto/PII en logs) |
| R20 | liberar-reprogramadas-route.test.ts (controller delega) + ubicación de guardas |
| R21 | revisión del diff + nota en impl_46 (fuera de alcance) |
