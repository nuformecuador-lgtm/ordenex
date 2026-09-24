# Verificación adversaria — hallazgos de dinero en la caja (F1, F2, F3)

- Fecha: 2026-09-24. Rama base: `origin/dev` en `aed2541b`. Solo lectura (ningún cambio de código).
- Búsqueda: MCP `codebase-memory` (proyecto `R-job-singularis-projects-ordenex`) para localizar
  escritores; cada símbolo confirmado en el archivo real con las líneas citadas abajo.
- Datos de producción: los medidos por el leader (dados por ciertos en el encargo). No se consultó
  producción desde aquí.

## Veredicto

| Hallazgo | Veredicto |
| --- | --- |
| F1: faltan salidas de caja (cobro_manual no escribe en la caja) | **CONFIRMADO** (con un punto ABIERTO: posible doble registro de sueldos, ver F3) |
| F2: doble conteo del dinero de Ordenex en «Dinero en caja» y «De terceros» | **CONFIRMADO** |
| F3: corregidas F1 y F2, la caja da −9.186.220,50, luego falta saldo inicial o entradas | **PARCIAL**: aritmética exacta, pero «falta saldo inicial» no es la única explicación; dos ajustes no medidos |

---

## F1 — `cobro_manual` no toca la caja

Intenté refutarlo por la vía (d) —un feed, un cron, la aprobación de un cierre, un trigger— y no
encontré ninguna:

- `lib/services/CobroTiendaService.ts:120-133` escribe UNA fila `debito/cobro_manual` en el libro de
  la tienda; `:135-140` su historial. El constructor (`:67-71`) no recibe ningún repositorio de caja:
  no puede escribir en `wallet_movimiento` aunque quisiera. Comentario `:49-51`; decisión D1 y R24 en
  `specs/381-cargo-manual-a-tienda/requirements.md:27` y `:174`.
- Todos los escritores de `wallet_movimiento` (grafo + búsqueda de `crearMovimientos`):
  `CierresAdminRepository.ts:1867,1899,1915,1927`, `CajaPagoTiendaFeedService.ts:40,65`,
  `CajaPremioRankingFeedService.ts:43,67`, `CajaBackfillTesoreriaService.ts:92`,
  `RechazoTiendaCobroService.ts:199`, `IncidenteAdminRepository.ts:358`,
  `GeneracionGastosFijosService.ts:132`, `GastoFijoCobroService.ts:122`,
  `WalletMovimientoRepository.ts:142` (manual y egresos). Ninguno lee `cobro_manual`.
- `cobro_manual` solo aparece en `CobroTiendaService`, tipos, etiquetas, `metrics.ts`,
  `aporte-por-orden.ts`, `desglose-tienda.ts` y dos migraciones de enum y CHECK. En `db/migrations`
  no hay ninguna función ni trigger sobre tablas de dinero, ni inserciones SQL en la caja.

Consecuencia: con la confirmación del humano (el dinero salió de Ordenex), faltan 25.769.034,50 de
salidas en la caja. Son salidas **de terceros** (gastos de Nuform cargados a su saldo): bajan
«Dinero en caja» y «De terceros» y **no** tocan la ganancia.

---

## F2 — doble conteo

### Cómo se forma (verificado en código)

Al aprobar un cierre, en la MISMA transacción:

1. `CierresAdminRepository.ts:1866-1867` llama a `WalletFeedService.ts:95-104`: flete, comisión e
   IVAs entran en la caja como **ingresos propios** (origen `cierre_dia`).
2. `CierresAdminRepository.ts:1870-1874` llama a `WalletTiendaFeedService.ts:132-135`: la tienda
   recibe crédito `cod_recaudado` = `montoRecibido` completo; en `:140-161` se le **debitan** los
   mismos conceptos con la misma función (`derivarIngresoOrden`).
3. `CierresAdminRepository.ts:1890-1899` llama a `CajaCodFeedService.ts:37-74`: la caja recibe
   `ingreso_cod_recaudado` = **el crédito completo** (lee solo `tipo: "credito"`, `:41-42`; el
   comentario `:35-36` dice que los débitos son «lo que Ordenex SE QUEDA»). **No se emite ningún
   asiento que reste de terceros esos débitos.**
4. `derivarCaja` (`lib/utils/caja-tesoreria.ts:202-232`) suma todas las entradas (`:112-115`) sin
   neteo; `enCaja = entradas − salidas` (`:208`). La clasificación (`:62-83`) pone los cargos en
   «propio» y el COD en «terceros».

### Refutaciones buscadas y descartadas

- **(a) ¿Hay un asiento que traslade los cargos de terceros a Ordenex?** No. Las únicas categorías
  de terceros son `ingreso_cod_recaudado`, `egreso_pago_tienda` e `ingreso_reverso_pago_tienda`
  (`caja-tesoreria.ts:80-82`). `egreso_pago_tienda` se emite por el importe pagado
  (`LiquidacionService.ts:682-688`, vía `CajaPagoTiendaFeedService.ts:40-51`), y ese pago está
  **topado en el saldo neto** de la tienda, créditos menos débitos (`LiquidacionService.ts:632-642`).
  Por construcción, liquidando a todas las tiendas al 100 %, «De terceros» se queda en la suma de
  los cargos y nunca llega a 0. Los cargos no se descuentan del COD en la caja en ningún momento.
- **(b) ¿La tienda paga el flete aparte, con dinero real?** No hay vía:
  - El libro de la tienda no tiene categoría de abono de la tienda salvo `ajuste_credito`
    (`lib/types/wallet-tienda.ts:34-55`). La 457 («la tienda le paga a Ordenex») está `pending`,
    solo spec. En producción la suma de saldos cuadra al céntimo sin ajustes ni pagos:
    29.059.224,00 − 8.070.773,47 − 25.769.034,50 = **−4.780.583,97** =
    −6.170.666,55 + 197.471,25 + 295.984,75 + 896.626,58. No entró ningún dinero de tiendas.
  - El flete se cobra en toda entrega **con o sin COD** (`lib/utils/ingreso-ordenex.ts:158-164`;
    la comisión solo si `cobraComision`, `:166-174`); una prepagada (`monto_cobrar` nulo) recauda 0
    y genera flete igual (`ingreso-ordenex.ts:671-672`). El flete de devolución nace de una
    **rechazada**, donde no se cobra nada (`:182-188`). En esos casos el ingreso propio no es
    efectivo ni dentro ni fuera del COD: es una **cuenta por cobrar** neteada contra el saldo de la
    tienda.
  - **Feature 337** (`RechazoTiendaCobroService.ts:196-206` y `:256-315`): escribe
    `ingreso_flete_devolucion` + IVA en la caja (origen `gestion_orden`) y el débito espejo en el
    libro de la tienda. **No entra efectivo de ningún sitio**: el paquete volvió rechazado y el
    cobro se hace reduciendo el saldo de la tienda. Mismo patrón que el caso general.
  - El interruptor Q3 (`TIENDA_DEBITA_FLETE_DEVOLUCION`) no cambia la conclusión: los débitos de
    producción (8.070.773,47) igualan los ingresos propios, así que estaba encendido.
- **(c) ¿El diseño dice que «Dinero en caja» no es efectivo?** Solo en parte. El glosario de la 173
  lo define como «Σ de todo lo que entró − Σ de todo lo que salió, sin distinguir de quién es»
  (`specs/173-caja-tesoreria/requirements.md`, Glosario), y su P2 acepta que el egreso del mensajero
  es devengo (y dice que eso equivoca la cifra **por lo bajo**). **Ningún documento** dice que los
  ingresos propios del cierre sean un devengo contado aparte del COD. La pista en pantalla dice
  «Todo lo que entró y salió, incluido el dinero de las tiendas»
  (`app/(app)/wallet/_components/wallet-labels.ts:86-88`): se lee como saldo. El aviso
  `CAJA_RESUMEN_AVISO_TERCEROS` (`wallet-labels.ts:123-126`) admite que «De terceros» es mayor que
  la deuda «porque Ordenex todavía descuenta el flete…»: los cargos están dentro de «De terceros» Y
  dentro de «Ganancia», y `enCaja = G + T` los cuenta dos veces (la barra de `derivarReparto`,
  `caja-tesoreria.ts:157-177`, lo reparte así). La 458 ya lo describe
  (`specs/458-rediseno-wallet/design.md` §1.8) y lo dejó fuera de alcance (su P10).
- **(e) ¿El efectivo real está en otro sitio?** El SINPE llega a una cuenta de Ordenex (una por
  bodega, `specs/429-sinpe-por-bodega/requirements.md:40`; `lib/repositories/SaldosSatelitesRepository.ts:24`)
  y el efectivo de las satélites puede estar en tránsito (431). Eso cambia **dónde** está el
  dinero, no **cuánto**: ninguno de esos caminos escribe en la caja y lo recibido sigue siendo
  29.059.224,00.

### (f) Cifras

| Cifra | Muestra hoy la app | Debería mostrar (solo F2) | Con F1 y F2 |
| --- | --- | --- | --- |
| Dinero en caja | 29.059.224,00 + 8.070.773,47 − 12.476.410,00 = **24.653.587,47** | 29.059.224,00 − 12.476.410,00 = **16.582.814,00** | 16.582.814,00 − 25.769.034,50 = **−9.186.220,50** |
| Ganancia de Ordenex | 8.070.773,47 − 12.476.410,00 = **−4.405.636,53** | **−4.405.636,53** (no cambia: correcta como devengo) | **−4.405.636,53** |
| De terceros | **29.059.224,00** | 29.059.224,00 − 8.070.773,47 = **20.988.450,53** | 20.988.450,53 − 25.769.034,50 = **−4.780.583,97** |
| Modo de la barra | `solo_tiendas` (G<0, T>0) | `solo_tiendas` | `sin_reparto` (G≤0, T≤0) |

Comprobaciones: en las tres columnas «Dinero en caja» = Ganancia + De terceros
(−4.405.636,53 + 20.988.450,53 = 16.582.814,00; −4.405.636,53 − 4.780.583,97 = −9.186.220,50).
La última «De terceros» coincide al céntimo con la suma de saldos de tiendas medida en producción,
que es una cifra independiente y la valida. El sobrante de hoy, 24.653.587,47 − 16.582.814,00 =
**8.070.773,47**, es exactamente la suma de los ingresos propios.

---

## F3 — caja negativa tras corregir

**La aritmética es correcta** (29.059.224,00 − 12.476.410,00 − 25.769.034,50 = −9.186.220,50) y un
saldo de efectivo negativo es imposible. Pero «falta saldo inicial o entradas» no es la única
explicación compatible con el código; hay dos factores que la reducirían y que **no pude medir**:

1. **ABIERTO — el egreso del mensajero es devengo.** `lib/services/WalletMensajeroFeedService.ts:11-22`
   carga `egreso_pago_mensajero = P` completo al aprobar; en ese momento solo sale `min(P, E)` y el
   resto se paga al liquidar sin tocar la caja (P2 de la 173). Si hay cuenta por pagar a
   mensajeros pendiente, el efectivo real es mayor en ese importe. Cota: aun con los 3.439.700
   enteros pendientes la caja seguiría en −5.746.520,50. No cambia el signo.
2. **ABIERTO — posible doble registro de sueldos.** `egreso_sueldo` (8.871.709) es un egreso manual
   con descripción libre (`lib/types/wallet.ts:529-534`, `lib/services/WalletEgresoService.ts:48`),
   y muchos de los 203 cobros de Nuform son «PAGO SALARIO…». Si algún salario del personal de Nuform
   se registró **también** como `egreso_sueldo` en la caja, F1 sería menor en ese importe y F3
   exageraría el agujero. Consulta que lo decide (solo lectura, producción): cruzar las filas
   `wallet_movimiento` con `categoria = 'egreso_sueldo'` (fecha, monto, descripción) contra las
   `wallet_tienda_movimiento` `cobro_manual` de Nuform con descripción que empiece por «pago salario»,
   por (fecha, monto).

Sin saldo inicial registrado (producción se vació el 2026-08-25 y no hay `ingreso_ajuste`), la caja
no puede explicar dinero anterior a esa fecha: eso **sí** es coherente con F3, pero el tamaño
exacto del hueco depende de los dos puntos abiertos.

---

## Lo que NO se pudo confirmar

- Importe pendiente de pago a mensajeros: ABIERTO (F3, punto 1).
- Si algún `egreso_sueldo` duplica un cobro «PAGO SALARIO» de Nuform: ABIERTO (F3, punto 2).
- Que los 203 pagos salieran de la plata de Ordenex se toma como dato (lo confirmó el humano).

## Cierre de los ABIERTOS (leader, producción solo lectura, 2026-09-24)

- **ABIERTO 2 — CERRADO, no hay doble registro.** El cruce por monto y ±3 días entre `egreso_sueldo` y los
  `cobro_manual` de Nuform da 6 coincidencias, todas de personas o conceptos distintos con el mismo importe:
  «PAGO SALARIO MARIALE ORDENEX» vs «PAGO SALARIO LEIDY NUFORM» (113.894, dos veces), la comisión bancaria
  fija de 1.371 (Cinthya vs Gerlin/Daniela) y 200.000 de «AVANCE LIQUIDACION MÓNICA» vs «ALQUILER CASA
  LABORATORIO»/«ALQUILER BODEGA». F1 se mantiene en 25.769.034,50.
- **ABIERTO 1 — CERRADO, efecto despreciable.** `pago_mensajero_movimiento`: devengado 3.439.700 (152) y
  pagado en efectivo 3.432.300 (149). Solo 7.400 siguen pendientes con los mensajeros: la caja corregida
  seria −9.178.820,50 en el mejor caso.
- **F3 queda así:** con F1 y F2 corregidos la caja registrada es ≈ −9,18 M. Como el efectivo real no puede
  ser negativo, faltan ENTRADAS que la app no registra (saldo inicial al vaciarse producción el 2026-08-25,
  capital aportado u otros ingresos). Se valida con el saldo real que dé el humano.
