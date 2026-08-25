# Feature 278 — El portal del `adminSatelite` se parte en «Por recibir» y «En bodega», y la recepción queda solo por QR

> Requisitos en notación EARS. Numerados `R1`…`R33`. Sin detalles de implementación:
> el CÓMO vive en `design.md` y el desglose en `tasks.md`.
>
> Alcance: **solo frontend**. Ninguna Server Action, servicio, repositorio, esquema ni
> migración cambia (R7). Si algo de esto resultara necesario, se para y se pregunta.

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

**R7 (Ubicuo).** El sistema DEBE conservar sin modificar las Server Actions, servicios,
repositorios, esquemas de validación y modelo de datos de la recepción satélite. Esta
feature no cambia ningún contrato de servidor.

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

**R18 (Ubicuo).** La pantalla «En bodega» NO DEBE listar las órdenes por recibir ni
transportarlas al navegador: le basta con saber si hay alguna.

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

**R28 (De estado).** MIENTRAS no haya ninguna orden por recibir, ninguna de las dos
pantallas DEBE ofrecer el escáner, y «Por recibir» DEBE decir que no hay órdenes por
recibir.
*(Conserva la regla vigente. Ver **Q1** en Preguntas abiertas: si el humano prefiere el
escáner siempre visible, este requisito cambia y R15 pasa a no depender de que haya
órdenes.)*

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

## Preguntas abiertas

**Q1 — ¿El escáner debe estar siempre, o solo cuando hay algo por recibir?**
Hoy el escáner solo se monta si el actor tiene zona **y** hay al menos una orden por
recibir; R28 conserva esa regla, porque la ficha manda arreglar lo evidenciado y no
rediseñar. Pero el motivo escrito de esa regla («no hay guía que resolver, así que solo
estorbarían») se decidió cuando el botón era el camino principal, y ahora el QR es el
único. Consecuencias medidas leyendo el código, que el humano debería sopesar:
1. La lista de órdenes por recibir la resuelve el servidor al cargar la página. Si el
   camión llega después, el escáner no está y hay que recargar.
2. Al recibir la ÚLTIMA orden pendiente, el bloque entero se desmonta con el modal del
   escáner abierto (esto ya pasa hoy, en la pantalla única: no es una regresión nueva).
Si la respuesta es «siempre que tenga zona», R28 se reescribe, R15 deja de depender de que
haya órdenes y desaparece el dato «hay algo por recibir» que «En bodega» necesita (R18).

**Q2 — `recibirLote` se queda sin ningún consumidor en la interfaz. ¿Se retira?**
La ficha afirma que ese camino de servidor «lo usa el escáner». **Medido el 2026-08-24, no
es así**: el escáner llama a `recibirPorQr`
(`app/(app)/recepcion-satelite/_components/EscanerRecepcion.tsx:105` y `:138`) y
`recibirLote` solo se invoca desde el botón que esta feature borra
(`app/(app)/recepcion-satelite/_components/RecepcionSateliteModule.tsx:301`). La decisión
de la ficha —no tocarlo— **se mantiene igual**, pero por otro motivo: retirarlo es backend
(acción, servicio, repositorio, esquema y sus suites), y esta feature es solo frontend. Si
el humano quiere retirarlo, es otra ficha.

**Q3 — Textos de la descripción de cada pantalla.**
Los títulos están decididos (R20: «Por recibir» y «En bodega»). Las descripciones que
acompañan al título en cada pantalla las propone `design.md` §3; se piden confirmadas o
corregidas antes de implementar. El título actual de la pantalla única —«Mis
asignaciones»— desaparece: ninguna de las dos pantallas lo hereda.

**Q4 — El agujero del quitador de comentarios en el archivo del menú.**
El archivo que declara el menú contiene, dentro de un comentario de línea del ítem
«Entregas», una ruta con comodín que abre un bloque de comentario que nadie cierra hasta
mucho más abajo. Cualquier guardia que lea ese archivo por ahí queda ciega justo sobre el
tramo donde viven los subítems nuevos. Esta feature lo esquiva (R32: se juzga el valor en
tiempo de ejecución) y no lo arregla, porque arreglarlo es otra ficha. **Se pregunta solo
esto**: ¿se autoriza reescribir ESE comentario concreto (una ruta con comodín pasa a
escribirse sin él) como parte de esta feature, o se deja intacto para no pisar la ficha que
lo tenga asignado?
