# Guardia: un test citado por una ficha no desaparece en silencio

> Rama `chore/guardia-consumidores-y-tildes`, desde `origin/dev` @ `40f150a5`.
> Motivada por el incidente del 2026-08-07 (feature 161) y por que ese mismo patrón
> **ya había ocurrido dos veces antes sin que nadie se enterara**.

---

## 1. El incidente, en una línea

`da544b30` borró `ChatWhatsappPanel` (decisión humana correcta: lo sustituye el chat flotante).
Ese panel era **uno de los dos** consumidores de `useTonoAlIncrementar` (feature 161) y dentro de
`tests/components/ChatWhatsappPanel.test.tsx` vivía el bloque «R21–R23». Se fueron las dos cosas a
la vez: el enganche y la prueba de que existía. El mensajero dejó de oír el tono del chat, salió a
producción (release #314) y lo encontró una tarea de contabilidad horas después. Reparado en
`4a862356` / PR #318. Lo que faltaba era **impedir que se repita**.

## 2. Qué señal se eligió, y por qué NO las otras

Todas las cifras son de este árbol (2026-08-07) y **reproducibles**: el script de censo está en
§7, con su método declarado. Denominadores: **949** módulos de producción (`app/ components/
hooks/ lib/ providers/`, sin tests), **1.047** exports de valor en `hooks/` + `lib/`.

| señal candidata | excepciones para arrancar en verde | ¿caza el incidente? |
|---|---|---|
| `in_degree == 0` — símbolo sin ningún consumidor | **166** | **NO** |
| `in_degree <= 1` — «bajó a uno» | **529** | sí, pero 529 excepciones no son una señal |
| export de `hooks/`+`lib/` sin consumidor en `app/` ni `components/` | **610** (**172** siguiendo la cadena de imports) | **NO** |
| **cita `R → test` a un archivo que EXISTIÓ y hoy no está** | **5 citas en 2 fichas** | **SÍ** |

**Por qué `in_degree` es ciego a ESTE caso, medido y no argumentado.** Hoy
`useTonoAlIncrementar` tiene **2** consumidores (`chat/ChatConversacion.tsx` y
`components/shared/NotificationsBell.tsx`). Entre `da544b30` y `4a862356` tuvo **1**. Un detector
de `in_degree == 0` habría estado verde durante todo el fallo. Y bajar el umbral a `<= 1` obliga a
justificar **529** símbolos: eso no es una guardia, es un formulario.

**Por qué tampoco «sin superficie».** La tercera fila es la generalización del PR #300
(`superficie-de-uso.guardia.test.ts`), y falla aquí por el mismo motivo: el consumidor que
**quedó** era `components/shared/NotificationsBell.tsx`, que es superficie de primera. No había
nada huérfano que marcar. Además el PR #300 ya midió que contar importadores da **5 falsos
positivos de 20** (usos por referencia: alias, `previewAction = previewPlantilla`,
`files.map(leerEvidencia)`, `deps.setCookie ?? setSessionCookie`).

**La primitiva correcta no está en el grafo de imports.** Está en el mapa `R<n> → test` que la
regla nº 4 de `CLAUDE.md` exige y que `docs/specs.md` llama trazabilidad. Si la ficha de una
feature apunta a un archivo de test que ya no existe, esa feature tiene **requisitos sin prueba**,
que es literalmente lo que le pasó a la 161. La señal es barata (lectura estática + una llamada a
`git log`), tiene cardinalidad de una mano, y **su falso negativo es honesto**: si una feature no
mapea nada, no hay nada que vigilar, y eso ya lo rechaza el reviewer.

## 3. ¿Habría cazado el borrado de `ChatWhatsappPanel`? Sí. Demostrado dos veces.

**(a) Réplica histórica sobre los commits reales**, sin `checkout` (worktree compartido): el
detector se re-implementó sobre `git ls-tree` + `git show` para leer el árbol de un commit
arbitrario. Censo de `specs/*/tasks.md`:

| commit | citas rotas |
|---|---|
| `da544b30^` (1b3dc655, antes del borrado) | **5** |
| `da544b30` (**el commit del incidente**) | **8** |
| `40f150a5` (`origin/dev`, cuatro días después) | **8** |
| `HEAD` (esta rama) | **0** |

Las **tres** nuevas en `da544b30` son exactamente
`specs/161-tono-notificacion/tasks.md` → `ChatWhatsappPanel.test.tsx`, **R21, R22 y R23**. La
guardia se habría puesto roja **en el commit que causó el fallo**, nombrando la feature y los tres
requisitos que se quedaron sin prueba. Y el `8` de `40f150a5` dice lo otro: cuatro días después,
con el fallo ya en producción y reparado a mano, el mapa seguía roto y nadie lo miraba.

**(b) Mutación de control sobre el árbol vivo** — §5.

## 4. Los cinco casos, uno a uno

Criterio aplicado, en este orden: (1) ¿el test se movió y vive en otro sitio? → repuntar;
(2) ¿la cobertura existe en otro archivo? → repuntar diciendo dónde estaba; (3) ¿nunca hubo test o
la cobertura murió? → **anotar con el motivo real**. Nunca inventar una reparación: una cita que
apunta a un test que no prueba ese requisito es peor que una cita rota, porque además está verde.

### 163 · R1, R2, R21 → `MisAsignacionesModule.test.tsx` — **ANOTADOS**

Borrado por **`369ccc4c`** (2026-08-03, "ux improvements"), que partió el módulo del mensajero en
dos y renombró el archivo a `tests/components/RepartoModule.test.tsx`.

Medido antes de decidir:
- `git show 369ccc4c^:tests/components/MisAsignacionesModule.test.tsx` **no contiene** ni
  "mosaico", ni "vista detalle", ni "mismas señales", ni "carrusel". Los tres casos **nunca se
  escribieron**: T5.3 quedó `[ ]` y bloqueada el 2026-07-31 porque el archivo arrastraba 16 rojas
  ajenas a la feature.
- El sucesor `RepartoModule.test.tsx` (80 casos) **no monta** el conmutador ni el carrusel: el
  literal `"Órdenes en reparto"` no aparece en ningún test salvo como *fixture* de
  `CarruselCards.test.tsx`.
- Sí existe cobertura de las mismas tres conductas en `tests/components/RecogerModule.test.tsx`
  («conmutador mosaico/detalle y carrusel», añadido por el mismo `369ccc4c`), pero sobre **"Por
  recoger"**, que los requisitos de la 163 dejan **explícitamente fuera de alcance**. Repuntar ahí
  habría sido la reparación falsa: verde sobre la superficie equivocada.
- El enganche **sigue vivo**: `RepartoModule.tsx` monta `CarruselCards` con
  `ariaLabel="Órdenes en reparto"` (y `RecogerModule.tsx` también).

Veredicto: anotación con el motivo real + T5.3 reescrita para que apunte al archivo que hoy monta
la superficie, con `RecogerModule.test.tsx` señalado como molde exacto. Las tres filas quedan
marcadas **PLANIFICADO, NUNCA ESCRITO**, que es lo que son.

### 63 · R12 → `tests/unit/components/ordenes-tabs.test.tsx` — **ANOTADO**

Borrado por **`cfba5af2`** (2026-07-27, "feat: ordenes"). El mismo commit añadió
`tests/unit/components/ordenes-listado.test.tsx`: 368 líneas fuera, 347 dentro. `3cdfb503` había
renombrado `OrdenesTabs.tsx` → `OrdenesListado.tsx`.

R12 **no perdió su prueba: perdió su vigencia.** El sucesor se titula
`describe("OrdenesListado — una sola tabla (R12)")` y su primer caso afirma **lo contrario** del
requisito: «renderiza UNA tabla, no tabs por estado», con `queryAllByRole("tab")` en 0. Por eso
**no** se repunta: apuntar R12 al test que prueba su negación lo dejaría verde sin que nadie lo
sostenga. Queda anotado + una nota **visible** (la anotación es un comentario HTML y no se
renderiza) que además explica que R13–R18 ("idem" en la tabla) corren la misma suerte y que su
forma actual sí está cubierta en el sucesor y en la feature 144.

### 63 · R20 → `tests/unit/components/ordenes-tabs.test.tsx` — **REPARADO**

Mismo borrado (`cfba5af2`). Pero R20 —«el rol `mensajero` NO DEBE usar este componente»— **sigue
vigente y sí tiene prueba viva**, en otro archivo: `tests/components/OrdenesPage.test.tsx` ›
«seguridad: mensajero y adminSatelite NO alcanzan /ordenes (notFound)». Es **más fuerte** que la
cita original ("mensajero no monta tabs"): hoy ni siquiera alcanza la página. Cita repuntada ahí.

**Recuento: 1 reparado, 4 anotados** (2 anotaciones cubren las 4 filas). El patrón del incidente
del 2026-08-07 ya había pasado el 2026-07-27 y el 2026-08-03, en dos features distintas, y en
ninguno de los dos casos se enteró nadie. Eso valida la guardia sola.

## 5. Mutaciones de control

| # | mutación | resultado |
|---|---|---|
| A | reproducir el incidente: las citas vivas de la 161 (R21–R24) vuelven a apuntar a `ChatWhatsappPanel.test.tsx` | **ROJA**, con las 4 filas nombradas y `«…lo borró da544b30 2026-08-07 chore(ui): borra ChatWhatsappPanel…»` |
| B | motivo de relleno: la anotación de la 163 pasa a `: pendiente` | **ROJA** — el motivo se descarta y las 3 citas vuelven a quedar sin excusar |
| C | anotación que sobrevive a su motivo: la anotación apunta a `CarruselCards.test.tsx`, que **sí** existe | **ROJA** por dos vías: la excepción caducada y las 3 citas desnudas |

Restauración **verificada por hash** (`git hash-object`), no por inspección visual:

```
specs/161-tono-notificacion/tasks.md   antes 60f28de5…  mutado 79b950f4…  restaurado 60f28de5…
specs/163-carrusel-en-reparto/tasks.md antes 16ea3139…  restaurado 16ea3139…  (y otra vez 16ea3139…)
```

`git status --porcelain` vacío tras cada una, y la guardia de vuelta en verde (12/12).

## 6. Qué NO cubre esta guardia

La sección más valiosa. Todo esto está **medido**, no supuesto:

1. **Solo lee `specs/*/tasks.md`.** El mapa `R → test` vive en cuatro sitios: 22 fichas lo tienen
   en `tasks.md` (477 citas), 32 en `requirements.md` (619), 9 en `design.md` (57) y 116
   `progress/impl_*.md` (3.080). **`design.md` ya entró** (§11). Fuera del alcance quedan hoy
   **107 citas rotas en 24 archivos de `progress/`** y **32 en 7 `requirements.md`** (features 55,
   59, 94, 114, 135, 160, 167). `progress/**` se deja fuera **a propósito**: es una bitácora, un
   registro de lo que pasó, y reescribirla para que apunte a un archivo renombrado después
   falsifica el registro. `requirements.md` es **deuda abierta con coste**, no un trámite: sus 32
   rotas son de UI retirada cuyo sustituto no se pudo verificar sin inventar.
2. **No vigila el mapa que nunca se escribió.** Una feature sin tabla `R → test` es invisible
   aquí: 22 de 150 fichas tienen mapa en `tasks.md`. Eso lo cubre el reviewer, no una guardia.
3. **No distingue «el test existe» de «el test prueba el requisito».** Es la mitad más importante
   de lo que no cubre. La 163 lo enseña: el archivo citado se renombró a `RepartoModule.test.tsx`
   y, si se hubiera repuntado ahí, la guardia estaría verde con **cero** cobertura de R1/R2/R21,
   porque resuelve por nombre de archivo, no por caso. La única defensa es humana y está escrita
   en el mensaje de la guardia: *repuntar solo al test que HOY cubre ese requisito*.
4. **Resuelve por nombre de archivo, no por ruta** (lenidad deliberada: mover de carpeta no pierde
   pruebas). Dos archivos homónimos en carpetas distintas se tapan entre sí.
5. **No ve un test que se vació sin borrarse** (`describe.skip`, `it.todo`, o el cuerpo entero
   comentado). El archivo sigue en el árbol y la cita resuelve. Otra guardia, otra señal.
6. **No ve el caso «nunca existió»**: 11 citas de este repo apuntan a nombres que la historia no
   registra (9 de `specs/109`, cuya tabla se titula «archivo de test esperado», y 2 de
   `specs/173`). Es un mapa aspiracional, otra especie de fallo, y meterlo aquí ahogaría esta
   señal. Deuda anotada, con su censo.
7. **No previene la causa raíz del incidente**, solo su parte silenciosa. Que un enganche
   desaparezca con la vista que lo montaba lo vigila `superficie-de-uso` (#300) —y en este caso no
   lo vio, porque no quedó nada huérfano—. Esta guardia no habría impedido el borrado: habría
   puesto la suite roja en el mismo commit, obligando a decidir en vez de a enterarse en
   producción. **Un test que desaparece es una decisión; que desaparezca en silencio, no.**
8. **Depende de `git log`.** En un clon con `--depth` toda cita rota se clasificaría como «nunca
   existió» y la guardia callaría. Por eso hay un caso que exige ≥ 20 borrados en la historia y
   ancla en un hecho inmutable (`ChatWhatsappPanel.test.tsx` figura entre los borrados). Medido:
   `HEAD` y `--all` devuelven **43** ambos, así que no depende de qué ramas tenga el clon a mano.

## 7. Archivos y método

**Creados**
- `tests/unit/guards/test-citado-desaparecido.guardia.test.ts` — la guardia (12 casos).
- `progress/impl_guardia-citas-rotas.md` — esta bitácora.

**Modificados**
- `specs/161-tono-notificacion/tasks.md` — R21–R23 repuntados de `ChatWhatsappPanel.test.tsx` a
  `ChatConversacionTono.test.tsx` (nombres de caso verificados uno a uno contra el archivo), R24
  ampliado, y T3.2/T4.5 dejan escrito que el enganche y la prueba viajaban juntos en el archivo
  borrado. Corrección de punteros rotos, mismo precedente que el PR #302.
- `specs/163-carrusel-en-reparto/tasks.md` — anotación + T5.3 reescrita + 3 filas marcadas.
- `specs/63-orden-lista-actualizada/tasks.md` — anotación + nota visible + R20 repuntado.

**Método de los censos** (scripts de medición, ejecutados desde la raíz del worktree; no se
versionan porque son instrumento, no producto — el de la réplica histórica se puede rehacer con
`git ls-tree -r --name-only <commit> -- tests e2e` + `git show <commit>:<ficha>`):
- *Consumidores*: módulo = `.ts/.tsx` bajo `app/ components/ hooks/ lib/ providers/` sin
  `.test/.spec`; export de valor = `export (async )?function|const|let|class X` y `export { X }`
  (se excluyen `type`/`interface`); consumidor = otro archivo de producción que contiene el
  identificador como token. Sobrecuenta homónimos —el mismo sesgo que cualquier grep— y por eso
  se reporta el **orden de magnitud**, que es lo que decide: 166 y 529 son inviables, 5 no.
- *Cadena*: cierre transitivo del grafo de imports (`@/…` y relativos) desde `app/`+`components/`;
  928 de 949 módulos son alcanzables.

**Mapa `R → test` de la propia guardia** (sus requisitos son los de su encargo, no los de una
ficha SDD):

| R | caso |
|---|---|
| G1 — lee las filas `R<n>` y solo lo que va entre backticks | «el lector de citas ve la fila de un requisito y NO lee la prosa que nombra archivos» |
| G2 — la anotación exige archivo y motivo escrito | «el lector de anotaciones exige archivo y motivo escrito, y descarta el relleno» |
| G3 — el motivo puede ser un párrafo | «el motivo puede ocupar varias líneas, y la anotación conserva la línea en que empieza» |
| G4 — el detector responde distinto a un test vivo y a uno borrado | «CONOCIDO-POSITIVO sintético…» |
| G5 — «nunca existió» no entra en el censo | «un nombre que NUNCA existió no entra en el censo» |
| G6 — nada de lo escaneado salió vacío | «hay fichas, hay mapas R→test y hay árbol de tests» |
| G7 — sin historia de git, roja y no muda | «git respondió con la historia de borrados» |
| G8 — no marca lo vivo | los dos CONTROL POSITIVO (anclas de la 161 y la 163; ≥90 % de citas resuelven) |
| G9 — toda cita a un test borrado está anotada | «toda cita `R → test` a un archivo borrado está anotada con su motivo» |
| G10 — la anotación caduca | «ninguna anotación `@test-desaparecido` sobrevive a su motivo» |
| G11 — la anotación no queda huérfana | «ninguna anotación `@test-desaparecido` cuelga de una cita que ya no existe» |
| G12 — el censo cubre `tasks.md` **y** `design.md` | «el censo cubre LAS DOS clases de documento, y se nota si alguna se cae» (§11) |

## 8. Verificación

```
pnpm run typecheck   -> limpio (tsc --noEmit, sin salida)
pnpm exec vitest run tests/unit/guards/test-citado-desaparecido.guardia.test.ts
                     -> 1 archivo, 12/12 verdes
```

Suite de la zona y `./init.sh --rapido`: ver §9. La lección de hoy en su tercera iteración es que
**ninguna lista de guardias basta** (`grep --include=*guard*` deja fuera 13 de 72 archivos;
`vitest list guard` no ve lo que vive en `tests/unit/repositories/`), así que la zona se corrió por
directorio completo (`tests/unit` + `tests/components`), no por patrón de nombre.

## 9. Resultados de la corrida

**Zona completa** — `pnpm exec vitest run tests/unit tests/components` (por directorio, no por
patrón de nombre):

```
 Test Files  815 passed (815)
      Tests  10377 passed (10377)
   Duration  223.05s
EXIT=0
```

**Gate rápido** — `./init.sh --rapido`:

```
✓ node v24.13.0 · dependencias presentes · max-2-por-zona (in_progress=0) · specs presentes
✓ typecheck paso            (tsc --noEmit, sin salida)
✓ lint paso                 (✖ 49 problems, 0 errors, 49 warnings — todos previos)
-> test:cambiados           Test Files 1 passed (1) · Tests 12 passed (12)
-> test:guardias            Test Files 74 passed (74) · Tests 1011 passed (1011)
✓ test:rapido paso
✓ todas las migraciones tienen down.sql · ✓ .env presente
== init OK ==
```

Un detalle que conviene saber: `test:cambiados` (`vitest run --changed origin/dev`) seleccionó
**solo 1 archivo** — el de la guardia. Los cuatro `tasks.md` no están en el grafo de imports, así
que un cambio que solo tocara fichas no arrastraría nada por esa vía. La guardia entra igualmente
porque su nombre lleva `guard` y `test:guardias` la selecciona siempre; si alguien la renombrara
sin `guard`, saldría del gate rápido sin hacer ruido.

El gate completo (`./init.sh` sin flags) lo corre el humano antes del PR, según el punto 5 de
`CLAUDE.md`.

## 10. Veredicto

La guardia entra en verde, arranca con **cero** excepciones sin motivo escrito, cierra los cinco
casos reales que encontró (1 reparado, 4 anotados, en 2 features y con sus commits de origen
nombrados) y está demostrado —por réplica histórica y por mutación— que se habría puesto roja en
el mismo commit que causó el fallo de producción del 2026-08-07.

---

# Segunda tanda (mismo día): tildes, alcance y el registro histórico

## 11. `design.md` entra en el censo — y costó cero

Medido **antes** de tocar nada: `design.md` tenía **0 citas rotas sobre 57**. Ampliar el alcance el
mismo día en que se mide es la única ventana en la que sale gratis, así que se amplió: el censo pasa
de **477 a 534 citas** y de **22 a 31 documentos con mapa** (22 `tasks.md` + 9 `design.md`), y la
guardia sigue en verde **sin una sola anotación nueva**.

`requirements.md` **no** entra: 32 rotas en 7 fichas (55, 59, 94, 114, 135, 160, 167). Eso es una
decisión de alcance **con coste**, no un trámite, y queda anotada como deuda con sus números.

Ampliar un alcance tiene una trampa conocida: que luego se estreche en silencio. Por eso el caso
nuevo **G12** exige que las **dos** clases de documento sigan aportando mapa (≥ 5 cada una); los
umbrales agregados no lo distinguirían. Y la ampliación se probó con una **mutación**: apuntar R28
de `specs/154-catalogo-estados-v2/design.md` a un test borrado pone la guardia **ROJA**, nombrando
ficha, línea, requisito y commit. Restaurado y verificado por hash (`63bdcee5…` antes y después).

## 12. Las siete tildes del tablero

**Revisadas las 25 etiquetas de `lib/analytics/metrics.ts`, una a una.** Siete estaban mal escritas
—exactamente las siete señaladas, ni una más— y las otras dieciocho están bien:

| etiqueta | corregida a |
|---|---|
| `Ordenes creadas` | `Órdenes creadas` |
| `Ordenes por estado` | `Órdenes por estado` |
| `Antiguedad por estado` | `Antigüedad por estado` |
| `Conciliacion de cierres` | `Conciliación de cierres` |
| `Ingreso por comision COD` | `Ingreso por comisión COD` |
| `Tasa de devolucion` | `Tasa de devolución` |
| `Motivos de devolucion` | `Motivos de devolución` |

Dos comprobaciones que valía la pena hacer y que confirman las siete: **`Ganancia de Ordenex`** no
lleva tilde porque `Ordenex` es marca, y **`antigüedad`** solo pide **diéresis**, no acento (es
aguda terminada en `-d`). Las otras dieciséis son llanas terminadas en vocal o `-s`.

**El catálogo no bastaba, y esto no estaba en el encargo.** Los títulos de panel viven
**duplicados** en `app/(app)/analitica/_components/operativo/catalogo-paneles.ts` —duplicación
deliberada, R25: ese archivo no importa el catálogo para no publicar el censo de servidor al
navegador— y son el `aria-label` de la región, es decir, lo que el maestro lee como título. Ahí
estaban las dos mismas… **y una tercera que el censo por etiquetas no veía: `Ordenes sin
gestionar`**, que no es ninguna de las 25.

**Qué se movió y qué no**, con el criterio explícito de tocar solo lo que se rompe:

- Rojas de verdad (3 archivos, 21 casos): `TableroOperativo.test.tsx`,
  `TableroOperativoLatencia.test.tsx` y `FiltrosOperativos.test.tsx`, que buscan la región por su
  nombre accesible literal.
- `e2e/analitica-roles.spec.ts` (5 literales): no se ejecuta en este repo, pero enumera lo que cada
  rol ve en pantalla; dejarlo desactualizado es dejar escrito algo falso.
- **NO se tocaron**, medido: las fixtures de `export-csv-{cobertura,denegado,puerta}.test.ts` y de
  `financiera-contratos.test.ts` construyen paneles de prueba y no afirman la copia del producto —
  la suite lo confirma en verde—. Tampoco los `descripcion:` del catálogo: **no llegan a pantalla**
  (el vacío que se ve sale de `textos.ts`), así que siguen la convención sin tildes del repo, como
  los comentarios.

De los tres archivos que el encargo daba por afectados, **solo uno lo estaba**, y no como se
esperaba: `caja-173-alcance.guardia.test.ts` cita `Ganancia de Ordenex` (etiqueta que no cambia),
`cierre-detail-congelado.test.ts` cita `Rechazos` (tampoco cambia), y `financiera-contratos.test.ts`
sí cita `Conciliacion de cierres` **pero como fixture**, así que no se pone roja. Se dicen los tres
porque la instrucción pedía decirlo si alguna no se sostenía.

### La mutación, y el agujero que destapa

| # | mutación | resultado |
|---|---|---|
| M1 | `titulo: "Órdenes creadas"` → sin tilde en `catalogo-paneles.ts` | **ROJA**: 21 casos en 3 archivos |
| M2 | `etiqueta:` de **dos** de las siete → sin tilde en `lib/analytics/metrics.ts` | **VERDE**: 123 archivos, 1.500 tests |

Restauración verificada por hash: `ae028261…` (paneles) y `83e9c6df…` (catálogo), idénticos antes y
después; `git status` limpio.

**M2 es el hallazgo, no el trámite.** Las 25 etiquetas del catálogo —texto que el maestro lee en la
primera pantalla— **no las afirma ningún test**. Se pueden cambiar todas, una a una, y la suite
entera sigue verde. Lo único fijado es el título del panel, y solo porque vive en el archivo
duplicado. Por eso este fallo lo encontró un humano mirando el navegador y no la suite, y por eso
volverá a pasar. **Propuesta, no ejecutada** (queda fuera del encargo, decídela): un caso que fije
las 25 etiquetas literalmente, del mismo tamaño que el censo de columnas de descarga; cambiar copia
visible pasaría a ser un acto deliberado en vez de un descuido invisible.

**Fuera de alcance, medido para que exista el número:** el problema no se acaba en las etiquetas.
Un censo grueso de literales de cadena en `app/(app)/analitica` da **~30 candidatos sin tilde en 6
archivos** (p. ej. `textos.ts` → «Esta metrica no registro ningun movimiento…», que es el estado
vacío que se ve en pantalla). Es heurístico y trae falsos positivos: hay que mirarlos uno a uno. No
se tocó nada de eso — el encargo acotaba a las etiquetas del catálogo.

## 13. `specs/161/design.md`: se anota, no se reescribe

El design nombra `ChatWhatsappPanel.tsx` en tres sitios (§1, §3, §4). **Las tres se conservan.** Un
`design.md` es el registro de lo que se diseñó **entonces** —misma naturaleza que un `down.sql`
respecto de su migración— y sustituir el nombre por `ChatConversacion.tsx` borraría justo lo que
explica **por qué** el tono se rompió: que la feature colgaba de un componente que otra decisión,
legítima y ajena, podía retirar.

En su lugar, una **nota de cabecera** con el formato que el PR #302 usó en la 188 por la
renumeración: qué pasó, con su commit y su release; dónde vive hoy el enganche y con qué pruebas; y
qué lo vigila ahora. Quien abra el documento la ve antes que nada, sin cruzar bitácoras.

Es la misma distinción que decidió R12 de la 63: **una cita rota se repara o se anota; una decisión
histórica se anota, nunca se reescribe.**

## 14. Verificación de la segunda tanda

```
pnpm run typecheck                       -> limpio (tsc --noEmit, sin salida)
pnpm exec vitest run tests/unit tests/components
                                         -> Test Files 815 passed (815)
                                            Tests 10378 passed (10378)   [227.36s, EXIT=0]
./init.sh --rapido                       -> == init OK ==
   ✓ typecheck · ✓ lint (0 errores, 49 avisos previos)
   test:cambiados   114 archivos, 1.284 tests
   test:guardias     74 archivos, 1.012 tests
   ✓ down.sql de todas las migraciones · ✓ .env
```

Nota sobre el gate: en la primera tanda `test:cambiados` seleccionó **1** archivo (solo se habían
tocado `.md` y la guardia); en esta, **114**, porque el cambio entra por `lib/analytics/metrics.ts`
y el grafo de imports arrastra media analítica. Es la diferencia entre tocar documentación y tocar
producto, y se ve en el gate.

## 15. Veredicto de la segunda tanda

Siete etiquetas corregidas de veinticinco revisadas, más tres títulos duplicados que el encargo no
conocía; la guardia amplía a `design.md` sin coste y con su mutación de control; y el design de la
161 queda anotado sin falsificarse. Lo que queda escrito y sin cerrar: **las etiquetas del catálogo
no las afirma ningún test** —M2 lo demuestra en verde— y el resto de la copia de la analítica
arrastra el mismo descuido, con ~30 candidatos medidos.
