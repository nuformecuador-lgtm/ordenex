# 454 — Fase 0: caracterizacion del comportamiento de HOY (C01-C28)

> Rama `feature/454-fase0`, nacida de `05d0032c` (spec aprobado). Agente: backend_dev.
> Busqueda de codigo: el MCP `codebase-memory` NO estaba en el conjunto de herramientas de este
> agente; se uso `grep`/lectura directa de archivo (regla 7 de `CLAUDE.md`, dicho explicitamente).
> Todo test de esta fase corre contra la base LOCAL real (`localhost:5432`, `ordenex`), dentro de una
> transaccion que SIEMPRE se revierte (salvo C02 y C07-concurrente, que necesitan dos conexiones y
> limpian por id). Cero codigo de produccion cambiado: cada mutacion se aplico con `sed -i`, se
> ejecuto el test, y se revirtio con `git checkout -- <archivo>`, confirmando `git diff --stat -- lib app`
> vacio.

## T0.0 — Preparacion

- `git log --oneline -1` → `05d0032c chore(454): spec aprobado, en curso por la fase 0`;
  `git merge-base HEAD origin/dev` → `05d0032c`.
- `node_modules`: junction al del repo principal. `.env` copiado del repo principal (no impreso).
- `pnpm exec prisma migrate status` → `Datasource "db": PostgreSQL database "ordenex", schema "public"
  at "localhost:5432"` · `206 migrations found` · `Database schema is up to date!`. No hizo falta migrar
  la base local compartida (esta fase no trae migraciones), asi que no se toco `progress/current.md`.
- Suite de control: `pnpm exec vitest run tests/integration/db/cierre-sin-gestion-tope-sql-real.test.ts`
  → `Test Files 1 passed (1) · Tests 9 passed (9)`, sin `skipped`.

## T0.1 — Escenario compartido

`tests/integration/db/454/_escenario.ts`: `prepararMundo()` (catalogo + FKs, falla ruidosamente si
falta algo) y `conEscenario(mundo, fn)` (tx revertida + lock de escritura real + mundo propio: tienda
`adminTienda`, zona satelite con tarifa 1500/164, dos mensajeros, adminSatelite, maestro). Verbos
sobre servicios REALES: `gestionar`/`gestionarOk` (`MisAsignacionesService`), `solicitarCierre`
(`CierreDiaService`), `correrCorte` (`CorteDiarioService` con la seleccion real recortada a los
mensajeros del escenario), `aprobar` (`CierresAdminService.aprobarCierre`, confirmando exactamente lo
retornable), `rechazar`, `pedirAyuda`/`recuperar` (`SolicitudAyudaService`). Los tests que necesitan
mas verbos los montan sobre `e.s` / `e.cliente` en el propio archivo.

---

## Resumen

- **27 de 28 C CONFIRMADOS** (verde sobre el codigo de hoy + rojo con su mutacion + reversion comprobada).
- **C07 PARCIAL**: la mitad secuencial esta confirmada; la mitad CONCURRENTE es **FALLIDA como
  caracterizacion**: sobre el codigo de hoy el doble envio concurrente deja DOS gestiones en 10/10
  repeticiones (defecto real, R4 es comportamiento nuevo). Queda fijado como `it.fails` en `[INTERMEDIO]`.
- **C13**: la mutacion documentada en `tasks.md` SOBREVIVE (no cambia nada observable); se registraron dos
  mutaciones adaptadas, las dos en rojo.
- Hallazgo de C25 (queda en `[INTERMEDIO]`): hoy una orden en `ayuda_tienda` cae en el bucket `otros` del
  tablero, no en `enReparto`.
- Suite completa de los archivos nuevos, dos corridas: `Test Files 28 passed (28) · Tests 98 passed | 1
  expected fail (99)`, 0 skipped, `VITEST_EXIT=0`. Sin restos en la base compartida tras C02/C07 (0 usuarios,
  0 zonas, 0 ordenes con los prefijos del escenario).
- `git diff 05d0032c --stat -- lib app` → vacio.

## Mapa R → test (Fase 0)

| R | Test |
|---|---|
| R3, R4 | C07 `no-doble-gestion` (R4 concurrente: `it.fails`, defecto medido) |
| R6 | C13 `portal-listas-mapa-ruta` |
| R10 | C04 `tope-276` |
| R12 | C11 `dinero-aprobacion` |
| R13, R58 | C17 `cierre-rechazado` |
| R15-R17 | C21 `deshacer` |
| R18, R19 | C06 `correccion-69` |
| R21-R28 | C22 `ayuda-ciclo`; R22 tambien C08, C13; R28 C14 |
| R31, R40 | C27 `rastreo-y-historial-legado` |
| R33 | C26 `webhook-estado` |
| R35 | C20 `notificacion-n1` |
| R43 | C01 `corte-no-barre-gestionadas` |
| R44 | C02 `corte-concurrencia` |
| R45 | C03 `intentos-conteo` |
| R46 | C04 `tope-276` |
| R47 | C05 `sla-devolucion-reloj` |
| R48 | C19 `reprogramadas-liberacion` |
| R49 | C11 `dinero-aprobacion` |
| R50 | C09 `liberacion-por-cierre` |
| R51 | C10 `devolucion-rechazadas-139` |
| R52 | C08 `solicitar-cierre` |
| R53 | C12 `kpi-portal` |
| R54 | C14 `traspaso` |
| R55 | C15 `cambio-dia` |
| R57 | C16 `dos-gestiones-vivas` |
| R59 | C18 `multi-dia-271`; C09 |
| R60 | C23 `confirmacion-fisica-238` |
| R61, R64 | C24 `alcance-satelite-y-sf001` |
| R62 | C25 `tablero-dia` |
| R63 | C28 `rechazos-tienda-425` |
| R65 | NO cubierto en la Fase 0 (T1.16) |

Los requisitos del comportamiento NUEVO (R1, R2, R5, R7-R9, R11, R14, R20, R29, R30, R32, R34, R36-R39,
R41, R42, R56) no tienen caracterizacion posible sobre el codigo de hoy: su test nace en la Fase 1
(trazabilidad de `tasks.md`).

## Salida final (ejecutada)

- `pnpm exec tsc --noEmit` → `TSC_EXIT=0`.
- `pnpm exec eslint tests/integration/db/454` → `ESLINT_EXIT=0` (0 errores, 0 avisos).
- `pnpm exec vitest run tests/integration/db/454` → `Test Files 28 passed (28)` · `Tests 98 passed | 1
  expected fail (99)` · `VITEST_EXIT=0`. (La primera corrida conjunta dio `2 failed` por colision de nombres
  entre workers —`Unique constraint failed` en `zona.create`—: se añadio una parte aleatoria al sufijo del
  escenario y las dos corridas siguientes salieron limpias.)
- No se corrio `pnpm test` completo ni `./init.sh`: esta fase no toca codigo de produccion y el encargo pedia
  typecheck, lint y la suite de los archivos nuevos. El gate lo corre quien integre.

**Veredicto:** Fase 0 cerrada con 27/28 caracterizaciones confirmadas por mutacion y C07-concurrente
FALLIDA por un defecto real de hoy (dos gestiones en doble envio concurrente), documentado y fijado como
`it.fails`.

## Registro por test

Formato de cada bloque: archivo · comando · VERDE (sobre el codigo de hoy) · mutacion · ROJO · reversion.

### C01 — corte-no-barre-gestionadas (R43) · CONFIRMADO
- Archivo: `tests/integration/db/454/caracterizacion/corte-no-barre-gestionadas.test.ts`
- Comando: `pnpm exec vitest run tests/integration/db/454/caracterizacion/corte-no-barre-gestionadas.test.ts`
- VERDE: `Test Files 1 passed (1) · Tests 5 passed (5)` (0 skipped).
- Mutacion: `lib/repositories/CierreDiaRepository.ts:936` y `:964`, `estatusId: origenEstatusId,` →
  `// MUT454 estatusId: origenEstatusId,` (pre-SELECT y `updateMany` del corte sin guarda de estado).
- ROJO: `Tests 3 failed | 2 passed (5)` — «O1 y O2 (gestionadas) y O5 … NO se barren» →
  `AssertionError: expected 'sin_gestionar' not to be 'sin_gestionar'`; «el corte crea UN vencido y barre
  O3 y O4» → `expected [ …(4) ] to deeply equal [ …(2) ]`; «tras re-solicitar y aprobar» →
  `expected 'en_bodega_central' to be 'entregada'`.
- Reversion: `git checkout -- lib/repositories/CierreDiaRepository.ts`; `git diff --stat -- lib app` vacio.

### C02 — corte-concurrencia (R44) · CONFIRMADO
- Archivo: `tests/integration/db/454/caracterizacion/corte-concurrencia.test.ts` (dos conexiones,
  datos CONFIRMADOS y borrados por id en `afterAll`; comprobado despues: 0 usuarios/zonas residuales).
- Intercalado forzado: A (gestion por `MisAsignacionesService` dentro de su tx) se queda sin confirmar
  hasta que la sonda ve en `pg_stat_activity` al `UPDATE "public"."orden"` del corte esperando `Lock`.
  20 repeticiones; la precondicion «B espero al candado en las 20» es un `it` propio.
- Comando: `pnpm exec vitest run tests/integration/db/454/caracterizacion/corte-concurrencia.test.ts`
- VERDE: `Test Files 1 passed (1) · Tests 2 passed (2)` (0 skipped).
- Mutacion: `lib/repositories/CierreDiaRepository.ts:964` (solo el `updateMany` del corte),
  `estatusId: origenEstatusId,` → `// MUT454 estatusId: origenEstatusId,`.
- ROJO: `Tests 1 failed | 1 passed (2)` — «invariante: nunca a la vez gestion vigente de O Y fila
  `cierre_sin_gestion` de O» → `AssertionError: expected true to be false`.
- Reversion: `git checkout -- lib/repositories/CierreDiaRepository.ts`; `git diff --stat -- lib app` vacio.

### C03 — intentos-conteo (R45) · CONFIRMADO (dos mutaciones)
- Archivo: `tests/integration/db/454/caracterizacion/intentos-conteo.test.ts`
- Comando: `pnpm exec vitest run tests/integration/db/454/caracterizacion/intentos-conteo.test.ts`
- VERDE: `Test Files 1 passed (1) · Tests 2 passed (2)` (0 skipped).
- Mutacion (a): `lib/repositories/OrdenHistorialRepository.ts:214`, `historialEstados: {` →
  `historialEstados: undefined && {` (sin la 6.ª condicion). ROJO: `Tests 2 failed (2)` — «…cuentan solo
  la devuelta y la reprogramada aprobadas: 2» → `AssertionError: expected 3 to be 2`; «…pasa a contar: 3»
  → `expected 4 to be 3`. Revertida; `git diff --stat -- lib app` vacio.
- Mutacion (b): `lib/repositories/OrdenHistorialRepository.ts:209`, `cierre: { estado: "aprobado" },` →
  comentada. ROJO: `Tests 1 failed | 1 passed (2)` — «…cuentan solo … : 2» → `expected 3 to be 2`.
  Revertida; `git diff --stat -- lib app` vacio.

### C04 — tope-276 (R46, R10) · CONFIRMADO
- Archivo: `tests/integration/db/454/caracterizacion/tope-276.test.ts` (umbral leido de
  `reintentosConfig.MIN_INTENTOS_ENTREGA`, intentos pasados sembrados como fixture; corte, re-solicitud,
  aprobacion y cierre siguiente por los servicios reales).
- Comando: `pnpm exec vitest run tests/integration/db/454/caracterizacion/tope-276.test.ts`
- VERDE: `Test Files 1 passed (1) · Tests 5 passed (5)` (0 skipped).
- Mutacion: `lib/repositories/CierresAdminRepository.ts:1988`, `>= umbralIntentos` → `> umbralIntentos`.
- ROJO: `Tests 3 failed | 2 passed (5)` — «O en el tope: `por_devolver_a_tienda` en la MISMA aprobacion…» →
  `AssertionError: expected 'sin_gestionar' to be 'por_devolver_a_tienda'`; «…UNA gestion sintetica…» →
  `expected [] to have a length of 1 but got +0`; «el SIGUIENTE cierre…» → `expected { status: 'conflict', …(1) }
  to match object { status: 'ok', via: 'creado' }`.
- Reversion: `git checkout -- lib/repositories/CierresAdminRepository.ts`; `git diff --stat -- lib app` vacio.

### C05 — sla-devolucion-reloj (R47) · CONFIRMADO
- Archivo: `tests/integration/db/454/caracterizacion/sla-devolucion-reloj.test.ts` (causa
  `wrong_address`, ventana de `devolucionSlaConfig.DIAS_RECHAZO_AUTOMATICO`; t0 = gestion retrocedida
  20 h; t1 LEIDO de la fila `anclaje_devolucion`; cron = `DevolucionSlaService` real).
- Comando: `pnpm exec vitest run tests/integration/db/454/caracterizacion/sla-devolucion-reloj.test.ts`
- VERDE: `Test Files 1 passed (1) · Tests 5 passed (5)` (0 skipped).
- Mutacion: `lib/repositories/DevolucionSlaRepository.ts:42` (`PROYECCION_ANCLAJE_DEVOLUCION`),
  `where: { origenTipo: ORIGEN_ANCLAJE },` → `where: { origenTipo: "creacion_manual" },` (sin fila de ancla,
  el cron cae a `gestion.createdAt`).
- ROJO: `Tests 1 failed | 4 passed (5)` — «el cron a t1 + ventana − 1 min NO escala» →
  `AssertionError: expected 'rechazada' to be 'devuelta'`.
- Reversion: `git checkout -- lib/repositories/DevolucionSlaRepository.ts`; `git diff --stat -- lib app` vacio.

### C06 — correccion-69 (R18, R19) · CONFIRMADO
- Archivo: `tests/integration/db/454/caracterizacion/correccion-69.test.ts` (mensajero de la zona
  central; tarifa por defecto de la central fijada en la tx a 1500/164; correccion y aprobacion por el
  maestro con `CierresAdminService`).
- Comando: `pnpm exec vitest run tests/integration/db/454/caracterizacion/correccion-69.test.ts`
- VERDE: `Test Files 1 passed (1) · Tests 6 passed (6)` (0 skipped).
- Mutacion: `lib/repositories/CierresAdminRepository.ts:1668`, `await tx.gestionOrdenPago.deleteMany(…)` →
  `if (false) await tx.gestionOrdenPago.deleteMany(…)`.
- ROJO: `Tests 1 failed | 5 passed (6)` — «la gestion queda sellada `rechazada` … y su desglose BORRADO» →
  `AssertionError: expected 1 to be +0`.
- Reversion: `git checkout -- lib/repositories/CierresAdminRepository.ts`; `git diff --stat -- lib app` vacio.

### C07 — no-doble-gestion (R3, R4) · PARCIAL: secuencial CONFIRMADO, concurrente FALLIDO (defecto de hoy)
- Archivo: `tests/integration/db/454/caracterizacion/no-doble-gestion.test.ts`
- Comando: `pnpm exec vitest run tests/integration/db/454/caracterizacion/no-doble-gestion.test.ts`
- VERDE: `Test Files 1 passed (1) · Tests 1 passed | 1 expected fail (2)` (0 skipped); repetido 3 veces igual.
- **Secuencial (invariante)**: gestionar O y volver a gestionarla → la 2.ª `conflict`, 1 fila.
  Mutacion: `lib/services/MisAsignacionesService.ts:768`, `if (orden.estatusValue !== ORIGEN_GESTION) {` →
  `if (false && orden.estatusValue !== ORIGEN_GESTION) {`. ROJO: `Tests 1 failed | 1 expected fail (2)` —
  «secuencial: la segunda gestion … es `conflict` y queda UNA fila» → `AssertionError: expected 'ok' to be
  'conflict'`. Revertida; `git diff --stat -- lib app` vacio. (Nota honesta: la PRIMERA corrida con la
  mutacion cayo en `beforeAll` con `Tests 2 skipped`; se repitio y dio el rojo por asercion de arriba.
  El rojo que cuenta es el de la asercion.)
- **Concurrente — FALLIDO como caracterizacion verde**: medido sobre el codigo de hoy, el doble envio
  concurrente (`Promise.all`, dos conexiones, datos confirmados y borrados por id) deja **DOS gestiones en
  10 de 10 repeticiones, las dos respuestas `ok`** (`expected [ '2:ok,ok', … ] to deeply equal []`).
  Causa: `GestionOrdenRepository.crearGestionYTransicionar` hace `orden.update` por PK sin re-comprobar el
  estado de origen. No existe verde que fijar: R4 es comportamiento NUEVO. Se deja como
  `it.fails` dentro de `[INTERMEDIO] defecto medido hoy que R4 cambia` (verde mientras el defecto exista;
  T1.4 lo pondra rojo y lo convertira en `it` normal con nota fechada). Sin mutacion posible.

### C08 — solicitar-cierre (R52) · CONFIRMADO
- Archivo: `tests/integration/db/454/caracterizacion/solicitar-cierre.test.ts`
- Comando: `pnpm exec vitest run tests/integration/db/454/caracterizacion/solicitar-cierre.test.ts`
- VERDE: `Test Files 1 passed (1) · Tests 4 passed (4)` (0 skipped).
- Mutacion: `lib/services/CierreDiaService.ts:68`, `["por_recoger", "en_reparto", "ayuda_tienda"]` →
  `["por_recoger", "ayuda_tienda"]`.
- ROJO: `Tests 1 failed | 3 passed (4)` — «una orden en mano -> bloqueado (`conflict`)» →
  `AssertionError: expected 'ok' to be 'conflict'`.
- Reversion: `git checkout -- lib/services/CierreDiaService.ts`; `git diff --stat -- lib app` vacio.

### C09 — liberacion-por-cierre (R50, R59) · CONFIRMADO
- Archivo: `tests/integration/db/454/caracterizacion/liberacion-por-cierre.test.ts` (dos cortes REALES en
  noches consecutivas crean C1 y C2 `vencido`).
- Comando: `pnpm exec vitest run tests/integration/db/454/caracterizacion/liberacion-por-cierre.test.ts`
- VERDE: `Test Files 1 passed (1) · Tests 3 passed (3)` (0 skipped).
- Mutacion: `lib/repositories/CierresAdminRepository.ts:1947`, la linea
  `...(barridasDeEsteCierre === null ? {} : { id: { in: barridasDeEsteCierre } }),` comentada.
- ROJO: `Tests 1 failed | 2 passed (3)` — «C, barrida por C2, sigue `sin_gestionar` con su mensajero» →
  `AssertionError: expected 'en_bodega_central' to be 'sin_gestionar'`.
- Reversion: `git checkout -- lib/repositories/CierresAdminRepository.ts`; `git diff --stat -- lib app` vacio.

### C10 — devolucion-rechazadas-139 (R51) · CONFIRMADO
- Archivo: `tests/integration/db/454/caracterizacion/devolucion-rechazadas-139.test.ts` (rechazada de
  calle por el portal; rechazo de escritorio por `GestionOrdenRepository.rechazarDesdeDevuelta`; escalado
  por `DevolucionSlaRepository.escalarDevueltaSla`; solicitud y aprobacion por servicios).
- Comando: `pnpm exec vitest run tests/integration/db/454/caracterizacion/devolucion-rechazadas-139.test.ts`
- VERDE: `Test Files 1 passed (1) · Tests 2 passed (2)` (0 skipped).
- Mutacion: `lib/repositories/CierresAdminRepository.ts:2111`, `if (devolucionRechazadas) {` →
  `if (false && devolucionRechazadas) {` (bloque 139 apagado).
- ROJO: `Tests 1 failed | 1 passed (2)` — «aprobar C1 lleva las tres a `por_devolver_a_tienda`…» →
  `AssertionError: expected { calle: 'rechazada', …(2) } to deeply equal { Object (calle, escritorio, ...) }`.
- Reversion: `git checkout -- lib/repositories/CierresAdminRepository.ts`; `git diff --stat -- lib app` vacio.

### C11 — dinero-aprobacion (R49, R12) · CONFIRMADO
- Archivo: `tests/integration/db/454/caracterizacion/dinero-aprobacion.test.ts` (tarifa propia de la
  tienda creada en la tx; cinco resultados; indemnizacion 3 000; libros REALES). Los 18 movimientos y los
  6 totales son literales, fijados con lo que produce el codigo de hoy.
- Comando: `pnpm exec vitest run tests/integration/db/454/caracterizacion/dinero-aprobacion.test.ts`
- VERDE: `Test Files 1 passed (1) · Tests 3 passed (3)` (0 skipped).
- Mutacion: `lib/repositories/CierresAdminRepository.ts:1847`, `const acreditoCod = movsTienda.some(` →
  `const acreditoCod = false && movsTienda.some(` (feed 173 apagado).
- ROJO: `Tests 1 failed | 2 passed (3)` — «los movimientos de los cinco feeds, con importes exactos» →
  `AssertionError: expected [ …(17) ] to deeply equal [ …(18) ]`.
- Reversion: `git checkout -- lib/repositories/CierresAdminRepository.ts`; `git diff --stat -- lib app` vacio.

### C12 — kpi-portal (R53) · CONFIRMADO
- Archivo: `tests/integration/db/454/caracterizacion/kpi-portal.test.ts`
- Comando: `pnpm exec vitest run tests/integration/db/454/caracterizacion/kpi-portal.test.ts`
- VERDE: `Test Files 1 passed (1) · Tests 4 passed (4)` (0 skipped).
- Mutacion: `lib/services/MisAsignacionesService.ts:378`, `totalACobrar: codEnReparto + montoGestionadas,` →
  `totalACobrar: codEnReparto + 0 * montoGestionadas,`.
- ROJO: `Tests 1 failed | 3 passed (4)` — «totalACobrar = 31 000 …» → `AssertionError: expected 9000 to be 31000`.
- Reversion: `git checkout -- lib/services/MisAsignacionesService.ts`; `git diff --stat -- lib app` vacio.

### C13 — portal-listas-mapa-ruta (R6, R22) · CONFIRMADO con mutacion ADAPTADA (la documentada sobrevive)
- Archivo: `tests/integration/db/454/caracterizacion/portal-listas-mapa-ruta.test.ts` (ruta optimizada
  sembrada con M y A como paradas).
- Comando: `pnpm exec vitest run tests/integration/db/454/caracterizacion/portal-listas-mapa-ruta.test.ts`
- VERDE: `Test Files 1 passed (1) · Tests 3 passed (3)` (0 skipped).
- Mutacion DOCUMENTADA en tasks.md («añadir `entregada` a los estados de `findMisAsignaciones`»,
  `MisAsignacionesService.ts:259`): **SOBREVIVE** — `Tests 3 passed (3)`. Motivo: el servicio vuelve a
  cortar la lista por `estatusValue` en el bucle (`:314-323`) y una fila `entregada` no cae en ningun
  grupo. No es un test debil: esa mutacion no cambia nada observable. Se sustituye por dos adaptadas:
- Mutacion adaptada (a): la documentada + `:317` `} else if (row.estatusValue === ESTADO_EN_REPARTO) {` →
  `… === ESTADO_EN_REPARTO || row.estatusValue === "entregada") {`. ROJO: `Tests 1 failed | 2 passed (3)` —
  «`porGestionar` (y el mapa…) es SOLO la orden en mano» → `AssertionError: expected [ { …(2) }, { …(2) } ]
  to deeply equal [ { …(2) } ]`. Revertida; `git diff --stat -- lib app` vacio.
- Mutacion adaptada (b): `lib/repositories/OrdenRepository.ts:3235` (`findParadasEnReparto`),
  `estatus: { value: ESTATUS_EN_REPARTO },` → `estatus: { value: { in: [ESTATUS_EN_REPARTO, "entregada"] } },`.
  ROJO: `Tests 1 failed | 2 passed (3)` — «las paradas de la ruta … son SOLO la orden en mano» →
  `AssertionError: expected [ …(2) ] to deeply equal [ Array(1) ]`. Revertida; `git diff --stat -- lib app` vacio.

### C14 — traspaso (R54, R28) · CONFIRMADO
- Archivo: `tests/integration/db/454/caracterizacion/traspaso.test.ts` (`TraspasoMensajeroService` real,
  maestro; destino = segundo mensajero de la zona con vehiculo asignado en la tx).
- Comando: `pnpm exec vitest run tests/integration/db/454/caracterizacion/traspaso.test.ts`
- VERDE: `Test Files 1 passed (1) · Tests 3 passed (3)` (0 skipped).
- Mutacion: `lib/services/TraspasoMensajeroService.ts:73`, `["en_reparto", "ayuda_tienda"]` →
  `["en_reparto", "ayuda_tienda", "entregada"]`.
- ROJO: `Tests 1 failed | 2 passed (3)` — «una orden gestionada NO es traspasable (`conflict`)…» →
  `AssertionError: expected 'ok' to be 'conflict'`.
- Reversion: `git checkout -- lib/services/TraspasoMensajeroService.ts`; `git diff --stat -- lib app` vacio.

### C15 — cambio-dia (R55) · CONFIRMADO
- Archivo: `tests/integration/db/454/caracterizacion/cambio-dia.test.ts` (`CorreccionDiaRepartoService` real).
- Comando: `pnpm exec vitest run tests/integration/db/454/caracterizacion/cambio-dia.test.ts`
- VERDE: `Test Files 1 passed (1) · Tests 2 passed (2)` (0 skipped).
- Mutacion: `lib/services/CorreccionDiaRepartoService.ts:56`, `["por_recoger", "en_reparto", "ayuda_tienda"]`
  → `[…, "entregada"]`.
- ROJO: `Tests 1 failed | 1 passed (2)` — «la orden gestionada NO admite el cambio de dia…» →
  `AssertionError: expected 'ok' to be 'conflict'`.
- Reversion: `git checkout -- lib/services/CorreccionDiaRepartoService.ts`; `git diff --stat -- lib app` vacio.

### C16 — dos-gestiones-vivas (R57) · CONFIRMADO
- Archivo: `tests/integration/db/454/caracterizacion/dos-gestiones-vivas.test.ts` (fixture SQL: la orden
  vuelve a `en_reparto` sin anular g1; las dos gestiones y los dos cierres, por servicios reales).
- Comando: `pnpm exec vitest run tests/integration/db/454/caracterizacion/dos-gestiones-vivas.test.ts`
- VERDE: `Test Files 1 passed (1) · Tests 4 passed (4)` (0 skipped).
- Mutacion: `lib/repositories/CierresAdminRepository.ts:2281`, `(g) => masRecientePorOrden.get(g.ordenId) === g.id,`
  → `(g) => true || masRecientePorOrden.get(g.ordenId) === g.id,`.
- ROJO: `Tests 3 failed | 1 passed (4)` — «aprobar el cierre de la gestion VIEJA no mueve la orden…» →
  `AssertionError: expected 1 to be +0`; «…MAS RECIENTE … anclada a ESA gestion» →
  `expected [ Array(1) ] to deeply equal [ Array(1) ]`.
- Reversion: `git checkout -- lib/repositories/CierresAdminRepository.ts`; `git diff --stat -- lib app` vacio.

### C17 — cierre-rechazado (R13, R58) · CONFIRMADO
- Archivo: `tests/integration/db/454/caracterizacion/cierre-rechazado.test.ts`
- Comando: `pnpm exec vitest run tests/integration/db/454/caracterizacion/cierre-rechazado.test.ts`
- VERDE: `Test Files 1 passed (1) · Tests 4 passed (4)` (0 skipped).
- Mutacion: `lib/repositories/CierresAdminRepository.ts:1795`, `if (res.count === 1 && nuevoEstado === "aprobado") {`
  → `if (res.count === 1) {`.
- ROJO: `Tests 1 failed | 3 passed (4)` — «rechazar no mueve dinero ni cambia el estado de ninguna orden» →
  `AssertionError: expected 5 to be +0`.
- Reversion: `git checkout -- lib/repositories/CierresAdminRepository.ts`; `git diff --stat -- lib app` vacio.

### C18 — multi-dia-271 (R59) · CONFIRMADO
- Archivo: `tests/integration/db/454/caracterizacion/multi-dia-271.test.ts` (corte real crea C1 `vencido` con
  g1 y A; el mensajero lo re-solicita, trabaja y solicita C2 — la unica via real para tener C1 y C2
  aprobables a la vez, porque `ESTADOS_RESOLUBLES = ["solicitado"]`).
- Comando: `pnpm exec vitest run tests/integration/db/454/caracterizacion/multi-dia-271.test.ts`
- VERDE: `Test Files 1 passed (1) · Tests 3 passed (3)` (0 skipped).
- Mutacion (la misma de C09): `lib/repositories/CierresAdminRepository.ts:1947`, la linea
  `...(barridasDeEsteCierre === null ? {} : { id: { in: barridasDeEsteCierre } }),` comentada.
- ROJO: `Tests 1 failed | 2 passed (3)` — «aprobar C2 no toca A … ni g1 …» →
  `AssertionError: expected 'en_bodega_central' to be 'sin_gestionar'`.
- Reversion: `git checkout -- lib/repositories/CierresAdminRepository.ts`; `git diff --stat -- lib app` vacio.

### C19 — reprogramadas-liberacion (R48) · CONFIRMADO
- Archivo: `tests/integration/db/454/caracterizacion/reprogramadas-liberacion.test.ts` (timbre cableado como
  en el composition root: `liberarAlAprobarCierreCon(LiberacionReprogramadaService real)`; reloj =
  `ejecutarLiberacion(dia siguiente)`).
- Comando: `pnpm exec vitest run tests/integration/db/454/caracterizacion/reprogramadas-liberacion.test.ts`
- VERDE: `Test Files 1 passed (1) · Tests 3 passed (3)` (0 skipped).
- Mutacion: `lib/repositories/LiberacionReprogramadaRepository.ts:180`,
  `if (fecha === null || fecha.getTime() > hoyCR.getTime()) continue;` → `if (fecha === null) continue;`.
- ROJO: `Tests 1 failed | 2 passed (3)` — «el timbre NO libera la reprogramada para MAÑANA» →
  `AssertionError: expected 'en_bodega_central' to be 'reprogramada'`.
- Reversion: `git checkout -- lib/repositories/LiberacionReprogramadaRepository.ts`; `git diff --stat -- lib app` vacio.

### C20 — notificacion-n1 (R35) · CONFIRMADO
- Archivo: `tests/integration/db/454/caracterizacion/notificacion-n1.test.ts` (rechazo de la tienda desde ayuda
  por `GestionDesdeAyudaService` real).
- Comando: `pnpm exec vitest run tests/integration/db/454/caracterizacion/notificacion-n1.test.ts`
- VERDE: `Test Files 1 passed (1) · Tests 3 passed (3)` (0 skipped).
- Mutacion: `lib/notificaciones/emitir.ts:205`, `const ORIGEN_RECHAZO_DEL_DESTINATARIO = "gestion";` → `= "x";`.
- ROJO: `2 failed` de 3 — «la rechazada del MENSAJERO emite 4 filas…» → `AssertionError: expected [] to
  deeply equal [ …(4) ]`; «aprobar el cierre no emite filas nuevas» → `expected [] to have a length of 4
  but got +0`.
- Reversion: `git checkout -- lib/notificaciones/emitir.ts`; `git diff --stat -- lib app` vacio.

### C21 — deshacer (R15-R17) · CONFIRMADO
- Archivo: `tests/integration/db/454/caracterizacion/deshacer.test.ts` (`CierreDiaService.deshacerGestion` real).
- Comando: `pnpm exec vitest run tests/integration/db/454/caracterizacion/deshacer.test.ts`
- VERDE: `Test Files 1 passed (1) · Tests 5 passed (5)` (0 skipped).
- Mutacion: `lib/repositories/CierreDiaRepository.ts:543` (`gestionesDelCierreWhere`), `anuladaAt: null,` comentada.
- ROJO: `Tests 1 failed | 4 passed (5)` — «el cierre solicitado despues NO vincula la gestion anulada…» →
  `AssertionError: expected 'e5c66f40-…' to be null`.
- Reversion: `git checkout -- lib/repositories/CierreDiaRepository.ts`; `git diff --stat -- lib app` vacio.

### C22 — ayuda-ciclo (R21-R28) · CONFIRMADO
- Archivo: `tests/integration/db/454/caracterizacion/ayuda-ciclo.test.ts` (servicios reales: `SolicitudAyudaService`,
  `NovedadesService`, `OrdenNotaService`, `HabilitarNovedadService`, `ApiHabilitacionService` ramas A y B,
  `GestionDesdeAyudaService`, corte).
- Comando: `pnpm exec vitest run tests/integration/db/454/caracterizacion/ayuda-ciclo.test.ts`
- VERDE: `Test Files 1 passed (1) · Tests 7 passed (7)` (0 skipped).
- Mutacion: `lib/types/novedad-grupo.ts:65` (`ESTATUS_POR_GRUPO`), `ayuda: "ayuda_tienda",` → `ayuda: "en_reparto",`.
  (Nota honesta: el primer intento apunto a la linea 64 por error, el `sed` no cambio nada —`git diff` vacio— y
  el test salio verde; se repitio sobre la linea correcta. Un segundo intento lanzaba en `beforeAll`
  —`solicitarCierreOk`— y dejaba `7 skipped`; se cambio el test para que ese paso sea una ASERCION
  (`expect(r.solicitud).toBe("ok")`) y no un `throw`, y se repitio.)
- ROJO: `Tests 3 failed | 4 passed (7)` — «pedir ayuda la pone en la pestaña de ayuda de la tienda DUEÑA…» →
  `AssertionError: expected [] to include '0eeb8f69-…'`; «Recuperar, Habilitar y la API (rama A)…» →
  `expected [ 'error:', …(1) ] to deeply equal [ 'habilitada:en_reparto', …(1) ]`; «la reprogramacion de la
  tienda…» → `expected 'conflict' to be 'ok'`.
- Reversion: `git checkout -- lib/types/novedad-grupo.ts`; `git diff --stat -- lib app` vacio.
- R65 (aviso diario): NO cubierto aqui; el aviso agregado queda para `AvisoAgregadoRepository.ayuda.test.ts` (T1.16).

### C23 — confirmacion-fisica-238 (R60) · CONFIRMADO
- Archivo: `tests/integration/db/454/caracterizacion/confirmacion-fisica-238.test.ts` (servicio para «exige y
  marca exactamente»; repositorio con `clienteConSavepoint` para la guarda del `WHERE`, que desde el servicio
  es inalcanzable porque `validarConfirmacionFisica` rechaza antes cualquier incidente).
- Comando: `pnpm exec vitest run tests/integration/db/454/caracterizacion/confirmacion-fisica-238.test.ts`
- VERDE: `Test Files 1 passed (1) · Tests 3 passed (3)` (0 skipped).
- Mutacion: `lib/repositories/CierresAdminRepository.ts:2196`, `resultado: { in: [...RESULTADOS_QUE_VUELVEN] },`
  comentada.
- ROJO: `Tests 1 failed | 2 passed (3)` — «el repositorio, si le llega un incidente en la confirmacion, falla
  cerrado y no marca nada» → `AssertionError: expected false to be true`.
- Reversion: `git checkout -- lib/repositories/CierresAdminRepository.ts`; `git diff --stat -- lib app` vacio.

### C24 — alcance-satelite-y-sf001 (R61, R64) · CONFIRMADO
- Archivo: `tests/integration/db/454/caracterizacion/alcance-satelite-y-sf001.test.ts` (cierre de bodega por
  `CierreBodegaService.solicitarCierreBodega` real).
- Comando: `pnpm exec vitest run tests/integration/db/454/caracterizacion/alcance-satelite-y-sf001.test.ts`
- VERDE: `Test Files 1 passed (1) · Tests 3 passed (3)` (0 skipped).
- Mutacion: `lib/repositories/CierresAdminRepository.ts:560` (`alcanceWhere`), `return {` →
  `return {} as never; return {` (ignora el alcance).
- ROJO: 2 de 3 — «el adminSatelite NO puede aprobar un cierre de la central» → `AssertionError: expected 'ok'
  to be 'no_encontrada'`; «…aprueba el de su zona con los MISMOS desenlaces…» → `expected 'conflict' to be 'ok'`.
- Reversion: `git checkout -- lib/repositories/CierresAdminRepository.ts`; `git diff --stat -- lib app` vacio.

### C25 — tablero-dia (R62) · CONFIRMADO
- Archivo: `tests/integration/db/454/caracterizacion/tablero-dia.test.ts` (`TableroDiaRepository.contarPorMensajero`
  real, ventana del dia en curso, alcance global, fila del mensajero del escenario).
- Hallazgo medido (queda en `[INTERMEDIO]`): hoy una orden en `ayuda_tienda` sin resultado cae en el bucket
  `otros`, no en `enReparto` (`asignadas 8 · enReparto 1 · otros 1 · sinRecoger 1`); con la 454 pasara a
  `enReparto`.
- Comando: `pnpm exec vitest run tests/integration/db/454/caracterizacion/tablero-dia.test.ts`
- VERDE: `Test Files 1 passed (1) · Tests 3 passed (3)` (0 skipped).
- Mutacion: `lib/repositories/TableroDiaRepository.ts:284`, `WHERE r.resultado = ${resultado}::"gestion_resultado"`
  → `WHERE a.estatus = ${resultado}` (el contador pasa a salir del estado de la orden).
- ROJO: `Tests 1 failed | 2 passed (3)` — «los contadores por RESULTADO del dia…» → `AssertionError: expected
  { asignadas: 8, entregadas: 1, …(7) } to match object { asignadas: 8, entregadas: 1, …(4) }` (la
  `devuelta` esta en `devolucion_por_confirmar`).
- Reversion: `git checkout -- lib/repositories/TableroDiaRepository.ts`; `git diff --stat -- lib app` vacio.

### C26 — webhook-estado (R33) · CONFIRMADO
- Archivo: `tests/integration/db/454/caracterizacion/webhook-estado.test.ts` (suscripcion activa creada en la tx;
  se cuentan los jobs `webhook_estado` de la orden).
- Comando: `pnpm exec vitest run tests/integration/db/454/caracterizacion/webhook-estado.test.ts`
- VERDE: `Test Files 1 passed (1) · Tests 3 passed (3)` (0 skipped).
- Mutacion: `lib/types/webhook-eventos.ts:96` (`EVENTOS_PUBLICOS`), `"entregada",` comentada.
- ROJO: 3 de 3 — «tras gestionar y aprobar hay exactamente UN `orden.estado_actualizado`…» →
  `AssertionError: expected [] to have a length of 1 but got +0` (y los otros dos, sin job que leer).
- Reversion: `git checkout -- lib/types/webhook-eventos.ts`; `git diff --stat -- lib app` vacio.

### C27 — rastreo-y-historial-legado (R31, R40) · CONFIRMADO
- Archivo: `tests/integration/db/454/caracterizacion/rastreo-y-historial-legado.test.ts` (`RastreoPublicoService`
  real; filas historicas de fixture con destino `devolucion_por_confirmar` y `ayuda_tienda`).
- Comando: `pnpm exec vitest run tests/integration/db/454/caracterizacion/rastreo-y-historial-legado.test.ts`
- VERDE: `Test Files 1 passed (1) · Tests 4 passed (4)` (0 skipped).
- Mutacion: `lib/types/rastreo-publico.ts:100` (`HITO_POR_ESTATUS`), `devolucion_por_confirmar: "no_entregado",`
  → `devolucion_por_confirmar: "entregado",`.
- ROJO: `Tests 1 failed | 3 passed (4)` — «una fila historica con destino `devolucion_por_confirmar` se lee
  `no_entregado`» → `AssertionError: expected [ 'en_bodega', 'entregado' ] to deeply equal [ 'en_bodega',
  'no_entregado' ]`.
- Reversion: `git checkout -- lib/types/rastreo-publico.ts`; `git diff --stat -- lib app` vacio.

### C28 — rechazos-tienda-425 (R63) · CONFIRMADO
- Archivo: `tests/integration/db/454/caracterizacion/rechazos-tienda-425.test.ts` (rechazo real por
  `rechazarDesdeDevuelta` + fila cruzada de fixture que aisla el segundo cerrojo, patron de
  `cierre-rechazo-tienda-sql-real.test.ts`).
- Comando: `pnpm exec vitest run tests/integration/db/454/caracterizacion/rechazos-tienda-425.test.ts`
- VERDE: `Test Files 1 passed (1) · Tests 3 passed (3)` (0 skipped).
- Mutacion: `lib/repositories/CierreDiaRepository.ts:582`, `historialEstados: { some: { origenTipo: "rechazo_tienda" } },`
  comentada.
- ROJO: `Tests 1 failed | 2 passed (3)` — «una `rechazada` suelta de OTRA familia no se incorpora (segundo
  cerrojo)» → `AssertionError: expected [ …(2) ] to deeply equal [ Array(1) ]`.
- Reversion: `git checkout -- lib/repositories/CierreDiaRepository.ts`; `git diff --stat -- lib app` vacio.
