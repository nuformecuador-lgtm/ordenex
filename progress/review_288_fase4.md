# Feature 288 — Revisión de la Fase 4 (UI). Veredicto del reviewer

> Alcance revisado: **T17–T21** sobre `feature/288-picker-variables-plantilla`
> (`47417b1e`, `91c031ba`, `4417f902`). Las fases 0–3 ya estaban en `dev` y **no** se juzgan
> aquí. Los tres archivos sucios del árbol (`lib/actions/ordenes-guia.ts`,
> `lib/actions/recepcion-satelite.ts`, `lib/repositories/OrdenRepository.ts`) están fuera del
> diff y se ignoran, como se pidió.

## Veredicto: **APROBADO** (sin bloqueantes)

---

## 1. Checklist

### Especificación
- [x] `requirements.md` con EARS numerados R1–R30.
- [x] `design.md` con alternativas descartadas razonadas (§5.2 cliente vs servidor, §7 WYSIWYG).
- [~] `tasks.md`: **T17–T21 marcadas `[x]`**. T22–T24 y la Fase 6 siguen sin marcar — correcto,
  no son de este PR, pero **la feature NO puede pasar a `done`** hasta cerrarlas.

### Trazabilidad
- [x] Los 17 `it` citados en `progress/impl_288_fase4.md` §3 **existen** y aseveran lo que dicen.
      Verificado uno a uno leyendo los tres archivos, no creyendo la bitácora.
- [x] `progress/impl_288_fase4.md` contiene el mapa `R -> test`.
- [x] Ningún R del alcance (R1–R10, R13–R16, R18, R29, R30, R17) queda sin test real.

### Calidad de código (medido por mí, no citado)
- [x] `pnpm typecheck`: **0 errores**. Confirma al leader; el `chore` 47417b1e arregla deuda real
      de `dev` (`zonaNombre` obligatorio desde la 285) y va en commit aparte, como debe.
- [x] `pnpm exec eslint` sobre los 7 archivos del diff: **0 errores, 0 warnings**.
- [x] `pnpm vitest run tests/unit/plantillas/ tests/unit/types/plantilla-datos.test.ts`:
      **192/192, 11 archivos, 3,9 s**.
- [x] `tests/components/DetalleMensajeroPanel.test.tsx` aislado: **28/28 en 7,1 s**. El archivo
      no está en el diff y no importa nada de plantillas. **El flake de saturación queda confirmado.**
- [x] `tests/unit/guards/superficie-de-uso.guardia.test.ts`: 17/18. El único rojo es
      `lib/actions/tarifas.ts:67 obtenerTarifa`, ajeno al diff. **El CONTROL POSITIVO de
      `previewPlantilla` alcanzable desde `VariablesInsert.tsx` (línea 643) PASA.**
- [x] Sin referencias huérfanas: `normalizarClave` y `PLANTILLA_VARIABLE_EJEMPLOS` no aparecen
      ya en `app/`, `lib/` ni `tests/` (grep en cero).

### Datos y seguridad
- [x] No hay tabla, migración, webhook ni secreto en este diff: es 100 % frontend.
- [x] Sin hardcode de país/moneda: los ejemplos salen del catálogo, que ya usa `formatMonto`.

### Capas y frontera client-safe (lupa 1)
- [x] `lib/types/plantilla-datos.ts` **no** se tocó en este PR y sigue importando solo
      `lib/config/moneda`, `lib/types/rastreo-publico` (zod + tipo) y `app/_landing/guia-en-url`.
      Ni `@prisma/client`, ni `@/lib/db`, ni `repositories/`.
- [x] `CampoVariablePicker.tsx` (`"use client"`) importa `CAMPOS_PLANTILLA` directo del catálogo,
      `components/ui/{badge,input}` y React. Nada de servidor.
- [x] `VariablesInsert.tsx` importa `previewPlantilla` de `lib/actions/plantillas` — módulo con
      `"use server"` en la primera línea: es el patrón de Server Action, no un import de servidor
      arrastrado al bundle. **La frontera no se rompe por la puerta de atrás.**

---

## 2. Lo que pediste mirar con lupa

**1. Frontera client-safe** — limpia, ver arriba.

**2. Debounce 300 ms y descarte fuera de orden** — la implementación es correcta en el caso
peligroso y el test lo demuestra **de verdad**: `previewAction` devuelve promesas diferidas
reales guardadas en un `Map`, se lanzan A y B, y se resuelve B y luego A comprobando que el panel
sigue en «texto B». No hay mock que devuelva lo que el test luego afirma. El de debounce
(4 pulsaciones ⇒ 1 llamada, con `toHaveBeenCalledWith("Hola")`) también es genuino. Un hueco
menor queda anotado abajo (M1).

**3. `insertarPlaceholder` conservado íntegro** — sí: mismo cuerpo, misma firma, mismo doc, y sus
dos `it` de R17 sobreviven en `VariablesInsert.test.tsx`. `previewAction = previewPlantilla`
conserva su valor por defecto y el control positivo de la guardia lo prueba.

**4. Alias ocultos y filtro insensible** — `CAMPOS_POR_DEFECTO` filtra por `aliasDe === undefined`.
El test R4 no se conforma con espejar el filtro: comprueba además, con una lista **hardcodeada**,
que `num_guia`, `nombre`, `destinatario`, `num_remision` y `total` no están en el DOM. R3 usa
minúsculas + NFD + descarte de diacríticos y el test compara los conjuntos de «GUIA» y «guía».
R5 confirma que el alias sigue vivo fuera del selector (preview `10432`, etiqueta «Número de
guía», sin aviso).

**5. Avisar sin bloquear** — verificado más allá del test: **grep de `disabled` en los tres
componentes del módulo devuelve una sola aparición, `disabled={isLoading}` en
`PlantillasModule.tsx`**. `VariablesInsert` no expone ningún callback que pudiera deshabilitar el
formulario, así que el no-bloqueo es estructural, no accidental. Los cuerpos vivos con claves
rotas se pueden seguir editando.

**6. Accesibilidad real** — `role="combobox"` + `aria-expanded` + `aria-controls` +
`aria-autocomplete="list"` + `aria-activedescendant` en el input; `role="listbox"` y
`role="option"` + `aria-selected`. El nombre accesible sale de un `span` visible por
`aria-labelledby` (la lección del checkbox de base-ui, aplicada). El test R29 comprueba que
`aria-activedescendant` **cambia** de la primera a la segunda opción y vuelve, que Enter llama a
`onSeleccionar` con la clave activa y que Escape pone `aria-expanded="false"`; R30 resuelve el id
de `aria-activedescendant` contra el DOM y exige `role="option"` + `aria-selected="true"`. No es
decorativa.

**7. Criterios de «hecho» que no prueban nada** — busqué asserts tautológicos. Los strings
esperados son literales independientes del código bajo prueba («Hola María Rodríguez, total
₡12.500», «texto B», la lista «Monto a cobrar»/«Cliente»). Los dos únicos que rozan la tautología
están abajo como menores (M2, M3). Ninguno sostiene solo un requisito.

---

## 3. Hallazgos

### BLOQUEANTES
Ninguno.

### menor — M1. El descarte fuera de orden compara contra la última petición LANZADA, no contra el cuerpo actual
`VariablesInsert.tsx:105-108`: `cuerpoSolicitadoRef.current` se fija **al disparar** la petición.
`design.md §5.2` dice «solo se aplica la respuesta si sigue siendo el **cuerpo actual**». Queda una
ventana: si A se lanza, el maestro sigue tecleando (valor = B) y A responde **antes** de que expire
el debounce de B, la respuesta de A se aplica y el panel enseña, durante 300 ms como mucho más la
latencia, la vista previa de un cuerpo que ya no está en el textarea. Se autocorrige al llegar B y
**no puede corromper el cuerpo** (la preview no toca el camino de guardado), por eso no es
bloqueante. El caso grave —dos peticiones en vuelo y la vieja resolviendo la última— **sí** está
bien resuelto y bien testeado. Arreglo de una línea si se quiere cerrar: comparar contra un ref
actualizado con `value` en cada render, no dentro del `setTimeout`.

### menor — M2. La aserción de «no bloquea» de R15 no prueba lo que su nombre promete
`VariablesInsert.test.tsx:169` hace `expect(container.querySelectorAll("[disabled]")).toHaveLength(0)`.
El `Harness` no monta el botón de guardar, así que la aserción no puede fallar por el motivo que
dice cubrir: `VariablesInsert` no renderiza ningún control deshabilitable. El requisito **se
cumple** (lo verifiqué por grep sobre los formularios reales y lo respalda el test de integración
de R24 en la fase 5), pero el assert no es el que lo demuestra. El sitio natural sería
`EditarPlantillaForm.test.tsx`, que **sí** monta el formulario real con `{{sucursal}}` y podría
afirmar que el submit sigue habilitado; hoy no lo hace.

### menor — M3. `expect(r.texto).not.toContain("{{")` en `PlantillaMensajeService.test.ts`
El `it` nuevo «una clave DEL catalogo se ve con su valor de ejemplo formateado» solo comprueba que
no quedan llaves: pasaría igual si `preview` devolviese cadena vacía. Debería afirmar el valor
(«Hola María Rodríguez»). El `it` hermano, el que reemplaza la aserción caduca, sí es exacto
(`toBe("Hola , orden ")`) y la jubilación del marcador en MAYÚSCULAS está bien justificada en el
comentario y en `design.md §4.3`.

### menor — M4. La lista no se cierra al perder el foco
`CampoVariablePicker` cierra con Escape y al elegir, pero no tiene `onBlur` ni cierre por clic
fuera: el listbox queda abierto flotando si el maestro se va al textarea con el ratón. No lo pide
ningún R; es pulido de UX.

### menor — M5. Una llamada a la Server Action por montaje con el cuerpo vacío
El `useEffect` no exceptúa `value === ""`, así que abrir «Crear plantilla» dispara
`previewPlantilla("")` a los 300 ms. Inocuo (`preview` no toca base y el guard de rol ya está),
pero es una ida al servidor para no mostrar nada.

### menor — M6. `aria-controls` apunta a un id inexistente con la lista cerrada
El `ul` se desmonta al cerrar. Lo toleran los lectores de pantalla habituales; la alternativa
canónica es mantener el `ul` montado y vacío. Anotado, no accionable.

---

## 4. R sin mapeo a un test real

**Ninguno**, dentro del alcance de la fase. R1–R10, R13–R16, R18, R29, R30 y R17 tienen `it`
existente y verificado. R11, R12, R19–R28 y las filas «Migración»/«Alias» son de las fases 0–3 y
sus archivos existen en la rama (`preview-mismo-motor.test.ts`, `plantilla-mensaje-utils.test.ts`,
`tests/unit/types/plantilla-datos.test.ts`); no los reverifiqué por estar fuera de alcance.

---

## 5. Nota de cierre para el leader

`./init.sh` completo **no** se corrió aquí y CHECKPOINTS lo exige antes de `done`; el gate
`--rapido` medido por el leader (3735 passed / 1 failed, y ese 1 verde en aislado, reconfirmado por
mí) es el gate correcto **para abrir el PR** de una fase. La feature 288 sigue `in_progress`:
faltan T22–T24 y la Fase 6. Y queda vivo, sin dueño y ajeno a este PR, el rojo de la guardia de
superficie por `lib/actions/tarifas.ts:67 obtenerTarifa`.
