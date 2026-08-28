# Feature 318 — Histórico de conversaciones: admin y maestro leen el chat de todos los mensajeros

> Requisitos en notación EARS (`docs/specs.md`). Numerados `R1..R38`. Sin detalles de
> implementación (esos van en `design.md`). Cada requisito está mapeado a un test concreto —ruta de
> archivo y `assert`— en `tasks.md`. Un requisito sin test es un fallo de la feature
> (`CLAUDE.md` §4). Un criterio que se satisfaga reescribiendo un comentario NO vale: hay
> precedente en este repo.

## Pedido literal del humano (2026-08-28)

> «agrega el item historico (disponible solo para el admin y maestro) con subitem conversaciones,
> donde se listan todas las conversaciones de los distintos mensajeros y se puede ver todos los
> mensajes enviados y recibidos en el chat por orden independiente de la fecha, deja el label por
> fecha "jueves x de X", esta lista de mensajes debe ir paginada e ir cargando en base al scroll no
> cargar todos los mensajes de golpe, filtros por fecha y por orden, desde fuera implementar la
> barra de filtros que ya se usa en las tablas para filtrar por mensajero, el input permite filtrar
> por nombre de destinatario, num_guia, num_remision, nombre del mensajero»

## Alcance

**Dentro de alcance**

- Ítem de sidebar **«Histórico»** con subítem **«Conversaciones»**, visible sólo para `maestro` y
  `admin`.
- Ruta nueva bajo `app/(app)/` con gate de rol **server-side**.
- Listado paginado de **todas** las conversaciones de **todos** los mensajeros.
- Lectura del hilo completo de una conversación —entrantes y salientes—, **independiente de la
  fecha**, con separador de día y paginación por scroll.
- Barra de filtros reutilizada (`BuscadorFiltros` + `FilterComponent`): filtro por **mensajero**,
  por **fecha**, por **orden**, e input de búsqueda libre.
- Ensanchamiento **explícito** de la autorización de lectura del hilo y de sus adjuntos para los
  dos roles del histórico.

**Fuera de alcance (declarado)**

- **Responder, enviar, adjuntar, reaccionar, marcar leído o borrar** desde esta pantalla. Es
  **SOLO LECTURA** (R24, R25).
- Exportar o descargar el hilo (CSV/PDF).
- Buscar **dentro** del texto de los mensajes (el input busca por orden/persona, no por cuerpo del
  mensaje). No está pedido y `chat_mensaje.cuerpo` no tiene índice de texto.
- Almacenar el binario de la media. Se mantiene **D1/R15 de la 311**: no hay copia propia.
- Marcar el hilo como leído por parte del admin (`chat_conversacion.mensajero_leido_at` es del
  mensajero y esta pantalla **no lo escribe**, R25).
- Cambiar la autorización del chat del mensajero (R26).
- Migración de base de datos (R27) — ver `design.md` §2.4 para el disparador que la reabriría.

## Lo confirmado EN EL ARCHIVO REAL (no en el grafo), 2026-08-28

| Afirmación | Archivo y evidencia |
| --- | --- |
| `SIDEBAR_ITEMS` soporta `children` y `roles`, y el icono viaja como `IconKey` (string) | `lib/auth/menu-visibility.ts:16-46`, `:48-52`, `:62-89` |
| El Sidebar resuelve `IconKey → componente` en un mapa **exhaustivo** (`Record<IconKey, …>`) | `app/(app)/_components/Sidebar.tsx:147-171`, `:307` |
| Precedente R10 de la 129: ítem y gate leen la MISMA constante | `app/(app)/analitica/page.tsx:114-127` lee `ROLES_ACCESO_ANALITICA` de `lib/auth/menu-visibility.ts:155` |
| `ChatConversacion` es `@@unique([ordenId, telefonoE164])` → **una orden puede tener más de un hilo** | `db/schema.prisma:295-316` |
| `ChatMensaje` tiene el índice `[conversacionId, ocurridoAt]` puesto para el historial ordenado | `db/schema.prisma:358` |
| `Orden` tiene `destinatario`, `numGuia Int?`, `numRemision String`, `mensajeroAsignadoId` | `db/schema.prisma:565-570`, `:595` |
| `orden.busqueda_texto` (columna GENERADA + índice GIN trgm) ya cubre guía, remisión, teléfono, destinatario y producto — **NO el nombre del mensajero** | `db/schema.prisma:638-654`, `:760` |
| El repositorio del chat autoriza **por mensajero asignado** | `lib/repositories/ChatConversacionRepository.ts:141-156`; `lib/repositories/ChatMensajeRepository.ts:269-311` |
| El proxy de media autoriza **por mensajero asignado** y responde 410 al expirar | `app/api/chat/media/[mensajeId]/route.ts:72-94` |
| **Trampa (d) YA RESUELTA por la 316**: los textos del adjunto se eligen por dirección | `app/(app)/mis-asignaciones/_components/chat/chat-format.ts:92-130`; `MediaAdjunto.tsx:41-47` |
| **Trampa (e) YA RESUELTA por la 311**: la media expirada se dice, no rompe | `MediaAdjunto.tsx:22-31`, `:166-176`, `:212-226` |
| **Trampa (c) MEDIDA Y ACOTADA**: la guardia de la 229 se pone roja si cambian `PUBLIC_ROUTES`/`SELF_AUTH_ROUTES`/`REDIRECT_TO_ROOT`, si aparece un **segmento de carpeta `rastreo`** bajo `app/`, o si un `page.tsx`/`route.ts` importa `rastreo-publico`/`RastreoPublico`. **Una ruta nueva que no toque esas tres cosas NO la enrojece** | `tests/unit/guards/rastreo-sin-ruta-nueva.guardia.test.ts:49-66`, `:141-164` |

---

## R1 — Constante única de roles del histórico

El sistema DEBE declarar una constante única `ROLES_HISTORICO_CONVERSACIONES` cuyo contenido sea
exactamente los roles `maestro` y `admin`, y DEBE ser el único punto del árbol donde se enumera
quién accede al histórico.

## R2 — El ítem de menú lee esa constante

El sistema DEBE declarar en `SIDEBAR_ITEMS` un ítem «Histórico» cuyo campo `roles` sea una
REFERENCIA a `ROLES_HISTORICO_CONVERSACIONES`, nunca un literal copiado.

## R3 — El subítem «Conversaciones»

El ítem «Histórico» DEBE tener exactamente un subítem con etiqueta «Conversaciones» apuntando a la
ruta del histórico, y el subítem DEBE heredar la visibilidad del padre (no declara `roles` propios).

## R4 — Visibilidad del ítem

SI el actor autenticado tiene un rol que NO está en `ROLES_HISTORICO_CONVERSACIONES`, ENTONCES
`itemsVisibles` NO DEBE devolver el ítem «Histórico».

## R5 — Sesión ausente

MIENTRAS no haya actor resuelto, el sistema NO DEBE mostrar el ítem «Histórico».

## R6 — Icono propio y serializable

El ítem «Histórico» DEBE llevar una `IconKey` **nueva y propia**, distinta de las ya declaradas, y
el mapa `IconKey → componente` del Sidebar DEBE resolverla; el módulo del menú NO DEBE exportar
ningún componente de icono (todo lo que cruza el borde RSC es serializable).

## R7 — El gate real es la ruta

CUANDO un actor cuyo rol NO está en `ROLES_HISTORICO_CONVERSACIONES` solicita la ruta del histórico,
el sistema DEBE responder `notFound()` **antes** de consultar dato alguno.

## R8 — Las dos capas no pueden divergir

El gate de la ruta DEBE leer la MISMA constante que el `roles` del ítem de menú (precedente R10 de
la 129): ningún literal de rol se escribe en la página.

## R9 — El aterrizaje post-login no cambia

CUANDO se añade el ítem «Histórico», `primerDestino` DEBE seguir devolviendo, para cada uno de los
roles del sistema, exactamente el mismo `href` que devolvía antes de la feature.

## R10 — Se listan las conversaciones de TODOS los mensajeros

MIENTRAS el actor pertenezca a `ROLES_HISTORICO_CONVERSACIONES`, el listado DEBE incluir
conversaciones cuyo mensajero NO sea el actor, sin ninguna restricción por mensajero asignado.

## R11 — Qué identifica cada fila del listado

Cada fila del listado DEBE identificar: la **orden** (número de guía si existe, si no la remisión),
el **destinatario**, el **mensajero** del hilo y el instante del **último mensaje** del hilo.

## R12 — Órdenes borradas fuera

SI la orden de una conversación está borrada lógicamente (`deleted_at` no nulo), ENTONCES esa
conversación NO DEBE aparecer en el listado ni ser legible por esta pantalla.

## R13 — El listado se pagina por cursor, sin OFFSET

El listado DEBE paginarse con un cursor estable compuesto por el instante de última actividad y el
identificador de la conversación; NO DEBE usar `OFFSET`.

## R14 — Orden del listado

El listado DEBE ordenarse por última actividad descendente, con el identificador de la conversación
como desempate determinista.

## R15 — Ninguna conversación duplicada ni perdida entre páginas

CUANDO dos conversaciones comparten exactamente el mismo instante de última actividad, el sistema
DEBE devolver cada una **una sola vez** a lo largo de la paginación completa.

## R16 — El hilo muestra las dos direcciones

CUANDO se abre una conversación, el sistema DEBE mostrar tanto los mensajes **entrantes** como los
**salientes** del hilo.

## R17 — El hilo es independiente de la fecha

MIENTRAS haya un filtro de fecha aplicado en el listado, el hilo abierto NO DEBE recortarse por ese
filtro: se lee completo.

## R18 — El hilo no se carga de golpe

CUANDO se abre una conversación, el sistema DEBE solicitar como mucho una página de mensajes de
tamaño fijo, no el hilo completo.

## R19 — Paginación del hilo por cursor estable

La paginación del hilo DEBE usar un cursor compuesto `(ocurrido_at, id)` y NO `OFFSET`.

## R20 — Ningún mensaje duplicado ni perdido

CUANDO dos mensajes del mismo hilo comparten exactamente el mismo `ocurrido_at`, el sistema DEBE
devolver cada uno **una sola vez** a lo largo de la paginación completa del hilo.

## R21 — Se aterriza en lo más reciente y se pagina hacia atrás

CUANDO se abre una conversación, el sistema DEBE mostrar los mensajes **más recientes** y, al
desplazarse hacia arriba hasta el extremo, DEBE cargar la página inmediatamente anterior.

## R22 — El scroll no salta al cargar más

CUANDO se carga una página anterior por scroll, el sistema DEBE conservar la posición de lectura: el
mensaje que el lector tenía a la vista sigue a la vista.

## R23 — Separador de día

El sistema DEBE insertar, antes del primer mensaje de cada día del hilo, un separador con el día de
la semana, el día del mes y el mes en minúscula inicial y en español —forma «jueves 28 de agosto»—,
calculado en la zona horaria de Costa Rica.

## R24 — Solo lectura: sin controles de escritura

La pantalla del histórico NO DEBE ofrecer campo de redacción, botón de enviar, adjuntar, plantillas,
reaccionar ni ninguna otra acción que produzca un mensaje.

## R25 — Solo lectura: sin efectos de escritura

CUANDO se abre o se pagina una conversación desde el histórico, el sistema NO DEBE escribir en
ninguna tabla; en particular NO DEBE tocar `chat_conversacion.mensajero_leido_at`.

## R26 — La autorización del mensajero no se toca

MIENTRAS un actor tenga rol `mensajero`, el sistema DEBE seguir devolviéndole exclusivamente los
hilos y los adjuntos de las órdenes asignadas a él.

## R27 — Sin migración ni cambio de esquema

La feature NO DEBE añadir carpetas en `db/migrations/` ni objetos nuevos (tablas, columnas, enums,
índices) a `db/schema.prisma`.

## R28 — Las reacciones no son burbujas

CUANDO un hilo contiene mensajes de tipo `reaccion`, el sistema DEBE anclarlos al mensaje al que
reaccionan y NO DEBE pintarlos como burbuja propia.

## R29 — Adjuntos legibles por el histórico

CUANDO un actor de `ROLES_HISTORICO_CONVERSACIONES` solicita el binario de un adjunto de cualquier
conversación, el sistema DEBE servirlo aunque el actor no sea el mensajero de esa orden.

## R30 — El ensanche no abre la puerta a nadie más

SI el actor no es el mensajero asignado de la orden **y** su rol no está en
`ROLES_HISTORICO_CONVERSACIONES`, ENTONCES el proxy de media DEBE responder `403` sin llamar a la
Graph API.

## R31 — La media expirada se dice, no rompe

SI Meta ya no entrega el binario de un adjunto, ENTONCES la vista DEBE mostrar en su burbuja un
aviso de que el archivo ya no está disponible y el resto del hilo DEBE seguir legible.

## R32 — La barra de filtros es la que ya existe

La barra de filtros del histórico DEBE construirse sobre `components/shared/BuscadorFiltros.tsx` y
`components/shared/FilterComponent.tsx`, declarando los filtros como datos (`FilterDef[]`) desde una
función pura, siguiendo el patrón de `ordenes-filtros-def.ts` + `seleccion-a-filter.ts`.

## R33 — Filtro por mensajero

El sistema DEBE ofrecer un filtro de selección múltiple por mensajero; CUANDO hay mensajeros
seleccionados, el listado DEBE devolver únicamente conversaciones cuyo mensajero esté entre los
seleccionados.

## R34 — Filtro por fecha

El sistema DEBE ofrecer un filtro de rango de fechas; CUANDO hay rango aplicado, el listado DEBE
devolver únicamente conversaciones **con al menos un mensaje** cuyo `ocurrido_at` caiga dentro del
rango, tomando las cotas del día calendario de Costa Rica y con el extremo `hasta` **inclusivo**.

## R35 — Filtro por orden

El sistema DEBE ofrecer un filtro por orden; CUANDO hay una orden indicada, el listado DEBE devolver
únicamente las conversaciones de esa orden (que pueden ser más de una, R-contexto: `@@unique([ordenId,
telefonoE164])`).

## R36 — El input de búsqueda libre y su alcance

El input de búsqueda libre DEBE encontrar una conversación por **nombre del destinatario**, por
**`num_guia`**, por **`num_remision`** y por **nombre del mensajero**, con plegado de acentos y sin
distinguir mayúsculas.

## R37 — Mínimo de caracteres

MIENTRAS el término escrito tenga menos caracteres que el mínimo del repo (`BUSQUEDA_MIN_CHARS`), el
sistema NO DEBE emitir el término ni ejecutar consulta alguna, y DEBE avisar de cuántos faltan.

## R38 — Borde tipado

CUANDO la entrada de cualquiera de las dos consultas del histórico no valida contra su esquema
(cursor mal formado, fecha que no es `YYYY-MM-DD`, lista vacía, tamaño de página fuera de rango), el
sistema DEBE responder `validation_error` **sin ejecutar ninguna consulta**.

---

## Preguntas abiertas — **PENDIENTES DE LA PUERTA HUMANA**

Cada una lleva una recomendación razonada. **Ninguna está cerrada**: el spec implementa la
recomendación sólo si el humano la aprueba, y la decisión contraria cambia requisitos concretos
(se indica cuáles).

### P1 — ¿La lista de primer nivel son CONVERSACIONES u ÓRDENES?

**Recomendación: conversaciones (un hilo por `orden + teléfono`).**
Razón: `ChatConversacion` es `@@unique([ordenId, telefonoE164])` (`db/schema.prisma:312`), así que
una orden **puede** tener más de un hilo (el cliente cambió de número: ver `migrarTelefono` en
`ChatConversacionRepository.ts:201-248`, que deja el hilo viejo vivo). Fundir dos hilos de números
distintos bajo una sola fila mezclaría dos interlocutores en una misma cronología, y ni el modelo ni
la UI del mensajero lo hacen hoy. La fila **rotula la orden**, que es como el humano pidió agrupar
(«por orden»); si una orden tiene dos hilos, aparecen dos filas con la misma orden y distinto
número.
**Si el humano decide «órdenes»:** cambian R11, R13, R14, R15 y el contrato del listado.

### P2 — El filtro por fecha, ¿corta por la fecha de la CONVERSACIÓN o por la del MENSAJE?

**Recomendación: por la fecha del MENSAJE, y sólo en el LISTADO.**
Razón: una conversación no tiene «una» fecha propia útil (`created_at` es cuándo se abrió el hilo, no
cuándo hubo actividad). Lo que un admin busca es «qué se habló el 12». El rango selecciona
conversaciones **con actividad** en él (R34) y el hilo abierto se sigue leyendo completo (R17), que
es lo que el humano pidió literalmente («independiente de la fecha»).
**Si el humano decide «fecha de la conversación»:** cambia R34 y desaparece la dependencia del
listado sobre `chat_mensaje`.

### P3 — Al entrar al hilo, ¿se aterriza en lo más reciente o en lo más antiguo?

**Recomendación: en lo más reciente, paginando hacia atrás (R21).**
Razón: es el comportamiento del chat del propio repo
(`ChatConversacion.tsx:310-312` ancla el hilo abajo) y el de WhatsApp. Aterrizar en el primer
mensaje de un hilo de meses obliga a desplazarse hasta el final para ver lo último, que es lo que
casi siempre se busca.
**Si el humano decide «lo más antiguo»:** cambian R21 y R22 y el sentido del cursor.

### P4 — ¿`adminSatelite` y `adminTienda` quedan fuera?

**Recomendación: FUERA.** El pedido dice «admin y maestro». Además `adminTienda` es un inquilino:
darle el histórico de **todos** los mensajeros le enseñaría conversaciones de órdenes de otras
tiendas (fuga entre inquilinos). `adminSatelite` está acotado a su zona en el resto del producto y
esta pantalla no tiene recorte por zona.
**Si el humano decide incluirlos:** hay que diseñar el recorte por tienda/zona ANTES, y cambian R1,
R10 y R29.

### P5 — ¿El histórico ve los ADJUNTOS, o sólo el texto?

**Recomendación: sí, los ve (R29).** Un histórico que muestra «imagen» sin poder abrirla no sirve
para lo que se pide (revisar qué se le dijo al cliente). Pero es un **ensanche real de
autorización**: hoy `findMediaParaMensajero` (`ChatMensajeRepository.ts:269-311`) exige
`o.mensajero_asignado_id = $actor`. El diseño lo hace por una **vía separada y explícita** (§4), no
relajando la existente.
**Si el humano decide «sólo texto»:** caen R29 y R31, y el proxy no se toca en absoluto.

### P6 — El separador de día, ¿lleva año? ¿usa «hoy»/«ayer»?

**Recomendación: sin «hoy»/«ayer»** (el humano fijó el formato: «jueves x de X») y **con año sólo
cuando el día no pertenece al año en curso** («jueves 28 de agosto de 2025»). En un histórico que
puede recorrer años, un separador sin año es ambiguo.
**Si el humano decide «nunca año»:** cambia el `assert` de R23.

### P7 — El filtro «por orden», ¿qué control es?

**Recomendación: un filtro de texto de coincidencia EXACTA** contra `num_guia` o `num_remision`
(`kind: "text"`), distinto del input libre —que es difuso—. Un `multi` con todas las órdenes como
opciones no es viable (la lista es ilimitada).
**Si el humano decide otra cosa** (p. ej. que el input libre baste y no haya filtro «orden»
separado): cae R35.

### P8 — Volumen: ¿cuántas conversaciones y mensajes hay hoy?

**No medido, y no se rellena por suposición (regla 6).** El orden del listado se calcula con un
`MAX(ocurrido_at)` por conversación (§2.4 del design): correcto siempre, pero su coste crece con el
número de **conversaciones**. La tarea `T0` de `tasks.md` mide `count(*)` de `chat_conversacion` y
de `chat_mensaje` **antes** de implementar. **Recomendación: sin migración** (R27) mientras
`chat_conversacion` esté por debajo de ~50.000 filas; por encima, se abre un PR propio con el índice
o la columna materializada —una migración manda el gate al modo completo (`docs/verification.md`)—.

### P9 — Retención: ¿el histórico enseña conversaciones de órdenes ya cerradas/antiguas sin límite?

**Recomendación: sí, sin límite temporal** (es un «histórico»). Se declara que **la media de más de
30 días aparecerá como no disponible** (D1/R15 de la 311) y que eso **no es un fallo** (R31).
**Si el humano quiere un tope de antigüedad:** es un requisito nuevo y un filtro por defecto.
