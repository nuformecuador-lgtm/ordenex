# Feature 33 — Bodega satélite: "Mis asignaciones" y recepción por QR · requirements.md

Zone: `fullstack` · complexity: `high` · depends_on: 30 (`done`), 32 (`done`) · branch: `feature/33-recepcion-qr-satelite`

> Estado: `in_progress` (F2.0). **F1.4 APROBADA por el humano el 2026-07-11** (ver bloque
> "## Decisiones F1.4 (APROBADAS)" abajo, que SUPERSEDE la sección "Preguntas abiertas para
> F1.4").
>
> ⚠️ **Cambios posteriores 2026-07-15** (ver "## Decisiones 2026-07-15"), que SUPERSEDEN a F1.4 (a):
> 1. El QR codifica **`num_guia`**, no `orden.id` (cambio de la feature 32, decisión (a')). La
>    recepción resuelve la orden por `num_guia`.
> 2. Se **RETIRA el camino del lector físico keyboard-wedge**: la recepción es **SOLO por cámara**.
>    **R10 queda RETIRADO** (ver su entrada, conservada con el motivo y la fecha).

## Decisiones 2026-07-15 (APROBADAS por el humano) — SUPERSEDEN a F1.4 (a)

- **(a-1) Escaneo = SOLO cámara.** El camino del lector físico keyboard-wedge (el `<input>` autofocus
  donde el lector "teclea" el QR y termina con Enter) fue **eliminado de la UI** por decisión del
  humano. Ya NO hay "dos caminos" de recepción: queda **únicamente** la cámara del dispositivo
  (`html5-qrcode`, vía el componente compartido `QrScanner`). Consecuencia directa: **R10 RETIRADO**
  y los tests que cubrían el input (texto + Enter) **eliminados a propósito** — su ausencia NO es una
  regresión ni trazabilidad rota (ver "Tabla de trazabilidad" y la nota de R10).
- **(a-2) El QR codifica `num_guia`, no `orden.id`.** Alineado con la decisión (a') de la feature 32
  (2026-07-15). El QR de la etiqueta codifica la URL `<origin>/paquete/<numGuia>`; el escáner extrae
  el `num_guia` del último segmento y la recepción hace lookup por `num_guia` (`@unique`), NO por PK.
  **Corte limpio sin retrocompatibilidad:** un `orden.id` (UUID) escaneado de una etiqueta antigua NO
  resuelve ninguna orden y produce `validation_error`; esas etiquetas deben reimprimirse.
  R11–R16 y R22 quedan referidos a `num_guia` como identificador escaneado.

## Decisiones F1.4 (APROBADAS 2026-07-11)

- **(a) Escaneo = AMBOS mecanismos**: (1) **cámara del dispositivo** (getUserMedia + librería de
  decodificación QR — dependencia NUEVA, a elegir por el implementer: mantenida, liviana,
  compatible con Next App Router / Client Component) y (2) **lector físico tipo pistola
  (keyboard-wedge)**: el lector "teclea" el contenido del QR en un input y dispara la recepción.
  Ambos caminos resuelven a la MISMA lógica de recepción (dado un `orden.id`, transiciona).
  NOTA: convertir la app en **PWA** es una feature FUTURA aparte — NO entra en la 33.
  > **SUPERADA el 2026-07-15 por la decisión (a-1).** Se conserva el rastro: se llegó a implementar
  > el camino keyboard-wedge, pero el humano decidió retirarlo y dejar la recepción SOLO por cámara.
  > De esta decisión sobrevive únicamente el mecanismo (1) cámara; el (2) lector físico ya NO existe
  > en la UI. La mención a `orden.id` queda además superada por (a-2): el QR codifica `num_guia`.
- **(b)** UN solo estado NUEVO **`en_bodega_satelite`** con la zona derivada de `orden.zonaId`
  para el display ("en bodega satélite de <zona>"). Mismo patrón de la feature 30.
- **(c)** El adminSatelite **SOLO recibe órdenes de SU zona**: escanear una orden con
  `zonaId` ≠ zona del adminSatelite → error `zona_ajena`, sin transicionar.
- **(d)** Recepción **1-a-1** por escaneo, con feedback por ítem. Idempotente: reescanear una
  orden ya `en_bodega_satelite` → mensaje "ya recibida", sin error duro ni doble transición.
- **(e)** Los 5 casos de error del escaneo quedan definidos (QR ilegible/no-`orden.id`; orden
  inexistente; orden NO en `en_ruta_bodega_satelite`; orden de otra zona `zona_ajena`; ya
  recibida), cada uno con comportamiento verificable.
- **(f)** El módulo lista **DOS secciones separadas**: "Por recibir" (`en_ruta_bodega_satelite`)
  y **"Recibidas"** (`en_bodega_satelite`). Las recibidas son la base de la feature 34.
- **(g)** **SÍ se añade un E2E** (Playwright) del flujo de recepción por escaneo (escanear →
  recepción → `en_bodega_satelite`), patrón del repo (escrito, ejecución diferida, como
  `e2e/auth.spec.ts`/`e2e/mis-asignaciones.spec.ts`).
- **(h)** El maestro/GAM **NO** ve esta recepción en la 33 (la visibilidad se maneja en tiempo
  real, feature 35, o trazabilidad, 49). Fuera de alcance aquí.

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
- **QR = `num_guia`** (decisión (a') de la feature 32, **2026-07-15**; ver
  `EtiquetaGuiaService.toEtiquetaDTO`, `qrValue: String(numGuia)`). La etiqueta imprimible codifica
  la URL `<origin>/paquete/<numGuia>` en el QR; la recepción de esta feature extrae el `num_guia`
  del último segmento (`extractNumGuiaFromScan`, `lib/utils/paquete-url.ts`) y hace *lookup* por
  `num_guia` (`Orden.numGuia` es `Int? @unique`). El código de barras codifica el MISMO `num_guia`.
  > Antes (F1.4, 2026-07-11 → 2026-07-15) el QR codificaba `orden.id` y el lookup era por PK.
  > Superado por (a-2); sin retrocompatibilidad (un UUID escaneado → `validation_error`).
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

- **~~R10~~ — RETIRADO el 2026-07-15** (decisión (a-1) del humano). Texto original, conservado como
  rastro de que existió:
  > ~~El sistema DEBE ofrecer un mecanismo de recepción que reciba el contenido escaneado de un QR
  > como **texto** (el valor codificado es `orden.id`, feature 32) y dispare la recepción de UNA
  > orden por escaneo (1-a-1), con feedback por ítem (éxito o motivo de rechazo). El mecanismo de
  > entrada recomendado es un lector físico tipo teclado (keyboard-wedge) que "teclea" el contenido
  > en un input; la recepción NO DEBE depender de acceso a cámara.~~
  >
  > **Motivo del retiro:** el `<input>` autofocus del lector keyboard-wedge fue **eliminado de la
  > UI** por decisión del humano; la recepción es ahora **SOLO por cámara**. El requisito describía
  > justamente ese camino de entrada, por lo que deja de aplicar en su totalidad.
  >
  > **Efecto en trazabilidad (leer antes de reportar regresión):** los tests que cubrían R10 (entrada
  > de texto + Enter en el input) fueron **eliminados a propósito** junto con el input. La ausencia
  > de esos casos es **intencional**, NO una regresión ni un requisito sin test. R10 no debe volver a
  > mapearse a ningún test.
  >
  > **Qué sobrevive y dónde:** la entrada por cámara está cubierta por la decisión (a-1) y por
  > R11–R16 (que definen el comportamiento de la recepción dado el valor escaneado, sea cual sea el
  > medio de captura), más R22 (testabilidad de la lógica). Ver Pregunta abierta (i) sobre si el
  > humano quiere un requisito EARS explícito para el camino cámara.

- **R11** — CUANDO se recibe un `num_guia` cuya orden está en `en_ruta_bodega_satelite` y cuyo
  `orden.zonaId` es la zona del `adminSatelite`, ENTONCES el sistema DEBE transicionar esa orden a
  `en_bodega_satelite` (fijando `estatus_id`) y confirmar la recepción de ese ítem. NO DEBE tocar
  `mensajero_asignado_id` ni `num_guia`.
- **R12** — SI el `num_guia` recibido corresponde a una orden cuyo `orden.zonaId` NO es la zona del
  `adminSatelite`, ENTONCES el sistema DEBE rechazar la recepción con un motivo claro (`zona_ajena`,
  "esta orden pertenece a otra zona"), SIN efectos en datos.
- **R13** — SI el `num_guia` recibido corresponde a una orden que NO está en
  `en_ruta_bodega_satelite` (estado de origen incorrecto, p. ej. `en_fulfillment`), ENTONCES el
  sistema DEBE rechazar la recepción con un motivo claro (`estado_invalido`, indicando el estado
  actual), SIN efectos en datos.
- **R14** — SI el `num_guia` recibido corresponde a una orden que YA está en `en_bodega_satelite`
  (de la propia zona), ENTONCES el sistema NO DEBE producir error ni efectos: DEBE responder de forma
  idempotente con un mensaje "ya recibida". (Reescanear un paquete ya recibido no rompe el flujo.)
- **R15** — SI el `num_guia` recibido no corresponde a ninguna orden, o corresponde a una orden
  borrada (`deleted_at`), ENTONCES el sistema DEBE rechazar la recepción con un motivo claro
  (`no_encontrada`), SIN efectos en datos.
- **R16** — SI del valor escaneado no se puede extraer un `num_guia` válido (QR ilegible, cadena
  vacía, URL de otro origen, segmento no numérico, o un `orden.id`/UUID de una etiqueta antigua),
  ENTONCES el sistema DEBE rechazar la entrada en el borde (`validation_error`, "código inválido")
  ANTES de invocar el service, SIN tocar datos.
  *Nota (2026-07-15):* el caso "UUID de etiqueta antigua" es consecuencia del corte limpio sin
  retrocompatibilidad (decisión (a-2)): esas etiquetas deben reimprimirse.

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
- **R22** — La lógica de recepción (transición dado un `num_guia`) DEBE ser testeable a nivel de
  **service** (con dobles de repo, sin DB ni HTTP) y a nivel de **Server Action** recibiendo el
  identificador escaneado como **texto**. El hardware de captura (la **cámara**) NO es
  unit-testeable: la decodificación real DEBE quedar declarada como verificación **manual**; los
  tests de componente cubren el escáner con la librería de decodificación mockeada (entregar el texto
  decodificado al handler).
  *Actualizado 2026-07-15 (decisión (a-1)):* la referencia previa al lector keyboard-wedge y al E2E
  "que escribe texto en el input de escaneo" queda **sin efecto** — ese input ya no existe. El
  hardware cuya integración se verifica manualmente es ahora la cámara, no el lector físico.
- **R23** — Cada requisito **vigente** (`R1`–`R22`, **excepto R10, RETIRADO el 2026-07-15**) DEBE
  quedar mapeado a al menos un test concreto (tabla de trazabilidad; el `implementer` la completa con
  rutas en `progress/impl_33-recepcion-qr-satelite.md`). R10 NO cuenta para esta regla: está retirado
  y sus tests se eliminaron a propósito.

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
| ~~R10~~ | **RETIRADO 2026-07-15 — SIN test, por diseño.** Los casos del input keyboard-wedge (texto + Enter) se eliminaron a propósito junto con el input. No es regresión ni trazabilidad rota. |
| R11 | unit service: orden en `en_ruta_bodega_satelite` de la zona → pasa a `en_bodega_satelite`; sin tocar mensajero/num_guia |
| R12 | unit service: orden de otra zona → `zona_ajena`, sin efectos |
| R13 | unit service: orden en estado != `en_ruta_bodega_satelite` → `estado_invalido`, sin efectos |
| R14 | unit service: orden ya en `en_bodega_satelite` → `ya_recibida`, idempotente, sin efectos |
| R15 | unit service: orden inexistente/borrada → `no_encontrada`, sin efectos |
| R16 | unit action/util: valor sin `num_guia` extraíble (vacío/ilegible/otro origen/UUID antiguo) → `validation_error`, sin tocar service |
| R17 | unit service: rol != adminSatelite → forbidden antes de tocar datos |
| R18 | integration service/repo: update guardado por estado+zona; doble escaneo concurrente sin doble efecto |
| R19 | unit/type: contratos features 30/32/36 estables; ruteo del maestro intacto |
| R20 | integration/db: un único valor `en_bodega_satelite`; display deriva la zona |
| R21 | script/CI: `db:migrate` up + `db:rollback` down verdes |
| R22 | unit service + action (texto) verdes; component del escáner con la decodificación mockeada; nota de verificación manual de la cámara |
| R23 | revisión: todos los R **vigentes** con test asociado (reviewer); R10 excluido por retirado |

---

## Límites (fuera de alcance de esta feature)

- **Asignación desde la bodega satélite a mensajeros de su zona → feature 34.** Aquí la orden solo
  llega a `en_bodega_satelite`; parte de ahí la feature 34.
- **Ruteo del maestro a satélite → feature 30.** No se toca.
- **Etiqueta con QR/código de barras → feature 32.** Aquí solo se **consume** el QR (`num_guia`,
  decisión (a-2) 2026-07-15; antes `orden.id`).
- **Recepción con lector físico (keyboard-wedge) → RETIRADA del producto** el 2026-07-15 (R10). No es
  "fuera de alcance de esta feature": es un camino que existió y se eliminó. Reintroducirlo exige una
  decisión nueva del humano.
- **Tiempo real → feature 35. Trazabilidad → feature 49.** No aplican.

---

## Preguntas abiertas para F1.4 (recomendación + alternativas — el humano decide)

> Registro histórico. **(a) quedó resuelta en F1.4 (2026-07-11, ambos mecanismos) y luego REVERTIDA
> el 2026-07-15 por la decisión (a-1): SOLO cámara.** (g) queda igualmente afectada: el E2E que
> proponía escribir texto en el input de escaneo ya no aplica (ese input no existe).

**(a) Mecanismo de escaneo.** [RESUELTA 2026-07-11 → ambos; REVERTIDA 2026-07-15 → solo cámara]
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

---

## Preguntas abiertas (2026-07-15, tras el retiro de R10)

**(i) ¿Se quiere un requisito EARS explícito para el camino cámara?**
- *Contexto:* R10 era el único requisito que enunciaba el **mecanismo de entrada** y la **granularidad
  1-a-1 con feedback por ítem**. Al retirarlo, esos dos enunciados quedan sostenidos solo por las
  decisiones (a-1)/(d), no por un `R<n>` testeable. El comportamiento **sí** está implementado y
  cubierto por tests de componente del escáner; lo que falta es el requisito que los ancle.
- *No se redacta aquí por decisión de proceso:* escribir un "R10 bis" sería inventar un requisito que
  el humano no pidió en este cambio. Se deja la elección explícita:
  1. Dejarlo así (R10 retirado, sin sustituto) — el camino cámara se documenta solo como decisión; o
  2. Añadir un requisito nuevo (p. ej. `R24`) que enuncie en EARS: "CUANDO la cámara decodifica un QR,
     el sistema DEBE recibir UNA orden por escaneo con feedback por ítem", y mapearlo al test de
     componente ya existente.
- *Impacto si no se decide:* ninguno sobre el código; el reviewer podría señalar que la recepción por
  cámara no tiene requisito propio.
