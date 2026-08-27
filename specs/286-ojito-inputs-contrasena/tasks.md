# Feature 286 — Tareas

> Rama `feature/286-ojito-inputs-contrasena`. Feature `frontend`, complejidad baja.
> Cada tanda cierra con **`./init.sh --rapido`**, que también sirve para abrir el PR: el
> diff no toca cimientos, así que el modo rápido no se niega (`docs/verification.md:32-53`).
> `[P]` = paralelizable con las tareas marcadas `[P]` de su misma tanda.
> **El gate y las mutaciones NO corren en paralelo:** una guardia leída sobre un árbol que
> otro proceso está mutando no dice nada.
> **Se implementa con `frontend_dev`.** Ni `general-purpose` ni `implementer`.

---

## Tanda 0 — Medir antes de tocar (no cambia ni una línea de producción)

- [ ] **T1. ¿Trae shadcn/ui un componente de contraseña?** `docs/architecture.md:9-10`
  obliga a mirar el registro antes de escribir uno propio. Consultar la documentación
  pública del registro que usa este repo (`components.json`: `style: "base-nova"`).
  **Antes de ejecutar cualquier subcomando de `shadcn`, comprobar qué escribe**: en este
  repo ya pasó que un comando aparentemente de sólo lectura instalara archivos y hooks. Si
  algo se escribe sin querer, revertirlo y decirlo.
  **Hecho:** en `progress/impl_286.md` consta una de dos: (a) no existe → se construye
  `PasswordInput` como dice `design.md §2`; (b) existe → se añade a `components/ui/` con
  `npx shadcn add <nombre>` y `PasswordInput` se construye **encima**, sin copiar su
  maqueta. *(R2)*

- [ ] **T2. `[P]` Línea base de las cuatro suites, ANTES de tocar nada.**
  `pnpm exec vitest run tests/components/LoginForm.test.tsx tests/components/PostulacionForm.test.tsx tests/integration/recuperar-contrasena-form.test.tsx tests/unit/components/usuario-form.test.tsx`
  con la salida **a un archivo** (nada de tuberías: un log largo por `tail` se trunca en
  origen y el rojo se queda sin nombre).
  **Hecho:** la salida pegada en `progress/impl_286.md`, diciendo si están verdes **hoy**.
  Si alguna viene roja de `dev`, se dice y **no se cuenta como daño de esta ficha**.
  *(R17)*

- [ ] **T3. `[P]` Recontar el censo sobre la rama recién creada.**
  `grep -rn 'type="password"' --include=*.tsx app/ components/` y, además, el mismo censo
  sobre **todo** el repo (`dev` se mueve mientras se especifica).
  **Hecho:** consta el conteo. Si son **6 en 4 archivos**, se sigue. **Si aparece un
  séptimo**, entra en el alcance: se añade a la tabla del censo, al recuento de la guardia
  (T14) y a esta lista de tareas antes de continuar. *(R1)*

> Cierre de tanda: `./init.sh --rapido` como línea base.

---

## Tanda 1 — El componente y su suite (depende de T1)

- [ ] **T4. Crear `components/shared/PasswordInput.tsx`** con `"use client"`, según el
  contrato de `design.md §3` y el marcado de `§4.1`: `Input` + `Button` de la casa (nada
  de `<button>` a mano, `DESIGN.md:59`), botón **después** del input en el DOM,
  `type="button"`, `aria-label` con estado y acción, región viva `sr-only` con
  `aria-live="polite"` **sin `role`**, iconos `Eye`/`EyeOff` con `aria-hidden`, `pr-8` en
  el input y `[&::-ms-reveal]:hidden`. Estado interno: `visible` y `tocado`.
  **Hecho:** `pnpm run typecheck` y `pnpm run lint` verdes; el archivo **no** exporta
  ninguna prop `type`; ningún consumidor puede fijarla (lo impide el `Omit<…, "type">`).
  *(R2, R5, R10, R11, R14, R15, R15.1)*

- [ ] **T5. Caso «arranca oculta y alterna en los dos sentidos» (M1)** en
  `tests/components/PasswordInput.test.tsx`. Montar suelto, teclear un valor, y afirmar la
  **secuencia** del atributo `type`: `["password", "text", "password"]` tras dos
  pulsaciones, **y que el valor tecleado sobrevive** a las dos. Depende de T4.
  **Hecho:** verde, **y visto rojo con MUT-1**. Prohibido conformarse con «existe un
  botón»: la aserción es sobre el `type` del input, no sobre la presencia del control.
  *(R5, R6, R7, R8, R18)*

- [ ] **T6. `[P]` Caso «el ojito no envía, y se opera con teclado» (M2).** Montar el
  componente **dentro de un `<form onSubmit={espia}>`**; pulsar con ratón, con `Enter` y
  con `Espacio`: el espía **no** se llama ni una vez y el `type` cambia las tres veces.
  Afirmar además `boton.tagName === "BUTTON"`, `type="button"`, que `Tab` desde el input
  lleva **al botón** y el siguiente `Tab` al elemento posterior, y que con `disabled` el
  botón sale deshabilitado y pulsarlo no cambia nada. Depende de T4.
  **Hecho:** verde, **y visto rojo con MUT-2**. *(R10, R11, R12, R18)*

- [ ] **T7. `[P]` Test de contraste del icono (R16).** Con
  `tests/fixtures/contraste.ts`: `contraste(token(tema, "--muted-foreground"), token(tema, X))`
  para `tema ∈ {claro, oscuro}` y `X ∈ {--background, --card}`; las **cuatro** ≥ 3.
  SI alguna no llega, se cambia el token del icono a `text-foreground` (y se vuelve a
  medir), **no se baja el umbral**. Depende de T4.
  **Hecho:** las cuatro razones **con su número** en `progress/impl_286.md`, y el test en
  el árbol. *(R16)*

- [ ] **T8. `[P]` Caso «nombre accesible y anuncio» (M3).** Afirmar contra **literales
  escritos a mano**: con `etiqueta="Contraseña"`, el nombre es
  `"Contraseña: oculta. Mostrar."` y tras pulsar `"Contraseña: visible. Ocultar."`
  (`new Set(nombres).size === 2`). La región `[data-contrasena-anuncio]` existe, tiene
  `aria-live="polite"` y `aria-atomic="true"`, **no tiene `role`**,
  `screen.queryAllByRole("status")` da **0**, su texto es **vacío en el primer render** y
  tras pulsar dice `"Contraseña visible"`. Depende de T4.
  **Hecho:** verde, **y visto rojo con MUT-4 y con MUT-5**. Ningún literal se importa del
  componente: se escriben a mano (comparar un texto con su propia fuente sale verde
  siempre). *(R14, R15, R15.1, R18)*

- [ ] **T9. `[P]` Caso «el campo sigue siendo el campo» (M4).** Dentro de un `FormField`
  con `error`, afirmar que el **`<input>`** —no el envoltorio— lleva el `id`, el
  `aria-invalid`, el `aria-describedby` que apunta al `FieldError` y el `aria-required`; y
  que `getByLabelText("<etiqueta>")` devuelve un elemento cuyo `tagName` es `INPUT`.
  Probarlo **en los dos modos** de `FormField`: hijo-elemento y render-prop. Añadir un caso
  con `ref`: `ref.current.focus()` enfoca el input. Depende de T4.
  **Hecho:** verde, **y visto rojo con MUT-6**. *(R13, R18)*

> Cierre de tanda: `./init.sh --rapido`.

---

## Tanda 2 — Sustituir los 6 usos (depende de T4; las cuatro entre sí son `[P]`)

En las cuatro: sustituir `<Input type="password" …>` por `<PasswordInput etiqueta="…" …>`
**sin tocar nada más** —ni etiquetas, ni placeholders, ni validación, ni orden— y sin
duplicar literales donde el archivo ya tenga su catálogo de textos.

- [ ] **T10. Login** (`app/login/_components/LoginForm.tsx:254`, render-prop + `ref`).
  Y **ampliar** el caso de orden de tabulación (`tests/components/LoginForm.test.tsx:380`)
  a `correo → contraseña → ojito → «Iniciar sesión»`: se **añade** el paso, no se relaja ni
  se borra la aserción. Añadir un caso de integración: teclear la contraseña, pulsar el
  ojito y comprobar que **`login` no se ha invocado** y que el valor tecleado sigue ahí.
  **Hecho:** la suite entera de `LoginForm` verde; `LoginForm.test.tsx:49`
  (`toHaveAttribute("type","password")`) sigue **igual y verde**; el caso de foco de
  `:366` (`expect(getByLabelText("Contraseña")).toHaveFocus()`) sigue verde **sin
  tocarlo** —es la prueba de que el `ref` sigue llegando al input—. *(R1, R4, R10, R11, R13, R17)*

- [ ] **T11. `[P]` Postulación** (`PostulacionForm.tsx:500` y `:514`; etiquetas desde
  `TEXTO_LABELS`). Añadir el caso de **R9**: revelar «Contraseña» deja «Confirmar
  contraseña» en `type="password"`, y viceversa.
  **Hecho:** suite verde con `PostulacionForm.test.tsx:166-170` intactas; el caso nuevo
  **visto rojo con MUT-3**. *(R1, R4, R9, R17, R18)*

- [ ] **T12. `[P]` Recuperar contraseña** (`RecuperarContrasenaForm.tsx:352` con `ref`, y
  `:367`). Mismo caso de R9 sobre «Nueva contraseña» + «Confirmar contraseña».
  **Hecho:** `tests/integration/recuperar-contrasena-form.test.tsx` verde, incluidos los
  `getByLabelText("Nueva contraseña")` de `:49,102,114`; caso nuevo **visto rojo con
  MUT-3**. *(R1, R4, R9, R13, R17, R18)*

- [ ] **T13. `[P]` Alta de usuario** (`UsuarioForm.tsx:511`, sólo el bloque
  `passwordMode === "manual"`). **No se toca** el panel de «Contraseña generada» de
  `:314-345`: es `type="text"` a propósito y está fuera del censo. Añadir un caso: en modo
  manual hay ojito y alterna; al pasar a «Generar automáticamente» desaparece con el campo.
  **Hecho:** `tests/unit/components/usuario-form.test.tsx` verde, con
  `queryByLabelText("Contraseña")).not.toBeInTheDocument()` de `:125` y `:208` **intactas y
  verdes** (si alguna se pone roja, el nombre accesible del botón está mal: no se toca el
  test, se arregla el componente). *(R1, R4, R17)*

> **Frontera dura de esta tanda:** el diff NO puede incluir `UsuariosModule.tsx`,
> `lib/actions/usuarios.ts` ni `lib/services/UsuarioService.ts` —son de la feature 285, en
> curso en paralelo—. Si algo empuja hacia ahí, **parar y avisar**. *(R3)*
>
> Cierre de tanda: `./init.sh --rapido`.

---

## Tanda 3 — La guardia que sobrevive al spec (depende de T10-T13)

- [ ] **T14. `tests/unit/guards/contrasena-maqueta-unica.guardia.test.ts`**, según
  `design.md §7`, leyendo con `tests/fixtures/sin-comentarios.ts`. Tres capas:
  (1) ningún `.tsx` de `app/` ni `components/` declara `type="password"` salvo
  `PasswordInput.tsx`; (2) **control positivo**: `PasswordInput.tsx` sí lo declara;
  (3) los cuatro archivos del censo importan `PasswordInput` con el recuento de usos
  esperado (1, 1, 2, 2).
  **Hecho:** verde, y **vista roja tres veces**: reponiendo un `type="password"` en un
  formulario, vaciando el del componente (la capa 2) y quitando un `PasswordInput` de
  postulación (la capa 3). Sin ese triple rojo, la guardia no vale nada. *(R2, R18)*

> Cierre de tanda: `./init.sh --rapido`.

---

## Tanda 4 — Cerrar

- [ ] **T15. Bitácora de mutaciones completa** (MUT-1 … MUT-6 de `requirements.md`, más las
  tres de T14), cada una **vista roja**, con su salida pegada y el árbol restaurado
  después. **Secuencial, nunca en paralelo con el gate.** Depende de T5-T9, T11, T12, T14.
  **Hecho:** las nueve en `progress/impl_286.md` con su rojo y con el test que murió;
  `git status` limpio salvo el trabajo de la feature. **MUT-1 es obligatoria**: si sale
  verde, el test comprueba que hay un botón y no que el `type` cambia, y se vuelve a T5.
  *(R18)*

- [ ] **T16. `[P]` Frontera del diff.** `git diff --name-only` contiene **sólo** los
  archivos de `design.md §8`. Cero `db/`, cero `lib/`, cero `app/api/`, cero
  `UsuariosModule.tsx`. Y `git diff` de los cuatro formularios **sin ninguna cadena visible
  modificada** (etiquetas, placeholders y mensajes idénticos).
  **Hecho:** el listado pegado en la bitácora. Si un test ajeno se pone rojo, se arregla el
  **código**, no el test. *(R3, R4, R17)*

- [ ] **T17. `[P]` Mirar la app** (opcional según Q6; si el humano la pide, deja de serlo).
  Con `pnpm dev` (salida **a un archivo**), recorrer las cuatro pantallas: `/login`,
  `/postulacion`, `/recuperar-contrasena` y el alta de usuario en configuración. Comprobar
  con los ojos: (a) el icono no tapa el texto tecleado ni se sale del campo, en los dos
  temas; (b) **no hay dos ojitos** (el nativo de Edge queda oculto, `design.md §4.4`);
  (c) el anillo de foco se ve al llegar con `Tab`.
  **Hecho:** o las capturas y lo observado en `progress/impl_286.md`, o —si no se hace— la
  frase explícita de que (a), (b) y (c) **quedan sin verificar**. No se afirma lo que no se
  ha visto. *(R16, y el límite de §4.4)*

- [ ] **T18. Mapa `R1..R18 → test` completo** en `progress/impl_286.md`, y
  `./init.sh --rapido` **verde** antes de abrir el PR. Comprobar que `origin/dev` no se
  movió desde T3 y que el blob commiteado es el que se midió. Depende de todo lo anterior.
  **Hecho:** los 18 requisitos con dueño, ninguna fila «pendiente»; el PR abierto con el
  gate verde pegado. Y recordar: **un PR verde no dice nada de los tests** —el único check
  automático es un build de Vercel—, así que el veredicto es el del gate, no el del PR.
  *(CHECKPOINTS.md)*

---

## Mapa R → verificación (propuesto; se cierra en `progress/impl_286.md`)

| R | Cómo se verifica | Dónde | Muere con |
| --- | --- | --- | --- |
| R1 | los 6 campos: en cada suite, el ojito existe y alterna el `type` de **ese** campo | T10, T11, T12, T13 | MUT-1 |
| R2 | guardia de maqueta única, tres capas con control positivo | T14 | reponer un `type="password"` |
| R3 | `git diff --name-only` sin `lib/`, `db/`, `app/api/`, `UsuariosModule.tsx` | T16 | — |
| R4 | `git diff` de los 4 formularios sin cadenas visibles modificadas; suites previas verdes | T16, T2 | — |
| R5 | primer render `type="password"`; remontar vuelve a oculto; sin escritura en `localStorage`/cookie | T5 | MUT-1 |
| R6 | secuencia `["password","text",…]` y valor conservado | T5 | MUT-1 |
| R7 | secuencia `[…,"text","password"]` | T5 | MUT-1 |
| R8 | tras pulsar, `document.activeElement` es el botón y el input conserva valor | T5, T6 | remontar el input al alternar |
| R9 | revelar un campo deja el otro en `password` (postulación y recuperación) | T11, T12 | **MUT-3** |
| R10 | dentro de un `<form>` espiado: ratón, `Enter` y `Espacio` no llaman al `onSubmit`; `type="button"` | T6, T10 | **MUT-2** |
| R11 | `tagName === "BUTTON"`; `Tab` desde el input llega al botón y el siguiente al submit | T6, T10 | `tabIndex={-1}` |
| R12 | con `disabled`, el botón sale deshabilitado y pulsarlo no cambia el `type` | T6 | quitar el `disabled` del botón |
| R13 | el `<input>` lleva `id`/`aria-invalid`/`aria-describedby`/`aria-required`; `getByLabelText` da un `INPUT`; el `ref` enfoca | T9, T10, T12 | **MUT-6** |
| R14 | dos nombres accesibles literales y distintos, con etiqueta + estado + acción | T8 | **MUT-4** |
| R15 | región `aria-live="polite"`/`aria-atomic`, vacía al montar, con texto tras pulsar | T8 | dejarla estática |
| R15.1 | la región no tiene `role`; `queryAllByRole("status")` = 0; los `alert` siguen siendo los de siempre | T8, T10 | **MUT-5** |
| R16 | 4 razones de contraste ≥ 3 calculadas con `tests/fixtures/contraste.ts` | T7 | bajar el umbral (prohibido) |
| R17 | las 4 suites verdes, con las aserciones citadas intactas; sólo se **amplía** el caso de tabulación | T2, T10-T13, T16 | borrar/relajar una aserción |
| R18 | bitácora de las nueve mutaciones, cada una vista roja, con su salida | T15 | — |

---

## Dependencias, de un vistazo

```
T1 ┐
T2 ┤[P]
T3 ┘[P]
   └→ T4 ─┬→ T5
          ├→ T6  [P]
          ├→ T7  [P]
          ├→ T8  [P]
          ├→ T9  [P]
          └→ T10 ─┐
             T11 [P] ┤
             T12 [P] ┼→ T14 → T15 → T16[P] → T17[P] → T18
             T13 [P] ┘
```

**Bloqueos declarados:**
1. La Tanda 1 **no empieza** hasta que T1 diga si shadcn/ui ya trae la pieza.
2. Si T3 encuentra un **séptimo** campo de contraseña, entra en el alcance antes de
   seguir: el censo manda sobre la ficha.
3. Si algo del trabajo empuja hacia `UsuariosModule.tsx`, `lib/actions/usuarios.ts` o
   `lib/services/UsuarioService.ts`, se **para** y se avisa: es colisión con la feature 285.
