# Review — Feature 253 · la postulación de vehículo o bodega deja de ser una maqueta

> Revisado el 2026-08-21 sobre `feat/253-impl-backend` @ `0ec4e850`, medido contra
> `origin/dev` = `2d946420` (sin movimiento durante la revisión).
> Commits: `dfdd50f0` (backend) · `e26cc30f` (frontend) · `0ec4e850` (docs/T10).
>
> **Nada de lo que sigue se cita de la bitácora.** Cada afirmación lleva o el archivo:línea que
> leí o la salida del comando que corrí yo. Las dos mutaciones del encargo se **reprodujeron**.

---

## Veredicto

# 🔴 RECHAZADO

**Y conviene decir enseguida de qué clase es el rechazo: NO HAY QUE TOCAR UNA LÍNEA DE CÓDIGO.**
Los tres bloqueantes son de **cierre documental y de puerta previa**, y los tres están en la lista
de `CHECKPOINTS.md` de forma literal. El trabajo técnico —que es la mayor parte— está verificado y
aguanta: la revisión intentó tumbarlo por cuatro vías distintas y no cedió por ninguna.

---

## Checklist de `CHECKPOINTS.md`

### Especificación
- [x] `specs/253-postulacion-recursos/requirements.md` con R1-R44 en EARS numerado.
- [x] `design.md` con alternativas descartadas y su porqué (§14, nueve: A-I).
- [ ] 🔴 **`tasks.md` con todas las tasks `[x]`** — **37 sin marcar, 0 marcadas.**

### Trazabilidad
- [x] Cada `R<n>` mapea a un test concreto **que existe y que se ejecuta** — comprobado uno a uno
      por mí (sección «Trazabilidad verificada»).
- [ ] 🔴 **`progress/impl_253.md` contiene el mapa `R<n> → test`** — lo contiene para **25 de 44**;
      faltan las 19 filas de pantalla y guardia.

### Calidad de código
- [x] `pnpm run typecheck` limpio.
- [x] `pnpm run lint` — 0 errors, 97 warnings, **todas preexistentes** (ninguna en archivos de la 253).
- [x] `pnpm test` — **1257 archivos, 16 603 passed | 26 skipped**, `INIT_EXIT=0`. Corrido por mí.
- [x] E2E: no aplica (este repo no tiene harness de Playwright en la suite). Lo cubre el recorrido
      manual de T10, `progress/recorrido_253.md`, con verificación **contra Postgres** y no contra
      la pantalla.

### Datos y seguridad
- [x] RLS activada en `postulacion_recurso`, **sin policies** — no por regex: leído de
      `pg_class.relrowsecurity` y `pg_policy` en la base migrada (bloque B, ejecutado).
- [x] Las dos migraciones traen `down.sql`. Ninguna migración ya aplicada fue editada:
      `git diff --name-only dfdd50f0..0ec4e850 -- db/migrations/` **vacío**, y
      `prisma migrate status` dice «139 migrations found… Database schema is up to date!» sin una
      sola queja de checksum.
- [x] Cero secretos en código: el cron reusa `CRON_SECRET` vía `loadCronConfig()`, sin env nueva.
- [x] El endpoint desatendido valida token **antes de cualquier efecto** y es idempotente.

### Patrón de capas
- [x] Acciones sin queries ni negocio · service sin HTTP ni Prisma · repositorio sólo Prisma ·
      una interfaz por archivo bajo `lib/interfaces/{repositories,services}/`.

### Permisos
- [x] `/dashboard` ramifica por rol **server-side** (`app/(app)/dashboard/page.tsx:14,34`).
- [x] Mutaciones por Server Action, no por fetch a rutas de API.

### Multi-país / configuración
- [x] Sin país, moneda ni cuenta hardcodeados. Los nueve topes viven en
      `lib/config/postulacion-recurso.ts`, sobreescribibles por entorno. *(Una salvedad menor
      abajo, punto (e).)*

### Verificación final
- [x] `./init.sh` completo verde (corrido por mí, no citado).
- [x] `progress/review_253.md` — este archivo.
- [ ] ⚠️ Entrada en `progress/history.md` — no existe todavía (cierre del leader).

---

## 🔴 BLOQUEANTES

### B1 · `tasks.md` no tiene ni una tarea marcada

```
$ grep -c "^- \[ \]" specs/253-postulacion-recursos/tasks.md   → 37
$ grep -c "^- \[x\]" specs/253-postulacion-recursos/tasks.md   → 0
```

`CHECKPOINTS.md:9` lo pide literalmente. No es burocracia en este caso concreto: **con las 37 en
blanco no hay forma de distinguir lo que se hizo de lo que no**, y este mismo review encontró dos
tareas que efectivamente NO se hicieron (B2). El documento que debería contarlo está mudo.

**Qué falta:** marcar `[x]` lo hecho y dejar `[ ]` con una nota lo que no. Es decir: que el archivo
diga la verdad, no que esté todo marcado.

---

### B2 · T0.1 y T0.3 nunca se ejecutaron, y **P4 sigue sin respuesta**

`progress/impl_253.md:289`, escrito por el propio implementer:

> «T0.1-T0.3 (mediciones M1/M2/M3/M5 contra producción) y T10 (ver la app) no son de esta tanda.»

T10 **sí** se hizo después (`progress/recorrido_253.md`). T0.1 y T0.3 no se hicieron nunca:

```
$ grep -n "M1\|M2\|M3\|M5\|denominador\|git log --follow" progress/impl_253.md progress/recorrido_253.md
progress/impl_253.md:289:- T0.1-T0.3 (mediciones M1/M2/M3/M5 contra producción) y T10 ... no son de esta tanda.
```

Una sola coincidencia, y es justo la línea que dice que no se hicieron. Ni un número.

Consecuencias concretas, no formales:

- **`tasks.md:28-33` declara que T0.1 «Bloquea T0.4»**, y T0.4 (la firma de D3, D5, D6, D7, D8, D9,
  D10) se dio igualmente. En particular **D6 debía firmarse «con M3 delante»** —cuántos avisos
  `postulacion_mensajero_pendiente` se emiten y en qué ventana— precisamente para saber si la
  campana se lee o es ruido. **D6 se firmó en contra de la recomendación sin ese dato.**
  ⚠️ No estoy reabriendo D6: está firmada y lo implementado le es fiel. Lo que señalo es que la
  medición que la propia ficha puso como condición **no existe**, y eso es una tarea sin hacer.
- **P4 —«¿desde cuándo vive la maqueta en producción?»— queda sin respuesta.** Se cierra con
  `git log --follow --format="%ad %h %s" -- app/_landing/PostularRecursoModal.tsx`: **segundos de
  trabajo, local, sin tocar producción**, y es lo que dimensiona a cuánta gente se le dio un acuse
  falso. `requirements.md:322-325` la deja abierta y nadie volvió.

**Qué falta:** correr M1/M2/M3 por MCP de Supabase **sólo lectura** con su fecha y su denominador,
correr el `git log --follow` de M5, y escribirlos en `progress/impl_253.md`. **O** que el humano
anule T0.1/T0.3 por escrito. Lo que no vale es que la tarea siga en el documento como si fuera a
hacerse.

---

### B3 · El mapa `R<n> → test` cubre 25 de 44 requisitos

`progress/impl_253.md` sección 2 trae un mapa **excelente** —caso por caso, con el nombre literal—
para R4, R8-R28, R30-R34, más D6 y P2. Y luego, `impl_253.md:92-93`:

> «R1, R2, R3, R5, R6, R7, R17, R29, R35, R36, R37-R42, R44 son de pantalla o de guardia: los
> cubre el agente de frontend (T6-T8).»

El anexo del frontend (secciones 8 a 13) **nunca escribe ese mapa**: la sección 8 es una tabla de
**archivos**, no de casos. `tasks.md:286-288` (T11.1) pide explícitamente «nombre de caso, no de
archivo», y `CHECKPOINTS.md:13` lo pone como casilla propia. Faltan **19 filas**.

**Distingo esto de un agujero de cobertura, y la distinción importa:** verifiqué a mano que los 19
requisitos **sí** tienen test real y que **todos se ejecutan** (tabla más abajo). Lo que falta es
que esté escrito. La razón de que aun así sea bloqueante está en la memoria de este repo: en la 236
una fila del mapa citó un archivo de test **que no existía en ninguna rama** y nadie lo vio, porque
`vitest` ignora en silencio un filtro que no casa nada. El mapa es justamente el artefacto que hace
esa comprobación posible. Medio mapa es medio control.

**Qué falta:** 19 filas en `progress/impl_253.md`. La tabla de la sección 6 de este review se puede
copiar tal cual.

---

## ✅ Lo que se comprobó con dureza, y aguantó

### 1 · El cron de purga — el punto más peligroso de la ficha

Las tres exigencias del encargo, verificadas:

**(a) La condición se apoya en `atendida_at` y nunca en `created_at`.**
`lib/repositories/PostulacionRecursoRepository.ts:38-40`:

```ts
function wherePurgables(corte: Date): Prisma.PostulacionRecursoWhereInput {
  return { atendidaAt: { lt: corte } };
}
```

`created_at` **no aparece en la función**, y el `DELETE` posterior borra por `id IN (...)` sin
repetir el predicado (`:144-157`) — con el motivo escrito al lado: repetirlo «taparía una mutación
del predicado dejando el test en verde». Es la decisión correcta y no es la obvia.

**(b) El caso de la fila pendiente de dos años existe Y SE EJECUTA.** No me fié del reporte:

```
$ pnpm exec vitest run tests/integration/db/postulacion-recurso-migration.test.ts --reporter=verbose
 ✓ … > 253 / bloque C — el repositorio REAL contra la base REAL
     > ⛔ P2: una postulacion PENDIENTE de hace DOS ANOS **SOBREVIVE** a la purga  7ms
 Test Files  1 passed (1)
      Tests  32 passed (32)        ← cero skipped
```

El escenario tiene los tres casos que hacen falta, incluido el que **distingue las dos columnas**:
una fila con `created_at` de hace dos años pero **atendida ayer**, que por `created_at` sería la más
vieja de todas y no debe borrarse (`:575-583`).

**(c) Está donde puede ver el SQL, y lo demuestro mutando.** Reproduje la mutación del autor,
`atendidaAt` → `createdAt` en `wherePurgables` (blob `c196a258` → `6438bc61` → `c196a258`):

| suite | con la mutación viva |
| --- | --- |
| `purga-postulacion-recurso-service.test.ts` (dobles) | **11 passed — VERDE** |
| `postulacion-recurso-migration.test.ts` (Postgres real) | **1 failed** |

```
AssertionError: una postulacion PENDIENTE de hace dos anos fue borrada por la purga:
  expected [] to include "b9562b7f-fa25-4faa-952f-b1addd78f4f4"
```

**El test de servicio pasa 11/11 en verde con una mutación que borra de la base todas las
postulaciones pendientes.** Confirmado con mis manos, no leído. Por eso la condición se prueba
donde vive, y por eso este bloque C no es opcional.

**Y algo que hace bien de forma no obvia:** el bloque **se niega a saltarse por falta de datos**.
`:393-399` — si no hay ni un usuario para la FK, **lanza con el motivo escrito** en vez de
devolverse en silencio. Es el antídoto exacto del `if (!fks) return;` que en este repo ya produjo
un `passed` sin comprobar nada.

Restaurado al terminar: `git hash-object` → `c196a258…`, árbol limpio.

---

### 2 · La guardia compartida (D7/D10) — los dos rojos, reproducidos

**Los detectores están extraídos, no duplicados.** `tests/fixtures/deteccion-maqueta.ts` contiene
las siete funciones con **cuerpo y prosa idénticos** a los que salieron de la guardia de la 240; el
diff de `novedad-acciones-sin-maqueta.guardia.test.ts` es **sólo imports**, más el comentario que
explica adónde fueron.

**La guardia de la 240 conserva sus 19 casos sin cambio de conducta.** Comparé los nombres
literales de cada `it(` entre `2d946420` y `HEAD`:

```
$ diff casos_antes.txt casos_ahora.txt
IDENTICOS: 19 casos
$ pnpm exec vitest run tests/unit/guards/novedad-acciones-sin-maqueta.guardia.test.ts
      Tests  19 passed (19)
```

**R42 comprobado ejecutando, no leyendo:** `pnpm exec vitest run guard` selecciona sola la guardia
nueva (23 líneas suyas en la salida verbose) y `pnpm run test:guardias` termina en
**126 archivos / 1877 tests, verde**.

**Los dos rojos de `impl_253.md` sección 9 se reproducen, y coinciden hasta en el conteo.** Mutando
`app/_landing/PostularRecursoModal.tsx` (blob `a84a74be` antes y después en los dos ciclos):

Rojo 1 — la maqueta pura (import fuera, invocación fuera):

```
FAIL … > 253/R39 > cada productor se importa Y se invoca dentro de una raíz pública
+   "postularVehiculo → `postularRecurso` (lib/actions/postulacion-recurso): nadie la importa",
+   "postularBodega → `postularRecurso` (lib/actions/postulacion-recurso): nadie la importa",
 Tests  3 failed | 20 passed (23)
```

Y con esa misma mutación, el test de componente: **9 failed | 2 passed (11)**.

Rojo 2 — el `import` EN PIE, la invocación borrada (la quinta forma, la que sobrevivía):

```
 Tests  2 failed | 21 passed (23)
-   "postularRecurso ← app/_landing/PostularRecursoModal.tsx",
+   "postularRecurso ← ",
```

Los dos rojos son ciertos y los conteos de la bitácora son exactos.

**Lo que está bien resuelto y quiero que se conserve:**

- El **frente 5** (censo del árbol de archivos) compensa de verdad la pérdida del `satisfies`: como
  el censo vive en `tests/`, producción no lo consume y ningún typecheck reclamaría una superficie
  nueva; el barrido de `<form` / `onSubmit=` sobre las dos raíces sí. Y **cada frente lleva su
  control de anti-vacuidad** (`:463`, `:538`, `:552`, `:607`), incluido el mapa literal de qué
  archivo dispara qué operación hoy.
- El **frente 4** (censo inverso) cierra la salida barata: sin él, apagar el frente 2 cuesta bajar
  la entrada a `sinOperacion` con una excusa de veinte caracteres.
- El bloque 0 **no se comparte** aunque los detectores sí: cada guardia ejercita sus detectores
  contra fuente sintético, incluido `LA_MAQUETA_253` literal. Es la contrapartida honesta de D7, y
  está medida: relajar el detector compartido pone **las dos** guardias rojas a la vez.

---

### 3 · Nada se silenció

```
$ grep -rn "@sin-superficie|eslint-disable|@ts-ignore|@ts-expect-error|\.skip|\.todo" (los 11
  módulos y componentes nuevos)
→ 1 coincidencia, y es prosa: landing-sin-maqueta.guardia.test.ts:499 cita la regla de
  `@sin-superficie` dentro del mensaje de error de un frente.
```

**Ni una anotación de excepción.** El rojo transitorio de `superficie-de-uso.guardia.test.ts` que el
backend dejó abierto se apagó **cableando**, que es lo que `design.md:608` exige y lo contrario de
lo que habría sido barato.

Y no hay tests dormidos: los 15 archivos nuevos más el de integración de la migración dan
**249 tests, 0 skipped, 0 todo**, corridos por mí en una pasada aparte.

Los dos `if (r.status !== "validation_error") return;` de
`tests/unit/actions/postulacion-recurso-action.test.ts:120,131` **no** son el patrón peligroso: van
**después** de un `expect(r.status).toBe("validation_error")`, así que un status distinto ya habría
fallado. Son estrechamiento de tipo, no abstención.

---

### 4 · Las migraciones

- **Ninguna migración ya aplicada fue editada.** `git diff --name-only 2d946420..0ec4e850 --
  db/migrations/` devuelve exactamente las 4 rutas nuevas, y `dfdd50f0..0ec4e850` devuelve **vacío**
  (no se tocaron después de aplicarse). `prisma migrate status` dice «Database schema is up to
  date!» sin queja de checksum, que es la señal que delataría una edición en sitio.
- **Timestamps:** `20260820200000` y `20260820210000`, posteriores a la última de `origin/dev`
  (`20260820190000`), y `origin/dev` no se movió durante la revisión.
- **La afirmación sobre el `down.sql` del enum de la 146 es CIERTA, y la verifiqué en el archivo:**
  `db/migrations/20260727120000_notificacion/down.sql` sólo hace
  `DROP TYPE IF EXISTS` de `notificacion_entidad_tipo`, `notificacion_evento` y `notificacion_tipo`
  — **no los recrea con lista**, porque allí se van también las tablas que los usan. Por tanto no
  había nada que actualizar en aquel down, y no se tocó (es una foto histórica).
  **Detalle bien hecho:** eso no se deja en prosa —lo afirma un test,
  `notificacion-evento-postulacion-recurso-migration.test.ts:149`, «aquel down SOLO dropea; no los
  recrea con lista»—. Una afirmación sobre otro archivo que se comprueba sola es lo que impide que
  caduque en silencio.
- El `down.sql` del enum nuevo sí recrea los **dos** enums con sus cuatro valores previos, con
  precondición escrita, y la supervivencia del `NULLS NOT DISTINCT` y del `WHERE` parcial de
  `notificacion_dedupe_key` a la reconstrucción está **medida contra Postgres**, no supuesta.

---

### 5 · Los dos censos ajenos: se APRETARON, no se aflojaron

Ésta era la pregunta con más filo del encargo, y la respuesta es clara en las dos.

**`tests/unit/services/notificacion-productores-wiring.test.ts`** — el inventario cerrado de la 146
pasa de cuatro a cinco eventos. Es **corregir el contrato, no romperlo**: D1 de la 146 puso como
precio de un evento nuevo «migración de enum con su `down.sql`», y esta ficha lo pagó entero. Lo que
importa es **cómo** se actualizó: la lista **sigue siendo literal**
(`toEqual(["orden_rechazada", …, "postulacion_recurso_pendiente"])`) y no se cambió por una
derivación del propio `schema.prisma`, que la habría dejado verde para siempre. El único cambio de
parsing es cortar el comentario de fin de línea. Correcto.

**`tests/integration/db/no-migration-102.test.ts`** — aquí el cambio **añade** controles:

- la lista de excepciones sigue **cerrada** y cada entrada declara feature y motivo;
- **anti-vacuidad nueva:** la migración de la 146 tiene que seguir apareciendo (si el filtro dejara
  de encontrar nada, el test estaría verde sin comprobar nada);
- **caducidad nueva:** cada excepción declarada tiene que **existir** en el árbol.

Y la anti-vacuidad **se ejerció**: el implementer plantó
`db/migrations/29990101000000_notificacion_intrusa/` y el censo la denunció por nombre
(`impl_253.md` sección 3(g)). La intención original de la guardia —que **la 102** no metiera
infraestructura de notificaciones— sigue intacta. **Ninguno de los dos es un aflojamiento.**

---

### 6 · Trazabilidad verificada (las 19 filas que faltan en la bitácora)

Comprobé **archivo por archivo y caso por caso**. Los 18 archivos de test citados en la bitácora
**existen** (ni una cita fantasma) y los nombres de caso citados resuelven a exactamente **un** test
real cada uno: tomé 11 al azar del mapa del backend y los once dieron **1 coincidencia**, ninguno
cero.

| R | Test que lo cubre (nombre de caso) |
| --- | --- |
| **R1** | `253/R1` › *con `ok` del servidor se pinta el acuse, y el envío llevó los cinco campos normalizados* + *💀 MIENTRAS la acción no ha resuelto, el acuse NO está* |
| **R2** | `253/R2 + R5 + R17` › *`error`: lo dice en pantalla y conserva lo escrito* + *💀 PROMESA RECHAZADA: sin el `try/catch` la pantalla se quedaría muda* |
| **R3** | `253/R3` › *dos clicks seguidos producen UNA sola invocación, y el botón dice que está enviando* |
| **R5** | `253/R2 + R5 + R17` › *R5 — los tres desenlaces de fallo tienen texto propio, no vacío y DISTINTO entre sí* |
| **R6** | `253/R6` › *dice que la postulación QUEDÓ REGISTRADA, y el texto de la maqueta no vuelve* |
| **R7** | `253/R1` › *las DOS tarjetas de la landing disparan la MISMA operación, con su `tipo`* + `LandingPage.test.tsx` verde **sin tocarse** |
| **R17** | `253/R2 + R5 + R17` › *R17 — `rate_limited` tiene texto PROPIO, distinto del error genérico* |
| **R29** | `253/R29` (Card) › *tipo, nombre, teléfono, correo, el mensaje COMPLETO y la fecha en que llegó* + `253/R29 + R30` (Panel) › *al montar pide las PENDIENTES y las pinta* |
| **R35** | `253/R35` › *sin pendientes, dice qué va a aparecer ahí y por qué* |
| **R36** | `253/R36` › *ya no se describe la pantalla entera como «Postulaciones de mensajeros pendientes»* |
| **R37** | la guardia entera, `landing-sin-maqueta.guardia.test.ts` (23 casos, seleccionada sola por `vitest run guard`) |
| **R38** | frente 1 › *el módulo declarado existe, es de servidor y exporta ese símbolo* + frente 3 › *ningún `sinOperacion` está vacío, es de relleno ni es telegráfico* |
| **R39** | frente 2 › *cada productor se importa Y se invoca dentro de una raíz pública* + bloque 0 › *💀 el `import` en pie SIN la llamada NO cuenta como cableado* |
| **R40** | frente 4 › *ninguna Server Action pública se dispara sin estar declarada en el censo* + frente 5 › *todo archivo público con formulario de envío está apuntado por el censo* / *todo archivo que el censo nombra EXISTE y sigue teniendo su formulario* |
| **R41** | bloque 0 completo (11 casos), incluido *💀 LA MAQUETA DE LA 253 no pasa — valida y sólo hace `setEnviado(true)`* |
| **R42** | `pnpm run test:guardias` la selecciona sola — **ejecutado por mí**, 126 archivos verdes |
| **R43** | gate completo verde con `LandingPage.test.tsx`, `HomePageMaestro.test.tsx` y `PostulacionesPendientesPanel.test.tsx` **sin aparecer en el diff** |
| **R44** | frente 4 › *y el detector VE de verdad las acciones públicas (anti-vacuidad)*, que exige `consultarRastreoPublico` declarado como productor **real** |

**Conclusión de trazabilidad: los 44 requisitos tienen test, y los 44 tests se ejecutan.** Lo que
falta es escribirlo (B3).

---

## ⚠️ Menores

**(a) `feature_list.json` sigue diciendo `"status": "pending"` para la 253**, sin `spec_path` ni
`branch`, con tres commits de implementación dentro. Es T11.2 y lo estampa el leader, pero mientras
tanto el estado en disco miente sobre una feature terminada. Igual, falta la entrada en
`progress/history.md` (`CHECKPOINTS.md:46`).

**(b) `pnpm run db:rollback` no alcanza a la migración de la tabla, y lo verifiqué en el script.**
`scripts/db-rollback.ts:8-14` ordena las carpetas y toma siempre **la última**; correrlo dos veces
revierte dos veces la de los enums. Con dos migraciones en la misma tanda, la de la tabla se queda
aplicada y hay que ejecutar su `down.sql` a mano. **No lo introdujo esta ficha** y el implementer lo
documentó (`impl_253.md` sección 4). Pero `CHECKPOINTS.md:24-25` pide que el script funcione, y
**quien despliegue tiene que saberlo**: conviene la ficha que T11.3 pide, no sólo el párrafo.

**(c) `design.md` sección 12.2 se quedó desactualizada tras firmar D6.** Dice «un bot no consigue
nada salvo ensuciar el panel», escrito cuando D6 era «no en v1». Ahora cada postulación aceptada
escribe además **2 filas en `notificacion`** para `maestro` y `admin`, y la dedupe por
`(evento, entidad_id, destinatario)` **no las colapsa**, porque cada postulación trae su propio id.
No es un defecto —es exactamente el mismo radio que la postulación de mensajero de la 21, que
también es pública y sin sesión—, pero el riesgo firmado dice hoy menos de lo que es cierto.

**(d) R3 tiene dos barreras y sólo una está medida.** `PostularRecursoModal.tsx:194` tiene
`if (enviando) return;` *además* del `disabled`, y su comentario dice que existe «si alguien le
quita el atributo». El test usa `user.click`, que **no dispara sobre un botón deshabilitado**: lo
que queda comprobado es el `disabled`. Un `fireEvent.submit` doble sobre el `<form>` ejercitaría la
segunda barrera. Es un plus sin red, no un requisito sin red.

**(e) `PostulacionRecursoCard.tsx:35-38` fija `timeZone: "America/Costa_Rica"` en el componente.**
Sigue el precedente que cita (`HiloNotasOrden`, `HistorialOrdenTimeline`) y `lib/utils/fecha-cr.ts`
no exporta ningún formateador de presentación, así que es coherente con el árbol. Lo anoto porque
`lib/config/rastreo-publico.ts:38` demuestra que en este repo la forma configurable existe
(`RASTREO_PUBLICO_ZONA_HORARIA`): que sea una elección y no un descuido.

**(f) R26 dice «una consulta que use índice, sin recorrer la tabla entera».** Lo probado es la
**conducta** (filtro y orden, contra Postgres) y la **existencia y forma** del índice compuesto
`(atendida_at, created_at)`, leída de `pg_indexes`. No hay ningún `EXPLAIN` que demuestre que el
planificador lo usa, y el repo tiene la maquinaria (`crearPrismaDeTestConEspia`, feature 169). El
«test previsto» que el propio `requirements.md:189-191` pedía **sí** está entregado, así que no lo
cuento como incumplimiento: queda escrito por si algún día la tabla crece.

**(g) El R19 del servicio aplana toda la cadena de `cause` con su stack** (`:114-117`, y la función
`aplanar` está bien pensada), pero la causa que se inyecta es un `Error` genérico controlado por el
test. Un error real de Prisma que llevara valores dentro no quedaría cubierto por construcción.
Riesgo bajo y difícil de cerrar del todo; queda apuntado.

---

## Lo que hay que hacer para que esto sea `OK`

1. **B1** — poner `tasks.md` al día: `[x]` lo hecho, `[ ]` con nota lo que no.
2. **B2** — medir M1/M2/M3 (MCP de Supabase, **sólo lectura**, con fecha y denominador) y M5
   (`git log --follow` sobre el modal, local) y escribirlos. Con M5 se **cierra P4**.
   Alternativa válida: que el humano anule T0.1/T0.3 por escrito.
3. **B3** — añadir al mapa de `progress/impl_253.md` las 19 filas de pantalla y guardia. La tabla
   de la sección 6 de este review sirve tal cual.
4. *(no bloqueante, pero antes del PR)* — `feature_list.json` (T11.2), `progress/history.md`, y
   registrar como ficha la deuda de `db:rollback` (T11.3).

**Ni un cambio de código.** Corregido lo de arriba, esta ficha pasa: la implementación es sólida y
la revisión no consiguió tumbarla ni mutando el predicado del borrado, ni replantando la maqueta en
sus dos formas, ni buscando excepciones silenciadas, ni comprobando que las citas apuntaran a algo
real.
