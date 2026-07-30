# Feature 157 (Recolección en tienda por el mensajero · QR) · tasks.md

> Zona `fullstack`: la implementación se **secuencia backend → frontend**. Ninguna task de la
> Fase 2 arranca hasta que la Fase 1 esté verde (`pnpm test` de las suites tocadas + type-check).
> `[P]` = puede ejecutarse en paralelo con las otras `[P]` del mismo bloque (archivos disjuntos).
> Convención de commits: `feat(157): <qué>` / `test(157): <qué>` — un commit por task completada.

---

## Fase 0 — Puerta de entrada (bloqueante)

- [ ] **T0.1 — Verificar dependencias mergeadas.**
      Confirmar en `dev` que existen: el value `por_recolectar_en_tienda` en `ORDER_STATUS_SEED`
      (`lib/types/order-status.ts`), la arista `por_recolectar_en_tienda → en_ruta_bodega_central`
      con `via: "recoleccion_tienda"` en `TRANSICIONES` (`lib/types/order-status-transiciones.ts`),
      el value `recoleccion_tienda` en el enum `orden_historial_origen_tipo`
      (`lib/types/orden-historial.ts`), y que la 155 hace nacer en `por_recolectar_en_tienda` a las
      órdenes de tienda sin fulfillment.
      **Hecho cuando:** los cuatro puntos están confirmados por grep y `./init.sh` pasa en verde.
      Si falta alguno, la feature NO arranca (se devuelve al leader).

- [ ] **T0.2 — Cerrar las preguntas abiertas bloqueantes con el humano.**
      Q1 de `design.md` (cierre + ranking) y pregunta 1 de `requirements.md` (elegibilidad del
      mensajero). Las demás pueden quedar abiertas.
      **Hecho cuando:** ambas respuestas están escritas en `progress/impl_157-recoleccion-tienda-qr.md`.
      **Depende de:** T0.1.

- [ ] **T0.3 — Confirmar que NO hay migración.**
      Releer `design.md §3.1` contra el schema: ninguna tabla, columna, enum ni índice nuevo.
      **Hecho cuando:** `db/migrations/` no gana ningún directorio en toda la feature y está
      escrito así en el impl. **Depende de:** T0.1.

---

## Fase 1 — Backend

### Bloque 1.A — Tipos, contratos e interfaces (todo `[P]` entre sí)

- [ ] **T1.1 `[P]` — `lib/types/recoleccion-tienda.ts`.**
      `recolectarEnTiendaSchema` (zod, `numGuia` entero positivo) + `RecolectarEnTiendaResult` con
      los 8 estados de `design.md §4.1`.
      **Hecho cuando:** compila en strict y un test de borde prueba que `0`, `-1`, `"12"` y
      `undefined` fallan el `parse`. (R20)
      **Depende de:** T0.1.

- [ ] **T1.2 `[P]` — `lib/interfaces/services/IRecoleccionTiendaService.ts`.**
      `RecolectarEnTiendaServiceResult` (= resultado sin `unauthenticated`) + la interfaz de un solo
      método.
      **Hecho cuando:** compila y no importa nada de Prisma ni de HTTP.
      **Depende de:** T1.1.

- [ ] **T1.3 `[P]` — Ampliar `lib/types/orden-guia.ts` con `AsignarRecoleccionResult`** y
      `lib/interfaces/services/IGuiaAsignacionService.ts` con `AsignarRecoleccionInput` y la firma
      `asignarRecoleccion`.
      **Hecho cuando:** compila y `guia-decision-error-messages.ts` sigue tipando sin cambios
      (mismo shape de `conflict{detalle}` / `validation_error{fieldErrors}`).
      **Depende de:** T0.1.

- [ ] **T1.4 `[P]` — Ampliar `IMisAsignacionesService`:** `porRecolectar: MiAsignacionDTO[]` en
      `ListarMisAsignacionesServiceResult` y `tiendaTelefono?: string | null` en `MiAsignacionDTO`
      (opcional, patrón aditivo de `marcarLuego?` / `notaPrivada?`).
      **Hecho cuando:** compila y **ningún fixture/doble de test existente rompe**.
      **Depende de:** T0.1.

### Bloque 1.B — Repositorios

- [ ] **T1.5 — `OrdenTransicionRow` gana `mensajeroAsignadoId?: string | null`** y el `select` de
      `OrdenRepository.findByNumGuiaForTransicion` lo incluye.
      **Hecho cuando:** un test de integración lee una orden por `num_guia` y recibe el
      `mensajeroAsignadoId` real; las suites de 138 y 139 siguen verdes sin tocarlas.
      **Depende de:** T0.1.

- [ ] **T1.6 — `OrdenRepository.asignarRecoleccionLote(ordenIds, mensajeroId, origenValue)`.**
      `$transaction` con `updateMany` guardado por `deletedAt: null` + `estatus.value = origenValue`;
      escribe **solo** `mensajeroAsignadoId`; si `count !== ordenIds.length` lanza para provocar
      rollback. **No** llama a `appendCambioEstado`. **No** toca `asignadoAt`, `numGuia`, `estatusId`
      ni `prioridad`.
      **Hecho cuando:** tests de integración prueban: (a) lote de 3 válidas → 3 asignadas, 0 filas de
      `orden_historial` nuevas, `estatus_id` y `num_guia` intactos, `asignado_at` sigue `NULL`
      (R4/R9/R38); (b) lote con 1 en otro estado → 0 asignadas (todo-o-nada, R5); (c) lote con 1
      borrada → 0 asignadas.
      **Depende de:** T0.2 (respuesta de Q1 confirma el trato de `asignado_at`).

- [ ] **T1.7 — `OrdenRepository.recolectarEnTienda(ordenId, origenValue, destinoEstatusId, mensajeroId, historial)`.**
      Copia de `recibirEnBodegaCentral` añadiendo `mensajeroAsignadoId` a **ambos** `where`;
      `appendCambioEstado` solo si `count === 1`, con `origenTipo: "recoleccion_tienda"`.
      **Hecho cuando:** tests de integración prueban: transición efectiva + 1 fila de historial en la
      misma tx (R28); segunda llamada → `false` y **sin** segunda fila (R34); orden de otro
      mensajero → `false` y sin efectos (R30/R34); `num_guia` y `mensajero_asignado_id` intactos
      (R35).
      **Depende de:** T1.5.

- [ ] **T1.8 `[P]` — `GestionOrdenRepository`: `WITH_ASIGNACION` incluye `tienda.telefono`** y
      `toMiAsignacionRow` lo propaga como `tiendaTelefono`.
      **Hecho cuando:** un test de integración de `findMisAsignaciones` devuelve el teléfono de la
      tienda y el `WHERE` no cambió. (R15)
      **Depende de:** T1.4.

### Bloque 1.C — Services

- [ ] **T1.9 — `lib/services/RecoleccionTiendaService.ts`.**
      Los 9 pasos de `design.md §4.3(B)`, en ese orden.
      **Hecho cuando:** tests unitarios con dobles (sin DB/HTTP) cubren **uno por resultado**:
      `forbidden` por rol (R29), `conflict` por bloqueo de cierre **antes de leer la orden** (R31),
      `no_encontrada` para inexistente / borrada / ajena — los tres con el MISMO status (R30),
      `ya_recolectada` (R32), `estado_invalido` con el estado actual (R33), `validation_error` por
      catálogo incompleto, `ok` (R26/R27) y `conflict` por carrera perdida (R34).
      **Depende de:** T1.2, T1.7.

- [ ] **T1.10 — `GuiaAsignacionService.asignarRecoleccion`.**
      Los 7 pasos de `design.md §4.3(A)`. **No** invocar `gateCoordenadas`.
      **Hecho cuando:** tests unitarios cubren `forbidden` (R8), `conflict` por estado de origen
      inválido / borrada / inexistente con `detalle` por orden (R5), `validation_error` por
      mensajero no válido (R6), `conflict` por mensajero bloqueado (R7), `ok` sobre lote de N
      (R3), y un caso explícito de **orden sin coordenadas que SÍ se asigna** (R9).
      **Depende de:** T1.3, T1.6, T0.2 (elegibilidad del mensajero).

- [ ] **T1.11 — `MisAsignacionesService.listarMisAsignaciones`: tercer grupo.**
      Constante `ORIGEN_RECOLECCION`, estados de la query, bucket `porRecolectar` con
      `secuenciaRuta: null` y `tiendaTelefono`; KPIs y `paradasSinOptimizar` siguen derivando solo de
      `porGestionar`.
      **Hecho cuando:** tests unitarios prueban que una orden en `por_recolectar_en_tienda` (a) sale
      en `porRecolectar` y no en los otros dos grupos (R11), (b) no aparece para otro mensajero
      (R12), (c) no altera `pendientes` / `porCobrar` / `totalACobrar` ni `paradasSinOptimizar`
      (R39). Las suites existentes de `MisAsignacionesService` siguen verdes.
      **Depende de:** T1.4, T1.8.

- [ ] **T1.12 `[P]` — Guard de no-contaminación de cierre, corte y ranking.**
      Sin cambio de código si Q1 = "invisible": se añaden tests que **congelan** el comportamiento —
      `ESTADOS_PENDIENTES` no contiene `por_recolectar_en_tienda` (R37), `CorteDiarioService` no la
      barre a `sin_gestionar` (R37), `contarAsignadasPorMensajero` no la cuenta porque
      `asignado_at` sigue `NULL` (R38), y no se escribe fila alguna en `gestion_orden` (R36).
      Si Q1 = "sí cuenta", esta task incorpora además el cambio elegido en `design.md §11 Q1 (a)/(b)`.
      **Depende de:** T0.2, T1.6.

### Bloque 1.D — Server Actions (borde)

- [ ] **T1.13 — `lib/actions/recoleccion-tienda.ts` → `recolectarEnTiendaPorQr`.**
      Espejo de `recepcion-bodega-central.ts`: `withErrorHandler` + `resolveActorFromSession` +
      `parse` + service; traductor que solo mapea `VALIDATION_ERROR` y `UNAUTHORIZED` y **lanza**
      ante cualquier otro code.
      **Hecho cuando:** tests de integración de la action prueban `unauthenticated` sin sesión (R29),
      `validation_error` con `numGuia` inválido sin llegar al service (R20) y passthrough de un `ok`
      del service.
      **Depende de:** T1.9.

- [ ] **T1.14 — `lib/actions/ordenes-guia.ts` → `asignarRecoleccion`.**
      `asignarRecoleccionSchema` (`ordenIds` uuid[] min 1, `mensajeroId` uuid) + `toGuiaActionError`
      existente.
      **Hecho cuando:** tests de la action prueban `unauthenticated`, `validation_error` con
      `ordenIds` vacío y passthrough de `conflict{detalle}` (R5/R8).
      **Depende de:** T1.10.

### Bloque 1.E — Cierre de fase

- [ ] **T1.15 — Suite backend verde.**
      **Hecho cuando:** `./init.sh` en verde, `tests/unit` y `tests/integration` (incluida
      `tests/integration/db`) pasan, y `progress/impl_157-recoleccion-tienda-qr.md` tiene el mapa
      R → test de todos los requisitos de backend (R3–R9, R26–R39).
      **Depende de:** T1.1 – T1.14.

---

## Fase 2 — Frontend (arranca solo con T1.15 en verde)

### Bloque 2.A — Pieza A: listado del maestro

- [ ] **T2.1 `[P]` — `app/(app)/ordenes/_components/AsignarRecoleccionModal.tsx`.**
      Copia reducida de `AsignarBodegaModal` **sin** la fase `ManifiestoResultado`. Lista de
      remisiones + `Select` de mensajero + confirmar; error vía `guiaDecisionErrorMessage`.
      **Hecho cuando:** test de componente prueba que sin mensajero elegido muestra "Selecciona un
      mensajero" y no llama a la action, y que en `ok` emite toast + `onSuccess`. (R3)
      **Depende de:** T1.15.

- [ ] **T2.2 — `OrdenesRevisionMaestro.tsx`: apartado "Por recolectar en tienda".**
      Instancia nueva de `OrdenesApartado` (que **no se modifica**) antes de "En bodega", con acción
      primaria "Asignar mensajero para recolección" y secundaria "Imprimir etiquetas"; cableado del
      modal de T2.1 y del `EtiquetasGuiaModal` existente; `readOnly` sin acciones.
      **Hecho cuando:** tests de componente prueban: el apartado se renderiza con su `aria-label`
      (R1); la columna "Mensajero" muestra el nombre del asignado y `—` cuando no hay (R2); con
      `readOnly` no hay checkboxes ni botones; tras `onSuccess` se revalidan los apartados (R10).
      **Verificar además:** `git diff --stat` de `OrdenesApartado.tsx` = vacío.
      **Depende de:** T2.1.

### Bloque 2.B — Pieza B/C: portal del mensajero

- [ ] **T2.3 `[P]` — `app/(app)/mis-asignaciones/_components/useRecolectarPorGuia.ts`.**
      Espejo de `useRecogerPorGuia`: resuelve `numGuia` contra `porRecolectar`; si no está →
      toast y **no** llama a la action; traduce los 8 resultados a toast distinto.
      **Hecho cuando:** tests prueban el rechazo local sin llamada a la action (R21) y un toast
      distinto por cada resultado (R23).
      **Depende de:** T1.15.

- [ ] **T2.4 — `app/(app)/mis-asignaciones/_components/RecoleccionTiendaPanel.tsx`.**
      Banner de conteo + bloque único de acción (`QrScanner` + input de guía + botón) + lista
      agrupada por tienda con `ContactoButtons` del teléfono de la tienda + tarjetas con guía,
      remisión, producto y destinatario.
      **Hecho cuando:** tests de componente prueban: agrupación por tienda (R14); presencia del
      contacto telefónico (R15); **ausencia** de todo control de gestión — método de pago, causa de
      devolución, input de archivo, fecha, los 4 botones de resultado y el monto a cobrar
      (R13/R16); las dos vías de entrada disparan la misma action (R17/R19); código inválido corta
      en cliente (R20); con `bloqueado` el bloque de acción no se renderiza y la lista sí (R24).
      **Depende de:** T2.3.

- [ ] **T2.5 — `MisAsignacionesModule.tsx`: cableado del tercer grupo.**
      Prop `porRecolectar`; render de `RecoleccionTiendaPanel` encima de "Por recoger" y solo en
      VISTA COMPLETA; exclusión de `unionAsignaciones` y de `aplicarFiltroZona`; buscador sí
      aplicado; `router.refresh()` tras confirmación.
      **Hecho cuando:** tests prueban: los tres apartados coexisten y son distinguibles (R11);
      las recolecciones no aportan opciones al filtro cantón/distrito ni se filtran por él (R40);
      no entran al mapa ni a `porGestionarVisual` (R39); el MODO FOCO sigue comportándose igual
      (R25); tras `ok` se refresca y la orden desaparece del apartado (R22).
      **Depende de:** T2.4.

- [ ] **T2.6 `[P]` — `app/(app)/mis-asignaciones/page.tsx`: passthrough de `porRecolectar`.**
      **Hecho cuando:** compila y el test de la página (si existe) sigue verde; sin otros cambios en
      el Server Component.
      **Depende de:** T1.15.

- [ ] **T2.7 — Regresión explícita del panel de gestión.**
      **Hecho cuando:** `git diff` de `GestionarOrdenPanel.tsx` es **vacío** y su suite de tests pasa
      sin modificaciones. (R25)
      **Depende de:** T2.5.

---

## Fase 3 — Verificación y cierre

- [ ] **T3.1 — Suite completa verde.**
      **Hecho cuando:** `./init.sh` en verde + `tests/unit` + `tests/integration` +
      `tests/components` pasan y el type-check de build no reporta errores.
      **Depende de:** Fase 2 completa.

- [ ] **T3.2 `[P]` — e2e del camino feliz completo.**
      Maestro asigna una orden `por_recolectar_en_tienda` → el mensajero la ve en su apartado propio
      → confirma por número de guía → la orden queda en `en_ruta_bodega_central` → el maestro la
      recibe con el escáner de bodega central (feature 138) → queda en `en_bodega_central`.
      **Hecho cuando:** el spec de Playwright pasa y demuestra el empalme con el tramo ya existente.
      **Depende de:** T3.1.

- [ ] **T3.3 — Mapa de trazabilidad completo.**
      **Hecho cuando:** `progress/impl_157-recoleccion-tienda-qr.md` mapea **cada** `R1`…`R40` a al
      menos un test concreto (archivo + nombre del test), incluidos los requisitos de AUSENCIA
      (R16, R25, R36, R37, R38), y registra las respuestas a Q1 y a la pregunta 1 de
      `requirements.md`.
      **Depende de:** T3.1.

- [ ] **T3.4 — Preguntas abiertas remanentes registradas.**
      **Hecho cuando:** las preguntas 2–6 de `requirements.md` y Q2–Q4 de `design.md` que sigan sin
      respuesta quedan anotadas en `progress/current.md` como deuda declarada, no como supuestos
      implementados en silencio.
      **Depende de:** T3.3.
