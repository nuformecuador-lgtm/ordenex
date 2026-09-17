---
titulo: Mi bodega
modulo: mi-bodega
pantalla: /mi-bodega
roles: [adminSatelite]
actualizado: 2026-09-16
fuentes:
  - app/(app)/mi-bodega/page.tsx
  - app/(app)/mi-bodega/_components/MiBodegaSinpeModule.tsx
  - components/shared/SinpeCampos.tsx
  - components/shared/SinpeMensajePreview.tsx
  - components/shared/RevisionSinpeBodega.tsx
  - components/shared/sinpe-textos.ts
  - lib/actions/sinpe-bodega.ts
  - lib/auth/revision-sinpe-pendiente.ts
  - lib/utils/sinpe-cr.ts
  - lib/auth/menu-visibility.ts
---

# Mi bodega

El **número de SINPE de tu bodega**: al que transfieren tus clientes cuando pagan por SINPE. Lo usan
todos los mensajeros de tu bodega.

## Qué se pone

- **Número SINPE** — 8 dígitos que empiecen por 6, 7 u 8. Es la numeración móvil de Costa Rica, y
  SINPE Móvil solo funciona sobre una línea móvil. Podés escribirlo con espacios, con guiones o con
  el `+506` delante: se guarda como los ocho dígitos, y al guardar la pantalla te enseña cómo quedó.
- **A nombre de** — el titular, **tal como aparece en SINPE Móvil al teclear el número**. No como se
  llama la empresa en los papeles: como lo va a ver el cliente en su teléfono.

**Guardar** se enciende cuando cambiás algo, y **Cancelar** te devuelve a lo que estaba guardado. Si
algo está mal, el error sale **junto al campo**, no como un aviso suelto.

## La vista previa es la pieza importante

Al lado —debajo, si estás en el teléfono— se arma **el mensaje completo que va a leer el cliente**,
con tu número y tu titular resaltados dentro de la frase.

Revisalos **juntos**. Cuando el cliente teclea el número, SINPE Móvil le enseña a nombre de quién
está: si no coincide con lo que dice el mensaje, no va a pagar y te va a escribir preguntando.

Si te dice que **no se pudo cargar el mensaje**, no hay con qué comparar. El número y el nombre de
arriba se guardan igual.

## La última revisión

Al pie de la tarjeta va **la fecha de la última revisión**, en horario de Costa Rica. Mientras nadie
haya tocado ese número dentro de la aplicación, ahí dice que **nadie lo ha revisado todavía**, y el
número que hay es el de la central: válido, pero ese cobro entra a la central y no a tu bodega.

**Ahí va la fecha, no la persona.** Quién lo cambió sí queda registrado, pero en el registro de
acciones de la oficina, que desde acá no se consulta.

## El aviso que te aparece al entrar

Mientras tu bodega esté sin revisar, al iniciar sesión te sale un aviso pidiéndote que la confirmes.
Podés **Confirmar** si el número que hay ya es el bueno, corregirlo ahí mismo, o dejarlo para
después con **Ahora no**. No bloquea nada: te deja trabajar igual y vuelve a aparecer en el
siguiente inicio de sesión. Una vez revisada, no vuelve a preguntárselo a nadie de tu bodega.

## Por qué se pide con tanto cuidado

**Un número mal escrito no da error.** Ocho dígitos cualquiera son válidos para el sistema. La plata
de tus clientes se iría a una cuenta equivocada y te enterarías días después, por los reclamos. Por
eso queda registrado quién lo cambió y cuándo.

## Si dice «Tu cuenta todavía no está asignada a una bodega»

Sin bodega no hay un SINPE que configurar. No es algo que se arregle desde acá: pedile a la oficina
que te asigne la tuya y volvé a entrar.

## Lo que esta pantalla NO hace

- **No muestra tu dinero.** Los cierres de tu bodega están en **Cierres del día**.
- **No cambia el texto del mensaje.** Solo el número y el titular que van dentro; el resto de la
  frase la arma la oficina.
- **No afecta a lo ya cobrado.** Lo que entró al número anterior ya entró ahí.
- **No toca las otras bodegas.** Acá solo se ve y se cambia la tuya.
