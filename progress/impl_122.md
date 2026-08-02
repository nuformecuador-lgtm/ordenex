# Feature 122 — analítica: resolutor de alcance por rol · bitácora de implementación

Rama: `feature/122-analitica-alcance-por-rol` · fecha: 2026-07-31 · fase 2 del arnés SDD.

> **T0.3 leída y acatada.** Queda constancia de que el implementer leyó la nota de
> discrepancia de D3 (`requirements.md > D3 > ⚠`): la spec fija el comportamiento de la
> **columna elegida** (`orden.mensajero_asignado_id`), cuyo efecto es que tras la
> reasignación A→B **B alcanza la fila y la gestión de A, y A deja de alcanzarla**. Está
> implementado así y fijado por el test nombrado «orden reasignada de A a B». No se
> reinterpretó ninguna de las diez decisiones.

---

## 1. Archivos creados / modificados

**Creados — módulo (`lib/analytics/`, 5 archivos):**

- `lib/analytics/alcance.ts` — `ActorAnalitica`, `AlcanceDatos`, `MotivoDenegacion`,
  `ResolucionAlcance`, `ROLES_SIN_ANALITICA`, `esRolAnalitica`, `rolTieneAccesoTotal`,
  `resolverAlcance`.
- `lib/analytics/alcance-columnas.ts` — `whereOrden`, `whereGestionOrden`, `whereRollup`.
- `lib/analytics/consulta.ts` — `ConsultaAnalitica` (opaco), `PreparacionAnalitica`,
  `prepararConsultaAnalitica` (**único** export de runtime).
- `lib/analytics/identidad.ts` — `politicaIdentidadMensajero`, `seudonimizarMensajeros`,
  `ETIQUETA_MENSAJERO`.
- `lib/analytics/auditoria.ts` — `RegistroDenegado`, `describirDenegado`, `ACTOR_DESCONOCIDO`.

**Creados — tests (`tests/unit/analytics/`, 13 archivos):**
`alcance.test.ts`, `alcance-adaptadores.test.ts`, `alcance-matriz.test.ts`,
`alcance-granos.test.ts`, `consulta.test.ts`, `identidad.test.ts`, `auditoria.test.ts`,
`actor.test.ts`, `alcance-fuente-unica.guardia.test.ts`, `alcance-columnas.guardia.test.ts`,
`alcance-dinero.guardia.test.ts`, `alcance-obligatorio.guardia.test.ts`,
`aislamiento.guardia.test.ts`, `alcance-bordes.guardia.test.ts`.

**Modificado — la ÚNICA excepción autorizada (D8/T5.1):**
`tests/unit/analytics/modulo-puro.guardia.test.ts` (clausura transitiva + `ARISTAS_PERMITIDAS`).

Ningún archivo en `db/migrations/`, `app/`, `components/`, `lib/actions/`, `lib/services/`
ni `lib/repositories/`.

---

## 2. T1.1 — Baseline (medido, no citado)

**El baseline de la spec no se reprodujo, y la causa NO era el código.** Se documenta
entero porque cualquiera que mida en este worktree se topará con lo mismo.

Primera medición (`pnpm db:generate` + `./init.sh`, árbol recién instalado):

```
 Test Files  302 failed | 363 passed (665)
      Tests  47 failed | 4012 passed (4059)
TypeError: Package import specifier "#main-entry-point" is not defined imported from
  ...\node_modules\.pnpm\@prisma+client@7.8.0...\node_modules\.prisma\client\default.js
```

Diagnóstico reproducido paso a paso (no es la versión de Prisma, es la RUTA):

- `require("@prisma/client")` falla en este worktree con `ERR_PACKAGE_IMPORT_NOT_DEFINED`,
  aunque `.prisma/client/package.json` **sí** declara `#main-entry-point` (comprobado
  leyendo el archivo).
- La misma versión funciona en el checkout principal. Diferencia: la longitud de la ruta.
  `path.resolve(".prisma/client/package.json").length === 266` en el worktree (> 260) y
  ~164 en el checkout principal. El lector interno de `package.json` de Node en Windows no
  abre rutas de más de `MAX_PATH` y trata el scope como inexistente ⇒ el especificador
  `#main-entry-point` queda «no definido».
- Verificado copiando el directorio generado a una ruta corta: ahí la resolución de
  `#main-entry-point` **sí** progresa.
- `pnpm install --force` no lo arregla (el árbol no estaba roto). Mover el *virtual store*
  a una ruta corta lo arregla en runtime pero rompe la resolución de tipos de
  `@testing-library/jest-dom` (1832 errores de typecheck), así que se descartó.
- **Solución aplicada, solo en `node_modules` (no versionado):** sustituir el especificador
  `#main-entry-point` por `./index.js` en `.prisma/client/{default,edge}.js`
  (`scratchpad/parche-prisma-longpath.js`). Hay que reaplicarlo tras cada
  `pnpm install` / `prisma generate` **en este worktree**; en el checkout principal no hace
  falta.

Baseline real, ya con el entorno sano (`./init.sh`, con los 5 módulos nuevos presentes y
todavía sin tests nuevos):

```
 Test Files  3 failed | 670 passed (673)
      Tests  3 failed | 8141 passed (8144)
```

Los tres rojos, uno a uno:

1. `tests/unit/analytics/definiciones-catalogo.guardia.test.ts > ... > ningun archivo de
   lib/analytics atribuye por la zona del usuario` — **causado por esta feature**: un
   comentario de `alcance.ts` escribía el literal `usuario.zona_id`, y ese guardia heredado
   de la 135 censa **también los comentarios** a propósito. Corregido reescribiendo el
   comentario; el guardia vuelve a verde sin tocarlo.
2. `tests/unit/guards/no-embalaje.test.ts` — `Test timed out in 20000ms`. Recorre el repo
   entero; cae por contención bajo la suite completa.
3. `tests/components/LoginForm.test.tsx > R17: otp_invalid ...` — flake de render bajo carga.

2 y 3 **pasan en aislado** y no tocan analítica:

```
$ npx vitest run tests/unit/guards/no-embalaje.test.ts tests/components/LoginForm.test.tsx
 Test Files  2 passed (2)
      Tests  27 passed (27)
```

> **Discrepancia con la spec, registrada:** `design.md §9` y `tasks.md T1.1` afirman «665
> archivos / 8052 tests, 0 rojos» sobre `origin/dev`. Lo medible en la base de esta rama es
> **673 archivos / 8144 tests**, y con instalación limpia de `origin/dev` (lock 7.8.0) el
> gate NO está verde en este worktree por el problema de MAX_PATH descrito. El criterio de
> cierre usado aquí es **delta cero contra el baseline medido hoy**, no contra la cifra
> citada.

---

## 3. T1.2 — Contrato de la 135 presente

Los cuatro módulos (`types`, `metrics`, `ranges`, `filters`) y sus **ocho** suites están en
la rama y en verde. `tests/unit/analytics/frontera.guardia.test.ts` **no existe** y no se
recreó: su ausencia es correcta (PR #232). Lo que cubría se reparte según R33: la parte
permanente la absorbe el censo por directorio de `modulo-puro.guardia.test.ts`; la parte de
rama es la comprobación de cierre de §6.

---

## 4. Mapa `R<n> → test` (41/41, con el `it` exacto)

| R | Archivo | `it` |
|---|---|---|
| R1 | `alcance.test.ts` | `devuelve ok o denegado para las 5 x 23 combinaciones de rol y metrica` · `no lanza con entradas basura: null, undefined, objeto vacio, rol numerico` · `no lanza con un metricaId que no es cadena y lo trata como metrica desconocida` |
| R2 | `alcance.test.ts` | `todo rol con alcance total en la metrica resuelve global, sin recorte de filas` |
| R3 | `alcance-fuente-unica.guardia.test.ts` | `para las 23 metricas, {rol : alcance[rol]==='total'} es exactamente ROLES_ACCESO_TOTAL` · `el modulo de alcance pregunta a esAccesoTotal y no declara su propia lista de roles totales` · `rolTieneAccesoTotal delega en esAccesoTotal para los cinco roles` |
| R4 | `alcance.test.ts` | `resuelve la zona del actor y no otra` · `la zona sale del actor: cambiarla cambia el alcance` |
| R5 | `alcance-columnas.guardia.test.ts` | `el adaptador de orden nombra zonaId de orden y ninguna zona de usuario` · `censo: ningun archivo de lib/analytics nombra la zona del usuario como recorte` · `autocomprobacion: el censo detecta un adaptador que recorta por usuario.zonaId` |
| R6 | `alcance.test.ts` | `la tienda es el usuarioId del actor, porque el adminTienda ES la tienda` · `no toma la tienda de ningun otro campo del actor` |
| R7 | `alcance.test.ts` / `alcance-columnas.guardia.test.ts` | `resuelve el mismo alcance de mensajero para TODA metrica, sin excepcion por unidadDeConteo` · `censo: gestion_orden.mensajero_id no aparece como columna de recorte en lib/analytics` |
| R8 | `alcance-fuente-unica.guardia.test.ts` | `ningun archivo del repo fuera de metrics.ts declara una tabla de alcance por rol` · `metrics.ts si declara una: el censo mira donde debe y no pasa por vacio` |
| R9 | `alcance.test.ts` | `las 8 financieras x los 3 roles sin dinero dan 24 denegados por metrica_prohibida` |
| R10 | `alcance.test.ts` | `actor null y actor undefined dan sin_sesion` · `un actor sin usuarioId util tambien es sin_sesion` |
| R11 | `alcance.test.ts` / `alcance-fuente-unica.guardia.test.ts` | `rol apiKey da rol_sin_analitica en las 23 metricas` · `apiKey se deniega ANTES de mirar el catalogo: tampoco filtra si la metrica existe` · `ROLES_ANALITICA union ROLES_SIN_ANALITICA es exactamente el enum del esquema` · `ninguna metrica del catalogo declara alcance para apiKey` |
| R12 | `alcance.test.ts` | `los SEIS RolValue del esquema reciben veredicto explicito y ninguno cae en un default permisivo` · `un rol inventado y el label de la DB 'Admin Tienda' dan rol_desconocido` |
| R13 | `alcance.test.ts` | `zonaId null, cadena vacia y ausente dan sin_zona_asignada y nunca global` · `un adminSatelite sin zona no ve NINGUNA metrica operativa` |
| R14 | `alcance.test.ts` | `un id que no esta en el catalogo se deniega para todos los roles` |
| R15 | `consulta.test.ts` | `parsea antes de resolver el rango y el rango antes que el alcance` · `el resolutor recibe el actor y el id de metrica, nunca el filtro crudo` · `no existe funcion publica que devuelva un filtro parseado sin alcance resuelto` |
| R16 | `consulta.test.ts` | `un literal con los cuatro campos NO es asignable a ConsultaAnalitica` (`@ts-expect-error`) |
| R17 | `consulta.test.ts` | `una firma de repositorio no acepta el filtro parseado suelto en vez de la consulta` (`@ts-expect-error`) |
| R18 | `alcance-obligatorio.guardia.test.ts` | `ningun archivo de lib/{repositories,services,actions} consulta analitica sin el tipo opaco` + 5 de autocomprobación (`acepta el consumidor legitimo que recibe ConsultaAnalitica`, `rechaza el repositorio que consulta orden con el filtro parseado suelto`, `rechaza el repositorio que lee analytics_daily con SQL crudo`, `no marca un repositorio que consulta orden FUERA del contexto de analitica`, `no se deja enganar por una mencion de ConsultaAnalitica en un comentario`) |
| R19 | `consulta.test.ts` | `una clave desconocida devuelve validation_error con fieldErrors bajo su propio nombre` · `un rango invalido devuelve validation_error y tampoco resuelve alcance` · `una entrada invalida NO revela si la metrica existe ni que ve el rol` |
| R20 | `consulta.test.ts` | `adminTienda con [propia, ajena] conserva SOLO la propia` · `sin filtro de la dimension recortada, el recorte se ESCRIBE igualmente en el filtro` · `un maestro (alcance global) conserva su filtro tal cual, sin recorte inventado` · `el filtro de OTRAS dimensiones no se toca: el recorte es de una sola dimension` |
| R21 | `consulta.test.ts` | `adminTienda que pide SOLO una tienda ajena => forbidden/filtro_fuera_de_alcance` · `adminSatelite que pide una zona ajena => forbidden, nunca ok con lista vacia` · `mensajero que pide las ordenes de otro mensajero => forbidden` |
| R22 | `alcance-matriz.test.ts` | `las 5 x 23 x 4 combinaciones quedan afirmadas, sin ninguna fila fuera del alcance` (460 casos, contados en la aserción) · `el caso ajeno de un rol acotado siempre es forbidden, nunca ok con cero filas` · `el caso mixto de un rol acotado conserva SOLO lo propio` · `el universo sintetico tiene filas propias Y ajenas: el test no puede pasar por vacio` |
| R23 | `alcance-adaptadores.test.ts` | `traduce los cuatro tipos de alcance a las tres columnas canonicas de orden` · `traduce los cuatro tipos de alcance con el mismo vocabulario que orden` · `el fragmento de global es vacio: no inventa condiciones` |
| R24 | `alcance-adaptadores.test.ts` | `recorta zona, tienda Y mensajero a traves de la relacion orden` · `nunca recorta por gestion_orden.mensajeroId, aunque exista y sea NOT NULL (D3)` · `ningun fragmento de ninguna tabla nombra mensajeroId fuera de la relacion orden` |
| R25 | `alcance-dinero.guardia.test.ts` | `el modulo de adaptadores exporta exactamente los tres de la operativa` · `no exporta adaptador para wallet, pago al mensajero ni cierres` · `las 8 financieras solo declaran total o prohibido` · `autocomprobacion: detecta una metrica financiera acotada inyectada a mano` |
| R26 | `aislamiento.guardia.test.ts` | `el where de toda metrica operativa contiene la igualdad de SU tienda` · `con dos tiendas en el universo, la ajena queda fuera del where` |
| R27 | `aislamiento.guardia.test.ts` | `el where recorta por orden.zonaId en toda metrica operativa` · `caso D9: una orden de la zona B gestionada por un mensajero de la zona A NO es alcanzable` |
| R28 | `aislamiento.guardia.test.ts` / `consulta.test.ts` | `el cubo sin_asignar queda FUERA del alcance del mensajero: no es suyo por no ser de nadie` · **`orden reasignada de A a B: tras la reasignacion la alcanza B y no A — COMPORTAMIENTO ESPERADO (D3)`** · `mensajero que pide el cubo sin_asignar => forbidden: esas ordenes no son suyas (R28)` |
| R29 | `aislamiento.guardia.test.ts` | `los 3 roles x las 8 financieras se deniegan antes de producir ningun where` |
| R30 | `actor.test.ts` | `un Actor completo (con zonaId) vale como ActorAnalitica sin conversion` · `un Actor sin zonaId (el campo es opcional en el repo) tambien vale` · `un Actor con zonaId null (lo que devuelve resolveActorFromSession) tambien vale` · `la asignacion inversa NO se permite: 'rol: string' no es un RolValue` · `ningun archivo de lib/analytics importa interfaces/services ni next/headers` |
| R31 | `modulo-puro.guardia.test.ts` | `no declara use server en ningun archivo de lib/analytics` · `no importa @/lib/db, repositorios, servicios ni acciones en lib/analytics` · `no importa next/headers ni ningun modulo de peticion en lib/analytics` · `no importa @prisma/client como valor en lib/analytics` · `no lee variables de entorno en lib/analytics` · `importa los nueve modulos sin DATABASE_URL y ninguno lanza` |
| R32 | `consulta.test.ts` / `identidad.test.ts` | `dos invocaciones con el mismo now dan un resultado identico` · `el instante se inyecta: dos 'now' distintos dan rangos distintos` · `dos invocaciones con la misma entrada dan exactamente las mismas etiquetas (R32)` |
| R33 | **sin test, por diseño** | Parte permanente: `censa los nueve modulos del contrato y ninguno mas se cuela sin vigilancia` (lee el directorio). Parte de rama: comprobación de cierre §6 con la salida pegada. |
| R34 | `alcance.test.ts` | `todo motivo emitido pertenece a la union declarada y no contiene ids ni PII` · `resolver un alcance no escribe nada en consola` · (+ `describirDenegado es puro: construye el registro y no escribe en consola`) |
| R35 | `modulo-puro.guardia.test.ts` | `la clausura sale de lib/analytics y llega a archivos que ningun import directo nombra` · `ninguna arista de la clausura viola las reglas de pureza, salvo la permitida por D8` · `no existe un segundo guardia de pureza en tests/unit/analytics: hay uno, y es este` |
| R36 | `modulo-puro.guardia.test.ts` | `ARISTAS_PERMITIDAS tiene exactamente una entrada y lleva su motivo escrito` · `la arista permitida existe de verdad hoy: si desapareciera, la lista sobraria` · `autocomprobacion: la misma arista con el cliente, con default o con namespace sale ROJA` · `autocomprobacion: otra arista transitiva prohibida, inyectada a mano, sale ROJA` · `la clausura completa se importa SIN DATABASE_URL y no lanza (la prueba que manda)` |
| R37 | `alcance-granos.test.ts` | `para cada rol con alcance total o acotado, los granos solicitables son los del catalogo` · `D4 · adminSatelite puede desagregar por tienda dentro de su zona` · `D5 · adminTienda puede desagregar por mensajero sobre sus propias ordenes` · `D6 · mensajero puede desagregar por tienda sobre sus propias ordenes` · `censo: ningun archivo de lib/analytics mapea un rol a una lista de granos` |
| R38 | `identidad.test.ts` | `adminTienda => seudonima; los otros cuatro roles => real` · `la consulta preparada expone la politica resuelta del actor` · `asigna Mensajero 1..N por orden de primera aparicion y repite la etiqueta del mismo id` · `la etiqueta NO se deriva del uuid: cambiar el uuid sin cambiar la posicion no la cambia` |
| R39 | `identidad.test.ts` | `JSON.stringify del resultado completo no contiene ningun uuid de la fixture` · `la funcion no devuelve la correspondencia seudonimo -> id real: no hay forma de pedirla` · `el id real desaparece del TIPO, no solo del valor` |
| R40 | `auditoria.test.ts` / `alcance-bordes.guardia.test.ts` | `un forbidden invoca logger.logError con rol, usuarioId, tienda pedida, filtro y motivo` · `normalizeError(new ForbiddenError(), spy) devuelve la shape y NO llama al spy` · `por eso un borde que solo lanza ForbiddenError produce un 403 MUDO (fixture infractor)` · `el borde que lanza ForbiddenError responde 403 pero NO audita: sale rojo` · `es exactamente por lo que R40 espia el logger y no el status` |
| R41 | `consulta.test.ts` / `alcance-bordes.guardia.test.ts` | `la union de PreparacionAnalitica incluye forbidden con motivo y no un ok vacio` · `cada motivo de denegacion llega intacto al borde para que pueda distinguirlos` · `el borde correcto audita una vez y responde 403` · `autocomprobacion: el borde que devuelve {data: []} sale ROJO` · `autocomprobacion: el borde que devuelve 200 con ceros sale ROJO aunque audite` |

---

## 5. Disciplina de aceptación: MUTACIÓN PROBADA (12/12)

Cada mutación rompe la implementación a propósito, corre las suites afectadas y se revierte
(`scratchpad/mutaciones.js`). **Ninguna quedó verde.**

```
=== R13 · adminSatelite sin zona degrada a alcance GLOBAL en vez de denegar        DETECTADA
=== R11 · apiKey deja de estar excluida de analitica                               DETECTADA
=== R6  · el alcance del adminTienda deja de ser su propia tienda                  DETECTADA
=== R7-R24 · gestion_orden se recorta por su propia columna mensajero_id           DETECTADA
=== R20-R21-R28 · el filtro del cliente deja de intersecarse con el alcance        DETECTADA
=== R19 · el alcance se resuelve aunque el parseo del filtro haya fallado          DETECTADA
=== R38 · el adminTienda pasa a politica de identidad REAL                         DETECTADA
=== R39 · la etiqueta seudonima se deriva del uuid real                            DETECTADA
=== R40 · el registro de auditoria reenvia el filtro crudo entero (con PII)        DETECTADA
=== R36 · la allowlist de pureza se agranda para colar el cliente de Prisma        DETECTADA
=== R9-R29 · una metrica prohibida deja de denegarse y cae al recorte              DETECTADA
=== R18 · el censo de alcance obligatorio deja de mirar el SQL crudo               DETECTADA

RESUMEN: 12/12 mutaciones detectadas
```

Salida real de cuatro de ellas, con el nombre del test que se pone rojo:

**R13 — `sin_zona_asignada` degradado a `global`:**
```
     × zonaId null, cadena vacia y ausente dan sin_zona_asignada y nunca global 31ms
     × un adminSatelite sin zona no ve NINGUNA metrica operativa 6ms
 FAIL  tests/unit/analytics/alcance.test.ts > R13 · adminSatelite sin zona => denegado/sin_zona_asignada (D2) > zonaId null, cadena vacia y ausente dan sin_zona_asignada y nunca global
      Tests  2 failed | 19 passed (21)
```

**R7/R24 — `gestion_orden` recortado por su propia columna `mensajeroId`:**
```
     × ningun fragmento producido lleva mensajeroId en el primer nivel de gestion_orden 13ms
     × el recorte de mensajero viaja SIEMPRE por la relacion orden 11ms
     × el where recorta por orden.mensajeroAsignadoId, tambien en gestion_orden 26ms
     × orden reasignada de A a B: tras la reasignacion la alcanza B y no A — COMPORTAMIENTO ESPERADO (D3) 2ms
      Tests  4 failed | 13 passed (17)
```

**R20/R21/R28 — la intersección alcance ∩ filtro siempre devuelve verdadero:**
```
     × adminTienda que pide SOLO una tienda ajena => forbidden/filtro_fuera_de_alcance 40ms
     × adminSatelite que pide una zona ajena => forbidden, nunca ok con lista vacia 9ms
     × mensajero que pide las ordenes de otro mensajero => forbidden 20ms
     × mensajero que pide el cubo sin_asignar => forbidden: esas ordenes no son suyas (R28) 5ms
     × el caso ajeno de un rol acotado siempre es forbidden, nunca ok con cero filas 43ms
      Tests  5 failed | 20 passed (25)
```

**R39 — la etiqueta seudónima se deriva del uuid real:**
```
     × asigna Mensajero 1..N por orden de primera aparicion y repite la etiqueta del mismo id 35ms
     × la etiqueta NO se deriva del uuid: cambiar el uuid sin cambiar la posicion no la cambia 4ms
     × el cubo sin_asignar se conserva: no es una persona a la que seudonimizar 3ms
     × JSON.stringify del resultado completo no contiene ningun uuid de la fixture 11ms
      Tests  4 failed | 6 passed (10)
```

---

## 6. T5.5 — Frontera de la rama (R33), comprobada en el cierre

`frontera.guardia.test.ts` **no se resucitó** (PR #232): un guardia que mide el diff caduca
en el siguiente merge. Comando y salida:

```
$ git diff --name-only $(git merge-base origin/dev HEAD)..HEAD
feature_list.json
progress/current.md
specs/122-analitica-alcance-por-rol/design.md
specs/122-analitica-alcance-por-rol/requirements.md
specs/122-analitica-alcance-por-rol/tasks.md
lib/analytics/alcance-columnas.ts
lib/analytics/alcance.ts
lib/analytics/auditoria.ts
lib/analytics/consulta.ts
lib/analytics/identidad.ts
progress/impl_122.md
tests/unit/analytics/actor.test.ts
tests/unit/analytics/aislamiento.guardia.test.ts
tests/unit/analytics/alcance-adaptadores.test.ts
tests/unit/analytics/alcance-bordes.guardia.test.ts
tests/unit/analytics/alcance-columnas.guardia.test.ts
tests/unit/analytics/alcance-dinero.guardia.test.ts
tests/unit/analytics/alcance-fuente-unica.guardia.test.ts
tests/unit/analytics/alcance-granos.test.ts
tests/unit/analytics/alcance-matriz.test.ts
tests/unit/analytics/alcance-obligatorio.guardia.test.ts
tests/unit/analytics/alcance.test.ts
tests/unit/analytics/auditoria.test.ts
tests/unit/analytics/consulta.test.ts
tests/unit/analytics/identidad.test.ts
tests/unit/analytics/modulo-puro.guardia.test.ts
```

- **0** archivos en `db/migrations/`, **0** en `app/`, **0** en `components/`, **0** en
  `lib/{actions,services,repositories}/`.
- Código y tests: solo `lib/analytics/**` y `tests/unit/analytics/**`.
- **Exactamente una** excepción heredada modificada:
  `tests/unit/analytics/modulo-puro.guardia.test.ts` (D8), en commit propio y aislado.
- Los cinco archivos de `specs/`, `feature_list.json` y `progress/current.md` son de los
  commits de fase 1 (spec + bookkeeping del leader), previos a esta implementación;
  `progress/impl_122.md` es esta bitácora, exigida por T5.5/T6.1.

---

## 7. Decisiones de implementación que conviene que el reviewer mire

1. **`ROLES_SIN_ANALITICA = ["apiKey"]`** vive en `alcance.ts`. Hacía falta para distinguir
   `rol_sin_analitica` (R11) de `rol_desconocido` (R12) sin importar el enum de Prisma como
   valor. **No** es una segunda tabla de alcance (R8): no dice qué ve nadie. El guardia exige
   `ROLES_ANALITICA ∪ ROLES_SIN_ANALITICA ≡ Object.values(RolValue)`, así que un rol nuevo en
   el esquema pone el guardia rojo en vez de caer en un limbo.
2. **`rolTieneAccesoTotal`** es el único uso de `esAccesoTotal` dentro del módulo (R3) y el
   que crea la arista transitiva que D8 vigila. Si se retirase, la allowlist de R36 sobraría
   — y hay un test que lo detecta (`la arista permitida existe de verdad hoy`).
3. **`ARISTAS_PERMITIDAS` es de arista + nombre**, no de archivo ni de paquete: la misma
   arista desde otro archivo, o con otro nombre importado, sale roja (probado con fixture).
4. **El guardia transitivo no juzga las aristas de solo tipo** fuera de `lib/analytics/**`.
   Hallazgo real al implementarlo: la clausura llega a `lib/types/order-status.ts:91`, que
   usa `import("@/lib/interfaces/repositories/IOrdenRepository").OrderStatusLiteRow` **en
   posición de tipo**. Eso se borra en compilación y no puede romper la pureza; contarlo como
   «importa la capa repositories» sería un falso rojo que acabaría con alguien aflojando el
   guardia. La regla dura («ni siquiera como tipo») **sigue intacta** en el censo directo de
   `lib/analytics/**`, y hay dos tests que fijan las dos mitades
   (`distingue una arista de TIPO (borrada) de una de VALOR (real) fuera de lib/analytics`,
   `dentro de lib/analytics la regla dura sigue intacta: ni siquiera como tipo`).
5. **`MENSAJERO_SIN_ASIGNAR` no se seudonimiza** (`identidad.ts`): no es una persona, es el
   cubo «órdenes sin mensajero». Etiquetarlo `Mensajero N` inventaría un repartidor. Es una
   derivación de implementación, no una decisión de la puerta; queda señalada.
6. **`adminSatelite` + grano `mensajero` ⇒ política `real`** tal como fija R38. Sigue siendo
   el punto derivado que `requirements.md > Preguntas abiertas` deja para confirmación humana.

### Discrepancia con el `design.md` que el reviewer debe conocer

`design.md §3.4` afirma que «un `{ metrica, filtro, rango, alcance } as ConsultaAnalitica`
desde `lib/repositories/` **no compila**». **Eso no es cierto con un `unique symbol`**: una
aserción `as` solo exige comparabilidad en *alguna* dirección, y `ConsultaAnalitica` sí es
asignable al tipo del literal (tiene esas propiedades y una más), así que TypeScript **acepta
el `as`**. Lo que sí falla —y es lo que R16 pide literalmente, «construir ese valor con un
literal»— es la **asignación** `const c: ConsultaAnalitica = { ... }`, y así está probado
con `@ts-expect-error`. Se deja escrito en vez de disimularlo: quien quiera cerrar también el
`as` tendría que cambiar el tipo opaco por una clase con campo privado, y eso es una decisión
de diseño nueva, no un arreglo de paso.

---

## 8. Verificación final — salida real de `./init.sh`

```
== Arnes SDD :: init ==
! jq no esta instalado (recomendado para validar feature_list.json)
✓ node v22.13.1
✓ dependencias presentes
-> pnpm run typecheck
> tsc --noEmit
✓ typecheck paso
-> pnpm run lint
> eslint
✓ lint paso
-> pnpm run test
> vitest run

 Test Files  4 failed | 675 passed (679)
      Tests  5 failed | 8193 passed (8198)
   Duration  660.94s

✗ 'pnpm run test' fallo
```

**typecheck: 0 errores. lint: 0 errores.** El gate corta en `pnpm run test`, así que no se
llega a `== init OK ==`. Los cinco rojos, uno a uno, con su archivo:

| Test rojo | Archivo | Qué es |
|---|---|---|
| `la home muestra el placeholder y el único logout es el del PageHeader (sin botón ad-hoc)` | `tests/components/HomePage.test.tsx` | `Test timed out in 20000ms` |
| `R1: rol adminTienda con sesión válida renderiza el dashboard del admin de tienda` | `tests/components/HomePageRol.test.tsx` | `Test timed out in 20000ms` |
| `R5: el rol se resuelve server-side invocando resolveActorFromSession (sin hook de cliente)` | `tests/components/HomePageRol.test.tsx` | timeout (7,9 s) + `act(...)` warning de `NotificationsBell` |
| `/ordenes monta OrdenesModule sin columnas custom (variante por defecto)` | `tests/components/OrdenesModuleReuse.test.tsx` | `Test timed out in 20000ms` |
| `una racha de clics colapsa en UNA sola emision, la del estado final` | `tests/unit/components/filter-component.test.tsx` | debounce por tiempo real |

**Los cinco son de `jsdom`, ninguno toca analítica, y son exactamente los que
`vitest.config.ts:11-17` documenta POR NOMBRE** como flakes de contención de CPU
(«HomePage, HomePageRol, OrdenesModuleReuse y a veces CierreDiaPage caian con "Test timed
out"… pero pasaban en aislado»); el timeout ya se subió de 5 s a 20 s por eso mismo y esta
máquina lo vuelve a superar. En el baseline medido antes de escribir un solo test
(§2) los rojos fueron OTROS tres del mismo tipo (`no-embalaje`, `LoginForm`), que en esta
corrida pasan: el conjunto **cambia entre corridas**, que es la firma del flake y no la de
una regresión.

Evidencia de que ninguno viene de la 122:

- Ni un solo archivo de esta rama está en `app/`, `components/` ni `lib/{actions,services,
  repositories}/` (§6), y nada fuera de `tests/unit/analytics/**` importa los cinco módulos
  nuevos: no hay camino por el que puedan afectar a un render de `HomePage`.
- `HomePageRol` y `no-embalaje`/`LoginForm` pasan al correrlos aislados.
- La suite de analítica, completa y aislada, está **en verde**:

```
$ npx vitest run tests/unit/analytics
 Test Files  22 passed (22)
      Tests  317 passed (317)
```

22 archivos = las 8 suites heredadas de la 135 + las 13 nuevas + la ampliación del guardia
de pureza. **Delta de la 122 en analítica: 0 rojos, 0 errores de lint, 0 errores de tipos.**

> **Lo que NO puedo afirmar:** que el gate global termine en `== init OK ==` en esta
> máquina. No lo hizo en el baseline (§2) ni lo hace ahora, y en ambos casos por los mismos
> flakes de `jsdom` bajo carga. Si el leader necesita el verde absoluto que pide T6.2, la
> corrida hay que repetirla en una máquina descargada o con `--pool=forks --poolOptions.
> forks.singleFork` para los tests de componente; lo que sí queda demostrado es que el
> conjunto de rojos no lo mueve esta feature.

## 9. Veredicto

**Implementada y verificada: 41/41 requisitos con test nombrado, 12/12 mutaciones detectadas,
delta 0 en analítica (22 suites / 317 tests en verde) y frontera de rama limpia; los 5 rojos
de la suite completa son flakes de `jsdom` que el propio `vitest.config.ts` nombra y que
ningún archivo de esta rama puede alcanzar.**
