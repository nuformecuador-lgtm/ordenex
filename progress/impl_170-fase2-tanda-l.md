# impl — Feature 170, FASE 2, Tanda L (T L.1 y T L.2: cuentas por pagar a mensajeros)

**Rama:** `feature/170-fase2-tanda-l` · **Fecha:** 2026-08-01
**Roles:** `backend_dev` (§0-§14, T L.1) · `frontend_dev` (§15-§24, T L.2)
**Alcance de T L.1:** SOLO servidor, cero UI. **Alcance de T L.2:** SOLO UI, cero
`lib/services`, `lib/repositories` ni Server Actions.

Todo lo que sigue esta MEDIDO. Las once mutaciones del backend y las diez del frontend se
ejecutaron y se revirtieron; en el backend una paso VERDE en los tests de servicio y solo la
vio el test de repositorio —la CUARTA vez que este proyecto mide ese punto ciego— y en el
frontend otra paso VERDE porque el dato de prueba hacia vacio su caso (§18).

---

## 0. Baseline medido AL EMPEZAR

```
$ git branch --show-current
feature/170-fase2-tanda-l        (rama ya creada; no se hizo checkout de ninguna otra)
$ git status --short
(limpio)
$ npx tsc --noEmit
=== typecheck exit: 0 ===
$ npx eslint
✖ 25 problems (0 errors, 25 warnings)
suite (baseline tanda K): 745 archivos / 8956 tests
```

---

## 1. EL CAMBIO DE USO (lo que el humano cambio por no verificar en pantalla)

El humano renuncio a la verificacion en pantalla (Q4) a cambio de que la suite lo cubra y el PR
lo describa. Esto es lo que el `maestro`/`admin` hace HOY en `/wallet/mensajeros` y lo que hara
DESPUES. **La columna «DESPUES» describe el estado al que L.1 + L.2 llevan la pantalla**; lo que
T L.1 commitea es la mitad de servidor, y lo que L.2 decida se anota en §9.

**Tabla actualizada por T L.2**: la columna «DESPUES» ya no anticipa nada, describe lo que esta
commiteado. Los tres puntos que T L.1 dejo abiertos —contador, descarga y espera de la
busqueda— llevan ahora la decision tomada.

| | ANTES (hoy en `dev`) | DESPUES (con L.1 + L.2) |
| --- | --- | --- |
| **Filas que recibe el navegador** | TODAS las cuentas por pagar, una por mensajero con movimientos | una pagina (25 por defecto, `WALLET_MENSAJERO_*_PAGE_SIZE`) |
| **Buscar por nombre** | filtra el conjunto entero, **en el navegador** (`filtrados`, `CuentasPorPagarTable.tsx:84-88`) | filtra el conjunto entero, **en el servidor**; la pagina vuelve a la 1 y se recalcula |
| **Cuando viaja lo escrito** | nunca: el filtro era local y respondia en la misma tecla | **cuando el usuario deja de escribir** (la misma espera que `FilterComponent` aplica a cualquier filtro). El campo sigue respondiendo al instante; lo que se aplaza es la consulta. Escribir «Ana» es UNA lectura, no tres |
| **Que devuelve la busqueda** | subcadena, sin distinguir mayusculas, **sensible a acentos** («jose» NO encuentra a «José») | **exactamente lo mismo**, string a string: es lo que R45 exige y lo que 25 textos de test comparan contra el filtro de cliente copiado literal |
| **Orden de las filas** | **ninguno declarado**: sale de un `groupBy` sin `orderBy`, o sea del planificador de Postgres | **alfabetico por nombre de mensajero**, con `mensajeroId` de desempate. DESVIACION declarada de R51, la misma que T I.1 declaro en «Saldos de tiendas» (§4) |
| **Dinero de cada fila** | devengado / pagado / cuenta por pagar del LIBRO ENTERO de ese mensajero | **el mismo**: la agregacion es del libro entero y se hace ANTES de recortar (§5). La pantalla no suma ni deriva nada |
| **Cuantos mensajeros hay** | **nadie lo decia**, pero se podian contar: estaban todas las filas a la vista | **contador de cabecera**: «N mensajeros», y con una busqueda puesta «X de N mensajeros». Los dos numeros son `total` del servidor; ninguno sale de las filas de la pagina (R42) |
| **Recorrer la lista** | scroll continuo | **control de paginas** bajo la tabla, con primera/anterior/numeros/siguiente/ultima y selector de 10/25/50. Nombre accesible: «Paginación de las cuentas por pagar» |
| **Expandir una fila** | abre `DesglosePagosMensajero`, que ya pagina por su cuenta | **igual**, y comprobado en la pagina 3: el panel que se abre es el de ESA fila y pide su desglose por `mensajeroId` (R50) |
| **Una fila desplegada al paginar** | no existia | lo desplegado en otra pagina **no se pinta** mientras no este a la vista, y al volver sigue desplegado. Ningun desglose se abre solo |
| **Descargar** | el conjunto filtrado, ya en el cliente (`filasLocales(filtrados, …)`) | **el mismo conjunto filtrado**: al pulsar se RELEE el listado completo y se le aplica la busqueda vigente con las MISMAS funciones del servidor (§19). Mismo archivo, mismas columnas, mismo tope de 5000 |

**Lo que un operador notara el primer dia:** la tabla ya no es infinita y aparece un control de
paginas y un contador; **las filas salen en orden alfabetico**, que hasta hoy no estaban en
ningun orden declarado; y al buscar, la tabla tarda un instante en responder en vez de filtrar
en la misma tecla. Buscar por nombre sigue encontrando lo mismo —y a partir de ahora seguira
funcionando con la tabla paginada, que es justo lo que se rompia si no se hacia esta tanda—.

**Lo que NO cambia:** quien ve la pantalla (`maestro`/`admin`, `notFound` para el resto), las
cinco columnas, los montos (mismos strings, misma derivacion), el badge por signo, el desglose
por cierre de cada fila y sus filtros, el `aria-label` de la tabla, el del buscador y el de cada
boton de expandir, el estado vacio y el archivo de descarga (mismas columnas, mismo tope de
5000).

---

## 2. LA DECISION QUE ESTA TANDA TENIA QUE TOMAR: el dominio de configuracion que faltaba

**Contexto.** T H.1 configuro SEIS dominios de paginacion y su test afirmaba **12 de 13**
listados del Anexo III a proposito, con el hueco escrito en el propio test: «Cuentas por pagar a
mensajeros» no tenia dominio y no existia `lib/config/wallet-mensajero.ts`. Las tandas I, J y K
lo heredaron sin resolver porque no era suyo.

**Decision: NACE `lib/config/wallet-mensajero.ts`** (25/100, `WALLET_MENSAJERO_DEFAULT_PAGE_SIZE`
/ `WALLET_MENSAJERO_MAX_PAGE_SIZE`), y el test de T H.1 pasa a afirmar **13 de 13**.

**Por que no se colgo de `wallet-tienda`,** que era la alternativa barata: son dos ledgers
distintos, en dos pantallas distintas, y **crecen por motivos distintos** —uno con el numero de
tiendas, otro con el de mensajeros—. Compartir la variable de entorno obligaria a mover las dos
al tocar una, y la primera vez que alguien quisiera 50 filas de mensajeros se llevaria por
delante el tamano de la pantalla de tiendas sin enterarse. Ademas rompe la lectura del propio
registro: `listados: ["Saldos de tiendas", "Cuentas por pagar a mensajeros"]` bajo un dominio
llamado «wallet-tienda» es una linea que miente.

El test que lo vigila conserva su historia escrita, porque es lo que le da valor:
`paginacion-dominios.test.ts::los siete dominios cubren los 13 listados del Anexo III`.

**Deuda PREEXISTENTE que este dominio deja al alcance de la mano, y NO se toca aqui:**
`DesglosePagosMensajero.tsx` tiene `const DESGLOSE_PAGE_SIZE = 20`. Es `app/`, o sea T L.2 (§9).

---

## 3. Que se entrega

| # | Pieza | Donde | Cubre |
| --- | --- | --- | --- |
| 1 | Dominio de paginacion `wallet-mensajero` | `lib/config/wallet-mensajero.ts` (NUEVO) | R40 |
| 2 | Busqueda y orden del listado, declarados UNA vez | `lib/utils/cuentas-por-pagar-listado.ts` (NUEVO) | R45, R51 |
| 3 | `listarCuentasPorPagarPaginado(filtro, rango)` | `PagoMensajeroMovimientoRepository` | R40, R41, R45, R51 |
| 4 | `listarCuentasPorPagarPaginado(input, actor)` | `WalletMensajeroService` | R40, R41, R44, R45, R51 |
| 5 | `listarCuentasPorPagarPaginadoSchema` (`.strict()`) | `lib/types/wallet-mensajero.ts` | R40, R44 |
| 6 | Server Action `listarCuentasPorPagarPaginadoAction` | `lib/actions/wallet-mensajero.ts` | borde |

`listarCuentasPorPagar()` (el listado entero) **queda intacto**: la pantalla lo sigue llamando
hasta que L.2 la cablee, y ademas es la referencia contra la que se mide el paginado (§6).

**Cero migraciones, cero RLS nueva, cero cambio de esquema.** No hay `WHERE` nuevo: las dos
consultas son EXACTAMENTE las que el listado sin paginar ya hacia (§5).

---

## 4. R51: el orden que nadie declaraba (DESVIACION declarada)

Se verifico primero, como pedia el encargo: **este listado NO tiene `orderBy`**. El orden que el
maestro ve hoy sale de `pagoMensajeroMovimiento.groupBy({ by: ["mensajeroId","tipo"] })` —sin
`orderBy`— y de que el repositorio recorre el `Map` en orden de insercion. Postgres no garantiza
el orden de un `GROUP BY` ni lo promete estable entre llamadas.

Es el MISMO caso que T I.1 encontro en «Saldos de tiendas», y se resuelve igual, a proposito:
**por nombre, con `mensajeroId` de desempate**. Motivos, en orden:

1. **Paginar exige un orden TOTAL** o dos paginas se solapan y una fila se cae entre ellas. Aqui
   la fila que se cae es una cuenta por pagar que alguien tiene que liquidar.
2. **El nombre es el identificador de negocio de la fila**: es la unica columna que no es dinero,
   y es justo por lo que la pantalla busca.
3. **Deja este listado con el MISMO criterio que su pantalla hermana**, «Saldos de tiendas», que
   ya tomo esta decision en T I.1 (Q-I2).

**R51 no tenia aqui criterio que conservar**, asi que lo que se afirma en los tests no es «sale
en el orden de antes» —no habia— sino lo que hace correcta la paginacion: **el orden no depende
del orden en que la base devuelva las filas**. El test pasa el mismo conjunto al derecho y al
reves y exige la misma salida, pagina a pagina.

Nota medida: `localeCompare` compara sin distinguir caja, asi que «ana lópez» va delante de «Ana
Mensajera» (l < m) y no detras por empezar en minuscula. Esta escrito en el test.

---

## 5. Por que la pagina NO se corta en la base (y por que la busqueda tampoco va en un `WHERE`)

Es la decision de diseno de esta tanda y la que mas se puede discutir, asi que va con su motivo
y su precio.

`listarCuentasPorPagarPaginado` **reusa `listarCuentasPorPagarTodos()`** y filtra, ordena y
recorta despues. Dos razones independientes, cualquiera de las dos bastaria:

1. **Cada fila es la agregacion de TODO el libro de ese mensajero.** No hay nada que empujar al
   `LIMIT` sin cambiar el dinero que la fila declara: recortar la agregacion es literalmente
   decir que se debe menos de lo que se debe. Precedente exacto y aceptado: `listarSaldosTiendasPaginado`
   (T I.1 §6.6).
2. **El filtro es por NOMBRE, que vive en `usuario`, no en el libro que se agrega.** Expresarlo
   en SQL exigiria una lectura previa de `usuario` con `ILIKE` — y **`ILIKE` no casa el mismo
   conjunto que `String.includes`**: `%` y `_` son comodines en SQL y texto en el navegador. Un
   maestro que escribiera `%` veria HOY cero filas y con `ILIKE` las veria todas. R45 dice
   exactamente lo contrario. Hay dos casos de la bateria (`%` y `a_m`) que existen solo para
   fijar esto.

**Consecuencias, las tres medidas:**

- **R44 se cumple por construccion**: es literalmente el mismo conjunto que el listado sin
  paginar, y hay test que lo compara.
- **R54 en su forma fuerte**: cero consultas nuevas, **ni la del conteo** — el total sale de la
  misma agregacion. Medido: 2 consultas antes, 2 despues.
- **El coste en Postgres no baja.** Lo que baja es lo que cruza a la pantalla, que es de lo que
  habla el Anexo III para este listado. **Es la misma deuda que Q-I1** y se hereda tal cual
  (§10, Q-L1).

---

## 6. Donde se prueba cada cosa, y por que hay un test de consultas

**Aviso MEDIDO por CUARTA vez.** Los tests de servicio usan un DOBLE del repositorio: ven que el
servicio pase lo correcto, jamas la traduccion a consultas. La **mutacion 6** de §7 —anadir
`take: 50` a la agregacion del dinero, o sea «la cuenta por pagar deja de mirar el libro
entero»— dejo los **13 tests de servicio en VERDE** y solo la vio
`tests/unit/repositories/cuentas-por-pagar-paginado-where.test.ts`. Es exactamente el mismo
patron que las tandas I (1 mutacion verde), J (2) y K (3).

| Archivo | Tests | Que prueba |
| --- | --- | --- |
| `tests/unit/services/wallet-cuentas-paginado.test.ts` (NUEVO) | 13 | equivalencia con la busqueda de cliente (25 textos), pagina/total, orden, dinero del conjunto, acotamiento por rol |
| `tests/unit/repositories/cuentas-por-pagar-paginado-where.test.ts` (NUEVO) | 8 | las CONSULTAS: que la agregacion no lleve `where`/`take`/`skip`, que los nombres se pidan del conjunto, dos consultas y ni una mas, filtro antes del recorte, orden independiente de la base |
| `tests/unit/actions/wallet-mensajero-actions.test.ts` (+7) | 22 | el borde: defaults del dominio, recorte del `pageSize`, lista blanca, busqueda tal cual, forbidden/unauthenticated |
| `tests/unit/config/paginacion-dominios.test.ts` (reescrito 1 caso) | 5 | el septimo dominio y los 13 de 13 |

**El test de R45 compara 25 TEXTOS, no un caso feliz**: vacio, solo espacios, parcial en
minusculas, en mayusculas, mezcla de caja, con espacios alrededor, subcadena que no es prefijo,
con acento y sin el en los dos sentidos, vocal acentuada suelta, `ñ`, homonimos, `%`, `a_m`, `_`,
espacio interior, una sola letra y sin resultados. Para cada uno recorre TODAS las paginas y
compara contra `busquedaDeCliente(conjunto)`, con el filtro **copiado literalmente** de
`CuentasPorPagarTable.tsx` (vive dentro de un `useMemo`, no hay nada que importar).

**Tres anti-vacuidades**, porque un test que compara `[]` con `[]` pasa siempre:

1. los ids esperados de cada texto estan escritos **A MANO** en la bateria, no derivados de
   ninguna de las dos implementaciones (dos de ellos estaban mal la primera vez y el test me
   corrigio a mi, no al codigo);
2. se afirma que **22 de los 25 devuelven filas**;
3. se afirma el tamano de la bateria (25) y el del conjunto (12 filas).

---

## 7. Las once mutaciones, con su salida real

**Todas revertidas** (`grep MUTACION lib/ tests/` sin marcadores propios; suite completa verde
despues).

| # | Mutacion | Resultado medido |
| --- | --- | --- |
| 1 | **R45**: la busqueda se vuelve insensible a acentos («mejora» razonable) | **ROJO (1)**: `«jose» (SIN acento: NO alcanza a «josé pérez»): expected […(2)] to deeply equal ['m-05\|640.50\|40.50\|600.00\|positivo']` |
| 2 | **R45**: la busqueda se ignora — el servidor devuelve siempre el conjunto | **ROJO (6)** en los dos archivos |
| 3 | **R45 (la del encargo)**: el filtro se aplica DESPUES del recorte — se busca dentro de la pagina | **ROJO (5)**: `CONTRAPRUEBA de R45: expected [] to deeply equal ['m-07']`, el total, el dinero y la bateria |
| 4 | **R44 (la del encargo)**: el guard de rol DESPUES de tocar la base | **ROJO (1)**: `rol mensajero: expected […(2)] to deeply equal []` |
| 5 | **R41**: `total: items.length` | **ROJO (4)**: `expected 5 to be 12`, `expected 1 to be 3`, la bateria y R44 |
| 6 | **R49 en la CONSULTA**: `take: 50` en la agregacion del dinero | Servicio: **VERDE (13)** · Repositorio: **ROJO (1)** — ver §6 |
| 7 | **R51**: sin orden, se pagina lo que la base devuelva | Servicio: **ROJO (3)** · Repositorio: **ROJO (2)** |
| 8 | **R51**: orden por nombre SIN desempate por id (deja de ser total) | **ROJO (1)**: `conserva el orden…` con los dos homonimos |
| 9 | **R44 borde**: `.strict()` → `.passthrough()` | **ROJO (1)**: `{"mensajeroId":"m1"}: expected 'ok' to be 'validation_error'` |
| 10 | **R44 borde**: se quita el `.strict()` final (se conserva el `.extend()`) | **VERDE (22)** — confirma el hallazgo de T K.1: `.extend()` HEREDA el `.strict()` del schema base. Se deja escrito igual: la barrera es de este listado y no debe depender de que el base nunca se afloje |
| 11 | **R45**: el servicio no pasa `busqueda` al repositorio | **ROJO (6)**, incluida `la búsqueda no amplía el alcance…` |

Las dos que el encargo exigia son la **1/2/3/11** (busqueda de servidor que no reproduce la de
cliente) y la **4** (acotamiento por rol). La **6** es la demostracion, medida por cuarta vez,
del punto ciego de los dobles.

---

## 8. Mapa `R<n> → archivo::test`

Prefijos: `S/` = `tests/unit/services/wallet-cuentas-paginado.test.ts`,
`Q/` = `tests/unit/repositories/cuentas-por-pagar-paginado-where.test.ts`,
`B/` = `tests/unit/actions/wallet-mensajero-actions.test.ts`,
`C/` = `tests/unit/config/paginacion-dominios.test.ts`.

| R | Test |
| --- | --- |
| **R40** | `S/::devuelve la página pedida y el total del conjunto (R40, R41)` |
| **R40** | `S/::acota el tamaño de página al máximo configurado y nunca lo excede (R40)` |
| **R40** | `B/::input vacío vale: es lo que pide la página 1, con los defaults del dominio (R40)` |
| **R40** | `B/::un pageSize desmedido se RECORTA al máximo, no se rechaza (R40)` |
| **R40** | `B/::un page no positivo muere en el borde (R40)` |
| **R40** | `C/::cada dominio nuevo declara default y maximo, y el default no supera el maximo` |
| **R40** | `C/::los siete dominios cubren los 13 listados del Anexo III` |
| **R40** | `C/::respeta overrides validos de entorno, dominio a dominio` |
| **R40** | `C/::ignora env no positivo o no numerico y cae al default de 25/100` |
| **R41** | `S/::devuelve la página pedida y el total del conjunto (R40, R41)` (en la ultima pagina y en la vacia, `total !== items.length`) |
| **R41** | `S/::el total responde a la búsqueda, no al conjunto entero (R41)` |
| **R41** | `S/::un conjunto vacío devuelve página vacía y total 0, no un error (R41)` |
| **R41** | `Q/::el filtro por nombre se aplica ANTES del recorte, y el total es el del conjunto filtrado (R41, R45)` |
| **R41** | `Q/::una página más allá del final trae cero filas y el total del conjunto (R41)` |
| **R44** | `S/::el conjunto paginado y el listado sin paginar coinciden para el mismo actor (R44)` |
| **R44** | `S/::CONTRAPRUEBA de R44: forbidden sin filas ni total a todo rol sin acceso total` (5 roles, `llamadas === []`, y el otro lado con las 12 filas) |
| **R44** | `S/::la búsqueda no amplía el alcance: es el único dato del input que llega al repositorio (R44)` |
| **R44** | `B/::una clave de ALCANCE colada muere en el borde, sin llegar al service (R44)` |
| **R44** | `B/::sin sesión -> unauthenticated, sin tocar el service (R44)` |
| **R44** | `B/::forbidden del service pasa tal cual, sin filas ni total (R44)` |
| **R45** | `S/::para el mismo texto devuelve el mismo conjunto que la búsqueda de cliente (R45)` — **los 25 textos**, conjunto Y montos Y total |
| **R45** | `S/::CONTRAPRUEBA de R45: la búsqueda mira el CONJUNTO, no la página visible` |
| **R45** | `Q/::los nombres se piden para TODO el conjunto, no para la página (R45)` |
| **R45** | `Q/::el filtro por nombre se aplica ANTES del recorte… (R41, R45)` |
| **R45** | `B/::la búsqueda por nombre llega al service TAL CUAL, sin recortar (R45)` |
| **R51** | `S/::conserva el orden: el mismo, sea cual sea el orden en que la base devuelva las filas (R51)` — DESVIACION, ver §4 |
| **R51** | `S/::el orden de un texto filtrado es el del listado, no el de la base (R51)` |
| **R51** | `Q/::el orden no depende del orden en que la base devuelva los grupos (R51)` |
| **R49** | `S/::el dinero de cada fila sale del LIBRO ENTERO de ese mensajero, no de la página (R49)` |
| **R49** | `Q/::la agregación del dinero NO lleva where, ni take, ni skip: mira el libro entero (R49)` |
| **R49** | `Q/::los montos de la página son los del libro entero de cada mensajero (R49)` |
| **R54** | `S/::no ejecuta más consultas que el listado sin paginar, ni siquiera la del conteo (R54)` |
| **R54** | `Q/::son exactamente DOS consultas: la agregación y los nombres, sin conteo aparte (R54)` |

**R42, R43, R46, R47, R48, R50, R52, R53 NO entran en esta task** y no se declaran cubiertos:
son T L.2 y la tanda M. (R44, R49 y R54 tampoco los pide `tasks.md` para L.1; se afirman porque
son dinero y porque el encargo lo exigia explicitamente.)

**Sobre el dinero del conjunto (R49) en esta pantalla:** el listado **no tiene un agregado de
cabecera** —no hay «total a pagar» sumado sobre la tabla—, asi que la trampa que la tanda J
midio (un total que dice 0 cuando se deben 500) no puede darse aqui por esa via. Lo que si es un
agregado del conjunto es **cada celda**: `devengado`/`pagado`/`cuentaPorPagar` son la suma del
libro entero de ese mensajero. El test lo fija en los dos sentidos: la suma de las 12 filas es
`2410.75`, la de una pagina de 5 es estrictamente menor y NO llega a ese numero, y la suma de
todas las paginas vuelve a ser `2410.75`, fila a fila con los mismos strings.

---

## 9. Traspaso concreto a T L.2 (frontend)

Lo disponible, listo para cablear:

| Necesidad de la pantalla | Server Action | Notas |
| --- | --- | --- |
| La tabla | `listarCuentasPorPagarPaginadoAction(input)` — `lib/actions/wallet-mensajero.ts` | `{ status, items, page, pageSize, total }`; `input` vacio (o `undefined`) = pagina 1 con los defaults del dominio |
| El conjunto para la descarga | `listarCuentasPorPagarAction()` (**sin cambios**) | sigue trayendo el listado entero |
| Tamano de pagina | `walletMensajeroConfig` — `lib/config/wallet-mensajero.ts` | 25/100. **Un literal en `app/` pone roja la guardia de T H.1** |

**Siete cosas que T L.2 tiene que saber y que no se deducen del tipo:**

1. **`busqueda` viaja SIN normalizar.** El borde no recorta ni pasa a minusculas a proposito
   (§ el schema): normaliza el filtro, en un solo sitio. La pantalla manda el texto del `<Input>`
   tal cual. Un texto de solo espacios significa «sin filtro», igual que hoy.
2. **La busqueda debe hacer volver a la pagina 1.** Si no, escribir tres letras estando en la
   pagina 3 dejaria la tabla vacia con un total que dice 2. Molde: `OrdenesModule`.
3. **El contador de cabecera.** Esta pantalla **hoy no tiene** contador de filas (la guardia de
   T H.3 no la registra, y esta bien: no hay nada que registrar). Si L.2 anade uno, tiene que
   salir del `total` del servidor y la pantalla tiene que entrar en el registro de
   `contadores-cabecera.guardia.test.ts` — **nunca de `items.length`** (R42).
4. **La descarga (R52) tiene que seguir entregando el CONJUNTO filtrado.** Hoy es
   `filasLocales(filtrados, …)` sobre el array de props. Al paginar hay que cablearla con
   `filasDelConjuntoCompleto` (`components/shared/descarga-resultado.ts`, T I.2), releyendo
   `listarCuentasPorPagarAction()` y **aplicando el filtro y el orden con las funciones de
   `lib/utils/cuentas-por-pagar-listado.ts`**: `filtrarPorBusquedaMensajero(filas, busqueda)` y
   `ordenarCuentasPorPagar(filas)`. Estan exportadas para eso. Si se reimplementa el filtro en
   la pantalla, el archivo y la tabla podran divergir sin que nadie lo note — que es lo que R11
   prohibe. **No se anadio un `listarCuentasPorPagarCompleto(busqueda)` al backend** porque
   `tasks.md` no lo pide para L.1; ver Q-L2.
5. **La fila expandible NO se toca.** `DesglosePagosMensajero` pide su propio desglose con
   `listarPagosDeMensajeroAction(mensajeroId)`, que es independiente de esta pagina. Lo que L.2
   debe probar (R50) es que expandir **en la pagina 2** sigue funcionando: la clave de expansion
   del `DataTable` es `rowKey="mensajeroId"`, asi que cambiar de pagina cambia el conjunto de
   filas expandibles. Ojo con dejar una fila expandida al paginar.
6. **`DESGLOSE_PAGE_SIZE = 20` de `DesglosePagosMensajero.tsx` es deuda preexistente declarada**
   (T H.1) y ahora tiene donde ir: `walletMensajeroConfig`. Ese archivo **no** esta en
   `PANTALLAS_ANEXO_III`, asi que la guardia no obliga; arreglarlo es opcional y es de L.2.
7. **El orden que vera el usuario es NUEVO** (alfabetico donde no habia ninguno). Si L.2 anade
   un contador o un texto de estado vacio, que no prometa otro orden.

---

## 10. Preguntas abiertas (NO se rellenaron con supuestos)

**Q-L1 — ¿Se acepta que este listado recorte fuera de la base?** Ver §5. Es la hermana exacta de
**Q-I1** («Saldos de tiendas»), sigue sin respuesta del humano, y aqui pesa lo mismo: correcto y
sin consultas nuevas, pero sin reduccion de trabajo en Postgres. La alternativa
(`$queryRaw` con `GROUP BY … JOIN usuario … LIMIT/OFFSET`) es mejor en base y **cambiaria la
semantica de la busqueda** (`ILIKE` vs `includes`, §5.2), asi que no es un cambio interno: es un
cambio de lo que el usuario ve. Si el humano la quiere, hay que decidir antes si acepta que `%`
pase a ser comodin.

**Q-L2 — El conjunto completo con la busqueda para la descarga no existe como metodo.** Ver §9.4.
Hermana de Q-I5, Q-J1 y Q-K4. La via recomendada para L.2 (releer + filtrar con las funciones de
`lib/utils/`) **no es una regresion** —es literalmente lo que la pantalla hace hoy— pero deja el
conjunto entero cruzando al cliente en el momento de descargar. Cerrarla es un
`listarCuentasPorPagarCompleto(busqueda)` en la tanda M.

**Q-L3 — El orden alfabetico es una DESVIACION visible de R51.** Ver §4. Es la minima que hace
la paginacion correcta, pero cambia lo que el maestro ve hoy. Misma pregunta que Q-I2, ahora en
una segunda pantalla — si el humano rechaza una, deberia rechazar las dos.

**Q-L4 — ¿La busqueda deberia ignorar acentos?** Hoy NO los ignora, ni en el navegador ni en el
servidor, y esta tanda lo conserva porque R45 pide el mismo conjunto. Pero un maestro que
escriba «jose» no encuentra a «José Pérez», y eso es un defecto de usabilidad **preexistente**
que la paginacion hace mas visible (antes la fila seguia a la vista mas abajo; ahora puede estar
en otra pagina). Si el humano quiere cerrarlo, la via existe y esta probada en el repo (la
columna generada de la 169 normaliza en Postgres espejando a Node) y **la mutacion 1 de §7 dice
exactamente que test habria que cambiar**. No se hizo porque seria un cambio de comportamiento
que nadie pidio, en la tanda que menos margen tiene para ellos.

**Heredadas y NO resueltas aqui:** Q-I1, Q-I2, Q-I5, Q-J1, Q-J2, Q-J3 (los ocho schemas de
pagina escritos a mano — este listado NO entra en esa lista: usa `paginaInputSchema`), Q-J4,
Q-K1, Q-K2, Q-K4, Q-K6, Q-K7 y la deuda **D5.2**.

---

## 11. Decisiones tomadas al implementar

1. **Nace el septimo dominio de configuracion** en vez de reusar `wallet-tienda`. Ver §2.
2. **La busqueda y el orden se extraen a `lib/utils/`**, como T I.1 hizo con `colas-cierre.ts` y
   T K.1 con `estados-bodega-satelite.ts`. Motivo, no estetica: el MISMO criterio lo va a
   necesitar la descarga de L.2, y dos escrituras del mismo filtro en dos capas es como una fila
   se cae de un listado sin que nadie lo note.
3. **`aResumen()` se extrae en el servicio.** Las dos lecturas (entera y paginada) derivan la
   cuenta por pagar con `derivarCuentaPorPagar`; dos copias de esa proyeccion son dos
   oportunidades de que la pagina y el dataset completo declaren montos distintos.
4. **El contrato no gana campos.** La pagina devuelve `{ items, page, pageSize, total }` y nada
   mas (T H.2).
5. **`listarCuentasPorPagar()` no se toca**, ni siquiera para darle el orden nuevo: es lo que
   sostiene la pantalla hasta que llegue L.2 y es la referencia contra la que se mide el
   paginado. L.2 le aplica el orden con `ordenarCuentasPorPagar` cuando lo necesite (§9.4).
6. **El guard de rol va SIEMPRE antes de la base.** Medido con `llamadas === []` para cinco
   roles y verificado por la mutacion 4.
7. **Las Server Actions entran en L.1**, no en L.2 (`docs/architecture.md`: «Server Action =
   controlador»). Ninguna toca UI.
8. **`paginaInputSchema` se reusa via `.extend()`**, como los cuatro listados de la tanda J.
9. **Cero migraciones, cero RLS nueva, cero cambio de esquema.** Las dos consultas son las que ya
   existian.

---

## 12. Archivos

**Nuevos (4)**

- `lib/config/wallet-mensajero.ts` — el septimo dominio de paginacion.
- `lib/utils/cuentas-por-pagar-listado.ts` — busqueda por nombre + orden, declarados una vez.
- `tests/unit/services/wallet-cuentas-paginado.test.ts` (13)
- `tests/unit/repositories/cuentas-por-pagar-paginado-where.test.ts` (8)

**Modificados — produccion (5)**

- `lib/repositories/PagoMensajeroMovimientoRepository.ts` — el metodo paginado.
- `lib/interfaces/repositories/IPagoMensajeroMovimientoRepository.ts` — `CuentasPorPagarFiltro` +
  el contrato.
- `lib/services/WalletMensajeroService.ts` — `listarCuentasPorPagarPaginado` + `aResumen`.
- `lib/interfaces/services/IWalletMensajeroService.ts` — resultado y contrato.
- `lib/types/wallet-mensajero.ts` — schema `.strict()` + tipo de borde.
- `lib/actions/wallet-mensajero.ts` — la Server Action.

**Modificados — tests (7)**

- `tests/unit/actions/wallet-mensajero-actions.test.ts` — +7 casos de borde propios; el doble del
  servicio declara el metodo nuevo.
- `tests/unit/config/paginacion-dominios.test.ts` — el septimo dominio; `12 de 13` pasa a `13`.
- **Solo para declarar el metodo nuevo en su doble** (una linea cada uno, **ninguna asercion
  existente se toco**): `tests/unit/services/wallet-mensajero-service.test.ts`,
  `tests/unit/repositories/cierres-admin-repository.test.ts`,
  `tests/unit/repositories/CierresAdminRepository.resolverCierre.devolucion.test.ts`,
  `tests/unit/repositories/cierres-admin-indemnizacion.test.ts`,
  `tests/integration/db/cierre-detail-congelado.test.ts`,
  `tests/integration/db/wallet-idempotencia.test.ts`.

**Cero UI, cero migraciones, cero RLS, cero cambios de esquema.**

---

## 13. Puertas (medicion final, salida real)

```
$ npx tsc --noEmit
=== typecheck exit: 0 ===

$ npx eslint
✖ 27 problems (0 errors, 27 warnings)
(baseline de la tanda K: 25 warnings. Las 2 nuevas son los `_args` sin usar del delegado Prisma
falso de `cuentas-por-pagar-paginado-where.test.ts`, el MISMO patron —y las mismas dos lineas—
que ya tienen sus hermanos `historicos-paginados-where.test.ts`, `colas-paginadas-where.test.ts`
y `satelite-paginado-where.test.ts`.)

$ npx vitest run
 Test Files  747 passed (747)
      Tests  8984 passed (8984)
   Duration  217.21s

$ ./init.sh
✓ test paso
✓ todas las migraciones tienen down.sql
✓ .env presente
== init OK ==
```

Suite completa **en verde a la primera**, sin flakes (el conocido `OrdenesModuleReuse` paso en
las dos corridas). Baseline de la tanda K: 745 archivos / 8956 tests → **+2 archivos y +28
tests**.

---

## 14. Veredicto (T L.1)

La busqueda por nombre de «Cuentas por pagar a mensajeros» se resuelve ahora en el servidor y
devuelve, para los mismos 25 textos —acentos, mayusculas, espacios, comodines de SQL y sin
resultados—, exactamente el mismo conjunto que el filtro de cliente copiado literal, con el
total del conjunto filtrado y sin que la agregacion del dinero mire nunca la pagina; el listado
gana ademas el orden total que no tenia y el dominio de configuracion que le faltaba, con lo que
el registro de T H.1 pasa de 12 a 13 de 13. Once mutaciones lo confirmaron y una de ellas —la
que recorta la agregacion del dinero— paso verde en los trece tests de servicio y solo la vio el
test de consultas.

---
---

# T L.2 — Frontend: paginacion, busqueda de servidor y fila expandible

**Rol:** `frontend_dev` · **Fecha:** 2026-08-01 · **Alcance:** SOLO capa de presentacion.
**Cero cambios** en `lib/services`, `lib/repositories` ni Server Actions (no hubo defecto que
declarar: las dos acciones de T L.1 se cablearon tal cual).

Baseline al empezar: `tsc` 0, `eslint` 0 errores / 27 warnings, suite 747 archivos / 8984
tests, `git status` limpio.

---

## 15. Donde vive cada cosa, y por que NO se partio la pantalla

La bodega satelite (T K.3) tuvo que mover la capa de datos al modulo padre. Aqui **todo se
queda en `CuentasPorPagarTable.tsx`**, y es una decision, no inercia:

1. **No hay `mutate` que delegar.** Esta pantalla no ejecuta ninguna accion: se lee y se
   descarga. El motivo por el que la satelite necesitaba un padre —seis handlers que releen
   tras mutar— aqui no existe.
2. **La guardia de T H.3 mira del archivo que monta `<Pagination>` hacia los que importa,
   nunca hacia arriba** (Q-I6). Con control, tabla y contador en el MISMO archivo, la guardia
   los ve los tres sin depender de ningun import.
3. **`CuentasPorPagarTable.tsx` ya estaba en `PANTALLAS_ANEXO_III`** (guardia de T H.1): es
   donde el literal de `pageSize` se habria escrito, y donde la guardia lo vigila.

El Server Component cambia una linea de fondo: pre-carga `listarCuentasPorPagarPaginadoAction({})`
—la pagina 1 con los defaults del dominio— en vez del listado entero, y baja
`{ items, total, pageSize }`. El `notFound` por rol y la defensa en profundidad no se tocan.

---

## 16. Los requisitos, uno a uno

### R43 — control de navegacion

`<Pagination>` bajo la tabla, con `showFirstLast`, `siblingCount={1}` y selector de tamaño
`[10, 25, 50]` acotado por `MAX_PAGE_SIZE` (el literal NO se escribe: sale de
`walletMensajeroConfig`). Nombre accesible propio, `PAGINACION_CUENTAS_LABEL` = «Paginación de
las cuentas por pagar»: **esta pantalla tiene DOS controles de paginas a la vez** en cuanto se
despliega una fila —el del listado y el del desglose de esa fila, «Paginación del desglose de
X»—, asi que un `<nav>` llamado «Paginación» a secas no identificaria ninguno. El test los
localiza por nombre y afirma que conviven.

### R45 — la busqueda pasa al servidor, con dos decisiones propias

El `<Input>` sigue siendo el mismo (mismo `aria-label`, mismo placeholder, misma etiqueta) y
lo que cambia es a donde va lo escrito. Dos cosas que no se deducen del contrato:

- **vuelve a la pagina 1.** Sin eso, escribir tres letras estando en la pagina 3 dejaria la
  tabla vacia junto a un contador que dice que hay treinta resultados. Es lo que el traspaso de
  T L.1 (§9.2) pedia y lo que hace `OrdenesModule`;
- **espera a que el usuario deje de escribir.** El campo responde al instante (estado propio);
  lo que se aplaza es la CONSULTA, con la misma espera que `FilterComponent` aplica a cualquier
  filtro —se importa su constante, no se copia el numero—. No es cosmetica: cada lectura de
  este listado **agrega el libro entero de cada mensajero** (T L.1 §5), asi que un nombre de
  diez letras sin espera serian diez agregaciones completas del ledger. Hay test que lo mide:
  escribir «Ana» es UNA lectura con `busqueda`, no tres.

Lo que se compara para decidir si hay busqueda nueva es lo **normalizado**, con
`normalizarBusquedaMensajero` —la MISMA funcion que usa el servidor para decidir que filas
casan—: añadir un espacio al final de un termino ya aplicado no es una busqueda nueva y no debe
costar una consulta ni mover la pagina. El texto que viaja, en cambio, va **TAL CUAL** (T L.1
§9.1): normalizar en dos sitios es como la pantalla y el servidor acaban entendiendo cosas
distintas por «texto vacio».

### R42 — el contador que esta pantalla no tenia

**Nace uno**, y es el unico añadido visible que no estaba en el encargo. El motivo: mientras el
navegador recibia el conjunto entero, «cuantos mensajeros hay» se contaba mirando la tabla;
paginando, esa cuenta desaparece —el `<Pagination>` dice «Página 1 de 3», no cuantas filas hay—
y **buscar deja de decir cuanto encontro**. Sin filtro dice «60 mensajeros»; con busqueda
puesta, «30 de 60 mensajeros». Los DOS numeros son del servidor: el primero es el `total` de la
pagina vigente (que responde a la busqueda) y el segundo el `total` sin busqueda que resolvio
el Server Component. **Ninguna segunda llamada**: los dos ya estaban en la respuesta.

Sin filtro solo se muestra un numero, como en la satelite: «60 de 60 mensajeros» no dice nada
que «60 mensajeros» no diga.

La pantalla **entra en el registro de la guardia de T H.3** con las dos formas de su contador y
con una prohibicion escrita en general —ningun texto interpolado de ese archivo puede salir de
un `.length`—, que cubre las tres maneras de escribir la misma mentira (`items.length`,
`data?.items.length` y `(data?.items ?? []).length`) de una vez.

### R50 — la fila expandible, que es el punto delicado

Se conserva tal cual (`rowKey="mensajeroId"`, `renderExpanded`, `expandAriaLabel`) y **eso es
justo lo que habia que probar**: la fila que llega a `renderExpanded` es la de la pagina
visible, y `DesglosePagosMensajero` pide SU desglose por `mensajeroId`. El test lo hace en la
**pagina 3**, con el mensajero 51 —que debe ₡500.00—, y afirma tres cosas: que la region que se
abre lleva SU nombre, que la Server Action del desglose se llamo con SU `mensajeroId` (y no con
el de la fila que ocupaba esa posicion en la pagina 1) y que el dinero que enseña es el de su
libro entero.

R50 dice ademas que cambiar de pagina no altera «los totales agregados ni el estado de los
formularios». Aqui el formulario es el buscador y los agregados son las celdas: hay un caso que
pagina con una busqueda puesta y comprueba que el texto sigue escrito, que sigue aplicado y que
los importes de la fila son los STRING del servidor.

### R52 — la descarga sigue entregando el conjunto

Se sigue la **recomendacion del traspaso (§9.4)**, sin desviarse: al pulsar el control se RELEE
`listarCuentasPorPagarAction()` —el mismo listado que la pantalla llamaba antes de paginar,
acotado server-side a los roles de acceso total: descargar no amplia el alcance ni una fila— y
se le aplican **`filtrarPorBusquedaMensajero` y `ordenarCuentasPorPagar` de
`lib/utils/cuentas-por-pagar-listado.ts`**, las MISMAS que el servidor usa para armar la
pagina. No se reescribe el filtro en la pantalla a proposito: dos escrituras del mismo criterio
en dos capas es exactamente como una fila acaba en la tabla y no en el archivo (R11). Todo eso
alimenta `filasDelConjuntoCompleto` (T I.2), que conserva el tope de 5000 y su mensaje
accionable.

**Q-L2 sigue abierta y no se cierra aqui**: falta `listarCuentasPorPagarCompleto(busqueda)`, y
crearlo es backend (§21).

---

## 17. Donde se prueba cada cosa

| Archivo | Tests | Que prueba |
| --- | --- | --- |
| `tests/components/paginacion/CuentasPorPagarPaginacion.test.tsx` (NUEVO) | 8 | los tres casos que exige T L.2 + el primer pintado, el contador en la ultima pagina, la busqueda que vuelve a la pagina 1, el desglose que no se arrastra entre paginas y la descarga CON busqueda |
| `tests/components/CuentasPorPagarTable.test.tsx` (+1, adaptado) | 6 | columnas, montos, expand y la busqueda —ahora de servidor—, mas que el texto viaja tal cual y una rafaga es UNA lectura |
| `tests/components/descarga/WalletPropsDescarga.test.tsx` (adaptado) | 5 | el archivo de las tres tablas de dinero; el caso estatico pasa a exigir que las TRES relean |
| `tests/components/descarga/ControlDescargaTransversal.test.tsx` (adaptado) | 7 | la tercera forma del rollout, ahora «Familia B paginada con busqueda de servidor»; descargar no vuelve a pedir la pagina |
| `tests/integration/wallet-mensajeros-page.test.tsx` (+1) | 9 | el Server Component pre-carga la PAGINA 1 y baja el `total` del CONJUNTO (30), no el de la pagina (2) |
| `tests/unit/descarga/contadores-cabecera.guardia.test.ts` (+1) | 5 | la guardia estatica de R42, ahora con esta pantalla dentro |

**El doble de la Server Action FILTRA Y RECORTA de verdad**, y su filtro esta reimplementado en
el test en vez de importar `filtrarPorBusquedaMensajero`: esa funcion es la que la PANTALLA usa
para el archivo, asi que reusarla haria que el test midiera el codigo contra si mismo.

**Los datos estan repartidos para que pagina, busqueda y conjunto sean TRES numeros distintos:**
60 mensajeros, paginas de 25, y un apellido por mitad (30 y 30). Treinta es mas que una pagina
y menos que el conjunto, asi que con una busqueda puesta el archivo solo puede tener 30 filas
si de verdad relee y filtra: 25 seria la pagina y 60 el conjunto sin filtrar. **Esto no estaba
bien a la primera** y lo dice la mutacion 10 (§18).

---

## 18. Las diez mutaciones, con su salida real

**Todas revertidas** (`grep MUTACION app/` sin resultados; suite completa verde despues).

| # | Mutacion | Resultado medido |
| --- | --- | --- |
| 1 | **R50 (la del encargo)**: `renderExpanded` resuelve el resumen contra `initialData.items` (la pagina 1) | **ROJO (2)**: `Unable to find role="region" and name "Desglose de Mensajero 51 Solís"` y el de la pagina 2 |
| 2 | **R52 (la del encargo)**: `obtenerFilas` proyecta `data.items` — «descargá lo que ves» | **ROJO (2)**: `expected […(10)] to have a length of 60 but got 10` y `expected […(25)] to have a length of 30 but got 25` |
| 3 | **R52 (b)**: se relee el conjunto pero se IGNORA la busqueda vigente | **ROJO (3)** en tres archivos: `to have a length of 20 but got 60` y los dos casos de la descarga con filtro |
| 4 | **R45**: la busqueda no devuelve la tabla a la pagina 1 | **ROJO (1)**: `expected [] to deeply equal ['Mensajero 01 Rojas', …(19)]` — la tabla vacia con un contador que dice 30 |
| 5 | **R45**: la busqueda se queda en el navegador, sobre la pagina visible | **ROJO (4)**: `expected ['Mensajero 21 Vega', …(4)] to deeply equal [… (19)]` — encuentra solo los que ya estaban a la vista |
| 6 | **R42**: el contador sale de `data.items.length` | **ROJO (1)** de comportamiento (`60 mensajeros` → `10 mensajeros` en la ultima pagina) **y ROJO (1)** en la guardia estatica de T H.3 |
| 7 | **R43**: se quita el `ariaLabel` del control | **ROJO (6)**: todos los casos que navegan dejan de encontrar el `<nav>` por nombre |
| 8 | **R44**: se quita el `fallbackData` de SWR | **ROJO (6)**, empezando por `el usuario ve las mismas filas que antes en el PRIMER pintado` |
| 9 | **La espera de la busqueda**: el texto viaja en cada tecla | **ROJO (1)**: `expected […(3)] to have a length of 1 but got 3` |
| 10 | **R50**: cambiar de pagina limpia el buscador | **VERDE** la primera vez — ver abajo. Tras corregir el fixture: **ROJO (1)**, `expected '' to be 'Solís'` |

Las dos que el encargo exigia son la **1** (expandir roto fuera de la pagina 1) y la **2**
(descargar la pagina en vez del conjunto).

**Sobre la 8**, que es el aviso medido de la tanda I: el test del primer pintado NO espera. Con
`await`/`findBy*`, quitar el `fallbackData` pasaba VERDE —la pantalla enseñaba un esqueleto y
las filas aparecian tras un viaje al servidor por un dato que ya venia en la respuesta— y aqui
se comprueba que sigue sin colar.

**Sobre la 10, que es el hallazgo de esta tanda.** Paso VERDE, y el fallo era del TEST: el caso
buscaba un apellido de 20 filas con paginas de 25, asi que el conjunto filtrado cabia entero en
una pagina, «Página siguiente» estaba deshabilitado y el test pulsaba un boton inerte antes de
dar por buena la busqueda. Un caso que navega sin navegar afirma exactamente nada. Se rehizo el
reparto de datos (30/30, §17) y la mutacion cayo; de paso, la **mutacion 2 pasa a caer tambien
en el caso con busqueda**, que antes solo veia el de sin ella. Es el mismo genero de punto ciego
que las tandas I-K midieron en los dobles del repositorio, pero en la capa de arriba: **el dato
de prueba puede hacer vacio un caso sin que nada falle**.

---

## 19. Mapa `R<n> → archivo::test`

Prefijos: `P/` = `tests/components/paginacion/CuentasPorPagarPaginacion.test.tsx`,
`T/` = `tests/components/CuentasPorPagarTable.test.tsx`,
`W/` = `tests/components/descarga/WalletPropsDescarga.test.tsx`,
`X/` = `tests/components/descarga/ControlDescargaTransversal.test.tsx`,
`I/` = `tests/integration/wallet-mensajeros-page.test.tsx`,
`G/` = `tests/unit/descarga/contadores-cabecera.guardia.test.ts`.

| R | Test |
| --- | --- |
| **R40** | `I/::pre-carga la PÁGINA 1 con el total del conjunto, no el listado entero (R40/R41)` |
| **R41** | `I/::pre-carga la PÁGINA 1 con el total del conjunto…` — `total` 30 ≠ `items.length` 2 |
| **R42** | `P/::navega entre páginas (R43)` — el contador dice 60 en la ULTIMA pagina, que trae 10 |
| **R42** | `P/::la búsqueda mira el CONJUNTO y devuelve a la página 1 (R45)` — «30 de 60 mensajeros» |
| **R42** | `G/::el contador de las cuentas por pagar dice el total del servidor, y su pantalla se vigila` |
| **R43** | `P/::navega entre páginas (R43)` — `<nav>` por rol y nombre, siguiente/ultima/primera, y las filas CAMBIAN |
| **R43** | `P/::expandir el desglose funciona en cualquier página (R50)` — los DOS controles de paginas conviven, cada uno con su nombre |
| **R44** | `P/::el usuario ve las mismas filas que antes en el PRIMER pintado (R44)` — sin `await` |
| **R45** | `P/::la búsqueda mira el CONJUNTO y devuelve a la página 1 (R45)` — se busca desde la pagina 3, donde no hay ni un «Rojas» |
| **R45** | `T/::filtra la lista por nombre de mensajero sin tocar montos` |
| **R45** | `T/::el texto viaja TAL CUAL al servidor y una ráfaga de teclas es UNA sola lectura` |
| **R50** | `P/::expandir el desglose funciona en cualquier página (R50)` — pagina 3, el mensajero que debe ₡500.00 |
| **R50** | `P/::expandir en la página 1 no arrastra el desglose a las demás (R50)` |
| **R50** | `P/::cambiar de página no toca lo escrito en el buscador ni los importes de la fila (R50)` |
| **R52** | `P/::la descarga sigue entregando el dataset completo (R52)` — desde la pagina 3: 60 filas, no las 10 que se ven |
| **R52** | `P/::la descarga con búsqueda entrega el conjunto filtrado, no la página (R52)` — 30, ni 25 ni 60 |
| **R52** | `W/::cuentas por pagar exporta solo lo que la búsqueda deja a la vista` |
| **R52** | `W/::las tres paginan y NINGUNA proyecta la página: releen el conjunto completo` |
| **R52** | `X/::descargar no altera la página, la búsqueda ni las filas visibles` — descargar NO vuelve a pedir la pagina |

**R46/R47/R48 no aplican a esta pantalla**: no tiene desplegables derivados del conjunto ni
seleccion de filas. **R40/R41/R51 los cubre T L.1** (§8) y no se declaran cubiertos aqui; lo que
esta pantalla añade es que el contrato se cablea sin perder nada por el camino.

---

## 20. Decisiones de T L.2

1. **La pantalla deja de recibir el conjunto entero por props.** La alternativa —seguir
   recibiendolo «total, ya esta»— habria dejado R52 verde sin escribir una linea y convertido
   la paginacion en maquillaje (T I.2 §14, mismo argumento).
2. **Nace un contador de cabecera** (§16, R42). Es el unico añadido visible que no pedia el
   encargo, y va con su motivo: paginar deja al maestro sin saber cuantos mensajeros hay ni
   cuantos encontro su busqueda.
3. **La espera antes de consultar se importa, no se escribe.** `DEBOUNCE_MS_DEFAULT` de
   `FilterComponent` es la decision que la app ya tomo para «cuanto se espera antes de
   consultar por un filtro»; un `500` suelto aqui seria un segundo numero que actualizar.
4. **El buscador NO se deshabilita mientras carga.** Perder teclas de un nombre a medio
   escribir es peor que esperar a que llegue la pagina. El `<Pagination>` si se deshabilita,
   como en las tandas I y K.
5. **El esqueleto se muestra solo si NO hay nada que pintar** (`data === undefined`), no
   mientras SWR revalida con `fallbackData`. Arreglo de T I.2 heredado tal cual.
6. **Un resultado que no sea `ok` se LANZA** en el fetcher: la tabla enseña «No se pudieron
   cargar las cuentas por pagar.» en vez de una tabla vacia, que se leeria como «nadie debe
   nada» — lo contrario de lo que pasa.
7. **El estado vacio no se toca.** Una busqueda sin resultados enseña el mismo texto que hoy;
   cambiarlo seria un cambio de UI que nadie pidio, en la tanda con menos margen para ellos.
8. **La descarga reusa las funciones de `lib/utils/`** en vez de reimplementar el filtro
   (§16, R52).
9. **Cero cambios en `lib/`**, cero migraciones, cero RLS. `censo-tablas.ts` no se toca: la
   tabla no se muda ni nace otra.

---

## 21. Preguntas abiertas de T L.2

**Q-L2 — SIGUE ABIERTA, y ahora tiene codigo que la sostiene.** La descarga relee
`listarCuentasPorPagarAction()` y filtra en memoria con las funciones del servidor. No es una
regresion —es literalmente lo que la pantalla hacia—, pero **el conjunto entero vuelve a cruzar
al cliente en ese momento**, solo que ahora unicamente al pulsar «Descargar» en vez de en cada
render. Cerrarla es `listarCuentasPorPagarCompleto(busqueda)` en el backend (tanda M); con el,
la pantalla dejaria de importar `filtrarPorBusquedaMensajero`.

**Q-L5 — NUEVA: la espera de la busqueda es un comportamiento que el humano no ha visto.** Es
la misma que la app aplica a cualquier filtro y esta medida (mutacion 9), pero es lo unico de
esta tanda que el operador nota como «la pantalla tarda»: antes filtraba en la misma tecla.
Bajarla o subirla es una linea; **no se toca sin que alguien lo use**, porque el precio de
acortarla lo paga Postgres agregando el ledger entero una vez por tecla.

**Q-L6 — NUEVA: `DESGLOSE_PAGE_SIZE = 20` sigue siendo un literal.** El traspaso (§9.6) lo
dejaba como opcional para L.2 ahora que existe `walletMensajeroConfig`. **No se hizo**: ese
tamaño es el del DESGLOSE de una fila, no el del listado del Anexo III, y colgarlo del mismo
dominio ataria dos cosas que crecen por motivos distintos —exactamente el argumento con el que
T L.1 rechazo colgar este listado de `wallet-tienda` (§2)—. Si se quiere config, es un dominio
propio y es de la tanda M.

**Q-L7 — NUEVA: el contador no dice «de cuantos» cuando no hay busqueda.** Con filtro dice «30
de 60»; sin el, «60 mensajeros» a secas. Es deliberado (§16) y es lo que hace la satelite, pero
si el humano prefiere ver siempre los dos numeros es un cambio de una linea.

**Heredadas y NO resueltas aqui:** Q-L1 (el recorte fuera de la base), Q-L3 (el orden alfabetico
como desviacion visible de R51), Q-L4 (la busqueda no ignora acentos —y con la tabla paginada
la fila que no aparece puede estar en otra pagina, no mas abajo—), Q-I1, Q-I2, Q-I5, Q-J1, Q-J2,
Q-J3, Q-J4, Q-K1, Q-K2, Q-K4, Q-K6, Q-K7 y la deuda **D5.2**.

---

## 22. Archivos de T L.2

**Nuevos (1)**

- `tests/components/paginacion/CuentasPorPagarPaginacion.test.tsx` (8 tests).

**Modificados — produccion (2)**

- `app/(app)/wallet/mensajeros/page.tsx` — pre-carga de la PAGINA 1 (`{}` = defaults del
  dominio) y baja `{ items, total, pageSize }`.
- `app/(app)/wallet/mensajeros/_components/CuentasPorPagarTable.tsx` — SWR + busqueda de
  servidor con su espera + `<Pagination>` + contador + descarga del conjunto releido.

**Modificados — tests (5)**

- `tests/components/CuentasPorPagarTable.test.tsx` — monta la tabla con su pagina; el caso del
  filtro pasa a esperar al servidor y gana el de «tal cual + una sola lectura».
- `tests/components/descarga/WalletPropsDescarga.test.tsx` — el caso estatico «la que NO pagina
  no relee» desaparece (ya no queda ninguna de las tres) y las TRES exigen releer.
- `tests/components/descarga/ControlDescargaTransversal.test.tsx` — la tercera forma se
  redescribe y gana la afirmacion de que descargar no vuelve a pedir la pagina.
- `tests/integration/wallet-mensajeros-page.test.tsx` — el pre-fetch es el paginado; +1 caso
  que separa el `total` del conjunto del tamaño de la pagina.
- `tests/unit/descarga/contadores-cabecera.guardia.test.ts` — +1 caso: esta pantalla, sus dos
  formas de contador y la prohibicion general de interpolar un `.length`.

**Cero cambios en `lib/`, cero migraciones, cero RLS, cero cambios de esquema.**

---

## 23. Puertas de T L.2 (medicion final, salida real)

```
$ npx tsc --noEmit
=== typecheck exit: 0 ===

$ npx eslint
✖ 27 problems (0 errors, 27 warnings)      (baseline de T L.1: 27 warnings — sin delta)

$ npx vitest run
 Test Files  748 passed (748)
      Tests  8994 passed (8994)
   Duration  218.72s

$ ./init.sh
✓ test paso
✓ todas las migraciones tienen down.sql
✓ .env presente
== init OK ==
```

Baseline de T L.1: 747 archivos / 8984 tests → **+1 archivo y +10 tests**. Suite completa en
verde a la primera y sin flakes: el conocido `OrdenesModuleReuse` paso en las tres corridas.

---

## 24. Veredicto (T L.2)

«Cuentas por pagar a mensajeros» pinta ahora la pagina que le da el servidor, con un control de
navegacion propio y nombrado que convive con el del desglose sin confundirse, y un contador que
dice el total del servidor —60 estando a la vista 10—; la busqueda por nombre viaja al servidor
cuando el usuario deja de escribir, devuelve la tabla a la pagina 1 y encuentra las treinta
filas del conjunto aunque en la pagina visible no hubiera ninguna; expandir el desglose en la
pagina 3 abre el del mensajero de ESA fila y enseña los ₡500.00 de su libro entero; y la
descarga sigue entregando 60 filas cuando la tabla muestra 10, o las 30 que la busqueda deja a
la vista cuando la pagina enseña 25. Diez mutaciones lo confirmaron y se revirtieron; una paso
VERDE porque el dato de prueba hacia vacio el caso, y esa correccion va commiteada aparte.
