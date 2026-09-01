# Ficha 344 — El libro de movimientos deja de dar un número suelto

> Requisitos en notación EARS. Sin detalles de implementación: el CÓMO vive en `design.md`.
> Cada `R<n>` termina mapeado a un test concreto en `tasks.md § Trazabilidad`.

## Contexto

Cada fila del libro de movimientos de la wallet muestra un importe **sin decir de dónde viene**.
Pedido textual del humano tras la release: «la info de esa wallet está suelta y no atada a nada,
entonces esconde mucha información importante que es importante revisar».

**El rastro ya existe entero en la base; falta enseñarlo.** Un movimiento con
`origen_tipo = 'cierre_dia'` guarda su `origen_id`, así que del movimiento se llega al cierre, y
del cierre a sus órdenes por `cierre_detail`. **No hay que inventar dato ni añadir columna.**

### Lo confirmado en el ARCHIVO REAL (no en el índice del MCP)

1. `lib/services/WalletFeedService.ts` — `construirMovimientosDeIngreso(cierreId, tx)` lee
   `cierre_detail` (lo de la ORDEN, congelado) y `gestion_orden` (el `resultado`, que es de la
   GESTIÓN), y emite **un movimiento por concepto** con `origenTipo: "cierre_dia"` y
   `origenId: cierreId`. La fórmula es `agregarIngresosPorConcepto` → `derivarIngresoOrden`.
2. `lib/services/WalletTiendaFeedService.ts` — el mismo bucle, para el libro de la tienda: el
   crédito `cod_recaudado` sale de `gestion_orden.monto_recibido` y los seis débitos salen de la
   MISMA `derivarIngresoOrden`, mapeados con `conceptoIngresoADebitoTienda`. El `tiendaId` con el
   que se acredita/debita sale CONGELADO de `cierre_detail`.
3. `lib/utils/ingreso-ordenex.ts` — `derivarIngresoOrden` devuelve un objeto donde un concepto
   **ausente** significa «esta gestión no aporta a ese concepto». Sólo una gestión `entregada`
   deriva flete e IVA del flete (y comisión sólo si la orden cobra comisión); sólo una `rechazada`
   deriva los dos conceptos de devolución; `devuelta`, `reprogramada` e `incidente` no derivan
   nada; y sin tarifa congelada no se deriva ningún concepto.
4. `db/schema.prisma` — `cierre_detail` congela **las ENTRADAS de la fórmula**, no los conceptos
   derivados, y su propio docstring dice que con esas entradas más `derivarIngresoOrden` la fila
   es **re-derivable y auditable**. Ese es el camino que esta ficha usa.
5. `lib/repositories/CierresAdminRepository.ts` — `toIngresoOrdenex` ya re-deriva por gestión con
   esa misma función sobre el snapshot, para el detalle de un cierre del admin. **El precedente de
   re-derivar sin re-implementar ya está vivo en el repo.**
6. `components/shared/DataTable.tsx` — la primitiva ya soporta `renderExpanded` +
   `expandAriaLabel`, y sólo MONTA el contenido de la fila abierta. Es lo que usan hoy los
   desgloses de tienda y de mensajero.

### El punto que puede arruinarlo

**Que un movimiento sea `ingreso_flete` NO significa que todas las órdenes del cierre aporten a
él** — sólo las entregadas. En el cierre del ejemplo son **23 órdenes y 14 entregadas**. Si el
detalle mostrara las 23, su suma no daría el importe de la fila y habríamos construido otra
pantalla que no cuadra. Por eso `R16`–`R23`, y por eso `R17` se prueba **contra Postgres**.

### Lo que esta ficha NO pudo medir, y hay que medir antes de implementar

La sesión que escribió este spec **no tuvo acceso a base ni a shell**: los números de producción
que la ficha cita (68 movimientos, todos con `origen_tipo = 'cierre_dia'` y `origen_id` presente;
el cierre de 23 órdenes con 14 entregadas y su `ingreso_flete` de 28.800,00) **no se re-midieron
aquí**. Son la premisa de la que cuelga todo el diseño, así que `tasks.md § T0.1` los vuelve a
medir en solo-lectura ANTES de escribir una línea. Si alguno no se sostiene, se para.

---

## 1 — Abrir una fila del libro

**R1.** CUANDO una persona abre una fila del libro de movimientos cuyo origen es el cierre del día,
el sistema DEBE mostrar, junto a esa fila, las órdenes que componen su importe.

**R2.** MIENTRAS una fila del libro esté cerrada, el sistema NO DEBE leer su detalle.

**R3.** CUANDO se abre una fila, el sistema DEBE leer exactamente una página del detalle.

**R4.** El sistema DEBE dar a cada fila abierta su propia página y su propio estado: abrir dos filas
a la vez NO DEBE hacer que una pise a la otra.

**R5.** El sistema DEBE dar al control que abre cada fila un nombre accesible que identifique SU
fila, y NO un texto genérico repetido.

**R6.** SI el origen de un movimiento no es el cierre del día, ENTONCES el sistema NO DEBE ofrecer
el control de apertura sobre esa fila.

**R7.** SI la lectura del detalle de una fila falla, ENTONCES el sistema DEBE contar el fallo DENTRO
de esa fila, y el resto del libro DEBE seguir mostrándose.

**R8.** SI el detalle de una fila no contiene ninguna orden, ENTONCES el sistema DEBE decirlo con un
estado vacío explícito.

## 2 — Qué dice el detalle

**R9.** El detalle DEBE decir de qué cierre sale el importe, identificándolo al menos por su fecha.

**R10.** Cada orden del detalle DEBE mostrar su número visible de guía, su destinatario, el
resultado de su gestión en ese cierre y cuánto aporta al importe de la fila.

**R11.** El sistema DEBE ofrecer, por cada orden del detalle, un enlace que lleve a esa orden en el
listado de órdenes.

**R12.** El detalle DEBE decir cuántas órdenes aportan a ese concepto y cuántas órdenes tiene el
cierre dentro del alcance del actor.

**R13.** El sistema DEBE rotular el resultado de cada gestión con su etiqueta legible, y NUNCA con
el valor del enum.

**R14.** DONDE el detalle se muestre en la caja principal, el sistema DEBE mostrar además la tienda
de cada orden.

**R15.** MIENTRAS el detalle se muestre en la wallet de una tienda, el sistema NO DEBE revelar qué
mensajero movió ese dinero.

## 3 — Qué órdenes aportan, y por qué la suma cuadra

**R16.** El detalle de un movimiento DEBE contener EXACTAMENTE las órdenes que aportan a SU
concepto: ni una de más ni una de menos.

**R17.** La suma de los aportes de TODAS las páginas del detalle de un movimiento DEBE ser igual,
céntimo a céntimo, al importe de ese movimiento.

**R18.** El sistema DEBE decidir si una orden aporta a un concepto con la MISMA definición que
produjo el importe del movimiento; NO DEBE existir una segunda definición de ese criterio que pueda
divergir sin que nada falle.

**R19.** SI una orden del cierre no aporta al concepto de un movimiento, ENTONCES el sistema NO DEBE
mostrarla en el detalle de ese movimiento.

**R20.** SI una orden acumula más de una gestión en el mismo cierre, ENTONCES el sistema DEBE
mostrarla UNA sola vez, y su aporte DEBE ser el de todas sus gestiones que aportan.

**R21.** El sistema DEBE acotar el conjunto del detalle en la CONSULTA A LA BASE, y NO filtrando en
memoria lo que la base ya devolvió.

**R22.** El sistema DEBE leer los datos de cada orden del SNAPSHOT congelado del cierre, y NO de la
orden, la zona o la tarifa VIGENTES.

**R23.** SI el cierre congeló una orden sin tarifa vigente, ENTONCES esa orden NO DEBE aparecer en
el detalle de ningún concepto derivado de la tarifa, y su ausencia NO DEBE alterar la suma.

## 4 — El detalle pagina, y el total lo cuenta la base

**R24.** El sistema DEBE paginar el detalle de un movimiento.

**R25.** CUANDO el conjunto de un movimiento supera el tamaño de página, el sistema DEBE ofrecer
navegar a las páginas siguientes.

**R26.** El sistema DEBE tomar el tamaño de página del detalle y su tope máximo de la CONFIGURACIÓN;
la pantalla NO DEBE declarar ninguno de los dos como literal.

**R27.** El sistema DEBE poder sobreescribir ese tamaño y ese tope por variable de entorno, y SI el
valor de entorno no es un entero positivo, ENTONCES DEBE caer en el valor por defecto.

**R28.** El número total de órdenes que aportan a un movimiento DEBE contarlo la BASE, y NUNCA el
largo de la página que se está pintando.

**R29.** SI el borde recibe un tamaño de página mayor que el tope configurado, ENTONCES DEBE
rechazarlo como error de validación y NO DEBE devolver ninguna orden.

**R30.** El sistema DEBE recorrer las páginas del detalle en un orden TOTAL, de modo que paginar no
repita ni omita ninguna orden.

## 5 — La descarga es un contrato

**R31.** El sistema DEBE ofrecer la descarga del detalle de un movimiento.

**R32.** La descarga DEBE contener TODAS las órdenes que aportan a ese movimiento dentro del alcance
vigente, y NO sólo la página visible.

**R33.** El sistema DEBE resolver el conjunto de la descarga ENTERAMENTE en el servidor: el
navegador NO DEBE seleccionar, ordenar ni recortar filas de ese conjunto.

**R34.** SI el conjunto de la descarga supera el tope de filas de la aplicación, ENTONCES el sistema
NO DEBE producir archivo y DEBE decir el total encontrado y el tope.

**R35.** Las columnas de la descarga y su ORDEN son contrato: DEBEN quedar fijadas por una aserción
que las ENUMERE una a una, y esa enumeración DEBE cambiarse deliberadamente cuando cambien.

**R36.** La descarga NO DEBE emitir ningún identificador interno.

**R37.** La descarga DEBE emitir cada importe como el texto que devolvió el servidor, sin
reformatearlo, sin redondearlo y sin anteponerle símbolo de moneda.

## 6 — Alcance por rol

**R38.** SI el actor no tiene acceso total, ENTONCES la lectura del detalle de la caja principal
DEBE responder denegado y NO DEBE devolver ninguna orden.

**R39.** El sistema DEBE evaluar el permiso ANTES de consultar la base.

**R40.** MIENTRAS el actor sea una tienda, el detalle DEBE acotarse a las órdenes de ESA tienda, y
ese acotamiento DEBE ir en la CONSULTA A LA BASE.

**R41.** SI una tienda pide el detalle de un movimiento que no pertenece a su libro, ENTONCES el
sistema DEBE responder «no encontrado» y NO DEBE devolver ninguna orden.

**R42.** El sistema NO DEBE aceptar del cliente el identificador de la tienda ni ninguna lista de
conceptos: DEBE recibir únicamente el identificador del movimiento y la página.

**R43.** El sistema NO DEBE cambiar el alcance por rol vigente de ninguna de las dos pantallas ni
añadir permisos nuevos.

## 7 — Dinero: ni una operación nueva

**R44.** Los importes DEBEN cruzar la frontera servidor→navegador como texto.

**R45.** El navegador NO DEBE convertir ningún importe a número ni operar aritméticamente con él.

**R46.** El sistema NO DEBE introducir ninguna fórmula de dinero nueva: el aporte de una orden DEBE
derivarse de la función que ya produce el importe del movimiento, sobre las entradas congeladas del
cierre.

**R47.** El sistema NO DEBE mostrar en el detalle ningún subtotal de la página visible.

## 8 — Los conceptos que no se reparten por orden, declarados

**R48.** SI el concepto de un movimiento de cierre no admite reparto por orden, ENTONCES el sistema
DEBE abrir su detalle igualmente y decir de dónde sale ese importe, en vez de callar.

**R49.** El sistema DEBE declarar, para CADA concepto de los dos libros, si admite reparto por orden
y de qué fuente sale su importe; un concepto nuevo sin esa declaración DEBE romper la compilación.

## 9 — Leerlo en una pantalla de verdad

**R50.** MIENTRAS el detalle se muestre en un ancho de 390 px, el sistema DEBE mostrar el importe de
cada orden ENTERO.

**R51.** El sistema NO DEBE truncar, abreviar ni recortar por desbordamiento el texto de ningún
importe.

**R52.** El sistema DEBE mostrar a 390 px la MISMA información que a 1440 px, sin ocultar ninguna
columna de datos.

---

## Fuera de alcance (declarado)

- **La wallet de mensajeros** (`/wallet/mensajeros`). Decisión del humano: «la de mensajeros queda
  para después».
- **`egreso_pago_mensajero` y `ingreso_cod_recaudado` de la caja principal.** Sus importes NO salen
  de una acumulación por orden: el primero es el snapshot `cierre_dia.total_pago_mensajero` y el
  segundo es la suma de los créditos del libro POR TIENDA de ese cierre. Repartirlos por orden
  exigiría afirmar una invariante entre dos snapshots que esta ficha **no ha medido**, y eso es
  exactamente lo que la regla 6 de `CLAUDE.md` prohíbe. Se resuelven por `R48`: la fila se abre y
  dice de dónde sale su importe. El motivo y la fuente quedan escritos en el catálogo de `R49`, de
  modo que darles reparto mañana sea cambiar UNA entrada.
- **`egreso_indemnizacion`.** Mismo tratamiento y por prudencia de superficie: su reparto por orden
  está disponible (`gestion_orden.indemnizacion`, la misma columna que suma su feed) pero es un
  tercer productor, y esta ficha se limita a los dos feeds que comparten `derivarIngresoOrden`.
  Queda como el follow-up más barato, no como un olvido.
- **Los filtros, el orden y la descarga del propio libro**: no se tocan.
- **Ninguna migración, ninguna columna y ningún valor de enum.**
- **La tarjeta «Cómo se compone la ganancia de Ordenex»** y su detalle por categoría (ficha 343):
  no se toca. Esta ficha abre el LIBRO, aquélla abrió la TARJETA.

---

## Preguntas abiertas

> Ninguna bloquea la implementación: cada una lleva el valor por defecto que `design.md` asume.
> Se listan porque son decisiones visibles que el humano puede querer cambiar.

**Q1 — ¿Una orden con dos gestiones vigentes en el mismo cierre sale en una fila o en dos?**
El diseño asume **UNA fila con el aporte sumado** (`R20`), porque el humano pidió «cuánto aporta
cada ORDEN» y porque el grano de `cierre_detail` es la orden. El precio: la fila no dice que detrás
hay dos gestiones. La alternativa —una fila por gestión, sin sumar nada— se descartó en
`design.md § 11-A3`; volver a ella es cambiar la raíz de la consulta y el `rowKey`. **Este caso
existe en producción** (hay constancia de órdenes con dos gestiones vivas), así que no es teórico.

**Q2 — ¿El aporte «0,00» de una orden se muestra o se esconde?**
El diseño asume que **se muestra**: la regla es una sola —«aparece la orden cuyo concepto quedó
DEFINIDO en la derivación»— y esconder los ceros sería un SEGUNDO criterio, justo lo que `R18`
prohíbe. Ocurre, por ejemplo, con una orden que cobra comisión y no tenía COD que recaudar; decir
«aportó cero» es información, no ruido. Si se prefiere ocultarlos, hay que decirlo, y el filtro
tendría que ir también en el `count` para que `R28` siga siendo cierto.

**Q3 — ¿La descarga del detalle es un archivo por movimiento, o uno por cierre?**
El diseño asume **por movimiento** (un archivo = una fila del libro = un concepto), que es lo que
el usuario está mirando cuando pulsa. Un archivo por cierre con todos sus conceptos es otra cosa —y
ya existe una descarga del detalle del cierre en la pantalla de cierres—; mezclarlas produciría dos
archivos del mismo hecho con columnas distintas.

**Q4 — ¿Qué se hace con una guía de uno o dos dígitos en el enlace a `/ordenes`?**
El buscador de `/ordenes` exige un mínimo de caracteres para viajar, así que un número corto llega
a la pantalla sin filtrar y ésta lo dice por escrito. Es el mismo caso borde que la ficha 341 ya
documentó, y el diseño lo hereda tal cual: **el enlace se pinta igual**. Si se prefiere no pintarlo
por debajo del mínimo, es una condición de una línea.

**Q5 — ¿El nombre del mensajero en la caja principal?**
El diseño lo muestra en `/wallet` y lo **oculta** en `/mi-wallet` (`R15`), porque la ficha 335
decidió expresamente que el selector de cierres de la tienda no revelara el mensajero. Si esa
decisión se ha revisado desde entonces, esto cambia con ella.
