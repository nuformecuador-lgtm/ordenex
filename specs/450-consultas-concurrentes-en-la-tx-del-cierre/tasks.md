# 450 — Tareas

**Dos entregables dentro de una ficha** (decisión 1 del humano, `requirements.md`):

- **Entregable 1 — el patrón:** T3 + T4 + T5. Mergeable por su cuenta (R12).
- **Entregable 2 — el emisor:** T2, con su criterio de parada.

Orden: **T1 (medir) → T2 (cazar, bloque propio y primero) → T3 (arreglar) → T4/T5 → T6 (gate) →
T7 (anotar lo aplazado)**.

> **Dependencia exacta entre los dos entregables, para que ninguno secuestre al otro:** T3 depende de
> T1.3 y de que T2 haya recorrido **los pasos 1 y 2** (los baratos, y los únicos que pueden cambiar
> el arreglo). Si a partir del paso 3 la caza se alarga, **el entregable 1 abre su PR igualmente** y
> la caza sigue en esta misma ficha con su propio PR. Lo que no se admite es cerrar la ficha con T2
> a medias: o nombrado, o agotado (R11).

> **Gate:** el diff toca `lib/services/Wallet*FeedService.ts` (nombres de dinero), así que
> `./init.sh --rapido` **se niega por diseño**. El gate de esta feature es `./init.sh` completo.

> **Enmienda del 2026-09-21, tras la revisión (autorizada por el humano).** T2.7 se ejecuta por la
> vía «leer en serie», y **queda levantada** la exigencia de que las suites del archivo del emisor
> pasen *sin editarse*: se pueden **ampliar sus dobles** para que expongan las tablas de catálogo
> que la secuenciación hace necesarias. Lo que sigue prohibido —y no se hizo— es **relajar una
> aserción**: ampliar un doble es legítimo, ajustar una expectativa para que cuadre es un cambio de
> comportamiento disfrazado de arreglo de test. Los cinco archivos de test tocados y qué se les
> cambió exactamente están en `progress/impl_450.md`.

---

## T1 — Medir antes de tocar una línea (bloquea T2 y T3)

- [x] **T1.1 — Sonda de integración sobre el código ACTUAL (sin arreglo).**
  Crear `tests/integration/db/aprobacion-consultas-en-serie.test.ts` según design §3.1: pool propio
  instrumentado (contador de consultas en vuelo por conexión) + captura de `process.on("warning")` +
  espía de consultas, ejercitando los dos feeds reales dentro de `enTransaccionRevertida`.
  **Hecho:** la salida pegada en `progress/impl_450.md` dice (a) cuántas consultas simultáneas se
  contaron sobre la conexión de la transacción y (b) cuántas advertencias se capturaron; demuestra
  que el test **EJECUTÓ** (no `skipped` por falta de `DATABASE_URL`) y que el espía vio las dos
  `SELECT`.
  **→ CERRADA 2026-09-21.** Medido ANTES del arreglo: **1 consulta simultanea, 0 solapes, 0 advertencias**; el espia vio las dos `SELECT` (`cierre_detail` y `gestion_orden`) por la MISMA conexion. El test EJECUTO (no `skipped`).

- [x] **T1.2 [P con T1.1] — Control negativo de los caminos observados.**
  Mismo archivo, bloque aparte: `CierreDiaRepository.findCierresByMensajeroPaginado` (el
  `Promise.all` de `CierreDiaRepository.ts:1226`) y el trío de `findEstatusIdByValue` de
  `CorteDiarioService.ts:164`, con el mismo contador y la misma captura.
  **Hecho:** los dos números escritos, con el anti-vacío demostrado. Si alguno da ≥2 en una misma
  conexión, entra en esta ficha (decisión 1) y se anota en T2.6.
  **→ CERRADA.** `CierreDiaRepository:1226`: 2 consultas, 2 conexiones, maximo 1 en vuelo. `CorteDiarioService:164`: **1 sola consulta** —Prisma agrupa los `findUnique` del mismo tick—, maximo 1 en vuelo. Ninguno da >=2 sobre una conexion.

- [x] **T1.3 — Elegir rama de la tabla de decisión (design §3.3) y escribirla.**
  Depende de T1.1 y T1.2.
  **Hecho:** una de las tres filas marcada en `progress/impl_450.md`, con sus números y la fecha.
  Ninguna rama abre ficha nueva. Sin esto no se toca código de producción.
  **→ CERRADA.** Ninguna de las tres filas describe lo medido: se marca una **cuarta** (aprobacion 1 en vuelo · aviso 0 · control negativo 0), escrita en `progress/impl_450.md`. No abre ficha nueva.

---

## T2 — Entregable 2: la caza del emisor (bloque propio, y primero)

Se recorre **en orden** y se **para en el primer paso que reproduzca** el aviso: contador ≥3 en una
conexión **y** aviso capturado en proceso limpio (design §3.4/§3.5). **Cada paso escribe su
resultado**; un paso sin resultado escrito no cuenta como recorrido.

- [x] **T2.1 — Paso 1: `Promise.all` sobre un cliente de transacción.**
  Ya medido en T1.1 (2 sitios, los dos feeds). **Hecho:** el número de sitios y el resultado del
  contador, escritos; el brazo A de la guardia (T5.1) lo deja censado para siempre.
  **→ CERRADA.** 2 sitios (los dos feeds); contador: 1 en vuelo, 0 avisos. NO reproduce. Censados por el brazo A.

- [x] **T2.2 — Paso 2: `$transaction([…])` en forma de ARRAY.**
  Tres sitios hoy: `lib/repositories/ConteosPublicosRepository.ts:22` (**3 consultas**, y corre en la
  **landing**, dos veces por render — `app/_landing/LandingHero.tsx:42` y `LandingBanda.tsx:56`),
  `lib/actions/geografia.ts:296` (2) y `lib/repositories/PlantillaMensajeRepository.ts:216` (2).
  Ejercitar los tres con el contador, en archivo de test propio (el aviso es de un solo disparo por
  proceso).
  **Hecho:** para cada uno, cuántas consultas llegaron a estar en vuelo sobre la misma conexión y si
  saltó el aviso. El de los conteos es el sospechoso principal: tres consultas y tráfico en cada
  arranque en frío.
  **→ CERRADA.** NO reproduce ninguno: conteos publicos (3 en array) 1 en vuelo; dos `contar()` a la vez, 2 conexiones y 1 en vuelo; la forma de 2 escrituras, 1 en vuelo.

- [x] **T2.3 — Paso 3: promesas Prisma flotantes (sin `await`)** dentro de un `$transaction` o en
  funciones que reciben `tx`.
  **Hecho:** censo escrito con los hallazgos revisados uno a uno (o «cero», con el criterio del
  censo dicho).
  **→ CERRADA.** Censo textual: `lib/` 160.075 lineas, 764 con llamada a Prisma, 4 candidatas — las 4 revisadas una a una y **falsas** (todas con `await`). `app/`: 0. **Cero promesas flotantes.**

- [x] **T2.4 — Paso 4: operaciones Prisma que expanden a más de una consulta** lanzadas junto a otra
  sobre el mismo `tx`, contadas con `crearPrismaDeTestConEspia`.
  **Hecho:** la relación operación→número de consultas de los caminos observados, escrita.
  **→ CERRADA, Y AQUI REPRODUJO.** Una lectura con 5 relaciones hermanas dentro de una tx: **5 consultas en vuelo, 4 solapes y el aviso capturado**. La misma sobre el pool: 3 conexiones, maximo 1.

- [x] **T2.5 — Paso 5: los caminos completos `/cierre-dia` y `/api/cron/corte-diario`**
  instrumentados de punta a punta con el contador y **con datos**.
  **Hecho:** una pasada por cada uno, con el máximo de consultas en vuelo por conexión anotado.
  **→ CERRADA.** `/api/cron/corte-diario` de punta a punta: 87 consultas, maximo 5 en vuelo, 24 solapes, 1 aviso. Confirma el paso 4 en el camino real y nombro las tablas del solape.

- [x] **T2.6 — Veredicto del entregable 2 (R11): nombrado o agotado.**
  **Hecho:** o bien el emisor con **archivo y línea** y su reproducción con el contador; o bien los
  **cinco pasos marcados** con lo que dio cada uno y la frase de agotamiento escrita en
  `progress/impl_450.md`. No hay tercera salida: «se sigue buscando» no cierra esta tarea.
  **→ EMISOR NOMBRADO:** `lib/repositories/CierreDiaRepository.ts` — el snapshot de `crearCierre` (`SNAPSHOT_SELECT`, 5 relaciones hermanas) dentro de su `$transaction`. Es el unico punto por el que pasan las DOS rutas donde produccion lee el aviso.

- [x] **T2.7 — [condicional, solo si T2.6 nombra un emisor] Secuenciarlo y vigilarlo.**
  Esperar cada consulta (o convertir la agrupación en transacción interactiva, design §3.5).
  **Hecho:** test propio rojo antes / verde después con el contador; la suite existente de ese
  archivo pasa **sin editarse**; y si su forma no la vigilan los brazos A ni B, la guardia gana su
  brazo con autocomprobación.
  **→ CERRADA el 2026-09-21 (autorizada por el humano tras la revision).** Secuenciado por la via «leer en serie»: el `select` proyecta los FK y `leerDescriptivosDeOrdenes` lee los cinco catalogos de uno en uno. **5 en vuelo -> 1; 4 solapes -> 0.** Misma informacion congelada (test de equivalencia). El brazo C gano su forma: hoy ninguna lectura del arbol llega al umbral del aviso (maximo medido: 2 hermanas).

---

## T3 — Entregable 1: el arreglo (depende de T1.3 y de T2.1–T2.2)

- [x] **T3.1 — `lib/services/WalletFeedService.ts:39`:** el `Promise.all` pasa a dos `await` en
  serie, conservando el orden (snapshot primero, gestiones después).
  **Hecho:** `pnpm run typecheck` en verde y `tests/unit/services/wallet-feed-service.test.ts` pasa
  **sin tocar ni un número** de los casos existentes.
  **→ CERRADA.** `typecheck` verde y la suite pasa sin tocar un numero.

- [x] **T3.2 [P con T3.1] — `lib/services/WalletTiendaFeedService.ts:75`:** lo mismo.
  **Hecho:** `tests/unit/services/wallet-tienda-feed-service.test.ts` pasa sin cambios de valores,
  incluido el bloque «INVARIANTE R15» de cuadre con la 42.
  **→ CERRADA.** Incluido el bloque «INVARIANTE R15 — cuadre con la 42».

- [x] **T3.3 — Comentario corto en los dos sitios** explicando por qué no puede volver a ser un
  `Promise.all`: una sola conexión por transacción, y **el daño no necesita el aviso** (design
  §2.4). Citar la guardia por su ruta.
  **Hecho:** el comentario nombra
  `tests/unit/guards/consultas-concurrentes-en-transaccion.guardia.test.ts` y no introduce la
  palabra *fulfillment* en ningún archivo vigilado; `lib/utils/cierre-detalle.ts` sigue intacto.
  **→ CERRADA.** Y **corregido tras la revision**: el comentario ya no afirma que las dos consultas lleguen a la vez a la conexion (Prisma las serializa hoy); dice por que el arreglo se sostiene igual. `lib/utils/cierre-detalle.ts` intacto.

---

## T4 — Tests de los dos feeds (depende de T3)

**Lo que cubren hoy, para no duplicarlo:**

| archivo | qué mide hoy | qué le falta |
| --- | --- | --- |
| `tests/unit/services/wallet-feed-service.test.ts` (14 casos) | conceptos por resultado, GAM, sin comisión, tarifa congelada ausente (R9), «no consulta datos vivos» (R12, con dobles de `orden`/`zona`/`tarifa` que lo delatarían), el grano orden×gestión, `CierreDetalleFaltanteError` (R14) | nada sobre la **conexión**: su `buildTx` (líneas 69-80) son mocks que resuelven al instante y no tienen noción de solape |
| `tests/unit/services/wallet-tienda-feed-service.test.ts` (~18 casos) | crédito COD + débitos, interruptor Q3 en sus dos estados, agregación por (tienda, concepto), tienda desde el snapshot (R13), R14, invariante de cuadre con la 42, reversión histórica | lo mismo: su `buildTx` (línea 93) no distingue secuencial de concurrente |

- [x] **T4.1 — Fixture `tests/fixtures/tx-una-consulta-a-la-vez.ts`:** doble de cliente de
  transacción que cuenta **consultas en vuelo** (incrementa al entrar, decrementa tras un tick) y
  registra cada solape con el nombre del delegado.
  **Hecho:** exporta el doble y la lista de solapes, y documenta por qué detecta el solape aunque el
  mock resuelva al instante (las dos llamadas se emiten antes de que corra la primera continuación).
  **→ CERRADA.**

- [x] **T4.2 — Autocomprobación del fixture:** `tests/unit/fixtures/tx-una-consulta-a-la-vez.test.ts`.
  **Hecho:** marca solape ante una implementación sintética con `Promise.all` y **no** lo marca ante
  la secuencial. Sin este caso, el fixture podría no medir nada y T4.3/T4.4 saldrían verdes para
  siempre.
  **→ CERRADA.** 5 casos: control positivo, control negativo, tres en vuelo, dobles delatores y clave mal formada.

- [x] **T4.3 [P con T4.4] — Bloque «450» en `wallet-feed-service.test.ts`:** el feed con el doble
  vigilado no produce ningún solape y devuelve exactamente los mismos movimientos.
  **Hecho:** el caso falla si se revierte T3.1 (comprobado revirtiendo y volviendo a correr).
  **→ CERRADA.** Mutacion corrida: revertido T3.1, el caso se pone ROJO con `maximoEnVuelo` = 2.

- [x] **T4.4 [P con T4.3] — Bloque «450» en `wallet-tienda-feed-service.test.ts`:** ídem.
  **Hecho:** igual, con la reversión de T3.2 comprobada.
  **→ CERRADA.** Igual, con la reversion de T3.2 comprobada.

- [x] **T4.5 — R4 y R7 sin regresión:** las dos lecturas siguen saliendo **por el `tx`** y el caso
  R14 sigue abortando sin emitir movimientos.
  **Hecho:** los casos existentes pasan sin editarse; si hubo que editar alguno, el porqué escrito
  en `progress/impl_450.md`.
  **→ CERRADA.** Los casos existentes pasan sin editarse. **Lo que SI se edito, y por que, esta escrito en `progress/impl_450.md`:** los DOBLES de cinco suites, para que expongan las tablas de catalogo que T2.7 hizo necesarias. Ninguna asercion cambio.

---

## T5 — La guardia (puede ir en paralelo a T3/T4)

- [x] **T5.1 — Brazo A (por el tipo del parámetro)** en
  `tests/unit/guards/consultas-concurrentes-en-transaccion.guardia.test.ts`, design §6.
  **Hecho:** cero violaciones en `lib/**` con el arreglo puesto, e imprime cuántas funciones con
  parámetro de transacción censó.
  **→ CERRADA.** Cero violaciones; censo: 964 archivos, 52 funciones con parametro de transaccion.

- [x] **T5.2 — Anti-vacío del censo.**
  **Hecho:** exige un mínimo **medido** (referencia del 2026-09-21: 276 menciones de
  `*TxClient`/`Prisma.TransactionClient` en 74 archivos de `lib/`, cero en `app/`) y falla si el
  censo se queda vacío.
  **→ CERRADA.**

- [x] **T5.3 — Brazo B (el `tx` inferido de un `$transaction`).**
  **Hecho:** cero violaciones hoy, y el censo encuentra al menos un cuerpo de `$transaction`.
  **→ CERRADA.** Cero violaciones; 70 cuerpos de `$transaction` censados.

- [x] **T5.4 — Autocomprobación (R10).**
  **Hecho:** rojo ante el cuerpo literal pre-arreglo de `construirMovimientosDeIngreso`; verde ante
  el `Promise.all` sobre el cliente agrupado copiado de `CorteDiarioService.ts:164` y
  `CierreDiaRepository.ts:1226`; verde ante la mención del patrón en un comentario.
  **→ CERRADA.** 12 casos de autocomprobacion, rojos y verdes.

- [x] **T5.5 — Límites escritos en el encabezado** (closure que captura el `tx`, helper con el tipo
  escrito en línea, formas distintas de `Promise`).
  **Hecho:** los tres límites nombrados en la cabecera del archivo.
  **→ CERRADA.** Y son **cuatro**, no tres: se anadio el limite «el censo mira solo `lib/`», con su hueco medido (`app/`: 1 `$transaction` sin concurrencia, 0 `*TxClient`; `scripts/`: 2 benignos).

---

## T6 — Trazabilidad y gate (depende de T3, T4, T5; y de T2.7 si hubo hallazgo)

- [x] **T6.1 — Mapa `R<n> → test` en `progress/impl_450.md`** (tabla de abajo, con salida real
  pegada).
  **Hecho:** los 12 requisitos con su archivo y su caso; ninguno sin test.
  **→ CERRADA.**

- [x] **T6.2 — `./init.sh` completo** (el rápido se niega: nombres de dinero).
  **Hecho:** `INIT_EXIT=0` **escrito dentro del log** (`progress/gate_450.log`) y revisados los
  `skipped`: la sonda de T1 **no** puede aparecer saltada en la corrida que se use como evidencia.
  Esto, junto al contador determinista, **es la prueba de cierre** (decisión 2).
  **→ CERRADA.** `INIT_EXIT=0` dentro de `progress/gate_450_b.log`; los `skipped` revisados uno a uno.

- [x] **T6.3 — Commits por tarea lógica y PR.**
  **Hecho:** el blob commiteado verificado en la rama (no basta con que el árbol local lo tenga) y
  el informe del reviewer commiteado.
  **→ CERRADA.** Commits por tarea logica, verificados en la rama.

---

## T7 — Lo aplazado, anotado donde se lee (no bloquea el `done`)

- [x] **T7.1 — Entrada «De la 450» en `docs/release.md` → «Pendiente para la PRÓXIMA release»**,
  con: qué mirar (ocurrencias del aviso en los logs de Vercel), con qué comparar (**32 ocurrencias,
  22 usuarios, última el 2026-09-20**, contando instancias y no eventos), **la fecha en que toca
  mirarla** (7 días tras el despliegue del entregable 1), cómo se lee el resultado y la frase de que
  **no bloquea** el `done` de la 450.
  **Hecho:** la entrada existe, commiteada, con su fecha escrita.
  **→ CERRADA.**

- [x] **T7.2 [P] — En la misma entrada, confirmar que el 25P02 sigue en cero** en
  `/mis-asignaciones/reparto` (el parche de la 440 no puede verse afectado).
  **Hecho:** qué mirar y con qué ventana, escrito.
  **→ CERRADA.**

---

## Mapa `R<n> → test` (lo que T6.1 tiene que dejar demostrado)

| R | qué exige | test |
| --- | --- | --- |
| R1 | la aprobación no pone dos consultas en vuelo ni emite el aviso | `tests/integration/db/aprobacion-consultas-en-serie.test.ts` — bloque «aprobación» |
| R2 | control negativo de los caminos observados | mismo archivo — bloque «control negativo» |
| R3 | una consulta a la vez sobre cualquier cliente de transacción | `tests/unit/services/wallet-feed-service.test.ts` y `wallet-tienda-feed-service.test.ts`, bloques «450» + `tests/unit/guards/consultas-concurrentes-en-transaccion.guardia.test.ts` (censo del árbol) |
| R4 | las lecturas siguen dentro de la tx y por su cliente | `wallet-feed-service.test.ts` («R12: lee cierre_detail… y NO consulta orden, zona ni tarifas») y `wallet-tienda-feed-service.test.ts` («R13: no consulta orden, zona ni tarifas vivas») |
| R5 | el dinero no cambia | las dos suites completas, **sin editar** sus valores (incluido «INVARIANTE R15 — cuadre con la 42») |
| R6 | el orden de las escrituras no cambia | `tests/unit/repositories/cierres-admin-caja-cod.test.ts` (la `traza` del orden real) y `tests/unit/repositories/cierres-admin-repository.test.ts` |
| R7 | sin snapshot, aborta | `wallet-feed-service.test.ts` («R14: lanza CierreDetalleFaltanteError…») y el equivalente de la suite de tienda |
| R8 | guardia por el tipo del parámetro | `consultas-concurrentes-en-transaccion.guardia.test.ts` — brazo A |
| R9 | guardia por el `tx` inferido | ídem — brazo B |
| R10 | la guardia se sabe romper y se sabe llena | ídem — bloques «anti-vacío» y «autocomprobación» + `tests/unit/fixtures/tx-una-consulta-a-la-vez.test.ts` |
| R11 | emisor nombrado o agotamiento declarado | si **nombrado**: el test propio de T2.7 (contador rojo→verde) y su brazo de guardia; si **agotado**: los cinco pasos marcados en `progress/impl_450.md` y la entrada de `docs/release.md` (T7.1), verificables por lectura del reviewer |
| R12 | los entregables no se bloquean | `./init.sh` completo en verde con **solo** el entregable 1 aplicado (T6.2), y ningún test del entregable 1 que cite un hallazgo del 2 |
