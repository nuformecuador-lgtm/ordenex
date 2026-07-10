# Review — Feature 26: Dashboard / apartado del admin de tienda

> Reviewer. Rama `feature/26-dashboard-admin-tienda`. Frontend puro.
> Verificación ejecutada por el reviewer (no solo bitácora).

## Veredicto
**APROBADO** — 0 bloqueantes.

## Estado de verificación ejecutable (corrido por el reviewer)
- `./init.sh`: **verde**. typecheck OK, lint OK, **689/689 tests (78 archivos)**. EXIT 0.
- Suite específica feature 26 + regresión: **21/21** en 5 archivos
  (`AdminTiendaDashboard`, `HomePageRol`, `OrdenesModuleReuse`, `HomePage`, `OrdenesPage`).
- Coincide con la salida de la bitácora del implementer.

## Checklist verificado
- [x] `requirements.md` (R1–R11 EARS), `design.md` (D1–D5 + alternativas A1–A3), `tasks.md` (todas `[x]`).
- [x] Mapa `R<n> → test` presente en `impl_26...md` y en `tasks.md`.
- [x] Trazabilidad R1–R11: cada requisito mapea a un test que **realmente asevera** el requisito (ver tabla).
- [x] Decisiones firmes F1.4 respetadas (MVP solo órdenes; landing `/` condicional server-side; columna "Tienda" oculta sin mutar `ordenes-columns.tsx`; Sidebar intacto).
- [x] Frontend puro: diff no toca backend/DB/actions/RLS/Prisma. Filtrado por tienda delegado a `OrdenService.listar` (feature 6).
- [x] No duplicación (R10): un único `OrdenesModule`; `ordenes/page.tsx` lo consume; cuerpo extraído **idéntico** al original de `origin/dev` (sin cambio funcional).
- [x] Regresión `/ordenes`: `OrdenesPage.test.tsx` verde sin modificar (5 columnas).
- [x] Convenciones: TS strict, sin `any`; nombres/estilo coherentes; typecheck+lint verdes.
- [x] `ordenes-columns.tsx` NO modificado (diff vacío vs `origin/dev`).

## Trazabilidad R → test (todos con aserción real, verificados)
| R | Test | Aserción real |
| - | ---- | ------------- |
| R1 | HomePageRol "R1..." | heading "Panel de tienda" presente + "Bienvenido" ausente |
| R2 | AdminTiendaDashboard "R2..." | heading h1 visible |
| R3 | HomePageRol "R3..." | itera maestro/admin/mensajero/adminSatelite: no dashboard, placeholder |
| R4 | HomePageRol "R4..." | actor null: no dashboard, sin logout |
| R5 | HomePageRol "R5..." | `resolveActorFromSession` invocado server-side; sin hook cliente |
| R6 | AdminTiendaDashboard "R6..." | tabla aria-label "Órdenes" montada + fila |
| R7 | orden-service.test.ts "R21: adminTienda inyecta su tiendaId en el where" | `arg.where.tiendaId === "store1"` (backend feature 6). Frontend sin filtrado propio |
| R8 | AdminTiendaDashboard "R8..." | botón carga masiva presente |
| R9 | AdminTiendaDashboard "R9..." | loading (status)/error (alert)/empty ("No hay órdenes") |
| R10 | OrdenesModuleReuse | `/ordenes` y dashboard montan el MISMO `OrdenesModule`; sin 2ª DataTable/fetch |
| R11 | AdminTiendaDashboard "R11..." | exactamente 4 columnheaders; "Tienda"/"Tienda Secreta" ausentes |

## Dictamen sobre el e2e (punto abierto)
**ACEPTABLE — no bloqueante.** El implementer no creó `e2e/dashboard-admin-tienda.spec.ts`.
Justificación:
- El repo trata sistemáticamente los e2e como **deuda diferida aceptada por el humano**.
  `progress/history.md` lo documenta repetidamente: "E2E sin ejecutar", "E2E diferido de
  ejecución; init.sh no corre `test:e2e`", "feature de UI pura; el E2E de navegación no
  requiere Postgres". No existe infra seed/login para `adminTienda`.
- `CHECKPOINTS.md` exige e2e solo para flujos críticos (auth/pagos/recaudo/ingesta/webhooks).
  Esta feature es composición de UI por rol; el flujo crítico subyacente (segregación por
  tienda) YA está cubierto por test real de backend (`orden-service.test.ts` R21).
- R1 queda cubierto por component test (`HomePageRol`) y R7 por el filtro backend con
  aserción concreta. Cobertura suficiente para la trazabilidad dado el estado del entorno.

## Hallazgos
- **menor** — `tasks.md` T5.3 y su columna del mapa describen un e2e
  (`e2e/dashboard-admin-tienda.spec.ts`, "R7 verificado en e2e") que finalmente NO se creó.
  La tarea está `[x]` pero el artefacto e2e no existe. Inconsistencia documental: el
  requisito SÍ está cubierto (component + backend), pero el texto del tasks/impl debería
  reflejar la omisión justificada en lugar de afirmar el e2e. No afecta la cobertura real.
- **observación** — El código de la feature está en el working tree **sin commitear**
  (archivos untracked + modificados); solo hay un commit de estado. Debe commitearse antes
  del PR. No es defecto de implementación.
- **observación** — R5 se asevera por invocación de `resolveActorFromSession` (server-side)
  + naturaleza Server Component de `page.tsx`; no hay hook de cliente para rol. Correcto.

## Bloqueantes
Ninguno.
