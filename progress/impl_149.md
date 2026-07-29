# Feature 149 — Deshacer asignación a mensajero o bodega antes de la recogida

> **Bitácora CONSOLIDADA de implementación (T7.2).** Rama `feature/149-deshacer-asignacion`,
> worktree `ordenex-wt-149`, desde `origin/dev @ 55b0cd4`.
> Cubre las siete fases del `tasks.md` (F0–F7). El detalle por bloque vive en las dos bitácoras
> parciales, que se conservan: `progress/impl_149_backend.md` (F0–F5 + T6.3) y
> `progress/impl_149_frontend.md` (F6). El veredicto del review está en `progress/review_149.md`.

---

## 1. Qué hace la feature

Revierte la ÚLTIMA transición de asignación/ruteo de una orden, devolviéndola a la bodega de la
que salió, **mientras el paquete no se haya movido físicamente**:

| Caso | Estado actual | Destino | Quién |
| --- | --- | --- | --- |
| (a) central | `por_recoger` | `en_bodega_central` | maestro/admin |
| (a) satélite | `por_recoger` | `en_bodega_satelite` | maestro/admin + `adminSatelite` de esa zona |
| (b) | `en_ruta_bodega_satelite` | `en_bodega_central` | maestro/admin |

Dos invariantes que definen el diseño:

1. **El destino se DERIVA del historial**, jamás de la zona (§7-A del design, alternativa vetada):
   se lee la fila más reciente cuyo destino es el estado actual y se toma su origen, normalizado
   por una tabla CERRADA. Si no se puede derivar, la orden se **rechaza** (fallo cerrado): nunca
   se adivina un destino.
2. **Todo-o-nada por lote**: una sola orden rechazada, o que pierda la carrera de escritura,
   revierte la transacción entera. Sin efectos parciales, ni en estado, ni en mensajero, ni en
   historial, ni en webhooks.

---

## 2. Estado de las tasks (F0–F7)

| Bloque | Tasks | Autor | Estado |
| --- | --- | --- | --- |
| F0 — BD y dominio | T0.1–T0.5 | backend | ✅ |
| F1 — Tests de guardia | T1.1–T1.3 | backend | ✅ |
| F2 — Capa de datos | T2.1–T2.3 | backend | ✅ |
| F3 — Servicio y Server Action | T3.1–T3.3 | backend | ✅ |
| F4 — Tests de servicio y borde | T4.1–T4.14 | backend | ✅ |
| F5 — Integración | T5.1, T5.2 | backend | ✅ |
| F6 — UI | T6.1, T6.2, T6.4, T6.5 | frontend | ✅ |
| F6 — UI | T6.3 (bucket `asignadas`) | backend (2.ª pasada) | ✅ |
| F7 — Cierre | T7.1, T7.2 | backend + reviewer | ✅ |

---

## 3. Superficie de código

### Migración (T0.1)

`db/migrations/20260728120000_orden_historial_origen_deshacer_asignacion/`

- `migration.sql` — `ALTER TYPE "orden_historial_origen_tipo" ADD VALUE IF NOT EXISTS
  'deshacer_asignacion'`, **sola en su transacción** (Postgres 55P04: no se puede USAR un valor de
  enum recién añadido en la transacción que lo añadió, y Prisma Migrate corre cada `migration.sql`
  en una). Patrón de `cancelacion_api` (106) y `devolucion_rechazada` (139).
- `down.sql` — recrea el enum con los **22** valores previos + `USING` + `DROP TYPE ..._old`. Falla
  RUIDOSAMENTE si ya existe una fila con el valor nuevo: revertir borrando rastro de auditoría de
  reversiones ya ejecutadas no es seguro.
- **Sin tablas ni columnas nuevas ⇒ sin RLS nueva.** `orden_historial_estado` conserva la suya
  (feature 49).
- **Round-trip REAL verificado** contra la DB local (`localhost:5432/ordenex`):
  `prisma migrate deploy` verde → `pnpm db:rollback` verde → `deploy` de nuevo verde →
  `migrate status: Database schema is up to date!`.
  *(El reviewer no lo reprodujo — nota N2 —: exige operar sobre una base real, fuera de su mandato;
  verificó up y down por lectura.)*

### Dominio
- `db/schema.prisma` — enum `OrdenHistorialOrigenTipo` + `deshacer_asignacion` (23.º valor).
- `lib/types/orden-historial.ts` — `ORDEN_HISTORIAL_ORIGEN_TIPO_SEED` + el valor, y la
  justificación de por qué **NO** entra en `ORIGEN_TIPOS_CON_GESTION` (nunca enlaza gestión; su
  destino nunca es `devuelta`, así que jamás altera el conteo de intentos de devolución).
- `lib/types/order-status-transiciones.ts` — aristas **#43/#44/#45** (§4).

### Capa de datos
- `lib/repositories/OrdenHistorialRepository.findOrigenesReversion` **[NUEVO]** — `DISTINCT ON
  (orden_id)`, `ORDER BY orden_id, created_at DESC, id DESC`, `LEFT JOIN order_status`, pares
  `(orden, estado actual)` parametrizados por `VALUES`. UNA consulta por lote (sin N+1).
- `lib/repositories/OrdenRepository.deshacerAsignacionLote` **[NUEVO]** — UPDATE por orden guardado
  por estado de ORIGEN + `deleted_at IS NULL` + `zona_id` (si el actor es `adminSatelite`), con
  `RETURNING`. Limpia `mensajero_asignado_id` y `asignado_at`; **no menciona `num_guia` ni
  `prioridad`** (la ausencia es el mecanismo); **sin guarda de `cierre_dia`** (Q1); lanza
  `DeshacerAsignacionConflictoError` si alguna orden no gana su guarda; `appendCambioEstado` en la
  MISMA tx; ancla `TODO(146)` (§6).
- `lib/interfaces/repositories/{IOrdenRepository,IOrdenHistorialRepository}.ts` — tipos, firmas y
  el error de dominio.
- `lib/services/mensajes-deshacer-asignacion.ts` **[NUEVO]** — motivos tipados (service, tests y UI
  comparten constantes, sin literales duplicados). **Sin** constante de «mensajero bloqueado por
  cierre»: ese motivo no existe en esta feature.

### Servicio y borde
- `lib/interfaces/services/IDeshacerAsignacionService.ts` **[NUEVO]** — resultado
  `ok | forbidden | sin_zona | validation_error | conflict` con `DetalleConflicto` por orden.
- `lib/services/DeshacerAsignacionService.ts` **[NUEVO]** — rol → zona server-side → zona central →
  validación por orden → derivación/normalización → coherencia zona/destino → gate de destino del
  `adminSatelite` → catálogo → escritura.
- `lib/actions/deshacer-asignacion.ts` **[NUEVO]** — Server Action (mutación interna ⇒ nunca ruta
  API), `withErrorHandler` + `resolveActorFromSession` + zod (`ordenIds` uuid no vacío, `motivo`
  `trim` 10..300).

### UI (F6)
- `app/(app)/ordenes/_components/DeshacerAsignacionModal.tsx`,
  `deshacer-asignacion-error-messages.ts`, cableado de `OrdenesListado.tsx`.
- `app/(app)/recepcion-satelite/_components/DeshacerAsignacionSateliteModal.tsx` + sección
  «Asignadas (por recoger)» en `RecepcionSateliteModule.tsx`.
- **T6.3 (backend)**: bucket `asignadas` en `RecepcionSateliteService.listar` +
  `IRecepcionSateliteService` + `lib/types/recepcion-satelite.ts` + `page.tsx`, acotado por la zona
  del `adminSatelite` resuelta server-side.

---

## 4. Tests de la feature 140 modificados — y POR QUÉ

La 140 es la guardia central de transiciones y falla CERRADO. La 149 abre tres aristas legítimas,
así que su inventario cambia. **La guardia NO se relajó en ningún punto**: lo que cambió es el
inventario que la guardia declara, y el ajuste estaba ANTICIPADO en `design.md` §2 (no descubierto
durante la implementación).

| Archivo | Qué cambió | Por qué |
| --- | --- | --- |
| `tests/fixtures/inventario-transiciones-140.ts` | +3 filas (#43 `por_recoger→en_bodega_central`, #44 `por_recoger→en_bodega_satelite`, #45 `en_ruta_bodega_satelite→en_bodega_central`); `RECUENTO_INVENTARIO` **43→46** aristas y **39→42** pares únicos | Las tres son pares NUEVOS (ninguna repite un par ya declarado), por eso suben ambos recuentos. Transcritas A MANO, como exige la cabecera del fixture: derivarlas del mapa haría que el test comprobara que el mapa es igual a sí mismo. |
| `tests/unit/domain/order-status-transiciones.guardia.test.ts` › lista de pares ILEGALES | **Sale** `["por_recoger","en_bodega_satelite"]`; **entra** `["por_recoger","en_preparacion"]` | Ese par consagraba como ilegal exactamente lo que la #44 legaliza. Se sustituye por uno que SIGUE siendo ilegal, para no perder un caso de la lista: por D3′ la reversión normaliza a un estado de BODEGA y nunca vuelve a un estado pre-guía. |
| idem › `it` del recuento | Título 43/39 → **46/42** | El aserto consume `RECUENTO_INVENTARIO`; solo el título era literal. |
| idem › `el mapa declara exactamente las aristas del inventario` | Sin tocar | Es la red de seguridad de que no se coló una arista de más: pasa porque mapa y fixture se actualizaron a la vez. |
| idem › **bloque nuevo «REGRESIÓN 149»** | +2 `it` | Uno afirma que #43/#44/#45 SÍ pasan (R27); otro, que 7 pares que la feature podría sugerir siguen ILEGALES (R28): `por_recoger→en_fulfillment`, `por_recoger→en_preparacion`, `en_ruta_bodega_satelite→en_fulfillment`, `en_ruta_bodega_satelite→en_preparacion`, `en_ruta→por_recoger`, `en_ruta→en_bodega_central`, `en_bodega_satelite→en_ruta_bodega_satelite`. |
| `tests/unit/domain/order-status-transiciones.connectividad.test.ts` | **Sin tocar** (T1.3) | El catálogo sigue en 18 estados, no hay terminales nuevos y ambos estados implicados ya tenían entrada y salida. Verde sin modificarlo: si hubiera hecho falta tocarlo, habría sido señal de una arista de más. |

### Censos del arnés que el 23.º valor del enum puso en rojo (deuda conocida, no defectos)

| Archivo | Ajuste |
| --- | --- |
| `tests/unit/types/orden-historial-types.test.ts` | SEED esperado 22 → **23** |
| `tests/unit/repositories/orden-historial-cobertura.test.ts` | Punto **#23** del mapa de call-sites del choke point (`OrdenRepository.deshacerAsignacionLote`); 22 → 23 |
| `tests/integration/db/{gestion-orden-anulacion,…recepcion-bodega-central,…cancelacion-api,…resolver-novedad,…sla-devuelta}-migration.test.ts` (5) | `deshacer_asignacion` entra en el set «AÑADIDOS EN O DESPUÉS DE la feature X»: cada `down.sql` histórico recrea el enum a un estado FIJO y se compara contra el SEED vivo. Mismo patrón que aplicó la 139. |
| `tests/integration/db/zonas-migration.test.ts` | La migración nueva entra en la denylist del invariante de timestamps (precedente: feature 141) |
| 5 suites con dobles COMPLETOS de `IOrdenRepository` | `deshacerAsignacionLote` añadido al doble |
| 3 suites con dobles de `IRecepcionSateliteService` | `asignadas: []` añadido al doble (T6.3) |

---

## 5. Matriz de trazabilidad R → test REAL (archivo + nombre del test)

Abreviaturas de archivo:

- `svc` = `tests/unit/services/deshacer-asignacion-service.test.ts`
- `repo` = `tests/unit/repositories/orden-repository.deshacer-asignacion.test.ts`
- `act` = `tests/unit/actions/deshacer-asignacion.action.test.ts`
- `int` = `tests/integration/repositories/deshacer-asignacion.historial.test.ts`
- `guardia` = `tests/unit/domain/order-status-transiciones.guardia.test.ts`
- `origen149` = `tests/unit/domain/orden-historial-origen-149.test.ts`
- `mig` = `tests/integration/db/orden-historial-origen-deshacer-asignacion-migration.test.ts`
- `asimetria` = `tests/unit/services/deshacer-asignacion.cierre-asimetria.test.ts`
- `histrepo` = `tests/unit/repositories/orden-historial-origenes-reversion.test.ts`
- `satelite` = `tests/unit/services/recepcion-satelite-asignadas.test.ts`
- `ui` = `tests/unit/components/deshacer-asignacion.ui.test.tsx`

| R | Archivo | Nombre del test |
| --- | --- | --- |
| R1 | `svc` | `T4.1/R1/R2/R3 — autorizacion por rol` › `%s revierte y no queda acotado por zona (R3)` (maestro/admin) |
| R2 | `svc` | idem › `%s -> forbidden, sin llamar a NINGUN writer ni lector de ordenes` (adminTienda/mensajero/apiKey) |
| R3 | `svc` | idem › `%s revierte y no queda acotado por zona (R3)` (`findUsuarioZonaId` no se llama; `zonaId` al writer = `null`) |
| R4 | `svc` | `T4.2/R4/R5/R6` › `R4: una orden de zona ajena en el lote -> forbidden del LOTE COMPLETO, 0 escrituras` y `R4: el adminSatelite legitimo revierte su zona y la guarda de zona viaja al writer` |
| R5 | `svc` | idem › `R5: destino derivado 'en_bodega_central' con actor adminSatelite -> forbidden` |
| R6 | `svc` | idem › `R6: adminSatelite sin zona -> sin_zona, sin leer ordenes` |
| R7 | `act` | `R7 — sin sesion` › `responde unauthenticated sin construir ni invocar el service`, `la sesion se comprueba ANTES que el schema` |
| R8 | `svc` + `repo` | `T4.3/R8/R9 — caso (a)` › `origen 'en_bodega_central' -> destino en_bodega_central` + `un UPDATE por orden, guardado por estado de origen...` (`"mensajero_asignado_id" = NULL`) |
| R9 | `svc` + `repo` | idem (`"asignado_at" = NULL` en el `SET`) |
| R10 | `svc` | `T4.4/R10 — caso (b)` › `vuelve a en_bodega_central con la guarda de origen correcta` |
| R11 | `svc` + `histrepo` | `T4.5/R11/R12` › `R11: la derivacion consulta el HISTORIAL con el estado actual de cada orden` y `R11 (testigo): una orden de zona satelite cuyo historial dice 'en_bodega_central' NO va a satelite` + `una sola consulta para todo el lote, con DISTINCT ON y desempate created_at/id DESC` |
| R12 | `svc` | `T4.5` › `origen %s -> destino %s (tabla CERRADA de D3')` (4 casos: los cuatro orígenes soportados) |
| R13 | `svc` + `histrepo` | `T4.6/R13 — fallo CERRADO` › `%s -> conflict con motivo tipado y 0 escrituras` (sin fila / origen NULL / `en_ruta` / `devuelta`) + `mapea 'value' NULL (fila de creacion) a null y omite las ordenes sin fila` |
| R14 | `svc` | `T4.7/R14/R15` › `R14: destino en_bodega_central con orden NO central -> conflict` |
| R15 | `svc` | idem › `R15: destino en_bodega_satelite con orden central -> conflict` |
| R16 | `svc` | `T4.8/R16` › `estado %s -> conflict con el estado NOMBRADO en el motivo` (7 estados: `en_ruta`, `en_bodega_satelite`, `entregada`, `reprogramada`, `devuelta`, `rechazada`, `sin_gestionar`) |
| R17 | `svc` | idem › `R17: orden borrada -> conflict 'orden borrada'` |
| R18 | `svc` | idem › `R18: id inexistente -> conflict 'orden no existe'` |
| R19 | `asimetria` + `repo` | `T4.9(a)/R19` › `revierte la orden y NO consulta findMensajerosBloqueados (el gate no aplica)`; `T4.9(b)/R19` › `GuiaAsignacionService.asignarDesdeBodega -> conflict por cierre pendiente (no-regresion)` + `R19 (Q1 CERRADA): el UPDATE NO lleva guarda de cierre_dia` |
| R20 | `svc` + `repo` | `T4.10/R20/R21` › `R20: lote de 3 con una invalida -> 0 escrituras para las otras dos` + `lanza DeshacerAsignacionConflictoError con los ids que no transicionaron` |
| R21 | `svc` + `repo` | idem › `R21: carrera (el writer lanza) -> conflict con detalle por orden, sin efectos parciales` + `una orden sin origen en el mapa NO se toca y aborta el lote (fallo CERRADO)` |
| R22 | `act` | `R22 — motivo obligatorio (10..300 tras recortar)` › `motivo %s -> validation_error en el campo 'motivo', sin invocar el service` (ausente, vacío, solo espacios, 9, 301), `motivo de %s es VALIDO (bordes inclusivos)` (10 y 300), `el motivo llega al service RECORTADO` |
| R23 | `int` | `R23/R31 — EXACTAMENTE una fila de historial por orden, con motivo` › `origen real, destino, actor, origen_tipo 'deshacer_asignacion' y motivo` |
| R24 | `act` | `R24 — UN motivo por invocacion, para todas las ordenes del lote` › `el lote entero viaja en UNA llamada con el mismo motivo` |
| R25 | `origen149` + `mig` | `R25 — 'deshacer_asignacion' es un tipo de origen PROPIO del historial` (3 `it`) + `esta en ORDEN_HISTORIAL_ORIGEN_TIPO_SEED` |
| R26 | `origen149` + `mig` | `R26 — 'deshacer_asignacion' NO entra en ORIGEN_TIPOS_CON_GESTION` (3 `it`) + `R26: NO entra en ORIGEN_TIPOS_CON_GESTION (nunca enlaza gestion; destino != devuelta)` |
| R27 | `guardia` + `int` | `REGRESION 149/R27: las TRES aristas de 'deshacer_asignacion' (#43/#44/#45) son LEGALES`, `el inventario de flujo tiene las 46 aristas y 42 pares unicos`, `el mapa declara exactamente las aristas del inventario, ni una mas` + `T5.2/R27 — la guardia REAL de la 140 acepta las TRES aristas nuevas` (3 casos, sin mockear la guardia) |
| R28 | `guardia` + `int` | `REGRESION 149/R28: %s -> %s sigue siendo ILEGAL (la 149 no lo abrio)` (7 pares) + `R28: un destino NO declarado (por_recoger -> en_preparacion) sigue siendo ilegal` |
| R29 | `repo` | `R29/R30 (T4.12): el SET NO menciona num_guia ni prioridad` |
| R30 | `repo` | idem (misma aserción: la AUSENCIA de la columna en el `SET` es el mecanismo) |
| R31 | `int` | `R23/R31 — EXACTAMENTE una fila de historial por orden, con motivo` (una invocación de `createMany`, una fila) |
| R32 | `int` | `R32 — el webhook de estado se encola en la MISMA transaccion` › `una orden con owner suscrito (apiKey) deja el job 'webhook_estado' pendiente` |
| R33 | `int` | idem › `R33: si el append revierte la tx, no queda ni fila de historial ni job` y `R33: una orden que pierde la carrera no deja historial ni job (lote revertido)` |
| R34 | `ui` | `R34 — acción por lote en el listado del maestro` › `se ofrece con una selección en 'por_recoger'`, `… en 'en_ruta_bodega_satelite' (caso b)`, `NO se ofrece en un estado no elegible ('en_bodega_central')`, `el checkbox de 'por_recoger' NO se bloquea (Q1)` |
| R35 | `satelite` + `ui` | `T6.3/R35 — el modulo satelite lista las 'por_recoger' de SU zona` › `clasifica las 'por_recoger' en el bucket 'asignadas', con el DTO completo`, `SCOPING: consulta con la zona del actor resuelta SERVER-SIDE y pide 'por_recoger'`, `SCOPING: la consulta es POR ZONA`, `el bucket nuevo NO contamina los ya existentes`, `adminSatelite SIN zona -> 'asignadas' vacio`, `rol %s -> forbidden` + `R35: lista sus 'por_recoger' y ofrece la acción por lote sobre ellas` |
| R36 | `satelite` + `ui` | `R36: una 'en_ruta_bodega_satelite' NO cae en 'asignadas' (sigue en 'porRecibir')` + `R36: la sección 'Por recibir' (en_ruta_bodega_satelite) NO ofrece deshacer` |
| R37 | `ui` | `R37 — el confirmar depende del motivo` › `sin motivo el botón está deshabilitado`, `con un motivo demasiado corto (o solo espacios) sigue deshabilitado`, `con un motivo válido se habilita y la acción se invoca UNA vez con el lote completo`, `el predicado de validez es el mismo del borde (10..300 tras recortar)` |
| R38 | `ui` | `R38 — éxito en el listado del maestro` › `revalida el listado y avisa cuántas órdenes se revirtieron`; `R35/R36 …` › `R38: tras el éxito se relee el estado del servidor (router.refresh)` |
| R39 | `ui` | `R39 — mensajes accionables por causa` › `%s produce un mensaje propio` (13 causas), `los mensajes son DISTINTOS entre sí`, `un status desconocido cae en el mensaje genérico`, `el 'validation_error' del motivo usa el texto del campo` |
| R40 | `svc` + `ui` | `T4.13/R40 — ningun motivo expone UUIDs ni datos del destinatario` › `la constante '%s' no contiene UUID` (7 constantes) y `el detalle de un conflict real no filtra el destinatario ni su telefono`; + `R39 …` › `R40: ningún mensaje expone UUIDs ni el motivo crudo del backend` |
| R41 | `svc` + `repo` | `T4.14(a)/R41` › `una reversion exitosa invoca EXACTAMENTE los metodos de repo conocidos: ninguno de aviso` (censo por `Proxy`), `el service no tiene POR DONDE notificar: 3 deps y ningun canal en su fuente`, `el unico efecto para el mensajero es que la orden sale de su listado de asignaciones` + `R41 (T4.14b) — ancla TODO(146)` › `el ancla literal 'TODO(146)' vive dentro de deshacerAsignacionLote`, `el pre-read captura el mensajero previo` |

**Los 41 requisitos están mapeados.** R34–R39 se verifican en la UI, y R35/R36 además a nivel de
service (`satelite`), que es donde vive el scoping por zona.

---

## 6. Deuda diferida a la feature 146 — ANCLA

La decisión Q5 del gate (CERRADA) es: **sí se quiere** avisar al mensajero al que se le retira una
orden, pero **se DIFIERE** porque el canal (campana de notificaciones, feature 146) no existe.
Esta feature **no implementa notificación alguna** (R41): el único efecto visible para el mensajero
es que la orden desaparece de su listado.

```
Archivo   : lib/repositories/OrdenRepository.ts
Función   : OrdenRepository.deshacerAsignacionLote
Ubicación : DENTRO de la $transaction, justo DESPUÉS de `appendCambioEstado` y antes del `return`
Marca     : comentario literal `TODO(146)`
Búsqueda  : rg "TODO\(146\)"
```

Contrato del aviso futuro (fijado en `requirements.md` §10 / R41):

| Campo | Valor |
| --- | --- |
| Disparador | reversión exitosa de una orden en `por_recoger` (caso a) |
| Destinatario | el usuario que figuraba en `mensajero_asignado_id` ANTES de la reversión |
| Contenido | «La orden `<num_guia>` fue retirada de tus asignaciones» |
| Caso (b) | NO aplica: `en_ruta_bodega_satelite` no tiene mensajero asignado |

**Insumo ya disponible**: el pre-read del lote (`mensajeroPrevioPorOrden`) captura el
`mensajero_asignado_id` PREVIO al UPDATE (que lo pone a NULL), dentro de la misma transacción. La
146 tiene el destinatario sin rehacer la consulta, y el patrón a seguir es el
transactional-outbox del webhook de estado que ya corre ahí.

**Guardia del ancla**: `tests/unit/repositories/orden-repository.deshacer-asignacion.test.ts`,
bloque `R41 (T4.14b) — ancla TODO(146)`, lee el propio fuente y acota la búsqueda al cuerpo del
método. **Borrar el ancla ROMPE la suite.**

---

## 7. Decisiones del gate F1.4 honradas (CERRADAS, no reabiertas)

- **Q1 (R19) — asimetría asignar/deshacer.** El cierre de día pendiente del mensajero **no**
  bloquea el deshacer, y **sí** sigue bloqueando la asignación. Mecanismo: `deshacerAsignacionLote`
  no lleva `NOT EXISTS … cierre_dia`, y el `Pick<IOrdenRepository, …>` del service **no incluye**
  `findMensajerosBloqueados` (consultarlo por descuido no compila). Los tres gates de asignación
  (`generarGuia`, `asignarDesdeBodega`, `asignarSateliteLote`) quedaron intactos.
- **Q2 (R30) — `prioridad` no se restaura.** Limitación conocida y aceptada. El `SET` del UPDATE no
  la menciona (ni a `num_guia`, D2/R29).
- **Q3** — desempate del historial por `(created_at DESC, id DESC)`, sin columna monotónica nueva.
- **Q4** — sin tope de tamaño de lote (consistente con el resto de acciones por lote del repo).
- **Q5 (R41)** — aviso diferido a la 146 (§6).
- **Q6** — sin marca de «ya revertida»: R16 impide un segundo deshacer y la derivación siempre lee
  la fila más reciente.
- **Q7** — sin tipo de evento de webhook nuevo: el par (origen, destino) basta.

---

## 8. Notas del review y cómo se cerraron

`progress/review_149.md` — **APROBADO-CON-NOTAS, 0 bloqueantes, 12/12 mutantes muertos.**

| Nota | Estado |
| --- | --- |
| N1 — `tasks.md` con T7.1/T7.2 sin marcar | ✅ cerrada: ambas marcadas `[x]` |
| N2 — round-trip de la migración no reproducido por el reviewer | ℹ️ sin acción sobre el código; queda registrado (§3) que la verificación la hizo el implementador contra la DB local |
| N3 — faltaba el test de la migración | ✅ cerrada: `tests/integration/db/orden-historial-origen-deshacer-asignacion-migration.test.ts` (14 tests), molde de la 106; falsabilidad comprobada quitando un valor del `down.sql` |
| N4 — sin E2E de Playwright | ℹ️ aceptada: consistente con 138/139/140 y con un `tasks.md` aprobado sin tarea E2E |
| N5 — test tautológico de R41 | ✅ cerrada: sustituido por un censo de colaboradores con `Proxy` + aserto de arity y de fuente. Dos mutantes verificados (§9) |
| N6 — bitácora partida en dos archivos | ✅ cerrada: **este** `impl_149.md` consolida; los parciales quedan como detalle |

### Mutación de N5 (aplicada y revertida; el service quedó intacto)

| Mutante | Resultado con el test NUEVO | Con el test viejo |
| --- | --- | --- |
| Cablear `repo.notificarMensajero(ids)` tras la escritura | **MUERTO** — el censo cae con `+ "repo.notificarMensajero"` en el diff del aserto | sobrevivía |
| Inyectar un notificador como 4.ª dep del constructor | **MUERTO** — `DeshacerAsignacionService.length` 3 → 4 | sobrevivía |

---

## 9. Verificación final (T7.1) — números REALES medidos en este worktree

```
$ ./init.sh                    → verde, exit 0 (medido por el reviewer)
$ pnpm typecheck               → 0 errores
$ pnpm lint                    → 0 errores, 154 warnings (todas preexistentes en estilo:
                                 parámetros de doble sin usar, patrón ya vigente en el repo)
$ pnpm test                    → 528 archivos / 5478 tests, 0 fallos
                                 delta de tests fallidos vs. baseline = 0

Migración (DB local):
$ npx prisma migrate deploy    → aplicada en verde
$ pnpm db:rollback             → down.sql revertido en verde
$ npx prisma migrate deploy    → reaplicada; `migrate status` = "Database schema is up to date!"
```

Evolución de la suite a lo largo de la feature: 5420 (backend F0–F5) → 5450 (UI F6) → 5458 (T6.3)
→ **5478** (cierre F7: +14 del test de migración de N3, +2 netos del rehecho de N5). Cero fallos en
todos los cortes.

---

## 10. Límites conocidos (no son defectos)

1. **`prioridad` se pierde** al asignar y no se restaura al deshacer (Q2/R30). El operador puede
   volver a priorizar por los mecanismos existentes.
2. **El mensajero no recibe aviso** en esta feature (Q5/R41): la orden simplemente desaparece de su
   listado. El enganche está anclado para la 146 (§6).
3. **El webhook no distingue** una reversión de una liberación por SLA (Q7): el integrador ve un
   cambio de estado a `en_bodega_central`/`en_bodega_satelite`. El detalle
   (`origen_tipo = deshacer_asignacion` + motivo) vive en la línea de tiempo de la orden.
4. **No se vuelve a `en_fulfillment`/`en_preparacion`** aunque el historial lo diga (D3′): esos
   orígenes normalizan a `en_bodega_central`, porque una orden en estado pre-guía con `num_guia`
   impreso sería un híbrido inconsistente y reabriría «Generar guía» sobre una orden ya etiquetada.
