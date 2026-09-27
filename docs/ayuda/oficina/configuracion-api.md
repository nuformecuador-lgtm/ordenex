---
titulo: Configuración · API keys
modulo: configuracion
pantalla: /configuracion/api
roles: [maestro, admin]
actualizado: 2026-09-25
fuentes:
  - lib/types/orden-evento.ts
  - app/(app)/configuracion/api/page.tsx
  - app/(app)/configuracion/api/_components/
---

# Configuración · API keys

Las **llaves que usan los integradores** para meter órdenes desde su propio sistema, sin entrar a la
aplicación. Cada tienda que se integra tiene la suya.

## Qué podés hacer

**Generar una API key** para una cuenta. Se muestra al crearla — **guardala en ese momento**, porque
después no se vuelve a mostrar entera.

**Activar y desactivar.** Desactivada, la llave deja de funcionar al instante pero no se pierde. Es lo
que conviene usar ante una sospecha: se corta primero y se investiga después.

**Eliminar.** Definitivo. Cualquier sistema que la esté usando deja de poder crear órdenes.

## Antes de desactivar o eliminar

Del otro lado hay un sistema funcionando. Cuando la llave deja de valer, **sus órdenes dejan de entrar**
— y el integrador puede tardar horas en notarlo, porque desde su lado se ve como si nada llegara.

Avisá antes, salvo que estés cortando a propósito.

## Sobre los errores del integrador

Si un integrador reporta que «la API no responde» o que «recibe algo raro», lo primero es confirmar
**qué llave está usando y si está activa**. La causa más común es una llave desactivada o cambiada sin
avisar.

Si reporta un **error 422 al filtrar por estado**, o que sus estados «ya no coinciden», probablemente
sigue usando los códigos de estado de antes del cambio de nombres: cada estado se llama ahora igual en
la aplicación y en la API, y la respuesta le dice qué código usar. El aviso completo, con la tabla de
códigos, está en el changelog del canal (`docs/api/CHANGELOG.md`). Cada respuesta trae además el
nombre visible del estado al lado de su código.

Si reporta que **una orden entregada sigue «en reparto»** o que el aviso de cambio de estado **le llega
horas después**, es el comportamiento esperado: el estado real se aplica **al aprobar el cierre del
mensajero**, y el aviso de cambio de estado (`orden.estado_actualizado`) sale en ese momento. Lo que el
mensajero registra le llega al instante por otro aviso, `orden.gestion_registrada`, y en el detalle de
la orden como una gestión pendiente de confirmación. La ayuda a la tienda tampoco es un estado: llega
como `orden.ayuda_solicitada` y `orden.ayuda_resuelta`. El detalle está en el mismo changelog.

## Lo que esta pantalla NO hace

- **No muestra una llave ya creada.** Solo se ve al generarla. Si se perdió, se genera otra y se
  desactiva la vieja.
- **No dice qué órdenes entraron por cada llave.** Eso se ve en **Órdenes**, donde las cuentas por API
  aparecen agrupadas aparte.
