# Feature 265 — Tasks

> Lee `requirements.md` y `design.md` antes. Cada task lleva su **criterio de hecho**; `[P]` = puede
> ir en paralelo con las de su bloque que no dependan de ella.
>
> ~~**Zona `backend`.** No hay bloque de frontend: ningún componente cambia.~~ ⏳ **Caducado el
> 2026-08-22:** P3 se respondió **sí**, la zona es **`fullstack`** y hay **BLOQUE FRONTEND**
> (`FE1`-`FE4`). Se secuencia **backend → frontend**: el aviso no se puede pintar antes de que exista
> el dato que lo enciende.
>
> ⚠️ **El gate lo corre el leader, no el subagente.** `backend_dev` y `frontend_dev` corren
> `pnpm typecheck`, `pnpm lint` y `pnpm exec vitest related --run <sus archivos>`. Nada más.
>
> ⚠️ **`./init.sh --rapido` SE NIEGA en esta ficha, y ya no por un archivo sino por CUATRO:**
> `db/migrations/**`, `db/schema.prisma`, **`lib/types/ruta-mensajero.ts`** y `.env.example` — las
> cuatro están en la lista de `docs/verification.md:37-43`. **El gate de esta ficha es `./init.sh`
> COMPLETO**, es un `fail` del propio gate (no un aviso que haya que recordar) y es criterio de
> «hecho» de **C1**. Ver `design.md` §10.1.
>
> 📍 **Lee antes `design.md` §13-§16**: son las decisiones de la puerta humana del 2026-08-22 y de
> ellas salen las tasks nuevas (**B18-B26**, **FE1-FE4**, **C7-C8**).

---

## BLOQUE 0 — Antes de escribir una línea

> ⏳ **ESTADO DEL BLOQUE 0 TRAS LA PUERTA HUMANA (2026-08-22).** Tres de las cuatro cambian:
>
> | task | qué pasó |
> | --- | --- |
> | **B0.1** | ⛔ **NO SE PUEDE TOMAR, y se cierra así.** La consulta de logs de Vercel expira aunque se acote a un deployment y a 90 minutos, y **P4 apaga la traza**, que era la única vía a la respuesta cruda. **P1 y P5 quedan abiertas**; el schema se queda defensivo (§3.1) y **R7 se implementa tolerando que no haya códigos** (**R49**). No se sustituye por una deducción: eso sería inventar. |
> | **B0.2** | **Sigue viva tal cual.** Es barata y el número escrito tiene que ser el verdadero. |
> | **B0.3** | **Medido en el árbol de `dev`:** `grep console.log lib/clients/google-route-optimization.ts` → **0 coincidencias**; la línea 154 es hoy el `fetchImpl`. Falta sólo confirmarlo contra `origin/dev` **remoto** (el árbol local no prueba el remoto). **H2 no se abre aquí.** |
> | **B0.4** | **Tomada por el leader.** M1 **no medible** (`ruta_optimizada_parada` vacía, 0 en `en_reparto`) → el umbral queda declarado, no derivado (**P2**, R47). M2 = **6** jobs `failed`, todos del mismo día → **P6 cerrada, no se re-encola nada**. M3 = 1 de 2 orígenes en Medellín, **prueba del propio humano**. Las dos trampas de medición están escritas en `requirements.md`. |

- [ ] **B0.1 — ⚠️ La forma REAL de `skippedShipments` y `validationErrors`.** (sin dependencias)
  Sacar de los logs de runtime de Vercel una respuesta cruda **completa** de
  `client/google — respuesta cruda del proveedor` (la del incidente o una reproducida), con los
  `[Object]` **expandidos**. Es lo que resuelve **P1** y decide si **R7** se puede cumplir.
  ⛔ Si el log no la expande, reproducirla en local contra el proveedor con un origen incoherente a
  propósito, o pedir el objeto al humano. **No se deduce de memoria** (`CLAUDE.md`, regla 6).
  **Hecho:** el JSON completo pegado en `progress/impl_265_backend.md`, y una línea que diga si hay
  códigos de motivo citables (→ R7 se mantiene) o no (→ R7 se retira **con esta medición al lado**).

- [ ] **B0.2 `[P]` — Recalcular las dos distancias con la función del repo.** (sin dependencias)
  Ejecutar `distanciaHaversineKm` (`lib/geo/polilinea.ts`) sobre las coordenadas del log:
  origen `6.3422343,-75.514335` vs. centroide de las 6 paradas, y parada `9.9029459,-83.6815776` vs.
  `9.9747225,-84.2068436`.
  **Por qué es una task y no un dato:** el spec dice **≈1.040 km** calculado a mano y el reporte
  original decía «unos 1.400 km». La decisión no depende del dígito, pero **el número escrito tiene
  que ser el verdadero**.
  **Hecho:** los dos números pegados con el snippet que los produjo, y `requirements.md` §2 y
  `design.md` §6.4 corregidos si difieren.

- [ ] **B0.3 `[P]` — ¿Sigue el `console.log` del token en `origin/dev`?** (sin dependencias)
  `git fetch origin && git show origin/dev:lib/clients/google-route-optimization.ts | grep -n "console.log"`.
  Hay refs locales `hotfix/token-en-logs-optimizer` y `fix/token-en-logs-optimizer-dev`: puede estar
  ya arreglado y el árbol leído estar viejo.
  **Hecho:** respuesta escrita. Si **sigue estando**, se avisa al leader **antes** de tocar el
  archivo (es un hotfix de seguridad, no esta ficha, y dos manos en el mismo archivo colisionan).

- [ ] **B0.4 — M1, M2 y M3 contra producción, sólo lectura (MCP Supabase).** (sin dependencias)
  Las tres consultas de `requirements.md` § Mediciones. **M1 es la que fija el umbral** de
  `RUTA_ORIGEN_MAX_KM` y sustituye al 🧭 200 propuesto (**P2**).
  ⛔ Probablemente **bloqueada para el subagente**: `DATABASE_URL` de producción es *sensitive* y el
  MCP puede no estar entre sus herramientas. En ese caso **las consultas quedan escritas y listas
  para pegar** y las corre el leader.
  **Hecho:** los tres números pegados con su consulta y su hora. ⚠️ **Si el máximo legítimo de M1 se
  acerca a 200 km, el umbral se re-abre**: se para y se pregunta antes de fijarlo.

---

## BLOQUE BACKEND

### Contratos

- [ ] **B1 — El desenlace nuevo.** (dep. ninguna)
  `lib/interfaces/external/IRouteOptimizationClient.ts`: `OptimizarOutcome` gana
  `{ status: "sin_solucion"; detalle: string; servidas: number; enviadas: number }`, documentado con
  **por qué es un desenlace y no un error** (`design.md` §4).
  **Hecho:** `pnpm typecheck` se pone **rojo** en todos los `switch` que no lo tratan — ese rojo es
  el objetivo, no un accidente. Se anota la lista de archivos señalados.

- [ ] **B2 `[P]` — El umbral, en la config.** (dep. ninguna)
  `lib/config/route-optimization.ts`: `RUTA_ORIGEN_MAX_KM: number`, leído con
  `readPositiveInt("RUTA_ORIGEN_MAX_KM", 200)` 🧭 (o el valor que fije B0.4). Documentar en el
  campo **de dónde sale** el número y que es 🧭 mientras M1 no lo confirme.
  `.env.example`: la variable, con su unidad (km) y su default.
  **Hecho:** `tests/unit/config/route-optimization-config.test.ts` (**existe**) cubre
  ausente / vacío / `"abc"` / `"0"` / `"-1"` → default, **sin lanzar** (**R21**).
  ⚠️ Tocar `.env.example` es lo que niega el gate rápido (`design.md` §10.1). Es esperado.

### El cliente: leer lo que el proveedor dice

- [ ] **B3 — El schema se amplía, defensivo.** (dep. B0.1, B1)
  `google-route-optimization.ts`: `respuestaSchema` suma `skippedShipments`, `validationErrors` y
  `metrics.skippedMandatoryShipmentCount`, **todos opcionales** (`design.md` §3.1). Sin
  `.passthrough()` en la raíz. Con el comentario que explique la trampa proto3-json aplicada a estos
  campos y que la forma interna se aprieta cuando P1 esté resuelta.
  **Hecho:** una respuesta **sana** sin ninguno de los tres campos sigue parseando (**R2**), y la
  del incidente parsea entera.

- [ ] **B4 — `traducirSecuencia` deja de lanzar en UN caso.** (dep. B1, B3)
  Cuando la secuencia es válida pero **no cubre todas** las paradas → devuelve
  `{ status: "sin_solucion", … }` con `servidas`/`enviadas` y el motivo real (**R4**, **R5**).
  Los **otros tres** `throw` (sin `routes`, índice fuera de rango, índice repetido) **no se tocan**.
  El motivo cita **campos y conteos**, y códigos de motivo **sólo si B0.1 confirmó que existen**
  (**R7**). Nunca coordenadas, `ordenId`, índices ni texto libre (**R6**).
  **Hecho:** B10 en verde; M-c, M-d y M-e matan sus tests.

- [ ] **B5 `[P]` — La traza dice lo que se leyó.** (dep. B3)
  `optlog` con el conteo de saltadas y la **presencia** de `validationErrors`, también cuando la
  respuesta es utilizable (**R8**).
  **Hecho:** la línea existe y no imprime ni una coordenada fuera de las que la traza ya imprime por
  el override consentido.

- [ ] **B6 — La premisa caducada, anexada.** (dep. B4)
  El razonamiento de `traducirSecuencia` se conserva **verbatim** (**R27**) y debajo entra el bloque
  `⏳ FEATURE 265 (2026-08-22) — …` con sus **cinco piezas** (`design.md` §8): marcador, fecha,
  palabra de caducidad, motivo medido (`skippedMandatoryShipmentCount = 6`, origen en otro país) y
  puntero a `specs/265-optimizador-lee-al-proveedor`.
  **Hecho:** `git diff` sobre ese bloque de comentario muestra **sólo adiciones** en el párrafo del
  razonamiento; la frase caducada **sigue ahí**, anotada, no borrada.

### El compuesto: degradar cuando toca

- [ ] **B7 — `sin_solucion` → Haversine.** (dep. B1, B4)
  `fallback-route-optimization.ts`: rama nueva con su `optlog` (motivo **real**, no «forma
  inesperada») y su `logger.warn` agregado (**R12**). La regla «cualquier otro error se re-lanza»
  **no se toca** (**R14**) y el `RutaNoConfiguradoError` sigue igual (**R30**).
  **Hecho:** B11 en verde; M-f, M-g y M-h matan sus tests. La secuencia devuelta cubre **todas** las
  paradas de entrada (**R9**, **R10**).

### El servicio: cortar antes de facturar, y no romper la pantalla

- [ ] **B8 — La guarda de coherencia del origen.** (dep. B2)
  `OptimizacionRutaService`: extraer `centroide(paradas)` (la cuenta del escalón 3, **una sola
  aritmética**), y entre `resolverOrigen` y el cálculo de la huella comparar
  `distanciaHaversineKm(origen, centroide)` con `RUTA_ORIGEN_MAX_KM`. Si se pasa: origen ←
  centroide, `fuente: "centroide"`, `optlog` + `logger.warn` con distancia redondeada y número de
  paradas (**R19**), y **se sigue** (**R23**). No aplica si el origen ya es el centroide (**R18**).
  ⚠️ **La huella se calcula con el origen FINAL** (**R20**).
  **Hecho:** B12 en verde; M-j, M-k, M-l, M-m y M-n matan sus tests. El comentario del paso entra en
  la lista de guardas de coste de la cabecera del archivo, con su motivo.

- [ ] **B9 — El fallo del proveedor deja de escaparse.** (dep. B1)
  `try/catch` alrededor de `client.optimizar`: `opterror`, `marcarDesactualizada` y
  `throw new RutaIntentoFallidoError(<motivo saneado>)` (**R24**, **R26**). El motivo sale del error
  **sólo** si es una de nuestras clases; ante un error de librería, texto fijo (`design.md` §7).
  Y la rama `sin_solucion` en el `switch` del servicio: **fallo del proveedor**, nunca persistir
  parcial (`design.md` §5.3).
  **Hecho:** B12 y B13 en verde; M-o mata sus tests. `lib/types/ruta-mensajero.ts` **no se toca**.

### Tests

- [ ] **B10 — Tests del cliente.** (dep. B3, B4, B5)
  `tests/unit/clients/google-route-optimization.test.ts` (**existe**):
  - **Fixture con la respuesta real del incidente** (`routes:[{}]`, 6 saltadas, `metrics`) →
    `sin_solucion` con `servidas: 0`, `enviadas: 6` y motivo que nombra las paradas saltadas.
  - 4 de 6 servidas → **el mismo desenlace** (**R11**).
  - Respuesta sana **sin** ninguno de los tres campos nuevos → `ok` (**R2**).
  - `skippedShipments` con forma interna desconocida → mismo desenlace (**R3**).
  - Los tres `throw` que sobreviven, siguen lanzando.
  - Saneo del motivo: sin coordenadas, sin `ordenId`, sin índices, sin texto del proveedor (**R6**).
  ⚠️ **El test de la línea 113** («no cubre todas → lanza») se **reescribe**, no se borra: ver B14.
  **Hecho:** verde, y las mutaciones M-a…M-e producen rojo **con nombre**.

- [ ] **B11 `[P]` — Tests del compuesto.** (dep. B7)
  `tests/unit/clients/fallback-route-optimization.test.ts` (**existe**):
  - `sin_solucion` → se llama a Haversine y la secuencia devuelta contiene **exactamente** los
    `ordenId` de entrada, **todos** (**R9**, **R10**).
  - Mitad negativa: `transitorio`, `config_invalida` y una excepción cualquiera **se propagan igual
    que hoy** (**R14**). Sin esta mitad, un `catch` demasiado ancho pasa desapercibido.
  - `RutaNoConfiguradoError` sigue degradando con su motivo actual (**R30**).
  **Hecho:** verde; M-f, M-g y M-h lo matan.

- [ ] **B12 `[P]` — Tests del servicio, con dobles.** (dep. B8, B9)
  `tests/unit/services/optimizacion-ruta-origen.test.ts` y `optimizacion-ruta-service.test.ts`
  (**los dos existen**):
  - Origen a 1.040 km del centroide → se llama al proveedor **con el centroide**, no con el origen
    (se afirma el **argumento** de la llamada) y la optimización **continúa** (**R16**, **R17**,
    **R23**).
  - Distancia **exactamente** igual al límite → **no** se sustituye (`>` y no `>=`).
  - Origen `ultima_conocida` incoherente → también se sustituye (**R18**).
  - Origen que ya es `centroide` → no se toca.
  - La **huella** cambia al cambiar el origen (**R20**).
  - `client.optimizar` lanza → `marcarDesactualizada` llamada **y** el error es
    `RutaIntentoFallidoError` (**R24**).
  - `sin_solucion` que llega sin compuesto → **no** se persiste nada parcial (`reemplazarSecuencia`
    **no** se llama).
  - Degradación persistida como `vigente`: el siguiente disparo con el mismo conjunto y origen
    **corta en la guarda de sin cambios** y **no llama al proveedor** (`design.md` §5.4, mata M-p).
  - **R33:** las cinco guardas de coste siguen cortando en el mismo orden.
  **Hecho:** verde; M-i…M-p producen rojo con nombre.

- [ ] **B13 `[P]` — Test del job y de la action.** (dep. B7, B9)
  - `tests/unit/services/…` del handler: al degradar, `crearOptimizacionRutaHandler` **no lanza**
    (**R13**).
  - `tests/unit/actions/…` de `sincronizarRuta`: con el servicio lanzando `RutaIntentoFallidoError`,
    la action devuelve `{ status: "conflict", motivo }` y **no** lanza (**R25**). Es la aserción
    **contraria** a los `rejects.toThrow(/AppErrorCode inesperado/)` que ya existen en otros bordes:
    aquí ese `throw` era **el defecto**.
  **Hecho:** verde; M-o los mata.

- [ ] **B14 — ⚠️ El test que cambia de sentido, y su red de repuesto.** (dep. B10, B11, B12)
  `google-route-optimization.test.ts:113` decía «no cubre todas → **lanza** (nunca se persiste
  parcial)». Ese test estaba **bien**: protegía una invariante que sigue viva. Lo que cambia es
  **cómo** se protege.
  - Se reescribe para afirmar el desenlace nuevo, **con el nombre actualizado** (un nombre que
    promete «lanza» sobre un test que ya no lo comprueba es peor que no tenerlo).
  - Y la invariante que ese nombre prometía queda cubierta **en el mismo PR** por B11 (la secuencia
    degradada cubre todas) y B12 (un `sin_solucion` sin compuesto no persiste parcial).
  **Hecho:** escrito en `progress/impl_265_backend.md` **qué aserción se movió y adónde**. Borrar un
  test junto con lo que protegía ya costó aquí una regresión en producción.

- [ ] **B15 — La guardia de la premisa.** (dep. B6)
  `tests/unit/guards/premisa-saltos-caducada.guardia.test.ts`, molde de
  `tests/unit/tablero-dia/d10-revertida.guardia.test.ts` y de `d5-revertida`. Tres cláusulas
  (`design.md` §8.1): (a) testigo **verbatim** del razonamiento que sobrevive; (b) las **cinco
  piezas** de la nota, y el fallo dice **cuál** falta; (c) ninguna frase que afirme que el proveedor
  no puede saltarse paradas, en todo el árbol del optimizador.
  **Hecho:** cada detector es una **función pura con autocomprobación** (un texto que infringe y
  otro que no) y **normaliza espacios**. M-q y M-r la matan. ⛔ Una guardia que no pueda fallar nunca
  **no cuenta**: aquí ya pasó.

- [ ] **B16 — Matar todo con mutaciones.** (dep. B10, B11, B12, B13, B15, B23, B24, FE3)
  Las **treinta** de `design.md` §10.4 (M-a … M-ad), una a una. ⚠️ Eran dieciocho antes de la puerta
  humana; las **doce** nuevas (M-s … M-ad) cubren la columna, los dos avisos, el umbral y la traza
  apagada. Las de UI se corren contra los tests de componente de **FE3**.
  **Hecho:** por cada una, el comando y la **salida real** (nombre del test que se puso rojo)
  pegados en `progress/impl_265_backend.md`. ⚠️ Si el arnés dice «todas mueren» sin mostrar una
  corrida por mutación, **no cuenta**: aquí ya reportó 9/9 dos veces sin ejecutar un test.

- [ ] **B17 — No-regresión.** (dep. B4, B7, B8, B9)
  - `tests/unit/clients/haversine-route-optimization.test.ts` y
    `tests/unit/services/optimizacion-ruta-{service,origen,trazado,tramo-vivo,encolado}.test.ts`
    **en verde sin tocarlos**, o con el cambio justificado por escrito.
  - Se comprueba que **no** se envía `ordenId` al proveedor (**R31**) y que ningún mensaje de error
    nuevo cita token, URL ni coordenadas (**R32**).
  - ~~Se comprueba que el diff **no** toca `db/`, `lib/types/` ni ningún archivo con nombre de
    dinero (**R34** y `design.md` §10.1).~~ ⏳ **Caducado el 2026-08-22:** el diff **sí** toca `db/`
    y `lib/types/` (P3). Lo que se comprueba ahora es: **ningún archivo con nombre de dinero**, y
    **el gate completo** (C1) en vez del rápido.
  **Hecho:** los tres puntos verificados y escritos.

---

## BLOQUE BACKEND — LO QUE AÑADE LA PUERTA HUMANA (§13, §15, §16)

> Va **después** de B1-B17 y **antes** del bloque frontend. Cada task dice de qué sección del diseño
> sale.

### La procedencia del orden se persiste (§13)

- [ ] **B18 — La columna y su migración.** (dep. ninguna)
  `db/migrations/20260822140000_ruta_secuencia_fuente/migration.sql`:
  `ALTER TABLE "ruta_optimizada" ADD COLUMN "secuencia_fuente" TEXT;` — **nullable, sin DEFAULT, sin
  CHECK, sin backfill, sin RLS nueva** (`design.md` §13.2), con la cabecera de prosa que explique el
  porqué y el vocabulario (`'proveedor' | 'local'`), al estilo de
  `20260814120000_ruta_optimizada_trazado`.
  `down.sql`: `ALTER TABLE "ruta_optimizada" DROP COLUMN "secuencia_fuente";`
  `db/schema.prisma`: `secuenciaFuente String? @map("secuencia_fuente")` junto a `origenFuente`.
  ⚠️ **El nombre del directorio NO debe contener `ruta_optimizada`**:
  `tests/integration/db/ruta-optimizada-migracion.test.ts:14-23` resuelve por `^\d+_<nombre>$` y
  lanza si hay más de una coincidencia.
  **Hecho:** `pnpm run db:migrate` aplica en local; `prisma migrate status` limpio; y la lista de
  «migraciones sin down.sql» que imprime `./init.sh` (paso 6) **no crece** — hoy ya trae las tres
  `ruta_*` del 2026-08-14, que **NO se tocan** (editar una migración aplicada es *drift*).

- [ ] **B19 `[P]` — El repositorio escribe y lee la procedencia.** (dep. B18)
  `IRutaOptimizadaRepository`: `ReemplazarSecuenciaMeta.secuenciaFuente: "proveedor" | "local" | null`
  y `RutaOptimizadaDTO.secuenciaFuente`. La unión se **espeja** como literal —el repo no importa de
  `lib/interfaces/services/`, ver `:45-49`—.
  `RutaOptimizadaRepository.reemplazarSecuencia`: la columna entra en el objeto `cabecera`, en la
  **misma transacción** (`:135-153`). `marcarDesactualizada` **no la toca** y eso es deliberado
  (`design.md` §13.3).
  **Hecho:** B23 en verde; M-s y M-t matan sus tests.

- [ ] **B20 — El desenlace `ok` dice de dónde viene.** (dep. B1)
  `IRouteOptimizationClient`: `SecuenciaFuente = "proveedor" | "local"` y `{ status: "ok"; secuencia;
  fuente: SecuenciaFuente }` — **requerido, no opcional** (`design.md` §13.3, con el porqué).
  Google → `"proveedor"`; Haversine → `"local"` siempre; el compuesto **propaga** lo que recibe, no
  supone.
  **Hecho:** `pnpm typecheck` señala en rojo cada productor que no se pronuncia; se anota la lista.

- [ ] **B21 — El servicio transporta la procedencia hasta la fila.** (dep. B19, B20)
  `OptimizacionRutaService`: `outcome.fuente` → `reemplazarSecuencia`. En la rama trivial de 0/1
  parada, **`null`**: no hubo ordenación (**R37**). El servicio **no decide** la procedencia.
  **Hecho:** B23 en verde; M-s y M-u matan sus tests.

- [ ] **B22 — La procedencia llega a los dos bordes de lectura.** (dep. B21)
  - `IOptimizacionRutaService`: `EjecutarOptimizacionResult.ok` gana `secuenciaFuente`.
  - **`lib/types/ruta-mensajero.ts`**: `SincronizarRutaResult` rama `ok` gana
    `secuenciaFuente: "proveedor" | "local" | null` (`null` cuando fue `omitida`). ⚠️ **Este archivo
    es el que niega el gate rápido**; está asumido (`design.md` §10.1).
  - `lib/actions/ruta-mensajero.ts`: lo reenvía.
  - `IMisAsignacionesService.RutaResumenDTO` + `MisAsignacionesService`: `secuenciaFuente:
    ruta?.secuenciaFuente ?? null`, al lado de `origenFuente` (`:346-354`).
  **Hecho:** `pnpm typecheck` verde tras actualizar los **5** fixtures `RutaResumenDTO` de
  `tests/components/` (`RepartoModule`, `RepartoAyuda`, `RepartoAyudaResueltaPorLaTienda`,
  `MarcarLuegoToggle`, `GestionarOrdenPanelHilo`) — que salgan señalados **es el objetivo**, no un
  estorbo.

- [ ] **B23 — Tests de la persistencia.** (dep. B18, B19, B21, B22)
  - **Estático de migración**, molde de `tests/integration/db/ruta-optimizada-migracion.test.ts`:
    la columna es TEXT y nullable, no hay backfill ni CHECK, y **existe `down.sql`** que la dropea.
  - **Integración de repositorio** (`tests/integration/repositories/ruta-optimizada-repo.test.ts`,
    **existe**): se escribe `local`, se lee `local`; se recalcula con `proveedor` y la marca
    **cambia** (**R36**); `marcarDesactualizada` **no** la altera.
    ⚠️ Es el único sitio donde el `UPDATE` real se mira: un doble no ve la columna.
  - **Servicio con dobles**: se afirma el **argumento** de `reemplazarSecuencia` en los tres casos
    (proveedor, local, rama trivial → `null`).
  - **Compuesto**: degradar por `sin_solucion` **y** degradar por credencial ausente producen los dos
    `fuente: "local"` (**R44**).
  **Hecho:** verde; M-s, M-t y M-u producen rojo **con nombre**.
  ⛔ **Un test de integración que sale verde sin datos no cuenta**: si la fixture no crea la ruta, el
  test reporta `passed` sin comprobar nada. Se mata con una mutación antes de creerlo.

### El umbral y la traza (§15, §16)

- [ ] **B24 — El umbral, en un solo sitio y declarado sin calibrar.** (dep. B2)
  `lib/config/route-optimization.ts`: el comentario de contrato de `RUTA_ORIGEN_MAX_KM` lleva las
  **cuatro piezas** de `design.md` §15.2 (marcador 🧭/`PROPUESTO`, «no calibrado con datos de
  producción», fecha `2026-08-22` + motivo «M1 no se pudo medir; el caso de ≈1.040 km es una prueba
  del propio humano», y el puntero `specs/265-optimizador-lee-al-proveedor`).
  Guardia nueva `tests/unit/guards/umbral-origen-declarado.guardia.test.ts`: (a) las cuatro piezas
  están y el fallo dice **cuál** falta; (b) el literal del default **no aparece** en ningún otro
  módulo de `lib/`, `app/` o `components/` (**R46**).
  **Hecho:** cada detector es una **función pura con autocomprobación** (un texto/árbol que infringe
  y otro que no) y normaliza espacios. M-aa y M-ab la matan. ⛔ Una guardia que no puede fallar nunca
  no cuenta.

- [ ] **B25 `[P]` — `.env.example` y la traza.** (dep. B2)
  Documentar **los NOMBRES** (ese archivo nunca lleva valores): `RUTA_ORIGEN_MAX_KM` con su unidad
  (km), su default y la nota de que es provisional; y **`RUTA_DEBUG_LOG`**, con lo que enciende y la
  advertencia de que vuelca coordenadas de entrega al log — molde de `WHATSAPP_DEBUG_LOG` (`:13-15`).
  ⚠️ Tocar `.env.example` niega el gate rápido; ya está asumido.
  **Hecho:** las dos entradas escritas, sin ningún valor, y `RUTA_DEBUG_LOG` deja claro que se apaga
  con `0`.

- [ ] **B26 — Nada depende de la traza.** (dep. B4, B7, B8, B9, B21)
  Test explícito de que el **motivo** de la degradación y la **procedencia** persistida se producen
  igual con `RUTA_DEBUG_LOG=0` (**R48**), y de que un motivo **sin códigos de motivo** sigue
  nombrando causa y conteos, sin `undefined` ni huecos (**R49**).
  **Hecho:** verde; M-ac y M-ad los matan. Nota: `tests/setup/jest-dom.ts:28` ya pone la traza a `0`
  para toda la suite, así que esto le pone **nombre** a una propiedad que hoy se cumple por accidente
  del setup.

---

## BLOQUE FRONTEND — el mensajero se entera (§14)

> **No arranca hasta que B22 esté hecha**: sin el campo en `RutaResumenDTO` y en
> `SincronizarRutaResult` no hay nada que pintar. `frontend_dev` **no toca** `lib/`, `db/` ni las
> actions.

- [ ] **FE1 — El aviso persistente.** (dep. B22)
  `app/(app)/mis-asignaciones/_components/RepartoModule.tsx`: `Alert` con `variant="default"`
  —**no `destructive`**: no es un error— hermano del aviso de ruta desactualizada (`:667-676`),
  **fuera del acordeón del mapa** (`design.md` §14.1). Se muestra si y sólo si
  `ruta.secuenciaFuente === "local"`.
  Texto exacto de `design.md` §14.2:
  **«El orden de las paradas es aproximado»** / «Lo calculamos en la app, por cercanía en línea
  recta: no toma en cuenta calles ni tráfico. Revísalo antes de salir.»
  **Hecho:** FE3 en verde; M-v y M-x matan sus tests. El aviso del **punto de partida** (`:707-712`)
  queda **intacto** y puede verse a la vez (**R43**).

- [ ] **FE2 `[P]` — El toast deja de decir una media verdad.** (dep. B22)
  `SincronizarRutaButton.tsx:82-85`: con `secuenciaFuente === "local"`, en vez de
  «Ruta sincronizada.» va `toast.warning("Ruta ordenada de forma aproximada: revisa el orden de las
  paradas.")`. El resto del `switch` **no se toca** (`conflict`, `forbidden`, `unauthenticated`,
  `validation_error` siguen igual).
  **Hecho:** FE3 en verde; M-y lo mata.

- [ ] **FE3 — Tests de componente.** (dep. FE1, FE2)
  `tests/components/RepartoModule.test.tsx` (**existe**, con su fixture `RUTA_VIGENTE` en `:184-191`):
  - `secuenciaFuente: "local"` → el aviso está; `"proveedor"` → **no** está; `null` → **no** está
    (**R38**, **R45**).
  - **Las tres señales a la vez**: origen `centroide` + trazado `local` + orden `local` → los **tres**
    textos presentes y distintos (**R43**).
  - **Saneo del texto, sobre el DOM renderizado** (no sobre una constante): no aparece
    `/degrad|fallback|haversine|proveedor|optimizador/i` (**R41**) ni ninguna coordenada, dirección,
    guía o id (**R42**).
  - El botón: con orden local el toast **no** dice «Ruta sincronizada.» (**R39**).
  ⚠️ **Aserción contra su propia fuente = siempre verde.** El texto se afirma **literal** en el test,
  no importando la constante del componente.
  **Hecho:** verde; M-v, M-w, M-x, M-y y M-z producen rojo con nombre.

- [ ] **FE4 — No-regresión de la pantalla.** (dep. FE1, FE2)
  `tests/components/RepartoAyuda.test.tsx`, `RepartoAyudaResueltaPorLaTienda.test.tsx`,
  `MarcarLuegoToggle.test.tsx`, `GestionarOrdenPanelHilo.test.tsx` y `MisAsignacionesPage.test.tsx`
  **en verde**, con el único cambio de haber añadido el campo nuevo a sus fixtures.
  **Hecho:** verde, y escrito qué fixture se tocó y por qué (que es «el tipo lo exige», no «el test
  fallaba»).

---

## BLOQUE VERIFICACIÓN

- [ ] **F6 — ⚠️ Ver la app.** (dep. todo el bloque backend **y** el frontend)
  **No hay harness E2E ejecutable en este repo; ésta es su sustituta y no es opcional.** En preview,
  con una cuenta de **mensajero** de QA:
  1. `/mis-asignaciones/reparto` con al menos dos paradas asignadas → pulsar **sincronizar ruta**.
     La ruta aparece ordenada y **no hay pantalla rota**: ni `AppErrorCode inesperado`, ni error de
     servidor, ni botón que no hace nada.
  2. Repetir **negando el permiso de geolocalización** → sigue funcionando (escalón `centroide`).
  3. Reproducir el caso del incidente en preview: dejar un origen incoherente persistido (o
     capturarlo con el navegador falseando la posición a otro país) y sincronizar → **la ruta sale
     ordenada igual**, y **no** se llama al proveedor con ese origen.
  4. **El mensajero se entera** (§14): con la ruta ordenada en local se ve el aviso
     «El orden de las paradas es aproximado», el toast **no** dice «Ruta sincronizada.» a secas, y
     tras un **F5 el aviso sigue ahí**. Con la ruta ordenada por el proveedor, **no** hay aviso.
  5. **El origen aproximado y el orden aproximado se ven a la vez y se leen distintos** (**R43**).
  ⏳ **Lo que ya NO se hace así (P4).** La versión anterior de esta task mandaba «leer los logs de
  runtime de preview (`optimizer***:`)». Con la traza apagada esa evidencia puede no existir, así
  que **la verificación no depende de ella**: los puntos 3, 4 y 5 se comprueban **en la pantalla**, y
  el punto 3 se confirma además con una consulta de **sólo lectura**:
  `select mensajero_id, estado, origen_fuente, secuencia_fuente, calculada_at from ruta_optimizada
  where mensajero_id = '<qa>';` → `secuencia_fuente = 'local'`.
  Leer el log sigue valiendo **si** la traza sigue encendida en preview (**P7**), pero es un extra.
  **Hecho:** capturas o transcripción en `progress/impl_265_frontend.md`, con las **cinco**
  comprobaciones nombradas una a una y la salida de la consulta pegada. En este repo, mirar la app
  encontró **siete** textos rotos que doce mil tests daban por buenos.

---

## CIERRE

- [ ] **C1 — `./init.sh` COMPLETO en verde.** No hay modo rápido en esta ficha, y ahora por **cuatro**
  razones: `db/migrations/**`, `db/schema.prisma`, `lib/types/ruta-mensajero.ts` y `.env.example`.
  **Hecho:** salida pegada, con `INIT_EXIT=$?` **escrito dentro del log** — un `echo` posterior ya
  tapó aquí un gate rojo haciéndolo pasar por «exit code 0». Y la línea del paso 6 («migraciones sin
  down.sql») **no menciona** la migración nueva.
- [ ] **C2 — Pre-vuelo contra `origin/dev`** justo antes del PR: otra sesión puede haberlo movido, y
  el hotfix del token (**B0.3**) toca el mismo archivo.
- [ ] **C3 — Re-medir M1 antes de desplegar a producción**, con `ruta_optimizada_parada` ya con
  filas. ⚠️ **El 2026-08-22 M1 NO se pudo medir** (tabla vacía, 0 órdenes en `en_reparto`) y por eso
  el umbral se queda **declarado, no derivado** (**P2**, **R47**). Si al re-medir el máximo legítimo
  se acerca a 200 km, **se para y se pregunta** antes de fijarlo. La consulta debe evitar la trampa
  medida: `LEAST`/`GREATEST` **ignoran los NULL** y devuelven la antípoda.
- [ ] **C4 — Las preguntas abiertas, respondidas o escaladas.**
  **Cerradas por el humano el 2026-08-22:** **P2** (umbral declarado), **P3** (sí, el mensajero lo
  sabe), **P4** (apagar la traza ya), **P6** (no se re-encola nada).
  **Siguen ABIERTAS y no se rellenan con un supuesto:** **P1** y **P5** (se quedaron sin vía al
  apagar la traza; el schema es defensivo y R7 es tolerante), **P7** (¿la traza también apagada en
  preview?) y **P8** (¿los avisos agregados deben llegar a algún canal?).
- [ ] **C5 — Los hallazgos aparte, registrados.** **H1** (calidad de la geocodificación: nadie lee
  `geocode_precision`) merece su ficha. **H2** (token en el log) es un **hotfix**, no una ficha, y
  puede estar ya en marcha (B0.3). Los registra el leader; aquí sólo se comprueba que **existen**.
- [ ] **C6 — Verificar el blob commiteado**, no sólo el árbol: `git show <sha>:specs/265-…` para los
  tres archivos. Otra sesión ya reseteó una rama aquí.
- [ ] **C7 — ⚠️ Apagar `RUTA_DEBUG_LOG` (P4).** Decisión del humano, y **no es código**: es una
  variable de entorno. `RUTA_DEBUG_LOG=0` en **Production** (y en Preview según responda **P7**),
  fijada **por entorno, nunca en los dos a la vez** — en este repo una variable puesta a la vez en
  Production y Preview ya apuntó al proyecto equivocado en uno de los dos.
  ⚠️ **Coste asumido, escrito para que nadie lo descubra después:** se pierde la respuesta cruda del
  proveedor, y con ella **P1 y P5** se quedan sin cerrar (`design.md` §16.2).
  **Hecho:** la variable puesta, un despliegue posterior y **cero** líneas `optimizer***:` en los
  logs de runtime de ese entorno. El valor por defecto del código **no se toca** (eso es P7).
- [ ] **C8 — Después de desplegar: que no nazcan jobs nuevos con el error viejo.** M2 dejó **6** en
  `failed`, todos del mismo día, y **P6 cerró que no se re-encola nada**: el flujo normal (recoger →
  gestionar → sincronizar) los vuelve a encolar solo.
  **Hecho:** contar los `optimizacion_ruta` en `failed` **posteriores al despliegue** con el motivo
  de esta familia. Cero es la prueba de que el arreglo funcionó; cualquier otro número se investiga
  antes de cerrar la ficha.

---

## Mapa `R<n> → test`

| R | Qué exige | Test |
| --- | --- | --- |
| R1 | Se leen los tres campos | B10 (fixture del incidente) |
| R2 | Su ausencia no rompe nada | B10 (respuesta sana sin ellos) · B3 |
| R3 | La decisión no depende de la forma interna | B10 (forma desconocida → mismo desenlace) |
| R4 | El motivo nombra las paradas saltadas | B10 · M-d |
| R5 | El motivo lleva conteos | B10 |
| R6 | El motivo no filtra nada | B10 (saneo) · M-e |
| R7 | Códigos de motivo, si existen | B10 — ⏳ **B0.1 ya no se puede tomar** (P4 se llevó la traza): se implementa **tolerante** y su caso «no hay ninguno» es **R49** / **B26** |
| R8 | La traza lo dice aunque la respuesta sirva | B5 · B10 |
| R9 | «No cubre todas» → orden local | **B11** · B10 |
| R10 | Nunca una secuencia parcial persistida | **B11** (cubre todas) · **B12** (sin compuesto, no persiste) |
| R11 | «Algunas» recibe el mismo trato que «ninguna» | B10 (4 de 6) · B11 · M-g |
| R12 | Aviso agregado al degradar | B11 |
| R13 | El job completa, sin reintento | **B13** (el handler no lanza) |
| R14 | Los otros desenlaces no degradan | **B11 mitad negativa** · M-h |
| R15 | La secuencia previa no se toca hasta tener una completa | B12 |
| R16 | Se comprueba la coherencia antes de llamar | B12 · M-j |
| R17 | Se sustituye por el centroide | B12 (se afirma el argumento de la llamada) |
| R18 | Aplica a cualquier fuente, salvo `centroide` | B12 (`ultima_conocida`; y `centroide` intacto) · M-l |
| R19 | Aviso agregado, sin coordenadas | B12 |
| R20 | La huella usa el origen final | B12 · M-m |
| R21 | Configurable, sin lanzar | **B2** (`route-optimization-config.test.ts`) |
| R22 | Sin llamadas ni lecturas de más | B12 (0 llamadas al repo y al cliente en la guarda) |
| R23 | Descartar el origen no cancela el trabajo | B12 · M-n |
| R24 | Excepción → conserva, marca y tipa | B12 · M-o |
| R25 | La pantalla recibe `conflict`, no una excepción | **B13** (action) |
| R26 | La cola sigue viendo una excepción | B13 (handler re-lanza el tipado) |
| R27 | El razonamiento original, verbatim | **B15** cláusula (a) · M-q |
| R28 | La nota anexada, con sus cinco piezas | **B15** cláusula (b) · M-r |
| R29 | La guardia existe y no es vacía | **B15** autocomprobación · B16 |
| R30 | La degradación por credencial ausente sigue igual | B11 |
| R31 | No se envía `ordenId` | B17 · B10 (cuerpo de la petición) |
| R32 | Nada de token, URL ni coordenadas en errores | B10 (saneo) · B17 |
| R33 | Las cinco guardas de coste, intactas | B12 · B17 |
| R34 | Sin migración | ⏳ **Supersedida en parte por P3.** Lo que queda vivo —sin tabla nueva, sin RLS nueva, **sin backfill**— lo comprueba **B23** (estático de migración) |
| R35 | La procedencia del orden se persiste y se puede consultar | **B23** (repo real + estático de migración) · B21 · M-s |
| R36 | La marca es la de ESA secuencia, no la anterior | **B23** (recalcular cambia la marca) · M-t |
| R37 | Sin secuencia que ordenar, no se afirma procedencia | B23 (rama trivial → `null`) · M-u |
| R38 | Aviso visible desde el primer render | **FE3** · M-v |
| R39 | El toast dice la verdad | **FE3** (botón) · B22 (la action lo devuelve) · M-y |
| R40 | El texto dice qué pasa y qué hacer | FE3 (aserción literal sobre el DOM) |
| R41 | Sin jerga ni siglas | FE3 (`/degrad\|fallback\|haversine\|proveedor\|optimizador/i` ausente) · M-z |
| R42 | Sin coordenadas, direcciones, guías ni ids | FE3 · M-z |
| R43 | Las tres señales conviven y siguen distintas | **FE3** (origen `centroide` + trazado `local` + orden `local`) · M-x |
| R44 | La falta de credencial también avisa | **B23** (el compuesto marca `local`) · FE3 · M-w |
| R45 | Sin dato, no se dice nada | FE3 (`null` → sin aviso) · M-v |
| R46 | El umbral vive en un solo sitio | **B24** (guardia de barrido) · M-aa |
| R47 | Declarado sin calibrar, con guardia | **B24** (las cuatro piezas) · M-ab · C3 |
| R48 | Nada depende de la traza | **B26** + toda la suite (`jest-dom.ts:28` la apaga) · M-ac |
| R49 | Sin códigos, el motivo sigue completo | **B26** · B10 · M-ad |
