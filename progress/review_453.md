# Revisión de la ficha 453 — vistas de filtros guardadas

> El `reviewer` no puede escribir archivos: este informe lo escribe el leader con lo que devolvió.
> 2026-09-21, rama `feat/453-vistas-de-filtros-guardadas`.

## Veredicto: **OK**, tras un rechazo y su arreglo

**El código no necesitó ni una línea.** Sobrevivió las **diez mutaciones** que el reviewer ejecutó él
mismo. Los dos bloqueantes fueron de contrato, no de comportamiento.

## Las diez mutaciones, todas ejecutadas y revertidas

| Qué se mutó | Resultado |
| --- | --- |
| Default de las vistas **encendido** en la barra compartida | **3 rojos / 2 archivos** |
| `vistas={…}` añadido a `NovedadesFiltrosBarra` | **2 rojos** (censo literal + barra real de `/novedades`) |
| Superficie declarada y no montada | 1 rojo (R34) |
| Aplicar lo parcial de una vista incompleta antes de decidir | **2 rojos** |
| `actualizarVistaFiltro` colado en «Aplicar sin eso» | 1 rojo (R16) |
| Colapsar «catálogo caído» = «catálogo vacío» | **5 rojos / 3 archivos** |
| Quitar el freno interno de `disabled`/sin opciones | 3 rojos, incluido el par de CONTRASTE |
| Coercionar una versión desconocida a v1 | 2 rojos |
| Sacar `usuarioId` de los **cinco** `WHERE` del repositorio | **5 rojos**, contra Postgres real |
| (ronda 2) `superficie` convertida en ENUM | **2 rojos**, las dos mitades por separado |

**La red anti-global es real, y era la duda mayor.** Lo añadido vive en un componente con 16
consumidores en 12 pantallas; este repo ya se comió el caso contrario con la 428, donde cambiar el
default a `true` dejaba verdes los tests de las otras once porque localizan por nombre accesible. Aquí
el rojo es una **aserción**, no un crash: `queryByRole("Vistas guardadas")` encuentra el botón donde
no debería.

## Los dos bloqueantes, y por qué el segundo importa

1. **`tasks.md` con 0 de 20 tareas marcadas.** Papeleo. Cerrado: 20/20, con dos que llevan estado
   real porque lo entregado se apartó de lo escrito.
2. **R32 no lo verificaba ningún test, y la trazabilidad decía que sí.** El mapa apuntaba a un
   archivo que en disco tiene otra extensión, y ese test **nunca menciona R32**. El agujero concreto:
   **nada comprobaba que `superficie` fuera TEXT**. Convertirla en enum mañana no habría puesto rojo
   nada — y un enum ahí es justo lo que obligaría a migrar la base para encender cada pantalla nueva,
   que es **lo contrario de la promesa de la ficha** («que sirva para cualquier filtro, sin crecerlo
   más a futuro»). La ficha habría cerrado con su promesa principal sin red.

**Cómo se cerró**, y merece leerse porque es el patrón a repetir: seis casos nuevos, la mitad contra
el **motor** y la mitad contra el **futuro**. Contra el motor: el detector se autocomprueba contra un
ENUM de verdad antes de afirmar nada; `superficie` es `text`/`typtype=b`; ningún CHECK ata sus
valores; y **la base acepta una superficie que el código no declara** —un `INSERT` real en
transacción revertida— mientras el borde la rechaza, que es la definición operativa de «el código es
la única fuente». Contra el futuro: ninguna de las 206 migraciones crea un tipo de superficies ni
altera esa columna.

La mutación que los mató no se pudo aplicar a la base compartida —lo impidió el sandbox— así que se
hizo sobre una copia real de la tabla en un esquema desechable, dentro de una transacción revertida.
Cayeron las dos mitades por separado.

## Menores, los cinco cerrados

Nombres reales de los logs en las tareas; `.guardia.test.tsx` donde el spec decía `.ts`; la fila R32
del mapa apuntando al archivo que de verdad lo verifica; `design.md §5` corrigiendo `limit_reached`
por **`limite_excedido`** —se corrige el spec y no el código, porque ese es el término de otros diez
módulos y R13 exige que el error lleve `maximo` y `actuales`—; y las cinco preguntas abiertas
convertidas en **decisiones cerradas** con su fecha y el test que las sostiene.

## No verificado, declarado en vez de darlo por bueno

- **`db:rollback` ida y vuelta no se re-ejecutó** en la revisión, para no romper el gate de otros
  agentes sobre la base local compartida. Sí lo probó quien escribió la migración (up → rollback →
  up, con `migrate diff` vacío). El `down.sql` es una sola sentencia acotada a la tabla nueva, así que
  «borrar de más» está descartado **por lectura**, no por ejecución.
- **Nada medido contra producción**: la tabla no existe allí todavía.

## Trazabilidad

**39 de 39** tras el arreglo. El reviewer verificó uno a uno los de mención única (R17, R20, R21,
R22, R26, R28, R36, R37) y confirmó que tienen aserción real, no una cita de cortesía.
