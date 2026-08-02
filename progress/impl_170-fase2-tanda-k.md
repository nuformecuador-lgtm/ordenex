# impl — Feature 170, FASE 2, Tanda K (T K.1, T K.2 y T K.3: la bodega satelite)

**Rama:** `feature/170-fase2-tanda-k` · **Fecha:** 2026-08-01
**Roles:** `backend_dev` (§0-§14, T K.1/T K.2) · `frontend_dev` (§15-§23, T K.3)
**Alcance de T K.1/T K.2:** SOLO servidor, cero UI. **Alcance de T K.3:** SOLO UI, cero
`lib/services`, `lib/repositories` ni Server Actions.

Todo lo que sigue esta MEDIDO. Las diez mutaciones del backend y las ocho del frontend se
ejecutaron y se revirtieron.

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

**Tabla actualizada por T K.3**: la columna «DESPUES» ya no anticipa nada, describe lo que
esta commiteado. Los tres puntos que T K.1 dejo abiertos —seleccion, acciones de lote y
descarga— llevan ahora la decision tomada.

| | ANTES (hoy en `dev`) | DESPUES (con K.1+K.2+K.3) |
| --- | --- | --- |
| **Filas que recibe el navegador** | TODAS las de su zona en los cinco estados | una pagina (25 por defecto, `RECEPCION_SATELITE_*_PAGE_SIZE`) |
| **Filtrar por estado/cantón/distrito** | filtra el conjunto entero, en el navegador | filtra el conjunto entero, **en el servidor**; la pagina vuelve a la 1 y se recalcula |
| **Qué significa el contador** | `X de Y órdenes`, ambos del conjunto | **sin filtros: `Y órdenes`** (el total del servidor). **Con filtros: `X de Y órdenes`**, X = total del conjunto FILTRADO que devuelve el servidor, Y = total del conjunto del actor (la pre-carga del Server Component). Ninguno sale de las filas de la pagina (R42) |
| **Opciones de los desplegables** | las de las filas cargadas | las del **conjunto** del actor, por una accion propia; no cambian al paginar ni al filtrar (R46) |
| **Orden de las filas** | los cinco grupos concatenados; dentro de cada uno, prioritarias primero y luego recientes | **el mismo**, ahora impuesto en el `ORDER BY` |
| **Recorrer la lista** | scroll continuo | **control de paginas** bajo la tabla, con primera/anterior/numeros/siguiente/ultima y selector de 10/25/50. Nombre accesible: «Paginación de las órdenes de la bodega» |
| **«Seleccionar todo»** | marca todas las filas visibles tras filtrar (= el conjunto) | marca **exactamente las de la pagina visible**. Su etiqueta lo dice: «Seleccionar todas las órdenes de esta página» (antes, «…las órdenes») |
| **Cambiar de pagina con filas marcadas** | no existia | lo marcado en otra pagina **no se pierde** (al volver sigue marcado) pero **no entra en ninguna accion**: la barra cuenta y actua solo sobre lo marcado EN LA PAGINA. Filtrar, en cambio, **limpia la seleccion** |
| **Qué acciones de lote se ofrecen** | las cuatro se pintaban DESHABILITADAS con solo haber una orden de ese estado en el listado | **solo la de lo SELECCIONADO** (R48). Sin nada marcado no se ofrece ninguna; con seleccion mixta se ofrecen las de los estados marcados, deshabilitadas, y el aviso «Selecciona órdenes del mismo estado…» |
| **Sobre qué actua una accion de lote** | sobre lo marcado | **igual: sobre lo marcado**, y ahora hay test que lo fija con conjunto y seleccion distintos |
| **Descargar** | el conjunto filtrado, ya en el cliente | **el mismo conjunto filtrado**: al pulsar se RELEE el listado completo del servidor y se le aplican los filtros vigentes. Mismo archivo, mismas columnas, mismo tope de 5000 |
| **Texto de la barra al marcar filas** | `N seleccionada(s) · <estado>` | `N seleccionada(s) **en esta página** · <estado>` |

**Lo que un operador notara el primer dia:** la tabla ya no es infinita y aparece un control
de paginas; «seleccionar todo» deja de significar «todas mis órdenes» y pasa a significar
«las de esta página»; y los botones de lote ya no estan siempre a la vista en gris —aparecen
al marcar—. Filtrar sigue funcionando igual —y a partir de ahora seguira funcionando con la
tabla paginada, que es justo lo que se rompia si no se hacia esta tanda—.

**Lo que NO cambia:** el alcance (su zona y solo su zona), el orden de las filas, las
etiquetas de los filtros, las columnas y el detalle de cada fila, los intentos de entrega, el
resalte de prioritarias, las cuatro transiciones por lote y a que ordenes aplica cada una, el
reporte de incidente por fila, la seccion «Por recibir» (que NO pagina: no es de este
listado), el manifiesto del ultimo envio y el aviso de «Liberadas hoy».

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

## 14. Veredicto (T K.1 + T K.2)

Los tres filtros de la bodega satelite se resuelven ahora en el servidor y devuelven, para los
mismos valores, exactamente el mismo conjunto que el filtro de cliente en las 64 combinaciones
posibles, con el orden de los cinco grupos conservado en el `ORDER BY` y el total del conjunto
viajando dentro de la misma consulta que la pagina; el acotamiento por zona se afirma en los
dos sentidos y en las dos capas, y tres mutaciones del SQL que los tests de servicio no vieron
las detuvo el test de repositorio.

---
---

# T K.3 — Frontend: paginacion, seleccion por pagina y acciones de lote

**Rol:** `frontend_dev` · **Fecha:** 2026-08-01 · **Alcance:** SOLO capa de presentacion.
**Cero cambios** en `lib/services`, `lib/repositories` ni Server Actions (no hubo defecto que
declarar: las dos acciones de T K.1/T K.2 se cablearon tal cual).

Baseline al empezar: `tsc` 0, `eslint` 0 errores / 25 warnings, suite 744 archivos / 8947
tests, `git status` limpio.

---

## 15. Como quedo repartida la pantalla

La pantalla tenia dos piezas y sigue teniendo dos, pero la linea que las separa se movio: de
«el modulo trae los datos y el listado los filtra» a **«el modulo es la capa de datos y el
listado es la de presentacion»**.

| | `RecepcionSateliteModule` (padre) | `SateliteOrdenesListado` (hijo) |
| --- | --- | --- |
| **ANTES** | recibia los 5 arrays por estado y los CONCATENABA | filtraba en memoria, seleccionaba, pintaba y descargaba |
| **DESPUES** | filtros vigentes, pagina pedida, SWR, `mutate`, `<Pagination>` y el origen del conjunto para la descarga | barra de filtros (emite), seleccion de filas, acciones de lote, tabla y contador |

**Por que la capa de datos vive en el PADRE y no en el listado**, que seria lo natural:

1. **`mutate` no se puede delegar.** Las cuatro acciones de lote y las dos de recepcion las
   ejecuta el modulo, y dos de ellas terminan en un MODAL cuyo `onSuccess` tambien es suyo.
   Antes bastaba `router.refresh()` porque las filas llegaban por props; ahora las tiene SWR,
   y sin `mutate()` una orden recien enviada a central **seguiria en el listado** hasta
   recargar la pagina. Con SWR en el hijo habria hecho falta una señal de recarga hacia abajo:
   mas piezas para el mismo efecto. Nace `releerBodega()`, que hace las dos cosas
   (`router.refresh()` para «Por recibir», el bloqueo y las liberadas; `mutate()` para la
   tabla) y es lo unico que llaman los seis handlers.
2. **La guardia de T H.3 mira hacia abajo, nunca hacia arriba** (Q-I6, cerrada en T J.2). Con
   `<Pagination>` en el modulo, la guardia reconoce como «pantalla paginada» al modulo Y al
   listado que importa —que es donde vive el contador—. Al reves, el contador quedaria fuera
   de su vista.
3. **La descarga necesita el filtro y el origen del conjunto**, y los dos son del modulo.

Lo que el listado NO perdio: sigue siendo el dueño de lo que es suyo —que filas estan marcadas
y que accion se ofrece—, que es exactamente lo que R47 y R48 regulan.

---

## 16. Los cinco requisitos, uno a uno

### R43 — control de navegacion

`<Pagination>` bajo la tabla, con `showFirstLast`, `siblingCount={1}` y selector de tamaño
`[10, 25, 50]` acotado por `MAX_PAGE_SIZE` (el literal NO se escribe: sale de
`recepcionSateliteConfig`, y `RecepcionSateliteModule.tsx` se añade a `PANTALLAS_ANEXO_III`
de la guardia de T H.1 para que se siga vigilando ahi). Nombre accesible propio,
`PAGINACION_BODEGA_LABEL`: la pantalla no tiene otro control de paginas hoy, pero un `<nav>`
llamado «Paginación» a secas no dice de que listado es.

### R47 — «seleccionar todo» = la pagina visible

Dos cambios y una decision:

- `SelectAllCheckbox` recibe los ids de `ordenes` (la pagina), no del conjunto;
- `seleccionadas` = `ordenes ∩ seleccionados`, o sea **lo marcado que esta a la vista**;
- la etiqueta pasa a **«Seleccionar todas las órdenes de esta página»**. No es cosmetica: la
  casilla cambia de significado y el unico texto que el lector de pantalla anuncia es ese.
  Que la etiqueta mintiera seria peor que no tenerla.

**Q-K3 resuelta — que hace la seleccion al cambiar de pagina.** Se conserva (el `Set` de ids
no se poda), pero **no participa**: la barra cuenta y las acciones actuan solo sobre lo que
esta en la pagina. Volver a la pagina anterior recupera lo marcado. Molde: `OrdenesModule`
(feature 144), que hace exactamente esto. Las dos alternativas se descartaron con motivo:
*limpiar al paginar* obligaria a rehacer el trabajo por un scroll de mas y nadie lo pide;
*acumular y actuar sobre todo lo marcado* es justo lo que R47 prohibe —el operador pulsaria
«Enviar a central» viendo 3 filas marcadas y moveria 28—.

**Filtrar SI limpia la seleccion**, y ahi no hay duda: el conjunto cambia, la fila marcada
puede haber desaparecido de la vista y actuar sobre ella seria actuar a ciegas. Es lo que la
pantalla ya hacia (podaba contra `visibles`) y lo que hace `OrdenesModule`.

### R48 — las acciones se deciden sobre lo SELECCIONADO

`hayEstado()` pasa de `visibles.some(...)` a `seleccionadas.some(...)`. **Cambia lo que se ve**
y es el punto que mas se notara: hasta hoy los cuatro botones aparecian en gris con solo haber
una orden de ese estado en el listado; ahora no aparece ninguno hasta marcar algo, y solo
aparece el que corresponde a lo marcado.

Se eligio esto y no «ofrecer segun la pagina» por lo que el propio traspaso adelantaba: con la
pagina, un boton **dejaria de ofrecerse solo por estar sus ordenes en otra pagina** —el
operador concluiria que su bodega no admite esa transicion—. Y por el riesgo grande: mientras
la decision y la accion miren cosas distintas (una el listado, otra la seleccion), cualquier
descuido al cablearlas mueve paquetes que el usuario no eligio. Ahora **miran lo mismo**.

Lo que NO cambia: `disabled` sigue exigiendo estado UNICO (una seleccion mixta no ejecuta
nada) y `puedeAsignar` sigue mandando sobre «Asignar» con la bodega bloqueada.

### R46 — los desplegables conservan todas sus opciones

`construirFiltrosSatelite` cambia de ORIGEN, no de contrato: recibia `RecepcionSateliteDTO[]`
y ahora recibe el `CatalogoFiltrosSateliteDTO` de T K.2. Sigue produciendo los mismos
`FilterDef`, porque el catalogo del servidor se deriva con las MISMAS funciones puras
(`derivarCantones` / `derivarDistritos`) que usaba la pantalla. El Server Component lo
pre-carga y baja por props (molde `obtenerCatalogoFiltrosOrdenes`, feature 144): ni un endpoint
nuevo ni una consulta por cada seleccion del usuario.

`ESTADOS_SATELITE` **deriva ahora sus `value`** de `ESTADOS_BODEGA_SATELITE`
(`lib/utils/estados-bodega-satelite.ts`), como recomendaba el traspaso §9.2, y solo aporta las
etiquetas mediante un `Record` EXHAUSTIVO: añadir un estado a la constante sin darle etiqueta
**no compila**. El test que vigilaba que las dos listas dijeran lo mismo
(`satelite-catalogos::la lista blanca del servidor y el desplegable…`) sigue verde, ahora por
construccion.

### R52 — la descarga sigue entregando el conjunto

Se sigue la **recomendacion (a) del traspaso §9.6**, sin desviarse: al pulsar el control se
RELEE `listarRecepcionSatelite()` —el mismo listado que la pantalla llamaba antes de paginar,
acotado server-side a la zona del actor: descargar no amplia el alcance ni una fila—, se
concatenan los cinco grupos EN EL ORDEN DEL FLUJO (el mismo del `ORDER BY`, R51) y se aplican
los tres filtros vigentes en memoria con `filtrarOrdenesSatelite`, extraido literalmente del
`useMemo` que el listado tenia. Todo eso alimenta `filasDelConjuntoCompleto` (T I.2), que
conserva el tope de 5000 y su mensaje accionable.

No se eligio (b) —pedir al backend un `listarOrdenesBodegaCompleto(filtros)`— porque es
backend, y esta task es de UI. Queda como estaba: **Q-K4 sigue abierta para la tanda M**, y con
un motivo mas ahora que hay codigo que lo sostiene (§20).

---

## 17. Donde se prueba cada cosa

| Archivo | Que prueba |
| --- | --- |
| `tests/components/paginacion/SatelitePaginacion.test.tsx` (8, NUEVO) | los cinco casos que exige T K.3 + el primer pintado + el contador en la ultima pagina |
| `tests/components/descarga/SateliteDescarga.test.tsx` (4, reescrito) | el archivo: columnas, valores crudos, los tres filtros y —nuevo— que descargar RELEE el conjunto y no pide paginas |
| `tests/unit/descarga/contadores-cabecera.guardia.test.ts` (+1) | la guardia estatica de R42, ahora con esta pantalla dentro |

El fixture de la pantalla vive en `tests/fixtures/satelite-bodega.ts` (hermano de
`pagina-inicial.ts`, T I.2): seis archivos de la suite montan este modulo y todos necesitan la
pagina y el catalogo. Escrito a mano en cada uno, el catalogo acabaria derivandose de las filas
de la pagina por inercia — y entonces ningun test podria distinguir «las opciones del conjunto»
de «las de la pagina», que es justo lo que R46 separa.

**El doble de la Server Action FILTRA Y RECORTA de verdad**, y su filtro esta reimplementado en
el test comparando por igualdad EXACTA del nombre (como el SQL) en vez de reusar
`filtrarOrdenesSatelite`: si el doble fuera el mismo codigo que la pantalla, el test seria el
codigo midiendose a si mismo. Los datos estan repartidos para que **pagina y conjunto no
coincidan en nada de lo que se mide**: la pagina 1 es toda de un solo canton y un solo estado,
la 2 mezcla tres estados y el conjunto tiene cuatro cantones (dos homonimos) y cinco estados.

---

## 18. Las ocho mutaciones, con su salida real

**Todas revertidas** (`grep MUTACION app/` sin resultados; suite completa verde despues).

| # | Mutacion | Resultado medido |
| --- | --- | --- |
| 1 | **R47**: «seleccionar todo» abarca el conjunto visto (acumulador de ids entre paginas) | **ROJO (1)**: `seleccionar todo marca exactamente las filas de la página visible (R47)` → `REM-01 quedó marcada sin estar a la vista` |
| 2 | **R48 (a)**: `hayEstado` mira `ordenes` (el listado) en vez de `seleccionadas` | **ROJO (1)**: `las acciones de lote se deciden sobre lo seleccionado…` |
| 3 | **R48 (b)**: `onEnviarACentral(ordenes)` en vez de `(seleccionadas)` — la accion sobre la pagina | **ROJO (1)**: `expected "vi.fn()" to be called 3 times, but got 25 times` |
| 4 | **R46**: el catalogo se deriva de la PAGINA (el codigo de antes de T K.3) | **ROJO (1)**: `los desplegables de cantón y distrito conservan todas sus opciones (R46)` |
| 5 | **R52**: `obtenerFilas` proyecta `data.items` — «descargá lo que ves» | **ROJO (3)**: los dos casos de descarga del archivo nuevo + `descargar relee el CONJUNTO…` |
| 6 | **R43**: se quita el `ariaLabel` del control | **ROJO (5)**: todos los casos que navegan dejan de encontrar el `<nav>` por nombre |
| 7 | **R42**: el contador sale de `ordenes.length` | **ROJO (2)** de comportamiento (`navega entre páginas`, `seleccionar todo…`) **y ROJO (1)** en la guardia estatica de T H.3 |
| 8 | **R44**: se quita el `fallbackData` de SWR | **ROJO (6)**, empezando por `el usuario ve las mismas filas que antes en el PRIMER pintado` |

Las dos que el encargo exigia son la **1** (seleccionar todo abarcando el conjunto) y la **3**
(accion de lote sobre el conjunto en vez de la seleccion).

**Sobre la 8**, que es el aviso medido de la tanda I: el test del primer pintado NO espera. Con
`await`/`findBy*`, quitar el `fallbackData` pasaba VERDE —la pantalla enseñaba un esqueleto y
las filas aparecian tras un viaje al servidor por un dato que ya venia en la respuesta— y aqui
se comprueba que sigue sin colar.

---

## 19. Mapa `R<n> → archivo::test`

Prefijos: `P/` = `tests/components/paginacion/SatelitePaginacion.test.tsx`,
`D/` = `tests/components/descarga/SateliteDescarga.test.tsx`,
`G/` = `tests/unit/descarga/contadores-cabecera.guardia.test.ts`.

| R | Test |
| --- | --- |
| **R42** | `P/::navega entre páginas (R43)` — el contador dice 60 en la ULTIMA pagina, que trae 10 |
| **R42** | `P/::seleccionar todo marca exactamente las filas de la página visible (R47)` — al soltar la seleccion vuelve a decir el total |
| **R42** | `G/::el contador de la bodega satelite dice el total del servidor, y su pantalla se vigila` |
| **R43** | `P/::navega entre páginas (R43)` — `<nav>` por rol y nombre, siguiente/ultima/primera, y las filas CAMBIAN |
| **R44** | `P/::el usuario ve las mismas filas que antes en el PRIMER pintado (R44)` — sin `await` |
| **R46** | `P/::los desplegables de cantón y distrito conservan todas sus opciones (R46)` — pagina de un solo canton, desplegable con los cuatro del conjunto, y el distrito de otro canton |
| **R47** | `P/::seleccionar todo marca exactamente las filas de la página visible (R47)` — las 25 de la pagina 2 marcadas, y NINGUNA de la 1 |
| **R48** | `P/::las acciones de lote se deciden sobre lo seleccionado, no sobre el conjunto (R48)` — pagina de tres estados, 3 marcadas de 10 del conjunto, la accion recibe esas 3 |
| **R48** | `P/::una acción de otro estado actúa sobre su selección, no sobre la página (R48)` — «Enviar a central» no se ofrece aunque el conjunto tenga 10 por devolver en otra pagina |
| **R52** | `P/::la descarga sigue entregando el dataset completo con los filtros vigentes (R52)` — desde la PAGINA 2 y con filtro: 30 filas, no las 5 que se ven |
| **R52** | `P/::la descarga sin filtros entrega el conjunto entero, no la página (R52)` |
| **R52** | `D/::descargar relee el CONJUNTO, no otra página del listado` |
| **R52** | `D/::respeta los filtros de estado, cantón y distrito aplicados` |

**R40/R41/R45/R51 no son de esta task** (los cubre T K.1, §8) y no se declaran cubiertos aqui;
lo que esta pantalla añade es que el contrato se cablea sin perder nada por el camino.

---

## 20. Decisiones de T K.3

1. **El modulo deja de recibir los cinco arrays por estado.** Recibe la PAGINA 1 y el
   catalogo. La alternativa —seguir recibiendolos «total, ya estan»— habria dejado R52 verde
   sin escribir una linea y convertido la paginacion en maquillaje: el conjunto entero
   seguiria cruzando al cliente en cada render (T I.2, §14, mismo argumento).
2. **El contador se resuelve sin una segunda llamada.** `Y` (el conjunto sin filtros) es el
   `total` de la pagina 1 que el Server Component ya pre-carga; `X` es el `total` con los
   filtros vigentes. Los dos son del servidor. Sin filtros solo se muestra un numero: «60 de
   60 órdenes» no dice nada que «60 órdenes» no diga.
3. **Sin filtros marcados, `X de Y` no se pinta**, y con ellos si. Es la unica lectura en la
   que los dos numeros informan.
4. **`filtrarOrdenesSatelite` se EXTRAE del `useMemo`** a `satelite-ordenes-filtros.ts`. La
   tabla ya no lo usa (filtra el servidor); lo usa la descarga. Extraerlo lo hace importable
   —hasta hoy vivia dentro de un componente y el test de T K.1 tuvo que copiarlo literalmente
   (§6)— y deja el hueco en un solo sitio para cuando Q-K4 se cierre.
5. **La descarga baja como CALLBACK, no como filtros** (design §5). El listado declara las
   COLUMNAS del archivo (es quien sabe que enseña) y el modulo aporta `obtenerFilas`. Es el
   patron que ya tienen `WalletLedger`, `DesgloseTiendaLedger` y `DesglosePagos`; el registro
   de proveedores de `ControlDescargaTransversal` pasa de 3 a 4 y su regex admite ademas
   `filasDelConjuntoCompleto`.
6. **`releerBodega()` sustituye a `router.refresh()`** en los seis puntos donde la pantalla
   relee. Ver §15.
7. **El esqueleto se muestra solo si NO hay nada que pintar** (`data === undefined`), no
   mientras SWR revalida con `fallbackData`. Arreglo de T I.2 heredado tal cual.
8. **Un resultado que no sea `ok` se LANZA** en el fetcher: la tabla enseña «No se pudieron
   cargar las órdenes de la bodega.» en vez de una tabla vacia, que se leeria como «no hay
   órdenes» — que es justo lo contrario de lo que pasa.
9. **El Server Component degrada suave**: si la pagina o el catalogo no responden `ok`, bajan
   vacios (el `notFound` por rol ya se decidio antes, con `listarRecepcionSatelite`).
10. **El texto de UI no gana siglas.** «en esta página», «Selecciona órdenes del mismo
    estado…», «No se pudieron cargar las órdenes de la bodega.»

---

## 21. Preguntas abiertas de T K.3

**Q-K3 — CERRADA** (§16, R47): la seleccion sobrevive al cambio de pagina pero no participa;
filtrar la limpia. Molde `OrdenesModule`.

**Q-K4 — SIGUE ABIERTA, y ahora tiene codigo que la sostiene.** La descarga relee
`listarRecepcionSatelite()` y filtra en memoria. No es una regresion —es literalmente lo que la
pantalla hacia—, pero **el conjunto entero vuelve a cruzar al cliente en ese momento**, solo
que ahora unicamente al pulsar «Descargar» en vez de en cada render. Cerrarla es
`listarOrdenesBodegaCompleto(filtros)` en el backend (tanda M): con el, `filtrarOrdenesSatelite`
desaparece y el hueco «exacto vs normalizado» de Q-K1 deja de tener dos implementaciones.

**Q-K5 — parcialmente cerrada.** Los cinco arrays de `listarRecepcionSatelite()` **ya no
cruzan al cliente en el render**: `page.tsx` los sigue recibiendo pero no los pasa al modulo.
Lo que sigue cruzando es «Por recibir» (que es de otra seccion y no pagina) y el conjunto en el
momento de descargar (Q-K4).

**Q-K6 — NUEVA: el Server Component hace ahora TRES lecturas de este dominio por render**
(`listarRecepcionSatelite` para «Por recibir»/zona/`sinZona`, `listarOrdenesBodegaPaginado`
para la tabla y `obtenerCatalogoFiltrosSatelite` para los desplegables). R54 habla del listado
—y ese cumple: 2+1 consultas, §8— pero la PANTALLA lee mas que antes. Se deja declarado y sin
tocar porque resolverlo es backend: o «Por recibir» sale de su propia accion acotada, o
`listar()` deja de devolver los cinco grupos. **Ninguna de las dos es de T K.3.** El catalogo,
ademas, es cacheable: no cambia con la pagina ni con los filtros.

**Q-K7 — NUEVA: la seleccion no se avisa al cambiar de pagina.** Lo marcado en la pagina 1
sigue marcado al volver, pero mientras se esta en la 2 nada lo dice. Con `pageSize` 25 y una
bodega de 60 el caso es raro; si el humano lo ve en uso, la solucion (un aviso «tienes N
marcadas en otras páginas») es una linea de texto en la barra. **No se hizo porque nadie lo
pidio y añadir texto a una barra que ya avisa de dos cosas puede estorbar mas que ayudar.**

**Heredadas y NO resueltas aqui:** Q-K1 (exacto vs normalizado), Q-K2 (sin test de integracion
del SQL), Q-I1, Q-I2, Q-I5, Q-J1, Q-J2, Q-J3, Q-J4 y la deuda D5.2.

---

## 22. Archivos de T K.3

**Nuevos (2)**

- `tests/components/paginacion/SatelitePaginacion.test.tsx` (8 tests).
- `tests/fixtures/satelite-bodega.ts` — `paginaBodega()` y `catalogoSatelite()`.

**Modificados — produccion (4)**

- `app/(app)/recepcion-satelite/page.tsx` — pre-carga de la pagina 1 y del catalogo; deja de
  bajar los cinco arrays por estado.
- `app/(app)/recepcion-satelite/_components/RecepcionSateliteModule.tsx` — SWR + filtros +
  pagina + `<Pagination>` + `releerBodega()` + origen del conjunto para la descarga.
- `app/(app)/recepcion-satelite/_components/SateliteOrdenesListado.tsx` — pinta la pagina;
  seleccion y acciones de lote acotadas a ella; contador por totales del servidor.
- `app/(app)/recepcion-satelite/_components/satelite-ordenes-filtros.ts` —
  `construirFiltrosSatelite(catalogo)`, `ESTADOS_SATELITE` derivado de `lib/`,
  `seleccionAFiltroSatelite`, `serializarFiltroSatelite` y `filtrarOrdenesSatelite`.

**Modificados — tests (8)**

- `tests/components/descarga/SateliteDescarga.test.tsx` — monta el modulo; el caso estatico
  «no relee nada» (R30/R32 de la FASE 1) se sustituye por «relee el CONJUNTO, no otra pagina».
- `tests/components/RecepcionSateliteModule.test.tsx`, `RecepcionSateliteIncidente.test.tsx`,
  `RecepcionSatelitePage.test.tsx`, `ManifiestoFlujos.test.tsx`,
  `tests/unit/components/deshacer-asignacion.ui.test.tsx` — andamiaje: los casos siguen
  describiendo la bodega POR GRUPOS y el helper los concatena para armar la pagina; caché de
  SWR nueva por montaje. Los casos que afirmaban «sin selección el botón está deshabilitado»
  pasan a «sin selección no se ofrece» (R48).
- `tests/unit/actions/satelite-catalogos.test.ts` — `construirFiltrosSatelite` cambio de
  firma; el helper del test le entrega el catalogo derivado del conjunto entero. **Ninguna
  asercion se relajo**: las cuatro etiquetas, el orden y el encadenamiento se siguen afirmando.
- `tests/components/descarga/ControlDescargaTransversal.test.tsx`,
  `tests/unit/descarga/contadores-cabecera.guardia.test.ts`,
  `tests/unit/config/paginacion-dominios.test.ts` — las tres guardias transversales, con esta
  pantalla dentro.

**Cero cambios en `lib/`.** `censo-tablas.ts` no se toca: la tabla no se muda ni nace otra.

---

## 23. Puertas de T K.3 (medicion final, salida real)

```
$ npx tsc --noEmit
=== typecheck exit: 0 ===

$ npx eslint
✖ 25 problems (0 errors, 25 warnings)      (baseline de T K.1/K.2: 25 warnings — sin delta)

$ npx vitest run
 Test Files  745 passed (745)
      Tests  8956 passed (8956)
   Duration  216.95s

$ ./init.sh
== init OK ==
```

Baseline de T K.1/T K.2: 744 archivos / 8947 tests → **+1 archivo y +9 tests**. Suite completa
en verde a la primera y sin flakes: el conocido `OrdenesModuleReuse` paso en las dos corridas.

---

## 24. Veredicto (T K.3)

La bodega satelite pinta ahora la pagina que le da el servidor con un control de navegacion
propio y nombrado; «seleccionar todo» marca exactamente las filas visibles y lo dice en su
etiqueta; las cuatro acciones de lote se ofrecen y se ejecutan sobre lo SELECCIONADO —probado
con una pagina de tres estados y un conjunto de cinco, donde marcar 3 de 10 mueve 3—; los
desplegables siguen ofreciendo los cuatro cantones del conjunto aunque la pagina tenga uno; y
la descarga sigue entregando las 60 filas del conjunto con los filtros vigentes cuando la tabla
enseña 5. Ocho mutaciones lo confirmaron en rojo y se revirtieron.
