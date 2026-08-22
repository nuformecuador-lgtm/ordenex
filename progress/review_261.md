# Review — Feature 261 · el día de reparto reservado protege del mensajero y de la tienda

> **Veredicto: RECHAZADO** — no por lo que se implementó, sino por lo que falta para poder
> desplegarlo. **Ya está mergeada en `dev`** (PR #444, commit `6ff2cff4`, merge `d6dd96b4`), así que
> un bloqueante aquí **no impide un merge**: se convierte en **ficha de seguimiento** y en una
> **puerta antes de la release a `prod`**. Los dos bloqueantes son tareas del propio `tasks.md` que
> siguen en `[ ]`, no defectos del código.
>
> **Revisado por commit, no por árbol.** El worktree estaba en `fix/263-comprobante-cierre` con otro
> agente escribiendo dentro. Todo lo que se afirma aquí se leyó con `git show 6ff2cff4` /
> `git show origin/dev:<ruta>`, y todo lo que se ejecutó corrió en un **worktree aislado**
> (`R:/w261`, detached en `d6dd96b4`, `node_modules` por junction), ya retirado. **No se tocó
> `cierres-admin/` ni el árbol de la 263.**

---

## Checklist (CHECKPOINTS.md)

### Especificación
- [x] `specs/261-dia-reparto-protege/requirements.md` con EARS numerados **R1-R33**.
- [x] `design.md` con alternativas descartadas y su porqué (**A1-A14**, cada una con motivo medido).
- [ ] ⚠️ `tasks.md` con **todas** las tasks `[x]` → **6 sin marcar**: `B0.3`, `F6`, `C1`, `C2`, `C3`, `C4`.
      De ésas, `C1`, `C2` y `C4` están **hechas de facto** (ver menor m4); `F6` y `B0.3/C3` **no**.

### Trazabilidad
- [x] Cada `R<n>` mapea a **al menos un test concreto**. Se abrieron **los 33**; ninguno vacío.
- [x] El mapa `R<n> -> test` vive en `progress/impl_261_backend.md`, `progress/impl_261_frontend.md`
      y en `tasks.md`. Una entrada del mapa de `tasks.md` está **rancia** (R19, menor m3).

### Calidad de código
- [x] `pnpm test` — **corrido por mí sobre el commit de merge `d6dd96b4`**, en worktree aislado:
      **1.297 archivos · 17.268 tests passed · 26 skipped · `VITEST_EXIT=0`**. Coincide exactamente
      con los números que el leader reportó pre-merge, y además cierra el hueco que
      `docs/verification.md` nombra: **la corrida completa POST-merge sobre `dev`**.
- [x] `typecheck` / `lint` — **no re-ejecutados**; se apoyan en las dos bitácoras, que reportan
      `tsc --noEmit` sin errores y `99 warnings / 0 errors` con **baseline medido con `git stash`**
      (mismo número, el diff no añade ninguno). Se dice, no se da por hecho.
- [~] E2E Playwright — **inaplicable**: este repo no tiene harness E2E ejecutable. Su sustituto es
      **F6 «ver la app»**, y F6 **no se hizo** → bloqueante B1.

### Datos y seguridad
- [x] **Sin tablas nuevas** → nada de RLS que exigir.
- [x] **Sin migración y sin backfill** (R23). Verificado dos veces: el diff no toca `db/migrations/`,
      y la guardia afirma **verbatim** que `db/schema.prisma` sigue con
      `fechaReparto DateTime? @map("fecha_reparto") @db.Date`.
- [x] **Cero secretos**, cero hardcode de contexto nuevo. Los textos no llevan siglas ni nombres de
      columna (regla del «SLA fuera del frontend»).
- [x] Sin webhooks nuevos → firma/idempotencia no aplican.

### Patrón de capas
- [x] **La Server Action no cambia.** `lib/actions/mis-asignaciones.ts` y
      `lib/actions/gestion-desde-ayuda.ts` siguen llamando sin `now` (el default lo pone el
      servicio). El borde sigue siendo actor + zod + delegar.
- [x] **La regla vive en el servicio**; el repositorio **recibe** el día ya resuelto y sólo lo
      serializa. `CierreDiaRepository` **dejó de importar `startOfDayCR`**: ningún repositorio vuelve
      a leer el reloj para decidir un día de reparto.
- [x] Interfaces en `lib/interfaces/`, separadas por categoría.

### Verificación final
- [x] Suite completa en verde sobre `dev` mergeado (arriba).
- [ ] `progress/history.md` **no tiene entrada de la 261** (menor m2).
- [ ] `feature_list.json` sigue con la **261 en `pending`** (menor m1).

---

## Lo que se miró con lupa

### 1 · El mapa `R<n> -> test` es real — los 33, abiertos uno a uno

| R | Qué exige | Test que lo verifica | Comprobado |
| --- | --- | --- | --- |
| R1 | no se recoge una reservada | `mis-asignaciones-reserva-bloquea` («R1: … se rechaza con `conflict` y su codigo») · **`recoger-lote-dia-reserva.int`** | leído · **M-d lo mata** |
| R2 | no se gestiona | `mis-asignaciones-reserva-bloquea` («R2/R27: … YA en `en_reparto` con dia futuro no se gestiona») | leído |
| R3 | no se escoge para gestión | ídem («R3: `conflict` con el motivo de la fuente unica») | leído |
| R4 | rechazo **sin efectos** | ídem («R4: … ni escritura, ni ubicacion, ni puntero» · «R4: … ANTES de subir la evidencia a Storage») · `recoger-lote…int` («R4: … NO deja fila de historial») | leído · **M-d lo mata** |
| R5 | el rechazo vive en el servidor | **`recoger-lote-dia-reserva.int`** — el `WHERE`, contra Postgres | **M-d lo mata** |
| R6 | reloj inyectable | `mis-asignaciones-reserva-bloquea` («el dia que viaja a la ESCRITURA es el del `now` inyectado») | leído |
| R7 | caduca sola, sin escribir nada | ídem («la MISMA fila, con el reloj un dia despues, se recoge») · `PosCardParaManana` («deja de decirlo al llegar el día») | leído |
| R8 | día ausente → no bloquea | ídem (`null`, «HOY», reserva pasada) · `recoger-lote…int` | **M-e lo cubre** |
| R9 | no oculta ni saca del grupo | ídem («sigue viniendo en su grupo») · `PosCardParaManana` · `RecogerModule` · `RepartoModule` | leído |
| R10 | KPIs y ruta intactos | ídem («los KPIs son IDENTICOS con y sin reserva») · `RepartoModule` (conserva su parada de ruta) | leído · la mitad visual es F6 |
| R11 | palabras + desde qué día | `dia-reparto-textos` · `PosCardParaManana` en **las tres cards** (con fecha, sin fecha, y la de hoy que no dice nada) | leído |
| R12 | control de gestionar deshabilitado | `RepartoModule` («DESHABILITADO, y el de la de hoy no» + **mitad positiva**) | **MF-f lo mata** · ver m6 |
| R13 | mensaje real al escanear | `RecogerModule`: rama suave, rama `conflict` con código, «no se disfraza», y la de HOY se recoge | leído |
| R14 | sin reloj del navegador | `dia-reparto-textos` (`soloCodigo` + autocomprobación del stripper) | leído |
| R15 | una sola fuente de texto | `dia-reparto-textos` — **seis superficies importan y ninguna copia**, con detector no-vacío | leído |
| R16 | las dos columnas, una escritura | `deshacer-gestion-conserva-reserva.int` («`asignado_at` SI se reescribio») · guardia 246/R10 | **corrida verde** |
| **R17** | **la reserva futura se conserva** | **`deshacer-gestion-conserva-reserva.int` caso 1** | **M-g lo mata** |
| R18 | día pasado o ausente → hoy | ídem, casos AYER / `NULL` / frontera HOY | leído |
| R19 | reloj inyectable, no en el repo ni en el motor | `cierre-dia-deshacer-dia-reparto` (22:30 CR → día 21) · `cierre-dia-repository` («el dia entra como PARAMETRO `::date`, sin reloj dentro del SQL») | **el mapa de `tasks.md` cita mal la fuente**, ver m3 |
| R20 | el corte de esa noche no la barre | `deshacer-gestion-conserva-reserva.int` (4.ª aserción del caso 1, con el predicado REAL del corte) | **M-g lo mata** |
| R21 | el corte no se toca | `corte-diario-service.test.ts` | **corrido: verde** |
| R22 | sin escrituras nuevas del día | `fecha-reparto-acompana-asignado-at.guardia` | **corrido: verde, sin tocarla** |
| R23 | sin migración | `d5-revertida.guardia` (testigo verbatim de `schema.prisma`) | leído |
| R24 | el contrato declara D5 revertida | `d5-revertida.guardia` (a) + (b), seis piezas exigidas por separado | leído |
| R25 | apéndice + texto original intacto | ídem (c) + (d), **testigos verbatim** | `git show --numstat` sobre la 246: **14/0 y 11/0, cero líneas borradas** |
| R26 | la comprobación existe y no es vacía | ídem, **autocomprobación por detector** (marca y no-marca) | leído |
| R27 | alcanza a las heredadas, y están medidas | `mis-asignaciones-reserva-bloquea` («YA en `en_reparto` con dia futuro») · **B0.1** (M1 = 2 órdenes) | ⚠️ la medición **caduca** → bloqueante B2 |
| R28 | la tienda tampoco resuelve | `gestion-desde-ayuda-reserva` («`conflict`, no `forbidden`») | leído |
| R29 | rechazo **antes de subir evidencias** | ídem («`storage.upload` NO se llamo» + «tampoco se resuelve el catalogo») | **M-n lo mata** |
| R30 | también en la escritura, con compensación | **`gestion-desde-ayuda-dia-reserva.int`** (+ mitad positiva + frontera `lte` + no-regresión de la guarda vieja) | **M-o lo mata** |
| R31 | mismo criterio y mismo día, inyectable | `gestion-desde-ayuda-reserva` (dos `now`; helper `@db.Date` y no el día UTC) | leído |
| R32 | la tienda lee el motivo real, con el día | `NovedadesModule` · `GestionarDesdeAyudaModal` | leído |
| R33 | nota del agujero + puntero a la 262 | `d5-revertida.guardia` (e), con autocomprobación de que «sólo el número» no cuela | leído |

**Ningún `R<n>` quedó sin test, y ninguno con un test que pasaría igual sin el código** en las capas
que se comprobaron con mutación. Los tests contra Postgres **no se saltan en silencio**: sin base
hay `describe.skip` a nivel de archivo, y con base pero sin catálogo **revientan** con mensaje —
comprobado leyendo el `beforeAll`, no hay ningún `if (!fks) return;`.

### 2 · Las mutaciones: **cinco reproducidas a mano, cinco coinciden**

No se dieron por buenas. En worktree aislado, cada una: parche → `git diff --stat` que demuestra que
el archivo cambió → corrida → restauración verificada.

| # | Mutación | Rojo que produjo **en mi corrida** | ¿Coincide con la bitácora? |
| --- | --- | --- | --- |
| **M-g** | el `CASE` sustituido por el parámetro del día a secas (**el defecto original**) | `2 failed / 6 passed (8)` — «R17: … SIGUE siendo mañana» y «R20: NO cumple el predicado del corte»: expected 1 to be +0 | **Sí**, mismos tests |
| **M-d** | fuera el `AND ("fecha_reparto" …)` del `WHERE` de `recogerLote` | `4 failed / 3 passed (7)` — «transicionan TRES», «NO deja fila de historial», «sigue en por_recoger», «pidiendo SOLO la reservada» | **Sí**, mismo recuento |
| **M-o** | fuera el `OR` del `where` de `crearGestionDesdeAyuda` | `1 failed / 4 passed (5)` — «R30: con la puerta A saltada, el updateMany NO transiciona»: expected ok to be conflict | **Sí** (la bitácora reporta 2/22 porque corrió un conjunto más ancho) |
| **M-n** | la guarda de la tienda **después** del upload | `2 failed / 9 passed (11)` — «storage.upload NO se llamo…»: called 2 times, y «tampoco se resuelve el catalogo» | **Sí**, recuento exacto |
| **MF-f** | fuera `esParaManana` del `disabled` del botón | `1 failed / 87 passed (88)` — «R12: el botón Gestionar de la reservada está DESHABILITADO…» | **Sí**, recuento exacto |

Las **21 restantes** (17 backend + 9 frontend, menos las 5 de arriba) **no se re-ejecutaron**; se dan
por plausibles porque las cinco que sí se reprodujeron salieron **idénticas** a lo escrito, incluido
el recuento, y porque el arnés declara autocomprobación (revienta si el patrón no aparece, compara
con la copia previa y no con `git`). **No es lo mismo que haberlas visto**: queda dicho.

### 3 · El caso (3), el que no estaba en el reporte — **existe y es el bueno**

`tests/integration/db/deshacer-gestion-conserva-reserva.int.test.ts`, contra Postgres real:

- **Siembra** una orden `entregada` con `fecha_reparto = MAÑANA`, con `asignado_at` **viejo y
  distinguible**, y su gestión vigente.
- **Deshace** la gestión con `diaEnCurso = HOY` y `NOW = 22:30 CR del 21` (= `04:30Z del 22`, elegido
  a propósito para que el día UTC y el de CR **no** coincidan).
- **Afirma que la fecha SIGUE siendo la futura** — y, en un caso aparte, **que `asignado_at` sí se
  reescribió**: sin esa mitad, un `SET` que no tocara la columna pasaría igual.
- **Y la mitad negativa**: `AYER` → hoy, `NULL` → hoy, `HOY` → hoy (la frontera es `>` y no `>=`).
- **Y R20 como consecuencia**: la fila **no** cumple el predicado real del corte.
- Todo dentro de `enTransaccionRevertida`, con `serializarEscriturasReales` como primera sentencia.

**El comentario original se CONSERVA, no se sustituye.** En `CierreDiaRepository.ts` sigue, con su
razonamiento entero: «las dos columnas no pueden contar historias distintas. Si `asignado_at` dijera
“te la acabo de reasignar” y `fecha_reparto` conservara la reserva de AYER, el corte de esta misma
noche la protegería o la barrería según un dato que ya no describe nada» — y **debajo** se añade lo
que aquel razonamiento no contempló (la reserva a FUTURO), con la regla nueva y su excepción
nombrada. Es exactamente lo que se pedía: se le anexa, no se le pisa.

### 4 · La vía de la tienda — **las dos capas están, y en el orden correcto**

- **Antes de subir evidencia (R29):** el paso **5-bis** vive en la línea 138 del servicio; el
  `subirEvidenciasCompensadas` en la 188 y la resolución del catálogo en la 169. O sea: la guarda va
  **antes del upload y antes del catálogo**. No es una lectura del comentario: **M-n lo demuestra** —
  al mover la guarda detrás del upload, el test canta «called 2 times».
- **Re-comprobación al escribir, con retirada de fotos (R30):** el `OR` de `fechaReparto` entra en el
  `where` del `updateMany` que ya existía → `count === 0` → `null` → el servicio **compensa**. El
  test contra Postgres lo afirma con números, no con intención: **2 subidas**, **1 llamada de
  retirada con 2 paths**, **0 gestiones**, **0 filas de historial**, estatus intacto. Y trae **mitad
  positiva** («sin reserva, la MISMA llamada SÍ transiciona») y **no-regresión** («si la orden ya
  salió de ayuda, tampoco se escribe»), que es lo que impide que el `where` se reescriba en vez de
  ampliarse.
- **No reutiliza el servicio del mensajero**, y está argumentado (A11): aquel método tiene cuatro
  candados que esta vía no pasa. Correcto.

### 5 · Los dos tests invertidos — **con la misma exigencia, no aflojados**

- `RecogerModule`: «R24: la orden reservada SE PUEDE RECOGER — la Server Action se llama con su id»
  → sustituido por «R13: teclear una guía reservada muestra el MOTIVO REAL y NO llama a la action»,
  que afirma que el mock de la action **no** se llamó **y** que tampoco hubo refresh. No es «no
  aparece un error» —que estaría verde también si no pasara nada—: es la ausencia de la llamada.
- `RepartoModule`: «R24: la reservada SE PUEDE GESTIONAR — escogerParaGestion sí se llama» →
  sustituido por el `disabled` **con su mitad positiva** («sin reserva ese mismo botón está
  habilitado», sin la cual un `disabled` puesto a true a secas pasaría) y por «y por el panel
  tampoco», que afirma el mock sin llamar **y** el caso simétrico con la orden de hoy.
- Bonus real: el comentario de `PosCardParaManana.test.tsx` que repetía D5 como vigente **no lo
  habría cazado ningún detector** (`tests/` no está en el censo de la guardia). Se corrigió leyendo.

### 6 · La reversión de D5 — **guardia bidireccional, como la 259 con D10**

- **Dirección 1 (que la marca esté):** seis piezas exigidas **por separado** para que el fallo diga
  **cuál** falta — nombre (D5), fecha de adopción (2026-08-20), fecha de reversión (2026-08-21),
  palabra de superseded, motivo y puntero. Y el motivo exige **M3 y la guía 17496963 CERCA**: hay un
  caso que demuestra que dos menciones lejanas **no cuelan**.
- **Dirección 2 (que el original no se toque):** cuatro **testigos verbatim** de §D5, con
  autocomprobación que reescribe el original a propósito y comprueba que el testigo lo caza.
- **Censo (a)** recorre `app/(app)/mis-asignaciones/**` **entero**, con **normalización de espacios**
  —justificada con una frase partida en JSX tal como estaba escrita de verdad—.
- Búsqueda independiente por todo el árbol: **no queda ninguna frase que afirme D5 como vigente**.
  Las que aparecen viven en la propia guardia (como patrones de detección) o citadas en pasado
  («Hasta el 2026-08-21 … decía»), que es lo correcto.
- `git show --numstat` sobre la 246: `14 0` y `11 0`. **Cero líneas borradas.**

### 7 · R33 / la ficha 262

- La nota vive **en el código**, en `IMisAsignacionesService.ts`, junto a la reversión: «hoy NO
  EXISTE NINGUNA SUPERFICIE para corregir el dia de reparto de una orden ya asignada … la unica
  salida es un UPDATE a mano en produccion … Lo resuelve la ficha 262». **No está suavizada.**
- La guardia (e) exige **cuatro piezas** y su autocomprobación demuestra que «pendiente: ver la ficha
  262» **no basta**.
- **La 262 existe**: está registrada en `feature_list.json` (262 · pending · fullstack · sdd:true ·
  «corregir el dia de reparto de una orden ya asignada»). C4 se cumple **de facto** aunque su casilla
  siga en `[ ]`. Aún no tiene `specs/262-*`, que es lo esperable en `pending`.
- Límite honesto: la guardia comprueba que **el código nombre la 262**, no que **la 262 siga en el
  backlog**. Si alguien la borrara de `feature_list.json`, nada se pondría rojo.

### 8 · F6 «ver la app» — CERRADA durante esta review, y **re-medida por mí**

Durante la revisión el leader cerró F6 y pasó los números. **No se dieron por buenos**: escribí una
sonda propia (`rev-f6.mjs`, Playwright + Chromium real contra el dev local), que **no reusa** su
script, y mide el nodo por lo que es —`p[role="note"]` cuyo texto contiene la frase real de la fuente
única— en vez de por una regex inventada.

**Mis números, independientes:**

| ancho | caja | líneas | recorte | palabra más larga | ¿rompe? |
| --- | --- | --- | --- | --- | --- |
| 320 px | 244x50 | 3 | no | «gestionarla.» = 67 px vs 244 de caja | no |
| 390 px | 314x33 | 2 | no | 67 px vs 314 | no |

**Coinciden exactamente** con los del leader (mismas cajas, mismas líneas, misma palabra, mismo
ancho). Y `text-overflow` es `clip`, no `ellipsis`: no hay truncado escondido detrás de unos puntos
suspensivos. **El riesgo que el frontend dejó declarado —«el aviso es la frase más larga de la
tarjeta en mosaico y ningún test mide ancho ni truncado»— queda MEDIDO Y MUERTO.**

**Y la autocomprobación existe, que es lo que hace que el verde valga.** Leí su script: estrangula el
propio nodo en vivo —ancho 40 px y alto 10 px con `overflow:hidden`— y exige que los dos detectores
se pongan en `true`. Sin eso, «no hay recorte» podría ser «el detector no sabe detectar».

**Dos precisiones que el informe no daba y conviene fijar:**
- Los avisos renderizados son **tres**, no dos: las dos cards en mosaico de las órdenes reservadas
  **más** la del panel de detalle. Consistente, no es un defecto.
- Los botones «Gestionar» deshabilitados que veo son **más de dos**, porque la regla previa
  (`ordenEnGestionId`, «la que YA está en el panel») también apaga alguno. La correspondencia exacta
  «deshabilitado ⇔ reservada» la fija el test de componente, con su mitad positiva, y **MF-f la mata**.
  No hay contradicción; sólo conviene no leer el conteo bruto como si fuera la aserción.

**Lo que de F6 sigue sin mirarse** (ver menor m10): el rechazo del **escáner** (R13), que **KPIs y
mapa no cambiaron** (R10) y **la superficie de la tienda** (R32). Y corrió contra el **dev local**,
no contra un preview.

### 9 · B0.3 / M1 — re-medida contra producción durante esta review

El leader re-corrió la medición hoy, 2026-08-22, con el MCP de Supabase, sólo `SELECT`: **M1 prima =
0**. Órdenes con `fecha_reparto > (now() AT TIME ZONE 'America/Costa_Rica')::date`, **sin filtrar por
estado** — o sea, un conjunto **más ancho** que M1 (que filtraba `en_reparto`/`ayuda_tienda`) y que
M2 (`por_recoger`) juntos: un cero ahí implica cero en las dos. La medición es conservadora en la
dirección correcta.

**Y trae de regalo la comprobación contra la realidad de dos requisitos.** Las dos órdenes que M1
contó ayer llegaron a su día y siguen vivas: guías **17496963** y **57998428**, `fecha_reparto`
2026-08-22, ambas en `en_reparto`, mismo mensajero. Eso es **R20** (el corte nocturno no barrió una
reserva futura) y **R7** (la marca caducó sola al llegar el día, **sin que nadie escribiera una fila**
para desactivarla) comprobados contra producción, no contra un doble. *(El leader lo atribuyó a
«R20 y R25»; R25 es el apéndice del spec de la 246 — lo que estas dos guías demuestran es R7.)*

**Lo que este cero cierra y lo que no.** Cierra la pregunta operativa de B0.3: *si la release sale
hoy, no hay ninguna orden heredada que se quede bloqueada de golpe*. **No** cierra R27 para siempre:
en cuanto bodega asigne una orden para mañana vuelve a haberlas, y el número caduca otra vez — que es
justo lo que acaba de pasarle al de ayer. Ver menor m9.

**Límite de esta review:** este número **no lo pude reproducir**. No tengo el MCP de Supabase y la
`DATABASE_URL` de producción es *sensitive*. Lo doy por bueno porque la consulta es coherente, es más
ancha que la que R27 pedía y encaja con las dos guías que sí se pueden nombrar — pero **es la
medición del leader, no la mía**, y así queda escrito.

---

## Hallazgos

### Bloqueantes: NINGUNO al cierre de esta review

Se abrieron **dos** y **los dos se cerraron durante la revisión**, con medición:

| # | Bloqueante abierto | Cómo se cerró | ¿Verificado por mí? |
| --- | --- | --- | --- |
| **B1** | `F6` «ver la app»: el aviso es la frase más larga de la card en mosaico y ningún test mide ancho ni truncado | Medido en Chromium a 5 anchos, sin recorte y sin palabra partida, con **autocomprobación** que demuestra que los detectores saben ponerse rojos | **Sí** — sonda propia, números idénticos (§8) |
| **B2** | `B0.3`/`C3`: M1 y M2 caducadas; R27 exige el número medido **antes** del despliegue | Re-medidas hoy contra producción: **0**, con consulta más ancha que M1 y M2 juntas | **No** — sin MCP ni credencial de prod (§9) |

### Condición para pasar la ficha a `done` (trámite, no trabajo)

**Las dos mediciones viven hoy sólo en el chat, y en este repo lo que sólo vive en el chat no
existe** (CLAUDE.md, regla 3: *estado en disco, no en el chat*). Antes de cerrar:

1. Pegar F6 en `progress/impl_261_frontend.md`: la tabla de los cinco anchos, la autocomprobación y
   las tres sondas equivocadas que la precedieron —**esas tres importan**: son la prueba de que el
   detector se afinó hasta medir lo que decía medir, y quien relea esto dentro de seis meses tiene
   que poder juzgarlo en vez de creerlo.
2. Pegar B0.3 en `progress/impl_261_backend.md`: la consulta, el `0`, la hora CR y las dos guías que
   llegaron a su día.
3. Marcar `B0.3`, `F6`, `C1`, `C2`, `C3` y `C4` en `tasks.md`, y pegar en `C1` la salida del gate con
   `INIT_EXIT` **escrito dentro** del log, como la propia task exige.

### Menores

- **m1 · `feature_list.json` miente sobre el estado.** La 261 sigue en `"status": "pending"`, y su
  `title` y su `description` describen el defecto **como si siguiera vivo** («se puede recoger y
  gestionar hoy…»). El código dice lo contrario desde `d6dd96b4`. Es el desfase que infla el backlog.
  **Arreglo:** actualizar estado y reescribir el `title` a lo que la ficha **hace**, no a lo que
  arreglaba.
- **m2 · Sin rastro en la bitácora viva.** `progress/current.md` sigue anclado en «AL DÍA —
  2026-08-21» con la 258 en vuelo y **no menciona la 261**; `progress/history.md` **no tiene
  entrada**, que CHECKPOINTS pide explícitamente.
- **m3 · Una entrada del mapa de `tasks.md` está rancia.** Para **R19** cita «B9 (cláusula: el repo
  no nombra `startOfDayCR`)» — **esa cláusula no existe** en `d5-revertida.guardia.test.ts` (grep = 0
  coincidencias). R19 **sí** está cubierto, por `cierre-dia-deshacer-dia-reparto.test.ts` y por
  `cierre-dia-repository.test.ts` («261/R19: el dia entra como PARAMETRO YYYY-MM-DD::date, sin reloj
  dentro del SQL»), que es lo que el mapa del backend dice bien. **Efecto real:** que
  `CierreDiaRepository` no vuelva a importar `startOfDayCR` está protegido **sólo por un comentario**.
  O se escribe la cláusula, o se corrige el mapa. Lo que no puede quedarse es el mapa prometiendo una
  guardia que no está.
- **m4 · Casillas sin marcar que sí están hechas.** Ver la condición de arriba.
- **m5 · Comentario que no cuadra con su código.** `d5-revertida.guardia.test.ts:340` dice «hay siete
  frases» y el `expect` de la línea siguiente es `toHaveLength(6)`.
- **m6 · R12 se cumple en el control que el design nombró, no en todos.**
  `GestionarOrdenCardButton` queda `disabled`; el botón «Gestionar» del **panel de detalle**
  (`GestionarOrdenPanel`) sigue **habilitado**, con guarda suave en el llamador. Está **declarado**
  con su motivo («alcance nuevo se pregunta») y **tiene test y mutación propios** (MF-g), así que no
  es un descuido — pero R12 habla de «el control que llevaría a gestionarla» y hay dos.
- **m7 · La carrera perdida de gestionar sigue diciendo lo que no es.** Si la lista del cliente es
  vieja y es **el servidor** quien rechaza `escogerParaGestion` por reserva, `RepartoModule` pinta
  «Ya tienes otra orden activa en gestión.» — falso, y manda a buscar un problema que no existe. El
  motivo es que el `conflict` de escoger **no lleva `codigo`**: ese campo sólo existe en el
  `DetalleConflicto` de recoger. Es la misma clase de rechazo disfrazado que R13 prohíbe para el
  escáner (R13 no cubre esta vía) y es **exactamente el síntoma** que motivó la guarda suave del
  panel — sólo que la guarda tapa el caso previsible, no la carrera. Probabilidad baja, arreglo
  pequeño: extender el `codigo` al resultado de escoger.
- **m8 · La 262 aún no tiene spec.** Esperable en `pending`, y C4 sólo pedía que **existiera**. Se
  anota porque el agujero que la 261 abre **no se cierra hasta que la 262 aterrice**, y mientras
  tanto la única salida sigue siendo un UPDATE a mano en producción.
- **m9 · R27 se apoya en un número con fecha de caducidad, y acaba de caducar una vez.** El propio
  leader lo señala y tiene razón: `0` **hoy** no es «ya no hace falta». En cuanto alguien asigne para
  mañana vuelve a haber heredadas, y la release puede caer cualquier día. **Lo duradero no es el
  número: es la consulta.** Ya está escrita en `progress/impl_261_backend.md`; lo que falta es que
  re-correrla sea un **paso de la lista de release**, no una casilla de esta ficha que se marca una
  vez y desaparece. Sugerencia concreta: moverla a donde viva el procedimiento de release, con la
  regla ya escrita —**si M1 crece respecto a la última foto, P1 se re-abre y se pregunta**—.
- **m10 · De F6 se midió el riesgo declarado, no la lista entera.** Quedan sin mirar en la app: el
  rechazo del **escáner** con su día (R13), que **KPIs y mapa no cambiaron** (R10) y la superficie de
  **la tienda** (R32). Y corrió contra el **dev local**, no contra un preview — para medir layout es
  un sustituto razonable (mismos componentes, mismo CSS), pero no es lo que F6 pedía. **No bloquea**:
  los tres tienen test de componente con aserciones reales (no «no aparece un error»), y ninguno
  arrastra un riesgo declarado sin medir como sí lo tenía el aviso en mosaico. Se anota para que la
  próxima pasada por preview los recoja.

---

## Lo que este review NO comprobó (dicho, no escondido)

1. **21 de las 26 mutaciones** no se re-ejecutaron (ver §2). Las cinco que sí, coincidieron exactas.
2. **`typecheck` y `lint`** no se re-corrieron; se apoyan en las bitácoras, que sí traen baseline
   medido con `git stash`.
3. **`./init.sh` como script** no se ejecutó: se ejecutó **su núcleo**, la suite completa, sobre el
   commit de merge. El árbol de trabajo estaba mutado por otro agente (ficha 263) y un gate que lee
   un árbol ajeno no vale nada.
4. **M1 prima = 0 contra producción**: es la medición del leader. Sin MCP ni credencial, no la pude
   reproducir (§9).
5. **Tres superficies de F6** (escáner, KPIs/mapa, tienda) y el preview (§8, m10).

---

## Veredicto

**APROBADO.** No queda ningún bloqueante.

**Lo que sostiene el APROBADO, y no es la palabra de nadie:**

- **Los 33 requisitos mapean a un test que existe, corresponde y no pasaría igual sin el código.** Se
  abrieron los 33.
- **Cinco mutaciones reproducidas a mano** —incluidas las tres que cubren el dinero y el corte:
  el `CASE` del deshacer, el `WHERE` de recoger y el `where` de la escritura de la tienda— y **las
  cinco dieron el rojo que la bitácora decía**, con el mismo recuento y el mismo nombre de test.
- **La suite completa sobre el commit de merge, corrida por mí**: 1.297 archivos, 17.268 tests, exit
  0. Eso además cierra el hueco que `docs/verification.md` nombra como el que más duele: la corrida
  completa **post-merge** sobre `dev`.
- **El caso (3) tiene su test**, con las dos mitades y con R20 como consecuencia; y el comentario
  original —«las dos columnas no pueden contar historias distintas»— **se conserva y se le anexa**,
  no se le pisa.
- **La vía de la tienda está entera**: rechazo **antes** del upload (demostrado moviendo la guarda) y
  re-comprobación en la escritura con **retirada de las fotos** (demostrado contra Postgres, con
  números: 2 subidas, 1 retirada de 2 paths, 0 gestiones, 0 historial).
- **La reversión de D5 está vigilada en las dos direcciones**, con testigos verbatim y detectores que
  se autocomprueban; el spec de la 246 recibió **14 y 11 líneas, cero borradas**.
- **F6 re-medida por mí**, con números idénticos a los del leader y con la autocomprobación que hace
  que el verde signifique algo.
- **R7 y R20 comprobados contra producción**, no contra un doble: las dos órdenes reservadas llegaron
  a su día, el corte no se las llevó y la marca caducó sola sin escribir una fila.

**Lo que queda antes de dar la ficha por cerrada** — trámite, no trabajo: escribir en `progress/` las
dos mediciones que hoy sólo viven en el chat y marcar las seis casillas de `tasks.md`. Y de los
menores, el único que merece decisión propia es **m9** (que la re-medición de R27 sea un paso de la
lista de release y no una casilla que se marca una vez) y **m3** (o se escribe la cláusula de la
guardia que el mapa promete, o se corrige el mapa).

**Ninguno de los hallazgos pide una reversión, un hotfix ni parar la release.**

*Review hecha el 2026-08-22 sobre `6ff2cff4` / merge `d6dd96b4`, en worktree aislado ya retirado, más
una sonda propia contra el dev local. Cero cambios en el árbol de trabajo, cero contacto con
`cierres-admin/`.*
