# Feature 230 — El dinero se pinta sin céntimos · impl_230.md

> **Qué es este archivo.** El registro único que piden `CHECKPOINTS.md` §Trazabilidad y **T6.2**:
> el mapa `R<n> → test` de los **20** requisitos, con el **nombre del test ejecutado**, y las
> consecuencias/contradicciones ya aceptadas (**T0.2**). Se escribe porque el review (B3) midió
> que R13, R14 y R20 no estaban mapeados por escrito en ningún archivo del repo, pese a tener
> test real.
>
> El **detalle** de cada tanda vive en las bitácoras y no se duplica aquí:
> - `progress/impl_230_backend.md` — bloques 1–3 (`lib/config/moneda.ts`, el contrato y la guardia).
> - `progress/impl_230_frontend.md` — bloques 4–5 (los 3 archivos de UI y las 234 líneas de test),
>   más el cierre de B1 / m1 / m2 / B3 del review.
> - `progress/review_230.md` — la revisión independiente.

---

## 1. Mapa `R<n> → test` — los 20, con el test NOMBRADO

Todos ejecutados y verdes en el árbol actual. La columna «muere con» nombra la mutación **real y
ejecutada** que lo pone rojo (M· = backend, F· = frontend; su salida está en cada bitácora): un
requisito cuyo test no muere con ninguna mutación no está probado.

| R | Qué afirma | Test ejecutado (archivo → nombre) | Muere con |
| --- | --- | --- | --- |
| **R1** | Ningún camino de dinero emite decimales | `dinero-sin-centimos.guardia` → «ninguna salida lleva el separador decimal seguido de un digito (R1, R12)» · `moneda-formato` → «ninguna salida con forma decimal lleva el separador decimal seguido de un digito (R1)» | M1 |
| **R2** | Redondeo half away from zero | `moneda-formato` → «el medio se aleja del cero, tambien en negativo (R2, D1)» · «agrupa los miles y redondea la cola decimal en vez de pintarla» | M3, F5, F6 |
| **R3** | El acarreo que cambia de dígitos reagrupa | `moneda-formato` → «el acarreo que añade un digito REAGRUPA los miles (R3)» | M4, M6 |
| **R4** | El cero redondeado no lleva signo | `moneda-formato` → «el cero redondeado NO lleva signo (R4)» | M5 |
| **R5** | Un importe sin decimales se pinta igual que siempre | `moneda-formato` → «un importe sin parte decimal se pinta como siempre: ni inventa ni altera digitos (R5)» · «el separador de miles no se cuela delante del primer grupo» | M4 |
| **R6** | Con más de dos decimales manda el primero | `moneda-formato` → «con mas de dos decimales manda el PRIMERO, y el resto se ignora (R6)» | M3, F5 |
| **R7** | Sin `Number(`/`parseFloat(`/`parseInt(`; exacto con 11 dígitos | `moneda-formato` → «el modulo no llama a `Number(`, `parseFloat(` ni `parseInt(`» (con contraprueba) · «el redondeo de un importe que un `number` no puede representar es EXACTO» | M6 |
| **R8** | Lo que no tiene forma de decimal, verbatim | `moneda-formato` → «lo que no tiene forma de decimal se pinta tal cual, sin fingir que no hay monto» (**sin tocar**) · guardia diente 4 → «la rama VERBATIM queda FUERA del diente 1, y se dice por que (C2)» | — (rama declarada, C2) |
| **R9** | Ausencia → marcador, sin cambios | `moneda-formato` → «`null` usa el marcador por defecto del modulo» · «acepta OTRO marcador por parametro, y los dos que hay en pantalla son distintos» · «una cadena vacia o en blanco tambien es ausencia, no un simbolo suelto» (**los tres sin tocar**) | — |
| **R10** | El signo va delante del símbolo | `moneda-formato` → «el signo negativo va DELANTE del simbolo» · «el negativo lleva el signo delante del simbolo, igual que el de STRING» | M5 |
| **R11** | Símbolo y miles por configuración | `moneda-formato` → «con otra configuracion cambian el simbolo y el separador de MILES» · «cambiar el separador DECIMAL no altera ni un byte de la salida (Q1(b))» · «se puede agrupar con otro caracter (apostrofo) sin tocar codigo» | — |
| **R12** | Los cinco caminos dan lo mismo | `dinero-sin-centimos.guardia` → «los cinco caminos dan la MISMA cadena para el mismo importe (R12)» *(matiz m4 del review: `formatMonto` es `formatMontoString(n.toFixed(2))`, así que son cuatro medidas independientes, no cinco)* | M1 |
| **R13** | La celda del resumen de carga pasa por el formateador | `OrdenesCargaResumen.test.tsx` → describe «el monto lo formatea el módulo de moneda (230/R13)»: «con 1234.56 la celda muestra ₡1.235: símbolo, miles y SIN céntimos» · «el medio se aleja del cero, y no queda ni un dígito tras la coma» · «sin monto sigue mostrando el mismo marcador que pintaba a mano» | **F1** |
| **R14** | KPI animado en moneda: 0 decimales | `KpiValorAnimado.test.tsx` → describe «el dinero se anima sin centimos (230/R14)»: «en modo moneda el contador recibe 0 decimales, no 2» · «el modo NO moneda sigue en 0, como siempre» · «ningun fotograma —inicial, intermedio o final— lleva parte decimal» · «el texto final en moneda es el del formateador compartido, sin cola» | **F2**, F5 |
| **R15** | Porcentaje, duración y conteo intactos | `dinero-sin-centimos.guardia` → «el porcentaje conserva su decimal (R15, D2)» · «la duracion conserva su decimal (R15, D2)» · «el conteo sigue sin decimales, como siempre (R15)» (los tres contra el **mismo `Intl`** que los produce hoy) | «sanear» también la analítica |
| **R16** | Las descargas conservan los céntimos | `dinero-sin-centimos.guardia` → «los modulos de descarga existen y no importan el modulo de moneda» + «CONTRAPRUEBA: un fuente que SI lo importa es cazado» · `descarga/RankingHistoricoDescarga.test.tsx` → «R32: los valores viajan CRUDOS, sin el «%», sin el «₡» y sin el «—» de la pantalla» (`premio === "5000.00"`) | M7 |
| **R17** | Sin migración ni cambio de escala en el DTO | Diff sin `db/**`, sin `.sql` y sin `schema.prisma` (comprobado por el reviewer) · `tests/unit/services/**` y `tests/unit/repositories/**` **no tocados** · los 4 archivos de frontera declarados intactos corren verdes (136 tests): `TableroFinanciero`, `AnalyticsKpiCard`, `indemnizacion-tope-negocio-incidente`, `financiera-unidad-de-vistas.guardia` | — (por construcción) |
| **R18** | Ningún docstring promete decimales | `dinero-sin-centimos.guardia` → diente 5: «ningun fuente de la superficie de dinero promete decimales en su prosa» + «CONTRAPRUEBA: un docstring que promete decimales SI es cazado» + «los fuentes censados existen y TIENEN prosa que barrer» | **F3**, **F4** |
| **R19** | La guardia existe **y muerde** | (a) diente 1 + «CONTRAPRUEBA: un formateador que conserve los centimos SI es cazado»; (b) diente 2 → «ningun fuente de `app/**` ni `components/**` llama a `.toFixed(` sobre un importe (R19b)» + «CONTRAPRUEBA: el codigo VIEJO de la celda del resumen de carga es cazado, y el bueno no» + «un `.toFixed(2)` que vive en un COMENTARIO no pone la guardia roja» | **M1**, **F1** |
| **R20** | El total es el redondeo del total, no la suma de redondeos | `wallet-desglose-egresos-card.test.tsx` → «el total mostrado es el que llega del servidor (la tarjeta NO suma dinero)» (total `"999.99"` → `₡1.000` mientras las filas suman `₡1.251`) · anotado además en `CierreDiaModule.test.tsx` → «R7: el panel de totales muestra los 4 totales tal cual (sin reparsear)» y `CierresAdminModule.test.tsx` → «el detalle muestra el ingreso de Ordenex del cierre por concepto» | F5 |

**20 definidos · 20 mapeados · 0 huérfanos · 0 fantasmas.** El reviewer lo verificó de forma
independiente (`review_230.md` §2) y coincide.

**Matiz honesto sobre R20 (m3 del review):** de los tres puntos, solo el de
`wallet-desglose-egresos-card` **discrimina** —en los otros dos la suma de los redondeos coincide
con el redondeo de la suma, y los propios tests lo dicen—. Se sostiene, con menos margen del que
el testeable pedía.

---

## 2. Fuera del mapa: lo que cierra el review

| Hallazgo | Qué se hizo | Test que lo fija |
| --- | --- | --- |
| **B1** — el tope de indemnización anunciaba `₡10.000.000.000`, que el propio validador rechaza | `moneyTope()` en `cierre-detalle-shared.tsx`: un **máximo** se pinta redondeado **hacia ABAJO** (`₡9.999.999.999`), porque al alza deja de ser un límite. 4 textos migrados (`IncidentesAdminModule` ×2, `CierresAdminModule` ×2). **No** se tocó `INDEMNIZACION_MONTO_MAX` ni el validador: el contrato de datos es de la 232 | `IncidentesAdminModule.test.tsx` → «un monto por encima del TOPE se bloquea, y el mensaje dice QUÉ corregir» (ahora contra **literal**) · «el tope que ANUNCIA el mensaje es un monto que el validador ACEPTA» · «la ayuda del campo anuncia el MISMO tope que el error, y sin inflarlo» · `CierresAdminIndemnizacion.test.tsx` → las 3 aserciones del tope, contra literal |
| **m1** — sexta aserción caducada | `wallet-tiendas-desglose.test.tsx`: el caso «money-safe … con sus dos decimales» pasa a medir el **redondeo** con importes que discriminan (acarreo `999.99`, once dígitos `12345678901.99`), y la afirmación money-safe se muda al fuente | «los montos del servidor se pintan redondeados y agrupados, sin recalcular» · «el panel del desglose no convierte ningun monto a numero (money-safe)» |
| **m2** — prosa obsoleta | Comentarios de `IncidentesAdminModule.tsx` y `CierresAdminModule.tsx` reescritos: ya no citan el tope con céntimos y explican por qué un máximo no se redondea al alza | (prosa; cubierta por los tests de B1) |
| **B3** — registro | `tasks.md`: **30 de 34** marcadas; las 4 sin marcar llevan escrito por qué y de quién son. Y este archivo | — |
| **B2** — ver la app en pantalla (T6.3) | **PENDIENTE, del leader** | — |
| **m5** — `test:rapido` cortocircuita (C8) | **Ficha aparte**, no se cierra aquí (juicio del reviewer, compartido por los dos implementadores) | — |

---

## 3. Consecuencias y contradicciones YA ACEPTADAS (T0.2)

> Son **decisiones**, no pendientes. El reviewer no debe tratarlas como hallazgos, y no lo hizo
> (`review_230.md` §8).

**Aceptadas por el humano** (`requirements.md` §3):

- **A1** — Una columna de importes redondeados puede **no cuadrar a ojo con su total** por ±1 o ±2.
  Es consecuencia directa de R20 y ya estaba aceptada. **No se «arregla» sumando los redondeos.**
- **A2** — Se dejan de ver céntimos que la base sí guarda (`₡1.234,49` → `₡1.234`). El dato exacto
  sigue en la base y en las descargas (R16, R17). Su forma más incómoda quedó medida y escrita en
  los tests: una deuda real de `0.10` se lee `₡0` (`CierresAdminPagoMensajero`, `CajaResumenCard`,
  `IncidentesAdminModule`).
- **A3** — Cambio visible en **todas** las pantallas de dinero a la vez. No hay migración gradual
  ni interruptor: el punto de paso es único.

**Contradicciones del spec, resueltas** (`requirements.md` §5):

- **C1** — `PriceLabel` y `KpiValorAnimado` ya pasan hoy por un `double` vía `toValidNumber`.
  **Preexistente y fuera de alcance**: R7 afirma sobre el **formateador**, no sobre la app entera.
- **C2** — La rama verbatim (R8) puede emitir `₡1,50`. Escrita como test propio en el diente 4,
  **fuera** del diente 1, para que no aparezca como un rojo inexplicable.
- **C3** — Doble redondeo en el camino numérico (`1234.4951` → `₡1.235`). Solo ocurre **fuera** del
  contrato de escala 2; **fijado con un test** (`moneda-formato` → «C3 — el doble redondeo del
  camino numerico, declarado y fijado») en vez de quedar implícito.
- **C4** — Los docstrings que iban a quedar mintiendo. Cubierto por R18 (diente 5).

**Encontradas durante la implementación** (backend §9, frontend §5):

- **C5** — «dos docstrings» eran **tres archivos**: `KpiValorAnimado.tsx:21-22` también mentía y
  **ninguna task lo cubría**. Corregido en el bloque 4.
- **C6** — T2.3 daba por hecho que 5 tests pasaban «sin editar una línea» y uno (`:128`) sí había
  que tocarlo; reescrito y **reforzado** con una aserción del `trim` que no depende del formato.
- **C7** — El bloque 3 enumera cuatro dientes y la trazabilidad exige un **quinto** (R18).
  Implementado. `components/private/analytics/formato.ts` queda **excluido del censo por escrito**:
  su docstring escribe `0,842` para explicar el porcentaje, que **conserva** su decimal (D2/R15).
- **C8** — `test:rapido` es `test:cambiados && test:guardias` y el `&&` **cortocircuita**: con los
  relacionados en rojo, las guardias **no llegan a correr**. Los dos implementadores y el reviewer
  corrieron `test:guardias` **aparte**, en todas las tandas. → **ficha propia** (m5).
- **C9** — Un archivo de test fuera del censo de 39:
  `tests/unit/components/analytics-formato.test.ts`.
- **H1–H5** (frontend) — cinco aserciones que dejaron de afirmar lo que decían, tratadas una a una
  en `impl_230_frontend.md` §5. La sexta la encontró el reviewer (m1) y queda cerrada.
- **H6** — era **B1**, y queda cerrado con `moneyTope`.
- **m4** (reviewer) — el diente 1 mide cuatro caminos independientes, no cinco.

---

## 4. Estado

| Bloque | Estado |
| --- | --- |
| 0 — puerta humana | pasada (2026-08-18). **T0.1 sin marcar**: falta copiar las tres respuestas a `requirements.md` §4 con fecha (del leader; están en el `status_note` de la ficha) |
| 1, 2, 3 — `backend_dev` | **hechos**, con 7 mutaciones ejecutadas |
| 4, 5 — `frontend_dev` | **hechos**, con 6 mutaciones ejecutadas + las de la tanda de review |
| Review | **B1 cerrado**, **B3 cerrado**, **B2 pendiente (leader)**. Menores: m1 y m2 cerrados; m3 y m4 anotados; m5 a ficha aparte |
| 6 — cierre | **T6.1 (`./init.sh` completo), T6.3 (ver la app) y T6.4 (PR) pendientes, del leader** |

> **ACTUALIZADO el 2026-08-18, tras la 2.a pasada del reviewer (menor n2).** Lo que este
> archivo declaraba pendiente ya no lo esta, y decirlo importa porque se contradecia con
> `impl_230_pantallas.md`:
>
> - **T0.1 — cerrada.** Las respuestas de la puerta humana (Q1/Q2/Q3) estan escritas con fecha en
>   `specs/230-dinero-sin-centimos/requirements.md` §4.
> - **T6.3 / B2 — cerrada.** La app se condujo con Chromium real: **488 importes en 11 pantallas,
>   cero con decimal**, con el cero autocomprobado. Detalle y los cinco huecos declarados en
>   `progress/impl_230_pantallas.md`. El reviewer lo dio por bueno en su segunda pasada.
> - **Veredicto vigente: APROBADO**, cero bloqueantes. Quedan cinco menores; n1 y n4 se derivan a
>   la 232, n5 se registra como ficha propia.
