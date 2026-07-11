# Feature 36 — Mensajero: "Mis asignaciones" y gestión de órdenes · requirements.md

Zone: `fullstack` · complexity: `high` · depends_on: 17 (`done`), 34 (`pending`, aún no construida) · branch: `feature/36-mensajero-mis-asignaciones`

> Estado: `in_progress` (F2.0). **F1.4 APROBADA por el humano el 2026-07-11.** Las decisiones
> cerradas están en el bloque "## Decisiones F1.4 (APROBADAS)" inmediatamente abajo, que
> **SUPERSEDE** todos los valores provisionales `(prov. F1.4-x)` del resto del documento y de
> "Preguntas abiertas (F1.4)". ⚠️ CAMBIO DE TERMINOLOGÍA CLAVE respecto al borrador: el estado
> provisional `aceptada` se llama **`en_reparto`**, y la acción del mensajero es **"Recoger"**
> (no "aceptar"). Al leer el resto del spec, mapea mentalmente `aceptada` → `en_reparto` y
> "aceptar" → "recoger".

## Decisiones F1.4 (APROBADAS 2026-07-11)

Semántica del paso de recogida (aclaración del humano): "aceptar" NO es aceptar-vs-rechazar la
asignación; es que **la orden fue RECOGIDA/tomada por el mensajero** y sale a reparto.

- **(a) Estado tras recoger = NUEVO `en_reparto`** (NO `aceptada`). Máquina de estados:
  `en_bodega`/`en_fulfillment`/`en_preparacion` → (maestro/satélite asigna, feature 17/34) →
  **`en_espera_aceptacion`** = "esperando a que el mensajero la recoja" (estado EXISTENTE, se
  reutiliza; su label de presentación se ajusta a la semántica de recogida) → (mensajero pulsa
  **"Recoger"**) → **`en_reparto`** (estado NUEVO) → (gestión) → `entregada`/`reprogramada`/
  `devuelta`/`rechazada`. Donde el borrador dice `aceptada`, léase `en_reparto`; donde dice
  "aceptar/aceptación", léase "recoger/recogida".
- **(b) RECHAZO (resultado de intento de entrega) → estado NUEVO `rechazada`.** No se mapea a
  `devuelta`/`devuelta_origen`. `en_reparto` y `rechazada` son DOS valores nuevos de
  `ORDER_STATUS_SEED` + su migración de catálogo con `down.sql` (patrón features 17/28/30).
- **(c) Método de pago = enum Postgres nativo `metodo_pago_value`** (`efectivo`, `SIMPE`,
  `transferencia`), fuente única de verdad en `lib/types`, patrón `vehiculos`/`RolValue`.
- **(d) Registro de gestión = UNA tabla `gestion_orden`** con discriminador `resultado` +
  campos nullable (evidencia `storagePath`, `montoRecibido`, `metodoPago`, `motivo`,
  `fechaReprogramacion`), con migración + `down.sql` + RLS.
- **(e) Bloqueo 1-a-1 = backend robusto**: puntero **`usuario.orden_en_gestion_id`** (nullable,
  FK a orden). Sobrevive recargas/multi-dispositivo; el backend impide gestionar otra orden
  mientras haya una en gestión. Requiere migración + down.sql.
- **(f) Bucket de evidencias = NUEVO bucket privado `gestion-evidencias`** (no reusar
  `mensajero-docs`). Mismo patrón `SupabaseFileStorage`/`ISignedUrlProvider` (path privado +
  URL firmada), creación de bucket = tarea humana declarada.
- **(g) Recoger = AMBAS modalidades**: botón "Recoger todas" (lote) + "Recoger" individual por
  fila. Ambas transicionan `en_espera_aceptacion` → `en_reparto`.
- **(h) ENTREGA: `montoRecibido` DEBE cuadrar EXACTO con `orden.montoCobrar`** (validación en el
  resultado ENTREGADA; si no cuadra, `validation_error`, no persiste).
- **(i) Obligatoriedad por resultado**: ENTREGADA → foto de evidencia + monto (== montoCobrar) +
  método de pago; REPROGRAMAR → fecha (futura) + motivo; DEVOLUCIÓN → motivo; RECHAZO → foto de
  evidencia + motivo.
- **(j) Trato IDÉNTICO** para asignaciones de bodega central (feature 17) y satélite (feature 34,
  aún `pending`): mismo flujo recoger→gestionar; la fuente de asignación no cambia la lógica.


Notación EARS. Cada requisito es testeable y mapeable a un test (ver "Tabla de
trazabilidad"). El "actor" se resuelve vía `resolveActorFromSession` → `{ usuarioId, rol }`
(`lib/auth/resolve-actor.ts`). El rol autorizado para escribir en este módulo es
**exclusivamente `mensajero`** (sobre SUS propias órdenes).

Contexto de código real (anclas, no inventar):
- `Orden.mensajeroAsignadoId` (`@map("mensajero_asignado_id")`, FK → `usuario`, feature 17)
  es el mensajero al que se asignó la orden. Las órdenes del mensajero son las que tienen
  `mensajeroAsignadoId = <actor>` y están en `en_espera_aceptacion` (por aceptar) o en el
  estado nuevo `aceptada` (por gestionar).
- Catálogo de estados: `lib/types/order-status.ts` (`ORDER_STATUS_SEED`, 10 valores). Ya
  existen `entregada`, `devuelta`, `devuelta_origen`, `reprogramada`, `en_espera_aceptacion`.
  Seed idempotente `scripts/seed-catalogos.ts` (`seedOrderStatus`, upsert por `value`).
  Enum Postgres standalone `order_status_value`. Label legible:
  `app/(app)/ordenes/_components/estatus-label.ts`.
- Almacenamiento de archivos (patrón feature 21/22, a REUSAR): interfaz
  `lib/interfaces/external/IFileStorage.ts` (`upload`/`remove`) →
  `lib/storage/SupabaseFileStorage.ts`; interfaz `lib/interfaces/external/ISignedUrlProvider.ts`
  (`createSignedUrl(s)`) → `lib/storage/SupabaseSignedUrlProvider.ts`; config
  `lib/config/postulacion.ts` (bucket privado, tamaño/MIME por env). Precedente `mensajero_documento`:
  guarda `storage_path` en bucket PRIVADO (nunca URL pública), URLs firmadas con TTL al mostrar.
- Método de pago: NO existe hoy (enum ni catálogo). Es NUEVO.
- UI reusable: `DataTable`/`Pagination` (features 7/8), `Modal` async con spinner (feature 13),
  `Toast` (feature 11), manejador global de errores backend (feature 10). Autz por rol (feature 6).
  Sidebar: `app/(app)/_components/Sidebar.tsx` (`SIDEBAR_ITEMS`).

---

## Bloque 0 — Puerta de aprobación

- **R0** — La puerta **F1.4 DEBE cerrarse por el humano** antes de implementar. Las siete
  decisiones abiertas (a–g de "Preguntas abiertas") y las obligatoriedades por resultado
  DEBEN quedar resueltas y registradas. (Verificación documental, no de código.)

## Modelo de datos — estado(s) nuevo(s) de orden

- **R1** — El sistema DEBE incorporar un estado NUEVO **`aceptada`** `(prov. F1.4-a)`
  ("aceptada / por entregar") como valor de `ORDER_STATUS_SEED` (`lib/types/order-status.ts`,
  fuente única de verdad) y sembrarlo de forma idempotente vía `seedOrderStatus` (upsert por
  `value`), sin alterar los valores existentes.
- **R2** — El sistema DEBE insertar la fila de catálogo `aceptada` en `order_status` mediante
  la migración de esta feature (patrón features 17/28/30: `ALTER TYPE "order_status_value" ADD
  VALUE IF NOT EXISTS` + `INSERT ... ON CONFLICT (value) DO NOTHING`), con su `down.sql` que
  elimine la fila SOLO si ninguna orden la referencia (el valor del enum Postgres no se
  elimina: Postgres no soporta `DROP VALUE`; se documenta).
- **R3** — El resultado "RECHAZO" DEBE dejar la orden en el estado **`rechazada`**
  (estado NUEVO) `(prov. F1.4-b)`, sembrado y migrado igual que R1/R2 (mismo patrón, misma
  migración). SI F1.4-b decide mapear a un estado existente (`devuelta_origen`), ENTONCES no
  se crea `rechazada` y el resultado RECHAZO usa ese `value` existente.
- **R4** — El sistema DEBE definir el label legible de los estados nuevos en la capa de
  presentación (`estatus-label.ts`), no en la DB (p. ej. `aceptada` → "Aceptada / por
  entregar"; `rechazada` → "Rechazada").

## Modelo de datos — método de pago

- **R5** — El sistema DEBE definir un tipo cerrado de **método de pago** con exactamente los
  valores `efectivo`, `simpe`, `transferencia`, con fuente única de verdad en `lib/types/`
  (p. ej. `lib/types/metodo-pago.ts`), respaldado por un enum Postgres nativo
  `metodo_pago_value` `(prov. F1.4-c)`. Añadir/quitar un valor DEBE romper el build (tipado
  exhaustivo), no fallar en silencio.

## Modelo de datos — registro de gestión

- **R6** — El sistema DEBE persistir la gestión de una orden en un registro **`gestion_orden`**
  `(prov. F1.4-d)`: UN registro por gestión con un discriminador `resultado`
  (`entregada | reprogramada | devuelta | rechazada`) y campos NULLABLE por resultado:
  `evidencia_storage_path` (foto), `monto_recibido` (Decimal), `metodo_pago`
  (`metodo_pago_value`), `motivo` (texto), `fecha_reprogramacion` (fecha). DEBE llevar
  `orden_id` (FK → `orden`), `mensajero_id` (FK → `usuario`, el actor) y `created_at`.
- **R7** — La tabla `gestion_orden` DEBE crearse por migración Prisma versionada con su
  `down.sql` OBLIGATORIO, y DEBE tener **RLS habilitada** (sin políticas anon/authenticated;
  acceso solo por service role, patrón `mensajero_documento`/`orden`). DEBE existir índice por
  `orden_id` y por `mensajero_id`.
- **R8** — El registro de gestión DEBE guardar la evidencia como **`storage_path` de un bucket
  PRIVADO** (nunca URL pública), coherente con el patrón de la feature 21/22. La visualización
  posterior DEBE hacerse con URL firmada de TTL acotado (`ISignedUrlProvider`).

## "Mis asignaciones" — listado y detalle

- **R9** — El sistema DEBE exponer un módulo "Mis asignaciones" para el rol `mensajero`
  (nueva entrada en el sidebar/ruta autenticada) que liste TODAS las órdenes cuyo
  `mensajero_asignado_id = actor.usuarioId`, no borradas (`deleted_at IS NULL`), y cuyo estado
  sea `en_espera_aceptacion` (por aceptar) o `aceptada` (por gestionar).
- **R10** — El módulo DEBE mostrar de forma SEPARADA las órdenes **por aceptar**
  (`en_espera_aceptacion`) de las órdenes **por gestionar** (`aceptada`), como agrupaciones
  distintas.
- **R11** — El módulo DEBE mostrar el DETALLE COMPLETO de cada orden (num_guia, num_remisión,
  destinatario, teléfono, dirección, zona/provincia/cantón/distrito, producto, monto a cobrar,
  tienda, notas), reutilizando el patrón de listado/tabla existente.
- **R12** — CUANDO un actor con rol distinto de `mensajero` accede al módulo "Mis
  asignaciones", el sistema DEBE denegar el acceso (`forbidden`), y CUANDO no hay actor
  autenticado DEBE responder `unauthenticated` antes de tocar el service/datos.
- **R13** — El listado de "Mis asignaciones" NUNCA DEBE mostrar órdenes de OTRO mensajero: la
  consulta DEBE filtrar por `mensajero_asignado_id = actor.usuarioId` en el backend, no en el
  cliente.

## Aceptación de asignaciones (paso previo obligatorio)

- **R14** — MIENTRAS una orden esté en `en_espera_aceptacion`, el sistema DEBE ofrecer al
  mensajero asignado ÚNICAMENTE la acción **ACEPTAR** (no existe acción de rechazar la
  asignación en este paso).
- **R15** — CUANDO el mensajero acepta una asignación, el sistema DEBE transicionar la orden de
  `en_espera_aceptacion` a `aceptada`, sin modificar `mensajero_asignado_id`.
- **R16** — El sistema DEBE permitir aceptar en **lote** (todas las órdenes por aceptar del
  mensajero en una sola acción) `(prov. F1.4-g)`; la acción DEBE recibir un conjunto de
  `ordenIds` (soporta también aceptar de a una).
- **R17** — El sistema DEBE rechazar (`forbidden`, sin efectos) todo intento de aceptar una
  orden cuyo `mensajero_asignado_id` NO sea el actor, y (`conflict`/`validation_error`, sin
  efectos) todo intento de aceptar una orden que no esté en `en_espera_aceptacion` (guardia por
  estado de origen).
- **R18** — MIENTRAS una orden esté en `en_espera_aceptacion` (aún no aceptada), el sistema NO
  DEBE permitir gestionarla (los 4 resultados). La gestión SOLO es posible desde `aceptada`.

## Gestión 1-a-1 (bloqueo de las demás)

- **R19** — CUANDO el mensajero escoge/abre una orden `aceptada` para gestionarla, el sistema
  DEBE BLOQUEAR la gestión de las demás órdenes del mensajero hasta que esa orden termine de
  gestionarse; al terminar (cualquiera de los 4 resultados) DEBE liberarlas.
- **R20** — El bloqueo 1-a-1 DEBE ser robusto ante recarga de página: la "orden activa en
  gestión" DEBE persistirse/derivarse en el backend `(prov. F1.4-e)`, de modo que al recargar
  el mensajero siga viendo bloqueadas las demás y activa la misma, sin depender solo del estado
  de la UI.
- **R21** — SI el mensajero intenta gestionar una orden distinta de la que tiene activa MIENTRAS
  hay una en gestión, ENTONCES el sistema DEBE rechazar la operación (`conflict`, sin efectos).
- **R35** — CUANDO el mensajero CANCELA/CIERRA la gestión de una orden sin registrar un resultado,
  el sistema DEBE LIBERAR el puntero de bloqueo (`usuario.orden_en_gestion_id`) del PROPIO actor y
  SOLO si apunta a esa orden (concurrencia-seguro; nunca toca el de otro mensajero), dejando las
  demás órdenes gestionables de nuevo.

## Resultado 1 — ENTREGADA

- **R22** — CUANDO el mensajero registra el resultado ENTREGADA de una orden `aceptada`, el
  sistema DEBE exigir: (a) una **foto de evidencia de entrega**, (b) un **monto recibido**
  (Decimal > 0), y (c) un **método de pago** ∈ {`efectivo`, `simpe`, `transferencia`}. SI falta
  cualquiera, ENTONCES el sistema DEBE responder `validation_error` sin persistir ni transicionar.
- **R23** — CUANDO la entrega es válida, el sistema DEBE, en UNA transacción: (a) subir la foto
  al bucket privado y guardar su `storage_path`, (b) crear el registro `gestion_orden`
  (`resultado=entregada`, `monto_recibido`, `metodo_pago`, `evidencia_storage_path`), y
  (c) transicionar la orden a `entregada`. SI la transacción falla, DEBE limpiar el objeto
  subido (best-effort `IFileStorage.remove`) y no dejar registro ni transición parcial.
- **R24** — El sistema DEBE validar el **tipo MIME** (imagen) y el **tamaño máximo** de la foto
  de evidencia (cotas configurables por env, patrón `postulacionConfig`), tanto en cliente como
  revalidando en el servidor (borde tipado). Foto que no cumpla → `validation_error`, sin subir.

## Resultado 2 — REAGENDAR / REPROGRAMAR

- **R25** — CUANDO el mensajero registra el resultado REPROGRAMAR de una orden `aceptada`, el
  sistema DEBE exigir: (a) una **nueva fecha** de reprogramación **futura** (posterior a hoy) y
  (b) un **motivo** (texto no vacío). Fecha no futura o motivo vacío → `validation_error`, sin
  efectos.
- **R26** — CUANDO la reprogramación es válida, el sistema DEBE crear el registro `gestion_orden`
  (`resultado=reprogramada`, `fecha_reprogramacion`, `motivo`) y transicionar la orden a
  `reprogramada`. (La liberación programada en la fecha es la feature 46, fuera de alcance.)

## Resultado 3 — DEVOLUCIÓN

- **R27** — CUANDO el mensajero registra el resultado DEVOLUCIÓN de una orden `aceptada`, el
  sistema DEBE exigir un **motivo** (texto no vacío). Motivo vacío → `validation_error`, sin
  efectos.
- **R28** — CUANDO la devolución es válida, el sistema DEBE crear el registro `gestion_orden`
  (`resultado=devuelta`, `motivo`) y transicionar la orden a `devuelta`. (El contador de
  intentos y el escalado a rechazo son la feature 47, fuera de alcance.)

## Resultado 4 — RECHAZO

- **R29** — CUANDO el mensajero registra el resultado RECHAZO de una orden `aceptada`, el
  sistema DEBE exigir: (a) una **foto de evidencia del rechazo** y (b) un **motivo** (texto no
  vacío). SI falta cualquiera → `validation_error`, sin efectos. La foto sigue las mismas
  validaciones de R24.
- **R30** — CUANDO el rechazo es válido, el sistema DEBE, en UNA transacción: subir la foto,
  crear el registro `gestion_orden` (`resultado=rechazada`, `evidencia_storage_path`, `motivo`)
  y transicionar la orden a `rechazada` `(prov. F1.4-b)`, con la misma atomicidad y limpieza de
  R23. (El retorno a la tienda de origen es la feature 48, fuera de alcance.)

## Guardias transversales de gestión

- **R31** — TODA acción de gestión (aceptar y los 4 resultados) DEBE validar que la orden
  pertenece al actor (`mensajero_asignado_id = actor.usuarioId`) y que su estado de ORIGEN es el
  permitido; cualquier violación DEBE rechazarse (`forbidden`/`conflict`) sin efectos en datos ni
  en storage.
- **R32** — El resultado de cada gestión DEBE dejar la orden EXACTAMENTE en el estado resultante
  (`entregada`/`reprogramada`/`devuelta`/`rechazada`) y NADA MÁS: esta feature NO construye el
  cierre del día (37), ni la liberación de reprogramadas (46), ni el escalado de reintentos (47),
  ni el retorno a origen (48), ni la trazabilidad/historial (49).

## No-regresión y trazabilidad

- **R33** — Agregar el/los estado(s) nuevo(s) y la tabla `gestion_orden` NO DEBE romper los
  módulos de órdenes existentes (features 6/7/17/30): el mapa `estatus-label.ts` sigue siendo
  exhaustivo sobre `ORDER_STATUS_SEED` (build rompe si falta un label) y los listados existentes
  siguen verdes.
- **R34** — Cada requisito (`R1`–`R33`) DEBE quedar mapeado a al menos un test concreto (tabla
  de trazabilidad; el `implementer` la completa con rutas en
  `progress/impl_36-mensajero-mis-asignaciones.md`). Lo NO unit-testeable (subida/firmado real de
  archivos) DEBE testearse con **dobles/mocks** de `IFileStorage`/`ISignedUrlProvider` (sin red),
  patrón feature 21/22.

---

## Tabla de trazabilidad (requisito → test previsto)

| Req | Test previsto (nivel) |
| --- | --- |
| R0  | revisión documental: F1.4 cerrada con las 7 decisiones (reviewer) |
| R1  | unit: `ORDER_STATUS_SEED` incluye `aceptada`; `seedOrderStatus` idempotente |
| R2  | integration/db: migración inserta fila `aceptada`; enum contiene el valor; down condicional |
| R3  | integration/db + unit service: RECHAZO deja estado `rechazada` (o el mapeado por F1.4-b) |
| R4  | unit: `estatusLabel('aceptada')`/`('rechazada')` devuelve label legible |
| R5  | unit/type: `metodo_pago` acepta solo efectivo/simpe/transferencia; enum Postgres presente |
| R6  | integration/db: `gestion_orden` con `resultado` + campos nullable + FKs |
| R7  | integration/db: RLS habilitada en `gestion_orden`; índices; `down.sql` revierte |
| R8  | unit service: evidencia persiste `storage_path` de bucket privado; nunca URL pública |
| R9  | unit repo/service: lista órdenes con `mensajero_asignado_id = actor` en {en_espera_aceptacion, aceptada} |
| R10 | component: apartados separados "por aceptar" vs "por gestionar" |
| R11 | component: detalle completo de la orden en el listado |
| R12 | unit service/action: rol ≠ mensajero → `forbidden`; sin actor → `unauthenticated` |
| R13 | unit repo: la query filtra por mensajero del actor; no expone órdenes ajenas |
| R14 | component: en `en_espera_aceptacion` solo se ofrece "Aceptar" (no "Rechazar") |
| R15 | unit service: aceptar transiciona `en_espera_aceptacion` → `aceptada`, sin tocar asignado |
| R16 | unit service: aceptar lote de `ordenIds` transiciona todas |
| R17 | unit service: aceptar orden ajena → `forbidden`; origen inválido → `conflict`, sin efectos |
| R18 | unit service: gestionar una orden en `en_espera_aceptacion` → rechazo (solo desde `aceptada`) |
| R19 | unit service/component: con una orden en gestión, las demás quedan bloqueadas; al terminar, liberadas |
| R20 | integration: recarga preserva el bloqueo (orden activa derivada/persistida en backend) |
| R21 | unit service: gestionar una 2.ª orden con otra activa → `conflict`, sin efectos |
| R22 | unit service/zod: ENTREGADA sin foto/monto/método → `validation_error` |
| R23 | unit service: entrega válida crea `gestion_orden` + estado `entregada`; rollback limpia storage (mock) |
| R24 | unit zod/service: foto no imagen o > máx → rechazo, no sube |
| R25 | unit zod/service: REPROGRAMAR con fecha no futura/motivo vacío → `validation_error` |
| R26 | unit service: reprogramación válida → `gestion_orden(reprogramada)` + estado `reprogramada` |
| R27 | unit zod: DEVOLUCIÓN sin motivo → `validation_error` |
| R28 | unit service: devolución válida → `gestion_orden(devuelta)` + estado `devuelta` |
| R29 | unit zod: RECHAZO sin foto/motivo → `validation_error` |
| R30 | unit service: rechazo válido → `gestion_orden(rechazada)` + estado `rechazada`; rollback limpia storage |
| R31 | unit service: gestión de orden ajena / origen inválido → rechazo sin efectos |
| R32 | unit service: cada resultado deja SOLO el estado resultante (sin efectos de 37/46/47/48/49) |
| R33 | unit/build: `estatus-label` exhaustivo; listados existentes verdes |
| R34 | revisión: todos los R con test; archivos con storage mockeado (reviewer) |
| R35 | unit service+repo: liberar limpia solo el puntero propio que apunta a esa orden; no toca el de otro actor |

---

## Preguntas abiertas (F1.4)

> El `spec_author` NO cierra estas decisiones (regla #6). Cada una lleva mi **recomendación**
> y alternativas para que el humano decida en F1.4. Los requisitos afectados usan el valor
> recomendado como provisional (`prov. F1.4-x`) y se ajustarán si el humano decide otra cosa.

- **(a) Nombre del estado nuevo "aceptada / por entregar".**
  **Recomendación: `aceptada`** (participio, alineado con `entregada`/`devuelta`/`reprogramada`,
  denota el acto de aceptación que lo origina). Alternativas: `por_entregar` (describe el
  pendiente, pero rompe la convención participio/`en_`), `en_reparto` (prefijo `en_` como
  `en_bodega`/`en_preparacion`, pero implica "en ruta" que aquí aún no se modela).

- **(b) El resultado RECHAZO: ¿estado NUEVO `rechazada` o mapear a existente?**
  **Recomendación: estado NUEVO `rechazada`.** Motivo: `devuelta` es intermedia/reintentable
  (feature 47: mínimo 3 intentos) y `devuelta_origen` es un destino de retorno a tienda (feature
  48); usar cualquiera colisionaría semánticamente con esos flujos FINALES. Un `rechazada`
  propio deja limpio el escalado de 47/48. Alternativa: mapear a `devuelta_origen` (evita un
  estado nuevo, pero mezcla "rechazo del cliente" con "devuelto a la tienda de origen").

- **(c) Forma del enum de método de pago.**
  **Recomendación: enum Postgres nativo `metodo_pago_value`** (patrón `RolValue`/`VehiculoValue`),
  con fuente única de verdad en `lib/types/metodo-pago.ts`. Motivo: es un conjunto cerrado usado
  como columna discriminadora en `gestion_orden` (no un catálogo referenciado por muchas tablas
  ni administrable por UI); un enum nativo da tipado exhaustivo sin tabla/FK extra. Las
  totalizaciones por método (features 37/44) agrupan por la columna sin problema. Alternativa:
  tabla-catálogo con FK (patrón `order_status`/`rol`) — más flexible para agregar valores en
  caliente, pero sobre-ingeniería para 3 valores fijos.

- **(d) Forma del modelo de gestión.**
  **Recomendación: UN registro `gestion_orden` con discriminador `resultado`** + campos nullable
  por resultado. Motivo: una sola tabla simplifica el listado/consumo (features 37/38 leen "la
  gestión de la orden" sin unir 4 tablas) y refleja que una gestión es un evento único con forma
  variable. Alternativa: tablas separadas por resultado (`entrega`, `reprogramacion`,
  `devolucion`, `rechazo`) — normaliza mejor los NOT NULL por tipo, pero multiplica joins y
  migraciones; innecesario para este volumen de campos.

- **(e) Bloqueo de gestión 1-a-1: solo UI vs. backend.**
  **Recomendación: backend-robusto.** El invariante duro (solo se gestiona desde `aceptada`, una
  transición por acción) ya lo garantiza la máquina de estados; para el "foco" 1-a-1 que
  sobrevive a recargas (R20), recomiendo persistir/derivar la "orden activa en gestión" en el
  backend (p. ej. puntero `mensajero.orden_en_gestion_id` nullable, o `gestion_orden` en estado
  "abierta"). Alternativa: solo-UI (deshabilitar las demás mientras un modal está abierto) —
  más simple, pero al recargar se pierde el bloqueo y dos pestañas podrían gestionar dos órdenes
  a la vez. **Sub-pregunta:** ¿el bloqueo debe impedir físicamente (backend) gestionar una 2.ª
  orden, o basta con guiar la UI y confiar en la guardia de estado por-orden? (R21 asume que sí
  se impide en backend.)

- **(f) Bucket de evidencias.**
  **Recomendación: bucket privado NUEVO `gestion-evidencias`** (separado de `mensajero-docs`,
  que guarda documentos de identidad/postulación con otra retención y otro consumidor). Reusar la
  MISMA infraestructura (`IFileStorage`/`ISignedUrlProvider`/config por env), solo cambiando el
  nombre de bucket. Alternativa: reusar `mensajero-docs` — un bucket menos que crear, pero mezcla
  evidencias operativas con documentos de identidad (permisos/retención distintos).

- **(g) Aceptación: lote vs. por-orden.**
  **Recomendación: aceptar en LOTE** (todas las asignaciones por aceptar en una acción), con la
  acción recibiendo un conjunto de `ordenIds` para soportar también aceptar de a una. Motivo: la
  decisión del humano habla de "aceptar sus asignaciones" (plural) y reduce fricción. Alternativa:
  solo por-orden.

- **(h) ¿El `monto_recibido` debe cuadrar con `orden.monto_cobrar`?**
  **Recomendación: NO forzar igualdad** (registrar el monto tal cual; las entregas reales tienen
  abonos/diferencias), validando solo `> 0`. Abierto: ¿mostrar una advertencia si difiere de
  `monto_cobrar`? ¿permitir `0` para "ya pagado por transferencia previa"? Requiere decisión.

- **(i) Obligatoriedad de campos por resultado.** Propuesta (a confirmar): ENTREGADA → foto +
  monto + método (todos obligatorios); REPROGRAMAR → fecha futura + motivo; DEVOLUCIÓN → motivo;
  RECHAZO → foto + motivo. ¿Algún campo adicional opcional (p. ej. nota libre en entrega)?

- **(j) Origen de las asignaciones desde satélite (feature 34).** La 34 está `pending` (no
  construida) y también dejará órdenes con `mensajero_asignado_id` en `en_espera_aceptacion`. Esta
  feature ya las cubre por diseño (filtra por `mensajero_asignado_id`, sin importar quién asignó).
  ¿Se confirma que NO hay diferencia de tratamiento entre asignaciones de central (17) y satélite
  (34) en "Mis asignaciones"? (Recomendación: sin diferencia.)

## Límites (fuera de alcance de esta feature)

- **Cierre del día del mensajero → feature 37** (consume las órdenes ya gestionadas). Aquí solo
  se deja la orden en su estado resultante.
- **Asignación desde bodega satélite → feature 34** (aún no construida). Esta feature solo
  CONSUME `mensajero_asignado_id`, no lo produce por satélite.
- **Liberación programada de reprogramadas → feature 46**; **escalado de reintentos/rechazo →
  feature 47**; **retorno a tienda de origen → feature 48**; **trazabilidad/historial de estados
  → feature 49**. Ninguno se implementa aquí.
- **Tiempo real → feature 35.** "Mis asignaciones" se sirve con el patrón de datos existente; la
  actualización en vivo es transversal de la 35.
- **Pago al mensajero por zona → feature 39.** El `monto_recibido` es lo RECAUDADO al cliente, no
  lo que se le paga al mensajero.
