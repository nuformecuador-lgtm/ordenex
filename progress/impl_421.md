# impl 421 — un test de migración consulta el enum sin fijar el esquema

Rama `fix/421-enum-sin-esquema-en-test`, worktree `R:/wt/wt421`, base `origin/dev` = `5fa73fa6`.

## Lo que se arregló, y cuánto era

El defecto llegó diagnosticado (`progress/flake_enum_esquema_2026-09-11.md`): la consulta del enum
filtraba por `t.typname` **sin acotar el namespace**, y el harness aísla varios archivos creando
esquemas temporales donde ese mismo enum está clonado. Los catálogos de Postgres son **globales a la
base** —el `search_path` no los filtra—, así que con dos esquemas vivos el `string_agg` sumaba los
dos tipos: 11 etiquetas esperadas, 23 recibidas, cada una duplicada.

**El censo, medido con un tokenizador y no con `grep`** (el `grep` crudo daba 88 «hallazgos» y más
de la mitad eran títulos de `it(...)` y comentarios que nombran el catálogo a propósito):

| | |
| --- | --- |
| SQL a catálogos en `tests/` | **162** |
| ya acotaban el esquema | **125** |
| **sin acotar** | **37**, en **21 archivos** |
| arregladas | **37** (+ **2** en `scripts/bench-busqueda-ordenes.ts`) |
| **quedan** | **0** |

No era un archivo: era **una ficha con 21 archivos**. Que 125 de 162 ya lo hicieran bien es lo que
demuestra que las 37 eran un olvido y no una decisión.

De las 37: **17 eran del enum** y pasan ahora por un único `etiquetasDeEnum()` en
`tests/integration/db/_postgres-real.ts` (un solo sitio, y es la consulta que ejercita el caso
rojo); las otras **20** se acotaron en sitio con el filtro que le toca a cada catálogo
(`n.nspname`, `schemaname`, `table_schema`). Ninguna aserción cambió de significado.

## Archivos

**Nuevos**
- `specs/421-enum-sin-esquema-en-test/{requirements,design,tasks}.md`
- `tests/integration/db/catalogo-consulta-acota-esquema.test.ts` — el caso que reproduce el defecto.
- `tests/unit/guards/catalogo-postgres-acota-esquema.guardia.test.ts` — el barrido, con contraprueba.

**Modificados** (23)
- `tests/integration/db/_postgres-real.ts` — `SQL_ETIQUETAS_DE_ENUM` + `etiquetasDeEnum()`.
- 21 archivos de `tests/integration/db/` con las 37 consultas.
- `scripts/bench-busqueda-ordenes.ts` — 2 consultas, y reescritas como **una sola plantilla**: la
  guardia no puede emparejar un `WHERE` que vive en otro literal concatenado.

## EL ROJO, que es el entregable

El defecto solo aparece con **dos esquemas vivos a la vez**, así que un test normal no lo caza. El
caso nuevo lo monta a propósito y con una **canaria**: clona `notificacion_evento` en un esquema
desechable **añadiéndole una etiqueta que `public` no tiene**. La consulta real no puede devolverla;
la vieja sí. La canaria es lo que hace el caso **determinista** pese a la concurrencia, que es
justo lo que hacía indiagnosticable al original.

El control (`SQL_VIEJA_SIN_ESQUEMA`) **no es una copia escrita a mano**: se obtiene quitándole el
arreglo a la consulta real, así que no puede quedarse vieja, y una precondición afirma que las dos
son distintas y que la real sigue llevando su `n.nspname = 'public'`.

### Mutación de control A — quitarle el filtro de esquema al helper

`pnpm exec vitest run tests/integration/db/catalogo-consulta-acota-esquema.test.ts tests/unit/guards/catalogo-postgres-acota-esquema.guardia.test.ts`

```
 FAIL  catalogo-consulta-acota-esquema.test.ts > precondicion: el control ES la consulta real SIN el arreglo
 FAIL  catalogo-consulta-acota-esquema.test.ts > ⭑ con un SEGUNDO `notificacion_evento` vivo en otro esquema,
       la lectura sigue dando la de `public` — ni una mas
   AssertionError: la lectura se trajo la etiqueta del OTRO esquema:
     expected [ 'orden_rechazada', …(30) ] to not include 'canaria_solo_en_el_esquema_temporal_4…'
 FAIL  catalogo-postgres-acota-esquema.guardia.test.ts > ⭑ NINGUNA consulta del arbol lee un catalogo sin
       decir de que esquema habla
   tests/integration/db/_postgres-real.ts:346 -> SELECT e.enumlabel AS etiqueta FROM pg_enum e JOIN pg_type t
   ON t.oid = e.enumtypid WHERE t.typname = $1 ORDER BY e.enum

 Test Files  2 failed (2)
      Tests  3 failed | 10 passed (13)
```

Con el arreglo puesto, esos mismos dos archivos:

```
 Test Files  2 passed (2)
      Tests  13 passed (13)
```

### Mutación de control B — quitarle el filtro a UNA de las 20 acotadas en sitio

```
 FAIL  catalogo-postgres-acota-esquema.guardia.test.ts > ⭑ NINGUNA consulta del arbol lee un catalogo …
   tests/integration/db/correccion-fecha-reprogramacion-migration.test.ts:215 ->
   SELECT count(*)::bigint AS n FROM pg_policies WHERE tablename = '${TABLA}'
      Tests  1 failed | 6 passed (7)
```

### Mutación de control C — el detector de la guardia deja de denunciar (`return []`)

```
 × la exclusion de este archivo no tapa nada: sus muestras sin acotar son las deliberadas
 × ⭑ denuncia una consulta sin acotar, y dice en que linea
 × separa las dos consultas de un mismo archivo: denuncia la mala y deja la buena
      Tests  3 failed | 4 passed (7)
```

Las tres mutaciones **murieron**, y las tres se revirtieron copiando el archivo sano guardado antes
(nunca `git checkout --`). Verificado tras revertir: `grep` del texto mutado sin resultados y los
dos archivos otra vez en verde.

**Y una cuarta muerte que no estaba planeada:** la guardia, al estrenarse, denunció
`scripts/bench-busqueda-ordenes.ts:840`, una consulta que nadie había mirado. Se arregló.

## Mapa R → test

| R | Qué exige | Test |
| --- | --- | --- |
| **R1** | con otro esquema homónimo vivo, la lectura da solo `public` | `catalogo-consulta-acota-esquema.test.ts` → «⭑ con un SEGUNDO `notificacion_evento` vivo en otro esquema…» |
| **R2** | la consulta vieja, en ese mismo escenario, sí se lo trae (no-vacuidad) | mismo archivo → «⭑ CONTROL — la consulta VIEJA…» + «precondicion: el control ES la consulta real SIN el arreglo» |
| **R3** | cero consultas sin acotar en el árbol | `catalogo-postgres-acota-esquema.guardia.test.ts` → «⭑ NINGUNA consulta del arbol lee un catalogo sin decir de que esquema habla» |
| **R4** | la guardia denuncia, con archivo y línea | misma guardia → «⭑ denuncia una consulta sin acotar, y dice en que linea» + «separa las dos consultas de un mismo archivo» |
| **R5** | lee código, no prosa | misma guardia → «⭑ no confunde prosa con codigo: ni comentarios ni titulos de `it(...)`» |
| **R6** | el esquema temporal se suelta aunque el caso falle | `catalogo-consulta-acota-esquema.test.ts` → «R6 — el esquema desechable se suelta TAMBIEN cuando el cuerpo lanza» y «R6 — al terminar, este archivo no deja ningun esquema suyo vivo» |
| **R7** | lo que ya medían los 21 archivos sigue midiéndose | los 23 archivos tocados, corridos juntos: `Test Files 23 passed (23) · Tests 344 passed (344)`, cero saltados |

## Limpieza (la regla de la casa)

El caso nuevo **no escribe en `public`**: crea su esquema `p421_<sello>_<uuid>`, lo mide y lo suelta
en un `finally` — también por el camino de fallo, que es el que se olvida y el que deja basura que
pone en rojo la suite de otro worktree. Hay además un `afterAll` de cinturón y tirantes y un barrido
de huérfanos **por edad (> 1 h)**, no por prefijo a secas: dos worktrees comparten esta base y un
barrido ciego se llevaría el esquema de una corrida viva.

Comprobado al terminar: `SELECT nspname FROM pg_namespace WHERE nspname LIKE 'p421_%'` → vacío.

## Salida real del gate

El paso 3 de `./init.sh` (la validacion de `feature_list.json`) **muere por una ficha que no es
esta**: la 420 esta `in_progress` y su carpeta de specs vive en SU rama, no en `dev`. Es el modo de
fallo ya conocido —«`in_progress` sin spec rompe el gate»— y deja rojo a todo el que corra desde
`dev`. No se toca `init.sh` (lo lleva la 420) ni `feature_list.json` (lo lleva el leader):

```
== Arnes SDD :: init (modo: completo) ==
✓ node v24.13.0
✓ dependencias presentes
  - falta la carpeta de specs de la ficha 420 ("el gate dice dependencias presentes cuando falta una dependencia declarada")
✗ feature_list.json invalido (el detalle esta justo arriba)
INIT_EXIT=1
```

Asi que se corrieron **los pasos 5 y 6 tal cual los ejecuta `init.sh`**, en el mismo orden y con la
misma comparacion contra el baseline:

```
-> pnpm run typecheck
TYPECHECK_EXIT=0
-> pnpm run lint
✖ 184 problems (0 errors, 184 warnings)     <- los 184 son avisos preexistentes de dev; 0 en lo tocado
LINT_EXIT=0
DATABASE_URL: resuelta
archivos contra Postgres: 171
-> pnpm run test:json

 Test Files  1943 passed (1943)
      Tests  28177 passed | 26 skipped (28203)
   Duration  1394.09s

-> node scripts/comparar-baseline-rojos.mjs .vitest/rojos.json
sin rojos nuevos (0 archivo(s) rojo(s) sobre 1943 ejecutado(s), todos en el baseline conocido)
COMPARACION_EXIT=0
INIT_EXIT=0
```

**Los `skipped` son 26 y son los de siempre**: 17 de `AnaliticaPage` y 9 de `AnaliticaShell`.
**Cero de `integration/db`** — los 171 archivos contra Postgres se ejecutaron (219 archivos de
`integration/db` en el log, ni uno saltado), que es lo que hace que este verde signifique algo.

## Veredicto

El olvido no estaba en un archivo sino en **37 consultas de 21 archivos**: las 37 acotan ya el
esquema, un caso determinista con canaria demuestra el defecto y su arreglo, tres mutaciones de
control murieron, y una guardia impide que vuelva a colarse. Gate completo (pasos 5-6) en verde,
**INIT_EXIT=0**, 26 saltados y ninguno de `integration/db`.
