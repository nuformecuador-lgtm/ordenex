# Feature 321 — Histórico de conversaciones: admin y maestro leen el chat de todos los mensajeros

> Requisitos en notación EARS (`docs/specs.md`). Numerados `R1..R45`. Sin detalles de
> implementación (esos van en `design.md`). Cada requisito está mapeado a un test concreto —ruta de
> archivo y `assert` de comportamiento— en `tasks.md`. Un requisito sin test es un fallo de la
> feature (`CLAUDE.md` §4). Un criterio que se satisfaga reescribiendo un comentario NO vale: hay
> precedente en este repo.
>
> **Revisión del 2026-08-28 tras la puerta humana.** Las nueve preguntas abiertas están
> **CERRADAS** (ver «Decisiones cerradas» al final). La numeración `R1..R38` se conserva —renumerar
> rompería las citas de la ficha y de `progress/`—; los requisitos que cambiaron están marcados
> **[MODIFICADO 2026-08-28]** y los nuevos van al final (`R39..R45`).

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
- Listado **paginado** de todas las conversaciones de todos los mensajeros, donde la unidad es el
  hilo **(orden + mensajero)**.
- Lectura del hilo completo —entrantes y salientes en la misma cronología—, **independiente de la
  fecha**, con separador de día y paginación por scroll, **cargada sólo al abrir la conversación**.
- Barra de filtros reutilizada (`BuscadorFiltros` + `FilterComponent`): filtro por **mensajero**,
  por **fecha**, por **orden** (número exacto) e input de búsqueda libre.
- Ensanchamiento **explícito** de la autorización de lectura del hilo y de sus adjuntos para los dos
  roles del histórico.

**Fuera de alcance (declarado)**

- **Responder, enviar, adjuntar, reaccionar, marcar leído o borrar** desde esta pantalla. Es
  **SOLO LECTURA** (R24, R25).
- Exportar o descargar el hilo (CSV/PDF).
- Buscar **dentro** del texto de los mensajes (el input busca por orden/persona, no por cuerpo del
  mensaje). No está pedido y `chat_mensaje.cuerpo` no tiene índice de texto.
- Almacenar el binario de la media. Se mantiene **D1/R15 de la 311**: no hay copia propia.
- **Purga o retención del histórico.** Decisión humana (P9): no hay límite de antigüedad y
  **un cron futuro limpiará el exceso**; ese cron es otra feature.
- Cambiar la autorización del chat del mensajero (R26).
- **Migración de base de datos (R27).** Cerrado por decisión humana (P1, P2, P8): la agrupación por
  `(orden, mensajero)` y el orden del listado se resuelven **en la consulta**, no en el esquema.

## Lo confirmado EN EL ARCHIVO REAL (no en el grafo), 2026-08-28

| Afirmación | Archivo y evidencia |
| --- | --- |
| `SIDEBAR_ITEMS` soporta `children` y `roles`, y el icono viaja como `IconKey` (string) | `lib/auth/menu-visibility.ts:16-46`, `:48-52`, `:62-89` |
| El Sidebar resuelve `IconKey → componente` en un mapa **exhaustivo** (`Record<IconKey, …>`) | `app/(app)/_components/Sidebar.tsx:147-171`, `:307` |
| Precedente R10 de la 129: ítem y gate leen la MISMA constante | `app/(app)/analitica/page.tsx:114-127` lee `ROLES_ACCESO_ANALITICA` de `lib/auth/menu-visibility.ts:155` |
| `ChatConversacion` es `@@unique([ordenId, telefonoE164])`: la fila se keyea por **teléfono**, no por mensajero | `db/schema.prisma:295-316` |
| **`upsertParaOrden` REESCRIBE `mensajero_id` al reasignar** (`update: { mensajeroId }`) | `lib/repositories/ChatConversacionRepository.ts:110-132` |
| Un cambio de número deja **dos filas** de hilo para la misma orden, y la evidencia es una burbuja de **sistema** | `ChatConversacionRepository.ts:201-248`; `db/schema.prisma:350-351`; `BurbujaSistema.tsx` |
| `ChatMensaje` tiene el índice `[conversacionId, ocurridoAt]` puesto para el historial ordenado | `db/schema.prisma:358` |
| **`chat_mensaje` NO tiene columna de mensajero** | `db/schema.prisma:322-373` (ver la LIMITACIÓN CONOCIDA de R45) |
| `Orden` tiene `destinatario`, `numGuia Int?`, `numRemision String`, `mensajeroAsignadoId` | `db/schema.prisma:565-570`, `:595` |
| `orden.busqueda_texto` (columna GENERADA + índice GIN trgm) ya cubre guía, remisión, teléfono, destinatario y producto — **NO el nombre del mensajero** | `db/schema.prisma:638-654`, `:760` |
| El repositorio del chat autoriza **por mensajero asignado** | `ChatConversacionRepository.ts:141-156`; `ChatMensajeRepository.ts:269-311` |
| El proxy de media autoriza **por mensajero asignado** y responde 410 al expirar | `app/api/chat/media/[mensajeId]/route.ts:72-94` |
| **Trampa (d) YA RESUELTA por la 316**: los textos del adjunto se eligen por dirección | `chat-format.ts:92-130`; `MediaAdjunto.tsx:41-47` |
| **Trampa (e) YA RESUELTA por la 311**: la media expirada se dice, no rompe | `MediaAdjunto.tsx:22-31`, `:166-176`, `:212-226` |
| **Trampa (c) MEDIDA Y ACOTADA**: la guardia de la 229 se pone roja si cambian las tres listas del middleware, si aparece un **segmento de carpeta `rastreo`** bajo `app/`, o si un `page.tsx`/`route.ts` importa `rastreo-publico`/`RastreoPublico`. **Una ruta nueva que no toque esas tres cosas NO la enrojece** | `tests/unit/guards/rastreo-sin-ruta-nueva.guardia.test.ts:49-66`, `:141-164` |

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

MIENTRAS el actor pertenezca a `ROLES_HISTORICO_CONVERSACIONES`, el listado DEBE incluir hilos cuyo
mensajero NO sea el actor, sin ninguna restricción por mensajero asignado.

## R11 — Qué identifica cada fila del listado **[MODIFICADO 2026-08-28 — P1]**

Cada fila del listado DEBE identificar: la **orden** (número de guía si existe, si no la remisión),
el **destinatario**, el **mensajero dueño del hilo** y el instante del **último mensaje** del hilo.
La fila representa el par **(orden, mensajero)**, no una fila de `chat_conversacion`.

## R12 — Órdenes borradas fuera

SI la orden de un hilo está borrada lógicamente (`deleted_at` no nulo), ENTONCES ese hilo NO DEBE
aparecer en el listado ni ser legible por esta pantalla.

## R13 — El listado se pagina por cursor, sin OFFSET **[MODIFICADO 2026-08-28 — P1, P8]**

El listado DEBE devolver como mucho **N hilos por página** y paginarse con un cursor estable
compuesto por el instante de última actividad y la clave del hilo **(orden, mensajero)**; NO DEBE
usar `OFFSET`.

## R14 — Orden del listado **[MODIFICADO 2026-08-28 — P1]**

El listado DEBE ordenarse por última actividad del hilo descendente, con la clave
**(orden, mensajero)** como desempate determinista.

## R15 — Ningún hilo duplicado ni perdido entre páginas **[MODIFICADO 2026-08-28 — P1]**

CUANDO dos hilos comparten exactamente el mismo instante de última actividad, el sistema DEBE
devolver cada uno **una sola vez** a lo largo de la paginación completa.

## R16 — El hilo muestra las dos direcciones

CUANDO se abre un hilo, el sistema DEBE mostrar tanto los mensajes **entrantes** como los
**salientes**.

## R17 — El hilo es independiente de la fecha

MIENTRAS haya un filtro de fecha aplicado en el listado, el hilo abierto NO DEBE recortarse por ese
filtro: se lee completo.

## R18 — El hilo no se carga de golpe

CUANDO se abre un hilo, el sistema DEBE solicitar como mucho una página de mensajes de tamaño fijo,
no el hilo completo.

## R19 — Paginación del hilo por cursor estable

La paginación del hilo DEBE usar un cursor compuesto `(ocurrido_at, id)` y NO `OFFSET`.

## R20 — Ningún mensaje duplicado ni perdido

CUANDO dos mensajes del mismo hilo comparten exactamente el mismo `ocurrido_at`, el sistema DEBE
devolver cada uno **una sola vez** a lo largo de la paginación completa del hilo.

## R21 — Se aterriza en lo más reciente y se pagina hacia atrás

CUANDO se abre un hilo, el sistema DEBE mostrar los mensajes **más recientes** y, al desplazarse
hacia arriba hasta el extremo, DEBE cargar la página inmediatamente anterior.

## R22 — El scroll no salta al cargar más

CUANDO se carga una página anterior por scroll, el sistema DEBE conservar la posición de lectura: el
mensaje que el lector tenía a la vista sigue a la vista.

## R23 — Separador de día **[MODIFICADO 2026-08-28 — P6]**

El sistema DEBE insertar, antes del primer mensaje de cada día del hilo, un separador que diga:

- **«hoy»** si ese día es la fecha calendario de Costa Rica en curso;
- **«ayer»** si es la inmediatamente anterior;
- en cualquier otro caso, el día de la semana, el día del mes y el mes, en minúscula inicial y en
  español — forma **«jueves 28 de agosto»**.

El separador **NUNCA** DEBE incluir el año, ni siquiera para días de otro año.

## R24 — Solo lectura: sin controles de escritura

La pantalla del histórico NO DEBE ofrecer campo de redacción, botón de enviar, adjuntar, plantillas,
reaccionar ni ninguna otra acción que produzca un mensaje.

## R25 — Solo lectura: sin efectos de escritura

CUANDO se abre o se pagina un hilo desde el histórico, el sistema NO DEBE escribir en ninguna tabla;
en particular NO DEBE tocar `chat_conversacion.mensajero_leido_at`.

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
hilo, el sistema DEBE servirlo aunque el actor no sea el mensajero de esa orden.

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
seleccionados, el listado DEBE devolver únicamente hilos cuyo mensajero esté entre los
seleccionados.

## R34 — Filtro por fecha

El sistema DEBE ofrecer un filtro de rango de fechas; CUANDO hay rango aplicado, el listado DEBE
devolver únicamente hilos **con al menos un mensaje** cuyo `ocurrido_at` caiga dentro del rango,
tomando las cotas del día calendario de Costa Rica y con el extremo `hasta` **inclusivo**.

## R35 — Filtro por orden: número EXACTO **[MODIFICADO 2026-08-28 — P7]**

El sistema DEBE ofrecer un filtro por **número de orden exacto**: CUANDO se indica un valor, el
listado DEBE devolver únicamente los hilos de la orden cuyo `num_guia` **o** `num_remision` sea
**igual** a ese valor. El sistema NO DEBE aplicar coincidencia parcial en este filtro.

## R36 — El input de búsqueda libre y su alcance

El input de búsqueda libre DEBE encontrar un hilo por **nombre del destinatario**, por
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

> Los siguientes requisitos **nacen de las respuestas del humano del 2026-08-28** y se numeran al
> final para no mover las citas existentes.

## R39 — El filtro de fecha se comporta DIFERENCIADO en cada superficie **[NUEVO — P2]**

El sistema DEBE aplicar el rango de fechas con dos semánticas distintas y explícitas:

- **en el LISTADO**, el rango **SELECCIONA** qué hilos aparecen (los que tienen al menos un mensaje
  dentro, R34);
- **en el HILO abierto**, el rango **NO recorta nada** (R17), y la vista DEBE decírselo al lector
  con un aviso visible cuando se abre un hilo con rango aplicado.

El sistema NO DEBE resolver esta diferencia con dato nuevo en la base.

## R40 — Enviados y recibidos, un solo hilo y una sola cronología **[NUEVO — P5]**

El sistema DEBE presentar los mensajes entrantes y salientes **entrelazados en el mismo hilo**,
ordenados por `ocurrido_at`; NO DEBE ofrecer vistas, pestañas ni columnas separadas por dirección,
ni reordenar por dirección.

## R41 — Carga perezosa: el listado no trae mensajes **[NUEVO — P8]**

CUANDO el sistema responde al listado de hilos, la respuesta NO DEBE contener ningún mensaje.
Los mensajes de un hilo DEBEN solicitarse **sólo** cuando ese hilo se abre.

## R42 — La unidad del hilo es (orden, mensajero) **[NUEVO — P1]**

El sistema DEBE tratar como **un único hilo** todas las filas de `chat_conversacion` que compartan
`orden_id` y `mensajero_id`, fusionando sus mensajes en una sola secuencia ordenada por
`(ocurrido_at, id)`. La fusión NO DEBE alterar el orden relativo de los mensajes ni duplicarlos.

## R43 — Cabecera del hilo fusionado **[NUEVO — P1]**

CUANDO un hilo fusiona más de un número de teléfono, la cabecera DEBE rotular la orden y el
mensajero, mostrar el número **vigente** (el de la fila con actividad más reciente) e indicar que
hay más de un número; y el cambio de número DEBE seguir siendo legible **dentro** del hilo como el
mensaje de sistema que ya existe.

## R44 — Dos mensajeros de la misma orden son dos hilos **[NUEVO — P1]**

SI una misma orden tiene hilos de dos mensajeros distintos, ENTONCES el listado DEBE mostrarlos como
**dos filas distintas**, cada una atribuida a su mensajero; el sistema NO DEBE fusionarlas ni
tratarlas como duplicado.

## R45 — Límite conocido de la atribución tras una reasignación **[NUEVO — P1]**

MIENTRAS `chat_conversacion.mensajero_id` sea reescrito por la reasignación
(`upsertParaOrden`, `ChatConversacionRepository.ts:110-132`) y `chat_mensaje` no tenga columna de
mensajero, el sistema DEBE atribuir el hilo al mensajero que hoy consta en la fila y DEBE incluir en
él los mensajes anteriores a la reasignación; el sistema NO DEBE inventar una partición por
mensajero que el dato no sostiene.

> **LIMITACIÓN CONOCIDA — declarada, no descubierta.** El humano pidió «el chat del mensajero del
> día que gestionó esa orden». Eso se cumple **siempre que el dato lo permita**: dos mensajeros con
> hilos separados dan dos filas (R44). Pero cuando la orden se reasigna y el cliente **conserva su
> número**, hoy no hay dos filas: `upsertParaOrden` **reescribe** `mensajero_id` sobre la única fila
> `(orden, teléfono)`, y `chat_mensaje` no guarda quién era el mensajero de cada mensaje
> (`db/schema.prisma:322-373`). Partir de verdad ese hilo exigiría **una columna nueva en
> `chat_mensaje` (migración)**, que esta feature tiene **prohibida** por decisión humana (R27). Se
> fija el comportamiento con un test para que sea una limitación **vigilada** y no un accidente —
> mismo patrón que la 311 usó con `migrarTelefono` (`ChatConversacionRepository.ts:201-224`). Si se
> quiere la partición real, se reabre con el humano en su propia feature.

---

## Decisiones cerradas por el humano — 2026-08-28

Las nueve preguntas abiertas de la primera versión de este spec **están cerradas**. No se reabren.

| # | Respuesta literal del humano | Qué fija en el spec |
| --- | --- | --- |
| **P1** | «hilo por orden y mensajero, el chat del mensajero del dia que gestiono esa orden» | La unidad del hilo es **(orden, mensajero)**: **R42** (fusión sin tocar la DB), **R43** (cabecera con dos números), **R44** (dos mensajeros = dos hilos, no duplicado), **R45** (límite conocido tras reasignación). Cambian **R11, R13, R14, R15**. Diseño en `design.md` §1.3 y §2.4. |
| **P2** | «mensaje pero diferenciado sin agregar nada en la db» | El filtro de fecha corta **por mensaje** (**R34**) y se comporta **diferenciado** entre listado e hilo (**R39**, con **R17**). **La alternativa A6 —columna materializada `ultima_actividad_at` o índice nuevo— queda DESCARTADA por decisión humana, no aplazada.** Sigue **sin migración** (**R27**). |
| **P3** | «si» | Se aterriza en el mensaje más reciente y se pagina hacia atrás: **R21**, **R22**. |
| **P4** | «solo admin/maestro» | `ROLES_HISTORICO_CONVERSACIONES = ["maestro","admin"]`: **R1**. `adminSatelite`, `adminTienda`, `mensajero` y `apiKey` quedan **fuera**, y la guardia lo vigila. |
| **P5** | «si — enviados y recibidos en el mismo orden, no fuera» | El histórico **sí** ve los adjuntos, por la vía separada `findMediaParaLectorHistorico` y sin relajar la del mensajero: **R29**, **R30**, **R26**. Y entrantes y salientes van en **el mismo hilo y la misma cronología**: **R40** (con **R16**). |
| **P6** | «hoy/ayer esta bien y sin año» | El separador usa **«hoy»** y **«ayer»** y **nunca** lleva año: **R23** (modificado; corrige la recomendación anterior). El cálculo de «hoy»/«ayer» va contra la **fecha calendario CR**, que es donde está el off-by-one. |
| **P7** | «numero exacto» | El filtro «orden» es el **número exacto** (`num_guia` o `num_remision`), sin coincidencia parcial: **R35** (modificado). |
| **P8** | «tambien paginado, solo X conversaciones a la vez, y solo hasta que se abra una se cargan los mensajes» | **Dos paginaciones**: la del listado (**R13**, N hilos por página) y la del hilo (**R18**, **R19**). Y **carga perezosa**: la respuesta del listado no lleva ni un mensaje (**R41**). |
| **P9** | «sin limite, un cron futuro limpiara el exceso» | Sin límite de antigüedad; **la purga es un cron futuro y queda FUERA de alcance**. La media de más de 30 días saldrá como no disponible y eso no es un fallo: **R31**. |
