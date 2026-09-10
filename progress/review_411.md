# Revisión — Ficha 411 · La analítica sigue un lote de carga hasta su desenlace

> Reviewer independiente. Rama `feat/411-analitica-cohorte-de-carga-frontend`, PR **#776**, base `dev`,
> **10 commits** (`e2f283bc` … `98a7e23e`), 34 archivos.
> Árbol de trabajo propio (`R:/wt/review411`, detached en `98a7e23e`), `node_modules` por junction y
> `.env` copiado del checkout principal: **la capa de datos se ejecutó de verdad**.
> Todo lo que dice este informe se **volvió a medir aquí**; nada se da por bueno desde la bitácora.

## Veredicto

**RECHAZADO — 1 bloqueante, y es de papeleo, no de código.**

`specs/411-analitica-cohorte-de-carga/tasks.md` tiene **0 de 33 tareas marcadas `[x]`**. `git diff
dev...HEAD -- specs/` sale **vacío**: el spec de la rama es byte a byte el de `dev`, o sea que nadie
tocó el checklist. `CHECKPOINTS.md` lo exige literalmente («todas las tasks estan marcadas `[x]`») y
`AGENTS.md:148` se lo asigna al implementer («Sigue `tasks.md` una a una, marcando `[x]`»). Es la
convención viva del repo, no una formalidad muerta: 402 y 403 están 15/15.

Se marca bloqueante **porque es un checkpoint explícito incumplido**, no porque haya duda técnica.
**Se arregla en un commit, sin tocar una línea de código**, y con eso el veredicto pasa a APROBADO:
todo lo demás —los 39 requisitos, el gate, las mutaciones, las tres guardias— está verificado y en
verde. **No devuelvo nada de la implementación al implementer.**

---

## Los dos rojos del `design.md §0`, reaplicados por mí

**Ésta era la razón de ser de la revisión. Las dos mutaciones se aplicaron aquí, se corrieron contra
Postgres real y se revirtieron.** Las salidas coinciden con las pegadas en la bitácora.

### T4.1 — `startOfDayCR` como cota contra un `timestamp`

Mutación en `condicionesDeCohorte`: la cota pasa de `rango.desde` a `startOfDayCR(rango.desde)`
(ídem el `hasta`).

```
 FAIL  tests/integration/db/cohorte-carga-fechas.int.test.ts > agrupa cada orden por el dia calendario CR de su created_at
AssertionError: expected [ '2001-06-16', '2001-06-15', …(1) ] to deeply equal [ '2001-06-16', '2001-06-15' ]
+   "2001-06-14",

 FAIL  ... > una orden de las 23:50 CR del dia D cae en la cohorte D, y una de las 00:10 CR del D+1 en la D+1
AssertionError: expected 1 to be 2

 FAIL  ... > los bordes de la ventana son las 06:00Z: la tarde del dia anterior queda FUERA y la noche del ultimo dia DENTRO
AssertionError: expected true to be false     <- filas.some(f => f.fecha === D_MENOS_1)

 Test Files  1 failed (1)      Tests  3 failed | 1 passed (4)
```

**Aparece la cohorte `2001-06-14` que nadie pidió y se cae la orden de las 23:50.** Exactamente lo
anunciado. **Confirmado.**

### T4.4 — la ventana sobre el CIERRE en vez de sobre la CARGA

Mutación en el CTE `cierre`: se le añade la condición de ventana terminal del ciclo de vida.

```
 FAIL  tests/integration/db/cohorte-carga-ventana.int.test.ts > una orden cargada DENTRO y cerrada DESPUES del hasta cuenta igual, y en su cubo terminal
AssertionError: la orden cargada el dia D no aparecio en su cohorte: expected [ 'viva' ] to include 'entregada'

 Test Files  1 failed (1)      Tests  1 failed | 1 passed (2)
```

**Una entregada contada como viva.** El fallo mudo con nombre y apellidos. **Confirmado.**

Tras revertir las dos, `git status` limpio y los ocho archivos de integración de la cohorte:
**8 archivos / 31 casos, 0 rojos, 0 saltados.**

---

## `startOfDayCR` no es cota de nada (punto 2)

`grep` sobre los seis archivos de producción de la ficha (`CohorteCargaRepository`,
`CohorteCargaService`, la acción `cohorte-carga.ts`, `lib/types/cohorte-carga.ts`,
`ICohorteCargaRepository`, `CohorteCargaTabla.tsx`): **una sola aparición, y es un comentario** que
explica por qué NO se usa (`CohorteCargaRepository.ts:31`). Las cotas salen de `resolverRango`
(`rango.desde` / `rango.hasta`), y `cohorte-carga-sql.test.ts` las clava con **literales escritos a
mano** (`2026-08-10T06:00:00.000Z` / `2026-08-17T06:00:00.000Z`), no derivados de la función que los
produce. **OK.**

---

## Las dos mutaciones que sobrevivieron a la primera pasada (punto 3)

Reaplicadas las dos. **Las dos mueren, y los casos nuevos no pasan en falso por escenario vacío.**

**Backend · M9, borrar la condición de alcance** (se le quita la primera condición al `where`):

```
x cohorte-carga-alcance.int.test.ts > la condicion de ALCANCE sostiene el recorte ella sola, sin la faceta del filtro
  AssertionError: expected 4 to be 2
x cohorte-carga-sql.test.ts > va en la POSICION 0 ...   AssertionError: expected 'o."deleted_at" IS NULL' to contain 'o."tienda_id"'
x cohorte-carga-sql.test.ts > adminSatelite se recorta por zona_id de la ORDEN ...
x cohorte-carga-sql.test.ts > global produce TRUE, no un hueco que rompa el AND
 Tests  4 failed | 11 passed (15)
```

Se confirma **también la parte incómoda**: los **cuatro** casos anteriores de T4.6 siguen VERDES con
la mutación puesta (cinturón y tirantes — el recorte también viaja dentro del filtro). El caso nuevo
es el único que la mata, y **no está verde por vacío**: abre con
`expect(soloPorAlcance.length).toBeGreaterThan(0)` y afirma un `2` contra el `4` sin recorte.

**Frontend · M7, `sin_rango` degradado a «filtro inválido»** dentro de `mensajeDe`:

```
x CohorteCargaTabla.test.tsx > sin_rango NO tiene mensaje de error: no es un fallo del filtro
  AssertionError: expected 'El filtro no es valido' to be null
 Tests  1 failed | 27 passed (28)
```

**1 failed / 27 passed, exactamente lo declarado.** El caso lleva su contraste (`forbidden` da
`TEXTO_PROHIBIDO`, `validation_error` da `TITULO_FILTRO_INVALIDO`), así que **no pasa por «esta
función devuelve `null` a todo»**. Está anclado en la función y no en el DOM, que es lo correcto: hoy
la invitación gana el reparto y la tabla ni se monta, así que el DOM no puede distinguir las dos
ramas.

**Bonus, para no fiarme de una muestra de dos:** reapliqué **M1** (quitar el cubo `viva` de `CUBOS`,
que es R32, el requisito que impide que la tabla mienta por omisión). Resultado: **4 failed / 24
passed**, idéntico a lo declarado.

---

## Las tres guardias ajenas (punto 4) — mi juicio: **no se relajó ninguna**

| guardia | está en el diff | veredicto |
| --- | --- | --- |
| `catalogo-produccion.guardia.test.ts` | **NO** | Se arregló renombrando la clave `universo` a `cargadasDelPeriodo` **en el objeto de textos de la ficha**. El censo quedó intacto. |
| `modulo-puro.guardia.test.ts` | **NO** | Se arregló quitando de la guardia NUEVA los tres identificadores que ese censo busca, incluso los que estaban en prosa. Se movió lo propio, no lo ajeno. |
| `cobertura-tablas.guardia.test.ts` | **SÍ** (+ `censo-tablas.ts`) | Contadores **+1 en lock-step** y nada más. |

El tercero es el que había que mirar con lupa, y lo miré:

- lo que cambia son **cuatro cifras**, todas +1 y coherentes entre sí: `TOTAL_ARCHIVOS_CON_DATATABLE`
  de 34 a 35, `TOTAL_INSTANCIAS_DATATABLE` de 34 a 35, `excluidas.length` de 11 a 12, `totalCensado`
  de 35 a 36 y las entradas `fuera` de 12 a 13; las **23 `con_descarga` no se mueven**;
- **no se tocó** el escáner (`listarTsx`, `ARBOLES_UI`), no se añadió ninguna exclusión por patrón,
  no hay `skip`, no se ablandó ninguna aserción;
- la entrada nueva del censo trae su motivo escrito, y el motivo es **una decisión cerrada del spec**
  (P5), no un «ya lo haremos»; declara `estado: "fuera"` con `declaraDescarga === false`, que es lo
  que la guardia comprueba.

**Contraprueba propia:** borré la entrada del censo y la guardia se puso **roja con el mensaje que
tiene que dar** — `hay tablas sin registrar en tests/unit/descarga/censo-tablas.ts` (3 casos rojos).
La guardia sigue mordiendo. **No hay aflojamiento.**

---

## El `EXPLAIN` que desmintió al spec (punto 5) — **bien resuelto**

`cohorte-carga-indices.int.test.ts` afirma **lo que dice R36** y no la elección del planificador:

- `expect(/Seq Scan on orden_historial_estado/i.test(texto)).toBe(false)` — el requisito, literal;
- y que el plan nombre **uno de los dos** índices aplicables de esa tabla
  (`..._orden_id_created_at_idx` o `..._orden_id_estatus_destino_id_idx`), los dos con `orden_id` de
  primera columna y los dos **preexistentes**;
- con su **caso discriminante**: un predicado sin índice (`h."motivo"`) y el mismo
  `enable_seqscan = off` vuelve al `Seq Scan`, o sea que el verde de arriba lo produce el índice y no
  el `SET LOCAL`;
- más una pre-comprobación de que los índices **están aplicados en esta base** («si no, no hay nada
  que medir») y los dos casos del datamodel sobre `db/schema.prisma`.

Y se mide **la consulta que emite el repositorio** (cliente espía más `EXPLAIN` de ese texto con sus
parámetros), no una copia escrita a mano. **R37 no se dispara y no hay migración: correcto.** Que la
medición desmintiera a `design.md §1.2` está escrito en la cabecera del propio test y en la bitácora,
en vez de ajustado en silencio. Eso es exactamente lo que había que hacer.

---

## Los rojos del gate son ajenos — **medido por mí, y coincide al dígito**

Corrí `./init.sh` completo en mi árbol (`progress/gate_review_411.log`, con `INIT_EXIT` **dentro** del
log y sin canalizar por `tail`):

```
✓ DATABASE_URL resuelta: los 155 archivos de tests contra Postgres SI se ejecutan
 Test Files  5 failed | 1871 passed (1876)
      Tests  7 failed | 27251 passed | 26 skipped (27284)
   Duration  806.04s

ROJOS NUEVOS (5 archivo(s) que no estan en el baseline):
  - tests/integration/db/notificacion-evento-bloqueo-cierre-migration.test.ts
  - tests/integration/db/notificacion-evento-dia-reparto-corregido-migration.test.ts
  - tests/integration/db/notificacion-evento-gasto-fijo-migration.test.ts
  - tests/integration/db/notificacion-evento-postulacion-recurso-migration.test.ts
  - tests/integration/db/notificacion-evento-webhook-suscripcion-migration.test.ts
INIT_EXIT=1
```

**Los mismos 5 archivos y los mismos 7 casos que declaró el frontend**, y la causa medida de nuevo
por mi cuenta contra la base local:

| | |
| --- | --- |
| `_prisma_migrations` aplicadas | **190** |
| carpetas en `db/migrations/` | **189** |
| aplicada **sin carpeta en el árbol** | `20260911120000_notificacion_evento_avisos_agregados` (ficha 409, aún en su rama) |
| carpetas no aplicadas | **0** |
| `pg_enum` de `notificacion_evento` | **13** valores donde el árbol declara 11 |

Los rojos son literalmente `+ "novedades_sin_gestionar"` y `+ "devoluciones_represadas"`: los dos
valores que mete esa migración. **Corridos AISLADOS: los mismos 5 archivos y los mismos 7 casos, sin
`40P01` ni flake de saturación.** Ninguno importa ni menciona nada de la 411. **Hicieron bien en NO
meterlos en `tests/baseline-rojos.json`** (el diff no toca ese archivo): la deuda desaparece sola
cuando la 409 mergee, y una entrada de baseline que sobrevive a su motivo fosiliza la lista.

**Y los `integration/db` corrieron de verdad** (contado sobre el `.vitest/rojos.json` de MI corrida):
**240 archivos, 240 con al menos un caso ejecutado, 0 enteramente saltados; 2.793 casos, 0 saltados.**
Los 26 `skipped` de la suite entera son de otros sitios. Miré los `skipped`, no sólo el `INIT_EXIT`.

---

## Trazabilidad: **39 de 39**

Extraje los dos mapas de las bitácoras, corrí los 17 archivos de test de la ficha con reporter JSON y
**crucé cada nombre de caso declarado contra la lista de casos realmente ejecutados** (normalizando
acentos y comillas):

- **39 de 39 requisitos** tienen al menos un caso que **existe y se ejecutó**. Ninguno huérfano.
- **0 rojos y 0 saltados** en esos 17 archivos: **191 casos verdes**. Los 17 `skipped` que aparecen
  son casos `INERTE` preexistentes de las fichas 131/132/133 en `AnaliticaPage.test.tsx`, ajenos.
- De los 39, **leí el cuerpo entero** de los que sostienen el SQL y la frontera (R1 a R4, R6 a R14,
  R16, R18 a R20, R24, R36 a R38) y del contrato de pantalla (R31 a R35, R39); **5 los validé además
  con mutación propia** (R1/R2/R3, R12, R19/R20, R32, R39/R26).

### Las cuatro trampas que venía a buscar

| trampa | qué encontré |
| --- | --- |
| **Los dobles no ven el SQL** | Todo el §2 se prueba contra **Postgres real**: 8 archivos en `tests/integration/db/`, dentro de `enTransaccionRevertida`, con `serializarEscriturasReales` como **primera** sentencia, y ejercitando el **repositorio real** sobre la transacción, no una copia del SQL. La consulta preparada se gana siempre por `prepararConteoEntregas`; el tipo opaco **no se forja** en `lib/`. |
| **Test verde sin datos** | **Todos y cada uno** de los casos de integración abren con `expect(filas.length).toBeGreaterThan(0)` antes de afirmar nada. **Ni un `if (!fks) return;`** en los ocho archivos. El caso `global` de T4.6 **mide** la línea base de la ventana en vez de suponer que 2001 está vacío. Verificado archivo por archivo. |
| **Aserción contra su propia fuente** | Los cuatro cubos se afirman con **literal a mano**, y la guardia T2.4 prohíbe esos mismos literales **en el repositorio**. Las cotas, con instantes ISO escritos a mano. La equivalencia (R11) se compara contra **la otra implementación** (`ConteoCargadasPorDiaRepository.contarCargadasPorDia`), no contra sí misma, y clava `3` días y `6` órdenes a mano. |
| **Literal contrato o polizón** y **el test que vive dentro de lo que borras** | No se borró ningún componente ni ningún test: el diff es **+18.321 / −8**, y las 8 bajas son las líneas que cambian en `ConteoCargadasPorDiaRepository` (sólo el `export` de `DIA_CR`), `analitica-refrescar.ts` y `refrescar-cache-analitica.test.ts` (de 7 a 8 verticales: **la lista y la cuenta, las dos**). Los literales que quedan **son el contrato** y están señalados como tal. |

---

## CHECKPOINTS.md, punto por punto

| | |
| --- | --- |
| `requirements.md` con EARS numerados | OK — 39 (R1 a R39), cero preguntas abiertas |
| `design.md` con alternativa descartada y su porqué | OK — **seis** (A1 a A6), cada una con su motivo |
| `tasks.md` con todas las tasks `[x]` | **FALLA — 0 de 33. BLOQUEANTE** |
| Cada `R<n>` mapea a un test concreto | OK — 39/39, verificados como ejecutados |
| `progress/impl_<feature>.md` contiene el mapa | OK — `impl_411_backend.md` (R1 a R30, R36 a R38) más `impl_411_frontend.md` (R31 a R35, R39, y las mitades de pantalla de R6 y R24) |
| `pnpm run typecheck` | OK — verde en mi corrida del gate |
| `pnpm run lint` | OK — verde en mi corrida del gate |
| `pnpm test` | OK salvo los 5 archivos ajenos de la 409, medidos arriba |
| E2E en flujos críticos | N/A — lectura de analítica; ni auth, ni pagos, ni recaudo, ni ingesta, ni webhooks |
| RLS en tablas nuevas | N/A — **cero tablas nuevas y cero alteradas**. Las tres que lee ya existen y ya tienen RLS habilitada sin policies (patrón del repo); **la frontera real es el `WHERE`**, y eso es justo lo que mide T4.6 contra Postgres |
| Migraciones versionadas y reversibles | N/A — **ninguna migración**, y la decisión está tomada **con los números del `EXPLAIN` delante**, no por intuición |
| Ningún secreto hardcodeado | OK |
| Webhooks con firma e idempotencia | N/A |
| Controller sin queries ni negocio | OK — `lib/actions/cohorte-carga.ts` parsea, deniega, invita y delega; ni una query |
| Service sin HTTP | OK — `CohorteCargaService` no conoce `Request`/`Response` ni importa Prisma ni `next/*` |
| Repository sólo queries | OK — un `$queryRaw`, cliente `Pick<PrismaClient, "$queryRaw">`; **`$queryRawUnsafe` no está y no puede estar** |
| Interfaces en `lib/interfaces/` | OK — `lib/interfaces/repositories/ICohorteCargaRepository.ts` |
| Páginas protegidas validan en servidor | OK — la denegación vive en el borde de la Server Action (`resolveActorFromSession` más `prepararConteoEntregas`) y **precede a la invitación** |
| Mutaciones internas por Server Action | OK — **una sola puerta**, con guardia propia (R35) y caso discriminante |
| Sin hardcode de país, moneda ni cuenta | OK — el formateador de días sale de `monedaConfig.locale` vía `Intl`; ni un literal de idioma |
| `./init.sh` en verde | AVISO — `INIT_EXIT=1` **por los 5 rojos ajenos de la 409**, medidos, aislados y con causa nombrada. No es de esta ficha |
| `progress/review_<feature>.md` con veredicto | OK — este archivo |
| Entrada en `progress/history.md` | PENDIENTE — la escribe el leader al cerrar |

---

## Hallazgos

### BLOQUEANTE

1. **`specs/411-analitica-cohorte-de-carga/tasks.md` tiene las 33 tareas sin marcar.**
   `git diff dev...HEAD -- specs/` está vacío. Lo exige `CHECKPOINTS.md` y se lo asigna
   `AGENTS.md:148` al implementer. **Qué falta:** marcar `[x]` las tareas hechas y commitear en la
   rama. Un commit, cero código. **T8.2 no se marca mientras no se haya hecho** (ver menor 2).

### menor

2. **T8.2 sin hacer: nadie ha visto la tabla en un navegador.** *Límite declarado, no bloqueante, y lo
   escribo en voz alta porque es el hueco real de esta ficha.* **Todo está medido en jsdom.** La suite
   no ve una tabla de **siete columnas** que se salga a 390 px, un texto roto ni una cohorte con
   «1 órdenes cerradas». La bitácora del frontend no lo esconde. Recomendación antes de mergear:
   entrar como maestro, `adminTienda` y `adminSatelite`; dejar la barra sin rango (debe **invitar**);
   poner una semana; poner un mensajero (debe **advertir**); y mirar a 390 px.
3. **La rama va 8 commits por detrás de `origin/dev`** (hasta `d21c5e6f`). `gh pr view 776` la da
   `MERGEABLE` y **ninguno de esos 8 toca un archivo de la 411** —son de la 408 y specs de la 409—,
   así que no hay conflicto a la vista; pero F2.3 (`git merge origin/dev`) sigue pendiente, y el gate
   completo se vuelve a correr **después** del merge, no antes.
4. **`progress/history.md` sin entrada de la 411.** Es del leader al cerrar; queda anotado para que no
   se caiga.
5. **La deuda ajena de la 409 desaparecerá sola.** Cuando esa migración entre en `dev`, los 5 rojos se
   apagan solos. **No hay nada que añadir ni que quitar del baseline.**

### Lo que NO es hallazgo, y lo digo para que nadie lo reabra

Por día y no por `carga_id`; rango obligatorio con `sin_rango` como invitación; `porDia` descendente y
la pantalla sin reordenar; los cubos en 0 y los días vacíos que no viajan; `Vivas` obligatoria también
en 0; segundos crudos con su `n`; la faceta de mensajero que no recorta y se advierte; y una
`devuelta` que **sigue viva**. **Todas son decisiones cerradas del spec, todas están implementadas
como se decidió, y ninguna es un hallazgo.**

---

## Lo que me convenció

Tres cosas, y ninguna es «hay muchos tests»:

1. **Los dos rojos del `§0` existen de verdad.** Los reapliqué y salieron **con la misma cara**: una
   cohorte `2001-06-14` que nadie pidió, y una entregada contada como viva. El error que esta ficha
   existía para no cometer **está atrapado por un test que muere si alguien lo comete**.
2. **Las dos mutaciones supervivientes se declararon en vez de esconderse**, y los casos que nacieron
   de ellas **matan de verdad**: lo comprobé. Un implementer que reporta un superviviente es un
   implementer que corrió el arnés.
3. **Las tres guardias ajenas se arreglaron moviendo lo propio.** Dos ni siquiera están en el diff, y
   la tercera sube contadores en lock-step y **sigue roja si le quitas la entrada**. Es exactamente el
   sitio donde se afloja una guardia para que pase lo tuyo, y aquí no pasó.

**Arregla `tasks.md`, haz T8.2 con el navegador delante, y esto entra.**
