# Feature 193 — Ubicación del mensajero en cada gestión de orden

**Requisitos en notación EARS.** Sin detalles de implementación (esos van en `design.md`).
Cada `R<n>` debe terminar mapeado a un test concreto (`docs/specs.md > Trazabilidad`);
el mapa vive en `design.md §8` y lo verifica el reviewer.

> **Punto de partida, verificado en el código (no supuesto).** La tubería de `ubicacion`
> ya existe de punta a punta y **nadie la alimenta al gestionar**:
>
> - `ubicacionSchema` valida `{lat, lng}` con rangos geográficos — `lib/types/ruta-mensajero.ts:19`
> - la Server Action ya recompone `ubicacionLat`/`ubicacionLng` del `FormData`, y **solo si
>   vienen los dos** — `lib/actions/mis-asignaciones.ts:222-225`
> - `ubicacion` ya es transversal a las cuatro ramas de gestión y a recoger —
>   `lib/types/gestion-orden.ts:148-196`
> - pero el único `getCurrentPosition()` del repo vive en `SincronizarRutaButton.tsx:37`,
>   un botón aparte, y **ningún formulario de gestión escribe esos campos**.
>
> Esta feature **conecta** lo que ya está y **añade la persistencia por gestión**, que hoy
> no existe: la ubicación que llega solo sobrescribe el origen de `ruta_optimizada`
> (`MisAsignacionesService.registrarUbicacion`, `:93-106`), una fila por mensajero.

## Glosario (vocabulario cerrado, para que los requisitos no se interpreten)

- **Gestión**: el registro del desenlace de una orden en manos del mensajero. Su resultado
  es uno de los cinco valores del enum `gestion_resultado`: `entregada`, `reprogramada`,
  `devuelta`, `rechazada`, `incidente`.
- **Ubicación**: par `{lat, lng}` en grados decimales, dentro de los rangos del sistema de
  coordenadas (`lat ∈ [-90, 90]`, `lng ∈ [-180, 180]`).
- **Captura**: el intento del navegador de obtener la ubicación actual del dispositivo.
- **Denegación**: la captura falla **porque la persona negó el permiso** al navegador.
  Es una decisión del usuario y es reversible desde los ajustes del navegador.
- **Fallo técnico**: la captura falla por cualquier motivo que **no** es una denegación:
  tiempo agotado, posición no disponible (sin señal), navegador sin soporte, o contexto no
  seguro (sin HTTPS). No es una decisión de nadie y **no** es reversible por la persona en
  el momento.
- **Motivo de ausencia**: valor de una lista cerrada que explica por qué una gestión no
  lleva ubicación. Nace con: `timeout`, `no_disponible`, `no_soportado`, `contexto_inseguro`.
  La denegación **no** figura: nunca llega a persistirse (ver R12).

---

## A. Persistencia

**R1** — El modelo `gestion_orden` DEBE tener dos columnas nuevas, latitud y longitud, que
guarden la ubicación del mensajero en el instante de registrar la gestión.

**R2** — Ambas columnas DEBEN ser **nullable** en la base de datos, sin `CHECK` de
obligatoriedad *(decisión humana del 2026-08-10)*. Es el mismo patrón que `monto_recibido`,
`metodo_pago`, `causa_devolucion` y `causa_incidente`: la obligatoriedad vive en el borde.

**R3** — La migración NO DEBE rellenar («backfillear») las filas existentes. Una gestión
anterior a esta feature DEBE quedar con ambas columnas a `NULL`.

**R4** — Las columnas DEBEN usar el mismo tipo decimal de precisión fija que ya emplean
`geocode_cache` y `ruta_optimizada.origen_lat`/`origen_lng` para geolocalización propia.

**R5** — El modelo `gestion_orden` DEBE tener además una columna nullable con el **motivo de
ausencia**, restringida a la lista cerrada del glosario.

**R6** — SI una gestión tiene ubicación, ENTONCES el motivo de ausencia DEBE ser `NULL`; y
SI no la tiene por un fallo técnico, ENTONCES el motivo DEBE estar presente. Ambas columnas
de coordenada DEBEN estar las dos presentes o las dos ausentes: **media coordenada no es una
ubicación**.

**R7** — La tabla DEBE conservar su postura de privacidad actual y NO DEBE exponer las
coordenadas al cliente en este ciclo *(decisión humana del 2026-08-10)*. La columna nace de
**solo escritura**: que no tenga consumidores de lectura NO es código muerto, es el estado
esperado (mismo patrón declarado para `causa_devolucion` en la feature 73).

---

## B. Borde: qué se acepta y qué se rechaza

> Esta sección **acota** la R25 de la feature 92 (`ruta-mensajero.ts:17`: «SIEMPRE OPCIONAL
> en sus consumidores: denegar el permiso no puede bloquear nada»). Esa regla **sigue
> vigente para la sincronización de ruta**; aquí, y solo en la gestión de una orden, la
> denegación pasa a bloquear por decisión humana del 2026-08-10. La contradicción se declara
> a propósito en vez de dejarla silenciosa.

**R8** — El borde DEBE aceptar una gestión que trae ubicación válida.

**R9** — El borde DEBE aceptar una gestión sin ubicación **siempre que** traiga un motivo de
ausencia de la lista cerrada.

**R10** — El borde DEBE rechazar una gestión que no trae ni ubicación ni motivo de ausencia.

**R11** — El borde DEBE rechazar una gestión que trae ubicación **y** motivo de ausencia a
la vez: son estados excluyentes y aceptarlos juntos haría indistinguible el dato bueno del
justificado.

**R12** — El borde DEBE rechazar una gestión cuyo motivo de ausencia sea la denegación del
permiso *(decisión humana)*. El valor no pertenece a la lista cerrada, de modo que el rechazo
es estructural y no depende de una comprobación aparte.

**R13** — El borde DEBE rechazar coordenadas fuera de los rangos del sistema de coordenadas,
reutilizando `ubicacionSchema` en vez de redeclarar los rangos.

**R14** — Los requisitos R8–R13 DEBEN regir **por igual en las cinco ramas** de resultado.
Ninguna rama puede tener una regla propia: «sea cual sea el resultado» es el pedido.

**R15** — El comportamiento de `recogerOrdenes` y de `sincronizarRuta` NO DEBE cambiar: su
`ubicacion` sigue siendo opcional y una denegación sigue sin bloquearlos (R25 de la 92).

---

## C. Frontend: captura

**R16** — CUANDO el mensajero confirme una gestión, el sistema DEBE intentar capturar la
ubicación actual **antes** de enviarla, sea cual sea el resultado elegido.

**R17** — SI la captura tiene éxito, ENTONCES el sistema DEBE enviar las coordenadas junto
con la gestión.

**R18** — SI la captura falla por un **fallo técnico**, ENTONCES el sistema DEBE enviar la
gestión con el motivo de ausencia correspondiente, y la gestión DEBE completarse con
normalidad.

**R19** — SI la captura falla por **denegación**, ENTONCES el sistema NO DEBE enviar la
gestión, y DEBE explicar que el permiso de ubicación es obligatorio **y cómo reactivarlo**.
Un mensaje que solo diga que falta la ubicación deja al mensajero sin salida.

**R20** — La captura NO DEBE quedarse esperando indefinidamente: DEBE tener un tiempo máximo,
pasado el cual se trata como fallo técnico (R18).

**R21** — MIENTRAS la captura está en curso, el sistema DEBE indicar que está obteniendo la
ubicación y DEBE impedir el envío duplicado de la misma gestión.

**R22** — El sistema NO DEBE pedir la ubicación al abrir el formulario ni al navegar: solo
al confirmar. Pedir el permiso sin una acción que lo justifique es como se consigue que la
persona lo deniegue para siempre.

---

## D. Trazabilidad y no-regresión

**R23** — Una gestión con ubicación DEBE seguir produciendo exactamente los mismos efectos
que hoy en el estado de la orden, el historial y los importes. Esta feature NO toca dinero.

**R24** — La anulación de una gestión NO DEBE borrar ni alterar su ubicación: el rastro de
dónde se hizo sobrevive a que se deshaga (mismo criterio que el resto de columnas ante
`anulada_at`).

**R25** — El sistema DEBE conservar el comportamiento existente por el que la ubicación
recibida actualiza el origen de la ruta optimizada. La persistencia nueva **se suma**, no
sustituye a `registrarUbicacion`.
