# Feature 30 — Asignación por zona (GAM) y ruteo a bodega satélite · requirements.md

Zone: `fullstack` · complexity: `high` · depends_on: 24 (`done`), 17 (`done`) · branch: `feature/30-asignacion-zona-ruteo-satelite`

> Estado: `in_progress` (F2.0). La puerta de aprobación **F1.4 fue APROBADA por el humano
> el 2026-07-11**: las 6 decisiones quedaron en la opción recomendada (ver "Decisiones F1.4"
> más abajo). El implementer construye contra esas decisiones cerradas.

Notación EARS. Cada requisito es testeable y mapeable a un test concreto (ver "Tabla de
trazabilidad"). El "actor" se resuelve vía `resolveActorFromSession` → `{ usuarioId, rol }`
(patrón features 6/15/17/25/27). El rol autorizado para ESCRIBIR en este módulo sigue
siendo **exclusivamente `maestro`** (feature 17, decisión 3); `admin` es solo-lectura.

### Contexto de código real (anclas, no inventar)

- `db/schema.prisma`:
  - `Zona.esGam` (`@map("es_gam")`, Boolean default false); índice único parcial
    `zona_es_gam_unico ... WHERE es_gam = true` garantiza **a lo sumo una** zona GAM
    (feature 24, migración `20260711120000_zonas_catalogo_global_pagos`). ⚠️ Hoy **ninguna
    zona está sembrada con `es_gam = true`**: la 24 dejó el flag como toggle de UI
    (`ZonaRepository.setGam`, `create/update` con `esGam`) sin sembrar. Ver R3/R4.
  - `Usuario.zonaId` (`@map("zona_id")`, NULLABLE, FK ON DELETE RESTRICT): solo
    `mensajero`/`adminSatelite` lo llevan (feature 24/R6).
  - `Distrito.zonaId` NULLABLE; `Orden.zonaId` **NOT NULL** (feature 24/R12; la carga
    masiva deriva la zona del distrito).
  - `Orden.mensajeroAsignadoId` (`@map("mensajero_asignado_id")`, feature 17/R7), distinto
    de `mensajeroSugeridoId`; se fija al asignar.
- `lib/types/order-status.ts` — `ORDER_STATUS_SEED` (9 valores hoy) ya incluye
  `en_ruta_bodega_principal` (precedente de naming) y `en_espera_aceptacion`,
  `en_bodega`, `en_fulfillment`, `en_preparacion`. Esta feature AÑADE el 10.º valor
  `en_ruta_bodega_satelite` (patrón features 15/17/28: seed + migración que inserta la
  fila de catálogo `order_status` y `ALTER TYPE order_status_value ADD VALUE`, con su
  `down.sql`).
- Flujo de asignación (feature 17): `lib/services/GuiaAsignacionService.ts`
  (`generarGuia`, `asignarDesdeBodega`), repo `lib/repositories/OrdenRepository.ts`
  (`findByIdsForTransicion`, `findMensajeroIdsValidos`, `findAllMensajeros`,
  `generarGuiaLote`, `asignarBodegaLote`), server actions `lib/actions/ordenes-guia.ts`
  (`generarGuia`, `asignarDesdeBodega`, `listarMensajerosParaAsignacion`), UI del maestro
  `app/(app)/ordenes/_components/{OrdenesRevisionMaestro,GenerarGuiaModal,AsignarBodegaModal,OrdenesApartado}.tsx`.
  El comentario de `listarMensajerosParaAsignacion` YA anticipa esta feature: *"la feature
  30 restringirá el CUERPO de este loader sin cambiar la firma"* (R28 de la 17).

---

## Catálogo: nuevo estado `en_ruta_bodega_satelite`

- **R1** — El sistema DEBE incorporar el valor de estado `en_ruta_bodega_satelite`
  ("en ruta hacia la bodega \<zona\>") como 10.º valor de `ORDER_STATUS_SEED`
  (`lib/types/order-status.ts`) y sembrarlo de forma idempotente vía `seedOrderStatus`
  (upsert por `value`), sin duplicar ni alterar los 9 valores existentes.
- **R2** — El sistema DEBE insertar la fila de catálogo `en_ruta_bodega_satelite` en
  `order_status` mediante una migración Prisma versionada (patrón features 15/17/28:
  `ALTER TYPE "order_status_value" ADD VALUE IF NOT EXISTS ...` +
  `INSERT ... ON CONFLICT ("value") DO NOTHING`) que incluya OBLIGATORIAMENTE su `down.sql`.
  El `down.sql` DEBE eliminar la fila de catálogo SOLO si ninguna orden la referencia
  (patrón `down.sql` de la feature 17) y DEBE documentar que el valor del enum Postgres no
  se elimina (Postgres no soporta `DROP VALUE`). La RLS de `orden`/`order_status` DEBE
  permanecer coherente (sin nuevas policies; acceso solo por service role, patrón 6/15/17).

## Identificación de la zona GAM

- **R3** — El sistema DEBE identificar la zona GAM (bodega central) por el flag booleano
  `zona.esGam = true` como ÚNICA fuente de verdad (no por el nombre "GAM"). DEBE existir
  una consulta que resuelva el `id` de la zona GAM vigente. El índice único parcial de la
  feature 24 garantiza que existe **a lo sumo una** zona con `esGam = true`.
- **R4** — MIENTRAS NO exista ninguna zona con `esGam = true`, el sistema DEBE rechazar
  toda operación de escritura de este módulo (generar guía, asignar mensajero, rutear a
  satélite) con un `validation_error` explícito ("zona GAM no configurada"), SIN efectos en
  datos y SIN rutear silenciosamente todo a satélite. (Reconciliación del hecho de que hoy
  ninguna zona está sembrada como GAM; ver Preguntas abiertas (a).)

## Filtrado de mensajeros por zona GAM

- **R5** — CUANDO el maestro abre la selección de mensajero (loader
  `listarMensajerosParaAsignacion`), el sistema DEBE listar ÚNICAMENTE los usuarios con rol
  `mensajero` cuya `usuario.zonaId` sea la zona GAM (`esGam = true`). Un mensajero de otra
  zona, o sin zona asignada (`zonaId = NULL`), NO DEBE aparecer.
- **R6** — CUANDO se asigna un mensajero (sugerido confirmado, override o desde bodega), el
  `mensajeroId` recibido DEBE corresponder a un usuario existente con rol `mensajero` Y con
  `zonaId` = zona GAM; SI no cumple ambas, ENTONCES el sistema DEBE responder
  `validation_error` sin aplicar la transición de esa orden. (Refuerza el filtro de R5 en
  el backend: la lista visible ya es GAM, pero el service revalida — defensa en profundidad.)
- **R7** — La restricción de mensajeros-GAM (R5/R6) DEBE aplicar por igual al override por
  orden del `GenerarGuiaModal` (feature 17/R22) y a la asignación desde `en_bodega`
  (`AsignarBodegaModal`, feature 17/R26). (Ver Preguntas abiertas (e).)

## Ruteo de órdenes NO-GAM a bodega satélite

- **R8** — SI una orden tiene `zonaId` distinto de la zona GAM, ENTONCES el sistema DEBE
  RECHAZAR cualquier intento de asignarle un `mensajero_asignado_id` (`validation_error` o
  `conflict` por orden, sin efectos): el maestro NO puede asignar mensajero a una orden
  no-GAM.
- **R9** — CUANDO el maestro procesa una orden no-GAM, la ÚNICA transición permitida DEBE
  ser el ruteo a la bodega satélite de su zona: el sistema DEBE fijar el estado a
  `en_ruta_bodega_satelite` y dejar `mensajero_asignado_id = NULL`.
- **R10** — CUANDO una orden no-GAM se rutea a `en_ruta_bodega_satelite`, el sistema DEBE
  asignarle `num_guia` si aún es `NULL` (misma regla que feature 17/R19; la guía debe
  existir para que la etiqueta con QR de la feature 32 permita la recepción por escaneo en
  satélite, feature 33), reutilizando la secuencia `orden_num_guia_seq` de forma idempotente
  (`WHERE num_guia IS NULL`, feature 17/R5). (Ver Preguntas abiertas (f).)
- **R11** — CUANDO el maestro pulsa "Generar guía" sobre un lote que mezcla órdenes GAM y
  no-GAM, el sistema DEBE resolver cada orden según su zona en UNA SOLA operación
  transaccional: las GAM siguen las reglas de la feature 17 (a mensajero GAM →
  `en_espera_aceptacion`, o sin mensajero → `en_bodega`) y las no-GAM se rutean a
  `en_ruta_bodega_satelite` (R9/R10). O se aplican todas o ninguna (feature 17/R25).
- **R12** — CUANDO el maestro intenta asignar un mensajero a una o varias órdenes desde
  `en_bodega` (`asignarDesdeBodega`), el sistema DEBE rechazar (sin efectos) cualquier orden
  del lote cuya zona NO sea GAM. (Defensa: por construcción `en_bodega` solo contiene
  órdenes GAM, pero el service lo valida.)
- **R13** — El sistema DEBE ofrecer una operación de "rutear a bodega satélite" que tome una
  o varias órdenes no-GAM seleccionadas y las pase a `en_ruta_bodega_satelite` (aplicando
  R9/R10), desde los estados de origen permitidos. (El conjunto exacto de estados de origen
  es Pregunta abierta (d); recomendación: `en_fulfillment`, `en_preparacion` y `en_bodega`.)

## Display del nombre de zona

- **R14** — El listado de órdenes del maestro DEBE mostrar el nombre de la zona derivado de
  `orden.zonaId` en cada fila (columna de zona), SIN romper el contrato del listado del CRUD
  (features 6/7): agregar el nombre de zona es aditivo (`zonaNombre` en el DTO del listado).
- **R15** — MIENTRAS una orden esté en `en_ruta_bodega_satelite`, el sistema DEBE mostrar su
  estado de forma legible como "en ruta hacia la bodega \<zona\>", derivando el nombre de la
  zona de `orden.zonaId` (un solo estado con nombre de zona derivado para el display; ver
  Preguntas abiertas (b)).

## Autorización, transaccionalidad y guardias (heredadas de feature 17)

- **R16** — MIENTRAS el actor tenga rol `maestro`, el sistema DEBE permitirle las
  operaciones de escritura (generar guía, asignar mensajero, rutear a satélite). CUANDO el
  actor sea `admin`, el sistema DEBE dar acceso de SOLO-LECTURA y rechazar (`forbidden`)
  cualquier escritura. CUANDO sea cualquier otro rol, `forbidden`. CUANDO no haya actor
  autenticado, `unauthenticated` antes de tocar el service o los datos.
- **R17** — El sistema DEBE validar el estado de ORIGEN de cada transición (guardia por
  estado) y rechazar (`conflict`/`validation_error`, sin efectos) transiciones inválidas o
  sobre órdenes inexistentes/borradas (`deleted_at`), sin dejar la transacción a medias
  (feature 17/R25/R27/R29).

## No-regresión y trazabilidad

- **R18** — El camino GAM de la feature 17 (asignar mensajero GAM → `en_espera_aceptacion`;
  sin mensajero → `en_bodega`; num_guia; idempotencia) DEBE conservarse idéntico para las
  órdenes GAM. Las FIRMAS de las server actions `generarGuia`, `asignarDesdeBodega` y
  `listarMensajerosParaAsignacion` DEBEN permanecer estables (el CUERPO cambia, no el
  contrato; feature 17/R28).
- **R19** — La adición del nombre de zona al listado (R14) NO DEBE romper la lectura/
  serialización de órdenes existentes (features 6/7): los consumidores del DTO del listado
  DEBEN seguir compilando y funcionando (barrido de tipos aditivo).
- **R20** — El sistema DEBE modelar el ruteo con UN solo estado `en_ruta_bodega_satelite`
  (nombre de zona derivado para display, R15), NO con un estado dinámico por zona (decisión
  recomendada; ver Preguntas abiertas (b)).
- **R21** — El sistema DEBE introducir todos los cambios de esquema/catálogo de esta feature
  mediante migración(es) Prisma versionada(s) con `down.sql` reversible, y `pnpm db:rollback`
  DEBE funcionar (CHECKPOINTS: migraciones reversibles).
- **R22** — Cada requisito (`R1`–`R21`) DEBE quedar mapeado a al menos un test concreto
  (tabla de trazabilidad; el `implementer` la completa con rutas en
  `progress/impl_30-asignacion-zona-ruteo-satelite.md`).

---

## Tabla de trazabilidad (requisito → test previsto)

| Req | Test previsto (nivel) |
| --- | --- |
| R1  | unit: `ORDER_STATUS_SEED` incluye `en_ruta_bodega_satelite`; `seedOrderStatus` idempotente |
| R2  | integration/db + script: migración inserta fila; enum contiene el valor; down condicional; `db:rollback` |
| R3  | unit/integration repo: resuelve el `id` de la zona con `esGam = true`; null si no hay |
| R4  | unit service: sin zona GAM → `validation_error` "zona GAM no configurada", sin efectos |
| R5  | unit/integration repo + action: loader devuelve solo mensajeros con `zonaId` = GAM; excluye otras zonas y `zonaId = NULL` |
| R6  | unit service: `mensajeroId` sin rol `mensajero` o de zona ≠ GAM → `validation_error`, sin transición |
| R7  | unit service + component: override en GenerarGuía y asignación en_bodega usan la lista GAM |
| R8  | unit service: orden no-GAM + `mensajeroId` != null → rechazo por orden, sin efectos |
| R9  | unit service: orden no-GAM procesada → estado `en_ruta_bodega_satelite`, `mensajero_asignado_id = NULL` |
| R10 | unit/integration: orden no-GAM ruteada recibe `num_guia` si era NULL; idempotente si ya lo tenía |
| R11 | integration service: lote mixto GAM/no-GAM → GAM por regla 17, no-GAM a satélite, una sola transacción todo-o-nada |
| R12 | unit service: `asignarDesdeBodega` con orden no-GAM en el lote → rechazo sin efectos |
| R13 | unit service + action: rutear a satélite N órdenes no-GAM desde origen permitido → `en_ruta_bodega_satelite` |
| R14 | integration repo + component: listado incluye `zonaNombre`; columna de zona visible |
| R15 | component: estado `en_ruta_bodega_satelite` renderiza "en ruta hacia la bodega \<zona\>" |
| R16 | unit service/action: maestro escribe; admin solo-lectura → forbidden; otro → forbidden; sin sesión → unauthenticated |
| R17 | integration service: origen inválido / orden borrada en el lote → rechazo, sin transacción a medias |
| R18 | unit/integration: tests GAM de la feature 17 siguen verdes; firmas de actions estables |
| R19 | unit/type: DTO del listado con `zonaNombre` no rompe consumidores del CRUD (6/7) |
| R20 | integration/db: un único valor `en_ruta_bodega_satelite`; display deriva la zona |
| R21 | script/CI: `db:migrate` up + `db:rollback` down verdes |
| R22 | revisión: todos los R con test asociado (reviewer) |

---

## Límites (fuera de alcance de esta feature)

- **Recepción por QR en la bodega satélite → feature 33.** Aquí la orden solo llega a
  `en_ruta_bodega_satelite`; la transición a `en_bodega_satelite` por escaneo del QR
  (feature 32) es de la feature 33.
- **Módulo del mensajero ("Mis asignaciones", aceptación, gestión) → feature 36.**
- **Asignación desde la bodega satélite a mensajeros de su zona → feature 34.**
- **Pagos por zona en el cierre → feature 39.** El flag/pagos de zona ya existen (feature
  24) pero su uso en cierres no es de esta feature.
- **Etiqueta con QR/código de barras → feature 32.** Aquí solo se garantiza que la orden
  ruteada tenga `num_guia` (R10) para que esa etiqueta pueda existir.

---

## Decisiones F1.4 (APROBADAS por el humano 2026-07-11)

Las 6 preguntas se resolvieron en la opción **recomendada**:
- **(a)** Identificación GAM = flag `zona.esGam` como fuente de verdad + **guardia R4** (rechazo
  explícito si no hay zona GAM marcada). NO se siembra zona GAM por migración; el maestro la
  marca desde configuración (feature 24, `setGam`).
- **(b)** UN solo estado nuevo `en_ruta_bodega_satelite`; el nombre de bodega/zona se deriva de
  `orden.zonaId` para el display.
- **(c)** El ruteo es SOLO transición de estado + `orden.zonaId` (sin FK explícita a
  bodega/adminSatelite; la feature 33 filtra por zona en recepción).
- **(d)** Orígenes de ruteo a satélite: `en_fulfillment`, `en_preparacion` y `en_bodega`.
- **(e)** SÍ: la restricción mensajeros-GAM aplica también al override por orden del
  `GenerarGuiaModal` (feature 17); el service revalida (R6/R7).
- **(f)** SÍ: la orden ruteada a satélite recibe `num_guia` en el momento del ruteo (R10).

## Preguntas abiertas para F1.4 (registro histórico — RESUELTAS arriba)

**(a) Identificación de la zona GAM y garantía de que exista exactamente una.**
- *Recomendación:* usar el flag `zona.esGam` como fuente de verdad (R3); el índice único
  parcial de la feature 24 ya impide más de una. Para el "exactamente una", NO sembrar por
  migración sino EXIGIR que el maestro marque una zona GAM desde configuración (feature 24,
  `setGam`) y proteger el flujo con el guardia R4 (rechazo explícito si no hay GAM).
- *Alternativas:* (i) identificar por nombre "GAM" (frágil ante renombres/tildes; descartada
  en design.md); (ii) **sembrar** una zona GAM por migración/seed (garantiza que exista pero
  fija un nombre/geografía de arranque que quizá no corresponda al catálogo real de CR).
- *Decisión pendiente:* ¿guardia R4 (recomendado) o seed obligatorio de una zona GAM?

**(b) Modelado del estado de ruteo.**
- *Recomendación:* UN solo estado `en_ruta_bodega_satelite` con el nombre de zona derivado
  de `orden.zonaId` para el display (R15/R20; precedente `en_ruta_bodega_principal`).
- *Alternativa:* un estado dinámico por zona (p. ej. `en_ruta_bodega_limon`): multiplica el
  catálogo, complica el seed y las guardias por estado. Descartada en design.md.

**(c) Rol/destino que recibe el ruteo.**
- *Contexto:* la orden ruteada debe aparecer en "Mis asignaciones" del `adminSatelite` de esa
  zona (feature 33). Esta feature SOLO realiza la transición de estado; NO construye la vista
  del `adminSatelite` ni valida su pertenencia de zona en recepción.
- *Pregunta:* ¿basta con la transición de estado + `orden.zonaId` (recomendado, la feature 33
  filtra por zona del adminSatelite), o esta feature debe fijar además algún vínculo explícito
  a la bodega/adminSatelite destino?

**(d) Estados de origen desde los que el maestro puede rutear a satélite.**
- *Recomendación:* `en_fulfillment`, `en_preparacion` (integrado en "Generar guía") y también
  `en_bodega` (para órdenes no-GAM que hubieran quedado ahí antes de esta feature).
- *Alternativa:* limitar a los estados de revisión (`en_fulfillment`/`en_preparacion`) y no
  permitir rutear desde `en_bodega`.

**(e) ¿La restricción de mensajeros-GAM aplica también al override por orden del GenerarGuiaModal (feature 17)?**
- *Recomendación:* SÍ (R7). El select de override consume el mismo loader, ya filtrado a GAM;
  además el service revalida (R6). Sin esto, el maestro podría intentar asignar un mensajero
  no-GAM por override.

**(f) ¿La orden ruteada a satélite recibe `num_guia` en el momento del ruteo?**
- *Recomendación:* SÍ (R10), coherente con feature 17/R19 y necesario para la etiqueta con QR
  (feature 32) que la bodega satélite escanea para recibir (feature 33).
- *Alternativa:* diferir `num_guia` hasta la asignación a mensajero en la satélite (feature
  34); rompería el flujo de recepción por QR de la feature 33.
