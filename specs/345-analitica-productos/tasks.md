# Ficha 345 — Tasks

> Zona `fullstack`: **backend primero, frontend después** (B0–B5 antes que B6–B8).
> `[P]` = paralelizable con las tareas hermanas de su mismo bloque.
> Nadie corre la suite completa salvo el leader (`AGENTS.md § Regla del gate`).

---

## B0 — Antes de tocar nada

- [ ] **T0.1 — Confirmar en el ARCHIVO REAL los ocho símbolos sobre los que se construye.** [P]
  `AlcanceMetrica` / `RolAnalitica` / `ROLES_ANALITICA` en `lib/analytics/types.ts`;
  `ALCANCE_OPERATIVA` y `ALCANCE_FINANCIERA` en `lib/analytics/metrics.ts`;
  `conteoEntregasFiltroSchema`, `recortarFiltroConteoEntregas` y `ConsultaConteoEntregas` en
  `lib/analytics/entregas-conteo.ts`; `condicionesDeConsulta` en
  `lib/repositories/ConteoPorStatusRepository.ts`; `calcularEfectividad` en
  `app/(app)/analitica/_components/entregas/efectividad.ts`; `orden.producto` y `orden.tienda_id`
  en `db/schema.prisma`.
  **Hecho:** los ocho leídos EN DISCO (no en el grafo del MCP, que devuelve de más) y sus líneas
  anotadas en `progress/impl_345.md`. Si alguno no está donde el diseño supone, se para y se dice.

- [ ] **T0.2 — Medir el coste de la consulta viva contra producción, en SOLO LECTURA.**
  Correr el `SELECT … GROUP BY tienda, producto, desenlace` de `design.md §5.2` sin filtro de fecha
  y anotar: (a) cuántas FILAS devuelve, (b) cuántos milisegundos tarda, (c) el `EXPLAIN ANALYZE`.
  **Hecho:** los tres números en `progress/impl_345.md`. Es la medición que respalda la alternativa
  A1 descartada; sin ella, «la consulta viva es barata» es una opinión. **Si devuelve más filas que
  órdenes, el diseño está mal** y se para: el `GROUP BY` debería colapsarlas.

- [ ] **T0.3 — Fotografiar en verde los censos que esta ficha mueve.** [P]
  `tests/unit/analytics/alcance-fuente-unica.guardia.test.ts`,
  `tests/unit/analytics/alcance-obligatorio.guardia.test.ts`,
  `tests/unit/analytics/modulo-puro.guardia.test.ts`,
  `tests/unit/descarga/cobertura-tablas.guardia.test.ts`,
  `tests/unit/descarga/columnas-asercion-de-orden.guardia.test.ts`,
  `tests/unit/descarga/columnas-sensibles.guardia.test.ts`.
  **Hecho:** las seis verdes y anotados los números que la ficha va a mover
  (`TOTAL_ARCHIVOS_CON_DATATABLE` y `TOTAL_INSTANCIAS_DATATABLE`, que este spec leyó en **31**).
  Sin la foto no se distingue «el número que subí» de «el que ya estaba mal».

---

## B1 — El parser (backend) · depende de B0

- [ ] **T1.1 — `lib/analytics/producto-parse.ts`.**
  `parsearProducto(texto): readonly ItemProducto[]` con el algoritmo de `design.md §2.2` y las dos
  funciones de normalización (`limpiar`, `clave`). Sin imports. Sin reloj. Sin entorno.
  **Hecho:** `pnpm typecheck` verde y `tests/unit/analytics/modulo-puro.guardia.test.ts` sigue
  verde (barre el directorio entero: un import de infraestructura aquí lo pone rojo).

- [ ] **T1.2 — `tests/unit/analytics/producto-parse.test.ts`: las reglas.** · depende de T1.1
  Marcador vs punto vs barra; limpieza; clave; prefijo huérfano; ítem sin nombre; cantidad 0;
  cantidad no segura; totalidad (cadena vacía, sólo espacios, `"*"`, `"3 *"`, 10 000 caracteres);
  idempotencia (misma entrada ⇒ misma salida).
  **Hecho:** R10, R11, R16, R17, R19, R20, R21, R22 cubiertos y el archivo no importa nada del
  servidor.

- [ ] **T1.3 — `tests/unit/analytics/producto-parse-corpus.test.ts`: las CADENAS REALES.** · depende de T1.1
  Las cadenas de `design.md §2.4` escritas **literales**, incluidas las tres trampas y las tres de
  prueba. Tres aserciones que no pueden faltar:
  (a) `1 * Base Dr. 1 * BASE C.` ⇒ **exactamente 2** ítems, `["Base Dr", "BASE C"]`;
  (b) la cadena con barras ⇒ **1** ítem;
  (c) **ningún** nombre de todo el corpus contiene `*`.
  **Hecho:** R12, R13, R14, R15, R23 cubiertos, **y comprobado a mano que la regex con anticipación
  del contexto (`(\d+)\s*\*\s*(.+?)(?=\s*\d+\s*\*|$)`) pone (a) y (c) EN ROJO** — anotarlo en
  `progress/impl_345.md`. Un test que también pasaría con el parseo malo no prueba nada.

---

## B2 — Alcance y consulta preparada (backend) · depende de B1

- [ ] **T2.1 — `ALCANCE_PRODUCTOS` en `lib/analytics/metrics.ts`.**
  Exportada, `as const satisfies Readonly<Record<RolAnalitica, AlcanceMetrica>>`, junto a las otras
  dos tablas. **Va ahí y no en la vertical**: el censo de `alcance-fuente-unica.guardia` prohíbe el
  dato fuera de ese archivo (`design.md §3`).
  **Hecho:** borrar una fila de la tabla **rompe el build** (comprobado y revertido), y
  `alcance-fuente-unica.guardia.test.ts` sigue verde. `METRICAS.length` sigue siendo 25.

- [ ] **T2.2 — `lib/analytics/productos-consulta.ts`: alcance, tipo opaco y clave.** · depende de T2.1
  `resolverAlcanceProductos(actor)` (switch exhaustivo, falla cerrado, reusa `esRolAnalitica` y
  `rolTieneAccesoTotal`); `ConsultaProductos` con marca `unique symbol`;
  `prepararConsultaProductos(raw, actor, now)` con los cuatro pasos en orden;
  `claveDeConteoProductos` y `TAG_CONTEO_PRODUCTOS` con prefijo propio.
  **Hecho:** el único `as ConsultaProductos` del repo está al final de `preparar…`; el módulo no
  declara ninguna lista de roles ni ninguna tabla de alcance propia.

- [ ] **T2.3 — `RecorteDeOrdenes` en `entregas-conteo.ts` y el parámetro de `condicionesDeConsulta`.** · depende de T2.2
  Se declara el tipo estructural y se ensancha el parámetro de `condicionesDeConsulta` en
  `ConteoPorStatusRepository`. **No se mueve la función** ni se toca su cuerpo.
  **Hecho:** `tests/unit/analytics/conteo-por-status-sql.test.ts` pasa **sin tocar una línea** —ésa
  es la prueba de que el ensanche no cambió comportamiento— y `alcance-obligatorio.guardia` sigue
  verde.

- [ ] **T2.4 — `TIPOS_OPACOS` admite `ConsultaProductos`.** · depende de T2.2
  Una entrada en `tests/unit/analytics/alcance-obligatorio.guardia.test.ts:120`, con el comentario
  que diga por qué cumple el criterio declarado (marca `unique symbol`).
  **Hecho:** el guardia sigue detectando sus tres fixtures (legítimo / infractor / forjador), y se
  comprueba que un repositorio que forje `as unknown as ConsultaProductos` **cae**.

- [ ] **T2.5 — `tests/unit/analytics/productos-alcance.test.ts` y `productos-consulta.test.ts`.** · depende de T2.2 [P]
  Los cinco roles; el rol inventado; el actor `null`/`{}`/rol numérico; el conjunto `total`
  comparado contra `esAccesoTotal`; clave desconocida en el filtro; tienda ajena en el filtro;
  rango inválido; ausencia de rango ⇒ sin condición de fecha.
  **Hecho:** R1–R4, R6, R7, R8 cubiertos y **ninguna entrada hace lanzar** a las dos funciones.

---

## B3 — El repositorio (backend) · depende de B2

- [ ] **T3.1 — `IConteoProductosRepository` + `ConteoProductosRepository`.**
  El SQL de `design.md §5.2`, con `Prisma.join(condicionesDeConsulta(consulta), " AND ")`. El
  repositorio **no parsea**: devuelve el texto crudo.
  **Hecho:** el archivo no contiene ningún `as unknown as`, ni ninguna condición de `where` escrita
  a mano, ni un segundo `LATERAL` distinto del de `ConteoPorStatusRepository`.

- [ ] **T3.2 — `tests/unit/analytics/conteo-productos-sql.test.ts`.** · depende de T3.1 [P]
  Que el array de condiciones sea **idéntico** al de `condicionesDeConsulta(consulta)` para las
  mismas entradas (faceta por faceta, incluido el alcance como PRIMERA condición); que el SQL
  contenga `deleted_at`, el `LATERAL`, el `COALESCE` y el `GROUP BY` por los cuatro campos.
  **Hecho:** R55, R56 cubiertos; una permutación del `where` deja el test rojo.

- [ ] **T3.3 — `tests/integration/repositories/conteo-productos.int.test.ts` (Postgres REAL).** · depende de T3.1
  Con datos sembrados: (a) dos tiendas con el MISMO texto de producto ⇒ **dos** filas; (b) N
  órdenes con el mismo texto ⇒ **una** fila con `n = N`; (c) una orden borrada no cuenta; (d) un
  `adminTienda` no ve ni una fila de la otra tienda; (e) una orden con dos gestiones, la última
  vigente manda.
  **Hecho:** R27, R39, R54, R57 cubiertos **contra la base**, y comprobado que **mutar el `WHERE`
  del alcance deja el test rojo** (anotarlo). Los tests de servicio usan dobles y no ven el SQL:
  ésta es la única prueba que mira el recorte donde vive.

---

## B4 — El servicio (backend) · depende de B3

- [ ] **T4.1 — `lib/types/conteo-productos.ts`: DTO y resultado.** [P]
  `FilaProductoDTO`, `ConteoProductosDTO`, `ResultadoConteoProductos`. `porStatus` tipado con
  `ConteoDeStatus` de `lib/types/conteo-por-status.ts`.
  **Hecho:** el módulo no importa Prisma, ni zod, ni React.

- [ ] **T4.2 — `ConteoProductosService`: parseo, fusión, caché y sello.** · depende de T4.1
  Memoización del parseo por texto; deduplicación por clave dentro de la orden; acumulación de
  `unidades`, `ordenes` y `porStatus`; `ordenes` y `ordenesSinProducto` del universo; forma visible
  determinista; orden de filas de cuatro criterios; `cache.envolver` con clave y tag propios y
  `lastSync` **dentro** del productor.
  **Hecho:** el servicio no contiene ningún literal de estado del catálogo, ninguna aritmética
  decimal y ningún `parseFloat`/`Number(` sobre cantidades.

- [ ] **T4.3 — `tests/unit/analytics/conteo-productos-servicio.test.ts`.** · depende de T4.2
  Unidades y órdenes; el mismo producto dos veces en una orden; multiproducto contando en los dos;
  órdenes sin producto; dos tiendas con el mismo texto; empates de orden; forma visible entre dos
  variantes; sin filas en cero; clave de caché con prefijo propio distinta de las otras seis.
  **Hecho:** R18, R24, R25, R26, R31, R33, R34, R35, R37, R38, R58 cubiertos, con dobles del
  repositorio y de la caché (`tests/unit/analytics/_cache-falsa.ts`).

---

## B5 — El borde (backend) · depende de B4

- [ ] **T5.1 — `lib/actions/conteo-productos.ts`.**
  Copia estructural de `conteo-por-status.ts`: actor → `prepararConsultaProductos` →
  `validation_error` sin auditar → `forbidden` auditado con `describirDenegado` e id de auditoría
  **propio** (`conteo_productos`) → `ok`.
  **Hecho:** el archivo no resuelve alcance por su cuenta ni escribe ningún literal de rol.

- [ ] **T5.2 — `TAG_CONTEO_PRODUCTOS` en `TAGS_ANALITICA`.** · depende de T2.2 [P]
  En `lib/actions/analitica-refrescar.ts`, importando la constante, nunca el literal.
  **Hecho:** existe un test que afirma que `TAGS_ANALITICA` contiene el tag y que el número de tags
  subió en uno.

- [ ] **T5.3 — `tests/unit/analytics/conteo-productos-action.test.ts`.** · depende de T5.1
  Entrada inválida ⇒ ni repositorio ni resolución de alcance (espía); `adminSatelite` y `mensajero`
  ⇒ `forbidden` **sin tocar el repositorio**; `sin_sesion` ⇒ `unauthenticated`; el log lleva el
  motivo y **no** lleva ids ajenos ni el filtro con PII; la respuesta **no** dice el motivo.
  **Hecho:** R4, R9, R53 cubiertos.

---

## B6 — La efectividad compartida (frontend) · depende de B5

- [ ] **T6.1 — `efectividad.ts` gana `rechazadas` y `tasaRechazo`.**
  Dos campos derivados de lo que la función YA cuenta. `tasaRechazo` es `null` con universo vacío,
  por el mismo motivo que sus dos hermanas.
  **Hecho:** `KpisEfectividad` no cambia ni una tarjeta y `tests/components/KpisEfectividad.test.tsx`
  pasa sin tocarse. Si hubiera un `toEqual` literal sobre el objeto entero, se actualiza **a mano** y
  se dice en el commit.

- [ ] **T6.2 — `tests/unit/analytics/efectividad-rechazo.test.ts`.** · depende de T6.1
  El denominador incluye las órdenes en proceso; `null` con universo vacío; la suma
  `entregadas + rechazadas + …` no se reinventa; el caso medido `Spray Protector` (6 de 16 ⇒ 0,375)
  y `Bálsamo Tensor` (0 de 29 ⇒ 0, **no** `null`).
  **Hecho:** R29, R30 cubiertos, con las cifras de la medición de producción como casos.

---

## B7 — La pantalla (frontend) · depende de B6

- [ ] **T7.1 — `productos-swr.ts`: clave y fetcher.** [P]
  `[CLAVE_TABLERO, "conteo-productos", filtroSerializado]`, importando `CLAVE_TABLERO` y sin
  reescribirlo.
  **Hecho:** la clave lleva el filtro (cambiarlo cambia la clave) y comparte prefijo con el resto
  del tablero.

- [ ] **T7.2 — `ProductosTabla.tsx`.** · depende de T7.1
  `<DataTable>` paginado; columnas de `design.md §7.3`; «Tienda» sólo con más de una tienda en la
  respuesta; efectividad y rechazo por `calcularEfectividad(fila.porStatus)`; estados cargando /
  error / prohibido / sesión no válida / vacío; el rótulo de multiproducto con el total del recorte
  y las órdenes sin producto.
  **Hecho:** el componente **no** calcula ningún porcentaje por su cuenta y no escribe ningún
  literal de estado del catálogo.

- [ ] **T7.3 — `page.tsx` monta la sección.** · depende de T7.2
  Dentro del `FiltroEntregasProvider`, como `SeccionFiltrable` hermana de la de entregas. Se monta
  si `ALCANCE_PRODUCTOS[rol] !== "prohibido"`; si no, **no se renderiza nada**.
  **Hecho:** la página no escribe ningún literal de rol y sigue cumpliendo el censo de R24 de la 129
  (no importa capas de acceso a datos). `AnaliticaPage.length === 0` sigue siendo cierto.

- [ ] **T7.4 — `tests/components/ProductosTabla.test.tsx` y ampliación de `AnaliticaPage.test.tsx`.** · depende de T7.3
  Filtro que cambia ⇒ nueva consulta; los cuatro estados; paginación; la columna Tienda que aparece
  y desaparece; el rótulo de multiproducto; la efectividad pintada == la que devuelve
  `calcularEfectividad`; y en la página: `adminSatelite` **no** ve la sección, `adminTienda` sí.
  **Hecho:** R5, R28, R32, R36, R40, R41, R43, R44, R45, R46 cubiertos.

- [ ] **T7.5 — El tag entra en el botón «Actualizar».** · depende de T5.2 [P]
  **Hecho:** R42 cubierto: existe un test que afirma que pulsar «Actualizar» invalida también el
  tag de productos y revalida la clave SWR por prefijo.

---

## B8 — La descarga y sus censos (frontend) · depende de B7

- [ ] **T8.1 — `analitica-productos-descarga-columnas.ts`.**
  Las nueve columnas de `design.md §7.4` y la proyección de una fila del DTO. Sin uuid, sin correo,
  sin teléfono. Porcentajes en puntos con un decimal; `null` ⇒ celda vacía.
  **Hecho:** el nombre del archivo respeta la convención `*-descarga-columnas.ts` (si no, el censo
  de columnas sensibles no lo ve) y el módulo no importa servicio, repositorio ni Prisma.

- [ ] **T8.2 — `tests/unit/descarga/analitica-productos-descarga-columnas.test.ts`.** · depende de T8.1
  Dos `toEqual` con el esperado **escrito a mano** (claves y encabezados), nunca
  `COLUMNAS.map(...)` a los dos lados. Más el caso de `null` ⇒ celda vacía y el de redondeo.
  **Hecho:** R48, R51 cubiertos y `columnas-asercion-de-orden.guardia.test.ts` reconoce la aserción.

- [ ] **T8.3 — Cablear `descarga` en el `DataTable` y registrar la tabla.** · depende de T8.2
  `obtenerFilas` proyecta el DTO en memoria (sin segunda consulta); entrada nueva en
  `tests/unit/descarga/censo-tablas.ts` con estado `con_descarga`; `TOTAL_ARCHIVOS_CON_DATATABLE` y
  `TOTAL_INSTANCIAS_DATATABLE` **de 31 a 32** (o desde los números que midiera T0.3, que mandan).
  **Hecho:** `cobertura-tablas.guardia` y `columnas-sensibles.guardia` verdes, con el número de
  partida y el de llegada anotados en el commit.

- [ ] **T8.4 — `tests/components/descarga/ProductosDescarga.test.tsx`.** · depende de T8.3
  La descarga sale de las filas en pantalla (la acción **no** se vuelve a llamar); el archivo lleva
  la columna Tienda aunque la tabla la haya ocultado.
  **Hecho:** R47, R50, R52 cubiertos.

---

## B9 — Cierre

- [ ] **T9.1 — Trazabilidad completa.** Rellenar el mapa `R<n> → test` de abajo en
  `progress/impl_345.md` con el **nombre exacto** del caso, no sólo el archivo.
  **Hecho:** los 58 requisitos con un caso que existe y se ejecuta. Un `R` sin test es un fallo de
  la feature (`docs/specs.md § Trazabilidad`).

- [ ] **T9.2 — Ver la app, no sólo la suite.** Entrar como maestro y como `adminTienda`, cambiar el
  filtro, descargar el archivo y abrirlo. Mirar a 390 px.
  **Hecho:** capturas o notas en `progress/impl_345.md`. La suite no ve un texto roto ni una tabla
  que se sale de la pantalla.

- [ ] **T9.3 — Gate.** `./init.sh --rapido` (lo corre el leader, nunca en paralelo con el subagente
  que muta el árbol).
  **Hecho:** verde, o los rojos identificados como heredados **contra el baseline**, no supuestos.

---

## Trazabilidad `R<n>` → test

| R | Test |
| --- | --- |
| R1 | `productos-alcance.test.ts` › la tabla cubre los cinco roles + **T2.1** (borrar una fila rompe el build) |
| R2 | `productos-alcance.test.ts` › maestro y admin resuelven `global` |
| R3 | `productos-alcance.test.ts` › adminTienda resuelve `tienda` con su propio `usuarioId` |
| R4 | `productos-alcance.test.ts` › adminSatelite y mensajero denegados · `conteo-productos-action.test.ts` › forbidden sin tocar el repositorio |
| R5 | `AnaliticaPage.test.tsx` › adminSatelite no ve la sección de productos |
| R6 | `productos-alcance.test.ts` › los roles `total` son exactamente `esAccesoTotal` |
| R7 | `productos-consulta.test.ts` › tienda ajena en el filtro ⇒ `filtro_fuera_de_alcance` |
| R8 | `productos-consulta.test.ts` › clave desconocida ⇒ `validation_error` |
| R9 | `conteo-productos-action.test.ts` › audita el motivo y no lo revela |
| R10 | `producto-parse.test.ts` › devuelve ítems con cantidad y nombre |
| R11 | `producto-parse.test.ts` › parte por el marcador, no por el punto |
| R12 | `producto-parse-corpus.test.ts` › `1 * Base Dr. 1 * BASE C.` da exactamente 2 |
| R13 | `producto-parse-corpus.test.ts` › las barras no parten |
| R14 | `producto-parse-corpus.test.ts` › ningún nombre contiene `*` |
| R15 | `producto-parse-corpus.test.ts` › las tres cadenas de prueba dan 1 ítem de cantidad 1 |
| R16 | `producto-parse.test.ts` › limpia espacios y puntos finales |
| R17 | `producto-parse.test.ts` › misma clave para variantes de caja/espacios/punto |
| R18 | `conteo-productos-servicio.test.ts` › forma visible determinista entre variantes |
| R19 | `producto-parse.test.ts` › el prefijo huérfano produce su ítem |
| R20 | `producto-parse.test.ts` › vacío ⇒ `[]` · `conteo-productos-servicio.test.ts` › cuenta `ordenesSinProducto` |
| R21 | `producto-parse.test.ts` › `0 *` y cifras no seguras no son marcador |
| R22 | `producto-parse.test.ts` › total e idempotente |
| R23 | `producto-parse-corpus.test.ts` › la tabla de casos reales (+ nota de T1.3: la regex mala la pone roja) |
| R24 | `conteo-productos-servicio.test.ts` › unidades |
| R25 | `conteo-productos-servicio.test.ts` › órdenes |
| R26 | `conteo-productos-servicio.test.ts` › el mismo producto dos veces en una orden |
| R27 | `conteo-productos-sql.test.ts` › el LATERAL y el COALESCE · `conteo-productos.int.test.ts` › la última gestión vigente manda |
| R28 | `ProductosTabla.test.tsx` › la fila pinta lo que devuelve `calcularEfectividad` |
| R29 | `efectividad-rechazo.test.ts` › el denominador incluye las órdenes en proceso |
| R30 | `efectividad-rechazo.test.ts` › entregadas, rechazadas y tasa |
| R31 | `conteo-productos-servicio.test.ts` › no emite filas en cero |
| R32 | `ProductosTabla.test.tsx` › estado vacío explícito |
| R33 | `conteo-productos-servicio.test.ts` › orden determinista con empates |
| R34 | `conteo-productos-servicio.test.ts` › unidades y órdenes son enteros; sin decimales ni dinero |
| R35 | `conteo-productos-servicio.test.ts` › `ordenes` y `ordenesSinProducto` |
| R36 | `ProductosTabla.test.tsx` › pinta el aviso de multiproducto |
| R37 | `conteo-productos-servicio.test.ts` › dos tiendas con el mismo texto son dos filas |
| R38 | `conteo-productos-servicio.test.ts` › la fila lleva el nombre de la tienda |
| R39 | `conteo-productos.int.test.ts` › no funde dos tiendas |
| R40 | `ProductosTabla.test.tsx` › la clave lleva el filtro del proveedor |
| R41 | `ProductosTabla.test.tsx` › cambiar el filtro vuelve a consultar |
| R42 | `analitica-refrescar` › `TAGS_ANALITICA` incluye el tag de productos · `ActualizarAnalitica.test.tsx` |
| R43 | `ProductosTabla.test.tsx` › estado de carga sin ceros |
| R44 | `ProductosTabla.test.tsx` › error / prohibido / sesión no válida |
| R45 | `ProductosTabla.test.tsx` › pagina |
| R46 | `ProductosTabla.test.tsx` › columnas y la de Tienda condicional |
| R47 | `ProductosDescarga.test.tsx` › monta el control y descarga |
| R48 | `analitica-productos-descarga-columnas.test.ts` › orden y encabezados literales |
| R49 | `columnas-sensibles.guardia.test.ts` (existente) + el test de orden |
| R50 | `ProductosDescarga.test.tsx` › el archivo lleva Tienda con la columna oculta |
| R51 | `analitica-productos-descarga-columnas.test.ts` › `null` ⇒ celda vacía |
| R52 | `ProductosDescarga.test.tsx` › `obtenerFilas` no vuelve a llamar a la acción |
| R53 | `conteo-productos-action.test.ts` › entrada inválida: ni base ni alcance |
| R54 | `conteo-productos.int.test.ts` › el recorte por rol contra Postgres (mutación ⇒ rojo) |
| R55 | `conteo-productos-sql.test.ts` › `deleted_at IS NULL` · `conteo-productos.int.test.ts` › la borrada no cuenta |
| R56 | `conteo-productos-sql.test.ts` › las condiciones son idénticas a `condicionesDeConsulta` |
| R57 | `conteo-productos.int.test.ts` › N órdenes con el mismo texto ⇒ una fila |
| R58 | `conteo-productos-servicio.test.ts` › clave con prefijo propio, sin colisión |
