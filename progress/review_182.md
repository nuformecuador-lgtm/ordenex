# 182 — analitica: cablear el modo agregado al tablero operativo · REVIEW

> Reviewer (F2.2), 2026-08-10. Worktree `C:/w182`, rama
> `feature/182-analitica-cablear-modo-agregado`, HEAD `93b6bffe`.
> Leido antes: los tres ficheros de `specs/182-...`, `progress/impl_182.md` (entera, incluida
> la seccion 6 «Aterrizaje» del leader), `docs/architecture.md`, `docs/conventions.md`,
> `docs/verification.md` y `CHECKPOINTS.md`.

## VEREDICTO: **APROBADO** — cero bloqueantes.

Los 16 requisitos tienen test nombrado y vivo, las 16 mutaciones estan documentadas con el
caso que cayo, la frontera de `design.md 1` se respeta salvo un cambio de COMENTARIO en
`lib/actions/` que un guardia obligaba (menor 3), y el tope de seis paneles sigue intacto.

---

## 1. Checklist de `CHECKPOINTS.md`

| Punto | Estado |
|---|---|
| `specs/182/requirements.md` con EARS numerados | **OK** — R1...R16, mas seccion 3 con mutacion por fila |
| `design.md` con alternativa descartada y su porque | **OK** — nueve, con motivo cada una |
| `tasks.md` con TODAS las tareas `[x]` | **PARCIAL** — T5.4 sigue `[ ]` (menor 1) |
| Cada `R<n>` mapea a test concreto | **OK** — tabla de la seccion 2, verificada archivo por archivo |
| `progress/impl_<feature>.md` con el mapa `R -> test` | **OK** — seccion 2 de la bitacora |
| `pnpm typecheck` limpio | **OK** — corrido por el reviewer sobre `93b6bffe`: salida vacia |
| `pnpm lint` limpio | **OK segun el gate del leader** (seccion 6.3); no lo repeti |
| `pnpm test` | **OK en lo que toca la feature** — 15 archivos, 186 casos corridos por el reviewer (seccion 3) |
| E2E si toca flujo critico | **N/A declarado** — tablero de solo lectura; escrito en `requirements.md` seccion 3 |
| RLS en tablas nuevas | **N/A** — cero tablas, cero columnas, cero migraciones; verificado: el diff no toca `db/**` ni `prisma/**` |
| Migraciones reversibles | **N/A** — ninguna |
| Sin secretos hardcodeados | **OK** — el diff no introduce ninguna credencial |
| Webhooks con firma/idempotencia | **N/A** — ninguno |
| Capas separadas | **OK** — la feature vive entera en el subarbol de UI; el dato entra por Server Action, nunca por servicio ni Prisma. Lo afirma el guardia nuevo (R12) y el de la 131, los dos verdes |
| Interfaces en `lib/interfaces/` | **N/A** — no se crean |
| Paginas protegidas validan en servidor | **N/A** — no se toca `page.tsx` ni el recorte por rol |
| Mutaciones por Server Action, no API route | **OK** — lectura por Server Action; `app/api` intacto |
| Sin hardcode de pais/moneda/cuenta | **OK** — la unica lista de negocio nueva se lee del contrato del servidor (`esUnidadAgregable`), no se reescribe en el cliente |
| `./init.sh` verde | **OK, medido por el leader** (seccion 6.3): 1015/1017 archivos, 12.596/12.608 tests; los 12 rojos son `busqueda-*`, ajenos y con causa raiz identificada (migracion que solo vive en `ux`). **No los recontabilizo**: esta rama no toca busqueda, ni SQL, ni migraciones |
| `progress/review_<feature>.md` con veredicto OK | este archivo |
| Entrada en `progress/history.md` | **PENDIENTE** (menor 2) — es del leader, al cerrar |

---

## 2. Trazabilidad `R<n> -> test` — COMPLETA (16/16)

Cada fila la comprobe abriendo el archivo y localizando **el nombre exacto del caso**; no me
fie del mapa de la bitacora. Los archivos se corrieron (seccion 3).

| R | Test (archivo › caso) | Verificado |
|---|---|---|
| R1 | `tests/components/TableroOperativo.test.tsx` › «un panel de tasa con 90 dias pinta la serie por cubos semanales del servidor y ya no pide reducir el rango» | **si** — afirma las 3 categorias de cubo, `getAllByRole("listitem")` = 3 (ni 90 puntos ni 13 semanas) y la ausencia del vacio |
| R2 | `tests/unit/analytics/tablero-agregado-cableado.test.ts` › «las categorias de la serie semanal son las `fecha` de los cubos del servidor, no una semana recalculada en el cliente» | **si** — el fixture ancla los cubos en dias 1/8/15, que NO son lunes ISO; ademas niega `2025-12-29` |
| R3 | idem › «una tasa larga sin cubos del servidor falla ruidosamente en vez de cubetearse en el cliente» | **si** — `toThrow` con `semana` ausente y con `semana: []`, en `porcentaje` y en `segundos`, mas el control positivo «con cubos no lanza» |
| R4 | `TableroOperativo.test.tsx` › «el panel de tasa muestra su cifra total del periodo tambien con el rango corto» | **si** — la cifra afirmada (72,3 %) es distinta a proposito del punto diario (90 %) |
| R5 | `tablero-agregado-cableado.test.ts` › «con dias de volumen desigual la cifra total es la del cubo periodo (2/11) y NO la media de los valores diarios (0,55)» | **si** — fixture DESIGUAL (1/1 y 1/10) y **las dos aserciones** (`toBeCloseTo(2/11)` mas `not.toBeCloseTo(0.55)`) |
| R6 | `TableroOperativo.test.tsx` › «un total de periodo que incluye el dia en curso se anuncia parcial con su hora de corte» | **si** — afirma «Total parcial», la hora local (14:35) y la cifra |
| R7 | idem › «un periodo con denominador cero dice que no hubo gestiones y no pinta un cero» | **si** — texto propio, distinto de `VACIO_PANEL.descripcion`, y niega el `0 %` |
| R8 | `TableroOperativoLatencia.test.tsx` › «ninguna metrica de conteo invoca la Server Action agregada» | **si** — igualdad de conjuntos derivada del catalogo, mas doble guardia contra el verde por vacio |
| R9 | `tests/unit/analytics/tablero-catalogo-paneles.test.ts` › «la unidad declarada por cada metrica del catalogo de paneles es la que declara el catalogo de metricas» | **si** — recorre TODAS las metricas y cuenta las comprobadas (mayor que 5) |
| R10 | `TableroOperativo.test.tsx` › «al cambiar el filtro la cifra total se vuelve a pedir con el filtro nuevo» | **si** — aparece 12,5 %, desaparece 84,2 % y se re-pide con `rango=mes` en LOS DOS granos |
| R11 | `TableroOperativoLatencia.test.tsx` › «una carga del tablero dispara la serie y los dos granos agregados SOLAPADOS, y ni una invocacion mas de las declaradas» | **si** — presupuesto afirmado como numero derivado del catalogo, mas dispersion menor que `LATENCIA_MS` sobre el lote completo (serie y agregado comparten el array `arranques`) |
| R12 | `tests/unit/analytics/tablero-agregado-frontera.guardia.test.ts` › «el subarbol operativo no recompone ninguna formula de negocio ni pide el agregado por otra puerta» | **si** — censa el ARBOL (no el diff), con caso anti-vacio y caso de discriminacion |
| R13 | `TableroOperativo.test.tsx` › «si el agregado responde `forbidden` el panel dice prohibido y no pinta ninguna cifra» | **si** — la serie llega `ok` y solo el agregado esta denegado; ademas `not.toMatch(/\d/)` y los demas paneles vivos |
| R14 | idem › «el panel de tasa por cubos semanales anuncia el grano usado» | **si** — y el caso hermano de conteos afirma que ahi NO sale `TEXTO_GRANO_SERVIDOR`: dos textos distintos para dos afirmaciones distintas |
| R15 | (a) `tablero-agregado-cableado.test.ts` › «`agregarPorSemana` rechaza toda unidad que no sea conteo: la semana del cliente no toca tasas ni tiempos» · (b) `tablero-agregado-frontera.guardia.test.ts` › «`lunesDeLaSemana` tiene UN solo llamador en el subarbol y es la agregacion de conteos» | **si** — ver seccion 4.1 |
| R16 | `tablero-agregado-frontera.guardia.test.ts` › «el subarbol no conserva el modo `rango_excedido` ni sus dos textos» | **si** — y el censo discrimina (codigo repuesto positivo, prosa negativa). Comprobado a mano: en `app/**` solo queda la MENCION EN PROSA de `textos.ts`, que el guardia excluye por diseno |

**Las cuatro aserciones vivas de `rango_excedido` (hecho 16):** dos reescritas en
`tablero-agregacion.test.ts` (siguen afirmando que el cliente no promedia cocientes, ahora via
`expect(() => agregarPorSemana(dias, "porcentaje")).toThrow()`), una reescrita en
`TableroOperativo.test.tsx` (es el caso de R1) y la vacua de `:342` **retirada**, sustituida
por una afirmacion con contenido (el conteo anuncia la semana del CLIENTE y no la del
servidor). Verificado en el diff.

---

## 3. Verificacion que corrio el reviewer (no me fie de la bitacora)

- `pnpm typecheck` → **limpio** (salida vacia) sobre `93b6bffe`.
- `pnpm exec vitest run`, por lotes:
  - `tablero-agregado-cableado` + `tablero-agregado-frontera.guardia` + `tablero-agregacion`
    + `tablero-catalogo-paneles` + `agregado-aging` → **5 archivos, 49 casos verdes**.
  - `TableroOperativo` + `TableroOperativoLatencia` + `AnaliticaNoSustitucion` → **3 archivos,
    63 casos verdes**.
  - `tablero-operativo-frontera.guardia` + `superficie-de-uso.guardia` +
    `export-csv-frontera.guardia` → **3 archivos, 51 casos verdes**.
  - Los 3 fixtures de la 134 tocados + `presentacion-etiquetas-mensajero` → **4 archivos,
    23 casos verdes**.
- **No corri la suite completa** (instruccion del leader): el gate ya esta medido en la
  seccion 6.3 de la bitacora y los 12 rojos de `busqueda-*` son ajenos con causa raiz
  identificada.
- **No aplique mutaciones**: el reviewer no edita codigo. Verifique la evidencia documental
  (salida literal del reporter con el nombre de cada caso) y la plausibilidad estructural de
  cada fila leyendo el punto de mutacion en el codigo de produccion. Las 16 filas nombran un
  caso que existe con ese nombre exacto. La seccion 3.1 de la bitacora declara honestamente los
  cinco casos en que ademas cae un hermano, con el argumento de por que las filas siguen sin
  ser intercambiables (cada mutacion fina deja verde el caso de la gruesa); lo revise fila a
  fila y se sostiene.

---

## 4. Los cinco puntos que el leader pidio mirar con ojo critico

### 4.1 R15 — el acotamiento, ¿distingue de verdad?

**Si, en las dos capas que exigia el humano al cerrar Q4, y con un residuo acotado.**

- **Comportamiento:** `agregarPorSemana(puntos, unidad)` tiene la unidad como parametro
  **obligatorio**, no opcional: un llamador que «no la pase» **no compila**. La desviacion 2 de
  la bitacora es exactamente lo que hace esto verdad, y por eso no es cosmetica.
- **Censo:** el guardia cuenta **llamadores de `lunesDeLaSemana` en todo el subarbol** y exige
  exactamente 1, que ese uno este dentro del cuerpo de `agregarPorSemana`, y que ese cuerpo
  contenga `unidad: MetricaUnidad`, `esAgregableTemporal(unidad)` y el `throw`. El contador se
  prueba aparte contra codigo sintetico (2 llamadas dan 2; la declaracion da 0; la prosa da 0),
  asi que no puede ser un patron muerto que da el mismo verde que un arbol limpio.
- **El unico llamador real** pasa `f.serie.unidad` —la unidad **del dato**, no una constante—,
  asi que un cableado desde la ruta de `porcentaje` muere en el acto.
- **Residuo (menor 8):** un hipotetico segundo llamador de `agregarPorSemana` que **mintiese**
  pasando el literal `"conteo"` sobre datos de porcentaje evadiria las dos capas (no anade
  llamador de `lunesDeLaSemana`, y la comprobacion mira el argumento, no el dato). Hoy no
  existe. Lo anoto como residuo, no como incumplimiento: R15 pide que ninguna **ruta** de
  porcentaje o segundos la invoque, y eso esta afirmado.

### 4.2 Desviacion 3 — `cubo.fecha` como categoria, sin marca de parcialidad

**Coherente con R2 y R6. No se pierde ningun aviso que el spec pida.**

- R2 exige literalmente que las categorias del eje salgan de la `fecha` que trae cada cubo y
  **prohibe** recalcular la semana en el cliente. Poner la marca de `categoriaDePunto`
  obligaria a reinterpretar la fecha del cubo en el cliente; ademas el texto de esa marca habla
  del «dia en curso», que sobre una semana seria falso.
- R6 pide la parcialidad **en el total**, y ahi esta afirmada (caso de R6, con su `corteAt`).
- **Lo que si se pierde, y no lo exige ningun requisito:** una semana en curso no se distingue
  en el **eje** (la serie diaria si lo hace). Como el cubo `periodo` de un rango que llega a hoy
  viene `parcial: true`, el panel **si** anuncia la parcialidad, aunque a nivel de cifra y no de
  punto. Observacion para quien retome el eje o para la ficha del aging; no es un hallazgo.

### 4.3 Desviacion 4 — ¿sigue viva la excepcion de R3, y su mutacion?

**Si, las dos.**

- `prepararPanel` **lanza** (`CubosDelServidorRequeridosError`), y el caso de R3 lo afirma
  llamando al modulo puro: la captura del componente **no** lo alcanza, asi que la mutacion de
  R3 (sustituir el `throw` por la ruta de conteo) sigue poniendo rojo el caso nombrado.
- La condicion **sigue siendo alcanzable en pantalla**: el panel exige `periodo.data` y
  `semana.data` definidos para salir de «cargando», pero `cubosDe()` devuelve `[]` cuando la
  respuesta es `ok` **con cero cubos**; con mas de 62 fechas eso entra en el `throw` y se
  presenta como `TEXTO_ERROR_PANEL`. Es una incoherencia del servidor, no un estado de negocio,
  y presentarla como pixel de error respeta R24 de la 131 (un panel roto no tumba a los demas).
  Ningun requisito de la 182 pide que la excepcion escape del render.

### 4.4 `aging_por_estado` — «pasa a tener cifra total en TODO rango»

**Esa promesa no es del spec: es de la `description` de la ficha en `feature_list.json`, y la
puerta T0 la revirtio con respuesta humana fechada.**

- `requirements.md` hecho 9 (verificado por mi: `PANELES_OPERATIVOS` tiene **seis** paneles y el
  aging no esta) y **Q1 = (B) / D7**: el aging **queda fuera** y sale ficha aparte, porque el
  tope de seis lo defiende un test de latencia y la 131 ya pago por el tirando
  `motivos_devolucion`.
- Comprobado en el codigo: siguen siendo **seis** paneles, no hay `aging_por_estado`, y
  `expect(PANELES_OPERATIVOS.length).toBeLessThanOrEqual(6)` sigue **intacto**
  (`TableroOperativoLatencia.test.tsx:176`).
- La premisa de fondo tambien es falsa: `tests/unit/analytics/agregado-aging.test.ts` (176)
  declara que el aging **nunca** entro en `rango_excedido` y que **nunca** tuvo cifra en ningun
  rango. No era el hueco que esta feature venia a cerrar.
- La ficha sustituta existe y esta dada de alta: **194** (`pending`), con el detalle de que hay
  que decidir dos cosas y no una (presupuesto de latencia, y que pasa con `motivos_devolucion`).
- **Lo unico que queda mal es el registro** (menor 4): la `description` de la ficha 182 sigue
  prometiendo «incluido aging_por_estado» y la retirada de `lunesDeLaSemana`, que Q1 y Q4
  revirtieron.

### 4.5 Los dos commits del leader (`2575fea0`, `e2d4b0e6`) — ¿debilitan la 133?

**No. La afirmacion de R21 sale reforzada, no diluida.** Revisado linea a linea:

- `llamadasAlBorde()` antes recorria **una** puerta y normalizaba `{metricaId, raw,
  desagregacion}`. Ahora recorre **las dos** y anade `puerta` y `grano` a la normalizacion. La
  propiedad que R21 afirma —la **no-diferencia** entre los tres recortes de presentacion— se
  compara sobre un conjunto **estrictamente mayor** de entradas: mas superficie vigilada, no
  menos. Nada de la entrada se descarta.
- El conteo esperado deja de estar tecleado y se **deriva del catalogo**
  (`metricasDelTablero().length + metricasAgregables().length * GRANOS.length`), con
  `metricasAgregables()` usando **el mismo predicado que el panel** (`esUnidadAgregable`): un
  panel nuevo mueve la cifra solo, y el caso no puede quedar midiendo de menos.
- `montar()` espera tambien a los cubos. **Era necesario, no cosmetico**: sin esa espera, la
  foto de `llamadasAlBorde()` se toma con la segunda oleada a medio salir y la comparacion entre
  recortes compara carreras, no consultas. Un verde ahi habria sido azaroso.
- El caso de R19 deniega `tasa_entrega` por **las dos** puertas, con su motivo escrito: denegar
  solo una convertiria el caso en una medida de la precedencia de la 182 (R13) en vez del
  denegado transcrito, que es lo que R19 afirma. Es mantener el caso midiendo lo suyo, no
  relajarlo.
- La retirada de `@sin-superficie` en `lib/actions/analitica-operativa.ts` es **solo comentario**
  (verificado en el diff: no cambia ni una linea de codigo) y la obligaba
  `tests/unit/guards/superficie-de-uso.guardia.test.ts`, que corri y esta verde. La anotacion
  decia que la UI agregaba en el CLIENTE: esta feature **es** su superficie, asi que dejarla
  habria sido conservar una excusa que ya miente.
- `2575fea0` (la unidad en el fixture de `presentacion-etiquetas-mensajero.test.ts`) es mecanico
  y necesario: `unidad` paso a ser obligatoria en `MetricaDePanel` y ese archivo llego con `dev`
  despues de nacer la rama. Lleva `conteo`, la unidad inocua; ese caso mide desagregacion, no
  unidad. No toca ninguna asercion.

---

## 5. Hallazgos

### Mayores (bloqueantes): NINGUNO

### Menores

1. **`tasks.md` T5.4 sigue `[ ]`.** `CHECKPOINTS.md` exige todas las tareas `[x]`. La condicion
   de «hecho» ya se cumple —el `./init.sh` completo lo corrio el leader y su salida esta en
   `impl_182.md` seccion 6.3—, asi que es puro bookkeeping: marcar la casilla citando esa
   seccion antes de pasar la ficha a `done`. No lo hago yo: el reviewer no edita.
2. **Falta la entrada en `progress/history.md`** y la ficha 182 sigue `in_progress` en
   `feature_list.json`. Las dos cosas son del leader, al cerrar.
3. **`lib/actions/analitica-operativa.ts` esta tocado, y `design.md` seccion 1.1 dice que no se
   toca `lib/**`.** El cambio es **solo un comentario** y lo obligaba un guardia, y esta
   razonado en `impl_182.md` seccion 6.2 punto 3 — pero la frontera se amplio **por escrito y
   antes** para los tres tests de la 134 (seccion 1.2) y aqui no se hizo. Recomendacion: una
   linea en `design.md` seccion 1.1 con su motivo, para que la frontera siga siendo leible como
   lo que es.
4. **La `description` de la ficha 182 en `feature_list.json` esta desalineada con la spec
   aprobada**: sigue prometiendo la cifra del aging y la retirada de `lunesDeLaSemana`, que la
   puerta T0 revirtio (Q1 = B, ficha 194; Q4 = A, acotada y vigilada). No es incumplimiento —hay
   respuesta humana fechada—, pero quien lea la ficha sin abrir la spec entendera que falta
   trabajo. Conviene ajustarla al cerrar.
5. **Linea duplicada** en `tests/components/AnaliticaNoSustitucion.test.tsx`: el `beforeEach`
   llama dos veces seguidas a `agregado.mockImplementation(...)` con el mismo cuerpo. Inocuo,
   pero es ruido en un archivo que existe para leerse con lupa.
6. **`_mut.py` y `_mut.sh` quedaron sin trackear en la raiz del worktree** (el arnes de mutacion
   del implementer). No estan en `.gitignore`, asi que un `git add -A` los mete en el PR.
   Borrarlos o ignorarlos antes de pushear.
7. **`agregacion.ts` contiene un byte NUL (U+0000)** como separador de clave dentro de
   `agregarPorSemana` (la linea que compone `clave` a partir de `semana` y `dimension`). **Es
   PREEXISTENTE de la 131** —lo verifique en la base `ae6b65c5`, que tambien lo tiene— y es el
   unico archivo `.ts`/`.tsx` del repo con esa caracteristica. Consecuencia real y medible: git
   trata el archivo como **binario**, y el diff del archivo **central de esta feature** aparece
   como `Bin 14529 -> 22687 bytes`. Es decir: el cambio mas importante de la 182 **no se puede
   revisar por diff** (lo revise leyendo el archivo entero). No bloquea la 182 —no lo introdujo
   ella—, pero merece chore o ficha: un separador imprimible devolveria el archivo a la revision
   normal.
8. **Residuo de R15** (detalle en la seccion 4.1): un segundo llamador de `agregarPorSemana` que
   pasara el literal `"conteo"` sobre datos de otra unidad evadiria las dos capas. Hoy no existe,
   y el unico llamador pasa la unidad **del dato**.

---

## 6. Lo que NO pude verificar

1. **La suite completa y el `lint`.** Los corrio el leader (seccion 6.3) y la instruccion
   explicita era no repetirlos. Tomo su medida como dada: 1015/1017 archivos, 12.596/12.608
   tests, typecheck y lint limpios. Lo que si repeti por mi cuenta: el typecheck y los 15
   archivos de test relevantes (seccion 3).
2. **Los 12 rojos de `busqueda-*`.** No los investigue (instruccion). Su inocencia respecto de
   esta rama si la comprobe, por construccion: el diff no toca busqueda, ni SQL, ni migraciones,
   ni `db/**`.
3. **Las 16 mutaciones re-aplicadas.** No edito codigo; verifique la evidencia documental y la
   plausibilidad estructural de cada fila (seccion 3).
4. **El comportamiento en navegador real** (frontera RSC de Next.js, SWR de verdad). No hay E2E
   —declarado con su motivo— y ningun gate del repo corre `next build`, asi que esa frontera no
   la cubre nadie. Limite conocido del arnes, no hallazgo de la feature.
