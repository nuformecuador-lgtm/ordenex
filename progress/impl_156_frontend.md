# impl_156 (FRONTEND) — Generar guía SIN asignar mensajero

> Rama: `feature/156-guia-sin-mensajero` (sale de `feature/154-catalogo-estados-v2`, **no** de `dev`)
> Worktree: `R:/job/singularis/projects/ordenex-wt-156` · Zona: `fullstack` · Fase: **B (frontend)**
> Spec: `specs/156-guia-sin-mensajero/` (R20–R30) · Base: commit `8a921a9` (fase A) · Fecha: 2026-07-29

---

## 1. Veredicto

**Fase B hecha y verde.** El runtime deja de estar roto: `GenerarGuiaModal` ya envía
`generarGuia({ ordenIds })` en vez de `{ decisiones }`, que era el `validation_error`
garantizado que dejó la fase A (su §8.2). El modal pasa de "editor de asignación" a
**confirmación de lote**: una sola tabla, cero selectores, un solo destino.

`./init.sh` termina en `== init OK ==` con **547 archivos / 5748 tests / 0 fallos**
(+11 sobre los 5737 de la fase A), lint **0 errores / 10 warnings** — los mismos 10
preexistentes que declararon la 154 y la fase A; **cero nuevos**.

**Cero archivos de backend tocados**: `lib/`, `db/` y `prisma/` no aparecen en el diff.
**`app/(app)/ordenes/_components/ordenes-columns.tsx` NO se tocó** (regla de terreno 1;
la 160 trabaja sobre él en paralelo). No necesité tocarlo: nada de R20–R30 pasa por las
columnas del listado. La columna "Mensajero sugerido" que vive ahí sigue en pie y es
alcance de la **159**, no de esta feature.

---

## 2. Qué se implementó

### 2.1 `GenerarGuiaModal.tsx` — confirmación de lote (T B.1.1 / T B.1.2)

| Antes | Después |
| --- | --- |
| Props `mensajeros` + `mensajerosBloqueadosIds` | **Retiradas** (R30). Props = `{ open, ordenes, onOpenChange, onSuccess }` |
| `Select` por fila + `toMensajeroOptions` + `seleccionInicial` + estado `seleccion` + `handleRowChange` | **Retirados** (R20) |
| `esGam` / `groupByZona` / `SATELITE_ZONA_DESCONOCIDA` / `SIN_MENSAJERO_LABEL` / dos juegos de columnas | **Retirados** (R21) |
| Dos bloques con `<h3>` ("Asignar mensajero" + una tabla por zona satélite) | **UNA** `DataTable` `ariaLabel="Órdenes por numerar"` con `numRemision` + `destinatario` |
| `generarGuia({ decisiones })` | `generarGuia({ ordenIds: ordenes.map(o => o.id) })` (R22) |
| Toast con tres destinos (espera / bodega / satélite) | `Guía generada para N orden(es): quedan en bodega central.` (R23) |
| Descripción: *"Confirma el mensajero por orden…"* | *"Se numerarán N orden(es) y pasarán a la bodega central. El mensajero se asigna después, desde la bodega."* (R21) |

**Lo que NO se tocó (verificado línea a línea en el diff):** `closeOnConfirm={false}`,
`hideConfirm`, `cancelLabel` condicional, `ManifiestoResultado flujo="generacion_guia"`
con `seleccion={{ ordenIds: resultado.ordenIds }}`, `handleOpenChange` (el que difiere
`onSuccess()` al cierre de la fase resultado) y `handleError`/`guiaDecisionErrorMessage`.
El `prevOpen`/reset al reabrir se conserva y ahora solo resetea `resultado`.

El import de `Select`, el de `toMensajeroOptions` y el de `MensajeroLiteDTO`
desaparecieron del archivo.

### 2.2 `OrdenesListado.tsx` (T B.2.1)

- `ESTADOS_ASIGNACION`: `{en_fulfillment, en_preparacion, en_bodega_central}` →
  `{en_bodega_central}` (R28), con el comentario reescrito explicando **por qué**
  (generar guía dejó de asignar, así que un cierre abierto en la zona no impide numerar).
- `<GenerarGuiaModal>` deja de recibir `mensajeros`.
- **Intactos:** el `useSWR` de mensajeros (lo sigue necesitando `AsignarBodegaModal`),
  `encadenarEtiquetas`, `cerrarModal`, `cerrarEtiquetas` y `accionesDe` (verificable en
  el diff: ninguna de esas cuatro funciones aparece).

### 2.3 `OrdenesRevisionMaestro.tsx` (T B.2.2, vista legacy)

- `<GenerarGuiaModal>` sin `mensajeros` / `mensajerosBloqueadosIds`.
- Apartados `en_fulfillment` y `en_preparacion`: retirados `secondaryActionLabel` /
  `onSecondaryAction` ("Rutear a bodega satélite") — R29. El apartado
  `en_bodega_central` los **conserva**.
- Docblock actualizado con el porqué (el ruteo parte de donde está el paquete).
- `mensajeros` / `mensajerosBloqueadosIds` siguen calculándose: los consume
  `AsignarBodegaModal`.

Comprobación de T B.2.2: `rg "Rutear a bodega satélite" app/` deja **una sola línea de
código viva** que ofrece la acción (`OrdenesRevisionMaestro.tsx:204`, el apartado
`en_bodega_central`); el resto de apariciones son comentarios y el propio
`RutearSateliteModal.tsx` (título y `confirmLabel`).

### 2.4 `mensajero-options.ts`

Solo comentario: dejó de afirmar que `GenerarGuiaModal` lo consume (ya no es cierto y
era una pista falsa para la 159). Cero cambios de comportamiento.

---

## 3. Mapa `R<n> → test` (frontend, R20–R30)

Cada fila cita archivo y nombre del `it`. Los de no-regresión (R24, R25, R27) apuntan a
tests **existentes cuyas aserciones no se relajaron**: solo se ajustaron fixtures/props.

| R | Test |
| --- | --- |
| **R20** | `tests/components/GenerarGuiaModal.test.tsx` › *"R20: lista cada orden por Nº de remisión y destinatario, y NO ofrece ningún control de mensajero"* (afirma remisión+destinatario de las 3 órdenes, ausencia de la columna "Mensajero", `queryAllByRole("combobox")` vacío y ausencia del selector por orden) · `tests/components/OrdenesRevisionMaestro.test.tsx` › *"R30: el modal 'Generar guía' no ofrece ningún selector de mensajero"* (mismo hecho sobre el modal REAL montado por su padre) |
| **R21** | `GenerarGuiaModal.test.tsx` › *"R21: no agrupa por mensajero sugerido ni por bodega satélite; el texto anuncia numeradas y en bodega central"* (una sola `table`; sin "Con/Sin mensajero sugerido", sin el `<h3>` "Asignar mensajero", sin ningún texto "bodega satélite"; y el texto del diálogo dice "Se numerarán 3 orden(es) y pasarán a la bodega central") |
| **R22** | `GenerarGuiaModal.test.tsx` › *"R22: confirmar hace UNA sola llamada con el lote COMPLETO y sin ningún dato de mensajero"* (`toHaveBeenCalledTimes(1)`, igualdad **profunda** con `{ordenIds:[...]}`, `Object.keys(input) === ["ordenIds"]` y el serializado sin `/mensajero\|decision/i`) y *"R22/R26: un lote vacío se confirma igual con `ordenIds: []`"* · `OrdenesListadoEtiquetasChain.test.tsx` › *"tras el éxito de 'Generar guía' abre el modal de etiquetas con el MISMO lote (re-derivado por id)"* (ahora afirma también `toHaveBeenCalledWith({ ordenIds: ["id-o1"] })` desde el padre real) |
| **R23** | `GenerarGuiaModal.test.tsx` › *"R23: el aviso de éxito informa la cantidad y el destino ÚNICO (bodega central)"* (texto exacto + el mensaje NO casa `/espera de aceptación/i` ni `/satélite/i`) |
| **R24** | `GenerarGuiaModal.test.tsx` › *"R24: tras el éxito pasa a la fase resultado con el manifiesto del lote DEL RESULTADO y difiere onSuccess al cierre"* (el mock devuelve los ids en **otro orden** que las props, y `obtenerManifiesto` se pide con el orden del RESULTADO: discrimina "usa el resultado" de "usa las props"; además `onSuccess` no se llama ni al confirmar ni al descargar, sí al cerrar) · `ManifiestoFlujos.test.tsx` › *"R19: tras generar guía ofrece el manifiesto de las órdenes del lote"* (**sin relajar**) |
| **R25** | `GenerarGuiaModal.test.tsx` › *"R25: si la descarga del manifiesto falla, la generación sigue cometida y la fase resultado se cierra con normalidad"* · `ManifiestoFlujos.test.tsx` › *"R25: un fallo de la descarga NO re-ejecuta la acción de negocio ni revierte su resultado"* (**aserciones intactas**; solo cambió el `estado` del fixture a `en_bodega_central` y se quitó la prop `mensajeros`) |
| **R26** | `GenerarGuiaModal.test.tsx` › `it.each` *"R26: $nombre deja el modal en edición, sin fase resultado ni onSuccess, con el mensaje mapeado"* — 3 casos (`conflict`, `forbidden`, `unauthenticated`): mensaje mapeado exacto, sin `onSuccess`, sin toast de éxito, diálogo aún montado, tabla de edición presente, botón "Generar guía" presente y **sin** botón de manifiesto |
| **R27** | `OrdenesListadoEtiquetasChain.test.tsx` › *"tras el éxito de 'Generar guía' abre el modal de etiquetas con el MISMO lote (re-derivado por id)"*, *"cerrar el modal de etiquetas termina el flujo (no re-encadena)"* y *"R30: con la carga de mensajeros CAÍDA…"* — los tres recorren confirmar → "Cerrar" → `generarEtiquetas({ ordenIds })`. **Ninguna aserción del encadenado se modificó**; solo los fixtures pasaron de `en_fulfillment` a `en_preparacion` |
| **R28** | `OrdenesListadoBloqueoCierre.test.tsx` › `it.each` *"R28: orden en %s cuya zona tiene un cierre abierto -> checkbox HABILITADO y seleccionable (generar guia ya no asigna)"* (`en_preparacion`, `en_fulfillment`) y *"R28: en la MISMA zona bloqueada, la orden de en_preparacion se selecciona y la de en_bodega_central no"* (el discriminador fuerte: misma zona, distinto estado, distinto resultado). Los 4 casos previos de bloqueo se **reencuadraron** sobre `en_bodega_central`, así que la regla sobreviviente sigue cubierta |
| **R29** | `OrdenesRevisionMaestro.test.tsx` › `it.each` *"R29: el apartado %s (%s) NO ofrece 'Rutear a bodega satélite'"* (`En fulfillment`, `En preparación`; y afirma que "Generar guía" SÍ sigue ahí), *"R29: 'Rutear a bodega satélite' se ofrece EXCLUSIVAMENTE desde el apartado de bodega central"* (cuenta los disparadores de TODA la vista: exactamente 1, dentro de "En bodega") y *"R13/R29: 'Rutear a bodega satélite' desde en_bodega_central invoca la action con los ordenIds NO-GAM seleccionados"* (el caso de la feature 30, movido de apartado, con su aserción intacta) |
| **R30** | `OrdenesListadoEtiquetasChain.test.tsx` › *"R30: con la carga de mensajeros CAÍDA, 'Generar guía' sigue disponible y completa el encadenado"* (`listarMensajerosParaAsignacion` **rechaza**; el flujo entero sigue funcionando) · `OrdenesRevisionMaestro.test.tsx` › *"R30: el modal 'Generar guía' no ofrece ningún selector de mensajero"* · + `tsc --noEmit`: `GenerarGuiaModalProps` ya no admite `mensajeros`, así que un padre que se la pase no compila |

---

## 4. Prueba de que los tests muerden (regla 4 del repo)

Los tests del modal mockean la Server Action, así que "verde" no prueba nada por sí solo.
Corrí **tres mutaciones** sobre producción y verifiqué que la suite se pone roja; después
revertí cada una (`git status` final = solo los 9 archivos de esta fase).

| Mutación | Rojo esperado | Resultado real |
| --- | --- | --- |
| El modal vuelve a enviar `{ decisiones: [{ordenId, mensajeroId: null}] }` | R22 y el encadenado | **4 fallos**: `R22: confirmar hace UNA sola llamada…`, `R22/R26: un lote vacío…`, `tras el éxito de 'Generar guía' abre el modal de etiquetas…`, `R30: con la carga de mensajeros CAÍDA…` |
| `ESTADOS_ASIGNACION` vuelve a los 3 estados | R28 | **3 fallos**: los dos del `it.each` (`en_preparacion`, `en_fulfillment`) y el de la misma zona con dos estados |
| Se reintroduce `secondaryActionLabel` en el apartado `en_preparacion` | R29 | **2 fallos**: `R29: el apartado En preparación…` y `R29: … EXCLUSIVAMENTE desde el apartado de bodega central` |

Es decir: el contrato nuevo, el desbloqueo del checkbox y el retiro de la acción de ruteo
tienen cada uno un test que **fallaría** si se revirtieran.

---

## 5. El encadenado a etiquetas (95) y el manifiesto (148): qué sobrevivió

Era el riesgo silencioso del enunciado. Ambos cuelgan de la MISMA pieza:
`handleOpenChange` del modal, que difiere `onSuccess()` hasta que se cierra la fase
"resultado"; el padre engancha ahí `encadenarEtiquetas`.

- **Feature 95 (etiquetas):** intacta. `OrdenesListadoEtiquetasChain.test.tsx` sigue
  recorriendo confirmar → "Cerrar" → `generarEtiquetas({ ordenIds: ["id-o1"] })` con el
  modal REAL y el padre REAL. Único cambio del archivo: los fixtures pasaron a
  `en_preparacion` (que es el estado que ahora ofrece "Generar guía" de verdad) y se
  reforzó con el input exacto de `generarGuia`. Las funciones `encadenarEtiquetas`,
  `cerrarModal` y `cerrarEtiquetas` de `OrdenesListado.tsx` **no aparecen en el diff**.
- **Feature 148 (manifiesto):** intacta. `ManifiestoFlujos.test.tsx` conserva sus 11
  casos y sus aserciones; se le quitó la prop `mensajeros` de los dos renders de
  `GenerarGuiaModal` y se corrigieron los `estado` de fixture (`por_recoger` →
  `en_bodega_central`), porque `por_recoger` ya no es un destino producible por esta vía.
  Además añadí en `GenerarGuiaModal.test.tsx` un caso que **discrimina** algo que antes
  nadie fijaba: el manifiesto se pide con los ids del RESULTADO, no con los de las props.

---

## 6. Discrepancias entre el spec y la realidad

1. **`design.md` §7 dice que los casos de coordenadas de `GenerarGuiaModal.test.tsx`
   "se mueven al modal de asignación desde bodega o se retiran".** Los **retiré**: ya
   estaban cubiertos en otro lado, así que moverlos habría sido duplicar.
   `AsignarBodegaModal.test.tsx` cubre `direccion_no_geocodificable` y
   `geocodificacion_encolada` a través del mapper, y
   `tests/unit/components/guia-decision-error-messages.test.ts` cubre **todos** los
   motivos (incluidos `geocodificacion_agotada` y `geocodificacion_en_curso`, que eran
   los dos que solo vivían en el archivo del modal). Cobertura del mapper: sin pérdida.
   Ejercitarlos desde `generarGuia` habría sido, además, una ficción: la fase A retiró
   el gate de coordenadas de esa vía (R12), así que ese `conflict` ya no puede llegar
   por ahí.
2. **`design.md` §4.1 propone el toast como `Guía generada para N orden(es): quedan en
   bodega central.`** Lo implementé literal. **Es la pregunta abierta 4 de
   `requirements.md` y sigue sin respuesta del humano**: si operación prefiere otro
   texto, cambia una línea del modal y una aserción de R23.
3. **`tasks.md` no quedó marcado.** La fase A tampoco marcó sus `T A.*`; mantengo la
   convención (el checklist del spec no lo edita el implementer). `T B.1.1`–`T B.3.6`
   están todas hechas; `T B.3.6` **parcialmente** (ver §7.2).
4. **`en_fulfillment` sigue ofreciendo "Generar guía"** en las dos superficies
   (`OrdenesListado.accionesDe` y el apartado de `OrdenesRevisionMaestro`). Es lo que
   manda `design.md` §4.2/3 ("se deja como está; lo resuelve la 155"), pero conviene
   decirlo sin eufemismos: **desde la fase A ese botón lleva a un `conflict`
   garantizado** ("estado de origen no permitido: en_fulfillment"). Es la ventana de la
   pregunta abierta 1, asumida como TREN 154+155+156. Si la 156 se desplegara sola, el
   maestro vería ese callejón.
5. **`guia-decision-error-messages.ts` no se tocó** (lo pide el design §3.1), pero su
   `validation_error` sigue diciendo *"Datos inválidos: revisa la selección de
   mensajero."* — texto que en "Generar guía" ya no significa nada (no hay selección que
   revisar). Sigue siendo correcto para `asignarDesdeBodega`, que comparte el mapper. Lo
   dejé y **excluí ese status del `it.each` de R26** para no clavar en un test una frase
   que sé que miente. Deuda para la 159 (o para quien parta el mapper en dos).
6. **Pregunta abierta 5 (columnas "responsable"/"destino" del manifiesto)** sigue
   abierta y es de backend/manifiesto: no la toqué. Hoy todas las filas del flujo
   `generacion_guia` salen con el mismo destino y sin mensajero; si "responsable" queda
   vacío, es visible para el usuario y nadie lo ha decidido.
7. **Pregunta abierta 3 (vista legacy `OrdenesRevisionMaestro`)**: la ajusté al mínimo,
   como asume el spec. Sigue sin montarla ninguna página; solo su test la renderiza.

---

## 7. Lo que NO verifiqué — deuda declarada

1. **No abrí la aplicación en un navegador. Cero verificación manual.** No hay `.env` ni
   Postgres en este worktree (`./init.sh` avisa `! no hay .env`; es `warn`, no `fail`).
   Por tanto **T C.2 del `tasks.md` sigue SIN hacer**: nadie ha comprobado contra una DB
   real que 2 órdenes en `en_preparacion` terminen con `num_guia`, en `en_bodega_central`
   y con `mensajero_asignado_id` NULL, ni que su historial muestre la entrada
   `generacion_guia`. Todo lo que afirmo del camino feliz es a nivel de componente con la
   Server Action mockeada.
2. **`pnpm build` NO corrido.** El script es
   `prisma generate && tsx scripts/migrate-deploy.ts && next build`: el paso de
   migraciones exige `DATABASE_URL` real. Lo más cercano que sí corrí es
   `tsc --noEmit`, cuyo `include` es `**/*.ts(x)` y por tanto abarca `app/`, `lib/` y
   `scripts/`. Queda sin verificar lo que solo detecta `next build` (límites de
   client/server components, resolución de rutas). **T B.3.6 queda parcial por esto.**
3. **E2E (Playwright) no corrido.** El flujo crítico de esta feature pasa por el modal y
   no tiene cobertura E2E ni antes ni ahora.
4. **Accesibilidad:** me apoyé en los nombres accesibles (`role="table"` con `ariaLabel`,
   `role="dialog"`, `role="status"` del `ManifiestoResultado`) que ya traían `Modal` y
   `DataTable`. No corrí ninguna auditoría a11y (axe u otra) ni probé con lector de
   pantalla o navegación solo-teclado.
5. **Aspecto visual:** la tabla de dos columnas dentro de un modal `max-w-2xl` no la vio
   nadie renderizada. Con lotes grandes el `DataTable` no pagina dentro del modal (el
   scroll lo pone `Modal`); antes tampoco lo hacía, así que no es regresión, pero no está
   comprobado.
6. **`OrdenesListadoDevolucion.test.tsx` y `OrdenesListadoBloqueoCierre.test.tsx` mockean
   `GenerarGuiaModal` a `() => null`**, así que no ejercitan el modal real. Es
   preexistente y deliberado (evitan arrastrar PDF/QR a jsdom); lo digo para que nadie
   lea su verde como cobertura del modal.
7. **No verifiqué la 160.** No toqué `ordenes-columns.tsx`, pero tampoco sé qué está
   haciendo esa rama; si termina cambiando el `aria-label` de los checkboxes del listado,
   los tests de R28 lo notarán al mergear.

---

## 8. Archivos modificados (9, ninguno de backend)

**Producción (4):**
`app/(app)/ordenes/_components/GenerarGuiaModal.tsx` (reescrito),
`app/(app)/ordenes/_components/OrdenesListado.tsx`,
`app/(app)/ordenes/_components/OrdenesRevisionMaestro.tsx`,
`app/(app)/ordenes/_components/mensajero-options.ts` (solo comentario).

**Tests (5):**
`tests/components/GenerarGuiaModal.test.tsx` (reescrito),
`tests/components/ManifiestoFlujos.test.tsx`,
`tests/components/OrdenesListadoBloqueoCierre.test.tsx`,
`tests/components/OrdenesListadoEtiquetasChain.test.tsx`,
`tests/components/OrdenesRevisionMaestro.test.tsx`.

**Creados (1):** esta bitácora.
**Sin tocar y verificado:** `app/(app)/ordenes/_components/ordenes-columns.tsx`, todo
`lib/`, `db/`, `prisma/`, `AsignarBodegaModal.tsx`, `RutearSateliteModal.tsx`,
`EtiquetasGuiaModal.tsx`, `components/shared/`.

---

## 9. Salida real de la verificación

```
$ pnpm run typecheck
> tsc --noEmit
(sin salida: 0 errores)

$ pnpm run lint
✖ 10 problems (0 errors, 10 warnings)
  (los MISMOS 10 preexistentes de la 154 / fase A: react-hooks/exhaustive-deps y
   @typescript-eslint/no-unused-vars en archivos que esta fase no toca. Cero nuevos.)

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

 Test Files  547 passed (547)
      Tests  5748 passed (5748)
   Duration  153.56s

$ git status --porcelain     # sin basura sin trackear (los guards recorren fs.readdir)
(9 archivos modificados + esta bitacora, 0 untracked)
```

Partida (fase A): 547 archivos / 5737 tests. Final: **547 / 5748** (+11 netos; se
retiraron 3 casos del modal viejo —los de coordenadas y el de NO-GAM— y se añadieron 14
entre el modal v2, R28, R29 y R30).
