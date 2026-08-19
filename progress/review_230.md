# Feature 230 — el dinero se pinta sin céntimos · review

> Revisión independiente sobre el árbol de trabajo (rama `feature/230-dinero-sin-centimos`,
> sin commitear). No se editó una línea de código. `./init.sh` completo **no** se corrió (lo
> corre el leader); todo lo demás se ejecutó y se pega abajo con su salida real.

**VEREDICTO: RECHAZADO** — 3 bloqueantes (uno sustantivo de producto, uno de verificación,
uno de registro). El núcleo técnico —el redondeo, la guardia y las 234 líneas reescritas—
**sostiene el escrutinio**: ver §2, §3 y §5.

---

## 1. Checklist de CHECKPOINTS.md

### Especificación
- [x] `specs/230-dinero-sin-centimos/requirements.md` con R1–R20 en EARS.
- [x] `design.md` con alternativas descartadas (§7, cinco: A1–A5) y su porqué.
- [ ] **`tasks.md` con todas las tasks `[x]`** → **0 marcadas de 34**. Ver B3.

### Trazabilidad
- [x] Cada `R<n>` mapea a un test concreto **que existe y se ejecuta** (verificado por mí,
      sin fiarme de la tabla de `tasks.md` ni de las bitácoras). Ver §2.
- [ ] **`progress/impl_230.md` con el mapa `R<n> → test`** → el archivo **no existe**; hay
      dos bitácoras (`impl_230_backend.md`, `impl_230_frontend.md`) y **ninguna** contiene el
      mapa de los 20. R13, R14 y R20 no están mapeados por escrito en ningún sitio. Ver B3.

### Calidad de código
- [x] `pnpm run typecheck` → **EXIT 0**, cero errores.
- [x] `pnpm run lint` → **EXIT 0**, 69 problems / **0 errors** / 69 warnings, todos
      preexistentes. Crucé los 33 archivos con warning contra los 42 tocados: **intersección
      vacía**.
- [x] Tests: los 39 archivos del diff + la guardia → **39 passed / 731 tests**.
      `pnpm run test:guardias` → **110 passed / 1639 tests, EXIT 0** (cero guardias cruzadas
      rotas; las tres money-safe vivas siguen verdes).
      La suite entera **no** se corrió aquí, por encargo.
- [~] E2E: **inaplicable** (no hay harness Playwright vivo en este repo y la feature no
      añade flujo, solo aspecto). El sustituto que el propio spec prescribe es **T6.3**
      (ver tres pantallas reales) y **no se ejecutó**. Ver B2.

### Datos y seguridad
- [x] Tablas nuevas: **ninguna** → RLS no aplica.
- [x] Migraciones: **cero**. `git diff --name-only` no toca `db/**`, ni `.sql`, ni
      `db/schema.prisma`. Verificado por mí, no por la bitácora.
- [x] Sin secretos hardcodeados. Sin webhooks nuevos.

### Patrón de capas
- [x] Solo se toca presentación: `lib/config/moneda.ts` (config/util puro) y 3 archivos de UI.
      Ni un service, ni un repository, ni un route handler, ni una Server Action.

### Multi-país / configuración
- [x] Sin hardcode de contexto: símbolo y separador de miles siguen saliendo de
      `monedaConfig`; la guardia nueva lee el **separador decimal de la configuración** en vez
      de escribir la coma a mano (decisión Q1(b)), que es lo correcto según
      `docs/architecture.md` §4.

### Verificación final
- [ ] `./init.sh` completo → pendiente (del leader, por encargo).
- [x] `progress/review_230.md` existe (este archivo).
- [ ] `progress/history.md` → pendiente (del leader, al cierre).

---

## 2. Trazabilidad — comprobación INDEPENDIENTE

Recorrida a mano sobre `requirements.md` y sobre los archivos de test, no sobre la tabla de
`tasks.md`. Para cada R busqué el test, lo leí, y comprobé que **se ejecuta y afirma lo que
dice** (varios además murieron bajo las mutaciones que reproduje, §5).

| R | Test que lo cubre (archivo · nombre) | ¿Ejecutado y verde? |
| --- | --- | --- |
| R1 | `dinero-sin-centimos.guardia` → «ninguna salida lleva el separador decimal seguido de un digito (R1, R12)» + `moneda-formato:173` | sí · muere con M1 |
| R2 | `moneda-formato:117` «el medio se aleja del cero, tambien en negativo (R2, D1)» | sí · muere con F5/F6 |
| R3 | `moneda-formato:127` «el acarreo que añade un digito REAGRUPA los miles (R3)» | sí · **muere con M6 (reproducido)** |
| R4 | `moneda-formato:139` «el cero redondeado NO lleva signo (R4)» | sí · **muere con M5 (reproducido)** |
| R5 | `moneda-formato:163` + `:62` «el separador de miles no se cuela delante del primer grupo» | sí |
| R6 | `moneda-formato:153` «con mas de dos decimales manda el PRIMERO (R6)» | sí · muere con F5 |
| R7 | `moneda-formato:374` (barrido money-safe con contraprueba, y `toFixed` único de escala 2) + `:400` «el redondeo de un importe que un `number` no puede representar es EXACTO» | sí · **muere con M6** |
| R8 | `moneda-formato:224` (**sin tocar**) + guardia diente 4 «la rama VERBATIM queda FUERA del diente 1 (C2)» | sí |
| R9 | `moneda-formato:194`, `:198`, `:209` (**los tres sin tocar**) | sí |
| R10 | `moneda-formato:92` «el signo negativo va DELANTE del simbolo» + `:241` | sí · muere con M5 |
| R11 | `moneda-formato:319` «con otra configuracion cambian el simbolo y el separador de MILES» + `:337` «cambiar el separador DECIMAL no altera ni un byte (Q1(b))» | sí |
| R12 | guardia diente 1 «los cinco caminos dan la MISMA cadena para el mismo importe (R12)» | sí (con matiz m4) |
| R13 | `OrdenesCargaResumen.test.tsx:159-206`, describe «el monto lo formatea el módulo de moneda (230/R13)», 3 casos | sí · **muere con F1 (reproducido)** |
| R14 | `KpiValorAnimado.test.tsx:190-238`, 4 casos con doble propio que captura `decimals` | sí · muere con F2/F5 |
| R15 | guardia diente 4 (porcentaje, duración y conteo contra el **mismo `Intl`**) + `analytics-formato` con sus casos de porcentaje/duración intactos y verdes | sí |
| R16 | guardia diente 3 + contraprueba + `descarga/RankingHistoricoDescarga.test.tsx:181` (`premio === "5000.00"`, con céntimos) | sí |
| R17 | Diff sin migraciones ni `schema.prisma` (comprobado por mí) · `tests/unit/services/**` y `tests/unit/repositories/**` **no tocados** (comprobado) · los 4 archivos de frontera declarados intactos corren verdes: 5 files / 136 tests | sí |
| R18 | guardia diente 5 (3 fuentes censados) + contraprueba + test de que los fuentes «TIENEN prosa que barrer» | sí · muere con F3/F4 |
| R19 | guardia dientes 1 y 2, con las dos contrapruebas embebidas + las mutaciones reales | sí · **M1 y F1 reproducidos en rojo** |
| R20 | `wallet-desglose-egresos-card.test.tsx:54` «el total mostrado es el que llega del servidor», caso `total: "999.99" → ₡1.000` con filas que suman `₡1.251` | sí (ver m3) |

**Resultado: 20 definidos · 20 mapeados · 0 huérfanos · 0 fantasmas.**
Ningún test invoca un `R<n>` de la 230 que no exista en `requirements.md`. Ningún requisito se
queda sin test ejecutado. La tabla de `tasks.md` §Trazabilidad coincide con lo que encontré,
salvo que R18 necesitaba un **quinto diente** que allí no está pedido (C7, ya declarado por el
backend) y que el mapa de R13/R14/R20 no llegó a escribirse en ninguna bitácora (B3).

---

## 3. Las 234 líneas reescritas — comprobación mecánica, no a ojo

Es el punto de mayor riesgo de la feature, así que no me fié de la relectura declarada.

**(a) ¿Cada importe reescrito es el redondeo correcto?** Extraje del diff los **258 literales
de importe de las líneas eliminadas**, apliqué half-away-from-zero sobre el string (con
autocomprobación del redondeador antes de usarlo) y comprobé que el valor esperado aparece en
las líneas añadidas del mismo hunk.

```
literales ₡ en lineas ELIMINADAS: 258
literales con decimales cuyo redondeo NO aparece en el hunk: 1
  -> tests/components/PriceLabel.test.tsx  (es PROSA: «La mutacion que este caso caza:
     quitar la agrupacion (`₡13331832,72`)», reescrita a `₡13331833`)
```

**Cero errores de redondeo en 258 literales.**

**(b) ¿Quedó algún importe con decimales?** Ninguna línea **añadida** contiene un importe con
cola decimal salvo 5, y las cinco son comentarios que citan lo que la línea afirmaba antes.

**(c) La afirmación de la bitácora sobre la cola `,00` — verificada.**
`impl_230_frontend.md:218` dice que el reemplazo mecánico se limitó a `,00` «porque no cambia
de valor al redondear». Es **cierto** (`X,00` redondea a `X` con cualquier regla), pero eso
mismo significa que **ninguna mutación de redondeo puede matar esas líneas**. Así que medí lo
que sí las mata: la mutación **M1** (no descartar la cola decimal). Resultado sobre los 39
archivos del diff:

```
 Test Files  39 failed (39)
      Tests  169 failed | 562 passed (731)
```

**Los 39 archivos caen.** Las líneas de cola `,00` son carga estructural, no decorado. La
afirmación se sostiene.

**(d) Escapes de regex.** Un reemplazo mecánico sobre `/^₡3\.390,00$/` puede comerse la barra
y dejar `/^₡3.390$/`, que **sigue pasando** (el punto casa consigo mismo) — un debilitamiento
invisible. Barrí las 36 expresiones regulares con importe de los archivos tocados:
**36 encontradas, 0 con el punto de miles sin escapar.**

**(e) Colisiones.** Busqué hunks donde dos importes antes distintos colapsen al mismo valor
redondeado (una aserción que dejaría de discriminar). **Una sola**, y es el par `₡0,1` / `₡0,10`
del test VERBATIM que la feature retira a propósito.

**(f) Aserciones perdidas.** Ningún archivo tocado bajó su número de `expect(`; seis subieron.
Cero `toBeTruthy()`/`toBeDefined()` introducidos. Ninguna aserción nueva se compara contra
`money(…)`/`formatMonto(…)` calculado en el test (cero tautologías **nuevas**; las que hay en
`mi-wallet-page` y `CuentasPorPagarPaginacion` son preexistentes y no se tocaron).

**(g) Barrido de cierre del censo (T5.7), rehecho por mí.** El barrido de importes con dos
decimales sobre `tests/` deja **10 apariciones** y las **diez están en prosa** (líneas de
comentario). Coincide con lo declarado. Sin CRLF colado: los 42 archivos del diff están en LF.

**Aserciones que quedaron vacías de contenido:** el frontend declaró cinco (H1–H5) y las
verifiqué una a una — están tratadas honestamente, con la red mudada al sitio donde todavía
mide (barrido money-safe sobre el fuente en `IncidentesAdminModule`, `not.toBe` entre celdas en
`ordenes-columns`, símbolo + contraprueba `conteo≠moneda` en `PanelConciliacion`). **Encontré
una sexta que se le pasó**, y es solo de título: m1.

---

## 4. El redondeo, por bordes

Probé el módulo directamente, más allá de lo que afirman sus tests:

```
"-0"        -> "₡0"        "-0.5"        -> "-₡1"
"-0.0"      -> "₡0"        "-0.50"       -> "-₡1"
"-0.00"     -> "₡0"        "-0.000001"   -> "₡0"
"-0.4"      -> "₡0"        "0.9999"      -> "₡1"
"-0.49"     -> "₡0"        "-0.99999999999999999" -> "-₡1"
"99999999999.99"  -> "₡100.000.000.000"      "12345678901.99" -> "₡12.345.678.902"
"-99999999999.51" -> "-₡100.000.000.000"     "1.2.3"          -> "₡1.2.3"   (verbatim, C2)
num -0 -> "₡0"    num -0.001 -> "₡0"    num -0.5 -> "-₡1"    num -1234.5 -> "-₡1.235"
```

- **Acarreo que cambia de dígitos:** correcto en todos los bordes (`999,50 → ₡1.000`,
  `9,99 → ₡10`, `999.999,99 → ₡1.000.000`, once nueves de golpe).
- **Cero sin signo:** correcto en **todas** las formas de `-0` que probé, incluida
  `formatMonto(-0)` (que llega como `"0.00"` por `toFixed`) y `-0.000001`.
- **Más de dos decimales:** manda el primero, el resto se ignora.
- **Importes que no caben en un `number`:** exactos, en los dos sentidos del acarreo.
- **Sin `Number(` / `parseFloat(` / `parseInt(` / `Math.round`** en `lib/config/moneda.ts`.
  El único `Math.` del módulo es `Math.max(0, fin - 3)` sobre un **índice de string** en
  `agruparMiles`, preexistente. El único `.toFixed(` es el de escala 2 de `formatMonto`, que es
  la frontera y está fijado por test (`moneda-formato:396`).
- `sumarUno` está escrito con regex y no con el bucle de `design.md` §2.2. Desviación de
  **forma**, declarada en la bitácora, semántica idéntica y cubierta por M6, que reproduje.
  Sin objeción.
- Entradas fuera de contrato: `"-000.49" → ₡000` y `"000123.60" → ₡000.124`. Feo, pero es el
  comportamiento previo y `design.md` §2.4 lo declara. Nótese que `esCero` acierta con los
  ceros a la izquierda y tira el signo.

---

## 5. Mutaciones reproducidas por mí

Aplicadas con un arnés que **aborta si el texto buscado no aparece exactamente una vez**
(la lección del arnés que mintió). Árbol restaurado y **verificado con md5** tras cada una.

| # | Qué revierte | Resultado medido |
| --- | --- | --- |
| **M1** | el paso 5 de `design.md` §2.3: la cola decimal se copia en vez de redondear | 🔴 guardia: **3 tests** (diente 1, el sub-caso de dos decimales y la contraprueba), **2482 hallazgos**. Y sobre los 39 archivos del diff: **39 files failed, 169 tests** |
| **M6** | `sumarUno` pierde el acarreo del caso «todo nueves» | 🔴 **5 tests** en `moneda-formato` — `Expected "₡100" / Received "₡00"`, `"₡100.000.000.000"` → `"₡00.000.000.000"` |
| **M5** | la caída del signo cuando el resultado es cero | 🔴 **2 tests**, y solo dos: `expected '-₡0' to be '₡0'` |
| **F1** | devolver la fuga `row.montoCobrar.toFixed(2)` a `OrdenesCargaResumen` | 🔴 **4 tests**: diente 2 nombrando `app/(app)/ordenes/_components/OrdenesCargaResumen.tsx:103` + los 3 del componente |
| **F5** | truncar en vez de redondear (`redondearEnteros` devuelve `enteros`) | 🔴 **46 tests** en 17 archivos, sobre los 39 del diff |

Las cinco muerden. **Ninguna sobrevivió.** Los conteos difieren de los de las bitácoras solo
por el estado del árbol en que cada una se midió (el backend contaba además sus 2 rojos
pendientes de `frontend_dev`); las diferencias cuadran exactamente.

**Restauración verificada** (no solo declarada):

```
=== md5 DESPUES ===                          === md5 ANTES ===
85f31e7f...b2 lib/config/moneda.ts           85f31e7f...b2 lib/config/moneda.ts
9be223a7...98 OrdenesCargaResumen.tsx        9be223a7...98 OrdenesCargaResumen.tsx
3c8d5755...60 KpiValorAnimado.tsx            3c8d5755...60 KpiValorAnimado.tsx
git diff --stat: 42 files changed, 935 insertions(+), 386 deletions(-)   [idéntico al inicio]
```

Y verde de nuevo tras restaurar: `guardia + moneda-formato → 2 passed / 49 tests`.

---

## 6. No-objetivos — los cuatro, comprobados

| No-objetivo | Estado |
| --- | --- |
| Analítica **no monetaria** intacta (porcentaje, duración, conteo) | **OK.** `components/private/analytics/formato.ts` **no está en el diff**. Diente 4 lo afirma contra el mismo `Intl` que lo produce. `analytics-formato.test.ts` solo cambia su caso de `moneda`; sus casos de porcentaje y duración siguen verdes sin tocarse |
| Descargas XLSX/CSV **con** céntimos | **OK.** `lib/utils/descarga-dataset.ts` y `manifiesto-xlsx.ts` no están en el diff; diente 3 lo vigila con contraprueba; `RankingHistoricoDescarga` afirma `premio === "5000.00"` **dos líneas debajo** de la celda que ya se pinta `₡5.000` |
| Frontera y DTO en escala 2 **sin tocar** | **OK.** Cero cambios en `lib/services/**`, `lib/repositories/**`, `lib/types/**`. Cero tests de servicios/repositorios tocados. Los 4 archivos declarados intactos (`TableroFinanciero`, `AnalyticsKpiCard`, `indemnizacion-tope-negocio-incidente`, `financiera-unidad-de-vistas.guardia`) corren verdes: 136 tests |
| **Ninguna migración** | **OK.** `git diff --name-only` no devuelve nada bajo `db/`, ni `.sql`, ni `schema.prisma` |

Nada de esto se movió. R15, R16 y R17 se sostienen.

---

## 7. Hallazgos

### BLOQUEANTES

**B1 — El tope de indemnización anuncia un máximo que la app rechaza.** *(sustantivo)*

Medido por mí: `INDEMNIZACION_MONTO_MAX = "9999999999.99"`; `money(INDEMNIZACION_MONTO_MAX)`
devuelve hoy **`₡10.000.000.000`**. Los cuatro textos que lo interpolan
(`IncidentesAdminModule.tsx:104` y `:113`, `CierresAdminModule.tsx:190` y `:197`) pasan a decir:

> «El monto no puede superar **₡10.000.000.000** (10 dígitos y 2 decimales). Revisá si sobra un dígito.»

Tres cosas a la vez, y las tres son del usuario, no del formateador:

1. **El texto miente.** El validador es `new Prisma.Decimal(v).lte("9999999999.99")`
   (`lib/types/cierres-admin.ts:65`, `lib/types/incidente.ts:68`): escribir el máximo que el
   mensaje anuncia devuelve el propio mensaje de error. Un límite redondeado **hacia arriba**
   deja de ser un límite.
2. **Se contradice en la misma frase:** «₡10.000.000.000 (10 dígitos)» son 11 dígitos.
3. **Ningún test puede cazarlo.** El único que toca esos textos
   (`IncidentesAdminModule.test.tsx:345`) hace `toHaveTextContent(MONTO_EXCEDE)` **importando la
   misma constante**: afirma una constante contra sí misma. Es exactamente la aserción vacía que
   este repo ya conoce, y por eso el rojo nunca llegó.

No es un fallo del redondeo —redondear un importe es correcto—; es que `design.md` §1 metió en
«presentación de importes monetarios» un valor que **no es una cantidad sino una cota**, y no
hay requisito que lo distinga. El frontend hizo lo correcto al escalarlo (H6) en vez de tocar
un quinto archivo de producción, pero **escalarlo no lo cierra**: mientras la decisión no esté
tomada, escrita en `requirements.md` e implementada, la feature mete en producción un texto de
formulario que miente sobre dinero.

*Qué falta para cumplirlo:* elegir y aplicar una de las tres opciones ya nombradas —(a)
interpolar el tope crudo como ya hace `liquidacion-labels.ts:194`, (b) redactarlo en dígitos sin
importe, (c) aceptarlo por escrito— **y** un test que afirme el texto contra un literal, no
contra la constante. Si sale (c), tiene que quedar en `requirements.md` §3 como consecuencia
aceptada, con la firma del humano, no en una bitácora.

**B2 — T6.3 sin ejecutar: nadie ha mirado una pantalla real.** *(sustantivo)*

La feature cambia **el aspecto de todas las pantallas de dinero a la vez** (A3, aceptada) y el
checkpoint de E2E es **inaplicable** aquí (no hay harness Playwright vivo). T6.3 —abrir wallet,
un cierre y el listado de órdenes— es la **única** red que queda para lo que la suite no ve:
una columna que deja de caber, un total que ya no cuadra a ojo, un texto que se lee raro. No
hay ni captura ni descripción de ninguna pantalla en las dos bitácoras.

Que esto importa no es teoría: **B1 es justo un texto de pantalla que 12.000 tests dan por
bueno**, y lo encontró la relectura del frontend, no la suite. *Qué falta:* las tres pantallas
abiertas, con la del **resumen de carga** entre ellas (es la que cambia de aspecto de verdad:
gana símbolo y separador de miles), descritas en `progress/impl_230.md`.

**B3 — Registro: `tasks.md` con 0/34 marcadas y sin `progress/impl_230.md`.** *(registro)*

- `specs/230-dinero-sin-centimos/tasks.md`: **34 tasks, 0 con `[x]`.** CHECKPOINTS §Especificación
  lo exige explícitamente. En sustancia T0.1–T5.7 están hechas (lo verifiqué); T6.1–T6.4 no.
- **No existe `progress/impl_230.md`.** CHECKPOINTS §Trazabilidad y T6.2 piden ahí el mapa de
  los **20** requisitos con el nombre del test ejecutado. Lo que hay son dos bitácoras: la del
  backend mapea R1–R12 y R15–R19 y declara «R13, R14 y R20 son de `frontend_dev`»; la del
  frontend **no trae mapa `R→test` ninguno**. Es decir: **R13, R14 y R20 no están mapeados por
  escrito en ningún archivo del repo.**

  Aclaro para que no se sobrerreaccione: **los tres tienen test real, lo verifiqué y lo dejé en
  §2 de este documento.** El agujero es documental, no de cobertura — pero es un checkpoint
  explícito y el siguiente que lea esto no tiene por qué repetir mi trabajo.

*Qué falta:* marcar las tasks que están hechas, dejar sin marcar las que no, y consolidar el
mapa 20/20 en `progress/impl_230.md` (puede ser un índice que apunte a las dos bitácoras, pero
la tabla completa tiene que estar en un sitio).

### MENORES

**m1 — Sexta aserción caducada, no declarada.**
`tests/integration/wallet-tiendas-desglose.test.tsx:468`:

```ts
it("money-safe: los montos se pintan TAL CUAL, con sus dos decimales", async () => {
  …
  expect(within(tabla).getByText("₡10.000")).toBeInTheDocument();
  expect(within(tabla).getByText("₡1.000")).toBeInTheDocument();
```

El título promete «con sus dos decimales» y las aserciones ya no las tienen; y el «money-safe»
del rótulo dejó de medir nada (`₡10.000` sale igual con o sin `Number(` intermedio). Es la misma
familia de H1–H5, que sí se declararon. Fue el **único** título obsoleto que encontré barriendo
los 38 archivos por «dos decimales / sus decimales / el céntimo».

**m2 — Prosa obsoleta fuera del censo del diente 5.**
`IncidentesAdminModule.tsx:110-112` y `CierresAdminModule.tsx:185-188` siguen diciendo en su
comentario que «`no puede superar ₡9.999.999.999,99` se lee de un vistazo». Tras la 230 eso ya
no es lo que se pinta. R18 habla de «los módulos y componentes de dinero» y el censo del diente
5 son tres archivos; la exclusión está escrita, pero se queda corta **justo donde vive B1**.
Se resuelve solo cuando se resuelva B1.

**m3 — R20 se cumple, pero por un solo caso y de forma indirecta.**
De los tres puntos anotados como `230/R20`, dos —`CierreDiaModule.test.tsx:295` y
`CierresAdminModule.test.tsx:424`— usan datos donde la suma de redondeos **coincide** con el
redondeo de la suma, y ellos mismos lo dicen («aquí las dos cuentas coinciden»). No discriminan.
El testeable de R20 pide explícitamente un conjunto donde **difieran**. Solo lo cumple
`wallet-desglose-egresos-card.test.tsx:54` (total `"999.99" → ₡1.000` contra filas que suman
`₡1.251`) — y ese caso funciona porque el componente **no suma**, no porque se compare una suma
contra otra. Se sostiene, pero con un margen más estrecho del que el requisito pedía.

**m4 — El diente 1 no mide cinco caminos independientes, mide cuatro.**
`formatMonto(n)` es literalmente `formatMontoString(n.toFixed(2))`, así que la comparación entre
ambos en «los cinco caminos dan la MISMA cadena» es tautológica por construcción. Los otros tres
(`money`, `PriceLabel` renderizado, `formatearValor(·,"moneda")`) sí miden. No invalida el
diente; sí conviene no contarlo como cinco medidas.

**m5 — C8 (`test:rapido` cortocircuita) es real. Deuda declarable, no de esta ficha.**
Verificado: `"test:rapido": "pnpm run test:cambiados && pnpm run test:guardias"`. Con los
relacionados en rojo, el `&&` corta y **las guardias no llegan a correr** — contra lo que promete
`docs/verification.md` («las guardias van SIEMPRE… ningún grafo de imports las selecciona») y
contra el comentario del propio `init.sh`.

Mi juicio, que es lo que se me pidió: **no se cierra aquí, y no bloquea la 230.**
Tres razones: (1) el defecto es **anterior** a esta feature —viene del gate de dos niveles del
2026-08-03— y no lo introduce el diff; (2) `package.json` está fuera de la superficie declarada
en `design.md` §4, y meterlo ahora convierte una feature de presentación en una de arnés;
(3) **el riesgo concreto ya está cubierto**: los dos implementadores corrieron `test:guardias`
por separado y **yo lo corrí otra vez** (110 archivos, 1639 tests, EXIT 0), así que en esta
feature ninguna guardia se quedó sin ejecutar.

Pero **no puede quedarse solo en una bitácora**: el día que alguien cierre una tanda en rojo y
lo arregle, se irá en verde con las guardias sin correr y sin saberlo. Ficha propia, arreglo de
una línea (`;` o acumular el exit code) **más un test que lo fije** —si no, vuelve—.

**m6 — Sin objeción, anotado para el que venga.**
`sumarUno` con expresión regular en vez del bucle de `design.md` §2.2: desviación de forma,
declarada, misma semántica, y la mutación que la cubre (M6) la reproduje en rojo. Y las
entradas fuera de contrato (`"-000.49" → ₡000`) siguen como estaban, tal y como declara §2.4.

---

## 8. Qué NO es un hallazgo

Por si alguien las relee como si lo fueran: **A1, A2, A3** (`requirements.md` §3) y **C1–C4**
(§5) son decisiones **ya aceptadas por el humano**, no deuda. **C5, C6, C7 y C9** los encontró y
declaró el backend, y los verifiqué correctos (C6: comprobé en el diff que `:106`, `:110`,
`:121` y `:132` siguen intactos y que solo `:128` se tocó, con la aserción del `trim` reforzada
con un `toBe` que no depende del formato). **H1–H5** los declaró el frontend y están bien
tratados. No los cuento como míos ni los sumo al veredicto.

---

## 9. Veredicto

**RECHAZADO.**

No por el redondeo, que es correcto en todos los bordes que probé; ni por la guardia, que
muerde de verdad en las cinco mutaciones que reproduje; ni por las 234 líneas, que resisten la
comprobación mecánica de los 258 literales y caen enteras —los 39 archivos— cuando se revierte
el formateador. Eso está bien hecho y así consta.

Vuelve al implementer por tres cosas:

1. **B1** — decidir e implementar el tope de indemnización, con un test que afirme el texto
   contra un literal. Es un texto de dinero que hoy miente al usuario y que ninguna suite puede
   ver. *(Necesita la puerta humana antes que el implementer.)*
2. **B2** — abrir tres pantallas reales, con el resumen de carga entre ellas, y dejarlo escrito.
3. **B3** — marcar `tasks.md` y consolidar el mapa 20/20 en `progress/impl_230.md`.

Y queda pendiente lo que ya estaba acordado: **`./init.sh` completo antes del PR, sin excepción**
(lo corre el leader). Los menores m1–m4 pueden entrar en la misma tanda; **m5 va a ficha aparte**.

---
---

# SEGUNDA PASADA — 2026-08-18

> La primera pasada (arriba) se conserva íntegra. Esto verifica el cierre de B1, B2 y B3 sobre
> el árbol corregido, sin fiarme del resumen del leader. No edité código. `./init.sh` completo
> sigue sin correrse (lo corre el leader).

**VEREDICTO DE LA SEGUNDA PASADA: APROBADO.** Los tres bloqueantes están cerrados. Quedan
menores, ninguno de ellos capaz de meter un defecto en producción.

Estado ejecutable medido por mí sobre el árbol actual (48 archivos, 1138/442):

```
40 archivos de test del diff + guardia  ->  40 passed / 762 tests
pnpm run test:guardias                  ->  110 passed / 1639 tests, EXIT 0
pnpm run typecheck                      ->  EXIT 0, cero errores
pnpm run lint                           ->  EXIT 0, 69 problems / 0 errors / 69 warnings (preexistentes)
```

## B1 — CERRADO. Qué comprobé yo

**El código.** `moneyTope(max)` vive en `cierre-detalle-shared.tsx:259-280`: corta el string por
el punto y delega en `money`. Money-safe de verdad (`indexOf`, `slice`; sin `Number(`,
`parseFloat(`, `parseInt(` ni `.toFixed(`), y las guardias siguen verdes. Los **cuatro** textos
pasan por él (`IncidentesAdminModule.tsx:108,122`; `CierresAdminModule.tsx:197,204`) y **no
queda ni un `money(` aplicado a una cota** en `app/`, `components/` ni `lib/` — barrido propio.
`INDEMNIZACION_MONTO_MAX` y los dos validadores (`montoValido`, `Prisma.Decimal.lte`) intactos.

**La aritmética del tope, comprobada contra el validador real:**
`montoValido("9999999999", "9999999999.99")` da `true` (mismos 10 dígitos, decimales `"00" <= "99"`);
`montoValido("10000000000", …)` da `false` (11 dígitos). El mensaje queda estricto por 99
céntimos, que es el lado seguro, y vuelve a casar con el «(10 dígitos)» de su propia frase.

**La invariante: la juzgo BUENA, y con un límite que conviene tener escrito.**

```ts
const anunciado = /₡[\d.]+/.exec(MONTO_EXCEDE)?.[0] ?? "";
const digitos = anunciado.replace(/\D/g, "");
expect(montoValido(digitos, INDEMNIZACION_MONTO_MAX)).toBe(true);
```

Caza **cualquier** redondeo al alza, no solo el de hoy: para un tope `X,dd` con `dd > 0`,
redondear hacia arriba da `X+1`, que siempre excede `X,dd`, así que `montoValido` devuelve
`false`. Y si alguien reintrodujera la cola decimal, el `replace(/\D/g,"")` la concatenaría
(`₡9.999.999.999,99` pasaría a `"999999999999"`, doce dígitos) y también caería. No le encuentro
hueco por ese lado.

**El límite es que es de un solo sentido:** un tope demasiado bajo la deja verde. Lo medí
—mutación **N3**, `max.slice(0, punto)` a `slice(0, punto - 1)`, que anuncia `₡999.999.999`—:
la invariante **sobrevive** y lo que cae son los **literales** (4 tests). Es decir, la pareja
funciona porque son dos redes distintas: la invariante fija la propiedad peligrosa (al alza) y
los literales fijan el valor exacto. Con solo una de las dos habría hueco; con las dos, no.

**Mutaciones reproducidas por mí** (arnés que aborta si el texto no aparece exactamente una vez;
árbol restaurado y verificado con md5 idéntico en los tres fuentes):

| # | Qué revierte | Rojo medido |
| --- | --- | --- |
| **N1** | `moneyTope` a `money` en `IncidentesAdminModule.tsx` (`MONTO_EXCEDE`) | 🔴 **2 tests**: el literal y **la invariante** (`expected false to be true`) |
| **N2** | `moneyTope` a `money` en `CierresAdminModule.tsx` (`INDEMNIZACION_MONTO_EXCEDE`) | 🔴 **1 test**: `expected 'El monto no puede superar ₡10.000.000…' to contain '₡9.999.999.999'` |
| **N3** | `moneyTope` corta un dígito de más (tope demasiado bajo) | 🔴 **4 tests**, todos por literal; la invariante **sobrevive** — es la medida de su unilateralidad |

**Las tautologías, cerradas.** Verifiqué las cuatro que quedaban: `IncidentesAdminModule.test.tsx:346`
pasa de `toHaveTextContent(MONTO_EXCEDE)` al texto entero escrito a mano, y las tres de
`CierresAdminIndemnizacion.test.tsx` (`:384`, `:409`, `:435`) dejan de compararse contra
`money(INDEMNIZACION_MONTO_MAX)` —la función que escribe el texto— y pasan a literal, con un
`not.toContain("₡10.000.000.000")` que fija la dirección prohibida. Es exactamente lo que pedía
el hallazgo.

## B2 — CERRADO. Qué comprobé yo, y por qué me vale pese al hueco

`progress/impl_230_pantallas.md`: Chromium real, login `admin`, `innerText` como evidencia,
**35 importes en 5 rutas, cero con céntimos** (8+3+8+8+8 = 35, la tabla cuadra). La medición
está **autocomprobada** y esa es la parte que la hace valer: el mismo texto con importes en
formato viejo da **32 hallazgos**, y el punto de miles no produce falsos positivos. Verifiqué la
lógica del detector `/\d,\d{2}(?!\d)/` yo mismo: `₡1.234` no, `₡13.495.820` no,
`₡1.234,50` sí, `"Total ₡1.234 y ₡12.345.678"` no. Muerde y no miente. Los cinco huecos
están declarados y ninguno se presenta como cubierto.

**La pregunta que se me hace —¿vale la invariante o el bloqueante sigue vivo hasta ver el
mensaje del tope en pantalla?— la respondo: vale, y B2 queda cerrado.** El razonamiento, para
que se pueda discutir:

1. B2 existía porque **ningún test leía ese texto**: la única aserción que lo tocaba comparaba
   la constante consigo misma. Eso ya no es cierto. Hoy el mensaje completo —incluido el
   «(10 dígitos y 2 decimales)»— está escrito a mano en dos archivos de test.
2. El mensaje **sí se renderiza y se lee en un DOM real** en `CierresAdminIndemnizacion.test.tsx`:
   se conduce el modal con `userEvent` y se afirma sobre el `textContent` del elemento de error
   de la pantalla, no sobre la constante importada. Lo que no se vio es ese DOM en Chromium.
3. Es un string estático interpolado al cargar el módulo. La distancia entre «se renderiza en
   jsdom» y «se renderiza en Chromium» para un literal así es la más corta que existe; el riesgo
   que B2 perseguía —un texto que nadie lee nunca— está cubierto por otra vía y **la mutación
   N1 demuestra que esa vía muerde**.

Lo que queda es un hueco de cobertura, no un bloqueante: lo anoto como **n3** para que la 232,
que va a tocar estos mismos textos, lo vea en pantalla con un incidente pendiente sembrado.

## B3 — CERRADO en sustancia. Qué comprobé yo

- `tasks.md`: **30 de 34** marcadas `[x]`; las 4 sin marcar llevan nota. Verificado.
- `progress/impl_230.md` existe y trae **el mapa de los 20** con el test nombrado **y la
  mutación que lo mata**. Lo crucé contra mi propia tabla de la primera pasada (§2): coincide en
  los 20, incluidos R13, R14 y R20, que era el agujero. Verifiqué además que los títulos citados
  existen de verdad —p. ej. el de R16, «R32: los valores viajan CRUDOS…»,
  `RankingHistoricoDescarga.test.tsx:164`, que es el que lleva `premio === "5000.00"`—. Recoge
  con honestidad los matices m3 (R20 solo discrimina en un caso) y m4 (el diente 1 mide cuatro
  caminos, no cinco), sin maquillarlos.
- **T0.1**: las tres respuestas **sí** están ahora en `requirements.md` §4, con fecha, en un
  bloque que conserva los enunciados originales debajo. Y la de Q2 va más allá de lo que se
  preguntó: mide los céntimos que hay **en el dato** y remite a la ficha **232**, que existe en
  `feature_list.json` como `pending`. Eso cierra el registro de la puerta humana.

## Menores nuevos de esta pasada

**n1 — `moneyTope` no tiene guardia: un quinto texto de tope con `money` reintroduce B1 en
silencio.** Barrido propio: `moneyTope` **no aparece en ningún test por su nombre** y ningún
diente censa «cotas pintadas con `money`». Hoy los cuatro consumidores están fijados por
literal, pero el argumento con el que esta feature justificó su guardia —«sin ella, la próxima
feature lo deshace y nadie se entera»— vale igual un nivel más arriba, y la 232 va a tocar justo
estos textos. Es barato: hoy la única constante así del repo es `INDEMNIZACION_MONTO_MAX`, así
que un diente 6 —o un test que afirme que en `app/**` ningún `money(` recibe un identificador
`*_MAX`/`*_TOPE`/`*_LIMIT`— cierra la puerta con cuatro líneas.

**n2 — El registro se quedó atrás en tres puntos, todos declarando pendiente algo ya hecho.**
No es riesgo de producto; es el desfase que en este repo ya ha inflado el backlog más de una vez:

- `specs/230-dinero-sin-centimos/tasks.md:21` — **T0.1 sigue `[ ]`** y su nota dice «Lo que falta
  es la otra mitad del criterio de Hecho: **copiar esas tres respuestas a `requirements.md` §4
  con su fecha**». Ya están copiadas (`requirements.md` §4, bloque «PUERTA PASADA EL 2026-08-18»).
  T0.1 está hecha y debería ir `[x]`: son **31 de 34**, no 30.
- `specs/230-dinero-sin-centimos/tasks.md:271` — **T6.3 sigue `[ ]`** con «*(pendiente: es el B2
  del review y lo lleva el leader)*». Está hecha, en `impl_230_pantallas.md`.
- `progress/impl_230.md:64`, `:121`, `:124` y `:125` — declaran «B2 … **PENDIENTE, del leader**»,
  «T0.1 sin marcar: falta copiar las tres respuestas» y «T6.3 … pendiente». Los tres son ya
  falsos. `impl_230.md` y `impl_230_pantallas.md` se contradicen entre sí sobre T6.3.

  Lo legítimamente pendiente son **T6.1** (gate completo) y **T6.4** (PR), y eso sí está bien
  anotado.

**n3 — El mensaje del tope de B1 nunca se ha visto en un navegador.** Declarado por el leader y
lo confirmo como hueco real: no lo hay en local (`Pendientes de decisión (0)`). No bloquea (ver
B2 arriba), pero la **232** toca estos mismos textos: que su T6.3 siembre un incidente pendiente
y lo vea, en vez de heredar la deuda.

**n4 — El detector de céntimos de la medición de pantallas es más estrecho que R1.**
`/\d,\d{2}(?!\d)/` exige **dos** dígitos. Lo probé: `₡1.234,5` **no lo caza**, `₡1.234,567`
**tampoco**. R1 prohíbe *cualquier* dígito tras el separador, y el diente 1 de la guardia sí
afirma lo fuerte. En la práctica el formateador no puede emitir una cola de uno o tres dígitos,
pero la rama **verbatim** (C2) sí podría (`₡1,5`), y ese barrido no la habría visto. Un
`/\d,\d/` habría medido lo que el requisito dice.

**n5 — `feature_list.json` no se tocó**, así que la ficha de **m5/C8** (`test:rapido` cortocircuita
y las guardias no corren) **no existe**: los ids llegan a 232 y ninguna ficha la menciona. La
decisión está escrita en tres `.md`, que es exactamente donde no la va a leer nadie. Sigue sin
bloquear la 230 —los tres agentes corrimos `test:guardias` aparte y está verde—, pero mientras no
sea ficha, no está viva.

## Menores de la primera pasada — estado

| # | Estado |
| --- | --- |
| **m1** — sexta aserción caducada (`wallet-tiendas-desglose`) | **CERRADO, y bien.** El caso pasa a medir el redondeo con importes que **discriminan** (acarreo `999.99` a `₡1.000`; once dígitos `12345678901.99` a `₡12.345.678.902`) y añade un barrido money-safe sobre `DesgloseMovimientosTienda.tsx`, un fuente que **no cubría ninguna guardia del repo**. Cierra con más red de la que tenía |
| **m2** — prosa obsoleta en los dos módulos | **CERRADO.** Cero apariciones de `₡9.999.999.999,99` en `app/` y `components/`; las dos que quedan en `lib/` son relato histórico de un importe real, no una promesa de formato |
| **m3** — R20 discrimina en un solo caso | **anotado** en `impl_230.md` §1, sin maquillar. Aceptable |
| **m4** — el diente 1 mide cuatro caminos, no cinco | **anotado** en `impl_230.md` §1 |
| **m5** — C8 | ver **n5**: decidido, no registrado |

## Veredicto

**APROBADO.**

B1 está cerrado con el arreglo correcto —un máximo se redondea hacia abajo— y con dos redes que
verifiqué mordiendo por separado. B2 está cerrado: se miró la app de verdad, la medición está
autocomprobada, y el único texto que no llegó a pintarse es hoy el mejor cubierto del diff. B3
está cerrado en sustancia: el mapa de los 20 existe, coincide con mi comprobación independiente
y no esconde sus matices.

Antes del PR queda lo que ya estaba acordado y sigue siendo del leader: **`./init.sh` completo,
sin excepción** (T6.1) y el PR (T6.4). Recomiendo, sin bloquear: cerrar **n2** (tres líneas de
registro) y **n5** (abrir la ficha de C8) antes de mergear, porque son los dos que se pierden en
cuanto la rama se cierra; **n1** y **n4** pueden ir en la 232, que toca esa misma superficie.
