# Feature 276 — bitácora de implementación (BACKEND)

> Rama `feature/276-tope-de-intentos`, sacada de **`dev` local (`94c824f6`)** y no de `origin/dev`
> (`e93c19e6`): los tres commits del spec de la 276 todavía **no estaban empujados**, así que
> ramificar de `origin/dev` habría dejado la rama sin la ficha que implementa.
>
> **Alcance: servidor.** Los componentes de `app/**` y `components/**` no se tocaron. Lo que queda
> para `frontend_dev` está enumerado al final, con lo que ya tiene hecho de su lado.

---

## T0 · La medición de R37, y lo que aquí se pudo y no se pudo hacer

**Lo que el spec ya traía, y no se re-deriva:** `requirements.md` §«MEDICIÓN DE R37, EJECUTADA —
2026-08-24» dice que se ejecutó contra producción **hoy mismo** y que la única orden viva con
`intentos >= 3` es la guía `28098171`, en `devuelta`; **cero** en `reprogramada`, `en_bodega_*` o
`por_recoger`. Con eso, la decisión «sin backfill» (Q6) se sostiene.

**Lo que este agente NO pudo hacer, y hay que decirlo claro:** *no tengo el MCP de Supabase en mi
juego de herramientas*, así que **no re-ejecuté la consulta contra producción**. Lo que sí hice fue
**escribir el SQL y ejecutarlo contra la base local** para demostrar que corre y devuelve la forma
esperada (no que los datos de producción sean esos):

```sql
-- (A) órdenes VIVAS con intentos >= umbral, por estado.
--     Reproduce `contarIntentosVigentes` en SQL: cierres APROBADOS distintos, gestión contable
--     vigente, y una fila de historial de VISITA REAL enlazada a ESA gestión.
WITH intentos AS (
  SELECT g.orden_id, COUNT(DISTINCT g.cierre_id) AS n
  FROM gestion_orden g
  JOIN cierre_dia c ON c.id = g.cierre_id
  WHERE g.resultado IN ('rechazada','devuelta','reprogramada')
    AND g.anulada_at IS NULL
    AND g.cierre_id IS NOT NULL
    AND c.estado = 'aprobado'
    AND EXISTS (
      SELECT 1 FROM orden_historial_estado h
      WHERE h.gestion_orden_id = g.id
        AND h.orden_id = g.orden_id
        AND h.origen_tipo IN ('gestion','gestion_tienda_ayuda')
    )
  GROUP BY g.orden_id
)
SELECT os.value AS estado, COUNT(*)::int AS ordenes, MAX(i.n)::int AS max_intentos
FROM intentos i
JOIN orden o ON o.id = i.orden_id
JOIN order_status os ON os.id = o.estatus_id
WHERE o.deleted_at IS NULL AND i.n >= 3
GROUP BY os.value
ORDER BY 2 DESC;

-- (B) la población que T6 congela el primer día: `reprogramada` cuya gestión vigente nace de una
--     visita real y cuyo cierre NO está aprobado (incluido `cierre_id NULL`).
SELECT COUNT(*)::int AS ordenes
FROM orden o
JOIN order_status os ON os.id = o.estatus_id
WHERE o.deleted_at IS NULL
  AND os.value = 'reprogramada'
  AND EXISTS (
    SELECT 1 FROM gestion_orden g
    WHERE g.orden_id = o.id
      AND g.resultado = 'reprogramada'
      AND g.anulada_at IS NULL
      AND g.created_at = (
        SELECT MAX(g2.created_at) FROM gestion_orden g2
        WHERE g2.orden_id = o.id AND g2.resultado = 'reprogramada' AND g2.anulada_at IS NULL
      )
      AND EXISTS (
        SELECT 1 FROM orden_historial_estado h
        WHERE h.gestion_orden_id = g.id
          AND h.orden_id = g.orden_id
          AND h.origen_tipo IN ('gestion','gestion_tienda_ayuda')
      )
      AND (g.cierre_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM cierre_dia c WHERE c.id = g.cierre_id AND c.estado = 'aprobado'
      ))
  );
```

Salida **contra la base LOCAL** (`localhost:5432/ordenex`, 2026-08-24):

```
base: localhost:5432 · umbral: 3
A) ordenes vivas con intentos >= umbral, por estado:  []
B) reprogramadas con gestion de visita real en cierre NO aprobado:  [ { "ordenes": 0 } ]
```

**Decisión, una línea por número:**

- **(A)** local vacío ⇒ no aporta nada sobre producción. **La foto que manda sigue siendo la del
  spec** (una orden, en `devuelta`), y con ella «sin backfill» se sostiene.
- **(B)** local 0 ⇒ tampoco dice nada de producción. **Este número sigue sin medirse en producción**
  y es el que dice cuántas órdenes congela T6 el primer día.

> ⚠️ **BLOQUEANTE DE DESPLIEGUE, no de merge.** R37 exige re-ejecutar (A) **inmediatamente antes de
> desplegar**, porque la foto caduca: cualquier cierre aprobado entre hoy y el despliegue puede
> crear una orden en el umbral que R18 dejaría inasignable sin que nadie lo haya decidido. **Y (B)
> debería medirse la primera vez**, aunque el spec no lo exija para desplegar: es el tamaño de la
> población que la ficha congela. Las dos consultas son de **solo lectura** y están arriba, listas
> para pegar. Quien tenga el MCP de Supabase las corre; yo no pude.

---

## Qué se hizo, por tarea

| Task | Qué aterrizó |
| --- | --- |
| **T1** | `lib/types/tope-intentos.ts`: módulo **puro**, lista de INCLUSIÓN de tres values, `alcanzaElTope` con `>=`. El umbral entra por parámetro y el fichero no nombra la configuración. |
| **T2** | Enum `rechazo_tope_intentos` + migración `20260824120000_…` con su `down.sql`. La forma del `down` se copió del down del **mismo enum** en la 237/240 (recrean con la lista, no eliminan). |
| **T3+T9** | En el **mismo commit**: la arista `sin_gestionar -> rechazada` y su productor. |
| **T4** | La puerta en `MisAsignacionesService.gestionar`, junto a las guardas previsibles y **antes** del upload y de la tx. |
| **T5** | La misma puerta en `GestionDesdeAyudaService.gestionar` (paso 5-ter), con la dep del historial **obligatoria** y el composition root cableado. |
| **T6** | **La raíz**: `findOrdenesLiberables` trae el cierre y la sonda de visita real; el servicio no libera mientras la gestión vigente pueda subir el contador. `esperandoCierre` en el resultado y en el cuerpo del cron. |
| **T7/T8** | La puerta de asignación en las dos bodegas, por lote, con motivo único. |
| **T9** | El corte parte en dos destinos, con el conteo **dentro de la tx** usando el predicado importado. Gestión sintética `rechazada` / `cierre_id NULL` (**Q1 firmada**). |
| **T10** | El cron de SLA cuenta por lote y la rama `wrong_*` mira el contador. |
| **T13** | La guardia del invariante: criterio congelado + **censo derivado** de las vías hacia la circulación. |
| **T14** | El deshacer sigue vivo sobre una `reprogramada`, probado por conducta. |
| **T15** | Los cuatro textos nuevos, sin PII, uno por uno. |
| **T16** | `git diff dev...HEAD -- db/migrations/` no contiene ni un `UPDATE`/`INSERT`/`DELETE`. Comprobado y con test. |
| **Q2** | `ReprogramacionTiendaService.reprogramar` bloquea la tercera vía **en el momento del intento**, con el motivo único de R20. |
| **T11/T12 (mitad servidor)** | `MiAsignacionDTO` y `NovedadDTO` emiten `enElTope`; el umbral no cruza. |

---

## Archivos

### Nuevos — producción (2)

- `lib/types/tope-intentos.ts`
- `db/migrations/20260824120000_orden_historial_origen_rechazo_tope_intentos/{migration.sql,down.sql}`

### Modificados — producción (20)

`lib/services/MisAsignacionesService.ts` · `lib/services/GestionDesdeAyudaService.ts` ·
`lib/services/GuiaAsignacionService.ts` · `lib/services/AsignacionSateliteService.ts` ·
`lib/services/ReprogramacionTiendaService.ts` · `lib/services/LiberacionReprogramadaService.ts` ·
`lib/services/DevolucionSlaService.ts` · `lib/services/CierresAdminService.ts` ·
`lib/services/NovedadesService.ts` · `lib/services/mensajes-bloqueo.ts` ·
`lib/repositories/LiberacionReprogramadaRepository.ts` · `lib/repositories/CierresAdminRepository.ts` ·
`lib/interfaces/repositories/ILiberacionReprogramadaRepository.ts` ·
`lib/interfaces/repositories/ICierresAdminRepository.ts` ·
`lib/interfaces/services/ILiberacionReprogramadaService.ts` ·
`lib/interfaces/services/IMisAsignacionesService.ts` · `lib/types/orden-historial.ts` ·
`lib/types/order-status-transiciones.ts` · `app/api/cron/liberar-reprogramadas/route.ts` ·
`db/schema.prisma`

### Composition roots tocados (4) — todos con test que mide que **PASAN** la dependencia

`lib/actions/gestion-desde-ayuda.ts` · `lib/actions/ordenes-guia.ts` ·
`lib/actions/recepcion-satelite.ts` · `lib/actions/resolver-novedad.ts`

### Tests nuevos (13)

`tests/unit/types/tope-intentos.test.ts` ·
`tests/unit/services/mis-asignaciones-tope-intentos.test.ts` ·
`tests/unit/services/gestion-desde-ayuda-tope-intentos.test.ts` ·
`tests/unit/services/liberacion-reprogramada-tope.test.ts` ·
`tests/unit/services/guia-asignacion-tope-intentos.test.ts` ·
`tests/unit/services/asignacion-satelite-tope-intentos.test.ts` ·
`tests/unit/services/cierres-admin-tope-sin-gestion.test.ts` ·
`tests/unit/services/devolucion-sla-tope-wrong.test.ts` ·
`tests/unit/services/tope-intentos-dto-derivado.test.ts` ·
`tests/unit/guards/tope-intentos-invariante.guardia.test.ts` ·
`tests/unit/guards/tope-intentos-pii.guardia.test.ts` ·
🔴 `tests/integration/db/liberacion-reprogramada-cierre-real.test.ts` (**Postgres real**) ·
🔴 `tests/integration/db/cierre-sin-gestion-tope-sql-real.test.ts` (**Postgres real**) ·
`tests/integration/db/rechazo-tope-intentos-migration.test.ts` (mitad estática, mitad Postgres real) ·
`tests/integration/actions/gestion-desde-ayuda-cableado.test.ts`

### Tests existentes ampliados (24)

Fixtures (`intentos-entrega`, `inventario-transiciones-140`), la guardia de transiciones, los
**once** censos del enum, `orden-historial-cobertura`, `aprobacion-escrituras-cubiertas.guardia`,
`anclaje-vs-intentos.guardia`, `cierre-dia-service`, `devolucion-sla-service`,
`cierres-admin-service*`, `liberacion-reprogramada-*`, `guia-asignacion-*`, `asignacion-satelite-*`,
`reprogramacion-tienda-service`, `gestion-desde-ayuda-*`, `cierre-bloqueo-superficies`,
`deshacer-asignacion.cierre-asimetria`, `resolver-novedad-reprograma-sla`,
`cierre-aprobacion-libera-solo-lo-suyo`, `liberar-reprogramadas-route`.

---

## Mapa R → test

| R | Test |
| --- | --- |
| R1 | `mis-asignaciones-tope-intentos` 1, 2 · `gestion-desde-ayuda-tope-intentos` 1a |
| R2 | `mis-asignaciones-tope-intentos` 3.entregada / 3.rechazada / 3.incidente / 3.bis |
| R3 | `tope-intentos.test.ts` 1, 2, 3 |
| R4 | `gestion-desde-ayuda-tope-intentos` 1a (importa el **mismo símbolo** que T4) |
| R5 | `mis-asignaciones-tope-intentos` 5, 5.bis · `gestion-desde-ayuda-tope-intentos` 2, 2.bis |
| R6 | `mis-asignaciones-tope-intentos` 1 · `tope-intentos-pii.guardia` («los DOS motivos son distintos», y el de gestión enumera los tres desenlaces) |
| R7 | `mis-asignaciones-tope-intentos` 6a/6b · `guia-asignacion-tope-intentos` 4a/4b · `asignacion-satelite-tope-intentos` 4a/4b · `cierres-admin-tope-sin-gestion` (3 casos) · `tope-intentos-dto-derivado` (umbral 5) · `tope-intentos.test.ts` 4b |
| R8 | **servidor:** `tope-intentos-dto-derivado` (los dos DTO). **UI:** `GestionarOrdenPanelTope` (5 casos de presencia/ausencia + 2 contra la lista compartida) · `GestionarDesdeAyudaModalTope` (4 del modo que no abre + 1 de que «Rechazar» sí + la tabla derivada) |
| R9 | `GestionarOrdenPanelTope` → «el hueco se explica con palabras» (3) · `GestionarDesdeAyudaModalTope` → «la ventana explica el porqué» (2) |
| R10 | `tope-intentos-dto-derivado` («el UMBRAL no viaja en el DTO») · `tope-intentos.test.ts` 5 · `tope-intentos-pii.guardia` · **UI:** `intentos-entrega.test.tsx` → «276/R10» (las dos superficies, leídas sin comentarios) · `GestionarOrdenPanelTope` → «ninguna cifra» · `GestionarDesdeAyudaModalTope` → «ninguna cifra» |
| R11 | `mis-asignaciones-tope-intentos` 7, 7.bis · `gestion-desde-ayuda-tope-intentos` 3, 3.bis |
| R12 | `liberacion-reprogramada-tope` 1, 3 · 🔴 `liberacion-reprogramada-cierre-real` (los 4 casos) |
| R13 | `liberacion-reprogramada-tope` 1 (`liberarOrden` **ni se llama**) |
| R14 | `liberacion-reprogramada-tope` 4, 4.bis · 🔴 `liberacion-reprogramada-cierre-real` («la SONDA distingue la familia») |
| R15 | `liberacion-reprogramada-tope` 2, 2.bis |
| R16 | `liberacion-reprogramada-tope` 6, 6.bis, 6.ter · `liberacion-reprogramada-service` (casos vigentes de la 46) |
| R17 | `cierre-dia-service` → «276/R17» 1, 2, 3 |
| R18 | `guia-asignacion-tope-intentos` 1, 1.bis, 1.ter, 2 · `asignacion-satelite-tope-intentos` 1, 2 |
| R19 | `guia-asignacion-tope-intentos` 1 (detalle de las TRES) · `asignacion-satelite-tope-intentos` 1 |
| R20 | `asignacion-satelite-tope-intentos` 3 (ejercita **los dos** servicios y compara contra la constante) · `reprogramacion-tienda-service` → «276/Q2» |
| R21 | 🔴 `cierre-sin-gestion-tope-sql-real` 1, 3 |
| R22 | 🔴 `cierre-sin-gestion-tope-sql-real` 1b, 1c · `order-status-transiciones.guardia` → «276/R21/R22» |
| R23 | 🔴 `cierre-sin-gestion-tope-sql-real` 1d · `cierres-admin-service.aprobar.sin-gestion` → «la gestión sintética nace SIN cierre» |
| R24 | `cierres-admin-service.aprobar.sin-gestion` → «276/R24» (caso **emparejado**, feeds reales) · `cierres-admin-caja-cod` sigue verde sin tocar sus asertos de orden |
| R25 | 🔴 `cierre-sin-gestion-tope-sql-real` 2, 2b · `cierres-admin-service.aprobar.sin-gestion` → «la orden que NO llegó al umbral sigue yendo a bodega» |
| R26 | 🔴 `cierre-sin-gestion-tope-sql-real` 4 |
| R27 | 🔴 `cierre-sin-gestion-tope-sql-real` 5 · `cierres-admin-tope-sin-gestion` («al RECHAZAR no se pasa config») |
| R28 | `devolucion-sla-tope-wrong` 1 (las dos causas), 1.bis |
| R29 | `devolucion-sla-tope-wrong` 2a, 2b, 2c |
| R30 | `devolucion-sla-tope-wrong` 4, 4.bis, 4.ter, 5, 5.bis · `devolucion-sla-service` («UNA vez por CORRIDA») |
| R31 | `tope-intentos-invariante.guardia` bloque 2 («el censo cubre EXACTAMENTE», «`rechazada` no tiene salida») |
| R32 | `tope-intentos-invariante.guardia` bloque 2 («la salida de `reprogramada` sigue siendo la ÚNICA») · `liberacion-reprogramada-tope` 3 |
| R33 | `tope-intentos-invariante.guardia` bloque 1 (5 casos) |
| R34 | `anclaje-vs-intentos.guardia` → «276/R34» (3 casos) |
| R35 | `rechazo-tope-intentos-migration` («el UP es ADITIVO», «el DOWN tampoco mueve órdenes», y contra Postgres: «aplicar y revertir NO cambia el `estatus_id`») |
| R36 | `rechazo-tope-intentos-migration` («el DOWN RECREA con los 31 previos», «el DOWN EJECUTA y deja el enum como estaba», «la base sigue legible») |
| R37 | **T0 de arriba — VERIFICACIÓN HUMANA, y está a medias:** el SQL existe y corre; la ejecución contra producción es del spec (2026-08-24) y **debe repetirse antes de desplegar**. |
| R38 | `tope-intentos-pii.guardia` (los 3 textos fijos + el aviso del cron, ejercitado de verdad) |

---

## Los defectos que se inyectaron, y qué se puso rojo

Ninguna de estas líneas es una lectura del código: cada mutación se aplicó al árbol, se corrió la
suite y se revirtió.

| # | Defecto inyectado | Resultado |
| --- | --- | --- |
| 1 | Quitar la **sonda de visita real** del `select` de `findOrdenesLiberables` | 🔴 **2 rojos** en `liberacion-reprogramada-cierre-real` … y 🟢 **11 verdes** en `liberacion-reprogramada-tope`. **Esto es literalmente el motivo por el que ese test de integración es obligatorio**: la suite de dobles no ve el `select`. |
| 2 | `CIERRE_APROBADO = "aprobado"` → `"solicitado"` | 🔴 **8 rojos** (unit + integración) |
| 3 | Desactivar la puerta del tope en `MisAsignacionesService.gestionar` | 🔴 **7 rojos** |
| 4 | Desactivar la puerta del tope en `GestionDesdeAyudaService.gestionar` | 🔴 **5 rojos** |
| 5 | Desactivar las **tres** puertas de la circulación (2 bodegas + Q2) a la vez | 🔴 **11 rojos** en 3 archivos |
| 6 | Desactivar el reparto en dos destinos de `resolverCierre` (todo a bodega, como antes de la 276) | 🔴 **5 rojos** en `cierre-sin-gestion-tope-sql-real` |
| 7 | La gestión sintética entra en **ESTE** cierre (`cierreId` en vez de `null`) | 🔴 **2 rojos** |
| 8 | La rama `wrong_*` deja de mirar el contador | 🔴 **6 rojos** en `devolucion-sla-tope-wrong` |
| 9 | Añadir a mano una arista de prueba `sin_gestionar -> en_bodega_central` | 🔴 **1 rojo** en `tope-intentos-invariante.guardia`, con el mensaje que nombra la vía sin clasificar |
| 10 | `enElTope` fijo a `false` en el DTO | 🔴 **1 rojo** en `tope-intentos-dto-derivado` |

---

## Lo que el spec no preveía, y me encontré

1. **§10 del design pide algo que Prisma no deja escribir.** Decía repetir el filtro por `orden_id`
   dentro de la sonda de visita real «como hace `whereIntentosVigentes`», para entrar por
   `@@index([ordenId, createdAt])`. **En un `select` anidado eso es imposible**: no se puede
   referenciar un campo de la fila padre en el `where` de una relación. Lo que sí se sostiene es el
   motivo por el que daba igual: Prisma carga las relaciones con consultas **separadas y agrupadas**
   (`... WHERE gestion_orden_id IN ($1..$n)`), así que la sonda cuesta **una consulta por corrida
   del cron**, no una por orden. Está escrito en el propio repositorio, no solo aquí.

2. **Un `as never` en un test de integración escondía una regresión de verdad.**
   `cierre-aprobacion-libera-solo-lo-suyo.test.ts` construye su `liberacionSinGestionar` con
   `as never`, así que al crecer la config **el typecheck no dijo nada** y en runtime
   `umbralIntentos` llegaba `undefined`. Con eso, `x >= undefined` y `x < undefined` son **los dos
   `false`**, los dos conjuntos salían vacíos y **no se liberaba ninguna orden**. Lo cazó el gate
   completo, no el typecheck. Queda anotado en ese fichero, encima del cast.

3. **La guardia de escrituras de la aprobación hizo exactamente su trabajo.**
   `aprobacion-escrituras-cubiertas.guardia` se puso roja con `tx.gestionOrden.create` sin dueño
   declarado. No se relajó: la escritura entró en el censo con las **dos** suites que la nombran.

4. **Once censos del enum, no uno.** Añadir un value a `orden_historial_origen_tipo` mueve **once**
   ficheros de test que descuentan valores del SEED para comparar contra fotos históricas de
   `down.sql`. Ninguna foto se tocó. Uno de ellos (`…recoleccion-tienda-incidente…`) sobrevivió a la
   primera tanda porque su `toHaveLength(31)` va en la misma línea que su comentario.

5. **Q1 obliga a un `create` por orden, no a un `createMany`.** La fila de historial tiene que
   **enlazar** la gestión sintética (`gestionOrdenId`), y `createMany` no devuelve ids. El techo
   medido de gestiones por cierre es 14, así que el bucle es aceptable; queda dicho para que nadie
   lo «optimice» perdiendo el enlace, que es lo que permite auditar qué cobro nació de qué
   aprobación.

6. **`asignarRecoleccion` tenía un método de repo que ningún doble de esta ficha traía.** Al
   escribir el caso «la recolección NO consulta el contador» apareció `findMensajeroIdsValidos`
   (sin `ByZona`): dos métodos parecidos con alcances distintos en el mismo servicio. No se tocó;
   se anota porque es una trampa para el siguiente que escriba un doble ahí.

---

## Verificación ejecutada

```
pnpm run typecheck   → 0 errores
pnpm run lint        → 0 errores, 99 warnings (todos preexistentes: `_var` sin usar en dobles)
./init.sh (COMPLETO) → INIT_EXIT=0
```

**El gate rápido no se intentó**: el diff toca `db/migrations/`, `db/schema.prisma`, `lib/types/` y
archivos con nombre de dinero (`cierre`, `pago`, `wallet`, `ingreso`, `caja`, `cobro`). `--rapido`
se niega solo ante cualquiera de esas cuatro.

### Las cuatro corridas del gate completo

| # | Resultado | Qué salió |
| --- | --- | --- |
| 1 | `INIT_EXIT=1` | **18 rojos en 16 archivos**: los censos del enum, el punto de escritura del choke point, la guardia de escrituras de la aprobación y los dos literales de contrato que crecen. |
| 2 | `INIT_EXIT=1` | **1 rojo**: el `toHaveLength(31)` que quedaba. |
| 3 | `INIT_EXIT=0` | **1355 archivos · 18.270 tests · 26 skipped · 382 s.** |
| 4 (final) | `INIT_EXIT=0` | **1356 archivos · 18.275 tests · 26 skipped · 380 s** — sobre el árbol final, ya con `tope-intentos-dto-derivado`. |

> El `INIT_EXIT=` se escribe **dentro** del log (`/tmp/init273*.log`), no se lee del exit code que
> llega por fuera: en este repo un gate ROJO llegó una vez reportado como «exit code 0» porque un
> `echo` posterior tapó el código de salida. Y los logs **no** se canalizaron por `tail`, que trunca
> el fichero en origen y deja el rojo sin nombre.

**Baseline de `dev`:** no hizo falta medirlo. Con el gate en **verde absoluto** (0 fallos, no «los
mismos fallos que `dev`»), el delta contra cualquier baseline es 0 por construcción. El baseline se
mide cuando el gate queda rojo y hay que demostrar que ese rojo ya venía de antes.

**La base local es compartida entre worktrees**, así que la migración de T2 se aplicó antes de
correr nada (`prisma migrate deploy`, 145 migraciones, la nueva incluida). Anotado porque el efecto
va en las dos direcciones: mientras esta rama no se mergee, los gates de **otros** worktrees corren
contra una base que ya tiene el value nuevo.

---

## Las seis decisiones firmadas, y dónde viven en el código

| | Decisión | Dónde |
| --- | --- | --- |
| **Q1** | El rechazo por no gestión **SÍ cobra** | gestión sintética en `CierresAdminRepository.resolverCierre`, `resultado: "rechazada"`, `cierreId: null`, `MOTIVO_RECHAZO_TOPE_INTENTOS` |
| **Q2** | `reprogramarDesdeDevuelta` **SÍ se bloquea** | `ReprogramacionTiendaService.reprogramar`, paso 3-bis, con `MSG_TOPE_INTENTOS_ASIGNACION` |
| **Q3** | La recuperación manual **se conserva intacta** | no se tocó; declarado en el censo de `tope-intentos-invariante.guardia` con su razón |
| **Q4** | Sin causa tipificada en `rechazada` | sin cambio; el `motivo` libre sigue siendo el único registro |
| **Q5** | `rechazo_tope_intentos`, **fuera** de `ORIGEN_TIPOS_VISITA_REAL` | `lib/types/orden-historial.ts`, con dos casos que lo fijan |
| **Q6** | Sin backfill | ninguna migración mueve órdenes; T16 y el test de migración lo comprueban |

---

## Lo que queda para `frontend_dev`

El servidor ya le entrega **todo lo que necesita**: `enElTope: boolean` en `MiAsignacionDTO` y en
`NovedadDTO`, y el módulo puro `lib/types/tope-intentos.ts` con `permitidoEnElTope`, importable
desde un Client Component **sin arrastrar la configuración**.

- **T11 · `GestionarOrdenPanel.tsx`** — filtrar `RESULTADO_BOTONES` con `permitidoEnElTope` cuando
  `orden.enElTope`, y mostrar el texto que explica que a esa orden le queda el último intento.
  **«Reportar incidente» SIGUE VISIBLE** (decisión 3 del humano). Tests: `GestionarOrdenPanelTope`
  (3 casos) + ampliar `intentos-entrega.test.tsx` para que el panel no nombre
  `MIN_INTENTOS_ENTREGA` ni `reintentosConfig`.
- **T12 · `GestionarDesdeAyudaModal.tsx`** — dejar de ofrecer «Reprogramar» en el tope y decir por
  qué; el modo `reprogramar` **no se puede abrir** con `enElTope: true`. Tests:
  `GestionarDesdeAyudaModalTope`.
- **R9/R10 en la UI** — el texto no puede nombrar el número del umbral. No lo tiene: solo le llega
  el booleano.

**Lo que NO es de frontend y ya está cerrado:** las cinco puertas del servidor, la migración, el
invariante y los dos textos de rechazo. Si la UI se olvidara de filtrar un botón, el servidor
rechaza igual (R11, con sus cuatro casos).

---

## Lo que el reviewer debe mirar con lupa

1. **El `select` de `findOrdenesLiberables`.** Es la raíz de la ficha y es un `select`, no una
   regla: la única prueba que lo cubre de verdad es la de Postgres. Está medido que la suite de
   dobles se queda verde con la sonda borrada.
2. **`cierre_id NULL` de la gestión sintética.** Es lo que hace que el cobro caiga en el
   **siguiente** cierre y no en el que se está aprobando. Ponerle el `cierreId` de este cierre
   mueve dinero de un cierre cuyo snapshot ya se congeló.
3. **El mensajero que el `updateMany` del rechazo CONSERVA.** No es un olvido: es lo que hace que
   el bloque de la 139 lleve la orden a `por_devolver*` en la misma tx. Limpiarlo la deja en
   `rechazada` sin nadie que la mueva.
4. **R37 sigue a medias.** La consulta está escrita y probada; la ejecución contra producción no la
   pude hacer. Es bloqueante de **despliegue**.
5. **La rama `wrong_*` adelanta un cobro.** Es la primera vez que este sistema lo hace. El
   argumento (mismo desenlace, hasta 5 días antes) está en el código; la dirección del error ya no
   es «no cobrar».

---

## Estado

**Backend de la 276: completo y verde.** Frontend pendiente (T11/T12). R37 pendiente de
re-ejecución contra producción **antes de desplegar**.

---

## ⚠️ COLISIÓN DE IDS DETECTADA AL CERRAR — no la resuelvo yo

Al hacer el `git fetch` final (2026-08-24, después del gate), `origin/dev` había pasado de
`e93c19e6` a **`821a6afe`**, y en ese avance **otra sesión registró los ids 276, 277 y 275 para
features distintas**:

| id | en `origin/dev` (821a6afe) | en esta rama |
| --- | --- | --- |
| **276** | tarifas ligadas a la zona: modelo, borrado físico y catálogo de vehículos · `in_progress` | **el tope de intentos** · `in_progress` |
| **277** | cobro por zona + tienda: cascada de resolución de tarifa · `pending` | «Por recoger» separa en tabs · `in_progress` |
| **275** | configuración de tarifas · `pending` | — |

Existe además la rama remota `origin/feature/276-tarifas-por-zona-catalogo-vehiculos` (el nombre de
rama **no** choca con `feature/276-tope-de-intentos`; lo que choca son los **ids**). En `origin/dev`
todavía **no** hay carpeta `specs/276-*`.

**Por qué no lo toco:** renumerar arrastra la carpeta del spec, el nombre de la rama, los nueve
mensajes de commit y decenas de comentarios que citan «276» dentro del código y de los tests. Es una
decisión del leader —y el precedente de este repo es explícito: la propia ficha 218 lleva escrito
que la renumeraron «porque otra sesión tomó ese id en `dev` mientras esta ficha se escribía, y `dev`
manda»—.

**Lo que sí hay que saber para decidir:** el merge a `dev` va a dar conflicto en
`feature_list.json` sí o sí, y resolverlo «a favor de los dos» dejaría **dos features distintas con
el id 276**. La implementación de esta rama es coherente consigo misma; lo único que hay que
reasignar es la etiqueta.

---

## Renumerado 273 → 276 (2026-08-24), y lo único que NO se renumeró

Otra sesión registró 273/274/275 para las fichas de tarifas mientras ésta se escribía, y **mergeó su
273 en `dev`**. `dev` manda —mismo precedente que la 218, renumerada desde 216 por esto— así que se
movió ésta. Se renumeraron los **96 archivos** que citaban la ficha: código, tests, specs, la ficha
en `feature_list.json` y esta bitácora.

**Los comentarios de `db/migrations/20260824120000_orden_historial_origen_rechazo_tope_intentos/`
siguen diciendo «feature 273», y es deliberado.** Editar el SQL de una migración **ya aplicada**
cambia su checksum, y en este repo eso ya produjo drift: lo añadido después no llega nunca a la base
que la aplicó. Un comentario con el número viejo es barato; un checksum roto no. El nombre de la
carpeta no lleva número de ficha, así que no hay nada más que tocar ahí.

Los mensajes de los commits anteriores siguen diciendo `273`: son historia y no se reescriben.

---
---

# Feature 276 — bitácora de implementación (FRONTEND: T11 y T12)

> Misma rama `feature/276-tope-de-intentos`. **Alcance: la capa de presentación y nada más.** No se
> tocó ningún servicio, ningún repositorio, ninguna Server Action, ninguna migración ni ningún tipo
> de `lib/`. Lo que el servidor entregaba —`enElTope` en los dos DTO y el módulo puro
> `lib/types/tope-intentos.ts`— se consumió tal cual: **no se derivó nada nuevo ni se añadió
> contrato**.

## T11 · El panel del mensajero

`app/(app)/mis-asignaciones/_components/GestionarOrdenPanel.tsx`:

- el juego de desenlaces sale ahora de `botonesDeResultado(enElTope)`, que filtra
  `RESULTADO_BOTONES` **completo** con `permitidoEnElTope` y sólo después lo parte en los dos
  bloques visuales (la grilla y el incidente aparte de la 158/R33). Se filtra antes de partir a
  propósito: el día que un desenlace cambie de bloque, la regla del tope lo sigue alcanzando;
- aparece `TOPE_INTENTOS_NOTA` encima de la grilla, con `role="note"` (R9). No es `alert`: no es la
  consecuencia de un error del mensajero, es la condición de esa orden;
- **«Reportar incidente» sigue visible.** Es la decisión 3 del humano y tiene su propio caso rojo
  (mutación 4, más abajo): si alguien lo filtrara, tres asertos caen.

Las dos constantes de módulo `RESULTADO_BOTONES_NORMALES` / `_APARTE` desaparecen —las sustituye la
función— y el bloque del incidente pasa a colgar de que **quede algo que ofrecer**: hoy esa
condición no se cumple nunca, y está para que no quede un separador con un aviso y ningún botón.

## T12 · La ventana de la tienda

`app/(app)/novedades/_components/GestionarDesdeAyudaModal.tsx`: con `orden.enElTope` y un
`resultado` que la lista de inclusión no admite, **el modo no se abre**. No es un confirmar apagado:
no se monta el campo de fecha, ni el motivo, ni el selector de fotos, ni el botón de confirmar. Lo
único que queda es la nota (`GESTION_AYUDA_TOPE_NOTA`) y la salida («Entendido»).

Por qué así y no con un confirmar deshabilitado: en esta ventana **la evidencia es obligatoria
también al reprogramar** (237/D2). Dejarla abrir significaría que la tienda busca la captura de la
conversación con el cliente, la adjunta, escribe el motivo, elige fecha… y **entonces** recibe el
`conflict`. La guarda del servidor (T5) sigue estando y sigue siendo la de verdad; lo que esto
ahorra es el trabajo tirado.

## Archivos

**Producción (2, los dos de presentación):**
`app/(app)/mis-asignaciones/_components/GestionarOrdenPanel.tsx` ·
`app/(app)/novedades/_components/GestionarDesdeAyudaModal.tsx`

**Tests nuevos (2):** `tests/components/GestionarOrdenPanelTope.test.tsx` (12 casos) ·
`tests/components/GestionarDesdeAyudaModalTope.test.tsx` (12 casos)

**Test ampliado (1):** `tests/unit/components/intentos-entrega.test.tsx` (+3 casos, «276/R10»)

## Los defectos que se inyectaron, y qué se puso rojo

Cada mutación se aplicó al árbol, se corrió la suite afectada y se revirtió con `git checkout`.
Ninguna línea de esta tabla es una lectura del código.

| # | Defecto inyectado | Resultado |
| --- | --- | --- |
| 1 | El panel ignora `enElTope`: `const visibles = RESULTADO_BOTONES` | 🔴 **3 rojos** en `GestionarOrdenPanelTope` (el caso literal y los dos que comparan contra la lista compartida) |
| 2 | Se borra la nota de R9 del paso de resultados | 🔴 **3 rojos** (los dos del texto y el de «ninguna cifra», que ya no encuentra el nodo) |
| 3 | La nota dice «llevas 2 de 3 intentos» (R10 roto) | 🔴 **2 rojos**: el literal y el de «ninguna cifra» |
| 4 | El filtro del tope se lleva también «Reportar incidente» | 🔴 **3 rojos**, uno de ellos el que nombra la decisión 3 del humano. `GestionarOrdenPanelIncidente` sigue **verde** (su fixture no está en el tope): sin el archivo nuevo, esa regresión pasaba entera |
| 5 | `orden.enElTope === true` → `!== false` (el campo ausente se lee como tope) | 🔴 **3 rojos**: el de no-regresión del fixture viejo **y dos de `GestionarOrdenPanelIncidente`**, que es exactamente la flota que se quedaría sin poder reprogramar |
| 6 | El modal deja de bloquear (`bloqueadoPorTope = false`) | 🔴 **8 rojos** en `GestionarDesdeAyudaModalTope`; `GestionarDesdeAyudaModal` (el de la 237) sigue verde, como debe |
| 7 | El modal bloquea **los dos** modos en el tope | 🔴 **2 rojos**: «Rechazar sigue abriéndose» y la tabla derivada de la lista compartida |
| 8 | El modal re-deriva la regla importando `reintentosConfig` y comparando intentos | 🔴 **1 rojo** en `intentos-entrega` → «276/R10» |

Las mutaciones 4, 5 y 7 son las que importan de verdad: las tres dejan la pantalla **plausible**
—no rompen ningún flujo, no lanzan nada— y las tres cambian lo que el mensajero o la tienda pueden
registrar sobre una orden que ya no admite otro intento.

## Verificación

```
pnpm run typecheck   → 0 errores
pnpm run lint        → 0 errores (los warnings son los preexistentes)
./init.sh (COMPLETO) → INIT_EXIT=0 · 1358 archivos · 18.302 tests · 26 skipped · 566 s
```

- El `INIT_EXIT=` se escribe **dentro** del log: `$?` se captura en la línea siguiente a `init.sh`,
  antes de cualquier `echo`. Y el log **no** se canaliza por `tail`, que trunca en origen.
- **El rápido no se intentó**: el diff de la rama toca `db/migrations/`, `db/schema.prisma` y
  `lib/types/`, así que `--rapido` se niega solo.
- **Baseline:** la corrida final del backend fue **1356 archivos · 18.275 · 26 skipped**; ésta,
  **1358 · 18.302 · 26 skipped**. La diferencia son exactamente **+2 archivos y +27 casos**, que son
  los que esta tanda añade (12 + 12 + 3). **Cero fallos**, así que el delta contra cualquier
  baseline es 0 por construcción.
- **Primera corrida: `INIT_EXIT=1`**, y conviene dejar escrito por qué. El mock del test nuevo del
  modal traía una clave (`estado`) que `GestionarDesdeAyudaResult` no tiene: `vitest run` sobre el
  archivo suelto pasa en verde **porque no type-checkea**, y sólo el gate lo cazó. Corregido en su
  propio commit.
- `pnpm run db:generate` se corrió **antes** de las dos corridas: el cliente de Prisma se comparte
  entre ramas en esta máquina.

## Lo que me encontré y el spec no preveía

1. **Un `next` con barra y asterisco dentro de un comentario de LÍNEA trunca el archivo para las
   guardias.** El quitador único del repo (`quitarComentarios`, feature 209) hace **primero** la
   pasada de bloque: un `/*` escrito dentro de un `//` abre un comentario que se come **todo** hasta
   el siguiente `*/`, decenas de líneas más abajo. Lo escribí en los dos componentes al explicar que
   el módulo es puro, y el efecto medido fue que el `import` de `tope-intentos` **desaparecía** del
   texto que ve cualquier guardia que escanee ese archivo. No falla ruidosamente: el censo ve menos
   y su verde se lee igual que el bueno. Lo cazó el caso positivo
   (`expect(codigo).toContain("@/lib/types/tope-intentos")`), que estaba ahí como anti-vacuidad —y
   sin él, los tres `not.toContain` de al lado habrían pasado sobre un archivo mutilado—. Los dos
   comentarios se reescribieron sin abrir bloque. **`lib/types/tope-intentos.ts` no tiene el
   problema**: allí la misma frase vive dentro de un bloque `/** … */`, así que es texto y no abre
   nada (medido: su código sobrevive entero a la pasada).
2. **`role="note"` es el selector de los tests, y eso pide vigilancia.** Los dos componentes ya
   usaban ese rol para otros avisos (el precio de la 237, la lista de lo que falta). En las ramas
   que estos tests ejercen no coinciden dos, pero un `getByRole("note")` se rompería el día que se
   añada otro en el mismo paso: queda dicho para que ese rojo se lea como lo que sería —ambigüedad
   del selector, no regresión de la regla—.

## Lo que NO hice, y hay que decidirlo con esto delante

**La fila de `/novedades` sigue ofreciendo el botón «Reprogramar» sobre una orden en el tope**; lo
que para es la ventana al abrirse. El spec (T12) pide exactamente eso —«`GestionarDesdeAyudaModal`
deja de ofrecer «Reprogramar» en el tope», y su «hecho cuando» son casos de ese modal—, así que no
amplié el alcance por mi cuenta. Lo que costaría hacerlo también en la fila, y por qué no es gratis:

- el juego de botones sale de `ACCIONES_POR_GRUPO`, **una tabla indexada por grupo** que la 236 creó
  justamente para que no volviera a haber condiciones sueltas dentro de `NovedadAcciones` (su
  defecto medido: «Habilitar» apareciendo donde no debía). Filtrar por `enElTope` ahí es una
  decisión **por fila**, que la tabla no modela;
- el coste de no hacerlo es **un clic y una ventana que se cierra**. No se sube ninguna evidencia,
  no nace ninguna gestión y no se mueve un céntimo: la ventana no monta el formulario.

Si el humano prefiere que el botón tampoco aparezca, es una ficha corta y con dueño claro (el
catálogo de acciones), no un parche dentro del componente.

## Lo que el reviewer debe mirar

1. **Que la UI no reimplanta la regla**: los dos componentes llaman a `permitidoEnElTope` y ninguno
   compara números. Medido por las mutaciones 1, 6 y 8.
2. **Cada ausencia con su presencia.** Todos los casos negativos de los dos archivos nuevos
   comprueban en el mismo caso que el render ocurrió; sin eso, un `queryBy…` pasa sobre un árbol
   vacío. La mutación 4 lo enseña al revés: `GestionarOrdenPanelIncidente` se queda **verde** con el
   incidente borrado del tope.
3. **`enElTope === true`, no `!== false`.** El DTO lo declara opcional por el patrón aditivo; leer la
   ausencia como «en el tope» dejaría sin reprogramar a media flota (mutación 5).
4. **Los textos de R9 se escriben a mano en los tests**, nunca contra la constante importada. Lo que
   sí se importa es la lista compartida, y sólo donde el punto del caso es denunciar una divergencia.
5. **El botón de la fila de `/novedades`** (sección de arriba): es lo único de la superficie de la
   tienda que queda sin cerrar, y es una decisión declarada, no un olvido.

## Estado

**T11 y T12: completos y verdes.** Con esto, la 276 tiene su UI cerrada; lo único que sigue
pendiente de la ficha es lo que ya decía el backend: **R37 se vuelve a ejecutar contra producción
inmediatamente antes de desplegar**.
