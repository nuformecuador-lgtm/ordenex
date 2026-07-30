# Review — Feature 149 · Deshacer asignación a mensajero o bodega antes de la recogida

- **Revisor:** reviewer (agente)
- **Fecha:** 2026-07-28
- **Worktree:** `ordenex-wt-149`, rama `feature/149-deshacer-asignacion`
- **Base:** `origin/dev @ 55b0cd4` · 13 commits (`d90c718..5c4a27f`)
- **Método:** lectura + ejecución propia del arnés + **review por mutación** (12 mutaciones)

## VEREDICTO: APROBADO-CON-NOTAS

No hay bloqueantes. Los siete puntos de riesgo señalados en el encargo se verificaron uno a uno
y todos resisten. Quedan 6 notas menores, ninguna de código de producción.

---

## 1. Números medidos por MÍ (no los reportados)

| Medida | Baseline `55b0cd4` (leader) | Reportado por impl. | **Medido por el reviewer** | Delta |
| --- | --- | --- | --- | --- |
| `pnpm typecheck` | 0 errores | 0 | **0 errores** | 0 |
| `pnpm lint` | 145 warnings | 0 err / 154 warn | **0 errores / 154 warnings** | +9 warn |
| `pnpm test` archivos | 518 | 527 | **527 passed (527)** | +9 |
| `pnpm test` tests | 5308 | 5458 | **5458 passed (5458)** | +150 |
| `pnpm test` fallos | 0 | 0 | **0** | **0** |
| `./init.sh` | — | verde | **`== init OK ==`, exit 0** | — |

**Sin discrepancia con lo reportado: los tres números coinciden exactamente.** `./init.sh` corre
typecheck + lint + test + censo de `down.sql` + `.env`, y terminó en verde de punta a punta
(incluida la comprobación "todas las migraciones tienen down.sql", que cubre la nueva).

Los +9 warnings de lint son `no-unused-vars` sobre parámetros prefijados con `_` en los dobles de
test de la 149 (mismo patrón que el resto del repo). 0 errores.

---

## 2. Review por MUTACIÓN (lo que da confianza real)

Cada mutación se aplicó al código de producción, se corrió el test dirigido y se **revirtió**.
`git status --porcelain` quedó vacío tras cada una y al final del review.

| # | Mutación (qué se rompió a propósito) | Archivo | Resultado |
| --- | --- | --- | --- |
| M1 | Añadir una arista NO declarada al mapa (`por_recoger -> en_preparacion`) | `lib/types/order-status-transiciones.ts` | **MUERTA** — 3 tests caen (conjunto cerrado + R28) |
| M2 | R13 deja de fallar CERRADO: adivina `en_bodega_central` sin fila de historial | `DeshacerAsignacionService.ts` | **MUERTA** — 4 tests caen |
| M3 | Quitar el scoping por zona del `adminSatelite` al EJECUTAR (R4) | `DeshacerAsignacionService.ts` | **MUERTA** — 1 test cae |
| M3b | Quitar la guarda `AND "zona_id" = ...` del UPDATE (defensa en profundidad) | `OrdenRepository.ts` | **MUERTA** — 1 test cae |
| M4 | Motivo deja de ser obligatorio (`min(10)` -> `min(0)`) | `lib/actions/deshacer-asignacion.ts` | **MUERTA** — 3 tests caen |
| M5a | Asimetría Q1, dirección A: el DESHACER pasa a consultar el gate y bloquear | `DeshacerAsignacionService.ts` | **MUERTA** — 1 test cae |
| M5b | Asimetría Q1, dirección B: el ASIGNAR deja de aplicar el gate de cierre | `GuiaAsignacionService.ts` | **MUERTA** — 1 test cae |
| M6 | Borrar el ancla literal `TODO(146)` | `OrdenRepository.ts` | **MUERTA** — 1 test cae |
| M7 | El `SET` del UPDATE toca `prioridad = true` y `num_guia = NULL` (R29/R30) | `OrdenRepository.ts` | **MUERTA** — 1 test cae |
| M8 | El destino se deriva de la ZONA en vez del historial (R11) | `DeshacerAsignacionService.ts` | **MUERTA** — 10 tests caen |
| M9 | El caso (b) (`en_ruta_bodega_satelite`) se filtra al bucket `asignadas` (R36) | `RecepcionSateliteService.ts` | **MUERTA** — 2 tests caen |
| M10 | Quitar el gate R5 (satélite deshaciendo hacia la bodega central) | `DeshacerAsignacionService.ts` | **MUERTA** — 1 test cae |
| M11 | Cualquier rol autorizado (R1/R2) | `DeshacerAsignacionService.ts` | **MUERTA** — 3 tests caen |
| M12 | El botón de confirmar siempre habilitado (R37) | `DeshacerAsignacionModal.tsx` | **MUERTA** — 2 tests caen |

**12/12 mutaciones muertas. Ningún superviviente.** Un primer intento de M9 fue INVÁLIDO
(referenciaba un identificador inexistente en una rama muerta del `else if`, así que no llegaba a
evaluarse) y se rehízo correctamente; la versión válida es la de la tabla.

Los tests de esta feature **ejercen** los requisitos: no son verdes decorativos.

---

## 3. Los siete puntos de riesgo del encargo

### 3.1 La guardia central de la 140 NO se relajó — VERIFICADO

- `tests/unit/domain/order-status-transiciones.guardia.test.ts:36-42` ("el mapa declara
  exactamente las aristas del inventario, ni una más") sigue **intacto y bidireccional**: compara
  el mapa completo contra el inventario transcrito a mano. M1 lo confirma: añadir una sola arista
  de más rompe la suite. **No se abrió ninguna arista de más.**
- Recuentos actualizados con justificación correcta: 43 -> 46 aristas, 39 -> 42 pares únicos. Las
  tres aristas nuevas son pares NUEVOS (ninguna repite un par ya declarado), así que ambos
  contadores suben en 3. Verificado contra `INVENTARIO_FLUJO`.
- El caso ajeno tocado (`por_recoger -> en_bodega_satelite`, que la 140 consagraba como ILEGAL)
  **debía** cambiar: pasa a ser la arista #44. Se sustituyó por `por_recoger -> en_preparacion`,
  que sigue siendo ilegal, así que la lista de pares ilegales no perdió cardinalidad.
- Se AÑADIÓ un bloque de regresión 149/R28 con 7 pares que siguen ilegales
  (`por_recoger -> en_fulfillment` y `-> en_preparacion`, `en_ruta_bodega_satelite -> en_fulfillment`
  y `-> en_preparacion`, `en_ruta -> por_recoger`, `en_ruta -> en_bodega_central`,
  `en_bodega_satelite -> en_ruta_bodega_satelite`).
- El fallo CERRADO de la 140 (sin modo shadow, sin override ANY->ANY, auto-lazo prohibido) sigue
  íntegro: esos tests no se tocaron y pasan.

### 3.2 Migración de enum — VERIFICADO POR LECTURA (round-trip real NO reproducido)

`db/migrations/20260728120000_orden_historial_origen_deshacer_asignacion/`

- `migration.sql`: **una sola sentencia**, `ALTER TYPE ... ADD VALUE IF NOT EXISTS
  'deshacer_asignacion'`, sin ningún USO del valor en la misma transacción. Correcto para el
  55P04: Prisma envuelve cada `migration.sql` en una transacción y Postgres prohíbe *usar* (no
  *añadir*) un valor recién creado dentro de ella. Mismo patrón que los precedentes 106/138/139.
  Idempotente por el `IF NOT EXISTS`.
- `down.sql`: presente y **coherente**. Recrea el enum con **exactamente los 22 valores previos**
  (los conté uno a uno contra `ORDEN_HISTORIAL_ORIGEN_TIPO_SEED` menos `deshacer_asignacion`:
  coinciden), hace el `ALTER COLUMN ... USING` sobre la única columna consumidora
  (`orden_historial_estado.origen_tipo`) y dropea el tipo viejo. Documenta la irreversibilidad
  parcial y la precondición (ninguna fila usando el valor), con el fallo ruidoso como
  comportamiento deseado.
- `./init.sh` valida la presencia del `down.sql` y pasó.
- **NO reproduje el round-trip real** (deploy -> rollback -> deploy): exige aplicar y revertir
  contra una base real, operación destructiva fuera del mandato de un revisor. Queda como
  afirmación NO verificada de forma independiente (nota menor N2).
- Migración ADITIVA: no crea tablas ni columnas -> **no aplica RLS nueva**;
  `orden_historial_estado` conserva la suya de la feature 49.

### 3.3 Asimetría del cierre pendiente (decisión Q1) — VERIFICADO EN AMBAS DIRECCIONES

`tests/unit/services/deshacer-asignacion.cierre-asimetria.test.ts` fija las dos direcciones sobre
**el mismo mensajero** (`m-cierre`, cierre `solicitado`):

- (a) DESHACER -> `ok`, y `findMensajerosBloqueados` **no se invoca** (el espía está disponible en
  el doble; el `Pick` del service lo excluye a propósito). M5a lo mata.
- (b) ASIGNAR (`GuiaAsignacionService.asignarDesdeBodega`) -> `conflict` con
  "mensajero bloqueado por cierre pendiente", y `asignarBodegaLote` no se llama. M5b lo mata.
- Refuerzo a nivel repo: `orden-repository.deshacer-asignacion.test.ts` asserta que el UPDATE
  **no** contiene `cierre_dia` ni `NOT EXISTS`.
- El tipo `DeshacerAsignacionRepo` (un `Pick`) **excluye** `findMensajerosBloqueados`: consultarlo
  por descuido no compilaría. Defensa estructural, no solo de test.

### 3.4 `prioridad` y `num_guia` NO se tocan (Q2/D2) — VERIFICADO

El `SET` del UPDATE en `OrdenRepository.deshacerAsignacionLote` es exactamente `estatus_id`,
`mensajero_asignado_id = NULL`, `asignado_at = NULL`, `updated_at = NOW()`. Ni `prioridad` ni
`num_guia` aparecen en ningún `SET` del diff completo de la feature. El test T4.12 asserta la
AUSENCIA sobre el SQL real de cada UPDATE. M7 lo mata. No se consume secuencia de guías: no hay
llamada a `siguiente_num_guia()` en el camino.

### 3.5 Fallo CERRADO en la derivación del destino (R13/D3) — VERIFICADO

`DeshacerAsignacionService`, paso 6: `NORMALIZACION_DESTINO` es un `Map` **cerrado** de 4 entradas;
si `origenValue` es `null` (sin fila, o fila de creación con origen NULL) o no está en el mapa,
`destino === undefined` -> `detalle.push(MSG_SIN_HISTORIAL)` y `return conflict` sin escribir.
**No existe ninguna rama que adivine un destino**: lo verifiqué leyendo el service completo (no
hay fallback con `??`, ni default, ni derivación por zona). M2 y M8 lo matan. Además la
normalización es una INFERENCIA que se **verifica** contra la zona real (R14/R15) antes de
escribir, lo cual es más estricto que lo pedido.

### 3.6 Ancla `TODO(146)` (Q5) — VERIFICADO

Existe literal en `lib/repositories/OrdenRepository.ts`, **dentro** de `deshacerAsignacionLote`,
con destinatario y contenido del aviso diferido. El test R41 (T4.14b) lee el fuente, acota el
cuerpo del método por sus delimitadores y asserta `TODO(146)` + "mensajero desasignado" +
"fue retirada de tus asignaciones". M6 (borrar el ancla) lo mata. El pre-read del
`mensajero_asignado_id` previo deja el destinatario disponible para la 146 y está también
asertado. El service, por su parte, no invoca ningún productor de notificaciones (R41).

### 3.7 Scoping por zona del `adminSatelite` (D1) en las DOS superficies — VERIFICADO

- **EJECUTAR:** `DeshacerAsignacionService` resuelve la zona **server-side**
  (`findUsuarioZonaId(actor.usuarioId)`, nunca del cliente); si alguna orden del lote tiene otra
  zona -> `forbidden` del lote completo, evaluado **antes** de mirar el estado (no filtra la
  existencia de órdenes ajenas). Sin zona -> `sin_zona`. Además, defensa en profundidad
  anti-TOCTOU: el UPDATE repite `AND "zona_id" = ...` cuando `zonaActor` no es null. M3 y M3b
  matan cada capa por separado.
- **LISTAR:** `RecepcionSateliteService.listar` alimenta el bucket nuevo `asignadas` desde
  `findRecepcionSateliteByZona(zonaId, ...)`, la misma consulta acotada por zona que los cinco
  buckets previos; `sinZona` devuelve `asignadas: []`. `recepcion-satelite-asignadas.test.ts`
  cubre la clasificación, el scoping y la no-contaminación de los buckets previos.
- **R36:** el caso (b) NO entra en `asignadas` (sigue en `porRecibir`, sin acción de deshacer).
  M9 lo mata. Y aunque un `adminSatelite` forzara un caso (b), el gate R5 del service lo rechaza
  con `forbidden` (M10 lo mata): **la UI y el servidor lo bloquean por separado.**

---

## 4. Checklist de `CHECKPOINTS.md`

### Especificación
- [x] `specs/149-deshacer-asignacion/requirements.md` con EARS numerados R1-R41.
- [x] `design.md` con alternativas descartadas y su porqué (§7: seis alternativas A-F, cada una
      con su razón, incl. "extender `RecuperacionBodegaService`" y "poner `num_guia` a NULL").
- [ ] **`tasks.md` con TODAS las tasks `[x]`** -> **T7.1 y T7.2 siguen en `[ ]`** (nota menor N1).

### Trazabilidad
- [x] Cada R1-R41 mapea a al menos un test concreto (tabla §5; verificado uno a uno, no copiado).
- [x] Bitácora con el mapa `R -> test`: `progress/impl_149_backend.md` +
      `progress/impl_149_frontend.md` (el checkpoint nombra `impl_<feature>.md` en singular; aquí
      van dos por el reparto backend/frontend, variante aceptable, nota menor N6).

### Calidad de código
- [x] `pnpm typecheck` sin errores (medido).
- [x] `pnpm lint` sin errores (medido: 0 errores / 154 warnings).
- [x] `pnpm test` pasa (medido: 527 archivos / 5458 tests, 0 fallos).
- [~] E2E Playwright: no hay spec nueva para la 149 (nota menor N4). El checkpoint lo exige para
      auth/pagos/recaudo/ingesta/webhooks; esto es una transición de estado y sigue el precedente
      de las features 138/139/140, que tampoco añadieron E2E. No lo considero bloqueante.

### Datos y seguridad (Supabase)
- [x] RLS: **no aplica**. La migración es puramente aditiva sobre un enum; no crea tablas ni
      columnas. `orden_historial_estado` conserva la RLS de la feature 49.
- [x] Migración versionada y reversible: `migration.sql` + `down.sql` presentes y coherentes
      (§3.2). `./init.sh` valida la presencia del down.
- [x] Sin secretos hardcodeados: el diff no introduce ninguna credencial ni URL.
- [x] Webhooks: **no se añade ninguno**. La feature encola por el mecanismo existente
      (`appendCambioEstado` -> outbox de `jobs`, transactional-outbox de la 99) dentro de la misma
      transacción; firma e idempotencia son las del emisor ya existente, sin cambios.

### Patrón de capas
- [x] Server Action (`lib/actions/deshacer-asignacion.ts`): zod en el borde, `withErrorHandler`,
      `resolveActorFromSession`, fábrica del service. **Sin queries ni lógica de negocio.**
- [x] Service (`DeshacerAsignacionService`): **no conoce HTTP** (ni Request/Response/headers, ni
      Prisma). Se instancia con tres `Pick` de repos, testeable con dobles puros.
- [x] Repository: solo SQL/Prisma. La normalización del destino y las guardas de coherencia
      zona/destino viven en el service, no en `findOrigenesReversion` (lectura pura).
- [x] Interfaces en `lib/interfaces/` separadas por categoría (`repositories/`, `services/`).

### Permisos
- [x] Autorización server-side por rol Y por zona, resuelta desde la sesión (nunca del cliente).
- [x] Mutación interna vía **Server Action**, no ruta API.
- [x] La UI no es la guardia: el servidor rechaza igual (M10/M11 lo demuestran).

### Multi-país / configuración
- [x] Sin hardcode de país, moneda ni cuenta. La zona central se resuelve por configuración
      (`findCentralZonaId`); si no está configurada, la operación se rechaza con mensaje propio en
      vez de asumir un valor.

### Verificación final
- [x] `./init.sh` termina en verde (exit 0).
- [x] `progress/review_149.md` existe (este archivo).
- [ ] Entrada en `progress/history.md`: pendiente, corresponde al leader al cerrar.

---

## 5. Trazabilidad R1-R41 -> test REAL (verificada, no copiada de `tasks.md`)

Leyenda: **OK** = existe un test que EJERCE el requisito (no un test vacío ni una aserción
tautológica). Archivos abreviados:

- `svc` = `tests/unit/services/deshacer-asignacion-service.test.ts`
- `act` = `tests/unit/actions/deshacer-asignacion.action.test.ts`
- `repo` = `tests/unit/repositories/orden-repository.deshacer-asignacion.test.ts`
- `hist` = `tests/integration/repositories/deshacer-asignacion.historial.test.ts`
- `ui` = `tests/unit/components/deshacer-asignacion.ui.test.tsx`
- `asim` = `tests/unit/services/deshacer-asignacion.cierre-asimetria.test.ts`
- `guard` = `tests/unit/domain/order-status-transiciones.guardia.test.ts`
- `orig149` = `tests/unit/domain/orden-historial-origen-149.test.ts`
- `revers` = `tests/unit/repositories/orden-historial-origenes-reversion.test.ts`
- `sat` = `tests/unit/services/recepcion-satelite-asignadas.test.ts`
- `cob` = `tests/unit/repositories/orden-historial-cobertura.test.ts`
- `tipos` = `tests/unit/types/orden-historial-types.test.ts`

| R | Test que lo ejerce | Verificación del reviewer |
| --- | --- | --- |
| R1 | `svc` (roles autorizados / no autorizados) | **OK** — M11 lo mata |
| R2 | `svc` (rol ajeno -> `forbidden`, sin escritura) | **OK** — M11 lo mata |
| R3 | `svc` (acceso total, cualquier zona) + `repo` (sin guarda de zona con `zonaId=null`) | **OK** |
| R4 | `svc` (zona ajena -> `forbidden` del lote) + `repo` (guarda de zona en el WHERE) | **OK** — M3/M3b lo matan |
| R5 | `svc` (satélite con destino != `en_bodega_satelite` -> `forbidden`) | **OK** — M10 lo mata |
| R6 | `svc` (`adminSatelite` sin zona -> `sin_zona`) | **OK** |
| R7 | `act` ("responde unauthenticated sin construir ni invocar el service") | **OK** |
| R8 | `svc` + `repo` (`"mensajero_asignado_id" = NULL` en el SQL real) | **OK** |
| R9 | `svc` + `repo` (`"asignado_at" = NULL`) | **OK** |
| R10 | `svc` (caso b -> `en_bodega_central`, mensajero y `asignado_at` a NULL) | **OK** |
| R11 | `svc` + `revers` (`DISTINCT ON` por orden, fila más reciente con destino = estado actual) | **OK** — M8 lo mata (10 tests) |
| R12 | `svc` (las 4 filas de la tabla cerrada de normalización) | **OK** |
| R13 | `svc` + `revers` (sin fila / origen NULL / origen fuera de tabla -> `conflict`, sin escritura) | **OK** — M2 lo mata |
| R14 | `svc` (destino central en zona no-central -> `conflict`) | **OK** |
| R15 | `svc` (destino satélite en zona central -> `conflict`) | **OK** |
| R16 | `svc` (estados no reversibles, motivo que nombra el estado) | **OK** |
| R17 | `svc` (`deleted_at` no nulo -> "orden borrada") | **OK** |
| R18 | `svc` (id inexistente -> "orden no existe") | **OK** |
| R19 | `asim` (**ambas direcciones**) + `repo` (UPDATE sin `cierre_dia` ni `NOT EXISTS`) | **OK** — M5a **y** M5b lo matan |
| R20 | `svc` + `repo` (una perdedora aborta el lote; sin historial para la ganadora) + `ui` | **OK** |
| R21 | `svc` (detalle de carrera re-leyendo estado) + `repo` (`DeshacerAsignacionConflictoError`) | **OK** |
| R22 | `act` (motivo ausente / corto / largo / solo-espacios -> `validation_error` en `motivo`) | **OK** — M4 lo mata |
| R23 | `hist` + `repo` (el `motivo` recortado en la fila de historial) | **OK** |
| R24 | `act` + `ui` (un motivo por invocación, aplicado a todo el lote) | **OK** |
| R25 | `orig149` + `tipos` (23.º valor del enum) + `cob` (23.º punto de escritura) | **OK** |
| R26 | `orig149` (fuera de `ORIGEN_TIPOS_CON_GESTION`, no altera intentos) + `repo` (`gestionOrdenId: null`) | **OK** |
| R27 | `guard` (las 3 aristas legales) + `hist` y `repo` (guardia REAL sin mockear) + fixture 140 | **OK** |
| R28 | `guard` (bloque "REGRESION 149/R28", 7 pares siguen ilegales) + conjunto cerrado | **OK** — M1 lo mata |
| R29 | `repo` ("el SET NO menciona num_guia ni prioridad") | **OK** — M7 lo mata |
| R30 | `repo` (ídem, `prioridad`) | **OK** — M7 lo mata |
| R31 | `hist` + `repo` (exactamente una fila, con origen real, destino, actor, tipo y motivo) | **OK** |
| R32 | `hist` (webhook encolado en la MISMA tx; si revierte, no queda job) | **OK** |
| R33 | `hist` + `repo` (rechazada o perdedora -> sin fila ni job) | **OK** |
| R34 | `ui` (acción en el listado del maestro sobre los dos estados) | **OK** |
| R35 | `sat` (bucket `asignadas` por zona) + `ui` (sección y acción) | **OK** |
| R36 | `sat` (caso b NO entra en `asignadas`) + `ui` (sin acción sobre `en_ruta_bodega_satelite`) | **OK** — M9 lo mata; R5 lo bloquea también en servidor |
| R37 | `ui` (botón deshabilitado con motivo inválido, habilitado con válido) | **OK** — M12 lo mata |
| R38 | `ui` (revalidación tras éxito + aviso con el número de órdenes) | **OK** |
| R39 | `ui` (mensaje distinto y accionable por cada `status` y motivo) | **OK** |
| R40 | `svc` (ninguna constante ni motivo contiene UUID; sin destinatario ni teléfono) + `ui` | **OK** |
| R41 | `repo` (**ancla `TODO(146)` + pre-read del mensajero previo**) + `svc` (no notifica) | **OK** — M6 lo mata |

**Los 41 requisitos están cubiertos por un test que los ejerce. Ninguno queda huérfano.**

Observación de calidad (no bloqueante): el primer `it` de T4.14(a)/R41 en `svc`
("no invoca ningún productor de notificaciones") asserta sobre un `vi.fn()` local que nada podría
llamar: es tautológico. **No afecta la cobertura de R41**, cuyo peso real lo llevan el ancla
`TODO(146)` de `repo` (M6 la mata) y el segundo `it` del mismo bloque, que sí modela la salida de
la orden del listado del mensajero. Ver nota menor N5.

---

## 6. Hallazgos

### BLOQUEANTES

**Ninguno.**

### Notas menores (accionables, ninguna bloquea el merge)

**N1 (menor, bookkeeping).** `specs/149-deshacer-asignacion/tasks.md`: **T7.1 y T7.2 siguen
marcadas `[ ]`** pese a estar cumplidas (yo mismo medí el arnés en verde y las bitácoras existen).
`CHECKPOINTS.md` exige literalmente "todas las tasks marcadas `[x]`", así que esto impide el paso
a `done` hasta corregirse. **Acción:** marcar T7.1 y T7.2 como `[x]`.

**N2 (menor, verificación no reproducida).** La bitácora del backend afirma haber hecho el
round-trip real de la migración (deploy -> rollback -> deploy). **No lo reproduje**: exige aplicar
y revertir contra una base real, operación destructiva fuera del mandato del revisor. Verifiqué el
up y el down **por lectura** y ambos son correctos (§3.2), y `./init.sh` valida la presencia del
`down.sql`. **Acción:** ninguna sobre el código; queda registrado que esa afirmación de la
bitácora no está verificada de forma independiente.

**N3 (menor, convención).** No existe un `tests/integration/db/*-migration.test.ts` propio de la
149, a diferencia de los precedentes 106/109/138/139, que cada uno añadió el suyo para asertar el
contenido de su `migration.sql` y su `down.sql`. La 149 solo **actualizó los censos** de los tests
de features anteriores. El `down.sql` de la 149 queda, por tanto, sin test propio.
**Acción sugerida (no bloqueante):** añadir
`tests/integration/db/orden-historial-origen-deshacer-asignacion-migration.test.ts` siguiendo el
molde del 139.

**N4 (menor, alcance).** Sin spec E2E de Playwright para la 149. Consistente con el precedente
inmediato (138/139/140 tampoco añadieron) y con un `tasks.md` aprobado en el gate que no incluía
tarea E2E. **Acción sugerida:** considerarlo si la 146 acaba tocando este flujo.

**N5 (menor, calidad de test).** El `it` "una reversión exitosa no invoca ningún productor de
notificaciones" (T4.14(a), `svc`) es tautológico: asserta que un `vi.fn()` local, no cableado a
nada, no fue llamado. Pasaría con cualquier implementación. **No deja R41 descubierto** (el ancla
de `repo` sí lo cubre y M6 lo confirma), pero conviene reescribirlo o retirarlo para que la suite
no dé una señal falsa de cobertura.

**N6 (menor, nomenclatura).** El checkpoint nombra `progress/impl_<feature>.md`; aquí hay
`impl_149_backend.md` e `impl_149_frontend.md`. Variante razonable por el reparto de agentes; se
registra por completitud.

---

## 7. Estado del árbol

Todas las mutaciones fueron revertidas restaurando los archivos desde copias previas guardadas en
el scratchpad (sin `git checkout`, para no arrastrar cambios ajenos). `git status --porcelain`
verificado **vacío** después de cada mutación y al cierre del review. El único archivo que este
review añade es `progress/review_149.md`.
