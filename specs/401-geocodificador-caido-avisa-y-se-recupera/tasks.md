# Feature 401 — Tasks

> Lee antes `requirements.md` (el QUÉ) y `design.md` (el CÓMO).
> `[P]` = puede ir en paralelo con las tareas marcadas igual dentro de su mismo bloque.
> Cada task lleva su **criterio de hecho**: si no se puede comprobar, no está hecha.
> Un commit por task lógica (`docs/conventions.md`), nunca un mega-commit al final.

---

## Bloque 0 — Puerta de entrada (bloquea TODO)

### T0 — Verificar en el ÁRBOL que la ficha 400 está mergeada
**Depende de:** nada. **Bloquea:** todo lo demás.

Esta ficha **lee** un marcador que hoy **no existe**: verificado el 2026-09-09, no hay ningún
`lib/geo/fallo-config-geocode.ts` en `dev`. Sin él, todo lo que se implemente aquí es código muerto y
silencioso — exactamente el modo de fallo que la ficha existe para eliminar.

- Comprobar **en el archivo real**, no en el grafo (el índice del MCP miente devolviendo de más):
  `lib/geo/fallo-config-geocode.ts` existe en `origin/dev` y exporta el marcador, su productor y su
  detector.
- Comprobar que `GeocodificacionService` **emite** el marcador en los dos caminos de configuración.

**Hecho cuando:** los dos símbolos se leen en el archivo real de `origin/dev`, y el SHA comprobado
queda anotado en `progress/impl_401_*.md`. **Si no está mergeada, la ficha se detiene aquí** y se
reporta al leader: no se implementa contra un símbolo que no existe.

---

## Bloque 1 — Cimientos sin dependencias entre sí

### T1 [P] — Configuración: `lib/config/geocode-salud.ts`
**Depende de:** T0.

Módulo nuevo, clon estructural de `lib/config/jobs.ts` (`readPositiveInt`; ausente, vacío, no numérico,
cero o negativo → default; **nunca lanza**). Cinco valores con los defaults de `design.md` §6.4:
`GEOCODE_CAIDA_JOBS_MINIMOS=3`, `GEOCODE_CAIDA_VENTANA_MIN=60`, `GEOCODE_RECUPERACION_LOTE=5`,
`GEOCODE_RECUPERACION_ESPACIADO_MS=60000`, `GEOCODE_RECUPERACION_ENFRIAMIENTO_MIN=60`.
**No se toca `lib/config/geocode.ts`** (rompería decenas de tests que construyen `GeocodeConfig` a mano).

**Hecho cuando:** `tests/unit/config/geocode-salud-config.test.ts` está verde con los cinco defaults
**afirmados a mano** y con los cuatro casos de valor inválido (**R29, R30**).

### T2 [P] — Contrato del repositorio de salud
**Depende de:** T0.

`lib/interfaces/repositories/IGeocodeSaludRepository.ts` con `contarFallosConfigDesde` y
`revivirFallosConfig`, tal cual la firma de `design.md` §5.1, con su docstring explicando el
`excluirJobId` (el off-by-one) y el escalonado.

**Hecho cuando:** compila con `strict`, no expone `PrismaClient` y **no** modifica
`lib/interfaces/repositories/IJobRepository.ts` (**R35**).

### T3 [P] — Contrato del servicio de salud + su no-op
**Depende de:** T0.

`lib/interfaces/services/IGeocodeSaludService.ts` con `registrarFalloConfig` /
`registrarExitoProveedor` y la constante `geocodeSaludNoOp`, que será el **default** del nuevo
parámetro de `GeocodificacionService` (para que ninguna suite existente toque la base por construcción).

**Hecho cuando:** compila y `geocodeSaludNoOp` no importa nada de `lib/repositories/` ni de Prisma.

---

## Bloque 2 — Migraciones (fuerzan el gate completo)

### T4 — Migración del índice parcial sobre `jobs`
**Depende de:** T0.

`db/migrations/20260910110000_jobs_geocodificacion_salud_idx/` con `migration.sql` (el `CREATE INDEX …
WHERE "tipo" = 'geocodificacion'` de `design.md` §3.2) y su **`down.sql` obligatorio**
(`DROP INDEX IF EXISTS …`). **`db/schema.prisma` no cambia por esta migración**: Prisma no expresa
índices parciales, igual que el `jobs_run_after_pending_idx` ya existente.

**Hecho cuando:** `pnpm run db:migrate` la aplica en local, `pnpm run db:rollback` la revierte, y
`prisma migrate status` no reporta drift. Se deja anotado el host contra el que se aplicó (`migrate
status` lo dice sin exponer credencial).

### T5 — Migración de los dos valores de enum del aviso
**Depende de:** T0. **Ojo con la 403.**

`db/migrations/20260910120000_notificacion_evento_geocodificacion_caida/` con los dos
`ALTER TYPE … ADD VALUE IF NOT EXISTS` de `design.md` §3.3, **sola** (por el `55P04`), y
`db/schema.prisma` gana `geocodificacion_caida` y `geocodificacion_caida_dia`.

`down.sql` recrea-con-lista **la foto de los enums en el momento de abrir el PR**:
- **Releer `db/schema.prisma` de `origin/dev` en ese momento**, no confiar en lo que dice este spec.
  Si la **403** ya está mergeada, sus dos valores **entran** en la lista.
- **No se toca ningún `down.sql` anterior** (146 sólo dropea; 253/262/271/333 recrean la foto de su
  rama, y siguen siendo ciertas).
- Si el timestamp chocara con otra migración ya aplicada, se crea **una carpeta con timestamp nuevo**;
  **jamás** se renumera ni se edita una migración ya aplicada.
- Incluir la **precondición ruidosa** documentada (§3.3, punto 4). **Ni un `DELETE` ni un `UPDATE`
  «para hacer sitio».**

**Hecho cuando:** `tests/integration/db/notificacion-evento-geocodificacion-caida-migration.test.ts`
está verde contra Postgres real y comprueba que, tras aplicar la migración, el índice único
`notificacion_dedupe_key` **sigue siendo parcial y con `NULLS NOT DISTINCT`**, que dos emisiones el
mismo día CR dejan **dos filas en total —una por rol, no cuatro—** (**R9**), que con la del `maestro`
ya leída y la del `admin` sin leer una tercera emisión del mismo día **no crea ninguna** (**R9**), y que
dos días CR distintos dejan **cuatro** (**R10**). Y el rollback aplica limpio sobre una base sin filas
de esos valores.

---

## Bloque 3 — Datos: las dos sentencias, probadas donde viven

### T6 — `lib/repositories/GeocodeSaludRepository.ts`
**Depende de:** T2, T4.

Las dos sentencias de `design.md` §5.1, en SQL crudo parametrizado, estilo `JobRepository`. Cinco
detalles que son requisitos, no gusto:
- `left("last_error", $len) = $marcador`, **con el marcador y su longitud importados del módulo de la
  400** — ni un literal copiado (lo prohíbe R13 de la 400, y su guard lo vigila);
- **la recuperación va en DOS CTEs, y no se colapsan**: `elegibles` lleva el `WHERE`, el
  `ORDER BY "updated_at" ASC` (**R19**), el `LIMIT` (**R21**) y el **`FOR UPDATE SKIP LOCKED`**, y
  **no** lleva función de ventana; `candidatos` numera con `row_number()` sobre `elegibles`, y **no**
  lleva bloqueo;
- `run_after` escalonado con esa `row_number()` y `$espaciadoMs` (**R22**);
- `intentos = 0`, `last_error = NULL`, `locked_at = NULL` (**R15**);
- y el `UPDATE` **sólo** toca esas columnas más `estado`, `run_after` y `updated_at`: nunca `tipo`,
  `payload` ni `dedupe_key`.

> ⚠️ **NO PONGAS `FOR UPDATE SKIP LOCKED` Y `row_number()` EN LA MISMA `SELECT`.** Postgres lo
> rechaza en ejecución —medido el 2026-09-09 contra la base: `0A000`, *«FOR UPDATE no está permitido
> con funciones de ventana deslizante»*— y es la **misma** restricción que ya obligó a partir en tres
> el `claimBatch` de `JobRepository` (402). Si alguien las funde «para que quede más corto», el fallo
> es **MUDO**: `revivirFallosConfig` lanza, la llamada está envuelta a propósito para no cambiar el
> desenlace del job (R20) y el logger del composition root es el no-op — la recuperación se apaga sin
> un test rojo del camino de producción y sin una línea de log. `design.md` §5.1 lo explica entero.

**Hecho cuando:** compila, **no** contiene ningún literal de prosa del proveedor, y la sentencia de
recuperación **se ejecuta de verdad** contra Postgres en T7 (si estuviera colapsada, T7 entero
reventaría con `0A000`, que es la red que impide reintroducirla).

### T7 — Test de integración de la recuperación (el que prueba el `WHERE`)
**Depende de:** T6.

`tests/integration/db/geocode-recuperacion.test.ts`, con el escenario completo de `design.md` §10:
25 filas `failed` con marcador y `updated_at` escalonado, **más filas testigo** (otro tipo de job,
geocodificación `done` con marcador, geocodificación `failed` **sin** marcador y con la prosa legada,
geocodificación `pending` con marcador). Cubre **R15, R16, R18, R19, R21, R22, R23, R24**.

- Siembra y limpia con un **prefijo propio de `dedupe_key`**; **no asume base vacía** (los worktrees
  comparten base local).
- **Falla ruidosamente si no encuentra sus propias filas.** Nada de `if (!filas) return;`.

**Hecho cuando:** verde, **y** se ha comprobado que **muta bien**: quitar la condición del marcador del
`WHERE` deja el test ROJO, y quitar el `LIMIT` también. Las dos salidas se pegan en
`progress/impl_401_*.md`.

---

## Bloque 4 — El aviso

### T8 [P] — Emisor `emitirGeocodificacionCaida` + su texto
**Depende de:** T5.

En `lib/notificaciones/emitir.ts`, con el molde de `emitirGeocodificacionCaida`/`textoGeocodificacionCaida`
de `design.md` §7.1-§7.2: **dos filas** `alert` —una por rol— evento `geocodificacion_caida`, entidad
`geocodificacion_caida_dia` + `entidadId = diaCR` (`fechaCalendarioCR`), `anexo: null`.

**Los destinatarios se REUTILIZAN, no se inventan:** `ROLES_ADMINISTRACION` (constante privada ya
existente en ese mismo archivo, `:103-106`) con la forma
`ROLES_ADMINISTRACION.map((destinatario) => ({ … , destinatario }))` sobre `emitirFilas` — idéntica a la
de los cuatro emisores multi-rol vigentes (`:324`, `:371`, `:468`, `:570`). **No se exporta la constante
ni se toca ningún emisor existente.**

**Hecho cuando:** `tests/unit/notificaciones/geocodificacion-caida-aviso.test.ts` está verde con:
- **exactamente dos filas**, con `destinatario` `{rol:"maestro"}` y `{rol:"admin"}`, sin `tiendaId` ni
  `zonaId`, y con el **mismo** `descripcion` en ambas (**R7**). La lista de roles se afirma **a mano**
  (`["maestro","admin"]` escrito literal), **nunca** derivada de `ROLES_ADMINISTRACION`: si se comparase
  contra su propia fuente, quitar un rol dejaría el test en verde (memoria «aserción contra su propia
  fuente»);
- el literal del texto completo **afirmado a mano** (nunca comparado contra la función que lo genera),
  singular y plural;
- ausencia case-insensitive de «geocodifica», «config_invalida», «REQUEST_DENIED» y «API» (**R27**);
- ausencia de identificadores, `@` y cadenas de una dirección/guía de prueba (**R26**).

### T9 [P] — Notificador `notificarGeocodificacionCaidaCon` / `…Real`
**Depende de:** T8.

En `lib/notificaciones/notificadores.ts`: el tipo, el par `Con`/`Real` con `emitirBestEffort`, y
`GeocodificacionCaidaNotificador` añadido a la intersección de `notificadorNoOp`. **Sin tocar los ocho
notificadores existentes.**

**Hecho cuando:** `tests/unit/services/notificacion-notificadores-reales.test.ts` *(ext.)* prueba el
camino real con un repositorio doble —que registra **las dos** filas, `maestro` y `admin`— (**R8**, y
R7 por el camino real; el contrato de destinatarios lo fija T8) y que un fallo del repo se **loguea** y
no se propaga (**R11**).

---

## Bloque 5 — La regla y su servicio

### T10 — `lib/services/GeocodeSaludService.ts`
**Depende de:** T1, T2, T3, T9.

Implementa `IGeocodeSaludService` según `design.md` §5.2: la función pura `hayCaida`,
`registrarFalloConfig` (consulta con `ahora − ventana` y `excluirJobId`, compara `otros + 1`, avisa y
loguea) y `registrarExitoProveedor` (revive con lote, espaciado y enfriamiento, y loguea el conteo).
El notificador es parámetro de constructor con **default `notificadorNoOp`**.

**Hecho cuando:** `tests/unit/services/geocode-salud-service.test.ts` está verde y cubre
**R1, R2, R3, R4, R5, R11, R22, R26**, incluido explícitamente:
- «un solo job con 7 intentos con marcador **no** cruza el umbral; tres jobs distintos **sí**» (R2);
- «con `umbral−1` ya registrados, el job en curso completa la cuenta» — el off-by-one (R4);
- «el `desde` pasado al repositorio es `ahora − ventana`» y «los parámetros de revivido son lote,
  espaciado y `ahora − enfriamiento`» (R22/R24);
- «ningún mensaje pasado al logger contiene la credencial de prueba» (R26).

### T11 — Añadir `GeocodeSaludService.ts` al censo de notificadores
**Depende de:** T10.

El test *«el censo está COMPLETO: no hay ningún otro service con notificador por constructor»* compara
`readdirSync(lib/services)` contra la lista literal `SERVICES_CON_NOTIFICADOR`. Al declarar
`Notificador = notificadorNoOp`, `GeocodeSaludService.ts` **pondrá ese test rojo** hasta que se añada a
la lista, con su comentario de ficha.

**Hecho cuando:** la lista incluye `GeocodeSaludService.ts`, y el test *«los defaults de TODOS los
services del censo son el no-op»* también pasa sobre él.

---

## Bloque 6 — Enganche y composition root

### T12 — Los tres puntos de llamada en `GeocodificacionService`
**Depende de:** T3, T10.

Un parámetro de constructor nuevo (`salud: IGeocodeSaludService = geocodeSaludNoOp`) y las tres
llamadas de `design.md` §5.3, con sus tres no-llamadas deliberadas. `registrarExitoProveedor` va
envuelto en `try/catch` que **registra con contexto** y sigue (**R20**), nunca un `catch` vacío.
**No se toca el desenlace de ningún job.**

**Hecho cuando:** `tests/unit/services/geocodificacion-service.test.ts` *(ext.)* está verde con un doble
de salud que cuenta llamadas, cubriendo **R6, R13, R14, R17, R20, R25**:
- `config_invalida` y credencial ausente → una llamada a `registrarFalloConfig`, y el `throw` **sigue
  ocurriendo igual** aunque la salud lance;
- `ok` del proveedor → una llamada a `registrarExitoProveedor`, **después** de escribir cache y orden;
- acierto de caché, `sin_resultados`, `consulta_invalida`, `SIN_DIRECCION`, orden borrada y
  `transitorio` → **cero** llamadas de ambos tipos;
- con `registrarExitoProveedor` lanzando, el job **se completa igual** y el fallo queda logueado.

### T13 — COMPOSITION ROOT + la mutación que prueba las guardias
**Depende de:** T9, T10, T12. **Esta task es el requisito R12.**

1. En `lib/services/jobs/geocodificacion-handler.ts`, `buildGeocodificacionService(now)` construye
   `GeocodeSaludRepository` + `loadGeocodeSaludConfig()` + `new GeocodeSaludService(…,
   notificarGeocodificacionCaidaReal, …)` y lo pasa a `GeocodificacionService`. Con el comentario
   ⚠️ que ya usan `corte-diario` y `generar-gastos-fijos`: **«esta línea es el requisito, no el import
   de arriba»**.
2. Guardia por SITIO en `tests/unit/services/notificacion-notificadores-reales.test.ts` *(ext.)*, molde
   literal de la de `generar-gastos-fijos`: `fuenteSinImportsNiComentarios(...)` debe contener
   `notificarGeocodificacionCaidaReal` **y** casar
   `/new GeocodeSaludService\([\s\S]*notificarGeocodificacionCaidaReal,?[\s\S]*\)/`, más la afirmación
   de que el `import` sigue ahí.
3. **PRUEBA DE LA PRUEBA, NO NEGOCIABLE.** Borrar **sólo el argumento** del cableado, dejando el
   `import` intacto, y correr: (a) la guardia por sitio del punto 2 y (b) la guardia derivada ya
   existente *«ningún notificador REAL puede quedarse sin composition root»*. **Las dos deben ponerse
   ROJAS.** Si alguna se queda verde, esa guardia no cubre este caso y hay que arreglarla **antes** de
   dar R12 por cumplido.

**Los destinatarios no entran aquí.** Las guardias de este bloque (y el censo de T11) miran **quién PASA
el notificador**, no a quién va dirigida la fila; que el aviso vaya a `maestro` y a `admin` se decide
río abajo, dentro del emisor, y lo fija T8. **No hay que tocarlas por la decisión de Q1** (`design.md`
§7.4, nota final).

**Hecho cuando:** el cableado está puesto, las guardias verdes con él, **y la salida real de las dos
corridas rojas de la mutación está pegada en `progress/impl_401_*.md`** — no afirmada de palabra
(memoria del repo: «arnés de mutaciones que miente»).

---

## Bloque 7 — Guardias de alcance

### T14 [P] — `tests/unit/guards/geocode-salud-sin-prosa.guardia.test.ts`
**Depende de:** T6, T10.

Guardia que **lee el árbol real** (patrón de los guards de la 368/400) y afirma sobre los archivos que
esta ficha toca:
- ningún predicado contiene los literales `REQUEST_DENIED` ni `config_invalida` (**R1**), con
  **contraprueba** (que detecte un literal introducido a propósito);
- ninguno **escribe** el marcador: el módulo de la 400 sigue siendo su único productor (**R33**);
- `lib/interfaces/repositories/IJobRepository.ts` no gana miembros por esta ficha (**R35**), afirmando
  sobre la lista de nombres de método.

**Hecho cuando:** verde, y la contraprueba demuestra que sabe ponerse roja.

### T15 [P] — Revisión de alcance en el informe
**Depende de:** T12, T13.

En `progress/impl_401_*.md`, con `git diff --stat` pegado: el diff **no** toca
`lib/services/JobQueueService.ts` (**R32**), ni `lib/services/AsignabilidadCoordenadasService.ts` ni
`app/(app)/_components/geocodificacion-motivo-messages.ts` (**R34**), ni crea tabla o columna (**R31**),
ni toca `lib/clients/google-geocode.ts` o `lib/config/geocode.ts` (**R28**).

**Hecho cuando:** el informe lo declara con la salida del comando, no de palabra.

---

## Bloque 8 — Trazabilidad y gate

### T16 — Mapa R → test en `progress/impl_401_*.md`
**Depende de:** T1-T15.

Copiar la tabla de trazabilidad de `requirements.md` y, por cada `R<n>`, anotar el **archivo y el nombre
del test real** que lo cubre. Los requisitos de NO-hacer (R31, R32, R34) quedan cubiertos por T15 y se
declaran como tales. **Un requisito sin test es un fallo de la feature** (`docs/specs.md`) y el reviewer
rechaza si falta alguno.

**Hecho cuando:** los 35 requisitos tienen fila con test o con la revisión de alcance que los cubre.

### T17 — Gate COMPLETO, no el rápido
**Depende de:** T16.

Esta ficha **toca cimientos**: hay dos migraciones y un contrato nuevo en `lib/interfaces/`. El modo
rápido **se niega solo** (regla 5 de `CLAUDE.md`), así que **`./init.sh` completo es obligatorio**.

- Escribir `INIT_EXIT=$?` **dentro** del log (memoria «el exit code que tapa un `echo`»).
- **Mirar los `skipped`, no sólo el `INIT_EXIT`:** sin `.env`, los ~78 archivos de `integration/db` se
  saltan y el gate dice «OK» habiendo probado **nada** de T7 ni de T5 — que son justo los que prueban
  el `WHERE` y la dedupe.
- No canalizar el log por `tail` (trunca el fichero en origen y el rojo se queda sin nombre).
- **No correr el gate en paralelo con ningún subagente que mute el árbol**: leería un árbol a medias y
  su veredicto no valdría.

**Hecho cuando:** `INIT_EXIT=0` con la lista de `skipped` revisada y pegada, y el conteo de tests de
`integration/db` **ejecutados** (no saltados) para T5 y T7.

### T18 — Commitear y verificar el blob
**Depende de:** T17.

Un commit por task lógica, mensajes `feat(401): …` / `test(401): …` / `chore(401): …`.
**Verificar el blob commiteado**, no el árbol de trabajo: otra sesión puede haber reseteado la rama, y
el árbol no distingue «lo commiteé» de «alguien lo revirtió». **No se toca `feature_list.json`** desde
dentro de la rama de la feature (se cuela en el merge y puede revertir cierres ajenos).

**Hecho cuando:** los archivos aparecen en `git show --stat` de la rama, y la rama está empujada.

---

## Grafo de dependencias, resumido

```
T0 ─┬─ T1 [P] ─┐
    ├─ T2 [P] ─┼─────────────┐
    ├─ T3 [P] ─┘             │
    ├─ T4 ── T6 ── T7 ───────┤
    └─ T5 ── T8 [P] ── T9 ───┤
                             ├── T10 ── T11
                             │      └──── T12 ── T13 ─┬─ T14 [P]
                             │                        └─ T15 [P]
                             └────────────────────────────┴── T16 ── T17 ── T18
```

**Paralelizable de verdad:** T1/T2/T3 entre sí; T4 y T5 entre sí; T8 con T6/T7; T14 con T15.
**Nunca en paralelo:** T17 con cualquier cosa que escriba en el árbol.
