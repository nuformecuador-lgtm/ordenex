# Feature 186 — analítica financiera: gráfica de líneas en el tablero · REVISIÓN

> Rama `feature/186-tablero-financiero-grafica-lineas`. Revisado el 2026-08-06 contra
> `specs/186-analitica-financiera-grafica-lineas/{requirements,design,tasks}.md`,
> `progress/{impl_186,decision_186}.md`, `docs/{architecture,conventions,verification}.md` y
> `CHECKPOINTS.md`.
>
> **Todo lo que se afirma aquí se midió en esta rama.** Cada mutación se sembró en el archivo
> real, se ejecutó con `pnpm exec vitest run` y el archivo se restauró byte a byte (verificado
> por `sha256` en cada caso; `git status` al cierre solo muestra `feature_list.json`, que ya
> estaba modificado antes de empezar). **No se editó una sola línea de código de producción ni
> de test como parte de esta revisión.**

---

## VEREDICTO: **RECHAZADO**

**2 bloqueantes · 6 menores.** El trabajo es, en lo esencial, sólido: 17 de los 18 requisitos
tienen un caso que se pone rojo cuando el requisito se viola, y lo comprobé ejecutando la
mutación de cada uno. El rechazo es por **un requisito cuyo caso citado no ejercita la rama que
dice proteger** —el gemelo exacto del agujero que el propio implementer encontró y arregló para
R4— y por **una task de verificación del spec que no se hizo**.

---

# BLOQUEANTES

## B1. R2 no tiene ningún caso que ejercite la decisión que dice proteger

**El requisito.** R2: «MIENTRAS una vista declare `granularidad: "no_temporal"`, el sistema NO
DEBE renderizar para ella ninguna gráfica de líneas: **ni con datos, ni vacía, ni con encabezado
que la anuncie**».

**Dónde se decide en el código.**
`app/(app)/analitica/_components/financiero/TableroFinanciero.tsx:436-438` — la condición
`esVistaTemporal(vista) && !esAcumulado` que envuelve a `<PanelLineas />`.

**La mutación, y su resultado.** Quitar el guardia temporal de la línea —dejarla en
`!esAcumulado`, que es **el gemelo exacto de M-10**, la mutación que el implementer descubrió
viva para el motivo—:

    tests/components/TableroFinanciero.test.tsx + tests/components/AnaliticaPage.test.tsx
      ->  Test Files 2 passed (2) · Tests 144 passed (144) · CERO rojos

**La mutación SOBREVIVE a la suite entera de componente.** El caso citado para R2 en el mapa
—«las vistas no_temporal no traen ninguna grafica de lineas, ni vacia»,
`tests/components/TableroFinanciero.test.tsx:1338`— afirma sobre las tres vistas `no_temporal`
de `panelesOk()`: las dos de `cod_recaudado` (que salen por las ramas del donut y de las barras,
antes de llegar a la del KPI) y `cuenta_por_pagar_tienda` (que trae filas y sale por
`PanelTabla`). **Ninguna de las tres entra jamás en la rama donde vive la condición de la
línea**, así que el caso mide que las otras tres ramas no pintan líneas —cosa cierta por
construcción— y no mide R2.

**Prueba de que el guardia es carga y no adorno, y de que el caso que falta es escribible.**
Escribí un caso temporal (borrado ya; `git status` limpio) con una vista `granularidad:
"no_temporal"`, `esAcumulado: false` y `filas: []` —la combinación que **sí** entra en la rama
del KPI por la segunda condición del hotfix— afirmando que su sección no gana la región
«… · Evolución en el tiempo»:

- contra el código **actual**: `1 passed` (el guardia funciona);
- contra el código **mutado**: `1 failed` — `expected <section …> to be null`.

Es decir: la sección gana una región que **anuncia una gráfica de evolución** para una vista que
no está medida en el tiempo. Exactamente lo que R2 prohíbe en su tercer inciso.

**Honestidad sobre el alcance:** con los DTOs de HOY el defecto **no es alcanzable en
producción** (las dos vistas `no_temporal` de métrica de flujo son las de `cod_recaudado`, y esas
salen por sus ramas propias). Esto **no es un fallo vivo**: es un requisito sin red. Pero es la
misma clase que ⟨H1⟩ —una condición que nadie ejercita, esperando a la métrica que la alcance— y
la regla del repo es explícita (`docs/verification.md`, «Regla del reviewer»): un test que no
verifica el requisito que dice cubrir es hallazgo bloqueante.

**Qué falta para cumplirlo (no lo escribo yo):** un doble `no_temporal` + `esAcumulado: false` +
`filas: []` —hermano de `panelAcumuladoNoTemporalSinFilas`, que ya existe para R4— y una
aserción de que esa sección no tiene línea. Con eso, la mutación de arriba muere. Y conviene
decir en el propio test, como se hizo con el de R5, **por qué** ese DTO no lo produce el
servicio hoy.

## B2. T F.3 (`pnpm exec next build`) no se hizo, y es la única cobertura de la frontera RSC

`requirements.md` §4 y `design.md` §9 lo piden por escrito («con la salida pegada en
`progress/impl_186.md`»), `tasks.md:154` lo deja sin marcar y `progress/impl_186.md` §10 lo
declara abiertamente como «lo que NO corrió el implementer». Con **Q5 = no E2E**, ese build es
—según el propio diseño— «la otra mitad» de la única cobertura de la frontera RSC de una feature
que monta un Client Component nuevo (`GraficaLineas`) desde un Server Component.

**Lo corrí yo, y pasa.** `pnpm exec next build` (nunca `pnpm build`):

    ✓ Compiled successfully in 12.1s
      Running TypeScript ... Finished TypeScript in 24.4s
    ✓ Generating static pages (42/42)
    ├ ƒ /analitica
    EXIT=0

Así que **el riesgo técnico está cerrado**; lo que falta es el entregable: correrlo, pegar la
salida en la bitácora y marcar T F.3. Se queda como bloqueante porque `CHECKPOINTS.md` exige
todas las tasks en `[x]` y porque una bitácora que no lleva su propia evidencia no vale como
evidencia. Es lo más barato de cerrar de toda la lista.

---

# MENORES

## m1. La desviación §5.1 (el caso del bloque `Hotfix` que se debilitó) es CORRECTA, pero el criterio del spec quedó literalmente incumplido

`design.md` ⟨D1⟩ y `requirements.md` §4 ponen como criterio de hecho que «los seis casos del
bloque `Hotfix — …` sigan verdes **sin tocarlos**». Uno se tocó. **Lo medí y el juicio es que la
desviación se sostiene:**

- el movimiento de ⟨D1⟩ **sí** fue puro: el commit de T A.1 (`5d79c56f`) no toca
  `tests/components/TableroFinanciero.test.tsx`; el cambio entra en la Tanda C (`881717c6`);
- el diff retira **exactamente 3 líneas** de aserción en todo el archivo (las dos de §5.2 y el
  `not.toContain` del cubo intermedio), ni una más;
- **el defecto original del hotfix sigue muriendo**: volver la señal de forma a
  `vista.filas.length === 0` da **39 rojos**, entre ellos los 7 de «NO pinta las fechas de la
  serie» y los 7 de «NO pinta ninguna tabla» (este último, intacto);
- **la aserción conservada literal para la acumulada muerde**: M-8 (poner línea también en la
  acumulada) pone rojo «`cuenta_por_pagar_mensajero` NO pinta las fechas de la serie»;
- los otros dos anclajes del bloque («NO pinta ninguna tabla», «no pinta el total al pie») no se
  tocaron.

Lo menor es de proceso: **el criterio de `requirements.md` §4 sigue diciendo lo contrario de lo
que pasó**. El implementer hizo bien en no editar `specs/`; queda para el leader reconciliar esa
viñeta con la desviación §5.1, o el próximo que lea el spec creerá que los seis siguen intactos.

## m2. La partición por homonimia (§5.3) abre un hueco real en `adaptar.ts`, y la bitácora lo describe como si no lo abriera

Medido, con control:

- `export const PRESET_DEL_TABLERO = "semana";` escrito **en `adaptar.ts`** → 37 casos verdes,
  **cero rojos**. Antes de esta feature, ese literal en ese archivo ponía rojo el censo de
  R26/132.
- el **mismo literal** en `TableroFinanciero.tsx` → **2 rojos** (censo de rango + censo (g)).

La bitácora dice que las alternativas descartadas «dejarían entrar un preset de verdad»; la
opción elegida también lo deja entrar, **dentro de `adaptar.ts`**. El riesgo es estrecho y está
mitigado (la clave `rango:` sigue censada sin excepción, `adaptar.ts` no importa `rango.ts`, la
excepción tiene autocomprobación y un caso que se rompe si los dominios dejan de compartir esos
dos literales), pero §5.3 debería decirlo como lo que es: **una excepción con coste**, no un
intercambio sin pérdida. Cerrarlo costaría poco: exigir además que `adaptar.ts` no importe
`rango.ts` ni nombre `RANGO_PRESETS`.

## m3. El dominio de granularidad, en `tablero-financiero-rango.test.ts`, se escribe a mano

`const GRANULARIDADES: readonly GranularidadVista[] = ["dia", "semana", "no_temporal"];`
(`tests/unit/analytics/tablero-financiero-rango.test.ts:107`). No es el registro exhaustivo
`Record<GranularidadVista, true>` que el implementer usó —bien— en el guardia y en el test de
componente: aquí un cuarto valor **no** rompe la compilación. El modo de fallo es un falso
positivo ruidoso, no un silencio, así que es menor; pero la técnica correcta ya está escrita dos
archivos más allá.

## m4. T F.4 y T F.6 pendientes

`./init.sh` completo (T F.4) lo está corriendo el leader en paralelo; el cierre de ficha (T F.6)
es suyo por definición. No se los cargo al implementer: se anotan porque `CHECKPOINTS.md` los
exige antes de `done`.

## m5. La desviación §5.2 (caso R22 de la 132) es aceptable y algo más estrecha

`getByText(/2026-07-05/)` fallaba por ambigüedad legítima desde que la serie nombra esa clave. La
nueva forma —las dos fechas en un solo nodo, en el orden del DTO y sin dígitos en medio— es más
fuerte en adyacencia y no pierde nada de lo que el caso afirmaba. Sin objeción; se anota por
trazabilidad.

## m6. La dispensa de E2E se concede, con el riesgo escrito

Ver la sección de CHECKPOINTS, más abajo.

---

# Verificación ejecutable — lo que corrí yo

| Comando | Resultado |
|---|---|
| `pnpm typecheck` | **limpio** |
| `pnpm lint` | **0 errores**, 48 warnings; **ninguno** en `financiero/` ni en `adaptar.ts` |
| `pnpm exec vitest run` de los 5 archivos del perímetro | **185 casos, 0 rojos** (92 + 49 + 29 + 8 + 7 — coincide con la bitácora) |
| `pnpm run test:guardias` | **70 archivos, 958 casos, 0 rojos** — ningún guardia cruzado en rojo |
| `pnpm exec next build` (a mano) | **verde**, `EXIT=0`, `/analitica` presente |
| `./init.sh` completo | **no lo dupliqué**: lo está corriendo el leader (T F.4) |

---

# Trazabilidad: R1..R18, comprobado CASO A CASO contra el árbol

Primero, el mapa **no** se validó contando `R\d+` en títulos: se parseó la tabla de
`progress/impl_186.md`, se extrajo cada nombre de caso entrecomillado y se comprobó que **es un
título `it(` / `it.each(` real en el archivo que la fila dice**. Las 18 filas pasan; **cero**
filas apuntando a un caso que no está donde dice (que es lo que ocurrió en la 188).

Después, lo que de verdad importa: **para cada requisito, la mutación que lo viola y si murió.**

| Req | Mutación sembrada (en producción salvo donde se indique) | Resultado |
|---|---|---|
| R1 | `false &&` delante de la condición de la línea | **muere** — 14 rojos |
| **R2** | quitar `esVistaTemporal(vista) &&` de la línea | **SOBREVIVE — 144 verdes** → **B1** |
| R2 (otra forma) | añadir la línea también en la rama de `PanelTabla` | muere — 2 rojos |
| R3 | quitar `<MotivoSinSerie/>` | **muere** — 3 rojos |
| R3 | poner línea también en la acumulada (M-8) | **muere** — 2 rojos (uno es la aserción conservada del hotfix) |
| R4 | quitar `esVistaTemporal(vista) &&` del motivo (M-10) | **muere** — 1 rojo (el caso añadido; confirmo el hallazgo de la bitácora) |
| R5 | señal en POSITIVO (`=== "dia"` / `=== "semana"`) (M-6) | **muere** — 3 rojos (1 unitario + 2 de componente). **El hueco que el spec declaraba está cerrado** |
| R6 | decidir por `vista.grano === "fecha"` (M-7) | **muere** — 2 rojos |
| R6 | decidir por un **id suelto** de métrica en el tablero | **muere** — censo (f). El aviso de la ficha sobre `listasDeIdsAMano` (≥2 ids) es cierto pero no aplica: (f) caza el id suelto |
| R7 | `case "semana"` rotula con el texto diario (M-1) | **muere** — 3 rojos |
| R7 (sentido inverso) | `case "dia"` rotula con el texto semanal | **muere** — 4 rojos. La granularidad se lee **en los dos sentidos** |
| R8 | etiqueta con rango calculado (clave + 6 días) (M-2) | **muere** — 3 rojos |
| R9 | `default` devuelve la clave cruda (M-3) | **muere** — 2 rojos |
| R10 | `agruparCola` sobre la serie temporal (M-4) | **muere** — 13 rojos |
| R11 | `?? 0` en `aNumero` (M-5) | **muere** — 4 rojos. **Confirmada la reparación**: el caso ejercita las dos formas de ilegible |
| R12 | pasar `avisoRecorte` a `GraficaLineas` | **muere** — censo (b) |
| R13 | serie de ceros en vez del estado vacío | **muere** — 1 rojo |
| R14 | borrar `<PanelKpi/>` de la rama (M-11) | **muere** — 17 rojos |
| R15 | `toLocaleDateString("es-CR")` en `adaptar.ts` | **muere** — censo (c) |
| R16 | nombrar un valor de granularidad en `TableroFinanciero.tsx` (M-12) | **muere** — 2 rojos (censo (g) + censo de rango) |
| R17(a) | sacar una métrica de `IDS_FINANCIERAS_CON_DESGLOSE_POR_FECHA` | **muere** — 2 rojos (los dos casos del hotfix, conservados) |
| R17(b) | la fixture deja de declarar acumulada a `cuenta_por_pagar_tienda` | **muere** — 2 rojos |
| R17(c) | quitar la vista semanal de los dobles (M-13) | **muere** — 2 rojos |
| R17(d) | mezclar formas de importe dentro de una vista | **muere** — 2 rojos |
| R18 | citar un archivo de test inexistente / borrar una fila del mapa | **muere** — 2 rojos y 1 rojo |

**17/18 requisitos con red medida. El que falta es R2.**

## Las dos mutaciones que la bitácora declara «sobrevivieron a la primera versión»

Reproducidas las dos, contra el árbol de hoy:

- **M-5 (`?? 0` en `aNumero`)** → **4 rojos**, el primero «un importe ilegible es dato ausente y
  nunca cero». La reparación (ejercitar `""` **y** `"no-es-un-numero"`) es real: la rama de
  finitud está ejercitada.
- **M-10 (motivo en toda métrica acumulada)** → **1 rojo**, y es «una vista no_temporal de una
  metrica ACUMULADA que llega al KPI tampoco trae el motivo», el caso que la bitácora dice haber
  añadido. Sin él, la condición se borraba en verde.

Las dos declaraciones son ciertas. **Y es precisamente por eso que B1 pesa**: el implementer
escribió la lección —«un test que no ejercita la rama no la protege, aunque su nombre diga que
sí»— y dejó sin escribir el caso gemelo de la otra mitad de la misma línea de código.

---

# Lo que el spec pedía verificar explícitamente

**Q2 = (b) — `cuenta_por_pagar_mensajero` sin línea, con el motivo en pantalla.** Cumplido y por
la vía correcta: `SeccionVista` pasa `esAcumulado={datos.esAcumulado}` (del DTO,
`TableroFinanciero.tsx:475`) y `ContenidoDeVista` decide con esa bandera (`:436`, `:439`). **No
hay lista de ids ni id suelto**; comprobado además por mutación: una decisión por
`vista.id === "cuenta_por_pagar_mensajero"` pone rojo el censo (f). El texto de R3 nombra el
porqué —saldo acumulado, «solo podría subir o mantenerse»— y no repite el «saldo al corte» de la
132, que sigue byte a byte.

**R5 — la señal por la negativa.** La mutación en positivo **muere** (3 rojos), en los dos
niveles: unitario (`esVistaTemporal`) y de componente (la vista con granularidad futura no cae en
la tabla). El hueco que el spec declaraba —«hoy no la mata nadie»— está cerrado.

**La granularidad, leída en los dos sentidos.** Un cubo semanal no se rotula como día (M-1: 3
rojos) **y** un cubo diario no se rotula como semana (mutación inversa: 4 rojos). El caso de
punta a punta compara **la misma clave** en una vista diaria y en una semanal, y aísla la
categoría de la cifra: eso es lo que lo hace discriminante.

---

# CHECKPOINTS.md, punto por punto

| Punto | Estado |
|---|---|
| `requirements.md` con EARS numerados | OK — 18 requisitos, puerta humana cerrada |
| `design.md` con alternativa descartada y su porqué | OK — 11 alternativas, cada una con su motivo |
| `tasks.md` con **todas** las tasks `[x]` | **NO** — T F.3, T F.4 y T F.6 sin marcar (B2 y m4) |
| Cada `R<n>` mapea a al menos un test concreto | **PARCIAL** — 18/18 citados y verificados en el árbol, **17/18 con red medida** (B1) |
| `impl_<feature>.md` contiene el mapa `R<n> -> test` | OK — y con guardia propio que lo vigila |
| `typecheck` sin errores | OK (corrido por mí) |
| `lint` sin errores | OK — 0 errores; 48 warnings preexistentes y ajenos |
| `pnpm test` pasa | PENDIENTE — perímetro (185) y guardias (958) verdes por mí; la suite completa la corre el leader |
| E2E si toca flujo crítico | **DISPENSADO** — ver abajo |
| RLS en tablas nuevas | N/A — cero migraciones, cero tablas; la feature no lee la base |
| Migraciones reversibles / `down.sql` | N/A — el diff no toca `db/` ni `prisma/` |
| Ningún secreto hardcodeado | OK |
| Webhooks con firma e idempotencia | N/A |
| Capas (controller / service / repository) | OK — presentación pura: el diff de producción son **2 archivos**, ninguno en `lib/`, `db/` ni `components/private/analytics/` |
| Páginas protegidas validan en servidor | OK — el gate de `page.tsx` no se toca |
| `private/` recibe datos por props | OK — sin fetch; `PanelLineas` recibe props planas y **ninguna función** (R12, censo (b)) |
| No hardcodear país/moneda/cuenta | OK — censo (c) verde, y muere si se escribe un locale |
| `./init.sh` en verde | PENDIENTE — lo corre el leader |
| `review_<feature>.md` con veredicto OK | **NO** — este archivo: RECHAZADO |
| Entrada en `progress/history.md` | PENDIENTE — T F.6 |

## La dispensa de E2E, con su riesgo escrito

El arnés **existe** (`@playwright/test`, script `test:e2e`, 19 specs, incluido
`e2e/analitica-roles.spec.ts` de la 133) pero **`init.sh` no lo ejecuta en ninguno de sus dos
modos** —corre `test:rapido` o `test`— y las specs están declaradas «WRITTEN but NOT EXECUTED».
Decisión humana vigente del 2026-07-30: no se escriben E2E nuevos. Q5 de esta ficha = no.

**Qué habría cubierto un E2E aquí, dicho concreto:** que en un render real de Next —no en jsdom
con `LineasLienzo` doblado— el Client Component nuevo montado desde el Server Component (a) cruce
la frontera RSC sin fallar en render, (b) cargue su chunk diferido y (c) pinte el lienzo con las
categorías rotuladas. Los tests de componente **no** lo ven: doblan el lienzo a propósito, y el
guardia del paquete les prohíbe mirar nodos de recharts.

**Por qué queda cubierto igual, por tres vías independientes:**

1. **El build real, que corrí yo** (B2): `next build` compila y type-checkea el árbol RSC
   completo, incluido `/analitica`. Un `"use client"` mal puesto o una prop-función cruzando el
   borde revientan ahí.
2. **Los censos (a) y (b)** del guardia del tablero: la directiva de cliente y las prop-función
   —`avisoRecorte` incluida— se detectan estáticamente sobre la carpeta entera, que se
   **recorre** (un archivo nuevo entra solo). Medido: pasar `avisoRecorte` pone rojo el censo.
3. **El patrón ya está en producción**: `GraficaBarras`, `GraficaDonut` y `KpiCard` se montan
   desde **este mismo Server Component** desde la 132, y `GraficaLineas` es idéntica en forma
   (`"use client"`, lienzo diferido con `lazy(...)`, sin importar recharts en el módulo padre).
   La línea no estrena frontera: estrena serie.

Lo que la dispensa **no** cubre y queda dicho: nadie ha visto esta pantalla dibujada en un
navegador. Es el mismo hueco que la 132 declaró en su R11 y sigue sin dueño en el repo.

---

# Lo que NO se relajó (verificado, no leído)

`git diff origin/dev...HEAD` filtrado por líneas retiradas, en los archivos de test:

- `tests/unit/guards/tablero-financiero.guardia.test.ts`: **una sola línea**, y es el `import`
  sustituido por su forma multilínea, que conserva `IDS_FINANCIERAS_SERVIDAS`. Censos (a)–(f)
  intactos; el archivo pasa de 24 a 29 casos.
- `tests/components/TableroFinanciero.test.tsx`: **tres líneas**, las tres explicadas en §5.1 y
  §5.2 de la bitácora y las tres medidas aquí (m1, m5).
- `tests/unit/analytics/tablero-financiero-rango.test.ts`: el bloque del filtro, sustituido por
  la partición de §5.3 (m2).
- `tests/components/AnaliticaPage.test.tsx` y
  `tests/unit/components/analytics-paquete-guard.test.ts`: **sin cambios**, verdes.

La bitácora dice la verdad en este punto.

---

# Qué hace falta para que esto salga APROBADO

1. **B1** — un caso para R2 que ejercite la rama del KPI con una vista `no_temporal`,
   `esAcumulado: false` y `filas: []`, afirmando que **no** hay región de evolución. Criterio de
   hecho: la mutación que deja la condición de la línea en `!esAcumulado` debe poner **al menos
   un** rojo, y hay que anotarlo en la tabla de mutaciones de `progress/impl_186.md`.
2. **B2** — correr `pnpm exec next build` (nunca `pnpm build`), pegar la salida en la bitácora y
   marcar T F.3. Mi ejecución dice que pasará; la evidencia tiene que estar en el archivo del
   implementer, no en el mío.
3. Cerradas esas dos, el leader completa T F.4 (`./init.sh` completo antes del PR) y T F.6, y
   reconcilia con el spec la desviación m1.

Los menores m2, m3 y m5 no bloquean: m2 y m3 conviene anotarlos como deuda declarada donde ya
viven (la cabecera del censo de rango) si no se atienden ahora.

---
---

# RONDA 2 — 2026-08-06

> Reviso **solo lo que cambió** desde `3ebf237f`: los commits `4d8ca24e` (cierre de B1, B2, m2, m3)
> y `2d41d94c` (reconciliación del spec, m1). **El código de producción no se ha tocado**:
> `git diff 3ebf237f..HEAD` sobre `app/` y `lib/` está vacío; el diff son tests, specs y bitácora.
> Vuelvo a medir con mutaciones sembradas y revertidas byte a byte, esta vez sin nadie corriendo el
> gate en paralelo.

## VEREDICTO DE LA RONDA 2: **APROBADO**

**0 bloqueantes · 2 menores nuevos** (m7, m8), más la deuda viva del final. Los dos bloqueantes de
la ronda 1 están cerrados y reproducidos; m2 y m3 también. La reconciliación del spec (m1) la juzgo
**correcta, no una racionalización** — con una salvedad medida, que es m7.

## B1 — cerrado. Reproducido

Caso nuevo `una vista no_temporal de metrica de FLUJO que llega al KPI tampoco trae linea, ni su
encabezado`, con el doble `panelNoTemporalDeFlujoSinFilas`.

- La mutación gemela de M-10 —dejar la condición de la línea en `!esAcumulado`— pasa de
  **144 verdes / 0 rojos** a **1 rojo**, y el rojo es exactamente ese caso:
  `Tests 1 failed | 144 passed (145)`. **Confirmado el número que declara el implementador.**
- **Los tres incisos de R2 son carga, no adorno.** Lo medí neutralizando aserciones una a una,
  con la mutación puesta:
  - solo con las dos primeras neutralizadas → rojo por el nombre de la pieza suelto
    («expected …Egresos del período… not to contain Evolución en el tiempo»);
  - con las tres primeras neutralizadas → rojo por el cartel de vacío
    (`expected <p …> to be null`).
  O sea: región, encabezado suelto y cartel de vacío **cada uno** mata la mutación por su cuenta.
  El caso cubre los tres incisos que dice cubrir.

## B2 — cerrado. La salida del build es real, no un resumen de memoria

`tasks.md:175` marcada, y `progress/impl_186.md` §T F.3 trae la salida. **No es una copia de la
mía**: sus números difieren de los que yo obtuve en la ronda 1 (`11.1s` vs `12.1s` de compilación,
`23.4s` vs `24.4s` de TypeScript, `439ms` vs `497ms` de generación estática) y coinciden en todo lo
estructural (42 páginas, `/analitica` dinámica, `EXIT=0`). Dos ejecuciones independientes del mismo
build se parecen así. Está abreviada —elide la tabla de rutas— y lo dice; me parece correcto.

## m2 — cerrado, y el hueco que yo medí ya no existe. Con el caso mixto comprobado

Las tres mutaciones, sobre `adaptar.ts` **real** (que ya contiene los `case "dia":` / `case
"semana":` legítimos, o sea que es el archivo mixto):

| Mutación en `adaptar.ts` | Ronda 1 | Ronda 2 |
|---|---|---|
| `export const PRESET_DEL_TABLERO = "semana";` | 0 rojos | **1 rojo** (censo de rango) |
| `if (String(vista.grano) === "semana")` — homónimo ni en `case` ni en `const` | — | **1 rojo** |
| importar `./rango` y nombrar `FILTRO_FINANCIERO_POR_DEFECTO` | — | **1 rojo** (segundo cinturón) |

El **descuento por sustitución** hace lo que dice: el archivo tiene `case` legítimos **y** la
constante ilegítima, y sigue marcado. Con un descuento por cuenta, ese caso se habría escapado.
Nota menor de forma: `RE_HOMONIMO_EN_CASE` es un regex `/g` compartido entre `.replace(...)` y un
`.test(...)`; el `lastIndex` se resetea a mano después, así que hoy es correcto, pero es una
fragilidad conocida de los `/g` reutilizados.

## m3 — cerrado, y verificado en compilación

Añadí un cuarto valor a `GranularidadVista` en `lib/types/analitica-financiera.ts` y corrí
`pnpm typecheck`: **3 errores TS2741**, uno por cada registro exhaustivo —
`tests/components/TableroFinanciero.test.tsx:1229`,
`tests/unit/analytics/tablero-financiero-rango.test.ts:131` y
`tests/unit/guards/tablero-financiero.guardia.test.ts:294`. El array a mano que señalé ya no está:
un cuarto valor rompe la compilación en los tres sitios en vez de censar tres de cuatro en
silencio.

## m1 — la reconciliación del spec: la juzgo CORRECTA, y aquí está por qué

Verifiqué las tres piezas que la sostienen, en este orden:

**1. La implicación `R1 ∧ R7 ⟹ ¬(aserción original)` es real, no retórica.** Leí las citas:
`GraficaLineas.tsx:48` monta `<SerieTextual>` dentro de `{preparadas ? …}` —o sea **siempre que hay
datos**, sin prop que lo desactive— y `SerieTextual.tsx:63-70` emite un `<li>` por punto con
«serie, categoría: valor» dentro de un `<div className="sr-only">`, que **es** `textContent`. Con
R7 obligando a que la categoría contenga la clave literal, `seccion.textContent` **tiene** que
contener la clave. La aserción original no puede ser cierta a la vez que R1. **La demostración se
sostiene.**

**2. La condición de reversión, que es lo que impide que esto sea un permiso retroactivo.**
Revertida la señal a `vista.filas.length === 0` sobre el árbol de hoy (93 casos):

    Tests  39 failed | 54 passed (93)

**39 rojos exactos**, siete de ellos «`%s` NO pinta las fechas de la serie», y con ellos los siete
de «`%s` NO pinta ninguna tabla», que no se tocó. El número que el spec fija como condición
**sale**. Si no hubiera salido, la reconciliación no procedía; salió.

**3. `5d79c56f` no toca el archivo de test.** `git show --stat` lo confirma: ese commit toca
`TableroFinanciero.tsx`, `adaptar.ts`, `decision_186.md` y `tablero-financiero-adaptar.test.ts`, y
**no** `tests/components/TableroFinanciero.test.tsx`. El cambio del caso entra dos commits después
(`881717c6`, Tanda C). La tesis «el criterio no estaba incumplido sino mal acotado» **es cierta**:
lo que ⟨D1⟩ quería probar —que la mudanza fue pura— se probó.

Y verifiqué lo que no me pedían: **ningún requisito se movió** (`R1..R18` idénticos en el diff), y
ya no queda ninguna mención sin acotar del criterio en `specs/` ni en la bitácora.

**Conclusión: no es una racionalización.** Una racionalización presenta como inevitable algo que se
eligió; aquí la **necesidad de cambiar** el caso está demostrada contra el árbol y la **propiedad
protegida** está medida con un número que reproduje. Ahora bien, hay una cosa que sí está de más, y
va como menor.

## m7 (nuevo). «Las tres únicas salidas» no son tres: hay una cuarta, y es MÁS fuerte que la adoptada

`requirements.md` §4.1, `design.md` ⟨D1⟩ y `progress/impl_186.md` §5.1 tabulan tres salidas y
añaden —literal— «las escribo para que se vea que no hay una cuarta que se me escapara». **La hay,
y la medí.** No es una forma de mantener la aserción original (eso sí es imposible): es un
**reemplazo distinto**, que conserva la forma `not.toContain` restringiendo el **texto** en vez de
debilitar la **aserción**. El fallo del caso original viene solo de la alternativa textual, así que
basta excluirla:

```ts
function textoFueraDeLaGrafica(seccion: HTMLElement, tituloGrafica: string): string {
  const copia = seccion.cloneNode(true) as HTMLElement;
  copia.querySelectorAll(`[aria-label="${tituloGrafica}"]`).forEach((n) => n.remove());
  return copia.textContent ?? "";
}
```

Medido con un caso temporal (ya borrado; `git status` limpio), en sus dos variantes —quitando la
región de la gráfica por su **nombre accesible**, y quitando los nodos `.sr-only`—:

| Escenario | forma adoptada (`queryByRole cell` + `queryByText`) | cuarta salida |
|---|---|---|
| código actual | verde | **verde** |
| defecto de ⟨H1⟩ (`filas.length === 0`) | rojo | **rojo** |
| una fecha **visible** embebida en un texto más largo, en la sección de una métrica de flujo | **NO la ve**: el único rojo que sale es el de `cuenta_por_pagar_mensajero`, por la aserción original conservada | **la ve**: rojo en la métrica de flujo |

O sea: la cuarta salida no rompe R1, ni R7, ni R24, ni R10, no edita el paquete, **y es
estrictamente más fuerte** para las seis de flujo. Además dejaría el caso unificado para las siete
métricas —en la acumulada no hay región de gráfica que quitar, así que la aserción queda idéntica a
la original— y haría innecesaria la rama condicional por `esAcumulado`.

Coste honesto de la cuarta salida, que también hay que decir: acopla el test a la estructura del
DOM (un `cloneNode` + `remove`) o al nombre de la clase `sr-only`; la variante por nombre accesible
evita lo segundo y se apoya en algo que ese archivo ya usa por todas partes (`tituloDeLinea`).

**Por qué es menor y no bloqueante:** el defecto que el caso existe para cazar —la tabla de treinta
fechas— sigue muriendo (39 rojos), y el hueco que queda es una forma de regresión que ningún camino
del código produce hoy (`PanelTabla` pinta la fecha como texto propio de una celda, que las dos
aserciones adoptadas sí ven). Lo que **no** puede quedarse es la frase: un spec que afirma «no hay
una cuarta» cuando la hay es exactamente la clase de afirmación que este arnés castiga en el
código. **O se corrige la frase, o se adopta la cuarta salida** — recomiendo lo segundo, que cuesta
ocho líneas y devuelve al caso la fuerza que tenía.

## m8 (nuevo, de forma). El doble nuevo no entra en el censo de dobles

`panelNoTemporalDeFlujoSinFilas` no está en `todasLasVistasDobladas()`, así que sus vistas no pasan
por los invariantes de R17 (b)(c)(d). No es regresión —`panelAcumuladoNoTemporalSinFilas` ya estaba
igual desde antes— y el doble nuevo no los violaría (una vista sin filas no puede mezclar formas),
pero el censo de dobles ya no cubre «todos los dobles del archivo», que es lo que su nombre
promete. Anotarlo o incluirlos.

## Gate y estado ejecutable (medido por mí, con el árbol limpio y sin nadie más tocándolo)

| Comando | Resultado |
|---|---|
| `pnpm typecheck` | **limpio** |
| `pnpm lint` | **0 errores** (48 warnings preexistentes y ajenos) |
| `pnpm test` (suite completa) | **985 archivos · 12.355 casos · 0 rojos**, `EXIT=0`, 248 s |
| `pnpm exec next build` | verde en la ronda 1; la salida de la bitácora es de una corrida propia del implementador |
| Perímetro de la feature | 93 + 49 + 29 + 9 + 7 = **187 casos**, todos verdes |

Sobre el rojo transitorio que la bitácora explica en su §10: **era mío**. El gate se corrió en
paralelo mientras yo tenía sembrada la mutación de la señal en positivo. La suite completa de hoy,
con el árbol limpio, sale entera en verde: queda descartado, y la explicación de la bitácora es
correcta.

## CHECKPOINTS que cambiaron desde la ronda 1

| Punto | Ronda 1 | Ronda 2 |
|---|---|---|
| Todas las tasks `[x]` | NO (F.3, F.4, F.6) | **T F.3 marcada**; quedan F.4 y F.6, que son del leader |
| Cada `R<n>` con red medida | 17/18 | **18/18** |
| `pnpm test` pasa | pendiente | **verde, corrido por mí: 12.355 casos** |
| Verificación final `./init.sh` | pendiente | sus tres pasos (typecheck, lint, `test`) verdes por separado; falta que el leader lo corra entero |
| `review_<feature>.md` con veredicto OK | RECHAZADO | **APROBADO** |

Todo lo demás de `CHECKPOINTS.md` sigue como en la ronda 1: sin migraciones, sin RLS que revisar,
sin secretos, capas separadas (el diff de producción sigue siendo de **dos archivos**, ninguno en
`lib/`, `db/` ni `components/private/analytics/`), y la dispensa de E2E en pie con sus tres
coberturas sustitutas.

## Deuda viva que se lleva la ficha siguiente

1. **m7**: o se corrige la frase de las «tres únicas salidas» en los tres archivos, o se adopta la
   cuarta salida (que es lo que recomiendo). Mientras no se haga, el spec afirma algo que el árbol
   desmiente, aunque su conclusión sea correcta.
2. **La ficha de `design.md` §7.3** —«tests: perfil de forma del DTO financiero, compartido entre
   el servicio y el tablero»—, que es la deuda que ⟨H1⟩ deja sin dueño: hoy los dobles se comparan
   contra **constantes publicadas**, nunca contra lo que el servicio produce. Sigue sin registrar
   en `feature_list.json`.
3. **La granularidad `semana` no es alcanzable en producción** mientras el filtro financiero sea la
   constante `mes` (slot de la 131). La rama existe, se prueba con dobles, y el límite está dicho
   en el propio test.
4. **La discrepancia de centavos** entre el `total` del KPI y la Σ de los puntos hasta que aterrice
   la **187**. Esta feature no la disimula derivando el total, y hace bien.
5. **El cubo en curso no se marca como parcial**: el DTO no publica ese marcador (Q2 de la 180).
6. **m8** y la fragilidad del `/g` compartido en el censo de rango: cosméticas, sin prisa.
7. **Nadie ha visto esta pantalla en un navegador.** La dispensa de E2E sigue en pie con sus tres
   coberturas sustitutas, y ese hueco es del repo, no de esta ficha.

---

**Cierre de la ronda 2: APROBADO.** Quedan T F.4 (`./init.sh` completo) y T F.6 (cerrar ficha e
historia), que son del leader.
