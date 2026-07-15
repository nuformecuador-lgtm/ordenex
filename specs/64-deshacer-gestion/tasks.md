# Feature 64 — Deshacer gestión: devolver una orden a gestión · tasks.md

> Checklist discreto y verificable. `[P]` = paralelizable (sin dependencia con otras `[P]`
> de su bloque). Cada task cita los `R<n>` que cubre y su criterio de "hecho".
> Regla del repo: un commit por task lógica; nada "hecho" sin `./init.sh` verde y tests
> pasando.
>
> **Bloqueo previo:** no se implementa hasta que el humano cierre F1.4-a..h
> (`requirements.md`). El leader para en `spec_ready`. El plan asume la ruta RECOMENDADA;
> las tasks **(cond.)** cambian si el humano elige otra opción.

## Bloque A — Datos: anulación + enum (R11, R12, R20)

- [x] **T1. Migración `<ts>_gestion_orden_anulacion` (UP).** (F1.4-b, F1.4-d)
  `db/migrations/<ts>_gestion_orden_anulacion/migration.sql`: `anulada_at TIMESTAMP(3)` +
  `anulada_por TEXT` + FK → `usuario` (`ON DELETE SET NULL`) + índice de la FK + índice
  PARCIAL `(mensajero_id) WHERE cierre_id IS NULL AND anulada_at IS NULL` +
  `ALTER TYPE "orden_historial_origen_tipo" ADD VALUE IF NOT EXISTS 'deshacer_gestion'`.
  Generada con `pnpm run db:migrate:create` (no aplica sola). NO toca RLS (sin tabla nueva).
  **Hecho:** el SQL existe, es aditivo y no altera columnas/policies preexistentes.
- [x] **T2. `down.sql` de T1 (OBLIGATORIO).** (depende de T1)
  Orden inverso: enum recreado sin `deshacer_gestion` (la columna `origen_tipo` NO tiene
  DEFAULT) → índice parcial → índice FK → constraint FK → columnas. Precondición documentada
  en comentario: 0 filas con `origen_tipo='deshacer_gestion'`.
  **Hecho:** `pnpm run db:migrate` y luego `pnpm run db:rollback` corren limpio en una DB de
  test y el esquema queda idéntico al previo.
- [x] **T3. `db/schema.prisma`.** (depende de T1)
  `GestionOrden.anuladaAt/anuladaPor` + relación `anuladaPorUsuario` (`"GestionAnuladaPor"`);
  contra-relación en `Usuario`; `OrdenHistorialOrigenTipo += deshacer_gestion`. Luego
  `pnpm prisma generate` (memoria del repo: sin `generate` el typecheck falla en falso).
  **Hecho:** `pnpm typecheck` 0; `prisma migrate diff`/`db:migrate` sin drift.
- [x] **T4. [P] Fuente única del enum.** (depende de T3)
  `lib/types/orden-historial.ts`: añadir `"deshacer_gestion"` a
  `ORDEN_HISTORIAL_ORIGEN_TIPO_SEED` (el chequeo de exhaustividad rompe el build si falta).
  **Hecho:** `tests/unit/types/orden-historial-types.test.ts` verde con 12 valores.
- [x] **T5. Test de migración.** (depende de T2) [P]
  `tests/integration/db/gestion-orden-anulacion-migration.test.ts` (patrón de
  `cierre-estado-vencido-migration.test.ts`): columnas + FK + índice parcial + valor de enum
  presentes; `gestion_orden` conserva su RLS.
  **Hecho:** test verde (R11/R12).

## Bloque B — Backend: exclusión de anuladas (R13–R17) — money-critical

> Depende de T3. Es el bloque que evita el bug silencioso en el camino del dinero.

- [x] **T6. `CierreDiaRepository.findGestionesPendientes` += `anuladaAt: null`.**
  **Hecho:** `tests/unit/repositories/cierre-dia-repository.test.ts` verifica el WHERE
  `{ mensajeroId, cierreId: null, anuladaAt: null }` (R13/R14/R15).
- [x] **T7. `CierreDiaRepository.crearCierre` += `anuladaAt: null`** en el `updateMany` que
  VINCULA gestiones al cierre. (depende de T3)
  **Hecho:** test dedicado — una gestión anulada NO recibe `cierre_id` al solicitar el cierre
  (R16). **Sin este test la feature no pasa review** (design §8).
- [x] **T8. [P] `CorteDiarioRepository.findMensajerosConActividadSinCierre` += `anuladaAt: null`.**
  **Hecho:** `tests/unit/repositories/*corte*` — un mensajero cuya única gestión pendiente
  está anulada NO entra al corte (R17).

## Bloque C — Backend: contador de intentos derivado (R24–R28) — F1.4-a

> Depende de T3, T4. Independiente del Bloque B.

- [x] **T9a. [P] `ORIGEN_TIPOS_CON_GESTION` en `lib/types/orden-historial.ts`.** (depende de T4)
  `["gestion","deshacer_gestion"] as const satisfies readonly OrdenHistorialOrigenTipo[]`:
  las familias que enlazan una gestión (fuente única, `design.md` §4.2).
  **Hecho:** compila; el `satisfies` rompe si un valor no existe en el enum.
- [x] **T9. `IOrdenHistorialRepository`: `contarPorDestino` → `contarPorDestinoVigentes`.**
  (depende de T9a) WHERE:
  `{ ordenId, estatusDestinoId, OR: [ { gestionOrdenId: null, origenTipo: { notIn: [...ORIGEN_TIPOS_CON_GESTION] } }, { gestion: { anuladaAt: null } } ] }`.
  Se reemplaza (único call-site) para no dejar método muerto. **NO usar el predicado ingenuo
  `gestionOrdenId: null` a secas: la FK es `ON DELETE SET NULL` y la nulidad es ambigua**
  (`design.md` §4.1).
  **Hecho:** `tests/unit/repositories/orden-historial-repository.test.ts` — (1) cuenta la
  transición sin gestión con `origenTipo: "ajuste_estado"` (R25); (2) NO cuenta la de gestión
  anulada (R24); (3) **NO cuenta la huérfana** (`origenTipo: "gestion"` + `gestionOrdenId: null`)
  (R26); (4) cuenta la de gestión vigente.
- [x] **T10. `OrdenHistorialService.contarIntentos` consume `contarPorDestinoVigentes`.**
  (depende de T9)
  **Hecho:** `tests/unit/services/orden-historial-service.test.ts` — con 1 `devuelta`
  anulada + 1 vigente el conteo es 1 (R24); la línea de tiempo expone ese mismo `intentos`
  (R28) y `findHistorialByOrden` sigue devolviendo TODAS las filas (R23).
- [x] **T11. Regresión del escalado (R27).** (depende de T10)
  **Hecho:** `tests/unit/services/mis-asignaciones-service.test.ts` — con umbral 3, dos
  `devuelta` de las cuales una está anulada, la siguiente `devuelta` es REINTENTO (no
  escalado a `rechazada`).
- [x] **T11b. (cond. F1.4-i) FK `gestion_orden_id` → `ON DELETE RESTRICT`.**
  **Solo si el humano aprueba (i).** Migración propia
  `<ts>_orden_historial_gestion_fk_restrict` (DROP + ADD CONSTRAINT) **+ `down.sql`** que
  restaura `ON DELETE SET NULL`, **+ `schema.prisma`**: `@relation(..., onDelete: Restrict)`
  en `OrdenHistorialEstado.gestion`. Sin el cambio en el modelo, el próximo reconcile vuelve
  a pisar la FK (`design.md` §7.6). No mezclar con la migración de T1.
  **Hecho:** `tests/integration/db/*-fk-restrict-migration.test.ts` verifica
  `pg_constraint.confdeltype = 'r'`; `prisma migrate diff` sin drift; `db:rollback` limpio.
  **Si (i) se rechaza:** marcar `[—] N/A` y confirmar que el riesgo queda documentado en
  `design.md` §8 (la feature es correcta igual: T9 no depende de la FK).

## Bloque D — Backend: el deshacer (R1–R6, R18–R23, R29, R30, R32, R34)

> Depende de T3, T6.

- [x] **T12. Interfaces.**
  `ICierreDiaRepository`: `findGestionParaDeshacer`, `findUltimaGestionNoAnuladaId`,
  `anularGestionYDevolverAGestion` (+ tipo `GestionDeshacerRow`).
  `ICierreDiaService`: `deshacerGestion(gestionId, actor)` + `DeshacerGestionServiceResult`
  (`ok|forbidden|conflict|validation_error`).
  **Hecho:** compila; contratos documentados con el `R` que sostienen.
- [x] **T13. Lecturas del repo.** (depende de T12)
  `findGestionParaDeshacer` (gestión + `orden: { deletedAt, estatusId, estatusValue }`) y
  `findUltimaGestionNoAnuladaId` (`orderBy createdAt desc`, `anuladaAt: null`). Solo queries.
  **Hecho:** tests de repo verifican los WHERE/select (R4/R6).
- [x] **T14. Escritura atómica del repo: `anularGestionYDevolverAGestion`.** (depende de T12)
  Una `$transaction`: (1) `updateMany gestion_orden` guardado por
  `{ id, mensajeroId, cierreId: null, anuladaAt: null }` → `anulada_at`/`anulada_por`;
  (2) `updateMany orden` guardado por `{ id, estatusId: esperado, deletedAt: null }` →
  `en_reparto` + `mensajeroAsignadoId`; (3) `appendCambioEstado` con
  `origenTipo: "deshacer_gestion"` + `gestionOrdenId`. Sentinela → `false` (rollback). NO
  toca `usuario.orden_en_gestion_id`.
  **Hecho:** `tests/unit/repositories/cierre-dia-repository.test.ts` — happy path (3 pasos en
  la MISMA tx, R22), `count 0` en (1) o en (2) → `false` sin efectos (R2/R3/R5), append con
  actor y enlace correctos (R20/R21), puntero intacto (R29).
- [x] **T15. Regla del service: `CierreDiaService.deshacerGestion`.** (depende de T13, T14)
  Las 8 guardias de `design.md` §5.2 + `ESTADOS_ESPERADOS` (§5.3) + `findEstatusIdByValue`
  (`en_reparto`) añadido al `Pick` del `ordenRepo`. Mensajes accionables (constantes
  i18n-ready, patrón `MSG_*` del archivo).
  **Hecho:** `tests/unit/services/cierre-dia-service.test.ts` cubre R1–R6, R8, R9, R18, R19,
  R30, R32, R34 con dobles (sin DB/red).
- [x] **T16. Server Action `deshacerGestion(gestionId)`.** (depende de T15)
  `lib/actions/cierre-dia.ts`: zod (`z.string().uuid()`) en el borde → `validation_error`
  (R10); `resolveActorFromSession` → `UnauthenticatedError` → `unauthenticated` (R7); todo
  bajo `withErrorHandler`; `DeshacerGestionResult` en `lib/types/cierre.ts`. Reusa
  `CierreDiaDeps`.
  **Hecho:** `tests/integration/actions/cierre-dia-action.test.ts` — sin sesión →
  `unauthenticated` sin tocar el service (R7); id inválido → `validation_error` (R10); rol ≠
  mensajero → `forbidden` (R8).

## Bloque E — Frontend: acción por fila (R35–R38)

> Depende de T16. **T16 ESTÁ HECHA: el contrato del backend está cerrado y verde.**
> El frontend consume la Server Action ya existente:
> ```ts
> import { deshacerGestion } from "@/lib/actions/cierre-dia";
> const r = await deshacerGestion({ gestionId }); // ← objeto, no string (zod: { gestionId: uuid })
> // r: { status:"ok"; ordenId } | { status:"forbidden" } | { status:"conflict"; motivo }
> //  | { status:"validation_error"; fieldErrors } | { status:"unauthenticated" }
> ```
> `conflict.motivo` ya trae el texto accionable listo para el toast (R38); `mensajeError`
> del módulo ya sirve `conflict`/`validation_error`. El DTO de fila ya expone `gestionId`.

- [x] **T17. Botón "Devolver a gestión" por fila en las 4 tablas.**
  `CierreDiaModule.tsx`: `columnasPara(resultado, verEvidencia, onDeshacer)` + columna
  "Acciones" (`Button size="sm" variant="outline"`), `rowKey` ya es `gestionId`.
  **Hecho:** hay un botón por fila en entregada/reprogramada/devuelta/rechazada (R35).
  *Nota:* la suite del módulo ya existía en **`tests/components/CierreDiaModule.test.tsx`**
  (no en `tests/unit/components/cierre-dia-module.test.tsx`, que no existe): se EXTENDIÓ esa
  en vez de crear un archivo duplicado. Accesibilidad: `aria-label` por fila que nombra SU
  orden (`Devolver a gestión la orden <numRemision> · <destinatario>`, patrón 59/36).
- [x] **T18. Confirmación + mutación + refresh.** (depende de T17)
  `Modal` de confirmación (R36); `deshacerGestion({ gestionId })`; `ok` → `toast.success` +
  `router.refresh()` (R37); error → `toast.error(mensajeError(result))` sin tocar tabla ni
  totales (R38). Botón de la fila deshabilitado mientras está en vuelo.
  **Hecho:** test — sin confirmar (y al cancelar) no se llama la action; al confirmar se llama
  con el `gestionId` de la fila; en error se muestra el motivo del `conflict` tal cual.
  *Hallazgo:* mientras el `Modal` está abierto, Base UI deja el fondo `inert`/`aria-hidden`
  → la tabla NO es alcanzable durante la confirmación. La ventana real del doble-submit es
  entre el `ok` y la llegada del `router.refresh()`: ahí `deshaciendo` mantiene deshabilitado
  el botón de ESA fila (los demás siguen activos).
- [x] **T19. [P] Gestión anulada ausente de la vista (R13).** (depende de T6)
  **Hecho:** test de integración/servicio — una gestión con `anulada_at` no aparece en
  ningún grupo ni suma a `totales`/`totalPagoMensajero`/`totalIngresoBodegaRechazos`.

## Bloque F — Verificación y cierre

- [x] **T20. Actualizar el test de cobertura de la 49.** (depende de T14)
  `tests/unit/repositories/orden-historial-cobertura.test.ts`: añadir el call-site **#12**
  (`CierreDiaRepository` / `anularGestionYDevolverAGestion` / `deshacer_gestion`) e importar
  el repo. Documentar que `findGestionParaDeshacer`/`findUltimaGestionNoAnuladaId` NO
  escriben estado.
  **Hecho:** el test enumera 12 puntos y pasa (R21).
- [x] **T21. E2E del flujo crítico.** (depende de T18)
  Extender `e2e/cierre-dia.spec.ts`: mensajero gestiona `entregada` → la fila aparece y suma
  al total → "Devolver a gestión" + confirmar → la fila desaparece, el total baja y la orden
  reaparece en `/mis-asignaciones` como `en_reparto`.
  **Hecho:** E2E ESCRITO (nuevo `describe` "mensajero deshace una gestión (feature 64)") con
  sus precondiciones de seed documentadas. **NO EJECUTADO**: mismo diferimiento explícito que
  el resto del archivo y de `e2e/mis-asignaciones.spec.ts` — los E2E exigen dev server + DB
  real sembrada y **no corren bajo `pnpm test`**. Queda pendiente de ejecución cuando exista
  el entorno E2E (nada que esta feature pueda cerrar por sí sola).
- [x] **T22. Trazabilidad R→test.** (depende de todo lo anterior) — **COMPLETA.**
  Mapa **R1–R38 → test** consolidado en `progress/impl_64-deshacer-gestion.md` (R1–R34 backend,
  R35–R38 frontend en `tests/components/CierreDiaModule.test.tsx`). Cada `R<n>` cita ≥1 test verde.
  El reviewer reprodujo la trazabilidad por su cuenta y la dio por completa.
  **Corrección:** este archivo apuntaba a `tests/unit/components/cierre-dia-module.test.tsx`, que
  **no existe**; el frontend extendió la suite real `tests/components/CierreDiaModule.test.tsx` en
  vez de crear un duplicado. Filas R35–R38 corregidas.
- [x] **T23. Verificación ejecutable final.** (depende de T22) — **COMPLETA, con 2 criterios
  IMPOSIBLES por deuda AJENA (feature 65), documentados en vez de maquillados.**
  Medido por el leader y **re-medido de forma independiente por el reviewer**:
  · `pnpm test` → **296 archivos / 2764 tests / 0 fallos** (con `--testTimeout=20000`).
  · `pnpm typecheck` → **2 errores = baseline EXACTO, 0 nuevos**.
  · `pnpm lint` → **0 errores** (138 warnings preexistentes, ninguno en archivos de la 64).
  · `prisma migrate status` → 47 OK · `migrate diff` → **"No difference detected"** (sin drift).
  · Round-trip REAL de **ambas** migraciones contra Postgres vivo (deploy → verificar → down →
    verificar → deploy); el reviewer lo repitió en una tx con `ROLLBACK`: los 2 `down.sql` corren
    limpio y devuelven el esquema exacto. Estado vivo: enum **12**, FK `confdeltype='r'`
    (**RESTRICT**), RLS `gestion_orden` true / 0 policies.
  · Sin regresión de 36/37/39/41/47/49/56.
  **Los 2 criterios que NO se pueden cumplir, y por qué NO son de esta feature:**
  1. **`pnpm build` FALLA** — y falla en `lib/repositories/TarifaVigentePorZonaRepository.ts:22`
     (`'zonaId' does not exist in type 'TarifaWhereInput'`). Next.js typechequea al construir, así
     que **hoy `dev` NO COMPILA**: es la **feature 65**, no la 64. Consecuencia que conviene no
     perder de vista: ese bug no es solo "runtime al aprobar un cierre" — **bloquea el despliegue**.
  2. **`./init.sh` exit 0 es IMPOSIBLE** — con el gate ya honesto (PR #67), corta en ROJO en
     typecheck por esos mismos 2 errores de la 65, sin llegar a los tests. Por eso la verificación
     se hizo con `pnpm test`/`typecheck`/`lint` **directos**, y así se reporta: sin apoyarse en un
     gate que hoy no llega a ejecutarse.
  **Deuda registrada (no bloqueante):** `pnpm run db:rollback` no alcanza la 1.ª de las 2
  migraciones (ordena por nombre, no por estado aplicado: limitación **preexistente** de
  `scripts/db-rollback.ts`); el `down.sql` se aplicó con `prisma db execute` — mismo SQL, mismo
  efecto verificado. Flake ambiental ajeno: `tests/components/HomePage.test.tsx` (~5043ms contra el
  límite default de 5000ms) cae o pasa según la carga; pasa con `--testTimeout=20000` y la 64 no
  tocó la home ni sus dependencias.

> **Nota del implementer backend (F1.4-i APROBADA):** T11b **SÍ se implementó**, completa —
> `onDelete: Restrict` en `schema.prisma` **+** migración propia
> `20260714170000_orden_historial_gestion_fk_restrict` con su `down.sql`, sin mezclarla con
> T1. Verificado vivo contra Postgres: el `DELETE` de una gestión enlazada al historial ahora
> **falla** con `orden_historial_estado_gestion_orden_id_fkey (SQLSTATE 23001)`; antes lo
> vaciaba en silencio. `design.md` §7.6 deja de ser una decisión abierta.

---

## Tabla de trazabilidad R → test

| R | Verificación (test) |
| --- | --- |
| R1 | `cierre-dia-service.test.ts` → gestión `cierreId: null` + no anulada → `ok` |
| R2 | idem → `cierreId` ≠ null → `conflict`, repo de escritura NO llamado |
| R3 | idem → `anuladaAt` ≠ null → `conflict` sin efectos |
| R4 | idem → existe gestión posterior no anulada → `conflict` |
| R5 | idem → estado de la orden fuera de `ESTADOS_ESPERADOS` → `conflict` (uno por resultado) |
| R6 | idem → `orden.deletedAt` ≠ null → `conflict` |
| R7 | `cierre-dia-action.test.ts` → sin actor → `unauthenticated`, service NO llamado |
| R8 | idem → rol ≠ mensajero → `forbidden` |
| R9 | `cierre-dia-service.test.ts` → gestión de otro mensajero → `forbidden`, sin datos |
| R10 | `cierre-dia-action.test.ts` → `gestionId` no-uuid → `validation_error` |
| R11 | `cierre-dia-repository.test.ts` → `data: { anuladaAt, anuladaPor }`; `gestion-orden-anulacion-migration.test.ts` → columnas + FK |
| R12 | `cierre-dia-repository.test.ts` → el `update` NO toca resultado/monto/método/motivo/fecha/evidencia/mensajero/createdAt |
| R13 | `cierre-dia-service.test.ts` / `cierre-dia-repository.test.ts` → anulada ausente de los 4 grupos |
| R14 | `cierre-dia-service.test.ts` → `totales` sin la anulada |
| R15 | idem → `totalPagoMensajero` y `totalIngresoBodegaRechazos` sin la anulada |
| R16 | `cierre-dia-repository.test.ts` → `crearCierre` NO pone `cierre_id` a una anulada (money-critical) |
| R17 | `corte-diario-repository.test.ts` → mensajero con solo anuladas fuera del corte |
| R18 | `cierre-dia-repository.test.ts` → `orden.estatusId = <en_reparto>` |
| R19 | idem → `mensajeroAsignadoId = gestion.mensajeroId` (incl. caso reintento que lo limpió) |
| R20 | idem → `appendCambioEstado` con origen real, destino `en_reparto`, actor, `gestionOrdenId`, `origenTipo: "deshacer_gestion"` |
| R21 | `orden-historial-cobertura.test.ts` → call-site #12 enumerado |
| R22 | `cierre-dia-repository.test.ts` → los 3 pasos en la MISMA `$transaction`; fallo → 0 efectos |
| R23 | `orden-historial-service.test.ts` → `findHistorialByOrden` devuelve TODAS las filas; ningún update/delete de historial |
| R24 | `orden-historial-repository.test.ts` → no cuenta destino `devuelta` de gestión anulada |
| R25 | idem → sí cuenta destino `devuelta` con `gestionOrdenId: null` **y** `origenTipo` fuera de la familia gestión (`ajuste_estado`) |
| R26 | idem → **NO** cuenta la HUÉRFANA: `origenTipo: "gestion"` + `gestionOrdenId: null` (FK `SET NULL`, `design.md` §4.1) |
| R27 | `mis-asignaciones-service.test.ts` → con un intento anulado, la siguiente `devuelta` es REINTENTO, no escalado |
| R28 | `orden-historial-service.test.ts` → `obtenerHistorial().intentos` = conteo vigente |
| R29 | `cierre-dia-repository.test.ts` → `usuario.update` NO invocado en el deshacer |
| R30 | `cierre-dia-service.test.ts` → mensajero con OTRA orden en gestión → deshacer `ok` |
| R31 | `mis-asignaciones-service.test.ts` → orden devuelta a `en_reparto` es escogible (guardia 1-a-1 vigente) |
| R32 | `cierre-dia-service.test.ts` → `storage.remove` NUNCA invocado; `evidenciaStoragePath` intacto |
| R33 | `cierre-dia-service.test.ts` (existente) → evidencia solo por URL firmada (sin regresión) |
| R34 | `cierre-dia-service.test.ts` + `cierre-dia-repository.test.ts` → deshacer `entregada` no toca wallet/tienda/pago (los feeds leen por `cierreId`) |
| R35 | `tests/components/CierreDiaModule.test.tsx` → `it.each` de las 4 tablas: botón por fila (+ 1 botón por fila con `aria-label` que nombra SU orden; tabla vacía → sin acción) |
| R36 | idem → "pulsar la acción NO ejecuta el deshacer: pide confirmación explícita" + "cancelar NO invoca la action" + la confirmación nombra la orden y avisa del rastro |
| R37 | idem → "invoca la action con el gestionId de ESA fila (objeto, no string)" + "éxito → toast de éxito y refresh" (la fila/los totales los recalcula el SERVIDOR) |
| R38 | idem → `conflict` → toast con el motivo del server + fila y totales intactos y `refresh` NO invocado; `forbidden`/`validation_error`/`unauthenticated` → mensaje accionable; tras error el botón vuelve a estar disponible |

## Dependencias (resumen)

```
T1 → T2 → T5 [P]
T1 → T3 ─┬→ T4 → T9a [P] → T9 → T10 → T11   (Bloque C, contador derivado)
         ├→ T6 ──┐
         ├→ T7   │                          (Bloque B, money-critical)
         ├→ T8 [P]
         └→ T12 ─┬→ T13 ─┐
                 └→ T14 ─┴→ T15 → T16 → T17 → T18 → T21
                    (T6 ──┘)                   └→ T19 [P]
T14 → T20
T11b (cond. F1.4-i) — independiente; NO se mezcla con T1/T2
(todo) → T22 → T23
```
