# Feature 100 — Resolver la novedad (reprogramar / recuperar) — mapa R→test

> Ciclo SDD: spec_author → gate F1.4 (humano, las 5 recomendadas + bonus) → backend_dev (×2:
> backend + grupo `devueltas`/integración) → frontend_dev → reviewer **APROBADO de código**
> (RECHAZADO inicial SOLO por este archivo ausente; sin cambios de código). Orquestada directo por
> el leader (`model:opus`). Rama `feature/100-resolver-novedad`.

## Verificación (medida, independiente: implementer + reviewer + leader)
- `pnpm typecheck` → **0** · `pnpm lint` → **0 err** (143 warn preexistentes)
- `pnpm test` → **4039/4039** (el `no-embalaje` es flaky ambiental, pasa aislado)
- **Round-trip REAL de la migración** `20260721130000_orden_historial_origen_tipo_resolver_novedad`
  contra Postgres local (DB desechable, 0 filas usan los valores nuevos): UP → enum 17 valores →
  `db:rollback` (aplica `down.sql`) → enum **15** valores + migración desregistrada (query a
  `reprogramacion_tienda` falla `22P02`) → `migrate deploy` → 17 valores + `migrate status` up to
  date. Ejecutado por el reviewer.
- `./init.sh` ROJO por deuda AJENA preexistente (`login` sin `specs/login/`), medido idéntico en HEAD
  limpio; los gates sustantivos verdes.

## Gate F1.4 (respetado; verificado por el reviewer, money-neutralidad y authz de forma adversarial)
- **Q1** reprogramar = gestión sintética `resultado=reprogramada` (`origen_tipo=reprogramacion_tienda`,
  `cierre_id=null`, motivo opcional) → reusa intacto el bloqueo/liberación de la 46; NO cuenta como
  intento; **money-neutral** (`ingresoBodegaPorResultado`/`pagoPorResultado`("reprogramada") = "0.00").
- **Q2** recuperar = método hermano de `liberarDevueltaSla`, `actor=admin`,
  `origen_tipo=recuperacion_manual`; limpia `mensajero_asignado_id`+`asignado_at`; ruteo por zona.
- **Q3** authz server-side: reprogramar (adminTienda dueño); recuperar (`esBodegaResponsable`, 48).
- **Q4** reprogramar solo en `/novedades` (sin abrirla a la bodega); recuperar en `/recepcion-satelite`
  y `/ordenes`.
- **Q5** UPDATE guardado por `estatus_id=devuelta`, `if(count>0)` en la misma tx; sin carrera con el
  cron 99. **Bonus:** NO se toca `orden.prioridad` (es la 101).

## Mapa R→test

| R | Requisito | Test |
|---|-----------|------|
| R1 | Reprogramar disponible en /novedades (adminTienda) | `tests/components/NovedadesModule.test.tsx` |
| R2 | Reprograma → transiciona a `reprogramada` | `tests/unit/repositories/gestion-orden-reprogramar.test.ts` |
| R3 | Persiste gestión sintética con `fecha_reprogramacion` en la misma tx | `gestion-orden-reprogramar.test.ts` |
| R4 | Fecha no futura (CR) → `validation_error` | `tests/unit/actions/resolver-novedad.test.ts` |
| R5 | Atribuye `mensajero_id` de la última `devuelta` vigente | `gestion-orden-reprogramar.test.ts` |
| R6 | No adminTienda / no su tienda → `forbidden` | `tests/unit/services/reprogramacion-tienda-service.test.ts` |
| R7 | Ya no en `devuelta` → `conflict` (count 0 → false) | `reprogramacion-tienda-service.test.ts`, `gestion-orden-reprogramar.test.ts` |
| R8 | No incrementa el contador de intentos | `tests/unit/repositories/orden-historial-cobertura.test.ts`, `tests/unit/types/orden-historial-types.test.ts` (fuera de `ORIGEN_TIPOS_CON_GESTION`) |
| R9 | `reprogramada` con fecha futura → cron 99 la salta, cron 46 la libera al llegar la fecha | `tests/integration/db/resolver-novedad-reprograma-sla.test.ts` (T5.1) |
| R10 | Reprogramación money-neutral | `tests/integration/db/resolver-novedad-reprograma-dinero.test.ts` (T5.3) |
| R11 | Historial con `origen_tipo=reprogramacion_tienda` | `gestion-orden-reprogramar.test.ts`, migration test |
| R12 | Recuperar disponible para la bodega responsable (ambas superficies) | `tests/components/RecepcionSateliteModule.test.tsx`, `tests/components/RecuperarABodegaModal.test.tsx`, `tests/unit/services/recepcion-satelite-service.test.ts` (grupo `devueltas`) |
| R13 | Recupera → `en_bodega`/`en_bodega_satelite` por zona | `tests/unit/repositories/recuperacion-bodega-repository.test.ts` |
| R14 | Limpia `mensajero_asignado_id` + `asignado_at` | `recuperacion-bodega-repository.test.ts` |
| R15 | No bodega responsable → `forbidden` (matriz rol×zona) | `tests/unit/services/recuperacion-bodega-service.test.ts` |
| R16 | Ya no en `devuelta` → `conflict` | `recuperacion-bodega-service.test.ts` |
| R17 | Historial con `actor_usuario_id` + `origen_tipo=recuperacion_manual` | `recuperacion-bodega-repository.test.ts` |
| R18 | Queda fuera de `devuelta` → cron 99 la salta, asignable | `tests/integration/db/resolver-novedad-recupera-sla.test.ts` (T5.2) |
| R19 | Recuperación NO enciende `orden.prioridad` | `recuperacion-bodega-repository.test.ts` (`data` keys exactos) |
| R20 | Transición vía choke point `appendCambioEstado` (49) | `recuperacion-bodega-repository.test.ts`, `gestion-orden-reprogramar.test.ts`, `orden-historial-cobertura.test.ts` |
| R21 | UPDATE guardado por `estatus_id=devuelta`, count 0 → no-op | `recuperacion-bodega-repository.test.ts`, `gestion-orden-reprogramar.test.ts` |
| R22 | Actor server-side; sin sesión → `unauthenticated` | `resolver-novedad.test.ts` |
| R23 | zod: `ordenId` uuid + fecha | `resolver-novedad.test.ts` |
| R24 | Sin PII/secretos en logs | `resolver-novedad.test.ts` (sin logging en los archivos nuevos) |

## Deuda menor (reviewer, no bloqueante)
- `RecuperacionBodegaService`: la guarda de estado (`conflict`) corre ANTES de la de authz
  (`forbidden`) — per `design.md §3.1` y precedente de `DevolucionOrigenService` (48); fuga mínima de
  existencia de estado, solo a admins de bodega. Documentado, sin cambio.
