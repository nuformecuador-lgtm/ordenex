# Feature 230 — bitácora de `backend_dev` (bloques 1, 2 y 3)

> Alcance ejecutado: `lib/config/moneda.ts`, `tests/unit/config/moneda-formato.test.ts` y la guardia
> nueva `tests/unit/guards/dinero-sin-centimos.guardia.test.ts`. **Ni un byte de `app/**` ni de
> `components/**`** (bloques 4 y 5, de `frontend_dev`). Sin commits: en este repo commitea el leader.

---

## 1. Archivos tocados

| Archivo | Qué | Bloque |
| --- | --- | --- |
| `lib/config/moneda.ts` | **modificado** — `sumarUno`, `redondearEnteros`, `esCero`, nuevo cuerpo de `formatMontoString`, docstrings (R18) y `separadorDecimal` documentado según Q1(b) | 1 |
| `tests/unit/config/moneda-formato.test.ts` | **modificado** — 23 → 30 tests | 2 |
| `tests/unit/guards/dinero-sin-centimos.guardia.test.ts` | **nuevo** — 19 tests, 5 dientes | 3 |

`git diff --stat`: 2 archivos modificados, 331 inserciones, 76 borrados, **0 migraciones** y **0
cambios en `db/schema.prisma`** (R17 por el lado del diff).

---

## 2. El algoritmo (bloque 1)

`sumarUno` está escrito con una expresión regular, `/^(\d*)([0-8])(9*)$/`, y **no** con el bucle de
derecha a izquierda que describe `design.md` §2.2. Es el **mismo acarreo** —`(\d*)` es codicioso, así
que `([0-8])` cae sobre el último dígito que no es `'9'` y `(9*)` es la cola que se pone a cero— pero
sin **una sola operación aritmética, ni siquiera sobre el índice del recorrido**. Se eligió así
porque el criterio de Hecho de T1.1 dice literalmente «la función no contiene `Number(`,
`parseFloat(`, `parseInt(` **ni aritmética sobre números**», y cualquier bucle lleva un `i -= 1`.
Es una desviación de **forma**, no de fondo; el caso «todo nueves» (sin `[0-8]`) es el que antepone
el `'1'`, y está cubierto por la mutación M6.

El redondeo va **antes** de `agruparMiles` (mutación M4 lo demuestra) y el signo cae cuando el
resultado es cero (mutación M5).

**Tabla de contrato de `design.md` §2.4: pasa entera**, más los casos de R2/R3/R4/R6/R7 de
`requirements.md`. Incluye `"000123.60" → ₡000.124` (ceros a la izquierda conservados, declarado en
§2.4) y `"-0" → ₡0` (antes daba `-₡0`; es la generalización de R4 y no había test que lo fijara).

---

## 3. Decisión Q1(b) aplicada

`separadorDecimal` **se conserva** y cambia de oficio: deja de ser «el separador que se pinta» y pasa
a ser **«el carácter que la guardia vigila»**. Está escrito así en el docstring del campo
(`lib/config/moneda.ts`), y la guardia **lo lee de `monedaConfig`** en vez de escribir la coma a mano
(`CON_DECIMAL` y `CON_DOS_DECIMALES` se construyen con `escaparRegex(monedaConfig.separadorDecimal)`).
Hay un test que lo fija en los dos sentidos: el campo **sí** cambia por entorno y la salida **no**
(`moneda-formato` → «cambiar el separador DECIMAL no altera ni un byte de la salida (Q1(b))»).

---

## 4. Mapa `R<n> → test`, con el nombre del test ejecutado

| R | Test ejecutado | Archivo | Estado |
| --- | --- | --- | --- |
| R1 | «ninguna salida lleva el separador decimal seguido de un digito (R1, R12)» | guardia, diente 1 | ✅ |
| R1 | «ninguna salida con forma decimal lleva el separador decimal seguido de un digito (R1)» | `moneda-formato` | ✅ |
| R2 | «el medio se aleja del cero, tambien en negativo (R2, D1)» + «agrupa los miles y redondea la cola decimal en vez de pintarla» | `moneda-formato` | ✅ |
| R3 | «el acarreo que añade un digito REAGRUPA los miles (R3)» | `moneda-formato` | ✅ |
| R4 | «el cero redondeado NO lleva signo (R4)» | `moneda-formato` | ✅ |
| R5 | «un importe sin parte decimal se pinta como siempre: ni inventa ni altera digitos (R5)» + «el separador de miles no se cuela delante del primer grupo» | `moneda-formato` | ✅ |
| R6 | «con mas de dos decimales manda el PRIMERO, y el resto se ignora (R6)» | `moneda-formato` | ✅ |
| R7 | «el modulo no llama a `Number(`, `parseFloat(` ni `parseInt(`» (`:238` conservado, contraprueba incluida) + «el redondeo de un importe que un `number` no puede representar es EXACTO» | `moneda-formato` | ✅ |
| R8 | «lo que no tiene forma de decimal se pinta tal cual, sin fingir que no hay monto» (**sin tocar**) + «la rama VERBATIM queda FUERA del diente 1, y se dice por que (C2)» | `moneda-formato` + guardia, diente 4 | ✅ |
| R9 | «`null` usa el marcador por defecto del modulo», «acepta OTRO marcador por parametro…», «una cadena vacia o en blanco tambien es ausencia…» (**los tres sin tocar**) | `moneda-formato` | ✅ |
| R10 | «el signo negativo va DELANTE del simbolo» + «el negativo lleva el signo delante del simbolo, igual que el de STRING» | `moneda-formato` | ✅ |
| R11 | «con otra configuracion cambian el simbolo y el separador de MILES» + «cambiar el separador DECIMAL no altera ni un byte de la salida (Q1(b))» | `moneda-formato` | ✅ |
| R12 | «los cinco caminos dan la MISMA cadena para el mismo importe (R12)» | guardia, diente 1 | ✅ |
| R15 | «el porcentaje conserva su decimal», «la duracion conserva su decimal», «el conteo sigue sin decimales» (los tres contra el mismo `Intl`) | guardia, diente 4 | ✅ |
| R16 | «los modulos de descarga existen y no importan el modulo de moneda» + «CONTRAPRUEBA: un fuente que SI lo importa es cazado» | guardia, diente 3 | ✅ |
| R17 | 0 migraciones y 0 cambios de `schema.prisma` en el diff; los tests de `lib/services/**` y `lib/repositories/**` siguen verdes **sin tocarlos** | — | ✅ |
| R18 | «ningun fuente de la superficie de dinero promete decimales en su prosa» + contraprueba | guardia, diente 5 | 🔴 **pendiente de `frontend_dev`** (ver §7) |
| R19(a) | diente 1 + **mutación M1 ejecutada** (formateador que conserva los céntimos → rojo) | guardia | ✅ |
| R19(b) | «ningun fuente de `app/**` ni `components/**` llama a `.toFixed(` sobre un importe (R19b)» + «CONTRAPRUEBA: el codigo VIEJO de la celda del resumen de carga es cazado, y el bueno no» | guardia, diente 2 | 🔴 **muerde hoy sobre la fuga real** (ver §7) |

**R13, R14 y R20 son de `frontend_dev`** (bloques 4 y 5) y no se tocan aquí.

---

## 5. Verificación — salida real

### `pnpm exec vitest run` de mis dos archivos (estado final del árbol)

```
 ❯ tests/unit/guards/dinero-sin-centimos.guardia.test.ts (19 tests | 2 failed) 174ms
     × ningun fuente de `app/**` ni `components/**` llama a `.toFixed(` sobre un importe (R19b) 60ms
     × ningun fuente de la superficie de dinero promete decimales en su prosa 2ms
 Test Files  1 failed | 1 passed (2)
      Tests  2 failed | 47 passed (49)
```

`tests/unit/config/moneda-formato.test.ts`: **30 tests, 30 verdes.**

### `./init.sh --rapido` — **EXIT 1**

```
✓ typecheck paso
✓ lint paso                      (69 problems, 0 errors, 69 warnings — todos preexistentes;
                                  cero en mis tres archivos, comprobado con grep)
✗ 'pnpm run test:rapido' fallo
 Test Files  36 failed | 132 passed (168)
      Tests  149 failed | 2267 passed (2416)
   Duration  143.04s
```

**Desglose de los 36 rojos, uno a uno:**

- **35** son el censo del **bloque 5 de `frontend_dev`** (las 265 líneas que afirman un importe con
  dos decimales). Es el radio medido en T1.5 y es exactamente lo que el spec secuencia después de
  mí. Ninguno es una regresión: caen todos con `expected '₡1.000' to be '₡1.000,10'` y equivalentes.
- **1** es mi guardia, con **2** tests, y los dos apuntan a tareas pendientes de `frontend_dev`
  (T4.1 y T4.3). Ver §7.
- `tests/unit/config/moneda-formato.test.ts` **no** está entre los rojos.

### ⚠️ `test:rapido` es `test:cambiados && test:guardias` — y el `&&` cortocircuitó

Como `test:cambiados` salió en rojo, **`test:guardias` no llegó a ejecutarse dentro de
`./init.sh --rapido`**. O sea: el gate rápido, tal y como está escrito, **no comprueba las guardias
cuando los tests relacionados fallan** — que es justo el momento en que más importa. Lo corrí
aparte:

```
> pnpm run test:guardias        (vitest run guard)
 Test Files  1 failed | 109 passed (110)
      Tests  2 failed | 1637 passed (1639)
   Duration  11.63s
```

**Cero guardias cruzadas rotas.** Las tres money-safe que gobiernan este diseño
(`liquidacion-money-safe`, `pagos-aritmetica-decimal`, `ordenes-columnas-money-safe`) siguen verdes.
El único rojo es el mío, con sus 2 tests conocidos.

---

## 6. Mutaciones — todas EJECUTADAS, con la salida real pegada

> Se aplicaron con un arnés (`mutar.mjs`) que **aborta con exit 1 si el texto buscado no aparece
> exactamente una vez** e imprime el antes y el después. Sin eso, una mutación que no se aplica se
> reporta como «superviviente» sin haber cambiado nada — el fallo que ya ocurrió en este repo.
> El árbol quedó **restaurado y verificado** con `git diff` tras cada una.

| # | Mutación | Dónde | Resultado |
| --- | --- | --- | --- |
| **M1** | Revertir el paso 5 de design §2.3: los decimales se copian en vez de redondear (**el formateador de mentira**) | `lib/config/moneda.ts` | 🔴 **diente 1 rojo, 2482 hallazgos** |
| **M2** | El código viejo de la fuga, `row.montoCobrar.toFixed(2)` | `app/(app)/ordenes/_components/OrdenesCargaResumen.tsx:97` (**vive hoy en el árbol, no hizo falta inyectarlo**) | 🔴 **diente 2 rojo, nombra archivo y línea** |
| **M3** | `decimales.charAt(0) >= "5"` → `> "5"` (rompe half away from zero) | `redondearEnteros` | 🔴 13 de 30 |
| **M4** | Redondear **después** de agrupar en vez de antes | `formatMontoString` | 🔴 14 de 30 |
| **M5** | Quitar la caída del signo cuando el resultado es cero | `formatMontoString` | 🔴 2 de 30 |
| **M6** | `sumarUno` pierde el acarreo del caso «todo nueves» | `sumarUno` | 🔴 7 de 49 |
| **M7** | Un módulo de descarga importa y llama al formateador | `lib/utils/descarga-dataset.ts` | 🔴 diente 3 rojo |

### M1 — el formateador de mentira (R19a)

```
MUTACION APLICADA en lib/config/moneda.ts
--- ANTES ---
  const redondeado = redondearEnteros(enteros, decimales);
  const agrupado = agruparMiles(redondeado);
--- DESPUES ---
  const redondeado = enteros;
  const agrupado =
    decimales === null
      ? agruparMiles(redondeado)
      : `${agruparMiles(redondeado)}${monedaConfig.separadorDecimal}${decimales}`;
```

```
 ❯ tests/unit/guards/dinero-sin-centimos.guardia.test.ts (19 tests | 5 failed) 198ms
     × ninguna salida lleva el separador decimal seguido de un digito (R1, R12) 43ms
     × y en particular ninguna lleva los DOS decimales que pidio quitar el humano 25ms
     × CONTRAPRUEBA: un formateador que conserve los centimos SI es cazado 5ms
     × ningun fuente de `app/**` ni `components/**` llama a `.toFixed(` sobre un importe (R19b) 55ms
     × ningun fuente de la superficie de dinero promete decimales en su prosa 2ms

AssertionError: un camino de dinero emitio parte decimal: expected [ …(2482) ] to deeply equal []
+   "formatMontoString(\"13331832.72\") -> ₡13.331.832,72",
+   "formatMontoString(\"1234.49\") -> ₡1.234,49",
+   "formatMontoString(\"999.50\") -> ₡999,50",
+   "formatMontoString(\"-0.49\") -> ₡0,49",
   … 2478 más

 Test Files  1 failed (1)
      Tests  5 failed | 14 passed (19)
```

### M2 — la fuga real de la celda del resumen de carga (R19b)

No hubo que inyectar nada: **T4.1 todavía no está aplicada**, así que el código viejo está vivo en el
árbol y el diente 2 lo caza en su primera ejecución. Es la mordida más fuerte posible — sobre el
código real, no sobre uno inventado:

```
 FAIL  tests/unit/guards/dinero-sin-centimos.guardia.test.ts > guardia 230 · diente 2 …
AssertionError: un importe serializado sin pasar por el formateador compartido
(`@/lib/config/moneda`): expected [ Array(1) ] to deeply equal []
+ [
+   "app/(app)/ordenes/_components/OrdenesCargaResumen.tsx:97",
+ ]
```

Y dentro del propio test queda la contraprueba de que el diente **discrimina** (no denuncia todo):

```ts
expect(usosDeToFixed(celdaVieja, "celda")).toEqual(["celda:1"]);   // el viejo, cazado
expect(usosDeToFixed(celdaBuena, "celda")).toEqual([]);            // el bueno, no
```

### M3 — `>=` por `>` en el redondeo

```
--- ANTES ---   return decimales.charAt(0) >= "5" ? sumarUno(enteros) : enteros;
--- DESPUES --- return decimales.charAt(0) > "5" ? sumarUno(enteros) : enteros;

     × el medio se aleja del cero, tambien en negativo (R2, D1) 1ms
     × el acarreo que añade un digito REAGRUPA los miles (R3) 1ms
     × con mas de dos decimales manda el PRIMERO, y el resto se ignora (R6) 0ms
     … (13 en total)
 Test Files  1 failed (1)
      Tests  13 failed | 17 passed (30)
```

### M4 — redondear después de agrupar

```
--- DESPUES ---
  const agrupado = redondearEnteros(agruparMiles(enteros), decimales);
  const redondeado = agrupado;

     × el acarreo que añade un digito REAGRUPA los miles (R3) 0ms
AssertionError: expected '₡1000' to be '₡1.000' // Object.is equality
 Test Files  1 failed (1)
      Tests  14 failed | 16 passed (30)
```

Es exactamente el fallo que `design.md` §2.2 anticipa: el acarreo añade un dígito y la agrupación ya
había pasado.

### M5 — el signo no cae en el cero

```
--- ANTES ---   const signo = negativo && !esCero(redondeado) ? "-" : "";
--- DESPUES --- const signo = negativo ? "-" : "";

     × el cero redondeado NO lleva signo (R4) 4ms
     × el negativo lleva el signo delante del simbolo, igual que el de STRING 1ms
AssertionError: expected '-₡0' to be '₡0' // Object.is equality
 Test Files  1 failed (1)
      Tests  2 failed | 28 passed (30)
```

Dos tests y solo dos: la mutación de R4 no se lleva por delante nada más, que es lo que se quiere de
un test dirigido.

### M6 — `sumarUno` pierde el acarreo del «todo nueves»

```
--- ANTES ---   if (casa === null) return `1${enteros.replace(/9/g, "0")}`;
--- DESPUES --- if (casa === null) return enteros.replace(/9/g, "0");

     × el acarreo que añade un digito REAGRUPA los miles (R3) 1ms
     × el redondeo de un importe que un `number` no puede representar es EXACTO 1ms
Expected: "₡100"    Received: "₡00"
Expected: "₡1.000"  Received: "₡000"
 Test Files  2 failed (2)
      Tests  7 failed | 42 passed (49)
```

### M7 — una descarga pasa por el formateador (R16)

```
--- DESPUES ---
import { formatMonto } from "@/lib/config/moneda";
const _fuga = (n: number) => formatMonto(n);

     × los modulos de descarga existen y no importan el modulo de moneda 2ms
AssertionError: una descarga paso por el formateador de presentacion y perdio los centimos:
expected [ …(2) ] to deeply equal []
+   "lib/utils/descarga-dataset.ts: importa @/lib/config/moneda",
+   "lib/utils/descarga-dataset.ts: llama a formatMonto(",
 Test Files  1 failed (1)
      Tests  3 failed | 16 passed (19)
```

---

## 7. Lo que queda ROJO al cerrar mi tanda, y por qué NO lo arreglo yo

Los 2 tests rojos de mi guardia son **su handoff a `frontend_dev`**, no un fallo de esta tanda. Los
dos están fuera de mi alcance (`app/**` y `components/**`):

| Test rojo | Qué hay que hacer | Task |
| --- | --- | --- |
| diente 2 — «ningun fuente de `app/**` ni `components/**` llama a `.toFixed(`» | `app/(app)/ordenes/_components/OrdenesCargaResumen.tsx:97` → `formatMonto(row.montoCobrar)` | **T4.1** |
| diente 5 — «ningun fuente de la superficie de dinero promete decimales en su prosa» | 5 líneas de docstring, nombradas con archivo y número (abajo) | **T4.3** + ver contradicción C5 |

```
components/shared/PriceLabel.tsx:17: * separador de miles y SIEMPRE dos decimales (`₡1.234,50`, `₡0,00`). UI pura,
components/shared/PriceLabel.tsx:20: * Si el valor no existe o no es un número válido muestra `₡0,00` —no el marcador
components/shared/PriceLabel.tsx:30: *    `₡1.234,50` y no era lo que salía por pantalla.
components/shared/KpiValorAnimado.tsx:21: // el de `Intl` con `style: "currency"` («₡3 500,00», con espacio duro) hasta que
components/shared/KpiValorAnimado.tsx:22: // la feature 201 unifico la agrupacion en `lib/config/moneda.ts` («₡3.500,00»).
```

El spec lo prevé: T3.2 dice «con el árbol actual (**ya con T4.1 aplicada**) sale verde» y T3.5
depende de T4.1. La alternativa —recortar la guardia para que hoy salga verde— dejaría R18 y R19(b)
sin test, que es lo que el reviewer rechaza.

---

## 8. T1.5 — el radio real del cambio (entrada del bloque 5 de `frontend_dev`)

`pnpm exec vitest related --run lib/config/moneda.ts`, medido **antes** de tocar ningún test:

```
 Test Files  36 failed | 131 passed (167)
      Tests  160 failed | 2230 passed (2390)
   Duration  143.34s
```

Los 36 archivos, cruzados con el censo de 39 de `tasks.md` bloque 5:

- **T5.1 wallet (8/8)**, **T5.2 cierres (6/6)**, **T5.3 pagos (9/9)**, **T5.4 operación (8/8)** —
  completos.
- **T5.5 precio/ranking/analítica: solo 3 de 5.** `TableroFinanciero` y `AnalyticsKpiCard`
  **no fallan**: su aserción de importe no llega al formateador. Se releen igual, pero no son rojo.
- **T5.6 (`lib/`): 0 de 2.** `indemnizacion-tope-negocio-incidente` y
  `financiera-unidad-de-vistas.guardia` **no fallan** → su importe de dos decimales es de la
  **frontera/DTO** (escala 2), no de lo pintado. Es justo el caso que T5.6 manda **no tocar**, y
  queda medido en vez de supuesto.
- **+1 archivo que NO está en el censo de 39:** `tests/unit/components/analytics-formato.test.ts`
  (1 test: `formatear(3500, "moneda")` esperaba `"$3.500,00"`). **Añadir al lote T5.5.**
  Sus tests de porcentaje y duración siguen **verdes** — R15 sostenido en su propio archivo.

---

## 9. Consecuencias y contradicciones

### Ya aceptadas por el humano (son decisiones, no hallazgos)

- **A1** — una columna puede no cuadrar a ojo con su total por ±1/±2 (consecuencia directa de R20).
- **A2** — se dejan de ver céntimos que la base sí guarda; el dato exacto sigue en base y descargas.
- **A3** — cambio visible en todas las pantallas de dinero a la vez, sin interruptor.
- **C1** — `PriceLabel` y `KpiValorAnimado` ya pasan hoy por un `double` vía `toValidNumber`;
  preexistente y fuera de alcance. R7 es una afirmación sobre el **formateador**, no sobre la app.
- **C2** — la rama verbatim puede emitir `₡1,50`; escrito como test propio (diente 4), fuera del
  diente 1.
- **C3** — doble redondeo en el camino numérico; **fijado** con un test que lo explica en vez de
  dejarlo implícito.
- **C4** — los docstrings que mentían; cubierto por R18 (diente 5).

### Contradicciones ENCONTRADAS entre el spec y el código (nuevas)

- **C5 — `design.md` §5/C4 dice «dos docstrings» y son TRES archivos.**
  Además de `formatMonto` (mío, ya corregido) y `PriceLabel` (T4.3), `components/shared/
  KpiValorAnimado.tsx:21-22` afirma que el formato resultante es «`₡3.500,00`». Tras la 230 es
  `₡3.500`, así que también miente. **No hay ninguna task que lo cubra**: T4.2 solo manda cambiar
  `decimals`. Está en el censo del diente 5 a propósito, porque una guardia de R18 que omitiera un
  mentiroso conocido sería una guardia que miente. `frontend_dev` tiene que tocar esas dos líneas.

- **C6 — `tasks.md` T2.3 afirma que 5 tests pasan «sin editar una línea», y uno sí hay que tocarlo.**
  `:128` («un importe con espacios alrededor se formatea igual») afirmaba
  `formatMontoString(" 1500.50 ") === "₡1.500,50"`. Lo que el test **afirma** es el `trim`, pero su
  valor esperado es un aspecto y el aspecto cambió. Reescrito a `₡1.501` **y reforzado** con
  `expect(formatMontoString(" 1500.50 ")).toBe(formatMontoString("1500.50"))`, que afirma el `trim`
  sin depender del formato. Los otros cuatro (`:106`, `:110`, `:121`, `:132`) **sí** quedaron
  intactos, verificado en el diff.

- **C7 — `tasks.md` bloque 3 enumera CUATRO dientes; la tabla de trazabilidad exige un QUINTO.**
  R18 se mapea a «`dinero-sin-centimos.guardia` → prosa de la superficie de dinero», pero no hay
  ninguna task T3.x que lo pida. Implementado como **diente 5**.
  `components/private/analytics/formato.ts` queda **excluido del censo a propósito y por escrito**:
  su docstring escribe `0,842` para explicar que un porcentaje llega como fracción, y el porcentaje
  **conserva** su decimal (D2/R15). Incluirlo pondría la guardia roja por documentar bien justo el
  no-objetivo.

- **C8 — `test:rapido` no corre las guardias cuando los tests relacionados fallan.**
  `"test:rapido": "pnpm run test:cambiados && pnpm run test:guardias"`. El `&&` cortocircuita, y
  `docs/verification.md` promete que «las guardias van SIEMPRE» precisamente porque ningún grafo de
  imports las selecciona. Hoy la promesa se rompe justo cuando hay un rojo. Un `;` o un
  `|| GUARDIAS_FALLARON=1` lo arreglaría. **No lo toco**: `package.json` no es de mi alcance y esto
  es una ficha propia. Mientras tanto, corrí `pnpm run test:guardias` aparte y está en §5.

- **C9 — un archivo de test fuera del censo de 39** (`tests/unit/components/analytics-formato.test.ts`).
  Ver §8.

### Desviación de forma declarada

- `sumarUno` con expresión regular en vez del bucle de `design.md` §2.2 (§2 de esta bitácora).
  Mismo acarreo, misma semántica, cero aritmética. Cubierto por M6.

---

## 10. Veredicto

Bloques 1, 2 y 3 **hechos y probados con mutaciones ejecutadas**: `typecheck` y `lint` en verde, los
30 tests del contrato y 17 de los 19 de la guardia en verde, y los **2 rojos que quedan son la
guardia mordiendo el trabajo pendiente de `frontend_dev`** (T4.1 y los docstrings de R18), no una
regresión.
