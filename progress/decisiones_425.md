# 425 — Decisiones del humano y el desglose que hay que avisar

> Firmado por Carlos Restrepo el 2026-09-14, antes de escribir el spec.
> Este archivo es la entrada del `spec_author`: lo que está aquí NO se reabre.

## Las tres decisiones

**D1 — La salida tiene que llegar POR UN CIERRE.** Sus palabras: «son las personas que aprueban
los cierres las que deben separar esos paquetes para su debida devolución y además es la manera de
enterarse de que ese paquete fue rechazado». El cierre no es sólo contabilidad: es el punto donde
alguien separa el paquete físico. **Quedan descartadas** las dos alternativas que propuso el
leader —colgarlo de la aprobación del cobro de rechazo, y una acción manual del admin—.

**D2 — Sólo los RECHAZOS.** Las 43 gestiones de `reprogramacion_tienda` se quedan fuera: no dejan
la orden sin salida (el cron las libera al llegar su fecha) y no exigen separar ningún paquete.
Meterlas sólo añadiría volumen a los cierres sin resolver ningún atasco.

**D3 — Las 46 gestiones históricas SÍ entran, pero avisando antes.** El arreglo las vuelve
elegibles y cada mensajero las recogerá en su siguiente cierre. **Antes de desplegar** hay que
entregarle al humano el desglose de abajo para que avise a quien aprueba los cierres de lo que va
a ver, y evitar que un documento con tres semanas de gestiones acumuladas parezca un error.

## La tensión que el spec DEBE resolver

| | Qué exige |
| --- | --- |
| **Operación** (D1) | La gestión entra al cierre: ahí se ve el rechazo y se separa el paquete |
| **Dinero** (motivo legítimo de la ficha 337) | NO puede sumar al **pago del mensajero**: él no hizo esa gestión |

No se trata de revertir la 337, sino de **separar los dos conceptos**. La 337 sacó la gestión del
cierre entero para no pagarla; hay que conseguir que se vea sin que se pague.

## El desglose a avisar (D3), medido contra producción el 2026-09-14

46 rechazos sin cierre, repartidos en 6 mensajeros:

| Mensajero | Rechazos | El más antiguo | El más reciente | Días distintos |
| --- | ---: | --- | --- | ---: |
| Carlos Cambronero Cambronero | 19 | 2026-08-28 | 2026-09-10 | 5 |
| Andres Aguero Aguero | 7 | 2026-08-28 | 2026-09-03 | 2 |
| Andy Cortes Cortes | 7 | 2026-08-28 | 2026-09-03 | 2 |
| Kendall Hernandez Hernandez | 6 | 2026-08-28 | 2026-09-01 | 2 |
| Johel Hernandez Hernández | 4 | 2026-08-28 | 2026-09-10 | 3 |
| Arnel Guillen Arce | 3 | 2026-09-10 | 2026-09-10 | 1 |
| **Total** | **46** | | | |

El caso que originó todo, **NA-981** (guía 58980454, tienda Nuform), es uno de los 3 de Arnel. Se
destraba con el arreglo, **sin tocarla a mano**: es la decisión expresa del humano.

## Lo que sigue abierto

**Los 25 rechazos sin `ingreso_bodega_rechazo` congelado** (~₡4.000 al ritmo medido de ₡164 por
rechazo). El humano pidió decidirlo **después** del spec, con el diseño delante. No se toca dinero
histórico sin que lo vea primero.

## Lo que el spec tiene que MEDIR, no suponer

1. El efecto sobre los **totales de un cierre real**, antes y después del cambio. Con datos de
   producción de hoy, no inventados.
2. Que `total_pago_mensajero` **no se mueve** cuando entra una gestión de rechazo de tienda.
3. Que la orden sale de `rechazada` al aprobar el cierre, y llega al estado que le toca según su
   zona (`por_devolver_a_tienda` en central, `por_devolver` en satélite).
4. Que las reprogramaciones de tienda **siguen fuera** (D2), y que eso no cambió por accidente.
