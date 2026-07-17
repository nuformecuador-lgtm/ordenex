# Feature 87 — Tasks

> Checklist de pasos discretos y verificables. `[P]` = paralelizable (sin dependencia con
> otra task no terminada). Zona **fullstack**: tasks BE (backend_dev) y FE (frontend_dev)
> separadas. **NO hay task de migración**: feature solo lectura (la causa existe desde la 73).

## Backend (backend_dev)

- [x] **T1 — Tipo `NovedadDTO`** en `lib/types/novedad.ts`.
  Campos: `id, numGuia: number|null, destinatario, telefonoDest, causa:
  GestionCausaDevolucion|null`. Serializable (cruza borde RSC). Identificador visible =
  `numGuia` (F1.4 #1). *Hecho:* el tipo compila y se importa desde el service. `[P]`

- [x] **T2 — Métodos de repo** en `lib/repositories/OrdenRepository.ts` +
  `IOrdenRepository`:
  - `countDevueltasByTienda(tiendaId, estatusValue)` → `count` con `tiendaId`,
    `deletedAt: null`, `estatus.value = estatusValue` (R22).
  - `findDevueltasByTienda(tiendaId, estatusValue, { skip, take })` → mismo `where`,
    `orderBy createdAt desc` (fallback R21), `skip`/`take` (R2/R3/R4/R22); select
    `id, numGuia, destinatario, telefonoDest, createdAt`.
  - `findCausasDevueltaVigentes(ordenIds)` → una consulta `gestion_orden` con
    `resultado: "devuelta", anuladaAt: null`, `orderBy createdAt desc`, reduce a
    `Map<ordenId, { causa, fecha }>` con la fila más reciente (R6/R7/R8).
  *Hecho:* los tres métodos en la interfaz y en la clase; tests de repo (T7) pasan.
  Depende de: T1.

- [x] **T3 — Interface + Service** `lib/interfaces/services/INovedadesService.ts` y
  `lib/services/NovedadesService.ts`.
  `listar({ page, pageSize }, actor)`: `forbidden` si rol ≠ `adminTienda` (R5); cuenta total
  (R22); lista la página de devueltas de la tienda (R1/R2/R3/R4/R22); une causas (R6/R7);
  devuelve `{ status:"ok", items, total, page, pageSize }`. Orden por fecha de gestión desc
  (R21, fallback documentado).
  *Hecho:* service con DI por constructor (`Pick<IOrdenRepository,...>`), sin HTTP/Prisma;
  tests unit (T6) pasan. Depende de: T1, T2.

- [x] **T4 — Server Action** `lib/actions/novedades.ts` (`'use server'`).
  `listarNovedadesAction(input?)`: valida `page` con zod (default 1, `pageSize` fijo 10),
  resuelve actor, instancia repo+service, delega en `service.listar`. Sin lógica ni queries.
  *Hecho:* la page (T13) y el módulo (T12) la consumen; devuelve `{ items, total, page,
  pageSize }`. Depende de: T3.

## Backend — tests

- [x] **T5 — `[P]` Test normalización** `tests/unit/utils/telefono-cr.test.ts`:
  8 dígitos → `506########` (R13); `506...`/`+...` respetado (R14); longitudes atípicas sin
  prefijo. *Hecho:* cubre R13/R14. Depende de: T9.

- [x] **T6 — Test service** `tests/unit/services/NovedadesService.test.ts`:
  R1 (solo `devuelta` de la tienda), R2 (acota tienda), R3 (excluye otros estatus),
  R5 (rol ≠ adminTienda → forbidden), R6 (última gestión vigente), R7 (sin causa),
  R21 (orden más recientes primero), R22 (respuesta `{ items, total, page, pageSize }`).
  *Hecho:* mapa R→test cubierto con repo mockeado. Depende de: T3.

- [x] **T7 — Test repo** `tests/unit/repositories/` (o integración con DB de test):
  R4 (excluye borradas), R8 (una consulta agregada para las causas, sin N+1),
  R22 (skip/take + count).
  *Hecho:* R4/R8/R22 verificados. Depende de: T2.

## Frontend (frontend_dev)

- [x] **T9 — `[P]` Normalización** `lib/utils/telefono-cr.ts`:
  `normalizarTelefonoCR(raw)` según design §3.4 (R13/R14). Pura, sin side-effects.
  *Hecho:* función exportada; T5 pasa.

- [x] **T10 — Componente compartido** `components/shared/ContactoButtons.tsx`:
  props `{ telefono, nombre, size? }`; botón Llamar `tel:` (R16); botón WhatsApp
  `wa.me/<normalizado>` (R12/R15). Usa `normalizarTelefonoCR` (T9).
  *Hecho:* renderiza ambos botones; T11 pasa. Depende de: T9.

- [x] **T11 — `[P]` Test ContactoButtons** `tests/components/ContactoButtons.test.tsx`:
  R12 (dos botones), R15 (`wa.me/506...`), R16 (`tel:`). Depende de: T10.

- [x] **T12 — Módulo** `app/(app)/novedades/_components/NovedadesModule.tsx`:
  recibe `{ items: NovedadDTO[], total, page, pageSize }`; estado vacío (R10); por fila
  muestra `numGuia` (o placeholder si null, R9), destinatario, causa ES
  (`CAUSA_DEVOLUCION_LABEL[causa] ?? "Sin causa registrada"`, R7/R9/R11) +
  `<ContactoButtons/>`; `<Pagination>` al pie con re-fetch por `listarNovedadesAction({ page })`
  (R22, patrón `MiWalletModule`). Client component privado (datos por props).
  *Hecho:* T14 pasa. Depende de: T1, T4, T10.

- [x] **T13 — Page** `app/(app)/novedades/page.tsx` (reemplaza el stub):
  guardia `notFound` si rol ≠ adminTienda / sin sesión (R18); `listarNovedadesAction`;
  `notFound` si `status !== "ok"` (R19); renderiza `PageHeader` + `NovedadesModule`.
  Molde `mi-wallet/page.tsx`. *Hecho:* T15 pasa. Depende de: T4, T12.

- [x] **T14 — `[P]` Test módulo** `tests/components/NovedadesModule.test.tsx`:
  R9 (fila con guía/destinatario/causa/contacto; placeholder si `numGuia` null), R10 (vacío),
  R11 (label ES, no slug), R22 (render de `Pagination` con total/page). Depende de: T12.

- [x] **T15 — Test page** (guardia de rol):
  R18 (rol ≠ adminTienda → notFound), R19 (action ≠ ok → notFound). Depende de: T13.

## Sidebar (frontend_dev)

- [x] **T16 — Restringir item "Novedades"** `lib/auth/menu-visibility.ts:81-88`:
  `roles: ["adminTienda"]` (quita `mensajero`) + actualizar comentario (R20). `[P]`
  *Hecho:* build compila; T17 pasa.

- [x] **T17 — Actualizar test menu** `tests/unit/auth/menu-visibility.test.ts`:
  quitar "Novedades" de la lista esperada del mensajero y sus asserts; conservarla para
  adminTienda; añadir assert de que mensajero NO la ve (R20). Depende de: T16.

## Cierre

- [x] **T18 — Trazabilidad + verificación**: `progress/impl_87.md` con el mapa `R1..R22 →
  test`; `pnpm run typecheck`, `pnpm run lint`, `pnpm test` y `./init.sh` en verde.
  Depende de: todas.

## Orden sugerido / paralelismo

- Frente BE: T1 → T2 → T3 → T4; tests T6/T7 tras sus deps.
- Frente FE: T9 → T10 → T12 → T13; tests T5/T11/T14/T15 tras sus deps.
- T16/T17 (sidebar) independientes → `[P]` desde el inicio.
- T18 al final.
