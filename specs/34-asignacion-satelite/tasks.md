# Feature 34 — Bodega satélite: asignación a mensajeros de su zona · tasks.md

> Backend → frontend. Cada task tiene criterio de "hecho" y su `R<n>`. `[P]` = paralelizable con
> otras `[P]` del mismo bloque. Depende de la aprobación humana F1.4 (resuelve las preguntas
> abiertas (a)–(f)). Las tasks asumen la opción recomendada; si el humano cambia una, se ajusta.

## Bloque 0 — Preparación

- [x] **T0** — Confirmar en F1.4 las decisiones (a)–(f). Marcar la variante elegida en
  `requirements.md`/`design.md`. **Hecho:** F1.4 aprobada y reflejada; sin migración pendiente
  (§1 del design confirma que NO hay cambio de esquema). (R8, R16)

## Bloque 1 — Backend: repositorio (base de todo)

- [x] **T1** `[P]` — (F1.4-b) Renombrar `findMensajerosGam` → `findMensajerosByZona` y
  `findMensajeroIdsValidosGam` → `findMensajeroIdsValidosByZona` en `IOrdenRepository` +
  `OrdenRepository`, y actualizar llamadores de la 17/30 (`GuiaAsignacionService`,
  `lib/actions/ordenes-guia.ts`). **Hecho:** `pnpm typecheck` verde; tests de la 17/30 siguen
  verdes (comportamiento idéntico). (R5, R16) — *Si F1.4-b = reusar tal cual: T1 se omite.*
- [x] **T2** — Añadir `asignarSateliteLote(ordenIds, mensajeroId, zonaId, destinoEstatusId,
  origenEstatusId)` a `IOrdenRepository` + `OrdenRepository`: `updateMany` guardado por
  `estatusId = origen AND zonaId AND deletedAt IS NULL`, devuelve `count`. **Hecho:** test unit de
  repo (o integration) verifica: transiciona solo las que siguen en `en_bodega_satelite` de la
  zona; una en otro estado/zona no se toca; `count` refleja lo transicionado. (R7, R14)

## Bloque 2 — Backend: service (depende de T1, T2)

- [x] **T3** — Definir `IAsignacionSateliteService` + tipos (`AsignarSateliteInput`,
  `AsignarSateliteServiceResult`) en `lib/interfaces/services/`. **Hecho:** interfaz compila; forma
  de resultado espejo de la 17/33 (`ok`/`forbidden`/`sin_zona`/`validation_error`/`conflict`). (R7)
- [x] **T4** — Implementar `AsignacionSateliteService.asignar` (`lib/services/`) con el flujo de
  guardias del design §2.2 (rol → zona → mensajero → órdenes → catálogo → escritura guardada →
  conflict por carrera). **Hecho:** unit tests con dobles de repo cubren:
  - rol != adminSatelite → `forbidden` sin tocar datos (R13).
  - `zonaId = null` → `sin_zona` (R3).
  - mensajero de otra zona / no-mensajero → `validation_error` `mensajero_invalido` (R9).
  - lote OK (todas `en_bodega_satelite` de la zona) → `ok`, todas `en_espera_aceptacion`, con
    `mensajero_asignado_id`, sin tocar `num_guia` (R7, R8).
  - lote con orden de otra zona → `conflict`/`zona_ajena`, ninguna transiciona (R10, R11).
  - lote con orden en estado != `en_bodega_satelite` → `conflict`/`estado_invalido` (R10, R12).
  - lote con orden inexistente/borrada → `conflict`/`no_encontrada` (R10).
  - carrera (write `count` incompleto) → `conflict` sin efectos parciales (R14).

## Bloque 3 — Backend: Server Actions (depende de T3, T4)

- [x] **T5** — (F1.4-c) Añadir `asignarDesdeSatelite(input, deps)` en
  `lib/actions/recepcion-satelite.ts`, patrón `recibirPorQr`: `resolveActorFromSession` →
  `UnauthenticatedError` si no hay actor; `asignarSateliteSchema.parse` (zod) → `validation_error`;
  delega en el service bajo `withErrorHandler`. Schema/tipos en `lib/types/`. **Hecho:** integration
  test: sin sesión → `unauthenticated`; input inválido → `validation_error`; happy path delega y
  devuelve el resultado del service. (R1, R15, R19)
- [x] **T6** `[P]` — Añadir `listarMensajerosSatelite(deps)` (loader del modal): resuelve `zonaId`
  del actor y devuelve `findMensajerosByZona(zonaId)`; rol != adminSatelite → `forbidden`; sin zona
  → lista vacía. **Hecho:** unit/integration: solo mensajeros de la zona del actor; otra zona nunca
  aparece; sin zona → `[]`. (R2, R5, R6)

## Bloque 4 — Frontend: UI (depende de T5, T6)

- [x] **T7** — (F1.4-c) Extender `app/(app)/recepcion-satelite/page.tsx`: pre-fetch de
  `listarMensajerosSatelite()` y paso por props al módulo (Server Component valida rol, datos por
  props). **Hecho:** la página sigue devolviendo `notFound` para no-adminSatelite (R1); mensajeros
  llegan por props. (R1, R2)
- [x] **T8** — Extender `RecepcionSateliteModule.tsx`: sección "Recibidas" con selección múltiple
  (checkbox) y botón "Asignar"; "Por recibir" intacta. **Hecho:** component test: "Recibidas"
  permite seleccionar; "Por recibir" no ofrece asignar (no regresión R7 de la 33). (R4, R7-33)
- [x] **T9** — (F1.4-d) Crear `AsignarSateliteModal` (clon de `AsignarBodegaModal`): `Select` de
  mensajeros de la zona + confirmar → `asignarDesdeSatelite({ ordenIds, mensajeroId })`; éxito →
  `router.refresh()`. Si `mensajeros.length === 0` → estado vacío accionable + "Asignar"
  deshabilitado. **Hecho:** component test: confirmar sin mensajero → error de validación;
  éxito → toast + refresh; zona sin mensajeros → asignar deshabilitado. (R6, R7, R9)

## Bloque 5 — No-regresión y E2E

- [x] **T10** `[P]` — Test de contratos estables: `asignarDesdeBodega` (maestro) y las firmas de
  la 30/33/36 sin cambios de comportamiento; `en_espera_aceptacion` consumible por la 36 igual que
  la central. **Hecho:** suites 17/30/33/36 verdes; type-check verde. (R16, R17)
- [x] **T11** — (F1.4-f, si se aprueba) E2E Playwright del flujo satélite: adminSatelite selecciona
  órdenes `en_bodega_satelite` de su zona → asigna mensajero de su zona → `en_espera_aceptacion`.
  Escrito, ejecución diferida (patrón `e2e/mis-asignaciones.spec.ts`). **Hecho:** archivo E2E
  existe y describe el flujo; documentado como diferido. (R18)

## Bloque 6 — Cierre

- [x] **T12** — Completar tabla `R<n> → test` en `progress/impl_34-asignacion-satelite.md`
  (trazabilidad). **Hecho:** cada R1–R19 mapeado a un test concreto por ruta. (R20)
- [x] **T13** — `./init.sh` verde: `pnpm typecheck`, `pnpm lint`, `pnpm test` pasan. **Hecho:**
  init en verde; sin migración pendiente que verificar (no hay `down.sql` porque no hay esquema
  nuevo, §1 del design). (CHECKPOINTS)

## Dependencias (resumen)

```
T0 → T1[P],T2 → T3 → T4 → T5,T6[P] → T7 → T8 → T9 → T10[P],T11 → T12 → T13
```
