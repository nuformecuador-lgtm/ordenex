# Feature 87 — Novedades: lista de órdenes devueltas con contacto (adminTienda)

> Requisitos en notación EARS. Sin detalles de implementación (esos van en `design.md`).
> Cada `R<n>` es testeable y se mapea a un test concreto en la columna "Test previsto".
> Zona: **fullstack** (backend: action/service/repo; frontend: page/módulo/componente).

## Contexto

La página `/novedades` es hoy un stub vacío (`app/(app)/novedades/page.tsx`). Esta feature
la rellena con la lista de órdenes **en devolución** de la tienda del `adminTienda` en
sesión, cada una con la **causa de devolución** y **botones de contacto** (llamar /
WhatsApp) al cliente. Es **solo lectura + UI**: no crea tablas ni columnas (la causa ya
existe desde la feature 73).

Definiciones fijadas por el humano (gate F1.4 adelantada — NO reabrir):
- **"En devolución" = estatus `devuelta`** (único, NO `devuelta_origen` ni `rechazada`).
- **Causa de devolución** = valor de `GestionOrden.causaDevolucion` de la **última gestión
  con destino `devuelta` VIGENTE** (no anulada, feature 67) de esa orden. Etiquetas ES en
  `causa-devolucion-options.ts`. Puede ser NULL → "sin causa registrada".
- **Botones de contacto** = componente compartido `ContactoButtons` con normalización
  E.164 Costa Rica (prefijo `506` si el número trae 8 dígitos).
- **Solo `adminTienda`**: guardia server-side + item de sidebar restringido.

---

## Requisitos

### Alcance y filtrado (backend)

- **R1** — MIENTRAS un `adminTienda` con sesión válida abre `/novedades`, el sistema DEBE
  mostrar la lista paginada de las órdenes de SU tienda cuyo estatus es `devuelta`.

- **R2** — El sistema DEBE acotar la lista a las órdenes cuya `tiendaId` es igual a
  `actor.usuarioId` (la tienda solo ve lo suyo; nunca órdenes de otra tienda).

- **R3** — El sistema DEBE incluir ÚNICAMENTE las órdenes en estatus `devuelta`, y DEBE
  excluir cualquier otro estatus (en particular `devuelta_origen` y `rechazada`).

- **R4** — El sistema DEBE excluir las órdenes borradas (`deletedAt` no nulo) de la lista.

- **R5** — SI el rol del actor NO es `adminTienda` (o no hay sesión), ENTONCES el servicio
  de listado DEBE responder `forbidden` sin devolver datos de órdenes.

### Causa de devolución (backend)

- **R6** — Por cada orden listada, el sistema DEBE derivar la causa de devolución del valor
  `causaDevolucion` de la **última** (más reciente por `createdAt`) `GestionOrden` de esa
  orden con `resultado = devuelta` y VIGENTE (`anuladaAt` nulo).

- **R7** — SI una orden en `devuelta` no tiene ninguna gestión `devuelta` vigente, o la
  gestión vigente más reciente tiene `causaDevolucion` nulo, ENTONCES el sistema DEBE
  representar su causa como "sin causa registrada" (sin romper el listado).

- **R8** — El sistema DEBE resolver la causa de TODAS las órdenes de la página con una única
  consulta agregada (sin una consulta por orden — sin N+1).

### Ordenamiento y paginación (backend)

- **R21** — El sistema DEBE ordenar la lista con las devoluciones más recientes primero, por
  la fecha (`createdAt`) de la última gestión `devuelta` VIGENTE de cada orden (la misma que
  provee la causa, R6). SI esa fecha no fuera accesible sin coste extra, ENTONCES el sistema
  DEBE ordenar por `Orden.createdAt` descendente como fallback documentado.

- **R22** — El sistema DEBE paginar la lista a 10 órdenes por página, devolviendo `items`,
  `total`, `page` y `pageSize`, reutilizando el patrón de paginación server-side y el
  componente `Pagination` existentes (features 7/8, molde `mi-wallet`).

### Presentación (frontend)

- **R9** — MIENTRAS se renderiza la lista, el sistema DEBE mostrar por cada orden: el número
  de guía (`Orden.numGuia`), el nombre del destinatario (`Orden.destinatario`), la causa de
  devolución con su etiqueta en español, y los botones de contacto.

- **R10** — SI la lista está vacía (la tienda no tiene órdenes en `devuelta`), ENTONCES el
  sistema DEBE mostrar un estado vacío legible en vez de una tabla/lista sin filas.

- **R11** — El sistema DEBE mostrar la etiqueta ES de la causa derivada del SEED
  (`CAUSA_DEVOLUCION_LABEL`), NUNCA el slug crudo del enum (`not_found`, etc.).

### Contacto y normalización (componente compartido)

- **R12** — El sistema DEBE proveer un componente compartido `ContactoButtons` que, dado un
  teléfono y un nombre, renderiza un botón "Llamar" (`tel:`) y un botón "WhatsApp"
  (`wa.me`).

- **R13** — CUANDO se construye el enlace de WhatsApp y el teléfono, tras quitar los no
  dígitos, tiene exactamente 8 dígitos, el sistema DEBE anteponer el prefijo de país `506`
  (resultado `506########`).

- **R14** — SI el teléfono ya comienza por `506` o por `+`, ENTONCES el sistema DEBE
  respetar el prefijo existente y NO anteponer `506` de nuevo (no duplicar el código país).

- **R15** — El sistema DEBE usar el teléfono normalizado (R13/R14) en el enlace `wa.me`,
  corrigiendo el bug heredado de `GestionarOrdenPanel` que hoy hace
  `wa.me/${telefonoDest.replace(/[^\d]/g,"")}` sin prefijar `506`.

- **R16** — El botón "Llamar" DEBE abrir el enlace `tel:` con el teléfono de la orden.

- **R17** — `GestionarOrdenPanel` DEBE consumir `ContactoButtons` en lugar de sus botones
  inline (deduplicar, no forkear), conservando su comportamiento visible salvo la mejora del
  prefijo `506` en WhatsApp (R15).

### Permisos y visibilidad

- **R18** — CUANDO se solicita `/novedades` y el rol del actor NO es `adminTienda` (o no hay
  sesión), ENTONCES el sistema DEBE responder `notFound()` sin renderizar la lista.

- **R19** — SI la Server Action de listado no responde `ok`, ENTONCES la página DEBE
  responder `notFound()` (defensa en profundidad, sin exponer datos parciales).

- **R20** — El item de sidebar "Novedades" DEBE ser visible SOLO para el rol `adminTienda`;
  el rol `mensajero` DEJA de verlo.

---

## Trazabilidad (R → test previsto)

| R | Capa | Test previsto |
| --- | --- | --- |
| R1 | service | `NovedadesService.listar` devuelve solo órdenes `devuelta` de la tienda del actor |
| R2 | service | listar acota `where.tiendaId = actor.usuarioId`; otra tienda no aparece |
| R3 | service/repo | excluye estatus distintos de `devuelta` (`devuelta_origen`/`rechazada` no aparecen) |
| R4 | repo | excluye órdenes con `deletedAt` no nulo |
| R5 | service | rol no `adminTienda` → `forbidden` sin datos |
| R6 | repo/service | causa = última gestión `devuelta` vigente (ignora gestiones más antiguas) |
| R7 | repo/service | orden sin gestión vigente / causa nula → "sin causa registrada" |
| R8 | repo | una sola consulta para las causas de las N órdenes de la página (sin N+1) |
| R21 | repo/service | orden por fecha de la última gestión `devuelta` vigente, desc (fallback `Orden.createdAt`) |
| R22 | service/component | pagina 10/página; respuesta `{ items, total, page, pageSize }`; `Pagination` |
| R9 | component | `NovedadesModule` renderiza guía, destinatario, causa y contacto por fila |
| R10 | component | lista vacía → estado vacío, sin filas |
| R11 | component | muestra label ES (`Cliente no localizado`), nunca `not_found` |
| R12 | component | `ContactoButtons` renderiza botón Llamar y botón WhatsApp |
| R13 | util | normaliza 8 dígitos → `506########` |
| R14 | util | teléfono con `506`/`+` no se re-prefija |
| R15 | component | `ContactoButtons` arma `wa.me/506...` (regresión del bug heredado) |
| R16 | component | botón Llamar usa `tel:<telefono>` |
| R17 | component | `GestionarOrdenPanel` usa `ContactoButtons` (no botones inline) |
| R18 | page | rol ≠ `adminTienda` / sin sesión → `notFound` |
| R19 | page | action ≠ `ok` → `notFound` |
| R20 | unit | `menu-visibility`: "Novedades" solo para `adminTienda`; mensajero no la ve |

---

## Decisiones resueltas (gate F1.4, 2026-07-17)

Las 5 decisiones abiertas quedaron cerradas por el humano:

1. **Identificador visible de la orden (R9): `num_guia`.** Cada card/fila muestra la GUÍA
   (NO `num_remision`). Campo verificado en el schema: `db/schema.prisma:311`
   (`numGuia Int? @map("num_guia")`, NULLABLE — feature 17) y en `lib/types/orden.ts:92`
   (`numGuia: number | null`). El nombre real es `numGuia`; se usa ese. Como es nullable
   (guía pendiente), la UI muestra un placeholder legible cuando `numGuia` es `null`.

2. **Ordenamiento (R21): más recientes primero**, por la fecha (`createdAt`) de la última
   gestión `devuelta` VIGENTE de cada orden (la misma consulta de la causa, R6). Fallback
   documentado: `Orden.createdAt` descendente si esa fecha no fuera accesible sin coste
   extra (ver `design.md` §2.1/§2.2).

3. **Coherencia con feature 67 (R7): se confía en la 67.** Se asume que la feature 67 saca
   la orden del estatus `devuelta` al anular su gestión. La lista filtra por estatus
   `devuelta` y toma la causa de la última gestión `devuelta` VIGENTE (no anulada). Causa
   NULL (devoluciones previas a la 73) → "Sin causa registrada". NO se añade validación
   cruzada extra.

4. **Normalización de teléfono (R13/R14):** 8 dígitos → prefijo `506`; si ya trae `506` o
   `+`, se respeta; cualquier otro caso → solo dígitos, SIN prefijar (no se inventa `+506`).

5. **Paginación (R22): sí, 10 por página.** Server-side, reutilizando el patrón de
   paginación (features 7/8) y el componente `Pagination`, con respuesta
   `{ items, total, page, pageSize }` (molde `mi-wallet`).
