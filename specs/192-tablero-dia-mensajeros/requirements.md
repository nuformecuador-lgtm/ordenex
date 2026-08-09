# Feature 192 — Tablero del día: órdenes por mensajero y el resultado de su gestión

**Requisitos en notación EARS.** Sin detalles de implementación (esos van en `design.md`).
Cada `R<n>` debe terminar mapeado a un test concreto (`docs/specs.md > Trazabilidad`);
el mapa vive en `design.md §8` y lo verifica el reviewer.

## Glosario (vocabulario cerrado, para que los requisitos no se interpreten)

- **Día CR**: la fecha calendario de Costa Rica (UTC−6, sin horario de verano) del
  instante de la consulta. Su ventana es el intervalo semiabierto
  `[00:00 CR, 00:00 CR del día siguiente)`.
- **Orden asignada hoy** *(dos caminos, decisión humana del 2026-08-08 — opción C)*:
  orden con mensajero asignado que cumple **al menos uno**:
  - **camino de reparto**: su instante de (re)asignación cae dentro de la ventana del
    día CR;
  - **camino de recolección**: existe una transición de asignación de recolección
    registrada en el historial de la orden dentro de la ventana del día CR.

  Una orden alcanzable por los dos caminos sigue siendo **una** orden.
- **Gestión vigente**: gestión de una orden que no está anulada.
- **Resultado del día de una orden**: el resultado de su **última** gestión vigente
  dentro de la ventana del día CR. Es uno de los cinco valores del enum
  `gestion_resultado`: `entregada`, `reprogramada`, `devuelta`, `rechazada`, `incidente`.
- **Sin resultado**: orden asignada hoy que **no** tiene ninguna gestión vigente dentro
  de la ventana del día CR. Se **desglosa** en tres buckets por el estatus actual de la
  orden (`orden.estatus_id`, catálogo `order_status`):
  - **sin recoger**: el mensajero todavía no arrancó con ella (no tiene el paquete).
  - **en reparto**: la recogió y está en la calle, sin gestionarla todavía.
  - **otros**: cualquier otro estatus sin gestión vigente en el día (no se absorbe en
    los dos anteriores).
- **Mensajero de la tarjeta**: el mensajero **asignado** de la orden, no el usuario que
  registró la gestión.
- **Alcance**: el recorte de filas que le corresponde al actor según su rol.
- **Detalle**: la lista de órdenes del día de un mensajero que se abre al pulsar su
  tarjeta.

---

## A. Acceso, roles y frontera multi-tenant

> Esta sección es una **frontera de seguridad**: sin policies RLS debajo (la conexión
> usa credenciales de servicio), es la única separación entre inquilinos. Un fallo aquí
> no da una cifra equivocada: enseña las órdenes de una zona ajena.

**R1** — El sistema DEBE conceder el tablero del día únicamente a los roles `admin`,
`maestro` y `adminSatelite`.

**R2** — SI la petición no trae una sesión válida, ENTONCES el sistema DEBE responder
denegado, sin filas y sin conteos.

**R3** — SI el rol del actor es `adminTienda`, `mensajero`, `apiKey` o cualquier valor
no reconocido, ENTONCES el sistema DEBE responder denegado, sin filas y sin conteos,
y sin degradar la respuesta a una versión recortada del tablero.

**R4** — MIENTRAS el actor tiene rol `admin` o `maestro`, el sistema DEBE incluir las
órdenes de **todas** las zonas.

**R5** — MIENTRAS el actor tiene rol `adminSatelite` con zona asignada, el sistema DEBE
incluir **exclusivamente** las órdenes cuya zona de la orden es la zona del actor.

**R6** — El sistema DEBE aplicar el recorte por zona sobre la **zona de la orden**, y
NUNCA sobre la zona del usuario mensajero que la tiene asignada o que la gestionó.

**R7** — SI el actor tiene rol `adminSatelite` y no tiene zona asignada, ENTONCES el
sistema DEBE responder denegado; NO DEBE degradarlo a alcance global, ni a "todas las
zonas", ni a un tablero concedido con cero filas.

**R8** — El sistema DEBE derivar el alcance del actor del resolutor de alcance por rol
ya existente en el repositorio, y NO DEBE declarar una segunda tabla de roles ni
reimplementar la resolución.

**R9** — SI el alcance resuelto para el actor no es "global" ni "zona", ENTONCES el
sistema DEBE responder denegado (falla cerrada), en lugar de intentar traducirlo a un
filtro propio.

**R10** — El sistema DEBE aplicar el recorte de filas **antes** de leer los datos (en el
predicado de la consulta), y NO DEBE obtener filas fuera de alcance para descartarlas
después.

**R11** — CUANDO el actor no supera el control de acceso a la pantalla, el sistema DEBE
impedir el acceso a la ruta en el servidor, y NO DEBE apoyarse en la visibilidad del
ítem de menú como única defensa.

### Apéndice A (2026-08-08) — la misma frontera para el detalle

> El detalle es una **segunda puerta a las mismas filas**. No hereda la frontera por
> implicación: la vuelve a atravesar, y por eso tiene requisitos propios.

**R40** — El sistema DEBE resolver el alcance del actor **también** en la consulta del
detalle, con el mismo resolutor y las mismas reglas de R1–R10, y NO DEBE fiarse de que
la tarjeta pulsada ya venía recortada.

**R41** — MIENTRAS el actor tiene rol `adminSatelite`, SI el detalle se pide para un
mensajero con órdenes de otra zona, ENTONCES el sistema DEBE devolver únicamente las
órdenes cuya zona de la orden es la del actor, y NO DEBE devolver las demás ni revelar su
existencia (ni por conteo, ni por paginación, ni por mensaje de error).

**R42** *(ampliado el 2026-08-08)* — El sistema DEBE tratar el identificador de mensajero
recibido para el detalle como entrada externa: validarlo en el borde y, SI el
identificador **no existe**, o existe pero **queda fuera del alcance** del actor, o no
tiene órdenes asignadas hoy, ENTONCES el sistema DEBE responder **de la misma forma** en
los tres casos (detalle vacío), sin distinguirlos por mensaje, por código ni por tiempo de
respuesta: no se puede filtrar la existencia de un mensajero de otra zona.

---

## B. Ventana del día

**R12** — El sistema DEBE delimitar el día como el intervalo semiabierto
`[00:00 hora de Costa Rica, 00:00 hora de Costa Rica del día siguiente)`, expresado en
UTC como `[fecha T06:00:00Z, fecha+1 T06:00:00Z)`.

**R13** — CUANDO la consulta se realiza a las 19:00 hora de Costa Rica, el sistema DEBE
incluir las órdenes asignadas a las 07:00 hora de Costa Rica de ese mismo día
(es decir, NO DEBE producir la ventana desplazada 18:00–18:00).

**R14** — SI una orden se asignó a las 23:00 hora de Costa Rica del día anterior,
ENTONCES el sistema NO DEBE contarla en el tablero de hoy.

**R15** — SI una orden se asignó a las 00:30 hora de Costa Rica de hoy, ENTONCES el
sistema DEBE contarla en el tablero de hoy.

**R16** — El sistema DEBE recibir el instante de referencia ("ahora") como entrada del
cálculo de la ventana, de modo que un test pueda fijar el reloj sin depender del reloj
del proceso.

**R17** — El sistema NO DEBE usar la función de "inicio de día" que devuelve medianoche
UTC (`startOfDayCR`) en ninguno de los módulos de esta feature.

---

## C. Conteo: resultado FINAL de la orden en el día, no gestiones

> Decisión humana cerrada (rama B, 2026-08-08). Importa porque una orden reintentada
> acumula varias gestiones; contarlas haría que los números sumaran más que las
> asignadas.

**R18** — El sistema DEBE contar como `asignadas` de un mensajero las órdenes asignadas
hoy cuyo mensajero asignado es ese mensajero.

**R19** — El sistema DEBE determinar el resultado del día de una orden como el resultado
de su **última** gestión vigente dentro de la ventana del día.

**R20** — SI una orden acumula varias gestiones vigentes dentro del día, ENTONCES esa
orden DEBE aportar exactamente **1** a los contadores de resultado (el de la última), y
no uno por gestión.

**R21** *(reescrito tras la puerta del 2026-08-08 — §A de la respuesta humana)* — SI una
orden asignada hoy no tiene ninguna gestión vigente dentro de la ventana del día,
ENTONCES el sistema DEBE clasificarla, según el estatus actual de la orden, en
**exactamente uno** de los tres buckets `sinRecoger`, `enReparto` u `otros`, y NO DEBE
presentarla en un único cubo indiferenciado de "pendientes".

**R22** — El sistema NO DEBE considerar las gestiones anuladas; SI todas las gestiones
del día de una orden están anuladas, ENTONCES esa orden DEBE volver a clasificarse por
su estatus según R21 (confirmado por el humano el 2026-08-08).

**R23** — El sistema NO DEBE considerar las gestiones registradas fuera de la ventana del
día, aunque pertenezcan a una orden asignada hoy.

**R24** — El sistema DEBE exponer un contador por cada uno de los cinco valores del enum
`gestion_resultado`: `entregadas`, `reprogramadas`, `devueltas`, `rechazadas`,
`incidentes`.

**R25** *(reescrito tras la puerta del 2026-08-08)* — El sistema DEBE cumplir, en cada
tarjeta y en los totales, la identidad exacta:

```
asignadas = entregadas + reprogramadas + devueltas + rechazadas + incidentes
          + sinRecoger + enReparto + otros
```

Los ocho sumandos DEBEN ser conjuntos disjuntos y su unión DEBE ser el total de órdenes
asignadas hoy: ninguna orden puede caer en dos buckets ni quedarse fuera de todos.

**R26** — El sistema DEBE atribuir el resultado del día al **mensajero asignado** de la
orden, aunque la gestión la haya registrado otro usuario.

**R27** — SI el enum `gestion_resultado` gana un sexto valor, ENTONCES el sistema DEBE
fallar de forma visible (fallo de compilación o test rojo) en lugar de absorber ese valor
en un bucket de "sin resultado" en silencio.

### Apéndice C (2026-08-08) — el segundo eje: `orden.estatus_id`

> El desglose de R21 introduce un **segundo catálogo** (`order_status`, 19 values
> sembrados) que ya se ha movido siete veces: renames, apéndices y un retiro. Se trata con
> el mismo cuidado que `gestion_resultado`.

**R43** *(CONFIRMADO por el humano el 2026-08-08)* — El sistema DEBE clasificar una orden
sin gestión vigente en el día así:

| Bucket | Estatus de la orden |
| --- | --- |
| `sinRecoger` | `por_recoger`, `recolectando` |
| `enReparto` | `en_reparto` |
| `otros` | cualquier otro value del catálogo |

**R44** — El sistema DEBE clasificar en `otros` (y NO en `sinRecoger`) una orden asignada
hoy cuyo estatus sea `por_recolectar_en_tienda`, porque en ese estatus **nadie va
todavía**: la asignación es una transición que saca la orden de ahí.

**R45** — El sistema NO DEBE absorber en `sinRecoger` ni en `enReparto` ningún estatus
distinto de los enumerados en R43: todo lo no enumerado cae en `otros`, de forma
explícita y visible en la interfaz.

**R46** — SI el catálogo `order_status` gana, pierde o renombra un value, ENTONCES el
sistema DEBE fallar de forma visible (fallo de compilación o test rojo) en lugar de
reclasificar órdenes en silencio.

### Apéndice C-bis (2026-08-08, tercera vuelta) — el segundo camino de "asignada hoy"

> Decisión humana: **opción C**. Las recolecciones en tienda entran en el tablero por el
> historial, **sin tocar `asignado_at`**.

**R57** — El sistema DEBE considerar asignada hoy, además de lo que dice R18, toda orden
con mensajero asignado que tenga una transición de **asignación de recolección**
registrada en el historial de estados dentro de la ventana del día CR.

**R58** — SI una orden es alcanzable por los dos caminos de "asignada hoy", ENTONCES DEBE
contarse **exactamente una vez**, tanto en `asignadas` como en el bucket o resultado que
le corresponda; la identidad de R25 DEBE seguir cumpliéndose sin excepción.

**R59** — El sistema NO DEBE escribir, actualizar, rellenar ni migrar `orden.asignado_at`
en ninguna circunstancia: esta feature es de **sólo lectura** sobre esa columna, porque es
el denominador del ranking del mensajero y moverla mueve su pago y su premio.

**R60** — MIENTRAS una orden entra por el camino de recolección, el sistema DEBE
atribuirla al mensajero **asignado de la orden**, y NO al actor que registró la transición
en el historial (que es quien decide, no quien reparte).

**R61** — El sistema DEBE clasificar las órdenes que entran por el camino de recolección
con las mismas reglas de R19–R25: si no tienen gestión vigente en el día, caen en el
bucket que les toque por su estatus (R43), y si la tienen, en su resultado.

---

## D. Presentación y refresco

**R28** *(reescrito tras la puerta del 2026-08-08 — §B)* — El sistema DEBE presentar una
**tarjeta por mensajero** con al menos una orden asignada hoy, identificada por su
nombre, mostrando los ocho contadores de R25 (`asignadas`, `entregadas`,
`reprogramadas`, `devueltas`, `rechazadas`, `incidentes`, `sinRecoger`, `enReparto`,
`otros`). Un mensajero sin órdenes asignadas hoy NO DEBE aparecer (confirmado por el
humano el 2026-08-08).

**R29** — El sistema DEBE ordenar las tarjetas de forma determinista: `asignadas`
descendente y, a igualdad, nombre del mensajero ascendente.

**R30** — El sistema DEBE mostrar un bloque de totales con la suma de cada contador sobre
las tarjetas presentadas.

**R31** — MIENTRAS la pantalla está abierta, el sistema DEBE volver a consultar los datos
cada 30 segundos.

**R32** — CUANDO una re-consulta periódica falla, el sistema DEBE conservar visibles los
últimos datos obtenidos y señalar el fallo, y NO DEBE vaciar el tablero ni mostrar ceros.

**R33** — SI no hay ninguna orden asignada hoy dentro del alcance del actor, ENTONCES el
sistema DEBE mostrar un estado vacío explícito, y NO DEBE mostrarlo como error. La misma
regla aplica al detalle de una tarjeta.

**R34** *(reescrito el 2026-08-08, cuarta vuelta)* — El sistema DEBE mostrar la fecha
calendario de Costa Rica del día representado y la **antigüedad del DATO**: el instante en
que los datos se produjeron contra la base, NO el instante de la petición ni el de la
respuesta. SI los datos vienen de una entrada de caché, ENTONCES la antigüedad mostrada
DEBE ser la de esa entrada, de modo que un dato de 40 s se anuncie como tal.

**R35** — El sistema DEBE ofrecer la entrada a la pantalla en la navegación únicamente a
los roles de R1, y esa entrada NO DEBE convertirse en el destino de aterrizaje posterior
al inicio de sesión de ningún rol.

### Apéndice D (2026-08-08) — tarjeta clicable, detalle y menú "Monitoreo"

**R47** — CUANDO el usuario pulsa la tarjeta de un mensajero, el sistema DEBE abrir el
detalle con las órdenes **de ese mensajero** y **de ese día**, y sólo esas.

**R48** — El sistema DEBE presentar el detalle con el mismo lenguaje visual del listado de
órdenes ya existente (chip de estatus y etiquetas legibles reutilizados, no reescritos), y
NO DEBE declarar un segundo mapa de estatus → etiqueta ni un segundo juego de colores.

**R49** *(cerrado el 2026-08-08)* — El detalle DEBE mostrar, por orden, las mismas
columnas que el listado de órdenes: número de guía, estatus actual, resultado del día si
lo hay, y destino/cliente en el mismo formato. NO DEBE añadir hora de la última gestión,
monto recaudado ni motivo de reprogramación (ampliarlo después es aditivo).

**R50** *(cerrado el 2026-08-08)* — El sistema DEBE abrir el detalle como **panel sobre el
tablero**, con el mensajero seleccionado reflejado en la URL, de modo que la vista sea
enlazable y compartible; y MIENTRAS el detalle está abierto DEBE permitir volver al
tablero sin perder su estado (orden de las tarjetas y datos ya cargados).

**R51** — El número de órdenes del detalle DEBE cuadrar con el contador `asignadas` de la
tarjeta desde la que se abrió, medido sobre los mismos datos.

**R52** — MIENTRAS el detalle está abierto, el refresco de 30 s DEBE seguir siendo
coherente: o bien el detalle se refresca con el tablero, o bien el tablero no muta bajo el
detalle; en ningún caso DEBE mostrarse un detalle de una tarjeta que ya no existe.

**R53** — El sistema DEBE colgar el tablero de un ítem de navegación **nuevo** llamado
"Monitoreo", visible únicamente para los roles de R1.

**R54** — CUANDO se añade el ítem "Monitoreo", el destino de aterrizaje posterior al
inicio de sesión de **cada** rol DEBE seguir siendo el mismo que antes de añadirlo.

### Apéndice D-bis (2026-08-08, tercera vuelta) — el parámetro de la URL

**R62** — CUANDO se abre la pantalla con un mensajero seleccionado en la URL, el sistema
DEBE resolver el detalle en el servidor con el alcance del actor (R40–R42), y NO DEBE
tratar el parámetro como una selección ya autorizada.

**R63** — SI el mensajero indicado en la URL no existe, no está dentro del alcance del
actor o no tiene órdenes asignadas hoy, ENTONCES el sistema DEBE mostrar el tablero con un
detalle vacío y un aviso **genérico e idéntico** en los tres casos, y NO DEBE revelar cuál
de los tres ocurrió.

---

## E. Eficiencia y aislamiento respecto de la analítica de cierre

**R36** — El sistema DEBE resolver el tablero con **una sola** consulta agregada en la
base de datos, y NO DEBE traer las órdenes ni las gestiones del día a memoria para
contarlas en la aplicación.

**R37** — El sistema DEBE filtrar las órdenes por mensajero asignado e instante de
asignación mediante un predicado de rango sobre las columnas del índice compuesto ya
existente, y NO DEBE crear índices nuevos ni tablas nuevas. *(Decisión humana del
2026-08-08, cuarta vuelta: se mantiene **intacto**. El segundo camino de R57 se queda sin
índice y se mitiga con la caché de R66–R73; el coste está medido en `design.md §5.ter`.)*

**R38** — El sistema NO DEBE leer la tabla de rollup de analítica ni su caché: los datos
DEBEN salir de las tablas vivas de órdenes y gestiones.

**R39** — El número de filas devueltas por la consulta DEBE ser el número de mensajeros
con órdenes asignadas hoy dentro del alcance, y no crecer con el número de órdenes.

### Apéndice E (2026-08-08) — el detalle no revive la deuda de la 191

**R55** — El sistema DEBE resolver el detalle con una consulta **acotada** al mensajero,
al día y al alcance, paginada como el listado de órdenes, y NO DEBE materializar en
memoria todas las órdenes del día para después recortarlas.

**R56** — El sistema NO DEBE consultar el detalle de ningún mensajero mientras el usuario
no abra su tarjeta: el tablero DEBE cargar sólo los conteos.

**R64** *(2026-08-08, tercera vuelta)* — El sistema DEBE resolver los dos caminos de
"asignada hoy" (R57) dentro de la **misma** consulta agregada de R36, y NO DEBE ejecutar
una segunda consulta por mensajero ni traer el historial del día a memoria.

**R65** *(2026-08-08, tercera vuelta)* — El sistema DEBE acotar la lectura del historial
por tipo de origen **y** por la ventana del día en el mismo predicado, y NO DEBE recorrer
el historial completo de ninguna orden ni de ningún rango mayor que el día.

### Apéndice E-bis (2026-08-08, cuarta vuelta) — la caché de servidor

> Decisión humana: **sin índice nuevo** (R37 intacto); el recorrido secuencial del camino 2
> se mitiga acotando su **frecuencia** con una caché de servidor de vida corta.
>
> ⚠️ La clave de esta caché es una **frontera multi-tenant**, igual que la sección A. Una
> caché mal claveada no da una cifra equivocada: responde **rápido y mal**, sirviéndole a
> un satélite lo que se produjo para un maestro. Por eso R67–R69 son requisitos de
> seguridad, no de rendimiento.

**R66** — El sistema DEBE servir los conteos del tablero desde una caché de servidor cuya
entrada expira por tiempo en el orden de 15 segundos.

**R67** — La clave de la caché DEBE incluir el **alcance resuelto** del actor (su tipo y,
cuando lo tenga, su identificador de zona). SI dos peticiones tienen alcances distintos,
ENTONCES NO DEBEN compartir entrada de caché **en ningún caso**.

**R68** — SI dos peticiones tienen el **mismo** alcance resuelto y caen dentro de la
ventana de vida de la entrada, ENTONCES DEBEN compartir entrada, aunque las hagan usuarios
distintos: la clave NO DEBE llevar el identificador del usuario ni su rol.

**R69** — El sistema DEBE resolver el alcance del actor en **cada** petición y **antes** de
consultar la caché. SI el actor está denegado por R2, R3, R7 o R9, ENTONCES DEBE recibir
denegado aunque exista una entrada caliente que cubra su consulta: la caché es una
optimización de lectura y NUNCA una ruta alternativa de autorización.

**R70** — La clave de la caché DEBE incluir la fecha calendario de Costa Rica del día
consultado. CUANDO se cruza la medianoche de Costa Rica, el sistema NO DEBE servir los
conteos del día anterior.

**R71** — La caché DEBE expirar **únicamente** por tiempo. El sistema NO DEBE invalidarla
por evento, ni engancharla a las escrituras de órdenes, gestiones o historial, ni exponer
ninguna operación de invalidación.

**R72** — El tiempo de vida de la caché y el instante de referencia DEBEN entrar como
entrada del sistema (configuración y reloj inyectado), de modo que un test pueda ejercitar
acierto y expiración sin esperar en tiempo real.

**R73** — El sistema DEBE cachear **sólo** los conteos del tablero. El detalle de un
mensajero (R47–R55) NO DEBE cachearse.

---

## Preguntas abiertas

**Ninguna.** Las nueve preguntas de las versiones anteriores están respondidas por el
humano (2026-08-08) e incorporadas a los requisitos. La última —si se autorizaba un índice
nuevo para el camino 2 de R57— se cerró en la cuarta vuelta con **la opción 2: sin índice**
(R37 intacto) y caché de servidor de vida corta (R66–R73). El coste que eso compra y el
que paga está registrado sin adornos en `design.md §5.ter`.

Nada de este spec queda pendiente de decisión humana.
