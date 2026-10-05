# 473 — Corregir la recepción de dinero de una satélite · tasks

> Zona `fullstack`: se secuencia **backend (T1-T4) → frontend (T5)**. Un commit por task
> (`fix(473): …` / `test(473): …`). Mapa R→test en `design.md §6`; el implementer lo copia a
> `progress/impl_473.md` con el resultado medido de cada caso.
>
> **Gate:** el diff toca `CierresBodegaAdminRepository.ts` (nombre de dinero «cierre») → `./init.sh
> --rapido` se niega y manda al **completo**. Antes del PR: `./init.sh` completo con `INIT_EXIT=$?`
> escrito dentro del log, mirando los `skipped` de `tests/integration/db` (sin `.env` se saltan y
> aun así sale «OK»). Antes de mergear: `gh pr checks` (el gate no corre `next build`).

## Backend

- [ ] **T1 — Repositorio: `corregirConciliacion` + su entrada en el censo** (R4, R5, R8)
  - Contrato `CorregirConciliacionInput` y `corregirConciliacion(...)` en
    `lib/interfaces/repositories/ICierresBodegaAdminRepository.ts`; implementación en
    `lib/repositories/CierresBodegaAdminRepository.ts` según `design.md §2.1` (sin corte previo por
    `montoRecibido === null`).
  - Actualizar los fakes que implementan el contrato entero o su `Pick` y dejarían de compilar:
    `tests/unit/services/cierres-bodega-admin-service.test.ts` (L170),
    `tests/integration/db/_fixtures/wallet-458.ts` (L338) y cualquier otro que salga en typecheck.
  - Entrada nueva en el `CENSO` de `tests/unit/guards/historial-accion-escrituras-cubiertas.guardia.test.ts`
    (`design.md §3`). El número duro 65 NO cambia.
  - Casos nuevos en `tests/unit/repositories/cierres-bodega-admin-marca.test.ts` (R4, R8).
  - **Hecho cuando:** typecheck verde; la guardia del censo verde con la entrada nueva **y roja**
    al borrar a mano el `appendAccion` de `corregirConciliacion` (medido, revertido, anotado);
    los unitarios de R4/R8 verdes.

- [ ] **T2 — Integración contra Postgres del `WHERE`** (R1, R2, R3, R4, R6, R7, R12, R13) · depende de T1
  - Nuevo `tests/integration/db/corregir-conciliacion.int.test.ts`, molde de
    `marca-conciliacion.int.test.ts` (transacción revertida, sufijo propio, `serializarEscriturasReales`).
  - Siembra: consolidación con declarado 200800.00 marcada por 177800.00 con `marcarConciliado`
    (camino vivo, respeta el `CHECK`); otra pendiente; otra rechazada.
  - R13 se lee con `SaldosSatelitesRepository` (el mismo lector de la pantalla), no recalculando.
  - R12: contar filas de los tres libros antes y después.
  - **Hecho cuando:** verde con base local migrada (`prisma migrate deploy` antes) y **0 skipped** en
    este archivo; las mutaciones 1 y 2 de `design.md §6` lo ponen ROJO (medido, revertido, anotado en
    `progress/impl_473.md`). Un verde sin haberlo visto rojo no cuenta.

- [ ] **T3 — Servicio `corregirRecibida`** (R7, R9) · depende de T1 · [P] con T2
  - `lib/interfaces/services/IConciliacionSatelitesService.ts` + `lib/services/ConciliacionSatelitesService.ts`
    (`Pick` ampliado, guard primero; `design.md §2.2`).
  - Ampliar `fakeEscrituras` en `tests/unit/services/conciliacion-satelites-service.test.ts` y casos
    nuevos: forbidden sin llamar al repo, ok, conflict, fuera_de_alcance→no_encontrada, nota vacía→null,
    y que `corregirRecibida` no llama a `marcarConciliado` (ni al revés).
  - **Hecho cuando:** unitarios verdes y typecheck verde.

- [ ] **T4 — Server action `corregirConsolidacionRecibidaAction`** (R10, R11) · depende de T3
  - `lib/actions/conciliacion-satelites.ts`, calco de la de marcar con el mismo schema (`design.md §2.3`).
  - Casos en `tests/unit/actions/conciliacion-satelites-actions.test.ts`: sin sesión, monto 0,
    negativo, tres decimales, no numérico, clave extra, nota de 501 → nunca llama al servicio; ok →
    llama a `corregirRecibida` y no a `marcarRecibida`.
  - **Hecho cuando:** unitarios verdes. (La guardia `superficie-de-uso` puede ponerse roja hasta T5:
    T4 y T5 van en el mismo PR y el gate se mide tras T5.)

## Frontend

- [ ] **T5 — Diálogo y acciones** (R14, R15, R16, R17) · depende de T4
  - `components/shared/conciliacion/conciliacion-labels.ts`: `confirmarCorregir`, `corregida(monto)`.
  - `MarcarRecibidoDialog.tsx`: `confirmLabel` por modo; prop `onConflicto` que cierra y delega.
  - `ConciliacionAcciones.tsx`: envío por modo (corregir vs marcar), toast de corrección,
    `onConflicto` = toast de conflicto + `onCambio()`.
  - Money-safe: cero `Number(`/`parseFloat`/restas en estos archivos (lo vigila
    `cierre-bodega-vocabulario.guardia.test.ts`).
  - Añadir `corregirConsolidacionRecibidaAction` al `vi.mock` de `@/lib/actions/conciliacion-satelites`
    donde el componente se monta: `tests/integration/wallet-satelites.test.tsx` (obligatorio, con su
    mock propio) y, si el gate lo pide, `tests/components/BusquedaPorGuia469.test.tsx`,
    `EstadoCuenta463.test.tsx`, `EstadoCuentaBarra467.test.tsx`, `EstadoCuentaSatelite.test.tsx`,
    `tests/unit/guards/wallet-sin-uuid.guardia.test.tsx`.
  - Casos nuevos en `tests/integration/wallet-satelites.test.tsx` (R14-R17, nombres en `design.md §6`).
  - **Hecho cuando:** los casos nuevos verdes; el de R14 se pone ROJO si `ConciliacionAcciones` vuelve
    a llamar a la action de marcar en modo corrección (medido y revertido).

## Cierre

- [ ] **T6 — Gate completo y evidencia** · depende de T1-T5
  - `./init.sh` completo, log sin `tail`, `INIT_EXIT` dentro del log; contar `skipped`.
  - `progress/impl_473.md`: mapa R→test con resultado, las tres mutaciones (2 rojas en integración, 1
    roja en unitario) y la de R14.
  - Verificación visual opcional con Playwright (memoria «Ver la app encuentra lo que la suite no»):
    marcar por debajo → «Corregir» al declarado → la fila pasa a «Recibido» y el registro de acciones
    tiene UNA fila nueva. No sustituye a ningún test.
  - **Hecho cuando:** `INIT_EXIT=0`, 0 skipped en `corregir-conciliacion.int.test.ts`, todos los R
    con test verde mapeado.
