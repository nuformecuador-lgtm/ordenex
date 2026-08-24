# Feature 260 — bitácora del BLOQUE FRONTEND y de la GUARDIA de R44

> Agente: `frontend_dev`. Rama: `feat/260-detalle-orden-completa`. Sin commit y sin PR.
> Alcance cerrado aquí: **F1 · F2 · F3 · F4 · F5 · F7 · V1 · C1 · C2**.
> **Abierto y dicho, no rodeado:** **F6** — la medición en el navegador, que **cierra el
> coordinador**: tiene la contraseña QA (la rotó él) y un día sembrado en la base local.
> Lee antes `progress/impl_260_backend.md`: este bloque cierra el inventario rojo que aquél dejó.

---

## 1. Veredicto en una línea

El detalle del tablero ya monta el módulo de columnas del listado de órdenes con su propio
`DataTable` —20 columnas en alcance `global`, 17 en `zona`, sin una sola acción—, y **el
`typecheck` del árbol queda en VERDE**: los 11 errores que el bloque 0 anunció eran exactamente
los dos archivos de este bloque, y están cerrados **sin un `any` y sin un `as`**.

---

## 2. Archivos tocados

### Producción

| Archivo | Qué |
| --- | --- |
| `app/(app)/monitoreo/_components/detalle-columnas.ts` | **NUEVO (F1)** — `COLUMNA_RESULTADO_ID`, `COLUMNA_RESULTADO_LABEL`, `COLUMNAS_SOLO_ALCANCE_GLOBAL`, `PRIMERAS` y `columnasDetalle(alcance)`. **Deriva** de `ordenesColumns`: no declara ni una segunda definición de columna. |
| `app/(app)/monitoreo/_components/DetalleMensajeroPanel.tsx` | **F3** — fuera la constante `COLUMNAS` de cuatro y las dos celdas propias (`ClienteDestino`, `resultadoLegible`); dentro `columnasDetalle(detalle.alcance)` y `rowKey="id"`. `Modal` + `DataTable` + `Pagination` siguen importándose **en este archivo** (cláusula (g) del guardia de primitivas). El envoltorio gana `min-w-0` (§6). |

**Sin cast en la costura, y era el punto de riesgo.** `Column<OrdenListItemDTO>[]` se asignó a
`Column<OrdenDetalleDia>[]` tal cual: el `strictFunctionTypes` lo acepta porque el bloque 0
mantuvo la fila del detalle como subtipo estricto de la del listado. Si algún día deja de serlo,
la línea **deja de compilar** — que es lo que la alternativa A8 del design compró.

### Tests

| Archivo | Qué |
| --- | --- |
| `tests/unit/components/detalle-columnas.test.tsx` | **NUEVO (F2 + F5)** — 25 casos: el conjunto de ids **calculado desde `ordenesColumns`**, las cinco primeras, `liberada` fuera, el recorte en las cabeceras y el «ninguna celda pinta `₡0` ni `—`». |
| `tests/unit/tablero-dia/recorte-por-alcance.guardia.test.ts` | **NUEVO (V1)** — las cuatro cláusulas de R44 (a/b/c/d), atadas por centinelas. |
| `tests/unit/tablero-dia/reversion-r49.guardia.test.ts` | **NUEVO (C1)** — la reversión de R49 en sus **dos** soportes, y en las **dos direcciones** (§11). |
| `tests/components/DetalleMensajeroPanel.test.tsx` | **F4** — migrado (§5). |
| `tests/unit/guards/ordenes-columnas-money-safe.guardia.test.ts` | **F7** — el censo del dinero alcanza a `/monitoreo` (§7). |
| `tests/fixtures/orden-detalle-dia.ts` | Dos centinelas cambian de forma, y el porqué es load-bearing (§4). |
| `tests/unit/tablero-dia/recorte-por-alcance.test.ts` | Sólo el comentario que citaba el centinela viejo. |
| `specs/192-tablero-dia-mensajeros/requirements.md` | **C1** — el apéndice de reversión junto a R49. **12 líneas añadidas, 0 borradas** (§11). |
| `specs/260-detalle-columnas-listado/tasks.md` | Casillas F1–F5, F7, V1, C1, C2. |

---

## 3. Salida real de los comandos

### `pnpm run typecheck` — **VERDE** (es el criterio de cierre de este bloque)

```
> tsc --noEmit

TYPECHECK_EXIT=0
```

Los **11 errores** que `progress/impl_260_backend.md §3` dejó anotados están cerrados. La
traducción que el backend midió se aplicó tal cual: `estatus→estatusValue`,
`cliente→destinatario`, `destino→direccion`, `rowKey="ordenId"→"id"`, `numGuia` a
`number | null`, y el fixture del detalle con `alcance`.

### `pnpm run lint` — **VERDE**

```
✖ 99 problems (0 errors, 99 warnings)
LINT_EXIT=0
```

99 es la línea base que el backend dejó medida. **Cero errores y cero warnings nuevos.**

### `pnpm exec vitest run tests/components tests/unit/tablero-dia` — **VERDE**

```
 Test Files  234 passed (234)
      Tests  3159 passed | 26 skipped (3185)
   Duration  203.20s
VITEST_EXIT=0
```

### `pnpm exec vitest related --run` sobre los dos archivos de producción — **VERDE**

```
 Test Files  7 passed (7)
      Tests  119 passed (119)
   Duration  8.07s
RELATED_EXIT=0
```

### `pnpm run test:guardias` — **VERDE**

```
 Test Files  129 passed (129)
      Tests  1938 passed (1938)
   Duration  13.65s
GUARDIAS_EXIT=0
```

128 → **129** archivos y 1927 → **1938** tests: la diferencia es exactamente la guardia nueva de
R44. Ninguna guardia ajena se puso roja en ningún momento de este bloque, y **ninguna se tocó**.

> El `./init.sh` **completo** lo corre el leader. Aquí no se corrió.

---

## 4. Una desviación con nombre: los centinelas de dinero pasan a ser números

`tests/fixtures/orden-detalle-dia.ts` traía `flete: "FLETE-CENTINELA"` y
`comision: "COMISION-CENTINELA"`. **Con esos valores, la cláusula (c) de R44 no puede ponerse
roja nunca**, y no por poco: las tres celdas de dinero pasan por `PriceLabel`, que hace
`toValidNumber(value)` y pinta `₡0` ante cualquier cosa que no sea un número. Es decir, la
columna del flete pintaba `₡0` **también en alcance `global`**, así que la mitad de no-vacuidad
—«con `global` los pinta todos»— habría sido imposible de satisfacer y la cláusula habría
quedado verde por vacío: el detector ciego que este repo persigue.

Se cambian a `flete: "9999991"` y `comision: "9999992"` (`tarifa: 9999999` ya era un entero y no
se toca). Lo que la decisión conserva entero:

- **siguen siendo irrepetibles** — que es lo único que el comentario original defendía;
- **siguen sirviendo a las cláusulas (a) y (b)**: en el JSON viajan literales
  (`"fleteConIva":"9999991"`), así que el detector de payload no cambia ni una línea;
- **ahora sirven también a (c)**: `₡9.999.991` en el marcado, del que la guardia retira el
  separador de miles leyéndolo de `monedaConfig` —no escrito a mano— antes de buscar.

El porqué queda escrito **en el propio fixture**, no sólo aquí: quien mañana los «limpie» a un
texto legible rompe la guardia, y hay además un caso en (d) que afirma que los tres son
importes válidos, para que ese cambio se ponga rojo en vez de vaciar el detector en silencio.

Comprobado que no arrastra a nadie: los cuatro consumidores del fixture
(`tablero-dia-detalle-accion`, `tablero-dia-detalle-hidratacion`, `detalle-contrato`,
`recorte-por-alcance`) los recorren en bucle genérico y siguen verdes; los tests de integración
no usan este fixture.

---

## 5. Qué tests de la 192 / la 258 hubo que actualizar, y por qué

Todo en `tests/components/DetalleMensajeroPanel.test.tsx`. **Ningún `describe` preexistente se
borró sin sustituto, y ninguno se aflojó.**

| Qué | Por qué |
| --- | --- |
| El constructor `orden()` | Producía los 7 campos del contrato viejo, que **ya no existen**. Ahora delega en el fixture compartido `ordenDelDetalle`: escribir a mano un `OrdenListItemDTO` a medias aquí sería otra vez una segunda idea de qué es una orden, que es justo lo que la feature retira. |
| `detalleCon` / `okDetalle` | Ganan `alcance` (por defecto `"global"`, y `"zona"` donde hace falta): es obligatorio en el contrato desde T0.2. |
| **«muestra CUATRO columnas y ninguna más» (R49 de la 192)** | **SUSTITUIDO, no borrado.** Es la decisión que esta feature revierte. En su sitio queda un bloque con la nota de reversión fechada que dice qué la sustituyó y **dónde vive ahora** la decisión (`detalle-columnas.test.tsx`), más tres casos nuevos que sólo se pueden medir con el panel montado: que las cabeceras son las que produce el módulo, que con alcance `zona` son menos, y que montarlo **no trajo ninguna acción** (sin checkbox, sin «Acciones», sin descarga, sin filtros, sin escáner, una sola tabla en el diálogo). |
| El censo de fuente del vocabulario | Exigía `EstatusBadge` **en el panel**. El panel ya no pinta ninguna celda: ese import **cambió de archivo**, no desapareció. El censo pasa a exigir `./detalle-columnas` en el panel y `ordenes-columns` + `estatus-label` en el módulo de columnas, y sigue prohibiendo `ORDER_STATUS_LABELS =`, el par `-soft`/`-strong` y `badgeVariants` **en los dos**. Es más superficie censada que antes, no menos. |
| Guías `"GUIA-001"` → `1001` | `numGuia` es `number | null` desde el bloque 0. |
| Cabecera del archivo y del bloque de la 258 | Decían «las cuatro columnas». Un comentario que sobrevive a su decisión es código que miente. |

**Lo que NO se tocó y sigue verde tal cual** (28 casos): apertura con ratón y con teclado,
`?mensajero=` en la URL, cierre con Escape y con «Cerrar» conservando el resto de parámetros, los
tres casos malos con el mismo texto y sin tabla, el `pageSize` que viene del servidor, el avatar
de iniciales, el chip comparado clase a clase contra `EstatusBadge`, el «—» del resultado vacío,
que abrir/cerrar no re-consulta el tablero y el cierre con aviso de la R52.

---

## 6. R28 (ancho y scroll): lo que se hizo, y lo que **no** se pudo medir

`min-w-0` va en el **envoltorio del panel** —la caja que contiene a la tabla—, nunca en `Modal`
ni en `DataTable`: la cláusula (h) del guardia de primitivas prohíbe que una primitiva
compartida sepa de esta pantalla. Sin él, un contenedor flex se niega a encoger por debajo del
ancho de su contenido (`min-width: auto`) y las 20 columnas empujarían el diálogo en vez de
desplazarse dentro de su caja.

**Eso es un razonamiento sobre el CSS, no una medición, y no se presenta como otra cosa.**
Ver §9.1.

---

## 7. F7 — la guardia del dinero llega a `/monitoreo`

`app/(app)/monitoreo/_components/detalle-columnas.ts` entra en `TABLAS_DE_ORDENES` y
`app/(app)/monitoreo/_components` en `ARBOLES`. Nace una **tercera** superficie con importes de
orden y hasta hoy esta guardia no llegaba: estaba **verde por omisión**, que no es lo mismo que
estar verde.

Se le añadió además una cláusula: que **cada** árbol aporte al menos un archivo al barrido. Sin
ella, un árbol mal escrito o vaciado seguiría pasando el umbral global gracias a los otros dos.

---

## 8. Las mutaciones — ejecutadas, no afirmadas

Seis mutaciones, una a una: aplicada · ejecutada · revertida · **verificado el revert** (`grep -rn
"MUTACION-" lib/ app/ tests/` → «sin restos» tras cada una, y `typecheck` verde al final).
**Ninguna corrió en paralelo con nada**, que es lo que la memoria del repo exige.

### Las TRES que R44 pide (`tasks.md > V1`)

**Mutación 1 — `recortarPorAlcance` devuelve la orden sin tocar** (`if (alcance === "global" ||
true) return orden;`). Esperado: (a) **y** (b) rojas.

```
FAIL  tests/unit/tablero-dia/recorte-por-alcance.guardia.test.ts > (a) R13/R46 · el dato …
AssertionError: un campo restringido sobrevivio al recorte de alcance `zona`:
  expected [ '9999991', '9999992', …(3) ] to deeply equal []
  + [ "9999991", "9999992", "correo@centinela", "TELEFONO-CENTINELA", "9999999" ]

FAIL  tests/unit/tablero-dia/recorte-por-alcance.guardia.test.ts > (b) R13/R46 · el dato — el
      payload que devuelve el SERVICIO REAL > un actor de alcance `zona` recibe un detalle SIN
      ningun centinela
AssertionError: un campo restringido viajo al navegador: no basta con no pintarlo, se lee con un
  View source: expected [ '9999991', '9999992', …(3) ] to deeply equal []

 Tests  2 failed | 9 passed (11)
```

**Mutación 2 — el servicio deja de llamarla para `zona`** (`recortarPorAlcance(…, "global")` en
`TableroDiaService.ts:337`). Esperado: (b) roja. Y (a) verde, que es lo correcto: la función pura
sigue haciendo su trabajo, quien dejó de usarla es el servicio.

```
FAIL  tests/unit/tablero-dia/recorte-por-alcance.guardia.test.ts > (b) R13/R46 · el dato — el
      payload que devuelve el SERVICIO REAL > un actor de alcance `zona` recibe un detalle SIN
      ningun centinela
AssertionError: un campo restringido viajo al navegador: no basta con no pintarlo, se lee con un
  View source: expected [ '9999991', '9999992', …(3) ] to deeply equal []

 Tests  1 failed | 10 passed (11)
```

**Mutación 3 — `columnasDetalle` deja de filtrar `COLUMNAS_SOLO_ALCANCE_GLOBAL`.** Esperado: (c)
roja.

```
FAIL  tests/unit/tablero-dia/recorte-por-alcance.guardia.test.ts > (c) R14/R15/R16 · la columna
      — la pantalla sobre un DTO SIN recortar > alcance `zona`: la tabla no pinta NI UN
      centinela, aunque la fila los traiga todos
AssertionError: una columna restringida sigue montada en alcance `zona`:
  expected [ '9999991', '9999992', '9999999' ] to deeply equal []

FAIL  … > (d) R44 · los detectores NO son decorado > el censo mira algo: hay columnas
      restringidas que quitar y centinelas que buscar
AssertionError: expected +0 to be 3 // Object.is equality

 Tests  2 failed | 9 passed (11)
```

Y la **misma** mutación, corrida contra las otras dos suites, mata cinco casos más — entre ellos
el de R15, que es el que le pone palabras al daño:

```
FAIL  tests/components/DetalleMensajeroPanel.test.tsx > … R14 — con alcance `zona` el servidor
      manda menos columnas y el panel monta ESAS
AssertionError: expected 20 to be less than 20

FAIL  tests/unit/components/detalle-columnas.test.tsx > … R14 — con alcance `zona` NO se monta
      ninguna de las tres columnas de dinero restringido
AssertionError: la cabecera «Flete + IVA» sigue montada en alcance zona:
  expected [ 'Nº Guía', 'Estado', …(18) ] to not include 'Flete + IVA'

FAIL  tests/unit/components/detalle-columnas.test.tsx > … la diferencia entre los dos alcances
      son EXACTAMENTE tres columnas, no una mas
AssertionError: expected [] to deeply equal [ 'comision', 'flete', 'fulfillment' ]

FAIL  tests/unit/components/detalle-columnas.test.tsx > … (R15) > alcance `zona`, sobre la fila
      YA RECORTADA: ninguna celda pinta `₡0` ni «—»
AssertionError: una columna de dinero sobrevivio al recorte y pinta el cero de un dato que no
  llego: expected [ '₡0', '₡0', '₡0' ] to deeply equal []

 Tests  5 failed | 48 passed (53)
```

**Las tres mutaciones ponen roja su cláusula. Ninguna sobrevivió.** Y las dos mitades quedan
atadas por el mismo juego de centinelas: la 1 y la 2 sólo tocan el dato, la 3 sólo toca la
columna, y cada una mata la mitad que le toca **sin poder taparse con la otra**.

### Las otras tres

**Mutación 4 (criterio de «hecho» de F2) — una columna ficticia en la lista esperada.**

```
FAIL  tests/unit/components/detalle-columnas.test.tsx > … alcance `global`: los ids montados son
      EXACTAMENTE los calculados desde `ordenesColumns`
AssertionError: expected [ 'canton', 'comision', …(18) ] to deeply equal
  [ 'canton', 'columna-ficticia', …(19) ]

 Tests  2 failed | 23 passed (25)
```

**Mutación 5 (criterio de «hecho» de F7) — un `valorFleteGam` en el módulo nuevo.** Es la
demostración de que la guardia del dinero **muerde en su territorio nuevo**:

```
FAIL  tests/unit/guards/ordenes-columnas-money-safe.guardia.test.ts > guardia 204 … > NINGÚN
      archivo de esos árboles nombra las entradas de las dos fórmulas
AssertionError: una tabla de órdenes volvió a mirar la tarifa para operar con ella:
  expected [ Array(1) ] to deeply equal []

 Tests  1 failed | 6 passed (7)
```

**Mutación 6 (verificación de C2) — un tercer campo propio en `OrdenDetalleDia`.** El techo de
superficie falla **al compilar**, en el commit que lo introduce, no cuando alguien ejecute el
test:

```
tests/unit/tablero-dia/detalle-contrato.test.ts(67,7): error TS2322: Type 'true' is not
  assignable to type 'false'.
lib/services/TableroDiaService.ts(327,11): error TS2345: Argument of type '{ … }' is not
  assignable to parameter of type 'OrdenDetalleDia'.
tests/fixtures/orden-detalle-dia.ts(132,3): error TS2322: …
```

---

## 9. Lo que queda abierto

### 9.1 ⛔ F6 — la medición en el navegador NO se hizo, y no se puede hacer aquí

`tasks.md > F6` pide, con el modal abierto **y datos reales**, a 1280 / 1024 / 830 / 768 px y en
las dos densidades: que la tabla desborde dentro de su caja, que aparezcan las flechas, que
ninguna cabecera ni celda quede recortada y que el diálogo no gane barra horizontal propia. Lo
que hay medido, y por qué no alcanza:

1. **No hay servidor de desarrollo levantado** (`curl localhost:3000` → sin respuesta).
2. **No hay credenciales.** El recorrido exige entrar como un actor de `/monitoreo`. La semilla
   de usuarios QA (`scripts/seed-usuarios-qa.ts`) toma la contraseña de `QA_PASSWORD`, que vive
   en un `.env` cuya lectura está bloqueada.
3. **No hay datos del día.** El modal sólo se abre sobre un mensajero **con órdenes de hoy**, y
   sembrarlas en la base local no es trabajo de este bloque.
4. **El arnés E2E del repo está declarado no ejecutable**: los `e2e/*.spec.ts` llevan escrito
   «WRITTEN but NOT EXECUTED» y no corren bajo `pnpm test`.

**Lo que se hizo en su lugar, dicho como lo que es —una decisión de CSS, no una medición—:** el
envoltorio del panel lleva `min-w-0`, que es exactamente la causa que la 258 dejó documentada
(«la causa real fue un `min-w-0` que faltaba en un ancestro, no en la pieza tocada»), y el
`DataTable` ya trae `overflow-x-auto` + flechas + `w-full max-w-full`, con el `Modal` en
`max-w-[1000px]`. **La suite no ve un recorte visual** —`toHaveTextContent` pasa sobre un `13`
que se lee `1`— así que nada de lo verde de §3 dice una palabra sobre R28.

**Lo que hay que hacer, concreto:** abrir `/monitoreo` con sesión de `admin` o `maestro`, pulsar
una tarjeta con órdenes de hoy y comprobar los cuatro puntos a los cuatro anchos y en las dos
densidades, **mirando la caja que contiene** (el `div[data-slot="detalle-mensajero-panel"]` y el
popup del diálogo), no la tabla. Si algo falla, el arreglo va en ese envoltorio, **nunca** en
`Modal` ni en `DataTable`.

### 9.2 C1 — CERRADA. Está en §11.

### 9.3 Desviaciones menores, declaradas

- **`detalle-columnas.test.tsx`, no `.ts`.** `tasks.md` lo nombra `.ts`; la mitad F5 —«ninguna
  celda pinta `₡0` ni `—`»— sólo se puede afirmar renderizando, y eso pide JSX. Vitest recoge las
  dos extensiones. La guardia de V1 **sí** es `.ts` como manda el spec: renderiza con
  `renderToStaticMarkup` + `createElement`, patrón que ya usa
  `tests/unit/guards/dinero-sin-centimos.guardia.test.ts`.
- **La cláusula (c) habla de tres centinelas, no de cinco.** El correo y el teléfono de la tienda
  **no los pinta ninguna columna del listado, ni siquiera en alcance `global`**, así que la mitad
  COLUMNA no puede decir nada de ellos: su única defensa es la mitad DATO (cláusulas (a) y (b)).
  Está escrito en la guardia, y hay un caso que afirma que efectivamente no se pintan en ninguno
  de los dos alcances — para que nadie lea (c) como si los cubriera.
- **Mientras el detalle carga, el panel monta el alcance MÁS RESTRICTIVO.** Es fallo cerrado: el
  alcance todavía no llegó, y estrenar las columnas de dinero para retirarlas medio segundo
  después las enseñaría —vacías, pero enseñadas— a quien no puede verlas.

### 9.4 Ninguna guardia ajena se puso roja

El backend avisó de `pagos-captura.guardia.test.ts`. **No volvió a aparecer**: este bloque no
añade ninguna arista al árbol de imports de `GestionarOrdenPanel.tsx`. Las 129 guardias verdes.

---

## 10. Mapa `R<n> → test` de lo cubierto por este bloque

| R | Test |
| --- | --- |
| R9 | `tests/components/DetalleMensajeroPanel.test.tsx` — el `pageSize` del servidor + censo sin literal |
| R14 | `recorte-por-alcance.guardia.test.ts` (c) + `detalle-columnas.test.tsx` (cabeceras, y la diferencia son exactamente tres) + `DetalleMensajeroPanel.test.tsx` (el panel monta las del alcance que llegó) |
| R15 | `detalle-columnas.test.tsx` — sobre la fila YA recortada, ninguna celda es `₡0` ni `—`, con su contraprueba |
| R16 | `detalle-columnas.test.tsx` — las cuatro de dinero en alcance `global` |
| R17 | idem — «Monto a cobrar», con su cifra, en LOS DOS alcances |
| R18 | `tests/unit/tablero-dia/detalle-contrato.test.ts` (**C2**, verificado por mutación: falla al compilar) |
| R20 | `detalle-columnas.test.tsx` — los ids son los calculados desde `ordenesColumns` |
| R21 | `DetalleMensajeroPanel.test.tsx` — sin checkbox, sin «Acciones», sin descarga, sin filtros, una sola tabla; censo sin `OrdenesListado`, sin `renderExpanded` |
| R22 | `detalle-columnas.test.tsx` — una columna propia y sólo una |
| R23 | idem — las cinco primeras, por id, literales (es la decisión humana) |
| R24 | idem — censo de fuente: un solo `value:` y una sola declaración de `PRIMERAS` |
| R25 | idem — cada id de `PRIMERAS` **y** de la lista de exclusión existe entre las montadas |
| R26 | idem — el conjunto se calcula desde `ordenesColumns`, nunca de una lista literal |
| R27 | `detalle-columnas.test.tsx` — «Reprogramada» con el mapa compartido, «—» con resultado nulo; + `frontera.guardia` (f) |
| R28 | **ABIERTO — F6.** §9.1 |
| R29 | `DetalleMensajeroPanel.test.tsx` — censo de `rowKey="id"` (no es observable desde el DOM: `DataTable` cae a `row.id` igual) |
| R30 | `DetalleMensajeroPanel.test.tsx` — sin «Confirmar», con «Cerrar» |
| R31/R32 | idem — los tres casos malos, mismo texto y sin tabla |
| R33 | idem — `?mensajero=` dispara la Server Action |
| R34 | idem — abrir y cerrar no re-consulta el tablero |
| R41 | `tests/unit/guards/ordenes-columnas-money-safe.guardia.test.ts` — censo ampliado, y **demostrado que muerde** (mutación 5) |
| R42 | `tests/unit/tablero-dia/reversion-r49.guardia.test.ts` — el apéndice del spec **y** el texto original verbatim, más la nota del panel y que el panel no vuelva a declarar columnas. Tres mutaciones en §11 |
| R44 | `recorte-por-alcance.guardia.test.ts` (a)(b)(c)(d) + **las tres mutaciones ejecutadas y pegadas** en §8 |
| R45 | `detalle-columnas.test.tsx` — `liberada` fuera en los dos alcances, con la cláusula de no-vacuidad contra la variante real |

Los que faltan (R1–R8, R10–R13, R19, R35–R40, R43, R46) los cubrió el bloque backend; su mapa
está en `progress/impl_260_backend.md §7`. **C5 sigue abierta**: el mapa de los 46 completo lo
cierra quien termine la feature.

---

## 11. C1 — la reversión de R49, en sus dos soportes y en las dos direcciones

`design.md §9` manda anotar la reversión, **con fecha y motivo**, en los dos sitios donde esa
decisión está escrita. Los dos están hechos, y hay una guardia que impide que cualquiera de ellos
envejezca por su cuenta.

### 11.1 Los dos soportes

| Soporte | Qué lleva |
| --- | --- |
| `app/(app)/monitoreo/_components/DetalleMensajeroPanel.tsx` | El docstring de `COLUMNAS` **se sustituyó** por la nota de reversión (fecha, motivo, qué la sustituye y dónde sigue legible R49). Ya estaba: era inseparable de F3. |
| `specs/192-tablero-dia-mensajeros/requirements.md` | **NUEVO** — apéndice fechado junto a R49, con el mismo formato que el que la 259 le puso a D10 en el spec de la 246. |

**El texto de R49 no se tocó, y hay número:** `git diff --stat` sobre ese spec dice
`12 insertions(+)` y **ninguna deleción**. El apéndice es puramente aditivo, que es la diferencia
entre anotar y reescribir por la puerta de atrás.

### 11.2 La guardia: `tests/unit/tablero-dia/reversion-r49.guardia.test.ts` (12 casos)

Copia deliberada del patrón que la 259 dejó en `d10-revertida.guardia.test.ts`, incluida la razón
por la que la mitad del spec comprueba **las dos direcciones**:

| # | Qué afirma |
| --- | --- |
| (a) | La nota del panel lleva sus **siete piezas**: R49 por su nombre, la feature que lo revierte, la fecha, la palabra que dice que está superada, el motivo, `ordenesColumns` como sustituto y el puntero al spec donde R49 sigue legible. |
| (b) | El panel **NO vuelve a declarar columnas**. Si lo hiciera, la nota de (a) pasaría a mentir sin que nada más se pusiera rojo. |
| (c) | Y las consume del módulo — sin esto, (b) sería verde por vacío: un panel sin tabla tampoco declara columnas. |
| (d) | El spec lleva el **puntero** a la ficha 260, con fecha y con la palabra «supersedida». |
| (e) | El texto original de R49 sigue **VERBATIM**, cuatro frases testigo. |

**Por qué el detector del panel mira el código y no la prosa, y es una diferencia con el de la
259.** La nota de reversión **cita** la frase que sustituye —tiene que citarla, o no se entiende
qué se revirtió—. Un detector de «frases superadas» sobre el texto crudo marcaría esa cita como
infracción y obligaría a **borrar la explicación para pasar la guardia**, que es exactamente al
revés de lo que R42 quiere. Por eso (b) se aplica al código **sin comentarios** y mide lo que el
panel HACE, no lo que dice. La autocomprobación incluye ese caso.

### 11.3 Las tres mutaciones — ejecutadas, no afirmadas

**Mutación 7 — se REESCRIBE R49 dejando el apéndice intacto.** Es la que el coordinador señaló
como la que no puede faltar: con el puntero puesto, (d) sigue **verde** y sólo cae (e).

```
FAIL  tests/unit/tablero-dia/reversion-r49.guardia.test.ts > (2) el spec de la 192 lleva el
      apéndice Y conserva su texto original (R42) > (e) el texto original de R49 sigue VERBATIM:
      el apéndice no es una reescritura
AssertionError: Un spec es la foto de su momento. El apéndice se AÑADE; el texto original no se
  toca. Si falta un testigo, alguien reescribió R49 para «dejarlo coherente» y con ello borró la
  prueba de que aquel alcance se cerró a conciencia y con sus razones.:
  expected [ …(4) ] to deeply equal []
  + "**R49** *(cerrado el 2026-08-08)* — El detalle DEBE mostrar, por orden, las mismas"
  + "columnas que el listado de órdenes: número de guía, estatus actual, resultado del día si"
  + "lo hay, y destino/cliente en el mismo formato. NO DEBE añadir hora de la última gestión,"
  + "monto recaudado ni motivo de reprogramación (ampliarlo después es aditivo)."

 Tests  2 failed | 10 passed (12)
```

**Mutación 8 — se BORRA el apéndice, dejando R49 verbatim.** La dirección simétrica: (e) verde,
(d) roja, y el mensaje nombra las tres piezas que faltan.

```
FAIL  tests/unit/tablero-dia/reversion-r49.guardia.test.ts > (2) … > (d) R49 apunta a la ficha
      260, con fecha y motivo
AssertionError: R42: R49 se firmó en ese spec. Sin puntero, quien lo lea dentro de seis meses
  creerá que el detalle sigue cerrado en cuatro columnas por decisión humana vigente.:
  expected [ …(3) ] to deeply equal []
  + "la fecha del apéndice (2026-08-21)"
  + "que fue supersedida"
  + "el puntero a la ficha 260"

 Tests  1 failed | 11 passed (12)
```

**Mutación 9 — el panel vuelve a declarar una columna** (`const EXTRA = { id: "guia", value: "Nº
Guía" };`). Es la que impide que la nota del panel quede escrita sobre un código que ya no la
cumple.

```
FAIL  tests/unit/tablero-dia/reversion-r49.guardia.test.ts > (1) el panel declara R49 REVERTIDA y
      ya no declara columnas (R42) > (b) el panel NO vuelve a declarar ninguna columna por su
      cuenta
AssertionError: El panel volvió a declarar columnas. Con eso la nota de reversión de arriba pasa
  a mentir —dice que las columnas salen del módulo del listado— y las dos pantallas vuelven a
  poder divergir, que es lo que la feature 260 vino a cerrar.: expected true to be false

 Tests  1 failed | 11 passed (12)
```

Las tres aplicadas · ejecutadas · revertidas · **revert verificado** (`grep -rn "MUTACION-" specs/
lib/ app/ tests/` → «sin restos»). Ninguna en paralelo con nada.

### 11.4 Una desviación de nombre, declarada

El mapa de `tasks.md` llama al test `tests/unit/tablero-dia/reversion-r49.test.ts`. Se escribió
como **`reversion-r49.guardia.test.ts`**: es el mismo nombre que su hermana de la 259
(`d10-revertida.guardia.test.ts`) y, sobre todo, es lo que hace que `pnpm run test:guardias`
—`vitest run guard`— la recoja. Con el nombre del mapa se habría quedado fuera del barrido de
guardias, que es donde tiene que estar.

### 11.5 Verificación de este cierre

```
> tsc --noEmit
TYPECHECK_EXIT=0

✖ 99 problems (0 errors, 99 warnings)
LINT_EXIT=0

$ pnpm exec vitest run tests/unit/tablero-dia
 Test Files  13 passed (13)
      Tests  210 passed (210)
TABLERO_EXIT=0

$ pnpm run test:guardias
 Test Files  130 passed (130)
      Tests  1950 passed (1950)
GUARDIAS_EXIT=0
```

129 → **130** archivos de guardia y 1938 → **1950** tests: la diferencia es exactamente esta
guardia. Sigue sin tocarse ninguna guardia ajena, y ninguna se puso roja.

## R28 / F6 — verificado por el leader en el navegador (2026-08-21)

El bloque frontend dejó esto como `razonado, no medido` y con razón: sin servidor
ni credenciales no se puede comprobar. Se cierra aquí, conduciendo la app con
sesión `admin` (alcance global) y el día sembrado en la base local.

| comprobación | resultado |
| --- | --- |
| modal a 1440 / 1280 / 1024 / 768 px | no se sale del viewport; sin recorte interno |
| página | **no** scrollea en horizontal |
| tabla dentro del modal | 2.234 px en una caja de 948 → scrollea **dentro de su contenedor** |
| alcanzable por una persona | rueda horizontal, `End` y arrastre llegan al máximo (1.286 px) |
| columnas | **20** (las 19 del listado + «Resultado del día»), todas alcanzables |
| primeras cinco | Nº Guía · Estado · Resultado del día · Destinatario · Dirección |
| errores de consola | ninguno |

⚠️ **Un aviso sobre el método, porque casi me cuesta un informe falso.** La primera
sonda asignaba `scrollLeft` y leía el valor en el mismo `evaluate`: devolvió **0**
y parecía que 1.286 px de tabla eran inalcanzables — un defecto grave que NO
existe. Lo desmintieron los gestos reales (rueda, teclado). **Medir una propiedad
no es medir lo que puede hacer una persona**, y una sonda mal escrita produce
defectos fantasma con la misma facilidad con que oculta los de verdad.
