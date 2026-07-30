# impl_155 (BACKEND) — Creación bifurcada por bodega + retiro de `en_fulfillment`

> Rama: `feature/155-creacion-bifurcada` (sale de `origin/dev`, que ya trae 153, 154, 156 y 160)
> Worktree: `R:/job/singularis/projects/ordenex/.claude/worktrees/lote-135`
> Spec: `specs/155-creacion-bifurcada-fulfillment/` (R1–R43) · Zona: `backend` · Fase: **A (backend)**
> Fecha: 2026-07-29 · Base: `4221a01` (569 archivos / 6218 tests, verde)

---

## 1. Veredicto en una línea

**Backend hecho.** La bifurcación por bodega está viva en las tres vías, la migración con backfill
está escrita con su `down.sql`, y el retiro de `en_fulfillment` está completo **salvo tres líneas de
`EstatusBadge.tsx`**, que son `.tsx` y por tanto de la fase frontend. `./init.sh` **termina en rojo
en el paso de typecheck**, con **exactamente 3 errores, los tres en ese único archivo**, y `pnpm
test` falla **2 tests de componente** (`.tsx`) por el mismo motivo. Todo lo demás está verde.

---

## 2. La tensión que no se puede resolver dentro de esta fase (léase antes que nada)

El encargo pedía dos cosas incompatibles: `./init.sh` verde **y** cero `.tsx` tocados.

`OrderStatusValue` se deriva de `ORDER_STATUS_SEED`. Retirar el value de ahí (R27) **estrecha la
unión**, y `EstatusBadge.tsx` declara tres mapas tipados `Record<OrderStatusValue, …>` con una
entrada para el value retirado. Un objeto literal con una clave de más contra un `Record` es error
`TS2353`: no hay forma de silenciarlo desde fuera del `.tsx`. El retiro es **atómico** — value,
aristas y entradas de creación se van juntos o el invariante de conectividad de la 140 marca el
estado como callejón sin salida (0 entradas y 0 salidas) —, así que tampoco se puede partir "media
retirada" que deje el build verde.

**Elegí respetar "cero `.tsx`"** y entregar el rojo, por tres razones:

1. Es lo que el propio spec diseñó. El *Hecho cuando* de **T2.1** dice literalmente: "`ORDER_STATUS_SEED`
   ya no lo contiene **y el build de TS señala exactamente los sitios que faltan por limpiar**".
2. La decisión 6 de la puerta T0.1 ("se secuencia backend → frontend; tú no tocas `.tsx`") es
   explícita y se repitió dos veces en el encargo.
3. El rojo resultante **no es ruido**: son 3 errores en 1 archivo y 2 tests, y coinciden uno a uno
   con las tareas T6.1 y la mitad `.tsx` de T8.2, que quedan **sin marcar** a propósito.

La alternativa —tocar `EstatusBadge.tsx`— dejaba `init.sh` verde a cambio de que la fase frontend se
quedara prácticamente sin bloque 6. Si el leader prefiere ese trade-off, son ~15 líneas de borrado y
lo puede pedir; no lo hice por mi cuenta.

---

## 3. Puerta T0 — cerrada, citada y registrada

Las 6 respuestas del humano (2026-07-29) están escritas en `design.md §11` (tabla con fecha), y R24
y R43 quedaron **redactados en su forma final** en `requirements.md`. Resumen:

| # | Respuesta |
| --- | --- |
| 1 | Manifiesto → **opción C**: flujo nuevo `recoleccion_tienda` (mismo mapeo origen/destino, selección por `numRemisiones`) **y además** manifiesto por el canal de API key en la respuesta de su endpoint, siguiendo el precedente de `etiquetasPdf`. Se descartó reusar `carga_masiva`: mentiría en la etiqueta. |
| 2 | Evento público → **SÍ**: `por_recolectar_en_tienda` entra en `EVENTOS_PUBLICOS`. |
| 3 | El rol `apiKey` cae **siempre** en la rama (b). **R21 se implementa igual**, como rama defensiva hoy inalcanzable. |
| 4 | La arista `#5` sobrevive (la usa la 156, ya mergeada). Deja de ser pregunta. |
| 5 | Etiqueta en el acto → **fuera de alcance**, va en la 157. |
| 6 | Zona → **backend → frontend**; esta fase no toca `.tsx`. |

**T0.2** verificada: la rama base daba `typecheck` limpio y **569 archivos / 6218 tests / 0 fallos**
antes de tocar nada, y `por_recolectar_en_tienda` estaba en el seed (índice 18), en `TRANSICIONES`
(#43), en `ESTADOS_CREACION` y en los mapas de badge/label.

---

## 4. Qué quedó implementado

### 4.1 El punto único de decisión (bloque 1)

`lib/services/destino-creacion.ts` — función pura, sin Prisma, sin HTTP, sin `process.env`:

- `true`  → `{ estatus: "en_preparacion", conGuia: false, emiteManifiesto: false }`
- `false` → `{ estatus: "por_recolectar_en_tienda", conGuia: true, emiteManifiesto: true }`

Sustituye a las **tres** reglas de nacimiento que convivían: `ordenesConfig.DEFAULT_ESTATUS_VALUE`,
`ordenesConfig.FULFILLMENT_ESTATUS_VALUE` y `BulkOrdenService.ESTATUS_INICIAL_API`.

### 4.2 Catálogo, grafo y configuración (bloque 2)

- `ORDER_STATUS_SEED`: 20 → **19** values. Es la **primera baja** del catálogo; los 17 previos
  conservan su orden relativo.
- `TRANSICIONES`: se retira la clave y sus 4 aristas (#1/#2/#3/#7b). `satisfies` y
  `_EnsureExhaustive` **no se relajan**.
- `ESTADOS_CREACION`: de 4 a **exactamente 2**. Se van el value retirado y `en_ruta_bodega_central`.
- `lib/config/ordenes.ts`: se retiran las dos claves y sus dos variables de entorno; `OrdenesConfig`
  queda con las dos cotas de paginación.
- `tests/fixtures/inventario-transiciones-140.ts`: 42 → **38** aristas de flujo, 39 → **36** pares
  únicos, 4 → **2** de creación.

### 4.3 Repositorio (bloque 3)

- `create(data, historial, opciones?: { conGuia?: boolean })` — default `false`. Con `true`, numera
  **dentro de la misma tx**, antes del historial, con la guarda `num_guia IS NULL` y relectura
  defensiva (nunca un `as number`). El DTO devuelto refleja el estado final de la fila.
- `createManyOrdenesConGuia` — **hueco cerrado**: pasa a encolar geocodificación por orden
  efectivamente insertada (antes no lo hacía, a diferencia de `createManyOrdenes`). Gana también el
  mismo parámetro `opciones.conGuia` (default `true`) para la rama defensiva de R21, que devuelve
  `numGuia: null` sin tocar la secuencia.

### 4.4 Las tres vías (bloque 4)

| Vía | Antes | Ahora |
| --- | --- | --- |
| Alta manual | `DEFAULT_ESTATUS_VALUE`; aceptaba `estatusId` del payload | `resolverDestinoCreacion(flag de la tienda dueña)`; `estatusId` **fuera** de `crearOrdenSchema` |
| Carga masiva UI | ternaria de config | mismo punto de decisión; elige repositorio por `destino.conGuia` |
| Carga API key | `en_ruta_bodega_central` fijo | mismo punto de decisión sobre el dueño de la key |

`CargaViaApiOrden.numGuia` y `CargaViaApiRow.numGuia` pasan a `number | null` (R21).
`CargaViaApiResult` gana `destino: DestinoCreacion` — **en el resultado del service, no en el
`summary`**, que es literalmente el cuerpo JSON público.

### 4.5 Manifiesto (opción C)

- `MANIFIESTO_FLUJOS` gana `recoleccion_tienda` (séptimo flujo). `ubicacionesDe` lo resuelve en la
  **misma rama del `switch`** que `carga_masiva`: mismo movimiento físico, etiqueta distinta.
- `manifiestoSchema`: la rama de `numRemisiones` pasa de `z.literal("carga_masiva")` a
  `z.enum(["carga_masiva", "recoleccion_tienda"])`.
- `POST /api/ordenes/api-key/carga` gana el bloque `manifiesto`, con la disciplina **exacta** de
  `etiquetasPdf`: `{ filas, omitidas }` en éxito, `{ error }` visible en fallo (HTTP 200, carga NO
  revertida), `null` cuando no hay nada que emitir (rama (a) o cero creadas). Las filas las arma el
  **servicio único**; el borde no construye ninguna columna.

### 4.6 Migración (bloque 5)

`db/migrations/20260729140000_order_status_retiro_en_fulfillment/` — tres pasos: **rastro → backfill
→ `DELETE` condicional**, más `down.sql` escrito a mano que repone, devuelve las órdenes marcadas y
borra el rastro. Sin tablas ni columnas nuevas, sin cambios de RLS, sin `ALTER TYPE`.

### 4.7 Contrato público (bloque 7)

- `lib/api/openapi-spec.ts` + `docs/api/api-key-openapi.yaml` (mismo commit): baja del value
  retirado, alta de `por_recolectar_en_tienda`, ejemplos actualizados y **nota de cambio
  incompatible** en la descripción del endpoint de carga.
- `EVENTOS_PUBLICOS`: 9 → **10**, ampliación estrictamente aditiva.

---

## 5. Mapa `R<n> → test`

Solo los requisitos de backend. Los de frontend (R32, R41 y la mitad `.tsx` de R33) quedan abajo,
en §8.

| R | Test |
| --- | --- |
| R1 | `tests/unit/services/destino-creacion.test.ts` "el flag es el UNICO predicado…" · `bulk-orden-service.test.ts` "solo el flag decide; una columna `estatus` en el archivo no altera nada" |
| R2 | `destino-creacion.test.ts` "rama (a)…" (3 casos) · `orden-service.test.ts` "R2: adminTienda con fulfillment=true…" · `bulk-orden-service.test.ts` "R16: tienda con fulfillment=true…" |
| R3 | `destino-creacion.test.ts` "rama (b)…" (3 casos) · `orden-repository.creacion-bifurcada.test.ts` "conGuia: true numera en la MISMA tx…" |
| R4 | `bulk-orden-service.test.ts` "R4/R15/R18: lee fulfillment … UNA vez por LOTE, no por fila" · `bulk-orden-service.carga-api.test.ts` "155/R4: resuelve el flag UNA sola vez por lote" |
| R5 | `orden-service.test.ts` "R5: un estatusId arbitrario en la entrada NO altera donde nace la orden" + "R5/R15: un estatusId inexistente se IGNORA…" |
| R6 | `destino-creacion.test.ts` "la funcion es pura…" + "las dos ramas son distintas en las TRES propiedades" · `bulk-orden-service.test.ts` "la ruta de persistencia la elige el flag, no la vía" |
| R7 | `orden-service.test.ts` "R7: catalogo sin el value de la rama resuelta → validation_error que lo NOMBRA" · `bulk-orden-service.test.ts` "R7/R20: … error que lo NOMBRA" |
| R8 | `orden-repository.creacion-bifurcada.test.ts` "R8: usa la MISMA secuencia atomica…" + "R8: sobre una orden que YA tiene guia, la guarda impide consumir un segundo numero" |
| R9 | `orden-service.test.ts` "R9: la creacion NUNCA asigna mensajero" · `orden-repository.creacion-bifurcada.test.ts` "R9: … tampoco en la rama con guia" |
| R10 | `orden-service.test.ts` "R10: deja historial de creacion con la familia de la via" · `orden-repository.creacion-bifurcada.test.ts` "R10: la numeracion va ANTES del historial…" · `orden-repository.carga-api.test.ts` "R8: deja 1 historial por orden creada" |
| R11 | `orden-repository.creacion-bifurcada.test.ts` — describe "155/R11" completo (6 casos: `create`, `create` con guía, las dos rutas de lote, cero por duplicada, no-op sin dirección) |
| R12 | `orden-repository.creacion-bifurcada.test.ts` — describe "155/R12" (3 casos: falla el historial, falla el encolado, falla la numeración) |
| R13 | `orden-service.test.ts` "R13: maestro creando PARA una tienda evalua el flag de ESA tienda" + "R13: admin creando para una tienda sin fulfillment…" |
| R14 | `orden-service.test.ts` "R14: adminTienda con fulfillment=false…" |
| R15 | `orden-service.test.ts` (suite `crear` preexistente: rol no autorizado, `tiendaId` obligatorio, `NumRemisionDuplicadoError` → `conflict`) + "R5/R15: un estatusId inexistente se IGNORA…" |
| R16 | `bulk-orden-service.test.ts` "R16: … fulfillment=true → en_preparacion, SIN guia" y "R16: … fulfillment=false → por_recolectar_en_tienda, CON guia" |
| R17 | `bulk-orden-service.test.ts` "R17: el dryRun de la rama (b) NO consume ninguna guia" + la suite de dry-run preexistente (`vecesPersistido` / `expectSinPersistir`) |
| R18 | `bulk-orden-service.test.ts` "R18: el estatus resuelto se reporta tambien en duplicadas intra-archivo, sin numerar" |
| R19 | `bulk-orden-service.carga-api.test.ts` "155/R19/R20: consulta el flag del dueño de la key…" |
| R20 | idem (guía asignada y reportada) + `bulk-orden-service.carga-api.test.ts` "happy path" |
| R21 | `bulk-orden-service.carga-api.test.ts` "155/R21: dueño con fulfillment=true → en_preparacion y numGuia null" · `orden-repository.creacion-bifurcada.test.ts` describe "155/R21" |
| R22 | `order-status-transiciones.guardia.test.ts` "R22: ya NO es legal que una orden NAZCA en en_ruta_bodega_central" · `bulk-orden-service.test.ts` "155/R22: la vía sesión NUNCA crea en en_ruta_bodega_central" |
| R23 | `ordenes-api-key-carga.route.test.ts` "R23: el resto del contrato de respuesta queda intacto al sumar `manifiesto`" + la suite 88/98 preexistente |
| R24 | `manifiesto-service.test.ts` "155/R24 recoleccion_tienda: TIENDA → CENTRAL…" y describe "155/R24 — el flujo … esta declarado y es seleccionable" · `ordenes-api-key-carga.route.test.ts` "R24: la rama (b) expone el manifiesto … armado por el SERVICIO UNICO" |
| R25 | `ordenes-api-key-carga.route.test.ts` "R25: si el manifiesto LANZA, la carga NO se revierte…" + "R25: un `forbidden` … degrada a error" |
| R26 | `destino-creacion.test.ts` "R26: el lote NO emite manifiesto" · `ordenes-api-key-carga.route.test.ts` "R26: la rama (a) NO emite manifiesto" + "R26: sin ordenes creadas…" |
| R27 | `tests/unit/types/order-status.test.ts` "feature 155/R27: el estado de fulfillment ya NO esta en el seed" + "los 17 values previos siguen intactos" · `tests/unit/scripts/seed-order-status.test.ts` "feature 155/R27: NO siembra el estado retirado" |
| R28 | `order-status-transiciones.guardia.test.ts` describe "155/R27/R28 — BAJAS EJECUTADAS" (6 casos) |
| R29 | `guia-asignacion-service.test.ts` "156/R4 — origen UNICO en_preparacion" y "156/R16" (los casos del value retirado **reemplazados** por otros orígenes no permitidos, no borrados) |
| R30 | `tests/unit/config/ordenes-config.test.ts` describe "155/R30" (3 casos, incluido el censo de `process.env` en `app/` y `lib/`) |
| R31 | `destino-creacion.test.ts` describe "155/R31" · `order-status-transiciones.guardia.test.ts` "R31: ESTADOS_CREACION tiene EXACTAMENTE dos values" + "R31: nacer en cualquier otro estado del catalogo es ilegal" |
| R34 | `order-status-retiro-en-fulfillment-migration.test.ts` describe "155/R34" (5 casos: vivas y borradas, sin `deleted_at` en el UPDATE, sin tocar guía/mensajero/prioridad, idempotencia) |
| R35 | idem, describe "155/R35" (5 casos: una fila por orden, `ajuste_estado`, sin actor, motivo literal, orden de los pasos) |
| R36 | idem, describe "155/R36" (2 casos) |
| R37 | idem, describe "155/R37" (4 casos, incluido "si se migró aunque sea UNA orden, el propio rastro impide el borrado") |
| R38 | idem, describe "155/R38" (7 casos: round-trip con y sin historial, no retrocede lo que avanzó, borra solo el rastro) |
| R39 | idem, describe "155/R39" (2 casos) |
| R40 | idem, describe "155/R40" (3 casos: sin tablas de jobs/notificaciones, solo 3 tablas escritas, sin triggers) |
| R42 | `tests/unit/api/openapi-contrato-en-reparto.test.ts` describe "155/R42" (5 casos: enum TS, enum `.yaml` espejo, prosa, ejemplos) |
| R43 | idem, describe "153/R13 — eventos publicos" ampliado (3 casos: conteo, **los 9 previos siguen**, el nuevo entra) · `orden-webhook-enqueue.test.ts` "creacion (carga por API) y gestion encolan ambas al pasar por el mismo choke point" |

---

## 6. Salida real de la verificación

```
$ pnpm run typecheck
> tsc --noEmit

app/(app)/ordenes/_components/EstatusBadge.tsx(15,3): error TS2353: Object literal may only specify known properties, and 'en_fulfillment' does not exist in type 'Record<…, string>'.
app/(app)/ordenes/_components/EstatusBadge.tsx(45,3): error TS2353: Object literal may only specify known properties, and 'en_fulfillment' does not exist in type 'Record<…, BadgeVariant>'.
app/(app)/ordenes/_components/EstatusBadge.tsx(82,3): error TS2353: Object literal may only specify known properties, and 'en_fulfillment' does not exist in type 'Partial<Record<…, string>>'.
 ELIFECYCLE  Command failed with exit code 2.

   -> 3 errores, TODOS en 1 archivo .tsx. Cero en app/ (resto), lib/, scripts/, tests/*.ts.

$ pnpm run lint
✖ 10 problems (0 errors, 10 warnings)
   -> los MISMOS 10 warnings preexistentes que ya declararon la 154 y la 156
      (react-hooks/exhaustive-deps y no-unused-vars en archivos que esta fase no toca).
      CERO nuevos.

$ pnpm exec vitest run tests/unit tests/integration e2e      # todo lo que esta fase posee
 Test Files  463 passed (463)
      Tests  5193 passed (5193)

$ pnpm exec vitest run tests/components                      # .tsx (fase frontend)
 Test Files  2 failed | 107 passed (109)
      Tests  2 failed | 1121 passed (1123)
 FAIL  EstatusBadgeCatalogoV2.test.tsx > "tiene una etiqueta por cada uno de los 20 values, sin sobrantes"
 FAIL  EstatusBadgeEnReparto.test.tsx  > "el mapa cubre los 20 values del catalogo, sin sobrantes"

$ pnpm test
 Test Files  2 failed | 570 passed (572)
      Tests  2 failed | 6314 passed (6316)

$ ./init.sh
== Arnes SDD :: init ==
✓ node v24.13.0
✓ dependencias presentes
✓ regla max-2-por-zona respetada (in_progress=2)
✓ specs presentes para features sdd en vuelo
-> pnpm run typecheck
✗ 'pnpm run typecheck' fallo          <-- los 3 errores de EstatusBadge.tsx

$ git status --porcelain
(vacío)
```

**Partida de base:** 569 archivos / 6218 tests. **Final:** 572 / 6316 (**+3 archivos, +98 tests**),
de los cuales 2 fallan y los dos son `.tsx` del bloque 6.

**Cero `.tsx` tocados** (verificado con `git diff --stat` sobre los dos commits: no aparece ningún
`.tsx`).

---

## 7. Decisiones tomadas y discrepancias con el spec

1. **`createManyOrdenesConGuia` gana `opciones.conGuia` en vez de nacer un método hermano.**
   El diseño (§3.3) dice que la rama defensiva de R21 devuelve `numGuia: null` pero no dice por qué
   ruta. Reusar `createManyOrdenes` no servía (devuelve un contador, no ids, y R23 exige el bloque
   `ordenes` completo). Un método hermano habría duplicado la transacción entera — que es
   literalmente el argumento A6 del propio diseño para `create`. Consecuencia: el nombre del método
   "miente" un poco cuando `conGuia: false`; se documenta en su JSDoc.

2. **`CargaViaApiResult` gana `destino`, el `summary` no.** El diseño no dice cómo sabe el borde si
   emitir manifiesto. Derivarlo de `numGuia !== null` habría acoplado dos campos que
   `DestinoCreacion` separa a propósito. Se pasa por el resultado del service, que es interno; el
   cuerpo JSON público solo gana `manifiesto`.

3. **El manifiesto del canal API va INLINE (`{ filas, omitidas }`), no como URL firmada.** El diseño
   §8 admitía "inline o como URL firmada". El `.xlsx` se arma en el navegador en la vía de sesión
   (el servidor nunca genera binarios de manifiesto) y un integrador quiere las filas, no un enlace
   caduco a un Excel. Inline evita además tocar Storage.

4. **El enum de OpenAPI NO se puso al día entero.** El diseño §6 pide dos cambios (baja del value
   retirado, alta del nuevo) y eso es lo que hice. Descubrí que la lista lleva **desde la feature
   109** sin incorporar values que una orden del integrador SÍ puede alcanzar (`sin_gestionar` y los
   tres del flujo de devolución de la 139). **No lo arreglé**: excede el alcance, y `incidente`
   además sigue bajo el censo de "declarado y sin productor" de la 154 hasta la 158. **Queda
   declarado aquí como deuda** y anotado en el propio archivo.

5. **La prosa del contrato público no escribe el literal retirado.** R42 dice que la spec "NO DEBE
   documentar `en_fulfillment`". Escribí "el estado interno de fulfillment en bodega fue retirado
   del catálogo", que informa al integrador sin reintroducir el literal (que además dispararía el
   censo de T8.1 sobre `lib/`).

6. **El guard de la 154 (`censo-catalogo-estados-v2.test.ts`) se reduce, no se borra.**
   `por_recolectar_en_tienda` y `recoleccion_tienda` **se gradúan** (ya tienen productor);
   `incidente` sigue censado hasta la 158. Se añadieron dos casos que afirman que los graduados
   siguen existiendo y que ya aparecen en módulos de negocio — si no, el guard dejaría de vigilar
   algo sin que nadie se enterara.

7. **Hallazgo sobre el `DELETE` del catálogo, que el diseño no anticipaba del todo.** El rastro del
   paso 1 referencia el value retirado en `estatus_origen_id`, así que **en cuanto se migra UNA sola
   orden el paso 3 se vuelve no-op**, incluso en una base "limpia". El `DELETE` solo llega a borrar
   si no había *nada* que migrar. Es correcto (el rastro es lo que hace reversible el DOWN), pero
   significa que "el value desaparece de la tabla" **no es una promesa** de esta migración. Está
   escrito en un test propio para que no se lea como un descuido.

8. **`crearOrdenSchema` no se hizo `.strict()`.** Se retiró `estatusId` y punto: una entrada legada
   que lo siga mandando se ignora en silencio, como dice el diseño §3.1. El test de R5 verifica el
   comportamiento (nace donde manda el flag), no el rechazo.

---

## 8. Qué le queda a la fase frontend

**Worklist compilada** (la da `tsc`, no hace falta buscar nada):

1. **T6.1 — `EstatusBadge.tsx`**: borrar las 3 entradas del value retirado en `ORDER_STATUS_LABELS`
   (línea 15), `ORDER_STATUS_VARIANT` (45) y el refuerzo de acento de `ORDER_STATUS_CLASS` (82).
   Con eso caen los 3 errores de `tsc` y los 2 tests de componente. **R41** (degradar un value
   desconocido al chip neutro) ya está implementado en el componente; falta el caso de test.
2. **T6.2 — `OrdenesRevisionMaestro.tsx`** (apartado "En fulfillment", líneas 167-175 + 2
   comentarios), **`OrdenesListado.tsx`** (`case` en `accionesDe`, línea 304, + comentario en 108) y
   el comentario de `ordenes-columns.tsx`. **Ninguno de los tres rompe el build** (el `switch` es
   sobre `string | undefined` y el prop `estatusValue` es `string`), así que es limpieza de
   comportamiento, no de tipos → **R32**.
3. **T8.2 (mitad `.tsx`)**: 5 archivos de test siguen nombrando el literal —
   `EscanerRecepcion.test.tsx`, `ManifiestoFlujos.test.tsx`, `OrdenesListadoBloqueoCierre.test.tsx`,
   `OrdenesRevisionMaestro.test.tsx`, `EstatusBadgeEnReparto.test.tsx`. La mitad `.ts` **ya está
   hecha**.
4. **T8.1 — extender el censo** (`censo-order-status-rename.test.ts`) con el value retirado. **No lo
   hice a propósito**: hasta que caigan los 8 archivos `.tsx` de arriba, el guard estaría rojo. La
   allowlist necesitará 3 entradas justificadas: `rename-order-status-migration.test.ts` (afirma el
   texto de una migración histórica), `order-status-enum-migration.test.ts` (ya está, por la 135) y
   `order-status-retiro-en-fulfillment-migration.test.ts` (afirma el literal que la migración
   retira). Nada más: todo lo demás ya está limpio o usa concatenación (`["en","fulfillment"].join("_")`),
   el mismo patrón que este repo ya usaba para los values pre-137.
5. **T8.3** — cerrar el mapa `R<n> → test` con R32/R41.

**Nada de lo anterior toca `lib/`, `db/` ni `app/api/`.** Si la fase frontend cree que necesita
tocar backend, conviene coordinarlo antes.

---

## 9. Qué NO verifiqué (explícito)

1. **Nada contra Postgres real.** No hay base en este entorno. Los tests de `tests/integration/db`
   son **estáticos** (leen el SQL por regex) y los de esta feature añaden además una **simulación en
   memoria** de la semántica del UP/DOWN. En concreto **no** se ejecutó:
   - `prisma migrate deploy` de la migración nueva;
   - el round-trip real `deploy → rollback → deploy` que pide el *Hecho cuando* de T5.1/T5.2 ("el
     SQL corre dos veces seguidas contra una base local **con** órdenes en ese estado");
   - la comprobación de conteos por estado antes/después que pide T5.2.
   La idempotencia y la reversibilidad están **modeladas**, no **ejecutadas**. Es la misma deuda que
   declaró la 154 en `progress/impl_154.md`, ahora sobre una migración que **sí escribe datos**, así
   que pesa más: **recomiendo correrla contra una base con órdenes en ese estado antes de mergear**.
2. **El comportamiento en runtime de la app.** No levanté `next dev` ni ejecuté ningún flujo end to
   end. La creación por las tres vías está verificada con dobles de repositorio, no contra la UI.
3. **Playwright.** `pnpm run test:e2e` no se ejecutó (solo edité un comentario en
   `e2e/reprogramacion-liberacion.spec.ts`).
4. **El PDF de etiquetas y el manifiesto reales del canal API.** Los tests inyectan dobles de
   `IEtiquetasLotePdfService` y de `IManifiestoService`; el cableado real (`buildManifiestoService`,
   con Prisma + `ZonaRepository` + `OrdenHistorialService`) **no se ejerció**. Es el mismo patrón que
   ya tenía `buildEtiquetasService`, pero conviene saberlo: un fallo de wiring ahí saldría como
   `manifiesto: { error }` en producción, no como un test rojo.
5. **Si hay órdenes vivas en el estado retirado en producción.** No consulté la base de producción
   (`DATABASE_URL` de prod es "sensitive"). El backfill las cubre por construcción, pero **el censo
   de R39 sobre datos reales está sin hacer**.
6. **Que el `.yaml` publicado siga siendo válido como OpenAPI 3.1.** El test compara los 4 bloques
   `enum` y la prosa contra el objeto TS, pero **no parsea el YAML** ni lo valida contra el esquema
   de OpenAPI. Edité el archivo con reemplazos de texto sobre bloques completos, así que la
   indentación se conserva, pero no hay un validador que lo garantice.
7. **La compatibilidad hacia atrás para integradores existentes.** El cambio de estado inicial es
   **incompatible** y está documentado en la spec y el `.yaml`, pero **no hay ningún aviso enviado**:
   eso es una acción de producto, no de código.
