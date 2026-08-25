# Feature 266 — tasks

Rama `feature/266-habilitar-pedido-api-key`, worktree `C:/w266`, desde
`origin/dev` (`39115008`).

**Regla de esta ficha: el criterio de «hecho» es un ASSERT que se ejecuta, jamás
un `grep`.** En la 257 se cumplieron greps reescribiendo comentarios y hubo que
retractarlo. Ninguna task de abajo se da por hecha con una búsqueda de texto.

⚠️ **Gate: `./init.sh` COMPLETO.** El diff toca `db/migrations/` y
`db/schema.prisma`; `--rapido` se niega solo. No es opcional ni negociable.

⚠️ **Las seis decisiones de la puerta (2026-08-23, D1..D6 en `requirements.md`)
están FIRMADAS.** La que más cambia el trabajo es **D1**: los estados habilitables
son `ayuda_tienda` y `devuelta`, **`reprogramada` QUEDA FUERA**, y como una
`devuelta` está siempre desasignada, **el único estado que puede volver a
`en_reparto` es `ayuda_tienda`**. Ningún test puede escribirse esperando que una
`devuelta` o una `reprogramada` transicionen.

Leyenda: `[P]` = paralelizable con las tasks del mismo bloque.

---

## Bloque 0 — Antes de escribir nada

### [x] T0.1 — Confirmar que las verificaciones de la ficha siguen ciertas en este worktree
Depende de: —
Hacer: comprobar en `C:/w266` que (a) `ORIGENES_SIN_EVENTO_PUBLICO` está vacía y
`ayuda_tienda`/`incidente` están en `EVENTOS_PUBLICOS`
(`lib/types/webhook-eventos.ts`); (b) `transicionarAyuda` sigue siendo el único
punto de escritura de la arista de ayuda; (c) los cuatro repos que ponen
`mensajero_asignado_id` a NULL siguen haciéndolo.
**Hecho cuando:** existe una nota en `progress/impl_266.md` con el commit y el
resultado de las tres comprobaciones. Si alguna es falsa, **la implementación se
detiene** y se avisa al leader.

### [x] T0.2 — Medir el baseline de la suite ANTES de tocar nada
Depende de: T0.1
Hacer: `./init.sh` completo sobre el árbol limpio.
**Hecho cuando:** el número de tests rojos preexistentes está anotado en
`progress/impl_266.md`. Sin este número, ningún rojo posterior se puede atribuir.

---

## Bloque 1 — Datos (bloquea a casi todo)

### [x] T1.1 — Migración: value `habilitacion_api` en el enum de familias
Depende de: T0.2
Hacer: `pnpm run db:migrate:create` para
`..._orden_historial_origen_habilitacion_api`; `migration.sql` con
`ALTER TYPE "orden_historial_origen_tipo" ADD VALUE IF NOT EXISTS 'habilitacion_api';`
**y nada más** (55P04); `down.sql` recreando el tipo con la lista previa
(31 valores) + `ALTER COLUMN ... USING`, copiando el patrón de
`20260820190000_orden_historial_origen_rechazo_tienda`. Añadir el value al
`enum OrdenHistorialOrigenTipo` de `db/schema.prisma` y a
`ORDEN_HISTORIAL_ORIGEN_TIPO_SEED` (`lib/types/orden-historial.ts`) con su
comentario (por qué familia propia, y las tres NO-listas).
**Hecho cuando:** `pnpm run db:migrate` aplica; `pnpm run db:rollback` revierte
sobre una base sin filas de esa familia; `pnpm typecheck` pasa (el `satisfies` y
`_EnsureExhaustive` de `orden-historial.ts` son el assert de que schema y SEED
coinciden).

### [x] T1.2 — Migración: tabla `orden_habilitacion_api`
Depende de: T1.1 (migración separada, timestamp posterior)
Hacer: `CREATE TABLE` + 2 índices + `ENABLE ROW LEVEL SECURITY` según design §2.2;
`down.sql` con `DROP TABLE`. Modelo Prisma + relaciones inversas en `Orden` y
`Usuario`.
**Hecho cuando:** `pnpm run db:migrate` aplica, `pnpm run db:rollback` revierte,
`pnpm db:generate` + `pnpm typecheck` pasan, y la guardia de schema-drift del
repo está verde.
⚠️ Escribir los `.sql` con EOL LF (memoria: escribirlos con Python en Windows
mete CRLF y tumba la guardia de schema-drift).

### [x] T1.3 — Test: la familia nueva NO cuenta como visita real ni exceptúa el webhook
Depende de: T1.1
Archivo: `tests/unit/types/orden-historial-habilitacion-api.test.ts`
Asserts:
- `ORIGEN_TIPOS_VISITA_REAL` **no** incluye `"habilitacion_api"` → **R26**
- `ORIGEN_TIPOS_CON_GESTION` **no** incluye `"habilitacion_api"`
- `esFamiliaSinEventoPublico("habilitacion_api") === false` → **R27**
- `ORDEN_HISTORIAL_ORIGEN_TIPO_SEED` incluye `"habilitacion_api"`
**Hecho cuando:** los cuatro asserts pasan y el primero se pone ROJO si alguien
añade la familia a la lista de visita real (verificado invirtiéndolo a mano una
vez y volviéndolo a dejar).

---

## Bloque 2 — Tipos y contratos (paralelizable)

### [x] T2.1 [P] — `ESTADOS_HABILITABLES_API` (D1)
Depende de: T0.2
Hacer: `lib/types/habilitacion-api.ts`, módulo puro con la constante DERIVADA de
`ESTATUS_POR_GRUPO` (`lib/types/novedad-grupo.ts:63`), no de literales sueltos
(design §1), `as const satisfies readonly OrderStatusValue[]`, con su comentario
de lista de INCLUSIÓN y de por qué `reprogramada` queda fuera.
**Hecho cuando:** `tests/unit/types/habilitacion-api.test.ts` pasa con estos
asserts:
- el conjunto es **exactamente** `["ayuda_tienda", "devuelta"]`, por igualdad →
  **D1**
- `reprogramada` **no** está en él → **R13-b**
- `rechazada`, `incidente`, `sin_gestionar` y `en_reparto` **no** están en él →
  **R13/R31**
- el conjunto coincide con `Object.values(ESTATUS_POR_GRUPO)` — es el assert que
  hace ruido si alguien reescribe la constante como literales y las dos verdades
  se separan

### [x] T2.2 [P] — Ampliar `TransicionAyudaInput.origenTipo`
Depende de: T1.1
Hacer: añadir `"habilitacion_api"` al `Extract` de
`lib/interfaces/repositories/IOrdenRepository.ts:367`, con el comentario de por
qué es aditivo.
**Hecho cuando:** `pnpm typecheck` pasa y los tests existentes de
`rescate-ayuda-service.test.ts` y `SolicitudAyudaService` siguen verdes sin
cambios (assert de no-regresión: el cambio es aditivo).

### [x] T2.3 [P] — Interfaces nuevas
Depende de: T1.2
Hacer: `lib/interfaces/repositories/IOrdenHabilitacionApiRepository.ts` y
`lib/interfaces/services/IApiHabilitacionService.ts` (tipos de resultado por fila,
códigos de error como unión cerrada).
**Hecho cuando:** `pnpm typecheck` pasa y el tipo de `codigo` es una unión
literal cerrada (un código nuevo no compila sin declararlo).

---

## Bloque 3 — Repositorios

### [x] T3.1 — `OrdenRepository.findParaHabilitacionApi`
Depende de: T2.3
Hacer: lectura con `where: { numGuia, tiendaId: ownerId, deletedAt: null }`,
`select` acotado a `id`, `estatusId`, `estatus.value`, `mensajeroAsignadoId`.
Declarar en `IOrdenRepository`.
**Hecho cuando:** `tests/unit/repositories/orden-repository-habilitacion-api.test.ts`
afirma con un cliente Prisma espiado que el `where` lleva las TRES claves
(`numGuia`, `tiendaId`, `deletedAt: null`) → **R3/R4**.

### [x] T3.2 — `OrdenHabilitacionApiRepository.registrar`
Depende de: T1.2, T2.3
Hacer: insert único, sin lógica de negocio.
**Hecho cuando:** `tests/unit/repositories/orden-habilitacion-api-repository.test.ts`
afirma que el `create` recibe los cinco campos y que la clase **no** expone
ningún método de actualización ni de borrado → **R24**.

---

## Bloque 4 — Service (el corazón)

### [x] T4.1 — `ApiHabilitacionService`
Depende de: T2.1, T2.2, T2.3, T3.1, T3.2
Hacer: el algoritmo de design §4.4. Constructor con el `Pick` EXACTO de §4.4
(`findParaHabilitacionApi` | `findEstatusIdByValue` | `transicionarAyuda`) +
`IOrdenHabilitacionApiRepository`. Sin `prisma`, sin HTTP.
**Hecho cuando:** T4.2 en verde.

### [x] T4.2 — Tests unitarios del service — **la mayor parte de la trazabilidad**
Depende de: T4.1
Archivo: `tests/unit/services/api-habilitacion-service.test.ts`
Un `it` por comportamiento, con repos falsos. Asserts:

| Assert | R |
| --- | --- |
| owner: el service pasa `actor.usuarioId` como `ownerId` a `findParaHabilitacionApi` | R3 |
| repo devuelve `null` → fila `error/no_encontrada`, cero escrituras | R4 |
| `num_guia` no entero / `nota` vacía tras trim / `nota` de 201 chars → `error/fila_invalida`, y las demás filas SÍ se procesan | R7 |
| guía repetida en el lote → 1.ª procesada, 2.ª `error/duplicada_en_lote`, `registrar` llamado UNA vez | R8 |
| el array de salida tiene la misma longitud y el mismo orden que la entrada | R11 |
| `ayuda_tienda` + `mensajeroAsignadoId != null` → `transicionarAyuda` llamado 1 vez con `origenTipo:"habilitacion_api"`, origen `ayuda_tienda`, destino `en_reparto`, `actorUsuarioId` = owner | R12/R15/R16 |
| `ayuda_tienda` + `mensajeroAsignadoId === null` → **rama B**: `transicionarAyuda` NO llamado | R12/R20 |
| `devuelta` (con `mensajeroAsignadoId === null`, que es su estado real) → **rama B SIEMPRE**: `transicionarAyuda` NO llamado, `registrar` con `cambioDeEstado:false` y `estadoResultante: "devuelta"` | R12/R14-b/R20/R21 |
| **`reprogramada` → `error/estado_no_habilitable`** (NO es rama B, NO se registra nada): `transicionarAyuda` NO llamado y `registrar` NO llamado | R13-b |
| **ataque directo a la guarda**: orden en `entregada`, en `rechazada` y en `en_reparto` → `error/estado_no_habilitable`, `transicionarAyuda` NO llamado, `registrar` NO llamado | R13/R14/R31 |
| **segunda habilitación** de una orden ya en `en_reparto` → `error/estado_no_habilitable` y NUNCA `habilitada`: assert explícito sobre el `resultado` devuelto, además del cero-escrituras | R31 / D3 |
| `findEstatusIdByValue` devuelve `null` para uno de los dos → fila rechazada, `transicionarAyuda` NO llamado | R19 |
| `transicionarAyuda` devuelve `false` (carrera) → `error/estado_no_habilitable` y `registrar` NO llamado | R18/R25 |
| rama A OK → `registrar` llamado DESPUÉS de `transicionarAyuda` (orden de llamadas afirmado) con `cambioDeEstado:true` | R23/R25 |
| una fila que falla no impide que las siguientes se procesen | R9 |
| el resumen cuadra: `total = habilitadas + habilitadasSinCambioDeEstado + conError` | R10 |

**Hecho cuando:** todos los `it` pasan y cada uno nombra el comportamiento, no la
función (`docs/conventions.md`).

### [x] T4.3 — Assert estructural del punto único de escritura
Depende de: T4.1
Hacer: el propio tipo del constructor es la garantía (§4.4). El test añade el
assert de llamada.
Archivo: mismo que T4.2.
**Hecho cuando:** existe un `it` que afirma, para un lote de 3 filas de rama A,
que `transicionarAyuda` se llamó exactamente 3 veces y que el repo falso —cuyo
tipo es el `Pick`— no expone ningún otro método de escritura → **R15**.
**Explícitamente NO se hace con un `grep` de `updateMany`.** La garantía es de
tipos + assert de llamada.

---

## Bloque 5 — Controller

### [x] T5.1 — `app/api/ordenes/api-key/habilitar/route.ts`
Depende de: T4.1
Hacer: `handleHabilitarApi(req, deps)` + `POST`, calcado de `handleCancelarApi`.
`runtime = "nodejs"`. zod solo para el ENVOLTORIO (design §3.2).
`middleware.ts` **no se toca** (prefijo ya cubierto; la guardia 229 congela sus
listas).
**Hecho cuando:** T5.2 en verde.

### [x] T5.2 — Tests del route handler
Depende de: T5.1
Archivo: `tests/integration/api/ordenes-api-key-habilitar.route.test.ts`
(con `deps` inyectadas, sin DB, patrón de `ordenes-api-key-cancelar.route.test.ts`).
Asserts:

| Assert | R |
| --- | --- |
| sin `Authorization` → 401 y el service NO se instancia | R1 |
| key `forbidden` → 403 y el service NO se instancia | R2 |
| cuerpo no-JSON / `ordenes` ausente / array vacío / array con **101** filas → 422 y el service NO se llama; y un lote de **100** filas SÍ pasa el envoltorio | R6 / D2 |
| lote válido con 1 fila OK y 1 fila en error → **HTTP 200** con los dos resultados | R9 |
| la respuesta trae `resultado` ∈ {`habilitada`,`habilitada_sin_cambio_de_estado`,`error`} y `estado` poblado en las dos primeras | R10 |
| el cuerpo de la respuesta **no** contiene la key ni su hash, y `console.error` espiado tampoco la recibe | R5 |
| la guardia 229 de `PUBLIC_ROUTES` sigue verde (no se tocó el middleware) | — |

**Hecho cuando:** todos pasan y el test de la key nunca-logueada usa un espía
real sobre `console.error`, no una inspección visual.

---

## Bloque 6 — Emisión (afirmar, no asumir)

### [x] T6.1 — Test de política: la familia nueva SÍ emite
Depende de: T1.1
Archivo: `tests/unit/types/orden-historial-habilitacion-api.test.ts` (ampliar T1.3)
**Hecho cuando:** hay un assert
`esTransicionEmitible("en_reparto", "habilitacion_api") === true` → **R17/R27**.

### [x] T6.2 — Test de emisión de extremo a extremo del choke point
Depende de: T4.1, T6.1
Archivo: `tests/unit/services/jobs/webhook-habilitacion-api-emision.test.ts`
Hacer: invocar `appendCambioEstado` con una entrada
`{ estatusDestinoId: <en_reparto>, origenTipo: "habilitacion_api" }` y un `emitir`
espiado / un `JobRepository` falso.
**Hecho cuando:** el assert afirma que se encoló UN job `webhook_estado` para esa
orden → **R17**. Y el espejo: una entrada de rama B **no existe** (no hay
transición), afirmado en T4.2 como «`transicionarAyuda` NO llamado» → **R22**.

---

## Bloque 7 — Documentación pública

### [x] T7.1 [P] — OpenAPI: objeto y espejo
Depende de: T5.1
Hacer: path `/api/ordenes/api-key/habilitar` en `lib/api/openapi-spec.ts` y en
`docs/api/api-key-openapi.yaml`.
**Hecho cuando:** `tests/unit/api/openapi-266-habilitar.test.ts` afirma que el
path existe en el objeto, que el `enum` de `resultado` tiene los 3 valores, que
el `enum` de `error.codigo` tiene los 4 códigos, que **el YAML declara el mismo
path y los mismos enums** (paridad objeto↔espejo), y que la `description` del
path menciona los DOS estados habilitables, el tope de 100 y el hecho de que una
`devuelta` nunca cambia de estado → **R28 / D1 / D2**.
No se añade nada a la sección `webhooks:` (decisión firmada 2).

### [x] T7.2 [P] — Postman + CHANGELOG
Depende de: T7.1
**Hecho cuando:** `docs/api/ordenex-api-key.postman_collection.json` parsea como
JSON válido en el test de la colección (si existe) y `docs/api/CHANGELOG.md`
tiene su entrada fechada.

---

## Bloque 8 — Cierre

### [x] T8.1 — Mapa de trazabilidad R → test
Depende de: todo lo anterior
**Hecho cuando:** `progress/impl_266.md` contiene una tabla con las **33** filas
(`R1..R31` más `R13-b` y `R14-b`), cada una con archivo de test **y nombre del
`it`**. Un `R` sin `it` nombrado es un fallo de la feature (`docs/specs.md`).

### T8.2 — Gate completo
Depende de: T8.1
Hacer: **`./init.sh` COMPLETO**. `--rapido` se negará solo por `db/migrations` y
`db/schema.prisma`; no se intenta.
**Hecho cuando:** verde, o con delta 0 respecto del baseline de T0.2. Cualquier
rojo nuevo se aísla antes de atribuirlo (memoria: la suite completa tira 2-4
flakes por saturación que pasan aislados).

---

## Cobertura R → task

| R | Task |
| --- | --- |
| R1, R2, R5, R6, R9, R10 | T5.2 |
| R3, R4 | T3.1, T4.2 |
| R7, R8, R11 | T4.2 |
| R12, R13, R14 | T2.1, T4.2 |
| R13-b (`reprogramada` no habilitable) | T2.1, T4.2 |
| R14-b (`devuelta` siempre rama B) | T4.2 |
| R15, R16 | T2.2, T4.2, T4.3 |
| R17 | T6.1, T6.2 |
| R18, R19 | T4.2 |
| R20, R21, R22 | T4.2, T6.2 |
| R23, R25 | T4.2 |
| R24 | T3.2 |
| R26, R27 | T1.3, T6.1 |
| R28 | T7.1 |
| R29, R30 | T1.1, T1.2 |
| R31 | T4.2 |

## Cobertura D → task (decisiones de la puerta, 2026-08-23)

| D | Task que la demuestra |
| --- | --- |
| D1 — habilitables = `{ayuda_tienda, devuelta}`, sin `reprogramada` | T2.1, T4.2, T7.1 |
| D2 — tope 100 | T5.2, T7.1 |
| D3 — segunda habilitación = `error` honesto | T4.2 |
| D4 — tabla sin lector, aceptada como bitácora | ninguna task de código: es una **no-acción declarada**. El reviewer verifica que NO se añadió ninguna superficie de lectura |
| D5 — familia `habilitacion_api` | T1.1, T1.3 |
| D6 — la nota NO va al `motivo` | T4.2: assert de que la entrada pasada a `transicionarAyuda` **no** lleva `motivo` |
