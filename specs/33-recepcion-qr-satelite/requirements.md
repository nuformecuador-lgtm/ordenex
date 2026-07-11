# Feature 33 — Bodega satélite: "Mis asignaciones" y recepción por QR · requirements.md

Zone: `fullstack` · complexity: `high` · depends_on: 30 (`done`), 32 (`done`) · branch: `feature/33-recepcion-qr-satelite`

> Estado: `spec_ready` pendiente de la puerta de aprobación humana **F1.4**. Las decisiones
> abiertas están al final ("Preguntas abiertas para F1.4") con recomendación + alternativas;
> el implementer NO construye hasta que el humano las cierre. Los requisitos R1–R23 están
> redactados sobre la **opción recomendada** de cada pregunta (patrón feature 30).

Notación EARS. Cada requisito es testeable y mapeable a un test concreto (ver "Tabla de
trazabilidad"). El "actor" se resuelve vía `resolveActorFromSession` → `{ usuarioId, rol }`
(patrón features 6/15/17/30/36). El rol autorizado en este módulo es **exclusivamente
`adminSatelite`**, y SIEMPRE acotado a las órdenes de **su** zona (`usuario.zonaId`).

### Contexto de código real (anclas, no inventar)

- `lib/types/order-status.ts` — `ORDER_STATUS_SEED` (12 valores hoy). Incluye
  `en_ruta_bodega_satelite` (feature 30, 10.º valor) — el estado del que parte esta feature.
  Esta feature AÑADE el **13.º valor** `en_bodega_satelite` (patrón features 15/17/28/30: seed
  idempotente `seedOrderStatus` + migración `ALTER TYPE "order_status_value" ADD VALUE IF NOT
  EXISTS ...` + `INSERT ... ON CONFLICT ("value") DO NOTHING`, con su `down.sql`).
- `db/schema.prisma`:
  - `Orden.zonaId` **NOT NULL** (feature 24/R12): al rutear a satélite (feature 30) queda con
    la zona destino. Es la clave de alcance de este módulo.
  - `Usuario.zonaId` (`@map("zona_id")`, NULLABLE): solo `mensajero`/`adminSatelite` lo llevan
    (feature 24/R6). El `adminSatelite` está atado a una zona.
  - `Orden.mensajeroAsignadoId` — NULL mientras la orden está en satélite (feature 30/R9). Esta
    feature NO lo toca (la asignación a mensajero de la satélite es la feature 34).
- **QR = `orden.id`** (decisión F1.4 de la feature 32; ver `EtiquetaGuiaService.toEtiquetaDTO`,
  `qrValue: row.id`). La etiqueta imprimible codifica `orden.id` en el QR justamente para que
  la recepción de esta feature escanee y haga *lookup* por PK. El código de barras codifica
  `num_guia` y NO se usa aquí.
- Flujo de transición de estado (precedentes): `lib/services/GuiaAsignacionService.ts` +
  `lib/repositories/OrdenRepository.ts` (`findByIdsForTransicion`, `findEstatusIdByValue`,
  `rutearBodegaSateliteLote`) + `lib/actions/ordenes-guia.ts` (guardias por estado de origen,
  `conflict` sin efectos). `OrdenRepository.findUsuarioFulfillment` es el precedente exacto de
  resolver un dato del `usuario` autenticado por `usuarioId` (aquí: su `zonaId`).
- Módulo por-rol precedente (feature 36): `app/(app)/mis-asignaciones/page.tsx` valida el rol
  server-side vía `resolveActorFromSession` → `notFound` si no corresponde; `MisAsignacionesService`
  (rechaza `forbidden` si el rol no coincide); Server Actions + `router.refresh()`; datos
  sensibles por props. UI reusable: `components/shared/{Modal,PageHeader}`, `hooks/useToast`,
  DataTable/Pagination (features 7/8), manejador de errores global (`withErrorHandler`, feature 10).

---

## Catálogo: nuevo estado `en_bodega_satelite`

- **R1** — El sistema DEBE incorporar el valor de estado `en_bodega_satelite`
  ("en bodega satélite de \<zona\>") como 13.º valor de `ORDER_STATUS_SEED`
  (`lib/types/order-status.ts`) y sembrarlo de forma idempotente vía `seedOrderStatus`
  (upsert por `value`), sin duplicar ni alterar los 12 valores existentes.
- **R2** — El sistema DEBE insertar la fila de catálogo `en_bodega_satelite` en `order_status`
  mediante una migración Prisma versionada (patrón features 15/17/28/30:
  `ALTER TYPE "order_status_value" ADD VALUE IF NOT EXISTS 'en_bodega_satelite'` +
  `INSERT ... ON CONFLICT ("value") DO NOTHING`) que incluya OBLIGATORIAMENTE su `down.sql`.
  El `down.sql` DEBE eliminar la fila de catálogo SOLO si ninguna orden la referencia
  (patrón `down.sql` feature 30) y DEBE documentar que el valor del enum Postgres no se
  elimina (Postgres no soporta `DROP VALUE`). La RLS de `orden`/`order_status` DEBE permanecer
  coherente (sin nuevas policies; acceso solo por service role, patrón 6/15/17/30). Esta feature
  NO agrega tablas ni columnas: no hay superficie RLS nueva.

## Alcance por rol y por zona del adminSatelite

- **R3** — El módulo "Mis asignaciones" de la bodega satélite DEBE ser accesible ÚNICAMENTE por
  un actor con rol `adminSatelite`. CUANDO el actor tenga cualquier otro rol, el sistema DEBE
  responder de forma que NO exponga el módulo (`notFound` en la página, patrón feature 36;
  `forbidden` en el service). CUANDO no haya actor autenticado, el sistema DEBE responder
  `unauthenticated` antes de tocar el service o los datos.
- **R4** — El alcance de datos del módulo DEBE derivarse de `usuario.zonaId` del `adminSatelite`
  autenticado (resuelto server-side por `usuarioId`, patrón `findUsuarioFulfillment`), NO de un
  parámetro del cliente. El `adminSatelite` NUNCA DEBE ver ni recibir órdenes de una zona distinta
  de la suya.
- **R5** — SI el `adminSatelite` autenticado tiene `zonaId = NULL` (sin zona asignada), ENTONCES
  el sistema DEBE mostrar el módulo vacío con un aviso accionable ("no tienes una zona asignada")
  y DEBE rechazar toda recepción (`sin_zona`), SIN efectos en datos.

## "Mis asignaciones": listado

- **R6** — El módulo DEBE listar, en una sección SEPARADA "Por recibir", las órdenes cuyo estado
  sea `en_ruta_bodega_satelite` y cuyo `orden.zonaId` sea la zona del `adminSatelite`
  autenticado, excluyendo órdenes borradas (`deleted_at`).
- **R7** — MIENTRAS una orden esté en la sección "Por recibir", el sistema NO DEBE ofrecer ninguna
  acción de asignación a mensajero ni de gestión sobre ella (la asignación desde la satélite es la
  feature 34): la única acción disponible en este módulo es la recepción por escaneo.
- **R8** — El módulo DEBE mostrar, en una sección SEPARADA "Recibidas", las órdenes en estado
  `en_bodega_satelite` de la zona del `adminSatelite` (base de la feature 34), diferenciadas
  visualmente de "Por recibir". (Ver Pregunta abierta (f).)
- **R9** — MIENTRAS una orden esté en `en_bodega_satelite`, el sistema DEBE mostrar su estado de
  forma legible como "en bodega satélite de \<zona\>", derivando el nombre de la zona de
  `orden.zonaId` (un solo estado con nombre de zona derivado para el display, mismo criterio que
  feature 30/R15/R20; ver Pregunta abierta (b)).

## Recepción por escaneo de QR

- **R10** — El sistema DEBE ofrecer un mecanismo de recepción que reciba el contenido escaneado de
  un QR como **texto** (el valor codificado es `orden.id`, feature 32) y dispare la recepción de
  UNA orden por escaneo (1-a-1), con feedback por ítem (éxito o motivo de rechazo). El mecanismo de
  entrada recomendado es un lector físico tipo teclado (keyboard-wedge) que "teclea" el contenido en
  un input; la recepción NO DEBE depender de acceso a cámara. (Ver Pregunta abierta (a).)
- **R11** — CUANDO se recibe un `orden.id` cuya orden está en `en_ruta_bodega_satelite` y cuyo
  `orden.zonaId` es la zona del `adminSatelite`, ENTONCES el sistema DEBE transicionar esa orden a
  `en_bodega_satelite` (fijando `estatus_id`) y confirmar la recepción de ese ítem. NO DEBE tocar
  `mensajero_asignado_id` ni `num_guia`.
- **R12** — SI el `orden.id` recibido corresponde a una orden cuyo `orden.zonaId` NO es la zona del
  `adminSatelite`, ENTONCES el sistema DEBE rechazar la recepción con un motivo claro (`zona_ajena`,
  "esta orden pertenece a otra zona"), SIN efectos en datos.
- **R13** — SI el `orden.id` recibido corresponde a una orden que NO está en
  `en_ruta_bodega_satelite` (estado de origen incorrecto, p. ej. `en_fulfillment`), ENTONCES el
  sistema DEBE rechazar la recepción con un motivo claro (`estado_invalido`, indicando el estado
  actual), SIN efectos en datos.
- **R14** — SI el `orden.id` recibido corresponde a una orden que YA está en `en_bodega_satelite`
  (de la propia zona), ENTONCES el sistema NO DEBE producir error ni efectos: DEBE responder de forma
  idempotente con un mensaje "ya recibida". (Reescanear un paquete ya recibido no rompe el flujo.)
- **R15** — SI el `orden.id` recibido no corresponde a ninguna orden, o corresponde a una orden
  borrada (`deleted_at`), ENTONCES el sistema DEBE rechazar la recepción con un motivo claro
  (`no_encontrada`), SIN efectos en datos.
- **R16** — SI el valor escaneado no tiene el formato de un `orden.id` válido (QR ilegible, cadena
  vacía o que no valida el schema del identificador), ENTONCES el sistema DEBE rechazar la entrada en
  el borde (`validation_error`, "código inválido") ANTES de invocar el service, SIN tocar datos.

## Autorización, transaccionalidad y guardias (backend)

- **R17** — El service de recepción DEBE revalidar el rol `adminSatelite` (defensa en profundidad
  sobre R3) y responder `forbidden` si no coincide, ANTES de tocar datos.
- **R18** — La recepción de una orden DEBE ser una transición atómica y concurrencia-segura: el
  sistema DEBE aplicar el cambio de estado SOLO si la orden sigue en `en_ruta_bodega_satelite`, no
  está borrada y su `orden.zonaId` es la zona del actor (guardia por estado de origen + zona en la
  propia escritura, patrón feature 17/36); un doble escaneo simultáneo NO DEBE producir doble efecto
  (R14 idempotente).

## No-regresión y verificabilidad

- **R19** — Esta feature NO DEBE modificar el ruteo del maestro (feature 30) ni los estados/flujos
  existentes: `en_ruta_bodega_satelite` sigue siendo escrito por la feature 30 y `en_bodega_satelite`
  es un destino nuevo consumido solo aquí. Las firmas y contratos de las features 30/32/36 DEBEN
  permanecer estables (cambios aditivos).
- **R20** — El sistema DEBE modelar la recepción con UN solo estado `en_bodega_satelite` (nombre de
  zona derivado para display, R9), NO con un estado por zona (decisión recomendada; ver Pregunta
  abierta (b)).
- **R21** — El sistema DEBE introducir el cambio de catálogo mediante migración Prisma versionada con
  `down.sql` reversible, y `pnpm db:rollback` DEBE funcionar (CHECKPOINTS: migraciones reversibles).
- **R22** — La lógica de recepción (transición dado un `orden.id`) DEBE ser testeable a nivel de
  **service** (con dobles de repo, sin DB ni HTTP) y a nivel de **Server Action** recibiendo el
  identificador escaneado como **texto**. El hardware de escaneo (lector keyboard-wedge) NO es
  unit-testeable: su integración (el lector "teclea" en el input y dispara la acción) DEBE quedar
  declarada como verificación **manual**; se evalúa un E2E (Playwright) que simule la entrada de
  texto en el input de escaneo para cubrir el flujo crítico de recepción (ver Pregunta abierta (g)).
- **R23** — Cada requisito (`R1`–`R22`) DEBE quedar mapeado a al menos un test concreto (tabla de
  trazabilidad; el `implementer` la completa con rutas en
  `progress/impl_33-recepcion-qr-satelite.md`).

---

## Tabla de trazabilidad (requisito → test previsto)

| Req | Test previsto (nivel) |
| --- | --- |
| R1  | unit: `ORDER_STATUS_SEED` incluye `en_bodega_satelite`; `seedOrderStatus` idempotente |
| R2  | integration/db + script: migración inserta fila; enum contiene el valor; down condicional |
| R3  | unit service/action + page: adminSatelite pasa; otro rol → forbidden/notFound; sin sesión → unauthenticated |
| R4  | unit/integration repo+service: alcance por `usuario.zonaId` resuelto server-side; no ve otra zona |
| R5  | unit service: adminSatelite con `zonaId = NULL` → listado vacío + `sin_zona` en recepción |
| R6  | integration repo+service: "Por recibir" = `en_ruta_bodega_satelite` de la zona, sin borradas |
| R7  | component: la tarjeta "Por recibir" no expone acción de asignar/gestionar |
| R8  | integration repo+service + component: "Recibidas" = `en_bodega_satelite` de la zona, sección aparte |
| R9  | component: estado `en_bodega_satelite` renderiza "en bodega satélite de \<zona\>" |
| R10 | unit action + component: la acción recibe texto (orden.id) y transiciona 1 orden por escaneo con feedback |
| R11 | unit service: orden en `en_ruta_bodega_satelite` de la zona → pasa a `en_bodega_satelite`; sin tocar mensajero/num_guia |
| R12 | unit service: orden de otra zona → `zona_ajena`, sin efectos |
| R13 | unit service: orden en estado != `en_ruta_bodega_satelite` → `estado_invalido`, sin efectos |
| R14 | unit service: orden ya en `en_bodega_satelite` → `ya_recibida`, idempotente, sin efectos |
| R15 | unit service: orden inexistente/borrada → `no_encontrada`, sin efectos |
| R16 | unit action: valor no-`orden.id` (vacío/ilegible) → `validation_error`, sin tocar service |
| R17 | unit service: rol != adminSatelite → forbidden antes de tocar datos |
| R18 | integration service/repo: update guardado por estado+zona; doble escaneo concurrente sin doble efecto |
| R19 | unit/type: contratos features 30/32/36 estables; ruteo del maestro intacto |
| R20 | integration/db: un único valor `en_bodega_satelite`; display deriva la zona |
| R21 | script/CI: `db:migrate` up + `db:rollback` down verdes |
| R22 | unit service + action (texto) verdes; E2E de recepción por input de texto (si aplica); nota de verificación manual del lector |
| R23 | revisión: todos los R con test asociado (reviewer) |

---

## Límites (fuera de alcance de esta feature)

- **Asignación desde la bodega satélite a mensajeros de su zona → feature 34.** Aquí la orden solo
  llega a `en_bodega_satelite`; parte de ahí la feature 34.
- **Ruteo del maestro a satélite → feature 30.** No se toca.
- **Etiqueta con QR/código de barras → feature 32.** Aquí solo se **consume** el QR (`orden.id`).
- **Tiempo real → feature 35. Trazabilidad → feature 49.** No aplican.

---

## Preguntas abiertas para F1.4 (recomendación + alternativas — el humano decide)

**(a) Mecanismo de escaneo.**
- *Recomendación:* lector físico de QR **tipo teclado (keyboard-wedge)** como base — el lector
  "teclea" el contenido del QR (`orden.id`) en un input enfocado y dispara la recepción al recibir el
  terminador (Enter). Robusto, barato, sin permisos de cámara, sin dependencia nueva; encaja con Next
  App Router como Client Component simple. La entrada es solo texto → testeable a nivel de action/E2E.
- *Alternativa:* escaneo por **cámara web** (`getUserMedia` + librería de decodificación QR, p. ej.
  `@zxing/browser` — dependencia nueva). Aporta movilidad pero añade permisos de cámara, superficie de
  fallo y peso. *Recomendación:* diferir la cámara (a esta feature o a una posterior) y entregar el
  keyboard-wedge como base. ¿Se difiere la cámara o se incluye como extra opcional?

**(b) Modelado del estado.**
- *Recomendación:* UN solo estado `en_bodega_satelite`, con el nombre de zona derivado de
  `orden.zonaId` para el display (mismo criterio que feature 30/R20).
- *Alternativa:* un estado por zona (`en_bodega_satelite_limon`, …): multiplica el catálogo, complica
  seed y guardias. Descartada en design.md.

**(c) Alcance por zona en recepción.**
- *Recomendación:* el `adminSatelite` SOLO recibe órdenes de SU zona; escanear el QR de una orden con
  `zonaId` ≠ su zona DEBE rechazarse (`zona_ajena`, R12). ¿Se confirma?

**(d) Granularidad de la recepción.**
- *Recomendación:* recepción **1-a-1** con feedback por ítem (cada escaneo transiciona una orden y
  confirma; R10). Idempotente al reescanear una ya recibida (R14). ¿Se requiere además una recepción
  "por lote" (multi-selección + confirmar) o basta el 1-a-1 por escaneo?

**(e) Casos de error del escaneo (R12–R16).**
- *Recomendación (definida y verificable):* `zona_ajena` (otra zona), `estado_invalido` (no en
  `en_ruta_bodega_satelite`), `ya_recibida` (idempotente, sin error), `no_encontrada`
  (inexistente/borrada), `código inválido` (formato). ¿Se confirman estos cinco comportamientos?

**(f) ¿El módulo lista también las ya recibidas `en_bodega_satelite`?**
- *Recomendación:* SÍ (R8), en sección aparte, como base de la feature 34 y para feedback del operador.
  ¿Se confirma, o se deja el módulo solo con "Por recibir" en esta feature?

**(g) ¿E2E para la recepción?**
- *Contexto:* la recepción toca la ingesta/transición de órdenes (flujo operativo crítico). El hardware
  de escaneo no es automatizable, pero la entrada es texto.
- *Recomendación:* un E2E (Playwright) que escriba un `orden.id` en el input de escaneo y verifique la
  transición cubre el flujo sin hardware; el lector físico queda como verificación manual (R22).
  ¿Se exige E2E o basta unit(service)+integration(action) para esta feature?

**(h) ¿El maestro / GAM ve algo de esta recepción?**
- *Recomendación:* NO en esta feature. El maestro ya ve el estado `en_ruta_bodega_satelite` (feature
  30) y verá `en_bodega_satelite` como estado legible en el listado general (aditivo, sin trabajo nuevo
  aquí). ¿Se confirma que no se construye vista extra para maestro/GAM?
