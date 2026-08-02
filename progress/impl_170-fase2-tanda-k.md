# impl — Feature 170, FASE 2, Tanda K (T K.1 y T K.2: backend de la bodega satelite)

**Rama:** `feature/170-fase2-tanda-k` · **Fecha:** 2026-08-01 · **Rol:** `backend_dev`
**Alcance:** SOLO servidor. **Cero UI**: no se toco `app/**` ni `components/**`. T K.3 es de
otro agente y su traspaso esta en §9.

Todo lo que sigue esta MEDIDO. Las diez mutaciones se ejecutaron y se revirtieron.

---

## 0. Baseline medido AL EMPEZAR

```
$ git branch --show-current
feature/170-fase2-tanda-k        (rama ya creada; no se hizo checkout de ninguna otra)
$ git status --short
(limpio)
$ npx tsc --noEmit
=== typecheck exit: 0 ===
$ npx eslint
✖ 23 problems (0 errors, 23 warnings)
suite (baseline tanda J): 741 archivos / 8908 tests
```

---

## 1. EL CAMBIO DE USO (lo que el humano cambio por no verificar en pantalla)

El humano renuncio a la verificacion en pantalla (Q4) a cambio de que el PR describa el
cambio. Esto es lo que el `adminSatelite` hace HOY y lo que hara DESPUES, en la seccion
«Órdenes de la bodega»:

| | ANTES (hoy en `dev`) | DESPUES (con K.1+K.2+K.3) |
| --- | --- | --- |
| **Filas que recibe el navegador** | TODAS las de su zona en los cinco estados | una pagina (25 por defecto, `RECEPCION_SATELITE_*_PAGE_SIZE`) |
| **Filtrar por estado/cantón/distrito** | filtra el conjunto entero, en el navegador | filtra el conjunto entero, **en el servidor**; la pagina se recalcula |
| **Qué significa el contador** | `X de Y órdenes`, ambos del conjunto | el total sigue siendo el del CONJUNTO filtrado (lo devuelve el servidor) |
| **Opciones de los desplegables** | las de las filas cargadas | las del **conjunto** del actor, por una accion propia |
| **Orden de las filas** | los cinco grupos concatenados; dentro de cada uno, prioritarias primero y luego recientes | **el mismo**, ahora impuesto en el `ORDER BY` |
| **Recorrer la lista** | scroll continuo | control de paginas (T K.3) |
| **«Seleccionar todo»** | marca todas las filas visibles tras filtrar (= el conjunto) | marcara las de la **pagina visible** — R47, y es **trabajo de T K.3** |
| **Qué acciones de lote se ofrecen** | se decide mirando el conjunto (`hayEstado`) | pasara a decidirse sobre lo SELECCIONADO — R48, **trabajo de T K.3** |
| **Descargar** | el conjunto filtrado, ya en el cliente | debe seguir siendo el conjunto — R52, **trabajo de T K.3** |

**Lo que un operador notara el primer dia:** la tabla ya no es infinita y aparece un control
de paginas; «seleccionar todo» deja de significar «todas mis órdenes» y pasa a significar
«las de esta página». Filtrar sigue funcionando igual —y a partir de ahora seguira
funcionando con la tabla paginada, que es justo lo que se rompia si no se hacia esta tanda—.

**Lo que NO cambia:** el alcance (su zona y solo su zona), el orden de las filas, las
etiquetas de los filtros, el detalle de cada fila, los intentos de entrega, el resalte de
prioritarias y las cuatro transiciones por lote.

---

## 2. Que se entrega

| # | Pieza | Donde | Cubre |
| --- | --- | --- | --- |
| 1 | Secuencia canonica de los 5 estados + lista blanca | `lib/utils/estados-bodega-satelite.ts` (NUEVO) | R44, R51 |
| 2 | `findRecepcionSatelitePaginada(filtro, rango)` | `OrdenRepository` | R40, R41, R44, R45, R51 |
| 3 | `findRecepcionSateliteGeoByZona(zonaId, estados)` | `OrdenRepository` | R44, R46 |
| 4 | `listarOrdenesBodegaPaginado(input, actor)` | `RecepcionSateliteService` | R40, R41, R44, R45, R51 |
| 5 | `obtenerCatalogoFiltros(actor)` | `RecepcionSateliteService` | R44, R46 |
| 6 | `listarOrdenesBodegaPaginadoSchema` (`.strict()` + `z.enum`) | `lib/types/recepcion-satelite.ts` | R40, R44 |
| 7 | Server Actions `listarOrdenesBodegaPaginado` / `obtenerCatalogoFiltrosSatelite` | `lib/actions/recepcion-satelite.ts` | borde |

`listar()` **queda intacto**: sigue entregando los cinco grupos, `zonaNombre` y `sinZona`.
La pantalla lo necesita para «Por recibir» y para la cabecera, y ademas es la referencia
contra la que se mide el paginado (§4). Retirar sus arrays es trabajo de T K.3 + tanda M
(§10, Q-K4).

---

## 3. Los tres filtros: por que van por NOMBRE y no por id

El filtro de cliente compara **nombres** (`normalizeName(orden.cantonNombre)` contra los
valores elegidos), y los valores que ofrece el desplegable salen de las propias ordenes
(`derivarCantones(ordenes)` → `value = orden.cantonNombre`). Se conserva esa via, y no la de
la 144 (que filtra `/ordenes` por `cantonId`), por tres razones:

1. **R45 se vuelve literal.** «Para los mismos valores de filtro» significa exactamente los
   mismos strings: el test compara los dos caminos sin traducir nada por el medio.
2. **T K.3 cambia de ORIGEN, no de contrato.** El catalogo devuelve `{ value, label }` y
   `{ value, label, parentValue }`, que es lo que `construirFiltrosSatelite` ya produce.
3. **Los homonimos se conservan tal cual.** Con dos cantones «Central» (distinta provincia),
   el filtro de hoy muestra los dos; con ids mostraria uno. Sea o no deseable, **cambiarlo no
   es de esta tanda**.

**El unico hueco, declarado:** el SQL compara por igualdad EXACTA del nombre y el cliente
comparaba normalizado (sin acentos, sin caso). Los dos coinciden para todo valor que el
desplegable puede ofrecer —ese valor sale de la misma columna—, salvo que el catalogo de
geografia tuviera dos filas que normalizan igual y se escriben distinto. **Medido: no las
tiene** (84 cantones y 491 distritos del seed, cero colisiones), y hay un test que lo vigila
sobre el propio SQL del seed. Ademas el hueco es asimetrico: la comparacion exacta solo puede
devolver MENOS filas, nunca mas — R44 no corre riesgo por esta via. Ver Q-K1.

---

## 4. R51: el orden que nadie declaraba, y por que obligo a `Prisma.sql`

El orden que el usuario ve **no lo declara ningun `orderBy`**. Sale de que
`RecepcionSateliteModule` CONCATENA los cinco grupos que el servicio parte
(`[...recibidas, ...asignadas, ...porDevolver, ...enTransitoACentral, ...devueltas]`), y
dentro de cada grupo manda el `orderBy: [prioridad desc, createdAt desc]` del repositorio
(feature 33/R7). O sea: **rango de grupo, luego prioridad, luego recencia**.

Mientras la pantalla recibia el conjunto entero eso era gratis. Con `LIMIT`, la secuencia de
grupos tiene que estar en el `ORDER BY` de la consulta que recorta o las filas cambian de
pagina y de orden. Y **Prisma no sabe ordenar por una secuencia arbitraria de valores de una
relacion**: solo `asc`/`desc`, y la secuencia que hace falta no es alfabetica en ningun
sentido (`en_bodega_satelite`, `por_recoger`, `por_devolver`,
`devolviendo_a_bodega_central`, `devuelta`).

Se evaluaron y descartaron, en este orden:

| Alternativa | Por que se descarto |
| --- | --- |
| Ordenar solo por `prioridad, createdAt` y **declarar desviacion de R51** | Es un cambio VISIBLE en la pantalla de riesgo alto, sin verificacion en pantalla. Hoy toda «Recibida» va antes que toda «Devuelta»; con recencia global se mezclan. |
| `orderBy: { estatus: { value: asc } }` | El orden alfabetico de los cinco values no es el del flujo, ni al derecho ni al reves. |
| Columna de rango en `order_status` | Migracion sobre un catalogo compartido para un orden que es de ESTA pantalla; ademas el rango global del flujo pondria `devuelta` antes que `por_devolver`, que no es lo que se ve. |
| Una consulta por grupo + `groupBy` para los conteos | Hasta 6 consultas por render, y el `groupBy` de Prisma no puede agrupar por el `value` de la relacion (haria falta una lectura mas del catalogo de estados). Contra R54. |

Lo que se hizo: **una sola consulta cruda, parametrizada, que devuelve los `id` de la
pagina** ordenados con `array_position(ARRAY[...]::text[], os."value")` por delante de
`prioridad DESC, created_at DESC, id ASC`, y **la hidratacion con la MISMA proyeccion Prisma
de siempre** (`WITH_RECEPCION_SATELITE` + `toRecepcionSateliteRow`). Reescribir esa
proyeccion en SQL habria duplicado quince columnas y sus conversiones (Decimal, nombres de
relacion) para que divergieran a la primera.

Es el mismo escape que ya usa `ChatConversacionRepository` cuando Prisma no puede normalizar
en el WHERE. **Sin interpolacion de texto**: todo va por `Prisma.sql` / `Prisma.join`.

`id ASC` es un desempate NUEVO y deliberado (precedente: la desviacion de T I.1 en saldos):
con `created_at` empatado, sin desempate total dos paginas pueden solaparse o perder una fila.
No es observable salvo en empates exactos.

### 4.1 Verificado contra un Postgres de verdad

El SQL no se dio por bueno leyendolo. Se ejecuto contra la base local (`localhost/ordenex`, 67
ordenes) antes de escribir los tests:

- recorrido paginado (`pageSize` 2) vs. conjunto de `findRecepcionSateliteByZona` particionado
  y concatenado: **MISMO ORDEN, mismas 5 filas**;
- pagina mas alla del final: `items: []` y **`total: 5`** (la rama de conteo aparte);
- filtro de canton y de estado: todas las filas del canton/estado pedido, cero fugas;
- canton/distrito inexistente: 0;
- `findRecepcionSateliteGeoByZona`: 7 pares distintos.

El script era de scratch y NO se commitea; lo que queda commiteado es el test de SQL (§6).

---

## 5. R41: el total no puede mirar otro conjunto

El total viaja **dentro de la misma consulta** (`(COUNT(*) OVER ())::int`). No es una
optimizacion: es que asi la pagina y el conteo **no pueden** resolverse contra `WHERE`
distintos — la divergencia que R41 y R44 prohiben y que T I.1 tuvo que vigilar con un test
(«el mismo where en `findMany` y en `count`»). Aqui es estructural.

La UNICA rama con un conteo aparte es la **pagina vacia** (mas alla del final), donde la
ventana no devuelve fila alguna de la que leer el total. Esa rama reusa **literalmente** el
mismo fragmento `FROM ... WHERE`, y el test lo compara texto contra texto.

---

## 6. Donde se prueba cada cosa, y por que hay un test de SQL

**Aviso MEDIDO por tercera vez.** Los tests de servicio usan un DOBLE del repositorio: ven
que el servicio pase el alcance correcto, jamas que ese alcance se traduzca a SQL. En la
tanda I una mutacion del `WHERE` paso verde; en la J, dos mas. En esta tanda **tres
mutaciones del SQL dejaron los 13 tests de servicio en verde** (mutaciones 6, 7 y 9 de §7) y
solo `tests/unit/repositories/satelite-paginado-where.test.ts` las detuvo. Una de ellas —el
`JOIN` de distrito en vez de `LEFT JOIN`— habria hecho desaparecer del listado toda orden sin
distrito, sin un solo error.

| Archivo | Que prueba |
| --- | --- |
| `tests/unit/services/recepcion-satelite-paginado.test.ts` (13) | equivalencia con el filtro de cliente, acotamiento por actor, pagina/total, orden |
| `tests/unit/repositories/satelite-paginado-where.test.ts` (11) | el SQL: acotamiento, los tres filtros, el `LEFT JOIN`, el `ORDER BY`, el conteo, el numero de consultas |
| `tests/unit/actions/satelite-catalogos.test.ts` (8) | el catalogo: conjunto vs. pagina, acotamiento por rol y zona |
| `tests/unit/actions/recepcion-satelite-action.test.ts` (+7) | la lista blanca del borde |

El test de R45 compara **64 combinaciones** de los tres desplegables, no un caso feliz: para
cada una, el recorrido completo del paginado contra `filtroDeCliente(conjunto de la
pantalla)`. El filtro de cliente esta **copiado literalmente** de `SateliteOrdenesListado.tsx`
(`visibles`, :129-154) porque vive dentro de un `useMemo` y no hay nada que importar; el
doble del repositorio, en cambio, implementa la semantica de la BASE (igualdad exacta, `NULL
IN (...)` que no casa) para que la comparacion no sea el codigo midiendose a si mismo. Se
afirma ademas que **al menos 40 de las 64 devuelven filas**: si el filtro de servidor
devolviera siempre vacio, el bucle pasaria entero comparando `[]` con `[]`.

---

## 7. Las diez mutaciones, con su salida real

**Todas revertidas** (`git status` limpio, sin marcadores propios; suite completa verde
despues).

| # | Mutacion | Resultado medido |
| --- | --- | --- |
| 1 | **R45**: el servicio ignora el filtro de estado (`estatusValues` siempre los cinco) | **ROJO (4)**: R45 (64 combos), la lista blanca, el total por filtros y el orden de un grupo |
| 2 | **R44**: interseccion vacia de estados cae a «todos» | **ROJO (1)**: `el filtro de estado no saca del listado las órdenes que nunca estuvieron en él (R44)` |
| 3 | **R44**: el servicio pasa una zona fija `"z-b"` en vez de la del actor | **ROJO (11)** en los dos archivos de servicio y catalogo |
| 4 | **R44 borde**: se quita el `.strict()` final del schema | **VERDE (56)** — y es un HALLAZGO: `.extend()` HEREDA el `.strict()` de `paginaInputSchema`, asi que esa llamada es redundante. Documentado en el propio schema. |
| 4b | **R44 borde**: `.passthrough()` (borde de verdad permisivo) | **ROJO (1)**: `una clave de ALCANCE colada muere en el borde, sin llegar al service (R44)` |
| 5 | **R46**: el catalogo se deriva de la PAGINA visible (3 filas) | **ROJO (2)**: `ofrece todas las opciones del conjunto del actor…` y `no ofrece opciones de zonas ajenas al actor` |
| 6 | **R51 en SQL**: se quita `array_position` del `ORDER BY` | Servicio: **VERDE (13)** · SQL: **ROJO (2)** |
| 7 | **R44 en SQL**: se quita `o."zona_id" = ?` del `WHERE` | Servicio: **VERDE (13)** · SQL: **ROJO (2)** |
| 8 | **R41**: `total: rows.length` | **ROJO (3)**: R45, pagina/total y total por filtros |
| 9 | **R45 en SQL**: `LEFT JOIN "distrito"` → `JOIN` | Servicio: **VERDE (13)** · SQL: **ROJO (1)** |
| 10 | La consulta que hidrata pierde `zonaId`/`deletedAt` | **ROJO (1)**: `la consulta que hidrata repite el acotamiento…` |

Las tres que el encargo exigia son la **1/8** (R45: filtro de servidor que no reproduce el de
cliente), la **3/4b/7** (R44: alcance de zona) y la **5** (R46: catalogo derivado de la
pagina). Las 6, 7 y 9 son la demostracion, medida en esta tanda, del aviso de las tandas I y
J.

---

## 8. Mapa `R<n> → archivo::test`

Prefijos: `S/` = `tests/unit/services/recepcion-satelite-paginado.test.ts`,
`Q/` = `tests/unit/repositories/satelite-paginado-where.test.ts`,
`C/` = `tests/unit/actions/satelite-catalogos.test.ts`,
`B/` = `tests/unit/actions/recepcion-satelite-action.test.ts`.

| R | Test |
| --- | --- |
| **R40** | `S/::devuelve la página pedida y el total del conjunto (R40, R41)` |
| **R40** | `S/::acota el tamaño de página al máximo configurado y nunca lo excede (R40)` |
| **R40** | `S/::una fila no se repite entre páginas ni se cae entre dos (R40, R51)` |
| **R40** | `Q/::el orden lleva el rango de GRUPO delante de la prioridad y la recencia (R51)` (afirma `LIMIT ? OFFSET ?` y sus valores) |
| **R40** | `B/::input vacio vale: es lo que pide la pagina 1, con los defaults del dominio (R40)` |
| **R40** | `B/::un pageSize desmedido se RECORTA al maximo, no se rechaza (R40)` |
| **R41** | `S/::devuelve la página pedida y el total del conjunto (R40, R41)` (en la ultima pagina `total !== items.length`) |
| **R41** | `S/::el total responde a los filtros, no al conjunto entero (R41)` |
| **R41** | `Q/::el conteo mira EXACTAMENTE el mismo conjunto que la página (R41)` |
| **R41** | `Q/::en la página con filas el total viaja DENTRO de la misma consulta, sin un conteo aparte` |
| **R44** | `S/::el filtro no amplía el alcance de zona del actor (R44)` — «Escazú» en las dos zonas, en los dos sentidos |
| **R44** | `S/::el filtro de estado no saca del listado las órdenes que nunca estuvieron en él (R44)` |
| **R44** | `S/::CONTRAPRUEBA de R44: forbidden sin filas ni total a todo rol que no sea adminSatelite` |
| **R44** | `S/::el adminSatelite SIN zona recibe una página vacía y no consulta la base (R44)` |
| **R44** | `Q/::el acotamiento por zona del actor y las borradas van SIEMPRE en el where` |
| **R44** | `Q/::la consulta que hidrata repite el acotamiento y respeta el orden de la que ordenó` |
| **R44** | `C/::no ofrece opciones de zonas ajenas al actor (R44)` |
| **R44** | `C/::el catálogo no ofrece la geografía de órdenes que este listado no muestra (R44)` |
| **R44** | `C/::un rol ajeno al módulo obtiene forbidden sin catálogo y sin tocar la base (R44)` |
| **R44** | `C/::la lista blanca del servidor y el desplegable de estado declaran los mismos cinco, en el mismo orden` |
| **R44** | `B/::una clave de ALCANCE colada muere en el borde, sin llegar al service (R44)` |
| **R44** | `B/::un estado fuera de los cinco del listado muere en el borde (R44)` |
| **R44** | `B/::forbidden del service pasa tal cual, sin filas ni total (R44)` |
| **R45** | `S/::para los mismos valores de filtro devuelve el mismo conjunto que el filtro de cliente (R45)` — **las 64 combinaciones**, conjunto Y orden Y total |
| **R45** | `Q/::los tres filtros se cruzan en AND y comparan por el nombre que ofrece el catálogo (R45)` |
| **R45** | `Q/::el join de distrito es LEFT: sin filtro, una orden sin distrito sigue en el listado` |
| **R45** | `Q/::el catálogo de geografía sembrado no tiene dos nombres que colisionen al normalizar` (cierra el hueco exacto-vs-normalizado, §3) |
| **R45** | `B/::los tres filtros validos llegan al service tal cual (R45)` |
| **R46** | `C/::ofrece todas las opciones del conjunto del actor, no solo las de la página (R46)` — comparado contra `construirFiltrosSatelite` del conjunto entero |
| **R46** | `C/::no cambia con la página ni con los filtros vigentes (R46)` |
| **R46** | `Q/::el catálogo de opciones lee el conjunto del actor, no la página (R46)` (sin `take` ni `skip`) |
| **R51** | `S/::conserva el orden actual: los cinco grupos en el orden del flujo, prioridad y recencia dentro (R51)` |
| **R51** | `S/::con un solo estado elegido conserva el orden de ese grupo (R51)` |
| **R51** | `Q/::el orden lleva el rango de GRUPO delante de la prioridad y la recencia (R51)` |
| **R51** | `Q/::la secuencia del ORDER BY es completa aunque el filtro deje un solo estado (R51)` |
| **R54** | `S/::no ejecuta más consultas que el listado sin paginar, salvo el conteo (R54)` |
| **R54** | `Q/::sin estados no consulta nada: el listado se define por ellos` |

**R42, R43, R47, R48, R49, R50, R52, R53 NO entran en esta task** y no se declaran cubiertos:
son T K.3 y la tanda M.

**Sobre R54**, que no es de esta task pero la tanda M lo mide: el listado sin paginar hace 1
consulta de listado + 1 del derivador de intentos. El paginado hace **2 + 1**: la que ordena
y CUENTA (una sola: el conteo va dentro) y la que hidrata. Es exactamente «+1 respecto a la
version sin paginar», y ese +1 es el conteo que R41 exige, fusionado con la resolucion del
orden. El derivador de intentos ademas baja de N filas del conjunto a N de la pagina.

---

## 9. Traspaso concreto a T K.3 (frontend)

Lo disponible, listo para cablear:

| Necesidad de la pantalla | Server Action | Notas |
| --- | --- | --- |
| La tabla | `listarOrdenesBodegaPaginado(input)` — `lib/actions/recepcion-satelite.ts` | `{ status, items, page, pageSize, total }`; `input` vacio = pagina 1 |
| Opciones de cantón/distrito | `obtenerCatalogoFiltrosSatelite()` | `{ cantones, distritos }`, forma identica a la que `construirFiltrosSatelite` produce hoy |
| «Por recibir», `zonaNombre`, `sinZona` | `listarRecepcionSatelite()` (**sin cambios**) | sigue trayendo los cinco grupos; ver el punto 6 |

**Ocho cosas que T K.3 tiene que saber y que no se deducen del tipo:**

1. **`construirFiltrosSatelite(ordenes)` deja de recibir `ordenes`.** Las opciones de cantón y
   distrito vienen ahora del catálogo. El filtro de ESTADO **no** viaja en el catálogo: son
   cinco valores fijos que la pantalla ya declara en `ESTADOS_SATELITE`.
2. **`ESTADOS_SATELITE` y `ESTADOS_BODEGA_SATELITE` (`lib/utils/estados-bodega-satelite.ts`)
   tienen que seguir diciendo lo mismo, en el mismo orden.** Hoy hay un test que lo vigila
   (`C/::la lista blanca del servidor y el desplegable…`). **Recomendacion:** que
   `ESTADOS_SATELITE` derive sus `value` de la constante de `lib/` y solo aporte las
   etiquetas; asi el orden de los grupos y el del desplegable no pueden divergir nunca. No se
   hizo aqui porque es UI.
3. **La selección del filtro viaja como NOMBRES**, los mismos `value` que el desplegable ya
   usa. No hay que traducir a ids.
4. **R47 («seleccionar todo») es trabajo tuyo y es lo que mas se nota.** Hoy
   `SelectAllCheckbox` recibe `visibles.map(id)`, que era el conjunto filtrado; ahora sera la
   pagina. Molde: `OrdenesModule`. Ojo con `seleccionados`: hoy se poda contra `visibles`
   («filtrar no deja seleccionada una fila que ya no se ve»); al paginar, cambiar de pagina
   NO deberia perder lo seleccionado en silencio, o deberia decirlo. **Decision no tomada
   aqui** (Q-K3).
5. **R48 (acciones de lote): `hayEstado()` mira el conjunto y pasara a mirar la pagina.** Con
   la decision de R48 —ofrecerlas segun lo SELECCIONADO— el problema desaparece; si se dejara
   como esta, un boton dejaria de ofrecerse solo por estar en otra pagina.
6. **R52 (descarga): hoy es `filasLocales(filas, …)` sobre el array de props, o sea «descarga
   lo que ves».** Al paginar hay que cablearla con `filasDelConjuntoCompleto`
   (`components/shared/descarga-resultado.ts`, T I.2). El origen del conjunto completo con
   los filtros vigentes **no existe todavia**: `listarRecepcionSatelite()` no acepta filtros.
   Opciones: (a) releer `listarRecepcionSatelite()` y aplicar los tres filtros en memoria al
   descargar —es lo que hace hoy la pantalla, y no empeora nada—; (b) pedir un
   `listarOrdenesBodegaCompleto(filtros)` al backend. **Se recomienda (a) para K.3** y (b)
   como cierre de la tanda M junto con Q-K4.
7. **`listarRecepcionSatelite()` sigue trayendo los cinco grupos completos.** Mientras la
   tabla los pinte desde la accion paginada, esos arrays quedan sin lector de tabla (pero
   siguen alimentando «Por recibir» y, si se elige (a) del punto 6, la descarga).
8. **El contador de cabecera.** Hoy la pantalla dice `X de Y órdenes` con dos numeros del
   conjunto. Con paginacion, `Y` es el `total` del servidor SIN filtros y `X` el `total`
   CON filtros: son dos llamadas o una decision de producto. Lo que R42 prohibe es que
   cualquiera de los dos salga de `items.length`. **Hay que meter esta pantalla en el
   registro de la guardia de T H.3** (`contadores-cabecera.guardia.test.ts`), hoy no esta.

---

## 10. Decisiones tomadas al implementar

1. **La secuencia de estados se extrae a `lib/`** (`estados-bodega-satelite.ts`), como T I.1
   hizo con `colas-cierre.ts`. Motivo, no estetica: la misma lista gobierna la lista blanca
   del filtro (R44) y el rango de grupo del orden (R51), y hasta ahora solo existia dentro de
   un componente y como cinco constantes sueltas en el servicio.
2. **El contrato no gana campos.** La pagina devuelve `{ items, page, pageSize, total }` y
   nada mas (T H.2). `zonaNombre`/`sinZona` siguen saliendo de `listar()`: meterlos aqui
   habria duplicado la fuente de verdad de la cabecera.
3. **`listar()` no se toca.** Es lo que sostiene «Por recibir» y es la referencia contra la
   que se mide el paginado. Tocarlo habria roto la pantalla antes de que llegue T K.3.
4. **El guard de rol va SIEMPRE antes de resolver la zona y antes de la base.** Medido en los
   dos metodos nuevos (`llamadas === []` para seis roles).
5. **Sin zona -> pagina y catalogo VACIOS, no `forbidden`**, como en las tandas I y J: el rol
   tiene acceso al modulo, lo que no tiene es alcance.
6. **El catalogo se deriva SIEMPRE de los cinco estados**, no de la seleccion vigente: si
   dependiera de ella, elegir un estado borraria cantones del desplegable.
7. **`derivarCantones`/`derivarDistritos` se REUSAN** (viven en `lib/utils/`, no en UI). El
   catalogo del servidor y el de la pantalla no pueden divergir porque son la misma funcion.
8. **Cero migraciones, cero RLS nueva, cero cambio de esquema.** El `WHERE` va sobre columnas
   que ya existen (`zona_id`, `deleted_at`, `estatus_id`, `canton_id`, `distrito_id`) y usa
   los indices que la 144 ya creo.
9. **Las Server Actions entran en K.1/K.2**, no en K.3 (`docs/architecture.md`: «Server
   Action = controlador»). Ninguna toca UI.
10. **`paginaInputSchema` se reusa via `.extend()`**, tal como su propio doc anticipaba para
    «satelite en la tanda K».

---

## 11. Preguntas abiertas (NO se rellenaron con supuestos)

**Q-K1 — El filtro compara nombres EXACTOS; el cliente comparaba normalizado.** Ver §3.
Coinciden para todo valor que el desplegable puede ofrecer y el catalogo sembrado no tiene
colisiones (medido y vigilado por test). Si algun dia hiciera falta cerrarlo del todo, la via
existe y esta probada en el repo: la columna generada de la 169 normaliza en Postgres con
`lower(translate(...))` espejando a Node. No se hizo porque seria maquinaria para un caso que
hoy no existe.

**Q-K2 — El SQL crudo no tiene test de integracion contra Postgres.** Se verifico a mano
contra la base local (§4.1) y se vigila por unit test sobre el `Prisma.Sql`. Un test en
`tests/integration/db/` (patron `_postgres-real.ts`, que se SALTA sin base) daria la
comprobacion end-to-end del `array_position` y del `COUNT(*) OVER ()`. **No se hizo** porque
exige sembrar ordenes reales en una transaccion revertida y eso es una task en si misma. Se
propone para la tanda M.

**Q-K3 — Que hace la seleccion al cambiar de pagina.** R47 dice que «seleccionar todo» marca
la pagina visible, pero no dice si lo seleccionado en la pagina 1 sobrevive al ir a la 2. Hoy
la pantalla poda la seleccion contra lo visible. Es una decision de UX de T K.3; el backend
no la condiciona (las acciones de lote reciben ids explicitos).

**Q-K4 — El conjunto completo con filtros para la descarga (R52) no existe.** Ver el punto 6
del traspaso. Mientras no exista, la descarga tiene que releer `listarRecepcionSatelite()` y
filtrar en memoria — que es exactamente lo que hace hoy, asi que no es una regresion, pero si
la deuda que la tanda M deberia cerrar (hermana de Q-I5 y Q-J1).

**Q-K5 — Los arrays de `listarRecepcionSatelite()` siguen cruzando enteros al cliente.**
Igual que Q-J1/Q-I4 en las tandas anteriores: hasta que la descarga tenga su propia via, no se
pueden retirar. Con K.3 en verde, «Por recibir» seria el unico grupo que la pantalla necesita
de esa accion.

**Heredadas y NO resueltas aqui:** Q-I1, Q-I2, Q-I5, Q-J1, Q-J2 (los agregados de
consolidacion), Q-J3 (ocho schemas de pagina escritos a mano — este listado no entra en esa
lista: usa `paginaInputSchema`), Q-J4 y la deuda **D5.2**.

---

## 12. Archivos

**Nuevos (4)**

- `lib/utils/estados-bodega-satelite.ts` — secuencia canonica + `estadosDelListado`.
- `tests/unit/services/recepcion-satelite-paginado.test.ts` (13)
- `tests/unit/repositories/satelite-paginado-where.test.ts` (11)
- `tests/unit/actions/satelite-catalogos.test.ts` (8)

**Modificados — produccion (6)**

- `lib/repositories/OrdenRepository.ts` — los dos metodos nuevos + el tipo de fila cruda.
- `lib/interfaces/repositories/IOrdenRepository.ts` — `RecepcionSateliteFiltro` + los dos
  contratos.
- `lib/services/RecepcionSateliteService.ts` — `listarOrdenesBodegaPaginado` y
  `obtenerCatalogoFiltros`.
- `lib/interfaces/services/IRecepcionSateliteService.ts` — input, resultados y catalogo.
- `lib/types/recepcion-satelite.ts` — schema `.strict()` + tipos de borde.
- `lib/actions/recepcion-satelite.ts` — las dos Server Actions.

**Modificados — tests ajenos (5), solo para declarar los metodos nuevos en su doble.** Anadir
un metodo a una interfaz obliga a que los dobles lo declaren; **ninguna asercion existente se
toco**: `bulk-orden-service`, `bulk-orden-service.carga-api`, `orden-service`,
`rol-admin-satelite-authz` (repositorio) y `recepcion-satelite-action` (servicio; ademas gana
7 tests propios de borde, §8).

**Cero UI, cero migraciones, cero RLS, cero cambios de esquema.**

---

## 13. Puertas (medicion final, salida real)

```
$ npx tsc --noEmit
=== typecheck exit: 0 ===

$ npx eslint
✖ 25 problems (0 errors, 25 warnings)
(baseline de la tanda J: 23 warnings. Las 2 nuevas son los `_args` sin usar del delegado
Prisma falso de `satelite-paginado-where.test.ts`, el MISMO patron —y las mismas dos lineas—
que ya tienen sus hermanos `historicos-paginados-where.test.ts` y `colas-paginadas-where.test.ts`.)

$ npx vitest run
 Test Files  744 passed (744)
      Tests  8947 passed (8947)
   Duration  215.31s
```

Suite completa **en verde a la primera**, sin flakes (el conocido `OrdenesModuleReuse` paso).
Baseline de la tanda J: 741 archivos / 8908 tests → **+3 archivos y +39 tests**.

---

## 14. Veredicto

Los tres filtros de la bodega satelite se resuelven ahora en el servidor y devuelven, para los
mismos valores, exactamente el mismo conjunto que el filtro de cliente en las 64 combinaciones
posibles, con el orden de los cinco grupos conservado en el `ORDER BY` y el total del conjunto
viajando dentro de la misma consulta que la pagina; el acotamiento por zona se afirma en los
dos sentidos y en las dos capas, y tres mutaciones del SQL que los tests de servicio no vieron
las detuvo el test de repositorio.
