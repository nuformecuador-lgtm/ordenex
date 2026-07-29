# Feature 160 — bitácora de la fase BACKEND

**Rama:** `feature/160-columna-intentos` (sale de `dev`; no depende de la 154).
**Worktree:** `R:/job/singularis/projects/ordenex-wt-160-spec`.
**Fecha:** 2026-07-29.
**Alcance ejecutado:** bloques 1–4 (criterio, escalado, exposición en lote, gate),
bloque 7 (T22, manifiesto) y la parte NO-UI de T23. **Bloques 5 y 6 (T15–T21) sin
tocar**: son de la fase frontend.

---

## 1. Qué quedó implementado

### El criterio (T1–T4)

El criterio de "intento de entrega" pasó de **`destino = devuelta`** a:

```
VIGENTE  AND  ( destino = devuelta
                OR (destino = reprogramada AND origen_tipo ∈ ORIGEN_TIPOS_REPROGRAMADA_INTENTO) )
```

Escrito **por INCLUSIÓN**, como exige R1: la rama B se acota con una lista blanca
(`ORIGEN_TIPOS_REPROGRAMADA_INTENTO = ["gestion"]`, `lib/types/orden-historial.ts`), no con
una lista negra de familias que no cuentan. En el `where` de Prisma eso se materializa como
`origenTipo: { in: [...] }` dentro de la rama de `reprogramada`; **no hay ningún `notIn` en la
rama de destinos** y hay un test que lo asegura
(`orden-historial-repository.test.ts` → "el OR de DESTINOS … por INCLUSIÓN", que además
comprueba `JSON.stringify(ramaDestinos.OR)).not.toContain("notIn")`).

Consecuencias, que son el punto de la feature:

- `#13` `en_reparto → reprogramada` vía `gestion` (visita real del mensajero) **CUENTA**.
- `#22` `devuelta → reprogramada` vía `reprogramacion_tienda` (trámite de escritorio) **NO
  cuenta**: la fila `devuelta` de esa misma orden sigue vigente y ya aportó el intento.
- `incidente` no cuenta y **no se escribió una sola línea para ello**: no es destino de
  ninguna rama.

### Piezas nuevas / renombradas

| Antes | Ahora |
| --- | --- |
| `OrdenHistorialRepository.contarPorDestinoVigentes(ordenId, estatusDestinoId)` | `contarIntentosVigentes(ordenId, criterio)` (**renombrado**, no se conservó el viejo) |
| — | `OrdenHistorialRepository.contarIntentosVigentesEnLote(ordenIds, criterio)` (`groupBy`, 1 query, guarda `ids.length === 0`) |
| `where` inline | `whereIntentosVigentes(ordenId, criterio)` — función pura exportada, **consumida por los DOS** métodos de conteo |
| — | `CriterioIntento { devueltaId, reprogramadaId: string \| null }` en `IOrdenHistorialRepository.ts` |
| `OrdenHistorialService.contarIntentos(ordenId)` | **misma firma**, criterio nuevo |
| — | `OrdenHistorialService.contarIntentosEnLote(ordenIds)` + privado `resolverCriterio()` |

### Los 7 puntos de merge en lote (T8–T13 + T22)

Cada uno recibe `Pick<IOrdenHistorialService, "contarIntentosEnLote">` como dependencia
**requerida** de constructor (import type-only, sin ciclo) y mergea con `?? 0`:

1. `OrdenService.listar` → `OrdenListItemDTO`
2. `MisAsignacionesService.listarMisAsignaciones` → `MiAsignacionDTO` (**un lote** para los 2 grupos)
3. `RecepcionSateliteService.listar` → `RecepcionSateliteDTO` (**un lote** para los 5 grupos)
4. `NovedadesService.listar` → `NovedadDTO`
5. `RechazosSlaTiendaService.listar` → `RechazoSlaTiendaDTO`
6. `listarLiberadasHoy` (Server Action) → `LiberadaHoyRow` — **ver discrepancia D1**
7. `ManifiestoService.armar` → `ManifiestoFilaDTO` (`intentos: number`, **no** opcional)

Los seis DTO internos ganan `intentosEntrega?: number` (opcional, patrón `zonaEsGam?`); el
manifiesto lo lleva **no opcional**. `OrdenDTO`, `ApiOrdenListItemDTO`, `ApiOrdenDetalleDTO` y
`EtiquetaGuiaDTO` **no** se tocaron (R30/R31).

### Sin migración (R7)

`git diff --name-only -- db/` sale **vacío**. No hizo falta índice nuevo: el
`@@index([ordenId, estatusDestinoId])` existente cubre las dos columnas del predicado
selectivo, y `origen_tipo` / `gestion.anulada_at` quedan como filtros residuales. **No apareció
ninguna evidencia que obligara a escalar la decisión del índice.**

---

## 2. Mapa `R<n> → test` (requisitos de BACKEND)

Los `R17`–`R28` de presentación y `R32` de no-regresión de UI son de la fase frontend y **no**
se cubren aquí (salvo R28, que es el descargable y sí se hizo).

| Req | Test |
| --- | --- |
| **R1** | `tests/unit/repositories/orden-historial-repository.test.ts` → "160/R1: el OR de DESTINOS es (devuelta) \| (reprogramada + origen `gestion`), por INCLUSION"; "160/R1a: la devolucion del mensajero cuenta"; "160/R1b: la reprogramacion del MENSAJERO (#13, `gestion`) SI cuenta"; `tests/unit/types/criterio-intento-entrega.test.ts` → "R1b: `reprogramada` + familia `gestion` identifica UNA sola arista, la #13" |
| **R2** | `orden-historial-repository.test.ts` → "160/R2: la reprogramacion de la TIENDA (#22, `reprogramacion_tienda`) NO cuenta" y "160/R2: 1 devuelta + 1 reprogramacion de la TIENDA sobre la misma orden -> 1, no 2"; `criterio-intento-entrega.test.ts` → "R2: `reprogramacion_tienda` NO esta en la lista"; `tests/unit/services/devolucion-sla-service.test.ts` → "160/R2/R8: 1 devuelta + 1 reprogramacion de la TIENDA -> conteo 1, LIBERA" |
| **R3** | `orden-historial-repository.test.ts` → "160/R3: una transicion con destino `incidente` (ajeno al criterio) no altera el conteo"; `criterio-intento-entrega.test.ts` → "R3: `incidente` no tiene salidas declaradas" y "D3: no existe ningún estado `indemnizada` declarado ni referenciado" |
| **R4** | `tests/unit/services/intentos-entrega-criterio-unico.test.ts` (suite entera: drawer, cron y lote sobre el repositorio REAL); `orden-historial-repository.test.ts` → "R4: el `where` del LOTE es el MISMO predicado que el individual"; `tests/unit/services/orden-historial-service.test.ts` → "R4: individual y lote reciben EXACTAMENTE el mismo criterio" |
| **R5** | `orden-historial-repository.test.ts` → "R24: NO cuenta la transicion de una gestion ANULADA", "160/R5: la reprogramacion del mensajero de una gestion ANULADA tampoco cuenta", "R26: NO cuenta la HUERFANA", "160/R5: tampoco cuenta la huerfana con destino `reprogramada`", "R25: la transicion SIN gestion de un ajuste administrativo SI cuenta"; `intentos-entrega-criterio-unico.test.ts` → "160/R5: con las reprogramaciones del mensajero ANULADAS…" |
| **R6** | `orden-historial-service.test.ts` → "160/R6: catalogo sin `devuelta` … -> 0, sin contar y sin excepcion", "160/R6: con `devuelta` y sin `reprogramada` -> criterio con `reprogramadaId: null`", "R6: catalogo sin `devuelta` -> Map vacio"; `orden-historial-repository.test.ts` → "160/R6: sin `reprogramada` … el OR de destinos trae SOLO la rama A" |
| **R7** | `./init.sh` verde + `git diff --name-only -- db/` **vacío** (verificado, ver §4) |
| **R8** | `devolucion-sla-service.test.ts` → "160/R8: 2 reprogramaciones del MENSAJERO + 1 devuelta, umbral 3 -> ESCALA (antes liberaba)"; `intentos-entrega-criterio-unico.test.ts` → "160/R8: … el drawer muestra 3 y el cron ESCALA" |
| **R9** | `devolucion-sla-service.test.ts` → "160/R9: `wrong_number`/`wrong_address` siguen escalando DIRECTO, sin consultar el conteo" y "160/R9: la orden sigue consultandose UNA vez por orden y con SU id"; el resto de la suite del cron (ventanas, idempotencia, resiliencia, causa `null`) **verde sin cambios de aserción** |
| **R10** | `orden-historial-service.test.ts` → "160/R10: `intentos` refleja el criterio ampliado y el umbral sigue viajando"; `intentos-entrega-criterio-unico.test.ts` (drawer = cron = lote) |
| **R11** | Un test por servicio: `orden-service.test.ts` → "R11/R14: cada item sale con `intentosEntrega` numerico…"; `mis-asignaciones-service.test.ts` → "R11/R14: ambos grupos…"; `recepcion-satelite-service.test.ts` → "160/R11/R14: los CINCO grupos…"; `NovedadesService.test.ts` → "R11/R14: cada novedad…"; `rechazos-sla-tienda-service.test.ts` → "R11/R14: cada rechazo…"; `liberacion-reprogramada-action.test.ts` → "R11/R14: cada fila…"; `manifiesto-service.test.ts` → "emite el conteo de la orden como NUMERO" |
| **R12** | `orden-historial-repository.test.ts` → "R12: con N ids emite EXACTAMENTE 1 consulta (groupBy)"; `orden-historial-service.test.ts` → "R12: resuelve el catalogo UNA vez por llamada… y consulta el historial UNA vez"; `intentos-entrega-criterio-unico.test.ts` → "R12: el lote de N ordenes emite UNA sola consulta"; + un "R12: UNA sola llamada…" en cada uno de los 7 servicios |
| **R13** | `orden-historial-repository.test.ts` → "R13: `ids` vacio -> Map vacio y CERO consultas"; `orden-historial-service.test.ts` → "R13: lote vacio -> Map vacio, sin tocar el historial NI el catalogo"; + un caso de lote/página vacía en cada servicio |
| **R14** | Los mismos tests de R11 (todos asertan el `0` explícito, no `undefined`); `manifiesto-service.test.ts` → "una orden SIN intentos emite `0`, no `null` ni celda vacia" |
| **R15** | `orden-service.test.ts` → "R15: los ids del lote son los del listado YA acotado por el rol (adminTienda)"; equivalentes en mis-asignaciones (mensajero), recepción satélite (zona), novedades y rechazos (tienda), liberadas hoy (rol+zona); y en los cinco: "un rol no autorizado ni siquiera llega al derivador" |
| **R16** | `tests/unit/types/intentos-no-alcance.test.ts` → "compila: … no lo declaran" / "compila: los DTO internos SI lo declaran (opcional)"; + `pnpm run typecheck` verde con todos los fixtures/mocks preexistentes sin el campo |
| **R28** | `tests/unit/utils/manifiesto-xlsx.test.ts` → "R28b: la cabecera trae las columnas conocidas, en su orden relativo" y "R28a: la columna de intentos emite el numero, y `0` cuando no hay intentos"; `manifiesto-service.test.ts` → bloque "R28a — la columna de intentos del manifiesto" y "R28 — el manifiesto refleja los datos de la orden (conjunto ABIERTO)". **Ninguna aserción de "exactamente N columnas" queda en la suite** (`grep -n "toHaveLength(11)\|columnCount).toBe(11)"` → 0 resultados) |
| **R29** | `intentos-no-alcance.test.ts` → "`sortBy` con el campo de intentos -> rechazo del borde" y "`filter` con el campo de intentos -> rechazo por `.strict()`" |
| **R30** | `intentos-no-alcance.test.ts` (contrato: `EtiquetaGuiaDTO` sin el campo). **La parte de UI (vista del paquete / etiqueta impresa) queda para el frontend.** |
| **R31** | `intentos-no-alcance.test.ts` → "la especificacion OpenAPI no menciona los intentos en ningun sitio" + guarda de tipos sobre `ApiOrdenListItemDTO`/`ApiOrdenDetalleDTO` |
| **R32** (parte backend) | Las suites completas de los 7 servicios verdes; las únicas aserciones tocadas son las 2 declaradas en §3 |

**El test que exige el encargo**, explícitamente: `tests/unit/services/intentos-entrega-criterio-unico.test.ts`
monta el `OrdenHistorialRepository` REAL sobre un doble de Prisma que **evalúa el predicado**
contra filas de historial, y afirma en una sola tabla que el **drawer**, el número que consume
el **cron SLA** y el **lote** son el mismo entero, en los cuatro escenarios (solo devoluciones,
#13, #22, sin historial) — más los dos desenlaces de dinero (escala / libera).

---

## 3. Aserciones existentes que cambiaron (explícitas, no "ajustadas hasta que pase")

Solo dos, ambas por el cambio de forma de un DTO:

1. `tests/unit/services/rechazos-sla-tienda-service.test.ts` → "R12/R14: devuelve las ordenes
   rechazadas por SLA…": el `toEqual` de los items ahora declara `intentosEntrega: 0`. Se
   mantuvo `toEqual` (no se relajó a `toMatchObject`): la forma del DTO es contrato.
2. `tests/unit/utils/manifiesto-xlsx.test.ts` y
   `tests/unit/services/manifiesto-service.test.ts`: se **retiraron** las aserciones de
   "exactamente 11 columnas" (`worksheet.columnCount === 11`,
   `COLUMNAS_MANIFIESTO.toHaveLength(11)`, `Object.keys(fila).toHaveLength(11)`,
   `Object.keys(fila).toEqual([…11…])`) y se reemplazaron por presencia + **orden relativo**.
   Es exactamente lo que ordena R28b; la derogación quedó anotada en
   `specs/148-manifiesto-excel-lotes/requirements.md` con fecha.

---

## 4. Salida real de la verificación

```
$ ./init.sh
✓ node v24.13.0
✓ dependencias presentes
✓ regla max-2-por-zona respetada (in_progress=2)
✓ specs presentes para features sdd en vuelo
-> pnpm run typecheck
✓ typecheck paso                (0 errores)
-> pnpm run lint
✖ 10 problems (0 errors, 10 warnings)   ← las 10 warnings son PREEXISTENTES
✓ lint paso
-> pnpm run test
 Test Files  546 passed (546)
      Tests  5731 passed (5731)
   Duration  170.76s
✓ test paso
✓ todas las migraciones tienen down.sql
! no hay .env. Crea uno a partir de .env.example
== init OK ==
```

```
$ git diff --name-only -- db/
(vacío)                         ← R7: sin migración, sin cambio de esquema
```

**Nota operativa:** el worktree no tiene `.env`, y `prisma generate` falla sin `DATABASE_URL`.
Se regeneró el cliente con `DATABASE_URL=postgresql://user:pass@localhost:5432/db pnpm db:generate`
(generate no conecta a la base). Antes de eso el typecheck daba ~300 falsos negativos de
`@prisma/client` — es la trampa ya conocida del repo, no un problema de esta feature.

---

## 5. Discrepancias entre el spec y la realidad del código

### D1 — `LiberacionReprogramadaService` NO tiene método de listado (afecta a T13)

`design.md §3.5` lista `LiberacionReprogramadaService` como el 6.º punto de merge, con
"liberadas hoy" como método. **Ese método no existe.** El aviso se arma en el **borde**:
`lib/actions/liberacion-reprogramada.ts` → `listarLiberadasHoy`, que llama a
`findLiberadasHoy` directamente (patrón preexistente de ese loader). `LiberacionReprogramadaService`
es el servicio del **cron**, instanciado en `app/api/cron/liberar-reprogramadas/route.ts` y en
`lib/services/jobs/liberar-reprogramadas-handler.ts`.

**Qué hice:** el merge va en la Server Action, con `historial?: Pick<IOrdenHistorialService,
"contarIntentosEnLote">` en sus `deps` (inyectable en tests, wiring real por defecto).
**Por qué:** meter la dependencia en el constructor del servicio del cron obligaría a las dos
rutas de cron a cargar un derivador que nunca usan, y no acercaría el criterio a ningún sitio:
el criterio sigue viviendo íntegro en `OrdenHistorialService`; aquí solo se mergea un `Map` con
`?? 0`. Es la misma clase de orquestación que ese borde ya hacía (resolver zona por rol).
**Riesgo asumido:** roza `design.md §7.5` ("no resolver el conteo en el borde"), que se escribió
para evitar duplicar *lógica de dominio* en 7 acciones — aquí no se duplica ninguna.

### D2 — La feature 154 NO está mergeada en esta rama

`requirements.md` afirma que la 154 "ya está implementada y verde en otra rama (catálogo
18 → 20, con `por_recolectar_en_tienda` e `incidente`)". En `feature/160-columna-intentos`
(sale de `dev`) el catálogo tiene **18 estados** y **`incidente` no existe**.

**Verificación de T1 hecha contra el mapa REAL de esta rama:** hay **exactamente dos** aristas
con destino `reprogramada` (`#13` `gestion`, `#22` `reprogramacion_tienda`) → el criterio no
cambia. **No hay que parar ni escalar.**
El test de D3/R3 (`criterio-intento-entrega.test.ts`) se escribió **condicional**: hoy afirma
que `incidente` no está en el catálogo ni en el mapa; cuando la 154 aterrice, pasará a afirmar
que existe y **sin salidas**, sin que haya que tocar el test. El caso de "destino ajeno al
criterio no suma" se prueba con un id literal `"os-incidente"` más un destino real
(`entregada`), porque el punto es la clase de caso, no ese estado en particular.

### D3 — El "peaje de fixtures" fue el previsto, y se centralizó

Siete constructores nuevos rompieron 15 archivos de test. Para no repetir el mismo doble a
mano 15 veces (la deuda "fakes de repositorio duplicados" de `progress/current.md`) se creó
**`tests/fixtures/intentos-entrega.ts`**, con `fakeIntentosEnLote()`, `llamadasIntentos()` y —lo
más útil— `prismaHistorialSobreFilas()`, un doble de Prisma que **evalúa de verdad** el
predicado contra filas de ejemplo. Ese último es lo que permite el test de criterio único sin
DB. Si mañana cambia la firma, se arregla en un archivo.

### D4 — Dos `.tsx` de TEST tocados (no de UI)

El encargo pedía "cero archivos `.tsx` tocados". Se tocaron **dos**, y ninguno es UI:
`tests/components/DescargarManifiestoButton.test.tsx` y
`tests/components/ManifiestoFlujos.test.tsx`. En ambos el cambio es **una línea**
(`intentos: 0,`) en su constructor de `ManifiestoFilaDTO`. Es forzado: `design.md §3.6` exige
que en el manifiesto el campo sea **no opcional**, así que cualquier fixture que construya ese
DTO deja de compilar sin él. Ningún componente ni página de `app/` o `components/` se tocó
(`git status --porcelain | grep -v '^ M tests/'` lo confirma).

---

## 6. Qué NO verifiqué (explícito)

1. **No corrí nada contra una base de datos real.** Todos los tests son unitarios con dobles;
   el worktree no tiene `.env`. En concreto **no ejecuté `EXPLAIN`** sobre el `where` nuevo:
   la conclusión de que el índice `@@index([ordenId, estatusDestinoId])` sigue sirviendo es la
   del diseño (razonada), no una medición mía. Si alguien quiere certeza, hace falta un
   `EXPLAIN ANALYZE` del `groupBy` con `orden_id IN (...)` sobre datos de volumen.
2. **No re-medí el radio de impacto contra producción (T24.1).** El spec la marca como tarea
   previa al despliegue y el encargo la asignó al leader. La medición del 2026-07-29 (0 órdenes
   que salten el umbral) **no la reproduje**: la doy por buena tal como está en `design.md §4.4`.
3. **No verifiqué el comportamiento del `groupBy` de Prisma 7.8 contra Postgres real** con el
   `where` que incluye filtro de relación (`gestion: { anuladaAt: null }`). Los tests usan un
   doble. El diseño admite un fallback (`findMany` + conteo en memoria) si diera problemas;
   **no fue necesario en los tests, pero eso no es prueba de que funcione en la base**. Es lo
   primero que hay que mirar si el listado falla en preview.
4. **No verifiqué nada de UI.** Ni que la columna se pinte, ni que el `0` se vea, ni la vista
   del paquete / la etiqueta impresa (R30, parte visual). Todo eso es la fase frontend.
5. **No verifiqué el efecto real del cambio sobre órdenes vivas.** Los tests fijan el
   desenlace con conteos sintéticos; que en producción haya o no órdenes que crucen el umbral
   es lo que responde la re-medición del punto 2.
6. **No toqué `ordenes-columns.tsx`** (imán de drift, feature 156 en paralelo) ni ningún otro
   archivo de columnas: queda íntegro para el frontend.

---

## 7. Qué le queda listo a la fase frontend

- **El dato ya viaja** en los 6 DTO internos como `intentosEntrega?: number`, y el servicio
  **siempre** lo envía, `0` incluido. La UI solo tiene que pintar `?? 0`.
- **El campo es opcional**, así que ningún fixture ni mock de componente se rompe por existir.
- **El manifiesto ya lleva su columna** (`intentos`, tras `monto`), con `0` para las órdenes
  sin intentos: T22 está hecha, el frontend no tiene que tocar `manifiesto-xlsx.ts`.
- **Superficies pendientes:** las 12 de UI (T15–T21). Ninguna necesita backend nuevo.
- **Cuidado declarado:** el dato **no es ordenable ni filtrable** (R29), y el borde ya lo
  rechaza. Si una superficie lo quisiera como criterio de orden, es QA8 y no es de esta feature.
