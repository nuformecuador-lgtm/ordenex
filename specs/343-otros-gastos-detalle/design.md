# Ficha 339 — Diseño

> Cubre `requirements.md`. Todo lo que aquí se afirma sobre el árbol se leyó en el **archivo real**
> (el grafo del MCP se usó para localizar, no para concluir: devuelve de más).

## 0 — La decisión de fondo, en una frase

«Otros» deja de ser **el sitio donde cae lo que nadie nombró** y pasa a ser **la señal de que hay
dinero sin clasificar**. Se consigue sin cambiar una sola cifra: la fila sigue siendo el
**COMPLEMENTO** derivado en el servidor (no una lista escrita a mano), y lo único que crece es el
conjunto de conceptos que tienen fila propia.

---

## 1 — `egreso_ajuste`: fila propia. Por qué

La ficha obliga a decidirlo y a justificarlo. **Se le da fila propia**, junto a los pagos a
mensajeros. Cuatro razones, en orden de peso:

1. **La asimetría es el defecto diagnosticado.** Del lado de los ingresos, `ingreso_ajuste` YA tiene
   fila con nombre («Ajuste (ingreso)»). Dejar su espejo dentro de un cubo anónimo reproduce en
   miniatura exactamente el problema que la ficha existe para cerrar.
2. **Un ajuste no es un residuo: es un acto deliberado con descripción obligatoria.** El schema del
   movimiento manual exige `descripcion` no vacía. Un concepto que siempre trae explicación escrita
   es lo contrario de «no sabemos qué es esto».
3. **Cierra el riesgo declarado en la ficha.** El diálogo «Registrar movimiento» de `/wallet` escribe
   `egreso_ajuste` y, por `nombreEnElLibro`, le PROMETE al usuario que el movimiento se llamará
   «Ajuste (egreso)». Sin fila propia, la tarjeta de la ganancia rompe esa promesa: el gasto que
   acabas de registrar no aparece por su nombre en ninguna parte de la tarjeta. Hoy hay 0 en
   producción; es la trampa esperando.
4. **Sin coste de nombre.** La etiqueta ya existe en el catálogo (`CATEGORIA_LABEL.egreso_ajuste`),
   así que no hay que inventar vocabulario nuevo ni decidir nada de UI para que exista la fila.

**Lo que queda dentro de «Otros» después de esto:** sólo `egreso_gasto`, categoría **reservada sin
un solo escritor en el árbol** (medido: aparece únicamente en `lib/types/wallet.ts` y en los
catálogos de `lib/analytics/metrics.ts`; ningún servicio la emite). Es decir: hoy «Otros» = 0,00 y
desaparece de la vista, y el día que muestre un importe significará literalmente «entró dinero de un
concepto que nadie ha decidido cómo se llama». Eso es exactamente la señal que se pidió.

**Contra-argumento considerado y descartado:** «un ajuste ES el residuo por definición, déjalo en
Otros». No se sostiene: el residuo es lo que el sistema no sabe nombrar, y un ajuste manual viene con
nombre, con motivo escrito y con autor (`registrado_por`).

---

## 2 — Modelo de datos: NO se toca la base

**Cero migraciones. Cero columnas. Cero valores de enum. Cero RLS nueva.** Lo que cambia es cómo se
PARTICIONA una agregación que ya existe.

Hoy `WalletService.verResumenCaja` hace **una** lectura (`repo.agregarPorCategoriaYTipo`) y la
alimenta a **dos** derivaciones puras (`derivarCaja` y `derivarComposicionGanancia`), que es lo que
garantiza que la tarjeta y la caja hablen del mismo instante. Eso se conserva byte a byte.

### 2.1 Seeds nuevos en `lib/types/wallet.ts`

```
WALLET_EGRESO_NOMBRADO_SEED   = ["egreso_pago_mensajero", "egreso_ajuste"]
WALLET_EGRESO_CON_FILA_SEED   = [...WALLET_EGRESO_DESGLOSADO_SEED, ...WALLET_EGRESO_NOMBRADO_SEED]
```

- `WALLET_EGRESO_DESGLOSADO_SEED` **no se toca**: sigue siendo «los cuatro que `DesgloseEgresosDTO`
  abre», que es su significado y el que usan las fichas 45/158.
- `WALLET_EGRESO_CON_FILA_SEED` se escribe como EXTENSIÓN (spread) y no como segunda lista a mano —
  el mismo patrón con el que `WALLET_INGRESO_PROPIO_SEED` extiende a `WALLET_INGRESO_CONCEPTO_SEED`.
  Así, el día que un concepto gane fila, entra por un solo sitio.
- Los dos llevan `satisfies readonly WalletMovimientoCategoria[]`: un valor que no exista en el enum
  rompe el build.

### 2.2 Catálogo de FILAS de la tarjeta (para poder abrirlas)

```
COMPOSICION_FILA_OTROS = "otros_egresos"
COMPOSICION_FILA_SEED  = [...WALLET_INGRESO_PROPIO_SEED,      // 7
                          ...WALLET_EGRESO_CON_FILA_SEED,     // 6
                          COMPOSICION_FILA_OTROS]             // 1  → 14 filas
type ComposicionFilaId = (typeof COMPOSICION_FILA_SEED)[number]
```

Una fila se identifica por el **nombre de su categoría** cuando es una sola, y por el token
`"otros_egresos"` cuando es el complemento. El token no es una categoría del enum a propósito: el
complemento no es una categoría, es una operación de conjuntos.

### 2.3 `ComposicionGananciaDTO` gana dos claves

```
egresos:          Record<WalletEgresoNombrado, string>   // Record TOTAL, sin huecos
hayOtrosEgresos:  boolean                                // lo decide el SERVIDOR (R9)
```

- `egresos` es un `Record` por CATEGORÍA y no dos campos camelCase sueltos. Motivos: (a) la pantalla
  construye sus filas recorriendo el seed, igual que hace la columna de ingresos; (b) un concepto
  nuevo entra añadiendo una entrada al seed, sin tocar el DTO; (c)
  `caja-173-alcance.guardia.test.ts` prohíbe que `lib/utils/caja-tesoreria.ts` nombre claves
  camelCase de fórmulas, y el propio docstring del módulo ya dice «se teclea POR CATEGORÍA».
- `hayOtrosEgresos` se deriva como `!otrosEgresos.isZero()`. **`isZero` y no `.gt(0)`**: un importe
  negativo (imposible hoy, porque el monto es siempre positivo y el signo lo da el tipo) es
  precisamente lo que más falta haría ver, y `.gt(0)` lo escondería.

### 2.4 Lo que NO cambia del DTO

`ingresos`, `totalIngresos`, `otrosEgresos` y `totalEgresos` conservan nombre, tipo y **valor**.
`otrosEgresos` sigue siendo el COMPLEMENTO; lo único que cambia es que el conjunto contra el que se
complementa pasa de `WALLET_EGRESO_DESGLOSADO_SEED` a `WALLET_EGRESO_CON_FILA_SEED`.

---

## 3 — La derivación: una sola definición del complemento

En `lib/utils/caja-tesoreria.ts` (módulo **PURO**; la guardia de alcance le prohíbe nombrar
`PrismaClient`, `Repository`, `findMany`, `groupBy` y `await`, y la de derivaciones le prohíbe
`.sub(`, `.minus(` y los literales de signo — nada de esto cambia):

```
categoriasDeFilaComposicion(fila: ComposicionFilaId): readonly WalletMovimientoCategoria[]
   fila === "otros_egresos"  →  toda categoría PROPIA de tipo egreso que no esté en
                                WALLET_EGRESO_CON_FILA_SEED      (el COMPLEMENTO, derivado)
   otra                      →  [fila]
```

`derivarComposicionGanancia` usa **el mismo conjunto** para decidir a qué cubeta va cada fila del
agregado. Esa es la pieza clave del diseño y hay que decirla explícita:

> **El importe de una fila y la lista de movimientos de esa fila salen de la MISMA definición.** Si
> la lista se dedujera aparte, podrían divergir sin que nada fallara: la fila diría 227.300,00 y el
> detalle enseñaría otra cosa. Es el mismo error, un piso más abajo, que esta ficha viene a arreglar.

`hayOtrosEgresos` se calcula en la misma pasada, con `Prisma.Decimal` y `montoEscala2`, sin ninguna
resta nueva (`R37`).

---

## 4 — La lectura del detalle

### 4.1 Contrato de entrada (borde)

```
listarMovimientosDeFilaSchema =
  listarMovimientosSchema
    .omit({ page: true, pageSize: true })
    .extend({
      fila:     z.enum(COMPOSICION_FILA_SEED),
      page:     z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1)
                  .max(composicionDetalleConfig.MAX_PAGE_SIZE)
                  .default(composicionDetalleConfig.DEFAULT_PAGE_SIZE),
    })
```

- **Se DERIVA del schema del listado**, no se copia: así `tipo`, `categoria`, `desde` y `hasta` son
  por construcción los MISMOS filtros que el libro, y el día que el libro gane un filtro lo gana el
  detalle solo. Es el precedente literal de `listarMovimientosCompletoSchema` (ficha 170).
- `page`/`pageSize` se redeclaran porque los del listado llevan literales (`max(100).default(20)`) y
  `R29` exige que el tope y el tamaño salgan de configuración.
- El cliente manda un **token de fila**, nunca una lista de categorías. Consecuencia buscada: el
  navegador no puede definir el complemento — eso sólo lo hace el servidor.

### 4.2 Contrato de salida

Se reutiliza `ListarMovimientosPayload` (`movimientos`, `total`, `page`, `pageSize`), que ya existe y
ya viaja con montos STRING. La rama de denegación **no viaja con filas**.

```
ListarMovimientosDeFilaServiceResult =
  | { status: "ok"; data: ListarMovimientosPayload }
  | { status: "forbidden" }
```

### 4.3 Servicio — `WalletService.listarMovimientosDeFila`

Orden exacto, y el orden es parte del requisito:

1. `if (!esAccesoTotal(actor.rol)) return { status: "forbidden" }` — **antes** de tocar la base
   (`R39`). Igual que `verResumenCaja`, y por el mismo motivo escrito allí: un `forbidden` evaluado
   después del `SELECT` ya habría leído el dinero para tirarlo.
2. `const filtros = this.construirFiltros(input)` — el MISMO método privado que usan el listado, la
   descarga y el resumen. No hay copia.
3. `const categorias = categoriasDeFilaComposicion(input.fila)`, **intersecado** con
   `filtros.categoria` si el usuario tiene ese filtro puesto. La intersección vacía se pasa tal cual
   (`in: []` → cero filas en Postgres): el recorte lo hace el `WHERE`, no un `if` en memoria (`R33`).
4. `this.repo.listar({ ...filtros, categorias, page, pageSize })`.

No hay ninguna aritmética de dinero en el servicio.

### 4.4 Repositorio

`BalanceFiltros` y `ListarMovimientosFiltros` ganan `categorias?: readonly WalletMovimientoCategoria[]`
y `buildWhere` lo honra:

```
if (f.categorias !== undefined) where.AND = [{ categoria: { in: f.categorias } }];
```

- Va en `AND` y no sobreescribiendo `where.categoria`, para que **convivan** el filtro de categoría
  del usuario y el conjunto de la fila. Si los dos se contradicen, el resultado es vacío, que es lo
  correcto: el importe de la fila también es 0,00 bajo esos filtros.
- Es **opcional**: los dos agregados (`agregarPorCategoriaYTipo`, `agregarPorCategoria`) lo pasan
  como `undefined` y su SQL no cambia. Eso se prueba, no se supone.
- **Sin índice nuevo.** El `WHERE` es `categoria IN (…) [AND tipo] [AND fecha_movimiento BETWEEN …]`
  con `ORDER BY fecha_movimiento DESC, created_at DESC, id DESC`. Los índices existentes
  (`@@index([tipo, categoria])`, `@@index([fechaMovimiento])`) son los mismos que ya sirven al filtro
  por categoría del libro, que es la misma consulta con `=` en vez de `IN`.
- El orden de página sigue siendo **TOTAL** (fecha, `created_at`, `id`): lo hereda de `listar`, y es
  lo que impide que paginar repita u omita filas cuando varios movimientos comparten fecha — el caso
  normal aquí, porque un cierre aprobado emite su egreso al mismo instante.

### 4.5 Server Action

`listarMovimientosDeFilaAction(input, deps)` en `lib/actions/wallet.ts`, calcada de
`listarMovimientosAction`: resuelve el actor, lanza `UnauthenticatedError` si no hay sesión, valida
con el schema (ZodError → `validation_error`) y delega. Mutación interna → Server Action, no ruta
API (`docs/architecture.md`).

### 4.6 Configuración — `lib/config/composicion-detalle.ts`

Molde exacto de `lib/config/gasto-fijo.ts` (`readPositiveInt` + `load…Config()` + instancia):

| clave | env | valor por defecto |
| --- | --- | --- |
| `DEFAULT_PAGE_SIZE` | `COMPOSICION_DETALLE_DEFAULT_PAGE_SIZE` | `10` |
| `MAX_PAGE_SIZE` | `COMPOSICION_DETALLE_MAX_PAGE_SIZE` | `50` |

**10 y no 25**: el detalle se pinta dentro de una columna que ocupa media tarjeta, no una pantalla.
Se declara con dominio propio en vez de colgarlo de otro porque su escala no es la de ninguno: crece
con el número de movimientos de UNA categoría del libro.

**No se registra en `tests/unit/config/paginacion-dominios.test.ts`**: ese archivo es el censo de los
**13 listados del Anexo III de la ficha 170**, con un `toHaveLength(13)` que significa eso
literalmente. Meter aquí un listado que no es del Anexo III falsearía la afirmación. El dominio nuevo
lleva su propio test con las mismas cuatro comprobaciones (default, tope, `default ≤ max`, override
de entorno y basura → valor por defecto).

---

## 5 — La pantalla

### 5.1 Forma del despliegue

Cada fila de concepto pasa a ser un **disclosure**: el rótulo se convierte en un `<button>` con
`aria-expanded` / `aria-controls`, y al abrirlo aparece un panel DEBAJO de esa fila, dentro de su
propio `<div>` contenedor. La `<dl role="group">` de cada columna, sus `aria-label` («Desglose de
ingresos», «Desglose de egresos») y la estructura `<dt>`/`<dd>` de cada fila **no cambian**: es lo
que sostiene las aserciones heredadas de las fichas 45, 158 y 231.

Dentro del panel: `DataTable` + `Pagination`, las primitivas que la ficha 200 fijó y que ya usa la
wallet. El precedente vivo y calcado es `DesgloseMovimientosTienda`, que se despliega desde una fila
de `SaldosTiendasTable`.

### 5.2 Componentes

| archivo | qué es |
| --- | --- |
| `app/(app)/wallet/_components/FilaComposicion.tsx` | la fila desplegable: rótulo + icono + importe + panel. La usan LAS DOS columnas, con `tono` (verde/rojo) por prop |
| `app/(app)/wallet/_components/DetalleFilaComposicion.tsx` | el panel: `useSWR` + `DataTable` + `Pagination` |
| `app/(app)/wallet/_components/composicion-detalle-labels.ts` | textos i18n-ready del detalle (columnas, vacío, error, nombres accesibles) |
| `lib/config/composicion-detalle.ts` | tamaño de página y tope |

**Una sola pieza de disclosure para las dos columnas** y no una copia en cada una: la lógica de
apertura, los `id` y el `aria-controls` duplicados son justo lo que diverge a los tres meses.

### 5.3 Lectura por fila: SWR, montado sólo si está abierta

El `useSWR` vive **dentro** de `DetalleFilaComposicion`, y ese componente **sólo se monta cuando la
fila está abierta**. Consecuencias, que son requisitos:

- la tarjeta con sus 14 filas cerradas cuesta **cero** lecturas de detalle (`R21`);
- abrir una fila cuesta **una** (`R22`);
- la clave SWR incluye la fila, la página y los filtros vigentes, así que dos filas abiertas tienen
  cachés distintas y no se pisan (`R23`).

### 5.4 Los filtros vigentes bajan por props

`WalletModule` ya tiene el estado `filtros`. Se le pasa a `ComposicionGananciaCard`, y de ahí a cada
fila. La construcción del input de filtros se extrae a **una sola función** (hoy vive inline como
`buildInputCompleto` dentro de `WalletModule`), que usan el modo completo de la descarga y el
detalle: dos constructores distintos de los mismos filtros es cómo el detalle acabaría enseñando otro
conjunto que el importe de su fila.

### 5.5 Columnas del detalle

Fecha · Concepto · Detalle · Importe.

- **Concepto** existe porque la fila «Otros» es un CONJUNTO: sin él, esa fila —la única que de verdad
  hace falta abrir— sería ilegible. En las demás filas es redundante y se mantiene por uniformidad.
- **Detalle** es `descripcion` cuando la hay, y el ORIGEN legible cuando no (`R17`). Esto no es
  cosmética: los 9 movimientos de `egreso_pago_mensajero` de producción se escriben con
  `descripcion: null` (lo pone `WalletMensajeroFeedService.construirMovimientosDePago`), así que un
  detalle que sólo mostrara «fecha y descripción» enseñaría nueve renglones en blanco. La composición
  `origen [· descripción]` es la misma que ya usa el desglose de una tienda.
- **Importe**: `money(m.monto)` sobre el STRING del servidor, alineado a la derecha. **No hay fila de
  subtotal** (`R36`): la página no es el conjunto, y un subtotal de página al lado del total de la
  fila es una invitación a restarlos.

### 5.6 El copy de la tarjeta

`DESCRIPCION` enumera hoy «fletes, comisiones, impuestos, gastos, sueldos, indemnizaciones y pagos a
mensajeros» y se calla los **ajustes**. Con los ajustes ganando fila propia, la enumeración pasa a
nombrarlos (`R41`). Es la continuación literal de la corrección que el propio docstring del archivo
documenta: o se nombra todo, o no se enumera. Lo que queda fuera de la ganancia (el dinero de las
tiendas) se dice igual que hoy (`R42`).

### 5.7 La pista de «Otros»

Cuando la fila se pinta (`R8`), lleva debajo un texto corto del estilo «dinero de un concepto que
esta tarjeta todavía no sabe nombrar; ábrela para ver de dónde viene». Vive en el módulo de textos,
no dentro del componente.

---

## 6 — El nombre accesible del control de paginación: cuidado con un censo ajeno

`tests/components/paginacion/paginacion-transversal.test.tsx` barre `app/` buscando
`export const PAGINACION_[A-Z0-9_]*LABEL`, exige que **todo** archivo que declare una de esas
constantes esté registrado en su censo, y cierra con `expect(enArbol).toHaveLength(13)` — los trece
listados del Anexo III de la ficha 170, cada uno con su exigencia de `useSWR` + `fallbackData`.

El detalle de una fila **no es un listado del Anexo III**: es un desplegable por fila, exactamente
igual que el desglose de una tienda, que por el mismo motivo tampoco está en ese censo y nombra su
paginación con una función dentro de su módulo de textos.

**Regla para quien implemente:** el nombre accesible de la paginación del detalle NO se declara como
`export const PAGINACION_*_LABEL`. Se declara como propiedad/función del módulo de textos —
`DETALLE_FILA_NOMBRE.paginacion(fila)` — y compone el nombre de SU fila, que además es lo que `R24`
pide. Bautizarla con el prefijo pondría ese censo en rojo con «14 recibido / 13 esperado» por un
motivo falso.

---

## 7 — El barrido de STRING de la ficha 231: se AMPLÍA, no se afloja

`tests/integration/wallet-page.test.tsx` desestructura `ingresos` fuera y recorre el RESTO de
`composicion` exigiendo `typeof === "string"` en cada clave, con el comentario «cualquier importe que
alguien añada mañana como `number` cae aquí».

Las dos claves nuevas obligan a tocarlo, y hay que hacerlo **sin debilitarlo**:

- `egresos` se desestructura como se desestructura `ingresos`, y se le aplica **el mismo bucle** de
  `typeof === "string"`, con su control de no-vacuidad (`Object.keys(egresos)` tiene tantas entradas
  como el seed). Eso es aplicar la misma exigencia a un mapa nuevo: es más barrido, no menos.
- `hayOtrosEgresos` se desestructura como excepción **NOMINAL** —la clave concreta, nunca un
  `typeof !== "string" → salta`— y gana su propia aserción `typeof === "boolean"`, más un caso que
  afirma que vale `false` cuando `otrosEgresos` es `"0.00"` y `true` cuando no.

El precedente que autoriza la excepción está en el mismo dominio y a la vista: `CajaResumenDTO` ya
lleva una bandera booleana (`periodoFiltrado`) exceptuada por nombre de su propio barrido de STRING.
Lo que la ficha 231 se negó a hacer fue meter una CANTIDAD como `number` (`porcentajeTiendas` viaja
como STRING justamente por eso); una bandera no es una cantidad.

---

## 8 — Censo de tablas: hay que decidir, y aquí está la decisión

`tests/unit/descarga/cobertura-tablas.guardia.test.ts` cuenta instancias de `<DataTable>` en el árbol
y las contrasta contra `tests/unit/descarga/censo-tablas.ts`. Números vigentes medidos hoy:
`TOTAL_ARCHIVOS_CON_DATATABLE = 28`, `TOTAL_INSTANCIAS_DATATABLE = 28`, `totalCensado = 29`,
`con_descarga = 19`, `fuera = 10`.

El detalle añade **una** instancia en **un** archivo nuevo, así que la guardia se pondrá roja hasta
que se registre. Se registra como **`fuera`**, con este motivo escrito en su entrada:

> Desplegable de UNA fila de la tarjeta de la ganancia: es un recorte del **mismo libro** que
> «Libro de movimientos de la caja principal», que sí descarga el conjunto completo con sus filtros
> —incluido el filtro por categoría, que es exactamente lo que este panel muestra—. Una segunda
> descarga del mismo dinero por otra puerta sería un segundo archivo del mismo hecho.

Los cuatro números suben/bajan así: archivos 28 → 29, instancias 28 → 29, `totalCensado` 29 → 30,
`fuera` 10 → 11, `con_descarga` sin cambio (19). **Se miden contra el árbol antes de tocarlos** (la
guardia se deja fallar primero con «29 recibido / 28 esperado»), que es la convención escrita en ese
propio archivo.

---

## 9 — Cómo se prueba que el `WHERE` acota (y por qué no vale un doble)

En este repo está medido **cuatro veces** que una mutación del `WHERE` pasa en verde por delante de
un doble. Por eso las afirmaciones de alcance del detalle se miden contra **Postgres real**, con el
molde de `tests/integration/db/wallet-fecha-elegida.test.ts`: `crearPrismaDeTest` +
`enTransaccionRevertida` (todo se revierte, pase, falle o muera el runner), `describe.skip` si no hay
base alcanzable, y **ni un `return` mudo** — si falta un dato previo, el test FALLA con su motivo.

Lo que se siembra dentro de la transacción y lo que se afirma:

1. **Alcance de la fila.** Movimientos de `egreso_pago_mensajero`, `egreso_ajuste`, `egreso_sueldo` y
   `egreso_gasto` con importes todos distintos. El detalle de «Pagos a mensajeros» devuelve
   **exactamente** los primeros; quitar la restricción de categoría del `WHERE` mete los otros tres y
   el test cae con los importes a la vista.
2. **El complemento.** El detalle de «Otros» devuelve `egreso_gasto` y **NO** devuelve
   `egreso_pago_mensajero` ni `egreso_ajuste`. Es la prueba de que la fila nueva salió del cubo de
   verdad, no sólo en la pantalla.
3. **El total lo da el servidor.** Se siembran `pageSize + 3` movimientos de una categoría:
   `total === pageSize + 3` y `movimientos.length === pageSize`. Un `total = items.length` cae aquí.
4. **Los filtros vigentes recortan.** Un movimiento fuera del rango `desde`/`hasta` no aparece en el
   detalle; y con `categoria` puesta a otra cosa, el detalle de la fila sale vacío.
5. **El importe y la lista son el mismo dinero.** Sobre el mismo conjunto y los mismos filtros:
   `Σ(importes de todas las páginas del detalle) === composicion.egresos[categoria]`. La suma se hace
   **en el test y con `Prisma.Decimal`** (servidor); ni la app ni el navegador suman nada.
6. **Los agregados no se movieron.** `agregarPorCategoriaYTipo` y `agregarPorCategoria` devuelven lo
   mismo con y sin el campo `categorias` presente en la interfaz.

---

## 10 — Alternativas descartadas

**A1 — Extender `listarMovimientosSchema` con `categorias: WalletMovimientoCategoria[]` y reusar la
action del libro.** Descartada por dos motivos, y el segundo es el que decide. (a) Ese schema lo
comparten el listado, el resumen de la caja y —derivado— la descarga completa, así que ampliarlo
mueve la superficie de filtros de tres caminos para servir a uno. (b) Sobre todo: dejaría que **el
navegador definiera el complemento**, mandando la lista de categorías que él cree que compone
«Otros». El complemento es la definición que hace cuadrar la columna; que exista una segunda copia en
el cliente es exactamente el fallo de dinero que esta ficha viene a cerrar. Por eso el cliente manda
un **token de fila** y el servidor resuelve.

**A2 — Fundir `DesgloseEgresosDTO` dentro de `ComposicionGananciaDTO` y servir las seis filas de
egreso desde una sola lectura.** Es tentadora y además arreglaría un defecto latente real: hoy la
columna de egresos mezcla DOS consultas (`verDesgloseEgresosAction` para los cuatro conceptos,
`verResumenCajaAction` para «Otros» y el total), así que en teoría pueden discrepar. Descartada: eso
es un rediseño, no el arreglo de lo evidenciado. Dejaría sin consumidores a `verDesgloseEgresosAction`
y a su servicio (con la guardia de superficie de uso en rojo), y arrastraría a las suites de las
fichas 45 y 158 a un refactor que nadie pidió. **Queda declarada como deuda con nombre**, no como
olvido.

**A3 — Que «Otros» siga pintándose siempre, con «0,00».** Es lo que hay hoy. Descartada por decisión
humana y porque un 0,00 permanente entrena a no mirar esa línea; el valor de la fila está justamente
en que su aparición signifique algo.

**A4 — Abrir el detalle en un modal / `Sheet` en vez de en línea.** Descartada: «abrir la fila» es
literalmente lo que se pidió, el desplegable in situ mantiene el importe de la fila a la vista junto a
sus movimientos —que es la comparación que se quiere hacer— y el repo ya tiene ese patrón funcionando
en la wallet. Un modal además obligaría a repetir en su cabecera el importe y los filtros vigentes
para no perder el contexto.

**A5 — Convertir las dos columnas de la tarjeta en `DataTable` con `renderExpanded`.** Descartada:
cambiaría el lenguaje visual de la tarjeta entera (dos tablas donde hay dos listas de conceptos) y
rompería el `role="group"` + `aria-label` sobre los que se apoyan las aserciones heredadas de las
fichas 45, 158 y 231. El disclosure sobre la `<dl>` consigue lo mismo tocando mucho menos.

**A6 — Decidir en el navegador si «Otros» se pinta, comparando `otrosEgresos !== "0.00"`.**
Descartada: no perdería precisión, pero abre una segunda definición de «esto está en cero» en el lado
que tiene prohibido juzgar dinero, y depende de que el formato canónico nunca produzca `"-0.00"`. El
servidor ya manda banderas derivadas para este tipo de decisión (`periodoFiltrado`,
`modoComposicion`); ésta es una más.

---

## 11 — Riesgos y cómo se contienen

| riesgo | contención |
| --- | --- |
| La fila y su detalle divergen (el importe dice una cosa, la lista otra) | Una sola definición del conjunto de cada fila, usada por la derivación y por el `WHERE`; y un test contra Postgres que suma el detalle y lo compara con el importe |
| El total de egresos se mueve al sacar el pago a mensajeros de «Otros» | El complemento sigue siendo complemento: nada sale de la suma, sólo cambia de cubeta. Test que afirma la identidad `Σ filas === totalEgresos === egresosPropios` |
| Guardias ajenas en rojo por motivos falsos | Tres identificadas y resueltas por escrito aquí: censo de tablas (§8), barrido de STRING (§7) y censo de paginación (§6) |
| Una persona abre muchas filas y dispara muchas consultas | Cada apertura es un acto explícito, lee UNA página acotada por config y se cachea por SWR. El coste de la tarjeta cerrada sigue siendo cero |
| El detalle enseña nueve renglones en blanco | Medido: los pagos a mensajeros llegan con `descripcion: null`. La columna «Detalle» cae al origen legible |
| Un `pageSize` grande colado por el borde | El tope sale de config y el schema lo rechaza como `validation_error`, sin devolver filas |
