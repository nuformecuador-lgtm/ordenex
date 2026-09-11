# review 421 — un test de migración consulta el enum sin fijar el esquema

Rama `fix/421-enum-sin-esquema-en-test` (`2fb88863`), PR #786, base `origin/dev` (`163de6b9`).
Worktree de revisión propio: `R:/wt/rev421`, con `pnpm install --frozen-lockfile`, `prisma generate`
y `.env` copiado (no viaja en el commit: sólo `.env.example` está trackeado y, con el `.env` en
disco, `git status` sale limpio).

**Veredicto: OK.** Ningún bloqueante. Seis hallazgos menores, todos con su medición.

---

## 1. El censo: lo hice por mi cuenta y con otro método, y sale idéntico

No repetí su tokenizador escrito a mano: barrí el árbol con el **AST del compilador de TypeScript**
(`ts.createSourceFile`, `ScriptKind` por extensión, cero diagnósticos de parseo en 3.551 fuentes),
extrayendo literales y plantillas completas —con sus interpolaciones reconstruidas— y clasificando
por catálogo y por filtro de esquema. Dos implementaciones independientes, un solo número:

| sobre `origin/dev` (`163de6b9`) | suyo | **mío** |
| --- | --- | --- |
| consultas a catálogos en `tests/` | 162 | **162** |
| ya acotaban | 125 | **125** |
| **sin acotar** | 37 en 21 archivos | **37 en 21 archivos** |
| sin acotar en `scripts/` | 2 | **2** (`bench-busqueda-ordenes.ts`) |

Y el entregable, sobre la rama:

> **0 consultas sin acotar en todo el árbol.** Los únicos dos hallazgos que quedan son las
> **muestras sintéticas deliberadas** que viven dentro de la propia guardia, y su número está
> afirmado aparte por un caso (`MUESTRAS_SIN_ACOTAR_EN_ESTA_GUARDIA = 2`).

El desglose por archivo de las 37 también coincide (7 en `correccion-fecha-reprogramacion`, 3 en
`push-migration`, 3 en `postulacion-recurso`, 3 en `notificacion-evento-avisos-agregados`, …).

**Un detalle que su censo no vio y la guardia sí:** las 2 del bench estaban **troceadas en literales
concatenados**, así que mi escáner AST —igual que el suyo— tampoco las habría denunciado. Las cazó
la guardia al estrenarse. Eso es una prueba a favor de la guardia, no en contra.

### El helper es uno, no una copia

19 llamadas a `etiquetasDeEnum(` en el árbol = **17** en los archivos de migración (exactamente las
17 del enum que reporta) + 2 en el caso nuevo. Una sola definición del SQL
(`_postgres-real.ts:346`), y ningún archivo reintroduce la consulta a pelo.

Las otras consultas a `pg_enum` que siguen escritas en sitio (`chat-mensaje-media`,
`geografia-registro`, `drop-tarifa-status`, …) **no debían pasar por el helper**: leen el enum de un
**esquema desechable**, no el de `public`. Forzarlas a `public` habría cambiado lo que miden. La
línea se trazó bien.

---

## 2. El rojo, y si la canaria aguanta la concurrencia

`tests/integration/db/catalogo-consulta-acota-esquema.test.ts` clona `notificacion_evento` en un
esquema `p421_<base36>_<uuid>` **añadiéndole una etiqueta que `public` no tiene**.

**Juicio sobre el determinismo: la canaria SÍ es inmune a la concurrencia, y no por casualidad.**

- Las dos aserciones que llevan el peso (`not.toContain(CANARIA)` en la consulta real y
  `toContain(CANARIA)` en la vieja) dependen **sólo** del esquema que el propio caso crea. Ningún
  otro proceso puede quitarlo ni añadirlo.
- La tercera (`expect(acotada).toEqual(referencia)`) sí se apoya en que `public.notificacion_evento`
  no cambie entre el `beforeAll` y el caso. Lo verifiqué: **todo el DDL del árbol que toca ese enum
  en `public` corre dentro de `enTransaccionRevertida`**, que siempre revierte. La única forma de
  moverlo sería un `prisma migrate deploy` a mitad de suite, que está fuera de alcance. **No queda
  ventana practicable.**
- El barrido de huérfanos es por edad (>1 h) **y** por prefijo `p421_%`, que sólo crea este archivo:
  no puede llevarse por delante el esquema de otro worktree ni el de otra ficha.

### Mutación A, reproducida byte a byte

Quitando el `JOIN pg_namespace` y el `AND n.nspname = 'public'` del helper:

```
 FAIL  catalogo-consulta-acota-esquema.test.ts > precondicion: el control ES la consulta real SIN el arreglo
 FAIL  catalogo-consulta-acota-esquema.test.ts > ⭑ con un SEGUNDO `notificacion_evento` vivo en otro esquema…
   AssertionError: la lectura se trajo la etiqueta del OTRO esquema: expected [ 'orden_rechazada', …(30) ]
   to not include 'canaria_solo_en_el_esquema_temporal_4…'
 FAIL  catalogo-postgres-acota-esquema.guardia.test.ts > ⭑ NINGUNA consulta del arbol lee un catalogo…
   tests/integration/db/_postgres-real.ts:346 -> SELECT e.enumlabel AS etiqueta FROM pg_enum e …
 Test Files  2 failed (2) · Tests  3 failed | 10 passed (13)
```

Idéntico a lo pegado en la bitácora. Restaurado por copia byte a byte y **SHA256 verificado**
(`sha256sum -c` sobre los 4 archivos tocados, los 4 `OK`). Nunca `git checkout --`.

---

## 3. Las tres mutaciones suyas, y tres mías

| # | qué se mutó | resultado |
| --- | --- | --- |
| **A** (suya) | el helper pierde el filtro de esquema | **muerta** — 3 failed \| 10 passed, exacto |
| **B** (suya) | `pg_policies` de `correccion-fecha-reprogramacion` pierde `schemaname` | **muerta** — la guardia denuncia `…:215` con el SQL literal; 1 failed \| 6 passed, exacto |
| **C** (suya) | el detector devuelve `[]` | **muerta**, y más fuerte de lo reportado: con el `return []` arriba de `consultasACatalogos` caen **5** casos, no 3 |
| **D** (mía) | consulta troceada sin acotar, partida **entre `FROM` y el catálogo** | **SOBREVIVE** — la guardia queda verde. Ver hallazgo `menor 1` |
| **D'** (mía) | la misma, partida **por el `WHERE`** (el troceo natural, el del ejemplo del encabezado) | **muerta** — denuncia `analitica-operativa-indices.test.ts:109` |
| **E** (mía) | quitarle el `finally` a `conEsquemaDesechable` | **muerta** — caen los DOS casos de R6 |
| **F** (mía) | `SQL_VIEJA_SIN_ESQUEMA = SQL_ETIQUETAS_DE_ENUM` (el control deja de ser «la real sin arreglo») | **muerta** — caen la precondición y el CONTROL: **R2 no es vacío** |

Las seis se revirtieron por copia del archivo sano guardado antes, con `sha256sum -c` en verde y
`git status --porcelain` vacío después de cada una. No se usó `git checkout --` en ningún momento.

---

## 4. La guardia: su límite declarado NO cubre lo que de verdad escapa

El encabezado declara el límite así:

> «una consulta TROCEADA en varios literales concatenados (`"SELECT … FROM pg_indexes" + " WHERE …"`).
> Cada pedazo se mira por separado, así que el `WHERE` que acota vive en otro literal y el detector
> no puede emparejarlos.»

**Eso describe la dirección ruidosa, y la medí: ese troceo exacto SÍ se caza** (mutación D'), porque
el primer pedazo ya lleva `SELECT`, `FROM` y el nombre del catálogo sin filtro. Es un falso
**positivo**, que es la dirección aceptable.

Lo que escapa **en silencio** es otro corte, y lo reproduje (mutación D):

```ts
"SELECT indexname FROM " + "pg_indexes WHERE tablename = 'gestion_orden'"
```

Ningún literal reúne a la vez `SELECT`, `FROM` y el catálogo, así que la guardia pasa **verde** con
una consulta sin acotar viva en el árbol. Es un hallazgo **menor**, no bloqueante, por tres medidas:

- **cero ocupantes hoy** — mi censo del árbol entero, con una lista de catálogos más ancha que la
  suya (añadí `pg_namespace`, `pg_depend`, `pg_description`, `pg_inherits`, `pg_stat_*`), no
  encuentra ninguno;
- exige un corte **antinatural**: el natural (por el `WHERE`) se denuncia;
- la convención que la ficha deja escrita —una sola plantilla, y por eso reescribió el bench— apunta
  en la dirección correcta.

### La lista blanca NO se pasó de ancha

Una sola exclusión en todo el barrido: `ESTA_GUARDIA`, su propio archivo. Y no es un agujero, porque
su contenido se cuenta aparte y se afirma en **2**. No perdona ninguna carpeta ni ningún patrón de
ruta. El barrido va sobre `git ls-files *.ts *.tsx` del **árbol entero**, no sólo `tests/` — que es
más de lo que R3 pide, y es lo que cazó el bench.

### La guardia entra sola en el gate rápido

`pnpm exec vitest list --filesOnly guard` la selecciona
(`tests/unit/guards/catalogo-postgres-acota-esquema.guardia.test.ts`), y `test:guardias` es
`vitest run guard`. Verificado, no supuesto.

---

## 5. El harness compartido (`_postgres-real.ts`)

- **Un solo `etiquetasDeEnum()`, 17 usos, cero copias.** Verificado arriba.
- **Ninguna aserción cambió de significado.** Repasé el diff entero buscando degradaciones: hay
  exactamente **dos** aserciones preexistentes tocadas, y las dos conservan su contrato literal:
  - `expect(filas[0].valores).toBe("vehiculo,bodega")` pasa a `expect(valores.join(",")).toBe("vehiculo,bodega")`
  - `expect(filas.map(f => f.enumlabel)).toContain(VALOR)` pasa a `expect(etiquetas).toContain(VALOR)`

  **Cero** `toEqual` degradados a `toMatchObject`. **Cero** listas escritas a mano sustituidas por
  listas derivadas del catálogo. `tests/baseline-rojos.json`, `init.sh`, `vitest.config.ts` y
  `package.json`: **sin tocar** (`git diff --stat` contra `dev` vacío en los cuatro).
- **R7 corrido de verdad:** los 23 archivos juntos dan `Test Files 23 passed (23) · Tests 344 passed
  (344)`, cero saltados. La cifra de la bitácora es cierta.
- **El aislamiento por esquema temporal sigue intacto**, y de hecho mejora:
  `crearPrismaDeTestEnEsquema` no se toca, y `push-cupo-carrera.test.ts` —que clona el enum en su
  esquema— ahora lee sólo el de `public`, así que ya no puede clonarse a sí mismo duplicado.
- Un cambio de más que **suma**: en `push-migration.test.ts` los `JOIN` sobre `information_schema`
  ganan `AND rc.constraint_schema = tc.constraint_schema` y `AND tc.constraint_schema =
  k.constraint_schema`. `constraint_name` no es único entre esquemas: el `JOIN` estaba mal y ahora
  no lo está.

---

## 6. Limpieza

`SELECT nspname FROM pg_namespace WHERE nspname LIKE 'p421_%'` comprobado por mí **cuatro veces** y
las cuatro vacío:

1. tras la corrida sana de los dos archivos;
2. **tras la corrida con el código MUTADO (A)**, que es la que deja basura si el `finally` no cubre
   el camino de fallo — no la dejó;
3. tras la corrida con la mutación E (el `finally` **quitado**) — tampoco, porque el `afterAll` de
   cinturón y tirantes lo recogió;
4. tras cada uno de los dos gates completos.

Y además el recuento de esquemas no estándar de la base = **0**: la base local compartida quedó como
estaba. Un solo `notificacion_evento` vivo, en `public`.

---

## 7. El gate completo, corrido entero por mí

El paso 3 ya no muere: `163de6b9` devolvió 420 y 421 a `pending`. Como la rama va **un commit por
detrás de `dev`**, corrí el gate sobre `rama + origin/dev` mergeado (merge limpio, un solo archivo:
`feature_list.json`). `INIT_EXIT=$?` escrito **dentro** del log, nunca detrás de un `echo`.

**Corrida 1 — `INIT_EXIT=1`:**

```
✓ feature_list.json: sin ids duplicados (416 fichas), cupo por zona respetado (in_progress=0)
✓ typecheck paso
✖ 184 problems (0 errors, 184 warnings)   ->  ✓ lint paso
✓ DATABASE_URL resuelta: los 171 archivos de tests contra Postgres SI se ejecutan
 Test Files  1 failed | 1942 passed (1943)
      Tests  1 failed | 28176 passed | 26 skipped (28203)
ROJOS NUEVOS (1): tests/integration/recuperar-contrasena-form.test.tsx
INIT_EXIT=1
```

Ese rojo **no es de esta ficha**, y no lo digo de oído:

- el archivo tiene **cero** consultas a catálogos (lo medí con mi escáner);
- **no lo toca el diff** de la rama;
- no está en `tests/baseline-rojos.json`;
- el fallo es un `findByLabelText` que expira dentro de un `waitFor` — la familia de flake por
  saturación que el propio `init.sh` documenta;
- **aislado: verde 3 de 3**.

**Corrida 2 — completa, entera, sin saltar pasos — `INIT_EXIT=0`:**

```
 Test Files  1943 passed (1943)
      Tests  28177 passed | 26 skipped (28203)
   Duration  1074.57s
✓ tests: sin rojos nuevos (0 archivo(s) rojo(s) sobre 1943 ejecutado(s))
! migraciones sin down.sql: 20260814120000_ruta_optimizada_trazado …   (deuda ajena preexistente)
✓ .env presente
== init OK ==
INIT_EXIT=0
```

**Las cifras del implementador se confirman una a una:** 1943 archivos, 28.177 tests, **26 skipped
= 17 `AnaliticaPage` + 9 `AnaliticaShell`**, 171 archivos contra Postgres, y **cero saltados en
`integration/db`** (256 líneas de archivo de esa carpeta ejecutadas, ninguna con `skipped`). El caso
nuevo corrió (`catalogo-consulta-acota-esquema.test.ts`, 6 tests) y la guardia también (7 tests).
Eso es lo que hace que este verde signifique algo.

`init.sh` no aparece modificado en esta rama: lo que haya en la 420 no es de aquí.

---

## Checklist de `CHECKPOINTS.md`

| | |
| --- | --- |
| `specs/421-…/requirements.md` con EARS numerados | OK — R1 a R7 |
| `design.md` con alternativa descartada y su porqué | OK — seis descartadas, con la medición del `grep` (88 hallazgos) |
| `tasks.md` con **todas** las tasks `[x]` | OK — T1 a T8, las ocho |
| cada `R<n>` mapea a un test **que de verdad lo verifica** | OK — y cada uno murió bajo mutación (ver §3) |
| `progress/impl_421.md` con el mapa `R<n> -> test` | OK |
| `pnpm run typecheck` | OK |
| `pnpm run lint` | OK — 0 errores (184 avisos preexistentes de `dev`) |
| `pnpm test` | OK — 1943/1943, 28.177 verdes |
| E2E si toca flujo crítico | n/a — ficha de infraestructura de test; no toca auth, pagos, recaudo, ingesta ni webhooks |
| RLS en tablas nuevas | n/a — **cero** tablas nuevas |
| migraciones reversibles con su `down.sql` | n/a — **cero** migraciones |
| secretos hardcodeados | OK — ninguno; el diff es SQL y comentarios. `.env` no trackeado |
| webhooks con firma / idempotencia | n/a |
| capas (controller / service / repository) | n/a — no se toca código de producción; el único no-test es `scripts/bench-*` |
| páginas protegidas, `private/` por props, Server Actions | n/a |
| país / moneda / cuenta sin hardcodear | n/a |
| `./init.sh` termina en verde | OK — corrida 2, `INIT_EXIT=0` |
| `progress/review_421.md` con veredicto OK | OK — este archivo |
| entrada en `progress/history.md` | PENDIENTE — es el paso **F2.6** de `AGENTS.md`, del leader **tras** el merge |

### Trazabilidad `R<n> -> test`, verificada una por una

| R | test | cómo comprobé que no está vacío |
| --- | --- | --- |
| R1 | `⭑ con un SEGUNDO notificacion_evento vivo en otro esquema…` | muere con la mutación **A** |
| R2 | `⭑ CONTROL — la consulta VIEJA…` + `precondicion: el control ES la consulta real SIN el arreglo` | mueren con la mutación **F**; la precondición también con la **A** |
| R3 | `⭑ NINGUNA consulta del arbol lee un catalogo sin decir de que esquema habla` | muere con la **B**, y lo corrobora mi censo AST independiente |
| R4 | `⭑ denuncia una consulta sin acotar, y dice en que linea` + `separa las dos consultas de un mismo archivo` | mueren con la **C**; la **B** enseña el `archivo:línea` real |
| R5 | `⭑ no confunde prosa con codigo: ni comentarios ni titulos de it(...)` | muere con la **C** |
| R6 | `R6 — el esquema desechable se suelta TAMBIEN cuando el cuerpo lanza` + `R6 — al terminar…` | mueren con la **E** (mía) |
| R7 | los 23 archivos corridos juntos | 344 verdes + auditoría del diff (§5) |

---

## Hallazgos

### `menor 1` — el límite escrito de la guardia describe el ruido, no el silencio

Medido en §4. El encabezado dice que lo que no ve es `"… FROM pg_indexes" + " WHERE …"`, y ese caso
**sí se caza**. El que escapa —y escapa verde— es partir entre el `FROM` y el nombre del catálogo.
Cero ocupantes hoy y corte antinatural, por eso no bloquea. Remedio barato, a elegir uno:

- corregir el texto para que diga que el escape es **mudo** y en qué corte exacto ocurre; o
- unir los literales de una concatenación antes de clasificar (`ts.isBinaryExpression` con `+`), que
  cierra la puerta y de paso quita el falso positivo del troceo natural.

### `menor 2` — `regclass` / `regtype` en la lista `ACOTA` contradice al propio `design.md`

El design descarta `::regtype` y `to_regclass` por escrito —«resuelve por `search_path`… **cuál**
depende de un estado global que el test no fija»— y sin embargo la guardia los **acepta** como
acotamiento.

Medido: **6** consultas del árbol pasan la guardia **sólo** por ese cast. Dos llevan el esquema
escrito y están bien (`'public.wallet_tienda_movimiento'::regclass` y la de `tarifas`, que interpola
el esquema); las otras **cuatro** resuelven por `search_path`:

```
tests/integration/db/analytics-daily-job.test.ts:918                     'analytics_daily'::regclass
tests/integration/db/caja-tesoreria-migration.test.ts:526                '"wallet_movimiento"'::regclass
tests/integration/db/rechazo-tienda-cobro.int.test.ts:447                'rechazo_tienda_cobro_estado'::regtype
tests/integration/db/webhook-suscripcion-circuito-migracion.test.ts:304  '"webhook_suscripcion"'::regclass
```

**Por qué no bloquea:** un esquema temporal ajeno no está en el `search_path` de esta sesión, y
`regclass` devuelve **un** oid, nunca dos — así que no pueden producir el síntoma que la ficha
arregla (filas duplicadas). Son preexistentes y no las introduce esta rama. Pero conviene saber que
el «0» es 0 según la guardia y 4 según el criterio del design, y que un arreglo futuro escrito con
`::regclass` pasaría verde siendo el idioma que el design prohíbe.

### `menor 3` — el spec apunta a una ruta que no existe

`design.md` §3 y `tasks.md` T6 dicen `tests/unit/db/catalogo-esquema-acotado.guardia.test.ts`.
El archivo real es `tests/unit/guards/catalogo-postgres-acota-esquema.guardia.test.ts`.

### `menor 4` — una aserción tautológica en «R6 — al terminar, este archivo no deja ningun esquema suyo vivo»

```ts
expect([...creados]).toEqual([]);            // <- lo que de verdad mide (y muere con la mutación E)
// …
const mios = await admin.$queryRawUnsafe(`SELECT nspname FROM pg_namespace WHERE …`);
const recientes = mios.map(/* … */).filter(/* … */);
expect(recientes.filter((n) => creados.has(n))).toEqual([]);   // <- siempre []: `creados` ya está vacío
```

La consulta a `pg_namespace` y el cálculo de `recientes` son **código muerto**: se evalúan después de
haber afirmado que `creados` está vacío, así que el filtro devuelve `[]` pase lo que pase. No es un
verde por vacío —la línea de arriba sí mide, y la comprobación **contra la base real** la hace el
caso anterior (`esquemasVivos`, línea 216)— pero el nombre del caso promete una lectura de la base
que su aserción no usa.

### `menor 5` — falta la entrada en `progress/history.md`

Es el paso F2.6 de `AGENTS.md`, que ejecuta el **leader después del merge**. No es incumplimiento de
esta rama; queda anotado para que no se pierda.

### `menor 6` — la rama va un commit por detrás de `dev` (paso F2.3 pendiente)

`163de6b9` no está en ella, y por eso el paso 3 del gate muere si se corre la rama tal cual —que es
exactamente lo que le pasó al implementador—. El merge es **limpio**: un solo archivo,
`feature_list.json`, dos líneas. Yo lo hice en local para poder correr el gate entero; **hacerlo y
empujarlo antes de mergear el PR es del implementer** (AGENTS.md, F2.3).

---

## Veredicto

**OK.**

El censo es cierto: lo rehíce con el AST del compilador —otro método, otro autor— y salen las mismas
162 / 125 / **37 en 21 archivos**, más las 2 del bench; y sobre la rama quedan **0**. El caso rojo es
determinista de verdad, y la canaria no deja ventana de concurrencia practicable. Las tres mutaciones
de control mueren, y las **tres que planté yo** también —incluida la que comprueba que el arnés no
se está mintiendo—. El harness compartido gana un helper único con 17 usos y **cero** aserciones
degradadas; los 23 archivos dan 344 verdes juntos. La base local queda limpia incluso con el código
mutado. Y el gate completo, corrido entero por mí, termina en **`INIT_EXIT=0`** con las cifras
exactas que reporta la bitácora —1943 / 28.177 / 26 skipped / 171 contra Postgres, cero saltados en
`integration/db`—; el rojo de la primera corrida es un flake de saturación ajeno, verde 3/3 aislado.

Los seis hallazgos son menores y ninguno toca la afirmación central de la ficha. El único que merece
una línea de código algún día es el **menor 1**: el agujero de la guardia existe, pero su texto lo
describe en la dirección equivocada. Hoy tiene cero ocupantes.
