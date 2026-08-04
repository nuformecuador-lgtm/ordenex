# Review — feature 183 · el `neto` de las cuatro métricas de caja

> **Rama:** `feature/183-neto-bruto-caja` · **Diff revisado:** `64957dca..HEAD` (12 commits)
> **Fecha:** 2026-08-04 · **Rol:** reviewer (no edita código)
> **Leído antes de revisar:** `specs/183-analitica-neto-bruto-caja/{requirements,design,tasks}.md`,
> `progress/decision_183.md`, `progress/impl_183.md`, `progress/impl_183_backend.md`,
> `progress/impl_183_frontend.md`, `CLAUDE.md`, `AGENTS.md`, `docs/verification.md`,
> `docs/architecture.md`, `docs/conventions.md`, `CHECKPOINTS.md`.

## Veredicto

**RECHAZADO** — 2 bloqueantes, 7 menores.

Los dos bloqueantes son **de rastro documental, no de código**: el código, los tests y las
mediciones son sólidos y no hace falta tocar `lib/`, `app/` ni `tests/`. Con las dos correcciones
(una nota fechada en `specs/127-*` y las casillas de `tasks.md`) esto pasa a **APROBADO** sin más
verificación que releer esos dos archivos.

---

## 1. Verificación ejecutable — corrida por mí, no leída de la bitácora

| Qué corrí | Resultado |
|---|---|
| `pnpm run typecheck` | **0 errores.** Confirma R2 por la vía dura: los cuatro `@ts-expect-error` de `financiera-contratos.test.ts` están EN USO, o sea que leer/escribir `neto` en un `ImporteSoloBruto` de verdad no compila. Si el campo fuera opcional, `tsc` caería con TS2578 |
| `pnpm exec eslint` sobre los 9 archivos de producción y fixtures tocados | EXIT=0 |
| `pnpm exec vitest run guard` | **59 archivos · 812 casos, todos verdes** |
| `pnpm exec vitest run` sobre los 13 archivos unitarios/componente tocados | **252 casos verdes** |
| `pnpm exec vitest run tests/integration/actions/analitica-financiera-action.test.ts --reporter=verbose` | **15 casos verdes, CONTRA POSTGRES.** No se saltaron: el `describe.skipIf(!HAY_BASE_DE_DATOS)` se ejecutó de verdad y `F.4(b)`, `F.4(b bis)` y `F.4(c)` aparecen nombrados en la salida |
| `git diff --name-only 64957dca..HEAD -- db/ prisma/` | **vacío** (R16) |

`./init.sh` completo lo corre el leader (indicado explícitamente en el encargo); no lo lancé.

---

## 2. Trazabilidad R1–R27 — archivo a archivo, abriendo cada caso citado

**Método:** abrí cada archivo y cada caso citado en `progress/impl_183.md`. **No** se usó como
evidencia el conteo de `R\d+` en títulos (R27 lo prohíbe; produjo un falso 68/68 en la 173).

### 2.1 Resultado del cruce

**Los 25 casos citados EXISTEN. Ninguna fila del mapa apunta a un archivo inexistente ni a un caso
que no mide lo que se le atribuye.** Es la diferencia con el review de la 173, donde cuatro filas
eran falsas y dos citaban archivos que nunca existieron. Comprobé uno a uno, incluidos los que el
mapa cita de refilón:

- `tests/unit/utils/caja-tesoreria.test.ts:61` y `:81` (R13) — existen y dicen lo que se cita.
- `tests/unit/analytics/financiera-produccion.guardia.test.ts:77` (R15) — existe.
- `tests/unit/services/analitica-financiera-service.test.ts:124`, `:132`, `:286`, `:522` — existen.
- `tests/unit/analytics/financiera-alcance.guardia.test.ts:35` — cubre el `alcance` de las diez
  financieras, incluida `egresos`; el mapa no lo cita, pero R10 queda cubierto igual.

### 2.2 Requisito a requisito

| R | Veredicto | Nota del revisor |
|---|---|---|
| **R1** | OK | `analitica-financiera-derivacion.test.ts`, bucle sobre las tres: `Object.keys` del total serializado = `["forma","bruto","moneda"]` **y** `JSON.stringify(datos)` sin `"neto"`. Mide sobre el objeto serializado, no por tipos |
| **R2** | OK | Dos `@ts-expect-error` (lectura y escritura) más un tercero sobre la unión sin estrechar. **Verificado por mí**: `typecheck` en 0 con las directivas presentes implica que están en uso |
| **R3** | OK con matiz | Ver menor **M4**: la no-regresión numérica contra Postgres solo existe para `ingreso_flete` (F.1 = 1500.00) |
| **R4** | OK | `metrics-caja-naturaleza.guardia.test.ts:72-86` compara las tres listas LITERALMENTE (2/1/3). El diff de `metrics.ts` no toca esas entradas |
| **R5** | OK, bien resuelto | El nivel repositorio existe de verdad: `financiera-ingresos-repo.test.ts` afirma sobre `fake.llamadas[0].args.where.categoria.in` = las nueve EN ORDEN, más `toHaveLength(9)` y lo que NO lleva. Es «probar el WHERE donde vive» aplicado |
| **R6** | OK | `analitica-financiera-service.test.ts:286` vía `conNeto()`, que AFIRMA la forma en vez de hacer un `as`; más la guardia de forma |
| **R7** | OK | Par real `egreso_gasto`/`egreso` + `ingreso_ajuste`/`ingreso` da `neto "0.00"` / `bruto "800.00"`, unitario Y en `F.4(b)` contra Postgres, con las dos filas comprobadas en el libro |
| **R8** | OK | Espía sobre `derivarBalance` con argumentos (`[["1000","1500"]]`), más el caso de que a las tres de Q1 NO se la llama y a `egresos` SÍ. Signo negativo afirmado |
| **R9** | OK, contra Postgres, verificado por mí | `F.4(c)` siembra el censo real (4 × `egreso_pago_mensajero` + 1 × `egreso_indemnizacion`), lo comprueba con `groupBy` antes de medir y afirma `22042.40` / `-22042.40` en transacción revertida. Lo vi correr con `--reporter=verbose`: NO es un `skipIf` silencioso |
| **R10** | OK | `id`, `etiqueta`, `granos`, `fuente` y `estadoProduccion` uno a uno; el `alcance` lo cubre `financiera-alcance.guardia.test.ts:35` |
| **R11** | OK, el punto más fino del PR | `DESCRIPCION_EGRESOS_PRE_183` como fixture literal, predicado de cuatro piezas y el caso que demuestra que el texto viejo NO lo pasa y SÍ pasa todos los demás guardias de descripción. Es la corrección de R53/173 aplicada de verdad |
| **R12** | PARCIAL | Ver menor **M1** |
| **R13** | OK | `NATURALEZA_POR_CATEGORIA` sin tocar; afirmado desde dos archivos |
| **R14** | OK | `financiera-forma-importe.guardia.test.ts` con mapa ESCRITO A MANO de las diez (no derivado del despacho que juzga) y contrastado contra `IDS_FINANCIERAS_SERVIDAS` Y contra el catálogo |
| **R15** | OK | 25 métricas (`metrics.test.ts:54`) y 10 financieras, por exceso y por defecto |
| **R16** | OK sin test propio, y es correcto | Ver §3 |
| **R17** | OK, y aquí hubo trabajo real | El caso nuevo sobre `egresos` nació de una mutación que SOBREVIVIÓ (M23): el guardia previo solo alteraba `ingreso_flete`, que no es la definición que esta feature cambia. Que el implementer lo encontrara y lo escribiera es lo contrario del defecto que se buscaba |
| **R18** | OK | Recorre las diez y compara la forma del total con la de cada fila, CON sanidad de que el fixture trae filas (`filasVistas > 3`), más autocomprobación del detector |
| **R19** | OK | 3 métricas × 3 aserciones (etiqueta «Bruto» presente / «Neto» y línea secundaria ausentes / marcador de ausente ausente) más el caso de la tabla, donde EL MARCADOR SE AFIRMA ANTES QUE LA CABECERA (commit `dcd2a40c`, corregido tras ver que moría por la aserción equivocada) |
| **R20** | OK | Contrapesos explícitos: `egresos` conserva el neto y su signo, y `cuenta_por_pagar_tienda` conserva sus dos columnas. Sin ellos, «unificar todo en solo bruto» pasaría verde |
| **R21** | OK | 5 entradas frente a 10 en la alternativa textual de la gráfica, SOBRE LA MISMA VISTA en sus dos formas; más el contrapeso de que con neto siguen siendo dos series |
| **R22** | OK cubierto, pero NO por donde el spec decía | Ver menor **M2** — confirmado por mí, §4 |
| **R23** | OK | Las cuatro mentiras (`null`, `0`, cadena vacía, `?? bruto`) comprobadas una a una sobre el mismo objeto, con `"neto" in valores === false` |
| **R24** | OK | Los dos dobles imposibles reexpresados Y la premisa medida contra Postgres: `F.4(b bis)` demuestra que la fila vieja es 23514 en la base |
| **R25** | OK, verificado en el diff | Ver §3 |
| **R26** | **INCOMPLETO** | Ver bloqueante **B1** |
| **R27** | OK | El mapa existe, está construido leyendo, y no contiene ninguna fila falsa |

---

## 3. Los dos requisitos sin test propio (R16 y R25): juicio

**R16 — aceptable sin caso.** Pide que NO exista migración, cambio de esquema, RLS ni escritura de
datos. Un «test» de eso sería una guardia sobre el diff, que este repo no tiene y que no pertenece
a esta feature. La evidencia correcta es la que se dio y LA VERIFIQUÉ YO:
`git diff --name-only 64957dca..HEAD -- db/ prisma/` vacío. Además el cambio es de definición y de
contrato, y el censo de migraciones sigue verde por no haber migración nueva que censar. **No
necesita caso.**

**R25 — aceptable sin caso propio, y con evidencia dura.** R25 es un requisito SOBRE LA SUITE
(«dar vuelta, no borrar»), no sobre el sistema. Lo comprobé en el diff de dos maneras
independientes:

1. **Ningún archivo de test perdió casos.** Conteo antes → después: contratos 25→28, repo 15→16,
   naturaleza 19→21, producción 5→5, derivación 11→14, servicio 29→29, integración 13→15,
   TableroFinanciero 19→29, adaptar 20→30. **Ninguno baja.**
2. **Los 7 `it(` que el diff elimina son renombrados, no borrados**, y localicé el sustituto de
   cada uno (ocho→nueve, «NO entra»→«SÍ entra», «el contrato exige los dos campos»→
   «`ImporteConNeto` exige los dos campos», «⟨D1⟩ el par pago + contraasiento»→«R7/183 el par
   REAL», etc.). El comentario de la integración que afirmaba «el neto 0 no es alcanzable con
   datos legales» se CONSERVA CITADO entre comillas y se explica por qué su premisa dejó de valer
   para `egresos` y SIGUE valiendo para las tres de Q1.
3. `expect` eliminados: 37. `expect` añadidos: 150.

**No desapareció cobertura por la vía de borrar el caso.**

---

## 4. R22: el límite declarado por el implementer — CONFIRMADO

El implementer declara que la mutación que el spec le asigna a R22 —un `if (metricaId === ...)` en
el tablero— NO la caza `tests/unit/guards/tablero-financiero.guardia.test.ts`. **Lo comprobé en el
detector y es cierto**, y además está escrito en la propia autocomprobación del guardia:

- `tablero-financiero.guardia.test.ts:195-204` — `listasDeIdsAMano` solo marca un array literal
  cuando contiene DOS O MÁS ids servidos (`presentes.length >= 2`).
- `tablero-financiero.guardia.test.ts:448` — la autocomprobación lo dice con todas las letras:
  una comparación suelta con un id devuelve lista vacía, o sea que NO se marca.

**Luego el spec afirmaba una cobertura inexistente.** Lo que sí lo cubre BASTA, y lo verifiqué
razonando sobre las fixtures: las dos versiones de la vista comparten id de métrica, id de vista,
grano y brutos, y solo se diferencian en `forma`. Cualquier implementación que decidiera por id
—lista o no— daría la misma pantalla para las dos, y seis casos de comportamiento se ponen rojos
(medido por el implementer en M5, con el guardia VERDE). El único mutante que sobrevive es un `if`
por id REDUNDANTE que produce exactamente la misma salida: un mutante equivalente en
comportamiento, imposible de matar sin ensanchar un guardia de una feature `done`.

**Juicio: cobertura suficiente. El defecto es del spec, no de la implementación, y el implementer
lo midió y lo escribió en vez de darlo por bueno** (`progress/impl_183_frontend.md §6`). Queda como
menor **M2**.

---

## 5. ⟨D12⟩ y los requisitos vivos de features `done`

- OK — **`progress/decision_183.md` existe**, fechado 2026-08-04, estado CERRADA, y es la
  autorización que `lib/analytics/metrics.ts:5-7` exige POR FEATURE.
- OK — **El catálogo la cita**: el bloque de `egresos` en `lib/analytics/metrics.ts` cita
  `progress/decision_183.md` y escribe 2026-08-04, con el motivo y la medición de producción.
- OK — **Verde por construcción, no por exención**: comprobé que `2026-08-04` NO aparece ni en
  `progress/decision_C2_127.md` (solo 2026-08-02) ni en `progress/decision_F2_173.md` (solo
  2026-08-03). Luego la fecha del bloque solo puede respaldarla el documento nuevo. Y
  `decision_183.md` no contiene ninguna línea con `declarada` y `producida` a la vez, así que no
  añade obligación nueva a la guardia.
- OK — **Notas puestas, fechadas, citando ⟨D12⟩ y sin reescribir el texto original**: las tres son
  bloques de cita DEBAJO del requisito, con fecha 2026-08-04 y la referencia al documento. El texto
  original queda intacto palabra por palabra. Precedente correcto (T22 de la 160 sobre la 148).
  - `specs/127-analitica-financiera-servicios/requirements.md:261-266` → **R18** (ocho a nueve).
  - `specs/127-analitica-financiera-servicios/requirements.md:383-390` → **R37** (acotado).
  - `specs/132-analitica-tablero-financiero/requirements.md:140-149` → **R16** (reinterpretado), y
    añade lo que R26 no pedía pero conviene: que el marcador de ausente NO puede ocupar el hueco.
- **FALLA** — **Se quedó una feature con un requisito que el código ya no cumple.** Ver **B1**.

---

## 6. Checklist de `CHECKPOINTS.md`, punto por punto

### Especificación
- [x] `specs/183-analitica-neto-bruto-caja/requirements.md` con EARS numerados `R1`–`R27`.
- [x] `design.md` con alternativas descartadas y su porqué (§3.3: cuatro descartadas —campo
      opcional, lista de ids, dejar `±bruto` documentado, y `"neto" in importe`—).
- [ ] **`tasks.md` con todas las tasks marcadas `[x]`** → **FALLA. Ver B2.**

### Trazabilidad
- [x] Cada `R<n>` mapea a al menos un test concreto QUE LO VERIFICA (R16 y R25 por evidencia de
      diff, justificado en §3).
- [x] `progress/impl_183.md` contiene el mapa `R<n> -> test`, con 27 filas.

### Calidad de código
- [x] `pnpm run typecheck` — 0 errores (corrido por mí).
- [x] `pnpm run lint` — EXIT=0 sobre los archivos tocados (corrido por mí).
- [x] `pnpm test` — los 13 archivos unitarios/componente (252 casos), las 59 guardias (812) y la
      integración contra Postgres (15) en verde, corridos por mí. El gate completo lo corre el leader.
- [~] E2E: **no aplica**. Este repo no tiene harness de Playwright ejecutable y los specs
      existentes lo declaran «NOT EXECUTED». Además la feature no cambia un flujo (no toca auth,
      pagos, recaudo, ingesta ni webhooks): cambia la DEFINICIÓN de una métrica de lectura. El
      riesgo lo cubre lo que sí existe y sí corre: 15 casos de integración contra Postgres, dos de
      ellos sobre la aritmética exacta de `egresos`.

### Datos y seguridad (Supabase)
- [x] Ninguna tabla nueva, luego nada que poner bajo RLS. Cero cambios en `db/` y `prisma/`.
- [x] Ninguna migración nueva, luego ningún `down.sql` que exigir.
- [x] Ningún secreto hardcodeado. Nada nuevo lee `process.env`.
- [x] Ningún webhook nuevo.

### Patrón de capas
- [x] El componente no consulta la base: recibe `paneles` por props ya resueltos.
- [x] `AnaliticaFinancieraService` no conoce HTTP; sigue sin escribir una resta de dinero
      (`derivarBalance` es quien resta, y el espía lo demuestra).
- [x] `IngresosAnaliticaRepository` NO cambió de código, solo de prosa; la lista de categorías
      sigue viniendo del catálogo (R17, con caso nuevo sobre `egresos`).
- [x] La interfaz sigue en `lib/interfaces/repositories/`.

### Permisos
- [x] Sin cambios. El gate server-side y `financiera-alcance.guardia` siguen verdes (total para
      maestro/admin, prohibido para el resto, en las diez).

### Multi-país / configuración
- [x] La `moneda` sigue saliendo de `lib/config/moneda.ts`. Partir `importe()` en dos NO abrió una
      vía nueva: `importeConNeto` e `importeSoloBruto` son los únicos dos sitios que la escriben, y
      el censo de literales de moneda sigue verde.

### Verificación final
- [ ] `./init.sh` completo — lo corre el leader (fuera de mi encargo por instrucción).
- [x] `progress/review_183.md` existe (este documento).
- [ ] Entrada en `progress/history.md` — pendiente (menor **M5**; es paso de cierre del leader).

---

## 7. Hallazgos

### BLOQUEANTES

#### B1 — R16 de la 127 quedó contradicho por el código y SIN nota: R26 está incompleto

**Archivo:** `specs/127-analitica-financiera-servicios/requirements.md:243-246`

El texto vigente, sin ninguna nota al margen, dice:

> **R16.** *(cerrado por D1 y D2)* CUANDO se consulte `ingreso_flete`, `ingreso_comision_cod` o
> `ingreso_iva`, el sistema DEBE devolver la Σ de `wallet_movimiento.monto` de **exactamente** las
> categorías que la métrica declara en `definicion.categorias`, con `fecha_movimiento` dentro de
> `[rango.desde, rango.hasta)`, **en sus dos campos `bruto` y `neto`**.

**Es el requisito más directamente derogado por esta feature de todo el repo**: nombra a las tres
métricas de Q1 UNA POR UNA y exige los dos campos. Desde este PR las tres publican
`ImporteSoloBruto` y leer su `neto` no compila.

Y no es un descuido del implementer: **el spec de la 183 nunca lo mira.** Lo comprobé: «R16 de la
127» no aparece en `requirements.md`, ni en la tabla de requisitos vivos de `design.md:294-295`
(que solo tabula R18 y R37 de la 127 y R14 y R16 de la 132), ni en `decision_183.md`, ni en las
bitácoras. La tabla de R26 está INCOMPLETA, y la frase normativa de R26 —«rastro fechado de la
acotación de LOS REQUISITOS VIVOS QUE ESTA FEATURE CAMBIA»— sí lo cubre.

Es literalmente el resultado que la Mutación de R26 describe: «quien lea la 127 encuentra un
requisito que el código ya no cumple y no sabe por qué».

**Qué falta para cumplirlo:** una cuarta nota fechada (2026-08-04) al margen de R16 en
`specs/127-analitica-financiera-servicios/requirements.md`, citando ⟨D12⟩ y la feature 183, con la
misma forma que las tres ya puestas y SIN reescribir el texto original: la Σ y la ventana
`[desde, hasta)` siguen intactas; lo que se acota es el «en sus dos campos `bruto` y `neto`», que
pasa a ser solo `bruto` para esas tres. Conviene revisar en la misma pasada el bloque ⟨D1⟩
(`specs/127-analitica-financiera-servicios/requirements.md:23`, «Se sirven `bruto` y `neto` en el
mismo DTO»), que es la fuente de la que R16 y R37 cuelgan.

Nota lateral, no bloqueante, para el mismo momento: `specs/173-caja-tesoreria/requirements.md:38`
sigue diciendo que `egresos` declara «las OCHO categorías `egreso_*`». Está en la tabla de hechos
verificados, que es una foto histórica y no un requisito, así que no exijo nota; pero está a un
renglón de distancia si se quiere dejar limpio.

#### B2 — tasks.md con las 19 tasks SIN MARCAR

**Archivo:** `specs/183-analitica-neto-bruto-caja/tasks.md`, líneas 13, 25, 35, 47, 58, 70, 81, 91,
102, 111, 124, 134, 143, 151, 159, 174, 182, 189 y 195.

`CHECKPOINTS.md:9` es explícito: «Existe `specs/<feature>/tasks.md` y todas las tasks estan
marcadas `[x]`». En `HEAD` TODAS siguen en `- [ ]`, T0 incluida, pese a que T0 a T14 están hechas y
demostradas en las bitácoras y T15/T16 están hechas y las verifiqué en el diff.

Es clerical, pero es un checkpoint escrito y no lo puedo dar por bueno: el estado en disco es la
fuente de verdad de este arnés (`CLAUDE.md`, regla 3), y hoy dice que no se hizo nada.

**Qué falta para cumplirlo:** marcar `[x]` T0 a T16. **T17** (`./init.sh` completo y PR) y **T18**
(medición post-merge por MCP) quedan legítimamente abiertas: la primera es del leader y la segunda
depende del merge. Si se marcan, que sea con su nota de estado, no en falso.

### MENORES

#### M1 — R12: la guardia solo mata la mutación SI la fecha huérfana se queda

**Archivos:** `tests/unit/analytics/catalogo-produccion.guardia.test.ts:376-455` ·
`progress/impl_183.md:43`

La fila del mapa dice «el bloque de `egresos` cita `progress/decision_183.md` con su fecha», y eso
suena a que la guardia lo EXIGE. No lo exige: `cambiosDecididosEnProgress()` deriva sujetos de los
`decision_*.md` que nombran `declarada` y `producida` en la misma línea, y `decision_183.md` no lo
hace (correctamente: no cambia `estadoProduccion`). Lo que la guardia comprueba es que toda fecha
escrita en el bloque esté respaldada por alguna decisión que el bloque cite.

Consecuencia, sobre el mecanismo:

- borrar la cita DEJANDO el 2026-08-04 da rojo (M16 del implementer: cierto, y la fecha no está en
  ninguna de las otras dos decisiones citadas);
- borrar la cita Y la fecha, o sea cambiar `definicion.categorias` sin documentar nada, da VERDE. Y
  ésa es la primera mitad de la mutación que R12 nombra.

No es grave: el requisito SE CUMPLE en el código, y la mitad de «citar una fecha que el documento
no lleva» sí está viva (M17). Pero la fila del mapa atribuye más cobertura de la que hay. Basta con
matizarla.

#### M2 — R22: el spec asignaba una mutación que su guardia no caza

**Archivos:** `specs/183-analitica-neto-bruto-caja/requirements.md:196-200` ·
`tests/unit/guards/tablero-financiero.guardia.test.ts:202` y `:448`

Detallado en §4. **El defecto es del spec, no de la implementación**, y el implementer lo midió, lo
escribió y no lo disfrazó (`impl_183_frontend.md §6`, `impl_183.md` bajo «Límite conocido»). La
cobertura real, seis casos de comportamiento sobre la misma vista en sus dos formas, basta. Se deja
como deuda identificada: ensanchar `listasDeIdsAMano` para marcar también la comparación suelta es
trabajo de otra ficha, porque el guardia es de una feature `done`.

#### M3 — tasks.md T15 pide cuatro notas; R26 pide tres

**Archivos:** `specs/183-analitica-neto-bruto-caja/tasks.md:174-180` frente a
`specs/183-analitica-neto-bruto-caja/requirements.md:231-236`

T15 dice «nota fechada al margen de R18 y R37 en specs/127 y de R14 y R16 en specs/132», y su
«Hecho» dice «las CUATRO notas existen». Pero la tabla de R26 declara R14 de la 132 INTACTO («sigue
valiendo palabra por palabra»), así que anotarlo sería anotar un no-cambio. Se entregaron tres
notas, que es lo correcto según R26. **Discrepancia tasks contra requirements, no defecto de
entrega.** Se resuelve al cerrar B2, marcando T15 con la nota de que R14 no necesitaba nota.

#### M4 — R3: la no-regresión numérica contra Postgres solo cubre `ingreso_flete`

**Archivos:** `tests/integration/actions/analitica-financiera-action.test.ts:335-341` ·
`tests/unit/services/analitica-financiera-derivacion.test.ts` (bloque R1)

R3 exige que el `bruto` de LAS TRES valga exactamente lo mismo que antes. Contra la base solo se
mide `ingreso_flete` (F.1 = 1500.00). Los casos unitarios de las otras dos afirman el bruto
1005.00 con un doble que NO FILTRA POR CATEGORÍA: devuelve las mismas filas (`ingreso_flete` y
`ingreso_flete_devolucion`) pidas la métrica que pidas, así que ese 1005.00 no demuestra «la Σ de
SUS categorías declaradas».

No lo subo a bloqueante porque la cobertura compuesta cierra el hueco: R4 fija las tres listas
literalmente, R17 demuestra que la lista sale del catálogo y no del repositorio, y las tres
comparten exactamente la misma rama de `deCaja` con forma `solo_bruto`. Pero conviene saber que la
afirmación «el bruto no se movió» está MEDIDA para una de las tres y ARGUMENTADA para las otras dos.

#### M5 — Sin entrada en `progress/history.md`

`CHECKPOINTS.md:46`. No hay entrada para la 183. Es paso de cierre del leader, posterior a este
review; se anota para que no se pierda.

#### M6 — `./init.sh` completo no consta corrido en ninguna bitácora

Las tres bitácoras lo declaran explícitamente como «lo corre el leader», y el encargo de este
review dice lo mismo. Correcto como reparto, pero el criterio de aceptación 1 del spec y
`docs/verification.md` siguen sin evidencia escrita. Que el leader pegue la salida en
`progress/impl_183.md` antes del PR, como exige T17.

#### M7 — El párrafo del PR (criterio de aceptación 3) aún no consta

`specs/183-analitica-neto-bruto-caja/requirements.md:262-263` exige que §2 y §4 de
`progress/decision_183.md` viajen al cuerpo del PR (precedente ⟨D10⟩). No hay PR abierto todavía;
se anota para que T17 no lo pierda.

---

## 8. Lo que quiero dejar dicho a favor de este PR

Buscaba el cuarto caso de «test verde que no mide lo que dice» DENTRO del mapa de trazabilidad y NO
ESTÁ: los 25 casos citados existen y miden lo que se les atribuye. Lo que encontré está en otro
sitio, el rastro documental (B1), y eso es un cambio de patrón respecto de las últimas cinco
features.

Tres cosas concretas que este PR hizo bien y que conviene que no se pierdan como precedente:

1. **La mutación M23 sobrevivió y el implementer lo dijo.** Clavar las nueve categorías a mano en
   el repositorio dejaba 15 casos verdes porque el único guardia de «el catálogo manda» alteraba
   `ingreso_flete`, NO la métrica que la feature cambia. Rehacer el test en vez de declararlo
   cubierto es exactamente lo que faltó en la 173.
2. **El fixture `DESCRIPCION_EGRESOS_PRE_183`.** Borrar la cláusula nueva dejaba 63 casos verdes y
   ni un rojo. Sin ese fixture literal, R11 habría sido un requisito con test y sin red.
3. **El límite de R22 medido y escrito**, no supuesto, con la línea del guardia que lo demuestra. Y
   el reordenado de un caso (`dcd2a40c`) porque moría por la aserción equivocada: el rojo enseñaba
   la cabecera cuando lo que R19 enuncia son las seis celdas con el marcador de ausente.

Los helpers `conNeto()` y `soloBruto()`, que AFIRMAN la forma en vez de hacer un `as`, merecen
sobrevivir a esta feature: convierten en rojo con nombre lo que un `as` habría dejado pasar.

---

## 9. Qué falta, en una lista

1. **B1** — nota fechada al margen de R16 en
   `specs/127-analitica-financiera-servicios/requirements.md:243-246`, citando ⟨D12⟩ y la 183, sin
   tocar el texto original.
2. **B2** — marcar `[x]` T0 a T16 en `specs/183-analitica-neto-bruto-caja/tasks.md`.

Nada de esto toca `lib/`, `app/` ni `tests/`. Vuelve al implementer, o al leader si prefiere
cerrarlo él: es rastro documental, no código.
