# Feature 258 — bitácora del bloque BACKEND (B1–B5)

Rama: `feat/258-monitoreo-backend`. Sin commit y sin PR: eso lo hace el leader.
Alcance: **sólo B1–B6**. No se tocó ni un archivo de `app/(app)/monitoreo/_components/`.

---

## Tareas cerradas

| Tarea | Estado |
| --- | --- |
| B1.1 — `horaDeParedCR(ventana, instante)` | cerrada |
| B2.1 — contrato: `PuntoRitmoEntregas`, `ritmoEntregas`, `sumarTotalesTablero` movida | cerrada |
| B2.2 — `EntregasEnHora` + `contarEntregasPorHora` en la interfaz | cerrada |
| B2.3 — `RepositorioDoble` implementa el método nuevo | cerrada |
| B3.1 — tercera consulta, al final del repositorio | cerrada |
| B3.2 — test del SQL emitido | cerrada |
| B3.3 — guardia de frontera actualizada (3 consultas, clasificación exacta) | cerrada |
| B4.1 — `acumularPorHora` | cerrada |
| B4.2 — `obtener` con `Promise.all` dentro de `cache.envolver` | cerrada |
| B4.3 — tests del servicio | cerrada |
| B4.4 — test de `sumarTotalesTablero` en su sitio nuevo | cerrada |
| B4.5 — literales de `TableroDia` extendidos | cerrada |
| B5.1 — integración contra Postgres real | cerrada |
| **B6.1 — gate completo** | **NO cerrada: la corre el leader** (`./init.sh` completo, no `--rapido`) |

Las casillas están marcadas en `specs/258-monitoreo-tablero-primitivas/tasks.md` (B6.1 sigue en `[ ]`).

---

## Archivos

### Creados

- `tests/unit/utils/ventana-dia-cr-hora.test.ts`
- `tests/unit/repositories/tablero-dia-ritmo-sql.test.ts`
- `tests/unit/services/tablero-dia-ritmo.test.ts`
- `tests/unit/tablero-dia/sumar-totales.test.ts`
- `tests/integration/tablero-dia-ritmo.test.ts`

### Modificados

- `lib/utils/ventana-dia-cr.ts` — `+ horaDeParedCR`. Sin `startOfDayCR`, sin `new Date()` propio.
- `lib/types/tablero-dia.ts` — `+ PuntoRitmoEntregas`, `+ ritmoEntregas` (obligatorio),
  `+ sumarTotalesTablero` **movida** desde el servicio. Sigue sin importar `repositories/`,
  `services/`, `@/lib/db` ni `next/headers` (lo afirma `sumar-totales.test.ts`).
- `lib/interfaces/repositories/ITableroDiaRepository.ts` — `+ EntregasEnHora`,
  `+ contarEntregasPorHora`.
- `lib/repositories/TableroDiaRepository.ts` — `+ RESULTADO_ENTREGADA`, `+ FilaEntregasEnHoraRow`,
  `+ contarEntregasPorHora` **al final del archivo** (el orden importa: la guardia clasifica por
  posición en el texto).
- `lib/services/TableroDiaService.ts` — `sumarTotales` deja de vivir aquí y se consume del
  contrato; `+ acumularPorHora` exportada; `obtener` pide las dos lecturas con `Promise.all`
  dentro de `cache.envolver`, con un solo `generadoAt`.
- `tests/unit/services/_doble-tablero-dia.ts` — el doble apunta las llamadas a la serie
  (`repo.ritmos`), con productor inyectable por constructor.
- `tests/unit/tablero-dia/frontera.guardia.test.ts` — cláusula (d) actualizada.
- `tests/unit/actions/tablero-dia-accion.test.ts`, `tests/components/TableroDiaModule.test.tsx`,
  `tests/components/DetalleMensajeroPanel.test.tsx` — el literal `TableroDia` **extendido** con
  `ritmoEntregas` (B4.5). Los dos de `tests/components/` no estaban en la lista de B4.5 pero sí
  en `design.md §10`, y sin ellos el typecheck queda rojo: son el mínimo indispensable
  (una línea cada uno). **No se tocó ningún componente.**

`lib/actions/tablero-dia.ts` no cambia: la serie viaja dentro de `leerTableroDia`.

---

## La guardia que muerde (B3.3), y cómo quedó

`tests/unit/tablero-dia/frontera.guardia.test.ts`, cláusula (d):

- `expect(consultas).toHaveLength(3)` — no `toBeGreaterThanOrEqual`.
- `expect(clasificacion).toEqual(["agregada", "paginada", "agregada"])`.
- **Se REFORZÓ**, no se aflojó: la clasificación posicional se podía satisfacer con tres
  consultas cualesquiera, así que ahora cada posición lleva además la marca de SU consulta
  (`GROUP BY a.mensajero_id` / `OFFSET` / `EXTRACT(EPOCH FROM` + `GROUP BY 1`), y la tercera
  tiene su propia aserción de R53 (`not.toMatch(/AT TIME ZONE|America\/Costa_Rica/)`).

Comprobado mutando y revirtiendo (ver más abajo): si la tercera pierde su `GROUP BY` la
clasificación pasa a `SIN LIMITE` y la guardia se pone roja; si aparece una cuarta consulta,
`toHaveLength(3)` la caza.

---

## Mapa `R<n> → test` (los requisitos de este bloque)

| R | Test |
| --- | --- |
| R50 | `tests/unit/services/tablero-dia-ritmo.test.ts` › «publica la serie DENTRO del tablero» |
| R51 | `tests/integration/tablero-dia-ritmo.test.ts` › ESCENARIO 2 y ESCENARIO 3; `tests/unit/repositories/tablero-dia-ritmo-sql.test.ts` › «el MISMO DISTINCT ON del tablero» |
| R52 | `tests/integration/tablero-dia-ritmo.test.ts` › ESCENARIO 1; `tablero-dia-ritmo.test.ts` (servicio) › «el ULTIMO punto es exactamente `totales.entregadas`»; `tablero-dia-ritmo-sql.test.ts` › «`CONTADOR_POR_RESULTADO[RESULTADO_ENTREGADA] === "entregadas"`» |
| R53 | `tablero-dia-ritmo-sql.test.ts` › «la hora sale de `ventana.desde`, sin ningun identificador de zona horaria»; `tests/integration/tablero-dia-ritmo.test.ts` › ESCENARIO 4; `frontera.guardia.test.ts` › cláusula (a) y cláusula (d); `tests/unit/utils/ventana-dia-cr-hora.test.ts` (los 9 casos) |
| R54 | `tablero-dia-ritmo.test.ts` (servicio) › «cubre SIN HUECOS las horas 0..H» y «es MONOTONA no decreciente» |
| R55 | `tablero-dia-ritmo-sql.test.ts` › «el zonaId viaja como PARAMETRO»; `tests/integration/tablero-dia-ritmo.test.ts` › ESCENARIO 5; `tablero-dia-ritmo.test.ts` (servicio) › «el MISMO filtro de alcance que los conteos»; `frontera.guardia.test.ts` › «`resolverAlcance` en un solo archivo» (sigue verde: no se añadió ningún importador) |
| R56 | `tablero-dia-ritmo.test.ts` (servicio) › «un actor DENEGADO no llama al repositorio ni una sola vez» y «sin sesion tampoco» |
| R57 | `tablero-dia-ritmo.test.ts` (servicio) › «`generadoAt` es UNO SOLO» y «un acierto de cache NO vuelve a llamar a `contarEntregasPorHora`»; `tablero-dia-accion.test.ts` › «la serie viaja DENTRO del tablero y el borde no la toca» |
| R58 | `tablero-dia-ritmo-sql.test.ts` (archivo entero); `frontera.guardia.test.ts` › cláusula (d) |
| R59 (parte backend) | `tablero-dia-ritmo.test.ts` (servicio) › «un dia SIN ninguna entrega devuelve la serie completa a cero, no una lista vacia» — el `[]` que dispara el vacío del marco lo produce el **adaptador** del frontend (F6.1), no el servicio |
| R72 | `tests/integration/tablero-dia-ritmo.test.ts` › **ESCENARIO 3**, nombrado «el punto de las 10:00 BAJA, y eso es lo ESPERADO» |
| R2 | no hay diff en `db/migrations/**` ni en `db/schema.prisma` (comprobable con `git diff --stat`) |
| R3 / R65 | `tests/unit/tablero-dia/sumar-totales.test.ts` › «se cumple sobre TODOS los subconjuntos» (32 subconjuntos) y «hay UNA sola implementacion de la suma en el arbol» |
| R77 (parte backend) | `tablero-dia-ritmo.test.ts` (servicio) › «los 24 puntos … y ni uno mas»: afirma `MAX_PUNTOS_SERIE === 62` y `serie.length <= MAX_PUNTOS_SERIE`. **Comprobado, no supuesto**: `components/private/analytics/topes.ts:54` |

---

## Verificación — salida real

### `pnpm run typecheck`

```
> ordenex@0.1.0 typecheck R:\job\singularis\projects\ordenex
> tsc --noEmit

TC_EXIT=0
```

Sin una sola línea de error.

### `pnpm run lint`

```
✖ 97 problems (0 errors, 97 warnings)
```

**0 errores.** Los 97 warnings son `no-unused-vars` preexistentes en otros archivos
(`_input`, `_opciones`, …). Filtrando por los archivos de esta rama
(`lint | grep -iE "ritmo|tablero-dia|sumar-totales|ventana-dia"`) no sale **ninguno**.

### `pnpm exec vitest run tests/unit/tablero-dia tests/unit/services tests/unit/repositories tests/unit/actions tests/unit/utils`

```
 Test Files  406 passed (406)
      Tests  6221 passed (6221)
   Duration  59.25s
```

### `pnpm exec vitest run tests/integration/tablero-dia-*`

```
 Test Files  6 passed (6)
      Tests  44 passed (44)
   Duration  1.63s
```

(los seis: `ritmo` nuevo + `conteo`, `aislamiento`, `detalle-cuadre`, `detalle-aislamiento`,
`recoleccion` de la 192, todos verdes sin tocarlos)

El de integración **corrió de verdad, no se saltó**: hay `.env` con `DATABASE_URL` y
`HAY_BASE_DE_DATOS` es `true` (8 tests `passed`, no `skipped`).

### `pnpm exec vitest run tests/components/TableroDia*.tsx tests/components/DetalleMensajeroPanel.test.tsx`

```
 Test Files  4 passed (4)
      Tests  40 passed (40)
```

### `pnpm exec vitest run guard` (las 126 guardias del repo)

```
 Test Files  126 passed (126)
      Tests  1877 passed (1877)
   Duration  13.06s
```

### `pnpm exec vitest run` (suite completa)

```
 Test Files  1262 passed (1262)
      Tests  16661 passed | 26 skipped (16687)
   Duration  346.42s

VITEST_EXIT=0
```

Corrida entera, **secuencialmente y sin mutar el arbol a la vez** (el exit code se capturo
dentro del log con `VITEST_EXIT=$?`, no por un `echo` posterior). Los 26 `skipped` son los de
siempre en esta maquina, no de esta rama. Esto **no sustituye a `./init.sh` completo** —el gate
corre ademas typecheck, lint y las guardias de arbol—, pero deja constancia de que la rama no le
entrega un rojo al leader.

---

## Las mutaciones con las que se mató el test de integración

Un test de integración verde no prueba nada hasta que se le mata con una mutación. Se probaron
**cinco**, cada una revirtiendo el archivo desde una copia antes de la siguiente:

| # | Mutación en `contarEntregasPorHora` | Resultado |
| --- | --- | --- |
| A | `AND g."created_at" <  ${ventana.hasta}` → `<=` (la ventana deja de ser semiabierta) | **ROJO**: `una gestion FUERA de la ventana del dia no entra en la serie` — `expected [ { hora: 24, entregadas: 1 } ] to deeply equal []`. Se repitió tras reescribir el divisor y siguió dando `hora: 24` (el fallo se ve, no se disfraza de hora 0) |
| B | quitar `DISTINCT ON (g."orden_id")` | **ROJO x2**: ESCENARIO 2 (`expected [{hora:9},{hora:14}] to deeply equal [{hora:14,entregadas:1}]`) y ESCENARIO 3 (`expected [{hora:10,entregadas:2}] to deeply equal [{hora:10,entregadas:1}]`) |
| C | hora de pared → hora UTC cruda (`EXTRACT(HOUR FROM r.at)`) | **ROJO x6**: los seis escenarios, todos con las horas corridas exactamente +6 (`13` en vez de `7`, `20` en vez de `14`, `5` en vez de `0`…). Es la prueba de que el `::timestamp` sobre el parámetro se interpreta como se esperaba contra Postgres real |
| D | `AND ${fragmentoDeAlcance(filtro)}` → `AND TRUE` | **ROJO x2**: ESCENARIO 5 (la zona A pasa a ver la entrega de la zona B) y el test de SQL (`to match /o\."zona_id"\s*=\s*\$\d+/`) |
| E | quitar `GROUP BY 1`; y aparte, añadir una cuarta `$queryRaw` | **ROJO** la guardia de frontera en los dos casos: `["agregada","paginada","SIN LIMITE"]` y `expected […(4)] to have a length of 3 but got 4` |

Tras cada mutación el archivo se restauró desde copia y la suite volvió a verde.
`git diff --stat` sobre `lib/repositories/TableroDiaRepository.ts` confirma que no quedó
ningún resto.

---

## Desviaciones del design, y por qué

### 1. El divisor de la hora se escribe `INTERVAL '1 hour'`, no `3600`

El design (§6) escribe la hora como
`FLOOR(EXTRACT(EPOCH FROM (r.at - ${ventana.desde}::timestamp)) / 3600)::int`.
**Ese literal pone roja una guardia ajena**: `tests/unit/analytics/cache-config.guardia.test.ts`
prohíbe el número `3600` en todo `lib/repositories/` porque ahí es el TTL de la caché de
analítica y tiene que vivir en una sola constante. Se descubrió corriendo `vitest run guard`
(el gate lo habría cazado; la memoria del repo ya avisa de los guards cruzados).

Salidas evaluadas:

- aflojar la guardia ajena → **descartado**: protege algo real y no es de esta ficha;
- declarar `const SEGUNDOS_POR_HORA = 3600` en el repositorio → **no sirve**: el censo mira el
  archivo, no la forma;
- `EXTRACT(HOUR FROM (r.at - desde))` → **descartado**: descarta en silencio la componente de
  días del interval, así que una ventana más ancha metería horas del día siguiente disfrazadas
  de 0..23. Medido: con esa forma, la mutación A daría `hora: 0` en vez de `hora: 24` — un fallo
  mudo donde antes había uno que se ve;
- **elegida**: `/ EXTRACT(EPOCH FROM INTERVAL '1 hour')`. Mismo resultado, misma loudness
  (mutación A sigue dando `hora: 24`), sin el literal y además autoexplicativa.

Queda escrito en el propio método, con un `⛔ No lo "simplifiques" de vuelta a / 3600`.

### 2. `acumularPorHora` pliega en el último punto una hora por encima del corte

El design dice «rellena `0..horaCorte` sin huecos, acumula». No dice qué hacer si el histograma
trae una hora **mayor** que el corte, que puede pasar por desfase entre el reloj de la
aplicación y el de la base. Descartarla rompería R52 (el último punto dejaría de ser
`totales.entregadas`, porque el contador sí la cuenta) y ampliar la serie hasta esa hora
rompería R54 (la serie llegaría más allá de la hora de pared). **Se pliega dentro del último
punto**: las dos cosas siguen siendo ciertas. Documentado en el código y con test propio
(`acumularPorHora` › «una hora POR ENCIMA del corte se pliega»).

### 3. Dos tests de `tests/components/` tocados que B4.5 no nombra

B4.5 nombra `tablero-dia-accion.test.ts` y los tests de servicio. Pero `design.md §10` sí lista
`TableroDiaModule.test.tsx` y `DetalleMensajeroPanel.test.tsx`, y **sin ellos el typecheck queda
rojo**: `ritmoEntregas` es obligatorio. El cambio es una línea en cada uno, dentro del literal
`TableroDia`, extendiéndolo (no aflojándolo a `objectContaining`). Serie coherente, no `[]`:
su último punto es `totales.entregadas`. No se tocó ningún componente ni ninguna aserción.

---

## Lo que queda abierto

1. **B6.1 — el gate completo lo corre el leader.** `./init.sh` **completo**, no `--rapido`: se
   tocó `lib/types/`, así que el modo rápido se niega solo. Y **secuencialmente**, sin ningún
   subagente mutando el árbol a la vez.
2. **El bloque FRONTEND (F1–F7) no está empezado.** El contrato ya está: `ritmoEntregas` viaja
   dentro de `TableroDia` y `sumarTotalesTablero` ya es importable desde un Client Component.
3. **Aviso para F6.1 (`serie-ritmo.ts`):** el servicio devuelve SIEMPRE los puntos `0..H`, también
   cuando todos valen 0. `GraficaLineas` decide `hayDatos` con `series.some(s => s.puntos.length > 0)`,
   así que si el adaptador pasa la serie tal cual pintará **una línea plana a cero** en vez del
   vacío del marco (R59). El adaptador tiene que devolver `[]` cuando el último acumulado es 0 —
   está en el design §7, pero se repite aquí porque es el punto exacto donde R59 se rompe sin que
   nada se ponga rojo.
4. **Aviso para F4.4:** `sumarTotalesTablero` se importa de `@/lib/types/tablero-dia`.
   `tests/unit/tablero-dia/sumar-totales.test.ts` afirma que **se declara en un solo archivo del
   árbol**: escribir una segunda suma en `TableroDiaTotales.tsx` no la detectaría ese test (sólo
   censa la declaración de ESE nombre), pero sí la caza `primitivas.guardia.test.ts` (F7.1), que
   es donde el mapa `R65` la coloca. Que no se olvide esa cláusula.
5. **Sin migraciones, sin cambios de esquema, sin RLS nueva** (R2), como pedía la ficha.
