# Feature 318 — Diseño técnico

> Cubre `R1..R38` de `requirements.md`. Todo lo que se afirma aquí sobre el código existente está
> **confirmado en el archivo real** (regla 7 de `CLAUDE.md`: el grafo dice dónde mirar, el archivo
> dice qué hay). Lo no confirmado va como pregunta abierta en `requirements.md`, no como supuesto.

---

## 1. Modelo de datos — **NO cambia** (R27)

### 1.1 Lo que ya existe y basta

```
ChatConversacion (chat_conversacion)          db/schema.prisma:295-316
  id, telefono_e164, orden_id, mensajero_id,
  ultimo_entrante_at, mensajero_leido_at, created_at, updated_at
  @@unique([ordenId, telefonoE164])    ← una orden puede tener VARIOS hilos
  @@index([mensajeroId])               ← sirve al filtro por mensajero (R33)
  @@index([telefonoE164])

ChatMensaje (chat_mensaje)                    db/schema.prisma:322-373
  id, conversacion_id, direccion, tipo, cuerpo, media_*, reaccion_*,
  contactos_json, sistema_*, ocurrido_at, created_at
  @@index([conversacionId, ocurridoAt])   ← EL índice de esta feature (R19)
  @@index([conversacionId, reaccionAWaMessageId], map: "chat_mensaje_reaccion_idx")

Orden (orden)                                 db/schema.prisma:563-762
  destinatario, num_guia (Int? @unique), num_remision (String), mensajero_asignado_id,
  deleted_at, busqueda_texto (GENERATED, GIN trgm "orden_busqueda_texto_trgm_idx")
```

**RLS.** `chat_conversacion` y `chat_mensaje` tienen RLS habilitada **sin policies** (sólo service
role): la autorización de negocio vive en el service, no en la base
(`db/schema.prisma:293-294`, `:321`). Esta feature **no crea tablas**, así que no aplica el
anti-patrón «tabla nueva sin RLS» de `docs/architecture.md`, y **no relaja** ninguna policy: el
ensanche de §4 es una decisión de servicio, escrita y con test propio.

### 1.2 Lo que la búsqueda libre NO cubre y hay que resolver

`orden.busqueda_texto` concatena guía, remisión, teléfono (con y sin separadores), destinatario y
producto (`db/schema.prisma:638-654`). **No incluye el nombre del mensajero.** El pedido sí lo
exige (R36), así que el criterio de búsqueda es un `OR` de dos mitades:

1. `orden.busqueda_texto ILIKE %término%` (una o dos formas del término, ver
   `terminoDeBusqueda` en `lib/utils/filtros-listado-ordenes.ts:93-99`) — sirve destinatario,
   `num_guia`, `num_remision`;
2. el nombre completo del mensajero (`usuario.nombre || primer_apellido || segundo_apellido`)
   **normalizado con la misma expresión** que la columna generada.

Para (2) se añade un helper SQL puro `sqlNormalizarTextoBusqueda(expr)` en
`lib/utils/busqueda-texto-sql.ts`, **espejo** de `normalizarTerminoBusqueda`
(`lib/utils/busqueda-orden.ts:76-81`). Es el mismo patrón —una sola copia de la expresión, con test
de paridad— que ya usa `sqlNormalizarTelefonoCr` (`lib/utils/telefono-cr-sql.ts`, consumido en
`ChatConversacionRepository.ts:89`). Sin índice funcional: `usuario` es una tabla del personal
interno (cientos de filas), no la tabla caliente. **Esto es una decisión medible**: si `usuario`
creciera a decenas de miles, el índice se abre en su PR (una migración manda el gate al completo).

### 1.3 Consecuencia del `@@unique([ordenId, telefonoE164])`

Una orden puede tener **más de un hilo**. El listado es de **conversaciones**, no de órdenes
(P1 de `requirements.md`). Cada fila rotula su orden, así que «agrupado por orden» se cumple
visualmente sin fundir dos interlocutores en una cronología.

### 1.4 Índices que se usan, y el que NO se crea

| Consulta | Índice que la sirve |
| --- | --- |
| Página del hilo (R19) | `chat_mensaje(conversacion_id, ocurrido_at)` — scan **descendente** desde el cursor |
| Reacciones del hilo (R28) | `chat_mensaje_reaccion_idx` |
| Filtro por mensajero (R33) | `chat_conversacion(mensajero_id)` |
| Búsqueda libre por orden (R36-1) | `orden_busqueda_texto_trgm_idx` (GIN trgm) |
| Filtro por orden (R35) | `orden.num_guia @unique` / `orden(tienda_id, num_remision)` parcial |
| Última actividad del hilo (R14) | `chat_mensaje(conversacion_id, ocurrido_at)` vía `LATERAL … MAX()` (una fila por hilo, index-only) |

**No se crea ningún índice** (R27). El punto débil declarado es el ORDEN del listado: el
`MAX(ocurrido_at)` se calcula por conversación **candidata** y luego se ordena, así que el coste
crece con el número de conversaciones que pasan los filtros. Ver §2.4 y P8.

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
| `lib/utils/separador-dia-cr.ts` | formato «jueves 28 de agosto» (R23) |
| `app/(app)/historico/conversaciones/page.tsx` | ruta + gate |
| `app/(app)/historico/conversaciones/_components/*` | UI (módulo, listado, hilo, filtros) |

**Server Actions y no Route Handlers**: son lecturas internas del propio proyecto, consumidas por un
componente propio (`docs/architecture.md`, tabla «Server Actions vs Route Handlers»). El **único**
Route Handler implicado es el proxy de media, que ya existe y entrega un binario con cabeceras.

### 2.2 Contrato — listado de conversaciones

```ts
// Entrada (validada con zod, R38)
interface ListarConversacionesHistoricoInput {
  filtro?: {
    mensajero_id?: string[];        // R33 — nunca [] (lista vacía = validation_error)
    fecha_desde?: string;           // R34 — "YYYY-MM-DD"
    fecha_hasta?: string;           // R34 — inclusivo
    orden?: string;                 // R35 — num_guia o num_remision, exacto
    q?: string;                     // R36 — min BUSQUEDA_MIN_CHARS, max BUSQUEDA_MAX_CHARS
  };
  cursor?: { ultimaActividadAt: string | null; id: string } | null;  // R13
  limite?: number;                  // default 25, máx 50
}

type ListarConversacionesHistoricoResult =
  | { status: "ok"; items: ConversacionHistoricoDTO[]; siguiente: CursorConversacion | null }
  | { status: "unauthenticated" }
  | { status: "forbidden" }          // rol fuera de ROLES_HISTORICO_CONVERSACIONES
  | { status: "validation_error"; motivo: string };

interface ConversacionHistoricoDTO {   // R11
  conversacionId: string;
  ordenId: string;
  numGuia: number | null;
  numRemision: string;
  destinatario: string;
  telefonoE164: string;              // distingue dos hilos de la MISMA orden (§1.3)
  mensajeroNombre: string;
  ultimaActividadAt: string | null;   // ISO
  totalMensajes: number;
}
```

**`telefono_e164` viaja al cliente**: es PII y ya viaja hoy en el chat del mensajero
(`ChatConversacionDTO`). Se muestra **enmascarado** en la fila (últimos 4 dígitos) porque su única
función aquí es distinguir dos hilos de la misma orden; el número completo no aporta nada a la
lectura y esta pantalla no llama a nadie.

### 2.3 Contrato — página de mensajes

```ts
interface ListarMensajesHistoricoInput {
  conversacionId: string;
  cursor?: { ocurridoAt: string; id: string } | null;  // R19 — null = la página MÁS RECIENTE
  limite?: number;                                     // default 30, máx 100
}

type ListarMensajesHistoricoResult =
  | { status: "ok";
      mensajes: ChatMensajeVista[];      // MISMO tipo que el chat del mensajero
      anterior: CursorMensaje | null;    // null = no hay más hacia atrás
      cabecera: ConversacionHistoricoDTO }
  | { status: "unauthenticated" }
  | { status: "forbidden" }
  | { status: "not_found" }
  | { status: "validation_error"; motivo: string };
```

Se **reutiliza `ChatMensajeVista`** (`lib/types/chat-whatsapp.ts:27-57`) tal cual: mismo DTO, mismas
burbujas, cero divergencia. `mensajes` llega en orden cronológico ascendente dentro de la página
(aunque la página se recorte desde el final), igual que `listarHilo`.

**Reacciones (R28):** se aplica `agregarReacciones` (el mismo helper que usa
`listarHiloChat`, `lib/actions/chat-whatsapp.ts:353`). ⚠️ **Coste declarado**: ese helper agrega
sobre el conjunto que recibe. Con el hilo paginado, una reacción puede caer en una página y su
mensaje objetivo en otra. **Solución:** el repositorio devuelve, junto a la página, **todas** las
filas `tipo = reaccion` de esa conversación cuyo `reaccion_a_wa_message_id` esté entre los
`wa_message_id` de la página (una segunda consulta acotada, servida por
`chat_mensaje_reaccion_idx`). Sin eso, una reacción se perdería o aparecería como burbuja suelta —
exactamente lo que R28 prohíbe.

### 2.4 Consulta del listado — forma y coste

```sql
SELECT c.id, c.orden_id, c.telefono_e164, c.mensajero_id,
       o.num_guia, o.num_remision, o.destinatario,
       u.nombre, u.primer_apellido, u.segundo_apellido,
       act.ultima_actividad_at, act.total
FROM chat_conversacion c
JOIN orden   o ON o.id = c.orden_id AND o.deleted_at IS NULL      -- R12
JOIN usuario u ON u.id = c.mensajero_id
CROSS JOIN LATERAL (
  SELECT MAX(m.ocurrido_at) AS ultima_actividad_at, COUNT(*)::int AS total
  FROM chat_mensaje m WHERE m.conversacion_id = c.id
) act
WHERE  <filtros>                                                   -- R33..R36
  AND  <cursor>                                                    -- R13/R15
ORDER BY act.ultima_actividad_at DESC NULLS LAST, c.id DESC
LIMIT  $limite + 1
```

- **Cursor (R13/R15):** `(ultima_actividad_at, id) < (cursor.act, cursor.id)` en el sentido del
  `ORDER BY`. El `id` como segunda clave hace la paginación **total** (dos hilos con el mismo
  instante no se pisan). Se pide `limite + 1` para saber si hay siguiente sin un `COUNT`.
- **Filtro de fecha (R34):** `EXISTS (SELECT 1 FROM chat_mensaje m2 WHERE m2.conversacion_id = c.id
  AND m2.ocurrido_at >= $desde AND m2.ocurrido_at < $hastaExclusivo)`. Las cotas salen de
  `inicioDelDiaCREnUtc` / `inicioDelDiaSiguienteCREnUtc` (`lib/utils/fecha-cr.ts:118`, `:129`) —
  **no** de `startOfDayCR`, que es seis horas antes y es el off-by-one documentado en
  `fecha-cr.ts:27-29`.
- **Coste (P8, no medido):** el `LATERAL` es una lectura index-only por conversación candidata; el
  `ORDER BY` sobre su resultado impide usar un índice para ordenar, así que el plan ordena N filas
  (N = conversaciones que pasan los filtros). Con filtros puestos, N es pequeño. Sin filtros, N = el
  total de hilos. **Se mide en `T0` antes de escribir código.** Umbral y salida en P8.

### 2.5 Autorización (service, no repo)

`docs/architecture.md`: el repositorio no valida permisos. El service comprueba
`ROLES_HISTORICO_CONVERSACIONES.includes(actor.rol)` y devuelve `forbidden` en otro caso (R7, R10).
El repositorio **no recibe** ningún `mensajeroId` de scope: es la diferencia deliberada con
`ChatConversacionRepository.findByOrdenParaMensajero`, que sí lo lleva en el `WHERE`
(`ChatConversacionRepository.ts:141-156`) y que **no se toca** (R26).

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
T2.4, que asserta que la constante **no** contiene `adminSatelite`, `adminTienda`, `mensajero` ni
`apiKey`.

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
  `shieldAlert` (158), `chartColumn` (129), `store` (167) y `gauge` (192): compartir icono invita a
  leer el histórico como sección de otro módulo.
- **Posición: al final, junto a «Incidentes»**, y NO en las tres primeras. Consecuencia buscada
  (R9): `primerDestino` devuelve el primer ítem visible no marcado `destinoInicial: false`
  (`menu-visibility.ts:438-442`); poniéndolo al final, **ningún rol cambia de aterrizaje** y por eso
  **no hace falta `destinoInicial: false`**. Ponerlo arriba sí lo exigiría — es el incidente que ya
  documentan «Analítica» y «Monitoreo».
- **Sin página en `/historico`**: un padre con `children` no navega (`Sidebar.tsx`), igual que
  «Entregas» y «Wallet». Sólo existe `app/(app)/historico/conversaciones/page.tsx`.

### 3.3 El gate de la ruta (R7/R8)

Copia literal del patrón de `app/(app)/analitica/page.tsx:114-127`:

```ts
const actor = await resolveActorFromSession();
const permitidos: readonly RolValue[] = ROLES_HISTORICO_CONVERSACIONES;
if (!actor || !permitidos.includes(actor.rol)) notFound();
```

Ningún literal de rol en la página. **El ítem de menú es sólo lo que se MUESTRA; esto es la
defensa.**

### 3.4 Middleware y la guardia de la 229 — MEDIDO

La ruta `/historico/conversaciones` vive bajo `app/(app)/`, así que la cubre el guard de sesión por
defecto. **No se toca `middleware.ts`.**

Contra lo anticipado en la ficha, la guardia `tests/unit/guards/rastreo-sin-ruta-nueva.guardia.test.ts`
**no se pone roja por una ruta nueva cualquiera**. Leída entera, sus aserciones son:

1. las tres listas del middleware, comparadas posicionalmente contra literales (`:49-82`) → **no se
   tocan**;
2. `/` se resuelve por coincidencia exacta (`:84-91`) → intacto;
3. ningún `page.tsx`/`route.ts` importa `rastreo-publico`/`RastreoPublico` (`:141-150`) → no
   aplica;
4. **ningún segmento de carpeta bajo `app/` empieza por `rastreo`** (`:152-164`) → `historico` no
   casa;
5. sin migración ni objetos de rastreo en el esquema (`:185-218`) → R27 lo garantiza.

Aun así, `tasks.md` la corre **explícitamente** y exige verla verde (T7.1): esta afirmación es una
lectura, y el gate es quien manda.

---

## 4. El ensanche de autorización — explícito y acotado (R29/R30/R26)

Hoy, un admin que no es el mensajero de la orden **no ve el hilo ni sus adjuntos**:

- `ChatConversacionRepository.findByOrdenParaMensajero` filtra por `mensajeroId`
  (`:141-156`);
- `ChatMensajeRepository.findMediaParaMensajero` exige `o.mensajero_asignado_id = $mensajeroId`
  dentro del propio SQL (`:269-311`), y el proxy responde 403 sin fila
  (`app/api/chat/media/[mensajeId]/route.ts:72-77`).

**Cómo se ensancha:**

1. **Lectura del hilo:** por una vía **nueva y separada** (`HistoricoConversacionesRepository`), no
   tocando la del mensajero. Los métodos existentes se quedan **byte a byte iguales** (R26 tiene su
   propio test de no-regresión).
2. **Adjuntos:** se añade `findMediaParaLectorHistorico(mensajeId)` en `ChatMensajeRepository` —
   **misma consulta menos la condición del mensajero**, conservando `o.deleted_at IS NULL` (R12) y
   conservando el comentario de por qué `m.id` va **sin** `::uuid` (`:283-289`: la columna es `text`
   y el cast rompe TODO adjunto con un `42883`).
3. **Quién elige la vía:** el `GET` del proxy, **después** de resolver el actor:

```ts
const media = ROLES_HISTORICO_CONVERSACIONES.includes(actor.rol)
  ? await repo.findMediaParaLectorHistorico(mensajeId)     // R29
  : await repo.findMediaParaMensajero(mensajeId, actor.usuarioId);  // R26, intacto
```

Un rol que no es ninguna de las dos cosas sigue cayendo en la rama del mensajero y recibiendo `403`
(R30). **La ruta no cambia de URL, ni de cabeceras, ni de política de caché** (`CACHE_CONTROL_MEDIA`
sigue siendo privada: el binario es PII del cliente).

**Alternativa descartada (A2):** relajar `findMediaParaMensajero` añadiéndole un parámetro
`omitirScope: boolean`. Descartada porque un booleano que apaga la autorización dentro de la MISMA
función es exactamente la clase de puerta que se deja abierta por descuido en la siguiente llamada,
y porque el nombre del método dejaría de decir la verdad. Dos métodos con dos nombres que declaran
su alcance son auditables de un vistazo.

---

## 5. Frontend

### 5.1 Composición

```
page.tsx (server, gate)
  └─ HistoricoConversacionesModule.tsx  ("use client")
       ├─ HistoricoFiltrosBar.tsx        → BuscadorFiltros + FilterComponent
       ├─ ConversacionesLista.tsx        → filas + scroll infinito (R13)
       └─ HistoricoHilo.tsx              → burbujas + separador de día + scroll inverso (R18-R23)
```

`page.tsx` **no** pre-carga datos del histórico: el módulo cliente los pide por Server Action + SWR,
que es el patrón dominante del repo (`OrdenesModule`, `PanelesOperativos`). Lo único que la página
pre-carga es el **catálogo de mensajeros** para el filtro, con
`obtenerCatalogoFiltrosOrdenes` (`lib/actions/filtros-ordenes.ts:37-43`), que ya devuelve
`mensajeros: {id, nombre, zonaId}` y ya está autorizado por el service. **No** se usa
`listarMensajerosParaAsignacion` (`lib/actions/ordenes-guia.ts:182-199`): ése está acotado a la
zona GAM (`findCentralZonaId`) y el histórico quiere **todos** los mensajeros.

### 5.2 Reutilización de las burbujas (R16/R28/R31)

Se importan **tal cual** desde `app/(app)/mis-asignaciones/_components/chat/`:
`BurbujaContenido`, `BurbujaSistema`, `MediaAdjunto`, `Reacciones`, `TarjetaContacto`,
`TextoConEnlaces` y los helpers de `chat-format.ts` (`horaCorta`, `iniciales`, `guiaVisible`,
`textoAccesible`). Consumen `ChatMensajeVista`, que es justo lo que devuelve el contrato de §2.3.

**Dos trampas de la ficha ya están resueltas en el árbol real, y se comprueba que siguen así:**

- **(d) «del cliente»**: la 316 sacó los textos a `chat-format.ts:105-130` y los indexa **por
  dirección** (`textoAccesible(tipo, direccion)`), y `MediaAdjunto` recibe `direccion` como prop
  (`MediaAdjunto.tsx:41-47`). En una vista que muestra las dos direcciones **no quedan falsos**.
- **(e) media no almacenada**: `MediaAdjunto` ya distingue el 410 del proxy y pinta
  «Este archivo ya no está disponible.» dentro de la burbuja, con reintento
  (`MediaAdjunto.tsx:22-31`, `:166-176`, `:212-226`). El histórico **hereda** ese comportamiento sin
  escribir nada nuevo (R31).

**Alternativa descartada (A1) — mover las burbujas a `components/shared/chat/`.** Es lo que sugiere
`docs/architecture.md` («se promueve a shared cuando DOS features lo necesitan»). **Coste medido**:
13 archivos de test importan por esa ruta (`tests/components/ChatBurbujaMedia|NotaVoz|ComposerAdjunto|
TextoConEnlaces|TarjetaContacto|Reacciones|ConversacionTono|BurbujaSistema|ConversacionPlantillaDiaria|
BurbujaContenido|NoLeidos.test.tsx`, `tests/unit/components/chat-plantilla-nombre.test.ts`) más
`ChatConversacion.tsx`. Mover ahora mete 14 archivos ajenos en el diff de una feature de lectura y
mezcla un refactor con una funcionalidad. **Se importa cruzado** (`_components` sólo significa «no es
una ruta»; es importable) y la promoción se declara **deuda explícita** para su propio PR.

**Alternativa descartada (A3) — escribir un renderizador de burbujas propio para el histórico.**
Descartada de plano: duplicaría el `switch` exhaustivo por tipo de `BurbujaContenido.tsx:40-115`,
que existe precisamente para que un tipo nuevo del enum sea un **error de compilación** y no otra
burbuja vacía. Dos renderizadores = el segundo se queda atrás en silencio.

### 5.3 Barra de filtros (R32-R37)

Patrón literal de `/ordenes`: una función **pura** `construirFiltrosHistorico(catálogo, opts)` en
`_components/historico-filtros-def.ts` que devuelve `FilterDef[]`, y una traducción
`seleccionAFiltroHistorico(sel)` en `_components/seleccion-a-filtro.ts` (la traducción es de la
**superficie**, no del componente genérico — R58 de la 144).

| Clave | `kind` | Notas |
| --- | --- | --- |
| `q` | `text` | PRIMERO en la barra. `minChars: BUSQUEDA_MIN_CHARS` (`lib/types/orden.ts:96`) — la MISMA constante que valida el borde, para que control y servidor no se separen. `placeholder` = «Destinatario, guía, remisión o mensajero» (el placeholder ES la documentación del campo). Viaja **escalar**, nunca lista. |
| `mensajero_id` | `multi` | opciones del catálogo. **Sin `dependsOn: "zona_id"`**: aquí no hay filtro de zona, y encadenar a un padre no declarado dejaría el control ofreciendo todo (el motor lo permite) pero sugeriría una cadena que no existe. |
| `fecha` | `dateRange` | reutiliza `ATAJOS_CREACION` y `ultimosNDiasCalendarioCR` de `ordenes-filtros-def.ts` (importados, **no** reescritos: dos listas con los mismos números se separan la primera vez que alguien toca una). Clave posicional `[atajo, desde, hasta]`. |
| `orden` | `text` | coincidencia **exacta** contra `num_guia` o `num_remision` (P7). `minChars: 1`. |

Reglas duras que la traducción no puede violar (heredadas de `seleccion-a-filter.ts:23-32`): una
lista vacía **se omite**, nunca se manda `[]`; atajo y rango son excluyentes; las fechas viajan
`YYYY-MM-DD`, sin hora.

### 5.4 Scroll infinito (R18/R21/R22)

- **Listado:** `IntersectionObserver` sobre un centinela al final; al entrar en vista, se pide la
  página siguiente con el cursor devuelto. Se **añade** al final, sin reordenar.
- **Hilo:** el contenedor arranca anclado abajo (mismo gesto que `ChatConversacion.tsx:310-312`).
  El centinela va **arriba**. **R22 (no saltar)**: antes de insertar la página anterior se guarda
  `scrollHeight`; después se hace
  `el.scrollTop += el.scrollHeight - alturaPrevia`. Sin esa corrección, insertar 30 mensajes arriba
  empuja la vista y el lector pierde el sitio — es el defecto clásico del scroll inverso y por eso
  tiene requisito y test propios.
- **Sin `useEffect` que haga `setState` a partir de lecturas del navegador**: el lint del repo lo
  prohíbe. El estado de páginas vive en el reducer del módulo; la medición del scroll ocurre dentro
  del handler del observer, no en un efecto de lectura.

### 5.5 Separador de día (R23)

`lib/utils/separador-dia-cr.ts`:

```ts
const FMT = new Intl.DateTimeFormat("es-CR", {
  weekday: "long", day: "numeric", month: "long",
  timeZone: "America/Costa_Rica",
});
```

- **`es-CR` y `America/Costa_Rica`**, no la zona del navegador ni `es-EC`. Es la convención del
  repo, confirmada: `HiloNotasOrden.tsx:80-84`, `HistorialOrdenTimeline.tsx:58`,
  `RecolectadasHoyLista.tsx:58`, `ranking-historico-labels.ts:43`, `TableroDiaCabecera.tsx:43-49`.
  Formatear en la zona del dispositivo correría el separador un día para quien mire desde otro huso.
- **Minúscula inicial**: `es-CR` ya emite «jueves 28 de agosto» en minúscula; el helper **fuerza**
  la minúscula de la primera letra igualmente, para no depender del ICU de la plataforma.
- **Año**: se añade « de YYYY» cuando el día no pertenece al año en curso **de Costa Rica** (P6).
- La agrupación por día se hace sobre la **fecha calendario CR** del mensaje, no sobre
  `toISOString().slice(0,10)` — ese off-by-one está documentado en `fecha-cr.ts:41-45`.

### 5.6 Solo lectura (R24/R25)

- El módulo del histórico **no importa** `lib/actions/chat-whatsapp` salvo los **tipos**
  (`import type`), ni monta `<form>`, `<textarea>`, botón de enviar, menú de adjuntar ni chips de
  plantilla. Se comprueba con un test de comportamiento (no con un grep de comentarios): renderizado
  el hilo con mensajes, `queryByRole("textbox")`, `queryByRole("button", { name: /enviar/i })` y
  `queryByRole("group", { name: /plantillas/i })` son `null`.
- **R25 (sin escrituras):** el service del histórico recibe un cliente Prisma **acotado por tipo** a
  `$queryRaw` + lecturas; y el test del service usa un doble que **lanza** ante cualquier
  `update`/`create`/`$executeRaw`, de modo que una escritura futura rompe el test en vez de pasar
  desapercibida.

---

## 6. Alternativas descartadas (resumen)

| # | Alternativa | Por qué se descarta |
| --- | --- | --- |
| **A1** | Mover las burbujas a `components/shared/chat/` en esta feature | 14 archivos ajenos en el diff (13 tests + `ChatConversacion.tsx`), medido. Mezcla refactor con funcionalidad. Se declara deuda para su PR. |
| **A2** | Añadir `omitirScope: boolean` a `findMediaParaMensajero` | Un booleano que apaga la autorización dentro de la misma función es la puerta que se olvida abierta; el nombre del método dejaría de decir la verdad. Se usa un método nuevo con nombre que declara su alcance. |
| **A3** | Renderizador de burbujas propio para el histórico | Duplicaría el `switch` exhaustivo de `BurbujaContenido`, que existe para que un tipo nuevo del enum sea error de compilación. El duplicado se quedaría atrás en silencio. |
| **A4** | Paginar con `skip`/`OFFSET` | Con inserciones concurrentes, `OFFSET` **repite y pierde** filas entre páginas, y su coste crece con la profundidad. El índice `[conversacion_id, ocurrido_at]` está puesto para un cursor, no para un salto. |
| **A5** | Derivar `ROLES_HISTORICO_CONVERSACIONES` de `ROLES_ACCESO_TOTAL` | Hoy coinciden, pero la divergencia peligrosa va al revés: ampliar «acceso total de gestión» regalaría el histórico de todos los inquilinos sin decisión. Whitelist propia + guardia que excluye los cuatro roles restantes. |
| **A6** | Columna materializada `chat_conversacion.ultima_actividad_at` (o índice nuevo) para ordenar el listado | Es una **migración** (gate completo) y además obliga a escribir en el camino del **webhook** de ingesta, que es lo último que se toca por una pantalla de lectura. Se difiere: `T0` mide el volumen y P8 fija el umbral y la salida. |
| **A7** | Colgar el histórico de `/ordenes` como pestaña | El pedido es un ítem de menú propio con subítem, y el histórico no es una vista de órdenes: su unidad es la conversación (§1.3) y su audiencia es otra. |
| **A8** | Buscar también dentro del **cuerpo** de los mensajes | No está pedido, y `chat_mensaje.cuerpo` no tiene índice de texto: sería un Seq Scan sobre la tabla que más crece. Fuera de alcance declarado. |

---

## 7. Riesgos

1. **Volumen del listado (P8).** El `ORDER BY` sobre un valor calculado no se puede servir con un
   índice. Mitigación: `T0` mide antes de escribir; el umbral y la salida están escritos.
2. **Reacciones a caballo entre páginas.** Resuelto por diseño en §2.3; tiene test propio (R28).
3. **El scroll que salta (R22).** Es el defecto por defecto del scroll inverso; tiene requisito y
   test propios.
4. **PII en la fila.** Teléfono enmascarado (§2.2); `busqueda_texto` sigue omitida globalmente por
   `PRISMA_OMIT` (`lib/db/prisma-client.ts:45`) y **no** se selecciona en ninguna consulta nueva.
5. **El gate rápido.** El diff no toca `db/`, `lib/types/**`, `middleware.ts` ni nombres de dinero,
   así que `./init.sh --rapido` no se niega. **Si `T0` obliga a la migración de A6, el gate pasa a
   completo y eso va en su propio PR.**
