# Feature 259 — El tablero del día cuenta por día de reparto

> **Zona:** `fullstack` (backend → frontend, secuenciado) · **SDD:** sí ·
> **Pantalla afectada:** `/monitoreo` (el tablero del día)
> **Escrito el:** 2026-08-21 · **Puerta humana pasada el 2026-08-21:** las cuatro preguntas
> abiertas están respondidas y **escritas como requisitos y tareas** (ver «Decisiones cerradas»
> al final). La ficha nace `backend` y pasa a `fullstack` por la respuesta a P2.

## El problema, en una frase del humano

> «Ya hay una opción de asignar para el día de mañana y si uno le da igual le muestra en el
> monitoreo de hoy.»

Y el daño no es que aparezca: es **dónde** aparece. Esa orden queda en estatus `por_recoger`, que
`BUCKET_POR_ESTATUS` manda al cubo `sinRecoger`, cuya ayuda dice literalmente «el mensajero todavía
no arrancó con ellas». **La pantalla acusa a alguien de ir retrasado por trabajo que todavía no es
suyo.**

**Esto NO es una regresión de la 258.** El CTE `ids_reparto` de `TableroDiaRepository` cuenta
«asignadas hoy» por `asignado_at` desde la feature 192, y desde el 2026-08-20 eso es **D10**, una
decisión firmada a conciencia y en contra de la recomendación del diseño de la 246. Lo que D10 no
contempló es el cubo `sinRecoger`. **Decisión humana del 2026-08-21: se revierte D10** (ver
`design.md` §1).

## Vocabulario (para que los requisitos de abajo no sean ambiguos)

| Término | Qué significa aquí, exactamente |
| --- | --- |
| **día representado** | La fecha calendario de Costa Rica que el tablero está mostrando. Hoy es siempre el día en curso: `ventana.fecha` de `ventanaDelDiaEnCursoCR(now)`. |
| **ventana del día** | El intervalo **semiabierto** `[desde, hasta)` en UTC que corresponde a ese día CR (`…T06:00:00.000Z` a `…T06:00:00.000Z` del siguiente). Convención de la 144/166, ya implementada en `lib/utils/ventana-dia-cr.ts`. |
| **día de reparto** | `orden.fecha_reparto` (`DATE`): la fecha calendario CR **PARA LA QUE** bodega hizo la asignación (feature 246). `NULL` significa una sola cosa: «no está reservada para un día que aún no ha llegado». |
| **rama (a)** | `fecha_reparto = día representado`. La orden reservada para ese día. |
| **rama (b)** | `fecha_reparto IS NULL` **Y** `asignado_at ∈ [desde, hasta)`. El **respaldo** para las órdenes anteriores a la 246, que nunca tendrán la columna porque no hay backfill. |
| **rama de recolección** | La orden con una transición `asignacion_recoleccion` (feature 157) cuyo `created_at` cae en la ventana del día. No se apoya en `asignado_at`: esa vía no lo estampa a propósito (192/R59). |
| **universo del día** | El conjunto de órdenes que el tablero cuenta ese día: rama (a) ∪ rama (b) ∪ rama de recolección, unidas como **conjuntos**. |
| **los ocho contadores** | `entregadas`, `reprogramadas`, `devueltas`, `rechazadas`, `incidentes`, `sinRecoger`, `enReparto`, `otros`. Su suma es `asignadas` (192/R25). |

---

## Requisitos

### A. El criterio del día (el corazón de la ficha)

**R1.** El sistema DEBE determinar el universo del día del tablero por el **día de reparto** de la
orden, mediante dos ramas **disjuntas**: la rama (a) y la rama (b), tal y como ya están definidas y
probadas para el denominador de `/ranking`.

**R2.** CUANDO una orden tiene mensajero asignado y su `fecha_reparto` es igual al día representado,
el sistema DEBE contarla en el tablero de ese día, **con independencia del día en que se asignó**.

**R3.** CUANDO una orden se asigna dentro del día en curso con un día de reparto **posterior**, el
sistema NO DEBE contarla en el tablero del día en curso: ni en `asignadas`, ni en ninguno de los
ocho contadores, ni en el detalle del mensajero, ni en la serie de entregas por hora.

**R4.** CUANDO una orden se asignó en un día **anterior** y su `fecha_reparto` es el día en curso, el
sistema DEBE contarla en el tablero del día en curso.

**R5.** SI una orden tiene `fecha_reparto` **anterior** al día representado, ENTONCES el sistema NO
DEBE contarla en el tablero de ese día. (La rama (a) es una igualdad, no un «menor o igual»: una
reserva vencida no es trabajo de hoy.)

**R6.** SI una orden tiene mensajero asignado y `fecha_reparto` nulo, ENTONCES el sistema DEBE
contarla en el día CR de su `asignado_at`. Esta rama de respaldo NO se retira ni se condiciona a una
fecha de despliegue: es también la respuesta correcta para cualquier orden que llegue a tener
mensajero por una vía que no estampe la columna.

**R7.** El sistema DEBE garantizar que **ninguna orden entre por la rama (a) y por la rama (b) a la
vez**, de modo que una misma orden no pueda contarse en dos días distintos por el criterio de
reparto. La cláusula `fecha_reparto IS NULL` de la rama (b) NO es redundante: es lo que hace las dos
ramas disjuntas.

**R8.** El sistema NO DEBE derivar el día de una expresión que **mezcle las dos columnas** en una
sola (por ejemplo `COALESCE(fecha_reparto, día(asignado_at))`), ni escribir dentro del SQL un
desplazamiento horario propio (`- interval '6 hours'`, `AT TIME ZONE`, un nombre de zona) ni usar
`startOfDayCR`. Debe haber **una sola definición del día** en todo el árbol de la feature.

**R9.** El día representado DEBE viajar al SQL como la **fecha calendario CR ya calculada por la
ventana** (`ventana.fecha`, `YYYY-MM-DD`), como **parámetro** con conversión explícita a `date`,
nunca interpolado en la cadena y nunca como un instante de JavaScript.

### B. La rama de recolección

**R10.** CUANDO una orden registra dentro de la ventana del día una transición de asignación de
recolección, el sistema DEBE contarla en el tablero de ese día aunque no tenga día de reparto y
aunque su `asignado_at` sea nulo. Esta rama es **exclusiva del tablero**: `/ranking` no la tiene, así
que las dos pantallas comparten el **criterio del día**, no el mismo universo (ver §C de `design.md`).

**R11.** SI una orden alcanzada por la rama de recolección está reservada para un día **distinto** del
representado, ENTONCES el sistema NO DEBE contarla ese día.

> **Por qué existe R11, en una secuencia concreta** (firmado en la puerta del 2026-08-21; el
> razonamiento completo, en `design.md` §5). 08:00 — mandan a **Ana** a recoger: fila de historial de
> hoy, `asignado_at` y `fecha_reparto` nulos. 14:00 — la orden ya está en bodega y se asigna a
> **Beto para mañana**: `mensajero_asignado_id` **se sobrescribe**. Sin R11, la rama de recolección
> la pesca hoy y la agrupa por el mensajero **actual** (192/R60: selecciona sólo `orden_id`, jamás el
> actor), así que **aparece hoy en la tarjeta de Beto, en `sinRecoger`** — «trabajo parado» de quien
> ni fue a recoger ni tiene que repartirla hoy. La acusación que esta ficha viene a quitar, entrando
> por la otra puerta. **No se «simplifica» quitando esta cláusula.**

### C. Lo que no puede romperse al cambiar el `WHERE`

**R12.** El sistema DEBE mantener la identidad de los ocho sumandos en **cada** fila del tablero:
`asignadas = entregadas + reprogramadas + devueltas + rechazadas + incidentes + sinRecoger +
enReparto + otros`.

**R13.** El sistema DEBE resolver las **tres** lecturas del tablero —conteo por mensajero, detalle
paginado y serie de entregas por hora— sobre la **misma** definición del universo del día, declarada
en un solo sitio. Un cambio en el criterio DEBE alcanzar a las tres a la vez.

**R14.** El total del detalle de un mensajero DEBE ser igual al contador `asignadas` de su tarjeta
para el mismo día y el mismo alcance.

**R15.** El último punto de la serie de entregas acumuladas DEBE seguir siendo igual al contador
`entregadas` de los totales del día.

**R16.** MIENTRAS el alcance del actor sea por zona, el recorte multi-tenant DEBE seguir aplicándose
**una sola vez y sobre la zona de la orden**, después de la unión de las ramas; el cambio de criterio
NO DEBE moverlo, duplicarlo ni introducir un segundo sitio donde se recorten inquilinos.

**R17.** El sistema NO DEBE escribir `orden.asignado_at` ni `orden.fecha_reparto` desde ninguna capa
de esta feature: sigue siendo de solo lectura, en un `WHERE` y en un `SELECT`.

**R18.** El sistema DEBE seguir resolviendo el tablero con **una** consulta agregada cuya
cardinalidad sea una fila por mensajero, el detalle con **una** consulta paginada y la serie con
**una** consulta agregada por hora. NO DEBE traer las órdenes del día a memoria para clasificarlas
en TypeScript.

**R19.** El sistema NO DEBE cambiar el contrato publicado del tablero ni del detalle: ningún campo
nuevo, ninguno retirado, ningún tipo distinto.

**R20.** El sistema NO DEBE añadir ni modificar migraciones ni índices en esta feature.

### D. Que el código no mienta

**R21.** El comentario de cabecera de `TableroDiaRepository` DEBE declarar la **reversión de D10**
con su fecha (2026-08-21) y su motivo, y NO DEBE seguir afirmando que contar por `asignado_at` es
deliberado ni que la divergencia con `/ranking` es esperada. La decisión vieja se **sustituye con
fecha y motivo**, no se borra: se conserva visible como superada.

**R22.** MIENTRAS el día cambie, el tablero DEBE seguir sirviéndose por su clave de caché por fecha
CR: una orden reservada para mañana DEBE aparecer en el tablero de mañana sin ninguna invalidación
manual y sin escritura ninguna sobre la orden.

### E. Que la pantalla no diga lo contrario de lo que cuenta

> Firmado en la puerta del 2026-08-21 (P2): los textos entran **en esta ficha**, no en otra. Un
> literal que promete algo que ya no ocurre es una mentira silenciosa —no rompe ningún test, no la
> caza `eslint`— y separarla en otra ficha la dejaría **viva en producción** mientras tanto.

**R23.** MIENTRAS el tablero no tenga ninguna orden del día dentro del alcance del actor, el estado
vacío NO DEBE prometer que la siguiente asignación aparecerá en él. Hoy dice «*En cuanto se asigne la
primera, aparecerá aquí*», y con el criterio nuevo eso es **falso** si esa primera se asigna para
otro día.

**R24.** El sistema DEBE describir en la interfaz el criterio nuevo —órdenes **de** hoy, no órdenes
**asignadas** hoy— en los cuatro sitios donde hoy afirma lo contrario: el estado vacío (título y
descripción), el nombre accesible de la tarjeta de mensajero, la cabecera del detalle y el aviso de
«se cerró el detalle».

**R25.** El texto visible NO DEBE usar jerga interna: ni «día de reparto» a secas, ni nombres de
columna, ni siglas. DEBE hablar como quien opera («de hoy», «para hoy»). La palabra **«Asignadas»**
del contador NO cambia: lo que dejó de ser cierto es el «hoy» que la acompaña, no el contador.

**R26.** La decisión **D10** DEBE seguir siendo alcanzable desde el spec donde se firmó:
`specs/246-asignacion-por-dia/requirements.md` §D10 DEBE llevar un **apéndice fechado** que apunte a
esta ficha, y su texto original DEBE permanecer **intacto** — un spec es la foto de su momento y no
se reescribe.

---

## Fuera de alcance (dicho para que no se cuele)

- **`/ranking` no se toca.** Su predicado ya es el bueno; esta ficha lo copia, no lo modifica.
- **No hay backfill de `fecha_reparto`.** Las órdenes viejas siguen contando por la rama (b) y
  envejecen solas.
- **La historia no se recalcula.** Lo que ya se vio en la pantalla de un día pasado no se reescribe:
  el tablero no persiste nada.
- **Índices y migraciones** — ver `design.md` §6; la respuesta es *no en esta ficha*. Como **no hay
  migración**, el gate rápido no se niega solo: el gate es `./init.sh --rapido` (ver `tasks.md`).
- **Un contador nuevo** para «lo que reservé para mañana». No se pide y no entra: sería un noveno
  cubo y rompería la identidad de ocho sumandos (`design.md` §10, A6).
- **El aviso a quien opera** no es código, pero **sí es obligatorio**: es tarea de release y
  **bloquea el despliegue** (`tasks.md` T8).

## Efecto aceptado por el humano

Lo que se asigne hoy para mañana **desaparece de la pantalla de hoy**. Quien reserve trabajo por
adelantado no lo verá hasta mañana. Está aceptado por escrito en la ficha 259 de `feature_list.json`.

---

## Decisiones cerradas — puerta humana del 2026-08-21

> Las cuatro preguntas abiertas de la primera versión de este spec están **respondidas y firmadas**.
> Se conserva el razonamiento entero de cada una —no sólo la conclusión— porque es lo que permite
> reconstruir dentro de seis meses **por qué** se decidió así. Cada una está ya escrita como
> requisito o como tarea; aquí queda el recibo.

| # | Pregunta | Firmada | Dónde vive ahora |
| --- | --- | --- | --- |
| **P1** | ¿Se cierra el agujero de la rama de recolección? | **SÍ** | **R11** + `design.md` §5 + T1.2/C9/M5 |
| **P2** | ¿Los textos de la pantalla entran en esta ficha? | **SÍ** (la ficha pasa a `fullstack`) | **R23, R24, R25** + tanda **T7** |
| **P3** | ¿Puntero fechado en el spec de la 246? | **SÍ**, apéndice; el original no se toca | **R26** + T1.4 + T2.4 |
| **P4** | ¿Aviso a quien opera? | **SÍ**, y **bloquea el despliegue** | **T8** |

### D1 (P1) — FIRMADA: **la cláusula entra**. Y el humano fue corregido, que es la parte que hay que dejar escrita

El enunciado de la ficha afirmaba que la rama de recolección «se queda como está **porque esas
órdenes no tienen día de reparto**». **Eso sólo vale en el instante de la transición**, y la
secuencia que lo desmonta está en R11 y en `design.md` §5: a las 14:00 la orden puede quedar
reservada para mañana **y con otro mensajero**, porque `mensajero_asignado_id` se sobrescribe. La
rama la seguiría pescando hoy y la pondría en la tarjeta de quien no fue a recoger, en `sinRecoger`.

**Queda escrito a petición del humano:** la corrección vino del spec, no del enunciado. Sin ese
párrafo, alguien quitará la cláusula «para simplificar» dentro de unos meses — es una línea que no
rompe ningún test si desaparece.

**La secuencia, entera, porque es la razón de existir de la cláusula:**

1. 08:00 — el maestro manda a **Ana** a recoger a la tienda → fila en `orden_historial_estado` con
   `origen_tipo = asignacion_recoleccion` y `created_at` de hoy. `asignado_at` y `fecha_reparto`
   siguen nulos (comprobado: `OrdenRepository.asignarRecoleccionLote` no escribe ninguna de las dos).
2. 14:00 — la orden ya está en bodega central y se asigna a **Beto** **para mañana** →
   `mensajero_asignado_id = Beto`, `fecha_reparto = mañana`, estatus `por_recoger`.
3. Hoy, el tablero la pesca por la rama de recolección… y la agrupa por el mensajero **actual**
   (192/R60: `ids_recoleccion` selecciona solo `orden_id`, jamás el actor). **Aparece hoy en la
   tarjeta de Beto, en el cubo `sinRecoger`.**

Es decir: **la acusación vuelve por la otra puerta**, y encima sobre alguien que no tuvo nada que ver
con la recolección. No es un caso nuevo que esta ficha introduzca —ya pasa hoy—, pero sería absurdo
arreglar la puerta principal y dejar ésta abierta.

**Coste de cerrarlo:** una cláusula en una rama. **Lo que NO se pierde:** nada verdadero — la tarjeta
donde aparecía ya no era la de quien fue a recoger. → **R11**, `design.md` §5, tareas T1.2 / C9 / M5.

### D2 (P2) — FIRMADA: **los textos entran en esta ficha**, que pasa a `fullstack`

Un literal que promete «*en cuanto se asigne la primera, aparecerá aquí*» y deja de ser cierto es
**la clase de mentira silenciosa que este repo persigue**: no rompe ningún test, no la caza `eslint`
y sólo se ve abriendo la app. Separarla en otra ficha la dejaría **viva en producción** mientras
tanto, que es exactamente lo contrario de lo que esta ficha viene a hacer.

**Los sitios, censados. Son CUATRO, no tres** — el cuarto no estaba en la pregunta original y se
suma por el mismo motivo: dejarlo diría dos cosas distintas en la misma pantalla.

| Dónde | Texto de hoy | Por qué deja de ser cierto |
| --- | --- | --- |
| `TableroDiaEstados.tsx` (`VACIO_TITULO` + `VACIO_DESCRIPCION`) | «Sin órdenes asignadas **hoy**» · «Ningún mensajero tiene órdenes asignadas hoy dentro de tu alcance. **En cuanto se asigne la primera, aparecerá aquí**.» | Falso si esa primera se asigna para otro día: no aparecerá. |
| `MensajeroCard.tsx` (`aria-label`) | «N asignadas **hoy**» | Ahora son «de hoy», que no es lo mismo. |
| `DetalleMensajeroPanel.tsx` | «N órdenes asignadas **hoy**» | Igual. |
| `TableroDiaModule.tsx` (`DESAPARECIDO_DESCRIPCION`) | «ya no tiene órdenes asignadas **hoy** dentro de tu alcance» | Igual. **Este es el cuarto.** |

`SIN_COINCIDENCIAS_DESCRIPCION` («El día sí tiene órdenes asignadas…») **no** entra: habla del filtro
de texto, no del criterio del día. → **R23, R24, R25**, tanda **T7**.

### D3 (P3) — FIRMADA: **apéndice fechado en la 246, y su texto original no se toca**

Un spec es la foto de su momento y no se reescribe; pero D10 se firmó allí, y quien lo lea dentro de
seis meses tiene que poder llegar hasta aquí. Va **una línea al final de §D10**, con fecha y motivo,
como apéndice. → **R26**, tareas T1.4 (escribirlo) y T2.4 (una guardia que comprueba **las dos
mitades**: que el puntero está y que el texto original sigue verbatim).

### D4 (P4) — FIRMADA: **hay aviso, y BLOQUEA EL DESPLIEGUE**

El maestro que asigne para mañana verá **desaparecer** esas órdenes de su tablero de hoy. Sin aviso
previo lo leerá como «se perdieron», y es el patrón que ya mordió a este repo: **el sistema no falla,
aparenta**. La 246 mandó dos avisos antes de desplegar por una razón parecida. No bloquea el PR;
bloquea la release. → tarea **T8**, escrita como tal y no como nota suelta.
