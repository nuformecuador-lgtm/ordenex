# 383 — Normalizar al entrar los caracteres que la etiqueta no puede imprimir · bitácora

> Rama `feat/383-normalizar-caracteres-no-imprimibles`, desde `dev` en `fa785c79`.
> Spec: `specs/383-normalizar-caracteres-no-imprimibles/{requirements,design,tasks}.md`.
> Alcance ejecutado: **backend** (T0–T6, T8). **T7 (frontend) NO se hizo**: es del `frontend_dev`.

---

## Las decisiones, y de quién son

**Ninguna de estas está firmada por el humano.** Son del leader, escritas el 2026-09-07 y
reversibles con lo que el spec dice en su tabla de asunciones.

| # | Decisión | Quién | Qué se implementó |
| --- | --- | --- | --- |
| **Q1** | **Reparar y avisar** en la carga masiva, no rechazar — pero **la reparación tiene que verse** | leader | R9/R10: la fila creada trae `textoNormalizado[]` con campo, original y aplicado |
| **Q2** | **Sí** a un `NFC` previo | leader | `evaluarTextoDeEtiqueta` compone antes de recorrer, **solo** con `reparar: true` |
| **Q3** | El nombre de tienda y los de geografía **salen fuera** (ficha 392) | leader | No se tocó `UsuarioService` ni `ZonaService` |
| **Q4** | **No** hace falta rastro persistente | leader | Sin migración, sin `historial_accion`: el aviso vive en la respuesta, como `montoAjustado` |
| **Q5** | **Sí**, los mensajes comparten la frase de diagnóstico y difieren en el cierre | leader | `fraseCaracterNoImprimible` en `lib/`, tres cierres distintos |
| **A2** | La corrección **rechaza**, no repara | leader (spec, sin revocar) | R18: `validation_error` con el texto reparado como sugerencia |
| **A3** | `num_remision` **no se repara nunca** | leader (spec, sin revocar) | R12: `evaluarTextoDeEtiqueta(…, { reparar: false })` |

**T4.1 (la puerta):** se cruzó con Q1 respondida y con A2/A3 **no revocadas** — están escritas
como normativas en el spec (R18 y R12), y el leader no las cambió al delegar. No se decidió nada
nuevo aquí. La respuesta del leader llegó por el encargo, **no** está escrita en
`progress/current.md`: ese archivo es del leader y no se toca desde una rama de agente (hay tres
agentes más trabajando en paralelo).

---

## T0 — Las mediciones (salida real del script de un solo uso, ya borrado)

```
COBERTURA: 219 code points en 19 rangos

T0.1 — NFKC saca de cobertura 9 de 219:
  U+00A8 «¨» -> « ̈» [U+0020 U+0308]
  U+00AF «¯» -> « ̄» [U+0020 U+0304]
  U+00B4 «´» -> « ́» [U+0020 U+0301]
  U+00B5 «µ» -> «μ» [U+03BC]
  U+00B8 «¸» -> « ̧» [U+0020 U+0327]
  U+00BC «¼» -> «1⁄4» [U+0031 U+2044 U+0034]
  U+00BD «½» -> «1⁄2» [U+0031 U+2044 U+0032]
  U+00BE «¾» -> «3⁄4» [U+0033 U+2044 U+0034]
  U+02DC «˜» -> « ̃» [U+0020 U+0303]

T0.1b — NFKC reescribe sin sacar de cobertura 8:
  U+00A0 « » -> « »        (NBSP -> espacio normal)
  U+00AA «ª» -> «a»
  U+00B2 «²» -> «2»
  U+00B3 «³» -> «3»
  U+00B9 «¹» -> «1»
  U+00BA «º» -> «o»
  U+2026 «…» -> «...»
  U+2122 «™» -> «TM»

T0.1c (Q2) — NFC cambia 0 de los 219 cubiertos:

T0.2 — bloque U+1D400-U+1D7FF (1024 code points):
  reparables   : 702
  irreparables : 322
  muestra irreparables: U+1D455 -> «𝑕» · U+1D49D -> «𝒝» · U+1D4A0 -> «𝒠» · U+1D4A1 -> «𝒡» ·
                        U+1D4A3 -> «𝒣» · U+1D4A4 -> «𝒤»
  U+1D560 «𝕠» -> «o» cubierto=true
  U+1D6C2 «𝛂» -> «α» cubierto=false
```

**Lo que dicen estos números:**

1. **T0.1 = 9, no 0** → la justificación de A1 se sostiene y la tarea **no** manda parar. El
   design esperaba ocho (`¼ ½ ¾ ´ ¨ ¯ ¸ ˜`); el noveno, **no previsto en el spec**, es
   **U+00B5 `µ` MICRO SIGN**, que bajo `NFKC` se convierte en la **μ griega (U+03BC)**, que no
   está en la fuente. O sea: un `NFKC` a ciegas habría dejado de imprimir «5 µg» — un caso más
   realista en un `producto` que las fracciones.
2. **T0.1b = 8 más** que `NFKC` reescribiría **gratis** sin ganar nada (el NBSP entre ellos).
3. **T0.1c = 0** → el `NFC` previo de Q2 es la **identidad** sobre todo lo que hoy imprime bien.
   Es la medición que hace que Q2 no reabra el problema de §3.2 del design: R8 y R21 no pueden
   romperse por componer.
4. **T0.2 = 702 / 322** → «normalizar el bloque U+1D400» no lo repara entero: **el 31 % se
   rechaza**, y es el resultado correcto (las griegas normalizan a griego).

Los cuatro conteos están aseverados en `tests/unit/utils/texto-imprimible-etiqueta.test.ts`
(219, 1024, 702, 322), así que dejan de ser una foto y pasan a ser una puerta.

---

## Archivos

### Creados

| Archivo | Qué es |
| --- | --- |
| `lib/pdf/etiquetas-fuente-cobertura.ts` | **GENERADO.** Solo `COBERTURA` (19 rangos, 219 code points). Lo escribe el mismo script y desde el mismo lector de TTF: sigue derivada del `.ttf` (282/R29). |
| `lib/utils/texto-imprimible-etiqueta.ts` | El módulo puro: `evaluarTextoDeEtiqueta(texto, { reparar })`. Sin Prisma, sin HTTP, sin React, sin el artefacto de fuente. |
| `lib/utils/mensaje-caracter-no-imprimible.ts` | `aislado`, `fraseCaracterNoImprimible` y los tres mensajes de esta ficha. |
| `tests/unit/utils/texto-imprimible-etiqueta.test.ts` | 20 casos: la regla, los dos barridos y el par suplente. |
| `tests/unit/utils/mensaje-caracter-no-imprimible.test.ts` | 8 casos: aislantes bidi, notación y los tres literales. |
| `tests/unit/services/bulk-orden-service.texto-etiqueta.test.ts` | 17 casos: las dos vías, dry-run, no regresión. |
| `tests/unit/services/corregir-datos-cliente-texto-etiqueta.test.ts` | 8 casos: rechazo, sugerencia, `notas` fuera. |

### Modificados

| Archivo | Cambio |
| --- | --- |
| `scripts/fuente-etiqueta-a-base64.ts` | Emite **dos** módulos. |
| `lib/pdf/etiquetas-fuente.ts` | **Regenerado**: `import { COBERTURA }` y la constante local borrada. Diff = 1 línea añadida, 26 borradas; el base64 no cambió ni un byte. |
| `lib/pdf/etiquetas-fuente-registro.ts` | `type Cobertura`, `cubreCodePointEn`, `caracterNoCubiertoEn`, `cubreTextoEn`. Los tres de siempre quedan como envoltorios de una línea. **Cero call sites tocados.** |
| `lib/types/carga-masiva.ts` | `TextoNormalizado` y `RowResult.textoNormalizado?`. No importa nada de `lib/pdf/`. |
| `lib/services/BulkOrdenService.ts` | El corte en `resolveFila` + `delete fila.textoNormalizado` en `reclasificarOmitidas` + el aviso en las dos vías. |
| `lib/services/CorregirDatosClienteService.ts` | El rechazo en el bloque 5.b, antes de la geografía y de cualquier escritura. |
| `app/(app)/ordenes/_components/EtiquetasGuiaModal.tsx` | Deja su `aislado` y compone con el de `lib/`. **El literal de la 382 no cambia ni un byte** y su test sigue verde sin tocarlo. |
| `tests/unit/guards/etiqueta-fuente-diferida.guardia.test.ts` | Guardia ampliada (R3/R1). |

### NO tocados, a propósito

- **Ninguna migración, ninguna tabla, ninguna política de RLS.** El diseño dice que no hace falta
  y no hizo falta: se escriben los mismos cinco campos de texto de siempre.
- `carga-masiva-error-chips.ts` y `carga-masiva-export-errores.ts`: los errores viajan bajo la
  clave de la columna del archivo, así que funcionan sin cambios.
- `exigirCobertura` y todo `lib/pdf/etiquetas-*` de dibujo (R20).

---

## Mapa R → test

| R | Test |
| --- | --- |
| R1 | `etiqueta-fuente-diferida.guardia.test.ts` › «R1 — y es LA MISMA cobertura que usa el generador del PDF, el mismo objeto» (identidad referencial `toBe`) + `etiquetas-fuente.test.ts` sin tocar |
| R2 | `etiquetas-fuente.test.ts` › «R29 — COBERTURA coincide EXACTAMENTE con lo que el archivo cubre» (verde tras regenerar) |
| R3 | `etiqueta-fuente-diferida.guardia.test.ts` › «ninguno de los modulos de ese camino nombra el ARTEFACTO», «`lib/types/carga-masiva.ts` no importa NADA de `lib/pdf/`», «el modulo de cobertura son SOLO los rangos» |
| R4 | `texto-imprimible-etiqueta.test.ts` › (c) `½`, (d) `™ … m² ¼ ¾ ´¨`, (g) `ñ` precompuesta, + barrido de los 219 |
| R5 | idem › (a) `𝕠rfirio → orfirio`, (b) `ﬁn → fin` |
| R6 | idem › (e) emoji, (f) cirílico, (R7) `𝛂`, «el culpable ocupa dos unidades UTF-16» |
| R7 | idem › «barrido del bloque U+1D400-U+1D7FF» (702/322) + «los dos nombrados» |
| R8 | idem › «los 219 entran y salen IDENTICOS, y son 219» |
| R9 | `bulk-orden-service.texto-etiqueta.test.ts` › «lo que se manda a la base es `orfirio`» + «los otros tres campos reparables» |
| R10 | idem › «la fila creada trae `campo`, `original` y `aplicado`» + «dos campos reparados: DOS avisos» · *(T7.1/T7.2, UI, pendientes del frontend)* |
| R11 | idem › «mismas filas, misma clasificacion y los mismos avisos» (dry-run vs firme) |
| R12 | idem › «una remision double-struck da ERROR» + `texto-imprimible-etiqueta.test.ts` › (h) |
| R13 | idem › «un emoji en el destinatario deja la fila en error bajo SU columna», «dos campos rotos → DOS claves», «lote de 3 con la del medio rota» |
| R14 | `mensaje-caracter-no-imprimible.test.ts` › los tres literales + `bulk-orden-service.texto-etiqueta.test.ts` (aserción literal del mensaje) |
| R15 | `bulk-orden-service.texto-etiqueta.test.ts` › los tres casos «via API KEY, espejo» (mutación M2 los mata sin tocar los de sesión) |
| R16 | idem › «un emoji SOLO en `notas`» + «`provincia` con un emoji falla por GEOGRAFIA» |
| R17 | `corregir-datos-cliente-texto-etiqueta.test.ts` › «nombre roto + direccion buena: NI LA DIRECCION se escribe» (**el doble no recibe ninguna escritura**, no basta el status) |
| R18 | idem › «`𝕠rfirio` → `validation_error` cuyo mensaje trae `orfirio`, y no se escribe nada» |
| R19 | idem › «corregir solo `notas` con un emoji: `ok`, y se guarda con el emoji intacto» |
| R20 | `EtiquetasGuiaModal.test.tsx` (28 casos, **sin tocar**) + `tests/unit/pdf/**` (15 archivos, 333 casos) verdes |
| R21 | `bulk-orden-service.texto-etiqueta.test.ts` › «el `BulkSummary` … es el de antes, byte a byte» (`toEqual` del objeto completo) + «una fila reparada que la base descarto queda `duplicada` y SIN `textoNormalizado`» |

---

## T8.1 — Las siete mutaciones (aplicadas al árbol real, revertidas desde copia)

Cada una: `cp` del archivo al scratchpad → mutación → suite → `cp` de vuelta → suite verde otra
vez. **Nunca `git checkout`.** Salida real de vitest, recortada a las líneas que importan:

| # | Mutación | Archivo | Qué se puso rojo |
| --- | --- | --- | --- |
| 1 | `NFKC` a la cadena entera (`normalize("NFC")` → `normalize("NFKC")`) | `lib/utils/texto-imprimible-etiqueta.ts` | **4 fallos**: `(c) ½`, `(d) ™ … m²`, `(R7) 𝛂`, «los 219 entran y salen IDENTICOS» |
| 2 | La comprobación **solo** en `cargarMasiva` (flag `evaluarTexto=false` desde `cargarViaApi`) | `lib/services/BulkOrdenService.ts` | **3 fallos, los tres de la vía API** («repara igual», «rechaza igual», «`num_remision` tampoco»); los de sesión siguieron verdes |
| 3 | Borrar `delete fila.textoNormalizado` | `lib/services/BulkOrdenService.ts` | **1 fallo**: «una fila reparada que la base descarto queda `duplicada` y SIN `textoNormalizado`» |
| 4 | `for…of base` → `for…of base.split("")` | `lib/utils/texto-imprimible-etiqueta.ts` | **10 fallos**, entre ellos «el culpable ocupa dos unidades UTF-16 y su codePointAt(0) es el real» |
| 5 | La corrección **aplica** la reparación y sigue a `ok` | `lib/services/CorregirDatosClienteService.ts` | **2 fallos**: «`𝕠rfirio` → `validation_error`…» y «la `ñ` descompuesta…» |
| 6 | Añadir `notas` a `CAMPOS_TEXTO_ETIQUETA` | `lib/services/BulkOrdenService.ts` | **1 fallo**: «un emoji SOLO en `notas`: la fila se crea y las notas se guardan con el emoji INTACTO» |
| 7 | Quitar los aislantes bidi de `aislado` | `lib/utils/mensaje-caracter-no-imprimible.ts` | **11 fallos** en 3 archivos, incluido `EtiquetasGuiaModal.test.tsx` › «un caracter de control no puede reordenar el aviso que lo denuncia» (el de la **382**) |

Tras revertir las siete: `Test Files 5 passed (5) · Tests 81 passed (81)`.

---

## Verificación

### `pnpm run typecheck`

```
> tsc --noEmit
TYPECHECK_EXIT=0
```

### `pnpm run lint`

```
✖ 160 problems (0 errors, 160 warnings)
LINT_EXIT=0
```

Los 160 son los de siempre (`no-unused-vars` sobre parámetros con `_`, `no-img-element`). Tres son
de `corregir-datos-cliente-texto-etiqueta.test.ts` y son **el mismo patrón que ya tiene**
`corregir-datos-cliente-service.test.ts`: los parámetros del doble se declaran aunque no se usen
para que `mock.calls[0][1]` tenga tipo. **Cero errores.**

### `./init.sh` completo (T8.2)

Corrido sobre el commit `14728b0b`, con el `.env` copiado de la raíz **antes** de lanzarlo. El
`INIT_EXIT` se escribió **dentro** del log, en su propia línea, y sin `tail` en la tubería:

```
== Arnes SDD :: init (modo: completo) ==
✓ node v24.13.0
✓ dependencias presentes
✓ feature_list.json: sin ids duplicados (387 fichas), cupo por zona respetado (in_progress=4) …
✓ typecheck paso
✓ lint paso (0 errores)

 Test Files  1776 passed (1776)
      Tests  25380 passed | 26 skipped (25406)
   Duration  665.72s

✓ tests: sin rojos nuevos (0 archivo(s) rojo(s) sobre 1776 ejecutado(s), todos en el baseline conocido)
! migraciones sin down.sql: 20260814120000_ruta_optimizada_trazado 20260814140000_ruta_parada_tramo 20260814160000_ruta_tramo_vivo_at
✓ .env presente
== init OK ==
INIT_EXIT=0
```

**Los `skipped`, mirados uno a uno (que es donde el gate sabe mentir):**

- Los **26** salen de **dos** archivos de componente y son de antes de esta ficha:
  `AnaliticaPage.test.tsx` (17) y `AnaliticaShell.test.tsx` (9).
- **`tests/integration/db` NO saltó**: corrieron los **210** archivos que hay en el directorio
  (`ls tests/integration/db/*.test.ts | wc -l` = 210, y 210 distintos aparecen ejecutados en el
  log). Sin el `.env` copiado, esos 210 se saltan y el gate «pasa» en verde sin haber tocado
  Postgres.
- Los cuatro archivos nuevos de esta ficha corrieron dentro del gate:
  `bulk-orden-service.texto-etiqueta` (17), `texto-imprimible-etiqueta` (20),
  `corregir-datos-cliente-texto-etiqueta` (8), `mensaje-caracter-no-imprimible` (8).

El `!` de las migraciones sin `down.sql` es **anterior y ajeno**: son tres migraciones de rutas
del 2026-08-14. Esta ficha **no añade ninguna migración**.

---

## Lo que queda vivo (para el reviewer y para el frontend)

1. ~~**T7 entero, sin empezar**~~ — **HECHO el 2026-09-07** por el `frontend_dev`, en la misma
   rama. Ver §«T7 — la mitad de pantalla» al final de este archivo.
2. **T9, la comprobación humana**, sin hacer (no la hace el agente). Doce mil tests no sustituyen
   a mirar la app: subir un XLSX de tres filas —una normal, una con el destinatario en
   double-struck y una con un emoji en la dirección—, leer el preview, confirmar y luego imprimir
   la etiqueta de la reparada.
3. **Un chip por carácter, no por tipo.** `carga-masiva-error-chips.ts` agrupa canonizando lo que
   va entre comillas **simples**, y este mensaje lleva el carácter entre `«…»`: dos filas con dos
   emojis distintos producen **dos** chips en vez de uno. No rompe nada y no es un requisito de
   esta ficha; queda escrito para que no se descubra en producción.
   → **Decidido en T7.3 (2026-09-07): no se toca, y se mide.** Ver §T7, «Los chips».
4. **El riesgo del design §8.1 sigue en pie**: la reparación puede **alargar** el texto (`ﬁ` →
   `fi`) y una dirección al límite podría disparar `ErrorEtiquetaNoCabe` (ficha 350). Hay un caso
   de test que lo afirma (`r.valor.length === r.original.length + 1`), pero no es una puerta:
   hoy ese texto ni siquiera se imprimía.
5. **Q3 sigue abierta y es real**: el nombre de la tienda y los de geografía llegan a la etiqueta
   y esta ficha no los toca (ficha **392**). Un maestro que registre «𝕋ienda» vuelve a tumbar el
   lote, y esta vez el aviso apuntará a una orden cuyo dato está bien.

---

# T7 — la mitad de pantalla (2026-09-07, `frontend_dev`)

> Alcance: **T7.1, T7.2 y T7.3**, y nada más. No se tocó `lib/services/`, `lib/repositories/`,
> `lib/pdf/`, ninguna migración ni la base.

## El hueco que cerraba

R10 estaba **a medias**: el backend emitía `textoNormalizado` y el aviso viajaba por las dos vías,
pero **la pantalla no lo pintaba**. La reparación ocurría en silencio — justo lo que la ficha vino
a evitar («si se normaliza, tiene que verse»). Con T7, **R10 queda completo**.

## Qué ve exactamente el usuario

**Cuando una fila se REPARA** (validación previa, antes de confirmar, con nada escrito todavía):
una línea más en la **misma alerta** que ya cuenta las duplicadas y los céntimos —nunca junto a
las filas con error, porque estas SÍ se cargan—:

```
1 trae caracteres que la etiqueta no puede imprimir y se cargará corregida («𝕠rfirio» → «orfirio»).
2 traen caracteres que la etiqueta no puede imprimir y se cargarán corregidas («𝕠rfirio» → «orfirio»).
```

- El número son **órdenes**, no avisos: una fila con el nombre **y** la dirección rotos dice «1»,
  no «2» (`normalizadas` trae una entrada por CAMPO).
- El ejemplo es el **primer** aviso del lote. Residual declarado: con varias reparaciones distintas
  solo se enseña una; el resto viven en el conteo. Es lo que pide T7.2 («un ejemplo»).
- Los dos textos van dentro de un **`<bdi>`** (isolate bidireccional del HTML). El dato viene del
  archivo de la tienda y es, por definición, texto que la fuente no cubre: sin aislarlo, un
  carácter de control podría dar la vuelta a la frase que lo denuncia. Es la lección de la 382
  resuelta con el elemento que el estándar tiene para esto, **sin** importar nada de `lib/pdf/` en
  un componente de cliente (R3 intacta).
- **Sin reparaciones no se pinta nada** (R21), y un aviso con `original === aplicado` se descarta
  antes de llegar a la pantalla.

**Gramática:** el design proponía «se cargarán **corregidos**»; se usa el **femenino** («corregida»
/ «corregidas») para concordar con las otras cuatro líneas de la misma alerta («1 nueva lista para
cargar», «1 ya existe … y se omitirá», «1 con error y no se cargará», «1 traía céntimos y se
cargará…»), que eliden el sustantivo femenino. Única desviación del literal del design.

**Cuando una fila se RECHAZA** (carácter sin reparación posible): **no cambia nada de lo que ya
había**, y eso es el hallazgo de T7.3, no una omisión. El backend emite el error bajo la clave de
la columna del archivo, así que la fila cae en la tabla de «Órdenes con error» con este motivo:

```
El campo «destinatario» lleva un carácter que la etiqueta no puede imprimir: «⁨🙂⁩» (U+1F642).
Reintentar no lo cambia: corrige esa celda y escríbela con letras y números normales.
```

…produce su **chip** filtrable, y viaja al XLSX de errores como
`Fila 7 — destinatario: <ese mismo mensaje>`, con el emoji y los dos aislantes bidi **intactos**
(medido: el par suplente y los U+2068/U+2069 sobreviven al ida y vuelta por `exceljs`, tanto por el
parser del servidor como por el del navegador). Corregida la celda, la fila re-subida vuelve a
validar.

## Los chips: la decisión, y por qué

El aviso que dejó el backend es correcto y **se midió**: `canonizarMensaje` agrupa reemplazando lo
que va entre comillas **simples**, y este mensaje lleva el carácter entre `«…»` **y además su
`U+XXXX`**. Dos filas con dos emojis distintos dan **dos** chips. Mil filas con mil caracteres
distintos darían mil chips y la fila de filtros sería ilegible.

**Decisión: no se toca `carga-masiva-error-chips.ts`, y la limitación se convierte en medición.**
Motivos, en orden:

1. **T7.3 lo congela explícitamente**: «sin cambiar `carga-masiva-error-chips.ts` ni
   `carga-masiva-export-errores.ts`», y su criterio de hecho es que el `git diff` de esos dos
   archivos esté **vacío**. Lo está.
2. **El arreglo obvio no arregla — medido, no razonado.** Se aplicó como mutación (M9) canonizar
   también `«…»`: los dos chips **siguen siendo dos**, porque el `U+1F642` y el `U+1F600` siguen
   distinguiéndolos. Agruparlos de verdad obliga a canonizar **también** la notación del code
   point, y eso hace que el chip de `«destinatario»` y el de `«direccion»` queden con la **misma
   etiqueta** y distinta clave: dos chips idénticos a la vista. Es rediseño del agrupador, no un
   remiendo.
3. **El caso patológico es real pero improbable**: un archivo roto suele traer el **mismo**
   carácter repetido (una exportación, un copiar-pegar), y ese caso colapsa hoy en **un** chip.

Queda un test que lo **fija y lo explica** (`tests/integration/carga-masiva-errores-roundtrip.test.ts`
› «HOY: un chip por CARÁCTER, no por tipo — limitación MEDIDA, no un requisito»), con el aviso
escrito dentro: si alguien lo arregla, ese test se pone rojo **a propósito** y se actualiza. Si el
humano quiere el agrupado, es **otra ficha** sobre el agrupador.

## Archivos

### Modificados (producción)

| Archivo | Cambio |
| --- | --- |
| `app/(app)/ordenes/_components/carga-masiva-clasificacion.ts` | **T7.1.** `OrdenTextoNormalizado`, `ClasificacionCarga.normalizadas`, `toTextosNormalizados` (guardas defensivos, mismos que `toMontoAjustado`) y el transporte en la rama `creada`. |
| `app/(app)/ordenes/_components/OrdenesCargaPreview.tsx` | **T7.2.** La línea en el mismo `Alert`, el conteo por ÓRDENES y los dos `<bdi>`. |
| `app/(app)/ordenes/_components/OrdenesCargaMasivaButton.tsx` | `CLASIFICACION_VACIA` gana `normalizadas: []` (el tipo lo exige). |

### Modificados (tests)

| Archivo | Cambio |
| --- | --- |
| `tests/components/CargaMasivaClasificacion.test.ts` | +9 casos (T7.1) y `normalizadas` añadido al barrido de `data` basura. |
| `tests/components/OrdenesCargaPreview.test.tsx` | +6 casos (T7.2), literales completos del texto renderizado. |
| `tests/integration/carga-masiva-errores-roundtrip.test.ts` | +6 casos (T7.3): ancla del mensaje, chip, round-trip XLSX por los DOS parsers, re-subida, y la limitación medida de los chips. |
| `tests/components/OrdenesCargaMasivaButton.test.tsx`, `tests/components/OrdenesCargaMasivaNotificacion.test.tsx` | Solo el campo nuevo en sus literales de `ClasificacionCarga`. |

### NO tocados, a propósito

- `carga-masiva-error-chips.ts` y `carga-masiva-export-errores.ts` — **`git diff` vacío** (T7.3).
- Todo el backend (`lib/services/`, `lib/repositories/`, `lib/pdf/`), `lib/types/carga-masiva.ts`,
  migraciones y base.
- `OrdenesCargaResumen.tsx` (paso 3, tras la carga real): el spec pone la línea en el **preview**,
  que es la puerta humana. **Residual declarado**: quien cierre el modal y vuelva al resumen ya no
  ve qué se reparó — el mismo residual que `montoAjustado` ya tenía antes de la 304, y en la vía
  API key no hay preview en absoluto (design §5.5).

## T7 — las mutaciones (aplicadas al árbol real, revertidas **desde copia**)

Cada una: `cp` del archivo al scratchpad → mutación → suite → `cp` de vuelta. **Nunca
`git checkout`.** Baseline antes de empezar: `5 archivos, 76 tests passed`.

| # | Mutación | Archivo | Qué se puso rojo |
| --- | --- | --- | --- |
| M1 | Quitar el guarda `original === aplicado` | `carga-masiva-clasificacion.ts` | **1**: «una reparación que no cambia el texto NO se anuncia» (R21) |
| M2 | No transportar nunca el aviso (`toTextosNormalizados` → `[]`) | idem | **4**, entre ellos «una fila creada con `textoNormalizado` llega con campo, original y aplicado» |
| M3 | Transportar el aviso también en las filas `duplicada` | idem | **1**: «solo cuenta la reparación de las CREADAS…» (la lección de la 294) |
| M4 | Quitar la comprobación de que `aplicado` es string | idem | **1**: el barrido de `textoNormalizado` basura (salía `aplicado: undefined`) |
| M5 | Descartar la lista ENTERA ante una entrada rota (`continue` → `return []`) | idem | **1**: «una lista MIXTA conserva los avisos buenos…» |
| M6 | Contar `normalizadas.length` en vez de remisiones distintas | `OrdenesCargaPreview.tsx` | **1**: «cuenta ÓRDENES, no avisos: dos campos reparados de la MISMA fila siguen siendo 1» |
| M7 | `<bdi>` → `<span>` | idem | **1**: «los dos textos van AISLADOS en `<bdi>`…» |
| M8 | No pintar nunca la línea | idem | **4**: los tres literales (singular, plural, dos-campos) y el de los `<bdi>` |
| M9 | Canonizar también `«…»` en los chips | `carga-masiva-error-chips.ts` *(revertida)* | **1**: «R13: produce su chip…». Y lo que **NO** se puso rojo es el hallazgo: «un chip por CARÁCTER» siguió verde → canonizar `«…»` **no** agrupa, hace falta el `U+XXXX`. |
| M10 | Quitar el prefijo `Fila N — ` del `motivo_error` | `carga-masiva-export-errores.ts` *(revertida)* | **2**: los dos round-trips del XLSX (servidor y navegador) |

Tras revertir las diez: `Test Files 7 passed (7) · Tests 102 passed (102)` y `git diff` vacío en
los dos archivos congelados.

## Mapa R → test (lo que T7 añade)

| R | Test |
| --- | --- |
| R10 | `CargaMasivaClasificacion.test.ts` › «una fila creada con `textoNormalizado` llega con campo, original y aplicado», «una fila con DOS campos reparados aporta DOS avisos…» · `OrdenesCargaPreview.test.tsx` › «una fila reparada: lo dice y enseña «lo que venía» → «lo que se guardará»», «dos órdenes reparadas lo dicen en plural» |
| R11 | (backend) — el preview y la carga real pasan por el mismo `resolveFila`; la pantalla pinta lo que llega |
| R13 | `carga-masiva-errores-roundtrip.test.ts` › «R13: produce su chip…», «R13: llega al XLSX de errores con su `motivo_error`, y el carácter sobrevive», «…y el parser del NAVEGADOR…», «…corregida la celda, la fila re-subida vuelve a validar» |
| R21 | `CargaMasivaClasificacion.test.ts` › «una reparación que no cambia el texto NO se anuncia», «una carga NORMAL no gana ninguna reparación» · `OrdenesCargaPreview.test.tsx` › «sin reparaciones el paso se ve EXACTAMENTE como antes: ni una palabra de más» |

## T7 — el gate completo

Corrido sobre el commit `7cd54446`, con el `.env` copiado de la raíz **antes** de lanzarlo, con
`INIT_EXIT=$?` escrito **dentro** del log y en su propia línea, y **sin** `tail` en la tubería:

```
✓ typecheck paso
✓ lint paso (0 errores; los mismos 160 warnings de siempre, ni uno nuevo)
✓ DATABASE_URL resuelta: los 132 archivos de tests contra Postgres SI se ejecutan

 Test Files  1776 passed (1776)
      Tests  25401 passed | 26 skipped (25427)
   Duration  802.75s

✓ tests: sin rojos nuevos (0 archivo(s) rojo(s) sobre 1776 ejecutado(s), todos en el baseline conocido)
! migraciones sin down.sql: 20260814120000_ruta_optimizada_trazado 20260814140000_ruta_parada_tramo 20260814160000_ruta_tramo_vivo_at
✓ .env presente
== init OK ==
INIT_EXIT=0
```

**Los `skipped`, mirados uno a uno:** los **26** son exactamente los del backend —
`AnaliticaPage.test.tsx` (17, línea 1040 del log) y `AnaliticaShell.test.tsx` (9, línea 8808)—,
ajenos y anteriores a esta ficha. **T7 no añade ni un `skipped`.**

**La cuenta cuadra:** el backend dejó **25.380** tests; T7 añade **21** (9 en
`CargaMasivaClasificacion`, 6 en `OrdenesCargaPreview`, 6 en el round-trip) → **25.401**. Los tres
archivos corrieron DENTRO del gate (líneas 7074, 7997 y 8055 del log), y con ellos los dos de los
módulos congelados: `CargaMasivaErrorChips` (7) y `CargaMasivaExportErrores` (19).

El `!` de las migraciones sin `down.sql` es **anterior y ajeno** (tres migraciones de rutas del
2026-08-14). Esta ficha sigue sin añadir ninguna migración.

---

# Vuelta de revisión (2026-09-07, tras `review_383.md`)

> El reviewer **rechazó sin un solo fallo de código**: nueve mutaciones suyas, ninguna viva. Los
> dos bloqueantes eran de proceso. Aquí está lo que se cerró de este lado.

## B1 — `tasks.md` marcado: **28 de 31**

Tres siguen **sin marcar, con su motivo escrito dentro de la propia tarea**, no por descuido:

| Tarea | Por qué no se marca |
| --- | --- |
| **T4.1** | La puerta humana se cruzó **sin firma**: Q1/Q2/A2/A3 las respondió el leader y la respuesta acabó en el `status_note` de `feature_list.json`, no en `progress/current.md`. Es el bloqueante 2 y **lo está resolviendo el leader con el humano**. |
| **T8.3** | Todo lo suyo está escrito y commiteado —las dos tablas `R → test`, las cuatro mediciones de T0, las mutaciones— salvo lo único que no puede existir aún: **las asunciones que el humano firme o revoque**. Se marca con T4.1. |
| **T9** | La comprobación en la app real. **No la hace un agente**, lo dice el título de la tarea. Y es la única verificación de aplicación que tiene la ficha: sin harness E2E, T9 es el sustituto del checkpoint de Playwright. |

## menor 1 — «Escríbelo así» enseñando lo mismo que hay en pantalla

**El defecto, dicho como lo vive quien lo lee:** con una `ñ` **descompuesta** (`"n"` + U+0303, lo
que produce macOS al copiar) la corrección respondía *«Escríbelo así: «Nuñez»»* … y ese «Nuñez» se
**pinta exactamente igual** que el que la persona acababa de teclear. Un mensaje imposible de
obedecer, y en la única superficie donde hay alguien mirando la pantalla.

**Cómo se resolvió, y por qué así.** Lo que cambia no son los píxeles, son los **code points**, así
que es lo que el mensaje dice ahora. Cuando el texto reparado **no se distingue** del tecleado, el
mensaje **deja de repetirlo** —repetirlo *era* el defecto— y da la única instrucción que funciona:

> `«destinatario» lleva un carácter que la etiqueta no puede imprimir: «⁨◌̃⁩» (U+0303). Aquí no hay
> nada que se vea mal: esa letra está escrita en dos piezas —la letra por un lado y su acento por
> otro—, y así no se puede imprimir. Bórrala y vuelve a teclearla; copiar y pegar el mismo texto la
> trae otra vez partida.`

Cuando **sí** se distingue (`𝕠rfirio` → `orfirio`), el mensaje es **byte a byte el de antes**, con
su sugerencia: ese es el caso para el que R18 se escribió y no se toca.

**El predicado no es una heurística.** `seVenIgual(a, b)` es `a.normalize("NFD") === b.normalize("NFD")`:
dos cadenas con el mismo NFD son **canónicamente equivalentes**, o sea la misma secuencia de
caracteres escrita de dos maneras, y Unicode **exige** a quien las muestre que las muestre igual.
Es lo único que se puede afirmar de dos textos sin abrir una fuente.

**Y no vale mirar solo el carácter culpable**, que era el atajo tentador: el culpable que se
reporta es el **primero** fuera de cobertura, así que en `"Nuñez 𝕠rfirio"` (con la ñ descompuesta)
sigue siendo la marca combinante **aunque el texto reparado sí se vea distinto** por culpa del `𝕠`
de más atrás. La pregunta es sobre el texto entero, y hay un test que mata ese atajo.

**Lo que NO se hizo, a propósito.** El reviewer recomienda además **aceptar** la composición
canónica sin preguntar (NFC no cambia la identidad de ningún carácter, así que seguiría siendo «el
nombre que el humano tecleó»). Es razonable y probablemente lo correcto — pero **cambia A2**, que
es una de las asunciones **esperando firma humana** en T4.1. Un arreglo de redacción no es sitio
para colar una decisión de comportamiento. **A2 queda intacta: se sigue rechazando y no se escribe
nada.** Si el humano firma que sí, es un cambio de una línea.

**⚠️ Una línea de backend, declarada.** El mensaje necesita el texto **tal como se tecleó** para
saber si la sugerencia se distingue de él, y eso obliga a un argumento más en la llamada de
`CorregirDatosClienteService.ts` (línea 306). Es un **parámetro nuevo en una llamada**, sin lógica
ni comportamiento nuevos: la decisión de rechazar y no escribir es la misma. Se declara aquí porque
el encargo decía «no toques el backend, y si hace falta, para y dilo»: hace falta, es esto, y no
hay forma de resolver menor 1 sin ello. El parámetro es **obligatorio** a propósito —si fuera
opcional, un llamador nuevo se quedaría con el mensaje inútil sin que nada se pusiera rojo.

## menor 4 — el invariante de la dirección, **clavado**

`createData.direccion` se escribe desde `direccionLiteral` (el literal que sale del resolutor de
geografía) mientras que la **reparación** se calcula desde `data.direccion` (el del schema). Que
los dos sean «el mismo `.trim()` del mismo crudo» vivía **solo en un comentario**, y por la vía
**API key** —que resuelve la geografía con tres columnas separadas, no con `canton_distrito`— no
había ni un caso que lo tocara.

Se cierra con **dos** casos espejo en `cargarViaApi`, las dos mitades del invariante: con
reparación manda lo reparado, y **sin** reparación lo persistido es exactamente lo que el schema
dejó en `data`. Los dos mueren con su mutación (ver tabla). Se eligió clavarlo en vez de dejarlo
dicho porque el modo de fallo es mudo: repararía un texto y escribiría otro sin poner nada rojo.

## menor 5 — un rechazo de texto tapa el error de geografía: **se deja, y se dice**

Una fila con un emoji **y** una provincia inválida reporta hoy **solo** el error de texto, porque
el bloque nuevo retorna antes de resolver la geografía. **Decisión: se queda así.** Los motivos, en
orden de peso:

1. **Dentro de su bloque, el rechazo ya es exhaustivo:** una fila con el nombre y la dirección
   rotos lista **las dos** claves (T5.2e). Lo que no se cruza son las dos *familias* de error.
2. **Cambiarlo es lógica de `resolveFila`**, o sea backend cerrado y con gate verde, y obliga a
   resolver la geografía —una consulta de catálogo— de una fila que **no se va a crear igual**.
3. **El coste real está acotado a un caso raro**: la fila tiene que traer los dos problemas a la
   vez, y el precio es **una** vuelta más de corregir-y-resubir, con el XLSX de errores que ya
   existe (ficha 143). Antes de esta ficha ese caso ni existía: el emoji entraba.

**La vuelta atrás, si el humano la quiere:** en `resolveFila`, no retornar en el bloque de texto y
fusionar sus claves con las de `fieldErrors` de geografía antes de decidir. Es pequeño y medible;
lo que no es, es un arreglo de esta vuelta de revisión.

## menor 2 — `design.md §7` decía lo contrario de la verdad

Afirmaba que `--rapido` «no se debería negar … no toca `lib/types/` **de dominio**». **Es falso:**
el diseño escribe en `lib/types/carga-masiva.ts`, y `docs/verification.md:78` pone `lib/types/**`
—sin matiz de «de dominio»— entre las rutas ante las que el modo rápido **falla**. Sin consecuencia
práctica (el completo se corrió tres veces), pero es la clase de frase que el siguiente lee como
permiso. Corregida en el sitio, diciendo lo que decía antes y por qué era mentira.

## menor 7 — `progress/history.md`

Escrita la entrada de la 383, con el hallazgo del `µ`, los conteos del bloque U+1D400, la partición
del artefacto, la mitad de pantalla y las cuatro deudas declaradas.

## Las tres mutaciones de esta vuelta (árbol real, revertidas desde copia)

| # | Mutación | Archivo | Qué se puso rojo |
| --- | --- | --- | --- |
| M11 | Simular un recorte divergente: escribir `` `${direccionLiteral} ` `` | `lib/services/BulkOrdenService.ts` | **1**: «sin reparacion, la direccion persistida es la del archivo con el MISMO recorte» — el invariante de menor 4 ya no es un comentario |
| M12 | Quitar `reparados.direccion ??` de la escritura | idem | **2**: «y los otros tres campos reparables, igual» (sesión) y «con reparacion, la direccion persistida es la REPARADA» (API key) |
| M13 | `seVenIgual` devuelve siempre `false` | `lib/utils/mensaje-caracter-no-imprimible.ts` | **4** en 2 archivos, incluido «y la `ñ` descompuesta se rechaza SIN repetirle a la persona el mismo texto» — sin el predicado, vuelve el mensaje imposible de obedecer |

Con estas, el total de la ficha va por **26 mutaciones, 26 muertas** (7 del backend + 10 de T7 + 3
de esta vuelta, más las 9 del reviewer).

## Una nota sobre cómo se escribieron estos tests

Los literales del caso de la `ñ` **no** se escriben con los caracteres de verdad: van por
`String.fromCodePoint`. `"Nuñez"` compuesta y descompuesta se pintan **igual** en el archivo, en el
editor y en el diff, así que escritas tal cual el test sería indistinguible a la vista del bug que
persigue — y la marca combinante suelta es además invisible, o sea de las que alguien borra sin
darse cuenta. Primer intento escrito con los caracteres crudos, revertido por eso mismo.
