# Revisión — Ficha 373 · Eliminar una API key

> Reviewer, 2026-09-04. Rama `feat/373-eliminar-api-key`, medida contra `origin/dev`.
> Commits revisados: `8b5e1187` (ficha en curso) · `e557d37c` (backend: datos, dominio, borde) ·
> `fe93c92c` (spec commiteado) · `287142bb` (guardia de FKs) · `56a2dbb7` (pantalla).
> Diff total: 52 archivos, +5.753 / -53.
>
> **Herramienta:** el MCP `codebase-memory` estaba disponible bajo
> `R-job-singularis-projects-ordenex`, pero esta revisión se hizo leyendo los archivos reales y el
> diff completo (`git diff origin/dev...HEAD`), que es lo que exige el encargo: el índice puede
> devolver de más y aquí lo que importa es lo que hay en el árbol.

---

## 0. Veredicto

**RECHAZADO** — y conviene decir de qué tipo es el rechazo antes de la lista: **no hay ni un solo
hallazgo contra el código**. La implementación, la atomicidad, el guard, la fila de auditoría y la
pantalla están bien hechos y verificados; lo que falta son **los artefactos de cierre que
`CHECKPOINTS.md` exige y que no existen en disco**: `progress/impl_373.md` (el mapa `R -> test`),
las 29 tareas de `tasks.md` sin marcar, y la verificación en la pantalla real (H3) sin registro.

Se levanta la mano por eso y solo por eso. Con esos tres puntos resueltos, esto pasa a `OK` sin
tocar una línea de `lib/`, `app/` ni `tests/`.

---

## 1. `CHECKPOINTS.md`, punto por punto

### Especificación
- [x] `specs/373-eliminar-api-key/requirements.md` con requisitos EARS numerados `R1`...`R39`.
- [x] `design.md` con alternativas descartadas y su porqué (**ocho**: A1-A8, con el motivo escrito
      y las decisiones del humano fechadas).
- [ ] **`tasks.md` con todas las tasks marcadas `[x]`** -> **0 de 29 marcadas**. El archivo
      commiteado en `fe93c92c` sigue con las 29 casillas vacías, incluidas las que demostrablemente
      se hicieron (A1-A5, B1-B3, C1-C6, D1-D2, E1, F1-F2, G1-G5). **BLOQUEANTE.**

### Trazabilidad
- [x] Cada `R<n>` mapea a al menos un test concreto -> **las 39 verificadas una a una** (§2). No se
      usó la tabla de los implementadores: se abrió cada test y se comprobó qué ejercita.
- [ ] **`progress/impl_373.md` contiene el mapa `R<n> -> test`** -> **el archivo NO EXISTE**, ni
      commiteado ni en el árbol de trabajo (`git diff --name-only origin/dev...HEAD` no lista nada
      bajo `progress/`). Es la tarea **H1**, y su propio criterio decía «existe, está commiteado y
      las 39 filas apuntan a tests que existen». **BLOQUEANTE.**

### Calidad de código (corrido por el reviewer, no heredado de la bitácora)
- [x] `pnpm run typecheck` -> `TC_EXIT=0`.
- [x] `pnpm run lint` -> `LINT_EXIT=0` (149 warnings preexistentes, 0 errores).
- [x] Tests de la ficha, corridos aparte: **17 archivos / 328 tests unitarios en verde** y
      **7 archivos / 49 tests de integración contra Postgres real en verde, 0 `skipped`**
      (`.env` presente; si hubieran salido saltados el veredicto no valdría).
- [x] `pnpm run test:guardias` -> **185 archivos / 2.795 tests en verde**, incluida
      `superficie-de-uso` (la anotación `@sin-superficie` de `eliminarApiKey` se borró al llegar la
      pantalla, y la guardia lo confirma en las dos direcciones).
- [x] Gate completo `./init.sh` -> lo corrió el leader sobre estos commits (`INIT_EXIT=0`, 24.510
      tests, 26 `skipped` preexistentes). **No se repite**, pero nada de lo que he medido lo
      desmiente: mis cuatro corridas independientes coinciden.
- [~] E2E de flujo crítico -> **INAPLICABLE**, con el criterio ya establecido en este repo: existe
      `e2e/` con specs de Playwright pero **sin harness que las ejecute** (varias llevan escrito
      «NOT EXECUTED»). El riesgo se cubre por otra vía: 5 archivos de integración contra Postgres
      real + la verificación manual en pantalla... que es justo la que **no** está registrada (H3,
      abajo).

### Datos y seguridad (Supabase)
- [x] RLS -> **no hay tabla nueva**: la única migración es `ALTER TYPE ... ADD VALUE`. `api_key`,
      `usuario`, `webhook_suscripcion` e `historial_accion` conservan su RLS sin tocar. El test de
      migración lo comprueba además contra `information_schema` (ni `deleted_at`, ni
      `archivada_at`, ni `eliminada_at` en `api_key`).
- [x] Migración versionada y reversible -> `20260904120000_historial_accion_api_key_eliminada/`
      con `migration.sql` **y** `down.sql`.
- [x] Ningún secreto hardcodeado. Ni el `plainKey`, ni el `key_hash`, ni el `key_prefix` cruzan por
      ningún camino nuevo (verificado en la fila de auditoría, en el retorno de la action, en el
      DTO y en el marcado renderizado).
- [~] Webhooks: firma/idempotencia -> **no aplica**: esta ficha no crea ni recibe webhooks. Lo que
      hace es **borrar** la suscripción de la cuenta dedicada, con `deleteMany` (idempotente: cero
      filas es un caso normal) y **acotado a `ownerUsuarioId`**.

### Patrón de capas
- [x] La Server Action no tiene queries ni reglas: sesión -> `zod` -> `service.eliminar`.
- [x] El service no conoce HTTP; corre entero sin Prisma en su archivo de test.
- [x] El repositorio no clasifica: devuelve `estado` y `dependencias` **crudos** y el motivo lo
      decide `motivoNoEliminable` en el service. Hay un test dedicado a ese límite.
- [x] Interfaces en `lib/interfaces/{repositories,services}/`, una por archivo.

### Permisos
- [x] `configuracion/api/page.tsx` valida `maestro` en el servidor antes de renderizar el módulo.
- [x] Doble capa: actor en la action (R19) + `ALLOWED_ROLES` en el service (R18), y el test recorre
      **todos** los roles del enum, no una lista paralela.
- [x] Mutación por Server Action, no por route handler.

### Multi-país / configuración
- [x] Nada de país, moneda ni cuenta. El único vocabulario nuevo son cinco motivos cerrados.

### Verificación final
- [x] `./init.sh` en verde (leader) + mis corridas.
- [ ] `progress/review_373.md` con veredicto `OK` -> **este archivo, con veredicto RECHAZADO**.
- [ ] Entrada en `progress/history.md` -> **no existe ninguna mención a la 373** (`grep` sin
      resultados). Pendiente del leader al cerrar.

---

## 2. Trazabilidad `R1`-`R39`: las 39, verificadas en el archivo

Convención de la última columna: *código* = leí la aserción y ejercita lo que dice el requisito;
*(mutación X)* = además la maté con una mutación real del árbol (§3).

| R | Test que lo cubre (archivo · caso) | Cómo se comprobó |
| --- | --- | --- |
| R1 | `tests/unit/components/api-key-eliminar.ui.test.tsx` · «la celda pinta Eliminar además de Rotar y Activar/Desactivar» | código |
| R2 | `tests/integration/db/api-key-eliminar.test.ts` · «una key `inactiva` se lleva su fila, su cuenta dedicada y su webhook» (censo antes {1,1,1} -> después {0,0,0}) + «sin webhook se borra igual» | Postgres real |
| R3 | idem · «eliminar una key deja INTACTA a la otra, con su cuenta y su webhook» + `tests/unit/repositories/api-key-repository.eliminar.test.ts` · «los dos `delete` van por id» / «no se ACTUALIZA nada» | Postgres real |
| R4 | idem · «si el REGISTRO falla, NO queda borrada ni una de las tres filas» (`clienteConSavepoint(tx, true)` rompe `historialAccion.createMany`; el fallo se propaga y el censo vuelve a {1,1,1}). La dirección contraria -un `delete` que revienta y no deja fila de auditoría- la cubre `api-key-eliminar-fk-inesperada.test.ts` | Postgres real, con SAVEPOINT de verdad |
| R5 | `tests/integration/db/api-key-eliminar-tienda-destino.test.ts` · la tienda, sus 2 órdenes y su webhook siguen ahí; `ownerResuelto !== cuentaDedicada` | Postgres real (mutación C) |
| R6 | idem R2 · «tras eliminar, el identificador vuelve a estar LIBRE»: **antes** del borrado el mismo identificador da `conflict`, después da `ok` | Postgres real |
| R7 | `tests/unit/services/api-key-service.eliminar.test.ts` · «el servicio no expone ningún método de restauración» (con anti-vacuidad: exige que `eliminar` SÍ esté en la lista) + los censos a cero de la integración | código |
| R8 | `tests/integration/db/api-key-eliminabilidad.test.ts` · «con UNA orden viva» **y** «con SOLO una orden BORRADA -> ordenes: true», comprobando antes que la fila está realmente soft-deleted | Postgres real (mutación B) |
| R9 | idem · «un movimiento del libro de tienda» **y** «un pago de liquidación», por separado (si se cayera el OR, uno de los dos lo dice) | Postgres real |
| R10 | idem · «con una tarifa configurada -> tarifas: true» | Postgres real |
| R11 | R2 · «la MISMA key, `activa`, sale `bloqueada` y no se borra NADA; desactivar no borró nada; desde `inactiva` sí se borra» + `api-key-repository.eliminar.test.ts` · «no llega ni a ejecutar el EXISTS» + service + tipos | Postgres real (mutación A) |
| R12 | `api-key-service.eliminar.test.ts` (un caso por motivo) + `api-key-repository.eliminar.test.ts` · «bloqueada y CERO escrituras» (ni webhook, ni key, ni usuario, ni registro) | código |
| R13 | `tests/unit/types/api-key-motivo-no-eliminable.test.ts` · las **16** combinaciones (2 estados x 8), con anti-vacuidad del producto cartesiano, más la precedencia caso a caso | código |
| R14 | `...api-key-eliminar.ui.test.tsx` · fila no eliminable -> Rotar y Desactivar **habilitados** y su acción sigue funcionando | código |
| R15 | `api-key-repository.eliminar.test.ts` · el orden EXACTO de llamadas (transacción -> `findUnique` -> `$queryRaw` -> actor -> `deleteMany` -> `delete` -> `delete` -> `createMany`) y «el guard va antes que la PRIMERA escritura, no solo antes del delete» | código |
| R16 | `tests/integration/db/api-key-eliminar-fk-inesperada.test.ts` · fila real en `orden_habilitacion_api` que el guard NO mira -> el guard dice «limpia», el borrado sale `bloqueada`, y **key, webhook y usuario siguen a 1** (sin borrado parcial) y el registro a 0. Más: la transacción abortada no deja la sesión rota | Postgres real |
| R17 | `tests/unit/guards/api-key-dependencias-usuario.guardia.test.ts` + censo en `tests/fixtures/api-key-dependencias-usuario.ts` · las 53 relaciones del esquema clasificadas, con **cuatro contrapruebas** (relación nueva, entrada borrada, motivo vacío, entrada rancia) | código |
| R18 | `api-key-service.eliminar.test.ts` · **todos** los roles del enum menos `maestro` -> `forbidden` sin llamar al repositorio (los demás métodos del doble lanzan si se tocan) | código |
| R19 | `tests/unit/actions/api-keys-eliminar.test.ts` · sin sesión -> `unauthenticated`; y la sesión se comprueba **antes** que el schema | código |
| R20 | idem · id no uuid, clave desconocida, sin `id` -> `validation_error` sin tocar el service; y contraprueba de que `apiKeyIdSchema` **no** se volvió estricto | código |
| R21 | idem / service / repo / integración · id inexistente -> `not_found`, y un P2025 de carrera también | código + Postgres real |
| R22 | R2 · **exactamente una** fila; `tests/unit/guards/historial-accion-escrituras-cubiertas.guardia.test.ts` · entrada de censo con forma `abre_tx` y la mutación `tx.apiKey.delete(` | código + Postgres real (mutación D) |
| R23 | R2 · `SELECT *` crudo de la fila y `not.toContain` de plainKey, key_hash, keyPrefix, email sintético y el prefijo de marca, con anti-vacuidad (los tres secretos existen y miden >30 / >5) | Postgres real |
| R24 | idem · `actorUsuarioId`, `actorNombre` (contiene el nombre real del maestro), `actorRol = maestro`, `valorAnterior = "inactiva"`, `valorNuevo = null` | Postgres real |
| R25 | `tests/unit/historial-accion/catalogo-y-choke-point.test.ts` · categoría `cambia_permisos`, las **cinco** de API key en la misma categoría, etiqueta «Eliminó una API key», reparto 26/7/12; + `lectura-borde-y-servicio.test.ts` (el filtro por categoría la incluye: 7+12) | código |
| R26 | R2 · la fila se lista por el **`HistorialAccionRepository` real** con la key ya inexistente (existeLaKey === 0) | Postgres real |
| R27 | `tests/integration/db/api-key-eliminada-migration.test.ts` · el `down.sql` recrea los 44 previos **derivados del down de la 371 + el valor que aquella añadió** (no de sí mismo), no incluye el valor nuevo, conserva el USING que revienta, y no hay DELETE/UPDATE sobre `historial_accion` | código (ver menor 5) |
| R28 | `...api-key-eliminar.ui.test.tsx` · un caso por **cada uno de los cuatro motivos**: botón `disabled`, nombre accesible con el motivo y `title` idéntico; más «una fila eliminable no lleva excusa» y «desde una fila bloqueada nunca se llama a la acción» | código |
| R29 | idem · abrir la confirmación no llama a la acción; y **no** pide teclear el identificador (decisión del humano) | código |
| R30 | idem · nombra la key y las **tres** consecuencias, dentro del `role="alert"`, con los textos literales escritos a mano en el test (no importados de su propia fuente) | código |
| R31 | idem · «La API key ya está desactivada: dejarla así revoca el acceso sin borrar nada.» | código |
| R32 | idem · Cancelar cierra sin acción, sin `onMutated` y sin `onEliminada` | código |
| R33 | idem · llama con el id, `onMutated` **antes** de cerrar, aviso «API key eliminada»; más anti-doble-submit | código |
| R34 | idem · los cuatro casos (forbidden, unauthenticated, not_found, bloqueada) con mensaje propio, que además se comprueba que son distintos entre sí; y `bloqueada` dice el motivo concreto en sus cuatro variantes | código |
| R35 | `tests/unit/components/api-keys-module.eliminar.test.tsx` · borrada la única fila de la página 2 pide la página 1; y los tres contraejemplos (página 1, página con 2 filas, borrado fallido) | código |
| R36 | `...api-key-eliminar.ui.test.tsx` · ni el texto ni el marcado contienen el prefijo, un hash de 32+ hex ni el `usuarioId`, con anti-vacuidad de las dos fases; + acción y service | código |
| R37 | `tests/unit/descarga/api-keys-descarga-columnas.test.ts` · las claves de la fila son exactamente `COLUMNAS_DESCARGA_API_KEYS`, sin `eliminable` ni `motivoNoEliminable`, y ningún valor «ordenes» | código |
| R38 | `tests/unit/repositories/api-key-repository.list.test.ts` · 25 filas = **las mismas 3 consultas** que 1; `tests/unit/services/api-key-service.listar.test.ts` · una sola llamada con la lista completa de ids | código |
| R39 | `...api-key-eliminada-migration.test.ts` · el SQL **ejecutable** (sin comentarios) no crea tabla, columna, índice ni fila, ni menciona `deleted_at`; y la base aplicada no tiene columnas de archivado en `api_key` | código + Postgres real |

**Ningún `R` queda sin trazar.** Y ningún test de esta ficha cae en el patrón «verde sin comprobar
nada»: los cinco archivos de integración usan `describe.skip` cuando no hay `DATABASE_URL` (y aquí
sí la había: 49 pasados, **0 saltados**) y, cuando falta un dato de siembra, **lanzan** con el
comando que lo arregla en vez de devolver verde.

---

## 3. Mutaciones que corrió el reviewer (no las heredadas)

Cuatro mutaciones aplicadas al árbol real, corridas y **revertidas con `git checkout`**
(`git status` limpio tras cada una):

| # | Mutación en `lib/repositories/ApiKeyRepository.ts` | Resultado |
| --- | --- | --- |
| A | la condición `fila.estado === "activa"` sustituida por `false` (mata R11) | **CAZADA**: 3 tests rojos (unit + integración) |
| B | añadir `AND o."deleted_at" IS NULL` al EXISTS de órdenes (mata R8) | **CAZADA**: rojo el caso «con SOLO una orden BORRADA» |
| C | quitarle el `where` al `deleteMany` del webhook (mata R5/R3) | **CAZADA**: 2 rojos, incluido «el borrado se llevó la suscripción de la TIENDA: R5 roto» |
| D | pasarle a `appendAccion` el cliente en vez de la `tx` (registro FUERA de la transacción) | **CAZADA** por la guardia del punto único, nombrando `ApiKeyRepository.ts#eliminar` |

La D es la que más importa para el encargo: es la mutación que **sobrevivió** en la primera vuelta
del backend, y la respuesta no fue solo arreglar el código sino **añadir el chequeo estructural** a
`historial-accion-escrituras-cubiertas.guardia.test.ts` («no le pasa a `appendAccion` la `tx`, sino
otro cliente») con su propia contraprueba. Eso protege a las 45 acciones del catálogo, no solo a
ésta.

---

## 4. Lo que el encargo pidió mirar con lupa

**Atomicidad real.** `ApiKeyRepository.eliminar` abre **una** transacción y hace los tres borrados y
el `appendAccion` dentro, en el único orden que las FK admiten (webhook -> key -> usuario;
`api_key.usuario_id` es `Restrict`). No hay ningún `try` de rescate DENTRO de la transacción, que es
lo correcto: un error de sentencia aborta la transacción entera. Las **dos** direcciones están
medidas contra Postgres, no razonadas: si falla el registro, las tres filas siguen vivas (R4); si
falla un borrado por una FK que el guard no mira, **nada** se borró y no hay fila de auditoría
(R16). El `catch` exterior solo traduce dos formas de error (registro ausente -> `not_found`,
violación de FK -> `bloqueada`) y **re-lanza cualquier otra cosa**.

Detalle que merece mención expresa: `lib/repositories/_shared/prisma-fk.ts` documenta -medido, con
la traza pegada- que bajo `@prisma/adapter-pg` una violación `RESTRICT` **no** llega como `P2003`
sino como `DriverAdapterError` con `cause.code = "23001"`. Un `catch` ingenuo habría convertido R16
en un 500. Está cubierto por tests con las tres formas del error.

**La fila de auditoría.** Dentro de la transacción (verificado por la mutación D), exactamente una,
con la etiqueta derivada del identificador visible, `valorAnterior` = estado previo y `valorNuevo`
nulo. El test lee **todas** las columnas con `SELECT *` y descarta secreto, hash, prefijo, email
sintético y cualquier cadena con el prefijo de marca. La advertencia queda escrita también en el
propio SQL de la migración.

**El `down.sql`.** Recrea los 44 previos en el mismo orden, y la lista está **derivada** del
`down.sql` de la 371 (43) más `gestion_fecha_reprogramacion_corregida`: lo comprobé por mi cuenta
con un `diff` de los dos ficheros y la única diferencia es exactamente ese valor, al final.
**Ningún `down.sql` anterior fue tocado**: `git diff --name-only origin/dev...HEAD` sobre
`db/migrations/**/down.sql` devuelve un único archivo, el nuevo. Y hay un test que lo vigila desde
el otro lado (el down de la 371 sigue con SUS 43 y sin el valor nuevo).

**Tests verdes sin comprobar nada.** No encontré ninguno. Al contrario: hay aserciones de
anti-vacuidad puestas a propósito justo donde el fallo mudo era posible (el extractor de
relaciones, la tabla de 16 combinaciones, los secretos del test de R23, el diálogo de R36, el
listado de métodos de R7 y el parser del `CREATE TYPE`).

---

## 5. Hallazgos

### BLOQUEANTES

1. **`progress/impl_373.md` no existe.** Ni commiteado ni en el árbol. Es el checkpoint explícito
   «`progress/impl_<feature>.md` contiene el mapa `R<n> -> test`» y la tarea **H1**, cuyo criterio
   exigía además que estuviera **commiteado**. Sin él, la ficha se cerraría sin registro propio de
   qué cubre qué, y el trabajo de reconstruirlo (que he hecho aquí desde cero, archivo por archivo)
   recae en quien venga después. *Para levantarlo:* escribir el archivo con las 39 filas -la tabla
   de §2 sirve de base- más lo que la bitácora debe contener y hoy no está en ninguna parte: las
   mutaciones que corrieron backend y frontend, el `INIT_EXIT` con su recuento de `skipped`, y los
   seis puntos de H3.

2. **`specs/373-eliminar-api-key/tasks.md` tiene 0 de 29 tareas marcadas `[x]`.** Checkpoint
   «Especificación» incumplido de forma literal. No es un tecnicismo: con todas las casillas vacías
   el archivo no distingue lo hecho de lo pendiente, y esta misma ficha tiene **una** tarea que de
   verdad quedó sin hacer (la siguiente). *Para levantarlo:* marcar las hechas -lo están T0.1,
   T0.2, A1-A5, B1-B3, C1-C6, D1-D2, E1, F1-F2, G1-G5 y H2, todas verificadas en el árbol- y dejar
   sin marcar solo lo que falte.

3. **H3 -verificación en la pantalla real- sin ninguna evidencia.** No hay registro de que se
   levantara la app y se miraran los seis puntos (botón apagado diciendo «Está activa. Desactívala
   antes de eliminarla»; que al desactivar se habilite; que se elimine y desaparezca del listado;
   que el registro de acciones muestre «Eliminó una API key»; que el identificador se pueda reusar;
   que una key con órdenes siga bloqueada). Pesa más de lo normal aquí por tres razones concretas:
   **(a)** el checkpoint de E2E es inaplicable en este repo, así que H3 es *la* verificación de lo
   que el usuario ve; **(b)** la lección de la ficha 372 -desplegada con 24.333 tests en verde y
   rota en pantalla, encontrada por el humano con una captura- es de anteayer y de esta misma pila
   de Configuración; **(c)** la acción es **irreversible y se lleva una cuenta de usuario**: el
   precio de un fallo mudo aquí no es cosmético. *Para levantarlo:* hacerlo y anotar **lo que se
   vio**, no lo que se esperaba.

### Menores (no bloquean; se dejan escritos)

1. **`progress/history.md` no menciona la 373.** Es el último checkpoint de la lista y le toca al
   leader al cerrar. Se anota para que no se pierda.

2. **El extractor de la guardia de FKs solo ve `@relation(...)` cuando cabe en UNA línea.**
   Comprobado hoy: las 53 relaciones tipadas `Usuario` del esquema están todas en una línea, así
   que **no hay hueco real ahora mismo**. Pero una declaración futura partida en varias líneas se
   saltaría el detector **en silencio**, y la anti-vacuidad (`> 40 relaciones`) no cazaría que
   falte *una*. Vale una nota en el archivo o una ficha pequeña.

3. **`LoginAttempt.usuario` está clasificada como `se_borra_con_ella`, y su fila NO se borra**: su
   FK es SET NULL, así que lo que desaparece es el vínculo. El motivo lo dice con todas las letras
   y el test lo trata aparte, así que no engaña a nadie; pero el título del caso («las **dos** que
   se borran CON la cuenta») afirma dos y la lista tiene tres. Cosmético.

4. **El borrado de `usuario` no comprueba que la cuenta sea de rol `apiKey`.** Hoy es inalcanzable:
   `api_key.usuario_id` es `@unique` y la única escritura es `createConUsuario`, que **crea** esa
   cuenta en la misma transacción. Se deja apuntado como endurecimiento barato (leer el rol en el
   paso 1 y negarse si no es `apiKey`), porque lo que hay al otro lado del `delete` es una cuenta
   de usuario y el guard por datos no protegería a una cuenta de operador sin órdenes ni dinero.

5. **R27 se verifica por el TEXTO del `down.sql`, no ejecutándolo.** El test comprueba que está el
   `USING` que revienta y que no hay `DELETE`/`UPDATE` sobre `historial_accion` -que es lo que R27
   prohíbe-, pero nadie corrió `pnpm run db:rollback` con una fila `api_key_eliminada` presente
   para verlo fallar. La tarea **A2** lo pedía en su «hecho cuando». Sin `impl_373.md` no hay forma
   de saber si se hizo. Es menor porque el mecanismo es el mismo, ya probado, de las dos
   migraciones anteriores del enum.

6. **Granularidad de commits.** `docs/conventions.md` pide «un commit por task lógica completada».
   `e557d37c` empaqueta los bloques A-E enteros (migración + tipos + repositorio + servicio + borde
   + sus tests). No afecta a lo entregado.

7. **`feature_list.json` de la 373 se editó dentro de la rama de la feature** y su `status_note`
   describe la frontera vieja («solo se elimina la key SIN órdenes») sin la condición que el humano
   fijó el 2026-09-04 y que gobierna la ficha entera: **hay que desactivarla antes**. Territorio
   del leader; se apunta porque al mergear arrastra estado.

### Desviaciones ya decididas: verificadas como implementadas, NO son hallazgos

- **La key debe estar `inactiva`** y la confirmación es destructiva simple, sin teclear el
  identificador: implementado, y con un test que afirma explícitamente que **no** hay ningún campo
  de texto en el diálogo.
- **Una tarifa configurada BLOQUEA** (no se borra en la transacción): implementado, con su motivo
  propio y su texto de pantalla, que manda a Configuración › Tarifas.
- **Tensión de R13** (una key `activa` **y** con órdenes reporta `activa` por el camino del borrado
  mientras el listado muestra `ordenes`): confirmada en el código -el paso 2 corta por estado y
  devuelve los tres booleanos en `false` porque no los midió- y **aceptada** por el leader. Solo
  alcanzable por carrera, y el texto que ve la persona sale del listado. No se pide la consulta
  extra.

---

## 6. Qué falta exactamente para que esto sea `OK`

1. Escribir y **commitear** `progress/impl_373.md` con el mapa de las 39 filas y la bitácora
   (mutaciones, gate con su `INIT_EXIT` y sus `skipped`, y H3).
2. Marcar en `tasks.md` las tareas hechas, dejando sin marcar solo lo que falte.
3. Hacer la verificación en la pantalla real (H3) y anotar los seis puntos con lo que se vio.

Nada de esto toca `lib/`, `app/`, `db/` ni `tests/`. **El código de la ficha 373 queda aprobado tal
como está.**

---

> ADVERTENCIA: **este informe no está commiteado.** Lo commitea el leader. En este repo un informe
> de revisión se ha perdido tres veces por quedarse sin seguimiento.
