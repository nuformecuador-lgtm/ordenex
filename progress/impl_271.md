# impl 271 — El segundo cierre se puede solicitar, y acumular dos bloquea (BACKEND)

> Pasada de **BACKEND**. `lib/**`, `db/schema.prisma` + su migración, y los tests de todo eso.
> **La pasada de FRONTEND (tanda 9 de `tasks.md`) NO está hecha** y su lista exacta está al final.

---

## La regla que esta ficha implanta

Con **N** = cierres del mensajero sin aprobar (`solicitado` + `vencido` + `rechazado`) y **V** =
cuántos de esos son re-solicitables (`vencido` o `rechazado`):

> **LIBRE si `N ≤ 1` Y `V = 0`. En cualquier otro caso BLOQUEADO — para gestionar, para cobrar y
> para RECIBIR TRABAJO NUEVO, sea reparto o recolección.**

**Revierte en parte la regla firmada el 2026-08-20** (feature 241, «recibir asignaciones nunca se
bloquea»). Lo que **sobrevive** de aquella regla y está afirmado en test: un cierre `solicitado` a
secas (`N=1, V=0`) **no** bloquea nada.

---

## Archivos creados

| Archivo | Qué es |
| --- | --- |
| `lib/utils/bloqueo-cierre.ts` | La REGLA, en un módulo puro: `CIERRE_ESTADOS_ABIERTOS`, `CIERRE_ESTADOS_RESOLICITABLES`, `estaBloqueadoPorCierres`, `BloqueoDetalle`, `SIN_BLOQUEO` |
| `lib/utils/jornada-cierre.ts` | El derivador ÚNICO de la jornada (`derivarJornada`, `jornadaDelCorte`) |
| `db/migrations/20260823120000_notificacion_evento_bloqueo_cierre/migration.sql` | `ADD VALUE` de `cierre_dia_vencido` y `mensajero_bloqueado_por_cierres` |
| `db/migrations/20260823120000_notificacion_evento_bloqueo_cierre/down.sql` | Recrea el enum con los SEIS previos, precondición ruidosa, **sin un solo `DELETE`** |
| `tests/fixtures/bloqueo-cierre.ts` | Fábrica de `BloqueoDetalle` para dobles (calcula `bloqueado` con la regla, no a mano) |
| `tests/unit/utils/bloqueo-cierre.test.ts` | Las 7 filas de la tabla de verdad |
| `tests/unit/utils/jornada-cierre.test.ts` | Los 4 casos del derivador + guardia `fechaReparto` |
| `tests/unit/notificaciones/bloqueo-textos.test.ts` | Los CINCO literales, escritos a mano y completos |
| `tests/unit/services/cierre-bloqueo-superficies.test.ts` | Las 7 filas × gestionar × las TRES escrituras de asignación |
| `tests/unit/guards/regla-241-caducada.guardia.test.ts` | Censa `lib/` y falla si sobrevive una frase de la regla derogada |
| `tests/integration/db/cierre-bloqueo-nv-sql-real.test.ts` | N/V, «el más viejo», M2 y la jornada **contra Postgres** |
| `tests/integration/db/cierre-aprobacion-libera-solo-lo-suyo.test.ts` | **M7** contra Postgres |
| `tests/integration/db/notificacion-evento-bloqueo-cierre-migration.test.ts` | Up/down del enum + `notificacion_dedupe_key` + down ruidoso |

## Archivos borrados

| Archivo | Por qué |
| --- | --- |
| `tests/unit/services/cierre-bloqueo-asimetria.test.ts` | Codificaba la regla firmada el 2026-08-20 («recibir no se bloquea»). Se **sustituye** por `cierre-bloqueo-superficies.test.ts`, que conserva su método (repositorio REAL sobre un Prisma que agrupa de verdad) y cubre además las tres escrituras de asignación. No se perdió ningún caso: los de gestionar están los tres. |

## Archivos modificados (código)

`lib/repositories/OrdenRepository.ts` · `lib/repositories/CierreDiaRepository.ts` ·
`lib/repositories/CorteDiarioRepository.ts` · `lib/repositories/CierresAdminRepository.ts` ·
`lib/services/CierreDiaService.ts` · `lib/services/CorteDiarioService.ts` ·
`lib/services/GuiaAsignacionService.ts` · `lib/services/AsignacionSateliteService.ts` ·
`lib/services/MisAsignacionesService.ts` · `lib/services/RecoleccionTiendaService.ts` ·
`lib/services/CierresAdminService.ts` · `lib/services/mensajes-bloqueo.ts` ·
`lib/services/CorreccionDiaRepartoService.ts` (prosa) · `lib/services/DeshacerAsignacionService.ts` (prosa) ·
`lib/notificaciones/emitir.ts` · `lib/notificaciones/notificadores.ts` ·
`lib/constants/bloqueo-mensajero.ts` · `lib/actions/cierre-dia.ts` · `lib/actions/ordenes-guia.ts` ·
`lib/actions/recepcion-satelite.ts` · `lib/interfaces/repositories/IOrdenRepository.ts` ·
`lib/interfaces/repositories/ICierreDiaRepository.ts` ·
`lib/interfaces/services/ICierreDiaService.ts` · `lib/interfaces/services/ICierresAdminService.ts` ·
`lib/types/notificacion.ts` · `lib/types/orden-guia.ts` · `lib/types/recepcion-satelite.ts` ·
`db/schema.prisma`.

**Un solo `.tsx` tocado, y es un COMENTARIO:** `app/(app)/cierre-dia/_components/CierreDiaModule.tsx`
nombraba el predicado por su nombre viejo en un bloque de prosa. Se renombró la referencia y nada
más — el diff es una línea de comentario. Ninguna línea ejecutable de `app/**` cambió en esta pasada.

### Renombrados que NO son cosméticos

- `findMensajerosBloqueadosParaGestion` → **`findMensajerosBloqueadosPorCierres`**. El nombre viejo
  decía PARA QUÉ bloqueaba y esa era su virtud en la 241; el alcance cambió, así que el nombre nuevo
  dice POR QUÉ. Y **vuelve al `Pick`** de los dos services de asignación: su ausencia era el
  mecanismo de la asimetría que esta ficha revierte.
- `findMensajerosConCierreAbierto` (privado, `Set`) → **`contarCierresAbiertosPorMensajero`**
  (público, `Map<string, {n,v}>`). Es una **transformación**, no un método nuevo al lado.
- `existeCierreVencido` + `existeCierreRechazado` + sus dos `transicionar*` →
  **`findCierreResolicitableMasViejo` + `transicionarASolicitado(cierreId, estadoEsperado)`**.
- `findCierreSolicitado(mensajeroId)` → **`findCierreParaAviso(cierreId)`**.
- `existeCierreSolicitado` → **desaparece**: el gate de creación es ahora la regla LIBRE/BLOQUEADO.

---

## Los tres fallos mudos, cerrados

| | Dónde estaba | Qué se hizo | Test que lo mata |
| --- | --- | --- | --- |
| **M2** | `CierreDiaRepository`: `updateMany` por `(mensajeroId, estado)` **sin `id`**. Con dos `rechazado` movía LOS DOS, `count` valía 2 y `count === 1` devolvía `false`: escribía y reportaba fallo | `transicionarASolicitado(cierreId, estadoEsperado)` con la **clave primaria en el `where`**. Los dos gemelos **desaparecen**, no se parchean | `cierre-bloqueo-nv-sql-real.test.ts` → «T2.4/R19 (M2): con DOS `rechazado`…», con los **cuatro pasos del rechazo** |
| **M7** | `CierresAdminRepository`: la liberación de `sin_gestionar` filtraba por `mensajeroAsignadoId`. Aprobar el 1.º vaciaba la mano del 2.º | Se acota con `id: { in: <cierre_sin_gestion de ESE cierre> }`, conservando todas las guardas. Con `sin_gestion_registrado = false` (cierre viejo, lista irrecuperable) **conserva** el comportamiento anterior en vez de liberar cero en silencio | `cierre-aprobacion-libera-solo-lo-suyo.test.ts`, los dos casos |
| **M9** | `findCierreSolicitado` con `orderBy createdAt desc`: con dos `solicitado` el aviso nombraba siempre el más nuevo | El aviso recibe el **`cierreId` que se acaba de tocar**; `findCierreParaAviso` busca por clave primaria | `notificacion-productores-wiring.test.ts` → «camino de RE-SOLICITUD…» (`findCierreParaAviso` llamado con `c-1`) |

---

## Mapa `R<n>` → test

| R | Qué exige | Test |
| --- | --- | --- |
| R1 | Derivar N y V | `orden-repository.bloqueo.test.ts` → «cuenta N y V por mensajero, y V es SUBCONJUNTO de N»; `cierre-bloqueo-nv-sql-real.test.ts` → «T10.1/R1-R8» |
| R2 | `N≤1 ∧ V=0` → LIBRE | `bloqueo-cierre.test.ts` → «caso 1 (R4)», «caso 2 (R5)» |
| R3 | `N≥2 ∨ V≥1` → BLOQUEADO | `bloqueo-cierre.test.ts` → casos 4/5/6/7; `cierre-bloqueo-superficies.test.ts` → control |
| R4 | Caso 1 (sin cierres) | `bloqueo-cierre.test.ts` → «caso 1 (R4) — sin cierres, gestionando hoy» |
| R5 | Casos 2 y 3 (un `solicitado`) | `bloqueo-cierre.test.ts` → «caso 2 (R5)», «caso 3 (R5)» |
| R6 | Caso 4 (`N≥2, V=0`) | `bloqueo-cierre.test.ts` → «caso 4 (R6)»; `cierre-bloqueo-nv-sql-real.test.ts` → fila «4 · dos solicitado» |
| R7 | Caso 5, bloqueado **al instante** | `bloqueo-cierre.test.ts` → «caso 5 (R7)»; SQL real → fila «5 · un vencido» |
| R8 | Caso 6: re-solicitar no basta | `bloqueo-cierre.test.ts` → «caso 6 (R8)»; SQL real → última aserción de «T2.4/R19 (M2)» |
| R9 | Dos cierres abiertos ADMITIDOS | `cierre-dia-service.test.ts` → «271/R13: con un cierre `solicitado` (N=1, V=0) el mensajero SI crea el segundo»; `corte-diario-repository.test.ts` → «271/R21: el mensajero con un cierre ABIERTO YA NO se excluye» |
| R10 | UN único predicado | `bloqueo-cierre.test.ts` → «guardia — el modulo de la regla es PURO»; `regla-241-caducada.guardia.test.ts` |
| R11 | El MÁS VIEJO, desempate estable | `cierre-bloqueo-nv-sql-real.test.ts` → «T10.2/R11: elige el MAS VIEJO…» y «…desempate por `id` es ESTABLE» |
| R12 | Sin bandera persistida | `cierre-bloqueo-nv-sql-real.test.ts` → «T10.1/R1-R8» (el veredicto cambia con cada siembra, sin escritura extra); `cierre-dia-action.test.ts` |
| R13 | Crear el SEGUNDO cierre | `cierre-dia-service.test.ts` → «271/R13…» |
| R14 | Vincula exactamente las de `cierre_id` nulo | **NO cubierto por un test nuevo** — ver «lo que no se cubrió» |
| R15 | Bloqueado → conflict con motivo que cuenta | `cierre-dia-service.test.ts` → «271/R15: BLOQUEADO por acumular (N=2, V=0) -> conflict con motivo que CUENTA» |
| R16 | Re-solicitar SIEMPRE permitido (anti-deadlock) | `cierre-dia-service.test.ts` → «R24 + 271/R16: con un cierre `%s` y una orden en `ayuda_tienda`…» |
| R17 | Dos `vencido` imposible (invariante derivado) | Comentario en `CorteDiarioService` + `CierreDiaRepository`; **sin test, a propósito** (estado inalcanzable) |
| R18 | Transiciona UNO, el más viejo | `cierre-bloqueo-nv-sql-real.test.ts` → «T10.2/R18: elige por EDAD, no por estado»; `cierre-dia-service.test.ts` → «271/R18: se transiciona EL MAS VIEJO…» |
| R19 | Éxito ⟺ transicionó esa fila (M2) | `cierre-bloqueo-nv-sql-real.test.ts` → «T2.4/R19 (M2)…» + «…anti-TOCTOU…»; `cierre-dia-repository.test.ts` → «R19: el WHERE lleva el `id`…» |
| R20 | Money-safe de la re-solicitud | `cierre-bloqueo-nv-sql-real.test.ts` → «T2.6/R20: la re-solicitud NO toca ni un total…»; `cierre-dia-repository.test.ts` → «R20: money-safe…» |
| R21 | El corte evalúa también a quien tiene cierre abierto | `corte-diario-repository.test.ts` → «271/R21: … YA NO se excluye» y «271/R21: el caso `79cb2c0f`» |
| R22 | Sin nada que cerrar, no crea nada | `corte-diario-service.test.ts` (existente) → los casos de `crearCierre → null`; `cierre-dia-repository.test.ts` → guarda «algo pasó» |
| R23 | Un cierre por mensajero y corrida | `corte-diario-service.test.ts` (existente): el bucle llama a `crearCierre` una vez por mensajero |
| R24 | No re-vincula ni re-registra | `cierre-sin-gestion-sql-real.test.ts` (existente, `@@unique(cierreId, ordenId)` + `skipDuplicates`) |
| R25 | Bloqueado: las CINCO acciones rechazadas | `cierre-bloqueo-superficies.test.ts` → familia A (escoger, recolectar, deshacer) × las 5 filas bloqueadas |
| R26 | Libre: las cinco permitidas, con `N=1,V=0` | `cierre-bloqueo-superficies.test.ts` → familia A, casos `A-libre` |
| R27 | Rechazo sin efectos y con motivo accionable | `cierre-bloqueo-superficies.test.ts` → «A-bloqueado … SIN llegar a leer la orden (R27)» |
| R28 | Reparto central bloqueado | `cierre-bloqueo-superficies.test.ts` → B1-bloqueado; `guia-asignacion-service.test.ts` → «asignarDesdeBodega hacia un mensajero BLOQUEADO» |
| R29 | Reparto satélite bloqueado | `cierre-bloqueo-superficies.test.ts` → B2-bloqueado; `asignacion-satelite-service.test.ts` → «mensajero BLOQUEADO -> conflict» |
| R30 | Lote completo sin efectos + motivo | `cierre-bloqueo-superficies.test.ts` → B1-bloqueado (detalle de las 3 órdenes, `asignarBodegaLote` no llamado) |
| R31 | Recolección bloqueada | `cierre-bloqueo-superficies.test.ts` → B3-bloqueado; `guia-asignacion-service.test.ts` → «mensajero BLOQUEADO -> NO se le asigna la recoleccion» |
| R32 | Los selectores marcan exactamente a los rechazados | `ordenes-guia-action.test.ts` → «271/R32: el selector marca a los BLOQUEADOS»; `asignacion-satelite-action.test.ts` → `bloqueadosIds: []`; `orden-repository.bloqueo.test.ts` → «un `solicitado` cuenta en el AVISO pero NO en la lista de bloqueados» |
| R33 | El FILTRO no bloquea | **Backend: el dato viaja y está documentado como «el filtro no lo lee».** La aserción de pantalla es **T9.4 (frontend)** |
| R34 | No bloquea a la bodega entera | `cierre-bloqueo-superficies.test.ts` → «271/R34»; `orden-repository.bloqueo.test.ts` → los casos de `existeBodegaSateliteBloqueada`; SQL real → «T10.1/R34» |
| R35 | Aprobar libera SOLO lo de ese cierre (M7) | `cierre-aprobacion-libera-solo-lo-suyo.test.ts` → los DOS casos |
| R36 | Aprobar el más viejo devuelve a LIBRE | `cierre-bloqueo-nv-sql-real.test.ts` → «T10.1/R1-R8» (el veredicto se recalcula por consulta, sin escritura) |
| R37 | No toca gestiones de otro cierre | `cierre-aprobacion-libera-solo-lo-suyo.test.ts` → «R35/R37…» |
| R38 | Aviso al mensajero por `vencido` | `bloqueo-textos.test.ts` → «4 · el corte creó un vencido — al MENSAJERO…» ; emisor: `emitirCierreDiaVencido` |
| R39 | Aviso a la bodega por `vencido` | `bloqueo-textos.test.ts` → «4-ter · … a la BODEGA» |
| R40 | Aviso al mensajero al quedar en `N≥2` | `bloqueo-textos.test.ts` → literales 1 y 3; wiring: `avisarBloqueoPorAcumular` |
| R41 | Aviso a la bodega al quedar en `N≥2` | `bloqueo-textos.test.ts` → «5 · un mensajero quedó bloqueado por acumular — a la BODEGA» |
| R42 | Aviso al RECHAZAR | **PARCIAL** — el emisor existe (`emitirMensajeroBloqueado`) y su texto está probado, pero **el productor del rechazo no está cableado**. Ver «lo que no se cubrió» |
| R43 | El aviso dice las tres cosas | `bloqueo-textos.test.ts` → los seis literales completos |
| R44 | Dedupe: mismo hecho no, hecho nuevo sí | `notificacion` (146) `emitirFilas` + la entidad es el CIERRE. **Sin test nuevo dedicado** — ver «lo que no se cubrió» |
| R45 | Sin monto ni datos de nadie | `bloqueo-textos.test.ts` → «R45: ni monto, ni colón, ni identificadores…» |
| R46 | Lenguaje claro sin siglas | `bloqueo-textos.test.ts` → «R46: lenguaje claro, sin siglas ni jerga del sistema» |
| R47 | Un aviso que falla no tumba la operación | `notificacion-productores-wiring.test.ts` → «R25 — un aviso que falla no tumba el cierre»; `emitirBestEffort` en el corte |
| R48 | La administración ve el bloqueo en la fila | `cierres-admin-service.test.ts` (los 36 casos siguen verdes con `bloqueoMensajero` en el resumen). **La pantalla es T9 (frontend)** |
| R49 | Se puede destrabar un `rechazado` | `cierres-admin-*.test.ts` (existentes) sobre `ESTADOS_REABRIBLES`; `git diff lib/utils/colas-cierre.ts` **vacío** |
| R50 | La prosa reescrita | `regla-241-caducada.guardia.test.ts` → «y la regla NUEVA sí está escrita donde vive el predicado» |
| R51 | Ninguna línea afirma la regla vieja | `regla-241-caducada.guardia.test.ts` (5 frases × `lib/`) + `bloqueo-textos.test.ts` → «R51: NINGUNO promete recibir asignaciones ni recoger en tiendas». **`app/` queda fuera hasta T9.1** |
| R52 | Los tres portales dicen lo mismo salvo el CTA | `bloqueo-textos.test.ts` → «271/R52 · la ÚNICA diferencia entre portales es el llamado a la acción» |
| R53 | Ningún total alterado | `cierre-bloqueo-nv-sql-real.test.ts` → «T2.6/R20…» (comparación antes/después de la fila entera) |
| R54 | `crearCierre` sigue devolviendo «nada creado» | `cierre-dia-repository.test.ts` (existente) → guarda «algo pasó» |
| R55 | El despliegue no cambia ninguna fila | `notificacion-evento-bloqueo-cierre-migration.test.ts` → «R55: el UP no crea tablas, no altera columnas y NO reescribe ninguna fila» |
| R56 | El aviso nombra el cierre tocado (M9) | `notificacion-productores-wiring.test.ts` → «camino de RE-SOLICITUD…» ; `cierre-dia-repository.test.ts` → «R56: busca por el `id` DEL CIERRE» |
| R57 | Jornada de las gestiones vinculadas | `jornada-cierre.test.ts` → «(a) EL CASO MEDIDO»; `cierre-bloqueo-nv-sql-real.test.ts` → «T6.10/R57…» y «…gestion ANULADA no cuenta» |
| R58 | Sin gestiones → `created_at` CR − 1 día | `jornada-cierre.test.ts` → «(b)…»; SQL real → «T6.10/R58…» |
| R59 | NO usar `orden.fecha_reparto` | `jornada-cierre.test.ts` → «guardia — el derivador NO mira `fecha_reparto`» |
| R60 | Sin jornada fiable → omitir la fecha | `jornada-cierre.test.ts` → «(c)…»; SQL real → «T6.10/R60…»; textos → variantes «sin jornada fiable» |
| R61 | UN solo derivador | `jornada-cierre.test.ts` → «(d) el cron NORMAL…» y «(d-bis) el cron ADELANTADO…» (las dos fuentes coinciden) |

**Sin test propio, y por qué:** **R17** (dos `vencido` a la vez) es un estado **inalcanzable** por la
propia regla; el spec pide explícitamente NO escribirle test ni guarda. Queda como comentario en
`CorteDiarioService` y `CierreDiaRepository` con sus tres razones.

---

## Las mutaciones (T11.2) — arnés con autocomprobación

El arnés corre la suite **sin mutar** primero y exige verde; luego, por cada mutación, la aplica,
**ejecuta vitest de verdad**, imprime el nombre del caso que murió y revierte. Salida real:

```
=== AUTOCOMPROBACION: la suite SIN mutar tiene que estar VERDE ===
  exit=0  Tests  96 passed (96)
[T10.1(a) — `aprobado` entra en los estados ABIERTOS] MURIO (rojo) — Tests  1 failed | 11 passed (12)
[T10.1(b) — `rechazado` sale del calculo de V] MURIO (rojo) — Tests  3 failed | 9 passed (12)
[T10.1(c) — `n >= 2` pasa a `n > 2`] MURIO (rojo) — Tests  2 failed | 10 passed (12)
[T2.4 (M2) — el `id` sale del WHERE de la re-solicitud] MURIO (rojo) — Tests  1 failed | 11 passed (12)
[T5.3 (M7) — la liberacion vuelve a seleccionar por mensajero] MURIO (rojo) — Tests  1 failed | 1 passed (2)
[T6.10 — la jornada vuelve a `created_at` a secas] MURIO (rojo) — Tests  4 failed | 19 passed (23)
[T6.8 (M9) — el aviso vuelve a componerse con un cierre que no es el tocado] MURIO (rojo) — Tests  2 failed | 17 passed (19)
[T4.x — la guarda de bloqueo sale de `asignarRecoleccion` (Q1 revertida)] MURIO (rojo) — Tests  5 failed | 47 passed (52)

=== COMPROBACION FINAL: todo revertido y VERDE otra vez ===
  exit=0  Tests  96 passed (96)
```

Casos que murieron, uno por mutación:

| Mutación | Caso que murió |
| --- | --- |
| (a) `aprobado` entre los abiertos | `cierre-bloqueo-nv-sql-real` → «T10.1/R1-R8: las SIETE filas de la tabla de verdad, contadas por Postgres» |
| (b) `rechazado` fuera de V | idem + «T10.2/R18: elige por EDAD, no por estado» + «T2.4/R19 (M2)…» |
| (c) `n >= 2` → `n > 2` | «T10.1/R1-R8…» + «T10.1/R34: el conteo separa a DOS mensajeros…» |
| M2: fuera el `id` del `where` | «T2.4/R19 (M2): con DOS `rechazado`, la re-solicitud mueve UNO…» |
| M7: liberar por mensajero | «R35/R37: aprobar el 1.er cierre libera SU orden y NO toca la del 2.º» |
| Jornada = `created_at` | «T6.10/R57: 3 gestiones del 21 en un cierre nacido el 22 -> la jornada es el 21» + «(a) EL CASO MEDIDO» + «(a-bis)…» |
| M9: aviso con otro cierre | «camino de RE-SOLICITUD (el mas viejo es un `vencido`)» y su gemelo `rechazado` |
| Guarda fuera de `asignarRecoleccion` | «B3-bloqueado · 4/5/5-bis: `asignarRecoleccion` -> conflict y NINGUNA orden cambia (R31)» |

---

## Lo que NO se cubrió, y por qué

1. **T9 entera (frontend).** No es alcance de esta pasada.
2. **R42 — el aviso de RECHAZO está a medias.** El evento, el emisor
   (`emitirMensajeroBloqueado`), el notificador y sus textos existen y están probados; **falta
   cablear el productor en `CierresAdminService.resolverCierre` (rama `rechazado`)**. Se dejó fuera
   a propósito: ese servicio no recibe notificador hoy y meterle uno toca la transacción del dinero,
   que merece su propio diff. **Es deuda declarada, no un olvido.**
3. **R14 (el 2.º cierre se lleva sólo lo de hoy) no tiene test nuevo.** El `where: { mensajeroId,
   cierreId: null, anuladaAt: null }` de `crearCierre` **no se tocó** y sus tests existentes siguen
   verdes. T2.2 pedía un caso sembrado con contraprueba; **no se escribió**.
4. **R44 (las dos mitades de la dedupe) no tiene test nuevo.** La propiedad se apoya en `emitirFilas`
   (146) y en que la entidad sea el CIERRE; **no se escribió el caso «otro cierre → 2 filas»**.
5. **T3.5 — el coste de la corrida del corte NO se midió.** El cambio quita una consulta por corrida
   (la que restaba) y añade una emisión por cierre creado; el universo de mensajeros evaluados crece
   hasta incluir a los que tienen cierre abierto. **Sin número medido.**
6. **T11.5 — «ver la app» NO se hizo.** Requiere el frontend.
7. **La guardia de prosa (T8.2) censa `lib/` y NO `app/`.** `CierreDiaModule.tsx` conserva su copia
   del aviso con la frase caducada; la retira **T9.1**. Cuando eso ocurra, basta añadir `"app"` a
   `RAICES` en la guardia — está escrito ahí mismo.
8. **T6.7 (guardia de PII en los emisores) no se escribió como guardia de árbol**; su contenido está
   cubierto por las aserciones negativas de `bloqueo-textos.test.ts` (`R45`).

## Deuda deliberada que la UI hereda

- `via: "resolicitado"` sustituye a `vencido_solicitado` / `rechazado_solicitado`. Los dos valores
  viejos **siguen declarados en el tipo y nadie los emite**, para que `CierreDiaModule.tsx` compile.
  Mientras tanto una re-solicitud cae en el toast genérico: **menos específico, nunca falso**.
- `estadoBloqueoMensajero` devuelve `bloqueo: BloqueoDetalle` **y** un `bloqueado: boolean`
  deprecado, derivado del mismo objeto, para que las cuatro páginas sigan compilando.
- `BLOQUEO_AVISO` sobrevive como **texto puente** sin la frase falsa. No cuenta cierres; lo sustituye
  `avisoBloqueo(detalle, { conCta })`.

---

## Gate

`./init.sh --rapido` **se niega solo** con este diff (toca `db/migrations/`, `db/schema.prisma` y
nombres de dinero), así que se corrió el **completo**.

El log completo se escribio a fichero **sin canalizar por `tail`** y con el codigo de salida
capturado **DENTRO** del bloque (`INIT_EXIT=$?`), porque en este repo un gate ROJO llego a
reportarse como «exit code 0» tapado por un `echo` posterior.

```
== Arnes SDD :: init (modo: completo) ==
✓ node v24.13.0
✓ dependencias presentes
✓ regla max-2-por-zona respetada (in_progress=1)
✓ specs presentes para features sdd en vuelo
-> pnpm run typecheck
✓ typecheck paso
-> pnpm run lint
✓ lint paso
-> pnpm run test

 Test Files  1331 passed (1331)
      Tests  18009 passed | 26 skipped (18035)
   Duration  350.04s

✓ test paso
! migraciones sin down.sql: 20260814120000_ruta_optimizada_trazado 20260814140000_ruta_parada_tramo 20260814160000_ruta_tramo_vivo_at
✓ .env presente
== init OK ==
INIT_EXIT=0
```

**El aviso de los tres `down.sql` que faltan es PREVIO a esta ficha** y no la toca: son migraciones
de rutas del 14/08. La de esta ficha SÍ tiene el suyo, y está medido contra Postgres.

**T10.5 — `tests/integration/db` completo** (añadir valores a un enum toca esa carpeta entera):

```
 Test Files  126 passed (126)
      Tests  1657 passed (1657)
```

**La migración quedó aplicada en la base local** (`prisma migrate deploy`, host `localhost:5432`,
base `ordenex`): sin eso, los casos que leen `pg_enum` no pueden pasar.

---

## Lo que le queda al FRONTEND

| Tarea | Qué pide |
| --- | --- |
| **T9.1** | `BLOQUEO_AVISO` → `avisoBloqueo(detalle, { conCta })` en los tres portales; **borrar la copia** de `CierreDiaModule.tsx:175` (es la que conserva la frase caducada) |
| **T9.2** | Los cinco literales, escritos a mano, en `RepartoModule` / `RecogerModule` / `RecoleccionModule` / `CierreDiaModule`. Ya están afirmados sobre el formateador en `tests/unit/notificaciones/bloqueo-textos.test.ts`: **cópialos de ahí, no de la función** |
| **T9.3** | `CierreDiaModuleProps`: `bloqueado: boolean` → `bloqueo: BloqueoDetalle`; `tieneVencido`/`tieneRechazado` **derivados** de él. La acción ya devuelve `bloqueo` |
| **T9.4** | `OrdenesListado.tsx` aplica `bloqueadosIds` a los **DOS** modales; `FiltrosEntregas.tsx` **NO** lo lee (R33). El campo ya viaja |
| **T9.5** | El selector de la bodega satélite deshabilita con `bloqueadosIds` (el campo ya viaja en `listarMensajerosSatelite`) |
| **T9.6** | `getByRole("alert")` → `getAllByRole` en `RepartoModule.test.tsx:839/1152/1463` |
| **+ limpieza** | Retirar `via: "vencido_solicitado" \| "rechazado_solicitado"` del tipo y sus dos ramas del toast; retirar el `bloqueado: boolean` puente de `EstadoBloqueoMensajeroResult`; añadir `"app"` a `RAICES` en `regla-241-caducada.guardia.test.ts` |
| **R48 (pantalla)** | La fila del cierre en la administración ya trae `bloqueoMensajero { bloqueado, cierresAbiertos, cierresPorReenviar }`: falta pintarlo |

**Veredicto:** backend completo y verde, con los tres fallos mudos cerrados y probados por mutación;
quedan declaradas cinco ausencias (R42 a medias, R14/R44 sin test nuevo, coste del corte sin medir,
guardia de prosa sólo sobre `lib/`) y la tanda 9 entera para el frontend.
