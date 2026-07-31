# Feature 157 — Recolección en tienda por el mensajero (QR) · implementación

> Estado: **implementada, pendiente de verificación en pantalla**. Backend y frontend completos
> con la suite en verde (649 archivos / 7703 tests). Lo que queda es lo que no se puede probar
> sin dispositivo real ni base con datos: ver el flujo de punta a punta en la app.

## Puerta T0

- **T0.1 — dependencias mergeadas: OK.** `por_recolectar_en_tienda` en `ORDER_STATUS_SEED`;
  arista `por_recolectar_en_tienda → en_ruta_bodega_central` con `via: "recoleccion_tienda"` en
  `TRANSICIONES`; `recoleccion_tienda` en el enum de `orden_historial_origen_tipo`; y la 155
  haciendo nacer ahí a las órdenes de tienda sin fulfillment (`destino-creacion.ts`).
- **T0.3 — sin migración: OK.** `db/migrations/` no gana ningún directorio en toda la feature.

### T0.2 — decisiones del humano (2026-07-30)

1. **Q1 (cierre y ranking): INVISIBLE para ambos.** `asignarRecoleccionLote` no estampa
   `asignado_at`. Es el denominador del ranking y el numerador solo cuenta entregas, así que
   estamparlo bajaría el porcentaje del mensajero sin poder subirlo jamás. Cuando la orden
   llegue a la central y se asigne para repartir, `asignarBodegaLote` lo estampa y el ranking
   la cuenta una sola vez.
2. **Pregunta 1 (elegibilidad): CUALQUIER mensajero** activo y no bloqueado por cierre. El
   filtro por zona de las otras asignaciones es la zona de ENTREGA de la orden, que para ir a
   recoger a una tienda no significa nada. Se valida con `findMensajeroIdsValidos` (solo rol).
3. **Bloque E (R43): se engancha y se BORRA el huérfano.** El botón de manifiesto pasa al paso
   3 real de la carga masiva y `OrdenesCargaResumenPaso.tsx` desaparece con su test.

## Mapa requisito → prueba

### Asignación por el maestro (R1-R9)

| Requisitos | Dónde | Prueba |
| --- | --- | --- |
| R1, R2 | apartado "Por recolectar en tienda" en `OrdenesRevisionMaestro` | `OrdenesRevisionMaestro.test.tsx` → "157/R1: monta el apartado…" y "…con readOnly…" |
| R3 | `AsignarRecoleccionModal` + `asignarRecoleccion` | `guia-asignacion-service.test.ts` → "R3: asigna el lote entero y escribe UNA sola vez, sin transicionar" |
| R4 | no transiciona (solo `mensajeroAsignadoId`) | `recoleccion-no-contamina.test.ts` → "no escribe asignadoAt, estatusId, numGuia ni prioridad" |
| R5 | todo-o-nada por lote | `guia-asignacion-service.test.ts` → "R5: una orden %s aborta el lote ENTERO" (×2) + "R5: una orden inexistente…" |
| R6 | mensajero válido, **sin** filtro de zona | `guia-asignacion-service.test.ts` → "R6: mensajeroId que no es mensajero…" y "R6: el mensajero se valida SIN acotar por zona" |
| R7 | mensajero bloqueado por cierre | `guia-asignacion-service.test.ts` → "R7: mensajero con cierre pendiente…" |
| R8 | autorización (acceso total) | `guia-asignacion-service.test.ts` → "R8: %s no asigna recolecciones" · borde: `ordenes-guia-action.test.ts` |
| R9 | sin gate de coordenadas | `guia-asignacion-service.test.ts` → "R9: una orden SIN coordenadas SI se asigna" |

### Portal del mensajero (R11-R25)

| Requisitos | Dónde | Prueba |
| --- | --- | --- |
| R11, R12 | tercer bucket `porRecolectar` | `mis-asignaciones-service.test.ts` → bloque "tercer grupo por recolectar" (7 casos) · `MisAsignacionesModule.test.tsx` → "R11: los tres apartados coexisten" |
| R13, R14 | agrupado por tienda, tarjetas sin controles | `RecoleccionTiendaPanel.test.tsx` → "R14: agrupa por tienda…" |
| R15 | contacto de la TIENDA | `RecoleccionTiendaPanel.test.tsx` → "R15: llama a la TIENDA, no al destinatario" y "…sin teléfono…" |
| R16 | **ausencia** de todo control de gestión | `RecoleccionTiendaPanel.test.tsx` → "R16: NO ofrece ningún control de gestión" |
| R17, R19, R20 | dos vías equivalentes, código inválido cortado en cliente | `RecoleccionTiendaPanel.test.tsx` → "R17: la vía manual confirma…", "R20: un código que no son dígitos…" |
| R21 | guía ajena rechazada sin llamar a la action | `RecoleccionTiendaPanel.test.tsx` → "R21: una guía que NO es suya…" |
| R23 | un toast distinto por resultado | `RecoleccionTiendaPanel.test.tsx` → "R23: escanear dos veces…" · resto de estados en `useRecolectarPorGuia` |
| R24 | bloqueado por cierre: lista sí, acción no | `RecoleccionTiendaPanel.test.tsx` → "R24: con un cierre pendiente…" |
| R25 | `GestionarOrdenPanel` intacto | `git diff origin/dev -- GestionarOrdenPanel.tsx` **vacío** · `MisAsignacionesModule.test.tsx` → "R25: el MODO FOCO sigue siendo del flujo de gestión" |

### Confirmación de la recolección (R26-R38)

| Requisitos | Dónde | Prueba |
| --- | --- | --- |
| R26, R27, R28 | transición + historial en la misma tx | `recoleccion-tienda-service.test.ts` → "R26/R27: transiciona a en_ruta_bodega_central…" |
| R29 | solo el rol mensajero | `recoleccion-tienda-service.test.ts` → "R29: %s NO recolecta" · borde: `recoleccion-tienda-action.test.ts` |
| R30 | opacidad: inexistente = borrada = ajena | `recoleccion-tienda-service.test.ts` → "R30: orden %s -> no_encontrada" (×3) + "sin mensajero asignado" |
| R31 | bloqueo por cierre **antes** de leer | `recoleccion-tienda-service.test.ts` → "R31: con un cierre pendiente…" |
| R32 | idempotente | `recoleccion-tienda-service.test.ts` → "R32: ya recolectada…" |
| R33 | estado inválido con su estado actual | `recoleccion-tienda-service.test.ts` → "R33: fuera del origen…" |
| R34 | carrera perdida | `recoleccion-tienda-service.test.ts` → "R34: pierde la carrera…" (×2) |
| R35 | no toca `num_guia` ni el mensajero | guardia atómica en `OrdenRepository.recolectarEnTienda` (mensajero en ambos `where`) |
| R36, R37, R38 | **ausencias**: sin gestión, sin cierre, sin ranking | `recoleccion-no-contamina.test.ts` (5 casos) |
| R20 (borde) | `numGuia` inválido no llega al service | `recoleccion-tienda-action.test.ts` → "R20: numGuia %s -> validation_error" (×4) |

### No contaminación de la vista (R39, R40) y bloque E (R41-R43)

| Requisitos | Prueba |
| --- | --- |
| R39 | `mis-asignaciones-service.test.ts` → "R39: NO contamina los KPIs" y "R39: NO cuenta como parada sin optimizar" · `MisAsignacionesModule.test.tsx` → "R39: no entra en los KPIs de ruta ni en el mapa" |
| R40 | `MisAsignacionesModule.test.tsx` → "R40: no aporta opciones al filtro cantón/distrito" |
| R41, R42, R43 | `ManifiestoFlujos.test.tsx` → "R18: tras la carga masiva ofrece el manifiesto…" y "R17/R18: sin órdenes nuevas…", ahora sobre `OrdenesCargaResumen` (el paso que el modal monta) |

## T3.2 — e2e: declarado INAPLICABLE

No hay harness de Playwright ejecutable en este repo (los specs existentes lo registran como
`NOT EXECUTED`). El empalme con el tramo de la 138 queda cubierto por el contrato: el destino
de la recolección es exactamente el origen que `RecepcionBodegaCentralService` ya admite
(`en_ruta_bodega_central`), y ese service tiene su propia suite. La verificación de punta a
punta pasa a la lista de comprobación en pantalla de abajo.

## Pendiente de verificación humana (en pantalla, no automatizable aquí)

1. Maestro: seleccionar órdenes del apartado nuevo, asignar mensajero y ver la columna
   "Mensajero" poblada tras la revalidación.
2. Mensajero: ver el apartado agrupado por tienda, escanear el QR de una etiqueta con la
   cámara del teléfono y comprobar que la orden desaparece del apartado.
3. Recolección de tanda: escanear varias seguidas, incluida una repetida (debe informar, no
   dar error) y una ajena (debe rechazar sin tocar el servidor).
4. Empalme: recibir en bodega central por QR la orden recién recolectada (feature 138).
5. Carga masiva por UI: comprobar que el paso 3 ofrece el manifiesto del lote.

## T3.4 — preguntas abiertas que siguen sin respuesta (deuda declarada)

- **requirements 2** — dirección física de la tienda: el modelo no la tiene, así que el
  mensajero llega con nombre + teléfono. Añadirla exigiría migración, fuera de alcance.
- **requirements 3** — camino de respaldo para que maestro/admin confirmen una recolección
  cuando el mensajero no puede escanear.
- **requirements 4 y 6** — reasignar/desasignar y recolección parcial: hoy las órdenes no
  recogidas quedan asignadas a ese mensajero indefinidamente; se resuelve reasignando.
- **requirements 5** — aviso al mensajero al asignarle una recolección (infra de la 146).
- **design Q2** — la recolección no bloquea el cierre del día (aceptado).
- **design Q3** — la asignación no deja rastro de auditoría; el primer rastro es la propia
  transición de recolección, que sí registra actor y familia.
