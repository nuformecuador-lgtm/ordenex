# Implementación 139 — Flujo de devolución de RECHAZADAS (FASE 1 / BACKEND)

> Rama: `feature/139-devolucion-rechazadas-estados` (desde `origin/dev`, con 137 rename y 138
> recepción central YA mergeados). Esta es la FASE 1 (backend). La FASE 2 (frontend) la cierra
> `frontend_dev`.
> Canónico: 139 (esta), 138 (recepción central), 137 (rename). El cuerpo del spec cita a veces
> números viejos (135/136/137); en código los renames se comentan como "feature 135" (numeración
> vieja del rename) — se conserva esa nomenclatura de comentarios donde ya existía.

## Alcance implementado (Bloques 0, 1, 2 + tests backend)

### Bloque 0 — Migraciones y catálogo (fundacional)
- **T0.1** `lib/types/order-status.ts` — APÉNDICE de los 3 values al final de `ORDER_STATUS_SEED`
  (índices 15/16/17, sin mover posiciones previas): `por_devolver`,
  `devolviendo_a_bodega_central`, `por_devolver_a_tienda`.
- **T0.2** `db/migrations/20260724140000_order_status_devolucion_rechazadas/{migration.sql,down.sql}`
  — `INSERT ... WHERE NOT EXISTS` por value (idempotente); `down.sql` `DELETE` guardado por
  no-referencia. Patrón EXACTO de `20260722140000_order_status_sin_gestionar`.
- **T0.3** `db/migrations/20260724150000_orden_historial_origen_devolucion_rechazada/{migration.sql,down.sql}`
  — `ADD VALUE IF NOT EXISTS 'devolucion_rechazada'`; `down.sql` recrea el enum con la lista previa
  VIGENTE (21 valores, incluye `recepcion_bodega_central` de la 138) sin ese valor.
  + `db/schema.prisma` (enum `OrdenHistorialOrigenTipo`) + `lib/types/orden-historial.ts`
  (`ORDEN_HISTORIAL_ORIGEN_TIPO_SEED`, 21→22). `prisma generate` OK (URL dummy).
- **T0.4** `tests/unit/types/order-status.test.ts` + `tests/unit/scripts/seed-order-status.test.ts`
  (conteo 15→18 + set con los 3 nuevos, índices posicionales intactos). También
  `tests/unit/types/orden-historial-types.test.ts` (21→22) y
  `tests/unit/repositories/orden-historial-cobertura.test.ts` (punto de escritura #22 =
  `resolverCierre`/`devolucion_rechazada`).

### Bloque 1 — Disparo por aprobación del cierre
- **T1.1** `lib/interfaces/repositories/ICierresAdminRepository.ts` — `DevolucionRechazadasConfig`
  + campo opcional `devolucionRechazadas?` en `ResolverCierreInput`.
- **T1.2** `lib/services/CierresAdminService.ts` — `aprobarCierre` resuelve ids
  `rechazada`/`por_devolver`/`por_devolver_a_tienda` (+ reusa `centralZonaId`) y pasa la config
  SOLO en la rama `aprobado`. `rechazarCierre` NO la pasa (R10). Config `undefined` si el catálogo
  está incompleto (no-op defensivo).
- **T1.3** `lib/repositories/CierresAdminRepository.ts` — dentro de la MISMA tx `aprobado`, tras la
  liberación `sin_gestionar`: `findMany` rechazadas del mensajero → agrupar por
  `resolverDestinoCierre` → `updateMany` guardado por `estatus_id = rechazada` (satélite→`por_devolver`,
  central→`por_devolver_a_tienda`), SIN tocar mensajero/asignado_at/prioridad → `appendCambioEstado`
  (`devolucion_rechazada`, actor = admin). Idempotente (R7), money-neutral (R8), `rechazado` no
  dispara (R10).

### Bloque 2 — Envíos / recepciones / scope
- **T2.1** `lib/services/EnvioDevolucionCentralService.ts` +
  `lib/interfaces/services/IEnvioDevolucionCentralService.ts` +
  `lib/actions/envio-devolucion-central.ts` — ENVÍO satélite `por_devolver →
  devolviendo_a_bodega_central`, autz **adminSatelite de la zona de la orden** (forbidden a otros /
  zona ajena), guarda de estado, historial `ajuste_estado`. Molde de `DevolucionOrigenService`.
- **T2.2** `lib/services/DevolucionOrigenService.ts` (+ `IDevolucionOrigenService.ts` +
  `lib/actions/devolucion-origen.ts`) — REPURPOSE → ENVÍO central `por_devolver_a_tienda →
  devolviendo_a_tienda`; origen cambia `rechazada → por_devolver_a_tienda`; autz pasa de
  bodega-responsable-por-zona a **maestro/admin central directo** (`esAccesoTotal`); se retira la
  dependencia de `ZonaRepository`. **R9: eliminada la salida directa desde `rechazada`** (ahora
  `rechazada` → `conflict` aquí; su única salida es la aprobación del cierre).
- **T2.3 (gate R17) — recepción central 138 STATE-AWARE.** `lib/services/RecepcionBodegaCentralService.ts`
  + `lib/repositories/OrdenRepository.recibirEnBodegaCentral` (+ interfaz `IOrdenRepository`,
  `IRecepcionBodegaCentralService`, `lib/types/recepcion-bodega-central.ts`): UN solo escáner/acción
  resuelve el par ORIGEN→DESTINO por el estado de origen de la orden:
  - `en_ruta_bodega_central → en_bodega_central` (caso 138, `origenTipo: recepcion_bodega_central`).
  - `devolviendo_a_bodega_central → por_devolver_a_tienda` (caso 139, `origenTipo: recepcion_bodega_central`).
  El repo pasó a recibir `origenValue` (guarda del `updateMany`) además de `destinoEstatusId`; el
  service resuelve destino + origenTipo vía un mapa `TRANSICIONES`. Idempotencia por el conjunto de
  destinos "recibida" (`en_bodega_central` / `por_devolver_a_tienda`). Autz maestro/admin, sin zona/tienda.
  El `estado` del `ok` se amplió a `"en_bodega_central" | "por_devolver_a_tienda"`.
- **T2.4** Verificación del tramo final tienda `devolviendo_a_tienda → devuelta_a_tienda`:
  `RecepcionOrigenService` ya opera con los nombres del 137; su test existente
  (`tests/unit/services/recepcion-origen-service.test.ts`) sigue verde sin cambios.
- **T2.5** `lib/services/RecepcionSateliteService.ts` (+ `IRecepcionSateliteService.ts`) —
  `listar` cambia el scope `porDevolver` de `rechazada` a `por_devolver` y añade grupo
  `enTransitoACentral` = `devolviendo_a_bodega_central` de la zona. El repo
  (`findRecepcionSateliteByZona`) ya aceptaba estados arbitrarios: sin cambio, solo los values
  pasados. DTO amplía el result con `enTransitoACentral`.
- **T2.6** Tests unit de todos los servicios del bloque (ver mapa abajo).

## Cómo quedó la generalización STATE-AWARE de la 138 (sin romperla)
- La firma del repo `recibirEnBodegaCentral(ordenId, origenValue, destinoEstatusId, historial)` ganó
  `origenValue`; el service pasa el estado de origen RECIBIDO. El caso 138
  (`en_ruta_bodega_central → en_bodega_central`) se conserva íntegro: sus tests de repo y de service
  fueron ajustados a la nueva firma (insertando el `origenValue` explícito) y **siguen verdes**; se
  añadió cobertura del caso 139 en ambos niveles. `origenTipo` = `recepcion_bodega_central` en AMBOS
  casos (ver desviación abajo). El escáner/acción de la 138 (`recibirEnBodegaCentralPorQr`) es el
  mismo; el widening de `estado` del `ok` es aditivo (no rompe el frontend 138).

## Mapa R → test (parte backend)

| R | Qué | Test |
| --- | --- | --- |
| R1 | catálogo TS + migración idempotente | `tests/unit/types/order-status.test.ts`, `tests/unit/scripts/seed-order-status.test.ts` (+ migración creada; aplicación = deuda) |
| R2 | down.sql catálogo reversible | migración `20260724140000_.../down.sql` (patrón 109; sin test ejecutable sin DB = deuda) |
| R3 | enum `devolucion_rechazada` + down | `tests/unit/types/orden-historial-types.test.ts`, `tests/unit/repositories/orden-historial-cobertura.test.ts` (+ migración; aplicación = deuda) |
| R4 | labels UI | **FRONTEND (Fase 2)** |
| R5 | disparo por aprobación, ruteo por zona | `CierresAdminService.aprobar.devolucion.test.ts`, `CierresAdminRepository.resolverCierre.devolucion.test.ts` |
| R6 | atómico en la MISMA tx `aprobado` | `CierresAdminRepository.resolverCierre.devolucion.test.ts` (bloque dentro del `$transaction`/rama aprobado) |
| R7 | idempotente (guarda estatus_id=rechazada) | `CierresAdminRepository.resolverCierre.devolucion.test.ts` (no-op 0 filas / count=0 conflict / sin config) |
| R8 | money-neutral (no mensajero/prioridad) | `CierresAdminRepository.resolverCierre.devolucion.test.ts` (money-neutral) |
| R9 | retirar salida directa de `rechazada` | `devolucion-origen-service.test.ts` (rechazada → conflict) |
| R10 | `rechazado` no dispara | `CierresAdminRepository.resolverCierre.devolucion.test.ts` (R10), `CierresAdminService.aprobar.devolucion.test.ts` (rechazar no pasa config) |
| R11 | append `devolucion_rechazada` actor=admin | `CierresAdminRepository.resolverCierre.devolucion.test.ts` (R11) |
| R12 | rechazada SLA (mensajero intacto) recogida | `CierresAdminRepository.resolverCierre.devolucion.test.ts` (R12) |
| R13 | envío satélite `por_devolver → devolviendo_a_bodega_central` | `envio-devolucion-central-service.test.ts` |
| R14 | autz adminSatelite de la zona | `envio-devolucion-central-service.test.ts` (autz por zona) |
| R15 | envío central `por_devolver_a_tienda → devolviendo_a_tienda` | `devolucion-origen-service.test.ts` (transición R15) |
| R16 | autz maestro/admin central | `devolucion-origen-service.test.ts` (autz central directa) |
| R17 | recepción central state-aware `devolviendo_a_bodega_central → por_devolver_a_tienda` | `recepcion-bodega-central-service.test.ts` (R17 139), `orden-repository.recepcion-bodega-central.test.ts` (R17 139) |
| R18 | recepción tienda `devolviendo_a_tienda → devuelta_a_tienda` | `recepcion-origen-service.test.ts` (existente, verde; T2.4 verificación) |
| R19 | visibilidad central tabs | **FRONTEND (Fase 2)** |
| R20 | visibilidad tienda tabs | **FRONTEND (Fase 2)** |
| R21 | scope satélite `por_devolver` + `enTransitoACentral` | `recepcion-satelite-service.test.ts` (R21) |
| R22 | guarda de estado anti-TOCTOU | recepción: `orden-repository.recepcion-bodega-central.test.ts` (updateMany guardado por origen); envío (lote): guarda por pre-check del service + `OrdenRepository.update` (id+not-deleted) — ver desviación |
| R23 | append `ajuste_estado` con actor (envíos/recepciones lote) | `envio-devolucion-central-service.test.ts`, `devolucion-origen-service.test.ts`, `orden-historial-cobertura.test.ts` |
| R24 | zod en el borde + trazabilidad | `lib/actions/envio-devolucion-central.ts`/`devolucion-origen.ts` (zod uuid); trazabilidad = este mapa |

## Verificación ejecutable

- **`vitest` dirigido (backend):** `tests/unit` completo → **291 archivos, 3131 tests PASS**.
  Suites clave de la 139: `tests/unit/services/{envio-devolucion-central,devolucion-origen,recepcion-satelite,recepcion-bodega-central,cierres-admin,CierresAdminService.aprobar.devolucion}*`,
  `tests/unit/repositories/{cierres-admin-repository,CierresAdminRepository.resolverCierre.devolucion,orden-repository.recepcion-bodega-central,orden-historial-cobertura}*`,
  `tests/unit/{types,scripts}/*` → todos verdes.
- **`typecheck` (`tsc --noEmit`):** los ÚNICOS errores son los 2 mapas exhaustivos
  `Record<OrderStatusValue,…>` del FRONTEND (`app/(app)/ordenes/_components/EstatusBadge.tsx` y el
  `tests/components/EstatusLabel.test.ts` sobre `estatus-label.ts`), ESPERADOS hasta que el
  frontend cierre R4. El backend de la 139 (lib/**, tests/unit/**) queda type-clean.
- **`lint` (eslint):** limpio en todos los archivos backend creados/modificados.
- **`./init.sh`:** NO se corre (EstatusBadge rojo por diseño hasta el frontend).

## Deuda / notas

- **Migraciones sin aplicar (sin DB real, solo `.env.example`).** Las 2 migraciones quedan CREADAS
  con su `down.sql` y `prisma generate` OK; la aplicación real (`db:migrate`/`db:rollback`) y su
  verificación up/down contra Postgres son **deuda post-merge** (mismo criterio que 137/138).
- **Desviación R22 en los ENVÍOS por lote (R13/R15).** Siguiendo el design §4.1/§4.4 y el molde de
  `DevolucionOrigenService`, los envíos persisten vía `OrdenRepository.update` (UPDATE guardado por
  `id + deleted_at IS NULL`, con el origen PRE-LEÍDO en la misma tx) + pre-check de estado en el
  service; NO re-guardan por `estatus_id = origen` en el WHERE. Es idéntico al comportamiento ya
  mergeado de `DevolucionOrigenService`. Las RECEPCIONES (R17/R18) sí usan `updateMany` guardado por
  estado de origen (anti-TOCTOU completo). Documentado por si el reviewer lo marca.
- **Decisión de gate T2.3 `origenTipo`.** El caso 139 de la recepción central usa
  `origen_tipo = recepcion_bodega_central` (igual que el 138), NO `ajuste_estado` como sugería la
  letra pre-gate de R23. Justificación: el gate F1.4-Q2 decidió REUSAR/generalizar el mecanismo de
  la 138 (que emite `recepcion_bodega_central`), y ambos casos son el MISMO evento físico
  (recepción en la central). No se agrega enum nuevo (se preserva el espíritu de R23: sin nuevos
  valores para las 4 transiciones de lote/recepción). El hint del brief listaba
  `recepcion_bodega_central` como opción primaria.

## Pendiente para FRONTEND (Fase 2)

- **R4 — labels + variantes** de los 3 estados en `EstatusBadge.tsx` / `estatus-label.ts`
  ("Por devolver", "Devolviendo a bodega central", "Por devolver a tienda"). Esto ES lo que hoy
  deja rojo el typecheck (por diseño).
- **R19/R20 — visibilidad** de tabs central/tienda (`app/(app)/ordenes/page.tsx`,
  `OrdenesTabs.tsx`): verificar/ajustar `EXCLUDE_POR_ROL` para que los estados del flujo aparezcan.
- **T3.2** `OrdenesTabs` (central): retirar acción en `rechazada`, añadir lote "Enviar a la tienda"
  en `por_devolver_a_tienda` (reusa `DevolverATiendaModal` relabelado + Server Action `devolverATienda`).
- **T3.3** `RecepcionSateliteModule` (satélite): sección "Por devolver" por lote sobre `por_devolver`
  con botón "Enviar a central" → loop `enviarACentral` (nueva action `lib/actions/envio-devolucion-central.ts`),
  + sección informativa read-only `enTransitoACentral`. Pasar el nuevo grupo por props desde `page.tsx`.
- **T3.5** UI de recepción central 138 (`EscanerRecepcionBodegaCentral`): el escáner ya funciona
  state-aware por backend; conviene refinar el toast del `ok` para nombrar el destino real
  (`por_devolver_a_tienda` vs "recibida en bodega central") — hoy dice "recibida en bodega central".

## Contratos cambiados que el frontend debe absorber
- `RecibirEnBodegaCentralResult.ok.estado`: `"en_bodega_central"` → `"en_bodega_central" | "por_devolver_a_tienda"`.
- `ListarRecepcionSateliteServiceResult.ok`: nuevo campo `enTransitoACentral: RecepcionSateliteDTO[]`;
  `porDevolver` ahora contiene `por_devolver` (antes `rechazada`).
- `DevolucionOrigenService`: constructor de 1 arg (sin `ZonaRepository`); origen `por_devolver_a_tienda`,
  autz maestro/admin. La Server Action `devolverATienda` conserva input `{ ordenId }`.

## Veredicto
Backend (Fase 1) de la 139 completo y verde en vitest dirigido (3131 tests); type-clean salvo los 2
mapas de labels del frontend (esperados); migraciones creadas con down.sql (aplicación = deuda post-merge).
