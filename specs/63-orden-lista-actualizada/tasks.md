# Feature 63 — Orden lista actualizada · tasks.md

> Checklist discreto y verificable. `[P]` = paralelizable (sin dependencia con
> otras `[P]` de su grupo). Cada task lleva su criterio de "hecho".
> Regla del repo: un commit por task lógica; nada "hecho" sin `./init.sh` verde y
> tests pasando.

## Grupo A — Backend: endpoint `order_status` (R1–R5)

- [ ] **A1.** Tipos del resultado del catálogo en `lib/types/order-status.ts` (o
  junto a la action): `ListarOrderStatusResult` discriminado
  (`ok` | `unauthenticated` | `forbidden`).
  **Hecho:** compila; tipo exportado y usado por la action.
- [ ] **A2.** Server Action `listarOrderStatus()` en
  `lib/actions/order-status.ts` (`'use server'`): resuelve actor, autoriza
  (maestro/admin/adminTienda/adminSatelite ok; mensajero/otro → forbidden; sin
  sesión → unauthenticated), reusa `IOrdenRepository.listOrderStatus()`. Depende de A1.
  **Hecho:** action tipada, con `deps` inyectables (`getActor`, `ordenRepo`).
- [ ] **A3.** [P] Garantizar orden determinista en
  `OrdenRepository.listOrderStatus()` (añadir `orderBy` si falta).
  **Hecho:** el `findMany` incluye `orderBy` estable; test de repo lo verifica.

## Grupo B — Backend: filtro genérico `filter` (R6–R11)

- [ ] **B1.** [P] Añadir `ordenFilterSchema` (`.strict()`, whitelist
  `status_id`) y `filter?` opcional en `listarOrdenesSchema` (`lib/types/orden.ts`);
  exportar `ORDEN_FILTER_FIELDS`.
  **Hecho:** clave fuera de whitelist produce ZodError; `estatusId` escalar intacto.
- [ ] **B2.** Traducir `filter` a `where` en `OrdenService.listar` con mapa
  explícito `FILTER_TO_COLUMN = { status_id: "estatusId" }`, con precedencia de
  `filter.status_id` sobre `estatusId` escalar; compone con alcance por rol.
  Depende de B1.
  **Hecho:** `where.estatusId` se setea desde `filter.status_id`; adminTienda sigue
  acotado a lo suyo.

## Grupo C — Frontend: primitiva Tabs + componente (R12–R20)

- [ ] **C1.** [P] Agregar primitiva shadcn: `npx shadcn add tabs` →
  `components/ui/tabs.tsx`.
  **Hecho:** el archivo existe y exporta `Tabs/TabsList/TabsTrigger/TabsContent`.
- [ ] **C2.** Extender `OrdenesModule` con prop opcional
  `filter?: { status_id: string }` que inyecta a `listarOrdenes` y a la key SWR
  (`["ordenes:list", statusId, page, pageSize]`). Sin la prop, comportamiento
  idéntico (sin regresión, R10/R19). Depende de B2.
  **Hecho:** con `filter` el fetch envía `filter` y la caché/paginación es por status.
- [ ] **C3.** Nuevo `app/(app)/ordenes/_components/OrdenesTabs.tsx` (cliente):
  SWR sobre `listarOrderStatus()`, deriva tabs = catálogo − `exclude` (por
  `value`, default `["pendiente"]`), monta `OrdenesModule` por tab; montaje
  diferido por tab visitada (lazy, R16). Depende de A2, C1, C2.
  **Hecho:** tab no visitada NO llama `listarOrdenes`; tab activa muestra sus órdenes.
- [ ] **C4.** `TabsList` con overflow horizontal usable para ~13 tabs (R18).
  Depende de C3.
  **Hecho:** con ≥13 tabs no se rompe el layout ni se ocultan tabs.
- [ ] **C5.** Wiring en `app/(app)/ordenes/page.tsx`: montar `OrdenesTabs` con
  `exclude` por rol para roles ≠ mensajero; mensajero sin cambios (R20). Depende de C3.
  **Hecho:** cada rol ≠ mensajero ve las tabs; `/mis-asignaciones` intacto.

## Grupo D — Tests (trazabilidad) y cierre

- [ ] **D1.** Tests unitarios/integración por requisito (ver tabla R→test).
  Depende de A/B/C.
  **Hecho:** cada `R<n>` tiene test verde.
- [ ] **D2.** `./init.sh` verde + suite completa. Depende de D1.
  **Hecho:** init en verde, sin tests rojos nuevos.
- [ ] **D3.** Actualizar `progress/impl_63-orden-lista-actualizada.md` con el mapa
  R→test. Depende de D1.

---

## Tabla de trazabilidad R → test

| R | Verificación (test) |
| --- | --- |
| R1 | `tests/unit/actions/order-status.test.ts` → devuelve `{status:"ok", estatus:[{id,value}]}` |
| R2 | idem → ok para maestro/admin/adminTienda/adminSatelite |
| R3 | idem → sin actor → `unauthenticated`, repo NO llamado |
| R4 | idem → mensajero/otro → `forbidden`, repo NO llamado |
| R5 | `tests/unit/repositories/orden-repository.guia.test.ts` → `listOrderStatus` con `orderBy` determinista |
| R6 | `tests/unit/types/orden-filter.test.ts` → `listarOrdenesSchema` acepta `filter` |
| R7 | idem → clave fuera de whitelist → ZodError / `validation_error` |
| R8 | `tests/unit/services/orden-service.test.ts` → `filter.status_id` → `where.estatusId` |
| R9 | idem → filtro por estado + adminTienda acotado a su tienda |
| R10 | idem → sin `filter` = comportamiento previo; `estatusId` escalar sigue |
| R11 | `tests/unit/types/orden-filter.test.ts` → ninguna columna arbitraria pasa el schema |
| R12 | `tests/unit/components/ordenes-tabs.test.tsx` → renderiza `Tabs`, una tab por estado |
| R13 | idem → `exclude` no genera tab para esos estados |
| R14 | idem → tabs derivadas del catálogo menos `exclude` |
| R15 | idem → tab activa consulta `listarOrdenes` con `filter.status_id` |
| R16 | idem → tab no visitada NO invoca `listarOrdenes` (mock sin llamadas) |
| R17 | idem → paginación por tab independiente (key SWR por status) |
| R18 | idem → `TabsList` con clase overflow / accesible con muchas tabs |
| R19 | `tests/unit/components/ordenes-module.test.tsx` → `OrdenesModule` con/sin `filter` sin regresión |
| R20 | `tests/unit/components/ordenes-tabs.test.tsx` (o page) → mensajero no monta tabs |

## Dependencias (resumen)

```
A1 → A2 ─┐
A3 [P]   │
B1 [P] → B2 ─┐        C1 [P]
            └→ C2 ────┴→ C3 → C4
                           └→ C5
(A2,B2,C*) → D1 → D2/D3
```
