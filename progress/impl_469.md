# Ficha 469 — Implementación, parte de servidor (backend)

> Rama `feature/469-wallet-buscar-guia` (local `be469`). Base: `dev` con la 468 mergeada (`f32f7ed6`,
> T0 cumplido: `FUENTE_MENSAJERO.pago_devengado` es `snapshot_gestion`). Spec APROBADO con las tres
> propuestas por defecto (requirements.md § Aprobación).
> Dos agentes previos cayeron por red; su trabajo (`0c3c15af`, `6e97cf57`, `0b1acb6c`) se revisó contra el
> spec antes de seguir (sección «Revisión de lo heredado»). Este agente añadió la integración contra
> Postgres (`45dd3cfd`), corrió el gate completo y escribió este informe.
> Búsqueda de código: el MCP `codebase-memory` NO estaba en el conjunto de herramientas de este agente;
> se usó `grep` y lectura de archivos.

## Lo hecho (T2–T10, T14 de servidor)

| Tarea | Qué | Archivos |
| --- | --- | --- |
| T2 | Tipos: `ModoBusquedaLibro`, `ParDeGuia`, `BusquedaResuelta`, `SuperficieConGuia`, `OrdenIdentificada`. `modoBusqueda?` en `ListarMovimientosPayload` y `EstadoCuentaDTO`. `resaltar` (mismo esquema que `q`) en `verDetalleDeMovimientoSchema` y `ordenesDeFilaSchema`; fuera del completo. `destacadas` en `DetalleMovimientoPayload`; `ordenes` pasa a `OrdenDeDetalleDTO` (= `OrdenAporteDTO` + `resaltada`). | `lib/types/busqueda-por-guia.ts` (nuevo), `lib/types/detalle-movimiento.ts`, `lib/types/estado-cuenta.ts`, `lib/interfaces/services/IWalletService.ts` |
| T3 | `IOrdenIdentificadaRepository` + implementación: `identificar` (`$queryRaw`, `num_guia = $guia OR lower(num_remision) = lower($t)`, `tienda_id` al final en `AND`), `cierresDeOrdenes`, `gestionesConCobroPorRechazo`, `incidentesDeOrdenes`. | `lib/interfaces/repositories/IOrdenIdentificadaRepository.ts`, `lib/repositories/OrdenIdentificadaRepository.ts` |
| T4 | `CierreAporteRepository.cierresDondeAporta` (OR de `buildWhere(cierre, criterio, tienda) AND orden_id` por par) y `ordenIds` opcional en `listarOrdenesQueAportan` (AND aparte). `buildWhere` no se tocó. | `lib/repositories/CierreAporteRepository.ts`, `lib/interfaces/repositories/ICierreAporteRepository.ts` |
| T5 | `BusquedaPorGuiaService.resolver` / `identificar`; `gruposDeCriterio` agrupa el catálogo de la superficie por criterio (sin lista de conceptos escrita). | `lib/services/BusquedaPorGuiaService.ts`, `lib/interfaces/services/IBusquedaPorGuiaService.ts` |
| T6 | Caja: `condicionPorGuiaSql` y `porGuia` excluyente con `termino` en `whereLibroCajaConTerminoSql`; `listar` va por el camino SQL también con `porGuia`. | `lib/repositories/libro-caja-a-quien-sql.ts`, `lib/repositories/WalletMovimientoRepository.ts`, `lib/interfaces/repositories/IWalletMovimientoRepository.ts` |
| T7 | Estado de cuenta: `porGuia` en `VentanaDeLibro`; `busquedaSql` en el `WHERE` exterior (después de la ventana del corrido). La bodega sigue con `terminoSql` (R36). | `lib/repositories/EstadoCuentaRepository.ts`, `lib/interfaces/repositories/IEstadoCuentaRepository.ts` |
| T8 | `WalletService` (`listarMovimientos`, `listarMovimientosCompleto`) y `EstadoCuentaService.leerCuenta` (oficina, completo, `/mi-wallet`) resuelven `q` y devuelven `modoBusqueda`. Composition roots: `buildBusquedaPorGuia(prisma)` en los tres bordes. | `lib/services/WalletService.ts`, `lib/services/EstadoCuentaService.ts`, `lib/actions/_shared/busqueda-por-guia.ts`, `lib/actions/{wallet,wallet-tienda,estado-cuenta}.ts` |
| T9 | Integración de punta a punta contra Postgres (este agente). | `tests/integration/db/busqueda-por-guia-469.test.ts` (nuevo) |
| T10 | `DetalleMovimientoService.resolverConjunto` con `resaltar`: identifica con el MISMO `tiendaId` del detalle, `destacadas` con el mismo método y el mismo mapeo (`aDTO`), `resaltada` por fila. | `lib/services/DetalleMovimientoService.ts` |
| T14 | Sin código nuevo: la descarga (kardex de la 468) reutiliza `listarMovimientosCompleto` / `leerCuenta`, que ya resuelven igual. Probado en integración. | — |

Fixtures tocados solo para cablear la dependencia nueva: `tests/integration/db/_fixtures/{busqueda-469,caja-459,libro-468,wallet-458}.ts`,
`detalle-en-lote-464`, `detalle-movimiento-cierre-postgres`, `estado-cuenta-concurrencia-458`, y dos unitarios de detalle.

## Revisión de lo heredado (contra el spec)

- **R34 / sin fórmulas nuevas:** confirmado. El criterio sigue escrito una vez (`buildWhere`); la búsqueda
  lo reutiliza con la orden fijada en un `AND` aparte. No hay ni una operación de dinero nueva; el aporte
  destacado sale de `aporteDeOrden` con el mismo mapeo que la fila (R27 por construcción).
- **R12/R13:** los conceptos salen de `FUENTE_*` vía `criterioDeFuente`; `pago_efectivo` (sin_reparto)
  queda fuera solo. Incluye los cuatro de la 468.
- **R14 (pregunta 1 aprobada):** pares `gestion_orden` (solo gestiones con `rechazo_tienda_cobro`) y
  `orden_incidente`, sin categoría. Sin resaltado: esas filas son `sin_reparto` en el detalle.
- **R36 (pregunta 2 aprobada):** la bodega no resuelve (`modoBusqueda: "texto"` y `termino`).
- **R7 / pregunta 3 aprobada:** identifica por guía O remisión en la misma consulta: si una remisión
  numérica coincide con la guía de otra orden, salen las dos.
- **Orden de guard:** la resolución corre DESPUÉS del guard de rol en los dos servicios (`forbidden` no
  consulta nada; unitario R33).
- **Nada que corregir** en el código heredado. Solo se añadió la integración que faltaba.

## Mapa R → test (servidor)

`INT` = `tests/integration/db/busqueda-por-guia-469.test.ts`; `U-BUS` = `tests/unit/services/busqueda-por-guia-469.test.ts`;
`U-SRV` = `tests/unit/services/busqueda-por-guia-469-servicios.test.ts`; `U-ROOT` = `tests/unit/actions/busqueda-por-guia-469-roots.test.ts`.

| R | Test |
| --- | --- |
| R1 | Contrato: `q` ya existía en los bordes; `U-SRV` «R2/R10/R20/R33…». Lo visible (sin control nuevo) es de pantalla. |
| R2 | `U-BUS` «R2: si identifica una orden…»; `U-SRV` «R2/R10/R20/R33…»; `INT` caja/tienda/mensajero (`modoBusqueda === "guia"`) |
| R3 | `INT` «T3 R3/R4/R5/R7» (prefijo, sufijo, cero inicial, 10 cifras, `_` no comodín); `U-BUS` «R3/R4» |
| R4 | `INT` «T3» (remisión en minúsculas); `U-BUS` «R3/R4» |
| R5 | `INT` «T3» (`tiendaId` acota guía y remisión) y «tienda (oficina) y /mi-wallet» (tienda B y `/mi-wallet` de B: modo texto, misma respuesta que la 463); `U-BUS` «R5/R29» |
| R6 | `INT` «caja: … R22/R7» (término inexistente ⇒ texto); `U-BUS` «R6»; `U-SRV` «R6» |
| R7 | `INT` «T3» (remisión de dos tiendas ⇒ las dos sin tienda) y «caja» (remisión compartida da el mismo conjunto); `U-BUS` «R7/R15» |
| R8 | `INT` «T9 … diferencial» |
| R9 | `INT` «T4 R9» (o9 en C1 sin aportar; o4 sin comisión) y diferencial «T9» (≥10 negativos dentro del cierre de la orden); `U-BUS` «R8/R9» |
| R10 | `INT` «caja: sin el texto…» (la nota con la guía no sale; la búsqueda de texto sí la encuentra) y «tienda» (ajuste A); `U-SRV` «R2/R10…» |
| R11 | `INT` diferencial en caja (5 órdenes × todas las filas de cierre) y en tienda; mensajero (detalle del devengado lista o9) |
| R12 | `INT` «T9» (o1: contra-entrega y pago; o5: indemnización de cierre); `U-BUS` «R12/R13/R34» (recorre los tres catálogos) |
| R13 | `INT` «mensajero» (sin `pago_efectivo`); `U-BUS` «R12/R13/R34» |
| R14 | `INT` «caja» (cobro por rechazo y su IVA + indemnización por incidente de o1; NO el cobro de o2) y «tienda» (cobro en el libro de la tienda); `U-BUS` «R14» |
| R15 | `INT` «T9» (ids únicos); `U-BUS` «R7/R15» |
| R16 | `INT` «caja» (concepto, Entra/Sale, periodo) y «mensajero» (cierre) |
| R17 | `INT` «mensajero» y «tienda» (corrido de cada fila = el de la cuenta entera) |
| R18 | `INT` «mensajero» y «tienda» (tarjetas iguales); `U-SRV` «R18» (el resumen de la caja no resuelve) |
| R19 | `INT` «caja» (total = filas, páginas de 2 = lectura entera) y «tienda» |
| R20 | `INT` «caja» (asc = desc al revés, paginado) y «tienda» |
| R21/R23 | Servidor: `modoBusqueda` en las respuestas (`INT`, `U-SRV` «R23»). El aviso es de pantalla (T11/T12). |
| R22 | `INT` «caja» (guía de o11: modo guía, 0 filas, total 0); `U-BUS` «R2 … pares vacíos (R22)». El texto es de pantalla. |
| R24 | Pantalla (T11). |
| R25 | `INT` «T10» (o4 destacada desde la página 1 con pageSize 1); `U-SRV` «R29 … R25/R26/R27» |
| R26 | `INT` «T10» (en su página, solo ella `resaltada`); `U-SRV` |
| R27 | `INT` «T10» (aporte destacado = el de su fila en la lista entera); `U-SRV` |
| R28 | `INT` «T10» (sin `resaltar`: `destacadas: []`, nada resaltado); `U-SRV` «R28» ×2 |
| R29 | `INT` «T10» (tienda B con la guía de o1: nada; con la de o4: o4); `U-SRV` «R29…» |
| R30 | `INT` «T14» (caja, tienda, `/mi-wallet`, mensajero: hoja 1 = pantalla); `U-SRV` «R30» |
| R31 | `INT` «T14» (TOTAL GENERAL = «Total del periodo» en las cuatro superficies; más de un bloque en la caja) |
| R32 | `INT` «T14» (`kardex.conOtrosFiltros === true`) |
| R33 | `U-SRV` «R33: el forbidden no llega a resolver nada»; `U-ROOT` ×3 (los roots pasan el servicio real); `U-BUS` «mismo esquema que q» |
| R34 | Por construcción (`buildWhere` reutilizado) + diferencial R11 de `INT`; `U-BUS` «R12/R13/R34» |
| R35 | Pantalla (guardia de «SLA»). Este bloque no añade textos visibles. |
| R36 | `U-SRV` «R36: en la bodega satelite…» |

## Mutaciones (contra la integración, una a una, revertidas)

| Mutación | Resultado |
| --- | --- |
| `OrdenIdentificadaRepository.identificar` sin `tienda_id` | ROJO: «T3» y «tienda (oficina) y /mi-wallet» |
| `condicionPorGuiaSql` (caja) sin la categoría | ROJO: diferencial «T9 R8/R9/R11» |
| Caja: el servicio manda también `termino` y el repo hace `porGuia OR texto` | ROJO: «caja … R10» |
| `busquedaSql` (estado de cuenta) sin la categoría | ROJO: «mensajero» (sale `pago_efectivo`, R13) y «T14» |

No se ejecutó la mutación «filtro dentro de la ventana» (R17): cambiarla exige reescribir la CTE; R17 lo
afirma la aserción del corrido fila a fila.

## Desviaciones (técnicas, decididas)

1. **`WalletService` recibe la búsqueda como parámetro OPCIONAL** (design pedía no opcional): va detrás
   del opcional `comprobantes` y 58 construcciones de test no la pasan. Sin ella, `q` es texto (la 463).
   El fallo mudo «el root no la inyecta» lo cubre `U-ROOT`. `EstadoCuentaService` y
   `DetalleMovimientoService` sí la exigen.
2. **`OrdenDeDetalleDTO` aparte** en lugar de `resaltada` dentro de `OrdenAporteDTO`: el detalle
   COMPLETO (archivo) no resalta y sigue con `OrdenAporteDTO`.
3. **Guía = `^[1-9]\d{0,8}$`**: sin cero inicial (la guía visible es `String(num_guia)`) y ≤ 9 cifras
   (int4). Un término de 10 cifras solo se compara como remisión.
4. **Fixture de integración:** el cobro por rechazo y la indemnización por incidente se escriben con el
   origen exacto de `RechazoTiendaCobroService.aprobar` / `WalletIndemnizacionIncidenteFeedService`, no
   llamando a esos servicios (fechan en «ahora», fuera de la ventana 2037 del escenario de la 468). Las
   guías VIVAS se asignan en el test (la 468 solo congelaba la de `cierre_detail`).
5. **R14 en el mensajero:** los pares de una sola orden también viajan a su libro; hoy no tiene filas con
   esos orígenes (`cierre_dia | pago_mensajero | manual`), así que no cambia nada.
6. **T1 sin medir** (ver abajo).

## T1 — mediciones de producción

**MEDIDAS por el leader el 2026-10-02 (solo lectura, MCP de Supabase sobre producción):** (1) 5.695 filas de `cierre_detail`, 0 con guía distinta y 0 con remisión distinta de la orden viva: identificar por `orden` es correcto, no hace falta la rama `cierre_detail`. (2) `EXPLAIN ANALYZE` con una guía y una remisión reales: seq scan sobre 4.840 órdenes, **9,6 ms** (< 50 ms): sin índice nuevo. (3) máximo 2 órdenes por remisión.

Texto original del agente:

Este agente no tiene herramienta de solo lectura contra producción (el MCP de Supabase no estaba en su
conjunto). Producción está vacía desde el 2026-08-25, así que un cero sería «aún no ha pasado». Consultas
exactas para el humano/leader (solo lectura, MCP de Supabase sobre producción):

```sql
-- 1) ¿la copia congelada difiere de la orden viva? (decide identificar por `orden`)
SELECT count(*) AS filas,
       count(*) FILTER (WHERE cd.num_guia IS DISTINCT FROM o.num_guia) AS guia_distinta,
       count(*) FILTER (WHERE cd.num_remision <> o.num_remision)       AS remision_distinta
FROM cierre_detail cd JOIN orden o ON o.id = cd.orden_id;

-- 2) plan y tiempo de la identificación sin tienda (regla: sin índice nuevo si < 50 ms)
EXPLAIN ANALYZE
SELECT o.id, o.num_guia, o.num_remision FROM orden o
WHERE (o.num_guia = 123456 OR lower(o.num_remision) = lower('<una remisión real>'))
ORDER BY o.id;

-- 3) remisiones repetidas entre tiendas (cota de ramas)
SELECT max(n) FROM (SELECT count(*) n FROM orden GROUP BY lower(num_remision)) t;
```

Si (1) da diferencias > 0, hay que añadir la rama `cierre_detail` a la identificación (design §8 alt. 3).
Si (2) pasa de 50 ms, migración con índice `orden (lower(num_remision))`.

## Contratos para el frontend

- **Libro de la caja** — `listarMovimientosAction` (y `libroCajaKardexAction` /
  `libroCajaKardexConDetalleAction` para la descarga): mismo `q` de siempre. La respuesta `ok` trae
  `data.modoBusqueda?: "texto" | "guia"` (de `ModoBusquedaLibro`, `lib/types/busqueda-por-guia.ts`).
  **Ausente** si la lectura no llevaba `q`.
- **Estado de cuenta** — `verEstadoCuentaAction`, `verMiEstadoCuentaAction` (y sus kardex): `estado.modoBusqueda?`
  con la misma semántica. En la bodega satélite siempre `"texto"` (R36): su texto de ayuda NO nombra la guía.
- **Aviso R21 / vacío R22:** pintar solo con `modoBusqueda === "guia"` de la lectura PINTADA. Los textos
  no existen aún (T11).
- **Detalle de una fila** — entradas que ganan `resaltar?: string` (recortado, 3..máx de
  `lib/config/libro-wallet`, el mismo esquema que `q`):
  - `verDetalleDeMovimientoAction` (caja) y `verDetalleDeMiMovimientoAction` (`/mi-wallet`):
    `verDetalleDeMovimientoSchema`;
  - `verOrdenesDeFilaAction` (tienda y mensajero de la oficina): `ordenesDeFilaSchema`.
  - Los `…CompletoAction` del detalle NO aceptan `resaltar` (`.strict()` ⇒ `validation_error`).
  - Mandarlo SOLO si la última lectura del libro volvió con `modoBusqueda === "guia"` (R28).
- **Respuesta del detalle** (`DetalleMovimientoPayload`, `lib/types/detalle-movimiento.ts`):
  - `destacadas: OrdenAporteDTO[]` — todas las órdenes identificadas que aportan a ESA fila, con el mismo
    `aporte` (string escala 2) que su fila de la lista; `[]` sin `resaltar`, si el término no identifica
    nada en ese alcance o si la orden no aporta a ese concepto.
  - `ordenes: OrdenDeDetalleDTO[]` = `OrdenAporteDTO & { resaltada: boolean }` (texto accesible R26 es de
    pantalla).
  - Filas `sin_reparto` (incluidos cobro por rechazo e indemnización por incidente) no cambian.
- **Clave SWR del detalle:** incluir `resaltar ?? ""` (dos términos no comparten caché).

## Verificación

- `pnpm run typecheck`, `pnpm run lint` y `pnpm test` corren dentro del gate completo:
  `progress/gate_469_backend.log` (resultado abajo).

Gate completo `INIT_EXIT=0`: 2.378 archivos, **32.981 tests en verde, 26 skipped** (Analitica, preexistentes); sin rojos nuevos.

## Veredicto

Servidor terminado. Pendiente: parte de pantalla (tareas de frontend de tasks.md) sobre esta misma rama.


---

# Parte de pantalla (frontend) — T11–T13, T15, T16

> Rama local `fe469` sobre `origin/feature/469-wallet-buscar-guia` @ `146f718b`. Búsqueda de código: el MCP
> `codebase-memory` NO estaba en el conjunto de herramientas de este agente; se usó `grep` y lectura de
> archivos. No se tocó servidor.

## Lo hecho

| Tarea | Qué | Archivos |
| --- | --- | --- |
| T11 | Textos compartidos: aviso (R21), vacío (R22), «Guía buscada» y el nombre del bloque. Placeholders (R24): caja, oficina y `/mi-wallet` nombran guía y remisión; la satélite gana su clave propia `bodega` y sigue sin nombrar la guía (R36). | `components/shared/wallet/busqueda-por-guia-labels.ts` (nuevo), `app/(app)/wallet/_components/libro-caja-labels.ts`, `components/shared/estado-cuenta/estado-cuenta-labels.ts` |
| T12 | Caja: `WalletModule` apunta `modoBusqueda` JUNTO con las filas, solo cuando la lectura llegó bien; aviso encima de la barra y vacío propio en el libro. Estado de cuenta: `terminoDeGuia(lectura pintada)`; aviso junto a la barra y vacío propio. En los dos, lo que manda es la lectura PINTADA (si la nueva falla, el aviso sigue siendo el de lo que se ve). | `WalletModule.tsx`, `WalletLedger.tsx` (props `resaltar`, `emptyMessage`), `components/shared/estado-cuenta/EstadoCuenta.tsx` |
| T13 | `FuenteDetalleMovimiento.leer(movimientoId, page, resaltar?)`; clave SWR `[prefijo, movimientoId, page, resaltar ?? ""]` en los dos paneles; `resaltar` llega a cada panel por `DetalleDeFila.render(…, { resaltar })` solo en modo guía. Bloque «Guía buscada» encima de la tabla (guía, destinatario, tienda en la caja/cuentas, resultado y aporte con `money` sin operar) y fila resaltada con fondo `bg-info-soft` + insignia de texto «Guía buscada» (R26, no solo color). | `DetalleMovimientoCierre.tsx`, `ordenes-de-fila-cuenta.ts`, `DetalleMiMovimientoCierre.tsx`, `EstadoCuentaTienda.tsx`, `EstadoCuentaMensajero.tsx`, `MiEstadoCuenta.tsx` |
| T14 | Sin código: la descarga ya lleva `q` (comprobado en la app, abajo). | — |

Tests tocados (literal de contrato que la ficha CAMBIA a propósito, R24; se sustituye por el literal
nuevo, no por su fuente): `EstadoCuenta463`, `EstadoCuentaBarra467`, `MiWalletFiltros`, `WalletFiltros458`,
`zonas-filtros-labels-463` (más un caso nuevo de la satélite y su texto en la guardia de «SLA»).

## Mapa R → test (pantalla)

`FE` = `tests/components/BusquedaPorGuia469.test.tsx`; `LBL` = `tests/unit/components/zonas-filtros-labels-463.test.ts`.

| R | Test |
| --- | --- |
| R1 | `FE` (el mismo buscador de la barra, sin control nuevo: todos los casos escriben en «Buscar en el libro») |
| R21 | `FE` «R21/R22: el aviso y el vacío, literales»; «R21/R23: con la guía sale el aviso…» (cuenta); «R21/R23/R18…» (caja) |
| R22 | `FE` «R22: búsqueda por guía sin movimientos…» (cuenta) y «R22: guía sin movimientos…» (caja) |
| R23 | `FE` «R21/R23…» (cuenta y caja), «`terminoDeGuia` solo da término con la lectura en modo guía» |
| R24 | `FE` «R24: oficina y /mi-wallet nombran la guía y la remisión»; `LBL` «caja (469 R24)», «oficina (469 R24)» |
| R25 | `FE` «R25/R26/R27: en modo guía viaja `resaltar`; bloque arriba…», «/mi-wallet (R25/R28)», «mensajero…», caja «R25/R28» |
| R26 | `FE` «R25/R26/R27» (insignia «Guía buscada» en la fila buscada y no en la otra; fondo solo en esa) |
| R27 | `FE` «R25/R26/R27» (el mismo string `2950.50` pintado igual en el bloque y en su fila) |
| R28 | `FE` «R28: en modo texto el detalle se pide SIN `resaltar`…»; caja «R25/R28» (texto ⇒ sin `resaltar`) |
| R35 | `FE` «R35: los textos nuevos no usan la sigla…»; `LBL` guardia de «SLA» con el placeholder de la satélite |
| R36 | `FE` «R36: la bodega satélite NO nombra la guía»; `LBL` «469 R36» |
| R49 (463) | `FE` «R49 (463): si la lectura nueva falla, el aviso sigue siendo el de la lectura pintada» |
| design §4.3 | `FE` «dos términos ⇒ dos claves SWR» |

El resto (R2–R20, R29–R34) es de servidor y está en el mapa de arriba.

**Mutaciones (una a una, revertidas):** `terminoDeGuia` sin mirar `modoBusqueda` ⇒ 3 rojos en `FE`;
`WalletLedger` sin pasar `resaltar` al panel ⇒ rojo «R25/R28» de la caja.

## Desviaciones (técnicas, decididas)

1. **Textos de la búsqueda por guía en UN módulo compartido** (`components/shared/wallet/busqueda-por-guia-labels.ts`)
   en lugar de duplicarlos en `libro-caja-labels.ts` y `estado-cuenta-labels.ts` (design §5): el aviso y el
   vacío son contrato y dos copias pueden divergir.
2. **El aviso va encima de la barra** (dentro de la tarjeta del libro en la caja; justo antes del extracto
   en las cuentas), no dentro de la fila de la barra: la barra de la 467 ya va justa de ancho (R4 de la 467).
   Es un `<p role="status">`.
3. **El bloque «Guía buscada» no nombra la tienda en móvil** (como la lista móvil del panel, que la apila);
   en `/mi-wallet` no hay columna tienda (R14 de la 344).
4. **`claveDetalle` (caja) y `claveDetalleMiMovimiento` se exportan** para poder medir «dos términos ⇒ dos
   claves» sin montar SWR.

## Verificación en la app (T15) — dev server propio, Playwright, base local, 2026-10-02

Capturas y volcados en `progress/recorrido_469/` (`volcado.json`, `volcado-mi-wallet.json`, dos `.xlsx`).
Datos: guía **38589325** (remisión `Q454-02`, tienda Tania, cierre del 2026-09-24 de Quino QUEPOS; ese cierre
emitió **7** movimientos en la caja).

| Comprobación | Resultado medido |
| --- | --- |
| Caja sin buscar | 36 movimientos (1-20 de 36) |
| Caja, guía 38589325 | Aviso R21 visible; **5** filas (contra-entrega ₡6.000, flete ₡3.000, IVA flete ₡390, comisión ₡210, IVA comisión ₡27,30) de las 7 del cierre: NO salen los dos de devolución (R9). Paginación «1-5 de 5». Tarjetas: texto idéntico antes y después (R18). |
| Abrir la contra-entrega | Bloque «Guía buscada: 38589325 · Cliente Quepos 2 · Tania · Entregado · ₡6.000»; en la lista, 1 fila resaltada (`bg-info-soft`) con la insignia «Guía buscada» y el mismo ₡6.000 (R25–R27). Cabecera «1 de 2 órdenes del cierre». |
| Caja, remisión `Q454-02` | Aviso visible; las **mismas 5 filas** que con la guía (comparadas texto a texto). |
| Caja, `99999999` (no es guía de ninguna orden) | Sin aviso; búsqueda de texto: «No hay movimientos que coincidan con los filtros.» (R6) |
| Caja, texto «Combustible» | Sin aviso; 1 fila (la corrección «Combustible flota»): sigue buscando por texto. |
| Descarga de la caja con la guía puesta | Hojas «Libro de movimientos» y «Detalle por guía». Hoja 1: 5 movimientos, «Total del periodo» Entra **6000** · Sale **0** · Cobrado a tiendas **3627,3**; aviso de filtros presente (R32). Hoja 2: un bloque (38589325), TOTAL GENERAL **6000 · 0 · 3627,3** = hoja 1 (R31). |
| Estado de cuenta de Tania | Placeholder con guía y remisión; aviso; 5 filas + saldo inicial, cada una con el saldo corrido de la cuenta entera (₡147.670,10 en la más reciente, el flete); tarjetas iguales (texto idéntico antes y después). Detalle del flete: bloque con 38589325 y ₡3.000. Descarga: «Total del periodo» Entra **6000** · Sale **3627,3**; TOTAL GENERAL **6000 · 3627,3** = hoja 1. |
| Estado de cuenta de Quino (su libro está vacío) | Aviso + vacío R22 «Esa guía o remisión no aporta dinero…» (1 coincidencia). |
| Estado de cuenta de Marco | Sin buscar: 10 movimientos. Guía **990004** (en su cierre del 2026-08-12 pero sin pago al mensajero): aviso y 0 filas (R9). Guía **990006** (aporta ₡1.700): 1 fila, el pago devengado de ₡10.200 con su saldo corrido ₡10.200 igual que sin buscar (R17); NO sale el «Pago del efectivo» del mismo cierre (R13). Tarjetas iguales. Detalle: bloque «990006 · Luis Jimenez · Tania · Reprogramado · ₡1.700». |
| Satélite (GUANACASTE) | Placeholder «Buscar por descripción o quién registró»; con la guía escrita, sin aviso (R36). |
| `/mi-wallet` de Tania (`tienda.qa`) | Placeholder «Buscar por guía, remisión o descripción»; aviso; 5 filas + saldo inicial; detalle con bloque «38589325 · Cliente Quepos 2 · Entregado · ₡3.000» (sin tienda). |

No verificado en la app: `/mi-wallet` de OTRA tienda con esa guía (R5/R29), porque en la base local no hay
ninguna orden con guía de otra tienda (consultado). Lo cubre la integración de servidor («tienda (oficina)
y /mi-wallet», «T10»).

Nota del recorrido: en `dev` aparece al entrar un diálogo «Confirmá el SINPE de GAM» (SF-001) que deja el
resto de la página `aria-hidden` hasta pulsar «Ahora no»; el script lo cierra. No es de esta ficha.

## Gate

`./init.sh` completo, `progress/gate_469_frontend.log`: **`INIT_EXIT=0`**, 2.379 archivos, **32.999 tests en
verde, 26 skipped** (los de Analítica, preexistentes; 0 integraciones saltadas: `.env` presente).
Primera corrida (`progress/gate_469_frontend_1.log`) en rojo por MI test: la guardia `ancla-de-carga` cazó una
espera anclada solo a un conteo de botones; se cambió por un ancla de contenido (`1d10556f`) y la segunda
corrida salió verde.

## Veredicto (pantalla)

Pantalla terminada y verificada en la app; ficha completa (servidor + pantalla) en esta rama, sin PR.
