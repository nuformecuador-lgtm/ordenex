# impl — Feature 170, FASE 2, Tanda J (T J.1: backend de las 4 colas de riesgo MEDIO)

**Rama:** `feature/170-fase2-tanda-j` · **Fecha:** 2026-08-01 · **Rol:** `backend_dev`
**Alcance:** SOLO T J.1 (servidor). **Cero UI**: T J.2 es de otro agente y no se toco `app/**`
ni `components/**`.

Todo lo que sigue esta MEDIDO. Las ocho mutaciones se ejecutaron y se revirtieron.

---

## 0. Baseline medido AL EMPEZAR

```
$ git branch --show-current
feature/170-fase2-tanda-j        (rama ya creada; no se hizo checkout de ninguna otra)
$ git status --short
(limpio)
$ npx tsc --noEmit
=== typecheck exit: 0 ===
```

---

## 1. Que se entrega, cola a cola

Las 4 del riesgo MEDIO (`design.md §11.3`). Cada una gana metodo de repositorio, metodo de
servicio, schema zod `.strict()` y Server Action — mismo procedimiento que T I.1.

| # | Cola | Servicio · metodo nuevo | Repositorio · metodo nuevo | Acotamiento por actor |
| --- | --- | --- | --- | --- |
| 1 | Cierres del dia pendientes | `CierresAdminService.listarPendientesCierresAdminPaginado` | `findColaPaginada(alcance, rango)` | `resolveAlcance` (rol + zona destino) |
| 2 | Cierres de bodega pendientes | `CierresBodegaAdminService.listarPendientesCierresBodegaPaginado` | `findColaPaginada(rango)` | `esAccesoTotal` |
| 3 | Cierres del dia a consolidar | `CierreBodegaService.listarConsolidablesPaginado` | `findCierresDiaConsolidablesPaginado(zonaId, rango)` | rol `adminSatelite` + `findUsuarioZonaId` |
| 4 | Incidentes pendientes | `IncidenteAdminService.listarPendientesIncidentesPaginado` | `findColaPaginada(alcance, rango)` | `resolveAlcance` (rol + zona de la ORDEN) |

Las 4 devuelven `ListarPaginadoServiceResult<T>` (T H.2) en la interfaz y
`ListarPaginadoResult<T, E>` en el borde. **Ni un campo extra** — y en la 3 esa regla es lo que
protege el dinero (§3).

---

## 2. La particion: `in` aqui, `notIn` alla, y la MISMA lista

Tres de las cuatro colas son la otra mitad de una particion que T I.1 ya pagino por el lado del
historico. El corte vive desde entonces en `lib/utils/colas-cierre.ts` y **no se reimplemento**:

- el historico escribe `estado: { notIn: [...COLA] }` — el espejo del `else` del servicio;
- la cola escribe `estado: { in: [...COLA] }` — el espejo del `if`.

Las dos leen **la misma constante**. Si no lo hicieran, una fila podria quedar en las dos
pantallas o —lo grave— en **ninguna**: un `cierre_dia` en estado `vencido` que se cayera de las
dos deja bloqueada la bodega de su mensajero, y nadie lo ve para destrabarlo. Eso se afirma
explicitamente en `colas-paginadas-where.test.ts::la cola y el historico PARTICIONAN el
conjunto`, que compara las dos listas y ademas exige que el resto del `where` (el ALCANCE) sea
identico en las dos mitades.

La cuarta cola (consolidables) no se parte: es un conjunto propio con cuatro predicados. Ver §3.

---

## 3. R49 — el riesgo de esta tanda, y donde vive de verdad

### 3.1 Lo que se midio antes de escribir codigo

`design.md §11.3` dice que en las tres pantallas de cierres los totales de dinero llegan por
props ya calculadas server-side y que «paginar no los toca». Se verifico pantalla por pantalla y
el resultado es mas preciso que eso:

| Cola | Agregado de dinero derivado del array | Verificado en |
| --- | --- | --- |
| Cierres del dia pendientes | **ninguno** | `CierresAdminModule.tsx` — el dinero va por FILA; no hay panel de totales de la cola |
| Cierres de bodega pendientes | **ninguno** | `CierresBodegaAdminModule.tsx` — sus tres paneles (`TotalesPanel`, `PagoMensajeroTotal`, `IngresoBodegaRechazosTotal`) viven DENTRO del modal de detalle de UN cierre, alimentados por `verCierreBodegaDetalle` |
| **Cierres del dia a consolidar** | **CINCO** | `ConsolidacionBodegaModule.tsx:135-162` |
| Incidentes pendientes | **ninguno** | `IncidentesAdminModule.tsx` — solo `money(detalle.indemnizacion)` de una fila abierta |

O sea: **todo el riesgo de R49 de esta tanda esta concentrado en la cola de consolidables**, y
alli es serio.

### 3.2 Por que `listarConsolidablesPaginado` NO devuelve totales

Los cinco agregados (`totalesAgregados`, `totalPagoMensajeroAgregado`,
`totalIngresoBodegaRechazosAgregado`, `totalNetoAgregado`, `totalCentralDebeAgregado`) siguen
saliendo de `listarConsolidacion`, calculados sobre el conjunto COMPLETO. El metodo paginado
recorta lo que la tabla PINTA y no toca el dinero.

No es solo disciplina: **dos de los cinco no son una suma**. `totalNetoAgregado` y
`totalCentralDebeAgregado` salen de `repartirEfectivo`, que ordena los pagos INDIVIDUALES de
menor a mayor y paga de forma atomica mientras el efectivo alcanza. Ese reparto necesita la
lista entera — ni una pagina ni un `SUM` en Postgres lo producen. Por eso la alternativa
«empujar la agregacion a la base» ni siquiera resolveria el caso, y por eso el conjunto completo
se sigue leyendo donde se calcula el dinero.

Con los datos del test (5 consolidables, pageSize 2) la diferencia no es de redondeo:

| | conjunto completo | pagina 1 |
| --- | --- | --- |
| efectivo | 380.00 | 300.00 |
| general | 411.00 | 310.00 |
| pago a mensajeros | 600.00 | 70.00 |
| neto | 311.00 | 240.00 |
| **la central debe** | **500.00** | **0.00** |

El ultimo es el que define la tanda: sobre la pagina visible la pantalla diria que la central no
debe nada cuando debe 500, y sobre ese numero se decide si se cierra la bodega.

### 3.3 Las dos guardias que lo sostienen

1. **De comportamiento:** `consolidables-paginado.test.ts::los totales agregados de dinero
   siguen calculandose sobre el conjunto completo (R49)` afirma los cinco valores del conjunto,
   afirma que **ninguno** coincide con el de la pagina, recorre las paginas y comprueba que el
   dinero de todas juntas es el del listado entero.
2. **Estructural:** ese mismo test exige que `listarConsolidacion` **no llame** a
   `findCierresDiaConsolidablesPaginado`. Si manana alguien «optimiza» el compuesto haciendolo
   leer una pagina, esa linea se pone roja antes que ninguna otra (medido: mutacion 2).

Ademas, `consolidablesWhere(zonaId)` se EXTRAJO para que la pagina y el listado entero compartan
los cuatro predicados. Si a la pagina le faltara `cierreBodegaId: null`, la tabla mostraria
cierres ya consolidados que el total no cuenta: dos numeros de dinero que no cuadran, sin aviso
(medido: mutacion 7).

En las otras tres colas R49 se afirma en su forma verificable: el dinero del CONJUNTO no cambia
al paginar (ni una fila duplicada entre paginas ni caida entre dos), la suma de una sola pagina
NO llega a ese numero —los datos abarcan 3 paginas a proposito— y los montos por fila son el
MISMO snapshot, string a string, sin recomputar.

---

## 4. Las ocho mutaciones, con su salida real

**Todas revertidas** (`grep MUTACION lib/ tests/` sin resultados propios; suite completa verde
despues).

| # | Mutacion | Resultado medido |
| --- | --- | --- |
| 1 | **R49**: los cinco agregados de `listarConsolidacion` se calculan sobre `consolidables.slice(0, 2)` (la pagina visible) | **ROJO (1)**: `expected { efectivo: '300.00', …(3) } to deeply equal { efectivo: '380.00', …(3) }` |
| 2 | **R49 estructural**: `listarConsolidacion` se alimenta de `findCierresDiaConsolidablesPaginado` | **ROJO (4)**: R44, R51, R54 y `expected { efectivo: '300.00', …(3) } to deeply equal { efectivo: '380.00', …(3) }` |
| 3 | **Actor**: `listarConsolidablesPaginado` pasa una zona fija `"z-b"` en vez de la del actor | **ROJO (6)**: `expected [ 'cb-1', 'cb-2' ] to deeply equal [ 'ca-1', 'ca-2' ]` · `expected '3000.00' to be '411.00'` |
| 4 | **Actor**: la cola de cierres del dia pasa un alcance fijo `bodega_central` | **ROJO (2)**: `rol adminSatelite/u-sat-a: expected [ Array(5) ] to deeply equal [ 'sa-2', 'sa-1' ]` |
| 5 | `total: items.length` en la cola de incidentes | **ROJO (2)**: `pagina 1: expected 3 to be 5` · `rol maestro: el total es el del conjunto: expected +0 to be 7` |
| 6 | **WHERE**: `in: [...ESTADOS_COLA_CIERRE_DIA]` → `in: ["solicitado"]` (el `vencido` se cae de la cola) | Servicio: **VERDE (9 pasan)** · WHERE: **ROJO (3)**, `cierres del dia: la cola: expected [ 'solicitado' ] to deeply equal [ 'solicitado', 'vencido' ]` |
| 7 | **WHERE**: `consolidablesWhere` pierde `cierreBodegaId: null` | Servicio: **VERDE (9 pasan)** · WHERE: **ROJO (1)**, `expected { estado: 'aprobado', …(2) } to deeply equal { estado: 'aprobado', …(3) }` |
| 8 | Guard `esAccesoTotal` DESPUES de consultar la base (cola de bodega) | **ROJO (1)**: `rol adminSatelite: expected [ 'findColaPaginada' ] to deeply equal []` |

Las dos que el encargo exigia —R49 y el acotamiento por actor— son la 1/2 y la 3/4/8.

**Las mutaciones 6 y 7 son la razon de ser de `colas-paginadas-where.test.ts`.** Confirman,
medido en esta tanda, el aviso de T I.1: los tests de servicio usan DOBLES y no ven la
traduccion del acotamiento a SQL. Un `WHERE` roto pasa entero por ellos. Los dos tests de
servicio quedaron en 9/9 verdes con la base mintiendo.

---

## 5. Mapa `R<n> → archivo::test`

Prefijos: `S/` = `tests/unit/services/`, `R/` = `tests/unit/repositories/`.

| R | Test |
| --- | --- |
| **R40** | `S/cierres-admin-pendientes-paginado.test.ts::devuelve la pagina pedida y el total del conjunto (R40, R41)` |
| **R40** | `S/cierres-admin-pendientes-paginado.test.ts::acota el tamano de pagina al maximo configurado y nunca lo excede (R40)` |
| **R40** | `S/cierres-bodega-pendientes-paginado.test.ts::devuelve la pagina pedida y el total del conjunto (R40, R41)` |
| **R40** | `S/cierres-bodega-pendientes-paginado.test.ts::acota el tamano de pagina al maximo configurado y nunca lo excede (R40)` |
| **R40** | `S/consolidables-paginado.test.ts::devuelve la pagina pedida y el total del conjunto (R40, R41)` |
| **R40** | `S/consolidables-paginado.test.ts::acota el tamano de pagina al maximo configurado y nunca lo excede (R40)` |
| **R40** | `S/incidentes-pendientes-paginado.test.ts::devuelve la pagina pedida y el total del conjunto (R40, R41)` |
| **R40** | `S/incidentes-pendientes-paginado.test.ts::acota el tamano de pagina al maximo configurado y nunca lo excede (R40)` |
| **R41** | Los cuatro `S/*-paginado.test.ts::devuelve la pagina pedida y el total del conjunto (R40, R41)` (cada uno afirma `total !== items.length` en la ultima pagina) |
| **R41** | `R/colas-paginadas-where.test.ts::cierres del dia — cola: alcance + estados DE la cola, mismo where en pagina y conteo` |
| **R41** | `R/colas-paginadas-where.test.ts::cierres del dia — cola: el acceso total NO emite destinoZonaId (ve toda la central)` |
| **R41** | `R/colas-paginadas-where.test.ts::cierres de bodega — cola: solo \`solicitado\`, y los RECHAZADOS quedan fuera` |
| **R41** | `R/colas-paginadas-where.test.ts::incidentes — cola: el acceso total no emite filtro de zona` |
| **R44** | `S/cierres-admin-pendientes-paginado.test.ts::el conjunto paginado y el dataset completo coinciden para el mismo actor (R44)` |
| **R44** | `S/cierres-admin-pendientes-paginado.test.ts::CONTRAPRUEBA de R44: cada actor ve LO SUYO y nada del vecino` |
| **R44** | `S/cierres-admin-pendientes-paginado.test.ts::CONTRAPRUEBA de R44: el rol sin acceso recibe forbidden sin filas ni total` |
| **R44** | `S/cierres-admin-pendientes-paginado.test.ts::el adminSatelite SIN zona recibe una pagina vacia y no consulta la base (R44)` |
| **R44** | `S/cierres-bodega-pendientes-paginado.test.ts::el conjunto paginado y el dataset completo coinciden para el mismo actor (R44)` |
| **R44** | `S/cierres-bodega-pendientes-paginado.test.ts::CONTRAPRUEBA de R44: forbidden sin filas ni total a todo rol sin acceso total` |
| **R44** | `S/consolidables-paginado.test.ts::el conjunto paginado y el dataset completo coinciden para el mismo actor (R44)` |
| **R44** | `S/consolidables-paginado.test.ts::CONTRAPRUEBA de R44: cada bodega ve la SUYA y ninguna de la vecina` |
| **R44** | `S/consolidables-paginado.test.ts::CONTRAPRUEBA de R44: forbidden sin filas ni total a todo rol que no sea adminSatelite` |
| **R44** | `S/consolidables-paginado.test.ts::el adminSatelite SIN zona recibe una pagina vacia y no consulta la base (R44)` |
| **R44** | `S/incidentes-pendientes-paginado.test.ts::el conjunto paginado y el dataset completo coinciden para el mismo actor (R44)` |
| **R44** | `S/incidentes-pendientes-paginado.test.ts::CONTRAPRUEBA de R44: cada zona ve la SUYA, el acceso total las ve todas` |
| **R44** | `S/incidentes-pendientes-paginado.test.ts::CONTRAPRUEBA de R44: forbidden sin filas, sin total y sin tocar el storage` |
| **R44** | `S/incidentes-pendientes-paginado.test.ts::el adminSatelite SIN zona recibe una pagina vacia, sin base ni storage (R44)` |
| **R44** | `R/colas-paginadas-where.test.ts::incidentes — cola: alcance por la zona de la ORDEN + estado de la cola` |
| **R44** | `R/colas-paginadas-where.test.ts::cierres del dia a consolidar: los CUATRO predicados del conjunto que da los totales` |
| **R44** | `R/colas-paginadas-where.test.ts::la cola y el historico PARTICIONAN el conjunto: mismo criterio, uno el complemento del otro` |
| **R44** | `R/colas-paginadas-where.test.ts::el conjunto CONSOLIDABLE se declara una sola vez: la pagina y el listado entero lo comparten` |
| **R49** | `S/consolidables-paginado.test.ts::los totales agregados de dinero siguen calculandose sobre el conjunto completo (R49)` — **el de la tanda**: los 5 agregados, la desigualdad contra la pagina, el recorrido completo y la guardia estructural |
| **R49** | `S/cierres-admin-pendientes-paginado.test.ts::los totales agregados de dinero siguen calculandose sobre el conjunto completo (R49)` |
| **R49** | `S/cierres-bodega-pendientes-paginado.test.ts::los totales agregados de dinero siguen calculandose sobre el conjunto completo (R49)` |
| **R49** | `S/incidentes-pendientes-paginado.test.ts::los totales agregados de dinero siguen calculandose sobre el conjunto completo (R49)` |
| **R49** | `R/colas-paginadas-where.test.ts::cierres del dia a consolidar: los CUATRO predicados del conjunto que da los totales` (el `where` de la pagina es EL MISMO sobre el que se agrega el dinero) |
| **R51** | `S/cierres-admin-pendientes-paginado.test.ts::conserva el criterio de ordenacion actual: solicitadoAt descendente (R51)` |
| **R51** | `S/cierres-bodega-pendientes-paginado.test.ts::conserva el criterio de ordenacion actual: solicitadoAt descendente (R51)` |
| **R51** | `S/consolidables-paginado.test.ts::conserva el criterio de ordenacion actual (R51)` |
| **R51** | `S/incidentes-pendientes-paginado.test.ts::conserva el criterio de ordenacion actual: createdAt descendente (R51)` (incluye `esPropio`, que la pagina no puede mover) |
| **R54** | Los cuatro `S/*-paginado.test.ts::no ejecuta mas consultas que el listado sin paginar, salvo el conteo (R54)` |
| **R54** | `R/colas-paginadas-where.test.ts::ninguna de las cuatro colas pide mas de dos consultas: la pagina y el conteo (R54)` |
| **R46** | `S/incidentes-pendientes-paginado.test.ts::no ejecuta mas consultas... (R54)` afirma ademas UNA sola llamada al storage, con N acotado por el tamano de pagina (no es de esta task; se afirma porque la pagina firma menos paths que el listado entero) |

**R42, R43, R45, R47, R48, R50, R52, R53 NO entran en esta task** y no se declaran cubiertos:
son T J.2 y las tandas K/L.

---

## 6. Decisiones tomadas al implementar

1. **El contrato no gana campos, y aqui eso protege dinero.** La tentacion en consolidables era
   devolver la pagina Y los cinco agregados. No se hizo: (a) invitaria a calcularlos sobre
   `items`; (b) dos de ellos no se pueden calcular desde una pagina; (c) si viajaran con la
   pagina, cambiar de pagina los volveria a pedir y podrian parpadear — R50 se cumple gratis
   manteniendolos fuera.
2. **`listarConsolidacion` y los otros tres listados compuestos quedan INTACTOS.** Siguen
   devolviendo sus arrays completos. Quitarselos ahora rompe la UI que dejo T I.2 (typecheck
   rojo) y esta task no toca `app/**`. Es la deuda Q-I4, que se salda cuando T J.2 aterrice
   (§8, Q-J1).
3. **`in` para la cola, `notIn` para el historico, misma constante.** Ver §2. Con un
   `in: ["solicitado"]` escrito a mano, el `vencido` desaparece de la cola sin que nadie lo note
   (medido, mutacion 6).
4. **`consolidablesWhere` se extrae.** Ver §3.3. Es el unico de los cuatro `where` de esta tanda
   del que ademas cuelga un calculo de dinero.
5. **El guard de rol va SIEMPRE antes del repositorio.** Medido en los cuatro (`llamadas` del
   doble === `[]`) y verificado por la mutacion 8. En la cola de bodega importa especialmente:
   cada fila ES el dinero agregado de una zona entera.
6. **`sinZona` -> pagina vacia, no `forbidden`**, como en T I.1: el rol tiene acceso al modulo,
   lo que no tiene es alcance. Sin una sola consulta.
7. **`paginaInputSchema` (`lib/types/pagina-input.ts`) — extraccion nueva.** El bloque zod
   `page`/`pageSize`/`.strict()` estaba escrito **doce** veces en `lib/types/` y esta tanda lo
   habria llevado a quince. Se declara una vez y se aplica a los schemas de los TRES archivos
   que esta task ya abre (`cierres-admin.ts`, `cierre-bodega.ts`, `incidente.ts`): 3 existentes
   reexpresados + 3 nuevos. **Los otros ocho quedan como estaban** — reexpresarlos toca bordes
   que esta task no abre (§8, Q-J3). Motivo, no estetica: el `.strict()` es la barrera de borde
   contra un `zonaId`/`mensajeroId` colado, y es exactamente lo que se olvida en una copia.
8. **Los cierres de bodega REUSAN su schema; la cola de cierres del dia y la de incidentes no.**
   `listarCierresBodegaPaginadoSchema` ya se declaraba «para los listados de este dominio» y
   ahora sirve a tres. En cambio `listarHistoricoCierresAdminSchema` /
   `listarHistoricoIncidentesSchema` llevan «Historico» en el nombre: reusarlos para la cola
   haria que el nombre mintiera sobre que mitad se esta pidiendo.
9. **Los consolidables usan `cierreConfig`, no `cierreBodegaConfig`.** Sus filas son
   `cierre_dia`, y el doc de `cierreConfig` (T H.1) ya nombra explicitamente «la cola a
   consolidar». Con `cierreBodegaConfig`, ajustar el tamano de pagina de los cierres de bodega
   moveria tambien el de una tabla de cierres del dia.
10. **Las Server Actions entran en T J.1**, no en T J.2 (`docs/architecture.md`: «Server
    Action = controlador»). Ninguna toca UI.
11. **Cero migraciones y cero RLS nueva.** Los cuatro `WHERE` van sobre columnas que ya existen
    y usan los indices que el listado sin paginar ya usaba. Paginar reduce trabajo, no lo anade.
12. **Deuda D5.2 (`ListarOrdenesCompletoServiceResult` escrito a mano): sigue abierta.** Esta
    task no toca `OrdenService`; sigue apuntando a la tanda K.

---

## 7. Traspaso concreto a T J.2 (frontend)

Lo que el frontend tiene disponible, por pantalla:

| Pantalla / seccion | Server Action nueva | Schema (defaults) | Tamano de pagina |
| --- | --- | --- | --- |
| `cierres-admin` — «Cierres del dia pendientes de decision» | `listarPendientesCierresAdminPaginado(input)` — `lib/actions/cierres-admin.ts` | `listarPendientesCierresAdminSchema` | `cierreConfig` |
| `cierres-admin` — «Cierres de bodega pendientes» | `listarPendientesCierresBodegaPaginado(input)` — `lib/actions/cierre-bodega.ts` | `listarCierresBodegaPaginadoSchema` | `cierreBodegaConfig` |
| `cierres-admin` — «Cierres del dia a consolidar» | `listarConsolidablesPaginado(input)` — `lib/actions/cierre-bodega.ts` | `listarConsolidablesSchema` | `cierreConfig` |
| `incidentes` — «Incidentes pendientes de decision» | `listarPendientesIncidentesPaginado(input)` — `lib/actions/incidentes.ts` | `listarPendientesIncidentesSchema` | `incidentesConfig` |

Todas devuelven `{ status: "ok", items, page, pageSize, total }` o
`forbidden` / `validation_error` / `unauthenticated`. Todas aceptan `input` **vacio** (`{}`) y
aplican los defaults, que es lo que la pagina 1 del Server Component necesita.

**Seis cosas que T J.2 tiene que saber, y que no se deducen del tipo:**

1. **El contador de cabecera sale del `total` de estas actions (R42).** Son los cuatro puntos
   que `design.md §11.3` enumera y que el registro de T H.3 tiene como `pendiente`:
   `CierresAdminModule.tsx:442`, `CierresBodegaAdminModule.tsx:220`,
   `ConsolidacionBodegaModule.tsx:172`, `IncidentesAdminModule.tsx:308`. Al resolverlos hay que
   **actualizar esas cuatro entradas del registro de T H.3** de `pendiente` a resuelto.
2. **Los cinco totales de dinero de `ConsolidacionBodegaModule` NO vienen en la pagina, y no
   deben derivarse de ella (R49).** Siguen llegando por `listarConsolidacion`, calculados sobre
   el conjunto completo. Como no dependen de la pagina, R50 sale gratis: cambiar de pagina no
   los toca. Lo mismo con `puedesSolicitar`/`motivoBloqueo` y `sinZona`.
3. **Los listados compuestos NO desaparecen.** `listarCierresAdmin`, `listarCierresBodegaAdmin`,
   `listarConsolidacion` y `listarIncidentes` siguen trayendo los agregados, `sinZona` y la otra
   mitad de cada particion. Lo que cambia es que la tabla de la COLA ya no pinta el array de esa
   respuesta, sino la pagina de la action nueva.
4. **Q-I6 hay que decidirla en esta tanda, y esta escrita en el codigo.** T I.2 mudo cuatro
   historicos a componentes propios y dejo abierto donde monta la J el control de sus colas.
   Recomendacion medida: **montarlo EN el modulo**, junto al contador. Ahi la guardia de T H.3
   lo VE y se pone roja hasta que el contador use el `total` — que es exactamente el trabajo de
   T J.2. Si el control se muda a un hijo, la guardia deja de mirar y el contador puede quedarse
   mintiendo en silencio.
5. **La descarga (R52).** Estas cuatro tablas son Familia B y hoy proyectan con
   `filasLocales(<array de props>, …)`. Al pasar a pagina, esa linea significa «descarga lo que
   ves». Hay que cablearlas con `filasDelConjuntoCompleto` (`components/shared/descarga-resultado.ts`),
   que es lo que T I.2 dejo hecho para los siete de riesgo BAJO.
6. **`CierresAdminModule` tiene una vista tipo factura que hace `[...pendientes, ...historico]`.**
   T I.2 decidio (Q-I3) que **sigue a la tabla**. Al paginar la cola, esa vista pasa a mostrar
   la pagina visible de pendientes: es coherente con la decision ya tomada, pero conviene
   dejarlo dicho y afirmarlo.

---

## 8. Preguntas abiertas (NO se rellenaron con supuestos)

**Q-J1 — Q-I4 sigue abierta y ahora se puede cerrar.** Cada una de estas pantallas hace dos
consultas mas por render (la pagina y su conteo) mientras el listado compuesto siga trayendo el
conjunto entero. Con T J.1 **las dos mitades de cada particion ya paginan**, asi que en cuanto
T J.2 aterrice el compuesto solo necesitara los agregados, el gate y `sinZona`: sus arrays
quedan sin lector. Retirarlos exige tocar UI y por eso NO se hizo aqui (rompe el typecheck de lo
que dejo T I.2). **Propuesta:** hacerlo en la tanda M, coordinado backend+frontend, o como cierre
de la J una vez T J.2 este verde. Ojo con `listarConsolidacion`: su array **no** puede
desaparecer del todo —el dinero se calcula sobre el— pero si puede dejar de CRUZAR al cliente.

**Q-J2 — Los agregados de consolidacion siguen leyendo el conjunto entero desde Postgres, y no
hay forma de evitarlo hoy.** `repartirEfectivo` necesita todos los pagos individuales. La unica
mejora posible seria una lectura dedicada que traiga solo `totalPagoMensajero` de todas las filas
(sin las columnas de la tabla), reduciendo lo que viaja pero no el numero de filas leidas. No se
hizo: es una optimizacion sin pedido, sobre el camino del dinero, y el conjunto esta acotado por
los mensajeros de UNA zona con cierre aprobado sin consolidar — no crece con el tiempo.

**Q-J3 — Ocho schemas de pagina siguen escritos a mano.** `paginaInputSchema` cubre los siete de
`cierres-admin.ts`, `cierre-bodega.ts` e `incidente.ts`. Quedan `api-key.ts`, `cierre.ts`,
`gasto-fijo-plantilla.ts`, `orden.ts`, `plantilla-mensaje.ts`, `tarifa.ts`, `usuario.ts`,
`wallet-tienda.ts`, `zona.ts`. Algunos (ordenes) llevan filtros y no encajan tal cual. No se
tocaron porque son bordes fuera del alcance declarado de T J.1.

**Heredadas y NO resueltas aqui:** Q-I1 (saldos recorta fuera de la base), Q-I2 (desviacion de
R51 en saldos), Q-I5 (tres descargas releen un listado caro), la deuda **D5.2** y las preguntas
de la tanda H siguen exactamente como las dejo T I.2.

---

## 9. Archivos

**Nuevos (6)**

- `lib/types/pagina-input.ts` — `TamanoPaginaConfig`, `paginaInputSchema()`, `PaginaInput`.
- `tests/unit/services/cierres-admin-pendientes-paginado.test.ts` (9)
- `tests/unit/services/cierres-bodega-pendientes-paginado.test.ts` (7)
- `tests/unit/services/consolidables-paginado.test.ts` (9)
- `tests/unit/services/incidentes-pendientes-paginado.test.ts` (9)
- `tests/unit/repositories/colas-paginadas-where.test.ts` (9) — la mitad de la tanda J de
  `historicos-paginados-where.test.ts`; las mutaciones 6 y 7 la justifican.

**Modificados — produccion (16)**

- Servicios (4): `CierresAdminService`, `CierresBodegaAdminService`, `CierreBodegaService`,
  `IncidenteAdminService`.
- Repositorios (4): `CierresAdminRepository`, `CierresBodegaAdminRepository`,
  `CierreBodegaRepository` (+ `consolidablesWhere` y `toConsolidableRow` extraidos),
  `IncidenteAdminRepository`.
- Interfaces (8): las 4 de repositorio + las 4 de servicio.
- Tipos (3): `cierres-admin.ts`, `cierre-bodega.ts`, `incidente.ts` (schemas nuevos + los
  existentes reexpresados sobre `paginaInputSchema` + los alias de resultado).
- Actions (3): `cierres-admin.ts`, `cierre-bodega.ts` (dos actions nuevas), `incidentes.ts`.

**Modificados — tests ajenos (6), solo para declarar el metodo nuevo en su doble.** Anadir un
metodo a una interfaz de repositorio obliga a que los dobles lo declaren; el cambio es una linea
por doble y **ninguna asercion existente se toco**: `CierresAdminService.aprobar.devolucion`,
`cierre-bodega-service`, `cierres-admin-indemnizacion`, `cierres-admin-service`,
`cierres-bodega-admin-service`, `incidente-admin-service`.

**Cero UI, cero migraciones, cero RLS, cero cambios de esquema.**

---

## 10. Puertas (medicion final, salida real)

```
$ npx tsc --noEmit
=== typecheck exit: 0 ===

$ npx eslint
✖ 23 problems (0 errors, 23 warnings)
=== lint exit: 0 ===
(baseline de la tanda I: 21 warnings. Las 2 nuevas son los `_args` sin usar del delegado Prisma
falso de `colas-paginadas-where.test.ts`, el MISMO patron —y las mismas dos lineas— que ya tiene
su hermano `historicos-paginados-where.test.ts`.)

$ npx vitest run
 Test Files  740 passed (740)
      Tests  8903 passed (8903)
   Duration  212.59s
```

Suite completa **en verde a la primera**, sin flakes (el conocido `OrdenesModuleReuse` paso).
Baseline de la tanda I: 735 archivos / 8860 tests → **+5 archivos y +43 tests**.

---

## 11. Veredicto

Las 4 colas de riesgo MEDIO paginan en el servidor con el mismo acotamiento por actor que
tenian, y el dinero agregado de la unica pantalla que lo tiene sigue calculandose sobre el
conjunto completo — verificado por mutacion en los dos puntos, mas dos mutaciones del `WHERE`
que pasaron verdes en los servicios y solo el test de repositorio detuvo.

---
---

# T J.2 — Frontend: paginacion + contador por `total` en las 4 colas de riesgo MEDIO

**Rama:** `feature/170-fase2-tanda-j` · **Fecha:** 2026-08-01 · **Rol:** `frontend_dev`
**Alcance:** SOLO UI. Cero cambios en `lib/services/`, `lib/repositories/` y cero cambios de
comportamiento en las Server Actions — no se encontro ningun defecto en lo que dejo T J.1.

Todo lo que sigue esta MEDIDO. Las cuatro mutaciones se ejecutaron y se revirtieron.

---

## 12. Que se entrega, cola a cola

| # | Cola | Contador (R42) | Nombre accesible del control (R43) | Descarga (R52) |
| --- | --- | --- | --- | --- |
| 1 | Cierres del dia pendientes | `({colaPendientes.total})` | Paginación de los cierres del día pendientes | `listarCierresAdmin().pendientes` |
| 2 | Cierres de bodega pendientes | `({colaPendientes.total})` | Paginación de los cierres de bodega pendientes | `listarCierresBodegaAdmin().pendientes` |
| 3 | Cierres del dia a consolidar | `({pagina.total})` | Paginación de los cierres del día a consolidar | `listarConsolidacion().consolidables` |
| 4 | Incidentes pendientes | `({colaPendientes.total})` | Paginación de los incidentes pendientes | `listarIncidentes().pendientes` |

Las dos pantallas (`cierres-admin`, `incidentes`) pre-cargan la PAGINA 1 de cada cola con la
Server Action de T J.1 (input vacio: los defaults los pone el schema del dominio) y la bajan por
props. Los cuatro modulos montan SWR con esa pagina como `fallbackData` y `<Pagination>`
alimentado por el `total` del servidor. Molde: el que dejo T I.2, sin variaciones.

Con esto, **las dos tablas de cada una de estas pantallas paginan**: la cola (J) y el historico
(I). `cierres-admin` pasa a pre-cargar 4 paginas y `incidentes` 2.

---

## 13. Q-I6 RESUELTA: el control vive EN el modulo

T I.2 dejo la eleccion a esta tanda y T J.1 la recomendo medida. **Se monta en el modulo**, no
en un hijo, y el motivo es exactamente el agujero que Q-I6 describia: la guardia de T H.3 mira
del archivo que monta `<Pagination>` **hacia los componentes que importa**, nunca hacia arriba.
Con el control en un hijo, el contador del padre queda fuera de su vista y podria volver a
`.length` sin que nada se pusiera rojo.

Con el control en el modulo, los cuatro archivos entran en `pantallasPaginadas()` y la guardia
los vigila de verdad. Medido: la mutacion 1 (contador desde la pagina) pone rojos **los tres
tests de la guardia estatica** ademas del de comportamiento.

Consecuencia deliberada: estos cuatro modulos NO se parten en dos archivos como hizo T I.2 con
los historicos. Alli la mudanza era la unica forma de que un contador correcto conviviera con
una tabla paginada; aqui el contador ya no cuenta un array, asi que no hay nada que separar y
partir el archivo solo alejaria la tabla de su contador.

---

## 14. Las cuatro entradas `pendiente` del registro de T H.3, saldadas

`tests/unit/descarga/contadores-cabecera.guardia.test.ts`:

- las 4 entradas `pendiente` **salen del registro** (ya no existen en el codigo) y el conteo
  del arbol baja de **6 a 2**: quedan solo las dos vistas agrupadas del Anexo IV;
- el tercer test cambia de sentido y se endurece. Era «las cuatro colas siguen contando el
  array, y por eso siguen pendientes»; ahora es **«las cuatro colas muestran el total del
  servidor, y su pantalla se vigila»**, con tres afirmaciones: no queda ningun `pendiente`;
  cada uno de los cuatro modulos ES una pantalla paginada a ojos de la guardia (Q-I6); y el
  contador de cada uno sale de un `.total`. El primer test prohibe el patron viejo, este exige
  el nuevo — sin el segundo, borrar las entradas habria dejado el test verde por vacuidad;
- la anti-vacuidad sube de **17 → 28** archivos reconocidos (24 montan `<Pagination>` + 4
  componentes de tabla que importan). T H.3 la dejo en 17, la tanda I la llevo a 24 sin
  actualizar el numero, y T J.2 suma los 4 modulos;
- el estado `"pendiente"` se conserva en el vocabulario del registro, con su doc: es el que hay
  que usar si una tanda futura introduce una cola con contador antes de paginarla.

---

## 15. R49/R50 — el punto rojo, y por que no se movio

Los **cinco** agregados de dinero de `ConsolidacionBodegaModule` siguen llegando por props
desde `listarConsolidacion`, calculados sobre el CONJUNTO COMPLETO. La pagina solo recorta lo
que la tabla PINTA. No se toco ni una linea de ese calculo, y el motivo esta escrito en el
propio contrato de props del modulo para que no se pierda: dos de los cinco —el neto y «la
central debe»— salen de repartir el efectivo entre los pagos INDIVIDUALES ordenados, y eso no
lo produce ni una pagina ni un `SUM`.

Como no dependen de la pagina, **R50 sale gratis**: cambiar de pagina no los toca. Lo mismo con
`puedesSolicitar`/`motivoBloqueo` y `sinZona`.

El test no se conforma con «siguen ahi»: los datos estan elegidos para que una suma sobre la
pagina visible dé numeros DISTINTOS y reconocibles (250.00 / 100.00 / 350.00 / 750.00 / 25.00
frente a 600.00 / 240.00 / 840.00 / 1800.00 / 60.00), y se afirma que **ninguno de los cinco
numeros de la pagina aparece en pantalla**, antes y despues de paginar. Medido: mutacion 2.

En las otras tres colas no hay agregado de dinero que proteger (verificado por T J.1 §3.1): el
dinero va por fila o dentro del modal de detalle de UNA fila.

---

## 16. R50 — «ni el estado de los formularios»

El tercer tramo de R50 se afirma sobre «Incidentes pendientes»: se abre el detalle, se abre el
sub-modal de aprobacion, se teclea el monto de la indemnizacion y **entonces** cambia la pagina
de la tabla de detras; el monto sigue ahi y el sub-modal sigue abierto.

El control se acciona con `fireEvent` **a proposito y esta dicho en el test**: con el dialogo
abierto, el resto de la pantalla queda fuera del arbol accesible (`aria-hidden`), que es lo
correcto para un lector de pantalla. Lo que se prueba no es que se pueda pulsar a traves del
modal, sino que **una relectura de pagina no reinicia el estado del modulo**. Por eso las
consultas de ese tramo usan `hidden: true`, y solo ese tramo.

---

## 17. R52 — la descarga sigue siendo el conjunto completo

Las cuatro colas eran **Familia B** y proyectaban con `filasLocales(<array de props>)`. Al pasar
a pagina, esa MISMA linea pasa a significar «descarga lo que ves» y no falla en ninguna parte:
el archivo sale, con 25 filas de 60. Las cuatro se cablean ahora con `filasDelConjuntoCompleto`
(`components/shared/descarga-resultado.ts`, T I.2), que RELEE el conjunto al pulsar el control
—una lectura mas, y solo cuando el usuario descarga— y lo proyecta con el MISMO `filasLocales`,
sin perder el tope de 5000 ni su mensaje accionable (R26/R27/R28).

Lo que se relee es **el mismo listado que la pantalla ya llamaba antes de paginar**
(`listarCierresAdmin`, `listarCierresBodegaAdmin`, `listarConsolidacion`, `listarIncidentes`),
con el mismo acotamiento por actor resuelto server-side: descargar no amplia el alcance ni una
fila (R14/R44). En consolidables tiene un efecto extra util: el archivo y los agregados de la
cabecera salen de la MISMA lectura, asi que no pueden hablar de conjuntos distintos.

El test descarga **desde la pagina 2**, que es donde la degradacion seria mas facil de no notar.
Medido: mutacion 3.

---

## 18. Q-I3 se extiende a la cola (la vista tipo factura)

`CierresAdminModule` concatenaba `[...pendientes, ...historicoPagina.items]`. Ahora las DOS
mitades son paginas: la tira muestra la pagina visible de la cola mas la del historico. Es la
MISMA decision que T I.2 tomo y argumento para el historico (§15 de esta bitacora), aplicada a
la otra mitad; la frase que define la seccion —«los mismos cierres de arriba»— sigue siendo
literalmente cierta. Alimentarla del conjunto entero seria la unica razon por la que la cola
completa seguiria cruzando a la pantalla.

`BajoRiesgoPaginacion.test.tsx::Q-I3` sigue verde con la cola paginada.

---

## 19. Las cuatro mutaciones, con su salida real

**Todas revertidas** (`grep MUTACION app/` sin resultados propios; suite completa verde
despues).

| # | Mutacion | Resultado medido |
| --- | --- | --- |
| 1 | **R42**: el contador de la cola de cierres pasa a `({colaPendientes.items.length})` | **ROJO (4)**: `ColasPaginacion::…(R42)` + los TRES de la guardia de T H.3 — `una pantalla paginada muestra el TOTAL del servidor…: expected [ Array(1) ] to deeply equal []`, `hay contadores sin registrar…`, `Cierres del dia pendientes de decision: su contador no sale del total del servidor (R42)` |
| 2 | **R49/R50**: el total general de consolidables se calcula sumando `pagina.items` | **ROJO (1)**: `Unable to find an element with the text: ₡840.00` (renderiza ₡350.00, el de la pagina) |
| 3 | **R52**: la descarga de la cola de incidentes pasa a `filasLocales(colaPendientes.items, …)` | **ROJO (1)**: `Incidentes pendientes: el archivo trae la PÁGINA, no el conjunto: expected […(25)] to have a length of 60 but got 25` |
| 4 | **R43**: se quita el `ariaLabel` del control de la cola de bodega | **ROJO (3)**: `Unable to find an accessible element with the role "navigation" and name "Paginación de los cierres de bodega pendientes"` |

Las dos que el encargo exigia —R42 derivado de la pagina y un total de dinero sobre la pagina
visible— son la 1 y la 2. **La 1 es ademas la demostracion de Q-I6**: la guardia estatica solo
se pone roja porque el control vive en el modulo.

---

## 20. Mapa `R<n> → archivo::test`

Prefijo `P/` = `tests/components/paginacion/ColasPaginacion.test.tsx`.

| R | Test |
| --- | --- |
| **R42** | `P/::el contador de cabecera muestra el total del servidor, no el tamaño de página (R42)` — las 4 colas, en la pagina 1 **y en la ULTIMA** (10 filas de 60), que es donde un contador derivado del array se delata |
| **R42** | `tests/unit/descarga/contadores-cabecera.guardia.test.ts::ninguna pantalla con listado paginado deriva su contador de la longitud del array` (guardia estatica; ahora vigila los 4 modulos) |
| **R42** | `tests/unit/descarga/contadores-cabecera.guardia.test.ts::las cuatro colas de la tanda J muestran el total del servidor, y su pantalla se vigila` |
| **R43** | `P/::cada cola navega entre páginas y su control tiene nombre accesible (R43)` — las 4, por rol y nombre; ida y vuelta |
| **R43** | `P/::las cuatro están cubiertas: ni una se queda fuera del recorrido` (anti-vacuidad + los 4 nombres de control son distintos entre si) |
| **R50** | `P/::cambiar de página no altera los totales, los avisos de bloqueo ni los formularios (R50)` — los 5 agregados de dinero con su valor exacto, la ausencia de los 5 que produciria la pagina, el aviso de bloqueo con su boton deshabilitado y el monto tecleado en un sub-modal abierto |
| **R52** | `P/::la descarga sigue entregando el dataset completo (R52)` — las 4, descargando DESDE la pagina 2 |
| **R44** | `P/::el usuario ve exactamente las mismas filas que antes en la página 1 (R44)` — las 4, en el PRIMER pintado, sin `await` (el aviso de T I.2: sin esa exigencia, quitar el `fallbackData` pasa VERDE) |
| **Q-I3** | `tests/components/paginacion/BajoRiesgoPaginacion.test.tsx::Q-I3: la vista tipo factura sigue a la tabla del histórico, no al conjunto entero` (sigue verde con la cola paginada) |

**R40/R41 no se declaran cubiertos aqui** (son de T J.1, a nivel de servicio); la pantalla los
consume: el `total` del contador y del control sale del servidor y el `pageSize` de
`lib/config/<dominio>.ts`. **R45-R49, R51, R53, R54 no entran en esta task.**

**Un test se RETIRA:** `BajoRiesgoPaginacion.test.tsx::el contador de la cola que NO pagina
sigue contando el conjunto entero (R42)`. Su premisa —«la cola que NO pagina»— dejo de ser
cierta. Su sustituto es estrictamente mas fuerte (afirma el total en la ULTIMA pagina, donde el
array y el conjunto no coinciden), y en su lugar queda un comentario que dice donde vive ahora.

---

## 21. Decisiones tomadas al implementar

1. **Una interfaz de pagina por modulo** (`CierresAdminColaPagina`, `CierresBodegaColaPagina`,
   `ConsolidablesPagina`, `IncidentesColaPagina`), como hizo T I.2 con las suyas. Se valoro
   declarar una sola forma compartida en `components/shared/`; se descarto porque obligaria a
   reescribir las siete de la tanda I para que no queden dos vocabularios, y eso es refactor de
   codigo ajeno a esta task. Queda anotado como Q-J4.
2. **El tamano de pagina de consolidables sale de `cierreConfig`**, no de `cierreBodegaConfig`.
   Sus filas son `cierre_dia`: es la misma decision que tomo T J.1 (§6.9) en el servidor, y las
   dos tienen que coincidir o el `fallbackData` de la pagina 1 dejaria de valer.
3. **El esqueleto de carga solo cuando NO hay nada que pintar** (`data === undefined`), como
   T I.2. `isLoading` de SWR sigue en `true` mientras revalida aunque haya `fallbackData`.
4. **Las paginas piden las dos mitades en paralelo** (`Promise.all`). Son lecturas
   independientes; secuenciarlas duplicaria la latencia de la pantalla sin ganar nada.
5. **Si una cola paginada no responde `ok`, la seccion no se muestra** (`notFound` en la pagina
   de incidentes y en el prefetch de cierres del dia; la seccion de bodega/consolidacion
   simplemente no se pinta). Es el MISMO criterio que ya tenia su listado compuesto: la
   pantalla no se rompe y no expone nada.
6. **La descarga de consolidables relee `listarConsolidacion`, que es cara** (calcula los cinco
   agregados). Es la deuda Q-I5 heredada, no una nueva: ocurre una vez por clic en «Descargar»,
   y hoy no existe otro origen del conjunto completo sin tocar backend.

---

## 22. Archivos

**Nuevos (1)**

- `tests/components/paginacion/ColasPaginacion.test.tsx` (6 tests)

**Modificados — produccion (6)**

- Paginas (2): `app/(app)/cierres-admin/page.tsx`, `app/(app)/incidentes/page.tsx`.
- Modulos (4): `CierresAdminModule`, `CierresBodegaAdminModule`, `ConsolidacionBodegaModule`,
  `IncidentesAdminModule`.

**Modificados — tests ajenos (9).** Dos motivos, ninguno afecta a una asercion existente:
(a) la prop de la cola deja de ser un array y pasa a ser la pagina; (b) hace falta el doble de
la Server Action paginada, porque SWR revalida al montar y sin el la tabla se vaciaria a mitad
del test. Son `CierresAdminModule`, `CierresAdminIndemnizacion`, `IncidentesAdminModule`,
`IncidentesAdminR51`, `CierresAdminPage`, `IncidentesPage`, `descarga/CierresDescarga`,
`descarga/IncidentesDescarga` y `paginacion/BajoRiesgoPaginacion` (montajes + el test retirado
de §20).

**Una guardia se actualiza a proposito y se dice por que en el propio archivo:**
`contadores-cabecera.guardia.test.ts` (§14).

`censo-tablas.ts` y `PANTALLAS_ANEXO_III` **no cambian**: ninguna tabla se muda de archivo y los
cuatro modulos ya estaban en la lista de pantallas vigiladas.

**Cero cambios en `lib/services`, `lib/repositories`, Server Actions, migraciones y RLS.**

---

## 23. Puertas (medicion final, salida real)

```
$ npx tsc --noEmit
=== typecheck exit: 0 ===

$ npx eslint
✖ 23 problems (0 errors, 23 warnings)
=== lint exit: 0 ===
(baseline de T J.1: 23 warnings. NINGUNA nueva.)

$ npx vitest run
 Test Files  741 passed (741)
      Tests  8908 passed (8908)
   Duration  216.67s
```

Suite completa en verde, sin flakes (el conocido `OrdenesModuleReuse` paso). Baseline de T J.1:
740 archivos / 8903 tests → **+1 archivo y +5 tests** (6 nuevos − 1 retirado, §20).

---

## 24. Preguntas abiertas de T J.2

**Q-J1 / Q-I4 — SE PUEDEN CERRAR YA, pero no aqui.** Con T J.2 en verde, las DOS mitades de cada
particion pintan una pagina: los arrays de `listarCierresAdmin`, `listarCierresBodegaAdmin` y
`listarIncidentes` **se quedan sin lector de tabla**. Lo unico que aun los consume es la
DESCARGA (§17), que necesita el conjunto completo por definicion — asi que «retirarlos» no es
borrarlos: es dejar de traerlos en el render y traerlos solo cuando alguien descarga, o darles
un `listarXCompleto` propio. Eso toca `lib/services` y por eso NO se hizo en esta task, cuyo
alcance declarado es solo UI.

**Se propone dirigirlo a la tanda M**, coordinado backend+frontend, con dos avisos medidos:

- `listarConsolidacion` **no puede** perder su array: el dinero se calcula sobre el. Lo que si
  puede es dejar de CRUZARLO al cliente.
- mientras tanto, cada una de estas pantallas hace **cuatro** consultas mas por render (dos
  paginas × su conteo) ademas de las que ya hacia. Lo que si baja YA es lo que cruza a la
  pantalla, que es de lo que habla el Anexo III.

**Q-J4 — La forma `{ items, total, pageSize }` esta declarada once veces en `app/`** (siete de
T I.2 + cuatro de T J.2), una por modulo paginado: la misma forma con once nombres. Unificarla
en un tipo compartido es un refactor transversal de UI que ninguna task ha pedido; se deja
propuesto, no inventado. Ojo: NO es `PaginaListado<T>` de T H.2 —esa lleva ademas `page`, que la
pantalla no necesita porque el numero de pagina visible lo manda el cliente—.

**Q-I5 sigue abierta y ahora afecta a una descarga mas:** la de consolidables relee
`listarConsolidacion`, que calcula los cinco agregados de la zona para quedarse solo con un
array (§21.6).

**Heredadas y NO resueltas aqui:** Q-I1 (saldos recorta fuera de la base), Q-I2 (desviacion de
R51 en saldos), Q-J2 (los agregados de consolidacion leen el conjunto entero desde Postgres),
Q-J3 (ocho schemas de pagina escritos a mano), la deuda **D5.2** y las preguntas de la tanda H
siguen exactamente como las dejo T J.1.

**`tasks.md` no se toca**, igual que hizo T J.1: la marca de `[x]` y su bloque «MEDIDO» los
escribe quien cierra la tanda entera.

---

## 25. Veredicto

Las 4 colas de riesgo MEDIO paginan en pantalla y su contador de cabecera muestra el `total` del
servidor —verificado tambien en la ultima pagina, donde el array y el conjunto no coinciden—;
los cinco agregados de dinero de consolidacion siguen saliendo del conjunto completo y la
descarga sigue entregandolo entero, con las cuatro afirmaciones verificadas por mutacion y la
guardia de T H.3 vigilando por fin las cuatro pantallas.
