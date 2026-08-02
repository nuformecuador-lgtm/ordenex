# review — Feature 169 · Buscador de texto en el listado de órdenes

> Rama `feature/169-buscador-ordenes` · worktree `.claude/worktrees/lote-135` · 2026-07-31
> Revisado contra: `specs/169-buscador-ordenes/{requirements,design,tasks}.md`,
> `progress/impl_169-buscador-ordenes.md`, `docs/{architecture,conventions,verification}.md`,
> `CHECKPOINTS.md` y el diff completo contra `origin/dev` (4 commits: spec, backend,
> frontend, medición).
>
> **Nada de lo que sigue se toma de la bitácora por bueno.** Todo lo marcado como verificado
> se ejecutó en esta sesión: la suite entera, el typecheck, el lint, los cinco archivos de
> integración contra Postgres real, el chequeo de drift de Prisma y **el banco de rendimiento
> completo (50 000 filas), reproducido de cero**.

---

## 1 · Lo que se ejecutó aquí (evidencia propia, no citada)

| Puerta | Comando | Resultado medido en esta sesión |
| --- | --- | --- |
| typecheck | `pnpm run typecheck` | **verde**, 0 errores (exit 0) |
| lint | `pnpm run lint` | **0 errores**, 20 warnings (las mismas del baseline: `_args`, `_items`, `_origenes`…) |
| suite | `pnpm test` | **681 archivos / 8307 tests · 1 rojo**: `tests/components/Modal.test.tsx > R30: atrapa el foco con Tab`. **Ningún rojo de la 169.** |
| integración DB | `vitest run` de los 5 archivos `busqueda-*` + `orden-busqueda-trgm-migration` | **91 tests, 91 pasados, 0 saltados** — la evidencia contra Postgres es real y no se salta por falta de `DATABASE_URL` |
| drift (R30) | `prisma migrate diff --from-config-datasource --to-schema db/schema.prisma --script` | `-- This is an empty migration.` → **sin drift**, comprobado por mí |
| migración | `prisma migrate status` | `Database schema is up to date!` |
| rendimiento (R31) | `pnpm exec tsx scripts/bench-busqueda-ordenes.ts` (50 000 filas) | **las 14 aserciones de plan pasan** (detalle en §4) |
| `./init.sh` | — | **cae en el paso `test`**, por el rojo de `Modal.test.tsx` |

Sobre ese rojo: verifiqué que `components/shared/Modal.tsx`, `tests/components/Modal.test.tsx`,
`components/ui/`, `vitest.config.ts`, `tests/setup`, `package.json` y `pnpm-lock.yaml` son
**byte-idénticos a `origin/dev`** en esta rama (`git diff --stat origin/dev...HEAD` sobre esos
paths sale vacío). La 169 **no lo causa y no lo empeora**: aporta 18 archivos de test y ~215
casos, todos verdes. Su tratamiento está en §7 (condiciones de cierre).

---

## 2 · Checklist de `CHECKPOINTS.md`

### Especificación
- [x] `requirements.md` con requisitos EARS numerados R1–R42.
- [x] `design.md` con alternativas descartadas y su porqué (§10: siete alternativas, con plan
      B ejecutable escrito y criterio de salto).
- [~] `tasks.md` con **todas** las tasks `[x]` → **NO se cumple literalmente**: quedan sin
      marcar **T0.1** y **T0.2** (declaradas PARCIAL: sin acceso a preview ni producción),
      **T5.2** (por el rojo ajeno) y **T5.4** (es del leader, posterior a este review).
      Ninguna de las cuatro es trabajo de código pendiente. Ver §7.

### Trazabilidad
- [x] Cada `R<n>` mapea a al menos un test concreto. **Comprobado mecánicamente por mí**: los
      42 requisitos R1–R42 aparecen nombrados en el título de al menos un `describe`/`it` de
      los 16 archivos de test de la feature (mínimo 1, mediana 3, máximo 10 por requisito).
- [x] Y comprobado **por muestreo profundo** (no solo por nombre) en 20 requisitos. En todos
      los casos el test asserta el requisito, no lo menciona. Detalle en §3.
- [x] `progress/impl_169-buscador-ordenes.md` contiene el mapa `R<n> → test` completo (§20).

### Calidad de código
- [x] `pnpm run typecheck` sin errores.
- [x] `pnpm run lint` sin errores.
- [~] `pnpm test` — **un rojo, ajeno y preexistente en `dev`** (§1, §7).
- [n/a] E2E: no hay harness de Playwright ejecutable en este repo y esta feature no toca auth,
      pagos, recaudo, ingesta ni webhooks. Es una **lectura filtrada** de un listado ya
      existente. Se declara inaplicable, no omitida.

### Datos y seguridad
- [x] RLS: la migración **no crea ninguna tabla** → no introduce RLS nueva. `orden` ya tiene
      `ENABLE ROW LEVEL SECURITY` desde `20260709130100_ordenes` y la columna hereda sus
      políticas. Verifiqué además que **no hay ni un `GRANT` a nivel de columna en todo
      `db/migrations`**: la columna nueva no abre ninguna vía de acceso.
- [x] Migración reversible con `down.sql`, orden inverso (índice → columna) e idempotente
      (`IF EXISTS` en las dos sentencias). El round-trip real está en el impl §3.1 y el test
      estático lo fija.
- [x] Sin secretos hardcodeados. El banco lee `DATABASE_URL` del entorno y **se niega a correr
      contra una base que no sea `localhost`**.
- [n/a] Webhooks: no se toca ninguno.

### Patrón de capas — el punto donde esta feature podía ensuciarse, y no lo hace
- [x] **Controller** (`lib/actions/ordenes.ts`): sin cambios; `q` viaja por el mismo `filter`
      validado.
- [x] **Service**: decide *qué* buscar (ruta rápida vs parcial, fallback) y entrega un
      **término**, nunca un patrón. No conoce HTTP ni SQL.
- [x] **Repository**: única capa que conoce el dialecto (`contains`, `escaparLike`, comodines).
      Sin lógica de negocio.
- [x] **Interfaces**: `ListOrdenesWhere` gana `busqueda?` y `numGuia?` en
      `lib/interfaces/repositories/IOrdenRepository.ts`, con la doctrina escrita en el propio
      contrato ("clave HERMANA ⇒ AND; meterla en un OR abriría una fuga").
- [x] **UI**: el control de texto es genérico, no importa dominio; la superficie solo declara y
      traduce. `DataTable` no se toca.

### Permisos
- [x] `app/(app)/ordenes/page.tsx` sin cambios: el acotamiento sigue resolviéndose en servidor.
- [x] Mutaciones: ninguna nueva.

### Multi-país / configuración
- [x] Sin país, moneda ni cuenta hardcodeados. Sí hay texto de UI en español literal, igual que
      todo lo que dejó la 144: no hay i18n en el repo y no se inventó.
      `avisoMinimoCaracteres()` se exporta, así que queda **un** punto por el que pasar cuando
      exista.

### Verificación final
- [~] `./init.sh` en verde → **no**, por el rojo ajeno de `Modal.test.tsx`.
- [x] `progress/review_169-buscador-ordenes.md` — este archivo.
- [ ] Entrada en `progress/history.md` — **pendiente, es T5.4 del leader** (verificado: no hay
      ninguna entrada de la 169).

---

## 3 · Trazabilidad: qué comprobé de verdad

No reproduzco la tabla del impl (§20): la comprobé y es correcta. Lo que sigue es **lo que
verifiqué abriendo el test y leyendo sus asserts**, que es lo único que distingue "mencionado"
de "verificado".

| Requisito | Qué exigí ver | Veredicto |
| --- | --- | --- |
| **R2** (solo cuatro campos) | Una **contraprueba positiva**: que dirección, producto y notas de una orden sembrada con palabras únicas (`zarzaparrilla`, `berenjena`, `malaquita`) devuelvan **0**. Está, contra Postgres real, más el test estático que prohíbe esos nombres en la expresión generada | **verificado** |
| **R3/R4** | Que el borde rechace **antes** de consultar y que `"  a  "` cuente 1 y no 5 (`.trim()` antes de `.min()`) | **verificado** |
| **R5** | Fragmento al principio / en medio / al final / **dentro de una palabra** (`rnand` → "Hernández"), que es justo lo que el FTS no podría | **verificado**, con la salvedad del hallazgo M1 |
| **R6** | Término sin tildes → dato con tildes y al revés, en ambas cajas, incluida la mayúscula acentuada (que es la que demuestra que `translate` va antes de `lower`) | **verificado** |
| **R7** | Lo importante no es que `100%` funcione: es que **`%` a secas no devuelva el listado entero**. El test lo asserta (`total = 1`, `< VIVAS`), y otro comprueba el escape sobre el **SQL realmente emitido** (`"100%_a\b"` → `"100\%\_a\b"`) | **verificado** |
| **R9/R10/R11** | Que el disparador del fallback sea `total` y **no** `items.length`. El test pide la **página 3** de una guía exacta y exige **una sola** llamada al repositorio y `total: 1` | **verificado** — es el bug sutil que el design anunciaba, y el test lo cierra |
| **R12** | `INT4_MAX` pasa, `INT4_MAX + 1` y 30 dígitos caen a parcial sin error | **verificado** |
| **R15** | Que el `count` reciba **el mismo objeto** `where`, incluido el término ya escapado (`expect(count).toEqual(findMany)`) | **verificado** |
| **R16** | Mismo `orderBy` con y sin término, y mismo orden de filas contra la base | **verificado** |
| **R18** | Sin `q`, el `where` es literalmente `{ zonaId: [...] }` y la entrada al repositorio (sort/skip/take) es idéntica | **verificado** |
| **R20** | Que la descarga no pueda divergir: se comparan los dos `where` (`listar` vs `listarCompleto`) para el mismo filtro y se exige que sean **iguales**, y que herede el fallback numérico | **verificado**. Comprobé además en el código que `listarCompleto` conserva `take: limite + 1` y su guard de tope |
| **R22–R25** | Que las pruebas de alcance no pasen **por vacío**. El archivo trae una **contraprueba de maestro**: los mismos términos que el `adminTienda` y el `mensajero` no encuentran, el maestro **sí** los encuentra | **verificado — es el mejor test de la feature** |
| **R26** | Sincronización en los dos sentidos: al modificar `destinatario` se encuentra por el nuevo **y deja de encontrarse por el anterior**; al asignar la guía después, pasa a encontrarse por ella | **verificado** contra Postgres real |
| **R27** | Que la garantía sea del **motor**: un `UPDATE` directo sobre la columna falla con **SQLSTATE 428C9** (asertado por código, no por texto: el servidor responde en español) | **verificado** |
| **R28** | `omit` global + un `findMany` real que no trae la clave + censo estático que prohíbe el nombre en `lib/types/**`, `app/**` y `components/**` | **verificado** |
| **R29/R30** | DOWN de dos sentencias en orden inverso con `IF EXISTS`, sin `DROP EXTENSION` ni `DROP SCHEMA`; y el drift **lo corrí yo**: `prisma migrate diff` → *empty migration* | **verificado de primera mano** |
| **R34** | Que una ráfaga de **diez** pulsaciones produzca **una** emisión (`debounceMs: 150`) y que no haya un segundo temporizador (con `debounceMs: 0` la emisión es síncrona) | **verificado** |
| **R36/R37** | Vaciar retira la clave sin tocar el resto de la barra; "Limpiar todo" emite **una** vez | **verificado** |
| **R38/R39** | Cambiar el término vuelve a página 1 **y** desmarca las filas; re-render con el mismo término **no** dispara consulta | **verificado** |
| **R40** | Con término y 0 filas dice "Sin coincidencias" **repitiendo el término**; sin término el vacío sigue siendo el de siempre | **verificado** |
| **R42** | No me basté con el test: comprobé el diff completo. Solo **dos** archivos de test existentes cambian (§6); `Modal`, `DataTable`, `MultiSelectFilter`, `DateRangeFilter`, `serializar-filtro`, `normalize.ts` y el buscador del mensajero (114) están **intactos** | **verificado** |

**Los dos matices que el implementador declaró, juzgados:**

- **R31 repartido entre test y banco: LO ACEPTO, y no a regañadientes.** El test
  (`busqueda-usa-indice.test.ts`) demuestra con `enable_seqscan = off` que el índice **sirve**
  para la consulta exacta que emite Prisma — que es lo que detecta los fallos silenciosos
  reales (un `mode: "insensitive"` colado, un opclass mal cualificado, un cast que inhabilite
  el índice, un `startsWith` en vez de `contains`). Que el planificador lo **elija** se
  demuestra en el banco, sobre 50 000 filas. El reparto está justificado con mediciones, no con
  excusas: una aserción de elección por coste sobre un corpus de test es **demostrablemente
  inestable** (pending list + bloat), y el implementador dice que escribió esa versión y la
  borró porque falló en las corridas 2 y 3 sin tocar una línea. Un test que genera rojos falsos
  es peor que no tenerlo. **Y la mitad que el test no cubre la reproduje yo entera** (§4).
- **R42 apoyado en parte en un `git diff` vacío: LO ACEPTO**, porque lo verifiqué yo mismo
  sobre el diff contra `origin/dev`, porque hay además un test positivo (`R42: una barra sin
  kind text no monta ningún campo de búsqueda ni aviso`) y porque las suites vecinas pasan sin
  tocarse. Un requisito de "no cambia nada más" **es** una afirmación sobre ausencia; exigir un
  test por cada superficie que no cambió sería pedir infinitos tests.

---

## 4 · Rendimiento — lo reproduje de cero, y sale

Es el motivo de la feature y el aviso expreso del humano, así que no me fié de la tabla de la
bitácora: **corrí el banco entero** (`pnpm exec tsx scripts/bench-busqueda-ordenes.ts`, 50 000
filas, 10 repeticiones, mismo Postgres local).

**¿El banco mide lo que dice medir? Sí, y por el camino correcto.** Verificado leyendo el
script, no su documentación:

1. **No escribe SQL a mano en ninguna aserción.** Instancia `OrdenService` con
   `OrdenRepository` + `OrdenHistorialService` reales —el mismo cableado de
   `lib/actions/ordenes.ts`— y llama a `listar()` con el `filter.q` que produce la UI. El SQL
   que se explica es el **capturado del evento `query` de Prisma**, con sus parámetros reales:
   si el repositorio cambiara mañana, el banco mediría lo nuevo.
2. Usa **el mismo `omit` que producción**: sin él, el `SELECT` traería la columna y el SQL
   medido no sería el que corre.
3. **Se niega a correr contra una base que no sea `localhost`** (`--forzar` hay que escribirlo
   a mano) y limpia detrás en un `finally`, reponiendo columna e índice con el SQL **literal**
   leído de `migration.sql`, con `VACUUM (ANALYZE)` y `REINDEX`.
4. Declara su criterio pesimista: `p95` sobre 10 muestras **es el peor de los diez**, y el
   `total` que se compara contra el umbral es el reloj de pared de las ~13 consultas de una
   llamada real, no el de la consulta de búsqueda.

**Mi corrida, contrastada con la del implementador:**

| Comprobación | Impl (§19) | Mi corrida | Veredicto |
| --- | --- | --- | --- |
| E1 guía exacta | `Index Scan using orden_num_guia_key` | ídem, **sin forzar nada** | coincide |
| E2 selectivo (61 filas) | `Bitmap Index Scan on orden_busqueda_texto_trgm_idx` | ídem, 9 páginas de índice | coincide |
| E3 amplio (10 004 filas, 19,98 %) | `Bitmap Index Scan`, ~15 ms | `Bitmap Index Scan`, **14,456 ms**, 21 páginas de índice | coincide |
| E4 término + estado + fechas | ≤ E3 | `BitmapAnd` de **tres** índices (trgm + estatus + created_at), **2,597 ms** | coincide, y mejor de lo prometido |
| Escalera 0,12 % → 19,98 % | índice en todos los peldaños | **índice en todos**, y **mismo plan con `random_page_cost = 1.1`** | coincide |
| Aserciones de plan | 14 OK | **14 OK** (`>>> TODAS LAS ASERCIONES DE PLAN PASAN`) | coincide |
| E5 escritura (200 órdenes) | +15,1 % (control +14,6 %) | **+15,0 %** (control +10,2 %) | coincide dentro del ruido |
| Coste de aplicar | ADD COLUMN 2,80 s + CREATE INDEX 0,49 s | **3,07 s + 0,53 s** | coincide (~3,6 s / 50 k filas) |
| Limpieza | 67 filas, tabla 40 kB, índice 56 kB | **idéntico** | el banco no ensucia la base |

**Los números son creíbles y reproducibles.** Ningún umbral del design se cruza, y con margen:
E2 a 35× del umbral, E3 a 20×, E5 a 15,0 % de un tope de 20 %. El `count` es sistemáticamente
**más barato** que la página en todos los escenarios, lo que confirma el análisis del design §6
(capar el `total` habría recortado la mitad barata) y justifica que **el plan B no se active**.

**¿Las aserciones de plan del test demuestran de verdad que se usa el índice?** Sí, con el
alcance que declaran. `enable_seqscan = off` no *prohíbe* el recorrido secuencial, solo lo
encarece: que el plan resultante contenga `Bitmap Index Scan on orden_busqueda_texto_trgm_idx`
y **no** `Seq Scan on orden` demuestra que el índice es aplicable a esa consulta. Y hay un
tercer caso que vale más de lo que parece: **el índice devuelve las mismas filas que el
recorrido secuencial** (mismo corpus, misma transacción, con `enable_bitmapscan`/`indexscan`
apagados). Un índice que se usa pero devuelve de menos es el peor fallo posible de esta
feature, y ese caso lo cierra.

---

## 5 · Alcance por rol (fuga de datos) — sin objeciones

- El término se escribe en `construirWhere` **antes** del acotamiento por rol, que sigue siendo
  la última línea y **pisa** cualquier filtro. Leído en el código, no en el comentario.
- El término es **siempre una clave hermana** del `where`: hay un test que enumera las claves
  del objeto que llega a Prisma y exige que **no** exista `OR`. La regla de review del design
  §7 se cumple.
- **La ruta rápida también acota**: `numGuia` es una clave hermana más, no un atajo que
  cortocircuite el `where`. Test explícito: `adminTienda` buscando la **guía exacta** de una
  orden ajena obtiene 0 filas y `total: 0`.
- El `total` filtra igual que los items ("hay 1 resultado que no puedes ver" ya sería una fuga).
- `adminSatelite` → `forbidden` **sin tocar la base** (`expect(list).not.toHaveBeenCalled()`);
  sin sesión → `unauthenticated` **sin instanciar el servicio**.
- La descarga completa comparte `construirWhere` y el fallback, así que hereda las tres cosas.

---

## 6 · Los dos tests existentes modificados — la modificación es legítima

Revisé el diff de los dos, línea a línea:

- `tests/unit/types/orden-filter-144.test.ts`: el caso es un **censo** que enumera
  `ORDEN_FILTER_FIELDS` entera. Se le añade `"q"` y un comentario. **El censo sigue siendo un
  censo**: cualquier clave futura seguirá rompiéndolo. El caso hermano —"una clave desconocida
  sigue fallando"— **no se tocó**, y es el que protege de verdad.
- `tests/unit/components/ordenes-filtros-def.test.ts`: mismo patrón, cuatro asertos
  (`claves(true)`, `claves(false)`, `toHaveLength(7)` → `8`, y la lista sin `reasignables`).

**No debilitan nada.** Un censo que enumera N claves y pasa a enumerar N+1 conserva exactamente
la misma propiedad: ampliar la lista sigue siendo una decisión explícita que rompe un test. La
alternativa —dejar `q` fuera del censo— habría hecho que la constante mintiera. Ningún otro
test existente se modificó (verificado sobre el diff completo, no sobre la declaración).

---

## 7 · Hallazgos

### Bloqueantes

**Ninguno.** No hay ningún requisito sin test, ningún test que no verifique lo que dice
verificar, ninguna fuga de alcance, ningún drift, y el rendimiento —que era el motivo de la
feature— está medido y reproducido de forma independiente.

### Condiciones de cierre (no son deuda del implementer; tienen otro dueño)

**C1 — `./init.sh` está en rojo, así que la feature NO puede pasar a `done` todavía.** El rojo
es `tests/components/Modal.test.tsx > R30: atrapa el foco con Tab`, **ajeno a la 169**: los
archivos implicados son byte-idénticos a `origin/dev` (verificado por mí) y el leader lo
reprodujo en un checkout limpio de `dev` y en tres commits anteriores. `dev` está roja. Como
ese mismo commit pasó `./init.sh` hace unas horas en esta máquina, huele a fragilidad de
entorno (foco en jsdom), no a regresión. **No cuenta contra esta feature, pero CHECKPOINTS
exige `init.sh` verde para `done`: ese rojo necesita dueño antes de cerrar la ficha.**

**C2 — T0.1 y T0.2 siguen sin ejecutarse contra preview y producción, y son precondición de
aplicar la migración.** El implementer no tenía acceso y **no inventó los números**, que es lo
correcto. Juzgo el procedimiento que dejó escrito (impl §22): **es suficiente**, y mejor que lo
que pedía el design, porque añade (a) el coste cronometrado del bloqueo —~3,6 s por cada 50 000
filas, ~14 s a 200 000—, (b) la consulta de `random_page_cost`, que la medición demostró
relevante, y (c) tres verificaciones **posteriores** a aplicar, de las que la tercera (un
`EXPLAIN` real) es la única que no puede darse por hecha. Con dos avisos:
- Ejecutar las dos consultas **antes de mergear**, no antes de desplegar: en Vercel el `build`
  corre `scripts/migrate-deploy.ts` **antes** de `next build`, así que mergear **es** aplicar.
- Ver M4: el modo de fallo "ruidoso" tiene una consecuencia operativa que la nota no dice.

### Menores

**M1 — `menor`: un término de solo dígitos y separadores se reduce SIEMPRE a dígitos, y eso
rompe R5 para una remisión numérica con separadores.** En `OrdenService.escribirBusqueda`:
`where.busqueda = normalizarTerminoBusqueda(digitos ?? termino)`. Como
`soloDigitosSiPareceNumero` acepta `-`, `/`, `.`, `(`, `)`, `+` y espacios, teclear
`"2026-0912"` viaja como `"20260912"`, que **no** casa una `num_remision` guardada como
`REM-2026-0912`: la columna generada indexa el teléfono en sus dos formas, pero la remisión va
tal cual. `num_remision` es `z.string().min(1)` —texto libre—, así que una tienda con remisiones
numéricas con guiones es una posibilidad real. Es un **falso negativo silencioso**: no hay
error, no hay log, la orden simplemente "no aparece". El design §4.2 escribía
`normalizarTerminoBusqueda(input.filter.q)` **sin** la reducción; la reducción es una decisión
de implementación que resuelve una tensión R5 vs R13 que el spec nunca cerró, y se resolvió a
favor de R13 **sin dejar escrito el coste** ni en la lista de deuda ni en las preguntas
abiertas. Salidas: (a) documentarlo como limitación conocida junto al resto de deuda del impl
§23, o (b) buscar las dos formas (`OR` de dos `contains` **sobre la misma columna** —
compatible con la regla de review del design §7, porque no sale de los cuatro campos), a cambio
de dos recorridos de trigram. Cualquiera de las dos, pero decidida y escrita: **la 145 va a
copiar este patrón a 31 tablas**.

**M2 — `menor`: la paridad Node y Postgres se demuestra, pero solo contra el Postgres donde
corre la suite; nunca contra preview ni producción.** El test de paridad es **bueno** —inserta
filas de verdad, lee `busqueda_texto` de la base y lo compara con el normalizador de TS sobre el
mismo texto, con NBSP, tabulador, salto de línea, `ñ`/`ç` en ambas cajas, comodines de LIKE,
guía nula y caracteres fuera del mapa— y la desviación del SQL (`[ \t\n\r\f\v]+` en vez de
`\s+`) está **bien juzgada**: `\s` en Postgres es `[[:space:]]` y depende del ctype, así que con
`\s` la columna se calcularía distinto en msvc y en glibc; la clase explícita elimina esa
dependencia y el corpus incluye el caso NBSP que lo detectaría. **Lo apruebo.** Lo que queda
abierto es que `lower()` sigue dependiendo del ctype para los caracteres **fuera** del mapa
(`Ł`, `Å`, `Ø`): con collation UTF-8 se pliegan en los dos lados, con `LC_CTYPE=C` no, y Node
siempre los baja. Como la suite **no corre contra las bases de Supabase** (CI = solo build de
Vercel), esa mitad nunca se comprueba donde importa. Recomendación concreta: añadir al checklist
post-despliegue de impl §22 un cuarto paso de una línea —leer `busqueda_texto` de una orden con
tildes y comprobar que está plegada— por cada base.

**M3 — `menor`: la `pending list` del GIN queda medida, cuantificada y sin decidir.** El
hallazgo es **bueno y honesto**: el implementer midió que, con el índice sin consolidar —el
estado exacto de `orden` después de cada carga masiva—, la búsqueda es hasta 3x más lenta y un
término poco selectivo **recorre la tabla**, y que el punto donde el planificador se rinde **no
es estable**. No lo maquilló: lo puso en su propio apartado con tres remedios y su precio
(`gin_clean_pending_list` = 31 ms). **¿Es aceptable cerrar así? Sí, y creo que es lo correcto:**
(i) ningún umbral del design se cruza ni siquiera en ese estado —E3 recién cargado da 25 ms de
p50 contra un tope de 500 ms, 20x de margen—; (ii) las tres opciones **tocan diseño** (una
modifica una ruta de escritura) y el arnés prohíbe que el implementer cambie el diseño por
cuenta propia; (iii) el diagnóstico está escrito en la nota de despliegue, así que si alguien
reporta lentitud tras una carga masiva, la primera consulta a correr ya está redactada.
**Pero necesita dueño y fecha**: el margen de 20x es sobre 50 000 filas; con la tabla 10x más
grande, un término amplio recién cargado deja de ser gratis. Es la deuda más relevante que deja
la feature y debe ir al registro, no morir en el impl.

**M4 — `menor`: la nota de despliegue no dice qué pasa cuando el "fallo ruidoso" ocurre.** Si
`pg_trgm` estuviera en otro esquema en preview o producción, la migración falla —deliberado, y
lo apruebo—, pero como Vercel aplica migraciones **dentro del `build`**, ese fallo (a) tumba el
despliegue y (b) deja la migración marcada como fallida en `_prisma_migrations`, lo que
**bloquea todo despliegue posterior** hasta que alguien corra `prisma migrate resolve`. Eso no
está en §22. Dos líneas evitan descubrirlo con producción parada.

**M5 — `menor`: la concurrencia no está medida, y el buscador cambia el perfil de carga.** Lo
declara el propio implementer (§23.6). Lo subrayo porque no es una omisión de laboratorio: cada
llamada a `listar()` dispara ~13 consultas y el pool es `DB_POOL_MAX=3` por instancia; el
buscador convierte un endpoint que se llamaba al cargar la página o al cambiar un filtro en uno
que se llama una vez por ráfaga de tecleo y por operador. El mínimo de 3 caracteres y el
debounce de 500 ms lo acotan, y el término no añade consultas nuevas (salvo el par extra del
fallback numérico), pero el número real con veinte operadores simultáneos **es desconocido**.

**M6 — `menor`: la rama arrastra un cambio de registro ajeno a la feature.** `feature_list.json`
pasa la **feature 144** de `pending` a `done` (con `complexity`, `zone`, `branch`, `spec_path`,
`merged_pr` y `status_note` nuevos) y reapunta el `depends_on` de la **145** de 144 a 169. Está
declarado en el mensaje del commit de spec ("+ saneamiento del registro") y es coherente con lo
que el propio `description` de la 144 anunciaba, así que **no lo rechazo**; lo señalo porque
mergear esta rama **cierra la ficha de otra feature**, y eso tiene que ser una decisión
consciente del leader, no un efecto colateral.

**M7 — `menor` (fragilidad, ya guardada): acoplamiento posicional en `OrdenesListado`.** El
cableado hace `const [busqueda, ...declarados] = construirFiltrosOrdenes(...)` y aplica el
`disabled` en bloque solo a `declarados`. Si alguien reordenara `construirFiltrosOrdenes`, el
filtro equivocado quedaría fuera del apagado. **Hay test que lo impide** (`R32: el PRIMER
filtro declarado es el de busqueda`), así que el riesgo está contenido; filtrar por `key` en
vez de por posición lo haría evidente sin depender de un test.

---

## 8 · Lo que está bien, dicho con la misma claridad

- **El acotamiento por rol no se puede saltar**, y el test que lo demuestra trae su
  contraprueba de maestro para no pasar por vacío. Es exactamente como hay que escribir un
  test de fuga.
- **R31 dejó de ser una promesa.** Lo reproduje entero, de cero, y sale: guía exacta por índice
  único, término selectivo y término que casa una de cada cinco filas **por índice**, con el
  mismo plan a `random_page_cost` 4.0 y 1.1.
- **La paridad de normalización está construida para ser demostrable**, no para ser creída, y
  la desviación del SQL respecto al design (`[ \t\n\r\f\v]+`) está **mejor** que el design y
  bien argumentada.
- **La columna generada no puede escribirse ni filtrarse**: lo garantiza el motor (428C9), no
  la disciplina, y hay `omit` global + censo estático encima.
- **Las tres decisiones de frontend que el design no cerraba están bien resueltas**: no apagar
  el buscador porque falló el catálogo geográfico es correcto (R64 de la 144 apaga los filtros
  que se quedaron sin opciones, no los que nunca las tuvieron, y `reasignables` sigue cayendo
  como antes: **no hay cambio de comportamiento no pedido**); emitir el término recortado evita
  dos keys de caché para el mismo resultado; y la guarda de "no emitir lo ya aplicado" vive
  **dentro del control**, no en `fijar` —verificado en el código—, así que los otros cuatro
  `kind` se comportan exactamente igual que antes.
- **La bitácora no reescribe la historia**: conserva lo que dejó de ser cierto y lo señala. Eso
  es lo que hace que se pueda revisar.

---

## 9 · Veredicto

# OK — aprobado con notas

**0 bloqueantes · 7 menores · 2 condiciones de cierre con otro dueño.**

Los 42 requisitos tienen test, los tests verifican lo que dicen verificar, el término compone
en AND detrás del acotamiento por rol, no hay drift, la migración es reversible e idempotente,
y el rendimiento —el motivo de la feature— está medido y **reproducido de forma independiente
en esta revisión**.

**El código no vuelve al implementer.** Ninguno de los siete menores exige tocar `lib/`, `app/`
ni `components/` para que la feature sea correcta; el más sustantivo (M1) admite cerrarse
documentando la limitación. Antes de marcar la ficha `done`, el leader debe cerrar **C1** (el
rojo ajeno de `Modal.test.tsx`, que hoy deja `./init.sh` en rojo), **C2** (las dos consultas de
T0.1/T0.2 contra preview y producción, **antes de mergear**, porque en Vercel mergear es
aplicar) y **T5.4** (`history.md` + `feature_list.json`). M1 y M3 deben quedar escritos como
deuda con dueño: la 145 hereda este patrón en 31 tablas.
