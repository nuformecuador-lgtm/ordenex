# Feature 262 — Corregir el día de reparto de una orden ya asignada

> **Existe una superficie para cambiar el día de reparto de un lote ya asignado, con quién lo hizo,
> por qué y desde qué día hasta qué día. Deja de hacer falta un `UPDATE` a mano contra producción.**
>
> **Esto es la CONTRAPARTIDA EXPLÍCITA de la feature 261, no una mejora suelta.** La 261 cerró —por
> decisión humana del 2026-08-21, y con razón— la puerta por la que un error de día se absorbía
> solo: con la decisión **D5** de la 246 vigente, el mensajero recogía y gestionaba igual, así que
> un lote marcado para el día equivocado seguía repartiéndose. Al cerrarla, **ese lote queda
> inalcanzable para todo el mundo hasta que llegue el día que alguien escribió por error**: ni
> bodega, ni el maestro, ni el admin, ni el mensajero, ni la tienda. El riesgo se **aceptó
> explícitamente** (261, P4) y se escribió en el código con puntero a esta ficha (261/R33). Esta
> ficha lo cierra.
>
> **Medido, por tercera vez y no heredado de ningún informe:** `fechaReparto` / `fecha_reparto`
> **no aparece en un solo componente de escritura de todo el árbol**. Los únicos escritores son las
> dos vías de asignación (`asignarBodegaLote`, `asignarSateliteLote`), la rama muerta de
> `generarGuiaLote`, cinco limpiezas (`DevolucionSlaRepository`, `LiberacionReprogramadaRepository`,
> `RecuperacionBodegaRepository`, `CierresAdminRepository`, `OrdenRepository.deshacerAsignacionLote`)
> y el estampado del deshacer que la 261 corrigió. En `app/` la columna aparece en **cinco
> archivos**, los cinco del portal del mensajero y los cinco de **sólo lectura**.
>
> **El daño ya ocurrió y se reparó a mano:** la guía **17496963**, el 2026-08-21, con un `UPDATE` de
> una columna y autorización humana explícita. Ese `UPDATE` no dejó rastro en la aplicación: nadie
> sabe hoy, desde dentro del producto, que esa fila se tocó.
>
> Fuentes leídas para escribir esto (ninguna heredada): `specs/261-dia-reparto-protege/**`,
> `specs/246-asignacion-por-dia/**`, `lib/repositories/OrdenRepository.ts`,
> `lib/repositories/CierreDiaRepository.ts`, `lib/repositories/RankingRepository.ts`,
> `lib/repositories/TableroDiaRepository.ts`, `lib/repositories/OrdenHistorialRepository.ts`,
> `lib/repositories/registrar-cambio-estado.ts`, `lib/services/GuiaAsignacionService.ts`,
> `lib/services/AsignacionSateliteService.ts`, `lib/services/DeshacerAsignacionService.ts`,
> `lib/services/MisAsignacionesService.ts`, `lib/actions/deshacer-asignacion.ts`,
> `lib/utils/dia-reparto.ts`, `lib/utils/dia-reparto-textos.ts`, `lib/utils/fecha-cr.ts`,
> `lib/types/dia-reparto.ts`, `lib/types/orden-historial.ts`, `lib/types/orden.ts`,
> `lib/auth/acceso-total.ts`, `db/schema.prisma`, `app/(app)/ordenes/**`,
> `app/(app)/recepcion-satelite/**`,
> `tests/unit/guards/fecha-reparto-acompana-asignado-at.guardia.test.ts`,
> `tests/unit/guards/d5-revertida.guardia.test.ts`,
> `tests/unit/guards/carga-del-mensajero.guardia.test.ts`,
> `db/migrations/20260820200000_postulacion_recurso/**`.

---

## Vocabulario

| Término | Qué significa aquí |
| --- | --- |
| **día de Costa Rica** | La fecha calendario de `America/Costa_Rica` (UTC-6 fijo). Única definición admitida; vive en `lib/utils/fecha-cr.ts`. |
| **día de reparto** | El día de Costa Rica **para el que** se hizo la asignación. Columna `orden.fecha_reparto`, `@db.Date` (feature 246). |
| **orden asignada** | Orden con **mensajero** y con **día de reparto**, en un estado en el que ese día todavía decide algo. |
| **corregir el día** | Cambiar el día de reparto de un lote de órdenes asignadas **sin cambiar nada más**: ni estado, ni mensajero, ni guía, ni el instante de asignación. |
| **el corte** | El cron `/api/cron/corte-diario`, `0 6 * * *` UTC = 00:00 de Costa Rica. Barre `(fecha_reparto IS NULL OR fecha_reparto <= diaCerrado)`. |
| **reservada** | Orden cuyo día de reparto es **estrictamente posterior** al día de Costa Rica en curso. Desde la 261 no se puede recoger, ni escoger, ni gestionar, ni resolver desde la ayuda de la tienda. |
| **el rastro** | El registro inmutable de una corrección: qué orden, de qué día a qué día, quién y por qué. |

### Precisión verificada en el código, no supuesta

1. **El día de reparto no es sólo «cuándo sale el paquete»: decide dinero.** Es la rama (a) del
   **denominador del ranking** (`RankingRepository.contarAsignadasPorMensajero`, 246/D7) y el
   universo del **tablero del día** (`TableroDiaRepository`, 259). Mover una orden de día la mueve
   de denominador, y detrás del ranking hay `premio_ranking`.
2. **Un cambio de día NO es un cambio de estado.** `orden_historial_estado` es la línea de tiempo de
   las **transiciones** (`estatus_destino_id` es NOT NULL) y su fila es **inmutable**. Ver **R23** y
   `design.md` §5.
3. **`/ordenes` no recorta por rol: recorta por PUERTA.** `app/(app)/ordenes/page.tsx:55` hace
   `notFound()` para `mensajero` y `adminSatelite`. Cualquier decisión que ponga la corrección
   «en el listado» y se olvide de esto deja **fuera a la bodega satélite**, que es una de las dos
   que eligen el día al asignar. Ver **R12**.
4. **Asignar no se bloquea nunca por cierres pendientes** (regla 2 de la feature 241, firmada el
   2026-08-20) y **deshacer una asignación tampoco** (149, Q1 cerrada). Ver **R13**.
5. **La ruta optimizada se arma de las órdenes en `en_reparto` de un mensajero**
   (`ParadasRepo.findParadasEnReparto`), no del día de reparto. Ver **R28**.

---

## A · Qué hace la corrección

**R1.** El sistema DEBE ofrecer una operación que fije el día de reparto de un **lote** de órdenes
asignadas, **sin** cambiar el estado, el mensajero asignado, el número de guía ni el instante de
asignación de ninguna de ellas.

**R2.** CUANDO se corrija el día, el sistema DEBE resolver la fecha **en el servidor**, a partir de
la elección entre las mismas dos opciones que ofrece la asignación —el día en curso o el siguiente—
y de un reloj **inyectable**; y NO DEBE aceptar del cliente una fecha.

**R3.** El sistema NO DEBE permitir fijar un día **anterior** al día de Costa Rica en curso.

**R4.** El sistema NO DEBE permitir, desde esta operación, **dejar sin día** una orden.

**R5.** SI una orden del lote no tiene día de reparto, o no tiene mensajero asignado, ENTONCES el
sistema DEBE rechazar la operación nombrando el motivo de esa orden.

**R6.** El sistema DEBE aceptar la corrección **sólo** sobre órdenes en un estado en el que el día de
reparto todavía decide algo; SI una orden está en cualquier otro estado, ENTONCES el sistema DEBE
rechazarla **nombrando el estado** en que está.

**R7.** SI una orden del lote ya está marcada para el día elegido, ENTONCES el sistema DEBE
rechazarla con un motivo que lo diga, en vez de escribir una corrección que no corrige nada.

**R8.** CUANDO el sistema rechace cualquier orden del lote, DEBE abortar el **lote completo** y NO
DEBE quedar ninguna orden corregida, ningún rastro escrito y ninguna otra escritura.

**R9.** El sistema DEBE re-comprobar **en la escritura** el estado, el mensajero, la existencia del
día y que el día actual no sea ya el elegido, de modo que una orden que cambie entre la validación y
la escritura **no se corrija**; y SI eso ocurre, la operación entera DEBE revertirse.

**R10.** CUANDO la corrección termine con éxito, el sistema DEBE decir **para qué día quedó el
lote**, con palabras, sin siglas y sin nombres de columna.

---

## B · Quién puede, y desde dónde

**R11.** El sistema DEBE permitir corregir el día **exactamente** a quien puede elegirlo al asignar:
los roles de acceso total (`maestro`, `admin`) para cualquier zona, y el `adminSatelite` para la
suya. SI el actor tiene cualquier otro rol, ENTONCES el sistema DEBE rechazar **sin efectos** y sin
revelar el estado de ninguna orden.

**R12.** MIENTRAS el actor sea `adminSatelite`, el sistema DEBE acotar la corrección a las órdenes de
**su** zona, resolviendo la zona **en el servidor**; y SI el actor no tiene zona, ENTONCES DEBE
rechazar sin efectos.

**R13.** El sistema DEBE ofrecer la corrección desde **las dos superficies donde hoy se elige el día
al asignar** —el listado de órdenes y el listado de la bodega satélite—, sin cambiar quién puede
entrar a cada una de esas dos páginas.

**R14.** SI el mensajero de una orden del lote tiene un cierre de día sin resolver, ENTONCES la
corrección DEBE proceder igual.

**R15.** El sistema NO DEBE ofrecer la corrección al mensajero ni a la tienda.

---

## C · Lo que se lee antes y después de confirmar

**R16.** CUANDO se abra la corrección, la pantalla DEBE mostrar, por cada orden del lote, **el día
para el que está marcada hoy**, en palabras.

**R17.** La pantalla NO DEBE derivar del reloj del navegador ni el día en curso, ni las etiquetas de
las dos opciones, ni el día que muestre por orden.

**R18.** Los textos del día de reparto que muestre esta superficie DEBEN salir de la **misma fuente
única** que ya usan la asignación y el portal del mensajero.

**R19.** CUANDO el sistema rechace la corrección, la pantalla DEBE mostrar el **motivo real por
orden**, y NO DEBE presentarlo como un fallo genérico ni invitar a reintentar cuando reintentar no
arregla nada.

---

## D · El rastro

**R20.** El sistema DEBE registrar cada corrección efectiva con: la orden, el **día que tenía**, el
**día que queda**, **quién** la hizo y **cuándo**.

**R21.** El sistema DEBE exigir un **motivo escrito** por quien corrige, validado en el borde, y DEBE
guardarlo con el registro.

**R22.** El sistema DEBE escribir el registro **en la misma escritura transaccional** que la
corrección, y DEBE cubrir **exactamente** las órdenes efectivamente corregidas: ni una de más
—porque el lote se abortó— ni una de menos.

**R23.** El registro DEBE ser **inmutable**: una corrección posterior añade un registro nuevo y jamás
altera uno anterior.

**R24.** El **día que tenía** que se guarde DEBE ser el valor que la fila tenía **en el instante de
la escritura**, no el que se leyó al abrir la pantalla.

**R25.** La corrección NO DEBE añadir ninguna entrada a la **línea de tiempo de estados** de la
orden, NI alterar su **conteo de intentos de entrega**.

**R26.** Los datos del rastro NO DEBEN ser legibles por ninguna vía que no pase por el servidor de la
aplicación.

---

## E · La invariante: qué se toca y qué no

**R27.** La corrección NO DEBE alterar el **instante de asignación** de ninguna orden: quién asignó y
cuándo no cambia porque se corrija el día.

**R28.** La corrección NO DEBE poder crear un día de reparto **sin mensajero** ni dejar un mensajero
**sin día**: la invariante de la feature 246 (R10) sigue valiendo entera después de esta feature.

**R29.** El sistema DEBE tener una comprobación automática que se ponga **roja** si aparece en el
árbol **cualquier otra** escritura del día de reparto que no acompañe al instante de asignación
fuera de la **única excepción** que esta feature declara; y esa comprobación NO DEBE poder quedarse
verde por estar vacía.

---

## F · Lo que esta corrección desbloquea, y lo que no cambia

**R30.** CUANDO se corrija a un día **posterior** al día en curso, el corte de esa misma noche DEBE
dejar de barrer la orden; CUANDO se corrija al **día en curso**, el corte de esa noche DEBE volver a
alcanzarla.

**R31.** CUANDO se corrija al día en curso una orden que estaba reservada, el mensajero DEBE poder
recogerla, escogerla y gestionarla —y la tienda resolverla desde la ayuda— **sin ninguna otra
acción** y sin que se escriba nada más.

**R32.** La corrección NO DEBE alterar la **ruta optimizada** del mensajero ni los indicadores de su
portal.

**R33.** Esta feature NO DEBE introducir ninguna escritura nueva sobre el día de reparto **fuera** de
la operación que declara, ni retirar ninguna de las existentes.

---

## G · El riesgo aceptado de la 261 se cierra POR LA PUERTA

**R34.** El sistema DEBE sustituir la nota del riesgo aceptado (261/R33) —hoy escrita en el sitio
donde se decide el bloqueo— por su **cierre fechado**: que la superficie ya existe, dónde está, desde
qué fecha, y **conservando** el razonamiento de por qué el riesgo se aceptó. NO DEBE borrarse a
secas.

**R35.** La comprobación automática que vigila esa nota (261/R26, mitad (e)) DEBE actualizarse para
exigir las piezas del **cierre**, y DEBE seguir poniéndose roja si alguien retira la nota sin
sustituirla.

**R36.** El spec de la feature 261 DEBE llevar un **apéndice fechado** al pie de su límite declarado
2 marcando el agujero como cerrado por esta ficha, **conservando intacto** su texto original.

---

## Límites declarados (no son controles, son honestidad)

1. **No se puede fijar un día más allá de «mañana».** La corrección habla el **mismo vocabulario que
   la asignación** (246/D2): hoy o el día siguiente. Consecuencia real: un lote que alguien dejó
   con un `UPDATE` a mano en **+2** no se puede traer a «hoy» de un salto — se corrige a hoy
   igual, porque «hoy» es una de las dos opciones; lo que **no** se puede es *poner* +2 desde la
   app. Si algún día hace falta, es un cambio para las **dos** superficies (asignar y corregir) y
   una decisión de producto, no un `input type="date"` que se cuela por aquí. Ver `design.md` §4.3.
2. **El listado no gana una columna «Día de reparto».** El día se ve **por orden dentro de la
   pantalla de corrección** (R16), que es donde se decide. Motivo y alternativa descartada en
   `design.md` §7.2 y A7: una columna nueva toca el ancho de la tabla y la descarga de los 13
   listados, y la ficha **263** ya está abierta por un problema de anchos en otra tabla.
3. **El rastro no tiene pantalla en esta versión.** Se escribe y se puede leer desde la base; no se
   muestra en «Ver historial» ni en ningún panel. Es una decisión de alcance con su pregunta abierta
   (**P1**), no un olvido: mezclarlo en la línea de tiempo obliga a fusionar dos fuentes en un DTO
   que hoy es de transiciones de estado.
4. **Al mensajero no se le avisa.** Si su orden pasa de mañana a hoy, se entera porque el botón deja
   de estar gris. Añadir una notificación exige un valor nuevo en un **enum cerrado a propósito**
   (`NotificacionEvento`, 146/D1) y por tanto una migración: es una decisión, y está en **P2**.
5. **El `adminSatelite` sólo alcanza lo que su listado le enseña.** Su pantalla ofrece cinco
   estados y `en_reparto` / `ayuda_tienda` no están entre ellos. Una orden satélite ya en la calle
   con el día equivocado la corrige maestro/admin desde `/ordenes`, que alcanza **cualquier zona**
   (mismo reparto que «Deshacer asignación», 149/R3 y R36). No es un agujero: es una escalera con
   dos peldaños, y el de arriba llega a todo.
6. **Sin migración de datos.** No hay backfill ni reparación automática de nada. Las órdenes que hoy
   están reservadas se corrigen **una a una, a mano y por una persona**, que es exactamente el
   punto de esta ficha.

---

## Mediciones que faltan (se toman antes de desplegar, contra producción, **solo lectura**)

| # | Qué mide | Qué decide |
| --- | --- | --- |
| **M1** | Órdenes con `fecha_reparto > <día CR en curso>`, agrupadas por estatus y con su mensajero. | El **tamaño de la población** que esta superficie viene a rescatar. La 261 la midió el 2026-08-21 acotada a `en_reparto`/`ayuda_tienda`: **2 órdenes**. Aquí se mide **sin acotar el estado**, porque `por_recoger` es el caso principal y aquella medición no lo cubría. |
| **M2** | Órdenes con `mensajero_asignado_id IS NOT NULL` y `fecha_reparto IS NULL`. | Cuántas órdenes quedan a las que esta superficie **no** les puede poner día (R4/R5). Si el número fuera grande, la decisión D3' de `design.md` §4.4 se re-abre. |

⏳ **Caducan.** Son fotos: se re-miden **justo antes de desplegar**. Sus resultados se pegan en
`progress/impl_262_*.md`, con la consulta al lado y la hora CR de la corrida.

### ✅ Tomadas el 2026-08-22 a las 04:27 CR (producción, sólo lectura)

**M1 = 0 filas.** Ninguna orden con `fecha_reparto` posterior al día CR en curso, **en ningún
estado** —ni siquiera `por_recoger`, que era el caso que la medición de la 261 no cubría—. Las dos
órdenes que aquella contó el 21 (guías 17496963 y 57998428) llegaron a su día.

**M2 = 35**, pero **ninguna** en `por_recoger` ni `en_reparto`: todas en estados que R6 excluye. La
decisión **D3'** de `design.md` §4.4 **no se re-abre**.

Detalle y consultas en `progress/impl_262_backend.md`. ⏳ Siguen caducando: se re-miden antes de
desplegar.

---

## Preguntas abiertas (para la puerta humana)

> ## ✅ PUERTA HUMANA PASADA — 2026-08-22
>
> Las tres preguntas de abajo se conservan tal cual: son el razonamiento con el que se decidió.
> **Las tres se respondieron en contra de la recomendación del spec**, y eso ensancha la ficha.
>
> **P1 — CERRADA: SÍ, el rastro tiene que verse en «Ver historial».** Entra alcance nuevo y el
> diseño de §5 cambia. Lo que el spec ya dejó dicho y sigue siendo el trabajo duro: una corrección
> de día **no tiene «estado destino»**, así que hay que decidir cómo se pinta una entrada sin
> transición y cómo se fusionan dos fuentes en un DTO (`OrdenHistorialEntradaDTO`) que hoy sólo
> sabe de transiciones de estado.
>
> **P2 — CERRADA: SÍ, hay que avisar al mensajero cuando le cambian el día.** Consecuencia que el
> propio spec anticipa: `NotificacionEvento` es un **inventario cerrado a propósito** (146/D1, cinco
> valores) y ampliarlo **exige migración de enum**. ⚠️ Eso arrastra dos cosas no negociables: el
> `down.sql` de ese enum (mirar si el de ESE enum recrea-con-lista o sólo dropea, sin tocar los
> `down.sql` previos, que son fotos históricas) y que **el gate de esta ficha pasa a ser
> `./init.sh` COMPLETO**: tocar `db/migrations` hace que el modo rápido se niegue solo.
>
> **P3 — CERRADA: basta «hoy / mañana»**, el mismo vocabulario que al asignar (246/D2). Es la
> recomendación del spec y la que **mantiene la propiedad fuerte**: con un token, mover al pasado es
> **imposible por construcción**, no prohibido por un `if` que alguien puede relajar más adelante.


> Las **cuatro decisiones** que la ficha exigía cerrar están **cerradas** y no figuran aquí: quién
> (**R11**), desde dónde (**R13**), el pasado (**R3**) y el rastro (**R20-R26**). Su razonamiento
> completo vive en `design.md` §4. Lo que sigue es lo que **no** está en `docs/`, ni en `specs/`, ni
> en el código, y por tanto no se rellena con un supuesto (CLAUDE.md, regla 6).

**P1 · ¿El rastro tiene que verse en «Ver historial» de la orden?** Hoy esa línea de tiempo se
construye **sólo** con transiciones de estado (`OrdenHistorialEntradaDTO`: origen, destino, familia,
actor, motivo). Meter ahí una corrección de día obliga a fusionar dos fuentes en un DTO que no tiene
forma para ello (una corrección no tiene «estado destino»), y a decidir cómo se pinta una entrada sin
transición. **Recomendación del spec: no en esta versión** — el rastro existe y es consultable; darle
pantalla es una ficha aparte, pequeña y con su propia decisión de diseño. Si la respuesta es «sí»,
entra alcance nuevo y el diseño de §5 cambia.

**P2 · ¿Hay que avisar al mensajero cuando le cambian el día?** El caso que duele es «mañana → hoy»
sobre una orden que ya lleva encima: hoy se entera porque el control deja de estar deshabilitado, sin
que nadie se lo diga. `NotificacionEvento` es un **inventario cerrado a propósito** (146/D1, cinco
valores) y ampliarlo exige migración de enum. **Recomendación del spec: no en esta versión**, por la
misma razón por la que la 261 no deshabilitó el control de la tienda: la población medida es
pequeña y el coste de enterarse es bajo. Es una decisión de producto y se pregunta.

**P3 · ¿Basta el vocabulario «hoy / mañana», o hace falta poder fijar un día cualquiera?** La app
sólo sabe expresar esas dos opciones al asignar (246/D2), y esta ficha copia ese vocabulario a
propósito (§4.3): con un token, mover al pasado es **imposible por construcción** en vez de estar
prohibido por un `if` que alguien puede relajar. El caso medido (guía 17496963) era «21 → 22», o sea
mañana. **Pero el `UPDATE` a mano de producción sí puede dejar +2**, y la 261 escribió esa
posibilidad en su propio texto. Si la operación real necesita «el lunes desde el viernes», hay que
decirlo ahora: cambia las **dos** superficies y deja de ser un token.

---

### Lo que este spec NO ha inventado

Nada. Cada afirmación de este documento se leyó en `docs/`, en `specs/` o en el código, y las cuatro
decisiones que la ficha 262 dejó abiertas están **cerradas con su razonamiento medido**. Si al
implementar aparece un dato que no está en ninguno de los tres sitios, **se para y se pregunta**.
