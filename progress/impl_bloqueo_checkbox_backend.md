# impl — bloqueo del checkbox por cierre abierto (BACKEND)

Worktree `bloqueo-checkbox-cierre`, base `origin/dev` d4b6e48. Sin commit (por indicación).
Alcance: repositories / services / interfaces / types / server actions / tests. NO se tocó `app/`.

## Decisión implementada (humano, 2026-07-16)

La regla de bloqueo por cierres de mensajero se unifica a **≥1**: una bodega/zona queda
bloqueada si AL MENOS 1 de sus mensajeros tiene un cierre abierto (`solicitado`/`vencido`).
Aplica igual a la central (GAM) y a las satélite. Revierte el ajuste previo de la feature 41
("TODOS los mensajeros"), pedido en su momento por admin_satelite. Una zona SIN mensajeros
NO se bloquea (no hay cierre que resolver).

## Archivos modificados

- `lib/repositories/OrdenRepository.ts`
  - `existeBodegaSateliteBloqueada`: `porMensajeros = cierresAbiertos > 0` (antes
    `totalMensajeros > 0 && cierresAbiertos === totalMensajeros`). Docstring reescrito a la regla nueva.
  - **Nuevo** `findZonasConMensajeroBloqueado(): Promise<Set<string>>` — 1 sola consulta
    agregada (sin N+1): `usuario.findMany` con `rol.value = mensajero`, `zonaId != null`,
    `cierresRealizados.some(estado IN ESTADOS_CIERRE_BLOQUEANTES)`, `distinct: ["zonaId"]`.
    Reutiliza la constante `ESTADOS_CIERRE_BLOQUEANTES` (misma fuente de verdad que
    `findMensajerosBloqueados`), así el gate de lectura no diverge de la guarda de escritura.
    Lee la zona de `usuario.zonaId` (verdad viva), NO de `cierre_dia.destino_zona_id` (snapshot).
- `lib/interfaces/repositories/IOrdenRepository.ts` — bloque doc de `BodegaBloqueoResult`
  reescrito a la regla ≥1; firma nueva `findZonasConMensajeroBloqueado`.
- `lib/services/GuiaAsignacionService.ts` — `zonasSateliteBloqueadas`: `bloqueados.size > 0`;
  docstring reescrito; `MSG_BODEGA_SATELITE_BLOQUEADA` ahora
  `"bodega satelite bloqueada: tiene un mensajero con un cierre abierto"`.
- `lib/types/orden-guia.ts` — **nuevo** `ListarZonasBloqueadasResult`.
- `lib/actions/ordenes-guia.ts` — **nuevo** `listarZonasBloqueadasPorCierre` + `ListarZonasBloqueadasDeps`.

## Contrato del action nuevo

```ts
// lib/actions/ordenes-guia.ts   ("use server")
export interface ListarZonasBloqueadasDeps {
  ordenRepo?: Pick<IOrdenRepository, "findZonasConMensajeroBloqueado">;
  getActor?: () => Promise<Actor | null>;
}
export async function listarZonasBloqueadasPorCierre(
  deps: ListarZonasBloqueadasDeps = {},
): Promise<ListarZonasBloqueadasResult>;

// lib/types/orden-guia.ts
export type ListarZonasBloqueadasResult =
  | { status: "ok"; zonasBloqueadasIds: string[] }
  | { status: "unauthenticated" }
  | { status: "forbidden" };
```

Authz: `maestro` y `admin` leen; resto `forbidden`; sin sesión `unauthenticated` (mismo
criterio que `listarMensajerosParaAsignacion`/`listarCatalogoEstatus`). Deps por parámetro.
Cubre TODAS las zonas (central y satélite).

## Tests

Mapa regla → test:

| Caso | Test |
| --- | --- |
| ≥1 (1 de 3) → bloquea | `tests/unit/repositories/orden-repository.bloqueo.test.ts` |
| TODOS → bloquea (caso extremo) | idem |
| 0 con cierre → no bloquea | idem |
| zona sin mensajeros → no bloquea | idem |
| causa (ii) CierreBodega aislada | idem |
| primitiva nueva: zonas distintas / filtros / vacío / zonaId null | idem |
| service: 1 solo mensajero en cierre → conflict | `tests/unit/services/guia-asignacion-service.test.ts` |
| service: ninguno en cierre → rutea ok | idem |
| action ok / vacío / admin / forbidden / unauthenticated | `tests/integration/actions/ordenes-guia-action.test.ts` |

Tests **actualizados** (no borrados) por la decisión del 2026-07-16:
- `orden-repository.bloqueo.test.ts`: "ALGUNOS (no todos) → NO bloquea" invertido a
  "1 de 3 → bloqueo duro". Causa (ii) re-aislada con `bloqueados = []` (antes usaba 1 de 2,
  que con la regla nueva ya bloquea por (i) y dejaba de aislar la causa).
- `guia-asignacion-service.test.ts`: "si NO todos → rutea ok" invertido a "1 solo → conflict";
  añadido el caso "ninguno → rutea ok" que cubre el ok que ese test cubría antes.
- `guia-decision-error-message.test.ts`: fixture del `motivo` actualizado al texto real.
  El mapper hace match por el substring estable `"bodega satelite bloqueada"`, así que sigue verde.
- 4 fakes de `IOrdenRepository` (`asignacion-mensajero-service`, `bulk-orden-service`,
  `orden-service`, `rol-admin-satelite-authz`): añadido `findZonasConMensajeroBloqueado`
  por exigencia de la interfaz (default: set vacío).

Ninguno se volvió conceptualmente inválido.

## Verificación (medida en este worktree)

El worktree venía sin `node_modules` ni Prisma Client: `pnpm install` + `prisma generate`
(con `DATABASE_URL` dummy; el worktree no tiene `.env`, es gitignored). Sin eso el typecheck
daba falsos "Module '@prisma/client' has no exported member 'Prisma'".

| | Antes | Después |
| --- | --- | --- |
| `pnpm typecheck` | 0 errores | **0 errores** |
| `pnpm lint` | 0 errores, 140 warnings | **0 errores, 140 warnings** |
| `pnpm test` | 16 failed / 3000 passed (3016) | **17 failed / 3009 passed (3026)** |
| Tests tocados (aislado) | — | **203 passed (9 files)** |

Fallos NO míos (ninguno en repositories/services/actions):
- **Reales preexistentes** (fallan en aislado, ajenos a esta feature): `EstatusLabel.test.ts`
  ('En ruta a origen' vs 'Devuelta a origen') y 2 de `menu-visibility.test.ts` (sidebar
  'Ranking'/'Novedades') — vienen de otro WIP en dev.
- **Flakes por carga** (pasan en aislado): `no-embalaje`, `HomePage`, `OrdenesModuleReuse`,
  `RecepcionSateliteModule`, `MisAsignacionesModule`, `AppLayout`, `CierreDia*`,
  `HistorialOrdenTimeline`, `mis-pagos-page`. El set varía entre corridas (16 vs 17), por eso
  el delta de "failed" no es atribuible.

## Pendiente para el frontend (fuera de mi alcance)

`app/(app)/ordenes/_components/guia-decision-error-messages.ts` sigue diciendo "cuyos
mensajeros están **todos** con un cierre abierto". El match no se rompe (es por substring),
pero la copy quedó obsoleta con la regla ≥1. Debe corregirla quien toque `app/`.

## Veredicto

Regla unificada a ≥1 en repo y service, primitiva de lectura nueva para el gate del maestro,
typecheck y lint limpios y todos los tests de mi alcance en verde.
