# Aviso para quien aprueba los cierres — antes de desplegar la ficha 425

> Entregable M3 / puerta V4. Medido contra producción el 2026-09-14. **Se re-mide el día del
> despliegue.** Sin la confirmación de que se avisó, la release no sale.

## Qué va a pasar

A partir del despliegue, los **rechazos que registró la tienda** empiezan a aparecer en el cierre del
mensajero, en una sección nueva llamada **«Rechazados por la tienda»**. Hasta hoy no aparecían en
ningún cierre, y por eso esos paquetes se quedaban sin salida.

Como llevan semanas acumulándose, **el siguiente cierre de cada uno de estos mensajeros traerá de
golpe todos sus rechazos pendientes:**

| Mensajero | Rechazos que aparecerán | Desde | Hasta |
| --- | ---: | --- | --- |
| Carlos Cambronero | **19** | 28/08 | 10/09 |
| Andrés Agüero | 7 | 28/08 | 03/09 |
| Andy Cortés | 7 | 28/08 | 03/09 |
| Kendall Hernández | 6 | 28/08 | 01/09 |
| Johel Hernández | 4 | 28/08 | 10/09 |
| Arnel Guillen | 3 | 10/09 | 10/09 |
| **Total** | **46** | | |

## Esto es lo esperado, no un error

Un cierre con 19 paquetes de hasta tres semanas atrás **es correcto**. La fecha de cada fila está ahí
precisamente para que se entienda por qué son viejos.

## Qué tiene que hacer quien aprueba

1. **Ir a la estantería, separar esos paquetes y devolverlos a la tienda.**
2. **No hay que escanearlos.**
3. **No hay que cuadrar ningún importe**: los totales del cierre **no los incluyen**. No cambian ni el
   pago al mensajero ni el cobro a la tienda.

Al aprobar el cierre, esas órdenes pasan solas a **«por devolver a tienda»**.

## Lo que va a pasar la primera noche

El corte diario de las 00:00 crea un cierre `vencido` a todo mensajero que tenga algo pendiente. Con
este cambio, **eso incluye a quien solo tiene rechazos**. Medido el 2026-09-14, afecta a **dos**
mensajeros, y ninguno de los dos está trabajando:

| Mensajero | Qué le aparecerá | ¿Trabaja hoy? |
| --- | --- | --- |
| Andy Cortés | un cierre `vencido` con sus 7 rechazos y los seis totales en ₡0,00 | no: está incapacitado y hoy se traspasaron sus órdenes |
| Arnel Guillen | un cierre `vencido` con sus 3 rechazos y los seis totales en ₡0,00 | no: sin actividad desde el 10/09 |

- **Esos cierres son correctos.** Son documentos de revisión, no de dinero.
- **Un cierre `vencido` no se aprueba directamente.** Primero hay que pulsar **«Destrabar cierre
  vencido»** y después **«Aprobar»**. No hace falta que el mensajero haga nada.
  *(Corregido el 2026-09-14: la primera versión de este aviso decía que se podía aprobar directamente,
  y no es así.)*
- **Las tres órdenes rechazadas de Arnel (NA-947, NA-981 y NA-1103) salen de «rechazada» en cuanto se
  apruebe cualquier cierre de Arnel**, también el del 11/09 que ya está esperando: al aprobar un cierre,
  el sistema pasa a «por devolver a tienda» todas las órdenes rechazadas que ese mensajero tiene
  asignadas.
- **Los dos quedarán bloqueados para recibir trabajo** mientras su cierre nuevo siga abierto; la app les
  dirá que vayan a «Cierre del día». Como ninguno está trabajando, hoy no tiene efecto.
  - **Andy:** al volver, basta con que envíe su cierre a aprobación, o con que un administrador lo
    destrabe y lo apruebe.
  - **Arnel:** **para que vuelva a recibir trabajo hay que resolver su cierre nuevo** (destrabarlo y
    aprobarlo). Aprobar solo el del 11/09 no basta, porque el nuevo seguiría pendiente de reenvío.
- **Los otros cuatro (Carlos Cambronero, Andrés Agüero, Johel y Kendall Hernández) no se ven afectados
  de forma nueva.** Sus rechazos entran en el cierre que pidan hoy o, si no lo piden, en el `vencido`
  que el corte ya les crea igual que cualquier otro día.
