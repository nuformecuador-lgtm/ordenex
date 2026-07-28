# Feature 149 — Bitácora de implementación (BACKEND, F0–F5)

> Rama `feature/149-deshacer-asignacion`, worktree `ordenex-wt-149`, desde `origin/dev @ 55b0cd4`.
> Alcance de esta bitácora: **F0, F1, F2, F3, F4 y F5** de `specs/149-deshacer-asignacion/tasks.md`,
> **más T6.3** (bucket `asignadas` del módulo satélite, §8: es backend puro y el `frontend_dev`
> paró correctamente en ella). El resto de F6 (UI) es del `frontend_dev`; F7 es del reviewer/leader.

---

## 1. Estado de las tasks

| Bloque | Tasks | Estado |
| --- | --- | --- |
| F0 — BD y dominio | T0.1–T0.5 | ✅ todas |
| F1 — Tests de guardia | T1.1–T1.3 | ✅ todas |
| F2 — Capa de datos | T2.1–T2.3 | ✅ todas |
| F3 — Servicio | T3.1–T3.3 | ✅ todas |
| F4 — Tests de servicio y borde | T4.1–T4.14 | ✅ todas |
| F5 — Integración | T5.1, T5.2 | ✅ todas |
| F6 — UI | T6.1, T6.2, T6.4, T6.5 | ✅ `frontend_dev` |
| F6 — UI | **T6.3** (bucket `asignadas`) | ✅ **backend_dev** (2.ª pasada, ver §8) |
| F7 — Cierre | T7.1, T7.2 | ⛔ fuera de alcance (reviewer/leader) |

---

## 2. Archivos creados / modificados

### Migración
- `db/migrations/20260728120000_orden_historial_origen_deshacer_asignacion/migration.sql` **[NUEVO]**
  — `ALTER TYPE "orden_historial_origen_tipo" ADD VALUE IF NOT EXISTS 'deshacer_asignacion'`, **sola
  en su transacción** (Postgres 55P04), patrón exacto de `cancelacion_api` (106) y
  `devolucion_rechazada` (139).
- `db/migrations/.../down.sql` **[NUEVO]** — recrea el enum con los **22** valores previos + `USING`
  + `DROP TYPE ..._old`. Falla RUIDOSAMENTE si ya existe alguna fila con el valor nuevo (correcto:
  no se borra rastro de auditoría).

**Verificado contra la DB local (`localhost:5432/ordenex`), no solo por regex:**
`prisma migrate deploy` → aplicada; `pnpm db:rollback` → revertida en verde; `migrate deploy` de
nuevo → `Database schema is up to date!`.

### Dominio
- `db/schema.prisma` **[MOD]** — enum `OrdenHistorialOrigenTipo` + `deshacer_asignacion`.
- `lib/types/orden-historial.ts` **[MOD]** — `ORDEN_HISTORIAL_ORIGEN_TIPO_SEED` (23.º valor) y
  comentario que justifica por qué **NO** entra en `ORIGEN_TIPOS_CON_GESTION` (nunca enlaza gestión;
  destino nunca `devuelta`).
- `lib/types/order-status-transiciones.ts` **[MOD]** — aristas **#43** `por_recoger →
  en_bodega_central`, **#44** `por_recoger → en_bodega_satelite`, **#45**
  `en_ruta_bodega_satelite → en_bodega_central`, todas vía `deshacer_asignacion`. Ninguna hacia
  `en_fulfillment`/`en_preparacion`.

### Capa de datos
- `lib/interfaces/repositories/IOrdenHistorialRepository.ts` **[MOD]** — `OrigenReversionItem` +
  `findOrigenesReversion`.
- `lib/repositories/OrdenHistorialRepository.ts` **[MOD]** — `findOrigenesReversion`: `DISTINCT ON
  (orden_id)`, `ORDER BY orden_id, created_at DESC, id DESC`, `LEFT JOIN order_status`, pares
  parametrizados por `VALUES`. UNA consulta por lote.
- `lib/interfaces/repositories/IOrdenRepository.ts` **[MOD]** — `DeshacerAsignacionItem`,
  `DeshacerAsignacionConflictoError` y la firma de `deshacerAsignacionLote`.
- `lib/repositories/OrdenRepository.ts` **[MOD]** — `deshacerAsignacionLote` (ver §4).
- `lib/services/mensajes-deshacer-asignacion.ts` **[NUEVO]** — motivos tipados. **Sin** constante de
  «mensajero bloqueado por cierre»: ese motivo no existe en esta feature (Q1).

### Servicio y borde
- `lib/interfaces/services/IDeshacerAsignacionService.ts` **[NUEVO]**.
- `lib/services/DeshacerAsignacionService.ts` **[NUEVO]**.
- `lib/actions/deshacer-asignacion.ts` **[NUEVO]** — Server Action, zod en el borde.

### Tests nuevos
- `tests/unit/domain/orden-historial-origen-149.test.ts`
- `tests/unit/repositories/orden-historial-origenes-reversion.test.ts`
- `tests/unit/repositories/orden-repository.deshacer-asignacion.test.ts`
- `tests/unit/services/deshacer-asignacion-service.test.ts`
- `tests/unit/services/deshacer-asignacion.cierre-asimetria.test.ts`
- `tests/unit/actions/deshacer-asignacion.action.test.ts`
- `tests/integration/repositories/deshacer-asignacion.historial.test.ts`

### Tests ajenos tocados (y por qué)
| Archivo | Qué cambió | Por qué |
| --- | --- | --- |
| `tests/fixtures/inventario-transiciones-140.ts` | +3 filas (#43/#44/#45); `RECUENTO_INVENTARIO` 43→**46** aristas y 39→**42** pares | Las 3 aristas son pares NUEVOS. Transcritas A MANO, no derivadas del mapa. |
| `tests/unit/domain/order-status-transiciones.guardia.test.ts` | `["por_recoger","en_bodega_satelite"]` **sale** de los pares ilegales (ahora es #44) y entra `["por_recoger","en_preparacion"]`; título del conteo; bloque «REGRESIÓN 149» | Previsto en `design.md` §2. **La guardia NO se relajó**: sigue fallando CERRADO; lo que cambió es el inventario. |
| `tests/unit/types/orden-historial-types.test.ts` | SEED esperado 22→**23** | Censo del enum. |
| `tests/unit/repositories/orden-historial-cobertura.test.ts` | Punto **#23** del mapa de call-sites (`OrdenRepository.deshacerAsignacionLote`), 22→23 | Censo del choke point: un writer de estado nuevo DEBE registrarse ahí. |
| `tests/integration/db/{gestion-orden-anulacion,orden-historial-origen-recepcion-bodega-central,orden-historial-origen-tipo-cancelacion-api,orden-historial-origen-tipo-resolver-novedad,orden-historial-origen-tipo-sla-devuelta}-migration.test.ts` | `deshacer_asignacion` entra en el set «AÑADIDOS EN O DESPUÉS DE la feature X» | Deuda conocida del arnés: cada `down.sql` histórico recrea el enum a un estado FIJO y se compara contra el SEED vivo. Mismo patrón que aplicó la 139. |
| `tests/integration/db/zonas-migration.test.ts` | La migración nueva entra en la denylist del invariante de timestamps | Deuda conocida del arnés (precedente: feature 141). |
| `tests/unit/services/{orden-service,asignacion-mensajero-service,bulk-orden-service,bulk-orden-service.carga-api,rol-admin-satelite-authz}.test.ts` | `deshacerAsignacionLote` añadido a los dobles de `IOrdenRepository` | La interfaz creció; son dobles COMPLETOS. |

---

## 3. Decisiones del gate honradas (no reabiertas)

- **Q1 (R19) — asimetría asignar/deshacer.** `deshacerAsignacionLote` **no** lleva
  `NOT EXISTS ... cierre_dia` y el `Pick<IOrdenRepository, ...>` del service **no incluye**
  `findMensajerosBloqueados` (consultar el gate por descuido no compila). El gate sigue VIGENTE en
  `generarGuia`, `asignarDesdeBodega` y `asignarSateliteLote`: intactos.
  Test dedicado: `deshacer-asignacion.cierre-asimetria.test.ts`.
- **Q2 (R30) — `prioridad` no se restaura.** El `SET` del UPDATE no menciona `prioridad` ni
  `num_guia`; la AUSENCIA es el mecanismo y está aserta.
- **Q5 (R41) — aviso al mensajero DIFERIDO a la 146.** No se implementó notificación alguna.
- **R13 — fallo CERRADO.** Sin fila de historial, con origen `NULL` o con un origen fuera de la
  tabla de normalización, la orden se rechaza con `conflict`. Nunca se adivina un destino, y en
  particular **nunca** se deriva de la zona (alternativa A, vetada).

---

## 4. Deuda diferida a la feature 146 — ANCLA

```
Archivo : lib/repositories/OrdenRepository.ts
Función : OrdenRepository.deshacerAsignacionLote
Marca   : comentario literal `TODO(146)`, dentro de la $transaction, JUSTO DESPUÉS de
          appendCambioEstado y ANTES del `return`.
Insumo  : el pre-read del lote (`mensajeroPrevioPorOrden`) ya captura el
          `mensajero_asignado_id` PREVIO al UPDATE (que lo pone a NULL): la 146 tiene el
          destinatario sin rehacer la consulta.
Guardia : `tests/unit/repositories/orden-repository.deshacer-asignacion.test.ts`, bloque
          «R41 (T4.14b) — ancla TODO(146)», lee el propio fuente. Borrar el ancla ROMPE la suite.
```

Búsqueda para la 146: `rg "TODO\(146\)"`.

---

## 5. Matriz de trazabilidad R → test REAL

| R | Archivo | Bloque / test |
| --- | --- | --- |
| R1 | `tests/unit/services/deshacer-asignacion-service.test.ts` | `T4.1/R1/R2/R3 — autorizacion por rol` |
| R2 | idem | `%s -> forbidden, sin llamar a NINGUN writer ni lector de ordenes` |
| R3 | idem | `%s revierte y no queda acotado por zona (R3)` |
| R4 | idem | `R4: una orden de zona ajena en el lote -> forbidden del LOTE COMPLETO, 0 escrituras` |
| R5 | idem | `R5: destino derivado 'en_bodega_central' con actor adminSatelite -> forbidden` |
| R6 | idem | `R6: adminSatelite sin zona -> sin_zona, sin leer ordenes` |
| R7 | `tests/unit/actions/deshacer-asignacion.action.test.ts` | `R7 — sin sesion` (2 casos) |
| R8 | `tests/unit/services/deshacer-asignacion-service.test.ts` + `tests/unit/repositories/orden-repository.deshacer-asignacion.test.ts` | `T4.3/R8/R9 — caso (a)` + `un UPDATE por orden, guardado por estado de origen...` (`"mensajero_asignado_id" = NULL`) |
| R9 | idem | idem (`"asignado_at" = NULL`) |
| R10 | `deshacer-asignacion-service.test.ts` | `T4.4/R10 — caso (b): orden en en_ruta_bodega_satelite` |
| R11 | idem | `R11: la derivacion consulta el HISTORIAL con el estado actual de cada orden` + caso testigo |
| R12 | idem | `origen %s -> destino %s (tabla CERRADA de D3')` (4 casos) |
| R13 | idem | `T4.6/R13 — fallo CERRADO` (4 casos) |
| R14 | idem | `R14: destino en_bodega_central con orden NO central -> conflict` |
| R15 | idem | `R15: destino en_bodega_satelite con orden central -> conflict` |
| R16 | idem | `T4.8/R16` (7 estados: en_ruta, en_bodega_satelite, entregada, reprogramada, devuelta, rechazada, sin_gestionar) |
| R17 | idem | `R17: orden borrada -> conflict 'orden borrada'` |
| R18 | idem | `R18: id inexistente -> conflict 'orden no existe'` |
| R19 | `tests/unit/services/deshacer-asignacion.cierre-asimetria.test.ts` | `T4.9(a)` (deshacer → `ok`, sin invocar el gate) y `T4.9(b)` (asignar → `conflict`); + `orden-repository.deshacer-asignacion.test.ts` › `R19 (Q1 CERRADA): el UPDATE NO lleva guarda de cierre_dia` |
| R20 | `deshacer-asignacion-service.test.ts` + repo test | `R20: lote de 3 con una invalida -> 0 escrituras` + `lanza DeshacerAsignacionConflictoError...` |
| R21 | idem | `R21: carrera (el writer lanza) -> conflict con detalle por orden` |
| R22 | `deshacer-asignacion.action.test.ts` | `R22 — motivo obligatorio (10..300 tras recortar)` (5 inválidos + 2 bordes + recorte) |
| R23 | `tests/integration/repositories/deshacer-asignacion.historial.test.ts` | `R23/R31 — EXACTAMENTE una fila de historial por orden, con motivo` |
| R24 | `deshacer-asignacion.action.test.ts` | `R24 — UN motivo por invocacion, para todas las ordenes del lote` |
| R25 | `tests/unit/domain/orden-historial-origen-149.test.ts` | `R25 — 'deshacer_asignacion' es un tipo de origen PROPIO` |
| R26 | idem | `R26 — 'deshacer_asignacion' NO entra en ORIGEN_TIPOS_CON_GESTION` |
| R27 | `tests/unit/domain/order-status-transiciones.guardia.test.ts` + integración | `REGRESION 149/R27: las TRES aristas ... son LEGALES`, `el inventario de flujo tiene las 46 aristas y 42 pares unicos`, `el mapa declara exactamente las aristas del inventario` + `T5.2/R27 — la guardia REAL de la 140 acepta las TRES aristas nuevas` |
| R28 | guardia test + integración | `REGRESION 149/R28: %s -> %s sigue siendo ILEGAL` (7 pares) + `R28: un destino NO declarado ... sigue siendo ilegal` |
| R29 | `orden-repository.deshacer-asignacion.test.ts` | `R29/R30 (T4.12): el SET NO menciona num_guia ni prioridad` |
| R30 | idem | idem |
| R31 | integración | `R23/R31 — EXACTAMENTE una fila de historial por orden, con motivo` |
| R32 | integración | `R32 — el webhook de estado se encola en la MISMA transaccion` |
| R33 | integración | `R33: si el append revierte la tx...` y `R33: una orden que pierde la carrera...` |
| R34 | `tests/unit/components/deshacer-asignacion.ui.test.tsx` | T6.5 (`frontend_dev`) |
| R35 | `tests/unit/services/recepcion-satelite-asignadas.test.ts` (**service, T6.3**) + T6.5 (UI) | `T6.3/R35 — el modulo satelite lista las 'por_recoger' de SU zona` (7 casos: clasificación, scoping server-side, R36, no-contaminación de los 5 buckets previos, sin zona, 2 roles) |
| R36 | idem + T6.5 | `R36: una 'en_ruta_bodega_satelite' NO cae en 'asignadas'` |
| R37–R39 | `deshacer-asignacion.ui.test.tsx` | T6.5 (`frontend_dev`) |
| R40 | `deshacer-asignacion-service.test.ts` | `T4.13/R40 — ningun motivo expone UUIDs ni datos del destinatario` |
| R41 | `deshacer-asignacion-service.test.ts` + repo test | `T4.14(a)/R41 — esta feature NO notifica al mensajero desasignado` + `R41 (T4.14b) — ancla TODO(146)` |

---

## 6. Números REALES (medidos en este worktree, no estimados)

```
$ pnpm typecheck
> tsc --noEmit
(sin salida)                                   → 0 errores   [baseline: 0]   delta 0

$ pnpm lint
✖ 154 problems (0 errors, 154 warnings)        → 0 errores   [baseline: 145 warnings, 0 errores]
   +9 warnings, TODOS del tipo `'_args'/'_input' is defined but never used` en los dobles
   tipados de los tests nuevos (mismo patrón ya presente en api-key-repository.test.ts).

$ pnpm test
 Test Files  525 passed (525)
      Tests  5420 passed (5420)
   Duration  411.04s
                                               → 0 fallos    delta de fallidos = 0

$ npx prisma migrate deploy   → migración aplicada en verde
$ pnpm db:rollback            → down.sql revertido en verde
$ npx prisma migrate status   → "Database schema is up to date!"
```

---

## 7. Pendiente / notas para quien siga

1. **F6 cerrada**: T6.1/T6.2/T6.4/T6.5 por el `frontend_dev` y **T6.3 por el backend** (§8).
   R34–R39 ya tienen test. Queda F7 (cierre del reviewer/leader).
2. **Desviación menor y consciente respecto de `design.md` §1**: el catálogo de estados
   (`findEstatusIdByValue`) se resuelve en el paso 5 y no en el 8, porque `findOrigenesReversion`
   necesita el `estatus_id` ACTUAL de cada orden y no su `value`. El orden de las GUARDAS de negocio
   no cambia, y `validation_error` por seed incompleto sigue ocurriendo antes de cualquier escritura.
3. **Un `UPDATE` por orden** (no uno con `IN (...)`): el destino es POR ORDEN (cada una vuelve a la
   bodega de la que salió). Todos dentro de UNA sola `$transaction`.


---

## 8. Cierre de T6.3 — bucket `asignadas` del módulo satélite (2.ª pasada del backend)

El `frontend_dev` cerró F6 salvo T6.3 y paró bien: exige `lib/services`, que es backend. La
sección «Asignadas (por recoger)» del módulo existía pero se renderizaba VACÍA. Se implementó
respetando el contrato que dejó en `progress/impl_149_frontend.md` §4 (prop opcional
`asignadas?: RecepcionSateliteDTO[]`), sin obligarlo a rehacer UI.

### Cambios
| Archivo | Cambio |
| --- | --- |
| `lib/services/RecepcionSateliteService.ts` | `const ESTADO_ASIGNADA = "por_recoger"`; añadido a `findRecepcionSateliteByZona(zonaId, [...])`; bucket `asignadas` en el MISMO bucle de clasificación; `asignadas: []` en la rama `sinZona` |
| `lib/interfaces/services/IRecepcionSateliteService.ts` | `asignadas: RecepcionSateliteDTO[]` en `ListarRecepcionSateliteServiceResult` |
| `lib/types/recepcion-satelite.ts` | `asignadas` en `ListarRecepcionSateliteResult` (el tipo que reenvía la Server Action) |
| `app/(app)/recepcion-satelite/page.tsx` | `asignadas={result.asignadas}` al módulo |
| `tests/unit/services/recepcion-satelite-asignadas.test.ts` **[NUEVO]** | 7 casos (ver matriz, R35/R36) |
| `tests/unit/services/recepcion-satelite-service.test.ts` | la aserción del contrato de `findRecepcionSateliteByZona` pasa de CINCO a SEIS estados; `asignadas: []` en el caso `sinZona` |
| `tests/unit/actions/recepcion-satelite-action.test.ts`, `tests/components/RecepcionSatelitePage.test.tsx` | dobles del service completados con `asignadas: []` |

**Sin cambios en repo ni DTO**: `findRecepcionSateliteByZona(zonaId, estatusValues)` ya acepta N
estados y `RecepcionSateliteRow`/`RecepcionSateliteDTO` ya traen todo lo que la tabla renderiza.
Cero consultas nuevas: es el MISMO `findMany`, con un `value` más en el `IN`.

### Scoping por zona (decisión D1)
- La zona sale de `repo.findUsuarioZonaId(actor.usuarioId)` (SERVER-SIDE): el cliente no la elige,
  no hay parámetro por el que pasarla. Aserto: `findUsuarioZonaId` recibe el `usuarioId` del actor
  y el ÚNICO argumento de zona de `findRecepcionSateliteByZona` es el resuelto ahí.
- El repo filtra `where: { zonaId, deletedAt: null, estatus: { value: { in: [...] } } }`: una orden
  de otra zona no puede aparecer en el bucket.
- `rol !== adminSatelite` → `forbidden` ANTES de resolver zona o leer órdenes.
- `adminSatelite` sin zona → `asignadas: []` y CERO consultas de órdenes.
- **Defensa en profundidad**: aunque el listado se filtrara mal, ejecutar la reversión pasa por
  `DeshacerAsignacionService` (rol + zona propia + destino derivado obligado a
  `en_bodega_satelite`, R4/R5) y por la guarda `zona_id` repetida en el `WHERE` del `UPDATE`
  (R21). Listar y ejecutar están acotados por el MISMO criterio, resuelto en el mismo sitio.
- **R36**: `en_ruta_bodega_satelite` NO entra en `asignadas` — sigue en `porRecibir`, sin acción
  de deshacer: el caso (b) es competencia de la bodega central.

### Números tras T6.3 (medidos)
```
$ pnpm typecheck  → 0 errores                            [baseline post-frontend: 0]        delta 0
$ pnpm lint       → 0 errores, 154 warnings              [baseline post-frontend: 154]      delta 0
$ pnpm test       → 527 archivos / 5458 tests, 0 fallos  [baseline: 526 / 5450, 0 fallos]
                    +1 archivo, +8 tests, delta de fallidos = 0
```
