# Feature 98 — API: devolver el valor a pagar (flete) en la carga por API

> Requisitos en notación EARS. Cada `R<n>` es testeable y se mapea a un test en
> `tasks.md`. Esta feature EXTIENDE la carga por API de la feature 88: por cada
> orden EFECTIVAMENTE creada, la respuesta debe incluir el **valor a pagar** =
> el **flete/tarifa** que la tienda paga por el envío (NO el `monto_cobrar`/COD,
> que ya viaja en el input y no se toca).

## Contexto verificado contra el código (no supuesto)

- El endpoint `POST /api/ordenes/api-key/carga`
  (`app/api/ordenes/api-key/carga/route.ts`, feature 88) ya autentica por API key
  (Bearer `ordx_…` → `ApiKeyAuthService.autenticar`), delega en
  `BulkOrdenService.cargarViaApi` y devuelve el summary sin envolverlo.
- `BulkOrdenService.cargarViaApi` (`lib/services/BulkOrdenService.ts`) crea cada
  orden con `tiendaId = actor.usuarioId` (el usuario dedicado de la key) y
  `zonaId` derivado del distrito; genera `num_guia` en la misma tx; y devuelve por
  orden creada `CargaViaApiOrden = { id, numRemision, numGuia, estado }`
  (`lib/interfaces/services/IBulkOrdenService.ts`).
- La **tarifa vigente** se resuelve **por TIENDA** (no por zona): el PR #64
  remodeló `tarifas` a "por tienda" y dropeó `tarifas.zona_id`
  (`TarifaVigentePorTiendaRepository.resolveTarifaPorTienda` /
  `resolveTarifasPorTiendas`; `ITarifaVigentePorTiendaRepository`). La selección
  vigente es `deletedAt IS NULL` + la MÁS RECIENTE (`createdAt desc`, first);
  `status` NO entra en el WHERE (deuda (g) de la feature 69). `null` si la tienda
  no tiene ninguna tarifa capturada.
- El **monto del flete** que paga la tienda es la columna `valorFlete` de la
  tarifa vigente, salvo que la zona sea CENTRAL (`zona.esCentral === true`), en
  cuyo caso es `valorFleteGam`. Esta MISMA regla de selección de columna ya la
  aplica `derivarIngresoOrden` (`lib/utils/ingreso-ordenex.ts`): flete =
  `esCentral ? valorFleteGam : valorFlete`. Los montos se manejan money-safe como
  **STRING escala 2** (`TarifaVigente`, `Prisma.Decimal → toFixed(2)`).
- Como TODAS las órdenes de un lote por API pertenecen a la MISMA tienda
  (`actor.usuarioId`), hay UNA sola tarifa vigente por lote: se resuelve una vez
  (patrón `precargar`, sin N+1). Lo único que varía por orden es la COLUMNA, según
  el `esCentral` de la zona de esa orden.
- La zona de cada orden se deriva del distrito (`DistritoRow.zonaId`,
  `resolveGeo`). El flag `esCentral` vive en `zona` (`zona.esCentral`, feature 54;
  antes `esGam`) y HOY NO se proyecta en `DistritoRow`
  (`lib/interfaces/repositories/IOrdenRepository.ts`) — hay que sumarlo (ver
  `design.md §3`).

---

## Resolución del flete

- **R1** — CUANDO el sistema crea una orden por la vía API, el sistema DEBE
  resolver su **valor a pagar** a partir de la **tarifa vigente de la tienda**
  dueña de la orden (`actor.usuarioId`), reutilizando el resolver de tarifa
  vigente existente (`ITarifaVigentePorTiendaRepository`), SIN reimplementar el
  cálculo de tarifas ni tocar su CRUD.

- **R2** — CUANDO el sistema resuelve el valor a pagar de una orden creada, el
  sistema DEBE seleccionar la columna del flete según la zona de esa orden:
  `valorFleteGam` SI la zona es central (`zona.esCentral === true`), en caso
  contrario `valorFlete`; aplicando la MISMA regla de selección de columna que
  usa la derivación de ingreso existente (`derivarIngresoOrden`).

- **R3** — CUANDO el sistema procesa un lote por API, el sistema DEBE resolver la
  tarifa vigente de la tienda UNA sola vez para todo el lote (patrón `precargar`),
  sin incurrir en una consulta por orden (sin N+1).

- **R4** — El sistema DEBE resolver el valor a pagar SOLO para las órdenes
  EFECTIVAMENTE creadas. Las filas `duplicada` y `error` NO llevan valor a pagar
  (no se crean, no se tarifan).

## Respuesta

- **R5** — CUANDO el sistema termina de procesar el lote, el sistema DEBE incluir,
  por cada orden creada, su **valor a pagar** en el campo **`costoEnvio`** del
  bloque `ordenes` de la respuesta, ADEMÁS de los campos ya existentes (`id`,
  `numRemision`, `numGuia`, `estado`). (Nombre fijado en el gate F1.4 → D3.)

- **R6** — El sistema DEBE preservar intacta la forma de la respuesta de las filas
  NO creadas: las filas `error` siguen exponiendo sus `errores`/motivo por campo y
  las `duplicada` su `estatus`, sin agregarles `costoEnvio` y sin cambiar su shape
  (misma semántica por-fila que la feature 88).

- **R7** — El sistema DEBE calcular el valor a pagar como **flete + IVA del
  flete**: al flete seleccionado (R2) le suma el IVA aplicando el porcentaje
  `ivaFlete` de la MISMA tarifa vigente, reutilizando el cálculo existente
  (`aplicarPorcentaje` de `lib/utils/ingreso-ordenex.ts`), SIN reimplementarlo. El
  resultado DEBE devolverse money-safe como **STRING escala 2** con redondeo
  `ROUND_HALF_UP` (misma convención que `TarifaVigente`/`derivarIngresoOrden`). El
  valor a pagar NUNCA DEBE confundirse con `monto_cobrar`/COD: son campos distintos
  y ambos pueden aparecer en la respuesta. (Regla fijada en el gate F1.4 → D2.)

## Gap de tarifa

- **R8** — SI la tienda dueña del lote NO tiene tarifa vigente (el resolver
  devuelve `null`), ENTONCES el sistema DEBE crear igualmente cada orden (con su
  `num_guia`) y devolver `costoEnvio` = **`"0.00"`** (cero money-safe, escala 2).
  El sistema NUNCA DEBE, por ausencia de tarifa, pasar la fila a `error` ni
  devolver `null`. (Comportamiento fijado en el gate F1.4 → D1.)

## No-regresión

- **R9** — El sistema DEBE preservar intacta la carga masiva por sesión
  (`BulkOrdenService.cargarMasiva` y `app/api/ordenes/carga-masiva/chunk`): no se
  le agrega resolución de flete ni el campo nuevo; su `BulkSummary` no cambia.

- **R10** — El sistema DEBE preservar el resto del contrato de la carga por API de
  la feature 88 sin cambios: autenticación por key, estado inicial fijo
  `en_ruta_bodega_principal`, asignación inmediata de `num_guia`, dedup por
  `num_remision`, éxito parcial por fila y la vía sesión como no-acceso. La única
  extensión observable es el nuevo campo por orden creada (R5).

---

## Resolución del gate F1.4 (aprobado 2026-07-21)

> El humano aprobó la feature y cerró las tres decisiones. Ya NO son abiertas: son
> los valores VIGENTES. Implementar tal cual.

- **D1 — Tienda sin tarifa vigente (`resolver → null`): `costoEnvio = "0.00"`.**
  La orden se crea igual (con su `num_guia`); NO pasa a `error` ni devuelve `null`.
  Coherente con la deuda (g)/gap R9 de la feature 42/69: una tienda sin tarifa NO
  bloquea la operación. Ver **R8**.

- **D2 — Valor a pagar = flete + IVA del flete.** Al flete seleccionado (R2) se le
  suma el IVA aplicando el porcentaje `ivaFlete` de la misma tarifa vigente,
  reutilizando `aplicarPorcentaje` (`lib/utils/ingreso-ordenex.ts`); resultado
  STRING escala 2, `ROUND_HALF_UP`. NO es el flete neto. Ver **R7**.

- **D3 — Nombre del campo: `costoEnvio`.** Es el nombre del campo nuevo en
  `CargaViaApiOrden` / bloque `ordenes` de la respuesta. Ver **R5**.
