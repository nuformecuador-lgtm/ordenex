# Ficha 411 — La analítica sigue un lote de carga hasta su desenlace

> Requisitos en notación EARS. Sin detalles de implementación: el CÓMO vive en `design.md`.
> Cada `R<n>` termina mapeado a un test concreto en `tasks.md § Trazabilidad`.
> **Cero preguntas abiertas:** las seis se cerraron el 2026-09-10 (ver § Decisiones cerradas).

## Contexto

El humano preguntó el 2026-09-10: «¿y si yo quiero ver la efectividad de entrega de un día en
específico?». Al medirlo salieron **dos preguntas distintas**, y sólo una está sin responder.

### Lo que YA funciona y esta ficha NO toca

El rango **personalizado con la misma fecha en `desde` y `hasta`** ya resuelve un día completo.
Confirmado en el archivo real: `resolverRango` (`lib/analytics/ranges.ts:117-129`) devuelve
`desde = inicioDelDiaCREnUtc(desdeFecha)` y `hasta = inicioDelDiaSiguienteCREnUtc(hastaFecha)`, o
sea la ventana semiabierta `[00:00 CR, 00:00 CR del día siguiente)`. **La efectividad de un día
concreto ya se puede ver hoy.** Esta ficha no la reimplementa, no la mueve y no la mejora.

### Lo que falta, y es otra pregunta

La base de los KPI del día es el **inventario vivo**: las órdenes no terminadas al corte MÁS las
que llegaron a un estado terminal dentro de la ventana (el «universo B2» de la 124; en el archivo
real, `cteEstatusAlCorte` y `cteTerminalEnVentana` en
`lib/repositories/AnaliticaOperativaVivaRepository.ts:58-81`). Ese universo **incluye órdenes
cargadas semanas antes**, y por eso contesta «¿qué tal fue ese día?».

Una **cohorte** contesta otra cosa: *de las N órdenes que se cargaron el lunes, cuántas se
entregaron, cuántas se devolvieron, cuántas siguen vivas y en cuántos días*. Es «¿qué tal salió
ese lote?». **Hoy no lo responde ninguna pantalla.**

### Lo confirmado en el ARCHIVO REAL (no en el índice del MCP, que devuelve de más)

1. `lib/repositories/ConteoCargadasPorDiaRepository.ts` — ya existe la serie «órdenes cargadas por
   día», anclada en `orden.created_at` y agrupada por día calendario CR. Expone `condicionesSinFecha`
   y `condicionesDeCargadas` **puras y exportadas**, y calcula el día CR con un desfase DERIVADO de
   `inicioDelDiaCREnUtc` que viaja como parámetro (`DIA_CR`, hoy privado del módulo). Su cabecera
   deja escrito que en ese SQL **no hay ni una zona horaria**.
2. `lib/repositories/AnaliticaOperativaVivaRepository.ts:48` — `TERMINALES`, la lista terminal ya
   rendida a SQL: `Prisma.join([...ESTADOS_TERMINALES])`. `contarOrdenesCreadas` (`:336-356`) cuenta
   «LA ORDEN por su `created_at`, no sus transiciones» — el ancla natural de una cohorte.
   `acumularCiclosCerrados` (`:467-505`) devuelve `segCicloAcum` + `segCicloN`, **jamás el promedio
   ya calculado**; `fragmentoDeAlcance` (`:92-105`) es el recorte multi-tenant en el `WHERE`.
3. `lib/repositories/CicloVidaRepository.ts` — la definición ÚNICA de «ciclo de vida»: de
   `orden.created_at` a la **ÚLTIMA** transición a un estado terminal, con
   `DISTINCT ON (orden_id) … ORDER BY created_at DESC, id DESC`. Y deja escrito que **su ventana cae
   sobre la transición terminal, no sobre la creación** — que es exactamente lo que una cohorte
   invierte (ver `design.md § 0`).
4. `lib/types/order-status-transiciones.ts:509-513` — `ESTADOS_TERMINALES` es
   `["entregada", "devuelta_a_tienda", "incidente"]`. **`rechazada`, `devuelta`, `sin_gestionar` y
   `devolucion_por_confirmar` NO son terminales**: tienen salidas declaradas y su flujo continúa.
5. `lib/analytics/entregas-conteo.ts` — la vertical viva: filtro `conteoEntregasFiltroSchema`
   (6 facetas + rango opcional), tipo opaco `ConsultaConteoEntregas`, `prepararConteoEntregas`
   (parsear → rango → alcance → intersecar) y **siete** claves de caché con prefijo propio.
6. `lib/actions/analitica-refrescar.ts:56-65` — `TAGS_ANALITICA`, las siete verticales + operativa.
   `tests/unit/analytics/refrescar-cache-analitica.test.ts:69-79` afirma «7 verticales» a mano.
7. `app/(app)/analitica/page.tsx` — la superficie: `FiltroEntregasProvider` + barra pegajosa
   (`FiltrosEntregas`) + `SeccionFiltrable`. «Detalle · Movimiento de las ordenes» y «Detalle ·
   Productos» son secciones hermanas dentro del MISMO proveedor de filtro.
8. `app/(app)/analitica/_components/entregas/base-del-kpi.ts` — `contarOrdenes`, `ORDENES`,
   `ORDENES_CERRADAS` y `rotuloConBase`: la forma ÚNICA de escribir la base de una cifra.
9. `db/schema.prisma` — `orden` tiene `@@index([createdAt])` (`:787`) y `@@index([cargaId])`
   (`:810`, feature 141: «órdenes de este lote»); `orden_historial_estado` tiene
   `@@index([ordenId, createdAt])` (`:2222`). `orden.created_at` es `timestamp`, **no** `@db.Date`.

### Una orden `devuelta` NO ha terminado nada — el caso que más se malinterpreta

Medido en este repo el **2026-09-10**: una orden `devuelta` volvió a bodega, se **liberó sola a las
24 h**, salió de nuevo a reparto y **se devolvió otra vez cinco días después**. `devuelta` significa
«devolución anclada», no «lote cerrado»: el paquete sigue en circulación y su historia continúa.
Por eso `devuelta` **no** está en la lista terminal, por eso esa orden **sigue viva** en su cohorte
(R10), y por eso el cubo **`Vivas` es lo único que impide que esta tabla mienta por omisión** (R32):
sin él, la cohorte diría «12 entregadas de 40» y callaría que 25 siguen en la calle.

### La trampa horaria, que este repo documenta y ya mordió

`lib/analytics/ranges.ts:40-59`, bloque (c): `startOfDayCR` devuelve la **medianoche UTC** de la
fecha CR. Es correcta contra columnas `@db.Date` y **es un error de seis horas contra un
`timestamp`**: `[startOfDayCR(f), +24 h)` es en realidad la ventana 18:00–18:00 hora CR. Las cotas
de esta ficha son `inicioDelDiaCREnUtc` / `inicioDelDiaSiguienteCREnUtc`, y **todo borde cae en
`…T06:00:00.000Z`**. Seis horas de desplazamiento **no se ven a ojo** en una tabla de conteos.

### El límite innegociable

**Ni una definición nueva de nada que ya esté definido.** Los terminales salen de la lista que ya
existe; el reloj del ciclo, del criterio ya escrito; el recorte por rol, de la misma función; el día
CR, del mismo desfase derivado. Esta ficha añade **una pregunta**, no un segundo vocabulario.

---

## 1 — Qué es una cohorte

**R1.** El sistema DEBE agrupar cada orden en la cohorte del **día calendario de Costa Rica** de su
`orden.created_at`.

**R2.** CUANDO una orden se cree a las 23:50 hora de pared de Costa Rica del día D, el sistema DEBE
contarla en la cohorte **D**; y CUANDO se cree a las 00:10 hora de pared de Costa Rica del día D+1,
DEBE contarla en la cohorte **D+1**.

**R3.** El sistema DEBE acotar la ventana de la cohorte como el intervalo SEMIABIERTO
`[00:00 CR del día "desde", 00:00 CR del día siguiente a "hasta")`, y NO DEBE usar la medianoche
UTC de una fecha calendario como cota contra `orden.created_at`.

**R4.** El sistema NO DEBE contar en ninguna cohorte una orden con `deleted_at` no nulo.

**R5.** SI el filtro no trae ningún rango, ENTONCES el sistema NO DEBE consultar la base y DEBE
devolver un estado propio que signifique «falta elegir un periodo»; y SI además el actor no puede
leer esta sección, ENTONCES la denegación DEBE preceder a esa invitación.

**R6.** El sistema DEBE emitir una cohorte por cada día CON al menos una orden cargada, en orden
cronológico **DESCENDENTE** (la más reciente primero), y NO DEBE emitir filas para los días sin
ninguna.

---

## 2 — Los desenlaces de la cohorte

**R7.** El sistema DEBE clasificar cada orden de una cohorte en EXACTAMENTE UNO de estos cubos: uno
de los estados terminales del dominio, o el cubo `viva`.

**R8.** El sistema DEBE tomar los estados terminales de la lista que YA existe en el producto y NO
DEBE declarar una segunda; SI el dominio da de alta un cuarto estado terminal, ENTONCES la
clasificación DEBE recogerlo sin editar la consulta.

**R9.** CUANDO una orden haya entrado más de una vez a un estado terminal, el sistema DEBE
clasificarla por su **ÚLTIMA** transición terminal, y DEBE contarla UNA sola vez.

**R10.** SI una orden de la cohorte no ha llegado nunca a un estado terminal, ENTONCES el sistema
DEBE contarla en el cubo `viva`; en particular las que están en `rechazada`, `devuelta`,
`devolucion_por_confirmar` o `sin_gestionar` DEBEN contar como `viva` y NO como devueltas.

**R11.** El sistema DEBE cumplir que, para cada día, la SUMA de los cubos sea EXACTAMENTE el número
de órdenes cargadas ese día — ninguna orden de la cohorte queda fuera y ninguna se cuenta dos veces.

**R12.** El sistema NO DEBE acotar temporalmente la transición terminal: una orden cargada dentro de
la ventana DEBE contar su desenlace **aunque la transición haya ocurrido después del `hasta`**.

**R13.** El sistema DEBE contar el desenlace de una orden aunque su gestión más reciente diga otra
cosa: la fuente del desenlace es la transición de estado registrada, no la última gestión vigente.

---

## 3 — El tiempo hasta el desenlace

**R14.** El sistema DEBE emitir, por cada día y por cada cubo terminal, la SUMA de segundos entre
`orden.created_at` y la transición terminal que clasifica cada orden (numerador) **y** el número de
órdenes que la componen (denominador).

**R15.** El sistema NO DEBE emitir únicamente el promedio: el numerador y el denominador DEBEN viajar
siempre, de modo que dos recortes se puedan volver a agregar sumando y no promediando promedios.

**R16.** El sistema NO DEBE atribuir tiempo a las órdenes del cubo `viva`: su numerador DEBE estar
AUSENTE, y NO DEBE ser cero.

**R17.** SI el denominador de un cubo es 0, ENTONCES el promedio DEBE ser AUSENTE y NO cero.

**R18.** El sistema DEBE medir el reloj con la MISMA definición de ciclo que ya usa el producto
—de la creación de la orden a su última transición terminal— y NO con una variante propia.

---

## 4 — Alcance y filtros (frontera multi-tenant)

**R19.** El sistema DEBE aplicar el recorte por rol dentro de la condición de la consulta, y NO en
un filtro en memoria posterior.

**R20.** MIENTRAS el actor tenga acceso total, el sistema DEBE calcular las cohortes sobre las
órdenes de TODAS las tiendas; MIENTRAS sea `adminTienda`, ÚNICAMENTE sobre las de su cuenta;
MIENTRAS sea `adminSatelite`, ÚNICAMENTE sobre las de su zona.

**R21.** SI el actor es `mensajero`, o llega por el canal de API key, o su rol no es lector de
analítica, ENTONCES el sistema DEBE denegar la lectura y NO DEBE devolver una cohorte vacía.

**R22.** SI el filtro nombra una tienda o una zona fuera del alcance concedido, ENTONCES el sistema
DEBE denegar la lectura y NO DEBE devolver el subconjunto vacío de la intersección.

**R23.** El sistema NO DEBE aceptar el alcance por la entrada del cliente: una clave desconocida en
el filtro DEBE ser un error de validación.

**R24.** El sistema NO DEBE recortar las cohortes por mensajero: una orden no la carga un mensajero.
CUANDO haya un mensajero seleccionado en la barra, la pantalla DEBE advertir que esta sección no
responde a ese filtro.

**R25.** CUANDO el sistema deniegue una lectura de cohortes, DEBE dejar un rastro con el motivo, y
NO DEBE revelar el motivo al cliente.

---

## 5 — Contrato de salida, caché y frescura

**R26.** El sistema DEBE distinguir en su respuesta los estados «correcto», «sin sesión»,
«prohibido», «filtro inválido» y «sin rango», y NO DEBE representar ninguno de los cuatro últimos
como una cohorte vacía.

**R27.** El sistema DEBE sellar el instante en que las cifras se leyeron DE LA BASE, no aquel en que
se sirvieron: dos peticiones servidas de la misma entrada de caché DEBEN llevar el mismo sello.

**R28.** La entrada de caché de esta lectura DEBE llevar dentro el alcance concedido y un prefijo
propio, de modo que NO pueda colisionar con ninguna de las otras siete lecturas de la sección.

**R29.** CUANDO el usuario pulse «Actualizar», el sistema DEBE invalidar también esta lectura.

**R30.** El sistema DEBE derivar los totales de la cohorte de las MISMAS filas que devuelve, y NO de
una segunda consulta.

---

## 6 — Dónde se ve

**R31.** El sistema DEBE mostrar las cohortes dentro de la pantalla de analítica, movidas por la
MISMA barra de filtros que ya mueve la sección de entregas.

**R32.** La pantalla DEBE mostrar, por cada cohorte, las órdenes cargadas y los cuatro cubos —
entregadas, devueltas, incidentes y **vivas** —, y NO DEBE omitir el cubo `viva`.

**R33.** SI la pantalla escribe un porcentaje de la cohorte, ENTONCES DEBE escribir su base con el
módulo único de base de KPI, y el denominador DEBE ser la cohorte ENTERA (las cargadas) y NO
únicamente las cerradas.

**R34.** La pantalla NO DEBE degradar «prohibido», «sesión no válida», «filtro inválido» ni «se
rompió» al estado vacío de la tabla.

**R35.** La pantalla NO DEBE pedir estos datos por ninguna otra puerta que la Server Action de esta
lectura: ni servicio, ni repositorio, ni Prisma, ni una ruta bajo `app/api/`.

**R39.** MIENTRAS el filtro no traiga rango, la pantalla DEBE invitar a elegir un periodo, y NO DEBE
pintar una tabla vacía ni un cero.

---

## 7 — Rendimiento y coste

**R36.** El sistema DEBE resolver la cohorte con índices YA existentes: el plan de la consulta NO
DEBE recurrir a un recorrido secuencial de `orden_historial_estado` cuando el planificador tiene
alternativa.

**R37.** SI la medición demuestra que hace falta un índice nuevo, ENTONCES la implementación DEBE
traerlo como migración versionada CON su `down.sql`, y el gate de la ficha DEBE ser el completo.

**R38.** El sistema DEBE resolver la cohorte en UNA sola consulta a la base por lectura, y NO una
por día del rango.

---

## Decisiones cerradas (2026-09-10)

> Se preguntaron y se cerraron. Quedan escritas con su motivo para que nadie las reabra de pasada;
> ninguna es un supuesto del spec_author.

| # | Pregunta | Decisión | Qué fija |
| --- | --- | --- | --- |
| **Zona** | ¿`backend` o `fullstack`? | **`fullstack`**, backend → frontend. Sin ficha hija: la sección sin su tabla no entrega valor | orden de `tasks.md` |
| **P1** | ¿`rechazada` / `devuelta` son devolución? | **No.** Se usa la lista terminal que YA existe; `devuelta` sigue viva (caso medido arriba) | R7, R8, R10 |
| **P2** | ¿Ve la sección el `adminSatelite`? | **Sí**, con su alcance por zona. No se inventa una excepción de permisos para esta tabla | R20 |
| **P3** | ¿Sin rango se vuelca la historia? | **No: se exige rango.** Sin filtrar la tabla crece sin techo y deja de ser herramienta | R5, R26, R39 |
| **P4** | ¿Cohorte por día o por `carga_id`? | **Por DÍA.** Un día puede tener varias cargas y el humano las piensa juntas. `carga_id` queda anotado como refinamiento posible, fuera de esta ficha | R1 |
| **P5** | ¿Descarga? | **No en esta ficha.** Alcance mínimo; si al verla hace falta, se pide entonces | `design.md §7.3` |
| **P6** | ¿Orden de la tabla? | **Más reciente primero** | R6 |
