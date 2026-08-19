# Feature 230 — Descarga de cierres en dos formas: general (por cierre) y detallada (por gestión) · requirements

> Notación EARS estricta. Cada `R<n>` termina mapeado a un test concreto en `tasks.md §
> Trazabilidad`. Sin detalles de implementación: el CÓMO vive en `design.md`.
>
> **Pedido del humano (2026-08-18):** «la descarga de datos de los cierres debe poder hacerse
> de 2 formas: general (como está) y detallada (por mensajero)».
>
> **El hueco real** (verificado contra el código, `design.md §1`): hoy existen dos descargas de
> granos distintos y **ninguna cruza cierres**. La general es una fila por cierre
> (`cierres-admin-descarga-columnas.ts`); la detallada es una fila por gestión pero **solo se
> alcanza abriendo un cierre concreto**, y son cinco archivos, uno por resultado
> (`cierre-gestiones-descarga-columnas.ts` + el mapa `DESCARGA_POR_RESULTADO`). No existe
> ningún camino de lectura que devuelva las gestiones de VARIOS cierres.

---

## Decisiones CERRADAS por el humano — no se reabren

### Tanda A (2026-08-18, al dar de alta la ficha)

| # | Decisión |
| --- | --- |
| **D1** | La descarga **general** (una fila por cierre) se conserva **exactamente** como está. |
| **D2** | El grano de la **detallada** es **una fila por GESTIÓN** (línea de orden), NO un resumen agregado por mensajero. |
| **D3** | La detallada es **UN SOLO archivo** con columna «Resultado». Ni los cinco de hoy, ni un libro de cinco hojas. **Esto revierte la decisión P2 de la feature 170**; el humano vio el ejemplo con las celdas vacías y **aceptó el coste**. |
| **D4** | Las **cinco descargas por sección de la 170 NO se retiran**. Esta feature añade una salida más, en otro punto de entrada. Solo se corrige la prosa de la cabecera que hoy afirma que «no hay un archivo único del cierre», porque quedaría falsa. |
| **D5** | El mensajero se elige con un **diálogo propio** en el botón de descarga (uno o varios), **NO** heredando el filtro de mensajero de la pantalla. |

### Tanda B (2026-08-18, gate F1.4 — respuestas a Q1…Q5)

| # | Decisión |
| --- | --- |
| **D6** *(Q1)* | Se **ratifica la tabla de columnas completa** propuesta en `design.md §6`. Deja de ser propuesta. |
| **D7** *(Q1.a)* | El flete de devolución **NO se agrupa**: se conservan las **tres** columnas de hoy (`Flete devolución`, `IVA flete dev.`, `Flete devolución + IVA`). Se descarta la columna agrupada única que el spec proponía. |
| **D8** *(Q1.b)* | **SIN EVIDENCIAS.** La columna «Tiene evidencia» **NO va en la hoja fundida, en ningún resultado**. Se retira entera. Las constantes `TIENE_EVIDENCIA_COL/_SI/_NO` y el helper `tieneEvidencia` **siguen existiendo intactos**: los usan las cinco descargas por sección, que no se retiran. |
| **D9** *(Q1.c)* | «Estado del cierre» y «Destino» **NO** entran en la fundida. Se quedan en la descarga general, que es su grano. |
| **D10** *(Q2)* | **DOS puntos de entrada**: el listado de `cierres-admin` **y** el listado de cierres de **bodega** del maestro. **Incluida la GAM.** |
| **D11** *(Q3)* | La detallada es **INDEPENDIENTE**: no hereda los filtros de fecha ni de bodega de la barra de la pantalla. Su conjunto lo determina íntegramente el diálogo. |
| **D12** *(Q4)* | «Mensajero sin cierres» y «mensajero fuera de alcance» se leen **igual**: cero filas y el mismo mensaje. Es deliberado — distinguirlos filtraría información sobre el alcance ajeno. |
| **D13** *(Q5)* | El tope de 5000 filas de `lib/config/descarga.ts` **vale tal cual** para el grano de gestión. No se introduce un tope propio. |

---

## Glosario

- **Descarga general**: el archivo de una fila por CIERRE que ya producen los listados de
  cierres (del día y de bodega).
- **Descarga detallada / hoja fundida**: el archivo nuevo de esta feature; una fila por
  GESTIÓN, cruzando los cierres de uno o varios mensajeros.
- **Gestión**: una línea de orden dentro de un cierre, con su resultado
  (`entregada` / `reprogramada` / `devuelta` / `rechazada` / `incidente`).
- **Alcance**: el conjunto de cierres que un actor puede ver, derivado de su ROL y su ZONA y
  resuelto **desde la sesión**. No es un filtro y no viaja en la entrada.
- **Recorte**: valor que el usuario elige y que solo puede QUITAR filas dentro del alcance ya
  resuelto; nunca añadirlas.
- **GAM / central**: la zona marcada `esCentral` (columna que la feature 54 renombró desde
  `es_gam`). Los cierres del día de sus mensajeros tienen destino `bodega_central`.
- **Etiqueta legible**: el texto que la pantalla muestra a una persona («Entregada»), por
  oposición al valor interno del enum (`entregada`).
- **Celda vacía**: ausencia de valor en la hoja. NO es `"—"`, que es un marcador de pantalla.

---

## A. Alcance y conservación de lo existente

**R1** — El sistema DEBE ofrecer, en el listado de «Cierres del día» del admin, un control de
descarga DETALLADA **adicional** al control de descarga general que ya existe.

**R2** — El sistema DEBE conservar sin cambios la descarga general de cada listado de cierres:
mismas columnas, mismo orden, mismo conjunto de filas, mismo nombre de archivo y mismo nombre
accesible del control.

**R3** — El sistema DEBE conservar las CINCO descargas por sección del detalle de un cierre:
ninguna se retira, ninguna cambia sus columnas ni su orden, y las constantes y el helper de la
marca de evidencia que usan DEBEN seguir existiendo sin cambios.

**R4** — CUANDO el actor use un control de descarga detallada, el sistema NO DEBE modificar el
estado de la pantalla: ni la página visible, ni los filtros, ni el detalle abierto.

## B. Grano y forma del archivo detallado

**R5** — El archivo detallado DEBE contener UNA fila por GESTIÓN de los cierres del conjunto
seleccionado, y NINGUNA fila agregada por mensajero, por cierre o por resultado.

**R6** — El sistema DEBE producir UN SOLO archivo con UNA SOLA hoja para la descarga detallada,
cualquiera que sea el número de resultados distintos presentes en el conjunto.

**R7** — El archivo detallado DEBE incluir una columna «Resultado» cuyo valor identifique el
resultado de la gestión de esa fila.

**R8** — El archivo detallado DEBE incluir una columna «Mensajero» con el nombre del mensajero
dueño del cierre al que pertenece la gestión.

**R9** — El sistema DEBE emitir EXACTAMENTE las 26 columnas declaradas para el archivo
detallado, en el orden declarado, en TODAS las filas y con independencia del resultado de cada
una.

**R10** — SI una columna no aplica al resultado de una fila, ENTONCES el sistema DEBE dejar esa
celda VACÍA, y NO DEBE omitir la columna ni sustituirla por un valor de relleno.

**R11** — El sistema DEBE emitir las filas del archivo detallado en un orden DETERMINISTA: los
cierres por fecha de solicitud descendente y, dentro de cada cierre, el MISMO orden en que el
detalle de ese cierre presenta sus gestiones.

**R12** — El archivo detallado NO DEBE contener el estado del cierre ni su destino.

## C. Los bordes de lectura y el alcance por rol

**R13** — El sistema DEBE obtener las filas de cada archivo detallado EXCLUSIVAMENTE del valor
devuelto por UN ÚNICO punto de entrada de servidor por pantalla, y de ninguna otra fuente.

**R14** — El acotamiento por rol de cada conjunto detallado DEBE ser EXACTAMENTE el mismo que
el del listado de la pantalla desde la que se lanza: NINGUNA gestión perteneciente a un cierre
que el actor no vería en esa pantalla DEBE aparecer en el archivo.

**R15** — El alcance por rol NO DEBE viajar en la entrada de la petición; el sistema DEBE
resolverlo desde la SESIÓN del actor y componerlo con los recortes mediante conjunción.

**R16** — El borde que produce un archivo detallado NO DEBE reimplementar el criterio de
alcance ni el de recorte: DEBE delegarlos en el mismo servicio que resuelve los listados de esa
pantalla.

**R17** — SI la petición de un conjunto detallado llega sin sesión válida, ENTONCES el sistema
DEBE responder «no autenticado» y NO DEBE devolver fila alguna.

**R18** — SI el rol del actor no está autorizado a ver el listado desde el que se lanza la
descarga, ENTONCES el sistema DEBE responder «prohibido» y NO DEBE devolver fila alguna.

**R19** — SI la entrada de la petición incluye una clave que no pertenece a la lista blanca de
esa lectura, ENTONCES el sistema DEBE responder error de validación y NO DEBE devolver fila
alguna.

**R20** — MIENTRAS el actor sea un administrador satélite sin zona asignada, el sistema DEBE
devolver un conjunto VACÍO sin consultar la base, y NO «prohibido».

**R21** — SI el conjunto detallado supera el tope de filas configurado para las descargas,
ENTONCES el sistema DEBE responder «límite excedido» con los conteos, y NO DEBE devolver filas
ni producir un archivo truncado.

**R22** — El sistema NO DEBE firmar ninguna URL de evidencia al producir un conjunto detallado.

## D. Los dos puntos de entrada (D10)

**R23** — El sistema DEBE ofrecer el control de descarga detallada TAMBIÉN en el listado de
cierres de BODEGA del maestro.

**R24** — El archivo detallado lanzado desde cierres de bodega DEBE contener las gestiones de
los cierres del día CONSOLIDADOS en un cierre de bodega, y ninguna otra gestión.

**R25** — SI el actor que solicita el conjunto detallado de bodega no tiene acceso total,
ENTONCES el sistema DEBE responder «prohibido» y NO DEBE devolver fila alguna.

**R26** — Las dos salidas detalladas DEBEN emitir EXACTAMENTE las mismas columnas, en el mismo
orden, producidas por la MISMA declaración y la MISMA función de proyección.

**R27** — El sistema DEBE incluir en la descarga detallada las gestiones de cierres cuyo
destino es la bodega central (GAM), sin ningún tratamiento especial ni camino de código propio
para ellas.

## E. Selección del conjunto (el diálogo)

**R28** — CUANDO el actor active un control de descarga detallada, el sistema DEBE presentar un
diálogo de selección ANTES de producir archivo alguno.

**R29** — El diálogo DEBE ofrecer únicamente mensajeros pertenecientes al alcance del actor.

**R30** — El diálogo DEBE permitir seleccionar uno o varios mensajeros.

**R31** — El diálogo DEBE ofrecer un rango de fechas opcional (desde / hasta) que recorte el
conjunto por la fecha de solicitud del cierre.

**R32** — SI el rango de fechas del diálogo está invertido, ENTONCES el sistema DEBE responder
error de validación y NO DEBE producir archivo alguno.

**R33** — CUANDO el actor confirme el diálogo, el archivo DEBE contener únicamente gestiones de
cierres de los mensajeros seleccionados y dentro del rango indicado.

**R34** — El conjunto del archivo detallado DEBE determinarse EXCLUSIVAMENTE por lo elegido en
el diálogo; los filtros vigentes en la barra de la pantalla NO DEBEN afectarlo.

**R35** — El control de descarga detallada NO DEBE leer ni modificar ningún filtro de la
pantalla.

**R36** — Los valores elegidos en el diálogo DEBEN viajar como RECORTE del MISMO punto de
entrada de R13; el sistema NO DEBE abrir una consulta paralela para resolverlos.

**R37** — SI un mensajero solicitado está fuera del alcance del actor, ENTONCES el sistema DEBE
devolver CERO filas para ese mensajero, y NUNCA filas de un cierre fuera de alcance.

**R38** — El sistema DEBE responder de forma INDISTINGUIBLE al caso «el mensajero no tiene
cierres en el rango» y al caso «el mensajero está fuera del alcance del actor»: mismas cero
filas y mismo mensaje.

**R39** — SI el actor cancela el diálogo o lo confirma sin ningún mensajero seleccionado,
ENTONCES el sistema NO DEBE producir archivo alguno ni llamar al servidor.

## F. Contenido de las celdas — invariantes no negociables

**R40** — El sistema NUNCA DEBE emitir en el archivo detallado la URL de evidencia, ninguna
ruta de almacenamiento, ni NINGUNA columna derivada del dato de evidencia; el archivo detallado
NO DEBE tener columna de evidencia en absoluto.

**R41** — El conjunto que el servidor devuelve para el archivo detallado NO DEBE incluir ningún
campo de evidencia, ni siquiera derivado.

**R42** — El sistema NUNCA DEBE emitir identificadores internos de registro en el archivo
detallado (de gestión, de orden, de cierre, de cierre de bodega, de mensajero o de zona). El
identificador de negocio de la fila es el número de remisión.

**R43** — El sistema DEBE emitir todo monto como el STRING del snapshot TAL CUAL, sin
conversión numérica, sin símbolo de moneda y sin separador de miles.

**R44** — El sistema NO DEBE realizar aritmética alguna sobre los montos al producir el archivo
detallado.

**R45** — El sistema DEBE emitir el resultado, el método de pago, la causa de incidente y el
origen del rechazo como su ETIQUETA LEGIBLE, y NUNCA como el valor interno del enum.

**R46** — SI un dato de la gestión es nulo, ENTONCES la celda correspondiente DEBE quedar
VACÍA, y NUNCA contener el marcador de presentación «—».

**R47** — MIENTRAS la indemnización de una gestión de incidente no se haya capturado, la celda
de indemnización DEBE quedar VACÍA, y NUNCA valer cero.

## G. Estructura verificable (lo que hace que las guardias muerdan)

**R48** — La declaración de columnas del archivo detallado DEBE residir en un módulo cuyo
nombre siga la convención `*-descarga-columnas.ts`, junto a su función de proyección.

**R49** — El módulo de columnas del archivo detallado DEBE ser PURO: no DEBE importar React ni
tocar el DOM.

**R50** — La lista de columnas del archivo detallado DEBE estar cubierta por una aserción de
orden que la NOMBRE explícitamente.

**R51** — El nombre del archivo descargado y el nombre accesible del control DEBEN identificar
la descarga detallada y distinguirla de los demás controles de descarga de la misma pantalla.

**R52** — La documentación del módulo de las cinco declaraciones por sección NO DEBE afirmar
que no existe un archivo único que funda las cinco, y DEBE conservar la razón histórica por la
que aquella decisión se tomó.

---

## Preguntas abiertas

**Ninguna para la implementación.** Q1…Q5 quedaron cerradas por D6…D13 el 2026-08-18.

Quedan **dos notas para el humano**, que NO bloquean el arranque pero que él debe conocer
antes de aprobar. Están desarrolladas en `design.md §2.6` y `§11`:

1. **La cobertura de los dos botones es una PARTICIÓN, no una redundancia.** Verificado en el
   código: el maestro solo ve en `cierres-admin` los cierres con destino `bodega_central`
   (la GAM), y los de las bodegas satélite le llegan **únicamente** consolidados en cierres de
   bodega. Los dos botones cubren conjuntos **disjuntos** y su unión es el total. Si el humano
   esperaba que uno solo bastara, no basta. (`design.md §2.6`)
2. **El tamaño real de la feature supera `medium`.** Dos bordes de lectura, dos servicios, dos
   repositorios, un schema nuevo y un diálogo con controles propios. Se propone subir la ficha
   a `complexity: high` o partirla en dos entregas (`cierres-admin` primero, bodega después).
   (`design.md §11`)
