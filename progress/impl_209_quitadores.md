# Feature 209 — 74 quitadores de comentarios distintos vigilando el árbol

Rama `chore/209-quitadores-comentarios`. Alcance tocado: **solo `tests/`**. Ni `app/`, ni
`lib/`, ni `components/`, ni `db/`. Sin worktrees.

---

## 0. Dónde corté, y por qué ahí

El censo medido en este árbol (script propio, con autocomprobación de la clasificación) da
**81 archivos y 86 apariciones** de un quitador escrito a mano dentro de un `.replace(`
—algo más que las 74/78 de la ficha, porque cuento también las variantes por línea sin flag
`/m` y el quitador de SQL—, repartidas así:

| semántica | apariciones | qué se le escapa |
| --- | --- | --- |
| `(^\|\s)\/\/.*$` | 50 | `};// nota` sobrevive (exige espacio o inicio de línea) |
| `\/\/.*$` | **17** | se come el `//` de una URL y con él **el resto de la línea de código** |
| `^\s*\/\/.*$` | **10** | solo la línea de comentario COMPLETA: un `// nota` de cola sobrevive entero |
| las dos formas del helper | 9 | correctas (una de ellas es el propio `money-safe.ts`) |

**Corté por semántica, no por carpeta: esta tanda migra las DOS ROTAS (17 + 10 = 27 sitios en
25 archivos) y deja las 50 `espacio` para una segunda.** Las razones, en orden:

1. Son exactamente las prioridades 1 y 2 del encargo a la vez. De los 27 sitios rotos, **13
   vigilan dinero o permisos**: `LiquidacionService`, `LiquidacionPagoRepository`,
   `LiquidacionRepartoRepository`, `CajaCodFeedService`, la idempotencia de la caja de
   tesorería, `mi-wallet`, el aislamiento admin↔mensajero de incidentes, la columna
   `asignado_at` (que es el denominador del pago al mensajero) y el censo de
   `busqueda_texto`.
2. Las 50 `espacio` son **una sola familia de copia-y-pega** (37 de ellas en
   `tests/unit/analytics/`), su defecto es el más estrecho de los cuatro, y tocarlas aquí
   convertía el PR en 75 archivos ilegibles.
3. **Y hay una decisión pendiente que solo aparece en esa familia**, medida en §5: para 2
   líneas del árbol el `espacio` es MÁS seguro que el helper. Esa decisión merece su propio
   PR y no colarse dentro de éste.

Después de esta tanda el censo baja a **57 archivos / 58 apariciones: `desnudo` 17 → 0,
`línea completa` 10 → 0**, y quedan las 50 `espacio` + 8 copias literales de la forma
correcta (dedup puro, riesgo cero).

---

## 1. Archivos

### Nuevos

| Archivo | Qué |
| --- | --- |
| `tests/fixtures/sin-comentarios.ts` | **EL** quitador del repo. `quitarComentarios`, `quitarComentariosSql`, `codigoSinComentarios`, `lineasSinComentarios`. |
| `tests/unit/guards/quitador-comentarios.guardia.test.ts` | Su test propio. **26 casos**, escritos en las dos caras. |

Vive en `tests/fixtures/` (donde ya estaba `money-safe.ts`) y su test en
`tests/unit/guards/` **a propósito**: `test:guardias` selecciona por nombre (`vitest run
guard`), así que la pieza de la que cuelgan todas las guardias entra en el gate rápido. Si no
estuviera ahí, romperla no pondría nada en rojo — las guardias solo se mueven cuando se mueve
el árbol, que es el agujero por el que entró el defecto original de la 207.

Dos decisiones del módulo, las dos medidas antes de tomarlas:

- **El bloque `/* … */` se sustituye conservando sus saltos de línea.** Sin eso, un bloque
  multilínea pega la línea de antes con la de después y un censo que informe `archivo:linea`
  —`busqueda-texto-solo-lectura` es uno— apunta a una línea que no existe. Medido sobre los
  1.033 archivos de `lib/ app/ components/ hooks/ scripts/ db/`: **0 archivos cambian de
  contenido** respecto del helper anterior, así que ningún consumidor existente se mueve.
- **`--` va en función APARTE (`quitarComentariosSql`).** Meterlo en el quitador de
  TypeScript se come `i-- > 0` y todo lo que le siga en la línea: un falso VERDE silencioso.
  Está fijado con test.

### Modificados (27)

Prisma-schema (los 10 sitios que parseaban `db/schema.prisma` con `\/\/.*$`):
`tests/integration/db/liquidacion-migration.test.ts` (y su quitador de SQL, que pasa a
`quitarComentariosSql`), `…/liquidacion-reparto-migration.test.ts`,
`…/analytics-daily-migration.test.ts`, `tests/unit/analytics/catalogo-produccion.guardia.test.ts`,
`…/catalogo-universo.guardia.test.ts`, `…/definiciones-catalogo.guardia.test.ts`,
`…/types.test.ts`, `tests/unit/tablero-dia/frontera.guardia.test.ts`,
`…/resultados-exhaustivos.test.ts`,
`tests/unit/repositories/desglose-mensajero-cierre-derivado.test.ts`.

Dinero y permisos: `tests/unit/repositories/liquidacion-pago-repository.test.ts`,
`…/liquidacion-reparto-repository.test.ts` (2 sitios),
`tests/unit/services/liquidacion-service.test.ts` (2), `…/liquidacion-anulacion.test.ts`,
`…/caja-cod-feed-service.test.ts`, `…/mi-wallet-desglose.test.ts`,
`tests/integration/db/caja-tesoreria-idempotencia.test.ts`,
`tests/unit/guards/incidente-admin-aislamiento.test.ts`,
`tests/unit/tablero-dia/asignado-at-solo-lectura.guardia.test.ts`,
`tests/unit/tablero-dia/_arbol-de-la-feature.ts`.

Resto: `tests/unit/guards/censo-catalogo-estados-v2.test.ts`,
`tests/unit/analytics/rollup-dia.test.ts`, `…/rollup-service.test.ts`,
`tests/integration/db/analytics-daily-guards.test.ts` (solo su sitio `^\s*//`; su `soloCodigo`
—variante `espacio`— se deja para la tanda B), `tests/components/NotificationsBell.test.tsx`,
`tests/unit/guards/busqueda-texto-solo-lectura.test.ts`, `tests/fixtures/money-safe.ts`
(re-exporta; la implementación es una sola).

**En todos los casos se sustituye SOLO el quitador. La lógica que lo rodea —el recorte del
bloque del modelo, los `indexOf` que aíslan un método, los patrones que se buscan— queda
intacta**, para que el antes/después mida el quitador y no otra cosa.

---

## 2. Los totales, antes y después

Método: para cada sitio se recalculó **el valor que la guardia deriva** (la lista, el conteo o
el booleano que acaba en un `expect`) con el quitador viejo y con el nuevo, sobre los archivos
que ese sitio lee de verdad. **244 comparaciones. 244 iguales.**

```
db/schema.prisma  —  con el desnudo y con el helper, valor a valor:
  enums parseados (valores)                     32 enums   ->  0 diferencias
  modelos parseados (campos)                    52 modelos ->  0 diferencias
  modelos parseados (columnas + @map)           52 modelos ->  0 diferencias
  bloques completos (AnalyticsDaily / PagoMensajeroMovimiento / LiquidacionReparto)
                                                           ->  0 diferencias
  ROLES de frontera.guardia                                ->  0 diferencias
  `NULLS NOT DISTINCT` / `CHECK` / `cierreId` / `@unique`  ->  0 diferencias

Dinero (los 5 barridos estructurales de liquidación):
  liquidacionPago.{update,updateMany,delete,deleteMany,upsert}       -> 0
  liquidacionReparto.{…}                                             -> 0
  cierreDia.{…} en LiquidacionPagoRepository                         -> 0
  LiquidacionService completo (texto normalizado)                    -> 0
  CajaCodFeedService: Number( / parseFloat( / parseInt(              -> 0

Permisos y aislamiento:
  incidente-admin, 12 módulos x 7 patrones                           -> 0
  mi-wallet, 3 archivos x 11 literales                               -> 0
  tablero-dia, 16 archivos x (ESCRITURAS_SQL, ESCRITURAS_PRISMA)     -> 0
  NotificationsBell/useNotificaciones, 4 patrones de R47             -> 0
  caja-tesoreria-idempotencia, 2 repos x 3 patrones                  -> 0
  censo-catalogo-estados-v2, allowlist de 4 archivos                 -> 0
  metrics.ts: ocurrencias y declaraciones de `analytics_daily`       -> 0
```

**Se movió UN total, y era el que el encargo pedía mover:**

```
busqueda-texto-solo-lectura — el censo de quién nombra la columna generada:
  CRUDO : 25 menciones en 5 archivos
  CÓDIGO: 17 menciones en 3 archivos     (8 menciones vivían en comentarios)
  Las otras 5 aserciones del archivo (verbos de escritura, `data:`, `lib/types/`,
  `app/`+`components/`, `select:`, `contains` del repositorio) NO se mueven.
```

---

## 3. La lista blanca de `busqueda_texto`: la ficha señalaba al archivo equivocado

La 207 dejó escrito que `lib/db/prisma-client.ts` está en la lista blanca «y solo la nombra en
un docstring (línea 33)». **Eso es falso, y conviene que quede corregido**: ese archivo tiene
la mención en CÓDIGO en la línea 45,

```ts
export const PRISMA_OMIT = { orden: { busquedaTexto: true } } as const;
```

que es justamente el `omit` global que esconde la columna de toda lectura (R28). Su permiso es
legítimo y se queda.

**Las que sí sobraban son otras dos**, y las dos salen de la lista:

| Entrada retirada | Menciones | Dónde |
| --- | --- | --- |
| `lib/interfaces/repositories/IOrdenRepository.ts` | 2 | las dos en JSDoc (líneas 100 y 125) |
| `lib/utils/busqueda-orden.ts` | 1 | en la cabecera (línea 5); es un módulo puro, sin Prisma |

La lista pasa de 5 entradas a 3. **No es cosmética: una lista blanca con entradas de más miente
sobre quién puede tocar el campo, que es exactamente lo que esta guardia protege.** Desde ahora,
un `busquedaTexto` de verdad en cualquiera de esos dos archivos sale ROJO; documentarla siguen
pudiendo hacerlo cuanto quieran.

Queda fijado con un caso nuevo (`209: los dos archivos que salieron de la lista blanca no la
nombran en CODIGO`) redactado para no ser frágil: afirma que su **código** no la nombra, no que
su docstring exista, así que borrar la documentación no lo pone rojo y meter un uso real sí.

Se retira además el filtro `!m.texto.startsWith("//")` del caso del repositorio: era la
mitigación local de que el censo leyera prosa, y encima solo cubría el comentario de línea
completa.

---

## 4. Hallazgos que NO se tocan (se miden y se reportan)

> **CERRADO el 2026-08-12.** El hallazgo §4.1 se decidió y se arregló; el detalle está en §9.
> Lo que sigue en §4.1 es el hallazgo tal como se midió, sin retocar.

### 4.1 Una segunda lista blanca inflada por un comentario, en una guardia de dinero

`tests/unit/tablero-dia/asignado-at-solo-lectura.guardia.test.ts` —cuya propia cabecera dice
«**GUARDIA DE DINERO, no de estilo**», porque `asignado_at` es el denominador del ranking que
paga al mensajero— congela el inventario de migraciones que nombran la columna y lo afirma con
`toEqual`. Su tercera entrada lleva escrito al lado «Solo en un COMENTARIO». Medido:

```
migraciones que nombran `asignado_at`   CRUDO : 3     SIN COMENTARIOS: 2
la que sobra: 20260731130000_order_status_recolectando/migration.sql
```

Ese escaneo lee el `.sql` en crudo y **no se ha tocado**: arreglarlo mueve un total afirmado
(3 → 2), y el encargo dice que un total que se mueve es un hallazgo, no un ajuste. Aquí está,
medido, para que lo decida el humano.

### 4.2 Un censo que lee crudo y está inerte por casualidad

`tests/unit/guards/censo-catalogo-estados-v2.test.ts` define `sinComentarios` (migrado) pero su
función `ofensores()` escanea `fs.readFileSync(file)` **crudo**. Hoy no daña porque
`LITERALES_154` está vacío desde la 158, así que el barrido no busca nada. El día que una
feature vuelva a usar esa maquinaria —y su docstring dice explícitamente que se conserva para
eso— volvería a contar prosa. Igual el `RE_INCIDENTE.test(contenido)` de la allowlist: medido
sobre sus 4 archivos, ninguno cambia de veredicto al despiojar (todos tienen el literal en
código), así que se deja como está y se anota.

### 4.3 El dato adyacente de la ficha, remedido

41 `expect(` dentro de comentarios en `tests/`, en 17 archivos. Sigue sin ser una aserción de
orden de ninguna `COLUMNAS_DESCARGA_*` —la 207 ya cerró ese parser—, así que sigue sin dañar.

---

## 5. La limitación del helper, medida (y por qué corta el alcance aquí)

El helper usa `(^|[^:])//` para no confundirse con `https://`. Eso tiene un precio que hasta
hoy nadie había medido: **también se come un `//` que ABRE una cadena**, y ahí se lleva por
delante código vivo. Sobre `lib/ app/ components/ hooks/ scripts/` hay exactamente **dos
líneas** así:

```
app/login/_components/LoginForm.tsx:34   !redirectParam.startsWith("//")        <- open-redirect
lib/auth/google-wif-token.ts:109         `//iam.googleapis.com/projects/${…}`
```

En las dos, la variante `espacio` (`(^|\s)//`) es MÁS segura que el helper, porque exige
espacio antes del `//`. Ninguna de las dos afecta a nada de esta tanda —ninguna guardia
migrada lee esos archivos—, **pero sí afecta a la familia `espacio`**, cuyo miembro
`analytics-daily-guards.test.ts` recorre el árbol entero. Por eso esa familia va aparte: la
tanda B tiene que decidir antes si el quitador se endurece a `(^|[^:"'`])//`. Medido: ese
endurecimiento cambia el resultado en **86 líneas del repo**, casi todas fixtures de test que
empiezan una cadena por `"// …"`, así que no es un cambio de una letra sin consecuencias.

La limitación queda fijada como test (`LIMITACION CONOCIDA Y MEDIDA`), para que sea un hecho
conocido y no una sorpresa, y para que el día que se cierre haya un caso que lo diga.

---

## 6. Mutaciones

Aplicadas una a una sobre `tests/fixtures/sin-comentarios.ts`, restaurando al terminar. El
runner **aborta si el reemplazo no cambia el fuente** (una mutación que no muta reporta
«sobrevive» y miente) y comprueba además que el texto nuevo esté y el viejo no.

`nuevo` = `quitador-comentarios.guardia.test.ts` (26 casos).
`guardias` = las 178 suites que consumen el quitador (todas las migradas + las 6 que ya usaban
`money-safe` + `tests/unit/descarga` + `tests/integration/db`): **2.328 tests sin mutar**.

| # | Mutación | `nuevo` | `guardias` |
| --- | --- | --- | --- |
| m1 | quitador desactivado (devuelve el fuente crudo) | **ROJO** 12/26 | ROJO — 27 guardias |
| m2 | se lo come todo (devuelve `""`) | **ROJO** 17/26 | ROJO — 32 guardias |
| m3 | deja de quitar los de LÍNEA | **ROJO** 8/26 | ROJO — 24 guardias |
| m4 | deja de quitar los de BLOQUE (y con ellos los de JSX) | **ROJO** 4/26 | ROJO — 17 guardias |
| m5 | bloque ÁVIDO (`[\s\S]*`) | **ROJO** 2/26 | ROJO — 16 guardias |
| m6 | **pierde la salvaguarda de la URL** (vuelve al `\/\/.*$` desnudo) | **ROJO** 4/26 | **VERDE** |
| m7 | **vuelve a `^\s*\/\/`** (solo la línea de comentario completa) | **ROJO** 6/26 | ROJO — 3 guardias |
| m8 | **pierde la conservación de saltos** (el bloque colapsa a un espacio) | **ROJO** 3/26 | **VERDE** |
| m9 | `quitarComentariosSql` deja de quitar `--` | **ROJO** 2/26 | ROJO — 1 guardia |
| — | sin mutar | VERDE 26/26 | VERDE 2.328/2.328 |

Las nueve mueren. **Lo que hay que leer es la columna de la derecha:**

- **m6 es INVISIBLE para las 178 suites.** Es el dato central de esta tanda: revertir mañana
  los 17 sitios que usaban `\/\/.*$` **no pondría nada en rojo**. El árbol de hoy no tiene
  ninguna URL en una línea que alguna de esas guardias mire, así que el arreglo no lo sostiene
  ninguna guardia: lo sostiene únicamente el test nuevo. Era exactamente el agujero de la 207.
- **m8 también es INVISIBLE.** Perder la alineación de líneas no rompe ninguna guardia: sólo
  hace que `busqueda-texto-solo-lectura` informe `archivo:linea` apuntando a otra línea. Un
  fallo que nadie vería nunca en rojo, sólo en un mensaje de error que miente.
- **m7 es sólo PARCIALMENTE visible**: 3 de las 178 (`montajes-componente`,
  `censo-catalogo-estados-v2` —por su propio caso «m6: `sinComentarios` DISCRIMINA»— y
  `resultados-exhaustivos`, que se pone roja porque el enum `GestionResultado` de
  `schema.prisma` lleva un comentario de cola). Las otras 7 de los 10 sitios que tenían esa
  semántica no lo notarían.
- m9 la ve una sola suite (`liquidacion-migration`), y sólo porque su `down.sql` comenta con
  `--` lo que el `up` hace.

Dicho de otro modo: **2 de las 9 mutaciones, y 7 de los 10 sitios de m7, no los cubre ninguna
guardia. Los cubre el archivo nuevo, y por eso tenía que existir.**

---

## 7. Verificación (salida real)

```
$ pnpm exec vitest run tests/unit/guards tests/unit/descarga
 Test Files  56 passed (56)
      Tests  490 passed (490)

$ pnpm exec tsc --noEmit
(sin salida, exit 0)

$ pnpm run lint
✖ 61 problems (0 errors, 61 warnings)
  (61 = EXACTAMENTE el baseline de `origin/dev` medido con `git stash`; llegó a 72 al migrar
   —imports que se quedaron sin uso— y se dejaron los 11 a cero)

$ pnpm test        # la suite entera
 Test Files  1071 passed (1071)
      Tests  13425 passed (13425)
   Duration  296.61s
```

Control de que no se perdió ni se duplicó ningún test, sobre la misma selección antes y
después de migrar (`tests/unit/{guards,descarga,analytics,tablero-dia,services,repositories}`
+ `NotificationsBell`):

```
ANTES : 451 archivos / 5999 tests
DESPUÉS: 451 archivos / 6000 tests     <- +1, que es el caso nuevo de la lista blanca
```

Mismo número de archivos: ninguna guardia se re-registró al extraer su quitador, que era el
riesgo de la mudanza.

`./init.sh` **no se ha corrido**: el gate leído sobre el árbol que este agente acaba de mutar
nueve veces no vale como veredicto, y va secuenciado, no en paralelo. Queda para el leader.

---

## 8. Veredicto (tanda A)

Las dos semánticas rotas están fuera del árbol —17 sitios de `\/\/.*$` y 10 de `^\s*\/\/`
migrados al único quitador del repo, con test propio de 26 casos y 9 mutaciones muertas—, los
244 valores derivados que afirman esas guardias siguen valiendo exactamente lo mismo, y el
único total que se movió (25→17 menciones de `busqueda_texto`) es el que destapó que la lista
blanca tenía **dos** entradas de más: no la que la ficha señalaba, que resultó ser código
legítimo, sino `IOrdenRepository` y `busqueda-orden`. Quedan las 50 copias de la variante
`espacio` para una segunda tanda, con una decisión medida esperándola.

---

# 9. Cierre del hallazgo §4.1 — la lista blanca de `asignado_at` (2026-08-12)

Decisión del humano: **cerrarlo**. La razón que dio, y que queda escrita en el propio test: una
lista blanca con una entrada de más **miente sobre quién puede tocar el campo**, y en una
guardia de dinero esa mentira es el precedente con el que alguien justificará, dentro de seis
meses, que su migración también puede entrar.

## 9.1 La medición, confirmada antes de tocar nada

Re-medido en este árbol con el helper compartido (`quitarComentariosSql`), no con la memoria de
la tanda anterior. El árbol de migraciones: **231 archivos, `git status` limpio**.

```
$ pnpm exec tsx .tmp-medir-asignado-at.ts     # script temporal, borrado después
CRUDO           : 3  -> 20260716120000_orden_asignado_at/down.sql
                      | 20260716120000_orden_asignado_at/migration.sql
                      | 20260731130000_order_status_recolectando/migration.sql
SIN COMENTARIOS : 2  -> 20260716120000_orden_asignado_at/down.sql
                      | 20260716120000_orden_asignado_at/migration.sql
SOLO EN PROSA   : 1
  20260731130000_order_status_recolectando/migration.sql
    L37: -- siendo suya) y `asignado_at` tampoco: esa columna es el denominador del ranking y una
```

**La que sale de la lista.** Su ÚNICA aparición de `asignado_at` está en la línea 37, dentro de
un bloque `--` continuo (líneas 28-38) que dice literalmente que no la toca. La primera línea de
SQL vivo del archivo es la 39:

```
20260731130000_order_status_recolectando/migration.sql
  L35: -- SIN EFECTOS DE NEGOCIO: es SQL puro, no pasa por `appendCambioEstado` ni por el encolado de
  L36: -- jobs, asi que no emite webhooks ni notificaciones. `mensajero_asignado_id` NO se toca (sigue
  L37: -- siendo suya) y `asignado_at` tampoco: esa columna es el denominador del ranking y una
  L38: -- recoleccion no debe contar (R38).
  L39: INSERT INTO "orden_historial_estado"          <- primer SQL vivo, y ya no la nombra
```

**Las dos que se quedan.** SQL vivo, verificado tras pasar el quitador (así que lo que se ve es
lo que queda después de tirar los comentarios, no el crudo):

```
20260716120000_orden_asignado_at/migration.sql
  L9 : ALTER TABLE "orden" ADD COLUMN "asignado_at" TIMESTAMP(3);
  L14: CREATE INDEX "orden_mensajero_asignado_id_asignado_at_idx"
  L15: ON "orden" ("mensajero_asignado_id", "asignado_at");

20260716120000_orden_asignado_at/down.sql
  L5 : DROP INDEX IF EXISTS "orden_mensajero_asignado_id_asignado_at_idx";
  L8 : ALTER TABLE "orden" DROP COLUMN IF EXISTS "asignado_at";
```

La medición anterior era correcta. **No hay nada que retractar.**

## 9.2 Qué se cambió

Un solo archivo: `tests/unit/tablero-dia/asignado-at-solo-lectura.guardia.test.ts`.

- `migracionesQueMencionanAsignadoAt()` → `migracionesQueTocanAsignadoAt()`. Deja de leer el
  `.sql` en crudo y pasa por `quitarComentariosSql` (el helper compartido, migración nº 28 de
  esta rama). El nombre cambia porque **mencionar y tocar dejaron de ser lo mismo**, y la
  función ya no mide lo que decía medir.
- `MIGRACIONES_QUE_MENCIONAN_LA_COLUMNA` (3) → `MIGRACIONES_QUE_TOCAN_LA_COLUMNA` (2).
- El **porqué del 3 → 2 queda escrito en el propio test**, con fecha y motivo, en el docstring
  de la constante: qué entrada salió, en qué línea estaba, por qué salió, y que las otras dos la
  tocan en SQL vivo. Un número que baja sin explicación es el siguiente misterio de otro.
- Caso nuevo, **el recibo**: `209: la migracion de 'recolectando' la NOMBRA pero no la toca (el
  recibo del 3 → 2)`. Mide el archivo en las dos caras (crudo: la nombra; sin comentarios: no).
  No es un test muerto: una migración ya aplicada es inmutable, así que editarla en sitio es
  drift, y si esa edición pasara a tocar la columna de verdad este caso cae **antes** de que la
  lista blanca tenga que decidir si le abre la puerta.

Nada más se tocó: los otros 3 casos del archivo (existencia de los censados, ausencia de
escrituras SQL/Prisma en los 16 archivos de la feature, y la lectura real en
`TableroDiaRepository`) quedan intactos. El archivo pasa de **4 a 5 casos**.

## 9.3 El total, antes y después

```
migraciones que TOCAN `asignado_at`     ANTES: 3       DESPUES: 2
la que salió: 20260731130000_order_status_recolectando/migration.sql (solo prosa, L37)
casos del archivo                       ANTES: 4       DESPUES: 5
```

Es el segundo total que se mueve en esta rama, y el segundo que se mueve **porque el censo dejó
de contar prosa**. Mismo patrón que el de `busqueda_texto` (§3): en los dos casos, el número que
bajó destapó una lista blanca inflada.

## 9.4 ¿Sigue mordiendo? Tres mutaciones

Se plantó una migración ficticia en `db/migrations/29991231000000_mutacion_209_asignado_at/`,
con su `down.sql` incluido para que ninguna otra guardia («toda migración tiene down») se
pusiera roja y **el rojo fuera atribuible a la guardia bajo prueba**.

### M1 — SQL vivo que toca la columna: debe caer, y NOMBRARLA

`migration.sql`: `UPDATE "orden" SET "asignado_at" = now() WHERE "asignado_at" IS NULL;`

```
❯ tests/unit/tablero-dia/asignado-at-solo-lectura.guardia.test.ts (5 tests | 1 failed)
   × la feature no añade ninguna migracion que toque la columna (R37/R59)

AssertionError: expected [ …(3) ] to deeply equal [ …(2) ]
  [
    "20260716120000_orden_asignado_at/down.sql",
    "20260716120000_orden_asignado_at/migration.sql",
+   "29991231000000_mutacion_209_asignado_at/migration.sql",
  ]
```

**ROJO, y con el nombre de la carpeta plantada en el diff.** Muerde.

### M2 — la misma migración, con la mención SOLO en prosa: debe seguir VERDE

`migration.sql`: el `UPDATE` pasa a tocar `prioridad`, y `asignado_at` se queda únicamente en un
comentario `--` de la cabecera.

```
 Test Files  1 passed (1)
      Tests  5 passed (5)
```

**VERDE.** Esto es lo que hace que M1 signifique algo: la guardia no se pone roja con cualquier
cosa, discrimina exactamente entre *nombrar* y *tocar*, que es el cambio que se pedía.

### M3 — el helper deja de quitar `--` (la m9 de §6, ahora vista desde aquí)

`quitarComentariosSql` mutado para no quitar comentarios de línea SQL:

```
❯ (5 tests | 2 failed)
   × la feature no añade ninguna migracion que toque la columna (R37/R59)
   × 209: la migracion de `recolectando` la NOMBRA pero no la toca (el recibo del 3 → 2)

AssertionError: expected [ …(3) ] to deeply equal [ …(2) ]
+   "20260731130000_order_status_recolectando/migration.sql",

AssertionError: 20260731130000_order_status_recolectando/migration.sql paso a TOCAR
  asignado_at en SQL vivo: expected '-- Feature 157 (ampliacion) — estado …' not to
  contain 'asignado_at'
```

**Los dos rojos, y el segundo con el nombre del archivo en el mensaje.** Dato adyacente que
mejora el cuadro de §6: **m9 pasa de verla 1 guardia a verla 2.** Antes solo la notaba
`liquidacion-migration`, y de rebote (porque su `down.sql` comenta con `--`). Ahora la nota
también una guardia de dinero, y de frente.

### Reversión, confirmada por hash

```
                                    ANTES                                                            DESPUES
git status --porcelain db/migrations  (vacio)                                                          (vacio)
find db/migrations -type f | wc -l    231                                                              231
sha256 del arbol                      2914771d2b50e3883da312d3f70fa80ec6072f1ad357a3f111d2a248fed80459  2914771d2b50e3883da312d3f70fa80ec6072f1ad357a3f111d2a248fed80459

sha256 tests/fixtures/sin-comentarios.ts
  antes de M3   c5ac56c8dbada536bdb0c2749ea24a7ee72e390edee9950cf178d187be9aba36
  despues de M3 c5ac56c8dbada536bdb0c2749ea24a7ee72e390edee9950cf178d187be9aba36   (+ `diff -q` idéntico al backup)
```

Árbol de migraciones **byte a byte** el de antes, y el helper restaurado al hash exacto. El
script temporal de medición (`.tmp-medir-asignado-at.ts`) se borró; `git status` vuelve a
listar exactamente los mismos 27 modificados + 3 nuevos de la tanda A, ni uno más.

## 9.5 Verificación (salida real)

```
$ pnpm exec vitest run tests/unit/guards
 Test Files  27 passed (27)
      Tests  317 passed (317)

$ pnpm exec vitest run tests/unit/guards tests/unit/tablero-dia
 Test Files  33 passed (33)
      Tests  425 passed (425)

$ pnpm exec tsc --noEmit
(sin salida, exit 0)
```

El archivo tocado vive en `tests/unit/tablero-dia/`, **no** en `tests/unit/guards/`, así que se
corrió también esa carpeta: el comando pedido por sí solo no lo habría ejecutado.

## 9.6 Veredicto del cierre

La medición se confirmó antes de tocar (3 crudo / 2 sin comentarios, y la que sobraba la nombra
solo en la línea 37 de un bloque `--`), la guardia usa ya el quitador compartido, el 3 → 2 está
explicado con fecha y motivo dentro del propio test, y sigue mordiendo: cae y nombra a la
migración plantada que toca la columna, no cae con la que solo la menciona, y de propina ahora
detecta que el quitador de SQL se rompa. Árbol de migraciones y helper revertidos con hash
idéntico.
