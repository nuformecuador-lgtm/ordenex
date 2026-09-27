---
titulo: Histórico · Conversaciones
modulo: historico
pantalla: /historico/conversaciones
roles: [maestro, admin]
actualizado: 2026-09-15
fuentes:
  - app/(app)/historico/conversaciones/_components/HistoricoConversacionesModule.tsx
  - app/(app)/historico/conversaciones/_components/HistoricoHilo.tsx
  - app/(app)/historico/conversaciones/_components/historico-filtros-def.ts
---

# Histórico · Conversaciones

**Todo lo que los mensajeros hablaron con los clientes por WhatsApp**, guardado y consultable. Se viene
acá cuando hay un reclamo y hace falta saber qué se dijo.

## Cómo está organizado

A la izquierda, la lista de conversaciones. Elegís una y a la derecha se abre el **hilo completo**, en
orden, como se dio.

## Encontrar la conversación

**El buscador** recorre el contenido de las conversaciones. Sirve cuando recordás algo de lo que se
dijo pero no de qué orden era.

Y con **Filtros**:

- **Mensajero** — todas las conversaciones de una persona.
- **Fecha** — con los atajos de 7, 15, 30 y 90 días.
- **Orden** — el **número exacto** de guía o remisión. Es el filtro más directo: si tenés la guía del
  reclamo, vas derecho a su conversación.

## Cómo se usa de verdad

Llega un reclamo — *«nadie me avisó»*, *«me dijeron otra cosa»*. Con la guía en la mano, filtrás por
**Orden** y en un paso tenés el hilo entero, con horas. La mayoría de los reclamos se resuelven ahí,
leyendo lo que efectivamente se escribió.

## Por qué la conversación no se pierde

Los hilos están guardados **contra la orden**, no contra el mensajero. Si el paquete cambió de manos, la
conversación sigue completa: vas a ver lo que habló el primero y lo que habló el segundo, en el mismo
hilo.

## Lo que esta pantalla NO hace

- **No se escribe desde acá.** Es de lectura. Los mensajes los manda el mensajero desde su pantalla.
- **No incluye las acciones del sistema.** Quién hizo qué está en **Histórico · Acciones**.
