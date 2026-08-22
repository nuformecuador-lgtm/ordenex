# Feature 265 — Tasks

> Lee `requirements.md` y `design.md` antes. Cada task lleva su **criterio de hecho**; `[P]` = puede
> ir en paralelo con las de su bloque que no dependan de ella.
>
> **Zona `backend`.** No hay bloque de frontend: ningún componente cambia. La única superficie que
> se toca de la UI es **indirecta** —la Server Action deja de lanzar— y se verifica en **F6**.
>
> ⚠️ **El gate lo corre el leader, no el subagente.** `backend_dev` corre `pnpm typecheck`,
> `pnpm lint` y `pnpm exec vitest related --run <sus archivos>`. Nada más.
>
> ⚠️ **`./init.sh --rapido` SE NIEGA en esta ficha**, por un solo archivo: `.env.example` está en la
> lista de `docs/verification.md`. El gate **completo** es obligatorio antes del PR. Ver
> `design.md` §10.1.

---

## BLOQUE 0 — Antes de escribir una línea

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

- [ ] **B16 — Matar todo con mutaciones.** (dep. B10, B11, B12, B13, B15)
  Las **dieciocho** de `design.md` §10.4 (M-a … M-r), una a una.
  **Hecho:** por cada una, el comando y la **salida real** (nombre del test que se puso rojo)
  pegados en `progress/impl_265_backend.md`. ⚠️ Si el arnés dice «todas mueren» sin mostrar una
  corrida por mutación, **no cuenta**: aquí ya reportó 9/9 dos veces sin ejecutar un test.

- [ ] **B17 — No-regresión.** (dep. B4, B7, B8, B9)
  - `tests/unit/clients/haversine-route-optimization.test.ts` y
    `tests/unit/services/optimizacion-ruta-{service,origen,trazado,tramo-vivo,encolado}.test.ts`
    **en verde sin tocarlos**, o con el cambio justificado por escrito.
  - Se comprueba que **no** se envía `ordenId` al proveedor (**R31**) y que ningún mensaje de error
    nuevo cita token, URL ni coordenadas (**R32**).
  - Se comprueba que el diff **no** toca `db/`, `lib/types/` ni ningún archivo con nombre de dinero
    (**R34** y `design.md` §10.1).
  **Hecho:** los tres puntos verificados y escritos.

---

## BLOQUE VERIFICACIÓN

- [ ] **F6 — ⚠️ Ver la app.** (dep. todo el bloque backend)
  **No hay harness E2E ejecutable en este repo; ésta es su sustituta y no es opcional.** En preview,
  con una cuenta de **mensajero** de QA:
  1. `/mis-asignaciones/reparto` con al menos dos paradas asignadas → pulsar **sincronizar ruta**.
     La ruta aparece ordenada y **no hay pantalla rota**: ni `AppErrorCode inesperado`, ni error de
     servidor, ni botón que no hace nada.
  2. Repetir **negando el permiso de geolocalización** → sigue funcionando (escalón `centroide`).
  3. Reproducir el caso del incidente en preview: dejar un origen incoherente persistido (o
     capturarlo con el navegador falseando la posición a otro país) y sincronizar → **la ruta sale
     ordenada igual**, y en los logs se ve la línea de la guarda del origen y **no** la de la
     llamada facturada con ese origen.
  4. **Leer los logs de runtime de preview** (`optimizer***:`) y confirmar: aparece el motivo real de
     la degradación, **no** «forma inesperada»; y no aparece ninguna coordenada en un mensaje de
     error.
  **Hecho:** capturas o transcripción en `progress/impl_265_backend.md`, con las cuatro
  comprobaciones nombradas una a una. En este repo, mirar la app encontró **siete** textos rotos que
  doce mil tests daban por buenos.

---

## CIERRE

- [ ] **C1 — `./init.sh` COMPLETO en verde.** No hay modo rápido en esta ficha (`.env.example`).
  **Hecho:** salida pegada, con `INIT_EXIT=$?` **escrito dentro del log** — un `echo` posterior ya
  tapó aquí un gate rojo haciéndolo pasar por «exit code 0».
- [ ] **C2 — Pre-vuelo contra `origin/dev`** justo antes del PR: otra sesión puede haberlo movido, y
  el hotfix del token (**B0.3**) toca el mismo archivo.
- [ ] **C3 — B0.4 (M1/M2/M3) hecha y escrita** antes de desplegar a producción, y el umbral fijado
  con ese número delante en vez del 🧭 200.
- [ ] **C4 — Las preguntas abiertas, respondidas o escaladas.** P1 la cierra B0.1. P2 la cierra
  B0.4. **P3, P4, P5 y P6 las decide el humano** y no se rellenan con un supuesto.
- [ ] **C5 — Los hallazgos aparte, registrados.** **H1** (calidad de la geocodificación: nadie lee
  `geocode_precision`) merece su ficha. **H2** (token en el log) es un **hotfix**, no una ficha, y
  puede estar ya en marcha (B0.3). Los registra el leader; aquí sólo se comprueba que **existen**.
- [ ] **C6 — Verificar el blob commiteado**, no sólo el árbol: `git show <sha>:specs/265-…` para los
  tres archivos. Otra sesión ya reseteó una rama aquí.

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
| R7 | Códigos de motivo, si existen | B10 — **condicionado a B0.1**; si no existen, se retira con la medición escrita |
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
| R34 | Sin migración | B17 (el diff no toca `db/`) |
