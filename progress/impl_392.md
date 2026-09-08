# 392 — El nombre de la tienda y la geografía también se imprimen · bitácora del `backend_dev`

> Ficha **sin spec** (`sdd: false`). Zona `backend` de una ficha `fullstack`: **la mitad de
> servidor**. La mitad de pantalla —el aviso que ve el maestro— la hace `frontend_dev` después.
> **Sin migración, sin tocar la base, sin backfill.**

---

## 0. Lo primero: ¿es cierto el encargo?

Sí, y está confirmado **contra los archivos reales**, no contra el grafo (que aquí miente en las
dos direcciones: no conocía `renombrarNodoGeografico` ni `crearNodoGeografico`, vivos desde la
375, y `search_graph` para «geografía renombrar» devolvió 40 símbolos sin ninguno de los dos).

| Afirmación del encargo | Comprobado en | Veredicto |
| --- | --- | --- |
| La etiqueta imprime el nombre de la **tienda** | `lib/pdf/etiquetas-dibujo.ts` → `datosDeEtiqueta`, dato `tiendaNombre` | **cierto** |
| …y los cuatro de **geografía** | idem, dato `ubicacion` = `geografiaLegible` (zona / provincia / cantón / distrito) | **cierto** |
| Esos nombres salen del **catálogo** | `lib/repositories/OrdenRepository.ts:910-914`: `tiendaNombre: row.tienda.nombre`, `zonaNombre: row.zona.nombre`, `provinciaNombre`, `cantonNombre`, `distritoNombre` | **cierto** |
| La **383 los dejó fuera** | `specs/383-*/requirements.md` §Alcance («El nombre de la tienda y los nombres de geografía… Riesgo residual **declarado**, no cerrado: ver Q3») y su asunción **A6** | **cierto** |
| La **375** hizo renombrable la geografía | `lib/actions/geografia.ts` → `renombrarNodoGeografico`; `GeografiaService.renombrar` | **cierto** |

**Nada del encargo resultó falso.** El único matiz que añado: además de tienda / provincia /
cantón / distrito, la etiqueta imprime el **nombre de la ZONA** (es la primera parte de
`geografiaLegible`), y su escritura vive en `ZonaService`, otra superficie más. El encargo ya la
nombra («zona, provincia, cantón, distrito»), así que entra: **son cinco escrituras, no cuatro**.

---

## 1. Requisitos (los enumero yo: no hay spec) y su test

| # | Requisito | Test |
| --- | --- | --- |
| **R1** | La decisión de «¿es imprimible?» es **la misma** que la del PDF (`COBERTURA` / `cubreTexto`), nunca una copia | `tests/unit/utils/nombre-imprimible-etiqueta.test.ts` › «392/R1 — la definicion de «imprimible» es LA DE LA FUENTE, no una propia» (5 casos `₡ € ™ Œ –` + barrido de los **219** + barrido de las 32 cirílicas). **Mutación M1** los mata |
| **R2** | Reusar esa cobertura **no** mete los ~22 KB de base64 en el bundle inicial | `tests/unit/guards/etiqueta-fuente-diferida.guardia.test.ts` › «383/R3…», con los cuatro módulos nuevos añadidos al `CAMINO_DE_ENTRADA` |
| **R3** | El nombre de la **tienda** se valida al **crear** y al **editar**; si no es imprimible **no se escribe** | `nombres-que-imprime-la-etiqueta.test.ts` › «el nombre de la TIENDA…» (3 casos + `repo.create/update` sin llamadas). **M2** |
| **R4** | El nombre de la **zona** se valida al crear **y** al actualizar | idem › «el nombre de la ZONA…» (2 casos). **M4** |
| **R5** | Los nombres de **provincia / cantón / distrito** se validan en el **alta**, en los tres niveles | idem › «los nombres de la GEOGRAFIA…» (3 casos). **M3** |
| **R6** | …y en el **renombrado**, que es la puerta que abrió la 375 | idem › «RENOMBRAR un distrito…» y «RENOMBRAR a un nombre reparable…». **M3** |
| **R7** | **Irreparable** → rechazo que **nombra** el carácter y su `U+XXXX` y **no** manda reintentar | `nombre-imprimible-etiqueta.test.ts` › «irreparable: se NOMBRA el caracter…» (3 casos, literales) |
| **R8** | **Reparable** → rechazo con el texto bueno como **sugerencia**; **no** se guarda reparado | idem › «reparable: NO se guarda reparado…» (3 casos) + los casos de servicio que afirman `repo.create` / `repo.renombrar` sin llamadas |
| **R9** | Un nombre imprimible produce **exactamente** el mismo resultado que antes: ni una clave nueva | idem › «un nombre imprimible no produce NADA» (devuelve `null`, no `{}`) y los tres «sigue creando/actualizando igual que antes» |
| **R10** | El **rol** manda antes que el nombre: un no-maestro con nombre malo recibe `forbidden` | `nombres-que-imprime-la-etiqueta.test.ts` › «el rol manda ANTES que el nombre» |
| **R11** | El rechazo viaja por el canal que la pantalla **ya** pinta (`validation_error` + `fieldErrors.nombre`); **cero contrato nuevo** | los 10 casos de servicio afirman el objeto entero con `toEqual`, incluida la clave |
| **R12** | Las cinco escrituras comparten **definición y redacción**: el mismo nombre da el mismo mensaje | idem › «392/R1 — las cinco escrituras comparten definicion Y redaccion» |

---

## 2. Archivos

### Creados

| Archivo | Qué es |
| --- | --- |
| `lib/utils/nombre-imprimible-etiqueta.ts` | **El módulo de la ficha.** `rechazoDeNombreDeEtiqueta(nombre)` → `null` o el `fieldErrors` listo. Delega **entero** en `evaluarTextoDeEtiqueta` (383) y reusa sus mensajes: aquí no se decide nada ni se redacta nada nuevo |
| `tests/unit/utils/nombre-imprimible-etiqueta.test.ts` | 17 casos: barrido de los 219, barrido cirílico, los tres mensajes **literales** |
| `tests/unit/services/nombres-que-imprime-la-etiqueta.test.ts` | 17 casos sobre las **cinco** escrituras, con dobles |

### Modificados

| Archivo | Qué cambia |
| --- | --- |
| `lib/services/UsuarioService.ts` | `crear` (antes del bcrypt) y `actualizar` (solo si el nombre cambia) |
| `lib/services/ZonaService.ts` | `prepararDatos`, que es el punto que `crear` y `actualizar` **ya** compartían |
| `lib/services/GeografiaService.ts` | `crear` y `renombrar`, antes de la primera consulta |
| `lib/interfaces/services/IGeografiaService.ts` | `validation_error` entra en los dos resultados del servicio. Es la **única** ampliación de contrato de la ficha, y su forma es la que la Server Action ya devolvía ante un ZodError |
| `tests/unit/guards/etiqueta-fuente-diferida.guardia.test.ts` | los 4 módulos nuevos entran en el `CAMINO_DE_ENTRADA` de 383/R3 |

**No se tocó:** ni un componente, ni una página, ni `feature_list.json`, ni `progress/current.md`,
ni `db/`, ni `tests/baseline-rojos.json`.

---

## 3. Los mensajes que produce el borde, y con qué forma

**La forma, en las cinco escrituras, es la misma y ya existía:**

```ts
{ status: "validation_error", fieldErrors: { nombre: [ "<un solo mensaje>" ] } }
```

`nombre` es la clave del campo en las tres superficies (`usuario.nombre`, `zona.nombre` y el
`nombre` de los tres niveles geográficos), así que las tres pantallas lo pintan **junto al input**
con el código que ya tienen (`GeografiaAdminModule` hace `setErrors(res.fieldErrors)`;
`CrearZonaForm`, `setErrors`; `UsuarioForm` idem). **`frontend_dev` no tiene que inventar texto.**

Los tres mensajes, **literales** (`⁨`/`⁩` son U+2068/U+2069, los aislantes bidi):

1. **Irreparable** (emoji, cirílico, una griega del bloque matemático):

   > `«nombre» lleva un carácter que la etiqueta no puede imprimir: «⁨🙂⁩» (U+1F642). Reintentar no lo cambia: escríbelo con letras y números normales.`

2. **Reparable, y la sugerencia se distingue** (`𝕋ienda Feliz`):

   > `«nombre» lleva un carácter que la etiqueta no puede imprimir: «⁨𝕋⁩» (U+1D54B). Escríbelo así: «Tienda Feliz».`

3. **Reparable, pero la sugerencia se PINTA igual** (una `ñ` descompuesta, `"n"` + U+0303):

   > `«nombre» lleva un carácter que la etiqueta no puede imprimir: «⁨̃⁩» (U+0303). Aquí no hay nada que se vea mal: ese carácter se ve igual que el de siempre pero está escrito de otra forma —lo normal es que la letra y su acento vayan por separado—, y así no se puede imprimir. Bórralo y vuelve a teclearlo; copiar y pegar el mismo texto lo trae otra vez igual.`

**Los tres son los de la 383 sin tocar una coma** (`mensajeCorreccionCaracterNoImprimible` y
`mensajeCorreccionSugerencia`), con `campo = "nombre"`. Reusar en vez de redactar es lo que impide
que nazca una segunda versión del aviso sin los aislantes bidi o sin el `U+XXXX` — los dos
detalles que la 382 costó aprender.

### Lo que `frontend_dev` sí tiene que mirar (no lo toco: es su mitad)

- Los tres formularios pintan `fieldErrors` bien, pero **el toast que los acompaña dice
  «Revisa los campos: el formulario está incompleto.»** (`GeografiaAdminModule.mensajeDeDesenlace`,
  `CrearZonaForm.mensajeDeError`). Aquí el formulario **no** está incompleto: está completo y la
  regla lo rechazó. Es exactamente el caso que la **376/R23** ya resolvió en `CrearZonaForm` para
  la marca de zona central —reenviar el motivo del servidor tal cual—, y esa es la forma que
  recomiendo copiar.
- El mensaje ya viene redactado y accionable desde el servidor: **no hay que escribir texto nuevo**,
  solo dejar de taparlo con el genérico.

---

## 4. Decisiones

### D1 — Rechaza, **no** repara. Decisión mía, **sin firmar**, y queda como pregunta abierta

La 383 dejó abierta su **A2**: si la superficie **manual** debe reparar (como la carga masiva) o
rechazar. Esta ficha se topa con la misma pregunta y **no la contesta**: hace lo que ya hace **el
formulario equivalente más cercano**, que es la corrección de datos del cliente
(`CorregirDatosClienteService`, 383/R18) — una persona, delante de un registro, tecleando en un
campo. Allí se **rechaza devolviendo el texto bueno como sugerencia**, y el motivo escrito es que
en la carga masiva no hay nadie delante de 500 filas mientras que aquí sí lo hay.

Añado un motivo propio: estos nombres **no son el dato de un tercero** que haya que respetar, son
catálogo propio, y quien lo escribe puede corregirlo en el acto.

> **PREGUNTA ABIERTA (A2-bis), para el humano:** si se firma que la superficie manual **repare y
> avise** en vez de rechazar, la vuelta atrás es cambiar **un solo módulo**
> (`lib/utils/nombre-imprimible-etiqueta.ts`, que devolvería el valor reparado en vez del
> `fieldErrors`) y con él cambian las cinco escrituras a la vez. Por eso el rechazo se construye
> ahí y no en cada servicio.

### D2 — La validación va en el **servicio**, no en el zod

Mismo criterio que la 383 (design §5.1): `lib/types/geografia-nodo.ts`, `lib/types/zona.ts` y
`lib/types/usuario.ts` **viajan al navegador**; los servicios no. Y además evita tocar
`lib/types/**`, que es una de las rutas ante las que `--rapido` se niega.

### D3 — En `UsuarioService` se comprueba para **todos los roles**, no solo `adminTienda`

Porque el rol **no es fijo**: `actualizar` acepta `rolId`, así que un mensajero llamado «𝕄ario»
promovido a tienda meses después llevaría su nombre no imprimible al papel **sin volver a pasar por
ninguna puerta**. Acotar al rol dejaría esa rendija abierta a cambio de nada: ningún nombre de
persona legítimo necesita un carácter fuera de la fuente.

### D4 — El corte de `ZonaService` va en `prepararDatos`

Es el punto que `crear` y `actualizar` **ya** compartían. Un solo sitio cierra las dos escrituras y
no hay forma de que una gane la comprobación y la otra la pierda — el mismo argumento con el que la
383 eligió `BulkOrdenService.resolveFila` para cerrar las dos vías de carga de golpe.

---

## 5. Lo que esta ficha NO cierra, declarado

1. **Los nombres ya guardados.** No se hace backfill ni se toca la base: es otra decisión y no
   está tomada. La medición está en §6.
2. **Un nombre escrito por otra puerta y promovido después.**
   `PostulacionRepository.crearMensajeroConDocumentos` (postulación pública de mensajero) y
   `ApiKeyRepository` (cuenta técnica de integración) escriben `usuario.nombre` **sin pasar por
   `UsuarioService`**. Si una de esas cuentas se promoviera luego a `adminTienda` sin que nadie
   edite el nombre, el hueco sigue. Cerrarlo pedía **rechazar un cambio de rol por un dato viejo**,
   que es una decisión sobre los nombres ya guardados — la del punto 1.
3. **La comprobación del PDF sigue intacta.** `exigirCobertura` (382/R1, 282/R28) no se relaja:
   esta ficha añade una puerta **antes**, no sustituye a la de después.
4. **Sin verificación en la app real.** No la hace un agente; queda para quien abra
   `/configuracion/geografia` y `/configuracion` con sesión `maestro`.
5. **Sin E2E**: no hay harness Playwright ejecutable en el repo.

---

## 6. Cuántos nombres ya guardados romperían la etiqueta hoy

Medido con un script de **solo lectura** (`findMany` + `caracterNoCubiertoEn` con la MISMA
cobertura del PDF), borrado después. **Contra la base LOCAL de desarrollo**, que es la única a la
que tengo acceso: **no tengo el MCP de Supabase en mi conjunto de herramientas**, así que
**producción no la he podido medir** y no la invento.

```
tienda:    1 filas, 0 no imprimibles
zona:     13 filas, 0 no imprimibles
provincia: 7 filas, 0 no imprimibles
canton:   84 filas, 0 no imprimibles
distrito: 494 filas, 0 no imprimibles
TOTAL_NO_IMPRIMIBLES=0
```

**599 nombres, 0 romperían la etiqueta.** El catálogo local es el del seed oficial (DTA), y la
única tienda es la de pruebas. **Esto no dice nada de producción**: hay que repetirlo allí antes de
concluir que no hace falta backfill. Lo que sí dice es que **la puerta no rompe nada de lo que ya
existe** en esta base.

---

## 7. Las cuatro mutaciones (árbol real, revertidas desde copia, con autocomprobación)

El arnés aborta si el texto no aparece **exactamente** las veces esperadas, si **vitest no llegó a
emitir su línea de resultados** (sin ella no se ha medido nada), o si al restaurar el archivo no
vuelve a ser **byte a byte** el original. Nunca `git checkout`.

**Línea base:** `Test Files 6 passed (6) · Tests 159 passed (159) · exit 0`

| # | Mutación | Archivo | Qué se puso rojo |
| --- | --- | --- | --- |
| **M1** | la validación usa una **definición propia** (`/^[ -~ -ÿ]*$/`) en vez de la del PDF | `lib/utils/nombre-imprimible-etiqueta.ts` | **24 fallos** en 2 archivos: los cinco `₡ € ™ Œ –`, «barrido: los code points cubiertos pasan TODOS, y son 219», los tres mensajes literales, y las 10 escrituras de servicio |
| **M2** | **el nombre de la tienda deja de validarse** (los dos `rechazoDeNombreDeEtiqueta(input.nombre)` → `null`) | `lib/services/UsuarioService.ts` | **4 fallos**: alta irreparable, alta reparable, edición, y «el MISMO nombre produce el MISMO mensaje…» |
| **M3** | **un nombre de geografía deja de validarse** (alta y renombrado) | `lib/services/GeografiaService.ts` | **6 fallos**: los tres niveles del alta, los dos renombrados y el de la redacción compartida |
| **M4** | **el nombre de la zona deja de validarse** | `lib/services/ZonaService.ts` | **3 fallos**: crear, actualizar y el de la redacción compartida |

**Tras revertir las cuatro:** `Test Files 6 passed (6) · Tests 159 passed (159) · exit 0`.
**4 mutaciones, 4 muertas.**

---

## 8. Verificación

### `pnpm run typecheck`

```
> tsc --noEmit
TYPECHECK_EXIT=0
```

### `pnpm run lint`

```
✖ 164 problems (0 errors, 164 warnings)
LINT_EXIT=0
```

Los 164 son avisos preexistentes de `no-unused-vars` en tests ajenos; ninguno en los archivos de
esta ficha.

### `pnpm exec vitest related --run` sobre los cinco archivos de `lib/` tocados

```
Test Files  37 passed (37)
Tests  599 passed (599)
```

### `./init.sh` (completo)

Ver §9.

---

## 9. Gate — `./init.sh` COMPLETO

Se corrió el **completo** (no el `--rapido`): el diff toca `lib/interfaces/**` y cinco servicios, y
en cualquier caso el encargo lo pedía. Log propio, sin `tail`, con el `INIT_EXIT` escrito **dentro**
del log. El `.env` se copió de la raíz antes de correrlo y se borró antes de commitear.

```
== Arnes SDD :: init (modo: completo) ==
✓ node v24.13.0
✓ dependencias presentes
✓ feature_list.json: sin ids duplicados (389 fichas), cupo por zona respetado (in_progress=2) y specs en su sitio
✓ typecheck paso
✓ lint paso
…
 Test Files  1790 passed (1790)
      Tests  25643 passed | 26 skipped (25669)
   Duration  863.57s

✓ tests: sin rojos nuevos (0 archivo(s) rojo(s) sobre 1790 ejecutado(s), todos en el baseline conocido)
! migraciones sin down.sql: 20260814120000_ruta_optimizada_trazado 20260814140000_ruta_parada_tramo 20260814160000_ruta_tramo_vivo_at
✓ .env presente
== init OK ==
INIT_EXIT=0
```

- **`skipped` = 26**, que es el número conocido: no se cayó ningún archivo a mitad.
- El aviso amarillo de los tres `down.sql` es **deuda ajena y preexistente** (migraciones de agosto
  de la ficha de rutas). Esta ficha **no crea ninguna migración**.
- **No se tocó `tests/baseline-rojos.json`.** No hizo falta: cero rojos.
- No se observó ninguna contención con el otro agente sobre la base local (`integration/db` en
  verde entero).

---

## 10. Veredicto

**Cerrada la mitad de servidor: las cinco escrituras que producen los nombres que la etiqueta
imprime rechazan lo que la fuente no cubre, con la MISMA definición del PDF y sin una sola
redacción nueva; gate completo verde (`INIT_EXIT=0`, 26 skipped), 4 mutaciones y 4 muertas.**
