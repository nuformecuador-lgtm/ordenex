# Feature 281 — Tareas

> Rama `feature/281-maestro-tarjeta-vacio-de-mas`. Feature `frontend`, complejidad baja.
> Cada tanda cierra con **`./init.sh --rapido`** (también para abrir el PR: el diff no
> toca cimientos, así que el modo rápido no se niega — `docs/verification.md`).
> `[P]` = paralelizable con las tareas de su misma tanda.
> **El gate y las mutaciones NO corren en paralelo**: una guardia leída sobre un árbol
> que otro proceso está mutando no dice nada.
> **La Tanda 0 no toca ni una línea de código.** Es la ficha entera: si el diagnóstico
> no se mide, lo demás es adivinar con más pasos.

---

## Tanda 0 — REPRODUCIR Y MEDIR (R1, R2, R3, R10) — bloquea todo lo demás

- [ ] **T1. Contar las tarjetas EN LA APP, como `maestro`/`admin`, con las dos listas
  vacías.** Sin tocar código.
  1. `pnpm dev` **con la salida a un archivo** (`pnpm dev > dev.log 2>&1`), no por
     tubería.
  2. Conducir con `@playwright/test` desde un script **en el scratchpad** (no en el
     árbol; resolver el paquete con `createRequire("<repo>/package.json")`). Login por
     email + contraseña con una cuenta de acceso total (`admin.qa@ordenex.test` sirve:
     `ROLES_ACCESO_TOTAL` = `maestro` + `admin`, `lib/auth/acceso-total.ts:5`, y
     `/dashboard` los trata igual, `app/(app)/dashboard/page.tsx:34`). Enviar el
     formulario **tras `networkidle` y con espera**: con `domcontentloaded` el click cae
     antes de la hidratación y no sale ni un POST.
  3. **Estado de datos exigido:** cero postulaciones de mensajero pendientes y cero
     postulaciones de vehículo/bodega por revisar. **Comprobarlo antes de contar**, y
     dejar escrito cuántas había. SI la base local no está vacía, **detenerse y
     preguntar** cómo dejarla en cero (Q4): no vaciar tablas por iniciativa propia.
  4. En `/dashboard`, registrar: número de tarjetas de «no hay», el `innerText` de cada
     una, cuál lleva rótulo de sección y cuál no, y el `outerHTML` recortado que permita
     atribuir cada una a su componente (`section[aria-label]`, `[data-slot="card-title"]`).
  **Hecho:** en `progress/impl_281.md` está la cuenta, el texto citable de las tres (o
  las que salgan) y la atribución de cada una a su componente. La captura es la
  confirmación, **el texto es la evidencia**. *(R1)*

- [ ] **T2. `[P]` Correr la suite de esa pantalla ANTES de cambiar nada, y pegar la
  salida.** `pnpm exec vitest run tests/components/AdminMaestroDashboard.test.tsx`.
  Interesa en concreto el caso de `:111-122` y su
  `expect(listarMensajerosMock).toHaveBeenCalledTimes(1)` (`:120`).
  **Hecho:** en `progress/impl_281.md` consta si está verde o roja **hoy**, con la
  salida. Si está verde con dos montajes, queda anotado que esa aserción es insensible
  al doble montaje (fallo mudo) y que R6 **no** se apoyará en ella. Si está roja, queda
  anotado que la suite venía rota y desde cuándo se puede saber. *(R10, Q2)*

- [ ] **T3. `[P]` Confirmar el blob COMMITEADO y nombrar el commit culpable.**
  `git status`, `git show HEAD:"app/(app)/_components/AdminMaestroDashboard.tsx"` y
  `git log -L 30,46:"app/(app)/_components/AdminMaestroDashboard.tsx"` (o `git blame`
  de esa línea). Comprobar también si la línea está en `origin/dev` y en `origin/prod`.
  **Hecho:** consta si el montaje suelto está commiteado, en qué commit entró y en qué
  ramas vive. SI **no** está commiteado → **parar**: es una mutación local ajena, no una
  regresión de la rama, y se vuelve a la puerta humana. *(R2, Q1)*

- [ ] **T4. Contrastar lo medido con el articulado.** Depende de T1, T2, T3.
  **Hecho:** una de dos, escrita en `progress/impl_281.md`:
  (a) la cuenta es **tres**, la sobrante es la de arriba sin título y sale del montaje
  suelto de `AdminMaestroDashboard.tsx:36` → se sigue con la Tanda 1 tal cual;
  (b) la cuenta o el origen **difieren** → se registra la cuenta real, se revisa el
  Grupo B de `requirements.md` y `design.md §3`, y se **vuelve a la puerta humana**
  antes de implementar. No se «ajusta el código hasta que cuadre». *(R3)*

> Cierre de tanda: `./init.sh --rapido` (no hay cambios, sirve de línea base).

---

## Tanda 1 — El arreglo (depende de T4)

- [ ] **T5. Quitar el montaje suelto** de `app/(app)/_components/AdminMaestroDashboard.tsx:36`.
  Nada más: ni textos, ni rótulos, ni orden, ni clases.
  **Hecho:** `pnpm run typecheck` y `pnpm run lint` verdes; el archivo contiene
  **exactamente una** aparición de `<PostulacionesPendientesPanel />` y **una** de
  `<PostulacionRecursoPanel />`; `git diff` de ese archivo **no** muestra ninguna cadena
  visible modificada. *(R4, R5, R6, R12)*

- [ ] **T6. Ajustar el docblock** para que describa la pantalla que queda: dos bloques,
  cada uno en su `ContenedorSeccion` con título, y una línea que diga que **ningún panel
  va suelto fuera de sección** (que es el defecto que esta ficha cierra). No reescribir
  la historia de las features 23/253/R36 ni tocar `progress/` (son fotos históricas).
  Depende de T5.
  **Hecho:** el docblock ya no afirma nada falso sobre la composición, y quien lo lea
  entiende por qué no debe volver a colarse un montaje sin sección. *(R12)*

> Cierre de tanda: `./init.sh --rapido`.

---

## Tanda 2 — La prueba que cuenta (depende de T5)

Todo se **añade** a `tests/components/AdminMaestroDashboard.test.tsx`. No se reescribe
el archivo ni se relaja ningún caso existente.

- [ ] **T7. Caso «pantalla vacía: una tarjeta de vacío por sección» (M1).** Con los dos
  dobles devolviendo `items: []`:
  `expect(screen.getAllByText("No hay postulaciones pendientes")).toHaveLength(1)` y
  `expect(screen.getAllByText("No hay vehículos ni bodegas por revisar")).toHaveLength(1)`.
  **Prohibido** `queryAllByText` sin comparar longitud, `toBeTruthy()` y `length >= 1`.
  **Hecho:** verde, **y visto rojo con MUT-1 y con MUT-4** (§4.3 del design). El nombre
  del caso describe el comportamiento, no la función. *(R4, R9)*

- [ ] **T8. Caso «cada panel se monta una sola vez» (M2).**
  `expect(screen.getAllByRole("region", { name: "Postulaciones pendientes" })).toHaveLength(1)`
  e ídem con «Vehículos y bodegas ofrecidos». Depende de T5.
  **Hecho:** verde, **y visto rojo con MUT-1 y MUT-2**. En el propio test queda escrito
  que **esta** es la medida principal —vale con y sin datos— y que M1 mide el síntoma.
  *(R6, R9)*

- [ ] **T9. `[P]` Caso «ninguna tarjeta huérfana» (M3).** Para cada una de las dos
  regiones: `closest('[data-slot="card"]')` no es `null`, y dentro de esa tarjeta está
  su rótulo («Postulaciones de mensajeros» / «Vehículos y bodegas ofrecidos»). Con el
  **límite escrito en el propio test**: se localiza por `data-slot` porque
  `ContenedorSeccion` no emite landmark **a propósito** (`ContenedorSeccion.tsx:55-60`)
  y añadírselo rompería las guardias de analítica. Depende de T5.
  **Hecho:** verde, **y visto rojo con MUT-3**. *(R5, R9)*

- [ ] **T10. `[P]` Caso «con postulaciones no hay vacíos y nada sale duplicado» (M4).**
  Con el doble de mensajeros devolviendo un item (patrón de
  `tests/components/PostulacionesPendientesPanel.test.tsx:60-75`, que rinde el texto
  `"Nombre-u1 Ap"`) y el de recursos con otro:
  `queryAllByText("No hay postulaciones pendientes")` → **0**,
  `getAllByText("Nombre-u1 Ap")` → **1**, los dos rótulos de sección presentes, y M2
  sigue dando 1 y 1. Depende de T5.
  **Hecho:** verde, **y visto rojo con MUT-5**. *(R7, R8, R9)*

- [ ] **T11. Resolver la aserción heredada de `:120` según lo medido en T2.** Depende de
  T2 y T8.
  - Si T2 la dio **verde con dos montajes** → dejarla, **sin debilitarla**, con un
    comentario que diga qué **no** mide (es insensible al doble montaje por la
    deduplicación de SWR) y que remita a T8 como la medida que sí lo hace.
  - Si T2 la dio **roja** → tras T5 debe volver a verde por sí sola; comprobarlo y
    anotarlo. Si sigue roja, es otro defecto y se dice, no se toca la aserción.
  **Hecho:** la línea `:120` no queda borrada ni relajada, y su alcance real está
  escrito junto a ella. *(R10, R13)*

> Cierre de tanda: `./init.sh --rapido`.

---

## Tanda 3 — Cerrar

- [ ] **T12. Bitácora de mutaciones completa** (design §4.3: MUT-1 … MUT-5), cada una
  vista **roja**, con su salida pegada y el árbol restaurado después. **Secuencial,
  nunca en paralelo con el gate.** **MUT-1 es obligatoria**: es el defecto que esta
  ficha arregla; si sale verde, el test no prueba nada y se vuelve a la Tanda 2.
  Depende de T7-T10.
  **Hecho:** las cinco en `progress/impl_281.md` con su rojo; `git status` limpio salvo
  el trabajo de la feature. *(R9)*

- [ ] **T13. `[P]` Frontera del diff.** `git diff --name-only` contiene **sólo**
  `app/(app)/_components/AdminMaestroDashboard.tsx`,
  `tests/components/AdminMaestroDashboard.test.tsx`, `specs/281-*/`,
  `progress/` y `feature_list.json`. Cero `db/`, `lib/`, `app/api/`, `components/`.
  Los tests existentes de esa pantalla y de los dos paneles, **verdes sin haber sido
  modificados** más allá de lo que T11 autoriza.
  **Hecho:** el listado pegado en la bitácora. Si un test ajeno se pone rojo, se corrige
  el **código**, no el test. *(R11, R12, R13)*

- [ ] **T14. Mapa `R1..R13 → test` completo** en `progress/impl_281.md`, y
  `./init.sh --rapido` **verde** antes de abrir el PR. Comprobar además que `origin/dev`
  no se movió desde la última medición.
  **Hecho:** los 13 requisitos con dueño; ninguna fila «pendiente». *(CHECKPOINTS.md)*

- [ ] **T15. Devolver al leader las preguntas que sigan abiertas** y, si aplica, la
  ficha que esta feature propone dar de alta (design §5.D: red genérica contra montajes
  duplicados). Si T3 encontró que el defecto entró en un commit concreto, decir cuál:
  esa es la información que evita que vuelva.
  **Hecho:** comunicado con su motivo. *(Q1-Q5)*

---

## Mapa R → verificación (propuesto; se cierra en `progress/impl_281.md`)

| R | Cómo se verifica | Dónde |
| --- | --- | --- |
| R1 | conteo + `innerText` de las tarjetas obtenidos conduciendo la app, pegados en la bitácora | **T1** |
| R2 | `git show HEAD:<archivo>` + `git log -L` / `blame`: la línea está commiteada y se nombra su commit | **T3** |
| R3 | contraste explícito medida ↔ articulado, con desenlace (a) o (b) escrito | **T4** |
| R4 | `getAllByText("No hay postulaciones pendientes")` → 1 · `getAllByText("No hay vehículos ni bodegas por revisar")` → 1, con las dos listas vacías | **T7** (rojo con MUT-1, MUT-4) |
| R5 | cada región tiene ancestro `[data-slot="card"]` y ese ancestro contiene su rótulo | **T9** (rojo con MUT-3) |
| R6 | `getAllByRole("region", { name })` → 1 para cada panel, con y sin datos | **T8**, **T10** (rojo con MUT-1, MUT-2) |
| R7 | con items: `queryAllByText(<texto de vacío>)` → 0 y los rótulos presentes | **T10** |
| R8 | con items: `getAllByText("Nombre-u1 Ap")` → 1 | **T10** (rojo con MUT-5) |
| R9 | bitácora de las cinco mutaciones, cada una vista roja; y censo de que ningún caso nuevo usa `queryAllByText` sin longitud, `toBeTruthy` ni `length >= 1` | **T12**, revisión de T7-T10 |
| R10 | resultado medido de `:120` antes del cambio + su límite escrito junto a la línea; R6 apoyado en T8, no en el contador de llamadas | **T2**, **T11** |
| R11 | `git diff --name-only` sin `db/`, `lib/`, `app/api/` | **T13** |
| R12 | `git diff` del componente sin ninguna cadena visible modificada; docblock ajustado sin tocar textos de UI | **T5**, **T6**, **T13** |
| R13 | título, descripción y los dos rótulos siguen; casos existentes verdes sin relajarse ni borrarse | **T11**, **T13** |

---

## Dependencias, de un vistazo

```
T1 ┐
T2 ┤[P]  → T4 → T5 → T6
T3 ┘              └→ T7 ─┐
                  └→ T8 ─┤
                  └→ T9 [P] ─┤→ T12 → T13[P] → T14 → T15
                  └→ T10 [P] ┤
             T2 ──→ T11 ─────┘
```

**Bloqueo declarado:** la Tanda 1 **no empieza** hasta que T4 cierre. Y si T3 encuentra
que la línea sobrante **no está commiteada**, o si T1 cuenta algo distinto de tres
tarjetas, la ficha vuelve a la puerta humana antes de tocar código: son los dos
desenlaces en los que este spec estaría describiendo un problema que no existe.
