# Feature 115 — Mensajero: marcar orden para "gestionar más tarde"

Requisitos en notación EARS. Cada `R<n>` termina mapeado a un test concreto en
`tasks.md` (columna `R<n>→test`, `docs/specs.md` §Trazabilidad). Sin detalles de
implementación: el CÓMO vive en `design.md`.

**Alcance (fullstack):** el mensajero puede marcar/desmarcar CADA una de sus órdenes
como "gestionar más tarde". La marca es **privada por mensajero** (nadie más la ve) y
**solo informativa**: pinta un badge y reordena visualmente las cards, pero **no cambia
el estado ni la ruta** de la orden. Persiste en una tabla nueva
`orden_mensajero_meta(usuario_id, orden_id, marcar_luego)` con `UNIQUE(usuario_id,
orden_id)`, escrita por una Server Action tipo toggle con autorización por mensajero
(cada uno solo su fila).

**Depende de (verificado contra el código, no supuesto):**
- Feature 36 — módulo del mensajero: `resolveActorFromSession()` (`lib/auth/resolve-actor.ts`),
  el `Actor {usuarioId, rol}` (`lib/interfaces/services/IOrdenService.ts`),
  `MisAsignacionesService` / `MiAsignacionDTO` (`lib/services/MisAsignacionesService.ts`,
  `lib/interfaces/services/IMisAsignacionesService.ts`), la Server Action
  `listarMisAsignaciones` (`lib/actions/mis-asignaciones.ts`) y el componente
  `MisAsignacionesModule` (`app/(app)/mis-asignaciones/_components/MisAsignacionesModule.tsx`)
  donde se listan/ordenan las cards "En reparto / por gestionar".
- Modelo `Orden.mensajeroAsignadoId` (`db/schema.prisma:369`) para acotar la marca a las
  órdenes del propio mensajero.
- Patrón de mutaciones internas por Server Action con `withErrorHandler` +
  `resolveActorFromSession` + resultado tipado discriminado (`lib/actions/mis-asignaciones.ts`).
- Patrón de tabla nueva con RLS habilitada sin policies (`plantilla_mensaje`/`api_key`) y
  migración up/down (`db/migrations/20260722130000_plantilla_mensaje/`).

**Coordinación 115/116 (dictada por el leader):** esta feature es la **DUEÑA** de la
tabla `orden_mensajero_meta` y de su **ÚNICA** migración. La migración crea la tabla ya
con **AMBAS** columnas de una vez: `marcar_luego` (la usa 115) y `nota` (la usará la 116).
La feature 116 (notas privadas) **NO crea migración**: reutiliza esta tabla. Ver
`design.md §1`.

**Fuera de alcance (follow-up, declarado):** la nota de texto privada (`nota`) y su
CRUD son de la feature 116; 115 solo hace nacer la columna. No hay filtros ni conteos
por "gestionar más tarde"; no hay reflejo de la marca en vistas de admin/maestro.

---

## Bloque A — Persistencia (tabla + migración)

- **R1 (Ubicuo):** El sistema DEBE persistir la marca en una tabla
  `orden_mensajero_meta` con, al menos, las columnas `usuario_id` (FK al mensajero),
  `orden_id` (FK a la orden) y `marcar_luego` (booleano NOT NULL con default `false`), y
  una restricción de unicidad sobre la pareja `(usuario_id, orden_id)`.
- **R2 (Ubicuo):** La misma migración DEBE crear también la columna `nota` (texto,
  NULLABLE) en `orden_mensajero_meta`, aunque esta feature NO la use (nace aquí para la
  feature 116, que NO crea migración propia).
- **R3 (Ubicuo):** La tabla `orden_mensajero_meta` DEBE tener Row Level Security
  habilitada (patrón de las tablas nuevas del repo), con la autorización de negocio
  aplicada en el service (no en policies).
- **R4 (Ubicuo):** La migración que crea la tabla DEBE ser reversible (`migration.sql`
  UP + `down.sql` DOWN que la revierte exactamente).

## Bloque B — Toggle vía Server Action

- **R5 (Por evento):** CUANDO el mensajero autenticado marca una de sus órdenes como
  "gestionar más tarde", el sistema DEBE persistir `marcar_luego = true` en la fila
  `(usuario_id = mensajero actual, orden_id = orden)`, creándola si no existía.
- **R6 (Por evento):** CUANDO el mensajero autenticado quita la marca de una de sus
  órdenes, el sistema DEBE persistir `marcar_luego = false` en su fila.
- **R7 (Condicional/idempotencia):** SI el mensajero aplica el mismo valor de marca
  sobre la misma orden más de una vez, ENTONCES el sistema DEBE dejar EXACTAMENTE UNA
  fila `(usuario_id, orden_id)` con ese valor, sin crear duplicados (garantizado por la
  restricción `UNIQUE(usuario_id, orden_id)`).
- **R8 (Ubicuo):** El `usuario_id` de la fila escrita DEBE ser SIEMPRE el del actor
  autenticado; el sistema NUNCA DEBE tomar el `usuario_id` de la entrada del cliente.
- **R9 (Condicional):** SI la entrada no trae un `ordenId` válido o un `marcarLuego` no
  booleano, ENTONCES el sistema DEBE rechazar con error de validación sin tocar la base
  de datos.

## Bloque C — Autorización (cada mensajero solo su fila)

- **R10 (Condicional):** SI la Server Action de toggle se invoca sin sesión válida,
  ENTONCES el sistema DEBE responder `unauthenticated` sin tocar la base de datos.
- **R11 (Condicional):** SI la Server Action de toggle se invoca con un actor cuyo rol
  no es `mensajero`, ENTONCES el sistema DEBE responder `forbidden` sin escribir.
- **R12 (De estado):** MIENTRAS un mensajero opera, el sistema DEBE permitirle
  leer/escribir ÚNICAMENTE su propia fila; un mensajero NUNCA DEBE poder crear, leer ni
  modificar la fila de otro mensajero.
- **R13 (Condicional):** SI la orden indicada no está asignada al actor
  (`mensajeroAsignadoId` distinto del actor), ENTONCES el sistema DEBE responder
  `forbidden` sin escribir (no se marcan órdenes ajenas).
- **R14 (Condicional):** SI la orden indicada no existe (o está borrada), ENTONCES el
  sistema DEBE responder `not_found` sin escribir.

## Bloque D — Solo informativo (no cambia estado ni ruta)

- **R15 (Ubicuo):** El toggle NO DEBE cambiar el estado (`estatus`) de la orden.
- **R16 (Ubicuo):** El toggle NO DEBE alterar la ruta/secuencia optimizada, la prioridad
  ni ningún otro atributo operativo de la orden, ni registrar ninguna transición en el
  historial de estados de la orden.

## Bloque E — Efecto visual (badge / orden)

- **R17 (Ubicuo):** El listado de asignaciones del mensajero DEBE incluir, por cada
  orden, el valor `marcar_luego` del mensajero actual (`false` cuando no existe fila para
  esa pareja).
- **R18 (De estado):** MIENTRAS una orden está marcada como "gestionar más tarde", su
  card en el módulo del mensajero DEBE mostrar un indicador visible (badge) de esa marca.
- **R19 (De estado):** MIENTRAS haya órdenes marcadas como "gestionar más tarde", el
  módulo DEBE reordenarlas visualmente respecto de las no marcadas (de-priorizarlas) SIN
  modificar la ruta persistida ni el estado de la orden (reordenado de presentación).
- **R20 (Ubicuo/privacidad):** La marca de un mensajero NUNCA DEBE ser visible para otro
  mensajero ni para otro rol: el listado solo refleja las filas del propio actor.

---

## Preguntas abiertas (requieren decisión humana)

1. **Alcance de las cards con toggle.** La descripción habla de marcar "por orden". Se
   asume que el control (marcar/quitar) y el badge viven en las cards **"En reparto / por
   gestionar"** (`en_reparto`), que es lo que el mensajero gestiona. ¿Debe ofrecerse
   también en las de **"Por recoger"** (`en_espera_aceptacion`)? Por defecto: solo "En
   reparto".
2. **Reordenado exacto (R19).** ¿Las marcadas se **hunden al final** de la lista (después
   de las no marcadas, conservando entre sí el orden de ruta) o se **agrupan** en una
   sección aparte? Por defecto: hundir al final como orden secundario de presentación,
   preservando la secuencia de ruta (feature 92) entre las no marcadas.
3. **Interacción con el bloqueo por cierre pendiente (feature 111).** Al ser puramente
   informativo (no gestiona/recoge/escoge), se asume que un mensajero con cierre
   pendiente (`bloqueado`) SÍ puede marcar/quitar. ¿Se confirma, o el toggle también se
   desactiva bajo bloqueo total? Por defecto: permitido.
