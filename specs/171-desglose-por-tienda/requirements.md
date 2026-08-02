# Feature 171 — Desglose del dinero por tienda en la wallet · requirements

> Notación EARS estricta. Cada `R<n>` termina mapeado a un test concreto (ver
> `tasks.md § Trazabilidad`). Sin detalles de implementación: el CÓMO vive en `design.md`.
>
> **Pedido del humano (2026-07-31):** en `/wallet/mensajeros` cada mensajero tiene un
> desplegable con el detalle de todo el dinero que le corresponde
> (`DesglosePagosMensajero.tsx`). En `/wallet/tiendas` **eso no existe**: solo está la tabla
> de saldos. Quiere el equivalente para cada tienda.
>
> **Es además PREREQUISITO de la 172:** el humano decidió que el pago a una tienda se
> registre **desde este desglose**. Esta feature **no** especifica el pago; sí deja el sitio
> preparado (§G) para que la 172 no tenga que rehacer la pantalla.

---

## Estado del arte (verificado contra el código, no asumido)

| Hecho | Dónde |
| --- | --- |
| `/wallet/tiendas` monta **solo** `SaldosTiendasTable.tsx` (una fila por tienda: nombre, saldo, estado). Sin desplegable. | `app/(app)/wallet/tiendas/_components/` |
| `/wallet/mensajeros` monta `CuentasPorPagarTable` + `DesglosePagosMensajero` (desplegable con cabecera de saldo, filtros y tabla paginada). | `app/(app)/wallet/mensajeros/_components/` |
| El desglose del mensajero **no** sale de `IWalletTiendaFeedService` ni de nada parecido: carga con **SWR** al montarse, llamando a la Server Action `listarPagosDeMensajeroAction` → `WalletMensajeroService.listarPagosDeMensajero` → `PagoMensajeroMovimientoRepository`. | `DesglosePagosMensajero.tsx:166`, `lib/actions/wallet-mensajero.ts:151` |
| `IWalletTiendaFeedService` **solo** construye los movimientos que se emiten al aprobar un cierre. No expone lectura de detalle. | `lib/interfaces/services/IWalletTiendaFeedService.ts` |
| El ledger por tienda ya tiene lectura paginada + filtros, pero **acotada al actor** (`adminTienda`, su propio `tienda_id`), servida en `/mi-wallet`. No existe ninguna lectura del detalle de **una tienda elegida**. | `WalletTiendaService.listarMisMovimientos`, `app/(app)/mi-wallet/` |
| Categorías del ledger de tienda: crédito `cod_recaudado`; débitos `flete`, `flete_devolucion`, `comision_cod`, `iva_flete`, `iva_flete_devolucion`, `iva_comision_cod`; `pago_tienda` (declarado, **nadie lo emite**); `ajuste_credito` / `ajuste_debito`. | `lib/types/wallet-tienda.ts:30` |
| La 170 ya dio descarga a la tabla de saldos y dejó **dos guardias** vivas: censo de tablas (con totales duros 25/30/31) y datos sensibles en columnas de export. | `tests/unit/descarga/censo-tablas.ts`, `cobertura-tablas.guardia.test.ts`, `columnas-sensibles.guardia.test.ts` |
| `wallet_tienda_movimiento` ya tiene RLS habilitada e índices `(tienda_id, fecha_movimiento)` y `(tienda_id, categoria)`. | `db/migrations/20260712170000_wallet_tienda_movimiento/migration.sql:60` |

---

## Glosario

- **Desglose de una tienda**: detalle del dinero de UNA tienda — cabecera de importes +
  lista paginada de los movimientos de su ledger.
- **Acceso total**: roles `maestro` y `admin` (`esAccesoTotal`, `lib/auth/acceso-total.ts`).
- **A favor**: movimiento de **crédito** de la tienda (hoy `cod_recaudado` y `ajuste_credito`).
- **Cargo de Ordenex**: movimiento de **débito** cuya categoría **no** es `pago_tienda`
  (fletes, comisión COD, los tres IVA y `ajuste_debito`).
- **Pago a la tienda**: movimiento de débito de categoría `pago_tienda`. Hoy **nunca hay
  ninguno**: ningún código lo emite (lo emitirá la 172).
- **Conjunto filtrado**: los movimientos que cumplen los filtros vigentes del desglose, sin
  recorte por página.
- **Dataset completo**: el conjunto filtrado entero, sin paginar (lo que se descarga).

---

## A. Superficie: el desplegable por tienda

**R1** — El sistema DEBE permitir desplegar, desde cada fila de la tabla de saldos por tienda,
el desglose del dinero de esa tienda.

**R2** — CUANDO el usuario despliega la fila de una tienda, el sistema DEBE mostrar el
desglose de ESA tienda y de ninguna otra.

**R3** — MIENTRAS haya más de una fila desplegada a la vez, el sistema DEBE mantener en cada
desglose su propio estado (página, filtros y datos) sin que una fila altere el contenido de
otra.

**R4** — El sistema DEBE dar al desglose y a cada uno de sus controles un nombre accesible que
identifique a su tienda por el nombre.

**R5** — SI el desglose de una tienda no se puede cargar, ENTONCES el sistema DEBE mostrar el
fallo dentro de esa fila, sin ocultar la tabla de saldos ni afectar a los demás desgloses.

**R6** — El sistema DEBE conservar la tabla de saldos por tienda con el mismo contenido,
alcance, descarga y estado vacío que tiene hoy.

## B. Qué se muestra: la cabecera de importes

**R7** — El sistema DEBE mostrar en la cabecera del desglose CUATRO importes, en este orden:
(1) **a favor de la tienda**, (2) **cargos de Ordenex**, (3) **pagado a la tienda**,
(4) **saldo**.

**R8** — El sistema DEBE clasificar cada movimiento del ledger en exactamente uno de los tres
primeros importes: crédito → *a favor*; débito de categoría `pago_tienda` → *pagado*;
cualquier otro débito → *cargos*.

**R9** — SI el catálogo de categorías del ledger por tienda gana un valor nuevo, ENTONCES el
sistema DEBE fallar una comprobación automatizada mientras ese valor no quede clasificado
explícitamente en uno de los tres importes.

**R10** — El sistema DEBE cumplir en todo desglose la identidad
`saldo = a favor − cargos − pagado`.

**R11** — MIENTRAS el desglose no tenga filtros aplicados, su saldo DEBE ser idéntico —cifra y
signo— al que la tabla de saldos muestra en la fila de esa misma tienda.

**R12** — CUANDO se aplican filtros en el desglose, los cuatro importes DEBEN reflejar el
conjunto filtrado y no el agregado total de la tienda.

**R13** — El sistema DEBE mostrar el estado del saldo (a favor / en contra / en cero) con la
misma etiqueta que usa la tabla de saldos para ese mismo signo.

**R14** — El sistema DEBE mostrar los cuatro importes tal como llegan del servidor, sin
recalcularlos ni convertirlos a número en el navegador.

## C. Qué se muestra: la lista de movimientos

**R15** — El sistema DEBE listar los movimientos del desglose con estos campos y en este
orden: **fecha, tipo, concepto, monto, origen**.

**R16** — El sistema DEBE presentar los movimientos del más reciente al más antiguo.

**R17** — El sistema DEBE paginar los movimientos del desglose en el servidor: una página
visible por vez, con navegación entre páginas y el total del conjunto filtrado.

**R18** — El sistema DEBE ofrecer filtros por **cierre**, por **concepto** y por **rango de
fechas**, resueltos en el servidor.

**R19** — CUANDO se aplican o se limpian los filtros de un desglose, el sistema DEBE volver a
su primera página.

**R20** — El sistema DEBE mostrar el concepto y el origen de cada movimiento con la MISMA
etiqueta legible que la wallet de la tienda (`/mi-wallet`) usa para ese mismo valor.

**R21** — SI el conjunto filtrado no tiene movimientos, ENTONCES el sistema DEBE decirlo con
un mensaje explícito en lugar de una tabla vacía sin explicación.

## D. De dónde salen los datos: contrato de lectura

**R22** — El sistema DEBE exponer una lectura del desglose de UNA tienda que reciba la tienda
como dato de entrada y devuelva, en una sola respuesta: los movimientos de la página, el total
del conjunto filtrado, la página y su tamaño, y los cuatro importes de la cabecera.

**R23** — El sistema DEBE entregar todos los importes al cliente ya serializados como texto
con dos decimales; NO DEBE cruzar la frontera ningún tipo decimal de la base de datos.

**R24** — El sistema DEBE acotar la lectura a la tienda recibida en la entrada, de forma que
ninguna otra clave de la entrada pueda ampliar ese alcance a otra tienda o a todas.

**R25** — SI la entrada no identifica una tienda, ENTONCES el sistema DEBE responder «entrada
inválida» sin consultar la base de datos.

## E. Alcance por rol

**R26** — El sistema DEBE permitir ver el desglose de una tienda cualquiera **solo** a los
roles de acceso total.

**R27** — SI el actor no tiene acceso total, ENTONCES la lectura del desglose DEBE responder
«prohibido» sin devolver ningún movimiento ni importe.

**R28** — SI el actor es una tienda (`adminTienda`) y pide por esta lectura el desglose de su
PROPIA tienda, ENTONCES el sistema DEBE responder «prohibido» igualmente.

**R29** — SI no hay sesión, ENTONCES el sistema DEBE responder «sin sesión» sin consultar la
base de datos.

**R30** — El sistema DEBE conservar el alcance actual de la página `/wallet/tiendas` (solo
acceso total; cualquier otro rol o sin sesión, sin exponer datos).

**R31** — El sistema DEBE conservar sin cambios la wallet propia de la tienda (`/mi-wallet`):
mismo alcance acotado al `tienda_id` del actor, mismos datos, mismos filtros y misma descarga.

## F. Rendimiento

**R32** — MIENTRAS ninguna fila esté desplegada, el sistema NO DEBE emitir ninguna lectura de
desglose, sea cual sea el número de tiendas listadas.

**R33** — CUANDO se despliega la fila de una tienda, el sistema DEBE emitir exactamente UNA
lectura de desglose, y solo para esa tienda.

**R34** — El sistema DEBE resolver la lectura del desglose de una tienda con un número
CONSTANTE de consultas a la base de datos, independiente del número de tiendas listadas, del
número de filas desplegadas y del tamaño de página.

**R35** — El sistema NO DEBE consultar el nombre de la tienda para resolver el desglose: el
nombre ya está en la fila desde la que se despliega.

**R36** — CUANDO se cambia de página o se aplican filtros dentro de un desglose abierto, el
sistema DEBE volver a consultar SOLO esa tienda.

## G. La descarga

**R37** — El desglose DEBE ofrecer la descarga de su **dataset completo** (todos los
movimientos de esa tienda con los filtros vigentes), no de la página visible.

**R38** — El control de descarga del desglose DEBE identificar a su tienda tanto en el nombre
del archivo como en su nombre accesible.

**R39** — SI el dataset completo supera el tope de filas vigente de la aplicación, ENTONCES el
sistema NO DEBE producir archivo y DEBE indicar el total encontrado, el tope y qué hacer.

**R40** — Ninguna respuesta de error de la descarga DEBE viajar acompañada de filas.

**R41** — El archivo del desglose NO DEBE contener identificadores internos ni datos
sensibles.

**R42** — El sistema DEBE registrar la tabla del desglose por tienda en el censo de tablas, y
las comprobaciones de cobertura del censo DEBEN seguir en verde con los totales actualizados.

## H. Sitio preparado para la 172 (sin implementar el pago)

**R43** — El sistema DEBE mostrar el importe «pagado a la tienda» aunque hoy ningún flujo
emita pagos: sin pagos registrados DEBE mostrar cero, y con pagos registrados DEBE reflejarlos
sin cambio alguno en la pantalla.

**R44** — El sistema DEBE ofrecer el concepto `pago_tienda` como opción del filtro por
concepto del desglose.

**R45** — DONDE se proporcione al desglose un contenido de acciones sobre la tienda, el
sistema DEBE renderizarlo en la cabecera de ese desglose; en ausencia de ese contenido NO DEBE
renderizar ningún contenedor añadido.

**R46** — El sistema DEBE permitir refrescar el desglose de UNA tienda desde fuera del propio
desglose, sin recargar la página y sin refrescar los desgloses de las demás tiendas.

**R47** — El sistema NO DEBE registrar, ni ofrecer registrar, ningún pago a una tienda en esta
feature.

## I. Restricciones

**R48** — El sistema DEBE resolver el desglose con las tablas e índices que ya existen, sin
migración de base de datos nueva.

**R49** — El sistema NO DEBE alterar la inmutabilidad del ledger: esta feature es de solo
lectura sobre `wallet_tienda_movimiento`.

---

## Preguntas abiertas

Ninguna de éstas está resuelta por `docs/`, por `feature_list.json` ni por el código. Cada
una lleva el **default** que se aplicará si el humano no responde en la puerta F1.4, para que
la implementación no quede bloqueada, y en ese caso se dejará constancia de que se aplicó.

**P1 — Textos de los cuatro importes.** No existen en el código: la cabecera del mensajero
dice «Total devengado / Total pagado / Cuenta por pagar», que no aplica a una tienda, y
`/mi-wallet` solo dice «Créditos (COD) / Débitos». Propuesta: **«A favor de la tienda»** (con
la aclaración «COD recaudado y ajustes»), **«Cargos de Ordenex»** («fletes, comisión e IVA»),
**«Pagado a la tienda»** («lo ya entregado») y **«Saldo a favor»**.
*Default:* esos cuatro textos.

**P2 — ¿La cabecera de `/mi-wallet` adopta también los cuatro importes?** Hoy la tienda ve
«Créditos (COD) / Débitos / Saldo» en su propia wallet, que es la misma información peor
separada; cuando la 172 emita pagos, esa tarjeta sumará el pago dentro de «Débitos» y la
tienda no podrá distinguir «lo que me cobraron» de «lo que ya me pagaron».
*Default:* **NO** se toca en esta feature (R31 lo prohíbe expresamente). Se registra como
ficha aparte y se resuelve antes o dentro de la 172.

**P3 — Tiendas sin ningún movimiento.** La tabla de saldos deriva sus filas del propio ledger
(`groupBy` sobre `wallet_tienda_movimiento`), así que una tienda **sin movimientos no aparece**
y por tanto no tiene desglose que desplegar. Es el comportamiento actual, y tiene consecuencia
para la 172: no se podrá pagar desde esta pantalla a una tienda que no aparece — aunque
tampoco habría nada que pagarle.
*Default:* se acepta tal cual; se documenta y no se cambia el origen de las filas.

**P4 — ¿La descarga del desglose lleva una columna con el nombre de la tienda?** El desglose
del mensajero **no** la lleva: el nombre identifica al archivo entero (va en el título/hoja),
no a la fila.
*Default:* **no** la lleva; el nombre va en el título del archivo, como en el del mensajero.

**P5 — Conflicto de calendario con la 170 (decisión del leader, no del spec).** La **fase 2 /
Tanda I** de la 170 pagina server-side «Saldos de tiendas»
(`specs/170-export-todas-las-tablas/tasks.md:463`), tocando exactamente los mismos archivos
que esta feature: `SaldosTiendasTable.tsx`, `wallet/tiendas/page.tsx`,
`lib/actions/wallet-tienda.ts`, `lib/types/wallet-tienda.ts`, `WalletTiendaService` y
`WalletTiendaMovimientoRepository`. Por la regla de paralelismo de `AGENTS.md` hay
intersección de archivos en la misma zona (`fullstack`).
*Default:* la 171 **no arranca implementación** hasta que la 170 pase a `done` o el humano
reordene. El diseño de la 171 está hecho para sobrevivir a esa paginación (la carga del
desglose no depende de cómo llegue la lista de tiendas), pero el conflicto textual existe.

**P6 — ¿Los ajustes manuales merecen su propia cifra?** `ajuste_credito`/`ajuste_debito` están
declarados y hoy ningún flujo los emite (no hay UI que los cree). Aquí se pliegan dentro de «a
favor» y «cargos».
*Default:* tres cubetas, sin cifra separada para ajustes. Si el humano quiere verlos aparte,
son cinco importes en la cabecera y cambia R7/R8/R10.
