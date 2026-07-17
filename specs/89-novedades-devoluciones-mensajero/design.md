# Feature 89 — Design

> Decisiones técnicas para re-anclar `/novedades` a la GESTIÓN de devolución vigente (no al
> estatus actual). Enfoque A (decisión (a) del humano): SIN entidad/tabla `Novedad`; se deriva de
> las órdenes + `gestion_orden`. No hay migración. **Zona: backend** (ver §7): la causa tipificada
> ya se expone y se renderiza hoy; no hay trabajo de frontend ni de tipos del DTO.

## 1. Modelo de datos

**Sin cambios de esquema.** No se crean tablas ni columnas; no hay migración `up/down`.
Se reutilizan las tablas existentes:

- `orden` — `id`, `numGuia`, `destinatario`, `telefonoDest`, `tiendaId`, `estatusId`,
  `deletedAt`, `createdAt`, relación `estatus` (`order_status.value`).
- `gestion_orden` — `ordenId`, `resultado` (`GestionResultado`), `causaDevolucion`
  (`GestionCausaDevolucion?`), `anuladaAt` (`DateTime?`), `createdAt`.

**RLS:** intacta. `gestion_orden` tiene RLS habilitada sin policies (solo service role); la lectura
ocurre server-side vía Prisma en el repositorio. La restricción por tienda es de negocio (WHERE
`tiendaId = actor.usuarioId`), como hoy en la feature 87.

**Índice:** ninguno en esta feature (decisión #3). Candidato de follow-up si el volumen lo exige:
`gestion_orden (orden_id, resultado, anulada_at)`.

## 2. Predicado central (choke-point R1–R8)

Una orden es NOVEDAD de una tienda ⇔ **todas** estas condiciones:

```
orden.tiendaId   = <tienda del actor>
orden.deletedAt  IS NULL
orden.estatus.value NOT IN ("entregada", "devuelta_origen", "recibido_origen")   -- "cerrada" (R3, ratificada)
EXISTS (
  gestion_orden g
  WHERE g.orden_id = orden.id
    AND g.resultado = "devuelta"
    AND g.anulada_at IS NULL                                                       -- gestión VIGENTE (R1/R7)
)
```

Este predicado sustituye al actual `estatus.value = "devuelta"` en
`countDevueltasByTienda`/`findDevueltasByTienda`. Con Prisma se expresa con la relación de
gestiones (`some`) + `where.estatus.value.notIn`. El nombre exacto de la back-relation
(`orden` → `gestion_orden`) lo confirma el implementer contra `schema.prisma`; el diseño asume
`some: { resultado: "devuelta", anuladaAt: null }`.

**Consistencia count/find (R8):** ambos métodos comparten el MISMO objeto `where`
(extraído a un helper privado del repo) para que no puedan divergir.

**Orden por recencia (R12):** el orden estricto por fecha de la gestión vigente más reciente lo
sigue aplicando el `NovedadesService` en memoria con la fecha traída por
`findCausasDevueltaVigentes` (patrón actual, sin cambios). El `findDevueltasByTienda` ordena por
`Orden.createdAt desc` como fallback documentado y para que el `skip/take` sea determinista.

## 3. Cambios por capa

### 3.1 Repositorio — `lib/repositories/OrdenRepository.ts` (+ `IOrdenRepository.ts`)

- `countDevueltasByTienda(tiendaId, ...)` y `findDevueltasByTienda(tiendaId, ..., pagination)`:
  cambian su `WHERE` de `estatus.value = "devuelta"` al **predicado central** (§2).
  - **Firma:** el parámetro `estatusValue: string` deja de tener sentido semántico (ya no se
    filtra por un estatus único). Se propone reemplazarlo por el conjunto de estatus **cerrados**
    `cerrados: string[]` (que el service pasa desde una constante), preservando la regla "el repo no
    hardcodea valores de catálogo" (mismo principio que la feature 87). Así el service sigue siendo
    la fuente de la lista de estatus cerrados y el repo solo aplica el `notIn`.
- `findCausasDevueltaVigentes(ordenIds)`: **sin cambios** (ya devuelve `{ causa, fecha }`, que es
  lo que el service necesita para la causa tipificada y el orden por recencia). NO se agrega
  `motivo` (decisión #2: "el motivo" = `causa_devolucion`, ya cubierto por `causa`).

### 3.2 Interfaces — `lib/interfaces/repositories/IOrdenRepository.ts`

- `countDevueltasByTienda` / `findDevueltasByTienda`: actualizar firma (`estatusValue` →
  `cerrados: string[]`) y el JSDoc (nuevo predicado "gestión devuelta vigente + orden abierta").
- `CausaDevueltaVigente`: **sin cambios** (no gana `motivo`).
- `NovedadOrdenRow`: **sin cambios**.

### 3.3 Servicio — `lib/services/NovedadesService.ts` (+ `INovedadesService.ts`)

- Reemplaza la constante `ESTATUS_DEVUELTA = "devuelta"` por la lista de estatus **cerrados**
  `ESTATUS_CERRADOS = ["entregada", "devuelta_origen", "recibido_origen"]` (R3) y la pasa a
  `count`/`find`.
- El mapeo a `NovedadDTO` **no cambia**: `causa` sigue derivándose de la gestión vigente más
  reciente (R10). No se añade `motivo`.
- Rol `adminTienda` (R11), paginación 10 (R12/R13), orden por recencia (R12) y shape de respuesta
  (R13): **sin cambios**.
- Actualizar el JSDoc de `INovedadesService` a la nueva semántica ("devuelta vigente y abierta").

### 3.4 Tipo DTO — `lib/types/novedad.ts`

- **Sin cambios.** `NovedadDTO` ya expone `causa` (la causa tipificada = "el motivo" del humano).

### 3.5 Frontend — `app/(app)/novedades/_components/NovedadesModule.tsx`

- **Sin cambios.** Ya renderiza `causaLabel(novedad.causa)` (etiqueta ES). Una vez re-anclada la
  query, las novedades dejan de estar vacías y la causa aparece poblada (R10, verificación).

### 3.6 Server Action / borde

- `lib/actions/novedades.ts` (feature 87) **no cambia**.

## 4. Contratos I/O

**Sin cambios de contrato.** Entrada `ListarNovedadesInput { page, pageSize }` + actor; salida
`NovedadDTO { id, numGuia, destinatario, telefonoDest, causa }` y
`ListarNovedadesServiceResult = { status: "ok"; items; total; page; pageSize } | { status: "forbidden" }`.
Lo único que cambia es **qué órdenes** entran en `items`/`total` (el predicado §2), no la forma.

## 5. Alternativas descartadas

### 5.1 Filtrar por `estatus.value = "devuelta"` (mantener la feature 87 tal cual) — DESCARTADA

Es lo que hay hoy y es exactamente el bug: la feature 47 saca la orden de `devuelta` en la misma
transacción, así que la lista sale **vacía** para las devoluciones reales del mensajero. No cumple
el pedido literal. Descartada por incorrecta.

### 5.2 Cambiar la feature 47 para que la orden se quede en `devuelta` — DESCARTADA

Podría "arreglar" `/novedades` sin tocar su query, pero rompería el flujo de reintento/escalado
(features 46/47/48): la orden dejaría de rutearse a bodega o de escalar a `rechazada`, alterando la
operación del mensajero y la caja. Alto blast radius sobre features estables. Fuera de alcance
explícito (feature_list). Descartada.

### 5.3 Materializar una entidad/tabla `Novedad` (o vista SQL / columna denormalizada) — DESCARTADA

Añadiría una tabla nueva (con RLS, migración up/down, y sincronización con cada gestión/transición),
introduciendo riesgo de divergencia (novedad "fantasma" tras entregar/cerrar). La feature 87 ya
descartó materializar la novedad; el humano ratificó Enfoque A ("de la misma tabla ordenes").
Derivar en lectura es más simple y siempre consistente. Descartada por sobre-ingeniería.

### 5.4 Añadir el campo de texto libre `motivo` al DTO y a la vista — DESCARTADA

Fue la interpretación inicial de «agregar el motivo». El humano aclaró en el gate que «el motivo»
= `causa_devolucion` (la causa tipificada), que **ya se expone y se renderiza**. Añadir el texto
libre `motivo` sería alcance no pedido (toca `novedad.ts`, `findCausasDevueltaVigentes`,
`NovedadesModule.tsx` y sus tests) sin valor solicitado. Descartada por alcance.

### 5.5 Mantener `estatusValue: string` y pasar `"devuelta"` para reusar índices — DESCARTADA

Conservar la firma sería menos disruptivo, pero el parámetro perdería significado (ya no se filtra
por un estatus) y ocultaría el cambio semántico real, dificultando el mantenimiento y los tests.
Se prefiere una firma honesta (`cerrados: string[]`). Descartada por claridad.

## 6. Testing (patrones reales del repo)

Vitest 4 (`pnpm test`), `globals: true`, alias `@`→root. Servicios/repos con **dobles** (sin
DB/HTTP), patrón de `NovedadesService.test.ts` y `orden-repository.novedades.test.ts` (feature 87).
El service se testea con un `Pick<IOrdenRepository, ...>` mockeado; el repo se testea con un doble
de Prisma que verifica el `where` construido. Ver el mapa R→test en `tasks.md`.

## 7. Zona = BACKEND (justificación)

Con la decisión #2 ratificada, la causa tipificada ("el motivo") **ya se expone en el DTO y se
renderiza** en `NovedadesModule.tsx`. Por tanto NO hay cambios de frontend ni de tipos del DTO. El
único trabajo es:
1. re-anclar la query del repositorio al predicado §2 (`OrdenRepository`/`IOrdenRepository`),
2. ajustar la constante y la semántica de `NovedadesService`,
3. tests (unit con dobles) + regresión de la feature 87.

Todo eso vive en `lib/` (backend). No se toca `app/`. De ahí que la zona pase de fullstack a
**backend**.

## 8. Límites / fuera de alcance

- No se crea entidad/tabla `Novedad`.
- No se toca la feature 47 (la orden sigue saliendo de `devuelta`).
- No se amplía la visibilidad (sigue solo `adminTienda`).
- No se agrega el campo de texto libre `motivo` (decisión #2).
- La feature 74 (explotar/agrupar la causa) sigue aparte.
- Sin migración salvo que el humano ratifique un índice (decisión #3).
