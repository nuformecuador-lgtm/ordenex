# impl — Feature 170, FASE 2, Tanda I (T I.1: backend de los 7 listados de riesgo BAJO)

**Rama:** `feature/170-fase2-tanda-i` · **Fecha:** 2026-08-01 · **Rol:** `backend_dev`
**Alcance:** SOLO T I.1 (servidor). **Cero UI**: T I.2 es de otro agente y no se toco `app/**`
ni `components/**`.

Todo lo que sigue esta MEDIDO. Las nueve mutaciones se ejecutaron y se revirtieron; una de
ellas pasó VERDE y por eso esta entrega tiene un archivo de test que no estaba previsto.

---

## 0. Baseline medido AL EMPEZAR

```
$ git branch --show-current
feature/170-fase2-tanda-i        (rama ya creada; no se hizo checkout de ninguna otra)
$ git status --short
(limpio)
$ npx tsc --noEmit
=== typecheck exit: 0 ===
```

---

## 1. Qué se entrega, listado a listado

Los 7 del riesgo BAJO (`design.md §11.3`). Cada uno gana **cuatro** piezas: metodo de
repositorio, metodo de servicio, schema zod `.strict()` y Server Action.

| # | Listado | Servicio · metodo nuevo | Repositorio · metodo nuevo | Acotamiento por actor |
| --- | --- | --- | --- | --- |
| 1 | Cierres del dia — historico | `CierresAdminService.listarHistoricoCierresAdminPaginado` | `findHistoricoPaginado(alcance, rango)` | `resolveAlcance` (rol + zona destino) |
| 2 | Cierres de bodega resueltos | `CierresBodegaAdminService.listarHistoricoCierresBodegaPaginado` | `findHistoricoPaginado(rango)` | `esAccesoTotal` |
| 3 | Cierres de bodega solicitados | `CierreBodegaService.listarCierresBodegaSolicitadosPaginado` | `findCierresBodegaByZonaPaginado(zonaId, rango)` | rol `adminSatelite` + `findUsuarioZonaId` |
| 4 | Cierres solicitados del mensajero | `CierreDiaService.listarCierresPasadosPaginado` | `findCierresByMensajeroPaginado(mensajeroId, rango)` | rol `mensajero` + `actor.usuarioId` |
| 5 | Incidentes — historico | `IncidenteAdminService.listarHistoricoIncidentesPaginado` | `findHistoricoPaginado(alcance, rango)` | `resolveAlcance` (rol + zona de la ORDEN) |
| 6 | Saldos de tiendas | `WalletTiendaService.listarSaldosTiendasPaginado` | `listarSaldosTiendasPaginado(rango)` | `esAccesoTotal` |
| 7 | Plantillas de gasto fijo | `GastoFijoPlantillaService.listarPlantillasPaginado` | `listarPaginado(rango)` | `esAccesoTotal` |

Los 7 devuelven `ListarPaginadoServiceResult<T>` (T H.2) en la interfaz y
`ListarPaginadoResult<T, E>` en el borde. **Ni un campo extra**: `sinZona`,
`tieneVencido`/`tieneRechazado` y los totales de dinero siguen llegando por el listado
compuesto que ya existe, que la pantalla sigue llamando (ver §7, traspaso).

---

## 2. El `construirWhere` que la tarea pedia reusar: qué es aquí, y qué NO

`tasks.md` dice «reusar el `construirWhere` que la fase 1 ya extrajo para `listarCompleto` de
cada servicio». **Para estos siete no existe tal cosa, y hay que decirlo:** la FASE 1 extrajo
`construirWhere`/`construirFiltros` en la Familia A (ordenes, wallet-tienda, wallet-mensajero,
wallet), y estas siete tablas son **Familia B** — descargan con `filasLocales(array)` sobre las
filas que la pantalla ya tiene (`progress/impl_170-export-todas-las-tablas.md` §C1/§C3). No
tienen `listarCompleto` de servidor.

Lo que sí se reusa, que es lo mismo con otro nombre, son las **dos piezas que deciden qué filas
ve un actor**, y ninguna se reimplemento:

1. **El acotamiento por actor**, tal cual ya existía: `resolveAlcance` (38 y 158),
   `findUsuarioZonaId` (40), `actor.usuarioId` (37), `esAccesoTotal` (40/43/45). El metodo
   paginado llama al MISMO resolver que el listado sin paginar, en el MISMO orden (guard de rol
   primero, base despues).
2. **El corte cola/historico**, que sí estaba duplicado y ahora no: hasta hoy vivía como un `if`
   en memoria dentro de tres servicios (`estado === "solicitado" || estado === "vencido"`, y dos
   veces `estado === "solicitado"`). Al paginar, ese mismo criterio tiene que existir además
   como WHERE. Dos escrituras del mismo criterio en dos capas es exactamente como una fila se
   cae de un listado sin que nadie lo note — y con `vencido`, que es bloqueante y money-critical,
   «caerse del listado» significa que el admin no lo ve para resolverlo.

De ahí **`lib/utils/colas-cierre.ts`**: `ESTADOS_COLA_CIERRE_DIA` y `ESTADOS_COLA_SOLICITADO`
declarados una vez, leídos por los servicios (`esColaCierreDia` / `esColaSolicitado`, que
sustituyen los literales del `if`) y por los repositorios (`notIn: [...cola]`).

**Por qué `notIn` y no `in: ["aprobado","rechazado"]`:** porque `notIn` es el espejo EXACTO del
`else` de la partición en memoria. Con un `in` explícito, un valor nuevo del enum `CierreEstado`
desaparecería de las DOS listas en vez de caer en el histórico, que es lo que hace hoy la
pantalla. Está probado en `historicos-paginados-where.test.ts`.

También se extrajo, por el mismo motivo, `alcanceWhere(alcance)` en
`IncidenteAdminRepository` (estaba escrito a mano en las dos lecturas y la página habría sido
la tercera) y `CIERRE_PASADO_SELECT`/`toCierrePasadoDTO` en `CierreDiaRepository` (para que la
página lea exactamente las mismas columnas que el listado entero).

---

## 3. La mutación que cambió la entrega

La cuarta mutación —`notIn: [cola]` → `in: ["aprobado"]` en `CierresBodegaAdminRepository`, que
**borra del histórico todos los cierres de bodega RECHAZADOS**— pasó **VERDE**: 15 tests, ni uno
rojo.

El motivo es estructural y valía la pena verlo: los tests de servicio prueban el acotamiento por
ACTOR con un repositorio doble, así que **no pueden ver la traducción de ese acotamiento a SQL**.
El WHERE es precisamente donde vive el riesgo de R44 en cuatro de los siete.

De ahí nace **`tests/unit/repositories/historicos-paginados-where.test.ts`** (9 tests), que
instancia los repositorios REALES con un cliente Prisma falso y afirma, por listado:

1. `findMany` y `count` reciben el **mismo** `where` (si no, el total cuenta otro conjunto);
2. son **exactamente dos** consultas — la página y el conteo, ni una más (R54 medido a nivel de
   base, no de servicio);
3. el `orderBy` y el `skip`/`take` son los que el listado presenta hoy (R51), y el conteo no
   lleva recorte.

Con él, la misma mutación se pone roja:
`expected { estado: { in: ['aprobado'] } } to deeply equal { estado: { notIn: ['solicitado'] } }`.

---

## 4. Las nueve mutaciones, con su salida real

**Todas revertidas** (`git status` limpio salvo lo entregado; `grep MUTACION lib/` sin
resultados).

| # | Mutación | Resultado medido |
| --- | --- | --- |
| 1 | `listarHistoricoCierresAdminPaginado` pasa un alcance fijo `bodega_central` en vez del del actor | **ROJO (2)**: `rol adminSatelite/u-sat-a: expected [Array(5)] to deeply equal ['s-a2','s-a1']` |
| 2 | `total: items.length` en cierres del día | **ROJO (2)**: `pagina 1: expected 2 to be 5` · `rol maestro: el total es el del conjunto: expected +0 to be 5` |
| 3 | `findCierresByMensajeroPaginado("m-b", …)` en vez de `actor.usuarioId` | **ROJO (5)**: `mensajero m-a: expected ['b-2','b-1'] to deeply equal ['a-5',…]` |
| 4 | `notIn: [cola]` → `in: ["aprobado"]` en el repo de bodega | **VERDE (15 pasan)** → ver §3. Con el test nuevo: **ROJO**, `expected { estado: { in: ['aprobado'] } } …` |
| 5 | `count({})` sin el `where` del alcance (cierres del día) | **ROJO (2)**: `expected undefined to deeply equal { destinoTipo: 'bodega_central', …(1) }` |
| 6 | `where = {}` en `findCierresByMensajeroPaginado` | **ROJO (1)**: `expected {} to deeply equal { mensajeroId: 'm-a' }` |
| 7 | Orden de saldos sin desempate por `tiendaId` | **ROJO (1)**: `expected ['t-b','t-a','t-c'] to deeply equal ['t-a','t-b','t-c']` |
| 8 | Guard `esAccesoTotal` DESPUÉS de consultar la base (saldos) | **ROJO (1)**: `rol adminTienda: expected ['listarSaldosTiendasPaginado', …(1)] to deeply equal []` |
| 9 | `rangoDePagina` en base 0 (`page * pageSize`) | **ROJO (30)** en 7 archivos |

Las dos que el encargo exigía —acotamiento por actor y conteo total— son la 1/3/6 y la 2/5.

---

## 5. Mapa `R<n> → archivo::test`

Prefijos: `S/` = `tests/unit/services/`, `R/` = `tests/unit/repositories/`.

| R | Test |
| --- | --- |
| **R40** | `S/cierres-admin-historico-paginado.test.ts::devuelve la pagina pedida y el total del conjunto (R40, R41)` |
| **R40** | `S/cierres-admin-historico-paginado.test.ts::acota el tamano de pagina al maximo configurado y nunca lo excede (R40)` |
| **R40** | `S/cierres-bodega-admin-historico-paginado.test.ts::devuelve la pagina pedida y el total del conjunto (R40, R41)` |
| **R40** | `S/cierres-bodega-admin-historico-paginado.test.ts::acota el tamano de pagina al maximo configurado y nunca lo excede (R40)` |
| **R40** | `S/cierre-bodega-solicitados-paginado.test.ts::devuelve la pagina pedida y el total del conjunto (R40, R41)` |
| **R40** | `S/cierre-bodega-solicitados-paginado.test.ts::acota el tamano de pagina al maximo configurado y nunca lo excede (R40)` |
| **R40** | `S/cierre-dia-pasados-paginado.test.ts::devuelve la pagina pedida y el total del conjunto (R40, R41)` |
| **R40** | `S/cierre-dia-pasados-paginado.test.ts::acota el tamano de pagina al maximo configurado y nunca lo excede (R40)` |
| **R40** | `S/incidentes-historico-paginado.test.ts::devuelve la pagina pedida y el total del conjunto (R40, R41)` |
| **R40** | `S/incidentes-historico-paginado.test.ts::acota el tamano de pagina al maximo configurado y nunca lo excede (R40)` |
| **R40** | `S/saldos-tiendas-paginado.test.ts::devuelve la pagina pedida y el total del conjunto (R40, R41)` |
| **R40** | `S/saldos-tiendas-paginado.test.ts::acota el tamano de pagina al maximo configurado y nunca lo excede (R40)` |
| **R40** | `S/gasto-fijo-plantillas-paginado.test.ts::devuelve la pagina pedida y el total del conjunto (R40, R41)` |
| **R40** | `S/gasto-fijo-plantillas-paginado.test.ts::acota el tamano de pagina al maximo configurado y nunca lo excede (R40)` |
| **R41** | Los siete `S/*-paginado.test.ts::devuelve la pagina pedida y el total del conjunto (R40, R41)` (cada uno afirma `total !== items.length` en la última página) |
| **R41** | `R/historicos-paginados-where.test.ts::cierres del dia — historico: alcance + estados fuera de la cola, mismo where en pagina y conteo` |
| **R41** | `R/historicos-paginados-where.test.ts::cierres del dia — historico: el acceso total NO emite destinoZonaId (ve toda la central)` |
| **R44** | `S/cierres-admin-historico-paginado.test.ts::el conjunto paginado y el dataset completo coinciden para el mismo actor (R44)` |
| **R44** | `S/cierres-admin-historico-paginado.test.ts::CONTRAPRUEBA de R44: cada actor ve LO SUYO y nada del vecino` |
| **R44** | `S/cierres-admin-historico-paginado.test.ts::CONTRAPRUEBA de R44: el rol sin acceso recibe forbidden sin filas ni total` |
| **R44** | `S/cierres-admin-historico-paginado.test.ts::el adminSatelite SIN zona recibe una pagina vacia y no consulta la base (R44)` |
| **R44** | `S/cierres-bodega-admin-historico-paginado.test.ts::el conjunto paginado y el dataset completo coinciden para el mismo actor (R44)` |
| **R44** | `S/cierres-bodega-admin-historico-paginado.test.ts::CONTRAPRUEBA de R44: forbidden sin filas ni total a todo rol sin acceso total` |
| **R44** | `S/cierre-bodega-solicitados-paginado.test.ts::el conjunto paginado y el dataset completo coinciden para el mismo actor (R44)` |
| **R44** | `S/cierre-bodega-solicitados-paginado.test.ts::CONTRAPRUEBA de R44: cada bodega ve la SUYA y ninguna de la vecina` |
| **R44** | `S/cierre-bodega-solicitados-paginado.test.ts::CONTRAPRUEBA de R44: forbidden sin filas ni total a todo rol que no sea adminSatelite` |
| **R44** | `S/cierre-bodega-solicitados-paginado.test.ts::el adminSatelite SIN zona recibe una pagina vacia y no consulta el historico (R44)` |
| **R44** | `S/cierre-dia-pasados-paginado.test.ts::el conjunto paginado y el dataset completo coinciden para el mismo actor (R44)` |
| **R44** | `S/cierre-dia-pasados-paginado.test.ts::CONTRAPRUEBA de R44: cada mensajero ve LOS SUYOS y ninguno del otro` |
| **R44** | `S/cierre-dia-pasados-paginado.test.ts::CONTRAPRUEBA de R44: forbidden sin filas ni total a todo rol que no sea mensajero` |
| **R44** | `S/incidentes-historico-paginado.test.ts::el conjunto paginado y el dataset completo coinciden para el mismo actor (R44)` |
| **R44** | `S/incidentes-historico-paginado.test.ts::CONTRAPRUEBA de R44: cada zona ve la SUYA, el acceso total las ve todas` |
| **R44** | `S/incidentes-historico-paginado.test.ts::CONTRAPRUEBA de R44: forbidden sin filas, sin total y sin tocar el storage` |
| **R44** | `S/incidentes-historico-paginado.test.ts::el adminSatelite SIN zona recibe una pagina vacia, sin base ni storage (R44)` |
| **R44** | `S/saldos-tiendas-paginado.test.ts::el conjunto paginado y el dataset completo coinciden para el mismo actor (R44)` |
| **R44** | `S/saldos-tiendas-paginado.test.ts::CONTRAPRUEBA de R44: forbidden sin filas ni total, ni siquiera a la propia tienda` |
| **R44** | `S/gasto-fijo-plantillas-paginado.test.ts::el conjunto paginado y el dataset completo coinciden para el mismo actor (R44)` |
| **R44** | `S/gasto-fijo-plantillas-paginado.test.ts::CONTRAPRUEBA de R44: forbidden sin filas ni total a todo rol sin acceso total` |
| **R44** | `R/historicos-paginados-where.test.ts::cierres de bodega — resueltos: estados fuera de la cola (los RECHAZADOS siguen dentro)` |
| **R44** | `R/historicos-paginados-where.test.ts::cierres de bodega — solicitados: acota por zona y NO filtra por estado` |
| **R44** | `R/historicos-paginados-where.test.ts::cierres solicitados del mensajero: acota por mensajeroId y NO filtra por estado` |
| **R44** | `R/historicos-paginados-where.test.ts::incidentes — historico: alcance por la zona de la ORDEN + estados fuera de la cola` |
| **R44** | `R/historicos-paginados-where.test.ts::incidentes — historico: el acceso total no emite filtro de zona` |
| **R44** | `R/historicos-paginados-where.test.ts::plantillas de gasto fijo: sin where (activas e inactivas), dos consultas y el orden de hoy` |
| **R51** | `S/cierres-admin-historico-paginado.test.ts::conserva el criterio de ordenacion actual: solicitadoAt descendente (R51)` |
| **R51** | `S/cierres-bodega-admin-historico-paginado.test.ts::conserva el criterio de ordenacion actual: solicitadoAt descendente (R51)` |
| **R51** | `S/cierre-bodega-solicitados-paginado.test.ts::conserva el criterio de ordenacion actual: solicitadoAt descendente (R51)` |
| **R51** | `S/cierre-dia-pasados-paginado.test.ts::conserva el criterio de ordenacion actual: solicitadoAt descendente (R51)` |
| **R51** | `S/incidentes-historico-paginado.test.ts::conserva el criterio de ordenacion actual: createdAt descendente (R51)` |
| **R51** | `S/saldos-tiendas-paginado.test.ts::ordena por nombre de tienda, con un orden TOTAL que no solapa paginas (R51)` — DESVIACION, ver §6 |
| **R51** | `S/gasto-fijo-plantillas-paginado.test.ts::conserva el criterio de ordenacion actual: createdAt descendente (R51)` |
| **R54** | Los siete `S/*-paginado.test.ts::no ejecuta mas consultas que el listado sin paginar, salvo el conteo (R54)` |
| **R54** | `R/historicos-paginados-where.test.ts::ninguno de los seis pide mas de dos consultas: la pagina y el conteo (R54)` |
| **R46** | `S/incidentes-historico-paginado.test.ts::las evidencias de la pagina salen FIRMADAS, nunca como storage_path (R46)` (no es de esta task; se afirma porque la página firma menos paths que el listado entero y había que dejarlo escrito) |

**R42, R43, R45, R47–R50, R52, R53 NO entran en esta task** y no se declaran cubiertos: son
T I.2 y las tandas J/K/L.

---

## 6. Decisiones tomadas al implementar

1. **El contrato no gana campos.** `sinZona` no viaja en la página: el contrato de T H.2 son
   cuatro campos y el aviso de «no tenés zona» es de la pantalla, que lo sigue recibiendo por
   el listado compuesto. Un `adminSatelite` sin zona recibe `{ items: [], total: 0 }` —lo mismo
   que ve hoy— **sin ejecutar ni una consulta**.
2. **`sinZona` → página vacía, no `forbidden`.** El rol tiene acceso al módulo; lo que no tiene
   es alcance que consultar. Devolver `forbidden` cambiaría la pantalla.
3. **El guard de rol va SIEMPRE antes del repositorio.** Con el guard después, el dinero
   agregado ya habría salido de la base aunque la respuesta fuera un error. Está medido en los
   siete (`llamadas` del doble === `[]`) y verificado por la mutación 8.
4. **`.strict()` en los siete schemas**, aunque ninguno tenga filtros. No es higiene: es la
   primera de dos barreras contra un `zonaId`/`tiendaId`/`mensajeroId` colado. La segunda es que
   el servicio nunca lee esas claves (el input tipado son `page`/`pageSize` y nada más).
5. **`lib/utils/rango-pagina.ts`** extrae `(page - 1) * pageSize`, que ya existía escrito cuatro
   veces y habría llegado a once. El `Math.max(0, …)` es la única línea entre un `page: 0`
   colado por un camino sin schema y un `skip: -25`, que en Postgres es un error de SQL.
6. **Saldos de tiendas NO corta en la base, y es deliberado.** Es el único de los siete cuya
   fila es una AGREGACIÓN de todo el ledger de esa tienda: el saldo no se puede calcular desde
   una página de movimientos, así que la agregación es del conjunto completo por construcción y
   no hay nada que empujar al `LIMIT`. El recorte se hace sobre la MISMA
   `listarSaldosTodasTiendas`, con tres consecuencias: R44 se cumple por construcción (es
   literalmente el mismo conjunto), R54 se cumple en su forma fuerte (cero consultas nuevas, ni
   la del conteo) y el coste en base no baja — lo que baja es lo que cruza a la pantalla, que es
   de lo que habla el Anexo III para este listado («crece con el número de tiendas»).
   La alternativa era `$queryRaw` con `GROUP BY … LIMIT/OFFSET`; se descartó porque **este repo
   no tiene forma de ejecutar SQL crudo en la suite** (no hay DB de test) y habría entrado sin
   verificar sobre datos de dinero. **Queda como pregunta abierta** (§8, Q-I1).
7. **DESVIACIÓN declarada de R51 en «Saldos de tiendas»:** hoy ese listado **no tiene** criterio
   de ordenación —`groupBy` devuelve las filas en el orden que le conviene al planificador, que
   Postgres no garantiza estable entre llamadas—. Paginar exige un orden TOTAL o las páginas se
   solapan/omiten filas. Se ordena por **nombre de tienda**, con `tiendaId` de desempate, porque
   el nombre es el identificador de negocio de la fila (la FASE 1 ya dejó el `tienda_id` fuera
   del archivo de descarga por lo mismo). R51 no tenía aquí criterio que conservar.
8. **Las Server Actions entran en T I.1**, no en T I.2. Son código de servidor
   (`docs/architecture.md`: «Server Action = controlador») y sin ellas el frontend no tiene por
   dónde pedir la página 2. Ninguna toca UI.
9. **Cero migraciones y cero RLS nueva.** Los siete `WHERE` van sobre columnas que ya existen y
   los índices que usan son los que el listado sin paginar ya usaba
   (`[destinoTipo, destinoZonaId]`, `[mensajeroId]`, `cierre_bodega.zona_id`). Paginar reduce
   trabajo, no lo añade.
10. **Deuda D5.2 de la FASE 1 (`ListarOrdenesCompletoServiceResult` escrito a mano):
    NO se resuelve, y con razón.** La tanda H la dejó abierta «para la tanda I», pero esta task
    **no toca `OrdenService`** — órdenes no está en los 7 de riesgo BAJO (ya paginaba desde
    antes de la feature). Arreglarla aquí sería tocar el servicio más caliente del repo por un
    alias de tipo, fuera del alcance declarado y sin test que lo pida. **Sigue abierta**, ahora
    apuntando a quien toque `OrdenService` de verdad (tanda K, órdenes de bodega satélite).

---

## 7. Traspaso concreto a T I.2 (frontend)

Lo que el frontend tiene disponible, por pantalla:

| Pantalla | Server Action nueva | Schema (defaults) | Tamaño de página |
| --- | --- | --- | --- |
| `cierres-admin` (histórico) | `listarHistoricoCierresAdminPaginado(input)` — `lib/actions/cierres-admin.ts` | `listarHistoricoCierresAdminSchema` | `cierreConfig` |
| `cierres-admin` (bodega resueltos) | `listarHistoricoCierresBodegaPaginado(input)` — `lib/actions/cierre-bodega.ts` | `listarCierresBodegaPaginadoSchema` | `cierreBodegaConfig` |
| `cierres-admin` (consolidación, solicitados) | `listarCierresBodegaSolicitadosPaginado(input)` — `lib/actions/cierre-bodega.ts` | `listarCierresBodegaPaginadoSchema` | `cierreBodegaConfig` |
| `cierre-dia` (cierres solicitados) | `listarCierresPasadosPaginado(input)` — `lib/actions/cierre-dia.ts` | `listarCierresPasadosSchema` | `cierreConfig` |
| `incidentes` (histórico) | `listarHistoricoIncidentesPaginado(input)` — `lib/actions/incidentes.ts` | `listarHistoricoIncidentesSchema` | `incidentesConfig` |
| `wallet/tiendas` (saldos) | `listarSaldosTiendasPaginadoAction(input)` — `lib/actions/wallet-tienda.ts` | `listarSaldosTiendasPaginadoSchema` | `walletTiendaConfig` |
| `wallet` (plantillas gasto fijo) | `listarPlantillasPaginadoAction(input)` — `lib/actions/gasto-fijo-plantilla.ts` | `listarPlantillasGastoFijoPaginadoSchema` | `gastoFijoConfig` |

Todas devuelven `{ status: "ok", items, page, pageSize, total }` o
`forbidden` / `validation_error` / `unauthenticated`. Todas aceptan `input` **vacío** (`{}`) y
aplican los defaults, que es lo que la página 1 del Server Component necesita.

**Cinco cosas que T I.2 tiene que saber, y que no se pueden deducir del tipo:**

1. **El listado compuesto NO desaparece.** `listarCierresAdmin`, `listarCierresBodegaAdmin`,
   `listarConsolidacion`, `listarCierreDia` y `listarIncidentes` siguen siendo los que traen la
   cola de pendientes, los totales de dinero, `sinZona`, `puedesSolicitar`/`motivoBloqueo` y
   `tieneVencido`/`tieneRechazado`. La pantalla los sigue llamando; lo que cambia es que la
   tabla del histórico ya no pinta el array de esa respuesta, sino la página de la action nueva.
2. **Los tamaños de página salen de `lib/config/<dominio>.ts`**, nunca de un literal en la
   pantalla. Escribir `pageSize: 20` en `app/` pone roja la guardia de T H.1.
3. **`CierreDiaModule` es el caso delicado**, como avisó la tanda H: pagina UNA de sus dos
   tablas. Su contador `({filas.length})` de la vista agrupada está declarado `sin_paginar` en
   el registro de T H.3 y **debe seguir estándolo**; el que se pagina es «Cierres solicitados»,
   que no tiene contador.
4. **`CierresAdminModule` tiene una vista tipo factura que hace `[...pendientes, ...historico]`**
   (línea ~470). Si el histórico pasa a ser una página, esa vista deja de mostrar el histórico
   completo. **No está resuelto aquí**: es decisión de UI (paginarla con la tabla, o seguir
   alimentándola del listado compuesto). Hay que decidirlo explícitamente en T I.2.
5. **Los cuatro contadores de cabecera de la tanda J siguen intactos.** Esta tanda no toca las
   colas de pendientes; si T I.2 monta `<Pagination>` en un módulo que además tiene una de esas
   colas, la guardia de T H.3 se pondrá roja **a propósito** — es el recordatorio de que ese
   contador es de la tanda J, no de esta.

---

## 8. Preguntas abiertas (NO se rellenaron con supuestos)

**Q-I1 — ¿Se acepta que «Saldos de tiendas» recorte fuera de la base?** Ver §6.6. Es un
compromiso consciente: correcto y sin consultas nuevas, pero sin reducción de trabajo en
Postgres. La alternativa (`$queryRaw` con `GROUP BY … LIMIT/OFFSET` + `COUNT(DISTINCT)`) es
mejor en base y **no verificable** con la suite actual. Si el humano la quiere, debería venir
con una vía para probarla.

**Q-I2 — ¿Se acepta la desviación de R51 en «Saldos de tiendas»** (orden alfabético por nombre
donde hoy no hay orden)? Ver §6.7. Es la mínima que hace la paginación correcta, pero cambia lo
que el maestro ve hoy en esa pantalla.

**Q-I3 — La vista tipo factura de `CierresAdminModule`** (`[...pendientes, ...historico]`).
Descrita en §7.4. Es de UI y por eso no se tocó, pero nace de esta task.

**Heredadas y NO resueltas aquí:** «Cuentas por pagar a mensajeros» sigue sin dominio de
configuración (pregunta 1 de la tanda H, es de la tanda L). La deuda **D5.2** sigue abierta con
su razón escrita (§6.10). Q2 y Q5 siguen como las dejó la tanda H.

---

## 9. Archivos

**Nuevos (10)**

- `lib/utils/rango-pagina.ts` — `RangoPagina`, `PaginaRepositorio<T>`, `rangoDePagina()`.
- `lib/utils/colas-cierre.ts` — el corte cola/histórico, declarado una vez.
- `tests/unit/services/cierres-admin-historico-paginado.test.ts` (8)
- `tests/unit/services/cierres-bodega-admin-historico-paginado.test.ts` (6)
- `tests/unit/services/cierre-bodega-solicitados-paginado.test.ts` (8)
- `tests/unit/services/cierre-dia-pasados-paginado.test.ts` (7)
- `tests/unit/services/incidentes-historico-paginado.test.ts` (9)
- `tests/unit/services/saldos-tiendas-paginado.test.ts` (6)
- `tests/unit/services/gasto-fijo-plantillas-paginado.test.ts` (6)
- `tests/unit/repositories/historicos-paginados-where.test.ts` (9) — nace de la mutación 4.

**Modificados — producción (20)**

- Servicios (7): `CierresAdminService`, `CierresBodegaAdminService`, `CierreBodegaService`,
  `CierreDiaService`, `IncidenteAdminService`, `WalletTiendaService`, `GastoFijoPlantillaService`.
- Repositorios (7): `CierresAdminRepository`, `CierresBodegaAdminRepository`,
  `CierreBodegaRepository`, `CierreDiaRepository`, `IncidenteAdminRepository`,
  `WalletTiendaMovimientoRepository`, `GastoFijoPlantillaRepository`.
- Interfaces (13): las 7 de repositorio + las 6 de servicio correspondientes.
- Tipos (5): `cierres-admin.ts`, `cierre-bodega.ts`, `cierre.ts`, `incidente.ts`,
  `wallet-tienda.ts`, `gasto-fijo-plantilla.ts`.
- Actions (6): `cierres-admin.ts`, `cierre-bodega.ts`, `cierre-dia.ts`, `incidentes.ts`,
  `wallet-tienda.ts`, `gasto-fijo-plantilla.ts`.

**Modificados — tests ajenos (14), solo para declarar el método nuevo en su doble.** Añadir un
método a una interfaz de repositorio obliga a que los dobles lo declaren; el cambio es una línea
por doble y **ninguna aserción existente se tocó**. En `lib/actions/cierre-dia.ts` además se
renombró `toDeshacerGestionActionError` → `toCierreDiaActionError` (función local, no exportada):
ahora la comparten dos bordes con zod y el nombre de una sola acción mentía.

**Cero UI, cero migraciones, cero RLS, cero cambios de esquema.**

---

## 10. Puertas (medición final, salida real)

```
$ npx tsc --noEmit
=== typecheck exit: 0 ===

$ npx eslint
✖ 21 problems (0 errors, 21 warnings)
=== lint exit: 0 ===
(baseline de la tanda H: 18 warnings. Las 3 nuevas son `_args`/`_mensajeroId` sin usar en los
tests nuevos, el MISMO patrón que ya tienen `api-key-repository.test.ts`,
`google-adc-token.test.ts` y `deshacer-asignacion.historial.test.ts`.)

$ npx vitest run
 Test Files  734 passed (734)
      Tests  8853 passed (8853)
   Duration  213.13s
```

Suite completa **en verde a la primera**, sin flakes (el conocido `OrdenesModuleReuse` pasó).
Baseline de la tanda H: 726 archivos / 8794 tests → **+8 archivos y +59 tests**.

---

## 11. Veredicto

Los 7 listados de riesgo BAJO paginan en el servidor con el mismo acotamiento por actor que
tenían, verificado por mutación en los dos puntos calientes; el WHERE quedó cubierto porque una
mutación demostró que no lo estaba.
