# Feature 100 — Tasks

> Marca `[P]` = paralelizable con las tareas de su mismo bloque. Cada task lleva su criterio de
> "hecho". Dependencias explícitas. NADA se implementa hasta la aprobación del gate F1.4
> (requirements.md §Preguntas abiertas). Los nombres de `origen_tipo` (`reprogramacion_tienda`,
> `recuperacion_manual`) quedan sujetos a Q1/Q2.

## Bloque 0 — Migración (base de todo)

- **T0.1** Crear `db/migrations/<ts>_orden_historial_origen_tipo_resolver_novedad/migration.sql`
  con `ALTER TYPE ... ADD VALUE IF NOT EXISTS 'reprogramacion_tienda'` y `'recuperacion_manual'`
  (patrón 99). **Hecho:** `pnpm run db:migrate` aplica sin error.
- **T0.2** Escribir `down.sql` que RECREA el enum sin los dos valores (lista los 15 previos), con
  la precondición documentada. **Hecho:** round-trip `db:rollback` → `pending` → `db:migrate` →
  `up-to-date` verificado por SQL directo.
- **T0.3** Añadir ambos valores a `ORDEN_HISTORIAL_ORIGEN_TIPO_SEED` en
  `lib/types/orden-historial.ts` (comentando por qué NO entran en `ORIGEN_TIPOS_CON_GESTION`).
  **Hecho:** `pnpm typecheck` verde (el `satisfies` no rompe) y `_EnsureExhaustive` sigue `true`.

## Bloque 1 — Backend: Reprogramar (tienda) — depende de T0

- **T1.1** `IReprogramacionTiendaService` en `lib/interfaces/services/` (contrato §2.2). **Hecho:**
  compila; usado por el service.
- **T1.2** `GestionOrdenRepository.reprogramarDesdeDevuelta(input)`: UPDATE guardado por
  `estatus_id=devuelta` → `reprogramada`; si `count>0`, crea gestión sintética (mensajero de la
  última `devuelta` vigente, R5) + `appendCambioEstado` (actor=adminTienda,
  origen_tipo=reprogramacion_tienda) en la MISMA tx. Actualiza `IGestionOrdenRepository`. **Hecho:**
  test unit con doble de Prisma: transiciona, crea gestión, count 0 → false, append falla → revierte
  (R2/R3/R5/R11/R20/R21). [P] con T1.3
- **T1.3** `ReprogramacionTiendaService.reprogramar(ordenId, fecha, motivo, actor)`: not_found /
  forbidden (rol+tienda, R6) / conflict (fuera de devuelta, R7) / config_error / ok. **Hecho:** test
  unit con dobles cubre cada rama (R6/R7). [P] con T1.2
- **T1.4** Server Action `lib/actions/resolver-novedad.ts` → `reprogramarNovedad`: zod
  (uuid + fecha futura + motivo opcional, R4/R23), `resolveActorFromSession`, `withErrorHandler`,
  `deps` inyectables (patrón `devolucion-origen.ts`). **Hecho:** test de la action: no-uuid /
  fecha pasada → validation_error; sin sesión → unauthenticated (R22/R23). Depende de T1.1–T1.3.

## Bloque 2 — Backend: Recuperar a bodega — depende de T0 (paralelo a Bloque 1)

- **T2.1** `IRecuperacionBodegaService` en `lib/interfaces/services/` (contrato §3.2). **Hecho:**
  compila. [P] con Bloque 1
- **T2.2** `RecuperacionBodegaRepository.recuperarABodega(input)` (molde de `liberarDevueltaSla`):
  UPDATE guardado por `estatus_id=devuelta` → destino, limpia mensajero+asignado_at, `appendCambioEstado`
  (actor=admin, origen_tipo=recuperacion_manual). Interfaz `IRecuperacionBodegaRepository`. **Hecho:**
  test unit: destino por zona (central/satélite), limpia mensajero, count 0 → false, append falla →
  revierte (R13/R14/R17/R20/R21). [P]
- **T2.3** `RecuperacionBodegaService.recuperar(ordenId, actor)`: not_found / conflict (R16) /
  `esBodegaResponsable` (maestro-admin central; adminSatelite su zona, R15) / config_error / ok.
  Reusa `resolverDestinoCierre` + `findCentralZonaId` + `findUsuarioZonaId`. **Hecho:** test unit con
  matriz rol×zona (maestro central ok, adminSatelite zona propia ok, adminSatelite otra zona
  forbidden, adminTienda forbidden). [P]
- **T2.4** Server Action `recuperarABodega` en `lib/actions/resolver-novedad.ts` (zod uuid). **Hecho:**
  test action: no-uuid → validation_error; sin sesión → unauthenticated (R22/R23). Depende de
  T2.1–T2.3.

## Bloque 3 — UI Reprogramar (adminTienda) — depende de T1.4

- **T3.1** Modal de reprogramación en `/novedades`: `<input type="date">` (default/min
  `mananaCalendarioCR`) + motivo opcional; confirmar → `reprogramarNovedad`. **Hecho:**
  `NovedadesModule.test.tsx`: al confirmar llama la action con la fecha; `ok` → quita la fila
  (R1/R9-front).
- **T3.2** Manejo de estados de respuesta (ok/conflict/forbidden/validation/unauthenticated) →
  toasts (patrón `cambiarPagina`). **Hecho:** test cubre el toast por status.

## Bloque 4 — UI Recuperar (bodega) — depende de T2.4 (paralelo a Bloque 3)

- **T4.1** `adminSatelite`: extender `RecepcionSateliteService.listar` con grupo `devueltas`
  (órdenes `devuelta` de la zona) + `RecepcionSateliteModule` con botón "Recuperar" (patrón
  `porDevolver`/48). **Hecho:** `RecepcionSateliteModule.test.tsx`: lista devueltas de la zona y
  llama `recuperarABodega` (R12). [P]
- **T4.2** maestro/admin: botón "Recuperar" sobre las `devuelta` de la zona central en `/ordenes`
  (patrón `DevolverATiendaModal`/48). **Hecho:** test de componente: confirma y llama la action
  (R12). [P]

## Bloque 5 — Integración, regresión y verificación — depende de 1–4

- **T5.1** Integración con DB de test: reprogramar deja la orden `reprogramada` con fecha futura →
  el cron SLA 99 la salta y el cron de liberación 46 la libera al llegar la fecha (R9). **Hecho:**
  test integración verde.
- **T5.2** Integración: recuperar deja la orden en `en_bodega`/`en_bodega_satelite`, sin mensajero,
  el cron SLA 99 la salta y queda asignable (R18). **Hecho:** test integración verde.
- **T5.3** Regresión money-critical: la gestión sintética `reprogramada` aporta $0.00 al cierre y
  no genera movimiento de wallet (R10). **Hecho:** test que cierra un día con esa gestión y verifica
  totales sin cambio.
- **T5.4** Regresión: `/novedades` sigue siendo solo-`adminTienda` (menu-visibility sin cambios) y
  `contarIntentos` no cambia tras reprogramar (R8). **Hecho:** tests existentes de 87/89/47 verdes.
- **T5.5** Cerrar `progress/impl_100.md` con el mapa R→test COMPLETO (R1–R24) y el round-trip de
  migración. **Hecho:** todos los R con test; `./init.sh` verde; suite completa verde;
  `pnpm typecheck` y `pnpm lint` en 0.

## Notas de secuencia
- Bloques 1 y 2 son independientes entre sí (paralelizables) una vez hecho el Bloque 0.
- Bloques 3 y 4 son independientes entre sí; cada uno depende de su Server Action (T1.4 / T2.4).
- Un commit por task lógica (`feat(100): ...`), no un mega-commit (conventions.md §Commits).
