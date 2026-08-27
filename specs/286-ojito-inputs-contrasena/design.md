# Feature 286 — Diseño técnico

> Requisitos en `requirements.md`. Aquí van las decisiones, con lo que se descartó y por qué.

---

## 1. Resumen de la decisión

Un componente compartido nuevo, **`components/shared/PasswordInput.tsx`**, que envuelve la
primitiva `Input` con un botón de mostrar/ocultar. Los **6** usos del censo pasan de
`<Input type="password" … />` a `<PasswordInput etiqueta="…" … />`. El estado de
visibilidad vive **dentro** del componente, uno por campo. Ni backend, ni datos, ni
contratos: es maqueta y accesibilidad.

**Nada de modelo de datos.** Esta feature no crea tablas, ni columnas, ni migraciones, ni
políticas RLS, ni endpoints, ni Server Actions, ni contratos de entrada/salida. La sección
que `docs/specs.md` pide para eso queda **explícitamente vacía**: si el implementer se
encuentra escribiendo SQL o un `'use server'`, se ha salido de la ficha (R3).

---

## 2. Dónde vive el componente, con el criterio de la casa

**Va en `components/shared/`, no en `components/ui/`.** No es un criterio nuevo; es el que
ya está escrito y el que sigue el árbol:

| Señal | Qué dice |
| --- | --- |
| `docs/architecture.md:136-138` | `ui/` = primitivas de shadcn/ui, se añaden con `npx shadcn add`. `shared/` = **compuestos construidos con primitivas `ui/`**, reutilizables entre features. Esto es literalmente `Input` + `Button`. |
| `docs/architecture.md:142-145` | Se promueve a `shared/` cuando **al menos DOS** features lo necesitan con la misma API. Aquí son **cuatro** formularios de tres features distintas (20, 21, 25) más el login. |
| El árbol | Los archivos de `ui/` son **kebab-case generados** (`input.tsx`, `button.tsx`, `select.tsx`); los de `shared/` son **PascalCase escritos a mano** (`FormField.tsx`, `DataTable.tsx`, `TemaToggle.tsx`). Un archivo hecho a mano en `ui/` se confunde con código generado y el próximo `npx shadcn add input` lo pone en riesgo. |
| `docs/conventions.md:9` | Componentes React en `PascalCase.tsx` → `PasswordInput.tsx` encaja en `shared/`, no entre los kebab de `ui/`. |
| Precedente exacto | `FormField.tsx` y `FieldError.tsx`: piezas **genéricas de formulario**, compuestas sobre `ui/`, viviendo en `shared/` con nombre en inglés. `PasswordInput` es su hermano. |

**Antes de escribir una línea hay que comprobar que shadcn/ui no lo trae ya**
(`docs/architecture.md:9-10`, `:136`). A fecha de este spec **no consta** ningún
componente de contraseña en el registro que usa este repo (`components.json`,
`style: "base-nova"`), pero eso **no se ha medido**: es la tarea T1 de `tasks.md`. Si
existiera, se añade con `npx shadcn add` a `ui/` y `PasswordInput` se construye encima —el
resto del diseño no cambia—. **Aviso operativo:** en este repo ya ocurrió que un
subcomando aparentemente de sólo lectura ejecutara una instalación; T1 obliga a mirar qué
hace el comando antes de correrlo y a revertir cualquier escritura inesperada.

**Nombre:** `PasswordInput` (inglés), como `FormField`, `FieldError`, `DataTable` y
`Pagination` —las piezas genéricas de la casa—. Los nombres en castellano de `shared/`
(`BuscadorFiltros`, `SelectorDiaReparto`, `HiloNotasOrden`) son los que nombran **dominio**;
éste no nombra dominio. Los textos visibles y para lector de pantalla van en castellano,
como todo lo que ve una persona.

---

## 3. Contrato del componente

```ts
// components/shared/PasswordInput.tsx   ("use client")

export interface PasswordInputProps
  extends Omit<React.ComponentProps<"input">, "type"> {
  /**
   * Etiqueta VISIBLE del campo («Contraseña», «Confirmar contraseña», «Nueva
   * contraseña»). Entra en el nombre accesible del botón y en el anuncio, para que
   * dos ojitos de la misma pantalla no se llamen igual. Obligatoria a propósito:
   * si fuera opcional con valor por defecto, un consumidor nuevo enviaría en
   * silencio dos botones indistinguibles.
   */
  etiqueta: string;
}

export function PasswordInput(props: PasswordInputProps): React.JSX.Element;
```

- **`type` se excluye del tipo**: lo decide el componente. Un consumidor no puede volver a
  fijarlo (y TypeScript lo impide, que es la mitad de la guardia de R2).
- **Todo lo demás pasa tal cual al `<input>`**: `id`, `value`, `onChange`, `disabled`,
  `placeholder`, `ref`, `aria-invalid`, `aria-describedby`, `aria-required`, `className`.
  En React 19 `ref` es una prop normal, así que viaja con el resto del *spread* (los dos
  `ref` vivos del censo dependen de esto: `LoginForm.tsx:253` y
  `RecuperarContrasenaForm.tsx:351`).
- **Compatible con los dos modos de `FormField`**: como hijo-elemento, `cloneElement` le
  inyecta las cuatro props de accesibilidad (`FormField.tsx:83-87`) y el componente las
  reenvía al `<input>`; como render-prop, el consumidor las esparce él. No hace falta
  tocar `FormField` (§5.E).

### Textos (literales, en el componente)

| Estado | Nombre accesible del botón | Región viva |
| --- | --- | --- |
| oculta | `${etiqueta}: oculta. Mostrar.` | `${etiqueta} oculta` |
| visible | `${etiqueta}: visible. Ocultar.` | `${etiqueta} visible` |
| primer render | (el de «oculta») | **cadena vacía** |

Los tests afirman contra **literales escritos a mano** (`"Contraseña: oculta. Mostrar."`),
nunca contra la función que los genera: comparar un texto con su propia fuente sale verde
siempre —lección ya pagada en este repo—.

---

## 4. Marcado concreto

### 4.1 Estructura

```tsx
<div className="relative">
  <Input
    {...resto}
    id={id}
    type={visible ? "text" : "password"}
    className={cn("pr-8 [&::-ms-reveal]:hidden", className)}
  />
  <Button
    type="button"                      /* R10: sin esto, el ojito ENVÍA el formulario */
    variant="ghost"
    size="icon-sm"                     /* 28 px: por encima del mínimo de 24 px (WCAG 2.5.8) */
    disabled={disabled}                /* R12 */
    aria-label={visible ? `${etiqueta}: visible. Ocultar.` : `${etiqueta}: oculta. Mostrar.`}
    aria-controls={id}                 /* sólo si hay id */
    onClick={() => { setVisible(v => !v); setTocado(true); }}
    className="absolute top-1/2 right-0.5 -translate-y-1/2 text-<token de §4.3>"
  >
    {visible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
  </Button>
  <span
    aria-live="polite"
    aria-atomic="true"
    data-contrasena-anuncio=""         /* asidero de test: es sr-only y no tiene rol */
    className="sr-only"
  >
    {tocado ? (visible ? `${etiqueta} visible` : `${etiqueta} oculta`) : ""}
  </span>
</div>
```

- **El botón va DESPUÉS del input en el DOM.** Así el recorrido de `Tab` es
  `campo → su ojito → siguiente` sin `tabindex` (R11). Nada de `tabindex` positivo.
- **`<Button>` de la casa, no un `<button>` a mano**: `DESIGN.md:59` lo prohíbe
  explícitamente, y con él vienen gratis el anillo de foco estándar
  (`focus-visible:ring-3 focus-visible:ring-ring/50`, `DESIGN.md:58`) y el `disabled`.
- **`pr-8`** en el input para que el texto tecleado no pase por debajo del icono.
- **Iconos `Eye` / `EyeOff` de `lucide-react`**, la librería declarada en
  `components.json:13` y ya usada en 20+ componentes. Con `aria-hidden`: el nombre lo pone
  el `aria-label` (R14).
- **Sin animación.** `DESIGN.md:68` pide que el movimiento transmita estado; aquí el cambio
  ya se ve (el texto aparece). Una transición sólo retrasaría la lectura.

### 4.2 Los dos mecanismos de anuncio, y por qué hacen falta los dos

1. **El nombre accesible lleva el estado** → quien llega al botón navegando oye en qué
   estado está y a cuál va, en cualquier momento.
2. **La región viva anuncia el cambio ya aplicado** → cambiar el `aria-label` de un botón
   **que está enfocado** no se re-anuncia de forma fiable en todos los lectores. Es el
   mismo razonamiento, ya medido y escrito, de `TemaToggle.tsx:40-46`.

**Sin `role="status"`, a propósito** (R15.1). Ese mismo comentario de `TemaToggle` deja
constancia de que un `role="status"` permanente **rompió dos suites ajenas** al volver
ambiguo su `getByRole("status")`. Y `role="alert"` sería peor: `LoginForm.test.tsx:421`
hace `findByRole("alert")` **en singular**, y `FieldError` ya emite uno por campo con
error. `aria-live` es el mecanismo; el `role` sólo lo implica.

**Vacía en el primer render**: una región viva con texto desde el montaje puede llegar a
anunciarse sola en algunos lectores, y no hay nada que anunciar antes de que la persona
actúe. `tocado` guarda si ya hubo una pulsación.

### 4.3 Color del icono, medido y no supuesto

El icono es un **indicador no textual**: WCAG 1.4.11 pide **3:1** contra su fondo (R16).
El candidato es `text-muted-foreground`; el fondo del campo es transparente sobre
`--background` (login, postulación, recuperación) o sobre `--card` (modal de usuario).
**No se elige a ojo**: T7 lo calcula con la utilería que ya existe en el repo
(`tests/fixtures/contraste.ts`: `contraste(token("claro","--muted-foreground"),
token("claro","--background"))`, y las cuatro combinaciones) y, si alguna baja de 3, se usa
`text-foreground`. La medición queda como test, no como afirmación en prosa.

### 4.4 El ojito nativo de Edge

Edge (Chromium) pinta su propio botón de revelar sobre los `input[type=password]`
(pseudo-elemento `::-ms-reveal`). Sin hacer nada, esa pantalla mostraría **dos** ojitos
pegados. Se neutraliza desde el propio componente con la variante arbitraria
`[&::-ms-reveal]:hidden` —local, sin tocar `globals.css` ni afectar a nada más—.
**Límite honesto:** jsdom no tiene ese pseudo-elemento, así que **esto no lo prueba
ningún test**; se comprueba mirando la app (T17) o se declara pendiente. No se afirma
como verificado hasta que alguien lo vea.

---

## 5. Alternativas descartadas

### 5.A — Seis toggles copiados en los cuatro formularios *(la que pidió descartar el humano, y por qué tenía razón)*

Cada formulario con su `useState` y su botón. Sale antes, y es exactamente lo que esta casa
no hace: la maqueta viviría en 4 sitios, el nombre accesible divergiría entre ellos, y el
día que se corrija el contraste o el texto del anuncio habría que acordarse de los seis.
El repo ya pagó esta factura con las etiquetas PDF: dos generadores que se declaraban
«espejo EXACTO» llevaban **una feature entera** sin serlo
(`tests/unit/guards/etiquetas-maqueta-unica.guardia.test.ts:22-24`). **Descartada**, y
además queda **prohibida por una guardia** (§7).

### 5.B — Un solo ojito por formulario (estado compartido entre contraseña y confirmación)

En postulación y en recuperación hay dos campos; se podría revelar los dos a la vez.
**Descartada**, por tres razones y una cuarta que es la que manda:

1. El estado tendría que vivir en el **formulario** (un `useState` + dos props por campo),
   así que la lógica del toggle volvería a estar repartida en tres formularios: es 5.A
   disfrazada de otra cosa.
2. Menos exposición: se revela **sólo** el campo que se está comprobando; el otro sigue
   tapado ante quien mire por encima del hombro.
3. Es lo que hace la plataforma: el revelar nativo de Chrome/Edge es **por input**. El
   modelo mental es «el ojito de este campo».
4. **La que manda:** con el estado dentro del componente, los 6 usos son una sustitución
   directa y ningún formulario gana estado nuevo. Y si mañana se quiere lo contrario, se
   añaden props controladas opcionales **sin tocar ninguno de los 6 usos**. Al revés no:
   quitar el estado de los formularios después sí obliga a tocarlos.

### 5.C — Botón con `tabIndex={-1}` para no alterar el recorrido de `Tab`

Conservaría intacto el test de orden de tabulación del login (`LoginForm.test.tsx:380`).
**Descartada:** deja el control fuera del alcance del teclado, que es justo lo que el
encargo prohíbe («el toggle es un control, no un adorno») y lo que WCAG 2.1.1 exige. El
test se **amplía** (R11, R17, Q3); un requisito de accesibilidad no se sacrifica para no
tocar un test.

### 5.D — Auto-ocultar (temporizador, o al enviar)

**Descartada** por ahora: nadie lo pidió, y una contraseña que se vuelve a tapar sola
mientras alguien la está leyendo parece un fallo. El estado ya se pierde al desmontar y al
recargar (R5), que cubre el caso real de «dejé la pantalla abierta». Queda en Q5 por si el
humano lo quiere.

### 5.E — Extender `FormField` para que pase la etiqueta al control

Evitaría la prop `etiqueta` (el `label` ya lo conoce `FormField`). **Descartada:** cambia
el contrato público de un componente que usan **decenas** de formularios y su suite
(`tests/components/FormField.test.tsx`), para ahorrar una prop en 6 sitios. Radio de
explosión enorme, beneficio mínimo, y colisiona con cualquier otra feature que toque
formularios. Una prop explícita es más barata y más legible en el punto de uso.

### 5.F — Meterlo dentro de `components/ui/input.tsx` (que `Input` haga el ojito solo cuando `type="password"`)

Cero cambios en los consumidores. **Descartada:** `ui/` es territorio de shadcn
(`docs/architecture.md:136`) y el archivo es regenerable; además convertiría una primitiva
sin estado en un componente con estado y `"use client"`, arrastrando a **todos** sus
consumidores (`Input` se usa en decenas de sitios, algunos en árboles de servidor). Un
compuesto en `shared/` no arrastra a nadie.

---

## 6. Límites conocidos, dichos antes y no después

- **Gramática:** «Contraseña oculta» concuerda porque las tres etiquetas del censo son
  femeninas. Una etiqueta futura masculina («Código secreto») produciría «Código secreto
  oculta». Si eso pasa, se cambia la construcción del texto; hoy no hay ningún caso (Q2).
- **`::-ms-reveal` no está probado por la suite** (§4.4).
- **Gestores de contraseñas** (1Password, el de Chrome) inyectan su propio icono a la
  derecha del campo y pueden solaparse con el nuestro. No es verificable en jsdom ni
  controlable desde el componente; se mira en T17 y, si molesta, es otra ficha.
- **`autoComplete` sigue sin declararse** en los 6 campos, igual que hoy (Q4). Esta ficha
  no lo cambia: sería alterar el comportamiento de autocompletado sin haberlo medido.

---

## 7. La guardia de maqueta única (R2)

Test nuevo `tests/unit/guards/contrasena-maqueta-unica.guardia.test.ts`, calcado del
patrón vivo de `etiquetas-maqueta-unica.guardia.test.ts` y leyendo con
`tests/fixtures/sin-comentarios.ts` (así un `type="password"` comentado no la engaña ni la
dispara):

1. **Prohibición:** ningún `.tsx` bajo `app/` ni bajo `components/` contiene
   `type="password"`, salvo `components/shared/PasswordInput.tsx`.
2. **Control positivo:** `PasswordInput.tsx` **sí** lo contiene (si no, la prohibición de
   arriba sería vacía y quedaría verde para siempre con la app rota).
3. **Superficie:** los cuatro archivos del censo importan `PasswordInput`, y la cuenta de
   usos por archivo es la del censo (1, 1, 2, 2). Esto es lo que ataja el fallo mudo de
   «sustituyeron cinco y se dejaron uno».

Las guardias corren **siempre** en el gate, también en `--rapido`, porque no dependen del
grafo de imports (`docs/verification.md:81-88`). Es la capa que sigue viva cuando este
spec ya no lo lea nadie.

---

## 8. Impacto por archivo (el diff completo, previsto)

| Archivo | Cambio |
| --- | --- |
| `components/shared/PasswordInput.tsx` | **nuevo** |
| `app/login/_components/LoginForm.tsx` | 1 uso; render-prop + `ref` se mantienen; `import` |
| `app/postulacion/_components/PostulacionForm.tsx` | 2 usos; `etiqueta={TEXTO_LABELS.password}` y `…confirmacion_password` (sin duplicar literales) |
| `app/recuperar-contrasena/_components/RecuperarContrasenaForm.tsx` | 2 usos; el primero conserva su `ref` |
| `app/(app)/configuracion/_components/UsuarioForm.tsx` | 1 uso, sólo el bloque `passwordMode === "manual"` |
| `tests/components/PasswordInput.test.tsx` | **nuevo** (el grueso de R5-R16) |
| `tests/unit/guards/contrasena-maqueta-unica.guardia.test.ts` | **nuevo** (R2) |
| `tests/components/LoginForm.test.tsx` | **amplía** el caso de tabulación; añade 1 caso de integración |
| `tests/components/PostulacionForm.test.tsx` | añade el caso de R9 (dos ojitos independientes) |
| `tests/integration/recuperar-contrasena-form.test.tsx` | añade el caso de R9 |
| `tests/unit/components/usuario-form.test.tsx` | añade el caso de R1 en modo manual |

**Cero** archivos de `lib/`, `db/`, `app/api/`. **Cero** archivos compartidos con la
feature 285 (`UsuariosModule.tsx`, `lib/actions/usuarios.ts`,
`lib/services/UsuarioService.ts`, `lib/types/usuario.ts`, `usuarios-filtros-def.ts`) ni con
la 287. El único archivo de la 285 que está cerca es `UsuarioForm.tsx`, y la 285 **no lo
toca** (su alcance recortado es filtro + buscador del listado).

---

## 9. Verificación

- **Gate:** `./init.sh --rapido` cierra cada tanda y basta para abrir el PR: el diff no
  toca cimientos (ni `db/`, ni `lib/types/`, ni configuración de build, ni nombres de
  dinero), así que el modo rápido no se niega (`docs/verification.md:32-53`).
- **Sin E2E nuevo.** El directorio `e2e/` existe pero está **escrito y NO ejecutado**
  (`e2e/auth.spec.ts:20-22`): no hay arnés que lo corra, así que un `.spec.ts` nuevo allí
  sería una afirmación sin medida. La cobertura real son los tests de componente en jsdom
  más, si el humano lo quiere, una pasada manual por la app (T17, Q6).
- **Mutaciones obligatorias:** las seis de R18. Se corren **secuencialmente y nunca en
  paralelo con el gate** (un árbol mutado bajo un gate en marcha invalida su veredicto), y
  el árbol se restaura después de cada una.
