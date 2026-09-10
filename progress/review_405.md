# Feature 405 — informe de revisión

**Rama revisada:** `feat/405-gestiones-en-detalle-api` · **PR** #771 · **cabeza** `92655e52`
**Base:** `dev` · **Fecha:** 2026-09-10 · **Agente:** reviewer
**Diff medido:** 24 archivos, +3.196 / −37

> **Nota de herramienta.** El MCP `codebase-memory` está RANCIO para esta zona: `search_graph` con
> `name_pattern=.*ApiMensajeroDTO.*` devuelve `total: 0` para un símbolo que **sí existe**
> (`lib/types/api-orden.ts:53`, confirmado en el archivo real). El índice no conoce lo que aterrizó
> con la 404. La verificación de este informe se hizo sobre el **árbol real** y **ejecutando**.

---

## Veredicto

# RECHAZADO

Dos hallazgos **BLOQUEANTES**, los dos medidos contra la base local, los dos con arreglo barato y
localizado. **Ninguno es un fallo del cuerpo que hoy ve el integrador**: lo que sale por el cable es
correcto. Lo que falla es (1) la red que lo sostiene y (2) un requisito que el código incumple
mientras el spec y un comentario de producción afirman lo contrario.

El resto de la ficha es de calidad alta y así se dice: la bitácora no exagera, las mutaciones que
declara son reproducibles (verifiqué M1a de primera mano), y su honestidad sobre los
`integration/db` saltados en el gate es justo lo que permitió comprobarlos.

---

## Lo que corrí YO (no la bitácora del implementador)

| Qué | Resultado |
|---|---|
| `tests/integration/db/gestiones-detalle-api-405.test.ts` contra Postgres local (worktree con `.env` copiado) | **10 passed / 10**, 0 skipped, 1,69 s |
| Los 13 archivos que la ficha toca o cubre, incluidas las **dos guardias ajenas** | **199 passed / 199** |
| `tsc --noEmit` sobre el worktree de la rama | **TSC_EXIT=0** |
| `eslint` sobre los 5 de producción + los 4 de test nuevos | **exit 0**, sin salida |
| Sonda de conteo de consultas del detalle, en la rama y en `dev` | **9 vs 6** (ver BLOQUEANTE 2) |
| Sonda de datos reales sobre `gestion_orden` | ver BLOQUEANTE 1 |

**Sin `40P01` en ninguna corrida.** El aviso de contención con el otro agente no se materializó: las
tres ejecuciones del archivo de integración (limpia, mutada y limpia otra vez) terminaron con
recuento explícito de tests, nunca con «suite roja y 0 tests fallidos».

**No repetí el gate completo** (`INIT_EXIT=0`, 25.603 tests), como se me indicó.

---

## Checklist de `CHECKPOINTS.md`

### Especificación
- [x] `requirements.md` con R1–R22 en EARS numerado.
- [x] `design.md` con §6 «Alternativas descartadas» y su porqué.
- [~] `tasks.md` existe y está completo. **No hay casillas `[x]`** — y no es de esta ficha: **ningún
      `tasks.md` del repo las usa** (`404` y `401`, ya cerradas, tienen 0 también). El checkpoint
      está escrito contra una convención que el repo no sigue. `menor`, ver hallazgo 3.

### Trazabilidad
- [x] `progress/impl_405.md` contiene el mapa `R<n> → test`, con archivo y **nombre del caso**.
- [~] Cada `R<n>` mapea a un test concreto: **20 de 22 verificados por mí como reales y letales**.
      **R15 queda parcial** (BLOQUEANTE 1) y **R19 tiene un test que mide una propiedad MÁS DÉBIL
      que el requisito** (BLOQUEANTE 2).

### Calidad de código
- [x] `typecheck` sin errores (corrido por mí).
- [x] `lint` sin errores (corrido por mí sobre los archivos de la ficha).
- [x] Los tests de la ficha pasan (corridos por mí, 199/199).
- [x] E2E: **no aplica**. No hay harness de Playwright vivo y esta ficha es backend puro sin
      pantalla. El riesgo se cubre con el archivo contra Postgres real.

### Datos y seguridad
- [x] **Sin migraciones, sin tablas, sin índices, sin endpoints nuevos.** Alcance aditivo
      respetado: el diff no toca `db/`, ni `app/api/.../route.ts`, ni `middleware.ts`, ni
      `feature_list.json`. RLS y `down.sql` no aplican.
- [x] Ningún secreto hardcodeado.
- [x] Webhooks: no se toca ninguno (R16 lo afirma con un barrido del objeto entero).

### Patrón de capas
- [x] Controller intacto. Service sin HTTP. Repositorio con `select` + mapeo fila→fila, el mismo
      patrón que la 106/268/404 ya tenían (`toApiOrdenDetalleRow`). Interfaces en `lib/interfaces/`.

### Multi-país / configuración
- [x] Nada de país, moneda ni cuenta.

### Verificación final
- [x] `./init.sh` completo con `INIT_EXIT=0` (bitácora; no repetido).
- [ ] `progress/review_405.md` con veredicto OK → **este archivo, y el veredicto es RECHAZADO**.
- [ ] Entrada en `progress/history.md`: **no existe**. Se escribe al cerrar (la 404 tampoco la
      tiene); es del leader, no del implementador. `menor`.

---

## Lo que se me pidió juzgar explícitamente

### a) Los `integration/db` saltados en el gate — resuelto, y a favor del implementador

Los corrí yo contra la base local: **10 passed, 0 skipped**. Y no solo pasan: **cubren lo que dicen
cubrir**. Leí las diez aserciones una por una. Nada de `if (!fks) return;` — el archivo usa
`describe.skip` sin base y **falla ruidosamente** en el `beforeAll` si hay base sin catálogo. Cada
comparación de conjuntos lleva su contraprueba de que el escenario **no está vacío**
(`fotoAntes.gestiones` = 5 filas, `historial.length > 0`, `consultas > 0`), y R13 lleva el contraste
de leer la orden ajena **con su propio owner** — sin él, un `null` por un id mal escrito se leería
como «la frontera funciona».

Los siete requisitos que dependen de ese archivo (**R6, R10, R11, R13, R14, R18, R19**) están
ejecutados. R19 pasa, pero mide otra cosa: ver BLOQUEANTE 2.

### b) M1a y el arreglo del escenario — el arreglo es correcto y la mutación ahora muere de verdad

Lo reproduje. Quité el filtro en memoria `g.anuladaAt === null` del mapeo
(`lib/repositories/OrdenRepository.ts:539`) y corrí el archivo contra Postgres:

```
Tests  6 failed | 4 passed (10)
AssertionError: expected [ … ] to have a length of 3 but got 4
```

**6 rojos contra base real.** El arreglo fue el correcto: se arregló el **escenario** —entra una
quinta gestión anulada, `entregada`, **con evidencia**, que la consulta SÍ devuelve por la primera
rama del `OR`—, no el aserto. Es el único caso en el que el filtro en memoria decide algo, y ahora
existe. De paso el caso afirma en la base la no-regresión de la 268: la evidencia de esa anulada
**se sigue publicando**. Bien hecho, y bien contado.

### c) La guardia ajena de la 193/R7 — NO se tocó y NO se burló

`tests/unit/repositories/gestion-ubicacion-solo-escritura.guardia.test.ts` **no aparece en el
diff**: está byte a byte como en `dev`. Lo que se reescribió fue el comentario propio del
implementador en el `select`, que ya no nombra las columnas. La guardia sigue haciendo sus tres
cosas —intrusos, entradas muertas y «ningún repositorio de LECTURA las proyecta»— y la corrí:
**verde**. El `select` de la 405 no proyecta ninguna de las seis formas del nombre.

### d) El espejo `.ts` ↔ `.yaml` — verificación humana hecha, y es fiel

Comparé los dos artefactos bloque a bloque (`Mensajero` y `OrdenGestion` enteros, `OrdenDetalle`, el
`examples`). Coinciden en **orden de claves, `required`, `additionalProperties: false`, los dos
`enum` completos, el `$ref` y la redacción entera de las cinco descripciones**, incluidas las
advertencias de los dos `motivo` y de la asimetría de idioma. **No encontré ni una divergencia.**

### e) La dependencia de ORDEN en el `.yaml` — el test existe y es explícito

`tests/unit/api/openapi-405-gestiones.test.ts` →
«`Evidencia` sigue apareciendo ANTES que `OrdenGestion` en el `.yaml` (el otro test lo asume)», con
`indexOf("    Evidencia:") < indexOf("    OrdenGestion:")`. Corrí ese archivo **y**
`openapi-contrato-en-reparto.test.ts`: los dos verdes. La dependencia posicional ya no puede
romperse en silencio.

### f) Trampas del repo — buscadas activamente, no encontradas

- *Aserción contra su propia fuente*: los nombres completos, los cinco values del resultado, los
  seis de `motivo` y las fechas del orden se escriben **a mano** en todos los sitios donde se
  afirman. El único aserto que mira a la fuente (`[...CAUSA_DEVOLUCION_SEED, ...]`) está declarado
  como comprobación del **enganche**, con el contenido afirmado a mano justo encima. Correcto.
- *Literal: contrato o polizón*: los seis literales congelados que la ficha rompía **son el
  contrato** y se **enmiendan** con bloque fechado, sin relajarse a `toContain` ni a
  `toMatchObject`. Verificado uno a uno en el diff.
- *Los dobles no ven el SQL*: respetado. Los tests de servicio montan la **cadena real** con Prisma
  mockeado y declaran por escrito lo que no pueden medir.
- *Test verde sin datos*: no hay ni un `return` silencioso en todo el diff.

---

## Hallazgos

### BLOQUEANTE 1 — el superconjunto dejó `evidencias[]` colgando de una línea de JS que ninguna prueba mide

**Qué cambió.** Hasta `dev`, lo que entraba en `evidencias[]` lo decidía **Postgres**:
`resultado IN ('entregada','rechazada','incidente') AND evidencia_storage_path IS NOT NULL`. En la
rama el `where` pasa a ser el `OR` con `{ anuladaAt: null }`, así que la consulta **ahora devuelve
también `devuelta` y `reprogramada` con foto**, y lo único que las mantiene fuera del contrato
público es el `.filter()` en memoria de `toApiOrdenDetalleRow`
(`lib/repositories/OrdenRepository.ts:505-509`).

**La medida.** Muté **la mitad `resultado`** de ese filtro —añadí `"devuelta"` y `"reprogramada"` a
la lista— y corrí:

```
tests/unit/{repositories,services,guards,api} + tests/integration/api + el archivo de la 405 en Postgres
Test Files  547 passed (547)
     Tests  9446 passed (9446)
```

**9.446 tests en verde con la fuga puesta.** La otra mitad del filtro sí está cubierta: mutar
`g.evidenciaStoragePath !== null` pone 1 rojo. Es exactamente el patrón «la guardia mide por método,
no por escritura»: media condición vigilada.

**Y no es hipotético.** Sonda sobre la base local, gestiones **vigentes**, por resultado:

```
devuelta      con_foto=6   total=7
reprogramada  con_foto=8   total=12
entregada     con_foto=0   total=12
incidente     con_foto=1   total=2
rechazada     con_foto=4   total=6
```

**14 filas reales** entrarían por esa puerta. Y la foto en `devuelta` **no es casual**: es
**OBLIGATORIA** desde la feature 75 (`lib/types/gestion-orden.ts:397-399`, `evidencias:
evidenciasSchema`). Es decir, la `devuelta` que el escenario de integración siembra **sin**
`evidenciaStoragePath` describe un estado que **no puede existir** para ninguna gestión creada desde
la 75: el escenario es irreal justo en la dimensión que esta ficha volvió frágil.

**Contra qué requisito.** R15 («conservar **sin cambio alguno** … `evidencias[]` en nombre, tipo,
valor y contenido»). El comportamiento de hoy es correcto; lo que falta es la prueba que impida que
deje de serlo, en el punto exacto que el refactor movió de la base a memoria. Los tres tests que la
bitácora cita para R15 no lo tocan: `no-regresion-106` congela el **SQL**, no el filtro en memoria.

**Qué falta para cumplirlo** (barato, sin tocar producción): en
`tests/integration/db/gestiones-detalle-api-405.test.ts`, sembrar la gestión `devuelta` vigente
**CON** `evidenciaStoragePath` —como es en la realidad— y afirmar que `evidencias` **sigue teniendo
exactamente 1 elemento**, el de la anulada `entregada` con foto. Con eso mi mutación muere y el
escenario deja de describir un imposible. Añadir de paso una `reprogramada` con foto lo cierra
entero.

---

### BLOQUEANTE 2 — R19 no se cumple: el detalle pasa de 6 consultas a 9, y el spec afirma que no

**Lo que dice R19**, literal: «DEBE resolver el detalle completo —incluido `gestiones[]`— con el
**MISMO número de consultas a la base de datos que hoy**, sea cual sea el número de gestiones».

**Lo medido**, con el espía `$on("query")` sobre `findDetalleByOrdenIdForOwner`, misma base y misma
orden:

| | consultas |
|---|---|
| `dev` | **6** — `orden`, `order_status`, `gestion_orden`, `orden_incidente`, `orden_incidente_evidencia`, `usuario` |
| rama | **9** — las 6 anteriores **+ `orden_historial_estado`**, **+ un segundo `order_status`** (`estatusDestino`) **+ un segundo `usuario`** (`gestiones.mensajero`) |

**+3 round-trips, un 50 % más.** Prisma resuelve cada relación anidada con su propia consulta: el
superconjunto no añade ninguna —eso es cierto—, pero las **dos relaciones nuevas y sus dos
anidadas** sí.

**Por qué el test no lo ve.** El caso de R19 compara «con 3 gestiones» contra «con 0 gestiones», y
las dos dan el mismo número porque Prisma emite esas consultas igual. Eso demuestra la segunda mitad
de R19 —«no una consulta por gestión»—, que **sí se cumple** y está bien probada. La primera mitad
no la mide nadie.

**Lo que agrava el hallazgo, y es la parte que de verdad bloquea:** hay dos afirmaciones escritas
que dicen lo contrario de lo medido, y una está en **código de producción**:

- `specs/405-gestiones-en-detalle-api/design.md:132` → «gana dos entradas, y **ninguna consulta
  nueva** (R19)»;
- `lib/repositories/OrdenRepository.ts`, cabecera de `API_ORDEN_DETALLE_SELECT` → «**Sigue siendo
  UNA sola consulta (R19)**».

Un comentario que afirma un número falso en el archivo donde vive la decisión es peor que no tener
comentario: el siguiente que llegue se lo va a creer.

**Qué falta para cumplirlo.** Una de las dos, y la decide el humano:

1. **Aceptar el coste y decirlo:** enmendar R19 y el design con el número **medido** (6 → 9, y por
   qué: dos relaciones nuevas con dos anidadas), corregir el comentario de producción, y **congelar
   el 9** en el test de integración —`expect(consultasConGestiones).toBe(9)`—, que es lo que impide
   que mañana sean 15 sin que nadie se entere. Conservando además el aserto actual de 0-vs-N.
2. **O rebajarlo de verdad** (por ejemplo, resolviendo `estadoResultante` sin la relación anidada
   `estatusDestino`), si tres round-trips extra en el detalle no se aceptan.

Lo que **no** vale es dejar el requisito diciendo «el mismo número que hoy», el design diciendo
«ninguna consulta nueva» y el código diciendo «una sola consulta», con la base contando 9.

---

### `menor` 3 — `tasks.md` sin casillas `[x]`

`CHECKPOINTS.md` exige «todas las tasks marcadas `[x]`» y este `tasks.md` no tiene ninguna casilla.
**No es de esta ficha:** `specs/404-…/tasks.md` y `specs/401-…/tasks.md`, ambas cerradas y
desplegadas, tampoco. La convención viva es «una task = un commit» y el cierre se documenta en la
bitácora, que aquí está completa. **No bloquea**, pero el checkpoint lleva tiempo mintiendo y
debería alinearse con la convención real o retirarse.

### `menor` 4 — `progress/history.md` sin entrada de la 405

Es del leader y va al cerrar; la 404 tampoco la tiene todavía. Anotado para que no se caiga.

### `menor` 5 — la bitácora no se llama como pide `tasks.md`

`tasks.md` la nombra `progress/impl_405_backend.md` y está en `progress/impl_405.md`. El
implementador lo declara en la cabecera y la convención viva del repo (`impl_404.md`, `impl_401.md`)
le da la razón. Sin efecto.

### `menor` 6 — T19 sigue abierta y bloquea la RELEASE, no el merge

La entrada del CHANGELOG está escrita, fechada y es copiable tal cual, pero **el aviso al integrador
no consta mandado**, igual que el acuse de Q1. No bloquea el merge a `dev`; **sí** el despliegue a
`prod`, y ahí importa por `additionalProperties: false`.

---

## Trazabilidad R1–R22, verificada por mí

| R | Estado | Cómo lo comprobé |
|---|---|---|
| R1 | ok | `…orden-consulta.route.test.ts` → `toEqual` del array entero sobre la cadena real |
| R2 | ok | servicio (3 casos, uno de tipo) + borde HTTP |
| R3 | ok | guardia: conjunto EXACTO de claves + `Exclude` de tipo |
| R4 | ok | tres fechas distintas a propósito; literal a mano |
| R5 | ok | los cinco values, lista escrita a mano |
| R6 | ok | **Postgres real**: la `devuelta` origina DOS transiciones y la 2.ª va a otro estado |
| R7 | ok | legada sin historial + transición de OTRA gestión + contraste positivo |
| R8 | ok | 6 casos, incluido el cruce con las dos columnas pobladas; texto libre sembrado en la base |
| R9 | ok | guardia + openapi + Postgres (dos mensajeros distintos) + una sola declaración de `ApiMensajeroDTO` en `lib/`, verificada en el árbol |
| R10 | ok | **Postgres real**: literales de fecha + dos lecturas byte a byte |
| R11 | ok | **Postgres real**, las dos redes; **maté M1a yo: 6 rojos** |
| R12 | ok | guardia de no-fuga con su contraprueba + borde HTTP |
| R13 | ok | **Postgres real** con el contraste del owner legítimo |
| R14 | ok | **Postgres real** con un `orden_incidente` sembrado |
| R15 | **PARCIAL** | claves y `evidencias[]` sí; **la mitad `resultado` del filtro nuevo, no** → BLOQUEANTE 1 |
| R16 | ok | 5 casos + barrido del objeto entero |
| R17 | ok | 401/403/422/404, y ninguno menciona la clave nueva |
| R18 | ok | **Postgres real**: filas ENTERAS antes/después + foto no vacía |
| R19 | **NO** | el test mide una propiedad más débil; el requisito literal no se cumple → BLOQUEANTE 2 |
| R20 | ok | 8 casos + **mi cotejo manual** `.ts` ↔ `.yaml` |
| R21 | ok | dos fuentes independientes + contenido a mano + enganche a los seeds |
| R22 | ok | los tres avisos, uno por caso, + contraprueba del troceador |

**20 de 22 con test real, letal y verificado por mí. 1 parcial (R15). 1 incumplido (R19).**

---

## Estado del árbol al cerrar

Todas las mutaciones que apliqué se revirtieron con `git checkout --` y las dos sondas temporales se
borraron (también la copia que llevé al checkout principal para medir el baseline de `dev`).
`git status --porcelain` en el worktree devuelve solo `?? scratchpad/`, que está ignorado.
**No edité código de producción, ni tests, ni `feature_list.json`.**

---

## Qué vuelve al implementador

1. **BLOQUEANTE 1** — sembrar la `devuelta` (y preferiblemente una `reprogramada`) **con foto** en
   el escenario de `tests/integration/db/gestiones-detalle-api-405.test.ts` y afirmar que
   `evidencias` sigue con **exactamente 1** elemento. Comprobar que mutar la lista
   `["entregada","rechazada","incidente"]` del filtro en memoria **muere**.
2. **BLOQUEANTE 2** — llevar al humano la medición 6 → 9. Según lo que decida: enmendar R19 + design
   + el comentario de `API_ORDEN_DETALLE_SELECT` y **congelar el número** en el test, o rebajar el
   coste. Las tres frases que hoy dicen «ninguna consulta nueva» / «una sola consulta» no pueden
   quedarse como están.
3. Al cerrar: entrada en `progress/history.md`, y **mandar** el CHANGELOG al integrador (T19) antes
   de `prod`.

---
---

# RONDA 2 — verificación de los dos bloqueantes (2026-09-10)

**Revisado:** `ae229c7f` (cabeza), sobre `8f807ec9` (los arreglos) y `ae229c7f` (bitácora).
**Método:** volví a aplicar **mi propia mutación** y volví a **medir**; no leí su informe como prueba.

## Veredicto de la ronda 2

# APROBADO

Los dos bloqueantes están cerrados, y cerrados **como se pedía**: el primero arreglando el
**escenario** (no el aserto), el segundo diciendo la verdad medida y **congelándola**. Quedan tres
`menor`, ninguno bloquea.

---

## BLOQUEANTE 1 — cerrado. Mi mutación ahora muere

Reapliqué **exactamente** la mutación de la ronda 1 (M14: añadir `"devuelta"` y `"reprogramada"` a
la lista del `.filter()` en memoria de `toApiOrdenDetalleRow`, `OrdenRepository.ts:522`):

```
Tests  2 failed | 10 passed (12)
 x R11 + no-regresion 268: la ANULADA CON FOTO no entra en `gestiones[]` pero SI en `evidencias[]`
 x R15: `evidencias[]` NO gana las gestiones con foto cuyo resultado no le corresponde
AssertionError: expected [ ...(3) ] to deeply equal [ "entregada:anulada-con-foto.jpg" ]
```

**2 rojos**, donde en la ronda 1 sobrevivía a **9.446 tests en verde**. Coincide con lo que declara
la bitácora.

**¿Puede el caso nuevo pasar en falso por falta de datos?** No, y lo comprobé: la lista `conFoto` se
construye leyendo las **filas reales de la base** (`m.fotoAntes.gestiones`, la foto del `SELECT`, no
el DTO) y se afirma contra un **literal de tres nombres de archivo escrito a mano**, más un
`toHaveLength(3)`. Si la siembra no ocurriera, ese primer `toEqual` cae antes de llegar al aserto
que importa. Es la contraprueba que faltaba en la ronda 1, puesta donde tenía que estar.

El escenario además dejó de describir un imposible: la `devuelta` y la `reprogramada` vigentes
llevan foto (obligatoria en `devuelta` desde la feature 75), y la única `devuelta` sin foto que
queda está **declarada como anterior a esa feature** y encima anulada. Coherente consigo misma.

---

## BLOQUEANTE 2 — cerrado. Repetí la medición y salen los mismos números

Volví a medir con mi propia sonda (`$on("query")` sobre `findDetalleByOrdenIdForOwner`, misma base
local, misma orden), una vez en cada rama:

| rama | consultas | tablas |
|---|---|---|
| `dev` (`48918e60`) | **6** | `orden`, `order_status`, `gestion_orden`, `orden_incidente`, `orden_incidente_evidencia`, `usuario` |
| `feat/405…` (`ae229c7f`) | **9** | las 6 + `orden_historial_estado` + un 2.º `order_status` + un 2.º `usuario` |

**6 y 9 confirmados por mí.** El aumento lo aceptó el leader sobre el número medido y **no lo
reporto como hallazgo**.

**El test nuevo protege de verdad.** Apliqué **M16** por mi cuenta —añadí una relación anidada más
al `select` del detalle (`zona: { select: { id: true } }`)— y:

```
 x R19/R19-b: el detalle emite EXACTAMENTE 9 consultas, y son estas nueve
 x R19: ese numero NO depende del numero de gestiones (no hay N+1)
AssertionError: expected [ "orden", "order_status", ...(8) ] to deeply equal [ ...(7) ]
- Expected
+ Received
+   "zona"
```

**Y el rojo dice CUÁL sobra**: `+ "zona"`, por su nombre de tabla. Eso era justo lo que pedía R19-b.
El tercer rojo que declara la bitácora también está: `orden-repository.no-regresion-106.test.ts` (el
literal congelado del `select`) → **3 rojos en total**, confirmado.

**No hay N+1**, y está afirmado por las dos puntas: `tablasConGestiones` y `tablasSinGestiones`
valen los dos `CONSULTAS_DEL_DETALLE`, así que una orden con 3 gestiones y otra con 0 cuestan las
mismas 9.

### Las tres frases falsas: verificadas en el blob de `origin`, no en su disco

El implementador declara que un `git checkout --` se le llevó dos correcciones sin commitear y las
reaplicó. **Comprobado sobre `git show origin/…:archivo`**, que es lo único que cuenta:

| # | Dónde | Estado en `origin` |
|---|---|---|
| 1 | `OrdenRepository.ts`, cabecera de `API_ORDEN_DETALLE_SELECT` | corregida (l. 294-307): cita la frase vieja, da el 6 → 9 medido y apunta a `CONSULTAS_DEL_DETALLE` |
| 2 | `OrdenRepository.ts`, docblock de `findDetalleByOrdenIdForOwner` | corregida (l. 3123, 3127): «join» retirado, «sin N+1» conservado con su porqué |
| 3 | `design.md` §3.1 | corregida (l. 134): cita «ninguna consulta nueva» como falsa y separa el superconjunto (gratis) de las relaciones nuevas (no) |

**Barrido de residuo** en el archivo de producción entero con
`grep -niE "una sola consulta|ninguna consulta nueva|un solo round-?trip|hace un join"`: las cinco
coincidencias restantes son de **otros métodos** (`groupBy` de lote, consulta de pertenencia,
agregada de página) y describen bien lo suyo. **Ninguna frase falsa más sobre el coste del detalle.**

---

## El gate: el «0 saltados» está respaldado por el log

Verifiqué `scratchpad/gate-405-v2.log` (1,06 MB) yo mismo, no la cita:

| Comprobación | Medida |
|---|---|
| `Test Files` | `1854 passed (1854)` — ni un archivo saltado |
| Líneas con la flecha de salto en TODO el log | **0** |
| Archivos `tests/integration/db/*.test.ts` distintos que aparecen | **231** |
| El de esta ficha | `tests/integration/db/gestiones-detalle-api-405.test.ts (12 tests) 1372ms`, en verde |
| `40P01` / `deadlock` en el log | **0 coincidencias** |
| Cierre | `.env presente`, `== init OK ==`, **`INIT_EXIT=0`** |

Los 26 `skipped` son **casos sueltos de otros archivos**, no archivos enteros, y los cuatro de esta
ficha reportan sus 12 / 19 / 10 / 26 tests ejecutados.

---

## Lo que corrí yo en esta ronda

| Qué | Resultado |
|---|---|
| El archivo de integración, **5 veces seguidas** | **12/12 passed** las cinco. Sin `40P01`, sin flake |
| Los 13 archivos de la ficha | **201 passed / 201** (eran 199; +2 casos nuevos) |
| `tsc --noEmit` | **TSC_EXIT=0** |
| Mi mutación M14 reaplicada | **2 rojos** |
| Mi mutación M16 (una relación más) | **3 rojos**, y el rojo nombra `zona` |
| Sonda de consultas en las dos ramas | **6** y **9** |

---

## Hallazgos de la ronda 2 — ninguno bloqueante

### `menor` 7 — el congelado de las 9 consultas es SENSIBLE AL ORDEN, y el orden depende del camino

`CONSULTAS_DEL_DETALLE` se compara con `toEqual` sobre una lista **ordenada**. Ese orden no es el
mismo por todos los caminos: mi sonda, que llama al repositorio **fuera** de una transacción, obtiene
las mismas nueve tablas en **otro orden** (`gestion_orden, orden_historial_estado, orden_incidente,
usuario, order_status, orden_incidente_evidencia, usuario` tras las dos primeras) que el que congela
el test, que corre **dentro** de `enTransaccionRevertida`. El multiconjunto es idéntico; la
secuencia no.

Dentro del camino que el test usa es **estable: 5 corridas de 5**, así que no es un flake observado y
no bloquea. Pero el congelado descansa en un detalle de planificación de Prisma que ya se demostró
distinto en otro camino. **Sugerencia, no exigencia:** comparar los dos lados ordenados —o como
multiconjunto—; se conserva íntegro lo que de verdad protege (cuántas y cuáles, con el nombre de la
que sobra en el rojo) y deja de depender de en qué orden las despacha el motor.

### `menor` 8 — queda una cuarta frase con la afirmación vieja, en la bitácora

`progress/impl_405.md:61`, en la sección «el SUPERCONJUNTO», sigue diciendo: «… y
`toApiOrdenDetalleRow` vuelve a aplicar cada predicado en memoria … **Sigue siendo una sola consulta
(R19)**». Es exactamente la frase que se corrigió en el código y en el design. En su contexto se
refiere al superconjunto —que sí es gratis— pero la cita a R19 la vuelve engañosa, y la propia ficha
ya separó los dos matices en los otros dos sitios. **No bloquea**: es la bitácora, no el contrato ni
el código. Conviene alinearla al cerrar.

### `menor` 9 — la fila de R19-b en la tabla de trazabilidad está a medio escribir

`requirements.md`, tabla §6: «`openapi-405-gestiones.test.ts` no aplica; las frases del design y del
comentario se verifican a ojo en la revisión». Es **honesto y cierto** —esa mitad de R19-b es
verificación humana y la hice—, pero la celda mezcla el test que sí existe con una nota de proceso.
Cosmético.

### Siguen abiertos de la ronda 1, sin cambio

`menor` 3 (`tasks.md` sin casillas, convención del repo), `menor` 4 (`progress/history.md` al
cerrar) y `menor` 6 (**T19: mandar el CHANGELOG al integrador bloquea la RELEASE**, no el merge).

---

## Trazabilidad, actualizada

**22 de 22 requisitos (23 con R19-b) tienen test real, letal y verificado por mí.**

- **R15** pasa de PARCIAL a **ok**: caso nuevo, y mi mutación muere con 2 rojos.
- **R19** pasa de INCUMPLIDO a **ok**: reescrito sobre el número medido, que confirmé.
- **R19-b** entra **ok**: las 9 congeladas por nombre de tabla; mi mutación muere con 3 rojos y el
  rojo nombra la que sobra.

## Estado del árbol al cerrar la ronda 2

Las dos mutaciones (M14 y M16) revertidas con `git checkout --` y la sonda temporal borrada, aquí y
en el checkout principal. `git status --porcelain` en el worktree: solo `?? scratchpad/`, ignorado.
**No edité código de producción, ni tests, ni `feature_list.json`.**

**Veredicto final de la ficha 405: APROBADO.** Antes de `prod`, T19.
