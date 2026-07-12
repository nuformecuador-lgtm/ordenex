# Feature 39 — Pago al mensajero por zona en el cierre — tasks.md

Convenciones: `[P]` = paralelizable con otras `[P]` del mismo bloque. Cada task cita
los requisitos que cubre y su criterio de "hecho".

F1.4 APROBADA (2026-07-12): SOLO `entregada` paga al mensajero (`cobroEntregado`); el
resto paga 0.00. El `cobroRechazado` (ingreso de bodega por rechazos) esta FUERA DE
ALCANCE -> feature 56 (`depends_on: 39`); NO se implementa aqui.

## Bloque A — Migracion y schema (base, bloquea al resto)

- **T0 — Migracion aditiva** (R14/R19/R22)
  Crear `db/migrations/20260712130000_pago_mensajero_cierre/migration.sql` (3 ADD
  COLUMN: `gestion_orden.pago_mensajero` NULL, `cierre_dia.total_pago_mensajero`
  NOT NULL DEFAULT 0, `cierre_bodega.total_pago_mensajero` NOT NULL DEFAULT 0) y su
  `down.sql` (3 DROP en orden inverso).
  Hecho: `pnpm run db:migrate` aplica; `pnpm run db:rollback` revierte; round-trip
  vuelve a "up to date"; `npx prisma migrate status` limpio.

- **T1 — Schema Prisma** (depende de T0) (R22)
  Agregar los 3 campos a `models GestionOrden`/`CierreDia`/`CierreBodega` en
  `db/schema.prisma` con sus `@map`/`@db.Decimal(12,2)`/`@default(0)`.
  Hecho: `npx prisma validate` OK; `npx prisma generate` OK; `pnpm typecheck` sin
  errores nuevos por drift schema<->cliente.

## Bloque B — Resolver de tarifa (nucleo, independiente de las vistas)

- **T2 [P] — Interfaz + repo del resolver** (R1/R2/R3)
  `lib/interfaces/repositories/ITarifaZonaMensajeroRepository.ts` (`PagoTarifa`,
  `resolvePagoTarifa`) + `lib/repositories/TarifaZonaMensajeroRepository.ts` (query
  exacta (zona,vehiculo) con fallback a `vehiculo_id IS NULL`; Decimal->string).
  Hecho: `tests/unit/repositories/tarifa-zona-mensajero-repository.test.ts` verde
  (exacto / fallback / mensajero sin vehiculo / zona sin tarifa -> null).

- **T3 [P] — Util puro resultado->monto** (R5/R6/R7/R7b/R8/R9)
  `lib/utils/pago-mensajero.ts` (`pagoPorResultado(resultado, tarifa|null)`). F1.4: SOLO
  `entregada` devuelve `cobroEntregado`; `rechazada`/`reprogramada`/`devuelta` -> "0.00".
  El util NUNCA lee `cobroRechazado` (eso es feature 56).
  Hecho: `tests/unit/services/pago-mensajero-resolver.test.ts` verde
  (entregada -> cobroEntregado; rechazada -> 0.00 incluso con `cobroRechazado > 0`;
  reprogramada/devuelta -> 0.00; tarifa null -> 0.00; STRING 2 decimales exacto).
  NO debe existir ningun test que espere que el mensajero cobre `cobroRechazado`.

- **T4 [P] — Resolver vehiculo del mensajero** (R1/R4)
  Extender `IOrdenRepository` + `OrdenRepository` con `findUsuarioVehiculoId`
  (o `findMensajeroZonaVehiculo`), espejo de `findUsuarioZonaId`.
  Hecho: test unit del repo verde; typecheck OK.

## Bloque C — Feature 37 (cierre del mensajero)

- **T5 — DTOs 37** (depende de T1) (R10/R11/R16 base)
  Agregar `pagoMensajero` a `CierreGestionPendienteRow`, `CierreDetalleGestion`,
  `WITH_DETALLE` (`pagoMensajero: true`) y `toPendienteRow`; agregar
  `totalPagoMensajero` a `ListarCierreDiaServiceResult.ok`, `CierrePasadoDTO`,
  `CrearCierreInput`.
  Hecho: typecheck OK; sin romper consumidores existentes.

- **T6 — listarCierreDia deriva pago** (depende de T2/T3/T4/T5) (R10/R11/R21)
  Inyectar el repo resolver + `findUsuarioVehiculoId`; resolver tarifa una vez;
  derivar `pagoMensajero` por gestion y `totalPagoMensajero` (suma Decimal); no tocar
  `CierreTotales`.
  Hecho: `tests/unit/services/cierre-dia-service.test.ts` verde (pago por orden +
  total; totales de dinero recibido INTACTOS).

- **T7 — solicitarCierre snapshotea** (depende de T6) (R12/R13/R14/R15)
  Calcular pago por gestion + total al solicitar; pasar a `crearCierre`.
  `CierreDiaRepository.crearCierre` puebla `pago_mensajero` (updateMany agrupado por
  resultado) + `total_pago_mensajero`, todo dentro de la `$transaction`.
  `findCierresByMensajero` expone `totalPagoMensajero` snapshot.
  Hecho: `tests/unit/repositories/cierre-dia-repository.test.ts` +
  `cierre-dia-service.test.ts` verdes (snapshot persistido en tx; cambio de tarifa
  post-cierre no altera el snapshot leido).

## Bloque D — Feature 38 (admin de cierres)

- **T8 — Detalle admin expone snapshot** (depende de T5/T7) (R16/R17)
  `CierresAdminRepository` reusa `WITH_DETALLE` (ya con `pagoMensajero`); agregar
  `totalPagoMensajero` a `CierreAdminResumen` (lectura de `cierre_dia`).
  Hecho: `tests/unit/services/cierres-admin-service.test.ts` verde (detalle por orden
  snapshot + total; sin recomputo).

## Bloque E — Feature 40 (cierre de bodega)

- **T9 — Consolidacion + snapshot agregado** (depende de T1/T7) (R18/R19)
  `CierreBodegaResumenLite`/`CierreBodegaResumen` + `CrearCierreBodegaInput` con
  `totalPagoMensajero`; `listarConsolidacion` suma el agregado (`sumPagoMensajero`);
  `solicitarCierreBodega` snapshotea el agregado en la tx de `crearCierreBodega`.
  Hecho: `tests/unit/services/cierre-bodega-service.test.ts` verde (agregado correcto;
  snapshot en tx).

- **T10 — Detalle bodega-admin** (depende de T9) (R20)
  `CierreBodegaDetalleCierre` + detalle de `ICierresBodegaAdminService` exponen pago
  por cierre_dia + agregado (snapshot).
  Hecho: `tests/unit/services/cierres-bodega-admin-service.test.ts` verde.

## Bloque F — UI (menor; Q7 abierto, condicionado a aprobacion)

- **T11 [P] — Columna/total en vistas** (R10/R11/R16/R17/R18/R20)
  Mostrar "pago al mensajero" por orden y el total en las pantallas existentes
  `/cierre-dia`, `/cierres-admin` y las de bodega, consumiendo los DTOs nuevos. Sin
  pantallas nuevas.
  Hecho: render verifica el dato; lint OK. (Alcance UI depende de F1.4-Q7.)

## Bloque G — Verificacion final (gate)

- **T12 — Trazabilidad R->test** (todos los R)
  Completar el mapa R1-R23 -> test en `progress/impl_39-*.md`; cada R con un test.
  Hecho: no queda ningun R sin test.

- **T13 — Migracion integration + round-trip** (R22)
  `tests/integration/db/pago-mensajero-migration.test.ts` (columnas presentes;
  cierres pre-migracion leen `0.00`). Round-trip `db:migrate` <-> `db:rollback`
  verificado contra la DB local.
  Hecho: test verde + round-trip vuelve a "up to date".

- **T14 — Suite completa + build** (regla #5)
  `npx prisma validate` OK, `pnpm typecheck` 0 errores, `pnpm lint` 0,
  `pnpm test` toda la suite verde (incluye +N tests nuevos), `./init.sh` VERDE,
  `pnpm build` pasa. Regresion 37/38/40 intacta.
  Hecho: todos los comandos en verde; sin regresiones en los cierres existentes.

## Dependencias (resumen)

```
T0 -> T1 -> {T5, T8, T9}
T2, T3, T4 [P] -> T6 -> T7 -> {T8, T9 -> T10}
{T8, T10, T11} -> T12, T13, T14 (gate)
```
