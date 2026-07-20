# Impl 87 — Novedades: lista de órdenes devueltas con contacto (adminTienda)

> Rama `feature/87-novedades-devueltas` (worktree `ordenex-f87`, desde `origin/dev` @ 243090a).
> Zona fullstack. **Sin migración**: solo lectura + UI (la causa de devolución existe desde la feature 73).
> Ciclo SDD: spec_author → gate F1.4 (humano) → backend_dev → frontend_dev → reviewer.

## Qué entrega

Rellena la página `/novedades` (antes un stub `<PageHeader>` vacío) con la lista paginada de las
órdenes en estatus **`devuelta`** de la tienda del `adminTienda` en sesión, cada una con su
**causa de devolución** (última gestión vigente, feature 73) y botones de **contacto**
(llamar / WhatsApp) al cliente. Solo el rol `adminTienda`.

De paso extrae los botones de contacto a un componente compartido `ContactoButtons` y **corrige el
bug heredado** de WhatsApp sin código de país: ahora normaliza a E.164 Costa Rica (`+506`).

## Decisiones del gate F1.4 (humano, 2026-07-17)

1. "En devolución" = estatus **`devuelta`** (no `devuelta_origen` ni `rechazada`): el único con causa capturada.
2. Identificador visible = **`numGuia`** (nullable → placeholder si falta).
3. Orden = **más recientes primero**, por fecha de la última gestión `devuelta` vigente (fallback `createdAt`).
4. **Con paginación** (10/página, patrón features 7/8).
5. Coherencia con feature 67: se confía en que anular la gestión saca la orden del estatus; causa NULL → "Sin causa registrada".
6. Normalización teléfono: 8 díg → `506…`; `506`/`+` respetados; otras longitudes sin prefijar.

## Mapa R → test

| R | Requisito | Test |
|---|-----------|------|
| R1 | Lista solo estatus `devuelta` | `tests/unit/services/NovedadesService.test.ts` (pide `devuelta`) |
| R2 | Acota a `tiendaId = actor.usuarioId` | `NovedadesService.test.ts` (usa `OTRA_TIENDA`) |
| R3 | Excluye otros estatus | `NovedadesService.test.ts` + repo `where.estatus.value` |
| R4 | Excluye borradas (`deletedAt: null`) | `tests/unit/repositories/orden-repository.novedades.test.ts` |
| R5 | Rol ≠ adminTienda → forbidden (sin tocar repo) | `NovedadesService.test.ts` (mensajero + maestro) |
| R6 | Causa = última gestión vigente | service R6 + repo "reduce a la fila más reciente" |
| R7 | Sin gestión / causa nula → null → "Sin causa registrada" | service R7 + `NovedadesModule.test.tsx` |
| R8 | Una consulta agregada de causas (sin N+1) | repo "UNA consulta, times(1)" + service (no llama en vacío) |
| R9 | Fila: guía/placeholder, destinatario, causa, contacto | `tests/components/NovedadesModule.test.tsx` |
| R10 | Estado vacío | `NovedadesModule.test.tsx` |
| R11 | Causa en etiqueta ES (no slug) | `NovedadesModule.test.tsx` ("Cliente no localizado", `queryByText("not_found")` null) |
| R12 | Dos botones de contacto | `tests/components/ContactoButtons.test.tsx` |
| R13 | 8 dígitos → `506########` | `tests/unit/utils/telefono-cr.test.ts` |
| R14 | `506…`/`+…` respetado | `telefono-cr.test.ts` |
| R15 | WhatsApp `wa.me/506…` | `ContactoButtons.test.tsx` (`wa.me/50688887777`) |
| R16 | Llamar `tel:` | `ContactoButtons.test.tsx` (`tel:88887777`) |
| R17 | `GestionarOrdenPanel` reusa `ContactoButtons` (no inline) | `tests/components/MisAsignacionesModule.test.tsx` ("R17/R15: el detalle reusa ContactoButtons…", afirma `wa.me/506…`, se rompe si vuelve a inline) |
| R18 | Page: rol ≠ adminTienda / sin sesión → notFound | `tests/components/NovedadesPage.test.tsx` |
| R19 | Page: action ≠ ok → notFound (defensa en profundidad) | `NovedadesPage.test.tsx` |
| R20 | Sidebar "Novedades" solo adminTienda | `tests/unit/auth/menu-visibility.test.ts` (adminTienda sí; mensajero/maestro/adminSatelite no) |
| R21 | Orden más recientes primero (fecha gestión desc, fallback createdAt) | `NovedadesService.test.ts` |
| R22 | Respuesta `{ items, total, page, pageSize }` + paginación | service R22 (skip derivado) + repo count/skip/take + `NovedadesModule.test.tsx` (Pagination) |

22/22 requisitos con test que afirma el comportamiento.

## Verificación (medida por backend_dev, frontend_dev y reviewer independiente)

- **typecheck**: 0 (baseline 0 mantenido).
- **lint**: 0 errores, 140 warnings (todos preexistentes en otros archivos).
- **tests de la feature**: verdes en aislado (NovedadesService + orden-repository.novedades 14/14; telefono-cr + menu-visibility 18/18; NovedadesPage 5/5; ContactoButtons + NovedadesModule + MisAsignaciones 33+ ).
- **suite completa**: 2 rojos, **ambos ajenos y medidos por el reviewer**: `HomePage` (flake de timeout 5000ms, pasa en aislado) y `CierreDiaPage > "Entregadas"` (deuda preexistente de `dev`, entró con el PR #82; diff de la 87 sobre ese archivo = vacío). Ninguno imputable a la 87.

## Notas de arnés

- Criterio de "gestión vigente" verificado contra el código real (`GestionOrden.anuladaAt IS NULL`,
  `resultado: "devuelta"`), el mismo que `OrdenHistorialRepository.contarPorDestinoVigentes` (feature 67).
  Spec y código coincidieron; sin divergencia.
- Sin drift en `OrdenRepository` (imán histórico): solo se añaden 3 métodos al final + `gestionOrden`
  al `Pick` del cliente Prisma; nada preexistente modificado. Los 4 fakes de `IOrdenRepository` tocados
  solo ganan los stubs exigidos por el crecimiento de la interfaz.
- Deuda ajena que impide `./init.sh` 100% verde: el rojo de `CierreDiaPage` de `dev` (PR #82) — no es
  de esta feature; se resuelve aparte.
