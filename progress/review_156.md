# review_156 — Generar guía SIN asignar mensajero

> Rama: `feature/156-guia-sin-mensajero` · HEAD `00fb13b` · Base de comparación:
> `feature/154-catalogo-estados-v2` (**no** `dev`) · Worktree: `R:/job/singularis/projects/ordenex-wt-156`
> Spec: `specs/156-guia-sin-mensajero/` (R1–R30) · Fecha: 2026-07-29
>
> Alcance de esta revisión: **solo** `git diff feature/154-catalogo-estados-v2...HEAD`
> (25 archivos). Lo que viene de la 154 se revisó en `progress/review_154.md`.

---

## 1. Veredicto

**APROBADO-CON-NOTAS.**

Cero bloqueantes de código, de test o de trazabilidad. Los R1–R30 están cubiertos por
tests que **verifiqué que muerden** (7 mutaciones propias, sección 4). Lo único que impide
mover la feature a `done` hoy es documental y no requiere tocar código: `tasks.md` sin
marcar y el estado del arnés desincronizado.

---

## 2. Verificación ejecutable (números REALES, corridos por mí)

```
$ pnpm db:generate      (DATABASE_URL ficticio; falso negativo conocido del worktree)
exit 0

$ ./init.sh
✓ node v24.13.0
✓ dependencias presentes
✓ regla max-2-por-zona respetada (in_progress=3)
✓ specs presentes para features sdd en vuelo
✓ typecheck paso
✓ lint paso            → 10 problems (0 errors, 10 warnings)
✓ test paso            → Test Files 547 passed (547) · Tests 5748 passed (5748) · 133.30s
✓ todas las migraciones tienen down.sql
! no hay .env. Crea uno a partir de .env.example      (warn, no fail)
== init OK ==

$ git status --porcelain
(vacío)
```

**Cuadra exactamente con lo declarado** por la fase B: 547 archivos / 5748 tests / 0 fallos,
lint 0 errores / 10 warnings. Verifiqué además que los 10 warnings viven en archivos que
esta feature **no toca** (`OrdenesModule.tsx`, `MisAsignacionesModule.test.tsx`,
`WebhookAccionCell.test.tsx`, `google-adc-token.test.ts`, `api-key-repository.test.ts`):
cero warnings nuevos.

### Deuda que cerré yo

`pnpm build` no se había corrido (la bitácora lo declara como deuda). Corrí
**`npx next build` con exit 0**, saltándome solo el paso `migrate-deploy`, que exige
`DATABASE_URL` real. Es justo lo que `tsc --noEmit` no ve: límites client/server y
resolución de rutas. **No hay riesgo de build.** T B.3.6 queda cerrada salvo por el paso de
migraciones, que en esta feature es vacío (sin migración).

---

## 3. Checklist de CHECKPOINTS.md

| Punto | Estado |
| --- | --- |
| `requirements.md` con EARS numerados | OK — R1–R30 |
| `design.md` con alternativa descartada y su porqué | OK — cinco (A–E), cada una con motivo |
| `tasks.md` con todas las tasks `[x]` | **FALLA — 0 de 27 marcadas** (blocker 1) |
| Cada `R<n>` mapea a un test concreto | OK — verificado uno por uno (sección 4) |
| `progress/impl_<feature>.md` con el mapa R->test | Parcial — existe partido en dos (`impl_156_backend.md` + `impl_156_frontend.md`); T C.1 pedía `impl_156.md`. Contenido completo y correcto. |
| `pnpm run typecheck` sin errores | OK |
| `pnpm run lint` sin errores | OK (0 errores) |
| `pnpm test` | OK — 5748/5748 |
| E2E si toca flujo crítico | N/A — generar guía no es auth/pagos/recaudo/ingesta/webhooks. Sin E2E antes y sin E2E ahora: no es regresión. |
| RLS en tablas nuevas | N/A — **cero migraciones**, cero tablas, cero columnas (el diff no toca `db/` ni `prisma/`) |
| Migraciones versionadas con down.sql | N/A + gate de `init.sh` en verde |
| Secretos hardcodeados | OK — ninguno (grep sobre el diff) |
| Webhooks firman/idempotentes | N/A — no se toca ninguno |
| Controller sin queries ni negocio | OK — `lib/actions/ordenes-guia.ts::generarGuia` = actor -> zod -> service, 8 líneas |
| Service sin HTTP | OK — `GuiaAsignacionService` no conoce Request/Response |
| Repository sin lógica de negocio | OK — `OrdenRepository` **no se tocó** |
| Interfaces en `lib/interfaces/` | OK — `IGuiaAsignacionService.ts` |
| Páginas protegidas validan en servidor | OK — sin cambios (`resolveActorFromSession` intacto) |
| Mutaciones por Server Action | OK |
| Sin hardcode de país/moneda/cuenta | OK — los literales nuevos son `value` del catálogo de estados, no contexto de país |
| `./init.sh` en verde | OK |
| `progress/review_<feature>.md` con veredicto | OK — este archivo |
| Entrada en `progress/history.md` | FALTA — es del leader al cerrar |

---

## 4. Trazabilidad R1–R30 — verificada por mí, no aceptada de la bitácora

Marco OK solo lo que comprobé leyendo el test **y** confirmando que no es complaciente
(o porque una mutación mía lo puso rojo).

### Mutaciones que corrí (todas revertidas; árbol final limpio)

| # | Mutación sobre producción | Rojo esperado | Resultado real |
| --- | --- | --- | --- |
| A | `generarGuia` persiste `mensajeroAsignadoId: "m-fantasma"` | R2 | **3 fallos** (R2 x2 + R8) |
| B | `asignarDesdeBodega` deja de llamar a `gateCoordenadas` | R17/R19 writer 1 | **7 fallos** |
| C | El manifiesto se pide con los ids de **props** en vez de los del **resultado** | R24 | **1 fallo** |
| D | El modal vuelve a enviar `{ decisiones: [{ordenId, mensajeroId}] }` | R22 + encadenado | **4 fallos** (reproduce exacto lo declarado) |
| E | Se reintroduce la arista #4 (`en_preparacion -> por_recoger`) | R3 / grafo | **5 fallos** |
| F | `ESTADOS_ASIGNACION` vuelve a los 3 estados | R28 | **3 fallos** (reproduce lo declarado) |
| G | `AsignacionSateliteService` deja de aplicar su gate de coordenadas | R18/R19 writer 2 | **6 fallos** |

### Mapa

| R | Test que lo verifica | Verificado |
| --- | --- | --- |
| R1 | `unit/services/guia-asignacion-service.test.ts` — *"R1/R3: un lote en en_preparacion queda numerado y en en_bodega_central"* | OK |
| R2 | idem — *"toda decision persistida lleva mensajeroAsignadoId null"* y *"no consulta mensajeros por zona ni mensajeros bloqueados"* | OK **mutación A** |
| R3 | idem — *"R3: en_bodega_central es el UNICO destino…"* (afirma además que solo se resuelve UN estado del catálogo) + `unit/domain/…guardia.test.ts` — *"156/R3: la UNICA salida legal de en_preparacion es en_bodega_central"* + `…connectividad.test.ts` — *"156/R3: … no deja huerfano a ningun destino"* | OK **mutación E** |
| R4 | `guia-asignacion-service.test.ts` — `it.each` *"origen %s -> conflict con el motivo tipado, sin numerar nada"* (`en_fulfillment`, `en_bodega_central`, `por_recoger`, `entregada`); compara el motivo **literal** | OK |
| R5 | idem — *"una orden que ya tiene num_guia conserva el mismo valor"* (débil: el mock decide) + **la que muerde**: `unit/repositories/orden-repository.guia.test.ts` — *"el UPDATE crudo filtra WHERE num_guia IS NULL y usa la secuencia constante (R5/R3)"* | OK |
| R6 | idem — *"una sola orden con origen invalido aborta el lote entero"* y *"propaga el fallo de la transaccion sin envolverlo"* | OK |
| R7 | idem — inexistente / borrada / reprogramada, los 3 con `generarGuiaLote` no llamado | OK |
| R8 | idem — *"R8: registra el lote con origenTipo generacion_guia y el actor que lo ejecuto"* (`toHaveBeenCalledWith` exacto) + `registrar-cambio-estado.guardia.test.ts` (data-driven sobre el inventario, atraviesa el choke point real) | OK **mutación A** (rompe también aquí) |
| R9 | idem — maestro / admin (feature 94) / `adminTienda`+`mensajero` -> forbidden + `integration/actions/ordenes-guia-action.test.ts` — bloque `unauthenticated antes de tocar el service` | OK |
| R10 | idem — *"R10: con TODOS los mensajeros en cierre abierto, generar guia sigue funcionando"* | OK |
| R11 | idem — *"R11: una orden de zona satelite con un cierre abierto se numera igual"* | OK |
| R12 | idem — `it.each` sobre los **5** estados no asignables, y afirma que el gate **ni se consulta** (`evaluar` / `findParaAsignabilidad` no llamados) + `guia-asignacion-gate-coordenadas.test.ts` | OK |
| R13 | idem — *"R13: sin zona GAM configurada…"*, afirma que `findCentralZonaId` **no se llama** | OK |
| R14 | `integration/actions/ordenes-guia-action.test.ts` — 4 casos, incl. *"el contrato viejo con decisiones/mensajeroId -> validation_error, sin llamar al service"* y *"un mensajeroId colado junto a ordenIds NO llega al service"* | OK |
| R15 | `guia-asignacion-service.test.ts` — *"156/R15: rutea N ordenes no-GAM desde en_bodega_central…"* | OK |
| R16 | idem — `it.each` (`en_preparacion`, `en_fulfillment`) -> conflict con motivo literal y `rutearBodegaSateliteLote` no llamado; más el caso todo-o-nada | OK |
| R17 | idem, bloques `asignarDesdeBodega (R26-R29)`, `Feature 30 (R12/R4)`, bloqueo de mensajero (41), reprogramación (46) + `guia-asignacion-gate-coordenadas.test.ts` bloque `R8 — asignarDesdeBodega` | OK **mutación B** |
| R18 | `unit/services/asignacion-satelite-service.test.ts` y `asignacion-satelite-gate-coordenadas.test.ts`, **archivos no tocados** por el diff | OK **mutación G** |
| R19 | B + G + R2: comprobé que tras la feature quedan **exactamente dos** escritores de `mensajero_asignado_id` y que **cada uno** pone rojo la suite si pierde su gate | OK |
| R20 | `tests/components/GenerarGuiaModal.test.tsx` — *"R20: lista cada orden por Nº de remisión y destinatario, y NO ofrece ningún control de mensajero"* + `OrdenesRevisionMaestro.test.tsx` — *"R30: el modal Generar guía no ofrece ningún selector"* (modal REAL montado por su padre) | OK |
| R21 | `GenerarGuiaModal.test.tsx` — *"R21: no agrupa … el texto anuncia numeradas y en bodega central"* | OK |
| R22 | idem — *"R22: confirmar hace UNA sola llamada…"*: igualdad profunda + `Object.keys(input) === ["ordenIds"]` + negativa sobre el serializado | OK **mutación D** |
| R23 | idem — *"R23: el aviso de éxito informa la cantidad y el destino ÚNICO"* (texto exacto + negativas) | OK |
| R24 | idem — *"R24: … el manifiesto del lote DEL RESULTADO y difiere onSuccess al cierre"* + `ManifiestoFlujos.test.tsx` — *"R19: tras generar guía ofrece el manifiesto"* | OK **mutación C** |
| R25 | `GenerarGuiaModal.test.tsx` — *"R25: si la descarga del manifiesto falla…"* + `ManifiestoFlujos.test.tsx` — *"R25: un fallo de la descarga NO re-ejecuta la acción de negocio"* | OK |
| R26 | `GenerarGuiaModal.test.tsx` — `it.each` de 3 estados no-ok con mensaje mapeado exacto (ver hallazgo menor 3 sobre el cuarto) | OK |
| R27 | `OrdenesListadoEtiquetasChain.test.tsx` — los 3 casos, modal REAL y padre REAL | OK **mutación D** |
| R28 | `OrdenesListadoBloqueoCierre.test.tsx` — `it.each` + *"en la MISMA zona bloqueada, la de en_preparacion se selecciona y la de en_bodega_central no"* (discriminador fuerte) | OK **mutación F** |
| R29 | `OrdenesRevisionMaestro.test.tsx` — `it.each` por apartado + *"se ofrece EXCLUSIVAMENTE desde el apartado de bodega central"* (cuenta 1 disparador en TODA la vista). Confirmado además por grep sobre `app/`: la única línea viva es `OrdenesRevisionMaestro.tsx:204` (bodega central); `OrdenesListado.accionesDe` nunca la ofreció | OK |
| R30 | `OrdenesListadoEtiquetasChain.test.tsx` — *"R30: con la carga de mensajeros CAÍDA, Generar guía sigue disponible y completa el encadenado"* (`listarMensajerosParaAsignacion` **rechaza**) + `OrdenesRevisionMaestro.test.tsx` R30 | OK |

**Ningún `R<n>` sin test. Regla 4 de CLAUDE.md satisfecha.**

---

## 5. Los cinco puntos calientes

### 5.1 Los tests de la 154 (#4/#6/#7c): movidos o borrados

**Movidos, no borrados ni relajados.** Verificado línea a línea en
`tests/unit/domain/order-status-transiciones.guardia.test.ts`:

- El `it.each` de la 154 se **partió en dos**: R18/R19 (#4, #6/#7c) migran al describe nuevo
  `156 — BAJAS EJECUTADAS` invertidos a `expect(...).toThrow(TransicionIlegalError)`; R20/R21
  (#1, #3/#7b) se quedan afirmando "SIGUE siendo legal" en
  `154 — BAJAS DIFERIDAS: R20/R21 se mudan a la feature 155`. **Correcto**: son de la 155.
- Los recuentos 45/41 -> 42/39 se actualizaron en los **tres** sitios (`R8`, `154/R27` y el
  nuevo *"el mapa retira EXACTAMENTE tres aristas"*).
- Se añadió *"en_fulfillment conserva sus cuatro aristas (declaradas y sin productor)"*: es la
  red que impide que la 156 se pase de frenada sobre el terreno de la 155. Bien.
- La **mutación E** (reintroducir #4) produce 5 fallos. El grafo está cerrado con llave.

Nada que reprochar aquí.

### 5.2 Los 7 tests de repositorio que rompieron

Contexto que la bitácora acierta y el `design.md` erraba: `orden-repository.guia.test.ts` y
`orden-historial-atomicidad.test.ts` usan dobles de `tx` que siembran el catálogo real, así
que **ejecutan la guardia de fallo cerrado de verdad**. Sus fixtures alimentaban pares
(origen, destino) a mano y tres de esos pares dejaron de existir. Tocarlos era inevitable:
`tasks.md` T A.3.6 ("sin haber modificado `orden-repository.guia.test.ts`") era una
instrucción imposible. **La discrepancia está bien declarada y bien resuelta.**

Juicio caso por caso:

- `generarGuiaLote` — `decision()` por defecto pasa a `{ en_bodega_central,
  mensajeroAsignadoId: null }`. Es exactamente lo que el service produce hoy. Correcto.
- **Feature 76/R23 (W1)** (`asignado_at` solo si hay mensajero) **se conserva íntegro**: solo
  se fijó el origen pre-leído a `en_bodega_central` para caer en el par #8. Sigue siendo el
  único sitio que ejercita el parámetro `mensajeroAsignadoId`, hoy muerto. **Sin pérdida.**
- *"R11: registra historial con destino real por orden y origen pre-leido"* **gana**
  discriminación de verdad: antes ambas filas tenían el mismo origen (`en_fulfillment`);
  ahora difieren en origen **y** destino (#8 y #5). Un repo que hardcodease cualquiera de los
  dos lados falla. Mejora real, no maquillaje.
- *"R13: registra historial por orden con origen pre-leido"* (ruteo satélite) **pierde**
  discriminación: sus dos filas comparten origen `en_bodega_central`.

**Mi juicio sobre el caso que perdió discriminación: sigue verificando algo real, NO consagra
un comportamiento trivial — pero la pérdida era evitable.** Leí
`OrdenRepository.rutearBodegaSateliteLote`: construye `origenById` con un `findMany` dentro de
la tx y hace `origenById.get(id) ?? null`. Con el fixture nuevo el test **todavía** falla si el
origen se hardcodea, si llega `null`, si se lee fuera de la tx o si se pierde el `origenTipo`.
Lo único que dejó de distinguir es "lee el de cada orden" de "lee el de la primera". Eso no es
un mock complaciente escondiendo una regresión: es un test que perdió un grado de libertad
porque el grafo dejó un solo origen legal para esa acción.

Dos matices:

1. **La pérdida era evitable sin apoyarse en #7b** (la arista que la 155 va a retirar, y por
   eso el implementador la descartó, con buen criterio): bastaba con que `tx.orden.findMany`
   devolviera **solo `o1`** y omitiera `o2`, ejercitando la rama `?? null`; un repo que usara
   `origenRows[0]` para todo el lote fallaría. Es un menor, no un bloqueante.
2. **Está mitigado**: el idiom es idéntico en `generarGuiaLote`, y ahí sí hay ahora un test
   con dos orígenes distintos. Un bug de "leo la primera fila" en ese patrón se caza en el
   otro método.

En `orden-historial-atomicidad.test.ts` los 2 casos solo cambian el `estatusId` destino: el
mecanismo bajo prueba (append fallido revierte el lote) es idéntico y las aserciones
(`rejects.toThrow("append boom")` / `"update boom"`) están intactas. **Sin pérdida.**

### 5.3 El contrato cliente/Server Action

**Encaja.** `GenerarGuiaModal.handleConfirm` llama
`generarGuia({ ordenIds: ordenes.map((o) => o.id) })` y `generarGuiaSchema` es
`z.object({ ordenIds: z.array(z.string().min(1)) })`. El `validation_error` garantizado que
dejó la fase A está cerrado.

El test **rompería** si alguien volviera al contrato viejo: lo comprobé (**mutación D**, 4
fallos). Y no es un test flojo: usa igualdad profunda, `Object.keys(input)` y una negativa
sobre el serializado.

**Matiz que hay que decir** (menor 2): la Server Action está tipada
`generarGuia(input: unknown, deps)`, así que **el compilador no protege esta frontera**; lo
único que la sostiene son R22 (cliente -> `{ordenIds}`) y el test de integración
(`{ordenIds}` -> service). La afirmación de la bitácora frontend de que "tsc protege" es
cierta **solo para las props del modal** (`GenerarGuiaModalProps`), no para el input de la
acción. Es un patrón preexistente de todo el repo, no una regresión de esta feature.

### 5.4 No-regresión de etiquetas (95) y manifiesto (148)

**Confirmado contra el código, no contra la afirmación.**

- `GenerarGuiaModal.tsx`: `handleOpenChange` está **idéntico** (difiere `onSuccess()` al cierre
  de la fase resultado), igual que `closeOnConfirm={false}`, `hideConfirm`, `cancelLabel`
  condicional y `ManifiestoResultado flujo="generacion_guia"` con
  `seleccion={{ ordenIds: resultado.ordenIds }}`.
- `OrdenesListado.tsx`: el diff **no contiene** `encadenarEtiquetas`, `cerrarModal`,
  `cerrarEtiquetas` ni `accionesDe`. `onSuccess={encadenarEtiquetas}` sigue enganchado.
- `ManifiestoFlujos.test.tsx`: sus 11 casos y todas sus aserciones intactas; solo se quitó la
  prop `mensajeros` y se corrigió `estado: "por_recoger"` -> `"en_bodega_central"` en dos
  fixtures (obligado: `por_recoger` ya no es producible por esta vía).
- `OrdenesListadoEtiquetasChain.test.tsx`: el flujo confirmar -> "Cerrar" -> `generarEtiquetas`
  no se relajó; se **reforzó** con `toHaveBeenCalledWith({ ordenIds: ["id-o1"] })`.
- La **mutación D** pone rojos 2 de los 3 casos del encadenado, así que el enganche está
  realmente cubierto, no solo declarado.

### 5.5 Casos de coordenadas retirados de GenerarGuiaModal.test.tsx

**La cobertura existe donde el implementador dice. Verificado.**

- `tests/unit/components/guia-decision-error-messages.test.ts` recorre
  `it.each(MOTIVOS_DIRECCION_NO_ENCONTRADA)` y `it.each(MOTIVOS_DIRECCION_EN_VALIDACION)`
  — **los 5 motivos**, incluidos `geocodificacion_agotada` y `geocodificacion_en_curso` —
  contra `guiaDecisionErrorMessage`, que es **exactamente** el mapper que consume este modal.
- `tests/components/AsignarBodegaModal.test.tsx` los ejercita end-to-end en un modal real
  (`direccion_no_geocodificable`, `geocodificacion_encolada`).

Y el argumento de fondo es correcto: tras R12 ese `conflict` **ya no puede llegar** por la vía
de generar guía, así que mantener el caso ahí habría sido una ficción. **Sin pérdida de
cobertura.**

---

## 6. Hallazgos

### BLOQUEANTES (de gate, no de código) — ninguno exige tocar `app/`, `lib/` ni `tests/`

1. **`specs/156-guia-sin-mensajero/tasks.md`: 0 de 27 tareas marcadas `[x]`.**
   `CHECKPOINTS.md` lo exige explícitamente para pasar a `done`, y la convención del repo es
   marcarlas: la 154 tiene 28 de 29 marcadas. La bitácora frontend alega que "el checklist del
   spec no lo edita el implementer", pero eso contradice lo que hizo la 154.
   **Qué falta:** marcar T0.1–T B.3.7 como hechas y dejar T C.2 explícitamente sin marcar con
   su motivo (blocker 2).
2. **T C.2 (repaso manual contra DB real) sin hacer, y estado del arnés desincronizado.**
   Nadie ha comprobado contra Postgres que dos órdenes en `en_preparacion` terminen con
   `num_guia`, en `en_bodega_central`, con `mensajero_asignado_id` NULL y con su entrada
   `generacion_guia` en el historial. Además `progress/current.md` sigue listando la 156 como
   `spec_ready` mientras `feature_list.json` dice `in_progress` (T C.3 sin hacer), y falta la
   entrada en `progress/history.md`.
   **Mi lectura del riesgo: BAJO, pero no cero.** `OrdenRepository` no se tocó; lo único nuevo
   en runtime es qué `estatusId` recibe y la legalidad de #5, que sí se ejercita contra el
   choke point real (`appendCambioEstado`) con catálogo sembrado. Y **corrí `next build` yo
   (exit 0)**, que era el otro hueco. **No lo convierto en bloqueante de código**, pero **no
   debe cerrarse como `done` sin ese repaso manual**, que además es barato: lo hace el mismo
   humano que va a montar el tren 154+155+156.

### menores

1. **`orden-repository.guia.test.ts` — "R13: registra historial por orden con origen pre-leido
   y tipo ruteo_satelite" perdió un grado de discriminación** (sección 5.2). Sigue mordiendo
   (origen hardcodeado, `null` o leído fuera de la tx lo rompen), pero ya no distingue "lee el
   de cada orden" de "lee el de la primera". **Recuperable en una línea** sin depender de #7b:
   que el `tx.orden.findMany` del fixture devuelva **solo `o1`**, lo que ejercita la rama
   `origenById.get(id) ?? null` y delata un `origenRows[0]`.
2. **La frontera cliente/Server Action no está protegida por el compilador**
   (`input: unknown` en `lib/actions/ordenes-guia.ts`). Solo la sostienen R22 y el test de
   integración, que sí muerden, pero la afirmación de la bitácora frontend de que `tsc`
   protege el contrato es imprecisa: protege las **props** del modal, no el input de la acción.
   Preexistente en todo el repo; no es regresión de la 156.
3. **`guia-decision-error-messages.ts` muestra un texto que ahora MIENTE** en "Generar guía":
   `validation_error: "Datos inválidos: revisa la selección de mensajero."`, cuando esa acción
   ya no tiene ninguna selección de mensajero.
   **Mi juicio: es aceptable NO haberlo tocado en esta feature, pero NO es aceptable dejarlo
   así hasta la 159.** Razones:
   - **Es alcanzable en producción**, no solo por zod: el service devuelve `validation_error`
     con `{ estatus: ["catalogo de estados incompleto (seed pendiente)"] }`. Un seed incompleto
     le dice al maestro que revise un control que no existe, y le oculta la causa real.
   - El implementador fue **honesto**: excluyó ese status del `it.each` de R26 en vez de clavar
     en un test una frase que sabe falsa, y lo declaró en su bitácora. Eso está bien. Pero el
     efecto neto es que **el único camino de error del modal sin test es precisamente el del
     texto falso**.
   - El argumento "el design pedía no tocar el archivo" **no cierra**: el arreglo barato no es
     partir el mapper, es **genericizar la frase** (p. ej. "Datos inválidos: revisa los datos e
     inténtalo de nuevo."). Un mensaje genérico sigue siendo **correcto** para
     `asignarDesdeBodega` y `AsignacionSateliteService`, que hoy la fijan en
     `AsignarBodegaModal.test.tsx:138` y `AsignarSateliteModal.test.tsx:137`. Coste: una línea
     de producción y dos aserciones.
   **Recomendación: cerrarlo antes de que el tren suba, o registrarlo como deuda explícita con
   dueño en `progress/current.md`.** No bloqueo por esto: es un texto genérico, en una ruta de
   error rara, sin impacto en datos ni en seguridad.
4. **`guia-asignacion-service.test.ts` — "dos invocaciones consecutivas devuelven guias
   distintas y crecientes"** no prueba el service: el `numGuia` lo produce el propio mock
   (`++seq`). Es un test que se prueba a sí mismo. No resta nada (R5 está cubierto de verdad en
   `orden-repository.guia.test.ts` a nivel de SQL), pero conviene no contarlo como cobertura de
   idempotencia.
5. **`en_fulfillment` sigue ofreciendo "Generar guía"** en `OrdenesListado.accionesDe` y en el
   apartado de `OrdenesRevisionMaestro`, y desde la fase A ese botón lleva a un `conflict`
   garantizado. Es **exactamente lo que manda el design** y lo resuelve la 155 con su backfill.
   Lo anoto porque **sella la decisión ya cerrada**: si la 156 se desplegara sin la 155, el
   maestro se come un callejón. **El tren 154+155+156 no es una preferencia: es una condición
   de correctitud de esta feature.**
6. **La bitácora está partida** en `impl_156_backend.md` + `impl_156_frontend.md` y T C.1 pedía
   `progress/impl_156.md`. Contenido completo; solo es una desviación de nombre. Ambas declaran
   sus discrepancias con el spec de forma honesta y **todas las que comprobé son ciertas**.

### Deudas declaradas que confirmo (ninguna bloquea por sí sola)

- Nadie abrió un navegador; cero verificación manual. **Confirmado.**
- Sin E2E (Playwright). **Confirmado** — y no lo exige `CHECKPOINTS.md` para este flujo, ni
  existía antes.
- Sin auditoría a11y ni revisión visual de la tabla de dos columnas en `max-w-2xl`.
  **Confirmado**; no es regresión (el `DataTable` tampoco paginaba antes dentro del modal).
- `OrdenesListadoDevolucion.test.tsx` y `OrdenesListadoBloqueoCierre.test.tsx` mockean
  `GenerarGuiaModal` a `() => null`. **Confirmado y preexistente**; su verde no es cobertura
  del modal, y está bien que lo diga.
- `pnpm build` no corrido -> **cerrado por mí**: `next build` exit 0.

---

## 7. Alcance (verificado)

- **La fase B no tocó backend:** el diff de la fase B no contiene `lib/`, `db/` ni `prisma/`.
- **`ordenes-columns.tsx` no se tocó** (la 160 trabaja sobre él en paralelo).
- **Sin migración en toda la feature:** cero archivos bajo `db/` o `prisma/` en el diff
  completo `154...HEAD`.
- **`AsignacionSateliteService.ts` y `OrdenRepository.ts` byte-idénticos.**
- **`git status --porcelain` vacío** antes y después de mis 7 mutaciones.

---

## 8. Qué falta para `done`

1. Marcar `tasks.md` (blocker 1).
2. Repaso manual T C.2 contra una DB real, o decisión humana explícita de asumirlo con el tren
   (blocker 2).
3. Sincronizar `progress/current.md` (156 sigue como `spec_ready`) y añadir la entrada a
   `progress/history.md`.
4. Decidir sobre el `validation_error` que miente (menor 3): arreglarlo o registrarlo como
   deuda con dueño.
5. Recordar que **esta rama sale de la 154**: si el merge de la 154 obliga a cambios, hay que
   rebasar antes de abrir el PR.

**Veredicto final: APROBADO-CON-NOTAS.** El código es correcto, el alcance es disciplinado,
las discrepancias con el spec están declaradas y son ciertas, y la trazabilidad R1–R30 resiste
mutación. No hay bloqueantes que devuelvan trabajo al implementer.
