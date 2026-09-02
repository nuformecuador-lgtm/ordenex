# Ficha 347 — Diseño

> El CÓMO. Los requisitos (el QUÉ) están en `requirements.md`; el desglose, en `tasks.md`.

## 0 — Resumen de la decisión

**UNA sola lectura** para la tabla de productos: la vertical de la 345 gana una **segunda
consulta a la base** dentro del MISMO servicio, la MISMA consulta preparada y la MISMA entrada de
caché. La pantalla no funde nada.

Sobre eso, tres piezas propias:

1. **`lib/utils/dinero-por-producto.ts`** — módulo puro que declara el criterio de recaudo y
   deriva el reparto de UNA orden **llamando a las funciones que ya existen**
   (`derivarIngresoOrden`, `pagoTiendaOrdenex`). Ni una fórmula de dinero nueva (R16).
2. **`ALCANCE_PRODUCTOS_DINERO`** — segunda tabla rol → alcance en `lib/analytics/metrics.ts`,
   atada a la del volumen por la invariante de R2.
3. **El detalle orden por orden**, como fila que se abre (`renderExpanded`), con su propia Server
   Action bajo demanda — el patrón vivo de las fichas 343 y 344.

Y la entrega B: **la composición de «Otros resultados»** como segunda línea derivada de
`porStatus`, que el payload ya trae.

**Ni tabla, ni columna, ni índice, ni migración, ni RLS** (R79). Todo el dato existe:
`orden.producto`, `gestion_orden.monto_recibido` y las entradas congeladas de `cierre_detail`.

---

## 1 — Por qué UNA lectura y no dos

La alternativa obvia —una Server Action nueva para el dinero y fundir en el cliente por
`(tiendaId, claveProducto)`— está **descartada** (A1 en §12). El motivo es de corrección, no de
gusto: las columnas de volumen y las de dinero se leen **en la misma fila**. Con dos lecturas
resueltas en instantes distintos, una fila puede decir «6 entregadas» y traer el recaudo de 5.

Es la doctrina ya escrita en este árbol, palabra por palabra:

> «Una segunda consulta —aunque preguntara lo mismo— podría resolverse con un corte distinto
> (basta una gestión registrada entre las dos) y dejar en la misma pantalla un 85 % de
> efectividad que no cuadra con los segmentos de al lado.»
> — `app/(app)/analitica/_components/entregas/efectividad.ts`

Con una sola lectura: un solo `lastSync` (R65, R78), una sola clave de caché, un solo refresco, y
la fusión ocurre en el servidor sobre el resultado del **mismo parser**, así que ningún importe
puede quedarse sin fila (⟨Q7⟩).

Coste asumido y declarado: la lectura de dinero **no está acotada por el catálogo de productos**
(la de volumen sí lo está, R57 de la 345). Su cota es el número de gestiones que aportan del
recorte. Se acota por configuración con estado explícito (R76, §8).

---

## 2 — Mapa de archivos

| Archivo | Qué es | Estado |
| --- | --- | --- |
| `lib/utils/dinero-por-producto.ts` | criterio de recaudo + `repartoDeOrden` (puro) | NUEVO |
| `lib/interfaces/repositories/IDineroProductosRepository.ts` | contrato + `FilaDineroCruda` | NUEVO |
| `lib/repositories/DineroProductosRepository.ts` | el SQL de dinero | NUEVO |
| `lib/types/dinero-productos.ts` | DTOs de dinero y del detalle | NUEVO |
| `lib/services/DetalleDineroProductoService.ts` | el detalle de una fila (filtra, ordena, pagina) | NUEVO |
| `lib/actions/detalle-dinero-producto.ts` | el borde del detalle (`"use server"`) | NUEVO |
| `lib/config/dinero-productos.ts` | página, tope de página y tope de órdenes | NUEVO |
| `app/(app)/analitica/_components/entregas/DineroProductoDetalle.tsx` | el panel de la fila abierta | NUEVO |
| `app/(app)/analitica/_components/entregas/detalle-dinero-producto-descarga-columnas.ts` | contrato del archivo del detalle | NUEVO |
| `app/(app)/analitica/_components/entregas/otros-resultados.ts` | composición de «Otros resultados» (puro) | NUEVO |
| `app/(app)/analitica/_components/entregas/dinero-producto-swr.ts` | clave y fetcher del detalle | NUEVO |
| `lib/analytics/metrics.ts` | `+ ALCANCE_PRODUCTOS_DINERO` | EDITADO |
| `lib/analytics/productos-consulta.ts` | `+ resolverAlcanceProductosDinero`, `+ dinero` en la consulta y en la clave | EDITADO |
| `lib/analytics/presentacion.ts` | `+ productosDinero: "visible" \| "oculta"` | EDITADO |
| `lib/services/ConteoProductosService.ts` | segunda consulta + fusión + `ordenesAcompanadas` | EDITADO |
| `lib/types/conteo-productos.ts` | `+ dinero` por fila, `+ ordenesAcompanadas`, `+ estado de tope` | EDITADO |
| `lib/actions/conteo-productos.ts` | construye el servicio con los DOS repositorios | EDITADO |
| `app/(app)/analitica/_components/entregas/ProductosTabla.tsx` | columnas de dinero, fila expandible, composición, avisos | EDITADO |
| `app/(app)/analitica/_components/entregas/analitica-productos-descarga-columnas.ts` | columnas nuevas, condicionadas | EDITADO |
| `app/(app)/analitica/page.tsx` | pasa `productosDinero` a la tabla | EDITADO |
| `tests/unit/analytics/alcance-dinero.guardia.test.ts` | el bloque que fija la doctrina (§3.3) | EDITADO |
| `tests/unit/analytics/tablero-operativo-frontera.guardia.test.ts` | `CAMPOS_DE_PRESENTACION` gana el campo nuevo | EDITADO |
| `tests/unit/descarga/censo-tablas.ts` + `cobertura-tablas.guardia.test.ts` | la tabla del detalle | EDITADO |

---

## 3 — EL CHOQUE CON LA GUARDIA DE DINERO, y cómo se resuelve

### 3.1 Qué dice hoy la guardia, medido en el archivo

`tests/unit/analytics/alcance-dinero.guardia.test.ts` afirma **dos** cosas:

- **(a)** `lib/analytics/alcance-columnas.ts` exporta **exactamente** `whereGestionOrden`,
  `whereOrden` y `whereRollup`, y ningún adaptador para `wallet_movimiento`,
  `wallet_tienda_movimiento`, `pago_mensajero_movimiento`, `cierre_dia` ni `cierre_bodega`.
- **(b)** ninguna `Metrica` con `dominio: "financiera"` declara alcance `acotado` para ningún rol.

Su razón, escrita: *«si una métrica financiera pasa a `acotado`, existe un recorte de dinero SIN
adaptador que lo aplique, o sea un `where` que alguien escribirá a mano»*.

### 3.2 Dónde choca esta ficha, exactamente

**No rompe el test.** `ALCANCE_PRODUCTOS` (y su hermana nueva) **no son `Metrica`**: no llevan
`dominio`, así que `FINANCIERAS = METRICAS.filter(m => m.dominio === "financiera")` no las ve. Y
esta ficha **no añade ningún adaptador** a `alcance-columnas.ts`.

**Pero choca con su doctrina**, y hay que decirlo en vez de esconderse detrás del verde: aquí hay
una lectura que **emite dinero** y que declara `acotado` para `adminTienda`. Es exactamente la
situación que (b) existe para vigilar, colándose por la puerta de que esta vertical vive fuera del
catálogo de 25 métricas.

### 3.3 La resolución: el dinero NO se recorta con un criterio propio

Tres hechos, y ninguno es una opinión:

1. **El universo no es un ledger.** Esta lectura parte de `orden`, con el MISMO `where`
   (`condicionesDeConsulta`) y el MISMO alcance que el análisis de productos de la 345. El dinero
   se DERIVA de las entradas que esas órdenes ya congelaron. No se lee `wallet_movimiento`, ni
   `wallet_tienda_movimiento`, ni `cierre_dia` como universo: `cierre_dia` sólo se une para leer
   su `estado`, y `cierre_detail` para leer las entradas de la fórmula.
2. **El recorte es el operativo, que la 122 SÍ diseñó.** `orden.tienda_id` es la columna canónica
   que `whereOrden` declara. No hay `where` de dinero escrito a mano en ningún sitio.
3. **El repo YA sirve dinero acotado a la tienda, y no por descuido.** `DetalleMovimientoService`
   (`ROL_TIENDA = "adminTienda"`) le entrega a la tienda su propio libro y el detalle por orden
   de sus movimientos, con `tiendaId` en el `WHERE`. La guardia no lo prohíbe porque no pasa por
   `METRICAS`. Lo que esta ficha añade es de la misma naturaleza: **la tienda ve SU dinero.**

Sobre esos hechos, la resolución tiene una pieza dura y una blanda:

**Pieza dura — R2, la invariante de atadura.** `ALCANCE_PRODUCTOS_DINERO[rol]` sólo puede valer
`"prohibido"` o **exactamente** `ALCANCE_PRODUCTOS[rol]`. Se comprueba rol por rol en un test. La
consecuencia es la que cierra el agujero que la guardia teme: **es imposible que el dinero se
sirva con un recorte que el volumen no tenga ya**, así que nunca hará falta un `where` de dinero
nuevo. Si alguien quisiera uno, tendría que ensanchar primero el alcance del volumen, que es una
decisión visible y con su propio guardia.

**Pieza blanda — la guardia gana un bloque, no una excepción.** Se añade a
`alcance-dinero.guardia.test.ts` un `describe` que declara por escrito el límite:

- `alcance-columnas.ts` sigue exportando **exactamente tres** adaptadores (no se toca (a));
- las métricas financieras del catálogo siguen sin `acotado` (no se toca (b));
- **y** —lo nuevo— `ALCANCE_PRODUCTOS_DINERO` cumple R2 para los cinco roles, y el repositorio de
  dinero **no escribe ninguna condición de recorte propia**: se comprueba leyendo su fuente y
  afirmando que sus condiciones salen de `condicionesDeConsulta` y que no contiene ningún
  `tienda_id`/`zona_id` escrito a mano fuera de esa llamada;
- con **autocomprobación**: una tabla sintética que viola R2 tiene que ser detectada, y una fuente
  sintética con un `tienda_id` propio también.

**No se relaja nada y no se añade ninguna allowlist.** El guardia sale de esta ficha afirmando
*más* cosas que antes.

### 3.4 La salida, si el humano decide que NO

Si se decide que una tienda **no** puede ver su propio dinero en esta pantalla, el cambio es de
**una línea**: `ALCANCE_PRODUCTOS_DINERO.adminTienda = "prohibido"`. Todo lo demás sigue en pie —
la tabla se pinta sin columnas de dinero para ese rol (R6), la acción deniega (R5) y el archivo
sale sin esas columnas (R67)—. Esa es la razón de que la tabla del dinero sea **propia** y no un
reúso de `ALCANCE_PRODUCTOS`: separa «quién ve volumen» de «quién ve dinero» en el único sitio
donde se puede leer.

---

## 4 — El modelo de las cifras

### 4.1 Las cuatro cifras de una fila, y por qué cuadran

Por producto y tienda, sobre las órdenes del recorte que contienen ese producto:

| Cifra | Qué es | De dónde sale |
| --- | --- | --- |
| `recaudado` | lo que las gestiones de ENTREGA cobraron | Σ `gestion_orden.monto_recibido` |
| `liquidado.recaudado` | la parte de lo anterior en cierres APROBADOS | ídem, restringido |
| `liquidado.ordenex` | flete + IVA + comisión + IVA | `derivarIngresoOrden` sobre `cierre_detail` |
| `liquidado.tienda` | lo que le queda a la tienda | `pagoTiendaOrdenex(...)` |
| `pendiente.recaudado` | lo entregado y aún no liquidado | Σ sobre las gestiones sin cierre aprobado |
| `retorno` | flete de devolución + IVA de las RECHAZADAS liquidadas | `derivarIngresoOrden` |

**Dos invariantes exactas, y las dos por construcción:**

```
liquidado.ordenex + liquidado.tienda === liquidado.recaudado        (R20)
liquidado.recaudado + pendiente.recaudado === recaudado             (R21)
```

La primera es cierta porque `liquidado.tienda` **se calcula como esa resta**:
`pagoTiendaOrdenex(liquidado.recaudado, fleteConIva, comisionConIva)`. No es una coincidencia
aritmética que haya que vigilar, es la definición.

La segunda es cierta porque las gestiones de entrega se particionan en dos: las de un cierre
aprobado con snapshot, y todas las demás. Cada gestión cae en **una** y sólo una.

### 4.2 Las rechazadas — la pregunta que el encargo hizo explícita

**Entran, pero FUERA del reparto** (R19), en la cifra `retorno`.

El razonamiento no es mío: está escrito en `pagoTiendaOrdenex`:

> «NO descuenta el flete de devolución + IVA (el de los RECHAZOS desde la ficha 301): un rechazo
> no cobra COD, así que no aporta al total recibido y no se le resta a lo recibido.»

Si `retorno` entrara en `liquidado.ordenex`, la igualdad de R20 dejaría de ser cierta:
`ordenex + tienda` daría `recaudado + retorno`. Y no es un detalle contable: sería afirmar que de
la plata que el mensajero trajo salió un cobro que **nadie recaudó**. El retorno es una cuenta por
cobrar a la tienda, no una división de lo recogido.

Y **sólo `rechazada`**, nunca `devuelta`: es la regla de negocio de la ficha 301, y viene ya
puesta por `CRITERIO_DE_APORTE.ingreso_flete_devolucion`. Esta ficha no la escribe: la **lee**.

### 4.3 Liquidado vs pendiente

Una gestión está LIQUIDADA si cumple las TRES:

1. tiene `cierre_id`;
2. ese cierre tiene `estado = 'aprobado'`;
3. existe la fila `cierre_detail(cierre_id, orden_id)` con `tarifa_id IS NOT NULL`.

La (3) es R23: sin tarifa congelada no se deriva nada. `derivarIngresoOrden` con `tarifa === null`
devuelve `{}` — el gap R9 de la feature 42, que se **preserva** y no se convierte en `0,00`.

Lo pendiente **no se proyecta** (R31). La pantalla muestra el recaudo pendiente —que sí es un
hecho, `monto_recibido` existe desde que se registró la gestión— y el reparto en **blanco**, con
el marcador de dato ausente (R30). El rótulo de la sección dice de qué está hablando (R29).

### 4.4 Las órdenes acompañadas (R13)

Sale del lado de VOLUMEN y no del de dinero: en `fundir()` de la 345, tras deduplicar los ítems de
una fila cruda, si quedan **dos o más claves distintas**, esas `n` órdenes son acompañadas. Es un
entero, no toca dinero, y es aditivo.

### 4.5 El criterio, declarado UNA vez

`lib/utils/dinero-por-producto.ts` declara:

```ts
/** Lo que una gestión de ENTREGA recaudó. Misma forma que los criterios de la 344. */
export const CRITERIO_RECAUDO_ENTREGA: CriterioDeAporte = {
  resultados: ["entregada"],
  exigeCobraComision: false,
  exigeTarifa: false,        // el recaudo existe sin cierre: es lo cobrado, no lo derivado
  exigeMontoCobrar: false,
  exigeMontoRecibido: true,  // supresión de ceros: una gestión sin recaudo no aporta
};

/** Los resultados que la consulta tiene que traer. DERIVADO, no escrito (R24). */
export const RESULTADOS_QUE_APORTAN: readonly GestionResultado[] = /* unión de
  CRITERIO_RECAUDO_ENTREGA.resultados y de CRITERIO_DE_APORTE[c].resultados para los
  seis conceptos, deduplicada y ordenada */;
```

Hoy `RESULTADOS_QUE_APORTAN` vale `["entregada", "rechazada"]`. **No se escribe esa lista**: se
deriva, para que el día que la fórmula gane un resultado —como pasó al revés con la 301— la
consulta lo gane con ella en el mismo commit.

`repartoDeOrden` es la única función nueva, y **no calcula dinero**: llama a `derivarIngresoOrden`
por gestión liquidada, acumula con `Prisma.Decimal` (la misma acumulación que ya hace
`aporteDeOrden`, y por la misma razón: los aportes vienen ya a escala 2) y cierra con
`pagoTiendaOrdenex`. Salida: cuatro STRING escala 2 (R22).

---

## 5 — La consulta de dinero

### 5.1 El `where` NO se vuelve a escribir (R75)

`condicionesDeConsulta(consulta)` de `ConteoPorStatusRepository` se importa y se usa tal cual,
igual que hizo la 345. Ya acepta `RecorteDeOrdenes`, así que **no hay que ensanchar nada**.

⚠ **El `LEFT JOIN LATERAL` es OBLIGATORIO aunque esta consulta no necesite el desenlace.**
`condicionesDeConsulta` referencia `u."created_at"` en la ventana de fecha; sin el lateral con
alias `u`, el SQL **no compila**. Se copia literal del de la 345.

### 5.2 El SQL

```sql
SELECT o."id"            AS orden_id,
       o."tienda_id"     AS tienda_id,
       t."nombre"        AS tienda_nombre,
       o."producto"      AS producto,          -- texto CRUDO, la misma fuente que la 345
       o."num_guia"      AS num_guia,
       o."num_remision"  AS num_remision,
       o."destinatario"  AS destinatario,
       g."id"            AS gestion_id,
       g."resultado"     AS resultado,
       g."monto_recibido" AS monto_recibido,
       c."estado"        AS cierre_estado,     -- NULL si la gestión no tiene cierre
       d."monto_cobrar", d."cobra_comision", d."es_central", d."es_zona_especial",
       d."tarifa_id", d."tarifa_valor_flete", d."tarifa_valor_flete_gam",
       d."tarifa_valor_flete_devuelto", d."tarifa_valor_flete_devuelto_gam",
       d."tarifa_comision_cod", d."tarifa_iva_flete", d."tarifa_iva_comision_cod",
       d."tarifa_especial", d."tarifa_especial_devuelta"
FROM "orden" o
JOIN "order_status" s ON s."id" = o."estatus_id"
JOIN "usuario"      t ON t."id" = o."tienda_id"
LEFT JOIN LATERAL (                             -- lo EXIGE el where (§5.1)
  SELECT g2."resultado", g2."created_at"
  FROM "gestion_orden" g2
  WHERE g2."orden_id" = o."id" AND g2."anulada_at" IS NULL
  ORDER BY g2."created_at" DESC, g2."id" DESC
  LIMIT 1
) u ON TRUE
JOIN "gestion_orden" g ON g."orden_id" = o."id"
                      AND g."resultado" IN (<RESULTADOS_QUE_APORTAN>)
LEFT JOIN "cierre_dia"    c ON c."id" = g."cierre_id"
LEFT JOIN "cierre_detail" d ON d."cierre_id" = g."cierre_id" AND d."orden_id" = o."id"
WHERE <condicionesDeConsulta(consulta)>
ORDER BY o."id", g."id"
LIMIT <tope + 1>
```

Notas que hay que leer antes de tocar esto:

- **`JOIN` a `gestion_orden` sin `anulada_at IS NULL`**, y es deliberado: se replica el `where` del
  feed que produjo el importe, exactamente la decisión escrita en `CierreAporteRepository`. Añadir
  la cláusula «por prudencia» sería un criterio que el productor no tiene, y el detalle dejaría de
  cuadrar con la wallet. Consecuencia declarada y ⟨Q3⟩.
- **`resultado IN (...)` sale de `RESULTADOS_QUE_APORTAN`**, derivado del criterio (R24). Es la
  misma técnica que `CierreAporteRepository` usa con `resultado: { in: [...criterio.resultados] }`.
- **`LEFT JOIN` a cierre y detalle**, no `INNER`: las gestiones entregadas sin cierre aprobado
  tienen que entrar, son justamente el «pendiente» (R28).
- **Grano de fila: `(orden, gestión)`**. Una orden en dos cierres aporta dos filas, cada una con
  su propio snapshot congelado — que es exactamente lo que R18 necesita.
- **`ORDER BY o."id", g."id"`**: total y estable. Sin él, `LIMIT` cortaría un conjunto distinto
  entre dos lecturas iguales.
- **`LIMIT tope + 1`**: el `+1` es lo que permite detectar el desbordamiento sin un `COUNT`
  aparte (patrón `rangoDeArchivo` de la 344). Ver §8.
- **Ningún índice nuevo:** el `where` es el mismo de una consulta que ya corre;
  `gestion_orden(orden_id)`, `cierre_detail(orden_id)` y `cierre_detail(cierre_id, orden_id)` ya
  existen.

Salida del repositorio: `FilaDineroCruda[]`, con **todos los importes ya convertidos a STRING con
`toFixed(2)` en el repositorio** (mismo criterio que `CierreAporteRepository`), nunca `number`.

### 5.3 La fusión, en el servicio

`ConteoProductosService.consultar()`:

1. lee el volumen (la consulta de la 345, sin tocar) y funde como hoy;
2. **si** `consulta.dinero === "concedido"`, lee el dinero y lo funde;
3. sella `lastSync` **una vez**, dentro del productor de caché.

La fusión del dinero:

1. agrupar las filas crudas por `orden_id`;
2. por cada orden, `repartoDeOrden(gestiones)` → sus cuatro importes;
3. `parsearProducto(orden.producto)` (memoizado por texto) y deduplicar por clave — **el MISMO
   parser y la MISMA deduplicación** que el volumen, así que las claves casan por construcción;
4. acumular el reparto de esa orden en cada grupo `(tiendaId, clave)` — **entero en cada uno**
   (R12), y contar la orden UNA vez por grupo (R18);
5. adosar el resultado a la fila de volumen que ya tiene esa clave.

Los conteos de órdenes del dinero (`liquidado.ordenes`, `pendiente.ordenes`) se cuentan por
`Set<ordenId>` por grupo: una orden con dos gestiones o dos cierres cuenta **una vez** (R18).

Si un grupo no recibe dinero (ningún aporte), su campo `dinero` queda con todas las cifras en
`null`, **no en `"0.00"`** — «no hubo» y «salió cero» son hechos distintos, y la pantalla los
pinta distinto (R30).

---

## 6 — El alcance, la consulta preparada y la caché

### 6.1 La tabla nueva

```ts
// lib/analytics/metrics.ts, junto a ALCANCE_OPERATIVA, ALCANCE_FINANCIERA y ALCANCE_PRODUCTOS
export const ALCANCE_PRODUCTOS_DINERO = {
  maestro: "total",
  admin: "total",
  adminSatelite: "prohibido",
  adminTienda: "acotado",   // SU dinero, con el recorte operativo de la 345 (§3.3)
  mensajero: "prohibido",
} as const satisfies Readonly<Record<RolAnalitica, AlcanceMetrica>>;
```

Vive en `metrics.ts` **obligatoriamente**: `alcance-fuente-unica.guardia` censa `app/`, `lib/`,
`components/` y `scripts/` buscando el DATO `maestro: "total"` y falla si aparece fuera de ese
archivo. Escribirla en `productos-consulta.ts` la pondría roja. No se relaja el guardia y no se
evade con un truco de escritura.

### 6.2 La consulta preparada gana un campo

```ts
export interface ConsultaProductos extends RecorteDeOrdenes {
  readonly [marcaProductos]: true;
  /** Resuelto en el SERVIDOR desde ALCANCE_PRODUCTOS_DINERO. Nunca llega del cliente (R8). */
  readonly dinero: "concedido" | "denegado";
}
```

**No hace falta un tipo opaco nuevo** y por tanto no hay que ampliar `TIPOS_OPACOS` del guardia de
alcance obligatorio: el repositorio de dinero recibe la MISMA `ConsultaProductos` en su firma, que
es lo que ese censo exige. Menos superficie, y una sola puerta.

`prepararConsultaProductos` gana un quinto paso: tras resolver el alcance de datos, resuelve la
**concesión de dinero** con `resolverAlcanceProductosDinero(actor)`. Un `denegado` de dinero **no
deniega la lectura**: apaga el dinero. Eso es lo que hace posible R6 (la tabla se pinta sin las
columnas) sin dos peticiones.

### 6.3 La clave de caché — el punto donde se puede filtrar dinero

⚠ **`claveConPrefijo` compone la clave con filtro + rango + alcance y NADA MÁS** (medido en
`lib/analytics/entregas-conteo.ts`). Si la concesión de dinero no entra en la clave, dos actores
con el mismo alcance de datos y distinta concesión **comparten entrada**: el primero que sea
maestro deja el dinero en caché y el siguiente lo recibe. Eso no es una cifra equivocada, es una
**fuga**.

Se resuelve como ya se resolvió el caso del contador de hoy: **sin tocar el cuerpo compartido**,
componiendo un sufijo propio.

```ts
export function claveDeConteoProductos(consulta: ConsultaProductos): string {
  return [claveConPrefijo(TAG_CONTEO_PRODUCTOS, consulta), `$=${consulta.dinero}`].join(SEP);
}
```

R9 tiene test propio y una mutación obligatoria (quitar el sufijo ⇒ rojo).

### 6.4 Presentación

`RecortePresentacion` gana `productosDinero: "visible" | "oculta"`, derivado de
`ALCANCE_PRODUCTOS_DINERO`, exactamente como la 345 hizo con `productos`. **Etiqueta y no
`boolean`**: el bloque (b) de `tablero-operativo-frontera.guardia` exige que todo campo del
contrato sea una etiqueta, y esa exigencia es lo que mantiene los campos de datos fuera. Se edita
`CAMPOS_DE_PRESENTACION` en el guardia, con su motivo escrito — que es su punto de extensión
declarado.

La página no importa `metrics` (la allowlist nominal de esa ruta no lo permite; está medido en
`progress/impl_345.md §11`): lee `recorte.productosDinero` y lo pasa como prop.

Y no sustituye a nada: la acción **deniega igual** (R5). Un panel que no se pinta no es un dato que
no se sirve.

---

## 7 — El detalle orden por orden

### 7.1 Forma: la fila que se abre

`DataTable` ya soporta `renderExpanded` + `expandAriaLabel`, y las fichas 343 y 344 dejaron el
patrón medido: el panel se monta **sólo al abrirse**, así que la tabla con las filas cerradas
cuesta **cero** lecturas (R33), abrir una cuesta exactamente una, y dos paneles abiertos llevan su
propia página (R34).

### 7.2 La Server Action del detalle, y por qué el `tiendaId` no es un agujero

```ts
export async function consultarDetalleDineroProducto(
  raw: unknown,     // { filtro, tienda_id, producto_clave, page }
  deps?: ...,
): Promise<ResultadoDetalleDineroProducto>
```

El cliente manda el **filtro de la sección** (el mismo objeto `.strict()` de siempre) con
`tienda_id: [<la tienda de la fila>]` **como una faceta más**, y la clave del producto.

Ésa es la pieza importante: el `tiendaId` **no entra por una puerta nueva**. Entra por la faceta
que `recortarFiltroConteoEntregas` ya interseca con el alcance del actor, así que una tienda ajena
produce `filtro_fuera_de_alcance` → `forbidden` (R44), y la tienda concedida acaba en el `WHERE`
de SQL (R43, R7). Cero código de permisos nuevo.

La **clave del producto** se filtra en memoria, y se dice por qué se puede: no es una frontera de
seguridad —lo es la tienda, y ésa va en el `WHERE`— y no hay forma de filtrarla en SQL sin
introducir una segunda definición de «este texto contiene este producto». Ver A3 en §12.

### 7.3 Qué devuelve

```ts
interface OrdenDineroDTO {
  ordenId: string;            // rowKey. NUNCA al archivo (R69)
  guia: string;               // num_guia si lo hay; si no, num_remision
  destinatario: string;
  resultados: GestionResultado[];   // los de las gestiones que hicieron aportar
  estado: "liquidada" | "pendiente";
  recaudado: string;          // STRING escala 2
  ordenex: string | null;     // null si pendiente (R27/R30)
  tienda: string | null;
  retorno: string | null;
}

interface DetalleDineroProductoPayload {
  producto: string;           // la forma visible
  tiendaNombre: string;
  totales: DineroProductoDTO; // las MISMAS cifras que la fila, para poder cotejar
  total: number;              // N órdenes del conjunto, contado por el SERVIDOR (R40)
  page: number; pageSize: number;
  ordenes: OrdenDineroDTO[];
}
```

`totales` va en la cabecera del panel por el mismo motivo que la 344 pinta el `monto` del
movimiento: **para poder cotejar la suma sin salir de la pantalla**. Y **no hay fila de subtotal
de página** — la página no es el conjunto, y un subtotal al lado del total invita a restarlos.

Orden total de las filas: `guia asc, ordenId asc` (mismo criterio y mismo motivo que
`ORDEN_TOTAL` de la 344: sin desempate único, paginar repite u omite una orden).

### 7.4 Ninguna fila en cero (R39)

Se excluyen las órdenes cuyas cuatro cifras sean cero. Es la misma decisión que el humano tomó en
la 344 (⟨Q2⟩ de aquella ficha: «lo que aporta cero no es parte del número»), y aquí además es
**la mitad de la verificación anti-vacuidad** — ver §10.

---

## 8 — El tope, y qué se hace al superarlo

`lib/config/dinero-productos.ts`, molde exacto de `lib/config/detalle-movimiento.ts`:

```ts
DETALLE_DEFAULT_PAGE_SIZE   // 25 — el del desplegable de la 344, misma forma de panel
DETALLE_MAX_PAGE_SIZE       // 100
MAX_ORDENES                 // el tope de la lectura de dinero. ⟨Q4⟩ pide el número
```

La consulta pide `MAX_ORDENES + 1` filas. Si llegan más, **no se sirve una cifra**: el DTO devuelve
`dinero: { estado: "limite_excedido", limite }` y la pantalla lo dice y pide acotar el filtro
(R76). El patrón es el de `comoArchivo` en `DetalleMovimientoService`: *o van todas, o no va
ninguna*. Servir una suma sobre un conjunto truncado sería el peor de los resultados posibles —una
cifra de dinero que parece firme y está incompleta.

Las columnas de VOLUMEN siguen mostrándose con normalidad en ese caso: el tope es de la lectura de
dinero, no de la de productos.

---

## 9 — La pantalla

### 9.1 Las columnas de dinero

Sobre las diez que ya tiene la tabla (345 + 346), se añaden **tres** cuando el dinero está
concedido:

| Columna | Contenido | Nota |
| --- | --- | --- |
| `Recaudado` | `recaudado` | encabezado con la marca de «no sumable» |
| `Cobró Ordenex` | `liquidado.ordenex` | `—` si no hay nada liquidado |
| `Para la tienda` | `liquidado.tienda` | `—` si no hay nada liquidado |

Y **dos líneas de contexto** en la celda de `Recaudado`, no columnas nuevas: `N acompañadas` y
`pendiente de cierre: <importe> (M órdenes)`. Motivo: la tabla ya tiene diez columnas y a 390 px
lleva dos arreglos de ancho medidos; tres columnas más de dinero caben, siete no.

`retorno` **no** es columna: va en la cabecera del panel del detalle y en el archivo. Es una cifra
que sólo tiene sentido leída junto a su explicación, y como columna se sumaría mentalmente al
reparto — que es justo lo que R19 impide.

Formato: **`money(valor)` de `lib/config/moneda.ts`**, que recibe STRING. `formatearValor(_,
"moneda")` recibe `number` y **no se usa en este camino** (R22). Prohibidos en el componente:
`truncate`, `line-clamp`, `overflow-hidden` sobre una cifra (R63) — es la lección medida de las
fichas 343 y 344: dinero cortado no se ve roto, se ve como **otro número**.

### 9.2 El aviso de «no sumable» (R45)

Tercer párrafo bajo el título, junto a los dos que ya hay:

> «Estas cifras son de la ORDEN completa, no del producto: una orden con varios productos cuenta
> entera en cada uno. Esta columna no se puede sumar hacia abajo.»

Y en el encabezado de cada columna de dinero, la marca corta: `Recaudado (no sumable)`. En el
archivo va en el encabezado, porque el párrafo de pantalla no viaja con el `.xlsx` (R49).

### 9.3 La composición de «Otros resultados» (entrega B)

**Segunda línea dentro de la celda**, bajo el número. `3 devueltas · 2 reprogramadas`.

`otros-resultados.ts`, módulo puro:

```ts
export function composicionOtrosResultados(
  porStatus: readonly ConteoDeStatus[],
): readonly { readonly status: string; readonly conteo: number }[];
```

- **se DERIVA de `DESENLACES`** (R51/R52): «está en el catálogo de desenlaces y no es ninguno de
  los dos que ya tienen columna propia». Ni una lista escrita. Es la misma regla —y por la misma
  razón— con la que la 346 derivó el cubo `otrosDesenlaces`, y su test la mata con el caso del
  **sexto desenlace inyectado**, que es lo único que distingue derivar de escribir;
- excluye las órdenes sin desenlace (R53): ésas son «En proceso»;
- orden determinista: `conteo desc`, `status asc` por unidades de código (**no** `localeCompare`,
  que depende del ICU del entorno) (R56);
- vacío ⇒ nada se pinta (R54).

Las etiquetas salen de **`etiquetaDeDesenlace`**, que ya existe y está exportada en
`ConteoEntregasAnillo.tsx`. No se declara una segunda tabla de etiquetas: `order_status` no tiene
columna `label` y una tabla propia se desincronizaría en el próximo renombre.

**Por qué segunda línea y no tooltip** (A5 en §12): un tooltip no existe en táctil —y esta tabla
tiene dos arreglos de ancho medidos a 390 px—, no se copia y los lectores de pantalla lo tratan
distinto. **Por qué no celda expandible**: añadiría un segundo control por fila en una tabla que
ya va a tener uno (el del detalle de dinero), y dos disclosures por fila es exactamente el ruido
que la 343 quitó de la wallet.

En la vista de teléfono, que apila etiqueta + cifra, la composición cae como sub-línea de «Otros
resultados» — sin ocultar nada (R57, R64).

---

## 10 — La verificación del cuadre, diseñada contra la lección de la 344

La 344 exigió «la suma del detalle = el importe de la fila», y el agente descubrió que **aflojar
el `WHERE` dejaba entrar órdenes que aportaban ₡0 y la suma seguía cuadrando**. Hubo que añadir
«ninguna fila aporta 0,00».

Aquí la verificación se diseña para que **no pueda pasar por vacuidad ni por ceros**. Son cinco
aserciones, y las cinco tienen que estar en el mismo test:

1. **No vacía.** `expect(detalle.ordenes.length).toBeGreaterThan(0)` **y**
   `expect(detalle.total).toBeGreaterThan(1)` — con una sola orden, «la suma cuadra» no dice nada.
2. **No cero.** `expect(fila.dinero.liquidado.ordenex).not.toBe("0.00")` para las tres cifras del
   reparto: un cuadre entre ceros es cierto y vacío.
3. **Suma igual, las tres.** `Σ detalle[].recaudado === fila.recaudado`,
   `Σ detalle[].ordenex === fila.liquidado.ordenex`, `Σ detalle[].tienda === fila.liquidado.tienda`
   — comparadas como STRING, sin convertir a número.
4. **Cardinal igual.** `detalle.total === fila.dinero.liquidado.ordenes + fila.dinero.pendiente.ordenes`.
   Ésta es la que hace que aflojar el `WHERE` duela: una orden de más sube el cardinal aunque su
   aporte sea cero.
5. **Conjunto literal.** El test de integración siembra un caso y afirma las **guías exactas** y
   los **importes exactos**, escritos a mano en el test (`toEqual` literal). No «la suma de lo que
   devuelve la función es lo que devuelve la función»: es la lección de *aserción contra su propia
   fuente* — un cuadre comparado consigo mismo está siempre verde.

Y **ninguna fila del detalle puede aportar cero en las cuatro cifras** (R39), que es la aserción
que la 344 tuvo que añadir a posteriori y aquí nace con el spec.

**Mutaciones obligatorias** (el implementer reporta la línea de fallo REAL de cada una):

| # | Mutación | Qué tiene que ponerse rojo |
| --- | --- | --- |
| M1 | quitar `c."estado" = 'aprobado'` del criterio de liquidada | R20/R26: entra dinero de cierres sin aprobar |
| M2 | quitar el `tienda_id` del `WHERE` del detalle | el test de integración de aislamiento contra Postgres |
| M3 | meter `retorno` dentro de `ordenex` | R20: la igualdad deja de cumplirse |
| M4 | escribir `["entregada","rechazada"]` a mano en vez de derivar `RESULTADOS_QUE_APORTAN` | el caso del concepto inyectado |
| M5 | quitar el sufijo de dinero de la clave de caché | R9 |
| M6 | `null` → `"0.00"` cuando no hay nada liquidado | R30 |
| M7 | contar `items.length` en vez del total del servidor | R40 |
| M8 | escribir la lista de desenlaces a mano en la composición | el caso del **sexto desenlace inyectado** |
| M9 | añadir un total al pie de la columna de dinero | R47 (y su autocomprobación, R48) |
| M10 | dejar que una orden en dos cierres cuente dos veces | R18 |

⚠ Y el test de integración **no puede abstenerse**: nada de `if (!datos) return;`. Si la siembra
no produjo el caso, el test **falla**. Es el modo de fallo medido en este repo (*test de
integración verde sin datos*).

---

## 11 — La guardia de «no sumable» (R47/R48)

`tests/unit/analytics/dinero-producto-no-sumable.guardia.test.ts`, dos mitades:

**(a) Estática.** Lee `ProductosTabla.tsx` **sin comentarios** (`tests/fixtures/sin-comentarios`)
y afirma que no aparece `totalizar(`, ni `<tfoot`, ni ningún acumulador sobre las claves de
dinero. Y —money-safe— que no aparece ninguna de `LLAMADAS_PROHIBIDAS_EN_DINERO`.

**(b) Dinámica, que es la que de verdad muerde.** Renderiza la tabla con **tres filas de importes
elegidos para que su suma sea un número que no aparece en ninguna otra parte** (p. ej. `1000.00`,
`200.00`, `30.00` ⇒ `1230.00`) y afirma que **el texto de esa suma no está en el DOM**. Si mañana
alguien añade el total al pie, ese número aparece y el test cae.

**(c) Autocomprobación (R48).** El mismo predicado se aplica a un fragmento sintético que **sí**
lleva el total, y tiene que detectarlo. Sin este caso la guardia estaría verde por vacío, que es
el modo de fallo que esta ficha ha visto tres veces en el árbol.

---

## 12 — Alternativas descartadas

**A1 — Una Server Action nueva para el dinero y fundir en el cliente por `(tiendaId, clave)`.**
DESCARTADA. Es la que menos toca la 345, y por eso era la tentadora. Dos lecturas se resuelven en
instantes distintos: basta una gestión registrada entre las dos para que la misma fila muestre «6
entregadas» y el recaudo de 5. La doctrina del árbol está escrita literalmente en
`efectividad.ts`, y la 345 la aplicó en su A6 y en R52 («el archivo sale de las MISMAS filas»).
Además abriría el caso del dinero huérfano (⟨Q7⟩), que con una lectura no puede existir. Coste
asumido de la elegida: se toca `ConteoProductosService` y su DTO, de forma **aditiva**.

**A2 — Repartir el importe de la orden entre sus productos (por cantidad o a partes iguales).**
DESCARTADA **por decisión del humano y por medición**: no existe el precio unitario en ninguna
parte del sistema —`orden.producto` sólo trae `cantidad * nombre`—, así que cualquier reparto sería
una cifra inventada con aspecto de dato. Y repartir por cantidad afirmaría que dos unidades de un
producto barato «pesan» más que una de uno caro.

**A3 — Restringirse a las órdenes de un solo producto.** DESCARTADA por medición, y es la variante
que la 345 dejó anotada como ⟨Q5⟩: `BASE C` mostraría ₡15.900 de ₡393.433 y
`BASE DE COLAGENO | …` no mostraría **nada** (sus 8 entregadas van acompañadas). Una cifra que
existe para el 88 % de las órdenes y no para el 12 % restante se lee como si fuera el total.

**A4 — Filtrar el producto en SQL con `ILIKE '%clave%'` para el detalle.** DESCARTADA, y conviene
saber por qué porque parece gratis: la clave la produce `limpiar()`, que **colapsa los espacios
repetidos**, así que `"BASE   C"` genera la clave `"base c"` y `ILIKE '%base c%'` **no casaría con
su propio texto**. Un pre-filtro que pierde filas sobre un camino de dinero es peor que traer de
más. Se filtra en memoria con el parser, que es la única definición del repo de «este texto
contiene este producto».

**A5 — La composición de «Otros resultados» en un tooltip.** DESCARTADA. No existe en táctil, y
esta tabla ya tuvo **dos** arreglos de ancho medidos a 390 px: el caso del teléfono no es un borde
aquí, es el que rompe. Tampoco se copia con el ratón y los lectores de pantalla lo tratan de forma
desigual. La segunda línea es dato en el DOM, legible siempre.

**A6 — Enumerar los desenlaces en la etiqueta («Devueltas y reprogramadas»).** DESCARTADA por
decisión ya tomada en la 346 y **no reabierta**: la etiqueta mentiría el día que el catálogo gane
un desenlace. La composición es DATO derivado de `porStatus`; crece sola.

**A7 — Un rollup con el dinero por producto.** DESCARTADA por el mismo argumento con el que la 345
descartó el suyo, más uno propio: además de congelar el parser —el histórico seguiría mintiendo
hasta un re-backfill—, congelaría el estado de liquidación, que **cambia** cuando se aprueba un
cierre. Un rollup diría «pendiente» de algo que ya se pagó.

**A8 — Reusar `ALCANCE_PRODUCTOS` para el dinero.** DESCARTADA. Sería una tabla decidiendo dos
permisos distintos, y el día que se quiera cerrar el dinero a las tiendas —que es una decisión de
producto viva, ver §3.4— habría que partirla bajo presión. Con dos tablas atadas por R2, la
decisión es una línea y el recorte de datos **no puede** divergir.

**A9 — Un tipo opaco propio `ConsultaProductosDinero`.** DESCARTADA: no hay una segunda consulta
preparada. El repositorio de dinero recibe la MISMA `ConsultaProductos`, que es lo que
`alcance-obligatorio.guardia` exige, y así no hay que ampliar `TIPOS_OPACOS` ni crear una segunda
puerta de preparación que pudiera divergir de la primera.

**A10 — Servir la suma sobre un conjunto truncado cuando se supera el tope.** DESCARTADA: una
cifra de dinero incompleta no se ve incompleta. O van todas las órdenes, o no va ninguna — el
mismo criterio que `DetalleMovimientoService.comoArchivo` ya aplica con `limite_excedido`.

---

## 13 — Lo que esta ficha NO hace

- No añade tabla, columna, índice, migración ni policy RLS. **Sólo lee.**
- No escribe ninguna fórmula de dinero: llama a `derivarIngresoOrden` y a `pagoTiendaOrdenex`.
- No toca el catálogo de 25 métricas, ni el rollup, ni el job diario.
- No cambia ninguna cifra ya visible: lo de la 345 y la 346 se queda igual, y lo nuevo es aditivo.
- No abre la analítica a ningún rol nuevo: `adminSatelite` y `mensajero` siguen sin ver productos,
  y por tanto tampoco su dinero.
- No cambia el alcance de `/wallet` ni de `/mi-wallet`, ni toca los feeds del cierre.
- No reparte el importe de una orden entre sus productos, ni proyecta el reparto de lo pendiente.
