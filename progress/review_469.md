# Ficha 469 — Revisión (buscar una guía o remisión en el libro de la wallet)

Revisor: reviewer, 2026-10-02. Rama revisada `origin/feature/469-wallet-buscar-guia` @ `4b938a5a`
(9 commits sobre `f32f7ed6`), en el worktree propio (`review469`).

> Grafo `codebase-memory`: no se usó. La revisión se hizo con el diff, `grep` y la lectura de los
> archivos. No cambia ningún símbolo con nombre que hubiera que localizar fuera del diff.

## Veredicto

**RECHAZADA.** 1 bloqueante (B1: modo oscuro del bloque «Guía buscada» y de la fila resaltada) y 5
menores. Lo demás está bien: servidor correcto, sin criterio duplicado, money-safe, R1..R36 trazados a
tests que de verdad comprueban, y las mutaciones que intenté salen en rojo. B1 se arregla añadiendo
`dark:bg-info/15` en cuatro clases. Hecho eso, la ficha se aprueba sin otra revisión de fondo; basta con
volver a correr los tests de componente.

## Checklist

### Especificación
- [x] `requirements.md` con R1..R36 en EARS y la sección «Aprobación» (2026-10-02, las tres propuestas por defecto).
- [x] `design.md` con 6 alternativas descartadas y su porqué (§8).
- [ ] `tasks.md` con todas las tareas en `[x]`: **las 17 (T0..T16) siguen en `[ ]`** → m1.

### Trazabilidad
- [x] Cada R1..R36 tiene al menos un test concreto (tabla abajo). Ningún test vacío. La integración
      comprueba que hay datos antes de afirmar nada (por ejemplo `>= 15` filas repartibles, `>= 10`
      negativos dentro del cierre de la orden, `toHaveLength(3)` de pares).
- [x] `progress/impl_469.md` contiene el mapa R → test (servidor y pantalla).

### Calidad de código
- [x] typecheck y lint en verde (dentro del gate).
- [x] `pnpm test`: todos los tests de la 469 en verde (8 de integración, 11 + 9 unitarios, 3 de roots y los de componente). El único rojo del gate es ajeno a la ficha (ver Gate).
- [x] E2E: no aplica. Es una lectura sobre la wallet, sin escritura de dinero. Hay recorrido Playwright en `progress/recorrido_469/` con cifras.

### Datos y seguridad
- [x] Sin migraciones ni tablas nuevas (T1 medido: 0 diferencias guía/remisión, 9,6 ms, sin índice).
- [x] Sin secretos y sin webhooks.
- [x] `tiendaId` sale de la cuenta validada o del actor (`EstadoCuentaService.leerMiTienda` → `actor.usuarioId`), nunca de un campo libre (R5/R29).
- [x] SQL parametrizado (`Prisma.sql`, `$queryRaw` con plantilla). Remisión con `lower() = lower()`, no `ILIKE`: `%` y `_` no actúan como comodín (probado en INT T3).

### Capas
- [x] Repositorios: solo consultas (`OrdenIdentificadaRepository`, `cierresDondeAporta`, `condicionPorGuiaSql`/`busquedaSql`, que son igualdades sobre una lista cerrada).
- [x] La decisión entre guía y texto vive en `BusquedaPorGuiaService`, y los servicios no conocen HTTP.
- [x] Interfaces nuevas en `lib/interfaces/{repositories,services}/`.
- [x] Composition roots: los 3 bordes del libro y los 3 del detalle pasan el `BusquedaPorGuiaService` real (lo comprueba `tests/unit/actions/busqueda-por-guia-469-roots.test.ts`). Los kardex (`CajaKardexService`, `CuentaKardexService`) se construyen con el mismo `buildService()`, así que la descarga también resuelve la búsqueda.

### Multi-país
- [x] Nada hardcodeado. El aporte es el string del servidor, pintado con `money`.

### Verificación final
- [x] `./init.sh` completo: `INIT_EXIT=1` por **1 rojo ajeno**. Repetido aislado sale 5 de 5 en verde (ver Gate).
- [ ] `progress/history.md` → leader.

## Lo que se pidió verificar

**R34: se reutiliza el criterio de aporte, sin duplicarlo en SQL.** Sí. `cierresDondeAporta`
(`lib/repositories/CierreAporteRepository.ts:271-280`) es `OR` de `buildWhere(cierre, criterio, tienda)
AND orden_id`, y `buildWhere` no se tocó. Los conceptos salen de `FUENTE_*` vía `criterioDeFuente`
(`lib/services/BusquedaPorGuiaService.ts:45-59`), sin ninguna lista escrita. `condicionPorGuiaSql`
(`lib/repositories/libro-caja-a-quien-sql.ts:322-329`) y `busquedaSql`
(`lib/repositories/EstadoCuentaRepository.ts:119-127`) solo comparan origen y categoría contra la lista
cerrada. El detalle destacado usa el mismo `listarOrdenesQueAportan` con `ordenIds` en un `AND` aparte, y
el mismo mapeo `aDTO` que la lista (`lib/services/DetalleMovimientoService.ts:289-305`). Así R27 se cumple
por construcción.

**Money-safe.** Sí. Ni una operación nueva: `aporteDeOrden(...).toFixed(2)`, como antes. La pantalla pinta
el string con `money` sin operar.

**El saldo corrido y las tarjetas no cambian al buscar.** Sí. `busquedaSql` va en el `WHERE` exterior,
después de la ventana del corrido (`EstadoCuentaRepository.ts:308`). La bodega sigue con `terminoSql`
(`:283`). Lo afirma INT «mensajero» (corrido y tarjetas) y «tienda» (el corrido fila a fila contra la
cuenta entera, más las 4 tarjetas). En la caja el resumen no recibe la búsqueda (U-SRV «R18», y FE «las
cifras no se piden al buscar»).

**La descarga filtrada cuadra (hoja 2 = hoja 1).** Sí. INT T14 en caja, tienda, `/mi-wallet` y mensajero
comprueba: filas del archivo = filas de la pantalla (R30), `porGuia.totalGeneral` igual a
`kardex.totales` (R31), `conOtrosFiltros === true` (R32) y más de un bloque en la caja. El recorrido real
da TOTAL GENERAL 6000 · 0 · 3627,3, igual a la hoja 1.

**El WIP `0c3c15af` (sin tests).** Repasé cada pieza contra los commits siguientes. Todas tienen consumidor
y test: `identificar` (INT T3), `cierresDeOrdenes` (todas las INT), `gestionesConCobroPorRechazo` e
`incidentesDeOrdenes` (INT caja R14, con el cobro de o2 que NO debe salir), `cierresDondeAporta` (INT T4),
`ordenIds` en `listarOrdenesQueAportan` (INT T10), `condicionPorGuiaSql` (INT T9 y mi mutación) y
`busquedaSql` (INT mensajero y tienda). No hay TODO, `console` ni métodos declarados sin uso.

### Desviaciones declaradas
1. **`WalletService` con la búsqueda opcional.** Aceptable. El único fallo posible es mudo («el root no la
   inyecta»), y lo cierra el test de roots, que construye el servicio por su root y exige la instancia
   real en la posición 5. `EstadoCuentaService` y `DetalleMovimientoService` la exigen.
2. **`OrdenDeDetalleDTO` aparte.** Aceptable y más limpio: el detalle COMPLETO (archivo) no resalta, y el
   esquema completo omite `resaltar` (`.strict()` lo rechaza).
3. **Regex de guía `^[1-9]\d{0,8}$`.** Aceptable. Las guías salen de
   `10000000 + (...) % 90000000` (migración `20260720160000_num_guia_no_secuencial`), así que siempre
   tienen 8 cifras y no empiezan por 0. Un término de 10 cifras no revienta el `int4`.
4. **Fixture escrito con el origen exacto de los servicios.** Aceptable y declarado. Los orígenes
   (`gestion_orden` + `gestionId`, `orden_incidente` + `incidenteId`) coinciden con los citados en el design §0.
5. **Textos en un módulo compartido** (`components/shared/wallet/busqueda-por-guia-labels.ts`). Aceptable
   y mejor que el design: una sola definición del contrato.
6. **Aviso encima de la barra** (`<p role="status">`). Aceptable: R21 dice «junto a la barra», y la barra
   de la 467 va justa de ancho.
7. **Móvil sin tienda en el bloque destacado.** Aceptable: es lo mismo que hace la lista móvil, y
   `/mi-wallet` no tiene columna de tienda.
8. **`claveDetalle` / `claveDetalleMiMovimiento` exportadas** para el test. Aceptable.

### Tests modificados que fijaban textos antiguos
`EstadoCuenta463`, `EstadoCuentaBarra467`, `MiWalletFiltros`, `WalletFiltros458` y
`zonas-filtros-labels-463`: el literal viejo se cambia por el **literal nuevo** de R24, no por su fuente
(memoria «literal: contrato o polizón»). Los invariantes que tenían se mantienen: `/mi-wallet` sigue sin
nombrar a quién registró (`not.toMatch(/registr/i)`), y se añade el caso de la satélite (R36) y su texto
a la guardia de «SLA». El cambio es legítimo.

### Mutaciones (una a una, revertidas; árbol limpio después)
| Mutación | Resultado |
| --- | --- |
| `condicionPorGuiaSql` sin `AND w."categoria"::text = ...` | **ROJO**: INT «T9 R8/R9/R11/R12/R15 — caja: diferencial» (1 de 8) |
| `DetalleMovimientoService.resolverConjunto`: `identificar` sin `tiendaId` | **ROJO** en U-SRV «R29 …». INT T10 sigue VERDE. No es un agujero: el segundo cerrojo (`buildWhere` con `tiendaId` en `destacadas`, y la orden ajena no está en la lista de su tienda) mantiene R29. Ver m4. |

Las ejecuté **después** del gate, no en paralelo con él.

## Hallazgos

| # | Tipo | Dónde | Qué | Qué falta |
| --- | --- | --- | --- | --- |
| B1 | **BLOQUEANTE** | `app/(app)/wallet/_components/DetalleMovimientoCierre.tsx:241,243,509` y `app/(app)/mi-wallet/_components/DetalleMiMovimientoCierre.tsx:192,194,416` | El bloque «Guía buscada» y la fila resaltada usan `bg-info-soft` **sin `dark:bg-info/15`**. `--color-info-soft` es fijo (`#eff6ff`, `app/globals.css:182`, no se redefine en `.dark`), mientras que la tinta gira: en oscuro, `--foreground` `#e6ecf8` (`:870`), `--info-strong` `#93b4f7` (`:920`) y `--muted-foreground` `#9fadc9`. Calculado a partir de los tokens (no medido en el navegador): unos **1,1:1** para la guía, el destinatario y el aporte, unos 1,9:1 para el rótulo y unos 2:1 para la tienda y el resultado. Es exactamente el error que `DESIGN.md:27` nombra («`text-{sem}-strong` sobre `bg-{sem}-soft` sin `dark:bg-{sem}/15`»), y quien tiene el SO en oscuro arranca en oscuro (`DESIGN.md:36`). Deja ilegible justo lo que entregan R25/R26/R27. El recorrido solo se hizo en claro. | Añadir `dark:bg-info/15` a las dos `section` y a los dos `rowClassName` (el mismo patrón de `Badge variant="info"`). Recomendado: pasar el recorrido 02 en tema oscuro y un `expect(...className).toMatch(/dark:bg-info\/15/)` en FE «R25/R26/R27». |
| m1 | menor (bloquea `done`, no el merge) | `specs/469-wallet-buscar-guia/tasks.md:9,15,22,28,33,40,46,52,57,63,74,83,88,93,100,108,116` | Las 17 tareas siguen en `[ ]` aunque todas tienen commit o medición. CHECKPOINTS lo exige. | Marcarlas con su commit. |
| m2 | menor | `progress/impl_469.md:178` | Cita `progress/gate_469_backend.log`, que no está en la rama (solo los dos `gate_469_frontend*.log`). | Subirlo o quitar la referencia. |
| m3 | menor | `lib/repositories/OrdenIdentificadaRepository.ts:51-59` | `incidentesDeOrdenes` no se acota por tienda. Hoy no tiene efecto, porque los `ordenIds` ya llegan acotados por `identificar` y el par solo casa con filas de ese libro. Es una asimetría con `gestionesConCobroPorRechazo`. | Nada obligatorio; si acaso, un comentario. |
| m4 | menor | `tests/integration/db/busqueda-por-guia-469.test.ts:486-496` | R29 en el detalle tiene dos cerrojos. La integración solo ve el resultado final, así que la mutación del primero (`identificar` sin `tiendaId`) sobrevive en INT y solo la caza el unitario. Es correcto hoy; si alguien quitara también el `tiendaId` de `destacadas`, la red sería solo el doble. | Opcional: un caso INT donde la orden ajena SÍ esté en la lista de la tienda que mira. |
| m5 | menor | `app/(app)/wallet/_components/DetalleMovimientoCierre.tsx:386` | Al cambiar `resaltar` con el panel abierto, la página del detalle (`useState(1)`) no se reinicia. Es inocuo, porque el bloque destacado no depende de la página. | Nada. |

## Mapa R → test (verificado leyendo cada test)

`INT` = `tests/integration/db/busqueda-por-guia-469.test.ts`; `U-BUS` = `tests/unit/services/busqueda-por-guia-469.test.ts`;
`U-SRV` = `tests/unit/services/busqueda-por-guia-469-servicios.test.ts`; `U-ROOT` = `tests/unit/actions/busqueda-por-guia-469-roots.test.ts`;
`FE` = `tests/components/BusquedaPorGuia469.test.tsx`; `LBL` = `tests/unit/components/zonas-filtros-labels-463.test.ts`.

| R | Test | R | Test |
| --- | --- | --- | --- |
| R1 | FE (mismo searchbox «Buscar en el libro») | R19 | INT caja (total 9; páginas de 2) y tienda |
| R2 | INT caja/tienda/mensajero `modoBusqueda`; U-BUS | R20 | INT caja (asc = reverso de desc) y tienda |
| R3 | INT T3 (prefijo, sufijo, «0…», 10 cifras) | R21 | FE (literal; cuenta y caja) |
| R4 | INT T3 (minúsculas) | R22 | INT caja (o11: guía, 0 filas); FE cuenta y caja |
| R5 | INT T3 + «tienda»: B y `/mi-wallet` de B = texto 463 | R23 | FE `terminoDeGuia`, cuenta y caja; U-SRV |
| R6 | INT caja «zzz…»; U-BUS; U-SRV | R24 | FE; LBL |
| R7 | INT T3 (remisión de A y B) y caja (remisión = guía) | R25 | INT T10 (o4 desde la página 1); FE |
| R8 | INT T9 diferencial | R26 | INT T10; FE (insignia «Guía buscada») |
| R9 | INT T4 y T9 (>= 10 negativos), o9 | R27 | INT T10 (aporte igual); FE (mismo string) |
| R10 | INT caja (nota) y tienda (ajuste A) | R28 | INT T10; U-SRV ×2; FE cuenta y caja |
| R11 | INT T9 caja, tienda, mensajero | R29 | INT T10; U-SRV (mutación roja) |
| R12 | INT T9 (los 4 de la 468); U-BUS recorre catálogos | R30 | INT T14 ×4; U-SRV |
| R13 | INT mensajero (sin `pago_efectivo`); U-BUS | R31 | INT T14 (TOTAL GENERAL = periodo) |
| R14 | INT caja (cobro + IVA + incidente de o1; no o2) y tienda | R32 | INT T14 `conOtrosFiltros` |
| R15 | INT T9 (ids únicos); U-BUS | R33 | U-SRV (guard antes); U-ROOT ×3; U-BUS |
| R16 | INT caja (concepto, tipo, periodo) y mensajero (cierre) | R34 | U-BUS; diferencial R11; mutación roja |
| R17 | INT mensajero y tienda (corrido fila a fila) | R35 | FE «SLA»; LBL guardia |
| R18 | INT tarjetas; U-SRV resumen; FE caja | R36 | U-SRV bodega; FE; LBL |

## Gate

`./init.sh` completo, con el `.env` copiado y `node_modules` por junction, en
`progress/gate_review_469.log`:
- typecheck ✓, lint ✓; `Test Files 1 failed | 2378 passed (2379)`; `Tests 1 failed | 32998 passed | 26 skipped (33025)`. Los 26 skipped son de Analítica, preexistentes; **0 de integración saltados** (`.env` presente).
- **`INIT_EXIT=1`**. Único rojo: `tests/integration/recuperar-contrasena-form.test.tsx > … restablecer con éxito` («Unable to find … Contraseña actualizada»). La ficha no toca ese archivo ni nada de auth. Repetido aislado: **5 de 5 en verde (11/11 cada vez)**. Es un flake por carga (memoria «gate rojo: cuatro modos de flake»), no se atribuye a la 469.
- Los 4 archivos de la 469 en verde dentro del gate: INT 8/8, U-SRV 11/11, U-BUS 9/9 y U-ROOT 3/3.
