# Feature 405 — bitácora de implementación

**Rama:** `feat/405-gestiones-en-detalle-api`
**SHA base:** `f734e114` (`fix(405): la rama de la ficha, sin clave duplicada`, ya con la 404 dentro)
**Fecha:** 2026-09-10 · **Agente:** backend_dev · **Worktree:** aislado
**Estado:** 2.ª vuelta — los dos bloqueantes de `progress/review_405.md` (commit `351cd8d6`)
cerrados. Ver **§ Segunda vuelta** más abajo.

> Nota de nombre: `tasks.md` llama a este archivo `progress/impl_405_backend.md`. Se escribe como
> `progress/impl_405.md`, que es la convención viva del repo (`impl_404.md`, `impl_401.md`…) y lo
> que pidió el encargo. No hay un segundo archivo.

Qué se implementó: un arreglo **`gestiones[]`** en el cuerpo de
`GET /api/ordenes/api-key/orden/{id}`, con `{ createdAt, resultado, estadoResultante, motivo,
mensajero }` por elemento. **Aditivo y de SOLO LECTURA: sin migración, sin tabla, sin índice, sin
endpoint nuevo y sin tocar el controller.** Ninguna task pidió salirse de ahí — todas caben en el
alcance declarado, así que no hay ninguna que reportar como mal escrita.

---

## Las cuatro preguntas abiertas: resueltas antes de escribir código, no reabiertas

| Q | Veredicto aplicado |
|---|---|
| **Q1** (era bloqueante) | `motivo` = **causa TIPIFICADA** (`not_found`/`wrong_number`/`wrong_address` en devoluciones, `danado`/`perdido`/`robado` en incidentes, `null` en el resto). El texto libre `gestion_orden.motivo` **no se proyecta siquiera** (256/R22) |
| **Q2** | Las claves se llaman `createdAt` y `resultado`, no `fecha`/`tipo`. Avisado en el CHANGELOG con el mapeo y el porqué |
| **Q3** | Se **reutiliza** `ApiMensajeroDTO` de `lib/types/api-orden.ts` (la 404). No se declara un segundo tipo; hay una guardia que lo mide sobre el árbol |
| **Q4** | Las ANULADAS se excluyen (`anulada_at IS NULL`), el mismo criterio de `whereIntentosVigentes` |

**Símbolos confirmados EN EL ARCHIVO REAL** antes de apoyarse en ellos (el grafo devuelve de más):

| Símbolo | Existe | Archivo real |
|---|---|---|
| `ApiMensajeroDTO` | sí | `lib/types/api-orden.ts:48` (`export interface`) |
| `API_ORDEN_DETALLE_SELECT` | sí | `lib/repositories/OrdenRepository.ts` |
| `toApiOrdenDetalleRow` | sí | `lib/repositories/OrdenRepository.ts` |
| `nombreCompletoUsuario` / `NOMBRE_USUARIO_SELECT` | sí | `lib/utils/nombre-usuario.ts:32` / `:15` |
| `ESTATUS_POR_RESULTADO` | sí | `lib/types/gestion-destino.ts:41` |
| `CAUSA_DEVOLUCION_SEED` / `CAUSA_INCIDENTE_SEED` | sí | `lib/types/causa-devolucion.ts` / `causa-incidente.ts` |
| `Orden.historialEstados` (relación) | sí | `db/schema.prisma:723` |

---

## La decisión de diseño que no estaba escrita del todo: el SUPERCONJUNTO

`design.md` §3.1 pedía dos entradas `gestiones` en el mismo `select` con dos `where` distintos.
**Prisma no admite pedir la misma relación dos veces**, y el propio design lo resuelve dos párrafos
más abajo: se pide **el superconjunto una vez** y se derivan las dos listas en el mapeo.

Así quedó, y el matiz importa porque `evidencias[]` es contrato vigente:

```
where: { OR: [
  { resultado: { in: [...] }, evidenciaStoragePath: { not: null } },  // 268, PALABRA POR PALABRA
  { anuladaAt: null },                                                 // 405/R11
] }
```

y `toApiOrdenDetalleRow` vuelve a aplicar **cada predicado en memoria**: el de la 268 para
`evidencias[]` (que sigue SIN filtrar anuladas, como decidió aquella ficha) y el de la 405 para
`gestiones[]`. Sigue siendo **una sola consulta** (R19).

`estadoResultante` **no** se lee navegando `gestion.historialEstados`: `orden_historial_estado` no
tiene índice por `gestion_orden_id`. Se pide como relación de la ORDEN (entra por
`@@index([ordenId, createdAt])`) y el emparejamiento es un `Map` en una pasada — sin `find` dentro
del bucle.

---

## Archivos creados

| Archivo | Qué es |
|---|---|
| `tests/unit/services/api-orden-lectura-service.gestiones-405.test.ts` | T7 — R2, R4, R5, R7, R8 (+ el nombre del mensajero) sobre la cadena real |
| `tests/integration/db/gestiones-detalle-api-405.test.ts` | T8 — R6, R10, R11, R13, R14, R18, R19 **contra Postgres real** |
| `tests/unit/guards/gestiones-detalle-lista-blanca.guardia.test.ts` | T9 — R3, R9, R12 (lista blanca + no-fuga) |
| `tests/unit/api/openapi-405-gestiones.test.ts` | T14 — R16, R20, R21, R22 |

## Archivos modificados

**Producción (5):**

| Archivo | Cambio |
|---|---|
| `lib/types/api-orden.ts` | T2: `ApiOrdenGestionDTO` (5 claves, `mensajero: ApiMensajeroDTO` importado) · `ApiOrdenDetalleDTO.gestiones` |
| `lib/interfaces/repositories/IOrdenRepository.ts` | T1: `ApiOrdenGestionRow` + `ApiOrdenDetalleRow.gestiones` |
| `lib/repositories/OrdenRepository.ts` | T3/T4/T5: `causaTipificadaDeGestion`, `primerEstadoPorGestion`, el `select` (superconjunto + `historialEstados`) y el mapeo |
| `lib/services/ApiOrdenLecturaService.ts` | T6: `toDetalleDTO` copia `gestiones` **campo a campo** |
| `lib/api/openapi-spec.ts` | T12: `GESTION_RESULTADO_ENUM` y `MOTIVO_CAUSA_ENUM` derivados; schemas `Mensajero` y `OrdenGestion`; `OrdenDetalle` exige `gestiones` y trae ejemplo |

`app/api/ordenes/api-key/orden/[id]/route.ts` **no se tocó**. `middleware.ts` tampoco. Ni una
migración.

**Contrato y documentación (2):**

- `docs/api/api-key-openapi.yaml` — T13, espejo textual, entre `Evidencia` y `OrdenDetalle`.
- `docs/api/CHANGELOG.md` — T15, entrada fechada `2026-09-10`, **copiable y enviable tal cual**.
  Bloquea la release, no el código.

**Tests existentes enmendados (9)** — ninguno relajado a `toContain` ni a un aserto de tamaño:

| Archivo | Qué se enmendó |
|---|---|
| `tests/unit/repositories/orden-repository.no-regresion-106.test.ts` | `SELECT_DETALLE_106` enmendado con bloque fechado (el `OR`, las claves nuevas, el `orderBy` y `historialEstados`), siguiendo el precedente de la 268 y la 404 |
| `tests/unit/repositories/orden-repository.api-consulta-pdf.test.ts` | el aserto del `where` pasa a afirmar la PRIMERA rama del `OR` con igualdad exacta + **dos casos nuevos** de no-regresión de `evidencias[]` bajo el superconjunto |
| `tests/unit/repositories/orden-repository.api-lectura.test.ts` | fixtures + el comentario «el gestor es la 405: aquí no se pide» **acotado** (ver abajo) + 3 asertos nuevos de R12 sobre el gestor |
| `tests/unit/services/api-orden-lectura-service.por-orden-id.test.ts` | helper `detalleRow()` + la lista de claves del detalle 11 → 12 |
| `tests/integration/api/ordenes-api-key-orden-consulta.route.test.ts` | fixtures + lista de claves 11 → 12 + **4 casos nuevos** (R1, R2, R12 y R17 sobre la cadena real) |
| `tests/unit/api/openapi-404-mensajero.test.ts` | 3 literales del contrato enmendados: el `allOf` del detalle, el conteo de `mensajero:` en el `.yaml` (3 → 6) y los bloques `required` (2 → 3) |
| `tests/unit/guards/mensajero-forma-unica.guardia.test.ts` · `tests/unit/services/api-pdf-etiqueta-*.test.ts` · `tests/integration/api/ordenes-api-key-orden-generate.route.test.ts` · `tests/integration/purga-pdf-regenera-177.test.ts` · `tests/unit/types/api-mensajero-dto.test.ts` | fixtures (`gestiones: []`, `historialEstados: []`) |

**Un comentario que hubo que ACOTAR, no borrar.** En `orden-repository.api-lectura.test.ts` decía
«el gestor es `gestion_orden.mensajero_id` y es la 405: aquí no se pide». La 405 **sí** publica el
mensajero de la gestión, así que la frase caducó; los dos asertos que la acompañaban siguen
vigentes y se explican por su nombre: no se proyecta la FK cruda `mensajeroId` (se pide la relación
`mensajero`, acotada a id + identidad) y **no se proyecta el texto libre `motivo`** — esa parte no
tiene fecha de caducidad. Se añadieron tres asertos más: del gestor no se piden `telefono`, `email`
ni `cedula`.

**Una guardia ajena que se puso roja por un COMENTARIO, y con razón.**
`gestion-ubicacion-solo-escritura.guardia.test.ts` (193/R7) prohíbe nombrar `ubicacionLat`/`Lng`
fuera de un registro cerrado — y no distingue código de comentario. Mi comentario del `select`
listaba esa columna entre las que NO se proyectan. Se reescribió sin nombrarla («las coordenadas de
la gestión, que son de solo escritura por la 193/R7»). La guardia hizo exactamente su trabajo.

---

## Mapa `R<n> → test`

Los 22 requisitos tienen al menos un aserto que se pone rojo si el código está mal. Ninguno se
cubre con un `grep` sobre un comentario.

| R | Test (archivo → caso) |
|---|---|
| R1 | `ordenes-api-key-orden-consulta.route.test.ts` → «405/R1: el detalle incluye la clave `gestiones` con sus cinco campos publicos» (cadena real, `toEqual` del array entero) |
| R2 | `api-orden-lectura-service.gestiones-405.test.ts` → «el detalle de una orden sin ninguna gestion trae la CLAVE con un array vacio» + «el array vacio NO hace que el detalle pierda `evidencias`…» + el chequeo de tipo «un repositorio que devolviera `null`… el tipo lo prohibe» · `...orden-consulta.route.test.ts` → «405/R2: … responde `gestiones: []`» |
| R3 | `gestiones-detalle-lista-blanca.guardia.test.ts` → «el conjunto de claves del elemento es el conjunto entero, ni una mas ni una menos» + «las cinco siguen presentes cuando TODO lo opcional es `null`» + el `Exclude` de tipo |
| R4 | `api-orden-lectura-service.gestiones-405.test.ts` → «es el `created_at` de la gestion, no el de la orden ni el de su transicion» (tres fechas distintas a propósito) + «es un `Date`… y serializa al mismo formato ISO» |
| R5 | `api-orden-lectura-service.gestiones-405.test.ts` → «los CINCO values del catalogo salen tal cual, sin etiqueta en español» + «no se cuela ninguna etiqueta de presentacion» |
| R6 | 🔴 `gestiones-detalle-api-405.test.ts` (Postgres real) → «`estadoResultante` es el destino de la PRIMERA transicion que origino la gestion»: la gestión `devuelta` origina **dos** transiciones y la segunda va a otro estado |
| R7 | `api-orden-lectura-service.gestiones-405.test.ts` → «la gestion LEGADA … sale con `null`, no se omite» + «una transicion de OTRA gestion no se le atribuye a esta» + el contraste «con transicion registrada SI lleva el value» · y en Postgres real dentro del caso de R6 |
| R8 | `api-orden-lectura-service.gestiones-405.test.ts` → 6 casos (`devuelta`→causa inglés, `incidente`→causa español, el cruce con las dos columnas pobladas, los tres resultados restantes a `null`, y los dos históricos sin causa) · 🔴 `gestiones-detalle-api-405.test.ts` → «`motivo` es la causa TIPIFICADA, y el TEXTO LIBRE del mensajero no sale jamas» (el texto libre está sembrado EN LA BASE) |
| R9 | `gestiones-detalle-lista-blanca.guardia.test.ts` → «su conjunto de claves es exactamente el de la 404: {id, nombre}» + «la asignacion cruzada compila: es el MISMO tipo» + «`ApiMensajeroDTO` se declara UNA sola vez en `lib/`» (barrido del árbol) · `openapi-405-gestiones.test.ts` → «el schema `Mensajero` tiene la MISMA forma que el `mensajero` que publica la 404» · 🔴 `gestiones-detalle-api-405.test.ts` → «cada gestion lleva su mensajero ATRIBUIDO…» |
| R10 | 🔴 `gestiones-detalle-api-405.test.ts` → «salen de la mas antigua a la mas reciente, y dos lecturas dan el MISMO orden» (literales de fecha a mano + comparación byte a byte de dos lecturas) |
| R11 | 🔴 `gestiones-detalle-api-405.test.ts` → «las DOS gestiones ANULADAS quedan fuera, y las TRES vigentes salen» + «la ANULADA CON FOTO no entra en `gestiones[]` pero SI en `evidencias[]`» · `orden-repository.api-consulta-pdf.test.ts` → «una gestion ANULADA con foto SIGUE saliendo en `evidencias[]`» |
| R12 | `gestiones-detalle-lista-blanca.guardia.test.ts` → «ninguno de los valores `FUGA-...` aparece en la respuesta serializada» + «ni el texto libre … ni ningun nombre de clave interna cruzan» + «el `id` interno de la gestion no viaja» + la contraprueba «el detector NO esta ciego» · `...orden-consulta.route.test.ts` → «405/R12: el texto libre … no cruza el borde» |
| R13 | 🔴 `gestiones-detalle-api-405.test.ts` → «la orden de OTRA tienda no se devuelve, ni sus gestiones, y su dueño si la ve» (con el contraste que impide el falso verde) |
| R14 | 🔴 `gestiones-detalle-api-405.test.ts` → «un incidente reportado por un ADMIN no aparece en `gestiones[]`» (hay un `orden_incidente` real sembrado) |
| R15 | `api-orden-lectura-service.por-orden-id.test.ts` → «404/R18+R19: el detalle lleva `mensajero` y conserva `evidencias`…» con la lista EXACTA de las 12 claves · `orden-repository.api-consulta-pdf.test.ts` → los 2 casos nuevos de no-regresión de `evidencias[]` · `orden-repository.no-regresion-106.test.ts` → el literal congelado |
| R16 | `openapi-405-gestiones.test.ts` → 5 casos: `OrdenListItem` sigue con sus diez propiedades, `Listado` intacto, el `data` del webhook con seis propiedades y cinco requeridas, `Evidencia` intacta, y el barrido «`gestiones` aparece SOLO dentro de `OrdenDetalle`» |
| R17 | `ordenes-api-key-orden-consulta.route.test.ts` → «405/R17: los codigos de estado del endpoint no cambian con la clave nueva» (401/403/422/404) + los casos 401/403/404/422 de la 177, verdes **sin editar sus expectativas** |
| R18 | 🔴 `gestiones-detalle-api-405.test.ts` → «servir el detalle NO escribe en `gestion_orden` ni en `orden_historial_estado`»: igualdad de las **filas enteras** antes/después, más el aserto de que la foto no está vacía |
| R19 | 🔴 `gestiones-detalle-api-405.test.ts` → «el detalle con gestiones emite el MISMO numero de consultas que sin ellas» (espía `$on("query")`, 3 gestiones vs 0) |
| R20 | `openapi-405-gestiones.test.ts` → 8 casos de forma + `required` + tipos + el ejemplo con dos elementos + el espejo `.yaml` |
| R21 | `openapi-405-gestiones.test.ts` → «las DOS listas son identicas, elemento a elemento y en el mismo orden» (detalle **derivado** vs webhook **literal**: dos fuentes independientes) + el contenido a mano + el enganche a los seeds + el `.yaml` |
| R22 | `openapi-405-gestiones.test.ts` → los tres avisos (a/b/c) uno por caso, más el mapeo de nombres, la asimetría de idioma y lo que no entra, más la contraprueba «el recolector de la entrada NO esta ciego» |

🔴 = vive en `tests/integration/db/`, contra Postgres real.

> ⏳ **2026-09-10, SEGUNDA VUELTA — las dos filas que cambian tras la revisión.**
>
> | R | Antes | Ahora |
> |---|---|---|
> | **R15** | PARCIAL (la mitad `resultado` del filtro nuevo, sin vigilar) | **ok** — `gestiones-detalle-api-405.test.ts` → «`evidencias[]` NO gana las gestiones con foto cuyo resultado no le corresponde» |
> | **R19** | NO CUMPLIDO (el test medía una propiedad más débil) | **ok** — R19 reescrito con el número medido; `gestiones-detalle-api-405.test.ts` → «el detalle emite EXACTAMENTE 9 consultas, y son estas nueve» + «ese número NO depende del número de gestiones» |
>
> Y una fila nueva: **R19-b** → el mismo caso del `toEqual` de `CONSULTAS_DEL_DETALLE`, que es el
> que congela el número por su **nombre de tabla**.

---

## Segunda vuelta (2026-09-10) — los dos bloqueantes de `progress/review_405.md`

### BLOQUEANTE 1 — `evidencias[]` se decidía en memoria y nadie lo medía

**El diagnóstico del reviewer es correcto y la causa raíz era mía.** Al pasar el `where` a
superconjunto, lo que entra en `evidencias[]` dejó de decidirlo Postgres y pasó a decidirlo el
`.filter()` de `toApiOrdenDetalleRow`. Él añadió `"devuelta"` y `"reprogramada"` a esa lista y la
mutación **sobrevivió a 9.446 tests en verde**.

**Por qué no se cazaba, y esto es lo importante:** mi escenario sembraba la `devuelta` vigente
**SIN foto**, y eso describe un estado que **no puede existir**. La evidencia es **OBLIGATORIA** en
`devuelta` desde la feature 75 — comprobado en el archivo real,
`lib/types/gestion-orden.ts`, rama `devuelta` del `discriminatedUnion`: `evidencias: evidenciasSchema`
(lo mismo en `entregada`, `rechazada` e `incidente`; `reprogramada` es la única que no la exige).
Con esa fila sin foto, la gestión nunca entraba por la puerta que el filtro tenía que cerrar: el
filtro no llegaba a decidir nada, así que mutarlo no cambiaba ninguna aserción.

**Arreglo — el escenario, no el aserto** (el mismo criterio que ya se aplicó con M1a):

- la `devuelta` vigente y la `reprogramada` vigente pasan a llevar **foto**, como en la realidad
  (en la base local hay **14 filas vigentes con foto** en esos dos resultados, el dato que aportó el
  reviewer);
- la `devuelta` **anulada** conserva su ausencia de foto, y ahora se declara por lo que es: una
  gestión **anterior a la 75**, que es el único caso en que eso es realista;
- caso nuevo, **R15**: afirma el **conjunto exacto** de `evidencias[]` por nombre de archivo
  (`["entregada:anulada-con-foto.jpg"]`) y, al lado, la lista de las **tres** filas con foto que la
  consulta devuelve. Un rojo aquí dice el nombre del archivo que se filtró, no solo un número.

**Medido después del arreglo:** la mutación del reviewer (M14) pone **2 rojos**. La otra mitad del
filtro (M15) sigue matando, con los mismos 2.

### BLOQUEANTE 2 — R19 era inalcanzable y había dos frases falsas

**Medí los dos números yo mismo**, con el método del reviewer (el espía `$on("query")` de
`crearPrismaDeTestConEspia`, misma base local, misma orden sembrada, sonda temporal borrada
después). No copié los suyos:

| | consultas | tablas |
|---|---|---|
| **`dev`** (`git checkout origin/dev -- lib/repositories/OrdenRepository.ts`, restaurado después) | **6** | `orden`, `order_status`, `usuario`, `gestion_orden`, `orden_incidente`, `orden_incidente_evidencia` |
| **esta rama** | **9** | las 6 anteriores **+ `orden_historial_estado`** ⭑ **+ un segundo `usuario`** (el mensajero de la gestión) ⭑ **+ un segundo `order_status`** (`estatusDestino`) ⭑ |

**No hay N+1, y lo medí explícitamente:** con **3** gestiones son 9 consultas y con **6** gestiones
son **las mismas 9**. En `dev` son 6 en los dos casos. El superconjunto, en efecto, no añade
ninguna: lo que cuesta son las **relaciones nuevas**, porque Prisma resuelve cada relación anidada
con su propia consulta. Así que **no hay que parar**: el escenario que el leader marcaba como
«otro bloqueante» (N+1) no se da.

**Lo aplicado, en el orden pedido:**

1. **R19 reescrito** en `requirements.md` §4 con los dos números concretos y un bloque fechado que
   dice por qué el requisito original era **inalcanzable por construcción**: `gestiones[]` no se
   puede devolver sin leerlas. La premisa del design era falsa, no la implementación. Se añade
   **R19-b**: el número, congelado en un test contra Postgres.
2. **Test débil sustituido.** El caso «0-vs-N gestiones» medía una propiedad **más floja** que el
   requisito y por eso no cazó el 6 → 9. Ahora son **dos** casos: uno congela
   `CONSULTAS_DEL_DETALLE` —las nueve, **por nombre de tabla y en orden**, para que un rojo diga
   *cuál* sobra— y el otro conserva la no-N+1.
3. **Las dos frases falsas, corregidas**, y una tercera que encontré de paso:
   - `specs/405-…/design.md` §3.1 — «ninguna consulta nueva» → bloque fechado con el 6 → 9 y la
     distinción entre «una llamada de Prisma» (cierto) y «un round-trip» (falso);
   - `lib/repositories/OrdenRepository.ts`, cabecera de `API_ORDEN_DETALLE_SELECT` — «Sigue siendo
     UNA sola consulta (R19)» → reescrita con el número medido. Era la peor de las tres: **estaba
     en código de producción**, en el archivo donde vive la decisión;
   - `lib/repositories/OrdenRepository.ts`, docblock de `findDetalleByOrdenIdForOwner` — decía
     «(join, sin N+1)». Prisma **no hace un join**: se retira la palabra y se conserva «sin N+1»,
     que sí es cierto.

⚠️ **Un tropiezo propio que conviene dejar escrito.** Al restaurar la mutación M16 con
`git checkout -- lib/repositories/OrdenRepository.ts`, me llevé por delante las **dos correcciones
de comentario que todavía no estaban commiteadas**. Lo detecté con un `grep` de comprobación y las
reapliqué. La lección, que es la de «verificar el blob commiteado»: **commitea antes de mutar**, o
el `checkout --` de la restauración se lleva lo que no está guardado.

---

## Gate

`./init.sh` **COMPLETO** (no `--rapido`): el diff toca `lib/types/api-orden.ts`, así que el modo
rápido se niega solo y manda al completo (`docs/verification.md`).

### ⭑ La corrida que vale: segunda vuelta, CON `.env` y con los `integration/db` EJECUTADOS

Log: `scratchpad/gate-405-v2.log` (no canalizado por `tail`; el `INIT_EXIT` se escribe DENTRO del
log).

```
 Test Files  1854 passed (1854)
      Tests  26931 passed | 26 skipped (26957)
   Duration  1020.18s

✓ tests: sin rojos nuevos (0 archivo(s) rojo(s) sobre 1854 ejecutado(s), todos en el baseline conocido)
! migraciones sin down.sql: 20260814120000_ruta_optimizada_trazado 20260814140000_ruta_parada_tramo 20260814160000_ruta_tramo_vivo_at
✓ .env presente
== init OK ==
INIT_EXIT=0
```

**Cero archivos saltados: `1854 passed (1854)`, sin una sola línea `↓` en todo el log.** De ellos,
**231 archivos de `tests/integration/db/` se EJECUTARON** (contados con
`grep -o "^ ✓ tests/integration/db/…" | sort -u | wc -l`), **0 saltados**, frente a los 153 que la
primera corrida declaró saltados por falta de `DATABASE_URL`. El de esta ficha, entre ellos:

```
✓ tests/integration/db/gestiones-detalle-api-405.test.ts (12 tests) 1372ms
```

Los **26 tests** que salen como `skipped` son casos individuales de otros archivos —no hay ni un
archivo entero saltado— y ninguno pertenece a esta ficha: sus cuatro archivos reportan 12, 19, 10 y
26 tests, todos ejecutados.

**Sin `40P01` en ninguna corrida.** La contención con el otro agente contra la misma base local no
se materializó: no aparece «deadlock» en el log y el recuento de tests es explícito, así que no hay
que distinguirlo de una regresión propia.

`pnpm run typecheck` → 0 errores. `pnpm run lint` → **0 errores**, 183 warnings, todos
`no-unused-vars`/`no-img-element` preexistentes en archivos ajenos a esta ficha.

### La corrida de la PRIMERA vuelta, que queda como referencia

```
 Test Files  1744 passed | 110 skipped (1854)
      Tests  25603 passed | 1352 skipped (26955)
✓ tests: sin rojos nuevos
! no hay .env. Crea uno a partir de .env.example
! recuerda: este verde NO incluye los 153 archivos de tests contra Postgres (sin DATABASE_URL se saltaron).
== init OK ==
INIT_EXIT=0
```

Log: `scratchpad/gate-405.log`. Ese verde **no** incluía los `integration/db`; el de arriba sí.

Los tres avisos de `down.sql` faltante son deuda preexistente de tres migraciones de agosto: esta
ficha **no crea ninguna migración**.

### Un tropiezo del entorno que conviene dejar escrito

La primera corrida del gate murió en el paso 4 con `"tsc" no se reconoce como un comando`, y
**no era del código**: el worktree tenía un `node_modules` vacío (solo `.vite`), de modo que
`npx`/`vitest` resolvían subiendo el árbol hasta el checkout principal pero `pnpm run` no
encontraba `node_modules/.bin`. Se creó la **junction** que el arnés espera
(`node_modules` → el del checkout principal) y el gate corrió entero. Prepender el `.bin` del padre
al `PATH` **no** sirve: `pnpm run` lanza el script por `cmd.exe` y la ruta estilo POSIX no llega.

### El hueco de la primera vuelta, ya CERRADO

En la primera corrida se saltaron **153 archivos de `integration/db`** por no haber `.env`, y uno
de ellos era el de esta ficha —donde viven siete de los veintidós requisitos—. Se dijo entonces por
su nombre en vez de darlo por probado, y ese aviso es lo que permitió al reviewer comprobarlo.

**Ya no aplica:** el reviewer dejó el `.env` en el worktree y la segunda corrida ejecuta los 231
archivos, incluido el nuestro (12 tests). El agujero está cerrado dentro del gate, no fuera de él.

Los otros archivos que tocan o cubren esta ficha, todos con `✓` en la segunda corrida:

```
✓ tests/integration/db/gestiones-detalle-api-405.test.ts (12 tests)
✓ tests/unit/services/api-orden-lectura-service.gestiones-405.test.ts (19 tests)
✓ tests/unit/guards/gestiones-detalle-lista-blanca.guardia.test.ts (10 tests)
✓ tests/unit/api/openapi-405-gestiones.test.ts (26 tests)
✓ tests/integration/api/ordenes-api-key-orden-consulta.route.test.ts (23 tests)
✓ tests/unit/repositories/orden-repository.api-consulta-pdf.test.ts (27 tests)
✓ tests/unit/repositories/orden-repository.api-lectura.test.ts (16 tests)
✓ tests/unit/repositories/orden-repository.no-regresion-106.test.ts (7 tests)
✓ tests/unit/services/api-orden-lectura-service.por-orden-id.test.ts (13 tests)
✓ tests/unit/api/openapi-404-mensajero.test.ts (20 tests)
```

---

## Mutaciones probadas — cuáles murieron y cuál sobrevivió

Cada test nuevo se mató con una mutación de **código de producción** antes de creérselo. Los
archivos se restauraron con `git checkout --`; `grep -rn MUTACION lib/ app/ docs/` vuelve limpio
(solo quedan menciones preexistentes y ajenas) y el gate posterior está en verde.

| # | Mutación | Resultado |
|---|---|---|
| **M1a** | mapeo: quitar el filtro en memoria `g.anuladaAt === null` de `gestiones[]` | **SOBREVIVIÓ la primera vez** — ver abajo. Tras corregir el escenario: **MUERTA**, 8 rojos (6 en Postgres real) |
| **M1b** | `select`: borrar la rama `{ anuladaAt: null }` del `OR` | **MUERTA** — 10 rojos (8 contra Postgres real + el literal congelado + el `where` de la 268) |
| **M2** | `findDetalleByOrdenIdForOwner`: quitar `tiendaId` del `where` | **MUERTA** — 1 rojo contra Postgres real (R13: la tienda A lee la orden de la B) |
| **M3** | `orderBy` de `gestiones` invertido a `desc` | **MUERTA** — 3 rojos (R10 y R6 contra Postgres real + el literal congelado) |
| **M4** | `primerEstadoPorGestion`: quitar el `continue` → gana la ÚLTIMA transición | **MUERTA** — 1 rojo contra Postgres real (R6). Es el caso que el escenario tiene sembrado a propósito |
| **M5** | `toDetalleDTO`: `row.gestiones.map((g) => ({ ...g }))` (el spread) | **MUERTA** — 6 rojos en la guardia de lista blanca |
| **M6** | `causaTipificadaDeGestion`: `causaDevolucion ?? causaIncidente`, sin mirar el `resultado` | **MUERTA** — 2 rojos (R8: el cruce y los tres resultados que deben dar `null`) |
| **M7** | el composition root que no inyecta: el service devuelve `gestiones: []` | **MUERTA** — 20+ rojos en 3 archivos, incluidos los dos bordes HTTP |
| **M8** | mapeo: `g.mensajero.nombre` en vez de `nombreCompletoUsuario(...)` | **MUERTA** — 3 rojos, incluido el del borde HTTP |
| **M9** | contrato: quitar `gestiones` de `required` en `OrdenDetalle` | **MUERTA** — 2 rojos (R20 y el literal enmendado de la 404) |
| **M10** | contrato: sustituir el `MOTIVO_CAUSA_ENUM` derivado por una lista a mano sin `robado` | **MUERTA** — 3 rojos (R21, los tres asertos) |
| **M11** | mapeo: quitar el recorte en memoria de `evidencias[]` | **MUERTA** — 2 rojos (los dos casos nuevos de no-regresión de la 268) |
| **M12** | `.yaml`: borrar `- gestiones` del `required` del espejo | **MUERTA** — 1 rojo (R20, el espejo) |
| **M13** | CHANGELOG: borrar el aviso (c), el del contador de intentos | **MUERTA** — 1 rojo (R22-c) |
| **M14** ⭑ | mapeo: añadir `"devuelta"` y `"reprogramada"` a la lista `resultado` del filtro de `evidencias[]` (**la mutación del reviewer**) | **SOBREVIVÍA a 9.446 tests.** Tras el arreglo del escenario: **MUERTA — 2 rojos** contra Postgres real (`R15` y `R11 + no-regresión 268`), sobre una corrida de 547 archivos / 9.447 tests |
| **M15** | mapeo: quitar la otra mitad del filtro (`g.evidenciaStoragePath !== null`) | **MUERTA** — 2 rojos contra Postgres real. La fila que la mata es la `entregada` legada sin foto |
| **M16** ⭑ | `select`: añadir UNA relación anidada de más (`historialEstados.actor`) | **MUERTA** — 3 rojos: los dos casos de R19/R19-b (que dicen **qué tabla** sobra) + el literal congelado `SELECT_DETALLE_106` |

### Las DOS que sobrevivieron, y el patrón que comparten

M1a y M14 fallaron por **la misma razón**, y merece la pena decirla de una vez: en los dos casos la
mutación tocaba un filtro **en memoria** cuyo caso de uso **el escenario no producía**. No era que
el aserto fuera flojo: era que la fila que tenía que entrar por esa puerta no existía en la base
sembrada. Un filtro que nunca llega a decidir nada es indistinguible de uno que no está.

Las dos se arreglaron **igual**: añadiendo al escenario la fila que faltaba, no relajando el aserto.
Y la lección operativa es que el superconjunto de esta ficha **movió dos decisiones del SQL a
JavaScript**, así que el escenario tiene que traer, por cada mitad de cada filtro, una fila que la
consulta devuelva y el filtro tenga que rechazar. Ahora las trae:

| Mitad del filtro | Fila que la ejercita |
|---|---|
| `anuladaAt === null` (gestiones) | la `entregada` anulada **con foto** |
| `resultado ∈ {entregada, rechazada, incidente}` (evidencias) | la `devuelta` y la `reprogramada` vigentes **con foto** |
| `evidenciaStoragePath !== null` (evidencias) | la `entregada` legada **sin foto** |

### M1a, la primera que sobrevivió, y por qué el arreglo NO fue tocar el test para que pasara

**Qué pasó.** En la primera versión del escenario de integración la única gestión anulada era una
`devuelta` **sin foto**. A esa la para ya el `where` de la consulta (no casa con ninguna de las dos
ramas del `OR`), así que el filtro en memoria **nunca llegaba a decidir nada** y quitarlo no
cambiaba una sola aserción contra Postgres. La mató, de rebote, un test unitario del repositorio.

**Por qué importa.** R11 tiene **dos redes** y solo una estaba medida en la base. La segunda es la
que actúa sobre una anulada que **sí** vuelve de la consulta: una `entregada` anulada que conserva
su foto, que es un caso real y frecuente (se anula una entrega ya registrada).

**El arreglo.** Entra una quinta gestión al escenario —anulada, `entregada`, **con evidencia**— y
con ella M1a pone en rojo 6 casos contra Postgres. De paso queda afirmada en la base la
no-regresión de la 268: la evidencia de esa anulada **se sigue publicando** en `evidencias[]`.
Está escrito en el commit `c2b14579` y en la cabecera del propio archivo de test.

### M14, la que encontró el reviewer, y lo que la hacía invisible

**Qué pasó.** El escenario sembraba la `devuelta` vigente **SIN foto**. Ese estado **no puede
existir**: la evidencia es obligatoria en `devuelta` desde la feature 75 (comprobado en
`lib/types/gestion-orden.ts`, rama `devuelta` del `discriminatedUnion`). Sin una fila `devuelta` o
`reprogramada` con foto, la mutación de la lista `resultado` no cambiaba **nada** observable, y por
eso sobrevivió a 9.446 tests.

**Por qué importa.** Hasta esta ficha, lo que entraba en `evidencias[]` lo decidía **Postgres**. El
superconjunto lo movió a una línea de JavaScript, y esa línea es contrato público de la 106/268. En
la base local hay **14 filas vigentes con foto** en `devuelta` y `reprogramada`: la fuga habría sido
real, no hipotética.

**El arreglo.** Las dos gestiones vigentes pasan a llevar foto —como en la realidad— y el caso nuevo
de R15 afirma el **conjunto exacto** de `evidencias[]` por nombre de archivo. M14 pasa de
superviviente a **2 rojos**.

### Trampas del repo, cubiertas explícitamente

- *Aserción contra su propia fuente*: los nombres completos (`"Carlos Jimenez Mora"`), los values
  del enum de resultado, los seis values de `motivo` y las fechas del orden esperado se escriben
  **a mano** en todos los sitios donde se afirman. En ninguno se comparan contra
  `nombreCompletoUsuario(...)` ni contra `ESTATUS_POR_RESULTADO`. M8 y M10 lo confirman: si se
  compararan contra su fuente, habrían sobrevivido. El único aserto que **sí** mira a la fuente es
  el de «la lista sale de los seeds y no de una copia», y está declarado como tal: afirma el
  ENGANCHE, no el contenido —que se afirma a mano justo encima—.
- *Los dobles no ven el SQL*: todo lo que depende del `select`/`where`/`orderBy` (el filtro de
  anuladas, el orden, el emparejamiento con el historial, la frontera por tienda, el número de
  consultas) se prueba contra **Postgres real**, y las cuatro contrapruebas del `tasks.md` se
  aplicaron ahí. Nada de eso se afirma sobre un doble.
- *El composition root que no inyecta*: los casos de servicio montan la **cadena real**
  (`route handler → ApiOrdenLecturaService → OrdenRepository → Prisma mockeado`) en vez de un repo
  falso. M7 —el modo de fallo exacto: el módulo importa el dato pero nadie lo pasa— muere en más de
  veinte sitios.
- *Test verde sin datos*: el archivo de integración usa `describe.skip` sin base (nunca un `return`
  silencioso), y cada caso que compara conjuntos afirma además que el escenario **no está vacío**
  (`fotoAntes.gestiones` tiene 5 filas, `historial.length > 0`, la lista de consultas no vacía, las
  tres filas con foto contadas por su nombre). La guardia de no-fuga lleva su propia contraprueba
  («el detector NO esta ciego») y el troceador del CHANGELOG también.
  **Matiz aprendido en la revisión, y es distinto de esto:** un escenario puede no estar vacío y aun
  así no producir el caso que un filtro tiene que rechazar. Eso no lo detecta ninguna contraprueba
  de «hay datos»: lo detecta una **mutación**, y por eso M14 tuvo que venir de fuera.
- *El escenario que describe un imposible*: la `devuelta` sin foto era un estado que ninguna gestión
  creada desde la feature 75 puede tener. **Un escenario irreal no prueba nada**, aunque el test
  pase. Al sembrar filas de integración conviene comprobar el `discriminatedUnion` del borde
  (`lib/types/gestion-orden.ts`) y no solo lo que la columna admite como `NULL`.
- *Literal: contrato o polizón*: los seis literales congelados que esta ficha rompía
  (`SELECT_DETALLE_106`, las dos listas de claves del detalle, el `allOf` de `OrdenDetalle` y los
  dos conteos del `.yaml`) **son el contrato**: se enmiendan con su bloque fechado y siguen siendo
  igualdades exactas. Ninguno pasó a `toContain`, a `toMatchObject` ni a un aserto de longitud.

---

## Lo que queda abierto

1. **T19 bloquea la release, no el código.** La entrada del CHANGELOG está escrita y commiteada,
   pero **el aviso a Daniel Marin hay que MANDARLO** antes de desplegar: el texto de la entrada
   *es* el aviso (se copia y se manda). En particular por lo de `additionalProperties: false`.
2. **Q1 se aplicó con la decisión ya tomada, pero el acuse del integrador no consta.** El texto que
   se le manda está en `requirements.md` §7-Q1 y, dicho de otra manera, en el CHANGELOG. Si
   respondiera que quería el texto libre, **no se implementa**: contradice 256/R22.
3. **Q7, sin el `visitaReal` que no pidió.** Las gestiones sintéticas (99, 100, 237, 240, 276) se
   emiten y se avisan (R22-b). Si al ver el CHANGELOG dice que sin distinguirlas no puede medir
   «tiempos por mensajero», es un campo nuevo y **otra ficha**.
4. **Q8 sigue viva en su ficha.** `estadoResultante` se publica sin `enum` porque el catálogo de
   `estado` está incompleto desde la 109 (faltan `sin_gestionar` y los tres del flujo de devolución
   de la 139). Esta ficha **no** baja esa deuda, igual que la 268 declaró que no entraba en la suya.
5. **La válvula de design §5.3 sigue escrita como contingencia, no como trabajo pendiente.** Cero
   órdenes por encima de 10 gestiones hoy; si alguna superara 50, la salida es un sub-recurso
   paginado, nunca un recorte silencioso.
6. **Verificación humana pendiente del reviewer**, sin sustituto automático: la equivalencia
   palabra por palabra entre `lib/api/openapi-spec.ts` y `docs/api/api-key-openapi.yaml` (no hay
   comparador entre los dos artefactos). Los asertos de `openapi-405-gestiones.test.ts` cubren la
   estructura del espejo —schemas, `required`, `$ref`, los dos `enum` completos—, no su redacción
   entera.
7. **Aviso de convivencia para la 406**, que entra después y toca los mismos tres archivos de
   contrato: todo lo de esta ficha está **localizado y contiguo**. En `openapi-spec.ts`, dos
   constantes juntas arriba (tras `WEBHOOK_ESTADO_ENUM`) y dos schemas seguidos entre `Evidencia` y
   `OrdenDetalle`. En el `.yaml`, el mismo bloque en el mismo sitio. En el CHANGELOG, una entrada
   nueva encabezando el archivo, sin tocar las anteriores. **Ojo con una dependencia de orden en el
   `.yaml`**: `Evidencia` DEBE seguir apareciendo antes que `OrdenGestion` porque
   `openapi-contrato-en-reparto.test.ts` localiza su `enum` con una regex posicional; hay un caso
   en `openapi-405-gestiones.test.ts` que lo afirma explícitamente.
8. **Sin E2E**: el repo no tiene harness de Playwright vivo y esta ficha es backend puro sin
   pantalla. No aplica.
9. **El coste del detalle subió y está aceptado, pero conviene que se sepa:** 6 → **9** consultas.
   Es un endpoint de detalle **unitario**, no un listado, y el número es fijo. Si algún día el
   canal necesitara bajarlo, la palanca está identificada: resolver `estadoResultante` sin la
   relación anidada `estatusDestino` ahorraría una. **No se hace aquí** y no es deuda pendiente:
   es una opción escrita por si el techo cambia.
10. **Los `menores` del reviewer que NO son del implementador**, anotados para que no se caigan:
    `tasks.md` sin casillas `[x]` (ningún `tasks.md` del repo las usa: el checkpoint lleva tiempo
    desalineado con la convención viva) y la entrada de `progress/history.md`, que la escribe el
    leader al cerrar.

---

**Veredicto (2.ª vuelta, tras `progress/review_405.md`):** los dos bloqueantes están cerrados con
medición propia, no con prosa. **R15** vuelve a estar cubierto: la mutación que sobrevivió a 9.446
tests ahora pone **2 rojos** contra Postgres real, y el arreglo fue el escenario —la `devuelta`
llevaba un estado imposible desde la feature 75—, no el aserto. **R19** era inalcanzable tal y como
estaba escrito: se midió (`dev` **6**, esta rama **9**, sin N+1 con 3 ni con 6 gestiones), se
reescribió con esos números, se congelaron las nueve **por nombre de tabla** en un test contra
Postgres, y las **tres** frases que decían lo contrario —incluida una en código de producción— están
corregidas. **16 mutaciones aplicadas, 16 muertas.** `./init.sh` completo, ahora **con `.env`**,
termina con `INIT_EXIT=0`, **1854 archivos ejecutados y ninguno saltado**, de los cuales **231 son
`integration/db`** contra Postgres real.
