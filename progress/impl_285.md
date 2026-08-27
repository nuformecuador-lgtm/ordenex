# Feature 285 — Filtro por rol y buscador en el listado de usuarios · BITÁCORA DE BACKEND

> Esta es la bitácora que `tasks.md` (T6.2) nombra como
> `progress/impl_285-usuarios-filtro-y-buscador.md`. Se escribe **un solo archivo** —éste— para
> que no haya dos versiones que se separen; el nombre corto es el que pidió el encargo.
>
> **Alcance de esta tanda: SOLO BACKEND.** Schema de entrada, repositorio, servicio, tests de
> unidad y el test de integración contra Postgres. **No se tocó ni un archivo de UI.** Diez de
> los 29 requisitos son de superficie y quedan explícitamente **pendientes** para `frontend_dev`;
> están marcados como tales en el mapa de abajo, no dados por buenos.

---

## 1. Archivos creados / modificados

### Creados (3)

| Archivo | Qué es |
| --- | --- |
| `lib/utils/escapar-like.ts` | Módulo puro: escapa `%`, `_` y `\` para `LIKE`/`ILIKE`. |
| `tests/unit/utils/escapar-like.test.ts` | Su test de unidad (5 casos). |
| `tests/integration/db/usuarios-filtro-busqueda.test.ts` | **El test que importa**: el `WHERE` ejecutado contra Postgres real (11 casos). |

### Modificados (8)

| Archivo | Qué cambió |
| --- | --- |
| `lib/types/usuario.ts` | `USUARIO_BUSQUEDA_MIN_CHARS = 2`, `USUARIO_BUSQUEDA_MAX_CHARS = 120`, `usuarioRolFiltroSchema` (derivado de `ROL_LABELS`) y las claves `q` / `rol` en `listarUsuariosSchema`. |
| `lib/interfaces/repositories/IUserRepository.ts` | `ListUsuariosParams` gana `busqueda?` y `roles?: RolValue[]`, documentando que `roles` **nunca** es lista vacía. |
| `lib/repositories/UserRepository.ts` | El `WHERE` de `list`, y el **mismo objeto** en el `count`. |
| `lib/services/UsuarioService.ts` | `construirFiltro` privado compartido por `listar` y `listarCompleto`; comentario de `listarCompleto` reescrito; nota de R25 sobre el tope. |
| `tests/unit/types/usuario-schema.test.ts` | T-U1…T-U5. |
| `tests/unit/services/usuario-service.test.ts` | T-S1 y la traducción de claves públicas → dominio. |
| `tests/unit/services/usuario-descarga.test.ts` | T-S2, T-S3, T-S4. |
| `tests/unit/actions/usuarios.test.ts` | R8/R15 **en el borde**: la mitad «sin ejecutar ninguna consulta» que un test de schema no puede afirmar. |

### Lo que NO se tocó, y está comprobado con `git diff --name-only`

- `lib/actions/usuarios.ts` — **T1.8 cumplido**: las claves nuevas viajan por el mismo tubo
  (`schema.parse(input ?? {})` → servicio). Que este archivo no cambie es la señal de que el
  borde ya estaba bien puesto.
- `db/schema.prisma`, `db/migrations/**` — **no hay migración**: ni tabla, ni columna, ni enum,
  ni índice, ni RLS. Por tanto **no hay `down.sql` que escribir**.
- `lib/repositories/OrdenRepository.ts`, `app/(app)/ordenes/**`, `ordenes-filtros-def.ts`.
- `lib/actions/tarifas.ts` y `tests/unit/guards/superficie-de-uso.guardia.test.ts`.
- `lib/types/usuario.ts::listarUsuariosCompletoSchema` — **ni una línea** (§2.4 del diseño): es
  la derivación la que le da `q` y `rol`, y T-U5 lo mide.
- `tests/unit/descarga/**` (R24: no cambia ninguna columna).
- Nada de la ficha 287: `restablecerContrasenaUsuario`, `RestablecerContrasenaResult` y
  `updatePasswordHash` siguen intactos, y sus tests siguen verdes en el gate.

---

## 2. Los cuatro puntos que el encargo exigía atender

### (1) `UserRepository.list` contaba SIN `where` — el fallo mudo

Era `this.prisma.usuario.count()` a secas. Correcto mientras no hubo filtro; **mentiroso en
silencio** en cuanto entró uno (tabla de 3 filas bajo un «1–25 de 48», y el tope de la descarga
midiéndose contra el conjunto sin filtrar). Ahora el `where` se construye **una vez** y lo
reciben `findMany` y `count`.

Cubierto por **T-I3**, y **medido**: la mutación `count()` sin `where` (M01) tumba **9 casos** del
test de integración. Es aritméticamente imposible que sobreviva: sin `where` el total es
`base.total + 4`, y lo que se afirma es `base.mensajeros + 2`, con `mensajeros ⊆ total`.

### (2) `escaparComodinesLike` estaba privada en el módulo de órdenes

`OrdenRepository.ts:962` la declara **privada de módulo** y no la exporta; tocar ese archivo está
prohibido en esta ficha. Se siguió el diseño (§3.3): se creó `lib/utils/escapar-like.ts` y **solo
`UserRepository` lo importa**.

**Por qué hay dos declaraciones, escrito donde se lee** (en el propio `escapar-like.ts`): la copia
de `OrdenRepository` sirve además al SQL crudo de la bodega satélite y unificarlas exigiría editar
el módulo de órdenes. La deuda es de una línea y queda anotada: cuando alguien pueda tocar
`OrdenRepository`, que importe el util y borre su copia.

### (3) El comentario mentiroso de `UsuarioService.ts:143`

Decía: *«NO hay `construirWhere` que extraer aquí, y eso es un HALLAZGO»*. Esta feature lo
desmiente. **Reescrito.** El párrafo nuevo (a) dice explícitamente que eso era cierto **hasta la
285** y por qué se reescribe en vez de dejarse; (b) describe lo que el método hace ahora
(`construirFiltro` compartido); y (c) **conserva** la parte que sigue siendo verdad —que el
alcance por actor de este listado es el guard `ALLOWED_ROLES`—, para no tirar información válida
junto con la caducada.

### (4) El tope `MAX_FILAS` pasa a medirse sobre el total filtrado

Es consecuencia directa de (1): `listarCompleto` compara contra el `total` que devuelve el
repositorio, y ese total ya es el filtrado. Documentado junto al `if`. Cubierto por **T-S3**, que
mide las dos direcciones: un subconjunto por debajo del tope **se descarga** aunque el conjunto
sin filtrar lo exceda, y el tope **sigue aplicando** cuando lo filtrado también lo excede (para
que el caso no pase por haber desactivado el tope).

---

## 3. Mapa `R<n> → test` (los 29)

> `[FRONTEND]` = requisito de superficie, **fuera del alcance de esta tanda**. No está cubierto:
> lo cubre `frontend_dev` con los casos T-P*/T-C* de `design.md` §9.4/§9.5.

| R | Qué exige | Test que lo cubre |
| --- | --- | --- |
| R1 | sin filtros, mismas filas / orden / total | **T-I0** (`usuarios-filtro-busqueda.test.ts`) + «sin filtros los dos siguen pidiendo el listado ENTERO» (`usuario-descarga.test.ts`) + «`q` es OPCIONAL: `{}` sigue validando» (`usuario-schema.test.ts`) |
| R2 | fragmento en nombre **o** correo, en cualquier posición | **T-I1** |
| R3 | la búsqueda va sobre TODOS, no sobre la página visible | **T-I7** |
| R4 | sin distinguir mayúsculas | **T-I2** |
| R5 | `%`, `_`, `\` como texto literal | **T-I4** + `tests/unit/utils/escapar-like.test.ts` (5 casos) |
| R6 | recorta los extremos antes de aplicar | **T-U2** + contraprueba de la acción («llega ya recortado») |
| R7 | por debajo del mínimo no consulta e indica cuántos faltan | `[FRONTEND]` T-P3 / T-C8 |
| R8 | fuera de rango → `validation_error` **sin consultar** | **T-U1** (el rango) + **285/R8/R15** en `tests/unit/actions/usuarios.test.ts` (la mitad «sin consultar»: el doble del servicio no recibe llamada) |
| R9 | la interfaz trunca al máximo | `[FRONTEND]` T-P3 |
| R10 | una sola consulta por ráfaga (espera) | `[FRONTEND]` T-C2 |
| R11 | el texto de ayuda dice «nombre o correo» | `[FRONTEND]` T-P4 |
| R12 | todos los roles, etiqueta legible, selección múltiple | **T-U4** (lista blanca exhaustiva sobre `ROL_LABELS`, en los dos sentidos) + **T-I3b** (la multiselección, ejecutada) · etiquetas y `kind:"multi"` → `[FRONTEND]` T-P1 |
| R13 | solo los usuarios de los roles marcados | **T-I3**, **T-I3b** |
| R14 | sin roles, no recorta por rol | **T-I3c** + «las claves se OMITEN» (`usuario-service.test.ts`) |
| R15 | rol inexistente o lista vacía → `validation_error` sin consultar | **T-U3** + **285/R8/R15** (acción) |
| R16 | término y roles → **ambas** condiciones | **T-I5** |
| R17 | el total cuenta solo lo filtrado | **T-I3** |
| R18 | al cambiar el filtro, vuelve a página 1 | `[FRONTEND]` T-C3 |
| R19 | el filtrado conserva el criterio de orden | **T-I6** |
| R20 | vacío con filtros dice «ninguno coincide», sin CTA | `[FRONTEND]` T-C5 |
| R21 | acción de limpiar todo | `[FRONTEND]` T-C6 |
| R22 | la descarga trae exactamente lo filtrado | **T-S2** (los dos caminos arman el MISMO filtro, y la descarga entrega lo que la pantalla muestra) + **T-U5** (el schema derivado acepta `q`/`rol`) |
| R23 | sin filtros, la descarga se comporta como hoy | **T-U5** + «sin filtros los dos siguen pidiendo el listado ENTERO» |
| R24 | las mismas columnas de siempre | `tests/unit/descarga/usuarios-descarga-columnas.test.ts` **verde y NO tocada** (`git diff` no la incluye) |
| R25 | el tope se mide sobre el total filtrado | **T-S3** (las dos direcciones) |
| R26 | no-maestro → `forbidden` sin consultar, también con filtros | **T-S1** (`listar` y `listarCompleto`, con la contraprueba de que el maestro SÍ consulta) |
| R27 | ningún campo nuevo por fila | **T-S4** (frontera del servicio) + **T-S4-int** (la consulta real, que es la que puede matar la fuga) |
| R28 | monta los componentes compartidos | `[FRONTEND]` T-C1 |
| R29 | el mínimo sale de un solo origen | Backend: el schema usa `USUARIO_BUSQUEDA_MIN_CHARS`, y T-U1 y la acción leen **la constante**, no un `2` a mano · `[FRONTEND]` T-C8 |

**Resumen: 19 de 29 cubiertos en esta tanda; 10 son de superficie y quedan pendientes.**

---

## 4. Mutaciones — qué se corrió y qué mató cada una

### 4.1 Primero, el arnés se autocomprueba

Un arnés de mutaciones ya mintió en este repo (9/9 «supervivientes» sin ejecutar un test), y en la
287 la primera corrida usó `--reporter=basic`, **que no existe en vitest 4**: vitest abortaba sin
correr nada y las 22 mutaciones habrían salido como supervivientes. Por eso, antes de creerle
nada, se le dieron **cinco casos con respuesta conocida**:

| Control | Qué se le dio | Resultado exigido | Resultado real |
| --- | --- | --- | --- |
| A | ancla que **no existe** en el archivo | `ERROR-DE-ARNES` | `ERROR-DE-ARNES (mutar.mjs abortó)` ✔ |
| B | ancla que aparece **6 veces** | `ERROR-DE-ARNES` | `ERROR-DE-ARNES (mutar.mjs abortó)` ✔ |
| C | fichero de test **inexistente** (vitest no corre nada) | `ERROR-DE-ARNES` | `ERROR-DE-ARNES (vitest NO imprimió resumen; exit=1)` ✔ |
| D | control **positivo**: mutación real | `MUERTA` | `MUERTA` (4 casos caídos) ✔ |
| E | control **negativo**: cambia un comentario | `SUPERVIVIENTE` | `SUPERVIVIENTE` ✔ |

Las tres autocomprobaciones que el encargo exigía están implementadas en `mutar.mjs` y en el
runner: **(a)** el ancla debe aparecer **exactamente una vez**; **(b)** el archivo debe **cambiar
en disco** (se relee de disco y se comprueba que el reemplazo está); **(c)** vitest debe haber
**imprimido su resumen** y haber ejecutado **> 0 tests**, o el resultado es `ERROR-DE-ARNES`,
nunca «superviviente». Se usó `--reporter=default`.

### 4.2 Las 24 mutaciones

**23 muertas, 1 superviviente esperada y explicada.** El árbol se verificó restaurado tras cada
tanda (`git diff --stat` idéntico antes y después, y cero `.mutbak` huérfanos).

| # | Mutación | Archivo | Qué la mató |
| --- | --- | --- | --- |
| M01 | `count({ where })` → `count()` | `UserRepository` | **T-I3** + T-I0, T-I1, T-I2, T-I3b, T-I3c, T-I4, T-I5, T-I6 (9 casos) |
| M02 | quitar la rama `email` del `OR` | `UserRepository` | **T-I1**, T-I2 |
| M03 | `contains` → `startsWith` | `UserRepository` | **T-I1** + T-I0, T-I3b, T-I3c, T-I5, T-I6, T-I7, T-S4-int |
| M04 | quitar `mode: "insensitive"` | `UserRepository` | **T-I2** (y solo T-I2: la mutación está bien aislada) |
| M05 | quitar el escapado de comodines | `UserRepository` | **T-I4** (y solo T-I4) |
| M06 | el `AND` implícito → `OR` | `UserRepository` | **T-I5**, T-I3b |
| M07 | ignorar `roles` | `UserRepository` | **T-I3**, T-I3b, T-I5 |
| M08 | perder el `orderBy` al añadir el `where` | `UserRepository` | **T-I6** (y solo T-I6) |
| M09a | **ampliar `LIST_SELECT`** (añadir `telefono`, `cedula`) | `UserRepository` | ⚠️ **SUPERVIVIENTE** — ver §4.3 |
| M09b | fuga de columnas por `...row` en el mapeo | `UserRepository` | **T-S4-int** (y solo ése) |
| M10 | bajar el mínimo de `q` a 1 | `lib/types/usuario.ts` | **T-U1** (3 casos) + T-U5 + el caso de acción «por debajo del mínimo» |
| M11 | `.trim()` **después** de `.min()` | `lib/types/usuario.ts` | **T-U2** (2 casos) |
| M12 | quitar `.nonempty()` de `rol` | `lib/types/usuario.ts` | **T-U3** + T-U5 + acción «lista de roles VACÍA» |
| M13 | `z.enum(...)` → `z.string()` | `lib/types/usuario.ts` | **T-U3**, **T-U4** + acción «rol que no existe» |
| M14 | quitar un rol de la lista blanca | `lib/types/usuario.ts` | **T-U4** |
| M15 | el schema del modo completo deja de derivarse | `lib/types/usuario.ts` | **T-U5** |
| M16 | el guard, **después** de la consulta | `UsuarioService` | **T-S1** (y el test de autorización preexistente) |
| M17 | la descarga ignora el filtro | `UsuarioService` | **T-S2** (3 casos) + **T-S3** |
| M18 | `escaparComodinesLike` devuelve el valor tal cual | `lib/utils/escapar-like.ts` | los 4 casos de su test + **T-I4** |
| M19 | **filtrar la página ya recortada** en vez de la tabla (la mutación literal de R3) | `UserRepository` | **T-I7** + T-I6 |

*(M03bis, M10bis, M12bis, M13bis son las mismas mutaciones re-corridas con los ficheros de test
añadidos después; sus resultados están en la tabla.)*

### 4.3 El superviviente, y por qué es un hallazgo y no un agujero

`design.md` §9.3 asigna a **T-S4** la mutación «ampliar `LIST_SELECT`». **Se corrió y sobrevive
(M09a), y no es un fallo del test: es que esa mutación no cambia nada observable.**
`UserRepository.list` no devuelve la fila de Prisma: la **reconstruye campo a campo**
(`{ id, nombre, email, rolValue, estado, createdAt }`). Una columna de más en el `select` viaja
por el cable de la base pero **nunca llega al DTO**. La proyección está protegida **dos veces**.

Como esa mutación no puede matar a nadie, se buscó la que **sí** puede: **M09b**, que sustituye el
mapeo explícito por un `...row`. Ésa **sí** filtra columnas al DTO, y **T-S4-int la mata** —y solo
la mata el test de integración: el de servicio con dobles pasa en verde, porque el doble decide él
mismo qué claves devuelve.

---

## 5. Salida real del gate

### 5.1 Antes de tocar nada (T0.3) — `dev` limpio, en este worktree

```
== Arnes SDD :: init (modo: completo) ==
✓ typecheck paso
✓ lint paso        (100 problems, 0 errors, 100 warnings — todos preexistentes)
 Test Files  1 failed | 1419 passed (1420)
      Tests  1 failed | 19374 passed | 26 skipped (19401)
✗ 'pnpm run test' fallo
INIT_EXIT=1
```

El único rojo es el **ajeno conocido** (ficha 275, otra sesión):

```
FAIL tests/unit/guards/superficie-de-uso.guardia.test.ts
  + [ "lib/actions/tarifas.ts:67 obtenerTarifa" ]
```

### 5.2 Después (T6.1) — `./init.sh` COMPLETO, no `--rapido`

```
== Arnes SDD :: init (modo: completo) ==
✓ typecheck paso
✓ lint paso        (100 problems, 0 errors, 100 warnings — los mismos)
 Test Files  1 failed | 1421 passed (1422)
      Tests  1 failed | 19424 passed | 26 skipped (19451)
✗ 'pnpm run test' fallo
INIT_EXIT=1
```

Mismo y único rojo:

```
FAIL tests/unit/guards/superficie-de-uso.guardia.test.ts
  + [ "lib/actions/tarifas.ts:67 obtenerTarifa" ]
```

### 5.3 Delta

| | antes | después |
| --- | --- | --- |
| fallos | **1** | **1** |
| verdes | 19 374 | **19 424** (+50) |
| ficheros de test | 1 420 | 1 422 (+2) |

**0 fallos nuevos.** Los +50 verdes son los casos de esta feature.

`INIT_EXIT=1` está escrito **dentro** del log (`{ ./init.sh; INIT_EXIT=$?; echo …; } > log 2>&1`),
no por un `echo` posterior que lo taparía. El gate rápido **se habría negado solo** (el diff toca
`lib/types/**`); por eso se corrió el completo desde el principio, como avisaba `tasks.md`.

### 5.4 Sobre `.env` y los tests de integración

Este worktree **no traía `.env`** (está en `.gitignore` y `git worktree add` no lo copia), y
tampoco `node_modules`. Sin `.env`, `HAY_BASE_DE_DATOS` es `false` y **los ~545 tests de
`tests/integration/db/**` se saltan en silencio declarado** — incluido el mío, que es justo la
evidencia que esta feature necesita. Se resolvió antes de medir nada: se copió el `.env` del
checkout principal y se enlazó `node_modules` con un *junction*. **Las dos corridas del gate,
la de antes y la de después, tienen base**, así que el delta es comparable y el test de
integración se ejecutó de verdad (10 → 11 casos verdes, no «skipped»).

`pnpm exec prisma migrate status` dice `localhost:5432 / ordenex` y **dos migraciones de otra
feature sin aplicar** (`20260826160000_tarifa_fk_cascade`, `20260826180000_tarifa_fulfillment_opcional`).
No se aplicaron: no son de esta ficha, tocan `tarifa` —que este trabajo no lee— y aplicarlas a la
base local **compartida entre worktrees** rompería el gate de las features vecinas. Ninguno de los
dos gates mostró rojo atribuible a eso.

---

## 6. Hallazgos y avisos para quien siga

1. **Un rojo intermedio que NO se reprodujo, y conviene que quede escrito.** En una corrida
   intermedia del gate apareció un segundo fallo:
   `tests/integration/tablero-dia-aislamiento.test.ts` → `DriverAdapterError: se ha detectado un
   deadlock`. **Medido, no supuesto:** ese fichero pasa **solo** (4/4); pasa **junto al mío**
   (14/14); pasa con **toda `tests/integration/`** (2 774/2 774); y **no reapareció** en el gate
   completo final. Es un choque dependiente de la carga.
   **La causa raíz sí está identificada:** ese fichero escribe en `public."usuario"` y
   `public."orden"` dentro de una transacción **sin tomar `serializarEscriturasReales`**, que es
   justo el remedio que `tests/integration/db/_postgres-real.ts` documenta como obligatorio para
   los tests que escriben en tablas reales. Lo mismo vale para los 8 ficheros que usan
   `_semilla-tablero-dia.ts`. **No se ha tocado**: son tests de otras features y arreglarlo
   significaría meter mano en un sembrador compartido, que no es lo que esta ficha pide. Se
   reporta para que se decida aparte. Mi test **sí** toma el lock como primera sentencia.
2. **El test de integración se salta declarándose** (`describe.skip` vía `HAY_BASE_DE_DATOS`), y
   si hay base pero falta un catálogo (`tipo_identificacion`, o los roles `mensajero`/`admin`/
   `adminTienda`) **revienta con mensaje**. No hay ni un `if (!x) return;`.
3. **El corpus se acota de una forma que el diseño no podía prever.** `design.md` §9.1 dice
   «acotar por `createdAt >= marca`», pero `UserRepository.list` **no admite un filtro por fecha**,
   así que desde fuera no se puede. Se acota por dos vías que **sí pasan por el `WHERE` real**:
   (a) un **sufijo único** por corrida incrustado en nombre y correo de las 4 filas —y **T-I0 va
   primero y comprueba ese acotamiento**, porque sin él ningún conteo de abajo afirmaría nada—; y
   (b) para el filtro de rol solo, un **conteo base tomado dentro de la misma transacción antes
   de sembrar**, contra el que se afirma el delta exacto. Es más fuerte que la marca de tiempo:
   la mutación `count()` sin `where` es **aritméticamente incapaz** de sobrevivirlo.
4. **Se añadieron dos cosas que el diseño no listaba, y ninguna es un rediseño:**
   - **T-I7** (R3). `design.md` §9.1 no asignaba ningún caso a R3 («la búsqueda se resuelve sobre
     todos, no sobre la página visible»), y R3 es un requisito con una mutación literal muy
     concreta —filtrar la página ya recortada—, que es **M19**. Sin T-I7, R3 no tenía test.
   - **Los casos de acción R8/R15.** R8 y R15 no dicen solo «responde `validation_error`»: dicen
     **«sin ejecutar ninguna consulta»**. Esa mitad un test de schema **no la puede afirmar** (zod
     no sabe si alguien consultó después). Se afirma donde se ve: el doble del servicio no recibe
     la llamada.
5. **Las tres preguntas abiertas del spec (P1/P2/P3) se cerraron por *default*, y queda
   constancia de que se aplicaron los *defaults*, no de que alguien los confirmara.**
   - **P1 (acentos):** `mode: "insensitive"` es ILIKE y **no pliega acentos**: `jose` no encuentra
     a `José` (`jos` sí, porque se busca por fragmento). Limitación aceptada y escrita en el
     comentario del repositorio, no un olvido.
   - **P2 (`apiKey` en el filtro):** se ofrecen **los 6 roles**, porque los 6 aparecen en la tabla.
     Sale solo de derivar la lista blanca de `ROL_LABELS`.
   - **P3 (persistencia entre visitas):** decisión de superficie; el backend no la condiciona.
6. **Deuda de una línea, anotada donde se lee:** `escaparComodinesLike` está declarada dos veces
   (aquí y, privada, en `OrdenRepository`). El porqué está en `lib/utils/escapar-like.ts`.

---

## 7. Veredicto

Backend de la 285 implementado y verificado: el `WHERE` probado **donde vive** (Postgres real, 11
casos), 24 mutaciones corridas con el arnés autocomprobado (23 muertas, 1 superviviente
explicada y sustituida por la que sí observa el fallo), gate completo con **0 fallos nuevos**
(1 → 1, +50 verdes); quedan pendientes los 10 requisitos de superficie para `frontend_dev`.

---
---

# Feature 285 · BITÁCORA DE FRONTEND (segunda tanda)

> **No sobreescribe nada de arriba.** Lo de arriba es la tanda de `backend_dev`, que dejó
> **10 de los 29 requisitos marcados `[FRONTEND]` a propósito**. Ésta es esa mitad: R7, R9,
> R10, R11, R18, R20, R21, R28 y las partes de superficie de R12 y R29. **Ninguno estaba
> dado por bueno**; aquí se implementan y se miden.
>
> **No se tocó ni una línea de backend.** El contrato del borde (`q`, `rol`, las dos
> constantes, la lista blanca) se **consume**, no se reescribe.

---

## 8. Archivos creados / modificados (frontend)

### Creados (3)

| Archivo | Qué es |
| --- | --- |
| `app/(app)/configuracion/_components/usuarios-filtros-def.ts` | Módulo **puro** (sin React): claves, placeholder y `construirFiltrosUsuarios(): FilterDef[]`. Calco de `ordenes-filtros-def.ts`. |
| `app/(app)/configuracion/_components/seleccion-a-filtro-usuarios.ts` | Módulo **puro**: `FilterSelection` + término → `{ q?, rol? }`, más `hayFiltroUsuarios` y `serializarFiltroUsuarios`. Calco de `seleccion-a-filter.ts`. |
| `tests/unit/components/usuarios-filtros-def.test.ts` | T-P1…T-P4 y las reglas de la traducción (15 casos). |

### Modificados (2)

| Archivo | Qué cambió |
| --- | --- |
| `app/(app)/configuracion/_components/UsuariosModule.tsx` | La barra compartida en `DataTable.filtros`, el estado (término aparte de la selección), la key de SWR con los roles ordenados, la vuelta a página 1, el `fallbackData` condicionado, el `emptyState` según haya filtros y la descarga con el filtro del render. |
| `tests/unit/components/usuarios-module.test.tsx` | T-C1…T-C8 y sus contrapruebas (5 → 22 casos). |

### Lo que NO se tocó, comprobado con `git status --short`

- **`app/(app)/configuracion/page.tsx` — T4.4 cumplido**: no aparece en el diff. El filtro de
  rol no necesita catálogo del servidor (los roles son un enum y `ROL_LABELS` ya es
  exhaustivo), así que la página sigue precargando exactamente lo mismo.
- **`app/(app)/ordenes/**` completo**, incluidos `ordenes-filtros-def.ts`,
  `seleccion-a-filter.ts` y `serializar-filtro.ts`. Reusar aquí es **consumir**
  `BuscadorFiltros`/`FilterComponent`, no editar lo ajeno. Hay un test que lo vigila: los dos
  módulos nuevos no pueden importar nada cuya ruta contenga `ordenes`.
- **`components/shared/BuscadorFiltros.tsx` y `components/shared/FilterComponent.tsx`**: ya
  soportaban todo lo que hacía falta (`kind: "multi"`, `minChars`, `placeholder`, `debounceMs`).
- **`components/shared/PasswordInput.tsx`** (ficha 286) y todo lo de la 287:
  `restablecerContrasenaUsuario`, sus tres modales y `ContrasenaGeneradaPanel` siguen intactos
  y sus 24 casos verdes. El filtro **convive** con la acción por fila, no la sustituye.
- **`lib/actions/tarifas.ts`** y `tests/unit/guards/superficie-de-uso.guardia.test.ts`.
- Todo el backend de esta misma ficha: `lib/types/usuario.ts`, `UserRepository`,
  `UsuarioService`, `lib/utils/escapar-like.ts` y sus tests.
- `tests/unit/descarga/**` (R24: esta feature no cambia ninguna columna).

---

## 9. Las tres trampas del encargo, y cómo se cerró cada una

### (1) El `fallbackData` habría pintado el listado SIN filtrar

`fallbackData` se aplicaba con `page === 1 && pageSize === initialData.pageSize`, y **esa
condición sigue siendo cierta al filtrar**: SWR le daría al primer render de una búsqueda la
respuesta *sin filtrar* que precargó el servidor, para una clave que es otra. Ahora exige
además `!hayFiltro`.

**Y aquí hay un hallazgo que cambia el test**, porque la aserción evidente **no habría matado
nada**. Se midió con una sonda (`useSWR` + `fallbackData` + petición en vuelo):

```
MONTAJE      loading= true   data= FALLBACK
TRAS CAMBIO  loading= true   data= FALLBACK
```

`isLoading` de SWR es `true` **aunque haya `fallbackData`**, y `DataTable` pinta **esqueletos**
en ese estado. Es decir: **las FILAS salen igual con el fallo y sin él**, así que un
`queryByText("Ana Pérez")).toBeNull()` habría estado verde con la mutación puesta — un test
incapaz de morir. Lo que **sí** delata el fallo es el **total**: `Pagination` recibe
`data?.total` y ese valor **no pasa por `isLoading`**. Con el fallo la barra dice `1-1 de 1`
—el total del listado completo bajo una búsqueda que aún no tiene el suyo—; sin él, `Sin
resultados`. **T-C4 afirma sobre el resumen de la paginación**, y la mutación M-C4 lo mata
(1 rojo, bien aislado).

### (2) El `emptyState` decía «Crea el primer usuario» bajo un filtro

Ahora depende de si hay filtros. Con filtros: **«Ningún usuario coincide con los filtros»**,
icono `SearchX`, descripción «Revisa el texto que escribiste o quita algún filtro para ver más
resultados.» y **sin CTA de crear**. Sin filtros: el de hoy, intacto, con su botón.

No es solo precisión de redacción: el mensaje viejo es **literalmente falso** —sí hay
usuarios— y **ofrece crear una cuenta a quien probablemente ya la tiene**, escondida detrás
del filtro que acaba de poner. Cubierto en las **dos direcciones** (T-C5), para que arreglarlo
no se convierta en dejar fijo el mensaje nuevo: M-C5 y M-C11 mueren cada una por su lado.

### (3) La descarga tenía que pedirse con los filtros puestos

`obtenerFilas` se construye **en el render** (ya lo hacía) y ahora cierra sobre el filtro de
**ese** render: `listarUsuariosCompleto(hayFiltro ? filtro : {})`. Con filtros el archivo trae
exactamente lo que la pantalla muestra (R22); **sin filtros la entrada sigue siendo `{}`
literal** (R23), que es la petición de hoy byte a byte — importante porque el schema del modo
completo es `.strict()` y `page`/`pageSize` serían `validation_error`. Las dos mitades tienen
caso (T-C7) y M-C7 muere.

---

## 10. Mapa `R<n> → test` de los 10 requisitos que quedaban

| R | Qué exige | Test que lo cubre (fichero) |
| --- | --- | --- |
| R7 | por debajo del mínimo no consulta e indica cuántos faltan | **T-C8/R7** (`usuarios-module.test.tsx`: cero llamadas tras 700 ms + el aviso) + **T-P3/R7** (`usuarios-filtros-def.test.ts`: la clave `q` se omite) |
| R9 | la interfaz trunca al máximo | **T-P3/R9** (`MAX+50` → exactamente `MAX`) + el caso del **corte dentro de una tira de espacios** |
| R10 | una sola consulta por ráfaga | **T-C2/R10** (nueve pulsaciones = **una** llamada nueva) |
| R11 | el texto de ayuda dice «nombre o correo» | **T-P4/R11** + **T-C1/R28** (el `placeholder` del campo montado) |
| R12 (UI) | todos los roles, etiqueta legible, selección múltiple | **T-P1** (3 casos: `kind: "multi"`, exhaustividad contra `ROL_LABELS`, etiquetas legibles) + **T-C1/R12** (las 6 opciones y `aria-multiselectable` en la pantalla) |
| R18 | al cambiar el filtro, vuelve a página 1 | **T-C3/R18** (en la página 3, teclear pide `page: 1`) |
| R20 | vacío con filtros dice «ninguno coincide», sin CTA | **T-C5/R20**, en sus **dos** direcciones |
| R21 | acción de limpiar todo | **T-C6/R21** (vuelve a pedir todo, el campo vacío **y** el control retirado) |
| R28 | monta los componentes compartidos | **T-C1/R28** (campo «Buscar» + botón «Filtros» de la barra compartida) |
| R29 (UI) | el mínimo sale de un solo origen | **T-C8/R29** (el prop **es** `USUARIO_BUSQUEDA_MIN_CHARS`) + **T-C8/R7** (la mitad de comportamiento) |

**Y de propina, medidos en la superficie** (no eran obligación de esta tanda, pero son los que
delatan un cableado mal hecho): R1 (`{ page, pageSize }` sin claves de relleno), R13/R14/R15
(la lista de roles viaja, y desmarcar el último **omite** la clave, nunca `[]`), R16 (término y
roles juntos), R22/R23 (la descarga, T-C7).

**Con esto, los 29 requisitos de la ficha están cubiertos**: 19 en la tanda de backend, 10 aquí.

---

## 11. Mutaciones del frontend

### 11.1 El arnés, autocomprobado ANTES de creerle nada

Mismo protocolo que la tanda de backend, con `--reporter=default` (en vitest 4 **no existe**
`--reporter=basic`, y en la 287 eso habría dado 22 falsos supervivientes). Cinco casos con
respuesta conocida:

| Control | Qué se le dio | Exigido | Real |
| --- | --- | --- | --- |
| A | ancla que **no existe** | `ERROR-DE-ARNES` | `ERROR-DE-ARNES: el ancla aparece 0 veces` ✔ |
| B | ancla que aparece **6 veces** (`setPage`) | `ERROR-DE-ARNES` | `ERROR-DE-ARNES: el ancla aparece 6 veces` ✔ |
| C | fichero de test **inexistente** | `ERROR-DE-ARNES` | `ERROR-DE-ARNES: vitest NO imprimio resumen de Tests` ✔ |
| D | control **positivo** (mutación real) | `MUERTA` | `MUERTA` (1 rojo: T-P4) ✔ |
| E | control **negativo** (cambia un comentario) | `SUPERVIVIENTE` | `SUPERVIVIENTE` (0 rojos) ✔ |

Las tres autocomprobaciones están **en el arnés**, no en la intención: (a) el ancla debe
aparecer **exactamente una vez**; (b) el archivo se **relee de disco** y debe contener el
reemplazo; (c) vitest debe haber **impreso su resumen** y ejecutado **> 0 tests**, o el
resultado es `ERROR-DE-ARNES`, **nunca** «superviviente».

### 11.2 Las 21 mutaciones: **21 muertas, 0 supervivientes**

| # | Mutación | Archivo | Qué la mató |
| --- | --- | --- | --- |
| M-P1 | `kind: "multi"` → `"single"` | `usuarios-filtros-def` | **T-P1** + 6 casos de módulo (7 rojos) |
| M-P2 | perder una opción (`apiKey` fuera) | `usuarios-filtros-def` | **T-P1** (exhaustividad) + T-C1 |
| M-P3 | `label: ROL_LABELS[value]` → `label: value` | `usuarios-filtros-def` | **T-P1** (etiquetas legibles) + 6 más |
| M-P4 | placeholder → `"Buscar…"` | `usuarios-filtros-def` | **T-P4** (y solo ése) |
| M-P5 | emitir `rol: []` en vez de omitir | `seleccion-a-filtro-usuarios` | **T-P2** + `hayFiltro` |
| M-P6 | quitar la truncación al máximo | `seleccion-a-filtro-usuarios` | **T-P3/R9** (2 casos) |
| M-P7 | truncar **sin volver a recortar** | `seleccion-a-filtro-usuarios` | el caso del **pegado con espacios** (y solo ése) |
| M-P8 | mínimo a mano (`1`) en vez de la constante | `seleccion-a-filtro-usuarios` | **T-P3/R7** + 3 más |
| M-P9 | `hayFiltroUsuarios` siempre `true` | `seleccion-a-filtro-usuarios` | la contraprueba del `fallbackData` + T-C5 |
| M-P10 | key de SWR **sin ordenar** los roles | `seleccion-a-filtro-usuarios` | la key estable (y solo ése) |
| M-C1 | la barra compartida **no se monta** | `UsuariosModule` | **T-C1** + 12 más (13 rojos) |
| M-C2 | sin espera (`debounceMs={0}`) | `UsuariosModule` | **T-C2/R10** |
| M-C3 | no volver a la página 1 | `UsuariosModule` | **T-C3/R18** (y solo ése) |
| M-C4 | `fallbackData` **como hoy** (sin `!hayFiltro`) | `UsuariosModule` | **T-C4** (y solo ése) |
| M-C5 | `emptyState` fijo (el de hoy siempre) | `UsuariosModule` | **T-C5/R20** (y solo ése) |
| M-C6 | "Limpiar todo" no retira las claves activas | `UsuariosModule` | **T-C6/R21** (y solo ése) |
| M-C7 | la descarga ignora los filtros (`{}` fijo) | `UsuariosModule` | **T-C7/R22** (y solo ése) |
| M-C8 | `minChars={2}` escrito a mano | `UsuariosModule` | **T-C8/R29** (y solo ése) |
| M-C9 | el filtro **no llega al fetcher** | `UsuariosModule` | 10 rojos |
| M-C10 | el filtro **no entra en la key de SWR** | `UsuariosModule` | 9 rojos |
| M-C11 | el vacío filtrado vuelve a decir «No hay usuarios» | `UsuariosModule` | **T-C5/R20** (y solo ése) |

El árbol se verificó restaurado tras la tanda (`git status --short` idéntico, cero `.mutbak`
huérfanos) y las dos suites vuelven a 37/37 en verde.

**Sobre M-C8, y conviene que quede escrito:** esa mutación (`minChars={2}` a mano) es
**indistinguible en tiempo de ejecución** mientras la constante valga 2 — que es exactamente el
error que R29 prohíbe, y por eso no se puede afirmar solo con comportamiento. T-C8 lo cierra
mirando **el prop tal como se pasa** (`minChars={USUARIO_BUSQUEDA_MIN_CHARS}`, y ningún
`minChars` numérico en el módulo), además del caso de comportamiento que mide el umbral. Es la
misma disciplina que pedía `design.md` §9.5: contra la constante importada, no contra un `2`
escrito en el test ni contra la función que genera el valor.

---

## 12. Hallazgos y avisos de esta tanda

1. **`isLoading` de SWR es `true` con `fallbackData`** (medido con sonda, §9-1). Cualquier
   test futuro que quiera afirmar algo sobre lo que se pinta **durante** una petición en vuelo
   tiene que mirar algo que no pase por `isLoading` —el resumen de `Pagination`, por ejemplo—;
   las filas están tapadas por los esqueletos y no distinguen nada.
2. **R7 se cumple con el texto del componente compartido, que dice el MÍNIMO, no cuántos
   faltan.** `avisoMinimoCaracteres` produce «Escribe al menos 2 caracteres para buscar».
   Operativamente informa lo mismo (con 1 escrito, falta 1), y **cambiar esa cadena sería
   editar `FilterComponent`**, que esta ficha declara intocable y que comparte con la barra de
   órdenes. Se deja así **a conciencia**, no por olvido: si se quiere el conteo exacto
   («falta 1 carácter»), es un cambio en el componente compartido y afecta a las dos barras.
3. **La paginación no se resetea al pulsar «Limpiar todo» si ya no había filtro**, y es
   correcto: el reset cuelga del cambio de `filtroKey`, así que limpiar desde un estado sin
   filtros no mueve la página. No hay caso que lo exija y no se inventó uno.
4. **P3 del spec (persistencia de filtros entre visitas) se cerró por *default*: aquí tampoco
   se recuerdan.** Ni URL ni almacenamiento del navegador, igual que la barra de órdenes.
   Queda constancia de que se aplicó el *default*, no de que alguien lo confirmara.
5. **La barra nace con el buscador solo**, y el filtro de rol se **pide** en el selector
   «Filtros». Es el comportamiento de la barra compartida, no una decisión nueva de esta
   pantalla; quien espere ver el desplegable de rol al entrar, no lo verá hasta pedirlo.

---

## 13. Salida real del gate (frontend)

`./init.sh` **COMPLETO** (el rápido se niega solo: el diff de la rama toca `lib/types/**`).
`INIT_EXIT` se escribe **DENTRO** del log, no con un `echo` posterior que ya tapó un rojo en
este repo, y el log **no se canaliza por `tail`**.

### 13.1 Primera corrida

```
✓ typecheck paso
✓ lint paso        (100 problems, 0 errors, 100 warnings — los MISMOS de la tanda de backend)
 Test Files  2 failed | 1421 passed (1423)
      Tests  2 failed | 19455 passed | 26 skipped (19483)
✗ 'pnpm run test' fallo
INIT_EXIT=1
```

Dos rojos, y **ninguno de los dos es una aserción sobre código de esta tanda**:

1. **El ajeno conocido** (ficha 275, otra sesión), idéntico al que ya midió el backend:
   `superficie-de-uso.guardia.test.ts` → `+ [ "lib/actions/tarifas.ts:67 obtenerTarifa" ]`.
2. **`censo-order-status-rename.test.ts` → `Error: Test timed out in 20000ms`.** No es un
   `expect` fallido: es un **timeout**, el patrón conocido de rojo por carga. **Medido, no
   supuesto:** ese fichero pasa **solo en 305 ms** (8/8), y ese caso escanea directorios en
   disco, así que sufre la contención de I/O de la suite entera. Se comprobó además que no es
   contenido mío: en aislado encuentra **0 infractores** con mis 3 archivos nuevos ya en el
   árbol.

### 13.2 Segunda corrida (misma rama, mismo árbol) — el timeout NO reaparece

```
✓ typecheck paso
✓ lint paso        (100 problems, 0 errors, 100 warnings)
 Test Files  1 failed | 1422 passed (1423)
      Tests  1 failed | 19456 passed | 26 skipped (19483)
✗ 'pnpm run test' fallo
INIT_EXIT=1
```

Un solo rojo: **el ajeno conocido de la 275**.

### 13.3 Delta contra la referencia

Referencia de la rama base (fin de la tanda de backend): **1 fallo | 19 424 verdes | 19 451
ejecutados**.

| | referencia | corrida 1 | **corrida 2** |
| --- | --- | --- | --- |
| fallos | 1 | 2 (1 ajeno + 1 timeout) | **1** (el ajeno) |
| verdes | 19 424 | 19 455 | **19 456** |
| ejecutados (+skipped) | 19 451 | 19 483 | **19 483** |

**0 fallos nuevos.** Los **+32** casos son exactamente los de esta tanda: 15 en
`usuarios-filtros-def.test.ts` (nuevo) y 17 añadidos a `usuarios-module.test.tsx` (5 → 22).
La aritmética cuadra sin residuo: 19 424 + 32 = 19 456.

**Los tests de integración tienen base.** Este worktree no traía `.env` ni `node_modules`
(`git worktree add` no los copia); se resolvió **antes de medir nada**, copiando el `.env` del
checkout principal y montando `node_modules` con un *junction*. Sin eso, los ~545 tests de
`tests/integration/db/**` se habrían saltado **en silencio declarado** y el delta no sería
comparable con el del backend. Los 26 `skipped` son los mismos que en la referencia.

---

## 14. Veredicto (frontend)

Frontend de la 285 implementado y verificado: los **10 requisitos de superficie** que el
backend dejó pendientes, cada uno mapeado a un test concreto; **21 mutaciones corridas, 21
muertas, 0 supervivientes**, con el arnés **autocomprobado antes** con cinco controles de
respuesta conocida; gate **completo** con **0 fallos nuevos** (1 → 1, +32 verdes). Se reusan
los componentes compartidos sin tocarlos y **sin tocar el módulo de órdenes**. Las tres trampas
del encargo están cerradas y **medidas**, y la de `fallbackData` obligó a cambiar la aserción:
la evidente no podía matar su mutación.
