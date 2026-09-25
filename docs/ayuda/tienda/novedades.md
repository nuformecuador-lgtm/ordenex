---
titulo: Novedades
modulo: novedades
pantalla: /novedades
roles: [adminTienda]
actualizado: 2026-09-25
fuentes:
  - app/(app)/novedades/_components/NovedadesTabs.tsx
  - app/(app)/novedades/_components/novedad-grupo-textos.ts
  - app/(app)/novedades/_components/GestionarDesdeAyudaModal.tsx
  - app/(app)/novedades/_components/HabilitarNovedadModal.tsx
  - lib/repositories/ayuda-abierta.ts
  - components/shared/EstadoInfo.tsx
  - lib/types/order-status.ts
  - app/(app)/novedades/_components/NovedadesModule.tsx
  - app/(app)/novedades/_components/NovedadesFiltrosBarra.tsx
  - app/(app)/novedades/_components/novedades-filtros.ts
  - app/(app)/novedades/_components/RechazosSlaModule.tsx
---

# Novedades

Acá llegan **las órdenes que necesitan algo de vos**. Es la pantalla de los problemas: si una entrega
se trabó, aparece en esta lista esperando que decidás qué hacer.

Si no entrás nunca acá, esas órdenes se quedan quietas. Conviene revisarla todos los días.

## Las tres listas

**Ayuda solicitada.** El mensajero no puede resolver una entrega sin vos y te pide que intervengas: el
teléfono no contesta, la dirección no aparece, el cliente no estaba. Vos tenés el dato que falta. Cada
orden trae el mensaje del mensajero y la marca **Esperando tu respuesta**.

> **La ayuda es un aviso, no un estado.** La orden **sigue En reparto**, con el paquete encima del
> mensajero: por eso su tarjeta dice **En reparto**. En **Órdenes** esa misma orden lleva al lado una
> nota que dice que se solicitó ayuda a la tienda, con su botón **(i)**: el paquete sigue en reparto
> hasta que se registre su gestión.

**Novedad.** Órdenes en estado **Novedad**: el mensajero no pudo entregarlas, y aparecen con la causa.
Vos decidís si se vuelve a intentar o se devuelven. Una orden llega acá **cuando se aprueba el cierre
del mensajero**; antes de eso la vas a ver en **Órdenes** como «Novedad · pendiente de confirmación».

**Devolución a origen por plazo vencido.** Las que se pasaron del plazo sin resolverse y pasaron a
**Devolución a origen por rechazo**. Es una lista de consulta:
se mira para saber qué pasó, no se actúa desde ahí.

## Qué podés hacer

**Habilitar.** Volvés a poner la orden en la ruta. Se usa cuando resolviste lo que la trabó —corregiste
el teléfono, confirmaste la dirección, hablaste con el cliente—. La orden vuelve al mensajero. En una
orden con ayuda solicitada, habilitar **cierra la ayuda** y el mensajero la puede gestionar de nuevo.

**Resolver la orden por tu cuenta** (solo en **Ayuda solicitada**). Si ya sabés cómo termina, podés
**Reprogramar** o **Rechazar** vos mismo, con foto y motivo. **Cuenta como una gestión del mensajero**:
entra en su cierre del día y suma un intento de entrega. Igual que las del mensajero, **queda pendiente
de confirmación**: la orden sigue En reparto —con «Reprogramado · pendiente de confirmación» o
«Devolución a origen por rechazo · pendiente de confirmación»— hasta que se apruebe su cierre. El
mensajero no la puede deshacer.

**Corregir los datos del cliente.** Destinatario, teléfono, producto y notas. Acá es donde se corrigen,
no en Órdenes, porque el dato malo suele ser justamente la causa de la novedad.

**Cobrar.** Cuando corresponde registrar un cobro sobre esa orden.

**Ver el detalle completo** y **ver la ruta en el mapa**, para entender dónde se trabó.

## Encontrar la orden que buscás

El buscador y los filtros funcionan dentro de la lista en la que estés: podés acotar por **mensajero**,
**zona**, **provincia** y **cantón**.

Cada lista tiene además un filtro propio:

- En **Novedad**: la **causa de devolución**.
- En **Ayuda solicitada**: **sin intentos de contacto** — las que el mensajero todavía no intentó
  contactar. Suelen ser las más fáciles de resolver.

## Cosas que te pueden pasar

**«Ninguna orden coincide con lo que buscaste».** Tenés filtros puestos que no dejan pasar nada. Tocá
**Limpiar la búsqueda**.

**«No se pudo habilitar la orden».** Algo cambió mientras mirabas —quizá la oficina ya la movió—.
Recargá y volvé a mirar en qué estado quedó.

**«Tu sesión expiró».** Volvé a iniciar sesión; no perdés nada.

## Qué significa cada estado

Junto a cada estado hay un botón **(i)**: tocalo y te explica qué significa. En el teléfono se abre al
tocar y se cierra al tocar fuera.

## Lo que esta pantalla NO hace

- **No se crean órdenes acá.** Eso es **Órdenes**.
- **No se reasigna el mensajero.** Habilitar la devuelve a la ruta; quién la lleva lo decide la oficina.
