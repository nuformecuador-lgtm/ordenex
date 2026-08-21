# Feature 238 — Confirmación física de los paquetes al aprobar el cierre

> **Aprobar un cierre deja de ser un click.** Antes de aprobar, bodega tiene que confirmar —escaneando
> o tecleando la guía— que recibió físicamente cada paquete que vuelve: **devoluciones, rechazos y
> reprogramadas**. **Los incidentes NO cuentan** para ese bloqueo (decisión humana firmada,
> `progress/design_pila_ayuda_tienda.md` §«Decisiones ya firmadas» punto 3).
>
> Por qué importa ahora: desde la **239** (ya en producción) la aprobación del cierre **es** la
> transición que mete la devolución en `/novedades` y arranca su ventana de plazo. Esta ficha pone la
> comprobación física **delante de esa puerta**: hoy la puerta se abre con un click y el paquete puede
> seguir en la moto.
>
> Fuentes: `progress/design_pila_ayuda_tienda.md` §F4 · `specs/239-devolucion-espera-cierre/design.md`
> §3 · el código de `CierresAdminModule.pedirAprobacion()`, `CierresAdminService.aprobarCierre` y
> `CierresAdminRepository.resolverCierre`.

---

## Vocabulario

| Término | Qué significa aquí |
| --- | --- |
| **cierre** | `cierre_dia`: el cierre del día de UN mensajero, el de nivel 1. El de nivel 2 (`cierre_bodega`) se nombra siempre como «cierre de bodega». |
| **gestión** | Fila de `gestion_orden` vinculada a ese cierre. Un cierre tiene N gestiones, una por orden trabajada. |
| **resultado que vuelve a bodega** | Resultado de gestión cuyo paquete regresa físicamente: `devuelta`, `rechazada`, `reprogramada`. |
| **conjunto esperado** | Las gestiones de ESE cierre cuyo resultado vuelve a bodega. Es la lista que bodega tiene que confirmar. |
| **confirmación física** | El acto de bodega de declarar, guía a guía, que tiene el paquete delante. |
| **cobertura exacta** | Que lo confirmado sea IGUAL al conjunto esperado: ni falta ninguna ni sobra ninguna. Es el mismo criterio que la 158 aplica a los montos de indemnización. |
| **anclaje** | Feature 239: la transición `devolucion_por_confirmar → devuelta` que ocurre al aprobar el cierre. |

---

## A · Qué vuelve a bodega: el conjunto esperado

**R1.** El sistema DEBE declarar, en un punto único y **exhaustivo sobre todos los resultados de
gestión**, cuáles vuelven físicamente a bodega y cuáles no.

**R2.** El sistema DEBE componer el conjunto esperado de un cierre con las gestiones **vigentes
vinculadas a ese cierre** cuyo resultado vuelve a bodega: `devuelta`, `rechazada` y `reprogramada`.

**R3.** SI una gestión del cierre tiene resultado `incidente`, ENTONCES el sistema NO DEBE incluirla
en el conjunto esperado, NI exigir su confirmación, NI bloquear la aprobación por ella.

**R4.** El sistema DEBE derivar el conjunto esperado de las **gestiones del cierre** y NO del estado
actual de las órdenes, de modo que una orden que ya se movió después de la gestión siga siendo
confirmable.

**R5.** CUANDO el vocabulario de resultados de gestión gane un valor nuevo, el sistema NO DEBE
compilar hasta que se declare si ese resultado vuelve a bodega o no.

**R6.** El sistema DEBE resolver el conjunto esperado dentro del **alcance del actor**; un cierre
fuera de alcance DEBE producir un conjunto vacío sin revelar nada de ese cierre.

---

## B · El bloqueo

**R7.** CUANDO un administrador pide aprobar un cierre cuyo conjunto esperado NO está vacío, el
sistema DEBE exigir la confirmación física de **todas** las gestiones del conjunto antes de aprobar.

**R8.** SI la confirmación recibida no cubre exactamente el conjunto esperado, ENTONCES el sistema
DEBE rechazar la aprobación con un error **por gestión**, dejar el cierre en `solicitado` y no
producir ningún movimiento de dinero, ninguna transición de orden y ninguna escritura de
confirmación.

**R9.** SI falta la confirmación de una gestión del conjunto esperado, ENTONCES el sistema DEBE
devolver un error asociado a **esa** gestión.

**R10.** SI la confirmación incluye una gestión que no pertenece al conjunto esperado del cierre, o
incluye dos veces la misma gestión, ENTONCES el sistema DEBE devolver un error asociado a **esa**
entrada.

**R11.** SI la confirmación incluye una gestión con resultado `incidente` de ese mismo cierre,
ENTONCES el sistema DEBE devolver un error que diga que los incidentes no se confirman físicamente,
distinto del error de una gestión ajena.

**R12.** SI el número de guía informado para una gestión no coincide con el número de guía de la
orden de esa gestión, ENTONCES el sistema DEBE rechazar la aprobación con un error asociado a esa
entrada.

**R13.** SI una gestión del conjunto esperado corresponde a una orden **sin número de guía**,
ENTONCES el sistema DEBE rechazar la aprobación con un error asociado a esa gestión que lo nombre, y
NO DEBE omitirla del conjunto esperado.

**R14.** El sistema DEBE verificar la cobertura exacta en la **lógica de negocio**, contra las
gestiones reales del cierre, y **antes** de abrir la transacción que aprueba el cierre.

**R15.** SI la petición de aprobación no trae confirmación alguna, ENTONCES el sistema DEBE tratarla
como una confirmación vacía y aplicarle R8 sin excepción.

**R16.** SI el conjunto esperado de un cierre está vacío, ENTONCES el sistema DEBE aprobarlo con
exactamente el mismo comportamiento y el mismo contenido de petición que antes de esta feature.

---

## C · Qué se persiste

**R17.** CUANDO la aprobación se aplica, el sistema DEBE registrar, por cada gestión del conjunto
esperado, que su paquete quedó confirmado, **dentro de la misma transacción** que aprueba el cierre.

**R18.** SI ese registro no se puede aplicar sobre exactamente las gestiones del conjunto esperado,
ENTONCES el sistema DEBE revertir la aprobación completa, sin efectos parciales.

**R19.** CUANDO se escribe el registro de confirmación, el sistema NO DEBE alterar ningún monto ni
emitir, modificar o suprimir ningún movimiento de dinero.

**R20.** El sistema DEBE permitir distinguir una gestión confirmada físicamente de una gestión de un
cierre aprobado **antes** de esta feature.

**R21.** El sistema NO DEBE derivar de ese registro ningún plazo, vencimiento, importe ni orden de
prelación; su único significado es «el paquete se confirmó».

**R22.** CUANDO la aprobación de un mismo cierre se intente más de una vez, el sistema NO DEBE
producir un segundo registro de confirmación.

**R23.** CUANDO una aprobación ancla órdenes a `devuelta` (feature 239), toda gestión que produce ese
anclaje DEBE quedar confirmada físicamente por esa misma aprobación.

---

## D · Rechazo, vencidos y re-aprobación

**R24.** SI un cierre se **rechaza**, ENTONCES el sistema NO DEBE pedir confirmación física ni
escribir ninguna.

**R25.** MIENTRAS un cierre no esté `solicitado`, el sistema NO DEBE aprobarlo y, por tanto, NO DEBE
escribir ninguna confirmación sobre él.

**R26.** CUANDO un cierre `vencido` o `rechazado` se reabre por la válvula de escape, el sistema NO
DEBE escribir confirmación alguna en esa reapertura, y DEBE exigir la confirmación completa en la
aprobación posterior.

---

## E · Lo que bodega ve

**R27.** MIENTRAS falte por confirmar alguna gestión del conjunto esperado, el sistema DEBE impedir
confirmar la aprobación y DEBE decir **con texto**, no sólo con un botón apagado, cuántas faltan y
qué hacer si un paquete no llegó.

**R28.** El sistema DEBE aceptar la confirmación de una guía por **cámara** o por **número tecleado**.

**R29.** SI lo escaneado no se puede interpretar como un número de guía, ENTONCES el sistema DEBE
avisarlo, NO DEBE marcar ninguna gestión y NO DEBE enviar nada al servidor.

**R30.** SI la guía leída no pertenece a ninguna gestión del cierre abierto, ENTONCES el sistema DEBE
avisarlo diciendo eso mismo y NO DEBE marcar ninguna gestión.

**R31.** SI la guía leída pertenece al cierre pero **ninguna** de sus gestiones **vuelve a bodega**,
ENTONCES el sistema DEBE avisarlo con un mensaje propio, distinto del de R30.
> **PRECISADO el 2026-08-19** (m3 de la revisión), tras el bloqueo que apareció al ver la app: el
> texto original decía «a una gestión que no vuelve», y una guía puede casar **varias** gestiones —una
> orden puede tener dos vivas en el mismo cierre—. Leído al pie de la letra, el original pedía avisar
> también cuando la guía casa una fila que **no** vuelve **y otra que sí**, y eso dejaría la segunda
> sin poder confirmarse: el cierre no se podría aprobar nunca. Rige el **plural**: se avisa sólo si
> **ninguna** vuelve. Ver `design.md` §5.3.

**R32.** SI la guía leída ya estaba confirmada en esta sesión, ENTONCES el sistema DEBE decirlo y NO
DEBE contarla dos veces.

**R33.** MIENTRAS la ventana de confirmación esté abierta, el sistema DEBE mostrar, por cada gestión
del conjunto esperado, su número de guía, su número de remisión, su destinatario, su resultado y si
está pendiente o confirmada.

**R34.** SI el cierre tiene gestiones `incidente`, ENTONCES el sistema DEBE nombrarlas explícitamente
en la ventana de confirmación como excluidas y decir por qué, de modo que su ausencia no se lea como
un olvido.

**R35.** CUANDO el administrador cierra la ventana de confirmación sin completarla, el sistema NO
DEBE enviar nada, NO DEBE persistir nada y DEBE dejar el cierre en `solicitado`.

**R36.** MIENTRAS la ventana de confirmación no esté abierta, el sistema NO DEBE mantener montada ni
activa la cámara.

**R37.** SI el cierre tiene además gestiones `incidente`, ENTONCES el sistema DEBE pedir la
confirmación física **antes** de la captura de los montos de indemnización.

---

## F · Alcance

**R38.** El sistema DEBE exigir la confirmación física con el mismo criterio a cualquier actor con
permiso para aprobar el cierre, incluido el administrador de bodega satélite.

**R39.** El sistema NO DEBE pedir confirmación física ni bloquear por ella la resolución del **cierre
de bodega** (nivel 2).

---

## G · Que el fallo de agosto no se pueda repetir

**R40.** Toda escritura nueva ejecutada dentro de la transacción de aprobación DEBE quedar declarada
en el inventario de escrituras cubiertas, con la suite que la nombra.

**R41.** Los feeds de dinero de la aprobación y sus suites de idempotencia DEBEN quedar verdes sin
modificarse.

**R42.** Ninguna aserción sobre las llamadas de la transacción de aprobación DEBE distinguirlas por
la presencia o la ausencia de una clave de su cláusula de filtro.

**R43.** Toda migración de esta feature DEBE tener su reversión, y esa reversión DEBE dejar la base
en un estado que el código anterior pueda leer.

**R44.** Ningún registro de diagnóstico producido por esta feature DEBE contener datos personales,
direcciones, teléfonos ni secretos.

---

## Límite declarado (no es un control de seguridad)

El servidor puede verificar **cobertura**, no el **acto físico**. Un cliente manipulado puede enviar
el conjunto completo sin haber escaneado nada, exactamente igual que hoy puede enviar cualquier monto
de indemnización. Esto es un **control de proceso**, no una barrera: convierte «aprobar» en un gesto
que exige tener los paquetes delante, y deja rastro de que se declaró tenerlos.

Se declara aquí a propósito para que nadie lo cite después como una garantía que el código nunca dio.
Lo que sí es una barrera, y está en R14, es que la **cobertura** se valida en el servidor contra las
gestiones reales del cierre: un cliente no puede aprobar «sin la lista» ni «con otra lista».

---

## Supuesto operativo declarado

Esta feature convierte la aprobación en un acto que **requiere presencia física en bodega**. Un
administrador que apruebe cierres desde fuera de la bodega deja de poder hacerlo sin los paquetes
delante. Es el efecto buscado, y su contrapartida es real: si la persona que aprueba y la que recibe
no son la misma, la operación tiene que reorganizarse.

Encadenado con la 239: **un cierre que nadie puede aprobar congela sus devoluciones** en
`devolucion_por_confirmar` (invisibles para la tienda, sin reloj y sin cobro). Esta ficha **añade una
condición más** para que ese cierre se apruebe, así que **aumenta** la probabilidad del escenario que
la 239 declaró aceptado. La consulta de población atascada de `specs/239/design.md` §12 pasa a ser el
instrumento de vigilancia de las dos fichas, no sólo de una.

---

## Fuera de alcance

- Cambiar qué mueve la aprobación del cierre (eso es la 239, ya en producción).
- Una pantalla de recepción de retorno separada del cierre (ver `design.md` §10-A, descartada).
- La alerta de población atascada (M3 de `specs/215/design.md` §7bis).
- El cierre de bodega de nivel 2 (R39: queda fuera por decisión, no por olvido).
- Registrar **por qué medio** se confirmó cada guía (cámara o tecleo). Ver D7.

---

## Preguntas abiertas

Las marcadas **[FIRMA]** cambian esquema o producto y **no se implementan sin respuesta humana**.

**D1 · Qué se persiste, exactamente. [FIRMA]**
Recomendación: **una marca por gestión** — columna nueva `gestion_orden.confirmada_fisica_at`
(nullable, escrita sólo dentro de la transacción de aprobación). Razones: (a) la granularidad coincide
con el acto (bodega confirma paquete a paquete); (b) reutiliza una tabla que ya tiene RLS, sin
superficie nueva; (c) cae exactamente donde ya escribe la indemnización (`tx.gestionOrden.updateMany`
guardado por `(cierreId, resultado)`), así que hereda su molde y su guardia; (d) si algún día se firma
un «aprobar con faltantes declarados» (D2), la marca ya distingue confirmada de faltante sin migración
nueva. **No** se añade una columna `confirmada_fisica_por`: quién confirmó es `cierre_dia.resuelto_por`
de ese mismo cierre aprobado, y una segunda copia es una segunda verdad que puede divergir.
Descartadas: fila por cierre en tabla nueva (§10-C) y no persistir nada (§10-D).

**D2 · ¿Se puede aprobar «con faltantes declarados»? [FIRMA]**
Recomendación: **no**, en esta ficha. El bloqueo es la decisión firmada; una puerta de escape la
deshace el primer día de prisa. La salida cuando un paquete no llegó **ya existe y es la correcta**:
**rechazar el cierre** con motivo, que se lo devuelve al mensajero. Eso usa maquinaria que ya está,
no inventa estado nuevo y deja la conversación donde tiene que estar (mensajero ↔ bodega). Si el
humano prefiere lo contrario, la marca de D1 pasa de timestamp a tri-estado
(`confirmada` / `faltante`) y hacen falta requisitos nuevos para qué le pasa a una orden declarada
faltante — que **no** son gratis: hoy nada del sistema sabe representar «el paquete no volvió».

**D3 · Gestiones que vuelven cuya orden NO tiene número de guía. [FIRMA, y hace falta medir antes]**
`orden.num_guia` es **nullable** (`db/schema.prisma:484`); se asigna en «Generar guía». No hay
constraint que impida que una orden llegue a reparto sin guía. R13 fija el comportamiento **seguro
por defecto** (bloquea y lo dice, nunca omite en silencio), pero si esa población existe, ese
comportamiento deja cierres imposibles de aprobar. Recomendación: **medir primero** (T0.1: cuántas
gestiones `devuelta`/`rechazada`/`reprogramada` de cierres `solicitado` tienen `num_guia IS NULL`) y
decidir con el número delante. Si es 0 y se puede sostener, R13 se queda como está. Si no es 0, la
salida recomendada es **aceptar el `num_remision` tecleado** para esas filas —es el identificador que
el paquete lleva impreso igual— sin abrir un botón de «marcar sin leer».

**D4 · ¿Las reprogramadas entran en el conjunto esperado?**
**Cerrada, no es decisión abierta:** entran. Lo dicen la ficha y §F4, y el código lo respalda — una
orden `reprogramada` sale hacia bodega (`reprogramada → en_bodega_central` / `→ en_bodega_satelite`,
familia `liberacion_reprogramada`, `LiberacionReprogramadaRepository`), y espera ahí hasta su fecha.
El paquete vuelve el mismo día aunque la nueva visita sea dentro de una semana.

**D5 · Orden de los dos sub-modales.**
Decidido en el diseño, sin firma: **confirmación física primero, indemnizaciones después** (R37). Si
falta un paquete no se llega a la captura de montos, y así no se teclea dinero que se va a descartar.

**D6 · ¿Qué ve el que aprueba de un cierre ya aprobado antes de esta feature?**
Decidido, sin firma: **nada nuevo**. R20 sólo exige poder distinguirlos en los datos; la pantalla no
pinta «sin confirmar» en el histórico, porque eso etiquetaría de sospechoso todo lo anterior al
despliegue.

**D7 · ¿Se registra el medio (cámara o tecleado)?**
Recomendación: **no**. No cambia ninguna decisión aguas abajo y añade una columna que nadie lee. Si
algún día hace falta auditar el medio, la marca de D1 puede crecer sin romper nada.

**D8 · Momento del despliegue.**
No es de diseño, es de operación: los cierres que estén `solicitado` el día del despliegue pasarán a
exigir el escaneo de paquetes que llegaron horas antes. No hace falta migración ni backfill (los
paquetes están en el estante), pero **hay que avisar a bodega antes** y medir cuántos cierres y
cuántas gestiones hay en cola (T0.1). Sin ese aviso, el primer efecto visible de la feature es
«el botón Aprobar dejó de funcionar».

---

## PUERTA HUMANA PASADA — 2026-08-19

**D3 y D8 quedan resueltas por MEDICIÓN, no por firma.** Medido contra producción el 2026-08-19
(MCP, solo lectura), con autocomprobación de 141 órdenes vivas:

- **0 órdenes vivas sin `num_guia`** → la población de D3 **no existe hoy**. El comportamiento seguro
  de R13 (bloquear y decirlo, nunca omitir en silencio) **se mantiene como red**, pero no hay nadie
  afectado. Se re-mide en T0.1: es una foto.
- **0 cierres en estado `solicitado`** → nadie se va a encontrar el botón de aprobar bloqueado de
  golpe el día del despliegue. El aviso a bodega de D8 **deja de bloquear**, aunque sigue siendo
  buena práctica avisar antes.

### Firmadas

- **D2 — NO se puede aprobar con faltantes declarados.** El bloqueo se mantiene **sin escapatoria**,
  que es coherente con lo ya firmado al planificar la pila. La salida cuando un paquete no llegó
  **ya existe y es la correcta**: rechazar el cierre con motivo, que se lo devuelve al mensajero.
  Consecuencia aceptada: **un solo paquete perdido devuelve el cierre entero**, y eso es deliberado
  — es exactamente la fricción que hace que los paquetes aparezcan.
- **D1 — se persiste una marca por gestión** (`gestion_orden.confirmada_fisica_at`, nullable,
  escrita solo dentro de la transacción), por el leader y con la recomendación del spec: la
  granularidad coincide con el acto, reutiliza una tabla que ya tiene RLS y cae donde ya escribe la
  indemnización. **No** se añade `confirmada_fisica_por`: quién confirmó es el `resuelto_por` del
  mismo cierre, y una copia sería una segunda verdad.

**Consecuencia de D2 que el spec debe hacer visible en pantalla**: si bodega no puede aprobar, tiene
que entender **por qué** y **qué guías faltan** sin adivinar. Un bloqueo mudo se lee como una app
rota — el mismo criterio con el que se rechazaron los botones de maqueta en `/novedades`.
