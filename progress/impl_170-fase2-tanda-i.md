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

---
---

# T I.2 — Frontend: `Pagination` + `initialData` en los 7 listados de riesgo BAJO

**Rama:** `feature/170-fase2-tanda-i` · **Fecha:** 2026-08-01 · **Rol:** `frontend_dev`
**Alcance:** SOLO UI. Cero cambios en `lib/services/`, `lib/repositories/` y cero cambios de
comportamiento en las Server Actions (no se encontró ningún defecto en lo que dejó T I.1).

Todo lo que sigue está MEDIDO. Las tres mutaciones se ejecutaron y se revirtieron; una de ellas
pasó VERDE y por eso el test de R44 cambió de forma antes de darse por bueno.

---

## 12. Qué se entrega, listado a listado

| # | Listado | Dónde vive la tabla + el control | Nombre accesible del control (R43) |
| --- | --- | --- | --- |
| 1 | Cierres del día — histórico | `CierresAdminHistoricoTabla.tsx` (nuevo) | Paginación del histórico de cierres del día |
| 2 | Cierres de bodega resueltos | `CierresBodegaResueltosTabla.tsx` (nuevo) | Paginación de los cierres de bodega resueltos |
| 3 | Cierres de bodega solicitados | `CierresBodegaSolicitadosTabla.tsx` (nuevo) | Paginación de los cierres de bodega solicitados |
| 4 | Cierres solicitados del mensajero | `CierreDiaModule.tsx` (en el módulo) | Paginación de los cierres solicitados |
| 5 | Incidentes — histórico | `IncidentesHistoricoTabla.tsx` (nuevo) | Paginación del histórico de incidentes |
| 6 | Saldos de tiendas | `SaldosTiendasTable.tsx` | Paginación de los saldos por tienda |
| 7 | Plantillas de gasto fijo | `GastosFijosPlantillasPanel.tsx` | Paginación de las plantillas de gasto fijo |

Los cinco Server Components (`cierres-admin`, `cierre-dia`, `incidentes`, `wallet`,
`wallet/tiendas`) pre-cargan la PÁGINA 1 con la Server Action paginada de T I.1 (input vacío:
los defaults los pone el schema del dominio) y la bajan por props. Los módulos cliente montan
SWR con esa página como `fallbackData` y `<Pagination>` alimentado por el `total` del servidor.
Molde: `UsuariosModule`, tal cual.

---

## 13. Cuatro decisiones de estructura, con su motivo

**13.1 — Cuatro históricos SE MUDAN a su propio archivo.** No es cosmética: los módulos
`CierresAdminModule`, `CierresBodegaAdminModule`, `ConsolidacionBodegaModule` e
`IncidentesAdminModule` muestran, junto al histórico, el contador de SU cola de pendientes, que
hoy es correcto —ese array sigue siendo el conjunto entero— y que la **tanda J** debe sustituir
por el `total` del servidor. La guardia de T H.3 prohíbe, con razón, que un contador derivado de
un array conviva con un control de paginación en el mismo archivo, y T I.1 avisó (§7.5) de que
se pondría roja. Se pondría roja **por el archivo, no por el hecho**: el número sigue siendo
verdadero. Separar el listado que pagina del que no lo hace es lo que mantiene ciertas las dos
cosas a la vez.

Para que la separación no abra un agujero silencioso, la verdad se afirma además **por
comportamiento**: `BajoRiesgoPaginacion.test.tsx::el contador de la cola que NO pagina sigue
contando el conjunto entero (R42)`. La guardia estática vigila el patrón; ese test vigila el
número.

Las tablas MUDADAS se re-registran en `censo-tablas.ts` (30 instancias, 25 → **29 archivos**:
ninguna tabla nace ni muere) y las cuatro rutas nuevas se añaden a `PANTALLAS_ANEXO_III` de la
guardia de literales de T H.1 — si no, dejaría de vigilar exactamente los archivos donde hoy se
escribiría un `pageSize` a mano.

**13.2 — `CierreDiaModule` conserva su control DENTRO del módulo.** Su contador —derivado de
`filas.length` en la vista agrupada por resultado— es del **Anexo IV** y está declarado
`sin_paginar` en el censo de T H.3, con una nota que ya anticipaba este momento. Dejarlo aquí es
lo que hace que esa exclusión se EJERCITE de verdad en vez de quedar decorativa.

**13.3 — `CierresAdminHistoricoTabla` es CONTROLADO; los otros tres piden su propia página.**
En esa pantalla, DOS lecturas pintan los mismos cierres (la tabla y la vista tipo factura). Si
cada una pidiera su página, las dos lecturas de los MISMOS cierres podrían mostrar cosas
distintas. La página se pide una vez, en el módulo, y las dos la leen.

**13.4 — `destinoCierre` sale a `cierre-labels.ts`.** El texto «tipo · zona» estaba escrito dos
veces (módulo y columnas de descarga) y la mudanza lo habría llevado a tres. Mismo motivo por el
que la tanda E sacó `DESTINO_TIPO_LABEL`: que la pantalla y el archivo no puedan divergir (R8).

---

## 14. R52: cómo sigue siendo el CONJUNTO COMPLETO

Es el punto crítico de esta task. Antes, estas siete tablas eran **Familia B**: recibían el
dataset entero por props y el archivo se proyectaba de lo que la tabla pintaba
(`filasLocales(loQueSePinta)`). Al paginar, esa MISMA línea pasa a significar «descargá lo que
se ve» y no falla en ninguna parte: el archivo sale, con 25 filas de 300.

Nace **`filasDelConjuntoCompleto`** en `components/shared/descarga-resultado.ts`, hermano de los
dos adaptadores de la FASE 1: **relee** el conjunto del servidor al pulsar el control —una
lectura más, y sólo cuando el usuario descarga— y lo proyecta con el MISMO `filasLocales`, para
no perder el tope de 5000 ni su mensaje accionable (R26/R27/R28). No se usa
`filasDesdeResultado` porque estos siete no tienen modo «completo» con tope server-side: sin
`filasLocales` la descarga se quedaría sin tope ninguno, justo en los históricos que crecen sin
techo.

Lo que se relee es **el mismo listado que la pantalla ya llamaba antes de paginar**
(`listarCierresAdmin`, `listarCierresBodegaAdmin`, `listarConsolidacion`, `listarCierreDia`,
`listarIncidentes`, `listarSaldosTiendasAction`, `listarPlantillasAction`): mismo acotamiento
por actor, resuelto server-side desde la sesión. Descargar no amplía el alcance ni una fila
(R14/R44), y no hizo falta tocar ninguna Server Action.

**La alternativa que se descartó:** seguir recibiendo el array completo por props sólo para la
descarga. Habría dejado R52 verde sin escribir una línea, y habría convertido la paginación en
maquillaje: el dataset entero seguiría cruzando a la pantalla en cada render, que es
exactamente lo que la decisión P6 viene a quitar (design §11.7, A8).

---

## 15. Q-I3 — La vista tipo factura de `CierresAdminModule`

**Decisión: la previsualización SIGUE A LA TABLA.** Muestra la cola de pendientes completa más
la **página visible** del histórico, no el histórico entero.

**Por qué.** La frase que define esa sección es suya: «los mismos cierres de arriba leídos como
comprobante». Con el histórico paginado sólo hay tres salidas coherentes:

1. **Seguir a la tabla** (elegida): la frase sigue siendo literalmente cierta y la sección queda
   acotada, como la tabla.
2. **Alimentarla del conjunto entero**: sería la ÚNICA razón por la que el histórico completo
   seguiría cruzando a la pantalla —una tarjeta por cierre, para siempre—, justo lo que esta
   fase viene a quitar.
3. **Quitarle el histórico y dejar sólo la cola**: descartada porque la sección es un A/B
   pendiente de decisión HUMANA (la 38 la dejó «para comparar las dos lecturas antes de decidir
   cuál se queda»); mutilar la mitad de la comparación sería decidir por el humano.

**SÍ cambia lo que el usuario ve, y hay que decirlo:** los cierres resueltos que caen fuera de
la página dejan de aparecer como tarjeta en esa tira. No se pierde nada: el comprobante de
cualquiera de ellos sigue a un clic, en el detalle, que monta el MISMO componente
(`CierreFacturaDetalle`). Y al cambiar de página, la previsualización cambia con ella.

Afirmado en `BajoRiesgoPaginacion.test.tsx::Q-I3: la vista tipo factura sigue a la tabla del
histórico, no al conjunto entero`.

---

## 16. Las tres mutaciones, con su salida real

**Todas revertidas** (`grep MUTACION app/` sin resultados; suite verde después de cada una).

| # | Mutación | Resultado medido |
| --- | --- | --- |
| 1 | **R52**: `obtenerFilas` del histórico de cierres pasa a `filasLocales(pagina.items, …)` — «descargá lo que ves» | **ROJO (1)**: `Cierres del día — histórico: el archivo trae la PÁGINA, no el conjunto: expected [ … ] to have a length of 60 but got 25` |
| 2 | **R44**: se quita el `fallbackData` de la página que pre-cargó el Server Component | **VERDE (6 pasan)** → ver abajo. Con el test endurecido: **ROJO**, `Cierres del día — histórico: expected [ Array(2) ] to have a length of 26 but got 2` |
| 3 | **R43**: se quita el `ariaLabel` del control del histórico de incidentes | **ROJO (2)**: `Unable to find role="navigation" and name "Paginación del histórico de incidentes"` |

### La mutación que cambió la entrega

La 2 pasó **VERDE**, y el motivo importa: el test de R44 buscaba la tabla con `findByRole`
(asíncrono). Sin `fallbackData`, la pantalla enseña un **esqueleto** y las filas aparecen después
de un viaje al servidor por un dato que ya venía en la respuesta de la página; el `await` daba
eso por bueno. R44 dice «el usuario ve exactamente las mismas filas que antes», y «antes» era el
PRIMER pintado.

El test se endureció a `getByRole` **sin `await`**: las 25 filas tienen que estar en el primer
render. Con eso la mutación se pone roja.

De ahí salió además un arreglo de producción que no estaba previsto: `isLoading` de SWR sigue
siendo `true` mientras revalida **aunque haya `fallbackData`**, así que pasarlo tal cual al
`DataTable` hacía que la página 1 apareciera como esqueleto antes de enseñar las filas. Los siete
listados derivan ahora `const cargando = data === undefined`: esqueleto sólo cuando no hay
literalmente nada que pintar (o sea, al saltar a una página aún no leída).

---

## 17. Mapa `R<n> → archivo::test`

Prefijo `P/` = `tests/components/paginacion/BajoRiesgoPaginacion.test.tsx`.

| R | Test |
| --- | --- |
| **R43** | `P/::cada listado navega entre páginas y el control tiene nombre accesible (R43)` — los 7, por rol y nombre; ida y vuelta |
| **R43** | `P/::los siete están cubiertos: ni uno se queda fuera del recorrido` (anti-vacuidad + los 7 nombres de control son distintos entre sí) |
| **R44** | `P/::el usuario ve exactamente las mismas filas que antes en la página 1 (R44)` — los 7, en el PRIMER pintado |
| **R52** | `P/::la descarga sigue entregando el dataset completo, no la página (R52)` — los 7, descargando DESDE la página 2 |
| **R52** | `tests/components/descarga/WalletPropsDescarga.test.tsx::las dos que paginan NO proyectan la página: releen el conjunto completo` (guardia estática, contraparte exacta de la de FASE 1) |
| **R42** | `P/::el contador de la cola que NO pagina sigue contando el conjunto entero (R42)` — no es de esta task; se afirma porque la mudanza de §13.1 saca ese contador del alcance de la guardia estática |
| **Q-I3** | `P/::Q-I3: la vista tipo factura sigue a la tabla del histórico, no al conjunto entero` |

**R40/R41 no se declaran cubiertos aquí** (son de T I.1, a nivel de servicio); la pantalla los
consume: el `total` del control sale del servidor y el `pageSize` de `lib/config/<dominio>.ts`.
**R45–R51, R53, R54 no entran en esta task.**

---

## 18. Puertas (medición final, salida real)

```
$ npx tsc --noEmit
=== typecheck exit: 0 ===

$ npx eslint
✖ 21 problems (0 errors, 21 warnings)
(baseline de T I.1: 21 warnings. NINGUNA nueva.)

$ npx vitest run
 Test Files  735 passed (735)
      Tests  8860 passed (8860)
   Duration  212.12s
```

Suite completa en verde, sin flakes (el conocido `OrdenesModuleReuse` pasó en las tres
ejecuciones completas). Baseline de T I.1: 734 archivos / 8853 tests → **+1 archivo y +7 tests**
(6 del archivo nuevo + 1 que nace al partir en dos la guardia estática de `WalletPropsDescarga`).

---

## 19. Archivos

**Nuevos (6)**

- `app/(app)/cierres-admin/_components/CierresAdminHistoricoTabla.tsx`
- `app/(app)/cierres-admin/_components/CierresBodegaResueltosTabla.tsx`
- `app/(app)/cierres-admin/_components/CierresBodegaSolicitadosTabla.tsx`
- `app/(app)/incidentes/_components/IncidentesHistoricoTabla.tsx`
- `tests/components/paginacion/BajoRiesgoPaginacion.test.tsx` (6 tests)
- `tests/fixtures/pagina-inicial.ts` — fixture de la página inicial, con `total` fijable aparte
  para que ningún test confunda «el total del conjunto» con «las filas de la página».

**Modificados — producción (16)**

- Páginas (5): `cierres-admin`, `cierre-dia`, `incidentes`, `wallet`, `wallet/tiendas`.
- Módulos (8): `CierresAdminModule`, `CierresBodegaAdminModule`, `ConsolidacionBodegaModule`,
  `CierreDiaModule`, `IncidentesAdminModule`, `WalletModule`, `SaldosTiendasTable`,
  `GastosFijosPlantillasPanel`.
- Compartidos (3): `components/shared/descarga-resultado.ts` (+`filasDelConjuntoCompleto`),
  `cierre-labels.ts` (+`destinoCierre`), `cierres-admin-descarga-columnas.ts` (lo consume).

**Modificados — tests ajenos (20).** Tres motivos, ninguno afecta a una aserción existente:
(a) la prop deja de ser un array y pasa a ser la página; (b) hace falta el doble de la Server
Action paginada, porque SWR revalida al montar; (c) la caché de SWR se aísla por render
(`SWRConfig` con `provider` propio) —la clave de la página 1 es la misma en todos los casos de un
archivo y el dato del caso anterior ganaba sobre el `fallbackData` del siguiente—.

Tres guardias se actualizan **a propósito**, y se dice por qué en cada una:
`censo-tablas.ts` + `cobertura-tablas.guardia` (25 → 29 archivos, mismas 30 instancias),
`paginacion-dominios.test.ts` (`PANTALLAS_ANEXO_III` sigue a las tablas mudadas) y
`ControlDescargaTransversal.test.tsx` (el barrido reconoce el tercer adaptador; el tope sigue
viviendo en un solo sitio, porque `filasDelConjuntoCompleto` delega en `filasLocales`).
En `WalletPropsDescarga.test.tsx` la guardia «ninguna de las tres relee del servidor» se PARTE en
dos: la que no pagina sigue sin releer, y las dos que paginan tienen ahora la afirmación
CONTRARIA y explícita (R52).

**Cero cambios en `lib/services`, `lib/repositories`, Server Actions, migraciones y RLS.**

---

## 20. Preguntas abiertas de T I.2

**Q-I4 — Mientras el listado compuesto siga trayendo el histórico entero, cada una de estas
pantallas hace DOS consultas más por render** (la página y su conteo) además de las que ya
hacía: el compuesto sigue leyendo cola e histórico en una sola consulta y partiéndolos en
memoria (T I.1 §2). Lo que esta tanda reduce **ya** es lo que cruza a la pantalla —el array
entero deja de viajar— y lo que el navegador renderiza. La reducción en base llega cuando el
compuesto deje de devolver el histórico, y eso es backend: cae en la **tanda J** (que pagina la
otra mitad de esas mismas respuestas) o en la **M**. No se hizo aquí porque tocar
`listarCierresAdmin` y compañía está fuera del alcance declarado de T I.2 y rompería a la cola
antes de que la J la sostenga.

**Q-I5 — La descarga de tres de los siete relee un listado CARO.** `listarCierreDia` firma las
URL de evidencia de todas las gestiones del día y `listarConsolidacion` calcula los agregados de
la zona; descargar el histórico dispara ese trabajo entero para quedarse sólo con un array.
Ocurre una vez por clic en «Descargar», no por render, y es el único origen del conjunto completo
que existe hoy sin tocar backend (estos siete no tienen `listarCompleto`, T I.1 §2). Un
`listarXCompleto` dedicado —el que design §11.5 daba por hecho— lo dejaría fino; queda propuesto,
no inventado.

**Q-I6 — El agujero que abre la mudanza de §13.1, declarado.** La guardia de T H.3 mira hacia
ABAJO (del archivo que monta el control a los componentes de tabla que importa), nunca hacia
arriba. Con el listado paginado en un hijo, un contador del padre queda fuera de su vista. Hoy
está cubierto por comportamiento (§13.1), pero si la **tanda J** pagina las colas desde otro
componente hijo y deja el contador en el módulo, la guardia no la parará. Dos salidas, y la
elección es de quien haga la J: paginar la cola EN el módulo (la guardia la ve y se pone roja
hasta que el contador use el `total`), o ensanchar `pantallasPaginadas()` para que suba por los
imports —lo que exige que las cuatro entradas `pendiente` del censo ya estén resueltas—.

**Heredadas y NO resueltas aquí:** Q-I1 (saldos recorta fuera de la base), Q-I2 (desviación de
R51 en saldos), la deuda **D5.2** y las preguntas de la tanda H siguen exactamente como las dejó
T I.1.

---

## 21. Veredicto

Los 7 listados de riesgo BAJO paginan en pantalla con la página que pre-carga el servidor, su
control tiene nombre propio y la descarga sigue entregando el conjunto completo —verificado por
mutación en los tres puntos, incluida una que pasó verde y obligó a endurecer el test de R44
antes de darlo por bueno.
