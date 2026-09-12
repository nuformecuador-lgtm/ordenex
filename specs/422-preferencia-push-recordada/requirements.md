# Ficha 422 — Requisitos

**La app recuerda que quieres avisos y los reactiva sola al volver a entrar.**

## De qué va, en una línea

Hoy la decisión de recibir avisos vive **en el dispositivo**: al cerrar sesión el dispositivo se da
de baja (410/R19, correcto y se conserva) y con él se va la única huella de que la persona dijo que
sí. Esta ficha guarda **la decisión de la persona**, aparte del dispositivo, y la usa para volver a
suscribir ese dispositivo —**en silencio y sin pedir nada**— cuando la persona vuelve a entrar.

## Vocabulario

- **Preferencia**: «quiero que me avisen». Es de **la persona**. No dice en qué dispositivo.
- **Suscripción**: la credencial de entrega de **un dispositivo-navegador** (`push_suscripcion`,
  ficha 410). Es lo único que decide a dónde sale un push.
- **Permiso**: el que concede el navegador (`Notification.permission`). Es **por dispositivo** y no
  lo controla esta aplicación.
- **Reactivación**: volver a crear la suscripción de este dispositivo sin que la persona toque nada.

---

## Bloque A — Dónde vive la decisión

**R1** (Ubicuo). El sistema DEBE guardar la preferencia «quiero avisos» asociada a **la persona**, en
un lugar que no dependa de ningún dispositivo ni navegador, y DEBE conservarla cuando esa persona
cierra sesión.

**R2** (De estado). MIENTRAS una persona no tenga preferencia guardada, el sistema DEBE tratarla como
**no puesta** (no hay estado «desconocido» que haya que resolver preguntando).

**R3** (Evento). CUANDO el sistema registre una suscripción de un dispositivo a nombre de una
persona, DEBE dejar la preferencia de esa persona **puesta**.

**R4** (Evento). CUANDO se elimine un usuario, su preferencia DEBE eliminarse con él.

**R5** (Evento). CUANDO se aplique la migración que crea el lugar de la preferencia, el sistema DEBE
dejarla **puesta** exactamente para las personas que en ese instante tengan al menos una suscripción
registrada, y NO DEBE crearla para ninguna otra persona.

**R6** (Ubicuo). El conjunto de destinatarios de un push DEBE seguir siendo **exactamente** el de
410/R24–R26 —quien tiene suscripción—, y la preferencia NO DEBE participar en esa decisión: una
preferencia puesta sin suscripción NO DEBE producir ningún envío.

---

## Bloque B — La intención se separa; el trabajo no

**R7** (Evento). CUANDO la persona apague el interruptor de avisos, el sistema DEBE **borrar** su
preferencia.

**R8** (Evento). CUANDO la persona cierre sesión, el sistema DEBE **conservar** su preferencia.

**R9** (Ubicuo). Las dos superficies —el interruptor en OFF y el botón de salir— DEBEN ejecutar
**el mismo** trabajo sobre el dispositivo (baja en el servidor **y** baja en el navegador) y DEBEN
diferenciarse **solo** en lo que significan para la preferencia.

**R10** (Ubicuo). Toda baja del dispositivo DEBE declarar explícitamente su motivo, y el sistema NO
DEBE ofrecer ninguna forma de darse de baja sin declararlo: una superficie nueva que no diga por qué
se da de baja NO DEBE poder existir.

**R11** (Condicional). SI la persona apaga el interruptor y este dispositivo no tiene ninguna
suscripción viva en el navegador, ENTONCES la preferencia DEBE borrarse igualmente.

**R12** (Condicional). SI el borrado de la preferencia falla, ENTONCES la baja del dispositivo DEBE
completarse igual, el cierre de sesión DEBE completarse igual, el fallo DEBE quedar registrado con su
operación y su causa, y la operación NO DEBE lanzar (410/R20 intacto).

**R13** (Ubicuo). Tras cerrar sesión, este dispositivo NO DEBE quedar con suscripción ni en el
navegador ni en el servidor —esté la preferencia puesta o no—, y las suscripciones de los **demás**
dispositivos de esa persona NO DEBEN tocarse (410/R19 intacto).

---

## Bloque C — La reactivación

**R14** (Evento). CUANDO una persona con sesión válida cargue una página del portal autenticado, el
sistema DEBE evaluar si procede reactivar los avisos en ese dispositivo, **sin pedir nada** al
navegador ni a la persona.

**R15** (Condicional). SI la preferencia está puesta **Y** el navegador tiene el permiso de
notificaciones **concedido** **Y** este dispositivo no tiene suscripción viva, ENTONCES el sistema
DEBE suscribir el dispositivo y registrar la suscripción a nombre de la sesión abierta.

**R16** (Ubicuo). La reactivación NO DEBE llamar a la petición de permiso del navegador. DEBE seguir
existiendo **una sola** llamada a esa petición en todo el árbol, y solo tras el gesto de la persona
sobre el interruptor (410/R10, R11).

**R17** (Condicional). SI el permiso del navegador no está concedido —«default» o «denegado»—,
ENTONCES el sistema NO DEBE suscribir ni registrar nada, **aunque la preferencia esté puesta**.

**R18** (De estado). MIENTRAS la preferencia no esté puesta, el sistema NO DEBE suscribir ni registrar
ningún dispositivo por su cuenta.

**R19** (Ubicuo). La reactivación DEBE ser **silenciosa**: sin notificación del sistema, sin toast y
sin ningún cambio visible más allá del estado que el interruptor ya muestra.

**R20** (Condicional). SI la reactivación falla —sin red, sin service worker activo, suscripción
incompleta, o el servidor rechaza el registro—, ENTONCES el estado mostrado para ese dispositivo DEBE
seguir siendo «sin activar», la preferencia DEBE conservarse, y el fallo DEBE quedar registrado con
su operación y su causa **sin** el `endpoint` ni las claves (410/R23).

**R21** (Condicional). SI la preferencia está puesta y este dispositivo **ya** tiene suscripción viva
en el navegador, ENTONCES el sistema DEBE reafirmar su registro en el servidor y NO DEBE crear una
segunda suscripción para el mismo dispositivo.

**R22** (Evento). CUANDO dos pestañas de la misma persona reactiven a la vez el mismo dispositivo, el
sistema DEBE terminar con **una sola** suscripción registrada para ese `endpoint`, y esa exclusión
DEBE ser **estructural** (la unicidad de `endpoint` en la base), no una comprobación previa.

**R23** (Ubicuo). La reactivación DEBE intentarse **como mucho una vez** por carga del portal.

**R24** (De estado). MIENTRAS no haya sesión válida, el sistema NO DEBE intentar ninguna reactivación
ni leer ninguna preferencia (410/R50: el usuario sale de la sesión, nunca de la entrada).

---

## Bloque D — Lo que la persona lee

**R25** (Ubicuo). El texto del control DEBE decir qué pasa con los avisos **al cerrar sesión** y **al
volver a entrar**.

**R26** (Ubicuo). Ese texto NO DEBE prometer avisos en un dispositivo donde no hay sesión abierta, ni
usar jerga técnica («suscripción», «endpoint», «token», «permiso del navegador» como sujeto de la
frase).

---

## Preguntas abiertas

**P1 — Apagar aquí, ¿apaga allá?** La decisión tomada es que apagar el interruptor borra la
preferencia de **la persona**. Pero el interruptor se llama «Avisarme en **este dispositivo**» y la
baja solo toca **este** dispositivo (410/R19). Consecuencia medible: si alguien apaga en el teléfono,
su computadora —donde sigue con sesión— **continúa recibiendo avisos** hasta que cierre sesión allí;
a partir de ahí ya no vuelve sola. ¿Es eso lo que se quiere, o apagar en uno debería retirar las
suscripciones de todos sus dispositivos? Este spec asume **lo primero** (no toca las demás), porque
es lo que el comportamiento actual hace y lo contrario reabre R19.

**P2 — Qué muestra el interruptor.** Este spec **no** cambia 410/R14: el interruptor sigue diciendo
el estado de **este dispositivo** (hay suscripción aquí o no), no la preferencia de la persona. Con
eso, en una computadora donde el permiso está denegado el interruptor dirá «Bloqueado» aunque la
preferencia esté puesta. ¿Se confirma?

**P3 — Texto exacto.** La línea que R25 exige está **propuesta** en `design.md §8`, no decidida:
«Si cerrás sesión dejamos de avisarte aquí, y volvemos a hacerlo cuando entres de nuevo en este
dispositivo.» Falta el visto bueno sobre la redacción (y sobre el voseo, que es el registro del resto
de textos del canal: «Tenés un aviso nuevo»).

**P4 — Nombre del lugar de la preferencia.** El diseño propone la tabla `usuario_preferencia` con una
columna por preferencia (`avisos_push`). Si ya hay un plan de «pantalla de ajustes» con otras
preferencias en mente (idioma, horario de silencio, canal preferido), decirlo ahora cambia poco el
código y mucho el nombre de las cosas.

**P5 — Sin medición propia.** No hay telemetría en este repo, así que **no se va a saber** cuántas
reactivaciones silenciosas ocurren ni cuántas fallan: lo único que quedará es el `console.error` del
fallo (R20). ¿Basta, o hace falta una forma de contarlas?
