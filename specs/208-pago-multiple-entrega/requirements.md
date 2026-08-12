# 208 — Pago múltiple por entrega (modelo y cálculo del recaudo) — Requisitos

> Zona `backend` · complexity `high` · rama `feature/208-pago-multiple-entrega` (de `origin/dev`, `c23c118a`).
> Mitad BACKEND de la partición 208/209. La mitad FRONTEND (captura y presentación) es la **209**.

## Contexto mínimo (no re-descubrir)

Hoy el recaudo al cliente vive en `gestion_orden` como un par ÚNICO: `monto_recibido` +
`metodo_pago` (`db/schema.prisma:728-729`). Una entrega cobrada en efectivo + transferencia no se
puede registrar sin mentir en los totales por método del cierre, porque `computeTotales`
(`lib/utils/cierre-totales.ts:53-81`) hace un `switch` sobre UN método y mete TODO el monto en un
solo balde.

**Decisiones ya tomadas en la puerta humana del 2026-08-12 — no se reabren en este spec:**

- **[D1]** Alcance = SOLO el recaudo al cliente en la entrega. `LiquidacionPago` (172) NO se toca.
- **[D2]** `@@unique([gestion_id, metodo])`: cada método aparece como mucho una vez, con su monto
  ya sumado. Dos transferencias distintas se registran como UNA línea.
- **[D3]** Sin referencia: la línea lleva método y monto, nada más.
- **[D4]** Descargas: los métodos se concatenan en la celda escalar (es de la 209, pero condiciona
  el DTO que esta ficha sirve).
- El enum nativo `MetodoPagoValue` se **conserva**; NO se convierte en tabla-catálogo.
- `monto_recibido` sobrevive como **TOTAL snapshot** (money-critical, patrón 39/56). La invariante
  `SUM(pagos.monto) = monto_recibido` se valida en el BORDE con zod, **sin CHECK en la base**
  (patrón 36/F1.4-b).

---

## A. Modelo de datos y migración

**R1.** El sistema DEBE persistir el recaudo de una gestión como un conjunto de **0..N líneas**
`(metodo, monto)` en una tabla hija `gestion_orden_pago`, con `gestion_id` referenciando
`gestion_orden(id)` con `ON DELETE CASCADE`, e índice de lectura por `gestion_id`.

**R2.** El sistema DEBE impedir que una misma gestión tenga dos líneas con el mismo método,
mediante un índice ÚNICO `(gestion_id, metodo)` en la base [D2].

**R3.** La línea del desglose DEBE contener exclusivamente la gestión, el método y el monto (más la
clave técnica y la marca de creación). El sistema NO DEBE almacenar una referencia de pago en esta
tabla [D3].

**R4.** La tabla `gestion_orden_pago` DEBE tener Row Level Security HABILITADA y **ninguna** policy
(acceso solo por service role), igual que `gestion_orden` y `gestion_orden_evidencia`.

**R5.** El sistema DEBE conservar `gestion_orden.monto_recibido` como TOTAL snapshot y
`gestion_orden.metodo_pago` como columna DEPRECADA: la migración de esta feature NO DEBE eliminar,
renombrar ni cambiar el tipo de ninguna de las dos.

**R6.** CUANDO se aplica la migración, el sistema DEBE crear **una** fila de `gestion_orden_pago`
por cada gestión existente con `monto_recibido IS NOT NULL AND monto_recibido > 0 AND metodo_pago IS
NOT NULL`, con `monto = monto_recibido` y `metodo = metodo_pago`.

**R7.** CUANDO se aplica la migración, el sistema NO DEBE crear filas para gestiones con
`monto_recibido` nulo, con `monto_recibido = 0` o con `metodo_pago` nulo (una entrega sin cobro
histórica queda con CERO líneas, no con una línea de `efectivo`/0).

**R8.** La migración NO DEBE modificar, recalcular ni tocar ninguna columna de `cierre_dia`,
`cierre_bodega`, `cierre_maestro` ni `cierre_detail`: los totales ya snapshoteados quedan
exactamente como están.

**R9.** El sistema DEBE proveer un `down.sql` que revierta EXACTAMENTE la migración (soltar la tabla
nueva con su backfill, índices y FK) SIN alterar ninguna columna ni dato de `gestion_orden`.

**R10.** El sistema NO DEBE expresar la invariante `SUM(pagos.monto) = monto_recibido` como
constraint de la base (`CHECK`/trigger): esa validación vive en el borde (patrón 36/F1.4-b).

---

## B. Borde de escritura (zod → action → service → repositorio)

**R11.** CUANDO llega una gestión con `resultado = entregada` que incluye el DESGLOSE (lista de
líneas `metodo`+`monto`), el sistema DEBE aceptarla si y solo si: cada monto es estrictamente
positivo, ningún método se repite y la suma de los montos es EXACTAMENTE igual a `montoRecibido`.
Si alguna condición falla, DEBE devolver un error de validación en el campo del desglose y NO
persistir nada.

**R12.** CUANDO llega una gestión con `resultado = entregada` en la forma ESCALAR histórica (un
único `metodoPago`, sin desglose) y `montoRecibido > 0`, el sistema DEBE aceptarla y normalizarla a
UNA línea `(metodoPago, montoRecibido)`. *(Sin esto, entre el merge de la 208 y el de la 209 el
panel viejo —que sigue mandando un método escalar y valida en cliente con el MISMO schema— deja la
app rota en producción.)*

**R13.** SI una gestión `entregada` llega con las DOS formas a la vez (escalar y desglose),
ENTONCES el sistema DEBE rechazarla con un error de validación y NO persistir nada.

**R14.** SI una gestión `entregada` llega con `montoRecibido = 0` (orden SIN cobro), ENTONCES el
sistema DEBE persistirla con **CERO líneas** de pago, incluso cuando el cliente envíe la forma
escalar `efectivo` (que es lo que hoy fuerza `GestionarOrdenPanel.tsx:331`). Un desglose vacío o
ausente DEBE ser válido en ese caso.

**R15.** SI una gestión `entregada` llega con `montoRecibido > 0` y sin ninguna de las dos formas
(ni escalar ni desglose), ENTONCES el sistema DEBE rechazarla con un error de validación de campo y
NO persistir nada.

**R16.** MIENTRAS el `resultado` no sea `entregada`, el contrato de entrada NO DEBE admitir ni
desglose ni método escalar, y la gestión resultante NO DEBE tener líneas de pago.

**R17.** CUANDO una gestión con desglose se persiste, el sistema DEBE escribir la gestión, sus
líneas de pago y la transición de estatus en la MISMA transacción (todo-o-nada): si algo falla, no
queda ninguna línea huérfana ni una gestión sin su desglose.

**R18.** ANTES de persistir, el servicio DEBE revalidar en el servidor —con aritmética
`Prisma.Decimal`, nunca `number` ni `parseFloat`— que la suma de las líneas iguala `montoRecibido`,
y rechazar la gestión si no cuadra (segunda barrera, independiente del borde zod).

**R19.** CUANDO una gestión se persiste, el sistema DEBE escribir la columna deprecada
`metodo_pago` con el método de la ÚNICA línea si hay exactamente una, y con `NULL` si hay cero o dos
o más líneas.

**R20.** El sistema DEBE persistir el monto de cada línea con el mismo tipo y escala monetaria que
`monto_recibido` (`Decimal(12,2)`), sin pasar por aritmética de coma flotante.

---

## C. Lectura y cálculo del recaudo

**R21.** La fila de dominio de una gestión de cierre (`CierreGestionPendienteRow`) DEBE llevar
SIEMPRE el desglose como campo obligatorio: la lista de líneas `(metodo, monto)`, con `[]` cuando
la gestión no tiene ninguna, y con los montos serializados como STRING de escala 2.

**R22.** El sistema DEBE devolver las líneas de una gestión en un orden DETERMINISTA (el orden de
declaración del enum: `efectivo`, `SINPE`, `transferencia`), para que la concatenación de las
descargas [D4] y las aserciones de los tests no dependan del orden físico de la base.

**R23.** Los TRES caminos de lectura que producen esa fila —vista EN VIVO del mensajero, detalle de
cierres de admin y detalle de cierres de bodega— DEBEN poblar el desglose desde la base. El sistema
NO DEBE permitir una proyección que produzca esa fila sin seleccionar las líneas de pago.

**R24.** CUANDO se calculan los totales de un cierre, el sistema DEBE acumular **cada línea** de
cada gestión `entregada` en el balde de SU método (`efectivo`, `SINPE`, `transferencia`) con
aritmética `Prisma.Decimal`, y emitir el total general como la suma de los tres baldes, serializados
a STRING de escala 2.

**R25.** MIENTRAS una gestión no tenga `resultado = entregada`, sus líneas de pago NO DEBEN aportar
a ningún balde ni al total general.

**R26.** SI una gestión `entregada` no tiene líneas de pago, ENTONCES no DEBE aportar a ningún
balde ni al total general (comportamiento defensivo equivalente al `default: break` actual para una
entrega sin método).

**R27.** Para cualquier conjunto de gestiones existentes ANTES de esta feature, los tres totales
por método y el general calculados sobre el desglose backfilleado DEBEN ser EXACTAMENTE los mismos
que los que producía el cálculo escalar (paridad al centavo).

**R28.** El sistema DEBE cumplir, para cualquier conjunto de gestiones, que
`general = efectivo + SINPE + transferencia` y que `general` iguale la suma de los `monto_recibido`
de las gestiones `entregada` que tienen líneas, al centavo.

**R29.** CUANDO una gestión `entregada` se cobra con más de un método, el total de **efectivo** del
cierre (`cierre_dia.total_efectivo`, que es la `E` del `min(P, E)` del pago al mensajero, feature 44)
DEBE contener SOLO la parte cobrada en efectivo, y no el monto total de la entrega.

**R30.** El sistema NO DEBE usar `number`, `parseFloat` ni suma de coma flotante sobre montos en
ninguno de los caminos que esta feature toca (cálculo de totales, persistencia de líneas y
revalidación del servicio).

---

## D. DTO de servicio y fronteras que NO se mueven

**R31.** El DTO de gestión que el servicio de cierre expone a la UI DEBE incluir el desglose
(lista `metodo`+`monto`) CONSERVANDO el campo escalar `metodoPago` mientras la 209 no lo retire, de
modo que la presentación actual siga funcionando sin cambios entre los dos merges.

**R32.** El sistema NO DEBE alterar la forma de los totales `total_efectivo` / `total_simpe` /
`total_transferencia` de `cierre_dia` ni de `cierre_bodega`: siguen siendo tres columnas; solo
cambia CÓMO se llenan.

> *Corrección del 2026-08-12 (revisión de la 208).* La redacción original decía `cierre_maestro`,
> tabla que NO existe en `db/schema.prisma`: el segundo modelo con los tres `total_*` es
> `CierreBodega` (feature 40). Solo cambia el nombre; el requisito es el mismo, y la guardia
> `pagos-frontera.guardia.test.ts` lo cubre recorriendo TODOS los `model` del schema en vez de
> suponer los nombres. La misma errata sobrevive a propósito en R8 y en `tasks.md`, donde
> `cierre_maestro` aparece dentro de una lista de tablas que la migración NO debe tocar: nombrar
> de más ahí no debilita nada.

**R33.** El sistema NO DEBE modificar el comportamiento ni las fuentes de `CajaCodFeedService`
(lee el ledger, no las gestiones), `WalletTiendaFeedService` (proyecta solo el total),
`RecaudoAnaliticaRepository` / `AnaliticaFinancieraService` (leen los `cierre_dia.total_*`; bajar a
`gestion_orden` les está prohibido), `descripcion-pago.ts` ni ningún camino de `LiquidacionPago`
[D1].

---

## Trazabilidad prevista (R → dónde se espera el test)

| R | Test esperado |
| --- | --- |
| R1–R4, R6–R10 | `tests/integration/db/gestion-orden-pago-migration.test.ts` (cobertura estática de `migration.sql` / `down.sql`, patrón `gestion-orden-evidencia-migration.test.ts`) |
| R5 | migración + `tests/unit/…/schema` (la columna sigue en el schema) |
| R11, R13, R14, R15, R16 | `tests/unit/types/gestion-orden-pagos-schema.test.ts` (zod del borde) |
| R12 | mismo archivo — caso explícito «forma escalar legacy → una línea» |
| R17, R19, R20 | `tests/unit/repositories/gestion-orden-repository.test.ts` (INSERT anidado en la tx) |
| R18 | `tests/unit/services/mis-asignaciones-pagos.test.ts` |
| R21–R23 | `tests/unit/repositories/cierre-dia-repository.test.ts`, `cierres-admin-repository.test.ts`, `cierres-bodega-admin-repository.test.ts` + guardia `tests/unit/guards/pagos-proyeccion.guardia.test.ts` |
| R24–R28, R30 | `tests/unit/utils/cierre-totales-pagos.test.ts` (incluye los casos de MUTACIÓN) + guardia `tests/unit/guards/pagos-aritmetica-decimal.guardia.test.ts` |
| R29 | `tests/unit/services/cierre-dia-service-totales-mixtos.test.ts` (mixto → `totalEfectivo` = solo la parte en efectivo; y el `min(P,E)` con esa E) |
| R31 | `tests/unit/services/cierre-dia-service.test.ts` (DTO lleva `pagos` y conserva `metodoPago`) |
| R32, R33 | guardia `tests/unit/guards/pagos-frontera.guardia.test.ts` (los archivos inmunes no ganan lecturas de `gestion_orden_pago`) + las guardias de analítica ya existentes siguen verdes |

---

## Preguntas abiertas

1. **Gestiones históricas inconsistentes.** R6 backfillea por `monto_recibido > 0 AND metodo_pago
   IS NOT NULL` **sin filtrar por `resultado`**. Si en la base hubiera alguna gestión NO `entregada`
   con `monto_recibido > 0`, ganaría una línea que el cálculo ignora igualmente (R25), así que los
   totales no cambian; pero el dato quedaría registrado. ¿Se prefiere fidelidad al dato (lo
   propuesto) o restringir el backfill a `resultado = 'entregada'`?
2. **Línea de monto cero desde la 209.** R11 rechaza montos no positivos, de modo que una fila vacía
   del futuro editor de desglose es un error de validación y no una línea de 0. ¿Confirma la 209 que
   el panel filtrará sus filas vacías antes de enviar, en vez de esperar que el borde las tolere?
3. **Cierre de la puerta de compatibilidad.** R12 deja el borde aceptando la forma escalar a
   propósito. La nota de la 209 dice que esa ficha «puede» retirarla. ¿El retiro de la forma escalar
   —y el de la columna `metodo_pago`— se decide en el PR de la 209, o queda como ficha aparte? Este
   spec asume que NINGUNO de los dos ocurre aquí.
