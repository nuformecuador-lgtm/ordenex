# Feature 404 — informe de revisión

**Rama:** `feat/404-mensajero-en-webhook-y-api` · **PR** #770 · **Base:** `dev` (`ac8bf510`)
**Commits revisados:** `2c4e168a` (código + contrato + tests) y `6ad62995` (docs + bitácora), sobre
`f7d4cda9` (la ficha y su spec, ya ancestro de `dev`).
**Fecha:** 2026-09-10 · **Rol:** reviewer (no edita código)

**VEREDICTO: OK.** Cero bloqueantes. 25 de 25 requisitos con test real. Siete hallazgos menores,
ninguno condición para mergear; dos de ellos son **puertas de release** que la propia ficha ya
declara (T9 y Q3) y hay que atender antes de desplegar, no antes de mergear.

Herramienta: el MCP `codebase-memory` **no estaba en mi conjunto de herramientas** en esta sesión;
la búsqueda se hizo con `git grep`/`grep` sobre el árbol de la rama y leyendo los archivos reales.
Se dice explícitamente por la regla 7 de `CLAUDE.md`.

---

## 1. Checklist de `CHECKPOINTS.md`, punto por punto

### Especificación

- [x] `specs/404-mensajero-en-webhook-y-api/requirements.md` con EARS numerados `R1`…`R25`.
- [x] `design.md` con alternativas descartadas **y su porqué**: hay cinco (A1 solo `nombre`, A2 id
      pseudónimo por HMAC, A3 derivar del historial de gestiones, A4 omitir la clave como
      `evidenciasUrl`, A5 un recurso `/mensajeros`), cada una con su argumento de descarte.
- [~] `tasks.md` existe (T0–T10). **No lleva casillas `[x]`** — y no es un descuido de esta ficha:
      **ningún** `specs/*/tasks.md` del repo usa `[x]` (verificado con un `grep` sobre todo
      `specs/`: cero coincidencias). La convención viva es marcar el hecho en la bitácora, y
      `impl_404.md` recorre T0–T10 uno a uno con su evidencia. Deriva de convención del arnés, no
      incumplimiento de la ficha. Ver hallazgo menor 1.

### Trazabilidad

- [x] Cada `R<n>` mapea a al menos un test concreto **que se pone rojo si el código está mal**. Los
      25 verificados uno a uno abriendo el test; el detalle está en la sección 2.
- [x] `progress/impl_404.md` contiene el mapa `R<n> -> test`, con archivo **y caso**.

### Calidad de código

- [x] `typecheck` / `lint` / tests: la bitácora reporta `./init.sh` **completo** con `INIT_EXIT=0`
      escrito DENTRO del log, 25.542 tests, sin rojos nuevos. **Verificado por mí, no solo leído**:
      re-corrí los 13 archivos que esta ficha toca o crea, en el worktree de la rama →
      **13 archivos, 229 tests, 0 fallos, 0 `skipped`** (`VITEST_EXIT=0`).
      Nota de método: mi primera corrida salió `VITEST_EXIT=1` por un `--reporter=basic` inválido en
      vitest 4 —no por un test rojo—; se repitió con el reporter por defecto. El wrapper de fondo
      informó «exit code 0» de esa primera corrida: valió el `INIT_EXIT=$?` escrito dentro del log,
      que es exactamente el modo de fallo que el arnés ya tiene fichado.
- [x] El modo de gate es el correcto: el diff toca `lib/types/api-orden.ts`, así que el rápido se
      niega solo y manda al completo (`docs/verification.md`). El implementer corrió el completo.
- [n/a] E2E: no hay harness de Playwright vivo y esta ficha es backend puro sin pantalla. El riesgo
      que un E2E cubriría —que el campo no llegue al borde HTTP— lo cubren los casos de las dos
      rutas montando la **cadena real** (sección 5).

### Datos y seguridad

- [n/a] RLS: **no hay tabla ni columna nueva**. Cero archivos bajo `db/` en el diff. No hay política
      que crear.
- [n/a] Migraciones reversibles: no hay migración.
- [x] Sin secretos hardcodeados. El `WebhookSender` sigue sin registrar la URL ni el cuerpo
      (`lib/clients/webhook-sender.ts`), lo comprobé por si el cuerpo, ahora más grande, se colaba
      en un log.
- [x] Webhook con firma e idempotencia intactas: `eventoId = dedupeKeyWebhookEstado(ordenId,
      estatusDestinoId, ocurridoAt)` **no depende del cuerpo**, así que crecer el cuerpo no toca la
      idempotencia; la firma se calcula por entrega sobre el string ya serializado, y hay un test
      que exige igualdad **byte a byte** de dos serializaciones del mismo evento (R10).

### Patrón de capas

- [x] Controller sin queries ni lógica: el único cambio en
      `app/api/ordenes/api-key/orden/[id]/route.ts` es un **comentario** (T8.2). El otro controller
      no se toca.
- [x] Service sin HTTP: `ApiOrdenLecturaService.toListItemDTO` copia el campo y nada más;
      `WebhookEstadoService.armarData` decide política de contrato, no HTTP.
- [x] Repository solo consulta y mapea: la relación entra en `API_ORDEN_SELECT` (un solo sitio) y
      `toApiOrdenRow` compone con la fuente única.
- [x] Interfaces en `lib/interfaces/` (`IOrdenRepository`, `IWebhookOrdenReader`), separadas.

### Permisos / multi-país

- [n/a] No hay página nueva, ni componente `private/`, ni Server Action nueva.
- [x] Nada de país, moneda ni cuenta hardcodeado.

### Verificación final

- [x] `./init.sh` completo en verde (bitácora) más mi corrida focalizada en verde.
- [x] `progress/review_404.md` — este archivo.
- [ ] `progress/history.md`: **pendiente del cierre**, no de este PR. En este repo esa entrada se
      añade después del merge (p. ej. `97fa1f9e docs(401): bitacora de la ficha`). No es deuda de la
      rama.

---

## 2. Trazabilidad `R1`–`R25`: 25 de 25 con test real

Verificado **abriendo cada test**, no confiando en la tabla de la bitácora. «Real» significa que el
aserto tiene un literal escrito a mano o una igualdad estructural que una mutación del código de
producción rompe; ningún requisito se cubre con un `grep` sobre un comentario ni con un aserto
vacío.

| R | Test que lo sostiene | Por qué se pone rojo |
|---|---|---|
| R1 | `api-mensajero-dto.test.ts` + `api-orden-lectura-service.test.ts` | `Object.keys(...)` con `toEqual ["id","nombre"]`, y dos `@ts-expect-error` que ponen rojo el **typecheck** si dejan de ser errores |
| R2 | reader, service del webhook, repo, las dos rutas y OpenAPI | se afirma la presencia de la clave y el **string crudo** con `mensajero` a `null`: un `undefined` no viajaría y la distinción omitido/`null` no se puede falsear |
| R3 | `webhook-orden-reader.test.ts` (dos casos) + `orden-repository.api-lectura.test.ts` | el esperado es el literal **«Carlos Jimenez Mora» escrito a mano**, nunca `nombreCompletoUsuario(...)`; y hay el caso «sin apellidos -> solo el nombre» |
| R4 | reader: «el id es el `usuario.id` PROYECTADO» | compara contra la constante del fixture, no contra una derivación del código |
| R5 | `tests/unit/guards/mensajero-forma-unica.guardia.test.ts` | ejercita las **tres** superficies sobre la MISMA fila de `usuario` y exige el mismo objeto **y el mismo fragmento serializado**; además cuenta las declaraciones del tipo en `lib/` y trae **contraprueba** del detector |
| R6 | reader y repo: `toEqual` **estructural** del `select` | el fake del reader **proyecta la fila cruda con el `select` real**, y esa fila trae `telefono`, `email`, `cedula` y `rol`: pedir una columna de más se ve en el DTO y en el JSON |
| R7 | reader «el mensajero que GESTIONÓ no se proyecta ni se emite» + la prosa del contrato | el caso del reader **sí** inyecta una gestión con texto libre y exige que no salga; ver hallazgo menor 2 sobre el caso hermano del service |
| R8 | `webhook-estado-service.mensajero.test.ts` | `toEqual` del objeto con los dos literales |
| R9 | los cuatro congeladores de `webhook-estado-service.test.ts` + OpenAPI | siguen siendo igualdades exactas de las claves de `data`; **no** se relajaron a `toContain` ni a longitud |
| R10 | «orden exacto de claves» + «dos serializaciones dan el MISMO string» | igualdad byte a byte del cuerpo crudo, que es lo que se firma |
| R11 | «dos entregas del MISMO `eventoId` con distinto asignado» y «pierde el asignado entre entregas» | el doble del reader es una **función**, no un valor congelado: si la lectura dejara de ocurrir por entrega, las dos entregas saldrían iguales |
| R12 | reader: exactamente 2 llamadas a Prisma | y el delegate `usuario` existe **solo** para poder afirmar que nadie lo llama |
| R13 | bloque `R29` ampliado + `webhook-estado-encolado.test.ts` | el caso del logger afirma antes que hubo logs: no puede pasar por vacío |
| R14 | service + `ordenes-api-key-listado.route.test.ts` sobre la **cadena real** | |
| R15 | repo: 25 filas, **una** `findMany` y **un** `count`, delegates de `usuario` sin usar, y 13 ítems con mensajero no nulo | el último aserto impide que el caso pase devolviendo 25 `null` |
| R16 | `toEqual` estructural de la fila pública + juego de claves exacto en el borde HTTP + `pagination` | un décimo campo colado la pone roja |
| R17 | ruta: respuesta **idéntica byte a byte** con y sin el parámetro, y `where`/`orderBy` iguales | |
| R18 | repo (el detalle hereda el mismo `select`), service sobre el repositorio REAL, y la ruta | |
| R19 | `evidencias: []` afirmado en service y en la ruta, con el juego de claves cerrado | |
| R20 | listado y detalle con un Prisma falso que **aplica el `where.tiendaId`** | si el repositorio dejara de acotar por owner, la orden ajena aparecería |
| R21 | reader (`select.gestiones` sin `motivo`, caso preexistente más el nuevo) y las dos rutas | |
| R22 | `SELECT_DETALLE_106` **enmendado con bloque fechado** (no sustituido por la constante de producción) + exclusiones en las rutas | |
| R23 | repo, listado y detalle con la relación en `null` | |
| R24 | `tests/unit/api/openapi-404-mensajero.test.ts` (20 casos) | forma, `required`, orden de propiedades, los dos ejemplos y el espejo `.yaml` |
| R25 | ausencia de la frase vieja en **todas** las `description` del contrato, más el `.yaml`, más la verificación humana de los cuatro diffs de T8 | el recolector trae **contraprueba** (más de 50 descripciones y un ancla conocida): no puede quedarse verde por devolver una lista vacía |

**Verificación humana que `tasks.md` me asignaba explícitamente, hecha:**

- **T7 — equivalencia `lib/api/openapi-spec.ts` con `docs/api/api-key-openapi.yaml`.** Revisada a
  dos columnas **y comprobada mecánicamente**: 21 frases largas del contrato nuevo (las dos
  `description` del objeto `mensajero`, las cuatro de `id` y `nombre`, la de `data`, la de
  `OrdenListItem` y los párrafos de «quién la lleva» y del `null` sobrevenido) aparecen
  **idénticas tras normalizar espacios** en los dos artefactos. Cero divergencias. Nota: el bloque
  `data` **sí** tiene comparador automático (`openapi-webhook-estado-actualizado.test.ts` compara
  propiedades y `required` del `.ts` contra el `.yaml`); lo que no lo tenía era la redacción, y es
  lo que comprobé a mano.
- **T8 — los cuatro diffs.** (1) `specs/106-api-lectura-ordenes/requirements.md`: es un **ADDENDUM
  al final**, el texto de R16 **no se tocó** (en el diff solo hay adiciones tras la última línea), y
  separa qué sigue vigente de qué queda acotado, con quién firma y con qué argumento. (2) el
  comentario del route handler, (3) la cabecera de `lib/types/api-orden.ts` y (4) la cabecera de
  `ApiOrdenLecturaService`: los tres usan el patrón fechado «AQUÍ DECÍA…», y los tres distinguen
  **asignado** (se publica el nombre) de **gestor** (no se publica nada, es la 405), que es justo el
  matiz que el design pedía no borrar.

---

## 3. Alcance: la ficha no se salió

Declarado: arreglo mínimo y aditivo, cero migraciones, cero tablas, cero endpoints, cero parámetros
de query, un solo campo `mensajero`. Comprobado contra el diff completo:

- **Cero archivos bajo `db/`**: no hay migración, ni enum, ni `down.sql` que revisar.
- **Cero rutas nuevas y cero cambios de comportamiento en controllers**: el único cambio en `app/`
  es un comentario. Los dos controllers siguen sin construir DTO.
- **Cero parámetros de query**: `ApiOrdenLecturaService.listar` sigue traduciendo los mismos
  filtros, y hay un aserto de **igualdad exacta** de los argumentos que llegan al repositorio.
- **Un solo campo**: los 9 archivos de producción tocados son exactamente los 9 que `design.md` §5
  enumera. `API_ORDEN_DETALLE_SELECT` no se tocó (hereda por el spread), ni el `where`, ni
  `gestiones`, ni `incidentesAdmin`.
- **`feature_list.json` no aparece en el diff.** Correcto.
- **El `toListItemDTO` correcto.** El de esta ficha es el de
  `lib/services/ApiOrdenLecturaService.ts:30`. El homónimo de
  `lib/repositories/OrdenRepository.ts:774` **no se tocó**: los cuatro hunks del repositorio caen en
  las líneas 204, 214, 297 y 324 (comentario de la constante, `select`, tipo de la fila y
  `toApiOrdenRow`); ninguno se acerca a la 774.
- **`API_ORDEN_SELECT` solo lo usan las dos consultas del canal** (`OrdenRepository.ts:2898` y
  `:2947`, esta última por el spread del detalle): el campo no se cuela en ninguna otra superficie.
- **El otro consumidor del detalle no lo publica**: `ApiPdfEtiquetaService` usa
  `findDetalleByOrdenIdForOwner` solo como comprobación de existencia, así que el nombre del
  mensajero **no** llega a la etiqueta PDF.
- Los seis tests ajenos que aparecen en el diff son **solo fixture** (una línea con el campo a
  `null` y su comentario fechado), consecuencia de que el campo sea REQUERIDO en el tipo. Sin
  cambios de aserto.

---

## 4. La puerta de privacidad: solo `{ id, nombre }`, y solo al dueño

Comprobado en las cuatro capas por las que podría escaparse algo:

1. **`select` del webhook** (`WebhookOrdenReader`): `id` más `NOMBRE_USUARIO_SELECT`, es decir
   `id`, `nombre`, `primerApellido`, `segundoApellido`. Nada más. El test lo afirma con `toEqual`
   estructural, y el fake **proyecta con ese `select`** una fila que trae `telefono`, `email`,
   `cedula` y `rol`: si alguien los pidiera, saldrían y el aserto se pondría rojo.
2. **`select` del canal** (`API_ORDEN_SELECT`): la misma proyección, y además congelada en el
   literal `SELECT_DETALLE_106`.
3. **DTO y tipo**: `ApiMensajeroDTO` tiene dos campos; el `@ts-expect-error` de la tercera clave
   vigila el compilador; la guardia exige que ese tipo se declare **una sola vez** en `lib/`.
4. **Contrato publicado**: `additionalProperties: false` en los dos schemas y `required` con `id` y
   `nombre`, tanto en el `.ts` como en el `.yaml`.

Ni teléfono, ni email, ni cédula, ni foto, ni zona, ni vehículo, ni rol, ni `tiendaId`, ni
`storage_path`, ni el nombre del bucket, ni `orden.id`, ni el mensajero **gestor** ni su texto libre
(`gestion_orden.motivo`, 256/R22). Los asertos de exclusión de las dos rutas lo afirman **sobre el
cuerpo HTTP crudo**, no sobre un objeto intermedio.

**Solo al dueño (R20):** el `ownerId` forzado de la 106 no se toca; los casos de scope montan un
Prisma falso que **aplica el `where.tiendaId`**, así que una orden ajena no aparece y el nombre de
SU mensajero tampoco (se afirma la ausencia del nombre y del id ajenos en el cuerpo). En el webhook,
el destinatario sigue siendo la suscripción activa colgada del owner de la orden (feature 302):
esta ficha no abre ninguna vía nueva.

---

## 5. Las trampas del repo, buscadas activamente

**Aserción contra su propia fuente — no hay ninguna.** El nombre esperado se escribe a mano
(«Carlos Jimenez Mora») en los siete sitios donde se afirma; en ninguno se compara contra
`nombreCompletoUsuario(...)`. Los `select` se comparan contra literales, no contra la constante de
producción, y el `SELECT_DETALLE_106` se **enmienda** en vez de sustituirse por la constante —que es
exactamente lo que lo dejaría tautológico—. Los congeladores de claves siguen siendo igualdades
exactas: ninguno pasó a `toContain`, `toMatchObject` ni a un aserto de longitud.

**El composition root que no inyecta — cubierto, y con la cadena real.** Los casos nuevos de las dos
rutas montan `route handler -> ApiOrdenLecturaService -> OrdenRepository -> Prisma mockeado`, y la
guardia monta `WebhookOrdenReader -> WebhookEstadoService`: con el service falso que ya había,
pasarían aunque nadie pasara el dato. Además el candado estructural es fuerte: `mensajero` es
**REQUERIDO** en `DatosEntregaOrden`, en `ApiOrdenRow` y en `ApiOrdenListItemDTO`, así que cualquier
otro productor de esos tipos deja de compilar. Verifiqué que los dos composition roots de producción
(`buildWebhookEstadoService`, y `buildDetallePorOrdenId` / `buildLecturaService`) instancian el
reader y el repositorio reales.

**Los dobles no ven el SQL — cubierto donde importa.** Todo lo que depende del `select` se afirma
sobre el `select` REAL capturado del mock, y el fake del reader lo **aplica**. El aviso del
implementer es correcto y honesto: la guardia de forma única no mata M1 porque su fake devuelve la
relación sin proyectar, pero esa guardia mide otra cosa (igualdad de forma entre superficies) y
quien vigila el `select` es `webhook-orden-reader.test.ts`, que sí la mata. Lo que un doble nunca
podría validar —que `mensajeroAsignado` y las tres columnas de identidad existan de verdad— lo
valida el **typecheck** contra los tipos generados de Prisma, y lo confirmé además en
`db/schema.prisma:718` y en `lib/utils/nombre-usuario.ts`.

**Test verde sin datos — no hay ningún `if (!x) return;`** en los casos nuevos. Al contrario, hay
tres anticuerpos explícitos: el caso del logger afirma que hubo logs antes de las exclusiones; el
recolector de `description` de R25 trae contraprueba (más de 50 descripciones y un ancla conocida);
y el caso de R15 remata con «13 ítems con mensajero no nulo», que impide pasar devolviendo 25
`null`.

**Sobre M2, la mutación superviviente: es un mutante equivalente, no un hueco.** Sacar `mensajero`
del literal y asignarlo con `data.mensajero = ...` **antes** del bloque de `evidenciasUrl` deja el
orden de inserción de claves —y por tanto el string serializado y su firma— **idéntico byte a
byte**. No hay comportamiento que observar, así que ningún test *puede* detectarla sin afirmar sobre
el texto del código, que es justo lo que la regla de «hecho» de esta ficha prohíbe. Su variante
observable, M2b (asignar **después** de `evidenciasUrl`), muere con dos rojos. El juicio del
implementer es correcto y no exige trabajo adicional.

**Sobre las mutaciones en general:** no las re-ejecuté yo. Intenté aplicar tres mutaciones propias
(nombre compuesto pasado a solo `usuario.nombre`; `toListItemDTO` devolviendo `null`; quitar la
relación del `select` del reader) y el entorno **bloqueó la escritura sobre código de producción**,
coherente con mi rol de reviewer. Lo que sí hice fue verificar **por construcción** que cada una
moriría, leyendo el aserto: el literal «Carlos Jimenez Mora» no sobrevive a publicar solo «Carlos»;
el `toEqual` del objeto no sobrevive a un `null`; y quitar la relación del `select` deja
`arg.select.mensajeroAsignado` en `undefined`, con lo que el proyector del fake revienta y el
`toEqual` del `select` falla. Las kills reportadas en la bitácora son consistentes con lo que leo, y
la corrida real de los 13 archivos (229 tests) confirma que el árbol actual está verde.

---

## 6. Hallazgos

Ninguno bloqueante.

1. **menor — `tasks.md` sin casillas `[x]`.** `CHECKPOINTS.md` pide que todas las tasks estén
   marcadas `[x]`; este `tasks.md` (como **todos** los del repo: un `grep` sobre `specs/*/tasks.md`
   da cero) no usa casillas sino «Hecho cuando…» por task. El cumplimiento real está en
   `impl_404.md`, que recorre T0–T10 con evidencia. Es deriva del arnés, no de esta ficha: si se
   quiere cerrar, se cierra cambiando el checkpoint o la plantilla, no esta rama.

2. **menor — el caso R7 del service afirma la ausencia de un dato que nunca se inyectó.** En
   `webhook-estado-service.mensajero.test.ts`, «publica el ASIGNADO aunque exista una gestión de
   OTRO mensajero» comprueba que el nombre del otro mensajero no está en el cuerpo, pero
   `DatosEntregaOrden` **no tiene** ningún campo de gestor, así que ese nombre no podía estar en el
   cuerpo en ninguna circunstancia: esa mitad del aserto no puede ponerse roja. No es un agujero de
   R7 —lo cubre el caso del **reader**, que sí inyecta una gestión con su `mensajero_id` y su texto
   libre y exige que no se proyecte, y lo cubre el propio tipo, que no transporta al gestor—, pero
   el título del caso promete más de lo que mide.

3. **menor — un comentario que describe un escenario que el test no ejercita.** En
   `api-orden-lectura-service.test.ts`, el caso «404/R1+R6» dice que el repo devuelve una fila con
   un campo de más y que el DTO no debe dejarlo pasar por copia ciega, pero el fixture tiene
   exactamente dos claves y `toListItemDTO` **copia la referencia**, así que una tercera clave **sí**
   pasaría. El aserto es válido; el comentario no. Merece corregirse la próxima vez que se toque el
   archivo; no justifica un commit propio.

4. **menor / PUERTA DE RELEASE — T9: el aviso está escrito, falta MANDARLO.** La entrada de
   `docs/api/CHANGELOG.md` (2026-09-09) está commiteada y **coincide exactamente con lo que el
   código emite**: cinco claves siempre presentes en `data`, `mensajero` tras `motivo` y antes de
   `evidenciasUrl`, `evidenciasUrl` como única opcional, dos claves y nada más, `id` UUID en texto,
   «quién la lleva» con el hueco del barrido, y el aviso a clientes con validación estricta. **No
   diverge del contrato ni del código**, así que no hay bloqueante por aquí. Lo que queda es el acto
   de mandarlo antes de desplegar: el texto de la entrada **es** el aviso.

5. **menor / PUERTA DE RELEASE — Q3 se implementó con D0 sin acuse humano explícito.** Mi juicio:
   **no necesita puerta antes del merge.** La decisión por defecto D0 está escrita en el spec que el
   humano aprobó; `requirements.md` dice que ninguna de las tres preguntas bloquea la
   implementación; y `design.md` §2.2 dice que acotarla al owner `adminTienda` había que pedirlo
   **antes** de implementar. En lo sustantivo el dato va, en los dos modelos, **al dueño de la
   orden**, que es el destinatario que el humano autorizó; lo que no es literalmente cierto para el
   modelo de cuenta dedicada es la *justificación* («ya lo ve en la UI»), porque esa cuenta no
   navega. Recomendación, no bloqueo: pedir el acuse en el mismo momento en que se manda el aviso de
   T9 y, antes de gastar decisión, **medir la audiencia** —cuántas API keys activas usan cuenta
   dedicada frente a `tienda_destino_id`—; si son cero, la pregunta se cierra sola. Si el humano
   prefiere acotar, es una condición en un solo sitio y no invalida nada de lo revisado aquí.

6. **menor — los 152 archivos de `integration/db` no corrieron** (worktree sin `.env`), como es
   habitual. Aquí es aceptable con argumento medible, no por costumbre: esta ficha **no toca la capa
   SQL** —cero migraciones, cero `where` nuevo, cero consulta cruda—, y lo único que un doble no
   puede validar (que la relación y las tres columnas de identidad existan) lo valida el typecheck
   contra los tipos generados de Prisma; lo confirmé además en `db/schema.prisma:718`. Aun así
   conviene que la corrida completa **post-merge sobre `dev` con base** lo confirme, que es lo que
   el arnés ya exige.

7. **menor — `progress/history.md` pendiente.** Es trabajo de cierre posterior al merge (así se hace
   en este repo), no deuda de esta rama.

**Observación heredada que NO es de esta ficha y que confirmo intacta:** `evidenciasUrl` se
construye con `orden.id` mientras que `ApiOrdenResolucionService.resolver` solo casa por `num_guia`
o `num_remision`, de modo que un `GET` a ese enlace parece devolver 404. Estaba antes, no lo rompió
la 404 y esta rama no lo toca.

---

## 7. Veredicto

**OK.** Cero bloqueantes. El campo `mensajero` viaja aditivo, con una sola forma declarada una sola
vez, en las tres superficies; los 25 requisitos tienen un test que se pone rojo si el código está
mal; el alcance no se salió ni un archivo; la exposición se queda en `{ id, nombre }` hacia el dueño
de la orden y en ningún sitio más; y el contrato publicado —OpenAPI, su espejo `.yaml` y el
CHANGELOG— dice exactamente lo que el código emite.

Antes de **desplegar** (no antes de mergear) quedan dos actos humanos que la propia ficha declara:
**mandar** el aviso de T9 a los integradores —en particular a quien valide esquema en estricto— y,
si se quiere cerrar Q3, pedir el acuse de D0 con la audiencia medida.

**Revisor:** reviewer (agente) · 2026-09-10 · sin ediciones sobre código de producción ni sobre
`feature_list.json`.
