# Feature 187 — analitica financiera: lectura consistente del total y su desglose · DISEÑO

> Lee antes `requirements.md`. Este archivo decide el COMO. Cero codigo de produccion escrito aqui.

## 1. El hecho tecnico, en cinco lineas

```ts
// lib/services/AnaliticaFinancieraService.ts:322 (deCaja) y :394 (deTesoreria)
const [filas, porCuboTemporal] = await Promise.all([
  this.ingresos.sumarPorCategoria(consulta),        // -> el TOTAL de la vista
  this.ingresos.sumarPorCuboYCategoria(consulta, cubos), // -> las FILAS de la vista
]);
```

Dos consultas, dos conexiones del pool, **dos snapshots distintos** (Postgres por defecto es
`read committed`: cada sentencia ve su propia foto). Una escritura confirmada en `wallet_movimiento`
entre ambas entra en una y no en la otra. `deCuentaDeMensajeros` (:556) hace lo mismo con **tres**.

El arreglo es de **infraestructura de repositorio**: las dos (o tres) sentencias se emiten dentro de
una transaccion `repeatable read`, que en Postgres fija el snapshot en la **primera** sentencia y lo
mantiene hasta el final.

## 2. Decisiones heredadas de la ficha (no se re-deciden aqui)

**D1 — el total NO se deriva sumando las filas.** Fuente: `status_note` de la ficha 187 y ⟨L3⟩ de
`progress/impl_180.md`. Derivarlo ahorraria una consulta y convertiria el R12 de la 180 en una
**tautologia**: la invariante solo vale algo mientras los dos numeros lleguen por caminos distintos, y
ademas el R15 de la 180 («el total sigue siendo el que la 127 publica») se cumple hoy *por
construccion* precisamente porque el total sale de la misma llamada de siempre. **Consecuencia de
diseño:** el numero de lecturas por vista **no baja** (R5), y esa constancia se testea con los espias
que ya existen (`consultasHechas() === 2`).

**D2 — esto no es un defecto de la 180.** Fuente: `status_note`. La 180 midio la ventana, la declaro
antes de mergear y explico por que no la cerraba ella. Esta feature la cierra; no corrige a nadie.

**D3 — que pasa con el R12 de la 180: se queda EXACTAMENTE como esta, y esta feature lo hace cierto
en runtime.** Decidido, no dejado al aire. Los tres motivos:

1. **Su redaccion ya es correcta.** R12 dice «la suma de los importes de todas las filas DEBE ser
   exactamente igual al `total`». Eso es lo que el sistema debe cumplir; lo que fallaba no era la
   frase, era el runtime. Enmendarla («…salvo si hay una escritura concurrente») seria **debilitar un
   requisito aprobado** para ajustarlo a una limitacion que hoy desaparece.
2. **Las specs de este repo son registro historico, no documentacion viva.** Precedente explicito del
   propio repo: commit `b638f696` — «el design lleva la nota del incidente, y NO se reescribe».
   Reescribir `specs/180/requirements.md` hoy invalidaria las citas de `progress/impl_180.md` y de
   `progress/review_180.md`, que se refieren a ese texto tal cual esta.
3. **La trazabilidad se cierra hacia adelante, no hacia atras.** La anotacion vive donde nacio el
   limite (⟨L3⟩ de `progress/impl_180.md`) y donde se cierra (`progress/impl_187.md` y el comentario
   de `deCaja`, que hoy dice «DOS consultas, no una» y pasara a decir ademas «bajo un mismo
   snapshot»). Un lector de la 180 llega a la 187 por la bitacora, que es el camino que el arnes ya
   usa.

**Regla operativa que se deriva de D3:** `specs/180-analitica-financiera-serie-temporal/**` **no se
toca en esta rama**. Si aparece en el diff del PR, es un error.

**D4 — el impacto se declara como es.** Ventana de milisegundos, libro `append-only`, sintoma =
descuadre de centimos en un tablero de consulta, sin corrupcion. Ni se infla («inconsistencia de
datos financieros») ni se minimiza («cosmetico»): es una garantia escrita que el runtime no daba.

## 3. La forma del cambio: un ALCANCE DE LECTURA en el repositorio

El problema de diseño real es que **quien compone las dos lecturas es el servicio** —y el servicio no
puede conocer Prisma (`docs/architecture.md`: «Service … sin dependencia de HTTP ni de DB
directamente»)—, mientras que **quien puede abrir una transaccion es el repositorio**.

La solucion es el patron de **unidad de trabajo, en version de solo lectura**: el repositorio expone
un metodo de alcance que recibe una funcion, abre la transaccion, construye **una instancia de si
mismo ligada al cliente transaccional** y se la pasa a la funcion.

```
IIngresosAnaliticaRepository
  + enLecturaConsistente<T>(fn: (repo: IIngresosAnaliticaRepository) => Promise<T>): Promise<T>

ICuentasPorPagarAnaliticaRepository
  + enLecturaConsistente<T>(fn: (repo: ICuentasPorPagarAnaliticaRepository) => Promise<T>): Promise<T>
```

Y en el servicio, el cambio es **de tres lineas** (esto importa: ver §8, la 181 esta viva sobre este
mismo archivo):

```ts
const [filas, porCuboTemporal] = await this.ingresos.enLecturaConsistente(async (r) => [
  await r.sumarPorCategoria(consulta),
  await r.sumarPorCuboYCategoria(consulta, cubos),
]);
```

Lo que esta forma consigue, y por lo que se elige:

- **El servicio no gana ni un identificador de Prisma** (R6). Solo sabe que existe «una lectura
  consistente», que es vocabulario de dominio, no de ORM.
- **Las dos consultas siguen siendo dos**, con sus dos metodos de siempre y sus dos espias (R5, D1).
  Ninguna asercion existente de `analitica-financiera-service.test.ts` cambia de numero.
- **El repositorio sigue siendo solo consultas** (`CHECKPOINTS.md`): abrir una transaccion es acceso a
  datos, no logica de negocio.
- **Es el cambio mas pequeño posible en el servicio.** Un metodo combinado (alternativa A, §5) obligaria
  a reescribir aserciones en cuatro archivos de test y a mover mas codigo del servicio.

### 3.1 Detalles de la implementacion en el repositorio

- **Transaccion interactiva**, no la forma de array: `this.prisma.$transaction(async (tx) => fn(new
  IngresosAnaliticaRepository(tx)), { isolationLevel: "RepeatableRead", timeout, maxWait })`. La forma
  de array (`$transaction([p1, p2], …)`) obligaria a exponer las `PrismaPromise` sin `await` y
  romperia la firma de los metodos actuales.
- **Las lecturas van en SERIE dentro del alcance**, no con `Promise.all`. Un `Promise.all` sobre el
  mismo cliente transaccional emite sentencias concurrentes sobre una unica conexion, que es
  justamente lo que la documentacion de Prisma desaconseja; y dentro de un snapshot compartido el
  paralelismo **ya no compra consistencia**, solo latencia. El coste esta cuantificado en la
  pregunta abierta Q4 de `requirements.md`.
- **El cliente minimo gana `$transaction`**: `Pick<PrismaClient, "walletMovimiento" | "$queryRaw" |
  "$transaction">`. Precedente identico en el repo: `AnaliticaRollupPrismaClient` de
  `lib/repositories/AnaliticaRollupRepository.ts:142`. **No se inventa un patron nuevo.**
- **El cliente transaccional (`Prisma.TransactionClient`) satisface el tipo minimo** que el
  constructor pide salvo por `$transaction`: para que el tipo case sin castings, el constructor
  recibe el cliente minimo **sin** `$transaction` y el metodo de alcance vive sobre el cliente que si
  lo tiene. Detalle de tipos a resolver en implementacion (T2); si obligara a un cast, el cast se
  declara con comentario, nunca en silencio.
- **`READ ONLY` explicito: NO.** Postgres permite `SET TRANSACTION READ ONLY`, pero exigirlo obligaria
  a meter `$executeRaw` en el tipo del cliente de dos repositorios de dinero — o sea, **abrir la
  puerta de la escritura para prometer que no se escribe**. R3 se garantiza por lo que hay dentro del
  alcance (dos `groupBy`/`$queryRaw` de `SELECT`) y se **testea** con el fake, que registra cada
  operacion. Decision declarada, no olvido.
- **Sin `try`/`catch`** en ninguno de los dos repositorios (R7): un fallo dentro del alcance aborta la
  transaccion y sube tal cual. Los detectores de texto de
  `tests/unit/analytics/financiera-repositorios.guardia.test.ts` siguen intactos y **siguen mirando
  los mismos cuatro archivos**.

### 3.2 Precedente de aislamiento explicito en el repo — lo que hay y lo que no

Se busco antes de diseñar, para no inventar:

- **`$transaction` interactiva con opciones:** existe, `AnaliticaRollupRepository.escribirFecha`
  (`{ timeout, maxWait }` desde `lib/config/analitica-rollup.ts`). Se calca esa forma, incluida la
  constante de configuracion (R10).
- **`isolationLevel` explicito en produccion:** **no existe hoy en el arbol**. La unica mencion es la
  alternativa **K descartada** de la feature 172 (`specs/172-liquidacion/design.md:671` y el comentario
  de `LiquidacionPagoRepository.ts:118`), que descarto `Serializable` **para una escritura de dinero**
  porque abortaria una de las dos transacciones y obligaria a reintentar un pago. Ese motivo **no
  aplica aqui**: `repeatable read` en una transaccion de **solo lectura** no puede producir un error
  de serializacion (Postgres solo los lanza en `repeatable read` sobre escrituras concurrentes de la
  misma fila; y `serializable` no se usa). Asi que esta feature introduce el **primer** aislamiento
  explicito del repo, y por eso el hecho de que el nivel llegue de verdad a la sesion se **mide**
  contra Postgres (I1) en vez de suponerse.

## 4. Contratos de entrada y salida

**No hay endpoint nuevo, ni Server Action nueva, ni cambio de DTO** (R9). La Server Action
`consultarMetricaFinanciera` (`lib/actions/analitica-financiera.ts`) no cambia: sigue construyendo los
cuatro repositorios con `getPrismaClient()`, que ya expone `$transaction`.

Interfaces tocadas (`lib/interfaces/repositories/`):

| Archivo | Cambio |
|---|---|
| `IIngresosAnaliticaRepository.ts` | + `enLecturaConsistente<T>(fn)` con su prosa: que garantiza, que no, y por que el total sigue siendo una consulta aparte |
| `ICuentasPorPagarAnaliticaRepository.ts` | + `enLecturaConsistente<T>(fn)`, idem |

Implementaciones tocadas: `IngresosAnaliticaRepository.ts`, `CuentasPorPagarAnaliticaRepository.ts`
(un metodo cada una + el tipo del cliente minimo + una nota de cabecera).
Servicio tocado: `AnaliticaFinancieraService.ts`, **solo** los tres bloques de lectura de `deCaja`,
`deTesoreria` y `deCuentaDeMensajeros`.
Config: `lib/config/analitica-financiera.ts` (+ constante de tiempos, R10 / Q3).

**Modelo de datos:** ninguna tabla, ninguna columna, **ninguna migracion**, ningun cambio de RLS. La
lista de `CHECKPOINTS.md` sobre datos queda en `N/A` por la misma razon que en la 180.

## 5. Alternativas descartadas

**A) Un metodo unico de repositorio que devuelva total y desglose juntos**
(`totalYPorCubo(consulta, cubos): Promise<{ total, porCubo }>`, con la transaccion dentro).
*Por que se descarta:* funciona y es simple, pero **funde las dos lecturas en una sola llamada** y con
ello borra la evidencia de que son dos caminos independientes: los espias
`sumarPorCategoria`/`sumarPorCuboYCategoria` dejan de contar por separado y `consultasHechas() === 2`
—la asercion que hoy hace caro derivar el total— hay que reescribirla. Es un paso **hacia** D1 aunque
no lo cruce, y obliga a tocar aserciones en al menos cuatro archivos de test que hoy pasan sin
cambios. Descartada por eso, no por gusto.

**B) Derivar el total sumando las filas y ahorrar la consulta.**
*Por que se descarta:* lo prohibe la ficha (D1) y con razon: convierte el R12 de la 180 en una
tautologia. Se anota aqui a proposito porque es la solucion que cualquiera propone primero y en tres
meses nadie recordara por que no se hizo.

**C) `SELECT` unico con `GROUPING SETS` / `ROLLUP`: total y cubos en una sola sentencia.**
*Por que se descarta:* una sola sentencia ya es atomica y resolveria la consistencia sin
transaccion — pero el total y las filas pasarian a salir del **mismo agregado**, que es la version SQL
de la tautologia de (B). Ademas obligaria a reescribir en SQL crudo el `groupBy` de Prisma que hoy
produce el total desde la 127, y ese metodo lo comparten metricas de fuera del alcance.

**D) `isolationLevel: "Serializable"`.**
*Por que se descarta:* no compra nada aqui —para dos lecturas, `repeatable read` ya da snapshot
estable— y si trae la pega que la feature 172 documento (alternativa K): riesgo de aborto por
serializacion en cuanto haya escritura concurrente, convertido en un error generico para el usuario.
Un tablero de consulta que a veces falla es peor que un tablero que a veces muestra centimos de mas.

**E) Pasar el `tx` como parametro desde el servicio**
(`sumarPorCategoria(consulta, tx?)`).
*Por que se descarta:* mete un objeto de Prisma en la firma que el **servicio** tendria que sostener,
que es exactamente lo que `docs/architecture.md` prohibe, y rompe R6. El precedente del repo que si
hace esto (`LiquidacionPagoRepository.bloquearBeneficiario(tx, …)`) es distinto: alli quien abre la
transaccion es otro **repositorio/accion**, no el servicio de negocio.

**F) Dejarlo documentado y no arreglarlo.**
*Por que se descarta:* es lo que hizo la 180, y fue lo correcto **entonces**. Esta ficha existe
justamente porque «el R12 no debe seguir afirmando en una spec algo que el runtime no garantiza».

## 6. Alcance: por que estas siete y no las diez

Buscado en el codigo, metodo a metodo (`lib/services/AnaliticaFinancieraService.ts`):

| Metodo | Lecturas | ¿Se comparan entre si? | Decision |
|---|---|---|---|
| `deCaja` (4 metricas) | 2, `Promise.all` | **Si** — R12 de la 180 | **Dentro** |
| `deTesoreria` (2 metricas) | 2, `Promise.all` | **Si** — R12 de la 180 | **Dentro** |
| `deCuentaDeMensajeros` | 3, `Promise.all` | **Si** — R13 de la 180 (ultima fila == total) | **Dentro** (la nota 3 del review la nombra) |
| `deRecaudo` | 2, `Promise.all` | **No** — dos vistas con `sumableCon: []`, de tablas distintas | Fuera |
| `deSaldoDeTiendas` | 1 | — | Fuera |
| `deConciliacion` | 2 + 1 **secuencial dependiente** | Si, pero cruzando tablas y **emitiendo un aviso** | Fuera → Q2 |

El conjunto «dentro» coincide **exactamente** con `IDS_FINANCIERAS_CON_DESGLOSE_POR_FECHA`, la
constante que la 180 dejo (Q1 humano del 2026-08-05). Eso permite escribir R1 y sus tests
**parametricamente sobre la constante**, sin ninguna lista de ids a mano — que ademas es lo unico
compatible con `tests/unit/analytics/financiera-desglose-ids.guardia.test.ts`, que pone rojo hasta un
id suelto entre comillas.

## 7. Coste real de los tests, dicho antes de escribirlos

- **Dobles y fakes (barato, entra en el gate).** El doble de servicio
  (`tests/unit/services/_dobles-analitica-financiera.ts`) tiene que aprender `enLecturaConsistente`:
  no basta con `vi.fn(async (fn) => fn(repo))`; debe **registrar** apertura/cierre y marcar cada
  lectura con si el alcance estaba abierto, porque si no, R1 se «verifica» comprobando que se llamo a
  una funcion, que es exactamente el test vacio que esta spec no quiere. El fake de Prisma
  (`tests/unit/analytics/_fake-prisma-dinero.ts`) tiene que aprender `$transaction` **guardando las
  opciones recibidas** y entregando un cliente hijo distinguible, para poder afirmar que **ninguna**
  consulta salio por el cliente de fuera. `fakePrismaQueFalla` tambien: sin `$transaction` que
  rechace, el caso de propagacion R7 pasaria por la via del «no consulte y salio bien».
- **Integracion I1 (barato, pero exige Postgres).** Una sentencia (`SELECT
  current_setting('transaction_isolation')`) dentro y fuera del alcance. **Cero escrituras, cero
  limpieza.** Es lo unico que demuestra que la opcion de Prisma aterriza de verdad, y por eso no es
  opcional.
- **Integracion I2 (caro y sujeto a Q1).** Exige escritura **confirmada** desde una segunda conexion
  mientras el lector tiene el snapshot abierto: `enTransaccionRevertida` no sirve, por construccion.
  Coste: filas comprometidas en `wallet_movimiento` de la base de desarrollo, borradas en `finally` por
  id; riesgo residual si el runner muere. **Sin la respuesta a Q1 no se escribe** — y si la respuesta
  es «no», R4 se declara limite en `progress/impl_187.md` con estas mismas palabras.
- **Lo que ningun test dara:** que el snapshot aguante bajo carga real de produccion. No se promete.

## 8. Terreno movedizo: la feature 181 esta viva sobre este mismo archivo

Hay una **feature 181** corriendo en otra sesion (worktree `C:/w181`, **sin mergear a `dev`**) que
tambien toca `lib/services/AnaliticaFinancieraService.ts`: le añade la etiqueta de tienda a
`FilaFinanciera`. **No me coordino con ella ni leo su rama.** El conflicto textual al mergear es
esperable y esta acotado a ese archivo.

Lo que este diseño hace al respecto, y es la razon de la forma elegida en §3:

1. **Tres bloques de tres lineas** en el servicio (los `Promise.all` de `deCaja`, `deTesoreria` y
   `deCuentaDeMensajeros`) y **nada mas**. No se renombra nada, no se extrae ningun helper, no se
   reordena ningun metodo, no se mueve ningun comentario de sitio.
2. **El peso del cambio vive en los repositorios y en las interfaces**, que la 181 no toca.
3. Si la 181 aterriza primero, este PR resuelve tres conflictos de tres lineas cada uno. Si aterriza
   despues, igual. Esa es toda la mitigacion posible y es suficiente.

## 9. Checklist de arquitectura (`CHECKPOINTS.md`) aplicada a esta feature

| Punto | Estado previsto |
|---|---|
| Controller sin queries ni logica | **N/A** — el borde no cambia |
| Service sin HTTP ni Prisma | **OK por diseño** — R6 lo testea con censo de texto |
| Repository solo consultas | **OK** — abrir un alcance de lectura es acceso a datos; ni una derivacion nueva, ni un `.sub(` |
| Interfaces en `lib/interfaces/` | **OK** — el metodo de alcance se declara en las dos interfaces de repositorio |
| Tablas nuevas con RLS / migraciones con `down.sql` | **N/A** — no hay esquema que tocar |
| Secretos, pais, moneda | **N/A** — no entra ninguna variable de entorno nueva |
| E2E | **N/A** — lectura de analitica; no muta dinero (mismo criterio que la 180) |
