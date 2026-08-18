# Feature 230 — El dinero se pinta sin céntimos · requirements.md

> **Qué pidió el humano, literal:** «los números tienen este formato 0.000,00 esos dos decimales
> después de la coma están haciendo mucho ruido, entonces quiero que saneemos todos los números de
> la app para que no tengan esas centésimas».
>
> Notación EARS (`docs/specs.md`). Cada requisito lleva su cláusula **Testeable**: si no se puede
> escribir un test para ella, el requisito está mal escrito. El mapa `R<n> → test` vive en
> `tasks.md` §Trazabilidad.

---

## D — Decisiones YA FIRMADAS por el humano (no se reabren)

| # | Decisión | Consecuencia |
| --- | --- | --- |
| **D1** | **Redondear, no truncar.** Half away from zero (el medio se aleja del cero). | `1.234,56 → 1.235`; `1.234,49 → 1.234`; `-4.500,50 → -4.501` |
| **D2** | **Solo dinero.** Los porcentajes (`84,2 %`) y las duraciones (`1,5 h`) de analítica son **décimas, no centésimas**: se quedan **exactamente** como están. | Es un **no-objetivo explícito**, no un olvido. Ver R15 |

Estas dos no son propuestas del spec: llegaron firmadas. Ningún requisito de abajo las matiza.

---

## §1 Alcance

**Dentro:** la **presentación** de importes monetarios en toda la app — pantallas, tablas,
tarjetas, KPI y etiquetas.

**Fuera (declarado en voz alta, no omitido):**

1. El **dato**. La columna sigue siendo `DECIMAL(12,2)` y el importe sigue cruzando la frontera
   servidor→cliente como string de escala 2 (R17).
2. Las **descargas** XLSX/CSV: la contabilidad conserva los céntimos (R16).
3. Los **formularios**: se sigue pudiendo **escribir** un importe con céntimos, se guarda exacto y
   se muestra redondeado. Prohibir escribirlos cambiaría el **dato**, no la presentación (Q2).
4. Los valores **no monetarios** de analítica: porcentaje, duración y conteo (D2, R15).

---

## §2 Requisitos

### Grupo A — El redondeo

**R1.** El sistema DEBE pintar todo importe monetario **sin parte decimal**: cero dígitos después
del separador decimal configurado.
**Testeable:** para un corpus de importes con forma decimal, ninguna salida de ningún camino de
formateo de dinero contiene el separador decimal seguido de un dígito.

**R2.** CUANDO un importe con parte decimal se formatea para mostrarse, el sistema DEBE redondearlo
al entero más próximo, resolviendo el medio **alejándose del cero** (`half away from zero`).
**Testeable:** `1234.56 → ₡1.235`; `1234.49 → ₡1.234`; `1234.50 → ₡1.235`; `-4500.50 → -₡4.501`;
`-1234.49 → -₡1.234`; `0.50 → ₡1`; `-0.50 → -₡1`.

**R3.** SI el redondeo produce un acarreo que **aumenta el número de dígitos** de la parte entera,
ENTONCES el sistema DEBE reagrupar los miles del resultado.
**Testeable:** `999.50 → ₡1.000`; `9.99 → ₡10`; `999999.99 → ₡1.000.000`; `99.99 → ₡100`;
`-999.50 → -₡1.000`.

**R4.** SI el importe es negativo y su redondeo da cero, ENTONCES el sistema DEBE pintar el cero
**sin signo**.
**Testeable:** `-0.49 → ₡0` (y NO `-₡0`); `-0.00 → ₡0`; `-0.4 → ₡0`. Ninguna salida del formateador
empieza por el signo seguido de un cero solo.

**R5.** SI el importe llega **sin parte decimal**, ENTONCES el sistema DEBE pintarlo como hoy:
agrupado por miles, con el símbolo delante, sin inventar ni alterar dígitos.
**Testeable:** `"320" → ₡320`; `"1234567" → ₡1.234.567`; `"0" → ₡0`; `"999" → ₡999`;
`"1000" → ₡1.000`; y ninguna salida empieza por el separador de miles.

**R6.** SI el importe trae **más de dos** dígitos decimales, ENTONCES el sistema DEBE decidir el
redondeo por el **primer** dígito decimal (≥5 sube, <5 baja) e ignorar el resto.
**Testeable:** `"10.4999" → ₡10`; `"10.5001" → ₡11`; `"10.500" → ₡11`; `"10.4" → ₡10`.

**R7.** MIENTRAS formatea un importe, el sistema NO DEBE convertirlo a `number`: el redondeo, el
acarreo y la agrupación operan sobre el **string**.
**Testeable:** (a) el barrido money-safe sobre `lib/config/moneda.ts` no encuentra `Number(`,
`parseFloat(` ni `parseInt(` —con su contraprueba, para que el barrido no pase por no mirar nada—;
(b) un importe que **no cabe exacto en un `number`** se redondea exacto:
`"12345678901.99" → ₡12.345.678.902`; `"99999999999.51" → ₡100.000.000.000`;
`"99999999999.49" → ₡99.999.999.999`.

**R8.** SI el texto recibido **no tiene forma de importe decimal**, ENTONCES el sistema DEBE
pintarlo **verbatim** detrás del símbolo, como hoy: ni lo redondea, ni lo agrupa, ni lo esconde tras
el marcador de ausencia.
**Testeable:** `"1.2.3" → ₡1.2.3`, y el resultado no es el marcador de ausencia.

**R9.** SI no hay importe (`null`, cadena vacía o en blanco), ENTONCES el sistema DEBE devolver el
marcador de ausencia que corresponda, sin cambios respecto de hoy.
**Testeable:** `null → "-"` por defecto; `null` con el marcador de raya larga → `"—"`; `""` y
`"   "` se comportan igual que `null`; los dos marcadores siguen siendo distintos entre sí.

**R10.** CUANDO el importe redondeado es negativo, el sistema DEBE poner el signo **delante** del
símbolo de moneda.
**Testeable:** `-4500.50 → -₡4.501`, y ninguna salida contiene el símbolo seguido del signo.

**R11.** El sistema DEBE seguir resolviendo el símbolo y el separador de miles **por configuración**,
no escritos en el código (`docs/architecture.md`, «sin hardcode de contexto»).
**Testeable:** recargando el módulo con otra configuración, `13331832.72` se pinta con el otro
símbolo y el otro separador de miles, y sin decimales.

### Grupo B — Alcance: todo el dinero, y solo el dinero

**R12.** El sistema DEBE producir el **mismo** aspecto sin decimales por **todos** los caminos de
presentación de dinero, sin que sus consumidores cambien.
**Testeable:** para el mismo importe, el helper de string, el helper numérico, el `money()` de las
pantallas de dinero, la etiqueta de precio y el formateo de analítica en unidad moneda devuelven la
misma cadena, y ninguna lleva decimales.

**R13.** CUANDO la tabla del resumen de carga de órdenes pinta el monto a cobrar, el sistema DEBE
formatearlo por el formateador compartido —símbolo, agrupación de miles y sin decimales—, no con una
serialización cruda.
**Testeable:** renderizada con un monto de `1234.56`, la celda muestra `₡1.235` y no `1234.56`; con
monto ausente sigue mostrando su marcador actual.

**R14.** DONDE un KPI animado esté en modo moneda, el sistema DEBE animar con **cero** decimales.
**Testeable:** el contador en modo moneda recibe `0` decimales y su texto —inicial, intermedio y
final— nunca contiene el separador decimal seguido de un dígito; el modo **no** moneda no cambia.

**R15.** El sistema DEBE conservar **sin cambio alguno** el formato de los valores **no monetarios**
de analítica: porcentaje, duración y conteo.
**Testeable:** el porcentaje de `0,842` y la duración de `5400` segundos siguen mostrando su dígito
decimal, comparados contra el mismo `Intl` que los produce hoy (no contra un literal inventado).

**R16.** El sistema DEBE seguir emitiendo los importes de las **descargas** (XLSX/CSV: datasets y
manifiesto) con su escala original, sin pasar por el formateador de presentación.
**Testeable:** una guardia comprueba que los módulos de descarga no importan el módulo de moneda ni
nombran sus funciones de formato; contraprueba: un fuente con ese import la pone roja.

**R17.** El sistema DEBE dejar intactos el almacenamiento y la frontera: sin migración, sin cambio
de esquema y sin cambio en la escala de los DTO.
**Testeable:** el diff de la feature no contiene ninguna migración ni ningún cambio en
`db/schema.prisma`; los tests de servicios y repositorios que afirman importes de escala 2 en el DTO
siguen pasando **sin tocarlos**.

**R18.** El sistema DEBE describir el formato **vigente** en la documentación de los módulos y
componentes de dinero: ningún docstring puede seguir prometiendo dos decimales ni justificando los
ceros finales.
**Testeable:** una guardia comprueba que los fuentes de la superficie de dinero no contienen en su
prosa la promesa de decimales (patrón de ejemplo con dos dígitos tras la coma) ni la frase de
«siempre dos decimales».

### Grupo C — Que no se deshaga

**R19.** El sistema DEBE incluir una **guardia automática** que falle si (a) algún camino de
presentación de dinero emite el separador decimal seguido de dos dígitos, o (b) algún componente de
`app/**` o `components/**` serializa un importe **saltándose** el formateador compartido.
**Testeable:** la guardia se prueba **mordiendo**: con el código anterior de la celda del resumen de
carga (`row.montoCobrar.toFixed(2)`) y con un formateador de mentira que conserva los céntimos, la
guardia se pone **roja**; con el código bueno, verde.

**R20.** CUANDO una pantalla muestre a la vez una columna de importes redondeados y su total, el
sistema DEBE mostrar como total el **redondeo del total real**, no la suma de los redondeos.
**Testeable:** con un conjunto de importes cuya suma de redondeos difiere del redondeo de la suma
(p. ej. `0.50 + 0.50 + 0.50`), el total mostrado es el del importe real redondeado.

---

## §3 Consecuencias aceptadas (declaradas, no descubiertas después)

- **A1 — Una columna puede no cuadrar a ojo con su total, por ±1 o ±2.** Es consecuencia directa de
  R20 y el humano ya la aceptó. No es un bug ni se «arregla» sumando los redondeos.
- **A2 — Se dejan de ver los céntimos que la base sí guarda.** Un saldo de `₡1.234,49` se pinta
  `₡1.234`. El dato exacto sigue en la base y en las descargas (R16, R17).
- **A3 — Cambio visible en todas las pantallas de dinero a la vez.** No hay migración gradual ni
  interruptor: el punto de paso es único.

---

## §4 Preguntas abiertas — para la puerta humana

> **PUERTA PASADA EL 2026-08-18.** Las tres se respondieron; las respuestas quedan escritas aqui,
> que es donde T0.1 las pide, y no solo en la ficha. Los enunciados originales se conservan intactos
> debajo: lo que se decidio solo se entiende junto a lo que se preguntaba.
>
> | | Respuesta del humano | Consecuencia aplicada |
> | --- | --- | --- |
> | **Q1** | **(b) Conservar `separadorDecimal`, con oficio nuevo.** | Deja de ser «el separador que se pinta» y pasa a ser «el caracter que la guardia vigila», documentado asi. Se descarto (a) porque retirarlo obligaba a la guardia a escribir la coma **a mano**, que es el hardcode de contexto que `docs/architecture.md` prohibe. |
> | **Q2** | **NO se confirma la frontera: el humano quiere que los centimos tampoco se puedan escribir.** | **Pero no aqui.** Eso toca el DATO, no la presentacion, y sale en **ficha 232**. Esta feature sigue siendo solo presentacion, asi que §1 no cambia: los formularios siguen aceptando centimos **hasta que la 232 entre**. |
> | **Q3** | **Aceptadas** las cuatro contradicciones (C1–C4) con la resolucion que propone el design. | Sin cambios en el alcance. |
>
> **Lo que la respuesta a Q2 hizo aparecer, y no estaba en este spec:** al medirlo contra produccion
> antes de decidir, los centimos resultaron estar **en el dato**, no solo en la pantalla —
> `orden.monto_cobrar` 34 de 139 (24 %), `wallet_movimiento.monto` 20 de 82,
> `wallet_tienda_movimiento.monto` 17 de 70 — y **cero** en todo lo que se teclea a mano. Con eso
> delante, el humano eligio cubrir **los tres grupos** (teclado, carga masiva y **aritmetica**) en la
> 232. Esta feature no toca ninguno de los tres.

> No se deciden aquí. Cada una lleva su medición y el coste de cada opción.

### Q1 — ¿Qué se hace con `separadorDecimal`, que se queda sin consumidores?

**Medido:** `MONEDA_SEPARADOR_DECIMAL` / `monedaConfig.separadorDecimal` se usa en **una sola línea
de producción**, `lib/config/moneda.ts:116` — justo la que muere con esta feature. Los otros dos usos
del repo están en tests (`tests/unit/config/moneda-formato.test.ts:187` y `:206`).

| Opción | Coste | Efecto lateral |
| --- | --- | --- |
| **(a) Retirarlo** del `MonedaConfig` y de la variable de entorno | Mueren las aserciones de `:187` y `:206`; el test «con otra configuración cambian el símbolo y **LOS DOS** separadores» pasa a hablar de uno solo | La guardia de R19 necesita otra forma de nombrar «el separador decimal»: pasaría a ser un literal del test, no configuración. **Se pierde el punto único de configuración del carácter que la guardia vigila** |
| **(b) Conservarlo** como configuración viva que ya no gobierna nada | Cero cambios de tests de configuración; el campo queda documentado como «lo que la guardia prohíbe emitir» | Un campo de configuración sin efecto sobre la salida es una mentira en potencia: alguien lo cambiará esperando ver algo |

**El spec necesita la respuesta para escribir T1.4 y la guardia.** Si no llega, se implementa **(b)**
por ser la reversible, y se marca como deuda declarada.

### Q2 — Los formularios siguen aceptando céntimos: ¿se confirma como frontera?

Hoy se puede **escribir** `1.234,56`, se guarda exacto y se mostrará `₡1.235`. Prohibir escribirlos
cambia el **dato**, no la presentación, y por eso está fuera de alcance aquí (§1).
**Se pide confirmación explícita.** Si el humano lo quiere, es **ficha aparte**: toca validación de
entrada, mensajes de error y posiblemente datos ya guardados.

### Q3 — ¿Se acepta la lista de contradicciones de §5 tal como está resuelta?

Las cuatro se nombran abajo con la resolución que propone el design. Ninguna se ha resuelto en
silencio; las cuatro pueden reabrirse en la puerta.

---

## §5 Contradicciones detectadas entre lo pedido y lo que hace el código

**C1 — «Nunca se convierte a número» es cierto del formateador, no de la app.**
`components/shared/PriceLabel.tsx:40` y `components/shared/KpiValorAnimado.tsx:95` llaman a
`toValidNumber`, que hace `Number(trimmed)` (`lib/utils/number.ts:10`). Es decir: por esos dos
caminos el importe **ya pasa hoy por un `double`** antes de llegar al formateador, y el redondeo
sobre string será exacto respecto del número que llegó, no necesariamente respecto del dato de la
base. Es **preexistente** (no lo introduce la 230) y queda **fuera de alcance**; se nombra para que
nadie lea R7 como una afirmación sobre la app entera.

**C2 — La rama verbatim (R8) puede producir justo lo que la guardia (R19) prohíbe.**
Si el servidor mandara `"1,50"` —que no tiene forma de decimal—, hoy se pinta `₡1,50` tal cual: una
coma seguida de dos dígitos. **Resolución propuesta:** el diente de comportamiento de la guardia
muerde sobre importes **con forma decimal**, y la excepción de la rama verbatim se deja escrita en
un test propio, en vez de descubrirse como un rojo inexplicable. Ver `design.md` §6.

**C3 — Doble redondeo en el camino numérico.**
`formatMonto(number)` serializa con `toFixed(2)` y **después** se redondeará el string. Para un
número con más de dos decimales eso puede diferir en 1 unidad del redondeo directo (p. ej.
`1234.4951`: `toFixed(2)` da `"1234.50"` y sube a `1235`; el redondeo directo daría `1234`). Solo
ocurre con entradas que ya están **fuera del contrato de escala 2**. `design.md` §7/A3 explica por
qué se conserva `toFixed(2)` y `tasks.md` fija el comportamiento elegido con un test, para que la
diferencia sea una decisión y no una sorpresa.

**C4 — Dos docstrings quedarían mintiendo, y uno pierde su razón de ser.**
`PriceLabel` promete «SIEMPRE dos decimales (`₡1.234,50`, `₡0,00`)» y su punto 3 justifica los ceros
finales por la alineación de la coma en una columna `tabular-nums` — una justificación que
**desaparece** cuando todas las filas son enteras. Y `formatMonto` documenta que su `toFixed(2)` «es
lo que hace que un importe entero se pinte `₡320,00` y no `₡320`»: tras la 230 los dos caminos dan
`₡320` y esa asimetría deja de existir. R18 lo cubre.
