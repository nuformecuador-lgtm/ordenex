# impl_156 (BACKEND) — Generar guía SIN asignar mensajero

> Rama: `feature/156-guia-sin-mensajero` (sale de `feature/154-catalogo-estados-v2`, **no** de `dev`)
> Worktree: `R:/job/singularis/projects/ordenex-wt-156` · Zona: `fullstack` · Fase: **A (backend)**
> Spec: `specs/156-guia-sin-mensajero/` (R1–R30) · Fecha: 2026-07-29

---

## 1. Veredicto

**Fase A hecha y verde.** "Generar guía" pasa de tres efectos a uno: numerar y mover de
`en_preparacion` a `en_bodega_central`. El grafo pierde las tres aristas que esta feature deja
sin productor (**#4, #6, #7c**) y `#5` sobrevive como destino único. `asignarDesdeBodega` y
`AsignacionSateliteService` quedan **sin una sola línea de cambio** y son, desde ahora, los dos
únicos escritores de `mensajero_asignado_id` del sistema.

`./init.sh` termina en `== init OK ==` con **547 archivos / 5737 tests / 0 fallos**.
**Cero archivos `.tsx` tocados. Sin migración** (ninguna hacía falta; el diseño no se torció).

**Dónde termina mi parte:** en el borde. `lib/actions/ordenes-guia.ts::generarGuia` ya valida
`{ ordenIds }`. Todo lo que está por encima (`GenerarGuiaModal.tsx`, `OrdenesListado.tsx`,
`OrdenesRevisionMaestro.tsx` y sus tests de componente) es Fase B y **NO lo toqué**. Las tareas
`T B.*` y `T C.*` de `tasks.md` quedan sin marcar.

---

## 2. Qué se implementó

### 2.1 Contrato (T A.1.1)

| Archivo | Cambio |
| --- | --- |
| `lib/interfaces/services/IGuiaAsignacionService.ts` | `GenerarGuiaInput = { ordenIds: string[] }`. **`GenerarGuiaDecision` eliminado** (cero referencias fuera de `specs/`/`progress/` y de un comentario que documenta el retiro). Docblocks de `generarGuia` y `rutearABodegaSatelite` reescritos. |
| `lib/types/orden-guia.ts` | `generarGuiaSchema = z.object({ ordenIds: z.array(z.string().min(1)) })`. |

`GenerarGuiaResult` conserva sus cinco variantes; `guia-decision-error-messages.ts` no se tocó.
`buildGuiaService()` **conserva sus 3 dependencias**: retirar `IZonaRepository` o
`IAsignabilidadCoordenadasService` desactivaría gates de los otros dos métodos.

### 2.2 Servicio (T A.2.1 – T A.2.4)

`lib/services/GuiaAsignacionService.ts`:

- `ORIGEN_GENERAR_GUIA`: `Set{en_fulfillment, en_preparacion}` → `"en_preparacion"`.
- `ORIGEN_RUTEO_SATELITE` (la línea 35 del enunciado): `Set{3 valores}` → `"en_bodega_central"`;
  la comprobación pasa a `!==`. **No queda ningún `Set` de orígenes en el archivo.**
- `generarGuia` reescrito: autorización → guardas por orden → `findEstatusIdByValue("en_bodega_central")`
  → `generarGuiaLote` con `mensajeroAsignadoId: null` → resultado con `estado: "en_bodega_central"`.
  Retirados de su cuerpo: `centralZonaId`/`GAM_NO_CONFIGURADA`, `findMensajeroIdsValidosByZona`,
  `findMensajerosBloqueados`, `zonasSateliteBloqueadas`, `gateCoordenadas` y `estatusDestino`.
- Helpers privados `gateCoordenadas` y `zonasSateliteBloqueadas`: **siguen existiendo y siendo
  usados** por `asignarDesdeBodega` y `rutearABodegaSatelite` respectivamente. Ninguna constante
  quedó huérfana (lint lo confirma: 0 `no-unused-vars` nuevos).
- Comentarios de cabecera reescritos: ningún comentario del archivo sigue afirmando que
  `generarGuia` asigna mensajero o rutea a satélite.

**T A.2.4 verificada de verdad:** `AsignacionSateliteService.ts` no aparece en `git status`
(byte-idéntico). En el diff de `GuiaAsignacionService.ts`, las únicas apariciones de
`asignarDesdeBodega` son comentarios y el comentario de una constante — **cero líneas de su
cuerpo**. Igual con `asignarBodegaLote`.

### 2.3 Grafo de transiciones (el corazón de la feature)

`lib/types/order-status-transiciones.ts` — `en_preparacion` pasa de 4 aristas a 1:

| Arista | Par | Vía | Estado |
| --- | --- | --- | --- |
| #4 | `en_preparacion → por_recoger` | `generacion_guia` | **RETIRADA** |
| #5 | `en_preparacion → en_bodega_central` | `generacion_guia` | **SOBREVIVE** (destino único) |
| #6 | `en_preparacion → en_ruta_bodega_satelite` | `generacion_guia` | **RETIRADA** |
| #7c | `en_preparacion → en_ruta_bodega_satelite` | `ruteo_satelite` | **RETIRADA** |

Recuentos: **45 → 42** aristas de flujo, **41 → 39** pares únicos, 4 de creación sin cambio.
(−3 aristas; −2 pares porque #6 y #7c compartían par.)

Las cuatro de `en_fulfillment` (#1/#2/#3/#7b) **se conservan** y pasan a estar *declaradas y sin
productor*: retirarlas aquí dejaría ese estado sin ninguna salida legal (rompe el invariante de
conectividad) y atraparía sus órdenes vivas. Son de la 155 y su `callSite` en el inventario ahora
lo dice explícitamente.

---

## 3. Los tests de la 154 que rompieron y a qué verdad los moví

La 154 dejó `tests/unit/domain/order-status-transiciones.guardia.test.ts` ›
*"154 — BAJAS DIFERIDAS: R18-R21 se mudan a las features 155/156"* como contrato de postergación,
con cuatro casos que afirmaban *"la arista SIGUE siendo legal"*. **Rompieron aquí, como estaba
previsto.** Ninguno se borró ni se relajó:

| Caso de la 154 | Qué le pasó |
| --- | --- |
| `R18 (#4, lo retira la 156): en_preparacion -> por_recoger SIGUE siendo legal` | **Movido** al describe nuevo `156 — BAJAS EJECUTADAS`, invertido a `expect(...).toThrow(TransicionIlegalError)` con el nombre `154/R18 = #4: en_preparacion -> por_recoger ya NO es legal (lo retiro la 156)` |
| `R19 (#6/#7c, los retira la 156): en_preparacion -> en_ruta_bodega_satelite SIGUE siendo legal` | **Movido** igual: `154/R19 = #6 y #7c: ... ya NO es legal (lo retiro la 156)` |
| `R20 (#1, lo retira la 155)` | **Se queda diferido.** Sigue afirmando "SIGUE siendo legal", ahora en el describe renombrado `154 — BAJAS DIFERIDAS: R20/R21 se mudan a la feature 155`, con el comentario actualizado (la 156 ya les quitó el productor; la arista muere con la 155) |
| `R21 (#3/#7b, los retira la 155)` | Igual que R20 |
| `la 154 no retira ninguna arista: el mapa conserva las 43 previas y suma 2` | **Reemplazado** por `el mapa retira EXACTAMENTE tres aristas: 45 -> 42 (y 41 -> 39 pares)`. La afirmación "la 154 fue aditiva" se conserva en el comentario de cabecera, que es donde es cierta. |
| `154/R27 › los recuentos del inventario son 45 flujo / 41 pares / 4 creacion` | Actualizado a `42 / 39 / 4` |
| `R8 › el inventario de flujo tiene las 45 aristas y 41 pares unicos` | Renombrado y actualizado a 42/39 |

Además añadí dos casos nuevos que fijan la nueva verdad de forma positiva (no solo "ya no es
legal"): `156/R3: la UNICA salida legal de en_preparacion es en_bodega_central` (guardia) y
`156/R3: en_preparacion tiene una sola salida y no deja huerfano a ningun destino`
(conectividad, que además verifica que `por_recoger` y `en_ruta_bodega_satelite` siguen
alcanzables por otras vías).

`en_fulfillment conserva sus cuatro aristas (declaradas y sin productor)` es nuevo: fija que la
156 **no** se pasó de frenada con lo que le toca a la 155.

---

## 4. La trampa del choke point: dos archivos que el spec daba por intactos

`appendCambioEstado` valida legalidad con guardia de **fallo cerrado** desde la 140. Retirar
#4/#6/#7c puso en rojo **7 tests en 2 archivos** cuyos dobles de `tx` **sí ejecutan la guardia
de verdad** (siembran el catálogo real con `sembrarCatalogoEstados()`), no la esquivan:

| Archivo | Casos rotos | Par ilegal | Arreglo |
| --- | --- | --- | --- |
| `tests/unit/repositories/orden-repository.guia.test.ts` | 4 de `generarGuiaLote` | `en_preparacion → por_recoger` (#4) | fixtures a pares vivos (ver abajo) |
| idem | 2 de `rutearBodegaSateliteLote` | `en_preparacion → en_ruta_bodega_satelite` (#7c) | orígenes → `en_bodega_central` |
| `tests/unit/repositories/orden-historial-atomicidad.test.ts` | 2 (mecanismo #3) | `en_preparacion → por_recoger` (#4) | destino → `en_bodega_central` |

**Esto contradice el spec.** `tasks.md` T A.3.6 exige cerrar la fase *"sin haber modificado
`orden-repository.guia.test.ts`"*, y `design.md` §7 ni menciona `orden-historial-atomicidad.test.ts`.
Ambas cosas eran incorrectas: los tests del repo alimentan pares (origen, destino) a mano, y tres
de los que usaban dejan de existir. No es una relajación — es actualizar un fixture a un par que
el grafo declara. Detalle:

- `decision()` por defecto: `{ por_recoger, mensajeroAsignadoId: "m1" }` → `{ en_bodega_central,
  mensajeroAsignadoId: null }`, que es exactamente lo que el service produce ahora.
- El caso de **feature 76/R23 (W1)** —`asignado_at` se estampa solo si el mensajero no es nulo—
  **se conserva íntegro**: solo se fija el origen pre-leído a `en_bodega_central`, para que el par
  sea #8 (declarado y permanente) en vez de #4. Es el único sitio que sigue ejercitando el
  parámetro `mensajeroAsignadoId`, que a partir de aquí queda **muerto** (design §6/E: se limpia
  con la 159, no aquí).
- El caso `R11: registra historial con destino real por orden y origen pre-leido` **gana**
  discriminación: antes las dos filas tenían el mismo origen (`en_fulfillment`); ahora difieren en
  origen *y* destino (#8 y #5), así que un repo que hardcodease cualquiera de los dos lados
  fallaría.
- El caso `R13: registra historial por orden con origen pre-leido` **pierde** un poco: sus dos
  filas ahora comparten origen (`en_bodega_central`), porque es el único que `rutearABodegaSatelite`
  admite. Sigue detectando un origen hardcodeado o nulo, pero ya no distingue "lee el de cada
  orden" de "lee el de la primera". Preferí eso a apoyarme en #7b, que la 155 va a retirar.

**Barrido completo:** no quedó ningún otro call-site vivo de las tres aristas. `rg "en_preparacion"`
sobre `lib/` y `app/` devuelve solo el catálogo, el config y las dos constantes del service.

---

## 5. Mapa `R<n> → test` (backend, R1–R19)

Cada fila cita archivo y nombre del `it`. Todos fallan si el comportamiento se rompe.

| R | Test |
| --- | --- |
| **R1** | `unit/services/guia-asignacion-service.test.ts` › *"R1/R3: un lote en en_preparacion queda numerado y en en_bodega_central"* |
| **R2** | idem › *"toda decision persistida lleva mensajeroAsignadoId null"* (3 órdenes heterogéneas) y *"no consulta mensajeros por zona ni mensajeros bloqueados: no hay a quien asignar"* · `guia-asignacion-gate-coordenadas.test.ts` › *"156/R2: ninguna decision del lote lleva mensajero (por eso el gate sobra)"* |
| **R3** | idem › *"R3: en_bodega_central es el UNICO destino; nadie termina en por_recoger ni en satelite"* (afirma además que solo se resuelve UN estado del catálogo) · `unit/domain/order-status-transiciones.guardia.test.ts` › *"156/R3: la UNICA salida legal de en_preparacion es en_bodega_central"* · `…connectividad.test.ts` › *"156/R3: en_preparacion tiene una sola salida y no deja huerfano a ningun destino"* |
| **R4** | `guia-asignacion-service.test.ts` › *"origen %s -> conflict con el motivo tipado, sin numerar nada"* (`it.each` sobre `en_fulfillment`, `en_bodega_central`, `por_recoger`, `entregada`) |
| **R5** | idem › *"una orden que ya tiene num_guia conserva el mismo valor y lo devuelve"* y *"dos invocaciones consecutivas devuelven guias distintas y crecientes"* · `unit/repositories/orden-repository.guia.test.ts` › *"el UPDATE crudo filtra WHERE num_guia IS NULL y usa la secuencia constante (R5/R3)"* |
| **R6** | idem › *"una sola orden con origen invalido aborta el lote entero, sin numerar ninguna"* y *"propaga el fallo de la transaccion sin envolverlo (rollback total delegado a la DB)"* |
| **R7** | idem › *"orden inexistente -> conflict con motivo por orden, sin efectos"*, *"orden borrada (deletedAt) -> conflict, sin efectos"*, *"orden reprogramada -> conflict con el motivo tipado de reprogramacion"* |
| **R8** | idem › *"R8: registra el lote con origenTipo generacion_guia y el actor que lo ejecuto"* · `orden-repository.guia.test.ts` › *"R11: registra historial con destino real por orden y origen pre-leido"* · `unit/repositories/registrar-cambio-estado.guardia.test.ts` › *"#5 deja pasar en_preparacion -> en_bodega_central (origen_tipo generacion_guia) y registra el historial"* (data-driven sobre el inventario, atraviesa el choke point real) |
| **R9** | `guia-asignacion-service.test.ts` › *"maestro puede generar guia"*, *"feature 94: admin tiene paridad con maestro y puede generar guia"*, *"adminTienda/mensajero -> forbidden sin tocar datos"* · `integration/actions/ordenes-guia-action.test.ts` › *"generarGuia"* (bloque `R14: sin sesion valida -> unauthenticated antes de tocar el service`) |
| **R10** | idem › *"R10: con TODOS los mensajeros en cierre abierto, generar guia sigue funcionando"* |
| **R11** | idem › *"R11: una orden de zona satelite con un cierre abierto se numera igual"* |
| **R12** | idem › *"R12: una orden en estado %s se numera igual (el gate de coordenadas no participa)"* (`it.each` sobre los 5 estados no asignables) · `guia-asignacion-gate-coordenadas.test.ts` › *"motivo %s -> ok igualmente, la orden se numera"* y *"un lote entero sin coordenadas se numera completo"* |
| **R13** | idem › *"R13: sin zona GAM configurada, generar guia funciona con normalidad"* (afirma que ni se consulta `findCentralZonaId`) |
| **R14** | `integration/actions/ordenes-guia-action.test.ts` › *"156/R14: el contrato viejo con decisiones/mensajeroId -> validation_error, sin llamar al service"*, *"156/R14: un mensajeroId colado junto a ordenIds NO llega al service"*, *"input invalido -> validation_error sin llamar al service"*, *"ordenIds vacio es valido (lote vacio); un id vacio no lo es"* |
| **R15** | `guia-asignacion-service.test.ts` › *"156/R15: rutea N ordenes no-GAM desde en_bodega_central -> en_ruta_bodega_satelite"* |
| **R16** | idem › *"156/R16: origen %s -> conflict 'estado de origen no permitido', sin efectos"* (`it.each`: `en_preparacion`, `en_fulfillment`) y *"156/R6: una orden en en_preparacion aborta el lote entero"* |
| **R17** *(no-regresión)* | idem, bloque `GuiaAsignacionService.asignarDesdeBodega (R26-R29)` (5 casos), `Feature 30 — asignarDesdeBodega rechaza no-GAM (R12)`, `Feature 30 — guardia zona GAM no configurada (R4)`, `bloqueo de mensajero (feature 41/R13/R23)`, `bloqueo por reprogramacion (feature 46)` · `guia-asignacion-gate-coordenadas.test.ts` › bloque `R8 — asignarDesdeBodega` (4 casos). **Ninguna aserción de estos se modificó.** |
| **R18** *(no-regresión)* | `unit/services/asignacion-satelite-service.test.ts` (18 casos) y `unit/services/asignacion-satelite-gate-coordenadas.test.ts` (5 casos). **Archivos sin tocar** (`git status` limpio). |
| **R19** | `guia-asignacion-gate-coordenadas.test.ts` › bloque `R8 — asignarDesdeBodega` (gate intacto en el writer 1) · `asignacion-satelite-gate-coordenadas.test.ts` › bloque `R8 — AsignacionSateliteService.asignar` (gate intacto en el writer 2) · + R2 arriba, que prueba que `generarGuia` dejó de ser writer |

**R20–R30 son de frontend: sin cubrir en esta fase, a propósito.**

---

## 6. Archivos modificados (13, ninguno `.tsx`)

**Producción (4):**
`lib/interfaces/services/IGuiaAsignacionService.ts`, `lib/types/orden-guia.ts`,
`lib/services/GuiaAsignacionService.ts`, `lib/types/order-status-transiciones.ts`.

**Tests y fixtures (9):**
`tests/fixtures/inventario-transiciones-140.ts`,
`tests/unit/domain/order-status-transiciones.{guardia,connectividad}.test.ts`,
`tests/unit/services/guia-asignacion-{service,gate-coordenadas}.test.ts`,
`tests/integration/actions/ordenes-guia-action.test.ts`,
`tests/unit/repositories/{orden-repository.guia,orden-historial-atomicidad,registrar-cambio-estado.guardia}.test.ts`.

**Creados (1):** esta bitácora.
**Sin tocar y verificado:** `AsignacionSateliteService.ts`, `OrdenRepository.ts`, `lib/actions/ordenes-guia.ts`, `db/`, todo `app/`.

---

## 7. Discrepancias entre el spec y la realidad

1. **`design.md` §7 dice que `tests/fixtures/inventario-transiciones-140.ts` "lo actualiza la 154"
   y que esta feature no debería tocarlo.** Falso: la 154 quedó solo aditiva por decisión Q2 del
   gate, así que el inventario aún contenía #4/#6/#7c. Lo actualicé yo (es el requisito central de
   la feature). No es drift de la 154: es que el design se escribió antes de esa decisión.
2. **`tasks.md` T A.3.6 exige cerrar sin modificar `orden-repository.guia.test.ts`.** Imposible:
   ver §4. Modificado, con justificación por caso.
3. **`design.md` §7 no lista `orden-historial-atomicidad.test.ts`.** También rompía; ver §4.
4. **`design.md` §3.1 dice que `GenerarGuiaResultadoItem.estado` es `string`** y en §5 que siempre
   vale `"en_bodega_central"`. Lo dejé como `string` (no literal), como pide el design, con el
   invariante documentado en el tipo y fijado por test (R3). Estrechar el tipo aquí obligaría a
   tocar `lib/types/orden-guia.ts` y la UI en la misma fase.
5. **Pregunta abierta 2 (parámetro muerto `mensajeroAsignadoId` del repo):** resuelta como dice el
   design (alternativa E descartada) — **se deja documentado como muerto**, no se limpia. Va con
   el barrido de la 159.
6. **Pregunta abierta 1 (ventana `en_fulfillment`)** sigue abierta y es de release, no de código:
   asumida como TREN 154+155+156, igual que la cerró la 154 (Q3).

---

## 8. Lo que NO verifiqué — deuda declarada

1. **Nada contra una base de datos real.** No hay Postgres en este entorno. La legalidad de #5 y
   la ilegalidad de #4/#6/#7c se verifican con el choke point real (`appendCambioEstado`) pero
   contra un doble de `tx` con catálogo sembrado en memoria. No ejecuté `prisma migrate deploy` ni
   ninguna transacción real. Es la misma deuda que declaró la 154.
2. **T C.2 (repaso manual en dev) NO hecho.** Requiere la Fase B: hoy el modal sigue enviando
   `decisiones` contra un zod que espera `ordenIds`, así que el camino por UI devuelve
   `validation_error` en cada intento. **Esto es esperado y está en el design §8 como riesgo
   asumido de entrega parcial** — no es una regresión que la Fase B deba "descubrir".
3. **E2E (Playwright): no corrido.** El único flujo crítico que toca esta feature pasa por el
   modal, que es Fase B.
4. **Comportamiento del webhook de cambio de estado** ante el destino nuevo: no lo probé
   explícitamente. El destino `en_bodega_central` ya se emitía antes por esta misma vía
   (`generarGuia` sin mensajero), así que no hay evento nuevo; me apoyé en que
   `webhook-estado-encolado.test.ts` sigue verde sin cambios.
5. **`./init.sh` avisa `! no hay .env`** en este worktree (el `.env` es local y gitignoreado, no
   viaja entre worktrees). Es un `warn`, no un `fail`: el gate termina en `== init OK ==`. Para
   `pnpm db:generate` usé un `DATABASE_URL` ficticio (solo genera tipos, no conecta).
6. **`orden-repository.guia.test.ts` › `R13: registra historial por orden con origen pre-leido`**
   perdió discriminación (los dos orígenes son ahora iguales); ver §4. No encontré forma de
   conservarla sin apoyarme en la arista #7b, que la 155 va a retirar.

---

## 9. Para la Fase B (frontend)

**Listo y disponible:**

- Server Action `generarGuia(input, deps)` con el contrato nuevo: `{ ordenIds: string[] }` →
  `ok{resultados:[{ordenId, numGuia, estado:"en_bodega_central"}]}` | `unauthenticated` |
  `forbidden` | `validation_error{fieldErrors}` | `conflict{detalle:[{ordenId,motivo}]}`.
  El mapeo de errores de la UI (`guia-decision-error-messages.ts`) **no cambió**.
- `rutearABodegaSatelite` sigue con la misma firma; solo rechaza orígenes distintos de
  `en_bodega_central` (relevante para R29).
- `asignarDesdeBodega` y sus loaders (`listarMensajerosParaAsignacion`,
  `listarZonasBloqueadasPorCierre`) intactos: el `useSWR` de mensajeros de `OrdenesListado` sigue
  haciendo falta para `AsignarBodegaModal`.

**Pendiente y bloqueante para que el flujo funcione en runtime:**

1. `GenerarGuiaModal.tsx` **debe** pasar a `generarGuia({ ordenIds })`. Hoy envía `decisiones` y
   recibe `validation_error` siempre. Es lo primero que hay que tocar (T B.1.1).
2. `T B.3.1` va a tener que reescribir `tests/components/GenerarGuiaModal.test.tsx`: hoy pasa
   porque mockea la acción, así que **el verde de esos tests no significa que el modal funcione**.
3. **No toqué `ordenes-columns.tsx`** (imán de drift, y la 160 trabaja sobre él en paralelo). No
   detecté ninguna necesidad de tocarlo desde backend; si la Fase B cree que hace falta, es
   decisión suya y conviene coordinarla con la 160.
4. R28/R29/R30 (`ESTADOS_ASIGNACION`, acción "Rutear a bodega satélite" sobre
   `en_preparacion`/`en_fulfillment`, props del modal) están **enteros sin hacer**.

---

## 10. Salida real de la verificación

```
$ pnpm run typecheck
> tsc --noEmit
(sin salida: 0 errores)

$ pnpm run lint
✖ 10 problems (0 errors, 10 warnings)
  (los 10 son los MISMOS warnings preexistentes que declaró la 154: react-hooks/exhaustive-deps
   y @typescript-eslint/no-unused-vars en archivos que esta feature no toca. Cero nuevos.)

$ pnpm exec vitest run tests/unit tests/integration     # cierre de la fase A (T A.3.6)
 Test Files  439 passed (439)
      Tests  4705 passed (4705)
   Duration  69.09s

$ pnpm test
 Test Files  547 passed (547)
      Tests  5737 passed (5737)
   Duration  143.27s

$ ./init.sh
== Arnes SDD :: init ==
✓ node v24.13.0
✓ dependencias presentes
✓ regla max-2-por-zona respetada (in_progress=3)
✓ specs presentes para features sdd en vuelo
✓ typecheck paso
✓ lint paso
✓ test paso
✓ todas las migraciones tienen down.sql
! no hay .env. Crea uno a partir de .env.example
== init OK ==

$ git status --porcelain     # sin basura sin trackear (los guards recorren fs.readdir)
(13 archivos modificados, 0 untracked, 0 .tsx)
```

Partida de base (154): 547 archivos / 5735 tests. Final: **547 / 5737** (+2 netos; se retiraron
~15 casos de `generarGuia` sobre mensajero/GAM/satélite y se añadieron ~17 sobre el flujo v2).
