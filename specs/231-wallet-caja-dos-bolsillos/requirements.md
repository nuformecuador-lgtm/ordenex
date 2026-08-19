# Feature 231 — Wallet · la caja partida en dos bolsillos · requirements.md

Zone: `fullstack` · complexity: `medium` · sdd: `true` · depends_on: `null`

> Requisitos en notación EARS. Cada `R<n>` mapea a un test concreto y **nombrado** en
> `tasks.md` (el reviewer rechaza si falta trazabilidad).
>
> Entrada obligatoria de este spec: `progress/design_231.md` (ENCARGO DE DISEÑO aprobado por el
> humano el 2026-08-18, opción B). **Este spec no re-deriva el diseño: lo traduce a requisitos.**
>
> **Estado: hay 5 decisiones abiertas que necesitan FIRMA HUMANA** (§Preguntas abiertas). D1
> bloquea la tanda del libro; D2 bloquea la tarjeta nueva. El resto del spec puede ejecutarse.

---

## Contexto verificado (leído en el código, no supuesto)

- **`CajaResumenDTO`** (`lib/types/wallet.ts:148-162`) trae hoy `entradas`, `salidas`, `enCaja`,
  `signoEnCaja`, `ingresosPropios`, `egresosPropios`, `ganancia`, `signoGanancia`, `deTerceros` y
  `periodoFiltrado`. **No trae proporción ni desglose de ingresos.**
- **Identidad exacta, comprobada en `derivarCaja`** (`lib/utils/caja-tesoreria.ts:126-148`):
  `entradas − salidas = (ingresosPropios − egresosPropios) + (ingresosTerceros − egresosTerceros)`,
  es decir **`enCaja = ganancia + deTerceros`**. Los dos segmentos de la barra son exactamente esas
  dos cifras: no hay una tercera porción que repartir ni un residuo que esconder.
- **`WalletMovimientoDTO`** (`lib/types/wallet.ts:101-111`) no lleva dueño. La naturaleza del dinero
  es de la CATEGORÍA y ya existe como `Record` TOTAL:
  `NATURALEZA_POR_CATEGORIA` (`lib/utils/caja-tesoreria.ts:43-64`), `"propio" | "terceros"`.
- **El agregado que alimenta las dos cifras ya trae TODAS las categorías**:
  `agregarPorCategoriaYTipo` hace `groupBy(categoria, tipo) + SUM(monto)`
  (`lib/repositories/WalletMovimientoRepository.ts:103-115`). El desglose de ingresos propios **no
  necesita una consulta nueva**: está en las filas que `verResumenCaja` ya pide.
- **`DesgloseEgresosDTO`** (`lib/types/wallet.ts:168-174`) cubre 4 conceptos: `gastoFijo`,
  `gastoVariable`, `sueldo`, `indemnizacion`. Las categorías de egreso **propio** del catálogo son
  **7**: esos cuatro más `egreso_pago_mensajero`, `egreso_gasto` y `egreso_ajuste`. Por tanto
  `DesgloseEgresosDTO.total` **NO es** `egresosPropios`, y una tarjeta que muestre
  «ingresos − egresos = ganancia» con ese total **no cuadraría en pantalla** (→ D2).
- **Las 6 categorías de ingreso propio del feed** están en `WALLET_INGRESO_CONCEPTO_SEED`
  (`lib/types/wallet.ts:88-95`); con `ingreso_ajuste` son **7** categorías de ingreso propio. El
  encargo enumera 6 (omite `ingreso_iva_flete_devolucion`) → D5.
- **La aserción que bloquea la columna «Dueño»**, verificada línea a línea:
  `tests/components/descarga/WalletDescarga.test.tsx:590-597`, dentro del caso
  `it("R62: el listado los pinta como a los demás, sin cambiar las columnas")` (línea 580), fija con
  `toEqual` la secuencia `["Fecha","Tipo","Categoría","Monto","Origen","Acciones"]`. El comentario
  de `WalletLedger.tsx:161` la cita como *línea 566*: **esa referencia está desactualizada** (566 es
  hoy otro caso). → D1.
- **Cuatro aserciones vivas de la 173 condicionan el rediseño de la tarjeta**
  (`tests/components/CajaResumenCard.test.tsx`): las dos cifras en regiones separadas sin contener
  la una el importe de la otra (líneas 69-81), cada cifra con su desglose en su propio subárbol
  (99-126), **cero elementos interactivos** en la tarjeta (líneas 88-91) y el barrido money-safe
  sobre su fuente (344-355). Ninguna se debilita en esta feature.
- **`tests/integration/wallet-page.test.tsx:266-272`** barre `Object.entries(props.resumen)` y exige
  que **todo** valor sea STRING salvo `periodoFiltrado`. Todo campo nuevo del resumen es STRING por
  eso (→ D3).
- **Guardias que acotan dónde puede vivir la derivación nueva** (medidas, no supuestas):
  `caja-derivaciones.guardia.test.ts:127-128` exige **exactamente 3** llamadas a `derivarBalance(`
  en `caja-tesoreria.ts`, y `:131-141` prohíbe ahí los literales `"positivo"`/`"negativo"`/`"cero"`
  y las llamadas `.sub(` / `.minus(`. `caja-173-alcance.guardia.test.ts:490-497` prohíbe que un
  módulo de la 173 nombre los insumos de las fórmulas (`comisionCod`, `ivaFlete`, `valorFlete`…).

---

## A) La caja, partida en dos bolsillos (pantalla)

- **R1** — El sistema DEBE mostrar en `/wallet` la cifra «Dinero en caja» con el importe y el signo
  **tal como los entrega el servidor**, sin recalcularlos ni reformatear el número.
  *Testeable:* con un DTO dado, el importe pintado es el STRING del DTO con formato de moneda.
- **R2** — El sistema DEBE mostrar, inmediatamente debajo de esa cifra, una **barra de composición**
  cuyos segmentos representan la porción de las TIENDAS y la porción de ORDENEX.
- **R3** — El sistema DEBE mostrar bajo la barra **dos bloques hermanos**: el de las tiendas con el
  importe `deTerceros` y el de Ordenex con el importe `ganancia`, cada uno con su explicación.
- **R4** — El bloque de las tiendas DEBE conservar la advertencia de que esa cifra **no es lo que se
  les debe** y el enlace a `/wallet/tiendas`.
- **R5** — MIENTRAS `modoComposicion` sea `dos_bolsillos`, el bloque de Ordenex DEBE pintarse sobre
  superficie **neutra** (el acento se reserva para acción y estado, `DESIGN.md`).
- **R6** — El sistema DEBE seguir mostrando «Entró», «Salió» y el conteo de movimientos dentro de la
  misma tarjeta, como datos **secundarios** de la cifra grande (ninguno desaparece de la pantalla).
- **R7** — El sistema DEBE mantener «Dinero en caja» y «Ganancia de Ordenex» visibles **a la vez**,
  cada una dentro de su propia región accesible, y **ninguna región DEBE contener el importe de la
  otra**.
- **R8** — La tarjeta de la caja NO DEBE incorporar ningún elemento interactivo: ni botón, ni
  pestaña, ni `details/summary`, ni disparador de tooltip.

## B) La proporción, derivada en el servidor

- **R9** — El sistema DEBE entregar en `CajaResumenDTO` el campo **`porcentajeTiendas`** como STRING
  con dos decimales, acotado a `"0.00"`–`"100.00"`.
- **R10** — El sistema DEBE derivar `porcentajeTiendas` como `deTerceros ÷ enCaja × 100` con
  aritmética decimal exacta (nunca `number`), redondeado a 2 decimales, y **solo** cuando
  `modoComposicion` valga `dos_bolsillos`.
- **R11** — El sistema DEBE pintar el segmento de las tiendas con el ancho de `porcentajeTiendas` y
  el de Ordenex ocupando **el espacio restante**, de modo que los dos llenen la barra exactamente
  sin hueco ni desborde por redondeo.
- **R12** — MIENTRAS la pantalla renderiza importes o porciones, el sistema NO DEBE convertirlos a
  número: ninguna fuente de cliente nueva o tocada puede contener `Number(`, `parseFloat(`,
  `parseInt(` ni `.toFixed(`, ni importar `@prisma/client` o `decimal.js`.
- **R13** — El sistema DEBE dar a la barra un **nombre accesible** que enuncie las dos porciones con
  su rótulo y su importe, compuesto a partir de las etiquetas de la pantalla.

## C) El caso límite: cuando la barra no se puede partir

- **R14** — El sistema DEBE entregar en `CajaResumenDTO` el campo **`modoComposicion`** con
  exactamente uno de estos cuatro valores: `dos_bolsillos`, `solo_tiendas`, `solo_ordenex`,
  `sin_reparto`.
- **R15** — SI `ganancia` es negativa Y `deTerceros` es positivo, ENTONCES el sistema DEBE emitir
  `modoComposicion = "solo_tiendas"`.
- **R16** — CUANDO `modoComposicion` sea `solo_tiendas`, el sistema DEBE pintar la barra **entera**
  con el color de aviso (un solo segmento) y el bloque de Ordenex con el color de peligro, diciendo
  con todas sus letras que **hay dinero de las tiendas cubriendo ese saldo**.
- **R17** — SI `deTerceros` es negativo Y `ganancia` es positiva, ENTONCES el sistema DEBE emitir
  `modoComposicion = "solo_ordenex"` y pintar la barra entera en la superficie de Ordenex, con el
  bloque de las tiendas mostrando su importe negativo y su explicación. *(→ D4: el lienzo no dibuja
  este espejo.)*
- **R18** — SI `deTerceros` no es positivo Y `ganancia` no es positiva, ENTONCES el sistema DEBE
  emitir `modoComposicion = "sin_reparto"`, pintar la barra vacía en superficie neutra y **no**
  enunciar porcentaje alguno.
- **R19** — SI ninguna de las condiciones de R15, R17 y R18 se cumple, ENTONCES el sistema DEBE
  emitir `modoComposicion = "dos_bolsillos"`.
- **R20** — MIENTRAS `modoComposicion` sea distinto de `dos_bolsillos`, el sistema NO DEBE pintar
  dos segmentos ni enunciar un porcentaje de reparto en ninguna parte de la pantalla.
- **R21** — El sistema DEBE tomar el modo **del servidor**: la pantalla no compara importes ni
  deduce el modo a partir de `signoGanancia`, `enCaja` o `deTerceros`.

## D) La ganancia, concepto por concepto

- **R22** — El sistema DEBE mostrar una tarjeta «Cómo se compone la ganancia de Ordenex» con los
  INGRESOS propios por concepto a un lado, los EGRESOS al otro y la **ganancia resultante en el pie**.
- **R23** — El sistema DEBE derivar un desglose de ingresos propios que cubra **todas** las
  categorías de ingreso de naturaleza `propio` del catálogo, y cuyo total sea **idéntico**, importe a
  importe, a `ingresosPropios`.
- **R24** — El sistema DEBE derivar ese desglose con los **mismos filtros** que el libro y a partir
  del **mismo agregado** que las dos cifras de la caja: una sola lectura de la base por consulta de
  pantalla, y por tanto un solo instante.
- **R25** — El sistema DEBE nombrar cada concepto con su **etiqueta legible** ya existente
  (`CATEGORIA_LABEL`), nunca con el valor del enum ni con un nombre inventado para esta tarjeta.
- **R26** — El sistema DEBE hacer que la columna de EGRESOS de esa tarjeta sume **exactamente**
  `egresosPropios`: los conceptos que ya existen más el resto de egresos propios agrupados en una
  fila propia. *(→ D2.)*
- **R27** — El sistema DEBE mostrar en el pie la `ganancia` con el signo que entrega el servidor, sin
  derivarlo de los importes pintados.
- **R28** — El sistema DEBE ordenar las filas de ingresos y de egresos por un orden **declarado en el
  código**, nunca por magnitud del importe.
- **R29** — El sistema DEBE decir en la tarjeta qué **no** entra en esos números: el dinero de las
  tiendas no es de Ordenex y por eso no está en la ganancia.
- **R30** — CUANDO el servicio deniegue la consulta, el sistema NO DEBE incluir el desglose de
  ingresos ni ninguna cifra en la respuesta (la rama de denegación viaja sin datos, como hoy).

## E) El libro gana la columna «Dueño»

- **R31** — El sistema DEBE entregar en `WalletMovimientoDTO` el campo **`dueno`**, derivado **en el
  servidor** a partir de la categoría del movimiento.
- **R32** — El sistema DEBE derivar `dueno` de la **única** clasificación existente
  (`NATURALEZA_POR_CATEGORIA`), que es un `Record` TOTAL: una categoría nueva del enum **rompe el
  build** hasta que alguien decida de quién es ese dinero.
- **R33** — El sistema DEBE pintar la columna «Dueño» como **punto de color + texto** («Ordenex» /
  «Tienda»), no como insignia.
- **R34** — El sistema DEBE emitir en la descarga del libro una columna «Dueño» con **el mismo texto**
  que muestra la tabla.
- **R35** — El sistema DEBE conservar el orden relativo de las columnas que ya existían: «Dueño» se
  añade, ninguna se mueve ni se quita. *(→ D1.)*
- **R36** — El cliente NO DEBE derivar el dueño: ninguna fuente de `app/` puede importar la
  clasificación de categorías ni reconstruirla con condicionales sobre el nombre de la categoría.

## F) Alcance y no-regresión

- **R37** — El sistema NO DEBE crear migración, tabla, columna ni valor de enum, y NO DEBE escribir
  ninguna fila nueva en el libro de la caja ni en ningún otro libro de dinero.
- **R38** — El sistema DEBE conservar, importe a importe, el valor de las cifras que ya existen
  (`entradas`, `salidas`, `enCaja`, `ingresosPropios`, `egresosPropios`, `ganancia`, `deTerceros`) y
  el de los cuatro conceptos de `DesgloseEgresosDTO`.
- **R39** — El sistema DEBE pintar todo color de esta pantalla con los **tokens semánticos** del
  repo (`warning`, `danger`, `success`, `muted`), sin ningún hex suelto ni utilidad de paleta
  ad-hoc, y con la variante de tema oscuro que cada rol exige (`DESIGN.md`).
- **R40** — El sistema NO DEBE tocar las pantallas de dinero congeladas por la 173
  (`/wallet/tiendas`, `/mi-wallet`, `/mis-pagos`): su guardia de alcance sigue verde sin editarla.

---

## Fuera de alcance (declarado)

- **El guardia de rol de `/wallet` no cambia**: sigue siendo solo para roles de acceso total. Ningún
  requisito de esta feature lo toca.
- Los dos hallazgos de modo oscuro que destapó el lienzo (`border-asfalto-2` en `DataTable.tsx:501`
  y el `text-destructive` del error del `DataTable`) son de la app entera → **ficha aparte**
  (`progress/design_231.md` §Fuera de alcance).
- Las direcciones A (extracto) y C (puesto de mando) del lienzo quedan archivadas.
- El formato de los importes (céntimos sí/no) es de la **feature 230**, que toca `money()` y
  `lib/config/moneda.ts`. Esta feature no lo altera; ver la nota de colisión en `design.md §8`.

---

## Preguntas abiertas — DECISIONES QUE NECESITAN FIRMA HUMANA

> Ninguna se resuelve por cuenta del spec. **D1 bloquea el bloque del libro; D2 bloquea la tarjeta
> de la ganancia.** El resto puede implementarse mientras se firman.

### D1 — La aserción que fija los seis encabezados del libro *(bloqueante de la tanda E)*

`tests/components/descarga/WalletDescarga.test.tsx:590-597` fija con `toEqual` la secuencia exacta
`["Fecha","Tipo","Categoría","Monto","Origen","Acciones"]`. Añadir «Dueño» la pone roja.

- **Lo que esa aserción quería afirmar** es otra cosa, y está escrito en su propio caso (línea 580 y
  comentario de 589): *que las categorías nuevas de la 173 no añaden ni quitan columnas*. El orden y
  el número exacto se le colaron dentro por usar `toEqual` sobre el array. Es la **misma
  sobre-especificación** que en la feature 200 bloqueó el reordenado de columnas (documentado en
  `WalletLedger.tsx:150-171`).
- **Propuesta:** sustituir la lista literal por la afirmación que el caso dice hacer — que el juego
  de encabezados es **el mismo con y sin las categorías de la 173**, comparado contra la lista de
  columnas declarada por el componente— y añadir un caso propio de esta feature que afirme que
  «Dueño» está presente. La 173 queda **igual de protegida** y deja de gobernar el número de
  columnas del libro.
- **Alternativa:** dejar la aserción intacta y no añadir la columna (se pierde el punto 3 del
  encargo).
- **Firma requerida:** cambiar una aserción de otra feature es deliberado, no un arreglo de paso.

### D2 — Cómo cuadra la columna de EGRESOS de la tarjeta nueva *(bloqueante de la tanda D)*

`DesgloseEgresosDTO` cubre 4 de las 7 categorías de egreso propio; le faltan `egreso_pago_mensajero`,
`egreso_gasto` y `egreso_ajuste`. Si la tarjeta enseña «ingresos − egresos = ganancia» con ese total,
**la resta no cuadra en pantalla** (y el hueco es justo el pago a los mensajeros, que no es pequeño).

- **Propuesta:** la columna de egresos muestra los 4 conceptos actuales **más una fila «Otros gastos
  de Ordenex»** derivada en el servidor como suma de las tres categorías restantes, y su total es
  `egresosPropios`. `DesgloseEgresosDTO` **no cambia de forma** (la 45 y la 158 siguen intactas).
- **Consecuencia que hay que firmar con ella:** el copy heredado de la 158 dice «No incluye los pagos
  a tiendas **ni a mensajeros**»; en la tarjeta nueva el pago a mensajeros **sí** entra (por «Otros
  gastos»). El texto pasa a decir que no incluye el dinero de las tiendas, que es lo que de verdad
  queda fuera de la ganancia.
- **Y la segunda mitad de la decisión:** ¿la tarjeta «Egresos» actual (`DesgloseEgresosCard`)
  **desaparece** de la página absorbida por la nueva, o se conserva y el dato se ve dos veces?
  Propuesta: **absorbida**, con la lista extraída a un componente compartido para que las aserciones
  de la 45 (R11/R12) y de la 158 (R32) **se conserven, no se borren** — borrar un componente borra
  su test y con él la red de features ajenas.
- **Efecto colateral de layout:** al salir el desglose de la fila que compartía con los gastos fijos,
  el panel de gastos fijos pasa a ancho completo. Si se prefiere otra cosa, dígase aquí.

### D3 — Forma de los campos nuevos del resumen

`tests/integration/wallet-page.test.tsx:266-272` barre `Object.entries(props.resumen)` y exige STRING
en todo salvo `periodoFiltrado`.

- **Propuesta:** los dos campos nuevos del resumen son **STRING planos** (`porcentajeTiendas` y
  `modoComposicion` como enum de cadena), y el desglose de la ganancia viaja **fuera** de
  `CajaResumenDTO`, en su propio DTO hermano. Así el barrido sigue afirmando exactamente lo que
  afirma hoy y **no se toca**.
- **Alternativa:** un booleano `noRepartible` o un objeto anidado ⇒ hay que ampliar la lista de
  excepciones de ese barrido (cambio de aserción de la 173).

### D4 — El caso espejo: `deTerceros` negativo

El lienzo dibuja el caso «Ordenex gasta más de lo que gana». El **espejo** (Ordenex pagó a las
tiendas más contra-entrega del que recaudó ⇒ `deTerceros` negativo) no está dibujado.

- **Propuesta (R17):** modo `solo_ordenex`, barra entera en la superficie de Ordenex y el bloque de
  las tiendas mostrando su importe negativo con su explicación.
- Sin firma, el requisito se implementa igualmente **porque la barra no puede quedar sin definir para
  un estado alcanzable**, pero la salida visual es propuesta del spec, no del lienzo.

### D5 — El séptimo concepto de ingreso

El encargo enumera 6 conceptos de ingreso (flete, flete de devolución, comisión COD, IVA del flete,
IVA de la comisión, ajustes) y el catálogo tiene **7** de naturaleza propia: falta
`ingreso_iva_flete_devolucion` («IVA del flete de devolución»).

- **Propuesta:** se muestran **los 7**, uno por fila, porque R23 exige que el desglose sume
  exactamente `ingresosPropios`. Si se prefiere fundir los tres IVA en una sola fila «Impuestos», la
  suma la hace el servidor y se dice aquí.
