# Feature 151 — Descarga del dataset completo desde el DataTable · requirements

> Notación EARS estricta. Cada `R<n>` debe terminar mapeado a un test concreto (ver
> `tasks.md`). Sin detalles de implementación: el CÓMO vive en `design.md`.
>
> Alcance cerrado por el humano ANTES del spec (decisiones D1–D6, ver `design.md §0`):
> generador COMÚN e indiferente al dominio, reutilizando el generador de hojas que ya
> existe; acceso sin paginación a través del MISMO servicio que lista; prop opt-in en
> el `DataTable` que recibe una FUNCIÓN, no una url ni los filtros; columnas del export
> declaradas aparte con valor crudo; tope duro de filas con error explícito.

## Glosario

- **Dataset completo**: todas las filas que corresponden a los filtros aplicados en un
  listado para el actor autenticado, sin recorte por página.
- **Función común de descarga**: el único módulo que, dado `{tipo, título, columnas,
  filas}`, produce el contenido del archivo. No conoce dominio, filtros ni roles.
- **Columna de export**: declaración `{clave, encabezado}` cuyo valor de celda es CRUDO
  (texto, número o vacío), independiente de las columnas visibles de la tabla.
- **Tope de filas (N)**: número máximo de filas que una descarga puede producir.
- **Consumidor**: el componente que declara la descarga en su `DataTable` y aporta la
  función que obtiene las filas.

---

## A. Función común de descarga (indiferente al dominio)

**R1** — El sistema DEBE producir el contenido de CUALQUIER descarga de listado con una
única función común que recibe exclusivamente `{tipo de archivo, título, columnas,
filas}`; ningún listado DEBE construir el contenido de su archivo por su cuenta.

**R2** — DONDE la configuración de descarga no declare tipo de archivo, el sistema DEBE
producir un archivo `xlsx`.

**R3** — CUANDO el tipo de archivo sea `xlsx`, el sistema DEBE producir un libro de una
sola hoja con una fila de encabezados y una fila por elemento de `filas`, en el orden
recibido.

**R4** — CUANDO el tipo de archivo sea `csv`, el sistema DEBE producir un texto con una
línea de encabezados y una línea por elemento de `filas`, en el orden recibido, con todo
valor escapado como CSV válido (separador, comillas y saltos de línea incluidos).

**R5** — El sistema DEBE emitir exactamente las columnas declaradas y en el orden
declarado; SI una fila contiene claves no declaradas, ENTONCES esas claves NO DEBEN
aparecer en el archivo.

**R6** — SI una fila no aporta valor para una columna declarada, ENTONCES la celda
correspondiente DEBE quedar vacía, sin texto de relleno ni valor inventado.

**R7** — El sistema DEBE devolver, junto al contenido, el tipo MIME y el nombre de archivo
con la extensión que corresponde al tipo solicitado.

**R8** — El sistema DEBE usar el título recibido como nombre de la hoja (en `xlsx`) y como
base del nombre de archivo (en todo tipo).

**R9** — SI la lista de columnas está vacía, ENTONCES el sistema DEBE fallar de forma
explícita y NO DEBE producir archivo alguno.

**R10** — La función común NO DEBE depender del DOM ni de React, de modo que pueda
ejercitarse sin navegador.

## B. Acceso al dataset completo (sin paginación)

**R11** — El sistema DEBE ofrecer un modo de lectura que devuelve el dataset completo
correspondiente a un conjunto de filtros, sin recorte por página.

**R12** — MIENTRAS el actor tenga un rol acotado (administrador de tienda o mensajero), el
sistema DEBE limitar el dataset completo EXACTAMENTE al mismo subconjunto de filas que el
listado paginado devuelve a ese actor con los mismos filtros.

**R13** — SI la petición del dataset completo llega sin sesión válida, ENTONCES el sistema
DEBE responder «no autenticado» y NO DEBE devolver fila alguna.

**R14** — SI el rol del actor no está autorizado a listar, ENTONCES el sistema DEBE
responder «prohibido» y NO DEBE devolver fila alguna.

**R15** — SI la petición del dataset completo incluye una clave de filtro que no pertenece
a la lista blanca del listado, ENTONCES el sistema DEBE responder error de validación y NO
DEBE devolver fila alguna.

**R16** — El sistema NO DEBE permitir que un filtro amplíe el alcance del rol: el
acotamiento por rol DEBE prevalecer sobre cualquier valor de filtro recibido.

**R17** — El sistema DEBE devolver el dataset completo con el mismo criterio de ordenación
(campo y dirección) que aplica el listado paginado para esos mismos parámetros.

**R18** — El sistema DEBE excluir del dataset completo las mismas filas que el listado
paginado excluye por borrado lógico.

## C. Tope duro de filas

**R19** — El sistema DEBE aplicar un tope máximo de filas `N` a toda descarga de dataset
completo, siendo `N` configurable por entorno.

**R20** — SI el dataset completo supera `N` filas, ENTONCES el sistema NO DEBE producir
archivo y DEBE devolver un error accionable que indique el total encontrado, el tope
vigente y la instrucción de acotar los filtros.

**R21** — El sistema NUNCA DEBE entregar un archivo con el dataset truncado en silencio:
todo archivo entregado contiene el dataset completo pedido.

**R22** — CUANDO una petición se rechace por superar el tope, el sistema NO DEBE
materializar ni transportar más de `N + 1` filas.

**R23** — SI el dataset completo tiene cero filas, ENTONCES el sistema NO DEBE producir
archivo y DEBE informar que no hay datos que descargar.

## D. Enganche en el `DataTable`

**R24** — DONDE el consumidor declare la configuración de descarga, la tabla DEBE
renderizar un control de descarga; SI no la declara, ENTONCES la tabla NO DEBE renderizar
control alguno y DEBE comportarse igual que antes de esta feature.

**R25** — CUANDO el usuario active el control de descarga, el sistema DEBE invocar la
función de obtención de filas provista por el consumidor, pasar su resultado a la función
común de descarga y entregar el archivo resultante al usuario.

**R26** — MIENTRAS una descarga esté en curso, el control DEBE indicar el estado de carga
y NO DEBE admitir una segunda ejecución simultánea.

**R27** — SI la obtención de filas falla o devuelve un error, ENTONCES el sistema DEBE
mostrar un mensaje accionable y NO DEBE entregar archivo alguno.

**R28** — DONDE la configuración declare más de un tipo de archivo, el sistema DEBE
permitir al usuario elegir entre los tipos declarados; SI declara uno solo o ninguno,
ENTONCES DEBE descargar directamente en ese tipo (o en `xlsx` por defecto) sin pedir
elección.

**R29** — La tabla NO DEBE recibir ni interpretar filtros, urls ni parámetros de consulta:
su único insumo de descarga son el título, las columnas de export, la función de obtención
de filas y los tipos permitidos.

**R30** — El control de descarga DEBE exponer un nombre accesible que lo identifique.

**R31** — CUANDO se ejecute una descarga, el sistema NO DEBE alterar la página actual, la
selección de filas ni los datos visibles de la tabla.

**R32** — El archivo generado NO DEBE subirse a ningún servidor ni almacenarse fuera del
equipo del usuario.

## E. Primer consumidor: listado de órdenes

**R33** — El listado de órdenes DEBE ofrecer la descarga del dataset completo
correspondiente a los filtros aplicados en ese momento.

**R34** — CUANDO se descargue desde el listado de órdenes, el archivo DEBE contener una
fila por orden del dataset completo, y no solo las de la página visible.

**R35** — El archivo del listado de órdenes DEBE contener valores CRUDOS (texto, número o
celda vacía) en todas sus celdas, sin elementos de interfaz (insignias, botones o iconos).

**R36** — CUANDO cambien los filtros del listado de órdenes, la siguiente descarga DEBE
reflejar los filtros vigentes en el momento de descargar.

**R37** — El nombre del archivo descargado desde el listado de órdenes DEBE identificar el
listado y la fecha de la descarga.

**R38** — El listado paginado de órdenes existente DEBE seguir comportándose igual que
antes de esta feature cuando no se usa la descarga (mismos datos, misma paginación, mismos
filtros).

---

## Fuera de alcance (explícito)

- El despliegue de la descarga a las ~30 tablas restantes de la aplicación: es la feature
  145 y NO se implementa aquí. Esta feature entrega la CAPACIDAD y su primer consumidor.
- Formatos distintos de `xlsx` y `csv` (PDF, JSON).
- Descargas asíncronas (encolar, generar en background, notificar por correo) para
  datasets por encima del tope: el tope es un error accionable, no una cola.
- Selección de columnas por el usuario en tiempo de ejecución.

---

## Preguntas abiertas (para la puerta de aprobación humana)

**P1 — Valor de `N` (tope de filas).** `design.md §6` propone `N = 5000`, configurable por
`DESCARGA_MAX_FILAS`, con su justificación contra `ORDENES_MAX_PAGE_SIZE` (100) y el peso
real de una fila del listado. Se necesita confirmación o un valor alternativo. Si el peso
medido de la fila resultara mayor al estimado, la salida natural es bajar `N` a 2000 (ver
P2), no truncar.

**P2 — ¿Filas completas o proyección?** El diseño propone devolver el MISMO DTO que ya
devuelve el listado (sin mapeo nuevo, sin duplicar la consulta) y proyectar a las columnas
de export en el cliente. La alternativa es que el servidor devuelva solo las columnas
declaradas, lo que reduce el tamaño de la respuesta pero mete conocimiento de export en el
backend y rompe la simetría con las features 143/148. Decisión propuesta: DTO completo.
Se pide confirmación.

**P3 — Cómo viaja el resultado (punto abierto que el humano dejó marcado).** El diseño
(`design.md §3`) RESUELVE que no viaja binario alguno: el servidor devuelve FILAS por
Server Action y el binario se arma en el NAVEGADOR, como ya hacen las features 143 y 148.
Con ello, la disyuntiva «base64 por Server Action vs. Route Handler con streaming» queda
sin objeto. Se pide ratificación de esa resolución, porque implica NO abrir un route
handler interno para descargas (hoy `app/api/` es solo cron, webhooks, API pública y el
chunk de carga masiva).

**P4 — Ubicación del control en el listado de órdenes.** Se propone que el `DataTable`
renderice el control encima de la tabla, junto al resto de acciones de contenedor. Falta
confirmar si el humano lo quiere ahí o en la barra de filtros de la feature 144.

**P5 — Roles con acceso a la descarga.** El diseño NO añade un permiso nuevo: quien puede
ver el listado puede descargar lo que ese listado ya le muestra (el acotamiento por rol lo
impone el mismo servicio, R12/R16). Si se quisiera restringir la descarga a
`maestro`/`admin`, es un requisito adicional que hoy NO está escrito y habría que añadirlo.

---

## Gate F1.4 — APROBADO por el humano el 2026-07-29

Las cinco preguntas abiertas se cierran con la propuesta del spec **tal cual**, sin cambios
de alcance. Queda fijado:

- **P1 — Tope de filas: N = 5000**, configurable por la variable de entorno
  `DESCARGA_MAX_FILAS`. Al superarlo la acción NO genera archivo y devuelve el error
  accionable que pide acotar los filtros. Nunca truncado silencioso.
- **P2 — La Server Action devuelve el DTO completo del listado** (`OrdenListItemDTO`), sin
  proyección server-side: cero mapeo nuevo y cero divergencia con el listado. El cliente
  decide qué columnas emite.
- **P3 — RATIFICADO:** no viaja binario y NO se abre un route handler interno para
  descargas. El servidor devuelve filas por Server Action y el binario se arma en el
  navegador, igual que las features 143 y 148.
- **P4 — El control va encima de la tabla**, dentro de `DataTable`, para que el rollout de
  la feature 145 lo herede aunque la tabla no tenga barra de filtros.
- **P5 — Sin permiso nuevo:** quien ve el listado descarga lo que ese listado ya le muestra,
  acotado por rol/zona por el mismo servicio (R12/R16). No se añade requisito de roles.
