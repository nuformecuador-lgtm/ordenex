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

**R33.** El sistema DEBE seguir contando el denominador del ranking y del tablero del día por
`asignado_at`, sin cambio alguno en esta ficha (ver **D7**: la distorsión que eso implica queda
**nombrada**, no arreglada aquí).

**R34.** La asignación de **recolección en tienda** queda fuera: no ofrece la elección y no se ve
afectada. Su aislamiento respecto del corte (167/R34) DEBE seguir intacto.

---

## G · Trazabilidad

**R35.** El sistema DEBE poder responder, para una orden con mensajero asignado, para qué día quedó
su asignación vigente.

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

---

## Fuera de alcance

- Una **fecha futura arbitraria** (planificación de ruta a varios días).
- **Cambiar el día** de una orden ya asignada sin deshacer la asignación (ver **D8**).
- Mostrar el día de reparto en el **listado general de órdenes** o exportarlo a Excel (ver **D9**).
- Cambiar el **denominador del ranking** (ver **D7**).
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

⏳ **Caducan.** Son fotos. Se re-miden **justo antes de desplegar**, no antes de mergear.

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

**D6 · El formulario abierto a caballo de la medianoche.**
**Recomendación: aceptarlo y nombrarlo.** El servidor resuelve «hoy/mañana» **en el momento de
enviar**; si el modal se abrió a las 23:58 y se envía a las 00:01, «mañana» significará un día más
allá de lo que el operador leyó. **Qué se rompe:** una orden queda protegida **dos** noches en vez
de una — nunca se pierde una orden, sólo se retrasa un barrido. **Escape ya diseñado** (`design.md`
§4.4): que el cliente mande también la fecha base que estaba mostrando y el servidor rechace si
cambió. **Se implementa sólo si M1 muestra masa entre las 23:00 y la 01:00 CR.**

**D7 · El denominador del ranking sigue siendo `asignado_at`. [FIRMA — toca premios]**
**Recomendación: no tocarlo en esta ficha, pero dejarlo escrito.** El ranking diario y el tablero del
día cuentan «asignadas hoy» por `orden.asignado_at` dentro de la ventana del día de Costa Rica
(`RankingService`, `TableroDiaRepository`). Una orden asignada esta noche **para mañana** cuenta en
el denominador de **hoy** y se entrega **mañana**: baja el porcentaje del mensajero sin poder
subirlo. **Esto ya pasa hoy** cada vez que se asigna de noche; lo que hace esta ficha es volverlo
**deliberado y frecuente**. **Qué se rompe si se arregla aquí:** se cambia quién gana
`premio_ranking` dentro de una ficha que nadie leyó como si fuera de premios, y sin la medición que
esa decisión merece. Va como ficha aparte, con su propio número.

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
