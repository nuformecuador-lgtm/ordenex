# 392 — La mitad de pantalla: el aviso de los nombres que la etiqueta no puede imprimir

> Ficha **sin spec** (`sdd: false`). Zona `frontend` de una ficha `fullstack`: **la mitad de
> pantalla**. La de servidor ya está mergeada en `dev` (PR #745) y su bitácora es
> `progress/impl_392.md`. **Sin migración, sin tocar `lib/`, sin tocar la definición de imprimible.**

---

## 0. Lo primero: ¿es cierto el encargo?

Casi entero, y con **una corrección medida** que cambia el trabajo en una de las tres pantallas.

| Afirmación del encargo | Comprobado en | Veredicto |
| --- | --- | --- |
| El servidor devuelve `{ status: "validation_error", fieldErrors: { nombre: [...] } }` | `lib/utils/nombre-imprimible-etiqueta.ts` → `rechazoDeNombreDeEtiqueta` | **cierto** |
| Las tres pantallas ya pintan ese `fieldErrors` junto al input | `GeografiaAdminModule` (`FormField … error={errors.nombre}` y `error={erroresRenombrado.nombre}`), `CrearZonaForm:406`, `UsuarioForm:404` | **cierto** |
| `GeografiaAdminModule` acompaña el rechazo con «Revisa los campos: el formulario está incompleto.» | `GeografiaAdminModule.mensajeDeDesenlace`, línea 843 | **cierto** |
| `CrearZonaForm` idem | `CrearZonaForm.mensajeDeError`, línea 647 (ya como *fallback* del patrón de la 376) | **cierto** |
| **`UsuarioForm` idem** | — | **FALSO, y por dos motivos** |
| Ninguno de los tres reenvía ya el motivo | `CrearZonaForm` **sí lo reenvía**, pero **solo para `esCentral`** (376/R23) | **matiz** |

### La corrección: la pantalla de usuarios no dice lo que el encargo dice, y no falla donde dice

1. **`UsuarioForm` no muestra ningún toast.** Por diseño (R28) el formulario solo pinta errores de
   campo; el toast lo da el anfitrión, **`UsuariosModule.guardarFormulario`**. Ahí es donde había
   que trabajar.
2. **Y ese toast no dice «Revisa los campos: el formulario está incompleto.»**, que es un texto que
   en este repo sale de otras tres pantallas. `UsuariosModule.mensajeError` **no tiene un caso para
   `validation_error`**, así que cae en su `default` y dice **«Revisa los datos e inténtalo de
   nuevo.»**. El defecto es el mismo —un genérico que tapa un motivo que ya venía escrito— pero el
   texto es otro, y el test que lo ancla tenía que escribir **ese** literal y no el del encargo.

3. **Un tercer hallazgo, éste con consecuencias de diseño** (§2): en la pantalla de usuarios el
   MISMO `validation_error` con la MISMA clave `nombre` puede venir **de dos sitios**, y solo uno
   de los dos trae un motivo que valga la pena repetir.

---

## 1. Requisitos (los enumero yo: no hay spec) y su test

| # | Requisito | Test |
| --- | --- | --- |
| **F1** | En **geografía**, el rechazo del nombre en el **alta** sale en el toast con el motivo del servidor, no con el genérico | `tests/unit/components/geografia-admin.ui.test.tsx` › «el ALTA repite el motivo del servidor en el toast…». **M1a** |
| **F2** | …y **también** junto al campo, que es donde se queda mientras se corrige | idem › «el ALTA lo pinta TAMBIÉN junto al campo del nombre» |
| **F3** | En geografía, lo mismo en el **renombrado** (la puerta que abrió la 375), y con el mensaje **LARGO entero** | idem › «el RENOMBRADO repite el motivo LARGO entero…». **M2a** |
| **F4** | En geografía, un `validation_error` de **otro** campo conserva el genérico | idem › «un validation_error de OTRO campo conserva el mensaje genérico» |
| **F5** | En **zonas**, el rechazo del nombre al **crear** sale con el motivo del servidor | `tests/components/ZonaNombreNoImprimible.test.tsx` › «al CREAR, el toast repite el motivo…». **M1b** |
| **F6** | …y se pinta también junto al campo | idem › «al CREAR, el motivo se pinta TAMBIÉN junto al campo del nombre» |
| **F7** | En zonas, lo mismo al **actualizar**, con el mensaje **LARGO entero** | idem › «al ACTUALIZAR, el motivo LARGO viaja entero…». **M2b** |
| **F8** | En zonas, otro campo conserva el genérico — y el aviso de la **376** (`esCentral`) **sigue funcionando** | idem › «un validation_error de OTRO campo…» + `ZonaCentralConfirmacion.test.tsx` entero |
| **F9** | En **usuarios**, el rechazo del nombre sale con el motivo del servidor y no con «Revisa los datos e inténtalo de nuevo.» | `tests/unit/components/usuarios-nombre-no-imprimible.test.tsx` › «el toast repite el motivo del SERVIDOR…». **M1c** |
| **F10** | En usuarios, el mensaje **LARGO** viaja entero y además se pinta junto al campo | idem › «el motivo LARGO viaja entero…» |
| **F11** | En usuarios, otro campo del servidor conserva el genérico | idem › «un validation_error del servidor en OTRO campo…» |
| **F12** | ⭑ En usuarios, un rechazo de la validación **de cliente** conserva el genérico: su texto **no es del servidor** | idem › «⭑ un rechazo de la validación de CLIENTE conserva el genérico…». **M3** |

---

## 2. La decisión de diseño: por qué la pantalla de usuarios no puede reenviar «a ciegas»

En geografía y en zonas, reenviar `fieldErrors.nombre?.[0]` es seguro porque **ese toast solo se
pinta con la respuesta del servidor**: las dos pantallas validan en cliente ANTES y salen sin
avisar por toast (`GeografiaAdminModule` pone «Este campo es obligatorio.» en el campo y vuelve;
`CrearZonaForm.enviar` hace `setErrors(...)` y `return`).

En **usuarios no**: `UsuariosModule.guardarFormulario` pinta el toast con **lo que devuelva
`submit()`**, y `submit()` devuelve **con la misma forma** los rechazos de la validación de
cliente. Y los mensajes de `nombre` de esa validación los redacta **zod, en inglés**. Medido, no
supuesto (zod 4.4.3, `z.string().min(1)`, sin `errorMap` global en el repo):

```
{"nombre":["Too small: expected string to have >=1 characters"]}
```

Reenviar `res.fieldErrors.nombre?.[0]` a secas habría cambiado un mensaje pobre —«Revisa los datos
e inténtalo de nuevo.»— por **uno peor**: texto en inglés de una librería, en un toast, para el
caso más frecuente de todos (dejar el nombre en blanco).

**La distinción se hace donde se sabe**, no por el texto: `UsuarioForm.submit()` es quien conoce
cuál de las dos ramas corrió, así que guarda el motivo **solo** en la rama que llegó a llamar a la
acción y lo expone en su handle como `motivoDelNombreDelServidor()`. El anfitrión lo lee y, si es
`null`, se queda con el genérico de siempre.

**Alternativas descartadas:**

- **Adivinar por el texto** (un `if` que mire si el mensaje «parece» el del servidor): una
  heurística sobre copy, que se rompe la primera vez que alguien reescribe una frase.
- **Darle un mensaje en español al `min(1)` de `lib/types/usuario.ts`**: arreglaría el síntoma en
  el sitio correcto y de paso mejoraría el error inline, pero es **`lib/`** —fuera de mi alcance en
  este encargo— y **cambia la validación de cliente**, no el aviso. Queda anotado en §5 como deuda
  con dueño, porque el error inline en inglés **sigue ahí** y esta ficha no lo toca.
- **Cambiar lo que devuelve `submit()`** (envolverlo en `{ result, origen }`): lo consumen 12 casos
  de `usuario-form.test.tsx` con `toMatchObject({ status })`; ampliar el handle es aditivo y no
  toca ninguno.

### Por qué un `ref` y no un estado

No se pinta (de eso ya se encarga `errors.nombre`), solo lo lee el anfitrión inmediatamente después
de que `submit()` resuelva, y no debe provocar un re-render. Se limpia **al empezar** cada
`submit()`, para que no se pueda repetir el motivo de un intento anterior ya corregido.

---

## 3. Archivos

### Creados

| Archivo | Qué es |
| --- | --- |
| `tests/components/ZonaNombreNoImprimible.test.tsx` | 4 casos sobre `CrearZonaForm` (crear, actualizar, campo, otro campo) |
| `tests/unit/components/usuarios-nombre-no-imprimible.test.tsx` | 4 casos sobre `UsuariosModule` + `UsuarioForm` reales, incluido el del cliente (F12) |

### Modificados

| Archivo | Qué cambia |
| --- | --- |
| `app/(app)/configuracion/geografia/_components/GeografiaAdminModule.tsx` | `mensajeDeValidacion(fieldErrors)` nuevo; lo usan las dos ramas `validation_error` (alta y renombrado). `mensajeDeDesenlace` **no se toca**: sigue siendo la fuente del genérico y del resto de desenlaces |
| `app/(app)/configuracion/tarifas/_components/CrearZonaForm.tsx` | `mensajeDeError` antepone `fieldErrors.nombre?.[0]` al `esCentral` de la 376. Van en ese orden porque el servidor **nunca los devuelve juntos** (el corte del nombre vive en `prepararDatos`, la marca central se decide después) |
| `app/(app)/configuracion/_components/UsuarioForm.tsx` | `motivoDelNombreDelServidor` (ref + método del handle), fijado solo en la rama que llamó a la acción |
| `app/(app)/configuracion/_components/UsuariosModule.tsx` | el toast de `guardarFormulario` lo consulta antes de caer en `mensajeError(res.status)` |
| `tests/unit/components/geografia-admin.ui.test.tsx` | +4 casos (F1-F4) |
| `tests/components/ZonaCentralConfirmacion.test.tsx` | **una línea de fixture** (ver aviso abajo) |

> ⚠️ **El único cambio a un test ajeno, y por qué no es debilitarlo.** El caso 376
> «un validation_error de OTRO campo conserva el mensaje genérico» usaba `nombre` como ejemplo de
> «otro campo». Desde esta ficha **`nombre` ya no es «otro campo»**. El fixture pasa a
> `distritoIds`, que sigue siendo un campo que el toast no reenvía; **la aserción no cambia**
> (`errorMock` llamado con el genérico) y lo que el caso mide —que el genérico no desaparece para
> el resto de campos— es exactamente lo mismo. El archivo entero sigue en verde (15 casos).

**No se tocó:** ni `lib/`, ni `db/`, ni una Server Action, ni la definición de imprimible, ni
`feature_list.json`, ni `progress/current.md`, ni `tests/baseline-rojos.json`.

**La guardia de la fuente sigue verde y no la rozo:** esta mitad **no importa nada** de
`lib/utils/*etiqueta*`; solo reenvía un `string` que ya venía en la respuesta.
`tests/unit/guards/etiqueta-fuente-diferida.guardia.test.ts` → 15 passed.

---

## 4. Cómo queda el aviso, pantalla por pantalla

En las tres, el motivo aparece **en dos sitios a la vez**: junto al input (donde se queda mientras
se corrige) y en el toast (porque el campo puede haber quedado fuera de la pantalla — el argumento
de la 376). Los textos son los del servidor, **sin tocar una coma**.

| Pantalla | Escritura | Antes | Ahora |
| --- | --- | --- | --- |
| `/configuracion/geografia` | alta de provincia/cantón/distrito | «Revisa los campos: el formulario está incompleto.» | el motivo del servidor |
| `/configuracion/geografia` | renombrado (375) | idem | el motivo del servidor |
| `/configuracion/tarifas` (zonas) | crear y actualizar zona | idem (el `esCentral` de la 376 ya se reenviaba) | el motivo del servidor |
| `/configuracion` (usuarios) | crear y editar usuario/tienda | **«Revisa los datos e inténtalo de nuevo.»** | el motivo del servidor **si es suyo**; el genérico si el rechazo lo puso el navegador |

Los tres mensajes, tal y como se leen (literales, comprobados carácter a carácter contra los que
produce `rechazoDeNombreDeEtiqueta`; en los tests van **escritos a mano**, no importados):

1. **Irreparable** (emoji, cirílico, griega del bloque matemático):

   > `«nombre» lleva un carácter que la etiqueta no puede imprimir: «⁨🙂⁩» (U+1F642). Reintentar no lo cambia: escríbelo con letras y números normales.`

2. **Reparable y la sugerencia se distingue:**

   > `«nombre» lleva un carácter que la etiqueta no puede imprimir: «⁨𝕋⁩» (U+1D54B). Escríbelo así: «Tienda Feliz».`

3. **Reparable pero la sugerencia se pinta igual** (la `ñ` descompuesta) — el largo, el que no se
   puede resumir porque explica algo que no se ve:

   > `«nombre» lleva un carácter que la etiqueta no puede imprimir: «⁨̃⁩» (U+0303). Aquí no hay nada que se vea mal: ese carácter se ve igual que el de siempre pero está escrito de otra forma —lo normal es que la letra y su acento vayan por separado—, y así no se puede imprimir. Bórralo y vuelve a teclearlo; copiar y pegar el mismo texto lo trae otra vez igual.`

> **Nota de escritura de los literales.** Al escribir un archivo desde el agente, el texto puede
> quedar en **NFD** (la `ñ` como `n` + U+0303). Con literales que hablan precisamente de eso, un
> archivo descompuesto compara una cosa contra otra sin que se note. Los seis archivos tocados se
> verificaron **NFC**, uno a uno, antes de commitear.

---

## 5. Lo que esta mitad NO cierra, declarado

1. **El error inline de la validación de cliente sigue en inglés** en el formulario de usuarios
   («Too small: expected string to have >=1 characters», bajo el campo Nombre). Es **anterior a
   esta ficha** y su arreglo vive en `lib/types/usuario.ts` (un mensaje en el `min(1)`), fuera de
   mi alcance aquí. Lo que esta ficha sí garantiza es que **ese texto no llega al toast** (F12).
2. **Sin verificación en la app real.** No la hace un agente: queda para quien abra
   `/configuracion/geografia`, `/configuracion/tarifas` y `/configuracion` con sesión `maestro`.
3. **Sin E2E**: no hay harness Playwright ejecutable en el repo.
4. **La pregunta abierta A2-bis de la mitad de servidor sigue abierta** (rechazar vs. reparar). Si
   se firma al revés, el que cambia es `lib/utils/nombre-imprimible-etiqueta.ts`; esta mitad de
   pantalla no depende de esa decisión, solo de que el motivo llegue por `fieldErrors.nombre`.

---

## 6. Las seis mutaciones (árbol real, revertidas desde copia, con autocomprobación)

El arnés aborta si el texto no aparece **exactamente** las veces esperadas, si **vitest no llegó a
emitir su línea de resultados** (sin ella no se ha medido nada), o si al restaurar el archivo no
vuelve a ser **byte a byte** el original —comparado contra el buffer leído ANTES de mutar, no
contra sí mismo—. Nunca `git checkout`.

**Línea base:** `Test Files 4 passed (4) · Tests 76 passed (76)`

| # | Mutación | Archivo | Qué se puso rojo |
| --- | --- | --- | --- |
| **M1a** | **vuelve el toast genérico** en geografía | `GeografiaAdminModule.tsx` | `Tests 2 failed \| 51 passed (53)` — alta y renombrado |
| **M1b** | **vuelve el toast genérico** en zonas | `CrearZonaForm.tsx` | `Tests 2 failed \| 17 passed (19)` — crear y actualizar (el archivo de la 376 sigue verde) |
| **M1c** | **vuelve el toast genérico** en usuarios | `UsuariosModule.tsx` | `Tests 2 failed \| 2 passed (4)` |
| **M2a** | el mensaje del servidor **se recorta** a 80 caracteres | `GeografiaAdminModule.tsx` | `Tests 2 failed \| 51 passed (53)` |
| **M2b** | el mensaje del servidor **se sustituye** por uno propio | `CrearZonaForm.tsx` | `Tests 2 failed \| 2 passed (4)` |
| **M3** | se reenvía `res.fieldErrors.nombre` **sin distinguir el origen** (el atajo que §2 descarta) | `UsuariosModule.tsx` | `Tests 1 failed \| 3 passed (4)` — cae **solo** F12, que es exactamente el agujero que abre |

**Tras revertir las seis:** `Test Files 4 passed (4) · Tests 76 passed (76)`, idéntica a la base.
**6 mutaciones, 6 muertas.**

---

## 7. Verificación

### `pnpm run typecheck`

```
> tsc --noEmit
TYPECHECK_EXIT=0
```

### `pnpm run lint`

```
✖ 174 problems (0 errors, 174 warnings)
LINT_EXIT=0
```

Los 174 son avisos preexistentes de `no-unused-vars` en tests ajenos; ninguno en los archivos de
esta ficha.

### `pnpm exec vitest related --run` sobre los cuatro componentes tocados

```
Test Files  16 passed (16)
Tests  235 passed (235)
```

### `./init.sh` (completo)

Ver §8.

---

## 8. Gate — `./init.sh` COMPLETO

Se corrió el **completo**, no el `--rapido`: esto sale a producción esta noche y el arnés pide el
completo antes de una release. Log propio, sin `tail` (que truncaría el fichero en origen y dejaría
un rojo sin nombre), con el `INIT_EXIT` escrito **dentro** del log. `pnpm install` y
`pnpm run db:generate` antes —el worktree no traía `node_modules` propio—, y el `.env` copiado de la
raíz antes de correrlo y **borrado antes de commitear**.

```
== Arnes SDD :: init (modo: completo) ==
✓ node v24.13.0
✓ dependencias presentes
✓ feature_list.json: sin ids duplicados (389 fichas), cupo por zona respetado (in_progress=2) y specs en su sitio
✓ typecheck paso
✓ lint paso
…
 Test Files  1794 passed (1794)
      Tests  25671 passed | 26 skipped (25697)
   Duration  959.39s

✓ tests: sin rojos nuevos (0 archivo(s) rojo(s) sobre 1794 ejecutado(s), todos en el baseline conocido)
! migraciones sin down.sql: 20260814120000_ruta_optimizada_trazado 20260814140000_ruta_parada_tramo 20260814160000_ruta_tramo_vivo_at
✓ .env presente
== init OK ==
INIT_EXIT=0
```

- **`skipped` = 26**, que es el número conocido: no se cayó ningún archivo a mitad. Y con el `.env`
  puesto, así que los ~134 archivos de `tests/integration/db` **se ejecutaron**, no se saltaron.
- **1794 archivos** frente a los 1790 de la mitad de servidor: los 4 de más son los 2 nuevos de esta
  ficha y los 2 que llegaron con otros merges a `dev`.
- **Ningún `40P01`**: la contención conocida entre tests que aplican DDL no se reprodujo en esta
  corrida.
- El aviso amarillo de los tres `down.sql` es **deuda ajena y preexistente** (migraciones de agosto
  de la ficha de rutas). Esta ficha **no crea ninguna migración** ni toca `db/`.
- **No se tocó `tests/baseline-rojos.json`.** No hizo falta: cero rojos.

---

## 9. Veredicto

**Cerrada la mitad de pantalla: las tres superficies que escriben los nombres que la etiqueta
imprime repiten el motivo del servidor —entero, sin recortar ni reescribir— en vez del genérico que
mandaba a buscar un campo vacío inexistente; gate completo verde (`INIT_EXIT=0`, 26 skipped, 0
rojos), 6 mutaciones y 6 muertas. Con una corrección al encargo: la pantalla de usuarios no decía
«el formulario está incompleto» sino «Revisa los datos e inténtalo de nuevo.», su toast no vive en
`UsuarioForm` sino en `UsuariosModule`, y ahí reenviar a ciegas habría sacado texto de zod en
inglés — por eso el motivo se marca en origen (§2).**
