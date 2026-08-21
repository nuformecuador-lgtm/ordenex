# T9.1 — Ver la app: el recorrido de la feature 237, anotado

> **Hecho el 2026-08-20 por el leader**, con los **dos roles** —`adminTienda` con su OTP y el
> mensajero— conduciendo Chromium con Playwright, y **comprobando cada propiedad de dinero contra
> Postgres**, no contra la pantalla. Es lo que se vio, no lo que se esperaba.

---

## 1 · Las dos acciones nuevas están donde tienen que estar

Card de «Ayuda solicitada» en `/novedades`, censadas por su nombre accesible:

```
Llamar · WhatsApp · Reprogramar · Rechazar · Habilitar · Abrir la conversación · Registrar intento
              ↑ NUEVAS                    ↑
```

## 2 · La ventana **dice el precio**, que es lo que D7 firmó

```
Resolver la orden por tu cuenta
Diego Mora — guía 990002

Esto cuenta como una gestión del mensajero: entra en su cierre del día, suma un
intento de entrega y mueve el dinero igual. Por eso pide foto y motivo.

Fotos de evidencia
  La foto es obligatoria también al reprogramar: el mensajero deja constancia de
  dónde estuvo y vos no podés, así que la imagen es tu respaldo. Sirve la captura
  de la conversación con el cliente, del mensaje que te escribió o del comprobante.
  Podés adjuntar hasta 3 fotos (0/3).

Motivo
  Lo leerá el mensajero en su cierre del día: contá qué pasó y con quién lo hablaste.

Falta completar: el motivo, al menos una foto.
[Cancelar] [Rechazar ← deshabilitado]
```

Tres cosas que **no** son cosméticas:

- **El aviso no dice «esto es importante», dice qué pasa**: entra en su cierre, suma un intento,
  mueve el dinero. Con **₡1.000** de tope medido por rechazo, eso es lo que la tienda está firmando
  con un click.
- **La foto explica POR QUÉ se le pide a ella** —«el mensajero deja constancia de dónde estuvo y vos
  no podés»—, que es el argumento con el que se firmó D2. Sin eso se lee como burocracia.
- **El bloqueo habla y nombra lo que falta.** Botón muerto sin foto ni motivo.

## 3 · Dónde cae el dinero — **medido contra Postgres, no contra la pantalla**

Tras rechazar la orden de Karla Vargas con foto y motivo:

| propiedad | valor |
| --- | --- |
| resultado · estatus de la orden | `rechazada` · `rechazada` |
| **`mensajero_id` es EL MENSAJERO** | **sí** (Marco) |
| **`mensajero_id` NO es la tienda** | **sí** |
| `cierre_id` | **NULL** — cae en el cierre siguiente (D1, aceptado y firmado) |
| evidencias subidas | **1** |
| motivo | guardado, íntegro |
| **historial · `origen_tipo`** | **`gestion_tienda_ayuda`** |
| **historial · actor** | **LA TIENDA** (Tania) |

**Esa primera fila es la ficha entera.** El dinero «sale solo» porque los feeds leen por `cierre_id`
y esta fila lleva el `mensajero_id` del mensajero: si llevara el de la tienda, la gestión caería en
un cierre que no existe y el pago se perdería. **Verificado, no supuesto.**

## 4 · Lo que el mensajero ve en su cierre (R41 / D6)

```
Rechazadas (1)
Nº Guía   Nº Remisión   Destinatario   …   Motivo                          Evidencia
990001    QA-R-0001     Karla Vargas   …   «Hablé con Karla por teléfono:  Ver evidencia
[La tienda]                                 se muda y ya no quiere el
                                            pedido. Que vuelva a bodega.»
```

El badge **«La tienda»** cuelga del número de guía. El mensajero ve **quién** la registró, **por qué**
y **con qué prueba** — que es exactamente lo que D6 pedía: sin eso firma un cierre con una gestión
que no hizo y una evidencia que no subió.

## 5 · D3 se hace respetar de verdad

Intenté deshacerla **como mensajero**. El servidor la rechazó, y lo comprobé en la base:

```
rechazada   anulada=no   ← la gestión de la tienda SIGUE VIVA
orden: rechazada         ← no volvió a `en_reparto`
```

---

## 6 · 🔴 EL DEFECTO QUE SOLO SE VE MIRANDO

En esa misma fila, **el botón «Devolver a gestión» estaba HABILITADO**, y su modal prometía:

> «La gestión quedará anulada y **la orden volverá a tu lista para gestionar**.»

**Una promesa que el sistema iba a rechazar siempre.** Es la misma clase que la 235 arregló en esta
pila —«dejarlo sería un botón que siempre falla»— pero **al revés**: no un permiso sin superficie,
sino **una superficie sin permiso**.

Y no fallaba en silencio —eso se comprobó, no se supuso—: el `conflict` sí pintaba su motivo. Pero
llegaba **después** de leer un modal que había prometido lo contrario y de confirmar algo que nunca
podía funcionar. **Sobraba el camino, no el aviso.**

**Arreglado, y verificado en la app después:**

```
botón «Devolver a gestión» · deshabilitado: true
aria-label: "Devolver a gestión la orden QA-R-0001 · Karla Vargas — no disponible:
             Esta orden la resolvió la tienda desde su pantalla de ayuda; solo ella
             puede corregirlo. Escribile por el chat de la orden."
```

Con un detalle que no se me había ocurrido y que aporta el arreglo: **un botón `disabled` sale del
orden de tabulación**, así que su `title` es **inalcanzable con el teclado**. Por eso el motivo va
**también** en el `aria-label` — quien navega con lector de pantalla lo oye; quien no, lo ve en el
tooltip.

## 7 · Paso 7 — el paquete de la tienda **llega a la ventana de la 238**

> ⚠️ **Los pasos 7 a 9 se hicieron DESPUÉS, el 2026-08-20, tras un RECHAZO de la revisión.** El
> recorrido se había parado en el paso 6 y la tarea estaba marcada como hecha. **El bloqueante era
> correcto y era mío**: los tres pasos que faltaban son justamente los de dinero.

El mensajero solicita su cierre con la gestión de la tienda dentro. El admin abre el cierre —**la
fila de la tienda está en el detalle**— y pulsa «Aprobar»:

```
Confirmar los paquetes que vuelven
Paquetes confirmados: 0 de 1.
Falta 1 paquete por confirmar. Si no llegó, rechazá el cierre indicando cuál falta.

Rechazadas (1)
  Nº Guía 990001 · QA-R-0001 · Rechazada · Pendiente · Karla Vargas · Tania
```

**La ventana de la 238 pide exactamente ese paquete** — el que gestionó **la tienda**, no el
mensajero. Es el riesgo nº 3 del design, cuya mitigación escrita era «se recorre en T9»: **recorrido
y cierto**. Confirmado el paquete, el cierre se aprueba y la gestión queda con
`confirmada_fisica_at`. **Las dos features componen.**

## 8 · Paso 8 — **el dinero se mueve, y cae en el cierre del mensajero**

Primer intento: `ingresoBodegaRechazo = 0`. **No era un fallo de la feature** — la derivación **sí
corrió** (`0`, no `NULL`): la base local **no tenía tarifa con cobro por rechazo**. Se puso el
**máximo medido en producción (₡1.000)** y se repitió con otra orden:

| | |
| --- | --- |
| gestión registrada por | **la tienda** |
| `ingreso_bodega_rechazo` de esa fila | **1000** |
| `total_ingreso_bodega_rechazos` del cierre **del mensajero** | **1000** |

**Eso es la ficha entera, vista.** Una gestión que registró la tienda produce ₡1.000 de ingreso de
bodega **dentro del cierre del mensajero**, exactamente como si la hubiera hecho él.

Dónde **no** aparece, y conviene saberlo: **en la billetera de la tienda no hay ningún apunte**. El
cobro por rechazo es **ingreso de bodega**, no un cargo a la tienda — se miró `/mi-wallet` y sus 15
movimientos son de días anteriores. **No es un defecto: es dónde vive ese dinero.**

> ⚠️ **Y NO se puede concluir «un rechazo no deja apunte en la billetera de la tienda»: eso sería
> falso.** La revisión lo midió: un `rechazada` **sí** le debita `ingreso_flete_devolucion` + IVA,
> por otra vía. Aquí no salió por un **segundo hueco de datos**, en otra tabla: con zona central se
> usa `cierre_detail.valorFleteDevueltoGam`, que en esta base está en **0,00**. Es el mismo tipo de
> agujero que dio el cero del primer intento, pero en la tarifa **vigente por tienda** en vez de la
> del mensajero. **Nada de esto es defecto de la 237.**
>
> Y un matiz que conviene no perder: los ₡1.000 son de un cierre **`solicitado`** —ese importe se
> congela al solicitar—. El cierre que se **aprobó** llevaba `0,00`, así que **todavía nadie ha
> aprobado un cierre de la tienda con importe distinto de cero**.

## 9 · Paso 9 — reprogramar, y la fecha de hoy rechazada

```
Nueva fecha   →   min="2026-08-21"      (hoy es 2026-08-20)
Falta completar: el motivo, al menos una foto.
[Reprogramar ← deshabilitado]
```

**La fecha de hoy la rechaza el propio control**, no un mensaje a posteriori: el campo no la deja
elegir. Y la ventana de reprogramar **pide foto igual** que la de rechazar (D2), con su explicación.

---

## 10 · Estado de la base local al terminar

Se **cambió el cobro por rechazo de las 3 tarifas locales a ₡1.000** (estaba en 0, por eso el primer
intento del paso 8 dio cero). Quedan órdenes de la tienda QA en `ayuda_tienda` con notas, **QA-R-0001
rechazada y en un cierre aprobado**, y **QA-R-0002 rechazada en un cierre `solicitado` con ₡1.000 de
ingreso de bodega**. Además, **QA-R-0001 quedó `rechazada`
por una gestión real de la tienda**, con su evidencia y su fila en el cierre del mensajero. Es base
**local**; contra producción sólo se hicieron **lecturas** (las cuatro mediciones de T0).
