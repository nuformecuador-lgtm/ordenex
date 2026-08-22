# Feature 246 — Elegir para qué día es la asignación, y que el corte lo respete

> **Al asignar órdenes a un mensajero, bodega elige si son para el reparto de HOY o para el del DÍA
> SIGUIENTE. El corte nocturno deja de barrer —y de generar cierre `vencido` por— las que son de
> mañana.**
>
> **Por qué duele el doble.** Hoy el corte hace dos cosas en la misma transacción: transiciona a
> `sin_gestionar` las órdenes que el mensajero no desenlazó y le crea un `cierre_dia` en estado
> `vencido` (`CorteDiarioService.ejecutarCorte` → `CierreDiaRepository.crearCierre`). Desde la
> **ficha 241, firmada el 2026-08-20**, un cierre `vencido` **bloquea al mensajero para gestionar y
> cobrar** (`OrdenRepository.findMensajerosBloqueadosParaGestion`). Así que un `vencido` nacido de
> una asignación tardía de la bodega **no es ruido: le corta el trabajo del día siguiente a quien no
> hizo nada mal**. Esta ficha es lo que impide que la regla de la 241 castigue a quien no debe.
>
> **Alcance del producto: HOY o MAÑANA, no una fecha futura cualquiera.** Una fecha arbitraria es
> planificación de ruta y es otra feature. Ver **D2**: el alcance del producto no cambia, pero el
> diseño recomienda que lo **almacenado** sea una fecha absoluta y no una marca de «para mañana»,
> por una razón que se explica allí.
>
> ⚠️ **AMPLIACIÓN DE ALCANCE — 2026-08-20.** En la puerta humana, **D7 se firmó EN CONTRA de la
> recomendación de este spec**: el **denominador del ranking diario se corrige aquí**, no en una
> ficha aparte. El ranking deja de contar «asignadas hoy» por `asignado_at` y pasa a contarlas por
> **día de reparto**. Eso mete dentro de esta ficha una segunda superficie —`RankingRepository`,
> `RankingService`, `RankingSnapshotService`— y, con ella, **el podio y `premio_ranking`**. La
> sección **H** son los requisitos de esa parte; el registro de la decisión y su coste están en
> **D7** y en «PUERTA HUMANA PASADA». **Con esto la ficha deja de ser `medium`** (ver el veredicto
> al final).
>
> Fuentes leídas para escribir esto: `lib/services/CorteDiarioService.ts`,
> `lib/repositories/CorteDiarioRepository.ts`, `lib/repositories/CierreDiaRepository.ts`
> (`crearCierre`), `lib/services/GuiaAsignacionService.ts`, `lib/services/AsignacionSateliteService.ts`,
> `lib/services/MisAsignacionesService.ts`, `lib/utils/fecha-cr.ts`, `db/schema.prisma` y `vercel.json`.

---

## Vocabulario

| Término | Qué significa aquí |
| --- | --- |
| **día de Costa Rica** | La fecha calendario de `America/Costa_Rica` (UTC-6 fijo, sin horario de verano). Es la única definición del día que este repo admite y vive en `lib/utils/fecha-cr.ts`. |
| **día de reparto** | El día de Costa Rica **para el que** una asignación fue hecha. Es un dato NUEVO: hoy no existe. |
| **asignar** | Fijar el mensajero de un lote de órdenes y transicionarlas a `por_recoger`. Ocurre en **dos** superficies: bodega central (`asignarDesdeBodega`) y bodega satélite (`asignarDesdeSatelite`). |
| **`asignado_at`** | Columna que YA existe: el **instante** en que se asignó. No dice para qué día es. No se toca en esta ficha. |
| **corte** | El cron `/api/cron/corte-diario`, `0 6 * * *` UTC = **00:00 de Costa Rica**. |
| **día que el corte cierra** | La **jornada que acaba de terminar** cuando la corrida arranca. Corriendo a las 00:00, es el día de Costa Rica **anterior** al que la corrida inaugura. Es el ancla de toda la sección B, y no es lo mismo que «el día de Costa Rica en que la corrida se ejecuta»: confundirlos barre justo lo que esta ficha protege (`design.md` §5.1). |
| **barrer** | Lo que el corte hace con las órdenes que el mensajero no desenlazó: transicionarlas a `sin_gestionar` conservando `mensajero_asignado_id`. Hoy alcanza a `en_reparto` y a `ayuda_tienda`. |
| **cierre vencido** | `cierre_dia` con `estado='vencido'` creado por el corte. Desde la 241 **bloquea gestionar y cobrar**. |
| **reserva** | Que una orden tenga día de reparto **posterior** al día de Costa Rica en curso. Una reserva es una protección **frente al corte**, no un candado contra el mensajero (ver **D5**). |

### Precisión que hay que tener delante (verificada en el código, no supuesta)

Asignar deja la orden en **`por_recoger`**, y el corte **hoy no barre `por_recoger`**: su lista es
`["en_reparto", "ayuda_tienda"]` (`CorteDiarioRepository.ESTADOS_A_BARRER`). Por tanto el defecto
descrito en la ficha se materializa **cuando el mensajero ya recogió** —cargó la furgoneta esa misma
noche y las órdenes pasaron a `en_reparto`— o cuando pidió ayuda. Una asignación tardía que **nadie
recoge** sobrevive hoy al corte. Esto **no reduce el alcance de la ficha**: reduce la población y hay
que medirla (**M2**), porque decide si el problema es diario o excepcional.

---

## A · Elegir el día al asignar

**R1.** CUANDO un usuario asigna un lote de órdenes a un mensajero desde la **bodega central**, el
sistema DEBE ofrecerle elegir entre dos opciones: reparto de **hoy** o reparto del **día siguiente**.

**R2.** CUANDO un usuario asigna un lote de órdenes a un mensajero desde una **bodega satélite**, el
sistema DEBE ofrecerle la misma elección, con el mismo significado.

**R3.** El sistema DEBE aplicar la elección al **lote completo**: una asignación, un día de reparto.

**R4.** SI una petición de asignación no trae la elección, ENTONCES el sistema DEBE tratarla como
**hoy**, que es el comportamiento actual, y no DEBE fallar.

**R5.** El sistema DEBE resolver **en el servidor** a qué fecha calendario corresponden «hoy» y
«mañana», usando el día de Costa Rica.

**R6.** El sistema NO DEBE aceptar del cliente una **fecha** de reparto: sólo la elección entre las
dos opciones. Una fecha calculada con el reloj del navegador no DEBE poder determinar el día de
reparto de ninguna orden.

**R7.** CUANDO el sistema fija el mensajero asignado de una orden, DEBE registrar el día de reparto
en la **misma escritura**, nunca en una segunda pasada.

**R8.** CUANDO el sistema fija el mensajero asignado por una vía que **no** ofrece la elección
(deshacer una gestión, cualquier reasignación interna), DEBE registrar como día de reparto el **día
de Costa Rica en curso**.

**R9.** CUANDO el sistema **retira** la asignación de una orden —limpia `mensajero_asignado_id` y
`asignado_at`—, DEBE limpiar el día de reparto en la **misma escritura**.

**R10.** El sistema DEBE mantener el invariante: el día de reparto sólo tiene valor mientras la orden
tenga mensajero asignado; nunca DEBE quedar un día de reparto que contradiga a `asignado_at`.

---

## B · El corte: qué respeta y qué barre — **el corazón de la ficha**

**R11.** MIENTRAS una orden tenga un día de reparto **estrictamente posterior al día que la corrida
del corte cierra**, el corte NO DEBE transicionarla a `sin_gestionar`.

**R12.** SI el día de reparto de una orden es **anterior o igual** al día que la corrida cierra, O la
orden **no tiene** día de reparto, ENTONCES el corte DEBE barrerla exactamente como hoy, sin ninguna
diferencia.

**R13.** El sistema DEBE hacer que la protección **caduque sola**: una orden reservada para el día
`X` que siga sin desenlace DEBE ser barrida por la primera corrida del corte que cierre el día `X` o
uno posterior. Ninguna orden DEBE poder quedar protegida indefinidamente, y esa caducidad NO DEBE
depender de que alguien escriba nada.

**R14.** SI las **únicas** señales por las que un mensajero entraría en el corte son órdenes
protegidas por R11, ENTONCES el corte NO DEBE crearle cierre `vencido`.

**R15.** SI un mensajero tiene, además de órdenes protegidas, gestiones sin cerrar u órdenes no
protegidas, ENTONCES el corte DEBE crearle su cierre `vencido` exactamente como hoy, y DEBE barrer
**sólo** las no protegidas, dejando intactas las protegidas.

**R16.** El sistema DEBE aplicar la **misma** condición de día en la consulta que **selecciona** a
los mensajeros del corte y en la que **transiciona** las órdenes. Las dos DEBEN decir lo mismo, y un
cambio en una sin la otra DEBE poner un test en rojo.

**R17.** El sistema DEBE derivar el día del corte de la **única** definición del día de Costa Rica
que ya usa el resto del sistema. NO DEBE introducirse una segunda definición del día ni aritmética de
zona horaria dentro de una consulta.

**R18.** La condición de día NO DEBE alterar ninguna otra parte del corte: ni la selección por
gestiones sin cerrar, ni la exclusión de quienes ya tienen un cierre abierto, ni el snapshot de
totales, ni la idempotencia de la corrida.

---

## C · Lo que ya está asignado el día del despliegue

**R19.** Las órdenes anteriores al despliegue DEBEN comportarse en el corte **exactamente** como hoy,
sin migración de datos ni relleno de valores.

**R20.** La ausencia de día de reparto DEBE significar, para el corte, **una sola cosa**: «esta orden
no está reservada para un día que aún no ha llegado». El corte NO DEBE preguntar «¿es de hoy?».

**R21.** La migración que introduzca el día de reparto DEBE ser reversible, y su reversión DEBE
dejar la base en un estado que el código anterior a esta feature pueda leer sin cambios.

---

## D · Lo que ve el mensajero

**R22.** El portal del mensajero DEBE distinguir las órdenes reservadas para el día siguiente de las
de hoy, con palabras que digan qué son.

**R23.** El sistema NO DEBE ocultarle al mensajero una orden que tiene asignada por estar reservada
para mañana.

**R24.** El sistema NO DEBE impedirle al mensajero recoger ni gestionar una orden reservada para
mañana. La reserva es una protección frente al corte, no un candado.

**R25.** CUANDO llegue el día reservado, la orden DEBE dejar de presentarse como «para mañana» sin
que nadie ejecute ninguna acción.

**R26.** El sistema DEBE calcular esa distinción **en el servidor**, no en el navegador.

---

## E · Lo que ve quien asigna

**R27.** La superficie de asignación DEBE dejar la opción **«hoy» preseleccionada**.

**R28.** La superficie de asignación DEBE nombrar las dos opciones con lenguaje claro y sin siglas, y
DEBE confirmar, tras asignar, para qué día quedó el lote.

**R29.** Las etiquetas de día que se muestren NO DEBEN derivarse del reloj del navegador.

---

## F · Lo que esta ficha NO cambia

**R30.** El día de reparto NO DEBE alterar ningún importe, ningún total de cierre, ningún movimiento
de wallet ni ninguna tarifa.

**R31.** El día de reparto NO DEBE crear estados de orden nuevos, ni cambiar el estado al que la
asignación transiciona (`por_recoger`), ni abrir aristas nuevas en el flujo de estados.

**R32.** El día de reparto NO DEBE emitir webhooks nuevos ni cambiar la carga de los existentes.

**R33.** El sistema NO DEBE escribir en `asignado_at` nada que no escriba hoy: esta ficha **lee** esa
columna y la **acompaña**, pero no cambia quién la estampa ni cuándo.

**R34.** La asignación de **recolección en tienda** queda fuera: no ofrece la elección y no se ve
afectada. Su aislamiento respecto del corte (167/R34) DEBE seguir intacto.

---

## G · Trazabilidad

**R35.** El sistema DEBE poder responder, para una orden con mensajero asignado, para qué día quedó
su asignación vigente.

---

## H · El denominador del ranking *(D7, firmada el 2026-08-20 EN CONTRA de la recomendación)*

> El ranking diario mide `entregadas / asignadas` por mensajero, y las tres primeras posiciones
> cobran el importe de `premio_ranking`. Hoy el denominador son las órdenes cuyo `asignado_at` cae en
> la ventana del día de Costa Rica. Esta sección lo cambia por el **día de reparto**.

**R36.** El sistema DEBE contar, en el denominador del ranking de un día, las órdenes cuyo **día de
reparto** sea ese día.

**R37.** SI una orden **no tiene** día de reparto, ENTONCES el sistema DEBE contarla en el
denominador del día de Costa Rica al que pertenece su `asignado_at`.

**R38.** CUANDO una orden se asigna un día para el reparto del día siguiente, el sistema DEBE
contarla en el denominador **del día siguiente** y NO en el del día en que se asignó.

**R39.** El sistema NO DEBE cambiar el numerador: sigue siendo el número de **entregas vigentes
registradas ese día**.

**R40.** SI una orden reservada para mañana se entrega hoy, ENTONCES el sistema DEBE contar la
entrega en el numerador de **hoy** y la orden en el denominador de **mañana**.

**R41.** El sistema DEBE aplicar **el mismo criterio de denominador** en el ranking en vivo y en el
snapshot diario congelado. Los dos DEBEN poder diferir sólo en **qué día** miran, nunca en **cómo**
lo cuentan.

**R42.** El sistema NO DEBE modificar ninguna fila de ranking ya congelada. El criterio nuevo DEBE
aplicarse **sólo de su entrada en vigor hacia adelante**.

**R43.** CUANDO el criterio nuevo entre en vigor, el denominador del día del despliegue NO DEBE
sufrir un salto artificial por las órdenes asignadas antes de que la columna existiera.

**R44.** El sistema DEBE resolver el denominador con una consulta que se apoye en un índice, sin
recorrer la tabla de órdenes completa.

**R45.** El sistema NO DEBE cambiar cómo se ordena el ranking, cómo se asigna el podio, cómo se
redondea el porcentaje ni cómo se congela el premio: el único cambio es **qué órdenes entran en el
denominador**.

**R46.** El sistema DEBE dejar el denominador de un día **estable** antes de que la corrida que lo
congela se ejecute: ninguna escritura posterior DEBE poder cambiar el denominador de un día ya
congelado.

---

## Límites declarados (no son controles, son honestidad)

1. **Un mensajero con un cierre abierto no entra en el corte.** Es comportamiento **previo**
   (109/R10/R29, `ESTADOS_CIERRE_ABIERTOS`): sus órdenes en `en_reparto` no se barren hasta que su
   cierre se resuelva. Esta ficha **no lo toca ni lo empeora**, pero conviene saberlo antes de
   diagnosticar «una orden que no se barrió».
2. **`por_recoger` no se barre nunca.** Una orden asignada y jamás recogida se queda con el
   mensajero indefinidamente, con o sin esta ficha. Cambiar eso es otra decisión.
3. **La reserva no impide entregar hoy.** Por **D5**, un mensajero puede recoger y entregar hoy una
   orden reservada para mañana. Si algún día se quiere impedirlo, hace falta un requisito nuevo y
   una decisión nueva; no es un olvido de esta ficha.
4. **R40 es una asimetría consciente, no un cabo suelto.** Entregar hoy algo reservado para mañana
   **sube** el porcentaje de hoy y **baja** el de mañana, porque el numerador y el denominador de esa
   orden caen en días distintos. El sistema **ya convive con esa asimetría** en el otro sentido —una
   orden asignada ayer y entregada hoy—, hasta el punto de que `ranking_snapshot_fila` renuncia a
   propósito a un `CHECK entregadas <= asignadas` y lo deja escrito en el esquema. Alinear los dos
   lados está **descartado con motivo** en `design.md` §10-F.

---

## Fuera de alcance

- Una **fecha futura arbitraria** (planificación de ruta a varios días).
- **Cambiar el día** de una orden ya asignada sin deshacer la asignación (ver **D8**).
- Mostrar el día de reparto en el **listado general de órdenes** o exportarlo a Excel (ver **D9**).
- **Recalcular los rankings ya congelados** (ver **D11**): `ranking_snapshot_dia` y
  `ranking_snapshot_fila` son **inmutables por diseño** y esta ficha no las reescribe (R42).
- Pagar el premio: `premio_ranking` **no emite ningún movimiento de wallet** —no existe categoría
  para ello— así que el sistema decide **a quién se le paga**, no mueve el dinero (ver **D7**).
- Cualquier cambio en el cierre de bodega (nivel 2), en la wallet o en las tarifas.

---

## Mediciones que faltan (se toman en **T0**, contra producción, por MCP, **solo lectura**)

Ninguna de estas se rellena con un supuesto. Las consultas están escritas en `design.md` §9; aquí va
qué decide cada número.

| # | Qué mide | Qué decide |
| --- | --- | --- |
| **M1** | Distribución **horaria** de `orden.asignado_at` en hora de Costa Rica, últimos 30 días. | Si el problema es **diario o excepcional**, y si hay masa entre las 23:00 y la 01:00 (que es lo único que justificaría la comprobación de fecha base de **D6**). |
| **M2** | Órdenes barridas por el corte (`orden_historial_estado`, `origen_tipo='corte_sin_gestionar'`) cuyo `asignado_at` cae en las **6 h anteriores** a esa corrida. | La **población real del defecto**: cuántas asignaciones se deshizo el cron la misma noche. |
| **M3** | Distribución horaria de las transiciones `por_recoger → en_reparto` (`origen_tipo='recoleccion'`). | Si de verdad se **carga la furgoneta de noche**. Es el número que sostiene o tumba **D5**. |
| **M4** | Cierres `vencido` creados por noche, y cuántos de esos mensajeros tenían ≥1 orden barrida asignada esa misma tarde/noche. | Cuántos **bloqueos de la 241** son atribuibles a este defecto. Es el número que dice cuánto vale la ficha. |
| **M5** | **Cuánto se movería el denominador**: por día, qué fracción de las asignadas tendría un día de reparto distinto del día de su `asignado_at`. Es un **PROXY** —la columna no existe todavía, así que se aproxima con «asignadas a partir de las 18:00 CR que no se desenlazaron ese mismo día»—, y va etiquetado como tal. | Si D7 mueve céntimos o mueve el podio. **Es el número que el humano pidió.** |
| **M6** | **Cuánto dinero mueve `premio_ranking` hoy**: los tres montos vigentes × cuántos días de los últimos 30 tuvieron podio congelado. | El **importe mensual** que esta decisión pone en juego. |
| **M7** | **¿Cambia el podio?** Recalcular el top-3 de los últimos 30 días con el denominador actual y con el proxy de M5, y contar en cuántos días el top-3 **difiere**. | Si el cambio es cosmético o si **reasigna premios**. Con M6 al lado, da el importe exacto que cambia de manos. |
| **M8** | **`EXPLAIN`** (solo lectura, sin `ANALYZE` que escriba nada) del `groupBy` del denominador actual y del propuesto. | Si el índice nuevo de `design.md` §2.1 hace falta de verdad, o si la consulta ya era un recorrido completo antes (R44). |

⏳ **Caducan.** Son fotos. Se re-miden **justo antes de desplegar**, no antes de mergear.

⚠️ **M5 y M7 son PROXIES, y hay que decirlo al pegarlos.** Miden qué habría pasado *si* bodega
hubiera marcado «mañana» todo lo asignado a partir de las 18:00. Eso es una **hipótesis sobre una
conducta humana que todavía no existe**, no una medición de la conducta real. Sirven para acotar el
orden de magnitud —¿céntimos o premios?—, no para prometer un número. Presentarlos como si fueran el
efecto real sería inventar.

---

## Decisiones abiertas

Las marcadas **[FIRMA]** cambian esquema o producto y **no se implementan sin respuesta humana**.

**D1 · Dónde vive el dato. [FIRMA]**
**Recomendación: una columna nueva `orden.fecha_reparto` (`DATE`, nullable, sin default, sin
índice).** Sí, `orden` es la tabla más caliente del sistema, y el repo declara ese coste
explícitamente (`20260819170000_gestion_orden_confirmacion_fisica/migration.sql`: «un índice que
nadie usa se paga en cada escritura de la tabla más caliente»). La columna se paga **una vez** y sin
índice; el precio es el ancho de fila, no un índice por escritura. **Alternativa sin columna que se
descarta:** una tabla lateral `orden_reparto_programado(orden_id PK, fecha)`, sólo con filas para lo
diferido (`design.md` §10-B). **Qué se rompe si se elige esa:** el corte pasa de dos consultas que
tienen que decir lo mismo a **tres**, y la fila lateral necesita un **limpiador** en cada
reasignación, cada liberación por plazo, cada deshacer-asignación y cada barrido — que es
exactamente la forma del defecto que la **235** pagó con una fuga permanente en `/novedades`: una
marca con N sitios de limpieza y ninguno que rompa el build cuando se olvida.

**D2 · Una fecha absoluta o una marca «para mañana». [FIRMA]**
**Recomendación: una fecha absoluta**, aunque la UI sólo ofrezca dos opciones. **Qué se rompe si se
elige la marca booleana:** una marca relativa **no caduca sola**. Al día siguiente sigue diciendo
«para mañana» y el corte la protegería otra vez, y otra: la orden **no se barre nunca**. Para
evitarlo habría que apagarla en el corte — otro limpiador, el mismo defecto de la 235. Una fecha
vence sola: `X` deja de ser futuro por el mero paso del tiempo, sin que nadie escriba nada (R13).
**Esto NO amplía el alcance del producto**: la elección sigue siendo hoy/mañana, y como el máximo
que se puede reservar es un día, la protección está **acotada por construcción a una noche** — que
es justo lo que una fecha genérica no garantizaría.

**D3 · Qué escribe la opción «HOY»: la fecha de hoy, o `NULL`.**
**Recomendación: la fecha de hoy, explícita.** Así `NULL` conserva **un solo** significado:
«asignación anterior a esta feature, o sin mensajero». El aviso de que «un `NULL` que significa dos
cosas es una trampa» se desactiva por la forma del predicado, no por suerte: el corte **no pregunta
«¿es de hoy?»**, pregunta **«¿está reservada para un día que aún no ha llegado?»**, y a eso `NULL`
responde una sola cosa: **no** (R20). **Qué se rompe si se elige `NULL` para «hoy»:** nada en el
corte —seguiría barriendo igual—, pero la columna deja de poder responder R35 para el 95 % de las
órdenes, y cada lector futuro tiene que re-derivar «`NULL` = hoy» por su cuenta.

**D4 · ¿Las dos superficies de asignación, o sólo la central? [FIRMA]**
**Recomendación: las dos** (`AsignarBodegaModal` y `AsignarSateliteModal`). Son el mismo gesto con
dos cableados paralelos ya existentes, y el coste incremental de la segunda es un campo en un schema
zod y un parámetro más en un `UPDATE` que ya existe. **Qué se rompe si se deja fuera el satélite:**
el defecto sigue vivo exactamente donde la asignación nocturna es más probable (bodegas de zona,
sin turno de noche del maestro), y la regla del sistema pasa a depender de **desde qué bodega te
asignaron**, que es imposible de explicar a un operador.

**D5 · ¿El mensajero puede recoger y gestionar hoy una orden reservada para mañana?**
**Recomendación: sí — visible, etiquetada y trabajable** (R22-R24). La reserva protege del **cron**,
no del mensajero. **Qué se rompe si se elige el candado:** se rompe el escenario que motiva la ficha
—bodega carga la furgoneta de noche y el mensajero no puede escanear lo que ya tiene en la mano— y
aparece un fallo nuevo: «tengo el paquete y la app no me deja». **Este es el punto donde M3 manda**:
si nadie recoge de noche, el candado es barato y se puede reconsiderar; si se recoge de noche,
el candado está descartado.

> **APÉNDICE — 2026-08-21: D5 fue SUPERSEDIDA por la feature 261.** El texto de arriba se conserva
> **intacto**, porque un spec es la foto de su momento y aquella decisión se tomó a conciencia y con
> sus razones; pero **ya no está vigente**, y con ella caen **R24** y la nota 3 de los límites
> declarados. Motivo, en una línea: D5 se apoyaba en la medición **M3** («nadie carga la furgoneta
> después de las 18:00») y **M3 quedó refutada por una prueba humana en producción** — la guía
> **17496963** se recogió y se gestionó `entregada` a las **22:10 CR del 21 de agosto de 2026**
> estando reservada para el **22**. Es decir: el propio D5 escribió cuál era su condición de
> caducidad («este es el punto donde M3 manda»), y esa condición se cumplió. Desde el 2026-08-21 la
> reserva protege del **cron y también del mensajero**: una orden reservada para un día posterior no
> se puede recoger, ni escoger para gestión, ni gestionar — ni por el mensajero ni por la tienda
> desde la pestaña de ayuda. Lo que **no** cambia es **R23**: la orden sigue visible y en su grupo
> de siempre; lo que se restringe es la acción, no la visibilidad. Ver
> `specs/261-dia-reparto-protege`.

**D6 · El formulario abierto a caballo de la medianoche.**
**Recomendación: aceptarlo y nombrarlo.** El servidor resuelve «hoy/mañana» **en el momento de
enviar**; si el modal se abrió a las 23:58 y se envía a las 00:01, «mañana» significará un día más
allá de lo que el operador leyó. **Qué se rompe:** una orden queda protegida **dos** noches en vez
de una — nunca se pierde una orden, sólo se retrasa un barrido. **Escape ya diseñado** (`design.md`
§4.4): que el cliente mande también la fecha base que estaba mostrando y el servidor rechace si
cambió. **Se implementa sólo si M1 muestra masa entre las 23:00 y la 01:00 CR.**

**D7 · El denominador del ranking. [FIRMA — toca premios] → FIRMADA EL 2026-08-20 *EN CONTRA* DE LA
RECOMENDACIÓN DE ESTE SPEC.**

**Lo que se firmó:** el denominador del ranking **se corrige aquí**. El ranking pasa a contar las
asignadas de un día por **día de reparto** en vez de por `asignado_at` (sección **H**, R36-R46).

**Cuál era la recomendación de este spec, y por qué** *(se deja escrita a propósito: dentro de seis
meses alguien se preguntará por qué esta ficha arrastró el ranking, y la respuesta tiene que estar
aquí — no como disculpa, sino como el registro de una decisión tomada con su coste delante)*:

> **No tocarlo en esta ficha; nombrar la distorsión y llevarla a una ficha propia.** Tres razones:
> (1) el ranking decide **quién ocupa el podio**, y el podio lleva el importe de `premio_ranking`:
> es dinero real a una persona, aunque el sistema no lo mueva; (2) arrastra tres módulos
> (`RankingRepository`, `RankingService`, `RankingSnapshotService`) y una tabla **congelada e
> inmutable** dentro de una ficha que se leía como «un selector y un cron»; (3) la distorsión que
> corrige **ya existe hoy** —asignar de noche ya infla el denominador del día que acaba— así que no
> es un defecto que esta ficha **cause**, sino uno que **vuelve frecuente**: se podía arreglar
> después sin deuda nueva.

**Qué asumió el humano al firmar en contra:** que un mensajero al que le asignan a las 22:00 aparezca
castigado en el ranking del día que acaba es un defecto **visible para él**, y dejar el selector sin
el arreglo del denominador entrega media feature. Se acepta el coste: **ficha más cara, `high` en vez
de `medium`, y una medición (M5/M6/M7) que hay que hacer antes de escribir la consulta.**

**Consecuencias que la firma trae, y que este spec ahora recoge:**
- **Un índice nuevo** en `orden`, la tabla más caliente (R44, `design.md` §2.1). El §2.1 original
  decía «sin índice»; con D7 firmada, **eso deja de ser cierto** y el coste se paga en cada escritura
  de `orden`. **M8** confirma si hace falta.
- **Un peligro el día del despliegue** (R43): si el denominador contase sólo `fecha_reparto = X`, las
  órdenes asignadas antes de que la columna existiera saldrían del denominador, **todos los
  porcentajes subirían de golpe** y el podio de ese día sería falso. Lo cierra R37 y su cláusula de
  respaldo; sin ella, el despliegue es un incidente de dinero.
- **Una asimetría nueva** (R40), acotada en el límite declarado 4.

**D10 · ¿El tablero del día sigue al ranking? [FIRMA] → FIRMADA EL 2026-08-20: NO LO SIGUE.**
`TableroDiaRepository` cuenta «asignadas hoy» con el **mismo** `asignado_at` y lo dice en su
cabecera: *«es el denominador del ranking diario del mensajero y moverla mueve su pago y su premio»*.
Si el ranking cambia de criterio y el tablero no, **dos pantallas del mismo maestro muestran dos
cifras distintas de "asignadas hoy" el mismo día**, y ninguna de las dos está mal.
**Recomendación de este spec era: sí, que lo siga**, y en esta misma ficha: el coste es la misma
cláusula en una consulta que ya existe, y el tablero es sólo lectura. **Qué se rompe si no:** el
maestro pierde la capacidad de cuadrar una pantalla contra la otra, que es justo para lo que abre
las dos.

**Lo que se firmó, y por qué en contra de esa recomendación:** el tablero **NO** sigue al ranking.
Tres razones, con las mediciones delante:

1. **El tablero y el ranking no miden lo mismo, y ahora se nota porque el ranking cambió.** El
   tablero responde «¿qué carga le eché hoy a este mensajero?» —una pregunta de **operación**, y
   para ésa `asignado_at` es el dato correcto: la orden entró en su montón hoy, la reserve para
   quien la reserve—. El ranking responde «¿de qué día es esta orden a efectos de su porcentaje?».
   Alinearlos no habría hecho que las dos pantallas dijeran la verdad: habría hecho que **el
   tablero dejara de responder su propia pregunta**.
2. **El tablero está a una decisión de distancia del dinero, y esta ficha ya arrastró bastante.**
   D7 se firmó en contra de la recomendación y con eso entraron el podio y `premio_ranking`.
   Meter además el CTE `ids_del_dia` —que alimenta la pantalla con la que el maestro cuadra el
   día— habría sido una tercera superficie en una ficha que se leía como «un selector y un cron».
3. **El coste de no hacerlo es una nota, y la nota ya está escrita.** Lo que la recomendación
   temía —«dos cifras distintas sin explicación se leen como un error de la app»— se cierra
   diciéndolo donde se ve: la cabecera de `TableroDiaRepository` explica ahora que desde el
   despliegue las dos cifras **pueden diferir el mismo día**, cuál mide qué, y que es deliberado.

**Consecuencia aceptada, escrita donde se ve y no en una nota al pie:** desde el despliegue, una
orden asignada hoy para mañana **cuenta HOY en el tablero y MAÑANA en el ranking**. Ninguna de las
dos está mal. Si algún día se quiere alinearlas, es una decisión nueva —y el `OR` ya está escrito
y probado en `RankingRepository` para copiarlo.

**D11 · ¿Se recalcula el ranking ya congelado? [FIRMA — es historia que ya se pagó]**
**Recomendación: NO, y no se da por hecho en ninguna parte del diseño.** `ranking_snapshot_dia` y
`ranking_snapshot_fila` son **inmutables por diseño**: la tabla no tiene `updated_at` —y el esquema
explica que «una columna que nunca se actualiza es una invitación a actualizarla»—, la unicidad de
`fecha` **es** la idempotencia del cron, y cada fila congela el nombre, el puesto, el umbral aplicado
y **el importe del premio**. Recalcular hacia atrás significa **reescribir filas que ya se leyeron
para pagar a alguien**. **Qué se rompe si se elige recalcular:** hay que decidir qué se hace con un
premio ya entregado a quien el recálculo saca del podio —el sistema no lo puede deshacer porque nunca
lo movió—, y hay que romper la inmutabilidad que sostiene la idempotencia del cron. Si aun así se
quiere, **es una ficha aparte con su propia puerta humana**, no una tarea de ésta.

**D8 · Cambiar el día de una orden ya asignada.**
**Recomendación: fuera de alcance.** Hoy, para cambiar el día habría que **deshacer la asignación**
(149) y volver a asignar. **Qué se rompe si no se añade:** bodega no puede corregir un clic
equivocado sin dos gestos. Es un hueco operativo real y barato de cerrar después; se nombra para que
sea decisión y no descubrimiento.

**D9 · ¿Se ve el día de reparto en el listado general de órdenes de la bodega?**
**Recomendación: no en esta ficha.** `app/(app)/ordenes/_components/ordenes-columns.tsx` arrastra el
contrato de descarga a Excel de la **170** y una guardia money-safe propia
(`tests/unit/guards/ordenes-columnas-money-safe.guardia.test.ts`); meter una columna ahí mete a esta
ficha en dos conversaciones que no son la suya. **Qué se rompe si no se añade:** bodega no puede
responder «¿qué dejé asignado para mañana?» sin abrir orden por orden. Es la **primera candidata a
seguimiento**.

---

## Preguntas abiertas para el humano (no son decisiones de diseño)

1. **¿Quién asigna de noche, de verdad?** M1 lo dirá en números, pero el dato operativo —¿es bodega
   central, satélite, o las dos?— cambia D4 de «recomendación» a «evidencia».
2. **¿Se carga la furgoneta la noche anterior?** Es el escenario que hace que el defecto sea
   frecuente, y el que decide D5. M3 lo aproxima; una respuesta humana lo cierra.
3. **¿El premio se paga de verdad, y cómo?** El sistema **no mueve ese dinero** (no hay categoría de
   wallet para premios: sólo un monto y un rótulo por posición). Saber si alguien lo paga fuera del
   sistema, y con qué frecuencia, es lo que convierte M6 en un importe real.

---

## PUERTA HUMANA PASADA — 2026-08-20

Tres decisiones firmadas. **Dos con la recomendación de este spec, una en contra.**

### Firmadas CON la recomendación

- **D1 + D2 — columna nueva `orden.fecha_reparto` con fecha ABSOLUTA**, no tabla lateral y no marca
  de «para mañana». El argumento aceptado es el del spec: **una fecha vence sola; una marca necesita
  quien la apague**, y el día que ese apagado falle la orden **no se barre nunca** — el defecto exacto
  que ya pagó la 235 con una fuga permanente en `/novedades`.
- **D4 — el selector va en las DOS superficies** (bodega central y bodega satélite). Dejar el
  satélite fuera haría que la regla dependiera de **desde qué bodega te asignaron**, y eso no se le
  puede explicar a quien opera.

### Firmada EN CONTRA de la recomendación

- **D7 — el denominador del ranking SE CORRIGE EN ESTA FICHA.** La recomendación del spec era **no
  tocarlo aquí** y llevarlo a una ficha propia, porque mueve `premio_ranking` —dinero real a una
  persona— y arrastra tres módulos y una tabla inmutable dentro de una ficha que se leía como «un
  selector y un cron». El texto íntegro de esa recomendación, con sus tres razones, está en **D7**:
  se conserva a propósito para que dentro de seis meses se pueda reconstruir **por qué** esta ficha
  arrastró el ranking.
  **Lo que la firma cambia en el spec:** sección **H** nueva (R36-R46), R33 reescrito, el índice de
  `design.md` §2.1 (donde antes decía «sin índice»), tres mediciones nuevas (**M5**, **M6**, **M7**)
  más un `EXPLAIN` (**M8**), una tanda nueva en `tasks.md`, y **dos decisiones que la firma abrió y que
  **YA ESTÁN FIRMADAS, las dos el mismo día**: **D10** (el tablero **NO** sigue al ranking) y
  **D11** (**no** se recalcula la historia congelada).

### Veredicto de complejidad

**`medium` → `high`.** El juicio, con sus razones, para que el leader lo estampe:

1. **Dos subsistemas cercanos al dinero en vez de uno.** Antes: el corte. Ahora: el corte **y** el
   ranking/podio/premio.
2. **Un índice en la tabla más caliente**, que hay que justificar con un `EXPLAIN` (M8) en vez de con
   una intuición.
3. **Un peligro de dinero concentrado en el día del despliegue** (R43): sin la cláusula de respaldo
   de R37, el podio de ese día es falso para todos a la vez.
4. **La superficie de archivos casi se duplica** y entra una tabla **inmutable** en la conversación.
5. **Tres mediciones nuevas, y dos son PROXIES** de una conducta humana que aún no existe: hay que
   presentarlas con esa etiqueta y decidir con ellas igualmente.

Sigue **sin** llegar a lo que este repo llama una ficha de dinero de primer orden —no emite ni un
movimiento de wallet, no toca totales de cierre ni tarifas—, pero `medium` ya no la describe.

### D10 — FIRMADA el 2026-08-20: **el tablero del día NO sigue al ranking**

**En contra de la recomendación de este spec**, y con su porqué en **D10**. El resumen: el tablero
responde una pregunta de **operación** («¿qué carga le eché hoy?») y para ésa `asignado_at` es el
dato correcto; alinearlo con el ranking le habría quitado su propia respuesta. Además, D7 ya metió
el podio y `premio_ranking` en una ficha que se leía como «un selector y un cron», y el CTE
`ids_del_dia` alimenta la pantalla con la que el maestro cuadra el día: era una tercera superficie.

**Lo que la firma obliga a hacer, y está hecho:** corregir la cabecera de `TableroDiaRepository`,
que afirmaba que `asignado_at` «es el denominador del ranking diario». **Con D7 eso dejó de ser
cierto**, se firme D10 como se firme. El comentario nuevo dice qué mide cada cifra, que **pueden
diferir el mismo día** desde el despliegue, y que es deliberado — porque dos cifras distintas sin
explicación se leen como un error de la app.

**T6.7 queda `N/A`**: no se toca el CTE.

> **APÉNDICE — 2026-08-21: D10 fue SUPERSEDIDA por la feature 259.** El texto de arriba se conserva
> **intacto**, porque un spec es la foto de su momento y aquella decisión se tomó a conciencia; pero
> **ya no está vigente**. Motivo, en una línea: D10 razonó sobre `asignadas` y no sobre el cubo
> `sinRecoger`, donde una orden reservada para mañana entraba etiquetada como «el mensajero todavía
> no arrancó con ellas» — un retraso que no existe. Desde el 2026-08-21 el tablero del día cuenta
> por **día de reparto**, alineado con `/ranking`. Ver `specs/259-tablero-dia-por-reparto/`.

### D11 — FIRMADA el 2026-08-20: **solo hacia adelante, no se recalcula nada**

Con la recomendación del spec. El cambio del denominador del ranking **rige desde el despliegue** y
**la historia no se toca**.

Y no es sólo preferencia: es lo que el código ya impone. `ranking_snapshot_dia` / `_fila` son
**inmutables por diseño** —sin `updated_at`, y la unicidad de `fecha` **es** la idempotencia del
cron—, así que recalcular sería **reescribir filas que ya se leyeron para decidir a quién se le
paga**. El cambio es prospectivo **por construcción**, no por decisión.

**Consecuencia aceptada:** habrá un antes y un después en la serie del ranking. Quien compare dos
periodos a caballo del despliegue está comparando dos criterios distintos. **Que quede escrito donde
se vea**, no en una nota al pie.

