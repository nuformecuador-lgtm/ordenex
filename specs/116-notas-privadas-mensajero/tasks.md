# Feature 116 — Mensajero: notas privadas por orden · tasks.md

> Checklist verificable, orquestable como **backend_dev → frontend_dev**. `[B]` backend / `[F]`
> frontend. `[P]` = paralelizable con otras `[P]` del mismo bloque (archivos distintos). Cada task
> trae criterio de "hecho" y los `R` que cubre. **SIN migración** (R15). **Precondición dura:** la
> feature 115 debe estar `done` (crea la tabla `orden_mensajero_meta`, la columna `nota text NULL`,
> su RLS y el repo/JOIN de la tabla meta que 116 extiende). No se toca `feature_list.json` ni
> `progress/`. Baseline VERDE (`./init.sh` + `pnpm test`) al cerrar.

---

## Bloque A — Contratos y tipos (backend) [precede a B]

- [x] **A1. [B]** Crear `lib/types/nota-privada-mensajero.ts`: `guardarNotaSchema`
  (`ordenId` uuid, `nota` string `max(NOTA_MAX)`), `limpiarNotaSchema` (`ordenId` uuid) y los tipos
  de resultado `GuardarNotaResult` / `LimpiarNotaResult` (ver design §4). `NOTA_MAX = 2000` (P1).
  _Hecho:_ `pnpm typecheck` verde; los schemas rechazan `ordenId` inválido y `nota` sobre el máximo. (R13)

- [x] **A2. [B]** Crear `lib/interfaces/services/INotaPrivadaMensajeroService.ts`:
  `guardar(ordenId, nota, actor)` y `limpiar(ordenId, actor)` con sus result types.
  _Hecho:_ interfaz compila y es mockeable en tests. (contrato)

## Bloque B — Repositorio de la tabla meta (backend) [comparte archivos con 115; 116 tras 115 done]

- [x] **B1. [B]** Añadir a `IOrdenMensajeroMetaRepository` + `OrdenMensajeroMetaRepository` (repo de
  la tabla meta de 115; adoptar el nombre real que fije 115): `upsertNota(usuarioId, ordenId, nota)`
  (`upsert` por `usuarioId_ordenId`; `update` toca SOLO `nota`) y `limpiarNota(usuarioId, ordenId)`
  (`updateMany SET nota = null`).
  _Hecho:_ integración/DB: `upsertNota` crea si no existe y edita si existe SIN duplicar fila y
  PRESERVANDO `marcar_luego`; `limpiarNota` deja `nota=NULL` sin borrar la fila y es no-op sin fila. (R1/R2/R3/R4/R9)

## Bloque C — Service (backend) [depende de A, B1]

- [x] **C1. [B]** Crear `lib/services/NotaPrivadaMensajeroService.ts` implementando la interfaz A2:
  `guardar` (rol mensajero → si no `forbidden`; recorta `nota`, vacío → `limpiar`; `upsertNota`;
  FK inexistente → `forbidden`) y `limpiar` (rol mensajero; `limpiarNota`; `ok` idempotente).
  _Hecho:_ unit con doble del repo: crea/edita/limpia; texto en blanco → `nota=NULL`; rol ≠ mensajero
  → `forbidden`; orden inexistente → `forbidden` sin excepción; nunca pasa un `usuario_id` del cliente. (R1/R2/R5/R9/R10/R16)

## Bloque D — Server Actions (backend) [depende de C1]

- [x] **D1. [B]** Crear `lib/actions/notas-privadas-mensajero.ts` (`'use server'`): `guardarNotaPrivada`
  y `limpiarNotaPrivada` con el patrón de `mis-asignaciones.ts` (resolver actor, zod, `withErrorHandler`,
  traducir `VALIDATION_ERROR`/`UNAUTHORIZED`; DI `{ service?, getActor? }`).
  _Hecho:_ unit action: sin sesión → `unauthenticated`; `ordenId`/`nota` inválidos → `validation_error`
  sin efectos; rol ≠ mensajero → `forbidden`; happy path delega en el service. (R10/R13)

## Bloque E — Lectura del DTO (backend) [comparte archivos con 115]

- [x] **E1. [B]** Añadir `notaPrivada: string | null` a `MiAsignacionDTO` (`IMisAsignacionesService.ts`);
  reflejo vía el `Promise.all` de 115 (patrón real, NO JOIN): `findNotasByMensajero(usuarioId):
  Promise<Map<ordenId,nota>>` en el meta-repo (proyección por `usuario_id = actor`) y merge de
  `notaPrivada = notas.get(row.id) ?? null` en `MisAsignacionesService.listarMisAsignaciones` (default
  `null` en `toDTO`). NOTA de reconciliación: 115 refleja `marcarLuego` con un Set del meta-repo dentro
  del `Promise.all`, NO con un JOIN en `MiAsignacionRow`; 116 espeja ese patrón, así que `MiAsignacionRow`
  NO se toca (el spec asumía el JOIN, superado por el código real de 115).
  _Hecho:_ unit servicio: la nota del mensajero A trae SU nota y NUNCA la de B (proyección por
  `usuario_id`); `MiAsignacionDTO.notaPrivada` poblado; una sola query extra (sin N+1). (R6/R8)

## Bloque F — UI del mensajero (frontend) [depende de D1, E1]

- [x] **F1. [F]** Crear `app/(app)/mis-asignaciones/_components/NotaPrivadaMensajero.tsx` (cliente):
  `Textarea` + Guardar + Limpiar (etiqueta "Mi nota", distinta de "Notas"); llama a las Server Actions,
  `toast` + `router.refresh()` en éxito; estado de carga en submit; datos por props
  (`ordenId`, `notaInicial`).
  _Hecho:_ componente: con `notaInicial="x"` muestra "x" y permite editar/limpiar; con `null` muestra
  editor vacío; en éxito refresca. (R11/R14)

- [x] **F2. [F]** Insertar `<NotaPrivadaMensajero ordenId={orden.id} notaInicial={orden.notaPrivada} />`
  como hermano de `<AsignacionDetalle>` en el detalle del mensajero (panel de `MisAsignacionesModule` /
  `renderDetalle` de "Por recoger"), SIN volver interactivo `AsignacionDetalle` (la "Notas" de tienda
  permanece ahí).
  _Hecho:_ componente/integración de render: el detalle muestra DOS campos distintos y etiquetados
  ("Notas" tienda vs. "Mi nota" privada); la privada solo aparece en el contexto del mensajero. (R7/R11)

- [x] **F3. [F] [P]** Indicador/badge de nota privada en la card de "En reparto / por gestionar"
  (`MisAsignacionesModule.tsx`) cuando `orden.notaPrivada` no es `null` (preview truncado, P3).
  _Hecho:_ componente: card con `notaPrivada` presente muestra el indicador; sin nota, no. (R12)

## Bloque G — Verificación y trazabilidad [depende de A–F]

- [x] **G1. [B]** Confirmar **sin migración**: la rama NO añade `db/migrations/*`; `prisma validate`,
  `pnpm typecheck`, `pnpm lint`, `pnpm test`, `./init.sh` verdes contra el esquema de 115.
  _Hecho:_ `git status` sin archivos en `db/migrations/`; CI/local verdes. (R15)

- [x] **G2. [B]** Revisión de seguridad: mensajes de rechazo fijos i18n-ready sin PII; sin
  `console.log` del contenido de la nota; `usuario_id` siempre del actor (nunca del cliente).
  _Hecho:_ unit/lint: motivos sin PII (solo `status` discriminados); `grep` sin `console.*` en los
  archivos nuevos; el service pasa SIEMPRE `actor.usuarioId` (nunca un dato del input). (R17)

- [x] **G3.** Escribir el mapa `R<n> → test` en `progress/impl_116-*.md` (el implementer al ejecutar;
  el reviewer lo verifica).
  _Hecho:_ cada `R1..R17` referencia al menos un test por su ruta. (trazabilidad)

---

## Archivos esperados (para validar conflictos de paralelismo)

> **NO hay migración** (R15). Lo que 116 comparte con 115 debe coordinarse; por eso 116 se
> implementa DESPUÉS de que 115 esté `done`.

### Nuevos (propiedad de 116)
- `lib/types/nota-privada-mensajero.ts` — schemas zod + result types (A1)
- `lib/interfaces/services/INotaPrivadaMensajeroService.ts` — interfaz del service (A2)
- `lib/services/NotaPrivadaMensajeroService.ts` — service con authz (C1)
- `lib/actions/notas-privadas-mensajero.ts` — Server Actions guardar/limpiar (D1)
- `app/(app)/mis-asignaciones/_components/NotaPrivadaMensajero.tsx` — UI editor (F1)
- `tests/unit/services/nota-privada-mensajero-service.test.ts` — C1 (R1/R2/R5/R9/R10/R16)
- `tests/unit/actions/notas-privadas-mensajero-action.test.ts` — D1 (R10/R13)
- `tests/components/NotaPrivadaMensajero.test.tsx` — F1/F2/F3 (R7/R11/R12/R14)

### Modificados / compartidos con 115 (coordinar; 116 tras 115 `done`)
- `lib/interfaces/repositories/IOrdenMensajeroMetaRepository.ts` — +`upsertNota`/`limpiarNota` (B1) *(archivo creado por 115)*
- `lib/repositories/OrdenMensajeroMetaRepository.ts` — impl. de B1 *(creado por 115)*
- `lib/interfaces/repositories/IGestionOrdenRepository.ts` — +`notaPrivada` en `MiAsignacionRow` (E1) *(también tocado por 115 para `marcarLuego`)*
- `lib/interfaces/services/IMisAsignacionesService.ts` — +`notaPrivada` en `MiAsignacionDTO` (E1) *(también 115)*
- `lib/repositories/GestionOrdenRepository.ts` — `nota` en el include + mapeo (E1) *(también 115)*
- `lib/services/MisAsignacionesService.ts` — `notaPrivada` en `toDTO` (E1) *(también 115)*
- `app/(app)/mis-asignaciones/_components/AsignacionDetalle.tsx` — NO se modifica (se renderiza el editor como hermano; F2)
- `app/(app)/mis-asignaciones/_components/MisAsignacionesModule.tsx` — inserción del editor en detalle + indicador en card (F2/F3) *(también 115 para el badge de `marcar_luego`)*
- `tests/unit/repositories/orden-mensajero-meta-repository.test.ts` — casos de `upsertNota`/`limpiarNota` (B1) *(archivo de 115)*
- `tests/components/MisAsignacionesModule.test.tsx` — regresión del indicador de card (F3) *(también 115)*

---

## Mapa R → task/test

| R | Task | Prueba prevista | Zona |
| --- | --- | --- | --- |
| R1 | B1/C1 | integración/unit: `guardar` sin fila → crea con `nota` | B |
| R2 | B1/C1 | `guardar` con nota → edita, no duplica fila | B |
| R3 | B1 | upsert preserva `marcar_luego` | B |
| R4 | B1/C1 | `limpiar` → `nota=NULL` sin borrar fila; no-op idempotente | B |
| R5 | C1 | `guardar` en blanco → `nota=NULL` | B |
| R6 | E1/F3 | repo: solo el autor recibe su nota; card privada por rol | B/F |
| R7 | F2 | detalle: dos campos etiquetados distintos; `orden.notas` intacta | F |
| R8 | E1 | repo: lectura de A no trae la nota de B | B |
| R9 | B1/C1 | escritura de A no toca la fila de B | B |
| R10 | C1/D1 | rol ≠ mensajero → `forbidden`; sin sesión → `unauthenticated` | B |
| R11 | F1/F2 | detalle con/ sin `notaPrivada` (editor + limpiar) | F |
| R12 | F3 | card muestra indicador solo si hay nota | F |
| R13 | A1/D1 | `ordenId`/`nota` inválidos → `validation_error` sin efectos | B |
| R14 | F1 | éxito → `router.refresh()` refleja estado nuevo | F |
| R15 | G1 | CI: sin migración nueva; `prisma validate` OK | B |
| R16 | C1/D1 | orden inexistente → rechazo sin fila huérfana | B |
| R17 | G2 | motivos sin PII; sin `console.log` de la nota | B |

---

## Dependencias y paralelismo

- **Orden:** (115 `done`) → A → (B1 ∥ ) → C1 → D1; E1 en paralelo a C1/D1 (archivos de lectura,
  distintos del service/action); (D1 + E1) → F1 → F2; F3 `[P]` con F2; G tras A–F.
- **backend_dev (B):** A1, A2, B1, C1, D1, E1, G1, G2. **frontend_dev (F):** F1, F2, F3, G3.
- **`[P]` seguros:** F3 ∥ F2 solo si se coordina el diff de `MisAsignacionesModule.tsx` (mismo
  archivo). E1 ∥ C1/D1 (archivos distintos).
- **Conflicto con 115:** B1, E1 y la card de `MisAsignacionesModule` tocan archivos que 115 crea/
  modifica → 116 va DESPUÉS de 115; no correr ambas en paralelo sobre esos archivos.
