# Feature 215 — Diseño técnico

Cómo se mueve el punto de conteo del reintento desde la transición hasta el cierre.
Todo anclaje de este documento se verificó abriendo el archivo en `C:/w213`
(rama `feature/215-reintento-en-cierre`, creada desde `origin/dev` ca73e771).

> **Segunda ronda de decisiones incorporada (2026-08-13):** el conteo se deriva de
> `gestion_orden` **sin migración** (D7), suma **al APROBAR** el cierre (D8),
> `sin_gestionar` **no** cuenta (D6), grano por **orden** (D9), **acumula** sobre
> todos los cierres aprobados (D10), cuenta el **resultado** y no el estado actual
> (D11), y el contador es **monótono creciente** (D12).
>
> **Tercera ronda (2026-08-13):** el escalado del cron **NO incrementa** el
> contador —la gestión sintética que crea no cuenta como intento— (**D13**, §3.4), y
> el riesgo de que un cierre nunca se apruebe **se ACEPTA sin mitigación** (**D14**,
> §7bis).
>
> **Cuarta ronda (2026-08-13):** la deriva de `primer_intento_ok` **se DECLARA con
> fecha de corte**, sin re-backfill y sin redefinir la métrica (**D15**, §8).
>
> **Q4 CERRADA el 2026-08-14: la medición se EJECUTÓ.** Se corrió contra la base
> **real de producción** y su resultado, su control y su límite están pegados en
> **§7.6**. Salió **0 en todas las direcciones**, y el cero **no significa que el
> cambio sea inocuo**: significa que hoy no hay ninguna orden en `devuelta`. Léase
> §7.6 antes de citarlo. **No queda ninguna pregunta abierta.**
>
> **Estado del código (corregido el 2026-08-14, auditado contra el árbol):** el
> commit **7d9471c3** implementó §2 y §3.1–§3.3, y el **Grupo 4** implementó después
> **§3.4 —el discriminador de las gestiones sintéticas—**, cerrando R18, R34 y el
> incumplimiento de R12 (`progress/impl_215.md §8`). Está **en `dev` y en
> `origin/prod`**. Este encabezado decía «§3.4 NO está implementado»: registro
> caducado.

---

## 1. Dónde vive el conteo HOY (una sola foto)

```
DevolucionSlaService:117 ─┐                    (dinero: escalado -> cobroRechazado)
OrdenHistorialService:59  ─┤
OrdenService:303,:355     ─┤
MisAsignacionesService:168─┤
RecepcionSatelite:136,209,281─┤
NovedadesService:66       ─┼─> OrdenHistorialService.contarIntentos{,EnLote}
RechazosSlaTienda:56      ─┤        (:64 / :77, resolverCriterio :95)
ManifiestoService:183     ─┤                 │
liberacion-reprogramada:93─┤                 ▼
AnaliticaRollupService:238 ─┤   OrdenHistorialRepository.contarIntentosVigentes{,EnLote}
AnaliticaOperativaService:462─┘        (:188 / :203)
                                             │
                                             ▼
                              whereIntentosVigentes  (:105)   ← EL PUNTO ÚNICO
                                             │
                                             ▼
                              orden_historial_estado + gestion_orden.anulada_at
```

Propiedades del diseño vigente que **hay que preservar** (son requisitos, no
gustos): un solo predicado para los 11 consumidores (R6), lote en una consulta
(R7), degradación segura sin catálogo (R9), y `0` explícito en vez de ausencia (R8).

---

## 2. Modelo de datos

### 2.1 Nada nuevo (propuesta base, `160/R7` intacto)

No se propone tabla, columna, enum, índice ni migración. Todo lo que el criterio
nuevo necesita ya está persistido:

| Dato | Dónde | Línea |
| --- | --- | --- |
| Resultado de la gestión | `gestion_orden.resultado` (enum `GestionResultado`: `entregada`, `reprogramada`, `devuelta`, `rechazada`, `incidente`) | `db/schema.prisma:727`, enum `:654-662` |
| Pertenencia a un cierre | `gestion_orden.cierre_id` (NULL = no cerrada) | `db/schema.prisma:752` |
| Vigencia | `gestion_orden.anulada_at` (NULL = vigente) | `db/schema.prisma:776` |
| Estado del cierre | `cierre_dia.estado` (`solicitado`/`aprobado`/`rechazado`/`vencido`) | `db/schema.prisma:928`, enum `:900-907` |
| Índices de la ruta caliente | `@@index([ordenId])`, `@@index([cierreId])` sobre `gestion_orden`; `@@index([estado])` sobre `cierre_dia` | `:791`, `:793`, `:956` |

RLS: `gestion_orden` y `cierre_dia` ya tienen RLS habilitada sin policies (solo
service role, `:720-722` y `:923-924`). **No hay tabla nueva ⇒ no hay RLS nueva
que declarar.**

### 2.2 Lo que el detalle del cierre NO sirve (medido; Q1 CERRADA por D7)

`cierre_detail` (`db/schema.prisma:1583-1636`) congela las entradas de la fórmula
del dinero y los descriptivos de la orden. **No tiene columna `resultado`**, y su
grano `(cierre_id, orden_id)` deduplica gestiones (`:1633`; dedupe explícito en
`CierreDiaRepository.ts:540-545`). Derivar el conteo de ahí es imposible sin
añadirle una columna, lo que exigiría migración **y** backfill de cierres pasados.
Por eso la fuente propuesta es `gestion_orden`, no `cierre_detail`.

### 2.3 Materializar el contador: PROHIBIDO en esta feature (D7)

Decisión del humano del 2026-08-13: **no se materializa**. `160/R7` se conserva y
`db/schema.prisma` no se toca. El coste que se evita, para que quede escrito por
qué no: migración `up`/`down` sobre `orden`, backfill de todas las órdenes vivas,
un incremento transaccional en un repositorio money-critical, idempotencia REAL a
mano (el enfoque derivado la tiene por construcción, §3.3) y un vector de drift
permanente en un número que dispara dinero. Efecto lateral útil: **el solape con
la migración sin mergear de la feature 208 desaparece** (§9).

---

## 3. El predicado nuevo: dónde vive y qué forma tiene

### 3.1 Se mantiene el punto único, cambia su fuente

El punto de extensión no se mueve de sitio: sigue siendo **una función pura de
`where`** consumida por los dos métodos de conteo, para que UI y dinero no puedan
divergir por copia-pega (`OrdenHistorialRepository.ts:82-104` explica por qué está
extraída). Lo que cambia es la tabla y las columnas que mira:

```
// hoy  (orden_historial_estado)
ordenId AND (destino=devuelta OR (destino=reprogramada AND origen IN {gestion}))
        AND (nunca-vino-de-gestion OR gestion.anulada_at IS NULL)

// DECIDIDO  (gestion_orden)          D7 (fuente) + D8 (ancla) + D9 (grano)
conteo(orden) = nº de cierre_id DISTINTOS entre las gestion_orden tales que
        orden_id  = <orden>
  AND   resultado IN {rechazada, devuelta, reprogramada}      (D2/D6)
  AND   anulada_at IS NULL                                   (R5)
  AND   cierre_id IS NOT NULL
  AND   cierre.estado = 'aprobado'                            (D8)
  AND   la gestion nace de una VISITA REAL, no es sintetica   (D13 — §3.4)
                                                             ^^^ PENDIENTE
```

> Las cinco primeras condiciones están implementadas (7d9471c3). **La sexta no**: es
> lo que D13 obliga a añadir y lo que R12 necesitaba desde el principio. Ver §3.4.

Cuatro propiedades de esa expresión, y las cuatro son requisitos:

- **`DISTINCT cierre_id` ES el grano por ORDEN** (D9/R29): dos gestiones vigentes
  de la misma orden en el mismo cierre colapsan a 1, sin `@@unique` que lo fuerce y
  sin dedupe en memoria. Es el mismo criterio que `cierre_detail` aplica por
  construcción (`@@unique([cierreId, ordenId])`).
- **La suma sobre cierres distintos ES la acumulación** (D10/R30): N cierres
  aprobados con resultado contable ⇒ N.
- **No se mira `orden.estatus_id` en ningún sitio** (D11/R31): el conteo es del
  hecho, no del estado.
- **`cierre.estado='aprobado'` + `anulada_at IS NULL` ⇒ monotonía** (D12/R32): un
  cierre aprobado no puede salir de `aprobado`
  (`ESTADOS_RESOLUBLES = ["solicitado"]`, `CierresAdminRepository.ts:39`;
  `ESTADOS_REABRIBLES = ["vencido","rechazado"]`, `:44`) y una gestión con
  `cierre_id` poblado no puede anularse (guarda `cierreId: null` en
  `CierreDiaRepository.ts:728`). Ninguna de las dos condiciones puede volverse
  falsa una vez verdadera.

Implementación de las dos lecturas, con R7 (una consulta por lote) intacto:

- **Individual:** `gestionOrden.findMany({ where, select: { cierreId: true },
  distinct: ["cierreId"] })` y `.length`, o `groupBy(["cierreId"])`. No sirve
  `count()` a secas: contaría gestiones, no cierres (violaría R29).
- **Lote:** `groupBy({ by: ["ordenId", "cierreId"], where })` → **UNA sola
  consulta** para N órdenes; el número de filas por orden es el número de cierres
  aprobados con resultado contable, y el `Map` se construye contando filas por
  `ordenId` en memoria. Sigue apoyado en `@@index([ordenId])`
  (`db/schema.prisma:791`). Lote vacío ⇒ 0 consultas (R7).
- El join a `cierre_dia` se expresa como filtro de relación
  (`cierre: { estado: "aprobado" }`), sobre PK; `@@index([estado])` (`:956`) cubre
  la otra dirección.
- **El repositorio del historial deja de ser el dueño del conteo.** Dos opciones de
  ubicación, ambas compatibles con R6:
  - **(a)** dejar los métodos en `OrdenHistorialService`/`IOrdenHistorialRepository`
    (11 call-sites intactos, cero churn) aunque el dato salga de `gestion_orden`;
  - **(b)** moverlos a un módulo propio (`IntentosEntregaService`) y reapuntar los
    11 call-sites.
  **Recomendación: (a) en el mismo PR, (b) como follow-up.** Mover 11 call-sites y
  cambiar la semántica del número en la misma tanda mezcla dos diffs y le quita al
  reviewer la posibilidad de ver el cambio de significado aislado. Se declara como
  deuda nombrada, no como olvido: el nombre del método pasa a mentir un poco
  («historial») y eso hay que arreglarlo, pero después.

### 3.2 El ancla: `estado = 'aprobado'` (D8) y lo que eso implica

Las tres candidatas se midieron; el humano eligió la tercera. Se deja la tabla
porque las dos descartadas reaparecen como posibles mitigaciones de ⛔ Q5 (§7bis).

| # | Ancla | Elegida | Consecuencia medida |
| --- | --- | --- | --- |
| **i** | `cierre_id IS NOT NULL` (corte automático **y** solicitud del mensajero, mismo código `CierreDiaRepository.ts:480`) | No | Contaría en el instante en que la gestión se vuelve inmutable. Cuenta sin que ningún admin valide. |
| **ii** | `cierre.estado = 'vencido'` (solo el corte) | No | Un `vencido` re-solicitado pasa a `solicitado` (`CierreDiaRepository.ts:380-386`) ⇒ el conteo **BAJARÍA**. Incompatible con R32 por sí sola. |
| **iii** | `cierre.estado = 'aprobado'` (`CierresAdminService.aprobarCierre:421` → `CierresAdminRepository.resolverCierre:616`, UPDATE en `:632-640`) | **SÍ (D8)** | El corte automático **deja de ser un instante que suma**: suma la aprobación posterior del cierre que creó. Y una orden cuyo cierre nunca se aprueba se queda en 0 ⇒ **⛔ Q5, agravada**. |

Detalle que multiplica el riesgo de Q5 y que hay que tener presente al implementar:
**solo `solicitado` es aprobable.** `ESTADOS_RESOLUBLES = ["solicitado"]`
(`CierresAdminRepository.ts:39`; la feature 111/R15 retiró `vencido` a propósito).
Un `vencido` o un `rechazado` necesitan **un paso humano previo** —el mensajero
re-solicita (`CierreDiaService.ts:401-407` / `:414-419`) o el admin usa la válvula
`forzarSolicitudVencido` (`CierresAdminRepository.ts:879`)— antes de poder
aprobarse. *(El JSDoc de `resolverCierre` en `:630-631` dice «`solicitado` o
`vencido`»: prosa desactualizada, la constante de `:39` es el criterio.)*

### 3.3 Idempotencia (R4) sin código de idempotencia

Con conteo derivado no existe «sumar dos veces»: el número es una función de las
filas. Reejecutar el cron, re-aprobar un cierre (`resolverCierre` es idempotente
por diseño, `CierresAdminRepository.ts:606-614`), forzar un `vencido` a
`solicitado` o aprobar dos veces el mismo cierre no puede duplicar nada. El único
vector que quedaba —dos gestiones vigentes de la misma orden en el mismo cierre—
lo cierra el `DISTINCT cierre_id` de §3.1 (D9/R29).

### 3.4 El discriminador de las gestiones SINTÉTICAS (D13 / R18 / R12 / R34)

**Desenlace: (a) el discriminador EXISTE.** Es estructural, no heurístico, y no
hace falta tocar el esquema. No está en `gestion_orden` sino en la fila de
`orden_historial_estado` que esa gestión produjo, y la relación para llegar a ella
ya está declarada en Prisma.

#### El problema, medido

El sistema crea **DOS** gestiones sintéticas que no son visitas de un mensajero, y
las dos entran hoy al conteo por la puerta de atrás:

| Gestión sintética | Dónde se crea | `resultado` | Cómo entra al conteo |
| --- | --- | --- | --- |
| **Escalado SLA** (Q3/D13) | `lib/repositories/DevolucionSlaRepository.ts:145-155` | `rechazada` | Nace con `cierre_id: null` y `mensajero_id` = el de la `devuelta` vigente (`:148`). `CierreDiaRepository.crearCierre` vincula por `{ mensajeroId, cierreId: null, anuladaAt: null }` (`:480-483`) ⇒ entra al siguiente cierre de ese mensajero y, al aprobarse, **cuenta +1** |
| **Reprogramación de la tienda** (R12) | `lib/repositories/GestionOrdenRepository.ts:525-535` | `reprogramada` | Idéntico: `cierre_id: null` (`:532`) y `mensajero_id` derivado de la última `devuelta` vigente (`:509-513`) ⇒ **cuenta +1**, y sumada a la `devuelta` de esa misma orden da el **doble conteo** que `160/R2` evitaba |

#### El discriminador que existe

Toda gestión —real o sintética— se crea en la MISMA transacción que su fila de
historial, y esa fila lleva `origen_tipo` **y** el enlace `gestion_orden_id`:

| Origen de la gestión | `origen_tipo` de su fila de historial | Ancla |
| --- | --- | --- |
| **Visita real del mensajero** | `gestion` (y `incidente` si el resultado es `incidente`, que no cuenta) | `GestionOrdenRepository.ts:450` |
| Escalado SLA | `escalado_devuelta_sla` | `DevolucionSlaRepository.ts:157-166` (con `gestionOrdenId: gestionSintetica.id`, `:164`) |
| Reprogramación de la tienda | `reprogramacion_tienda` | `GestionOrdenRepository.ts:539-549` (con `gestionOrdenId: gestion.id`, `:547`) |

Y la relación inversa está declarada: `GestionOrden.historialEstados`
(`db/schema.prisma:786`) ↔ `OrdenHistorialEstado.gestion` (`:1544`, con
`onDelete: Restrict` explícito, puesto justo porque «este enlace sostiene el
derivador de intentos … un SET NULL silencioso lo corrompería sin error»,
`:1539-1543`). **El enlace que necesitamos es el mismo que la 67 ya blindó.**

#### La forma de la consulta (dos variantes, con su coste)

```
// Variante 1 — INCLUSIÓN por familia (RECOMENDADA, cumple R34-c)
historialEstados: { some: { ordenId: <el mismo filtro>, origenTipo: { in: ORIGEN_TIPOS_VISITA_REAL } } }
//   ORIGEN_TIPOS_VISITA_REAL = ["gestion"]  ← lista blanca, `satisfies`

// Variante 2 — EXCLUSIÓN de las sintéticas conocidas (NO recomendada)
historialEstados: { none: { origenTipo: { in: ["escalado_devuelta_sla", "reprogramacion_tienda"] } } }
```

- **Por qué la 1 y no la 2:** R34-c. Con lista negra, una familia sintética FUTURA
  empezaría a contar sola, adelantaría el escalado y cobraría un `cobroRechazado`
  antes de tiempo, en silencio — el mismo razonamiento con el que la 160 eligió
  `ORIGEN_TIPOS_REPROGRAMADA_INTENTO` como lista de inclusión y con el que la 67
  resolvió las filas huérfanas.
- **Por qué el `ordenId` redundante dentro del `some`:** rendimiento.
  `orden_historial_estado` **no tiene índice por `gestion_orden_id`** (los tres que
  hay son `[ordenId, createdAt]`, `[ordenId, estatusDestinoId]` y
  `[actorUsuarioId, origenTipo, createdAt]`, `db/schema.prisma:1546-1557`; la FK de
  `20260713120000_orden_historial_estado/migration.sql:62-63` **no** crea índice en
  Postgres). Repitiendo el filtro por `orden_id` dentro del `EXISTS`, el planner
  entra por `@@index([ordenId, createdAt])` y `gestion_orden_id` queda como filtro
  residual sobre un puñado de filas. **Sin ese truco es un seq scan sobre una tabla
  append-only que crece con cada transición del sistema.**
- **Coste declarado:** el conteo pasa de tocar 1 tabla + PK a 2 tablas. Hay que
  **medirlo con `EXPLAIN (ANALYZE, BUFFERS)`** en las dos rutas (individual y lote
  de 100) antes de darlo por bueno. **Si la medición dijera que hace falta un índice
  nuevo sobre `gestion_orden_id`, eso es una MIGRACIÓN y D7/R27 la prohíben: se para
  y se lleva al humano.** No se añade un índice «de paso».
- **Filas legadas (R34-d):** una gestión anterior al historial (feature 49) no tiene
  fila que la respalde y con la variante 1 **dejaría de contar**. Es la dirección
  segura del error (contar de menos retrasa el escalado; contar de más cobra antes
  de tiempo, `OrdenHistorialRepository.ts:182-186`), pero **hay que medir cuántas
  son** antes de activar:

```sql
-- SOLO LECTURA: gestiones contables SIN fila de historial que las respalde.
SELECT count(*) AS gestiones_sin_historial,
       min(g."created_at") AS mas_antigua,
       max(g."created_at") AS mas_reciente
FROM "gestion_orden" g
WHERE g."resultado"::text IN ('rechazada','devuelta','reprogramada')
  AND g."anulada_at" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "orden_historial_estado" h
                   WHERE h."gestion_orden_id" = g."id");
```

#### Medición de T22 — 2026-08-13, base LOCAL de desarrollo (NO producción)

**Advertencia de validez, primero:** la única base alcanzable desde el worktree es la
local (`localhost:5432/ordenex`) y es **minúscula**: 78 órdenes, 44 `gestion_orden`,
278 `orden_historial_estado`, 7 `cierre_dia`. A ese tamaño el planner elige *seq
scan* por coste, no por falta de índice, así que **estos planes NO son
extrapolables a producción**. Se pegan por lo que sí demuestran, que es una cosa
concreta y no trivial.

**(1) El `orden_id` redundante dentro del `some` HACE lo que §3.4 dice.** Es lo
único que la medición prueba de forma limpia, y lo prueba incluso a esta escala:

| Consulta individual | Plan del `EXISTS` | Exec |
| --- | --- | --- |
| ANTES (5 condiciones) | — | 0.195 ms, 6 buffers |
| DESPUÉS **con** `h.orden_id` repetido | `Index Scan using orden_historial_estado_orden_id_estatus_destino_id_idx` · `Index Cond: (orden_id = …)` · `origen_tipo` como filtro residual | 0.150 ms, 3 buffers |
| DESPUÉS **sin** `h.orden_id` (solo `gestion_orden_id`) | **`Seq Scan on orden_historial_estado`** | 0.090 ms, 3 buffers *(tabla de 278 filas)* |

Es decir: con el filtro repetido el planner entra por un índice prefijado por
`orden_id`; sin él, recorre la tabla entera. Con 278 filas eso es gratis; sobre una
tabla append-only que crece con cada transición del sistema, no. **El truco no es
decorativo y hay que conservarlo.**

**(2) La ruta de LOTE (100 ids) NO queda medida.** ANTES 0.486 ms / 24 buffers;
DESPUÉS 2.800 ms / 164 buffers, pero el plan de DESPUÉS es un `Nested Loop Semi
Join` con `Seq Scan` sobre `orden_historial_estado` repetido 23 veces — con 278
filas el planner ni se plantea el índice. **No se puede concluir nada del coste real
del lote a partir de este número, ni a favor ni en contra.** Queda pendiente de una
medición contra datos de volumen (misma pregunta abierta que ⛔ Q4, §7.6).

**(3) Filas legadas (R34-d): `0` en esta base.** `gestiones_sin_historial = 0`
(`mas_antigua`/`mas_reciente` NULL) con la consulta de arriba. Es un dato de la base
local, **no una medición de producción**: no autoriza a dar R34-d por inocuo en
real. El predicado ya opta por la dirección segura si aparecieran.

**(4) NO se pide índice nuevo.** Nada en lo medido obliga a un índice sobre
`gestion_orden_id`: en la ruta individual el planner ya entra por un índice
existente gracias al `orden_id` repetido. D7/R27 siguen intactos y `db/` no se toca.
Si la medición de volumen del punto (2) dijera otra cosa, **eso es una migración y
es decisión del humano**.

#### Lo que este discriminador NO cambia (R17/R18-d)

La gestión sintética del escalado **sigue cobrando** su `cobroRechazado`: el
ingreso de bodega se deriva de `resultado` en `derivarIngresoBodega` /
`ingresoBodegaPorResultado` (`lib/utils/cierre-totales.ts:44`,
`lib/utils/ingreso-bodega.ts:18`), que **no** consultan el conteo de intentos.
Deja de contar como **INTENTO**; sigue cobrando como **RECHAZO**. Son dos caminos
independientes y esta feature solo toca el primero. `devolucion-sla-dinero.test.ts`
sigue verde sin tocarse, y es la prueba.

#### Por qué NO se usan los otros candidatos

`motivo LIKE 'escalado SLA%'` (texto libre, `DevolucionSlaRepository.ts:184`),
«sin evidencia», «sin `causa_devolucion`» o «`fecha_reprogramacion` no nula` son
**heurísticas sobre datos que un flujo legítimo puede reproducir**. Un criterio que
mueve dinero no se apoya en una cadena de texto.

---

## 4. Rutas, endpoints y contratos I/O

**Sin rutas nuevas, sin endpoints nuevos, sin acciones nuevas, sin cambio de UI.**
Los 11 consumidores siguen llamando a los mismos dos métodos y recibiendo los
mismos tipos (`number` / `Map<string, number>`).

Contratos que SÍ cambian (internos, no expuestos):

| Contrato | Hoy | Después |
| --- | --- | --- |
| `CriterioIntento` (`lib/interfaces/repositories/IOrdenHistorialRepository.ts:65`) | `{ devueltaId, reprogramadaId }` (ids de `order_status`) | El criterio deja de necesitar ids de catálogo: los resultados son valores del enum `GestionResultado` y el estado del cierre, del enum `CierreEstado`. El tipo se **retira o se sustituye** por la lista de resultados que cuentan. Con ello desaparece la degradación por catálogo incompleto y **R9 pasa a sostenerse sobre enums de Postgres, que no pueden faltar** — es más fuerte que antes, no más débil. |
| `resolverCriterio` (`OrdenHistorialService.ts:95`) | 2 lecturas de `order_status` por llamada | Ya no hace falta: menos I/O por lectura. Su desaparición hay que reflejarla en los tests que la afirman (§6). |
| `ORIGEN_TIPOS_REPROGRAMADA_INTENTO` (`lib/types/orden-historial.ts:147`) | Lista blanca de familias que cuentan con destino `reprogramada` | **Se queda SIN DUEÑO.** Su única función era el criterio. R28 exige retirarla, no dejarla huérfana. `ORIGEN_TIPOS_CON_GESTION` (`:117`) **se queda**: la usa la desambiguación de huérfanas y el resto del historial. |
| Prosa `lib/types/orden-historial.ts:56-116` | 60 líneas que justifican familia por familia por qué no cuenta | Deja de ser cierta en bloque. Se reescribe apuntando al criterio nuevo (R28). |
| Nueva lista | — | Constante de resultados que cuentan (`{rechazada, devuelta, reprogramada}`) declarada con `satisfies readonly GestionResultado[]`, **lista de INCLUSIÓN** por el mismo motivo que la de la 160: con lista negra, un `resultado` futuro empezaría a contar solo, adelantaría el escalado y cobraría un `cobroRechazado` antes de tiempo, en silencio. **`sin_gestionar` NO entra** (D6): no es un `resultado` y no existe fila de `gestion_orden` para una orden cortada. |

---

## 5. Alternativas descartadas (obligatorio)

**A. Añadir `sin_gestionar` a la lista blanca del predicado viejo.** Era la
solución mínima al agujero que abrió la pregunta original (una orden sale, se
corta, vuelve a bodega y sale otra vez con el mismo contador): bastaba con que #16
`en_reparto → sin_gestionar` contara. **Descartada DOS VECES por el humano:** al
dar de alta la ficha el 2026-08-13 y otra vez al cerrar Q6/Q9 el mismo día.
**Coste asumido y declarado: el agujero original NO se cierra con esta feature**
(`requirements.md` §Limitación declarada, R33), y a cambio se cambia el
significado del número para los 11 consumidores en vez de para uno. Cerrarlo es
candidato a ficha aparte.

**B. Mantener el criterio por transición y añadir el destino `rechazada`.** Habría
hecho contar `rechazada` (D5-a) sin tocar la arquitectura del conteo: una tercera
rama en `whereIntentosVigentes`. **Descartada porque no cumple la decisión:** el
humano no pidió «que `rechazada` también cuente», pidió que el aumento se delegue
al cierre, y explícitamente que las dos aristas que hoy suman dejen de sumar. Con
B el contador seguiría subiendo en el instante de la gestión.

**C. Contar desde `cierre_detail` añadiéndole una columna `resultado`.**
**Descartada por medición:** su grano deduplica por orden (`db/schema.prisma:1633`,
`CierreDiaRepository.ts:540-545`), es una fila declarada INMUTABLE y money-critical
(`:1564-1565`), y exigiría migración + backfill de todos los cierres pasados para
que el conteo histórico existiera. `gestion_orden` ya tiene el dato exacto, con
vigencia y con índices.

**D. Materializar el contador en `orden.intentos_entrega`.** Es la alternativa que
un lector propondrá por rendimiento. **DESCARTADA por decisión del humano (D7,
2026-08-13): queda prohibida en esta feature.** Los cuatro costes que la
descartan: (1) deroga `160/R7`; (2) exige
migración up/down + backfill; (3) obliga a implementar idempotencia REAL en dos
repositorios distintos, cuando el enfoque derivado la tiene por construcción
(§3.3); (4) introduce un vector de drift permanente en un número que dispara
dinero: una columna que se desincroniza de los hechos cobra mal y nadie se entera
hasta la factura. Beneficio real que se pierde: una consulta menos por listado —y
el listado ya paga hoy una consulta por lote (`160/R12`), no por fila. Efecto
lateral de descartarla: **cero solape con la migración sin mergear de la 208**.

**E. Mover los 11 call-sites a un servicio nuevo en el mismo PR.** Descartada como
alcance de esta feature (§3.1): mezcla el cambio de significado con un refactor de
superficie y deja al reviewer sin diff legible. Se declara como deuda nombrada.

---

## 6. Guardias y tests que se pondrán ROJOS **POR DISEÑO**

El reviewer rechaza si al implementar aparece un rojo que no esté en esta tabla, y
también si alguno de estos se «arregla» conservando la afirmación vieja. La
columna «Qué hacer» distingue **REESCRIBIR** (la afirmación cambia de significado)
de **RETIRAR** (la afirmación deja de tener objeto) de **ADAPTAR** (solo cambia el
andamiaje, no lo que mide).

| # | Test / guardia | Qué afirma hoy | Por qué se pone rojo | Qué hacer |
| --- | --- | --- | --- | --- |
| 1 | `tests/unit/types/criterio-intento-entrega.test.ts` (7 casos) | `ORIGEN_TIPOS_REPROGRAMADA_INTENTO === ["gestion"]`, que es lista de inclusión, que hay exactamente 2 aristas a `reprogramada`, y que la pareja (`reprogramada`,`gestion`) identifica la #13 | El criterio deja de depender de familias de origen y la lista se retira (R28) | **REESCRIBIR** sobre la lista de `GestionResultado` que cuenta; conservar el caso «es lista de INCLUSIÓN», que es el que protege el dinero |
| 2 | `tests/unit/repositories/orden-historial-repository.test.ts` bloques `contarIntentosVigentes` (`:191-268`), `…EnLote` (`:270-323`) y `whereIntentosVigentes` (`:325-571`) — 18 casos | La forma exacta del `where` (dos ramas de destino, OR de vigencia) y su semántica fila a fila | El predicado cambia de tabla y de columnas | **REESCRIBIR** caso por caso, manteniendo la cobertura de vigencia (R5) y la de lote/lote-vacío (R7) |
| 3 | `tests/fixtures/intentos-entrega.ts:59-108` (`filaCasaIntento`, `prismaHistorialSobreFilas`) | Es un **intérprete a mano de la forma del `where`**: desestructura `where.AND` como `[{OR: destinos}, {OR: vigencia}]` | Cambio ESTRUCTURAL del predicado ⇒ rompe por desestructuración, no por semántica. Arrastra a los tests #2 y #4 | **REESCRIBIR** el evaluador sobre filas de `gestion_orden`. Sigue siendo UNO solo (`160/R4`): dos evaluadores desincronizados hacen justo el daño que se quiere evitar |
| 4 | `tests/unit/services/intentos-entrega-criterio-unico.test.ts` (suite entera) | Que cron SLA, drawer y lote producen el MISMO número montando el repo REAL sobre el doble de Prisma | Usa el evaluador de #3 y los ids de catálogo | **ADAPTAR** el andamiaje; **el propósito no cambia y es el test más importante de la feature** (R6) |
| 5 | `tests/unit/services/orden-historial-service.test.ts` bloques `:303-357` y `:359-407` (incl. «resuelve el catálogo UNA vez», «criterio con `reprogramadaId: null`», «individual y lote reciben el MISMO criterio») | Que `resolverCriterio` traduce `value → id` y qué criterio viaja al repo | `resolverCriterio` desaparece (§4) | **REESCRIBIR**; conservar los casos de lote vacío (R7) y `0` (R8) |
| 6 | `tests/unit/services/devolucion-sla-service.test.ts` bloque `:170-233` («el criterio ampliado de intentos y el escalado», casos `160/R8`, `160/R5/R8`, `160/R2/R8`) | Que 2 reprogramaciones del mensajero + 1 devuelta ⇒ escala; que la reprogramación de tienda no cuenta | Esos escenarios se construyen con filas de historial y ahora dependen del cierre | **REESCRIBIR** con escenarios de cierre. **DINERO**: cada caso reescrito es un caso de «cuándo se cobra el rechazo» |
| 7 | `tests/unit/services/orden-historial-service.test.ts:169` (`160/R10`) | Que el drawer refleja el criterio ampliado | Mismo motivo | **REESCRIBIR** |
| 8 | `tests/unit/analytics/metrics.test.ts:198-224` (`R11 · los intentos no se redefinen`) | Que `primer_intento_ok.definicion.criterio === "intentos_vigentes_historial"` y que ninguna métrica inventa otro | El id de criterio sigue siendo un string estable ⇒ **verde por accidente**, pero **la `descripcion` de la métrica (`lib/analytics/metrics.ts:335`) afirma textualmente el criterio viejo** («destino devuelta, o destino reprogramada de familia gestion») | **ACTUALIZAR la prosa** (R28) y considerar renombrar el id de criterio; si se renombra, este test es **REESCRIBIR** |
| 9 | `tests/unit/analytics/rollup-service.test.ts`, `tests/unit/analytics/agregado-*.test.ts`, `tests/unit/analytics/_fake-operativa.ts` | `primer_intento_ok` con el doble de `contarIntentosEnLote` | Solo mockean el conteo ⇒ **probablemente verdes**. Lo que cambia es el SIGNIFICADO del KPI | **REVISAR sin tocar**; el problema real es ⛔ Q10, no el test |
| 10 | `tests/integration/db/analytics-daily-job.test.ts` · «primer intento vs entrega tras una devolucion previa (R17)» (`:602-663`) — **el único rojo declarado que queda** | «Una entrega tras una devolución previa NO es primer intento»: `primerIntentoOk` = 0 para la reintentada y 1 para la limpia (`:660-661`) | Su semilla crea la gestión `devuelta` **sin `cierre_id`** (`crearGestion` en `_semilla-rollup.ts:235-248` ni siquiera acepta uno, y ahí no se crea ningún `cierre_dia`), así que con el criterio nuevo esa devolución no cuenta y la entrega parece primer intento | **REESCRIBIR LA SEMILLA, NO LA ASERCIÓN** (T13). Lo que el test mide se CONSERVA intacto: hay que darle a esa `devuelta` un `cierre_dia` **APROBADO**. Cambiar el `0` esperado sería borrar la única prueba de que el KPI distingue un reintento de un primer intento |
| 11 | `tests/unit/services/manifiesto-service.test.ts`, `mis-asignaciones-service.test.ts`, `NovedadesService.test.ts`, `orden-service.test.ts`, `recepcion-satelite-{service,paginado,completo,vigencia}.test.ts`, `rechazos-sla-tienda-service.test.ts`, `tests/unit/actions/liberacion-reprogramada-action.test.ts`, `orden-historial-action.test.ts` | R11/R12/R13/R14 de la 160: 1 llamada por listado, `0` explícito, sin consulta con lote vacío | Usan `fakeIntentosEnLote` (`tests/fixtures/intentos-entrega.ts:20`), que **no cambia** | **VERDES, y tienen que seguirlo** (R20). Si alguno se pone rojo, es una regresión real |
| 12 | Suites de UI: `tests/unit/components/intentos-entrega.test.tsx`, `ordenes-columns.test.tsx`, `RecepcionSateliteModule.test.tsx`, `NovedadesModule.test.tsx`, `RechazosSlaModule.test.tsx`, `MisAsignacionesModule.test.tsx`, `BodegaLiberadasHoy.test.tsx`, los 5 modales, descargas | Pintado del dato (`IntentosDato`, columna «Intentos», `0` explícito, umbral no viaja) | Reciben el número por props | **VERDES sin tocar** (R20). Cero archivos de `components/` o `app/` en el diff de esta feature |
| 13 | `tests/unit/types/intentos-no-alcance.test.ts` | R29/R30/R31 de la 160: no ordenable, no filtrable, fuera del OpenAPI y de los DTO excluidos | No depende del criterio | **VERDE sin tocar** (R22) |
| 14 | `tests/unit/services/devolucion-sla-dinero.test.ts` (4 casos, marcados `[💰]`) | Que la gestión sintética del escalado cobra `cobroRechazado` igual que un rechazo directo, y que dos sintéticas cobrarían dos veces | No depende del criterio de intentos | **VERDE sin tocar**, y es la evidencia de R17 |
| 15 | Guardia de migraciones: `git diff --name-only -- db/` vacío | `160/R7` | **NO se pone rojo: D7 prohíbe migración.** Si aparece un cambio en `db/`, es un incumplimiento de R27 | **VERDE, y es una guardia de la feature** |
| 16 | Casos de ANULACIÓN que hoy hacen BAJAR el conteo: `orden-historial-repository.test.ts:475` («R24: NO cuenta la de una gestión ANULADA») y `:489`; `orden-historial-service.test.ts:154` («67/R28: 2 devueltas, 1 anulada → 1»); `devolucion-sla-service.test.ts:184` («las MISMAS reprogramaciones ANULADAS → el conteo baja a 1 y la orden se LIBERA») | Que anular una gestión BAJA el número | **Cambio de comportamiento por D12/R32**: una gestión ya contada no puede anularse (la ventana muere antes de que el cierre se apruebe), así que el escenario deja de ser alcanzable tal cual | **REESCRIBIR como caso de MONOTONÍA**: la anulación antes del cierre impide que llegue a contar (el número no sube); nunca «baja». R5 sobrevive como «una gestión anulada no cuenta», no como «descuenta» |
| 17 | *(nuevo)* Casos de D9/D10/D11 | — | Dos gestiones vigentes en el mismo cierre → 1 (R29); N cierres aprobados → N (R30); resultado contado aunque la orden ya cambió de estado (R31); `solicitado`/`vencido`/`rechazado` no cuentan (R3) | **HECHO en 7d9471c3** (`progress/impl_215.md §2`) |
| 18 | *(nuevo, TERCERA RONDA)* Casos del discriminador §3.4 | — | Hay que CREARLOS: la gestión sintética del escalado SLA no cuenta aunque su cierre se apruebe (R18-b); la reprogramación de la tienda no cuenta aunque su cierre se apruebe (**R12, hoy INCUMPLIDO**); la lista de familias es de INCLUSIÓN (R34-c); una gestión sin fila de historial no cuenta (R34-d) | **AÑADIR** en `orden-historial-repository.test.ts` y `criterio-intento-entrega.test.ts`; **el fixture `tests/fixtures/intentos-entrega.ts` necesita filas de historial además de gestiones** |
| 19 | `tests/unit/types/criterio-intento-entrega.test.ts` · «R12/R14: ninguna arista del mapa decide por sí sola un intento de entrega» | Que el mapa no decide intentos | **Verde, pero NO cubre R12**: mide el mapa, no el predicado. R12 exige que la reprogramación de la tienda no sume, y hoy suma | **CONSERVAR como R14** y **reasignar R12** al caso nuevo de la fila #18. Un requisito cuyo test mide otra cosa es un requisito sin dueño |

Recuento: **7 archivos a REESCRIBIR** (#1,#2,#3,#5,#6, las semillas de #10 y los
casos de #16), **1 a ADAPTAR** (#4), **1 prosa a actualizar** (#8), **casos NUEVOS**
(#17), y **~40 archivos que deben seguir verdes** (#11,#12,#13,#14,#15). Cualquier
rojo fuera de esta lista es un hallazgo, no un daño colateral.

**Estado real (7d9471c3):** todo lo anterior está hecho salvo #10 (**1 rojo
declarado**, ya DESBLOQUEADO por D15 → T13). Las filas **#18 y #19** son el trabajo
de la tercera ronda y **NO están hechas**; la declaración de la deriva (§8.3) es el
trabajo de la cuarta y **tampoco**.

---

## 7. Esto TOCA DINERO: cómo se verifica que no se cobra de más

La cadena es literal y está en el código: `contarIntentos`
(`OrdenHistorialService.ts:64`) → `DevolucionSlaService.ts:117-122` → `escalar`
(`:174-186`) → `DevolucionSlaRepository.escalarDevueltaSla:126` → gestión
sintética `resultado: 'rechazada'` con `cierre_id NULL` (`:145-155`) →
`derivarIngresoBodega` / `ingresoBodegaPorResultado`
(`lib/utils/cierre-totales.ts:44`, `lib/utils/ingreso-bodega.ts:18`) → snapshot
`ingreso_bodega_rechazo` al cerrar (`CierreDiaRepository.ts:507-522`) → wallet al
aprobar (`CierresAdminRepository.ts:664-672`). **Un intento contado antes de
tiempo es un cobro real a la tienda antes de tiempo.**

Cinco verificaciones exigidas, en orden:

1. **Medición contra producción (⛔ Q4), patrón `160/D7`.** Se escribió como
   medición **previa** («antes de tocar código»); **esa puerta ya pasó**: el
   criterio nuevo, con sus seis condiciones, está desplegado en `prod`
   (verificado el 2026-08-14 sobre `origin/prod`). Lo que queda es la misma
   consulta como medición **POSTERIOR**, y **sigue sin ejecutarse**. Está escrita
   y lista en **§7.6**; solo falta correrla y pegar el resultado con fecha.
   `160/D7` midió 0 órdenes en su día: **ese número no es reutilizable**, hay que
   volver a medir.
2. **Dirección del error declarada, y con D8 va a favor.** La regla del repo
   (`OrdenHistorialRepository.ts:182-186`): contar de MENOS retrasa el escalado
   (inofensivo para la tienda); contar de MÁS cobra antes de tiempo. Con el ancla
   en `aprobado`, **el conteo de casi toda orden BAJA** ⇒ el escalado se RETRASA.
   El riesgo de esta feature **no es cobrar de más, es no cobrar nunca** (Q5,
   riesgo ACEPTADO por D14). Eso no relaja nada: se testea igual, pero el foco de
   la vigilancia cambia. **Excepción a vigilar: el discriminador de §3.4.** Sin él
   la reprogramación de la tienda suma de más (R12 incumplido) y eso sí adelanta un
   `cobroRechazado`. **Ya está** (Grupo 4, en `dev` y en `origin/prod`,
   verificado el 2026-08-14) — la vigilancia se traslada a la lista:
   `ORIGEN_TIPOS_VISITA_REAL` es de INCLUSIÓN, y meterle una familia sintética
   reabre exactamente este agujero.
3. **Lista de INCLUSIÓN, no de exclusión** (§4). Un `resultado` futuro no puede
   empezar a contar solo. Test dedicado, heredado del propósito de #1 de §6.
4. **No-doble-conteo (R4/R29)** con dos escenarios: (a) dos gestiones vigentes de
   la misma orden en el mismo cierre aprobado → 1; (b) aprobar / re-aprobar el
   mismo cierre → el mismo número.
5. **`devolucion-sla-dinero.test.ts` verde sin tocar** (#14 de §6): el monto y los
   disparadores del cobro no cambian (R17). Si ese archivo necesita cambios, el
   alcance de la feature se salió de sitio.

### 7.6 La consulta de medición de ⛔ Q4 — lista para pegar (SOLO LECTURA)

> **⚠️ LA PREMISA CADUCÓ (2026-08-14).** Esta consulta se escribió para medir
> **ANTES** de activar el criterio nuevo. **El criterio nuevo ya corre en
> producción**: `ORIGEN_TIPOS_VISITA_REAL` aparece 3 veces en
> `origin/prod:lib/repositories/OrdenHistorialRepository.ts` (y la lista vive en
> `origin/prod:lib/types/orden-historial.ts`), es decir, las **seis** condiciones
> están desplegadas. Esa puerta pasó y no se puede volver a cruzar. Lo que la
> consulta puede dar HOY —y sigue sin ejecutarse— es una medición **POSTERIOR**:
> a cuántas órdenes movió el cambio de lado del umbral, fechada. Ya no es un
> requisito de activación; es la cuenta de lo que el cambio hizo, y sirve para
> saber si alguna orden se rechazó (y se cobró) antes de lo que se habría cobrado
> con el criterio viejo. Ver R19 en `requirements.md`, reexpresado con esa fecha.

Sin `INSERT`, sin `UPDATE`, sin `DELETE`, sin DDL: solo `WITH` + `SELECT`.
Parametrizada por el umbral (`REINTENTOS_MIN_INTENTOS`, default 3). Responde: para
las órdenes que HOY reposan en `devuelta`, conteo viejo vs. conteo nuevo, y cuántas
cruzan el umbral en cada dirección.

```sql
-- Feature 215 / Q4 — efecto retroactivo del cambio de criterio de intentos.
-- SOLO LECTURA. Ejecutar contra la base real y pegar el resultado con FECHA en este design.
-- Corregida el 2026-08-14: al criterio NUEVO le faltaba la SEXTA condicion (visita real,
-- §3.4/R34), que SI esta en el codigo vivo y en produccion. Tal como estaba, la consulta
-- contaba las gestiones sinteticas y sobreestimaba `n_nuevo`.
WITH parametros AS (
  SELECT 3::int AS umbral                       -- REINTENTOS_MIN_INTENTOS
),
estatus AS (
  SELECT
    max(CASE WHEN "value" = 'devuelta'     THEN "id" END) AS devuelta_id,
    max(CASE WHEN "value" = 'reprogramada' THEN "id" END) AS reprogramada_id
  FROM "order_status"
),
-- El universo: las que hoy esperan al cron SLA.
en_vuelo AS (
  SELECT o."id" AS orden_id
  FROM "orden" o
  JOIN "order_status" os ON os."id" = o."estatus_id"
  WHERE os."value" = 'devuelta'
    AND o."deleted_at" IS NULL
),
-- Criterio VIEJO (160/R1): transiciones vigentes del historial.
conteo_viejo AS (
  SELECT v.orden_id, count(h."id") AS n_viejo
  FROM en_vuelo v
  CROSS JOIN estatus e
  LEFT JOIN "orden_historial_estado" h
         ON h."orden_id" = v.orden_id
        AND ( h."estatus_destino_id" = e.devuelta_id
              OR ( h."estatus_destino_id" = e.reprogramada_id
                   AND h."origen_tipo"::text = 'gestion' ) )
        AND ( ( h."gestion_orden_id" IS NULL
                AND h."origen_tipo"::text NOT IN ('gestion','deshacer_gestion') )
              OR EXISTS ( SELECT 1 FROM "gestion_orden" g
                           WHERE g."id" = h."gestion_orden_id"
                             AND g."anulada_at" IS NULL ) )
  GROUP BY v.orden_id
),
-- Criterio NUEVO (215/D2+D6+D7+D8+D9+D10+D13): cierres APROBADOS distintos con resultado
-- contable Y nacidos de una VISITA REAL (§3.4 / R34). Son SEIS condiciones, no cinco.
conteo_nuevo AS (
  SELECT v.orden_id, count(DISTINCT g."cierre_id") AS n_nuevo
  FROM en_vuelo v
  LEFT JOIN "gestion_orden" g
         ON g."orden_id" = v.orden_id
        AND g."anulada_at" IS NULL
        AND g."resultado"::text IN ('rechazada','devuelta','reprogramada')
        AND g."cierre_id" IS NOT NULL
        AND EXISTS ( SELECT 1 FROM "cierre_dia" c
                      WHERE c."id" = g."cierre_id"
                        AND c."estado"::text = 'aprobado' )
        -- SEXTA condicion (§3.4, R34): la gestion nace de una VISITA REAL, no es sintetica.
        -- Espejo SQL de `historialEstados: { some: { ordenId, origenTipo: { in: [...] } } }` de
        -- `whereIntentosVigentes`. `IN (...)` y no `= 'gestion'` porque el original es una LISTA
        -- de INCLUSION (`ORIGEN_TIPOS_VISITA_REAL`, hoy un solo valor): si esa lista crece, este
        -- `IN` crece con ella. Sin esto la consulta cuenta el escalado SLA y la reprogramacion
        -- de escritorio de la tienda como intentos y SOBREESTIMA `n_nuevo`.
        -- El `orden_id` repetido NO es decorativo: `orden_historial_estado` no tiene indice por
        -- `gestion_orden_id`, y repetirlo hace que el EXISTS entre por `@@index([orden_id,
        -- created_at])` en vez de recorrer entera una tabla que crece con cada transicion.
        AND EXISTS ( SELECT 1 FROM "orden_historial_estado" h2
                      WHERE h2."gestion_orden_id" = g."id"
                        AND h2."orden_id" = v.orden_id
                        AND h2."origen_tipo"::text IN ('gestion') )
  GROUP BY v.orden_id
)
SELECT
  count(*)                                                                AS ordenes_en_devuelta,
  count(*) FILTER (WHERE cv.n_viejo <  p.umbral AND cn.n_nuevo >= p.umbral) AS empiezan_a_escalar,   -- ⚠ cobra antes
  count(*) FILTER (WHERE cv.n_viejo >= p.umbral AND cn.n_nuevo <  p.umbral) AS dejan_de_escalar,     -- retrasa / nunca
  count(*) FILTER (WHERE cn.n_nuevo <  cv.n_viejo)                          AS conteo_baja,
  count(*) FILTER (WHERE cn.n_nuevo >  cv.n_viejo)                          AS conteo_sube,
  count(*) FILTER (WHERE cn.n_nuevo =  cv.n_viejo)                          AS conteo_igual,
  count(*) FILTER (WHERE cn.n_nuevo = 0 AND cv.n_viejo > 0)                 AS pierden_todo_el_conteo,
  max(cv.n_viejo)                                                          AS max_viejo,
  max(cn.n_nuevo)                                                          AS max_nuevo
FROM en_vuelo v
JOIN conteo_viejo cv USING (orden_id)
JOIN conteo_nuevo cn USING (orden_id)
CROSS JOIN parametros p;
```

Segunda consulta, para inspeccionar los casos concretos antes de decidir (mismos
`WITH`, cambiando solo el `SELECT` final; `LIMIT` para no volcar la tabla):

```sql
SELECT v.orden_id, cv.n_viejo, cn.n_nuevo,
       (cv.n_viejo >= p.umbral) AS escalaba_antes,
       (cn.n_nuevo >= p.umbral) AS escala_ahora
FROM en_vuelo v
JOIN conteo_viejo cv USING (orden_id)
JOIN conteo_nuevo cn USING (orden_id)
CROSS JOIN parametros p
WHERE (cv.n_viejo >= p.umbral) <> (cn.n_nuevo >= p.umbral)
ORDER BY cv.n_viejo DESC, cn.n_nuevo DESC
LIMIT 100;
```

**Lectura esperada (hipótesis, NO conclusión):** con D8, `dejan_de_escalar` y
`pierden_todo_el_conteo` deberían dominar sobre `empiezan_a_escalar`. Si
`empiezan_a_escalar > 0`, hay órdenes que se rechazarán y se cobrarán ANTES de lo
que se cobrarían hoy: eso hay que enseñárselo al humano orden por orden con la
segunda consulta antes de activar nada.

### 7.6-bis RESULTADO EJECUTADO — 2026-08-14

**Dónde se corrió:** base de **producción**, proyecto Supabase
`scfnwxqbsgkzwsdntdvd`, por el MCP de Supabase (solo lectura: la consulta es `WITH` +
`SELECT`, sin `INSERT`/`UPDATE`/`DELETE`/DDL). **Se corrió la consulta tal cual está
escrita arriba**, con la sexta condición ya dentro.

**Que la base es la que decimos, y no otra, está comprobado:** `_prisma_migrations`
tiene **116 migraciones aplicadas** y la última es `20260812120000_gestion_orden_pago`
— exactamente las 116 de `db/migrations` en `dev` y en `prod`. No se leyó ninguna
credencial para saberlo.

| columna | valor |
| --- | --- |
| `ordenes_en_devuelta` | **0** |
| `empiezan_a_escalar` ⚠ cobra antes | **0** |
| `dejan_de_escalar` | **0** |
| `conteo_baja` / `conteo_sube` / `conteo_igual` | 0 / 0 / 0 |
| `pierden_todo_el_conteo` | 0 |
| `max_viejo` / `max_nuevo` | `null` / `null` |

**La segunda consulta (los casos uno por uno) no se corrió, y no debía:** su
disparador es `empiezan_a_escalar > 0`, y salió 0.

#### El cero es de UNIVERSO VACÍO — el control que lo demuestra

Un 0 sobre un conjunto vacío es indistinguible de una consulta mal escrita, así que
se comprobó por separado, y este es el párrafo que hay que leer antes de citar el
cero:

- **El estado existe y el join es correcto:** `devuelta` está en el catálogo
  `order_status` (`39095102-9ec0-427d-92ca-2c7e599110e3`).
- **La base tiene datos:** **141 órdenes vivas**.
- **Nadie está en `devuelta` ahora mismo:** 0 órdenes con ese `estatus_id`, **incluso
  contando las borradas** — o sea, no es el filtro `deleted_at` el que vacía el
  universo.
- **El dominio SÍ tiene materia:** **11** órdenes pasaron alguna vez por `devuelta`,
  **8** llegaron a `rechazada`, y hay **32** gestiones contables (`resultado` en
  `rechazada`/`devuelta`/`reprogramada`, no anuladas) colgadas de un cierre
  **aprobado**. El mecanismo se ha usado; lo que está vacío es la foto de hoy.
- **Ninguna de esas 8 se rechazó bajo el criterio nuevo:** 7 llegaron a `rechazada`
  por `origen_tipo = gestion` (manual, la última el **2026-08-12**) y **una sola** por
  `escalado_devuelta_sla` (**2026-07-26**). Las dos fechas son **anteriores** a que el
  criterio nuevo llegara a producción (release #381, 2026-08-14). El cron ha escalado
  **una vez en toda la vida de la base**.

**Qué se puede afirmar, entonces:** al corte del 2026-08-14 el cambio de criterio
**no movió de lado del umbral a ninguna orden**, y **nadie ha sido cobrado antes de
tiempo por él** — porque bajo el criterio nuevo todavía no ha escalado nadie.

**Qué NO se puede afirmar, y por eso queda escrito aquí:** que el cambio sea inocuo.
Este número **caduca en cuanto una orden entre en `devuelta`**. Es el mismo cero que
midió `160/D7` en su día, y por el que este documento ya declaraba que **aquel número
no era reutilizable**: este tampoco lo es. El efecto real se verá en la primera
tanda de devoluciones que viva entera bajo el criterio nuevo, y la superficie que lo
haría visible es la ficha **219**.

---

## 7bis. Q5 — La orden cuyo cierre nunca se aprueba. **CERRADA: riesgo ACEPTADO (D14)**

> **Decisión del humano (2026-08-13), textual:** «el cierre se cerrara en algun
> momento por un usuario». **No se implementa ninguna mitigación.** El supuesto
> operativo, con lo que pasa si no se cumple, está escrito en `requirements.md`
> §Supuesto operativo declarado. Esta sección se CONSERVA entera —caminos, efectos
> y las tres mitigaciones descartadas— para que quien vuelva a esto no tenga que
> redescubrirlo.

Con el conteo anclado en `aprobado`, **la aprobación del cierre pasa a ser un
prerrequisito del escalado por SLA**, y el escalado es lo que dispara el
`cobroRechazado`. Si el cierre no se aprueba, la orden no escala **nunca**.

### (a) Caminos medidos por los que un cierre NO llega a `aprobado`

| # | Camino | Cómo se sale de ahí | Quién tiene que actuar |
| --- | --- | --- | --- |
| 1 | `solicitado` que el admin nunca resuelve | aprobar/rechazar (`CierresAdminRepository.resolverCierre:616`) | admin/maestro |
| 2 | `vencido` del corte automático nunca re-solicitado | el mensajero lo solicita (`CierreDiaService.ts:401-407`) **o** el admin usa la válvula `forzarSolicitudVencido` (`CierresAdminRepository.ts:879`) — **`vencido` NO es aprobable directamente**, `ESTADOS_RESOLUBLES = ["solicitado"]` (`:39`) | mensajero o admin |
| 3 | `rechazado` que el mensajero nunca re-solicita | `transicionarRechazadoASolicitado` (`CierreDiaService.ts:414-419`) o la misma válvula (`ESTADOS_REABRIBLES` incluye `rechazado`, `:44`) | mensajero o admin |
| 4 | Ciclo `solicitado → rechazado → solicitado → …` sin tope | no hay límite de vueltas en el código | — |

Los caminos 2 y 3 son especialmente reales cuando el mensajero **se desvincula**:
su cierre queda abierto y nadie lo re-solicita salvo que un admin recuerde la
válvula de escape (que existe justo para eso, feature 111/R16).

### (b) Qué le pasa a la orden en cada uno

Idéntico en los cuatro: la gestión tiene `cierre_id` poblado (ya **no** se puede
deshacer, `CierreDiaService.ts:519-521`), pero el cierre no está `aprobado` ⇒
**conteo 0**. El cron SLA (`DevolucionSlaService.ts:117-134`) lee 0 < umbral y
ejecuta `liberarDevueltaSla`: la orden vuelve a bodega con `prioridad = true`
(`DevolucionSlaRepository.ts:94-99`), se reasigna, sale otra vez, se vuelve a
devolver, y se repite. **La orden gira indefinidamente y el rechazo nunca se
cobra.** No es un bucle de cron (la orden sale de `devuelta` al liberarse), es un
ciclo operativo de días o semanas.

**El ciclo NO es inescapable: es MANUAL, y la salida ya existe.** Ninguno de los
cuatro caminos es una trampa cerrada del sistema; los cuatro se destraban con una
acción de persona, y para el peor de ellos —el `vencido` de un mensajero que ya no
está— hay una **válvula de escape** dedicada: `forzarSolicitudVencido`
(`CierresAdminRepository.ts:879`, feature 111/R16), que un admin usa para pasar el
cierre a `solicitado` y poder aprobarlo. Que `ESTADOS_RESOLUBLES = ["solicitado"]`
(`:39`) impida aprobar un `vencido` **directamente** no significa que no haya salida:
significa que la salida pasa por una persona. Lo que el sistema NO tiene es un
mecanismo que lo haga solo, ni una alerta que avise de que hace falta (M3, descartada
por D14). Decirlo importa: pintar esto como un bucle sin salida lleva a implementar
una mitigación que ya existe a mano.

### (c) Tres mitigaciones posibles, con su coste. **NINGUNA se implementa (D14)**

| Opción | En qué consiste | Coste / contrapartida |
| --- | --- | --- |
| **M1 — Contar también al VENCER o al SOLICITAR** (ancla `i` o `ii` de §3.2 en OR con `aprobado`) | El conteo pasa a `estado IN ('vencido','solicitado','aprobado')`, o directamente `cierre_id IS NOT NULL` | Rompe parcialmente la decisión D8 (el humano dijo «al aprobar»). Con `vencido` en la lista **rompe R32/D12**: un `vencido` re-solicitado pasa a `solicitado` y el conteo bajaría, salvo que se incluyan los dos estados. Con `cierre_id IS NOT NULL` la monotonía se recupera y el escalado deja de depender de que un humano apruebe. |
| **M2 — Tope de liberaciones por orden** | El cron deja de liberar una orden que ya fue liberada N veces; a la N+1 escala. El dato ya existe y es persistente: las filas `origen_tipo = 'liberacion_devuelta_sla'` del historial (`lib/types/orden-historial.ts:29`) | Introduce un SEGUNDO criterio numérico junto al de intentos ⇒ roza R6 («no admitir una segunda definición»). Habría que declararlo como límite operativo, no como «intento». Configuración nueva (otra variable de entorno). |
| **M3 — Alerta operativa, sin tocar el conteo** | Aviso/reporte de cierres abiertos con antigüedad > N días (la cola ya se lista por `@@index([estado])`) | No arregla nada por sí solo: traslada el problema a que alguien mire. Barato y compatible con las otras dos. Podría ir en ficha aparte. |

**Estado: ninguna elegida (D14).** Sigue siendo útil **medir cuántos cierres
abiertos hay hoy y de qué antigüedad**, porque es lo que dimensiona el riesgo que se
ha aceptado y lo que permitirá saber, más adelante, si el supuesto se sostiene:

```sql
-- SOLO LECTURA: cierres que NO están aprobados, por estado y antigüedad.
SELECT c."estado",
       count(*)                                              AS cierres,
       min(c."solicitado_at")                                AS mas_antiguo,
       count(*) FILTER (WHERE c."solicitado_at" < now() - interval '7 days')  AS mas_de_7_dias,
       count(*) FILTER (WHERE c."solicitado_at" < now() - interval '30 days') AS mas_de_30_dias
FROM "cierre_dia" c
WHERE c."estado"::text <> 'aprobado'
GROUP BY c."estado"
ORDER BY cierres DESC;
```

**RESULTADO (2026-08-14, misma base de producción, misma vía):** **cero filas.** No
existe hoy ni un solo cierre que no esté aprobado.

Con su control, porque un conjunto vacío tampoco se cita solo: la tabla `cierre_dia`
tiene **12 cierres**, y los **12 están `aprobado`** (del 2026-07-22 al 2026-08-12).
No hay ninguno en `solicitado`, `vencido` ni `rechazado`, así que **ninguno lleva más
de 7 ni más de 30 días abierto**.

**Qué dice esto del riesgo que D14 aceptó:** el supuesto operativo del humano —«el
cierre se cerrará en algún momento por un usuario»— **se sostiene en producción a
fecha de hoy**, sobre 12 de 12. Es la primera vez que se mide, y es una foto: el
riesgo no desaparece, queda **dimensionado en 0 casos**. Si algún día esa consulta
devuelve filas con antigüedad alta, esas órdenes son las que se quedan sin escalar
—y sin cobrar— indefinidamente, que es exactamente lo que M1/M2/M3 mitigaban.

---

## 8. Analítica: la parte que nadie ve venir

`primer_intento_ok` («Entrega al primer intento») se define como «entregas
logradas sin intento previo» y **consume este mismo conteo**
(`AnaliticaRollupService.ts:238`, `AnaliticaOperativaService.ts:462`). Dos hechos
medidos que convierten esto en decisión, no en detalle:

- Es un KPI **PERSISTIDO** en `analytics_daily`, con CHECK
  `primer_intento_ok <= entregas` en base
  (`db/migrations/20260731120000_analytics_daily/migration.sql:90`) y validación
  previa en el servicio (`AnaliticaRollupService.ts:248-254`).
- Con D8, una entrega cuyo cierre aún no está **aprobado** tiene 0 intentos previos
  ⇒ **el KPI sube mecánicamente** durante el día (y en todo día cuyos cierres tarden
  en aprobarse) y **baja al aprobarse los cierres**. Las filas históricas ya escritas
  miden otra cosa. Y como el rollup se escribe por fecha, **el mismo día puede dar
  dos valores distintos según cuándo se recalcule**.

### 8.1 Decisión: deriva DECLARADA con fecha de corte (D15 / Q10 CERRADA)

> **Textual del humano (2026-08-13):** «declara la deriva con fecha de corte».

Se ASUME el escalón en la serie. **No se re-backfillea** el histórico y **no se
redefine** la métrica para que deje de depender del contador. Lo que hay que hacer
es dejarlo escrito donde se lea. Las dos alternativas descartadas por esa decisión,
con su coste, para que nadie las reabra por intuición:

| Alternativa | Coste que evita D15 |
| --- | --- |
| **Re-backfillear `analytics_daily`** con el criterio nuevo | Reescribiría meses de KPI ya reportados; el histórico dejaría de coincidir con lo que la gente vio y decidió en su día. Y sería falso: los cierres de entonces no estaban aprobados **en el momento de aquel cálculo**. |
| **Redefinir la métrica** para no depender del contador (p. ej. «entregas sin `devuelta` previa en el historial») | Reintroduce una SEGUNDA definición de intento: es exactamente lo que R6/R23 prohíben, y el precedente de la 124/R11 (la métrica REMITE, no define). |

### 8.2 Mecanismo de la «fecha de corte»: derivado del dato, no adivinado (R35)

**La trampa:** el criterio nuevo empieza a regir cuando este código se **despliega**,
no cuando se decide ni cuando se mergea el PR. Nadie sabe hoy esa fecha, así que
cualquier mecanismo que la exija por adelantado nace mintiendo.

**Segunda trampa, medida:** el corte **no cae limpio sobre `fecha`**. El job
recalcula días pasados (backfill, `tests/unit/analytics/backfill-guards.test.ts`) y
el upsert refresca `updated_at` en cada recálculo
(`AnaliticaRollupRepository.ts:434,453`). Una fila de una fecha antigua recalculada
tras el despliegue queda con el criterio NUEVO. Por eso el corte es por **cuándo se
calculó**, no por **qué día mide**.

| Mecanismo | Veredicto |
| --- | --- |
| **(M-A) Derivar el corte de `analytics_daily.updated_at`** — columna que YA existe (`db/migrations/20260731120000_analytics_daily/migration.sql:83`) y que la escritura refresca en cada recálculo. Regla declarada: *«toda fila con `updated_at` anterior al despliegue de la 215 está calculada con el criterio viejo; toda fila con `updated_at` posterior, con el nuevo, sea cual sea su `fecha`»*. | **ELEGIDO.** No hay fecha que adivinar ni constante que mantener; el dato ya está por fila; sin migración (R27); y es la única formulación que sobrevive al backfill. |
| (M-B) Constante en código (`FECHA_CORTE_*`) fijada al desplegar | **Descartado.** O se adivina antes (miente) o exige un **segundo commit y un segundo despliegue** después. Si alguien lo olvida —y se olvida—, la constante afirma una fecha falsa: peor que no tenerla. |
| (M-C) Variable de entorno | **Descartado.** Misma trampa que M-B, y además invisible en el repo: quien lee la serie no puede saber qué valor tenía. |

**¿Exige acción humana al desplegar?** **Sí, UNA, y es puramente documental:**
anotar el instante real del despliegue en `progress/impl_215.md` (y como fecha
legible en la descripción de la métrica). No toca código, no exige re-desplegar, no
bloquea nada. **Y si se olvida, la serie sigue siendo interpretable fila a fila por
`updated_at`** (R35): lo único que se pierde es la etiqueta cómoda. Esa es
justamente la razón de elegir M-A sobre M-B.

### 8.3 Dónde queda declarada la deriva (R24-b)

| Sitio | Qué dice | Por qué ahí |
| --- | --- | --- |
| `lib/analytics/metrics.ts`, `descripcion` de `primer_intento_ok` (`:334-335`) | El cambio de criterio, la regla del corte por `updated_at`, y el efecto INTRADÍA | Es **la definición** de la métrica: quien pregunta «qué mide esto» llega aquí |
| `lib/services/AnaliticaRollupService.ts` (junto a `contarPrimerIntento`, `:230-242`) | Lo mismo, en el punto donde se calcula y se PERSISTE | Es quien escribe las filas que tienen el escalón |
| `lib/services/AnaliticaOperativaService.ts` (`:894-901`) | Lo mismo, en la versión VIVA | Para que nadie concluya que viva y rollup «se contradicen»: miden lo mismo, con criterios de épocas distintas |
| `progress/impl_215.md` | El instante REAL del despliegue, anotado después | Es la etiqueta legible del corte (M-A) |

**Lo que NO se toca, y es medido, no un olvido:** el aviso **no llega a la pantalla**
de analítica. El texto visible sale de
`app/(app)/analitica/_components/operativo/catalogo-paneles.ts` y `textos.ts`, y los
`descripcion:` del catálogo «no llegan a pantalla»
(`tests/unit/analytics/etiquetas-visibles.guardia.test.ts:32-34`). Escribirlo ahí
tocaría `app/`, que choca con R20 y con la guardia de esta feature. Un
`COMMENT ON COLUMN` sobre `analytics_daily` tampoco cabe: sería migración (R27).
**Llevar el aviso a la pantalla es candidato a ficha aparte.**

### 8.4 El invariante que NO se negocia (R23)

Sea cual sea la deriva, el KPI sigue REMITIENDO al punto único
(`lib/analytics/metrics.ts:344-355`), sin `COUNT` propio, sin umbral propio y sin
columna materializada; y `primer_intento_ok <= entregas` se mantiene (CHECK en base
+ validación previa en `AnaliticaRollupService.ts:248-254`).

---

## 9. Conflictos con otras features en vuelo

**Feature 208 (`feature/208-pago-multiple-entrega`, en el checkout principal).**
Toca `CierreDiaService`, `CierreDiaRepository`, `CierresAdminRepository`,
`GestionOrdenRepository`, `MisAsignacionesService` y sus interfaces, más
`db/schema.prisma` y una migración nueva (`20260812120000_gestion_orden_pago`).
Solape con esta feature, por archivo:

| Archivo | La 215 lo necesita para | Riesgo |
| --- | --- | --- |
| `lib/repositories/CierreDiaRepository.ts` | Solo **leerlo** (`crearCierre:395`, `:480-483`) para fijar el ancla | **Bajo si la 215 no escribe ahí.** Con el enfoque derivado, no hace falta modificarlo |
| `lib/repositories/CierresAdminRepository.ts` | Solo **leerlo** (`resolverCierre:616`) | Bajo, mismo motivo |
| `lib/services/MisAsignacionesService.ts` | Es consumidor del conteo (`:168`), no se toca | Bajo; sí colisiona en `tests/unit/services/mis-asignaciones-service.test.ts` si ambas lo editan |
| `db/schema.prisma` | **Nada: D7 prohíbe migración** | **NULO.** El solape con la migración sin mergear de la 208 (`20260812120000_gestion_orden_pago`) **desaparece por decisión** |
| `lib/services/CierreDiaService.ts` | Solo leerlo (`solicitarCierre:391`, ventana de deshacer `:519-521`) | Bajo |

**Conclusión operativa (firme tras D7):** el diff de la 215 vive en
`lib/repositories/OrdenHistorialRepository.ts`,
`lib/services/OrdenHistorialService.ts`, `lib/types/orden-historial.ts`, las dos
interfaces y sus tests. **Cero archivos compartidos con la 208 y cero solape en
`db/`.** El único roce posible es `tests/unit/services/mis-asignaciones-service.test.ts`
si ambas ramas lo editan, y la 215 solo debería tocarlo si se rompe (no debería:
usa `fakeIntentosEnLote`, que no cambia).

**Feature 208 y el ancla.** La 208 modifica `CierreDiaService`,
`CierreDiaRepository` y `CierresAdminRepository`, que son exactamente los tres
archivos donde vive el ciclo del cierre del que D8 depende. La 215 **no los
escribe**, pero sí depende de que la semántica de `cierre_dia.estado` y de
`gestion_orden.cierre_id` no cambie. Al mergear, comprobar que la 208 no introduce
un cuarto estado ni un segundo camino de vinculación.

---

## 10. Riesgos

1. **Verde falso en los tests de DB** (deuda ya registrada en memoria del repo):
   varias suites de integración retornan temprano con tablas vacías. Las semillas
   de #10 de §6 hay que verificarlas con datos, no con `passed`.
2. **El agujero original queda SIN TAPAR, por decisión (D6).** Una orden cortada
   por el cron sigue volviendo a reparto con el mismo contador. **Aceptado y
   declarado** en `requirements.md` §Limitación declarada + R33; candidato a ficha
   aparte. El riesgo residual no es técnico, es de expectativa: quien lea el título
   de la feature va a creer que eso se arregló.
3. **Órdenes que dejan de escalar — el riesgo PRINCIPAL de esta feature, y está
   ACEPTADO** (Q5/D14, §7bis): con el ancla en `aprobado`, un cierre nunca aprobado
   congela el conteo en 0, el cron libera indefinidamente y el rechazo **nunca se
   cobra**. Se agrava porque `vencido` y `rechazado` necesitan un paso humano antes
   de poder aprobarse (`ESTADOS_RESOLUBLES = ["solicitado"]`) — **pero ese paso
   existe y está a mano**: la válvula `forzarSolicitudVencido`
   (`CierresAdminRepository.ts:879`, feature 111/R16) destraba un `vencido`
   /`rechazado` sin tocar código. El ciclo es MANUAL de salir, no inescapable.
   Riesgo asumido por decisión, no mitigado: es un supuesto operativo, no una
   garantía del sistema.
6. **El discriminador de §3.4 toca el camino caliente del conteo** y
   `orden_historial_estado` no tiene índice por `gestion_orden_id`. Si el `EXPLAIN`
   pidiera uno, es migración y D7/R27 la prohíben ⇒ se para y se lleva al humano.
7. ~~**Mientras §3.4 no exista, R12 está incumplido en producción**: la
   reprogramación de la tienda suma un intento que no debería, y eso adelanta el
   escalado y el cobro. Es el único vector de «cobrar de más» que esta feature
   introduce.~~ **CERRADO (2026-08-14):** §3.4 existe, está en `dev` y en
   `origin/prod`, y la reprogramación de la tienda ya no suma. El riesgo se conserva
   tachado, no borrado: **es el único vector de «cobrar de más» que esta feature
   llegó a tener**, y quien toque `ORIGEN_TIPOS_VISITA_REAL` lo reabre.
4. **El contador deja de bajar (D12/R32).** Es un cambio observable: hoy deshacer
   una gestión baja el número. Tras el cambio, una gestión solo cuenta cuando ya no
   es anulable. Declarado y con test; **si aparece un camino que lo haga bajar
   —anulación fuera de ventana, borrado físico de `gestion_orden`, un cierre que
   salga de `aprobado`— R32 se rompe y hay que volver a la puerta**, no parchear el
   test.
5. **Deriva del KPI persistido** (⛔ Q10, §8): el mismo día puede dar dos valores
   distintos según cuándo se recalcule el rollup.

---

## §7bis ACTUALIZADO POR LA FEATURE 239 — 2026-08-19

**Q5 no se cierra: cambia de forma**, y conviene decir en qué dirección.

Antes: una orden cuyo cierre nunca se aprueba tenía 0 intentos, así que el cron la liberaba a
bodega una y otra vez **sin escalar jamás** — un bucle invisible, con la mercadería circulando.

Desde la 239, esa orden se queda en `devolucion_por_confirmar` y el cron **no la ve**. El bucle se
acaba, y con él la `prioridad` falsa y el ruido en el ranking. **Pero la mercadería se congela**: el
paquete del cliente final queda detenido esperando una aprobación administrativa, y la tienda no se
entera porque no lo ve.

**Lo que sí gana: la población atascada pasa a ser CONTABLE.** Antes una orden en el bucle se veía
igual que una sana. La consulta está en `specs/239-devolucion-espera-cierre/design.md` y su
resultado contra producción el 2026-08-19 fue **0** en las tres columnas.

**La decisión D14 sigue en pie** —el riesgo se acepta porque «el cierre se cerrará en algún momento
por un usuario»— pero ahora tiene termómetro. **M3 deja de ser opcional**: sin la alerta, el
congelamiento es más silencioso que el bucle que reemplaza.
