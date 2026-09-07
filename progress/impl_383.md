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

<!-- GATE -->

---

## Lo que queda vivo (para el reviewer y para el frontend)

1. **T7 entero, sin empezar** — es del `frontend_dev`: `carga-masiva-clasificacion.ts` con la
   vista `normalizadas`, la línea del preview en `OrdenesCargaPreview.tsx` y el round-trip de
   T7.3. El backend ya emite `textoNormalizado` y la clave solo aparece cuando hubo reparación.
2. **T9, la comprobación humana**, sin hacer (no la hace el agente). Doce mil tests no sustituyen
   a mirar la app: subir un XLSX de tres filas —una normal, una con el destinatario en
   double-struck y una con un emoji en la dirección—, leer el preview, confirmar y luego imprimir
   la etiqueta de la reparada.
3. **Un chip por carácter, no por tipo.** `carga-masiva-error-chips.ts` agrupa canonizando lo que
   va entre comillas **simples**, y este mensaje lleva el carácter entre `«…»`: dos filas con dos
   emojis distintos producen **dos** chips en vez de uno. No rompe nada y no es un requisito de
   esta ficha; queda escrito para que no se descubra en producción.
4. **El riesgo del design §8.1 sigue en pie**: la reparación puede **alargar** el texto (`ﬁ` →
   `fi`) y una dirección al límite podría disparar `ErrorEtiquetaNoCabe` (ficha 350). Hay un caso
   de test que lo afirma (`r.valor.length === r.original.length + 1`), pero no es una puerta:
   hoy ese texto ni siquiera se imprimía.
5. **Q3 sigue abierta y es real**: el nombre de la tienda y los de geografía llegan a la etiqueta
   y esta ficha no los toca (ficha **392**). Un maestro que registre «𝕋ienda» vuelve a tumbar el
   lote, y esta vez el aviso apuntará a una orden cuyo dato está bien.
