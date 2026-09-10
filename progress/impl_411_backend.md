# Ficha 411 — Bitácora de implementación · BACKEND (B1–B6)

> Zona `fullstack`, secuenciada backend → frontend. **Esta bitácora cubre B1–B6.**
> B7 (la tabla en pantalla) es de otro agente, sobre esta misma rama.
> Rama: `feat/411-analitica-cohorte-de-carga` · SHA base: `ecd3a1ff` (`dev`).

---

## 0 — Qué entrega esto

Una **cohorte de carga**: de las N órdenes que se cargaron un día CR, cuántas se entregaron,
cuántas se devolvieron a tienda, cuántas acabaron en incidente, cuántas siguen **vivas**, y en
cuántos días. El ancla es `orden.created_at` —el día en que entró el lote— y la orden se sigue
**hasta su desenlace, caiga donde caiga en el tiempo**.

Lo que ya había y no contesta esto: los KPI del día se calculan sobre el **inventario vivo al
corte**, que incluye órdenes cargadas semanas antes; y `CicloVidaRepository` mide «de lo que CERRÓ
esta semana, cuánto tardó». Son otras dos preguntas.

---

## 1 — T0.1 · Los doce símbolos, leídos EN DISCO

Ninguno faltaba ni estaba donde el diseño no decía. Confirmados con `grep -n` sobre el archivo
real (no con el índice del MCP, que devuelve de más):

| Símbolo | Archivo real | Línea |
| --- | --- | --- |
| `resolverRango` | `lib/analytics/ranges.ts` | 117 |
| bloque **(c)**, la trampa `startOfDayCR` | `lib/analytics/ranges.ts` | 39–61 |
| `inicioDelDiaCREnUtc` | `lib/utils/fecha-cr.ts` | 118 |
| `inicioDelDiaSiguienteCREnUtc` | `lib/utils/fecha-cr.ts` | 129 |
| `condicionDeVentanaTerminal` (**el que NO se copia**) | `lib/repositories/CicloVidaRepository.ts` | 125 |
| `TERMINALES` (privado) | `lib/repositories/CicloVidaRepository.ts` | 63 |
| `TERMINALES` (privado) | `lib/repositories/AnaliticaOperativaVivaRepository.ts` | 48 |
| `ESTADOS_TERMINALES` | `lib/types/order-status-transiciones.ts` | 509 |
| `prepararConteoEntregas` | `lib/analytics/entregas-conteo.ts` | 365 |
| `ConsultaConteoEntregas` (marca `unique symbol`) | `lib/analytics/entregas-conteo.ts` | 318 |
| `claveConPrefijo` | `lib/analytics/entregas-conteo.ts` | 470 |
| `condicionesSinFecha` | `lib/repositories/ConteoCargadasPorDiaRepository.ts` | 133 (antes 128) |
| `DIA_CR` (era privado; hoy exportado, T2.1) | `lib/repositories/ConteoCargadasPorDiaRepository.ts` | 98 |
| `condicionDeAlcance` | `lib/repositories/ConteoPorStatusRepository.ts` | 65 |
| `contarOrdenes` / `ORDENES` / `ORDENES_CERRADAS` / `rotuloConBase` | `app/(app)/analitica/_components/entregas/base-del-kpi.ts` | 62 / 46 / 53 / 74 |
| `orden @@index([createdAt])` | `db/schema.prisma` | 787 |
| `orden_historial_estado @@index([ordenId, createdAt])` | `db/schema.prisma` | 2222 |

Los dos `TERMINALES` **siguen sin `export`**, tal como decía el diseño: por eso esta ficha rinde la
misma constante con la misma línea en vez de importar la de un vecino, y lo que impide una tercera
lista es el censo T2.4.

## 2 — T0.3 · Foto de los siete censos ANTES de tocar nada

```
pnpm exec vitest run tests/unit/analytics/{alcance-obligatorio,modulo-puro,cache-clave-alcance,
  cache-tags,ranges-reuso,tablero-operativo-frontera}.guardia.test.ts \
  tests/unit/analytics/refrescar-cache-analitica.test.ts

 Test Files  7 passed (7)
      Tests  89 passed (89)
   Duration  5.00s
```

El número que la ficha mueve: **7 verticales de `TAGS_ANALITICA` → 8**.

## 3 — T0.2 · El coste de la consulta, medido

⚠ **Medido contra la base LOCAL, no contra producción, y hay que decirlo.** Este agente no tiene el
MCP de Supabase en su conjunto de herramientas y la `DATABASE_URL` de producción es *sensitive*
(irrecuperable por CLI). Los seis números son de `localhost:5432/ordenex`, con el SQL de
`design.md §2` ejecutado tal cual en solo lectura. **La medición contra producción queda pendiente
y no la puede hacer este agente.** Contexto que la relativiza: producción se vació a propósito el
2026-08-25 (arranque comercial), así que hoy allí también son cientos de filas.

> **CERRADO DESPUÉS, y esta sección NO se reescribe** (era cierta cuando se escribió). El leader
> corrió la medición **contra producción** en solo lectura el 2026-09-10: 31 filas y
> `Execution Time` **19,766 ms** (30 días) / **25,509 ms** (366 días), con `Seq Scan` en las dos
> tablas. Cambia el MOTIVO de «no hace falta índice» —es barata por tamaño, no por índice— y deja
> un hueco nuevo: los dos rangos abarcan lo mismo, así que un rango largo de verdad sigue sin
> medirse. Detalle en `progress/impl_411_frontend.md` y en la nota de T6.2 de `tasks.md`.

Tamaño de la base local: `orden` = **70** filas · `orden_historial_estado` = **207** filas.

| rango | ventana | filas devueltas | ms de reloj | `Planning Time` | `Execution Time` |
| --- | --- | --- | --- | --- | --- |
| 30 días | `[2026-08-12T06:00Z, 2026-09-11T06:00Z)` | **1** | 10 (primera llamada, en frío) | 0,421 ms | **0,145 ms** |
| 366 días | `[2025-09-10T06:00Z, 2026-09-11T06:00Z)` | **8** | 1 | 0,312 ms | **0,303 ms** |

Planes (`EXPLAIN ANALYZE`, seq scan ACTIVADO, o sea el plan que Postgres elige de verdad):

- **30 días:** `Index Scan using orden_created_at_idx on orden o` con
  `Index Cond: created_at >= ... AND created_at < ...`; el CTE `cierre` resuelve con
  `Hash Join` sobre `orden_historial_estado` (207 filas: leerla entera es lo más barato ahí).
- **366 días:** `Seq Scan on orden` (69 de 70 filas pasan el filtro: con esa selectividad el índice
  no compensa, y es correcto) + `Nested Loop` con `Memoize` sobre `order_status`.

Con 70 y 207 filas el planificador **no puede** preferir un índice, y por eso T6.1 mide con
`enable_seqscan = off`: lo que R36 necesita demostrar no es qué plan elige hoy esta base de
desarrollo, sino que **existe un índice aplicable** para cuando la tabla crezca.

---

## 4 — Archivos

### Creados

| Archivo | Qué es |
| --- | --- |
| `lib/types/cohorte-carga.ts` | **El DTO** (T1.1). `CohorteDesenlace` DERIVADO de `ESTADOS_TERMINALES`, `CohorteCubo`, `CohorteDeDia`, `CohorteCargaDTO`, `ResultadoCohorteCarga` con `sin_rango`. Es lo que obliga al gate completo. |
| `lib/interfaces/repositories/ICohorteCargaRepository.ts` | El puerto (T1.2). `contarCohortes` → `CohorteCuboCrudo[]`: `n` y `segundosAcum`, jamás un promedio. |
| `lib/repositories/CohorteCargaRepository.ts` | La consulta (T2.2). `condicionesDeCohorte` pura y exportada, `$queryRaw` único, `ORDER BY 1 DESC`. |
| `lib/services/CohorteCargaService.ts` | El servicio (T3.1). Caché, sello dentro del productor, `total`/`totalPorDesenlace`/`promedioSegundos` derivados. |
| `lib/actions/cohorte-carga.ts` | La Server Action (T3.2). Orden del borde con `sin_rango` DESPUÉS de la denegación. Lleva `@sin-superficie` hasta B7. |
| `tests/integration/db/_cohorte-carga.ts` | Utilidades compartidas de los 8 archivos de integración (no es `.test.ts`). |
| `tests/integration/db/cohorte-carga-fechas.int.test.ts` | T4.1 — la trampa horaria. |
| `tests/integration/db/cohorte-carga-desenlaces.int.test.ts` | T4.2 — los cuatro cubos. |
| `tests/integration/db/cohorte-carga-ultima-terminal.int.test.ts` | T4.3 — la ÚLTIMA terminal y el desempate. |
| `tests/integration/db/cohorte-carga-ventana.int.test.ts` | T4.4 — **la inversión** (§0). |
| `tests/integration/db/cohorte-carga-reloj.int.test.ts` | T4.5 — numerador y denominador. |
| `tests/integration/db/cohorte-carga-alcance.int.test.ts` | T4.6 — la frontera multi-tenant, en SQL. |
| `tests/integration/db/cohorte-carga-equivalencia.int.test.ts` | T4.7 — no divergir de la serie hermana. |
| `tests/integration/db/cohorte-carga-indices.int.test.ts` | T6.1 — el `EXPLAIN`. |
| `tests/unit/analytics/cohorte-carga-sql.test.ts` | T2.3 — el `where`, sin base. |
| `tests/unit/analytics/cohorte-terminales.guardia.test.ts` | T2.4 — el censo de literales. |
| `tests/unit/analytics/cohorte-carga-servicio.test.ts` | T5.1 + T1.3 — servicio y clave. |
| `tests/unit/analytics/cohorte-carga-action.test.ts` | T5.2 — el borde. |
| `tests/unit/analytics/cohorte-consulta-unica.test.ts` | T5.3 — una consulta por lectura. |

### Modificados

| Archivo | Qué cambió |
| --- | --- |
| `lib/analytics/entregas-conteo.ts` | T1.3: el **octavo** prefijo — `TAG_COHORTE_CARGA` y `claveDeCohorteCarga`. Nada más. |
| `lib/repositories/ConteoCargadasPorDiaRepository.ts` | T2.1: **sólo el `export`** de `DIA_CR` (más el comentario que dice por qué). El fragmento NO se copió. |
| `lib/actions/analitica-refrescar.ts` | T3.3: `TAG_COHORTE_CARGA` en `TAGS_ANALITICA`. 7 verticales → 8. |
| `tests/unit/analytics/refrescar-cache-analitica.test.ts` | T3.3: **las dos** aserciones —la lista a mano y la CUENTA (`7 + …` → `8 + …`)— más un caso propio del tag nuevo. |

**No se tocó `app/(app)/**`.** No se tocó `feature_list.json` ni `progress/current.md`.

---

## 5 — ⚠ VER EL ROJO · T4.1 y T4.4

No es una casilla: es el entregable. Las dos salidas están pegadas tal cual.

### 5.1 T4.1 — la cota `startOfDayCR` contra un `timestamp`

Mutación aplicada a `condicionesDeCohorte`:

```ts
Prisma.sql`o."created_at" >= ${startOfDayCR(rango.desde)}`,
Prisma.sql`o."created_at" <  ${new Date(startOfDayCR(rango.hasta).getTime())}`,
```

```
 FAIL  tests/integration/db/cohorte-carga-fechas.int.test.ts > 411/T4.1 — la cohorte agrupa por el dia CR de la CARGA > agrupa cada orden por el dia calendario CR de su `created_at`
AssertionError: expected [ '2001-06-16', '2001-06-15', …(1) ] to deeply equal [ '2001-06-16', '2001-06-15' ]

- Expected
+ Received

  [
    "2001-06-16",
    "2001-06-15",
+   "2001-06-14",
  ]

 ❯ tests/integration/db/cohorte-carga-fechas.int.test.ts:134:18

 FAIL  ... > una orden de las 23:50 CR del dia D cae en la cohorte D, y una de las 00:10 CR del D+1 en la D+1
AssertionError: expected 1 to be 2 // Object.is equality

- Expected
+ Received

- 2
+ 1

 FAIL  ... > los bordes de la ventana son las 06:00Z: la tarde del dia anterior queda FUERA y la noche del ultimo dia DENTRO
AssertionError: expected true to be false // Object.is equality

- Expected
+ Received

- false
+ true

 ❯ tests/integration/db/cohorte-carga-fechas.int.test.ts:164:54
    164|     expect(filas.some((f) => f.fecha === D_MENOS_1)).toBe(false);

 Test Files  1 failed (1)
      Tests  3 failed (3)
```

**Lo que dice ese rojo, y es exactamente lo que el diseño predijo:** con la cota desplazada seis
horas aparece **una cohorte `2001-06-14` que nadie pidió** —la orden cargada a las 18:10 hora de
pared CR del día anterior— y se **cae** la de las 23:50 del último día del rango, dejando esa
cohorte en 1 en vez de 2. Ningún número parece raro: son enteros razonables en la cohorte de al
lado.

### 5.2 T4.4 — la ventana sobre el CIERRE en vez de sobre la CARGA (§0)

Mutación aplicada al CTE `cierre` (la línea que se copiaría de `CicloVidaRepository`):

```sql
WHERE s."value" IN (${TERMINALES})
  AND ${condicionDeVentanaTerminal(consulta)}
```

```
 ❯ tests/integration/db/cohorte-carga-ventana.int.test.ts (2 tests | 1 failed) 497ms
     × una orden cargada DENTRO y cerrada DESPUES del `hasta` cuenta igual, y en su cubo terminal 414ms
     ✓ una orden cargada FUERA del rango y cerrada DENTRO no aparece en ninguna cohorte 33ms

 FAIL  tests/integration/db/cohorte-carga-ventana.int.test.ts > 411/T4.4 — la ventana cae sobre la CARGA, nunca sobre el cierre > una orden cargada DENTRO y cerrada DESPUES del `hasta` cuenta igual, y en su cubo terminal
AssertionError: la orden cargada el dia D no aparecio en su cohorte: expected [ 'viva' ] to include 'entregada'
 ❯ tests/integration/db/cohorte-carga-ventana.int.test.ts:114:7
    114|     ).toContain("entregada");

 Test Files  1 failed (1)
      Tests  1 failed | 1 passed (2)
```

**`expected [ 'viva' ] to include 'entregada'`** es el fallo mudo con nombre y apellidos: una orden
que SÍ se entregó sale contada como «sigue en la calle», sólo porque cerró después del `hasta`. En
pantalla habría salido una cohorte con números plausibles y una tasa de entrega hundida, y nadie lo
habría visto.

Las dos mutaciones se **revirtieron** y los dos archivos volvieron a verde antes de seguir.

---

## 6 — Mutaciones: 14 aplicadas, 13 muertas, 1 equivalente

Campaña scriptada (aplicar → correr → revertir siempre), con autocomprobación: el script exige
que el árbol limpio esté VERDE antes de empezar y que el texto de la mutación se haya aplicado de
verdad. Suite usada: los 7 archivos de `integration/db` de la cohorte + los 4 unitarios + el censo
+ `refrescar-cache-analitica`.

| # | Mutación | Veredicto | Quién la mata |
| --- | --- | --- | --- |
| M1 | `ORDER BY 1 ASC` (la cohorte más antigua primero) | muerta | equivalencia, fechas, consulta-unica |
| M2 | sin desempate por `id` en el `DISTINCT ON` | muerta | ultima-terminal › el empate de `created_at` |
| M3 | `COALESCE(SUM(...), 0)`: el cubo `viva` pasa a valer cero | muerta | reloj › numerador AUSENTE |
| M4 | la cota alta pasa a `<=` | muerta | fechas › la ventana es SEMIABIERTA · sql |
| M5 | la cota baja pasa a `>` | muerta | fechas (3 casos) · sql |
| M6 | `JOIN` en vez de `LEFT JOIN` (desaparecen las vivas) | muerta | equivalencia, fechas |
| M7 | la PRIMERA transición terminal en vez de la última | muerta | ultima-terminal |
| M8 | el día UTC en vez del día CR | muerta | fechas (3 casos) |
| M9 | sin la condición de alcance | **muerta — ver abajo** | sql › posición 0 · alcance › «sostiene el recorte ella sola» |
| M10 | sin el soft delete | muerta | desenlaces (4 casos), equivalencia |
| M11 | el servicio deja viajar los cubos con `n = 0` | muerta | servicio |
| M12 | el servicio reordena ascendente | muerta | servicio (4 casos) |
| M13 | invertir el orden del borde (`sin_rango` antes de denegar) | **SOBREVIVIÓ — mutante EQUIVALENTE** | — |
| M13b | la inversión REAL: mirar el rango antes de resolver el alcance | muerta | action (3 casos) |
| M14 | el promedio pasa a `0` cuando no hay denominador | muerta | servicio › «sin denominador es `null`, nunca cero» |

### 6.1 M9 sobrevivió en la primera pasada, y eso cambió un test

**La primera vez que borré la condición de alcance, los cuatro casos de integración de T4.6
siguieron VERDES.** No es que fueran flojos: es el *cinturón y tirantes* que este repo documenta.
`recortarFiltroConteoEntregas` escribe el recorte **dentro del filtro** (`tienda_id: [tienda1]`) y
las facetas del filtro también acaban en el `WHERE`; con las dos piezas puestas, quitar una no
cambia ni una fila.

Lo que se hizo: **un caso nuevo** que le quita al filtro esa faceta y deja **sólo** el alcance
(`la condicion de ALCANCE sostiene el recorte ella sola, sin la faceta del filtro`). Con él, la
mutación muere:

```
 FAIL  ... > la condicion de ALCANCE sostiene el recorte ella sola, sin la faceta del filtro
AssertionError: expected 4 to be 2 // Object.is equality
```

### 6.2 Por qué M13 es un mutante EQUIVALENTE y no un agujero

La inversión literal no se puede escribir: `PreparacionConteoEntregas` es una unión discriminada y
`preparada.consulta` **no existe** en la rama `forbidden`, así que TypeScript obliga a guardar el
`sin_rango` con `status !== "forbidden"` — que sigue denegando primero. Es decir: el mutante
compila y hace lo mismo. Por eso se escribió **M13b**, que es la inversión que alguien escribiría
de verdad («miro el rango primero, que es barato y no toca nada»), y esa **muere** con tres casos.

---

## 7 — T6.2 · Decisión de índice, con los números delante

**NO hace falta migración. R37 no se dispara.**

El `EXPLAIN` de T6.1 (consulta REAL capturada del repositorio con el cliente espía, con
`SET LOCAL enable_seqscan = off`) dice:

- `orden`: `Index Scan using orden_created_at_idx on orden o` con
  `Index Cond: ((created_at >= '2001-06-15 06:00:00') AND (created_at < '2001-06-18 06:00:00'))`. ✔
- `orden_historial_estado`: **sin `Seq Scan`**, y entra por
  `Bitmap Index Scan on orden_historial_estado_orden_id_estatus_destino_id_idx` con
  `Index Cond: (orden_id = c_1.orden_id)`.

⚠ **La medición desmintió al diseño en un punto, y se escribe en vez de ajustarlo en silencio.**
`design.md §1.2` daba por hecho que el plan nombraría
`orden_historial_estado_orden_id_created_at_idx` («exactamente la forma del `DISTINCT ON`»). No lo
nombra: al JOINear el historial **contra la cohorte**, el acceso es por igualdad de `orden_id`
—donde los dos índices empatan, porque los dos lo llevan de primera columna— y el orden del
`DISTINCT ON` se resuelve con un `Sort` sobre las pocas filas que quedan.

**Qué significa:** R36 exige que el plan no recurra a un recorrido secuencial de
`orden_historial_estado` teniendo alternativa, y no lo hace; y el índice por el que entra **ya
existe** (feature 67/R24, conteo de intentos). Ningún índice nuevo, ninguna migración, ningún
`down.sql`. Lo que sí se hizo es **atar el test al requisito y no a la elección concreta del
planificador**: se afirma «entra por uno de los dos índices aplicables de esa tabla y no por un Seq
Scan», porque un test atado al nombre exacto se pondría rojo el día que cambien las estadísticas
de la tabla sin que nada estuviera mal. Los dos casos del datamodel (`@@index` declarado en
`db/schema.prisma`) siguen en pie, y el caso discriminante también.

---

## 8 — Mapa `R<n>` → test

Los 33 requisitos de backend. **R31, R32, R33, R34, R35 y R39 son de B7 (frontend)** y no los cubre
esta bitácora; la mitad de UI de R24 tampoco.

| R | Test (archivo › nombre exacto del caso) |
| --- | --- |
| R1 | `cohorte-carga-fechas.int.test.ts` › agrupa cada orden por el dia calendario CR de su `created_at` |
| R2 | `cohorte-carga-fechas.int.test.ts` › una orden de las 23:50 CR del dia D cae en la cohorte D, y una de las 00:10 CR del D+1 en la D+1 **(+ el rojo de §5.1)** |
| R3 | `cohorte-carga-fechas.int.test.ts` › los bordes de la ventana son las 06:00Z… · › la ventana es SEMIABIERTA: el `desde` entra y el `hasta` no · `cohorte-carga-sql.test.ts` › hay exactamente dos condiciones sobre `o.created_at`, con `>=` y con `<` · › las cotas son las 06:00Z, y el `hasta` es el dia siguiente al pedido |
| R4 | `cohorte-carga-desenlaces.int.test.ts` › una orden borrada no esta en ningun cubo · `cohorte-carga-sql.test.ts` › excluye las ordenes borradas |
| R5 | `cohorte-carga-action.test.ts` › un filtro valido SIN rango es `sin_rango`, y no toca el servicio ni la cache · › un `mensajero` SIN rango es `forbidden`, no `sin_rango` · › sin sesion y sin rango es `unauthenticated`, no `sin_rango` · `cohorte-carga-sql.test.ts` › sin rango la consulta no se construye: se dice en voz alta |
| R6 | `cohorte-carga-equivalencia.int.test.ts` › las fechas salen DESCENDENTES aqui y ASCENDENTES alli, y no hay dias vacios · `cohorte-carga-servicio.test.ts` › conserva el orden descendente tal y como llega |
| R7 | `cohorte-carga-desenlaces.int.test.ts` › los cubos que salen son EXACTAMENTE los cuatro del contrato · › cada orden aparece en UN cubo y en uno solo |
| R8 | `cohorte-terminales.guardia.test.ts` › no contiene ninguno de los `value` terminales como literal · › SI importa `ESTADOS_TERMINALES` del dominio · (+ las 4 autocomprobaciones del detector) |
| R9 | `cohorte-carga-ultima-terminal.int.test.ts` › una orden entregada, revertida y devuelta cuenta UNA vez y en `devuelta_a_tienda` · › dos transiciones terminales con el MISMO `created_at` dan un resultado estable |
| R10 | `cohorte-carga-desenlaces.int.test.ts` › `rechazada` y `devuelta` cuentan como VIVAS, no como devueltas |
| R11 | `cohorte-carga-equivalencia.int.test.ts` › dia a dia, la suma de los cubos es el conteo de `contarCargadasPorDia` · › el total del recorte coincide con el total de la serie hermana · `cohorte-carga-servicio.test.ts` › `cargadas` es la suma exacta de los cubos del dia |
| R12 | `cohorte-carga-ventana.int.test.ts` › una orden cargada DENTRO y cerrada DESPUES del `hasta` cuenta igual, y en su cubo terminal · › una orden cargada FUERA del rango y cerrada DENTRO no aparece en ninguna cohorte **(+ el rojo de §5.2)** |
| R13 | `cohorte-carga-desenlaces.int.test.ts` › la ultima GESTION vigente no decide el cubo: lo decide la transicion |
| R14 | `cohorte-carga-reloj.int.test.ts` › `segundosAcum` es la suma EXACTA en segundos y `n` su denominador |
| R15 | `cohorte-carga-servicio.test.ts` › cada cubo trae `n`, `segundosAcum` y `promedioSegundos` · `cohorte-carga-reloj.int.test.ts` › el repositorio no devuelve promedios: solo numerador y denominador |
| R16 | `cohorte-carga-reloj.int.test.ts` › el cubo `viva` trae el numerador AUSENTE, y no cero · `cohorte-carga-servicio.test.ts` › el cubo `viva` trae el numerador y el promedio AUSENTES, no en cero |
| R17 | `cohorte-carga-servicio.test.ts` › sin denominador es `null`, nunca cero · › un dia sin ninguna cerrada no inventa un promedio de cero |
| R18 | `cohorte-carga-reloj.int.test.ts` › el reloj arranca en `created_at`, no en la primera asignacion |
| R19 | `cohorte-carga-sql.test.ts` › va en la POSICION 0, antes que cualquier faceta del cliente y antes que la ventana |
| R20 | `cohorte-carga-alcance.int.test.ts` › con alcance de TIENDA solo salen las de su tienda · › con alcance de ZONA solo salen las de su zona (el adminSatelite VE la seccion) · › con alcance GLOBAL salen las cuatro · › los tres recortes son DISTINTOS entre si · › la condicion de ALCANCE sostiene el recorte ella sola, sin la faceta del filtro |
| R21 | `cohorte-carga-action.test.ts` › el `mensajero` es `forbidden` y no toca el repositorio · › el canal `apiKey` es `forbidden` y no toca el repositorio · › un rol inventado tambien cae |
| R22 | `cohorte-carga-action.test.ts` › pedir la tienda de otro es `forbidden`, no una cohorte vacia · › pedir una zona ajena tambien es `forbidden` |
| R23 | `cohorte-carga-action.test.ts` › una clave desconocida es `validation_error` · › y se rechaza SIN preguntar por el alcance |
| R24 | `cohorte-carga-sql.test.ts` › con `mensajero_id` no aparece ningun `EXISTS` sobre `gestion_orden` · › las otras cinco facetas SI recortan · *(la advertencia en pantalla es B7)* |
| R25 | `cohorte-carga-action.test.ts` › audita con su propio nombre y su motivo · › el motivo se queda en el log: la respuesta solo dice `forbidden` |
| R26 | `cohorte-carga-action.test.ts` › ok, sin_rango, unauthenticated, forbidden y validation_error · › `sin_rango` NO es `validation_error` ni una tabla vacia |
| R27 | `cohorte-carga-servicio.test.ts` › dos lecturas de la MISMA entrada llevan el mismo sello · › una consulta DISTINTA vuelve a producir, y sella de nuevo |
| R28 | `cohorte-carga-servicio.test.ts` › difiere de las otras SIETE con la MISMA consulta · › dos actores con alcance distinto no comparten entrada · › empieza por su propio tag · › el rango RESUELTO entra en la clave, y nunca el centinela `*` |
| R29 | `refrescar-cache-analitica.test.ts` › el tag de la cohorte de carga está, y su prefijo es propio · › el tag de productos está, y el total de tags subió de 6 a 7 verticales *(la CUENTA, hoy `8 + TAGS_OPERATIVA.length`)* |
| R30 | `cohorte-carga-servicio.test.ts` › `total` es la suma de las cargadas, no una segunda consulta · › `totalPorDesenlace` agrega los mismos cubos sobre todos los dias |
| R36 | `cohorte-carga-indices.int.test.ts` › el plan entra a `orden_historial_estado` POR INDICE, y no por un Seq Scan · › y tambien el de la ventana de carga sobre `orden(created_at)` · › el caso DISCRIMINA: sin ningun indice aplicable el plan vuelve al Seq Scan |
| R37 | **No se dispara** (§7, con los números delante). Cubierto por lo que sí aplica: `cohorte-carga-indices.int.test.ts` › `orden` declara `@@index([createdAt])` · › `orden_historial_estado` declara `@@index([ordenId, createdAt])` · › los dos indices estan aplicados en esta base |
| R38 | `cohorte-consulta-unica.test.ts` › con un solo dia / una semana / un mes / el tope de 366 dias / un preset / con las seis facetas puestas hace exactamente una llamada a `$queryRaw` · › y esa unica consulta trae la agrupacion por dia dentro, no fuera · › dos lecturas seguidas son dos consultas |

### Contraprueba de escenario no vacío

Los 7 archivos de `integration/db` empiezan **cada caso** con
`expect(filas.length).toBeGreaterThan(0)` antes de afirmar nada. Ninguno usa `if (!fks) return;`:
sin catálogo revientan con un mensaje que lo dice. Y el caso `global` de T4.6 **mide** la línea base
de la ventana en vez de suponerla, para no depender de que la base local no tenga datos de 2001.

---

## 9 — Qué le queda listo al frontend (B7)

**La acción que va a consumir**, y es la única puerta (R35):

```ts
import { consultarCohorteCarga } from "@/lib/actions/cohorte-carga";

const res = await consultarCohorteCarga(filtroSerializado);
```

- `raw` es el filtro **sin validar** tal cual lo manda el cliente: la MISMA forma que las otras
  siete lecturas (`conteoEntregasFiltroSchema`, seis facetas + rango). **Ningún parámetro propio.**
- `deps` es opcional y sólo para tests.

**El DTO** (`@/lib/types/cohorte-carga`):

```ts
type ResultadoCohorteCarga =
  | { status: "ok"; datos: CohorteCargaDTO }
  | { status: "sin_rango" }                     // ⚠ invitación, NO error
  | { status: "unauthenticated" }
  | { status: "forbidden" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> };

interface CohorteCargaDTO {
  porDia: readonly CohorteDeDia[];              // MÁS RECIENTE PRIMERO. No reordenar.
  total: number;
  totalPorDesenlace: readonly CohorteCubo[];    // alfabético por desenlace
  lastSync: string;                             // ISO-8601 UTC
}
interface CohorteDeDia { fecha: string; cargadas: number; cubos: readonly CohorteCubo[] }
interface CohorteCubo {
  desenlace: CohorteDesenlace;                  // "entregada" | "devuelta_a_tienda" | "incidente" | "viva"
  n: number;
  segundosAcum: number | null;                  // null en `viva`: no hay reloj
  promedioSegundos: number | null;
}
```

Cinco cosas que la pantalla tiene que saber, y las cinco están decididas:

1. **`porDia` viene DESCENDENTE y no se reordena.** El orden se decide en un solo sitio (el
   `ORDER BY` del repositorio). Diverge a propósito de `ConteoCargadasPorDiaDTO`, que es ascendente.
2. **Los cubos con `n = 0` NO viajan, y los días sin órdenes tampoco.** Un hueco significa cero: la
   pantalla, que sí conoce los cuatro cubos, los rellena para dibujar sus columnas. **`Vivas` es
   columna obligatoria** (R32) también cuando vale 0 — sin ella la tabla miente por omisión.
3. **`sin_rango` es una invitación, no un error.** «Elige un periodo para ver las cohortes». Ni
   tabla vacía, ni ceros, ni esqueleto cargando. Y no consulta.
4. **`segundosAcum` / `promedioSegundos` en segundos y sin redondear**, para que la pantalla elija
   unidad. El promedio del cubo `entregada` se escribe **con su `n` al lado**
   (`contarOrdenes(n, ORDENES_CERRADAS)` + `rotuloConBase`): sin ese denominador, «1,2 días» en una
   cohorte joven es una cifra sobre las tres fáciles que ya cerraron.
5. **La faceta de mensajero NO recorta esta lectura** (R24): con un mensajero seleccionado, esta
   sección no se recorta y otras sí. La advertencia va en la descripción de la sección.

**Y una tarea que es de B7, no mía:** la acción lleva un `@sin-superficie` fechado. **Se retira en
el mismo commit que monte la tabla en `/analitica`** — una excepción que sobrevive a su motivo deja
de significar nada, y la guardia de superficie lo exige en las dos direcciones.

---

## 10 — Verificación

### Comandos sueltos

```
$ pnpm run typecheck
> tsc --noEmit
(sin salida: cero errores)

$ pnpm run lint
✖ 184 problems (0 errors, 184 warnings)
```

Las 184 son `no-unused-vars` de dobles de test **preexistentes en `dev`**. La única de un archivo
mío es `cohorte-carga-action.test.ts:45 '_c' is defined but never used`, idéntica a la que ya tiene
su hermana `conteo-cargadas-action.test.ts:23`. **Cero errores.**

```
$ pnpm exec vitest run <los 14 archivos de la ficha>
 Test Files  14 passed (14)
      Tests  104 passed (104)
   Duration  6.15s
```

### Gate COMPLETO

`./init.sh` (no `--rapido`: `lib/types/**` lo rechaza). Log entero en
`scratchpad/gate-411.log`, con el `INIT_EXIT` **escrito DENTRO del log** y sin canalizarlo por
`tail`.

```
== Arnes SDD :: init (modo: completo) ==
✓ node v24.13.0
✓ dependencias presentes
✓ feature_list.json: sin ids duplicados (408 fichas), cupo por zona respetado (in_progress=2) y specs en su sitio
✓ typecheck paso
✓ lint paso
✓ DATABASE_URL resuelta: los 155 archivos de tests contra Postgres SI se ejecutan
...
 Test Files  2 failed | 1872 passed (1874)
      Tests  2 failed | 27210 passed | 26 skipped (27238)
   Duration  1133.86s

ROJOS NUEVOS (2 archivo(s) que no estan en el baseline):
  - tests/integration/db/notificacion-evento-bloqueo-cierre-migration.test.ts
  - tests/integration/db/notificacion-evento-gasto-fijo-migration.test.ts
✗ hay rojos NUEVOS respecto del baseline (el detalle esta justo arriba)
INIT_EXIT=1
```

#### Los `integration/db` SÍ corrieron — la cifra, no la suposición

Me copié el `.env` del checkout principal tras comprobar que apunta a **`localhost:5432/ordenex`**
(la línea de Supabase de ese archivo está comentada) y que `prisma migrate status` decía
`Database schema is up to date!`. El propio gate lo confirma antes de correr —
`✓ DATABASE_URL resuelta: los 155 archivos de tests contra Postgres SI se ejecutan`— y el JSON de
la corrida (`.vitest/rojos.json`) lo cuenta después:

| | |
| --- | --- |
| archivos de `tests/integration/db` en el reporte | **240** |
| con al menos un caso EJECUTADO | **240** |
| enteramente saltados | **0** |
| casos | 2793 (2791 verdes, **0 saltados**, 2 rojos) |

Los 26 `skipped` de la corrida son de otros sitios, no de la capa de datos. **B4 se ejecutó
entero**, y ésa era la condición para que esta ficha valga algo:

```
cohorte-carga-fechas.int.test.ts:          4/4 verdes
cohorte-carga-desenlaces.int.test.ts:      5/5 verdes
cohorte-carga-ultima-terminal.int.test.ts: 2/2 verdes
cohorte-carga-ventana.int.test.ts:         2/2 verdes
cohorte-carga-reloj.int.test.ts:           4/4 verdes
cohorte-carga-alcance.int.test.ts:         5/5 verdes
cohorte-carga-equivalencia.int.test.ts:    3/3 verdes
cohorte-carga-indices.int.test.ts:         6/6 verdes
```

#### Los 2 rojos NO son míos, y está MEDIDO — no supuesto

Los dos fallan por lo mismo: el enum `notificacion_evento` de la **base local aplicada** tiene dos
valores de más.

```
AssertionError: expected [ 'orden_rechazada', …(12) ] to deeply equal [ 'orden_rechazada', …(10) ]
+   "novedades_sin_gestionar",
+   "devoluciones_represadas",
```

Las cuatro medidas que lo cierran:

1. **La migración que los mete existe en la BASE y en ninguna rama.** Consultado
   `_prisma_migrations` contra `db/migrations/` de esta rama: la única aplicada que no está en
   disco es **`20260911120000_notificacion_evento_avisos_agregados`**. Y **tampoco está en
   `origin/dev`** (`git ls-tree -r origin/dev -- db/migrations | grep 20260911120000` → vacío). Es
   de otro agente trabajando en otra ficha contra la **misma base local compartida**.
2. **Mi diff no toca `db/`.** Ni una migración, ni `db/schema.prisma`, ni un enum. Lo único mío
   bajo un directorio que se llama `db` son los ocho archivos de `tests/integration/db/`, que es
   otro árbol.
3. **Esos dos archivos no importan nada mío.** Sólo `vitest`, `fs`, `path`, `node:crypto`,
   `@prisma/client` y `./_postgres-real`. Leen la base aplicada; mi código no puede cambiarla.
4. **Corridos AISLADOS fallan igual** (`2 failed | 33 passed`, 981 ms): no es un flake de
   saturación, es un estado de la base. Y `dev` sólo se movió, desde mi SHA base, un commit de
   `docs(409)` que toca specs y `feature_list.json`.

**NO se añaden a `tests/baseline-rojos.json`, y es deliberado.** Esa lista es para deuda del repo,
medida y fechada; esto es el estado transitorio de una base local compartida entre worktrees.
Meterlos ahí enmascararía una regresión de verdad el día que llegue y le mentiría a `dev`. La
decisión de qué hacer con la corrida es del leader; la evidencia está arriba.

---

## 11 — Veredicto

**Backend de la 411 (B1–B6) implementado y verificado: 33 requisitos con test que existe y se
ejecuta, los dos rojos de T4.1/T4.4 vistos y pegados, 14 mutaciones con 13 muertas y 1 equivalente
razonada, 240 archivos de `integration/db` ejecutados sin uno solo saltado, y sin migración porque
la medición dice que no hace falta; el gate completo termina en `INIT_EXIT=1` por dos archivos
ajenos —una migración que otro agente aplicó a la base local compartida y que no está ni en esta
rama ni en `origin/dev`—.**

