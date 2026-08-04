# Feature 173 — La caja principal en modo tesorería · requirements

> Notación EARS estricta. Cada `R<n>` termina mapeado a un test concreto (ver
> `tasks.md § Trazabilidad`). Sin detalles de implementación: el CÓMO vive en `design.md`.
>
> **PUERTA ABIERTA.** Las marcas `[P1]`…`[P7]` junto a un requisito significan que ese requisito
> **depende de la respuesta del humano** a la pregunta de ese número (ver `§ Preguntas al humano`,
> al final). Los requisitos sin marca no dependen de ninguna respuesta.
>
> **La decisión del humano (2026-07-31, textual de `feature_list.json`):** hoy la caja principal
> modela **RESULTADO** —solo emite los conceptos que Ordenex gana y sus egresos—. El contra-entrega
> (COD) sí se registra, pero como crédito `cod_recaudado` en el ledger **por tienda**, porque no es
> ingreso de Ordenex sino dinero que se le debe a la tienda. *El humano quiere ver el flujo
> completo: el COD entra como ingreso de caja y sale al pagarle a la tienda.*
>
> **Lo que eso rompe, y es el corazón de esta feature:** el número que hoy se llama «Balance
> general» dejará de significar «lo que gané». **Saldo de caja y ganancia tienen que quedar
> separados y nombrados**, o el número se leerá como utilidad y no lo será.

---

## Estado del arte (verificado contra el código, no asumido)

| Hecho | Dónde se comprobó |
| --- | --- |
| El balance de la caja es hoy `ingresos − egresos` a secas y devuelve `{ingresos, egresos, balance, signo}`. Es una función **pura** y money-safe. | `lib/utils/wallet-balance.ts:10-27` |
| Ese mismo `derivarBalance` lo usa **también** la analítica financiera para las cuatro métricas de caja, sobre subconjuntos de categorías declarados por el catálogo. Ahí «ingresos − egresos» sigue siendo correcto. | `lib/services/AnaliticaFinancieraService.ts:34`, `:203-221` |
| La caja tiene **cinco escritores**: los tres feeds de la aprobación del cierre, el reporte de incidente del admin, el formulario de egresos administrativos, el cron de gastos fijos y el movimiento manual. | `CierresAdminRepository.ts:545-579`, `IncidenteAdminRepository.ts:265-272`, `WalletEgresoService.ts:51`, `:93-99`, `GeneracionGastosFijosService.ts:60-64`, `WalletService.ts:138-148` |
| **No existe ninguna categoría de ingreso para el COD** en `wallet_movimiento_categoria`: las 7 `ingreso_*` son los 6 conceptos de Ordenex + `ingreso_ajuste`. | `db/schema.prisma:1038-1056`, `lib/types/wallet.ts:28-46` |
| `egreso_pago_tienda` sigue marcado «reservado feature 43» y **nadie lo emite**. | `db/schema.prisma:1046`; apariciones vivas solo en tipos, etiquetas y catálogo |
| `egreso_pago_mensajero` **sí** lo emite la aprobación del cierre, por el **costo total** `P = total_pago_mensajero`, con la nota literal «la liquidación posterior NO vuelve a emitir egreso (evita doble conteo)». | `lib/services/WalletMensajeroFeedService.ts:19-21`, `:75-89` |
| El crédito COD del ledger por tienda sale de `gestion_orden.montoRecibido` agregado por tienda, con `origen_tipo = cierre_dia` y `origen_id = <cierreId>`. El interruptor de devoluciones **no lo toca**: solo descarta débitos. | `lib/services/WalletTiendaFeedService.ts:104-130` |
| La 172 **NO recibe el repositorio de la caja principal, y es una decisión ([P2]/R40), no un olvido**: «al aprobar el cierre la caja ya cargó `egreso_pago_mensajero = P`, y emitir `egreso_pago_tienda` restaría de la caja un dinero que nunca entró en ella. Sin la dependencia inyectada no hay forma de escribir allí aunque alguien lo intente». | `lib/services/LiquidacionService.ts:122-130`, `:360`; cableado en `lib/actions/liquidacion.ts:70-82` |
| La 172 dejó anotado, **dentro de su propia migración**, que la restricción categoría↔tipo *no* se le puso a la caja y que «queda anotado para la 173, que sí la reescribe». | `db/migrations/20260802120000_liquidacion_pago/migration.sql:123-126` |
| La idempotencia de la caja la da un índice único **parcial** `(origen_tipo, origen_id, categoria) WHERE origen_id IS NOT NULL`, con `createMany({ skipDuplicates: true })`. | `lib/interfaces/repositories/IWalletMovimientoRepository.ts:67-74`, `db/schema.prisma:1077-1078` |
| **El contrato de escritura de la caja NO acepta fecha de movimiento** (la columna existe con `DEFAULT CURRENT_TIMESTAMP`). Los otros dos libros sí la aceptan desde la 172. | `IWalletMovimientoRepository.ts:17-25` vs. `IWalletTiendaMovimientoRepository` (uso en `LiquidacionService.ts:313`) |
| Aprobar un **cierre de bodega** no escribe en ningún libro de dinero, y hay tests que lo afirman. | `tests/unit/services/cierres-bodega-admin-service.test.ts:558-600` |
| La métrica `egresos` de la analítica declara las **ocho** categorías `egreso_*`, incluida `egreso_pago_tienda`, que hoy nadie emite. | `lib/analytics/metrics.ts:470-481` |
| Las tres métricas de ingreso (`ingreso_flete`, `ingreso_comision_cod`, `ingreso_iva`) declaran **listas cerradas** de categorías; el repositorio falla ruidosamente si una métrica declara una categoría que la caja no tiene. | `lib/analytics/metrics.ts:406-452`, `lib/repositories/IngresosAnaliticaRepository.ts:50-64` |
| La conciliación de cierres agrupa los **tres** libros por `(origen_id, tipo)` y luego el servicio compara **solo** el crédito del ledger de tienda contra el snapshot. | `ConciliacionCierresAnaliticaRepository.ts:228-270`, `AnaliticaFinancieraService.ts:441-443` |
| Ya existe el molde exacto de «clasificar cada categoría en cubetas con un `Record` total que rompe el build si el enum crece»: `CUBETA_POR_CATEGORIA` + `derivarDesgloseTienda`, añadidos **al lado** de `derivarSaldoTienda` sin tocarlo. | `lib/utils/desglose-tienda.ts:17-94` |
| Añadir un valor a `wallet_movimiento_categoria` es aditivo (`ALTER TYPE … ADD VALUE IF NOT EXISTS`), y el `down.sql` de **la nueva** migración recrea el enum sin él, soltando y recreando los 2 índices que citan `categoria`. El repo decidió explícitamente **no reescribir los `down.sql` previos** (son punto-en-el-tiempo). | `db/migrations/20260713140000_wallet_egreso_gasto_fijo_variable/{migration,down}.sql`, `db/migrations/20260730120000_incidente_indemnizacion/down.sql:14-16` |
| La pantalla de la caja rotula hoy el número grande como **«Balance general»**, y la propia página lo repite en su descripción. | `app/(app)/wallet/_components/WalletBalanceCard.tsx:42-54`, `app/(app)/wallet/page.tsx:56` |
| El `Select` de categoría del libro se puebla **desde el SEED**, así que una categoría nueva aparece sola en el filtro. | `app/(app)/wallet/_components/wallet-labels.ts:74-80` |
| `CATEGORIA_LABEL` es un `Record` **completo** sobre el union de categorías: sin la clave nueva, el build no compila. | `app/(app)/wallet/_components/wallet-labels.ts:31-47` |
| La caja es de los roles de **acceso total** (`maestro` + `admin`); cualquier otro rol recibe `notFound` sin ver dato alguno. | `app/(app)/wallet/page.tsx:21-27`, `lib/services/WalletService.ts:71`, `lib/auth/acceso-total.ts` |

---

## Glosario

- **Caja principal**: la tabla `wallet_movimiento` (feature 42). Libro append-only, filas inmutables.
- **Contra-entrega (COD)**: el dinero que el cliente final paga al recibir el pedido. No es de Ordenex:
  es de la tienda, menos lo que Ordenex le cobra por el servicio.
- **Movimiento propio**: el que representa dinero **de Ordenex** (flete, comisión, IVA, sueldos,
  gastos, indemnizaciones, pago al mensajero, ajustes manuales de la caja).
- **Movimiento de terceros**: el que representa dinero **que solo pasa por la caja** (el COD que
  entra a nombre de una tienda y el pago con el que se le devuelve).
- **Dinero en caja**: Σ de todo lo que entró − Σ de todo lo que salió, sin distinguir de quién es.
  Es la cifra **nueva** `[P1]`.
- **Ganancia de Ordenex**: Σ de los ingresos propios − Σ de los egresos propios. Es, número por
  número, **la misma cifra que hoy se llama «Balance general»** `[P1]`.
- **Naturaleza**: propio o de terceros. Es una propiedad de la **categoría**, no de la fila.
- **Registro retroactivo**: escribir en la caja los movimientos que corresponden a hechos ya
  ocurridos antes de esta feature (cierres ya aprobados, pagos a tienda ya registrados y
  anulaciones ya registradas). `[P3]`

---

## A. Las dos cifras, separadas y nombradas

**R1** — El sistema DEBE publicar, para el libro de la caja principal, **dos** importes distintos y
nombrados por separado: el **dinero en caja** y la **ganancia de Ordenex**. `[P1]`

**R2** — El sistema DEBE clasificar cada categoría del libro de la caja en **exactamente una**
naturaleza —propia o de terceros—, y esa clasificación DEBE ser total sobre el conjunto de
categorías que el esquema declara.

**R3** — SI el enum de categorías de la caja gana un valor cuya naturaleza nadie ha declarado,
ENTONCES el sistema NO DEBE compilar.

**R4** — El sistema DEBE derivar el **dinero en caja** como Σ(ingresos de cualquier naturaleza) −
Σ(egresos de cualquier naturaleza) sobre el conjunto consultado.

**R5** — El sistema DEBE derivar la **ganancia de Ordenex** como Σ(ingresos propios) − Σ(egresos
propios) sobre el **mismo** conjunto consultado.

**R6** — MIENTRAS el conjunto consultado no contenga ningún movimiento de terceros, el sistema DEBE
devolver el mismo importe en las dos cifras.

**R7** — El sistema DEBE devolver las dos cifras como texto con dos decimales y con su signo
explícito (positivo, negativo o cero), sin usar coma flotante en ningún punto de la derivación.

**R8** — El sistema DEBE aplicar a las dos cifras exactamente los mismos filtros (tipo, categoría y
rango de fechas) que aplica el listado del libro. `[P7]`

**R9** — El sistema DEBE conservar la derivación genérica de balance existente (`ingresos − egresos`
sobre un conjunto dado) con la misma firma, la misma salida y sus mismos tests, sin editarlos: la
analítica financiera la sigue usando y ahí sigue significando lo correcto.

**R10** — El sistema DEBE derivar las dos cifras con una función **pura**, sin acceso a base de
datos, que reciba los totales ya agregados y no lea ningún saldo almacenado.

---

## B. El contra-entrega ENTRA en la caja

**R11** — CUANDO se aprueba un cierre del día, el sistema DEBE registrar en la caja principal un
ingreso **de terceros** por el contra-entrega recaudado en ese cierre.

**R12** — El sistema DEBE fijar el monto de ese ingreso como la suma **exacta** de los créditos de
contra-entrega que **ese mismo cierre** acreditó a las tiendas.

**R13** — SI un cierre no acredita contra-entrega alguno, ENTONCES el sistema NO DEBE registrar
ningún movimiento de contra-entrega en la caja, ni siquiera una fila en 0.00.

**R14** — CUANDO la aprobación de un cierre se reintenta, el sistema NO DEBE registrar un segundo
ingreso de contra-entrega para ese cierre.

**R15** — El sistema DEBE escribir ese ingreso en la **misma transacción** que aprueba el cierre: o
quedan todos los efectos de la aprobación, o ninguno.

**R16** — CUANDO se aprueba un cierre de **bodega**, el sistema NO DEBE registrar ningún movimiento
en la caja principal.

**R17** — El sistema DEBE fechar ese ingreso con la misma coordenada temporal que los demás
movimientos de caja del mismo cierre, de modo que todos los movimientos de una aprobación caigan
en el mismo día.

---

## C. El pago a la tienda SALE de la caja

**R18** — CUANDO se registra un pago a una tienda, el sistema DEBE registrar en la caja principal un
egreso **de terceros** por el monto del pago.

**R19** — El sistema DEBE escribir ese egreso en la **misma transacción** que crea el documento del
pago y su débito en el ledger de la tienda: si el egreso falla, no queda el pago.

**R20** — El sistema DEBE fechar ese egreso con la **fecha real** del pago, no con el instante de
registro.

**R21** — CUANDO se reintenta el mismo pago con la misma clave de idempotencia, el sistema NO DEBE
registrar un segundo egreso en la caja.

**R22** — CUANDO se registra un pago a un **mensajero**, el sistema NO DEBE registrar ningún
movimiento nuevo en la caja principal. `[P2]`

**R23** — El sistema NO DEBE conceder al servicio de liquidación ninguna capacidad de escribir en la
caja principal distinta del egreso de pago a tienda y de su reverso: no basta con no llamarla, no
DEBE existir el camino.

---

## D. Anular un pago a tienda devuelve el dinero a la caja

**R24** — CUANDO se anula un pago a una tienda, el sistema DEBE registrar en la caja principal un
ingreso **de terceros** por el mismo monto del pago anulado.

**R25** — El sistema DEBE fechar ese ingreso con el día de la **anulación**, no con el del pago.

**R26** — El sistema NO DEBE clasificar el reverso de un pago a tienda como ingreso **propio**:
anular un pago no puede aumentar la ganancia de Ordenex ni un céntimo.

**R27** — CUANDO se anula un pago a un **mensajero**, el sistema NO DEBE registrar ningún movimiento
en la caja principal.

**R28** — CUANDO se intenta anular dos veces el mismo pago, el sistema NO DEBE registrar un segundo
reverso en la caja.

**R29** — El sistema NO DEBE borrar ni editar ningún movimiento de la caja para anular: el reverso
es siempre una fila **nueva**.

**R30** — CUANDO se anula un pago a tienda, el **dinero en caja** DEBE volver exactamente al importe
que tenía antes de ese pago, y la **ganancia** DEBE quedar exactamente igual que antes y después.

---

## E. Sin doble conteo, y sin tocar lo que ya cuadra

**R31** — El sistema NO DEBE escribir ninguna fila en el ledger por tienda ni en el libro de pago al
mensajero como consecuencia de esta feature.

**R32** — El sistema DEBE conservar sin cambio alguno el saldo a favor de cada tienda, su desglose
(a favor / cargos / pagado) y el pendiente de cada cierre de mensajero, con los mismos importes que
producen hoy sobre los mismos datos.

**R33** — El sistema NO DEBE derivar ninguna de las dos cifras de la caja leyendo el ledger por
tienda ni el libro del mensajero: las dos salen **solo** del libro de la caja.

**R34** — El sistema NO DEBE presentar la diferencia entre las dos cifras como «lo que se le debe a
las tiendas»: esa deuda ya existe, se deriva de otro libro y es un número **distinto** (menor,
porque Ordenex descuenta flete, comisión e IVA). `[P6]`

**R35** — El sistema DEBE mantener el saldo de cada tienda como única respuesta a «cuánto se le
debe», derivada del ledger por tienda y de ninguna otra fuente.

---

## F. Los datos ya escritos `[P3]`

**R36** — El sistema DEBE registrar en la caja el ingreso de contra-entrega de **todo cierre del día
ya aprobado** antes de esta feature, derivándolo de los créditos que ese cierre ya dejó en el ledger
de la tienda.

**R37** — El sistema DEBE registrar en la caja el egreso correspondiente a **todo pago a tienda ya
registrado** antes de esta feature, derivándolo del documento del pago.

**R38** — El sistema DEBE registrar en la caja el ingreso correspondiente a **toda anulación de pago
a tienda ya registrada** antes de esta feature.

**R39** — El sistema DEBE poder ejecutar el registro retroactivo más de una vez sin duplicar ninguna
fila ni alterar ningún importe.

**R40** — El sistema DEBE ofrecer un modo de **simulación** que informe, sin escribir nada, cuántas
filas insertaría, de qué categoría y por qué monto total.

**R41** — El sistema DEBE fechar cada movimiento retroactivo con la coordenada temporal de **su
origen** (la del cierre, la fecha real del pago o el día de la anulación), y NUNCA con el instante
en que se ejecuta el registro retroactivo.

**R42** — El registro retroactivo NO DEBE modificar, borrar ni reinterpretar ninguna fila existente
de ningún libro.

**R43** — El sistema DEBE permitir comprobar, con una consulta, que **todo** cierre aprobado, **todo**
pago a tienda y **toda** anulación tienen su movimiento correspondiente en la caja, y DEBE nombrar
los que no lo tengan.

**R44** — MIENTRAS existan cierres aprobados, pagos a tienda o anulaciones sin su movimiento de caja,
la comprobación de R43 NO DEBE informar de que el entorno está al día.

---

## G. Integridad de los datos

**R45** — El sistema DEBE rechazar **en la base de datos** todo movimiento de la caja cuya categoría
no corresponda a su tipo (ingreso/egreso). `[P5]`

**R46** — SI una categoría futura de la caja no está clasificada por esa restricción, ENTONCES la
base DEBE rechazar la inserción: la restricción falla **cerrado**, nunca permisivo. `[P5]`

**R47** — El sistema DEBE conservar la inmutabilidad del libro de la caja: ninguna operación de esta
feature actualiza ni borra una fila existente.

**R48** — El sistema DEBE dar idempotencia a cada movimiento nuevo por **restricción de datos**, no
por consulta previa: un segundo intento choca con el índice, no con un `if`.

**R49** — La migración de esta feature DEBE ser reversible: su reverso deja el esquema exactamente
como estaba, sin tocar ninguna política de acceso.

**R50** — La migración de esta feature NO DEBE reescribir el `down.sql` de ninguna migración previa.

---

## H. Analítica financiera (127 / 135)

**R51** — El sistema NO DEBE incluir el contra-entrega de la caja ni su reverso en ninguna de las
métricas de ingreso de Ordenex (flete, comisión COD, IVA).

**R52** — El sistema NO DEBE añadir el contra-entrega de la caja a la métrica de contra-entrega
recaudado existente, que ya se sirve en dos vistas que no suman entre sí.

**R53** — El sistema DEBE hacer que la descripción de la métrica de salidas de la caja diga que, a
partir de esta feature, incluye el dinero entregado a las tiendas. `[P4]`

**R54** — El sistema DEBE publicar el **dinero en caja** y la **ganancia de Ordenex** como métricas
financieras propias, con id propio y descripción propia. `[P4]`

**R55** — El sistema DEBE conservar el guardia de coherencia entre el catálogo de métricas y el
servicio que las produce: ninguna métrica financiera sin productor, ningún productor sin métrica.

**R56** — El sistema DEBE conservar el cuadre de la conciliación de cierres con **exactamente** el
mismo resultado que produce hoy sobre los mismos datos.

**R57** — El sistema DEBE conservar la validación que rechaza una métrica que declare una categoría
que la caja no tiene.

---

## I. Lo que se ve en pantalla

**R58** — La pantalla de la caja DEBE mostrar las dos cifras **a la vez**, cada una con su nombre.
`[P1]`

**R59** — La pantalla de la caja NO DEBE mostrar ningún importe rotulado «balance», ni en la tarjeta
ni en el título ni en la descripción de la página.

**R60** — La pantalla DEBE explicar, junto a las cifras, en qué se diferencian, en lenguaje llano,
en español y sin siglas.

**R61** — La pantalla DEBE mostrar cada categoría nueva del libro con un nombre legible en español,
tanto en el listado como en el filtro y en la descarga.

**R62** — El listado del libro y su descarga DEBEN incluir los movimientos nuevos sin cambiar su
formato ni sus columnas.

**R63** — La tabla de saldos por tienda, el desglose por tienda y la pantalla de la tienda
(`/mi-wallet`) NO DEBEN cambiar de contenido ni de importes.

**R64** — El sistema DEBE calcular las dos cifras en el servidor y entregarlas al cliente ya
formateadas como texto: el navegador no recalcula dinero.

**R65** — El sistema DEBE seguir restringiendo la caja principal a los roles de acceso total; ningún
otro rol DEBE ver ninguna de las dos cifras, ni siquiera parcialmente.

---

## J. Fuera de alcance (declarado, no olvidado)

**R66** — El sistema NO DEBE cambiar cómo ni cuándo se carga el pago al mensajero en la caja: sigue
entrando por el costo total al aprobar el cierre. `[P2]`

**R67** — El sistema NO DEBE crear ningún ciclo de corte, arqueo ni conciliación de caja nuevo.

**R68** — El sistema NO DEBE alterar los importes ni las fórmulas de flete, comisión, IVA ni pago al
mensajero.

---

## Preguntas al humano

> Esta feature va a una **puerta de aprobación**. Estas siete preguntas **son** el contenido de la
> puerta: cada una lleva sus opciones, el **default recomendado** y **la consecuencia de cada
> opción**. Donde una decisión es cara de revertir, está dicho.

### P1 — Los nombres exactos que verá el maestro en pantalla

Hay que bautizar dos cifras y matar una palabra («balance»).

| Opción | Cifra nueva (tesorería) | Cifra de siempre (resultado) |
| --- | --- | --- |
| **(a) DEFAULT** | **Dinero en caja** | **Ganancia de Ordenex** |
| (b) | Saldo de caja | Resultado |
| (c) | Entradas y salidas | Utilidad |

- **Consecuencia de (a):** lenguaje llano, sin jerga contable, y «ganancia» dice literalmente lo que
  ese número siempre fue. Es la que menos explicación necesita.
- **Consecuencia de (b):** «resultado» es correcto pero es palabra de contador; el riesgo es que
  alguien lo lea como «resultado de la búsqueda» o lo ignore.
- **Consecuencia de (c):** «utilidad» y «entradas y salidas» describen bien, pero «entradas y
  salidas» suena a un listado, no a un saldo, y la cifra grande necesita sonar a saldo.
- **Coste de revertir:** BAJO. Son rótulos; cambiarlos es tocar un archivo de etiquetas.
- Fija: R1, R58.

### P2 — ¿El pago al mensajero pasa también a tesorería?

Hoy, al aprobar un cierre, la caja carga **el costo total** `P` del pago al mensajero, aunque en ese
momento solo salga de caja la parte que el mensajero se queda del efectivo (`min(P, E)`); el resto
sale más tarde, cuando se le liquida. Es contabilidad de **devengo**, no de caja.

- **(a) DEFAULT — No tocarlo.** La caja queda mixta: tesorería para el COD y las tiendas, devengo
  para los mensajeros.
  - **Consecuencia:** «Dinero en caja» será **menor** que el dinero real, en exactamente la cuenta
    por pagar a mensajeros —una cifra que el sistema ya publica—. Se equivoca por lo bajo (nunca
    dice que hay más dinero del que hay) y la diferencia es explicable con un número existente.
    Pero deja de ser cierto que «la caja refleja todo el dinero que entra y sale»: la salida real
    del día en que se liquida a un mensajero no aparece.
  - Ninguna fila histórica cambia de significado. Cero backfill en ese lado.
- **(b) Sí, arreglarlo aquí.** Al aprobar se carga `min(P, E)`; el resto sale cuando se liquida.
  - **Consecuencia:** la caja pasa a ser tesorería de verdad y «Dinero en caja» sí se puede comparar
    contra el efectivo y las cuentas reales. Pero: (1) las filas `egreso_pago_mensajero` ya escritas
    significan otra cosa y hay que compensarlas con asientos correctores; (2) hay que revertir
    también la otra mitad de R40 de la 172 (la liquidación al mensajero pasa a escribir en caja);
    (3) probablemente un tercer valor de enum; (4) la feature crece de tamaño casi al doble.
- **Coste de revertir:** ALTO en las dos direcciones. Elegir (a) hoy y (b) dentro de tres meses
  significa escribir asientos correctores sobre un libro append-only que ya tendrá más filas.
  **Esta es la decisión más cara de la puerta.**
- Fija: R22, R66.

### P3 — ¿Se registran retroactivamente los hechos anteriores a esta feature?

Hay movimientos históricos en producción. Sin registro retroactivo, «Dinero en caja» y «Ganancia»
darían **el mismo número** para todo el pasado, que es exactamente la confusión que esta feature
existe para eliminar.

- **(a) DEFAULT — Sí, con un ejecutable idempotente, con simulación previa, corrido a mano en cada
  entorno.**
  - **Consecuencia:** las dos cifras son correctas sobre toda la historia y nadie tiene que explicar
    una fecha de corte. Todo lo que inserta es derivable de documentos existentes (créditos de
    contra-entrega por cierre, pagos a tienda, anulaciones), así que es reproducible y auditable.
    **Modo de fallo:** que alguien olvide ejecutarlo en un entorno; el número miente en silencio.
    Se mitiga con la comprobación de R43, que nombra lo que falta.
- **(b) Sí, dentro de la migración.** Se ejecuta solo al desplegar.
  - **Consecuencia:** imposible olvidarlo. **Modo de fallo:** inserta filas de dinero que nadie
    revisó antes de que corrieran en producción, y su reverso tendría que **borrar** filas de un
    libro que se declaró append-only e inmutable. Contradice el principio central de los tres
    libros.
- **(c) No: solo hacia delante, con la fecha de corte visible en pantalla.**
  - **Consecuencia:** cero riesgo de escritura. **Modo de fallo:** durante meses las dos cifras
    coinciden para cualquier rango anterior al corte, que es indistinguible de «no hay dinero de
    terceros»; y arreglarlo después obliga igualmente a hacer (a).
- **Coste de revertir:** MEDIO. Las filas retroactivas son inmutables; deshacerlas exige
  contraasientos.
- Fija: R36–R44.

### P4 — ¿La analítica gana las dos cifras, o esta feature solo toca la pantalla de la caja?

Al emitirse por primera vez `egreso_pago_tienda`, la métrica **«Egresos»** del tablero empieza a
incluir el dinero devuelto a las tiendas. Su id y su nombre no cambian; su número, sí.

- **(a) DEFAULT — Dos métricas nuevas («Dinero en caja» y «Ganancia de Ordenex») y la descripción de
  «Egresos» actualizada para decir que ahora incluye los pagos a tiendas.**
  - **Consecuencia:** el tablero publica la cifra que el humano acaba de pedir y ninguna métrica
    existente cambia de significado a escondidas.
- **(b) Solo la pantalla de la caja; la analítica se queda como está.**
  - **Consecuencia:** «Egresos» cambia de número sin avisar. Quien compare mes contra mes verá un
    salto que no es un salto, y el tablero no tendrá el número que motivó la feature.
- **(c) Partir «Egresos» en dos ids: salidas propias y pagos a tiendas.**
  - **Consecuencia:** es lo más limpio conceptualmente, pero **cambia el número que hay detrás de un
    id existente**, que es la peor variante: mismo nombre, otro valor, sin forma de notarlo en una
    gráfica.
- **Nota de frontera:** existe la feature **175 — «analítica: corregir el catálogo de métricas»**,
  pendiente. Hay que decir si este cambio de catálogo pertenece a la 173 o se difiere a la 175. El
  default asume **173**, porque el cambio de significado lo causa esta feature.
- **Coste de revertir:** BAJO para (a), ALTO para (c) (los ids son la clave de las pantallas 132/134).
- Fija: R53, R54.

### P5 — ¿Entra la restricción de base que ata categoría↔tipo en la caja?

La migración de la 172 lo dejó escrito: *«La caja principal NO recibe este CHECK (R62): tiene el
mismo hueco y cuatro escritores, pero la 172 no la escribe… Queda anotado para la 173, que sí la
reescribe.»*

- **(a) DEFAULT — Sí, entra.**
  - **Consecuencia:** cierra el último hueco. Importa porque la clasificación por naturaleza decide
    **por categoría**: una fila con categoría de ingreso y tipo egreso caería en la cubeta
    equivocada y descuadraría una cifra sin que nada fallara. **Riesgo:** la restricción valida las
    filas existentes al aplicarse, así que hay que medir producción y preview antes de escribirla —
    y consta que **preview no es alcanzable por el MCP** desde estas sesiones, lo que ya bloqueó un
    merge una vez.
- **(b) No, se difiere.**
  - **Consecuencia:** despliegue sin riesgo, y el hueco sigue abierto una feature más, ahora con
    **siete** escritores y una cifra más que depende de la coherencia categoría↔tipo.
- **Coste de revertir:** BAJO (una restricción se suelta), pero el coste de **no** ponerla se paga
  el día que una fila incoherente entra.
- Fija: R45, R46.

### P6 — ¿Se publica una tercera línea con el dinero de terceros?

La diferencia entre las dos cifras es «contra-entrega cobrado menos lo ya entregado a tiendas».

- **(a) DEFAULT — Sí, como tercera línea, con una advertencia obligatoria de que NO es la deuda con
  las tiendas** y un enlace a la pantalla donde sí está.
  - **Consecuencia:** el maestro puede reconciliar las dos cifras de un vistazo. **Riesgo:** alguien
    la lee como la deuda; es **mayor** que la deuda real, porque de ese dinero Ordenex descuenta
    flete, comisión e IVA. La advertencia es lo único que lo evita.
- **(b) No: solo las dos cifras.**
  - **Consecuencia:** cero riesgo de segunda definición de la deuda. Pero la diferencia entre los dos
    números queda sin explicar en pantalla, y alguien la calculará a mano igual.
- **Coste de revertir:** BAJO (es una línea de UI).
- Fija: R34.

### P7 — Cuando hay filtros puestos, ¿«Dinero en caja» sigue siendo el dinero que hay?

Hoy el balance respeta los filtros del listado. Con el nombre nuevo eso se vuelve trampa: «Dinero en
caja» filtrado a marzo **no** es el dinero que hay en caja, es el neto que se movió en marzo.

- **(a) DEFAULT — Las dos cifras respetan los filtros, y el rótulo cambia cuando hay filtros
  puestos** (p. ej. «Movimiento neto del periodo» en vez de «Dinero en caja»).
  - **Consecuencia:** cabecera y listado siempre dicen lo mismo, y el nombre nunca miente. Cuesta un
    rótulo condicional.
- **(b) «Dinero en caja» es siempre acumulado (ignora el filtro de fecha desde); la ganancia respeta
  los filtros.**
  - **Consecuencia:** es lo que «dinero en caja» significa de verdad, y hay precedente en el repo
    (las dos cuentas por pagar de la analítica se declaran acumuladas). Pero la cabecera dejaría de
    cuadrar con el listado que tiene debajo, que es la primera cosa que alguien intentaría sumar a
    mano.
- **(c) Mostrar las cuatro cifras (acumulada y del periodo, para cada una).**
  - **Consecuencia:** todo dicho y nada ambiguo, a cambio de una cabecera con cuatro números que
    nadie pidió.
- **Coste de revertir:** BAJO.
- Fija: R8.
