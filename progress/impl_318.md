# Feature 318 — Histórico de conversaciones · bitácora de implementación

> Rama `feature/318-historico-conversaciones`. Spec aprobado por el humano en
> `specs/318-historico-conversaciones/` (`requirements.md` R1–R45, `design.md`, `tasks.md`).
> Implementada por el IMPLEMENTER delegando en `backend_dev` y `frontend_dev` (`AGENTS.md`).
> Fecha: **2026-08-28**.

## Estado

Las **34 tareas** de `tasks.md` están `[x]` (T0, bloques 1-6 y bloque 7 completo). T7.3, T7.4 y T7.5 son
este archivo y el gate.

**SIN MIGRACIÓN, confirmado.** `git status --porcelain db/` sale vacío: no se tocó
`db/schema.prisma` ni se añadió nada a `db/migrations/`. Los subagentes lo confirmaron por
separado y la guardia T7.2 lo vigila como **propiedad del esquema**, no como diff de rama (una
guardia que mide el diff caduca al mergear — lección ya pagada en este repo).

---

## T0 — Volumen real de las dos tablas (2026-08-28)

Base **local** `postgresql://localhost:5432/ordenex` (PostgreSQL 16.1), cliente `pg`, cuatro
`SELECT`, ninguna escritura. El SQL exacto está en `progress/impl_318_T0.md`.

| # | Qué | Valor |
| --- | --- | --- |
| 1 | Filas de `chat_conversacion` | **7** |
| 2 | Filas de `chat_mensaje` | **41** |
| 3 | Grupos `(orden_id, mensajero_id)` — la unidad del hilo (R42) | **5** |
| 4 | Grupos que fusionan **más de un teléfono** (R43) | **2** (40 %) |

Contexto: mensajes por grupo máx. **14**, media **8,20**.

**Límite declarado:** es la base **local de desarrollo**. `.env` no trae connection string de
Supabase (`DIRECT_URL` vacía), así que estos números **no son el volumen de producción** y no
deben citarse como tal. Lo que sí sostienen es la decisión (b) de T0: la fusión de teléfonos es
el caso **normal**, no una frontera exótica, y por eso T3.2 la siembra. El `limite` por defecto
del listado se queda en **25** (design §2.2): no hay señal para moverlo.

---

## Archivos

### Creados

**Backend / dominio**
- `lib/types/historico-conversaciones.ts` — DTOs + zod `.strict()` de las dos entradas.
- `lib/interfaces/repositories/IHistoricoConversacionesRepository.ts`
- `lib/interfaces/services/IHistoricoConversacionesService.ts`
- `lib/repositories/HistoricoConversacionesRepository.ts`
- `lib/services/HistoricoConversacionesService.ts`
- `lib/actions/historico-conversaciones.ts`
- `lib/utils/busqueda-texto-sql.ts` — espejo SQL de `normalizarTerminoBusqueda`.
- `lib/utils/separador-dia-cr.ts` — «hoy» / «ayer» / día largo sin año.

**Ruta y UI**
- `app/(app)/historico/conversaciones/page.tsx` — gate de rol server-side.
- `app/(app)/historico/conversaciones/_components/HistoricoConversacionesModule.tsx`
- `app/(app)/historico/conversaciones/_components/HistoricoFiltrosBar.tsx`
- `app/(app)/historico/conversaciones/_components/HilosLista.tsx`
- `app/(app)/historico/conversaciones/_components/HistoricoHilo.tsx`
- `app/(app)/historico/conversaciones/_components/historico-filtros-def.ts`
- `app/(app)/historico/conversaciones/_components/seleccion-a-filtro.ts`

**Tests**
- `tests/unit/auth/menu-historico.test.ts`
- `tests/unit/guards/historico-roles-una-sola-fuente.guardia.test.ts`
- `tests/unit/guards/historico-sin-migracion.guardia.test.ts`
- `tests/unit/types/historico-conversaciones-schema.test.ts`
- `tests/unit/utils/separador-dia-cr.test.ts`
- `tests/unit/services/historico-conversaciones-service.test.ts`
- `tests/unit/components/historico-filtros-def.test.ts`
- `tests/unit/components/historico-seleccion-a-filtro.test.ts`
- `tests/integration/db/busqueda-texto-sql-paridad.test.ts`
- `tests/integration/repositories/historico-conversaciones.int.test.ts`
- `tests/integration/repositories/chat-media-historico.int.test.ts`
- `tests/integration/actions/historico-conversaciones-action.test.ts`
- `tests/integration/api/chat-media-historico.test.ts`
- `tests/components/HistoricoConversacionesPage.test.tsx`
- `tests/components/HistoricoFiltros.test.tsx`
- `tests/components/HistoricoFechaDiferenciada.test.tsx`
- `tests/components/HistoricoHilosLista.test.tsx`
- `tests/components/HistoricoHilo.test.tsx`
- `tests/components/HistoricoMediaExpirada.test.tsx`
- `tests/components/HistoricoSoloLectura.test.tsx`
- `tests/components/_historico-harness.tsx`
- `progress/impl_318_T0.md`

### Modificados

- `lib/auth/menu-visibility.ts` — constante `ROLES_HISTORICO_CONVERSACIONES`, `IconKey` `"history"`,
  ítem «Histórico» + subítem «Conversaciones» en la **última** posición (R9).
- `app/(app)/_components/Sidebar.tsx` — `history: History` en `ICON_BY_KEY`, que pasa a exportarse.
- `lib/interfaces/repositories/IChatMensajeRepository.ts` — contrato **aparte**
  `IChatMediaHistoricoReader`.
- `lib/repositories/ChatMensajeRepository.ts` — método nuevo `findMediaParaLectorHistorico`.
  `findMediaParaMensajero` y `findByOrdenParaMensajero` quedan **byte a byte iguales** (R26).
- `app/api/chat/media/[mensajeId]/route.ts` — bifurcación por rol; misma URL, mismas cabeceras,
  misma política de caché privada.
- `tests/unit/auth/menu-visibility.test.ts`, `tests/components/Sidebar.test.tsx` — censos de menú
  que el ítem nuevo enrojeció (cable trampa funcionando).
- `tests/unit/guards/busqueda-texto-solo-lectura.test.ts`,
  `tests/unit/guards/pwa-manifiesto-atajos.guardia.test.ts` — ver «Gate».
- `specs/318-historico-conversaciones/tasks.md` — casillas.

---

## T7.3 — Mapa `R<n> → test`

| R | Archivo de test | `it(...)` |
| --- | --- | --- |
| R1 | `tests/unit/auth/menu-historico.test.ts` | «contiene exactamente admin y maestro» |
| R1 (P4) | `tests/unit/guards/historico-roles-una-sola-fuente.guardia.test.ts` | «rol X NO está en ROLES_HISTORICO_CONVERSACIONES» · «y el contenido es exactamente admin + maestro» |
| R2 | `tests/unit/auth/menu-historico.test.ts` | «R2: el `roles` del ítem es LA MISMA REFERENCIA que la constante, no un literal copiado» |
| R3 | `tests/unit/auth/menu-historico.test.ts` | «R3: tiene exactamente un subítem «Conversaciones» que apunta a la ruta del histórico» · «R3: el subítem NO declara `roles` propios» |
| R4 | `tests/unit/auth/menu-historico.test.ts` | «R4: sólo lo ven los roles de la whitelist; ningún otro rol lo recibe» |
| R5 | `tests/unit/auth/menu-historico.test.ts` | «R5: sin actor resuelto, el ítem no se muestra» |
| R6 | `tests/unit/auth/menu-historico.test.ts` | «ningún ítem del menú exporta un componente de icono: `iconKey` es siempre string» · «`ICON_BY_KEY` del Sidebar resuelve la clave de TODOS los ítems, incluida `history`» |
| R6 | `tests/components/Sidebar.test.tsx` | «R6: el ítem «Histórico» monta un svg — su `iconKey` resuelve en ICON_BY_KEY» · «R6: el icono del histórico es PROPIO y no lo comparte con ningún otro ítem del menú» |
| R7 | `tests/components/HistoricoConversacionesPage.test.tsx` | «rol X: lanza notFound() y NO consulta dato alguno» · «sesión ausente: lanza notFound() y NO consulta dato alguno» · «rol permitido: no lanza y sí carga el catálogo de la barra de filtros» |
| R7 (service) | `tests/unit/services/historico-conversaciones-service.test.ts` | «R7/R10: el rol %s recibe forbidden y el repositorio NO se llama» |
| R8 | `tests/unit/guards/historico-roles-una-sola-fuente.guardia.test.ts` | «la página no escribe NINGÚN literal de rol y sí nombra la constante» + CONTRAPRUEBAS (a) (b) (c) |
| R9 | `tests/unit/auth/menu-historico.test.ts` | «cada rol sigue aterrizando en su destino de siempre» |
| R10 | `tests/integration/repositories/historico-conversaciones.int.test.ts` | «R10: lista los hilos de TODOS los mensajeros, sin scope de mensajero de sesion» |
| R10 | `tests/unit/services/historico-conversaciones-service.test.ts` | «R10: el rol %s ve hilos de mensajeros que no son el» |
| R11 | `tests/integration/repositories/historico-conversaciones.int.test.ts` | «R11: cada fila identifica orden, destinatario, mensajero y ultima actividad» |
| R11 | `tests/components/HistoricoHilosLista.test.tsx` | «muestra guía, destinatario y mensajero de cada hilo» · «sin número de guía, la fila se identifica por la remisión» |
| R12 | `tests/integration/repositories/historico-conversaciones.int.test.ts` | «R12: el hilo de una orden borrada logicamente no aparece» |
| R12 | `tests/integration/repositories/chat-media-historico.int.test.ts` | «R12: no devuelve nada si la orden esta borrada logicamente» |
| R13 | `tests/integration/repositories/historico-conversaciones.int.test.ts` | «R13: la consulta del listado NO usa OFFSET» · «R13: pagina de N hilos y recorrido completo sin repetir» |
| R13 | `tests/components/HistoricoHilosLista.test.tsx` | «al entrar el centinela en vista pide la SIGUIENTE página con el cursor devuelto» · «sin cursor devuelto, el centinela NO vuelve a pedir» · «un hilo repetido entre páginas se pinta UNA sola vez» |
| R14 | `tests/integration/repositories/historico-conversaciones.int.test.ts` | «R14: ordena por ultima actividad descendente, con (orden, mensajero) de desempate» |
| R15 | `tests/integration/repositories/historico-conversaciones.int.test.ts` | «R15: tres hilos con la MISMA ultima actividad salen una sola vez cada uno» |
| R16 | `tests/integration/repositories/historico-conversaciones.int.test.ts` | «R16: la pagina trae las dos direcciones» |
| R16 | `tests/components/HistoricoHilo.test.tsx` | «pinta entrantes y salientes entrelazados, en el orden devuelto» |
| R17 | `tests/integration/repositories/historico-conversaciones.int.test.ts` | «R17: el hilo abierto se lee COMPLETO aunque abarque dos meses» |
| R17 (borde) | `tests/unit/services/historico-conversaciones-service.test.ts` | «R17: la entrada del hilo NO admite claves de fecha (el .strict() las rechaza)» · «R17: un fecha_desde colado en la entrada del hilo es validation_error, no se ignora» |
| R17 (pantalla) | `tests/components/HistoricoFechaDiferenciada.test.tsx` | «(c) el hilo abierto con rango aplicado sigue mostrando mensajes FUERA del rango (R17)» |
| R18 | `tests/integration/repositories/historico-conversaciones.int.test.ts` | «R18: el hilo no se carga de golpe: una pagina de tamaño fijo» |
| R18 | `tests/components/HistoricoHilo.test.tsx` | «pide UNA sola página y pinta 30 burbujas, no las 100 del hilo» |
| R19 | `tests/integration/repositories/historico-conversaciones.int.test.ts` | «R19: la consulta del hilo NO usa OFFSET y corta por (ocurrido_at, id)» |
| R20 | `tests/integration/repositories/historico-conversaciones.int.test.ts` | «R20: cinco mensajes con el MISMO ocurrido_at se recorren una sola vez cada uno» |
| R21 | `tests/integration/repositories/historico-conversaciones.int.test.ts` | «R21: se aterriza en lo mas reciente y la pagina siguiente es la inmediatamente anterior» |
| R21 | `tests/components/HistoricoHilo.test.tsx` | «el mensaje MÁS RECIENTE está en el DOM en el primer render» |
| R22 | `tests/components/HistoricoHilo.test.tsx` | «conserva la posición de lectura: `scrollTop` se corrige con lo que creció el contenido» |
| R23 | `tests/unit/utils/separador-dia-cr.test.ts` | «devuelve «hoy» para un mensaje de la fecha calendario CR en curso» · «devuelve «ayer» para un mensaje del dia calendario CR anterior» · «devuelve el dia largo para cualquier otro dia» · «un dia de OTRO año se rotula igual, sin año» · «ninguna etiqueta contiene cuatro digitos seguidos» · «a las 22:00 CR, un mensaje de las 21:00 CR del mismo dia es «hoy»» · «un mensaje de las 23:00 CR se rotula con el dia CR, no con el dia UTC» |
| R23 | `tests/components/HistoricoHilo.test.tsx` | «dice «hoy», «ayer» y el día largo, y cada uno UNA sola vez» · «el separador NUNCA lleva año» |
| R24 | `tests/components/HistoricoSoloLectura.test.tsx` | «con el hilo cargado no hay campo de redacción» · «no hay botón de enviar» · «no hay botón de adjuntar» · «no hay grupo de plantillas» · «no hay forma de reaccionar a un mensaje» · «la pantalla no monta ningún formulario» |
| R25 | `tests/unit/services/historico-conversaciones-service.test.ts` | «ejecuta las DOS operaciones sin escribir en ninguna tabla» · «el cliente Prisma que el repositorio admite NO expone metodos de escritura» |
| R25 (pantalla) | `tests/components/HistoricoSoloLectura.test.tsx` | «tras abrir y recorrer el hilo, los cuatro dobles siguen sin llamarse» |
| R26 | `tests/integration/repositories/chat-media-historico.int.test.ts` | «R26: el MISMO mensaje sigue sin salir por la via del mensajero para un tercero» |
| R26 | `tests/integration/api/chat-media-historico.test.ts` | «el mensajero ASIGNADO sigue recibiendo 200 por su via de siempre» · «sin sesion sigue siendo 401, sin consultar ninguna de las dos vias» · «un doble que solo declara la via del mensajero falla CERRADO para el histórico» |
| R26 (no-regresión) | `vitest related` sobre `ChatConversacionRepository.ts` + `ChatMensajeRepository.ts` | 31 archivos / 430 tests verdes, ningún test existente modificado (salida abajo) |
| R27 | `tests/unit/guards/historico-sin-migracion.guardia.test.ts` | «ninguna carpeta de db/migrations/ corresponde al histórico de conversaciones» · «el indice [conversacionId, ocurridoAt] sigue existiendo» · «chat_conversacion sigue keyeada por (orden, telefono)» · «el esquema NO gana ningun modelo ni columna propios del histórico» |
| R28 | `tests/integration/repositories/historico-conversaciones.int.test.ts` | «R28: las reacciones se anclan a su burbuja y NUNCA son burbuja propia» |
| R28 | `tests/components/HistoricoHilo.test.tsx` | «el emoji va en la burbuja de su mensaje y no hay burbuja de reacción» |
| R29 | `tests/integration/repositories/chat-media-historico.int.test.ts` | «R29: devuelve el adjunto de un mensaje de una orden asignada a OTRO mensajero» |
| R29 | `tests/integration/api/chat-media-historico.test.ts` | «actor maestro / actor admin que NO es el mensajero de la orden recibe 200 con su Content-Type» · «la ruta NO cambia de politica de cache: el binario sigue siendo privado» |
| R30 | `tests/integration/api/chat-media-historico.test.ts` | «actor adminSatelite / adminTienda / mensajero que no es el mensajero asignado recibe 403 sin llamar a la Graph API» · «apiKey tampoco entra por la via del histórico» |
| R31 | `tests/components/HistoricoMediaExpirada.test.tsx` | «pinta el aviso en su burbuja y el RESTO del hilo sigue renderizado» · «ofrece reintentar la descarga del adjunto caducado» |
| R31 | `tests/integration/api/chat-media-historico.test.ts` | «410 cuando Meta ya no tiene el binario, tambien para el lector del histórico (R31)» |
| R32 | `tests/unit/components/historico-filtros-def.test.ts` | «declara las cuatro claves, en orden y con el `kind` que le toca a cada una» · «es PURA» |
| R32 | `tests/unit/components/historico-seleccion-a-filtro.test.ts` | «mensajero_id vacío produce el filtro VACIO» · «toda clave desconocida se descarta» |
| R32 | `tests/components/HistoricoFiltros.test.tsx` | «monta el campo de búsqueda de BuscadorFiltros, con su nombre accesible y su placeholder» · «el selector «Filtros» ofrece Mensajero, Fecha y Orden en un listbox» |
| R33 | `tests/integration/repositories/historico-conversaciones.int.test.ts` | «R33: con mensajeros seleccionados solo salen sus hilos» |
| R33 | `tests/unit/components/historico-filtros-def.test.ts` · `tests/components/HistoricoFiltros.test.tsx` | «con dos mensajeros en el catalogo, los lista como opciones» · «con catalogo VACIO la barra se declara igual, con options vacías y sin reventar» · «el control de mensajero se monta con las opciones del catálogo pre-cargado (R33)» |
| R34 | `tests/integration/repositories/historico-conversaciones.int.test.ts` | «R34: el rango de fechas usa el dia calendario CR (mata el uso de startOfDayCR)» |
| R34 | `tests/unit/components/historico-seleccion-a-filtro.test.ts` | «el atajo 7d se resuelve a su rango» · «sin atajo, viaja el rango tal cual, en YYYY-MM-DD y sin hora» |
| R35 | `tests/integration/repositories/historico-conversaciones.int.test.ts` | «R35: el filtro por orden es IGUALDAD exacta, nunca coincidencia parcial» |
| R35 | `tests/unit/components/historico-seleccion-a-filtro.test.ts` | «orden 1001 emite la cadena, no la lista» |
| R36 | `tests/integration/repositories/historico-conversaciones.int.test.ts` | «R36: la busqueda libre encuentra por destinatario, guia, remision y nombre del mensajero» · «R36: un termino que no casa nada devuelve la lista vacia» |
| R36 (paridad) | `tests/integration/db/busqueda-texto-sql-paridad.test.ts` | «produce EXACTAMENTE el mismo texto que normalizarTerminoBusqueda en cada caso del corpus» · «la expresion transforma de verdad: acentos, caja y espacios cambian respecto al original» · «acepta una expresion compuesta (el nombre completo del mensajero) y no solo una columna» |
| R37 | `tests/unit/components/historico-filtros-def.test.ts` | «minChars del buscador ES BUSQUEDA_MIN_CHARS, no un 3 escrito a mano» |
| R37 | `tests/components/HistoricoFiltros.test.tsx` | «con «ma» NO emite el término y avisa de cuántos caracteres faltan» · «con «mar» emite el término tras el debounce» |
| R38 | `tests/unit/types/historico-conversaciones-schema.test.ts` | 28 casos, entre ellos «RECHAZA mensajero_id vacío (lista vacia)», «RECHAZA una fecha que no es YYYY-MM-DD», «RECHAZA limite 0», «RECHAZA limite 999 (por encima del maximo del listado)», «RECHAZA un cursor incompleto (solo ordenId)», «RECHAZA ordenId sin mensajeroId», «RECHAZA una clave desconocida en el nivel superior (.strict())» |
| R38 | `tests/integration/actions/historico-conversaciones-action.test.ts` | «R38 (listado): %s -> validation_error sin consultar» (10 casos) · «R38 (hilo): %s -> validation_error sin consultar» (6 casos) |
| R38 | `tests/unit/services/historico-conversaciones-service.test.ts` | «R38: una entrada invalida es validation_error y el repositorio NO se llama» |
| R39 | `tests/components/HistoricoFechaDiferenciada.test.tsx` | «(a) con rango aplicado y un hilo abierto, avisa» · «(b) sin rango aplicado, no avisa» · «el texto del aviso es el del spec» · «el rango SÍ recorta el listado» |
| R40 | `tests/integration/repositories/historico-conversaciones.int.test.ts` | «R40: entrantes y salientes van entrelazados por tiempo, no agrupados por direccion» |
| R40 | `tests/components/HistoricoHilo.test.tsx` | «no hay pestañas ni secciones por dirección (R40)» |
| R41 | `tests/unit/types/historico-conversaciones-schema.test.ts` | «el TIPO del listado no declara ningun campo de mensajes» · «un DTO completo del listado no tiene la clave mensajes» |
| R41 | `tests/unit/services/historico-conversaciones-service.test.ts` | «R41: el listado no devuelve mensajes ni provoca la consulta del hilo» |
| R41 | `tests/components/HistoricoHilosLista.test.tsx` | «con el listado en pantalla y ningún hilo abierto, no se pide ni un mensaje» · «al hacer clic en una fila se pide UNA vez la página de mensajes de ese par» |
| R42 | `tests/integration/repositories/historico-conversaciones.int.test.ts` | «R42: dos filas de chat_conversacion del mismo (orden, mensajero) son UN hilo» · «R42: la fusion entrelaza ambas filas por (ocurrido_at, id), sin reordenar» |
| R43 | `tests/integration/repositories/historico-conversaciones.int.test.ts` | «R43: la cabecera del hilo fusionado cuenta los numeros y muestra el VIGENTE» |
| R43 | `tests/components/HistoricoHilosLista.test.tsx` · `tests/components/HistoricoHilo.test.tsx` | «un hilo con dos números muestra el distintivo «2 números» y el número vigente enmascarado» · «un hilo con un solo número NO muestra el distintivo» · «rotula orden, destinatario y mensajero, y avisa de los dos números» · «el cambio de número se lee dentro del hilo, como burbuja de sistema» |
| R44 | `tests/integration/repositories/historico-conversaciones.int.test.ts` | «R44: dos mensajeros de la misma orden son DOS filas, no un duplicado» |
| R44 | `tests/components/HistoricoHilosLista.test.tsx` | «no se deduplican: cada fila lleva el nombre de su mensajero» |
| R45 | `tests/integration/repositories/historico-conversaciones.int.test.ts` | «R45 LIMITACIÓN CONOCIDA: tras una reasignacion el hilo entero queda atribuido al mensajero ACTUAL» |
| R45 | `tests/unit/guards/historico-sin-migracion.guardia.test.ts` | «chat_mensaje NO tiene columna de mensajero» · «CONTRAPRUEBA: chat_conversacion SI la tiene, y por eso el recorte importa» |

**Los 45 requisitos tienen test.** Ninguna casilla vacía.

---

## T7.5 — Deuda y límites declarados

**(a) Promoción pendiente de las burbujas del chat a `components/shared/chat/` (alternativa A1).**
Las burbujas (`BurbujaContenido`, `BurbujaSistema`, `MediaAdjunto`, `Reacciones`,
`TarjetaContacto`, `TextoConEnlaces`, `chat-format.ts`) siguen en
`app/(app)/mis-asignaciones/_components/chat/` y el histórico las importa cruzado.
`docs/architecture.md` pide promoverlas; coste medido: **14 archivos ajenos** — 13 de test
(`ChatBurbujaMedia`, `NotaVoz`, `ComposerAdjunto`, `TextoConEnlaces`, `TarjetaContacto`,
`Reacciones`, `ConversacionTono`, `BurbujaSistema`, `ConversacionPlantillaDiaria`,
`BurbujaContenido`, `NoLeidos`, `chat-plantilla-nombre`) más `ChatConversacion.tsx`. Meterlos aquí
sería mezclar un refactor con una feature de lectura. **Deuda declarada, con su PR propio.**

**(b) Límite de atribución tras una reasignación (R45 / A10).** `upsertParaOrden`
(`lib/repositories/ChatConversacionRepository.ts:110-132`) **reescribe** `mensajero_id` sobre la
única fila `(orden, teléfono)`, y `chat_mensaje` no guarda quién era el mensajero de cada mensaje
(`db/schema.prisma:322-373`). Consecuencia **fijada por test**: una orden reasignada cuyo cliente
conserva el número sale como **un** hilo, atribuido al mensajero **actual**, con los mensajes de
ambos. Levantarlo exigiría una **columna `mensajero_id` en `chat_mensaje`** — es decir, una
**migración**, prohibida aquí por decisión humana (R27). No es un bug a arreglar de tapadillo: se
reabre **con el humano** en su propia feature. La guardia T7.2 se pone roja si alguien añade esa
columna, justo para forzar esa conversación.

**(c) La purga del histórico es un cron futuro (P9).** No hay límite de antigüedad ni retención: el
humano decidió que **un cron futuro limpiará el exceso**, y ese cron es **otra feature**.
Consecuencia aceptada: la media de más de 30 días saldrá como «ya no está disponible» (R31), y eso
**no es un fallo**.

---

## Desviaciones de la letra del spec (para el reviewer)

1. **`EXISTS` del filtro de fecha, de GRUPO y no de fila.** `design.md` §2.4 lo escribe
   correlacionado por `m2.conversacion_id = c.id`. Con esa forma, un hilo fusionado de dos números
   del que sólo uno tuviera mensajes en el rango perdería la otra fila **antes** del `GROUP BY`, y
   `totalMensajes`, `telefonosCount` y `telefonoVigenteMasked` saldrían calculados sobre medio hilo,
   rompiendo R42/R43 justo en el caso que existen para cubrir. Se implementó correlacionado por
   `(c.orden_id, c.mensajero_id)`. La **selección** sigue siendo la de R34.
2. **La página del hilo excluye en SQL las filas `tipo = reaccion`.** Sin ello las reacciones
   ocuparían huecos de la ventana y moverían el cursor. Se traen en la segunda consulta acotada que
   pide design §2.3, que cubre las de otra fila del grupo y las de fuera de la ventana (R28).
3. **T3.5 pide `res.mensajes.find(m => m.waMessageId === W)`, y `ChatMensajeVista` no expone
   `waMessageId`** (el id de Meta no cruza a la UI, R21 de la 311). El test hace el mismo assert
   buscando por el **id interno** del mismo mensaje, y lo documenta. No se ensanchó el DTO del chat
   del mensajero por una feature de lectura.
4. **`findMediaParaLectorHistorico` va en un contrato aparte** (`IChatMediaHistoricoReader`) y no en
   `IChatMensajeRepository`: meterlo como obligatorio rompía el typecheck de dos tests existentes
   que construyen dobles completos de esa interfaz, y modificarlos habría contaminado la
   no-regresión de T4.3. Va en la dirección de A2: dos autorizaciones distintas, ahora también dos
   tipos distintos. `ChatMediaRouteDeps` completa la vía ausente con `null` — **fallo cerrado
   (403), nunca abierto**, con test propio.
5. **`ultimosNDiasCalendarioCR` se importa de `lib/utils/fecha-cr.ts`**, su casa real, porque
   `ordenes-filtros-def.ts` no lo reexporta. Sigue importado, no reescrito.
6. **`separadorDia` arma la etiqueta con `formatToParts`** y no con `format()`: en este Node/ICU,
   `es-CR` emite «miércoles, 26 de agosto» **con coma**. Efecto lateral bueno: es estructuralmente
   imposible que se cuele el año.
7. **`lib/utils/fecha-cr.ts` no exporta `ayerCalendarioCR`** (design §5.5 lo daba por existente): se
   resolvió con un helper privado, sin modificar un módulo de uso general.
8. **`seleccion-a-filtro.ts` descarta claves desconocidas**, a diferencia del de `/ordenes`: el
   esquema del histórico es `.strict()` y una clave suelta sería `validation_error`, no ruido.

---

## T7.4 — Gate

### El modo rápido SE NEGÓ, y no por culpa del alcance

```
== Arnes SDD :: init (modo: rapido) ==
Tu cambio toca cimientos, y para eso el modo rapido no alcanza:
    lib/types/historico-conversaciones.ts
✗ esto exige el gate completo. Corre: ./init.sh
```

`init.sh` lista `^lib/types/` entre las `RUTAS_SENSIBLES` (`init.sh:134`), y **el propio spec pone
ahí el archivo de DTOs**: `design.md` §2.1 y `tasks.md` T2.1 lo nombran
`lib/types/historico-conversaciones.ts`. Es una **contradicción del spec consigo mismo** —§7 de
`design.md` y T7.4 afirman que el diff no toca `lib/types/**`—, **no** una señal de que el alcance
creciera: el diff no toca `db/`, ni `middleware.ts`, ni configuración de build, ni nombres de
dinero. Se corrió el **gate completo**, que es un superconjunto estricto del rápido. Queda
anotado para que el reviewer decida si el spec debe corregir §7/T7.4 o si el DTO debe colocarse
junto a su módulo (`docs/conventions.md` admite las dos ubicaciones).

### `./init.sh` completo — VERDE

```
== Arnes SDD :: init (modo: completo) ==
✓ node v22.13.1
✓ dependencias presentes
✓ feature_list.json: sin ids duplicados (315 fichas), cupo por zona respetado (in_progress=1)
✓ typecheck paso
✓ lint paso        (0 errores; sólo warnings preexistentes y ajenos)

 Test Files  3 failed | 1529 passed (1532)
      Tests  3 failed | 21224 passed | 26 skipped (21253)
   Duration  879.35s

✓ tests: sin rojos nuevos (3 archivo(s) rojo(s), todos en el baseline conocido)
! migraciones sin down.sql: 20260814120000_ruta_optimizada_trazado 20260814140000_ruta_parada_tramo 20260814160000_ruta_tramo_vivo_at
✓ .env presente
== init OK ==
```

**1.532 archivos de test: la suite corrió entera** (no degradada; el conteo descarta la corrida con
«unhandled errors» de workers que reporta de menos).

### Los 3 rojos y por qué NO son de esta rama

| Archivo | Fallo | Veredicto |
| --- | --- | --- |
| `tests/unit/guards/superficie-de-uso.guardia.test.ts` | `lib/actions/tarifas.ts:67 obtenerTarifa` sin superficie | **Ajeno**, en `tests/baseline-rojos.json` («ficha 274, cascada de tarifas»). Relevante: **`lib/actions/historico-conversaciones.ts` NO aparece** en el hallazgo, o sea que las dos Server Actions nuevas sí tienen superficie alcanzable. |
| `tests/unit/services/usuario-descarga.test.ts` | claves de `UsuarioListItem` (285/T-S4, R27 de esa ficha) | **Ajeno**, en el baseline. |
| `tests/integration/db/usuarios-filtro-busqueda.test.ts` | mismo motivo, contra Postgres real | **Ajeno**, en el baseline. |

**No se añadió ni una línea a `tests/baseline-rojos.json`.**

### La primera corrida SÍ salió roja, y aquí está lo que pasó

El gate se corrió **dos veces**. La primera dio **5 rojos nuevos**. Desglose honesto:

| Archivo | Causa | Qué se hizo |
| --- | --- | --- |
| `tests/unit/guards/busqueda-texto-solo-lectura.test.ts` | **MÍO.** `HistoricoConversacionesRepository` nombra `orden.busqueda_texto` en el `WHERE` de R36 | La guardia tenía lista blanca `PERMITIDOS` y distinguía lectura de escritura, pero **clavada a un único archivo** (`m.archivo === "lib/repositories/OrdenRepository.ts"`). Se añadió el repositorio nuevo **con su motivo** (lector, jamás escritor: `LIKE` en SQL parametrizado, ni `select:` ni escritura), se derivó `REPOSITORIOS_PERMITIDOS` **de** `PERMITIDOS` y el caso de solo-lectura ahora **itera** todos los repositorios permitidos exigiendo que cada uno mencione la columna de verdad. **La guardia quedó más fuerte, no más laxa.** |
| `tests/unit/guards/pwa-manifiesto-atajos.guardia.test.ts` | **MÍO.** Censo de destinos por rol: `maestro 16→17`, `admin 11→12` | Es exactamente el subítem `/historico/conversaciones` (el padre no suma: tiene `children`). Se actualizaron los dos números **con el motivo escrito al lado**; `adminSatelite: 6`, `adminTienda: 3` y `mensajero: 6` **no se movieron** y siguen asertados, la intersección sigue vacía y la conclusión de la guardia —cero atajos— no cambia. |
| `tests/unit/guards/no-embalaje.test.ts` | Timeout 20 s | **Flake de saturación.** Verde en aislado. |
| `tests/components/DetalleMensajeroPanel.test.tsx` | Timeout 20 s | **Flake de saturación.** Verde en aislado. |
| `tests/integration/wallet-tiendas-desglose.test.tsx` | Timeout 20 s | **Flake de saturación.** Verde en aislado. |

Comprobación de los tres flakes, en aislado y en la misma sesión:

```
pnpm exec vitest run tests/unit/guards/no-embalaje.test.ts \
  tests/components/DetalleMensajeroPanel.test.tsx \
  tests/integration/wallet-tiendas-desglose.test.tsx

 Test Files  3 passed (3)
      Tests  60 passed (60)
   Duration  16.39s
```

Ninguno de los tres entró al baseline: pasan solos y **no son deuda de nadie**.

### T4.3 — no-regresión de la autorización del mensajero (R26)

```
pnpm exec vitest related --run lib/repositories/ChatConversacionRepository.ts \
                               lib/repositories/ChatMensajeRepository.ts

 Test Files  31 passed (31)
      Tests  430 passed (430)
   Duration  34.66s
```

Baseline antes del ensanche: **29 archivos / 415 tests**. El delta (+2 archivos, +15 tests) son
**exactamente** los tests nuevos de la feature. **Ningún archivo de test existente fue modificado**,
y `findMediaParaMensajero` / `findByOrdenParaMensajero` están **byte a byte iguales**.

### T7.1 — guardia de la 229

`tests/unit/guards/rastreo-sin-ruta-nueva.guardia.test.ts` **verde sin haberla tocado**, y sin tocar
`middleware.ts` ni la lista firmada de `PUBLIC_ROUTES`. Confirmado en dos corridas independientes y
en el gate completo. Es lo que `design.md` §3.4 predecía: `historico` no es un segmento `rastreo`,
no importa `rastreo-publico` y no toca las tres listas del middleware.

---

## Drift de sesión paralela (NO es de esta feature)

Durante la implementación aparecieron en el árbol de trabajo SIETE archivos modificados que **ningún
subagente de la 318 tocó** y que no tienen nada que ver con el histórico:

- `app/(app)/configuracion/plantillas/_components/EditarPlantillaForm.tsx`
- `app/(app)/configuracion/plantillas/_components/PlantillaTiendaField.tsx`
- `app/(app)/configuracion/plantillas/_components/plantillas-columns.tsx`
- `components/ui/switch.tsx`
- `lib/services/PlantillaMensajeService.ts`
- `tests/components/PlantillaTiendaUI.test.tsx`
- `tests/unit/plantillas/plantilla-tienda.test.ts`

(la tanda entera va de «plantilla de tienda»: `disabled` en el interruptor y una constante
`AYUDA_PLANTILLA_TIENDA_FIJA`). Son de **otra sesión**, precedente conocido en este repo. Se dejaron
intactos. **Que el leader no los meta en el commit de la 318.**

También siguen en la raíz, sin rastrear y de antes de empezar, `tmp-diag.mjs`, `tmp-diag2.mjs`,
`tmp-diag3.mjs` y `tmp-diag4.mjs`.

---

## Veredicto

Implementación completa: **45/45 requisitos con test de comportamiento**, gate completo en verde
sin rojos nuevos, **sin migración y sin tocar `db/schema.prisma`**, la autorización del mensajero
intacta y la pantalla estrictamente de solo lectura. **El implementer no se autoaprueba: decide el
reviewer.**
