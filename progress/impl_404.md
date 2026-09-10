# Feature 404 — bitácora de implementación

**Rama:** `feat/404-mensajero-en-webhook-y-api`
**SHA base:** `f7d4cda9069204d336b136878e11b35c5153a565` (`chore(404): la ficha arranca, con su spec y su rama`)
**Fecha:** 2026-09-10 · **Agente:** backend_dev · **Worktree:** aislado (sin `.env`)

Qué se implementó: un campo **aditivo** `mensajero` `{ id, nombre }` —`null` si la orden no tiene
mensajero asignado— en las tres superficies del canal integrador: el evento
`orden.estado_actualizado` del webhook, el listado `GET /api/ordenes/api-key` y el detalle
`GET /api/ordenes/api-key/orden/{id}`. **Sin migración, sin tabla, sin endpoint, sin parámetro de
query y sin ningún campo que no sea `mensajero`**, tal y como exige la regla de alcance de
`tasks.md`. Ninguna task pidió salirse de ahí.

---

## T0 — base medida antes de escribir código (BLOQUEA TODO)

`git rev-parse origin/dev` → `ca9dbe95fff8a48779bc4119162afdf127313a4f`
(el `f7d4cda9` de la base es un commit local de `dev` posterior a `origin/dev`; la rama sale de él,
como pedía el encargo).

```
$ git log --oneline origin/dev -- lib/services/WebhookEstadoService.ts lib/repositories/WebhookOrdenReader.ts
8b68f687 feat(403): un webhook que falla en racha se pausa, avisa y se recupera solo
8d4f2714 feat(268): el evento de incidente viaja con la causa y con las fotos
5dba8c66 feat(256): el evento de devuelta viaja con el motivo tipificado
313ce20d feat(webhook): renombra clave del payload de estado `orden` -> `data` (F112)
a837c2bd feat(99-webhooks-cambios-estado): emisión de webhooks de estado vía cola de jobs

$ git log --oneline origin/dev -- lib/repositories/OrdenRepository.ts lib/types/api-orden.ts lib/api/openapi-spec.ts
0a5d5269 test(374): la evidencia del catalogo geografico, y las cuatro guardias
2ba50d2f feat(374): el predicado compartido, el repositorio y la cadena de capas del catalogo
9e2cb621 feat(eliminar): siete estados eliminables, y solo sin intentos de entrega
6c35439a feat(analitica-api): el canal por API key sirve lo mismo que la pantalla
9955aeff feat(370): separar en bodega las ordenes nuevas de las que ya salieron (#691)
... (20 más, sin interés para esta ficha)
```

**Los siete símbolos, confirmados EN EL ARCHIVO REAL** (no en el grafo, que devuelve de más):

| Símbolo | Existe | Archivo real : línea |
|---|---|---|
| `armarData` | sí | `lib/services/WebhookEstadoService.ts:235` (`private armarData(...)`) |
| `DataEvento` | sí | `lib/services/WebhookEstadoService.ts:62` (`interface DataEvento`) |
| `API_ORDEN_SELECT` | sí | `lib/repositories/OrdenRepository.ts:207` (`const API_ORDEN_SELECT = {`) |
| `toApiOrdenRow` | sí | `lib/repositories/OrdenRepository.ts:316` (`function toApiOrdenRow(...)`) |
| `toListItemDTO` | sí | `lib/services/ApiOrdenLecturaService.ts:30` — ⚠️ **hay un homónimo** en `lib/repositories/OrdenRepository.ts:774` que NO es este y no se toca |
| `nombreCompletoUsuario` | sí | `lib/utils/nombre-usuario.ts:32` (`export function`) |
| `NOMBRE_USUARIO_SELECT` | sí | `lib/utils/nombre-usuario.ts:15` (`export const`) |

(Las líneas son las del árbol ANTES de esta ficha; después del cambio se corren unas cuantas.)

---

## Archivos creados

| Archivo | Qué es |
|---|---|
| `tests/unit/types/api-mensajero-dto.test.ts` | T1 — la forma del tipo, en ejecución y con `@ts-expect-error` |
| `tests/unit/services/webhook-estado-service.mensajero.test.ts` | T3 — lo que la 404 añade al cuerpo del evento |
| `tests/unit/guards/mensajero-forma-unica.guardia.test.ts` | R5 — las tres superficies dan la misma forma + un solo tipo en `lib/` |
| `tests/unit/api/openapi-404-mensajero.test.ts` | T7 — el contrato publicado (`.ts` y su espejo `.yaml`) |

## Archivos modificados

**Producción (9):**

| Archivo | Cambio |
|---|---|
| `lib/types/api-orden.ts` | T1: `ApiMensajeroDTO` (declarado UNA vez) · T5: `ApiOrdenListItemDTO.mensajero` · T8.3: cabecera acotada |
| `lib/interfaces/repositories/IWebhookOrdenReader.ts` | T2: `DatosEntregaOrden.mensajero`, REQUERIDO (no `?`) |
| `lib/repositories/WebhookOrdenReader.ts` | T2: `mensajeroAsignado` en el `select` del `findUnique` + mapeo con `nombreCompletoUsuario` |
| `lib/services/WebhookEstadoService.ts` | T3: `DataEvento.mensajero`; `armarData` lo escribe tras `motivo` y antes de `evidenciasUrl`; cabecera ampliada con la tercera convención |
| `lib/interfaces/repositories/IOrdenRepository.ts` | T4: `ApiOrdenRow.mensajero` (el detalle lo hereda por `extends`) |
| `lib/repositories/OrdenRepository.ts` | T4: `API_ORDEN_SELECT` gana la relación; `ApiOrdenSelectRow` gana el tipo; `toApiOrdenRow` mapea |
| `lib/services/ApiOrdenLecturaService.ts` | T5: `toListItemDTO` copia el campo · T8.4: cabecera de clase acotada |
| `app/api/ordenes/api-key/orden/[id]/route.ts` | T8.2: **solo comentario** (el «sin PII del mensajero» pasa al patrón fechado) |
| `lib/api/openapi-spec.ts` | T7: `data.mensajero` + `OrdenListItem.mensajero`, los dos en `required`, los dos ejemplos y las dos `description` |

`API_ORDEN_DETALLE_SELECT` **no se tocó** (hereda por el spread), ni el `where`, ni
`incidentesAdmin`, ni `gestiones`, ni ningún controller salvo ese comentario. Ni una migración.

**Documentación y contrato (3):**

- `docs/api/api-key-openapi.yaml` — T7, espejo textual del `.ts`.
- `docs/api/CHANGELOG.md` — T9, entrada fechada `2026-09-09` (aditivo, la forma, `null`, el UUID en
  texto de Q1, «quién la lleva» y el hueco del barrido de Q2/R23, el aviso a clientes con
  `additionalProperties: false`, y las cinco claves de `data`). **Bloquea la release, no el código.**
- `specs/106-api-lectura-ordenes/requirements.md` — T8.1, **ADDENDUM** al final
  (`⏳ 2026-09-09 — R16 ACOTADO por la feature 404`). El texto de R16 **no se tocó**.

**Tests existentes enmendados (11)** — todos con la decisión escrita al lado, ninguno relajado a un
aserto de tamaño ni a `toContain`:

| Archivo | Qué se enmendó |
|---|---|
| `tests/unit/services/webhook-estado-service.test.ts` | los 4 congeladores de `Object.keys(body.data)`: 4→5 claves (5→6 en `incidente`), en el orden nuevo; `DATOS_BASE` gana el campo; bloque R29 ampliado con el caso del mensajero |
| `tests/unit/services/webhook-estado-encolado.test.ts` | R13: el payload del job sigue con 3 claves y ninguna del mensajero |
| `tests/unit/repositories/webhook-orden-reader.test.ts` | fake de Prisma proyecta la relación con el `select` REAL; `toEqual` de R19 gana `mensajero: null`; 5 casos nuevos |
| `tests/unit/repositories/orden-repository.no-regresion-106.test.ts` | `SELECT_DETALLE_106` **enmendado** con bloque fechado, siguiendo el precedente de la 268 |
| `tests/unit/repositories/orden-repository.api-lectura.test.ts` | `toEqual` de la fila pública gana `mensajero` (sigue estructural); 5 casos nuevos |
| `tests/unit/services/api-orden-lectura-service.test.ts` | fixture + 4 casos nuevos |
| `tests/unit/services/api-orden-lectura-service.por-orden-id.test.ts` | el `not.toMatch(/storagePath\|mensajero\|bucket/i)` **acotado** (ver abajo); 4 casos nuevos |
| `tests/unit/services/api-orden-lectura-service.filtros-257.test.ts` | fixture |
| `tests/unit/services/api-pdf-etiqueta-service.test.ts` | fixture |
| `tests/unit/api/openapi-webhook-contrato.test.ts` | `data.required` 4→5, y el aserto invertido «toda propiedad salvo `evidenciasUrl` es requerida» |
| `tests/unit/api/openapi-webhook-estado-actualizado.test.ts` | propiedades 5→6 y `required` 4→5, con la prosa nueva |
| `tests/integration/api/ordenes-api-key-listado.route.test.ts` | fixture + 6 casos nuevos sobre la cadena REAL |
| `tests/integration/api/ordenes-api-key-orden-consulta.route.test.ts` | fixture + la lista de exclusión R18 **ampliada** + 5 casos nuevos sobre la cadena REAL |
| `tests/integration/api/ordenes-api-key-listado-filtros.route.test.ts` | fixture |
| `tests/integration/api/ordenes-api-key-orden-generate.route.test.ts` | fixture |
| `tests/integration/purga-pdf-regenera-177.test.ts` | fixture |

**Dos asertos que prohibían la palabra «mensajero» y hubo que ACOTAR, no borrar.** Los dos vigilaban
tres cosas en una sola línea (`storagePath`, `bucket` y «mensajero»), y las dos primeras siguen
intactas; en lugar de la palabra genérica entran, por su nombre, las cosas que sí siguen prohibidas:
el resto de la PII del asignado (`telefono`, `email`, `cedula`, `vehiculo`, `placa`, `zona`) y todo
lo del mensajero que GESTIONÓ (`mensajeroId`, `mensajeroGestion`, `gestionadaPor`, el texto libre).
Está escrito con su fecha en cada sitio:
`tests/unit/services/api-orden-lectura-service.por-orden-id.test.ts` y
`tests/integration/api/ordenes-api-key-orden-consulta.route.test.ts`.

---

## Mapa `R<n> → test`

Los 25 requisitos tienen al menos un aserto que se pone rojo si el código está mal. Ninguno se cubre
con un `grep` sobre un comentario.

| R | Test (archivo → caso) |
|---|---|
| R1 | `tests/unit/types/api-mensajero-dto.test.ts` → «un valor del tipo tiene EXACTAMENTE las claves ['id','nombre'], en ese orden» + «un objeto con una TERCERA clave no compila» · `tests/unit/services/api-orden-lectura-service.test.ts` → «el objeto `mensajero` del DTO tiene EXACTAMENTE dos claves» |
| R2 | `webhook-orden-reader.test.ts` → «`mensajero` es null —y la clave EXISTE— cuando la orden no tiene asignado» · `webhook-estado-service.mensajero.test.ts` → «sin mensajero la clave VIAJA IGUALMENTE con `null`» · `orden-repository.api-lectura.test.ts` → «`mensajero` es null cuando `mensajero_asignado_id` es NULL» · `openapi-404-mensajero.test.ts` → «los dos ejemplos la llevan: uno con objeto y otro con `null`» |
| R3 | `webhook-orden-reader.test.ts` → «devuelve `{id, nombre}` con el nombre COMPLETO compuesto de las tres columnas» + «una cuenta sin apellidos devuelve solo su nombre» |
| R4 | `webhook-orden-reader.test.ts` → «…el id es el `usuario.id` PROYECTADO, sin derivar, sin hashear y sin formatear» (dentro del caso R3+R4) |
| R5 | `tests/unit/guards/mensajero-forma-unica.guardia.test.ts` → «con mensajero asignado, webhook / listado / detalle dan el MISMO objeto y el MISMO JSON» + «sin mensajero asignado, las tres emiten la CLAVE con `null`» + «`ApiMensajeroDTO` se declara exactamente UNA vez» |
| R6 | `webhook-orden-reader.test.ts` → «el `select` de `mensajeroAsignado` pide EXACTAMENTE id + las tres de identidad» · `orden-repository.api-lectura.test.ts` → «el `select` del listado pide EXACTAMENTE id + las tres columnas de identidad» |
| R7 | `webhook-estado-service.mensajero.test.ts` → «publica el ASIGNADO aunque la orden tenga una gestion de OTRO mensajero» · `webhook-orden-reader.test.ts` → «el mensajero que GESTIONO la orden no se proyecta ni se emite» |
| R8 | `webhook-estado-service.mensajero.test.ts` → «con mensajero asignado, `data.mensajero` es `{id, nombre}` con los valores exactos» |
| R9 | `webhook-estado-service.test.ts` (4 congeladores actualizados) · `webhook-estado-service.mensajero.test.ts` → «en un `incidente`, `evidenciasUrl` sigue siendo la ULTIMA y la unica opcional» · `openapi-404-mensajero.test.ts` → «`evidenciasUrl` sigue siendo la UNICA fuera» |
| R10 | `webhook-estado-service.mensajero.test.ts` → «el orden de `data` es EXACTAMENTE […]» + «dos serializaciones del mismo evento sobre el mismo estado dan el MISMO string» · `openapi-404-mensajero.test.ts` → «`mensajero` va TRAS `motivo` y ANTES de `evidenciasUrl`» |
| R11 | `webhook-estado-service.mensajero.test.ts` → «dos entregas del MISMO eventoId con distinto asignado publican distinto mensajero» + «una orden que PIERDE el asignado entre entregas publica `null` en la segunda» |
| R12 | `webhook-orden-reader.test.ts` → «con mensajero asignado el reader SIGUE haciendo exactamente 2 llamadas a Prisma» (amplía el aserto de 268/R12, no lo duplica) |
| R13 | `webhook-estado-service.test.ts` → «404/R13: con un mensajero asignado, ni su nombre ni su id llegan al logger» (bloque R29 ampliado) · `webhook-estado-encolado.test.ts` → «el payload lleva ordenId/estatusDestinoId/ocurridoAt…» (3 claves, sin `mensajero`) · `webhook-estado-service.mensajero.test.ts` → «el payload del job sigue teniendo 3 claves» |
| R14 | `api-orden-lectura-service.test.ts` → «el DTO del item lleva `mensajero` TAL CUAL lo dio el repo» · `ordenes-api-key-listado.route.test.ts` → «CADA item de la respuesta HTTP trae `mensajero`» |
| R15 | `orden-repository.api-lectura.test.ts` → «una pagina de N ordenes se resuelve con UNA findMany y UN count, sin consulta por item» |
| R16 | `orden-repository.api-lectura.test.ts:81` (`toEqual` estructural, con `mensajero`) · `ordenes-api-key-listado.route.test.ts` → «los nueve campos publicados y `pagination` no cambian de forma» |
| R17 | `ordenes-api-key-listado.route.test.ts` → «`?mensajero=` se IGNORA: misma respuesta y mismo `where` que sin el parametro» · `api-orden-lectura-service.test.ts` → «`mensajero` no llega al repo como criterio» |
| R18 | `orden-repository.api-lectura.test.ts` → «el DETALLE hereda `mensajero` sin que su `select` declare nada propio» · `api-orden-lectura-service.por-orden-id.test.ts` → «sobre el repositorio REAL, el detalle compone el nombre desde las tres columnas» · `ordenes-api-key-orden-consulta.route.test.ts` → «el detalle trae `mensajero`…» |
| R19 | `api-orden-lectura-service.por-orden-id.test.ts` → «el detalle lleva `mensajero` y conserva `evidencias`, incluido el `[]`» · `ordenes-api-key-orden-consulta.route.test.ts` → «el detalle son los nueve publicados + `mensajero` + `evidencias`, y nada mas» |
| R20 | `ordenes-api-key-listado.route.test.ts` → «una orden de OTRO owner sigue sin aparecer, y su mensajero tampoco» · `ordenes-api-key-orden-consulta.route.test.ts` → «una orden de OTRO owner sigue dando 404, y su mensajero no se filtra» |
| R21 | `webhook-orden-reader.test.ts` → «el TEXTO LIBRE `gestion_orden.motivo` no se proyecta siquiera» (existente) + «el mensajero que GESTIONO la orden no se proyecta ni se emite» · los dos casos «no lleva … el texto libre de la gestion» del listado y del detalle |
| R22 | `orden-repository.no-regresion-106.test.ts` → literal congelado enmendado · `orden-repository.api-lectura.test.ts` → «el detalle no proyecta el mensajero de la gestion ni su texto libre» · `ordenes-api-key-orden-consulta.route.test.ts` → lista de exclusión R18 ampliada |
| R23 | `orden-repository.api-lectura.test.ts` → «`mensajero` es null cuando `mensajero_asignado_id` es NULL» · `ordenes-api-key-listado.route.test.ts` / `...orden-consulta...` → «sin asignado … `mensajero: null`» |
| R24 | `openapi-404-mensajero.test.ts` → los 3 bloques de forma + `required` + ejemplos (10 casos) |
| R25 | `openapi-404-mensajero.test.ts` → «ninguna description publicada dice ya “sin ids internos ni PII de terceros” a secas» + «ninguna description dice que el canal excluye al mensajero sin acotarlo» + «el `.yaml` tampoco…» · **y verificación humana del reviewer** sobre los cuatro diffs de T8 (`specs/106/requirements.md`, el route handler, `lib/types/api-orden.ts` y la cabecera de `ApiOrdenLecturaService`), que es lo que `tasks.md` exige: no se acepta un criterio de `grep` sobre esos textos |

---

## Gate

`./init.sh` **COMPLETO** (no `--rapido`): el diff toca `lib/types/api-orden.ts`, así que el modo
rápido se niega solo y manda al completo (`docs/verification.md`).

Log: `scratchpad/gate-404.log` (no canalizado por `tail`; el `INIT_EXIT` se escribe DENTRO del log).

```
Test Files  1741 passed | 109 skipped (1850)
     Tests  25542 passed | 1342 skipped (26884)
  Duration  601.39s

✓ tests: sin rojos nuevos (0 archivo(s) rojo(s) sobre 1850 ejecutado(s), todos en el baseline conocido)
! migraciones sin down.sql: 20260814120000_ruta_optimizada_trazado 20260814140000_ruta_parada_tramo 20260814160000_ruta_tramo_vivo_at
! no hay .env. Crea uno a partir de .env.example
! recuerda: este verde NO incluye los 152 archivos de tests contra Postgres (sin DATABASE_URL se saltaron).
== init OK ==
INIT_EXIT=0
```

`pnpm run typecheck` → 0 errores. `pnpm run lint` → **0 errores**, 183 warnings, todos
`no-unused-vars` preexistentes en archivos ajenos a esta ficha.

### Los `skipped`, mirados uno a uno (no solo el exit code)

**152 archivos de `integration/db` se saltaron** por no haber `.env` en el worktree —lo normal
según `docs/verification.md`, y no se copia a propósito—. **Ninguno de ellos cubre esta ficha**, y
eso está medido, no supuesto: los **16 archivos** que tocan o cubren la 404 aparecen todos con `✓`
en el log, ninguno con `↓`.

```
✓ tests/unit/types/api-mensajero-dto.test.ts (7 tests)
✓ tests/unit/guards/mensajero-forma-unica.guardia.test.ts (6 tests)
✓ tests/unit/services/webhook-estado-service.mensajero.test.ts (11 tests)
✓ tests/unit/api/openapi-404-mensajero.test.ts (20 tests)
✓ tests/unit/services/webhook-estado-service.test.ts (67 tests)
✓ tests/unit/services/webhook-estado-encolado.test.ts (16 tests)
✓ tests/unit/repositories/webhook-orden-reader.test.ts (24 tests)
✓ tests/unit/repositories/orden-repository.api-lectura.test.ts (16 tests)
✓ tests/unit/repositories/orden-repository.no-regresion-106.test.ts (7 tests)
✓ tests/unit/services/api-orden-lectura-service.test.ts (8 tests)
✓ tests/unit/services/api-orden-lectura-service.por-orden-id.test.ts (13 tests)
✓ tests/unit/services/api-orden-lectura-service.filtros-257.test.ts (8 tests)
✓ tests/unit/api/openapi-webhook-contrato.test.ts (15 tests)
✓ tests/unit/api/openapi-webhook-estado-actualizado.test.ts (6 tests)
✓ tests/integration/api/ordenes-api-key-listado.route.test.ts (15 tests)
✓ tests/integration/api/ordenes-api-key-orden-consulta.route.test.ts (19 tests)
```

Esta ficha **no toca la capa SQL** —no hay migración, no hay `where` nuevo, no hay consulta cruda—,
así que el hueco de `integration/db` no deja nada de la 404 sin medir. Lo que sí depende del `select`
de Prisma (la proyección `mensajeroAsignado`) se prueba **donde vive**, sobre el `select` REAL
capturado del mock, no sobre un doble del servicio.

Los tres avisos de `down.sql` faltante son deuda preexistente de tres migraciones de agosto, ajenas
a esta ficha (no se ha creado ninguna migración aquí).

---

## Mutaciones probadas — cuáles murieron y cuál sobrevivió

Cada test nuevo se mató con una mutación de **código de producción** antes de creérselo. Los
archivos se respaldaron y se restauraron; `grep -rn MUTACION lib/ app/` vuelve limpio y el
typecheck queda en verde.

| # | Mutación | Resultado |
|---|---|---|
| M1 | `WebhookOrdenReader`: quitar `mensajeroAsignado` del `select` | **MUERTA** — 5 rojos en `webhook-orden-reader.test.ts` (R3, R4, R6, R12, R7/R21) |
| M2 | `armarData`: sacar `mensajero` del literal y asignarlo con `data.mensajero = …` **antes** del bloque de `evidenciasUrl` | **SOBREVIVIÓ, y es correcto que sobreviva** — ver abajo |
| M2b | lo mismo, pero asignándolo **después** de `evidenciasUrl` | **MUERTA** — 2 rojos: `404/R9` (`mensajero` antes de `evidenciasUrl`) y el congelador de claves de `268/R24` |
| M3 | `armarData`: publicar el mensajero solo si `estado === "entregada"`, `null` en el resto | **MUERTA** — 7 rojos (R8, R10, R11 ×2, R7 y 2 de la guardia de forma única) |
| M4 | `toApiOrdenRow`: publicar `r.mensajeroAsignado.nombre` en vez de `nombreCompletoUsuario(...)` | **MUERTA** — 7 rojos en 5 archivos, incluidos los dos bordes HTTP y la guardia |
| M5 | `API_ORDEN_SELECT`: añadir `telefono: true` a la proyección del mensajero | **MUERTA** — 3 rojos: R6 del listado, R21/R22 del detalle y el literal congelado `SELECT_DETALLE_106` |
| M6 | `ApiOrdenLecturaService.toListItemDTO`: devolver `mensajero: null` en vez de copiar el campo (el «composition root que no inyecta») | **MUERTA** — 9 rojos en 5 archivos, incluidos los dos bordes HTTP y la guardia |
| M7 | `openapi-spec.ts`: quitar `mensajero` de `data.required` | **MUERTA** — 4 rojos, incluido el de paridad TS↔YAML |
| M8 | `openapi-spec.ts`: devolver la frase «sin ids internos ni PII de terceros» a la `description` de `OrdenListItem` | **MUERTA** — 1 rojo: «ninguna description publicada dice ya … a secas» (R25) |

**Sobre M2, la única superviviente, y por qué NO es un agujero.** La mutación movía la *línea* pero
no el *orden de inserción de la clave*: al asignarse antes del bloque de `evidenciasUrl`, el objeto
serializado sale idéntico byte a byte. No es un cambio observable, así que ningún test **puede**
detectarlo sin afirmar sobre el texto del código en vez de sobre el comportamiento —que es
justamente lo que esta ficha prohíbe—. M2b es la misma mutación hecha observable, y muere.

**Otra observación honesta:** la guardia de forma única **no** detecta M1, porque su fake de Prisma
devuelve la relación sin aplicar el `select`. Es deliberado: la guardia mide **igualdad de forma
entre superficies**, y quien vigila el `select` es `webhook-orden-reader.test.ts`, que sí mata M1.

**Trampas del repo, cubiertas explícitamente:**

- *Aserción contra su propia fuente*: el nombre esperado se escribe **a mano**
  (`"Carlos Jimenez Mora"`) en los siete sitios donde se afirma. En ninguno se compara contra
  `nombreCompletoUsuario(...)`. M4 lo confirma: si se comparara contra su fuente, M4 habría
  sobrevivido.
- *El composition root que no inyecta*: los casos de los dos bordes HTTP montan la **cadena real**
  (`route handler → ApiOrdenLecturaService → OrdenRepository → Prisma mockeado`) en vez del service
  falso que ya había, y la guardia hace lo mismo con `WebhookOrdenReader → WebhookEstadoService`.
  M6 —el modo de fallo exacto: el módulo importa el dato pero nadie lo pasa— muere en 9 sitios.
- *Los dobles no ven el SQL*: todo lo que depende del `select` de Prisma se afirma sobre el `select`
  **REAL capturado del mock** (`argOrden(prisma).select.mensajeroAsignado`,
  `prisma.orden.findMany.mock.calls[0][0].select`), y el fake del reader **proyecta** la fila cruda
  con ese `select`, de modo que pedir una columna de más la deja pasar y el aserto de R6 se pone
  rojo (M5).
- *Literal: contrato o polizón*: los cinco literales congelados que esta ficha rompía
  (`SELECT_DETALLE_106`, los cuatro `Object.keys(body.data)`, el `toEqual` de la fila pública, los
  dos de OpenAPI) **son el contrato**: se enmiendan con su bloque fechado y siguen siendo igualdades
  exactas. Ninguno pasó a `toContain`, a `toMatchObject` ni a un aserto de longitud.

---

## Lo que queda abierto

1. **T9 bloquea la release, no el código.** La entrada del CHANGELOG está escrita y commiteada, pero
   **el aviso a los integradores hay que MANDARLO** antes de desplegar: el texto de la entrada *es*
   el aviso (se copia y se manda). En particular a quien tenga validación estricta de esquema.
2. **Q1 sigue sin confirmar con el integrador**: el `id` es un UUID en **texto**, no el entero `123`
   de su ejemplo. Va escrito en el CHANGELOG y en las dos `description` del contrato; queda pedirle
   acuse.
3. **Q2 sigue abierta y es decisión del humano**: una orden barrida por el corte diario o recuperada
   a bodega sale con `mensajero: null` aunque alguien la llevara, así que el «censo diario» sobre
   histórico tendrá huecos. Se declara en el CHANGELOG y en el contrato; se cierra en la **405**, no
   aquí.
4. **Q3 se implementó con la decisión por defecto D0**: la excepción se aplica **igual a los dos
   modelos de propiedad** (key con cuenta dedicada y key apuntada a tienda real), porque el
   destinatario es en ambos casos el dueño de la orden. Si el humano prefiere acotarla al owner
   `adminTienda`, es una condición extra en un solo sitio (`toListItemDTO` / `armarData`) y hay que
   decirlo antes de la release.
5. **Verificación humana pendiente del reviewer**, tal y como `tasks.md` la declara y sin sustituto
   automático: (a) la equivalencia palabra por palabra entre `lib/api/openapi-spec.ts` y
   `docs/api/api-key-openapi.yaml` (no hay comparador entre los dos artefactos); (b) los cuatro
   diffs de T8. Los asertos de `openapi-404-mensajero.test.ts` cubren la estructura del espejo
   (propiedad, `required`, ejemplos, frases clave), no su redacción entera.
6. **Los 152 archivos de `integration/db` no se ejecutaron** (worktree sin `.env`). Ninguno cubre
   esta ficha —no hay migración ni SQL nuevo— pero conviene que la corrida post-merge sobre `dev`,
   con base, lo confirme.
7. **Sin E2E**: el repo no tiene harness de Playwright vivo y esta ficha es backend puro sin
   pantalla. No aplica.
8. **Observación heredada del design §9.5, FUERA DE ALCANCE y NO tocada aquí:** `evidenciasUrl` se
   construye con `orden.id` mientras que `ApiOrdenResolucionService.resolver` solo casa por
   `num_guia` o `num_remision`, de modo que un `GET` a ese enlace parece devolver 404. No lo rompió
   la 404 y no se investiga en esta ficha.

---

**Veredicto:** el campo `mensajero` viaja aditivo y con la misma forma en las tres superficies, los
25 requisitos tienen test que se pone rojo con una mutación real, y `./init.sh` completo termina con
`INIT_EXIT=0` y sin rojos nuevos sobre el baseline.
