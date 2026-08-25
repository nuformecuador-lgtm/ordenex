# Feature 278 — El portal del `adminSatelite` se parte en «Por recibir» y «En bodega», y la recepción queda solo por QR

> Requisitos en notación EARS. Numerados `R1`…`R47`. Sin detalles de implementación:
> el CÓMO vive en `design.md` y el desglose en `tasks.md`.
>
> **Alcance: `fullstack`** (ampliado el 2026-08-24 al cerrarse las cuatro preguntas). La
> parte de servidor es una **retirada**: el camino de recepción EN LOTE desaparece entero,
> de la Server Action al repositorio (R34–R41). Nada más del servidor se toca, y en
> particular **el camino por QR no se toca** (R38). Si algo obligara a tocarlo, se para y se
> pregunta.
>
> Los requisitos `R34`–`R47` entraron con las cuatro decisiones firmadas; `R7`, `R18` y
> `R28` se reescribieron por lo mismo y llevan la marca correspondiente.

## Glosario mínimo

- **«Por recibir»** — las órdenes de la zona del actor en camino a su bodega satélite
  (estado `en_ruta_bodega_satelite`), hoy pintadas como tarjetas.
- **«En bodega»** — el listado único de la bodega satélite («Órdenes de la bodega»), con
  su barra de filtros, su paginación y sus acciones de lote.
- **El escáner** — la tarjeta de recepción por guía, con sus dos caminos: cámara y número
  de guía tecleado.

---

## Bloque A — El botón «Aceptar» desaparece: recibir es solo por QR

**R1 (Ubicuo).** El sistema NO DEBE ofrecer al rol `adminSatelite` ningún control que
reciba una orden desde las tarjetas de «Por recibir». La única vía de recepción disponible
en la interfaz DEBE ser el escáner.

**R2 (De estado).** MIENTRAS haya al menos una orden por recibir, el sistema DEBE listar
cada una en su tarjeta —con su remisión, su destinatario, su estado legible y su detalle
desplegable— **sin ningún botón de acción** en la tarjeta.

**R3 (Ubicuo).** La sección compartida «por aceptar» NO DEBE exponer ninguna propiedad ni
renderizar ningún elemento cuya única función fuera el botón por-orden retirado.

**R4 (Ubicuo).** La documentación en código de esa sección DEBE describir a su único
consumidor real —el portal del `adminSatelite`— y NO DEBE afirmar que la comparte el
mensajero, ni que ofrece una acción por-orden, ni que ofrece una acción en lote.

**R5 (Ubicuo).** La tarjeta de orden del satélite NO DEBE exponer ningún hueco de acción
que ningún consumidor rellene.

**R6 (Por evento).** CUANDO el `adminSatelite` escanea con la cámara o teclea un número de
guía, el sistema DEBE recibir la orden y notificar el resultado exactamente como hoy —el
mismo mensaje por cada resultado posible, incluida la confirmación persistente de la última
guía recibida—.

**R7 (Ubicuo).** *(Reescrito el 2026-08-24 por la decisión Q2.)* Salvo la retirada del
camino en lote que exigen R34–R41, el sistema DEBE conservar sin modificar las Server
Actions, servicios, repositorios, esquemas de validación y modelo de datos de la recepción
satélite. **Ninguna migración, ninguna tabla y ninguna política RLS cambian.**

---

## Bloque B — Dos subítems de acordeón en el menú

**R8 (Ubicuo).** El ítem de menú del `adminSatelite` DEBE conservar la etiqueta «Órdenes» y
DEBE declarar exactamente dos subítems, en este orden: **«Por recibir»** y **«En bodega»**.

**R9 (Por evento).** CUANDO el `adminSatelite` ve su menú, el ítem «Órdenes» DEBE
renderizarse como disparador de un desplegable —no como enlace— y sus dos subítems DEBEN
renderizarse como enlaces navegables.

**R10 (Ubicuo).** Los dos subítems DEBEN heredar la visibilidad del ítem padre: ningún rol
distinto de `adminSatelite` DEBE poder alcanzarlos desde el menú, ni un actor sin sesión.

**R11 (De estado).** MIENTRAS la ruta activa sea la de uno de los dos subítems, ese subítem
DEBE quedar marcado como página actual y su ítem padre DEBE aparecer desplegado.

**R12 (Ubicuo).** El aterrizaje post-login del `adminSatelite` DEBE ser la pantalla «Por
recibir». El aterrizaje de los otros cinco roles (`maestro`, `admin`, `adminTienda`,
`mensajero`, `apiKey`) NO DEBE cambiar.

---

## Bloque C — Las dos pantallas y la ruta vieja

**R13 (Por evento).** CUANDO se solicita la ruta antigua del portal
(`/recepcion-satelite`), el sistema DEBE redirigir a la pantalla «Por recibir» sin
renderizar contenido, sin resolver la sesión y sin consultar ningún dato.

**R14 (Ubicuo).** El destino del redirect de R13 y el aterrizaje post-login de R12 DEBEN
ser la MISMA pantalla: el rol tiene una sola puerta de entrada.

**R15 (Por evento).** CUANDO un `adminSatelite` con zona asignada abre «Por recibir», el
sistema DEBE mostrar el escáner y las órdenes en camino a su bodega.

**R16 (Ubicuo).** La pantalla «Por recibir» NO DEBE montar el listado de la bodega, ni su
barra de filtros, ni su control de paginación, ni sus acciones de lote, ni sus modales.

**R17 (Por evento).** CUANDO un `adminSatelite` abre «En bodega», el sistema DEBE mostrar
el listado único de la bodega con su barra de filtros, su paginación, sus acciones de lote
y sus modales, tal como funcionan hoy.

**R18 (Ubicuo).** *(Reescrito el 2026-08-24 por la decisión Q1.)* La pantalla «En bodega»
NO DEBE listar las órdenes por recibir ni transportarlas al navegador, **ni necesitar
ningún dato sobre ellas**: con el escáner siempre presente (R42), su cantidad deja de
decidir nada en esta pantalla.

**R19 (Condicional).** SI el actor no tiene rol `adminSatelite` —o no hay sesión—, ENTONCES
cada una de las dos pantallas DEBE responder «no encontrado» sin consultar datos.

**R20 (Ubicuo).** Cada una de las dos pantallas DEBE tener su propio título de primer nivel:
«Por recibir» y «En bodega» respectivamente.

---

## Bloque D — El estado que hoy comparten los dos bloques

**R21 (Por evento).** CUANDO una recepción por QR termina en «recibida» o «ya estaba
recibida» estando en «Por recibir», el sistema DEBE releer del servidor la lista de órdenes
por recibir, de modo que la orden recibida desaparezca de la lista sin recargar la página.

**R22 (Por evento).** CUANDO una recepción por QR termina en «recibida» o «ya estaba
recibida» estando en «En bodega», el sistema DEBE releer el estado del servidor **y**
revalidar la página visible del listado, de modo que la orden recibida aparezca en el
listado sin recargar la página.

**R23 (Ubicuo).** Las acciones del listado de bodega —asignar, deshacer asignación, cambiar
día de reparto, enviar a central, recuperar y reportar incidente— DEBEN seguir releyendo el
estado del servidor exactamente como hoy, sin perder la revalidación de la página visible.

**R24 (Ubicuo).** El aviso de bodega bloqueada, el aviso informativo de cierres abiertos, el
botón de descarga del manifiesto del último envío a central y el aviso «Liberadas hoy
(reprogramación)» DEBEN mostrarse ÚNICAMENTE en «En bodega».

**R25 (De estado).** MIENTRAS el `adminSatelite` no tenga zona asignada, AMBAS pantallas
DEBEN mostrar el mismo aviso accionable, con el mismo texto, resuelto desde una única
fuente.

**R26 (De estado).** MIENTRAS el `adminSatelite` no tenga zona asignada, la pantalla «Por
recibir» NO DEBE ofrecer el escáner ni listar ninguna tarjeta: solo el aviso de R25.

**R27 (De estado).** MIENTRAS el `adminSatelite` no tenga zona asignada, la pantalla «En
bodega» DEBE seguir mostrando su listado y NO DEBE ofrecer el escáner.

**R28 (De estado).** *(Reescrito el 2026-08-24 por la decisión Q1: era lo contrario.)*
MIENTRAS no haya ninguna orden por recibir, «Por recibir» DEBE decir que no hay órdenes por
recibir **y DEBE seguir ofreciendo el escáner**. Una lista vacía no deja al `adminSatelite`
sin forma de recibir el paquete que tiene en la mano.

---

## Bloque E — Que las ausencias muerdan

**R29 (Ubicuo).** Los tres archivos de prueba que hoy afirman la existencia del botón
—el del módulo del satélite, el de la sección «por aceptar» y el del aviso de selección en
otras páginas— DEBEN seguir existiendo y DEBEN afirmar su AUSENCIA. Cada afirmación de
ausencia DEBE ir acompañada, en el mismo caso, de una afirmación POSITIVA que demuestre que
el render que se está juzgando ocurrió de verdad.

**R30 (Ubicuo).** El sistema DEBE tener una guardia que falle si el botón de recepción
vuelve a introducirse en cualquiera de los archivos de la pantalla del satélite, incluida
la vía de inyectar un botón propio en el render de cada tarjeta.

**R31 (Condicional).** SI una guardia juzga el TEXTO de un archivo fuente, ENTONCES DEBE
demostrar dentro del propio caso que el texto que está leyendo contiene los anclajes
positivos que dice vigilar, y DEBE fallar si no los contiene.

**R32 (Ubicuo).** La comprobación de los dos subítems del `adminSatelite` DEBE hacerse
sobre el menú que la aplicación usa en tiempo de ejecución, no sobre el texto del archivo
que lo declara.

**R33 (Condicional).** SI esta feature añade comentarios al archivo que declara el menú,
ENTONCES esos comentarios NO DEBEN contener una apertura de bloque de comentario sin
cerrar (por ejemplo, escribir una ruta con comodín `/*` dentro de un comentario de línea).

---

## Bloque F — La recepción EN LOTE se retira entera (decisión Q2, 2026-08-24)

> Contexto medido: el QR **no comparte camino** con el lote. El escáner va por
> `RecepcionSateliteService.recibir()` → `repo.recibirEnSatelite(...)` (singular); el botón
> iba por `recibirLote()` → `repo.recibirLoteEnSatelite(...)` (lote). Son métodos distintos
> del repositorio y el del lote tiene **un solo llamador**. Verificado en el árbol el
> 2026-08-24; el detalle, con líneas, en `design.md` §15.

**R34 (Ubicuo).** El sistema NO DEBE exponer ninguna Server Action de recepción en lote en
la bodega satélite.

**R35 (Ubicuo).** El sistema NO DEBE conservar el esquema de validación de ese borde ni los
tipos de entrada y de resultado que solo existían para él.

**R36 (Ubicuo).** El servicio de recepción satélite NO DEBE exponer el método de recepción
en lote, ni su entrada ni su resultado de dominio en el contrato de su interfaz.

**R37 (Ubicuo).** El repositorio de órdenes NO DEBE exponer el método de escritura en lote
de la recepción satélite, ni su declaración en el contrato de la interfaz.

**R38 (Ubicuo).** La recepción por QR DEBE seguir funcionando de extremo a extremo —borde,
servicio y método singular del repositorio— con TODAS sus guardas intactas: rol, zona
propia, zona ajena, estado de origen inválido, orden inexistente o borrada, idempotencia de
la ya recibida y resolución de carrera.

**R39 (Ubicuo).** Ningún censo, doble, inventario ni lista de métodos del repositorio DEBE
seguir nombrando el camino en lote retirado.

**R40 (Condicional).** SI se retira una capa que estaba cubierta por tests, ENTONCES lo que
esos tests afirmaban DEBE quedar resuelto de una de estas dos formas, caso por caso y por
escrito: (a) sigue afirmado por otra pieza viva, y se dice cuál; o (b) muere con el código,
y se dice explícitamente que muere y por qué eso es correcto. **No vale borrar un caso sin
nombrar su destino.**

**R41 (Ubicuo).** El censo escrito a mano de los métodos de escritura del repositorio DEBE
estar atado al contrato en tiempo de compilación, de modo que nombrar un método inexistente
NO compile.

---

## Bloque G — El escáner siempre disponible (decisión Q1, 2026-08-24)

**R42 (De estado).** MIENTRAS el `adminSatelite` tenga zona asignada, AMBAS pantallas DEBEN
ofrecer el escáner, haya o no órdenes por recibir listadas.

**R43 (Ubicuo).** La disponibilidad del escáner NO DEBE depender de cuántas órdenes
devolvió la última lectura del servidor. La única condición es tener zona (R26, R27): sin
zona el servidor rechazaría la recepción, así que ofrecer el escáner solo produciría un
error; con zona, la lista puede estar vacía justo porque la orden que el actor tiene en la
mano todavía no se registró.

---

## Bloque H — Títulos, descripciones y el comentario del menú (decisiones Q3 y Q4)

**R44 (Ubicuo).** Cada pantalla DEBE llevar una descripción propia que describa SU
contenido. Ninguna de las dos DEBE heredar la descripción de la pantalla única —que solo
habla de recepción por QR— ni el título «Mis asignaciones», que era el nombre del portal
del MENSAJERO viviendo en la pantalla del satélite.

**R45 (Ubicuo).** El archivo que declara el menú NO DEBE contener ningún comentario de
línea que abra un bloque de comentario sin cerrar.

**R46 (Ubicuo).** Tras ese arreglo, una guardia que lea ese archivo con el quitador de
comentarios del repo DEBE ver la declaración completa de los ítems del menú, incluidos los
subítems del `adminSatelite` y el último ítem de la lista. La mejora DEBE quedar **medida**
—cuántas líneas veía antes y cuántas después—, no afirmada.

**R47 (Ubicuo).** El quitador de comentarios del repo NO DEBE modificarse en esta feature:
lo que se arregla es el comentario que abre el agujero, no la herramienta que se lo traga.

---

## Preguntas cerradas por el humano (2026-08-24)

- **Q1 → el escáner es SIEMPRE visible** con zona asignada, también con la lista vacía. Es
  el fallo que la feature 167 ya documentó: el apartado se ocultaba justo cuando iban a
  buscarlo. ⇒ R28 reescrito, R42, R43; `R18` deja de necesitar el dato.
- **Q2 → el lote SE RETIRA**, con su cadena hasta el repositorio; la ficha pasa a
  `fullstack`. ⇒ R7 reescrito, R34–R41.
- **Q3 → los H1 son «Por recibir» y «En bodega»**, iguales a sus subítems; «Mis
  asignaciones» desaparece. Las descripciones se proponen y justifican en `design.md` §3.
  ⇒ R20 (ya existía) y R44.
- **Q4 → el comentario del menú SE ARREGLA aquí**, sin tocar el quitador. ⇒ R45–R47.

## Preguntas abiertas

**P1 — ¿Qué se hace si al arreglar el comentario alguna guardia se pone roja?**
Hoy ese `/*` esconde el tramo que va desde el ítem «Entregas» hasta el final de la lista de
ítems. Al cerrarlo, **todas** las guardias que escanean fuentes pasan a ver ese tramo por
primera vez. Si alguna se pone roja, no es un daño de esta feature: es una violación que
llevaba oculta ahí. **Se pide la regla por adelantado**: ¿se arregla dentro de esta ficha
(y se dice en la bitácora), o se revierte solo esa línea y se abre ficha aparte con el
hallazgo? La tarea que lo mide (T-Q4.3) se detiene y pregunta si esto ocurre.

