# Feature 321 — Diseño técnico

> Cubre `R1..R45` de `requirements.md`. Todo lo que se afirma aquí sobre el código existente está
> **confirmado en el archivo real** (regla 7 de `CLAUDE.md`: el grafo dice dónde mirar, el archivo
> dice qué hay).
>
> **Revisión del 2026-08-28.** Incorpora las nueve decisiones de la puerta humana. Los cambios de
> fondo respecto a la primera versión son tres: **la unidad del hilo pasa a ser (orden, mensajero)**
> (P1), **el listado también se pagina y no trae mensajes** (P8), y **la alternativa A6 queda
> descartada, no aplazada** (P2). La feature **sigue sin migración**.
>
> **Corrección documental del 2026-08-28 (post-implementación, sin cambio de alcance).** Dos
> apartados decían algo que el código nunca hizo, y se corrigen **al código**, no al revés:
> **§2.4** escribía el `EXISTS` del filtro de fecha correlacionado por fila (`m2.conversacion_id =
> c.id`) cuando la correlación correcta —y la implementada— es por la **clave del hilo**
> `(orden_id, mensajero_id)`; y **§7 punto 7** afirmaba que `./init.sh --rapido` no puede negarse
> cuando el DTO en `lib/types/` **exige el gate completo por diseño**. **`R1..R45` no cambian**:
> siguen implementados y verificados.

---

## 1. Modelo de datos — **NO cambia** (R27)

### 1.1 Lo que ya existe y basta

```
ChatConversacion (chat_conversacion)          db/schema.prisma:295-316
  id, telefono_e164, orden_id, mensajero_id,
  ultimo_entrante_at, mensajero_leido_at, created_at, updated_at
  @@unique([ordenId, telefonoE164])    ← la fila se keyea por TELÉFONO, no por mensajero
  @@index([mensajeroId])               ← sirve al filtro por mensajero (R33) y al GROUP BY
  @@index([telefonoE164])

ChatMensaje (chat_mensaje)                    db/schema.prisma:322-373
  id, conversacion_id, direccion, tipo, cuerpo, media_*, reaccion_*,
  contactos_json, sistema_telefono_anterior/nuevo, ocurrido_at, created_at
  @@index([conversacionId, ocurridoAt])   ← EL índice de esta feature (R19, R42)
  @@index([conversacionId, reaccionAWaMessageId], map: "chat_mensaje_reaccion_idx")
  ⚠ NO tiene columna de mensajero → ver §1.3.2 (R45)

Orden (orden)                                 db/schema.prisma:563-762
  destinatario, num_guia (Int? @unique), num_remision (String), mensajero_asignado_id,
  deleted_at, busqueda_texto (GENERATED, GIN trgm "orden_busqueda_texto_trgm_idx")
```

**RLS.** `chat_conversacion` y `chat_mensaje` tienen RLS habilitada **sin policies** (sólo service
role): la autorización de negocio vive en el service, no en la base (`db/schema.prisma:293-294`,
`:321`). Esta feature **no crea tablas** ni **relaja** ninguna policy; el ensanche de §4 es una
decisión de servicio, escrita y con test propio.

### 1.2 Lo que la búsqueda libre NO cubre y hay que resolver

`orden.busqueda_texto` concatena guía, remisión, teléfono (con y sin separadores), destinatario y
producto (`db/schema.prisma:638-654`). **No incluye el nombre del mensajero**, y el pedido sí lo
exige (R36). El criterio es un `OR` de dos mitades:

1. `orden.busqueda_texto ILIKE %término%` en una o dos formas del término (`terminoDeBusqueda`,
   `lib/utils/filtros-listado-ordenes.ts:93-99`) — cubre destinatario, `num_guia`, `num_remision`;
2. el nombre completo del mensajero (`usuario.nombre || primer_apellido || segundo_apellido`)
   **normalizado con la misma expresión** que la columna generada.

Para (2) se añade el helper SQL puro `sqlNormalizarTextoBusqueda(expr)` en
`lib/utils/busqueda-texto-sql.ts`, **espejo** de `normalizarTerminoBusqueda`
(`lib/utils/busqueda-orden.ts:76-81`), con test de paridad. Es el patrón de
`sqlNormalizarTelefonoCr` (`lib/utils/telefono-cr-sql.ts`, consumido en
`ChatConversacionRepository.ts:89`). Sin índice funcional: `usuario` es la tabla del personal
interno (cientos de filas), no la caliente.

### 1.3 La unidad del hilo: **(orden, mensajero)** — P1

#### 1.3.1 Por qué hace falta fusionar, y cómo se fusiona sin tocar la DB

La tabla se keyea `@@unique([ordenId, telefonoE164])` (`db/schema.prisma:312`). Cuando el cliente
cambia de número, `migrarTelefono` (`ChatConversacionRepository.ts:201-248`) puede dejar **dos
filas** de la misma orden con teléfonos distintos, y la evidencia del cambio queda como un mensaje
de **sistema** (`sistema_telefono_anterior/nuevo`, `db/schema.prisma:350-351`, pintado por
`BurbujaSistema`). Para el lector del histórico eso es **una sola conversación**.

**Solución sin esquema (R42):** el hilo es el **grupo** `(orden_id, mensajero_id)`.

- El **listado** agrupa con `GROUP BY c.orden_id, c.mensajero_id` (§2.4).
- El **hilo** lee los mensajes de **todas** las `chat_conversacion.id` del grupo y los ordena por
  `(ocurrido_at, id)` — exactamente la misma clave con la que se ordena dentro de un solo hilo, de
  modo que el mensaje de sistema del cambio de número cae en su sitio cronológico y el «antes» y el
  «después» del número se leen seguidos.
- El desempate por `id` no es decorativo: sin él, dos mensajes con el mismo `ocurrido_at`
  procedentes de **filas distintas** podrían intercalarse de forma no determinista entre páginas
  (R20).

**Cabecera cuando hay dos teléfonos (R43):** la cabecera rotula **orden + destinatario + mensajero**
y muestra el **número vigente** —el de la fila con actividad más reciente— enmascarado (últimos 4
dígitos), con un distintivo «2 números» cuando el grupo fusiona más de uno. El número antiguo **no**
se pinta en la cabecera: su sitio es la burbuja de sistema, dentro del hilo, que es donde se explica
*cuándo* cambió.

#### 1.3.2 «El chat del mensajero del día que gestionó esa orden» — alcance real y límite (R44/R45)

- Si la orden tiene hilos de **dos mensajeros distintos**, el `GROUP BY` produce **dos filas** y eso
  es correcto: son dos conversaciones de dos personas distintas y **no se deduplican** (R44).
- **Límite medido:** `upsertParaOrden` hace `update: { mensajeroId: input.mensajeroId }`
  (`ChatConversacionRepository.ts:110-132`), así que **una reasignación reescribe el mensajero de la
  fila existente**; y `chat_mensaje` **no guarda** quién era el mensajero de cada mensaje
  (`db/schema.prisma:322-373`). Consecuencia: si el cliente conserva el número, la orden reasignada
  tiene **una sola fila**, atribuida al mensajero actual y con los mensajes de ambos.
  **Partirlo de verdad exigiría una columna nueva en `chat_mensaje` — una migración, que esta
  feature tiene prohibida (R27).** Se fija el comportamiento con un test (R45) para que sea un
  límite vigilado, no un accidente; mismo patrón que la 311 con `migrarTelefono`
  (`ChatConversacionRepository.ts:201-224`).

### 1.4 Índices que se usan, y el que NO se crea

| Consulta | Índice que la sirve |
| --- | --- |
| Página del hilo fusionado (R19, R42) | `chat_mensaje(conversacion_id, ocurrido_at)` — un scan descendente por cada `conversacion_id` del grupo (1, a veces 2), combinados por el planner |
| Reacciones de la página (R28) | `chat_mensaje_reaccion_idx` |
| Filtro y agrupación por mensajero (R33, R42) | `chat_conversacion(mensajero_id)` |
| Búsqueda libre por orden (R36-1) | `orden_busqueda_texto_trgm_idx` (GIN trgm) |
| Filtro por orden, número exacto (R35) | `orden.num_guia @unique` / `orden_tienda_id_num_remision_key` (parcial) |
| Última actividad del hilo (R14) | `chat_mensaje(conversacion_id, ocurrido_at)` vía `LATERAL … MAX()` (index-only, una fila por conversación) |

**No se crea ningún índice** (R27). La debilidad conocida —el `ORDER BY` va sobre un valor calculado
y no se puede servir con un índice— **se acepta por decisión humana** (P2/A6) y se acota por diseño:
el listado va **paginado** (R13) y **no carga mensajes** (R41), así que el trabajo por página está
limitado a `LIMIT + 1` filas de salida. Ver §2.4 y §7.

---

## 2. Backend

### 2.1 Capas (`docs/architecture.md`)

```
app/(app)/historico/conversaciones/page.tsx        ← gate de rol (notFound), Server Component
  └─ HistoricoConversacionesModule.tsx  "use client"  ← barra de filtros + listado + hilo
        └─ Server Actions (lib/actions/historico-conversaciones.ts)
              └─ HistoricoConversacionesService     ← autorización por rol + reglas
                    └─ HistoricoConversacionesRepository  ← Prisma / SQL crudo
```

Archivos nuevos:

| Archivo | Qué es |
| --- | --- |
| `lib/types/historico-conversaciones.ts` | DTOs + esquemas zod del borde (R38) |
| `lib/interfaces/repositories/IHistoricoConversacionesRepository.ts` | contrato del repo |
| `lib/interfaces/services/IHistoricoConversacionesService.ts` | contrato del service |
| `lib/repositories/HistoricoConversacionesRepository.ts` | queries |
| `lib/services/HistoricoConversacionesService.ts` | autorización + reglas |
| `lib/actions/historico-conversaciones.ts` | `"use server"`, resuelve actor |
| `lib/utils/busqueda-texto-sql.ts` | espejo SQL de `normalizarTerminoBusqueda` (§1.2) |
| `lib/utils/separador-dia-cr.ts` | «hoy» / «ayer» / «jueves 28 de agosto» (R23) |
| `app/(app)/historico/conversaciones/page.tsx` | ruta + gate |
| `app/(app)/historico/conversaciones/_components/*` | UI (módulo, listado, hilo, filtros) |

**Server Actions y no Route Handlers**: son lecturas internas consumidas por un componente propio
(`docs/architecture.md`, tabla «Server Actions vs Route Handlers»). El **único** Route Handler
implicado es el proxy de media, que ya existe y entrega un binario con cabeceras.

### 2.2 Contrato — listado de hilos (R11, R13, R41)

```ts
interface ListarHilosHistoricoInput {
  filtro?: {
    mensajero_id?: string[];        // R33 — nunca [] (lista vacía = validation_error)
    fecha_desde?: string;           // R34 — "YYYY-MM-DD"
    fecha_hasta?: string;           // R34 — inclusivo
    orden?: string;                 // R35 — num_guia o num_remision, IGUALDAD exacta
    q?: string;                     // R36 — min BUSQUEDA_MIN_CHARS, max BUSQUEDA_MAX_CHARS
  };
  cursor?: CursorHilo | null;       // R13
  limite?: number;                  // default 25, máx 50   ← «solo X conversaciones a la vez» (P8)
}

interface CursorHilo {              // R13/R15 — clave TOTAL, sin OFFSET
  ultimaActividadAt: string | null;
  ordenId: string;
  mensajeroId: string;
}

type ListarHilosHistoricoResult =
  | { status: "ok"; items: HiloHistoricoDTO[]; siguiente: CursorHilo | null }
  | { status: "unauthenticated" }
  | { status: "forbidden" }
  | { status: "validation_error"; motivo: string };

interface HiloHistoricoDTO {          // R11, R43 — CERO mensajes aquí (R41)
  ordenId: string;
  mensajeroId: string;
  numGuia: number | null;
  numRemision: string;
  destinatario: string;
  mensajeroNombre: string;
  telefonoVigenteMasked: string;      // últimos 4 dígitos del número con actividad más reciente
  telefonosCount: number;             // >1 ⇒ el hilo fusiona varios números (R43)
  ultimaActividadAt: string | null;   // ISO
  totalMensajes: number;
}
```

**R41 es estructural, no una disciplina:** `HiloHistoricoDTO` **no tiene** campo de mensajes, así
que el listado no puede traerlos ni por descuido. El identificador del hilo que viaja al cliente es
el par `(ordenId, mensajeroId)`, no una lista de `conversacion_id`: los ids de fila son un detalle
del almacenamiento y se resuelven de nuevo en el servidor al abrir el hilo.

> ⚠️ **Revocado el 2026-08-31 (pedido humano).** El teléfono ya NO viaja enmascarado: viaja
> **completo** y el DTO se llama `telefonoVigente`. Quien lee el histórico necesita el número
> entero para reconocer al cliente y para poder buscarlo en el propio campo de búsqueda, y la
> pantalla ya está acotada a los mismos roles que ven el teléfono de la orden en `/ordenes`. En
> la misma tanda, `q` pasó a buscar también contra `chat_conversacion.telefono_e164`. Lo de
> abajo queda como registro de la decisión original.

**Teléfono:** viaja **enmascarado** (últimos 4 dígitos). Su única función aquí es distinguir hilos y
señalar la fusión; esta pantalla no llama a nadie, así que el número completo no aporta y no sale.

### 2.3 Contrato — página de mensajes (R18-R21, R28, R40, R42)

```ts
interface ListarMensajesHistoricoInput {
  ordenId: string;
  mensajeroId: string;                                 // el hilo es el PAR (R42)
  cursor?: { ocurridoAt: string; id: string } | null;   // R19 — null = página MÁS RECIENTE (R21)
  limite?: number;                                     // default 30, máx 100
}

type ListarMensajesHistoricoResult =
  | { status: "ok";
      mensajes: ChatMensajeVista[];      // MISMO tipo que el chat del mensajero
      anterior: CursorMensaje | null;    // null = no hay más hacia atrás
      cabecera: HiloHistoricoDTO }
  | { status: "unauthenticated" }
  | { status: "forbidden" }
  | { status: "not_found" }
  | { status: "validation_error"; motivo: string };
```

Se **reutiliza `ChatMensajeVista`** (`lib/types/chat-whatsapp.ts:27-57`): mismo DTO, mismas burbujas,
cero divergencia. `mensajes` llega en orden cronológico **ascendente** dentro de la página, con
entrantes y salientes **entrelazados** (R40): el `ORDER BY` es por `(ocurrido_at, id)` y **nunca**
por `direccion`.

**Consulta del hilo fusionado:**

```sql
SELECT m.*
FROM chat_mensaje m
WHERE m.conversacion_id IN (
        SELECT c.id FROM chat_conversacion c
        JOIN orden o ON o.id = c.orden_id AND o.deleted_at IS NULL   -- R12
        WHERE c.orden_id = $1 AND c.mensajero_id = $2)               -- R42
  AND (m.ocurrido_at, m.id) < ($cursorAt, $cursorId)                 -- R19/R20
ORDER BY m.ocurrido_at DESC, m.id DESC
LIMIT $limite
```

El `IN` tiene 1 o 2 elementos en la práctica, y cada uno se sirve por el prefijo del índice
`(conversacion_id, ocurrido_at)`; el planner combina y ordena esas dos secuencias ya ordenadas. La
página se invierte a ascendente antes de devolverla.

**Reacciones (R28) con hilo paginado.** `agregarReacciones` (el helper que usa `listarHiloChat`,
`lib/actions/chat-whatsapp.ts:353`) agrega sobre el conjunto que recibe. Con paginación, una reacción
puede caer en otra página que su objetivo. **Solución:** el repositorio devuelve, junto a la página,
las filas `tipo = reaccion` **de todas las conversaciones del grupo** cuyo
`reaccion_a_wa_message_id` esté entre los `wa_message_id` de la página (segunda consulta acotada,
servida por `chat_mensaje_reaccion_idx`). Sin eso, una reacción se perdería o aparecería como
burbuja suelta — justo lo que R28 prohíbe.

### 2.4 Consulta del listado — forma y coste

```sql
SELECT c.orden_id, c.mensajero_id,
       o.num_guia, o.num_remision, o.destinatario,
       u.nombre, u.primer_apellido, u.segundo_apellido,
       MAX(act.ultima)                              AS ultima_actividad_at,
       SUM(act.total)::int                          AS total_mensajes,
       COUNT(DISTINCT c.telefono_e164)::int         AS telefonos_count,     -- R43
       (array_agg(c.telefono_e164 ORDER BY act.ultima DESC NULLS LAST))[1]
                                                    AS telefono_vigente     -- R43
FROM chat_conversacion c
JOIN orden   o ON o.id = c.orden_id AND o.deleted_at IS NULL      -- R12
JOIN usuario u ON u.id = c.mensajero_id
CROSS JOIN LATERAL (
  SELECT MAX(m.ocurrido_at) AS ultima, COUNT(*)::int AS total
  FROM chat_mensaje m WHERE m.conversacion_id = c.id
) act
WHERE  <filtros>                                                   -- R33..R36
GROUP BY c.orden_id, c.mensajero_id,
         o.num_guia, o.num_remision, o.destinatario,
         u.nombre, u.primer_apellido, u.segundo_apellido           -- R42
HAVING <cursor>                                                    -- R13/R15
ORDER BY ultima_actividad_at DESC NULLS LAST, c.orden_id DESC, c.mensajero_id DESC
LIMIT  $limite + 1
```

- **Agrupación (R42/R44):** `GROUP BY (orden_id, mensajero_id)`. Dos filas de la misma orden y
  mensajero con teléfonos distintos colapsan en un hilo; dos mensajeros de la misma orden **no**
  colapsan y salen como dos filas.
- **Cursor (R13/R15):** `(ultima_actividad_at, orden_id, mensajero_id)` comparado en el sentido del
  `ORDER BY`, dentro del `HAVING` (el valor de corte es agregado). Las dos claves de desempate hacen
  la paginación **total**: dos hilos con el mismo instante no se pisan. Se pide `limite + 1` para
  saber si hay siguiente **sin** un `COUNT`.
- **Filtro de fecha (R34/R39) — se correlaciona por la CLAVE DEL HILO, no por la fila:**

  ```sql
  EXISTS (
    SELECT 1
    FROM chat_conversacion c2
    JOIN chat_mensaje m2 ON m2.conversacion_id = c2.id
    WHERE c2.orden_id     = c.orden_id        -- ⚠ la clave del hilo (R42), NO c2.id = c.id
      AND c2.mensajero_id = c.mensajero_id
      AND m2.ocurrido_at >= $desde
      AND m2.ocurrido_at <  $hastaExclusivo)
  ```

  Las cotas salen de `inicioDelDiaCREnUtc` / `inicioDelDiaSiguienteCREnUtc`
  (`lib/utils/fecha-cr.ts:118`, `:129`) — **no** de `startOfDayCR`, seis horas antes, que es el
  off-by-one documentado en `fecha-cr.ts:27-29`.

  **Por qué la forma por fila (`m2.conversacion_id = c.id`) está MAL, y no debe «restaurarse» como
  simplificación.** Este `EXISTS` vive en el `WHERE`, es decir se evalúa **antes del `GROUP BY`**:
  descarta **filas**, no grupos. Con la correlación por fila, un hilo fusionado de dos números
  (§1.3.1) del que sólo **una** de sus filas tenga mensajes dentro del rango **pierde la otra fila**
  antes de agregar, y entonces `SUM(act.total)` (`totalMensajes`),
  `COUNT(DISTINCT c.telefono_e164)` (`telefonosCount`) y
  `(array_agg(c.telefono_e164 ORDER BY act.ultima DESC))[1]` (`telefono_vigente`) quedan calculados
  **sobre medio hilo** → rompe R42 y R43. Correlacionando por `(orden_id, mensajero_id)`, el
  predicado se vuelve **constante dentro del grupo**: o entran todas sus filas o no entra ninguna,
  que es exactamente lo que pide R34 («el rango **selecciona hilos**, no recorta filas»). La
  selección es del **hilo**; los agregados, del **hilo entero**.

  **No es un caso exótico:** T0 midió que el **40 %** de los grupos `(orden_id, mensajero_id)` tiene
  **más de un teléfono** (`progress/impl_321.md`, tabla de T0). Con esa proporción, la forma por
  fila no es un borde teórico: falsea los contadores de dos de cada cinco hilos en cuanto se aplica
  un rango.

  **Lo implementado ya es esta forma** —`lib/repositories/HistoricoConversacionesRepository.ts:186-193`,
  correlación por `c2.orden_id` / `c2.mensajero_id`—, con el porqué escrito en el propio comentario
  del código (`:160-173`). Este apartado se corrigió el 2026-08-28: la versión anterior del design
  escribía el `EXISTS` por fila y **el código nunca la siguió**.
- **Filtro por orden exacto (R35):** `o.num_remision = $v OR (o.num_guia IS NOT NULL AND
  o.num_guia = $vNumerico)`, con `$vNumerico` sólo cuando el valor es un entero. **Igualdad**, nunca
  `ILIKE`.
- **Coste (P8/A6):** el `LATERAL` es una lectura index-only por fila candidata; el `ORDER BY` sobre
  el agregado no se puede servir con índice, así que el plan ordena las filas que pasan los filtros.
  **La decisión humana descarta materializar ese valor** (A6). Lo que acota el coste es el propio
  alcance cerrado en P8: página de N hilos y **cero mensajes** en la respuesta.

### 2.5 Autorización (service, no repo)

`docs/architecture.md`: el repositorio no valida permisos. El service comprueba
`ROLES_HISTORICO_CONVERSACIONES.includes(actor.rol)` y devuelve `forbidden` en otro caso (R7, R10).
El repositorio **no recibe** ningún `mensajeroId` de scope de sesión —el `mensajeroId` de la entrada
es **parte de la clave del hilo**, no una restricción de seguridad—: ésa es la diferencia deliberada
con `ChatConversacionRepository.findByOrdenParaMensajero`, que sí lleva el scope en el `WHERE`
(`:141-156`) y que **no se toca** (R26).

---

## 3. Menú y ruta

### 3.1 La constante

En `lib/auth/menu-visibility.ts` (mismo módulo server-safe donde vive `ROLES_ACCESO_ANALITICA`):

```ts
export const ROLES_HISTORICO_CONVERSACIONES = ["maestro", "admin"] as const
  satisfies readonly RolValue[];
```

**Por qué una WHITELIST propia y NO derivar de `ROLES_ACCESO_TOTAL`** (`lib/auth/acceso-total.ts:5`,
que hoy contiene exactamente esos dos): la lección A5 de la 129 —no escribas dos listas gemelas—
aplica cuando divergir **en silencio** es el daño. Aquí la asimetría es la contraria: si mañana
alguien añade `adminSatelite` a «acceso total de gestión», derivar le regalaría **el histórico de
conversaciones de todos los inquilinos** sin que nadie lo decidiera. Una whitelist propia hace que
ampliar el histórico sea una edición **de este nombre**, con fecha y autor. Lo vigila la guardia de
T1.5, que asserta que la constante **no** contiene `adminSatelite`, `adminTienda`, `mensajero` ni
`apiKey` (P4: «solo admin/maestro»).

### 3.2 El ítem

```ts
{
  label: "Histórico",
  href: "/historico",                 // no navega: un ítem con children es disparador
  iconKey: "history",                 // IconKey NUEVA (R6)
  roles: ROLES_HISTORICO_CONVERSACIONES,   // REFERENCIA, no literal (R2/R8)
  children: [{ label: "Conversaciones", href: "/historico/conversaciones" }],
}
```

- **`IconKey` nueva `"history"` → `History` de lucide**, resuelta en `ICON_BY_KEY`
  (`Sidebar.tsx:147-171`). Icono propio y no reciclado, por el mismo criterio escrito para
  `shieldAlert` (158), `chartColumn` (129), `store` (167) y `gauge` (192).
- **Posición: al final, junto a «Incidentes»**, y NO en las tres primeras. Consecuencia buscada
  (R9): `primerDestino` devuelve el primer ítem visible no marcado `destinoInicial: false`
  (`menu-visibility.ts:438-442`); poniéndolo al final, **ningún rol cambia de aterrizaje** y por eso
  **no hace falta `destinoInicial: false`**. Ponerlo arriba sí lo exigiría — es el incidente que ya
  documentan «Analítica» y «Monitoreo».
- **Sin página en `/historico`**: un padre con `children` no navega (`Sidebar.tsx`), igual que
  «Entregas» y «Wallet». Sólo existe `app/(app)/historico/conversaciones/page.tsx`.

### 3.3 El gate de la ruta (R7/R8)

Patrón literal de `app/(app)/analitica/page.tsx:114-127`:

```ts
const actor = await resolveActorFromSession();
const permitidos: readonly RolValue[] = ROLES_HISTORICO_CONVERSACIONES;
if (!actor || !permitidos.includes(actor.rol)) notFound();
```

Ningún literal de rol en la página. **El ítem de menú es sólo lo que se MUESTRA; esto es la
defensa.**

### 3.4 Middleware y la guardia de la 229 — MEDIDO

La ruta vive bajo `app/(app)/`, así que la cubre el guard de sesión por defecto. **No se toca
`middleware.ts`.**

Contra lo anticipado en la ficha, `tests/unit/guards/rastreo-sin-ruta-nueva.guardia.test.ts` **no se
pone roja por una ruta nueva cualquiera**. Leída entera, sus aserciones son: (1) las tres listas del
middleware contra literales (`:49-82`) → no se tocan; (2) `/` por coincidencia exacta (`:84-91`) →
intacto; (3) ningún `page.tsx`/`route.ts` importa `rastreo-publico`/`RastreoPublico` (`:141-150`) →
no aplica; (4) ningún **segmento de carpeta** bajo `app/` empieza por `rastreo` (`:152-164`) →
`historico` no casa; (5) sin migración ni objetos de rastreo (`:185-218`) → R27 lo garantiza. Aun
así, `tasks.md` la corre explícitamente (T7.1): esto es una lectura, y el gate es quien manda.

---

## 4. El ensanche de autorización — explícito y acotado (R26/R29/R30) — P5

Hoy, un admin que no es el mensajero de la orden **no ve el hilo ni sus adjuntos**:
`findByOrdenParaMensajero` filtra por `mensajeroId` (`:141-156`) y `findMediaParaMensajero` exige
`o.mensajero_asignado_id = $mensajeroId` dentro del SQL (`ChatMensajeRepository.ts:269-311`), con
403 sin fila (`route.ts:72-77`).

**Cómo se ensancha:**

1. **Lectura del hilo:** por una vía **nueva y separada** (`HistoricoConversacionesRepository`), sin
   tocar la del mensajero. Los métodos existentes se quedan **byte a byte iguales** (R26 tiene test
   de no-regresión propio).
2. **Adjuntos:** se añade `findMediaParaLectorHistorico(mensajeId)` en `ChatMensajeRepository` —
   **la misma consulta menos la condición del mensajero**, conservando `o.deleted_at IS NULL` (R12)
   y conservando el comentario de por qué `m.id` va **sin** `::uuid` (`:283-289`: la columna es
   `text` y el cast rompe TODO adjunto con un `42883`).
3. **Quién elige la vía:** el `GET` del proxy, **después** de resolver el actor:

```ts
const media = ROLES_HISTORICO_CONVERSACIONES.includes(actor.rol)
  ? await repo.findMediaParaLectorHistorico(mensajeId)               // R29
  : await repo.findMediaParaMensajero(mensajeId, actor.usuarioId);   // R26, intacto
```

Un rol que no es ninguna de las dos cosas sigue cayendo en la rama del mensajero y recibiendo `403`
(R30). **La ruta no cambia de URL, ni de cabeceras, ni de política de caché** (`CACHE_CONTROL_MEDIA`
sigue siendo privada: el binario es PII del cliente).

---

## 5. Frontend

### 5.1 Composición

```
page.tsx (server, gate)
  └─ HistoricoConversacionesModule.tsx  ("use client")
       ├─ HistoricoFiltrosBar.tsx        → BuscadorFiltros + FilterComponent
       ├─ HilosLista.tsx                 → filas + scroll infinito (R13, R41)
       └─ HistoricoHilo.tsx              → burbujas + separador de día + scroll inverso (R18-R23)
```

`page.tsx` **no** pre-carga datos del histórico: el módulo cliente los pide por Server Action + SWR
(patrón dominante del repo: `OrdenesModule`, `PanelesOperativos`). Lo único que la página pre-carga
es el **catálogo de mensajeros** del filtro, con `obtenerCatalogoFiltrosOrdenes`
(`lib/actions/filtros-ordenes.ts:37-43`), que ya devuelve `mensajeros: {id, nombre, zonaId}` y ya
está autorizado por su service. **No** se usa `listarMensajerosParaAsignacion`
(`lib/actions/ordenes-guia.ts:182-199`): está acotado a la zona GAM (`findCentralZonaId`) y el
histórico quiere **todos** los mensajeros.

**Carga perezosa (R41):** `HistoricoHilo` sólo monta —y sólo dispara su clave de SWR— cuando hay un
hilo seleccionado. Sin selección, la clave es `null` y no se pide nada, exactamente como
`ChatConversacion.tsx:242-246` hace con `ordenId === null`.

### 5.2 Reutilización de las burbujas (R16/R28/R31/R40)

Se importan **tal cual** desde `app/(app)/mis-asignaciones/_components/chat/`:
`BurbujaContenido`, `BurbujaSistema`, `MediaAdjunto`, `Reacciones`, `TarjetaContacto`,
`TextoConEnlaces` y los helpers de `chat-format.ts` (`horaCorta`, `iniciales`, `guiaVisible`,
`textoAccesible`). Consumen `ChatMensajeVista`, que es justo lo que devuelve §2.3. Al reutilizar
`BurbujaSistema`, el cambio de número del hilo fusionado se lee dentro del hilo sin escribir nada
nuevo (R43).

**Dos trampas de la ficha ya están resueltas en el árbol real, y se comprueba que siguen así:**

- **(d) «del cliente»**: la 316 sacó los textos a `chat-format.ts:105-130` y los indexa **por
  dirección** (`textoAccesible(tipo, direccion)`); `MediaAdjunto` recibe `direccion` como prop
  (`MediaAdjunto.tsx:41-47`). En una vista con las dos direcciones **no quedan falsos**.
- **(e) media no almacenada**: `MediaAdjunto` ya distingue el 410 del proxy y pinta «Este archivo ya
  no está disponible.» dentro de la burbuja, con reintento (`MediaAdjunto.tsx:22-31`, `:166-176`,
  `:212-226`). El histórico **hereda** ese comportamiento (R31), que es además lo que P9 acepta como
  consecuencia de no almacenar binario.

**Alternativa descartada (A1) — mover las burbujas a `components/shared/chat/`.** Es lo que sugiere
`docs/architecture.md`. **Coste medido**: 13 archivos de test importan por esa ruta
(`tests/components/ChatBurbujaMedia|NotaVoz|ComposerAdjunto|TextoConEnlaces|TarjetaContacto|
Reacciones|ConversacionTono|BurbujaSistema|ConversacionPlantillaDiaria|BurbujaContenido|
NoLeidos.test.tsx`, `tests/unit/components/chat-plantilla-nombre.test.ts`) más `ChatConversacion.tsx`.
Mover ahora mete 14 archivos ajenos en el diff de una feature de lectura. Se importa cruzado
(`_components` sólo significa «no es una ruta») y la promoción queda como **deuda declarada**.

**Alternativa descartada (A3) — renderizador propio.** Duplicaría el `switch` exhaustivo de
`BurbujaContenido.tsx:40-115`, que existe para que un tipo nuevo del enum sea **error de
compilación**. Dos renderizadores = el segundo se queda atrás en silencio.

### 5.3 Barra de filtros (R32-R37, R39)

Patrón literal de `/ordenes`: función **pura** `construirFiltrosHistorico(catálogo, opts)` en
`_components/historico-filtros-def.ts` → `FilterDef[]`, y traducción
`seleccionAFiltroHistorico(sel)` en `_components/seleccion-a-filtro.ts` (la traducción es de la
**superficie**, no del componente genérico — R58 de la 144).

| Clave | `kind` | Notas |
| --- | --- | --- |
| `q` | `text` | PRIMERO. `minChars: BUSQUEDA_MIN_CHARS` (`lib/types/orden.ts:96`) — la MISMA constante que valida el borde. `placeholder` = «Destinatario, guía, remisión o mensajero». Viaja **escalar**, nunca lista. |
| `mensajero_id` | `multi` | opciones del catálogo. **Sin `dependsOn`**: aquí no hay filtro de zona y sugerir una cadena inexistente confunde. |
| `fecha` | `dateRange` | reutiliza `ATAJOS_CREACION` y `ultimosNDiasCalendarioCR` de `ordenes-filtros-def.ts` (importados, **no** reescritos). Clave posicional `[atajo, desde, hasta]`. |
| `orden` | `text` | **número exacto** (P7/R35). `minChars: 1`. La igualdad la impone el servidor; el control sólo transporta el valor. |

Reglas duras heredadas de `seleccion-a-filter.ts:23-32`: una lista vacía **se omite**, nunca se manda
`[]`; atajo y rango son excluyentes; las fechas viajan `YYYY-MM-DD`, sin hora.

**R39 — la diferencia entre listado e hilo se ve.** Cuando hay rango aplicado y se abre un hilo, la
cabecera del hilo pinta un aviso: «Filtro de fecha aplicado a la lista; aquí se muestra la
conversación completa». Es la única forma de que el lector no crea que está viendo un hilo recortado
—y es lo que P2 pidió: la diferencia se resuelve en la **presentación**, sin dato nuevo en la base.

### 5.4 Scroll infinito (R18/R21/R22/R41)

- **Listado:** `IntersectionObserver` sobre un centinela al final; al entrar en vista se pide la
  página siguiente con el cursor devuelto y se **añade** al final, sin reordenar.
- **Hilo:** el contenedor arranca anclado abajo (mismo gesto que `ChatConversacion.tsx:310-312`) y
  el centinela va **arriba**. **R22 (no saltar)**: antes de insertar la página anterior se guarda
  `scrollHeight`; después, `el.scrollTop += el.scrollHeight - alturaPrevia`. Sin esa corrección,
  insertar 30 mensajes arriba empuja la vista y el lector pierde el sitio — defecto clásico del
  scroll inverso, y por eso tiene requisito y test propios.
- **Sin `useEffect` que haga `setState` a partir de lecturas del navegador**: el lint del repo lo
  prohíbe. El estado de páginas vive en el reducer del módulo; la medición del scroll ocurre dentro
  del handler del observer, no en un efecto de lectura.

### 5.5 Separador de día (R23) — P6

`lib/utils/separador-dia-cr.ts`:

```ts
const FMT = new Intl.DateTimeFormat("es-CR", {
  weekday: "long", day: "numeric", month: "long",   // ⚠ SIN `year`: nunca lleva año (P6)
  timeZone: "America/Costa_Rica",
});

export function separadorDia(iso: string, ahora: Date): string {
  const dia = fechaCalendarioCR(new Date(iso));      // "YYYY-MM-DD" en CR
  if (dia === fechaCalendarioCR(ahora))   return "hoy";
  if (dia === ayerCalendarioCR(ahora))    return "ayer";
  return enMinusculaInicial(FMT.format(new Date(iso)));
}
```

- **`es-CR` y `America/Costa_Rica`**, no la zona del navegador ni `es-EC`. Convención del repo,
  confirmada en `HiloNotasOrden.tsx:80-84`, `HistorialOrdenTimeline.tsx:58`,
  `RecolectadasHoyLista.tsx:58`, `ranking-historico-labels.ts:43`, `TableroDiaCabecera.tsx:43-49`.
  Formatear en la zona del dispositivo correría el separador un día para quien mire desde otro huso.
- **«hoy» / «ayer» (P6)** se deciden comparando **fechas calendario CR**, no restando 24 h a un
  instante: `fechaCalendarioCR` (`lib/utils/fecha-cr.ts:47`) existe justamente porque
  `toISOString().slice(0,10)` da el día siguiente después de las 18:00 CR (`fecha-cr.ts:41-45`).
  Ahí está el off-by-one, y por eso tiene caso de frontera propio en el test.
- **Nunca año**, ni para días de otro año (P6). El formateador no declara `year`, así que no hay
  forma de que se cuele.
- **Minúscula inicial**: `es-CR` ya la emite así, pero el helper la **fuerza** para no depender del
  ICU de la plataforma.

### 5.6 Solo lectura (R24/R25)

- El módulo **no importa** `lib/actions/chat-whatsapp` salvo los **tipos** (`import type`), ni monta
  `<form>`, `<textarea>`, botón de enviar, menú de adjuntar ni chips de plantilla. Se comprueba con
  un test de comportamiento (no con un grep de comentarios): renderizado el hilo,
  `queryByRole("textbox")`, `queryByRole("button", { name: /enviar/i })` y
  `queryByRole("group", { name: /plantillas/i })` son `null`.
- **R25 (sin escrituras):** el service recibe un cliente Prisma **acotado por tipo** a `$queryRaw` +
  lecturas; el test del service usa un doble que **lanza** ante cualquier
  `update`/`create`/`upsert`/`delete`/`$executeRaw`, de modo que una escritura futura rompe el test
  en vez de pasar desapercibida.

---

## 6. Alternativas descartadas

| # | Alternativa | Por qué se descarta |
| --- | --- | --- |
| **A1** | Mover las burbujas a `components/shared/chat/` en esta feature | 14 archivos ajenos en el diff (13 tests + `ChatConversacion.tsx`), medido. Mezcla refactor con funcionalidad. Deuda declarada para su PR. |
| **A2** | Añadir `omitirScope: boolean` a `findMediaParaMensajero` | Un booleano que apaga la autorización dentro de la misma función es la puerta que se olvida abierta, y el nombre del método dejaría de decir la verdad. Se usa un método nuevo cuyo nombre declara su alcance. |
| **A3** | Renderizador de burbujas propio para el histórico | Duplicaría el `switch` exhaustivo de `BurbujaContenido`, que existe para que un tipo nuevo del enum sea error de compilación. |
| **A4** | Paginar con `skip`/`OFFSET` | Con inserciones concurrentes, `OFFSET` **repite y pierde** filas, y su coste crece con la profundidad. El índice `[conversacion_id, ocurrido_at]` está puesto para un cursor. |
| **A5** | Derivar `ROLES_HISTORICO_CONVERSACIONES` de `ROLES_ACCESO_TOTAL` | Hoy coinciden, pero la divergencia peligrosa va al revés: ampliar «acceso total» regalaría el histórico de todos los inquilinos sin decisión. Whitelist propia + guardia. |
| **A6** | Materializar `ultima_actividad_at` en `chat_conversacion` (o crear un índice) para ordenar el listado | **DESCARTADA POR DECISIÓN HUMANA (P2, 2026-08-28): «sin agregar nada en la db».** No es un aplazamiento. Además obligaría a escribir en el camino del **webhook** de ingesta, que es lo último que se toca por una pantalla de lectura. El coste se acota con el alcance de P8 (listado paginado + cero mensajes en la respuesta). |
| **A7** | Colgar el histórico de `/ordenes` como pestaña | El pedido es un ítem propio con subítem, y la unidad del histórico es el hilo (orden, mensajero), no la orden. |
| **A8** | Buscar dentro del **cuerpo** de los mensajes | No está pedido y `chat_mensaje.cuerpo` no tiene índice de texto: Seq Scan sobre la tabla que más crece. Fuera de alcance. |
| **A9** | Agrupar el hilo por `(orden, teléfono)` —la clave física de la tabla— | Es la primera versión de este design y **la puerta humana la cerró en contra (P1)**: partiría en dos la conversación de un cliente que cambió de número, que para el lector es una sola. |
| **A10** | Añadir `mensajero_id` a `chat_mensaje` para partir el hilo por «mensajero del día» de verdad | Es una **migración**, prohibida en esta feature (R27). Se declara como LIMITACIÓN CONOCIDA fijada por test (R45) y se reabre con el humano si hace falta. |

---

## 7. Riesgos

1. **Orden del listado sobre un valor calculado.** No se puede servir con índice y A6 está descartada
   por decisión humana. Mitigación aceptada: página de N hilos (R13) y **cero mensajes** en la
   respuesta (R41). `T0` mide el volumen para saber **con qué números se vive**, no para decidir si
   se migra.
2. **Fusión de hilos.** Un `GROUP BY` mal desempatado rompe la paginación. Cubierto por R15 (dos
   hilos con el mismo instante) y R42 (fusión sin duplicar), con tests de frontera.
3. **Atribución tras reasignación.** Límite real del esquema, declarado y **fijado por test** (R45).
4. **Reacciones a caballo entre páginas.** Resuelto por diseño en §2.3, con test propio (R28).
5. **El scroll que salta (R22).** Defecto por defecto del scroll inverso; requisito y test propios.
6. **PII en la fila.** Teléfono enmascarado (§2.2); `busqueda_texto` sigue omitida globalmente por
   `PRISMA_OMIT` (`lib/db/prisma-client.ts:45`) y **no** se selecciona en ninguna consulta nueva.
7. **Esta feature EXIGE el gate completo. `./init.sh --rapido` se niega, por diseño.**
   **[CORREGIDO 2026-08-28]** La versión anterior de este punto afirmaba lo contrario («el diff no
   toca `lib/types/**` … el rápido no se niega»), y era **falso desde que se escribió**: §2.1 y
   T2.1 colocan el DTO en `lib/types/historico-conversaciones.ts` —que es lo **correcto** según
   `docs/conventions.md`— y `init.sh:134` lista `^lib/types/` dentro de `RUTAS_SENSIBLES`, junto a
   `db/migrations/`, `db/schema.prisma`, `init.sh`, `tests/fixtures/sin-comentarios.ts` y la
   configuración de build. Tocar cualquiera de esas rutas manda al **gate completo**, y es un
   `fail`, no un aviso (regla 5 de `CLAUDE.md`, `exigir_completo_si_toca_lo_sensible`,
   `init.sh:137-159`).

   **Por qué está bien que sea así:** un DTO en `lib/types/` es **cimiento** —cambia la forma de
   todo lo que lo importa, y el radio real del cambio no es «quién lo edita» sino «quién compila
   contra él»—, así que la selección por diff de `--changed` no basta para cubrirlo. Que el rápido
   se niegue **no es un defecto del código, ni una excepción concedida, ni señal de que el alcance
   creció**: es la clasificación funcionando sobre un diseño correcto. La ausencia de migración
   (R27) **no** exime: `lib/types/` es sensible por sí solo.

   **Consecuencia operativa:** el PR se abre con `./init.sh` **completo** en verde (con el baseline
   de `dev` medido en la misma sesión), no con `--rapido`. Es lo que hizo el implementer.
