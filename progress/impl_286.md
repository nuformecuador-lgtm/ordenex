# Feature 286 — el ojito en los seis inputs de contraseña · bitácora de implementación

> Rama `worktree-agent-a6a751280da79945a`, partiendo de `origin/dev` (`b9422108`).
> Implementado con `frontend_dev`, siguiendo `specs/286-ojito-inputs-contrasena/`.
> Fecha: 2026-08-26.

---

## 0. Lo que hay que leer antes que nada: dos cosas del spec que la medida desmintió

Están arriba a propósito. El resto de este archivo es la trazabilidad; esto es lo que
**no** salió como el spec decía.

### (a) MUT-2 tal y como está escrita es INERTE, y por eso sobrevivió

`requirements.md` R18 exige ver roja la mutación «se quita `type="button"` del botón».
**Se corrió, y salió VERDE: 51 tests, 0 fallos.** Antes de tocar ningún test se midió por
qué, con una sonda sobre la primitiva de la casa:

```
sin type          -> tagName=BUTTON  atributo type="button"  propiedad .type=button
con type button   -> tagName=BUTTON  atributo type="button"  propiedad .type=button
con type submit   -> tagName=BUTTON  atributo type="submit"  propiedad .type=submit
```

El `Button` del repo (sobre `@base-ui/react/button`) **ya emite `type="button"` por
defecto**. Quitar el `type="button"` explícito deja el DOM **byte a byte idéntico**: no es
que el test sea flojo, es que la mutación no cambia nada que un test pueda ver. Un
superviviente ahí no dice nada de la suite.

Lo que R10 protege de verdad —un botón que ENVÍA— se midió con **MUT-2b**
(`type="button"` → `type="submit"`), que sí cambia el DOM: **mata 4 tests**, y entre ellos
el de integración del login, donde la Server Action `login` **se invoca de verdad** una
vez. Ver §3.

**El `type="button"` explícito se queda en el componente** aunque hoy sea redundante: es
lo que pide el spec, documenta la intención, y deja de ser redundante el día que alguien
cambie la primitiva o monte el botón sobre otra cosa.

### (b) Dos imprecisiones menores del spec, resueltas sin rediseñar nada

1. **`design.md §4.3` llama a `token("claro","--muted-foreground")`**; la utilería real
   (`tests/fixtures/contraste.ts:183`) toma el nombre **sin** los dos guiones, y con ellos
   lanza. Se usó la firma real. No cambia ninguna decisión.
2. **`design.md §7` capa 2** dice que el control positivo es que `PasswordInput.tsx`
   «contiene `type="password"`». No lo contiene y no puede contenerlo: el `type` es una
   **expresión** (`type={visible ? "text" : "password"}`), como manda el propio `§4.1`.
   Leído con `sin-comentarios`, el literal `type="password"` en ese archivo sólo vive en
   los comentarios —y los comentarios ya no están—. La capa 2 se implementó contra **el
   propósito declarado en el mismo párrafo** («si no, la prohibición de arriba sería vacía
   y quedaría verde para siempre con la app rota»): afirma que el `type` del componente
   vale `"password"` en reposo y `"text"` al revelar. Verificada en rojo (§3, GUARDIA-2).

Nada más del spec quedó sin cumplir. **T17 (mirar la app) NO se hizo**: ver §7.

---

## 1. Tanda 0 — lo medido antes de tocar una línea

### T1 — ¿trae shadcn/ui un componente de contraseña? **NO**

Se consultó el índice del registro por HTTP (`GET https://ui.shadcn.com/r/index.json`,
58 KB, sólo lectura: **no** se ejecutó ningún subcomando de `shadcn`, por la lección del
`--help` que instala). **63 componentes**, y las coincidencias con
`password|reveal|eye|secret` son **cero**. Los `input*` del registro son `input`,
`input-group` e `input-otp`. El paquete instalado (`@base-ui/react` 1.6) tampoco trae
nada: hay `otp-field`, no hay campo de contraseña.

→ Rama (a) de T1: se construye `PasswordInput` como dice `design.md §2`.

### T2 — línea base de las cuatro suites, ANTES de tocar nada: **VERDES**

```
Test Files  4 passed (4)
     Tests  67 passed (67)
  Duration  29.72s
VITEST_EXIT=0
```

(`LoginForm.test.tsx`, `PostulacionForm.test.tsx`, `recuperar-contrasena-form.test.tsx`,
`usuario-form.test.tsx`.) Ninguna venía roja de `dev`.

### T3 — recuento del censo sobre la rama recién creada: **6 en 4 archivos**

Idénticos a la ficha, mismas líneas. Se barrió `app/` + `components/`, luego **todo** el
repo en `.tsx`, y luego el repo entero sin filtro de extensión:

```
app/(app)/configuracion/_components/UsuarioForm.tsx:511
app/login/_components/LoginForm.tsx:254
app/postulacion/_components/PostulacionForm.tsx:500
app/postulacion/_components/PostulacionForm.tsx:514
app/recuperar-contrasena/_components/RecuperarContrasenaForm.tsx:352
app/recuperar-contrasena/_components/RecuperarContrasenaForm.tsx:367
```

**No apareció un séptimo.** El barrido sin filtro saca además ~20 apariciones en `e2e/`,
pero son `page.fill('input[type="password"]', …)`: **selectores de Playwright** sobre un
DOM que este componente sigue produciendo, no maquetas propias. Quedan fuera de la
guardia y se dice por escrito en su cabecera.

### Gate de línea base (antes de tocar nada)

```
✓ typecheck paso
✓ lint paso
❯ tests/unit/guards/superficie-de-uso.guardia.test.ts (18 tests | 1 failed)
    × ninguna Server Action de `lib/actions/**` es inalcanzable sin su anotación
      `@sin-superficie`
      + [ "lib/actions/tarifas.ts:67 obtenerTarifa" ]
Test Files  1 failed | 148 passed (149)
     Tests  1 failed | 2245 passed (2246)
INIT_EXIT=1
```

**1 fallo, ajeno y preexistente** (ficha 275, `obtenerTarifa` inalcanzable). No se tocó.

---

## 2. Lo que se hizo

### El componente

`components/shared/PasswordInput.tsx` — `"use client"`, `Input` + `Button` de la casa,
botón **después** del input en el DOM, `type="button"`, `aria-label` con etiqueta + estado
+ acción, región viva `sr-only` con `aria-live="polite"` y `aria-atomic="true"` **sin
`role`**, iconos `Eye`/`EyeOff` con `aria-hidden`, `pr-8` y `[&::-ms-reveal]:hidden`.
Estado interno `visible` + `tocado`, **uno por campo**. `type` excluido del tipo de props
(`Omit<…, "type">`): un consumidor no puede fijarlo, y eso lo vigila el compilador.

### Los 6 usos, sustituidos

| Archivo | Usos | Cómo se monta |
| --- | --- | --- |
| `app/login/_components/LoginForm.tsx` | 1 | render-prop + `ref` (conservado) |
| `app/postulacion/_components/PostulacionForm.tsx` | 2 | hijo-elemento, `etiqueta={TEXTO_LABELS.…}` |
| `app/recuperar-contrasena/_components/RecuperarContrasenaForm.tsx` | 2 | el primero render-prop + `ref` (conservado) |
| `app/(app)/configuracion/_components/UsuarioForm.tsx` | 1 | hijo-elemento, sólo el bloque `passwordMode === "manual"` |

El séptimo campo relacionado —«Contraseña generada», `UsuarioForm.tsx:321`— **no se
tocó**: ya es texto plano a propósito.

### Contraste del icono (T7) — MEDIDO, no supuesto

Con `tests/fixtures/contraste.ts`. `text-muted-foreground`, las cuatro combinaciones que
pide R16:

| Tema | Superficie | Par (tinta / fondo) | Razón | ¿≥ 3? |
| --- | --- | --- | --- | --- |
| claro | `--background` | `#4a5368` / `#f7f8fc` | **7,25** | sí |
| claro | `--card` | `#4a5368` / `#ffffff` | **7,70** | sí |
| oscuro | `--background` | `#9fadc9` / `#0a1524` | **8,11** | sí |
| oscuro | `--card` | `#9fadc9` / `#10203a` | **7,21** | sí |

Las cuatro por encima de 3, con margen: no hizo falta caer a `text-foreground`. La
medición **vive como test** (`PasswordInput.test.tsx`, bloque R16), no como afirmación en
prosa, y va atada al árbol con un segundo caso que comprueba que el botón pinta **ese**
token —sin él, alguien cambia la clase por un color sin medir y la aritmética de arriba
sigue verde sin significar nada—.

---

## 3. Bitácora de mutaciones — nueve obligatorias, y dos más de regalo

Todas **secuenciales**, nunca en paralelo con el gate. Cada una se aplicó con un arnés que
se autocomprueba (aborta si el texto no aparece exactamente una vez, si el archivo no
cambia en disco, o si la restauración no devuelve el mismo `sha`) y que **imprime el exit
code real de vitest y el conteo de tests** — este repo ya tuvo un arnés de mutaciones que
reportaba supervivientes sin haber ejecutado un solo test.

| # | Mutación | Exit | Muertos | Qué murió (lo que importa) |
| --- | --- | --- | --- | --- |
| **MUT-1** | el `onClick` no cambia el estado (el `type` queda fijo en `password`) | 1 | **8** | `R5/R6/R7: la secuencia del atributo type es password -> text -> password`; `R6/R7/R8: el valor tecleado sobrevive…`; R9; R14 ×2; R15 |
| **MUT-2** | se quita `type="button"` | 0 | **0** | **INERTE — ver §0(a).** La primitiva ya lo emite; el DOM no cambia |
| **MUT-2b** | `type="button"` → `type="submit"` *(la que sí cambia el DOM)* | 1 | **4** | `R10: ni el ratón, ni Enter, ni Espacio envían…` (espía llamado **3** veces); `LoginForm > R10: pulsar el ojito NO envia el formulario` (**`login` invocado 1 vez**); R11 |
| **MUT-3** | el estado sube a uno solo compartido por todos los campos | 1 | **13** | **los tres R9**: el del componente, `PostulacionForm > R9: revelar «Contraseña» NO revela «Confirmar contraseña»` y `RecuperarContrasenaForm > R9: …«Nueva contraseña»…` |
| **MUT-4** | nombre accesible fijo («Mostrar contraseña») | 1 | **14** | `R14: el nombre accesible dice etiqueta + estado + acción, y CAMBIA al alternar` (`expected [Array(2)] to deeply equal [Array(2)]`); `R14: el nombre lleva la etiqueta DE SU campo…` |
| **MUT-5** | `role="status"` en la región viva | 1 | **2** | **exactamente los dos R15.1** y nada más: `expected 'status' to be null` y, en el login, `expected [<span role="status">] to have a length of +0 but got 1` |
| **MUT-6** | `id`/`aria-describedby` al envoltorio en vez de al `<input>` | 1 | **45** | **los cinco R13**, y de paso media suite de login: `Found a label with the text of: Contraseña, however the element associated with this label (<div />) is non-labellable` |
| **GUARDIA-1** | se repone un `type="password"` en un formulario | 1 | **1** | capa 1: `ningún .tsx de app/ ni components/ declara type="password" por su cuenta` |
| **GUARDIA-2** | se vacía el enmascarado del componente | 1 | **1** | capa 2 (control positivo): `el componente compartido SÍ enmascara` |
| **GUARDIA-3** | se quita un `<PasswordInput>` de postulación | 1 | **1** | capa 3: `los cuatro archivos del censo usan el componente compartido, con el recuento del censo` |
| EXTRA-1 | `tabIndex={-1}` *(la alternativa descartada)* | 1 | **3** | R11 ×2 **y el R23 del login**: `expected -1 to be +0` |
| EXTRA-2 | se quita el `disabled` del botón | 1 | **1** | `R12: con el campo deshabilitado el ojito sale deshabilitado…` |

**MUT-1 era la obligatoria** («un test que comprueba que el botón existe pero no que
cambia el `type` no prueba nada»): mata el caso de la **secuencia** `["password", "text",
"password"]`, que es una aserción sobre el atributo del input, no sobre la presencia del
control.

Tras cada mutación el árbol quedó restaurado con el `sha` original (verificado por el
propio arnés) y `git status` limpio salvo el trabajo de la feature.

---

## 4. Mapa R → verificación (los 18, con dueño; ninguna fila pendiente)

| R | Test concreto | Archivo | Muere con |
| --- | --- | --- | --- |
| R1 | `R1/R6/R7: el campo de contraseña tiene ojito y alterna su type…` · `R1/R14: los DOS campos tienen su ojito…` · `R1/R14: los dos campos de la fase tienen ojito…` · `R1: en modo «Escribir» hay ojito y alterna el type` | LoginForm, PostulacionForm, recuperar-contrasena-form, usuario-form | MUT-1 |
| R2 | las 4 capas de la guardia | `contrasena-maqueta-unica.guardia.test.ts` | GUARDIA-1/2/3 |
| R3 | frontera del diff (§5) | — | — |
| R4 | `git diff` de los 4 formularios sin cadenas visibles cambiadas (§5) + las 4 suites previas | — | — |
| R5 | `R5/R6/R7: la secuencia…` · `R5: al volver a montar, vuelve a estar oculta y no se escribió el estado en ningún almacén` | PasswordInput | MUT-1 |
| R6 | `R5/R6/R7: la secuencia…` · `R6/R7/R8: el valor tecleado sobrevive…` | PasswordInput | MUT-1 |
| R7 | `R5/R6/R7: la secuencia…` | PasswordInput | MUT-1 |
| R8 | `R8: tras pulsar, el foco queda en el propio botón` · `R6/R7/R8: …el input NO se reconstruye` | PasswordInput | MUT-1 / remontar el input |
| R9 | `R9: revelar uno NO revela el otro…` (×3: componente, postulación, recuperación) | PasswordInput, PostulacionForm, recuperar-contrasena-form | **MUT-3** |
| R10 | `R10: ni el ratón, ni Enter, ni Espacio envían el formulario` · `R10: pulsar el ojito NO envia el formulario ni pierde lo tecleado` · `R10: pulsar el ojito no restablece nada` · `R10: pulsar el ojito no envia el alta` | PasswordInput, LoginForm, recuperar-contrasena-form, usuario-form | **MUT-2b** |
| R11 | `R11: es un <button> nativo con type="button" y sin tabindex` · `R11: Tab desde el campo llega al ojito…` · `R23 (+286 R11): el orden de tabulacion es email -> password -> ojito -> submit` | PasswordInput, LoginForm | EXTRA-1 (`tabIndex={-1}`) |
| R12 | `R12: con el campo deshabilitado el ojito sale deshabilitado y pulsarlo no revela nada` | PasswordInput | EXTRA-2 |
| R13 | `R13: como hijo-elemento…` · `R13: como render-prop…` · `R13: el aria-required también cae en el <input>` · `R13: el ref llega al <input> y lo enfoca` · `R13: value, onChange, placeholder y name viajan al <input>` · `R13: el ref sigue llegando al input — al fallar la validacion, el foco va al campo` | PasswordInput, recuperar-contrasena-form | **MUT-6** |
| R14 | `R14: el nombre accesible dice etiqueta + estado + acción, y CAMBIA al alternar` · `R14: el nombre lleva la etiqueta DE SU campo…` · `R14: «Nueva contraseña» visible produce su literal exacto` · `R14: el icono es aria-hidden` | PasswordInput | **MUT-4** |
| R15 | `R15: la región viva arranca VACÍA y anuncia el estado ya aplicado` | PasswordInput | MUT-1 (deja el texto quieto) |
| R15.1 | `R15.1: la región NO lleva role; ni status ni alert aparecen por su culpa` · `R15.1: el ojito no estrena ningun role="status" ni role="alert" en la pantalla` | PasswordInput, LoginForm | **MUT-5** |
| R16 | `R16: text-muted-foreground pasa de 3:1 en los DOS temas y sobre las DOS superficies` · `R16: el componente pinta el icono con ESE token y no con otro` | PasswordInput | bajar el umbral (prohibido) / cambiar la clase |
| R17 | las 4 suites verdes con sus aserciones citadas intactas (§6) | — | borrar/relajar una aserción |
| R18 | esta bitácora, §3 | — | — |

---

## 5. Frontera del diff (T16, R3/R4)

```
 M app/(app)/configuracion/_components/UsuarioForm.tsx
 M app/login/_components/LoginForm.tsx
 M app/postulacion/_components/PostulacionForm.tsx
 M app/recuperar-contrasena/_components/RecuperarContrasenaForm.tsx
 M tests/components/LoginForm.test.tsx
 M tests/components/PostulacionForm.test.tsx
 M tests/integration/recuperar-contrasena-form.test.tsx
 M tests/unit/components/usuario-form.test.tsx
?? components/shared/PasswordInput.tsx
?? tests/components/PasswordInput.test.tsx
?? tests/unit/guards/contrasena-maqueta-unica.guardia.test.ts
?? specs/286-ojito-inputs-contrasena/
?? progress/impl_286.md
```

**Cero** `db/`, **cero** `lib/`, **cero** `app/api/`. **Cero** archivos de la 285 o la 287:
ni `UsuariosModule.tsx`, ni `lib/actions/usuarios.ts`, ni `lib/services/UsuarioService.ts`.
**Cero** `lib/actions/tarifas.ts` y cero `superficie-de-uso.guardia.test.ts`.
Tampoco se tocó `feature_list.json` (es del leader, y lo comparten tres fichas en vuelo).

**R4 — ninguna cadena visible cambió.** El diff de los cuatro formularios es, línea a
línea, `<Input type="password"` → `<PasswordInput etiqueta=…` más el `import`. Ni una
etiqueta, ni un placeholder, ni un mensaje de error, ni el orden de los campos. Los
valores de `etiqueta` son **las mismas etiquetas visibles que ya estaban ahí** (en
postulación se leen de `TEXTO_LABELS`, sin duplicar el literal).

---

## 6. R17 — nada se relajó, y aquí está la prueba

**En los cuatro archivos de test, el diff borra UNA sola línea en total**, y es el título
del caso R23 que se renombró:

```
-  it("R23: el orden de tabulacion es email -> password -> submit", async () => {
```

Todo lo demás son **añadidos**. El caso quedó así: conserva sus tres paradas y sus tres
aserciones originales, en el mismo orden, y **añade una** en medio:

```
expect(email).toHaveFocus();
await user.tab();
expect(password).toHaveFocus();
await user.tab();
expect(ojito).toHaveFocus();      // ← el paso nuevo
await user.tab();
expect(submit).toHaveFocus();
```

La alternativa (`tabIndex={-1}`) está descartada por escrito y **medida**: EXTRA-1 la
aplica y mata este mismo caso, además de los dos R11. Dejar el control fuera del teclado
es lo contrario de lo que se pidió.

Las aserciones que R17 nombra siguen **vivas, sin tocar y en su línea original**:

| Aserción | Dónde | Estado |
| --- | --- | --- |
| `expect(passwordInput).toHaveAttribute("type", "password")` | `LoginForm.test.tsx:49` | intacta |
| las dos de contraseña/confirmación | `PostulacionForm.test.tsx:166-170` | intactas |
| `queryByLabelText("Contraseña")).not.toBeInTheDocument()` | `usuario-form.test.tsx:125` y `:208` | intactas |
| `expect(getByLabelText("Contraseña")).toHaveFocus()` *(prueba de que el `ref` sigue llegando al input)* | `LoginForm.test.tsx:366` | intacta |

Que las de `usuario-form` sigan verdes no es casualidad: el nombre accesible del botón es
`«Contraseña: oculta. Mostrar.»`, que **no** coincide en búsqueda exacta con `"Contraseña"`,
así que `getByLabelText("Contraseña")` sigue devolviendo **el `<input>`**. Hay un caso
nuevo que lo afirma explícitamente, para que si alguien acorta el nombre accesible se
entere por un test suyo y no por dos tests ajenos.

---

## 7. Lo que NO se verificó, dicho antes y no después

**T17 (mirar la app) no se hizo.** Por tanto quedan **sin verificar**:

- **(a)** que el icono no tape el texto tecleado ni se salga del campo, en los dos temas;
- **(b)** que en Edge no aparezcan **dos** ojitos. `[&::-ms-reveal]:hidden` está puesto,
  pero jsdom no tiene ese pseudo-elemento: **ningún test lo prueba**. Es una afirmación
  del CSS, no una medición;
- **(c)** que el anillo de foco se vea al llegar con `Tab`.

No se afirma lo que no se ha visto. Las tres son comprobación visual de una tanda de
navegador; si se quieren, se piden y se hacen.

Otros límites, ya declarados en el spec y que esta implementación **no** cierra:

- **Gramática:** «Contraseña oculta» concuerda porque las tres etiquetas del censo son
  femeninas. Una etiqueta futura masculina («Código secreto») daría «Código secreto
  oculta».
- **Gestores de contraseñas** (1Password, el de Chrome) inyectan su icono a la derecha del
  campo y pueden solaparse. No es verificable en jsdom ni controlable desde el componente.
- **`autoComplete` sigue sin declararse** en los 6 campos, igual que antes de esta ficha
  (Q4 del spec lo deja fuera a propósito).

---

## 8. Gate — el delta, que es lo único que significa algo

Los dos gates son `./init.sh --rapido`, con `INIT_EXIT` escrito **dentro** del log (un
`echo` posterior tapa el código de salida; ya pasó en este repo). El modo rápido **no se
negó**: `✓ el cambio no toca esquema, tipos compartidos, config ni dinero`.

| | Antes de empezar | Después | Delta |
| --- | --- | --- | --- |
| typecheck | ✓ | ✓ | = |
| lint | ✓ | ✓ | = |
| `test:cambiados` (grafo de imports) | *sin cambios que clasificar* | **15 archivos, 144 tests, 0 fallos** | +144 verdes |
| guardias — archivos | 1 failed \| 148 passed (149) | 1 failed \| **149** passed (**150**) | +1 archivo (el nuevo), mismo fallo |
| guardias — tests | **1 failed** \| 2245 passed (2246) | **1 failed** \| 2249 passed (2250) | **+4 verdes, 0 fallos nuevos** |
| `INIT_EXIT` | 1 | 1 | = |

### FALLOS NUEVOS: **0**

El gate termina en `INIT_EXIT=1` **antes y después**, y por **el mismo y único fallo**,
carácter por carácter:

```
❯ tests/unit/guards/superficie-de-uso.guardia.test.ts (18 tests | 1 failed)
    × ninguna Server Action de `lib/actions/**` es inalcanzable sin su anotación
      `@sin-superficie`
AssertionError: … expected [ Array(1) ] to deeply equal []
+ [ "lib/actions/tarifas.ts:67 obtenerTarifa" ]
```

Es **ajeno y preexistente** (ficha 275, otra sesión). **No se tocó**, ni él ni
`lib/actions/tarifas.ts`. El delta es lo que significa algo aquí, y el delta es cero: los
144 tests que el grafo relaciona con este cambio pasan enteros, y las guardias suman
exactamente los 4 casos de la guardia nueva sin restar ninguno.
