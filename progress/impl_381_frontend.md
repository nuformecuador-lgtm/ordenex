# impl 381 — cobrarle un costo a una tienda (MITAD DE PANTALLA)

**Fecha:** 2026-09-08 · **Rama:** `worktree-agent-a6a7dd5082b1c2596` (sale de `dev`, `efed1d58`,
que ya trae mergeada la mitad de servidor del PR #750).
**Alcance:** tandas H e I de `specs/381-cargo-manual-a-tienda/tasks.md`. El servidor NO se toca:
la única línea fuera de `app/` es borrar una anotación que caducó.
**La mitad de servidor está en `progress/impl_381.md`** y de ahí sale la interfaz que se consume.

---

## Lo que se construyó, en una frase

El diálogo «Registrar movimiento» de `/wallet` gana un **quinto concepto**, «Cobrar un costo a una
tienda», que pide **a qué tienda** y escribe en el libro de ESA tienda, no en la caja. El
disponible de la tienda baja, **puede quedar en negativo, y en negativo se ve entero** en las dos
pantallas —la de Ordenex y la de la tienda—, con su signo y su marca legible.

**El negativo es lo pedido, no un error.** Nada de esta pantalla lo recorta a cero, le quita el
signo, lo trata como fallo ni anuncia «saldo insuficiente». Se comprobó con cuatro mutaciones
firmadas y mirando la app.

---

## Archivos

### Producción

| archivo | qué cambia |
| --- | --- |
| `app/(app)/wallet/_components/wallet-conceptos-manuales.ts` | quinto concepto; la `categoria` se muda DENTRO de `destino` (design §4); `libroDelConcepto`, `fraseDelLibro`, `CABECERA_POR_LIBRO` |
| `app/(app)/wallet/_components/RegistrarMovimientoCajaDialog.tsx` | campo de tienda condicional (SWR sobre `listarAdminTiendas`), tercera rama de enrutado, `reset()` que limpia la tienda, error de campo del borde, degradación ruidosa, aviso de éxito con el saldo devuelto |
| `app/(app)/mi-wallet/_components/mi-wallet-labels.ts` | **una línea**: `cargosHint` (R37) |
| `lib/actions/wallet-tienda.ts` | **se BORRA `@sin-superficie`** de `registrarCobroTiendaAction`: la pantalla ya la monta, y la guardia falla también cuando una anotación sobrevive a su motivo |

### Tests creados

| archivo | qué fija |
| --- | --- |
| `tests/unit/components/mi-wallet-labels.test.ts` | R37 y que el resto de la cabecera no se movió |
| `tests/unit/components/saldo-tienda-card.negativo.test.tsx` | R29/R30 + barrido money-safe y anti-`Math` |
| `tests/unit/components/saldos-tiendas-table.negativo.test.tsx` | R28/R30 + el mismo barrido |
| `tests/unit/components/pago-tienda-acciones.test.tsx` | R31, con sus DOS lados |
| `tests/unit/components/desglose-tienda-ledger.test.tsx` | R32 y R35 en `/mi-wallet` |
| `tests/unit/components/desglose-movimientos-tienda.test.tsx` | R34 y R35 en `/wallet/tiendas` |

### Tests ampliados

- `tests/unit/components/wallet-conceptos-manuales.test.ts` — de CUATRO a CINCO conceptos.
- `tests/unit/components/wallet-registrar-movimiento-dialog.test.tsx` — +15 casos de la 381.
- `tests/unit/descarga/wallet-tienda-descarga-columnas.test.ts` y
  `tests/unit/descarga/desglose-tienda-descarga-columnas.test.ts` — R39, una por descarga.

---

## Las cinco decisiones que tomé YO, dichas como mías

1. **La frase de la caja se conserva byte a byte y sólo el cobro estrena la suya.** El diseño (§8)
   dice que el texto «pasa a nombrar de qué libro habla», y R11 exige que los cuatro conceptos
   previos no cambien ninguno de sus textos. Lo compatible es: `caja` sigue diciendo «Se registra
   en el libro como «X».» y `tienda` dice «Se registra en el libro **de la tienda** como «X».».
2. **El título y la descripción del diálogo pasan a depender del libro.** «Registrar movimiento en
   la caja» deja de ser cierto en cuanto se elige el cobro, y un encabezado que miente sobre dónde
   va el dinero es el género de fallo mudo que este repo persigue. La entrada `caja` conserva sus
   dos textos íntegros. La descripción del cobro dice además que **no se puede deshacer**, que es
   la consecuencia C1 del spec puesta donde alguien la va a leer antes de pulsar.
3. **El aviso de éxito lleva el saldo que devuelve el servidor**, con su signo y con la marca
   legible que el propio servidor derivó: «Cobro registrado. El saldo de X queda en -₡23.487,21 ·
   En contra.» Es lo que el docstring de `ICobroTiendaService` anticipaba, y hace que el negativo
   se vea **en el momento del cobro** y no sólo al ir a mirarlo. No se compara ni se convierte
   nada: se pinta `saldo.saldo` con `money` y se indexa `SALDO_SIGNO_LABEL` con `saldo.signo`.
4. **La degradación del catálogo de tiendas es RUIDOSA**, al revés que la de `GenerarApiKeyForm`.
   Allí la tienda destino es opcional; aquí es obligatoria, así que un desplegable vacío y mudo
   dejaría a alguien pulsando «Registrar» sin entender por qué no pasa nada. Se dice con un
   `role="alert"` y se deshabilita el confirmar **sólo** para el cobro.
5. **El texto de `cargosHint`** pasa a «Fletes, comisión, IVA y cobros de Ordenex»: usa la misma
   palabra con la que el cobro se rotula en el libro, para que la tienda pueda relacionar la cifra
   agregada con la fila.

> ⚠️ **La Q1 del spec sigue SIN FIRMAR y NO la firmo yo.** Los tres textos —`cobro_manual`, «Cobro
> de Ordenex» y «Cobrar un costo a una tienda»— siguen siendo la propuesta del diseño. El del
> selector lo escribí yo siguiendo esa propuesta; cambiarlo cuesta **una línea** en
> `wallet-conceptos-manuales.ts` (y el título del diálogo, que la repite a propósito). Los otros
> dos cuestan una línea en `CATEGORIA_TIENDA_LABEL` y una migración, respectivamente.

---

## Mapa `R<n>` → test (los 20 que me tocaban)

### A — la superficie (tanda H)

| R | test | estado |
| --- | --- | --- |
| R1 | `wallet-conceptos-manuales.test.ts` → «el catálogo ofrece los cinco conceptos… y ninguno más» + «⭑ FICHA 381 — el quinto concepto cobra a una tienda» · `wallet-registrar-movimiento-dialog.test.tsx` → «ofrece gasto variable, sueldo, los dos ajustes y el cobro a una tienda, y nada más» | **CUBIERTO** |
| R2 | `wallet-registrar-movimiento-dialog.test.tsx` → «con el cobro elegido, el diálogo pide la tienda además del monto, la fecha y el motivo (R2)» | **CUBIERTO** |
| R3 | idem → «con cualquiera de los otros CUATRO conceptos no hay campo de tienda (R3)» + «elegir el cobro y volver atrás no deja ninguna clave de tienda en el payload (R3)» | **CUBIERTO** |
| R4 | idem → «la línea de ayuda y el título nombran el libro de la tienda, no la caja» · `wallet-conceptos-manuales.test.ts` → «⭑ 381: la frase del diálogo nombra el LIBRO, y la de la caja no cambió (R4/R11)» y «⭑ 381: el cobro se deriva del diccionario del libro de la TIENDA» | **CUBIERTO** |
| R5 | `wallet-registrar-movimiento-dialog.test.tsx` → «ofrece las tiendas que devuelve el servidor, EN SU ORDEN y sin reordenarlas» + «no pide el catálogo hasta que alguien abre el diálogo» | **CUBIERTO** |
| R6 | idem → «%s → se dice, no se puede registrar el cobro, y los otros cuatro siguen (R6)» (dos casos: la action responde `forbidden` y la action revienta) | **CUBIERTO** |
| R7 | idem → «señala el fallo bajo el campo de la tienda y NO registra nada» + «elegir la tienda limpia el error y entonces sí registra» | **CUBIERTO** (se completa la mitad de borde que ya estaba) |
| R8 | idem → «mientras la confirmación está en curso, el diálogo no admite una segunda» | **CUBIERTO** |
| R9 | idem → «avisa con el saldo que devolvió el servidor, EN NEGATIVO y sin recortarlo» (+ el control positivo «un cobro que deja el saldo A FAVOR…») | **CUBIERTO** |
| R10 | idem → «lo tecleado sobrevive y el motivo va bajo el campo de la tienda» + «el rechazo por MONTO del cobro se pinta bajo el monto, no bajo la tienda» | **CUBIERTO** |
| R11 | `wallet-conceptos-manuales.test.ts` → «los CUATRO de la ficha 334 siguen siendo los cuatro primeros, en su orden», «el conjunto de categorías de CAJA es EXACTAMENTE las cuatro admitidas», «los dos ajustes van por `manual` y los dos gastos por `gasto`», «las DOS etiquetas que ya existían se conservan byte a byte», «la de la caja se conserva byte a byte» · el diálogo conserva sus cuatro `toEqual` de payload intactos | **CUBIERTO** |

### D — el negativo en pantalla (tanda I)

| R | test | estado |
| --- | --- | --- |
| R28 | `saldos-tiendas-table.negativo.test.tsx` → «pinta el importe con su signo, sin recortarlo a cero y sin valor absoluto» + «conserva los céntimos del negativo» + el barrido money-safe/anti-`Math` · `desglose-movimientos-tienda.test.tsx` → «la cabecera enseña el saldo NEGATIVO entero, con su signo» | **CUBIERTO** |
| R29 | `saldo-tienda-card.negativo.test.tsx` → «pinta el importe con su signo y sin recortarlo a cero», «conserva los CÉNTIMOS del negativo», «el negativo NO se presenta como un fallo: ni alerta, ni «saldo insuficiente»» | **CUBIERTO** |
| R30 | los dos anteriores → «signo `%s` → insignia «%s» junto al importe %s» (los TRES signos) + «las tres insignias son distintas entre sí» / «cada fila lleva su estado en palabras, y las tres son distintas» | **CUBIERTO** |
| R31 | `pago-tienda-acciones.test.tsx` → «signo `%s` → el botón está deshabilitado y se explica por qué» (negativo y cero) **y** «el botón está habilitado y el aviso de «no hay nada que pagar» desaparece» (positivo) | **CUBIERTO** |

### E — lo que ve la tienda (tanda I)

| R | test | estado |
| --- | --- | --- |
| R32 | `desglose-tienda-ledger.test.tsx` → «pinta la fila con su fecha, su tipo, su nombre, su importe y su origen» + «y no se come las otras filas del libro» | **CUBIERTO** (se completa la mitad de servidor) |
| R34 | `desglose-movimientos-tienda.test.tsx` → «la tabla pinta «Cobro de Ordenex», su importe y su origen manual» | **CUBIERTO** |
| R35 | `desglose-tienda-ledger.test.tsx` → «el selector de concepto ofrece «Cobro de Ordenex»» (`/mi-wallet`) · `desglose-movimientos-tienda.test.tsx` → «el selector de concepto de la vista de administración ofrece «Cobro de Ordenex»» + «elegir ese concepto y aplicar manda la categoría al servidor» | **CUBIERTO** |
| R37 | `mi-wallet-labels.test.ts` → los cuatro casos de «⭑ FICHA 381 (R37)» · `saldo-tienda-card.negativo.test.tsx` → «la tienda lee, bajo el importe de cargos, que ahí dentro puede haber un cobro» | **CUBIERTO** |
| R39 | `wallet-tienda-descarga-columnas.test.ts` → «⭑ FICHA 381 (R39)…» (4 casos, incluida la igualdad CRUZADA entre las dos descargas) · `desglose-tienda-descarga-columnas.test.ts` → «⭑ FICHA 381 (R39) — el cobro en la descarga del desglose por tienda» (3 casos) | **CUBIERTO** |

**Los 43 de la ficha quedan cubiertos**: 24 por la mitad de servidor (`progress/impl_381.md`) y
estos 20 por la pantalla (R1–R11, R28–R32, R34, R35, R37, R39). No queda ningún `R<n>` sin fila.

---

## Verificación

### Gate — `./init.sh` COMPLETO

El rápido se niega solo con este diff. Log propio (`.gate-381-frontend.log`, borrado antes de
commitear; **sin `tail`**, y el código de salida escrito DENTRO del log).

```
✓ typecheck paso
✓ lint (0 errores; los mismos warnings preexistentes del árbol)
 Test Files  1811 passed (1811)
      Tests  25958 passed | 26 skipped (25984)
✓ tests: sin rojos nuevos (0 archivo(s) rojo(s) sobre 1811 ejecutado(s))
! migraciones sin down.sql: las TRES carpetas de agosto que ya venían sin él
✓ .env presente
== init OK ==
INIT_EXIT=0
```

- **`.env` copiado de la raíz antes del gate y borrado antes de commitear.** El propio init lo
  confirma con `✓ .env presente`: sin él, ~138 archivos de `tests/integration/db` se saltan y el
  gate diría «OK» sin comprobar la capa de datos.
- **Los `skipped` son 26, los conocidos**, y ninguno es de base de datos: 17 de
  `tests/components/AnaliticaPage.test.tsx` y 9 de `tests/components/AnaliticaShell.test.tsx`.
  Se leyeron uno a uno del log, no se dieron por buenos.
- **Cero `40P01`** en toda la corrida.
- La base local se migró (`prisma migrate deploy` la encontró al día: las dos migraciones de la
  381 ya estaban aplicadas por la mitad de servidor) y se regeneró el cliente con
  `pnpm run db:generate` **antes** del primer typecheck.

### Un rojo REAL de guardia, y cómo se resolvió

La primera pasada de guardias salió roja: `tests/unit/guards/no-embalaje.test.ts`. El repo
**prohíbe esa palabra en todo el árbol** (feature 28, R6/R7) y mi ejemplo de descripción y varios
datos de prueba la usaban. **No se tocó la guardia ni su lista blanca**: se cambió mi texto. Queda
escrito porque es exactamente el tipo de regla que un agente nuevo rompe sin saber que existe.

### Mutaciones — 7, con autocomprobación, y las 7 murieron

El arnés aborta si el texto a sustituir no aparece **exactamente una vez**, aborta si vitest no
emite su línea de resultados (sin ella un «rojo» sería una invención) y **restaura releyendo el
archivo y comparando byte a byte**. Las cuatro primeras son las obligatorias del encargo.

| # | mutación | resultado |
| --- | --- | --- |
| **M1** | `SaldoTiendaCard` **recorta el saldo negativo a cero** | **ROJO** — 3 fallos: «pinta el importe con su signo y sin recortarlo a cero», «conserva los CÉNTIMOS del negativo», el caso de los tres signos |
| **M2** | `SaldosTiendasTable` **le pone valor absoluto** al saldo | **ROJO** — 3 fallos, incluido «cada fila lleva su estado en palabras, y las tres son distintas» |
| **M3** | el negativo **se pinta como un ERROR** (alerta «Saldo insuficiente») | **ROJO** — «el negativo NO se presenta como un fallo: ni alerta, ni «saldo insuficiente»» |
| **M4** | **la wallet de la TIENDA deja de mostrar el cobro** (`filter` sobre la categoría) | **ROJO** — 3 fallos en `desglose-tienda-ledger.test.tsx` |
| **M5** | `cargosHint` vuelve a «Fletes, comisión e IVA» | **ROJO** — 4 fallos en 2 archivos |
| **M6** | el diálogo **cuela `tipo` y `categoria`** en el payload del cobro | **ROJO** — 2 fallos (el `.strict()` del borde lo rechazaría en producción) |
| **M7** | el catálogo caído **deja de bloquear** el cobro (R6) | **ROJO** — los 2 casos de R6 |

Tras la última restauración, `git status` no muestra ninguno de los cuatro archivos mutados y el
`typecheck` de control quedó verde.

### Mirar la app — hecho, con cifras

Servidor propio (`pnpm dev --port 3131`, log propio, `.next` propio del worktree; se mató y se
borró `.next` al terminar). Conducida con Playwright. Base local: **UNA sola tienda**, «Tania»
(`tienda.qa@ordenex.test`), con 15 movimientos.

| momento | dato medido |
| --- | --- |
| antes | créditos `152900.00`, débitos `26387.21` → disponible **+₡126.512,79** |
| se cobra | **₡150.000,00**, motivo «Material de despacho entregado en bodega», desde `/wallet` |
| aviso en pantalla | `Cobro registrado. El saldo de Tania Tienda queda en -₡23.487,21 · En contra.` |
| `/wallet/tiendas`, fila | `Tania · -₡23.487,21 · En contra` |
| `/wallet/tiendas`, desglose | «A favor de la tienda ₡152.900» · «Cargos de Ordenex **₡176.387,21**» · «Pagado ₡0» · «Saldo a favor **-₡23.487,21**» + «En contra» |
| `/wallet/tiendas`, libro | `2026-09-08 · Débito · Cobro de Ordenex · ₡150.000 · Manual · Material de despacho entregado en bodega` |
| pagar | botón «Registrar pago» **deshabilitado** + «Esta tienda no tiene saldo a favor: no hay nada que pagar.» |
| `/mi-wallet` (entrando **como la tienda**) | tarjeta: `Saldo a favor / En contra / **-₡23.487,21**`; «Cargos de Ordenex ₡176.387,21 — **Fletes, comisión, IVA y cobros de Ordenex**»; y la fila `2026-09-08 · Débito · Cobro de Ordenex · ₡150.000 · Manual · …` |
| la caja de Ordenex | «Cobro de Ordenex» **no aparece** en el libro de `/wallet`, y `wallet_movimiento` sigue con **22 filas**, las mismas que antes (R24 contra datos reales) |
| el rastro | UNA fila `cobro_tienda_registrado`, entidad `wallet_tienda_movimiento`, etiqueta `Tania`, monto `150000.00`, actor `Ana Admin` — **sin la descripción tecleada** (R43) |

**La aritmética cierra exacta:** `126.512,79 − 150.000,00 = −23.487,21`, y
`26.387,21 + 150.000,00 = 176.387,21`. Las tres superficies enseñan **el mismo importe con el
mismo signo**.

**Datos restaurados:** se borraron la fila del cobro y su fila de historial; la tienda vuelve a
15 movimientos y a `152900.00 / 26387.21`, y la caja sigue en 22 filas. Comprobado tras el
borrado, no supuesto.

---

## Lo que hay que mirar

1. **La Q1 sigue sin firmar** (arriba, en las decisiones). Si el humano cambia el rótulo del
   selector, son dos líneas del mismo archivo; si cambia el del libro, una; si cambia el valor de
   enum, una migración.
2. **El aviso de éxito nombra la tienda con el nombre del CATÁLOGO**, que en la base local es
   «Tania Tienda», mientras la tabla de saldos la llama «Tania». Son dos composiciones distintas
   del nombre que ya existían antes de esta ficha (`listarAdminTiendas` vs
   `SaldoTiendaResumenDTO`); no se unifican aquí porque tocaría servidor y no es de esta ficha.
   Se deja anotado para que no se descubra como una sorpresa.
3. **La cabecera de `/wallet/tiendas` sigue diciendo «Fletes, comisión e IVA».** R37 pide la
   aclaración de la wallet **de la tienda**, y son dos objetos de textos distintos a propósito
   (uno habla de la tienda en tercera persona). Ampliar también la del admin sería un cambio que
   nadie pidió; queda dicho por si se quiere en otra ficha.
4. **Un cobro sigue sin poder deshacerse** (C1 del spec, decisión D3 del humano). La descripción
   del diálogo lo dice antes de pulsar, que es lo único que esta pantalla puede hacer al respecto.

---

## Veredicto

La pantalla de la 381 está completa y verde: un quinto concepto que cobra a una tienda sin tocar
la caja, un negativo que se ve entero en las dos vistas con su signo y su marca, y siete
mutaciones —incluidas las cuatro firmadas— que mueren. Visto en la app con cifras que cierran.
