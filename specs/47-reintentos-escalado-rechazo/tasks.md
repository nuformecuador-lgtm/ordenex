# Feature 47 — Reintentos de entrega y escalado a rechazo — tasks.md

> Checklist accionable. Cada task indica el/los `R<n>` que cubre y el test que la verifica
> ("hecho"). `[P]` = paralelizable con otras `[P]` del mismo bloque (tocan archivos/métodos
> distintos). Orden global: config → decisión (service) → escritura (repo) → cobertura →
> UI → verificación. Un solo ciclo, un PR. NO empezar hasta "aprobado" en F1.4.
> RECORDATORIO: el diseño recomendado NO requiere migración (R21/§7).

Convención de estado: `[ ]` pendiente · `[x]` hecho.

---

## Bloque 0 — Config del umbral

- [x] **T0.1** Crear `lib/config/reintentos.ts` con `MIN_INTENTOS_ENTREGA` (env
  `REINTENTOS_MIN_INTENTOS`, default 3, entero ≥ 1; patrón `lib/config/ordenes.ts`).
  — Cubre: R3. — Hecho: unit del config (ausente→3; "5"→5; "0"/"x"→3); `typecheck` 0.

## Bloque 1 — Regla de decisión reintento vs escalado (service)  (depende de B0)

> La REGLA vive en el service; el repo sólo escribe (design §2.1).

- [x] **T1.1** En `IGestionOrdenRepository.OrdenGestionRow` + `findByIdsParaGestion` añadir
  `zonaId` a la proyección (lo necesita el ruteo a bodega). No cambia comportamiento.
  — Cubre: R5 (insumo). — Hecho: unit del repo afirma que `findByIdsParaGestion` devuelve `zonaId`.
- [x] **T1.2** En `MisAsignacionesService.gestionar`, rama `resultado === "devuelta"`: leer
  `contarIntentos(ordenId)` (derivador 49), calcular `intentoActual = previos + 1`, resolver
  umbral (`reintentosConfig`) y DECIDIR seguimiento: escalado (`rechazada`, actor null, no
  limpia mensajero) si `intentoActual >= umbral`; reintento (`resolverDestinoCierre(zonaId,
  centralZonaId)` → `en_bodega`/`en_bodega_satelite`, actor null, limpia mensajero) si `<`.
  — Cubre: R1, R2, R4, R5, R8, R9. — Hecho: unit del service con dobles: bajo umbral →
  destino bodega correcto por zona; en umbral → `rechazada`; `reprogramada` intercalada no
  cuenta (R4); umbral configurable (5ª escala con env=5).
- [x] **T1.3** `[P]` Inyectar `IZonaRepository.findCentralZonaId` y `contarIntentos` en el
  service (o su interfaz), reusando `resolverDestinoCierre` de `lib/utils/bodega-responsable`.
  Edge: `zonaId` null → fallback `en_bodega`.
  — Cubre: R5. — Hecho: unit del caso `zonaId=null` → `en_bodega`.

## Bloque 2 — Escritura compuesta atómica (repo, choke point 49)  (depende de B1)

- [x] **T2.1** Extender `GestionOrdenRepository.crearGestionYTransicionar` (o método hermano
  `crearGestionDevueltaYResolver`) para aceptar un SEGUIMIENTO opcional `{ destinoEstatusId,
  limpiaMensajero, actorUsuarioId: null }`. En la MISMA `$transaction`: gestión + `orden.update
  devuelta` + `appendCambioEstado(en_reparto→devuelta, actor=mensajero, gestion)` + (si hay
  seguimiento) `orden.update <destino>` (limpiando `mensajeroAsignadoId` según flag) +
  `appendCambioEstado(devuelta→<destino>, actor=null, gestion, gestion_orden_id)` + limpiar
  puntero.
  — Cubre: R6, R7, R10, R11. — Hecho: unit del repo con doble de `tx`: dos entradas de
  `appendCambioEstado` (devuelta + seguimiento); `mensajeroAsignadoId` limpio sólo en reintento.
- [x] **T2.2** `[P]` Integración `devuelta → bodega` (bajo umbral): la orden queda en
  `en_bodega`/`en_bodega_satelite` según zona, `mensajeroAsignadoId` null, `num_guia` intacto,
  DOS filas de historial.
  — Cubre: R5, R6, R11. — Hecho: test de integración verde.
- [x] **T2.3** `[P]` Integración `devuelta → rechazada` (N-ésima, N=umbral): la orden queda
  en `rechazada` (final) con `actor=null` en el seguimiento y `mensajeroAsignadoId` conservado.
  — Cubre: R8, R9, R10. — Hecho: test de integración verde.
- [x] **T2.4** `[P]` Atomicidad (R10): fallo del append de seguimiento revierte gestión +
  transición a `devuelta` (nada persiste).
  — Cubre: R10. — Hecho: test de atomicidad verde.

## Bloque 3 — Cobertura y no-regresión (feature 49)

- [x] **T3.1** Actualizar `tests/unit/repositories/orden-historial-cobertura.test.ts`:
  documentar que #9 emite una transición COMPUESTA (gestión + seguimiento automático, actor
  null, `origen_tipo=gestion`), escribiendo también destinos `en_bodega`/`en_bodega_satelite`/
  `rechazada`. Ninguna escritura de estado se salta el choke point.
  — Cubre: R14. — Hecho: test de cobertura verde con la anotación del seguimiento.
- [x] **T3.2** No-regresión: `entregada`/`reprogramada`/`rechazada` directa dejan UNA sola
  transición (sin seguimiento); tests previos de 36/46/49 verdes.
  — Cubre: R19. — Hecho: suite previa verde sin cambios de comportamiento observable.
- [x] **T3.3** `[P]` Confirmar que la 47 NO escribe `devuelta_origen` (reservado a la 48) ni
  añade `order_status`.
  — Cubre: R13, R21. — Hecho: test/aserción de que ningún call-site nuevo escribe
  `devuelta_origen`.

## Bloque 4 — UI: nº de intentos  (depende de B1/B2)

- [x] **T4.1** Exponer el conteo de intentos derivado a la UI (server-side, datos por props):
  añadirlo al DTO de la action de historial de la 49 o como campo agregado de la fila de la
  lista. Sin fetch de datos sensibles en el cliente.
  — Cubre: R15, R17. — Hecho: unit de la action/service devuelve el conteo con la autz de la 49.
- [x] **T4.2** `[P]` Badge/columna "Intento X de N" en la lista de órdenes / sheet de
  historial, reusando `estatus-label`; visible según visibilidad de la orden (49/R27).
  — Cubre: R15, R16, R17. — Hecho: test de render (con/sin devoluciones) y de visibilidad por rol.

## Bloque 5 — Verificación (CHECKPOINTS)

- [x] **T5.1** `./init.sh` verde: `typecheck` 0, `lint` 0, `pnpm test` pasa (incl. nuevos).
  — Cubre: R20. — Hecho: salida en `progress/impl_47-*.md`.
- [x] **T5.2** E2E: una orden recibe 3 devoluciones consecutivas (con re-asignación entre
  ellas); tras la 3ª queda `rechazada` y la UI muestra "intento 3 de 3"; la línea de tiempo
  muestra las 3 devoluciones + el escalado.
  — Cubre: R8, R9, R15 (flujo crítico). — Hecho: E2E escrito (ejecución según convención del repo).
- [x] **T5.3** Mapa `R<n> → test` completo en `progress/impl_47-*.md` (R1..R22 con test).
  — Cubre: R22. — Hecho: cada R con su test; el reviewer verifica trazabilidad.

---

### Dependencias (resumen)
- B0 bloquea B1. B1 bloquea B2 y B4. B2 bloquea B3.1/B3.2.
- Dentro de B2, T2.2/T2.3/T2.4 son `[P]` (tests distintos) tras T2.1.
- B5 al final.
- **Sin migración** en el camino recomendado; si en la aprobación se elige la variante con
  enum nuevo (F1.4-f/h), añadir un bloque de migración con `down.sql` + round-trip (R21) ANTES
  de B2.
