# Feature 87 — Design técnico

> Feature **solo lectura + UI**. Sigue el patrón de capas Controller (Server Action) →
> Service → Repository de `docs/architecture.md`. Molde principal: `recepcion-satelite`
> (page + `RecepcionSateliteService` + `OrdenRepository` + tests de componente) y
> `mi-wallet/page.tsx` (guardia de rol server-side + defensa en profundidad).

## 1. Modelo de datos — SIN migración

**No se crean tablas ni columnas.** La causa de devolución ya existe desde la feature 73
(`GestionOrden.causaDevolucion`, enum `GestionCausaDevolucion`, `db/schema.prisma:417`) y el
estatus `devuelta` ya está en el catálogo/seed. Esta feature solo LEE. Por tanto:

- No hay `migration.sql` ni `down.sql`.
- No se toca RLS (no hay tabla nueva). `gestion_orden` y `orden` ya tienen RLS con
  service-role.
- Índices reutilizados: `orden(@@index([tiendaId]))`, `orden(@@index([estatusId]))`,
  `gestion_orden(@@index([ordenId]))`.

Se declara explícitamente en `tasks.md` que NO hay tarea de migración.

## 2. Backend

### 2.1 Repository — `lib/repositories/OrdenRepository.ts`

Dos métodos nuevos (solo queries Prisma, sin lógica de negocio):

**`countDevueltasByTienda(tiendaId, estatusValue): Promise<number>`**
- `count` sobre `orden` con `where: { tiendaId, deletedAt: null, estatus: { value: estatusValue } }`
  (R2/R3/R4). Alimenta `total` de la respuesta paginada (R22).

**`findDevueltasByTienda(tiendaId, estatusValue, { skip, take }): Promise<NovedadRow[]>`**
- `findMany` sobre `orden` con `where: { tiendaId, deletedAt: null, estatus: { value: estatusValue } }`
  (R2/R3/R4). `estatusValue` lo pasa el service (`"devuelta"`), no se hardcodea en el repo.
- Selecciona `id, numGuia, destinatario, telefonoDest, createdAt`.
- `skip`/`take` para la paginación (R22).
- **Ordenamiento (R21):** el orden por la fecha de la última gestión `devuelta` vigente no
  es expresable en un `orderBy` de Prisma sobre `orden` sin un join agregado costoso. Se
  aplica el **fallback documentado**: `orderBy: { createdAt: "desc" }` de la ORDEN. La causa
  y su fecha se resuelven aparte (siguiente método); si en implementación se prefiere el
  orden estricto por fecha de gestión, se reordena en el service con la fecha ya traída por
  `findCausasDevueltaVigentes` (que devuelve también `createdAt` de la gestión) — decisión
  documentada aquí, sin coste extra de query. La primera versión usa el fallback por orden.

**`findCausasDevueltaVigentes(ordenIds): Promise<Map<string, { causa: GestionCausaDevolucion | null; fecha: Date }>>`**
- UNA sola consulta para las causas de las órdenes de LA PÁGINA (R8, evita N+1).
- `findMany` sobre `gestion_orden` con
  `where: { ordenId: { in: ordenIds }, resultado: "devuelta", anuladaAt: null }`,
  `orderBy: { createdAt: "desc" }`, `select: { ordenId, causaDevolucion, createdAt }`.
- Reduce en memoria a un `Map<ordenId, { causa, fecha }>` quedándose con la PRIMERA fila por
  `ordenId` (la más reciente, por el `orderBy desc`) → última gestión vigente (R6). `fecha`
  = `createdAt` de esa gestión, disponible para el reordenamiento estricto de R21.
- Órdenes sin fila en el mapa → causa ausente (R7).
- Reutiliza el criterio de "vigente" (`anuladaAt IS NULL`) de
  `contarPorDestinoVigentes`/`contarIntentos` (`OrdenHistorialService.ts:56-68`,
  `OrdenHistorialRepository.ts:90-106`), aplicado aquí como filtro de LECTURA.

Ambos métodos se declaran en `IOrdenRepository` (`lib/interfaces/repositories/`) y se
consumen por `Pick<IOrdenRepository, ...>` en el service (mockeable en tests).

### 2.2 Service — `lib/services/NovedadesService.ts`

Nuevo service (lógica de negocio pura, sin HTTP ni Prisma; DI por constructor):

```
class NovedadesService implements INovedadesService {
  constructor(private readonly repo: Pick<IOrdenRepository,
    "countDevueltasByTienda" | "findDevueltasByTienda" | "findCausasDevueltaVigentes">) {}

  async listar(input: { page: number; pageSize: number }, actor): Promise<ListarNovedadesServiceResult>
}
```

Lógica de `listar` (input paginado, `pageSize` acotado a 10 por defecto, R22):
1. `if (actor.rol !== "adminTienda") return { status: "forbidden" }` (R5). Único rol
   autorizado (paridad con `RecepcionSateliteService.ROL_AUTORIZADO`).
2. `total = await repo.countDevueltasByTienda(actor.usuarioId, "devuelta")` (R22).
3. `skip = (page - 1) * pageSize`;
   `rows = await repo.findDevueltasByTienda(actor.usuarioId, "devuelta", { skip, take: pageSize })`
   (R1/R2/R3/R4/R22). Orden por `Orden.createdAt` desc (fallback R21).
4. Si `rows` vacío → `{ status: "ok", items: [], total, page, pageSize }` (R10 lo pinta el front).
5. `causas = await repo.findCausasDevueltaVigentes(rows.map(r => r.id))` (R8).
6. Mapea a `NovedadDTO[]`: por cada row, `causa = causas.get(row.id)?.causa ?? null` (R6/R7).
   Opcional (R21 estricto): reordenar los `items` de la página por `causas.get(id)?.fecha`
   desc antes de devolver, con la fecha ya traída (sin query extra).
7. Devuelve `{ status: "ok", items, total, page, pageSize }`.

Constante `ESTATUS_DEVUELTA = "devuelta"` en el service (patrón `OrdenHistorialService.ts:12`).

**`NovedadDTO`** (en `lib/types/novedad.ts`, serializable — cruza el borde RSC):
`{ id, numGuia: number|null, destinatario, telefonoDest, causa: GestionCausaDevolucion|null }`.
`numGuia` es NULLABLE (feature 17: se asigna en "Generar guía"); la UI muestra un
placeholder si es `null` (R9). La traducción a etiqueta ES ocurre en el cliente (R11), NO en
el DTO.

### 2.3 Controller — Server Action `lib/actions/novedades.ts`

`'use server'`. `listarNovedadesAction(input?: { page?: number })`:
- Valida `input` en el borde con zod (`page` entero ≥ 1, default 1; `pageSize` fijo 10).
- `resolveActorFromSession()` (`lib/auth/resolve-actor.ts`).
- Instancia repo + service, llama `service.listar({ page, pageSize: 10 }, actor)`, devuelve
  el resultado.
- Sin lógica de negocio ni queries (delega en el service). Se usa como pre-fetch server-side
  (página 1) desde la page Y como re-fetch de página desde el módulo cliente al cambiar de
  página (patrón `mi-wallet`: `listarMisMovimientosAction({ page })`). Server Action, no
  route handler — el teléfono del cliente es PII, no se expone route API pública.

## 3. Frontend

### 3.1 Page — `app/(app)/novedades/page.tsx`

Server Component, molde `mi-wallet/page.tsx:23-40`:
1. `actor = await resolveActorFromSession()`.
2. `if (!actor || actor.rol !== "adminTienda") notFound()` (R18).
3. `result = await listarNovedadesAction({ page: 1 })` (pre-fetch página 1).
4. `if (result.status !== "ok") notFound()` (R19, defensa en profundidad).
5. Renderiza `<PageHeader title="Novedades" .../>` +
   `<NovedadesModule items={result.items} total={result.total} page={result.page} pageSize={result.pageSize} />`.

### 3.2 Módulo — `app/(app)/novedades/_components/NovedadesModule.tsx`

Client component privado (recibe datos por props del Server Component que ya validó el rol,
arquitectura §componentes `private/`). Recibe `{ items: NovedadDTO[], total, page, pageSize }`
(molde `MiWalletModule`).
- Estado vacío si `items.length === 0` (R10).
- Por cada novedad renderiza una tarjeta/fila con: `numGuia` (o placeholder si `null`, R9),
  `destinatario`, causa con etiqueta ES vía
  `CAUSA_DEVOLUCION_LABEL[causa] ?? "Sin causa registrada"` (R7/R9/R11), y
  `<ContactoButtons telefono={n.telefonoDest} nombre={n.destinatario} />`.
- `<Pagination page pageSize total />` (`components/shared/Pagination`) al pie; al cambiar de
  página, re-fetch con `listarNovedadesAction({ page })` y actualiza `items/total/page` en
  estado local (patrón `MiWalletModule`, R22).
- Reutiliza `causa-devolucion-options.ts` (`CAUSA_DEVOLUCION_LABEL`) — no duplica strings.

### 3.3 Componente compartido — `components/shared/ContactoButtons.tsx`

Nuevo compuesto reutilizable (2 features lo usan → cumple la regla "sin sobre-ingeniería":
se promueve a `shared/` porque `/novedades` y `mis-asignaciones/GestionarOrdenPanel` lo
necesitan con la misma API).

Contrato de props:
```
interface ContactoButtonsProps {
  telefono: string;
  nombre: string;          // para aria-label ("Llamar a <nombre>", "WhatsApp a <nombre>")
  size?: "sm" | "lg";      // lg = size-14 (panel del mensajero); sm = compacto para la lista
}
```
Comportamiento:
- Botón Llamar (lucide `Phone`): `window.open("tel:" + telefono, "_self")` (R16).
- Botón WhatsApp (lucide `MessageCircle`): `window.open("https://wa.me/" + normalizarCR(telefono), "_blank")` (R12/R15).
- Mantiene `variant="outline" size="icon"` y los `aria-label` actuales del panel.

### 3.4 Normalización — `lib/utils/telefono-cr.ts`

Función pura `normalizarTelefonoCR(raw: string): string` (helper sin side-effects, testeable):
1. `if (raw.trim().startsWith("+")) return raw.replace(/[^\d]/g, "")` — respeta `+` (R14).
2. `const digitos = raw.replace(/[^\d]/g, "")`.
3. `if (digitos.startsWith("506")) return digitos` — ya trae código país (R14).
4. `if (digitos.length === 8) return "506" + digitos` — CR local (R13).
5. `return digitos` — longitudes atípicas: sin prefijo (ver pregunta abierta 4).

### 3.5 Refactor de `GestionarOrdenPanel` (R17)

Reemplazar el bloque inline de botones (`GestionarOrdenPanel.tsx:304-341`, hoy `Phone` +
`MessageCircle` con `wa.me/${orden.telefonoDest.replace(/[^\d]/g,"")}` SIN `506`) por
`<ContactoButtons telefono={orden.telefonoDest} nombre={orden.destinatario} size="lg" />`.
Único cambio visible permitido: el enlace WhatsApp ahora prefija `506` (R15, mejora deseada).
Se conserva el botón "Gestionar esta orden" que estaba en el mismo contenedor (NO entra al
componente compartido: es específico del panel).

### 3.6 Sidebar — `lib/auth/menu-visibility.ts:81-88` (R20)

Cambiar `roles: ["adminTienda", "mensajero"]` → `roles: ["adminTienda"]` en el item
"Novedades". Actualizar el comentario (ya no lo ve el mensajero). Actualizar
`tests/unit/auth/menu-visibility.test.ts`: quitar "Novedades" de la lista esperada del
mensajero y de sus asserts de visibilidad; conservarla en la del adminTienda.

## 4. Contratos I/O

- `listarNovedadesAction(input?: { page?: number }): Promise<{ status: "ok", items: NovedadDTO[], total: number, page: number, pageSize: number } | { status: "forbidden" | "unauthenticated" }>`.
- La page traduce cualquier `status !== "ok"` a `notFound()` (R19).
- `NovedadDTO` 100% serializable (strings + number|null) para cruzar el borde RSC.
- Shape de respuesta paginada `{ items, total, page, pageSize }` idéntico al de
  `listarMisMovimientosAction` (`mi-wallet`) para reutilizar `Pagination` sin adaptar (R22).

## 5. Alternativas descartadas

1. **Materializar la causa en `Orden` (columna `causa_devolucion` en la orden).**
   Descartada: exigiría migración + backfill + mantener sincronía con las gestiones (la
   causa cambia con reintentos/anulaciones, features 46/47/67). La causa ya es la última
   gestión vigente; duplicarla en `Orden` introduce una fuente de verdad paralela que puede
   divergir. Esta feature es solo lectura por decisión del humano.

2. **Query por orden (N+1): resolver la causa dentro del map de cada orden.**
   Descartada por rendimiento y por el anti-patrón "queries sin índice/repetidas en ruta
   caliente" (arquitectura §anti-patrones). Se usa una consulta agregada con `in` + `orderBy
   desc` + reducción en memoria (2.1), patrón `contarPorDestinoVigentes`.

3. **Route handler `app/api/novedades` + SWR en el cliente.**
   Descartada: el teléfono del destinatario es PII y el listado es sensible por tienda. La
   arquitectura manda pre-fetch server-side + props para datos privados y reserva SWR para
   datos públicos. Se usa Server Action + Server Component (molde `mi-wallet`).

4. **Botones de contacto inline también en `/novedades` (copiar el bloque del panel).**
   Descartada: duplicaría el bug del `506` y dos implementaciones divergentes. El humano pide
   extraer a `components/shared/ContactoButtons.tsx` y que el panel lo consuma (R17).

## 6. Verificación

- `pnpm run typecheck`, `pnpm run lint`, `pnpm test` en verde; `./init.sh` verde.
- Sin migración → sin `pnpm run db:rollback` que probar.
- Tests unit (service/repo/normalización) + tests de componente (módulo, ContactoButtons,
  panel) + test unit de `menu-visibility`. Mapa `R<n> → test` en `progress/impl_87.md`.
