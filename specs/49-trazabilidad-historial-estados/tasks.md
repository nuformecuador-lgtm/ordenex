# Feature 49 — Trazabilidad / historial de estados de la orden — tasks.md

> Checklist accionable. Cada task indica el/los `R<n>` que cubre y el test que la
> verifica ("hecho"). `[P]` = paralelizable con otras `[P]` del mismo bloque.
> Orden global: backend (esquema → helper → instrumentación → lectura) → frontend →
> verificación. Un solo ciclo, un PR. NO empezar hasta "aprobado" en F1.4.

Convención de estado: `[ ]` pendiente · `[x]` hecho.

---

## Bloque 0 — Tipos y fuente de verdad

- [x] **T0.1** Crear `lib/types/orden-historial.ts`: enum/const `OrdenHistorialOrigenTipo`
  (11 valores del design §1.2) + tipos DTO (`OrdenHistorialEntradaDTO`).
  — Cubre: R23. — Hecho: `typecheck` 0; test que enumera los 11 valores esperados.

## Bloque 1 — Esquema + migración + RLS  (bloquea todo lo demás)

- [x] **T1.1** Añadir a `db/schema.prisma` el enum `OrdenHistorialOrigenTipo` y el modelo
  `OrdenHistorialEstado` (design §1.3) + relaciones opuestas en `Orden`, `OrderStatus`
  (origen/destino), `Usuario`, `GestionOrden`. Sin `updated_at`/`deleted_at`.
  — Cubre: R1, R2. — Hecho: `npx prisma validate` OK.
- [x] **T1.2** Crear la migración `db/migrations/<ts>_orden_historial_estado/migration.sql`:
  `CREATE TYPE` enum, `CREATE TABLE`, FKs (actor ON DELETE SET NULL), índices
  `(orden_id, created_at)` y `(orden_id, estatus_destino_id)`, `ENABLE ROW LEVEL SECURITY`.
  — Cubre: R1, R3, R5. — Hecho: `prisma migrate deploy` aplica sin error.
- [x] **T1.3** Escribir `down.sql` (DROP TABLE + DROP TYPE en orden inverso; no toca nada
  preexistente).
  — Cubre: R4. — Hecho: test/round-trip `db:migrate` → `db:rollback` → `db:migrate`;
  `migrate status` up-to-date (R32).
- [x] **T1.4** Test de RLS: acceso a `orden_historial_estado` con clave anónima → rechazado.
  — Cubre: R3. — Hecho: test RLS verde (patrón del repo).

## Bloque 2 — Helper choke point + repositorio  (depende de Bloque 1)

- [x] **T2.1** Crear `lib/interfaces/repositories/IOrdenHistorialRepository.ts` y
  `lib/repositories/OrdenHistorialRepository.ts` con `registrarCambioEstado(tx, entradas[])`
  (createMany en la tx recibida), `findHistorialByOrden(ordenId)` (ordenado + includes),
  `contarPorDestino(ordenId, estatusDestinoId)`.
  — Cubre: R6, R7 (recibe `tx`), R24. — Hecho: unit del repo con doble de `tx` afirma el
  shape del createMany (origen null, actor null, motivo, tipo).
- [x] **T2.2** Documentar en el helper la convención "toda escritura de `orden.estatus_id`
  DEBE llamar a `registrarCambioEstado` en la misma tx" (design §3.3).
  — Cubre: R6. — Hecho: comentario presente; referenciado por el test de cobertura T5.2.

## Bloque 3 — Instrumentar los 11 puntos de escritura (design §2)

> Cada task: enganchar el append en la MISMA tx, para SOLO las órdenes efectivamente
> transicionadas (R7/R8), con origen pre-leído + destino + actor + origen_tipo + motivo.
> Las `[P]` tocan archivos/métodos distintos y pueden ir en paralelo tras el Bloque 2.

- [x] **T3.1** `[P]` `OrdenRepository.createManyOrdenes` (#1): append origen=null,
  destino=inicial, actor=tienda, tipo=`carga_masiva`, solo filas insertadas.
  — Cubre: R9, R20, R21, R23. — Hecho: test carga masiva deja 1 historial por orden creada;
  duplicadas no dejan rastro.
- [x] **T3.2** `[P]` `OrdenRepository.create` (#2): append origen=null, destino=inicial,
  tipo=`creacion_manual`, actor=`OrdenService.crear`.
  — Cubre: R10, R20. — Hecho: test de creación individual deja 1 historial.
- [x] **T3.3** `[P]` `OrdenRepository.generarGuiaLote` (#3) dentro del `$transaction`
  existente: append por orden con su destino real (`en_espera_aceptacion`/`en_bodega`/
  `en_ruta_bodega_satelite`), tipo=`generacion_guia`, actor=maestro.
  — Cubre: R11, R7, R8. — Hecho: test de generarGuia con lote mixto deja historial con el
  destino correcto por orden.
- [x] **T3.4** `[P]` `OrdenRepository.asignarBodegaLote` (#4): envolver en `$transaction`;
  append destino=`en_espera_aceptacion`, tipo=`asignacion_bodega`, solo filas afectadas.
  — Cubre: R12, R7, R8. — Hecho: test de asignarDesdeBodega deja historial.
- [x] **T3.5** `[P]` `OrdenRepository.rutearBodegaSateliteLote` (#5) dentro del
  `$transaction` existente: append destino=`en_ruta_bodega_satelite`, tipo=`ruteo_satelite`.
  — Cubre: R13, R7. — Hecho: test de ruteo deja historial.
- [x] **T3.6** `[P]` `OrdenRepository.recibirEnSatelite` (#6): envolver en `$transaction`;
  append destino=`en_bodega_satelite`, tipo=`recepcion_satelite`, actor=adminSatélite, solo
  si transicionó (count 1).
  — Cubre: R14, R8. — Hecho: test recepción QR deja 1 historial; escaneo de orden ya
  recibida (count 0) no deja rastro.
- [x] **T3.7** `OrdenRepository.asignarSateliteLote` (#7, **SQL crudo anti-TOCTOU**): añadir
  `RETURNING id` al `$executeRaw`, y con los ids retornados hacer el append en el MISMO
  `$transaction`; tipo=`asignacion_satelite`, destino=`en_espera_aceptacion`.
  — Cubre: R15, R8, R7. — Hecho: test que verifica que solo las órdenes que ganaron la
  guarda `NOT EXISTS` dejan historial (una bloqueada por cierre no deja rastro).
- [x] **T3.8** `[P]` `GestionOrdenRepository.recogerLote` (#8): envolver en `$transaction`;
  append destino=`en_reparto`, tipo=`recoleccion`, actor=mensajero, solo filas afectadas.
  — Cubre: R16, R8. — Hecho: test de recoger deja historial.
- [x] **T3.9** `GestionOrdenRepository.crearGestionYTransicionar` (#9) dentro del
  `$transaction` existente: append destino=`resultado`, tipo=`gestion`,
  `gestion_orden_id`=id recién creado, `motivo`=motivo de la gestión (si aplica).
  — Cubre: R17, R22, R20. — Hecho: test por cada resultado (entregada/reprogramada/
  devuelta/rechazada) deja historial con destino y motivo correctos.
- [x] **T3.10** `[P]` `LiberacionReprogramadaRepository.liberarOrden` (#10): envolver en
  `$transaction`; append origen=`reprogramada`, destino=`en_bodega`/`en_bodega_satelite`,
  actor=NULL (sistema), tipo=`liberacion_reprogramada`, solo si liberó (count 1).
  — Cubre: R18, R21, R8. — Hecho: test del cron deja historial con actor nulo; segunda
  corrida (idempotente, count 0) no duplica rastro.
- [x] **T3.11** `[P]` `OrdenRepository.update` (#11): cuando el update cambia `estatus_id`
  (CRUD `OrdenService.actualizar`), envolver en `$transaction` y append con origen pre-leído,
  destino nuevo, tipo=`ajuste_estado`; si el update NO cambia estatus, NO registra.
  — Cubre: R19, R20. — Hecho: test de actualizar estatus deja historial; actualizar otro
  campo no deja rastro.

## Bloque 4 — Lectura: servicio, derivador, action, autorización

- [x] **T4.1** `OrdenHistorialService.obtenerHistorial(ordenId, actor)` con autorización por
  visibilidad de la orden (reusa patrón `OrdenService.obtener`).
  — Cubre: R26, R27. — Hecho: tests por rol (maestro ok; adminTienda ajena forbidden/
  not_found; mensajero no asignada forbidden; adminSatélite fuera de zona forbidden).
- [x] **T4.2** `OrdenHistorialService.contarIntentos(ordenId)` = conteo de destinos
  `devuelta` (derivador para la feature 47).
  — Cubre: R24, R25. — Hecho: test N devueltas → N; 0 devueltas → 0.
- [x] **T4.3** Server Action `lib/actions/orden-historial.ts` →
  `obtenerHistorialOrden(ordenId)` (resolveActorFromSession + service; resultado tipado).
  — Cubre: R28. — Hecho: test de la action (sin sesión → unauthenticated; ok con datos).

## Bloque 5 — Verificación transversal

- [x] **T5.1** Test de atomicidad: fallo del append revierte el cambio de estado, y
  viceversa (por cada mecanismo: transacción y updateMany-envuelto).
  — Cubre: R7. — Hecho: tests verdes.
- [x] **T5.2** Test de cobertura: enumera los 11 símbolos del mapa (design §2) como conjunto
  conocido de escritura de `estatus_id`; sirve de guardia para el reviewer.
  — Cubre: R6 (mitigación olvido). — Hecho: test presente y verde.
- [x] **T5.3** Suite de no-regresión: correr los tests previos de features 15/17/30/33/34/36/46
  sin cambios de comportamiento observable.
  — Cubre: R33. — Hecho: suite completa verde.

## Bloque 6 — Frontend: línea de tiempo

- [x] **T6.1** `[P]` Componente `HistorialOrdenTimeline` (lista vertical: destino legible vía
  `estatus-label`, timestamp, actor o "Sistema", motivo si existe).
  — Cubre: R29, R30. — Hecho: test de render con entradas mixtas (con/sin actor, con/sin
  motivo, con "creación").
- [x] **T6.2** Acción "Ver historial" por fila en la lista de órdenes que abre un drawer/modal
  con los datos pre-fetcheados por la Server Action (datos por props, no fetch de datos
  sensibles en el cliente).
  — Cubre: R28, R29. — Hecho: test de interacción (abre, muestra timeline).
- [x] **T6.3** Dejar el punto de extensión documentado para la feature 35 (realtime): el
  timeline consume una lista de entradas; la suscripción es de la 35.
  — Cubre: nota F1.4-f. — Hecho: comentario/annotation presente.

## Bloque 7 — Cierre de verificación (CHECKPOINTS)

- [x] **T7.1** `./init.sh` verde: `typecheck` 0, `lint` 0, `pnpm test` pasa (incl. nuevos).
  — Cubre: R31. — Hecho: salida pegada en `progress/impl_49-*.md`.
- [x] **T7.2** Round-trip de migración verificado contra Postgres local (R32) y evidencia.
  — Cubre: R4, R32. — Hecho: `migrate status` up-to-date tras el round-trip.
- [x] **T7.3** Mapa `R<n> → test` completo en `progress/impl_49-*.md` (todos los R con test).
  — Cubre: R34. — Hecho: cada R1..R33 con su test; reviewer verifica trazabilidad.
- [x] **T7.4** E2E: una orden recorre ≥2 transiciones y el detalle muestra la línea de tiempo
  en orden con actor y motivo.
  — Cubre: R29 (flujo crítico). — Hecho: E2E escrito (ejecución según convención del repo).

---

### Dependencias (resumen)
- Bloque 1 bloquea 2–6. Bloque 2 bloquea 3–4.
- Bloque 3: T3.3/T3.7/T3.9 tocan métodos que ya usan `$transaction` (sin `[P]` entre sí
  solo si compartieran archivo — están en distintos métodos, pero T3.3/T3.4/T3.7/T3.11
  tocan el MISMO archivo `OrdenRepository.ts`: coordinar para evitar conflictos, no correr
  esos cuatro literalmente en paralelo aunque estén marcados `[P]` a nivel lógico).
- Bloque 6 depende de T4.3 (la action). Bloque 7 al final.
