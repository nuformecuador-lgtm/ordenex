# impl_231 — Wallet · la caja partida en dos bolsillos · MITAD DE SERVIDOR

> Bitácora de `backend_dev`. Alcance ejecutado: **bloques 1, 2 y 3** de
> `specs/231-wallet-caja-dos-bolsillos/tasks.md`. Los bloques 4, 5 y 6 (pantalla) los ejecuta
> `frontend_dev` sobre lo que queda aquí. **No se tocó `app/` ni `components/`.**
>
> Rama: `feature/231-wallet-caja-dos-bolsillos` · base `dev` = `37c3e469`.
> Decisiones D1–D5 firmadas por el humano el **2026-08-18** (`progress/design_231.md`
> §PUERTA HUMANA PASADA, respuesta literal «Si dale»), todas «tal como venían propuestas».

---

## 1. Archivos

### Código de producto (7)

| Archivo | Qué le pasa |
| --- | --- |
| `lib/types/wallet.ts` | **+** `WALLET_INGRESO_PROPIO_SEED` (7, D5), `WalletIngresoPropio`, `WALLET_EGRESO_DESGLOSADO_SEED`, `WalletEgresoDesglosado`, `MODO_COMPOSICION_CAJA_SEED`, `ModoComposicionCaja`, `ComposicionGananciaDTO`, `NaturalezaMovimiento` (mudado, §4.2). `CajaResumenDTO` **+=** `porcentajeTiendas`, `modoComposicion` (STRING planos, D3). `WalletMovimientoDTO` **+=** `dueno` |
| `lib/utils/caja-tesoreria.ts` | **+** `derivarReparto` (privada, la tabla de 4 filas) y `derivarComposicionGanancia` (pública). `derivarCaja` gana los dos campos **sin cambiar su firma**. `NaturalezaMovimiento` pasa a re-exportarse |
| `lib/utils/monto-escala-2.ts` | **NUEVO** (3 líneas). `Decimal → STRING escala 2`. Ver §4.1: es una **desviación de `design.md §3.1`** y lleva su motivo escrito dentro |
| `lib/repositories/WalletMovimientoRepository.ts` | `toDTO` asigna `dueno` desde `NATURALEZA_POR_CATEGORIA`. **Una línea, un sitio.** `agregarPorCategoriaYTipo`, `agregarPorCategoria`, `listar`, `crearMovimientos` y `obtenerPorId` **sin tocar** |
| `lib/interfaces/services/IWalletService.ts` | `VerResumenCajaServiceResult.ok` **+=** `composicion`. `forbidden` sigue sin datos |
| `lib/services/WalletService.ts` | `verResumenCaja` devuelve `{ resumen, composicion }` con **UNA sola** llamada al repo. Guard de rol y `construirFiltros`, intactos y en el mismo orden |
| `lib/actions/wallet.ts` | **Solo docstring.** El tipo de retorno ya se derivaba del contrato del servicio, así que ampliar el servicio lo amplía solo. Sin schema nuevo, sin acción nueva, sin aritmética |

**Sin migración, sin tabla, sin columna, sin valor de enum, sin RLS** (R37). `db/` no aparece en
el diff.

### Tests nuevos (2)

- `tests/unit/utils/caja-composicion.test.ts` — 16 casos. R10, R14–R19, R23, R26, R38.
- `tests/unit/guards/caja-composicion-exhaustiva.guardia.test.ts` — 15 casos. **Dos oficios**:
  (a) R23, R26, R32, T3.1 — la partición cubre el catálogo; (b) menor 4 — el barrido money-safe de
  `lib/utils/monto-escala-2.ts` (§4.1).

### Tests ampliados (2, míos por T1.6/T2.4)

- `tests/unit/utils/caja-tesoreria.test.ts` — **solo** el `toEqual` del caso vacío (+2 claves).
  Ninguna otra aserción del archivo se toca.
- `tests/unit/services/wallet-service.test.ts` — +3 casos (R24, R30, STRING de la composición);
  el `toEqual` del resumen gana las 2 claves; el barrido `[P7]` («el servidor no redacta») gana
  una rama para `modoComposicion`, medido igual que los dos `signo*` — la afirmación del caso se
  conserva entera.
- `tests/unit/repositories/wallet-movimiento-repository.test.ts` — +3 casos (R31/R32) y el
  `toEqual` del DTO gana `dueno`.

### Fixtures mecánicos (11 archivos) — leer §4.5

`tests/components/CajaResumenCard.test.tsx`, `tests/components/descarga/WalletDescarga.test.tsx`,
`tests/integration/wallet-page.test.tsx`, `tests/unit/actions/wallet-actions.test.ts`,
`tests/unit/actions/wallet-caja-descarga-action.test.ts`,
`tests/unit/actions/wallet-egresos-actions.test.ts`,
`tests/unit/components/wallet-ledger-reversa.test.tsx`,
`tests/unit/components/wallet-indemnizacion-libro.test.tsx`,
`tests/unit/descarga/wallet-caja-descarga-columnas.test.ts`,
`tests/unit/services/wallet-caja-descarga.test.ts`,
`tests/unit/services/wallet-egreso-service.test.ts`,
`tests/unit/services/wallet-indemnizacion-no-reversable.test.ts`.

**Ninguna aserción cambia en ellos**: solo se rellenan los campos nuevos de los DTO literales,
porque sin eso `pnpm typecheck` queda rojo y `frontend_dev` no puede ni arrancar.

---

## 2. T3.2 — la consecuencia firmada en D2, escrita donde toca

**El pago a los mensajeros ENTRA en la columna de egresos de la tarjeta nueva.**
`DesgloseEgresosDTO` (features 45/158) abre 4 de las 7 categorías de egreso propio; las 3 que le
faltan —`egreso_pago_mensajero`, `egreso_gasto`, `egreso_ajuste`— se agrupan en
`ComposicionGananciaDTO.otrosEgresos` para que el total de la columna sea `egresosPropios` (R26).

Medido sobre el libro de no-regresión (`caja-composicion.test.ts`): los cuatro conceptos suman
`3000.50`, `otrosEgresos` vale `940.00` (el pago al mensajero) y el total es `3940.50`, que es
exactamente `egresosPropios`. **Sin `otrosEgresos` la resta de la pantalla se equivocaría en 940.**

`DesgloseEgresosDTO` **no cambia de forma** y `verDesgloseEgresosAction` **no se toca**: sus 5
claves siguen igual y sus tests pasan sin editarse.

Consecuencia para `frontend_dev` (Bloque 6): el copy heredado de la 158 —«No incluye los pagos a
tiendas **ni a mensajeros**»— deja de ser cierto en la tarjeta nueva. Lo que de verdad queda
fuera de la ganancia es el dinero de las tiendas.

---

## 3. Mapa `R<n> → test` (solo los requisitos de los bloques 1-3)

| R | Test (nombre exacto) | Archivo | Estado |
| --- | --- | --- | --- |
| R9 | «R9/R10: el porcentaje es STRING de dos decimales, redondeado HALF_UP y dentro de 0–100» | `tests/unit/utils/caja-composicion.test.ts` | ✅ *(el caso nombrado en la tabla del spec, «`composicion` y el resumen cruzan como STRING», es de `wallet-page.test.tsx` → T4.5, frontend)* |
| R10 | «R10: `dos_bolsillos`: 10 000 / 12 000 → 83.33» | `tests/unit/utils/caja-composicion.test.ts` | ✅ |
| R14 | «R14: los cuatro modos, uno por conjunto» + «R14/R19: los NUEVE pares de signos caen en EXACTAMENTE una fila de la tabla» | `tests/unit/utils/caja-composicion.test.ts` | ✅ |
| R15 | «R15: ganancia negativa con dinero de tiendas → `solo_tiendas`» | `tests/unit/utils/caja-composicion.test.ts` | ✅ |
| R17 | «R17: `deTerceros` negativo → `solo_ordenex`» (D4) | `tests/unit/utils/caja-composicion.test.ts` | ✅ |
| R18 | «R18: nada que repartir → `sin_reparto`, sin porcentaje» | `tests/unit/utils/caja-composicion.test.ts` | ✅ *(la mitad de pantalla es T4.4)* |
| R19 | «R19: el resto de conjuntos cae en `dos_bolsillos`» | `tests/unit/utils/caja-composicion.test.ts` | ✅ |
| R23 | «R23: el desglose cubre todas las categorias propias y suma `ingresosPropios`» + «R23: la Σ de las siete filas de ingresos es, importe a importe, `ingresosPropios`» | `caja-composicion.test.ts` + `caja-composicion-exhaustiva.guardia.test.ts` | ✅ |
| R24 | «R24: una sola lectura: las dos derivaciones salen del mismo array» | `tests/unit/services/wallet-service.test.ts` | ✅ |
| R26 | «R26: la columna de egresos suma `egresosPropios`» + «R26: los CUATRO conceptos del desglose + «otros gastos» = `egresosPropios`» | `caja-composicion.test.ts` + `caja-composicion-exhaustiva.guardia.test.ts` | ✅ |
| R30 | «R30: `forbidden` no viaja con composición» | `tests/unit/services/wallet-service.test.ts` | ✅ |
| R31 | «R31/R32: cada categoria del SEED produce su `dueno`» (+ el de `obtenerPorId`) | `tests/unit/repositories/wallet-movimiento-repository.test.ts` | ✅ *(R31 en pantalla es T5.4)* |
| R32 | «R32: toda categoria del catalogo tiene una naturaleza declarada, sin huecos» + «R23/R26: ninguna categoria propia del catalogo se queda fuera de la particion» | `tests/unit/guards/caja-composicion-exhaustiva.guardia.test.ts` | ✅ |
| R38 | «R38: las siete cifras de `CajaResumenDTO` siguen valiendo lo mismo, importe a importe» + «R38: los cuatro conceptos de `DesgloseEgresosDTO` siguen valiendo lo mismo» | `tests/unit/utils/caja-composicion.test.ts` | ✅ |
| R37 | guardia de la 173 **sin editar** + control del diff (`db/` no aparece) | `tests/unit/guards/caja-173-alcance.guardia.test.ts` | ✅ (verde sin editarse) |
| R40 | guardia de la 173 **sin editar**; las tres pantallas congeladas no están en el diff | `tests/unit/guards/caja-173-alcance.guardia.test.ts` | ✅ (verde sin editarse) |

Pendientes de `frontend_dev`: R1–R8, R11–R13, R16, R20–R22, R25, R27–R29, R33–R36, R39.

---

## 4. Decisiones tomadas, desviaciones y lo que queda abierto

### 4.1 `lib/utils/monto-escala-2.ts` — DESVIACIÓN de `design.md §3.1`, necesita bendición

**El spec no vio esta restricción y se descubrió ejecutando.** `tests/unit/utils/caja-tesoreria.test.ts`
tiene un `it` («R7: el modulo NO tiene ni una llamada capaz de convertir un monto a numero») que
barre la fuente de `lib/utils/caja-tesoreria.ts` contra `LLAMADAS_PROHIBIDAS_EN_DINERO`, y esa
lista incluye el literal **`.toFixed(`**. Aquella aserción se escribió cuando ese módulo **no
emitía ni un STRING por su cuenta**: los tres que devolvía se los daba `derivarBalance`. La 231 le
pide once importes y un porcentaje propios, y `Decimal#toFixed(2)` es el idioma money-safe del
repo (lo usan `wallet-balance`, `cierre-totales`, `cuenta-por-pagar` y seis módulos más).

Las tres salidas eran: (a) relajar aquel barrido, (b) reimplementar `toFixed` a mano, (c) sacar la
conversión a un módulo propio.

- (a) es **debilitar una aserción de dinero de otra feature**: eso es decisión con firma humana,
  no arreglo de paso (misma clase que D1). Descartada sin firma.
- (b) `toDecimalPlaces(...).toString()` + relleno es una segunda copia del formateo de dinero, y
  además `toString()` emite notación exponencial por encima de 1e21. Descartada.
- (c) **elegida.** El módulo nuevo no contiene `Number(`, `parseFloat(` ni `parseInt(`, y su única
  entrada es un `Prisma.Decimal`: **la propiedad que el barrido protege se conserva entera**, no
  hay camino por el que un monto se vuelva número.

**Lo que el humano puede querer decidir:** si prefiere (a) —ampliar ese `it` para que admita
`Decimal#toFixed(2)` en ese módulo— y meter el `toFixed` en línea, el módulo de tres líneas
desaparece. Yo no podía firmarlo.

#### CERRADO — el humano firmó que el módulo se queda (menor 4 de `progress/review_231.md`)

Firmado el módulo, quedaba su agujero: **no lo barría ninguna guardia**. Se le pone la red en
`tests/unit/guards/caja-composicion-exhaustiva.guardia.test.ts`, como **segundo oficio declarado**
del mismo archivo (+6 casos, `describe` propio con su porqué escrito dentro).

**Dónde va, y por qué no en los otros dos sitios plausibles** (mirado antes de decidir):

- **No en `tests/unit/guards/liquidacion-money-safe.test.ts`**: su censo declara «los archivos que
  la 172 creó o modificó» y se valida contra los árboles de liquidación. Meterle un módulo de la
  caja convertiría esa afirmación en mentira — es literalmente el motivo que la guardia de la 204
  (`ordenes-columnas-money-safe.guardia.test.ts`) escribió para vivir aparte.
- **No en `tests/unit/utils/caja-tesoreria.test.ts`**, que es quien barre al módulo *padre*: ese
  archivo **no** lo selecciona `pnpm exec vitest run guard`, así que el barrido sólo correría
  cuando el grafo de imports lo arrastrase. Un barrido de FUENTE que dependa del grafo es
  exactamente lo que `docs/verification.md` dice que se pierde.
- **No una guardia nueva**: ya existe la guardia de la derivación de la caja de esta feature, y el
  módulo existe por esa derivación.

**El criterio**, distinto del de su módulo padre en un solo punto: `.toFixed(` **se permite** —es
el oficio del módulo y sobre un `Prisma.Decimal` es exacto— y a cambio se prohíbe `Number(`,
`parseFloat(`, `parseInt(` y **`.toNumber(`**, que la lista genérica
`LLAMADAS_PROHIBIDAS_EN_DINERO` no persigue, más importar `decimal.js` / `big.js`.

**El detector se auto-comprueba en las dos direcciones**, con dos códigos escritos a mano dentro
del propio archivo: uno con las cuatro llamadas (tiene que cazarlas las cuatro) y otro que sólo las
CITA en una cadena y en identificadores como `numberOfRows` / `parseFloatingWindow` (no puede cazar
ninguna). Es la red contra la trampa que este repo ya se comió: una expresión regular que llega
mutilada al comparador —un `` convertido en backspace por una capa de escapado— no casa nada y
el censo sale verde por no encontrar. Además hay control de no-vacuidad del archivo (existe, >500
bytes, sigue exportando `montoEscala2`) y una medición del `.toFixed(` permitido: `0.1 + 0.2` da
`"0.30"` y `98765432109.87` sobrevive entero, que son los dos sitios donde un `number` sí falla.

### 4.2 `NaturalezaMovimiento` se muda a `lib/types/wallet.ts`

Desde R31 es el tipo de un campo de `WalletMovimientoDTO`. Dejarlo en `lib/utils/caja-tesoreria.ts`
obligaba a `lib/types/` a importar de `lib/utils/` (ciclo invertido). Se muda la **declaración** y
`caja-tesoreria.ts` la **re-exporta**, así que ningún importador de la 173 cambia. La
clasificación (`NATURALEZA_POR_CATEGORIA`) **no se mueve**.

### 4.3 `otrosEgresos` se deriva por COMPLEMENTO, no por la lista de tres

`tasks.md T1.3` dice «suma de `egreso_pago_mensajero`, `egreso_gasto`, `egreso_ajuste`». Se
implementa como «todo egreso propio que no sea uno de los cuatro conceptos de
`DesgloseEgresosDTO`». Hoy da exactamente esas tres, y lo mide en runtime el caso «T3.1: las
categorias de «otros gastos» se DERIVAN del catalogo, no de una copia a mano».
**Por qué:** con la lista literal, una categoría de egreso propio nueva rompería R26 en silencio
—el total dejaría de ser `egresosPropios` y seguiría siendo un número plausible—. Con el
complemento no puede.

### 4.4 Dos constantes que el spec no enumera

`WALLET_EGRESO_DESGLOSADO_SEED` (las 4 categorías que `DesgloseEgresosDTO` cubre; es lo que hace
posible el complemento de §4.3) y `MODO_COMPOSICION_CAJA_SEED` (los 4 modos, para que la pantalla
pueda montar el `Record` TOTAL que `design.md §4.2` pide). Ninguna cambia comportamiento.

### 4.5 Fixtures de tests que son de los bloques 4-6

`dueno` y los dos campos del resumen son **obligatorios** (R32 depende de que una categoría nueva
rompa el build). Eso deja 11 archivos de test con literales incompletos ⇒ `pnpm typecheck` rojo.
Se rellenaron **sin tocar ninguna aserción**; `design.md §5` los clasifica como «fixture
mecánico». `T4.5` sigue siendo de `frontend_dev`: le queda **añadir el caso** que comprueba que
`composicion` cruza por props. El barrido `Object.entries(props.resumen)` de
`wallet-page.test.tsx:266-272` **sigue literalmente igual** y en verde: la composición viaja
hermana del resumen, no anidada.

### 4.6 Hallazgo: la tabla de los cuatro modos es ORDEN-INDEPENDIENTE

Una de las mutaciones (reordenar `sin_reparto` delante de `solo_tiendas`) salió **verde**, y no es
un agujero del test: las cuatro ramas son **mutuamente excluyentes** (fila 1 exige `T > 0`, fila 3
exige `T <= 0`; fila 2 exige `G > 0`, fila 3 exige `G <= 0`; fila 1 exige `G < 0`, fila 2 exige
`G > 0`). El orden de `design.md §3.1` es documental, no semántico. Las mutaciones que sí cambian
la semántica —quitarle a una rama su segunda condición, o cambiar `!gt(0)` por `lt(0)`— **sí caen
en rojo** (M1a y M1b de §6).

### 4.7 Lo que `frontend_dev` necesita saber antes de empezar

1. `verResumenCajaAction` devuelve ahora `{ status: "ok", resumen, composicion }`.
   `app/(app)/wallet/page.tsx` **compila igual** (solo desestructura `resumen`), pero para el
   Bloque 6 hay que pasar `composicion` a `WalletModule` (T6.3). **Yo no toqué `app/`.**
2. `WalletMovimientoDTO.dueno` ya llega en la tabla y en la descarga por el mismo `toDTO`: la
   columna «Dueño» (T5.2/T5.3) no necesita nada más del servidor.
3. `MODO_COMPOSICION_CAJA_SEED` está exportado para el `Record` total de la barra.
4. `porcentajeTiendas` es STRING: se pinta como `width: \`${porcentajeTiendas}%\`` sin convertirlo.
5. La 230 ya está en `dev`: `money()` redondea sin céntimos. Ninguna aserción mía toca un importe
   ya formateado.

---

## 5. Salida real de la verificación

```
$ pnpm run typecheck
> ordenex@0.1.0 typecheck R:\job\singularis\projects\ordenex
> tsc --noEmit
(sin salida: 0 errores)

$ pnpm run lint
✖ 69 problems (0 errors, 69 warnings)
  (los 69 son warnings preexistentes de `no-unused-vars` en archivos ajenos;
   ningún archivo tocado por esta tanda aparece en la salida)

$ pnpm exec vitest run <los 20 archivos tocados o creados>
 Test Files  20 passed (20)
      Tests  262 passed (262)
   Duration  9.78s

$ pnpm exec vitest related --run lib/types/wallet.ts lib/utils/caja-tesoreria.ts \
    lib/utils/monto-escala-2.ts lib/repositories/WalletMovimientoRepository.ts \
    lib/services/WalletService.ts lib/interfaces/services/IWalletService.ts lib/actions/wallet.ts
 Test Files  161 passed (161)
      Tests  2771 passed (2771)
   Duration  97.95s

$ pnpm run test:guardias
 Test Files  111 passed (111)
      Tests  1648 passed (1648)
   Duration  11.76s
```

Desglose de los archivos nuevos y ampliados:

| Archivo | Casos |
| --- | --- |
| `tests/unit/utils/caja-composicion.test.ts` | 16 passed |
| `tests/unit/guards/caja-composicion-exhaustiva.guardia.test.ts` | 15 passed (9 + 6 del menor 4) |
| `tests/unit/services/wallet-service.test.ts` | 18 passed (eran 15) |
| `tests/unit/repositories/wallet-movimiento-repository.test.ts` | 17 passed (eran 14) |
| `tests/unit/utils/caja-tesoreria.test.ts` | 24 passed (sin cambio de número) |

**Las dos guardias de la 173 pasan SIN haber sido editadas** (`git diff --name-only` no las
incluye): `caja-derivaciones.guardia.test.ts` (sigue exigiendo **exactamente 3**
`derivarBalance(`, ningún `"positivo"`/`"negativo"`/`"cero"` literal y ningún `.sub(`/`.minus(`
en `caja-tesoreria.ts`) y `caja-173-alcance.guardia.test.ts`.

`./init.sh` NO se corrió: lo corre el leader cuando nadie esté mutando el árbol.

---

## 6. Mutaciones — la prueba de que los tests no pasan por casualidad

Cada mutación se aplicó al código de producto, se corrieron los tests, y se revirtió. Incluye un
**control sin mutar** que tiene que salir verde: sin él, un arnés roto reportaría «todo rojo» sin
haber ejecutado nada.

| # | Mutación | Resultado |
| --- | --- | --- |
| M1a | la rama `solo_tiendas` pierde su segunda condición (basta con `G < 0`) | **ROJO** — 3 fallos |
| M1b | la rama `sin_reparto` exige signo estricto (`lt(0)` en vez de `!gt(0)`) | **ROJO** — 1 fallo |
| M2 | redondeo `ROUND_HALF_UP` → `ROUND_DOWN` | **ROJO** — 3 fallos |
| M3 | `otrosEgresos` suma los cuatro conceptos en vez de su complemento | **ROJO** — 3 fallos |
| M4 | `dueno` fijado a `"propio"` en `toDTO` | **ROJO** — 2 fallos |
| M5 | el servicio lee la base DOS veces, una por derivación | **ROJO** — 1 fallo |
| M6 | el porcentaje se deriva de la GANANCIA en vez de `deTerceros` | **ROJO** — 8 fallos |
| M7 | `totalIngresos` incluye también el dinero de TERCEROS | **ROJO** — 5 fallos |
| **M0** | **control, sin mutar** | **VERDE — 60 passed** |

### La guardia del menor 4, vista fallar (ejecutado, no razonado)

Script en un archivo (no una línea suelta), lectura y escritura en **binario** para que la
restauración sea byte a byte y el `sha256` lo demuestre:

```
[1] PARTIDA (sin tocar)   sha256=ec0f371341de7160353fd29d2b770e26e72340361984d57d342c27377d0c0d9f
    exit=0  VERDE  ->  Test Files  1 passed (1) | Tests  15 passed (15)

[2] CON `Number(` COLADO  sha256=47549190f2c1b92db3813ffdc5e60dc890c8ef151ba42698243cc3af0540a857
    exit=1  ROJO   ->  Test Files  1 failed (1) | Tests  2 failed | 13 passed (15)
      FAIL  menor 4: ni una llamada capaz de convertir un monto a numero
      FAIL  CONTRAPRUEBA: el mismo barrido SI nombra la llamada cuando esta dentro del archivo real

[3] RESTAURADO            sha256=ec0f371341de7160353fd29d2b770e26e72340361984d57d342c27377d0c0d9f
    exit=0  VERDE  ->  Test Files  1 passed (1) | Tests  15 passed (15)

    restauracion byte a byte: SI  (sha256 de [1] == sha256 de [3])
```

La línea colada fue una función `montoNumero` con `return Number(valor.toFixed(2));` — el fallo
exacto que la guardia existe para impedir y que hasta hoy nada detectaba.

Tras el cierre del menor 4: `pnpm run test:guardias` -> **111 files / 1654 tests verde** (eran
1648: +6 casos) y `pnpm run typecheck` -> 0 errores, `pnpm run lint` -> 0 errores.

La guardia de exhaustividad se auto-comprueba dentro de su propio archivo («AUTO-COMPROBACION: el
detector SE PONE ROJO con una categoria que nadie cubre»): sobre un catálogo con dos categorías
propias inventadas, el detector las nombra; sobre una de terceros, no —porque no entra en la
ganancia—. Sin esa mitad, un detector roto pasaría en verde por no mirar nada.

Ningún test de esta tanda tiene la forma `if (!datos) return;`: todos los conjuntos son literales
del propio archivo y cada `describe` lleva su **control de no-vacuidad** explícito.

---

## 7. Veredicto

**Los bloques 1, 2 y 3 quedan hechos y medidos: 14 requisitos de servidor cubiertos por test
ejecutado, 8 mutaciones cazadas, las dos guardias de la 173 verdes sin editarse, y una sola
desviación de diseño abierta (`monto-escala-2.ts`, §4.1) que necesita una decisión humana.**


---
---

# impl_231 — MITAD DE PANTALLA (bloques 4, 5, 6 y 7)

> Bitácora de `frontend_dev`, sobre lo que dejó la mitad de servidor de arriba. Alcance
> ejecutado: **bloques 4, 5, 6 y 7** de `specs/231-wallet-caja-dos-bolsillos/tasks.md`.
> **No se tocó `lib/`, ni `db/`, ni el esquema, ni ninguna ruta de API.**
>
> Rama: `feature/231-wallet-caja-dos-bolsillos` · base `dev` = `37c3e469`.
> D1 y D2 firmadas por el humano el **2026-08-18** (`progress/design_231.md` §PUERTA HUMANA
> PASADA, «Si dale»).

---

## 1. Archivos

### Código de producto (9)

| Archivo | Qué le pasa |
| --- | --- |
| `app/(app)/wallet/_components/BarraComposicionCaja.tsx` | **NUEVO** (T4.2). La barra: `Record` TOTAL sobre los 4 modos, segmento de tiendas con `style={{width}}` del STRING del DTO, el de Ordenex con `flex-1`, `role="img"` + `aria-label` compuesto |
| `app/(app)/wallet/_components/ComposicionGananciaCard.tsx` | **NUEVO** (T6.2). Dos columnas + pie. `Card` HERMANA, nunca anidada |
| `app/(app)/wallet/_components/DesgloseEgresosLista.tsx` | **NUEVO por EXTRACCIÓN** (T6.1) del `<dl>` de `DesgloseEgresosCard`: mismo `role="group"`, mismo `aria-label`, mismas filas, más «Otros gastos de Ordenex» (D2) |
| `app/(app)/wallet/_components/CajaResumenCard.tsx` | REDISEÑADA al árbol de `design.md §4.1`: regiones disjuntas, padres acotados, «Entró/Salió/Movimientos» como datos secundarios, los dos bolsillos hermanos |
| `app/(app)/wallet/_components/WalletLedger.tsx` | **+** columna «Dueño» (punto + texto), la última de los datos. Corregida la cita a `WalletDescarga.test.tsx:566` → `:590` y anotada D1 |
| `app/(app)/wallet/_components/wallet-ledger-descarga-columnas.ts` | **+** columna `dueno` / «Dueño» en la lista Y en la fila, en el mismo cambio |
| `app/(app)/wallet/_components/wallet-labels.ts` | **+** `CAJA_COMPOSICION_LABEL`, `CAJA_COMPOSICION_MENSAJE` (Record TOTAL sobre los 4 modos), `composicionCajaNombreAccesible`, `DUENO_LABEL` (Record TOTAL sobre la naturaleza). `money` pasa de re-export a import + re-export (el módulo la necesita para el nombre accesible) |
| `app/(app)/wallet/_components/WalletModule.tsx` | **+** prop y estado `composicion`, refrescada en la MISMA recarga que el resto; la tarjeta nueva entra bajo la de la caja; el panel de gastos fijos pasa a ancho completo |
| `app/(app)/wallet/page.tsx` | **+1 línea**: pasa `composicion` a `WalletModule` (T6.3) |

### Borrado (D2, absorbido)

- `app/(app)/wallet/_components/DesgloseEgresosCard.tsx` — su lista es ahora la columna
  derecha de `ComposicionGananciaCard`. **Tenía que borrarse, no solo dejar de montarse**:
  `superficie-de-uso.guardia` (R-B) se pone roja con un componente que nadie monta.

### Tests nuevos (3)

- `tests/components/CajaComposicionBarra.test.tsx` — 14 casos. R2, R3, R5, R11, R12, R13,
  R16, R17, R18, R20, R21, R39.
- `tests/components/ComposicionGananciaCard.test.tsx` — 15 casos. R12, R22, R23, R25, R26,
  R27, R28, R29 **+ las 18 aserciones re-hospedadas de la 45 y la 158**.
- `tests/unit/components/wallet-ledger-dueno.test.tsx` — 3 casos. R31 (pantalla), R33, R36.

### Tests ampliados (4)

- `tests/components/CajaResumenCard.test.tsx` — **+1 caso** («Entró, Salió y el conteo siguen
  en la tarjeta», R6). Los 19 de la 173 pasan **sin tocar una sola aserción** con la tarjeta
  rediseñada.
- `tests/components/descarga/WalletDescarga.test.tsx` — D1 aplicada (§3) **+2 casos** (R34, R35)
  + fixture `COMPOSICION` para que el módulo monte.
- `tests/integration/wallet-page.test.tsx` — **+1 caso** (R9). El barrido
  `Object.entries(props.resumen)` de las líneas 266-272 sigue **literalmente igual**.
- `tests/unit/descarga/wallet-caja-descarga-columnas.test.ts` — la lista literal de columnas
  gana `dueno`/«Dueño» al final (§4, decisión abierta).

### Borrado y RE-HOSPEDADO (D2)

- `tests/unit/components/wallet-desglose-egresos-card.test.tsx` → sus **18 aserciones** viven
  ahora en `tests/components/ComposicionGananciaCard.test.tsx`. **Recuento: 18 antes, 18
  después.** Detalle en §5.

---

## 2. Mapa `R<n> → test` (los requisitos de los bloques 4-7)

| R | Test (nombre exacto) | Archivo | Estado |
| --- | --- | --- | --- |
| R1 | «R58: las DOS cifras se ven a la vez, cada una con su nombre y su importe» | `tests/components/CajaResumenCard.test.tsx` | ✅ (173, sin editar) |
| R2 | «R2: la barra pinta los dos segmentos del modo `dos_bolsillos`» | `CajaComposicionBarra.test.tsx` | ✅ |
| R3 | «R3: cada bolsillo muestra su importe y su explicación» | `CajaComposicionBarra.test.tsx` | ✅ |
| R4 | «R34: muestra el dinero de las tiendas y AVISA…» + «R34: y lleva al sitio donde la deuda de verdad SÍ está» | `CajaResumenCard.test.tsx` | ✅ (173, sin editar) |
| R5 | «R5: el bloque de Ordenex es neutro salvo en el caso límite» | `CajaComposicionBarra.test.tsx` | ✅ |
| R6 | «Entró, Salió y el conteo siguen en la tarjeta» | `CajaResumenCard.test.tsx` | ✅ (NUEVO) |
| R7 | «cada cifra lleva su desglose, y son desgloses DISTINTOS» | `CajaResumenCard.test.tsx` | ✅ (173, sin editar) |
| R8 | «R58: a la VEZ significa sin abrir nada — ni pestañas, ni desplegables, ni un botón» | `CajaResumenCard.test.tsx` | ✅ (173, sin editar) |
| R9 | «R9: `composicion` y el resumen cruzan como STRING» | `tests/integration/wallet-page.test.tsx` | ✅ (NUEVO) |
| R11 | «R11: el ancho del segmento es el STRING del DTO y el otro ocupa el resto» | `CajaComposicionBarra.test.tsx` | ✅ |
| R12 | «R12: ninguna fuente nueva tiene forma de operar con dinero» (4 fuentes) + «R12: ninguna de las dos fuentes tiene forma de operar con dinero» | `CajaComposicionBarra.test.tsx` + `ComposicionGananciaCard.test.tsx` | ✅ |
| R13 | «R13: la barra tiene nombre accesible con las dos porciones» | `CajaComposicionBarra.test.tsx` | ✅ |
| R16 | «R16: `solo_tiendas`: un solo segmento y el bloque de Ordenex en peligro» | `CajaComposicionBarra.test.tsx` | ✅ |
| R17 *(pantalla)* | «R17 (D4): `solo_ordenex` pinta la barra entera de Ordenex y el bolsillo de las tiendas en negativo» | `CajaComposicionBarra.test.tsx` | ✅ |
| R18 *(pantalla)* | «R18: nada que repartir → `sin_reparto`, sin porcentaje» | `CajaComposicionBarra.test.tsx` | ✅ |
| R20 | «R20: fuera de `dos_bolsillos` no hay dos segmentos ni porcentaje» + «los CUATRO modos se pintan, uno por conjunto» | `CajaComposicionBarra.test.tsx` | ✅ |
| R21 | «la tarjeta no compara importes: el modo llega del DTO» | `CajaComposicionBarra.test.tsx` | ✅ |
| R22 | «R22: la tarjeta enseña ingresos, egresos y la ganancia en el pie» | `ComposicionGananciaCard.test.tsx` | ✅ |
| R23 *(pantalla)* | «R23: hay una fila por cada categoría de ingreso propio del catálogo» + «R23/R26: los dos totales son los del servidor, no una suma de la pantalla» | `ComposicionGananciaCard.test.tsx` | ✅ |
| R25 | «R25: cada concepto con su etiqueta legible, nunca el enum» | `ComposicionGananciaCard.test.tsx` | ✅ |
| R26 *(pantalla)* | «R26: la columna de egresos suma `egresosPropios`» | `ComposicionGananciaCard.test.tsx` | ✅ |
| R27 | «R27: el pie pinta la ganancia con el signo del servidor» | `ComposicionGananciaCard.test.tsx` | ✅ |
| R28 | «R28: el orden es el declarado, no el de magnitud» | `ComposicionGananciaCard.test.tsx` | ✅ |
| R29 | «R29: dice qué NO entra» | `ComposicionGananciaCard.test.tsx` | ✅ |
| R31 *(pantalla)* | «R31: un movimiento propio y uno de terceros se leen distinto» | `wallet-ledger-dueno.test.tsx` | ✅ |
| R33 | «R33: la celda es punto + texto, no un `Badge`» | `wallet-ledger-dueno.test.tsx` | ✅ |
| R34 | «R34: la descarga trae «Dueño» con el mismo texto que muestra la tabla» | `tests/components/descarga/WalletDescarga.test.tsx` | ✅ |
| R35 | «R35: los encabezados anteriores conservan su orden y «Dueño» se añade» | `tests/components/descarga/WalletDescarga.test.tsx` | ✅ |
| R36 | «R36: ninguna fuente de `app/wallet` deriva el dueño» | `wallet-ledger-dueno.test.tsx` | ✅ |
| R37 | guardia de la 173 **sin editar** + control del diff (T7.1, §6) | `caja-173-alcance.guardia.test.ts` | ✅ |
| R38 | «R38: las siete cifras de `CajaResumenDTO` siguen valiendo lo mismo, importe a importe» + «R38: los cuatro conceptos de `DesgloseEgresosDTO` siguen valiendo lo mismo» (T7.2) | `tests/unit/utils/caja-composicion.test.ts` | ✅ (16/16, ejecutado) |
| R39 | «R39: sin hex ni utilidades de paleta ad-hoc en las fuentes nuevas» + «R39: y todo lo interactivo lleva el anillo de foco estándar» | `CajaComposicionBarra.test.tsx` | ✅ |
| R40 | guardia de la 173 **sin editar**; las tres pantallas congeladas no están en el diff (T7.1, §6) | `caja-173-alcance.guardia.test.ts` | ✅ |

---

## 3. T5.1 — D1 aplicada, y lo que la sustituye

`tests/components/descarga/WalletDescarga.test.tsx`, caso
`it("R62: el listado los pinta como a los demás, sin cambiar las columnas")`.

La aserción fijaba con `toEqual` la secuencia exacta de los seis encabezados. Ese literal **no
es lo que el caso dice afirmar**: se le coló por usar `toEqual` sobre el array, y acabó
gobernando cuántas columnas puede tener el libro (bloqueó el reordenado de la 200 y habría
bloqueado la columna «Dueño»).

Sustituida por lo que el caso afirma, **medido**: el juego de encabezados que declara el
componente **CON y SIN** las categorías de la 173 dentro, con control de no-vacuidad
(`sinLas173.length > 4`). Es más fuerte que el literal —caza también una columna que apareciera
solo para esas categorías— y deja de opinar sobre el número total de columnas.

**El caso sigue existiendo, con su nombre y su intención**, y las dos aserciones sobre la
etiqueta legible (R61) no se tocan. Se añadieron dos casos PROPIOS de la 231 (R34 y R35) que
fijan la presencia y el sitio de «Dueño» —la última de los datos, justo antes de «Acciones»—.

---

## 4. Una decisión que el spec no vio, y que hubo que tomar

**`tests/unit/descarga/wallet-caja-descarga-columnas.test.ts:25-38` (feature 170/R5) también
fija con `toEqual` la lista literal de columnas de la descarga.** `design.md §4.4` afirma que
«los dos tests que comparan `Object.keys(fila)` contra esa lista siguen verdes solos», y es
cierto para los dos de `WalletDescarga.test.tsx` — pero **este tercero no compara claves contra
la lista: compara la lista contra un literal**, así que R34 lo pone rojo sin remedio.

Lo hecho: **añadir `"dueno"`/«Dueño» al final de los dos arrays literales**, con el motivo
escrito dentro del caso. El caso afirma «declara sus columnas ENUMERADAS, en el orden de la
pantalla», y las dos propiedades se conservan enteras: sigue cazando un reordenado y sigue
cazando una columna sin declarar.

**No es un cambio de intención como D1** (allí la aserción afirmaba una cosa distinta de la que
decía); aquí es la misma afirmación sobre una lista que creció por el requisito. Aun así queda
**anotado como decisión abierta**: si el humano prefiere que esa lista deje de ser un literal,
es un cambio de una línea.

---

## 5. T6.4 — el recuento de la 45 y la 158, antes y después

Borrar un componente borra su test, y con él la red de features ajenas. Se contó **antes** de
borrar y **después** de re-hospedar, con el mismo criterio (`expect(` por caso):

| Caso | Feature | `expect(` antes | `expect(` después |
| --- | --- | --- | --- |
| «renderiza los totales por tipo y el total como STRING» | 45 (R11/R12) | 8 | 8 |
| «pinta la fila 'Indemnizaciones' con su monto TAL CUAL» | 158 (R32) | 2 | 2 |
| «el total mostrado es el que llega del servidor (la tarjeta NO suma dinero)» | 158 (R32) | 1 | 1 |
| «un monto que no cabe en un `number` se redondea EXACTO (sin parseFloat)» | 158 (R32) | 2 | 2 |
| «la tarjeta ya NO se titula 'Egresos administrativos'» | 158 (T2.5) | 2 | 2 |
| «dice qué entra y qué NO entra en el total, en vez de dejarlo implícito» | 158 (T2.5) | 3 | 3 |
| **TOTAL** | | **18** | **18** |

**El número no baja.** Los seis casos conservan su nombre, su describe y su intención; lo único
que cambia es el anfitrión y dos adaptaciones declaradas dentro del propio caso:

1. el total de la columna ya no es `DesgloseEgresosDTO.total` sino
   `ComposicionGananciaDTO.totalEgresos` (D2). La afirmación es la misma: **el número lo manda
   el servidor y la pantalla no lo recalcula**;
2. «la tarjeta ya NO se titula 'Egresos administrativos'» pasa de mirar el `card-title` de la
   tarjeta absorbida a mirar el rótulo de la columna, que es donde vive ahora la palabra
   «Egresos». La contraprueba (`not.toMatch(/Egresos administrativos/)`) se conserva sobre el
   `container` entero, así que ahora barre **más** superficie que antes.

**Prueba ejecutada de que la extracción fue una MUDANZA** (T6.1): con
`DesgloseEgresosLista` ya extraída y `DesgloseEgresosCard` delegando en ella, su test pasó
**sin una sola modificación**:

```
$ pnpm exec vitest run tests/unit/components/wallet-desglose-egresos-card.test.tsx
 Test Files  1 passed (1)
      Tests  6 passed (6)
```

El copy heredado de la 158 dice ahora qué **no** entra en la ganancia: el dinero de las
tiendas. El pago a los mensajeros **sí** entra, por «Otros gastos de Ordenex» (consecuencia
firmada en D2), así que «ni a mensajeros» habría pasado a ser falso.

---

## 6. T7.1 — las guardias de la 173, verdes y sin editarse

```
$ git diff --name-only -- tests/unit/guards/caja-derivaciones.guardia.test.ts \
                          tests/unit/guards/caja-173-alcance.guardia.test.ts
(vacío)

$ pnpm exec vitest run tests/unit/guards/caja-derivaciones.guardia.test.ts \
    tests/unit/guards/caja-173-alcance.guardia.test.ts \
    tests/unit/guards/caja-composicion-exhaustiva.guardia.test.ts \
    tests/unit/utils/caja-composicion.test.ts
 Test Files  4 passed (4)
      Tests  62 passed (62)
```

Control del diff (R37/R40): **ni `db/`, ni `prisma/`, ni `app/(app)/wallet/tiendas/`, ni
`app/(app)/mi-wallet/`, ni `app/(app)/mis-pagos/` aparecen** en `git status --short`.

---

## 7. Salida real de la verificación

```
$ pnpm run typecheck
> tsc --noEmit
(sin salida: 0 errores)

$ pnpm run lint
✖ 69 problems (0 errors, 69 warnings)
  (los mismos 69 warnings preexistentes de `no-unused-vars` de la tanda de servidor;
   ningún archivo de esta tanda aparece en la salida)

$ pnpm exec vitest run <los 9 archivos de test de la feature>
 Test Files  9 passed (9)
      Tests  90 passed (90)

$ pnpm exec vitest related --run <las 9 fuentes de `app/` tocadas>
 Test Files  29 passed (29)
      Tests  389 passed (389)

$ pnpm exec vitest run tests/components/descarga tests/components/paginacion tests/unit/descarga
 Test Files  50 passed (50)
      Tests  371 passed (371)

$ pnpm run test:guardias
 Test Files  111 passed (111)
      Tests  1648 passed (1648)
```

Desglose por archivo:

| Archivo | Casos |
| --- | --- |
| `tests/components/CajaComposicionBarra.test.tsx` | 14 passed (NUEVO) |
| `tests/components/ComposicionGananciaCard.test.tsx` | 15 passed (NUEVO) |
| `tests/unit/components/wallet-ledger-dueno.test.tsx` | 3 passed (NUEVO) |
| `tests/components/CajaResumenCard.test.tsx` | 20 passed (eran 19) |
| `tests/components/descarga/WalletDescarga.test.tsx` | 11 passed (eran 9) |
| `tests/integration/wallet-page.test.tsx` | 10 passed (eran 9) |
| `tests/unit/descarga/wallet-caja-descarga-columnas.test.ts` | 7 passed (sin cambio de número) |

`./init.sh` NO se corrió: lo corre el leader con el árbol quieto.

---

## 8. Mutaciones — la prueba de que estos tests no pasan por casualidad

Arnés en `scratchpad/mutaciones.py`. Cada mutación (a) **comprueba que el ancla existe una y
solo una vez** antes de reemplazar y que el archivo cambió de verdad —sin eso, un arnés roto
reporta «todo rojo» sin haber mutado nada—, (b) corre los tests, (c) restaura desde una copia
hecha antes de empezar. **M0 es el control sin mutar**: si no sale verde, el arnés no vale.

| # | Mutación | Resultado |
| --- | --- | --- |
| **M0** | **control, sin mutar (los 7 archivos)** | **VERDE — 80 passed** |
| M1 | la barra pierde el segundo segmento en `dos_bolsillos` | **ROJO** — 4 fallos |
| M2 | el ancho es un `50%` fijo, no el STRING del DTO | **ROJO** — 1 fallo |
| M3 | `solo_tiendas` se pinta como un reparto de dos | **ROJO** — 4 fallos |
| M4 | el bolsillo de Ordenex ignora el modo (siempre neutro) | **ROJO** — 2 fallos |
| M5 | el mensaje del caso límite no se pinta | **ROJO** — 3 fallos |
| M6 | la celda de «Dueño» pasa a ser un `Badge` | **ROJO** — 2 fallos |
| M7 | el dueño se DEDUCE de la categoría en el cliente | **ROJO** — 2 fallos |
| M8 | la columna «Dueño» no se declara en la descarga | **ROJO** — 3 fallos |
| M9a | las filas de ingresos se ordenan de MAYOR a menor importe | **ROJO** — 1 fallo |
| M9b | …de MENOR a mayor importe | **ROJO** — 1 fallo |
| M9c | …alfabetizadas por su etiqueta | **ROJO** — 1 fallo |
| M10 | la fila «Otros gastos» pinta otro importe | **ROJO** — 2 fallos |
| M11 | el total de la columna vuelve a ser el de los CUATRO conceptos | **ROJO** — 5 fallos |
| M12 | el pie deduce el signo en vez de leerlo del servidor | **ROJO** — 1 fallo |
| M13 | la composición no cruza por props desde la página | **ROJO** — 1 fallo |
| M14 | un hex suelto en una clase (R39) | **ROJO** — 2 fallos |
| M15 | un `Number(` sobre un importe (R12) | **ROJO** — 2 fallos |

**17 mutaciones, 0 supervivientes** — pero solo después de arreglar un agujero real que el
arnés destapó:

> **M9 SOBREVIVIÓ en la primera medición, y el fallo no era de la mutación: era del conjunto de
> prueba.** Los siete importes de ingreso estaban escritos ya ordenados de mayor a menor, y
> `Array#sort` es ESTABLE: ordenar por magnitud pintaba exactamente la misma secuencia y el caso
> de R28 pasaba en verde con el código roto. Se permutaron los importes (el mayor pasó al
> segundo puesto), se sustituyó la contraprueba por una que mide lo que dice —el mayor no es ni
> el primero ni el último— y se volvió a medir con **tres** variantes de orden. Las tres caen en
> rojo. Está anotado dentro del propio archivo de test para que nadie vuelva a «ordenar» ese
> conjunto sin enterarse de lo que rompe.

Ningún test de esta tanda tiene la forma `if (!datos) return;`. Los barridos de fuente
(`R12`, `R36`, `R39`) llevan **control de no-vacuidad explícito**, y el de R39 se
**auto-comprueba** contra una fuente falsa con `text-[#065f46]`, `bg-emerald-600` y
`border-red-500` dentro, en las dos direcciones.

---

## 9. Veredicto

**Los bloques 4, 5, 6 y 7 quedan hechos y medidos: 33 requisitos de pantalla cubiertos por test
ejecutado y nombrado, 17 mutaciones cazadas (0 supervivientes), las 18 aserciones de la 45 y la
158 re-hospedadas sin perder ninguna, las dos guardias de la 173 verdes sin editarse, y una
decisión abierta** (§4: la lista literal de columnas de la descarga en el test de la 170).

---

## 10. Vuelta de revisión — `progress/review_231.md` (RECHAZADO)

Cerrado el bloqueante de pantalla y los cuatro menores que el leader marcó. **No se tocaron**:
`tasks.md`, `progress/history.md`, `lib/utils/monto-escala-2.ts` ni la lista literal de columnas
de la descarga (las tres primeras son del leader; la cuarta la respalda el propio reviewer).

### 10.1 BLOQUEANTE — la columna de INGRESOS no comprobaba ni un importe

**El agujero, exacto.** La suite verificaba de esa columna los rótulos (R25), el orden (R28), el
número de filas (R23) y el TOTAL (R22) — y **ni un importe por concepto**. Los cinco `expect` con
importe del archivo estaban todos sobre `listaEgresos()`: eran los re-hospedados de la 45/158. Con
eso, una tarjeta que pintara el MISMO importe en las siete filas pasaba en verde, porque el total lo
manda el servidor y la resta seguía cuadrando en pantalla.

**El arreglo.** Caso nuevo **«R22/R23: cada concepto lleva SU importe, no el del vecino»**
(`tests/components/ComposicionGananciaCard.test.tsx`). Empareja **rótulo ↔ importe fila a fila**:
los pares se leen del contenedor de CADA renglón (`[...lista.children]`) y no de dos
`querySelectorAll` paralelos, así que un **intercambio de importes entre dos filas** —que dos listas
paralelas no distinguirían— también cae. Los importes van escritos a mano, no recalculados con
`money()`, que es la función que la pantalla usa y que por tanto no podría contradecirla. Cubre las
dos columnas: la de egresos arrastraba de la 45 la misma debilidad suave (rótulo e importe afirmados
por separado dentro de la misma lista) y queda cerrada de paso.

Y el caso hermano **«CONTROL: los importes del conjunto son distintos entre sí, ya formateados»**,
que es la lección del M9 aplicada por adelantado: si dos conceptos valieran lo mismo *ya
formateados*, cablear mal una fila no cambiaría ni un píxel. Comprueba que los 7 importes de
ingresos y los 5 de egresos son distintos entre sí **después** de pasar por `money()` (₡150,
₡4.000, ₡900, ₡20, ₡520, ₡30, ₡90) y que ninguno coincide con un total.

**Las dos medidas que pidió el leader**, con la mutación que él mismo indicó:

```
$ sha256sum app/(app)/wallet/_components/ComposicionGananciaCard.tsx
b884209cd66d911f161d112bc3f69557e3db6102c14138859659f5c5273a7109   ← ANTES

# mutación aplicada (comprobado que el ancla existe UNA sola vez):
#   valor={composicion.ingresos[categoria]}  ->  valor={composicion.ingresos.ingreso_flete}
$ sha256sum …/ComposicionGananciaCard.tsx
ec643165cd34f3f77c398ae7c8ee31ca79ae9b3e8df6f9b3cf90a4184c34349f   ← MUTADO

$ pnpm exec vitest run tests/components/ComposicionGananciaCard.test.tsx \
                       tests/integration/wallet-page.test.tsx
 FAIL  … > R22/R23: cada concepto lleva SU importe, no el del vecino
    - "importe": "₡20",        + "importe": "₡150",   ("IVA del flete")
    - "importe": "₡520",       + "importe": "₡150",   ("IVA del flete de devolución")
    - "importe": "₡30",        + "importe": "₡150",   ("IVA de la comisión")
    - "importe": "₡90",        + "importe": "₡150",   ("Ajuste (ingreso)")
 Test Files  1 failed | 1 passed (2)
      Tests  1 failed | 27 passed (28)                ← ROJO

# restaurado desde la copia previa
$ sha256sum …/ComposicionGananciaCard.tsx
b884209cd66d911f161d112bc3f69557e3db6102c14138859659f5c5273a7109   ← IDÉNTICO BYTE A BYTE

$ pnpm exec vitest run tests/components/ComposicionGananciaCard.test.tsx \
                       tests/integration/wallet-page.test.tsx
 Test Files  2 passed (2)
      Tests  28 passed (28)                            ← VERDE
```

### 10.2 Menores cerrados

| # | Hallazgo | Qué se hizo | Test que lo sostiene |
| --- | --- | --- | --- |
| 1 (rev. menor 7) | el copy enumeraba lo que entra y **omitía el pago a mensajeros**, que por D2 sí entra | la descripción pasa a «…sueldos, **indemnizaciones y pagos a mensajeros**». O se nombra todo o no se enumera: una lista parcial de lo que entra induce a error sobre dinero (940 de 3 940,50 en el libro de no-regresión) | «R29 (D2): el copy NOMBRA el pago a mensajeros, que ahora sí entra» — y comprueba además que lo nombra como algo que ENTRA, no como una exclusión |
| 2 (rev. menor 2) | los mensajes de `solo_ordenex` y `sin_reparto` iban en `text-danger-strong` siendo informativos | el `Record` TOTAL `BOLSILLO_ORDENEX` gana `tonoMensaje`: `TONO_INFORMATIVO` (`text-muted-foreground`) para los tres modos neutros, `TONO_PELIGRO` sólo para `solo_tiendas`, que es el único que describe un ESTADO | los casos de R16 (exige `text-danger-strong`), R17 y R18 (exigen `text-muted-foreground` y **prohíben** `danger`) |
| 3 (rev. menor 6) | la aserción que sustituyó a D1 casi no podía ponerse roja | se mide sobre **cuatro** conjuntos en vez de dos —vacío, sin las categorías de la 173, con ellas y **el catálogo ENTERO en runtime** (17 categorías)— y se afirma que los cuatro juegos de encabezados son idénticos. Deja de hablar sólo de las dos categorías de la 173 y afirma lo general, que es lo que su título dice. Queda escrito dentro del caso que la red de *cuáles* son las columnas la aporta R35, para que nadie borre aquél creyendo que la protección vive aquí | el propio caso, ahora con mutación que lo pone rojo (MB4) |
| 4 (rev. menor 3) | el barrido money-safe de R12 cubría 4 de las 7 fuentes de cliente tocadas | `FUENTES_NUEVAS` pasa de 4 a **7**: entran `WalletLedger.tsx`, `WalletModule.tsx` y `wallet-ledger-descarga-columnas.ts` (ésta emite el monto). `wallet-labels.ts` no entra a propósito: ya la censa el barrido transversal de la 172, y duplicarlo sería una segunda oportunidad de escribir mal la expresión | «R12: ninguna fuente nueva tiene forma de operar con dinero» (7 fuentes) y «R39: sin hex ni utilidades de paleta ad-hoc» (las mismas 7) |

### 10.3 Mutaciones de la vuelta — 6 aplicadas, 0 supervivientes

Mismo arnés que §8, más **verificación de la restauración por `sha256` archivo a archivo** (una
mutación que no se revierte del todo es peor que no haberla hecho).

| # | Mutación | Resultado |
| --- | --- | --- |
| **M0** | **control, sin mutar (los 4 archivos de test)** | **VERDE — 63 passed** |
| MB1 | los siete conceptos de ingreso pintan el MISMO importe *(la del bloqueante)* | **ROJO** — 1 fallo |
| MB2 | `solo_ordenex` vuelve al tono de peligro | **ROJO** — 1 fallo |
| MB2b | `TONO_INFORMATIVO` pasa a `text-danger-strong` (los dos informativos a la vez) | **ROJO** — 2 fallos |
| MB3 | el copy vuelve a callarse el pago a mensajeros | **ROJO** — 1 fallo |
| MB4 | una columna del libro pasa a **depender de las FILAS** (`dueno` sólo si hay un movimiento de terceros) | **ROJO** — 1 fallo |
| MB5 | un `Number(` en `WalletModule.tsx`, una de las tres fuentes recién barridas | **ROJO** — 1 fallo |
| **cierre** | **restaurado y re-medido** | **VERDE — 63 passed**, `sha256` idéntico en los 4 archivos |

MB4 es la que demuestra que el refuerzo del menor 3 no es cosmético: con la columna condicionada a
los datos, el conjunto «sin las categorías de la 173» pierde «Dueño» y el «con ellas» no, así que la
igualdad de los cuatro juegos cae. Con la aserción anterior —dos conjuntos y columnas estáticas— esa
misma mutación habría pasado igual de roja, pero **sólo** por ese camino; ahora además el catálogo
entero y la tabla vacía entran en la medida.

### 10.4 Salida real de la vuelta

```
$ pnpm run typecheck
> tsc --noEmit
(sin salida: 0 errores)

$ pnpm run lint
✖ 69 problems (0 errors, 69 warnings)
  (los mismos 69 preexistentes; ningún archivo de esta feature aparece en la salida)

$ pnpm exec vitest run <los 9 archivos de test de la feature>
 Test Files  9 passed (9)
      Tests  93 passed (93)        (eran 90: +3 casos de esta vuelta)

$ pnpm exec vitest related --run <las 9 fuentes de `app/` tocadas>
 Test Files  29 passed (29)
      Tests  392 passed (392)      (eran 389)

$ pnpm exec vitest run tests/components/descarga tests/components/paginacion tests/unit/descarga
 Test Files  50 passed (50)
      Tests  371 passed (371)

$ pnpm run test:guardias
 Test Files  111 passed (111)
      Tests  1648 passed (1648)
```

Desglose de los archivos con casos nuevos en esta vuelta:

| Archivo | Casos | Antes |
| --- | --- | --- |
| `tests/components/ComposicionGananciaCard.test.tsx` | 18 passed | 15 |
| `tests/components/CajaComposicionBarra.test.tsx` | 14 passed | 14 (3 casos reforzados) |
| `tests/components/descarga/WalletDescarga.test.tsx` | 11 passed | 11 (1 caso reforzado) |

`./init.sh` NO se corrió: lo corre el leader con el árbol quieto.

### 10.5 Lo que queda fuera de esta vuelta, y por qué

- **BLOQUEANTE 2 (`tasks.md` sin marcar)**, la entrada de `progress/history.md` (menor 1) y el
  paso de la ficha a `done`: son del leader, por indicación suya.
- ~~**`lib/utils/monto-escala-2.ts` y su guardia (menor 4 del reviewer)**~~ — **CERRADO**. El
  humano firmó que el módulo se queda, y su barrido propio entró como **segundo oficio** de
  `tests/unit/guards/caja-composicion-exhaustiva.guardia.test.ts` (+6 casos). Medido rojo con un
  `Number(` colado y verde tras restaurar, con el `sha256` del módulo idéntico antes y después:
  §4.1 «CERRADO» y §6 «La guardia del menor 4, vista fallar».
- **La lista literal de columnas de la descarga (menor 5 del reviewer)**: el reviewer está de
  acuerdo con lo hecho y recomienda dejarla. Se deja.

---

## 11. Último cierre — el CONTROL de colisiones, derivado del fixture

El reviewer levantó el rechazo, pero quedaba una variante del mismo defecto que esta feature se
pasó el día cazando, esta vez **dentro de un control**.

**El agujero.** El caso «CONTROL: los importes del conjunto son distintos entre sí, ya
formateados» (`tests/components/ComposicionGananciaCard.test.tsx`) comprobaba una **lista literal
escrita a mano**. Hoy coincidía con `COMPOSICION`, así que protegía — pero estaba desacoplada del
fixture: el día que alguien tocara un importe, el caso de emparejado se pondría rojo y se
actualizaría, y **este control seguiría verde afirmando sobre un conjunto que ya no existe**. Y si
en ese cambio dos conceptos colapsaran al mismo texto —fácil desde la 230, que pinta sin céntimos:
`19.50` y `20.49` se pintan los dos `₡20`—, el intercambio entre esas dos filas volvería a
sobrevivir. El control dejaría de controlar justo cuando hace falta.

**El arreglo.** Se DERIVA del fixture:

```ts
const importesIngresos = WALLET_INGRESO_PROPIO_SEED.map((c) => money(COMPOSICION.ingresos[c]));
expect(new Set(importesIngresos).size).toBe(WALLET_INGRESO_PROPIO_SEED.length);
```

y lo mismo para las cinco filas de egresos (los cuatro conceptos de `DESGLOSE` más
`COMPOSICION.otrosEgresos`) y para los dos totales.

**La distinción que queda escrita dentro del caso**, porque es sutil y alguien la querría
«arreglar» en la dirección contraria: en el caso de emparejado los importes van a mano porque el
sujeto de la prueba es **la pantalla**, y comprobarla contra la misma función que la pinta sería
una aserción contra su propia fuente. Aquí el sujeto es **el conjunto de prueba**, y lo que se
quiere saber es si colisiona *bajo el formateador real*: `money()` es parte del sujeto, no el
oráculo.

### Las dos medidas

```
$ sha256sum tests/components/ComposicionGananciaCard.test.tsx
5c295a78e73dc2ce74304e91cc0992487478ada0a17a5c01a3418394f78ca153   ← ANTES

# mutación del FIXTURE (ancla comprobada única):
#   ingreso_iva_comision_cod: "30.25" -> "20.49"
#   (colisiona con ingreso_iva_flete "19.50": los dos se pintan ₡20)
$ sha256sum tests/components/ComposicionGananciaCard.test.tsx
0e2ed2ed5775b0151714dc4aa155deaa651a883953c83c84858cd18b667a2052   ← MUTADO

$ pnpm exec vitest run …/ComposicionGananciaCard.test.tsx -t "CONTROL: los importes del conjunto"
 FAIL  … > CONTROL: los importes del conjunto son distintos entre sí, ya formateados
 AssertionError: expected 6 to be 7   ← seis textos distintos para siete conceptos
 Test Files  1 failed (1)
      Tests  1 failed | 17 skipped (18)          ← ROJO, y el rojo es SUYO (los otros 17, saltados)

$ pnpm exec vitest run …/ComposicionGananciaCard.test.tsx      (archivo entero)
     × R22/R23: cada concepto lleva SU importe, no el del vecino
     × CONTROL: los importes del conjunto son distintos entre sí, ya formateados
      Tests  2 failed | 16 passed (18)

# restaurado desde la copia previa
$ sha256sum tests/components/ComposicionGananciaCard.test.tsx
5c295a78e73dc2ce74304e91cc0992487478ada0a17a5c01a3418394f78ca153   ← IDÉNTICO BYTE A BYTE

$ pnpm exec vitest run tests/components/ComposicionGananciaCard.test.tsx
 Test Files  1 passed (1)
      Tests  18 passed (18)                       ← VERDE
```

Con la lista literal anterior esa misma mutación habría dejado el control **en verde**: es la
prueba de que el arreglo no es cosmético.

### Y el otro encargo de comentario (sin tocar aserciones)

`tests/unit/descarga/wallet-caja-descarga-columnas.test.ts` — queda escrito dentro del caso por
qué su literal de columnas **se queda** aunque el de D1 hubo que quitarlo: aquél fijaba cuántas
columnas puede tener la PANTALLA y era un polizón que acabó gobernando features ajenas; éste fija
el CONTRATO DEL ARCHIVO que se descarga —un artefacto que alguien abre fuera de la app—, así que el
literal ES lo que el caso quiere afirmar. Y no se sustituye por una comparación contra
`COLUMNAS_DESCARGA_WALLET_CAJA` porque sería comparar la lista consigo misma: una aserción contra
su propia fuente, que no puede ponerse roja nunca.

### Salida real del cierre

```
$ pnpm run typecheck            → 0 errores
$ pnpm run lint                 → 0 errors, 69 warnings (los preexistentes)
$ pnpm exec vitest run <los 9 de la feature>
 Test Files  9 passed (9)       Tests  93 passed (93)
$ pnpm exec vitest run tests/unit/descarga/wallet-caja-descarga-columnas.test.ts
 Test Files  1 passed (1)       Tests  7 passed (7)
$ pnpm run test:guardias
 Test Files  111 passed (111)   Tests  1654 passed (1654)
```

*(El conteo de guardias sube de 1648 a 1654 respecto de §7 porque el leader marcó las tasks de
`specs/231-…/tasks.md` mientras tanto y `test-citado-desaparecido.guardia` genera sus casos a
partir de esos documentos. No es de esta tanda.)*
