# 409 — El panel de notificaciones avisa lo que hay que hacer y lleva a resolverlo

> Requisitos en EARS. Sin detalle de implementación (eso vive en `design.md`).
> El mapa `R<n> → test` está al final, en §12.
> **Preguntas abiertas: ninguna.** Las nueve que abrió el borrador las cerró el humano el
> 2026-09-10; las decisiones y sus mediciones están incorporadas al texto y anotadas en §13.

## Contexto medido (no es requisito, es el porqué)

Producción, 2026-09-10: **1.214 avisos emitidos y 26 de 39 personas no han abierto ninguno**.
Por rol: 1 de 5 tiendas, 1 de 4 admins, 4 de 10 adminSatelite, 8 de 18 mensajeros. Los dos roles
a los que más urge avisar son los que menos usan la campana.

Contrato visual aprobado: `design-notificaciones/Main.dc.html`, `Campana.dc.html`,
`PorRol.dc.html`. **Tres puntos del mockup los corrige el humano** y este spec sigue la corrección,
no el dibujo: el botón «Ver el diagnóstico» del aviso de mapas caídos (no existe esa pantalla), la
clasificación de «le cambiaron el día de reparto» como informativa, y el pie «Ver todas las
notificaciones» (no existe esa pantalla).

---

## §1 — Clasificación de los avisos (accionable vs. informativo) y atajo

**Definición normativa de ACCIONABLE**, de `PorRol.dc.html`: un aviso es accionable si y sólo si
**(a)** pide una acción, **(b)** tiene consecuencia si no se hace y **(c)** quien lo recibe puede
resolverla. Si falla una de las tres, es informativo. La clasificación es una propiedad
**declarada** del par (evento, rol destinatario), no una intuición del código que la pinta.

**Definición normativa de ATAJO**: un aviso lleva atajo si y sólo si existe **una pantalla de esta
app que ACERQUE a ESA persona a resolverlo** — el sitio donde empieza su acción real, ejecute ella
la transición o no. No basta con que la pantalla enseñe el problema: tiene que ser el insumo de lo
que esa persona va a hacer a continuación. Accionable y con-atajo son ejes independientes.

> Los dos casos límite, enfrentados, porque es la regla que decidirá los atajos futuros:
> **mapas caídos, sin botón** — la credencial se arregla en la consola del proveedor y ninguna
> pantalla de la app acerca nada: mirar la lista de direcciones sin ubicar no ayuda a arreglar la
> credencial. **Devoluciones represadas, con botón para el admin** — no es él quien mueve las
> órdenes, pero lo que hace es coordinar con la bodega, y para esa llamada necesita saber cuáles son
> y de qué bodega: la lista es el insumo de su acción, no un mirador.

- **R1** — El sistema DEBE declarar, para **cada** valor del enum `NotificacionEvento`, si el aviso
  es accionable o informativo. Un valor del enum sin declaración DEBE impedir la compilación.
- **R2** — DONDE un mismo evento llega a roles distintos con pelotas en tejados distintos, el
  sistema DEBE poder declarar clasificaciones y atajos distintos por rol destinatario.
- **R3** — El sistema DEBE declarar, para cada par (evento, rol destinatario) accionable, **el
  destino de su atajo o la ausencia explícita de atajo**.
- **R4** — SI un evento accionable no tiene ninguna pantalla de la app que **acerque** al rol
  destinatario a resolverlo, ENTONCES el sistema DEBE declararlo **sin atajo** y el panel NO DEBE
  pintar botón para él.
- **R5** — Todo destino de atajo declarado DEBE ser una ruta que existe en la app **y** que es
  visible para el rol al que se declara.
- **R6** — SI el destino de un atajo lleva un parámetro de consulta, ENTONCES la pantalla de destino
  DEBE leerlo; el sistema NO DEBE emitir parámetros que el destino ignore.
- **R7** — CUANDO el destinatario activa el atajo de un aviso que nombra una superficie concreta de
  una pantalla con pestañas, el sistema DEBE dejar abierta **esa** superficie.

## §2 — La campana cuenta lo que hay que hacer

- **R8** — El distintivo de la campana DEBE contar **exactamente** las notificaciones que cumplen
  las cinco condiciones: (a) visibles para el actor, (b) dentro de la ventana de consulta,
  (c) no descartadas por el actor, (d) su par (evento, rol del actor) está declarado accionable, y
  (e) si su evento es agregado, su cifra viva es mayor que cero.
- **R9** — El estado de LECTURA de una notificación NO DEBE intervenir en el conteo de R8.
- **R10** — MIENTRAS el conteo de R8 sea cero, el sistema NO DEBE pintar distintivo alguno.
- **R11** — MIENTRAS el conteo de R8 sea mayor que cero, el distintivo DEBE decir la cifra **con
  palabras**, en la forma «N por hacer».
- **R12** — SI el conteo de R8 supera el tope de presentación, ENTONCES el distintivo DEBE mostrar
  la forma abreviada y no la cifra exacta.
- **R13** — El nombre accesible del disparador de la campana DEBE decir cuántas cosas hay por
  hacer, y NO cuántas hay sin leer.
- **R14** — CUANDO el usuario pulsa «Marcar leídas», el sistema NO DEBE cambiar el conteo de R8.
- **R15** — CUANDO el usuario descarta un aviso accionable y vigente, el sistema DEBE bajar el
  conteo de R8 en uno, sin recargar la página.

## §3 — El panel

- **R16** — El panel DEBE separar los avisos en dos bloques, en este orden: primero los accionables
  bajo el encabezado «Requieren tu acción», después los informativos bajo «Para tu información».
- **R17** — CUANDO un aviso accionable se pinta, el sistema DEBE mostrar su título destacado, su
  línea de contexto cuando exista, su instante relativo y —si el par (evento, rol) declara
  atajo— un botón de acción con su etiqueta.
- **R18** — SI un aviso accionable no declara atajo, ENTONCES el sistema DEBE pintarlo en el bloque
  «Requieren tu acción» **sin** botón de acción.
- **R19** — El sistema NO DEBE pintar botón de acción en ningún aviso del bloque «Para tu
  información».
- **R20** — El sistema NO DEBE mostrar la palabra «Anexo:» en ningún elemento del panel.
- **R21** — CUANDO el usuario activa el botón de atajo de un aviso, el sistema DEBE navegar al
  destino declarado para ese par (evento, rol) y cerrar el panel.
- **R22** — El panel DEBE tener un ancho de contenido de 400 px, acotado por el ancho de la
  ventana en pantallas estrechas.
- **R23** — SI un bloque no tiene ningún aviso, ENTONCES el sistema NO DEBE pintar ni su encabezado
  ni su contenedor.
- **R24** — MIENTRAS el actor no tenga ninguna notificación visible, el panel DEBE conservar su
  estado vacío actual.
- **R25** — El panel DEBE ofrecer un control de filtro con dos opciones, «Requieren tu acción» (con
  la cifra de R8) y «Todas» (con el total del listado); la opción «Requieren tu acción» DEBE ocultar
  el bloque informativo.
- **R26** — El sistema DEBE conservar en ambos bloques el control de descartar un aviso.
- **R27** — Todo color del panel DEBE salir de los tokens semánticos que giran con el tema; el
  sistema NO DEBE introducir valores de color fijos, y todo control enfocable DEBE conservar el
  anillo de foco estándar del repo.
- **R28** — El sistema NO DEBE alterar el comportamiento vigente de: el refresco periódico, la
  revalidación al abrir el panel, «Marcar leídas», descartar, y el interruptor de sonido con sus
  nombres accesibles.
- **R29** — El panel NO DEBE ofrecer ningún control que lleve a una pantalla que no existe.

## §4 — El tono de aviso

- **R30** — CUANDO el conteo de R8 aumenta entre dos refrescos, el sistema DEBE emitir el tono de
  aviso; el sistema NO DEBE emitirlo por un aumento de las no leídas que no aumente ese conteo.

## §5 — El instante relativo

- **R31** — El instante relativo de cada aviso DEBE resolverse **en el servidor** y viajar al
  cliente ya resuelto como texto.
- **R32** — El componente de la campana NO DEBE leer el reloj del navegador para pintar el instante
  relativo.
- **R33** — El instante relativo DEBE expresarse en lenguaje natural con la granularidad del
  contrato visual («hace N min», «hace N h», «ayer», «hace N d»), y DEBE decir «ayer» sólo cuando
  el aviso cae en el día calendario de Costa Rica anterior al actual.

## §6 — El contrato de datos hacia el cliente

- **R34** — Los campos que el DTO de notificación gana DEBEN ser **aditivos**: ningún consumidor
  vigente del DTO puede dejar de compilar ni cambiar de comportamiento por este cambio.

## §7 — Aviso nuevo: novedades sin gestionar (tienda)

- **R35** — CUANDO corre la emisión diaria y una tienda tiene al menos una novedad sin gestionar,
  el sistema DEBE emitir **una sola** notificación dirigida a esa tienda, con el número de
  novedades dentro del texto.
- **R36** — El sistema NO DEBE emitir una notificación por orden para este aviso, cualquiera que
  sea el número de novedades.
- **R37** — El texto del aviso DEBE decir cuántos días lleva la novedad más antigua **contados
  desde que el paquete entró a bodega**.
- **R38** — Los días de R37 DEBEN derivarse del **mismo ancla** que usa el proceso que ejecuta el
  rechazo automático.
- **R39** — SI todas las novedades sin gestionar de la tienda vencen con el **mismo plazo**,
  ENTONCES el texto DEBE decir ese plazo, y el valor dicho DEBE ser el **mismo** que aplica el
  proceso que ejecuta el rechazo automático.
- **R40** — SI las novedades sin gestionar de la tienda **no** comparten plazo —porque hay causas
  con ventanas distintas, o porque alguna ya alcanzó el tope de intentos y se resolverá antes de
  su ventana—, ENTONCES el texto NO DEBE afirmar ningún plazo.
- **R41** — MIENTRAS una tienda siga teniendo al menos una novedad sin gestionar, el sistema DEBE
  emitirle este aviso **una vez por día calendario de Costa Rica** y no más de una.
- **R42** — SI dos o más tiendas tienen novedades sin gestionar el mismo día, ENTONCES **cada una**
  DEBE recibir su propio aviso ese día.
- **R43** — SI una tienda no tiene ninguna novedad sin gestionar, ENTONCES el sistema NO DEBE
  emitirle este aviso.
- **R44** — El texto de este aviso NO DEBE contener número de guía, remisión, dirección, teléfono,
  nombre de destinatario ni monto.

## §8 — Aviso nuevo: órdenes por devolver represadas

- **R45** — La población vigilada DEBEN ser las órdenes que esperan salir de una bodega satélite
  hacia la central y cuya antigüedad en ese estado supera el umbral de represamiento.
- **R46** — El sistema NO DEBE vigilar el estado de tránsito hacia la tienda.
- **R47** — CUANDO corre la emisión diaria y hay al menos una orden represada, el sistema DEBE
  emitir **una sola** notificación por ámbito y rol destinatario, con el número de órdenes dentro
  del texto.
- **R48** — El aviso dirigido al rol de bodega satélite DEBE estar acotado a su zona, y su número
  DEBE ser el de **su** zona.
- **R49** — El aviso dirigido a los roles de administración central DEBE cubrir el total, sin
  acotar por zona.
- **R50** — El texto del aviso DEBE decir cuántos días lleva en bodega la más antigua del ámbito
  que cubre.
- **R51** — MIENTRAS siga habiendo al menos una orden represada en un ámbito, el sistema DEBE
  emitir este aviso **una vez por día calendario de Costa Rica, por ámbito y por rol
  destinatario**, y no más de una.
- **R52** — SI un ámbito no tiene ninguna orden represada, ENTONCES el sistema NO DEBE emitir su
  aviso.
- **R53** — El umbral de represamiento DEBE resolverse por configuración y NO DEBE quedar escrito
  dentro de la lógica que lo aplica.
- **R54** — El texto de este aviso NO DEBE contener número de guía, remisión, dirección, teléfono,
  nombre de destinatario, nombre de tienda ni monto.

## §9 — Los avisos agregados se apagan solos

- **R55** — SI la cifra viva de un aviso agregado es cero, ENTONCES el sistema NO DEBE mostrarlo en
  el panel ni contarlo en el distintivo, **sin que nadie lo lea, lo marque ni lo descarte**.
- **R56** — SI la cifra viva de un aviso agregado vuelve a ser mayor que cero el mismo día, ENTONCES
  el sistema DEBE volver a mostrarlo y a contarlo, **sin crear una segunda notificación ese día**.
- **R57** — El número que el panel muestra para un aviso agregado DEBE ser la cifra **viva** en el
  instante de la consulta, no la del instante de la emisión, y DEBE estar acotada al ámbito del
  actor que consulta.
- **R58** — SI la resolución de la cifra viva falla, ENTONCES el sistema DEBE mostrar el aviso y
  seguir sirviendo el resto del listado (fallo hacia mostrar, nunca hacia una campana en blanco).

## §10 — La emisión diaria

- **R59** — SI la petición al endpoint de emisión diaria no trae el secreto correcto, o el secreto
  no está configurado, ENTONCES el sistema DEBE responder 401 **sin producir ningún efecto**.
- **R60** — SI la emisión del aviso de un destinatario falla, ENTONCES el sistema DEBE registrar el
  fallo con su contexto, continuar con los demás y terminar la corrida.
- **R61** — La respuesta del endpoint de emisión diaria DEBE llevar sólo conteos agregados y la
  fecha de la corrida; NO DEBE llevar identificadores de orden, de tienda, de zona ni de persona.
- **R62** — El emisor **real** de cada uno de los dos avisos nuevos DEBE estar inyectado en el
  punto de composición del proceso diario; el valor por defecto DEBE seguir siendo el emisor nulo.

## §11 — Datos y seguridad

- **R63** — La migración que amplía los enums DEBE ser reversible y su reversión NO DEBE eliminar
  valores añadidos por fichas anteriores.
- **R64** — El sistema NO DEBE modificar el predicado de visibilidad de notificaciones ni la
  autorización de ninguna de sus operaciones.
- **R65** — SI un actor sin sesión válida consulta el listado, ENTONCES el sistema DEBE seguir
  negando la lectura y la campana DEBE seguir degradando a «sin distintivo» sin romper la cabecera.
- **R66** — SI la pantalla de novedades recibe un valor de superficie desconocido en la URL,
  ENTONCES DEBE abrir su superficie por defecto y NO DEBE fallar.

---

## §12 — Fuera de alcance (declarado, no olvidado)

- El **push** al teléfono: es la ficha 410, que depende de ésta y reutiliza su catálogo.
- Traducir el motivo crudo de un rechazo automático en el detalle de un cierre: es la ficha 408.
- Un **filtro completo por URL** en `/ordenes` y `/novedades`. Esta ficha añade **sólo** el mínimo
  que R7 exige: fijar la pestaña de `/novedades`. Ver `design.md` §7.2.
- Vigilar el estado `por_devolver_a_tienda`: **no medido**. La tarea T7.5 lo mide en solo lectura
  antes de desplegar; si resultara represado, añadirlo es un ámbito más en el mismo emisor.

---

## §13 — Decisiones del humano incorporadas (2026-09-10)

| # | Decisión | Dónde vive en este spec |
| --- | --- | --- |
| Q1 | Umbral **3 días**, y el estado vigilado es **`por_devolver`**, no el de tránsito a la tienda. Medido en producción: `devolviendo_a_tienda` = 247 órdenes, 1,0 d de media, máx. 1,3 d, **0 por encima de 3 d** (fluye); `por_devolver` = 27 órdenes, 2,4 d de media, máx. **8,2 d**, **7 por encima de 3 d** | R45, R46, R53 · `design.md` §4.1 |
| Q2 | Emisión a las **07:00 CR = 13:00 UTC** | `design.md` §4.4 |
| Q3 | El `adminSatelite` **sí** recibe su aviso de represadas, acotado a su zona | R48, R51 |
| Q3b | **Afinado el 2026-09-10, tras verificar `EnvioDevolucionCentralService` (`ROL_AUTORIZADO = "adminSatelite"`):** el criterio del atajo NO es «¿puede ejecutar la transición?» sino **«¿le acerca esta pantalla a resolverlo?»**. El aviso de represadas **sí lleva botón** para maestro y admin, a `/ordenes`: la lista es el insumo de la llamada a la bodega. `geocodificacion_caida` queda como **el único** sin atajo | §1 (definición de ATAJO), R4 · `design.md` §2.1 |
| Q4 | `dia_reparto_corregido` pasa a **accionable**, con atajo a `/mis-asignaciones` | `design.md` §2.1 |
| Q5 | `geocodificacion_caida` **no lleva atajo**; el botón del mockup es un error y el humano lo corrige | R4 · `design.md` §2.1 |
| Q6 | El atajo debe dejar a la persona **donde puede actuar**: el mínimo es fijar la pestaña | R7, R6, R66 |
| Q7 | **Fuera** el pie «Ver todas las notificaciones» | R29 |
| Q8 | El tono sigue **el mismo criterio que la campana** | R30 |
| Q9 | El texto **no puede afirmar «5 días» a secas**: si el lote mezcla plazos, habla sin plazo | R39, R40 |

---

## §14 — Mapa `R<n> → test`

> Ruta y nombre propuestos. El implementer los confirma en `progress/impl_409_*.md`.
> **Los literales de texto se afirman a mano**, nunca comparándolos contra la constante que los
> genera (lección «aserción contra su propia fuente»).

| R | Test | Aserto que se pone ROJO si el código está mal |
| --- | --- | --- |
| R1 | `tests/unit/notificaciones/catalogo-avisos.test.ts` | «declara los 13 eventos del enum, ni uno menos»: compara las claves del catálogo con los valores del enum del cliente Prisma. Borrar una clave lo pone rojo (y además no compila) |
| R2 | `tests/unit/notificaciones/catalogo-avisos.test.ts` | «`cierre_dia_vencido` es accionable para el mensajero e informativo para la bodega» y «`devoluciones_represadas` lleva a `/recepcion-satelite/en-bodega` para el adminSatelite y a `/ordenes` para maestro y admin» — dos destinos distintos para el mismo evento |
| R3 | `tests/unit/notificaciones/catalogo-avisos.test.ts` | «cada entrada accionable declara atajo o `null` explícito» recorriendo el catálogo |
| R4 | `tests/unit/notificaciones/catalogo-avisos.test.ts` + `tests/components/NotificationsBell.test.tsx` | «`geocodificacion_caida` no lleva atajo para maestro ni admin» —el único del catálogo— y el panel no renderiza `button` de acción dentro de ese ítem. **Mutación:** darle un destino cualquiera ⇒ rojo |
| R5 | `tests/unit/guards/atajo-aviso-ruta-visible.guardia.test.ts` | recorre TODOS los destinos y afirma contra `SIDEBAR_ITEMS`/`itemsVisibles` que la ruta existe y es visible para ese rol. Mutación: `/wallet` como destino del mensajero → rojo |
| R6 | `tests/unit/guards/atajo-aviso-ruta-visible.guardia.test.ts` | por cada destino con `?`, el fuente de la página de destino lee ese parámetro. Mutación: inventar `?estado=x` en un destino → rojo |
| R7 | `tests/integration/actions/novedades-pestana-por-url.test.ts` + `tests/components/NovedadesTabs.test.tsx` | la página con `?superficie=devolucion` monta el `TabsGroup` con esa pestaña activa; sin parámetro, activa «Ayuda». Y el destino declarado del aviso de novedades ES el que abre «En devolución» |
| R8 | `tests/unit/services/notificacion-service.test.ts` | 2 accionables + 3 informativas + 1 accionable con vigencia 0 → `porHacer === 2` |
| R9 | `tests/unit/services/notificacion-service.test.ts` | la misma lista con `leida: true` en todas → `porHacer` no cambia |
| R10 | `tests/components/NotificationsBell.test.tsx` | con cero por hacer, `queryByText(/por hacer/)` es `null` |
| R11 | `tests/components/NotificationsBell.test.tsx` | `getByText("2 por hacer")` — literal a mano |
| R12 | `tests/components/NotificationsBell.test.tsx` | con 120 accionables → `getByText("+99 por hacer")` |
| R13 | `tests/components/NotificationsBell.test.tsx` | `getByRole("button", { name: "Notificaciones, 2 por hacer" })` — literal a mano |
| R14 | `tests/components/NotificationsBell.test.tsx` | pulsa «Marcar leídas» y el texto del distintivo NO cambia |
| R15 | `tests/components/NotificationsBell.test.tsx` | descarta un accionable → «2 por hacer» pasa a «1 por hacer» sin recarga |
| R16 | `tests/components/NotificationsBell.test.tsx` | `getByText("Requieren tu acción")` y `getByText("Para tu información")`, con el ORDEN afirmado por posición en el DOM |
| R17 | `tests/components/NotificationsBell.test.tsx` | un accionable con atajo renderiza título, detalle, «hace 2 h» y un botón con la etiqueta declarada |
| R18 | `tests/components/NotificationsBell.test.tsx` | ver R4 |
| R19 | `tests/components/NotificationsBell.test.tsx` | en el bloque informativo, `queryAllByRole("button")` sólo devuelve el de descartar |
| R20 | `tests/components/NotificationsBell.test.tsx` | `queryByText(/Anexo:/)` es `null` con una notificación que trae anexo |
| R21 | `tests/components/NotificationsBell.test.tsx` | pulsar el botón navega al `href` declarado (espía del router) y el panel deja de estar en el DOM |
| R22 | `tests/unit/guards/notifications-bell-ancho.guardia.test.ts` | el fuente declara el ancho de 400 px y ya no `w-80` |
| R23 | `tests/components/NotificationsBell.test.tsx` | sólo informativas → `queryByText("Requieren tu acción")` es `null` |
| R24 | `tests/components/NotificationsBell.test.tsx` | lista vacía → `getByText("No tienes notificaciones.")` |
| R25 | `tests/components/NotificationsBell.test.tsx` | pulsar «Requieren tu acción» oculta el bloque informativo; «Todas» lo devuelve |
| R26 | `tests/components/NotificationsBell.test.tsx` | hay un `Descartar notificación` por ítem en los DOS bloques |
| R27 | `tests/unit/guards/notifications-bell-tokens.guardia.test.ts` | el fuente no contiene `#rrggbb` ni `rgb(`, y cada control enfocable lleva `focus-visible:ring-3` |
| R28 | suites vigentes de 146/208 | siguen verdes **sin editarlas** |
| R29 | `tests/components/NotificationsBell.test.tsx` | `queryByText(/Ver todas las notificaciones/)` es `null` |
| R30 | `tests/components/NotificationsBell.test.tsx` | el hook del tono recibe `porHacer`: subir `noLeidas` sin subir `porHacer` NO suena; subir `porHacer` SÍ. Mutación: volver a pasarle `noLeidas` → rojo |
| R31 | `tests/unit/services/notificacion-service.test.ts` | con reloj fijo, un aviso de hace 2 h llega con `cuando === "hace 2 h"` desde el service |
| R32 | `tests/unit/guards/notifications-bell-sin-reloj.guardia.test.ts` | el fuente del componente no contiene `Date.now(` ni `new Date(` |
| R33 | `tests/unit/utils/tiempo-relativo.test.ts` | tabla con reloj fijo, incluidos el borde de «ayer» a las 23:59 CR y a las 00:01 CR |
| R34 | `tests/unit/types/notificacion-dto-aditivo.test.ts` + `pnpm run typecheck` | construye un DTO con SÓLO los campos vigentes y sigue tipando |
| R35 | `tests/unit/notificaciones/novedades-sin-gestionar-aviso.test.ts` | 5 novedades → **una** llamada a `crear`, con el `5` en el título |
| R36 | `tests/unit/notificaciones/novedades-sin-gestionar-aviso.test.ts` | 40 novedades → `crear` llamado exactamente una vez |
| R37 | `tests/unit/notificaciones/novedades-sin-gestionar-aviso.test.ts` | literal a mano: `"La más antigua lleva 3 días en bodega."` como prefijo del detalle |
| R38 | `tests/integration/db/aviso-agregado-repository.test.ts` | el `masAntiguaAt` es la transición `anclaje_devolucion` y **no** el `created_at` de la orden ni su `updated_at` |
| R39 | `tests/unit/notificaciones/novedades-sin-gestionar-aviso.test.ts` + `tests/unit/services/devolucion-sla-plazo-unica-fuente.test.ts` | lote homogéneo de 5 días → literal a mano `"A los 5 días se rechaza automáticamente."`; y el cron NO escala a 4 d 23 h y SÍ a 5 d 00 h. Mutar la configuración a 6 pone los dos en rojo |
| R40 | `tests/unit/notificaciones/novedades-sin-gestionar-aviso.test.ts` | tres casos: causas mezcladas → el texto no contiene ninguna cifra de plazo; todas `not_found` → su propio literal; todas de 5 días pero **una en el tope** → el texto no afirma plazo. **Mutación:** ignorar el tope → el tercer caso rojo |
| R41 | `tests/integration/db/novedades-sin-gestionar-aviso-dedupe.test.ts` | dos corridas el mismo día CR → 1 fila; día siguiente → 2. **Mutación obligatoria:** entidad = id de la orden → el aviso del día 2 desaparece y el test rojo |
| R42 | `tests/integration/db/novedades-sin-gestionar-aviso-dedupe.test.ts` | dos tiendas el mismo día → **2 filas**. **Mutación obligatoria:** quitar el `tiendaId` de la entidad → 1 fila y rojo |
| R43 | `tests/unit/services/avisos-diarios-service.test.ts` | tienda con 0 novedades → `crear` no se llama |
| R44 | `tests/unit/notificaciones/novedades-sin-gestionar-aviso.test.ts` | el texto no contiene guía, remisión, dirección, teléfono ni `₡` |
| R45 | `tests/integration/db/aviso-agregado-repository.test.ts` | siembra `por_devolver` de 2 d y de 4 d con umbral 3 → sólo entra la de 4 d. **Matar el test antes de creerlo:** con 0 filas debe fallar, no pasar por vacío |
| R46 | `tests/integration/db/aviso-agregado-repository.test.ts` | una orden en el estado de tránsito a la tienda con 9 días de antigüedad **no entra** en el resumen. Mutación: añadir ese estado al predicado → rojo |
| R47 | `tests/unit/notificaciones/devoluciones-represadas-aviso.test.ts` | ámbito global con 7 órdenes → dos filas (maestro y admin) con el `7` en el título |
| R48 | `tests/unit/services/avisos-diarios-service.test.ts` | dos zonas con 4 y 3 represadas → dos filas de adminSatelite, cada una con su zona en el alcance y **su** número. Mutación: usar el total global → rojo |
| R49 | `tests/unit/services/avisos-diarios-service.test.ts` | el aviso de maestro/admin lleva el total (7), no el de una zona |
| R50 | `tests/unit/notificaciones/devoluciones-represadas-aviso.test.ts` | literal a mano: `"La más antigua lleva 8 días en bodega. Coordiná la devolución."` |
| R51 | `tests/integration/db/devoluciones-represadas-aviso-dedupe.test.ts` | dos corridas el mismo día → 2 filas de administración + 1 por zona; día siguiente → el doble. **Mutación obligatoria:** quitar el ámbito de la entidad → las zonas se pisan entre sí y rojo |
| R52 | `tests/unit/services/avisos-diarios-service.test.ts` | 0 represadas en una zona → esa zona no recibe aviso, las demás sí |
| R53 | `tests/unit/services/avisos-diarios-service.test.ts` | umbral inyectado: con 3 una orden de 2 d no entra y una de 4 d sí; el valor no aparece como literal en el servicio |
| R54 | `tests/unit/notificaciones/devoluciones-represadas-aviso.test.ts` | igual que R44 |
| R55 | `tests/unit/services/notificacion-service.test.ts` | fila agregada + resolutor devuelve 0 → el ítem no sale y no cuenta, **sin** fila de lectura ni de descarte |
| R56 | `tests/unit/services/notificacion-service.test.ts` | resolutor 0 → oculto; resolutor 3 → visible; el repositorio de escritura no se llama en ninguno |
| R57 | `tests/unit/services/notificacion-service.test.ts` + `tests/unit/services/vigencia-aviso-agregado.test.ts` | fila emitida con «5», resolutor devuelve 3 → el título dice 3. Y para el adminSatelite la cifra se pide acotada a `actor.zonaId`, nunca a un id de la entrada |
| R58 | `tests/unit/services/notificacion-service.test.ts` | resolutor que lanza → el ítem sale y el resto del listado también |
| R59 | `tests/unit/api/avisos-diarios-route.test.ts` | sin `Authorization` → 401 y el service no se construye; secreto ausente → 401 |
| R60 | `tests/unit/services/avisos-diarios-service.test.ts` | tres tiendas, la segunda lanza → 2 emisiones, 1 fallo registrado, la corrida termina |
| R61 | `tests/unit/api/avisos-diarios-route.test.ts` | el cuerpo 200 tiene exactamente las claves de conteo declaradas y ninguna con un id |
| R62 | `tests/unit/services/notificacion-notificadores-reales.test.ts` (ampliar) | sobre el fuente **sin imports ni comentarios**: el composition root PASA los dos notificadores reales. **Mutación:** borrar el argumento dejando el import → rojo |
| R63 | `tests/integration/db/notificacion-evento-avisos-agregados-migration.test.ts` | aplica y revierte contra Postgres real; tras el down quedan los 11 eventos y 9 entidades previos y el índice único conserva su `NULLS NOT DISTINCT` y su `WHERE` parcial |
| R64 | `tests/unit/repositories/notificacion-visibilidad.test.ts` (vigente) | sigue verde sin editarla |
| R65 | `tests/integration/actions/notificaciones-action.test.ts` (vigente) | sigue verde sin editarla |
| R66 | `tests/integration/actions/novedades-pestana-por-url.test.ts` | `?superficie=chorizo` abre «Ayuda» y la página responde 200 |
