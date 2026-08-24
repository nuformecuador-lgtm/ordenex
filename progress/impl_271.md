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
| R10 | UN único predicado | **Verificado por LECTURA** (las 12 superficies consultan el mismo predicado) + `bloqueo-cierre.test.ts` → «guardia — el modulo de la regla es PURO». ⚠️ **Esa guardia afirma que el módulo no importa Prisma, NO que ninguna superficie re-derive**: nada impide que una superficie NUEVA monte su propia versión de la regla (review 271, **M3**) |
| R11 | El MÁS VIEJO, desempate estable | `cierre-bloqueo-nv-sql-real.test.ts` → «T10.2/R11: elige el MAS VIEJO…» y «…desempate por `id` es ESTABLE» |
| R12 | Sin bandera persistida | `cierre-bloqueo-nv-sql-real.test.ts` → «T10.1/R1-R8» (el veredicto cambia con cada siembra, sin escritura extra); `cierre-dia-action.test.ts` |
| R13 | Crear el SEGUNDO cierre | `cierre-dia-service.test.ts` → «271/R13…» |
| R14 | Vincula exactamente las de `cierre_id` nulo | `cierre-segundo-vincula-solo-lo-suyo.test.ts` → «el cierre B se lleva EXACTAMENTE las 2 sueltas y NO toca ni una del cierre A», **contra Postgres sembrado** con dos señuelos y dos mutaciones muertas (cerrado en la pasada de cobertura) |
| R15 | Bloqueado → conflict con motivo que cuenta | `cierre-dia-service.test.ts` → «271/R15: BLOQUEADO por acumular (N=2, V=0) -> conflict con motivo que CUENTA» |
| R16 | Re-solicitar SIEMPRE permitido (anti-deadlock) | `cierre-dia-service.test.ts` → «R24 + 271/R16: con un cierre `%s` y una orden en `ayuda_tienda`…» |
| R17 | Dos `vencido` a la vez: **raro pero ALCANZABLE** | ⚠️ **REESCRITO el 2026-08-23.** Decía «imposible (invariante derivado)» y **sin test a propósito**. La medida de T10.3 lo desmintió: `corte-diario-segundo-cierre-sql-real.test.ts` → «R17 · dos `vencido` a la vez es ALCANZABLE…». Los comentarios de `CorteDiarioService` y `CierreDiaRepository` **se reescribieron**; **no se añadió ninguna guarda**, y ahora por la razón correcta (ya está cubierto, no es que no exista) |
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
| R36 | Aprobar el más viejo devuelve a LIBRE | `cierre-aprobar-el-mas-viejo-desbloquea.test.ts` → «con N=2 está BLOQUEADO; aprobado el más viejo, la consulta siguiente lo da LIBRE», por el camino real y con la consulta del veredicto contra un cliente que **lanza** si alguien escribe (pasada de cobertura) |
| R37 | No toca gestiones de otro cierre | `cierre-aprobacion-libera-solo-lo-suyo.test.ts` → «R35/R37…» |
| R38 | Aviso al mensajero por `vencido` | **Productor:** `corte-diario-aviso-vencido.test.ts` → «TRES cierres creados -> TRES emisiones…» y «con un mensajero que NO crea y otro que SI…». **Emisor (quién recibe):** `cierre-vencido-destinatarios.test.ts` → «la fila del MENSAJERO es la unica dirigida a un usuario…». **Texto:** `bloqueo-textos.test.ts` → «4 · … al MENSAJERO». Los tres, y **el primero es el que faltaba** (review 271, **B2**) |
| R39 | Aviso a la bodega por `vencido` | **Emisor:** `cierre-vencido-destinatarios.test.ts` → «CUATRO filas — el mensajero dueño, maestro, admin y el adminSatelite de la zona DESTINO» + «sin zona destino NO se inventa un `adminSatelite`». **Productor:** el mismo caso del corte que R38. **Texto:** `bloqueo-textos.test.ts` → «4-ter · … a la BODEGA» |
| R40 | Aviso al mensajero al quedar en `N≥2` | **Productor:** `cierre-dia-aviso-bloqueo.test.ts` → «emite UNA vez, con el cierre RECIEN CREADO como entidad…», «el detalle se relee DESPUES de escribir…» y los **dos** casos que NO emiten (`N = 1` y el gate ya bloqueado). **Emisor:** `notificacion-bloqueo-otro-cierre-avisa.test.ts` (4 filas contra Postgres). **Texto:** `bloqueo-textos.test.ts` → literales 1 y 3 |
| R41 | Aviso a la bodega al quedar en `N≥2` | **Emisor:** `notificacion-bloqueo-otro-cierre-avisa.test.ts` → los tres roles de bodega contados en la tabla, por cierre. **Productor:** el mismo caso de `cierre-dia-aviso-bloqueo.test.ts` que R40. **Texto:** `bloqueo-textos.test.ts` → «5 · … a la BODEGA» |
| R42 | Aviso al RECHAZAR | **CERRADO** en `impl_271_r42.md`: `cierres-admin-aviso-rechazo.test.ts` → 18 casos (emite una vez, al mensajero de la fila y a la zona destino; los **cinco** desenlaces que no escriben no avisan; dos rechazos → dos entidades) + guardia de composition root. 7 mutaciones muertas |
| R43 | El aviso dice las tres cosas | `bloqueo-textos.test.ts` → los seis literales completos |
| R44 | Dedupe: mismo hecho no, hecho nuevo sí | `notificacion-bloqueo-otro-cierre-avisa.test.ts` → «el MISMO cierre dos veces deja UNA fila; OTRO cierre del mismo mensajero deja DOS», contra el índice real `notificacion_dedupe_key` (pasada de cobertura); + `cierre-vencido-destinatarios.test.ts` → «la dedupe se pregunta por (evento, EL CIERRE, destinatario)» para el otro evento |
| R45 | Sin monto ni datos de nadie | `bloqueo-textos.test.ts` → «R45: ni monto, ni colón, ni identificadores…» |
| R46 | Lenguaje claro sin siglas | `bloqueo-textos.test.ts` → «R46: lenguaje claro, sin siglas ni jerga del sistema» |
| R47 | Un aviso que falla no tumba la operación | **El corte:** `corte-diario-aviso-vencido.test.ts` → «con el notificador REAL sobre un repositorio que revienta, el corte termina y devuelve su resumen». **La solicitud:** `cierre-dia-aviso-bloqueo.test.ts` → «un aviso que revienta NO invalida el cierre ya escrito, y queda registrado». **El rechazo:** `cierres-admin-aviso-rechazo.test.ts` (por partida doble). **Los de la 146:** `notificacion-productores-wiring.test.ts`. ⚠️ Lo que **no** cubre ninguno: `repoReal()` se evalúa FUERA del `emitirBestEffort` en los siete notificadores reales (review 271, **M5**) — patrón heredado de la 146, **no lo introduce esta ficha** |
| R48 | La administración ve el bloqueo en la fila | `cierres-admin-service.test.ts` (los 36 casos siguen verdes con `bloqueoMensajero` en el resumen). **La pantalla es T9 (frontend)** |
| R49 | Se puede destrabar un `rechazado` | `cierres-admin-repository.test.ts` → «R28: destraba un `rechazado` de su alcance -> updated» + los dos casos que afirman el `where` entero. Es el repositorio **REAL** sobre un Prisma doble, y la lista `["vencido","rechazado"]` va **escrita a mano**. **Medido el 2026-08-23:** quitar `rechazado` de `ESTADOS_REABRIBLES` deja **3 tests rojos** ahí. ⚠️ **La fila anterior era FALSA** (review 271, **M6**): los `cierres-admin-*.test.ts` de SERVICIO **doblan** `forzarSolicitudVencido` y nunca llegan a la constante |
| R50 | La prosa reescrita | **Verificado por LECTURA y cumplido**: `OrdenRepository.ts:309-349` y la cabecera de `lib/constants/bloqueo-mensajero.ts` declaran la regla nueva, nombran ficha y fecha, y dicen qué sobrevive y qué se revierte. ⚠️ El test citado —`regla-241-caducada.guardia.test.ts` → «y la regla NUEVA sí está escrita…»— lee **un tercer archivo** (`lib/utils/bloqueo-cierre.ts`), así que **no vigila esos dos** (review 271, **M1**). La dirección peligrosa —que vuelva la frase vieja— sí la cubre la guardia de frases caducadas |
| R51 | Ninguna línea afirma la regla vieja | `regla-241-caducada.guardia.test.ts` (5 frases × `lib/` **y** `app/`, con anti-vacuidad por raíz y contraprueba ejecutada) + `bloqueo-textos.test.ts` → «R51: NINGUNO promete recibir asignaciones ni recoger en tiendas». ⚠️ El árbol la incumplía **fuera de esas dos raíces** (`feature_list.json` y `progress/current.md`); corregido el 2026-08-23 (review 271, **B4**) |
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

> 🔴 **ESTO ERA FALSO, y se corrigió el 2026-08-23.** El estado **es alcanzable** (feature 246 + 262)
> y **sí tiene test**: `tests/integration/db/corte-diario-segundo-cierre-sql-real.test.ts` → «R17 ·
> dos `vencido` a la vez es ALCANZABLE…». Las «tres razones» del comentario tenían el **paso 2**
> equivocado. Se deja el párrafo en pie, tachado por esta nota, porque el valor de la bitácora está
> en que se vea **qué se creyó y cuándo dejó de creerse** — no en parecer que siempre se supo. Ver la
> sección del hallazgo al final del archivo.

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
   > ✅ **CERRADO el 2026-08-23** en `progress/impl_271_r42.md`: productor cableado, 18 casos y 7
   > mutaciones muertas.
3. **R14 (el 2.º cierre se lleva sólo lo de hoy) no tiene test nuevo.** El `where: { mensajeroId,
   cierreId: null, anuladaAt: null }` de `crearCierre` **no se tocó** y sus tests existentes siguen
   verdes. T2.2 pedía un caso sembrado con contraprueba; **no se escribió**.
   > ✅ **CERRADO** en `progress/impl_271_cobertura.md`: `cierre-segundo-vincula-solo-lo-suyo.test.ts`,
   > contra Postgres y con dos mutaciones muertas.
4. **R44 (las dos mitades de la dedupe) no tiene test nuevo.** La propiedad se apoya en `emitirFilas`
   (146) y en que la entidad sea el CIERRE; **no se escribió el caso «otro cierre → 2 filas»**.
   > ✅ **CERRADO** en `progress/impl_271_cobertura.md`: `notificacion-bloqueo-otro-cierre-avisa.test.ts`,
   > contra el índice real `notificacion_dedupe_key`.
5. **T3.5 — el coste de la corrida del corte NO se midió.** El cambio quita una consulta por corrida
   (la que restaba) y añade una emisión por cierre creado; el universo de mensajeros evaluados crece
   hasta incluir a los que tienen cierre abierto. **Sin número medido.**
6. **T11.5 — «ver la app» NO se hizo.** Requiere el frontend.
7. **La guardia de prosa (T8.2) censa `lib/` y NO `app/`.** `CierreDiaModule.tsx` conserva su copia
   del aviso con la frase caducada; la retira **T9.1**. Cuando eso ocurra, basta añadir `"app"` a
   `RAICES` en la guardia — está escrito ahí mismo.
8. **T6.7 (guardia de PII en los emisores) no se escribió como guardia de árbol**; su contenido está
   cubierto por las aserciones negativas de `bloqueo-textos.test.ts` (`R45`).
   > ⏸️ **SUSTITUIDA a propósito**, y así queda marcada en `tasks.md`.

> ⚠️ **Los puntos 5 (T3.5) y 6 (T11.5) tuvieron desenlaces distintos:** **T11.5 SÍ se hizo** después,
> en dos pasadas (ver «Ver la app» más abajo); **T3.5 sigue SIN medir**. Y la revisión del 2026-08-23
> encontró **dos ausencias más que no constaban aquí**: **T8.3** (los tres specs ajenos siguen sin
> nota de caducidad) y **T10.3** (los casos del corte nunca se sembraron contra Postgres). Las tres
> abiertas están en `tasks.md` con su casilla **sin marcar**.

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

---

# impl 271 — FRONTEND (tanda 9 + limpieza)

> Pasada de **FRONTEND**, sobre el backend de `9d1b9e03`. `app/**`, los TRES sitios de `lib/` que el
> traspaso autorizaba explícitamente —los dos puentes deprecados y el tipo `via`—, y los tests de
> todo eso. **No se tocó** `db/`, ni migraciones, ni ningún servicio ni repositorio.

## Lo que se cerró

| Tarea | Qué se hizo |
| --- | --- |
| **T9.1** | `BLOQUEO_AVISO` **retirada**. Los cuatro módulos consumen `avisoBloqueo(detalle, { conCta })`: los tres portales del mensajero con `conCta: true` y `CierreDiaModule` con `false`. La copia de `CierreDiaModule.tsx:175` —la que conservaba la frase caducada— **desapareció**; en su sitio queda escrito por qué no se arregló y se borró |
| **T9.2** | Los literales, **a mano y completos**, en los cuatro módulos. Copiados de `tests/unit/notificaciones/bloqueo-textos.test.ts`, **nunca del formateador** |
| **T9.3** | `CierreDiaModuleProps`: `bloqueado` + `tieneVencido` + `tieneRechazado` → **una sola** prop `bloqueo: BloqueoDetalle`. Las tres respondían a la misma pregunta por dos caminos (predicado / histórico de cierres) |
| **T9.4** | `OrdenesListado` aplica `bloqueadosIds` a los **DOS** modales. `FiltrosEntregas` **no lo lee**, y eso ahora tiene guardia y prosa |
| **T9.5** | `AsignarSateliteModal` deshabilita con `bloqueadosIds`, que baja de la página por `listarMensajerosSatelite` |
| **T9.6** | Los tres `getByRole("alert")` de `RepartoModule.test.tsx` pasan a `getAllByRole` afirmando sobre el que interesa |
| **R48** | `bloqueoMensajero` **pintado** en la fila del cierre, dentro del comprobante — que es el que usan **las dos** listas de la administración |
| **Limpieza** | `via: "vencido_solicitado" \| "rechazado_solicitado"` **fuera** del tipo; el `bloqueado: boolean` puente de `EstadoBloqueoMensajeroResult` **fuera**; `"app"` añadido a `RAICES` de la guardia de prosa |

## Archivos creados

| Archivo | Qué es |
| --- | --- |
| `tests/components/AsignacionBloqueoPorCierre.test.tsx` | T9.4: los dos modales deshabilitan, el filtro no — con guardia de árbol sobre `FiltrosEntregas.tsx` |
| `tests/components/CierreAdminBloqueoMensajero.test.tsx` | R48: el marcador de la fila y su nota, con los tres plurales a mano |

## Archivos modificados

**Producción (`app/`)** — `cierre-dia/page.tsx` · `cierre-dia/_components/CierreDiaModule.tsx` ·
`mis-asignaciones/reparto/page.tsx` · `mis-asignaciones/recoger/page.tsx` ·
`mis-asignaciones/_components/RepartoModule.tsx` · `mis-asignaciones/_components/RecogerModule.tsx` ·
`recoleccion/page.tsx` · `recoleccion/_components/RecoleccionModule.tsx` ·
`ordenes/_components/OrdenesListado.tsx` · `ordenes/_components/AsignarBodegaModal.tsx` ·
`ordenes/_components/AsignarRecoleccionModal.tsx` · `ordenes/_components/mensajero-options.ts` ·
`recepcion-satelite/page.tsx` · `recepcion-satelite/_components/RecepcionSateliteModule.tsx` ·
`recepcion-satelite/_components/AsignarSateliteModal.tsx` ·
`cierres-admin/_components/cierre-detalle-shared.tsx` · `cierres-admin/_components/cierre-factura.tsx` ·
`_components/FiltrosEntregas.tsx` (**sólo prosa**: es la ausencia deliberada de R33).

**`lib/`, los cuatro sitios autorizados** — `lib/constants/bloqueo-mensajero.ts` (se va
`BLOQUEO_AVISO`) · `lib/actions/cierre-dia.ts` (se va el campo puente) ·
`lib/interfaces/services/ICierreDiaService.ts` (se van los dos `via` muertos).

**Tests** — `RepartoModule` · `RecogerModule` · `RecoleccionModule` · `CierreDiaModule` ·
`CierreDiaModuleIncidente` · `CierreDiaPage` · `MisAsignacionesPage` · `RecoleccionPage` ·
`RepartoAyuda` · `RepartoAyudaResueltaPorLaTienda` · `MarcarLuegoToggle` ·
`GestionarOrdenPanelHilo` · `AsignarSateliteModal` · `descarga/CierresDescarga` ·
`paginacion/BajoRiesgoPaginacion` · `paginacion/paginacion-transversal` ·
`tests/fixtures/bloqueo-cierre.ts` (+ `bloqueoConRechazado`) ·
`tests/unit/guards/regla-241-caducada.guardia.test.ts`.

---

## Tres decisiones que NO son cosméticas, y su razón

### 1. Un TERCER botón de reenvío, porque el caso 6 se quedaba sin ninguno

`tieneVencido`/`tieneRechazado` **no se pueden derivar de `aResolverPrimero.estado` a secas**, y
eso hay que decirlo porque es la derivación obvia y está mal:

`aResolverPrimero` es el cierre **abierto** más viejo, que no siempre es el **re-solicitable** más
viejo. En el **caso 6 de la tabla de verdad** —«solicitó el 1.º y dejó vencer el 2.º», N=2, V=1— el
más viejo es el `solicitado`, que lo resuelve la bodega. Derivando de su estado, los dos CTA quedan
apagados y **el mensajero se queda con un cierre que sí puede reenviar y sin ningún botón para
hacerlo**, en un caso que el spec enumera como alcanzable. El servidor, mientras, sí se lo permite
(R16/R18: transiciona el re-solicitable más viejo).

Lo implementado: los dos CTA específicos salen cuando `aResolverPrimero.resuelve === "mensajero"`
(ahí su estado SÍ describe lo que el servidor va a transicionar), y cuando
`cierresPorReenviar >= 1` sin poder nombrarlo sale un **CTA neutro** («Enviar el cierre a
aprobación»). Las tres ramas son excluyentes por construcción y hay test de cada una.

⏳ **El dato que falta, anotado y NO implementado** (el traspaso pedía anotarlo, no programarlo):
`BloqueoDetalle` no trae *el estado del cierre RE-SOLICITABLE más viejo*. Con él, el CTA neutro
sobra. Mientras tanto el texto es **menos específico, nunca falso**.

### 2. Los avisos del vencido y del rechazado PERDIERON su promesa

Decían «Envíalo a aprobación **para destrabar tu operación**» y «con eso **se levanta el bloqueo**
y sigues gestionando y cobrando, sin esperar a que tu bodega lo apruebe». La feature 241 verificó
esa segunda frase contra el predicado y era **cierta** — mientras un mensajero no pudiera tener más
de un cierre abierto.

Desde esta ficha puede tener dos, y entonces reenviar **no** lo desbloquea (**R8**). Una promesa
condicional dicha en absoluto es una promesa falsa la mitad de las veces, y **R43** prohíbe
prometer lo que el servidor va a rechazar. Los dos avisos se quedan con lo que es cierto siempre
—qué pasó con ese cierre y dónde está el botón—; quién dice **qué pasa después** es el aviso de
bloqueo de arriba, que sí distingue los dos casos y que **se pinta siempre que hay algo que
reenviar** (tener un cierre re-solicitable implica estar bloqueado, por la propia regla).

Los tests que afirmaban las frases viejas se reescribieron **con su porqué al lado**, y con la
aserción negativa de las dos promesas retiradas.

### 3. El toast de la re-solicitud sale del BOTÓN, no de `via`

`via: "resolicitado"` unifica los dos valores viejos, así que la respuesta ya no distingue vencido
de rechazado. Quien sí lo sabe es el botón que se pulsó: `confirmarSolicitud(okReenvio)` recibe su
mensaje. Los tres toasts siguen siendo específicos y ninguno puede mentir, porque en las dos ramas
específicas el cierre que el servidor transiciona **es** el que el botón nombra (el re-solicitable
más viejo coincide con el abierto más viejo cuando éste es re-solicitable).

---

## La guardia de prosa ahora censa `app/`, y se comprobó que muerde

`RAICES = ["lib", "app"]`. Y se le añadió un **anti-vacuidad por raíz**: con `lib/` sola el censo ya
pasaba de 100 archivos, así que un `app/` que dejara de recorrerse habría sido invisible en el
total — el mismo agujero que el `if (!fks) return;` de los tests de integración.

**Contraprueba ejecutada** (no razonada):

```
1. Añadida a `CierreDiaModule.tsx` la línea «Si puedes seguir recibiendo asignaciones»
   -> Test Files 1 failed | Tests 1 failed | 6 passed (7)
2. Revertida
   -> Test Files 1 passed | Tests 7 passed (7)
```

`tests/` queda **fuera de la guardia a propósito**: un test puede citar la frase derogada para
afirmar que NO aparece —`bloqueo-textos.test.ts` lo hace, y es la aserción que impide reponerla—,
así que censarlo pondría rojo justamente al que la vigila.

---

## Mapa `R<n>` → test (lo que aporta ESTA pasada)

| R | Qué exige en pantalla | Test |
| --- | --- | --- |
| R32 | Los tres selectores marcan a los bloqueados | `AsignacionBloqueoPorCierre.test.tsx` → «el modal de REPARTO…» y «el modal de RECOLECCIÓN…»; `AsignarSateliteModal.test.tsx` → «R32: el mensajero bloqueado sale DESHABILITADO…» |
| R33 | El FILTRO no bloquea | `AsignacionBloqueoPorCierre.test.tsx` → «ofrece a TODOS los mensajeros servidos…» + «guardia: `FiltrosEntregas.tsx` no LEE `bloqueadosIds`…» |
| R34 | No bloquea a la bodega entera | `AsignacionBloqueoPorCierre.test.tsx` → «R34: su compañero sin cierres sigue elegible»; `AsignarSateliteModal.test.tsx` → «R34: y su compañera SIN cierres…» |
| R43 | El aviso dice las tres cosas | Los cuatro portales: `RepartoModule` / `RecogerModule` / `RecoleccionModule` / `CierreDiaModule` → «271/§10.2 caso 1 / 2 / 3» |
| R46 | Lenguaje claro, sin siglas | `CierreAdminBloqueoMensajero.test.tsx` → «R46: sin siglas ni nombres de estado…»; el motivo de los selectores es «tiene cierres sin resolver» |
| R48 | La administración ve el bloqueo en la fila | `CierreAdminBloqueoMensajero.test.tsx` → los 9 casos |
| R51 | Ninguna línea promete lo derogado | `regla-241-caducada.guardia.test.ts` (ahora también `app/`); + aserción negativa en los cuatro portales |
| R52 | Los cuatro dicen lo mismo salvo el CTA | Los mismos literales en los cuatro archivos, con la ÚNICA diferencia del puntero (`CierreDiaModule` → «…con el botón de abajo»; los otros tres → «Ve a «Cierre del día»…») |
| R60 | Sin jornada fiable, la fecha se omite | `RepartoModule` / `RecogerModule` / `CierreDiaModule` → «271/R60 · … la fecha DESAPARECE entera» |
| R5 | Un `solicitado` a secas NO bloquea | Los cuatro portales → «271/R5 · un solo cierre YA enviado (N=1, V=0)…» |

**Los cinco literales de §10.2:** los **tres al mensajero** se afirman en los cuatro módulos (son
los que la pantalla pinta); los **dos a la bodega** son texto de notificación y siguen viviendo en
`tests/unit/notificaciones/bloqueo-textos.test.ts`, que no cambió.

---

## Gate de esta pasada — parcial y DECLARADO como tal

⚠️ **NO se corrió `./init.sh`.** Había otro agente trabajando en paralelo sobre esta misma feature,
y en este repo el gate lee el árbol mutado por el subagente: su veredicto no valdría. El completo lo
lanza el leader cuando las dos pasadas hayan aterrizado.

Lo que **sí** se corrió, con su resultado:

```
pnpm exec tsc --noEmit                                    -> sin una sola línea de salida
pnpm run lint                                             -> 99 problems (0 errors, 99 warnings)   [las 99 son previas]
vitest run tests/components tests/unit/guards tests/unit/components
                                                          -> Test Files 350 passed | Tests 4799 passed | 26 skipped
vitest run tests/unit/actions tests/unit/notificaciones   -> Test Files  57 passed | Tests  748 passed
vitest run tests/unit/services/{cierre-dia,guia-asignacion,asignacion-satelite,cierres-admin,cierre-bloqueo-superficies}-service…
                                                          -> Test Files   5 passed | Tests  349 passed
```

**Lo que este gate parcial NO cubre, y hay que correr después:** `tests/integration/db` (esta pasada
no toca base, pero el gate completo es de la feature, no de la pasada), `tests/unit/repositories` y
el resto de `tests/unit/services`.

---

## Lo que NO se hizo, y por qué

1. **T11.5 — «ver la app» sigue sin hacerse.** Es lo único que ve la pantalla de verdad, y en este
   repo Playwright encontró en minutos siete textos rotos que 12.000 tests daban por buenos. Sin
   levantar la app y entrar como mensajero con N=2, **el aviso nuevo no se ha visto nunca
   renderizado**.
2. **El dato que falta en `BloqueoDetalle`** (el estado del re-solicitable más viejo). Anotado
   arriba; con él, el tercer CTA sobra. **No se implementó: es backend.**
3. **R42 sigue a medias** (el productor del aviso de rechazo no está cableado). Es deuda del
   backend, declarada en su pasada, y no se toca desde aquí.
4. **La prosa caducada que queda en `tests/`.** `orden-repository.asignacion-satelite.test.ts:26` y
   `guia-asignacion-service.test.ts:590` siguen afirmando en comentarios la regla del 20/08. Son
   tests de la pasada de backend y la guardia no censa `tests/` a propósito (ver arriba). **Queda
   escrito, no corregido**: tocar comentarios de tests ajenos a esta pasada sin correr su suite
   entera es cómo se cuelan las regresiones que nadie atribuye.

**Veredicto de la pasada de frontend:** T9.1–T9.6, R48 y la limpieza, cerradas y verdes; el hueco
del caso 6 encontrado y tapado con su razón escrita; una ausencia de dato anotada y no inventada; y
el gate completo pendiente del leader.

---

# impl 271 — BACKEND (pasada de datos): el re-solicitable más viejo, en el `BloqueoDetalle`

**Encargo:** cerrar el hueco de datos que encontró la pasada de frontend (ver «Lo que NO se hizo»,
punto 2, justo arriba). **Sólo el dato: ni un `.tsx` tocado.**

## El hueco, con el caso delante

`BloqueoDetalle` sólo llevaba `aResolverPrimero` = el cierre **abierto** más viejo. Ese no siempre es
el que el mensajero puede tocar. En el **caso 6** de la tabla de verdad —el caso 5 que dictó el
humano: «solicitó el primero y dejó vencer el segundo», `N=2, V=1`— el abierto más viejo es el
`solicitado`, y ése lo resuelve **la bodega**. El que él puede reenviar es el otro. Una pantalla que
derive el botón de `aResolverPrimero` le dice «espera a la administración» y **le esconde el botón de
reenviar el segundo, que `solicitarCierre` sí le permite** (R16/R18). El frontend lo tapó con un CTA
neutro; ahora el dato existe y la imprecisión se puede quitar.

## El campo

`lib/utils/bloqueo-cierre.ts` — `BloqueoDetalle` gana **un campo propio, separado**:

    /** El cierre RE-SOLICITABLE (`vencido` o `rechazado`) MAS VIEJO, o `null` si `V = 0`. */
    aReenviarPrimero: CierreAResolver | null;

Mismo tipo que `aResolverPrimero` (`CierreAResolver`: `cierreId`, `estado`, `solicitadoAt` en ISO
string, `jornadaCR`, `resuelve`), a propósito: la pantalla puede tratar los dos igual y no ramificar.

Cuatro propiedades que **no** son opcionales y están afirmadas en test:

1. **Es el más viejo DE LOS RE-SOLICITABLES**, no el más nuevo (R18: se resuelve siempre del más
   viejo al más nuevo). Mismo `ORDER BY` que `CierreDiaRepository.findCierreResolicitableMasViejo`,
   que es **el que la re-solicitud mueve de verdad**: nombrar uno y mover otro sería el aviso
   desincronizado que la 271 viene a cerrar.
2. **Su jornada la deriva `derivarJornada`** (`lib/utils/jornada-cierre.ts`), el único derivador
   (R61). No se escribió otro: los dos campos salen del **mismo** método privado
   `OrdenRepository.aCierreAResolver`.
3. **`V = 0` → `null`.** Y sin segunda consulta: el caso normal (`N=1, V=0`) no paga nada.
4. **`resuelve` es siempre `"mensajero"`** por construcción, y si el más viejo abierto ya es
   re-solicitable (casos 5 y 7) los dos campos apuntan **al mismo cierre**.

`aResolverPrimero` **no cambia**: sigue siendo el orden de la cola (R11). Son dos preguntas
distintas y por eso son dos campos; fundirlas mentiría en el caso 6 por un lado o por el otro.

## Archivos modificados

| Archivo | Qué |
|---|---|
| `lib/utils/bloqueo-cierre.ts` | `+ aReenviarPrimero` en `BloqueoDetalle` (con su porqué) y en `SIN_BLOQUEO` |
| `lib/repositories/OrdenRepository.ts` | `findBloqueoDetalle` lo puebla; `+ SELECT_CIERRE_A_RESOLVER`; `+ aCierreAResolver` privado (el único sitio que deriva jornada) |
| `lib/interfaces/repositories/IOrdenRepository.ts` | doc del contrato: trae DOS cierres, no uno |
| `tests/fixtures/bloqueo-cierre.ts` | `bloqueoDe` produce el campo coherente con N/V (y `bloqueoDe({n:2,v:1})` es ya el **caso 6** completo, con dos cierres distintos); `bloqueoConRechazado` lo sobreescribe a la vez para no fabricar un doble imposible |
| `tests/unit/repositories/orden-repository.bloqueo.test.ts` | **una línea**: el `toEqual` exhaustivo del caso `N=0` lista el campo nuevo |
| `tests/integration/db/cierre-bloqueo-nv-sql-real.test.ts` | **+6 casos** contra Postgres sembrado |

⚠️ **Dos ficheros bajo `tests/` tocados fuera del acordado, y por qué:** el encargo pedía quedarse en
`lib/` + el `.test.ts` de integración, pero `BloqueoDetalle` se construye **literalmente** en esos
dos sitios y el campo es requerido: dejarlos sin tocar deja el **typecheck rojo**. Los cambios son
mecánicos (una línea en el test; el fixture deriva el campo de `n`/`v`, sin decisión nueva).

## Mapa `R<n>` → test (lo que aporta ESTA pasada)

Todo en `tests/integration/db/cierre-bloqueo-nv-sql-real.test.ts`, **contra Postgres real y con datos
sembrados**: qué fila es «la más vieja re-solicitable» sale de un `WHERE` + `ORDER BY`, y los dobles
no ven el SQL.

| R | Test |
|---|---|
| R18 / R16 | «R18/R16 (CASO 6): `aReenviarPrimero` es el `vencido`, no el `solicitado` más viejo» |
| R18 (orden) | «R18: el re-solicitable expuesto es el MÁS VIEJO de los re-solicitables, no el más nuevo» — 3 cierres, insertados del más nuevo al más viejo; **y** cruza con `findCierreResolicitableMasViejo` (lo que la re-solicitud mueve) |
| R18 (V=0) | «R18: con V=0 (dos `solicitado`) NO hay nada que reenviar → `aReenviarPrimero` es null» |
| R18 (casos 5 y 7) | «si el más viejo YA es re-solicitable, los dos campos son el MISMO cierre» |
| R57 / R61 | «(CASO 6): la jornada de `aReenviarPrimero` sale de SUS gestiones, no de las del otro» — dos cierres con jornadas distintas (19 y 21) |
| R58 / R61 | «(CASO 6): el re-solicitable SIN gestiones cae al mismo fallback (`created_at` CR −1)» |

## Las mutaciones — el campo se mató antes de creérselo

Cuatro mutaciones sobre `lib/repositories/OrdenRepository.ts`, cada una aplicada sola y revertida
después. **Ninguna sobrevivió:**

| # | Mutación | Resultado |
|---|---|---|
| A | `orderBy` del re-solicitable `asc` → `desc` | ROJO, **1 test** («el MÁS VIEJO de los re-solicitables»: devolvió el `vencido` del 22 en vez del `rechazado` del 20) |
| B | `CIERRE_ESTADOS_RESOLICITABLES` → `CIERRE_ESTADOS_ABIERTOS` en su `WHERE` | ROJO, **4 tests** |
| C | `reenviable.id === masViejo.id` → `true` (el campo copia siempre al otro) | ROJO, **4 tests** |
| D | `esCierreResolicitable(masViejo.estado)` → `true` (**el defecto original**: tomar el abierto más viejo como si fuera reenviable) | ROJO, **4 tests** |

Autocomprobación: las cuatro corridas imprimieron ids/fechas **de la base** (UUID de Postgres,
`f6408126-…` frente a `11f982a7-…`), no de un doble; y la corrida limpia posterior vuelve a 18/18.

## Gate de esta pasada — parcial y DECLARADO

⚠️ **NO se corrió `./init.sh`** (lo lanza el leader; hay otro agente en `tests/` en paralelo).

    pnpm run typecheck                                        -> sin una sola línea de salida
    pnpm run lint                                             -> 99 problems (0 errors, 99 warnings)   [las 99 son previas]
    vitest run tests/integration/db/cierre-bloqueo-nv-sql-real.test.ts
                                                              -> Test Files 1 passed | Tests 18 passed  (antes 12)
    vitest run <los 12 consumidores del fixture> + orden-repository.bloqueo + utils/bloqueo-cierre
                                                              -> Test Files 14 passed | Tests 618 passed
    pnpm exec vitest run guard   (las guardias completas)     -> Test Files 138 passed | Tests 2054 passed
    pnpm run test:cambiados                                   -> Test Files 401 passed | Tests 6030 passed | 26 skipped

## Lo que le queda al FRONTEND (una pasada, no tocada aquí)

1. **Derivar el CTA de `bloqueo.aReenviarPrimero`, no de `aResolverPrimero`.**
   `CierreDiaModule.tsx` (~línea 404) calcula hoy
   `reenviable = bloqueo.aResolverPrimero?.resuelve === "mensajero" ? … : null`. Con el campo nuevo
   eso es `bloqueo.aReenviarPrimero` a secas, y `tieneVencido`/`tieneRechazado` salen de su `estado`.
2. **El CTA neutro (`tienePorReenviarSinNombrar`) y su `confirmarReenvio` sobran**: existían sólo
   porque el dato no estaba. Con `aReenviarPrimero` el caso 6 ya se puede nombrar con precisión —el
   estado real y **la fecha de su jornada**—, que es lo que pidió el humano.
3. **El aviso del caso 6 puede decir las dos cosas a la vez**: qué espera de la bodega
   (`aResolverPrimero`) y qué puede hacer él ya mismo (`aReenviarPrimero`). Hoy sólo dice la primera.
4. **Sigue sin hacerse «ver la app»** (T11.5). Este campo no se ha visto renderizado nunca.

**Veredicto:** el dato existe, es el más viejo de los re-solicitables, comparte derivador de jornada,
está probado contra Postgres sembrado y sobrevivió a cuatro mutaciones que lo mataron; la pantalla
sigue sin cablearse, a propósito.

---

# impl 271 — FRONTEND (pasada corta): el botón sale de `aReenviarPrimero`, y el CTA neutro se va

**Encargo:** cablear el campo que el backend acaba de añadir (sección anterior, «Lo que le queda al
FRONTEND», puntos 1-3). **Sólo la capa de presentación: ni `lib/`, ni `tests/fixtures/`.**

## Qué se cerró

**1 · El CTA se deriva del campo correcto.** `CierreDiaModule.tsx` calculaba

    const reenviable =
      bloqueo.aResolverPrimero?.resuelve === "mensajero" ? bloqueo.aResolverPrimero : null;

y ahora es `bloqueo.aReenviarPrimero` a secas; `tieneVencido`/`tieneRechazado` salen de **su**
`estado`. Sin ramificar por caso: el campo ya es `null` con `V = 0` y apunta al mismo cierre que
`aResolverPrimero` en los casos 5 y 7. Como `estado` es siempre `vencido` o `rechazado`, las dos
ramas son excluyentes **y exhaustivas**: no queda un re-solicitable sin botón.

**2 · El CTA neutro se retiró entero** —`tienePorReenviarSinNombrar`, su `<section>`, el estado
`confirmarReenvio`, su `<Modal>` y sus cuatro literales (`REENVIAR_AVISO`, `REENVIAR_CTA_LABEL`,
`REENVIAR_CONFIRM_TITULO`, `REENVIAR_CONFIRM_DETALLE`)—. Existía sólo porque el dato no viajaba.
Con `aReenviarPrimero` el caso 6 enciende el CTA del `vencido` (o el del `rechazado`) **con nombre
propio**; dejar además el neutro sería un segundo botón para el mismo envío.
**`REENVIAR_OK` sobrevive y no es residuo:** es el toast de «Solicitar cierre» cuando el servidor
responde `resolicitado` en vez de `creado` (ese botón genérico no sabe qué acabó de mover, R18).

**3 · El aviso del caso 6 ya dice las dos cosas — y no hizo falta tocar su texto.** El literal
aprobado (§10.2, caso 3) ya nombra las dos: «**Envía el que falta** y espera a que la bodega apruebe
el más antiguo, el del 21 de agosto». La mitad que faltaba no era la frase sino **el sitio donde
enviarlo**, y eso es el botón del punto 1. La fecha ya salía de donde debe: `aposicionDeJornada` lee
`aResolverPrimero.jornadaCR`, que es a quien cuelga la aposición («el más antiguo» = el de la
bodega). Leerla del re-solicitable nombraría el cierre equivocado, y ahora hay un test que lo mata.

**⚠️ NINGÚN LITERAL APROBADO SE TOCÓ.** `lib/constants/bloqueo-mensajero.ts` no aparece en el diff.

## Archivos modificados

| Archivo | Qué |
|---|---|
| `app/(app)/cierre-dia/_components/CierreDiaModule.tsx` | `reenviable` ← `aReenviarPrimero`; fuera el CTA neutro (estado, sección, modal y 4 literales); prosa de la prop `bloqueo` y de los dos CTA puesta al día |
| `tests/components/CierreDiaModule.test.tsx` | bloque del caso 6 reescrito y ampliado a los casos 1, 2/3, 4, 5, 6 y 7 (**+8 tests**, 65 → 73) |

**`tests/fixtures/bloqueo-cierre.ts` NO se tocó** (lo acaba de tocar el backend y hay otro agente en
`tests/`). El **caso 7** —`N=2, V=2`, dos `rechazado`— se compone **dentro del propio test**: pedirle
`{ n: 2, v: 2 }` a `bloqueoDe` produciría **dos `vencido`**, que **R17 declara imposible** *(⚠️ y no
lo es: medido alcanzable el 2026-08-23; la decisión del fixture no cambia, sólo su motivo — se elige
el doble del caso **frecuente**, no se esquiva un imposible)*, y un test verde contra un imposible no
dice nada. Su `bloqueado` no se escribe a mano: sale de
`estaBloqueadoPorCierres`, igual que en la fábrica compartida. **Si alguien lo sube al fixture, que
sea con esa restricción encima.**

## Mapa `R<n>` → test (`tests/components/CierreDiaModule.test.tsx`)

| R | Caso | Test |
|---|---|---|
| R16/R18 | **6** (`N=2, V=1`) | «el CTA sale del RE-SOLICITABLE, no del más viejo de la cola» — **el test de la regresión** |
| R43 | **6** | «el aviso dice LAS DOS COSAS y el botón está debajo, en la misma pantalla» (literal §10.2 **a mano y completo**) |
| R43/R57 | **6** | «la fecha del aviso es la del cierre que espera a la BODEGA, no la del suyo» — dos jornadas distintas (21 vs 22) |
| R13/R18 | **5** (`N=1, V=1`) | «con un único cierre vencido, su CTA y ningún otro» |
| R31/R18 | **7** (`N=2, V=2`) | «aparece el CTA del rechazado, que es SU clase» |
| R6/R18 | **4** (`N=2, V=0`) | «bloqueado por ACUMULAR NO ofrece ningún botón de reenvío» (`aReenviarPrimero` es `null`) |
| R5 | **2/3** (`N=1, V=0`) | «un solo cierre YA enviado tampoco ofrece reenvío» |
| R4 | **1** (`N=0`) | «sin ningún cierre abierto no hay ni aviso ni botón» |
| R18 | **6** | «al confirmar, el CTA nombrado invoca la MISMA action y da SU toast» |

Los cuatro últimos son la mitad negativa que pedía el encargo: **el botón NO aparece cuando
`aReenviarPrimero` es `null`**. Y las tres menciones del CTA retirado son guardia: que no vuelva.

## Las mutaciones — cinco, aplicadas de una en una y revertidas

| # | Mutación | Resultado |
|---|---|---|
| A | `reenviable` vuelve al `aResolverPrimero?.resuelve === "mensajero" ? … : null` (**el defecto original**) | ROJO, **3 tests** (los tres del caso 6) |
| B | `reenviable = bloqueo.aResolverPrimero` | ROJO, **3 tests** (los tres del caso 6) |
| C | `tieneRechazado = reenviable !== null` (el rechazado se enciende con cualquier reenviable) | ROJO, **3 tests** (casos 5 y 6 + «sin cierre rechazado NO aparece su CTA») |
| D | `tieneVencido = reenviable !== null` | ROJO, **1 test** — **sólo el caso 7**, que es justo el que se añadió para eso |
| E | `aposicionDeJornada` lee `aReenviarPrimero` antes que `aResolverPrimero` (en `lib/`, revertida) | ROJO, **1 test** (la fecha del aviso) |

Autocomprobación: la corrida limpia posterior a cada revert vuelve a **73/73**, y `git diff --stat`
tras la última confirma que sólo quedan tocados los dos archivos de la tabla de arriba.

## Gate de esta pasada — parcial y DECLARADO

⚠️ **NO se corrió `./init.sh`** (lo lanza el leader).

    pnpm run typecheck                                        -> sin una sola linea de salida
    pnpm run lint                                             -> 99 problems (0 errors, 99 warnings)  [las 99 son previas]
    vitest run tests/components/CierreDiaModule.test.tsx      -> Test Files 1 passed | Tests 73 passed  (antes 65)
    vitest run <los 8 componentes del bloqueo por cierre>     -> Test Files 8 passed | Tests 283 passed
    pnpm exec vitest run guard   (las guardias completas)     -> Test Files 138 passed | Tests 2054 passed
    pnpm run test:cambiados                                   -> Test Files 401 passed | Tests 6036 passed | 26 skipped

## Lo que NO se hizo

1. **Sigue sin hacerse «ver la app» (T11.5).** Ni `aReenviarPrimero` ni el CTA del caso 6 se han
   visto renderizados en un navegador. En este repo eso ya encontró 7 textos rotos que 12.000 tests
   daban por buenos: **no está cubierto por lo de arriba**.
2. **Los otros tres portales** (`RepartoModule`, `RecogerModule`, `RecoleccionModule`) siguen sin
   botón, **a propósito**: su aviso lleva `conCta: true` y remite a «Cierre del día», que es donde
   está el botón. Ninguno lee `aReenviarPrimero` y ninguno lo necesita.
3. **Ningún texto aprobado se cambió, y ninguno pidió cambiarse.** No hay consulta pendiente con el
   humano por esta pasada.

**Veredicto:** el caso 6 ya ofrece el botón que el servidor siempre le permitió, con el nombre y la
clase reales; el CTA neutro y su deuda se fueron con él; cinco mutaciones —incluida la del defecto
original— murieron; falta ver la app.

---

# impl 271 — FRONTEND (pasada de textos): las tres correcciones que encontró el navegador

**Encargo:** tres correcciones de texto **aprobadas por el humano** el 2026-08-23, salidas de mirar
la app en el navegador. Sólo capa de presentación: `lib/constants/bloqueo-mensajero.ts` (TS puro,
autorizado explícitamente), `RecoleccionModule.tsx` y los tests de los dos.

## FIX 1 — el «lo» del caso 6 nombraba el cierre que él NO puede enviar

El aviso del caso 6 (`N ≥ 2`, `V ≥ 1`) terminaba, en los tres portales con `conCta: true`:

> … espera a que la bodega apruebe el más antiguo, el del 21 de agosto. **Ve a «Cierre del día»
> para enviarlo a aprobación.**

El sintagma más cercano a ese «lo» es *el más antiguo*, que es justo el que resuelve la bodega. El
puntero de ESE caso —y sólo de ése— pasa a ser `Ve a «Cierre del día».`: la frase anterior ya dice
qué enviar, así que al puntero le queda decir dónde. Vive en `IR_A_CIERRE_SIN_OBJETO`, separado de
`IR_A_CIERRE`, que **no cambia** y sigue sirviendo al caso de un solo cierre (`V ≥ 1`, `N = 1`),
donde el «lo» no puede ambiguarse. Hay test de las dos mitades: el nuevo sin objeto y el viejo
**con** él («caso 2 · el puntero de UN SOLO cierre CONSERVA su objeto»), para que nadie los
«unifique».

## FIX 2 — con TODOS los pendientes en su tejado el aviso decía dos cosas falsas

Estado alcanzable (dos `rechazado`, o `vencido` + `rechazado`): `V = N`. Caía en el texto mixto y
decía **«Envía el que falta»** en singular con dos por enviar, y **«espera a que la bodega apruebe
el más antiguo»** cuando el más antiguo es suyo y la bodega no lo va a aprobar sola. Rama propia,
con el texto aprobado:

> Tienes 2 cierres sin resolver y **ninguno se ha enviado** a aprobación. Mientras tanto no puedes
> entregar, cobrar ni recibir trabajo nuevo. **Envíalos a aprobación, empezando por el más
> antiguo**, el del 21 de agosto.

La fecha sigue saliendo de `aResolverPrimero` y aquí no puede mentir: con `V = N` el abierto más
viejo **es** el re-solicitable más viejo (garantizado por el repositorio y afirmado contra
Postgres), así que «el más antiguo» es el mismo cierre por los dos caminos.

**En los tres portales con `conCta: true` se le añade el puntero nuevo** (`Ve a «Cierre del día».`).
No es texto inventado: es el literal aprobado en el FIX 1 y este estado vive dentro de esa misma
rama. Sin él, «Envíalos a aprobación» quedaría sin decir dónde en las pantallas donde el botón no
está.

**Y el plural de la rama MIXTA** (`V ≥ 1`, `V < N`): `Envía el que falta` → `Envía los que faltan`
cuando `V > 1` (alcanzable con `N = 3, V = 2`). Nada más de esa rama se tocó.

### ⚠️ LO QUE SE ENCONTRÓ EN LA RAMA MIXTA — ALCANZABLE, y NO se le inventó texto

La frase «espera a que la bodega apruebe el más antiguo» de la rama mixta **sólo es cierta si el
abierto más viejo no es re-solicitable**. Ese supuesto **NO se cumple siempre**:

- **Estado exacto:** `N = 2, V = 1` con el **más viejo `rechazado`** (o `vencido`) y el más nuevo
  `solicitado`. Es decir, `aResolverPrimero.resuelve === "mensajero"` con `v < n`.
- **Cómo se llega:** el mensajero acumula dos `solicitado` (permitido: el 2.º se crea con
  `N=1, V=0`) y **el administrador rechaza el PRIMERO**. `CierresAdminService.rechazarCierre`
  recibe un `cierreId` cualquiera y **no exige que sea el más viejo**: no hay guarda de orden.
- **Medido en el navegador**, sembrando ese estado (jornada 20 el `rechazado`, 21 el `solicitado`):

  > «Tienes 2 cierres sin resolver y 1 de ellos no se ha enviado a aprobación. … Envía el que falta
  > y espera a que la bodega apruebe **el más antiguo, el del 20 de agosto**. Ve a «Cierre del
  > día».»

  y justo debajo, en la misma pantalla, el botón **«Solicitar aprobación del cierre rechazado»**:
  le manda a esperar por el mismo cierre que le ofrece reenviar. La fecha nombra el suyo.
- **Se detecta sin dato nuevo** (`aResolverPrimero.resuelve === "mensajero"` con `v < n`), pero
  **el texto de ese caso no estaba aprobado y no se inventó ninguno**: se consultó con el humano.

> ✅ **DEUDA CERRADA el 2026-08-23**, con el texto que el humano aprobó después de leer esto. La
> implementa la pasada siguiente («la cuarta rama»), al final de este archivo.

## FIX 3 — la contradicción del vacío de Recolección

`VACIO` se pintaba entero sin mirar `bloqueado`, así que debajo del aviso «no puedes … recibir
trabajo nuevo» venía «Puedes escanear igual: si el maestro acaba de asignarte una, se confirmará
aquí». Falso por partida doble: bloqueado **no hay disparador de escaneo en pantalla** (lo apaga el
mismo `bloqueado`) y el servidor rechaza la recolección (R25/R31). Era **previo a la 271**; la 271
lo volvió falso.

No se inventó texto: la constante se parte y **la mitad que promete sólo se pinta si no está
bloqueado**. Con la mitad negativa Y la positiva en test — quitar la promesa para todos también
tiene que poner rojo, y lo pone.

## Archivos modificados

| Archivo | Qué |
|---|---|
| `lib/constants/bloqueo-mensajero.ts` | `IR_A_CIERRE_SIN_OBJETO`; rama `v === n` con su texto; plural de la mixta; la deuda de la rama mixta escrita donde vive |
| `app/(app)/recoleccion/_components/RecoleccionModule.tsx` | `VACIO` partido en dos; la promesa sólo si NO está bloqueado |
| `tests/fixtures/bloqueo-cierre.ts` | `+ bloqueoTodosPorEnviar(n, jornadaCR)` — `V = N` con dos `rechazado`, **nunca** `bloqueoDe({n, v:n})`, que fabricaría dos `vencido` (~~R17: imposible~~ → **corregido el 2026-08-23: es alcanzable, pero raro**; el doble sigue siendo el del caso frecuente) |
| `tests/unit/notificaciones/bloqueo-textos.test.ts` | literales a mano: caso 3 con el puntero nuevo, `V = N` (con y sin jornada), mixta con `V = 2`, y el caso 2 conservando su objeto |
| `tests/components/{Reparto,Recoger,Recoleccion,CierreDia}Module.test.tsx` | el literal del caso 6 puesto al día + un caso `V = N` por portal |
| `tests/components/RecoleccionModule.test.tsx` | las **dos** mitades del vacío: bloqueado sin promesa, libre con promesa |

**Ningún otro literal aprobado se tocó.** El caso 1 (acumular, sin CTA), el caso 2 (un solo cierre,
con su «para enviarlo») y las variantes sin jornada quedan byte a byte como estaban, y hay test de
cada uno.

## Las mutaciones — siete, aplicadas de una en una, con autocomprobación

El arnés corre la suite SIN mutar primero y exige verde, aplica cada mutación, **ejecuta vitest de
verdad**, imprime el caso que murió, revierte, y al final compara el **sha256** de los dos archivos
con la copia original. **Ninguna sobrevivió.**

| # | Mutación | Resultado |
|---|---|---|
| M1 | el puntero del caso 6 vuelve a llevar objeto (**el defecto original**) | ROJO, **8 tests** (los 4 portales × caso 6 y `V=N`, + los 2 del contrato) |
| M1-bis | los DOS punteros se unifican (se pierde el objeto también en el caso de un solo cierre) | ROJO, **5 tests** |
| M2 | la rama `V = N` desaparece: ese estado vuelve al texto mixto | ROJO, **7 tests** |
| M3 | el plural de la mixta vuelve al singular fijo | ROJO, **1 test** («3-quater · MIXTO con DOS por enviar») |
| M4 | «ninguno» vuelve a contar en número («2 de ellos no se han enviado») | ROJO, **7 tests** |
| M5 | el vacío de Recolección vuelve a prometer el escaneo SIEMPRE | ROJO, **1 test** |
| M5-bis | la promesa se quita también estando LIBRE (sobre-corrección) | ROJO, **1 test** |

Autocomprobación: base 277/277 verde antes, 277/277 verde después, y los dos sha256 idénticos.

## Ver la app (T11.5, por fin) — los cuatro portales, con `innerText`

`pnpm dev` a un **archivo**, Playwright vía `createRequire`, login `mensajero.qa@ordenex.test`
(**hash bcrypt comprobado antes de empezar; `seed-usuarios-qa.ts` NO se corrió**), submit tras
`networkidle` + espera, y **lectura del `innerText`**. Estados sembrados en `cierre_dia` y base
**restaurada al terminar**: 6 `aprobado`, 0 abiertos, verificado con una lectura posterior.

- **Caso 6** (`solicitado` viejo + `vencido` nuevo) — Entregas / Por recoger / Recolección:
  «… Envía el que falta y espera a que la bodega apruebe el más antiguo, el del 21 de agosto. **Ve
  a «Cierre del día».**» · Cierre del día: el mismo sin puntero, y el botón «Solicitar aprobación
  del cierre vencido».
- **`V = N`** (dos `rechazado`) — los tres portales: «Tienes 2 cierres sin resolver y **ninguno se
  ha enviado** a aprobación. … **Envíalos a aprobación, empezando por el más antiguo**, el del 21
  de agosto. Ve a «Cierre del día».» · Cierre del día: el mismo sin puntero + «Solicitar aprobación
  del cierre rechazado».
- **Un solo cierre** (`vencido`, `N=1 V=1`) — **sin cambios**: «… **Ve a «Cierre del día» para
  enviarlo a aprobación.**» y, en Cierre del día, «Envíalo a aprobación con el botón de abajo.»
- **Acumular** (`N=2, V=0`) — **sin cambios** y **sin puntero** en ninguno de los cuatro.
- **Recolección bloqueada y sin lista**: «No tienes órdenes por recolectar en tienda ahora mismo.»
  y **0 disparadores de escaneo**. LIBRE: la frase completa vuelve y el disparador es 1.

## Gate de esta pasada — parcial y DECLARADO

⚠️ **NO se corrió `./init.sh`**: lo lanza el leader.

    pnpm run typecheck                                     -> sin una sola linea de salida
    pnpm run lint                                          -> 99 problems (0 errors, 99 warnings)  [las 99 son previas]
    vitest run tests/components tests/unit/notificaciones tests/unit/guards
                                                           -> Test Files 300 passed | Tests 4207 passed | 26 skipped
    pnpm run test:cambiados                                -> Test Files 404 passed | Tests 6049 passed | 26 skipped

**Veredicto:** las tres correcciones aprobadas, cerradas y vistas en pantalla en los cuatro
portales; siete mutaciones muertas; y un cuarto defecto de la misma familia —la rama mixta con el
más viejo re-solicitable— **encontrado, medido en el navegador y NO parcheado a ojo**. El humano
aprobó su texto y lo cierra la pasada siguiente.

---

# impl 271 — FRONTEND (la cuarta rama): cuando el cierre más viejo es SUYO

**Encargo:** implementar el texto que el humano aprobó para el defecto que la pasada anterior dejó
**declarado y sin parchear**, y cerrar esa deuda. Misma capa: el formateador puro y sus tests.

## El caso, y por qué es una rama y no un retoque

Rama mixta (`n >= 2 && v >= 1 && v < n`) **con el abierto más viejo re-solicitable**, o sea
`aResolverPrimero.resuelve === "mensajero"`. Se llega acumulando dos `solicitado` y **rechazando el
primero**: `CierresAdminService.rechazarCierre` recibe un `cierreId` cualquiera y no exige que sea
el más viejo. Ahí las dos mitades del texto anterior eran falsas a la vez: fechaba con el cierre del
propio mensajero y le mandaba a esperar por él.

**Texto aprobado, implementado tal cual:**

> Tienes 2 cierres sin resolver y 1 de ellos no se ha enviado a aprobación. Mientras tanto no puedes
> entregar, cobrar ni recibir trabajo nuevo. **Envía el que falta, el del 20 de agosto, y después
> espera a que la bodega apruebe el resto.**

Con sus tres variantes, todas afirmadas con literal a mano:

| Estado | Frase de salida |
|---|---|
| `V = 1`, jornada fiable | `Envía el que falta, el del 20 de agosto, y después espera a que la bodega apruebe el resto.` |
| `V > 1` (`N=3, V=2`) | `Envía los que faltan, empezando por el del 20 de agosto, y después espera a que la bodega apruebe el resto.` |
| sin jornada fiable (R60) | `Envía el que falta y después espera a que la bodega apruebe el resto.` — la aposición desaparece **entera, sin coma huérfana** |

El puntero de los tres portales con CTA se comporta igual que en el caso 6: `Ve a «Cierre del día».`
Y la **otra** rama mixta —el más viejo es de la bodega— **no se tocó**: la bifurcación es por
`aResolverPrimero.resuelve` y hay un caso que afirma su literal antiguo, byte a byte, para que
colapsar las dos ramas ponga rojo.

## De dónde sale la fecha, y por qué eso NO se puede afirmar por la salida

La fecha sale de **`aReenviarPrimero`** (el que él tiene que enviar), no de la cola. Pero en esta
rama **los dos campos son el MISMO cierre**, y no por casualidad: si el abierto más viejo es
re-solicitable, es también el re-solicitable más viejo —subconjunto, mismo orden— y
`OrdenRepository.findBloqueoDetalle` **reusa literalmente la fila** en vez de volver a la base
(`reenviable = masViejo`).

Consecuencia, dicha sin adornos: **leer uno u otro produce hoy exactamente el mismo texto**, así que
ninguna aserción de salida puede distinguirlos y la mutación «lee la cola» es, en la conducta, un
**mutante equivalente**. Fabricar un doble con dos cierres distintos para poder matarla sería un
test verde contra un estado que la base no produce, que aquí no vale nada.

Lo que sí se puede fijar es la FUENTE, y eso hace una **guardia de árbol** en
`bloqueo-textos.test.ts` (con su anti-vacuidad: el archivo se leyó de verdad y contiene la rama).
Importa porque la frase responde «qué envío yo», no «qué va primero en la cola»: si el repositorio
dejara de reusar la fila, o alguien copiara esta rama a otro sitio donde los dos campos difieren,
leer la cola volvería a fechar el cierre equivocado.

## Archivos modificados

| Archivo | Qué |
|---|---|
| `lib/constants/bloqueo-mensajero.ts` | rama **3-b** (más viejo suyo) con su texto y su plural; `aposicionDeJornada` se parte en `fechaDeJornada(cierre)` + la aposición de la cola, para que las dos fechas salgan de **una sola** función; la deuda declarada **se va** y en su sitio queda el porqué |
| `tests/fixtures/bloqueo-cierre.ts` | `+ bloqueoMixtoElMasViejoEsSuyo({ n, v, jornadaCR })` — los dos campos apuntan al MISMO objeto (es lo que hace el repositorio) y **exige `1 <= v < n`**: con `v === n` el fixture es otro |
| `tests/unit/notificaciones/bloqueo-textos.test.ts` | 3-quinquies (singular, sin jornada, plural), el portal con CTA, la contraprueba de la otra rama mixta y la **guardia de árbol** de la fuente de la fecha |
| `tests/components/{Reparto,Recoger,Recoleccion,CierreDia}Module.test.tsx` | el caso nuevo en los cuatro portales; en «Cierre del día», además, que el botón del rechazado está debajo |

## Las mutaciones — seis, de una en una, ninguna sobrevivió

Base 289/289 verde antes y después; sha256 del formateador idéntico al original.

| # | Mutación | Resultado |
|---|---|---|
| A | la rama nueva **desaparece** y el estado cae en el texto mixto viejo (**el defecto original**) | ROJO, **9 tests** (los 4 portales + los 4 del contrato + la guardia) |
| B | la fecha se lee de `aResolverPrimero` (la cola) en vez de `aReenviarPrimero` | ROJO, **1 test** — y **sólo** la guardia de árbol: por la salida es un mutante equivalente, ver arriba |
| C | la aposición se emite siempre, también sin jornada fiable (rompe **R60**) | ROJO, **1 test** |
| D | el plural de la rama nueva vuelve al singular fijo | ROJO, **1 test** |
| E | la espera vuelve a nombrar «el más antiguo» en vez de «el resto» | ROJO, **8 tests** |
| F | la rama nueva se traga **también** el caso 6 (condición siempre cierta) | ROJO, **12 tests** — incluidos los dos del caso 6 que vigilan la fecha de la bodega |

## Ver la app — el mismo estado que se midió, en los cuatro portales

Sembrado en `cierre_dia`: `rechazado` (jornada **20**, el más viejo) + `solicitado` (jornada 21).
Hash bcrypt comprobado antes; `seed-usuarios-qa.ts` **no** se corrió; dev a fichero; `innerText`.

- **Entregas / Por recoger / Recolección** (idéntico en los tres):
  «Tienes 2 cierres sin resolver y 1 de ellos no se ha enviado a aprobación. Mientras tanto no
  puedes entregar, cobrar ni recibir trabajo nuevo. **Envía el que falta, el del 20 de agosto, y
  después espera a que la bodega apruebe el resto.** Ve a «Cierre del día».»
- **Cierre del día**: el mismo sin puntero, con el botón «Solicitar aprobación del cierre
  rechazado» debajo — el mismo cierre que la frase nombra, que antes era la contradicción.
- **Contraprueba en el navegador**: resembrado el caso 6 (más viejo `solicitado`), los cuatro
  portales vuelven a decir «… y espera a que la bodega apruebe el más antiguo, el del 21 de
  agosto», sin un byte de diferencia.

Base restaurada y releída al terminar: **6 `aprobado`, 0 abiertos**.

## Lo que TODAVÍA no se ha visto en pantalla

Con esta pasada, de la tabla de verdad se han visto renderizados los casos **1** (sin aviso), **4**,
**5**, **6**, **6 con el más viejo suyo** y **7**. Queda **sin ver**:

1. **Casos 2 y 3** (`N=1, V=0`, un `solicitado` a secas). Es un estado **LIBRE**: lo que habría que
   comprobar es que **no** sale aviso. Se vio el vacío absoluto (`N=0`), no éste.
2. **Todas las variantes «sin jornada fiable» (R60).** En local un cierre sin gestiones siempre
   deriva jornada de `created_at − 1 día`, así que `jornadaCR = null` exige gestiones repartidas en
   dos días CR distintos: hay que sembrar órdenes y gestiones, no sólo cierres. Están cubiertas por
   test, no por pantalla.
3. **Los plurales** (`V ≥ 2` con `V < N`, es decir `N = 3`), en las dos ramas mixtas. Alcanzables,
   probados con literal a mano, **no vistos**.
4. Los **dos avisos a la bodega** (§10.2, 4 y 5) no son pantalla: son notificaciones.

## Gate de esta pasada — parcial y DECLARADO

⚠️ **NO se corrió `./init.sh`**: lo lanza el leader.

    pnpm run typecheck                                     -> sin una sola linea de salida
    pnpm run lint                                          -> 99 problems (0 errors, 99 warnings)  [las 99 son previas]
    vitest run tests/components tests/unit/notificaciones tests/unit/guards
                                                           -> Test Files 300 passed | Tests 4219 passed | 26 skipped
    pnpm run test:cambiados                                -> Test Files 404 passed | Tests 6061 passed | 26 skipped

**Veredicto:** la cuarta rama implementada con el texto aprobado, sus tres variantes y su plural;
seis mutaciones muertas —incluido el defecto original— y la única que la conducta no puede matar,
dicha como tal y fijada por guardia de árbol; vista en los cuatro portales con el estado real y con
contraprueba del caso 6; deuda cerrada.

---

# impl 271 — verificación en pantalla del estado NORMAL (`N=1, V=0`) y de los plurales

**Pasada de sólo MIRAR: no se cambió una línea de código.** Cierra el hueco que la pasada anterior
declaró: el estado en el que está cada mensajero cada tarde nunca se había visto renderizado, y «que
no salga un aviso» es una afirmación tan fuerte como que salga.

## `N = 1, V = 0` — un `solicitado` a secas: LIBRE, y se ve

Sembrado un único `solicitado` (nacido el 22 → jornada 21). Conteos leídos del DOM, no impresiones:

| Portal | avisos de bloqueo | controles |
| --- | --- | --- |
| Entregas (reparto) | **0** (3 alertas en la página, ninguna de bloqueo: las de la ruta) | «Gestionar la orden» ×9, **8 habilitados** |
| Por recoger | **0** | escáner «Recoger paquete» presente y **habilitado** |
| Recolección | **0** | disparador de escaneo **1, habilitado** |
| Cierre del día | **0** | «Solicitar cierre» presente |

Y el vacío de Recolección vuelve **entero**, que es lo que sólo se le quita al bloqueado:

> "No tienes órdenes por recolectar en tienda ahora mismo. Puedes escanear igual: si el maestro
> acaba de asignarte una, se confirmará aquí."

**Contraste directo con el bloqueado** (mismo mensajero, mismas órdenes, sólo cambia `cierre_dia`):
con bloqueo los 9 botones «Gestionar la orden» siguen en pantalla pero con **0 habilitados**, y el
escáner de Recolección y el de «Por recoger» bajan a **0**. La diferencia es del bloqueo y de nada
más.

### Dos apagados que NO son el bloqueo, comprobados uno a uno

1. **`Gestionar la orden QA-R-0015` sale deshabilitado también estando LIBRE** (8 de 9). Es la
   PRIMERA card, la que el panel de detalle abre por defecto: su botón llevaría al panel donde el
   mensajero ya está. Comportamiento previo y afirmado en `RepartoModule.test.tsx`.
2. **«Solicitar cierre» sale deshabilitado estando LIBRE**, y su `title` dice por qué:
   `Tenes ordenes sin gestionar; gestionalas antes de cerrar.` Es el gate de siempre
   (`CierreDiaService.MSG_PENDIENTES`, R10) con 9 órdenes por gestionar; no tiene nada que ver con
   la 271. Con bloqueo, además, aparece el CTA de reenvío y ése sí está habilitado.

## Los plurales (`N = 3, V = 2`), las dos ramas mixtas

Mismo `N` y `V` en las dos; lo único que cambia es **quién tiene el cierre más viejo**. Los dos
`innerText`, en los tres portales con CTA (en «Cierre del día», idénticos sin el puntero):

- **El más viejo es de la BODEGA** (`solicitado` jornada 19 + `rechazado` 21 + `vencido` 22):
  > "Tienes 3 cierres sin resolver y 2 de ellos no se han enviado a aprobación. Mientras tanto no
  > puedes entregar, cobrar ni recibir trabajo nuevo. **Envía los que faltan** y espera a que la
  > bodega apruebe el más antiguo, **el del 19 de agosto**. Ve a «Cierre del día»."
- **El más viejo es SUYO** (`rechazado` jornada 19 + `solicitado` 21 + `vencido` 22):
  > "Tienes 3 cierres sin resolver y 2 de ellos no se han enviado a aprobación. Mientras tanto no
  > puedes entregar, cobrar ni recibir trabajo nuevo. **Envía los que faltan, empezando por el del
  > 19 de agosto**, y después espera a que la bodega apruebe el resto. Ve a «Cierre del día»."

El plural concuerda en las dos, y la fecha nombra el cierre correcto en cada una: en la primera el
que espera a la bodega, en la segunda el que él tiene que enviar. En «Cierre del día», el botón de
la segunda dice **«Solicitar aprobación del cierre rechazado»** — el mismo cierre del 19 que la
frase nombra.

## Lo único que no cuadra, y NO se tocó

El `title` del botón apagado dice **`Tenes ordenes sin gestionar; gestionalas antes de cerrar.`**:
sin tildes en «Tenés», «órdenes» y «gestionálas». Es texto que lee el mensajero, vive en
`lib/services/CierreDiaService.ts:71` (`MSG_PENDIENTES`), es **previo a la 271** y no lo toca ninguna
de sus reglas. Queda **reportado y sin cambiar**: esta pasada era de mirar.

## Qué queda sin ver en pantalla (y por qué se da por bueno)

Sólo las variantes **sin jornada fiable (R60)** —que exigen sembrar gestiones repartidas en dos días
de Costa Rica, no sólo cierres— y los **dos avisos a la bodega**, que son notificaciones y no
pantalla. Los siete estados de la tabla de verdad, sus dos ramas mixtas y sus plurales **ya se han
visto renderizados**.

---

# impl 271 — BACKEND (pasada de la REVISIÓN): los avisos que nadie afirmaba, y las 58 casillas

**Encargo:** cerrar los tres bloqueantes que quedaban de `progress/review_271.md` —**B2**, **B3** y
**B1**— más la fila falsa de **R49**. (**B4** lo cerró el leader en `9f790b2b`.)
**Alcance: sólo `tests/`, `specs/` y `progress/`. Ni una línea de `lib/` ni de `app/` cambia** —
`git diff` sobre las dos está vacío, salvo por las mutaciones que se aplicaron y se revirtieron.

## B2 y B3 eran el MISMO defecto, y es el que ya mordió dos veces hoy

El aviso se construye, se prueba su texto, se cablea… **y nada comprueba que llegue a emitirse.**
El 22/08 el corte corría mudo en producción con 18.000 tests en verde; `b6dea0cf` arregló el
composition root del cron; y la capa de encima —**el productor**— seguía sin red:

- **`CorteDiarioService`**: el notificador es el **7.º** parámetro y los dos tests que lo
  instanciaban pasaban **seis**. Borrar entero el bloque `await this.notificarVencido({…})` **no
  ponía rojo nada**.
- **`CierreDiaService`**: idéntico. `notificarBloqueo` es el **7.º** y las **diez** suites que
  construyen ese service pasaban cinco o seis. Borrar
  `await this.avisarBloqueoPorAcumular(cierreId, actor.usuarioId);` **no ponía rojo nada**.
- **Nadie importaba `emitirCierreDiaVencido`**, así que **quién recibe** cada fila —«al mensajero
  dueño» (R38) y «a la bodega responsable» (R39), que es *literalmente* el requisito— no estaba
  afirmado en ninguna parte.

## Archivos creados

| Archivo | Qué afirma |
| --- | --- |
| `tests/unit/services/corte-diario-aviso-vencido.test.ts` | **El productor del corte** (B2): 3 cierres creados → 3 emisiones con el `toEqual` exhaustivo del contexto (cierre, zona, mensajero y jornada **de esa fila**); `crearCierre → null` → **0**; mixto (uno crea, otro no) → **una** y por el que creó; sin zona → nada; y R47 con el notificador **REAL** sobre un repositorio que revienta |
| `tests/unit/notificaciones/cierre-vencido-destinatarios.test.ts` | **El emisor** (B2): las **CUATRO** filas escritas a mano —mensajero dueño + maestro + admin + `adminSatelite` **de la zona destino**—; que la del mensajero es la única `usuario`, es `alert` y su entidad es el CIERRE; que sin zona quedan **tres** y no se inventa un satélite; la dedupe preguntada por `(evento, EL CIERRE, destinatario)`; y el camino real `notificarCierreDiaVencidoCon(repoDoble)` |
| `tests/unit/services/cierre-dia-aviso-bloqueo.test.ts` | **El productor del bloqueo** (B3): la solicitud que deja `N ≥ 2` emite **una vez**, con el cierre **recién creado** como entidad y la zona **destino**; el detalle se relee **DESPUÉS** de escribir (afirmado por `invocationCallOrder`); `N = 1` **no** emite; el gate ya bloqueado no crea **ni avisa**; y R47 |

## Archivos modificados

| Archivo | Qué |
| --- | --- |
| `specs/271-segundo-cierre-y-bloqueo/tasks.md` | **B1**: las 58 casillas marcadas con su desenlace REAL (**55 hechas · 3 NO hechas**) |
| `progress/impl_271.md` | el mapa `R → test` corregido (13 filas) y los huecos ya cerrados, anotados donde se declararon |
| `tests/unit/repositories/cierres-admin-repository.test.ts` | **sólo un comentario**: «no borres esto, es la única red de R49», con la medición |

## La prueba de que sirven: se borró la emisión y se puso ROJO

Cada mutación se aplicó **sola**, se corrió `vitest` de verdad sobre
`tests/unit/services` + `tests/unit/notificaciones` + `tests/unit/guards`, y se revirtió con
`git checkout --`. **Base sin mutar: `Test Files 273 passed · Tests 4617 passed`.**

```
[1] borrar `await this.notificarVencido({...})`   (CorteDiarioService.ts:225-230)
    -> Test Files  1 failed | 272 passed (273)
       Tests       3 failed | 4614 passed (4617)
    murieron: «TRES cierres creados -> TRES emisiones…»
              «con un mensajero que NO crea y otro que SI…»
              «con el notificador REAL sobre un repositorio que revienta…»
    revertida -> 273 passed / 4617 passed

[2] borrar `await this.avisarBloqueoPorAcumular(cierreId, actor.usuarioId);` (CierreDiaService.ts:618)
    -> Test Files  1 failed | 272 passed (273)
       Tests       3 failed | 4614 passed (4617)
    murieron: «emite UNA vez, con el cierre RECIEN CREADO como entidad y la zona DESTINO»
              «el detalle del aviso se relee DESPUES de escribir el cierre…»
              «un aviso que revienta NO invalida el cierre ya escrito, y queda registrado»
    revertida -> 273 passed / 4617 passed

[3] `ESTADOS_REABRIBLES = ["vencido"]`            (CierresAdminRepository.ts:80)
    -> Test Files  1 failed | Tests 3 failed | 47 passed (50)   [cierres-admin-repository.test.ts]
    murieron: «R16: count=1 -> updated; WHERE guarda estado='vencido' + alcance…»
              «R16/R21/R17: la válvula NO recalcula totales ni registra auditoría»
              «R28: destraba un `rechazado` de su alcance -> updated»
    revertida
```

**Los 4.614 que quedan verdes con [1] y con [2] son el hallazgo, no el ruido:** sin los archivos
nuevos, borrar la emisión de los dos avisos no rompía **nada** en las tres carpetas donde vive todo
lo que podría verlo.

## R49 — la fila del mapa era falsa; el requisito **sí** está cubierto, por otro test

La revisión (**M6**) decía que nadie vigila `ESTADOS_REABRIBLES`. **Medido: sí lo vigila**, pero no
los tests que el mapa citaba:

- Los `cierres-admin-*.test.ts` de **servicio** —los que el mapa nombraba— **doblan**
  `forzarSolicitudVencido` (`vi.fn(async () => "updated")`) y nunca llegan a la constante. La fila
  era falsa.
- Quien la vigila es **`tests/unit/repositories/cierres-admin-repository.test.ts`**, que construye
  el repositorio **REAL** sobre un Prisma doble y afirma `estado: { in: ["vencido","rechazado"] }`
  **escrito a mano** en tres casos. La mutación **[3]** lo demuestra: **3 tests rojos**.

**Decisión:** se corrige la fila del mapa —una fila falsa es peor que una vacía— en vez de escribir
un cuarto test que afirme lo mismo; y se deja **en el propio test** la nota de por qué no se puede
borrar (R48 sacó al `rechazado` de la cola, así que esa válvula es su única salida). `tasks.md`
marca **T7.2** como *cubierta por un test previo, medida hoy; el test nuevo con su nombre no se
escribió*.

## B1 — las 58 casillas, leídas de las tres bitácoras

**55 hechas · 3 NO hechas.** Cada tarea cuyo desenlace no es el literal de su «Hecho cuando» lleva
una línea **Desenlace** en `tasks.md`. Las que no se cerraron:

| Tarea | Desenlace | Dónde consta |
| --- | --- | --- |
| **T3.5** — medir el coste de la corrida | **NO medida.** Sin número de consultas ni de tiempo | `impl_271.md` §«Lo que NO se cubrió», punto 5 |
| **T8.3** — anotar los specs ajenos que citan la regla vieja | **NO hecha.** Los tres siguen sin nota de caducidad | **No constaba en ninguna bitácora**: medido hoy con `grep` |
| **T10.3** — los casos del corte, sembrados contra Postgres | **NO hecha.** No hay ni un test de `tests/integration/db/` que corra el corte; los tres casos viven en unitarios con doble de Prisma (T3.2, T3.3) o en un test previo a la ficha (T3.4) | **No constaba en ninguna bitácora**: medido hoy |

Y las tres que el encargo señalaba: **T11.5 SÍ se hizo** (dos pasadas, con lo no visto escrito),
**T6.7 quedó SUSTITUIDA** (las aserciones negativas de `bloqueo-textos.test.ts` en vez de la guardia
de árbol) y **T3.5 no se midió**. Ninguna se marcó por simetría: **T3.2** quedó como *hecha por otra
vía y menos de lo que pedía* (unitario con doble, sin sembrar ni mutar) y **T3.4** como *hecha a
medias*.

## Mapa `R<n> → test` — las 13 filas corregidas

`R10`, `R14`, `R36`, `R38`, `R39`, `R40`, `R41`, `R42`, `R44`, `R47`, `R49`, `R50` y `R51`. Las que
la revisión llamó **falsas** (R49, R50, R10) ahora dicen **qué afirma el test de verdad** y qué
**no**; las que se cerraron en pasadas posteriores (R14, R36, R42, R44) apuntan a su test; y R38-R41
y R47 apuntan a los archivos nuevos.

## Verificación ejecutada

```
pnpm run typecheck                         -> sin una sola línea de salida
pnpm run lint                              -> 99 problems (0 errors, 99 warnings)   [las 99 son previas]
pnpm exec vitest run tests/unit/services tests/unit/notificaciones tests/unit/guards tests/unit/repositories
                                           -> Test Files 383 passed | Tests 6254 passed
```

⚠️ **NO se corrió `./init.sh`**: lo lanza el leader (encargo explícito). El gate completo de la ficha
—`INIT_EXIT=0`, 1331 archivos / 18.009 tests— es de `5ed808e8` y **hay que repetirlo** sobre este
árbol: **T11.3** queda anotada con eso.

## T11.4 — el blob commiteado, verificado (no el árbol de trabajo)

Sobre `544be904`, que es el commit de esta pasada. El árbol de trabajo **no** distingue «lo
commiteé» de «alguien lo revirtió», y en este repo ya pasó que otra sesión reseteara una rama.

```
git show 544be904:specs/271-segundo-cierre-y-bloqueo/tasks.md            -> 564 líneas
git show 544be904:tests/unit/services/corte-diario-aviso-vencido.test.ts -> 241 líneas
git show 544be904:tests/unit/services/cierre-dia-aviso-bloqueo.test.ts   -> 238 líneas
git show 544be904:tests/unit/notificaciones/cierre-vencido-destinatarios.test.ts -> 190 líneas
git show 544be904:progress/impl_271.md                                   -> 1214 líneas
git show 544be904:tests/unit/repositories/cierres-admin-repository.test.ts -> 1464 líneas

casillas EN EL BLOB:            55 `[x]` · 3 `[ ]`
```

Y lo que de verdad importa después de tres mutaciones: **el código de producción quedó como
estaba**, comprobado leyendo el blob y no el disco.

```
git show 544be904:lib/services/CorteDiarioService.ts   | grep -c "await this.notificarVencido"        -> 1
git show 544be904:lib/services/CierreDiaService.ts     | grep -c "await this.avisarBloqueoPorAcumular" -> 1
git show 544be904:lib/repositories/CierresAdminRepository.ts:80
    const ESTADOS_REABRIBLES: CierreEstado[] = ["vencido", "rechazado"];
```

## Lo que esta pasada NO hizo, y por qué

1. **Las tres tareas abiertas** (T3.5, T8.3, T10.3) **no se cerraron**: el encargo era cerrar los
   bloqueantes de la revisión, y marcarlas habría sido el fallo mudo que la ficha entera vino a
   evitar. Quedan en `[ ]` con su medición.
2. **R10, R24 y R47 se dejaron como la revisión los dejó** («no verificable leyendo»), por encargo
   explícito. Sólo se corrigió lo que el mapa **afirmaba de más** sobre R10 y R47; no se escribió
   test nuevo para ninguno.
3. **M2, M3, M4, M5, M7 y M8** (menores de la revisión) **no se tocaron**: no eran el encargo. El
   más caro de los seis sigue siendo **M3** —nada impide que una superficie nueva re-derive la
   regla—, y ahora está dicho en la fila R10 del mapa en vez de vendido como cubierto.

---

# impl 271 — LAS TRES CASILLAS ABIERTAS (T3.5 · T8.3 · T10.3)

> Pasada del **2026-08-23**, sobre `feature/271-segundo-cierre-y-bloqueo` (HEAD `56f4e7ba`).
> Cierra las tres tareas que el marcado de `tasks.md` dejó a propósito en `[ ]`.
> **Ni una línea de `lib/` ni de `app/` tocada** — comprobado con `git status`.

## Archivos

| Archivo | Qué |
|---|---|
| `tests/integration/db/corte-diario-segundo-cierre-sql-real.test.ts` | **NUEVO.** T10.3: la corrida del corte, sembrada contra Postgres. 4 casos |
| `specs/246-asignacion-por-dia/requirements.md` | T8.3: nota de caducidad (+17 líneas, **0 borradas**) |
| `specs/262-corregir-dia-reparto/design.md` | T8.3: nota de caducidad (+10 líneas, **0 borradas**) |
| `specs/262-corregir-dia-reparto/tasks.md` | T8.3: nota de caducidad (+8 líneas, **0 borradas**) |
| `specs/271-segundo-cierre-y-bloqueo/tasks.md` | Las tres filas + el bloque de cierre del marcado. **58 `[x]` · 0 `[ ]`** |
| `progress/impl_271.md` | Esta sección |

---

## T10.3 — la corrida del corte, contra Postgres

### Por qué hacía falta, en una línea

El cambio central de la ficha es **una línea que se fue** —la exclusión `ESTADOS_CIERRE_ABIERTOS` de
`CorteDiarioRepository.findMensajerosConActividadSinCierre`— y **eso es un `WHERE`**. Lo único que
lo cubría era `corte-diario-repository.test.ts`, que afirma que `prisma.cierreDia.findMany` **no se
llama**: una afirmación sobre la FORMA de la consulta, no sobre las filas que Postgres devuelve. En
este repo está medido **cuatro veces** que una mutación de un `WHERE` sobrevive en verde con dobles.

### Cómo está construido

Repositorios **REALES** (`CorteDiarioRepository`, `CierreDiaRepository`, `OrdenRepository`,
`ZonaRepository`, `TarifaZonaMensajeroRepository`) sobre una transacción **siempre revertida**. El
notificador es un espía —nunca el real, que escribiría fuera de la transacción con su propio
cliente—. Dos decisiones que no son cosméticas:

1. **Los mensajeros los crea el test.** El corte lee **toda** la base, y la de desarrollo es
   compartida: con usuarios prestados, «recibió su segundo cierre» dejaría de ser consecuencia del
   corpus sembrado. Creados dentro de la transacción, su estado de partida es **cero** y está
   escrito.
2. **Cuarentena de lo previo**, dentro de la misma transacción y **antes** de sembrar: las gestiones
   sueltas que ya había pasan a un cierre de descarte y las órdenes previas en
   `en_reparto`/`ayuda_tienda` pierden su mensajero. Sin eso, `mensajerosEvaluados` mediría lo que
   otro dejó, y una corrida podría reventar dentro del `crearCierre` de un mensajero ajeno.

### Los cuatro casos

| Caso | Qué mide |
|---|---|
| **1 · R21/R23 — el caso `79cb2c0f`** | Mensajero con un `solicitado` de ayer (2 gestiones ya vinculadas a él) + 2 gestiones sueltas de hoy + 1 guía en `en_reparto`. El corte **SÍ** le crea el segundo cierre (`vencido`), le vincula **exactamente** las 2 sueltas, **no toca** ninguna de las de ayer, deja el `solicitado` en `solicitado`, barre la guía a `sin_gestionar` conservando el mensajero asignado y la registra en `cierre_sin_gestion` **del cierre nuevo** con su `estatus_origen_id` real. Y el aviso sale **una** vez, con `jornadaCR = 2026-08-21` (no el 22, que es cuando corre el cron) |
| **2 · R22/R17 — el ya bloqueado no acumula** | Mensajero con un `vencido`, sus gestiones ya vinculadas a él y su guía ya en `sin_gestionar`. Tras la corrida sigue con **exactamente un** `vencido`. Con un mensajero **TESTIGO** al lado que sí tiene una gestión suelta y sí recibe su cierre: sin él, «no se creó nada» también sería cierto si la corrida no hubiera hecho nada en absoluto |
| **3 · R23/R24 — el barrido y la idempotencia** | `en_reparto` **y** `ayuda_tienda` van a `sin_gestionar`, cada una registrada con **su** origen real; la orden **reservada para mañana** no se barre (246/R11); la gestión **ANULADA** no se vincula (67/R16); el otro mensajero recibe **su** cierre, distinto (R23). Y la **segunda corrida de la misma noche** —el reintento del cron, que es real— evalúa **0** mensajeros, crea **0** cierres, **no re-vincula** y **no re-registra** |
| **4 · ⚠️ R17 — el contraejemplo** | Ver el hallazgo, abajo |

### Las dos mutaciones, ejecutadas

**(a) — reponer la exclusión por cierre abierto** en `CorteDiarioRepository`
(`cierreDia.findMany` + `filter` por `["solicitado","vencido","rechazado"]`):

```
 × R21/R23 · el caso `79cb2c0f`: ... el corte SI le crea el segundo cierre
   -> AssertionError: expected [] to include '9a3f9cbf-b459-4f24-b7a0-928e2d2295ce'
 ✓ R22/R17 · el mensajero YA bloqueado ... NO recibe un segundo
 ✓ R23/R24 · el barrido a `sin_gestionar`, la vinculacion y la idempotencia de la 2.ª corrida
 × ⚠️ R17 · contraejemplo: la orden reservada (246) ... trae un SEGUNDO `vencido`
   -> AssertionError: expected [] to include 'd9b86b10-27fa-484b-81c4-31b77c1bf7d7'
 Test Files  1 failed (1)      Tests  2 failed | 2 passed (4)
```

**MURIERON: el caso 1 y el caso 4.** Y no sólo por la lectura directa de la lista: silenciada esa
aserción, el caso 1 **muere igual** una línea más abajo —

```
AssertionError: expected 0 to be greater than or equal to 1
  -> expect(medido.resultado.mensajerosEvaluados).toBeGreaterThanOrEqual(1)
```

— es decir, el desenlace de comportamiento también se pone rojo, no sólo el testigo del `WHERE`.
Mutación revertida; los 4 casos vuelven a verde.

**(b) — romper la guarda «algo pasó»** de `CierreDiaRepository.crearCierre`
(`if (false && vinculadas.count === 0 && sinGestionarTransicionadas === 0)`):

```
 ✓ R21/R23 · el caso `79cb2c0f` ...
 ✓ R22/R17 · el mensajero YA bloqueado ... NO recibe un segundo
 ✓ R23/R24 · el barrido ... y la idempotencia de la 2.ª corrida
 ✓ ⚠️ R17 · contraejemplo ...
 Test Files  1 passed (1)      Tests  4 passed (4)
```

**SOBREVIVE. Y eso NO es un hueco del test: es un hallazgo.**

> ⚠️ **EL MECANISMO QUE SOSTIENE R17 NO ES LA GUARDA QUE EL SPEC NOMBRA.**
> `tasks.md` (T3.3), `design.md` y el comentario de cabecera de `CorteDiarioRepository` sostienen
> R17 diciendo que el bloqueado **«entra en el bucle»** y que `crearCierre` lo descarta con su
> guarda «algo pasó». **Postgres dice que no llega a entrar en el bucle**: las dos ramas de la
> selección —gestiones con `cierre_id IS NULL` y órdenes en `en_reparto`/`ayuda_tienda`— ya vienen
> **vacías** para él, porque el corte que lo bloqueó barrió y vinculó todo en la misma transacción.
> El caso 2 lo afirma explícitamente (`expect(evaluados).not.toContain(bloqueado)`).
> La conclusión —ningún segundo `vencido` por esa vía— es la misma y es **más fuerte**; lo que no es
> cierto es la **razón escrita**, y esa razón es la que justificó quitar la exclusión «sin ninguna
> condición nueva» (S3).
>
> **La guarda sí tiene red, pero en otro sitio.** Con la mutación (b) puesta:
> `tests/unit/repositories/cierre-dia-repository.test.ts` → **4 tests rojos** (entre ellos
> «246/R11: la orden reservada para MAÑANA no se barre — y sin nada más que barrer, no hay cierre»).
> Y **`tests/integration/db` entero** —133 archivos / 1794 tests— **pasa en verde con ella puesta**:
> ningún test de integración cubría esa guarda, y sigue sin cubrirla, porque por el camino del corte
> el estado «seleccionado y sin nada que cerrar» **no es alcanzable con datos estáticos**.

### La anti-vacuidad, demostrada (no prometida)

Este repo ya tuvo un test de integración que reportaba `passed` **sin ejecutar una sola aserción**
por un `return` temprano. Las cuatro defensas de este archivo, y la prueba de cada una:

1. **`describe.skip` sin base.** Mismo patrón que `cierre-sin-gestion-sql-real.test.ts`: un `skip` se
   ve en la salida; un `passed` sin base, no.
2. **Cinco fallos RUIDOSOS en el `beforeAll`** (`throw new Error`), uno por cada cosa sin la que el
   corpus no se puede sembrar: FKs de `orden`, los tres estatus del catálogo, la zona central, el
   rol `mensajero` y el tipo de identificación.
3. **Cero `return` de salida temprana.** `grep "return"` sobre el archivo deja sólo el `return` del
   objeto medido y los de las fábricas de siembra; las tres apariciones restantes están en
   comentarios.
4. **`afirmarCorpusSembrado`**, que cuenta el corpus **EN LA BASE** antes de medir nada y revienta
   con el número que encontró.

Y las dos contrapruebas, ejecutadas:

```
DEMO 1 — se vacía el corpus del caso 1 (fuera las 2 gestiones sueltas):
  Error: el corpus NO quedo sembrado como dice el caso, asi que lo que se mida despues no vale.
         Esperado {"gestionesSueltas":2,...}; encontrado {"gestionesSueltas":0,...}
  Tests  1 failed | 3 skipped (4)

DEMO 2 — corpus vacío Y ADEMÁS con el propio `afirmarCorpusSembrado` desactivado:
  AssertionError: expected undefined to be 'f29f4ef3-7931-4f6a-9e83-c52574b8d372'
  Tests  1 failed | 3 skipped (4)
```

**Dos redes independientes**: sin datos el caso muere por el contador, y si alguien quitara el
contador moriría igual en la aserción de comportamiento. En ningún camino pasa en verde.

> Nota metodológica, porque vale para el próximo: el contador **ya mordió durante el desarrollo**,
> antes de ninguna contraprueba. La primera corrida del caso 2 murió con
> `Esperado {"cierresPrevios":3}; encontrado {"cierresPrevios":2}` — un error de cuenta mío, no del
> código. Un test que no puede pasar sin datos también protege del test mal escrito.

---

## 🔴 HALLAZGO — **R17 es falso: dos `vencido` a la vez SÍ es alcanzable**

**Medido, no razonado.** Caso 4 del archivo nuevo.

### El argumento de R17 y dónde se rompe

R17 dice, en tres pasos: (1) con un `vencido` el mensajero queda bloqueado y no genera actividad
nueva; (2) el corte que lo creó ya barrió sus órdenes **en la misma transacción**; (3) por tanto la
noche siguiente no le queda nada que cerrar.

**El paso (2) dejó de ser cierto el día que entró la feature 246.** Una orden **reservada para un
día posterior sobrevive al barrido** (246/R11) y **su protección caduca sola** (246/R13). Así que un
mensajero puede quedar bloqueado **con una guía todavía en la mano**. La noche siguiente esa reserva
vence, vuelve a entrar por la rama (b) de la selección, `crearCierre` la barre,
`sinGestionarTransicionadas` vale 1, la guarda «algo pasó» **pasa** — y nace el **segundo
`vencido`**.

### Es alcanzable en producción, no fabricado

Para que la guía esté en `en_reparto` **con** una fecha futura hace falta que alguien la ponga ahí, y
hay un camino que lo hace por diseño: **`CorreccionDiaRepartoService`, feature 262**. Su constante
`ESTADOS_CON_DIA_DE_REPARTO_VIVO = ["por_recoger", "en_reparto", "ayuda_tienda"]` y su propio
comentario lo dicen — *«`en_reparto`: la población que la 261 dejó ATRAPADA: el paquete ya está en
la mano del mensajero»*. Es decir: bodega pasa a mañana una guía que el mensajero ya lleva encima, y
esa guía atraviesa el corte que lo bloquea.

Secuencia completa, con las fichas que la habilitan:

1. Día D — el mensajero recoge una guía → `en_reparto`, `fecha_reparto = D`.
2. Día D — bodega la corrige a «mañana» (**262**) → `en_reparto`, `fecha_reparto = D+1`.
3. Corte de la noche D→D+1 (`diaCerrado = D`) — sus gestiones sueltas lo arrastran al bucle; la guía
   está **protegida** (**246/R11**) y no se barre → **`vencido` #1**. Bloqueado.
4. Día D+1 — bloqueado, no gestiona. La guía sigue donde estaba.
5. Corte de la noche D+1→D+2 (`diaCerrado = D+1`) — la reserva **caducó sola** (**246/R13**), entra
   por la rama (b), se barre → **`vencido` #2**.

**Antes de la 271 el paso 5 no ocurría**: la exclusión por cierre abierto lo sacaba de la corrida.
**Es decir: lo introduce esta ficha.**

### Qué se decidió — 2026-08-23, por el humano: **corregir la prosa, no el comportamiento**

**El comportamiento es correcto y no se toca.** La decisión llegó con dos datos que la medición no
tenía delante, y los dos refuerzan la conclusión:

- **El arreglo de M2 ya cubre el caso, y no por casualidad.** Cuando se mandó arreglar
  `transicionarRechazadoASolicitado` se pidió **explícitamente** arreglar también su gemelo
  `transicionarVencidoASolicitado` *«aunque dos `vencido` sea imposible»*. Ese cinturón —el `id` en
  el `WHERE`— resulta ser **la pieza que sujeta esto**: con dos `vencido`, re-solicitar mueve **uno**,
  el más viejo, y **no escribe-y-reporta-fallo**. Sin aquella petición, hoy habría aquí un fallo mudo
  real. Es el argumento más fuerte que hay en este repo a favor de arreglar el gemelo aunque su caso
  «no exista».
- **El aviso ya lo dice bien.** La rama `v === n` —«Envíalos a aprobación, empezando por el más
  antiguo…», aprobada por el humano— cubre dos `vencido` igual que dos `rechazado`.

**Ni una línea de `lib/` cambió de comportamiento.** Comprobado: el diff de `lib/` de esta corrección
es **sólo comentarios** (`git diff -U0 lib/` filtrado por líneas no-comentario: **vacío**). Tres
razones, por orden de peso:

1. **El desenlace medido es el razonable.** La orden necesitaba barrido y necesitaba un cierre al
   que ir; el `vencido` #2 no pierde dinero ni deja una guía huérfana. Lo contrario —volver a
   excluirlo— es exactamente el bug de producción que la ficha vino a arreglar.
2. **El estado resultante ya está cubierto por la regla general.** `N=2, V=2` es la **fila 7** de la
   tabla de verdad con dos `vencido` en vez de dos `rechazado`; la re-solicitud lo trata igual
   (**R18**: el más viejo primero, con el `id` en el `WHERE`), y `aReenviarPrimero` también.
3. **Lo que había que corregir era la prosa**, y así se hizo. **Diez sitios**, todos el
   2026-08-23:

| # | Sitio | Qué afirmaba | Qué dice ahora |
|---|---|---|---|
| 1 | `specs/271/requirements.md` → **R17** (el EARS) | «El sistema NO DEBE permitir dos `vencido` a la vez… sostenido como consecuencia de la regla» | Estado **raro pero alcanzable**, cubierto por la regla general y R18, sin guarda; y **prohíbe afirmar que sea imposible**. La versión original queda **citada**, con por qué se cayó |
| 2 | `specs/271/requirements.md` → el apartado del invariante | «DOS `vencido` A LA VEZ ES IMPOSIBLE» + los tres pasos | El razonamiento **se conserva entero** con el paso 2 marcado en rojo, la medida, la tabla de la secuencia de producción, las **cuatro** razones por las que sigue sin hacer falta código defensivo, y el mecanismo real del caso normal |
| 3 | `specs/271/requirements.md` → M2, el gemelo del `vencido` | «su caso de dos es inalcanzable por el invariante derivado» | La decisión fue **correcta por accidente**; la razón para no darle test propio ya no es «estado imposible», es «es el mismo `WHERE`, ya medido» |
| 4 | `specs/271/requirements.md` → **S2** y **S9** | S2 argumentaba desde la imposibilidad; S9 la citaba como **precedente** | Nota fechada: las dos **decisiones siguen en pie**, pero por sus propias razones. S9 deja de apoyarse en R17 |
| 5 | `specs/271/design.md` §5 | «no se escribe test: es inalcanzable» | Es alcanzable y **sí tiene test**; lo que no hace falta es un caso de re-solicitud aparte |
| 6 | `specs/271/design.md` §6 | «entra en el bucle… **esto es lo que hace que R17 se sostenga solo**» | **No entra en el bucle**; la guarda es la segunda red; y la frase sobre R17 **se retira** |
| 7 | `specs/271/tasks.md` → **T2.4**, **T2.5**, **T3.3** | Las tres justificaban desde la imposibilidad o desde la guarda | Las tres tareas **no cambian**; sus justificaciones sí, con la fecha y el test que lo midió |
| 8 | `lib/services/CorteDiarioService.ts` · `lib/repositories/CierreDiaRepository.ts` · `lib/repositories/CorteDiarioRepository.ts` (×3 bloques) | El invariante en mayúsculas y el mecanismo equivocado | Reescritos: qué se creyó, dónde se rompe, la vía de producción, por qué **sigue sin haber guarda** (ya está cubierto) y cuál es el mecanismo real. **Sólo comentarios** |
| 9 | `tests/fixtures/bloqueo-cierre.ts` · `tests/components/CierreDiaModule.test.tsx` · `tests/unit/notificaciones/bloqueo-textos.test.ts` | «dos `vencido` a la vez son IMPOSIBLES», usado para justificar cómo se compone un doble | Los dobles **no cambian** —siguen componiendo el caso frecuente—; cambia el motivo: se elige el representativo, no se esquiva un imposible |

El **caso 4 queda en el árbol** y su nombre lo dice ahora sin ambigüedad —«R17 · dos `vencido` a la
vez es **ALCANZABLE**…»—, no «contraejemplo»: documenta un estado que ocurre, no una hipótesis. Es el
único registro **ejecutable** del hallazgo, y si alguien cambia el comportamiento se pondrá rojo y
leerá por qué.

### Y la mutación (b) se queda escrita como lo que es

**No se maquilla.** La guarda «algo pasó» **no** es lo que sostiene el caso 2 en integración, y **no
se le fabrica un test que la mate en esa capa** sólo para dejar el marcador a cero: por el camino del
corte, «seleccionado y sin nada que cerrar» no es un estado alcanzable con datos estáticos, y un caso
que lo forzara estaría midiendo un montaje. Su red vive donde puede vivir —
`tests/unit/repositories/cierre-dia-repository.test.ts`, **4 casos** que la mutación mata— y eso está
dicho en la cabecera del archivo nuevo, en el caso 2 y en los tres comentarios de `lib/`.

---

## T8.3 — los tres specs ajenos

Nota de caducidad **fechada** en los tres, **sin reescribir una línea**: son la foto de su momento y
sus decisiones se tomaron a conciencia. `git diff --numstat specs/` → **35 adiciones, 0 borrados**.

| Spec | Qué decía | Qué dice la nota |
|---|---|---|
| `246-asignacion-por-dia/requirements.md` | «desde la ficha 241 … un `vencido` bloquea al mensajero para gestionar y cobrar» | **Se queda corto, no es falso.** Desde la 271 bloquea también para **recibir trabajo nuevo** (reparto central, satélite **y** recolección) y **acumular dos sin aprobar bloquea sin `vencido`**. Y en la otra dirección: lo que la 246 decidió pesa **más** hoy. La nota añade el cruce que esta medición encontró — esa misma reserva es lo que vuelve alcanzable el estado que la 271 declara imposible |
| `262-corregir-dia-reparto/design.md` §4.1 | «Es la regla 2 de la feature 241 … "recibir asignaciones no se bloquea nunca"» | **Cae la justificación, no la decisión.** R14 sigue en pie por su **otra** razón —corregir el día de una orden que el mensajero ya tiene en la mano no es darle trabajo nuevo—, que ya está escrita en el `Pick` de `CorreccionDiaRepartoService.ts` |
| `262-corregir-dia-reparto/tasks.md` B6 | Ídem, más el nombre viejo del método | Ídem, más el renombrado a `findMensajerosBloqueadosPorCierres` |

---

## T3.5 — **declarada SIN MEDIR, por decisión humana**

No hay número de consultas ni de tiempo, ni antes ni después, y **no se construye el banco de
medida**. La razón, escrita aquí y en `tasks.md` para que no se vuelva a abrir sola:

- El cambio **quita** una consulta por corrida (la que restaba a quien tenía cierre abierto).
- **Añade** una emisión por cierre creado.
- Lo único que crece es el **universo de mensajeros evaluados**, y ese universo sigue siendo **«los
  que tienen actividad»**, no todos. En producción son **dos o tres por noche**.

Un banco de ~50 mensajeros mediría un escenario que no existe. **Si algún día el corte evalúa
decenas por noche, la tarea se reabre; hoy no.**

---

## Mapa `R<n>` → test — lo que aporta esta pasada

Todo en `tests/integration/db/corte-diario-segundo-cierre-sql-real.test.ts`, **contra Postgres real
y con datos sembrados**.

| R | Test | Qué aporta sobre lo que ya había |
|---|---|---|
| **R21** | «R21/R23 · el caso `79cb2c0f`…» | Antes: unitario que afirma que `cierreDia.findMany` **no se llama**. Ahora: el mensajero con un `solicitado` **aparece en la lista que Postgres devuelve**, y **recibe** su segundo cierre. **Mata la mutación (a)** |
| **R22** | «R22/R17 · el mensajero YA bloqueado…» | Antes: unitario con doble (`crearCierre → null`). Ahora: sembrado, con testigo, y con el mecanismo real afirmado |
| **R23** | «R23/R24 · el barrido…» | Dos mensajeros, dos cierres distintos, un cierre por mensajero y corrida, **medido** |
| **R24** | «R23/R24 · el barrido…» | Antes: la mitad «no re-vincula» por el test de R14 y la mitad «no re-registra» apoyada en un test **previo** a la ficha. Ahora: **una segunda corrida real** que no re-vincula, no re-registra y no crea nada |
| **R17** | «R17 · dos `vencido` a la vez es ALCANZABLE…» | Antes: **sin test, a propósito**, por inalcanzable. Ahora: **medido alcanzable**, y el requisito reescrito. Ver el hallazgo |

---

## Verificación de esta pasada

```
pnpm run typecheck
  > tsc --noEmit
  (sin una sola linea de salida)

pnpm run lint
  ✖ 99 problems (0 errors, 99 warnings)      [las 99 son PREVIAS: mismo numero que
                                              las dos pasadas anteriores. El archivo
                                              nuevo no anade ninguna]

pnpm exec vitest run tests/integration/db/corte-diario-segundo-cierre-sql-real.test.ts
   Test Files  1 passed (1)
        Tests  4 passed (4)

pnpm exec vitest run tests/integration/db          [la carpeta entera: el archivo nuevo vive ahi]
   Test Files  130 passed (130)
        Tests  1670 passed (1670)                  [antes de esta pasada: 126 / 1657]

pnpm exec vitest run guard                          [138 guardias, por si alguna censa specs/]
   Test Files  138 passed (138)
        Tests  2054 passed (2054)

pnpm exec vitest run tests/unit/repositories/corte-diario-repository.test.ts
                     tests/unit/repositories/cierre-dia-repository.test.ts
                     tests/unit/services/corte-diario-{service,seleccion,aviso-vencido}.test.ts
   Test Files  5 passed (5)
        Tests  150 passed (150)                     [las dos mutaciones quedaron revertidas]
```

**`lib/` y `app/` intactos**, comprobado y no prometido — las dos mutaciones se aplicaron sobre
copias respaldadas y se revirtieron:

```
git status --short lib/ app/     ->  (sin salida)
```

⚠️ **NO se corrió `./init.sh`** — por encargo explícito: lo lanza el leader, y ya está dicho que hay
que repetirlo **entero** sobre este árbol.

## Veredicto

Las tres casillas cerradas: **T10.3** con la corrida del corte sembrada contra Postgres y sus dos
mutaciones ejecutadas, **T8.3** con nota de caducidad en los tres specs ajenos sin tocar una línea
original, y **T3.5** declarada sin medir con su razón escrita — y de propina, **R17 medido FALSO**,
con el camino de producción nombrado y sin haber tocado el código.
