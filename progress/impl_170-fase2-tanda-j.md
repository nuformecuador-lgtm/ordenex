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
