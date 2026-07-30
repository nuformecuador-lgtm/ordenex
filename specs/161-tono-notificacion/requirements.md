# Feature 161 — Tono breve para notificaciones in-app · requirements

> Notación EARS estricta. Cada `R<n>` termina mapeado a un test concreto (ver `tasks.md`).
> Sin detalles de implementación: el CÓMO vive en `design.md`.
>
> Alcance cerrado por el humano ANTES del spec (D1–D3, ver `design.md §0`): suena en la
> **campana** y en el **chat del mensajero** (toasts fuera); tono **sintetizado**, sin
> archivo de audio; la notificación del **sistema** se registra como feature 162 y no se
> implementa aquí.

## Glosario

- **Tono**: sonido corto generado por la propia aplicación para avisar de algo nuevo.
- **Contador vigilado**: número entero que una superficie expone y que crece cuando llega
  algo nuevo (notificaciones sin leer; mensajes entrantes del hilo abierto).
- **Preferencia de sonido**: elección del usuario entre sonido activado o silenciado,
  guardada **en el dispositivo**.
- **Primer gesto**: primera interacción de puntero o teclado del usuario con la página
  tras cargarla.
- **Fallo silencioso**: el tono no suena y la interfaz sigue funcionando sin error visible
  ni excepción propagada (mismo criterio que el R48 de la feature 146).

---

## A. El tono

**R1** — El sistema DEBE generar el tono en el navegador; NO DEBE descargar ni empaquetar
ningún archivo de audio.

**R2** — CUANDO se solicite el tono, el sistema DEBE emitir exactamente dos notas breves
consecutivas, la segunda más aguda que la primera, con duración total no mayor a 300 ms.

**R3** — El sistema DEBE atenuar cada nota progresivamente hasta el silencio; ninguna nota
DEBE cortarse de forma abrupta.

**R4** — SI el navegador no ofrece la API de audio, ENTONCES el sistema NO DEBE emitir
sonido y DEBE fallar de forma silenciosa.

**R5** — El sistema DEBE reutilizar un único contexto de audio para todas las
reproducciones de la misma carga de página.

**R6** — MIENTRAS el contexto de audio esté suspendido, el sistema DEBE intentar
reanudarlo antes de emitir; SI la reanudación falla, ENTONCES falla de forma silenciosa.

**R7** — CUANDO el usuario realice su primer gesto sobre la página, el sistema DEBE
preparar el contexto de audio; DEBE hacerlo una sola vez por carga, con independencia de
cuántas superficies pidan tono.

**R8** — El generador del tono NO DEBE depender de React ni del ciclo de render, de modo
que pueda ejercitarse sin montar componentes.

**R9** — DONDE el código se ejecute en el servidor (sin ventana de navegador), el
generador NO DEBE crear contexto de audio ni lanzar error.

## B. Disparo por incremento

**R10** — CUANDO un contador vigilado aumente respecto de su valor anterior, el sistema
DEBE emitir el tono una sola vez.

**R11** — En la PRIMERA evaluación de un contador vigilado **con dato cargado**, el sistema
NO DEBE emitir tono, cualquiera que sea su valor. (Recargar la página con avisos pendientes
no suena.)

**R24** — MIENTRAS el dato del que sale el contador no esté disponible —aún cargando, o su
lectura falló— el sistema NO DEBE emitir tono NI tomar ese estado como referencia de
comparación. (De lo contrario la primera carga se leería como un salto de cero a N.)

**R12** — SI el contador vigilado disminuye o se repite, ENTONCES el sistema NO DEBE emitir
tono.

**R13** — CUANDO el contador vigilado aumente en más de una unidad a la vez, el sistema
DEBE emitir el tono una sola vez, no una por unidad.

## C. Preferencia de silencio

**R14** — MIENTRAS la preferencia de sonido esté en silenciado, el sistema NO DEBE emitir
tono, aunque el contador aumente.

**R15** — El sistema DEBE tratar la ausencia de preferencia guardada como sonido activado.

**R16** — CUANDO el usuario cambie la preferencia, el sistema DEBE conservarla entre
recargas en el mismo dispositivo; la preferencia NO DEBE viajar a la cuenta del usuario ni
a otros dispositivos.

**R17** — SI el almacenamiento del dispositivo no está disponible, ENTONCES el sistema DEBE
comportarse como sonido activado y NO DEBE lanzar error.

**R18** — El sistema DEBE ofrecer el control de la preferencia en la cabecera del panel de
notificaciones, con su estado actual expuesto en el nombre accesible del control.

## D. Campana de notificaciones

**R19** — CUANDO el total de notificaciones sin leer del actor aumente, el sistema DEBE
emitir el tono.

**R20** — CUANDO el usuario marque todas como leídas o descarte una notificación, el
sistema NO DEBE emitir tono.

## E. Chat del mensajero

**R21** — CUANDO el hilo de chat abierto incorpore un mensaje entrante que antes no estaba,
el sistema DEBE emitir el tono.

**R22** — SI el mensaje nuevo del hilo es saliente, ENTONCES el sistema NO DEBE emitir
tono.

**R23** — CUANDO se abra el panel del chat sobre un hilo que ya contenía mensajes
entrantes, el sistema NO DEBE emitir tono por esos mensajes previos.

---

## Fuera de alcance (declarado)

- Notificación del **sistema** operativo con la app abierta → **feature 162**.
- **Web push** con la app cerrada (VAPID, tabla de suscripciones, listeners `push` en el
  service worker) → feature aparte, mayor.
- Aviso de chat con el panel de gestión **cerrado**: exigiría un contador real de mensajes
  sin leer, que hoy es dato quemado y no tiene tabla equivalente a `notificacion_lectura`.
- Sonido en los toasts genéricos, vibración, y preferencias de sonido por cuenta en base de
  datos.
