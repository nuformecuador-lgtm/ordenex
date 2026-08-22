# Feature 261 — Tasks

> Lee `requirements.md` y `design.md` antes. Cada task lleva su **criterio de hecho**; `[P]` = puede ir
> en paralelo con las de su mismo bloque que no dependan de ella.
>
> **Secuencia entre bloques:** el bloque **BACKEND** va primero. El **FRONTEND** arranca cuando
> `B1`+`B2` estén mergeadas en la rama (necesita los contratos y los textos); el resto del backend
> puede seguir en paralelo a partir de ahí.
>
> ⚠️ **El gate lo corre el leader, no el subagente.** `frontend_dev`/`backend_dev` corren
> `pnpm typecheck`, `pnpm lint` y `pnpm exec vitest related --run <sus archivos>`. Nada más.
>
> ⚠️ **`./init.sh --rapido` SE NIEGA en esta ficha.** El diff toca
> `lib/repositories/CierreDiaRepository.ts` y `cierre` es nombre de dinero. El gate **completo** es
> obligatorio antes del PR. No es una elección.

---

## BLOQUE 0 — Mediciones (antes de nada, y otra vez antes de desplegar)

- [x] **B0.1 — M1 y M2 contra producción, solo lectura (MCP Supabase).** ✅ **HECHA el 2026-08-21.**
  M1: órdenes en `en_reparto` o `ayuda_tienda` con `fecha_reparto > <día CR en curso>`, con su
  mensajero → **2 órdenes, de un solo mensajero, ambas para el 22**. Es lo que firmó P1: **se dejan
  correr, sin backfill** (`design.md` §7.1).
  **Pendiente sólo de trámite:** copiar las dos consultas y sus números a
  `progress/impl_261_backend.md` con la fecha y la hora CR de la corrida — el número **se escribe**,
  no se resume como «son pocas».

- [x] **B0.2 `[P]` — M3' y M4.** ⛔ **BLOQUEADA (2026-08-22): sin acceso a producción.** El
  subagente de backend no tiene el MCP de Supabase entre sus herramientas y `DATABASE_URL` de
  producción es *sensitive*. Las **dos consultas quedan escritas y listas para pegar** en
  `progress/impl_261_backend.md`; las corre el leader.
  M3': distribución horaria de `por_recoger → en_reparto` **de órdenes reservadas a futuro** (30 d).
  M4: anulaciones de gestión (30 d) que cayeron sobre órdenes con reserva futura.
  **Hecho:** números pegados. M3' es **la evidencia que sustituye a la anécdota** en la reversión de
  D5 (§8 del design): su resultado se cita en el texto de la reversión.

- [x] **B0.3 — Re-medir M1 y M2 justo antes de desplegar.** ✅ **2026-08-22, contra produccion por MCP: `M1' = 0`.** Consulta mas ancha que M1 y M2 juntas (`fecha_reparto > hoy_CR`, sin filtrar por estado): conjunto VACIO. No hay ninguna orden heredada que la regla fuese a bloquear al desplegar. **P1 NO se re-abre**: M1 no crecio, bajo de 2 a 0. El motivo de que sea 0 esta dicho entero y no es «el riesgo no existia»: las dos ordenes que M1 conto el 21 (guias 17496963 y 57998428) **llegaron a su dia** — mismo estado, mismo mensajero, `fecha_reparto` de hoy. Eso es **R7 comprobado contra la realidad**: la marca caduco sola sin que nadie escribiera una fila. Son fotos y caducan. ⛔ **Mismo bloqueo
  que B0.2**: la corre el leader con el MCP, con las consultas ya escritas en
  `progress/impl_261_backend.md`.
  **Hecho:** segunda tanda de números pegada, con su hora. ⚠️ **Si M1 creció respecto a las 2
  medidas el 2026-08-21, la decisión P1 se re-abre**: se para y se pregunta antes de desplegar.

---

## BLOQUE BACKEND

### Contratos y textos

- [x] **B1 — Contratos.** (sin dependencias)
  - `IGestionOrdenRepository`: `OrdenGestionRow.fechaReparto: Date | null` (**sin `?`**, ver design
    §4) y `recogerLote(..., diaEnCurso: Date)`.
  - `IMisAsignacionesService`: `now?: Date` en `recogerAsignaciones`, `escogerParaGestion` y
    `gestionar`; `DetalleConflicto.codigo?: "reservada_para_otro_dia"`;
    `MiAsignacionDTO.fechaRepartoISO?: string | null`.
  - `ICierreDiaRepository`: `AnularGestionInput` gana `asignadoAt: Date` y `diaEnCurso: Date`.
  - `ICierreDiaService`: `deshacerGestion(gestionId, actor, now?: Date)`.
  - **Vía de la tienda (P2):** `IOrdenNotaRepository.OrdenParaHilo.fechaReparto: Date | null`;
    `IGestionOrdenRepository.CrearGestionDesdeAyudaInput.diaEnCurso: Date`;
    `IGestionDesdeAyudaService.gestionar(input, actor, now?: Date)`.
  **Hecho:** `pnpm typecheck` señala **todos** los llamadores y fixtures que faltan por actualizar —
  ese rojo es el objetivo de quitar el `?` de `fechaReparto`, no un accidente.

- [x] **B2 `[P]` — Textos, en una sola fuente.** En `lib/utils/dia-reparto-textos.ts`:
  `RESERVA_MOTIVO_SERVIDOR` y `avisoReservaParaOtroDia(fechaISO: string | null | undefined)`.
  Sin siglas, sin nombres de columna, con la **fecha** (design §5.3). `ETIQUETA_PARA_MANANA` **no se
  toca**.
  **Hecho:** el archivo sigue **sin importar `Date` ni `Intl`**; `fechaLegible()` reutilizado, no
  reescrito.

### Las puertas

- [x] **B3 — `findByIdsParaGestion` emite el día.** (dep. B1)
  `GestionOrdenRepository.findByIdsParaGestion`: `fechaReparto: true` en el `select` y en el mapeo.
  **Hecho:** una consulta a Postgres real devuelve el campo poblado (se cubre en B11).

- [x] **B4 — Las tres guardas del servicio.** (dep. B1, B2, B3)
  `MisAsignacionesService`: `now = new Date()` en las tres firmas;
  `diaEnCurso = startOfDayCR(now)` **una vez por llamada**; la guarda va **antes de cualquier
  efecto** (en `gestionar`, junto a la del cierre pendiente, **antes del upload a Storage**).
  Recoger devuelve `conflict` con `detalle[].codigo`; escoger y gestionar devuelven `conflict` con
  `motivo: RESERVA_MOTIVO_SERVIDOR`. Y `listarMisAsignaciones` emite `fechaRepartoISO`.
  **Hecho:** B10 en verde y las mutaciones M-a/M-b/M-c/M-f matan sus tests.

- [x] **B5 — El día en el `WHERE` de la escritura de recoger.** (dep. B1)
  `GestionOrdenRepository.recogerLote`: `AND ("fecha_reparto" IS NULL OR "fecha_reparto" <=
  ${fechaRepartoComoTexto(diaEnCurso)}::date)`. Predicado **copiado** del corte, no reinventado.
  **Hecho:** B11 en verde; M-d y M-e matan sus tests.

### La vía de la tienda (decisión P2 · sección G)

- [x] **B15 — La fila del hilo trae el día.** (dep. B1)
  `OrdenNotaRepository.findOrdenParaHilo`: `fechaReparto: true` en el `select` y en el mapeo.
  **Hecho:** el campo llega poblado a `autorizarSobreHilo`; los otros dos consumidores de esa fila
  (notas y rescate) **no cambian de comportamiento** — sus tests siguen verdes sin tocarlos.

- [x] **B16 — Puerta A de la tienda.** (dep. B1, B2, B15)
  `GestionDesdeAyudaService.gestionar(input, actor, now = new Date())`: paso nuevo **entre el 5 y el
  6** —después de «sin mensajero», **antes** de resolver el catálogo y **antes** de
  `subirEvidenciasCompensadas`—. Devuelve `conflict` con un `MSG_*` nuevo en
  `MENSAJES_GESTION_DESDE_AYUDA`, cuyo texto **sale de `dia-reparto-textos.ts`** (R15), no se
  reescribe ahí.
  **Hecho:** B18 en verde; M-m y M-n matan sus tests. El comentario del paso dice **por qué va antes
  del upload** (mismo motivo que el paso 3 ya escrito: fotos huérfanas por el camino previsible).

- [x] **B17 — Puerta B de la tienda.** (dep. B1)
  `GestionOrdenRepository.crearGestionDesdeAyuda`: `OR: [{ fechaReparto: null }, { fechaReparto: {
  lte: input.diaEnCurso } }]` sumado al `where` del `updateMany` que ya existe.
  **Hecho:** `result.count === 0` → `null` → el servicio **compensa las fotos** y responde
  `conflict`. **No se escribe ningún camino de fallo nuevo: ya existe.** M-o lo mata.

- [x] **B18 — Tests de la vía de la tienda.** (dep. B16, B17)
  - Servicio con dobles (`tests/unit/services/gestion-desde-ayuda-reserva.test.ts`): reservada →
    `conflict`; **`storage.subir` NO se llamó** (R29); reservada **para hoy** → pasa; `null` → pasa;
    dos `now` distintos → dos resultados distintos (R31).
  - Postgres real (`tests/integration/db/gestion-desde-ayuda-dia-reserva.int.test.ts`): con la
    puerta A saltada a propósito en el doble, el `updateMany` **no transiciona** la orden reservada,
    y el servicio **compensa** las evidencias (R30).
  **Hecho:** verde; mismas reglas de no-saltarse que B11/B12 (sin base → `describe.skip` visible;
  con base y sin datos → **revienta**, no retorna).

### El deshacer

- [x] **B6 — El reloj entra por el servicio.** (dep. B1)
  `CierreDiaService.deshacerGestion(gestionId, actor, now = new Date())` calcula `asignadoAt = now` y
  `diaEnCurso = startOfDayCR(now)` y los pasa en `AnularGestionInput`. La Server Action que la llama
  no cambia (pasa el default).
  **Hecho:** dos `now` distintos producen dos días distintos, probado en B10.

- [x] **B7 — El `CASE`, en la sentencia.** (dep. B6)
  `CierreDiaRepository.anularGestionYDevolverAGestion`: el paso 2 pasa de `tx.orden.updateMany` a
  `$queryRaw` con `RETURNING "id"` y el `SET` del design §6.2. **Se retira el import de
  `startOfDayCR`** de ese archivo, y su cabecera se reescribe para explicar la regla nueva
  **conservando el motivo original** («las dos columnas no pueden contar historias distintas») y
  nombrando la excepción.
  **Hecho, cuatro cosas:**
  1. `movida.count === 0` sigue lanzando `NoAnulable` (mismo comportamiento de rollback);
  2. la guardia `fecha-reparto-acompana-asignado-at` **en verde** (design §6.4);
  3. el SQL emitido comprobado con `crearPrismaDeTestConEspia` y el valor de `asignado_at`
     **afirmado sobre la fila persistida**, no razonado sobre el driver;
  4. `CierreDiaRepository.ts` ya **no** contiene `startOfDayCR`.

### La reversión escrita

- [x] **B8 — D5, revertida en sus dos soportes.** (dep. B4)
  - `lib/interfaces/services/IMisAsignacionesService.ts`: el párrafo de D5 se sustituye por la
    reversión con sus **seis piezas** (design §8.1), citando la guía 17496963 y el número de M3'.
  - `specs/246-asignacion-por-dia/requirements.md`: **apéndice fechado** al pie de §D5, con el molde
    del que la 259 le puso a §D10. **El texto original no se toca.**
  - `specs/246-asignacion-por-dia/design.md`: la línea «No se oculta nada y no se bloquea nada
    (R23/R24, decisión D5)» recibe el mismo apéndice, **sin reescribirse**.
  - **R33 — la nota del agujero abierto**, junto a la reversión: hoy **no existe ninguna superficie**
    para corregir el día de reparto de una orden ya asignada; la única salida es un `UPDATE` a mano
    en producción; lo resuelve la **ficha 262**. Riesgo aceptado por el humano el 2026-08-22.
    **No se suaviza el texto** (`design.md` §7.2).
  **Hecho:** `git diff` sobre el spec de la 246 muestra **sólo adiciones**, cero líneas borradas.
  ⚠️ La fecha literal es **2026-08-21** — firmada en P5, y **no cambia** aunque la implementación
  aterrice otro día.

- [x] **B9 — La guardia de la reversión.** (dep. B8, y del F4 para el árbol del portal)
  `tests/unit/guards/d5-revertida.guardia.test.ts`, molde de
  `tests/unit/tablero-dia/d10-revertida.guardia.test.ts`. Cuatro mitades:
  (a) ninguna frase que afirme D5 vigente en el censo (design §8.1) — **con normalización de
  espacios**, porque en JSX las frases están partidas;
  (b) las seis piezas de la reversión están, y el fallo dice **cuál** falta;
  (c) el apéndice del spec de la 246, con fecha, palabra de superseded y puntero a
  `specs/261-dia-reparto-protege`;
  (d) los **testigos verbatim** de §D5 original siguen ahí.
  (e) **R33** — la nota del agujero abierto está, y nombra la **262**.
  Además, una cláusula para **R23**: `db/schema.prisma` sigue declarando
  `fechaReparto DateTime? @map("fecha_reparto") @db.Date` **verbatim** (esta ficha no toca el
  esquema).
  **Hecho:** cada detector es una función pura **con autocomprobación** (un texto que infringe y otro
  que no), y M-j/M-k/M-p la matan.

### Tests del backend

- [x] **B10 — Tests de servicio, con dobles.** (dep. B4, B6)
  `tests/unit/services/mis-asignaciones-reserva-bloquea.test.ts` y
  `tests/unit/services/cierre-dia-deshacer-dia-reparto.test.ts`.
  Cubren: las tres guardas, la **ausencia de efectos** (0 llamadas a `recogerLote`,
  `crearGestionYTransicionar`, `setOrdenEnGestion` y `storage.upload`), el **límite `>` y no `>=`**
  (reservada para HOY no se bloquea), `fechaReparto: null` no bloquea, la caducidad con el reloj
  movido, los KPI idénticos con y sin reserva, y que una orden **ya en `en_reparto`** con día futuro
  queda bloqueada para gestionar (**R27**).
  **Hecho:** verde, y M-a/M-b/M-c/M-f/M-i producen rojo **con nombre**.

- [x] **B11 — Postgres real: la recogida.** (dep. B5)
  `tests/integration/db/recoger-lote-dia-reserva.int.test.ts`, con `_postgres-real.ts`.
  Siembra tres órdenes del mismo mensajero en `por_recoger` —una con `fecha_reparto = mañana`, una
  con `hoy`, una con `NULL`—, llama a `recogerLote` con `diaEnCurso = hoy` y afirma: **sólo dos**
  transicionan, la reservada **sigue en `por_recoger`**, y **no hay fila de historial** para ella.
  **Hecho:** verde con base; `describe.skip` visible sin base; **si `fksDeOrden` devuelve `null` el
  test revienta, no retorna** (un `if (!fks) return;` reporta `passed` sin comprobar nada). Todo
  dentro de `enTransaccionRevertida` y con `serializarEscriturasReales` como primera sentencia.
  M-d y M-e lo matan.

- [x] **B12 — ⚠️ Postgres real: deshacer NO borra la reserva futura.** (dep. B7)
  `tests/integration/db/deshacer-gestion-conserva-reserva.int.test.ts`.
  **Es el test sin el cual el defecto vuelve en el primer refactor.** Tres casos en el mismo archivo:
  1. `fecha_reparto = mañana` → tras deshacer **SIGUE siendo mañana**, y `asignado_at` sí se
     reescribió (si no, un `SET` que no tocara la columna pasaría igual);
  2. `fecha_reparto = ayer` → tras deshacer queda en **hoy**;
  3. `fecha_reparto = NULL` → tras deshacer queda en **hoy**.
  Y una cuarta aserción sobre el caso 1: la fila **no cumple** el predicado del corte
  `(fecha_reparto IS NULL OR fecha_reparto <= diaCerrado)` para el corte de esa misma noche (**R20**).
  **Hecho:** verde; mismas reglas de no-saltarse que B11; M-g y M-h lo matan.

- [x] **B13 — Matar todo con mutaciones.** (dep. B9, B10, B11, B12, B18)
  Las **dieciséis** mutaciones de `design.md` §9.4 (M-a … M-p), una a una.
  **Hecho:** por cada una, el comando y la **salida real** (nombre del test que se puso rojo) pegados
  en `progress/impl_261_backend.md`. ⚠️ Si el arnés de mutaciones dice «todas mueren» sin mostrar una
  corrida por mutación, **no cuenta**: aquí ya reportó 9/9 dos veces sin ejecutar un test.

- [x] **B14 — No-regresión.** (dep. B7)
  - `tests/unit/guards/fecha-reparto-acompana-asignado-at.guardia.test.ts` **en verde** sin tocarla.
  - `tests/unit/services/corte-diario-service.test.ts` y el repo del corte, en verde (**R21**).
  - Revisar `tests/unit/repositories/cierre-dia-repository.test.ts`: usa **dobles** y al pasar el
    paso 2 a SQL crudo **deja de ver** lo que hace el `SET`. Lo que pierda se recupera en B12; lo que
    quede en dobles **no puede seguir afirmando el valor de `fecha_reparto`** (sería una aserción
    contra su propia fuente).
  **Hecho:** los tres puntos verificados y escritos, con la lista de aserciones que se movieron.

---

## BLOQUE FRONTEND

> Arranca con `B1` y `B2` en la rama. No toca `lib/`, `db/` ni `tests/integration/`.

- [x] **F1 — El rechazo al recoger.** (dep. B1, B2)
  `app/(app)/mis-asignaciones/_components/useRecogerPorGuia.ts`: **antes** de llamar a la action, si
  la orden resuelta tiene `esParaManana`, muestra `avisoReservaParaOtroDia(orden.fechaRepartoISO)` y
  devuelve `false` — mismo molde que el rechazo que ya existe («La guía N no está entre tus órdenes
  por recoger»). Y en el `case "conflict"`, si `detalle[0]?.codigo === "reservada_para_otro_dia"`,
  pinta **el mismo texto** en vez del genérico «La orden ya no está por recoger».
  **Hecho:** F5 cubre las dos ramas (la suave y la del servidor).

- [x] **F2 `[P]` — El aviso en la card.** (dep. B1, B2)
  `PosOrderCard.tsx`, `PosOrderCardMosaico.tsx`, `PosOrderCardDetalle.tsx`: bajo el badge
  `ETIQUETA_PARA_MANANA` (que **se queda**), la línea de `avisoReservaParaOtroDia`. Las tres cards
  son **paralelas, no variantes**: la marca va en las tres.
  **Hecho:** el literal **no se escribe en el componente**, se importa (R15).

- [x] **F3 `[P]` — El botón de gestionar, deshabilitado.** (dep. B1, B2)
  `RepartoModule.tsx`, `renderCardEnReparto`: `GestionarOrdenCardButton` suma `orden.esParaManana` a
  su `disabled`, junto a `bloqueado` y «hay otra gestión activa». Y `seleccionar()` la ignora, con la
  misma defensa suave que ya tiene para `bloqueado`.
  **Hecho:** F5 lo cubre; la card sigue montada entera (**R9**).

- [x] **F4 — Purgar del portal las frases que afirman D5 vigente.** (dep. F1, F2, F3)
  `PosOrderCardMosaico.tsx:183-189`, `PosOrderCardDetalle.tsx:115-117`, `PosOrderCard.tsx:197-200` y
  cualquier otra que el censo de B9 encuentre. Se **sustituyen** por la regla nueva, no se borran a
  secas: quien lea el componente tiene que saber por qué el botón está gris.
  **Hecho:** B9 en verde.

- [x] **F5 — Tests de componente.** (dep. F1, F2, F3, F4)
  - `tests/components/PosCardParaManana.test.tsx` (**existe**): sumar que el aviso aparece **con la
    fecha legible** y que la card sigue montada entera.
  - `tests/components/RecogerModule.test.tsx` (**existe**): escanear/teclear una guía reservada
    muestra el aviso y **no llama a la action**; el `conflict` con `codigo` pinta el mismo texto.
  - `tests/components/RepartoModule.test.tsx` (**existe**): el botón «Gestionar» de una orden
    reservada está `disabled` y el aviso está a su lado.
  - `tests/unit/utils/dia-reparto-textos.test.ts` (nuevo si no existe): el módulo **no importa `Date`
    ni `Intl`**; `avisoReservaParaOtroDia` compone la fecha con `fechaLegible`; sin fecha, la frase
    sigue siendo cierta.
  **Hecho:** verde; M-l mata el test de fuente única.

- [x] **F7 `[P]` — La tienda: el rechazo explicado.** (dep. B2, B16)
  `app/(app)/novedades/_components/GestionarDesdeAyudaModal.tsx`: al recibir `conflict` con el
  mensaje nuevo, pintarlo tal cual — el mismo cableado con el que ya pinta
  `MENSAJES_GESTION_DESDE_AYUDA.fueraDeAyuda` (**R32**).
  ⚠️ **NO se deshabilita el botón** y **no se toca `NovedadDTO`**: decisión con su motivo y su número
  en `design.md` §5.4 y alternativa **A13**. Si el implementer siente la tentación de «ya que
  estamos», es alcance nuevo y se pregunta.
  **Hecho:** `tests/components/GestionarDesdeAyudaModal.test.tsx` (**existe**) cubre el caso, leyendo
  el **mismo string** que el servicio.

- [x] **F6 — Ver la app.** (dep. F5, F7) ✅ **2026-08-22, Chromium real contra la app local.** Medido y **autocomprobado**; detalle en `progress/impl_261_frontend.md` §F6.
  Playwright manual en preview con una cuenta de mensajero de QA: una orden reservada en «Por
  recoger» (escanear → mensaje), una reservada en «Reparto» (botón gris + aviso), una de hoy (todo
  funciona), y comprobar que **KPIs y mapa no cambiaron** (R10). Y con una cuenta de **tienda**: una
  orden reservada en «Ayuda solicitada» → el rechazo explicado, con su día (R32).
  **Hecho:** capturas o transcripción en `progress/impl_261_frontend.md`. En este repo mirar la app
  encontró siete textos rotos que doce mil tests daban por buenos.

---

## CIERRE

- [x] **C1 — `./init.sh` COMPLETO en verde.** ✅ Pre-merge: 1.297 archivos / 17.268 tests, `INIT_EXIT=0`. Y **repetido POST-merge por el reviewer** sobre el commit de merge `d6dd96b4` en worktree aislado, con los mismos numeros: es la corrida que `docs/verification.md` exige despues de cada merge a `dev`, y aqui si esta hecha. No hay modo rápido en esta ficha (nombre de dinero).
  **Hecho:** salida pegada, con `INIT_EXIT=$?` **escrito dentro del log** — un `echo` posterior ya
  tapó aquí un gate rojo haciéndolo pasar por «exit code 0».
- [x] **C2 — Pre-vuelo contra `origin/dev`** ✅ Hecho antes del PR #444; mergeado en `d6dd96b4` sin que otra sesion moviera `dev` en medio. justo antes del PR (otra sesión puede haberlo movido).
- [x] **C3 — B0.3 (re-medición) hecha y escrita** ✅ Ver B0.3: `M1' = 0` el 2026-08-22. ⚠️ **PERO ESTA CASILLA TIENE LA FORMA EQUIVOCADA Y HAY QUE DECIRLO**: una medicion que caduca no se cierra marcandola una vez. `M1' = 0` es cierto HOY; en cuanto alguien asigne una orden para manana vuelve a haber heredadas, y el despliegue puede caer en cualquier momento. Lo correcto es que la consulta sea un **paso de la lista de release**, no una casilla de esta ficha. Hoy el repo **no tiene lista de release** donde ponerla: queda propuesto y sin hacer. antes de desplegar a producción. P1 ya está firmada
  («se dejan correr»); lo que la re-medición decide es si **sigue siendo válida**.
- [x] **C4 — La ficha 262 registrada** ✅ Verificado en `feature_list.json` de `origin/dev`: id 262, `pending`, y R33 la nombra. antes de desplegar. Es la contrapartida del riesgo aceptado en
  `design.md` §7.2: mientras no exista, un lote mal marcado no se corrige desde ninguna pantalla. La
  registra el leader; aquí sólo se comprueba que **existe** y que **R33 la nombra**.

---

## Mapa `R<n> → test`

| R | Qué exige | Test |
| --- | --- | --- |
| R1 | No se puede recoger una reservada | B10 `mis-asignaciones-reserva-bloquea` · **B11** (Postgres, el `WHERE`) |
| R2 | No se puede gestionar | B10 |
| R3 | No se puede escoger para gestión | B10 |
| R4 | Rechazo **sin efectos** | B10 (0 llamadas a repo/storage/puntero) · B11 (sin fila de historial) |
| R5 | El rechazo vive en el servidor | **B11** — el `WHERE`, contra Postgres real |
| R6 | Reloj inyectable | B10 (mismo caso, dos `now`, dos resultados) |
| R7 | Caduca sola, sin escribir nada | B10 (reloj movido al día siguiente, misma fila) · B11 |
| R8 | Día ausente → no bloquea | B10 · B11 (caso `NULL` y caso `hoy`) |
| R9 | No oculta ni saca del grupo | B10 (el DTO sigue trayéndola) · F5 `PosCardParaManana` |
| R10 | KPIs y ruta intactos | B10 (KPIs idénticos con y sin reserva) · F6 |
| R11 | Palabras + desde qué día | F5 `PosCardParaManana` · F5 `dia-reparto-textos` |
| R12 | Botón de gestionar deshabilitado | F5 `RepartoModule` |
| R13 | Mensaje real al escanear | F5 `RecogerModule` (rama suave y rama `conflict`) |
| R14 | Sin reloj del navegador | F5 `dia-reparto-textos` (no importa `Date`/`Intl`) |
| R15 | Una sola fuente de texto | F5 `dia-reparto-textos` + B10 (el servidor usa la misma constante) |
| R16 | Las dos columnas, una escritura | B14 (guardia `fecha-reparto-acompana-asignado-at`) · **B12** |
| R17 | **La reserva futura se conserva** | **B12 caso 1** ⚠️ |
| R18 | Día pasado o ausente → hoy | **B12 casos 2 y 3** |
| R19 | Reloj inyectable, no en el repo ni en el motor | B10 `cierre-dia-deshacer-dia-reparto` (22:30 CR → día 21) · `cierre-dia-repository` (el día entra como PARÁMETRO `::date`, sin reloj dentro del SQL) ⚠️ **corregido el 2026-08-22**: este mapa prometía una cláusula de guardia «el repo no nombra `startOfDayCR`» que **no existe** (`grep` = 0). R19 sí está cubierto por los dos tests citados; la cláusula queda **debida**, no dada por hecha. |
| R20 | El corte de esa noche sigue sin barrerla | **B12** (cuarta aserción del caso 1) |
| R21 | El corte no se toca | B14 (`corte-diario-service.test.ts` + repo del corte) |
| R22 | Sin escrituras nuevas del día | B14 (guardia `fecha-reparto-acompana-asignado-at`, censo ≥ 6) |
| R23 | Sin migración | B9 (testigo verbatim de `db/schema.prisma`) |
| R24 | El contrato declara D5 revertida | **B9** mitades (a) y (b) |
| R25 | Apéndice + texto original intacto | **B9** mitades (c) y (d) |
| R26 | La comprobación existe y no es vacía | **B9** autocomprobación · B13 (M-j, M-k) |
| R27 | Alcanza a las heredadas, y están medidas | B10 (orden ya en `en_reparto` con día futuro) · **B0.1** (M1 escrita: 2 órdenes) · B0.3 |
| R28 | La tienda tampoco puede resolver | **B18** servicio (`gestion-desde-ayuda-reserva`) |
| R29 | Rechazo **antes de subir evidencias** | **B18** servicio — aserción «`storage.subir` no se llamó» |
| R30 | También en la escritura, con compensación | **B18** Postgres real (`gestion-desde-ayuda-dia-reserva`) |
| R31 | Mismo criterio y mismo día, inyectable | B18 servicio (dos `now`, dos resultados) |
| R32 | La tienda lee el motivo real, con el día | F7 · `GestionarDesdeAyudaModal.test.tsx` (mismo string que el servicio) |
| R33 | La nota del agujero abierto + puntero a la 262 | **B9** mitad (e) · B13 (M-p) |
