# Ficha 344 — Diseño

> Cubre `requirements.md`. Todo lo que aquí se afirma sobre el árbol se leyó en el **archivo
> real** (el grafo del MCP se usó para localizar, no para concluir: devuelve de más).
> Lo que NO se pudo medir en esta sesión —el estado de la base de producción— está marcado como
> tal y se mide en `tasks.md § T0.1` antes de tocar código.

## 0 — La decisión de fondo, en tres frases

1. **No se guarda nada nuevo.** El aporte de una orden a un concepto se **re-deriva** con
   `derivarIngresoOrden` sobre las entradas que `cierre_detail` ya congeló. Eso no es una fórmula
   nueva: es el camino de auditoría que el propio esquema declara («con las entradas +
   `derivarIngresoOrden` la fila es re-derivable y auditable») y que
   `CierresAdminRepository.toIngresoOrdenex` ya recorre para el detalle de un cierre.
2. **El criterio «esta orden aporta a este concepto» se declara UNA vez**, en una tabla pura, y de
   esa tabla salen **las dos** cosas que podrían divergir: el `WHERE` que pagina y cuenta, y el
   predicado que decide el importe. Se atan con un test de equivalencia **exhaustivo** contra
   `derivarIngresoOrden`.
3. **El cliente manda el id del MOVIMIENTO y nada más.** Ni el cierre, ni la categoría, ni la
   tienda. Todo lo demás lo resuelve el servidor leyendo esa fila. Es lo que hace que el alcance de
   `/mi-wallet` sea imposible de forzar desde fuera.

### Una corrección a la premisa de la ficha, y es importante

La ficha dice «los importes por orden ya están congelados en `cierre_detail`». **Lo congelado son
las ENTRADAS de la fórmula** —tarifa, `monto_cobrar`, `cobra_comision`, `es_central`,
`es_zona_especial`, `tienda_id`—, no los conceptos derivados; el propio docstring del modelo lo
dice y explica por qué (los conceptos dependen del `resultado` de la GESTIÓN, no de la orden).
No cambia nada del alcance ni del riesgo —la re-derivación es la MISMA función, sobre las MISMAS
entradas, y por eso la suma cuadra por construcción— pero sí cambia la frase «el detalle los LEE»:
el detalle **los vuelve a derivar con la función que ya los derivó**. Escrito para que nadie lea
«hay una columna con el importe por orden» y se sorprenda al no encontrarla.

---

## 1 — Modelo de datos: NO se toca la base

**Cero migraciones. Cero columnas. Cero valores de enum. Cero RLS nueva. Cero índices nuevos.**

Lo que se lee, y por qué basta:

| tabla | qué aporta |
| --- | --- |
| `wallet_movimiento` / `wallet_tienda_movimiento` | la fila del libro: `categoria`, `monto`, `origen_tipo`, `origen_id` (y `tienda_id` en la segunda) |
| `cierre_detail` | la ORDEN congelada: entradas de la fórmula + guía, remisión, destinatario y nombre de tienda |
| `gestion_orden` | el `resultado` y el `monto_recibido`, que son de la GESTIÓN |
| `cierre_dia` (+ `usuario`) | la fecha del cierre y el nombre del mensajero, sólo para la cabecera del panel |

Índices que ya sirven la consulta: `cierre_detail @@unique([cierreId, ordenId])` (que el propio
esquema declara «el índice de la ruta caliente: los feeds filtran por `cierre_id`») y
`gestion_orden` por cierre. La subconsulta de existencia sobre las gestiones del cierre es la misma
forma que los feeds ya ejecutan dentro de la transacción de aprobación.

---

## 2 — El corazón: una sola definición de «esta orden aporta»

### 2.1 El catálogo de fuentes (`R49`)

En un módulo PURO nuevo, `lib/utils/aporte-por-orden.ts`:

```
type FuenteDeAporte =
  | { tipo: "concepto_ordenex"; concepto: WalletIngresoConcepto }  // derivarIngresoOrden
  | { tipo: "cod_recaudado" }                                      // gestion_orden.monto_recibido
  | { tipo: "sin_reparto"; motivo: MotivoSinReparto }              // R48

FUENTE_CAJA   : Record<WalletMovimientoCategoria,       FuenteDeAporte>   // TOTAL
FUENTE_TIENDA : Record<WalletTiendaMovimientoCategoria, FuenteDeAporte>   // TOTAL
```

Los dos son `Record` **TOTALES** sobre el union de categorías: una categoría nueva en el enum
rompe el build en vez de caer en un `default` silencioso (`R49`). Es el mismo recurso con el que
`NATURALEZA_POR_CATEGORIA` clasifica el dueño del dinero.

Reparto vigente, con su motivo escrito en el propio catálogo:

- **Caja** — los seis conceptos del feed (`ingreso_flete`, `ingreso_flete_devolucion`,
  `ingreso_comision_cod`, `ingreso_iva_flete`, `ingreso_iva_flete_devolucion`,
  `ingreso_iva_comision_cod`) → `concepto_ordenex`. `egreso_pago_mensajero` e
  `ingreso_cod_recaudado` → `sin_reparto` (motivos en `requirements.md § Fuera de alcance`).
  `egreso_indemnizacion` → `sin_reparto` con el motivo «fuente disponible, fuera de esta ficha».
  Todo lo demás (`*_ajuste`, `egreso_gasto*`, `egreso_sueldo`, `egreso_pago_tienda`,
  `ingreso_reverso_pago_tienda`) → `sin_reparto`, porque no nace de un cierre.
- **Tienda** — los seis débitos → `concepto_ordenex` (vía la inversa de
  `conceptoIngresoADebitoTienda`); `cod_recaudado` → su propia fuente; `pago_tienda` y los dos
  ajustes → `sin_reparto`.

**El interruptor `TIENDA_DEBITA_FLETE_DEVOLUCION` no entra aquí, y hay que decirlo.** Ese flag
decide si el feed EMITE los dos débitos de devolución; no cambia el importe de ninguno. Si el
movimiento existe, sus aportantes son los mismos con el flag en cualquier posición. Meterlo en este
catálogo sería añadir una condición que no gobierna dinero.

### 2.2 El criterio, en una tabla de tres hechos almacenados

```
CRITERIO_DE_APORTE : Record<WalletIngresoConcepto, {
  resultados: readonly GestionResultado[];   // gestion_orden.resultado
  exigeCobraComision: boolean;               // cierre_detail.cobra_comision
  exigeTarifa: boolean;                      // cierre_detail.tarifa_id IS NOT NULL
}>
```

Los tres hechos son **columnas**, así que el criterio se puede expresar en el `WHERE` (`R21`) y a
la vez evaluar en memoria. Esa es la única razón por la que existe la tabla: sin ella habría que
elegir entre paginar en la base (con el criterio escrito a mano en SQL) o derivar todo en memoria
(con el `total` contado por la aplicación, contra `R28`).

**Y aquí está el riesgo que esta ficha existe para no cometer: el criterio pasa a vivir en dos
formas.** La contención no es la disciplina, es un test **exhaustivo**: el espacio de entrada del
criterio es finito y pequeño —5 resultados × 2 valores de `cobra_comision` × 2 de «hay tarifa» =
**20 combinaciones**, por 6 conceptos = **120 celdas**— y se comprueba entera:

```
para cada concepto, para cada una de las 20 combinaciones:
    (la combinación satisface CRITERIO_DE_APORTE[concepto])
      ===
    (derivarIngresoOrden(entradaSintética)[concepto] !== undefined)
```

Si mañana alguien cambia `derivarIngresoOrden` —como hizo la ficha 301 al sacar `devuelta` de los
conceptos de devolución— ese test se pone **rojo en el mismo commit** y obliga a mover la tabla. El
criterio no puede divergir en silencio, que es literalmente lo que `R18` pide.

### 2.3 El aporte de una orden

```
aporteDeOrden(fuente, entradasDeSusGestiones) : Prisma.Decimal | undefined
```

- `concepto_ordenex` → por cada gestión de esa orden en ese cierre, `derivarIngresoOrden(input,
  tarifaDe(fila))[concepto]`; los presentes se acumulan; si ninguno está presente, `undefined`.
- `cod_recaudado` → por cada gestión, `monto_recibido ?? 0` (exactamente lo que hace el feed, que
  llama a su acumulador para TODA gestión, con o sin recaudo).

**¿La acumulación por orden es una operación de dinero nueva?** No. Es la MISMA acumulación que
`agregarIngresosPorConcepto` ya hace, particionada por orden en vez de colapsada. Y es exacta: cada
aporte que devuelve `derivarIngresoOrden` ya viene a escala 2 (`round2`/`aplicarPorcentaje`), así
que sumar 2 decimales da 2 decimales y el `round2` final del agregado es la identidad. **No hay
deriva de redondeo, y se prueba** (`tasks.md § T2.3`), porque «se me ocurre que no la hay» no es
una medida. En el caso normal —una gestión por orden— ni siquiera hay suma: hay una copia.

Si `R20` se resolviera con una fila por gestión (`Q1`), esta acumulación desaparecería; se eligió
la fila por orden porque es lo que el humano pidió y lo que hace legible el detalle.

---

## 3 — La lectura

### 3.1 Contrato de entrada (borde)

```
verDetalleDeMovimientoSchema = z.object({
  movimientoId: z.string().uuid(),
  page:     z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1)
              .max(detalleMovimientoConfig.MAX_PAGE_SIZE)
              .default(detalleMovimientoConfig.DEFAULT_PAGE_SIZE),
}).strict()

verDetalleDeMovimientoCompletoSchema = verDetalleDeMovimientoSchema
  .omit({ page: true, pageSize: true }).strict()
```

**Dos claves y nada más** (`R42`). No hay `tiendaId`, no hay `cierreId`, no hay `categoria`, no hay
lista de conceptos. El `.strict()` mata en el borde cualquier clave colada —incluida `tiendaId`,
que es la única que convertiría el detalle de una tienda en el de otra— con `validation_error` y
sin tocar la base. Es la misma barrera que ya protege el ledger completo de la tienda.

Esto es la lección de la ficha 343 llevada un piso más abajo: allí el cliente mandaba un **token de
fila** para que no pudiera definir el complemento; aquí manda un **id de movimiento** para que no
pueda definir ni el cierre, ni el concepto, ni el dueño.

### 3.2 Contrato de salida

```
OrdenAporteDTO = {
  ordenId: string;            // rowKey; NUNCA sale en la descarga (R36)
  guia: string;               // num_guia si lo hay, si no num_remision (congelados)
  destinatario: string;
  tiendaNombre: string;       // congelado; la pantalla de la tienda no lo pinta (R14)
  resultados: GestionResultado[];   // los de SUS gestiones en ese cierre (R10/R20)
  aporte: string;             // STRING escala 2 (R44)
}

DetalleMovimientoPayload = {
  monto: string;              // el importe del movimiento, tal cual, para poder cotejar
  cierre: { fecha: string; mensajeroNombre: string | null };   // null en /mi-wallet (R15)
  ordenesDelCierre: number;   // M: cuántas órdenes tiene el cierre en el alcance del actor
  total: number;              // N: cuántas APORTAN. Lo cuenta la base (R28)
  page: number; pageSize: number;
  ordenes: OrdenAporteDTO[];
}

VerDetalleServiceResult =
  | { status: "ok"; data: DetalleMovimientoPayload }
  | { status: "sin_reparto"; motivo: MotivoSinReparto }   // R48
  | { status: "not_found" }                               // R41
  | { status: "forbidden" }                               // R38
```

`ordenesDelCierre` junto a `total` es la frase que el humano fue a buscar y no encontró: **«14 de
23»**. Son dos cardinales, no dinero.

Ninguna rama distinta de `ok` viaja con órdenes.

### 3.3 El servicio, paso a paso (y el orden es parte del requisito)

`WalletService.verDetalleDeMovimiento` (caja) y `WalletTiendaService.verDetalleDeMiMovimiento`
(tienda) hacen lo mismo con dos diferencias, y las dos importan:

1. **Guard ANTES de la base** (`R39`): `esAccesoTotal(actor.rol)` en la caja,
   `actor.rol === "adminTienda"` en la tienda. Mismo motivo escrito ya en `verResumenCaja`: un
   `forbidden` evaluado después del `SELECT` ya habría leído el dinero para tirarlo.
2. **Leer el movimiento por id.** En la caja, por `id`. En la tienda,
   `{ id, tiendaId: actor.usuarioId }` —**el `tiendaId` va en el `WHERE`**, escrito AL FINAL del
   objeto, después de cualquier spread, siguiendo la convención que este repo ya tiene escrita para
   el ledger de la tienda («aunque mañana alguien añadiera un spread encima, esta línea lo pisa»).
   Sin fila → `not_found` (`R41`). **Un movimiento de otra tienda es indistinguible de uno que no
   existe**, que es la respuesta correcta: no confirma su existencia.
3. **Resolver la fuente** con `FUENTE_CAJA` / `FUENTE_TIENDA`. Si es `sin_reparto`, o si
   `origen_tipo !== 'cierre_dia'`, o si `origen_id` es nulo → `sin_reparto` con su motivo (`R48`).
   Aquí no se ha consultado todavía ninguna orden.
4. **Cabecera del cierre**: `cierre_dia.fecha` (+ nombre del mensajero SÓLO en la caja, `R15`).
5. **Repositorio**: `contar` + `listar` con el mismo `where`, y `contarOrdenesDelCierre` para `M`.
6. **Derivar** el aporte de cada fila con `aporteDeOrden`.

El servicio no escribe ni una operación aritmética propia.

### 3.4 El repositorio — `lib/repositories/CierreAporteRepository.ts`

Raíz de la consulta: **`cierre_detail`**, porque el grano pedido es la ORDEN (`R20`) y porque su
`@@unique([cierreId, ordenId])` da a la vez el grano y el índice.

```
where = {
  cierreId,
  ...(criterio.exigeTarifa        ? { tarifaId: { not: null } } : {}),
  ...(criterio.exigeCobraComision ? { cobraComision: true }     : {}),
  orden: { gestiones: { some: { cierreId, resultado: { in: criterio.resultados } } } },
  ...(tiendaId !== undefined ? { tiendaId } : {}),   // AL FINAL: nada lo puede pisar
}
```

- La subconsulta sobre `gestiones` es un **EXISTS de SQL**, no un filtro en memoria (`R21`).
- **`{ cierreId }` y nada más dentro de `some`, deliberadamente.** El feed que produjo el importe
  consulta `gestionOrden.findMany({ where: { cierreId } })`, sin `anuladaAt: null`. Añadir aquí esa
  cláusula «por prudencia» sería un criterio que el productor no tiene: una gestión anulada después
  de aprobar el cierre seguiría dentro del importe y desaparecería del detalle, y la suma dejaría de
  cuadrar. **Se replica el `where` del feed, exactamente.**
- Para `cod_recaudado` el criterio son los **cinco** resultados y ninguna exigencia de tarifa ni de
  comisión, porque el feed acumula el recaudo de toda gestión.
- `count` con **ese mismo `where`** → `total` (`R28`). `contarOrdenesDelCierre` con
  `{ cierreId, ...(tiendaId ? { tiendaId } : {}) }` → `M` (`R12`), y lleva el mismo acotamiento por
  tienda: si no, `/mi-wallet` diría «14 de 23» contando órdenes ajenas.
- `orderBy: [{ numGuia: asc, nulls: last }, { id: asc }]` — orden **TOTAL** (`R30`): `id` es único,
  así que dos filas nunca empatan y paginar no repite ni omite. Se ordena por guía y no por aporte
  porque el aporte es derivado y no existe como columna.
- `select`: las entradas congeladas de la fórmula (la misma proyección que ya comparten los dos
  feeds) + `ordenId`, `numGuia`, `numRemision`, `destinatario`, `tiendaNombre`, y las gestiones de
  ESE cierre (`orden.gestiones` con `where: { cierreId }`, seleccionando `resultado` y
  `montoRecibido`).

Sin índice nuevo: es `cierre_detail` filtrado por `cierre_id` (+ `tienda_id`), que es la ruta que la
tabla ya declara caliente.

### 3.5 Server Actions

`verDetalleDeMovimientoAction` y `verDetalleDeMovimientoCompletoAction` en `lib/actions/wallet.ts`;
`verDetalleDeMiMovimientoAction` y su gemela completa en `lib/actions/wallet-tienda.ts`. Calcadas
de las que ya existen: resolver actor, `UnauthenticatedError` sin sesión, validar con el schema
(ZodError → `validation_error`), delegar, `withErrorHandler`. Lectura interna → Server Action, no
ruta API.

### 3.6 Configuración — `lib/config/detalle-movimiento.ts`

Molde exacto de `lib/config/composicion-detalle.ts` (`readPositiveInt` + `load…Config()` +
instancia):

| clave | variable de entorno | valor por defecto |
| --- | --- | --- |
| `DEFAULT_PAGE_SIZE` | `DETALLE_MOVIMIENTO_DEFAULT_PAGE_SIZE` | `25` |
| `MAX_PAGE_SIZE` | `DETALLE_MOVIMIENTO_MAX_PAGE_SIZE` | `100` |

**25 y no 10** (el de la ficha 343): aquel panel vivía dentro de una columna que ocupa media
tarjeta; éste se despliega bajo una fila de una tabla a ancho completo, y 25 es el tamaño que ya
usan los listados de página entera de este repo. Un cierre de 23 órdenes cabe en una página, que es
justo el caso que el humano quiere poder revisar de una vez.

**NO se registra** en el censo de dominios de paginación: ese archivo es el censo de los 13 listados
del Anexo III de la ficha 170, con una afirmación de longitud que significa exactamente eso. Este
desplegable no es uno de ellos. Lleva su propio test de configuración con las mismas cuatro
comprobaciones (defecto, tope, `defecto ≤ tope`, override de entorno y basura → defecto).

---

## 4 — La descarga (contrato, `R31`–`R37`)

Familia A del rollout de descargas: **lectura DEDICADA con el tope en el servidor** y
`filasDesdeResultado` en la pantalla. Nunca el adaptador de relectura, que ya no existe.

- El servicio completo pide `page: 1, pageSize: descargaConfig.MAX_FILAS + 1` al mismo repositorio
  y devuelve `ListarCompletoServiceResult<OrdenAporteDTO>`: `limite_excedido` lleva SÓLO conteos y
  ninguna rama de error viaja con filas (`R34`).
- Dos módulos de columnas, uno por wallet, con el sufijo `-descarga-columnas.ts` que el barrido de
  columnas sensibles descubre por convención:

```
COLUMNAS_DESCARGA_DETALLE_MOVIMIENTO      (caja)   : guia · destinatario · tienda · resultado · aporte
COLUMNAS_DESCARGA_DETALLE_MI_MOVIMIENTO   (tienda) : guia · destinatario · resultado · aporte
```

- **El `toEqual` que enumera esas claves y esos encabezados se escribe a mano y se actualiza a
  mano** (`R35`). No se compara la lista contra la propia constante: eso sería una aserción contra
  su propia fuente, siempre verde, y en este repo ya está escrito por qué la del libro de caja se
  quedó como literal mientras otra hubo que desmontarla.
- **Nada de identificadores** (`R36`): no sale `ordenId`, no sale `movimientoId`, no sale el id del
  cierre. La guardia de columnas sensibles además ejecuta la proyección con una sonda y falla si un
  valor tiene forma de uuid.
- `aporte` viaja como el STRING del servidor, sin `money` y sin reformatear (`R37`): el símbolo de
  colón convertiría una celda numérica en texto que la hoja de cálculo no puede sumar.
- `resultado` sale como su ETIQUETA legible, igual que la pantalla.

---

## 5 — La pantalla

### 5.1 Dónde se engancha

`WalletLedger` (`/wallet`) y `DesgloseTiendaLedger` (`/mi-wallet`) reciben `renderExpanded` y
`expandAriaLabel` de la primitiva `DataTable`, que **sólo monta el contenido de la fila abierta**.
De ahí salen tres requisitos de golpe: el libro cerrado cuesta **cero** lecturas (`R2`), abrir una
fila cuesta **una** (`R3`), y cada panel abierto lleva su propia clave SWR y su propia página
(`R4`). Es el mismo patrón —vivo y probado— del desglose de una tienda y del de un mensajero.

`renderExpanded` devuelve `null` cuando el origen del movimiento no es un cierre, y así la
primitiva **no pinta el botón** sobre esa fila (`R6`): la columna «Origen» ya dice de dónde sale un
ajuste manual o un gasto. Para un movimiento de cierre cuyo concepto no se reparte, el panel **sí
se abre** y dice de dónde sale el importe (`R48`) — el hueco de alcance se ve, no se esconde.

### 5.2 Componentes

| archivo | qué es |
| --- | --- |
| `app/(app)/wallet/_components/DetalleMovimientoCierre.tsx` | el panel de la caja: SWR + `DataTable` + `Pagination` + descarga |
| `app/(app)/wallet/_components/detalle-movimiento-labels.ts` | textos y nombres accesibles del panel de la caja |
| `app/(app)/wallet/_components/detalle-movimiento-descarga-columnas.ts` | columnas del archivo de la caja |
| `app/(app)/mi-wallet/_components/DetalleMiMovimientoCierre.tsx` | el panel de la tienda |
| `app/(app)/mi-wallet/_components/detalle-mi-movimiento-labels.ts` | sus textos |
| `app/(app)/mi-wallet/_components/detalle-mi-movimiento-descarga-columnas.ts` | columnas de su archivo |
| `lib/utils/aporte-por-orden.ts` | PURO: catálogo de fuentes, criterio y derivación del aporte |
| `lib/repositories/CierreAporteRepository.ts` | la consulta acotada y su `count` |
| `lib/config/detalle-movimiento.ts` | tamaño de página y tope |

**Dos componentes y no uno compartido.** Difieren en las columnas (la tienda no pinta la columna
«Tienda»), en la Server Action que leen, en los textos y en las columnas del archivo; lo único
sustancial que comparten —el criterio, la consulta y la derivación— **sí** vive en un solo sitio, en
el servidor, que es donde divergir cuesta dinero. Es además el reparto que estas dos pantallas ya
tienen para el libro mismo, que son dos componentes desde el principio. La alternativa está
descartada con más detalle en `§ 11-A5`.

### 5.3 Las columnas del panel

Escritorio, caja: **Guía · Destinatario · Tienda · Resultado · Aporte**.
Escritorio, tienda: **Guía · Destinatario · Resultado · Aporte**.

- **Guía** es el número visible congelado (`num_guia`, o `num_remision` cuando no hay guía) y lleva
  el enlace a `/ordenes` (`R11`).
- **Resultado** es la columna que explica el «14 de 23»: sin ella, quien mire el detalle no entiende
  por qué faltan nueve órdenes que sí estaban en el cierre.
- **Aporte** alineado a la derecha, `tabular-nums`, el STRING pintado tal cual con el formateador de
  moneda. **Sin fila de subtotal** (`R47`): la página no es el conjunto, y un subtotal de página al
  lado del importe del movimiento es una invitación a restarlos.

### 5.4 El móvil, que es donde se rompió la última vez

La ficha 343 lo midió en Chromium: a 390 px una tabla de cuatro columnas dejaba el importe fuera
del área visible y se leía **«₡1.70» donde el DOM decía «₡1.700»**. Dinero cortado no se ve roto,
se ve como OTRO número, y en jsdom no hay ancho de pantalla, así que **ninguna prueba en memoria
puede verlo**. Aquí las columnas son cinco, no cuatro: el problema es peor por construcción.

Se aplica la solución que allí quedó medida y funcionando:

- por debajo de 768 px (`useIsMobile`, el mismo corte del Sidebar) se pintan **DOS** columnas: una
  celda de texto APILADA (guía enlazada · destinatario · tienda · resultado) con `wrap-anywhere`, y
  el **Aporte** con su columna propia a la derecha;
- la celda del importe lleva `whitespace-nowrap` y `tabular-nums`, y tiene **prohibido** `truncate`,
  `line-clamp`, `overflow-hidden` y cualquier abreviatura (`R51`), que es la misma prohibición ya
  escrita en la factura del cierre;
- no se oculta ni un dato: es la misma información en dos columnas en vez de cinco (`R52`).

**Y se verifica en un navegador de verdad, a 390 y a 1440**, leyendo el TEXTO de las celdas de
dinero y midiendo `scrollWidth - clientWidth` del contenedor de scroll de la tabla. Es un paso de
`tasks.md`, no una recomendación: es lo único que puede ver este fallo.

Deuda heredada, declarada y no tapada: entre 768 y 1279 px el panel de la ficha 343 sigue recortando
su importe, porque el corte por viewport no es el instrumento (a 1024 el panel mide casi lo mismo
que en el teléfono). Este panel vive a ancho completo, así que no debería sufrirlo — **y por eso se
mide también a 1024 antes de afirmarlo**.

---

## 6 — Cómo se prueba que el `WHERE` acota (y por qué no vale un doble)

En este repo está medido **cuatro veces** que una mutación del `WHERE` pasa en verde por delante de
un doble. Las afirmaciones de alcance y de cuadre se miden contra **Postgres real**, con el molde de
los tests de integración de base que ya existen: cliente de test + transacción revertida (todo se
revierte, pase, falle o muera el runner), `describe.skip` si no hay base alcanzable, y **ni un
`return` mudo** — si falta un dato previo, el test FALLA con su motivo.

Lo que se siembra dentro de la transacción y lo que se afirma:

1. **El cuadre, que es el requisito que la ficha existe para garantizar.** Un cierre con órdenes
   `entregada`, `rechazada`, `devuelta`, `reprogramada` e `incidente`, con importes distintos.
   Σ(aportes de TODAS las páginas del detalle de `ingreso_flete`) === el `monto` del movimiento.
2. **El «14 de 23».** `total` cuenta sólo las entregadas; `ordenesDelCierre` cuenta todas.
   **Mutación exigida**: quitar la restricción de `resultado` del `WHERE` mete las demás, `total`
   pasa a 23 y la suma deja de cuadrar. El test cae nombrando los importes intrusos.
3. **El total lo cuenta la base.** Se siembran `pageSize + 3` órdenes que aportan:
   `total === pageSize + 3` y `ordenes.length === pageSize`. Un `total = ordenes.length` cae aquí.
4. **El alcance de la tienda.** DOS tiendas en el MISMO cierre. El detalle del movimiento de la
   tienda A no devuelve **ni una** orden de la B, y Σ === el monto de A. **Mutación exigida**:
   quitar `tiendaId` del `where` de `cierre_detail` mete las de B y el caso cae.
5. **El movimiento ajeno.** La tienda A pide el detalle de un movimiento de la B → `not_found`, sin
   filas. **Mutación exigida**: quitar `tiendaId` del `where` de la lectura del movimiento y el caso
   cae con datos ajenos servidos.
6. **Dos gestiones de la misma orden en el mismo cierre** → UNA fila, aporte sumado, Σ intacta.
7. **La orden sin tarifa congelada** (el gap conocido) no aparece y no altera la suma.
8. **`cod_recaudado`**: Σ === el crédito de esa tienda en ese cierre.
9. **El orden es total**: recorrer todas las páginas devuelve cada orden exactamente una vez.

---

## 7 — Censos y guardias ajenas que esta ficha mueve

**Los números de abajo son los que este spec LEYÓ en el árbol el 2026-08-31. Se vuelven a medir
antes de tocarlos** (`tasks.md § T0.2`), y la guardia se deja fallar primero, que es la convención
escrita en ese propio archivo.

1. **Censo de tablas** (`tests/unit/descarga/censo-tablas.ts` y su guardia). Hoy: 29 archivos con
   `<DataTable>`, 29 instancias, 30 censadas = 19 `con_descarga` + 11 `fuera`. Esta ficha añade
   **dos** instancias en **dos** archivos nuevos, y las dos nacen `con_descarga`: 29→31 archivos,
   29→31 instancias, 30→32 censadas, 19→21 `con_descarga`, `fuera` sin cambio.
   **Diferencia con la ficha 343, y es la que justifica el estado**: aquel panel nació `fuera`
   porque era un recorte del mismo libro que ya se descarga entero con sus filtros. Éste enseña algo
   que **ninguna otra descarga produce** —el reparto de un importe entre las órdenes que lo
   componen—, así que no es un segundo archivo del mismo hecho.
2. **Guardia de aserciones de orden de columnas.** Las dos constantes nuevas obligan a escribir sus
   dos aserciones de orden que las NOMBREN. Su censo mínimo no hay que tocarlo (es un suelo, no una
   igualdad), pero se anota que sube.
3. **Censo transversal de paginación.** El detalle **no** es un listado del Anexo III. Regla para
   quien implemente: **el nombre accesible de la paginación NO se declara como
   `export const PAGINACION_*_LABEL`.** Ese prefijo es el ancla de un censo ajeno que exige una
   igualdad exacta, y bautizarla así lo pondría rojo por un motivo falso. Va como propiedad del
   módulo de textos, componiendo el nombre de SU fila, que además es lo que `R5` pide.
4. **Guardia del adaptador de conjunto.** La descarga usa `filasDesdeResultado`; el adaptador de
   relectura ya no existe y no se resucita.
5. **Guardia de columnas sensibles.** Descubre los módulos por convención de nombre: no hay que
   registrarlos, sólo pasar (sin ids, sin uuid en los valores).
6. **Guardia de superficie de uso.** Las cuatro Server Actions nuevas nacen con consumidor montado
   en el mismo commit; una acción sin quien la llame la pone roja.

---

## 8 — El enlace a la orden

`/ordenes?<param>=<guía>`, con el `<param>` **importado** del defecto que el buscador lee de la URL,
nunca escrito a mano: es lo que hizo la ficha 341 y su motivo sigue vigente (escribirlo a mano deja
un enlace muerto el día que el defecto cambie). `<Link>` y no `router.push`: es una navegación, así
que se abre en pestaña nueva, se copia con el botón derecho y funciona sin JS.

- **Alcance**: `/ordenes` es visible para `maestro`, `admin` y `adminTienda`, así que el enlace
  funciona en las dos pantallas y no lleva a una puerta cerrada. El acotamiento de lo que ve una
  tienda en `/ordenes` lo pone esa pantalla, no este enlace.
- **Caso borde conocido, heredado**: el buscador exige un mínimo de caracteres, así que una guía de
  uno o dos dígitos llega sin filtrar y la barra lo dice en pantalla. No falla en silencio (`Q4`).
- El nombre accesible del enlace dice a dónde va y con qué, no «ver».

---

## 9 — La etiqueta del resultado de la gestión

Ya existe un `Record<GestionResultado, string>` en los textos del detalle de cierres del admin. Se
**reutiliza**; y si alguna guardia prohíbe el import cruzado entre carpetas `_components`, se
promueve a un módulo compartido y se repuntan los dos consumidores **en el mismo commit** —que es
justo el criterio de `docs/architecture.md`: a `shared/` se sube cuando lo necesitan dos features—.
Lo que NO se hace es declarar una segunda copia de las etiquetas: dos catálogos del mismo enum
acaban diciendo cosas distintas de la misma gestión.

---

## 10 — Money-safe, punto por punto

- Los importes cruzan como **STRING** escala 2 y se pintan tal cual (`R44`).
- Ni `Number(`, ni `parseFloat(`, ni `parseInt(`, ni `.toFixed(` en las fuentes de pantalla nuevas
  (`R45`). Se barre el CÓDIGO sin comentarios, con el barrido que el repo ya tiene, para que citar
  la prohibición en un docstring no ponga el test rojo.
- Toda la aritmética del servidor es `Prisma.Decimal`, y es la que ya existía.
- Ningún subtotal de página (`R47`), ninguna resta nueva, ningún signo inventado: el aporte es
  siempre positivo, como el `monto` del movimiento, y la dirección la dice el `tipo` de la fila.

---

## 11 — Alternativas descartadas

**A1 — Derivar TODO el cierre en memoria y paginar el array resultante.** Es la opción que hace
imposible por construcción que el criterio diverja: se cargan las órdenes del cierre, se deriva con
`derivarIngresoOrden`, se filtra por «concepto definido» y se corta la página. **Descartada**, y
duele: el `total` lo contaría la aplicación y no la base (contra `R28`), y el recorte lo haría la
memoria y no el `WHERE` (contra `R21`), que son dos reglas que este repo se dio después de que le
mordieran. La contención elegida —la tabla de criterio + el test de equivalencia exhaustivo de 120
celdas— consigue la misma garantía sin renunciar a ninguna de las dos. Si esa equivalencia alguna
vez dejara de ser expresable (un criterio que dependiera de algo que no es columna), **esta
alternativa es la salida correcta** y hay que volver aquí.

**A2 — Que el cliente mande `cierreId` + `categoria` en vez del id del movimiento.** Descartada por
la misma razón por la que la ficha 343 mandó un token de fila: dejaría que el navegador declarara de
qué cierre y de qué concepto habla, y en `/mi-wallet` habría que confiar en que además no mienta
sobre la tienda. Con el id del movimiento, el alcance sale de una fila que el servidor lee acotada,
y no hay nada que validar en el cliente.

**A3 — Una fila por GESTIÓN en vez de por orden.** Evitaría la única acumulación del diseño (`§2.3`)
y haría el cuadre trivialmente exacto término a término. Descartada porque el humano pidió
literalmente «cuánto aporta cada ORDEN», y porque una orden repetida dos veces en la tabla se lee
como un error de la pantalla antes que como un dato. Queda como `Q1`: es un cambio de raíz de
consulta, no un rediseño.

**A4 — Repartir también `egreso_pago_mensajero` e `ingreso_cod_recaudado` de la caja.** Son los dos
importes grandes que quedan cerrados, así que la tentación es real. Descartada: sus productores no
acumulan por orden —uno lee el snapshot `total_pago_mensajero` del cierre y el otro suma los
créditos del libro por tienda—, así que atribuirlos por orden exigiría **afirmar una invariante
entre dos snapshots que esta ficha no ha medido**. Este repo ya tiene escrito lo que cuesta eso: una
invariante que se sostenía leyendo el código y que Postgres desmintió. Se resuelven por `R48`
diciendo de dónde salen, y el catálogo de `§2.1` deja el sitio preparado.

**A5 — Un solo componente de panel compartido en `components/shared/`.** Descartada: para servir a
las dos pantallas tendría que recibir por props el fetcher, los dos juegos de columnas, las columnas
del archivo y los textos, o sea convertirse en un envoltorio de `DataTable` que no comparte nada
sustancial. Además entraría en la maquinaria de «tabla compartida» del censo, que obliga a declarar
todas las pantallas que la montan. Lo que de verdad no puede divergir —criterio, consulta y
derivación— ya está compartido, en el servidor.

**A6 — Abrir el detalle en un modal o en una hoja lateral.** Descartada: «al pulsarla debe abrirse
el detalle» es literalmente lo que se pidió, y el desplegable en línea deja el importe de la fila a
la vista junto a las órdenes que lo componen — que es la comparación que el usuario quiere hacer.
Un modal obligaría a repetir en su cabecera el importe y el contexto para no perderlo.

**A7 — Añadir a `cierre_detail` una columna por concepto con el aporte ya calculado.** Descartada:
es una migración sobre una tabla de dinero INMUTABLE, sin backfill posible para el histórico (los
conceptos dependen del `resultado` de la gestión, no de la orden, y por eso el diseño de la 69
decidió congelar entradas y no salidas). Además congelaría una segunda copia del importe que podría
discrepar de la fórmula. La ficha dice explícitamente que no hay que añadir columna, y tiene razón.

---

## 12 — Riesgos y cómo se contienen

| riesgo | contención |
| --- | --- |
| El detalle enseña las 23 órdenes y la suma no cuadra | El criterio sale de una tabla única, atada a `derivarIngresoOrden` por un test exhaustivo de 120 celdas, y el cuadre se afirma contra Postgres con su mutación |
| El criterio SQL y el criterio en memoria divergen con el tiempo | Ese mismo test de equivalencia se pone rojo en el commit que cambie la fórmula; es lo que habría pasado con la ficha 301 |
| Una tienda ve órdenes de otra | `tiendaId` en el `WHERE` de las DOS lecturas (el movimiento y las órdenes), escrito al final; `.strict()` en el borde; y dos casos contra Postgres con sus mutaciones |
| El importe recortado a 390 px | Dos columnas en móvil, prohibición explícita de truncar, y verificación en navegador real leyendo el texto de las celdas |
| El `total` sale de `items.length` | Lo cuenta la base con el mismo `where`; caso sembrado con `pageSize + 3` |
| Deriva de redondeo al sumar los aportes de una orden | Cada aporte ya viene a escala 2; se prueba que la partición por orden da exactamente el agregado |
| Guardias ajenas rojas por motivos falsos | Seis identificadas y resueltas por escrito en `§ 7`, con sus números medidos antes de tocarlos |
| La premisa de producción no se sostiene | `T0.1` la re-mide en solo-lectura antes de escribir código; si falla, se para |
