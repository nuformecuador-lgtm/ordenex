# Feature 187 — analitica financiera: lectura consistente del total y su desglose · TAREAS

> Checklist. Cada task dice **que toca**, **que la cierra** y de **que depende**. `[P]` = puede ir en
> paralelo con las de su mismo bloque. Convencion del repo: se marcan `[x]` al completarse (hallazgo
> `menor 1` de `progress/review_180.md` — esta feature no lo repite).
>
> Regla de tanda: al cerrar cada bloque, `./init.sh --rapido`. Antes del PR, `./init.sh` completo,
> **sin excepcion** (regla 5 de `CLAUDE.md`).

## Bloque 0 — puerta humana (bloquea todo lo demas)

- [x] **T0.1 — Respuesta a Q1 (I2 con escritura confirmada) escrita.**
  Toca: `progress/decision_187.md` (o el bloque ⟨L⟩ del leader en esta misma spec).
  Hecho cuando: consta **si** el test de integracion I2 puede confirmar y borrar filas propias de 2019
  en `wallet_movimiento` de la base de desarrollo. Si la respuesta es **no**, esta task tambien deja
  escrito el texto exacto del limite que ira a `progress/impl_187.md` en lugar de R4.
- [x] **T0.2 — Respuesta a Q3 (timeout y `maxWait`).** [P]
  Hecho cuando: hay dos numeros aprobados, o se acepta la propuesta `15_000` / `5_000`.
- [x] **T0.3 — Respuesta a Q2 (`deConciliacion` dentro o ficha aparte).** [P]
  Hecho cuando: consta la decision. Si es «dentro», esta spec se **corrige** antes de implementar (no
  se amplia el alcance sobre la marcha).

> **Bloque 0 cerrado por el leader el 2026-08-08** con las respuestas del humano, escritas en
> `specs/187-analitica-lectura-consistente/requirements.md` §7: **Q1 = si (opcion a)**, asi que
> **T6.2 va y T6.2b NO aplica**; **Q2 = fuera** (ficha aparte al cerrar); **Q3 = se acepta**
> `timeout: 15_000` / `maxWait: 5_000`, declarados en el comentario como **elegidos, no medidos**;
> **Q4 = no se mide antes**, se anota el cambio de perfil de latencia en `progress/impl_187.md`.

## Bloque 1 — los dobles aprenden el alcance (antes que el codigo de produccion)

Van primero a proposito: son la unica forma de que los tests de los bloques 2 y 3 puedan afirmar algo
mas fuerte que «se llamo a una funcion».

- [x] **T1.1 — `_fake-prisma-dinero.ts` aprende `$transaction`.**
  Toca: `tests/unit/analytics/_fake-prisma-dinero.ts`.
  Hecho cuando: (a) `$transaction(fn, opciones)` **guarda las opciones** recibidas y las expone;
  (b) invoca `fn` con un **cliente hijo distinguible**, de modo que `llamadas` deje ver **por que
  cliente** salio cada consulta; (c) `fakePrismaQueFalla` **tambien rechaza** por `$transaction`;
  (d) llamar a `$transaction` sin `isolationLevel` **no** se ignora en silencio (el fake lo registra
  como `undefined` y el test lo puede ver). Sin (b) y (c) el bloque 2 se vuelve decorativo.
  Depende de: —.
- [x] **T1.2 — `_dobles-analitica-financiera.ts` aprende `enLecturaConsistente`.** [P con T1.1]
  Toca: `tests/unit/services/_dobles-analitica-financiera.ts`.
  Hecho cuando: los dos dobles de repositorio (ingresos y cuentas por pagar) implementan el metodo
  **registrando apertura y cierre**, y cada lectura registra si el alcance estaba abierto en ese
  momento; y `consultasHechas()` **sigue contando exactamente lo mismo que hoy** (abrir un alcance no
  es una consulta) — lo cual se comprueba con las suites existentes en T5.1.
  Depende de: —.

## Bloque 2 — el alcance en los repositorios

- [x] **T2.1 — `enLecturaConsistente` en las dos interfaces.**
  Toca: `lib/interfaces/repositories/IIngresosAnaliticaRepository.ts`,
  `lib/interfaces/repositories/ICuentasPorPagarAnaliticaRepository.ts`.
  Hecho cuando: el metodo esta declarado en las dos con su prosa (que garantiza, que **no**
  garantiza, y por que el total sigue saliendo de su propia consulta — D1 de `design.md`), y
  `pnpm run typecheck` esta rojo **solo** por las implementaciones que faltan.
  Depende de: T0.x.
- [x] **T2.2 — Constante de tiempos del alcance.** [P con T2.1]
  Toca: `lib/config/analitica-financiera.ts`.
  Hecho cuando: existe la constante (o par de constantes) con el comentario de por que ese numero y
  no el default de 5 s de Prisma, siguiendo el precedente de `lib/config/analitica-rollup.ts`.
  Depende de: T0.2.
- [x] **T2.3 — Implementacion en `IngresosAnaliticaRepository`.**
  Toca: `lib/repositories/IngresosAnaliticaRepository.ts`.
  Hecho cuando: el cliente minimo gana `$transaction` (patron `AnaliticaRollupPrismaClient`), el
  metodo abre `$transaction` con `isolationLevel: "RepeatableRead"` y los tiempos de T2.2, construye
  una instancia ligada al cliente transaccional y **no** añade ni un `try`/`catch`, ni un `.sub(`, ni
  un `Number(`, ni un literal de milisegundos. Si el tipado obliga a un cast, va **con comentario**.
  Depende de: T2.1, T2.2.
- [x] **T2.4 — Implementacion en `CuentasPorPagarAnaliticaRepository`.** [P con T2.3]
  Toca: `lib/repositories/CuentasPorPagarAnaliticaRepository.ts`.
  Hecho cuando: idem T2.3, gemelo exacto (mismo criterio que los dos `limitesDeCubo`).
  Depende de: T2.1, T2.2.
- [x] **T2.5 — Tests del alcance en los repositorios (R2 unitario, R3, R10).**
  Toca: `tests/unit/analytics/financiera-lectura-consistente.test.ts` **[nuevo]**.
  Hecho cuando: pasan y **muerden**: «abre la transaccion con `isolationLevel: "RepeatableRead"`»
  (contra-caso: sin la opcion, el caso cae), «**todas** las consultas del alcance salen por el cliente
  de la transaccion y **ninguna** por el de fuera», «dentro del alcance solo hay operaciones de
  lectura» (con una escritura sembrada que si se detecta), «el timeout es el de la config» y «ningun
  literal de milisegundos en los dos repositorios».
  Depende de: T1.1, T2.3, T2.4.

## Bloque 3 — el servicio usa el alcance

- [x] **T3.1 — `deCaja`, `deTesoreria` y `deCuentaDeMensajeros` leen dentro del alcance.**
  Toca: `lib/services/AnaliticaFinancieraService.ts` — **solo** los tres bloques de lectura.
  Hecho cuando: los tres `Promise.all` pasan a ir dentro de `enLecturaConsistente`, en **serie**; el
  numero de llamadas a cada metodo de repositorio **no cambia**; y el diff del archivo son tres
  bloques de ~3 lineas mas la actualizacion del comentario «DOS consultas, no una» de `deCaja`, que
  gana «…y desde la 187, bajo un mismo snapshot». **Nada mas se mueve** (§8 de `design.md`: la 181
  esta viva sobre este archivo).
  Depende de: T2.3, T2.4.
- [x] **T3.2 — Tests del servicio (R1, R5 nuevo, R6, R8).**
  Toca: `tests/unit/services/analitica-financiera-lectura-consistente.test.ts` **[nuevo]**.
  Hecho cuando: pasan «las dos lecturas de la caja ocurren dentro del MISMO alcance abierto», «la de
  mensajeros mete sus TRES lecturas en uno solo», el caso **parametrico sobre
  `IDS_FINANCIERAS_CON_DESGLOSE_POR_FECHA`** (sin ninguna lista de ids a mano, que ademas es lo que
  `financiera-desglose-ids.guardia.test.ts` exige), «las tres metricas de fuera no abren ningun
  alcance» y el censo de texto de R6 (cero `$transaction` / `isolationLevel` / `prisma.` en el
  servicio) con su contra-caso sintetico.
  Depende de: T1.2, T3.1.

## Bloque 4 — guardias heredados: se amplian, nunca se relajan

- [x] **T4.1 — La lista de propagacion pasa de 11 a 13 (R7).**
  Toca: `tests/unit/analytics/financiera-repositorios.guardia.test.ts`.
  Hecho cuando: los dos `enLecturaConsistente` estan en `casos`, el ancla `toHaveLength(11)` pasa a
  `toHaveLength(13)` **como igualdad exacta**, los dos casos nuevos ejercitan una lectura **de verdad**
  dentro del alcance (con `[]` de cubos el metodo no consulta y el caso pasaria por vacio), y **ni un
  detector de texto se toca**.
  Depende de: T1.1, T2.3, T2.4.
- [x] **T4.2 — Barrido de guardias colaterales.** [P con T4.1]
  Toca: nada, salvo que salga rojo.
  Hecho cuando: `pnpm run test:guardias` esta verde y consta por escrito que se miraron
  `financiera-fuente.guardia.test.ts` (lista de archivos declarados: **no** cambia, esta feature no
  crea archivos de produccion), `alcance-obligatorio.guardia.test.ts`, `financiera-desglose-ids.guardia.test.ts`,
  `cache-financiera.guardia.test.ts` y `financiera-180-trazabilidad.guardia.test.ts`. Si alguno pide
  cambio, el cambio es **ampliar**, nunca aflojar.

## Bloque 5 — no se rompio nada

- [x] **T5.1 — Las suites de la 180 y la 127 pasan SIN editar sus aserciones (R5, R9).**
  Toca: nada (ese es el punto).
  Hecho cuando: `analitica-financiera-serie.test.ts`, `analitica-financiera-serie-frontera.test.ts`,
  `analitica-financiera-derivacion.test.ts`, `analitica-financiera-service.test.ts`,
  `financiera-contratos.test.ts` y `financiera-granularidad.test.ts` pasan **sin tocar ni una
  asercion**, incluidos `consultasHechas() === 2` y los `toHaveBeenCalledTimes(1)`. Si alguna
  asercion hubiera que cambiar, **para y avisa**: significa que el diseño se desvio de D1/R5.
  Depende de: T3.1, T1.2.

## Bloque 6 — la mitad que solo Postgres puede demostrar

- [x] **T6.1 — I1: el nivel de aislamiento aterriza de verdad (R2).**
  Toca: `tests/integration/repositories/financiera-lectura-consistente.integration.test.ts` **[nuevo]**.
  Hecho cuando: con `DATABASE_URL` presente, `current_setting('transaction_isolation')` vale
  `repeatable read` **dentro** del alcance y **otra cosa** fuera (el contra-caso es lo que lo hace
  significativo); sin `DATABASE_URL` el bloque se **salta**, no falla (patron
  `HAY_BASE_DE_DATOS` de `tests/integration/db/_postgres-real.ts`). **Cero escrituras.**
  Depende de: T2.3.
- [x] **T6.2 — I2: la invariante bajo escritura confirmada (R4).** — **SOLO SI Q1 = si**
  Toca: el mismo archivo de T6.1.
  Hecho cuando: con una escritura **confirmada por una segunda conexion** entre la primera y la
  segunda lectura, Σ filas sigue igual al total; y el **contra-caso** —las mismas dos lecturas fuera
  del alcance— **discrepa** (sin esa mitad, el test no demuestra nada). Las filas sembradas son de
  2019, con uuid conocido, borradas en `finally` por id, con precondicion de ventana vacia.
  Si Q1 = **no**: esta task se sustituye por **T6.2b — declarar el limite** en
  `progress/impl_187.md`, con el texto acordado en T0.1, y R4 se marca como **no falsado
  ejecutablemente**. No se da por cubierto en ningun caso.
  Depende de: T0.1, T6.1.

## Bloque 7 — cierre

- [x] **T7.1 — Bitacora con el mapa `R<n> → test`.**
  Toca: `progress/impl_187.md`.
  Hecho cuando: cada requisito de `requirements.md` cita un test que **existe** y esta nombrado por el
  comportamiento; los limites (R4 si aplica, y lo que ningun test cubre) estan escritos con todas las
  letras; y consta la evidencia de mutacion de al menos **R1 y R5** (romper el alcance / derivar el
  total y anotar que test murio y con que mensaje).
  Depende de: todo lo anterior.
- [x] **T7.2 — Verificacion final.**
  Hecho cuando: `pnpm run typecheck`, `pnpm run lint` y `./init.sh` **completo** en verde (con
  `DATABASE_URL` presente, para que I1 corra de verdad y no se salte), con la salida pegada en
  `progress/impl_187.md`, y `git diff --name-only origin/dev...HEAD` **no contiene**
  `specs/180-analitica-financiera-serie-temporal/**` (decision D3 de `design.md`).
  Depende de: T7.1.
