# Segunda revisión — 458-C, 458-D y 458-E ya en `dev` (reviewer, 2026-09-26)

- **Árbol revisado:** `origin/dev` = `fa6f71a9` (desanclado; contiene `fa6f71a9`). Código idéntico a `02d8b864`
  (el merge de `dev` en `feature/458-E`): entre los dos solo cambian `docs/release.md`, `progress/contraste_458.md`
  y `progress/plan_pruebas_release.md`.
- **Base:** sin base propia. Lo que necesita Postgres se apoya en los gates con base (abajo) y en las mutaciones
  registradas por los implementers; lo que no necesita base lo corrí y lo muté yo.
- **Búsqueda:** no usé el MCP `codebase-memory` (no está en mi conjunto de herramientas en esta sesión; las tres
  bitácoras miden además que el índice no conoce las piezas de la 458). Todo con `grep` y lectura del archivo real.

## Veredicto: **APROBADA**

Los 5 bloqueantes originales (C-B1, C-B2, C-B3, D-B1, E-B1) y los 9 mayores (C-M1..M3, E-M1..M5) están
arreglados en el código de `dev`, con un test que falla sin el arreglo. Los que se pueden medir sin base los medí yo
con 14 mutaciones: **14/14 en rojo**, restauradas byte a byte y árbol limpio. Los que solo se ven en Postgres
tienen su test en verde en el gate con base del mismo código y su mutación en rojo en la bitácora.

**Queda abierto, sin ser bloqueante del código:**
1. **TE.7 / R104:** falta el recorrido COMPLETO por rol, parte del mayor M5 de la 458-E. La revisión final de la 458
   tampoco consta hecha en la app con los cuatro roles. Lo cubre el plan de pruebas de la release
   (`progress/plan_pruebas_release.md` §«La 458 completa», pasos 10–13), que hay que ejecutar antes de `prod`.
2. **El gate completo post-merge de `dev` está ROJO por flake** (`progress/gate_dev_final_458.log`, en el commit local
   `ea813dfc`, que no está en `origin/dev`): `INIT_EXIT=1`, 3 archivos con deadlock `40P01`
   (`liquidacion-reparto-migration`, `ranking-snapshot-migration` y `detalle-movimiento-cierre-postgres`), los 3 en
   verde 3/3 aislados (`progress/rerun_dev_final_458_aislado.log`). El mismo código dio `INIT_EXIT=0` en
   `progress/gate_458E_merge.log`. Es el modo de flake conocido; conviene repetir el gate completo antes de la
   release y no darlo por bueno con el aislado solo.

## Verificación ejecutada por mí (sobre `fa6f71a9`)

| Qué | Resultado |
| --- | --- |
| `pnpm install --frozen-lockfile` propio + `prisma generate` (URL ficticia) | `INSTALL_EXIT=0`, `PRISMA_EXIT=0` |
| `pnpm run typecheck` | `TC_EXIT=0` |
| `pnpm run lint` | `LINT_EXIT=0` (0 errores, 218 warnings previos) |
| `vitest run` sin `DATABASE_URL` | `VITEST_EXIT=0`: 2060 archivos verdes y 266 saltados (`integration/db` sin base, más Analítica); 29.909 tests verdes |
| `pnpm run build` | `BUILD_EXIT=0`, migraciones OMITIDAS (build local). Rutas presentes: `/wallet/tiendas/[tiendaId]`, `/wallet/mensajeros/[mensajeroId]`, `/wallet/satelites/[zonaId]` y `/mi-wallet` |
| Mutaciones sin base (arnés propio: patrón único, archivo cambiado, más de 0 tests corridos, restauración comprobada por sha256; línea base 8 archivos, 203/203 verdes) | **14/14 rojas**, árbol sin cambios al terminar |
| Gate con base del mismo código | `progress/gate_458E_merge.log`: `INIT_EXIT=0`, 2326/2326 archivos, 32.329 verdes, 26 saltados (Analítica). Corren y pasan `estado-cuenta-cierre-pagos-172r52` (6), `libro-caja-revision-458c` (8), `libro-caja-revision-458e` (6) y `estado-cuenta-pago-tienda-172r53` (4) |

## Hallazgos originales — 458-C (`progress/review_458-C.md`)

| # | ¿Cerrado? | Arreglo | Test | Cómo lo comprobé |
| --- | --- | --- | --- | --- |
| **B1** tests del diálogo sin sustituto | **Sí** | `components/shared/wallet/RegistrarMovimientoDialog.tsx:383-477`: `ya_registrado` es éxito en los 8 caminos; `sin_deuda`, `excede`, `sin_saldo` y `ya_hay_saldo_inicial` van bajo su campo | `tests/unit/components/wallet-registrar-movimiento-dialog.test.tsx:891-1098` (8 casos de R68, avisos y rechazos) | Los avisos son literales de contrato escritos a mano (p. ej. «Este pago ya estaba registrado, por ₡2.500…»), no la función que los genera. Mutaciones mías: `ya_registrado` fuera en gasto/sueldo: 2/57 rojos; abono sin el importe del servidor: 1/57; `sin_deuda` bajo el monto: 1/57; `ya_registrado` fuera en el pago al mensajero: 1/57 |
| **B2** la fila anulada no decía «Anulado» | **Sí** | `app/(app)/wallet/_components/WalletLedger.tsx:254` (insignia en la celda «Ver», `inline-flex` para que el tachado no la cruce) y `:219-221` (tachado); nombre accesible «… · Anulado» (`VerMovimientoCaja.tsx:137`) | `tests/components/WalletLedgerVer458C.test.tsx:323-339` (literal «Anulado» y el `aria-label` completo) y `:349` (tachado) | Sin la insignia: 3/48 rojos. Sin `line-through`: 5/48 rojos. La ayuda (`docs/ayuda/oficina/wallet-caja.md:62,73,346`) ya dice lo mismo que la pantalla |
| **B3** «Vigente» sin documento | **Sí** | `components/shared/wallet/DetalleMovimientoPanel.tsx:281-296` («—» sin estado); `lib/services/WalletService.ts:115-122`: el pago a una tienda y el premio llevan documento, con las MISMAS condiciones que `WalletAnulacionService.rutaDeCaja:106,115` (comparado rama a rama) | `WalletLedgerVer458C.test.tsx:341-382`; en Postgres, `tests/integration/db/libro-caja-revision-458c.test.ts:166-172` | Panel con `m.estado === null` forzado a «Vigente»: 6/48 rojos. Servidor: mutaciones B3-b/c/d en rojo (`progress/mutaciones_458-C_cierre.json`, 21/21) y el test en verde en el gate con base |
| **M1** R58/R63 en el panel | **Sí** | `lib/services/LibroCajaAutoriaService.ts` (`anulacion`, `como`); `AutoriaDeFilaDTO` gana `como` y `anulacion` | `WalletLedgerVer458C.test.tsx:384-469`; Postgres `libro-caja-revision-458c.test.ts:176-202` | Literales del panel («Anulado el 2026-09-25 por Carla Ruiz · …», «SINPE · referencia SINPE-77»). Del servidor: el gate con base y las mutaciones M1-c/d/e en rojo. El instante de registro pasó a la 458-E (E-B1, cerrado) |
| **M2** los dos conceptos nuevos no se probaron en la app | **Sí** | — | `progress/recorrido_458-C/recorrido.md:89-114` | Pago a una tienda registrado, visto y anulado (fila «Anulado» y tachada; panel con quién, cuándo, motivo y cómo); pago a un mensajero registrado; R7 = R8 = 0,00 en las 4 medidas. El pago al mensajero no se anuló en el navegador (menor n4) |
| **M3** fallo mudo y clave compartida | **Sí** | `RegistrarMovimientoDialog.tsx:257-270` (clave nueva al cambiar de concepto) y `:488-498` (aviso `role="alert"`, la misma clave al reintentar) | `wallet-registrar-movimiento-dialog.test.tsx:1102-1151` | Sin la clave nueva al cambiar de concepto: 1/57 rojo. Sin el aviso de fallo de red: 3/57 rojos |
| m1–m7 | Sí (m5 queda como estaba) | TC.0–TC.8 con `[x]`; entrada en `progress/history.md:5629`; m3 retirada (E-M4); m4 rotulado; m6 ayuda; m7 decisión (cierre de la 458-E) | — | Leído en el árbol |

## Hallazgos originales — 458-D (`progress/review_458-D.md`)

| # | ¿Cerrado? | Arreglo | Test | Cómo lo comprobé |
| --- | --- | --- | --- | --- |
| **B1** 172 R52: el filtro por cierre del mensajero perdía sus pagos | **Sí** | `lib/repositories/EstadoCuentaRepository.ts:121-130,205`: filas de `cierre_dia` = X, O filas de `pago_mensajero` cuyo `liquidacion_pago` tiene `cierre_id` = X y `mensajero_id` = la cuenta, sobre el `libro` ya acotado por `mensajero_id`; la tienda sin rama, con su porqué (`:95-108`). Selector: `FiltrosWalletRepository.ts:125-160` cuenta lo mismo. Cita de R52 repuntada (`specs/172-liquidacion/tasks.md:766`) | `tests/integration/db/estado-cuenta-cierre-pagos-172r52.test.ts:242-300`: pagos REALES escritos por `LiquidacionService.registrarPagoMensajero` y `anularPago`, más un pago de otro cierre y otro mensajero | Leí el SQL contra la semántica del desglose retirado (`PagoMensajeroMovimientoRepository.buildFiltrosWhere:106-122`): la misma, más la cuenta en la subconsulta. Test en verde en `gate_458E_merge.log` (6 tests). Mutaciones B1-M1..M4 en rojo (`progress/mutaciones_458-D_fix.json`, 13/13). No lo pude mutar yo: necesita Postgres |
| m1 resumen con la lectura inicial | **Sí** | `app/(app)/mi-wallet/_components/MiEstadoCuenta.tsx:110` pinta `vigente.resumen` | `tests/components/MiWalletResumenVigente.test.tsx:83-98` | Resumen vuelto a `inicial.resumen`: 1/41 rojo |
| m2 R53 citado a un doble | **Sí** | Cita repuntada (`specs/172-liquidacion/tasks.md:767`) | `tests/integration/db/estado-cuenta-pago-tienda-172r53.test.ts` (pago real) | En verde en el gate con base (4 tests). R53-M1/M2 en rojo en la bitácora |
| m3 R25 sin ratificar | **Sí** (decisión del leader) | «Anulado por Ordenex», día, hora CR y motivo, sin nombre: `mi-estado-cuenta-labels.ts:27-30` | `tests/integration/mi-wallet-page.test.tsx:274-292` | Sin «por Ordenex»: 2/41 rojos. El test siembra un nombre y exige que no aparezca ni en pantalla ni en la descarga |
| m4 ayuda que promete de más | Sí | `docs/ayuda/tienda/mi-wallet.md` | `tests/unit/asistente/contexto-458.test.ts` | Suite sin base en verde |
| m5 resumen no visto en el navegador | Sí | — | `progress/recorrido_458-D/` (fix-02) | Leído |
| m6 comentarios rancios, m7 `Ventana.cierreId` | Sí | 4 comentarios; `cierreId?: string` en el tipo | typecheck | `TC_EXIT=0` |

## Hallazgos originales — 458-E (`progress/review_458-E.md`)

| # | ¿Cerrado? | Arreglo | Test | Cómo lo comprobé |
| --- | --- | --- | --- | --- |
| **B1** R58: el instante de registro | **Sí** | `lib/services/LibroCajaAutoriaService.ts:220-225` (`registradoEl` = `created_at` en día y hora CR); `components/shared/wallet/DetalleMovimientoPanel.tsx:96-99,386` | `tests/components/DetalleMovimientoPanel.test.tsx:152-166` (literal «Ana Maestra · el 2026-09-26 a las 21:30»); Postgres `tests/integration/db/libro-caja-revision-458e.test.ts:174-180` (03:30Z del 27 pasa a ser el 26 a las 21:30) | Panel sin el instante: 2/34 rojos. Día y hora en UTC: B1-a/b en rojo en la bitácora, y el test en verde en el gate con base |
| **M1** guardia de la 173 débil | **Sí** | `tests/unit/guards/caja-173-alcance.guardia.test.ts:95-150`: `sum` sin distinguir mayúsculas ni espacios, todo FROM/JOIN = `"wallet_movimiento" w`, sin `.reduce/.add/.plus`, sin escrituras crudas, censo de imports; `agregarPorCategoria` suma en SQL (`WalletMovimientoRepository.ts:142`) | La misma guardia (5 contrapruebas + el caso real) | `sum (d."monto")` inyectado en el repositorio: 1/37 rojo. La guardia lee el fuente real, no una copia |
| **M2** anulado por nombre sin su contra-asiento | **Sí** | `lib/utils/anotacion-de-fila.ts` y su gemelo SQL `libro-caja-a-quien-sql.ts:159-174,262`, en el filtro, el selector y la columna | Postgres `libro-caja-revision-458e.test.ts` (M2: 4 filas, Entró = Salió = 100.250,00, ganancia 0,00) | Leí el SQL: solo hereda `ingreso_ajuste`/`egreso_ajuste` con `origen_id`, dentro de los orígenes `gasto`/`manual`; los reversos de pago, cobro y premio quedan fuera por el origen. En verde en el gate con base; M2-a..d en rojo en la bitácora |
| **M3** enlaces de «A quién» a rutas inexistentes | **Sí** | Las dos hijas están en `dev`; `libro-caja-labels.ts:52-55` produce `/wallet/tiendas/«id»` y `/wallet/mensajeros/«id»`, con el id del usuario (`LibroCajaAutoriaRepository`, `PERSONA`) | `tests/unit/wallet-libro-caja-enlaces-458e.test.ts` (resuelve el `href` contra el árbol del App Router y exige `verEstadoCuentaAction` del mismo tipo) | Tienda y mensajero cruzados: 3/3 rojos. Las rutas están en el manifiesto de MI build |
| **M4** deuda de la 458-C sin tratar | **Sí** | `reversarEgresoAdministrativoAction` RETIRADA (`lib/actions/wallet-egresos.ts:105`; sin llamadores en `app/`, `lib/` ni `components/`, comprobado con grep). m7 (inactivas): decisión escrita, sin código (R41 no obliga a ofrecerlas; se paga desde el estado de cuenta) | `tests/unit/actions/wallet-egresos-actions.test.ts:136-141` | Leído; M4-a en rojo en la bitácora |
| **M5** tasks sin marcar y TE.7 sin hacer | **Parcial** | TE.1–TE.6 `[x]` (`specs/458-rediseno-wallet/tasks.md`) | — | **TE.7 sigue `[ ]` (`tasks.md:365`):** falta el recorrido completo de §10 con los cuatro roles (R104). Ver «Queda abierto» |
| m1–m5 | m4 y m5 cerrados; m1–m3 aceptados | ayuda; regex de uuid dentro de cada celda | `contexto-458.test.ts`, `WalletDescarga.test.tsx` | Suite sin base en verde |

## Integración de las tres hijas (lo pedido por el leader)

| Punto | Estado | Evidencia |
| --- | --- | --- |
| Fila anulada: «Anulado» + tachado en el libro | OK | `WalletLedger.tsx:219-221,254`; test B2 + tachado en B3; mutaciones C-B2a (3 rojos) y C-B2b (5 rojos) |
| «Anulado por Ordenex» en `/mi-wallet` | OK | `mi-estado-cuenta-labels.ts:27-30`; `mi-wallet-page.test.tsx:274-292` exige además la fila tachada (`line-through`); mutación D-R25 (2 rojos) |
| Los enlaces de «A quién» abren los estados de cuenta | OK | `wallet-libro-caja-enlaces-458e.test.ts`; mutación E-M3 (3/3 rojos); rutas en el build |
| El filtro por cierre del mensajero trae sus pagos | OK (Postgres) | `estado-cuenta-cierre-pagos-172r52.test.ts` en verde en `gate_458E_merge.log`; B1-M1..M4 en rojo |
| El resumen de tres cifras sigue a la tarjeta | OK | `MiEstadoCuenta.tsx:110`; `MiWalletResumenVigente.test.tsx`; mutación D-m1 (1 rojo) |

## Hallazgos nuevos

### BLOQUEANTE
Ninguno.

### MAYOR
Ninguno.

### menor
- **n1 — Gate completo post-merge rojo por flake.** Detallado arriba (`gate_dev_final_458.log`, 3 deadlocks `40P01`,
  3/3 aislados en verde). Además, el commit que lo registra (`ea813dfc`) está en el `dev` local del checkout
  principal y NO en `origin/dev`: hay que empujarlo o rehacerlo, y repetir el gate completo antes de la release.
- **n2 — Comentario huérfano tras el merge.** `app/(app)/wallet/_components/WalletLedger.tsx:223-228`: el JSDoc de
  B2 («la fila anulada DICE «Anulado»…») quedó pegado encima de `autoriaParaElPanel` y no de `CeldaVer`. No cambia nada.
- **n3 — La oficina ve la anulación con menos detalle que la tienda.** Desde la 458-D la anulación trae `hora` y
  `/mi-wallet` la pinta; el panel «Ver» de la caja dice solo el día (`PANEL_TEXTO.anuladoDetalle(fecha, por, motivo)`),
  y los dobles de `WalletLedgerVer458C.test.tsx:394,458` no llevan `hora`. R58 se cumple (dice cuándo), pero la
  diferencia no está pactada.
- **n4 — M2 de la 458-C, a medias en el navegador:** el pago a un mensajero se registró pero no se anuló en la app
  (lo cubre la 205 en Postgres). Añadirlo al plan de pruebas de la release.
- **n5 — `progress/history.md` sin entradas de la 458-D ni de la 458-E** (sí las tienen la 458-A y la 458-C).
- **n6 — m7 de la 458-C (tiendas y mensajeros inactivos en el diálogo)** quedó como decisión técnica del
  implementer, no del humano. Es razonable (el camino existe desde el estado de cuenta), pero conviene ratificarla.

## Checklist (CHECKPOINTS.md / reviewer)

- [x] Trazabilidad de cada hallazgo a un test real que no compara contra su propia fuente (literales escritos a mano, oráculos independientes en Postgres).
- [x] Tasks TC.0–TC.8, TD.1–TD.10 y TE.1–TE.6 `[x]`. [ ] TE.7 abierta (R104).
- [x] typecheck, lint, tests sin base y build: verdes, medidos por mí.
- [~] Gate con base: verde sobre el mismo código (`gate_458E_merge.log`); el post-merge de `dev`, rojo por flake de deadlock (n1).
- [x] Sin migraciones ni tablas nuevas en C/D/E (RLS no aplica). Sin secretos. SQL parametrizado (`Prisma.sql`/`Prisma.join`).
- [x] Capas: SQL en `lib/repositories/`, el rol en el servicio antes de leer, y el diálogo y el panel solo llaman a Server Actions.
- [x] Dinero: ninguna mutación sobre cifras sobrevivió. El cuadre R22 del estado de cuenta se afirma en el servidor (revisión 458-D, sin cambios desde entonces).
