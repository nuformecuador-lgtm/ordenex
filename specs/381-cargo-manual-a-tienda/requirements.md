# Ficha 381 — cobrarle un costo a una tienda desde «Registrar movimiento»

**Zona:** fullstack. **SDD:** sí. **Rama:** `feat/381-cargo-manual-a-tienda`.

## El encargo, en palabras del humano

**2026-09-07, primera formulación:**

> «En la wallet, a la hora de registrar un movimiento de dinero desde el botón de registrar
> movimiento, debe haber la posibilidad de cargarle costos a las tiendas.»

**2026-09-07, respondiendo a las preguntas abiertas del primer borrador:**

> «Más que marcar como ingreso es quitar del dinero disponible de esa tienda, sí es importante
> distinguir cuando es un cobro a una tienda, con respecto al abono no lo pongas pues esto sí es
> automático: se hace un cobro a una tienda, este se debita de la plata pendiente por pagar a esa
> tienda y si no hay entonces el disponible debe verse en negativo y cobrarse solo cuando mediante
> la gestión se le deba dinero a esa tienda.»
>
> «Ojo, esos cobros deben también verlos las tiendas en su propia wallet.»

## Decisiones FIRMADAS POR EL HUMANO (2026-09-07)

Estas cuatro no son asunciones. Son respuesta explícita y **derogan** las decisiones del leader que
llevaba el primer borrador de esta ficha.

1. **D1 — El cobro NO toca la caja de Ordenex.** No se marca como ingreso. Lo que hace es **quitar
   del dinero disponible de la tienda**, y nada más. (Deroga la recomendación del leader de emitir
   un ingreso espejo en la caja; el antiguo bloque Q1 y sus cinco requisitos quedan eliminados.)
2. **D2 — Un cobro SE DISTINGUE de una corrección.** «Sí es importante distinguir cuando es un cobro
   a una tienda». No basta con reusar la categoría de ajuste compensatorio ni con confiar en el
   texto de la descripción. (Ver `design.md` §1.2: la distinción se hace con una categoría propia en
   el ledger.)
3. **D3 — El abono manual NO entra.** «Con respecto al abono no lo pongas, pues esto sí es
   automático». El desquite ocurre solo: cuando la gestión genera COD a favor de la tienda, ese
   crédito compensa el cobro. **Consecuencia asumida y decidida, no deuda oculta:** sin abono
   manual, un cobro equivocado **no tiene vía de corrección por pantalla** (ver «Consecuencias
   asumidas», C1).
4. **D4 — Los cobros los ve la tienda en su propia wallet.** No solo el administrador. Esto **reabre
   y decide** la pregunta que el primer borrador había cerrado en «no se toca ninguna etiqueta»: el
   nombre con el que la tienda ve el cobro es parte del alcance.

**Sigue siendo asunción del leader, y necesita confirmación en la puerta de aprobación:** que el
permiso para cobrar es el mismo que el del resto del diálogo (no se inventa uno nuevo), y que la
superficie es el botón «Registrar movimiento» de `/wallet` y no un botón «cobrar» en
`/wallet/tiendas` (`design.md` §8-A).

## Estado del árbol (verificado archivo por archivo el 2026-09-07; no se re-investiga)

1. **El diálogo de hoy** es `app/(app)/wallet/_components/RegistrarMovimientoCajaDialog.tsx`
   (ficha 334): «el ÚNICO control para mover dinero a mano en la caja principal». Su catálogo vive
   en `wallet-conceptos-manuales.ts` y tiene **cuatro** conceptos (`gasto_variable`, `sueldo`,
   `ajuste_ingreso`, `ajuste_egreso`). Los cuatro escriben en `wallet_movimiento` (la caja) y
   **ninguno pregunta a qué tienda**.
2. **`DestinoConcepto` es una unión discriminada a propósito** (`wallet-conceptos-manuales.ts:40`):
   el diálogo elige Server Action por la *clase* del destino, no con un `if` sobre el id, «así que un
   concepto nuevo que olvidara declarar su destino no compila». El mismo archivo declara por qué NO
   se unificó el backend: `origen_tipo` decide qué es reversable.
3. **`wallet_tienda_movimiento` es un ledger append-only e inmutable**: sin `updatedAt` ni
   `deletedAt`, idempotencia por índice único parcial `(origen_tipo, origen_id, tienda_id,
   categoria) WHERE origen_id IS NOT NULL`
   (`db/migrations/20260712170000_wallet_tienda_movimiento/migration.sql:69-71`), y `registrado_por`
   para los manuales (`origen_tipo: manual`, `origen_id: NULL`). **El saldo se DERIVA**, no se
   almacena.
4. **El desquite automático de D3 YA ESTÁ CONSTRUIDO.** `lib/utils/desglose-tienda.ts:79` deriva
   `saldo = aFavor − cargos − pagado` y calcula el signo (`positivo`/`negativo`/`cero`);
   `lib/utils/saldo-tienda.ts:8` declara por escrito que el saldo «PUEDE ser negativo». **No hay
   que construirlo: hay que COMPROBAR que las dos pantallas lo pintan.**
5. **Las dos pantallas ya pintan el negativo, y hay que fijarlo con tests.**
   `SaldosTiendasTable.tsx:36-50` (admin) y `SaldoTiendaCard.tsx:31-45` (`/mi-wallet`) tienen los
   mismos tres colores y el mismo badge «A favor / En contra / En cero», con el STRING pintado tal
   cual. Ninguno tiene test que lo ate a esta ficha.
6. **«Pagar solo cuando se le deba» también existe:** `PagoTiendaAcciones.tsx:130` calcula
   `hayQuePagar = signo === "positivo"` y con saldo no positivo deshabilita el botón y dice «Esta
   tienda no tiene saldo a favor: no hay nada que pagar».
7. **El libro de la tienda ya se pinta y se descarga por concepto.**
   `DesgloseTiendaLedger.tsx:50` (la tienda) y `DesgloseMovimientosTienda.tsx:202` (el admin)
   renderizan `CATEGORIA_TIENDA_LABEL[m.categoria]`, y las dos descargas
   (`mi-wallet-descarga-columnas.ts:44`, `desglose-tienda-descarga-columnas.ts:62`) leen ese MISMO
   diccionario. El filtro por concepto (`CATEGORIA_TIENDA_OPTIONS`, `mi-wallet-labels.ts:102`) se
   puebla desde el SEED del enum.
8. **Cuatro `Record` totales sobre la categoría obligan a decidir si el enum crece:**
   `CUBETA_POR_CATEGORIA` (`lib/utils/desglose-tienda.ts:34`), `FUENTE_TIENDA`
   (`lib/utils/aporte-por-orden.ts:94`), `CATEGORIA_TIENDA_LABEL`
   (`app/(app)/mi-wallet/_components/mi-wallet-labels.ts:76`) y el propio
   `WALLET_TIENDA_MOVIMIENTO_CATEGORIA_SEED`. Ninguno admite `default`: el build rompe hasta que
   alguien escriba dónde cae el valor nuevo.
9. **El historial de acciones no tiene dónde apuntar esto.** `historial_accion_tipo` no tiene tipo
   para un cobro a tienda y `historial_accion_entidad` **no contiene** `wallet_tienda_movimiento`
   (`lib/types/historial-accion.ts:198-219`). Los dos catálogos son exhaustivos por `satisfies` +
   `Exclude`, y `tests/unit/guards/historial-accion-escrituras-cubiertas.guardia.test.ts` exige un
   productor real por cada tipo.
10. **Ya existe el catálogo de tiendas para un selector:** `listarAdminTiendas`
    (`lib/actions/usuarios-por-rol.ts:43`) → `UserRepository.listByRol("adminTienda")`, que proyecta
    `id`/`nombre` de las cuentas con `estado: "activo"` ordenadas por nombre. Lo consume ya
    `GenerarApiKeyForm`.

## Requisitos (EARS)

### A — La superficie: el diálogo «Registrar movimiento»

**R1** — El sistema DEBE ofrecer, en el catálogo de conceptos del diálogo «Registrar movimiento» de
`/wallet`, un concepto que cobra un costo a una tienda, además de los cuatro que ya existen.

**R2** — MIENTRAS el concepto elegido sea el cobro a una tienda, el diálogo DEBE pedir la tienda a la
que se cobra, además del monto, la fecha y la descripción.

**R3** — MIENTRAS el concepto elegido NO sea el cobro a una tienda, el diálogo NO DEBE pedir ninguna
tienda ni enviar ninguna al servidor.

**R4** — El diálogo DEBE indicar, para el concepto elegido, en qué libro queda registrado el
movimiento y con qué nombre aparecerá en él.

**R5** — CUANDO el diálogo se abre, el sistema DEBE poder ofrecer como destinatarias las cuentas de
tienda activas, en un orden determinista.

**R6** — SI el catálogo de tiendas no se puede leer, ENTONCES el diálogo DEBE decirlo y DEBE impedir
registrar un cobro, sin impedir registrar ninguno de los otros cuatro conceptos.

**R7** — SI se confirma un cobro sin haber elegido tienda, ENTONCES el sistema DEBE señalar el fallo
bajo el campo de la tienda y NO DEBE registrar nada.

**R8** — MIENTRAS una confirmación esté en curso, el diálogo NO DEBE admitir una segunda.

**R9** — CUANDO el registro de un cobro termine bien, el diálogo DEBE confirmarlo, cerrarse y
provocar que la pantalla vuelva a leer sus datos.

**R10** — CUANDO el servidor rechace un cobro, el diálogo DEBE conservar lo tecleado y mostrar el
motivo bajo el campo que lo produce.

**R11** — El sistema DEBE conservar sin cambios el comportamiento de los cuatro conceptos que ya
existen: su destino, la categoría que escriben, el libro al que van y los textos que muestran.

### B — El borde: qué se acepta y qué se rechaza

**R12** — SI quien registra un cobro no tiene el mismo permiso que el resto del diálogo, ENTONCES el
sistema DEBE rechazarlo sin leer ni escribir ningún dato de dinero.

**R13** — SI no hay sesión, ENTONCES el sistema DEBE rechazar el cobro como no autenticado.

**R14** — SI el monto de un cobro no es un número mayor que cero con hasta dos decimales, ENTONCES el
sistema DEBE rechazarlo y NO DEBE escribir nada.

**R15** — SI la descripción de un cobro está vacía una vez recortados los espacios, ENTONCES el
sistema DEBE rechazarlo y NO DEBE escribir nada.

**R16** — SI la fecha de un cobro no existe en el calendario, es posterior a hoy o cae fuera de la
ventana admisible, ENTONCES el sistema DEBE rechazarlo con el MISMO motivo que emite para los otros
cuatro conceptos.

**R17** — SI la tienda indicada no existe, no es una cuenta de tienda o no está activa, ENTONCES el
sistema DEBE rechazar el cobro señalando el campo de la tienda y NO DEBE escribir nada.

**R18** — El sistema DEBE tratar el monto de un cobro como texto desde la pantalla hasta la base, sin
convertirlo en ningún punto a coma flotante, y el importe que quede persistido DEBE ser exactamente
el que se tecleó, con dos decimales.

### C — El asiento en el libro de la tienda

**R19** — CUANDO se confirme un cobro válido, el sistema DEBE añadir al libro de ESA tienda un
movimiento de débito de una categoría **propia de los cobros**, con el monto, la descripción, la
fecha y el autor del registro.

**R20** — El movimiento de R19 DEBE quedar marcado como registro manual y sin documento de origen.

**R21** — SI quien registra no elige un día distinto del de hoy, ENTONCES el movimiento de R19 DEBE
fecharse con el instante del registro, igual que los otros cuatro conceptos.

**R22** — El sistema NO DEBE ofrecer editar, borrar ni reversar un cobro ya registrado.

**R23** — Un cobro DEBE producir EXACTAMENTE UNA fila en el libro de la tienda: ningún movimiento
adicional de impuesto ni de ningún otro concepto derivado.

**R24** — Un cobro NO DEBE producir ningún movimiento en la caja de Ordenex **(D1)**.

**R25** — El sistema DEBE escribir en UNA SOLA transacción todo lo que un cobro produce; SI alguna de
esas escrituras falla, ENTONCES NO DEBE quedar ninguna de las demás.

### D — El saldo se descuenta solo, y en negativo se ve

**R26** — CUANDO un cobro quede registrado, el saldo de esa tienda DEBE bajar exactamente en el
importe del cobro.

**R27** — El sistema NO DEBE rechazar un cobro por que la tienda no tenga saldo suficiente: el saldo
PUEDE quedar por debajo de cero **(D3)**.

**R28** — MIENTRAS el saldo de una tienda sea negativo, la vista de administración DEBE presentarlo
con su signo y su importe completos, sin recortarlo a cero y sin ocultar el signo.

**R29** — MIENTRAS el saldo de una tienda sea negativo, la wallet de esa tienda DEBE presentarlo con
su signo y su importe completos, sin recortarlo a cero y sin ocultar el signo.

**R30** — Las dos pantallas de R28 y R29 DEBEN distinguir un saldo negativo de uno positivo y de uno
en cero con una marca legible, no solo por el signo del número.

**R31** — MIENTRAS el saldo de una tienda no sea positivo, el sistema NO DEBE ofrecer pagarle, y DEBE
decir por qué **(D3: se le paga solo cuando la gestión le deba dinero)**.

### E — La tienda ve sus cobros en su propia wallet **(D4)**

**R32** — CUANDO un cobro quede registrado, DEBE aparecer en el libro de la wallet de ESA tienda.

**R33** — Un cobro DEBE presentarse, en la wallet de la tienda, con un nombre que diga que es un
cobro y que sea DISTINTO del nombre con el que se presenta una corrección compensatoria **(D2)**.

**R34** — La vista de administración DEBE presentar un cobro con ese MISMO nombre.

**R35** — El sistema DEBE permitir filtrar el libro por el concepto de cobro, tanto en la wallet de
la tienda como en la vista de administración.

**R36** — El importe de un cobro DEBE contarse dentro de los cargos de la cabecera del desglose, en
las dos pantallas, y NO dentro de lo que está a favor de la tienda ni de lo ya pagado.

**R37** — La aclaración que acompaña al importe de cargos en la wallet de la tienda DEBE nombrar los
cobros, de modo que no enumere solo los conceptos automáticos.

**R38** — Un cobro NO DEBE aparecer en el libro de ninguna otra tienda.

**R39** — El nombre con el que un cobro sale en la descarga del libro DEBE ser el mismo con el que se
ve en pantalla, en las dos pantallas.

### F — El rastro

**R40** — CUANDO se registre un cobro, el sistema DEBE dejar en el historial de acciones una fila que
identifique quién lo hizo, cuándo, por qué importe y sobre qué tienda.

**R41** — El sistema DEBE clasificar el registro de R40 como una acción que MUEVE DINERO.

**R42** — SI el asiento de R19 no llega a escribirse, ENTONCES NO DEBE quedar ninguna fila de R40.

**R43** — La fila de R40 NO DEBE contener texto libre tecleado por una persona ni datos del
destinatario de ninguna orden.

## Consecuencias asumidas

**C1 — Un cobro equivocado no tiene botón de deshacer, y es una decisión firmada (D3).** El ledger es
append-only y el abono manual queda fuera de alcance por decisión del humano. La corrección de un
cobro erróneo sería un crédito compensatorio (`ajuste_credito`), que **hoy solo lo emite la anulación
de un pago a tienda** (`LiquidacionService.ts:1234`): no existe pantalla para emitirlo a mano. En la
práctica, un cobro equivocado se compensa registrando un pago a la tienda cuando su saldo vuelva a
ser positivo, o abriendo una ficha nueva. Se escribe aquí para que no aparezca como sorpresa el día
que ocurra.

**C2 — Un cobro no se deduplica en la base.** Al llevar `origen_id` nulo (R20) queda FUERA del índice
único parcial del ledger, exactamente igual que el ajuste manual de caja de hoy. Dos envíos idénticos
producirían dos cobros. Lo único que hay entre medias es el bloqueo anti-doble-envío del `Modal`
(R8), que es de pantalla, no de base. Cerrarlo pedía una clave de idempotencia que hoy ningún
concepto manual tiene y que nadie ha pedido.

**C3 — El saldo negativo cambia de significado, no de aritmética.** Hasta hoy un saldo negativo solo
podía venir de fletes de devolución. Desde esta ficha puede venir de una decisión humana. La cifra se
deriva igual y las pantallas ya la pintan; lo que cambia es cuántas veces se va a ver, y por eso
R28–R31 la fijan con tests en vez de darla por buena.

## Preguntas abiertas

**Q1 — El nombre de la categoría nueva y su etiqueta.** El diseño propone el valor de enum
`cobro_manual` y la etiqueta **«Cobro de Ordenex»** en el libro (la que ve la tienda y el admin), y
**«Cobrar un costo a una tienda»** en el selector del diálogo. `ajuste_debito` se queda intacto y sin
productores, reservado para su uso original (corrección compensatoria). ¿Se aprueban los tres
textos?

**Q2 — ¿La ficha 381 se registra en `feature_list.json`?** Comprobado el 2026-09-07: **no existe
ninguna entrada con `"id": 381`**. El spec_author no escribe ese archivo. Alguien tiene que
registrar la ficha antes de implementar, o el gate y el reviewer trabajarán sobre una feature que el
estado no conoce.
