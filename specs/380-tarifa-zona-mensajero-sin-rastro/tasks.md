# Ficha 380 — Tasks

**Rama:** `fix/380-tarifa-zona-mensajero-sin-rastro`, desde `dev`.
**Zona:** backend. **Sin trabajo de pantalla.**

## ✅ Las tres puertas humanas están FIRMADAS (2026-09-08) — no hay que preguntar nada más

| | Firma | Efecto en estas tareas |
| --- | --- | --- |
| **Q1** | **A favor:** tipo nuevo `zona_pago_mensajero_cambiado`, migración aditiva, **no** se reutilizan los `tarifa_*`. Coincidía con la recomendación del leader. | T1 y T2 siguen en pie tal cual. |
| **Q2** | **Solo el hecho, sin importes.** Firmada **en contra de la recomendación del leader**, que era guardar el antes y el después. | La fila va con `monto`, `valor_anterior` y `valor_nuevo` en `NULL`. **No se implementa ningún formateo de importes.** |
| **Q3** | **Solo la edición.** Firmada **en contra de la recomendación del leader**, que era cerrar también la creación. | **`ZonaRepository.create` NO SE TOCA.** Desapareció una tarea entera y una entrada del censo. |

⚠️ **Si algo de la implementación empieza a pedir importes en la fila, o a auditar `create`, se ha
salido de lo firmado.** No se «mejora» sobre la marcha: se vuelve al humano.

Queda la puerta de aprobación normal del arnés (`spec_ready` → «aprobado») antes de escribir código;
esa la gestiona el leader.

## ⛔ Condiciones de arranque (leer antes de crear el worktree)

1. **ESTA FICHA SE IMPLEMENTA SOLA.** Lleva migración, y **la base local es compartida entre
   worktrees**: aplicar un valor de enum nuevo pone rojo el gate de las demás features en curso, y
   `prisma generate` se pisa entre worktrees. No puede correr en paralelo con ninguna otra feature
   que toque la base. Está además declarado en la ficha: «EN ESPERA por lo mismo que la 381: lleva
   migración. Va detrás de ella, nunca a la vez».
2. **Choca en archivo con la 376 y la 377** (`lib/repositories/ZonaRepository.ts`). Las dos están
   **mergeadas**, así que eso ya no bloquea; lo que sí hay que hacer es partir de un `dev` fresco.
3. **El gate rápido se niega solo en esta ficha, y es un `fail`, no un aviso.** El diff toca
   `db/migrations/` y `lib/types/` (`init.sh:134`) y además archivos con nombre de dinero
   (`init.sh:135`, `pago`/`tarifa`). El gate que vale aquí es **`./init.sh` completo**, y lo corre el
   leader, no el subagente.
4. **Ningún subagente corre la suite completa.** `backend_dev` corre `pnpm typecheck`, `pnpm lint` y
   `pnpm exec vitest related --run <sus archivos>`.

---

## T0 — [BLOQUEANTE · MEDICIÓN, no razonamiento] El catálogo de la base local, medido

- [ ] Correr los archivos que afirman «el enum de la base ES el catálogo» **antes de tocar nada**:
      `pnpm exec vitest run tests/integration/db/historial-accion-zona-central-migration.test.ts tests/integration/db/historial-accion-orden-zona-reconciliada-migration.test.ts`
- [ ] Anotar el número de valores que tiene `historial_accion_tipo` en la base local **y** el de
      `HISTORIAL_ACCION_TIPOS` en `dev` HEAD.

**Por qué es bloqueante y no un trámite:** el 2026-09-07 un `down.sql` de otra rama **borró
`zona_central_cambiada` de la base local sin un solo error**. Si se arranca sobre una base así, el
test de esta migración saldrá rojo por un motivo ajeno y se perderá media jornada buscándolo en el
código nuevo. Si falta algún valor, se reaplican los `migration.sql` correspondientes
(`pnpm exec prisma db execute --file ./db/migrations/<carpeta>/migration.sql`; `ADD VALUE IF NOT
EXISTS` es idempotente) y se vuelve a medir.

**Hecho cuando:** los dos archivos pasan en verde **con base** (no `skipped`) y el número medido en la
base coincide con `HISTORIAL_ACCION_TIPOS.length` (**49** salvo que `dev` haya avanzado).

> ⚠️ Si el gate reporta esos archivos como `skipped`, **no** están en verde: falta `.env`. Un gate sin
> base salta 78 archivos de `integration/db` y aun así dice «init OK».

## T1 — El catálogo de TypeScript · depende de: T0

- [ ] `lib/types/historial-accion.ts`: añadir `zona_pago_mensajero_cambiado` a
      `HISTORIAL_ACCION_TIPOS` (**al final del bloque A.1**, que es donde `ADD VALUE` lo va a
      apender), a `CATEGORIA_POR_ACCION` (`mueve_dinero`) y a `ACCION_LABELS` («Cambió el pago al
      mensajero de una zona»), con el comentario del motivo a su lado, como los ocho anteriores.
- [ ] En ese comentario, dejar escritas **las dos firmas que definen el alcance**: solo el hecho (sin
      importes) y solo la edición (crear no registra). Es donde lo va a leer el siguiente.
- [ ] **No** tocar `HISTORIAL_ACCION_ENTIDADES`: `zona` ya está.

**Hecho cuando:** `pnpm typecheck` pasa. Los tres mapas son `Record` exhaustivos, así que olvidarse de
uno **no compila**.

## T2 — La migración · depende de: T1

- [ ] Crear `db/migrations/<timestamp>_historial_accion_zona_pago_mensajero/migration.sql` con **una
      sola sentencia**: `ALTER TYPE "historial_accion_tipo" ADD VALUE IF NOT EXISTS
      'zona_pago_mensajero_cambiado';` y su cabecera de comentarios (qué registra, por qué es
      «mueve dinero», por qué va sola, y que la fila NO lleva importes por firma de Q2).
- [ ] Escribir a mano el `down.sql`: `RENAME TO ..._old`, `CREATE TYPE` con **la lista previa (49)** =
      la del `CREATE TYPE` de `20260907130000_historial_accion_zona_central_cambiada/down.sql` **más**
      `'zona_central_cambiada'` al final, `ALTER COLUMN "accion" TYPE ... USING`, `DROP TYPE ..._old`.
- [ ] El `timestamp` de la carpeta debe ordenar **después** de todas las existentes en el momento de
      crearla. **No renumerar** una carpeta ya aplicada: deja una fila fantasma en `_prisma_migrations`
      que `migrate status` no ve.
- [ ] Aplicar con `pnpm run db:migrate` (o `prisma migrate deploy`) y confirmar el host con
      `prisma migrate status` (dice el host sin exponer credencial).

**Hecho cuando:** `migrate status` muestra la migración aplicada y ninguna pendiente, y el `down.sql`
existe (la ausencia de `down.sql` es un anti-patrón que el reviewer rechaza).

## T3 — [P con T4] Test de la migración · depende de: T2

- [ ] `tests/integration/db/historial-accion-zona-pago-mensajero-migration.test.ts`, calcado de
      `historial-accion-zona-central-migration.test.ts`, con **una mejora obligatoria**: las carpetas
      del estado previo se **descubren leyendo `db/migrations`** (las que nombran
      `historial_accion_tipo` y ordenan antes que ésta), no se escriben como constantes.
- [ ] Bloque estático (corre sin base): el `up` es UNA sentencia `ADD VALUE`, no toca tablas ni datos,
      no nombra `historial_accion_entidad`; el `down` **no** nombra el valor nuevo y solo recastea
      `accion` (R14).
- [ ] Bloque (a): los valores del enum de `public` == `HISTORIAL_ACCION_TIPOS`, comparado **contra el
      catálogo y nunca contra un número congelado**; y el valor nuevo va **después** de
      `zona_central_cambiada` (R13).
- [ ] Bloque (b): estado previo reconstruido ejecutando las migraciones REALES → aplicar `up` →
      aplicar `down` → `expect(trasDown).toEqual(antes)` valor a valor y en orden; **y** afirmar que
      el estado previo reconstruido es `HISTORIAL_ACCION_TIPOS` menos el valor nuevo (R15).
- [ ] Bloque (c): con una fila que usa el valor nuevo, el `down` **rechaza** y la fila sigue ahí (R16).

**Hecho cuando:** el archivo pasa **con base**, y una comprobación manual lo confirma: quitarle un
valor a la lista del `down.sql` pone rojo el bloque (b) **diciendo cuál falta**. Anotar esa prueba en
`progress/impl_380.md`.

## T4 — [P con T3] El comparador puro y su guardia · depende de: T0

- [ ] `lib/repositories/_shared/pago-mensajero-cambio.ts`: `PagoComparable` +
      `cambioElPagoAlMensajero(previos, nuevos): boolean`. Sin `id` en el tipo. Comparación por
      `vehiculoId` y por `toFixed(2)` de cada importe. **Ni `Number(`, ni `parseFloat(`, ni
      `.toNumber(`, ni aritmética.**
- [ ] `tests/unit/repositories/pago-mensajero-cambio.test.ts`: alta, baja, cambio de un importe,
      cambio de los dos, mismo conjunto en otro orden, `1500` frente a `1500.00`, vacío contra vacío,
      pago por defecto (`vehiculoId: null`) contra pago con vehículo. Con `Prisma.Decimal` reales.
- [ ] `tests/unit/guards/pago-mensajero-money-safe.guardia.test.ts`: barrido del módulo sin
      comentarios + **contraprueba** que inyecta cada conversión prohibida y comprueba que el detector
      la ve (una guardia estática rota no falla: calla).

**Hecho cuando:** `pnpm exec vitest related --run lib/repositories/_shared/pago-mensajero-cambio.ts`
verde, y **una mutación deliberada** del comparador (devolver siempre `true`) pone rojo al menos un
caso. Anotarlo.

## T5 — `ZonaRepository.update` · depende de: T1, T4

- [ ] Lectura de `pagosPrevios` **junto a `distritosPrevios`**, antes del `deleteMany` de pagos, con
      `select` **sin `id`**.
- [ ] Mover la lectura final de tarifas (hoy la última sentencia antes del `return`) a justo después
      del `createMany`, conservando su `select` completo: la sigue consumiendo `toDTO`.
- [ ] Bloque `appendAccion` nuevo, **dentro del callback**, recibiendo **`tx`** (jamás `this.prisma`),
      con `lote_id` propio, condicionado a `cambioElPagoAlMensajero(...)`, y con `monto`,
      `valorAnterior` y `valorNuevo` ausentes (van a `NULL` por defecto en `appendAccion`).
- [ ] Comentario en el sitio explicando por qué la lectura previa va donde va, por qué el lote es
      propio, y **qué NO lleva la fila y por qué** (firma de Q2: el registro no podrá reconstruir de
      cuánto a cuánto). El archivo documenta sus decisiones; es su estilo.
- [ ] **`create` y `hardDelete` NO SE TOCAN** (R5, firma de Q3).

**Hecho cuando:** `pnpm typecheck` y `pnpm lint` verdes, y
`pnpm exec vitest related --run lib/repositories/ZonaRepository.ts` verde **sin relajar ninguna
aserción existente**. Si un caso de `tests/unit/repositories/zona-repository.test.ts` se pone rojo,
mirar si ese literal ES el contrato antes de tocarlo.

## T6 — El censo de la guardia y su contraprueba de TRES llamadas · depende de: T5

- [ ] `tests/unit/guards/historial-accion-escrituras-cubiertas.guardia.test.ts`: **una** entrada nueva
      en el `CENSO` —`ZonaRepository.update`, `forma: "abre_tx"`,
      `mutacion: /tx\.tarifaZonaMensajero\.deleteMany\(/`—, con el comentario de por qué es una entrada
      aparte de las de la 366 y la 376 aunque compartan método (el censo mide UNA mutación por
      entrada), **y de por qué no hay entrada para `create`** (firma de Q3).
- [ ] `expect(HISTORIAL_ACCION_TIPOS).toHaveLength(49)` → **50**, actualizando el comentario que
      explica de dónde sale el número.
- [ ] **Contraprueba nueva con TRES llamadas** en el bloque de auto-prueba del detector: un
      `CUERPO_TRES_REGISTROS` sano que no produce fallos, más dos mutaciones de **la tercera**
      (`this.prisma` en vez de `tx`, y fuera del callback) que el detector tiene que cazar.

**Por qué esta contraprueba y no se da por buena la de la 376:** el detector recorre todas las
llamadas desde la 376 (`llamadasAAppendAccion`), pero **su auto-prueba solo enumera dos**. Una guardia
que nunca se ha ejercido en la forma que va a vigilar no está probada, y esta ficha es justo la que
lleva el método a tres.

**Hecho cuando:** el archivo pasa, y **cada** contraprueba nueva se verifica invirtiéndola (comentar
la mutación y ver el caso ponerse rojo).

## T7 — [P con T6] Números duros del catálogo · depende de: T1

- [ ] `tests/unit/historial-accion/catalogo-y-choke-point.test.ts`: 49 → **50** (dos aserciones) y
      `mueve_dinero` 27 → **28**, con el comentario del motivo.
- [ ] `tests/integration/db/historial-accion-orden-zona-reconciliada-migration.test.ts`: añadir el
      valor a `POSTERIORES`, en su sitio de la cadena.

**Hecho cuando:** los dos archivos pasan (el segundo, **con base**).

## T8 — El test de comportamiento contra Postgres real · depende de: T2, T5

- [ ] `tests/integration/db/zona-pago-mensajero-rastro.test.ts`, colgado del arnés de
      `tests/integration/db/_postgres-real.ts` y con la misma cabecera de «por qué este archivo es
      obligatorio» que `zona-central-guarda-y-rastro.test.ts`.
- [ ] Casos: **R1** (cambia un importe → 1 fila con la zona correcta), **R2** (solo el nombre → 0
      filas; y solo la marca de central → 0 de este tipo y sí la de la 376), **R3** (mismo conjunto
      exacto → los `id` **cambiaron** y 0 filas), **R5** (crear una zona **con** pagos → **0** filas
      de este tipo; borrar una zona con pagos → `zona_borrada` y **0** de este tipo), **R6/R7**
      (actor congelado; actor `null` → los tres campos en `NULL`), **R8** (`monto`, `valor_anterior`,
      `valor_nuevo` en `NULL`), **R10** (guardado que reconcilia + mueve la marca + cambia el pago →
      **tres** `lote_id` distintos), **R11b** (guardado que revienta por un `distritoId` inexistente →
      0 filas y pagos intactos), **R12** (`not_found` y `sin_zona_central` → 0 filas y pagos
      intactos), **R18** (tras guardar, la tabla contiene exactamente los pagos del payload).
- [ ] Los dos casos de **R5 llevan un comentario que diga que son la firma de Q3**, no un olvido: es
      lo que impide que alguien los «arregle» dentro de seis meses sin saber que se decidió.
- [ ] **Anti-vacuidad, obligatorio:** sin base → `describe.skip` VISIBLE; con base y sin catálogo →
      **lanzar** con el mensaje de qué seed correr. **Prohibido `if (!datos) return;`**. Cada caso
      afirma su premisa antes que su efecto.

**Hecho cuando:** el archivo pasa con base **y** una mutación deliberada lo pone rojo: cambiar
`where: { zonaId: id }` de la lectura previa por `where: {}` tiene que romper al menos un caso.
Anotar la mutación y su resultado en `progress/impl_380.md` (un arnés de mutaciones que no enseña la
salida del test ya mintió en este repo).

## T9 — Trazabilidad y notas · depende de: T3, T4, T6, T7, T8

- [ ] `progress/impl_380.md`: archivos tocados, mapa **R1–R18 → test concreto**, salida de los tests,
      las mutaciones probadas y sus resultados, y **las tres firmas del 2026-09-08 con quién decidió
      qué** (incluido que Q2 y Q3 se firmaron en contra de la recomendación del leader).
- [ ] Dejar escrito en el informe el **límite aceptado**: el registro no podrá reconstruir de cuánto a
      cuánto, y crear una zona sigue sin dejar rastro de sus pagos. No son deuda a resolver: son
      alcance firmado.
- [ ] **Commitear el informe.** Tres veces en un día se ha quedado sin commitear y un `git checkout`
      se lo llevó.

**Hecho cuando:** no queda ningún `R<n>` sin test nombrado. Un requisito sin test es un fallo de la
feature y el reviewer lo rechaza.

## T10 — Sincronización, gate y PR · depende de: T9 · **lo corre el leader**

- [ ] `git fetch origin dev` + `git merge origin/dev` en la rama.
- [ ] **Si el merge trae una ampliación nueva de `historial_accion_tipo`:** el `down.sql` de T2 está
      **rancio**. El test de T3 debería ponerse rojo solo (por eso descubre las carpetas en vez de
      listarlas); si no lo hace, es un defecto del test. Actualizar la lista y volver a T3.
- [ ] `./init.sh` **completo** (el rápido se niega en esta ficha) y confirmar `INIT_EXIT=0` **escrito
      dentro del log**, no leído de un `echo`.
- [ ] Comprobar en el log que los archivos de `tests/integration/db` salen **ejecutados**, no
      `skipped`.
- [ ] PR hacia `dev`. Recordar que un check verde de Vercel es un build, no la suite.

**Hecho cuando:** gate completo en verde con la base conectada, y el PR abierto con su URL reportada.

---

## Resumen de dependencias

```
T0 (medición) ─┬─> T1 ─> T2 ─> T3 ─┐
               └─> T4 ─────────────┤
                    T1,T4 ─> T5 ─> T6 ─┼─> T9 ─> T10
                    T1 ────────────> T7 ┤
                    T2,T5 ─────────> T8 ┘
```

`[P]`: **T3 ∥ T4** (uno es SQL y su test, el otro un módulo puro) y **T6 ∥ T7** (archivos distintos).
Todo lo demás es secuencial: las tareas de código tocan el mismo archivo o dependen de la migración
aplicada.

**Lo que desapareció con la firma de Q3:** la tarea de `ZonaRepository.create` y su entrada del censo.
No se «dejan para después»: no se hacen.
