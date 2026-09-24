# 454 — Arreglo de la revisión T4.3 (RECHAZADA)

> Agente: backend_dev. Rama `feature/454-fix-review`, nacida de `origin/feature/454-estado-al-aprobar-cierre-final`
> (`edff9ccf`, comprobado con `git log --oneline -1`). Informe de partida: `origin/review/454:progress/review_454.md`.
> Entorno: junction de `node_modules`, `.env` copiado sin imprimir, `prisma generate`. Base local compartida.
> Búsqueda de código: MCP `codebase-memory` (`R-job-singularis-projects-ordenex`) para
> `findMensajerosConOrdenesEn` (lo encontró); el resto de símbolos de la 454 no están en el índice (rancio
> para esta rama, igual que dijo el revisor), así que se leyó en el archivo real.
> **No se corrió el gate completo** (orden del leader: hay un recorrido en navegador sobre la base local).

## Qué se hizo, por punto

### B1 — `caja-173-alcance` caía por `scripts/contraste-454.ts`

El script nombra `ingreso_cod_recaudado` solo en las filas FICTICIAS de `--autocomprobacion` (van en el texto
de la consulta, nunca a la base) y corre todo en `SET TRANSACTION READ ONLY`. No es fórmula (lista
`MODULOS_DE_LA_173`, que además exige no nombrar insumos) ni catálogo (`CATALOGOS_PREEXISTENTES`). Se añadió
una tercera lista declarada, `VERIFICADORES_SOLO_LECTURA`, con su motivo, que entra en el cierre de la lista.
**La guardia no se debilita, se endurece:** un `it` nuevo exige sobre el código real de cada verificador
declarado (1) que abra `SET TRANSACTION READ ONLY`, (2) cero escrituras por delegado de Prisma
(`.x.create/update/upsert/delete…(`) y (3) que todo `$executeRaw*` sea exactamente el `SET TRANSACTION READ ONLY`.

### B2 — R56 sin test

Nuevo `tests/integration/db/454/carga-mensajero-pendiente-sql-real.test.ts`, contra Postgres real, con los
repositorios REALES y la gestión registrada por `MisAsignacionesService.gestionar` (evento
`gestion_registrada`, sin cierre → pendiente; la orden sigue `en_reparto`, afirmado como precondición):
- `OrdenRepository.findMensajerosConOrdenesEn` (ocupado / «Generar guía»): antes de gestionar, los dos
  mensajeros ocupados (control positivo); después, solo el 2 (su orden idéntica sin gestión sigue contando).
- `RepartoMananaRepository` (aviso de reparto de mañana): la misma orden cuenta 1 antes y 0 después, en la
  cifra viva (`contarReservadasParaOtroDia`) y en el resumen del cron (`resumenPorMensajero`); el control del
  mensajero 2 sigue en 1. (La orden se trae a hoy para gestionarla —la 261 no deja gestionar una reservada—
  y se devuelve a mañana.)

### B3 — la autorización del detalle sin red

`tests/integration/db/454/senales-gestion-lectores-sql-real.test.ts`:
- el helper `detalle` devolvía `{ status }` en la rama no-`ok`; ahora devuelve el resultado **crudo**, así
  que la aserción existente `toEqual({ status: "not_found" })` compara el objeto entero;
- nuevo caso «alcance (servicio)»: sobre órdenes CON señal (A pendiente, C ayuda abierta), un actor por
  cada rama de `autorizar` que niega — tienda ajena (`not_found`), adminSatelite de otra zona (`forbidden`),
  mensajero que ni la tiene ni actuó (`forbidden`) — y el resultado tiene que ser exactamente `{ status }`;
- nuevo caso «alcance (Server Action)»: lo mismo por `obtenerHistorialOrden` con el servicio real inyectado,
  más sin sesión (`unauthenticated`); con control de que al maestro SÍ le llega la señal por la action.

### m1 — `tasks.md`

T0.0–T3.3 marcadas `[x]` (40 tareas) con una nota de estado arriba que dice dónde el «Hecho» se cumplió por
otra vía (T1.16, T1.18, T1.20, T1.21, T3.2). T4.1–T4.3 y la Fase 5 siguen `[ ]`. La tabla «Trazabilidad
R → test» se reescribió consolidando las cuatro bitácoras: **74 rutas citadas, 0 inexistentes**, comprobado
con un script que hace `os.path.exists` de cada ruta entre comillas invertidas (salida:
`rutas citadas: 74 faltan: []`). Nota: T1.3 cita una guardia `ayuda-abierta-unica-fuente` que no existe; la
regla la cubre `gestion-pendiente-unica-fuente.guardia.test.ts` («`ayuda_solicitada` no se lee en ningun
`where` fuera de `ayuda-abierta.ts`»). No se reescribió el texto de T1.3.

### m2 — R65 vacuo

Escrito en `requirements.md` bajo R65, con la prueba: el aviso diario es
`app/api/cron/avisos-diarios` → `AvisosDiariosService` → `AvisoAgregadoRepository`, cuyo único conteo de
novedades es `countNovedadesByTienda(tiendaId, "devolucion")`.
`git grep -n -i "ayuda" <ref> -- app/api/cron/avisos-diarios lib/services/AvisosDiariosService.ts
lib/interfaces/services/IAvisosDiariosService.ts lib/config/avisos-diarios.ts lib/repositories/AvisoAgregadoRepository.ts`
→ 0 líneas, `exit=1`, en `f05b7c3f` (dev antes de la ficha) y en `HEAD`.

### m4 — la red 454 en una base NUEVA

`_escenario.ts` ya no exige `ayuda_tienda` ni `devolucion_por_confirmar` en `prepararMundo`. Si faltan, el
escenario los siembra **dentro de su transacción revertida** y solo cuando un fixture los pide
(`sembrarOrden` con uno de ellos, `sembrarIntentoPasado` de una `devuelta`, o `await e.asegurarRetirados()`
antes de `id()`). Perezoso a propósito: `order_status.value` es UNIQUE y un INSERT sin confirmar bloquea a
otra tx que inserte el mismo valor; sembrarlos siempre serializaría la carpeta en una base nueva. En un
escenario COMPROMETIDO (`sembrarComprometido`) nunca se siembran (se confirmarían y devolverían al catálogo
lo que la M3 retiró): falla ruidosamente. `estadoDe`/`historialDe` resuelven también los ids locales.
Dos fixtures de caracterización ganan UNA línea `await e.asegurarRetirados()` (no son aserciones):
`caracterizacion/intentos-conteo.test.ts` (`gestionPasada`) y `caracterizacion/rastreo-y-historial-legado.test.ts`
(`fila`). **Ninguna aserción tocada.** Las aserciones que nombran los retirados (C27: «una fila histórica con
destino `devolucion_por_confirmar` se lee `no_entregado`», «`ayuda_tienda` → `en_reparto`») siguen teniendo
sentido tras la 454: son R40 (lectura de las filas históricas), no fijan los estados como vivos. No hubo que
detenerse.

**Medido en una base nueva de verdad** (`ordenex_fresh454`, creada en el Postgres local y borrada al final):
`prisma migrate deploy` desde cero (con `seed-sinpe-inicial` y valores SINPE ficticios, que la migración
`20260918120200_zona_sinpe_no_nulo` exige), `seed-catalogos`, `seed-zonas`, una zona marcada central, una tienda
y una orden mínimas. En esa base los dos estados NO están en `order_status` (medido: `retirados: []`).
- **Antes** (los tres archivos en su versión de `edff9ccf`): `Test Files 48 failed (48)` ·
  `Tests 8 passed | 242 skipped (250)`; las 48 caen en `prepararMundo` con «falta el estatus «ayuda_tienda»».
- **Después**: `Test Files 48 passed (48)` · `Tests 250 passed (250)`, 0 skipped.

## Mutaciones (arnés: sustitución literal única con copia, `node mut.mjs apply|restore`; `git status` limpio en `lib/` y `scripts/` tras cada una)

| Id | Archivo — mutación | Test | Resultado |
|---|---|---|---|
| MUT-R10a | `OrdenRepository.ts` `findMensajerosConOrdenesEn` — fuera `...whereOrdenSinGestionPendiente()` | `carga-mensajero-pendiente-sql-real` | **ROJO** 1/5 («R56 ocupado»: `expected [ …(2) ] to deeply equal [ Array(1) ]`), restaurado |
| MUT-R10b | `RepartoMananaRepository.ts` `whereRepartoManana` — fuera `...whereOrdenSinGestionPendiente()` | ídem | **ROJO** 1/5 («R56 reparto de mañana»: `expected 1 to be +0`), restaurado |
| MUT-R6 | `OrdenHistorialService.ts:162` — `if (decision !== "ok") return { status: decision, ...(await this.historialRepo.findSenalesGestion(ordenId)) }` | `senales-gestion-lectores-sql-real` | **ROJO** 3/14 (la aserción previa «la ajena no le llega», «alcance (servicio)» y «alcance (Server Action)»), restaurado. Antes del arreglo: 18/18 verde (revisión) |
| MUT-B1a | guardia — `VERIFICADORES_SOLO_LECTURA` sin el script | `caja-173-alcance.guardia` | **ROJO** 2/30 («CIERRE de la lista», «verificadores de solo lectura»), restaurado |
| MUT-B1b | `scripts/contraste-454.ts` — tras el READ ONLY, `$executeRawUnsafe("DELETE FROM wallet_movimiento")` | ídem | **ROJO** 1/30 («verificadores de solo lectura»), restaurado |
| MUT-B1c | `scripts/contraste-454.ts` — tras el READ ONLY, `tx.walletMovimiento.create(...)` | ídem | **ROJO** 1/30, restaurado |
| m4 | los tres archivos en su versión previa, base nueva | `tests/integration/db/454` | **ROJO** 48/48 archivos (ver arriba), restaurado |

## Archivos

- `tests/unit/guards/caja-173-alcance.guardia.test.ts` (B1)
- `tests/integration/db/454/carga-mensajero-pendiente-sql-real.test.ts` (nuevo, B2)
- `tests/integration/db/454/senales-gestion-lectores-sql-real.test.ts` (B3)
- `tests/integration/db/454/_escenario.ts`, `caracterizacion/intentos-conteo.test.ts`,
  `caracterizacion/rastreo-y-historial-legado.test.ts` (m4; solo fixture)
- `specs/454-estado-al-aprobar-cierre/tasks.md` (m1), `specs/454-estado-al-aprobar-cierre/requirements.md` (m2)
- Ningún archivo de `lib/`, `app/`, `scripts/` ni `db/` cambia.

## Mapa R → test de lo que este arreglo añade

| R | Test |
|---|---|
| R56 | `454/carga-mensajero-pendiente-sql-real.test.ts` (4 casos + precondición) |
| R29/R64 (alcance del detalle) | `454/senales-gestion-lectores-sql-real.test.ts` «alcance (servicio)», «alcance (Server Action)» y la aserción endurecida de la tienda ajena |
| R65 | vacuo, medido (`requirements.md`) |

El mapa completo R1–R65 está en `specs/454-estado-al-aprobar-cierre/tasks.md`.

## Salidas

- `pnpm exec vitest run tests/integration/db/454` (base local compartida, tras todos los cambios):
  `Test Files 48 passed (48)` · `Tests 250 passed (250)` (antes 47/243: +1 archivo y +7 tests), 0 skipped, `EXIT=0`.
- `pnpm exec vitest run tests/unit/guards/caja-173-alcance.guardia.test.ts`: `Tests 30 passed (30)`.
- `pnpm run typecheck`: `tsc --noEmit`, `EXIT=0`.
- `pnpm run lint`: `0 errors, 216 warnings` (`EXIT=0`); `eslint` sobre los 6 archivos tocados: sin salida, exit 0.
- `pnpm test` (suite entera): **no corrido**, por orden del leader (gate completo después del recorrido).
  Pendiente para cerrar B1 del todo: el `./init.sh` completo sobre esta rama.

**Veredicto:** B1–B3 y m1, m2, m4 cerrados con tests verdes y cada mutación del revisor en ROJO; falta el gate completo, que corre el leader.
