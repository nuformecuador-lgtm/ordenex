# Feature 286 — Todos los inputs de contraseña llevan el ojito

Requisitos en notación EARS. Cada `R<n>` es verificable con un test concreto.
Feature `frontend`, complejidad **baja**, `depends_on: null`.
Rama propuesta: `feature/286-ojito-inputs-contrasena`.

> **El pedido humano (2026-08-26), literal:** «que todos los inputs de contrasena tengan
> el ojito para ver la contrasena».

---

## El censo, verificado en este árbol el 2026-08-26

Se corrió el censo pedido (ripgrep sobre `*.tsx`, **todo el repo**, no sólo `app/` y
`components/`). Salen **6 ocurrencias en 4 archivos**, exactamente las de la ficha:

| # | Archivo | Línea | Campo (etiqueta visible) | `id` del `FormField` | Cómo recibe la accesibilidad |
| --- | --- | --- | --- | --- | --- |
| 1 | `app/(app)/configuracion/_components/UsuarioForm.tsx` | 511 | «Contraseña» (alta, modo «Escribir») | `password` | hijo-elemento (`cloneElement`) |
| 2 | `app/login/_components/LoginForm.tsx` | 254 | «Contraseña» | `password` | render-prop (`{...control}`) + `ref` |
| 3 | `app/postulacion/_components/PostulacionForm.tsx` | 500 | «Contraseña» | `password` | hijo-elemento |
| 4 | `app/postulacion/_components/PostulacionForm.tsx` | 514 | «Confirmar contraseña» | `confirmacion_password` | hijo-elemento |
| 5 | `app/recuperar-contrasena/_components/RecuperarContrasenaForm.tsx` | 352 | «Nueva contraseña» | `reset-password` | render-prop + `ref` |
| 6 | `app/recuperar-contrasena/_components/RecuperarContrasenaForm.tsx` | 367 | «Confirmar contraseña» | `reset-confirm-password` | hijo-elemento |

`components/` no tiene ninguno: **cero** ocurrencias. **El censo NO dio más de 6.**

**Dos detalles del censo que cambian el diseño y que no estaban en la ficha:**

1. **Los 6 no se montan igual.** Cuatro son hijos-elemento de `FormField` (que les inyecta
   `id`, `aria-invalid`, `aria-describedby` y `aria-required` por `cloneElement`,
   `components/shared/FormField.tsx:83-87`) y dos usan la render-prop y además reciben un
   `ref` que los formularios usan para mover el foco al primer campo con error
   (`LoginForm.tsx:68,88`, `RecuperarContrasenaForm.tsx:351`). El sustituto tiene que
   servir en los dos modos **y** dejar pasar el `ref` (R13).
2. **Hay un séptimo input relacionado que NO entra**: `UsuarioForm.tsx:321`, la
   «Contraseña generada» que se muestra tras crear un usuario. Ya es `type="text"`
   de propósito —es un secreto que se enseña una sola vez para copiarlo— y no tiene nada
   que revelar. Queda **fuera de alcance**, dicho aquí para que nadie lo «complete» luego.

---

## Grupo A — Alcance: los 6, en un solo sitio

**R1 — Los seis campos llevan el control.** El sistema DEBE ofrecer, en **cada uno** de
los seis campos de contraseña del censo, un control que permita ver y volver a ocultar lo
tecleado. Un campo del censo sin control es un incumplimiento, y la verificación DEBE ser
por campo, no «hay al menos uno en la app».

**R2 — Una sola maqueta: ningún formulario arma su propio ojito.** El sistema DEBE
concentrar el control en **un único componente compartido**. NINGÚN archivo bajo `app/`
ni bajo `components/`, salvo ese componente, DEBE declarar `type="password"` ni un botón
de mostrar/ocultar propio. SI aparece un séptimo campo de contraseña en el futuro,
ENTONCES la verificación DEBE ponerse roja hasta que use el componente compartido.

**R3 — Frontera del cambio.** El sistema NO DEBE tocar esquema, migraciones, RLS,
servicios, repositorios, Server Actions, rutas, contratos de entrada/salida ni validación
de contraseñas. El diff DEBE limitarse a: el componente compartido nuevo, los cuatro
formularios del censo, sus tests, la guardia nueva y `specs/`/`progress/`.
En particular NO DEBE tocar `UsuariosModule.tsx`, `lib/actions/usuarios.ts` ni
`lib/services/UsuarioService.ts` (colisionarían con la feature 285, en curso en paralelo).
SI el diseño obligara a tocar alguno, ENTONCES la implementación se detiene y vuelve a la
puerta humana.

**R4 — Nada más cambia en esos formularios.** El sistema NO DEBE modificar etiquetas
visibles, textos de error, placeholders, orden de campos, validación, ni el
comportamiento de envío de los cuatro formularios. El único cambio observable es la
aparición del control y el orden de tabulación que R11 fija.

---

## Grupo B — Comportamiento del control

**R5 — Arranca oculta, siempre.** MIENTRAS nadie haya activado el control en ese campo,
el sistema DEBE presentar el campo como contraseña enmascarada (`type="password"`).
Esto vale en el primer render **y tras volver a montar el formulario**: el estado de
visibilidad NO DEBE persistirse en `localStorage`, `sessionStorage`, cookie ni ningún
almacén; un formulario que se cierra y se reabre vuelve a estar oculto.

**R6 — Activarlo revela.** CUANDO la persona activa el control estando el campo oculto,
el sistema DEBE presentar el contenido en claro (`type="text"`) **conservando el valor ya
tecleado**.

**R7 — Volver a activarlo oculta.** CUANDO la persona activa el control estando el campo
visible, el sistema DEBE volver a enmascararlo (`type="password"`), conservando el valor.

**R8 — El control no roba el foco.** CUANDO se activa el control, el sistema NO DEBE
mover el foco a otro elemento: el foco queda donde la interacción lo dejó (en el propio
botón si se pulsó con teclado o ratón). NO DEBE reconstruirse el campo de forma que se
pierda el valor o el foco del input.

**R9 — Cada campo tiene su propio ojito, con su propio estado.** DONDE un formulario
tenga dos campos de contraseña (postulación: «Contraseña» + «Confirmar contraseña»;
recuperación: «Nueva contraseña» + «Confirmar contraseña»), revelar uno NO DEBE revelar
el otro: el otro DEBE seguir enmascarado hasta que se active su propio control.

**R10 — El ojito NO envía el formulario.** CUANDO se activa el control —con ratón, con
`Enter` o con `Espacio`— el sistema NO DEBE enviar el formulario que lo contiene: ninguna
Server Action DEBE invocarse y ninguna validación DEBE dispararse por ese gesto.

> Éste es el requisito que más barato es romper y más caro es no ver: un `<button>` sin
> `type="button"` dentro de un `<form>` envía. Se verifica con el doble de la acción y
> `not.toHaveBeenCalled()`.

**R11 — Alcanzable con teclado, en su sitio del recorrido.** El control DEBE ser un
`<button>` nativo, enfocable con `Tab` sin `tabindex` positivo ni negativo, operable con
`Enter` **y** con `Espacio`, y DEBE recibir el foco **inmediatamente después de su propio
campo**. Para el formulario de login, el recorrido pasa a ser
`correo → contraseña → mostrar/ocultar → «Iniciar sesión»`.

> Esto **amplía** el R23 de la feature 86 (`tests/components/LoginForm.test.tsx:380`), que
> hoy afirma `correo → contraseña → «Iniciar sesión»`. Ese test se amplía con el paso
> nuevo; **no se borra ni se relaja** (R17). Ver «Preguntas abiertas · Q3».

**R12 — Se deshabilita con su campo.** MIENTRAS el campo de contraseña esté deshabilitado
(los cuatro formularios deshabilitan sus inputs durante el envío), el sistema DEBE
presentar el control también deshabilitado, y activarlo NO DEBE cambiar la visibilidad.

---

## Grupo C — Accesibilidad: es un control, no un adorno

**R13 — El campo sigue siendo el mismo campo para todo lo demás.** El sistema DEBE hacer
llegar al elemento `<input>` —y no a ningún envoltorio— el `id`, `aria-invalid`,
`aria-describedby`, `aria-required`, el `ref`, el `value`, el `onChange`, el `disabled` y
el `placeholder` que hoy recibe. En concreto, DEBE seguir cumpliéndose que:
(a) buscar el campo por su etiqueta visible exacta («Contraseña», «Confirmar contraseña»,
«Nueva contraseña») devuelve **el `<input>`**; (b) ese input conserva su `id`;
(c) con error, el input queda con `aria-invalid` y `aria-describedby` apuntando a su
`FieldError`; (d) el `ref` de `LoginForm`/`RecuperarContrasenaForm` sigue enfocando el
input al fallar la validación.

**R14 — Nombre accesible que dice el estado Y la acción, distinto por campo.** El control
DEBE tener un nombre accesible que (a) nombre el campo al que pertenece, (b) diga el
estado actual y (c) diga a qué estado lleva. Los dos textos, literales:

- oculta → `«<Etiqueta del campo>: oculta. Mostrar.»`
- visible → `«<Etiqueta del campo>: visible. Ocultar.»`

Ejemplos exactos que DEBEN existir en el árbol: `Contraseña: oculta. Mostrar.`,
`Confirmar contraseña: oculta. Mostrar.`, `Nueva contraseña: visible. Ocultar.`
El nombre DEBE cambiar al cambiar el estado (dos nombres distintos, no uno). El icono
DEBE ser `aria-hidden`: no aporta nombre.

> Que el nombre sea **distinto por campo** no es cosmético: en postulación y en
> recuperación hay dos ojitos en la misma pantalla, y dos botones con el mismo nombre
> obligan a adivinar cuál es cuál. Sigue el precedente de `TemaToggle`
> (`components/shared/TemaToggle.tsx:35-36`): «Tema: Claro. Cambiar a Oscuro.»

**R15 — El estado aplicado se ANUNCIA por una región viva.** El sistema DEBE incluir,
junto a cada control, una región viva sólo para lectores de pantalla (`sr-only`) con
`aria-live="polite"` y `aria-atomic="true"`, cuyo texto cambia al cambiar el estado:
`«<Etiqueta del campo> visible»` / `«<Etiqueta del campo> oculta»`. La región DEBE estar
**vacía en el primer render** (nada que anunciar antes de que la persona actúe).

**R15.1 — Esa región NO DEBE llevar `role`.** *(Va numerado como sub-requisito de R15
porque habla del mismo elemento, pero es requisito de pleno derecho: tiene su propio test
y su propia mutación, y se cuenta como uno más en la trazabilidad.)* El sistema NO DEBE ponerle `role="status"`
ni `role="alert"`. Tras montar cualquiera de los cuatro formularios, el número de
elementos con `role="status"` aportados por este control DEBE ser **cero**, y el número
de `role="alert"` DEBE ser el mismo que hoy.

> Medido y escrito ya en este repo: un `role="status"` permanente volvió ambiguo el
> `getByRole("status")` de otras suites (`TemaToggle.tsx:42-46`), y `role="alert"`
> rompería los `findByRole("alert")` en singular de `LoginForm.test.tsx:421` y del
> `FieldError` de todos estos formularios. `aria-live` es el mecanismo real; el `role`
> sólo lo implica.

**R16 — El icono cumple contraste de componente (WCAG 1.4.11).** El sistema DEBE pintar
el icono del control con un par de tokens cuyo contraste contra la superficie del campo
sea **≥ 3:1 en los dos temas** (claro y oscuro) y sobre las dos superficies donde vive
hoy (`--background` y `--card`). SI el token elegido no llega a 3:1 medido, ENTONCES DEBE
cambiarse por uno que sí, no ajustarse el umbral.

---

## Grupo D — Que no rompa lo que ya funciona

**R17 — Las suites existentes siguen verdes, y ninguna aserción se debilita.** Las cuatro
suites que hoy tocan estos campos —`tests/components/LoginForm.test.tsx`,
`tests/components/PostulacionForm.test.tsx`,
`tests/integration/recuperar-contrasena-form.test.tsx` y
`tests/unit/components/usuario-form.test.tsx`— DEBEN quedar verdes. Se permite
**añadir** casos y **ampliar** el caso de orden de tabulación de `LoginForm.test.tsx:380`
con el paso nuevo. NO DEBE borrarse ni relajarse ninguna aserción existente; en concreto
DEBEN seguir vivas y verdes, sin cambios: `expect(passwordInput).toHaveAttribute("type",
"password")` (`LoginForm.test.tsx:49`), las dos equivalentes de
`PostulacionForm.test.tsx:166-170`, y
`expect(screen.queryByLabelText("Contraseña")).not.toBeInTheDocument()`
(`usuario-form.test.tsx:125,208`).

**R18 — Cada requisito muere con una mutación anotada.** NINGUNA verificación de esta
feature DEBE darse por buena sin haberse visto **en rojo** ante una mutación concreta,
registrada con su salida. Como mínimo, DEBEN ejecutarse y verse rojas estas seis:

| MUT | Mutación | Qué test tiene que morir |
| --- | --- | --- |
| MUT-1 | El botón existe pero su `onClick` no cambia el estado (deja el `type` fijo en `password`) | R6, R7 |
| MUT-2 | Se quita `type="button"` del botón | R10 |
| MUT-3 | El estado de visibilidad se sube a uno solo por formulario (los dos campos comparten) | R9 |
| MUT-4 | El nombre accesible se vuelve fijo («Mostrar contraseña», sin estado ni etiqueta) | R14 |
| MUT-5 | Se le pone `role="status"` a la región viva | R15.1 |
| MUT-6 | El `id`/`aria-describedby` se aplican al envoltorio en vez de al `<input>` | R13 |

> La razón de que MUT-1 sea obligatoria está en el encargo: «un test que compruebe que el
> botón existe pero no que cambia el `type` del input no prueba nada».

---

## Trazabilidad R → test

El mapa propuesto está en `tasks.md § Mapa R → verificación`. Se cierra con rutas y
nombres reales en `progress/impl_286.md`. Ningún requisito puede quedar sin dueño.

---

## Preguntas abiertas

**Q1 — ¿Se aprueba el nombre accesible largo?** Este spec fija
«Contraseña: oculta. Mostrar.» en vez del habitual «Mostrar contraseña». Es más verboso,
pero (a) desambigua los dos ojitos de postulación y recuperación, (b) mete el estado en el
nombre —que es lo que el humano pidió— y (c) calca el precedente vivo del repo
(`TemaToggle`). **Si se prefiere el corto**, hay que resolver antes cómo se distinguen dos
botones con el mismo nombre en la misma pantalla. No bloquea: cambiar los literales es una
línea, pero cambia los tests, así que mejor decidirlo en la puerta.

**Q2 — ¿El texto del anuncio es el correcto en castellano?** «Contraseña visible» /
«Contraseña oculta». Nota de gramática: funciona porque las tres etiquetas del censo son
femeninas (todas terminan en «contraseña»); una etiqueta futura masculina («Código
secreto») pediría otra construcción. Está anotado como límite conocido en `design.md §6`.

**Q3 — ¿Se acepta que el orden de tabulación del login cambie?** Insertar un control
alcanzable con teclado entre la contraseña y «Iniciar sesión» **cambia el recorrido**, y
eso es exactamente lo que afirma hoy el test R23 de la feature 86
(`LoginForm.test.tsx:380`). No hay forma de tener las dos cosas: o el ojito es alcanzable
con `Tab` (lo que el humano pidió, y WCAG 2.1.1) o el recorrido se conserva intacto. Este
spec elige lo primero y **amplía** ese test. La alternativa descartada (`tabIndex={-1}`)
está razonada en `design.md §5.C`.

**Q4 — ¿`autoComplete` entra o no?** Ninguno de los 6 campos declara hoy
`autoComplete` (`current-password` / `new-password`). Añadirlo ayudaría a los gestores de
contraseñas y es un cambio de una palabra por campo, pero **no es lo que se pidió** y toca
comportamiento de autocompletado que nadie ha medido aquí. Este spec lo deja **fuera**.
Si se quiere, es otra ficha.

**Q5 — ¿Hay que auto-ocultar la contraseña (al enviar, o tras N segundos)?** Este spec
dice **no**: la contraseña se oculta cuando la persona lo pide, cuando se desmonta el
formulario o cuando se recarga (R5). Un temporizador es comportamiento que nadie pidió y
sorprende a quien está tecleando. Descartado por escrito en `design.md §5.D`; si se
quiere, se decide en la puerta.

**Q6 — ¿Se espera comprobación en navegador?** Hay dos cosas que jsdom **no** puede
verificar y que este spec no puede cerrar solo: (a) que el icono no tape el texto tecleado
ni se salga del campo, y (b) que en Edge no aparezcan **dos** ojitos (el nativo
`::-ms-reveal` más el nuestro). El diseño propone neutralizar el nativo desde el propio
componente (`design.md §4.4`), pero **la comprobación es visual**. Si el humano quiere esa
comprobación como parte del cierre, se dice y se hace (`tasks.md` T17); si no, queda
declarado como límite conocido.
