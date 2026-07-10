# Feature 23 — Dashboard del admin maestro · tasks.md

> Frontend puro. Consume feature 22. No tocar backend/DB/actions.
> Marca `[P]` = paralelizable con otras `[P]` del mismo bloque.
> Cada task indica sus `R<n>` y su criterio de "hecho".

## Bloque 0 — Preparación

- [ ] **T0** — Confirmar en `dev` las firmas consumidas: `listarPostulacionesPendientes`,
  `aprobarPostulacion`, `rechazarPostulacion` y los tipos `PostulacionPendienteDTO`,
  `DocumentoFirmadoDTO`, `ListarPostulacionesResult`, `DecisionResult`, `ActionError`.
  _Hecho:_ los imports desde `@/lib/types/aprobacion-postulacion` y
  `@/lib/actions/aprobacion-postulaciones` resuelven sin error de tipos.
  _Req:_ base de R6/R15/R19.

## Bloque 1 — Presentación (paralelizable)

- [ ] **T1 [P]** — `app/(app)/_components/postulacion-documento-labels.ts`: mapa
  `MensajeroDocumentoTipo → etiqueta legible` (los 5 tipos) y orden de render fijo.
  _Hecho:_ exporta el mapa y un array ordenado; typecheck ok. _Req:_ R8.
- [ ] **T2 [P]** — `app/(app)/_components/decision-error-messages.ts`: mapa
  `ActionError.status → mensaje de usuario` (5 status). _Hecho:_ función pura que
  cubre todos los status del union; typecheck ok. _Req:_ R18.
- [ ] **T3 [P]** — `PostulacionCard.tsx` (Client, presentacional): recibe una
  `PostulacionPendienteDTO` y callbacks `onAprobar`/`onRechazar`; renderiza datos
  del mensajero (nulos como guion), enlaces "Ver" por documento (`target="_blank"`,
  `rel="noopener noreferrer"`) y botones Aprobar/Rechazar. _Hecho:_ render sin
  datos de fetch propios; usa `Button` de ui/. _Req:_ R7, R8, R13.

## Bloque 2 — Panel contenedor (depende de T1, T2, T3)

- [ ] **T4** — `PostulacionesPendientesPanel.tsx` (Client): estado `page`/`pageSize`
  (default = PAGE_SIZE_DEFAULT del backend), `useSWR` sobre
  `listarPostulacionesPendientes`; el fetcher lanza si `status !== "ok"`. Render por
  estado: carga, error, vacío, lista de `PostulacionCard` + `Pagination`.
  _Hecho:_ los 4 estados renderizan; Pagination cableado a page/pageSize/total.
  _Req:_ R6, R9, R10, R11, R12. _Dep:_ T3.
- [ ] **T5** — En el mismo panel: flujo de confirmación con `Modal` async. Estado de
  "acción en curso"; `onConfirm` llama `aprobarPostulacion`/`rechazarPostulacion`
  con el `usuarioId`; `ok` → `useToast().success` + `mutate()` (refresco) + cierre;
  `ActionError` → lanza para `onError` → `useToast().error(mapMessage(status))` y
  modal permanece. `confirmVariant="destructive"` en rechazar.
  _Hecho:_ aprobar y rechazar disparan modal, action, toast y refresco.
  _Req:_ R14, R15, R16, R17, R18. _Dep:_ T2, T4.

## Bloque 3 — Dashboard y ramificación de la home (depende de T4/T5)

- [ ] **T6** — `AdminMaestroDashboard.tsx` (Server Component): `PageHeader` +
  `PostulacionesPendientesPanel` como único bloque (patrón `AdminTiendaDashboard`).
  _Hecho:_ renderiza encabezado y panel; sin fetch de datos sensibles por props.
  _Req:_ R5. _Dep:_ T4.
- [ ] **T7** — Modificar `app/(app)/page.tsx`: añadir rama
  `rol === "maestro" || rol === "admin" → <AdminMaestroDashboard />`, **después** de
  la rama `adminTienda` existente y **antes** del placeholder. No alterar la rama
  `adminTienda` ni la de placeholder. _Hecho:_ maestro/admin ven el dashboard;
  adminTienda sigue en Panel de tienda; resto ve "Bienvenido".
  _Req:_ R1, R2, R3, R4. _Dep:_ T6.

## Bloque 4 — Tests (paralelizable; uno por área)

- [ ] **T8 [P]** — `tests/components/HomePageMaestro.test.tsx`: mock de
  `resolveActorFromSession` y de las actions consumidas por el panel. Casos:
  maestro→dashboard, admin→dashboard, adminTienda→Panel de tienda,
  mensajero/adminSatelite/sin sesión→Bienvenido, resolución server-side.
  _Hecho:_ pasa; cubre R1–R4. _Dep:_ T7.
- [ ] **T9 [P]** — `tests/components/PostulacionCard.test.tsx`: datos del mensajero
  (con nulos como guion), 5 enlaces de documento con etiqueta/href/target, botones
  Aprobar/Rechazar. _Hecho:_ pasa; cubre R7, R8, R13. _Dep:_ T3.
- [ ] **T10 [P]** — `tests/components/PostulacionesPendientesPanel.test.tsx` (mock de
  las 3 actions, SWRConfig + ToastProvider + userEvent): listado (R6), paginación
  (R9), carga (R10), vacío (R11), error (R12), abrir modal (R14), invocar action con
  usuarioId (R15), bloqueo/spinner en curso (R16), ok→toast+refresco+fila desaparece
  (R17), error→toast mapeado+fila permanece (R18). _Hecho:_ pasa; cubre R6, R9–R12,
  R14–R18. _Dep:_ T5.
- [ ] **T11 [P]** — Aserción de alcance (R19): verificar que los componentes del
  panel NO importan `lib/services`, `lib/repositories` ni `prisma` (revisión + test
  de import o grep en el review). _Hecho:_ sin imports prohibidos. _Dep:_ T5.

## Bloque 5 — Verificación final

- [ ] **T12** — Actualizar `progress/impl_23-dashboard-maestro.md` con el mapa
  `R<n> → test`. _Hecho:_ todos los R1–R19 mapeados. _Dep:_ T8–T11.
- [ ] **T13** — `pnpm run typecheck`, `pnpm run lint`, `pnpm test` y `./init.sh` en
  verde; la suite de la feature 26 (`HomePageRol.test.tsx`) sigue pasando.
  _Hecho:_ todo verde. _Dep:_ T12.

## Notas de dependencias

- T1, T2, T3 en paralelo. T4 depende de T3; T5 de T2+T4.
- T6/T7 dependen del panel completo (T5).
- Tests (T8–T11) tras sus componentes; T12/T13 al final.
- Bloqueos abiertos (F1.4): A1 (documentos: enlace vs visor), A2 (caducidad URL),
  A3 (rechazo sin motivo). Resolver antes de dar por cerrada la implementación si
  cambian R8/R9/R14.
