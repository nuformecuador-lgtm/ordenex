# Ficha 344 — Tasks

> Zona `fullstack`: **backend primero, frontend después** (B0–B5 antes que B6–B9).
> `[P]` = paralelizable con las tareas hermanas de su mismo bloque.
> Nadie corre la suite completa salvo el leader (`AGENTS.md § Regla del gate`).

---

## B0 — Medir antes de tocar (bloquea todo lo demás)

- [ ] **T0.1 — Re-medir la premisa contra producción, en SOLO LECTURA.**
  La sesión que escribió este spec **no tuvo acceso a base ni a shell**, así que los números de la
  ficha son premisa, no medida propia. Antes de escribir una línea hay que confirmar, contra la
  base de producción y sin escribir nada:
  (a) cuántos movimientos de `wallet_movimiento` tienen `origen_tipo = 'cierre_dia'` y cuántos de
  ésos tienen `origen_id NOT NULL` (la ficha dice 68 y 68);
  (b) el reparto por `categoria` de esos movimientos, para saber cuántos quedan en `sin_reparto`;
  (c) lo mismo para `wallet_tienda_movimiento`;
  (d) para UN cierre concreto: cuántas filas tiene en `cierre_detail` y cuántas de sus gestiones son
  `entregada` (la ficha dice 23 y 14);
  (e) si existe alguna orden con **dos gestiones** en el mismo cierre (el caso de `Q1`).
  **Hecho:** los cinco números anotados en `progress/impl_344.md` con la consulta que los produjo.
  **Si (a) no se sostiene —hay movimientos de cierre sin `origen_id`— se PARA y se pregunta:** todo
  el diseño cuelga de que del movimiento se pueda llegar al cierre.

- [ ] **T0.2 — Fotografiar los números de los censos ajenos que esta ficha mueve.**
  Correr y **anotar la salida** de las guardias implicadas ANTES de tocarlas:
  `tests/unit/descarga/cobertura-tablas.guardia.test.ts`,
  `tests/unit/descarga/columnas-asercion-de-orden.guardia.test.ts`,
  `tests/unit/descarga/columnas-sensibles.guardia.test.ts`,
  `tests/unit/descarga/adaptador-conjunto.guardia.test.ts` y
  `tests/components/paginacion/paginacion-transversal.test.tsx`.
  **Hecho:** todas en verde y los números del censo de tablas anotados (este spec leyó 29 archivos,
  29 instancias, 30 censadas = 19 `con_descarga` + 11 `fuera`; si el árbol dice otra cosa, mandan
  los del árbol). Sin esta foto no se distingue «el número que subí» de «el que ya estaba mal».

- [ ] **T0.3 — Confirmar en el ARCHIVO REAL los seis símbolos sobre los que se construye.** [P]
  `derivarIngresoOrden` y `agregarIngresosPorConcepto` en `lib/utils/ingreso-ordenex.ts`;
  `construirMovimientosDeIngreso` en `lib/services/WalletFeedService.ts`;
  `construirMovimientosPorTienda` en `lib/services/WalletTiendaFeedService.ts`;
  `DETALLE_SELECT`/`tarifaDe` en `lib/utils/cierre-detalle.ts`; `renderExpanded`/`expandAriaLabel`
  en `components/shared/DataTable.tsx`.
  **Hecho:** los seis leídos en disco (no en el grafo) y sus líneas anotadas. El índice del MCP
  devuelve de más; esta ficha depende de que los seis estén EXACTAMENTE como el diseño supone.

---

## B1 — El módulo puro: catálogo, criterio y aporte (backend) · depende de B0

- [ ] **T1.1 — `lib/utils/aporte-por-orden.ts`: los dos catálogos de fuente.**
  `FuenteDeAporte`, `MotivoSinReparto`, `FUENTE_CAJA` y `FUENTE_TIENDA` como `Record` **TOTALES**
  sobre los dos unions de categoría, con el motivo escrito en cada entrada `sin_reparto`.
  **Hecho:** `pnpm typecheck` verde; **añadir a mano un valor al union de categorías rompe el
  build** (comprobado y revertido) — ésa es la mitad ejecutable de `R49`.

- [ ] **T1.2 — `CRITERIO_DE_APORTE`: la tabla de los tres hechos almacenados.** · depende de T1.1
  Por concepto: `resultados`, `exigeCobraComision`, `exigeTarifa`. Con el docstring que diga que de
  esta tabla salen LAS DOS formas del criterio (el `WHERE` y el predicado) y que lo único que impide
  que diverjan es el test de T1.4.
  **Hecho:** la tabla no contiene ninguna condición que no sea columna de `gestion_orden` o de
  `cierre_detail`; si alguien necesita una que no lo sea, la salida es la alternativa A1 del diseño,
  no un `if` en memoria.

- [ ] **T1.3 — `aporteDeOrden(fuente, entradasDeSusGestiones)`.** · depende de T1.2
  `concepto_ordenex` → acumula los aportes PRESENTES que devuelve `derivarIngresoOrden` para las
  gestiones de esa orden en ese cierre; `undefined` si ninguno está presente.
  `cod_recaudado` → acumula `monto_recibido ?? 0` de todas sus gestiones.
  **Hecho:** el módulo **no reimplementa ni una línea de fórmula** —llama a `derivarIngresoOrden`—,
  toda su aritmética es `Prisma.Decimal`, y no aparece `Number(`, `parseFloat(` ni `parseInt(`.

- [ ] **T1.4 — El test de EQUIVALENCIA exhaustivo, que es la pieza clave de la ficha.**
  · depende de T1.3
  Para los 6 conceptos × 5 `GestionResultado` × 2 `cobraComision` × 2 «hay tarifa» = **120 celdas**:
  `satisface(CRITERIO_DE_APORTE[c], hechos) === (derivarIngresoOrden(entrada, tarifa)[c] !== undefined)`.
  **Hecho:** las 120 celdas se ejecutan (se afirma el número de casos, para que un bucle vacío no
  pase por verde) y **la mutación obligatoria**: quitar `"rechazada"` de los `resultados` de
  `ingreso_flete_devolucion` pone el test rojo nombrando la celda. Mutación ejecutada, revertida y
  anotada en `progress/impl_344.md`.

- [ ] **T1.5 [P] — El test de PARTICIÓN: sumar por orden da el agregado.** · depende de T1.3
  Sobre un conjunto sintético de gestiones agrupadas por orden:
  `Σ aporteDeOrden(concepto, …) === el monto que agregarIngresosPorConcepto emite para ese concepto`,
  incluidos los casos de dos gestiones en una orden y de orden sin tarifa.
  **Hecho:** verde con importes que producen redondeos intermedios (comisión sobre COD con
  céntimos), que es donde una deriva de redondeo aparecería. Es la prueba de que la partición por
  orden no inventa ni pierde un céntimo.

---

## B2 — Configuración (backend) · depende de B0

- [ ] **T2.1 [P] — `lib/config/detalle-movimiento.ts`.** Molde exacto de
  `lib/config/composicion-detalle.ts`. `DEFAULT_PAGE_SIZE = 25`
  (`DETALLE_MOVIMIENTO_DEFAULT_PAGE_SIZE`), `MAX_PAGE_SIZE = 100`
  (`DETALLE_MOVIMIENTO_MAX_PAGE_SIZE`).
  **Hecho:** el defecto no supera al tope; un valor de entorno válido lo sobreescribe y uno basura
  (`"abc"`, `"-5"`, `""`) cae al valor por defecto. **NO se registra** en el censo de dominios de
  paginación (motivo en `design.md § 3.6`).

---

## B3 — El repositorio (backend) · depende de B1

- [ ] **T3.1 — `lib/repositories/CierreAporteRepository.ts` + su interfaz.**
  `listarOrdenesQueAportan(f)` (página + `count` con el MISMO `where`) y
  `contarOrdenesDelCierre(f)`. Raíz `cierre_detail`; `orden.gestiones.some({ cierreId, resultado })`
  como EXISTS; `tarifaId`/`cobraComision` según el criterio; **`tiendaId` escrito AL FINAL** del
  objeto `where`, después de todo spread.
  **Hecho:** el `some` lleva `{ cierreId, resultado }` y **nada más** — sin `anuladaAt`, porque el
  feed que produjo el importe tampoco lo lleva y añadirlo descuadraría la suma (motivo escrito en
  el código, no sólo aquí).

- [ ] **T3.2 — El orden TOTAL de la página.** `orderBy: [{ numGuia asc, nulls last }, { id asc }]`.
  **Hecho:** con dos filas de igual `numGuia` (y con `numGuia` nulo) el recorrido de todas las
  páginas devuelve cada orden **exactamente una vez**; sin el desempate por `id`, el caso cae.

- [ ] **T3.3 — Test de repositorio sobre los ARGUMENTOS de la consulta.** · depende de T3.1
  Ejecutando el código REAL del repositorio y afirmando sobre el `where` emitido: que `tiendaId`
  está DENTRO del `where` (no aplicado después), que el criterio del concepto está en el `where`, y
  que sin `tiendaId` la clave sencillamente no aparece.
  **Hecho:** verde. Este test comprueba la FORMA; quien comprueba la CONDUCTA es B5, y ninguno
  sustituye al otro.

---

## B4 — Servicios y borde (backend) · depende de B3

- [ ] **T4.1 — Los dos schemas de borde en `lib/types/`.**
  `verDetalleDeMovimientoSchema` (`movimientoId` uuid + `page` + `pageSize` desde la config) y su
  derivado completo con `.omit({page,pageSize}).strict()`. Espejo para el libro de la tienda.
  **Hecho:** un `pageSize` por encima del tope y un `tiendaId` colado producen `validation_error`
  **sin devolver ninguna fila**; el schema no acepta ninguna otra clave.

- [ ] **T4.2 — `WalletService.verDetalleDeMovimiento` y `…Completo`.** · depende de T4.1
  Guard `esAccesoTotal` ANTES de la base; leer el movimiento por id; `sin_reparto` según
  `FUENTE_CAJA`, `origen_tipo` y `origen_id`; cabecera del cierre (fecha + mensajero); repositorio;
  derivación con `aporteDeOrden`. El modo completo con `pageSize: descargaConfig.MAX_FILAS + 1` y
  `limite_excedido` con sólo conteos.
  **Hecho:** un rol sin acceso total recibe `forbidden` **sin que el repositorio se haya llamado**
  (verificado con el doble: cero invocaciones).

- [ ] **T4.3 — `WalletTiendaService.verDetalleDeMiMovimiento` y `…Completo`.** · depende de T4.1
  Igual, con dos diferencias: el guard es el rol de tienda, y `tiendaId: actor.usuarioId` va **en el
  `WHERE` de las DOS lecturas** —la del movimiento y la de las órdenes—, escrito al final.
  `mensajeroNombre` sale `null` (`R15`).
  **Hecho:** un movimiento de otra tienda devuelve `not_found` (nunca `ok` con filas y nunca
  `forbidden`, que confirmaría su existencia); la respuesta no contiene el nombre del mensajero.

- [ ] **T4.4 — Las cuatro Server Actions.** · depende de T4.2, T4.3
  Dos en `lib/actions/wallet.ts` y dos en `lib/actions/wallet-tienda.ts`, calcadas de sus vecinas:
  actor, `UnauthenticatedError`, schema, servicio, `withErrorHandler`.
  **Hecho:** sin sesión → `unauthenticated`; entrada inválida → `validation_error`; ninguna rama de
  error viaja con órdenes. Las cuatro nacen con consumidor montado (la guardia de superficie de uso
  lo exige) — si B6/B7 aún no están, se cierra la tanda con ellas.

---

## B5 — La prueba contra Postgres (backend) · depende de B4

- [ ] **T5.1 — `tests/integration/db/detalle-movimiento-cierre-postgres.test.ts`.**
  Molde de los tests de integración de base que ya existen: cliente de test + transacción revertida,
  `describe.skip` si no hay base alcanzable, y **ni un `return` mudo** (si falta un dato previo, el
  test FALLA con su motivo). Cubre los NUEVE hechos de `design.md § 6`.
  **Hecho:** los nueve verdes, y **cuatro mutaciones ejecutadas, revertidas y anotadas** en
  `progress/impl_344.md` con su resultado:
  (1) quitar la restricción de `resultado` del `WHERE` → el caso del cuadre cae nombrando los
  importes intrusos y `total` pasa de 14 a 23;
  (2) quitar `tiendaId` del `where` de las órdenes → aparecen filas de la otra tienda;
  (3) quitar `tiendaId` del `where` de la lectura del movimiento → una tienda lee el detalle ajeno;
  (4) devolver `ordenes.length` como `total` → cae el caso de `pageSize + 3`.
  En este repo hay un arnés de mutaciones que reportó supervivientes **sin haber ejecutado un solo
  test**: cada mutación se anota con la salida real, no con su conclusión.

---

## B6 — El panel de la caja (frontend) · depende de B5

- [ ] **T6.1 — `detalle-movimiento-labels.ts`.** Textos del panel: encabezados de columna, vacío,
  error, la frase de «N de M», la frase de `sin_reparto` por motivo, y los nombres accesibles
  (abrir la fila, la tabla, la paginación, el enlace a la orden).
  **Hecho:** **ninguna constante se llama `PAGINACION_*_LABEL`** (ver `design.md § 7.3`: ese prefijo
  es el ancla de un censo ajeno con una igualdad exacta y lo pondría rojo por un motivo falso). Los
  nombres accesibles componen el concepto y la fecha del cierre, no un genérico repetido.

- [ ] **T6.2 — `DetalleMovimientoCierre.tsx`.** · depende de T6.1
  `useSWR` con clave `(movimientoId, page)`; `DataTable` (guía enlazada · destinatario · tienda ·
  resultado · aporte) + `Pagination` con `sticky={false}` y el `total` del servidor; cabecera con la
  fecha del cierre, el mensajero y el «N de M»; rama `sin_reparto` que dice de dónde sale el
  importe; estado vacío y estado de error propios.
  **Hecho:** ni `Number(`, ni `parseFloat(`, ni `parseInt(`, ni `.toFixed(` en la fuente (barrido
  sobre el código sin comentarios); el `total` que recibe `Pagination` no es `ordenes.length`; no
  hay fila de subtotal.

- [ ] **T6.3 — Las dos formas de la tabla: escritorio y teléfono.** · depende de T6.2
  Por debajo de 768 px, DOS columnas: celda de texto apilada con `wrap-anywhere` (guía enlazada,
  destinatario, tienda, resultado) + el aporte con columna propia, `whitespace-nowrap` y
  `tabular-nums`. **Prohibido** `truncate`, `line-clamp`, `overflow-hidden` y cualquier abreviatura
  en la celda del importe.
  **Hecho:** hay tests que **mueren ante la mutación** de `COLUMNAS_MOVIL` (en la ficha 343 ese
  juego de columnas era código muerto para la suite —el polyfill de `matchMedia` devuelve siempre
  escritorio— y se podía borrar entero quedando verde). Aquí se fuerza el hook y se afirman las dos
  formas.

- [ ] **T6.4 — `WalletLedger.tsx`: `renderExpanded` + `expandAriaLabel`.** · depende de T6.2
  Devuelve `null` cuando el origen del movimiento no es un cierre, para que la primitiva no pinte el
  botón sobre esa fila. **Las columnas visibles del libro no se tocan**: hay una aserción ajena que
  fija su secuencia y esta ficha no la mueve (la columna de expansión la antepone la primitiva).
  **Hecho:** con el libro cerrado, la lectura del detalle **no se llama ni una vez**; al abrir una
  fila se llama exactamente una; dos filas abiertas mantienen páginas independientes; una fila de
  origen manual no ofrece control de apertura.

---

## B7 — El panel de la tienda (frontend) · depende de B6

- [ ] **T7.1 — `detalle-mi-movimiento-labels.ts` y `DetalleMiMovimientoCierre.tsx`.**
  Mismo panel sin la columna «Tienda» y **sin el nombre del mensajero**.
  **Hecho:** el DOM del panel no contiene el nombre de ningún mensajero en ninguna parte (se afirma
  sobre el payload y sobre el render), que es la decisión que la ficha 335 tomó para esta pantalla.

- [ ] **T7.2 — `DesgloseTiendaLedger.tsx`: `renderExpanded` + `expandAriaLabel`.**
  · depende de T7.1
  **Hecho:** mismas cuatro afirmaciones que T6.4, sobre el libro de la tienda.

---

## B8 — La descarga y los censos (frontend) · depende de B7

- [ ] **T8.1 — Los dos módulos de columnas** (`*-descarga-columnas.ts`) con sus proyectores.
  Caja: guía · destinatario · tienda · resultado · aporte. Tienda: guía · destinatario · resultado ·
  aporte. El aporte va como el STRING del servidor, sin `money` y sin reformatear; el resultado como
  etiqueta legible; **ningún identificador**.
  **Hecho:** los dos `toEqual` que ENUMERAN claves y encabezados están escritos **a mano** (no
  derivados de la propia constante, que sería una aserción contra su propia fuente y no podría
  ponerse roja nunca); un `"1000.10"` sale como `"1000.10"` y no como `"1000.1"`; ninguna celda
  contiene algo con forma de uuid.

- [ ] **T8.2 — Cablear la descarga en los dos paneles.** · depende de T8.1
  `descarga={{ titulo, columnas, obtenerFilas }}` con
  `filasDesdeResultado(verDetalle…CompletoAction(...), fila…)`.
  **Hecho:** **no** se usa el adaptador de relectura (retirado del repo); por encima del tope no se
  produce archivo y el mensaje dice el total y el tope.

- [ ] **T8.3 — Registrar las dos tablas nuevas en el censo de tablas, como `con_descarga`.**
  · depende de T8.2
  Con el motivo escrito en su entrada: **este panel enseña algo que ninguna otra descarga produce**
  —el reparto de un importe entre las órdenes que lo componen—, a diferencia del desplegable de la
  ficha 343, que era un recorte de un libro ya descargable.
  **Hecho:** la guardia se vio fallar primero con «hay tablas sin registrar: …» **antes** de tocar
  los números (la convención escrita en ese propio archivo), y los cuatro suben desde lo que T0.2
  midió: archivos +2, instancias +2, censadas +2, `con_descarga` +2, `fuera` sin cambio.

- [ ] **T8.4 [P] — Comprobar que ningún otro censo se movió.** · depende de T8.2
  Volver a correr las cinco guardias de T0.2.
  **Hecho:** el censo transversal de paginación sigue en su igualdad exacta (ninguna constante nueva
  con el prefijo reservado); la guardia de aserciones de orden pasa con las dos constantes nuevas;
  la de columnas sensibles las descubre por convención y pasa; la del adaptador de conjunto sigue en
  cero llamadas a la relectura.

---

## B9 — Verlo en un navegador de verdad · depende de B8

- [ ] **T9.1 — Medir el panel en Chromium a 390 y a 1440, y también a 1024.**
  Abrir `/wallet`, filtrar hasta ver un movimiento de cierre, abrir su fila y, para CADA ancho:
  (a) leer el **texto** de cada celda de importe con `textContent` y compararlo con el valor del
  payload — no basta con que «se vea bien»: el fallo de la ficha 343 era que el DOM decía «₡1.700» y
  la pantalla mostraba «₡1.70»;
  (b) medir `scrollWidth - clientWidth` del contenedor de scroll de la tabla;
  (c) comprobar que a 390 px no aparecen las flechas de desplazamiento de la tabla.
  Repetir en `/mi-wallet` con un usuario de tienda.
  **Hecho:** las tres medidas anotadas en `progress/impl_344.md` para los tres anchos, con desborde
  **0 a 390 px** y ninguna celda de dinero recortada. Ninguna prueba en memoria puede sustituir a
  esto: en jsdom no hay ancho de pantalla.

- [ ] **T9.2 — Comprobar el enlace a la orden en las dos pantallas.** [P]
  **Hecho:** el enlace lleva a `/ordenes` con el término puesto y la orden aparece; con una guía por
  debajo del mínimo del buscador, la pantalla lo dice por escrito en vez de fallar en silencio
  (caso borde declarado, no regresión).

---

## B10 — Cierre

- [ ] **T10.1 — Bitácora en `progress/impl_344.md`:** archivos tocados, mapa `R → test`, salidas de
  los tests, las CINCO mutaciones (la de T1.4 y las cuatro de T5.1) con su resultado real, los
  números de censo antes/después y las medidas del navegador.
  **Hecho:** el archivo está **commiteado**. En este repo el informe se ha quedado sin commitear
  tres veces en un día y un `git checkout` se lo llevó.

- [ ] **T10.2 — Gate.** El diff toca `lib/types/**`, `lib/config/**` y archivos con nombre de
  dinero, así que **el modo rápido se niega solo**: va `./init.sh` completo, con `INIT_EXIT=$?`
  escrito DENTRO del log (un gate rojo ya llegó una vez como «exit code 0» tapado por un `echo`).
  **Hecho:** verde, con el conteo de tests y el `INIT_EXIT` anotados.

---

## Trazabilidad `R<n> → test`

> Cada requisito, a un caso concreto y nombrado. Todos los archivos marcados con ✚ son nuevos.

| R | Test |
| --- | --- |
| R1 | ✚ `tests/components/DetalleMovimientoCierre.test.tsx` › al abrir una fila de cierre se muestran sus órdenes |
| R2 | ✚ `tests/components/DetalleMovimientoCierre.test.tsx` › con el libro cerrado no se lee ningún detalle |
| R3 | ✚ `tests/components/DetalleMovimientoCierre.test.tsx` › abrir una fila cuesta exactamente una lectura |
| R4 | ✚ `tests/components/DetalleMovimientoCierre.test.tsx` › dos filas abiertas mantienen páginas independientes |
| R5 | ✚ `tests/components/DetalleMovimientoCierre.test.tsx` › el control de abrir nombra SU fila |
| R6 | ✚ `tests/components/DetalleMovimientoCierre.test.tsx` › una fila de origen manual no ofrece control de apertura |
| R7 | ✚ `tests/components/DetalleMovimientoCierre.test.tsx` › un fallo de lectura se cuenta dentro de la fila y el libro sigue en pie |
| R8 | ✚ `tests/components/DetalleMovimientoCierre.test.tsx` › un detalle sin órdenes muestra su estado vacío |
| R9 | ✚ `tests/components/DetalleMovimientoCierre.test.tsx` › la cabecera del panel dice la fecha del cierre |
| R10 | ✚ `tests/components/DetalleMovimientoCierre.test.tsx` › cada orden muestra guía, destinatario, resultado y aporte |
| R11 | ✚ `tests/components/DetalleMovimientoCierre.test.tsx` › cada orden lleva enlace al listado de órdenes con su guía |
| R12 | ✚ `tests/components/DetalleMovimientoCierre.test.tsx` › el panel dice cuántas órdenes aportan de cuántas tiene el cierre |
| R13 | ✚ `tests/components/DetalleMovimientoCierre.test.tsx` › el resultado sale como etiqueta legible, nunca como valor del enum |
| R14 | ✚ `tests/components/DetalleMovimientoCierre.test.tsx` › la caja principal muestra la tienda de cada orden |
| R15 | ✚ `tests/unit/services/wallet-tienda-detalle-movimiento.test.ts` › el detalle de la tienda no lleva el nombre del mensajero |
| R16 | ✚ `tests/integration/db/detalle-movimiento-cierre-postgres.test.ts` › el detalle trae sólo las órdenes que aportan a ese concepto |
| R17 | ✚ `tests/integration/db/detalle-movimiento-cierre-postgres.test.ts` › la suma de todas las páginas es el importe del movimiento |
| R18 | ✚ `tests/unit/utils/aporte-por-orden-equivalencia.test.ts` › el criterio coincide con la derivación en las 120 combinaciones |
| R19 | ✚ `tests/integration/db/detalle-movimiento-cierre-postgres.test.ts` › de 23 órdenes del cierre sólo aportan las 14 entregadas |
| R20 | ✚ `tests/integration/db/detalle-movimiento-cierre-postgres.test.ts` › una orden con dos gestiones sale una vez con el aporte sumado |
| R21 | ✚ `tests/unit/repositories/cierre-aporte-repository.test.ts` › el criterio del concepto viaja dentro del where |
| R22 | ✚ `tests/unit/utils/aporte-por-orden.test.ts` › el aporte se deriva del snapshot congelado, no de datos vivos |
| R23 | ✚ `tests/integration/db/detalle-movimiento-cierre-postgres.test.ts` › la orden sin tarifa congelada no aparece y no altera la suma |
| R24 | ✚ `tests/integration/db/detalle-movimiento-cierre-postgres.test.ts` › el detalle devuelve una página, no el conjunto |
| R25 | ✚ `tests/components/DetalleMovimientoCierre.test.tsx` › con más órdenes que la página se puede navegar a la siguiente |
| R26 | ✚ `tests/unit/config/detalle-movimiento-config.test.ts` › el tamaño y el tope salen de la configuración |
| R27 | ✚ `tests/unit/config/detalle-movimiento-config.test.ts` › respeta el override de entorno e ignora el valor basura |
| R28 | ✚ `tests/integration/db/detalle-movimiento-cierre-postgres.test.ts` › el total es el del conjunto, no el largo de la página |
| R29 | ✚ `tests/unit/actions/detalle-movimiento-action.test.ts` › un pageSize sobre el tope es validation_error y no devuelve órdenes |
| R30 | ✚ `tests/integration/db/detalle-movimiento-cierre-postgres.test.ts` › recorrer las páginas devuelve cada orden exactamente una vez |
| R31 | ✚ `tests/components/DetalleMovimientoCierre.test.tsx` › el panel monta su control de descarga |
| R32 | ✚ `tests/unit/services/wallet-detalle-movimiento.test.ts` › el modo completo devuelve el conjunto sin recorte por página |
| R33 | ✚ `tests/components/DetalleMovimientoCierre.test.tsx` › la descarga sale de la lectura dedicada y el navegador no recorta nada |
| R34 | ✚ `tests/unit/services/wallet-detalle-movimiento.test.ts` › por encima del tope devuelve sólo conteos y ninguna fila |
| R35 | ✚ `tests/unit/descarga/detalle-movimiento-descarga-columnas.test.ts` › declara sus columnas enumeradas, en el orden de la pantalla |
| R36 | `tests/unit/descarga/columnas-sensibles.guardia.test.ts` › ninguna columna emite identificadores internos |
| R37 | ✚ `tests/unit/descarga/detalle-movimiento-descarga-columnas.test.ts` › emite el aporte tal cual, sin recalcularlo ni adornarlo |
| R38 | ✚ `tests/unit/services/wallet-detalle-movimiento.test.ts` › un rol sin acceso total recibe forbidden sin órdenes |
| R39 | ✚ `tests/unit/services/wallet-detalle-movimiento.test.ts` › el forbidden no llega a llamar al repositorio |
| R40 | ✚ `tests/integration/db/detalle-movimiento-cierre-postgres.test.ts` › la tienda no ve ni una orden de otra tienda del mismo cierre |
| R41 | ✚ `tests/integration/db/detalle-movimiento-cierre-postgres.test.ts` › el movimiento de otra tienda responde no encontrado |
| R42 | ✚ `tests/unit/actions/detalle-movimiento-action.test.ts` › una clave de tienda colada muere en el borde |
| R43 | ✚ `tests/unit/services/wallet-tienda-detalle-movimiento.test.ts` › usa el mismo predicado de rol que el listado |
| R44 | ✚ `tests/unit/services/wallet-detalle-movimiento.test.ts` › todo importe cruza la frontera como texto |
| R45 | ✚ `tests/components/DetalleMovimientoCierre.test.tsx` › barrido money-safe de las fuentes nuevas |
| R46 | ✚ `tests/unit/utils/aporte-por-orden.test.ts` › sumar los aportes por orden da el mismo agregado que el feed |
| R47 | ✚ `tests/components/DetalleMovimientoCierre.test.tsx` › el panel no pinta ningún subtotal de página |
| R48 | ✚ `tests/components/DetalleMovimientoCierre.test.tsx` › un concepto sin reparto abre su panel y dice de dónde sale |
| R49 | ✚ `tests/unit/utils/aporte-por-orden.test.ts` › los dos catálogos cubren todas las categorías de sus enums |
| R50 | ✚ `tests/components/DetalleMovimientoCierre.test.tsx` › en móvil el importe conserva su columna y su texto entero + medida en Chromium (T9.1) |
| R51 | ✚ `tests/components/DetalleMovimientoCierre.test.tsx` › la celda del importe no lleva ninguna clase que trunque |
| R52 | ✚ `tests/components/DetalleMovimientoCierre.test.tsx` › la forma de móvil muestra los mismos datos que la de escritorio |

**Nota sobre los espejos de `/mi-wallet`.** Los casos de `R1`–`R14`, `R25`, `R31`, `R33`, `R45`,
`R47`, `R48` y `R50`–`R52` tienen su gemelo en
✚ `tests/components/DetalleMiMovimientoCierre.test.tsx`, y los de `R35`/`R37` en
✚ `tests/unit/descarga/detalle-mi-movimiento-descarga-columnas.test.ts`. No se listan fila a fila
para no duplicar la tabla; el reviewer los verifica con la misma lista.

**Nota sobre las mutaciones exigidas.** Cinco casos de esta tabla no valen nada sin su mutación
ejecutada y anotada: `R18` (quitar un resultado del criterio), `R19` (quitar la restricción de
`resultado` del `WHERE`), `R28` (devolver el largo de la página como total) y `R40`/`R41` (quitar el
acotamiento por tienda de cada una de las dos lecturas). Las cinco se corren a mano, se revierten y
se dejan escritas en `progress/impl_344.md` **con su salida real**: en este repo hay un arnés de
mutaciones que reportó supervivientes sin haber ejecutado un solo test.
