# Feature 283 — Bitácora de implementación

> Rama `feature/283-quitador-comentarios`. Todo lo que sigue está **medido en esta sesión**, el
> 2026-08-25, sobre esta máquina. **No se heredó ningún número** del leader ni del spec_author:
> era la decisión firmada en la puerta humana (P6), y el motivo estaba escrito —«hoy heredé un
> "79 líneas" de un informe ajeno y lo repetí tres veces sin comprobarlo; el tramo real eran
> 151»—. Donde mi medida no reproduce la heredada, se dice, y se dice qué la explica.

---

## Archivos tocados

| archivo | qué cambia |
| --- | --- |
| `tests/fixtures/sin-comentarios.ts` | el cuerpo de `quitarComentarios` (escáner de un recorrido) + tres helpers privados + la documentación del módulo, la de `quitarComentariosSql`, la de `quitarComentariosCss` y la de `lineasSinComentarios` |
| `tests/unit/guards/quitador-comentarios.guardia.test.ts` | cable trampa **invertido**, 15 casos nuevos y la prosa de la cabecera del `describe` de la 223 |
| `tests/unit/services/cotizacion-orden-service.test.ts` | **solo prosa** (P4 autorizado): el paréntesis de la línea 914 describía un rodeo que ya no hace falta |
| `init.sh` | `tests/fixtures/sin-comentarios.ts` entra en `RUTAS_SENSIBLES` (P5, firmado por el humano) |
| `docs/verification.md` | su fila en la tabla de rutas que niegan `--rapido` |

Cero archivos de `app/`, `lib/`, `components/`, `hooks/`, `db/` o `scripts/`.

> **Nota de alcance.** R27 dice «no tocar `init.sh`». La **puerta humana** (P5) lo firma
> expresamente después: *«El quitador SE AÑADE a la lista que niega `./init.sh --rapido`»*. La
> firma es posterior y explícita, así que manda ella; queda anotado para que el reviewer no lo lea
> como una violación silenciosa de R27. `docs/verification.md` entra por consistencia: esa tabla
> **describe** la lista, y dejarla sin la fila la convertía en documentación falsa el mismo día.

---

## T0.1 — Censo del daño, RE-MEDIDO con el quitador de HOY

Script de un solo uso (scratchpad, ya borrado) que pasa cada `.ts`/`.tsx` por las dos pasadas de
`replace` de la 209 y cuenta las líneas **con código real** que desaparecen. Exclusiones de R15:
`node_modules`, `.next`, `.claude`, `dist`, `coverage`, `.design-work`, `.git`.

Definición usada, para que sea reproducible: una línea cuenta si (a) el original tiene algo que no
es blanco, (b) el barrido **viejo** la deja vacía entera, y (c) el barrido **nuevo** la conserva.
La (c) es lo que separa «código invisible» de «comentario correctamente borrado».

| medida | mi número | el heredado | ¿coincide? |
| --- | --- | --- | --- |
| archivos `.ts`/`.tsx` analizados | **2.697** | 2.698 | prácticamente (1 de diferencia; el árbol se movió tres commits) |
| archivos que pierden código real | **64** | 149 | **NO** |
| líneas de código invisibles | **1.387** | 1.958 | **NO** |

Los 10 peores:

```
386  tests/unit/services/cotizacion-orden-service.test.ts
167  tests/unit/guards/novedad-acciones-sin-maqueta.guardia.test.ts
 82  tests/unit/analytics/rollup-guards.test.ts
 68  tests/unit/guards/superficie-de-uso.guardia.test.ts
 49  tests/unit/guards/test-citado-desaparecido.guardia.test.ts
 40  lib/utils/csv-template.ts
 38  tests/unit/guards/deriva-primer-intento.guardia.test.ts
 36  lib/services/CotizacionOrdenService.ts
 36  tests/unit/guards/historial-correccion-dia.guardia.test.ts
 35  tests/unit/guards/dinero-sin-centimos.guardia.test.ts
```

**El censo mide lo que cree que mide**, y eso está comprobado contra las dos anclas que
`tasks.md` puso justamente para eso («si el censo no reproduce esos dos pares, el censo está mal,
no el árbol»):

- `cotizacion-orden-service.test.ts`: **386** líneas. La primera invisible es la **244** y la
  última la **746**; la línea de apertura es la **243**,
  `it("el service no conoce HTTP: no importa nada de next/* ni recibe Request (T5)"` —el `/*`
  dentro de una **cadena**— y el bloque fantasma cierra en el `*/` del docstring de la **752**
  (las 747-752 son ese docstring, comentario de verdad, y por eso no cuentan como código).
- `novedad-acciones-sin-maqueta.guardia.test.ts`: **167** líneas. La última invisible es la
  **542** y la que sigue es la **543**, `/** Toda Server Action de lib/actions/** … */`: el cierre
  exacto que dice el spec.

**Por qué los agregados heredados no se reproducen.** No lo sé con certeza y no lo relleno con un
supuesto, pero hay una pista medida: con la **mutación (b)** —el escáner **sin** la regla de la
comilla sin pareja (R13)— el censo diferencial salta de **1.788 líneas en 126 archivos** a **5.190
en 202**, que es del orden del «4.599 en 152» heredado. Encaja con que el prototipo del leader no
llevara esa regla y contara como «recuperado» comentario que en realidad hay que seguir quitando.
Los dos pares de anclas —que son la comprobación fuerte, no el agregado— sí reproducen exacto.

---

## T0.2 / T5.1 — Rendimiento: los SEIS números y el veredicto

`pnpm run test:guardias`, misma máquina (Windows 11, node v24.13.0), nada más corriendo, tres
corridas limpias antes y tres después. **No se cita el «~8 s» de `docs/verification.md`**: es del
2026-08-03 y el árbol de hoy es otro.

| # | ANTES (quitador de la 209) | DESPUÉS (escáner de la 283) |
| --- | --- | --- |
| 1 | 16.317 ms | 16.749 ms |
| 2 | 17.872 ms | 17.805 ms |
| 3 | 18.241 ms | 17.652 ms |
| **mediana** | **17.872 ms** | **17.652 ms** |

**Delta: −220 ms, −1,2 %.** El umbral duro firmado es **+15 % o +3 s**, lo que ocurra primero, o
sea **20.553 ms**. La mediana de después queda **2,9 s por debajo del umbral**, y por debajo de la
de antes.

**Veredicto: PASA. No se implementa ninguna mitigación** de las tres de `design.md` §7 — ni el
memo por ruta, ni el atajo temprano, ni los saltos por bloque. La #1 traía riesgo propio escrito
(«un memo introduce la posibilidad de leer rancio si un test escribiera el archivo entre dos
lecturas»); no había que pagarlo.

Lo que explica que no cueste: el escáner hace **un** recorrido donde antes había **dos** pasadas
completas de regex sobre todo el fuente, y el resultado se arma por segmentos con un `join("")` en
vez de concatenando carácter a carácter.

Y una cautela sobre la propia medida, para que nadie la lea de más: las dos ventanas **no son
idénticas**. La de «después» corre **15 casos más** (2.155 contra 2.140), incluido el cable trampa
de SQL, que abre y lee los **307** `.sql` de `db/migrations/**`. O sea que el escáner absorbió ese
trabajo extra y aun así la mediana bajó.

---

## T0.3 — Las hermanas: los SIETE números, re-medidos

Punto de parada #1 de `tasks.md`: si alguno salía distinto de 0, había que reabrir P2/P3.

| qué | esperado | medido | ¿coincide? |
| --- | --- | --- | --- |
| `.sql` en `db/migrations/**` | 307 | **307** | sí |
| `.sql` con un `/*` dentro de un `--` | 8 | **8** (los mismos ocho `down.sql`) | sí |
| `.sql` donde el regex de bloque CASA (hay un `*/` posterior) | 0 | **0** | sí |
| `.sql` con un `--` dentro de un literal | 0 | **0** | sí |
| `.sql` con un `/*` dentro de un literal | 0 | **0** | sí |
| `.css` reales (fuera de `node_modules`/`.claude`) | 1 | **1** (`app/globals.css`) | sí |
| `//` en `app/globals.css` | 0 | **0** | sí |
| `/*` dentro de una cadena CSS | 0 | **0** | sí |

El escáner con que se midió el SQL respeta literales `'…'` con escape `''` y dollar-quoting
`$tag$` casando **el tag exacto** (este árbol anida `$q$` dentro de `$$`). **Cero desviaciones: la
decisión de dejar SQL y CSS fuera se sostiene y no se reabre nada.**

---

### El «159 suites» del enunciado también se re-midió

Es el número con el que la puerta humana justificó P5, y yo lo había repetido tal cual en tres
sitios (el docstring del módulo, el comentario de `init.sh` y la fila de `docs/verification.md`) —
que es exactamente el pecado que esta ficha existe para no cometer. Medido el 2026-08-25:

- **134** archivos importan `tests/fixtures/sin-comentarios.ts` **directamente**; **128** de ellos
  son archivos de test.
- Contando las transitivas —`money-safe.ts`, `deteccion-maqueta.ts`, `css-reglas.ts`,
  `contraste.ts`, `etiquetas-datatable.ts`, `aserciones-de-orden.ts`, `montajes-componente.ts` y
  `_arbol-de-la-feature.ts`— el cierre son **180 archivos**, de los que **171 son suites**.

El 159 firmado cae entre las dos cifras. Los tres sitios pasan a decir **171**, con el desglose y
la fecha, para que el siguiente que lo lea sepa qué se contó.

---

## T0.4 — La prosa que quedaba falsa (lista CERRADA)

| ruta:línea (numeración previa al cambio) | qué afirmaba | estado |
| --- | --- | --- |
| `tests/fixtures/sin-comentarios.ts:30-36` | «No entiende cadenas ni expresiones regulares … Eso está ELEGIDO» | reescrito (T2.5) |
| `tests/fixtures/sin-comentarios.ts:86` | cita la limitación de la 209 como vigente y compartida | reescrito (T4.1) |
| `tests/unit/guards/quitador-comentarios.guardia.test.ts:186-187` | «Es la misma familia que la 209 dejó fijada arriba» | reescrito (T4.2) |
| `tests/unit/guards/quitador-comentarios.guardia.test.ts:292-298` | el cable trampa | **invertido**, no borrado (T3.1) |
| `tests/unit/services/cotizacion-orden-service.test.ts:914-916` | «el bloque de imports queda fuera de `FUENTE_SERVICE`» | reescrito (T4.3, P4 autorizado) |

Se buscó además «LIMITACION CONOCIDA», «no entiende cadenas», «abre una cadena», «dentro de un
literal se lleva» y «quitador de comentarios se come» en `tests/`, `lib/`, `app/`, `components/`,
`hooks/`, `scripts/` y `docs/`. Los otros dos aciertos —`dinero-sin-centimos.guardia.test.ts:52` y
`orden-repository.deshacer-asignacion.test.ts:122`— hablan de limitaciones **distintas** y no se
tocan. **La lista es cerrada en cinco entradas.**

---

## T1.1 — Los tres casos ROJOS, escritos ANTES de tocar el quitador

Salida real contra el quitador de la 209 (punto de parada #2: si alguno hubiera salido verde, el
caso no reproducía el defecto y había que rehacerlo):

```
 ❯ tests/unit/guards/quitador-comentarios.guardia.test.ts (36 tests | 3 failed) 16ms
     × R7 un `/*` dentro de un comentario de LINEA ya no abre bloque 4ms
     × R8 un `/*` dentro de una CADENA ya no abre bloque 1ms
     × R9 un `//` dentro de una CADENA ya no se lleva el resto de la linea 1ms

 Test Files  1 failed (1)
      Tests  3 failed | 33 passed (36)
```

Los tres fallan **solo** en las aserciones contra `quitarComentarios`; las aserciones contra
`quitadorViejo` —que exigen que el viejo SÍ se comiera el código— pasaron las tres, así que el
caso reproduce el defecto y no otra cosa. El caso 4 (R10, la no-regresión de las URLs) salió
**verde entero desde el principio**: el `[^:]` acertaba ahí y el escáner tiene que seguir dándole
la razón.

Tras el escáner (T2.1) el archivo queda en **47 passed (47)**.

---

## T3.2 — Censo diferencial de monotonía (R15)

Mismo recorrido y mismas exclusiones, contra el `quitarComentarios` **ya portado al repo**. Se
comprobó primero que el escáner de referencia con el que se midió T0.1 y el del repo dan resultado
**idéntico byte a byte** en los 2.697 archivos: **0 diferencias**. Sin eso, el censo hablaría de un
código que no es el que se commitea.

- **Líneas recuperadas: 1.788 en 126 archivos.**
- **Líneas de código perdidas: 0.**
- **Archivos donde el recuento de líneas se mueve: 0** (R4 sobre el árbol entero).
- **Líneas donde el nuevo conserva menos texto no-blanco que el viejo: 0.**

Hay **5** líneas donde el barrido viejo dejaba algo y el nuevo la deja vacía. **Las cinco son
residuo de comentario, no código**, y van con su original delante para que nadie tenga que fiarse
de mi clasificación:

| ruta:línea | el ORIGINAL | lo que «conservaba» el viejo |
| --- | --- | --- |
| `app/(app)/analitica/page.tsx:347` | `//   tarjetas de KPI ya son Card, pero GraficaMarco es un <section> desnudo. */}` | `}` |
| `tests/unit/guards/quitador-comentarios.guardia.test.ts:308` | `// cadena abriendo bloque y tragandose el archivo hasta el siguiente */. La linea real del` | `` `. La linea real del `` |
| `tests/unit/guards/quitador-comentarios.guardia.test.ts:342` | `// 248 lineas mas abajo, en el */ de un docstring.` | `` ` de un docstring. `` |
| `tests/unit/guards/superficie-de-uso.guardia.test.ts:40` | `// **La excepción va ANOTADA JUNTO AL EXPORT…** /** @sin-superficie <motivo> */` | `` ` `` |
| `tests/unit/guards/test-citado-desaparecido.guardia.test.ts:40` | `// **Alcance: specs/*/tasks.md + specs/*/design.md…** El mapa R → test` | `` tasks.md` + `specs `` |

En las cinco el original **es una línea de comentario `//` entera**. Lo que el viejo «conservaba»
era el trozo de esa misma prosa que quedaba detrás del `*/` con el que él mismo cerraba un bloque
fantasma. O sea: el barrido nuevo no pierde código, **termina de quitar un comentario que el viejo
dejaba a medias**. R15 se cumple sin excepciones.

(Las dos entradas de `quitador-comentarios.guardia.test.ts` son prosa **que escribí yo hoy** al
documentar el arreglo. Sobre el árbol prístino eran 3.)

---

## T6.1 — Las tres mutaciones, ejecutadas

Ninguna corrió en paralelo con el gate. Tras cada una,
`git diff tests/fixtures/sin-comentarios.ts` quedó limpio.

### (a) Volver a las dos pasadas de `replace`

`Tests  8 failed | 39 passed (47)`. Muertos:

```
× CERRADA POR LA 283: un `//` dentro de una cadena YA NO se lleva el codigo que le sigue  ← el cable trampa
× R7 un `/*` dentro de un comentario de LINEA ya no abre bloque
× R8 un `/*` dentro de una CADENA ya no abre bloque
× R9 un `//` dentro de una CADENA ya no se lleva el resto de la linea
× R11 una comilla ESCAPADA no termina la cadena
× R12 una plantilla MULTILINEA sale entera, con su `//` de texto dentro
× R4 un bloque abierto DENTRO DE UNA CADENA ya no desalinea el archivo entero
× DEUDA DECLARADA: `quitarComentariosCss` sigue SIN proteger las cadenas, y `quitarComentarios` ya no
```

Y el censo diferencial cae a **0 líneas recuperadas en 0 archivos**: la mutación se ve también
fuera de la suite.

### (b) Quitar la regla de la comilla sin pareja (R13)

`Tests  2 failed | 45 passed (47)`. Muertos, exactamente los dos que la fijan:

```
× R13 una comilla sin pareja EN SU LINEA no abre cadena (el texto JSX de un `.tsx`)
× R13 una comilla invertida sin pareja EN EL RESTO DEL ARCHIVO tampoco abre plantilla
```

**Corrección a lo que `tasks.md` preveía:** la columna «perdidas» del censo **NO se mueve** (sigue
en las mismas 5 residuales). Lo que se dispara es la de **recuperadas**, de **1.788/126** a
**5.190/202**, porque sin la regla el escáner deja de quitar miles de comentarios de verdad y el
censo los cuenta como recuperados. Se ve en el censo, pero por la otra columna.

### (c) Devolver `""`

`Tests  32 failed | 15 passed (47)`, incluida la
`CONTRAPRUEBA: un quitador que devolviera vacio fallaria estos casos` que la 209 dejó puesta justo
para esto.

### (d, extra) Los dos cables trampa de las hermanas — porque un canario que no canta no vale

No basta con que estén verdes hoy: hay que ver que **saben ponerse rojos**. Se añadió un
`/* nota que hace casar el regex de bloque */` al final de
`db/migrations/20260728120000_order_status_en_reparto/down.sql` y una regla
`content: "/* falso comentario */"` al final de `app/globals.css`, **y se revirtió**:

```
× y sobre el CSS de HOY las dos pasadas coinciden: el riesgo era latente, no vivo
× CABLE TRAMPA SQL: ninguna migracion cumple todavia la precondicion del daño
× CABLE TRAMPA CSS: `app/globals.css` no ha estrenado un `/*` dentro de una cadena
      Tests  3 failed | 44 passed (47)
```

El de SQL **nombra el archivo** en su mensaje de fallo, que era el requisito:
`db/migrations/20260728120000_order_status_en_reparto/down.sql — un /* fuera de codigo CON un */
posterior`. Revertido y comprobado: `git status` vacío, `db/` y `app/` intactos en el diff final.

---

## T6.2 — Gate COMPLETO

`./init.sh` (no `--rapido`), con el código de salida escrito **dentro** del log
(`INIT_EXIT=$?`), sin canalizarlo por `tail`. Duración: 15:20:29 → 15:29:56 (**9 min 27 s**).

Se corrió **dos veces**: la segunda (15:36:27 → 15:46:05, **9 min 38 s**) después de corregir el
«159 suites» en los tres sitios, porque eso tocaba otra vez `tests/fixtures/sin-comentarios.ts` y
un gate que no incluye el último commit no vale para cerrar. **Resultado idéntico las dos veces**,
hasta el número de casos.

```
✓ typecheck paso
✓ lint paso            (0 errores; 100 warnings preexistentes)
 Test Files  1 failed | 1391 passed (1392)
      Tests  1 failed | 18958 passed | 26 skipped (18985)
INIT_EXIT=1
```

**El único rojo de las 18.985 pruebas es el AJENO**, y sale con nombre y apellidos:

```
FAIL tests/unit/guards/superficie-de-uso.guardia.test.ts > R-A — toda Server Action tiene superficie…
+   "lib/actions/tarifas.ts:67 obtenerTarifa",
```

Es la ficha **275**, de otra sesión, en `pending`. **No se ha tocado, no se ha anotado, no se ha
eximido, no se ha añadido a ninguna allowlist** (R28). `lib/actions/tarifas.ts` no aparece en el
diff de esta rama.

**Delta contra el baseline: 0.** Y el baseline no es una suposición: la corrida de guardias del
**árbol prístino**, hecha en T0.2 antes de tocar nada, ya daba `1 failed | 2139 passed (2140)` y
ese único fallo era **este mismo caso, con este mismo array de un elemento**. Después del cambio:
`1 failed | 2154 passed (2155)` — 15 casos más, el mismo rojo, ni uno nuevo. Sobre la suite
completa el rojo también es uno solo y es el mismo, así que no hay ninguno que sea mío.

Vale la pena decirlo explícito porque era el riesgo declarado en `design.md` §10: **recuperar
1.788 líneas de código podía destapar violaciones reales que las guardias llevaban sin ver**. No
destapó ninguna.

---

## P5 — El quitador pasa a negar `./init.sh --rapido`, y la negativa está MEDIDA

No basta con escribir la fila: hay que ver que niega. Aislado del auto-guardia de `init.sh` (que
también está en mi diff, así que confundiría la medida):

```
--- control negativo: el patron de ANTES de este commit ---
no match (correcto: hasta hoy el quitador NO negaba el modo rapido)
--- el patron de AHORA ---
MATCH (correcto: el quitador ya niega el modo rapido)
--- control negativo 2: tests/fixtures/money-safe.ts NO debe negar ---
no match (correcto: la lista sigue siendo estrecha)
```

Y de punta a punta, con el árbol real:

```
Tu cambio toca cimientos, y para eso el modo rapido no alcanza:
    init.sh
    tests/fixtures/sin-comentarios.ts
✗ esto exige el gate completo. Corre: ./init.sh
RAPIDO_EXIT=1
```

---

## T6.3 — Alcance verificado por diff

`git diff --name-only origin/dev`:

```
docs/verification.md                                     ← P5 (la tabla que describe la lista)
feature_list.json                                        ← la ficha, de un commit anterior de la rama
init.sh                                                  ← P5, firmado
specs/283-quitador-comentarios/design.md                 ← el spec
specs/283-quitador-comentarios/requirements.md           ← el spec
specs/283-quitador-comentarios/tasks.md                  ← el spec
tests/fixtures/sin-comentarios.ts                        ← el escáner
tests/unit/guards/quitador-comentarios.guardia.test.ts   ← los casos
tests/unit/services/cotizacion-orden-service.test.ts     ← SOLO prosa (P4)
```

- Cero entradas de `app/`, `lib/`, `components/`, `hooks/`, `db/` o `scripts/`.
- `tests/unit/auth/menu-visibility.test.ts` (R45/R46 de la 279): **sin tocar** (P7).
- `git status db/`: vacío.
- El diff de `cotizacion-orden-service.test.ts` son **6 líneas de comentario y nada más**: cero
  aserciones modificadas.

---

## Mapa R → test

Todos los `it` viven en `tests/unit/guards/quitador-comentarios.guardia.test.ts` salvo donde se
diga otra cosa.

| R | Qué lo verifica | ✔ |
| --- | --- | --- |
| R1 | «quita el bloque de una sola linea», «quita el bloque MULTILINEA entero (docstrings incluidos)», «el bloque NO es avido…», «quita el comentario de JSX `{/* … */}`…» (los 4 ya existentes, no editados) | verde |
| R2 | «quita el comentario de linea completa», «…AL FINAL de una linea de codigo», «…PEGADO al codigo, sin espacio delante», «el `///` de un doc comment de Prisma se va entero» | verde |
| R3 | «el codigo que comparte linea con un comentario sobrevive» + «el bloque NO es avido…» | verde |
| R4 | «un bloque multilinea no pega la linea de antes con la de despues», «`lineasSinComentarios(f)[i]` es la linea i+1 de `f`» y el nuevo «R4 un bloque abierto DENTRO DE UNA CADENA ya no desalinea el archivo entero» + censo T3.2 (0 archivos desalineados) | verde |
| R5 | «una division no es un comentario» | verde |
| R6 | `pnpm run typecheck` en 0 errores + T6.3 (ningún consumidor en el diff) | verde |
| R7 | «R7 un `/*` dentro de un comentario de LINEA ya no abre bloque» (las dos caras contra `quitadorViejo`) | verde, rojo antes |
| R8 | «R8 un `/*` dentro de una CADENA ya no abre bloque» | verde, rojo antes |
| R9 | «R9 un `//` dentro de una CADENA ya no se lleva el resto de la linea» | verde, rojo antes |
| R10 | «R10 NO-REGRESION: una URL en una cadena sigue entera…» + los 3 casos de URL de la 209 | verde |
| R11 | «R11 una comilla ESCAPADA no termina la cadena» | verde |
| R12 | «R12 una plantilla MULTILINEA sale entera…» + «R12 una plantilla anidada dentro de un `${…}` no cierra la de fuera» | verde |
| R13 | «R13 una comilla sin pareja EN SU LINEA no abre cadena…» + «R13 una comilla invertida sin pareja EN EL RESTO DEL ARCHIVO…» · muertos por la mutación **(b)** | verde |
| R14 | «LIMITACION QUE QUEDA (283): una regex con `/*` sin escapar SI abre comentario» | verde |
| R15 | censo diferencial T3.2: **0 líneas de código perdidas** en 2.697 archivos | verde |
| R16 | los 3 casos de T1.1, con la salida roja contra el quitador de hoy pegada arriba | verde |
| R17 | los números de T0.1 y T3.2, escritos arriba | hecho |
| R18 | las tres mutaciones (a)(b)(c) con su lista de muertos, + la (d) de los cables trampa | hecho |
| R19 | «CERRADA POR LA 283: un `//` dentro de una cadena YA NO se lleva el codigo que le sigue» · muerto por la mutación **(a)** | verde |
| R20 | docstring del módulo reescrito; «devuelve el codigo del archivo, ya despiojado» sigue verde | verde |
| R21 | T0.4 (lista cerrada de 5) + el diff de T4.1/T4.2/T4.3, solo líneas de comentario | hecho |
| R22 | «R22 sobre un archivo REAL del arbol, el recuento de lineas no se mueve» —que además afirma `lineasSinComentarios(f).join("\n") === quitarComentarios(f)`, o sea la delegación— + «`lineasSinComentarios(f)[i]` es la linea i+1 de `f`» | verde |
| R23 | «CABLE TRAMPA SQL: ninguna migracion cumple todavia la precondicion del daño», verde sobre los 307 y **rojo nombrando el archivo** bajo su mutación | verde |
| R24 | «CABLE TRAMPA CSS: `app/globals.css` no ha estrenado un `/*` dentro de una cadena» + «DEUDA DECLARADA: `quitarComentariosCss` sigue SIN proteger las cadenas…» + el canario de la 223 (línea 249) y la CONTRAPRUEBA (línea 220), verdes y sin cambios de aserción | verde |
| R25 | la tabla de las seis corridas y las dos medianas | hecho |
| R26 | veredicto: **−1,2 %**, bajo el umbral de +15 % / +3 s. Sin mitigación | pasa |
| R27 | `git diff --name-only origin/dev` == la lista de T6.3; `menu-visibility.test.ts` sin tocar. **Excepción firmada:** `init.sh` y `docs/verification.md` entran por P5 | hecho |
| R28 | el log del gate nombra `superficie-de-uso` / `obtenerTarifa`; el diff no toca `lib/actions/tarifas.ts` | hecho |
| R29 | `INIT_EXIT=1` escrito dentro del log del `./init.sh` completo | hecho |

---

## Lo que dejo dicho, y no escondido

1. **El gate sale en 1 y está bien que salga en 1.** El único rojo es el de la 275, medido igual
   antes y después. Si el reviewer quiere un verde, el camino es cerrar la 275, no tocar esto.
2. **Mis agregados no reproducen los del leader** (64/1.387 contra 149/1.958). Las anclas exactas
   sí. La hipótesis medida de la diferencia está arriba y es falsable: mírese el censo bajo la
   mutación (b).
3. **`quitarComentariosSql` y `quitarComentariosCss` siguen ciegas a las cadenas, a propósito**, y
   eso ya no cuelga de una equivalencia que cambió de significado: hay un caso que lo afirma y dos
   cables trampa que se ponen rojos el día que aparezca la precondición. Los tres se comprobaron
   rojos bajo mutación, no solo verdes hoy.
4. **La limitación de las expresiones regulares sigue viva** y está escrita como caso de prueba,
   con el comportamiento real —no el deseado— y con el instrumento que la detectaría si dejara de
   ser teórica (el censo diferencial, hoy en 0).

---

## Addendum (revisión RECHAZADA, bloqueante 1) — el caso de R12 no discriminaba

**El reviewer tenía razón y lo reproduje antes de tocar nada.** Quitando la pila de interpolación
de `finDePlantilla` —las seis líneas del `if (c === "$" && fuente[i + 1] === "{")`— la suite salía
`47 passed (47)`. Un caso que pasa con el mecanismo y sin él no verifica el mecanismo.

### Por qué no mordía, con la traza delante

La entrada era `const s = \`a${b ? \`x\` : \`y\`}c\`; // con parseFloat(`. Tiene **seis** comillas
invertidas, un número **par**, así que emparejarlas mal —(1,2)(3,4)(5,6), que es lo que hace el
escáner sin pila— consume **exactamente el mismo tramo** que emparejarlas bien —(1,6) con las
demás dentro—. Y como el contenido de una plantilla se emite tal cual en los dos casos, la salida
era idéntica **byte a byte**:

```
entrada: "const s = `a${b ? `x` : `y`}c`; // con parseFloat(\nconst vivo = 1;"
con pila: "const s = `a${b ? `x` : `y`}c`;  \nconst vivo = 1;"
sin pila: "const s = `a${b ? `x` : `y`}c`;  \nconst vivo = 1;"
```

El defecto **sí es detectable**; lo que fallaba era la entrada. La diferencia está en **dónde se
pone el `//`**: dentro de la plantilla anidada. Sin pila, la de fuera cierra en la comilla
invertida de antes de `//raiz`, el escáner cree que vuelve a código justo ahí y lee ese `//` como
comentario:

```
entrada: "const ruta = `base ${esRaiz ? `//raiz` : `/x`} fin`; const vivo = 1;"
con pila: "const ruta = `base ${esRaiz ? `//raiz` : `/x`} fin`; const vivo = 1;"
sin pila: "const ruta = `base ${esRaiz ? ` "
```

### Las dos salidas de la re-medición

**(1) CON la pila** — pasa:

```
 Test Files  1 passed (1)
      Tests  47 passed (47)
```

**(2) SIN la pila** (mismas seis líneas borradas) — cae, y cae **nombrando el mecanismo**:

```
     × R12 una plantilla anidada dentro de un `${…}` no cierra la de fuera 5ms
      Tests  1 failed | 46 passed (47)

AssertionError: la plantilla de fuera cerro en la de dentro: el `//` de la anidada se leyo como
comentario y se llevo el resto de la linea: expected 'const ruta = `base ${esRaiz ? ` ' to contain '`//raiz`'
```

---

## ¿Hay MÁS casos con el mismo vicio? — auditado por mutación, no por opinión

No se contestó de memoria: se mutó **cada mecanismo por separado** y se miró qué caso muere.
Mutaciones nuevas (además de las (a)(b)(c)(d) que ya estaban):

| # | mutación | casos muertos |
| --- | --- | --- |
| (e) | quitar la rama de **CADENA** (`'` / `"`) de `quitarComentarios` | **11**, entre ellos R8, R9, R10, R11, R4-en-cadena, el cable trampa y 4 casos de URL de la 209 |
| (f) | quitar la rama de **PLANTILLA** (`` ` ``) | **2**: R12 multilínea y R12 anidada |
| (g) | quitar la **pila de interpolación** (la del reviewer) | **1**: R12 anidada — antes del arreglo eran **0** |
| (h) | que `lineasSinComentarios` **deje de delegar** y estrene lógica propia | **3**: R12 multilínea, R4-en-cadena y **R22** |

Con eso, los **15 casos nuevos** quedan así:

| caso | muere en |
| --- | --- |
| R7 `/*` dentro de un `//` | (a) |
| R8 `/*` dentro de una cadena | (a), (e) |
| R9 `//` dentro de una cadena | (a), (e) |
| R10 no-regresión de URL | (e) |
| R13 comilla sin pareja en su línea | (b) |
| R13 comilla invertida sin pareja | (b) |
| R11 comilla escapada | (a), (e) |
| R12 plantilla multilínea | (a), (f), (h) |
| **R12 plantilla anidada** | **(f), (g)** — antes: ninguna |
| R4 bloque abierto dentro de cadena | (a), (e), (h) |
| R22 recuento de líneas / delegación | **(h)** |
| R14 limitación que queda (regex) | — ver abajo |
| Cable trampa SQL | (d) |
| Cable trampa CSS | (d) |
| Deuda declarada de CSS | (a), (e) |
| (+ el cable trampa R19 reescrito) | (a), (e) |

### Lo que declaro por mi cuenta, sin que nadie lo pregunte

**1. `R22` era el segundo sospechoso, y resultó tener dientes — pero por media razón.** Su
segunda aserción, `lineasSinComentarios(f).join("\n") === quitarComentarios(f)`, es
**tautológica hoy**: `split("\n").join("\n")` es la identidad, así que es verde **por
construcción** mientras la función delegue. Eso es exactamente lo que R22 pide («NO DEBE tener un
juego de reglas paralelo»), y la mutación (h) lo confirma: en cuanto la función estrena lógica
propia, el caso cae. O sea: no discrimina ningún mecanismo **vivo**, discrimina una **divergencia
futura**. Queda dicho para que nadie lo lea como más de lo que es.

**2. `R14` no discrimina ningún mecanismo, y no debe.** Es una *limitación afirmada*, con el
formato que la 209 y la 223 usaron para las suyas y que R14 pide literalmente: su trabajo es
ponerse rojo el día que alguien **cierre** la limitación de las expresiones regulares, no
verificar código de hoy. No muere en (a)…(h) y es correcto que no muera. Si mañana se implementa
reconocimiento de regex, cae con el mensaje «la limitacion se cerro: actualiza este caso».

**3. Ningún otro caso de los 15 queda sin al menos una mutación que lo mate.** Antes de este
addendum había **uno** (el de R12 anidada) y lo encontró el reviewer, no yo. La lección que me
llevo escrita: cuando un caso afirma un mecanismo, la entrada tiene que estar **elegida para que
el mecanismo cambie el resultado**, no para que se parezca al mecanismo. Aquí la trampa era la
paridad de las comillas invertidas — el ejemplo «de libro» de plantilla anidada es justo el que no
distingue nada.

---

## El cuarto «159 suites»

Estaba en `tests/unit/guards/quitador-comentarios.guardia.test.ts:554`, dentro del caso de R14.
Corregido a **171 suites (134 importadores directos más los transitivos, medido el 2026-08-25)**,
igual que los otros tres. Comprobado que en `tests/`, `init.sh` y `docs/` **no queda ninguno**; los
que siguen apareciendo viven en `progress/*.md` —esta bitácora, que habla del número heredado a
propósito, y los informes de revisión de otras sesiones, que no son míos—.

---

## Gate del addendum

Tercera corrida completa, con `pnpm run db:generate` delante y `INIT_EXIT=$?` escrito **dentro**
del log, sin `tail`. 16:36:50 → 16:48:22 (**11 min 32 s**).

```
✓ typecheck paso
✓ lint paso
 Test Files  1 failed | 1391 passed (1392)
      Tests  1 failed | 18958 passed | 26 skipped (18985)
INIT_EXIT=1
```

**Idéntico a las dos corridas anteriores, hasta el número de casos.** El único rojo sigue siendo
el ajeno: `superficie-de-uso.guardia.test.ts` → `lib/actions/tarifas.ts:67 obtenerTarifa`, ficha
275 `pending`, sin tocar, sin anotar y sin eximir. **Delta contra el baseline: 0.**
