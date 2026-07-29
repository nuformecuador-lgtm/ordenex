# Feature 154 — Catálogo de estados v2: `por_recolectar_en_tienda` + `incidente` + grafo nuevo

> Zona: `backend` · Complejidad: `high` · Depende de: **153** (rename `en_ruta` → `en_reparto`)
> Rama sugerida: `feature/154-catalogo-estados-v2`
> **Nomenclatura:** este spec asume la 153 YA aplicada. Todo lo que aquí se llama `en_reparto`
> es el value que hoy en `dev` se llama `en_ruta`. No se vuelve a nombrar `en_ruta` salvo cita
> histórica explícita.

> ## PUERTA T0 CERRADA — 2026-07-29
>
> Las preguntas abiertas del final de este archivo **ya están respondidas**. Lo que sigue manda
> sobre el texto original de los requisitos donde haya contradicción:
>
> - **Q1 — `#5` SOBREVIVE.** `en_preparacion → en_bodega_central` vía `generacion_guia` es el
>   destino único de generar guía y no se retira. (R22 ya está escrito con esta lectura.)
> - **Q2 — la 154 es SOLO ADITIVA. No se retira NINGUNA arista.** **R18, R19, R20 y R21 quedan
>   DIFERIDOS**: `#4`/`#6`/`#7c` los retira la feature **156** y `#1`/`#3`/`#7b` la feature
>   **155**, en el mismo commit que recablea el service que hoy las ejecuta
>   (`GuiaAsignacionService`). Retirarlas aquí dejaría `en_fulfillment` sin salidas (rompe R26) y
>   atraparía sus órdenes vivas. En consecuencia, **R24 no se verifica sobre "una transición
>   retirada por R18–R21"** (no hay ninguna), sino sobre cualquier par ilegal que involucre los
>   values nuevos.
> - **Q3 — tren a producción:** 154 + 155 + 156 viajan juntas a `prod`.
> - **Q4 — deliberado.** `en_reparto → incidente` va vía `gestion`; el value `incidente` del enum
>   `orden_historial_origen_tipo` queda **declarado sin productor** hasta la 158.
> - **Q5 — CONFIRMADA tal cual la propone el spec.** `por_recolectar_en_tienda` → "Por recolectar
>   en tienda", variante `warning`; `incidente` → "Incidente", variante `danger`. Sin refuerzo de
>   acento de marca.
> - **Q6 — no aplica aquí.** `por_recolectar_en_tienda` no se excluye de ningún tablero ni conteo
>   en esta feature; si hace falta, es trabajo de la 157.
> - **DECISIÓN NUEVA — `incidente` es TERMINAL y SIN NINGUNA salida.** El estado `indemnizada`
>   que se planteó en el gate para desterminarlo quedó **descartado**: no se implementa, no se
>   declara y no se deja preparado.
>
> Recuentos efectivos con la decisión Q2 (ver `design.md` §3.4): 45 aristas de flujo, 41 pares
> dirigidos únicos, 4 aristas de creación.

## Alcance

Alta de los DOS values nuevos del flujo v2 y reescritura del mapa de transiciones al grafo
aprobado. **Ningún service cambia**: las aristas nuevas quedan DECLARADAS y SIN USO hasta que
lleguen las features 155–158.

Fuera de alcance (features siguientes): bifurcación de creación por bodega y retiro de
`en_fulfillment` (155), generar guía sin mensajero (156), escáner de recolección en tienda (157),
resultado `incidente` en la gestión + indemnización (158).

---

## Requisitos

### Catálogo de estados (`order_status`)

**R1.** El sistema DEBE reconocer `por_recolectar_en_tienda` como estado válido del catálogo de
estados de orden.

**R2.** El sistema DEBE reconocer `incidente` como estado válido del catálogo de estados de orden.

**R3.** El sistema DEBE conservar sin renombrar, sin reordenar y sin borrar los 18 estados que ya
existían antes de esta feature; el catálogo pasa a tener exactamente 20 estados.

**R4.** El sistema DEBE dar de alta los dos estados nuevos de forma idempotente: reaplicar el alta
sobre un catálogo que ya los contiene DEBE dejarlo con 20 estados y sin duplicados.

**R5.** CUANDO se revierta el alta de catálogo Y ninguna orden ni fila de historial referencie
`por_recolectar_en_tienda` ni `incidente`, el sistema DEBE dejar el catálogo con exactamente los 18
estados previos.

**R6.** SI al revertir el alta de catálogo alguna orden o fila de historial referencia
`por_recolectar_en_tienda` o `incidente`, ENTONCES el sistema DEBE conservar esos estados y no
romper ninguna referencia existente.

### Familias de transición (`orden_historial_origen_tipo`)

**R7.** El sistema DEBE reconocer `recoleccion_tienda` como familia de origen de una transición de
estado.

**R8.** El sistema DEBE reconocer `incidente` como familia de origen de una transición de estado.

**R9.** El sistema DEBE mantener correspondencia EXACTA, en ambas direcciones, entre el catálogo de
familias declarado en el código y el tipo respaldado en base de datos: una familia declarada en el
código que no exista en base de datos, o una familia en base de datos que el código no declare,
DEBE romper el build.

**R10.** CUANDO se revierta el alta de familias, el sistema DEBE dejar el tipo con exactamente las
22 familias previas y con la columna de historial migrada a ese tipo.

**R11.** SI al revertir el alta de familias existe alguna fila de historial cuyo origen sea
`recoleccion_tienda` o `incidente`, ENTONCES la reversión DEBE abortar ruidosamente sin borrar ni
reescribir esas filas.

**R12.** El sistema DEBE mantener `recoleccion_tienda` e `incidente` FUERA de la familia de
orígenes que enlazan una gestión, de modo que ninguno de los dos altere el conteo de intentos de
entrega.

### Grafo de transiciones — ALTAS

**R13.** El sistema DEBE considerar legal que una orden NAZCA en `por_recolectar_en_tienda`.

**R14.** El sistema DEBE considerar legal la transición `por_recolectar_en_tienda → en_ruta_bodega_central`.

**R15.** El sistema DEBE considerar legal la transición `en_reparto → incidente`.

**R16.** El sistema DEBE clasificar `incidente` como estado TERMINAL (sin salida esperada en el
flujo normal).

**R17.** El sistema DEBE clasificar `por_recolectar_en_tienda` como estado NO terminal.

### Grafo de transiciones — BAJAS *(DIFERIDAS a las features 155/156 por la decisión Q2)*

> Los cuatro requisitos de abajo **no se cumplen en la 154 y es correcto que no se cumplan**. La
> arista muere en el commit que retira a su último productor. En esta feature se verifica lo
> contrario —que siguen siendo legales— para que el día en que la 155/156 las retire, el test se
> ponga rojo y obligue a mover el caso.

**R18.** *(feature 156)* El sistema DEBE considerar ILEGAL la transición `en_preparacion → por_recoger`.

**R19.** *(feature 156)* El sistema DEBE considerar ILEGAL la transición `en_preparacion → en_ruta_bodega_satelite`,
cualquiera que sea la familia que la dispare.

**R20.** *(feature 155)* El sistema DEBE considerar ILEGAL la transición `en_fulfillment → por_recoger`.

**R21.** *(feature 155)* El sistema DEBE considerar ILEGAL la transición `en_fulfillment → en_ruta_bodega_satelite`,
cualquiera que sea la familia que la dispare.

**R22.** El sistema DEBE conservar legal la transición `en_preparacion → en_bodega_central`, única
salida de la numeración de guía tras el cambio. *(Ver Q1: la ficha la lista a la vez como retirada
y como superviviente.)*

**R23.** El sistema DEBE conservar legales las tres asignaciones que salen de una bodega:
`en_bodega_central → en_ruta_bodega_satelite`, `en_bodega_central → por_recoger` y
`en_bodega_satelite → por_recoger`.

**R24.** CUANDO se intente una transición ilegal, el sistema DEBE rechazarla con el
error de transición ilegal, y el mensaje del error DEBE mencionar únicamente los dos `value` del
catálogo, sin identificadores, órdenes, actores ni ningún dato del cliente. *(Reformulado en la
puerta T0: la redacción original decía "una transición retirada por R18–R21" y esas bajas quedaron
diferidas. Se verifica sobre pares ilegales que involucran los dos values nuevos.)*

### Invariantes del grafo

**R25.** El sistema DEBE romper el build SI algún `value` del catálogo queda sin clasificar en el
mapa de transiciones, y SI el mapa declara un `value` que no está en el catálogo.

**R26.** El sistema DEBE mantener el invariante de conectividad: todo estado NO terminal tiene al
menos una entrada y al menos una salida, y todo estado terminal tiene al menos una entrada. El
fallo DEBE nombrar los `value` ofensores.

**R27.** El sistema DEBE mantener el inventario auditable de aristas sincronizado con el mapa: toda
arista del inventario existe en el mapa, y todo par del mapa está en el inventario.

**R28.** MIENTRAS las features 155–158 no estén implementadas, el sistema DEBE no ejecutar ninguna
de las transiciones dadas de alta por R13–R15: los values `por_recolectar_en_tienda` e `incidente`
y las familias `recoleccion_tienda` e `incidente` DEBEN aparecer únicamente en el catálogo, el mapa
de transiciones, la capa de presentación de estatus, las migraciones y los tests.

### Presentación del estatus

**R29.** CUANDO la interfaz muestre el estatus `por_recolectar_en_tienda`, el sistema DEBE mostrar
una etiqueta legible en español y una variante de badge definida para ese value.

**R30.** CUANDO la interfaz muestre el estatus `incidente`, el sistema DEBE mostrar una etiqueta
legible en español y una variante de badge definida para ese value.

**R31.** SI la interfaz recibe un valor de estatus que no pertenece al catálogo conocido por el
build, ENTONCES DEBE seguir mostrando el valor crudo con variante neutra sin romper la vista.

### Robustez frente al desfase catálogo ↔ build

**R32.** SI la base de datos contiene un estado de orden que el build en curso no reconoce,
ENTONCES el sistema DEBE rechazar la transición implicada con el error de "transición no validable"
y motivo `estatus_desconocido`, sin permitirla ni registrarla.

**R33.** El sistema DEBE seguir validando correctamente todas las transiciones preexistentes cuando
el build conoce los dos estados nuevos pero la base de datos todavía no los tiene.

---

## Preguntas abiertas — TODAS RESPONDIDAS (2026-07-29)

> Se dejan con su redacción original para que quede el registro de qué se preguntó. Las
> respuestas están arriba, en el bloque "PUERTA T0 CERRADA".

**Q1 (BLOQUEANTE) — `#5` está a la vez en la lista de bajas y en la de supervivientes.**
La ficha ordena retirar «**#4 y #5** desde `en_preparacion`» y, dos líneas después, «tras el cambio
**generar guía solo puede llevar a `en_bodega_central`**». Pero `#5` ES exactamente
`en_preparacion → en_bodega_central` vía `generacion_guia`
(`lib/types/order-status-transiciones.ts:49`). Retirar `#5` deja `en_preparacion` sin ninguna
salida — rompe R26 y deja a la feature 156 sin arista de destino.
**Lectura propuesta (pendiente de confirmar):** se retiran `#4`, `#6` y `#7c`; `#5` SOBREVIVE.
R22 está escrito con esa lectura. Si la respuesta es "retirar también `#5`", hay que decir qué
arista lo sustituye.

**Q2 (BLOQUEANTE) — `en_fulfillment` se queda sin salidas, pero sigue siendo estado de nacimiento.**
Retirar `#1`, `#2`, `#3` y `#7b` deja `en_fulfillment: []`. El estado no se retira hasta la 155, así
que entre la 154 y la 155: (a) rompe el invariante de conectividad (R26) y (b) toda orden viva en
`en_fulfillment` queda atrapada — el guard falla CERRADO, no hay salida legal.
Opciones: **(i)** conservar `#2` (`en_fulfillment → en_bodega_central`) como puente hasta que la 155
retire el estado; **(ii)** retirar las cuatro y declarar `en_fulfillment` vestigial, lo que obliga a
reescribir el test que exige el conjunto vestigial VACÍO; **(iii)** adelantar el backfill de
`en_fulfillment → en_preparacion` de la 155 a esta feature (amplía el alcance).
R21 no cubre `#2` a propósito: falta la decisión.

**Q3 (BLOQUEANTE) — secuencia de despliegue: las aristas retiradas SÍ se usan hoy.**
`GuiaAsignacionService` ejecuta ahora mismo `#1`/`#4` (generar guía con mensajero → `por_recoger`),
`#3`/`#6` (no-GAM → `en_ruta_bodega_satelite`) y `#7b`/`#7c`
(`ORIGEN_RUTEO_SATELITE`, `GuiaAsignacionService.ts:35`). El alcance dice "sin tocar ningún
service", pero retirar esas aristas hace que esos caminos lancen `TransicionIlegalError` en cuanto
la 154 llegue a `prod` y hasta que la 156 lo recablee.
¿La 154 se despliega sola a producción, o el lote 154 + 155 + 156 viaja como un TREN a `prod`?
Sin respuesta no se puede fijar el plan de release.

**Q4 — la familia `incidente` nace huérfana.**
El alcance pide dar de alta la familia `incidente` en el enum de historial Y declarar la arista
`en_reparto → incidente` **vía `gestion`**. Con eso, el value `incidente` del enum queda declarado
sin ninguna arista que lo produzca. ¿Es deliberado (lo consumirá la 158, p. ej. para una anotación
posterior del admin) o la arista debía ir vía `incidente` en lugar de `gestion`?
La legalidad no depende de la familia, así que la respuesta no cambia el grafo — sí cambia qué se
escribe en la línea de tiempo y si el value queda muerto hasta la 158.

**Q5 — etiqueta y variante de badge de los dos nuevos.**
Propuesta: `por_recolectar_en_tienda` → "Por recolectar en tienda", variante `warning` (estado de
ESPERA, mismo criterio que `por_devolver`); `incidente` → "Incidente", variante `danger` (mismo
criterio que `rechazada`). Sin refuerzo de acento de marca en ninguno. ¿Se confirma?

**Q6 — `por_recolectar_en_tienda` y el conteo de intentos / el cierre del día.**
Un estado de espera nuevo previo a la bodega central: ¿debe quedar excluido de los tableros y
conteos operativos existentes (cierre del día, ranking, "sin gestionar") o eso se resuelve
íntegramente en la 157? Esta feature no toca services, pero la respuesta condiciona si hace falta
algún guard declarativo aquí.
