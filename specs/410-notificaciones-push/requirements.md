# Feature 410 — Las notificaciones llegan al teléfono aunque la app esté cerrada

> Lee también `design.md` (el cómo) y `tasks.md` (el desglose). Ficha `fullstack`, `sdd: true`,
> complejidad alta, **`depends_on: 409`**.

## Qué se midió antes de escribir esto (2026-09-10, en el árbol real, no en el grafo)

1. **La PWA existe y el canal de push NO.** `public/manifest.json` está (display `standalone`,
   iconos 192/512 y maskable), `public/sw.js` tiene 255 líneas y el registro del service worker vive
   en `app/layout.tsx` (`<Script id="sw-register">`, solo en `production`).
2. **`public/sw.js` no tiene ni un `addEventListener("push")` ni un `notificationclick`.** Sus
   únicos manejadores son `install`, `activate`, `message` y `fetch`.
3. **No hay `web-push` ni ninguna librería de push en `package.json`** (leído entero).
4. **No hay tabla de suscripciones**: `db/schema.prisma` no tiene ningún modelo de push.
5. **Lo que sí existe y es el punto de partida:** la tabla `notificacion` + `notificacion_lectura`,
   el enum `NotificacionEvento` con **11** valores, el emisor central `lib/notificaciones/emitir.ts`
   (patrón `notificar<X>Con` / `emitirBestEffort` en `lib/notificaciones/notificadores.ts`) y la
   campana `components/shared/NotificationsBell.tsx`, que hoy refresca por *polling* de 60 s
   (`hooks/useNotificaciones.ts`) y **solo existe si alguien tiene la app abierta**.

## El alcance de esta ficha: el CANAL, no el catálogo

| Decide la **409** | Decide la **410** (esta) |
| --- | --- |
| QUÉ se avisa y con qué texto | CÓMO ese aviso llega al teléfono con la app cerrada |
| Qué es «accionable» | El permiso del navegador y cuándo se pide |
| A dónde lleva el atajo de cada aviso | La suscripción por dispositivo y su ciclo de vida |
| Los dos avisos nuevos y su cadencia | Las claves VAPID, la emisión y el `notificationclick` |

Esta ficha **consume** el catálogo, la presentación y el atajo de la 409; **no los redefine ni los
duplica**. Lo que necesita de ella está en `design.md §2`.

## Vocabulario

| Término | Qué significa aquí |
| --- | --- |
| **aviso** | Una fila de `notificacion`, con su destinatario (un rol con alcance, o un usuario). Es lo que ya existe hoy y lo que pinta la campana. |
| **push** | La notificación del sistema operativo que el navegador entrega a través de un servicio de push, **con la app cerrada**. |
| **canal** | El conjunto: permiso, suscripción, claves, emisión, entrega y `notificationclick`. Es lo que construye esta ficha. |
| **suscripción** | El trío `endpoint` + claves (`p256dh`, `auth`) que un navegador entrega al suscribirse. **Es de un DISPOSITIVO-navegador, no de una persona.** |
| **evento elegible** | Un par (evento, perfil de destinatario) que el catálogo de push declara digno de interrumpir. Lo demás **no se pusha nunca**. |
| **presentación** | El trío `título` + `cuerpo` + `destino` de un aviso. Lo produce la 409; esta ficha lo consume. |
| **jornada** | El día calendario de Costa Rica, la unidad que ya usan los avisos periódicos del repo (`fechaCalendarioCR`). |
| **suscripción muerta** | Aquella para la que el servicio de push responde `404` o `410`: el navegador la retiró y no volverá. |
| **destinatario del aviso** | El conjunto de usuarios que verían ese aviso en su campana, según el predicado de visibilidad ya existente (`predicadoVisibilidad`). |

---

# Requisitos

## Bloque A — Qué merece push (catálogo cerrado)

**R1** (Ubicuo). El sistema DEBE emitir push **exclusivamente** para los pares (evento, perfil de
destinatario) declarados en el catálogo de elegibilidad, y DEBE tratar cualquier otro par como **no
elegible**.

**R2** (Ubicuo). El catálogo de elegibilidad DEBE ser **exhaustivo sobre `NotificacionEvento`**: cada
valor del enum DEBE tener una entrada explícita, elegible o no elegible. Añadir un valor nuevo al
enum **sin decidir su elegibilidad** DEBE romper la compilación, no caer en un valor por defecto.

**R3** (Ubicuo). El sistema NO DEBE emitir push por cada orden, ni por cada cambio de estado de un
paquete, ni por ningún aviso que su destinatario no pueda resolver él mismo.

**R4** (Ubicuo). La elegibilidad DEBE evaluarse por **(evento, destinatario)** y no solo por evento:
un mismo evento que produce filas para varios destinatarios PUEDE ser elegible para unos y no para
otros.

**R5** (Ubicuo). El push NO DEBE crear ningún aviso nuevo ni ninguna fila adicional en
`notificacion`: es un **transporte** del aviso que ya existe, y el mismo hecho DEBE tener un solo
registro.

## Bloque B — Las tres reglas antirruido

**R6** (Evento). CUANDO se cree un aviso elegible para un usuario, el sistema DEBE emitir **como
mucho un push por (usuario, evento, jornada)**, por muchos avisos elegibles de ese tipo que se creen
ese día.

**R7** (Condicional). SI dos productores crean a la vez el primer aviso elegible del día para el
mismo (usuario, evento), ENTONCES el sistema DEBE enviar **un solo** push: la exclusión DEBE ser
estructural (una restricción de unicidad), no una comprobación previa que una carrera pueda burlar.

**R8** (Condicional). SI en el instante del envío el aviso de origen ya no existe, o su destinatario
ya lo leyó, o ya lo descartó, ENTONCES el sistema NO DEBE enviar el push, y DEBE dar la entrega por
**terminada** (no reintentable).

**R9** (Ubicuo). El cuerpo del push DEBE ser exactamente la presentación del aviso que lo origina y
NO DEBE afirmar ninguna cantidad que ese aviso no traiga ya. En particular, NO DEBE inventar un
agregado a partir de un aviso por unidad.

## Bloque C — El permiso del navegador

**R10** (Ubicuo). El sistema NO DEBE llamar a la petición de permiso de notificaciones del navegador
al cargar la aplicación, ni al iniciar sesión, ni por ninguna vía que no sea R11.

**R11** (Evento). CUANDO la persona active explícitamente el control propio de «avisarme en este
dispositivo», el sistema DEBE —y solo entonces— pedir el permiso al navegador.

**R12** (De estado). MIENTRAS el permiso del navegador esté en «denegado», el sistema NO DEBE volver
a pedirlo y DEBE mostrar en su lugar cómo revertirlo desde los ajustes del navegador.

**R13** (Condicional). SI el navegador no soporta service workers, `PushManager` o `Notification`, o
SI el canal no está configurado (R28), ENTONCES el control de activación NO DEBE ofrecerse.

**R14** (Ubicuo). El control DEBE decir en todo momento el estado **de ese dispositivo**: sin
activar, activado aquí, o bloqueado por el navegador.

**R15** (Evento). CUANDO la persona desactive el control, el sistema DEBE eliminar la suscripción de
ese dispositivo en el servidor y darla de baja en el navegador, y ese dispositivo DEBE dejar de
recibir push.

## Bloque D — La suscripción es de un dispositivo

**R16** (Evento). CUANDO se registre una suscripción, el sistema DEBE guardar su `endpoint` y sus
claves asociadas a **un** usuario, y DEBE identificarla de forma única por su `endpoint`.

**R17** (Evento). CUANDO el mismo dispositivo vuelva a suscribirse (renovación del navegador,
reinstalación, segundo inicio de sesión), el sistema DEBE **actualizar** la suscripción existente y
NO DEBE crear una segunda fila para el mismo `endpoint`.

**R18** (Evento). CUANDO una persona distinta inicie sesión en un dispositivo que ya tenía una
suscripción, el sistema DEBE reasignar esa suscripción al usuario que inició sesión, y el usuario
anterior NO DEBE seguir recibiendo push en ese dispositivo.

**R19** (Evento). CUANDO una persona cierre sesión, el sistema DEBE eliminar la suscripción **de ese
dispositivo**, y NO DEBE tocar las de sus otros dispositivos.

**R20** (Condicional). SI la eliminación de la suscripción al cerrar sesión falla, ENTONCES el cierre
de sesión DEBE completarse igualmente y el fallo DEBE quedar registrado.

**R21** (De estado). MIENTRAS un usuario no esté en estado `activo`, el sistema NO DEBE enviarle
push, aunque conserve suscripciones.

**R22** (Evento). CUANDO se elimine un usuario, sus suscripciones DEBEN eliminarse con él.

**R23** (Ubicuo). El sistema NO DEBE registrar en logs ni en mensajes de error el `endpoint` ni las
claves de una suscripción: DEBE citar, como mucho, un identificador propio.

## Bloque E — A quién le llega

**R24** (Ubicuo). El conjunto de usuarios a los que se envía el push de un aviso DEBE ser
**exactamente** el conjunto de usuarios para los que ese aviso es visible en la campana, resuelto con
el **mismo** predicado de visibilidad ya existente. NO DEBE existir un segundo criterio de alcance.

**R25** (Ubicuo). El sistema NO DEBE enviar un push a quien no vería ese aviso en su campana: ni a
otro rol, ni a otra tienda, ni a otra zona.

**R26** (Evento). CUANDO un usuario destinatario tenga varias suscripciones (varios dispositivos), el
sistema DEBE enviar el push a **todas** ellas, y el fallo de una NO DEBE impedir la entrega a las
demás.

## Bloque F — La emisión no manda

**R27** (Ubicuo). La emisión del push NO DEBE bloquear ni retrasar la operación de negocio que
originó el aviso, y NO DEBE ejecutarse dentro de la transacción de esa operación.

**R28** (Condicional). SI la emisión o la entrega de un push falla por cualquier causa, ENTONCES la
operación de negocio, la corrida del cron o el drenado del resto de la cola DEBEN continuar sin verse
afectados, y el fallo DEBE quedar **registrado con su operación y su causa** (nunca absorbido en
silencio).

## Bloque G — Configuración: las claves VAPID

**R29** (Ubicuo). Las claves VAPID DEBEN resolverse **solo** por variables de entorno y NO DEBEN
aparecer en el repositorio.

**R30** (Condicional). SI falta alguna clave VAPID, ENTONCES el sistema NO DEBE lanzar ni impedir
ninguna operación: DEBE quedarse **sin canal de push** (el control de R13 no se ofrece y no se emite
ningún push), y DEBE dejar constancia de la falta citando el **nombre** de la variable ausente,
nunca su valor.

**R31** (Ubicuo). La clave **privada** VAPID NO DEBE salir nunca al cliente, ni a un log, ni a un
mensaje de error.

**R32** (Ubicuo). La clave **pública** VAPID DEBE servirse al navegador desde una única fuente
resuelta **en tiempo de ejecución**, de modo que rotarla no exija reconstruir la aplicación.

## Bloque H — Las suscripciones se rompen

**R33** (Evento). CUANDO el servicio de push responda `404` o `410` para una suscripción, el sistema
DEBE **eliminarla** y DEBE dar esa entrega por **terminada**: NO DEBE reintentarla.

**R34** (Evento). CUANDO el servicio de push falle de forma transitoria (red, tiempo agotado, 5xx),
el sistema DEBE reintentar con un número de intentos **acotado** y terminar en un desenlace final,
sin quedarse reintentando indefinidamente.

**R35** (Ubicuo). La entrega de push NO DEBE producir más de **un** trabajo en la cola por aviso
elegible creado, y una segunda emisión del mismo aviso NO DEBE producir un segundo trabajo.

**R36** (Ubicuo). El sistema NO DEBE dejar en la cola trabajos de push que no puedan progresar: todo
desenlace —entregado, suscripción muerta, aviso ya leído, sin configuración— DEBE terminar el
trabajo.

## Bloque I — El service worker

**R37** (Evento). CUANDO el service worker reciba un evento `push`, DEBE mostrar una notificación del
sistema con el título, el cuerpo y el icono de la aplicación, y DEBE conservar el destino para el
`notificationclick`.

**R38** (Condicional). SI el contenido del push no se puede interpretar, ENTONCES el service worker
DEBE mostrar igualmente una notificación con un texto de reserva fijo y destino a la portada de la
aplicación: NO DEBE quedarse en silencio.

**R39** (Evento). CUANDO la persona toque la notificación y ya exista una ventana de la aplicación
abierta, el sistema DEBE **enfocar esa ventana** y llevarla al destino del aviso, sin abrir una
segunda pestaña.

**R40** (Evento). CUANDO la persona toque la notificación y no exista ninguna ventana abierta, el
sistema DEBE abrir una en el destino del aviso.

**R41** (Evento). CUANDO se muestre una notificación, DEBE llevar una etiqueta derivada del evento,
de modo que un push posterior del mismo tipo **reemplace** al anterior en lugar de apilarse.

**R42** (Ubicuo). El comportamiento de push del service worker NO DEBE activarse en la rama de
desarrollo ni en la del rescate forzoso, donde el service worker se autodestruye.

## Bloque J — La misma cosa no suena dos veces

**R43** (Evento). CUANDO llegue un push mientras hay una ventana de la aplicación **visible y
enfocada**, el sistema DEBE avisar a esa ventana para que su campana se actualice, y el aviso NO DEBE
sonar dos veces: el tono propio de la campana DEBE suprimirse para esa llegada.

**R44** (Ubicuo). Marcar leído o descartar un aviso desde la campana NO DEBE producir ningún push, ni
retirar los ya entregados en otros dispositivos.

## Bloque K — Dónde llega de verdad

**R45** (Ubicuo). El sistema NO DEBE prometer push donde el navegador no lo permite. En particular,
el control de activación DEBE indicar, cuando el navegador lo exija, que la aplicación tiene que
estar **instalada en la pantalla de inicio** para poder recibir avisos.

**R46** (De estado). MIENTRAS un dispositivo no tenga suscripción, ese dispositivo NO DEBE recibir
push, y la persona DEBE seguir viendo todos sus avisos en la campana sin degradación alguna.

## Bloque L — Datos y seguridad

**R47** (Ubicuo). La tabla de suscripciones DEBE tener RLS habilitada, siguiendo el patrón ya vigente
en el repositorio para tablas de solo servicio.

**R48** (Ubicuo). El contenido del push NO DEBE llevar ningún dato que el aviso de origen no lleve ya:
ni dirección, ni teléfono, ni monto, ni nombre de destinatario.

**R49** (Ubicuo). Toda migración nueva de esta ficha DEBE tener su `down.sql`, y el rollback DEBE
funcionar con `pnpm run db:rollback`.

**R50** (Ubicuo). El registro de suscripciones y su borrado DEBEN fijar el usuario **desde la sesión
del servidor**: el identificador de usuario NO DEBE viajar en la entrada, de modo que nadie pueda
suscribir un dispositivo a nombre de otra persona.

## Bloque M — Un canal que no se puede olvidar ni exagerar

**R51** (Ubicuo). Todo productor de avisos de producción DEBE emitir su push a través del **único**
punto de cableado del canal. Un productor nuevo que no pase por él DEBE poner en rojo una guardia:
NO DEBE quedarse sin push en silencio.

**R52** (Condicional). SI el sistema dispone del número de avisos pendientes de ese tipo para ese
usuario, ENTONCES el cuerpo del push DEBE decir ese número. SI NO dispone de él, ENTONCES DEBE
hablar en singular de un solo caso y NO DEBE afirmar cantidad alguna. En ningún caso DEBE afirmar
una cantidad que no haya contado.

---

## Decisiones cerradas — 2026-09-10

Las ocho preguntas abiertas de la primera versión de este spec las **cerró el humano** el 2026-09-10.
Se dejan escritas porque cada una fija un límite del alcance, y un límite que no está escrito se lee
como un olvido.

**D1 (era Q1) — Dos de los cuatro avisos de push prometidos al mensajero NO tienen productor, y esta
ficha NO los crea.** La tabla de push del lienzo aprobado se dibujó sin comprobar que los eventos
existieran. Esta ficha entrega **el canal**, no el catálogo, así que cubre solo lo que ya existe.
**Lo prometido que queda SIN CUBRIR, con nombre y apellido:**

| Prometido en el lienzo | Estado real, medido en `db/schema.prisma` | Queda |
| --- | --- | --- |
| Mensajero: **«su cierre fue rechazado»** | No existe evento de rechazo de cierre. Solo se avisa si el rechazo además lo deja bloqueado, vía `mensajero_bloqueado_por_cierres`. **Un rechazo que no bloquea no produce hoy ningún aviso.** | **SIN CUBRIR** — ficha aparte |
| Mensajero: **«su reparto de mañana»** | No hay evento, ni productor, ni cron, ni emisor. Nada. | **SIN CUBRIR** — ficha aparte |

Nadie debe dar por hechos esos dos leyendo `design-notificaciones/Push.dc.html`. Cuando existan, el
catálogo de esta ficha los acoge con una línea (R2 lo obliga: el enum no compila sin decidirlos).

**D2 (era Q2) — `cierre_dia_vencido` al mensajero SÍ entra**, solo para la fila dirigida a él, nunca
para las copias a bodega.

**D3 (era Q3) — El texto no promete un número que no tiene.** Se le pide a la 409 el conteo de
avisos pendientes por (usuario, evento); **si lo entrega, el push lleva el número**; si no, habla en
singular de un solo caso. Es R52. Un push que dice «tenés 1 cierre» cuando hay tres es peor que uno
que no cuenta.

**D4 (era Q4) — El push de `geocodificacion_caida` va SOLO al `maestro`.** El `admin` lo sigue viendo
en su campana, exactamente como hoy, y **eso no es una omisión**: es la regla que gobierna toda la
ficha —se interrumpe a quien **puede resolverlo**—, y una credencial de Google la arregla el maestro.
La 401 incluyó al `admin` en la campana para que pudiera escalar, y ese aviso no se toca.

**D5 (era Q5) — Latencia de hasta ~60 s aceptada.** Es la cadencia del cron y no justifica un canal
aparte.

**D6 (era Q6) — iOS: medido, y con coste conocido.** Sobre los ingresos reales: **8 personas entran
desde iPhone o iPad**; de ellas **3 usan SOLO iOS, y las tres son mensajeros**. Las otras 5 entran
también desde Windows o Android, así que a ellas el push les llega igual por su otro dispositivo.
**Coste declarado: 3 de 18 mensajeros se quedan sin push salvo que instalen la app en su pantalla de
inicio.** Por eso R45 no es un detalle de cortesía: la instrucción de instalar tiene que aparecer
**en el sitio exacto donde iría el control**, que es donde esas tres personas van a buscarlo.

**D7 (era Q7) — Fuera de alcance: no hay pantalla de «mis dispositivos».** Con revocar al cerrar
sesión (R19) y retirar las suscripciones muertas (R33) basta.

**D8 (era Q8) — Icono pequeño resuelto** con el criterio del diseño: se deriva del glifo de paquete
que el propio lienzo usa. Detalle en `design.md §10`.

---

## Preguntas abiertas

**Ninguna.** Las ocho quedaron cerradas el 2026-09-10 (ver «Decisiones cerradas», arriba).

Lo que **sí** sigue siendo una entrada externa —y por eso vive en `tasks.md` como puerta previa T0 y
no como pregunta— es lo que esta ficha necesita de la **409**: la presentación de un aviso (título,
cuerpo, destino) como función pura invocable desde el servidor, y —si la 409 puede— el conteo de
avisos pendientes por (usuario, evento) que activa la mitad numerada de R52. Si el conteo no llega,
R52 ya dice qué hacer: singular y sin cantidad. No hay nada que preguntar.
