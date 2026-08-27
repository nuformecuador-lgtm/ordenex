# Feature 285 — Filtro por rol y buscador en el listado de usuarios · tasks.md

> Orden obligatorio: **backend → integración contra base → frontend → medición → cierre**.
> Zona `fullstack` ⇒ se secuencia **`backend_dev` y luego `frontend_dev`** (nunca a la vez:
> el gate leería un árbol mutado por el otro y su veredicto no valdría).
> `[P]` = puede correr en paralelo con las otras `[P]` **de su mismo bloque** (ficheros
> disjuntos). Cada task lleva su **criterio de hecho**: si no se puede comprobar, la task
> está mal escrita.
> Nada se marca `[x]` sin que su criterio se cumpla **con salida ejecutada**, pegada en
> `progress/impl_285-usuarios-filtro-y-buscador.md`.

> ⚠️ **El gate rápido se va a NEGAR en esta feature.** El diff toca `lib/types/usuario.ts`, y
> `lib/types/**` está en la lista de `docs/verification.md` que obliga a `./init.sh`
> **completo**. Es un `fail`, no un aviso. Contarlo desde el minuto uno (T6.1) para que nadie
> planifique con ~1 min y se encuentre con la suite entera.

---

## T0 — Antes de tocar nada

- [ ] **T0.1 — Llevar P1/P2/P3 de `requirements.md` al humano** (acentos sin plegar; si el rol
      `apiKey` se ofrece en el filtro; si los filtros se recuerdan entre visitas).
      *Hecho:* la respuesta queda escrita en `progress/impl_285-usuarios-filtro-y-buscador.md`.
      Si no hay respuesta, se aplican los *defaults* del spec **dejando constancia de que se
      aplicaron** — no se inventa una tercera opción.
- [ ] **T0.2 [P] — Confirmar que la base local está migrada** (`pnpm exec prisma migrate status`).
      *Hecho:* dice el host y "up to date". Sin esto, T3 (integración) da rojos que no son de
      esta feature.
- [ ] **T0.3 [P] — Correr `./init.sh` completo en `dev` limpio, ANTES de editar.**
      *Hecho:* verde. Si sale rojo, el rojo **no es tuyo**: se reporta y se para (`dev` llegó
      rojo tres veces en este repo y el modo rápido no lo ve).

---

## T1 — Contrato del borde (`backend_dev`). Bloquea T2

- [ ] **T1.1 — Constantes y lista blanca en `lib/types/usuario.ts`.**
      `USUARIO_BUSQUEDA_MIN_CHARS = 2`, `USUARIO_BUSQUEDA_MAX_CHARS = 120` y
      `usuarioRolFiltroSchema` derivado de las claves de `ROL_LABELS` (design §2.1/§2.2), con
      el comentario que explica **por qué 2 y no 3** (el `3` de órdenes es de `pg_trgm`, y
      aquí no hay trigramas).
      *Hecho:* `pnpm run typecheck` en verde y las constantes exportadas.
- [ ] **T1.2 — Ampliar `listarUsuariosSchema`** con `q` (`.trim().min().max().optional()`) y
      `rol` (`z.array(...).nonempty().optional()`). **No** se añade `.strict()` al schema base
      y **no** se toca `listarUsuariosCompletoSchema` (design §2.3/§2.4).
      *Hecho:* T2.1 en verde, incluido el caso de que el schema del modo completo **acepta las
      dos claves nuevas sin haberlo editado** (T-U5).
- [ ] **T1.3 — `lib/utils/escapar-like.ts`** (módulo puro, una función) con el comentario que
      dice que `OrdenRepository` conserva su copia privada **a propósito** (design §3.3/§8-2).
      *Hecho:* test unitario propio: `"100%"`, `"_"`, `"\\"` y `"a%b"` salen escapados.
- [ ] **T1.4 — `ListUsuariosParams` gana `busqueda?` y `roles?`** en
      `lib/interfaces/repositories/IUserRepository.ts`, documentando que `roles` **nunca** es
      lista vacía.
      *Hecho:* typecheck en verde.
- [ ] **T1.5 — El `WHERE` en `UserRepository.list`** (design §3.3), con el `count` recibiendo
      **el mismo objeto `where`**.
      *Hecho:* T3 en verde. Ojo: esta task **no se da por hecha** con un test de dobles.
- [ ] **T1.6 — `UsuarioService`: `construirFiltro` privado, compartido por `listar` y
      `listarCompleto`**, y el guard `ALLOWED_ROLES` **antes** de tocar el repo en los dos.
      *Hecho:* T2.2 en verde (T-S1/T-S2/T-S3).
- [ ] **T1.7 — Reescribir el comentario de `UsuarioService.ts:143`**, que hoy afirma que «NO
      hay `construirWhere` que extraer aquí, y eso es un HALLAZGO». Esta feature lo desmiente.
      *Hecho:* el comentario describe lo que el método hace ahora. Sin esto queda en el repo
      una afirmación falsa con aire de hallazgo verificado.
- [ ] **T1.8 — Comprobar que `lib/actions/usuarios.ts` NO necesita cambios** (design §2.5).
      *Hecho:* el archivo aparece sin modificar en `git diff`. Si hizo falta tocarlo, algo del
      diseño está mal y se dice en la bitácora antes de seguir.

---

## T2 — Tests de unidad del backend (`backend_dev`). Puede empezar con T1.2 hecha

- [ ] **T2.1 [P] — Ampliar `tests/unit/types/usuario-schema.test.ts`** con T-U1…T-U5
      (design §9.2).
      *Hecho:* los 5 casos en verde y cada uno **muere** con su mutación anotada.
- [ ] **T2.2 [P] — Ampliar `tests/unit/services/usuario-service.test.ts` y
      `tests/unit/services/usuario-descarga.test.ts`** con T-S1…T-S4 (design §9.3).
      *Hecho:* T-S1 comprueba que el doble del repositorio **no recibe ninguna llamada** (no
      basta con que devuelva `forbidden`).
- [ ] **T2.3 [P] — Test unitario de `lib/utils/escapar-like.ts`** (si no quedó cubierto en
      T1.3).
      *Hecho:* verde.

---

## T3 — La prueba que importa: el `WHERE` donde vive (`backend_dev`). Bloquea T4

- [ ] **T3.1 — `tests/integration/db/usuarios-filtro-busqueda.test.ts`** con la semilla y los
      7 casos de design §9.1, usando `_postgres-real.ts`.
      Reglas **no negociables** de esta task:
      - `describe.skip` declarado cuando no hay base — **jamás** un `if (!x) return;` que
        reporte `passed` sin comprobar nada;
      - si falta el catálogo de roles o el de tipos de identificación, el test **falla** con
        un `expect`, no se salta;
      - `serializarEscriturasReales(tx)` como **primera** sentencia de la transacción (se
        escribe en `public."usuario"`, que es tabla real y compartida con otros tests);
      - todo dentro de `enTransaccionRevertida`; emails y cédulas con sufijo único (`@unique`);
      - T-I0 (el acotamiento del corpus) **primero**: sin él, ningún conteo de abajo afirma nada.
      *Hecho:* los 7 casos en verde contra Postgres real, con la salida pegada en la bitácora.
- [ ] **T3.2 — Matar cada test con SU mutación** (design §9.1, columna derecha): quitar la
      rama `email` del `OR`; `count()` sin `where`; quitar el escapado de comodines; quitar
      `mode: "insensitive"`; cambiar el `AND` por `OR`.
      *Hecho:* **cada** mutación deja rojo **al menos** el test que design §9.1 le asigna, y el
      árbol queda restaurado. Se pega la lista mutación → test que cayó. Un arnés de mutaciones
      que reporta supervivientes **sin haber ejecutado un test** ya mintió en este repo: la
      evidencia es la salida del runner, no el resumen.

---

## T4 — Frontend (`frontend_dev`). Empieza cuando T3 está en verde

- [ ] **T4.1 — `app/(app)/configuracion/_components/usuarios-filtros-def.ts`** (design §4.2):
      `CLAVE_BUSQUEDA`, `CLAVE_ROL`, `PLACEHOLDER_BUSQUEDA`, `construirFiltrosUsuarios()`.
      Módulo **puro** (sin React). **No se toca `ordenes-filtros-def.ts`.**
      *Hecho:* T-P1/T-P4 en verde y el archivo no importa nada de `app/(app)/ordenes/`.
- [ ] **T4.2 [P] — `app/(app)/configuracion/_components/seleccion-a-filtro-usuarios.ts`**
      (design §4.3): omite claves vacías, descarta el término por debajo del mínimo, trunca al
      máximo.
      *Hecho:* T-P2/T-P3 en verde.
- [ ] **T4.3 — Cablear `UsuariosModule.tsx`** (design §4.4): barra en `DataTable.filtros`,
      estado del término aparte de la selección, key de SWR con los roles **ordenados**,
      vuelta a página 1 por "ajustar estado durante el render", `fallbackData` condicionado a
      que **no** haya filtros, `emptyState` según haya filtros, `onLimpiarTodo`, y la descarga
      con el filtro del render (`{}` cuando no hay filtros).
      *Hecho:* T-C1…T-C8 en verde.
- [ ] **T4.4 — Comprobar que `app/(app)/configuracion/page.tsx` NO cambia.**
      *Hecho:* no aparece en `git diff`. Si aparece, es señal de que se coló un catálogo que
      el diseño dice que no hace falta (design §4.2).
- [ ] **T4.5 — Ampliar `tests/unit/components/usuarios-module.test.tsx`** con T-C1…T-C8
      (design §9.5). T-C8 compara contra la **constante importada**, no contra un `2` escrito
      a mano ni contra la función que genera el valor.
      *Hecho:* los 8 casos en verde.
- [ ] **T4.6 [P] — Correr `tests/integration/configuracion/usuarios-page.test.tsx` y
      `tests/unit/components/usuarios-columns.test.tsx`.**
      *Hecho:* verdes sin tocarlos. Si alguno se rompe por la barra nueva, se arregla **el
      test**, no el requisito, y se anota por qué.

---

## T5 — Comprobaciones cruzadas (cualquiera de los dos, tras T4)

- [ ] **T5.1 [P] — Guardias de descarga en verde sin haberlas tocado:**
      `tests/unit/descarga/cobertura-tablas.guardia.test.ts`,
      `tests/unit/descarga/columnas-sensibles.guardia.test.ts`,
      `tests/unit/descarga/usuarios-descarga-columnas.test.ts`.
      *Hecho:* verdes y `git diff` **no** las incluye (R24: no se cambia ninguna columna).
- [ ] **T5.2 [P] — Verificar a mano que la descarga filtrada trae lo filtrado.** Con un rol
      marcado, descargar y abrir el archivo.
      *Hecho:* el archivo trae **solo** ese rol y las **mismas 4 columnas** de siempre. "Debería
      funcionar" no cuenta.
- [ ] **T5.3 [P] — Ver la pantalla en el navegador** (la suite no lee textos rotos): buscar,
      marcar dos roles, vaciar, paginar y comprobar el vacío con filtro.
      *Hecho:* captura o descripción de las 5 acciones en la bitácora, con el texto exacto del
      estado vacío filtrado.

---

## T6 — Gate y cierre

- [ ] **T6.1 — `./init.sh` COMPLETO** (no `--rapido`: se negará solo, ver la nota de cabecera).
      *Hecho:* verde, con `INIT_EXIT=$?` **escrito dentro del log** — un `echo` posterior ya
      tapó un rojo en este repo. Log completo, sin canalizarlo por `tail`.
- [ ] **T6.2 — Mapa `R<n> → test` completo en
      `progress/impl_285-usuarios-filtro-y-buscador.md`.** Los 29 requisitos, cada uno con su
      test concreto (design §9). Un requisito sin test es hallazgo bloqueante del reviewer.
      *Hecho:* la tabla existe, está commiteada, y **no hay ninguna fila vacía**.
- [ ] **T6.3 — Verificar el blob commiteado**, no solo el árbol de trabajo
      (`git show HEAD:<archivo>` para los 3 archivos nuevos y los 5 modificados).
      *Hecho:* el contenido commiteado es el que se midió.
- [ ] **T6.4 — Actualizar la ficha 285 en `feature_list.json`** (`status`, `spec_path`,
      `status_note` de 3–6 líneas técnicas; el detalle vive en `progress/`, no duplicado en el
      JSON), y `progress/current.md`.
      *Hecho:* `./init.sh` sigue verde tras el cambio del JSON.

---

## Dependencias, de un vistazo

```
T0 ──► T1.1 ─► T1.2 ─► T2.1
        │        └────► T1.4 ─► T1.5 ─► T3.1 ─► T3.2 ─► T4.* ─► T5.* ─► T6.*
        ├─ T1.3 ────────┘                 ▲
        └─ T1.6 ─► T2.2 ──────────────────┘
   T1.7 / T1.8 pueden ir con T1.6 (ficheros disjuntos)
```

**Lo que NO puede ir en paralelo:** el gate (T6.1) con cualquier task que mute el árbol, y
`backend_dev` con `frontend_dev`.
