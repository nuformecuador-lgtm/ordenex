# Feature 171 — Desglose del dinero por tienda en la wallet · tasks

> Orden obligatorio: **verificación previa → backend → frontend → guardias → cierre**.
> `[P]` = puede correr en paralelo con las otras `[P]` de su mismo bloque (ficheros disjuntos).
> Cada task lleva su **criterio de hecho**: si no se puede comprobar, la task está mal escrita.
> Zona `fullstack` ⇒ se secuencia `backend_dev` y luego `frontend_dev`.
> Regla del arnés: **nada se marca `[x]` sin que pasen `./init.sh` y la suite completa**.
> Esta feature **no lleva migración** (design §3): si alguna task acaba pidiendo una, el
> diseño falló — se para y se avisa al leader.

---

## T0 — Verificación previa (bloquea T1)

- [ ] **T0.1 — Resolver el conflicto de calendario con la 170 (P5).** La Tanda I de la 170
  pagina server-side «Saldos de tiendas» y toca `SaldosTiendasTable.tsx`,
  `wallet/tiendas/page.tsx`, `lib/actions/wallet-tienda.ts`, `lib/types/wallet-tienda.ts`,
  `WalletTiendaService` y `WalletTiendaMovimientoRepository` — los mismos que esta feature.
  *Hecho:* el leader deja escrito en `progress/current.md` si la 171 arranca (170 en `done` o
  reordenada) o queda bloqueada. Sin esa línea no se abre T1.
- [ ] **T0.2 [P] — Confirmar P1 (textos de los cuatro importes) y P4 (columna de tienda en el
  archivo).**
  *Hecho:* respuesta anotada, o se aplican los *defaults* de `requirements.md` dejando
  constancia expresa de que se aplicaron.
- [ ] **T0.3 [P] — Fijar la línea base de las guardias de la 170.** Correr
  `pnpm vitest run tests/unit/descarga` y anotar los cuatro totales vigentes (25 / 30 / 25 / 31).
  *Hecho:* los cuatro números quedan escritos en `progress/impl_171-desglose-por-tienda.md`.
  Son los que T2.6 tendrá que ver **fallar** antes de actualizarlos.

---

## T1 — Backend (`backend_dev`). Bloquea T2

- [ ] **T1.1 — Tipos y schemas del desglose** en `lib/types/wallet-tienda.ts`:
  `DesgloseTiendaDTO`, `ListarMovimientosDeTiendaResult`,
  `ListarMovimientosDeTiendaCompletoResult`, `listarMovimientosDeTiendaSchema` (deriva del
  schema del listado con `tiendaId` REQUERIDO) y `listarMovimientosDeTiendaCompletoSchema`
  (`.omit({page,pageSize}).strict()`). Sin tocar los tipos existentes.
  *Hecho:* `pnpm run typecheck` en verde y un test de schema que comprueba: `tiendaId` ausente
  o vacío ⇒ error; `page`/`pageSize` en el schema completo ⇒ error por `.strict()`. (R22, R25)
- [ ] **T1.2 [P] — Derivación pura** `lib/utils/desglose-tienda.ts`: `CUBETA_POR_CATEGORIA`
  (`Record` exhaustivo sobre `WalletTiendaMovimientoCategoria`) y `derivarDesgloseTienda`.
  `Prisma.Decimal` de punta a punta, salida STRING escala 2, signo calculado aquí. **No** se
  toca `lib/utils/saldo-tienda.ts`.
  *Hecho:* `tests/unit/utils/desglose-tienda.test.ts` en verde con: (a) recorrido de
  `WALLET_TIENDA_MOVIMIENTO_CATEGORIA_SEED` comprobando que cada categoría tiene cubeta y que
  concuerda con el `tipo` con que el sistema la emite (R8/R9); (b) `saldo = aFavor − cargos −
  pagado` en positivo, negativo y cero (R10); (c) conjunto con `pago_tienda` ⇒ ese monto sale
  en `pagado` y **no** en `cargos` (R43); (d) conjunto sin pagos ⇒ `pagado === "0.00"` (R43);
  (e) los cuatro campos son `string` con dos decimales (R23).
- [ ] **T1.3 — Repositorio**: `agregarDesglosePorTienda(tiendaId, filtros)` en la interfaz y en
  `WalletTiendaMovimientoRepository` — un `groupBy(["tipo","categoria"])` reutilizando
  `buildFiltrosWhere`, con `tiendaId` en el WHERE. Salida STRING. Los métodos existentes no se
  modifican.
  *Hecho:* test en `tests/unit/repositories/wallet-tienda-movimiento-repository.test.ts` que
  captura el argumento del `groupBy` y afirma que el `where` lleva `tiendaId` y los filtros, y
  que la salida es STRING (R24).
- [ ] **T1.4 — Servicio**: `listarMovimientosDeTienda` y `listarMovimientosDeTiendaCompleto` en
  `IWalletTiendaService` + `WalletTiendaService`. Guard `esAccesoTotal` **antes** de tocar el
  repositorio; `construirFiltros` reutilizado; `tiendaId: input.tiendaId` escrito **al final**
  del objeto que va al repositorio; tope `descargaConfig.MAX_FILAS` con `pageSize: limite + 1`
  en el modo completo. `listarMisMovimientos*` y `listarSaldosTiendas` intactos.
  *Hecho:* `tests/unit/services/wallet-tienda-desglose.test.ts` en verde con:
  - `maestro` y `admin` ⇒ `ok` con movimientos, total, página, tamaño y `desglose` (R22, R26);
  - `mensajero`, `adminSatelite` y `adminTienda` ⇒ `forbidden` **sin** movimientos ni importes,
    y **cero** llamadas al repositorio (R27);
  - **contraprueba**: `adminTienda` pidiendo su PROPIO `tiendaId` ⇒ `forbidden` (R28);
  - input con `tiendaId` legítimo + claves extra ⇒ el repositorio recibe exactamente ese
    `tiendaId` (R24);
  - los importes reflejan los filtros aplicados (R12) y, sin filtros, coinciden con
    `derivarSaldoTienda` sobre el mismo conjunto (R11);
  - **exactamente 2** llamadas al repositorio por lectura, con `pageSize` 20 y 100 (R34), y
    **ninguna** de nombre de tienda (R35);
  - modo completo: `limite_excedido` sin `items` (R39/R40) y sin llamar a
    `agregarDesglosePorTienda`.
- [ ] **T1.5 — Server Actions** `listarMovimientosDeTiendaAction` y
  `listarMovimientosDeTiendaCompletoAction` en `lib/actions/wallet-tienda.ts`, con el mismo
  esqueleto que las cuatro existentes (`resolveActorFromSession` → `UnauthenticatedError` →
  `schema.parse` → service bajo `withErrorHandler`).
  *Hecho:* `tests/unit/actions/wallet-tienda-desglose-action.test.ts` en verde: sin sesión ⇒
  `unauthenticated` y **cero** llamadas al service (R29); `tiendaId` ausente/vacío ⇒
  `validation_error` y cero llamadas al service (R25); `page` colada en el modo completo ⇒
  `validation_error`; ninguna rama de error devuelve filas (R40).
- [ ] **T1.6 — No regresión del backend existente.**
  *Hecho:* `tests/unit/services/wallet-tienda-service.test.ts`,
  `tests/unit/services/wallet-tienda-descarga.test.ts`,
  `tests/unit/actions/wallet-tienda-actions.test.ts` y
  `tests/unit/actions/wallet-tienda-descarga-action.test.ts` pasan **sin editar ni una
  aserción** (R31, R6, R49).

---

## T2 — Frontend (`frontend_dev`). Depende de T1

- [ ] **T2.1 [P] — Etiquetas** `app/(app)/wallet/tiendas/_components/desglose-tienda-labels.ts`:
  cabeceras de los cuatro importes (P1), etiquetas de filtros, vacío y error. Las etiquetas de
  `tipo`, `concepto` y `origen` y el helper `money` se **leen** de
  `mi-wallet/_components/mi-wallet-labels` (precedente ya vigente en `SaldosTiendasTable.tsx:8`);
  el estado del saldo se lee de `saldo-tienda-signo-label` (R13). Nada duplicado.
  *Hecho:* test que afirma la **identidad** de los mapas de concepto y origen con los de
  `/mi-wallet` (mismo objeto, no una copia con los mismos valores) (R20) y que el mapa de signo
  es el de la tabla de saldos (R13).
- [ ] **T2.2 [P] — Columnas de export**
  `app/(app)/wallet/tiendas/_components/desglose-tienda-descarga-columnas.ts`: módulo PURO
  (sin React), `COLUMNAS_DESCARGA_DESGLOSE_TIENDA` + `filaDescargaDesgloseTienda`. Solo
  `fecha · tipo · concepto · monto · origen`; nada de `id`, `tiendaId`, `origenId` ni
  `registradoPor`. Monto STRING tal cual, sin símbolo. **Solo esos dos exports** (la guardia
  ejecuta con una sonda toda función exportada del módulo).
  *Hecho:* `tests/unit/descarga/desglose-tienda-descarga-columnas.test.ts` en verde y
  `tests/unit/descarga/columnas-sensibles.guardia.test.ts` **sigue en verde** habiendo
  descubierto el módulo nuevo (R41).
- [ ] **T2.3 — Componente** `app/(app)/wallet/tiendas/_components/DesgloseMovimientosTienda.tsx`:
  cabecera de cuatro importes en el orden de R7, formulario de filtros (cierre / concepto /
  desde / hasta), `DataTable` con las cinco columnas, `Pagination`, y `useSWR` **dentro** del
  componente con la clave del helper exportado `claveDesgloseTienda`. Prop opcional
  `acciones?: ReactNode` renderizada en la cabecera; ausente ⇒ ningún contenedor. Recibe
  `tiendaId`, `tiendaNombre` y el saldo de la fila por props (no los pide al servidor).
  Money-safe: los montos se pintan tal cual, sin `parseFloat`/`Number`.
  *Hecho:* compila, y el componente **no** importa ninguna acción de escritura ni construye
  ningún formulario de pago (R47).
- [ ] **T2.4 — Cablear el desplegable** en `SaldosTiendasTable.tsx`: `renderExpanded` +
  `expandAriaLabel` (`Ver desglose de <tienda>`), sin tocar columnas, datos, estado vacío ni la
  descarga existente de la tabla.
  *Hecho:* la tabla de saldos sigue pintando lo mismo y su descarga sigue siendo `filasLocales`
  sobre las props (R6).
- [ ] **T2.5 — Descarga del desglose**: prop `descarga` del `DataTable` del desglose con título
  `Desglose de <tienda>` y `obtenerFilas: () => filasDesdeResultado(listarMovimientosDeTiendaCompletoAction(…), filaDescargaDesgloseTienda)`,
  cerrando sobre los filtros vigentes y **sin** `page`/`pageSize`.
  *Hecho:* con dos filas abiertas hay dos controles con nombre accesible distinto (R38); el
  input que se manda no lleva paginación (R37).
- [ ] **T2.6 — Censo y guardias de la 170.** Añadir la entrada de
  `DesgloseMovimientosTienda.tsx` a `CENSO_DATATABLE` (`con_descarga`) y actualizar los cuatro
  totales de `cobertura-tablas.guardia.test.ts`: 25→**26** archivos, 30→**31** instancias,
  25→**26** `con_descarga`, 31→**32** censadas (`fuera` sigue en 6).
  *Hecho:* se deja constancia en `progress/impl_171-desglose-por-tienda.md` de que la guardia
  **falló primero** con los totales viejos (prueba de que vigila) y de que quedó en verde
  después (R42).
- [ ] **T2.7 — Test de pantalla** `tests/integration/wallet-tiendas-desglose.test.tsx`
  (patrón de `wallet-mensajeros-page.test.tsx`: `SWRConfig` con caché aislada + `ToastProvider`).
  *Hecho:* en verde con:
  - render de la tabla con varias tiendas ⇒ **cero** llamadas a la action del desglose (R32);
  - expandir una fila ⇒ **exactamente una** llamada, con el `tiendaId` de esa fila (R33, R2);
  - dos filas abiertas ⇒ dos desgloses con estado independiente; filtrar en una no vuelve a
    consultar la otra (R3, R36);
  - nombres accesibles del desglose, del formulario y del control de descarga con el nombre de
    la tienda (R4);
  - la action falla ⇒ el error se ve dentro de esa fila y la tabla de saldos sigue en pie (R5);
  - los cuatro importes en el orden de R7, con los valores STRING que devolvió el servidor y
    sin recálculo (R14), y el saldo sin filtros idéntico al de la fila (R11);
  - las cinco columnas en orden, la más reciente primero, y la etiqueta legible de concepto y
    origen (R15, R16, R20);
  - paginación server-side y filtros que reinvocan la action y vuelven a la página 1 (R17,
    R18, R19); conjunto filtrado vacío ⇒ mensaje explícito (R21);
  - opción `pago_tienda` presente en el filtro de concepto (R44);
  - prop `acciones` presente ⇒ el nodo aparece en la cabecera; ausente ⇒ no hay contenedor
    extra (R45);
  - `mutate` sobre `claveDesgloseTienda(tiendaId, …)` refresca **solo** ese desglose (R46).
- [ ] **T2.8 [P] — Test de la página** `tests/integration/wallet-tiendas-page.test.tsx`
  (**no existe hoy**; espejo de `wallet-mensajeros-page.test.tsx`).
  *Hecho:* en verde con: `mensajero`, `adminTienda`, `adminSatelite` y sin sesión ⇒ `notFound`
  y **sin** pre-fetch; `maestro` y `admin` ⇒ tabla montada; saldos por props como STRING
  (R30, R6).

---

## T3 — Cierre

- [ ] **T3.1 — Verificar que no hay migración.** `pnpm run db:migrate:create` sobre el árbol y
  comprobar que la migración propuesta está vacía; descartar la carpeta generada.
  *Hecho:* `db/migrations/` no gana ninguna carpeta en el diff de la rama (R48).
- [ ] **T3.2 — Suite completa y arnés.** `./init.sh`, `pnpm run typecheck`, `pnpm run lint`,
  `pnpm test`.
  *Hecho:* todo en verde, incluidas las guardias de la 170 y los tests de `/mi-wallet` sin
  editar.
- [ ] **T3.3 — Trazabilidad.** Escribir el mapa `R<n> → test` en
  `progress/impl_171-desglose-por-tienda.md`, con los 49 requisitos.
  *Hecho:* ningún `R<n>` sin al menos un test nombrado y localizable.
- [ ] **T3.4 — Nota para la 172.** Dejar en la bitácora las cuatro cosas que la 172 encuentra
  hechas (§9 del design) y el nombre exacto de la prop `acciones` y del helper
  `claveDesgloseTienda`.
  *Hecho:* la 172 puede escribir su spec sin releer este código.

---

## Trazabilidad (resumen `R<n> → dónde se prueba`)

| Requisitos | Test |
| --- | --- |
| R1–R5, R14–R21, R32, R33, R36, R37, R38, R44, R45, R46 | `tests/integration/wallet-tiendas-desglose.test.tsx` |
| R6, R30 | `tests/integration/wallet-tiendas-page.test.tsx` (nuevo) + T2.4 |
| R7, R13 | `wallet-tiendas-desglose.test.tsx` + `desglose-tienda-labels` test (T2.1) |
| R8, R9, R10, R23, R43 | `tests/unit/utils/desglose-tienda.test.ts` |
| R11, R12, R22, R24, R26, R27, R28, R34, R35, R39, R40 | `tests/unit/services/wallet-tienda-desglose.test.ts` |
| R24 (WHERE del repositorio) | `tests/unit/repositories/wallet-tienda-movimiento-repository.test.ts` |
| R25, R29, R40 (borde) | `tests/unit/actions/wallet-tienda-desglose-action.test.ts` |
| R20 | test de identidad de etiquetas (T2.1) |
| R31, R49 | suites existentes de `wallet-tienda` y `/mi-wallet`, **sin editar** |
| R41 | `columnas-sensibles.guardia.test.ts` + `desglose-tienda-descarga-columnas.test.ts` |
| R42 | `cobertura-tablas.guardia.test.ts` (totales actualizados) |
| R47 | T2.3 (el componente no importa ninguna acción de escritura) |
| R48 | T3.1 (diff sin carpeta de migración) |
