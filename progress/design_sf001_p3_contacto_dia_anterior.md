# SF-001 · Punto 3 — Contacto al cliente antes de recoger

**Estado: diseño acordado con el humano el 2026-09-15. No implementado, sin ficha registrada.**
Estimado del documento: 3 a 5 días hábiles. **Propuesto: 1 a 2.** El porqué está abajo.

---

## El documento se equivoca en su afirmación central, y esta vez a nuestro favor

> «El trabajo fino está en separar con precisión "puede escribirle al cliente y ver la orden" de
> "puede trabajar la orden", **porque hoy son la misma puerta**.»

**Nunca fueron la misma puerta.** Verificado en el archivo real:

| Puerta | Qué comprueba hoy |
| --- | --- |
| **Trabajar** (recoger / escoger / gestionar) | `estaReservadaParaOtroDia` — guardia de fecha real, server-side, con reloj inyectable |
| **Chatear** (`OrdenEnvioReader.findParaEnvio`) | `id`, `deletedAt: null`, `mensajeroAsignadoId`. **NADA MÁS** — ni fecha ni estado |

¿Por qué entonces hoy no puede chatear con la orden de mañana? Por **una línea en el cliente**:
`contactosChat = [...porGestionar, ...conAyuda]` (`RepartoModule.tsx`), órdenes ya recogidas. Una
orden de mañana no se puede recoger, así que nunca entra a la lista. Es un efecto colateral de cómo se
pinta la pantalla, no un permiso.

Y el spec de la **ficha 261 ya lo declaró a propósito** como límite conocido: el chat NO se apaga por
reserva.

### Lo que eso significa para el estimado

El trabajo que el documento valora en 3–5 días —separar dos puertas que son una— **no existe, porque
ya están separadas**. Queda: añadir las órdenes asignadas a la lista de contactos y mostrar el detalle.

Y el riesgo que el documento advierte —«si esa separación queda floja, se reabre el problema que la
regla cerró»— **casi desaparece**: no hay que tocar la puerta de «trabajar», así que sus cinco archivos
de test y su guardia de árbol siguen intactos.

## Las demás afirmaciones del documento

| # | Afirmación | Veredicto |
| --- | --- | --- |
| T1 | Una orden de mañana no se puede recoger, tomar ni gestionar | **Cierta** — `MisAsignacionesService`, tres puntos de guardia |
| T2 | El chat solo se habilita para las que ya lleva encima | **Cierta en el resultado**, pero por construcción de la UI, no por un permiso |
| T3 | Decisión del 2026-08-21, revierte la regla anterior, por un caso real | **Cierta** — ficha **261**, que revierte D5 de la **246**. El caso: el mensajero José recogió y entregó la guía 17496963 a las 22:10 del 21 estando reservada para el 22 |
| T4 | La conversación se guarda contra la orden, no contra el mensajero | **Cierta** — `ChatConversacion` tiene `@@unique([ordenId, telefonoE164])`; `mensajeroId` es atributo mutable |

## El requisito del humano: contactar NO es aceptar

**«El mensajero debe poder contactar al cliente tan pronto le asignen, pero eso no es aceptar la orden:
no puede llegar a un cierre vencido mientras no la recoja.»**

**Ya está garantizado, dos veces**, en `CierreDiaRepository` (el `WHERE` que decide qué entra al cierre):

```
noReservadaParaDespues = [ {fechaReparto: null}, {fechaReparto: {lte: diaCerrado}} ]
for (origenEstatusId of [enRepartoEstatusId, ayudaEstatusId])
```

1. **Por estado**: al cierre solo entran órdenes en `en_reparto` o `ayuda_tienda` — ya recogidas. Una
   en `por_recoger` no entra nunca.
2. **Por fecha**: y de esas, las reservadas para un día futuro se excluyen igual. El comentario del
   código lo dice tal cual: *«Las reservadas se quedan donde están, en la mano del mensajero.»*

Como **chatear no cambia el estado de la orden**, la orden sigue en `por_recoger`: no entra al cierre y
no puede vencerse. La protección la puso la ficha 246; no hay que construirla.

---

## Medido en producción (2026-09-15)

- **48 de 1.664 órdenes (2,9%)** se asignaron con anticipación, con solo **2 mensajeros**.
- La anticipación es **siempre exactamente 1 día**, nunca más.
- Hora de esas asignaciones: entre **14:43 y 22:55**, promedio **20:00**.

**Cómo leer ese 2,9%:** puede ser bajo *precisamente porque* hoy una orden de mañana no sirve para nada
hasta que llega el día. Si se puede coordinar por adelantado, quizá se asigne mucho más en la tarde —
el número mide la limitación, no la demanda. **Decisión del humano: da igual cuándo se asigne; lo que
importa es que pueda contactar tan pronto le asignen.**

## El diseño acordado

1. Las órdenes **asignadas** entran a la lista de contactos del chat, sin esperar a ser recogidas.
2. El mensajero ve el **detalle completo** de la orden.
3. **Sigue sin poder recoger, tomar ni gestionar.** No se toca esa puerta.
4. **La pantalla deja claro que es de mañana.** Si escribe el día antes, el cliente le va a pedir que
   se la lleve hoy; el mensajero tiene que saber que el sistema se lo va a impedir. La etiqueta
   `esParaManana` ya existe en los datos — falta que se vea también en el chat.
5. **Cerrar de paso el agujero del servidor**: hoy la autorización del chat no mira fecha ni estado, así
   que la protección es solo de interfaz. No es urgente —es mensajería, no dinero— pero vamos a estar
   ahí y es barato.

## La red que NO se puede romper

Cinco archivos de test protegen «una orden de mañana no se recoge ni se gestiona», y ninguno debería
cambiar en esta ficha:
`mis-asignaciones-reserva-bloquea.test.ts` · `recoger-lote-dia-reserva.int.test.ts` ·
`deshacer-gestion-conserva-reserva.int.test.ts` · `gestion-desde-ayuda-reserva.test.ts` +
su integración · y la guardia de árbol `d5-revertida.guardia.test.ts`, que falla si el código vuelve a
afirmar que la reserva no bloquea al mensajero.

Si alguno de ellos cambia durante la implementación, es señal de que se tocó lo que no era.
