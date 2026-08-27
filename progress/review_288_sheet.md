# Feature 288 — Segunda revisión: Sheet, reordenación de la UI y recorte del catálogo

> Alcance: `git diff origin/dev...HEAD` sobre `feature/288-picker-variables-plantilla` (PR #518),
> con foco en `c726294d` (fix de M1/M2/M3), `a0f523d7` (docs) y **`65700170`** (el grueso).
> Los cuatro commits anteriores solo se re-revisan donde el trabajo nuevo los toca.
> Los tres archivos sucios del árbol (`lib/actions/ordenes-guia.ts`,
> `lib/actions/recepcion-satelite.ts`, `lib/repositories/OrdenRepository.ts`) se ignoran.
> M4/M5/M6 de la revisión anterior no se recuentan.

## Veredicto: **OK / APROBADO** — 0 bloqueantes para este PR

Con **una condición de cierre** registrada abajo (H1): la feature **no puede pasar a `done`**
hasta que el humano incorpore las derogaciones a `requirements.md`/`design.md`.

---

## 1. Checklist

### Verificación ejecutable (medida por mí, no citada)
- [x] `pnpm exec tsc --noEmit`: **0 errores**.
- [x] `eslint` sobre los archivos nuevos/modificados de producción y test: **0 errores, 0 warnings**.
- [x] `pnpm vitest run tests/unit/plantillas tests/unit/types/plantilla-datos.test.ts
      tests/components/PlantillasFormSheet*.test.tsx`: **299/299, 14 archivos, 5,9 s**.
- [x] `./init.sh` completo lo corrió el coordinador; su medición se contrasta en la sección 4.

### Trazabilidad
- [x] R1–R10, R13–R18, R29, R30 tienen `it` existente **y verificado por mutación**, no por lectura.
- [~] `requirements.md` **no se actualizó**: su tabla de trazabilidad sigue citando asserts que ya
      no existen (R8 con `aria-expanded="false"`, R30 con `getByRole("combobox")`), y el texto de
      R8 sigue exigiendo cerrar la lista. Ver H1.
- [x] `progress/derogaciones_288_sheet.md` documenta requisito por requisito qué cae y qué no.

### Datos y seguridad
- [x] Sin tabla nueva, sin migración, sin webhook, sin secreto. RLS no aplica a este diff.
- [x] Sin hardcode de país/moneda: los ejemplos salen del catálogo.
- [x] El recorte del catálogo **mejora** la privacidad: los 10 campos `sensible` del catálogo
      (`notas`, `mensajero_telefono`, `mensajero_cedula`, `mensajero_email`, `orden_id`...) quedan
      **todos** ocultos; hoy el selector no ofrece ninguno.

### Capas
- [x] `FormSheet` es un compuesto **local** del módulo, no en `components/shared/`, con la razón
      escrita (dos consumidores del mismo módulo). Consistente con `docs/architecture.md`.
- [x] Frontera client-safe intacta: `plantilla-datos.ts` no gana imports; `CampoVariablePicker`
      solo consume el catálogo y `components/ui/*`.
- [x] La guardia de superficie de uso sigue alcanzando `previewPlantilla` desde `VariablesInsert`
      (control positivo verde pese al cambio de contenedor).

---

## 2. Lo que se pidió mirar con lupa

### 1. La derogación del patrón combobox — justificada; el argumento, sobredimensionado
Verificado **contra el texto literal de R30**, no contra el resumen: R30 exige tres cosas
(nombre accesible estable, que la lista se anuncie como tal, y qué opción está activa).
**Ninguna menciona combobox.** El código las cumple las tres: un `span` visible con
`aria-labelledby`, `role="listbox"` con `role="option"`, y `aria-activedescendant` con
`aria-selected`. El `role="combobox"` lo prescribía `design.md` 5.1, que es diseño.
**R30 vigente y cumplido entero: correcto.**

`aria-activedescendant`, `aria-controls` y `aria-autocomplete` son atributos **válidos sobre
`role="textbox"`** en ARIA 1.2, así que el widget no es ARIA inválida. Ahora bien, el argumento
del documento (mantener `aria-expanded` sería ARIA que **miente**) no se sostiene del todo: un
combobox cuyo popup está siempre desplegado declara `aria-expanded="true"` de forma
**verdadera**, no mentirosa. La elección real no es honesta contra mentirosa, sino listbox
filtrado persistente contra combobox siempre expandido, y ambas son legítimas. El resultado no
cambia y el requisito se cumple; lo que sobra es la fuerza del argumento (m1).

Teclado, verificado: ArrowDown, ArrowUp y Enter funcionan y su test es genuino; Escape **no** se
consume (`defaultPrevented === false`) y el Sheet lo recibe, con el matiz de que `handleCancel`
lo bloquea mientras `pending`, que es lo correcto. R29 se sirve entero. Queda un hueco de teclado
**preexistente** (ya estaba en `4417f902`, no lo introduce este diff): la opción activa **no**
hace `scrollIntoView`, y con `max-h-64` sobre 12 opciones de unos 68 px solo entran 3 o 4, así
que bajando con el teclado la activa se sale de la vista y hay que arrastrar el scroll con el
puntero para verla (m2).

### 2. La asimetría ocultar-vs-borrar — correcta, y la guardia es real
Comprobado en el camino de producción, no solo en la preview:
- `CAMPOS_PLANTILLA` se construye por `map` sobre `CATALOGO_DECLARADO`, así que las 25 claves
  **siguen** en el array y en `CAMPOS_PLANTILLA_POR_CLAVE`, que es de donde resuelven
  `valorDeCampo`, `resolverValoresPlantilla` (envío real) y `nombresDeVariables`.
- `clavesSinCampo` filtra por las claves ausentes de `CAMPOS_PLANTILLA_POR_CLAVE`, así que **no**
  las marca, ni siquiera con nombre persistido (el test cubre las dos variantes).
- Ningún alias apunta a un campo borrado (assert propio, y los 5 alias cuelgan de bases visibles).
- Medido en runtime: **42 entradas (37 propias y 5 alias), 12 ofrecidas, 0 sensibles ofrecidos**.
  Coincide exactamente con el cuadro 9.4 del documento de derogaciones.

**Mutación ejecutada** para no creerme el archivo: borré la entrada `provincia` de
`CATALOGO_DECLARADO` y `campos-ocultos-siguen-resolviendo.test.ts` cayó con **7 fallos** (el
documento decía 6; el archivo protege más de lo que promete, no menos). El árbol quedó
restaurado. **La guardia no es decorativa.**

Caminos por los que los 3 borrados podrían aún romper algo, para que quede por escrito (m3, no
bloqueante): la comprobación fue contra las **7 plantillas vivas**. Una plantilla con `deletedAt`
que se restaure, o una fila de otro entorno, con la clave `telefono` en el cuerpo pasaría a
enviar un **parámetro vacío** a Meta. Lo bueno es que **la numeración no se desplaza**:
`construirComponentsEnvio` mapea `variables` posición a posición y emite cadena vacía para la
clave ausente, así que no hay corrimiento de parámetros, solo un hueco. Es exactamente la
pregunta abierta 1 del spec, declarada fuera de alcance por el humano.

### 3. FormSheet frente a Modal — paridad correcta
Contrastado línea a línea con `components/shared/Modal.tsx`:
- Anti-doble-submit por `pendingRef` síncrono: mismo patrón, y el test lo prueba con promesa
  diferida real.
- **El cierre lo decide siempre el padre**: no hay ninguna rama que llame a `onOpenChange(false)`
  tras `onConfirm`. Verificado también en `PlantillasModule`: `onConfirmCrear` y `onConfirmEditar`
  cierran solo con status ok (y con not_found al editar). **No hay camino por el que el panel se
  cierre solo tras un fallo.**
- **No se queda bloqueado en pending tras un rechazo**: el `catch` resetea `pendingRef` y llama a
  `setPending(false)` antes de descartar. `mountedRef` no lo impide: a `FormSheet` lo renderiza
  siempre `PlantillasModule`, no se desmonta al cerrar.
- El cierre por Escape, por overlay o por la X va a `handleCancel`, bloqueado mientras `pending`.
  Igual que el R19 de `Modal`.

El comentario del `catch` **describe lo que el código hace** (descarta y suelta `pending`), pero
su **justificación** es inexacta: dice que `onConfirmCrear` y `onConfirmEditar` ya resuelven sus
propios errores con toasts, y eso solo vale para los **status de error devueltos**; una
**excepción** (fallo de red de la Server Action, o `mutate()` reventando) se traga sin toast ni
rastro. Lo importante: **no es una regresión**, porque `Modal` recibía `onError` opcional y estos
dos consumidores nunca se lo pasaron, así que también se lo tragaba (m4).

Divergencia menor con `Modal`: `FormSheet` usa una comprobación `instanceof Promise` donde
`Modal` usa un `isThenable`. Con `async function` no cambia nada; con un thenable no nativo,
`FormSheet` no entraría en fase `pending` (m5).

### 4. El ancho — el test no es tautológico, pero prueba la mitad menos interesante
El mock de `SheetContent` no vuelve el test vacío: falla si desaparece el `maxWidth` en none, y
los casos con porcentaje 45 y mínimo 420 demuestran que las props llegan al `style` y no son
constantes. Lo que **no** cubre es justo el hecho que el comentario del componente marca como no
obvio: que el `style` inline **le gana** a la clase `data-[side=right]:sm:max-w-sm`. Confirmé
leyendo `components/ui/sheet.tsx` que ese hecho es real y que **el `className` con `w-full` y
`sm:max-w-none` que FormSheet añade es inerte**: `tailwind-merge` no dedupe entre `sm:max-w-none`
y la variante con selector de atributo, y esta última gana por especificidad. O sea: **todo el
contrato de ancho descansa en el `style` inline**, las clases no ayudan, y nada en la suite
detectaría que alguien intente sustituir el inline por clases (m6).

### 5. Tests que se cumplen solos — los tres candidatos aguantan la mutación
No me fié de la lectura; rompí la conducta y comprobé el rojo, restaurando el árbol después:
- **la lista se ve sin interacción**: real. Afirma `getByRole("listbox")` y `getAllByRole` de
  option con longitud igual a `CAMPOS_PLANTILLA_OFRECIDOS` sobre un render limpio.
- **tiene scroll propio**: quité `max-h-64 overflow-y-auto` del `ul` y dio 1 failed y 15 passed.
  Falla de verdad. Es un assert sobre el `className` renderizado (no sobre el fuente), que es el
  techo de lo que jsdom permite; su límite es que `max-h-0` también lo satisfaría (m7).
- **la vista previa va antes del selector**: intercambié los dos bloques en el JSX y dio 1 failed
  y 15 passed. `compareDocumentPosition` es un assert honesto.

Añado que M2 de la ronda anterior, que era exactamente este vicio, quedó **bien** arreglado:
`EditarPlantillaForm.test.tsx` ahora ejerce el `submit()` real y comprueba que
`actualizarPlantilla` recibe el cuerpo con la clave `sucursal` intacta, con el aviso en pantalla.
M3 también: el assert de que no quedan llaves pasó a comparar exactamente contra el ejemplo del
catálogo.

### 6. R9 con notas oculto — solución honesta, con una decisión pendiente del humano
El test inyecta las **entradas reales** del catálogo (`notas` y `cliente`, que siguen ahí) por la
prop `campos`, y protege el fixture con un `throw` de precondición si el catálogo cambiara los
flags. Eso es mejor que fabricar un campo de mentira o borrar el test: el camino de código sigue
cubierto y el día que se ofrezca un sensible, el distintivo está garantizado.
Lo que hay que decir sin adornos: **hoy R9 es inalcanzable en la UI real** (0 de 12 ofrecidos son
sensibles), así que su verde ya no dice nada sobre lo que el maestro ve. Es un verde con valor
**de regresión**, no **de producto**. Si R9 se retira o se repone un sensible al selector lo
decide el humano (m8).

---

## 3. Hallazgos

### BLOQUEANTE (de cierre, no de este PR)

**H1 — el spec de referencia contradice al código, y ninguna task va a arreglarlo.**
`requirements.md` sigue diciendo, con la firma de la aprobación humana:
- **R8**: debe vaciar el filtro **y cerrar la lista**. La segunda mitad está deliberadamente no
  implementada.
- Fila de trazabilidad de **R8**: el input queda vacío **y `aria-expanded="false"`**. Ese assert
  ya no existe.
- Fila de trazabilidad de **R30**: `getByRole("combobox")` lo encuentra. Ya no existe; el test
  usa `textbox`.
- `design.md` 5.1 y 5.2 siguen prescribiendo combobox, panel flotante y panel debajo del selector.

`tasks.md` T17 y T18 quedaron marcadas `[x]` conservando ese texto (consumir
`CAMPOS_PLANTILLA` filtrado solo por alias, y `getByRole("combobox")`), y **T25 apunta a
`progress/impl_285.md`, no a `requirements.md`**: no hay ninguna task que cierre esta deriva.

**Por qué NO rechazo el PR por esto:** el implementer hizo lo correcto al **no** reescribir por su
cuenta un spec aprobado por el humano (`docs/specs.md`, puerta de aprobación), y dejó la
propuesta exacta escrita en `derogaciones_288_sheet.md` sección 7. Rechazar aquí sería castigar el
respeto a la puerta de aprobación. **Pero la feature no puede pasar a `done`** con el contrato
diciendo una cosa y el código otra: el leader debe llevarle al humano la reescritura de R8
(vaciar el filtro y devolver la lista al catálogo completo), la nota en R29 (el cerrar lo sirve el
contenedor), las dos filas de la tabla de trazabilidad, y las derogaciones de `design.md` 5.1/5.2.

### menores nuevos

- **m1** — el argumento de que `aria-expanded` mentiría está sobredimensionado: un combobox
  siempre desplegado lo declara en true de forma veraz. La derogación es correcta por otra razón
  (era prescripción de `design.md`, no de R30); conviene no dejar el argumento débil por escrito
  en el bloque ARIA de `CampoVariablePicker.tsx`.
- **m2** — la opción activa no hace `scrollIntoView`: con `max-h-64` y 12 opciones, bajar con el
  teclado saca la activa de la vista. **Preexistente** (ya estaba en `4417f902`), pero es el hueco
  de teclado que queda por cerrar de R29.
- **m3** — los 3 campos borrados se apoyan en que ninguna de las 7 plantillas vivas los usa. Una
  plantilla con `deletedAt` restaurada, u otro entorno, enviaría un parámetro vacío a Meta. Sin
  corrimiento de posiciones (verificado en `construirComponentsEnvio`), solo hueco.
- **m4** — el comentario del `catch` de `FormSheet` justifica el descarte con toasts que solo
  cubren los status devueltos, no las excepciones. Una excepción real queda muda. No es regresión
  respecto de `Modal`, pero el comentario promete más de lo que hay.
- **m5** — `instanceof Promise` donde `Modal` usa `isThenable`.
- **m6** — el `className` de ancho en `SheetContent` es inerte (pierde por especificidad contra la
  variante con selector de atributo); todo el ancho lo sostiene el `style` inline, y ningún test
  cubriría que alguien lo sustituya por clases.
- **m7** — el assert de scroll es sobre `className`; `max-h-0` lo satisfaría igual.
- **m8** — R9 queda vacuo en la UI (0 sensibles ofrecidos). Decisión del humano: retirar R9 o
  reponer un sensible al selector.
- **m9** — el TSDoc de `CAMPOS_PLANTILLA` dice que sigue teniendo las **44** entradas; son **42**
  (medido, y así lo afirma `plantilla-datos.test.ts`). Es justo el tipo de conteo que este archivo
  ya arrastraba mal desde la 282.

### Derogaciones que NO me parecen injustificadas
Ninguna. Las seis del cuadro resumen (R8 a medias, R29 con el cerrar reubicado, R30 intacto, R6
intacto, `design.md` 5.1 y 5.2) se sostienen al contrastarlas con el texto de los requisitos. La
única objeción es de **argumentación**, no de fondo (m1), y el cuadro de la sección 9.4 es exacto
(comprobado en runtime).

---

## 4. Los 3 rojos ajenos — confirmados ajenos, medidos por mí
- `tests/unit/guards/superficie-de-uso.guardia.test.ts`: **17 passed y 1 failed**, y el único
  huérfano es `lib/actions/tarifas.ts:67 obtenerTarifa`. Ese archivo no está en el diff. **Y el
  control positivo de `previewPlantilla` sigue verde pese al cambio de contenedor**: si el paso a
  Sheet hubiera roto la cadena de alcance, esa acción aparecería en la lista.
- `tests/unit/services/usuario-descarga.test.ts`: falla comparando 7 claves contra 6, con
  `zonaNombre` de más. Es el choque 285/T-S4 entre el listado y las claves de la descarga. Nada
  del diff produce `zonaNombre`, y el módulo de usuarios no importa `plantilla-datos.ts`.
  **Ajeno, confirmado por la causa, no por el nombre del archivo.**
- `tests/integration/db/usuarios-filtro-busqueda.test.ts`: mismo origen (285/T-S4), mismo
  razonamiento. Ajeno.

**No creo que ninguno de los tres sea nuestro.**

---

## 5. Estado de checkpoints (para `done`)
- [ ] `tasks.md` con todas las tasks `[x]`: T0 a T16 y T22 a T26 siguen sin marcar. Correcto para
      un PR de fase; bloquea `done`.
- [ ] `requirements.md` y `design.md` alineados con lo implementado (H1).
- [ ] `progress/impl_288.md` con el mapa de R a test completo (T25 pendiente).
- [ ] `./init.sh` completo en verde con delta 0 (hoy 3 rojos ajenos vivos en `dev`).
- [ ] Entrada en `progress/history.md`.
