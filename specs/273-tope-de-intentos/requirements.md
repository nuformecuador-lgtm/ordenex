# Feature 273 — El tope de intentos se cierra: al alcanzarlo la orden no vuelve a circulación

> **Esto no es una feature nueva: es cerrar una regla que el sistema ya dice tener y no cumple.**
>
> Medido contra producción el **2026-08-24**: la guía **28098171** llevaba **3 intentos vigentes** y
> seguía en `devuelta` sin rechazarse. El umbral existe desde la feature 47, el contador desde la
> 215, y aun así una orden puede salir a un **4.º intento**.
>
> **La raíz, medida y no re-derivada aquí:** de los cinco resultados de gestión
> (`ESTATUS_POR_RESULTADO`, `lib/types/gestion-destino.ts`) **solo `devuelta`** difiere su efecto
> —espera la aprobación del cierre desde la feature 239—. `reprogramada` cambia el estado **en el
> acto**, y `LiberacionReprogramadaRepository.findOrdenesLiberables` devuelve la orden a bodega por
> `fecha_reprogramacion <= hoyCR` **sin mirar el cierre en ningún punto**. La orden vuelve a
> circulación con el contador todavía en el valor viejo: ahí nace el 4.º intento.
>
> Y la última puerta tampoco está puesta: **`GuiaAsignacionService` no consulta el contador en
> ningún punto**, así que hoy se puede asignar una orden que ya agotó sus intentos.

---

## ⚠️ ESTA FICHA ACELERA DINERO. Léase antes de tocar nada.

`rechazada` emite `cobroRechazado` (feature 56, **dinero real**: hasta ₡1.000 medidos en producción
el 2026-08-20, ingreso de bodega que cae en el cierre del mensajero atribuido).

Hasta hoy el sistema erraba **a propósito** hacia **NO cobrar**. Está escrito en tres sitios y con
su medida: `specs/215-reintento-en-cierre/design.md` §7bis (Q5, decisión **D14** del humano del
2026-08-13, medida el 2026-08-14 sobre 12 cierres), el docstring de `whereIntentosVigentes`
(«contar de menos retrasa el escalado —inofensivo para la tienda—; contar de más cobra un
`cobroRechazado` antes de tiempo») y el de `RESULTADOS_QUE_CUENTAN_COMO_INTENTO` («ante ausencia de
dato, no se cuenta»).

**Desde esta ficha esa asimetría se rompe en una dirección concreta:** el contador deja de ser un
número que solo *retrasa* un escalado y pasa a ser un número que **cierra puertas y termina órdenes
en `rechazada`**. Un error de conteo hacia arriba ya no retrasa nada: **cobra de más, y antes.**

Lo que esta ficha hace para que ese riesgo no crezca en silencio, y es un requisito (R31/R32):
**no toca el criterio de conteo**. Ni los resultados que cuentan, ni las familias de visita real,
ni el ancla en el cierre aprobado, ni el grano por cierre. El número no cambia: cambia **lo que ese
número dispara**. Quien quiera cambiar el número lo hará en otra ficha, leyendo esto antes.

---

## Vocabulario

| Término | Qué significa aquí |
| --- | --- |
| **intentos vigentes** | El número que devuelve `contarIntentosVigentes` (feature 215): cierres **aprobados** distintos en los que la orden tuvo una gestión vigente con resultado `rechazada`/`devuelta`/`reprogramada` **nacida de una visita real**. Esta ficha lo consume; no lo redefine. |
| **umbral** | `reintentosConfig.MIN_INTENTOS_ENTREGA` (`lib/config/reintentos.ts`, env `REINTENTOS_MIN_INTENTOS`, default 3). **Nunca un 3 escrito a mano.** |
| **el tope** | El estado de una orden cuyos intentos vigentes son `>= umbral − 1`: la gestión que se registre ahora es la que alcanza el umbral. |
| **volver a circulación** | Que la orden vuelva a estar disponible para que alguien la reparta: pasar a una bodega (`en_bodega_central` / `en_bodega_satelite`) y/o ser asignada a un mensajero (`por_recoger`). |
| **gestión de visita real** | Gestión cuya fila de historial nace con un `origen_tipo` de `ORIGEN_TIPOS_VISITA_REAL` (`gestion`, `gestion_tienda_ayuda`). Es la sexta condición del predicado de intentos, y es la que separa una visita de una gestión **sintética** del sistema. |
| **las dos superficies que crean gestión** | El panel del mensajero (`MisAsignacionesService.gestionar`) y la pestaña de ayuda de la tienda (`GestionDesdeAyudaService.gestionar`, feature 237). |

---

## A · La puerta en la gestión

**R1.** MIENTRAS los intentos vigentes de una orden sean mayores o iguales al umbral menos uno, el
sistema NO DEBE aceptar una gestión sobre esa orden con resultado `reprogramada` ni con resultado
`devuelta`.

**R2.** MIENTRAS los intentos vigentes de una orden sean mayores o iguales al umbral menos uno, el
sistema DEBE seguir aceptando las gestiones con resultado `entregada`, `rechazada` e `incidente`,
sin ninguna condición nueva.

**R3.** El sistema DEBE decidir R1 y R2 con una **lista de inclusión** de los resultados admitidos
en el tope, declarada en un punto único; un resultado de gestión futuro NO DEBE quedar admitido por
omisión.

**R4.** El sistema DEBE aplicar R1 en el **servidor**, y DEBE aplicarlo por igual en las dos
superficies que crean gestión (el panel del mensajero y la pestaña de ayuda de la tienda).

**R5.** CUANDO el servidor rechace una gestión por R1, el sistema NO DEBE producir ningún efecto:
ni fila de `gestion_orden`, ni transición de estado, ni fila de historial, ni evidencia persistida
en el almacenamiento de archivos.

**R6.** CUANDO el servidor rechace una gestión por R1, el sistema DEBE devolver un resultado de
dominio (no una excepción) con un motivo accionable que diga qué desenlaces sí quedan disponibles,
sin nombrar datos del destinatario ni de la orden.

**R7.** El sistema DEBE resolver el umbral desde la configuración (`REINTENTOS_MIN_INTENTOS`) en
todos los puntos que esta feature añade, y NO DEBE contener el valor del umbral escrito en el
código en ninguno de ellos.

---

## B · Lo que la UI acompaña

**R8.** MIENTRAS una orden esté en el tope, las dos superficies que crean gestión NO DEBEN ofrecer
los desenlaces que R1 prohíbe.

**R9.** CUANDO una superficie deje de ofrecer un desenlace por R8, DEBE explicar por qué en un
texto visible, sin usar siglas ni nombres de columna.

**R10.** El sistema NO DEBE enviar el umbral al cliente. La decisión de R8 DEBE viajar al cliente
como un dato **ya derivado en el servidor**.

**R11.** El sistema NO DEBE hacer depender el rechazo del servidor de que la interfaz haya ocultado
el desenlace: una petición que pida un resultado prohibido DEBE ser rechazada igual (R1/R5).

---

## C · La reprogramación espera a la aprobación del cierre

**R12.** CUANDO la gestión `reprogramada` vigente más reciente de una orden nazca de una **visita
real**, el sistema NO DEBE devolver esa orden a una bodega hasta que el cierre al que pertenece esa
gestión esté **aprobado**.

**R13.** MIENTRAS se cumpla la condición de R12 y el cierre no esté aprobado, la orden DEBE
permanecer en `reprogramada` sin que ninguna corrida del cron de liberación cambie su estado, su
mensajero asignado, su día de reparto ni su marca de prioridad.

**R14.** SI la gestión `reprogramada` vigente más reciente de una orden **no** nace de una visita
real, ENTONCES el sistema DEBE liberarla con el criterio de fecha que ya tiene hoy, sin esperar
ninguna aprobación.

**R15.** CUANDO el cierre se apruebe después de que la fecha de reprogramación ya haya llegado, el
sistema DEBE liberar la orden en la primera corrida del cron posterior a esa aprobación.

**R16.** El cron de liberación DEBE seguir siendo idempotente y resiliente por orden: una segunda
corrida sobre la misma orden no produce un segundo efecto, y el fallo de una orden no aborta la
corrida.

**R17.** MIENTRAS una orden esté en `reprogramada` y su gestión no pertenezca todavía a ningún
cierre, el mensajero DEBE poder deshacer esa gestión con la ventana de deshacer que ya existe, y el
conteo de intentos DEBE volver a no incluirla.

---

## D · La asignación

**R18.** MIENTRAS los intentos vigentes de una orden sean mayores o iguales al umbral, el sistema
NO DEBE permitir asignarla a un mensajero, ni desde la bodega central ni desde una bodega satélite.

**R19.** SI alguna orden de un lote de asignación incumple R18, ENTONCES el sistema DEBE rechazar
el **lote completo** sin efectos, devolviendo un motivo por orden.

**R20.** El motivo del rechazo de R18 DEBE salir de un punto único y ser el mismo texto en las dos
superficies de asignación.

---

## E · La no gestión del corte (absorbe la ficha 218)

**R21.** CUANDO se apruebe un cierre y una orden barrida a `sin_gestionar` por **ese** cierre tenga
intentos vigentes mayores o iguales al umbral, el sistema DEBE dejarla en `rechazada` en lugar de
devolverla a una bodega, dentro de la **misma transacción** que aprueba el cierre.

**R22.** CUANDO ocurra R21, el sistema DEBE registrar la transición por el punto único de escritura
del historial, con el administrador que aprobó como actor y con una **familia de origen propia**,
distinta de todas las existentes.

**R23.** CUANDO ocurra R21, el sistema DEBE crear una gestión con resultado `rechazada` atribuida
al mensajero del cierre y **sin cierre asignado**, de modo que el ingreso de bodega por rechazo lo
recoja el siguiente cierre de ese mensajero. *(Pendiente de firma: pregunta abierta **Q1**.)*

**R24.** CUANDO ocurra R21, el sistema NO DEBE alterar ningún importe, ningún movimiento de
billetera ni el snapshot del cierre que se está aprobando.

**R25.** SI una orden barrida a `sin_gestionar` tiene intentos vigentes menores que el umbral,
ENTONCES el sistema DEBE liberarla a la bodega responsable exactamente como lo hace hoy.

**R26.** CUANDO la aprobación de un mismo cierre se ejecute más de una vez, el sistema NO DEBE
producir un segundo rechazo, ni una segunda gestión, ni una segunda fila de historial para la misma
orden.

**R27.** SI un cierre se **rechaza**, ENTONCES ninguna orden `sin_gestionar` DEBE quedar en
`rechazada` ni recibir gestión alguna.

---

## F · El cron de SLA de devoluciones

**R28.** MIENTRAS una orden repose en `devuelta` con causa `wrong_number` o `wrong_address` y sus
intentos vigentes sean mayores o iguales al umbral, el sistema DEBE escalarla a `rechazada` en la
primera corrida del cron posterior a su anclaje, **sin esperar su ventana de cinco días**.

**R29.** MIENTRAS los intentos vigentes de esa orden sean menores que el umbral, la ventana de
cinco días DEBE seguir aplicándose sin cambio alguno.

**R30.** El cron DEBE seguir siendo idempotente y resiliente por orden, y NO DEBE emitir dos veces
el ingreso por rechazo de la misma orden.

---

## G · El invariante, y el criterio que no se toca

**R31.** El sistema NO DEBE devolver a circulación ninguna orden cuyos intentos vigentes hayan
alcanzado el umbral.

**R32.** El sistema NO DEBE dejar que una orden vuelva a estar disponible para asignación mientras
exista sobre ella una gestión de visita real vigente que **todavía pueda subir su contador** (es
decir, que no esté en un cierre aprobado).

**R33.** Esta feature NO DEBE modificar el criterio de conteo de intentos: ni los resultados que
cuentan, ni las familias de visita real, ni el ancla en el cierre aprobado, ni el grano por cierre.
El número que hoy ve cualquier superficie DEBE seguir siendo el mismo número.

**R34.** El sistema DEBE mantener el criterio de conteo de intentos y el criterio de anclaje de la
devolución como dos derivaciones separadas (invariante heredado de 239/R16): esta feature no las
fusiona ni deriva una de la otra.

---

## H · Datos, despliegue y registros

**R35.** El sistema NO DEBE mover ninguna orden entre estados desde SQL de migración: toda
transición DEBE pasar por el punto único de escritura de estado.

**R36.** Toda migración de esta feature DEBE traer su reversión, y esa reversión DEBE dejar la base
en un estado que el código anterior pueda leer.

**R37.** ANTES de desplegar, el sistema DEBE permitir enumerar con una consulta de **solo lectura**
las órdenes vivas cuyos intentos vigentes ya alcanzan el umbral, y en qué estado están.

**R38.** Ningún registro, motivo, aviso o log que esta feature produzca DEBE contener datos
personales, números de guía, identificadores de cliente ni secretos.

---

## Fuera de alcance

- Cambiar el **valor** del umbral o su forma de configurarse (feature 47).
- Cambiar el **criterio de conteo** de intentos (feature 215). R33 lo prohíbe explícitamente.
- La alerta operativa sobre población atascada esperando aprobación de cierre (M3 del §7bis de la
  215): sigue siendo ficha aparte, y esta feature **amplía** la población que puede quedarse
  esperando (ver «Riesgo declarado»).
- Un backfill de las órdenes que hoy ya están en el umbral: **decisión del humano del 2026-08-24,
  sin backfill**. La única orden viva medida escala sola por el cron de SLA.
- La pestaña «Por recoger» y su contador (ficha 274).

---

## Riesgo declarado y aceptado: la congelación se amplía

Con R12, una orden `reprogramada` cuyo cierre nadie apruebe **se queda quieta**: no vuelve a
bodega, no se reasigna y no se reparte. Es exactamente el riesgo que la 239 aceptó por escrito para
`devuelta` («el daño pasa de dinero mal cobrado a mercadería parada»), y aquí se extiende a la
reprogramación.

Lo que lo acota, y no es teoría: el supuesto operativo declarado en 215/§7bis («el cierre se
cerrará en algún momento por un usuario», medido el 2026-08-14: 12 cierres, 12 aprobados, cero
abiertos), y la **válvula de escape** que ya existe —`forzarSolicitudVencido` devuelve a
`solicitado` los cierres `vencido` y `rechazado`, así que ningún cierre queda fuera del alcance de
una aprobación posterior—.

Lo que **no** lo acota: nada avisa hoy de una orden congelada. R37 entrega el mínimo (poder
contarlas antes de desplegar); la vigilancia continua sigue siendo la ficha M3.

---

## Preguntas abiertas

Las marcadas **[FIRMA]** cambian dinero o producto y **no se implementan sin respuesta humana**.

**Q1 · ¿El rechazo por no gestión (R21) cobra `cobroRechazado`? [FIRMA — dinero]**
El humano decidió que la orden «queda `rechazada`»; no dijo si eso cobra.
**Recomendación: sí cobra**, por la vía de siempre —gestión sintética `resultado = rechazada` con
`cierre_id NULL`, que el siguiente cierre del mensajero recoge (Option A de la 99, ratificada por
240/D1)—. Razón, que es literal de la 240: *«sin la gestión, rechazar saldría gratis y esperar al
plazo costaría —sobre el mismo paquete—»*. Un rechazo por agotamiento de intentos que no cobra crea
un incentivo perverso: **no gestionar sale más barato que gestionar**.
Si la respuesta es **no**: R23 se retira, su test se invierte (afirmar que NO nace gestión ni
movimiento) y hay que escribir aquí por qué este rechazo vale menos que los otros tres.

**Q2 · ¿La tienda puede seguir reprogramando desde una devolución anclada cuando la orden ya está
en el umbral? [FIRMA]**
`reprogramarDesdeDevuelta` (feature 100, `devuelta -> reprogramada`) es una **tercera** vía hacia
la circulación y el humano no la enumeró. Hoy la orden acabaría en bodega y R18 le negaría la
asignación: **la regla se cumple, pero el paquete queda en un callejón sin salida** y la tienda no
se entera hasta tres pasos después.
**Recomendación: bloquearla también**, con el mismo motivo único de R20.
Si la respuesta es **no bloquear**, la consecuencia queda escrita: R18 es el tapón, y habrá
paquetes en bodega que nadie puede asignar.

**Q3 · ¿La recuperación manual a bodega sigue disponible sobre una orden en el umbral?**
`recuperacion_manual` (`devuelta -> en_bodega_*`, feature 100) devuelve el paquete al estante. Es
un movimiento **físico** que la bodega necesita registrar aunque la orden ya no se pueda repartir.
**Recomendación: sí, se conserva intacta.** Razón: es el precedente P4 de la 239 leído al revés —
allí se firmó no dar arista al satélite porque el paquete aún no estaba confirmado; aquí sí lo
está—. La orden queda en bodega y R18 impide que salga a repartir, que es lo que se pide.
No requiere firma salvo que se prefiera lo contrario.

**Q4 · En el tope, `rechazada` no captura causa tipificada.**
`devuelta` lleva `causa_devolucion` (`not_found` / `wrong_number` / `wrong_address`); `rechazada`
no. Al prohibir `devuelta` en el último intento, esa causa deja de registrarse justo en la visita
que termina la orden.
**Recomendación: sin cambio en esta ficha** — el `motivo` libre de `rechazada` ya existe y añadir
un enum nuevo es rediseño, no arreglo. Se anota como pérdida de información conocida.

**Q5 · Nombre de la familia de origen de R22.**
Propuesta: `rechazo_tope_intentos`. Es vocabulario interno del historial. Lo que **sí** es
requisito: no puede reusarse `escalado_devuelta_sla` (es el predicado de la pestaña «Rechazadas por
plazo vencido», 102, y etiquetaría como vencimiento algo que no lo es) ni `liberacion_sin_gestionar`
(su nombre diría «liberación» sobre una orden que no se libera), y **no** entra en
`ORIGEN_TIPOS_VISITA_REAL` (subiría el contador y cobraría de más).

**Q6 · ¿Qué se hace si la medición previa de R37 encuentra órdenes vivas en el umbral fuera de
`devuelta`?**
La decisión «sin backfill» se tomó sobre la foto de una sola orden (`28098171`, en `devuelta`, que
escala sola). Si el SELECT de R37 devuelve órdenes en `reprogramada`, `en_bodega_*` o `por_recoger`
con intentos `>= umbral`, esa foto ya no vale: se para y se lleva al humano **antes** de desplegar,
porque R18 las dejaría inasignables sin que nadie lo haya decidido.
