# Feature 260 — El detalle del tablero reutiliza las columnas del listado

> Zona: `fullstack` (se implementa **backend primero**, luego frontend).
> Pantalla: `/monitoreo` → modal de detalle de un mensajero.
> Revierte **R49 de la feature 192** (alcance cerrado en cuatro columnas).
> **Puerta humana resuelta el 2026-08-21**: las cuatro preguntas abiertas están cerradas y escritas
> como requisitos (ver «Decisiones cerradas» al final).

## Contexto de una línea

El modal del detalle muestra hoy **cuatro** columnas propias sobre un contrato de 7 campos
(`OrdenDetalleDia`). Pasa a mostrar **la orden completa**, montando el módulo de columnas del
listado de órdenes (`ordenesColumns`) con su propio `DataTable`, y a alimentarse del **mismo
camino que ya produce `OrdenListItemDTO`**.

---

## R1 — R9 · El dato: la orden completa por el camino que ya la produce

**R1.** El sistema DEBE representar cada orden del detalle del tablero del día con el **mismo tipo
de elemento que el listado de órdenes** (`OrdenListItemDTO`), ampliado con el resultado del día y
el instante que puso la orden en manos del mensajero.

**R2.** El sistema DEBE producir esos elementos con **el mismo mapeo y la misma proyección de
relaciones** que producen los elementos del listado de órdenes. El sistema NO DEBE contener una
segunda proyección de fila de orden a elemento de listado.

**R3.** CUANDO se pide el detalle de un mensajero para el día en curso, el sistema DEBE decidir
**qué órdenes entran, cuántas hay en total y en qué orden se muestran** con la consulta paginada
del tablero que ya existe, y DEBE hidratar únicamente los identificadores devueltos por esa
página.

**R4.** El sistema DEBE devolver los elementos del detalle **en el mismo orden** en que la consulta
del día los produjo.

**R5.** SI la consulta del día no devuelve ninguna orden, ENTONCES el sistema NO DEBE ejecutar
ninguna consulta de hidratación ni de conteo de intentos.

**R6.** El sistema DEBE exponer en cada elemento del detalle el número de **intentos de entrega**,
resuelto con el mismo criterio único que usa el listado de órdenes, y DEBE exponer `0` como valor
conocido cuando la orden no registra ninguno.

**R7.** SI un identificador de la página no resuelve a una orden durante la hidratación, ENTONCES
el sistema DEBE omitir esa fila en lugar de devolver un elemento incompleto.

**R8.** El sistema DEBE seguir obteniendo el `total` del día de la **misma consulta** que produce
la página, y no de un segundo viaje a la base.

**R9.** El sistema DEBE seguir paginando el detalle con el tamaño de página de la configuración de
órdenes, y DEBE seguir devolviendo `pagina` y `pageSize` dentro del detalle. La pantalla NO DEBE
escribir ningún literal numérico de tamaño de página.

---

## R10 — R19 · Alcance, dinero y superficie

> **Origen de estos requisitos (decisión humana del 2026-08-21).** La premisa de partida —«se
> copian las reglas por rol de `/ordenes`»— resultó **falsa al medirla**: `/ordenes` no recorta
> dinero por rol, recorta por **puerta** (`notFound()` a `mensajero` y a `adminSatelite`). No había
> regla que copiar, y `/monitoreo` **sí** admite al `adminSatelite`. La regla de R13–R17 es
> **nueva** y se escribe aquí por primera vez.

**R10.** El sistema DEBE resolver el alcance del actor con el resolutor único de alcance en **cada**
lectura del detalle, antes de consultar ninguna orden.

**R11.** El sistema DEBE aplicar el recorte de alcance del actor **también en la consulta de
hidratación**, y NO DEBE fiarse de que los identificadores lleguen ya recortados por la consulta
anterior.

**R12.** El sistema DEBE incluir en el detalle el alcance con el que se resolvió (`global` o
`zona`).

**R13.** MIENTRAS el alcance resuelto sea `zona`, el sistema NO DEBE incluir en la respuesta del
detalle, para ninguna orden: el **flete con IVA**, la **comisión con IVA**, la **tarifa de la
tienda** ni el **contacto de la tienda** (correo electrónico y teléfono).

**R14.** MIENTRAS el alcance resuelto sea `zona`, la pantalla NO DEBE montar ninguna columna que
lea uno de los campos de R13; en particular, NO DEBE montar las columnas de flete, comisión ni
fulfillment.

**R15.** El sistema NO DEBE mostrar un importe cero, ni un guion, ni ningún otro marcador, en lugar
de un dato retirado por alcance: lo retirado se retira como **columna**, nunca como **valor**.

**R16.** MIENTRAS el alcance resuelto sea `global`, la pantalla DEBE montar las columnas de dinero
del listado de órdenes (monto a cobrar, flete, fulfillment y comisión).

**R17.** El sistema DEBE mostrar el monto a cobrar de la orden en los dos alcances.

**R18.** El sistema NO DEBE exponer en el detalle **ningún campo que el listado de órdenes no
exponga**: el elemento del detalle es el del listado o un subconjunto suyo, nunca un superconjunto.

**R19.** El sistema NO DEBE exponer en el detalle órdenes marcadas como borradas.

---

## R20 — R29 · Las columnas

**R20.** La pantalla DEBE montar en el detalle **todas** las columnas del módulo de columnas del
listado de órdenes que el alcance permita (R14), y NO DEBE declarar ninguna de ellas por segunda
vez.

**R21.** La pantalla NO DEBE montar el contenedor del listado de órdenes ni **ninguna acción sobre
las órdenes**: ni selección por lote, ni barra de acciones, ni acciones por fila, ni carga masiva,
ni escáner, ni descarga del dataset, ni barra de filtros, ni columna de expansión.

**R22.** La pantalla DEBE añadir **una única columna propia**, «Resultado del día», que no existe en
el listado de órdenes.

**R23.** La pantalla DEBE colocar en primer lugar, y en este orden, las columnas **Nº Guía**,
**Estado**, **Resultado del día**, **Destinatario** y **Dirección**.

**R24.** La pantalla DEBE declarar ese orden **en un solo sitio y por identificador de columna**, y
NO DEBE declarar una segunda lista de definiciones de columna paralela a la del listado.

**R25.** SI un identificador declarado en ese orden no existe entre las columnas montadas, ENTONCES
la verificación DEBE fallar.

**R26.** CUANDO el listado de órdenes gane o pierda una columna, el detalle DEBE ganarla o perderla
**sin que se modifique el módulo del detalle**.

**R27.** La pantalla DEBE etiquetar el resultado del día con el mapa de etiquetas compartido, y NO
DEBE declarar un segundo mapa de estatus a etiqueta ni un segundo juego de colores por estatus.

**R28.** CUANDO las columnas no quepan en el ancho del diálogo, la tabla DEBE desplazarse
horizontalmente **dentro de su caja**, sin desbordar el diálogo ni la página, y sin recortar en
silencio el contenido de ninguna celda ni de la cabecera.

**R29.** El sistema DEBE identificar cada fila del detalle por el identificador de la orden.

---

## R30 — R36 · Lo que NO cambia (regresión)

**R30.** El detalle DEBE seguir siendo una vista de **lectura** dentro del mismo diálogo modal, con
«Cerrar» como única salida visible y sin botón de confirmación.

**R31.** Los tres casos malos —mensajero inexistente, mensajero fuera del alcance del actor y
mensajero sin órdenes hoy— DEBEN seguir produciendo **el mismo detalle vacío y el mismo aviso
genérico**, sin eco del identificador recibido.

**R32.** El sistema NO DEBE permitir distinguir esos tres casos: ni por el contenido del detalle, ni
por el texto del aviso, ni por si el diálogo permanece abierto o se cierra.

**R33.** CUANDO el identificador del mensajero llega por el parámetro de la URL, el detalle DEBE
pedirse siempre al servidor, que vuelve a resolver el alcance del actor.

**R34.** Abrir y cerrar el detalle NO DEBE desmontar el tablero ni provocar una consulta adicional
de los contadores del día.

**R35.** El sistema NO DEBE cachear el detalle.

**R36.** El detalle NO DEBE escribir en ninguna tabla; en particular, NO DEBE escribir en el
instante de asignación de la orden.

---

## R37 — R41 · Fronteras técnicas que la feature sigue respetando

**R37.** Ningún archivo del árbol censado de la feature DEBE ejecutar `findMany`, y el SQL crudo
DEBE seguir viviendo únicamente en el repositorio del tablero.

**R38.** Toda consulta cruda del repositorio del tablero DEBE seguir siendo **agregada** (`GROUP
BY`) o **paginada** (`LIMIT` + `OFFSET`); el repositorio NO DEBE ganar una cuarta consulta.

**R39.** Ningún archivo del árbol censado DEBE leer el rol del actor ni declarar una segunda tabla
de roles. El gate de pantalla sigue siendo la única excepción y sigue sin poder recortar datos.

**R40.** La consulta de hidratación DEBE estar acotada por lista de identificadores **y** por el
alcance, y NO DEBE poder devolver más filas que el tamaño de página del detalle.

**R41.** Todo módulo que monte una tabla de órdenes con importes DEBE estar dentro del censo de la
guardia que impide derivar dinero en el navegador.

---

## R42 · La decisión revertida queda escrita

**R42.** El sistema DEBE conservar la decisión que cerraba el detalle en cuatro columnas y DEBE
anotar junto a ella su reversión **con fecha y motivo**. El sistema NO DEBE borrar esa decisión.

---

## R43 — R46 · Lo que cerró la puerta humana del 2026-08-21

**R43.** El sistema DEBE declarar **en un solo sitio** la lista de campos restringidos por alcance
(R13), y DEBE expresar el elemento del detalle **derivándolo** del tipo del listado. El sistema NO
DEBE declarar un segundo tipo paralelo para el detalle ni una segunda lista de campos restringidos.

**R44.** El sistema DEBE fallar la verificación SI cualquiera de las dos mitades del recorte por
alcance (el dato de R13 o la columna de R14) desaparece. Esa cláusula DEBE demostrarse capaz de
ponerse roja **mutando cada mitad por separado**, y la demostración DEBE quedar escrita.

**R45.** La pantalla NO DEBE montar la columna «Liberada el»: pertenece a la variante del listado
acotada al estado `reprogramada`, y el detalle del día mezcla estados.

**R46.** MIENTRAS el alcance resuelto sea `global`, el sistema NO DEBE recortar ningún campo por
debajo del techo de R18.

---

## Fuera de alcance (declarado)

- **No** se toca el contenedor `/ordenes` ni ninguna de sus acciones.
- **No** se toca el módulo `ordenes-columns.tsx`: se consume tal cual.
- **No** se añaden tablas, columnas de base de datos, migraciones ni policies RLS.
- **No** se toca el criterio de «asignada hoy» del tablero. Ese es el objeto de la **feature 259**
  (contar por día de reparto), que **ya tiene spec**: esta feature **no replica su predicado ni lo
  asume**, y hereda el que haya en el repositorio el día en que se implemente. La dependencia está
  declarada en `design.md §8`.
- **No** se relaja el aislamiento: más campos es más superficie, y el alcance sigue recortando filas
  exactamente igual que hoy.

---

## Decisiones cerradas por el humano (2026-08-21)

Las cuatro preguntas abiertas de la versión anterior de este documento quedaron resueltas. Se dejan
aquí con su respuesta para que nadie las reabra.

| # | Pregunta | Respuesta | Dónde vive ahora |
| --- | --- | --- | --- |
| Q1 | ¿Qué dinero ve el alcance `zona`? | **Fuera** flete, comisión, fulfillment, **la tarifa y el contacto de la tienda**. **Dentro** el monto a cobrar (ese rol ya lo ve en `/recepcion-satelite`). El recorte es **columna Y dato**: lo recortado no viaja al cliente. | R13, R14, R15, R17 |
| Q2 | ¿Se recorta por debajo del techo? | Resuelta por Q1: el único recorte por debajo del techo es el de alcance `zona`, que ya cubre el contacto de la tienda y la tarifa. Para `global`, nada. Y **una sola proyección declarada en un sitio**, no un segundo tipo paralelo. | R18, R43, R46 |
| Q3 | ¿El orden de las cinco primeras? | **Aceptado**: Nº Guía · Estado · Resultado del día · Destinatario · Dirección. La premisa de la ficha era imprecisa: la «cuarta de hoy» eran **dos** columnas en el listado. | R23, R24, R25 |
| Q4 | ¿Y «Liberada el»? | **Fuera**, por el motivo dado: es de la variante `reprogramada` y el detalle mezcla estados. | R45 |

**Sin preguntas abiertas.** El spec está listo para implementar.

---

## Notas de corrección a la ficha

1. **Las columnas.** La ficha enumera las 19 como «…, comision, mensajero, fechaCreacion, tiempo,
   **liberada**» y **omite `intentos`**. Medido sobre `ordenes-columns.tsx`: `ordenesColumns` son 19
   e incluyen `intentos` (insertada tras `estatus` por la feature 160); `liberada` **no** está —
   pertenece a `ordenesColumnsReprogramada`, que son 20. Con la columna propia «Resultado del día»,
   el detalle monta **20** columnas en alcance `global` y **17** en alcance `zona`.
2. **El productor del DTO.** La ficha dice que `ApiOrdenLecturaService` consume `OrdenListItemDTO`.
   No es cierto: produce `ApiOrdenListItemDTO`, el DTO **público** del canal por API key. El
   productor real de `OrdenListItemDTO` es `OrdenRepository`, con el `include`
   `WITH_ESTATUS_Y_TIENDA` y el mapeo `toListItemDTO` (`design.md §1.7`). El coordinador corrige la
   ficha en `feature_list.json`.
3. **La regla por rol.** La ficha pide «confirmar que respetan las mismas reglas por rol que en
   `/ordenes`». No hay tales reglas: `/ordenes` no recorta dinero por rol (`design.md §1.4`). La
   regla de R13–R17 es nueva y es decisión humana del 2026-08-21.
