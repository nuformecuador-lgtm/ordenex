# Ficha 451 — Los paquetes sin gestionar también se escanean para recibir el cierre

> **El defecto, en una frase.** Cuando un cierre vence, el corte diario barre a `sin_gestionar` las
> órdenes que el mensajero no trabajó y las registra en `cierre_sin_gestion`. Al **aprobar** ese
> cierre, la liberación de la feature 109 las manda a bodega dentro de la misma transacción — es
> decir, **el sistema ya las da por recibidas, sin pedir prueba**. La ventana de confirmación física
> de la 238 no las pide porque se construye desde **gestiones**
> (`retornablesDelCierre` = `RESULTADOS_QUE_VUELVEN.flatMap((r) => grupos[r])`,
> `app/(app)/cierres-admin/_components/cierre-confirmacion-fisica.tsx:156`) y una orden sin gestionar
> no tiene `resultado`, así que no está en `CierreGrupos` y no se pinta.
>
> **Medido contra producción el 2026-09-21:** 185 filas en `cierre_sin_gestion`, repartidas en **14
> cierres** (174 órdenes distintas), del 2026-08-27 al 2026-09-19. Los 14 están **todos aprobados**.
> En ellos se escanearon **50** paquetes y quedaron sin escanear **185**: el **78,7 %** del bulto que
> volvía a bodega se aprobó sin que nadie confirmara tenerlo delante. Filas con `num_guia` nulo:
> **cero**.
>
> Esta ficha **no cambia el modelo ni inventa una pantalla**: extiende el conjunto que la ventana de
> la 238 pone delante y el que el servidor exige cubrir, a un segundo origen cuyos datos **ya están
> persistidos**.
>
> Depende de: **238** (confirmación física; su vocabulario, su bloqueo y su punto único se reusan tal
> cual). Roza: **264** (`cierre_sin_gestion`), **109/276** (la liberación al aprobar), **271** (el
> acotado de la liberación a ESTE cierre), **239** (el anclaje en la misma transacción).

---

## Vocabulario

| Término | Qué significa aquí |
| --- | --- |
| **cierre** | `cierre_dia`: el cierre del día de UN mensajero (nivel 1). El de nivel 2 (`cierre_bodega`) queda fuera, como en la 238. |
| **gestión** | Fila de `gestion_orden` vinculada al cierre. Tiene `resultado`. |
| **barrida** / **orden sin gestionar** | Orden que el corte diario pasó a `sin_gestionar` al vencer el cierre y que quedó registrada en `cierre_sin_gestion` con sus descriptivos congelados. **No tiene gestión y por tanto no tiene `resultado`.** |
| **origen del paquete** | De dónde sale una fila que hay que poner delante: `gestion` o `barrida`. Es el eje nuevo de esta ficha. |
| **conjunto esperado** | Lo que bodega tiene que confirmar de ese cierre. Hasta hoy: las gestiones que vuelven. Desde esta ficha: **las gestiones que vuelven + todas las barridas**. |
| **confirmación física** | El acto de declarar, guía a guía, que se tiene el paquete delante (238). |
| **cobertura exacta** | Que lo confirmado sea IGUAL al conjunto esperado: ni falta ni sobra. |
| **punto único** | `lib/types/gestion-retorno.ts`: el módulo donde se declara qué vuelve a bodega, y del que se derivan la consulta del servidor, la guardia del servicio y las filas de la pantalla. |

---

## A · Qué hay que poner delante: el conjunto esperado, ampliado

**R1.** El sistema DEBE declarar, en un **punto único**, qué paquetes de un cierre vuelven
físicamente a bodega, contemplando **los dos orígenes**: las gestiones del cierre y las órdenes que
ese cierre barrió sin gestionar.

**R2.** El sistema DEBE conservar la declaración de qué **resultados de gestión** vuelven como
**exhaustiva sobre todos los resultados**, de modo que un resultado nuevo del vocabulario NO compile
hasta que se declare si su paquete vuelve.

**R3.** CUANDO el vocabulario de **orígenes de paquete** gane un valor nuevo, el sistema NO DEBE
compilar hasta que se declare si ese origen vuelve a bodega.

**R4.** El sistema NO DEBE declarar «qué vuelve a bodega» en ningún otro punto del árbol de
producción: ni una segunda lista de resultados, ni una segunda regla sobre los orígenes.

**R5.** El sistema DEBE incluir en el conjunto esperado de un cierre **toda** orden registrada como
barrida sin gestionar por **ese** cierre.

**R6.** El sistema DEBE derivar las barridas del **registro persistido del cierre**, y NO de un
predicado sobre el estado actual de las órdenes, de modo que el conjunto siga siendo el mismo
después de que la aprobación mueva esas órdenes.

**R7.** SI un cierre no tiene ninguna orden barrida registrada, ENTONCES el sistema NO DEBE exigir
ninguna confirmación por ese concepto ni bloquear su aprobación por él.

**R8.** El sistema DEBE resolver las barridas dentro del **alcance del actor**; un cierre fuera de
alcance DEBE producir un conjunto vacío sin revelar nada de ese cierre.

**R9.** El sistema NO DEBE incluir una orden barrida en el conjunto esperado de un cierre distinto
del que la barrió.

---

## B · El bloqueo

**R10.** CUANDO un administrador pide aprobar un cierre que tiene órdenes barridas registradas, el
sistema DEBE exigir la confirmación física de **todas** ellas antes de aprobar.

**R11.** SI la confirmación recibida no cubre exactamente el conjunto esperado —gestiones que vuelven
**y** barridas—, ENTONCES el sistema DEBE rechazar la aprobación con un error **por fila**, dejar el
cierre en `solicitado` y no producir ningún movimiento de dinero, ninguna transición de orden,
ninguna liberación a bodega y ninguna escritura de confirmación.

**R12.** SI falta la confirmación de una barrida del conjunto esperado, ENTONCES el sistema DEBE
devolver un error asociado a **esa** barrida.

**R13.** SI la confirmación incluye una barrida que no pertenece al conjunto esperado del cierre, o
incluye dos veces la misma barrida, ENTONCES el sistema DEBE devolver un error asociado a **esa**
entrada.

**R14.** SI el número de guía informado para una barrida no coincide con el número de guía de esa
barrida, ENTONCES el sistema DEBE rechazar la aprobación con un error asociado a esa entrada.

**R15.** SI una barrida del conjunto esperado no tiene número de guía, ENTONCES el sistema DEBE
rechazar la aprobación con un error asociado a esa barrida que lo nombre, y NO DEBE omitirla del
conjunto esperado.

**R16.** El sistema DEBE verificar la cobertura exacta en la **lógica de negocio**, contra el
registro real del cierre, y **antes** de abrir la transacción que aprueba.

**R17.** SI la petición de aprobación no trae confirmación de barridas, ENTONCES el sistema DEBE
tratarla como una confirmación vacía y aplicarle R11 sin excepción.

**R18.** SI un cierre no tiene gestiones que vuelvan **ni** barridas registradas, ENTONCES el sistema
DEBE aprobarlo con exactamente el mismo comportamiento y el mismo contenido de petición que antes de
esta ficha.

**R19.** El sistema NO DEBE ofrecer ninguna vía de aprobar un cierre con alguna fila del conjunto
esperado sin confirmar: ni marcar una fila como faltante, ni aprobar parcialmente, ni omitir una fila
del cómputo del bloqueo.

---

## C · Qué se persiste

**R20.** CUANDO la aprobación se aplica, el sistema DEBE registrar, por cada barrida del conjunto
esperado, que su paquete quedó confirmado, **dentro de la misma transacción** que aprueba el cierre.

**R21.** SI ese registro no se puede aplicar sobre exactamente las barridas del conjunto esperado,
ENTONCES el sistema DEBE revertir la aprobación completa, sin efectos parciales.

**R22.** CUANDO se escribe el registro de confirmación de una barrida, el sistema NO DEBE alterar
ningún monto, NO DEBE emitir, modificar ni suprimir ningún movimiento de dinero, y NO DEBE alterar
los descriptivos congelados de esa barrida.

**R23.** El sistema DEBE permitir distinguir una barrida confirmada físicamente de una barrida de un
cierre aprobado **antes** de esta ficha.

**R24.** El sistema NO DEBE derivar de ese registro ningún plazo, vencimiento, importe ni orden de
prelación; su único significado es «el paquete se confirmó».

**R25.** CUANDO la aprobación de un mismo cierre se intente más de una vez, el sistema NO DEBE
producir un segundo registro de confirmación de sus barridas.

**R26.** CUANDO una aprobación libera órdenes barridas —a bodega o a `rechazada`—, **toda** orden
liberada DEBE quedar confirmada físicamente por esa misma aprobación.

---

## D · Rechazo y reapertura

**R27.** SI un cierre se **rechaza**, ENTONCES el sistema NO DEBE pedir confirmación física de sus
barridas ni escribir ninguna.

**R28.** CUANDO un cierre `vencido` o `rechazado` se reabre por la válvula de escape, el sistema NO
DEBE escribir confirmación alguna de barridas en esa reapertura, y DEBE exigir la confirmación
completa en la aprobación posterior.

---

## E · Lo que bodega ve

**R29.** MIENTRAS la ventana de confirmación esté abierta, el sistema DEBE mostrar, por cada barrida
del conjunto esperado, su número de guía, su número de remisión, su destinatario, si está pendiente o
confirmada, y DEBE nombrarla como **sin gestionar**.

**R30.** El sistema DEBE presentar las barridas **en la misma lista y con el mismo peso visual** que
las gestiones que vuelven, agrupadas en su propia sección rotulada y distinguible.

**R31.** El sistema DEBE contar las barridas en el **mismo contador de progreso** y en el **mismo
número de paquetes que faltan** que bloquea la aprobación, sin un segundo contador aparte.

**R32.** SI la guía leída corresponde a una barrida pendiente de ese cierre, ENTONCES el sistema DEBE
confirmarla.

**R33.** SI la guía leída no pertenece a ninguna gestión **ni** a ninguna barrida del cierre abierto,
ENTONCES el sistema DEBE avisar que no es de este cierre y NO DEBE marcar ninguna fila.

**R34.** SI alguna fila del conjunto esperado no tiene número de guía, ENTONCES el sistema DEBE
decirlo **antes de la lista**, nombrando cuántas son y que ese cierre no se va a poder aprobar.

**R35.** SI el servidor devuelve un error asociado a una barrida, ENTONCES el sistema DEBE pintarlo
en **esa** fila y DEBE dejar la ventana de confirmación abierta.

**R36.** CUANDO el administrador cierra la ventana de confirmación sin completarla, el sistema NO DEBE
enviar nada, NO DEBE persistir nada y DEBE dejar el cierre en `solicitado`.

---

## F · Alcance y no-regresión

**R37.** El sistema DEBE exigir la confirmación de las barridas con el mismo criterio a cualquier
actor con permiso para aprobar el cierre, incluido el administrador de bodega satélite.

**R38.** El sistema NO DEBE cambiar qué dinero mueve la aprobación del cierre, ni cuánto, ni cuándo.

**R39.** Las suites que miden el **orden de las llamadas** dentro de la transacción de aprobación
DEBEN quedar verdes **sin modificarse**.

**R40.** Toda migración de esta ficha DEBE tener su reversión, y esa reversión DEBE dejar la base en
un estado que el código anterior pueda leer.

---

## Decisión firmada por el humano — 2026-09-21

**Los paquetes sin gestionar se escanean igual que las reprogramadas, devueltas y rechazadas, y
mientras falte uno el cierre no se aprueba. Sin salida de emergencia:** no hay «marcar como
faltante», no hay aprobar a medias, no hay omitir del cómputo. Es la misma decisión que la 238 firmó
el 2026-08-19 (D2), aplicada al segundo origen. R19 la recoge. **No se reabre en este ciclo.**

La salida cuando un paquete no llegó **ya existe y es la correcta**: rechazar el cierre con motivo,
que se lo devuelve al mensajero.

---

## Límite declarado (no es un control de seguridad)

Igual que en la 238: el servidor puede verificar **cobertura**, no el **acto físico**. Un cliente
manipulado puede enviar el conjunto completo sin haber escaneado nada. Esto es un **control de
proceso**, no una barrera. Lo que sí es una barrera, y está en R16, es que la cobertura se valida en
el servidor contra el registro real del cierre: un cliente no puede aprobar «sin la lista» ni «con
otra lista».

Se repite aquí a propósito para que nadie lo cite después como una garantía que el código nunca dio.

---

## Supuesto operativo declarado

Esta ficha **sube el número de paquetes que hay que tener delante para aprobar**. Medido: en los 14
cierres con barridas, el conjunto esperado pasa de 50 a 235 filas — casi el cuádruple. El efecto
buscado es exactamente ese, pero tiene contrapartida real y hay que decirla antes del despliegue:

- Un cierre **vencido** con barridas que hoy se aprueba de un click pasará a exigir su escaneo.
- Encadenado con la 239 y la 238: **un cierre que nadie puede aprobar congela sus devoluciones** en
  `devolucion_por_confirmar`. Esta ficha **añade una condición más** a esa puerta, así que **aumenta**
  la probabilidad del escenario que la 239 declaró aceptado. La consulta de población atascada de
  `specs/239-devolucion-espera-cierre/design.md` §12 pasa a vigilar también esta ficha.

---

## Fuera de alcance

- Cambiar **a dónde** van las órdenes barridas al aprobar (eso es 109/276, en producción).
- Cambiar **cuándo** se barre (sólo los cierres **vencidos** llenan `cierre_sin_gestion`;
  `solicitarCierre` no barre — `lib/interfaces/repositories/ICierreDiaRepository.ts:223-225`).
- Los rechazos de tienda del cierre (`cierre_rechazo_tienda`, ficha 425): su paquete **no viene con
  el mensajero**, y su design §7.1 ya declara que por eso no se escanean. No se toca.
- El cierre de bodega de nivel 2 (238/R39).
- Una pantalla de recepción de retorno separada del cierre (238 §10-A, descartada).
- Backfill del histórico: los 14 cierres ya aprobados **no** se reabren ni se marcan.

---

## Preguntas abiertas

Ninguna bloquea la implementación. Las tres primeras son **técnicas y ya decididas** en `design.md`;
se listan aquí para que el humano pueda vetarlas, no para que las conteste.

**Q1 · ¿Se persiste una marca por barrida?**
Decidido en el design (§3): **sí**, columna nueva `cierre_sin_gestion.confirmada_fisica_at`, con el
**mismo nombre** que la de la 238. Sin ella, la ficha bloquearía pero no dejaría rastro, y un cierre
aprobado seguiría sin poder demostrar que alguien tuvo esos 185 bultos delante — que es la mitad
auditable del defecto. Reusar el nombre hace que la guardia `confirmacion-sin-lectores.guardia.test.ts`
la cubra **sin tocarla**. Alternativa descartada en §9-C.

**Q2 · ¿Contra qué guía se contrasta lo leído: la congelada o la viva?**
Decidido en el design (§8): **la congelada** (`cierre_sin_gestion.num_guia`), que es la misma que ya
viaja a la pantalla. Una sola verdad para los dos lados; con la viva, pantalla y servidor podrían
pedir números distintos y el botón se quedaría bloqueado sin explicación posible — el modo de fallo
que la 238 documenta. **Límite aceptado y declarado**: una orden barrida **sin** guía a la que se le
generase una **después** quedaría con la copia en `NULL` y su cierre sería inaprobable. Hoy esa
población es **0 de 185**.

**Q3 · ¿Se renombra el punto único?**
Decidido en el design (§2): **no**. `lib/types/gestion-retorno.ts` conserva el nombre aunque pase a
cubrir dos orígenes. Renombrarlo toca el registro de una guardia, el spec de la 238 y sus
importadores, para cero cambio de comportamiento. Alternativa descartada en §9-E.

**Q4 · Momento del despliegue. [LO ÚNICO QUE NECESITA AL HUMANO]**
No es de diseño, es de operación, y es el mismo D8 de la 238 con un número peor: los cierres
`vencido` que estén sin resolver el día del despliegue pasarán a exigir el escaneo de paquetes que
llegaron hace días o semanas. **Hay que medir cuántos cierres vencidos sin resolver hay y cuántas
barridas arrastran (T0.1) y avisar a bodega antes.** Sin ese aviso, el primer efecto visible es «el
botón Aprobar dejó de funcionar». Si el número es alto, la decisión de si esos cierres en cola entran
o se drenan antes **es del humano**, no del spec.
