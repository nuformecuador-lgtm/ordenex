# Feature 170 — Descarga a Excel en todas las tablas (+ paginación de las que hoy no paginan) · requirements

> Notación EARS estricta. Cada `R<n>` debe terminar mapeado a un test concreto (ver
> `tasks.md § Trazabilidad`). Sin detalles de implementación: el CÓMO vive en `design.md`.
>
> **Pedido del humano (2026-07-31):** «toda tabla debe poderse descargar sus datos en un
> excel, y veo que hay muchas tablas que aún no tienen esta funcionalidad».
>
> **Hallazgo que origina la feature** (verificado contra el código, `design.md §1`): la
> capacidad ya existe y está bien hecha —la feature **151** la construyó como prop opt-in del
> `DataTable`, con acceso al dataset completo **sin paginación** y **server-side**—, pero de
> las **25 tablas dentro de alcance solo 1 la activa** (el listado de órdenes).
>
> **AMPLIACIÓN DE ALCANCE del 2026-07-31 (decisión del HUMANO en la puerta de aprobación):**
> al responder la pregunta abierta **P6**, el humano decidió **paginar server-side las 16
> pantallas de Familia B DENTRO de esta misma feature**, en vez de registrarlo como ticket
> aparte, sabiendo que convierte un rollout mecánico en una reescritura mucho mayor. La
> feature pasa a cubrir **dos cosas**: el rollout del export a 25 tablas Y el paso a
> paginación server-side de las que hoy reciben su dataset entero por props.

---

## Decisiones RATIFICADAS en la puerta (2026-07-31) — no se reabren

El implementador NO debe volver a plantear ninguna de éstas.

| # | Pregunta | Respuesta del humano |
| --- | --- | --- |
| **P1** | ¿Se cablea la tabla de premios del podio del ranking? | **NO.** Queda fuera: es `<table>` HTML cruda, 3 filas de configuración, no un listado de datos. |
| **P2** | Detalle de un cierre: ¿un control por sección o uno por cierre? | **UNA DESCARGA POR SECCIÓN.** Se respeta el contrato de la 151 (el control vive dentro del `DataTable`). |
| **P3** | ¿Las tres tablas del asistente de carga masiva quedan fuera? | **SÍ, fuera.** Ese flujo ya tiene dos descargas (143 errores, 148 manifiesto). |
| **P4** | Módulo de zonas huérfano | **Se deja como está** y se registra aparte. Fuera del rollout. |
| **P5** | ¿Tope único o tope por tabla? | **TOPE ÚNICO** de 5000 filas (`DESCARGA_MAX_FILAS`), heredado de la 151. |
| **P6** | Riesgo heredado de Familia B (16 pantallas sin paginar) | **SE PAGINAN DENTRO DE ESTA FEATURE.** Origen de la PARTE 2 de este documento. |
| **P7** | ¿`xlsx` solamente, o también `csv`? | **Solo `xlsx`.** Sin menú de formato. |
| **P8** | ¿Permiso nuevo para descargar? | **SIN PERMISO NUEVO.** Quien ve la tabla puede descargarla, incluidas las de dinero. |

---

## Glosario

- **Listado**: superficie que presenta un conjunto de registros en forma de tabla.
- **Dataset completo**: todas las filas que corresponden a los filtros vigentes de un listado
  **para el actor autenticado**, sin recorte por página.
- **Familia A**: listado cuya página visible es un RECORTE server-side del dataset.
- **Familia B**: listado que hoy recibe su dataset completo (no hay paginación server-side).
- **Columna de export**: declaración `{clave, encabezado}` cuyo valor de celda es CRUDO.
- **Tope (N)**: número máximo de filas que una descarga puede producir.
- **Campo prohibido**: dato que NUNCA puede aparecer en un archivo descargado (§D).
- **Contador de cabecera**: el número entre paréntesis que algunas pantallas muestran junto al
  título de una sección (p. ej. «Pendientes de decisión (7)»).

---

# PARTE 1 — Descarga a Excel

## A. Alcance del rollout

**R1** — El sistema DEBE ofrecer un control de descarga en CADA UNO de los listados declarados
dentro de alcance en el Anexo I.

**R2** — DONDE un listado esté declarado FUERA de alcance en el Anexo II, el sistema NO DEBE
renderizar en él control de descarga alguno.

**R3** — El sistema DEBE conservar sin cambios el comportamiento previo de cada listado al
añadirle la descarga: mismos datos, misma paginación, mismos filtros, mismas acciones y mismo
estado vacío.

**R4** — CUANDO se añada un listado tabular nuevo a la aplicación, el sistema DEBE fallar una
comprobación automatizada si ese listado no declara descarga ni queda registrado como
exclusión justificada.

## B. Contrato de export por listado

**R5** — Cada listado con descarga DEBE declarar sus columnas de export ENUMERADAS UNA A UNA,
independientes de las columnas visibles de la tabla.

**R6** — SI el conjunto de datos de origen de un listado gana un campo nuevo, ENTONCES el
archivo NO DEBE emitir ese campo mientras no se declare explícitamente como columna de export.

**R7** — El sistema DEBE emitir en toda celda un valor CRUDO (texto, número o celda vacía);
NINGÚN archivo DEBE contener elementos de interfaz (insignias, botones, iconos) ni
representaciones de objeto.

**R8** — El sistema DEBE emitir los identificadores de entidades relacionadas como su NOMBRE
legible, no como su identificador interno.

**R9** — El archivo de un listado DEBE contener una fila por elemento del dataset completo, y
no solo por elemento de la página visible.

**R10** — CUANDO cambien los filtros de un listado, la siguiente descarga DEBE reflejar los
filtros vigentes en el momento de pulsar el control.

**R11** — El sistema DEBE emitir las filas del archivo en el MISMO orden en que el listado las
presenta para esos mismos parámetros.

**R12** — El nombre del archivo descargado DEBE identificar el listado de origen y la fecha de
la descarga.

**R13** — El control de descarga de cada listado DEBE exponer un nombre accesible que
identifique el listado al que pertenece.

## C. Alcance por rol en la exportación

**R14** — MIENTRAS el actor tenga un rol acotado, el archivo DEBE contener EXACTAMENTE el
mismo subconjunto de filas que ese listado le muestra con los mismos filtros; NUNCA una fila
que el listado no le mostraría.

**R15** — El sistema NO DEBE permitir que un valor de filtro amplíe el alcance del rol: el
acotamiento por rol DEBE prevalecer sobre cualquier filtro recibido.

**R16** — SI la petición del dataset completo llega sin sesión válida, ENTONCES el sistema DEBE
responder «no autenticado» y NO DEBE devolver fila alguna.

**R17** — SI el rol del actor no está autorizado a ver ese listado, ENTONCES el sistema DEBE
responder «prohibido» y NO DEBE devolver fila alguna.

**R18** — SI la petición del dataset completo incluye una clave de filtro que no pertenece a la
lista blanca de ese listado, ENTONCES el sistema DEBE responder error de validación y NO DEBE
devolver fila alguna.

**R19** — El sistema DEBE excluir del archivo las mismas filas que el listado excluye por
borrado lógico o por estado.

**R20** — El acotamiento por rol DEBE verificarse LISTADO POR LISTADO; una verificación
genérica del mecanismo NO satisface este requisito.

## D. Datos sensibles

**R21** — El sistema NUNCA DEBE emitir en un archivo descargado: hashes de credenciales,
contraseñas, claves de API en claro, secretos de webhook, ni códigos o tokens de un solo uso.

**R22** — El sistema NO DEBE emitir rutas de almacenamiento ni URL firmadas de evidencia
fotográfica.

**R23** — El sistema NO DEBE emitir identificadores internos de registro, salvo cuando ese
identificador ES el identificador de negocio que el listado ya muestra al actor.

**R24** — El sistema NO DEBE emitir en el archivo ningún campo que el listado no muestre a ese
actor en pantalla.

**R25** — El sistema DEBE verificar la ausencia de campos prohibidos con una comprobación
automatizada que se aplique a TODAS las declaraciones de columnas de export, presentes y
futuras.

## E. Volumen

**R26** — El sistema DEBE aplicar un tope máximo de filas `N` a TODA descarga de la aplicación,
configurable por entorno y ÚNICO para todos los listados.

**R27** — SI el dataset completo de un listado supera `N` filas, ENTONCES el sistema NO DEBE
producir archivo y DEBE devolver un error accionable que indique el total encontrado, el tope
vigente y qué hacer para acotarlo.

**R28** — El sistema NUNCA DEBE entregar un archivo con el dataset truncado en silencio: todo
archivo entregado contiene el dataset completo pedido.

**R29** — El sistema DEBE aplicar el tope en el SERVIDOR y, cuando lo supere, NO DEBE
materializar ni transportar más de `N + 1` filas.

**R30** — MIENTRAS un listado no haya pasado a paginación server-side, su descarga NO DEBE
ejecutar una segunda lectura del origen de datos: DEBE construirse sobre el dataset que la
pantalla ya tiene.

**R31** — SI el dataset completo tiene cero filas, ENTONCES el sistema NO DEBE producir archivo
y DEBE informar que no hay datos que descargar.

**R32** — El sistema NO DEBE aumentar el número de consultas que un listado ejecuta mientras el
usuario no pulse el control de descarga.

## F. Consistencia de la experiencia

**R33** — El sistema DEBE producir el contenido de TODA descarga con la única función común ya
existente; NINGÚN listado DEBE construir el contenido de su archivo por su cuenta.

**R34** — El sistema DEBE producir un archivo `xlsx` en todos los listados; NINGÚN listado DEBE
ofrecer al usuario elección de formato.

**R35** — MIENTRAS una descarga esté en curso, el control DEBE indicar el estado de carga y NO
DEBE admitir una segunda ejecución simultánea.

**R36** — SI la obtención de filas falla, ENTONCES el sistema DEBE mostrar un mensaje
accionable, ese mensaje NO DEBE contener datos personales, y NO DEBE entregarse archivo alguno.

**R37** — CUANDO se ejecute una descarga, el sistema NO DEBE alterar la página actual, la
selección de filas ni los datos visibles del listado.

**R38** — El archivo generado NO DEBE subirse a ningún servidor ni almacenarse fuera del equipo
del usuario.

## G. Entrega por tandas

**R39** — MIENTRAS el rollout esté incompleto, el sistema DEBE seguir funcionando: los listados
ya cableados descargan y los aún no cableados se comportan exactamente como antes.

---

# PARTE 2 — Paginación server-side (decisión P6 del humano, 2026-07-31)

## H. Paginación de los listados que hoy entregan el dataset entero

**R40** — El sistema DEBE entregar cada listado del Anexo III en páginas resueltas en el
SERVIDOR, con un tamaño de página máximo acotado por configuración.

**R41** — El sistema DEBE devolver, junto a cada página, el TOTAL de filas que corresponden a
los filtros aplicados y al alcance del actor.

**R42** — DONDE una pantalla muestre un contador de cabecera junto a un listado paginado, el
sistema DEBE mostrar el TOTAL devuelto por el servidor y NUNCA el número de filas de la página
visible.

**R43** — MIENTRAS un listado esté paginado, el sistema DEBE ofrecer un control de navegación
entre páginas con su nombre accesible.

**R44** — El acotamiento por rol de un listado paginado DEBE ser EXACTAMENTE el mismo que el
del listado sin paginar al que sustituye: NINGUNA fila que el actor no viera antes DEBE
hacerse visible por el cambio.

**R45** — SI un listado resolvía sus filtros en el cliente, ENTONCES el sistema DEBE resolverlos
en el servidor, y para los mismos valores de filtro el conjunto resultante DEBE ser el mismo
que producía el filtro de cliente.

**R46** — DONDE las opciones de un filtro se derivaran del conjunto completo de filas, el
sistema DEBE seguir ofreciendo TODAS esas opciones y NO DEBE reducirlas a las presentes en la
página visible.

**R47** — MIENTRAS un listado paginado admita selección de filas, la selección DEBE acotarse a
la página visible, y el control de «seleccionar todo» DEBE marcar exactamente las filas de esa
página.

**R48** — SI una acción de lote se ofrece o se oculta según el contenido del listado, ENTONCES
la decisión DEBE tomarse sobre las filas SELECCIONADAS y no sobre el conjunto completo.

**R49** — El sistema DEBE conservar todo total o monto agregado que la pantalla muestra hoy,
calculado sobre el conjunto COMPLETO y nunca sobre la página visible.

**R50** — CUANDO el usuario cambie de página, el sistema NO DEBE alterar los totales agregados,
los avisos de bloqueo ni el estado de los formularios de esa pantalla.

**R51** — El sistema DEBE conservar el criterio de ordenación que cada listado presenta hoy.

**R52** — CUANDO un listado pase a paginado, su descarga DEBE seguir entregando el dataset
COMPLETO y no la página visible.

**R53** — DONDE un listado esté declarado en el Anexo IV, el sistema DEBE seguir entregándolo
completo, sin paginar.

**R54** — El sistema NO DEBE aumentar el número de consultas que un listado ejecuta por render
respecto a su versión sin paginar, salvo la consulta de conteo que R41 exige.

---

## Anexo I — Listados DENTRO de alcance del EXPORT (25)

| # | Listado | Rol que lo ve | Familia | Pagina hoy | ¿Pasa a paginar? |
| --- | --- | --- | --- | --- | --- |
| 1 | Órdenes (listado principal) | maestro · admin · adminTienda | A | sí | ya |
| 2 | Apartado de órdenes por estado | maestro · admin | A | sí | ya |
| 3 | Órdenes de la bodega satélite | adminSatelite | B | **no** | **sí** |
| 4 | Usuarios | maestro | A | sí | ya |
| 5 | Plantillas de mensaje | maestro | A | sí | ya |
| 6 | API keys | maestro | A | sí | ya |
| 7 | Libro de movimientos de la caja principal | maestro · admin | A | sí | ya |
| 8 | Desglose de pagos por cierre de un mensajero | maestro · admin | A | sí | ya |
| 9 | Desglose de movimientos de la tienda | adminTienda | A | sí | ya |
| 10 | Desglose de pagos del mensajero | mensajero | A | sí | ya |
| 11 | Plantillas de gasto fijo | maestro · admin | B | **no** | **sí** |
| 12 | Saldos de tiendas | maestro · admin | B | **no** | **sí** |
| 13 | Cuentas por pagar a mensajeros | maestro · admin | B | **no** | **sí** |
| 14 | Cierres del día pendientes de decisión | maestro · admin · adminSatelite | B | **no** | **sí** |
| 15 | Cierres del día — histórico | maestro · admin · adminSatelite | B | **no** | **sí** |
| 16 | Cierres de bodega pendientes | maestro · admin | B | **no** | **sí** |
| 17 | Cierres de bodega resueltos | maestro · admin | B | **no** | **sí** |
| 18 | Cierres del día a consolidar | adminSatelite | B | **no** | **sí** |
| 19 | Cierres de bodega solicitados | adminSatelite | B | **no** | **sí** |
| 20 | Gestiones de un cierre por resultado (detalle) | maestro · admin · adminSatelite | B | **no** | **NO — Anexo IV** |
| 21 | Gestiones del cierre del día por resultado | mensajero | B | **no** | **NO — Anexo IV** |
| 22 | Cierres solicitados por el mensajero | mensajero | B | **no** | **sí** |
| 23 | Incidentes pendientes de decisión | maestro · admin · adminSatelite | B | **no** | **sí** |
| 24 | Incidentes — histórico | maestro · admin · adminSatelite | B | **no** | **sí** |
| 25 | Ranking del día | maestro · admin · mensajero | B | **no** | **NO — Anexo IV** |

## Anexo II — Listados FUERA del EXPORT (6) y por qué

| Listado | Motivo de la exclusión |
| --- | --- |
| Zonas (módulo de configuración) | **No está montado en ninguna página** (P4 ratificada). |
| Órdenes por numerar (modal «Generar guía») | Confirmación efímera; el mismo modal ya entrega el manifiesto `xlsx` del lote (148). |
| Resumen de carga masiva | Ya ofrece el manifiesto `xlsx` del lote (148). |
| Órdenes con error (previsualización) | Ya tiene su propia descarga `xlsx` (143). |
| Órdenes ya existentes (previsualización) | Paso de un asistente sobre un archivo aún no cometido (P3 ratificada). |
| Premios del podio (ranking) | `<table>` HTML cruda, 3 filas de configuración (P1 ratificada). |

## Anexo III — Listados que PASAN a paginación server-side (13)

Órdenes de la bodega satélite · Plantillas de gasto fijo · Saldos de tiendas · Cuentas por
pagar a mensajeros · Cierres del día pendientes · Cierres del día histórico · Cierres de
bodega pendientes · Cierres de bodega resueltos · Cierres del día a consolidar · Cierres de
bodega solicitados · Cierres solicitados por el mensajero · Incidentes pendientes · Incidentes
histórico.

## Anexo IV — Listados que se PROPONE no paginar, y por qué (3)

Se declara AHORA, no se descubre pantalla por pantalla. El detalle técnico de cada ruptura
está en `design.md §11.3`. **Sujeto a Q1.**

| Listado | Por qué paginarlo lo rompe de forma inaceptable |
| --- | --- |
| **Ranking del día** | La POSICIÓN y los OCUPANTES del podio (puestos 1-3) se derivan del conjunto completo; en la página 2 la tarjeta de premios se quedaría «sin ocupante». Además un ranking paginado deja de ser un ranking: su valor es ver el orden completo. El conjunto está acotado por el nº de mensajeros activos, no crece sin techo. |
| **Gestiones del cierre del día por resultado (mensajero)** | Es una vista AGRUPADA en cuatro listas simultáneas; paginar exigiría cuatro consultas más cuatro conteos por render. La sección se OCULTA cuando su grupo está vacío y el encabezado lleva el conteo del grupo: ambas cosas dejan de ser ciertas por página. El conjunto está acotado por la jornada de UN mensajero. |
| **Gestiones de un cierre por resultado (detalle del admin)** | Mismo problema agrupado, agravado por vivir dentro de un modal de detalle de UN cierre. El conjunto está acotado por la jornada de UN mensajero. |

---

## Fuera de alcance (explícito)

- **Búsqueda y filtros NUEVOS** en esas tablas: son la feature 145 (que depende de 144/169).
  Esta feature solo mueve al servidor los filtros que YA existen (R45); no añade ninguno.
- **Reabrir cualquier decisión de la 151** ni cualquiera de las 8 preguntas ya ratificadas.
- **Descargas asíncronas** para datasets por encima del tope.
- **Selección de columnas por el usuario** en tiempo de ejecución.
- **Formatos distintos de `xlsx`** (P7 ratificada).

---

## Preguntas abiertas (NUEVAS, nacidas de la decisión P6)

Las 8 anteriores están CERRADAS (ver «Decisiones ratificadas»). Estas son nuevas.

**Q1 — ¿Se acepta el Anexo IV?** Se propone dejar SIN paginar 3 de los 16 listados (ranking y
las dos vistas agrupadas de gestiones de cierre), con el argumento de que paginarlos rompe su
significado y sus conjuntos están acotados por entidad o por jornada, no por el paso del
tiempo. Si el humano quiere las 16 sin excepción, hay que decidir además qué se hace con el
podio del ranking y con los contadores por grupo.

**Q2 — Tamaño de página por defecto de los 13 listados nuevos.** Se propone reusar el patrón
vigente (opciones 10/25/50, `DEFAULT_PAGE_SIZE` y `MAX_PAGE_SIZE` por configuración de cada
dominio, como ya hacen órdenes, usuarios, plantillas y API keys). ¿Se confirma, o se quiere un
único tamaño para todos?

**Q3 — Orden de entrega entre las dos partes.** El diseño propone entregar **primero el export
completo** (fase 1, 8 tandas) y **después la paginación** (fase 2, 6 tandas), porque el pedido
literal del humano era el Excel «ya» y la paginación no lo bloquea. El coste de ese orden es
un retoque de una línea por tabla al paginar (`design.md §11.5`). La alternativa —paginar
antes de exportar— retrasa el Excel varias semanas. ¿Se confirma el orden?

**Q4 — Verificación en pantalla de las dos pantallas de riesgo alto.** Bodega satélite y
cuentas por pagar cambian comportamiento visible para el `adminSatelite` y para los roles de
acceso total. Los tests cubren la lógica, no la experiencia. ¿El humano las revisa en pantalla
antes de mergear esas tandas, o basta con la suite?

**Q5 — Filtros de la bodega satélite al pasar a servidor.** Hoy las opciones de cantón y
distrito se construyen a partir de las órdenes CARGADAS. Al paginar hace falta una fuente de
opciones independiente del recorte. Existe el precedente exacto de la feature 144 para
`/ordenes` (`lib/actions/filtros-ordenes.ts`). ¿Se reusa esa vía o se prefiere otra?
