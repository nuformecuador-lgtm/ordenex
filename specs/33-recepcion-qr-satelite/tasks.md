# Feature 33 — Bodega satélite: "Mis asignaciones" y recepción por QR · tasks.md

> Orden: catálogo/migración → repo → service → action → frontend → verificación. `[P]` = paralelizable
> con la task hermana (sin dependencia mutua). Cada task incluye su criterio de "hecho" y los `R<n>`
> que satisface. NO empezar hasta que F1.4 esté aprobada (ver `requirements.md`).
>
> ⚠️ **Actualizado 2026-07-15** (decisiones (a-1)/(a-2) de `requirements.md`): el QR codifica
> `num_guia` (no `orden.id`) y la recepción es **solo por cámara** (**R10 RETIRADO**, el `<input>`
> keyboard-wedge y sus tests se eliminaron a propósito). Afecta a T9, T13, T14 y T15.

## A. Catálogo y migración (backend base)

- [x] **T1 — Añadir `en_bodega_satelite` a `ORDER_STATUS_SEED`** (R1)
  - `lib/types/order-status.ts`: agregar `"en_bodega_satelite"` como 13.º valor con comentario de
    feature (patrón feature 30/36).
  - *Hecho:* `OrderStatusValue` incluye el valor; unit de `ORDER_STATUS_SEED` verde; `seedOrderStatus`
    idempotente.

- [x] **T2 — Migración del estado nuevo + `down.sql`** (R2/R21) · depende de T1
  - `db/migrations/<timestamp>_order_status_en_bodega_satelite/migration.sql`: `ALTER TYPE ... ADD
    VALUE IF NOT EXISTS 'en_bodega_satelite'` + `INSERT ... ON CONFLICT ("value") DO NOTHING`
    (copiar patrón `20260711140000_order_status_en_ruta_bodega_satelite`).
  - `down.sql`: `DELETE` condicional (solo si ninguna orden referencia el valor); documentar que el
    enum Postgres no se puede `DROP VALUE`.
  - *Hecho:* `pnpm db:migrate` inserta la fila; `order_status_value` contiene el valor; `pnpm
    db:rollback` aplica el `down.sql` sin error.

## B. Repository (`lib/repositories/OrdenRepository.ts` + interfaz)

- [x] **T3 [P] — `findUsuarioZonaId(usuarioId)`** (R4/R5)
  - Espejo de `findUsuarioFulfillment`: `usuario.findUnique({ where:{id}, select:{ zonaId:true } })`;
    devuelve `zonaId` o `null`.
  - Declarar en `IOrdenRepository`.
  - *Hecho:* integration/unit repo: devuelve la zona del adminSatelite; `null` si no tiene.

- [x] **T4 [P] — `findRecepcionSateliteByZona(zonaId, estatusValues)`** (R6/R8/R9)
  - Query de órdenes no borradas de `zonaId` cuyo `estatus.value ∈ estatusValues`, con nombres
    legibles de tienda/geografía (patrón `findEtiquetasByIds`); proyecta `RecepcionSateliteRow`.
  - Declarar la fila + método en `IOrdenRepository`.
  - *Hecho:* integration repo: trae `en_ruta_bodega_satelite` y `en_bodega_satelite` de la zona;
    excluye borradas y otras zonas.

- [x] **T5 — `recibirEnSatelite(ordenId, zonaId, destinoEstatusId)`** (R11/R18) · depende de T2
  - `UPDATE` guardado: solo si `zona_id=:zonaId`, estado origen `en_ruta_bodega_satelite`,
    `deleted_at IS NULL`; devuelve `true` si afectó 1 fila. No toca `mensajero_asignado_id`/`num_guia`.
  - Declarar en `IOrdenRepository`.
  - *Hecho:* integration repo: transiciona una orden válida; devuelve `false` si el origen/zona no
    cuadra (concurrencia-seguro).

## C. Service (`lib/services/RecepcionSateliteService.ts` + interfaz)

- [x] **T6 — Interfaz `IRecepcionSateliteService` + DTOs/results** (R10–R18) · depende de T3–T5
  - `lib/interfaces/services/IRecepcionSateliteService.ts`: `listar(actor)`, `recibir(ordenId, actor)`,
    DTO `RecepcionSateliteDTO`, unions de resultado (`ok/forbidden/sin_zona/zona_ajena/estado_invalido/
    ya_recibida/no_encontrada/validation_error`).
  - *Hecho:* compila; consumida por el service y las actions.

- [x] **T7 — `listar(actor)`** (R3/R4/R5/R6/R8) · depende de T6
  - `rol !== adminSatelite` → `forbidden`; resuelve `zonaId` (`findUsuarioZonaId`); `null` →
    `ok` con listas vacías + `sinZona:true`; si no, `findRecepcionSateliteByZona` y separa en
    `porRecibir`/`recibidas`.
  - *Hecho:* unit service con dobles: separa grupos; rol ajeno → forbidden; sin zona → vacío+sinZona.

- [x] **T8 — `recibir(ordenId, actor)`** (R11–R18) · depende de T6
  - Máquina de resultados de design §2.3: forbidden → sin_zona → no_encontrada → zona_ajena →
    ya_recibida → estado_invalido → (destino seed) → `recibirEnSatelite`; race → re-lee y decide
    `ya_recibida`/`conflict`.
  - *Hecho:* unit service cubre cada rama (R11–R17) con dobles de repo, sin efectos en los rechazos.

## D. Server Actions (`lib/actions/recepcion-satelite.ts` + tipos)

- [x] **T9 — Tipos + schema zod** (R16) · depende de T6
  - `lib/types/recepcion-satelite.ts`: `recibirSchema` sobre el **`num_guia`** escaneado (entero
    positivo, extraído de `<origin>/paquete/<numGuia>`) + tipos de resultado expuestos.
    > Actualizada 2026-07-15 (a-2). Antes: ~~`recibirSchema` (`{ ordenId: z.string().trim().min(1)... }`)~~.
  - *Hecho:* schema rechaza vacío/ilegible/no numérico/UUID de etiqueta antigua; tipos compilan.

- [x] **T10 — Actions `listarRecepcionSatelite` + `recibirPorQr`** (R3/R10/R16/R17) · depende de T7–T9
  - Patrón `lib/actions/mis-asignaciones.ts`: `withErrorHandler`, `resolveActorFromSession`,
    `UnauthenticatedError` en el borde, `recibirSchema.parse`; resultados de dominio sin excepción;
    `deps` inyectable (`service`/`getActor`) para tests.
  - *Hecho:* unit action: sin sesión → unauthenticated; texto inválido → validation_error sin tocar
    service; delega correctamente en el service.

## E. Frontend (`app/(app)/recepcion-satelite/`)

- [x] **T11 — Página Server Component** (R3/R4) · depende de T10
  - Valida `actor.rol === "adminSatelite"` → `notFound` si no; pre-fetch `listarRecepcionSatelite`;
    pasa `porRecibir`/`recibidas`/`zonaNombre`/`sinZona` por props. `PageHeader` con título
    "Mis asignaciones".
  - *Hecho:* rol ajeno/sin sesión → `notFound`; adminSatelite ve el módulo con sus datos.

- [x] **T12 [P] — `RecepcionSateliteModule`** (R6/R7/R8/R9) · depende de T11
  - Dos secciones separadas "Por recibir" y "Recibidas"; estado legible "en bodega satélite de
    \<zona\>"; sin acciones de asignar/gestionar; `router.refresh()` tras recepción; aviso si `sinZona`.
  - *Hecho:* component test: renderiza ambas secciones; "Por recibir" no expone asignar/gestionar.

- [x] **T13 [P] — `EscanerRecepcion` (SOLO cámara)** (R12–R16) · depende de T11
  - Delega visor/ciclo de vida en `components/shared/QrScanner` (`html5-qrcode`); del texto
    decodificado extrae el `num_guia` (`extractNumGuiaFromScan`) y llama a `recibirPorQr`; feedback
    por ítem con `useToast` para cada resultado (ok / zona_ajena / estado_invalido / ya_recibida /
    no_encontrada / código inválido / sin_zona / forbidden / conflict).
  - *Hecho:* component test con la decodificación mockeada: dispara la action y muestra el toast
    correcto por resultado.
  - **Actualizada 2026-07-15 (decisiones (a-1)/(a-2)).** Rastro de lo retirado:
    > ~~T13 [P] — `EscanerRecepcion` (cámara + input keyboard-wedge) (R10/R12–R16): Input autofocus
    > que al Enter toma el valor, llama `recibirPorQr({ ordenId })`, limpia y re-enfoca. Hecho:
    > component test simulando texto+Enter.~~
    El `<input>` keyboard-wedge se eliminó de la UI (R10 RETIRADO) y sus tests (texto+Enter) se
    borraron **a propósito**: no es regresión. `R10` ya no figura entre los R que cubre esta task.

## F. Verificación y cierre

- [x] **T14 — Trazabilidad `R<n> → test`** (R23) · depende de T1–T13
  - `progress/impl_33-recepcion-qr-satelite.md` con la tabla R1–R22 → ruta de test, **excepto R10**
    (RETIRADO 2026-07-15): su fila debe decir "retirado, sin test por diseño", no quedar vacía.
  - *Hecho:* toda fila vigente con al menos un test; R10 marcado como retirado; el reviewer la valida.

- [x] **T15 — E2E de recepción (evaluar según F1.4 (g))** (R22) · depende de T13
  - **Actualizada 2026-07-15:** el E2E previsto escribía un `orden.id` en el **input de escaneo**;
    ese input ya no existe (R10 retirado) y el identificador ya no es un `orden.id` (a-2). Un E2E de
    la cámara real no es automatizable. Registrar en el impl que la decodificación por cámara queda
    como verificación **manual** y que el flujo de recepción se cubre con unit(service)+unit(action)+
    component(escáner con decodificación mockeada).
    > ~~Si F1.4 exige E2E: Playwright que escribe un `orden.id` en el input de escaneo y verifica la
    > transición a `en_bodega_satelite`. Declarar en el impl que el lector físico queda como
    > verificación manual.~~
  - *Hecho:* justificación registrada (E2E por input no aplica) + nota de verificación manual de la
    cámara.

- [x] **T16 — Puertas de calidad** (CHECKPOINTS) · depende de T1–T15
  - `pnpm typecheck`, `pnpm lint`, `pnpm test`, `./init.sh` en verde; `pnpm db:rollback` funciona (T2).
  - *Hecho:* todo verde; `progress/history.md` actualizado al cerrar.
