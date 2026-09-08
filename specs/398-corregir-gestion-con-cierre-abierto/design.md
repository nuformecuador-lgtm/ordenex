# 398 — Diseño

> **LLEVA MIGRACIÓN: dos valores de enum nuevos.** Ver §5. El gate rápido se negará solo y mandará
> al completo; eso es lo esperado, no un fallo.

## 1. La decisión de fondo: se corrige EN SITIO, no se anula

**Se elige: cambiar el `resultado` de la gestión dentro del cierre, en una transacción, y
recalcular el snapshot de ese cierre.**

### Alternativa DESCARTADA: anular la gestión y dejar re-gestionar

Era la opción barata —el rastro (`anulada_at` / `anulada_por`) ya existe y `deshacerGestion` ya
está escrito—, y se descarta por cuatro motivos **medidos en el árbol**, no por gusto:

1. **Deja la orden donde no debe.** `anularGestionYDevolverAGestion` la manda a `en_reparto`
   (`CierreDiaRepository.ts:1234`). El destino de un rechazo es `rechazada`
   (`ESTATUS_POR_RESULTADO`, `lib/types/gestion-destino.ts:44`). Anular obligaría a que **alguien
   vuelva a gestionar** la orden después, con la orden reasignada al mensajero que se equivocó
   (`mensajero_asignado_id` incondicional, `:1235`) — y el paquete ya está en bodega.
2. **Obliga a relajar la guardia money-critical de la 67.** El `where` de la anulación exige
   `cierreId: null` **a propósito**: el comentario del `:828-834` explica que ese mismo filtro es
   lo que impide que la wallet cobre una gestión deshecha al aprobar el cierre. Tocarlo para esta
   ficha abre exactamente el agujero que la 67 cerró.
3. **Deja huérfana una fila de `cierre_detail`.** Esa tabla es **inmutable** (sin `updated_at` ni
   `deleted_at`, `db/schema.prisma:2291`) y su grano es la ORDEN, no la gestión. Si la gestión
   sale del cierre, queda una fila de detalle de una orden que ya no aporta ninguna gestión, y no
   hay forma limpia de retirarla.
4. **No arregla el dinero por sí sola.** Anular no recalcula ningún total: habría que escribir
   igualmente el recálculo del snapshot, que es el 80 % del trabajo. Se pagaría el coste completo
   y encima quedaría el problema 1.

Corregir en sitio, en cambio, **no toca `cierre_detail`** (la orden sigue en el cierre, con su
tarifa congelada y sus descriptivos intactos: nada de lo que esa tabla guarda depende del
`resultado`), y deja el paquete resuelto solo (§3).

### Vuelta atrás

No hay «deshacer la corrección» en esta ficha, y es deliberado: una segunda corrección sería
`rechazada → entregada`, que está **fuera de alcance** y que reintroduciría el cobro. Si la
corrección se aplicó por error, la vía es la que ya existe: **rechazar el cierre**
(`resolverCierre` con `rechazado`) y que el mensajero lo re-solicite. El rastro de R10 dice quién
corrigió, cuándo y de qué a qué.

## 2. Qué se recalcula, exactamente, y con qué garantía

Todo dentro de **una** `prisma.$transaction`, en este orden:

| # | Escritura | Guardia en el `WHERE` |
| --- | --- | --- |
| 1 | `gestion_orden`: `resultado='rechazada'`, `motivo=<recibido>`, `monto_recibido=NULL`, `metodo_pago=NULL`, `pago_mensajero='0.00'`, `ingreso_bodega_rechazo=<§2.2>` | `id`, `anulada_at IS NULL`, `resultado='entregada'`, `cierre.estado IN ('solicitado','vencido')` + alcance |
| 2 | `gestion_orden_pago`: `deleteMany({ gestionId })` | — (paso 1 ya selló) |
| 3 | `orden`: `estatus_id = <rechazada>` | `id`, `estatus_id = <entregada>`, `deleted_at IS NULL` |
| 4 | `orden_historial_estado`: append vía `appendCambioEstado` | — (append) |
| 5 | `cierre_dia`: los seis totales | `id`, `estado IN ('solicitado','vencido')` + alcance |
| 6 | `historial_accion`: append vía `appendAccion` | — (append) |

Si el paso 1 afecta ≠ 1 fila → `conflict` sin efectos (R12). Si el 3 o el 5 afectan ≠ 1 fila →
`throw` → rollback (R11). Es el patrón literal de `actualizarPagosGestion` (`:1400-1463`), que ya
está en producción y probado.

### 2.1 Los cuatro totales del recaudo

`total_efectivo`, `total_simpe`, `total_transferencia`, `total_general` salen de **`computeTotales`**
(`lib/utils/cierre-totales.ts:77`) sobre `gestionOrden.findMany({ where: { cierreId, anuladaAt: null } })`
con la proyección mínima `{ resultado, pagos }`. Es **la misma función que los congeló al
solicitar** y la misma que ya usa `actualizarPagosGestion` (`:1447`). `computeTotales` ignora todo
lo que no sea `entregada` (`:82`), así que la gestión corregida deja de aportar sola: no hay que
restar deltas, y por eso snapshot y líneas no pueden divergir.

### 2.2 Los dos snapshots por gestión y sus dos totales

**Esto es lo delicado y aquí va escrito el criterio, no un «se recalcula».**

- `gestion.pago_mensajero = "0.00"`. Determinista, sin consultar nada:
  `pagoPorResultado("rechazada", *) === "0.00"` (`lib/utils/pago-mensajero.ts:22`).
- `gestion.ingreso_bodega_rechazo = ingresoBodegaPorResultado("rechazada", tarifa)`
  (`lib/utils/ingreso-bodega.ts:18`), con
  `tarifa = tarifaZonaRepo.resolvePagoTarifa(cierre.destino_zona_id, <vehículo del mensajero>)`.
  **`destino_zona_id` es la zona CONGELADA del cierre**, no la zona viva del mensajero. Ver **H2**
  en `requirements.md`: qué pasa si `tarifa_zona_mensajero` cambió entre medias es **puerta del
  humano**; el defecto propuesto es este.
- `cierre.total_pago_mensajero` y `cierre.total_ingreso_bodega_rechazos` = **la SUMA de las columnas
  congeladas** `pago_mensajero` / `ingreso_bodega_rechazo` de las gestiones vigentes del cierre,
  leídas **después** del paso 1.

> ⚠️ **Por qué la SUMA de los snapshots y no `derivarPagos`/`derivarIngresoBodega`.** Esas dos
> funciones re-derivan el importe de **todas** las gestiones con la tarifa que se les pase. Usarlas
> aquí re-escribiría, con la tarifa de hoy, el pago congelado de las **otras** gestiones del cierre
> —gestiones que nadie corrigió— y una edición de tarifa posterior a la solicitud movería dinero
> ajeno en silencio. Sumar los snapshots toca exactamente una fila y deja las demás como estaban.
> Aritmética con `Prisma.Decimal`, salida `toFixed(2)`.

## 3. El paquete: no hace falta ningún paso nuevo

La orden queda en `rechazada`, y **la aprobación del cierre ya sabe qué hacer con eso**: el bloque
de la feature 139 (`CierresAdminRepository.ts:1850-1903`) mueve las `rechazada` del mensajero a
`por_devolver` (satélite) o `por_devolver_a_tienda` (central) dentro de la misma transacción que
aprueba. No se escribe una línea para esto.

**Consecuencia declarada:** la confirmación física de la 238 exige **cobertura exacta** del conjunto
que vuelve, verificada por el servicio antes de abrir la transacción de aprobación
(`CierresAdminRepository.ts:1909-1911`). Tras la corrección, bodega tendrá que confirmar **un
paquete más** antes de poder aprobar. Eso es lo correcto: ese paquete existe y está ahí.

## 4. El rastro: por qué DOS familias nuevas y no ninguna

### 4.1 `orden_historial_origen_tipo` += `correccion_resultado_gestion`

La transición `entregada → rechazada` necesita una familia. **No se reusa `gestion`**: esa familia
significa «el mensajero registró un desenlace en la calle», y esto lo hizo un admin desde una
oficina; el historial es la única evidencia de quién decidió el rechazo que se cobra. **No se reusa
`ajuste_estado`**: su productor era `OrdenService.actualizar`, borrado el 2026-08-07.

- **NO entra en `ORIGEN_TIPOS_VISITA_REAL`.** La orden ya tiene su fila de familia `gestion` de la
  visita original, que es la que satisface el `EXISTS` de `whereIntentosVigentes`
  (`OrdenHistorialRepository.ts:214-216`). Meterla ahí no cambiaría el conteo pero sí la semántica,
  y el argumento es el mismo, palabra por palabra, que ya está escrito para `rechazo_tienda`
  (`lib/types/orden-historial.ts:114-120`): la visita **ya está contada**.
- **NO entra en `ORIGEN_TIPOS_CON_GESTION`**, aunque su fila nazca con `gestion_orden_id` poblado.
  Mismo caso declarado que `escalado_devuelta_sla`, `anclaje_devolucion` y `gestion_tienda_ayuda`.
- El conteo de intentos **sí** cambia, y por la otra puerta: el `resultado` pasa a estar en
  `RESULTADOS_QUE_CUENTAN_COMO_INTENTO` (`:218`). Es R15, y es la verdad.

### 4.2 `historial_accion_tipo` += `cierre_dia_gestion_corregida`

Categoría **`mueve_dinero`**, entidad `gestion_orden` (ya existe en el enum de entidades).

**No se reusa `cierre_dia_pagos_editados`** por tres razones concretas:

1. Su etiqueta es «Corrigió el desglose de pago de una entrega» y aquí no se corrigió un desglose:
   se corrigió **si hubo entrega**. Poner una frase falsa en el historial es el defecto que la 362
   persigue.
2. La guardia del censo exige que **el método declarado** escriba el tipo. Como esta escritura vive
   en un método nuevo (§6), reusar el tipo rompería el censo o —peor— lo dejaría verde de mentira
   (trampa 2 de `requirements.md`).
3. Filtrar «quién cambió un resultado» quedaría mezclado con correcciones de reparto que no mueven
   ni un colón del total.

Campos: `monto` = el **`total_general` nuevo** del cierre (precedente literal:
`cierre_dia_pagos_editados`, `:1488`). `valor_anterior = "entregada"`, `valor_nuevo = "rechazada"` —
son **valores de un enum del dominio**, que es exactamente el vocabulario cerrado que esa columna
admite (precedente `usuario_fulfillment_cambiado`). El **motivo NO entra**: es texto libre tecleado
por una persona, prohibido en esa tabla por R5 de la 362; vive en `gestion_orden.motivo`.
`entidad_etiqueta` vía `etiquetaDeEntidad("gestion_orden", { numGuia, numRemision })`, actor
congelado vía `resolverActorCongelado`, todo dentro de la misma `tx`.

## 5. Migración

`db/migrations/<ts>_correccion_resultado_gestion/`

**`migration.sql`** — dos `ALTER TYPE … ADD VALUE`. Sin `BEFORE`/`AFTER`: **apenden**, y ese es el
`enumsortorder` que el `down` tendrá que reproducir.

```sql
ALTER TYPE "orden_historial_origen_tipo" ADD VALUE 'correccion_resultado_gestion';
ALTER TYPE "historial_accion_tipo"       ADD VALUE 'cierre_dia_gestion_corregida';
```

**`down.sql`** — recrear-con-lista **para los dos**, porque Postgres no soporta
`ALTER TYPE … DROP VALUE`. Se copia la forma exacta de
`db/migrations/20260908140100_wallet_tienda_check_cobro_manual/down.sql`, **incluido su bloque de
aviso**, y con estas dos precondiciones ruidosas escritas dentro del archivo:

> ⚠️ **ESTAS LISTAS SON UNA FOTO DEL DÍA.** Un `down.sql` de enum recrea el tipo con la lista
> completa y **borra en silencio** los valores añadidos después de escribirse. Antes de correrlo,
> medir los catálogos:
> ```sql
> SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
>  WHERE t.typname = 'historial_accion_tipo' ORDER BY e.enumsortorder;
> SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
>  WHERE t.typname = 'orden_historial_origen_tipo' ORDER BY e.enumsortorder;
> ```
> Si devuelven algo distinto de la lista de abajo, este `down.sql` está **rancio**.
> Precondición: cero filas con `origen_tipo = 'correccion_resultado_gestion'` y cero con
> `accion = 'cierre_dia_gestion_corregida'`; si quedara alguna, el `USING` **aborta**, y eso es lo
> correcto — esa fila es lo único que dice quién corrigió un resultado que movió dinero.

Las listas se **miden** en T1.4. La cuenta esperada según el árbol de hoy es **51** en
`historial_accion_tipo` (49 del `CREATE TYPE` del down de la 380, más `zona_pago_mensajero_cambiado`,
más `cobro_tienda_registrado`) y **33** en `orden_historial_origen_tipo` — pero **se mide, no se
copia de aquí**. Ningún `down.sql` anterior se toca: son fotos históricas.

**Ninguna tabla ni columna nueva.** Sin RLS que añadir: `gestion_orden`, `cierre_dia`,
`orden_historial_estado` y `historial_accion` ya la tienen habilitada.

## 6. Capas, contratos y archivos

Patrón `Server Action → Service → Repository` (`docs/architecture.md`). Mutación interna ⇒ Server
Action, no route handler.

| Capa | Archivo | Qué se añade |
| --- | --- | --- |
| Borde (zod) | `lib/types/cierres-admin.ts` | `corregirResultadoGestionSchema` |
| Server Action | `lib/actions/cierres-admin.ts` | `corregirResultadoGestion` |
| Servicio | `lib/services/CierresAdminService.ts` (+ su interfaz) | `corregirResultadoGestion` |
| Repositorio | `lib/repositories/CierresAdminRepository.ts` (+ su interfaz) | **`corregirResultadoGestionEnCierre`** — método NUEVO |
| Catálogos | `lib/types/orden-historial.ts`, `lib/types/historial-accion.ts` | los dos valores + etiqueta + categoría |
| UI | `app/(app)/cierres-admin/_components/CorregirResultadoDialog.tsx` + montaje en `CierresAdminModule.tsx` | diálogo con aviso y motivo |

> **Método NUEVO y no una rama dentro de `actualizarPagosGestion`.** No es higiene: la guardia del
> censo del historial mide **por método**. Metido dentro, borrar el `appendAccion` nuevo dejaría la
> guardia verde porque el método ya llama a `appendAccion` por el tipo `cierre_dia_pagos_editados`.
> Medido dos veces esta semana en este repo.

### Contrato de entrada

```ts
corregirResultadoGestionSchema = z.object({
  gestionId: z.string().uuid(),
  motivo: motivoSchema,            // el MISMO de una gestión rechazada real
}).strict()
```

`nuevoResultado` **no viaja en la petición**: esta ficha corrige una y solo una pareja
(`entregada → rechazada`) y aceptar el destino desde el cliente abriría las demás por accidente.

### Contrato de salida

```ts
| { status: "ok"; gestionId: string; totales: CierreTotales }
| { status: "forbidden" }                       // R1
| { status: "no_encontrada" }                   // R2
| { status: "conflict" }                        // R3, R12
| { status: "validation_error"; fieldErrors: { motivo?: string[]; resultado?: string[] } } // R4, R5
```

Espejo exacto de `ActualizarPagosGestionServiceResult`, para que la pantalla trate los desenlaces
con el mismo código.

## 7. UI (R16)

Un diálogo hermano de `CorregirPagosDialog.tsx`, montado en el mismo sitio de
`CierresAdminModule.tsx` y visible **solo** en filas con resultado `entregada` de un cierre abierto.
Texto sin sigla ni jerga; el aviso dice, en claro, las tres cosas que van a pasar:

- el cobro registrado de esa entrega **desaparece** del cierre;
- el pago al mensajero por esa entrega **pasa a cero**;
- el paquete se tratará como una devolución al aprobar el cierre.

Confirmación explícita (escribir el motivo es la confirmación; no hay botón sin motivo).

## 8. La vía manual para desbloquear HOY el cierre atascado

**Puerta H1. No se ejecuta sin firma del humano y sin los datos medidos.** No hay Bash en esta
sesión; esto se escribe aquí para que el leader lo pueda ejecutar, no como parte de la
implementación.

`DATABASE_URL` de producción es *sensitive*, así que la escritura va por el **MCP de Supabase**.
Antes de escribir nada, **medir en solo lectura** (esto es T0.1, bloqueante):

```sql
-- 1) el cierre y su estado, y si ya está consolidado
SELECT id, estado, cierre_bodega_id, total_efectivo, total_simpe, total_transferencia,
       total_general, total_pago_mensajero, total_ingreso_bodega_rechazos
  FROM cierre_dia WHERE id = :cierre_id;

-- 2) la gestión, su desglose y su orden
SELECT g.id, g.resultado, g.monto_recibido, g.metodo_pago, g.pago_mensajero,
       g.ingreso_bodega_rechazo, g.anulada_at, o.id AS orden_id, o.num_guia, o.estatus_id
  FROM gestion_orden g JOIN orden o ON o.id = g.orden_id
 WHERE g.cierre_id = :cierre_id AND g.resultado = 'entregada';

SELECT metodo, monto FROM gestion_orden_pago WHERE gestion_id = :gestion_id;
```

**Si `estado` no es `solicitado` ni `vencido`, o `cierre_bodega_id` no es NULL, PARAR:** ese caso
está fuera del alcance de esta ficha y necesita decisión aparte.

La escritura manual es **los pasos 1-5 de §2 en una sola transacción**, omitiendo el paso 6 (el
`historial_accion` necesita el valor de enum que aún no existe). Para no dejar el acto sin rastro,
el paso 4 —la fila de `orden_historial_estado`— se escribe con `origen_tipo = 'ajuste_estado'`,
que **sí existe hoy**, y el leader anota en `progress/` la equivalencia y por qué. Cuando la ficha
aterrice, esa fila queda como el único caso con familia genérica, y se dice en el informe.

**Números a decir ANTES y DESPUÉS** (es la regla de «medir el backfill antes de desplegar»): los
seis totales del cierre, el `pago_mensajero` de la gestión y el conteo de filas de
`gestion_orden_pago`. Si al cerrar la transacción algún total no coincide con lo previsto, se
revierte.

## 9. Lo que este diseño NO hace

- No toca `cierre_detail`, `cierre_sin_gestion`, ni ninguna evidencia.
- No toca `anularGestionYDevolverAGestion` ni su `where`.
- No toca `actualizarPagosGestion`.
- No añade tablas ni columnas.
- No corrige cierres `aprobado`, `rechazado` ni consolidados.
- No emite ningún aviso al mensajero (puerta H5).
- No rediseña el modelo de cierres.
