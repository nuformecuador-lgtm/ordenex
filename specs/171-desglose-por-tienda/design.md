# Feature 171 — Desglose del dinero por tienda en la wallet · design

> Decisiones técnicas antes de escribir código. Todo lo que aquí se afirma del estado actual
> está verificado contra el árbol (rutas y líneas concretas), no recordado.

---

## 1. Punto de partida

### 1.1 Lo que hay en mensajeros (el modelo a espejar donde tenga sentido)

```
CuentasPorPagarTable.tsx           (tabla, datos por props del Server Component)
  └─ renderExpanded  ─────────────► DesglosePagosMensajero.tsx   ← se MONTA al expandir
                                      └─ useSWR → listarPagosDeMensajeroAction (Server Action)
                                           └─ WalletMensajeroService.listarPagosDeMensajero
                                                └─ PagoMensajeroMovimientoRepository
```

Dos detalles que importan y que sí se copian:

1. **El desglose no llega por props.** `DataTable` invoca `renderExpanded(row)` en cada
   render, pero eso solo **crea** el elemento; solo lo **monta** cuando la fila está abierta
   (`DataTable.tsx:415`). Como el `useSWR` vive dentro del componente desplegado, una fila
   cerrada no consulta nada. Es lo que hace que N filas cuesten 0 consultas.
2. **La cabecera de importes refleja el conjunto filtrado**, no el agregado: sale de
   `result.data.cuenta` y solo antes de la primera carga usa el resumen que llegó por props
   (`DesglosePagosMensajero.tsx:180`).

### 1.2 Lo que hay en tiendas

- `/wallet/tiendas` (`page.tsx`): Server Component, gate `esAccesoTotal`, pre-fetch de
  `listarSaldosTiendasAction`, y una sola tabla (`SaldosTiendasTable`) con su descarga de la
  170. **No hay desplegable.**
- El ledger por tienda ya tiene lectura paginada con filtros y agregado de saldo… **acotada al
  actor**: `WalletTiendaService.listarMisMovimientos` exige `actor.rol === "adminTienda"` y
  escribe `tiendaId: actor.usuarioId` al final del objeto que va al repositorio. Es la
  superficie de `/mi-wallet`, y por diseño no sirve para «ver el detalle de la tienda X».
- `IWalletTiendaFeedService` **no** es un feed de lectura: construye las filas a insertar al
  aprobar un cierre. No se toca en esta feature.

### 1.3 Lo que la 170 dejó puesto y hay que respetar

- `censo-tablas.ts` + `cobertura-tablas.guardia.test.ts`: toda instancia de `<DataTable>` del
  árbol tiene que estar registrada, con estado real == estado declarado, y con **totales
  duros** (`25` archivos / `30` instancias / `25 con_descarga` / `31` censadas).
- `columnas-sensibles.guardia.test.ts`: descubre por convención `*-descarga-columnas.ts`,
  ejecuta cada función exportada con una sonda-proxy y falla si la fila emite un uuid, una
  URL, una ruta de almacenamiento o un identificador interno.
- `components/shared/descarga-resultado.ts` (`filasDesdeResultado`, `filasLocales`,
  `mensajeLimite`) y `lib/types/descarga-listado.ts` (`ListarCompletoResult` /
  `ListarCompletoServiceResult`) son los contratos de descarga ya compartidos.

---

## 2. Qué se muestra, exactamente, y por qué no es lo mismo que en mensajeros

El dinero de un mensajero y el de una tienda no son la misma cosa:

| | Mensajero | Tienda |
| --- | --- | --- |
| Naturaleza | Ordenex le **debe por trabajar** | Ordenex le **debe el COD** y le **cobra los servicios** |
| Categorías vivas | 2 (`pago_devengado`, `pago_efectivo`) | 7 (1 crédito + 6 débitos) + pagos + ajustes |
| Cabecera actual | devengado / pagado / cuenta por pagar | *no existe* |

### 2.1 Cabecera: cuatro importes (R7–R14)

| # | Importe | Contenido | Por qué en ese sitio |
| --- | --- | --- | --- |
| 1 | **A favor de la tienda** | Σ créditos: `cod_recaudado`, `ajuste_credito` | Es el origen del dinero: lo que se recaudó a su nombre |
| 2 | **Cargos de Ordenex** | Σ débitos ≠ `pago_tienda`: `flete`, `flete_devolucion`, `comision_cod`, los tres IVA, `ajuste_debito` | Lo que se le cobra por el servicio; se resta de lo anterior |
| 3 | **Pagado a la tienda** | Σ débitos con categoría `pago_tienda` | Lo ya entregado. Hoy **siempre 0.00** (nadie lo emite) |
| 4 | **Saldo** | `1 − 2 − 3`, con badge de signo | Cierra la aritmética de izquierda a derecha |

El orden **es** la fórmula leída de izquierda a derecha. Y la separación 2/3 es la decisión
central de la feature: si «pagado» se sumara a «cargos» —que es lo que pasaría copiando a
ciegas la partición crédito/débito de `SaldoTiendaCard`—, el día que la 172 emita
`pago_tienda` nadie podría distinguir *lo que te cobré* de *lo que ya te pagué* mirando esta
pantalla. Se paga ahora (una cifra que hoy vale cero) para no rehacerla después.

**Clasificación exhaustiva y a prueba de olvidos (R9).** La cubeta se declara en un
`Record<WalletTiendaMovimientoCategoria, "aFavor" | "cargos" | "pagado">`: un valor nuevo del
enum rompe el `typecheck`, y un test recorre `WALLET_TIENDA_MOVIMIENTO_CATEGORIA_SEED`
comprobando que cada categoría tiene cubeta y que su cubeta concuerda con el `tipo` con el que
el sistema la emite (`WALLET_TIENDA_DEBITO_CATEGORIA_SEED` + las dos de crédito). Es el mismo
recurso que ya usan los `satisfies` / `_Ensure*Exhaustive` de `lib/types/wallet-tienda.ts`.

**Límite aceptado y declarado:** la base no tiene un `CHECK` que ate categoría↔tipo. Una fila
con `categoria = cod_recaudado` y `tipo = debito` haría diferir esta derivación de
`derivarSaldoTienda`. No se inventa aquí esa restricción (sería una migración fuera del pedido
y sobre una tabla append-only con datos en producción): el ledger solo lo escribe el feed del
cierre, y el test de R11 compara ambas derivaciones sobre el mismo conjunto para que la
divergencia, si algún día apareciera, salga por ahí.

### 2.2 Lista de movimientos: cinco columnas (R15–R21)

`fecha · tipo · concepto · monto · origen`, más reciente primero. **Idéntico** a
`DesgloseTiendaLedger` de `/mi-wallet`: es el mismo ledger y el mismo DTO; inventar otro juego
de columnas para la misma tabla sería divergencia gratuita. Las etiquetas de `tipo`,
`concepto` y `origen` se leen del **mismo módulo** que usa `/mi-wallet`
(`mi-wallet-labels.ts`), no se recrean (R20).

### 2.3 Filtros: cierre + **concepto** + rango de fechas (R18)

Aquí sí se diverge del desglose del mensajero, que solo filtra por cierre y fecha: el ledger
del mensajero tiene 2 categorías vivas y el de la tienda tiene 7, y la pregunta natural del
maestro («¿cuánto le cobré de IVA de la comisión este mes?») no se puede responder sin filtrar
por concepto. El filtro por concepto ya existe en `/mi-wallet` (`MiWalletFiltros` +
`CATEGORIA_TIENDA_OPTIONS`, poblado desde el SEED, lo que da R44 gratis) y el schema del borde
ya admite `categoria`.

---

## 3. Modelo de datos: **sin migración** (R48/R49)

No hay tabla nueva, ni columna, ni índice, ni enum. Por tanto **no hay `migration.sql` ni
`down.sql`** en esta feature. Lo que se usa ya existe:

- `wallet_tienda_movimiento`, append-only, **RLS habilitada** (sin policies, patrón «solo
  service role» de la 42/43): `migration.sql:74`.
- `@@index([tiendaId, fechaMovimiento])` → sirve al listado paginado (`ORDER BY
  fecha_movimiento DESC` acotado por tienda) y al `groupBy` por tienda.
- `@@index([tiendaId, categoria])` → sirve al filtro por concepto.
- `@@index([origenTipo, origenId])` → sirve al filtro por cierre.

Son los mismos índices que `/mi-wallet` viene usando desde la 43; el desglose por tienda es la
misma consulta con otro `tienda_id`.

**Por qué no se pide una prueba de plan (`EXPLAIN`) como requisito:** con las decenas de filas
que hay hoy el planificador elige *seq scan* aunque el índice sea el correcto, así que el test
sería un falso negativo o exigiría sembrar decenas de miles de filas (lo que la 169 sí hizo,
pero allí el índice era nuevo y el riesgo era la escritura). Aquí no se estrena índice. El
requisito de rendimiento se ancla donde sí es determinista: en el **número de consultas** (R34).

---

## 4. Contrato de lectura

### 4.1 Tipos y schemas (`lib/types/wallet-tienda.ts`)

```ts
// Cabecera del desglose: tres cubetas + el saldo derivado de ellas. Montos STRING (R23).
export type DesgloseTiendaDTO = {
  aFavor: string;   // Σ créditos
  cargos: string;   // Σ débitos ≠ pago_tienda
  pagado: string;   // Σ débitos = pago_tienda  (hoy siempre "0.00")
  saldo: string;    // aFavor − cargos − pagado (puede venir "-123.45")
  signo: SaldoTiendaSigno;
};

export type ListarMovimientosDeTiendaResult = {
  tiendaId: string;
  movimientos: WalletTiendaMovimientoDTO[];
  total: number;
  page: number;
  pageSize: number;
  desglose: DesgloseTiendaDTO;   // del CONJUNTO FILTRADO (R12)
};

// Deriva del schema del listado propio: hereda page/pageSize/cierreId/categoria/desde/hasta
// y hace `tiendaId` REQUERIDO (espejo exacto de `listarPagosDeMensajeroSchema`).
export const listarMovimientosDeTiendaSchema = listarMovimientosTiendaSchema.extend({
  tiendaId: z.string().min(1),
});

// Modo descarga: los MISMOS filtros, sin paginación, `.strict()`.
export const listarMovimientosDeTiendaCompletoSchema =
  listarMovimientosDeTiendaSchema.omit({ page: true, pageSize: true }).strict();

export type ListarMovimientosDeTiendaCompletoResult =
  ListarCompletoResult<WalletTiendaMovimientoDTO>;
```

**No lleva `tiendaNombre`.** El nombre ya está en la fila desde la que se despliega
(`SaldoTiendaResumenDTO.tiendaNombre`) y baja por props. Devolverlo obligaría a una consulta
más por apertura — exactamente la que el desglose del mensajero paga de más hoy
(`obtenerNombreMensajero`, `WalletMensajeroService.ts:183`) para un dato que su componente
**ni siquiera usa**: lee `resumen.mensajeroNombre` de las props
(`DesglosePagosMensajero.tsx:160`). Aquí no se copia ese defecto (R35).

### 4.2 Repositorio (`IWalletTiendaMovimientoRepository`)

Se **añade** un método; no se toca ninguno existente:

```ts
/** Σ monto agrupado por (tipo, categoría) para UNA tienda + filtros. Salida STRING. */
agregarDesglosePorTienda(
  tiendaId: string,
  filtros: SaldoTiendaFiltros,
): Promise<DesgloseTiendaAgregadoRow[]>;   // { tipo, categoria, total }[]
```

Un solo `groupBy(["tipo","categoria"])` con el mismo `where` que ya construye
`buildFiltrosWhere` + el `tiendaId`. El repositorio no clasifica ni resta: devuelve totales.

### 4.3 Derivación pura (`lib/utils/desglose-tienda.ts`)

```ts
export const CUBETA_POR_CATEGORIA: Record<WalletTiendaMovimientoCategoria, CubetaDesglose>;
export function derivarDesgloseTienda(rows: DesgloseTiendaAgregadoRow[]): DesgloseTiendaDTO;
```

Función pura, `Prisma.Decimal` de punta a punta, salida STRING escala 2 y signo calculado en
el servidor — espejo estructural de `lib/utils/saldo-tienda.ts`, que se deja intacto.

### 4.4 Servicio (`WalletTiendaService`)

```ts
listarMovimientosDeTienda(input, actor): Promise<ListarMovimientosDeTiendaServiceResult>;
listarMovimientosDeTiendaCompleto(input, actor): Promise<ListarCompletoServiceResult<…>>;
```

- Guard `esAccesoTotal(actor.rol)` → si no, `{ status: "forbidden" }` **antes** de tocar el
  repositorio (R26/R27/R28). Es el mismo gate que `listarSaldosTiendas`, y el mismo criterio
  que separa `listarPagosDeMensajero` (acceso total) de `listarMisPagos` (el propio mensajero).
- Reutiliza el `construirFiltros` privado que la 170 ya extrajo, y escribe
  `tiendaId: input.tiendaId` **al final** del objeto que va al repositorio, después de esparcir
  los filtros (R24). Tres cierres independientes de la misma fuga: `.strict()` en el borde,
  `construirFiltros` leyendo claves explícitas, y el `tiendaId` escrito al final.
- Dos llamadas al repositorio en `Promise.all`: `listarPorTienda` (página + total) y
  `agregarDesglosePorTienda` (cabecera). **Ninguna** para el nombre (R35).
- El modo completo aplica el tope `descargaConfig.MAX_FILAS` con `pageSize: limite + 1` y
  devuelve `limite_excedido` **sin filas**; no recalcula la cabecera (no es columna del
  archivo), igual que hizo la 170 en los otros cuatro ledgers.

### 4.5 Borde (`lib/actions/wallet-tienda.ts`)

```ts
listarMovimientosDeTiendaAction(input, deps?)          // paginado + cabecera
listarMovimientosDeTiendaCompletoAction(input, deps?)  // dataset completo (descarga)
```

Server Actions, no Route Handlers: es una lectura interna del mismo proyecto
(`docs/architecture.md`). Mismo esqueleto que las cuatro que ya viven en ese archivo:
`resolveActorFromSession` → `UnauthenticatedError` si no hay sesión (R29, antes del service) →
`schema.parse` (R25, ZodError → `validation_error`) → service bajo `withErrorHandler`.

### 4.6 Recorrido completo

```
SaldosTiendasTable  (props, sin cambios de datos)
  └─ renderExpanded ─► DesgloseMovimientosTienda   ← se monta SOLO al expandir
        useSWR(["wallet-tiendas:desglose", tiendaId, page, filtros])
          └─ listarMovimientosDeTiendaAction
               └─ WalletTiendaService.listarMovimientosDeTienda   (guard acceso total)
                    ├─ repo.listarPorTienda(...)            → findMany + count
                    └─ repo.agregarDesglosePorTienda(...)   → groupBy(tipo, categoria)
```

---

## 5. Alcance por rol, explícito

| Rol | Tabla de saldos `/wallet/tiendas` | Desglose de una tienda (nuevo) | Su propio detalle `/mi-wallet` |
| --- | --- | --- | --- |
| `maestro` | sí | **sí** | n/a |
| `admin` | sí | **sí** | n/a |
| `adminTienda` | no (`notFound`) | **no** (`forbidden`, incluso pidiendo su propia tienda) | sí, acotado a su `tienda_id` |
| `adminSatelite` | no | **no** | n/a |
| `mensajero` | no | **no** | n/a |
| sin sesión | no | **no** (`unauthenticated`) | no |

**Por qué la tienda NO entra por esta puerta (R28).** Precedente exacto del módulo: el
mensajero tampoco puede usar `listarPagosDeMensajero`; su superficie es `listarMisPagos`, que
**ignora** el `mensajeroId` del input y acota por el actor
(`WalletMensajeroService.ts:206-211`). Aquí la simetría es total: la tienda ya tiene su
desglose completo en `/mi-wallet` vía `listarMisMovimientos`, y esa lectura acota por
`actor.usuarioId`. Meter a `adminTienda` en la lectura nueva convertiría un contrato cuyo
alcance lo fija el **rol** en uno cuyo alcance lo fija un **dato de la petición**, con una
comparación `input.tiendaId === actor.usuarioId` como única barrera entre una tienda y el
ledger de su competencia. Se rechaza (ver §8, alternativa A).

Contraprueba obligatoria en el test: `adminTienda` pidiendo **su propio** `tiendaId` recibe
`forbidden`, no datos. Sin esa contraprueba, un guard mal escrito pasa desapercibido.

---

## 6. Rendimiento

| Riesgo | Mitigación | Cómo se verifica |
| --- | --- | --- |
| N filas ⇒ N consultas al listar | El `useSWR` vive **dentro** del componente desplegado, que solo se monta al abrir | Render de la tabla con varias filas: 0 llamadas a la action (R32) |
| Abrir una fila dispara varias lecturas | Una sola llamada por (tienda, filtros, página) | Expandir ⇒ exactamente 1 llamada, con ese `tiendaId` (R33) |
| Coste creciente con el tamaño de página o con el nº de tiendas | 2 métodos de repositorio por apertura, constantes | Repo falso que cuenta llamadas: 2, con `pageSize` 20 y 100 y con 1 o 50 tiendas (R34) |
| Consulta de más por el nombre | No se pide: baja por props | El repo falso no expone/no recibe llamada de nombre (R35) |
| Filtrar/paginar en una fila recarga las demás | Clave SWR por tienda | Con dos filas abiertas, filtrar en una: la otra no vuelve a consultar (R36) |
| Descarga que relee la cabecera | El modo completo no agrega nada | Test de servicio: `agregarDesglosePorTienda` no se llama en modo completo |

Nota de aritmética: `listarPorTienda` ejecuta `findMany` + `count` (dos sentencias SQL en un
`Promise.all`) y `agregarDesglosePorTienda` una tercera. Tres sentencias por apertura,
constantes. El requisito se expresa en **llamadas al repositorio** (2) porque es lo que se
puede afirmar de forma determinista con un doble de test; la traducción a sentencias es de
Prisma y se documenta aquí, no se testea.

---

## 7. La descarga y su encaje con la 170

**Decisión: el desglose ofrece su propia descarga** (R37). No es opcional en la práctica: es
una instancia de `<DataTable>` en el árbol `app/`, y la guardia de cobertura obliga a que toda
instancia esté censada **y** a que su estado declarado coincida con el código. Dejarla sin
descarga exigiría declararla `fuera` con un motivo, y no hay motivo: es un ledger de dinero
paginado server-side, la Familia A canónica de la 170.

Encaje concreto:

1. **Familia A** (la página visible es un recorte server-side) ⇒ `obtenerFilas` llama a
   `listarMovimientosDeTiendaCompletoAction` y lo adapta con `filasDesdeResultado`, con el
   tope, el mensaje accionable y el «ninguna rama de error con filas» ya resueltos por
   `components/shared/descarga-resultado.ts` (R39/R40).
2. **Módulo de columnas** `app/(app)/wallet/tiendas/_components/desglose-tienda-descarga-columnas.ts`,
   por convención de nombre para que la guardia de datos sensibles lo descubra sola (R41).
   Emite `fecha · tipo · concepto · monto · origen`; **no** emite `id`, `tiendaId`, `origenId`
   ni `registradoPor` (uuid internos). Monto como STRING tal cual, sin símbolo.
3. **Título con el nombre de la tienda** (`Desglose de <tienda>`, R38): pueden estar varias
   filas abiertas a la vez, y tres botones llamados «Descargar Desglose» no identificarían
   nada. Es la misma razón por la que el desglose del mensajero declara su `descarga` dentro
   del componente y no en el módulo padre.
4. **Censo (R42):** entrada nueva en `CENSO_DATATABLE` para
   `app/(app)/wallet/tiendas/_components/DesgloseMovimientosTienda.tsx` con estado
   `con_descarga`, y actualización de los **cuatro totales duros** de
   `cobertura-tablas.guardia.test.ts`:

   | Constante | Hoy | Con la 171 |
   | --- | --- | --- |
   | `TOTAL_ARCHIVOS_CON_DATATABLE` | 25 | **26** |
   | `TOTAL_INSTANCIAS_DATATABLE` | 30 | **31** |
   | `con_descarga` (aserción del test de fase 1) | 25 | **26** |
   | `totalCensado` | 31 | **32** |

   `fuera` sigue en 6 y no se toca. Que la guardia **falle** si no se actualiza es la prueba
   de que funciona: se deja constancia en `progress/impl_171…` de que se vio fallar antes de
   ajustarla.

---

## 8. Alternativas descartadas

**A) Abrir la lectura nueva también a `adminTienda`, comparando `input.tiendaId ===
actor.usuarioId`.** *Descartada.* Es el patrón que el módulo evita a propósito: hoy el alcance
de cada lectura lo fija el **rol** y el acotamiento por dato del actor se escribe *al final del
where*, donde nada lo puede pisar (`WalletTiendaService.ts:127`, con el comentario que explica
que un fallo ahí no devuelve menos filas, devuelve el ledger de otra tienda). Con la
comparación, la única barrera entre una tienda y el ledger ajeno sería un `if` en el servicio;
y la funcionalidad que daría —que la tienda vea su detalle— **ya existe** en `/mi-wallet`. Coste
de descartarla: cero funcional. Beneficio: la superficie nueva tiene un solo alcance posible.

**B) Reescribir `agregarSaldoPorTienda` para que devuelva ya las tres cubetas, y que
`/mi-wallet` y la tabla de saldos consuman el nuevo agregado.** *Descartada.* Es más limpio en
abstracto —una sola ruta de agregación en vez de dos sobre la misma tabla— pero toca el camino
de datos de dos pantallas que esta feature no debe cambiar (R31/R6) y de las que la 170 tiene
tandas en vuelo. Se elige **añadir** el método y pagar el riesgo de divergencia con un test que
compara ambas derivaciones sobre el mismo conjunto (R11). Cuando la 172 esté cerrada, unificar
es una refactorización mecánica y sin puerta de aprobación.

**C) Servir el desglose desde el Server Component, pre-obteniendo el detalle de todas las
tiendas y pasándolo por props.** *Descartada.* Es lo que hace la tabla de saldos, y para el
detalle no escala: multiplica el coste de abrir la pantalla por el número de tiendas aunque no
se despliegue ninguna, y contradice R32. La carga al abrir es además el patrón ya probado en
mensajeros.

**D) Un botón «ver detalle» que navegue a `/wallet/tiendas/[id]`.** *Descartada.* El humano
pidió **el equivalente al desplegable** de mensajeros; una ruta nueva rompe la comparación
lado a lado entre tiendas (que es para lo que sirve la pantalla), obliga a resolver permisos y
pre-fetch en otra página, y añade una superficie más al censo y a las guardias. Se registra
como opción futura si el desglose crece más allá de lo que cabe en una fila.

**E) Extender `IWalletTiendaFeedService` con el feed de lectura.** *Descartada.* Ese servicio
corre **dentro** de la transacción de aprobación de un cierre y su cliente Prisma está acotado
a `gestionOrden` y `cierreDetail`. Mezclar allí una lectura de pantalla acoplaría el camino
crítico del dinero a una consulta de UI. La lectura vive donde ya vive la del ledger:
`WalletTiendaService`.

---

## 9. Sitio preparado para la 172 (y qué NO se hace aquí)

Lo que la 172 encontrará hecho:

1. **La pantalla desde la que el humano decidió pagar existe**, con la tienda identificada
   (`tiendaId` + nombre en props) y su saldo vigente ya derivado y visible.
2. **La cifra «Pagado a la tienda» ya está en la cabecera** y ya suma `pago_tienda` (R43): el
   día que la 172 inserte el primer movimiento, la pantalla lo refleja sin tocar layout ni
   contrato. Hoy muestra `0.00`, y hay un test con un movimiento `pago_tienda` sembrado que
   demuestra que la cifra no es decorativa.
3. **El filtro por concepto ya incluye `pago_tienda`** (R44), porque se puebla del SEED del
   enum y no de una lista escrita a mano.
4. **Punto de extensión de acciones (R45):** `DesgloseMovimientosTienda` acepta una prop
   opcional `acciones?: ReactNode` que se renderiza en la cabecera junto al saldo. Sin ella no
   se renderiza contenedor alguno (nada que anunciar a un lector de pantalla, ni un hueco en
   blanco). La 172 monta ahí su botón «Registrar pago» sin tocar este archivo más que para
   pasarle el nodo desde `SaldosTiendasTable`.
5. **Revalidación dirigida (R46):** la clave SWR se construye con un helper exportado
   (`claveDesgloseTienda(tiendaId, page, filtros)`) que usa el propio componente. Tras
   registrar un pago, la 172 llama a `mutate` sobre esa clave y refresca **solo** esa tienda —
   no la página entera, no los demás desgloses. Es una función usada por su propio módulo, no
   un andamio muerto.

Lo que **no** se hace aquí (R47): ninguna escritura, ninguna categoría `pago_tienda` emitida,
ningún formulario de pago, ningún campo de método/referencia/fecha real. Eso es la 172 entera.

---

## 10. Archivos que toca

**Nuevos**

| Archivo | Qué |
| --- | --- |
| `lib/utils/desglose-tienda.ts` | `CUBETA_POR_CATEGORIA` + `derivarDesgloseTienda` (puro) |
| `app/(app)/wallet/tiendas/_components/DesgloseMovimientosTienda.tsx` | El desplegable |
| `app/(app)/wallet/tiendas/_components/desglose-tienda-labels.ts` | Etiquetas de cabecera/filtros; reexporta las del ledger de `/mi-wallet` |
| `app/(app)/wallet/tiendas/_components/desglose-tienda-descarga-columnas.ts` | Columnas de export (módulo puro) |
| `tests/unit/utils/desglose-tienda.test.ts`, `tests/unit/services/wallet-tienda-desglose.test.ts`, `tests/unit/actions/wallet-tienda-desglose-action.test.ts`, `tests/unit/descarga/desglose-tienda-descarga-columnas.test.ts`, `tests/integration/wallet-tiendas-desglose.test.tsx` | Tests |

**Modificados**

| Archivo | Qué |
| --- | --- |
| `lib/types/wallet-tienda.ts` | `DesgloseTiendaDTO`, resultados y los dos schemas nuevos |
| `lib/interfaces/repositories/IWalletTiendaMovimientoRepository.ts` | `agregarDesglosePorTienda` + su fila |
| `lib/repositories/WalletTiendaMovimientoRepository.ts` | Implementación (un `groupBy`) |
| `lib/interfaces/services/IWalletTiendaService.ts` | Dos métodos nuevos |
| `lib/services/WalletTiendaService.ts` | Dos métodos nuevos (los existentes intactos) |
| `lib/actions/wallet-tienda.ts` | Dos Server Actions nuevas |
| `app/(app)/wallet/tiendas/_components/SaldosTiendasTable.tsx` | `renderExpanded` + `expandAriaLabel` |
| `tests/unit/descarga/censo-tablas.ts`, `tests/unit/descarga/cobertura-tablas.guardia.test.ts` | Censo + los cuatro totales |

**Que NO se tocan:** `app/(app)/mi-wallet/**`, `WalletTiendaFeedService`, `lib/utils/saldo-tienda.ts`,
`derivarSaldoTienda`, `listarSaldosTiendas`, y ninguna migración.

---

## 11. Riesgos

| # | Riesgo | Mitigación |
| --- | --- | --- |
| 1 | **Colisión con la 170 fase 2 / Tanda I**, que pagina server-side «Saldos de tiendas» y toca 6 de los archivos de arriba | Declarado en `requirements.md § P5`. Decisión del leader; el diseño no depende de cómo llegue la lista de tiendas, así que el conflicto es textual, no arquitectónico |
| 2 | Dos agregaciones sobre la misma tabla acaban divergiendo | Test que compara `derivarDesgloseTienda` con `derivarSaldoTienda` sobre el mismo conjunto (R11) |
| 3 | Guardias de la 170 en rojo por la tabla nueva | Task explícita: verla fallar, luego actualizar censo y totales (§7.4) |
| 4 | Una categoría nueva del enum cae en silencio en «cargos» | `Record` exhaustivo (typecheck) + test sobre el SEED (R9) |
| 5 | Un origen sin etiqueta se muestra crudo (`orden_incidente` en el mapa de la caja principal) | Comportamiento **heredado** de `/mi-wallet` (`origenLabel` cae al valor crudo). Verificado: hoy el ledger de tienda solo recibe `cierre_dia`; los incidentes escriben en la caja principal, no aquí. No se cambia |
