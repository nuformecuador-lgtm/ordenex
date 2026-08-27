# Feature 288 — Fase 4 (UI). Bitácora del implementer

> Alcance cerrado aquí: **T17, T18, T19, T20, T21** de
> `specs/288-variables-plantilla-desde-catalogo/tasks.md`. Las fases 0–3 ya estaban en `dev`
> y **no se tocaron**. Rama: `feature/288-picker-variables-plantilla` (desde `origin/dev`).
> Sin commit, sin push, sin PR: el árbol queda listo para que el leader lo aterrice.

## 1. Archivos creados

| Archivo | Task |
| --- | --- |
| `app/(app)/configuracion/plantillas/_components/CampoVariablePicker.tsx` | T17 |
| `tests/unit/plantillas/CampoVariablePicker.test.tsx` | T18 |
| `tests/unit/plantillas/EditarPlantillaForm.test.tsx` | T21 |

## 2. Archivos modificados

| Archivo | Task | Que cambio |
| --- | --- | --- |
| `app/(app)/configuracion/plantillas/_components/VariablesInsert.tsx` | T19 | Reescrito. |
| `tests/unit/plantillas/VariablesInsert.test.tsx` | T20 | Reescritura parcial. |
| `app/(app)/configuracion/plantillas/_components/CrearPlantillaForm.tsx` | T21 | Pasa variablesNombres vacio (constante de modulo). |
| `app/(app)/configuracion/plantillas/_components/EditarPlantillaForm.tsx` | T21 | Pasa variablesNombres desde plantilla.variablesNombres. |

`lib/types/plantilla-mensaje.ts` **no se toco**: `PlantillaListItemDTO` ya es alias de
`PlantillaListItem`, que la fase 3 dejo con `variablesNombres`. T21 se resolvio con la
propagacion de la prop y nada mas: se comprobo, no se supuso.

### Lo que se retiro de VariablesInsert (design 5.6)

Input de clave libre, el export `normalizarClave` y su `CLAVE_VALIDA_RE`, el boton Anadir,
el estado `variables` como lista editable, el boton de quitar y el boton manual Vista previa.

### Lo que se conservo a proposito

- El export `insertarPlaceholder`, intacto, con sus dos tests.
- La prop `previewAction = previewPlantilla` **con su valor por defecto**. Es el control
  positivo que `tests/unit/guards/superficie-de-uso.guardia.test.ts` tiene calibrado
  (design 5.2): quitarlo dejaria la Server Action sin consumidor y pondria roja la guardia.
  Verificado: ese `it` sigue pasando.

### Detalles que el reviewer querra mirar

- `PREVIEW_DEBOUNCE_MS = 300` se **exporta**, para que el test avance el temporizador con el
  mismo numero en vez de duplicar un 300 literal.
- Descarte de respuestas fuera de orden: un `useRef` guarda el cuerpo de la ultima peticion
  **lanzada**; la respuesta solo se aplica si al resolver sigue coincidiendo.
- `variablesNombres` cae a una constante `SIN_NOMBRES` de modulo, no a un objeto en linea: una
  referencia nueva por render invalidaria dependencias de `useEffect`.
- El picker es combobox a mano (sin cmdk ni popover, design 5.1) y su nombre accesible sale de
  un span visible via `aria-labelledby`, no de un `aria-label`: el texto visible gana.
- Frontera client-safe respetada: `CampoVariablePicker` importa `CAMPOS_PLANTILLA` directo de
  `lib/types/plantilla-datos.ts` y no introduce `@prisma/client`, `@/lib/db` ni repositories.

## 3. Mapa R -> test (solo los requisitos de esta fase)

Archivos: **P** = `tests/unit/plantillas/CampoVariablePicker.test.tsx`,
**V** = `tests/unit/plantillas/VariablesInsert.test.tsx`,
**E** = `tests/unit/plantillas/EditarPlantillaForm.test.tsx`.

| Req | Archivo | Nombre del it |
| --- | --- | --- |
| R1 | P | R1: pinta el nombre y la descripcion de cada opcion |
| R2 | P | R2: teclear una clave inventada + Enter no llama a onSeleccionar ni crea opcion |
| R3 | P | R3: filtro "monto" deja solo campos de monto; "GUIA" y "guia" dan el mismo conjunto |
| R4 | P | R4: filtro vacio muestra todas las opciones del catalogo sin alias, en su orden |
| R6 | P | R6: filtro "zzz" no deja ninguna opcion y muestra un aviso de vacio |
| R7 | P y V | R7: elegir Monto a cobrar llama a onSeleccionar con "monto" una sola vez / R7: elegir un campo en el picker lo inserta en la posicion del cursor |
| R8 | P | R8: tras elegir, el filtro queda vacio y la lista cierra (aria-expanded=false) |
| R9 | P | R9: la opcion de notas trae el distintivo de sensible; la de cliente no |
| R29 | P | R29: ArrowDown/ArrowUp mueven aria-activedescendant, Enter selecciona la activa, Escape cierra |
| R30 | P | R30: el combobox se encuentra por nombre accesible, la lista es un listbox, y aria-activedescendant coincide con la opcion activa |
| R5 | V | R5: un alias resuelve con su ejemplo, con su nombre limpio y sin aviso |
| R10 | V | R10 + R18: resuelve con los datos de ejemplo del catalogo y no toca el textarea |
| R13 | V | R13: el resumen lista los campos usados, deduplicados y en orden de aparicion |
| R14 | V | R14: editar el textarea a mano actualiza panel y resumen sin otra interaccion |
| R15 | V | R15: clave fuera del catalogo avisa, muestra el hueco y no deshabilita nada |
| R16 | V y E | R16: con nombre persistido el aviso dice ya no existe y nombra el snapshot / R16/T21: el aviso usa el nombre persistido que llega desde EditarPlantillaForm (mas su it de contraste sin snapshot) |
| R18 | V | R10 + R18 (el textarea sigue conteniendo la clave cruda) |
| Debounce 5.2 | V | debounce: varias pulsaciones dentro de la ventana solo disparan una llamada |
| Fuera de orden 5.2 | V | respuesta tardia: un cuerpo anterior que resuelve tarde no pisa el panel actual |
| R17 (helper) | V | los dos it de describe insertarPlaceholder (helper puro), conservados |

R11, R12, R17, R19-R28 y las filas Migracion/Alias son de las fases 0-3, ya en `dev`.

## 4. Baseline y delta: medidos, no citados

Medidos **por el implementer** sobre esta rama antes de escribir una sola linea.

| Suite | Baseline (rama limpia) | Despues | Delta de rojos |
| --- | --- | --- | --- |
| `tests/unit/plantillas/` | **3 rojos / 107 tests** | **1 rojo / 118 tests** | **-2** |
| `tests/components/PlantillasModule.test.tsx` | 6/6 verde | 6/6 verde | **0** |
| `tests/unit/guards/superficie-de-uso.guardia.test.ts` | 1 rojo / 18 | 1 rojo / 18 | **0** |
| `pnpm typecheck` | 1 error | 1 error | **0** |

Delta total de rojos: **0**, y de hecho **-2** en plantillas. **+11 tests nuevos.**
`pnpm lint` limpio sobre los 7 archivos tocados (0 errores, 0 warnings).

### Los tres rojos del baseline, uno por uno

1. `VariablesInsert.test.tsx > R18: con catalogo vacio la vista previa cae al marcador en
   mayusculas` — **resuelto**: el it se borro en T20. Afirmaba el marcador en MAYUSCULAS, que
   design 4.3 **deroga** explicitamente.
2. `VariablesInsert.test.tsx > R18: una clave bien formada fuera del catalogo cae a un marcador
   en mayusculas` — **resuelto**, mismo motivo.
3. `PlantillaMensajeService.test.ts > R18: preview sustituye las variables por su marcador >
   con catalogo vacio toda clave bien formada cae al marcador en MAYUSCULAS` (linea 195) —
   **SIGUE ROJO. No es de esta fase y no se toco.** Ver seccion 5.

Los otros dos rojos que NO son mios, verificados con `git stash` sobre el arbol limpio:

- `superficie-de-uso.guardia.test.ts > ninguna Server Action de lib/actions es inalcanzable sin
  su anotacion sin-superficie` — falla por `lib/actions/tarifas.ts:67 obtenerTarifa`. 1 rojo /
  17 verdes **antes y despues**. El it del CONTROL POSITIVO (previewPlantilla alcanzable desde
  VariablesInsert.tsx) **pasa**.
- `pnpm typecheck`: `tests/unit/components/usuarios-restablecer.test.tsx(47,7)`, falta
  `zonaNombre` en un fixture de `UsuarioListItem`. Comprobado con `git stash push -u`: el arbol
  **completamente limpio** da exactamente el mismo error. Deuda heredada de `dev`.

## 5. Abierto: para el leader, no para mi

1. **Rojo heredado de la fase 2, sin dueno.** `PlantillaMensajeService.test.ts` linea 195
   afirma que preview cae al marcador en MAYUSCULAS para una clave sin ejemplo. La fase 2 (T5)
   reescribio `previewConEjemplos` para pasar por el motor de produccion, y design 4.3 dice que
   eso deja un **hueco vacio**, no el marcador. El test quedo sin actualizar y **ninguna task de
   la fase 4 lo cubre**. Es una asercion hoy falsa, no un fallo de codigo. No lo toque por no
   salirme del alcance: **decision del leader** si se corrige en este PR o se abre chore aparte.
   Mientras siga asi, `./init.sh` no puede quedar verde por este motivo.
2. **El gate `./init.sh --rapido` no llega a verde, y no por el diff.** Acepto el modo rapido
   ("el cambio no toca esquema, tipos compartidos, config ni dinero"), lo que confirma que la
   fase 4 es solo frontend. Muere en el primer paso, `pnpm run typecheck`, por el error
   preexistente de `usuarios-restablecer.test.tsx` descrito arriba. **No lo force.**
3. **Drift de una sesion paralela en el arbol.** A las 08:22, mientras corria esta fase, otra
   sesion escribio comentarios (solo comentarios, cero codigo) en `lib/actions/ordenes-guia.ts`,
   `lib/actions/recepcion-satelite.ts` y `lib/repositories/OrdenRepository.ts`, respondiendo a
   una pregunta humana sobre si el selector de mensajeros consulta la tabla entera. **No son
   mios y no los toque.** Que el leader NO los arrastre al commit de la 288. `feature_list.json`
   tambien venia modificado de antes; tampoco lo toque.
