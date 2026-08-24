# Feature 258 — revisión

**Veredicto: APROBADO.** Cero hallazgos bloqueantes.

Revisado sobre el árbol de trabajo de `feat/258-monitoreo-backend` (sin commit), contra
`specs/258-monitoreo-tablero-primitivas/{requirements,design,tasks}.md`, `docs/architecture.md`,
`docs/conventions.md`, `docs/verification.md` y `CHECKPOINTS.md`.

**78 requisitos verificados uno por uno: 73 con cobertura plena, 5 con salvedad (ninguna
bloqueante), 0 sin cobertura.** Ningún requisito quedó apoyado en un test inexistente, vacío o
autorreferencial.

---

## 1. Verificación ejecutada por el reviewer (no heredada del informe)

| Qué corrí | Resultado |
| --- | --- |
| `pnpm run typecheck` | `TC_EXIT=0`, sin una línea de error |
| `pnpm run lint` | `LINT_EXIT=0` — 97 problems, **0 errores**; filtrando el log por los archivos de esta rama → **0** |
| `vitest run` sobre `tests/unit/{tablero-dia,components,services,repositories,actions,utils,descarga}`, `tests/components` y la integración del ritmo | **716 archivos, 10.028 passed, 26 skipped**, `VITEST_EXIT=0` |
| `vitest run guard` (todas las guardias) | **127 archivos, 1.910 passed**, `VITEST_EXIT=0` (126 de antes + la nueva `primitivas.guardia`) |
| `vitest run tests/integration/tablero-dia-ritmo.test.ts --reporter=verbose` | **8 passed** — corrieron de verdad contra Postgres, ninguno `skipped` (comprobado nombre a nombre, no por el conteo) |

El exit code se capturó **dentro** del log en las corridas largas, y el árbol no se mutó durante
ninguna de ellas.

`./init.sh` **completo** lo corrió el leader antes de esta revisión (`INIT_EXIT=0`, 1269
archivos, 16.803 passed, 26 skipped). Es el gate que toca: se tocó `lib/types/`, así que
`--rapido` se niega solo (`docs/verification.md`).

---

## 2. Checklist de `CHECKPOINTS.md`

### Especificación
- [x] `requirements.md` con EARS numerados `R1`–`R78`.
- [x] `design.md` con alternativas descartadas y su porqué — hay **once** descartes razonados
      (contar por `orden.estatus`, contar todas las gestiones sin `DISTINCT ON`, reusar
      `analytics_daily`, `AT TIME ZONE`, agrupar en TypeScript, Server Action propia para la
      serie, clave de caché propia, `json_agg`, dos semánticos nuevos, `KpiValorAnimado`, llevar
      el detalle a su propia ruta), más §12 con la procedencia de cada decisión humana.
- [ ] **`tasks.md` con todas las casillas `[x]`: NO.** Quedan tres en `[ ]` — `B6.1`, `F7.3` y
      `F7.4`. Las tres están hechas **de facto** (el gate completo lo corrió el leader; la
      revisión visual en los dos temas la condujo el coordinador con datos reales), pero no
      están marcadas ni anotadas en disco. Ver pendiente **P-1**.

### Trazabilidad
- [x] Cada `R<n>` mapea a un test concreto (tabla del §4).
- [x] El mapa `R<n> → test` existe en `progress/impl_258_backend.md` y en `tasks.md`. Dos filas
      citan un título de cláusula que no existe literalmente (`R20`, `R48`): hallazgo menor
      **M-3**, no laguna de cobertura.

### Calidad de código
- [x] `typecheck` sin errores. · [x] `lint` sin errores. · [x] `pnpm test` verde.
- [—] **E2E: inaplicable.** `/monitoreo` es lectura pura; no toca auth, pagos, recaudo, ingesta
      ni webhooks, que es la lista que `CHECKPOINTS.md` exige cubrir con Playwright. El camino
      completo se cubrió por otra vía: el coordinador condujo la ruta en el navegador con datos
      reales en los dos temas y encontró dos defectos que la suite no veía, ambos corregidos y
      hoy fijados por test.

### Datos y seguridad (Supabase)
- [x] Sin tablas nuevas, así que no hay RLS nueva que exigir. `git status -- db/` está **vacío**:
      ni migraciones ni `schema.prisma` (R2).
- [x] Sin migraciones, nada que revertir.
- [x] Sin secretos: ni un literal nuevo, nada que deba salir de `process.env`.
- [x] Sin webhooks nuevos.
- [x] **La frontera multi-tenant, que aquí es lo único que separa inquilinos** (debajo de esta
      pantalla no hay RLS): la consulta nueva lleva el alcance como **parámetro**
      (`o."zona_id" = $n`), el `zonaId` **no** aparece en la cadena, con alcance global no se
      emite fragmento de zona, y `resolverAlcance` sigue viviendo en un solo archivo. Probado en
      los dos sentidos: el test de SQL afirma la forma y el escenario 5 de integración contrasta
      global (ve 2) contra zona A (ve 1) — un recorte que devolviera siempre vacío no pasaría.

### Patrón de capas
- [x] Controller (`lib/actions/tablero-dia.ts`) **sin diff**: la serie viaja dentro de
      `leerTableroDia` y el borde no la recompone (test de identidad del objeto).
- [x] Service sin HTTP: recibe actor e instante; `acumularPorHora` es pura y exportada.
- [x] Repository sólo SQL: `SELECT` con `GROUP BY`, sin `UPDATE|INSERT|DELETE|MERGE`, sin
      `queryRawUnsafe`, `bigint → Number` en el mapeo.
- [x] Interfaces en `lib/interfaces/repositories/`.

### Permisos
- [x] `app/(app)/monitoreo/page.tsx` **sin diff**: sigue siendo la única puerta de pantalla.
- [x] Los componentes reciben por props; el único que habla con el servidor es el módulo, vía
      Server Action. Un actor denegado no llega a ninguna de las tres consultas (R56).
- [x] Sin mutaciones nuevas.

### Multi-país / configuración
- [x] Ni país, ni moneda, ni cuenta hardcodeados. El tamaño de página sale de
      `ordenesConfig.DEFAULT_PAGE_SIZE` y hay guardia que prohíbe escribir un literal.
- [x] La zona horaria **no** entra en el SQL: la hora sale de `ventana.desde` (R53), fijado por
      test de forma, por 10 casos puros de `horaDeParedCR` y por el escenario 4 contra Postgres.

### Verificación final
- [x] `./init.sh` verde (leader) más las cuatro corridas propias del §1.
- [x] Este archivo existe y su veredicto es APROBADO.
- [ ] **`progress/history.md` sin entrada de la 258** → pendiente **P-3**.

---

## 3. Los puntos que había que mirar con lupa

### 3.1 ¿El mapa `R<n> → test` es real?

Sí. Abrí **cada** archivo citado y comprobé que existe, que la cláusula corresponde al requisito
y que no es de las que pasarían igual sin el código. Los tres antipatrones que este repo ya pagó:

- **El `return` temprano que reporta `passed` sin comprobar** — no hay ninguno. El de integración
  usa `sembrarBase`, que **lanza** si no puede sembrar, y abre con un test de aislamiento («con
  cero siembra la serie viene VACÍA») que es lo que impide que los seis escenarios midan datos
  ajenos. Además comprobé con `--reporter=verbose` que los 8 corrieron: `passed`, no `skipped`.
- **`toEqual` cambiado en vez del código** — al revés: los literales de `TableroDia` se
  **extendieron** con `ritmoEntregas` (en `tablero-dia-accion.test.ts`, `TableroDiaModule` y
  `DetalleMensajeroPanel`), y en los tres la serie es coherente con los totales del fixture, no
  una lista vacía. Ningún `expect.objectContaining` nuevo. Sólo dos aserciones existentes de la
  192 cambiaron y ninguna se aflojó: el `usuario.tab()` pasó a un bucle con tope 10 que sigue
  afirmando lo mismo —la tarjeta es alcanzable con teclado; si dejara de ser focusable el bucle
  termina sin foco en ella y el test cae— y `serie-ritmo.test.ts` cambió un `toHaveLength(9)` por
  `toHaveLength(3)` **más** los valores `[0, 1, 1]`, que dicen más que la longitud, por un cambio
  de comportamiento deliberado y documentado.
- **Aserción contra su propia fuente** — aparece una vez y está sostenida: las categorías de la
  serie se comparan contra `horaLegibleCR`, pero el formato real está clavado aparte con
  literales (la hora 0 empieza por 12, la 7 por 7, la 13 por 1, la 23 por 11) y con las 24
  etiquetas distintas entre sí. La variante de cada `Badge` se compara contra el **mapa por
  clave**, no contra una clase: es la decisión correcta y está explicada en el propio test.

Lo que más me convence de que estos tests miden algo: **la guardia nueva se cazó a sí misma dos
veces** —dos detectores mal escritos salieron rojos en sus propios casos positivos— y cada
cláusula lleva su infractor **real del repo** (`LineasLienzo` importa `recharts`, `EstatusBadge`
nombra `badgeVariants`, `RutaMapaInner` escribe hexes, `badge.tsx` arma el par semántico).

### 3.2 Las tres guardias que se tocaron

- **`frontera.guardia.test.ts` (2 → 3 consultas): se REFORZÓ, no se aflojó.** Sigue con
  `toHaveLength(3)` exacto y `toEqual(["agregada","paginada","agregada"])` exacto —ni un
  `toBeGreaterThanOrEqual`, ni una clasificación retirada— y **gana** cuatro aserciones que antes
  no existían: cada posición lleva la marca de SU consulta (`GROUP BY a.mensajero_id`, `OFFSET`,
  y `EXTRACT(EPOCH FROM` + `GROUP BY 1`), de modo que la clasificación posicional ya no se puede
  satisfacer con tres consultas cualesquiera, más el `not.toMatch` de zona horaria sobre la
  tercera. Verifiqué los helpers: `esAgregada` busca `GROUP BY` y `esPaginada` exige interpolar
  un `LIMIT` **y** un `OFFSET`; la clasificación es real, no nominal. Y la tercera consulta está
  **al final del archivo**, que es lo que hace cierto ese orden.
- **`cobertura-tablas.guardia.test.ts` (25→26 · 25→26 · 5→6 · 26→27): los cuatro números son los
  correctos y no se perdió ninguna descarga.** El detalle pasó de tabla cruda a **una sola**
  instancia de `DataTable` (+1 archivo, +1 instancia) y nace `fuera` con su motivo escrito en
  `censo-tablas.ts` (+1 exclusión, +1 censada). El punto que lo cierra: `con_descarga` **sigue
  siendo 20**, y `CENSO_TABLAS_CRUDAS` no tenía ninguna entrada del detalle que dar de baja
  (sólo lista `RankingModule`), así que el +1 neto cuadra. Ningún matcher aflojado.
- **`analytics-paquete-guard.test.ts`: SIN DIFF.** Comprobado con `git diff --stat` sobre la
  ruta: salida vacía. La decisión escrita se respetó al pie de la letra — se reusa `GraficaLineas`
  sin abrir el confinamiento de `recharts`, y ningún archivo del árbol lo importa ni importa el
  lienzo (dos guardias lo censan, cada una con su positivo).

### 3.3 `components/ui/table.tsx` huérfana y su cambio de export

**La anotación es legítima aquí y no tapa nada: lo declara.** Verifiqué el mecanismo de
`superficie-de-uso.guardia.test.ts`: la capa R-B marca cualquier módulo de `components/**` que no
sea alcanzable desde una raíz de ruta de Next, y el remedio que la propia guardia prescribe por
escrito es la anotación **junto al export**, con un motivo de 20 caracteres o más que no sea de
relleno. El motivo escrito dice qué la dejó huérfana, quién era el último consumidor y por qué no
se borra. Y **caduca sola**: la guardia se pone roja si el módulo vuelve a ser alcanzable con la
anotación todavía puesta. Borrarla estaba prohibido por R20, y apoyar `DataTable` en ella toca
una pieza que montan 30 listados: las dos salidas alternativas eran peores dentro de esta ficha.

Dos matices, dichos y no escondidos:

- La exención es **de módulo**, no de export: la guardia da por anotado el archivo entero en
  cuanto uno de sus exports lleva la marca, así que los ocho exports quedan exentos con una sola
  anotación. Es deuda real —el archivo entero es código muerto— y va como M-4.
- **El cambio de export no tiene efectos sin medir.** Un grep sobre todo el repo, `tests/` y
  `e2e/` incluidos, no encuentra **ni un importador** de `components/ui/table`; los nombres
  exportados son exactamente los mismos (sólo cambia dónde se escribe `export` para `Table`,
  porque el lector de anotaciones sólo reconoce la forma `export function|const|class`);
  typecheck verde y las 127 guardias verdes. Único residuo: el archivo mezcla ahora dos estilos
  de export.

### 3.4 `sumarTotales` movida a `lib/types/tablero-dia.ts`

**Sigue siendo importable desde cliente y la suma existe una sola vez.** Comprobado a mano y por
test:

- Los tres imports del módulo son el tipo `GestionResultado` de Prisma (se borra al compilar), el
  tipo `MotivoDenegacion` de `@/lib/analytics/alcance` (se borra también) y `ORDER_STATUS_SEED`
  desde `lib/types/order-status.ts`, que **no importa nada**. Ni `repositories/`, ni `services/`,
  ni `@/lib/db`, ni `next/headers` — y hay test que lo afirma sobre el árbol censado.
  `TableroDiaModule.tsx`, que es un Client Component, la consume y el typecheck pasa.
- Una sola declaración: `sumar-totales.test.ts` afirma que el único archivo del árbol que la
  declara es `lib/types/tablero-dia.ts`, y que el servicio ya no declara la suya (ni la función
  vieja ni el `reduce` tipado); `primitivas.guardia` (f) lo repite con un detector más ancho
  —cualquier función o constante cuyo nombre empiece por `sumar`— y con sus positivos. El cuerpo
  se movió **sin cambiar una línea**.

### 3.5 La serie por hora

- **Cuadra con `entregadas` aunque un punto baje, y está fijado por test.** El escenario 3 de
  integración se llama literalmente «el punto de las 10:00 BAJA, y eso es lo ESPERADO» y afirma
  el cuadre contra el contador sobre la misma siembra. Es comportamiento esperado, no tolerancia.
- **La razón está escrita donde alguien la va a leer**, no sólo en el informe: en la
  documentación del propio campo de `lib/types/tablero-dia.ts` («si estás leyendo esto porque
  viste el gráfico retroceder: no es un bug, no lo arregles»), en `design.md §3` con el caso
  concreto y su fecha, y en el comentario del test. Tres sitios, y uno de ellos es el contrato
  que toca quien vaya a cambiarlo.
- **El recorte de horas iniciales no toca el último punto ni el caso vacío.** El recorte es un
  `slice` por delante que arranca un punto antes de la primera entrega —nunca corta por la cola—
  y se aplica **después** de decidir si hay entregas. Los dos invariantes tienen test propio: «el
  recorte NO toca el último punto» (sobre cuatro series distintas) y «un día SIN ninguna entrega
  sigue dando una lista vacía, no una serie recortada a cero puntos». La propiedad además es
  estructural: la serie es monótona no decreciente, así que el prefijo de ceros es el único que
  existe y el recorte no puede tragarse un hueco interior.
- El cuadre real contra Postgres (escenario 1) es lo que sostiene R52; el test de servicio con
  dobles no lo demuestra por sí solo, y el propio archivo lo dice en su cabecera.

### 3.6 Los cuatro pedidos del humano

| Pedido | Estado | Cómo lo comprobé |
| --- | --- | --- |
| Reusar primitivas, no reimplementarlas | **cumplido** | `primitivas.guardia` (g) exige el import de `Badge`, `EmptyState` + `Alert`, `Modal` + `DataTable` + `Pagination`, `Input` + `SegmentedToggle` y `GraficaLineas`; cero altas en `components/ui` y `components/shared`; la línea se monta, no se dibuja |
| Los cinco estados con icono | **cumplido** | `TableroDiaEstados.test.tsx`: uno por estado, los cinco distintos entre sí, primer hijo del `Alert`, decorativos, y el mensaje legible con los iconos suprimidos |
| El detalle en `Modal`, no `Sheet` | **cumplido** | rol de diálogo con `aria-modal`, sin botón de confirmación, salida «Cerrar», `DataTable` de cuatro columnas y `Pagination` con el `pageSize` del servidor; `Sheet` ya no aparece en el archivo |
| Tema oscuro por las primitivas, sin hex sueltos | **cumplido** | cero hexes y cero paleta cruda en todo el árbol (guardia con positivo real), el par `-soft`/`-strong` lo pone `Badge`, y el único par fijo-sobre-giratorio que quedaba (`bg-info` sobre la pista) se midió y se cambió a `bg-chart-13`, con un test que además afirma que `bg-info` **sí** falla en oscuro |

---

## 4. Trazabilidad `R<n> → test` (los 78)

Veredictos: **OK** = hay test y verifica lo que dice · **OK\*** = cubierto, con una salvedad
anotada · **PARCIAL** = una parte del requisito no tiene test.

| R | Test verificado (existe y corre) | Veredicto |
| --- | --- | --- |
| R1 | los tres tests de componente de la 192 + `integration/tablero-dia-conteo` + `frontera.guardia`, verdes sin cambiar selectores | OK |
| R2 | `git status -- db/` vacío: sin migraciones, sin `schema.prisma`, sin enums | OK (por diff, como declara el mapa) |
| R3 | `sumar-totales` › identidad sobre los **32** subconjuntos + `TableroDiaFiltro` › identidad sobre los filtrados | OK |
| R4 | `TableroDiaTarjetas` › «los tres buckets van SEPARADOS» | OK |
| R5 | `TableroDiaTarjetas` › «Otros se pinta aunque valga 0», con su ayuda | OK |
| R6 | `TableroDiaTarjetas` › «orden determinista» (4 casos, incluido «no depende del breakpoint») + `TableroDiaFiltro` › «el orden de las que quedan no cambia» y el de densidad | OK |
| R7 | `DetalleMensajeroPanel` › «escribe ?mensajero=», con `replace` y no `push` | OK |
| R8 | `TableroDiaModule` › «a los 30 s hay una segunda consulta» | OK |
| R9 | `TableroDiaModule` › «conserva los datos de la primera consulta y señala el fallo» | OK |
| R10 | `TableroDiaModule` › «un dato producido hace 45 s» + `TableroDiaTarjetas` › cabecera | OK |
| R11 | `TableroDiaModule` › «cargar el tablero (y refrescarlo) no consulta ni un detalle» | OK |
| R12 | `frontera.guardia` (d) «paginada» + `tablero-dia-detalle-sql` + `primitivas.guardia` (e) «el servidor lo toma de la configuración» | OK |
| R13 | `DetalleMensajeroPanel` › «los TRES casos malos dan el MISMO aviso»: mismo texto, sin eco del id | OK |
| R14 | `frontera.guardia` › ninguna capa lee el rol + `TableroDiaPage`, y `page.tsx` sin diff | OK |
| R15 | `TableroDiaTarjetas` › «los ocho contadores son Badge» (el `data-slot` de la primitiva) | OK |
| R16 | `TableroDiaTarjetas` › «el mapa cubre las OCHO claves y ninguna más» + el `satisfies` (typecheck verde) | OK |
| R17 | `primitivas.guardia` (c) sobre los dos mapas + `TableroDiaTarjetas` › R17 | OK |
| R18 | `frontera.guardia` (f) + `primitivas.guardia` (b), con positivo real sobre `EstatusBadge` | OK |
| R19 | `frontera.guardia` (f) + `DetalleMensajeroPanel` › censo de fuente del panel | OK |
| R20 | diff: **0 altas, bajas o renombres** en `components/ui` y `components/shared` + `primitivas.guardia` (h) «ninguna primitiva conoce el dominio» y «las que monta existen» | OK\* (M-3) |
| R21 | `primitivas.guardia` (g) `EmptyState` + `TableroDiaEstados` › vacío con icono | OK |
| R22 | `primitivas.guardia` (g) `alert` + `TableroDiaEstados` › rol de alerta en los tres | OK |
| R23 | `primitivas.guardia` (g) + `DetalleMensajeroPanel` › censo de las tres primitivas | OK |
| R24 | `TableroDiaEstados` › caso por caso sobre los cinco estados | OK |
| R25 | `TableroDiaEstados` › «ningún estado repite el dibujo de otro», más el del filtro | OK |
| R26 | `TableroDiaEstados` › «va dentro del disco `bg-muted` que produce la primitiva, y es decorativo» | OK |
| R27 | `TableroDiaEstados` › caso por caso sobre los tres avisos: el primer hijo es el icono | OK |
| R28 | `TableroDiaEstados` › rol de estado, `aria-busy` y nombre accesible + `TableroDiaTarjetas` › skeleton | OK |
| R29 | `TableroDiaEstados` › caso por caso con los iconos suprimidos del DOM | OK |
| R30 | `TableroDiaEstados` (los cinco `data-slot`) + `TableroDiaModule` (un `data-slot` por estado) | OK |
| R31 | `DetalleMensajeroPanel` › «el contenedor lleva `aria-modal` y se titula con el nombre» | OK\* (M-5) |
| R32 | `DetalleMensajeroPanel` › Escape y «Cerrar» limpian el parámetro | OK\* (M-2) |
| R33 | `DetalleMensajeroPanel` › «el tablero sigue montado y con el mismo número de consultas» | OK |
| R34 | `DetalleMensajeroPanel` › «NO hay botón Confirmar; la única salida visible es Cerrar» | OK |
| R35 | `DetalleMensajeroPanel` › «CUATRO columnas y ninguna más», con las prohibidas | OK |
| R36 | `DetalleMensajeroPanel` › «un caso vacío pintó una tabla»: no hay ninguna tabla en el DOM | OK |
| R37 | `DetalleMensajeroPanel` › «el chip es EL del listado»: clases comparadas contra `EstatusBadge` renderizado aparte | OK |
| R38 | `DetalleMensajeroPanel` › «se cierra CON aviso» **y** «id de la URL: modal abierto, título genérico» | OK |
| R39 | `TableroDiaFiltro` › el campo es la primitiva `Input` + el grupo «Densidad del tablero» | OK |
| R40 | `TableroDiaFiltro` › «filtrar NO vuelve a llamar a leerTableroDia» + `filtrar-mensajeros` (orden, no muta) | OK |
| R41 | `TableroDiaFiltro` › «jimenez encuentra Ángela Jiménez» + el puro (acentos, mayúsculas, eñe) | OK |
| R42 | `TableroDiaFiltro` › vacío propio con `data-slot` distinto y una salida que restaura el tablero | OK |
| R43 | `TableroDiaFiltro` › «los totales son EXACTAMENTE los de las visibles» + «N de M» en región viva | OK |
| R44 | `TableroDiaFiltro` › «arranca en CÓMODA» + `primitivas.guardia` (g) `SegmentedToggle` | OK |
| R45 | `TableroDiaFiltro` › densidad sin consultas, cifras, orden ni tarjetas + `TableroDiaTarjetas` › la etiqueta sigue en el nombre accesible | OK |
| R46 | `primitivas.guardia` (d) sobre todo el árbol con positivo real + `TableroDiaTarjetas` › censo de cinco fuentes | OK |
| R47 | `TableroDiaTarjetas` › la variante es la del mapa + `primitivas.guardia` (d) «el par lo pone Badge» + `TableroDiaComposicion` › contraste en los dos temas | OK |
| R48 | `primitivas.guardia` (d) «el par no se arma a mano» + `TableroDiaComposicion` › «bg-info SÍ falla en oscuro» | OK\* (M-3) |
| R49 | `TableroDiaRitmo` › «la feature NO pasa color por props ni declara lógica de tema propia» | OK |
| R50 | `services/tablero-dia-ritmo` › «publica la serie DENTRO del tablero» | OK |
| R51 | integración esc. 2 y 3 + `tablero-dia-ritmo-sql` › «el MISMO DISTINCT ON del tablero» | OK |
| R52 | integración esc. 1 (cuadre real contra Postgres) + servicio › «el ÚLTIMO punto es totales.entregadas» + `serie-ritmo` › «el recorte NO toca el último punto» + SQL › el value ata la serie al contador | OK |
| R53 | SQL › sin `AT TIME ZONE` ni zona escrita + `ventana-dia-cr-hora` (10 casos, bordes incluidos) + integración esc. 4 | OK |
| R54 | servicio › «cubre SIN HUECOS las horas 0..H» y «es MONOTONA», con los escalones donde el histograma dice | OK |
| R55 | SQL › el `zonaId` viaja como parámetro y no aparece en la cadena + integración esc. 5 (contraste global/zona) + servicio › el mismo filtro que los conteos | OK |
| R56 | servicio › un denegado y una sesión ausente no llaman al repositorio ni una vez | OK |
| R57 | servicio › «generadoAt es UNO SOLO» y «un acierto de caché no reproduce» + la acción › identidad del objeto devuelto | OK |
| R58 | `tablero-dia-ritmo-sql` entero (agregada, sólo lectura, todo por parámetros) + `frontera.guardia` (d) | OK |
| R59 | `serie-ritmo` › lista vacía con la condición exacta que evalúa la gráfica + `TableroDiaRitmo` › el vacío del marco y sin lista de puntos | OK |
| R60 | `TableroDiaRitmo` › una entrada de `SerieTextual` por punto + «no se escribe a mano» | OK |
| R61 | los tres tests de la 192, verdes sin cambiar un selector; los 15 anclajes presentes en el árbol, verificados uno a uno | OK |
| R62 | `DetalleMensajeroPanel` › «aparece al abrir y DESAPARECE al cerrar», con el selector de siempre | OK |
| R63 | `TableroDiaPage` › «la página NO fetchea datos», pasando sin tocarlo | OK |
| R64 | `TableroDiaFiltro` › «con filtro cambian las TRES señales» y «sin filtro no lleva el atributo» | OK |
| R65 | `sumar-totales` › «se declara exactamente una vez» + `primitivas.guardia` (f) con sus positivos | OK |
| R66 | `TableroDiaComposicion` › hay barra en la tira y en cada tarjeta | OK |
| R67 | `TableroDiaComposicion` › la clase de cada segmento es la del mapa por su clave, y los ocho tokens existen en `globals.css` | OK |
| R68 | `TableroDiaComposicion` › el nombre accesible enumera los ocho (ceros incluidos) y cada cifra sigue legible fuera de la barra | OK |
| R69 | `TableroDiaComposicion` › «un contador a 0 NO pinta segmento», más el caso de todo a cero | OK |
| R70 | `TableroDiaComposicion` › «los anchos suman el 100 %» y tarjeta y tira derivan del mismo dato | OK |
| R71 | `TableroDiaTarjetas` › avatar decorativo en la tarjeta + `filtrar-mensajeros` › `iniciales`. **La cabecera del detalle no tiene test** | PARCIAL (M-1) |
| R72 | integración esc. 3, nombrado como comportamiento esperado, + la razón escrita en el contrato y en `design.md §3` | OK |
| R73 | `TableroDiaFiltro` › «filtrar NO cambia la URL»: la ruta se queda sin ningún parámetro | OK |
| R74 | `primitivas.guardia` (a) + `analytics-paquete-guard.test.ts` **sin diff**, comprobado | OK |
| R75 | `primitivas.guardia` (e) con sus tres formas + `DetalleMensajeroPanel` › el `pageSize` del servidor, probado con 7 para que no coincida con el 25 por defecto | OK |
| R76 | `TableroDiaRitmo` › la región con su nombre accesible y su encabezado, en su propia tarjeta | OK |
| R77 | `serie-ritmo.test.ts` (puro): forma, orden, ningún valor nulo, 24 puntos sin recorte contra el tope real del paquete | OK |
| R78 | `primitivas.guardia` (a) + `TableroDiaRitmo` › `GraficaLineas` sigue difiriendo su lienzo | OK |

**Resumen: 73 OK · 4 OK\* · 1 PARCIAL · 0 sin cobertura.**

---

## 5. Hallazgos

### Mayores (bloqueantes)

**Ninguno.**

### Menores

- **M-1 · R71 está verificado a medias: la cabecera del detalle no tiene test.**
  R71 exige el avatar en la tarjeta **y** en la cabecera del detalle. El código lo hace
  (`TituloConAvatar` en `DetalleMensajeroPanel.tsx`), pero ningún test lo afirma: el único assert
  del título busca el nombre del mensajero, y eso seguiría verde si alguien quitara el avatar. No
  lo trato como bloqueante porque el elemento es **decorativo**, va `aria-hidden` y su
  desaparición no cambia ningún dato ni ningún nombre accesible; pero la fila del mapa promete
  más de lo que cubre. *Se cierra con una línea*: en el caso «el contenedor lleva `aria-modal`»,
  afirmar que dentro del diálogo hay un nodo `aria-hidden` cuyo texto son las iniciales del
  nombre.

- **M-2 · R32 no verifica la parte de «conservando el resto de parámetros».**
  Los tests cierran el modal con Escape y con «Cerrar» y comprueban que `?mensajero=` se va, pero
  ninguno monta la ruta con un parámetro adicional. Sustituir `cerrarDetalle` por un
  `router.replace(pathname)` a secas pasaría la suite entera y se llevaría por delante cualquier
  otro parámetro del enlace. *Se cierra con un caso*: abrir con dos parámetros, cerrar, y afirmar
  que el otro sigue.

- **M-3 · Dos filas del mapa citan cláusulas que no existen con ese título.**
  R20 cita «`primitivas.guardia.test.ts` › components/ no ganó archivos» y R48 cita «ningún token
  fijo del bloque `@theme` en el árbol». Ninguna de las dos existe. La guardia **descarta a
  propósito** congelar el inventario —y explica por qué: convertiría la cláusula en un peaje para
  cualquier ficha futura que estrene una primitiva legítima, y la salida barata sería borrarla— y
  en su lugar comprueba que ninguna primitiva conozca el dominio del tablero y que las que se
  montan existan. El razonamiento es bueno y R20 se cumple de hecho: cero altas, bajas o
  renombres en el diff, igual que R2 se cumple por ausencia de cambios en `db/`. Lo que hay que
  arreglar es **el mapa**, que dice «test» donde hay «diff + cláusula equivalente».
  *Se cierra reescribiendo esas dos filas de `tasks.md`.*

- **M-4 · `components/ui/table.tsx` queda como código muerto con exención de módulo.**
  Es deuda declarada, con motivo escrito y caducidad automática, y R20 impedía borrarla dentro de
  esta ficha. Conviene no perderla de vista: la anotación exime al **módulo entero**, no sólo a
  `Table`. *Salida*: un chore que la retire, o que `DataTable` pase a apoyarse en ella. Decisión
  del humano, ficha aparte.

- **M-5 · R31 menciona «foco atrapado» y eso no se afirma.**
  Se afirma el rol de diálogo y `aria-modal`, que es lo que delega el atrapado en la primitiva.
  Aceptable —el focus trap es contrato de `Modal`, no de esta pantalla— pero queda dicho para que
  nadie lea la fila del mapa como si lo cubriera.

- **M-6 · Nits sin consecuencia medida.** (a) El caso de R24 pide «al menos un icono»: un segundo
  icono colado en un estado no se cazaría, y R25 sólo compara el primero. (b) `MensajeroCard`
  gana `aria-pressed` —estaba en `design.md §2`, así que no es alcance colado—: comunica la
  selección, aunque para un control que abre un diálogo lo convencional sería anunciar que abre
  un diálogo. (c) `components/ui/table.tsx` mezcla ahora dos estilos de export.

### Pendientes de cierre antes de mover la ficha a `done`

No son defectos del código: son casillas de `CHECKPOINTS.md` que hoy no se cumplen.

- **P-1 · `tasks.md` tiene tres casillas en `[ ]`** (`B6.1`, `F7.3`, `F7.4`). Las tres están
  hechas de facto. `F7.3` además pide dejar anotado **qué se miró y en qué rol**: en disco sólo
  está la «Segunda pasada» de `impl_258_frontend.md`, que documenta los dos defectos hallados y
  su arreglo, pero **no dice los roles** (`maestro` / `adminSatelite`) ni recoge la remedición
  posterior al arreglo —los 209 px de la gráfica frente a los 371 originales—, que hoy vive sólo
  en el chat. Marcar las casillas y añadir esas dos líneas.
- **P-2 · `progress/current.md` está desfasado**: dice que `spec_author` está escribiendo el spec
  y que la puerta humana sigue pendiente «antes de que nadie toque código», con la implementación
  terminada y verificada.
- **P-3 · `progress/history.md` no tiene entrada de la 258.**

---

## 6. Veredicto

**APROBADO.** No hay bloqueantes: los 78 requisitos tienen cobertura real, las tres guardias
tocadas quedaron **más** estrictas que antes, la guardia que no había que tocar no se tocó, la
frontera multi-tenant de la lectura nueva está probada contra Postgres en los dos sentidos, y el
módulo de contrato sigue siendo importable desde cliente con una sola implementación de la suma.

Lo que más valor tiene de esta rama, y conviene que no se pierda al escribir la entrada de
`history.md`: los dos defectos que la pantalla enseñó con 16.790 tests en verde —una cifra fuera
de la caja visible y una gráfica de 371 px— son los dos de la familia «no falla, aparenta», y los
dos quedaron fijados por tests que afirman la **causa** (el reparto del espacio entre los dos
hijos del chip; el techo de ancho de la gráfica) y no el síntoma, que en jsdom no es medible.

Los seis hallazgos menores y los tres pendientes son trabajo de minutos y **no** justifican
devolver la ficha al implementer. M-1 y M-2 son los dos que sí conviene cerrar —dos aserciones—
porque son huecos de verificación, no de comportamiento.

---

*Revisado el 2026-08-21. Rama `feat/258-monitoreo-backend`, árbol de trabajo sin commit.*
