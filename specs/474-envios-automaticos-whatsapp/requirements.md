# 474 — Envíos automáticos por WhatsApp — requirements

> Ficha 474 de `feature_list.json` (zona `fullstack`, `sdd: true`, complejidad alta).
> Es la BASE de las fichas 475 (informe de tránsito) y 476 (informe de picking), que dependen de ella.
> Esta ficha entrega el motor, la pantalla, el historial y el CONTRATO que implementa un informe; el
> catálogo de informes nace con DOS informes: el de prueba (R47) y el «Aviso de la app» (R51), que
> conecta los avisos internos con el disparo por evento. Diseño técnico en `design.md`.
>
> **Enmienda 2026-10-05.** El humano aprobó las maquetas de `design-whatsapp/` y respondió las cuatro
> preguntas abiertas (D1–D4, ver «Decisiones cerradas» al final). Cambian R9, R14, R16, R26 y R27; se
> añaden R48–R53. Ningún otro requisito cambia de número.

## Glosario

- **Plantilla de orden**: plantilla de la feature 107 que existe hoy; sus variables salen del catálogo
  `CAMPOS_PLANTILLA` (datos de una orden).
- **Plantilla de informe**: plantilla asociada a un informe del catálogo; sus variables son las que ese
  informe declara más las comunes a todo informe (R53).
- **Informe**: generador registrado en el catálogo de informes. Recibe sus parámetros y produce los
  valores de sus variables y, si lo declara, un PDF; o responde «vacío».
- **Envío** (envío configurado): qué informe, con qué plantilla y parámetros, a qué destinatarios y con
  qué disparo. Lo configura una persona desde la pantalla.
- **Ejecución**: una corrida concreta de un envío (programada, por evento o de prueba).
- **Entrega**: el mensaje de una ejecución a UN destinatario.
- **Aviso interno**: una notificación de la campana de la app (feature 146 y sucesoras), identificada
  por su evento y su entidad. Un mismo aviso puede crearse para varios destinatarios.
- **Evento disponible**: evento de aviso interno que el catálogo de eventos (R49) declara utilizable
  como disparo.
- **Día CR / hora CR**: fecha y hora de pared en `America/Costa_Rica`.
- **Teléfono válido**: el que, normalizado con `normalizarTelefonoWa`, cumple la regla de `design.md` §6.4.
- **Roles destinatarios permitidos**: `maestro`, `admin`, `adminSatelite`, `adminTienda`, `mensajero`
  (los cinco que muestra la maqueta aprobada; `apiKey` no es una persona).

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
  las variables de ese informe y las comunes (R53), usar sus ejemplos en la vista previa y marcar como
  desconocida cualquier clave del cuerpo que no esté entre ellas.
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
- **R9** — *(enmendado 2026-10-05, D2)* SI al enviar a aprobación una plantilla con documento no se
  puede obtener el identificador de la app de Meta (R48) o falta la credencial de WhatsApp, ENTONCES el
  sistema DEBE responder con un texto en lenguaje claro que diga que las plantillas con documento no se
  pueden enviar a aprobación y por qué (nombrando la pieza que falta o el código del fallo, nunca un
  valor secreto), y NO DEBE cambiar el estado de la plantilla.
- **R10** — SI se intenta eliminar o desactivar una plantilla que usa al menos un envío encendido,
  ENTONCES el sistema DEBE rechazar la operación indicando el nombre de esos envíos.

## C. Configuración de un envío

- **R11** — El sistema DEBE permitir crear y editar un envío con: nombre (único entre los envíos no
  borrados), informe, plantilla, parámetros del informe, destinatarios y disparo, que es «hora fija»
  (uno o más días de la semana y una hora CR en formato HH:mm) o «por evento» (un evento disponible).
- **R12** — SI la plantilla elegida no está vigente, no está activa, no tiene template enlazado en Meta o
  pertenece a otro informe, ENTONCES el sistema DEBE rechazar el guardado con un error en el campo
  plantilla.
- **R13** — El sistema DEBE validar los parámetros contra el esquema que declara el informe y, SI no son
  válidos, ENTONCES DEBE rechazar el guardado con un error por cada campo inválido. CUANDO se crea un
  envío, el sistema DEBE precargar los valores por defecto que declara el informe.
- **R14** — *(enmendado 2026-10-05, D4)* SI el disparo es «por evento» y el evento no es un evento
  disponible (R49) o no está entre los que ofrece el informe elegido, ENTONCES el sistema DEBE rechazar
  el guardado con un error en el campo evento.
- **R15** — CUANDO se crea un envío, el sistema DEBE dejarlo apagado.
- **R16** — *(enmendado 2026-10-05: se añade `adminTienda`, como en la maqueta aprobada)* El sistema DEBE
  permitir elegir destinatarios por rol y/o por usuario, solo entre los roles destinatarios permitidos;
  SI se elige un rol no permitido o un usuario cuyo rol no lo es, o el conjunto resuelto supera 50
  usuarios, ENTONCES el sistema DEBE rechazar el guardado.
  *(Enmienda del leader 2026-10-05)* Cada informe del catálogo DEBE declarar si es apto para
  `adminTienda` (por defecto NO). SI el informe del envío no es apto y entre los destinatarios
  resueltos hay un `adminTienda`, ENTONCES el sistema DEBE rechazar el guardado: un informe con
  datos de varias tiendas (tránsito) no puede llegar a una tienda. El informe «Aviso de la app»
  tampoco es apto. Test: unitario del service con un informe no apto + adminTienda ⇒ rechazo.
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

## E. Disparo por evento (puente con los avisos internos)

- **R26** — *(reescrito 2026-10-05, D4)* CUANDO la app crea un aviso interno de un evento disponible
  (R49) y hay al menos un envío encendido configurado con ese evento, el sistema DEBE encolar
  exactamente UN trabajo por ese aviso y, al procesarlo, DEBE crear una ejecución por cada envío que
  siga encendido con ese evento en ese momento. MIENTRAS no haya ningún envío encendido con ese evento,
  el sistema NO DEBE encolar ningún trabajo ni escribir nada por ese aviso.
- **R27** — *(reescrito 2026-10-05, D4)* El sistema DEBE crear como máximo UNA ejecución por (envío,
  evento, entidad del aviso), aunque el mismo aviso se cree para varios destinatarios de la campana o el
  mismo hecho se emita más de una vez, y como máximo UNA entrega por (ejecución, destinatario).

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
- **R44** — CUANDO un PDF guardado supera su caducidad (30 días, decisión D3), el mantenimiento diario DEBE
  borrarlo del almacenamiento y el historial DEBE mostrarlo como «caducado».

## I. Seguridad y catálogo de informes

- **R45** — El sistema NO DEBE incluir el token de Meta, ningún secreto ni ningún teléfono completo en
  mensajes de error, historial ni logs; los motivos de Meta DEBEN mostrarse con un texto fijo por código
  de error (o un texto genérico con el código si no está mapeado).
- **R46** — El catálogo de informes DEBE exigir que cada informe declare clave, nombre, descripción,
  esquema de parámetros con valores por defecto y descriptores para la pantalla, variables (clave, nombre,
  descripción y ejemplo), si genera documento y qué eventos ofrece; y el sistema DEBE rechazar (fallo en
  test) un catálogo con claves de informe o de variable duplicadas, con una variable que repita una
  común (R53) o con formato distinto de `[a-z0-9_]+`.
- **R47** — El catálogo DEBE incluir el informe «Prueba de envío», que provee las variables `fecha` y `hora`
  (CR) del momento de la ejecución, genera un PDF de una página y acepta el parámetro «simular vacío»; con
  ese parámetro activo DEBE responder «vacío».

## J. Identificador de la app de Meta (añadido 2026-10-05, D2)

- **R48** — El sistema DEBE obtener el identificador de la app de Meta a partir del token de WhatsApp ya
  configurado, sin pedirlo a ninguna persona, y DEBE reutilizar el valor obtenido mientras el proceso
  siga vivo. DONDE exista la variable `WHATSAPP_APP_ID` con valor, el sistema DEBE usar ese valor sin
  consultar a Meta. SI la obtención falla, ENTONCES la pantalla de plantillas DEBE decirlo con un texto
  claro al marcar «lleva documento adjunto», y todo lo que no sea enviar a aprobación una plantilla con
  documento DEBE seguir funcionando.

## K. Avisos internos como disparo (añadido 2026-10-05, D4)

- **R49** — El sistema DEBE mantener un catálogo de eventos que declare, para CADA evento de aviso
  interno que existe, si está disponible como disparo —con un nombre en español claro, sin siglas como
  «SLA»— o no disponible con su motivo. La pantalla DEBE ofrecer como eventos solo los disponibles. SI
  aparece un evento de aviso interno nuevo sin declarar en el catálogo, ENTONCES la compilación o la
  suite DEBEN fallar.
- **R50** — El puente entre avisos internos y envíos NO DEBE hacer fallar, revertir ni esperar a Meta en la
  creación del aviso original: SI el puente falla, ENTONCES el aviso DEBE quedar creado igual y el fallo
  DEBE quedar registrado en el log con su causa. El puente NO DEBE consultar ni escribir nada cuando el
  aviso se crea dentro de una transacción de negocio, cuando el aviso no llegó a crearse (lo absorbió la
  deduplicación de la campana) o cuando el evento no está disponible.
- **R51** — El catálogo de informes DEBE incluir el informe «Aviso de la app», que ofrece todos los
  eventos disponibles, no genera documento y provee las variables `titulo` (nombre del evento en el
  catálogo), `texto` (el texto del aviso tal como lo muestra la campana), `enlace` (dirección completa de
  la pantalla de la app donde se atiende, o la de inicio si el aviso no tiene una) y `fecha` y `hora` (CR)
  del momento en que se creó el aviso. El sistema NO DEBE pasar a un envío el anexo del aviso ni ningún
  dato de persona, teléfono, dirección o monto que no esté ya en el texto del aviso.
- **R52** — CUANDO se pulsa «Probar ahora» en un envío por evento, el sistema DEBE usar como valores de
  `titulo` y `texto` el ejemplo que el catálogo de eventos declara para ese evento, y el resto de
  variables con su valor real del momento.
- **R53** — El sistema DEBE ofrecer en toda plantilla de informe la variable común `destinatario_nombre`,
  cuyo valor en cada entrega es el nombre del usuario destinatario (en «Probar ahora», el de quien
  pulsa), como muestra la maqueta aprobada («Buenos días Daniel»).

## Fuera de alcance

- Los informes de tránsito (475) y picking (476): solo se define aquí el contrato que implementan.
- Avisos internos NO disponibles como disparo en esta ficha (motivo de cada uno en `design.md` §2.2):
  `orden_rechazada` (se crea DENTRO de la transacción del registro de la gestión, R50), los avisos
  personales en segunda persona dirigidos a un único usuario (`carga_masiva_terminada`,
  `dia_reparto_corregido`, `cierre_dia_rechazado`, `reparto_manana`, `traspaso_ordenes_recibido`,
  `traspaso_ordenes_cedido`) y `novedades_sin_gestionar` (solo existe acotado a una tienda y su texto no
  la nombra). Hacerlos disponibles es una línea del catálogo más su motivo, salvo `orden_rechazada`, que
  exige sacar el puente de la transacción.
- Enviar el WhatsApp a los MISMOS destinatarios que el aviso de la campana (destinatarios dinámicos): el
  envío por evento va a los destinatarios configurados en el envío.
- Personalizar el contenido del informe por destinatario (p. ej. cada satélite solo su zona): un informe
  produce el mismo contenido para todos los destinatarios de una ejecución; solo `destinatario_nombre`
  (R53) cambia por entrega.
- Apagar el sistema externo que hoy envía lo mismo: lo hace el humano (Daniel); por eso los envíos nacen
  apagados (R15).
- Pruebas E2E (no hay harness; memoria del repo).

## Decisiones cerradas (respondidas por el humano el 2026-10-05)

- **D1 — Quién configura.** Solo el rol `maestro` (R1), el patrón del repo para `/configuracion` y
  `/configuracion/plantillas`.
- **D2 — `WHATSAPP_APP_ID`.** No se pide al humano: el servidor lo obtiene del token existente (R48);
  la variable queda solo como anulación opcional. Si la obtención falla, se dice en pantalla (R9, R48).
- **D3 — Retención del PDF.** 30 días (R44), configurable por env.
- **D4 — Disparo por evento.** Disponible desde ya, puenteando los avisos internos de la app (R26, R27,
  R49–R52). El catálogo de eventos es el de los avisos, filtrado con motivo.

Ya no quedan preguntas abiertas.

Decisiones técnicas tomadas sin preguntar (se pueden revertir en la revisión): `apiKey` no es
destinatario (es una cuenta técnica); `adminTienda` sí lo es porque la maqueta aprobada lo ofrece;
máximo 50 destinatarios por envío; la ventana de tolerancia es 60 min; idempotencia por usuario, no por
teléfono (dos cuentas con el mismo teléfono reciben dos mensajes, y R17 lo avisa); el identificador de la
app se pide a Meta con el token en la cabecera y no en la URL (invariante de `lib/clients/whatsapp-cloud.ts`).
