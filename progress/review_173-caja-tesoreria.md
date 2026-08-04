# Feature 173 — La caja principal en modo tesorería · REVIEW

> **Ronda 2 — 2026-08-03.** Rama `feature/173-caja-tesoreria`, 35 commits contra `origin/dev`.
> El arreglo bajo revisión es `97cff1da`. Todo lo de abajo está **medido en esta sesión**: la
> mutación la ejecuté yo, no la di por buena. La ronda 1 queda íntegra al final, como histórico.

# VEREDICTO (ronda 2): **APROBADO**

**0 bloqueantes · 0 menores atribuibles al código · 68 de 68 `R` trazados.**

El BLOQUEANTE 1 queda **CERRADO**, y cerrado bien: no por añadir un `expect` que pasara, sino por
un caso que **muere** cuando el requisito se revierte, con su autocomprobación contra el texto
literal anterior. Los menores 1, 4 y 6 también quedan cerrados. No aparece nada nuevo.

---

## 1. BLOQUEANTE 1 (R53) — **CERRADO**. Lo verifiqué así

### 1.1 Ejecuté la mutación yo mismo

Sustituí la línea 464 de `lib/analytics/metrics.ts` por la descripción **exacta de `origin/dev`**
(extraída con `git show origin/dev:lib/analytics/metrics.ts`, no reescrita a mano) y corrí la suite.

```
 FAIL  metrics-caja-naturaleza.guardia.test.ts > R53/R54 · … > R53 · la de `egresos` dice que
       DESDE LA 173 incluye el dinero entregado a las tiendas
       -> expected '…wallet; se lee del ledger…' to match /dinero entregado a las tiendas/  (:190)

 FAIL  metrics-caja-naturaleza.guardia.test.ts > R53/R54 · … > y la asercion discrimina: el texto
       pre-173 NO la pasa, aunque ya nombraba «tienda»
       -> expected false to be true                                                         (:210)

 Test Files  1 failed (1)
      Tests  2 failed | 17 passed (19)
```

**Dos rojos, y son los dos que el informe anunciaba: `:190` y `:210`.** Mutación revertida desde
copia de seguridad; `git diff` vuelve a estar vacío y `pnpm typecheck` sale en exit 0.

### 1.2 Y medí el **radio de la explosión**, que es lo que de verdad prueba que el hueco era real

Con la mutación puesta, corrí **toda** `tests/unit/analytics`:

```
 Test Files  1 failed | 61 passed (62)
      Tests  2 failed | 801 passed (803)
```

**61 archivos verdes, incluido `metrics.test.ts`.** Eso es la demostración ejecutable de lo que
denuncié en la ronda 1: hasta este commit, R53 se podía revertir con la suite entera en verde. Y
también demuestra que el caso nuevo **no está anclado en otro sitio**: es el único que lo caza.

### 1.3 El caso `:204` hace exactamente lo que dice — comprobado byte a byte

Era mi segunda preocupación: un fixture «casi» literal, o un rechazo por un motivo distinto del que
R53 exige, habría reproducido el defecto original. Lo comprobé sin fiarme del texto del archivo:
extraje la descripción de `egresos` de `origin/dev` y de `HEAD`, reconstruí la concatenación del
fixture `DESCRIPCION_EGRESOS_PRE_173` y las comparé.

```
fixture === descripcion de origin/dev ?  true
longitudes:                              253  253
predicado sobre la VIEJA :  [ false, false, false ]  => false
predicado sobre la NUEVA :  [ true,  true,  true  ]  => true
vieja contiene "pagos a tienda":                              true
vieja pasa el guardia viejo (/gestion(es)? anulada/):         true
```

Tres cosas quedan probadas y las tres importan:

1. **El fixture es literal**, 253 caracteres idénticos. No es un recuerdo del texto viejo.
2. **El texto viejo falla las TRES cláusulas del predicado**, no una por casualidad. Es decir, lo
   rechaza por los motivos que R53 enumera (qué entra, desde cuándo y por qué feature, y dicho como
   inclusión), no por un detalle incidental.
3. **El argumento del implementer es cierto y verificable**: el texto viejo ya decía «pagos a
   tienda», así que un `toMatch(/tienda/)` habría dado verde — y además pasaba el único censo de
   descripciones que existía. La autocomprobación de `:204` no es adorno: es lo que impide que el
   arreglo repita el error que denunció.

### 1.4 Mutación extra, mía, sobre R54

El informe no la traía. Intercambié las descripciones de `dinero_en_caja` y `ganancia_ordenex` —que
es exactamente el fallo «descripción prestada» que R54 nombra—:

```
 FAIL  … > R54 · `dinero_en_caja` y `ganancia_ordenex` tienen descripcion PROPIA, no prestada
      Tests  1 failed | 18 passed (19)
```

Rojo. El caso `:220` no es una comprobación de longitud disfrazada: afirma en positivo **y** en
negativo sobre cada una (`/incluye el contra-entrega/` en una y `/dejando fuera el dinero de
terceros/` en la otra, y cada una **no** la de su hermana), más distinción frente a las 23 restantes
con control de no-vacuidad (`>= 23`). Mutación revertida.

---

## 2. Re-auditoría de la trazabilidad de R53 y R54 (mi método, no contando `R\d+`)

Leí el caso citado y comprobé que verifica lo que el requisito pide, que es lo que falló en la
ronda 1.

- **R53** (`requirements.md:263-264`) exige que **la descripción** de la métrica de salidas diga que
  desde esta feature incluye el dinero entregado a las tiendas.
  `metrics-caja-naturaleza.guardia.test.ts:180` lee `getMetrica("egresos").descripcion` y exige las
  **tres** piezas por separado (`:190`, `:193`, `:194`), el predicado completo (`:195`) y que el
  resto de la frase siga en pie (`:200-201`). **Verifica**, y muere bajo mutación (§1.1).
- **R54** (`requirements.md:266-267`) exige las dos cifras como métricas propias, con **id propio y
  descripción propia**. El id y que se sirvan los cubre
  `analitica-financiera-service.test.ts`; la mitad que faltaba —descripción propia, distinta entre sí
  y de las 23 demás, y cada una diciendo lo suyo— la cubre `:220`. **Verifica**, y muere bajo
  mutación (§1.4).

Las dos filas de `specs/173-caja-tesoreria/tasks.md:494-495` citan ahora el archivo **con su línea**
y el título del caso, y la nota metodológica de `:428-433` explica por qué la fila de R53 cambió por
segunda vez. La corrección no infla la cobertura: cita el caso que la da.

**Resultado de la re-auditoría: 68 de 68 `R` trazados a un test que de verdad los verifica.**
(Los otros 66 los audité en la ronda 1 leyendo el contenido de los casos, no contando `R\d+` en
títulos —que cruza espacios de nombres, porque el R32 de la 172 y el R35 de la 158 viven en archivos
de este diff—.)

---

## 3. Menor 6 — **CERRADO**. El diff de `metrics.ts` vuelve a la letra de la autorización

Medido sobre el árbol:

```
lineas borradas en lib/analytics/metrics.ts (origin/dev...HEAD):  2
  -  /* ---------------------------- 8 FINANCIERAS ---------------------------- */
  -      "Salidas de la caja principal (…) segun el libro append-only de la wallet; se lee del
         ledger, no de ordenes, y las gestiones anuladas no generan movimiento que contar.",
ids nuevos:  2   (dinero_en_caja, ganancia_ordenex)
```

La línea 6 recupera sus `**` y ahora solo **gana** el comentario de la autorización. Las dos
borradas que quedan son (a) el banner del conteo, bookkeeping obligado por las dos métricas nuevas,
y (b) la descripción de `egresos`, que es el punto 1 autorizado. `egresos.id`, `egresos.etiqueta` y
sus **ocho** `definicion.categorias` siguen intactos, y `ingreso_ajuste` sigue fuera, que es lo que
`decision_F2_173.md:42-44` excluye por escrito.

## 4. Menor 1 — **CERRADO**

`specs/173-caja-tesoreria/tasks.md:411` marcada `[x]`. Barrido sobre el archivo: la **única** task
sin marcar es `T H.4` (`:403`), que es post-deploy por necesidad.

## 5. Menores 2, 3 y 5 — los gestiona el leader, no los cuento como pendientes del código

- **2 (`T H.4`)**: post-deploy obligado; las dos categorías del enum no existen en producción hasta
  desplegar. Declarada con su condición y con el límite de preview (no alcanzable por MCP, riesgo
  residual declarado y ya aceptado por el humano en la 172).
- **3 (`history.md`)**: tarea de cierre.
- **5 (`[P2]` por guardias y no por el compilador)**: declarado en `design.md:335-343`, compensado
  por cuatro guardias ejecutables e **inevitable** dado R19. Queda escrito para quien mantenga.

---

## 6. Estado del gate y no-regresión, medido por mí tras restaurar el árbol

| Qué corrí | Resultado |
| --- | --- |
| `pnpm exec vitest run tests/unit/analytics` | **62 archivos / 803 tests, 0 fallos** |
| `pnpm exec vitest run guard` | **48 archivos / 724 tests, 0 fallos** (ronda 1: 48 / 721 ⇒ **+3**, los tres casos nuevos, dentro del archivo de guardia que ya existía) |
| `pnpm run typecheck` | `tsc --noEmit`, **exit 0** |
| `git status` / `git diff` | árbol limpio: las dos mutaciones revertidas, `lib/` sin tocar |

El delta cuadra con el `./init.sh` completo del leader (**859 archivos / 10.908 tests, 0 fallos**;
ronda 1: 859 / 10.905): **+3 tests, +0 archivos**. En mi corrida de la ronda 1 el único rojo era el
flake de jsdom de `tests/components/CuentasPorPagarTable.test.tsx` —fuera del diff, 6/6 verde en
aislado—; en la corrida del leader con el arreglo dentro no aparece. **Menor 4 cerrado por
observación**: era el flake, no una regresión.

## 7. Nada nuevo

Revisé el commit `97cff1da` entero: toca **4 archivos** (`lib/analytics/metrics.ts` con **una** línea
de comentario, el archivo de guardia, `tasks.md` y la bitácora). No introduce dependencias, no toca
ningún servicio, repositorio, migración ni pantalla, y no modifica ninguna aserción preexistente —el
bloque nuevo se añade **debajo** del de `egresos`, sin tocarlo—. No aparece ningún hallazgo nuevo.

## 8. Lo que queda, y no es del código

`T H.4`: `--simular` → revisión humana del informe → `--aplicar` → `--comprobar` en **cada** entorno
tras el despliegue, con las cifras leídas de la base y no deducidas del PR. Es **condición de cierre
de la feature**, no de este review.

---
---

# RONDA 1 (histórico, 2026-08-03) — el estado que motivó el rechazo


> Reviewer, 2026-08-03. Rama `feature/173-caja-tesoreria`, diff contra `origin/dev` (34 commits,
> 90 archivos, +14.683 / −407). Todo lo de abajo está **medido en esta sesión**, no leído de la
> bitácora del implementer.

## Veredicto de la ronda 1 (histórico): **RECHAZADO**

**1 bloqueante · 6 menores · 67 de los 68 `R` trazados a un test que de verdad los verifica.**

El bloqueante es de trazabilidad, no de código: **R53 no tiene ningún test que lo verifique**. Todo
lo demás que revisé —incluidas las cuatro cosas marcadas con lupa— está bien, y en dos casos mejor
de lo que la bitácora prometía. El arreglo es un caso de test, no un cambio de diseño.

---

## Checklist de `CHECKPOINTS.md`, punto por punto

### Especificación
- [x] `specs/173-caja-tesoreria/requirements.md` — 68 `R` en EARS numerados, con las 7 preguntas de
      la puerta y sus consecuencias.
- [x] `specs/173-caja-tesoreria/design.md` — §10 lleva **seis** alternativas descartadas (A–F), cada
      una con su motivo. Sobra con una.
- [ ] `specs/173-caja-tesoreria/tasks.md` con todas las tasks `[x]` — **`T H.4` y `T H.5` en `[ ]`**
      (ver menores 1 y 2; `T H.4` es post-deploy legítimo).

### Trazabilidad
- [ ] **Cada `R<n>` mapea a al menos un test concreto** — **67/68. Falla R53** (BLOQUEANTE 1).
- [x] `progress/impl_173-caja-tesoreria.md` contiene el mapa `R<n> → test`, por tanda (§7, §B8, §C10,
      §A2.8, §D8, §E11, §F7, §G9) y auditado en §H5.

### Calidad de código
- [x] `pnpm run typecheck` — `tsc --noEmit`, sin salida, **exit 0** (corrido por mí).
- [x] `pnpm run lint` — pasó dentro de `./init.sh` (va **antes** de `test`, y `run_if` hace `fail` si
      revienta: llegar a `pnpm run test` es la prueba de que typecheck y lint quedaron verdes).
- [~] `pnpm test` — **10.904 pasados / 10.905, 1 rojo**: `tests/components/CuentasPorPagarTable.test.tsx:168`.
      Reejecutado en aislado: **6/6 verde**. El archivo **no está en el diff**. Flake conocido de
      jsdom en esta máquina (menor 4).
- [N/A] **E2E**: este repo **no tiene arnés E2E** (precedente declarado en specs anteriores, y
      `design.md §12` lo dice). Checkpoint **inaplicable**. El riesgo está cubierto por otra vía y lo
      verifiqué: 46 tests de `tests/integration/db/caja-*` corriendo **contra el Postgres real**
      (comprobado con `--reporter=verbose`: el `CHECK` rechaza con `23514` en 151 ms, las 17
      combinaciones invertidas una a una y las 17 legítimas como contraprueba), más la medición por
      MCP de `progress/medicion_TA0_173.md`.

### Datos y seguridad (Supabase)
- [x] **RLS**: la feature **no crea ninguna tabla** ⇒ cero superficie RLS nueva.
      `migration.sql:23-25` lo declara y `caja-tesoreria-migration.test.ts:162` lo afirma sobre el
      SQL, y el `down.sql` también (`:307`).
- [x] **Migración versionada y reversible**: `db/migrations/20260803120000_caja_tesoreria/` con su
      `down.sql`. El `DROP CONSTRAINT` va **antes** de los `DROP INDEX` y del cast, que es lo
      correcto (el `CHECK` nombra los dos valores del enum que se retiran) y hay un test que lo fija
      (`:282`). El `down` recrea los **15** valores previos y los **2** índices que citan `categoria`.
- [x] **R50 verificado sobre el árbol**: `git diff --name-only origin/dev...HEAD` devuelve **un solo**
      `down.sql`, el de esta carpeta. Ningún `down.sql` previo se tocó.
- [x] **Sin secretos hardcodeados**: `scripts/backfill-caja-tesoreria.ts` lee `DATABASE_URL` del
      entorno, aborta si falta y ecoa el destino **sin usuario ni contraseña** (tres casos en
      `backfill-caja-tesoreria-cli.test.ts:251-271`).
- [N/A] **Webhooks**: la feature no añade ninguno.

### Patrón de capas
- [x] Controller sin queries: `lib/actions/wallet.ts` y `lib/actions/liquidacion.ts` solo resuelven
      actor, cablean y traducen errores.
- [x] Service sin HTTP: `WalletService.verResumenCaja` agrega con el repo y deriva con `derivarCaja`
      (pura). Ni `Request` ni `Response` ni `headers`.
- [x] Repository solo Prisma: `WalletMovimientoRepository.agregarPorCategoriaYTipo` hace `groupBy` y
      `toFixed(2)`; **no** particiona por naturaleza ni resta.
- [x] Interfaces en `lib/interfaces/` separadas: 3 nuevas en `services/`, la ampliación en
      `repositories/`.
- [nota] `CierresAdminRepository` llama a un servicio-feed. Es el **patrón preexistente** de las
      features 42/43/44 (tres feeds ya colgaban de ahí), no algo que introduzca la 173, y `T B.2` lo
      hizo con **cero dependencias nuevas** en el constructor (test que cuenta 8 parámetros en
      `cierres-admin-caja-cod.test.ts:408`). No lo cuento como hallazgo.

### Permisos
- [x] `app/(app)/wallet/page.tsx` valida en servidor; `esAccesoTotal` se evalúa **antes** de tocar la
      base (contraprueba con cero llamadas al repositorio) y `wallet-page.test.tsx:221` añade el caso
      duro: si el **resumen** niega, no se pinta ni el libro.
- [x] `CajaResumenCard` recibe todo por props, ya derivado y serializado.
- [x] Mutaciones por Server Actions.

### Multi-país / configuración
- [x] Nada de país, moneda ni cuenta hardcodeado. `CajaResumenCard` pinta con el `money` que ya
      existía y los importes llegan como STRING del servidor.

### Verificación final
- [~] `./init.sh` completo — 859 archivos / 10.905 tests, **1 rojo ajeno y flake** (menor 4).
- [x] `progress/review_173-caja-tesoreria.md` — este archivo.
- [ ] Entrada en `progress/history.md` — **no está** (menor 3).

---

## Los cuatro puntos de lupa, verificados

### 1. `[P2] = (a)`: ¿sigue siendo IMPOSIBLE escribir `egreso_pago_mensajero` desde la liquidación?

**Sí en la práctica; con un matiz que hay que decir en voz alta (menor 5).**

Lo que **sí** es imposible por compilación:
- `LiquidacionService` recibe `ICajaPagoTiendaFeedService`, **no** `IWalletMovimientoRepository`
  (`lib/services/LiquidacionService.ts:151-160`). El repositorio queda encapsulado dentro del puerto
  (`lib/actions/liquidacion.ts:90`).
- El puerto tiene **dos** métodos y su petición **no lleva `tipo`, `categoria` ni `origenTipo`**
  (`lib/interfaces/services/ICajaPagoTiendaFeedService.ts:41-53`): los fija el implementador
  (`lib/services/CajaPagoTiendaFeedService.ts:42-43` y `:67-70`), como literales.
- Y no es lectura de comentarios: `liquidacion-caja-puerto.test.ts:177-203` **intenta colar**
  `{tipo:"ingreso", categoria:"egreso_pago_mensajero", origenTipo:"pago_mensajero"}` en la petición y
  comprueba que el puerto los ignora y escribe `egreso`/`egreso_pago_tienda`.

El matiz: para que el egreso vaya en la **misma** transacción (R19), `LiquidacionTx` tuvo que ganar
`CajaPagoTiendaTxClient` (`lib/interfaces/services/ILiquidacionService.ts:40-45`). Con eso,
`tx.walletMovimiento.createMany(...)` **compila** dentro de `LiquidacionService`. La imposibilidad
deja de ser del compilador y pasa a ser de **cuatro guardias ejecutables independientes** que exigen
que la fuente del servicio no nombre `walletMovimiento` ni una sola vez:

- `tests/unit/services/liquidacion-caja-puerto.test.ts:74`
- `tests/unit/services/liquidacion-service.test.ts:650`
- `tests/unit/services/liquidacion-anulacion.test.ts:1204`
- `tests/unit/guards/liquidacion-alcance.test.ts:96-104` (`PROHIBIDO_FUERA_DEL_ROOT`), más
  `egreso_pago_mensajero` en `PROHIBIDO_EN_TODOS` **sin excepción, ni siquiera el composition root**.

`design.md:335-343` lo declara con esas palabras («la garantía baja un escalón») y enumera la
compensación. Es una degradación **declarada y compensada**, y dado R19 no había forma de evitarla
con el sistema de tipos: el `tx` es un solo objeto de Prisma. Va como **menor**, para que quede
escrito dónde vive ahora la garantía.

Además, R66 no se verifica por ausencia sino **midiendo**: `caja-173-alcance.guardia.test.ts:225`
ejecuta la fórmula con `P = 15.000` y `E = 9.000` **distintos** y comprueba que la caja carga `P` y
no `min(P,E)`; `:279` comprueba que el egreso se emite en el **cierre** y no en la liquidación.

### 2. Aserciones verdes reescritas — ¿más específicas o más débiles?

**Las tres, más específicas. Verificado leyendo el diff completo de cada archivo.**

- **T C.2** (`tests/unit/services/liquidacion-service.test.ts`): de un bucle «ningún método de
  `walletMovimiento` fue llamado» a **exactamente una** llamada con `tipo`, `categoria`, `monto`
  (`toFixed(2)`), `origenTipo`, `origenId` («el id que devolvió `crear`, no una constante»),
  `registradoPor`, `descripcion` y `fechaMovimiento` en ISO. **Y gana cuatro casos que antes no
  existían**: el `log` de la transacción ordenado (`crear:caja` **después** del ledger), «si la caja
  falla no queda el pago», «un solo redondeo para documento+ledger+caja» y «en la caja tampoco hay
  `update`/`delete`». La rama **mensajero** no se toca y **gana** una contraprueba nueva sobre el
  puerto (`:1120-1131`).
- **T C.3** (`liquidacion-anulacion.test.ts`): igual, más
  `expect(fila.categoria).not.toBe("ingreso_ajuste")` y la fecha del **día de la anulación**
  contrastada contra la del pago (seis días de distancia).
- **§C13** (`tests/unit/guards/liquidacion-alcance.test.ts`): la lista única de 8 prohibidos se parte
  en dos. La relajación afecta a **3 nombres** y **solo** en `lib/actions/liquidacion.ts`, que es el
  composition root — el sitio donde por definición se cablea. `egreso_pago_mensajero`,
  `egreso_pago_tienda`, `ingreso_reverso_pago_tienda`, `ingreso_ajuste`, `reversarEgreso`,
  `WalletEgresoService` y `wallet_movimiento` **siguen prohibidos en los ocho archivos**. A cambio
  entra un caso nuevo (`:213-263`) con cuatro afirmaciones: una sola instancia del repositorio y
  siempre envuelta, el puerto emite exactamente 2 de las 17 categorías (filtrado contra el catálogo
  completo, no contra una lista corta), el puerto no nombra la del mensajero, y expone 2 métodos.
  **Es un alcance cerrado donde antes había una prohibición: más difícil de satisfacer por accidente.**

### 3. El diff de `lib/analytics/metrics.ts` contra `decision_F2_173.md`

**Confirmado: 3 líneas borradas, 2 ids nuevos, y nada más.** Las tres borradas son:

1. `metrics.ts:6` — el comentario de cabecera pierde la negrita del conteo viejo (`= **… = 23**` →
   `= … = 23`) porque la línea siguiente añade el conteo nuevo `= 25`.
2. `metrics.ts:387` — el banner `8 FINANCIERAS` → `10 FINANCIERAS`.
3. `metrics.ts:463-464` — la `descripcion` de `egresos`.

Y lo que **NO** cambió, comprobado en el archivo y no en el diff:
- `egresos.id` y `egresos.etiqueta`, intactos (`:456-457`).
- `egresos.definicion.categorias` sigue con las **ocho** `egreso_*`, `egreso_pago_tienda` incluida
  (`:477-488`). **No** entró `ingreso_ajuste`, que es justo lo que la autorización excluye
  (`decision_F2_173.md:42-44`).
- Las dos métricas nuevas (`:490-573`) con `fuente: ledger / wallet_movimiento`, `ALCANCE_FINANCIERA`,
  y sus listas comprobadas **en runtime** contra `NATURALEZA_POR_CATEGORIA`
  (`metrics-caja-naturaleza.guardia.test.ts:199-237`: las 17, las 14 propias, y que la diferencia son
  exactamente las 3 de terceros).
- `IDS_FINANCIERAS_SERVIDAS` a 10, con el guardia de correspondencia catálogo↔servicio ampliado y
  fallando por exceso **y** por defecto (`financiera-correspondencia.guardia.test.ts:153`,
  `financiera-contratos.test.ts:394`).

El punto 1 es la única línea del diff que no es literalmente uno de los tres puntos autorizados: va
como **menor 6**.

### 4. El hallazgo del `neto` vs `bruto` dirigido a la 175

**Bien declarado y NO tapado. Verificado sobre el árbol, no sobre la bitácora.**

- `tests/unit/services/analitica-financiera-derivacion.test.ts` **no aparece en el diff**.
- `tests/unit/analytics/financiera-ingresos-repo.test.ts` sí aparece, pero el diff es **puramente
  aditivo a partir de la línea 180**: el doble en memoria de `:124` (`{categoria:"egreso_ajuste",
  tipo:"ingreso"}`) sigue intacto, que es exactamente lo que §H10 dice que se deja.
- La única reescritura, `F.4` en `tests/integration/actions/analitica-financiera-action.test.ts`, se
  hizo bajo decisión humana (opción A, §H9) y con **dos mutaciones ejecutadas** que demuestran que
  los dos casos discriminan cosas distintas: «el neto copia el bruto» pone rojos los dos, y «el
  repositorio deja de filtrar por las categorías declaradas» pone rojo **solo** `F.4(b)`. No es el
  mismo test dos veces.
- El encargo está en `feature_list.json`, ficha de la 175, con las dos rutas y sus líneas y la
  pregunta de fondo planteada como dos salidas excluyentes.

---

## Hallazgos

### BLOQUEANTE 1 — R53 no tiene ningún test que lo verifique

**Dónde:** `specs/173-caja-tesoreria/tasks.md:488` (fila de trazabilidad de R53) ·
`lib/analytics/metrics.ts:463-464` (lo que debería estar protegido).

**Qué dice R53** (`requirements.md:263-264`): «El sistema DEBE hacer que la **descripción** de la
métrica de salidas de la caja diga que, a partir de esta feature, incluye el dinero entregado a las
tiendas.»

**Qué citan los dos tests de la fila, y qué comprueban de verdad:**

- `tests/unit/analytics/metrics-caja-naturaleza.guardia.test.ts:127-132` — «declara UNA sola
  categoria de terceros, y es el pago a la tienda». Su único `expect` es
  `expect(tercerosDeclaradasPor("egresos")).toEqual(["egreso_pago_tienda"])`: mide
  **`definicion.categorias`**, que R53 no menciona. El archivo entero **no lee `.descripcion` ni una
  vez**; su única aparición es en un comentario (`:130`).
- `tests/unit/analytics/metrics.test.ts` — sus dos aserciones sobre descripciones son `:340-346`
  (solo para las tres `TASAS`, ajenas) y `:348-353`, que exige que **toda** descripción case
  `/gestion(es)? anulada|anulada_at/`. **El texto pre-173 también casa**, porque termina en «…las
  gestiones anuladas no generan movimiento que contar».

**Comprobación que hice:** barrido de `\.descripcion` sobre `tests/**` completo. Las únicas
aserciones sobre la descripción de una métrica son `metrics.test.ts:342` y `:350`. **Ninguna
menciona `egresos`, «tienda» ni la 173.**

**Por qué importa, y por qué es bloqueante y no menor:**

1. `docs/verification.md:73-75` — «Si un requisito no tiene test, o un test no verifica el requisito
   que dice cubrir, es hallazgo bloqueante».
2. No es un requisito decorativo: es **el punto 1 de los tres** que autoriza
   `progress/decision_F2_173.md:26-28`, y su función entera es declarar, **donde lo lee quien mira la
   cifra**, que `egresos` cambia de número el 2026-08-03 sin cambiar de `id` ni de nombre. Es la
   mitigación única del modo de fallo que P4 existía para evitar («quien compare mes contra mes vería
   un salto que no es un salto»). Hoy, borrar esa frase de `metrics.ts:464` deja **la suite entera en
   verde**: la protección es la memoria de quien revise el PR.
3. La auditoría de `T H.2` corrigió esta fila porque el archivo que nombraba
   (`metrics-descripciones.test.ts`) nunca existió — pero la sustituyó por una cita que **tampoco
   verifica el requisito**. El defecto sobrevivió a su propia auditoría, que es lo que lo hace
   peligroso: la tabla vuelve a decir 68/68.

**Qué falta para cumplirlo:** un caso ejecutable que lea `getMetrica("egresos")!.descripcion` y exija
que nombre el dinero entregado a las tiendas y la feature que lo causa. Por simetría conviene cubrir
a la vez la mitad no verificada de R54 («descripción **propia**»): hoy nada afirma que
`dinero_en_caja` y `ganancia_ordenex` tengan descripciones distintas entre sí y del resto. Ambas
cosas caben en un `describe` de tres `it` en `metrics-caja-naturaleza.guardia.test.ts`, junto al
bloque «egresos: gana el pago a tienda por diseño, y nada más» que ya existe. **Sin tocar `lib/`.**

### menor 1 — `T H.5` sin marcar pese a estar hecha

`specs/173-caja-tesoreria/tasks.md:411`. El gate completo se corrió (leader) y lo volví a correr yo
con los mismos totales. `CHECKPOINTS.md:9` pide todas las tasks en `[x]`. Importa poco por sí sola y
mucho como precedente: una task sin marcar y hecha entrena a leer la lista como decorativa.

### menor 2 — `T H.4` pendiente: **correctamente declarada, NO es defecto**

`specs/173-caja-tesoreria/tasks.md:403-409` + `impl §H7`. Las dos categorías nuevas del enum **no
existen en producción** hasta que la migración se aplique al desplegar, así que el registro
retroactivo es **necesariamente post-deploy**. Está declarada con su condición (`--comprobar` debe
decir «al día» con las cifras leídas de la base, no deducidas del PR) y con el límite heredado de
`T A.0`: **preview no es alcanzable por MCP** (cinco vías descartadas y documentadas en
`progress/medicion_TA0_173.md:47-74`), riesgo residual **declarado**, igual que en la 172. Queda
listada como **condición de cierre**, no como hallazgo.

### menor 3 — falta la entrada en `progress/history.md`

`CHECKPOINTS.md:46`. `git diff --name-only origin/dev...HEAD -- progress/` devuelve tres archivos y
`history.md` no está entre ellos. Es tarea de cierre del leader, pero el checkpoint lo pide.

### menor 4 — `./init.sh` completo termina en rojo por un flake ajeno

`tests/components/CuentasPorPagarTable.test.tsx:168` (`getByText("Ana Mensajera")`). Resultado de mi
corrida: **1 failed | 858 passed (859) · 1 failed | 10.904 passed (10.905)**, 220,95 s. Reejecutado
solo: **6/6 verde en 6,7 s**. El archivo **no aparece en el diff de la feature**. Es el flake de jsdom
conocido de esta máquina. **No es regresión de la 173**, pero el gate tal y como se corre hoy no
termina en verde y eso es lo que `CHECKPOINTS.md:44` mide.

### menor 5 — la garantía de `[P2]` pasó del compilador a cuatro guardias

`lib/interfaces/services/ILiquidacionService.ts:40-45`. `LiquidacionTx` ahora incluye
`CajaPagoTiendaTxClient = Pick<PrismaClient,"walletMovimiento">`, así que
`tx.walletMovimiento.createMany(...)` **compila** dentro de `LiquidacionService`. R23
(`requirements.md:149-151`) dice «no DEBE existir el camino», y el camino existe a nivel de tipos; lo
cierran los cuatro tests estructurales citados arriba. Está **declarado** en `design.md:335-343` y era
inevitable dado R19 (misma transacción ⇒ mismo objeto `tx`). No lo hago bloqueante porque la
compensación es real, ejecutable y redundante por cuadruplicado; lo dejo escrito porque el día que
alguien «simplifique» una de esas cuatro guardias, la decisión más cara de la feature se queda sin
red y nada lo avisará.

### menor 6 — una línea de `metrics.ts` fuera de la letra de la autorización

`lib/analytics/metrics.ts:6`. La autorización (`decision_F2_173.md:50-54`) dice que el diff debe ser
**exactamente** los tres puntos y que «cualquier otra línea está fuera y el review debe rechazarla».
La línea 6 pierde sus marcadores de negrita alrededor del conteo viejo. Es bookkeeping del mismo
conteo que el punto autorizado obliga a actualizar y no toca ningún `id`, `etiqueta`, `fuente` ni
`definicion`, así que **no** lo elevo a bloqueante — pero lo nombro para que la regla conserve el
filo con el que se escribió.

### Observación sin categoría — R32 y el desglose

`tests/unit/guards/caja-173-alcance.guardia.test.ts:536-566` mide `derivarSaldoTienda`,
`derivarCuentaPorPagar` y `derivarPendienteCierre` con importes pinchados, pero **no**
`derivarDesgloseTienda` (a favor / cargos / pagado), que R32 nombra. No es un hueco: esa función la
cubre `tests/unit/utils/desglose-tienda.test.ts`, que está **sin editar** y **sí corre en el gate**
(a diferencia de la medición de diff de `T G.4`, que es punto-en-el-tiempo). Se anota para que quien
lea la fila no la crea más estrecha de lo que es.

---

## Lo que quedó verificado y merece constar

- **La trazabilidad se re-auditó, no se aceptó.** Comprobé la existencia de los **28** archivos de la
  tabla (los 28 existen; las filas de R53/R57 ya no apuntan a archivos inventados) y leí el contenido
  de los casos citados para R1–R10, R11–R17, R18–R30, R31–R35, R36–R44, R45–R50, R51–R57 y R58–R68.
  **Sin contar `R\d+` en títulos**, que es el método que cruza espacios de nombres y da el falso
  68/68 (el R32 de la 172 y el R35 de la 158 viven en archivos de este diff).
- **Los tres `R` que la Tanda H rescató del limbo son reales.** R32 mide `16610.00`, `-1200.00`
  (negativo conservado, no recortado a cero), `6000.00` y `3500.00`; R35 fija la **arity 2** de
  `derivarSaldoTienda` con control de no-vacuidad; R63 barre **18** componentes de las tres pantallas
  congeladas exigiendo `>3` por carpeta antes de afirmar la ausencia.
- **El `CHECK` está aplicado y funciona en la base local**, no solo escrito: `23514` con el nombre de
  la restricción, las 17 combinaciones invertidas rechazadas una a una y las 17 legítimas aceptadas
  como contraprueba, todo en transacciones revertidas.
- **`derivarBalance` intacto**: `tests/unit/utils/wallet-balance.test.ts` no aparece en el diff, y
  `caja-derivaciones.guardia.test.ts` afirma además que `derivarCaja` lo **reusa** tres veces en vez
  de duplicar la resta con signo.
- **Cero código muerto** tras retirar `agregarBalance`, `BalanceAgregado`, `verBalance` y el puente
  `verBalanceAction`: el barrido sobre `lib/`, `app/`, `tests/` y `scripts/` solo devuelve comentarios
  que explican la retirada.

---

## Qué hace falta para que esto sea `APROBADO`

1. **Cerrar el BLOQUEANTE 1**: añadir el caso que verifica la descripción de `egresos` (y, ya
   puestos, la «descripción propia» de las dos métricas nuevas), y corregir la fila R53 de
   `tasks.md:488` para que cite ese caso. Vuelve al implementer. **No toca `lib/`.**
2. Marcar `T H.5` en `tasks.md:411`.
3. Añadir la entrada a `progress/history.md`.
4. Reejecutar `./init.sh` completo y confirmar que el único rojo sigue siendo el flake de
   `CuentasPorPagarTable`, o que ni ese aparece.
5. **Condición de merge, no de review**: `T H.4` (`--simular` → revisión humana → `--aplicar` →
   `--comprobar`) en cada entorno tras el despliegue, con las cifras leídas de la base. Preview sigue
   sin ser alcanzable por MCP: riesgo residual **declarado y ya aceptado por el humano en la 172**,
   no asumido aquí.
