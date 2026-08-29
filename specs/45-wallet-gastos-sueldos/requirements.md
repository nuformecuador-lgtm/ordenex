# Feature 45 — Wallet: gastos fijos/variables y sueldos — requirements.md

> EGRESOS administrativos de la caja principal de Ordenex (feature 42): **gastos
> fijos**, **gastos variables** y **sueldos** de trabajadores. Todos SALEN de la
> caja, se reflejan en el **libro de movimientos** (`wallet_movimiento`) y en el
> **balance general** derivado (ingresos vs. egresos). Money-critical: append-only,
> inmutable, atómico, sin regresión del balance de 42/43/44.
>
> **Decisión del humano (F1.4, 2026-07-13):** los **gastos fijos** se **auto-generan
> por un cron mensual** a partir de **plantillas** que el maestro administra (CRUD);
> **NO** se registran a mano. Los **gastos variables** y los **sueldos** siguen siendo
> **registro manual puntual**. Los **sueldos** son **texto libre** (nombre + periodo en
> la descripción, monto libre; sin FK a `Usuario`). Ver "Decisiones (F1.4)" al final.

## Contexto anclado en el código real (feature 41/42/43/44/46 en `dev`)

- Libro append-only **`wallet_movimiento`** (`db/schema.prisma`, modelo `WalletMovimiento`),
  fila INMUTABLE (sin `updated_at`/`deleted_at`), balance DERIVADO
  (`SUM(ingreso) - SUM(egreso)`, `lib/utils/wallet-balance.ts` + `WalletMovimientoRepository.agregarBalance`).
- Enums nativos ya definidos: `wallet_movimiento_tipo` (`ingreso`|`egreso`),
  `wallet_movimiento_categoria` (incluye `egreso_gasto`, `egreso_sueldo`, `egreso_ajuste`,
  `ingreso_ajuste` — RESERVADAS para 45), `wallet_origen_tipo` (incluye `gasto` — RESERVADO para 45).
- Idempotencia por índice único parcial `wallet_movimiento_origen_categoria_uq`
  `(origen_tipo, origen_id, categoria) WHERE origen_id IS NOT NULL`
  (`db/migrations/20260712160000_wallet_movimiento/migration.sql`).
- Precedente de EGRESO: la 44 inserta `egreso_pago_mensajero` en la caja 42 vía
  `WalletMovimientoRepository.crearMovimientos(tx, ...)` (ver `CierresAdminRepository.resolverCierre`).
- Corrección compensatoria append-only: precedente en la 43 (`ajuste_credito`/`ajuste_debito`)
  y en la 42 (`ingreso_ajuste`/`egreso_ajuste`, `RegistrarMovimientoManualDialog`).
- **Crons reales** (patrón a replicar): `app/api/cron/corte-diario/route.ts` (feature 41) y
  `app/api/cron/liberar-reprogramadas/route.ts` (feature 46). Ambos: Route Handler `GET`,
  auth por `CRON_SECRET` (Bearer) ANTES de cualquier efecto (`loadCronConfig().CORTE_DIARIO_SECRET`,
  `lib/config/cron.ts`), delegan TODA la lógica al service, nunca loguean el secreto ni PII,
  hora CR UTC−6 (`startOfDayCR`, `lib/utils/fecha-cr.ts`), schedule `0 6 * * *` (= 00:00 CR)
  en `vercel.json`.
- UI `/wallet` (`app/(app)/wallet/`, Server Component role-aware `maestro`; módulo cliente
  `WalletModule` con `WalletBalanceCard` + `WalletLedger` + `WalletFiltros` + `RegistrarMovimientoManualDialog`).
- Autorización: `WalletService` usa `ROL_AUTORIZADO = "maestro"`; la página `notFound()` a no-maestro.
- Roles del sistema (`RolValue`): `maestro`, `admin`, `mensajero`, `adminTienda`, `adminSatelite`.
  NO existe un rol/entidad "trabajador/empleado".

## Alcance

DENTRO:
- **Gastos variables** y **sueldos**: registro **manual puntual** (movimiento de egreso en
  `wallet_movimiento`, creado por el maestro desde `/wallet`).
- **Gastos fijos**: **plantillas recurrentes** que el maestro administra (CRUD: crear, editar,
  activar/desactivar, listar) + un **cron mensual** que genera, por cada plantilla ACTIVA, un
  egreso `egreso_gasto_fijo` en la caja, **idempotente por (plantilla, periodo)**.
- Que todos los egresos resten del balance derivado; verlos/filtrarlos en el libro; un desglose
  de egresos administrativos por tipo; corrección por movimiento compensatorio (incluye los
  egresos generados por el cron); autorización solo-maestro; migraciones aditivas con `down.sql`
  (enum + tabla nueva de plantillas).

FUERA DE ALCANCE (follow-up explícito, no se implementa en v1):
- **Catálogo persistente de conceptos** de gasto VARIABLE / sueldo reutilizables (autocompletar).
  Las plantillas de gasto FIJO sí entran (son el mecanismo del cron).
- **FK estructurada a `Usuario`/trabajador** y campo `periodo` estructurado en el sueldo
  (v1 usa nombre + periodo como texto libre en la descripción).
- **Periodicidad configurable** de las plantillas de gasto fijo (día del mes variable, quincenal,
  anual, etc.): v1 es SIEMPRE mensual, generada el día 1 (ver Decisiones F1.4 (b)).
- **Liquidación / conciliación bancaria / reportes contables** (P&L, cierres contables).
- **Edición o borrado** de movimientos de egreso (prohibido por inmutabilidad; solo compensación).
  Las PLANTILLAS sí se editan/desactivan (son configuración, no el libro), pero NO se borran.
- Egresos, CRUD de plantillas o disparo del cron por parte de roles distintos de `maestro`.

## Requisitos (EARS)

### Registro de egresos administrativos (común a manual y cron)

- **R1** — El sistema DEBE registrar cada egreso administrativo (gasto fijo generado por cron,
  gasto variable o sueldo) como una fila NUEVA en `wallet_movimiento` con `tipo = egreso`.

- **R2** — SI el maestro registra manualmente un egreso de *gasto variable*, ENTONCES el sistema
  DEBE persistir `categoria = egreso_gasto_variable`; SI registra un *sueldo*, ENTONCES
  `categoria = egreso_sueldo`. (El `egreso_gasto_fijo` NO se registra a mano: lo emite el cron, R27.)

- **R3** — CUANDO el maestro registra manualmente un egreso administrativo (gasto variable o
  sueldo), el sistema DEBE fijar `origen_tipo = gasto`, `origen_id = NULL` y
  `registrado_por = <id del maestro autenticado>`.

- **R4** — El sistema DEBE aceptar en el registro manual únicamente montos mayores que 0 con hasta 2
  decimales, tratados como STRING en toda la frontera (sin `parseFloat`/`Number`); un monto ≤ 0,
  vacío o no numérico DEBE ser rechazado con error de validación.

- **R5** — El sistema DEBE exigir una descripción no vacía en cada egreso manual (el concepto del
  gasto variable o el nombre del trabajador y periodo del sueldo); una descripción vacía DEBE ser
  rechazada con error de validación.

- **R6** — El sistema DEBE tratar cada egreso administrativo (manual o generado por cron) como una
  fila INMUTABLE: no DEBE exponer ni ejecutar `UPDATE`/`DELETE`/soft-delete sobre movimientos existentes.

- **R7** — CUANDO se registra manualmente un egreso administrativo, el sistema DEBE persistirlo de
  forma atómica (un único `INSERT`); SI el `INSERT` falla, ENTONCES no DEBE quedar ninguna fila
  parcial ni efecto en el balance.

### Balance y libro

- **R8** — El sistema DEBE derivar el balance general como `SUM(ingreso) - SUM(egreso)` (sin saldo
  materializado), de modo que cada egreso administrativo RESTA del balance por su `monto`, exactamente
  una vez (sin doble conteo).

- **R9** — El sistema DEBE preservar el balance de las features 42/43/44: la introducción de las
  categorías `egreso_gasto_fijo`/`egreso_gasto_variable`, de la tabla de plantillas y del cron NO DEBE
  alterar los importes de ingresos ni de egresos ya emitidos por 42/43/44.

- **R10** — El sistema DEBE listar los egresos administrativos (incluidos los generados por el cron)
  en el mismo libro de movimientos de `/wallet`, filtrables por `categoria` (gasto fijo / gasto
  variable / sueldo) con los filtros existentes.

- **R11** — El sistema DEBE mostrar un desglose de egresos administrativos por tipo (total de gastos
  fijos, total de gastos variables, total de sueldos) para el conjunto filtrado (mismos filtros de
  fecha que el libro), derivado por agregación, no almacenado.

- **R12** — El sistema DEBE exponer todo monto de egreso, de plantilla y de balance como STRING con 2
  decimales en la frontera Server Action → cliente; el cliente NUNCA DEBE recibir `Prisma.Decimal` ni
  recalcular montos.

### Corrección (append-only)

- **R13** — CUANDO el maestro solicita reversar un egreso administrativo (manual O generado por el
  cron), el sistema DEBE crear un movimiento compensatorio `tipo = ingreso`, `categoria = ingreso_ajuste`,
  `origen_tipo = gasto`, `origen_id = <id del egreso original>`, con `monto` igual al del egreso original
  (leído server-side, no provisto por el cliente) y una descripción que referencie el egreso original.

- **R14** — El sistema DEBE mantener intacto el egreso original al reversarlo (append-only): la reversa
  es una fila nueva; el egreso original NO DEBE mutarse ni borrarse.

- **R15** — El sistema DEBE impedir la doble compensación: a lo sumo UN movimiento de reversa por egreso
  original (idempotencia); un segundo intento de reversar el mismo egreso DEBE ser un no-op sin crear una
  segunda fila.

- **R16** — SI se reversa un egreso, ENTONCES el efecto neto sobre el balance DEBE ser 0 (el
  `ingreso_ajuste` compensa exactamente el `egreso`).

### Autorización, seguridad y datos

- **R17** — MIENTRAS el actor autenticado no tenga rol `maestro`, el sistema DEBE rechazar (forbidden)
  el registro y la reversa de egresos, así como el CRUD de plantillas de gasto fijo, sin exponer el
  libro, el balance, las plantillas ni ningún monto.

- **R18** — SI no hay sesión válida, ENTONCES el sistema DEBE responder `unauthenticated` y NO DEBE
  ejecutar ninguna operación de egreso ni de plantilla.

- **R19** — El sistema DEBE rechazar en el borde (validación) cualquier tipo de egreso MANUAL fuera del
  conjunto {gasto variable, sueldo}.

- **R20** — El sistema DEBE mantener la RLS de `wallet_movimiento` habilitada sin policies (acceso solo
  por service role, patrón vigente) y DEBE crear la NUEVA tabla de plantillas (`gasto_fijo_plantilla`)
  con RLS habilitada sin policies (mismo patrón); ninguna otra tabla se añade y no se añaden policies.

### Migración

- **R21** — El sistema DEBE extender el enum `wallet_movimiento_categoria` de forma ADITIVA con los
  valores `egreso_gasto_fijo` y `egreso_gasto_variable` (sin alterar filas ni valores existentes),
  acompañado de un `down.sql` que revierta exactamente el cambio (round-trip verificable), con la
  precondición de que ninguna fila use los valores nuevos al revertir.

- **R33** — El sistema DEBE crear la tabla `gasto_fijo_plantilla` mediante una migración ADITIVA (no
  altera tablas existentes) con su `down.sql` que la elimine exactamente (round-trip verificable) y con
  RLS habilitada sin policies.

### Interfaz

- **R22** — CUANDO el maestro abre la sección de egresos administrativos en `/wallet`, el sistema DEBE
  ofrecer: (a) un formulario de egreso manual con selector de tipo {gasto variable, sueldo}, monto y
  descripción; (b) un panel de administración de **plantillas de gasto fijo** (crear, editar, activar/
  desactivar, listar); y (c) una acción de reversa sobre egresos ya registrados (incluidos los del cron).
  El formulario manual NO DEBE ofrecer "gasto fijo" como tipo (lo emite el cron).

- **R23** — CUANDO un egreso, una reversa o un cambio en una plantilla se registra con éxito, el sistema
  DEBE actualizar la vista (libro + balance + desglose + listado de plantillas) para reflejar el cambio
  sin recarga manual.

### Plantillas de gasto fijo (configuración recurrente)

- **R24** — CUANDO el maestro crea una plantilla de gasto fijo, el sistema DEBE persistir `concepto`
  (texto no vacío), `monto` (STRING > 0, hasta 2 decimales) y `activa = true`; un `concepto` vacío o un
  `monto` ≤ 0 / no numérico DEBE ser rechazado con error de validación.

- **R25** — El sistema DEBE permitir al maestro editar `concepto` y `monto` de una plantilla y
  activarla/desactivarla; el sistema NO DEBE borrar plantillas (la desactivación —`activa = false`— es el
  mecanismo para dejar de generar, preservando el historial y los egresos ya emitidos).

  > **⚠️ SUPERSEDED 2026-08-29 por la ficha 332** (`specs/332-eliminar-plantilla-gasto-fijo`).
  > El borrado de plantillas dejó de estar prohibido: decisión humana de esa fecha. Lo que sigue
  > vigente de R25 —editar y activar/desactivar— no cambia; lo que queda revocado es sólo la
  > cláusula «el sistema NO DEBE borrar plantillas».
  >
  > **El texto de arriba se conserva VERBATIM**, como la foto de su momento: este bloque se AÑADE,
  > no lo reescribe. La premisa que lo sostenía —«preservando el historial y los egresos ya
  > emitidos»— resultó no depender de la plantilla: `wallet_movimiento` no declara ninguna FK a
  > `gasto_fijo_plantilla`, la referencia es derivada (`origen_id = '<plantillaId>:<periodo>'`, un
  > texto) y la `descripcion` del movimiento ya lleva el concepto y el periodo, así que la fila del
  > libro se explica sola sin la plantilla. El motivo del cambio: la tabla acumula ruido —
  > configuración vieja que ya no se cobra y que nadie podía sacar de su vista—. Lo que R25 sí
  > acertaba, y la 332 **no** toca, es que el libro es inmutable: el borrado llega hasta la tabla
  > de plantillas y se detiene ahí.

- **R26** — El sistema DEBE listar al maestro las plantillas de gasto fijo (activas e inactivas), con su
  `concepto`, `monto` (STRING) y estado `activa`.

### Generación automática por cron mensual

- **R27** — CUANDO se ejecuta el cron mensual de gastos fijos, el sistema DEBE generar, por CADA plantilla
  ACTIVA, UN movimiento en `wallet_movimiento` con `tipo = egreso`, `categoria = egreso_gasto_fijo`,
  `origen_tipo = gasto`, `monto = <monto de la plantilla>`, `descripcion` que referencie el concepto y el
  periodo, y `registrado_por = NULL` (generación automática). Las plantillas INACTIVAS NO DEBEN generar egreso.

- **R28** — El sistema DEBE ser idempotente por `(plantilla, periodo YYYY-MM)`: reejecutar el cron en el
  mismo periodo NO DEBE duplicar el egreso de una plantilla ya generada en ese periodo (a lo sumo un egreso
  `egreso_gasto_fijo` por plantilla y por mes), ni alterar el balance en la reejecución.

- **R29** — SI el request al endpoint del cron no incluye el `CRON_SECRET` válido (Bearer), o el secreto no
  está configurado, ENTONCES el sistema DEBE responder `401` ANTES de cualquier efecto (no lee plantillas ni
  inserta movimientos) y NUNCA DEBE registrar el secreto ni PII en logs/respuesta.

- **R30** — El sistema DEBE calcular el periodo `YYYY-MM` de generación en la zona horaria de Costa Rica
  (UTC−6), de forma consistente con `corte-diario`/`liberar-reprogramadas`.

- **R31** — El sistema DEBE generar todos los egresos del cron de forma atómica dentro de una misma
  ejecución (todo-o-nada); cada egreso generado DEBE restar del balance derivado exactamente una vez, sin
  doble conteo en reejecuciones.

### Corrección de egresos generados por el cron

- **R32** — SI un egreso de gasto fijo generado por el cron es erróneo, ENTONCES el maestro DEBE poder
  reversarlo por movimiento compensatorio (aplican R13–R16) y DEBE poder DESACTIVAR la plantilla (R25) para
  que no se genere en periodos futuros, sin borrar la plantilla ni el egreso.

## Trazabilidad

Cada `R<n>` se mapea a un test concreto en `tasks.md` (columna "Test"). Un requisito sin test es un fallo
de la feature (regla del reviewer, `docs/verification.md`).

## Decisiones (F1.4) — estado tras la puerta del humano (2026-07-13)

> Las decisiones marcadas **RESUELTA** ya fueron confirmadas por el humano; no re-bloquean. Las
> sub-decisiones del cron se listan como YA RECOMENDADAS (dirección aprobada por el humano).

- **(a) Modelo del egreso.** RESUELTA — REUSAR la tabla polimórfica `wallet_movimiento` (los egresos son
  filas `tipo=egreso`), no una entidad de egreso propia. Reutiliza balance/idempotencia/RLS/UI.

- **(b) Gastos fijos y recurrencia.** RESUELTA — **AUTO-GENERACIÓN POR CRON MENSUAL** (el humano eligió
  el cron sobre el registro manual que recomendaba el spec original). Se introduce una **entidad nueva
  `gasto_fijo_plantilla`** (CRUD del maestro) + un **cron mensual** que emite los egresos. Sub-decisiones
  del cron, YA RECOMENDADAS:
  - **Schedule:** `0 6 1 * *` en `vercel.json` = **día 1, 00:00 CR** (UTC−6 → 06:00 UTC), misma convención
    de hora CR que `corte-diario` (`0 6 * * *`) y `liberar-reprogramadas`.
  - **Periodicidad:** SIEMPRE mensual, día 1 fijo (sin `dia_del_mes` configurable en v1 → mantiene el cron
    mensual simple; el día configurable exigiría un cron DIARIO con filtro, se difiere a follow-up).
  - **Clave de idempotencia:** `origen_id = "<plantillaId>:<periodo YYYY-MM>"` (clave derivada), bajo el
    índice único parcial EXISTENTE `wallet_movimiento_origen_categoria_uq`. No se crea índice nuevo ni se
    toca el existente; no colisiona con la reversa (`ingreso_ajuste`, `origen_id`=uuid) ni con los egresos
    manuales (`origen_id` NULL, fuera del índice).
  - **Endpoint:** `GET /api/cron/generar-gastos-fijos`, auth por el MISMO `CRON_SECRET` (Bearer) antes de
    efectos, clon del patrón 41/46.
  - **Autor de la fila:** `registrado_por = NULL` (automático, como el feed de cierre de la 42).

- **(c) Sueldos.** RESUELTA — **texto libre**: nombre del trabajador + periodo en la `descripcion`, monto
  libre; SIN FK a `Usuario` ni campo `periodo` estructurado (follow-up). No existe entidad/rol "trabajador".

- **(d) Categorización.** RESUELTA — **extender** el enum `wallet_movimiento_categoria` con
  `egreso_gasto_fijo` y `egreso_gasto_variable` (migración aditiva); `egreso_sueldo` YA existe (se reutiliza).
  `egreso_gasto` preexistente queda reservado/sin uso (inofensivo).

- **(e) UI.** RESUELTA — **sección en `/wallet`** (no ruta separada): formulario de egreso manual
  {variable, sueldo} + panel CRUD de plantillas de gasto fijo + reversa por fila en el libro. Reutiliza
  `Modal`/`Select`/`Input`/`WalletLedger`/`WalletFiltros`.

- **(f) Inmutabilidad / corrección.** RESUELTA — **append-only**: la corrección es un movimiento
  compensatorio (`ingreso_ajuste`, `origen_tipo=gasto`, `origen_id`=egreso original), idempotente por el
  índice único parcial existente. Aplica también a egresos generados por el cron. Sin edición ni borrado de
  movimientos. Las plantillas se DESACTIVAN (no se borran).

- **(g) Balance.** RESUELTA — **balance DERIVADO** de la 42 (`SUM(ingreso)-SUM(egreso)`): el egreso resta
  automáticamente, sin doble conteo ni regresión de 42/43/44. Se añade un **desglose de egresos
  administrativos por tipo** (agregación por categoría).

- **(h) Autorización.** RESUELTA — **solo `maestro`** (registro, reversa, CRUD de plantillas). El cron se
  autoriza por `CRON_SECRET`, no por rol.

- **(i) RLS + migración.** RESUELTA — migración ADITIVA de valores de enum (R21) + migración ADITIVA de la
  tabla `gasto_fijo_plantilla` (R33), ambas con `down.sql` de round-trip. RLS de `wallet_movimiento` intacta;
  la tabla nueva con RLS habilitada sin policies.

### Preguntas abiertas

Ninguna bloqueante. Todas las decisiones de F1.4 (incluida la dirección del cron y sus sub-decisiones) están
resueltas/recomendadas arriba. Si el humano quisiera cambiar alguna sub-decisión del cron (p. ej. `dia_del_mes`
configurable o un `periodo` como columna en vez de clave derivada), se re-abre (b) y se ajusta el diseño.
