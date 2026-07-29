# Design — Feature 159: quitar la sugerencia de mensajeros de la carga masiva

> Retiro de código. El diseño no es "qué construir" sino **qué se borra, en qué
> orden, y qué NO se puede borrar por arrastre**.

---

## §0 — Superficie verificada (correcciones y ampliaciones a la ficha)

La ficha declara "20 archivos". Se verificó archivo por archivo en el worktree. Tres
afirmaciones de la ficha **son incorrectas o están obsoletas** y hay **8 archivos que
la ficha no lista** y sí hay que tocar.

### §0.1 Correcciones a la ficha

| # | La ficha dice | Verificado en el código | Consecuencia |
|---|---|---|---|
| C1 | `IAsignabilidadCoordenadasService` es "la sugerencia por cercanía de coordenadas" | **No lo es.** Es el *gate de asignabilidad* (feature 92/93) que usan los **writers de `mensajero_asignado_id`**. Su propia cabecera (`:6-9`) dice que `asignarMensajeroSugerido` queda **FUERA a propósito**. | **NO se retira** (R21). Solo se limpia el comentario `:6-9`, que cita un método que dejará de existir. |
| C2 | Hay que quitar `mensajero_sugerido_id` de `ORDENES_BULK_FIELDS` | **Ya no está.** La feature 142 dejó la plantilla en 8 columnas (`carga-masiva-fields.ts:13-30`) y ninguna es esa. `tests/integration/carga-masiva-plantilla-roundtrip.test.ts:31-44` ya lo blinda. | Nada que hacer. No se toca la plantilla ni su test. |
| C3 | El paso "Sugerir asignación" inyecta el mensajero elegido en la carga | La inyección global **ya está muerta**: `OrdenesCargaMasivaButton.handleConfirmar` (`:167-171`) **no pasa** `mensajeroSugeridoId`; el único caller que lo pasa es el **dry-run** de `OrdenesCargaUpload.tsx:131`, y lo pasa como `""`. | `aplicarMensajero` es código muerto hoy. Se borra sin análisis de impacto. |

### §0.2 Superficie que la ficha no lista

| Archivo | Qué hay | Capa |
|---|---|---|
| `db/schema.prisma:113` | `Usuario.ordenesMensajeria` — lado **inverso** de la relación (R4) | datos |
| `lib/interfaces/repositories/IOrdenRepository.ts` | `:12`, `:28` (`CreateOrdenData.mensajeroSugeridoId`), `:458` (`findMensajerosByIds`), `:490-505` (bloque feature 16), `:540` (referencia cruzada desde `findMensajeroIdsValidos`) | backend |
| `lib/repositories/OrdenRepository.ts` | `:161`, `:236`, `:324-325`, `:335-343`, `:364-400`, `:579`, `:1037`, `:1057-1065`, `:1071` | backend |
| `lib/interfaces/repositories/IUserRepository.ts` + `lib/repositories/UserRepository.ts` | importan `MensajeroDTO` desde `lib/types/asignacion-mensajero.ts` (archivo que se renombra) | backend |
| `lib/interfaces/services/IUsuariosPorRolService.ts:6` | comentario "patrón `IAsignacionMensajeroService`" | backend |
| `app/(app)/ordenes/_components/OrdenesListado.tsx` | `:23`, `:69-71` (`ESTADOS_MENSAJERO_SUGERIDO`), `:353-358` | frontend |
| `app/(app)/ordenes/_components/OrdenesCargaMasivaButton.tsx` | `:43`, `:45`, `:51`, `:58`, `:192`, `:250-255` (paso `asignacion`) | frontend |
| `app/(app)/ordenes/_components/OrdenesCargaUpload.tsx:131` | `mensajeroSugeridoId: ""` del dry-run | frontend |
| `docs/api/api-key-openapi.yaml:507-509` | espejo textual del OpenAPI | contrato |

**Recuento real:** ~20 archivos de producción + 2 migraciones nuevas + 13 archivos de
test tocados.

### §0.3 Lo que expresamente NO se toca

- `tests/integration/db/carga-masiva-schema.test.ts` — asserta el **texto** de la
  migración histórica `20260710000000_carga_masiva_ordenes`, que es inmutable y sigue
  siendo cierta. **Cero diff.** (A diferencia de los enums de la 154/158, un `DROP
  COLUMN` no obliga a reescribir `down.sql` previos: el suyo usa `IF EXISTS`.)
- `IUserRepository.listMensajeros` / `UserRepository.listMensajeros` / `MensajeroDTO`:
  los consume `RankingService.ts:64`. Sobreviven (solo cambia de dónde se importa el
  tipo, §2.4).
- `findMensajeroIdsValidos` / `findAllMensajeros` (feature 17): son los del camino de
  **asignación**, no de la sugerencia.

---

## §1 — Modelo de datos

### §1.1 Prisma (`db/schema.prisma`)

Se retiran tres declaraciones en `Orden` y una en `Usuario`:

- `Orden.mensajeroSugeridoId` (`:466`)
- `Orden.mensajeroSugerido` — relación `OrdenMensajeroSugerido` (`:493`)
- `@@index([mensajeroSugeridoId])` (`:507`)
- `Usuario.ordenesMensajeria` (`:113`)

Tras editar el schema hay que **regenerar el cliente Prisma** antes de creer cualquier
error de typecheck (deuda conocida del repo: un cliente stale da falsos negativos).

### §1.2 Migración

Carpeta nueva `db/migrations/<timestamp>_drop_orden_mensajero_sugerido/`, con
`timestamp` **posterior** a la última migración del lote 153–156.

`migration.sql` (UP) — orden obligatorio FK → índice → columna:

```sql
ALTER TABLE "orden" DROP CONSTRAINT IF EXISTS "orden_mensajero_sugerido_id_fkey";
DROP INDEX IF EXISTS "orden_mensajero_sugerido_id_idx";
ALTER TABLE "orden" DROP COLUMN IF EXISTS "mensajero_sugerido_id";
```

`down.sql` (DOWN) — orden inverso, restituye estructura:

```sql
ALTER TABLE "orden" ADD COLUMN IF NOT EXISTS "mensajero_sugerido_id" TEXT;
CREATE INDEX IF NOT EXISTS "orden_mensajero_sugerido_id_idx" ON "orden"("mensajero_sugerido_id");
ALTER TABLE "orden" ADD CONSTRAINT "orden_mensajero_sugerido_id_fkey"
  FOREIGN KEY ("mensajero_sugerido_id") REFERENCES "usuario"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
```

**El `down.sql` lleva una advertencia explícita en cabecera:** restituye la
estructura, **no los valores** — tras el rollback la columna vuelve con todo `NULL`.
Es el mismo criterio de honestidad que el `down.sql` de la 20260710000000 usa para
`peso` (avisa en vez de corromper en silencio). Ver Pregunta abierta Q5.

**RLS:** `orden` tiene RLS habilitada **sin policies** desde
`20260709130100_ordenes` (acceso solo por service role). Ninguna policy referencia la
columna, así que el `DROP` no altera la postura de seguridad. No se añade ni se quita
policy alguna.

### §1.3 Datos en producción

El `DROP` corre en el deploy de producción. Los valores se pierden. No hay backfill
inverso posible. Decisión pendiente en Q5.

---

## §2 — Backend: servicios, interfaces, repositorio

### §2.1 `BulkOrdenService.ts`

Se retiran:

- el tipo `MensajeroResult` (`:214-216`) y la función `resolveMensajero` (`:218-228`);
- `PreloadedContext.mensajerosValidos` (`:235`);
- la llamada `this.repo.findMensajerosByIds(mensajeroIds)` de `precargar` (`:584`) y
  el cálculo de `mensajeroIds` (`:564-566`). El `Promise.all([distritos,
  mensajerosValidos])` (`:582-585`) colapsa a un `await` simple de `findDistritosByCantonIds`;
- en `procesarFila` (`:505-518`): la llamada a `resolveMensajero`, su rama de
  `fieldErrors` y la constante `mensajeroSugeridoId`;
- `createData.mensajeroSugeridoId` (`:554`).

**Efecto sobre el contrato de fila (R5/R6):** al quitar `mensajero_sugerido_id` de
`filaCargaSchema` (`lib/types/carga-masiva.ts:96-101`), la clave pasa a ser una clave
desconocida. Como el schema **no es `.strict()`** (ancla explícita de la feature 143,
comentario `:66-72`), zod la descarta en silencio. **No hace falta escribir nada para
"ignorarla": es el comportamiento por defecto**, y está blindado por
`tests/integration/carga-masiva-errores-roundtrip.test.ts`.

### §2.2 Repositorio

`IOrdenRepository` + `OrdenRepository` — se retiran por quedar sin consumidor de
producción (R20):

| Método | Consumidores hoy | Tras el retiro |
|---|---|---|
| `asignarMensajeroSugerido` | `AsignacionMensajeroService` | 0 → se borra |
| `countOrdenesDeTienda` | `AsignacionMensajeroService` (guard todo-o-nada) | 0 → se borra |
| `findMensajerosByIds` | `BulkOrdenService.precargar` + `AsignacionMensajeroService` | 0 → se borra |
| `findResumenByNumRemisiones` | `AsignacionMensajeroService.resumenCargaMasiva` | **sobrevive** (§5), sin los dos campos de sugerido |

Además: `CreateOrdenData.mensajeroSugeridoId` (`:28`) se borra (R8); el `include` y el
mapeo del listado (`:236`, `:324-325`, `:343`) pierden `mensajeroSugerido`; los
`create` (`:579`, `:1037`) pierden el campo; y el doc-comment de
`findMensajeroIdsValidos` (`:540`) deja de citar `findMensajerosByIds` (referencia
cruzada a un método borrado).

### §2.3 Servicio y Server Action

`AsignacionMensajeroService` pierde **dos de sus tres** métodos y con ellos su nombre
deja de ser cierto. Se renombra en lugar de dejar un nombre que miente:

| Antes | Después | Contenido |
|---|---|---|
| `lib/services/AsignacionMensajeroService.ts` | `lib/services/ResumenCargaMasivaService.ts` | solo `resumenCargaMasiva` |
| `lib/interfaces/services/IAsignacionMensajeroService.ts` | `lib/interfaces/services/IResumenCargaMasivaService.ts` | solo `ResumenCargaMasivaServiceResult` + el método |
| `lib/actions/mensajeros.ts` | `lib/actions/carga-masiva-resumen.ts` | solo `resumenCargaMasiva` |

Se borran: `listarMensajeros` (su único consumidor era el select del resumen; el
repositorio subyacente sobrevive para `RankingService`), `asignarMensajeroSugerido`
(R19), `ListarMensajerosServiceResult`, `AsignarMensajeroSugeridoServiceResult`,
`ListarMensajerosResult`, `AsignarMensajeroSugeridoResult`, y el helper `distinct` del
service si queda sin uso.

### §2.4 Tipos

| Archivo | Acción |
|---|---|
| `lib/types/asignacion-mensajero.ts` | Renombrado a `lib/types/carga-masiva-resumen.ts`. Conserva `ResumenCargaOrdenDTO` (**sin** `mensajeroSugeridoId` ni `mensajeroSugeridoNombre`), `resumenCargaSchema`, `ResumenCargaInput`. Borra `asignarMensajeroSchema` y `AsignarMensajeroInput`. |
| `lib/types/mensajero.ts` (**nuevo**) | Recibe `MensajeroDTO`, que sobrevive por `IUserRepository`/`RankingService` y que no pertenece ya a la carga masiva. |
| `lib/types/orden.ts` | Borra `OrdenListItemDTO.mensajeroSugeridoId` (`:152`) y `OrdenListItemRelaciones.mensajeroSugerido` (`:208`); actualiza los comentarios `:138-143`. |
| `lib/types/carga-masiva.ts` | Borra el campo `mensajero_sugerido_id` de `filaCargaSchema` (`:96-101`). **No** convertir el objeto en `.strict()` (ancla de la 143). |

---

## §3 — Rutas, endpoints y contratos de E/S

**No se crea ni se elimina ninguna ruta.** Los contratos afectados:

| Superficie | Antes | Después |
|---|---|---|
| `POST /api/ordenes/carga-masiva/chunk` (interno) | acepta `mensajero_sugerido_id` por fila y **falla la fila** si el id no es un mensajero | acepta la clave y la descarta; la fila se crea (R5/R6) |
| `POST` de carga por API key (feature 88) | ídem | ídem, mismo HTTP y mismo `RowResult` (R9) |
| Server Action `listarMensajeros` | existía | **eliminada** |
| Server Action `asignarMensajeroSugerido` | existía | **eliminada** (R19) |
| Server Action `resumenCargaMasiva` | devuelve `ResumenCargaOrdenDTO[]` con 2 campos de sugerido | mismos campos **menos** esos 2 |
| `OrdenListItemDTO` (listado) | trae `mensajeroSugeridoId` + `relaciones.mensajeroSugerido` | sin ambos |

**El cambio es estrictamente más permisivo:** ninguna petición que hoy tiene éxito
pasa a fallar. La única que cambia de resultado es la que hoy **falla** por un id de
mensajero inválido y a partir de ahora se crea.

---

## §4 — Contrato público de integradores (Pregunta abierta Q1)

### Hechos verificados

1. `filaCargaSchema` **no es `.strict()`** — decisión anclada por la feature 143 para
   que el round-trip "exportar errores → corregir → volver a subir" sobreviva. Toda
   clave desconocida se descarta en silencio.
2. `CargaRow` en `openapi-spec.ts:484` ya declara `additionalProperties: { type: "string" }`:
   enviar la clave **sigue siendo válido según el propio documento publicado**.
3. Hoy un `mensajero_sugerido_id` inválido **hace fallar la fila**
   (`BulkOrdenService:221-226`). Tras el retiro esa fila se crea.

**Conclusión: en runtime no hay breaking change en ninguna de las dos ramas.** "Aceptar
e ignorar" no cuesta una sola línea de código: es lo que pasa por defecto. Lo único que
se decide es **qué dice la documentación**.

### Opciones

| | Opción | Efecto | Coste |
|---|---|---|---|
| **a** | Borrar la propiedad de `CargaRow` | El integrador sigue pudiendo enviarla (`additionalProperties`), pero **sin ninguna señal** de que dejó de tener efecto | 0 |
| **b** | `deprecated: true` + descripción "aceptado e ignorado por el servidor" | Informa el cambio semántico en el sitio donde el integrador mira | 2 líneas, en 2 artefactos |
| **c** | Dejarla como está | El documento **miente**: promete un efecto que ya no ocurre | 0 |
| **d** | Rechazar la clave con `400` / `resultado: "error"` | Rompe a los integradores que hoy la envían con éxito | alto + contradice el ancla de la 143 |

### Recomendación

**(b) ahora, (a) en una limpieza posterior.**

Razón: la ruptura real para un integrador no es de forma sino **de semántica** —el
campo sigue siendo aceptado y deja de hacer algo. (a) y (c) dejan esa ruptura
silenciosa: con (a) el integrador ni se entera de que borramos la promesa, con (c) le
seguimos prometiendo. (b) es la única que lo dice, cuesta dos líneas y no exige
coordinación con nadie. (d) queda descartada en §6/A4.

**Artefactos:** `lib/api/openapi-spec.ts:479-482` (fuente de verdad) y
`docs/api/api-key-openapi.yaml:507-509` (espejo textual). Deben quedar idénticos (R11).

**Decide la puerta F1.4.** Si el humano elige (a), R10 se sustituye por "el documento
OpenAPI publicado NO DEBE declarar la propiedad `mensajero_sugerido_id`" y el guard de
R18 pierde su whitelist para esos dos archivos.

---

## §5 — Frontend

### §5.1 El resumen del lote sobrevive, en solo lectura

`OrdenesCargaResumen.tsx` conserva **una sola** responsabilidad: mostrar en una tabla
las órdenes recién creadas. Se retiran: el import y la llamada a `listarMensajeros`,
`mensajerosState`, `seleccion`, `seleccionInicial` (**con su `Math.random`**, R14),
`opcionesPorZona`, `toMensajeroOptions`, `SIN_ASIGNAR_LABEL`, `handleRowChange`,
`handleConfirmar`, `submitting`/`submittingRef`, el `Alert` de error de mensajeros, la
columna `mensajero`, el botón "Sugerir asignación" (R13) y el `useSWRConfig`/`mutate`
(no queda mutación que revalidar; el listado ya se revalida tras la carga real en
`OrdenesCargaMasivaButton:185-189`).

La prop `onDone` **se retira**: sin botón de confirmación no queda disparador, y el
`Modal` ya cierra con su propio botón (`hideCancel` + `confirmLabel="Cerrar"`,
`OrdenesCargaMasivaButton:231-232`). El `useEffect` de carga pasa de `Promise.allSettled`
de dos acciones a un `await` de `resumenCargaMasiva`.

**El componente conserva su nombre** (sigue siendo un resumen): renombrarlo obligaría a
tocar tres archivos más sin ganar precisión.

### §5.2 Modal de carga masiva

`OrdenesCargaMasivaButton.tsx`: el tercer paso deja de ser "asignación" y pasa a ser
**resultado** (R15). `Step` cambia `"asignacion"` → `"resultado"`; la etiqueta del
indicador pasa de "Asignar mensajero" a "Resultado"; `PASO_DESCRIPCION` pasa de
"Asigna un mensajero a las órdenes recién creadas." a un texto de solo lectura;
`setStep("asignacion")` (`:192`) y el render (`:250-255`) se ajustan y dejan de pasar
`onDone`.

`OrdenesCargaUpload.tsx:131`: se borra `mensajeroSugeridoId: ""` del dry-run.

### §5.3 Envío por chunks

`carga-masiva-chunks.ts`: se borran `aplicarMensajero` (`:46-54`) y
`ProcesarChunksOpts.mensajeroSugeridoId` (`:59`); en `procesarEnChunks` (`:88`)
`rows` pasa a ser `lote.map((f) => f.row)`. Chunking, dedup, remapeo de línea y
`ChunkRequestError` quedan intactos (R22 a/b/c).

### §5.4 Listado de órdenes

`ordenes-columns.tsx`: se borran `mensajeroSugeridoColumn` (`:184-189`) y
`ordenesColumnsMensajeroSugerido` (`:197-200`); la columna `mensajero` (`:162-170`)
pierde el fallback al sugerido y queda
`row.relaciones?.mensajeroAsignado?.nombre ?? SIN_DATO` (R16/R17).

`OrdenesListado.tsx`: se borran `ESTADOS_MENSAJERO_SUGERIDO` (`:69-71`), su import
(`:23`) y su rama (`:353-358`), que colapsa a
`const columns = valueUnico === ESTADO_REPROGRAMADA ? ordenesColumnsReprogramada : undefined`.
Nota de coordinación: ese `Set` cita `en_fulfillment`, que la **155** retira — si la
155 llega antes, parte de este diff ya estará hecho.

### §5.5 `GenerarGuiaModal.tsx` — verificar, no asumir

La **156** ya le quita el selector de mensajero. Lo que 159 debe garantizar es que no
quede el **agrupado por sugerido**: `seleccionInicial` (`:39-46`), `conSugerido` /
`sinSugerido` (`:130-131`) y los dos bloques "Con/Sin mensajero sugerido"
(`:249-270`). La task correspondiente se cierra **con evidencia de grep**: si la 156 ya
lo dejó limpio, se cierra "sin diff" y se documenta; nunca se asume.

---

## §6 — Alternativas descartadas

**A1 — Dejar la columna en la base y limitarse a no escribirla ("deprecar en caliente").**
Descartada. El criterio de éxito de esta feature es que **no quede rastro muerto ni
tipos huérfanos**; una columna viva sin escritor reaparece en cada `include` de Prisma,
en cada DTO y en cada `select`, y el próximo lector la creerá vigente. Peor: con el
flujo v2 el dato pasa a ser **falso** (una orden ya no "sugiere" mensajero), así que
conservarlo es conservar una mentira consultable. Coste aceptado: el `DROP` no es
reversible en datos (Q5).

**A2 — Reciclar `mensajero_sugerido_id` como "mensajero preferido de la tienda".**
Descartada. Nadie lo pidió, no hay requisito que lo respalde y el flujo v2 asigna
**siempre desde una bodega**. Sería inventar un supuesto (regla 6 de `CLAUDE.md`).

**A3 — Borrar el paso de resumen entero (componente + Server Action + `findResumenByNumRemisiones`).**
Descartada. El resumen del lote es la feature 16/**R6**; la sugerencia es la feature
16/**R12–R18**. Son capacidades distintas que comparten archivo. El resumen es la única
confirmación visual de qué se cargó tras subir un archivo de cientos de filas, y es el
punto del que la feature 148 cuelga el manifiesto. Borrarlo sería **pérdida de función
disfrazada de limpieza**, no retiro de la sugerencia. (Reabrible por el humano: Q2.)

**A4 — Retirar el campo del contrato público con rechazo duro (`400` o `resultado: "error"` si viene).**
Descartada. Convierte un retiro interno en un **breaking change real** para integradores
que hoy envían el campo con éxito, y contradice frontalmente el ancla de la feature 143
(`filaCargaSchema` deliberadamente no-`.strict()`), que existe para que las claves
desconocidas se descarten en silencio. Habría que añadir código **para romper**.

**A5 — Vaciar los tests afectados en vez de adaptarlos.**
Descartada. Trece archivos de test tocan la sugerencia, pero solo **cinco** la tienen
como asunto; en el resto es una clave de fixture que convive con asserts de otras
features (dedup por remisión, encadenado a etiquetas, manifiesto, autorización por rol).
Borrarlos sería cobertura perdida por la puerta de atrás. §7 fija archivo por archivo
qué se borra y qué se adapta, y R22 lo hace verificable.

---

## §7 — Plan de tests: qué se borra y qué se adapta

> Regla: **un test se borra solo si su único asunto es la sugerencia.** Si comparte
> archivo con otros asuntos, se adapta y sus asserts ajenos se conservan (R22).

### Tests que se adaptan (el asunto sobrevive parcialmente)

| Archivo (hits) | Qué se conserva | Qué se borra |
|---|---|---|
| `tests/unit/services/asignacion-mensajero-service.test.ts` (17) → renombrar a `resumen-carga-masiva-service.test.ts` | los casos de `resumenCargaMasiva` (forbidden por rol, acotado a la tienda del actor) — R22(d)(g) | los de `listarMensajeros` y los 6 de `asignarMensajeroSugerido` |
| `tests/integration/actions/mensajeros-action.test.ts` (22) → renombrar a `carga-masiva-resumen-action.test.ts` | `unauthenticated`, `validation_error` y `ok` de `resumenCargaMasiva` — R22(g) | los de las otras dos acciones |
| `tests/unit/repositories/orden-repository.asignacion.test.ts` (16) | los 5 `describe` de `findResumenByNumRemisiones` (ajustando el `select` esperado) — R22(d) | los `describe` de `asignarMensajeroSugerido` y `countOrdenesDeTienda` |
| `tests/components/OrdenesCargaResumen.test.tsx` (24) | columnas de datos, estados loading/error, mensaje de lote vacío — R22(d) | select por fila, preselección al azar, submit y toasts de asignación |
| `tests/components/CargaMasivaChunks.test.ts` (7) | chunking, dedup, remapeo de línea, `ChunkRequestError` — R22(a)(b)(c) | el caso "inyecta el mensajero sugerido del lote…" y la opción en los otros 3 |
| `tests/unit/services/bulk-orden-service.test.ts` (9) y `.carga-api.test.ts` (2) | todo lo demás | el caso "mensajero inválido → error de fila", **sustituido** por su inverso (R5/R6); y `findMensajerosByIds` de los mocks |
| `tests/unit/repositories/orden-repository.bulk.test.ts` (2) | el resto del archivo | el `describe` de `findMensajerosByIds` (el método desaparece) |
| `tests/components/GenerarGuiaModal.test.tsx` (24) | agrupado GAM/no-GAM y encadenado a etiquetas/manifiesto — R22(e) | lo que quede del agrupado por sugerido tras la 156 |
| `tests/unit/repositories/orden-repository.test.ts` (10) | mapeo del listado | los asserts sobre `mensajeroSugerido` en el `include`/mapeo |

### Tests de ajuste mecánico (solo nombran el campo en fixtures/mocks; **cero asserts perdidos**)

`OrdenesApartado.test.tsx` (1), `OrdenesListadoBloqueoCierre.test.tsx` (1),
`OrdenesListadoEtiquetasChain.test.tsx` (1), `OrdenesRevisionMaestro.test.tsx` (1),
`OrdenesCargaResumenPaso.test.tsx` (6), `ManifiestoFlujos.test.tsx` (4) — R22(e)(f),
`orden-geocode-enqueue.test.ts` (1), `orden-historial-cobertura.test.ts` (2),
`etiqueta-guia-service.test.ts` (1), `guia-asignacion-service.test.ts` (4),
`orden-service.test.ts` (1), `rol-admin-satelite-authz.test.ts` (2).

### Tests nuevos

| Archivo | Cubre |
|---|---|
| `tests/integration/db/drop-mensajero-sugerido-migration.test.ts` | R1, R2, R3 — texto de `migration.sql` (orden FK → índice → columna) y de `down.sql` (orden inverso, mismos nombres, `ON DELETE SET NULL ON UPDATE CASCADE`) |
| `tests/unit/guards/sin-mensajero-sugerido.test.ts` | R14, R18 — recorre `app/`, `lib/`, `components/`, `hooks/` y `db/schema.prisma` y falla ante cualquiera de los identificadores prohibidos; whitelist mínima (los 2 artefactos de OpenAPI, si Q1 → opción **b**). Modelado sobre `tests/unit/guards/no-embalaje.test.ts` |
| caso nuevo en `bulk-orden-service.test.ts` | R5, R6, R7 — fila con `mensajero_sugerido_id` arbitrario se crea igual; el repo de mensajeros no se consulta |
| caso nuevo en el test de la vía API | R9 — mismo `RowResult` y mismo HTTP con y sin la clave |
| caso nuevo en `tests/unit/api/openapi-spec` (o el existente) | R10, R11 — estado de la propiedad en la fuente de verdad y en el espejo |

---

## §8 — Secuenciación y riesgos

**Zona `fullstack` → backend primero, frontend después, en la misma rama.**

⚠️ **La fase backend deja el typecheck global en rojo a propósito.** Al quitar
`mensajeroSugeridoId` de `OrdenListItemDTO` y borrar la Server Action, los componentes
de UI dejan de compilar hasta que corre la fase frontend. Por eso el criterio de
"hecho" de la fase backend es **su** suite en verde, no el typecheck global; el verde
global es criterio de cierre de la fase frontend. Las dos fases van en la misma rama y
no se mergea a mitad.

| Riesgo | Mitigación |
|---|---|
| Solape con la **156** en `GenerarGuiaModal.tsx` | La task T15 se cierra con evidencia de grep, no por suposición (§5.5) |
| Solape con la **155** en `ESTADOS_MENSAJERO_SUGERIDO` (cita `en_fulfillment`) | Se borra el `Set` entero, así que el orden de llegada de la 155 es indiferente |
| Cliente Prisma stale tras tocar el schema | Regenerar antes de interpretar errores de typecheck (deuda conocida del repo) |
| Pérdida de datos en producción | Q5. El `down.sql` lo declara explícitamente en cabecera |
| El guard de R18 falla por copias anidadas del repo en `.claude/worktrees/` | Copiar el `IGNORED_DIRS` de `no-embalaje.test.ts`, que ya resolvió ese problema |
