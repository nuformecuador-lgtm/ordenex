# Ficha 339 — Tasks

> Zona `fullstack`: **backend primero, frontend después** (bloques B1–B4 antes que B5–B6).
> `[P]` = paralelizable con las tareas hermanas de su mismo bloque.
> Nadie corre la suite completa salvo el leader (`AGENTS.md § Regla del gate`).

---

## B0 — Medir antes de tocar (bloquea todo lo demás)

- [ ] **T0.1 — Fotografiar los números de los tres censos ajenos que esta ficha mueve.**
  Correr, y **anotar la salida**, los tres archivos de guardia implicados ANTES de escribir una
  línea: `tests/unit/descarga/cobertura-tablas.guardia.test.ts`,
  `tests/integration/wallet-page.test.tsx` y
  `tests/components/paginacion/paginacion-transversal.test.tsx`.
  **Hecho:** los tres en verde y los números del censo de tablas anotados en `progress/impl_339.md`
  (hoy afirmados por la guardia: archivos 28, instancias 28, `totalCensado` 29 = `con_descarga` 19 +
  `fuera` 10). Sin esta foto no se pueden distinguir después «el número que subí» de «el número que
  ya estaba mal».

- [ ] **T0.2 — Confirmar en el ARCHIVO REAL los cuatro símbolos sobre los que se construye.**
  `WALLET_EGRESO_DESGLOSADO_SEED` y `ComposicionGananciaDTO` en `lib/types/wallet.ts`;
  `derivarComposicionGanancia` y `NATURALEZA_POR_CATEGORIA` en `lib/utils/caja-tesoreria.ts`.
  **Hecho:** los cuatro leídos en disco (no en el grafo) y sus líneas anotadas. El índice del MCP
  devuelve de más; esta ficha depende de que los cuatro estén EXACTAMENTE como el diseño supone.

---

## B1 — Tipos y catálogos (backend) · depende de B0

- [ ] **T1.1 — Los dos seeds nuevos en `lib/types/wallet.ts`.**
  `WALLET_EGRESO_NOMBRADO_SEED = ["egreso_pago_mensajero", "egreso_ajuste"]` y
  `WALLET_EGRESO_CON_FILA_SEED = [...WALLET_EGRESO_DESGLOSADO_SEED, ...WALLET_EGRESO_NOMBRADO_SEED]`,
  los dos con `satisfies readonly WalletMovimientoCategoria[]` y con sus tipos derivados.
  `WALLET_EGRESO_DESGLOSADO_SEED` **no se toca** (sigue significando «los cuatro de
  `DesgloseEgresosDTO`»).
  **Hecho:** `pnpm typecheck` verde; una categoría inventada en cualquiera de los dos seeds rompe el
  build (comprobado a mano y revertido).

- [ ] **T1.2 — El catálogo de FILAS.** `COMPOSICION_FILA_OTROS = "otros_egresos"`,
  `COMPOSICION_FILA_SEED` (7 ingresos + 6 egresos + el token) y `ComposicionFilaId`.
  **Hecho:** el seed tiene 14 entradas, ninguna repetida, y el token NO es un valor del enum de
  categorías.

- [ ] **T1.3 — `ComposicionGananciaDTO` gana `egresos: Record<WalletEgresoNombrado, string>` y
  `hayOtrosEgresos: boolean`.** Con docstring que diga por qué el `Record` va por CATEGORÍA y por qué
  la bandera la decide el servidor.
  **Hecho:** typecheck verde; los cuatro campos previos conservan nombre y tipo.

- [ ] **T1.4 — El schema del detalle.** `listarMovimientosDeFilaSchema` **derivado** de
  `listarMovimientosSchema` (`.omit` de página + `.extend` con `fila`, `page`, `pageSize`), con el
  tope y el default leídos de la config de T3.1.
  **Hecho:** un `pageSize` por encima del tope y una `fila` que no está en el seed producen
  `validation_error`.

---

## B2 — La derivación (backend) · depende de B1

- [ ] **T2.1 — `categoriasDeFilaComposicion` en `lib/utils/caja-tesoreria.ts`.** Pura. Para
  `"otros_egresos"` devuelve el COMPLEMENTO derivado de `NATURALEZA_POR_CATEGORIA` +
  `WALLET_EGRESO_CON_FILA_SEED`; para cualquier otra fila, `[fila]`.
  **Hecho:** hoy devuelve `["egreso_gasto"]` para «Otros», y el módulo sigue sin nombrar
  `PrismaClient`, `Repository`, `findMany`, `groupBy` ni `await` (la guardia de alcance no se mueve).

- [ ] **T2.2 — `derivarComposicionGanancia` reparte contra `WALLET_EGRESO_CON_FILA_SEED`.** Llena las
  cubetas de `egresos`, deja en `otrosEgresos` el complemento y calcula
  `hayOtrosEgresos = !otrosEgresos.isZero()`.
  **Hecho:** `totalEgresos` vale lo mismo, importe a importe, que antes del cambio, sobre los mismos
  conjuntos de prueba; y el módulo sigue sin `.sub(`, sin `.minus(`, sin literales de signo y sin
  `.toFixed(` (guardias vigentes de las fichas 173 y 231, ninguna se afloja).

- [ ] **T2.3 — Mover el censo de la guardia de exhaustividad.**
  `tests/unit/guards/caja-composicion-exhaustiva.guardia.test.ts` tiene hoy
  `OTROS_EGRESOS_DE_ORDENEX = ["egreso_pago_mensajero", "egreso_gasto", "egreso_ajuste"]` con un
  `expect(derivadas.length).toBe(3)`. Pasa a **una** categoría (`egreso_gasto`) y el número a `1`,
  con el motivo escrito al lado. La suma de la columna deja de ser «4 conceptos + otros» y pasa a ser
  «4 conceptos + 2 nombrados + otros».
  **Hecho:** la guardia se vio ROJA con los números viejos antes de tocarlos; el control de
  no-vacuidad (`otrosEgresos > 0` sobre el libro sintético) sigue siendo cierto porque `egreso_gasto`
  sigue teniendo importe en ese fixture.

- [ ] **T2.4 [P] — Ampliar `tests/unit/utils/caja-composicion.test.ts`** con los casos de las cubetas
  nuevas y de la bandera.
  **Hecho:** un conjunto SIN egresos sin clasificar da `hayOtrosEgresos: false` y `otrosEgresos:
  "0.00"`; uno CON, `true`. El `Record` `egresos` no tiene huecos ni con el libro vacío.

---

## B3 — Lectura del detalle (backend) · depende de B2

- [ ] **T3.1 — `lib/config/composicion-detalle.ts`.** Molde exacto de `lib/config/gasto-fijo.ts`.
  `DEFAULT_PAGE_SIZE = 10` (`COMPOSICION_DETALLE_DEFAULT_PAGE_SIZE`), `MAX_PAGE_SIZE = 50`
  (`COMPOSICION_DETALLE_MAX_PAGE_SIZE`).
  **Hecho:** el default no supera al tope; un valor de entorno válido lo sobreescribe y uno basura
  (`"abc"`, `"-5"`) cae al valor por defecto. **NO se registra** en el censo de dominios del Anexo III
  de la ficha 170 (motivo en `design.md § 4.6`).

- [ ] **T3.2 — El repositorio acota en el `WHERE`.** `categorias?: readonly WalletMovimientoCategoria[]`
  en `BalanceFiltros` y en `ListarMovimientosFiltros`; `buildWhere` lo traduce a
  `AND: [{ categoria: { in: … } }]`.
  **Hecho:** con la clave ausente, el `where` que reciben `agregarPorCategoriaYTipo` y
  `agregarPorCategoria` es **idéntico** al de hoy (probado, no supuesto); con la clave presente, el
  `in` está en el `where` y no en un filtro posterior en memoria.

- [ ] **T3.3 — `WalletService.listarMovimientosDeFila`.** Guard `esAccesoTotal` **antes** de la base;
  filtros por `construirFiltros` (el mismo método privado, sin copia); intersección de
  `categoriasDeFilaComposicion(fila)` con el filtro de categoría vigente; `repo.listar`.
  **Hecho:** un rol sin acceso total recibe `forbidden` **sin que el repositorio se haya llamado**
  (verificado con el doble del repo: cero invocaciones).

- [ ] **T3.4 — `listarMovimientosDeFilaAction` en `lib/actions/wallet.ts`.** Calcada de
  `listarMovimientosAction`: actor, `UnauthenticatedError`, schema, servicio, `withErrorHandler`.
  **Hecho:** sin sesión → `unauthenticated`; entrada inválida → `validation_error`; ninguna rama de
  error viaja con movimientos.

- [ ] **T3.5 — Contratos.** `IWalletService` y `IWalletMovimientoRepository` reflejan lo anterior con
  su docstring de por qué.
  **Hecho:** typecheck verde y ningún `any` cruzando la frontera.

---

## B4 — La prueba contra Postgres (backend) · depende de B3

- [ ] **T4.1 — `tests/integration/db/composicion-detalle-postgres.test.ts`.** Molde de
  `tests/integration/db/wallet-fecha-elegida.test.ts`: `crearPrismaDeTest` + `enTransaccionRevertida`,
  `describe.skip` si no hay base, y **ni un `return` mudo** (si falta un dato previo, el test FALLA
  con su motivo).
  Cubre los seis hechos de `design.md § 9`: alcance de la fila, el complemento, el `total` del
  servidor, los filtros vigentes, `Σ detalle === importe de la fila`, y los agregados intactos.
  **Hecho:** con la restricción de categoría quitada a mano del `WHERE`, el test cae nombrando los
  importes intrusos (mutación ejecutada y revertida, anotada en `progress/impl_339.md`).

---

## B5 — La tarjeta (frontend) · depende de B4

- [ ] **T5.1 — `composicion-detalle-labels.ts`.** Textos: columnas del detalle, vacío, error, pista de
  «Otros», rótulos de las dos filas nuevas («Pagos a mensajeros», «Ajustes (egreso)») y nombres
  accesibles (`…NOMBRE.paginacion(fila)`, `…NOMBRE.abrir(fila)`, `…NOMBRE.tabla(fila)`).
  **Hecho:** ninguna constante se llama `PAGINACION_*_LABEL` (ver `design.md § 6`: ese prefijo activa
  un censo ajeno y lo pondría en rojo con «14 recibido / 13 esperado»).

- [ ] **T5.2 — `DetalleFilaComposicion.tsx`.** `useSWR` con clave `(fila, page, filtros)`,
  `DataTable` (fecha · concepto · detalle · importe) + `Pagination` con `sticky={false}` y el `total`
  del servidor. Sin subtotal de página. Sin `descarga`.
  **Hecho:** ni `Number(`, ni `parseFloat(`, ni `parseInt(`, ni `.toFixed(` en la fuente; el `total`
  que recibe `Pagination` no es `movimientos.length`; un movimiento sin descripción muestra su origen.

- [ ] **T5.3 — `FilaComposicion.tsx`,** la fila desplegable compartida por las dos columnas
  (`aria-expanded` / `aria-controls`, nombre accesible que identifica SU fila, panel montado sólo si
  está abierta).
  **Hecho:** con la fila cerrada, el lector de detalle **no se llama ni una vez**; al abrirla, se
  llama exactamente una; dos filas abiertas mantienen páginas independientes.

- [ ] **T5.4 — `DesgloseEgresosLista.tsx`:** dos filas nuevas, «Otros» condicional a
  `hayOtrosEgresos`, filas desplegables. El `role="group"`, el `aria-label` y la estructura
  `<dt>`/`<dd>` **no cambian**.
  **Hecho:** con `hayOtrosEgresos: false` la fila «Otros gastos de Ordenex» **no está en el DOM**; con
  `true`, está con su importe y su pista.

- [ ] **T5.5 — `ComposicionGananciaCard.tsx`:** recibe los filtros vigentes, los baja a las filas, y
  `DESCRIPCION` pasa a nombrar también los ajustes.
  **Hecho:** el texto de la tarjeta nombra fletes, comisiones, impuestos, gastos, sueldos,
  indemnizaciones, pagos a mensajeros **y ajustes**, y sigue diciendo que el dinero de las tiendas
  queda fuera.

- [ ] **T5.6 — `WalletModule.tsx`:** pasa `filtros` a la tarjeta y usa el constructor de filtros
  ÚNICO (el de hoy, extraído de `buildInputCompleto`) también para el detalle.
  **Hecho:** existe **una** función que construye el input de filtros y la usan los tres caminos
  (libro completo, detalle y —compuesta con la página— el listado).

---

## B6 — Censos ajenos (frontend) · depende de B5

- [ ] **T6.1 — Registrar la tabla nueva en `tests/unit/descarga/censo-tablas.ts` como `fuera`,** con
  el motivo escrito (`design.md § 8`), y subir los números de
  `tests/unit/descarga/cobertura-tablas.guardia.test.ts`: archivos 28 → 29, instancias 28 → 29,
  censadas 29 → 30, `fuera` 10 → 11.
  **Hecho:** la guardia se vio fallar con «29 recibido / 28 esperado» **antes** de tocar los números
  (la convención escrita en ese propio archivo), y la entrada se coloca respetando el orden alfabético
  con el que la guardia recorre el árbol.

- [ ] **T6.2 — Ampliar el barrido de STRING de `tests/integration/wallet-page.test.tsx`** sin
  aflojarlo: `egresos` se desestructura y recibe **el mismo** bucle de `typeof === "string"` con su
  control de no-vacuidad; `hayOtrosEgresos` se exceptúa **por nombre** (nunca con un
  `typeof !== "string" → salta`) y gana su propia aserción de booleano.
  **Hecho:** el barrido sigue cayendo si alguien mete un importe como `number` en cualquiera de las
  dos claves nuevas (comprobado con una mutación en memoria).

- [ ] **T6.3 — Actualizar los literales-contrato de
  `tests/components/ComposicionGananciaCard.test.tsx`.** Los `toEqual` de rótulos y de pares
  rótulo↔importe de la columna de egresos SON el contrato de la tarjeta: se **actualizan
  deliberadamente** con las filas nuevas, no se sustituyen por una derivación de la propia fuente que
  los dejaría siempre verdes.
  **Hecho:** el fixture tiene importes todos distintos **después de formatear**, ninguno igual a un
  total, y el caso de orden sigue discriminando (el importe mayor no está ni el primero ni el último).

---

## B7 — Cierre

- [ ] **T7.1 — Bitácora en `progress/impl_339.md`:** archivos tocados, mapa `R → test`, salidas de los
  tests, la mutación del `WHERE` y su resultado, y los números de censo antes/después.
  **Hecho:** el archivo está **commiteado** (en este repo el informe se ha quedado sin commitear tres
  veces en un día y un `git checkout` se lo llevó).

- [ ] **T7.2 — Gate.** El diff toca `lib/types/**` y archivos con nombre de dinero, así que **el modo
  rápido se niega solo**: va `./init.sh` completo, con `INIT_EXIT=$?` escrito DENTRO del log.
  **Hecho:** verde, con el conteo de tests y el `INIT_EXIT` anotados.

---

## Trazabilidad `R<n> → test`

> Cada requisito, a un caso concreto y nombrado. Archivos nuevos marcados con ✚.

| R | Test |
| --- | --- |
| R1 | `tests/components/ComposicionGananciaCard.test.tsx` › la columna de egresos tiene fila «Pagos a mensajeros» con su importe |
| R2 | `tests/components/ComposicionGananciaCard.test.tsx` › la columna de egresos tiene fila «Ajustes (egreso)» con su importe |
| R3 | `tests/components/ComposicionGananciaCard.test.tsx` › el rótulo de los ajustes usa el concepto que el diálogo promete en el libro |
| R4 | `tests/unit/utils/caja-composicion.test.ts` › cada cubeta de `egresos` suma sólo su categoría |
| R5 | `tests/components/ComposicionGananciaCard.test.tsx` › ningún rótulo de la columna es el valor del enum |
| R6 | `tests/components/ComposicionGananciaCard.test.tsx` › el orden de la columna de egresos es el declarado, no el de magnitud |
| R7 | `tests/components/ComposicionGananciaCard.test.tsx` › con `hayOtrosEgresos` falso, la fila «Otros gastos de Ordenex» no está en el DOM |
| R8 | `tests/components/ComposicionGananciaCard.test.tsx` › con `hayOtrosEgresos` verdadero, la fila aparece con su importe |
| R9 | `tests/unit/utils/caja-composicion.test.ts` › `hayOtrosEgresos` lo deriva el servidor + `tests/components/ComposicionGananciaCard.test.tsx` › la tarjeta no compara importes (barrido de fuente) |
| R10 | `tests/components/ComposicionGananciaCard.test.tsx` › la fila «Otros» lleva su pista sobre el dinero sin clasificar |
| R11 | `tests/unit/guards/caja-composicion-exhaustiva.guardia.test.ts` › los cuatro conceptos + los dos nombrados + «otros» suman `egresosPropios` |
| R12 | `tests/unit/utils/caja-composicion.test.ts` › `otrosEgresos + egresos.* ` es el mismo importe que el `otrosEgresos` anterior a la ficha |
| R13 | `tests/unit/guards/caja-composicion-exhaustiva.guardia.test.ts` › cada categoría propia aporta a UNA sola cubeta, nunca a dos |
| R14 | `tests/unit/utils/caja-composicion.test.ts` › las siete cifras del resumen y los cuatro conceptos del desglose no cambian de valor |
| R15 | ✚ `tests/components/DetalleFilaComposicion.test.tsx` › al abrir una fila se muestran sus movimientos |
| R16 | ✚ `tests/components/DetalleFilaComposicion.test.tsx` › cada movimiento muestra fecha, concepto, detalle e importe |
| R17 | ✚ `tests/components/DetalleFilaComposicion.test.tsx` › un movimiento sin descripción muestra su origen legible |
| R18 | ✚ `tests/integration/db/composicion-detalle-postgres.test.ts` › el detalle de una fila trae sólo sus categorías |
| R19 | ✚ `tests/integration/db/composicion-detalle-postgres.test.ts` › la suma del detalle es el importe de la fila |
| R20 | ✚ `tests/integration/db/composicion-detalle-postgres.test.ts` › el rango de fechas vigente recorta el detalle |
| R21 | ✚ `tests/components/DetalleFilaComposicion.test.tsx` › con la fila cerrada no se lee nada |
| R22 | ✚ `tests/components/DetalleFilaComposicion.test.tsx` › abrir una fila cuesta exactamente una lectura |
| R23 | ✚ `tests/components/DetalleFilaComposicion.test.tsx` › dos filas abiertas mantienen páginas independientes |
| R24 | ✚ `tests/components/DetalleFilaComposicion.test.tsx` › el control de abrir nombra SU fila |
| R25 | ✚ `tests/components/DetalleFilaComposicion.test.tsx` › una fila sin movimientos muestra su estado vacío |
| R26 | ✚ `tests/components/DetalleFilaComposicion.test.tsx` › un fallo de lectura se cuenta dentro de la fila y la tarjeta sigue en pie |
| R27 | ✚ `tests/integration/db/composicion-detalle-postgres.test.ts` › el detalle devuelve una página, no el conjunto |
| R28 | ✚ `tests/components/DetalleFilaComposicion.test.tsx` › con más filas que la página se puede navegar a la siguiente |
| R29 | ✚ `tests/unit/config/composicion-detalle-config.test.ts` › el tamaño y el tope salen de la config, y la pantalla no declara ningún literal |
| R30 | ✚ `tests/unit/config/composicion-detalle-config.test.ts` › respeta el override de entorno e ignora el valor basura |
| R31 | ✚ `tests/integration/db/composicion-detalle-postgres.test.ts` › el `total` es el del conjunto, no el largo de la página |
| R32 | ✚ `tests/unit/actions/wallet-detalle-fila-action.test.ts` › un `pageSize` sobre el tope es `validation_error` y no devuelve filas |
| R33 | ✚ `tests/integration/db/composicion-detalle-postgres.test.ts` › quitar la restricción del `WHERE` pone el caso rojo (mutación) |
| R34 | ✚ `tests/unit/actions/wallet-detalle-fila-action.test.ts` › todo importe cruza como texto |
| R35 | ✚ `tests/components/DetalleFilaComposicion.test.tsx` › barrido money-safe de las fuentes nuevas de la tarjeta y del detalle |
| R36 | ✚ `tests/components/DetalleFilaComposicion.test.tsx` › el detalle no pinta ningún subtotal de página |
| R37 | `tests/unit/guards/caja-derivaciones.guardia.test.ts` › la derivación de la caja no gana ninguna resta con signo |
| R38 | `tests/unit/services/wallet-service.test.ts` › un rol sin acceso total recibe `forbidden` sin movimientos |
| R39 | `tests/unit/services/wallet-service.test.ts` › el `forbidden` del detalle no llama al repositorio |
| R40 | `tests/unit/services/wallet-service.test.ts` › el detalle usa el mismo predicado de acceso que el listado |
| R41 | `tests/components/ComposicionGananciaCard.test.tsx` › la descripción nombra también los ajustes |
| R42 | `tests/components/ComposicionGananciaCard.test.tsx` › la descripción sigue diciendo que el dinero de las tiendas no entra |

**Nota sobre las mutaciones exigidas.** Tres casos de esta tabla no valen nada sin su mutación
ejecutada y anotada: `R33` (quitar el `in` del `WHERE`), `R12` (cambiar de cubeta una categoría sin
tocar el total) y `R31` (devolver `movimientos.length` como `total`). Las tres se corren a mano, se
revierten y se dejan escritas en `progress/impl_339.md` con su resultado: en este repo hay un arnés de
mutaciones que reportó supervivientes **sin haber ejecutado un solo test**.
