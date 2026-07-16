# Review — bloqueo del checkbox por cierre abierto (fix ágil, sin SDD)

Rama: `worktree-bloqueo-checkbox-cierre` · base `origin/dev` `d4b6e48` · fecha 2026-07-16
Alcance: diff vs `origin/dev` + archivos sin trackear. No se evalúa spec/trazabilidad R<n> (patrón `sdd:false`).

## Veredicto: **APROBADO** (0 bloqueantes)

## Checklist

- [x] **Sin `console.log` nuevo.** El `console.log("xyz", catalogo)` del PR #75 está ELIMINADO en `OrdenesTabs.tsx:157`. No hay `console.log/debug/info` en ninguna línea agregada del diff ni en el test sin trackear. Grep sobre `OrdenesTabs.tsx` completo: 0.
- [x] **Hace lo pedido: bloqueo POR ORDEN, no global.** `OrdenesTabs.tsx` deriva `bloqueoSeleccion` de `zonas.has(o.zonaId)` por fila; no hay flag global. Test explícito: "el bloqueo es POR ORDEN, no global: en la misma tab conviven bloqueada y libre".
- [x] **Central (GAM) y satélite con umbral ≥1.** `findZonasConMensajeroBloqueado()` no discrimina por tipo de zona. Tests cubren GAM y satélite.
- [x] **UI vs servidor no divergen** en el camino del maestro. Gate de lectura = causa (i) por zona; guarda de escritura de ruteo (`GuiaAsignacionService.zonasSateliteBloqueadas`) = causa (i) por zona con el mismo `findMensajerosBloqueados`. Mismos estados (`ESTADOS_CIERRE_BLOQUEANTES = ["solicitado","vencido"]`, `OrdenRepository.ts:49`) en ambos lados.
- [x] **SQL correcto.** Relación `cierresRealizados` = `CierreDia[] @relation("CierreMensajero")` (`db/schema.prisma:117`) → filtra por mensajero. Zona sin mensajeros → sin filas → NO bloqueada. Lee `usuario.zonaId` (verdad viva), no el snapshot `cierre_dia.destino_zona_id`. **Sin N+1**: una sola `usuario.findMany` con `distinct: ["zonaId"]`; hay test que asegura `toHaveBeenCalledTimes(1)`.
- [x] **Authz del action nuevo con test real.** `listarZonasBloqueadasPorCierre`: maestro OK, admin OK, mensajero → `forbidden` sin consultar, sin sesión → `unauthenticated` sin consultar.
- [x] **Tests de la 41 actualizados, no aflojados.** Las aserciones se INVIRTIERON al sentido nuevo (`bloqueada: false→true`, `porMensajeros: false→true`); ninguno borrado ni debilitado.
- [x] **Claim del backend_dev sobre la causa (ii): VERIFICADO.** El fixture viejo `run(["m1","m2"], ["m1"], 1)` con la regla ≥1 daría `porMensajeros: true`, así que el test ya no aislaría la causa (ii). Se re-aisló a `run(["m1","m2"], [], 1)` → `porMensajeros: false, porCierreBodega: true`. Correcto y necesario.
- [x] **Copy ≥1.** `guia-decision-error-messages.ts`: "…que tiene al menos un mensajero con un cierre abierto…". El match sigue por substring estable `"bodega satelite bloqueada"`, así que el sufijo del motivo puede cambiar sin romper el mapper.
- [x] **Sin secretos, sin hardcode de contexto, capas separadas** (action → repo por interfaz, inyectable).
- [x] No hay tablas nuevas → RLS no aplica. No hay webhooks → idempotencia/firma no aplica.

## Verificación medida (por mí, no citada)

| | Medido |
|---|---|
| `pnpm typecheck` | **0 errores** |
| `pnpm lint` | **0 errores / 140 warnings** |
| `pnpm test` | **20 failed / 3009 passed (3029)** — 14 archivos fallidos |
| Suites de la feature en aislado | **141 passed / 0 failed** (7 archivos) |

**Discrepancia con lo reportado (16 failed / 3013 passed): es ruido de carga, no regresión.** Clasificación verificada de forma independiente:

- Todos los fallos son timeouts de 5000ms bajo carga (`HomePage*`, `AppLayout`, `OrdenesModuleReuse`, `zona-form`, `no-embalaje`, `RecepcionSateliteModule`, etc.) + los preexistentes ajenos (`EstatusLabel`, `menu-visibility`).
- **Ningún archivo de test de esta feature falla** en la corrida completa.
- Comprobación clave: `CierresAdminModule.test.tsx` fallaba y ese componente SÍ está tocado por el WIP. Levanté un worktree limpio en `origin/dev` (`d4b6e48`) y medí: falla IGUAL en dev al correrse junto a `CierreDiaModule.test.tsx`, y pasa (20/20) en aislado en AMBAS ramas → **contaminación cruzada preexistente, no regresión de este cambio**.

## Hallazgos

Sin bloqueantes.

**menores**

1. `tests/integration/actions/ordenes-guia-action.test.ts` — el test se llama `"mensajero/adminTienda -> forbidden, sin consultar"` pero solo ejercita `mensajero`. `admin_tienda`/`admin_satelite` no se cubren. El código (`rol !== "maestro" && rol !== "admin"`) los rechaza, pero el nombre promete más de lo que afirma: o cubrilos o renombralo.
2. `lib/actions/ordenes-guia.ts:47` — `buildOrdenRepoParaZonasBloqueadas()` es el tercer helper idéntico (`new OrdenRepository(getPrismaClient())`) que solo cambia el tipo `Pick<>`. Duplicación menor, consistente con el patrón ya existente del archivo.
3. `OrdenesTabs.tsx` — `ESTADOS_ASIGNACION` es una lista de strings acoplada por convención a `accionesDe()`. Si mañana una tab gana una acción de asignación y nadie toca este Set, el bloqueo se pierde en silencio. Sin test de guarda que ligue ambas fuentes.

## Notas (no son hallazgos — decisiones del humano)

- Reversión deliberada de la 41 (`porMensajeros` "TODOS" → "≥1"); tests de la 41 cambiados de sentido: esperado y aprobado.
- `en_bodega`: bloquear la fila también impide "Imprimir etiquetas" (checkbox compartido): aceptado.
- La UI ahora bloquea la orden completa aunque queden mensajeros libres en la zona (el servidor por-mensajero permitiría asignar a un libre). Es exactamente la regla ≥1 pedida, no una divergencia a corregir.
- WIP fuera de alcance incluido a propósito: `CierreDiaModule.tsx` / `CierresAdminModule.tsx` / `cierre-detalle-shared.tsx` ocultan secciones sin registros.

## Bonus verificado

`mensajerosFetcher` de `OrdenesTabs.tsx` devolvía un **array** mientras `OrdenesRevisionMaestro.tsx:46` devuelve `{ mensajeros, bloqueadosIds }` bajo la MISMA key SWR `"ordenes:mensajeros"` → formas incompatibles según quién montara primero. El cambio las alinea. Bug latente preexistente corregido de paso.
