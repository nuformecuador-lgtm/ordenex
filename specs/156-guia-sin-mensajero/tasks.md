# Tasks — Feature 156 (Generar guía SIN asignar mensajero)

> Secuencia obligatoria: **FASE A (backend) → FASE B (frontend)**. `[P]` = paralelizable con
> las otras tareas marcadas `[P]` de la MISMA fase. Sin migración: ninguna tarea toca
> `db/`.
> Criterio global de cierre: `./init.sh` en verde + suite de tests en verde + cada `R<n>` de
> `requirements.md` mapeado a un test concreto en `progress/impl_156.md`.

## Fase 0 — Preparación

- [ ] **T0.1** Verificar que las features **153** y **154** están aplicadas en la rama de
      trabajo.
      *Hecho cuando:* `lib/types/order-status.ts` incluye `por_recolectar_en_tienda` e
      `incidente`, `lib/types/order-status-transiciones.ts` ya NO declara aristas
      `en_preparacion|en_fulfillment → por_recoger|en_bodega_central|en_ruta_bodega_satelite`
      salvo `en_preparacion → en_bodega_central`, y `pnpm test` pasa ANTES de tocar nada.
      **Si esto no se cumple, la feature no arranca** (todo lo demás produciría
      `TransicionIlegalError`).

---

## Fase A — Backend

### A.1 Contrato

- [ ] **T A.1.1** Cambiar el contrato de entrada de generar guía a lote de ids.
      Archivos: `lib/interfaces/services/IGuiaAsignacionService.ts` (`GenerarGuiaInput =
      { ordenIds: string[] }`, eliminar `GenerarGuiaDecision`, actualizar el docblock de
      `IGuiaAsignacionService.generarGuia`) y `lib/types/orden-guia.ts`
      (`generarGuiaSchema = z.object({ ordenIds: z.array(z.string().min(1)) })`).
      *Hecho cuando:* `pnpm exec tsc --noEmit` señala SOLO los call sites que las tareas
      siguientes van a corregir, y no queda ninguna referencia a `GenerarGuiaDecision`
      (`rg "GenerarGuiaDecision\b"` sin resultados fuera de `specs/` y `progress/`).
      *Depende de:* T0.1.

### A.2 Servicio

- [ ] **T A.2.1** Reescribir `GuiaAsignacionService.generarGuia` según §3.3 del design:
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

- [ ] **T A.2.2** `ORIGEN_GENERAR_GUIA` → `"en_preparacion"` y `ORIGEN_RUTEO_SATELITE`
      (≈línea 35) → `"en_bodega_central"`; ajustar la comprobación de
      `rutearABodegaSatelite` a `!==`.
      *Hecho cuando:* no queda ningún `Set` de orígenes en el archivo y el motivo de rechazo
      sigue siendo literalmente `estado de origen no permitido: <value>`.
      *Depende de:* T A.2.1. · Cubre **R15, R16**.

- [ ] **T A.2.3** Actualizar los comentarios de cabecera del servicio para que describan el
      flujo v2 (numerar ≠ asignar) y citen la feature 156.
      *Hecho cuando:* ningún comentario del archivo sigue afirmando que `generarGuia` asigna
      mensajero o rutea a satélite.
      *Depende de:* T A.2.2.

- [ ] **T A.2.4 [P]** Verificar por lectura que `asignarDesdeBodega` y
      `lib/services/AsignacionSateliteService.ts` quedaron **byte-idénticos**.
      *Hecho cuando:* `git diff` sobre `AsignacionSateliteService.ts` está vacío y el diff de
      `GuiaAsignacionService.ts` no toca el cuerpo de `asignarDesdeBodega`.
      *Depende de:* T A.2.1. · Cubre **R17, R18, R19** (parte estática).

### A.3 Tests de backend

- [ ] **T A.3.1** Reescribir el bloque `generarGuia` de
      `tests/unit/services/guia-asignacion-service.test.ts`: casos nuevos
      "numera y mueve a `en_bodega_central`", "no escribe `mensajeroAsignadoId`",
      "origen `en_fulfillment` → conflict", "`num_guia` existente se conserva",
      "todo-o-nada", "reprogramada / borrada / inexistente", "forbidden".
      *Hecho cuando:* cada uno de R1-R9 tiene al menos un `it(...)` cuyo nombre describe el
      comportamiento, y ningún test de `generarGuia` menciona mensajero.
      *Depende de:* T A.2.1.

- [ ] **T A.3.2 [P]** Tests de las guardas RETIRADAS, que ahora deben terminar en `ok`:
      mensajero con cierre abierto, zona satélite con cierre abierto, orden sin coordenadas
      utilizables, zona GAM no configurada.
      *Hecho cuando:* los cuatro casos afirman `status: "ok"` y que `generarGuiaLote` SÍ se
      llamó. *Depende de:* T A.2.1. · Cubre **R10, R11, R12, R13**.

- [ ] **T A.3.3 [P]** Tests del ruteo a satélite: `en_bodega_central` sigue funcionando;
      `en_preparacion` y `en_fulfillment` → `conflict` sin efectos.
      *Hecho cuando:* los tres casos pasan y `rutearBodegaSateliteLote` no se llama en los de
      conflicto. *Depende de:* T A.2.2. · Cubre **R15, R16**.

- [ ] **T A.3.4 [P]** Ajustar `tests/unit/services/guia-asignacion-gate-coordenadas.test.ts`:
      invertir/retirar los casos sobre `generarGuia` y CONSERVAR intactos los de
      `asignarDesdeBodega`.
      *Hecho cuando:* el archivo sigue teniendo cobertura del gate para
      `asignarDesdeBodega` y ningún caso exige el gate en `generarGuia`.
      *Depende de:* T A.2.1. · Cubre **R12, R19**.

- [ ] **T A.3.5 [P]** Ajustar `tests/integration/actions/ordenes-guia-action.test.ts` al
      contrato `{ ordenIds }`, incluido el caso "entrada sin `ordenIds` → `validation_error`
      sin llamar al service".
      *Hecho cuando:* pasa y ningún test del archivo construye `decisiones`.
      *Depende de:* T A.1.1. · Cubre **R14**.

- [ ] **T A.3.6** Correr la suite de backend completa.
      *Hecho cuando:* `pnpm test tests/unit tests/integration` en verde, incluidos los tests
      de `AsignacionSateliteService`, historial (`orden-historial-*`) y repositorios, **sin
      haber modificado** `orden-repository.guia.test.ts`.
      *Depende de:* T A.3.1-T A.3.5. · Cubre **R8, R17, R18**.

- [ ] **T A.3.7** Commit de la fase: `feat(156): generar guia solo numera y mueve a bodega central`.
      *Hecho cuando:* el commit no incluye ningún archivo bajo `app/`.
      *Depende de:* T A.3.6.

---

## Fase B — Frontend

> Toda esta fase depende de la Fase A completa (el contrato de la Server Action ya cambió).

### B.1 Modal

- [ ] **T B.1.1** Reescribir `app/(app)/ordenes/_components/GenerarGuiaModal.tsx` como
      confirmación de lote (§4.1 del design): props sin `mensajeros` /
      `mensajerosBloqueadosIds`; una sola `DataTable` (`numRemision`, `destinatario`);
      `generarGuia({ ordenIds })`; toast con destino único; sin `Select`, sin
      `toMensajeroOptions`, sin `seleccionInicial`, sin `esGam`, sin `groupByZona`.
      *Hecho cuando:* el archivo no importa `Select` ni `mensajero-options`, no lee
      `mensajeroSugeridoId` ni `zonaEsGam`, y `tsc --noEmit` solo señala los dos padres.
      *Depende de:* Fase A. · Cubre **R20, R21, R22, R23, R30**.

- [ ] **T B.1.2** Conservar intacta la fase "resultado": `closeOnConfirm={false}`,
      `hideConfirm`, `ManifiestoResultado flujo="generacion_guia"` con los `ordenIds` del
      resultado, y `handleOpenChange` difiriendo `onSuccess()` al cierre.
      *Hecho cuando:* el diff de esas cuatro piezas es vacío salvo por el texto del mensaje.
      *Depende de:* T B.1.1. · Cubre **R24, R25**.

### B.2 Padres

- [ ] **T B.2.1** `OrdenesListado.tsx`: `ESTADOS_ASIGNACION` = `{ en_bodega_central }` (con
      su comentario reescrito) y `<GenerarGuiaModal>` sin `mensajeros`. No tocar
      `encadenarEtiquetas`, `cerrarModal` ni `cerrarEtiquetas`.
      *Hecho cuando:* el `useSWR` de mensajeros sigue existiendo (lo usa
      `AsignarBodegaModal`) y el diff no toca las funciones de encadenado.
      *Depende de:* T B.1.1. · Cubre **R28, R30**.

- [ ] **T B.2.2 [P]** `OrdenesRevisionMaestro.tsx` (legacy): quitar `mensajeros` /
      `mensajerosBloqueadosIds` del `<GenerarGuiaModal>` y retirar
      `secondaryActionLabel`/`onSecondaryAction` ("Rutear a bodega satélite") de los
      apartados `en_fulfillment` y `en_preparacion`, conservándolos en `en_bodega_central`.
      *Hecho cuando:* `rg "Rutear a bodega satélite" app/` solo aparece en el apartado de
      bodega central y en `RutearSateliteModal.tsx`.
      *Depende de:* T B.1.1. · Cubre **R29**.

### B.3 Tests de frontend

- [ ] **T B.3.1** Reescribir `tests/components/GenerarGuiaModal.test.tsx`: sin selector de
      mensajero para ninguna orden, sin encabezados de agrupación, una sola llamada con
      `{ ordenIds }`, toast con el destino único, `conflict` → sin fase resultado, sin
      `onSuccess`, con mensaje mapeado.
      *Hecho cuando:* R20-R23 y R26 tienen su `it(...)` y el archivo no importa
      `MensajeroLiteDTO`. *Depende de:* T B.1.1.

- [ ] **T B.3.2 [P]** `tests/components/ManifiestoFlujos.test.tsx`: ajustar SOLO el render de
      `GenerarGuiaModal` (props) y las órdenes de fixture.
      *Hecho cuando:* pasa sin relajar ninguna aserción sobre `onSuccess` diferido, sobre
      `obtenerManifiesto({ flujo: "generacion_guia", ordenIds })` ni sobre el fallo de
      descarga. *Depende de:* T B.1.2. · Cubre **R24, R25**.

- [ ] **T B.3.3 [P]** `tests/components/OrdenesListadoEtiquetasChain.test.tsx`: fixtures a
      `en_preparacion`; el flujo "confirmar → Cerrar → Imprimir etiquetas con el mismo lote"
      se mantiene idéntico.
      *Hecho cuando:* pasa con `generarEtiquetas` llamado con los mismos `ordenIds` del lote.
      *Depende de:* T B.2.1. · Cubre **R27**.

- [ ] **T B.3.4 [P]** `tests/components/OrdenesListadoBloqueoCierre.test.tsx`: reencuadrar los
      casos de bloqueo sobre `en_bodega_central` y añadir "orden en `en_preparacion` cuya zona
      tiene un cierre abierto → checkbox habilitado y seleccionable".
      *Hecho cuando:* ambos casos pasan. *Depende de:* T B.2.1. · Cubre **R28**.

- [ ] **T B.3.5 [P]** `tests/components/OrdenesRevisionMaestro.test.tsx`: ajustar a las props
      nuevas y afirmar que los apartados `en_fulfillment`/`en_preparacion` NO ofrecen "Rutear
      a bodega satélite". *Hecho cuando:* pasa. *Depende de:* T B.2.2. · Cubre **R29**.

- [ ] **T B.3.6** Suite completa + build.
      *Hecho cuando:* `./init.sh` en verde, `pnpm test` en verde y `pnpm build`
      (type-check de `app/`, `lib/` y `scripts/`) sin errores.
      *Depende de:* T B.3.1-T B.3.5.

- [ ] **T B.3.7** Commit de la fase:
      `feat(156): el modal de guia deja de asignar mensajero`.
      *Hecho cuando:* el commit no toca `lib/services/`.
      *Depende de:* T B.3.6.

---

## Fase C — Cierre

- [ ] **T C.1** Escribir `progress/impl_156.md` con el mapa `R1..R30 → test` (una fila por
      requisito, con archivo y nombre del `it`).
      *Hecho cuando:* no queda ningún requisito sin test; los requisitos de no-regresión
      (R17, R18, R19, R24, R25, R27) apuntan a tests **existentes que no se modificaron en su
      aserción**. *Depende de:* T B.3.6.

- [ ] **T C.2** Repaso manual (dev) del camino feliz: seleccionar 2 órdenes en
      `en_preparacion` → "Generar guía" → confirmar → descargar manifiesto → cerrar →
      "Imprimir etiquetas" → desde `en_bodega_central` asignar mensajero.
      *Hecho cuando:* las dos órdenes tienen `num_guia`, quedan en `en_bodega_central` con
      `mensajero_asignado_id` NULL, y su historial muestra la entrada `generacion_guia`
      `en_preparacion → en_bodega_central`. *Depende de:* T B.3.6.

- [ ] **T C.3** Actualizar `feature_list.json` (156 → estado que corresponda) y
      `progress/current.md`. *Hecho cuando:* `./init.sh` valida el estado sin advertencias.
      *Depende de:* T C.1, T C.2.

## Notas de riesgo para el implementer

1. **No entregar la Fase A sin la Fase B.** El modal viejo enviando `decisiones` contra el
   zod nuevo produce `validation_error` en cada intento.
2. **No relajar los tests del manifiesto ni del encadenado de etiquetas.** Si uno de ellos
   se pone rojo, el bug está en el modal, no en el test.
3. **No tocar** `AsignacionSateliteService.ts`, `asignarDesdeBodega`, `OrdenRepository` ni
   `db/`. Si una tarea parece exigirlo, es señal de que se está desbordando el alcance:
   parar y consultar (ver preguntas abiertas de `requirements.md`).
