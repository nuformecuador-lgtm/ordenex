# Feature 239 — La devolución espera al cierre: arreglar el cobro prematuro y anclar el reloj

> **Esto no es una feature nueva: es el arreglo de un fallo que cobra dinero, ya mergeado en `dev`.**
>
> En `dev` se recortó la VISIBILIDAD de las devueltas (`novedadWhere` exige `gestion_aprobada = true`)
> **sin** mover el RELOJ del SLA (el cron sigue anclando en `gestion.created_at` y no mira esa columna
> ni una vez). Con el retraso gestión→aprobación medido contra producción el 2026-08-18
> (**mediana 8,2 h · p90 22,1 h · máx 48,2 h**) y la ventana `not_found` de **24 h**, la orden se
> escala a `rechazada` y **se cobra** como ingreso de bodega por rechazo sin que la tienda haya
> podido verla nunca. **Antes del cambio la veía.** El saldo de la mitad implementada es peor que no
> haber hecho nada.
>
> **No se puede sacar `dev` a producción hasta que esto entre** (`prod` = 448d5169 no lo lleva).
>
> Fuentes (medidas, no re-derivadas aquí): `progress/auditoria_ayuda_tienda.md` §1/§2/§3 ·
> `progress/design_pila_ayuda_tienda.md` §F5 · `specs/215-reintento-en-cierre/design.md` §7bis ·
> `specs/99-devolucion-diferida-sla/design.md` §1.1/§3.5.

**Enfoque decidido por el humano (no se re-litiga):** *partir el estado*. La orden **no entra en
`devuelta` al gestionar**: entra en un **pre-estado**, y **la aprobación del cierre ES la transición**
a `devuelta`. La columna `gestion_aprobada` queda **reemplazada** por el estado. El nombre del
pre-estado es una decisión abierta (ver «Preguntas abiertas»); en estos requisitos se le llama
siempre «el pre-estado».

---

## Vocabulario

| Término | Qué significa aquí |
| --- | --- |
| **pre-estado** | Estado de orden que significa «el mensajero gestionó la devolución; la bodega todavía no lo confirmó al aprobar el cierre». |
| **anclaje** | La transición pre-estado → `devuelta`, que ocurre al aprobar el cierre. Es el instante en que arranca la ventana de SLA y en que la devolución se vuelve visible para la tienda. |
| **ventana de SLA** | El plazo de la feature 99: 24 h para `not_found`, 5 días para `wrong_number` / `wrong_address`. Vencida, la orden se libera a bodega o **se escala a `rechazada` y se cobra**. |
| **gestión `devuelta` vigente** | Fila de `gestion_orden` con `resultado = devuelta` y `anulada_at IS NULL`. |
| **novedad** | Lo que la tienda ve y puede accionar en `/novedades`. |

---

## A · El pre-estado y la transición

**R1.** El sistema DEBE disponer de un estado de orden, distinto de `devuelta`, que represente
«devolución gestionada por el mensajero y pendiente de confirmación en el cierre».

**R2.** CUANDO un mensajero registra una gestión con resultado `devuelta`, el sistema DEBE dejar la
orden en el pre-estado y NO en `devuelta`.

**R3.** El sistema DEBE derivar el estado destino de una gestión desde un mapa explícito
`resultado → estado`, y NO desde la coincidencia de nombre entre el vocabulario de resultados y el
de estados.

**R4.** CUANDO un administrador APRUEBA un cierre, el sistema DEBE transicionar a `devuelta`, dentro
de la misma transacción que aprueba el cierre, exactamente las órdenes que cumplan las tres
condiciones a la vez: (a) están en el pre-estado, (b) tienen una gestión `devuelta` vigente
perteneciente a ese cierre, y (c) esa gestión es la gestión `devuelta` vigente **más reciente** de esa
orden.

**R5.** SI la gestión `devuelta` de ese cierre NO es la gestión `devuelta` vigente más reciente de su
orden, ENTONCES el sistema NO DEBE anclar esa orden al aprobar ese cierre, y NO DEBE dejar rastro de
anclaje para ella.

**R6.** SI un cierre se RECHAZA, ENTONCES el sistema NO DEBE transicionar ninguna orden desde el
pre-estado ni registrar ningún anclaje.

**R7.** CUANDO ocurre el anclaje, el sistema DEBE registrarlo en el historial de estados por el mismo
punto único de escritura que el resto de transiciones, con el administrador que aprobó como actor y
con una familia de origen propia, distinta de las ya existentes.

**R8.** CUANDO la aprobación de un mismo cierre se ejecuta más de una vez, el sistema NO DEBE
producir un segundo anclaje ni una segunda fila de historial para la misma orden.

**R9.** SI al aprobar un cierre el sistema no puede resolver el identificador de catálogo del
pre-estado o el de `devuelta`, ENTONCES DEBE rechazar la aprobación completa sin efectos parciales
(ni transición del cierre, ni movimientos de dinero, ni anclaje).

**R10.** CUANDO ocurre el anclaje, el sistema NO DEBE alterar ningún monto, ni emitir, modificar o
suprimir ningún movimiento de dinero.

**R11.** El sistema NO DEBE convertir ningún monto a número de coma flotante en ninguna de las rutas
que esta feature toca.

---

## B · El reloj

**R12.** El sistema DEBE anclar el inicio de la ventana de SLA de una devolución en el instante en
que la orden entró en `devuelta`.

**R13.** MIENTRAS una orden esté en el pre-estado, el sistema NO DEBE considerarla candidata del cron
de SLA: ni para liberarla a bodega, ni para escalarla a `rechazada`, ni para cobrarla.

**R14.** SI una orden está en `devuelta` y no existe en su historial ninguna transición de anclaje
(caso de las órdenes anteriores a esta feature), ENTONCES el sistema DEBE anclar su ventana en la
fecha de su gestión `devuelta` vigente más reciente.

**R15.** CUANDO una orden vuelve a `devuelta` tras un ciclo completo (liberación a bodega →
reasignación → nueva devolución → aprobación del nuevo cierre), el sistema DEBE usar el anclaje más
reciente y NO uno anterior.

**R16.** El sistema DEBE mantener el criterio de conteo de intentos de entrega y el criterio de
anclaje de la devolución como **dos derivaciones separadas**; ninguna DEBE calcularse a partir de la
otra ni compartir su punto único de definición, aunque ambas observen «cierre aprobado».

**R17.** CUANDO un mensajero gestiona una orden como `devuelta`, el sistema DEBE seguir contando ese
intento de entrega con el criterio vigente (cierre aprobado + resultado contable + visita real), sin
cambio de número respecto del comportamiento anterior a esta feature.

---

## C · Lo que la tienda ve

**R18.** MIENTRAS una orden esté en `devuelta`, el sistema DEBE listarla como novedad de su tienda.

**R19.** MIENTRAS una orden esté en el pre-estado, el sistema NO DEBE listarla como novedad, NI
permitir que la tienda la reprograme, NI que la rechace, NI que escriba en su hilo de notas.

**R20.** El sistema NO DEBE condicionar la visibilidad de una devolución a ninguna marca persistida
distinta del estado de la orden.

**R21.** CUANDO el sistema cuente las novedades de una tienda y CUANDO devuelva una página de ellas,
DEBE usar exactamente el mismo predicado, de modo que el total y la página describan el mismo
universo.

**R22.** MIENTRAS una orden no esté en un estado sobre el que la tienda pueda actuar, el sistema NO
DEBE listarla como novedad por efecto de una solicitud de ayuda anterior.

**R23.** SI una orden deja de listarse como novedad sin que su devolución se haya resuelto, ENTONCES
el sistema NO DEBE dejar corriendo sobre ella una ventana de SLA capaz de escalarla a `rechazada` y
cobrarla.

---

## D · El resto de superficies

**R24.** MIENTRAS una orden esté en el pre-estado, el sistema DEBE permitir al mensajero deshacer su
propia gestión del día dentro de la ventana de deshacer ya existente.

**R25.** MIENTRAS una orden esté en el pre-estado, el sistema NO DEBE ofrecerla para asignación,
ruteo, recolección ni como parada de ruta.

**R26.** El sistema DEBE clasificar el pre-estado de forma explícita en TODAS las superficies que
enumeran estados de orden: etiqueta y color visibles, hito del rastreo público, filtros por rol,
política de eventos públicos, listado de la bodega satélite y clasificación del tablero del día.

**R27.** CUANDO una orden entra en `devuelta`, el sistema DEBE emitir el evento público `devuelta` en
ese instante, y NO antes.

**R28.** MIENTRAS una orden esté en el pre-estado, el sistema DEBE mostrar al destinatario en el
rastreo público el mismo hito que muestra hoy para una orden `devuelta`.

**R29.** El sistema DEBE declarar como legales exactamente las transiciones del pre-estado que tengan
productor en el código, y NO DEBE conservar declarada la transición `en_reparto → devuelta` una vez
que deje de tener productor.

---

## E · Datos en vuelo y migración

**R30.** CUANDO esta feature se despliegue, las órdenes que ya estén en `devuelta` DEBEN seguir
siendo visibles para su tienda y conservar la ventana de SLA que ya tuvieran en curso.

**R31.** El sistema NO DEBE mover ninguna orden entre estados desde SQL de migración: toda transición
DEBE pasar por el punto único de escritura de estado.

**R32.** Toda migración de esta feature DEBE tener su reversión, y esa reversión DEBE dejar la base en
un estado que el código anterior pueda leer.

---

## F · Que el fallo no se pueda repetir

**R33.** Toda escritura ejecutada dentro de la transacción de aprobación de un cierre DEBE estar
cubierta por al menos una aserción que la nombre; ninguna aserción DEBE excluir escrituras por la
forma de su cláusula de filtro.

**R34.** El sistema DEBE permitir enumerar, con una consulta de solo lectura y sin lógica de negocio
nueva, las órdenes detenidas en el pre-estado y su antigüedad.

**R35.** Ningún registro producido por esta feature DEBE contener datos personales, números de guía,
identificadores de cliente ni secretos.

---

## Supuesto operativo declarado (heredado, ahora con más peso)

El anclaje depende de que **alguien apruebe el cierre**. Es el mismo supuesto que la feature 215
aceptó explícitamente (`specs/215/design.md` §7bis, decisión D14 del 2026-08-13, medida el
2026-08-14: 12 cierres, 12 aprobados, cero abiertos): *«el cierre se cerrará en algún momento por un
usuario»*.

Lo que cambia con esta feature es la **dirección del daño** cuando el supuesto no se cumple:

- **Antes de la 215:** el cierre sin aprobar dejaba la orden girando y **no se cobraba nunca**.
- **Con la mitad mergeada hoy en `dev`:** el cierre sin aprobar deja la orden invisible **y se cobra
  igual** a las 24 h. Es el fallo.
- **Con esta feature:** el cierre sin aprobar deja la orden **congelada en el pre-estado**: no se ve,
  no corre reloj y **no se cobra**. El daño pasa a ser mercadería parada, no dinero mal cobrado — y
  la población parada es **contable** (R34), que hoy no lo es.

Esa congelación es un riesgo real y está aceptado a cambio de no cobrar de más. La alerta operativa
que lo vigila (M3 del §7bis de la 215) queda **fuera del alcance de esta ficha** y se registra como
seguimiento; R34 es el mínimo que esta feature sí entrega.

---

## Fuera de alcance

- El estado `ayuda_tienda` y su pestaña propia (fichas 235/236) y la gestión de la tienda desde ayuda
  (ficha 237).
- La confirmación física por escaneo al aprobar el cierre (ficha 238), de la que esta depende.
- El rechazo manual de la tienda y la retirada de «Habilitar» de las cards de cierre (ficha 240).
- La alerta de población atascada (M3 de la 215 §7bis).
- Las guardas de bloqueo retiradas sin pedirlo en `6a0e6d36` (ficha 241).

---

## Preguntas abiertas

Las siete primeras son las que `progress/design_pila_ayuda_tienda.md` §F5 dejó explícitamente para el
spec. Cada una lleva **recomendación** y su razón; las marcadas **[FIRMA]** cambian producto o
contrato y **no se implementan sin respuesta humana**.

**P1 · Nombre y etiqueta del pre-estado. [FIRMA]**
Recomendación: `value = devolucion_por_confirmar`, etiqueta «Devolución por confirmar», variante de
badge `warning` (la misma que `devuelta`). Razón: el nombre dice *quién falta* (la bodega confirma),
no *qué pasó*; y no colisiona con `por_devolver` / `por_devolver_a_tienda`, que son otro flujo.
Alternativas descartadas por ambiguas: `devuelta_pendiente` (se lee como «la devolución está
pendiente», que es lo contrario), `pre_devuelta` (jerga interna en una etiqueta visible).

**P2 · ¿El pre-estado es evento público de webhook? [FIRMA — cambio de contrato con integradores]**
Recomendación: **no**. El vocabulario público no gana un valor nuevo; lo que cambia es *cuándo* llega
`devuelta` (R27): al aprobar, no al gestionar, con el retraso medido (mediana 8,2 h, p90 22,1 h).
Razón: añadir un value nuevo obliga a cada integrador a manejar un estado que no sabe interpretar;
retrasar uno que ya maneja no rompe su código. **Aun así es un cambio de contrato observable y hay
que avisar a los integradores antes de desplegar.** Si el humano prefiere lo contrario, la
alternativa es emitir el pre-estado como evento y dejar `devuelta` donde está.

**P3 · ¿Qué ve la tienda durante el limbo? [FIRMA]**
Recomendación: **nada**, en esta ficha. Razón: es exactamente la semántica que se pidió («la tienda no
gestiona un paquete que sigue en la moto»), es la superficie mínima, y las otras dos opciones (fila
deshabilitada / pestaña propia) tocan `/novedades`, que es justo lo que las fichas 236 y 240 están
reescribiendo — hacerlo aquí garantiza conflicto de archivos. Contrapartida declarada: durante la
mediana de 8,2 h la tienda no sabe que esa orden existe como devolución. Se cubre con R34 y con la
alerta M3 (ficha aparte).

**P4 · ¿El adminSatélite conserva la recuperación a bodega sobre devoluciones no ancladas? [FIRMA]**
Recomendación: **sí**, y con ello el pre-estado entra en el listado «Órdenes de la bodega» del
satélite. Razón: el paquete está **físicamente en su bodega**; si el estado se lo esconde, el
adminSatélite pierde la única palanca que tiene sobre mercadería que sí tiene delante, y el
inventario de su pantalla deja de cuadrar con el estante. Coste: dos aristas más
(`pre-estado → en_bodega_central` y `pre-estado → en_bodega_satelite`, familia `recuperacion_manual`)
y ampliar la guarda de estado de ese servicio, que hoy exige `= devuelta`. Si la respuesta es «no»,
esas dos aristas no se declaran y el listado del satélite no cambia.

**P5 · Granularidad de la ventana.**
Recomendación: **sin cambio** — rolling en milisegundos desde el anclaje, como hoy. Razón: cambiar a
«desde el inicio del día de Costa Rica» es una decisión de producto independiente de este arreglo, y
mezclarla haría imposible atribuir un cambio de comportamiento del cron a una causa u otra. Se deja
anotado que, con el anclaje en la aprobación, el vencimiento se corre en la práctica lo que tarde la
aprobación.

**P6 · Las órdenes en vuelo el día del despliegue.**
Recomendación: ***grandfather***, y **no hace falta backfill**. Razón: al desaparecer la marca
persistida, el predicado de novedad vuelve a ser una igualdad de estado, así que **toda devuelta
histórica vuelve a verse sola** — la migración que retira la columna *es* el arreglo del recorte
retroactivo. Su reloj sigue anclado en la gestión por la rama legada (R14), que es exactamente el
comportamiento que ya tenían. Moverlas hacia atrás exigiría escribir estado desde SQL, que R31
prohíbe. **Hay que re-medir contra producción antes de desplegar**: el T0 del 2026-08-18 dio 0
órdenes en `devuelta`, y esa foto caduca.

**P7 · ¿Un cierre rechazado y luego re-aprobado re-ancla?**
**Cerrada por construcción, sin decisión que tomar:** un rechazo no mueve la orden (R6), así que
sigue en el pre-estado; cuando ese cierre se re-solicita (por el mensajero o por la válvula de
escape) y se aprueba, esa aprobación **es** el anclaje, con su fecha. No hace falta ninguna regla
adicional, y en particular **no se usa `cierre_dia.resuelto_at`**, que también se escribe al
rechazar.

**P8 · Nombre de la familia de origen del anclaje.**
Recomendación: `anclaje_devolucion`. No requiere firma salvo que se prefiera otro; es vocabulario
interno del historial. Lo que sí es requisito: **no** entra en la lista de familias de visita real
(rompería el conteo de intentos hacia arriba, que es la dirección que cobra de más).

**P9 · ¿Qué hace «Habilitar» sobre una devolución ya anclada?**
Hoy esconde la fila **sin** detener el reloj, y a los 5 días la orden se escala y se cobra
(auditoría §2.2). R23 exige que eso deje de ser posible; **cómo** se cumple es de la ficha 240, que
retira ese botón de las cards que vienen de un cierre. Si la 240 no entra antes o a la vez que esta,
hace falta decidir aquí si «Habilitar» se retira o si además mueve la orden. **Pendiente de
confirmar el orden de mergeo entre 239 y 240.**

**P10 · Solapamiento con las fichas 235/236 sobre la bandera de ayuda.**
R22 (la fuga permanente) está en el alcance de esta ficha según su `status_note`, pero la bandera
booleana `ayuda` desaparece si las fichas 235/236 aterrizan antes. **Pendiente de confirmar el orden
de mergeo**: si 235/236 entran primero, R22 se satisface por construcción y su test se re-apunta al
estado nuevo; si no, hay que acotar aquí la rama de ayuda del predicado de novedades.

---

## PUERTA HUMANA PASADA — 2026-08-19

Las cuatro decisiones marcadas `[FIRMA]` quedan cerradas. **Tres van con la recomendación del
spec; la cuarta va en contra, y se deja dicho el precio.**

**P1 — El pre-estado se llama `devolucion_por_confirmar`**, etiqueta «Devolución por confirmar».
Con la recomendación: nombra lo que falta (la confirmación física en bodega) sin prometer un
desenlace.

**P2 — NO se emite por webhook.** Con la recomendación. Lo que cambia para los integradores es
*cuándo* llega `devuelta`: hoy al gestionar el mensajero, después al aprobar bodega. **Es un
cambio observable de contrato y hay que avisarles ANTES de desplegar** — eso entra como tarea de
la tanda de cierre, no como un correo que alguien recuerde mandar.

**P3 — Durante el limbo la tienda no ve nada.** Con la recomendación. Las otras dos opciones
añadían superficie justo donde van a trabajar las fichas 236 y 240.

**P4 — El adminSatélite NO puede recuperar a bodega una devolución no anclada. VA CONTRA LA
RECOMENDACIÓN DEL SPEC, y por eso el precio se escribe aquí en vez de descubrirse después:**

> El pre-estado **no tiene arista de `recuperacion_manual`**. Un satélite que tenga el paquete
> físicamente en su estante **no puede registrarlo** hasta que el cierre del mensajero se apruebe.
> Si el cierre tarda —el retraso medido tiene p90 de 22,1 h y máximo de 48,2 h— el paquete existe
> en la bodega y no en el sistema durante ese tiempo.
>
> La salida sigue siendo aprobar el cierre, que es exactamente lo que la feature quiere forzar.
> Queda **firmado a sabiendas**: se prefiere que nada se mueva antes de la confirmación física,
> aunque cueste esa ventana.
>
> **Si esto duele en operación, la vía es reabrir P4, no añadir una puerta trasera.**

### Las dos de orden de mergeo, decididas por el leader

**P9 y P10** no son de diseño sino de secuencia, y se resuelven así: **la 239 va PRIMERA de la
pila**, porque es la que detiene un cobro prematuro que hoy está en `dev`. Las fichas 235, 236 y
240 se especifican **asumiendo la 239 ya dentro**; en particular, la fuga de la bandera `ayuda` y
el comportamiento de «Habilitar» se resuelven en ellas, no aquí.

---

## RECONCILIACIÓN DE R19 TRAS LA REVISIÓN — 2026-08-19

La revisión midió que **R19 no se cumple del todo**, y el texto del requisito se corrige aquí en vez
de dejarlo prometiendo algo que el código no hace — una afirmación que miente es peor que una
ausente.

**Lo medido:** `estaEnVentanaDeEscritura("adminTienda", "devolucion_por_confirmar", true)` devuelve
`true`. Una bandera `ayuda` encendida de antes **abre la ventana de escritura del hilo** sobre una
orden que está en el pre-estado.

**Por qué no es bloqueante, con las tres propiedades comprobadas:**

- **Visibilidad-neutral**: la orden no se lista en `/novedades` — la rama de ayuda exige además
  `en_reparto`, y el pre-estado no es `devuelta`.
- **Reloj-neutral**: el cron no ve el pre-estado, así que el plazo sigue parado.
- **Money-neutral**: reprogramar y rechazar siguen guardados por `= devuelta`.

Escribir en el hilo **no hace visible nada** y es, de hecho, el camino por el que se apaga la
bandera sobre una orden que ya cayó del listado.

**Dueño y fecha de muerte:** la ficha **235** retira el booleano `ayuda` y con él esta puerta. R19
se lee, hasta entonces, como «la ventana de escritura no depende del pre-estado **salvo por la
bandera legada de ayuda**, que la 235 elimina».
