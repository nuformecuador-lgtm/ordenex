---
titulo: En bodega
modulo: recepcion-satelite
pantalla: /recepcion-satelite/en-bodega
roles: [adminSatelite]
actualizado: 2026-09-15
fuentes:
  - app/(app)/recepcion-satelite/_components/SateliteOrdenesListado.tsx
  - app/(app)/recepcion-satelite/_components/satelite-ordenes-filtros.ts
  - app/(app)/recepcion-satelite/_components/asignacion-satelite-bloqueo.ts
  - lib/services/AsignacionSateliteService.ts
  - lib/repositories/OrdenRepository.ts
---

# En bodega

Es tu pantalla de trabajo: **todo lo que tenés en la bodega** y desde acá lo repartís entre tus
mensajeros.

Solo ves órdenes de tu zona. No hace falta filtrar por bodega — la pantalla ya viene acotada.

## Asignar a un mensajero

Seleccionás las órdenes, elegís el mensajero y confirmás. Podés asignar **varias de una vez**.

Si te equivocaste, **Deshacer asignación** la devuelve a la bodega para volver a repartirla.

> **Una orden sin ubicación en el mapa** no se puede rutear bien, así que la app te pide que
> **autorices la asignación sin ubicación** antes de dejarte seguir. Es un aviso, no un bloqueo:
> confirmás y se asigna igual. Sirve para que sepas que ese paquete no va a entrar en la ruta
> optimizada del mensajero.

## Enviar a central

Lo que no corresponde a tu zona o vuelve para atrás lo mandás con **Enviar a central**. Al hacerlo se
genera el envío y podés **descargar el manifiesto** para que viaje con la carga.

## Buscar y filtrar

El buscador cubre guía, remisión, teléfono, destinatario y producto a la vez.

Con **Filtros** agregás: estado, mensajero, provincia, cantón, distrito, fecha de creación y **salida a
reparto** —que separa las que ya salieron alguna vez con un mensajero de las que solo tienen la guía
generada—.

## Cosas que te pueden pasar

**La app no te deja asignar.** Es lo más común, y siempre es por lo mismo: **tenés un cierre de bodega
pendiente**. Mientras la central no lo resuelva, tu bodega no puede repartir trabajo nuevo. La pantalla
te dice cuál es. Resolvelo con la central y se te habilita.

**Un mensajero no aparece en la lista.** Solo salen los mensajeros de tu zona. Si falta alguno, hay que
revisar a qué zona está asignado — eso lo hace la oficina.

**Asignaste y no se aplicó ninguna.** Las asignaciones van en lote y son **todo o nada**: si una falla,
no se aplica ninguna. Así no te quedás sin saber cuáles entraron y cuáles no.

## Lo que esta pantalla NO hace

- **No se reciben paquetes acá.** Eso es **Por recibir**.
- **No se cierra el día.** Los cierres de tus mensajeros están en **Cierres**.
