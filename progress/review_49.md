# review_49 — Trazabilidad / historial de estados de la orden

> Reviewer del arnes SDD. Rama feature/49-trazabilidad-historial-estados, commit faeeb2a.
> Verificacion EJECUTABLE: corri init.sh y el round-trip de migracion yo mismo; grep
> independiente del inventario de los 11 puntos; lectura de los 11 call-sites y sus tests.
> NO edite codigo.

## Veredicto: APROBADO (0 bloqueantes)

---

## 1. Checklist CHECKPOINTS.md

Especificacion
- [x] requirements.md con R1..R34 (EARS numerados).
- [x] design.md con alternativas descartadas y su porque (seccion 7).
- [x] tasks.md con TODAS las tasks [x] (Bloques 0-7, T0.1..T7.4).

Trazabilidad
- [x] Cada R-n mapea a >=1 test concreto (tabla seccion 2). Sin R huerfano.
- [x] impl_49.md contiene el mapa R-n -> test.

Calidad de codigo
- [x] typecheck 0 errores (paso antes de lint bajo set -e).
- [x] lint 0 errores (135 warnings preexistentes en .claude/skills/, ninguno en la feature).
- [x] test 249 files / 2225 tests passing.
- [x] Flujo critico con E2E: e2e/historial-orden.spec.ts (deferido, convencion del repo).

Datos y seguridad
- [x] Tabla nueva orden_historial_estado con RLS habilitada (sin policies, solo service role).
- [x] Migracion versionada y reversible: down.sql presente; db:rollback funciona (verificado por mi).
- [x] Sin secretos hardcodeados. Sin webhooks nuevos (N/A).

Patron de capas
- [x] Controller (Server Action orden-historial.ts) sin queries; resuelve actor + delega.
- [x] Service (OrdenHistorialService) sin HTTP; autz por rol server-side.
- [x] Repository (OrdenHistorialRepository + registrar-cambio-estado.ts) solo Prisma.
- [x] Interfaces en lib/interfaces/repositories y services.

Permisos / multi-pais
- [x] Drawer recibe datos por props via Server Action; no fetchea datos sensibles en cliente (R28).
- [x] Sin hardcode de pais/moneda.

Verificacion final
- [x] init.sh verde.
- [x] review_49.md con veredicto OK.
- [ ] Entrada en history.md — pendiente del leader al cerrar (no bloquea el review).

---

## 2. Trazabilidad R-n -> test (verificada, no vacia)

| R | Test | OK |
| --- | --- | --- |
| R1 | orden-historial-migration.test.ts (tabla/columnas/5 FKs/enum) | si |
| R2 | orden-historial-migration.test.ts (SIN updated_at/deleted_at) | si |
| R3 | orden-historial-migration.test.ts (ENABLE RLS sin CREATE POLICY) | si (estatico, patron del repo) |
| R4 | orden-historial-migration.test.ts (down inverso) + round-trip real | si |
| R5 | migration (idx orden_id,created_at) + repo (orderBy asc) | si |
| R6 | orden-historial-cobertura.test.ts (11 simbolos) + repo | si |
| R7 | orden-historial-atomicidad.test.ts (4 mecanismos a/b) | si |
| R8 | asignacion-satelite / recepcion-satelite / bulk / gestion / liberacion | si |
| R9 | orden-repository.bulk.test.ts (1 por creada; duplicadas sin rastro) | si |
| R10 | orden-repository.test.ts (creacion individual, origen null) | si |
| R11 | orden-repository.guia.test.ts (destino real por orden) | si |
| R12 | orden-repository.guia.test.ts (asignacion_bodega) | si |
| R13 | orden-repository.guia.test.ts (ruteo_satelite) | si |
| R14 | orden-repository.recepcion-satelite.test.ts (count 1; count 0 sin rastro) | si |
| R15 | orden-repository.asignacion-satelite.test.ts (solo ids del RETURNING) | si |
| R16 | gestion-orden-repository.test.ts (recoleccion solo ids retornados) | si |
| R17 | gestion-orden-repository.test.ts (4 resultados + gestionOrdenId) | si |
| R18 | liberacion-reprogramada-repository.test.ts (actor NULL, origen reprogramada) | si |
| R19 | orden-repository.test.ts (cambia estatus registra; otro campo no) | si |
| R20 | R10/R11/R13/R14/R17/R19 + update (igual->no registra) | si |
| R21 | liberacion (actor null) + bulk/creacion/gestion (actor=usuarioId) | si |
| R22 | gestion-orden (devuelta motivo; entregada motivo null) | si |
| R23 | orden-historial-types.test.ts (11, cerrado) + migration (enum) | si |
| R24 | repo (contarPorDestino) + service (contarIntentos N->N) | si |
| R25 | orden-historial-service.test.ts (0->0 / N->N / seed pendiente->0) | si |
| R26 | service (entradas asc) + repo (orderBy createdAt asc) | si |
| R27 | orden-historial-service.test.ts (matriz por rol) + UI Sheet/Apartado/RevisionMaestro | si |
| R28 | orden-historial-action.test.ts + Sheet (Server Action, no fetch cliente) | si |
| R29 | HistorialOrdenTimeline/Sheet + Apartado + e2e | si |
| R30 | HistorialOrdenTimeline.test.tsx (estatus-label, nunca UUID) | si |
| R31 | typecheck 0 / lint 0 / 2225 verdes | si |
| R32 | round-trip real, reproducido por el reviewer | si |
| R33 | orden-historial-cobertura.test.ts + suite completa verde | si |
| R34 | mapa completo en impl_49.md | si |

Ningun R sin test ni test-que-no-verifica-lo-que-dice.

---

## 3. LO CRITICO — Los 11 puntos de transicion atomicos (uno por uno)

Choke point unico: appendCambioEstado(tx, entradas) en lib/repositories/registrar-cambio-estado.ts.
Atomico = el append comparte la transaccion ($transaction) del cambio de estado.

| # | Metodo | Atomico | Solo transicionadas (R8) | Test |
| --- | --- | --- | --- | --- |
| 1 | OrdenRepository.createManyOrdenes | SI (tx, append L542) | SI diff before/after num_remision, solo INSERTADAS | bulk.test.ts |
| 2 | OrdenRepository.create | SI (tx, append L300, origen null) | N/A (1) | orden-repository.test.ts |
| 3 | OrdenRepository.generarGuiaLote | SI (append L738 en tx existente) | SI 1 por decision, origen pre-leido | guia.test.ts |
| 4 | OrdenRepository.asignarBodegaLote | SI (envuelto, append L764) | SI updateMany id-IN sin guarda => pre-leidas==actualizadas | guia.test.ts |
| 5 | OrdenRepository.rutearBodegaSateliteLote | SI (append L811 en tx existente) | SI update por id lanza si no existe => todas transicionan | guia.test.ts |
| 6 | OrdenRepository.recibirEnSatelite | SI (envuelto, append L917 si count===1) | SI count 0 no deja rastro | recepcion-satelite.test.ts |
| 7 | OrdenRepository.asignarSateliteLote (SQL CRUDO) | SI (queryRaw RETURNING id en tx, append L979) | SI solo ids del RETURNING | asignacion-satelite.test.ts |
| 8 | GestionOrdenRepository.recogerLote (SQL crudo) | SI (queryRaw RETURNING id en tx, append L169) | SI solo ids del RETURNING | gestion-orden-repository.test.ts |
| 9 | GestionOrdenRepository.crearGestionYTransicionar | SI (append L226 en tx existente + gestionOrdenId + motivo) | N/A (1) | gestion-orden-repository.test.ts |
| 10 | LiberacionReprogramadaRepository.liberarOrden | SI (envuelto, append L89 si count>0, actor NULL) | SI 2a corrida count 0 no duplica | liberacion-reprogramada-repository.test.ts |
| 11 | OrdenRepository.update | SI (envuelto, append L375 si estatusId cambia) | SI mismo estatus/otro campo no registra | orden-repository.test.ts |

Los 11: ATOMICOS y con TEST. Ninguna transicion sin su linea; ninguna linea fuera de la tx.

### Punto #7 (SQL crudo anti-TOCTOU)
- NOT EXISTS sobre cierre_dia (estado solicitado/vencido) CONSERVADO, junto con guarda estatus_id=origen + zona_id + deleted_at IS NULL.
- Unico cambio: executeRaw(count) -> queryRaw RETURNING id DENTRO de la transaccion. Retorno sigue siendo rows.length (mismo contrato).
- Append usa EXACTAMENTE los ids retornados: orden que pierde la guarda no aparece -> no deja rastro (R8). Test afirma RETURNING/NOT EXISTS/cierre_dia en el SQL y 1 sola fila cuando 1 de 2 gana.
- queryRaw con Prisma.join(ordenIds), valores como parametros (sin inyeccion).

### Test de cobertura (T5.2) — fallaria con un 12o call-site?
- Enumera los 11 simbolos y verifica que cada uno es metodo REAL (rompe ante RENAME) y que los 11 origen_tipo == enum fuente de verdad.
- LIMITE (por diseno 3.3): inventario ESTATICO. NO detecta automaticamente un 12o metodo nuevo que escriba estatus_id sin instrumentar; el diseno delega esa deteccion al reviewer.
- Lo verifique yo: grep de .orden.(update|updateMany|create|createMany|upsert) en TODO el repo -> los unicos writes de produccion estan en los 11 metodos; softDelete (deleted_at) y asignarMensajeroSugerido (mensajero_sugerido_id) NO tocan estado. Grep de estatus_id en services/actions/scripts -> los services solo pasan DTO a los repos; seed-zonas.ts y prisma/ no escriben estado. Conjunto de 11 CERRADO. NO hay 12o camino escapado.

---

## 4. Choke point, contador derivado, migracion, autz, UI, DTO

- Choke point (R6): appendCambioEstado es UN solo punto de append (funcion pura), reutilizado por los 3 repos. Append inmutable (createMany). Captura actor (nullable), origen_tipo, motivo, gestionOrdenId, created_at (default DB).
- Contador de intentos DERIVADO (R24/R25): contarIntentos = contarPorDestino(ordenId, devueltaId) sobre indice (orden_id, estatus_destino_id). SIN columna materializada. La regla 3-intentos->rechazo NO aparece (correcto: es de la feature 47).
- Migracion 20260713120000_orden_historial_estado: down.sql inverso exacto (DROP TABLE -> DROP TYPE), no toca preexistentes; RLS sin policies; indices (orden_id, created_at) y (orden_id, estatus_destino_id); FK actor ON DELETE SET NULL.
- Autz (R27) server-side en OrdenHistorialService.autorizar: maestro/admin todas; adminTienda su tienda (ajena -> not_found); mensajero asignada-ahora O actuada (existeActuacionDe); adminSatelite su zona (fuera/sin zona -> forbidden). Matriz completa en test.
- Desviacion aditiva OrdenDTO.mensajeroAsignadoId: CORRECTA. Id interno (no PII), ya expuesto en OrdenListItemDTO; sin migracion ni query extra. Necesario para autorizar a un mensajero recien asignado sin fila de historial propia. No filtra a roles indebidos: OrdenDTO fluye por servicios que autorizan y la UI se gatea doble (lista filtrada por rol + Server Action re-autoriza).
- UI: drawer Ver historial en listado plano y en los 5 apartados del maestro/admin; datos por props via Server Action (lazy import); timeline con estatus-label (R30, nunca UUID), actor->Sistema, motivo condicional; forbidden/not_found/unauthenticated manejados. Sin regresion: OrdenesApartado/OrdenesPage/OrdenesRevisionMaestro verdes; baseline 2140 -> 2225 (+85, 0 removidos/fallidos) => R33 sin regresion.

---

## 5. Resultado de init.sh (corrido por el reviewer)

    typecheck: 0 errores
    lint:      0 errores (135 warnings, todos preexistentes en .claude/skills/)
    test:      Test Files 249 passed (249) | Tests 2225 passed (2225)  (61.6s)
    migraciones: todas tienen down.sql
    == init OK ==

Coincide con la bitacora (2225). Sin regresion.

## 6. Round-trip de migracion (reproducido por el reviewer)

Postgres local ordenex@localhost:5432.
1. prisma migrate status -> up to date (35 migraciones)
2. pnpm db:rollback -> Rollback completado: 20260713120000_orden_historial_estado
3. prisma migrate status -> have not yet been applied: 20260713120000_orden_historial_estado (PENDIENTE)
4. prisma migrate deploy -> Applying ... successfully applied
5. prisma migrate status -> up to date

Round-trip REAL (up->down->up) confirmado; esquema queda consistente. R4/R32 verificados.

---

## 7. Hallazgos

Bloqueantes: NINGUNO.

Menores (deuda, no bloquean):
- (menor) T5.2 cobertura es inventario ESTATICO: rompe ante rename pero NO detecta un 12o call-site nuevo automaticamente (por diseno 3.3). Conviene un lint/AST-check que falle ante un .orden.update|create|updateMany o raw estatus_id fuera del inventario. Hoy: conjunto de 11 cerrado, verificado por grep.
- (menor) Test RLS (R3) es estatico (regex ENABLE RLS sin CREATE POLICY), no un acceso runtime con clave anonima. Patron establecido del repo (todas las *-migration.test.ts); enforcement real por Postgres.
- (menor) E2E historial-orden.spec.ts escrito pero DEFERIDO (no corre bajo pnpm test). Convencion del repo; flujo cubierto por unit/integration.

---

## Veredicto final: APROBADO

Los 11 puntos instrumentados con append atomico en la misma tx; anti-TOCTOU del #7 intacto y atado al RETURNING; choke point unico; contador derivado (sin materializar); migracion con RLS, indices y round-trip real verde; autz por rol server-side (4 roles); trazabilidad R1..R34 completa; init.sh verde (249 files / 2225 tests). Sin bloqueantes.

