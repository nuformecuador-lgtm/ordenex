# Feature 288 — Tasks

> Cada task es discreta, dice **qué archivos toca** y trae un criterio de «hecho» que es un
> **assert ejecutable**, no un `grep` ni un comentario. `[P]` = paralelizable con las tasks
> marcadas igual dentro de la misma fase.
> Gate por task: `./init.sh --rapido`. Gate final: ver T22 (el diff toca migración ⇒ completo).
>
> Revisión humana 2026-08-26 incorporada: T3/T4 (datos de ejemplo), T5 (preview por el motor
> de producción), T11 (`aliasDe`), T16 (aviso de claves sin campo).

---

## Fase 0 — Prerrequisito bloqueante

### T0. Confirmar que el catálogo existe en la rama base
- **Toca:** nada (verificación).
- **Hacer:** comprobar que `lib/types/plantilla-datos.ts` y `tests/unit/types/plantilla-datos.test.ts`
  están **commiteados** en la rama de trabajo (el `status_note` de la feature avisa de que
  nacieron sin commitear).
- **Hecho:** `pnpm vitest run tests/unit/types/plantilla-datos.test.ts` pasa y
  `git log --oneline -1 -- lib/types/plantilla-datos.ts` devuelve un commit.
- **Si falla:** la feature se **bloquea**. No se recrea el catálogo ni se copia del árbol
  sucio: se avisa al leader.
- **Depende de:** —

---

## Fase 1 — Catálogo: alias y datos de ejemplo

### T1. `aliasDe` en `CampoPlantilla`
- **Toca:** `lib/types/plantilla-datos.ts`.
- **Hacer:** añadir `aliasDe?: string` a `CampoPlantilla`; `alias(base, clave, nombre)` fija
  `aliasDe: base.clave` y deja el `nombre` **limpio** (sin « (alias de {{…}})»). El array
  `CAMPOS_PLANTILLA` no cambia de contenido ni de orden.
- **Hecho (asserts en T2):** ver T2.
- **Depende de:** T0. → **R4**, **R5**

### T2. Test de los alias
- **Toca:** `tests/unit/types/plantilla-datos.test.ts` (amplía; **actualiza** cualquier
  aserción existente sobre la cadena « (alias de …)», que deja de existir).
- **Hecho (asserts):**
  - Las 5 claves `num_guia`, `nombre`, `destinatario`, `num_remision`, `total` tienen
    `aliasDe` igual a `guia`, `cliente`, `cliente`, `remision`, `monto`.
  - Ningún `nombre` del catálogo contiene la subcadena `"alias de"`.
  - Cada alias comparte `campo` y `ejemplo` con su base y resuelve al mismo valor.
  - `CAMPOS_PLANTILLA.filter(c => c.aliasDe === undefined)` tiene 39 entradas.
- **Depende de:** T1. → **Trazabilidad/Alias**

### T3. `DATOS_PLANTILLA_EJEMPLO`
- **Toca:** `lib/types/plantilla-datos.ts`.
- **Hacer:** exportar un `DatosPlantilla` completo con valores **crudos** (`montoCobrar: 12500`,
  `peso: 1.5`, `numGuia: 10432`, fechas como `Date`, `negocio.urlBase`, bloque `mensajero`
  completo). Sin cadenas ya formateadas (`design.md §4.1`).
- **Hecho (asserts en T4):** ver T4.
- **Depende de:** T0.

### T4. Test de coherencia fixture ↔ catálogo
- **Toca:** `tests/unit/types/plantilla-datos.test.ts`.
- **Hecho (assert):** `it.each(CAMPOS_PLANTILLA)` ⇒
  `expect(valorDeCampo(campo.clave, DATOS_PLANTILLA_EJEMPLO)).toBe(campo.ejemplo)` para las
  **44** entradas, igualdad estricta.
- **Nota para el implementer:** si nace rojo en `estatus`, `url_guia`, `mapa` o las fechas, se
  **alinea** el fixture o el `ejemplo`. Prohibido cambiar el `toBe` por `toContain` o saltar
  claves con una lista de excepciones.
- **Depende de:** T3. → **R12**

---

## Fase 2 — Motor de vista previa y helpers

### T5. `previewConEjemplos` pasa por el motor de producción
- **Toca:** `lib/utils/plantilla-mensaje.ts`.
- **Hacer:** reescribirla como
  `renderPlantilla(cuerpo, resolverValoresPlantilla(extraerVariables(cuerpo), DATOS_PLANTILLA_EJEMPLO))`.
  Dejar de importar `PLANTILLA_VARIABLE_EJEMPLOS`.
- **Hecho (asserts en T6):** ver T6.
- **Depende de:** T3. → **R11**

### T6. Test «preview y envío salen de la misma función»
- **Toca:** `tests/unit/plantillas/preview-mismo-motor.test.ts` (nuevo).
- **Hecho (asserts):**
  - Para 4 cuerpos (uno sin variables, uno con repetición, uno con alias, uno con clave
    inválida): `previewConEjemplos(c)` es **estrictamente igual** a
    `renderPlantilla(c, resolverValoresPlantilla(extraerVariables(c), DATOS_PLANTILLA_EJEMPLO))`.
  - Con `vi.spyOn` sobre el módulo `plantilla-datos`, `previewConEjemplos` **invoca**
    `resolverValoresPlantilla`: la preview no puede pasar el test reimplementando la
    sustitución por su cuenta.
  - `previewConEjemplos("Hola {{sucursal}}")` ⇒ `"Hola "` (hueco real, **no** `SUCURSAL`).
- **Depende de:** T5. → **R11**

### T7. Fin de `plantilla-variables.ts`
- **Toca:** borra `lib/types/plantilla-variables.ts`; edita `lib/utils/whatsapp-template.ts`
  (`ejemploDe` → `EJEMPLOS_POR_CLAVE`).
- **Hecho (asserts):** `construirComponentsTemplate("Total {{monto}}", ["monto"])` incluye
  `example.body_text[0][0] === "₡12.500"` (no `"MONTO"`); `pnpm typecheck` sin referencias
  colgantes al módulo borrado.
- **Depende de:** T5.

### T8. Revisar la guardia de superficie de uso
- **Toca:** `tests/unit/guards/superficie-de-uso.guardia.test.ts` (solo si el borrado lo exige).
- **Hacer:** el guardia menciona `PLANTILLA_VARIABLE_EJEMPLOS`. Ajustarlo a la superficie real
  tras T7, o retirarlo si su motivo desapareció, **razonando el cambio en el commit**. Su
  CONTROL POSITIVO sobre `previewPlantilla` alcanzable desde `VariablesInsert.tsx` **no se
  toca**: el diseño lo mantiene vivo a propósito (`design.md §5.2`).
- **Hecho:** el guardia pasa y sigue afirmando algo verdadero (no se «arregla» aflojando la
  aserción).
- **Depende de:** T7.

### T9. Helpers de nombres y de claves sin campo
- **Toca:** `lib/utils/plantilla-mensaje.ts`.
- **Hacer:** `nombresDeVariables`, `etiquetaDeVariable`, `clavesSinCampo` según `design.md §4.2`.
- **Hecho (asserts en T10):** ver T10.
- **Depende de:** T0.

### T10. Tests de los helpers
- **Toca:** `tests/unit/plantillas/plantilla-mensaje-utils.test.ts` (amplía el existente).
- **Hecho (asserts):**
  - `nombresDeVariables(["monto","cliente"])` ⇒ `{monto:"Monto a cobrar", cliente:"Cliente"}`.
  - `nombresDeVariables(["sucursal"])` ⇒ `{}` (**R20**).
  - `nombresDeVariables(v)` no muta `v`; `extraerVariables` conserva orden y dedup (**R19**).
  - `etiquetaDeVariable("monto", {monto:"Etiqueta vieja"})` ⇒ snapshot gana; con `{}` ⇒
    catálogo; `("sucursal", {})` ⇒ `{texto:"sucursal", enCatalogo:false}` (**R21**).
  - `clavesSinCampo("Hola {{cliente}} de {{sucursal}}", {})` ⇒ una entrada, `clave:"sucursal"`,
    `retirada:false`; con `{sucursal:"Sucursal"}` ⇒ `retirada:true`, `etiqueta:"Sucursal"`.
  - `clavesSinCampo("{{num_guia}}", {})` ⇒ `[]` (un alias **no** es una clave inválida, **R5**).
- **Depende de:** T9. → **R19**, **R21**

---

## Fase 3 — Datos (backend)

### T11. Columna `variables_nombres` en el esquema y la migración
- **Toca:** `db/schema.prisma`, `db/migrations/<ts>_plantilla_variables_nombres/migration.sql`,
  `db/migrations/<ts>_plantilla_variables_nombres/down.sql`.
- **Hacer:** `variablesNombres Json @default("{}") @map("variables_nombres")`; UP aditiva
  `ADD COLUMN … JSONB NOT NULL DEFAULT '{}'`; DOWN con el `DROP COLUMN` de **esa única**
  columna. Sin backfill.
- **Hecho:** `pnpm db:generate` sin drift **y** T12 pasa.
- **Depende de:** T0.

### T12. Test estático de la migración
- **Toca:** `tests/integration/db/plantilla-variables-nombres-migration.test.ts` (nuevo).
- **Hacer:** calcar el patrón de `plantilla-template-id-migration.test.ts` (lee los `.sql`,
  ignora comentarios).
- **Hecho (asserts):** la UP contiene el `ADD COLUMN "variables_nombres"` con `JSONB`,
  `NOT NULL` y `DEFAULT '{}'`; la UP **no** contiene `DROP`; la DOWN contiene exactamente un
  `DROP COLUMN "variables_nombres"` y ninguna otra sentencia; `schema.prisma` lo declara.
- **Depende de:** T11. → **Trazabilidad/Migración**

### T13. Persistencia en repo + interfaces
- **Toca:** `lib/interfaces/repositories/IPlantillaMensajeRepository.ts`,
  `lib/repositories/PlantillaMensajeRepository.ts`.
- **Hacer:** `variablesNombres` en `CreatePlantillaData`, `UpdatePlantillaData`,
  `PlantillaPublica`, `PlantillaListItem`. **No** en `PlantillaEnviable` ni
  `PlantillaTextoEnviable`. Lector defensivo del `JsonValue`, sin `any`.
- **Hecho (assert):** test del lector con `null`, `"texto"`, `[1,2]`, `{a:1}` ⇒ `{}` en los
  cuatro casos; `{monto:"Monto a cobrar"}` ⇒ igual.
- **Depende de:** T11.

### T14. Service: sella el snapshot al guardar
- **Toca:** `lib/services/PlantillaMensajeService.ts`.
- **Hacer:** en `crear` y en la rama `input.cuerpo !== undefined` de `actualizar`, pasar
  `variablesNombres: nombresDeVariables(validado.variables)`. **No** tocar schemas zod ni
  Server Actions ni `preview` (`design.md §4.5`).
- **Hecho (asserts en T15):** ver T15.
- **Depende de:** T9, T13.

### T15. Tests del service
- **Toca:** `tests/unit/services/plantilla-nombres-variables.test.ts` (nuevo, repo mockeado).
- **Hecho (asserts):**
  - `crear` con `Hola {{cliente}}, son {{monto}}` ⇒ `repo.create` recibe
    `variables: ["cliente","monto"]` y `variablesNombres: {cliente:"Cliente", monto:"Monto a cobrar"}` (**R17**).
  - El `cuerpo` que recibe el repo es idéntico al de entrada, con `{{…}}` (**R18**).
  - Cuerpo con `{{sucursal}}`: entra en `variables`, no en `variablesNombres` (**R20**).
  - `actualizar` sin `cuerpo` en el input **no** manda `variablesNombres`.
- **Depende de:** T14. → **R17**, **R18**, **R20**

### T16. `[P]` Confirmar que la descarga del dataset no cambia
- **Toca:** verificación sobre `tests/unit/descarga/plantillas-descarga-columnas.test.ts`.
- **Hecho (assert):** la suite de columnas pasa **sin editarla**.
- **Depende de:** T13.

---

## Fase 4 — UI

### T17. `CampoVariablePicker`
- **Toca:** `app/(app)/configuracion/plantillas/_components/CampoVariablePicker.tsx` (nuevo).
- **Hacer:** contrato de `design.md §5.1`. Por defecto consume
  `CAMPOS_PLANTILLA.filter(c => c.aliasDe === undefined)`.
- **Hecho (asserts en T18):** ver T18.
- **Depende de:** T1.

### T18. Tests del picker
- **Toca:** `tests/unit/plantillas/CampoVariablePicker.test.tsx` (nuevo, jsdom + RTL).
- **Hecho (asserts):**
  - Se pintan nombre **y** descripción de cada opción (**R1**).
  - Teclear `sucursal` + `Enter` no llama a `onSeleccionar` (**R2**).
  - `"monto"` deja solo las opciones de monto; `"GUIA"` y `"guía"` dan el mismo conjunto (**R3**).
  - Filtro vacío ⇒ 39 opciones en el orden del catálogo, y **ninguna** con clave `num_guia`,
    `nombre`, `destinatario`, `num_remision` o `total` (**R4**).
  - `"zzz"` ⇒ cero `role="option"` + aviso de vacío (**R6**).
  - Elegir «Monto a cobrar» ⇒ `onSeleccionar("monto")` una vez (**R7**).
  - Tras elegir: input vacío y `aria-expanded="false"` (**R8**).
  - `notas` trae el distintivo de sensible; `cliente` no (**R9**).
  - `ArrowDown`/`ArrowUp` mueven `aria-activedescendant`, `Enter` selecciona la activa,
    `Escape` cierra (**R29**).
  - `getByRole("combobox", { name: /campo/i })` lo encuentra; la lista es `role="listbox"` (**R30**).
- **Depende de:** T17.

### T19. Reemplazo de `VariablesInsert`
- **Toca:** `app/(app)/configuracion/plantillas/_components/VariablesInsert.tsx`.
- **Hacer:** quitar input libre / `normalizarClave` / botón «Añadir» / estado editable de
  variables / botón de quitar / botón manual de vista previa. Montar `CampoVariablePicker`,
  panel «Así lo verá el cliente» alimentado por `previewAction` con **debounce 300 ms** y
  descarte de respuestas fuera de orden (`design.md §5.2`), línea de campos usados (§5.3) y
  avisos de `clavesSinCampo` (§5.4). Prop nueva `variablesNombres` (default `{}`).
  **Conservar** `insertarPlaceholder` y la prop `previewAction = previewPlantilla` con su
  valor por defecto.
- **Hecho (asserts en T20):** ver T20.
- **Depende de:** T9, T17.

### T20. Tests de `VariablesInsert`
- **Toca:** `tests/unit/plantillas/VariablesInsert.test.tsx` (reescritura parcial; se
  conservan los tests de `insertarPlaceholder`). `previewAction` se inyecta con un doble que
  delega en `previewConEjemplos`, y los tests avanzan el debounce con temporizadores falsos.
- **Hecho (asserts):**
  - Cuerpo `Hola {{cliente}}, total {{monto}}` ⇒ el panel «Así lo verá el cliente» muestra
    `Hola María Rodríguez, total ₡12.500` y el `<textarea>` sigue conteniendo `{{cliente}}`
    (**R10**, **R18**).
  - Cuerpo `{{monto}} y {{cliente}} y {{monto}}` ⇒ el resumen lista 2 campos en ese orden:
    «Monto a cobrar», «Cliente» (**R13**).
  - Editar el textarea a mano borrando `{{monto}}` actualiza panel y resumen sin más
    interacción (**R14**).
  - Cuerpo `Hola {{sucursal}}` ⇒ aviso «no es un campo válido y llegará vacío al cliente», el
    panel muestra el hueco, y **no** se deshabilita nada del formulario (**R15**).
  - Mismo cuerpo con `variablesNombres={{sucursal:"Sucursal"}}` ⇒ el aviso dice «ya no existe»
    y nombra «Sucursal» (**R16**).
  - Cuerpo `{{num_guia}}` ⇒ panel con `10432`, resumen «Número de guía», **sin** aviso (**R5**).
  - Seleccionar en el picker con el cursor dentro del texto inserta `{{monto}}` ahí y deja el
    caret detrás (**R7**).
  - Sólo se llama a `previewAction` **una** vez tras varias pulsaciones dentro de la ventana
    de debounce, y una respuesta tardía de un cuerpo anterior **no** pisa el panel.
- **Depende de:** T19.

### T21. `[P]` Formularios y DTO
- **Toca:** `CrearPlantillaForm.tsx`, `EditarPlantillaForm.tsx`,
  `lib/types/plantilla-mensaje.ts` (`PlantillaListItemDTO`) y su mapeo.
- **Hacer:** propagar `variablesNombres` (`{}` en crear; `plantilla.variablesNombres` en editar).
- **Hecho (assert):** test que monta `EditarPlantillaForm` con una plantilla cuyo cuerpo tiene
  `{{sucursal}}` y `variablesNombres={{sucursal:"Sucursal"}}`, y comprueba que el aviso usa el
  nombre persistido.
- **Depende de:** T19, T13.

---

## Fase 5 — Invariantes bajo test

### T22. `[P]` Orden y numeración de Meta
- **Toca:** `tests/unit/plantillas/whatsapp-template-numerado.test.ts` (nuevo).
- **Hecho (asserts):**
  - `cuerpoANumerado("Hola {{cliente}}, {{monto}}, {{cliente}}", ["cliente","monto"])` ⇒
    `"Hola {{1}}, {{2}}, {{1}}"` (**R22**).
  - `construirComponentsEnvio(["cliente","monto"], {...})` emite los `parameters` en ese orden
    exacto (**R23**).
  - `extraerVariables` de ese cuerpo devuelve `["cliente","monto"]`, valor literal fijado en el
    test (no calculado a partir del código bajo prueba).
- **Depende de:** T7.

### T23. `[P]` Gate de validación y de rol
- **Toca:** `tests/integration/plantillas/plantillas.int.test.ts` (amplía).
- **Hecho (asserts):** cuerpo `Hola {{a b}}` ⇒ `validation_error` con `fieldErrors.cuerpo` y
  cero escritura; cuerpo `Hola {{sucursal}}` ⇒ `status: "ok"` y la fila persiste
  `variables: ["sucursal"]` con `variables_nombres = {}` (**R24**); actor `tienda` ⇒
  `forbidden` en `crear` y `actualizar` sin escritura (**R25**); round-trip real de
  `variables_nombres` para un cuerpo con claves del catálogo.
- **Depende de:** T14.

### T24. `[P]` El usuario ve el mensaje relleno
- **Toca:** `tests/unit/components/chat-plantilla-relleno.test.tsx` (nuevo),
  `tests/unit/utils/whatsapp-envio-valores.test.ts` (amplía),
  `tests/unit/services/chat-whatsapp-service.test.ts` (amplía).
- **Hecho (asserts):**
  - `resolverValoresPlantilla` resuelve por clave y `renderPlantilla` sustituye **todas** las
    ocurrencias (**R26**).
  - En el selector de plantillas del chat el texto visible no contiene `{{` ni la clave cruda,
    y sí el valor de la orden (**R27**).
  - El texto persistido del saliente es idéntico al que produce
    `renderPlantilla(cuerpo, resolverValoresPlantilla(variables, datos))` (**R28**).
- **Depende de:** T0.

---

## Fase 6 — Cierre

### T25. Mapa de trazabilidad
- **Toca:** `progress/impl_285.md`.
- **Hacer:** tabla `R1..R30` + las dos filas extra (Migración, Alias) → archivo de test +
  nombre del `it`. Sin huecos.
- **Hecho:** cada fila apunta a un `it` que existe y pasa (verificado corriéndolos).
- **Depende de:** T2, T4, T6, T7, T10, T12, T15, T18, T20, T21, T22, T23, T24.

### T26. Gate
- **Toca:** nada.
- **Hacer:** `./init.sh --rapido` **se va a negar**: el diff toca `db/schema.prisma`, una
  migración y `lib/types/` (CLAUDE.md §5). Correr `./init.sh` completo, sin forzar el rápido.
- **Hecho:** `./init.sh` en verde, con delta de rojos respecto al baseline de la rama base
  igual a **0** (medir el baseline **antes**, no citarlo de memoria).
- **Depende de:** T25.
