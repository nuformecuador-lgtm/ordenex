# impl — Feature 170, FASE 2, Tanda L (T L.1: cuentas por pagar a mensajeros)

**Rama:** `feature/170-fase2-tanda-l` · **Fecha:** 2026-08-01 · **Rol:** `backend_dev`
**Alcance:** SOLO T L.1 (servidor). **Cero UI**: no se toco `app/**` ni `components/**`; el
cableado es T L.2 y lo hace otro agente.

Todo lo que sigue esta MEDIDO. Las once mutaciones se ejecutaron y se revirtieron; una paso
VERDE en los tests de servicio y solo la vio el test de repositorio — la CUARTA vez que este
proyecto mide ese punto ciego.

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

| | ANTES (hoy en `dev`) | DESPUES (con L.1 + L.2) |
| --- | --- | --- |
| **Filas que recibe el navegador** | TODAS las cuentas por pagar, una por mensajero con movimientos | una pagina (25 por defecto, `WALLET_MENSAJERO_*_PAGE_SIZE`) |
| **Buscar por nombre** | filtra el conjunto entero, **en el navegador** (`filtrados`, `CuentasPorPagarTable.tsx:84-88`) | filtra el conjunto entero, **en el servidor**; la pagina vuelve a la 1 y se recalcula |
| **Que devuelve la busqueda** | subcadena, sin distinguir mayusculas, **sensible a acentos** («jose» NO encuentra a «José») | **exactamente lo mismo**, string a string: es lo que R45 exige y lo que 25 textos de test comparan contra el filtro de cliente copiado literal |
| **Orden de las filas** | **ninguno declarado**: sale de un `groupBy` sin `orderBy`, o sea del planificador de Postgres | **alfabetico por nombre de mensajero**, con `mensajeroId` de desempate. DESVIACION declarada de R51, la misma que T I.1 declaro en «Saldos de tiendas» (§4) |
| **Dinero de cada fila** | devengado / pagado / cuenta por pagar del LIBRO ENTERO de ese mensajero | **el mismo**: la agregacion es del libro entero y se hace ANTES de recortar (§5) |
| **Recorrer la lista** | scroll continuo | **control de paginas** bajo la tabla (T L.2) |
| **Expandir una fila** | abre `DesglosePagosMensajero`, que ya pagina por su cuenta | **igual**; L.2 debe comprobar que funciona tambien en la pagina 2 (R50) |
| **Descargar** | el conjunto filtrado, ya en el cliente (`filasLocales(filtrados, …)`) | **el mismo conjunto filtrado**, releido y filtrado con las MISMAS funciones del servidor (§9) |

**Lo que un operador notara el primer dia:** la tabla ya no es infinita y aparece un control de
paginas; y **las filas salen en orden alfabetico**, que hasta hoy no estaban en ningun orden
declarado. Buscar por nombre sigue funcionando igual —y a partir de ahora seguira funcionando
con la tabla paginada, que es justo lo que se rompia si no se hacia esta tanda—.

**Lo que NO cambia:** quien ve la pantalla (`maestro`/`admin`, `notFound` para el resto), las
cinco columnas, los montos (mismos strings, misma derivacion), el badge por signo, el desglose
por cierre de cada fila, el `aria-label` de la tabla ni el del buscador, y el archivo de
descarga (mismas columnas, mismo tope de 5000).

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
