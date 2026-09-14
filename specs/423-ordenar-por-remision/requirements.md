# 423 — Ordenar las tablas de órdenes por número de remisión · Requisitos

> Pedido humano (2026-09-14): «En las tablas de órdenes quieren ordenar las columnas no solo por
> antigüedad sino también por número de remisión.»
>
> Notación EARS. Cada `R<n>` está mapeado a un test concreto en `tasks.md`.
> Alcance cerrado por el humano: **solo `/ordenes`**. Los listados planos por rol (mensajero,
> adminSatélite, adminTienda) y el histórico quedan fuera (ver R15).

## Contexto medido que los requisitos dan por cierto

`orden.num_remision` es TEXT. Sobre 2.136 órdenes vivas en producción (2026-09-14):

| Formato | Cantidad |
| --- | --- |
| Solo dígitos, 5 caracteres (`72912`…`73636`) | 437 |
| `NA-001` … `NA-1863` (mezcla de 3 y 4 dígitos) | 1.664 |
| `SC-008` … `SC-050` | 29 |
| `BS-00001` … `BS-00010` | 9 |

Con orden lexicográfico, 1.582 de las 1.664 remisiones `NA-` quedan fuera de sitio: hoy
`ORDER BY num_remision` produce `NA-1067, NA-1068, NA-1069, NA-107, NA-1070, NA-1071`.

---

## Requisitos

### El control

**R1.** El sistema DEBE ofrecer en la barra de filtros de `/ordenes`, visible sin desplegar
nada, la elección entre ordenar por **fecha de creación** y ordenar por **número de remisión**,
y no ofrecer ningún otro campo.

**R2.** CUANDO el usuario elija ordenar por número de remisión, el sistema DEBE reordenar el
**conjunto completo** de órdenes que cumplen los filtros vigentes, no solo las filas de la
página visible.

**R9.** CUANDO el usuario, con el orden por número de remisión puesto, cambie la dirección, el
sistema DEBE devolver el listado en el sentido opuesto exacto (la primera fila del sentido
ascendente pasa a ser la última del descendente, con los mismos filtros y el mismo total).

**R10.** CUANDO el usuario cambie el campo de ordenamiento, el sistema DEBE conservar la
dirección que estuviera puesta.

**R11.** CUANDO el usuario cambie el campo de ordenamiento, el sistema DEBE volver a la
página 1 del listado.

**R12.** CUANDO el usuario cambie el campo de ordenamiento, el sistema DEBE pedir el listado de
nuevo y NO DEBE mostrar el resultado que había obtenido para el otro campo.

**R14.** SI la página visible contiene al menos una orden prioritaria, ENTONCES el sistema DEBE
mostrar la nota que explica por qué esas órdenes van primero, y esa nota DEBE nombrar el campo
de ordenamiento **vigente** (no un campo fijo).

**R20.** SI el orden vigente es por número de remisión Y la página visible contiene remisiones de
**más de una serie**, ENTONCES el sistema DEBE mostrar una línea que explique que las remisiones
se agrupan por serie. MIENTRAS la página visible contenga remisiones de **una sola serie**, o
MIENTRAS el orden vigente sea por fecha de creación, esa línea NO DEBE aparecer.

### El orden

**R3.** El sistema DEBE ordenar por número de remisión de forma **natural**: dentro de una
misma serie, por el valor numérico y no por el texto. En sentido ascendente, `NA-107` DEBE
aparecer antes que `NA-1069`, y `NA-1069` antes que `NA-1070`.

**R4.** El sistema DEBE agrupar las remisiones por serie, y el orden ascendente de las series
DEBE ser: primero las **puramente numéricas** (`72912`…`73636`), luego `BS-`, luego `NA-`,
luego `SC-`.

**R6.** El sistema DEBE producir el **mismo** orden por número de remisión en cualquier entorno
en que se ejecute (base local y base de producción), sin depender del locale, del ctype ni de
la collation por defecto de la base.

**R7.** MIENTRAS el orden vigente sea por número de remisión, el sistema DEBE seguir colocando
las órdenes con `prioridad` por delante de todas las demás, tal como hace con el orden por
fecha de creación (feature 101/R6, decisión de producto vigente).

**R8.** MIENTRAS el orden vigente sea por número de remisión, el sistema DEBE garantizar que
recorrer todas las páginas del listado devuelve cada orden **exactamente una vez**: ninguna
repetida, ninguna perdida, incluso cuando varias órdenes comparten la misma clave de orden.

**R13.** MIENTRAS el orden vigente sea por número de remisión, el archivo que produce la
descarga del listado DEBE salir en el **mismo orden** que la pantalla: la fila N del archivo es
la fila N de la pantalla.

### Que no rompa nada

**R5.** CUANDO se cree una orden —por alta manual, por carga masiva o por API— cuyo número de
remisión no encaje en el patrón `<prefijo><número>` (por ejemplo `SIN NUMERO`, `---`, `NA-`,
una cadena con emoji o un número de más de 18 dígitos), el sistema DEBE crear la orden
igualmente, sin error y sin bloquear el resto del lote.

**R15.** El sistema NO DEBE cambiar el orden en que se presentan las órdenes en ninguna
superficie que no sea `/ordenes`: ni los listados planos por rol (mensajero, adminSatélite,
adminTienda), ni el histórico, ni la recepción de bodega satélite, ni la API por clave.

**R16.** El sistema NO DEBE exponer la clave interna de ordenamiento por remisión en ninguna
respuesta del listado, en ningún DTO ni en el archivo descargado.

**R17.** El sistema DEBE calcular la clave de ordenamiento por remisión **sin que ninguna
escritura de la aplicación la fije**: ni en el alta manual, ni en la carga masiva, ni en la API,
ni en un backfill posterior. Un intento de escribirla DEBE ser rechazado por la base.

**R18.** El sistema NO DEBE ampliar el contrato público del listado: el conjunto de valores
admitidos en `sortBy` DEBE seguir siendo exactamente `created_at`, `num_guia` y `num_remision`,
y una clave fuera de ese conjunto DEBE seguir respondiendo `validation_error`.

**R19.** El sistema DEBE poder revertirse al estado anterior a esta feature sin pérdida de datos
de negocio: revertir DEBE dejar `orden` sin la columna nueva ni su índice, y no DEBE modificar
ni una fila de `num_remision`.

---

## Decisiones cerradas (humano, 2026-09-14)

Las cuatro dudas que esta spec levantó antes de aprobarse están **resueltas**. Se dejan escritas
con su motivo para que nadie las reabra como si siguieran vivas.

1. **El aviso de agrupación por serie: SÍ, y condicionado.** Es **R20**, arriba. El orden
   ascendente deja `72912…, BS-…, NA-…, SC-…`, que es correcto pero no evidente: quien pidió
   «ordenar por remisión» ve primero un bloque de números sueltos y después tres bloques con
   letra, y la conclusión natural es que el control hizo algo raro. Va **condicionado** por el
   mismo criterio exacto que `NOTA_PRIORIDAD` (ficha 356): la nota solo se pinta cuando el
   fenómeno **se puede observar**. Con una sola serie en pantalla no hay agrupación que explicar,
   y anunciar ahí una regla invisible es ruido que además obliga a preguntar «¿qué es una serie?».

2. **Al cambiar de campo, la dirección se CONSERVA.** R10 se queda exactamente como está. El
   control de dirección está **a la vista** junto al de campo, así que quien quiera invertir el
   sentido lo tiene a un clic; mover dos cosas a la vez —campo y dirección— haría que un solo clic
   produjera dos cambios que el usuario no pidió, y el segundo sería invisible hasta mirar el
   listado. Consecuencia asumida: quien venga de «Más recientes» (`desc`, el default vigente del
   contrato) cae en «remisiones más altas primero».

3. **Plegar el prefijo a mayúsculas no fusiona ninguna serie: está MEDIDO.** Contra producción el
   2026-09-14, sobre **2.287 órdenes** (incluidas las borradas): **0** remisiones con alguna letra
   en minúscula, **0** con caracteres fuera de `[A-Za-z0-9-]`, **0** sin ningún dígito. `na-001`
   y `NA-001` se agruparán juntas y hoy no hay ni una fila a la que eso afecte. Deja de ser un
   supuesto: es una medición.

4. **Órdenes eliminadas: sin cambio.** El filtro «Eliminadas» seguirá ordenando por remisión igual
   que el resto (R3/R4 no dependen del borrado); lo único que no aplica ahí es el índice, que es
   **parcial** (`WHERE deleted_at IS NULL`), así que esa consulta ordenará sin él. Con 2.136 filas
   vivas es irrelevante. Queda declarado en `design.md` §2.3 como límite conocido, no como duda.

**No queda ninguna pregunta abierta en esta spec.**
