# Feature 259 — Diseño

> **Zona `fullstack`** (backend → frontend, secuenciado), tras la puerta humana del 2026-08-21.
> Leer antes: `requirements.md` (R1-R26 y las cuatro decisiones cerradas al final).
> Referencias vivas: `lib/repositories/TableroDiaRepository.ts` (lo que cambia),
> `lib/repositories/RankingRepository.ts` (de dónde se copia el predicado),
> `specs/246-asignacion-por-dia/requirements.md` §D7/§D10, `progress/impl_246.md` (los `EXPLAIN`).

---

## 1. La decisión: se revierte D10, y por qué el argumento de D10 no sobrevive

**D10 (2026-08-20) decía: el tablero NO sigue al ranking.** Su argumento —que hay que entender antes
de revertirlo, porque es bueno— era éste:

> Las dos pantallas no miden lo mismo. El tablero responde «**¿qué carga le eché HOY a este
> mensajero?**» —una pregunta de OPERACIÓN, y para ésa `asignado_at` es el dato correcto: la orden
> entró en su montón hoy, la reserve para el día que la reserve—. El ranking responde «¿de qué día
> es esta orden a efectos de su porcentaje?». Alinearlas no habría hecho que las dos dijeran la
> verdad: le habría quitado a ésta su propia respuesta.

**Lo que falta en ese razonamiento, y es lo que lo tumba:** el tablero **no tiene un contador que
responda «qué carga le eché hoy»**. Tiene ocho cubos, y una orden reservada para mañana cae
inevitablemente en uno de ellos. Con estatus `por_recoger` cae en `sinRecoger`, cuya ayuda visible
dice «**el mensajero todavía no arrancó con ellas**». Es decir: el dato entra a la pantalla con una
etiqueta que **afirma un retraso que no existe**. D10 razonó sobre el universo (`asignadas`) y no
sobre el **segundo eje** (`BUCKET_POR_ESTATUS`), que es donde el dato se convierte en una acusación.

No es que D10 eligiera mal entre dos verdades: es que la cifra que defendía **no se publica sola** en
ninguna parte de la pantalla.

**Decisión firmada por el humano el 2026-08-21 (D1 de esta ficha): el tablero cuenta por día de
reparto, alineado con `/ranking`.**

**Lo que se pierde y se acepta:** la pregunta de operación «¿qué le asigné hoy?» deja de tener
respuesta en esta pantalla. Nadie la pedía —el reporte del humano es exactamente el contrario— y si
algún día hace falta, es un contador nuevo, no un criterio distinto para los ocho que ya hay.

---

## 2. El predicado no se inventa: se copia

`RankingRepository.contarAsignadasPorMensajero` ya lo tiene, con su razonamiento escrito encima. Dos
ramas **disjuntas**:

- **(a)** `fecha_reparto = <día>` — la orden reservada para ese día.
- **(b)** `fecha_reparto IS NULL` **Y** `asignado_at ∈ [desde, hasta)` — el **respaldo** para las
  órdenes anteriores a la 246, que nunca tendrán la columna porque **no hay backfill y no lo habrá**.

Dos cosas que ese archivo ya explica y que aquí se **recogen**, no se redescubren:

1. **La cláusula `fecha_reparto IS NULL` de (b) no sobra.** Sin ella, una orden asignada hoy para
   mañana entraría por las dos ramas —hoy por `asignado_at`, mañana por `fecha_reparto`— y quedaría
   contada **en dos días distintos**. Con ella, cada orden aporta exactamente 1 a exactamente un día,
   por construcción (R7).
2. **Es un `OR` y no un `COALESCE(fecha_reparto, día(asignado_at))`.** El `COALESCE` mezcla las dos
   convenciones dentro de una expresión, **no es indexable por ningún índice** y obligaría a meter
   `- interval '6 hours'` en el SQL, que es **la segunda definición del día que el diseño de la 192
   prohíbe** (R8).

**Lo que la rama (b) NO promete:** no es una lista congelada de órdenes viejas. La guardia
`tests/unit/guards/fecha-reparto-acompana-asignado-at.guardia.test.ts` obliga a que toda escritura de
`asignado_at` en `lib/` toque `fecha_reparto` en la **misma** escritura, así que ninguna vía nueva
puede estampar una sin la otra por descuido; pero la rama (b) se queda igualmente, porque es la
respuesta correcta para cualquier orden que llegue a tener mensajero por una vía que no estampe la
columna. Igual que en el ranking.

---

## 3. La forma concreta en SQL crudo: **dos `SELECT` unidos**, no un `OR`

Lo que el ranking hace con Prisma (`OR: [...]` dentro de un `groupBy`) aquí hay que escribirlo a
mano. `cteIdsDelDia` queda así (comentarios abreviados; los del código van completos):

```sql
ids_reparto AS (
  -- (a) RESERVADA para este dia. Es la rama que hace que una orden asignada hoy para
  --     mañana cuente MAÑANA y no hoy.
  SELECT o."id" AS id
  FROM "orden" o
  WHERE o."mensajero_asignado_id" IS NOT NULL
    AND o."fecha_reparto" = ${ventana.fecha}::date
  UNION
  -- (b) RESPALDO para las ordenes SIN dia de reparto (anteriores a la 246: no hay backfill).
  --     `fecha_reparto IS NULL` NO sobra: es lo que hace las dos ramas DISJUNTAS y lo que
  --     impide que una misma orden se cuente en dos dias distintos.
  SELECT o."id" AS id
  FROM "orden" o
  WHERE o."mensajero_asignado_id" IS NOT NULL
    AND o."fecha_reparto" IS NULL
    AND o."asignado_at" >= ${ventana.desde}
    AND o."asignado_at" <  ${ventana.hasta}
),
ids_recoleccion AS (
  SELECT DISTINCT h."orden_id" AS id
  FROM "orden_historial_estado" h
  JOIN "orden" o2 ON o2."id" = h."orden_id"
  WHERE h."origen_tipo" = ${ORIGEN_ASIGNACION_RECOLECCION}::"orden_historial_origen_tipo"
    AND h."created_at" >= ${ventana.desde}
    AND h."created_at" <  ${ventana.hasta}
    -- R11 (ver §5): «hoy lo mandaron a recoger» SI es un evento de hoy, pero no si esa orden
    -- ya quedo reservada para otro dia.
    AND (o2."fecha_reparto" IS NULL OR o2."fecha_reparto" = ${ventana.fecha}::date)
),
ids_del_dia AS (
  SELECT id FROM ids_reparto
  UNION
  SELECT id FROM ids_recoleccion
)
```

### 3.1 Por qué `UNION` de dos `SELECT` y no un `OR` en un solo `WHERE`

**Son el mismo predicado**: las dos ramas son disjuntas, así que la unión de conjuntos y la
disyunción devuelven exactamente el mismo conjunto de ids (y con `UNION`, no `UNION ALL`, ni siquiera
dependería de que lo fueran). Lo que cambia es **lo que el planificador puede hacer con ellas**:

- Un `OR` entre dos columnas **no se puede expresar como clave de rastreo de un btree**. Medido en la
  246 (`progress/impl_246.md`, escenario 3): con el `OR`, el `Index Cond` se reduce a
  `mensajero_asignado_id IS NOT NULL` y las dos ramas caen al `Filter`. En el ranking eso sale barato
  porque su consulta sólo toca columnas del índice y el plan sigue siendo `Index Only Scan`. **Aquí
  no puede serlo**: este CTE proyecta `o."id"`, que no está en el índice, así que el `Filter` de un
  `Index Scan` se evalúa **sobre la tupla del heap** — una visita al heap por cada orden que haya
  tenido mensajero alguna vez.
- Con las ramas partidas, cada `WHERE` es una conjunción de igualdades y rangos sobre columnas
  indexadas: la rama (b) recupera su `Index Cond` de siempre
  (`mensajero_asignado_id IS NOT NULL AND asignado_at >= … AND asignado_at < …`) y la rama (a) puede
  comprobar `fecha_reparto = …` contra la tupla del índice en vez de contra el heap.

Y no es una idea nueva de esta ficha: **la propia migración de la 246 la nombra** como «la forma que
lo recuperaría —partir el `OR` en dos consultas—», y explica que allí no se hizo *«porque
reestructura la consulta del podio justo después de firmarla»*. Ese motivo **no aplica aquí**: esto
es una pantalla de solo lectura, sin dinero detrás, y el CTE ya es una unión de conjuntos.

> ### ⚠️ Este párrafo NO está medido en esta ficha. Dicho aquí para que nadie lo cite como si lo estuviera.
>
> El razonamiento de arriba es **deducción**, apoyada en dos cosas verificables y en ninguna
> medición propia:
>
> - los **cuatro planes que sí están medidos** (`progress/impl_246.md`) son de **otra consulta** —el
>   denominador del ranking, que agrupa y no proyecta `o."id"`—, con `enable_seqscan = off` para
>   forzar la **forma** del plan, y sobre una base de **decenas de filas**;
> - que un `Index Only Scan` sea imposible aquí es un hecho estructural (`o."id"` no está en el
>   índice), no una medición.
>
> **Con 141 órdenes vivas en producción no hay coste observable**: el planificador hace `Seq Scan`
> con índice y sin él, así que ningún `EXPLAIN` de hoy —tampoco el de T4.1— puede confirmar ni
> desmentir este párrafo. Lo único que T4.1 deja escrito es **la forma** del plan que sale hoy.
> **Si dentro de un año alguien necesita apoyarse en esto, tiene que volver a medirlo con volumen.**
>
> Lo que sí sostiene la decisión sin necesidad de medir: las dos formas son **equivalentes en
> resultado** (ramas disjuntas), así que partir el `OR` no arriesga nada y sólo puede ayudar al
> planificador. Se elige por eso, no por un número.

**Riesgo asumido:** la forma deja de ser *literalmente* igual a la del ranking, y alguien que compare
los dos archivos podría creer que miden cosas distintas. Se cierra escribiéndolo en el comentario del
repositorio, que cita al ranking por nombre, y con un test de forma que afirma las **dos ramas con
sus parámetros**.

### 3.2 Cómo viaja el día (R9), y por qué no como `Date`

El parámetro es **`ventana.fecha`** —el `YYYY-MM-DD` calendario de CR que `ventanaDelDiaEnCursoCR` ya
calcula— con un **`::date` explícito**. Tres razones, todas con precedente en el repo:

1. **No hay segunda definición del día.** `ventana.fecha`, `ventana.desde` y `ventana.hasta` salen
   del mismo objeto: el día de la rama (a) y el rango de la rama (b) **no pueden divergir**.
2. **`startOfDayCR` está prohibido en este árbol** por la guardia `frontera.guardia.test.ts` (R17 de
   la 192) y con razón: devuelve la medianoche **UTC**, y mezclarla con las cotas `…T06:00:00.000Z`
   es el off-by-one que cerró la ficha 166. El ranking sí la usa —es correcto allí, porque compara
   contra una columna `DATE` a través de Prisma—, pero aquí no hace falta ningún `Date`.
3. **Pasar un `Date` a SQL crudo contra una columna `DATE` es la trampa que ya documenta
   `lib/utils/dia-reparto.ts`**: el driver lo serializa con el offset local del proceso y Postgres lo
   convierte usando el `TimeZone` **de la sesión**; con la sesión en `America/Costa_Rica` sale el día
   anterior. Con texto + `::date` no interviene ninguna zona horaria: `'2026-08-21'::date` es el 21 en
   cualquier sesión. Es exactamente lo que ya hace `OrdenRepository.asignarSateliteLote` en su `SET`.

El patrón «parámetro de texto + cast explícito» ya vive en este mismo archivo
(`${ORIGEN_ASIGNACION_RECOLECCION}::"orden_historial_origen_tipo"`) y su motivo es el mismo: el driver
manda los parámetros sin tipo.

---

## 4. Qué se toca, exactamente

| Archivo | Qué cambia |
| --- | --- |
| `lib/repositories/TableroDiaRepository.ts` | `cteIdsDelDia` (las dos ramas + la cláusula de la rama de recolección) y **el comentario de cabecera** (§7). Nada más: las tres consultas lo consumen sin enterarse. |
| `tests/integration/_semilla-tablero-dia.ts` | `SemillaOrden` gana `fechaReparto?: Date \| null` y `crearOrden` lo escribe. Hoy ninguna siembra la fija, así que **todos los tests existentes ejercitan la rama (b)** y siguen verdes tal cual. |
| `tests/…` | Casos nuevos (ver `tasks.md`). |
| **`app/(app)/monitoreo/_components/TableroDiaEstados.tsx`** | `VACIO_TITULO` y `VACIO_DESCRIPCION` (R23/R24/R25). **Sólo literales.** |
| **`app/(app)/monitoreo/_components/MensajeroCard.tsx`** | El `aria-label` de la tarjeta. **Sólo el literal**; `ETIQUETA_ASIGNADAS` (`"Asignadas"`) NO cambia. |
| **`app/(app)/monitoreo/_components/DetalleMensajeroPanel.tsx`** | La cabecera «N órdenes asignadas hoy». |
| **`app/(app)/monitoreo/_components/TableroDiaModule.tsx`** | `DESAPARECIDO_DESCRIPCION` — el cuarto sitio, censado en D2. |

**El frontend va DESPUÉS del backend y no a la vez** (zona `fullstack` ⇒ se secuencia): son archivos
distintos, pero el texto sólo se puede escribir bien cuando el criterio ya está decidido y probado.
Y no lleva ni una línea de lógica: cuatro literales.

**Lo que NO se toca, y es importante que siga sin tocarse:**

- `lib/types/tablero-dia.ts` — el contrato no cambia (R19). Si alguien acaba tocándolo, `--rapido`
  se niega solo y el gate pasa a ser `./init.sh` completo.
- `lib/interfaces/repositories/ITableroDiaRepository.ts` — la firma ya recibe la `VentanaDiaCR`
  entera, que **ya trae `fecha`**. No hace falta un parámetro nuevo.
- `lib/services/TableroDiaService.ts`, la caché, la Server Action y **todo lo que no sea uno de los
  cuatro literales** de `app/(app)/monitoreo/`: ni un componente cambia de forma, de props ni de
  estructura del DOM.
- `RankingRepository` y todo `/ranking`.
- `db/` — ni migración ni índice (§6).

### Contrato de entrada/salida

Sin cambios. `contarPorMensajero(ventana, filtro)`, `listarOrdenesDelDia(ventana, filtro,
mensajeroId, pagina)` y `contarEntregasPorHora(ventana, filtro)` mantienen firma y forma de retorno.
`OrdenDetalleDia.asignadoAt` sigue significando lo mismo («cuándo se puso en manos de alguien») y
sigue sin pintarse en la UI: sólo ordena. El `ORDER BY` del detalle **no cambia**; con el criterio
nuevo, una orden asignada ayer para hoy aparece por debajo de las asignadas hoy, lo cual es
determinista y no pierde información. Ordenar por `fecha_reparto` sería inútil: por construcción,
todas las filas de una página comparten día.

### RLS / permisos

Sin cambios y **sin relajar nada**: no hay policies debajo (Prisma se conecta con credenciales de
servicio), así que el `WHERE` del alcance es la única frontera multi-tenant de esta pantalla. Sigue
aplicándose **una sola vez, después de la unión, sobre `orden.zona_id`** (R16). El `JOIN "orden" o2`
que entra en `ids_recoleccion` **no** trae el recorte de zona con él, aunque ahora sea técnicamente
posible: dos sitios que recortan inquilinos son dos sitios donde equivocarse. Eso queda escrito en el
comentario, porque el motivo de hoy («no conoce todavía la orden») deja de ser cierto.

---

## 5. La otra rama del CTE: `ids_recoleccion` **se queda**, con una cláusula

**Se queda, y éste es el motivo:** «a alguien lo mandaron a recoger hoy» **sí es un evento de hoy**.
Esa vía (feature 157) no estampa `asignado_at` a propósito —esa columna es el denominador del pago y
del premio del mensajero, y estamparla por una recolección le bajaría el porcentaje sin darle forma de
subirlo (192/R59)— y tampoco estampa `fecha_reparto`. Si el tablero la quitara, ese trabajo
desaparecería de la pantalla sin que exista ninguna otra rama que lo recoja. Se queda tal cual: por
`origen_tipo` y por su propio `created_at`, **no** por `asignado_at`.

**Pero la premisa «esas órdenes no tienen día de reparto» sólo es cierta en el instante de la
transición**, y ésta es la secuencia que lo demuestra — **firmada en la puerta del 2026-08-21 y
escrita aquí a petición del humano, porque es la razón de existir de la cláusula**:

| Hora | Qué pasa | Estado de la orden |
| --- | --- | --- |
| **08:00** | El maestro manda a **Ana** a recoger a la tienda. Fila en `orden_historial_estado` con `origen_tipo = asignacion_recoleccion` y `created_at` de hoy. | `mensajero_asignado_id = Ana`; `asignado_at` **NULL**; `fecha_reparto` **NULL** (verificado: `OrdenRepository.asignarRecoleccionLote` no escribe ninguna de las dos, feature 157/192-R59). |
| **14:00** | La orden ya está en bodega central y se asigna a **Beto**, **para mañana**. | `mensajero_asignado_id = Beto` — **se SOBRESCRIBE**; `fecha_reparto = mañana`; estatus `por_recoger`. |
| **hoy, en la pantalla** | La rama de recolección sigue pescándola (su fila de historial es de hoy) y el CTE la agrupa por el mensajero **actual**: 192/R60 obliga a que `ids_recoleccion` seleccione **sólo `orden_id`**, jamás el actor. | **Aparece hoy en la tarjeta de BETO, en `sinRecoger`** — «el mensajero todavía no arrancó con ellas». |

Es decir: **la acusación de «trabajo parado» vuelve por la otra puerta, y encima sobre quien no fue a
recoger ni tiene que repartirla hoy.** No es un caso que esta ficha introduzca —ya pasa hoy—, pero
sería absurdo arreglar la puerta principal y dejar ésta abierta.

**⛔ Esta cláusula no se «simplifica».** Es una línea, no rompe ningún test si desaparece y su motivo
no se deduce leyéndola: por eso el motivo va en el código, no sólo aquí.

Por eso el diseño añade **una** cláusula a esa rama —`fecha_reparto IS NULL OR fecha_reparto = <día>`—
y **no** una regla nueva: es la misma regla del tablero («esto es del día X») aplicada al único
camino que no la tenía. Se escribe **dentro de la rama que corrige** y no después de la unión, porque
`ids_reparto` ya excluye los otros días por construcción y añadirla al final la haría redundante en un
sitio y necesaria en otro, que es como se pierden de vista este tipo de cláusulas.

**Firmado (D1 de la puerta): la cláusula entra.** Coste: una línea. Lo que no se pierde: nada
verdadero — la tarjeta donde aparecía ya no era la de quien fue a recoger.

---

## 6. Índices: **ninguno nuevo**, y no es una intuición

El índice que existe hoy es `("mensajero_asignado_id", "asignado_at", "fecha_reparto")`
(`orden_mensajero_asignado_at_fecha_reparto_idx`, ampliado por la 246). Sirve así:

| Rama | Qué le da el índice |
| --- | --- |
| (b) `mensajero IS NOT NULL` + rango de `asignado_at` + `fecha_reparto IS NULL` | **El mismo `Index Cond` de hoy** (el prefijo de dos columnas), más la tercera columna comprobable contra la tupla del índice. Es exactamente el plan que la 246 midió y conservó. |
| (a) `mensajero IS NOT NULL` + `fecha_reparto = X` | El prefijo sólo aporta `IS NOT NULL`; la igualdad va sobre la tercera columna. No es el plan ideal, pero **es indexable** — y sólo lo es porque las ramas están partidas (§3.1). |
| recolección | No la toca: entra por `orden_historial_estado`. |

**Por qué no se crea ninguno:**

1. **Un índice suelto por `fecha_reparto` está medido y es peor.** La 246 lo probó
   (`progress/impl_246.md`, escenario 1): hace atractivo un `BitmapOr` que degrada a `Bitmap Heap
   Scan`. Y crearlo aquí cambiaría **también** el plan del denominador del ranking, que es una
   consulta con dinero detrás.
2. **No hay volumen con el que decidir.** La propia migración de la 246 lo deja escrito: *«producción
   tiene 141 órdenes vivas y la local 67. A esa escala el planificador hace `Seq Scan` con índice y
   sin él»*. Lo medible hoy es **la forma** del plan, no su coste. Un índice en la tabla más caliente
   se paga en **cada escritura**; pagarlo para arreglar un plan que no se puede medir es especular.
3. **Un índice es una migración**, y una migración obliga al gate completo, cambia el tamaño de la
   ficha y —si nombrara `asignado_at`— tocaría la lista blanca de
   `tests/unit/tablero-dia/asignado-at-solo-lectura.guardia.test.ts`, que es **una guardia de dinero**:
   ahí las entradas se conceden mirándolas a mano, no de paso.

**Lo que sí se hace:** dejar el `EXPLAIN` de la consulta nueva escrito en `progress/impl_259.md`
(forma, no coste, y dicho así) para que quien un día vea la pantalla lenta sepa dónde mirar: la rama
(a) no tiene ningún índice que empiece por `fecha_reparto`, y ése es el sitio.

**Consecuencia para el gate, dicha aquí porque cambia el comando:** al no haber migración ni tocar
`db/schema.prisma`, `lib/types/**` ni configuración de build, **`./init.sh --rapido` no se niega
solo** y es el gate de esta ficha (también para abrir el PR). Si durante la implementación aparece
una migración —es decir, si alguien decide crear el índice— el modo rápido **falla**, y eso no es un
obstáculo que sortear: es la señal de que la ficha cambió de tamaño y hay que decirlo.

---

## 7. Revertir D10 **por escrito** en el código (R21)

Hoy la cabecera de `TableroDiaRepository` dice, entre otras cosas:

> «una orden asignada hoy para mañana **cuenta HOY en esta pantalla y MAÑANA en `/ranking`** […]
> dicho aquí para que nadie la diagnostique como un bug».

Si el criterio cambia y ese texto se queda, **el código miente** — y miente con autoridad, porque el
lector lo tomará por una decisión vigente. Se corrige como este repo corrige las decisiones que
envejecen (el precedente está tres párrafos más arriba en ese mismo archivo: la corrección fechada de
la 246 sobre lo que decía la 192):

- **No se borra el razonamiento de D10.** Se conserva marcado como **SUPERADO**, con su fecha de firma
  (2026-08-20) y su fecha de reversión (2026-08-21), para que dentro de seis meses se pueda
  reconstruir por qué se decidió una cosa y luego la contraria.
- **Se dice el motivo de la reversión en una línea:** D10 razonó sobre `asignadas` y no sobre el cubo
  `sinRecoger`, que es donde la cifra se convierte en «este mensajero va retrasado».
- **Se dice qué mide ahora** y que **coincide en criterio con `/ranking`** — pero **no** en universo:
  el tablero tiene además la rama de recolección, que el ranking no tiene. Sin esa frase, la primera
  vez que alguien compare las dos cifras y no cuadren, abrirá una ficha.
- **Desaparece la frase «para que nadie la diagnostique como un bug»** aplicada al caso que ahora ya
  no ocurre, y desaparece la invitación «si algún día se quiere alinearlas, el `OR` ya está escrito»:
  ya se alinearon.

### 7.1 Y el mismo problema en el spec donde D10 se firmó (R26)

D10 vive explicada con todas sus razones en `specs/246-asignacion-por-dia/requirements.md` §D10. Si
esa página se queda sin marca, quien la lea dentro de seis meses creerá que el tablero sigue contando
por `asignado_at` — el mismo defecto que el comentario del código, en otro soporte.

**Se resuelve con un apéndice, no con una edición** (firmado, D3): **una línea fechada al final de
§D10** que diga que fue **supersedida el 2026-08-21 por la 259** y por qué, sin tocar **ni una
palabra** del texto original. Un spec es la foto de su momento: reescribirlo borraría la única prueba
de que aquella decisión se tomó a conciencia y con sus razones. La guardia de T2.4 comprueba las dos
mitades: que el puntero está **y** que el texto original sigue ahí.

---

## 8. La identidad de los ocho sumandos y el cubo `otros` (R12)

**Se cumple por construcción, y el cambio no la toca.** El razonamiento, explícito:

- `asignadas` es `COUNT(*)` sobre el CTE `asignadas`, es decir **una fila por orden del universo del
  día** (el `UNION` es de conjuntos, nunca `UNION ALL`, así que una orden alcanzable por dos caminos
  aparece una sola vez).
- Los cinco contadores de resultado son `COUNT(*) FILTER (WHERE r.resultado = X)` sobre esas mismas
  filas, con `r` traído por un `LEFT JOIN` a un `DISTINCT ON (orden_id)`: **como mucho una gestión por
  orden**, y los cinco valores del enum son mutuamente excluyentes.
- Los tres cubos son `COUNT(*) FILTER (WHERE r.resultado IS NULL AND …)` con `IN` / `IN` / `NOT IN`
  **de las mismas dos listas**: disjuntos y exhaustivos por construcción.

Esta feature **cambia qué órdenes entran** en el CTE `asignadas`; no toca ni un `FILTER`. Ocho
particiones disjuntas y exhaustivas de un conjunto siguen sumando su cardinalidad sea cual sea el
conjunto. La identidad sigue siendo cierta **por construcción y no a posteriori** — y aun así se
vuelve a afirmar en cada escenario nuevo, como manda la 192.

**El cubo `otros` no cambia de significado** ni recibe tráfico nuevo por este cambio: sigue siendo
«sin gestión vigente hoy y en cualquier otro estatus», y sigue pintándose aunque valga 0. Lo que sí
cambia —y es todo el punto de la ficha— es **`sinRecoger`**: pasa a contener sólo órdenes que de
verdad son de hoy, así que la frase «el mensajero todavía no arrancó con ellas» vuelve a ser cierta.

---

## 9. Las guardias que vigilan este árbol, y cómo quedan

| Guardia | Qué exige | Cómo queda |
| --- | --- | --- |
| `tablero-dia/frontera.guardia.test.ts` (a) | Nadie nombra `startOfDayCR` | ✅ El día sale de `ventana.fecha` (§3.2) |
| … (c) | Nadie lee el rol ni declara una segunda tabla de roles | ✅ No se toca el alcance |
| … (d) | Ni un `findMany`; SQL crudo **sólo** en el repositorio; **tres** consultas clasificadas `["agregada","paginada","agregada"]`, en ese orden | ✅ No entra ninguna consulta nueva y ninguna cambia de sitio ni pierde su `GROUP BY` / `LIMIT` |
| `tablero-dia/asignado-at-solo-lectura.guardia.test.ts` | Ni una escritura en el árbol; lista blanca **cerrada** de migraciones que tocan la columna; y el repositorio **sí** la lee | ✅ Se sigue leyendo (rama (b) + el `COALESCE` del orden del detalle), no se escribe, y no entra ninguna migración |
| `guards/fecha-reparto-acompana-asignado-at.guardia.test.ts` | Toda escritura de `asignado_at` en `lib/` toca `fecha_reparto` | ✅ Esta feature no escribe ninguna de las dos |
| `analytics/cache-config.guardia.test.ts` | El literal `3600` está prohibido en `lib/repositories/` | ✅ No se escribe ningún número nuevo |
| `tablero-dia/buckets-estatus.guardia.test.ts` | `BUCKET_POR_ESTATUS` es la única declaración del mapa | ✅ No se toca |

**Tests de forma existentes que deben seguir verdes sin editarlos** (si alguno se pone rojo, hay que
mirarlo, no ajustarlo): `tablero-dia-sql.test.ts` afirma el `IS NOT NULL` y el rango de `asignado_at`
(los conserva la rama (b)), una sola aparición de `"zona_id"` **después** de `ids_del_dia AS`, `UNION`
sin `UNION ALL`, y que no aparece `actor_usuario_id`.

---

## 10. Alternativas descartadas

**A1 — Dejar el `OR` en un solo `WHERE`, calcado del ranking.** *Descartada.* Es el diff más pequeño y
la copia más literal, pero un `OR` entre dos columnas no puede ser clave de rastreo de un btree: el
`Index Cond` se reduce a `mensajero_asignado_id IS NOT NULL` y el resto cae al `Filter`, que en esta
consulta —que proyecta `o."id"`— se evalúa **sobre el heap**, una visita por cada orden que haya
tenido mensajero alguna vez. En el ranking eso no se paga porque su plan es `Index Only Scan`; aquí no
puede serlo. La propia migración de la 246 nombra «partir el `OR` en dos consultas» como la forma que
recupera el plan, y el motivo por el que allí no se hizo (reestructurar la consulta del podio recién
firmada) no aplica a una pantalla de solo lectura. **Se conserva la equivalencia por escrito**, que es
lo que A1 compraba.

**A2 — `COALESCE(fecha_reparto, día(asignado_at)) = <día>`.** *Descartada,* y ya lo estaba en el
ranking: no es indexable por ningún índice existente, y obliga a meter `- interval '6 hours'` dentro
del SQL para derivar el día calendario CR de un `timestamp` — **la segunda definición del día** que el
diseño de la 192 prohíbe y el off-by-one que cerró la ficha 166.

**A3 — Backfill de `fecha_reparto` para las órdenes viejas y quedarse sólo con la rama (a).**
*Descartada.* Sería un `UPDATE` masivo sobre la tabla más caliente **para inventar un dato que nadie
eligió** (la 246 ya lo descartó por eso mismo), y no arregla nada que la rama (b) no arregle sola y sin
tocar una fila. Además dejaría el tablero sin respuesta para cualquier vía futura que asigne sin
estampar la columna.

**A4 — Filtrar por día en el servicio, después de leer.** *Descartada por el guardia y por la deuda que
lo motivó:* traer las órdenes del día a memoria para clasificarlas en TypeScript es exactamente lo que
`frontera.guardia.test.ts` prohíbe (`findMany`, consultas ni agregadas ni paginadas) y es la deuda de
la ficha 191. Además el detalle es paginado: filtrar después de paginar da páginas de tamaño variable
y un `total` que no cuadra con la tarjeta.

**A5 — Añadir un índice `(fecha_reparto, mensajero_asignado_id)`.** *Descartada en esta ficha.* Ver
§6: está medido que un índice liderado por `fecha_reparto` empeora el plan del ranking, no hay volumen
con el que decidir por coste (141 órdenes vivas en producción), y una migración cambia el gate y toca
una guardia de dinero. Queda nombrado como seguimiento, con el sitio exacto donde mirar.

**A6 — Que la orden reservada para mañana siga apareciendo hoy, pero en un noveno cubo
(«reservadas»).** *Descartada.* Es un contador nuevo y un cambio de contrato (`lib/types/`, gate
completo) para resolver por adición un problema que se resuelve por criterio; y R25 de la 192 dejaría
de ser una identidad de **ocho** sumandos, que es la propiedad de la que depende que la barra de
composición sume 100 %. Si alguien quiere ver «lo que hay reservado para mañana», es una pantalla, no
un cubo dentro de la de hoy.

---

## 11. Riesgos, y qué los tapa

| Riesgo | Qué lo tapa |
| --- | --- |
| **Un test de servicio con dobles no ve el `WHERE`.** En este repo ya hubo un caso donde una mutación del `WHERE` dejaba **11 tests de servicio en verde**. | El criterio se prueba **contra Postgres real** (`tests/integration/tablero-dia-*.test.ts`) y `tasks.md` exige **matarlo con mutaciones** y reportar qué pasó. |
| **La integración se salta sin base y reporta verde.** `describeSiHayBase` usa `describe.skip` si no hay `DATABASE_URL`. | `tasks.md` exige reportar **cuántos casos se EJECUTARON** (no «pasaron»): una suite saltada no es evidencia de nada. |
| **La rama (a) no la ejercita ningún test de hoy**, porque la siembra nunca fija `fechaReparto`. | La siembra gana el campo y los casos nuevos lo usan; la mutación M2 lo demuestra. |
| **El plan de la consulta puede degradarse con volumen.** | `EXPLAIN` anotado en `progress/impl_259.md` diciendo que mide **forma**, no coste; §3.1 declara que el razonamiento de indexabilidad **no está medido aquí**, y §6 dice dónde mirar. |
| **La pantalla diría una cosa y el texto otra.** | Cerrado: los **cuatro** literales entran en esta ficha (R23-R25, tanda **T7**), y se comprueban leyendo el texto en los tests de componente que ya existen. |
| **Quien opera lee «desaparecieron» donde hay «están en mañana».** | Cerrado: aviso obligatorio **antes de desplegar** (T8), que **bloquea la release**. |
| **`dev` se mueve mientras tanto** (la 260 toca el mismo contrato del detalle). | La 260 toca `lib/types/tablero-dia.ts` y el detalle; ésta toca `cteIdsDelDia`. No hay intersección de archivos salvo el repositorio: **no correr las dos a la vez sobre `TableroDiaRepository.ts`**. |

---

## 12. Decisiones cerradas — no queda ninguna pregunta abierta

Las cuatro se firmaron en la puerta humana del **2026-08-21** y el recibo entero (con el razonamiento
de cada una) vive al final de `requirements.md`:

| # | Firmada | Efecto en este diseño |
| --- | --- | --- |
| **D1** (rama de recolección) | **SÍ, la cláusula entra** | §5 pasa a firme y **gana la secuencia 08:00/14:00** que la justifica. Ningún cambio técnico respecto de lo ya escrito. |
| **D2** (los textos) | **SÍ, en esta ficha** | La ficha pasa a **`fullstack`**: §4 gana cuatro archivos de `app/(app)/monitoreo/` —sólo literales— y una tanda de frontend **secuenciada después** del backend. |
| **D3** (puntero en la 246) | **SÍ, apéndice fechado** | §7.1, nueva. |
| **D4** (aviso operativo) | **SÍ, bloquea el despliegue** | Sale de «riesgos» y entra como tarea de release (T8). |

**Nada de esto obligó a rehacer el diseño técnico ya cerrado.** El criterio (§2), la forma del SQL
(§3), el parámetro del día (§3.2), la identidad de los ocho sumandos (§8) y el veredicto de índices
(§6) quedan **exactamente** como estaban. Lo único que cambió de fondo es **el tamaño de la ficha**
(una tanda de frontend más) y **una advertencia de honestidad** en §3.1: el argumento de
indexabilidad que sostiene «dos `SELECT` en vez de un `OR`» **no está medido en esta ficha**, y queda
dicho para que nadie lo cite dentro de un año como si viniera de un `EXPLAIN` propio.
