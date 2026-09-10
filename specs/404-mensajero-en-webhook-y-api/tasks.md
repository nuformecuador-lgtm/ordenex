# Feature 404 — tasks

> **Regla de «hecho» en esta ficha:** el criterio es **un aserto que se pone rojo si el código está
> mal**, nunca un `grep` sobre un comentario. Cuando una task solo se pueda comprobar leyendo, se
> dice explícitamente que su verificación es **humana** y quién la firma (el reviewer).
>
> **Regla de alcance:** esta ficha es un **arreglo mínimo y aditivo**. Ninguna task puede crear una
> migración, una tabla, un endpoint, un parámetro de query ni un campo que no sea `mensajero`. Si
> una task parece pedirlo, está mal escrita: parar y preguntar.

Leyenda: `[P]` = paralelizable con las demás `[P]` de su bloque.

---

## T0 — Base medida antes de escribir código (BLOQUEA TODO)

```
git fetch origin
git log --oneline origin/dev -- lib/services/WebhookEstadoService.ts lib/repositories/WebhookOrdenReader.ts
git log --oneline origin/dev -- lib/repositories/OrdenRepository.ts lib/types/api-orden.ts lib/api/openapi-spec.ts
```

Confirmar en el **archivo real** (el índice del grafo devuelve de más) que siguen existiendo:
`armarData`, `DataEvento`, `API_ORDEN_SELECT`, `toApiOrdenRow`, `toListItemDTO`,
`nombreCompletoUsuario`, `NOMBRE_USUARIO_SELECT`.

**Hecho cuando:** `progress/impl_404.md` abre con el SHA de `origin/dev` usado, la salida de los dos
`git log`, y una línea por símbolo confirmando que existe y en qué archivo. Verificación humana
(la firma el implementer, la revisa el reviewer).

---

## T1 — El tipo compartido `ApiMensajeroDTO` (depende de T0; bloquea T2 y T4)

Declarar **una sola vez** `ApiMensajeroDTO { id: string; nombre: string }` en
`lib/types/api-orden.ts`, con el comentario que dice: qué es (`usuario.id` + nombre completo), qué
significa (el **asignado**, no el gestor — R7) y que la feature **405** lo reutiliza sin definir un
segundo tipo (`design.md` §11).

**Hecho cuando:** `pnpm exec tsc --noEmit` pasa y existe
`tests/unit/types/api-mensajero-dto.test.ts` que afirma que un valor del tipo tiene EXACTAMENTE las
claves `["id","nombre"]` (R1) y que un objeto con una tercera clave no compila (`@ts-expect-error`).

---

## T2 [P] — El webhook lee el mensajero (depende de T1)

1. `lib/interfaces/repositories/IWebhookOrdenReader.ts`: `DatosEntregaOrden` gana
   `mensajero: ApiMensajeroDTO | null`. **REQUERIDO, no opcional** (mismo razonamiento escrito que
   `causaDevolucion`).
2. `lib/repositories/WebhookOrdenReader.ts`: el `select` gana
   `mensajeroAsignado: { select: { id: true, ...NOMBRE_USUARIO_SELECT } }`; se mapea con
   `nombreCompletoUsuario`, `null` si no hay relación.

**No hacer:** proyectar ningún otro campo de `usuario`; añadir una segunda consulta; tocar la
resolución de causas.

**Hecho cuando** (`tests/unit/repositories/webhook-orden-reader.test.ts`, casos nuevos):
- «devuelve `{id, nombre}` del mensajero asignado, con el nombre completo compuesto» (R3/R4);
- «devuelve `mensajero: null` cuando la orden no tiene asignado» (R2/R23);
- «el `select` de `mensajeroAsignado` pide EXACTAMENTE `id`, `nombre`, `primerApellido`,
  `segundoApellido` y nada más» (R6);
- «sigue haciendo exactamente 2 llamadas a Prisma» (R12) — el aserto ya existe en ese archivo:
  ampliarlo, no duplicarlo.

---

## T3 — El cuerpo del evento lleva `mensajero` (depende de T2)

1. `lib/services/WebhookEstadoService.ts`: `DataEvento` gana `mensajero: ApiMensajeroDTO | null`
   (importado de `lib/types/api-orden.ts`, no redeclarado). `armarData` lo escribe **después de
   `motivo`, antes del bloque de `evidenciasUrl`**.
2. Ampliar la cabecera de `armarData`: hoy documenta **dos** convenciones de ausencia; pasa a
   documentar en cuál cae `mensajero` (siempre presente, `null`) **y por qué** (`design.md` §D3),
   y que su posición es load-bearing por la firma.
3. **Actualizar los tests congelados** de `tests/unit/services/webhook-estado-service.test.ts`
   (líneas 149, 353, 596, 617-618): `Object.keys(body.data)` pasa de 4 a 5 claves —de 5 a 6 en el
   caso `incidente`— **en el orden nuevo**. Se enmiendan con la decisión escrita al lado; **no** se
   relajan a `toContain` ni a un aserto de longitud.

**Hecho cuando**, en `tests/unit/services/webhook-estado-service.mensajero.test.ts` (nuevo):
- «`data` lleva `mensajero` con `{id, nombre}` cuando la orden tiene asignado» (R8);
- «`data.mensajero` es `null` y la clave viaja igualmente cuando no hay asignado» (R2);
- «el orden de claves de `data` es exactamente `[numGuia, numRemision, estado, motivo, mensajero]`,
  y `evidenciasUrl` va última cuando aplica» (R9/R10);
- «dos serializaciones del mismo evento producen el MISMO string» (R10);
- «dos entregas del mismo `eventoId` con distinto asignado publican distinto mensajero» (R11);
- «publica el ASIGNADO aunque exista una gestión de OTRO mensajero» (R7);
- «el logger no recibe el nombre ni el id, y el payload encolado sigue teniendo 3 claves» (R13) —
  ampliar el bloque `R29 — logs sin secreto/URL/PII` existente y el test del emisor
  (`webhook-estado-encolado.test.ts`).

---

## T4 [P] — El repositorio proyecta el mensajero para el canal (depende de T1)

1. `lib/interfaces/repositories/IOrdenRepository.ts`: `ApiOrdenRow` gana
   `mensajero: ApiMensajeroDTO | null` (con el comentario de significado, R7).
2. `lib/repositories/OrdenRepository.ts`: `API_ORDEN_SELECT` gana la relación
   `mensajeroAsignado: { select: { id: true, ...NOMBRE_USUARIO_SELECT } }`; `ApiOrdenSelectRow` gana
   el tipo; `toApiOrdenRow` mapea con `nombreCompletoUsuario`.
3. **Enmendar** el literal congelado `SELECT_DETALLE_106` de
   `tests/unit/repositories/orden-repository.no-regresion-106.test.ts` con un bloque fechado
   (2026-09-09, feature 404) que diga qué se añade y por qué, **siguiendo el precedente exacto que
   la 268 dejó en las líneas 25-34 de ese archivo**. El literal ES el contrato: se enmienda, no se
   sustituye por una comparación contra la constante de producción (sería tautológico).

**No hacer:** tocar `API_ORDEN_DETALLE_SELECT` (hereda por el spread); tocar el `where`; tocar
`incidentesAdmin` ni `gestiones`.

**Hecho cuando** (`tests/unit/repositories/orden-repository.api-lectura.test.ts`):
- el `toEqual` de la fila pública (línea 81) incluye `mensajero` y sigue siendo una igualdad
  ESTRUCTURAL, no un `toMatchObject` (R16);
- «una página de N órdenes se resuelve con UNA `findMany` y UN `count`, sin consulta por ítem»
  (R15);
- «el detalle hereda `mensajero` sin que su `select` declare nada propio» (R18);
- «`mensajero` es `null` cuando `mensajero_asignado_id` es NULL» (R2/R23);
- el literal congelado enmendado pasa (R16/R22).

---

## T5 — El DTO público y el service de lectura (depende de T4)

1. `lib/types/api-orden.ts`: `ApiOrdenListItemDTO` gana `mensajero`. `ApiOrdenDetalleDTO` lo hereda.
2. `lib/services/ApiOrdenLecturaService.ts`: `toListItemDTO` copia el campo. **Nada más.**

**No hacer:** tocar los controllers; tocar `listar`/`detallePorOrdenId` más allá del mapeo; añadir
un parámetro de filtro.

**Hecho cuando** (`tests/unit/services/api-orden-lectura-service.test.ts` y
`...por-orden-id.test.ts`): «el DTO del ítem lleva `mensajero` tal cual lo dio el repo» (R14),
«el DTO del detalle lo lleva y conserva `evidencias`» (R18/R19), «el objeto `mensajero` tiene
exactamente dos claves» (R1/R6).

---

## T6 [P] — Los tres bordes HTTP, de punta a punta (depende de T3 y T5)

Casos nuevos en `tests/integration/api/ordenes-api-key-listado.route.test.ts` y
`tests/integration/api/ordenes-api-key-orden-consulta.route.test.ts`:

- «cada ítem del listado trae `mensajero`» / «el detalle trae `mensajero`» (R14/R18);
- «una orden de OTRO owner sigue sin aparecer, y su mensajero tampoco» (R20);
- «`?mensajero=<id>` en la query se ignora: la respuesta y el `where` son idénticos a la llamada sin
  ese parámetro» (R17);
- «`pagination` y los nueve campos publicados no cambian de forma» (R16);
- «ninguna respuesta contiene `storagePath`, el nombre del bucket, `tiendaId` ni el texto libre de
  la gestión» (R21/R22) — ampliar el aserto de exclusión ya existente, no escribir uno nuevo
  paralelo.

**Hecho cuando:** los cinco casos pasan y los tests de scope ya existentes
(`ordenes-api-key-filtros-scope-ajeno.route.test.ts`,
`ordenes-api-key-tienda-destino-aislamiento.route.test.ts`) siguen verdes **sin tocarlos**.

---

## T7 — Contrato publicado: OpenAPI + espejo `.yaml` (depende de T3 y T5)

1. `lib/api/openapi-spec.ts`:
   - `WebhookOrdenEstadoActualizado.data`: propiedad `mensajero` (objeto `{id, nombre}` **o**
     `null`), **dentro de `required`**, y la `description` del objeto `data` pasa de «las cuatro
     claves… están SIEMPRE presentes» a **cinco**, conservando que `evidenciasUrl` es la única
     opcional. Actualizar los **dos ejemplos** publicados.
   - `OrdenListItem`: propiedad `mensajero` en `properties` y en `required`; la `description` deja
     de decir «sin ids internos ni PII de terceros» a secas y declara la excepción **acotada**
     (nombre del mensajero asignado, hacia el dueño de la orden) y la semántica de R7.
   - `OrdenDetalle` no se toca (hereda por `allOf`).
2. `docs/api/api-key-openapi.yaml`: mismo cambio, palabra por palabra (es el espejo textual).

**Hecho cuando** (`tests/unit/api/openapi-404-mensajero.test.ts`, nuevo):
- «los tres schemas declaran `mensajero` con la forma `{id: string, nombre: string} | null`» (R24);
- «`mensajero` está en `required` de `data` y de `OrdenListItem`, y `evidenciasUrl` sigue siendo la
  única propiedad NO requerida de `data`» (R9/R24);
- «los dos ejemplos del webhook llevan la clave, uno con objeto y otro con `null`» (R2/R24);
- «ninguna `description` publicada afirma ya que el canal excluye al mensajero sin acotarlo» (R25);
- los tests `openapi-webhook-*.test.ts` existentes pasan tras su actualización.

La equivalencia `.ts` ↔ `.yaml` es **verificación humana del reviewer** (no hay comparador
automático entre los dos artefactos): se revisa el diff lado a lado.

---

## T8 [P] — Dejar el contrato de la 106 sin contradicción (depende de T5)

Cuatro ediciones, ninguna de ellas una reescritura (`design.md` §7):

1. `specs/106-api-lectura-ordenes/requirements.md`: **ADDENDUM al final**,
   `⏳ 2026-09-09 — R16 ACOTADO por la feature 404`, con qué sigue vigente y qué queda acotado, y el
   argumento del humano. **El texto de R16 no se toca.**
2. `app/api/ordenes/api-key/orden/[id]/route.ts`: el «sin PII del mensajero» pasa al patrón fechado
   `⏳ … — AQUÍ DECÍA, y ya no es cierto`, distinguiendo **asignado** (sí se publica el nombre) de
   **gestor** (no se publica nada, es la 405).
3. `lib/types/api-orden.ts`: misma corrección en la cabecera del archivo.
4. `lib/services/ApiOrdenLecturaService.ts`: misma corrección en la cabecera de la clase.

**Hecho cuando:** verificación **humana** del reviewer sobre los cuatro diffs. **No se acepta ningún
criterio de `grep`** sobre estos textos: un comentario reescrito no es una prueba de nada.

---

## T9 — Aviso a integradores en `docs/api/CHANGELOG.md` (BLOQUEA LA RELEASE, no el código)

Entrada fechada **antes de la release**, con la convención del propio archivo (el texto de la
entrada **es** el aviso: se copia y se manda). Debe decir, como mínimo:

- es **aditivo**: nada de lo que hoy funciona deja de funcionar;
- la forma exacta del campo y que `null` significa «todavía nadie la lleva», con ejemplo;
- que el `id` es un **UUID en texto**, no un entero (Q1);
- que es **quién la lleva**, no quién la entregó, y que una orden barrida por el cierre puede
  quedar en `null` (Q2 / R23);
- el aviso a clientes con **validación estricta de esquema** (`additionalProperties: false`);
- que `data` pasa a tener **cinco** claves siempre presentes y `evidenciasUrl` sigue siendo la única
  opcional.

**Hecho cuando:** la entrada está escrita, commiteada y la bitácora de la ficha enlaza a ella.
Verificación humana. **No bloquea el código; bloquea la release.**

---

## T10 — Gate (depende de todo lo anterior)

`./init.sh --rapido` con el log escrito a archivo y `INIT_EXIT=$?` **dentro** del log. Revisar los
`skipped`, no solo el exit code: sin `.env` los tests de `integration/db` se saltan y el gate sale
«OK» igual.

**Hecho cuando:** typecheck, lint, los tests relacionados y **todas** las guardias en verde, con el
`INIT_EXIT=0` visible en el log, y ningún `skipped` inesperado en los archivos que esta ficha toca.

---

## Mapa de trazabilidad `R<n>→test`

| R | Descripción corta | Test (archivo / caso) |
|---|---|---|
| R1 | `mensajero` tiene exactamente 2 claves | T1 `api-mensajero-dto.test.ts`: "el DTO tiene exactamente id y nombre" + T5 service |
| R2 | `null` presente, nunca omitido | T2 reader "null cuando no hay asignado" + T3 "la clave viaja con null" + T4 repo + T7 ejemplos |
| R3 | Nombre completo por la fuente única | T2 reader: "compone nombre + apellidos con `nombreCompletoUsuario`" |
| R4 | `id` estable = `usuario.id` | T2 reader: "el id es el `usuario.id` proyectado, sin derivar ni formatear" |
| R5 | Misma forma en las tres superficies | T6 `mensajero-forma-unica.guardia.test.ts`: "webhook, listado y detalle producen la misma forma" |
| R6 | Sin PII extra ni estado interno | T2 reader: "el select pide exactamente 4 campos de usuario" + T5 "el DTO no gana claves" |
| R7 | Es el ASIGNADO, no el gestor | T3 "publica el asignado aunque exista gestión de otro mensajero" |
| R8 | El webhook lo incluye | T3 "`data` lleva `mensajero` con `{id,nombre}`" |
| R9 | Las 4 claves y `evidenciasUrl` intactas | T3 (frozen actualizado, líneas 149/353/596/617-618) + T7 "`evidenciasUrl` sigue siendo la única no requerida" |
| R10 | Posición fija / cuerpo determinista | T3 "orden de claves exacto" + "dos serializaciones dan el mismo string" |
| R11 | Mensajero vigente en la entrega | T3 "dos entregas del mismo eventoId con distinto asignado publican distinto mensajero" |
| R12 | Sin consulta nueva en el webhook | T2 reader: "sigue haciendo exactamente 2 llamadas a Prisma" |
| R13 | Nunca en logs ni en el payload del job | T3 (bloque R29 ampliado) + `webhook-estado-encolado.test.ts`: "el payload sigue teniendo 3 claves" |
| R14 | El listado lo incluye | T5 service + T6 `ordenes-api-key-listado.route.test.ts`: "cada ítem trae mensajero" |
| R15 | Una consulta por página, no por ítem | T4 repo: "una findMany y un count, sin consulta por ítem" |
| R16 | Nueve campos + paginación intactos | T4 `orden-repository.api-lectura.test.ts:81` (toEqual) + T6 "pagination no cambia" |
| R17 | No filtra ni ordena por mensajero | T6 "`?mensajero=` se ignora: mismo where y misma respuesta" |
| R18 | El detalle lo incluye | T4 "el detalle hereda mensajero" + T6 `ordenes-api-key-orden-consulta.route.test.ts` |
| R19 | `evidencias[]` intacto | T5 "el detalle conserva evidencias, incluido `[]`" |
| R20 | Solo al dueño de la orden | T6 "una orden de otro owner sigue sin aparecer, y su mensajero tampoco" |
| R21 | El texto libre `gestion_orden.motivo` no se emite | T2 reader (el select no lo proyecta) + T6 "ninguna respuesta contiene el texto libre" |
| R22 | Sin storage_path / bucket / ids internos | T4 literal congelado enmendado + T6 aserto de exclusión ampliado |
| R23 | `null` tras perder la asignación | T4 "mensajero es null cuando `mensajero_asignado_id` es NULL" |
| R24 | El contrato declara el campo | T7 `openapi-404-mensajero.test.ts`: "los tres schemas lo declaran, con required y ejemplos" |
| R25 | La exclusión de la 106 queda acotada por escrito | T7 "ninguna description afirma ya la exclusión sin acotarla" + T8 (verificación humana del reviewer sobre los cuatro diffs) |

---

## Orden de ejecución y paralelismo

```
T0
 └── T1
      ├── T2 [P] ──> T3 ──┐
      └── T4 [P] ──> T5 ──┼──> T6 [P]
                          ├──> T7
                          └──> T8 [P]
T9 (en cualquier momento tras T7; bloquea la release)
T10 (al final, y NUNCA en paralelo con un subagente que esté mutando el árbol)
```
