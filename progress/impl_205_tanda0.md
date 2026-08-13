# Feature 205 — Bitácora de implementación, TANDA 0

Rama `feature/205-pago-mensajero-desde-wallet`. Alcance: **solo T0.1 → T0.5**, la tanda que no
toca base de datos. Contrato: `specs/205-pago-mensajero-desde-wallet/{requirements,design,tasks}.md`.

---

## Archivos creados / modificados

| Archivo | Tarea | Qué |
| --- | --- | --- |
| `lib/utils/reparto-liquidacion-mensajero.ts` | T0.1 | **creado** — módulo puro del reparto |
| `tests/unit/utils/reparto-liquidacion-mensajero.test.ts` | T0.2 | **creado** — 38 casos |
| `tests/unit/guards/liquidacion-money-safe.test.ts` | T0.3 | **editado** — censo ampliado (1 entrada + su porqué) |
| `lib/config/reparto-mensajero.ts` | T0.4 | **creado** — tope de imputaciones |
| `tests/unit/config/reparto-mensajero-config.test.ts` | T0.4 | **creado** — 7 casos |
| — | T0.5 | **cero código**: es auditoría de lectura (ver abajo) |

Nada más. No se tocó `db/`, ni servicios, ni repositorios, ni UI: eso es de las tandas 1+.

---

## T0.1 — Módulo puro del reparto

`repartirEntreCierres(importe, cierres, tope)` recibe **todos** los imputables y forma la
ventana dentro (design §2.5.1); `ordenarCierresFifo` es la verdad del orden de R8, no el
`ORDER BY` del repositorio.

Criterios de hecho, comprobados por test estructural (`describe("el modulo del reparto es
PURO")`), no por inspección visual:

- sin `next/*`, sin repositorios, sin servicios, sin `PrismaClient`; lo único que importa de
  Prisma es `Prisma.Decimal`;
- **no lee `process.env`** (el `tope` entra por parámetro, R53) y **no lee el reloj** (ni un
  `new Date(`);
- cero `Number(` / `parseFloat(` / `parseInt(`; todo `.toFixed(` es de escala 2.

Esos tests barren el **código sin comentarios** (`quitarComentarios` de
`tests/fixtures/money-safe.ts`): la cabecera del módulo *cita* a propósito lo que no hace, y un
barrido literal habría fallado por citarlo. Es la misma cicatriz que documenta el fixture — y me
la comí una vez en T0.4 antes de acordarme (el test se puso rojo en
`expect(puro).not.toMatch(/process\.env/)` por el docstring).

### Una decisión que el design no fijaba: cómo se comparan las antigüedades

El design fija el comparador (`solicitadoAt` asc → `cierreId` asc) pero no **cómo** se comparan
las marcas. Se comparan como **instante** (`Date.parse`), no como texto:
`2026-07-05T12:00:00.000+02:00` son las 10:00Z y va **antes** que `2026-07-05T11:00:00.000Z`,
mientras que como cadenas el orden sale invertido. Quién cobra primero no puede depender de cómo
se serializó la fecha. Hay dos tests que lo fijan y una mutación que lo mata (a3, abajo).

`Number.isFinite` sobre un epoch en milisegundos **no** es una conversión de monto y no casa con
`/\bNumber\s*\(/` (hay un punto entre medias); el barrido money-safe lo confirma en verde.

---

## T0.3 — El censo visto en ROJO antes de ampliarlo

El módulo se llama `reparto-liquidacion-mensajero.ts` **a propósito**: su ruta casa la
auto-captura de `liquidacion-money-safe.test.ts:139-146`, así que crearlo tiene que tumbar el
barrido. Se comprobó **antes** de tocar el censo:

```
$ pnpm exec vitest run tests/unit/guards/liquidacion-money-safe.test.ts

 FAIL  tests/unit/guards/liquidacion-money-safe.test.ts > barrido transversal money-safe y de
       fuga de datos (feature 172) > el censo de archivos de la feature existe entero y cubre
       sus propios árboles
AssertionError: expected [ Array(1) ] to deeply equal []

- Expected
+ Received

- []
+ [
+   "lib/utils/reparto-liquidacion-mensajero.ts",
+ ]

 ❯ tests/unit/guards/liquidacion-money-safe.test.ts:146:56

 Test Files  1 failed (1)
      Tests  1 failed | 6 passed (7)
```

**Ese** es el mensaje que se da por bueno: falla el test del **censo** (no otro), en la línea
`:146`, que es exactamente el `expect(propios.filter((ruta) => !censo.has(ruta))).toEqual([])`
de la cláusula de auto-captura, y nombra el archivo nuevo. Es la prueba de que el mecanismo
vigila; un censo ampliado sin haber visto ese rojo solo probaría que alguien sabe escribir en
una lista.

Tras añadirlo: `Test Files 1 passed (1) · Tests 7 passed (7)`.

`lib/config/reparto-mensajero.ts` **no** entró al censo y **no** hizo caer la auto-captura: su
ruta no casa `/[Ll]iquidacion/`. El porqué queda escrito en el propio censo, junto a la entrada
nueva, para que nadie lo "arregle" renombrando el config.

---

## T0.4 — Config del tope

`MAX_CIERRES_POR_REPARTO`, por defecto **50**, sobrescribible con
`REPARTO_MENSAJERO_MAX_CIERRES`. Patrón literal de `lib/config/gasto-fijo.ts`. El test recarga
con `loadRepartoMensajeroConfig()` — leer la constante ya evaluada habría pasado en verde sin
comprobar la sobreescritura.

Dos tests estructurales que protegen las decisiones del design y no solo el valor:

- el número **no se repite**: el módulo puro no nombra `MAX_CIERRES_POR_REPARTO`, no importa el
  config y no lee `process.env` (R53/R57 — dos números que puedan divergir es justo lo que R57
  prohíbe);
- el config **no maneja dinero** y su ruta **no casa** `/[Ll]iquidacion/`: si alguien lo renombra
  o le mete un `Decimal`, lo dice este test en vez de que el barrido caiga con un falso positivo
  tres tandas después.

**No** se añadió a `tests/unit/config/paginacion-dominios.test.ts`: verificado que ese guard
importa los dominios **uno a uno** (`:5-11`), no barre el directorio, y enumera dominios de
PAGINACIÓN; este no lo es.

---

## T0.2 — Los tests y las mutaciones

38 casos. Cubren FIFO (incl. desempate, repetibilidad y no-mutación de la entrada), troceo,
"solo la última parcial" como **propiedad** sobre 7 importes, agotamiento exacto, exceso,
céntimo suelto, decimales que rompen un float, `DECIMAL(12,2)` casi lleno, escala 2 de **todas**
las salidas, cero-y-negativos descartados, ventana y recorte con sus bordes
(`tope` 0, negativo, 1, = n, > n) y la ventana que **encoge**.

### Mutaciones — el veredicto

Runner en scratchpad: aplica la mutación al módulo, corre la suite, cuenta rojos, restaura
siempre. **9 mutaciones, 9 muertas** (en la segunda vuelta; ver el fallo de la primera abajo).

| # | Mutación | Veredicto |
| --- | --- | --- |
| a1 | FIFO al revés (`ta > tb`) | **muerta** — 19 casos en rojo |
| a2 | FIFO sin desempate por id (`return 0`) | **muerta** — 2 en rojo |
| a3 | FIFO por TEXTO en vez de por instante | **muerta** — 2 en rojo |
| b | la imputación no se topa en el pendiente (`monto = restante`) | **muerta** — 15 en rojo |
| c1 | ventana dada por LLENA (`enVentana = min(tope, entrada)`) | **muerta** — 3 en rojo |
| c2 | la ventana se RELLENA (el tope no corta: `ventana = imputables`) | **muerta** — 7 en rojo |
| d | el `imputable` deja de sumar lo que el importe no alcanzó | **muerta** — 2 en rojo |
| e | se emiten imputaciones de `0.00` (`monto.lt(0)`) | **muerta** — 8 en rojo |
| f | los pendientes ≤ 0 dejan de descartarse y ocupan plaza | **muerta** — 4 en rojo |

**a3 SOBREVIVIÓ en la primera vuelta, y ese es el hallazgo que justifica el ejercicio.** El test
de "instante, no texto" estaba escrito con los ids `aaa`(+00:00) y `bbb`(Z): el orden textual y
el desempate por id daban **la misma** respuesta, así que el test pasaba con las dos
implementaciones y no probaba nada. Se rehízo con ids elegidos para que las dos reglas
discrepen (`aaa` lleva la forma `Z`, `zzz` la `+00:00`) y se añadió el caso del offset horario
(`12:00+02:00` vs `11:00Z`, donde texto e instante dan órdenes **opuestos**). Con eso a3 cae con
2 casos en rojo.

---

## T0.5 — VERIFICACIÓN: nadie asume una referencia por pago

**Resultado: NO se encontró nada que asuma que `liquidacion_pago.referencia` es única ni 1:1 por
pago. La compuerta queda ABIERTA: T3.2 puede escribirse con el diseño de R58 tal cual.**

### Cómo se barrió (y por qué no con `node -e`)

Script en archivo — `node -e` se come una capa de escapado en este repo y un `\b` llega como
backspace, con lo que el censo miente en verde. El script recorre `lib`, `app`, `components`,
`db`, `scripts`, `tests`, `hooks` (2 329 archivos `.ts/.tsx/.js/.sql/.prisma`), busca cada línea
que nombre `referencia` y mira una **ventana de ±6 líneas** por 14 señales de "aquí se consulta"
(`@unique`, `@@unique`, `UNIQUE`, `findUnique`, `findFirst`, `where:`, `WHERE`, `groupBy`,
`GROUP BY`, `distinct`, `DISTINCT`, `JOIN`, `aggregate`, `count`). La ventana es necesaria
porque `where: { referencia }` y `findFirst({` casi nunca caen en la misma línea.

### Autocomprobación (obligatoria — una salida vacía no prueba nada)

El script **se niega a barrer** (`exit 2`) si no caza sus casos plantados:

```
=== AUTOCOMPROBACIÓN DEL BARRIDO ===
  [CAZADO] (a) @unique en el campo referencia del schema -> señales: @unique
  [CAZADO] (a) @@unique compuesta con referencia -> señales: @unique, @@unique
  [CAZADO] (a) CREATE UNIQUE INDEX sobre referencia (SQL) -> señales: SQL UNIQUE
  [CAZADO] (b) findFirst por referencia -> señales: findFirst, where
  [CAZADO] (b) findUnique por referencia -> señales: findUnique, where
  [CAZADO] (c) groupBy por referencia (conciliación 1:1) -> señales: groupBy
  [CAZADO] (c) distinct por referencia -> señales: distinct
  [CAZADO] (c) SQL de conciliación que empareja 1 referencia con 1 pago -> señales: SQL GROUP BY, SQL JOIN
  [OK-LIMPIO] escritura: la referencia se copia como DATO, sin consultarla
  [OK-LIMPIO] DTO / tipo: la referencia solo se declara
  [CAZADO] inyección en archivo REAL lib/repositories/LiquidacionPagoRepository.ts: 0 hallazgos antes -> 1 después
AUTOCOMPROBACIÓN OK: el barrido caza los 8 casos plantados y no marca los 2 limpios.
```

Las tres direcciones: **caza** los 8 plantados (uno por cada forma de asumir unicidad), **no
marca** los 2 limpios (la referencia copiada como dato en un `create`, y declarada en un DTO —
que es exactamente lo que R58 va a hacer), y **caza una inyección en un archivo real** que antes
daba 0.

### Triaje: 58 candidatos en 47 archivos, ninguno es un hallazgo

Casi todo es la palabra española *referencia/referencian/referenciado* en comentarios sobre FKs
de migraciones ("solo si ninguna orden lo referencia"). Los que tocan de verdad
`liquidacion_pago.referencia`, revisados uno a uno:

| Sitio | Qué es | Veredicto |
| --- | --- | --- |
| `db/schema.prisma:1316` | `referencia String?` | **sin `@unique`**; la señal saltó por el `@unique` de `claveIdempotencia` a 6 líneas |
| `db/migrations/20260802120000_liquidacion_pago/migration.sql:35` | `"referencia" TEXT,` | sin UNIQUE. Los únicos índices únicos de la tabla son `clave_idempotencia` (`:56`) y la PK; los otros tres son `(mensajero_id, fecha_pago)`, `(tienda_id, fecha_pago)` y `(cierre_id)` |
| `lib/repositories/LiquidacionPagoRepository.ts:50, :159` | proyección al DTO y `data` del `create` | escritura y lectura de la columna como **dato**; ni un `where` por ella en toda la clase |
| `lib/services/LiquidacionService.ts:79, 217, 233, 313, 330, 345, 546` | copia al documento y a la descripción del libro | dato, no criterio |
| `lib/services/CajaBackfillTesoreriaService.ts:194, 206, 225, 240` | `select` de `referencia` para construir la descripción | itera **por `pago.id`** y filtra por `tiendaId`; ni agrupa ni empareja por referencia |
| `lib/types/liquidacion.ts:119-151` | zod: obligatoria en SINPE/transferencia, tope de longitud | validación de forma, no de unicidad |
| `lib/utils/descripcion-pago.ts:36-60` | formatea `"SINPE · 1234567"` | presentación |
| `components/shared/liquidacion/PagosRegistradosTabla.tsx:104-106` | columna de tabla | `rowKey="id"` (`:206`), **no** la referencia |
| `components/shared/liquidacion/pagos-registrados-descarga-columnas.ts:42, 68` | columna de descarga | proyección por fila |
| `components/shared/liquidacion/RegistrarPagoDialog.tsx` | campo del formulario | entrada |
| `scripts/**` | 1 sola aparición, y es `preferencia` en `migrate-deploy-guardas.ts:62` | ruido |

**Los únicos dos consumidores de `liquidacionPago` fuera de su repositorio** (barrido aparte
sobre `liquidacionPago.`) son `PagoMensajeroMovimientoRepository.ts:84` (`where: { cierreId }`) y
`CajaBackfillTesoreriaService.ts:188` (`where: { tiendaId: { not: null } }`). Ninguno consulta
por referencia. Ningún `$queryRaw` del repo toca `liquidacion_pago`.

### Evidencia POSITIVA, que es más fuerte que la ausencia

`tests/integration/db/liquidacion-idempotencia.test.ts` ya afirma hoy lo contrario de la
unicidad: R78 de la 172 prueba que tras anular se registra **un pago nuevo con la MISMA
referencia y la misma fecha real, y se acepta** (`:1231`, `:1256`, `:1263`, `:1471`, `:1491`,
`:1498`). Dos filas de `liquidacion_pago` con la misma `referencia` **ya existen** en el modelo y
hay un test de integración que lo exige. Lo que la 205 añade no es la repetición: es que las N
repeticiones nazcan del **mismo acto**.

### Observación adyacente (no bloquea T0.5, pero apunta a T1)

`LiquidacionPagoRepository.esChoqueDeClave` (`:75-84`) trata un **P2002 sin pista** como choque
de `clave_idempotencia`, y lo justifica por escrito: «`liquidacion_pago` solo tiene dos
restricciones únicas». Ese razonamiento sigue siendo cierto con el diseño de la 205 —el `UNIQUE`
nuevo vive en `liquidacion_reparto` y `reparto_id` solo lleva **índice**, design §1.2— pero deja
de serlo el día que alguien añada una restricción única a `liquidacion_pago`: el error se leería
como "clave repetida" y el servicio respondería `no_encontrado`. **T1.1/T1.2 no deben añadir
ningún `@unique` a `liquidacion_pago`.** No es un hallazgo de T0.5 (no habla de `referencia`); se
anota para que no se descubra en la tanda 1.

---

## Verificación

| Comando | Resultado |
| --- | --- |
| `pnpm exec vitest run tests/unit/utils/reparto-liquidacion-mensajero.test.ts tests/unit/config/reparto-mensajero-config.test.ts` | `Test Files 2 passed (2) · Tests 45 passed (45)` |
| `pnpm exec vitest run tests/unit/guards` | `Test Files 25 passed (25) · Tests 274 passed (274)` |
| `pnpm exec tsc --noEmit` | exit 0, sin salida |
| `pnpm run lint` (extra) | `0 errors, 57 warnings` — todas preexistentes, ninguna en archivos de la 205 |

El gate de tanda (`./init.sh --rapido`) y el completo los corre el leader: son suyos, no míos.

---

## Veredicto

Tanda 0 cerrada: el cálculo del reparto existe, es puro, está bajo el barrido money-safe por
auto-captura (visto en rojo antes de censarlo), su tope vive en un solo punto configurable, y la
compuerta T0.5 está **abierta** — nada del árbol asume una referencia única por pago, así que
T3.2 no está bloqueada.
