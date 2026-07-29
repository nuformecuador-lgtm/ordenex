# Tasks — Feature 156 (Generar guía SIN asignar mensajero)

> Secuencia obligatoria: **FASE A (backend) → FASE B (frontend)**. `[P]` = paralelizable con
> las otras tareas marcadas `[P]` de la MISMA fase. Sin migración: ninguna tarea toca
> `db/`.
> Criterio global de cierre: `./init.sh` en verde + suite de tests en verde + cada `R<n>` de
> `requirements.md` mapeado a un test concreto en `progress/impl_156.md`.
>
> **Estado del checklist (2026-07-29, tras `progress/review_156.md`): 24 de 27 marcadas.**
> Sin marcar: **T A.3.6** (su criterio literal era imposible de cumplir), **T C.2** (nadie
> verificó contra Postgres real) y **T C.3** (es del leader). Cada una explica su porqué abajo.

## Fase 0 — Preparación

- [x] **T0.1** Verificar que las features **153** y **154** están aplicadas en la rama de
      trabajo.
      *Hecho cuando:* `lib/types/order-status.ts` incluye `por_recolectar_en_tienda` e
      `incidente`, `lib/types/order-status-transiciones.ts` ya NO declara aristas
      `en_preparacion|en_fulfillment → por_recoger|en_bodega_central|en_ruta_bodega_satelite`
      salvo `en_preparacion → en_bodega_central`, y `pnpm test` pasa ANTES de tocar nada.
      **Si esto no se cumple, la feature no arranca** (todo lo demás produciría
      `TransicionIlegalError`).
      **Hecho:** la rama sale de `feature/154-catalogo-estados-v2`; `order-status.ts` trae los
      dos `value` nuevos (líneas 63-64) y la suite partía verde (547 archivos / 5735 tests).

---

## Fase A — Backend

### A.1 Contrato

- [x] **T A.1.1** Cambiar el contrato de entrada de generar guía a lote de ids.
      Archivos: `lib/interfaces/services/IGuiaAsignacionService.ts` (`GenerarGuiaInput =
      { ordenIds: string[] }`, eliminar `GenerarGuiaDecision`, actualizar el docblock de
      `IGuiaAsignacionService.generarGuia`) y `lib/types/orden-guia.ts`
      (`generarGuiaSchema = z.object({ ordenIds: z.array(z.string().min(1)) })`).
      *Hecho cuando:* `pnpm exec tsc --noEmit` señala SOLO los call sites que las tareas
      siguientes van a corregir, y no queda ninguna referencia a `GenerarGuiaDecision`
      (`rg "GenerarGuiaDecision\b"` sin resultados fuera de `specs/` y `progress/`).
      *Depende de:* T0.1.
      **Hecho:** la única aparición viva de `GenerarGuiaDecision` es el comentario de
      `IGuiaAsignacionService.ts:8` que documenta su retiro (`GenerarGuiaDecisionData`, del
      repositorio, es otro tipo y no casa con `\b`).

### A.2 Servicio

- [x] **T A.2.1** Reescribir `GuiaAsignacionService.generarGuia` según §3.3 del design:
      autorización → guardas por orden (existe / borrada / reprogramada / origen
      `en_preparacion`) → `findEstatusIdByValue("en_bodega_central")` → `generarGuiaLote`
      con `mensajeroAsignadoId: null` → resultado con `estado: "en_bodega_central"`.
      Retirar del cuerpo: `centralZonaId`/`GAM_NO_CONFIGURADA`,
      `findMensajeroIdsValidosByZona`, `findMensajerosBloqueados`, `zonasSateliteBloqueadas`,
      `gateCoordenadas` y `estatusDestino`.
      *Hecho cuando:* `generarGuia` no menciona mensajero, zona ni satélite; los helpers
      privados `gateCoordenadas` y `zonasSateliteBloqueadas` siguen existiendo y siendo
      usados por los otros métodos; el constructor conserva sus 3 dependencias.
      *Depende de:* T A.1.1. · Cubre **R1, R2, R3, R4, R6, R7, R8, R9, R10, R11, R12, R13**.
      **Hecho:** verificado por el review con la mutación A (persistir un mensajero fantasma
      pone rojos 3 tests).

- [x] **T A.2.2** `ORIGEN_GENERAR_GUIA` → `"en_preparacion"` y `ORIGEN_RUTEO_SATELITE`
      (≈línea 35) → `"en_bodega_central"`; ajustar la comprobación de
      `rutearABodegaSatelite` a `!==`.
      *Hecho cuando:* no queda ningún `Set` de orígenes en el archivo y el motivo de rechazo
      sigue siendo literalmente `estado de origen no permitido: <value>`.
      *Depende de:* T A.2.1. · Cubre **R15, R16**.
      **Hecho:** ambas constantes son `string` (líneas 45 y 52); los `new Set` que quedan son
      de zonas/valores, no de orígenes.

- [x] **T A.2.3** Actualizar los comentarios de cabecera del servicio para que describan el
      flujo v2 (numerar ≠ asignar) y citen la feature 156.
      *Hecho cuando:* ningún comentario del archivo sigue afirmando que `generarGuia` asigna
      mensajero o rutea a satélite.
      *Depende de:* T A.2.2.
      **Hecho.**

- [x] **T A.2.4 [P]** Verificar por lectura que `asignarDesdeBodega` y
      `lib/services/AsignacionSateliteService.ts` quedaron **byte-idénticos**.
      *Hecho cuando:* `git diff` sobre `AsignacionSateliteService.ts` está vacío y el diff de
      `GuiaAsignacionService.ts` no toca el cuerpo de `asignarDesdeBodega`.
      *Depende de:* T A.2.1. · Cubre **R17, R18, R19** (parte estática).
      **Hecho:** confirmado por el review (§7: `AsignacionSateliteService.ts` y
      `OrdenRepository.ts` byte-idénticos).

### A.3 Tests de backend

- [x] **T A.3.1** Reescribir el bloque `generarGuia` de
      `tests/unit/services/guia-asignacion-service.test.ts`: casos nuevos
      "numera y mueve a `en_bodega_central`", "no escribe `mensajeroAsignadoId`",
      "origen `en_fulfillment` → conflict", "`num_guia` existente se conserva",
      "todo-o-nada", "reprogramada / borrada / inexistente", "forbidden".
      *Hecho cuando:* cada uno de R1-R9 tiene al menos un `it(...)` cuyo nombre describe el
      comportamiento, y ningún test de `generarGuia` menciona mensajero.
      *Depende de:* T A.2.1.
      **Hecho:** mapa R1–R9 → `it` en `progress/impl_156_backend.md` §5, reverificado uno por
      uno por el review (§4).

- [x] **T A.3.2 [P]** Tests de las guardas RETIRADAS, que ahora deben terminar en `ok`:
      mensajero con cierre abierto, zona satélite con cierre abierto, orden sin coordenadas
      utilizables, zona GAM no configurada.
      *Hecho cuando:* los cuatro casos afirman `status: "ok"` y que `generarGuiaLote` SÍ se
      llamó. *Depende de:* T A.2.1. · Cubre **R10, R11, R12, R13**.
      **Hecho.**

- [x] **T A.3.3 [P]** Tests del ruteo a satélite: `en_bodega_central` sigue funcionando;
      `en_preparacion` y `en_fulfillment` → `conflict` sin efectos.
      *Hecho cuando:* los tres casos pasan y `rutearBodegaSateliteLote` no se llama en los de
      conflicto. *Depende de:* T A.2.2. · Cubre **R15, R16**.
      **Hecho.**

- [x] **T A.3.4 [P]** Ajustar `tests/unit/services/guia-asignacion-gate-coordenadas.test.ts`:
      invertir/retirar los casos sobre `generarGuia` y CONSERVAR intactos los de
      `asignarDesdeBodega`.
      *Hecho cuando:* el archivo sigue teniendo cobertura del gate para
      `asignarDesdeBodega` y ningún caso exige el gate en `generarGuia`.
      *Depende de:* T A.2.1. · Cubre **R12, R19**.
      **Hecho:** el review lo confirmó con la mutación B (quitar el gate de
      `asignarDesdeBodega` pone rojos 7 tests).

- [x] **T A.3.5 [P]** Ajustar `tests/integration/actions/ordenes-guia-action.test.ts` al
      contrato `{ ordenIds }`, incluido el caso "entrada sin `ordenIds` → `validation_error`
      sin llamar al service".
      *Hecho cuando:* pasa y ningún test del archivo construye `decisiones`.
      *Depende de:* T A.1.1. · Cubre **R14**.
      **Hecho:** 4 casos, incluidos los dos que rechazan el contrato viejo.

- [ ] **T A.3.6** Correr la suite de backend completa.
      *Hecho cuando:* `pnpm test tests/unit tests/integration` en verde, incluidos los tests
      de `AsignacionSateliteService`, historial (`orden-historial-*`) y repositorios, **sin
      haber modificado** `orden-repository.guia.test.ts`.
      *Depende de:* T A.3.1-T A.3.5. · Cubre **R8, R17, R18**.
      **NO SE MARCA — el criterio literal era imposible.** La suite SÍ quedó verde
      (439 archivos / 4705 tests en la fase A; 547/5748 al cierre), pero
      `orden-repository.guia.test.ts` **hubo que modificarlo**: sus dobles de `tx` siembran el
      catálogo real, así que ejecutan de verdad la guardia de fallo cerrado de la 140, y tres
      de los pares (origen, destino) que sus fixtures alimentaban dejaron de existir al retirar
      #4/#6/#7c. Está declarado en `progress/impl_156_backend.md` §4/§7.2 y avalado por el
      review (§5.2). El fleco que el review dejó abierto sobre ese archivo (menor 1: el caso
      de `ruteo_satelite` perdió discriminación) se cerró después con un caso nuevo que
      ejercita la rama `origenById.get(id) ?? null`.

- [x] **T A.3.7** Commit de la fase: `feat(156): generar guia solo numera y mueve a bodega central`.
      *Hecho cuando:* el commit no incluye ningún archivo bajo `app/`.
      *Depende de:* T A.3.6.
      **Hecho:** commit `8a921a9`, 0 archivos bajo `app/`.

---

## Fase B — Frontend

> Toda esta fase depende de la Fase A completa (el contrato de la Server Action ya cambió).

### B.1 Modal

- [x] **T B.1.1** Reescribir `app/(app)/ordenes/_components/GenerarGuiaModal.tsx` como
      confirmación de lote (§4.1 del design): props sin `mensajeros` /
      `mensajerosBloqueadosIds`; una sola `DataTable` (`numRemision`, `destinatario`);
      `generarGuia({ ordenIds })`; toast con destino único; sin `Select`, sin
      `toMensajeroOptions`, sin `seleccionInicial`, sin `esGam`, sin `groupByZona`.
      *Hecho cuando:* el archivo no importa `Select` ni `mensajero-options`, no lee
      `mensajeroSugeridoId` ni `zonaEsGam`, y `tsc --noEmit` solo señala los dos padres.
      *Depende de:* Fase A. · Cubre **R20, R21, R22, R23, R30**.
      **Hecho:** los 8 imports del archivo no incluyen `Select` ni `mensajero-options`.

- [x] **T B.1.2** Conservar intacta la fase "resultado": `closeOnConfirm={false}`,
      `hideConfirm`, `ManifiestoResultado flujo="generacion_guia"` con los `ordenIds` del
      resultado, y `handleOpenChange` difiriendo `onSuccess()` al cierre.
      *Hecho cuando:* el diff de esas cuatro piezas es vacío salvo por el texto del mensaje.
      *Depende de:* T B.1.1. · Cubre **R24, R25**.
      **Hecho:** verificado línea a línea por el review (§5.4).

### B.2 Padres

- [x] **T B.2.1** `OrdenesListado.tsx`: `ESTADOS_ASIGNACION` = `{ en_bodega_central }` (con
      su comentario reescrito) y `<GenerarGuiaModal>` sin `mensajeros`. No tocar
      `encadenarEtiquetas`, `cerrarModal` ni `cerrarEtiquetas`.
      *Hecho cuando:* el `useSWR` de mensajeros sigue existiendo (lo usa
      `AsignarBodegaModal`) y el diff no toca las funciones de encadenado.
      *Depende de:* T B.1.1. · Cubre **R28, R30**.
      **Hecho:** el review confirmó que el diff no contiene `encadenarEtiquetas`,
      `cerrarModal`, `cerrarEtiquetas` ni `accionesDe`; mutación F en rojo (3 fallos).

- [x] **T B.2.2 [P]** `OrdenesRevisionMaestro.tsx` (legacy): quitar `mensajeros` /
      `mensajerosBloqueadosIds` del `<GenerarGuiaModal>` y retirar
      `secondaryActionLabel`/`onSecondaryAction` ("Rutear a bodega satélite") de los
      apartados `en_fulfillment` y `en_preparacion`, conservándolos en `en_bodega_central`.
      *Hecho cuando:* `rg "Rutear a bodega satélite" app/` solo aparece en el apartado de
      bodega central y en `RutearSateliteModal.tsx`.
      *Depende de:* T B.1.1. · Cubre **R29**.
      **Hecho:** única línea de código viva que ofrece la acción =
      `OrdenesRevisionMaestro.tsx:204` (apartado de bodega central); el resto son comentarios
      y el propio `RutearSateliteModal.tsx`.

### B.3 Tests de frontend

- [x] **T B.3.1** Reescribir `tests/components/GenerarGuiaModal.test.tsx`: sin selector de
      mensajero para ninguna orden, sin encabezados de agrupación, una sola llamada con
      `{ ordenIds }`, toast con el destino único, `conflict` → sin fase resultado, sin
      `onSuccess`, con mensaje mapeado.
      *Hecho cuando:* R20-R23 y R26 tienen su `it(...)` y el archivo no importa
      `MensajeroLiteDTO`. *Depende de:* T B.1.1.
      **Hecho:** cero apariciones de `MensajeroLiteDTO`. El `it.each` de R26 cubre hoy los
      **cuatro** resultados no-"ok" (se sumó `validation_error` al genericizar su mensaje;
      ver review, menor 3).

- [x] **T B.3.2 [P]** `tests/components/ManifiestoFlujos.test.tsx`: ajustar SOLO el render de
      `GenerarGuiaModal` (props) y las órdenes de fixture.
      *Hecho cuando:* pasa sin relajar ninguna aserción sobre `onSuccess` diferido, sobre
      `obtenerManifiesto({ flujo: "generacion_guia", ordenIds })` ni sobre el fallo de
      descarga. *Depende de:* T B.1.2. · Cubre **R24, R25**.
      **Hecho:** los 11 casos y sus aserciones intactos (review §5.4).

- [x] **T B.3.3 [P]** `tests/components/OrdenesListadoEtiquetasChain.test.tsx`: fixtures a
      `en_preparacion`; el flujo "confirmar → Cerrar → Imprimir etiquetas con el mismo lote"
      se mantiene idéntico.
      *Hecho cuando:* pasa con `generarEtiquetas` llamado con los mismos `ordenIds` del lote.
      *Depende de:* T B.2.1. · Cubre **R27**.
      **Hecho:** reforzado con `toHaveBeenCalledWith({ ordenIds: ["id-o1"] })`; mutación D en
      rojo (2 de los 3 casos del encadenado).

- [x] **T B.3.4 [P]** `tests/components/OrdenesListadoBloqueoCierre.test.tsx`: reencuadrar los
      casos de bloqueo sobre `en_bodega_central` y añadir "orden en `en_preparacion` cuya zona
      tiene un cierre abierto → checkbox habilitado y seleccionable".
      *Hecho cuando:* ambos casos pasan. *Depende de:* T B.2.1. · Cubre **R28**.
      **Hecho:** más el discriminador "misma zona bloqueada, dos estados, dos resultados".

- [x] **T B.3.5 [P]** `tests/components/OrdenesRevisionMaestro.test.tsx`: ajustar a las props
      nuevas y afirmar que los apartados `en_fulfillment`/`en_preparacion` NO ofrecen "Rutear
      a bodega satélite". *Hecho cuando:* pasa. *Depende de:* T B.2.2. · Cubre **R29**.
      **Hecho:** `it.each` por apartado + el caso que cuenta 1 solo disparador en TODA la vista.

- [x] **T B.3.6** Suite completa + build.
      *Hecho cuando:* `./init.sh` en verde, `pnpm test` en verde y `pnpm build`
      (type-check de `app/`, `lib/` y `scripts/`) sin errores.
      *Depende de:* T B.3.1-T B.3.5.
      **Hecho, con una salvedad:** `./init.sh` en verde y `pnpm test` en verde (547 archivos /
      5748 tests). `pnpm build` **completo no se puede correr aquí** (su paso
      `tsx scripts/migrate-deploy.ts` exige `DATABASE_URL` real y no hay `.env` en el
      worktree); el review corrió `npx next build` **exit 0** saltándose solo ese paso, que es
      justo lo que el criterio persigue (y esta feature no trae migración alguna).

- [x] **T B.3.7** Commit de la fase:
      `feat(156): el modal de guia deja de asignar mensajero`.
      *Hecho cuando:* el commit no toca `lib/services/`.
      *Depende de:* T B.3.6.
      **Hecho:** commit `00fb13b`, 0 archivos bajo `lib/`.

---

## Fase C — Cierre

- [x] **T C.1** Escribir `progress/impl_156.md` con el mapa `R1..R30 → test` (una fila por
      requisito, con archivo y nombre del `it`).
      *Hecho cuando:* no queda ningún requisito sin test; los requisitos de no-regresión
      (R17, R18, R19, R24, R25, R27) apuntan a tests **existentes que no se modificaron en su
      aserción**. *Depende de:* T B.3.6.
      **Hecho, con desviación de nombre:** la bitácora se entregó **partida en dos**,
      `progress/impl_156_backend.md` (R1–R19) + `progress/impl_156_frontend.md` (R20–R30), no
      como `impl_156.md`. El contenido cumple el criterio: el review verificó R1–R30 uno por
      uno (§4) y confirmó que los de no-regresión no relajaron aserciones.

- [ ] **T C.2** Repaso manual (dev) del camino feliz: seleccionar 2 órdenes en
      `en_preparacion` → "Generar guía" → confirmar → descargar manifiesto → cerrar →
      "Imprimir etiquetas" → desde `en_bodega_central` asignar mensajero.
      *Hecho cuando:* las dos órdenes tienen `num_guia`, quedan en `en_bodega_central` con
      `mensajero_asignado_id` NULL, y su historial muestra la entrada `generacion_guia`
      `en_preparacion → en_bodega_central`. *Depende de:* T B.3.6.
      **NO HECHO — DEUDA DECLARADA.** No hay `.env` ni Postgres en este worktree, así que
      **nadie ha comprobado nada contra una base real**: ni el `num_guia`, ni el estado, ni la
      entrada del historial. Todo lo verificado del camino feliz es a nivel de componente y de
      service con dobles (el choke point real sí corre, pero contra un `tx` fake con el
      catálogo sembrado en memoria). Misma deuda y mismo criterio que la T5.3 de la 154.
      **La feature no debe cerrarse como `done` sin este repaso**, que hace el humano que monte
      el tren 154+155+156.

- [ ] **T C.3** Actualizar `feature_list.json` (156 → estado que corresponda) y
      `progress/current.md`. *Hecho cuando:* `./init.sh` valida el estado sin advertencias.
      *Depende de:* T C.1, T C.2.
      **NO HECHO — es del leader.** `feature_list.json` y `progress/current.md` son propiedad
      del leader y ninguna fase de implementación los edita (misma regla que aplicó la 154 en
      su T5.6). Hoy están desincronizados: `current.md` lista la 156 como `spec_ready` y
      `feature_list.json` como `in_progress`; falta además la entrada en `progress/history.md`.
      Depende de T C.2, que sigue sin hacer.

## Notas de riesgo para el implementer

1. **No entregar la Fase A sin la Fase B.** El modal viejo enviando `decisiones` contra el
   zod nuevo produce `validation_error` en cada intento.
2. **No relajar los tests del manifiesto ni del encadenado de etiquetas.** Si uno de ellos
   se pone rojo, el bug está en el modal, no en el test.
3. **No tocar** `AsignacionSateliteService.ts`, `asignarDesdeBodega`, `OrdenRepository` ni
   `db/`. Si una tarea parece exigirlo, es señal de que se está desbordando el alcance:
   parar y consultar (ver preguntas abiertas de `requirements.md`).
