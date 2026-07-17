# Feature 89 — Tasks

> Checklist discreta y verificable. `[P]` = paralelizable con las demás `[P]` del mismo bloque.
> **Zona: backend.** Todas las decisiones del gate están resueltas (ver `requirements.md`
> §Decisiones): no hay gate abierto. No hay tasks de frontend (la causa ya se renderiza hoy).
> Un commit por task lógica (`feat(89): ...` / `test(89): ...`), ver `docs/conventions.md`.

## Bloque 1 — Interfaces (backend) — pueden ir en paralelo

- [ ] **T1a [P]** — `lib/interfaces/repositories/IOrdenRepository.ts`:
  - `countDevueltasByTienda` / `findDevueltasByTienda`: firma `estatusValue: string` →
    `cerrados: string[]`; JSDoc al nuevo predicado ("gestión devuelta vigente + orden abierta").
  - `CausaDevueltaVigente` y `NovedadOrdenRow`: **sin cambios** (no se agrega `motivo`).
  - **Hecho:** typecheck compila; el JSDoc describe el predicado R1–R8.
- [ ] **T1b [P]** — `lib/interfaces/services/INovedadesService.ts`: actualizar JSDoc a la nueva
    semántica ("devuelta vigente y abierta"). Sin cambio de firma.
  - **Hecho:** typecheck compila.

## Bloque 2 — Repositorio (backend) — depende de T1a

- [ ] **T2 [depende T1a]** — `lib/repositories/OrdenRepository.ts`:
  - Extraer un helper privado con el **predicado central** (§2 del design) y usarlo en
    `countDevueltasByTienda` y `findDevueltasByTienda` (garantiza R8: mismo `where`).
  - `where`: `tiendaId`, `deletedAt: null`, `estatus.value NOT IN cerrados`, y relación de
    gestiones `some: { resultado: "devuelta", anuladaAt: null }`. Confirmar el nombre de la
    back-relation contra `schema.prisma`.
  - `findCausasDevueltaVigentes`: **sin cambios** (ya devuelve `{ causa, fecha }`).
  - **Hecho:** typecheck compila; T5 (tests de repo) en verde.

## Bloque 3 — Servicio (backend) — depende de T1a/T1b, T2

- [ ] **T3 [depende T2]** — `lib/services/NovedadesService.ts`:
  - Reemplazar `ESTATUS_DEVUELTA` por `ESTATUS_CERRADOS =
    ["entregada", "devuelta_origen", "recibido_origen"]` (R3) y pasarlo a `count`/`find`.
  - Conservar el mapeo actual a `NovedadDTO` (causa de la gestión vigente más reciente, R10; sin
    `motivo`), rol `adminTienda` (R11), paginación 10 (R12/R13), orden por recencia (R12).
  - **Hecho:** typecheck compila; T4 (tests de service) en verde.

## Bloque 4 — Tests (backend) — pueden ir en paralelo tras T2/T3

- [ ] **T4 [P] [depende T3]** — `tests/unit/services/NovedadesService.test.ts`:
  - Actualizar el patrón existente (feature 87) al nuevo contrato y añadir/ajustar casos:
    - R9: acota `tienda = actor.usuarioId` en count y find.
    - R10: `causa` fluye al DTO desde la gestión vigente más reciente (null si no hay).
    - R11: rol ≠ adminTienda → forbidden (regresión).
    - R12/R13: paginación 10, orden por recencia, shape `{ items, total, page, pageSize }`.
    - R8: count y find se invocan con el MISMO conjunto `cerrados`.
  - **Hecho:** `pnpm test` verde para el archivo; sin asserts triviales.
- [ ] **T5 [P] [depende T2]** — `tests/unit/repositories/orden-repository.novedades.test.ts`:
  - Con doble de Prisma, verificar el `where` construido:
    - R1: orden con gestión `devuelta` vigente y estatus ≠ `devuelta` aparece.
    - R3: orden en `entregada`/`devuelta_origen`/`recibido_origen` NO aparece (`estatus.value notIn`).
    - R4: orden en `en_bodega` (reintento) y en `rechazada` (escalado) SÍ aparecen.
    - R5: orden borrada (`deletedAt`) NO aparece.
    - R6: 2 gestiones vigentes → 1 sola fila, causa de la más reciente.
    - R7: gestión anulada (`anuladaAt` no null) no cuenta; única anulada → no aparece.
    - R8: `count` y `find` construyen el mismo `where`.
  - **Hecho:** `pnpm test` verde para el archivo.

## Bloque 5 — Verificación final

- [ ] **T6 [depende T2..T5]** — Correr `pnpm typecheck`, `pnpm lint`, `pnpm test` y `./init.sh`.
  - **Hecho:** todo en verde; pegar salida real de tests en `progress/impl_89.md` con el mapa
    R→test completo (R1–R13). Ningún requisito sin test (regla del reviewer).

---

## Trazabilidad R → test (mapa que el reviewer verifica)

| R | Task/test |
| --- | --- |
| R1 | T5 (repo: aparece pese a estatus ≠ devuelta) |
| R2 | T5 (repo: orden abierta con gestión vigente incluida) |
| R3 | T5 (repo: estatus cerrado excluye) |
| R4 | T5 (repo: en_bodega + rechazada incluidas) |
| R5 | T5 (repo: borrada excluida) |
| R6 | T5 (repo: 2 gestiones → 1 fila, más reciente) |
| R7 | T5 (repo: anulada no cuenta) |
| R8 | T5 + T4 (mismo where / mismo `cerrados`) |
| R9 | T4 (service: acota tienda) |
| R10 | T4 (service: causa en DTO; null si no hay) |
| R11 | T4 (service: forbidden) |
| R12 | T4 (service: paginación + orden por recencia) |
| R13 | T4 (service: shape de respuesta) |

## Dependencias (resumen)

```
T1a ─> T2 ─┬─> T3 ─> T4
           └──────── T5
T1b (independiente)
todo ─> T6
```

## Alcance de archivos (el implementer confirma)

- `lib/interfaces/repositories/IOrdenRepository.ts` (T1a)
- `lib/interfaces/services/INovedadesService.ts` (T1b)
- `lib/repositories/OrdenRepository.ts` (T2)
- `lib/services/NovedadesService.ts` (T3)
- `tests/unit/services/NovedadesService.test.ts` (T4)
- `tests/unit/repositories/orden-repository.novedades.test.ts` (T5)

**NO se tocan** (decisión #2): `lib/types/novedad.ts`,
`app/(app)/novedades/_components/NovedadesModule.tsx`, `lib/actions/novedades.ts`.
