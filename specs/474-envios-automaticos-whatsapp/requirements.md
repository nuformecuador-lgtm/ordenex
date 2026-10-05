# 474 — Envíos automáticos por WhatsApp — requirements

> Ficha 474 de `feature_list.json` (zona `fullstack`, `sdd: true`, complejidad alta).
> Es la BASE de las fichas 475 (informe de tránsito) y 476 (informe de picking), que dependen de ella.
> Esta ficha entrega el motor, la pantalla, el historial y el CONTRATO que implementa un informe; el
> catálogo de informes nace con UN solo informe, el de prueba (R47). Diseño técnico en `design.md`.

## Glosario

- **Plantilla de orden**: plantilla de la feature 107 que existe hoy; sus variables salen del catálogo
  `CAMPOS_PLANTILLA` (datos de una orden).
- **Plantilla de informe**: plantilla asociada a un informe del catálogo; sus variables son las que ese
  informe declara.
- **Informe**: generador registrado en el catálogo de informes. Recibe sus parámetros y produce los
  valores de sus variables y, si lo declara, un PDF; o responde «vacío».
- **Envío** (envío configurado): qué informe, con qué plantilla y parámetros, a qué destinatarios y con
  qué disparo. Lo configura una persona desde la pantalla.
- **Ejecución**: una corrida concreta de un envío (programada, por evento o de prueba).
- **Entrega**: el mensaje de una ejecución a UN destinatario.
- **Día CR / hora CR**: fecha y hora de pared en `America/Costa_Rica`.
- **Teléfono válido**: el que, normalizado con `normalizarTelefonoWa`, cumple la regla de `design.md` §6.4.
- **Roles destinatarios permitidos**: `maestro`, `admin`, `adminSatelite`, `mensajero`.

## A. Acceso

- **R1** — El sistema DEBE permitir ver, crear, editar, encender, apagar, probar y borrar envíos y ver el
  historial SOLO al rol `maestro`. SI otro rol (o una sesión ausente) invoca cualquiera de esas
  operaciones, ENTONCES el sistema DEBE responder `forbidden` (o no autenticado) sin leer ni escribir
  datos de envíos, y la página DEBE mostrar el aviso de «sin permiso» en lugar del módulo.
- **R2** — El sistema DEBE mostrar la entrada «Envíos automáticos» dentro de «Configuración» solo a quien
  ve ese menú, sin cambiar el destino inicial tras el login de ningún rol.

## B. Plantillas (extensión de la feature 107)

- **R3** — El sistema DEBE permitir declarar una plantilla como «de informe», asociada a exactamente un
  informe del catálogo. Las plantillas que no lo declaran DEBEN seguir comportándose como plantillas de
  orden, sin ningún cambio observable.
- **R4** — MIENTRAS una plantilla sea de informe, el sistema DEBE ofrecer en el selector de variables solo
  las variables de ese informe, usar sus ejemplos en la vista previa y marcar como desconocida cualquier
  clave del cuerpo que el informe no declare.
- **R5** — DONDE una plantilla de informe esté marcada «lleva documento adjunto», CUANDO se envíe a
  aprobación, el sistema DEBE crear el template en Meta con una cabecera de tipo documento (con su
  documento de ejemplo) además del cuerpo.
- **R6** — SI se marca «lleva documento adjunto» en una plantilla de orden, o en una plantilla de un
  informe que no genera documento, ENTONCES el sistema DEBE rechazar el guardado con un error de
  validación en ese campo.
- **R7** — SI una plantilla ya salió hacia Meta (tiene template enlazado o su estado no es «guardada sin
  aprobación»), ENTONCES el sistema DEBE rechazar cualquier cambio de su informe asociado o de la marca
  «lleva documento adjunto».
- **R8** — El sistema NO DEBE ofrecer una plantilla de informe en el envío de plantillas del chat, en el
  flujo wa.me del mensajero ni como mensaje de bienvenida; SI se intenta marcarla como bienvenida,
  ENTONCES el sistema DEBE responder «no aplica».
- **R9** — SI al enviar a aprobación una plantilla con documento falta la configuración necesaria para
  subir el documento de ejemplo a Meta, ENTONCES el sistema DEBE responder «no configurado» nombrando la
  pieza que falta (nunca su valor) y NO DEBE cambiar el estado de la plantilla.
- **R10** — SI se intenta eliminar o desactivar una plantilla que usa al menos un envío encendido,
  ENTONCES el sistema DEBE rechazar la operación indicando el nombre de esos envíos.

## C. Configuración de un envío

- **R11** — El sistema DEBE permitir crear y editar un envío con: nombre (único entre los envíos no
  borrados), informe, plantilla, parámetros del informe, destinatarios y disparo, que es «hora fija»
  (uno o más días de la semana y una hora CR en formato HH:mm) o «por evento» (un evento del catálogo).
- **R12** — SI la plantilla elegida no está vigente, no está activa, no tiene template enlazado en Meta o
  pertenece a otro informe, ENTONCES el sistema DEBE rechazar el guardado con un error en el campo
  plantilla.
- **R13** — El sistema DEBE validar los parámetros contra el esquema que declara el informe y, SI no son
  válidos, ENTONCES DEBE rechazar el guardado con un error por cada campo inválido. CUANDO se crea un
  envío, el sistema DEBE precargar los valores por defecto que declara el informe.
- **R14** — SI el disparo es «por evento» y el evento no está entre los que ofrece el informe elegido,
  ENTONCES el sistema DEBE rechazar el guardado.
- **R15** — CUANDO se crea un envío, el sistema DEBE dejarlo apagado.
- **R16** — El sistema DEBE permitir elegir destinatarios por rol y/o por usuario, solo entre los roles
  destinatarios permitidos; SI se elige un rol no permitido o un usuario cuyo rol no lo es, o el conjunto
  resuelto supera 50 usuarios, ENTONCES el sistema DEBE rechazar el guardado.
- **R17** — CUANDO se editan los destinatarios, ANTES de guardar, la pantalla DEBE mostrar la lista
  resuelta y deduplicada por usuario, con un aviso por cada destinatario de teléfono inválido y por cada
  teléfono compartido entre dos o más destinatarios. Los avisos NO DEBEN impedir guardar.
- **R18** — SI se intenta encender un envío cuya plantilla no es compatible (R12), cuyos parámetros no son
  válidos (R13) o que no tiene ningún destinatario activo con teléfono válido, ENTONCES el sistema DEBE
  rechazar el encendido con el motivo y dejar el envío apagado.
- **R19** — MIENTRAS un envío esté apagado, el sistema NO DEBE enviar nada por él, ni programado ni por
  evento, aunque hubiera ejecuciones ya planificadas antes de apagarlo.
- **R20** — CUANDO se edita la hora o los días de un envío encendido, el sistema DEBE aplicar la nueva
  programación desde la siguiente ocurrencia futura y NO DEBE enviar por ocurrencias cuya hora ya pasó en
  el momento de la edición.
- **R21** — CUANDO se borra un envío, el sistema DEBE dejar de enviarlo y DEBE conservar su historial.

## D. Disparo a hora fija

- **R22** — CUANDO llega el instante programado (un día marcado, a la hora CR configurada) de un envío
  encendido, el sistema DEBE ejecutarlo en los 2 minutos siguientes, sin añadir un cron propio por envío.
- **R23** — El sistema DEBE enviar como máximo UN mensaje por (día CR, destinatario, envío) en el disparo a
  hora fija, también ante ejecuciones concurrentes, reintentos de la cola o reprogramaciones del mismo día.
  Las ejecuciones de «Probar ahora» NO DEBEN contar para este límite ni consumirlo.
- **R24** — SI una ejecución programada arranca más tarde que su instante programado más la ventana de
  tolerancia (por defecto 60 minutos), ENTONCES el sistema NO DEBE enviar y DEBE registrar la ejecución
  como «omitida» con el retraso medido.
- **R25** — MIENTRAS un envío a hora fija esté encendido, la pantalla DEBE mostrar su próxima ejecución
  programada, y SI no hay ninguna programada, ENTONCES DEBE mostrar un aviso visible. CUANDO corre el
  mantenimiento diario, el sistema DEBE volver a programar la próxima ejecución de todo envío encendido
  que no tenga ninguna.

## E. Disparo por evento

- **R26** — CUANDO se emite un evento del catálogo con su referencia (identificador estable del hecho), el
  sistema DEBE crear una ejecución por cada envío encendido configurado con ese evento.
- **R27** — El sistema DEBE crear como máximo UNA ejecución por (envío, evento, referencia) y como máximo
  UNA entrega por (ejecución, destinatario), aunque el mismo evento se emita más de una vez.

## F. Ejecución

- **R28** — CUANDO se ejecuta un envío (que no sea prueba), el sistema DEBE resolver los destinatarios en
  ese momento como la unión de los usuarios de los roles elegidos y de los usuarios elegidos, solo en
  estado `activo`, deduplicada por usuario.
- **R29** — SI un destinatario tiene teléfono inválido, ENTONCES el sistema NO DEBE intentar enviarle y
  DEBE registrar su entrega como «teléfono inválido».
- **R30** — SI una ejecución no tiene ningún destinatario, ENTONCES el sistema NO DEBE generar el informe
  y DEBE registrar la ejecución como «sin destinatarios».
- **R31** — SI el informe responde «vacío», ENTONCES el sistema NO DEBE enviar ningún mensaje y DEBE
  registrar la ejecución como «vacía» con el motivo que da el informe.
- **R32** — El sistema DEBE enviar los valores de las variables en el mismo orden en que aparecen en la
  plantilla, sin saltos de línea, sin tabuladores y sin más de cuatro espacios seguidos. SI una variable
  de la plantilla no tiene valor o queda vacía, ENTONCES el sistema NO DEBE enviar y DEBE registrar la
  ejecución como «error» nombrando la variable.
- **R33** — DONDE la plantilla lleve documento adjunto, el sistema DEBE enviar el PDF del informe como
  documento de cabecera, con su nombre de archivo, y DEBE usar el mismo PDF para todos los destinatarios
  de esa ejecución.
- **R34** — SI al ejecutar la plantilla ya no es compatible (R12) o los parámetros guardados ya no son
  válidos (R13), ENTONCES el sistema NO DEBE enviar y DEBE registrar la ejecución como «error» con un
  motivo que diga qué corregir.
- **R35** — El sistema DEBE fijar el contenido de una ejecución (valores y PDF) una sola vez; CUANDO una
  ejecución se reintenta, DEBE reutilizar ese contenido y NO DEBE regenerar el informe.
- **R36** — CUANDO Meta responde a una entrega, el sistema DEBE registrarla como «aceptada» (con el id del
  mensaje de Meta) si fue aceptada, como «rechazada» con el motivo saneado si el error es permanente, y
  SI el error es transitorio, ENTONCES DEBE reintentarla con espera creciente hasta 5 intentos y,
  agotados, registrarla como «fallida».
- **R37** — SI una entrega quedó en curso sin desenlace conocido (el envío a Meta pudo haber salido), el
  sistema NO DEBE reenviarla y el historial DEBE mostrarla como «resultado desconocido».
- **R38** — CUANDO el webhook de WhatsApp informa el estado de un mensaje de una entrega, el sistema DEBE
  actualizarla a «enviada», «entregada», «leída» o «fallida» (con motivo saneado), y NO DEBE hacer
  retroceder un estado más avanzado.

## G. Probar ahora

- **R39** — CUANDO el maestro pulsa «Probar ahora» en un envío, el sistema DEBE ejecutarlo con la
  configuración guardada SOLO hacia el usuario que pulsa, esté el envío encendido o apagado, DEBE
  devolverle el resultado en la misma respuesta y DEBE registrar la ejecución como «prueba».
- **R40** — SI el teléfono del usuario que pulsa «Probar ahora» es inválido, ENTONCES el sistema NO DEBE
  enviar y DEBE decirlo en la respuesta.
- **R41** — SI el mismo usuario pulsa «Probar ahora» sobre el mismo envío menos de 30 segundos después de
  su prueba anterior, ENTONCES el sistema DEBE rechazarla sin enviar.

## H. Historial

- **R42** — El sistema DEBE mostrar un historial de ejecuciones, de la más reciente a la más antigua,
  paginado y filtrable por envío, con: envío, origen (programada, evento, prueba), instante, estado,
  motivo, plantilla y conteo de entregas por estado; y, por ejecución, el detalle de cada entrega:
  nombre del destinatario, teléfono enmascarado (solo los 4 últimos dígitos), estado, motivo saneado e
  instante.
- **R43** — CUANDO una ejecución lleva PDF, el sistema DEBE guardarlo en almacenamiento PRIVADO en una ruta
  única por ejecución, sin sobrescribir nunca un objeto existente, y DEBE permitir descargarlo solo al
  maestro mediante un enlace firmado de corta duración.
- **R44** — CUANDO un PDF guardado supera su caducidad (por defecto 30 días), el mantenimiento diario DEBE
  borrarlo del almacenamiento y el historial DEBE mostrarlo como «caducado».

## I. Seguridad y catálogo de informes

- **R45** — El sistema NO DEBE incluir el token de Meta, ningún secreto ni ningún teléfono completo en
  mensajes de error, historial ni logs; los motivos de Meta DEBEN mostrarse con un texto fijo por código
  de error (o un texto genérico con el código si no está mapeado).
- **R46** — El catálogo de informes DEBE exigir que cada informe declare clave, nombre, descripción,
  esquema de parámetros con valores por defecto y descriptores para la pantalla, variables (clave, nombre,
  descripción y ejemplo), si genera documento y qué eventos ofrece; y el sistema DEBE rechazar (fallo en
  test) un catálogo con claves de informe o de variable duplicadas o con formato distinto de `[a-z0-9_]+`.
- **R47** — El catálogo DEBE incluir el informe «Prueba de envío», que provee las variables `fecha` y `hora`
  (CR) del momento de la ejecución, genera un PDF de una página y acepta el parámetro «simular vacío»; con
  ese parámetro activo DEBE responder «vacío».

## Fuera de alcance

- Los informes de tránsito (475) y picking (476): solo se define aquí el contrato que implementan.
- Conectar eventos reales del dominio al disparador (ver Pregunta abierta 4): esta ficha entrega el
  mecanismo, la clave de idempotencia y su prueba con un evento de test.
- Personalizar el informe por destinatario (p. ej. cada satélite solo su zona): un informe produce el
  mismo contenido para todos los destinatarios de una ejecución.
- Apagar el sistema externo que hoy envía lo mismo: lo hace el humano (Daniel); por eso los envíos nacen
  apagados (R15).
- Pruebas E2E (no hay harness; memoria del repo).

## Preguntas abiertas (dependen del humano)

1. **¿Solo `maestro` configura, o también `admin`?** El patrón medido del repo es maestro-only:
   `/configuracion` y `/configuracion/plantillas` lo son (`lib/auth/menu-visibility.ts:545`,
   `PlantillaMensajeService.ALLOWED_ROLES`). R1 está escrito así; abrirlo a `admin` le daría también
   la gestión de plantillas o lo dejaría con envíos sin poder crear su plantilla.
2. **`WHATSAPP_APP_ID` en Vercel (producción y preview).** Para aprobar una plantilla con PDF, Meta exige
   un documento de ejemplo subido con su API de subida reanudable, que cuelga del **ID de la app** de
   Meta, no del WABA ni del número. Hoy el repo no lo tiene (`lib/config/whatsapp.ts`). Quien tenga
   acceso al panel de Meta tiene que dar ese ID. Sin él funciona todo salvo R5 (R9 lo dice en pantalla).
3. **Cuánto se guarda el PDF.** Por defecto 30 días (R44), configurable por env. ¿Vale?
4. **Primer evento real.** Esta ficha no engancha ningún hecho del dominio al disparo por evento
   (475 y 476 son a hora fija). Si quieres uno ya (p. ej. «cierre del día por aprobar»), dilo y se añade
   como requisito; si no, lo trae la ficha que lo necesite.

Decisiones técnicas tomadas sin preguntar (se pueden revertir en la revisión): `adminTienda` y `apiKey`
no son destinatarios (son clientes y cuentas técnicas, no personal); máximo 50 destinatarios por envío;
la ventana de tolerancia es 60 min; idempotencia por usuario, no por teléfono (dos cuentas con el mismo
teléfono reciben dos mensajes, y R17 lo avisa).
