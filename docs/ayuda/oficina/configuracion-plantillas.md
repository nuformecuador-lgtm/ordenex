---
titulo: Configuración · Plantillas
modulo: configuracion
pantalla: /configuracion/plantillas
roles: [maestro, admin]
actualizado: 2026-09-15
fuentes:
  - app/(app)/configuracion/plantillas/_components/plantillas-columns.tsx
  - app/(app)/configuracion/plantillas/_components/FormSheet.tsx
  - lib/types/plantilla-datos.ts
  - lib/utils/whatsapp-envio-valores.ts
---

# Configuración · Plantillas

Los **mensajes prearmados** que los mensajeros mandan por WhatsApp. En vez de escribir lo mismo cien
veces, eligen una plantilla y se rellena sola con los datos de esa orden.

## Cómo funcionan los campos

Dentro del cuerpo se escriben **campos entre llaves dobles**, y al enviar se sustituyen por el dato
real de la orden:

```
Hola {{cliente}}, le escribe {{mensajero}}.
Su paquete {{guia}} va en camino. Total: {{total}}
```

El panel de **campos del catálogo** te lista todos los disponibles, con qué son y un ejemplo. No hay
que adivinarlos ni escribirlos de memoria.

Hay campos de la orden (cliente, guía, producto, total, dirección), del mensajero, y del negocio —como
el número de SINPE y el nombre del titular—.

## Crear y editar

Cada plantilla tiene **nombre**, **descripción**, **clave** y **cuerpo**. Se buscan por cualquiera de
los tres primeros.

Se pueden **activar y desactivar** sin borrarlas, y **reordenar** con las flechas: el orden de acá es el
orden en que el mensajero las ve, así que las más usadas conviene tenerlas arriba.

Una plantilla se puede marcar como **mensaje de bienvenida**, la que se ofrece primero.

## Antes de cambiar una plantilla

Lo que escribas **lo va a leer un cliente**. Tres cosas que conviene revisar:

1. **Los campos existen.** Si escribís `{{clientee}}`, no se sustituye por nada.
2. **Se lee bien sin los datos.** Leé la frase imaginando que un campo sale vacío.
3. **El tono.** Es la voz de Ordenex ante el cliente, no una nota interna.

## Lo que esta pantalla NO hace

- **No manda mensajes.** Define el texto; quien lo manda es el mensajero desde su pantalla.
- **No cambia el número de SINPE.** El número es un campo del negocio, y hoy se configura fuera de la
  aplicación.
