# Feature 271 — Tareas

> Lee antes `requirements.md` y `design.md`. Aquí no se decide nada: se ejecuta lo decidido allí.
> Zona `fullstack` → **backend primero, frontend después** (`AGENTS.md`).
> `[P]` = puede ir en paralelo con las tareas marcadas igual **dentro de su tanda**.

> ---
>
> ## MARCADO — 2026-08-23, tras la revisión (`progress/review_271.md`, hallazgo **B1**)
>
> Las 58 casillas estuvieron **abiertas** hasta hoy sobre una ficha ya implementada entera, y eso es
> lo que `CHECKPOINTS.md` no admite. Se han marcado leyendo **las tres bitácoras**
> (`progress/impl_271.md`, `impl_271_r42.md`, `impl_271_cobertura.md`) y comprobando el árbol
> —`grep`, y en tres casos ejecutando el test—, **no por simetría**.
>
> **55 hechas · 3 NO hechas.** Cada tarea cuyo desenlace no es el literal de su «Hecho cuando»
> lleva una línea **Desenlace** con lo que pasó de verdad y dónde consta. Las tres abiertas
> —**T3.5** (el coste del corte, sin medir), **T8.3** (los tres specs ajenos, sin nota de caducidad)
> y **T10.3** (los casos del corte, sin sembrar contra Postgres)— se quedan en `[ ]` **a propósito**:
> marcarlas sería exactamente el fallo mudo que esta ficha vino a cerrar. **T3.5** consta declarada
> en la bitácora; **T8.3** y **T10.3** no constaban en ninguna y se midieron hoy.
>
> ---
>
> ## CIERRE DE LAS TRES — 2026-08-23, misma tarde
>
> **58 hechas · 0 abiertas.** **T8.3** y **T10.3** se **hicieron**: nota de caducidad en los tres
> specs ajenos (sin tocar una línea original) y la corrida del corte sembrada contra Postgres, con
> sus dos mutaciones ejecutadas. **T3.5** se cierra **DECLARADA SIN MEDIR por decisión humana**, con
> la razón escrita en su fila: el universo del corte sigue siendo «los que tienen actividad» —dos o
> tres por noche— y un banco de ~50 mediría un escenario que no existe.
>
> ⚠️ **T10.3 destapó un hallazgo que no estaba en ninguna parte: R17 es FALSO.** Dos `vencido` a la
> vez **sí** es alcanzable, por la reserva de día de la feature 246 y la corrección de día de la 262.
> Está medido en el caso 4 del archivo nuevo y detallado en la fila de T10.3. **No se corrigió
> código: la decisión es del humano.**

---

## DOS AVISOS DEL PROYECTO QUE MANDAN SOBRE TODA ESTA LISTA

### AVISO 1 — Los tests de servicio usan dobles y **no ven el SQL**

Todo requisito que **sea un `WHERE`** necesita un test de **integración contra Postgres con datos
sembrados**, y ese test necesita **contraprueba por mutación**: se rompe el `WHERE` a mano, se
comprueba que el test **muere**, y se deshace.

**En esta ficha son un `WHERE`:** el conteo N/V (**R1–R8**), el orden «más viejo primero» (**R11**,
**R18**), el `where` con `id` de la re-solicitud (**R19**), la selección del corte (**R21–R24**), la
liberación acotada al cierre (**R35**) y **la derivación de la jornada** (**R57**), que además lleva
**conversión de zona horaria** — el defecto medido era justo de un día. Un test de servicio con un doble que devuelve
`new Set(["m1"])` **no sabe qué estado tiene el cierre**: afirma «bloqueado» porque se lo han dicho.
Este repo ya midió **cuatro veces** que una mutación de un `WHERE` sobrevive en verde por arriba.

**Y no basta con que el test exista.** Un test de integración que empieza con `if (!fks) return;`
reporta `passed` sin comprobar nada. Sin base alcanzable se **salta** (`describe.skip`), nunca se
pasa en verde. Patrón a copiar: `tests/integration/db/cierre-sin-gestion-sql-real.test.ts`.

### AVISO 2 — Un texto de UI comparado contra la función que lo genera está **siempre verde**

Los literales de §10.2 del diseño se afirman **escritos a mano y completos** en el test. **Nunca**
`expect(pantalla).toHaveTextContent(avisoBloqueo(detalle))`: eso pasa aunque la función devuelva
basura. Ya se hace a propósito en `tests/components/CierreDiaModule.test.tsx:565` y
`RepartoModule.test.tsx:1142`; se conserva ese criterio.

### Recordatorio de gate

- `./init.sh --rapido` para abrir PR.
- **El modo rápido se niega solo** cuando el diff toca migraciones. **Esta ficha toca una** (T6.1) →
  `./init.sh` **completo** es obligatorio antes de release, y tras mergear a `dev`.

---

## T0 — La puerta

- [x] **T0.1 — NO EMPEZAR sin aprobación humana del spec.**
  **Desenlace:** HECHA. La ficha esta `in_progress` en `feature_list.json` y la unica pregunta que quedaba abierta —`Q6`, el texto de los avisos— la respondio el humano el 2026-08-23; sus literales estan implementados y afirmados a mano (`impl_271.md` §FIX 1-3 y §«la cuarta rama»).
  **Hecho cuando:** el humano responde «aprobado» y el estado de la ficha pasa a `spec_ready` →
  `in_progress`. Queda **una** pregunta abierta —**`Q6`, el texto exacto de los cinco avisos**, en
  revisión con el humano— y **ningún supuesto del autor**: `S0`–`S9` son decisiones humanas.
  `Q6` sólo bloquea **T9.2** (los literales como contrato de test), no el backend.
  **Bloquea:** todo.

---

## Tanda 1 — El predicado *(backend, sin ella no se mueve nada)*

- [x] **T1.1 — `lib/utils/bloqueo-cierre.ts`: helper puro con la regla.**
  `ConteoCierresAbiertos`, `estaBloqueadoPorCierres`, `CIERRE_ESTADOS_ABIERTOS`,
  `CIERRE_ESTADOS_RESOLICITABLES` (diseño §2.1). Sin Prisma, sin borde.
  **Hecho cuando:** un test de tabla cubre **las 7 filas** de la tabla de verdad de
  `requirements.md`, cada fila con su `it` nombrado por el caso, y el módulo no importa nada de
  `@prisma/client`. → **R2, R3, R4, R5, R6, R7, R8**

- [x] **T1.2 — Transformar `findMensajerosConCierreAbierto` en `contarCierresAbiertosPorMensajero`.**
  `OrdenRepository.ts:3224`: de `private` + `Set<string>` a público + `Map<string, ConteoCierresAbiertos>`,
  con **un solo `groupBy`** sobre `(mensajeroId, estado)`.
  **No se crea un predicado nuevo al lado: se transforma este.**
  **Hecho cuando:** compila, no queda ninguna referencia al método viejo, y el test de repositorio
  afirma que se emite **una** consulta para un lote de N mensajeros. → **R1**
  **Depende de:** T1.1.

- [x] **T1.3 — `findMensajerosBloqueadosPorCierres` (renombrado de `findMensajerosBloqueadosParaGestion`).**
  Se apoya en T1.2 + `estaBloqueadoPorCierres`. Se actualizan los `Pick<IOrdenRepository, …>` de
  `MisAsignacionesService`, `CierreDiaService`, `RecoleccionTiendaService` y `cierre-dia.ts`.
  **Hecho cuando:** `rg "findMensajerosBloqueadosParaGestion"` devuelve **0** en `lib/` y `app/`, y
  `ESTADOS_CIERRE_BLOQUEAN_GESTION` ha desaparecido de `OrdenRepository.ts`. → **R10**
  **Depende de:** T1.2.

- [x] **T1.4 — `findBloqueoDetalle(mensajeroId)`.**
  Devuelve `BloqueoDetalle` (diseño §2.4) con el **más viejo** por `solicitadoAt asc, id asc`.
  **Hecho cuando:** hay caso con dos cierres del mismo segundo y el desempate por `id` es estable
  entre dos llamadas. → **R11**
  **Depende de:** T1.2.

- [x] **T1.5 [P] — Reapuntar `existeBodegaSateliteBloqueada` al contador.**
  `OrdenRepository.ts:3310`: `cierresAbiertos` conserva su significado (mensajeros con `N ≥ 1`); se
  añade `mensajerosBloqueadosIds` con la regla N/V. **`bloqueada` sigue siendo sólo el
  `CierreBodega` propio.**
  **Hecho cuando:** un test afirma que con un mensajero bloqueado y **sin** `CierreBodega`,
  `bloqueada === false` y `mensajerosBloqueadosIds` lo contiene. → **R34**
  **Depende de:** T1.2.

---

## Tanda 2 — Solicitar y re-solicitar *(backend)*

- [x] **T2.1 — Sustituir el gate de `CierreDiaService.ts:506`.**
  `existeCierreSolicitado` → gate LIBRE/BLOQUEADO. Orden de ramas del diseño §4.
  **Hecho cuando:** con `N=1, V=0` la solicitud **crea** el segundo cierre y no responde `conflict`;
  con `N=2, V=0` responde `conflict` con motivo compuesto. → **R13, R15**
  **Depende de:** T1.3.

- [x] **T2.2 — Verificar (no programar) que el 2.º cierre se lleva sólo lo de hoy.**
  **Desenlace:** HECHA, pero **no en la pasada de backend**: quedo declarada como ausencia n.º 3 y la cerro la pasada de cobertura (`impl_271_cobertura.md`) con `tests/integration/db/cierre-segundo-vincula-solo-lo-suyo.test.ts` y sus dos mutaciones (`cierreId: null` y `anuladaAt: null` fuera del `where` -> ROJO).
  El `where: { mensajeroId, cierreId: null, anuladaAt: null }` de `CierreDiaRepository.ts:686` ya lo
  hace. **No se toca.**
  **Hecho cuando:** test de integración con un cierre A ya creado y 2 gestiones nuevas: el cierre B
  se lleva **exactamente** esas 2 y **ninguna** de A. Con contraprueba: quitar `cierreId: null` del
  `where` mata el test. → **R14** *(ver AVISO 1)*
  **Depende de:** T2.1.

- [x] **T2.3 — Unificar las dos ramas de re-solicitud en una.**
  Añadir `findCierreResolicitableMasViejo` y `transicionarASolicitado(cierreId, estadoEsperado)`
  con **`id` en el `where`**. **Borrar** `transicionarVencidoASolicitado`,
  `transicionarRechazadoASolicitado`, `existeCierreVencido` y `existeCierreRechazado` si quedan sin
  llamadores.
  **Hecho cuando:** `rg "transicionarVencidoASolicitado|transicionarRechazadoASolicitado"` devuelve
  **0** en `lib/`, y el `updateMany` lleva `id`. → **R18**
  **Depende de:** T2.1.

- [x] **T2.4 — El test de M2, con los CUATRO pasos del rechazo.**
  Reproduce la secuencia real: `solicitado`#1 → `solicitado`#2 → rechazan #1 → rechazan #2 → el
  mensajero re-solicita.
  **Hecho cuando:** se afirma que (a) transiciona **UNO**, el más viejo, (b) el otro sigue
  `rechazado`, (c) el resultado es **éxito**, no `conflict`. Y con contraprueba: quitar el `id` del
  `where` deja el test **rojo** (transiciona los dos y devuelve `false`). → **R19**
  ⚠️ **NO se escribe ningún caso de «dos `vencido`»:** es inalcanzable (**R17**) y un test de un
  estado imposible no puede fallar por la razón correcta.
  **Depende de:** T2.3.

- [x] **T2.5 — Invariante derivado R17, escrito donde se lee.**
  Comentario en `CorteDiarioService`/`CierreDiaRepository` con las tres razones de por qué dos
  `vencido` es imposible, y la advertencia de no escribir código defensivo para ese caso.
  **Hecho cuando:** el comentario existe, nombra la ficha y la fecha, y **no** se ha añadido ninguna
  guarda para imponerlo. → **R17**
  **Depende de:** T2.3.

- [x] **T2.6 — Money-safe de la re-solicitud.**
  **Hecho cuando:** un test compara la fila **antes y después** de re-solicitar y afirma que sólo
  cambió `estado` (totales, pago, ingreso, `cierre_id` de gestiones, `resuelto_*`, `motivo_rechazo` y
  `solicitado_at` intactos). → **R20, R53**
  **Depende de:** T2.3.

---

## Tanda 3 — El corte diario *(backend)*

- [x] **T3.1 — Quitar la resta de `CorteDiarioRepository`.**
  Borrar la consulta a `cierre_dia` y el `filter` de `:105-116`, y la constante
  `ESTADOS_CIERRE_ABIERTOS` de `:12`. **Ninguna condición nueva.**
  **Hecho cuando:** un mensajero con un `solicitado` de ayer y gestiones de hoy **entra** en la lista.
  → **R21**
  **Depende de:** T0.1.

- [x] **T3.2 — El caso del cierre `79cb2c0f`, sembrado.**
  **Desenlace:** HECHA **por otra via, y menos de lo que pedia**. El caso `79cb2c0f` existe como test UNITARIO con doble de Prisma (`corte-diario-repository.test.ts` -> «271/R21: el caso `79cb2c0f`» y «…YA NO se excluye», que afirma que `prisma.cierreDia.findMany` **no se llama**). **No se sembro contra Postgres y no tiene contraprueba por mutacion**: eso era T10.3, que no se hizo.
  Cierre `solicitado` + 2 gestiones con `cierre_id` nulo → una corrida del corte le crea el segundo
  cierre y le vincula esas 2.
  **Hecho cuando:** el test lo afirma **contra Postgres**, con contraprueba por mutación del `where`.
  → **R21, R23** *(ver AVISO 1)*
  **Depende de:** T3.1.

- [x] **T3.3 — Un mensajero ya bloqueado no acumula.**
  **Desenlace:** HECHA **con tests preexistentes**, que es lo que la tarea admite («el motivo es la guarda “algo paso” existente, no una guarda nueva»): `corte-diario-service.test.ts` -> `crearCierre` null -> `vencidosCreados` 0, y `cierre-dia-repository.test.ts` -> la guarda «algo paso». **No se escribio test nuevo.**
  Con un `vencido` y **nada** que cerrar, la corrida no crea nada y `vencidosCreados` no sube.
  **Hecho cuando:** el test lo afirma y el motivo es la guarda «algo pasó» existente, **no una guarda
  nueva**. → **R22, R54**
  **Depende de:** T3.1.

- [x] **T3.4 [P] — El corte no re-vincula ni re-registra.**
  **Desenlace:** HECHA A MEDIAS. La mitad «no re-vincular una gestion ya vinculada» la cubre el test sembrado de R14 (T2.2). La mitad «no volver a registrar una orden ya barrida» se apoya en `cierre-sin-gestion-sql-real.test.ts` (**previo a esta ficha**, `@@unique(cierreId, ordenId)` + `skipDuplicates`): **no tiene test propio de la 271**, y la revision lo dejo como no concluible leyendo (review 271, R24).
  **Hecho cuando:** con un cierre previo que ya barrió 3 órdenes, la corrida siguiente no las vuelve
  a registrar en `cierre_sin_gestion` ni cambia su `cierre_id`. → **R24**
  **Depende de:** T3.1.

- [x] **T3.5 [P] — Medir el coste de la corrida.**
  **Desenlace: DECLARADA SIN MEDIR, por decision humana del 2026-08-23.** No hay numero, y **no se construye el banco de medida**. La razon, escrita para que el proximo lector no la vuelva a abrir: el cambio **quita** una consulta por corrida (la que restaba a quien tenia cierre abierto) y **anade** una emision por cierre creado; lo unico que crece es el universo de mensajeros evaluados, y **ese universo sigue siendo «los que tienen actividad»**, no todos — en produccion son **dos o tres por noche**. Un banco de ~50 mensajeros mediria un escenario que no existe. Consta igual en `progress/impl_271.md`. **Si algun dia el corte evalua decenas de mensajeros por noche, esta tarea se reabre; hoy no.**
  Corrida sembrada con ~50 mensajeros, mitad con cierre abierto: consultas y tiempo **antes y
  después** del cambio.
  **Hecho cuando:** el número está escrito en `progress/impl_271.md`. Si sube más de 2×, se abre una
  nota, no se «optimiza sobre la marcha». → riesgo §13-4
  **Depende de:** T3.1.

---

## Tanda 4 — Las superficies *(backend; es donde se repite el 18/08 si se va rápido)*

- [x] **T4.1 — Reponer la guarda en `GuiaAsignacionService.asignarDesdeBodega`.**
  Antes de cualquier escritura, todo-o-nada, con `detalle` por orden.
  **Hecho cuando:** un lote de 3 órdenes a un mensajero bloqueado devuelve `conflict` y **ninguna
  orden** cambió de estado. → **R28, R30**
  **Depende de:** T1.3.

- [x] **T4.2 — Reponer la guarda en `AsignacionSateliteService.asignar`.**
  El predicado **vuelve** al `Pick`. **No se repone el `NOT EXISTS`** del UPDATE crudo (diseño §12/A5).
  **Hecho cuando:** mismo caso que T4.1 desde la bodega satélite, y `rg "NOT EXISTS"` en
  `asignarSateliteLote` sigue devolviendo **0**. → **R29, R30**
  **Depende de:** T1.3.

- [x] **T4.3 — Reponer la guarda en `GuiaAsignacionService.asignarRecoleccion`.**
  ⚠️ **Esta tarea se dio la vuelta el 2026-08-23** (`Q1` resuelta). Antes decía «`asignarRecoleccion`
  NO se toca, y se demuestra», con una guardia que **impedía** bloquearla. **Ahora es lo contrario.**
  El hueco es el bloque «R7 RETIRADA» de `:462-466`; la guarda va **antes** de la regla de dedicación
  de `:468`, que **no se toca**.
  **Hecho cuando:** un lote a un mensajero bloqueado devuelve `conflict`, **ninguna** orden cambia de
  estado, y `rg "recoleccion-no-se-bloquea"` devuelve **0** (la guardia contraria **no existe**).
  → **R31**
  **Depende de:** T1.3.

- [x] **T4.4 [P] — `listarMensajerosParaAsignacion`: `bloqueadosIds`.**
  El campo se llama `bloqueadosIds`, **no** `bloqueadosParaRepartoIds`: se aplica a los **dos**
  modales.
  **Hecho cuando:** la respuesta lo trae y un test cruza que el conjunto es **idéntico** al que el
  servidor rechaza en T4.1 **y** en T4.3. → **R32**
  **Depende de:** T1.3.

- [x] **T4.5 [P] — `listarMensajerosSatelite`: `bloqueadosIds`.**
  Hoy **no devuelve nada** de esto. Es la mitad que faltaba y es **donde ocurrió el incidente del
  18/08**.
  **Hecho cuando:** idem T4.4, cruzado contra T4.2. → **R32**
  **Depende de:** T1.3.

- [x] **T4.6 — Reescribir `tests/unit/services/cierre-bloqueo-asimetria.test.ts`.**
  **Desenlace:** HECHA. El archivo se renombro a `tests/unit/services/cierre-bloqueo-superficies.test.ts` (ya no hay asimetria que medir) conservando sus tres casos «con `solicitado` si se puede» y su metodo (repositorio REAL sobre un Prisma que agrupa de verdad).
  Es el archivo que codifica la regla firmada del 20/08 y **queda mintiendo** en cuanto T4.1–T4.3
  entren. Pasa a cruzar las familias con la regla nueva, conservando su método: repositorio **real**
  sobre un Prisma que **filtra de verdad**, nunca un `vi.fn(async () => new Set([...]))`.
  **Hecho cuando:** cubre las 7 filas de la tabla × **gestionar** y × **recibir trabajo nuevo (las
  tres escrituras)**, y devolver `ESTADOS_CIERRE_BLOQUEAN_GESTION` al código pone rojos los casos de
  `N=2, V=0`. **El nombre del archivo se renombra**: ya no hay asimetría que medir.
  → **R25, R26, R27, R28, R29, R30, R31**
  **Depende de:** T4.1, T4.2, T4.3.

---

## Tanda 5 — Aprobar sin vaciar el otro cierre *(backend)*

- [x] **T5.1 — Acotar la liberación a `cierre_sin_gestion` del cierre aprobado.**
  `CierresAdminRepository.ts:1417`. **Se conservan todas las guardas actuales**; sólo se **añade** el
  `id: { in: … }`.
  **Hecho cuando:** compila y las guardas siguen ahí. → **R35**
  **Depende de:** T0.1.

- [x] **T5.2 — La rama de `sin_gestion_registrado === false`.**
  Con la bandera en `false`, **conserva el comportamiento actual** (por mensajero) en vez de liberar
  cero en silencio.
  **Hecho cuando:** hay un test para cada valor de la bandera, y el de `false` afirma que libera. →
  **R35**
  **Depende de:** T5.1.

- [x] **T5.3 — El test de M7, contra Postgres.**
  Dos cierres del mismo mensajero, cada uno con sus `sin_gestionar`. Aprobar el 1.º libera **sólo las
  suyas**.
  **Hecho cuando:** lo afirma con datos sembrados y **contraprueba**: volver al `where` por
  `mensajeroAsignadoId` deja el test **rojo**. → **R35, R37** *(ver AVISO 1)*
  **Depende de:** T5.1.

- [x] **T5.4 [P] — Aprobar el más viejo devuelve al mensajero a LIBRE.**
  **Desenlace:** HECHA en la pasada de cobertura: `tests/integration/db/cierre-aprobar-el-mas-viejo-desbloquea.test.ts`, con la consulta del veredicto corriendo contra un cliente que LANZA ante cualquier escritura, y el envoltorio **auto-comprobado**.
  **Hecho cuando:** con `N=2, V=0`, aprobar el más viejo hace que el predicado devuelva `false` en la
  siguiente consulta **sin ninguna escritura adicional**. → **R36, R12**
  **Depende de:** T1.3, T5.1.

---

## Tanda 6 — Los avisos *(backend; toca la base)*

- [x] **T6.1 — Migración de enum + `down.sql`.** *(`Q4` resuelta: **sí** a los dos valores.)*
  `ADD VALUE` de `cierre_dia_vencido` y `mensajero_bloqueado_por_cierres`. `notificacion_entidad_tipo`
  **no se toca**.
  **Hecho cuando:** existen `migration.sql` y `down.sql`; el `down` recrea `notificacion_evento` con
  los **seis** valores vigentes, lleva la precondición ruidosa escrita y **no tiene ni un `DELETE`**;
  y los `down.sql` de la 146, la 253 y la 262 **siguen intactos** (`git diff` vacío sobre ellos) —
  son fotos históricas, y la pregunta «¿recrea-con-lista o sólo dropea?» está respondida por escrito
  para cada uno en `design.md` §3.2.
  → **R55**
  **Depende de:** T0.1.

- [x] **T6.2 — Emisores en `lib/notificaciones/emitir.ts`.**
  **Desenlace:** HECHA, **en dos tiempos**. Los dos emisores y el numero de filas de `mensajero_bloqueado_por_cierres` se cerraron en la pasada de backend + la de cobertura (4 filas contadas contra Postgres). La mitad de `cierre_dia_vencido` —**quien recibe cada fila**— no tenia ningun test hasta el 2026-08-23: la cierra `tests/unit/notificaciones/cierre-vencido-destinatarios.test.ts` (review 271, **B2**).
  `emitirCierreDiaVencido` y `emitirMensajeroBloqueado`, con destinatario **usuario** (el mensajero) y
  destinatarios **rol** (bodega responsable), `entidadTipo: "cierre_dia"`, `entidadId` = el cierre que
  causa el bloqueo. **Los textos viven aquí y en ningún otro sitio.**
  **Hecho cuando:** un test afirma el **número de filas** por evento y que el `entidadId` es el cierre
  correcto. → **R38, R39, R40, R41, R42**
  **Depende de:** T6.1.

- [x] **T6.3 — Dedupe: las dos mitades.**
  **Desenlace:** HECHA en la pasada de cobertura: `tests/integration/db/notificacion-bloqueo-otro-cierre-avisa.test.ts` (mismo cierre -> 1 fila; otro cierre -> 2), contra el indice real `notificacion_dedupe_key`.
  **Hecho cuando:** hay dos casos: (a) mismo cierre dos veces con la primera **sin leer** → **1** fila;
  (b) **otro** cierre con la anterior sin leer → **2** filas. → **R44**
  **Depende de:** T6.2.

- [x] **T6.4 — Cablear el corte.**
  **Desenlace:** HECHA, **en tres tiempos, y el ultimo por la revision**. (1) El notificador inyectable y la emision dentro del `if (cierreId !== null)` entraron en la pasada de backend. (2) El **composition root del cron no lo inyectaba** —el aviso no se habria emitido jamas en produccion— y se arreglo el 2026-08-23 (`impl_271_r42.md`, 2.ª pasada, commit `b6dea0cf`). (3) El TEST que esta tarea pedia por su nombre («`crearCierre` null -> 0 emisiones» y «3 cierres -> 3») **no existia**: lo escribe `tests/unit/services/corte-diario-aviso-vencido.test.ts` el 2026-08-23 (review 271, **B2**).
  `CorteDiarioService` recibe el notificador inyectable, emite **una vez por cierre creado** y
  **nunca** por un `null`.
  **Hecho cuando:** un test con `crearCierre → null` afirma **0** emisiones, y otro con 3 cierres
  creados afirma **3**. → **R38, R39**
  **Depende de:** T6.2, T3.1.

- [x] **T6.5 — Cablear la solicitud y el rechazo.** *(`Q3` resuelta: el rechazo **sí** entra.)*
  **Desenlace:** HECHA, **en dos tiempos**. La solicitud se cableo en la pasada de backend y el rechazo (R42) en `impl_271_r42.md`, con sus 18 casos y 7 mutaciones. Lo que **no** se habia ejercitado nunca era el productor de la SOLICITUD —las diez suites que construyen `CierreDiaService` no le pasaban el 7.º argumento—: lo cierra `tests/unit/services/cierre-dia-aviso-bloqueo.test.ts` el 2026-08-23 (review 271, **B3**), con los dos casos que la tarea nombra (`N=1 -> 2` emite; `N=0 -> 1` no).
  Emite cuando la solicitud deja al mensajero en `N ≥ 2`; y **siempre** al rechazar un cierre.
  **Hecho cuando:** con `N=1 → 2` emite; con `N=0 → 1` **no** emite. → **R40, R41, R42**
  **Depende de:** T6.2, T2.1.

- [x] **T6.6 — Best-effort de verdad.**
  **Desenlace:** HECHA. Para el rechazo, en `cierres-admin-aviso-rechazo.test.ts` (R47 por partida doble). Para **el corte** y para **el bloqueo por acumular** no habia ninguno hasta el 2026-08-23: los anaden `corte-diario-aviso-vencido.test.ts` («la campana caida no tumba la corrida», con el notificador REAL sobre un repositorio que revienta) y `cierre-dia-aviso-bloqueo.test.ts` («un aviso que revienta NO invalida el cierre ya escrito»).
  **Hecho cuando:** con el emisor lanzando, el corte **termina** su corrida y devuelve su resumen, y
  `solicitarCierre` devuelve `ok`. → **R47**
  **Depende de:** T6.4, T6.5.

- [x] **T6.7 [P] — Sin datos personales ni monto.**
  **Desenlace: SUSTITUIDA.** La guardia de arbol sobre las cadenas de los emisores **no se escribio**. Su contenido esta cubierto por las aserciones NEGATIVAS de `tests/unit/notificaciones/bloqueo-textos.test.ts` (R45: ni monto, ni colon, ni correo, ni uuid, sobre los **ocho** textos), que es lo que la tarea perseguia. Consta en `impl_271.md` §«Lo que NO se cubrio», punto 8.
  **Hecho cuando:** una guardia censa las cadenas de los emisores nuevos y falla si aparece
  interpolación de destinatario, dirección, teléfono, correo o `Decimal`. → **R45**
  **Depende de:** T6.2.

- [x] **T6.9 — `lib/utils/jornada-cierre.ts`: el derivador único de la jornada.**
  Puro, sin Prisma. Fuente A = días CR de las gestiones vinculadas no anuladas; fuente B (sólo con
  **cero** gestiones) = día CR de `created_at` **menos un día**; `null` si las gestiones caen en más
  de un día CR. Lo consumen **los avisos y la pantalla**; no se duplica (**R61**).
  **Hecho cuando:** hay cuatro casos: (a) **el medido — jornada 21, cierre nacido el 22 → devuelve
  21**; (b) cierre sin gestiones creado por el corte → `created_at` CR − 1 día; (c) gestiones en dos
  días CR → `null`; (d) cron adelantado (23:5x CR) → coincide con `diaQueElCorteCierra`.
  Y una guardia: `rg "fechaReparto"` en el derivador devuelve **0** (**R59**).
  → **R57, R58, R59, R60, R61**
  **Depende de:** T0.1.

- [x] **T6.10 — La jornada, contra Postgres, sobre el caso real.**
  Sembrar el escenario de `79cb2c0f`: 3 gestiones del 21 (hora CR) vinculadas a un cierre creado el
  22 a las 00:0x.
  **Hecho cuando:** el aviso emitido dice **21 de agosto**. Con contraprueba: cambiar el derivador a
  `created_at` a secas deja el test **rojo** con el 22. → **R57** *(ver AVISO 1: hay conversión de
  zona horaria en el `WHERE`, y eso no se prueba con dobles)*
  **Depende de:** T6.9, T6.2.

- [x] **T6.8 — M9: el aviso nombra el cierre correcto.**
  `avisarCierrePorAprobar` recibe el `cierreId` que acaba de transicionar; `findCierreSolicitado` deja
  de usarse para componer avisos.
  **Hecho cuando:** con **dos** `solicitado`, el aviso lleva el id del que se acaba de tocar. Con
  contraprueba: volver a `findCierreSolicitado` deja el test rojo. → **R56**
  **Depende de:** T2.3.

---

## Tanda 7 — Lo que la administración ve *(backend)*

- [x] **T7.1 — El estado de bloqueo viaja en la fila del cierre.**
  ⚠️ **Esta tarea cambió el 2026-08-23** (`Q2` resuelta **que NO**). Antes era «`rechazado` entra en
  `ESTADOS_COLA_CIERRE_DIA`». **`colas-cierre.ts` NO SE TOCA**: la bodega ya decidió sobre un
  `rechazado`, y esa cola significa «pendiente de mi decisión».
  Lo que se hace: la fila lleva el `BloqueoDetalle` del mensajero —cuántos cierres arrastra y cuál
  toca primero—.
  **Hecho cuando:** `git diff lib/utils/colas-cierre.ts` está **vacío**, y la fila de un mensajero
  con `N = 2` muestra que está bloqueado y por qué. → **R48**
  **Depende de:** T1.4.

- [x] **T7.2 [P] — No-regresión: destrabar `rechazado`. AHORA ES CRÍTICA, no cortesía.**
  **Desenlace:** CUBIERTA POR UN TEST **PREVIO**, y medida; **el test nuevo con el nombre que pedia no se escribio**. Quien vigila `ESTADOS_REABRIBLES` es `tests/unit/repositories/cierres-admin-repository.test.ts` (feature 109/R28), que corre el repositorio REAL sobre un Prisma doble y afirma `estado: { in: ["vencido","rechazado"] }` **escrito a mano** en tres casos. Medido el 2026-08-23: quitar `rechazado` de la constante deja **3 tests rojos** en ese archivo. Los `cierres-admin-*.test.ts` de servicio que el mapa citaba **doblan el metodo** y no cubren R49 (review 271, **M6**). Se anadio ahi la nota de «no borres esto: es la unica red de R49».
  Con T7.1 dejando el `rechazado` **fuera** de la cola, este test es lo único que impide concluir que
  un `rechazado` deja al mensajero sin rescate.
  **Hecho cuando:** un test afirma que `forzarSolicitudVencido` sigue aceptando `vencido` **y**
  `rechazado`, y su nombre lo dice («la bodega puede destrabar un rechazado aunque no esté en la
  cola»). → **R49**
  **Depende de:** T0.1.

---

## Tanda 8 — La prosa y las guardias *(backend)*

- [x] **T8.1 — Reescribir los comentarios de la regla firmada.**
  Los **nueve** sitios de la tabla del diseño §10.3 —incluidos `GuiaAsignacionService.ts:462-466`
  («ningún estado de cierre impide mandar a un mensajero a recolectar»),
  `RecoleccionTiendaService.ts:39-42` (`MSG_BLOQUEADO`, que se queda corto para la acumulación) y
  `MisAsignacionesService.ts:504` («recibirlas no cobra»)—. Cada uno nombra la ficha 271 y la fecha, y
  dice qué parte de la 241 **sobrevive** y cuál se **revierte**.
  **Hecho cuando:** los nueve están reescritos y ninguno afirma ya que recibir asignaciones no se
  bloquea nunca ni distingue reparto de recolección. → **R50, R51**
  **Depende de:** T4.1, T4.2, T4.3.

- [x] **T8.2 — Guardia `regla-241-caducada.guardia.test.ts`.**
  Censa `lib/` y `app/` buscando las frases caducadas («NUNCA se bloquea», «Sí puedes seguir
  recibiendo asignaciones», «recibir asignaciones no se bloquea», «recibir trabajo no se bloquea»,
  «puedes seguir recogiendo en tiendas») y **falla si sobrevive alguna**.
  **Hecho cuando:** la guardia pasa **después** de T8.1 y **falla** si se restaura cualquiera de las
  frases (comprobado a mano, y anotado). → **R51**
  **Depende de:** T8.1.

- [x] **T8.3 [P] — Actualizar los specs que citan la regla vieja.**
  **Desenlace: HECHA el 2026-08-23.** Los tres llevan ya su **nota de caducidad** fechada, y **ni una linea original se toco** (`git diff --numstat` sobre `specs/`: **35 adiciones, 0 borrados**). Son documentos historicos de fichas cerradas: se anotan, no se reescriben.
  · `specs/246-asignacion-por-dia/requirements.md` — lo que dice de la 241 («un `vencido` bloquea para gestionar y cobrar») **se queda corto**, no es falso: desde la 271 bloquea tambien para RECIBIR TRABAJO NUEVO, y dos cierres sin aprobar bloquean sin `vencido`. La nota anade el cruce que la medida encontro: la reserva de la 246 es lo que vuelve **alcanzable** el estado que la 271 declara imposible (ver T10.3).
  · `specs/262-corregir-dia-reparto/design.md` — cae la **justificacion** («recibir asignaciones no se bloquea nunca»), **no la decision**: R14 sigue en pie por su OTRA razon, que ya esta escrita en `CorreccionDiaRepartoService.ts`.
  · `specs/262-corregir-dia-reparto/tasks.md` — idem, mas el renombrado del metodo.
  `specs/246-asignacion-por-dia/requirements.md:11`, `specs/262-corregir-dia-reparto/design.md:132` y
  `tasks.md:150` afirman la regla del 20/08.
  **Hecho cuando:** llevan una nota de caducidad que apunta a esta ficha. **No se reescribe el spec
  ajeno**: se anota, porque es una foto de su momento. → **R50**
  **Depende de:** T8.1.

---

## Tanda 9 — Frontend *(después del backend, no en paralelo)*

- [x] **T9.1 — `BLOQUEO_AVISO` pasa a ser `avisoBloqueo(detalle, { conCta })`.**
  La **copia** de `CierreDiaModule.tsx:175` **desaparece**; el módulo consume el formateador con
  `conCta: false`.
  **Hecho cuando:** hay **una** fuente del texto en el árbol y los tres portales la consumen. → **R52**
  **Depende de:** T1.4.

- [x] **T9.2 — Los literales, escritos a mano en los tests.**
  Los cinco textos de §10.2, en `RepartoModule.test.tsx`, `RecogerModule`, `RecoleccionModule` y
  `CierreDiaModule.test.tsx`. **Ninguno lleva ya «Sí puedes seguir recogiendo en tiendas»** (`Q1`).
  **Hecho cuando:** ningún test compara contra `avisoBloqueo(...)` — **AVISO 2** —, cada literal
  aparece **completo** en la aserción, y una aserción negativa comprueba que la frase retirada **no
  aparece** en ninguno de los tres portales. → **R43, R46, R51, R52**
  **Depende de:** T9.1 + respuesta a **Q6**.

- [x] **T9.3 — `estadoBloqueoMensajero` devuelve `BloqueoDetalle`; la pantalla lo pinta.**
  `CierreDiaModuleProps`: `bloqueado: boolean` → `bloqueo: BloqueoDetalle`; `tieneVencido` /
  `tieneRechazado` se **derivan** de él.
  **Hecho cuando:** la pantalla muestra cuántos cierres arrastra y cuál toca primero, y no queda
  ninguna derivación paralela del mismo dato. → **R43**
  **Depende de:** T1.4, T9.1.

- [x] **T9.4 — Los DOS modales deshabilitan; el filtro NO.**
  ⚠️ **Se dio la vuelta el 2026-08-23** (`Q1`): antes decía «el de recolección NO».
  `OrdenesListado.tsx` aplica `bloqueadosIds` al modal de **reparto** y al de **recolección**.
  `FiltrosEntregas.tsx` **no lo lee**: filtrar no es asignar y esconder al bloqueado del filtro
  volvería inalcanzables las órdenes que ya tiene en la mano.
  **Hecho cuando:** hay tres casos: reparto deshabilita, recolección **también**, filtro **no**.
  → **R32, R33**
  **Depende de:** T4.4.

- [x] **T9.5 [P] — El selector de la bodega satélite deshabilita.**
  **Hecho cuando:** el mensajero bloqueado aparece deshabilitado con el motivo, y el caso está
  cruzado contra el rechazo del servidor (T4.2). → **R32**
  **Depende de:** T4.5.

- [x] **T9.6 [P] — `getByRole("alert")` en plural donde haga falta.**
  `RepartoModule.test.tsx:839, :1152, :1463` usan el **singular** y ya hoy rompen con «bloqueado +
  desactualizada». Con el aviso nuevo el caso se vuelve más frecuente.
  **Hecho cuando:** los tres usan `getAllByRole` con aserción sobre el que interesa. *(Deuda ajena que
  esta ficha agrava; se toma aquí porque si no, la agrava y la deja.)*
  **Depende de:** T9.1.

---

## Tanda 10 — Verificación contra Postgres *(donde el spec se vuelve verdad)*

> Todo lo de esta tanda va en `tests/integration/db/`, con `describe.skip` sin base **nunca** con
> `return` silencioso, y dentro de transacción revertida. Patrón:
> `tests/integration/db/cierre-sin-gestion-sql-real.test.ts`.

- [x] **T10.1 — El conteo N/V, sembrado, con contraprueba.**
  Corpus: un mensajero por fila de la tabla de verdad (7), más uno con 3 cierres, más uno con cierres
  `aprobado` que **no** deben contar.
  **Hecho cuando:** pasa, y **cada una** de estas mutaciones lo pone rojo: (a) meter `aprobado` en la
  lista de abiertos, (b) sacar `rechazado` del cálculo de V, (c) cambiar `n >= 2` por `n > 2`.
  Las tres se prueban **y se anota el resultado**. → **R1–R8**

- [x] **T10.2 [P] — «El más viejo» contra Postgres.**
  **Hecho cuando:** con tres cierres y `solicitado_at` no correlacionado con el orden de inserción, el
  elegido es el más viejo; invertir el `orderBy` mata el test. → **R11, R18**

- [x] **T10.3 [P] — El corte, sembrado.**
  **Desenlace: HECHA el 2026-08-23** — `tests/integration/db/corte-diario-segundo-cierre-sql-real.test.ts`, **4 casos**, con la corrida COMPLETA del corte sobre repositorios REALES y datos sembrados. Los mensajeros los **crea el test**: el corte lee toda la base, y con usuarios prestados «recibio su segundo cierre» dejaria de ser consecuencia del corpus.
  · **Caso 1 (R21/R23)** — el caso `79cb2c0f`: con un `solicitado` de ayer, el corte **SI** le crea el segundo cierre, le vincula **exactamente** las 2 gestiones sueltas, no toca ni una de las de ayer, y barre su guia a `sin_gestionar` registrandola en el cierre NUEVO.
  · **Caso 2 (R22/R17)** — el ya bloqueado con un `vencido` y nada que cerrar **no** recibe un segundo, con un mensajero TESTIGO al lado que **si** lo recibe (sin el, «no se creo nada» tambien seria cierto si la corrida no hubiera hecho nada).
  · **Caso 3 (R23/R24)** — el barrido de `en_reparto` **y** `ayuda_tienda` con su origen REAL en `cierre_sin_gestion`, la orden reservada que **no** se barre (246/R11), la gestion ANULADA que **no** se vincula, y la 2.ª corrida de la misma noche que **no** re-vincula, **no** re-registra y **no** crea nada.
  · **Caso 4 (⚠️ R17)** — el contraejemplo; ver el hallazgo de abajo.
  **Las dos mutaciones, EJECUTADAS** (salida en `progress/impl_271.md` §T10.3):
  · **(a) reponer la exclusion por cierre abierto** en `CorteDiarioRepository` → **ROJO, 2 casos** (el 1 y el 4). Y no solo por la lectura directa de la lista: silenciada esa asercion, el caso 1 muere igual en `mensajerosEvaluados = 0`.
  · **(b) romper la guarda «algo paso»** de `crearCierre` → **SOBREVIVE: los 4 casos en verde.** Y eso **no es un hueco del test, es un hallazgo.**
  ⚠️ **EL MECANISMO QUE SOSTIENE R17 NO ES LA GUARDA QUE EL SPEC NOMBRA.** T3.3, `design.md` y el comentario de cabecera de `CorteDiarioRepository` dicen que el bloqueado «entra en el bucle y `crearCierre` devuelve `null` por su guarda». **Postgres dice que no llega a entrar en el bucle**: las dos ramas de la seleccion ya vienen vacias para el (el caso 2 lo afirma). La conclusion es la misma y **mas fuerte**; la razon escrita no es la que corre. La guarda **si** tiene red, pero en otro sitio: la mutacion (b) mata **4 casos** de `tests/unit/repositories/cierre-dia-repository.test.ts`, y **ninguno** de `tests/integration/db` (133 archivos / 1794 tests, todos verdes con ella puesta).
  **Anti-vacuidad, demostrada y no prometida:** `describe.skip` sin base, **cinco** fallos RUIDOSOS en el `beforeAll`, **cero** `return` de salida temprana, y un `afirmarCorpusSembrado` que cuenta el corpus EN LA BASE antes de medir nada. Comprobado a mano: vaciando el corpus el caso muere con el mensaje del contador; y **desactivando ademas ese contador, muere igual** en la asercion de comportamiento. Dos redes independientes.
  → **R21–R24**

  🔴 **HALLAZGO QUE ESTA TAREA DESTAPO — R17 ES FALSO: DOS `vencido` A LA VEZ ES ALCANZABLE.**
  Medido, no razonado (caso 4 del archivo nuevo). El argumento de R17 dice: «el corte que lo bloqueo
  ya barrio sus ordenes en la MISMA transaccion, asi que la noche siguiente no le queda nada que
  cerrar». **La feature 246 abrio una excepcion a ese barrido**: una orden reservada para un dia
  posterior **sobrevive** al corte (246/R11) y **su proteccion caduca sola** (246/R13). La noche
  siguiente esa orden vence, el mensajero —ya bloqueado— vuelve a entrar por la rama (b) de la
  seleccion, se barre, `sinGestionarTransicionadas` vale 1, la guarda «algo paso» **pasa**, y nace
  el **segundo `vencido`**. Y es alcanzable en produccion, no fabricado:
  `CorreccionDiaRepartoService` (feature 262) permite cambiar el dia de reparto de una orden que
  **YA esta en `en_reparto`** — su `ESTADOS_CON_DIA_DE_REPARTO_VIVO` lo dice y su comentario llama a
  esa poblacion «la que la 261 dejo atrapada: el paquete ya esta en la mano del mensajero».
  **Antes de la 271 no podia pasar**: la exclusion por cierre abierto lo sacaba de la corrida
  siguiente. Es decir, **lo introduce esta ficha**.
  **NO se ha tocado ni una linea de `lib/`.** El desenlace medido es ademas el razonable —la orden
  necesitaba barrido y necesitaba un cierre al que ir— y el estado `N=2, V=2` lo cubre la regla
  general: es la **fila 7** de la tabla de verdad con dos `vencido` en vez de dos `rechazado`, y la
  re-solicitud lo trata igual (R18: el mas viejo primero). Lo que hay que corregir es **la prosa que
  lo declara imposible**: **R17**, **T2.5** (el comentario en `CorteDiarioService` y
  `CierreDiaRepository`) y la justificacion de **T2.4** para no escribir ese caso. **Decision
  pendiente del humano.**

- [x] **T10.4 [P] — La migración de enum contra Postgres real.**
  Que el `NULLS NOT DISTINCT` y el `WHERE` parcial de `notificacion_dedupe_key` **sobrevivan** a la
  reconstrucción del `down` **no se supone**: se mide, como hicieron la 253 y la 262.
  **Hecho cuando:** el test existe y pasa; y `pnpm run db:rollback` sobre una base con una fila del
  evento nuevo **aborta ruidosamente**. → **R55**
  **Depende de:** T6.1.

- [x] **T10.5 — Correr `tests/integration/db` completo.**
  Añadir valores a un enum toca esa carpeta entera.
  **Hecho cuando:** verde, con el número de tests escrito en `progress/impl_271.md`.
  **Depende de:** T6.1.

---

## Tanda 11 — Cierre

- [x] **T11.1 — Mapa `R<n>` → test, en `progress/impl_271.md`.**
  **Desenlace:** HECHA, y **corregida el 2026-08-23**: la revision encontro filas que vendian como cobertura cosas que no lo eran (R38-R41, R44, R49, R50, R10). El mapa de `progress/impl_271.md` se reescribio con lo que cada test afirma de verdad.
  **Los 61 requisitos**, cada uno con archivo y nombre del `it`. Un requisito sin test es un fallo de
  la feature y el reviewer rechaza.
  **Hecho cuando:** la tabla está completa y **ningún** requisito apunta a «cubierto por» sin nombrar
  un `it` concreto.

- [x] **T11.2 — Las mutaciones, con su resultado escrito.**
  **Desenlace:** HECHA. Las de T10.1 (tres), T2.4, T5.3, T2.2, T6.8 y T6.10, cada una con el nombre del test que murio; mas cuatro sobre `aReenviarPrimero`, siete sobre los textos, seis sobre la cuarta rama y siete sobre el cableado del rechazo. El 2026-08-23 se anaden **tres**: borrar la emision del corte (ROJO, 3 tests), borrar la del bloqueo por acumular (ROJO, 3 tests) y quitar `rechazado` de `ESTADOS_REABRIBLES` (ROJO, 3 tests).
  Las de T10.1, T2.4, T5.3, T2.2, T6.8 y **T6.10** (la fecha de la jornada).
  **Hecho cuando:** cada una tiene anotado «mutación aplicada → test rojo → revertida», con el nombre
  del test que murió. **Un arnés de mutaciones que reporta supervivientes sin haber ejecutado un test
  ya mintió en este repo dos veces**: aquí se exige el nombre del test que murió, no un conteo.

- [x] **T11.3 — Gate.**
  **Desenlace:** HECHA sobre el arbol de la implementacion: `./init.sh` **completo**, `INIT_EXIT=0` escrito DENTRO del log, 1331 archivos / 18.009 tests (`impl_271.md` §Gate). ⚠️ **Hay que repetirlo tras el diff de la revision**: lo lanza el leader.
  `./init.sh --rapido` para abrir PR; **`./init.sh` completo obligatorio** por la migración.
  **Hecho cuando:** `INIT_EXIT=0` escrito **dentro** del log (un `echo` posterior tapa el exit code) y
  el log **sin `tail`** (canalizar un proceso en segundo plano por `tail` trunca el fichero en origen
  y el rojo se queda sin nombre).

- [x] **T11.4 — Verificar el blob commiteado.**
  **Desenlace:** HECHA el 2026-08-23 sobre el commit de la correccion de la revision (`git show <sha>:` de los tres archivos de `specs/271-…/` y de los tests nuevos). Resultado en `progress/impl_271.md`, seccion de la revision.
  **Hecho cuando:** `git show <sha>:specs/271-segundo-cierre-y-bloqueo/requirements.md` y los archivos
  tocados devuelven lo esperado. El árbol de trabajo no distingue «lo commiteé» de «alguien lo
  revirtió».

- [x] **T11.5 — Ver la app.**
  **Desenlace:** HECHA, en dos pasadas y con lo no cubierto escrito (`impl_271.md` §«Ver la app» y §«verificacion en pantalla del estado NORMAL»): los cuatro portales, los siete estados de la tabla de verdad, sus dos ramas mixtas y sus plurales, leidos por `innerText` y con la base restaurada. **Queda sin ver**: las variantes «sin jornada fiable» (R60) y los dos avisos a la bodega, que no son pantalla.
  Entrar como mensajero con `N=2` y comprobar en pantalla: no puede gestionar, **no** aparece
  seleccionable en **ninguno** de los tres selectores de asignación (reparto central, reparto
  satélite y recolección), **sí** sigue apareciendo en el **filtro** del listado, y el aviso dice
  cuántos cierres arrastra y cuál toca — **sin prometerle recoger en tiendas**.
  **Hecho cuando:** está hecho y **lo que no se cubrió está escrito**. Playwright encontró en minutos
  siete textos rotos que 12.000 tests daban por buenos; la suite no ve la pantalla.

---

## Resumen de dependencias

```
T0.1 ──┬── T1.1 ── T1.2 ──┬── T1.3 ──┬── T2.1 ──┬── T2.2
       │                  │          │          └── T2.3 ──┬── T2.4, T2.5, T2.6
       │                  ├── T1.4   │                     └── T6.8
       │                  └── T1.5   ├── T4.1 ─┐
       │                             ├── T4.2 ─┼── T4.6 ── T8.1 ── T8.2, T8.3
       │                             ├── T4.3 ─┘
       │                             ├── T4.4 ── T9.4
       │                             └── T4.5 ── T9.5
       ├── T3.1 ──┬── T3.2, T3.3, T3.4, T3.5
       │          └────────────────────────────── T6.4
       ├── T5.1 ──┬── T5.2, T5.3, T5.4
       ├── T6.1 ── T6.2 ──┬── T6.3, T6.5, T6.7 ── T6.6
       │                  └── T10.4, T10.5
       ├── T6.9 ── T6.10 (con T6.2)
       ├── T7.2
       └── T1.4 ──┬── T7.1
                  └── T9.1 ──┬── T9.2, T9.3, T9.6

T10.1–T10.3 tras la tanda 1 y la 3. Tanda 11 al final, en orden.
```

**Camino crítico:** `T0.1 → T1.1 → T1.2 → T1.3 → T4.1/T4.2 → T4.6 → T8.1 → T8.2`.
Es el que revierte la regla firmada, y es el que no se puede acelerar.
