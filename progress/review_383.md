# 383 — Normalizar al entrar los caracteres que la etiqueta no puede imprimir · revisión

> Revisado sobre **`origin/feat/383-normalizar-caracteres-no-imprimibles` = `bda2a338`** (el ref
> local iba atrasado en `fcc255aa`). PR **#732**, base `dev`. Worktree aislado, `pnpm install
> --frozen-lockfile` real (nunca junction: hay tres agentes más vivos), `pnpm run db:generate`
> antes del gate y el **`.env` copiado de la raíz** —sin él el gate miente en verde—.
>
> **Nota de herramientas:** el MCP `codebase-memory` **no está** en el conjunto de este agente
> (`search_graph` responde *No such tool available*). Toda la búsqueda de código se hizo con
> `grep` y leyendo el archivo real. Se dice aquí porque la regla 7 de `CLAUDE.md` manda empezar
> por el grafo.

---

## Veredicto

**RECHAZADO** — y conviene leer la letra pequeña: **no falla ni una línea de código**. Los 21
requisitos están implementados y **verificados uno a uno, con mutaciones que apliqué yo al árbol
real**; el gate completo sale verde con los números exactos que declaró el implementador; y los
cuatro puntos que más riesgo tenían —la regla «lo cubierto no se toca jamás», la identidad
referencial de la cobertura, la trampa de bundle y los aislantes bidi— **se confirman**.

Lo que bloquea es de **proceso**, y se cierra sin tocar el árbol: `tasks.md` está **0 de 31**
marcada, y dentro vive una tarea —**T4.1, la puerta de aprobación humana**— que **no la cruzó un
humano**: Q1 («¿reparar o rechazar en la carga?») y las asunciones A2/A3 las decidió el leader, y
el spec las declara *sin firmar*. Marcarla `[x]` hoy sería mentir; dejarla `[ ]` incumple
`CHECKPOINTS.md`. La salida es la firma, no un parche.

---

## Checklist de `CHECKPOINTS.md`, punto por punto

### Especificación

- [x] `specs/383-.../requirements.md` con 21 requisitos EARS numerados `R1`–`R21`.
- [x] `design.md` con alternativas descartadas y su porqué — hay **cinco**: (a) no partir el
      artefacto, (b) lista propia de caracteres permitidos, (c) `NFKC` a secas, (d) tabla propia
      double-struck→ASCII, (e) escalera de candidatos. Cada una con su motivo medido.
- [ ] **`tasks.md` con todas las tasks marcadas `[x]`** → **0 de 31**. Ver BLOQUEANTE 1.

### Trazabilidad

- [x] Cada `R<n>` mapea a al menos un test concreto **y no vacío**. Recorridos los 21, con lo que
      comprobé de cada uno en la tabla de más abajo.
- [x] `progress/impl_383.md` trae el mapa `R<n> → test` (dos: el del backend y el que añade T7).

### Calidad de código

- [x] `pnpm run typecheck` — **0 errores** (dentro del gate).
- [x] `pnpm run lint` — **0 errores**, 160 warnings, los mismos de siempre.
- [x] `pnpm test` — dentro del gate completo, verde.
- [ ] E2E para flujo crítico (ingesta de órdenes) → **inaplicable**: este repo no tiene harness de
      Playwright. El sustituto que el propio spec define es **T9** (subir un XLSX de tres filas,
      leer el preview, confirmar e imprimir la etiqueta de la reparada) y **sigue sin hacer**. No
      lo puede hacer un agente. Ver hallazgo `menor` 6.

### Datos y seguridad (Supabase)

- [x] **Ninguna tabla nueva, ninguna columna, ningún enum, ninguna migración** → nada que poner
      bajo RLS. Verificado sobre el diff completo: `db/` no aparece en él.
- [x] Sin migraciones → nada que revertir. El `!` de `down.sql` del gate son tres migraciones de
      rutas del 2026-08-14, anteriores y ajenas.
- [x] Ningún secreto en el diff.
- [x] Sin webhooks nuevos (nada de firma ni idempotencia que revisar).

### Patrón de capas

- [x] `lib/utils/texto-imprimible-etiqueta.ts` es **puro**: sin Prisma, sin HTTP, sin React.
      Comprobado que su único import de `lib/pdf/` es el registro (tipos y predicados, 10 KB) y
      el módulo de cobertura (19 rangos), no el artefacto.
- [x] Los servicios no conocen HTTP. El corte vive en `BulkOrdenService.resolveFila` y en el
      bloque 5.b de `CorregirDatosClienteService`.
- [x] Ningún repositorio ganó lógica. Los **tres únicos** puntos de escritura de estos campos en
      todo el repo —`BulkOrdenService.ts:243` (sesión), `:561` (API key) y
      `CorregirDatosClienteService.ts:438`— siguen igual, y los tres quedan **detrás** de la
      puerta nueva.
- [x] Sin interfaces nuevas.

### Permisos / multi-país

- [x] Sin superficies nuevas ni cambios de permisos.
- [x] Sin país, moneda ni cuenta hardcodeados. La única «lista» del cambio es la cobertura, y
      **se deriva del `.ttf` commiteado** (verificado, abajo).

### Verificación final

- [x] `./init.sh` completo **en verde**, corrido por mí.
- [x] `progress/review_383.md` (este archivo).
- [ ] Entrada en `progress/history.md` → **no existe** para 383. Por convención del repo la
      escribe el leader al cerrar (`chore(NNN): cierra la ficha…`), así que es pendiente de cierre
      y no deuda del implementador.

---

## Verificación ejecutable, corrida por mí

### El gate completo — `INIT_EXIT=0`

```
✓ typecheck paso
✓ lint paso (0 errores)
✓ DATABASE_URL resuelta: los 132 archivos de tests contra Postgres SI se ejecutan

 Test Files  1776 passed (1776)
      Tests  25401 passed | 26 skipped (25427)
   Duration  720.56s

✓ tests: sin rojos nuevos (0 archivo(s) rojo(s) sobre 1776 ejecutado(s))
! migraciones sin down.sql: 20260814120000_… 20260814140000_… 20260814160000_…   (ajenas)
✓ .env presente
== init OK ==
INIT_EXIT=0
```

**Los números cuadran con la bitácora, y los `skipped` los miré uno a uno** (que es donde el gate
sabe mentir):

- Los **26** salen de **dos** archivos ajenos y anteriores: `AnaliticaPage.test.tsx` (17, línea
  1035 del log) y `AnaliticaShell.test.tsx` (9, línea 7874). **Esta ficha no añade ni un
  `skipped`.**
- **`tests/integration/db` NO saltó**: conté **210** archivos distintos de ese directorio
  ejecutados en el log, y `ls tests/integration/db/*.test.ts | wc -l` da **210**. Sin el `.env`
  copiado esos 210 se saltan y el gate «pasa» sin haber tocado Postgres.
- 1776 archivos y 25 401 tests, idénticos a los que declaró T7. La cuenta del implementador
  (25 380 del backend + 21 de la pantalla) cuadra.

### Las mutaciones — los números reales que medí

Cada una: copia del archivo al scratchpad → mutación con `sed` → suite → copia de vuelta. **Nunca
`git checkout`.** Baseline antes de empezar, sobre los 9 archivos de la ficha:
`Test Files 9 passed (9) · Tests 153 passed (153)`. Al terminar, `git diff` **vacío**.

| # | Mutación | Archivo | Rojos que medí | Lo que declaró la bitácora |
| --- | --- | --- | --- | --- |
| M1 | `normalize("NFC")` → `normalize("NFKC")` sobre la cadena entera | `lib/utils/texto-imprimible-etiqueta.ts` | **4** — `(c) ½`, `(d) ™ … m²`, `(R7) 𝛂`, «los 219 entran y salen IDÉNTICOS» | 4 ✔ |
| M2 | `for…of base` → `for…of base.split("")` | idem | **21 en 4 archivos** (de ellos **10** en `texto-imprimible-etiqueta.test.ts`, que es el conjunto que él midió) | 10 ✔ (mismo archivo) |
| M3 | Quitar los aislantes bidi de `aislado` | `lib/utils/mensaje-caracter-no-imprimible.ts` | **14 en 5 archivos**, incluido `EtiquetasGuiaModal.test.tsx` › «un caracter de control no puede reordenar el aviso que lo denuncia» —**el test de la 382**— | 11 en 3 ✔ (yo corrí más archivos) |
| M4 | `<bdi>` → `<span>` en el preview | `OrdenesCargaPreview.tsx` | **1** — «los dos textos van AISLADOS en `<bdi>`…» | 1 ✔ |
| M5 | Borrar `delete fila.textoNormalizado` | `lib/services/BulkOrdenService.ts` | **1** — «una fila reparada que la base descartó queda `duplicada` y SIN `textoNormalizado`» | 1 ✔ |
| M6 | Añadir `notas` a `CAMPOS_TEXTO_ETIQUETA` | idem | **1** — «un emoji SOLO en `notas`…» | 1 ✔ |
| M7 | Desactivar la rama `reparado` de la corrección | `CorregirDatosClienteService.ts` | **2** — «`𝕠rfirio` → `validation_error`…» y «la `ñ` descompuesta…» | 2 ✔ |
| M8 | `cobertura: COBERTURA` → `COBERTURA.map((r) => r)` (mismo contenido, **otro objeto**) | `lib/pdf/etiquetas-fuente.ts` | **1** — «R1 — y es LA MISMA cobertura…, el mismo objeto» | *(mutación mía, no estaba en la lista)* |
| M9 | Añadir el rango `[0x1f642, 0x1f642]` a `COBERTURA` (la mutación que pide R1) | `lib/pdf/etiquetas-fuente-cobertura.ts` | **9 en 3 archivos**: el veredicto de la validación de entrada **cambia con la cobertura** (el emoji pasa a imprimible) y además cae `etiquetas-fuente.test.ts` › «R29 — COBERTURA coincide EXACTAMENTE con lo que el archivo cubre» | *(mutación mía)* |

**Ninguna mutación sobrevivió.** Las siete de la bitácora se reproducen; las dos que añadí cierran
R1 y R2 por los dos lados: una sola definición **y** derivada del `.ttf`.

### Idempotencia del generador (T1.1)

Corrí `pnpm exec tsx scripts/fuente-etiqueta-a-base64.ts` sobre el árbol commiteado:

```
bytes      : 16944      base64 : 22592 chars
cobertura  : 219 code points en 19 rangos
escrito    : lib/pdf/etiquetas-fuente-cobertura.ts
escrito    : lib/pdf/etiquetas-fuente.ts
```

…y `git diff` quedó **vacío**. O sea: los dos artefactos commiteados son **exactamente** la salida
del script; nadie los tocó a mano. **282/R29 intacto.**

---

## Los cuatro puntos que se pidió mirar con lupa

### 1. «Lo cubierto no se toca jamás» — **CONFIRMADO**, y la medición del `µ` es correcta

El código lo hace por construcción (`lib/utils/texto-imprimible-etiqueta.ts:109`): si
`cubreCodePointEn(COBERTURA, codePoint)` el carácter se **copia tal cual** y se sigue; la
normalización se aplica **al carácter**, nunca a la cadena. Verifiqué las dos afirmaciones que
sostienen la decisión A1, en el runtime, no de memoria:

```
micro U+00B5 NFKC -> "μ"   cp=U+3BC      ← griega, y COBERTURA salta de 0x02DC a 0x2013
media U+00BD NFKC -> "1⁄2"  U+31 U+2044 U+32  ← U+2044, y COBERTURA salta de 0x203A a 0x20A1
```

Las dos quedan **fuera** de la cobertura, así que un `NFKC` a ciegas convertiría en rechazo nuevo
un «5 µg» y un «1½ kg» que hoy salen impresos. **La mutación M1 lo confirma con 4 rojos**, entre
ellos el barrido de los 219. El hallazgo del `µ` **no estaba en el design** (que esperaba ocho) y
es el más realista de los nueve: un `producto` con microgramos es más probable que una fracción.

### 2. Una sola definición de «imprimible» — **CONFIRMADO, por identidad referencial**

`tests/unit/guards/etiqueta-fuente-diferida.guardia.test.ts:200`:

```ts
expect(COBERTURA).toBe(fuenteEtiqueta.cobertura);
```

Es `toBe`, no `toEqual`. Y el origen lo respalda: `lib/pdf/etiquetas-fuente.ts:37` escribe
`cobertura: COBERTURA,` — la constante importada, sin copiar.

**No me fié de leerlo: lo maté.** Cambié esa línea por `cobertura: COBERTURA.map((r) => r)` —dos
arrays con **el mismo contenido** y distinta identidad— y el test se puso **rojo** (M8). Es decir,
la garantía existe de verdad: el día que alguien copie la lista en vez de referenciarla, la
guardia lo dice. Y por el otro lado, M9 demuestra que **la cobertura manda**: al añadirle un rango
cambió el veredicto de la validación de entrada (9 rojos), que es exactamente la mutación que
`requirements.md` exige para R1.

### 3. La trampa de bundle — **CONFIRMADO, y verificado sin la guardia**

La guardia 282/R13 solo busca el especificador literal, así que **no me fié de ella**. Recorrí los
importadores a mano:

- El artefacto pesado `lib/pdf/etiquetas-fuente.ts` lo nombran en producción **exactamente dos**
  archivos: `app/(app)/ordenes/_components/etiquetas-fuente-carga.ts:37` con `await import(…)`
  (dinámico) y `lib/pdf/etiquetas-pdf-lote.ts:9` (servidor). Este último solo lo importa
  `lib/services/EtiquetasLotePdfService.ts`, sin ninguna llegada desde `app/` ni `components/`.
- **El corte vive en `BulkOrdenService.resolveFila`**, no en el schema: `evaluarTextoDeEtiqueta`
  tiene **dos** importadores de producción, `lib/services/BulkOrdenService.ts:19` y
  `lib/services/CorregirDatosClienteService.ts:31`. Ninguno viaja al navegador.
- `lib/types/carga-masiva.ts` —el que sí viaja, por `findMissingHeaders`— **no importa nada de
  `lib/pdf/`**. Comprobado en el archivo, no solo en la guardia.
- El único módulo de `app/` que gana un import nuevo es `EtiquetasGuiaModal.tsx`, y llega a
  `lib/pdf/etiquetas-fuente-registro` —que **ya importaba** desde la 382— cuyo único import es
  `import type { jsPDF }`, borrado en compilación. Peso añadido: **cero**.

Y la partición se aguanta sola: `etiquetas-fuente-cobertura.ts` son 19 rangos y la guardia afirma
que no contiene ninguna tirada de base64 de 200+ caracteres y que el archivo mide <4096 chars.

### 4. Los aislantes bidi — **CONFIRMADOS en las dos capas**

- En el **mensaje** (servidor): `aislado()` envuelve en `⁨`/`⁩` **escapados**, y el test
  lo afirma **por code point** (`[0x2068, 0x78, 0x2069]`), no por substring. Quitarlos → **14
  rojos en 5 archivos**, y entre ellos cae el test de la **382** («un caracter de control no puede
  reordenar el aviso que lo denuncia»): la extracción a `lib/` **no** se llevó por delante la
  lección de aquella ficha.
- En la **pantalla**: `<bdi>` en `OrdenesCargaPreview.tsx`, con el test que lee
  `alerta.querySelectorAll("bdi")` y compara con los dos literales. `<bdi>` → `<span>` = **1
  rojo**.

### 5. `for…of` frente a `split("")` — **CONFIRMADO**

El recorrido es por code point y el test lo clava sobre las **dos** unidades UTF-16
(`r.culpable.length === 2` y `codePointAt(0) === 0x1F642`). La mutación da **10 rojos** en el
módulo (21 si se cuenta la cascada a servicios e integración).

### 6. Aserciones contra su propia fuente — **no encontré ninguna**

Al contrario: el patrón correcto está aplicado de forma consciente y explicada.

- Los esperados son **literales escapados** (`"\u{1D560}rfirio"` → `"orfirio"`), nunca el
  resultado de llamar a la función bajo prueba.
- `tests/integration/carga-masiva-errores-roundtrip.test.ts` declara el mensaje como constante
  literal y **luego lo ancla** al emisor con un test aparte («el literal de este test ES el
  mensaje que emite el backend»). Es justo la forma que evita el problema.
- Los dos barridos (219 y 1024) **afirman un conteo** además del contenido y no llevan ningún
  `if (…) return;`, así que no pueden reportar `passed` sin haber evaluado nada.
- R17 se clava sobre **el doble del repositorio**: `expect(corregirDatosCliente).not.toHaveBeenCalled()`,
  no sobre el `status`. Es lo que pedía el design §9.
- El único punto donde una aserción deriva de la fuente es la lista de los 219 code points, que
  sale de `COBERTURA` — y **tiene que ser así** (R1 prohíbe una segunda lista); el conteo `219` va
  como literal y hace de puerta, como demostró M9.

### 7. La corrección de datos NO quedó a medias — **CONFIRMADO**

Es la mitad «alta manual» de la ficha y está entera:

- El rechazo está en el bloque 5.b, **antes** de la geografía y de cualquier escritura, y solo
  sobre los campos que **efectivamente cambian** (hay test de que un dato viejo roto no bloquea la
  corrección de su vecino).
- La respuesta viaja por `fieldErrors`, y el modal ya pinta las cuatro claves:
  `CorregirDatosClienteModal.tsx:563-567` lee `destinatario`, `telefonoDest`, `producto` y
  `direccion`. **Cero UI nueva y cero contrato nuevo**, como decía el design.
- Verifiqué la premisa que lo justifica: en todo el repo hay **tres** llamadas de escritura de
  estos campos (`createManyOrdenesConGuia` ×2 en `BulkOrdenService`, `corregirDatosCliente` ×1 en
  `CorregirDatosClienteService`) y **las tres** quedan detrás de la puerta. No hay una cuarta
  superficie olvidada.

---

## Trazabilidad `R<n> → test`, recorrida

| R | Test que lo verifica | Comprobado |
| --- | --- | --- |
| R1 | `etiqueta-fuente-diferida.guardia.test.ts` › «es LA MISMA cobertura…, el mismo objeto» (`toBe`) | **M8** (copia ≠ identidad) y **M9** (añadir rango cambia el veredicto): 1 y 9 rojos |
| R2 | `etiquetas-fuente.test.ts` › «R29 — COBERTURA coincide EXACTAMENTE con lo que el archivo cubre» | M9 lo pone rojo; y regenerar no cambia ni un byte |
| R3 | guardia ampliada (3 aserciones) | verificado **a mano**, sin la guardia: ni un camino estático desde `app/`/`components/` al artefacto |
| R4 | `(c) ½`, `(d) ™ … m² ¼ ¾ ´¨`, `(g) ñ`, barrido 219 | **M1**: 4 rojos |
| R5 | `(a) 𝕠rfirio→orfirio`, `(b) ﬁn→fin` | literales escapados; leído |
| R6 | `(e)` emoji, `(f)` cirílico, par suplente | **M2**: 10 rojos en el módulo |
| R7 | barrido U+1D400–U+1D7FF con **702/322** aseverados | conteo literal, sin salida temprana |
| R8 | barrido de los **219** con `evaluados === 219` | **M1** lo mata |
| R9 | `createData.destinatario === "orfirio"` + los otros tres campos | afirma sobre lo que recibe el repositorio, no sobre el `status` |
| R10 | `textoNormalizado` literal (1 y 2 avisos) + `CargaMasivaClasificacion` + `OrdenesCargaPreview` | la pantalla lo pinta; R10 **completo** tras T7 |
| R11 | dry-run vs firme, **con el contenido del aviso aseverado como literal** | no es una comparación vacía de dos corridas iguales |
| R12 | remisión double-struck → error; `(h) reparar:false` | leído |
| R13 | error bajo la clave de la columna, dos claves, lote de 3 | + round-trip de chips y XLSX |
| R14 | los tres mensajes, **literales completos**, y el aislado por code point | **M3**: 14 rojos |
| R15 | tres casos espejo por API key | estructural además: `resolveFila` se llama en `:186` (sesión) y `:412` (API key) |
| R16 | emoji solo en `notas` → creada, notas intactas | **M6**: 1 rojo |
| R17 | el doble **no recibe ninguna escritura** | leído; es la forma correcta |
| R18 | sugerencia dentro del mensaje, literal | **M7**: 2 rojos |
| R19 | corregir solo `notas` → `ok` | leído |
| R20 | `EtiquetasGuiaModal.test.tsx` **sin tocar** + `tests/unit/pdf/**` | verdes en el baseline; **M3** los pone rojos |
| R21 | `toEqual` del `BulkSummary` completo + `delete textoNormalizado` | **M5**: 1 rojo |

**Los 21 mapean a un test real y no vacío.** Ninguno se apoya en un test que se autoaprueba.

---

## Hallazgos

### BLOQUEANTE 1 — `specs/383/tasks.md` está **0 de 31** marcada

`CHECKPOINTS.md` lo exige literalmente («todas las tasks estan marcadas `[x]`») y el repo lo
cumple en la ficha comparable más reciente (`specs/377-…/tasks.md`: **41 de 41**).

**Qué falta para cumplirlo:** marcar T0–T3 y T5–T8, que están hechas y verificadas; y resolver los
dos casos que **no se pueden marcar honestamente hoy** —T4.1 (BLOQUEANTE 2) y T9 (`menor` 6)—, o
reescribirlos en `tasks.md` con lo que realmente aplica. No toca una línea de código.

### BLOQUEANTE 2 — T4.1, la puerta de aprobación humana, **no la cruzó un humano**

`tasks.md` T4.1 dice, con todas las letras: *«Antes de tocar `BulkOrdenService` y
`CorregirDatosClienteService`, **el humano** tiene que responder **Q1** … y confirmar o revocar
**A2** y **A3**»*, y su «Hecho cuando» es *«la respuesta está escrita en `progress/current.md`»*.

Lo que hay medido:

- `progress/current.md` **no menciona 383** ni en esta rama ni en `origin/dev`.
- `progress/impl_383.md` lo dice él mismo, con honestidad: *«se cruzó con Q1 respondida … La
  respuesta del leader llegó por el encargo»*. Las siete decisiones de su tabla llevan **«leader»**
  en la columna «quién», y ninguna «humano».
- El spec las clasifica como **«asunción del leader, NO firmadas por el humano»**.

**Por qué importa y no es burocracia:** Q1 decide que **Ordenex guarda un nombre que la tienda no
escribió** (`𝕠rfirio` → `orfirio`). El propio `requirements.md` escribe la alternativa honesta
—rechazar también en la carga y que la tienda corrija su archivo, con el round-trip del XLSX que ya
existe— y la deja como decisión del humano. Es un cambio de dato de cliente, no un detalle de
implementación. Q2 (el `NFC` previo) va en el mismo saco: el spec dice expresamente *«No se ha
metido para no ampliar el alcance sin firma»*, y se metió.

**Qué falta:** que el humano responda Q1 y ratifique o revoque A2/A3 (y de paso Q2), y que quede
escrito. La vuelta atrás de cada una está en la tabla de asunciones del spec y es barata: Q1 cambia
R9/R10; A2 cambia un retorno; A3 mueve una constante. **Nada de esto es un defecto del código; es
una firma que falta.**

### menor 1 — La sugerencia de R18 es **visualmente idéntica** al texto rechazado

Con una `ñ` descompuesta (`n` + U+0303, lo que produce macOS al copiar), la corrección responde:

> `«destinatario» lleva un carácter que la etiqueta no puede imprimir: «⁨◌̃⁩» (U+0303).
> Escríbelo así: «Nuñez».`

…y ese «Nuñez» se **pinta exactamente igual** que lo que la persona acaba de teclear. Le decimos
«escríbelo así» enseñándole lo mismo que ve. Está afirmado en un test
(`corregir-datos-cliente-texto-etiqueta.test.ts` › «y la `ñ` descompuesta también se rechaza»), así
que es intencional, pero es un mensaje que va a generar un ticket.

**Y no es simétrico:** la carga masiva **sí** compone esa `ñ` y la deja pasar (con aviso). La misma
entrada, dos superficies, dos desenlaces —y en la que hay una persona delante, el desenlace es el
inútil—. *Recomendación, no defecto:* cuando la única diferencia sea **canónica**
(`valor === texto.normalize("NFC")`) la corrección podría aceptarla sin más; NFC no cambia la
identidad de ningún carácter, así que no viola A2 —«Ordenex nunca guarda un nombre que el humano no
haya tecleado»: con NFC **es** el mismo nombre—. Es una línea, y hoy no rompe nada.

### menor 2 — `design.md §7` se equivoca sobre el gate rápido

Dice: *«El gate rápido no se debería negar con este diff (no toca … `lib/types/` de dominio …)»*.
Pero el diff **sí** toca `lib/types/carga-masiva.ts`, y `docs/verification.md` pone `lib/types/**`
en la lista de rutas ante las que `--rapido` **falla**. Sin consecuencia práctica —se corrió el
completo, dos veces por el implementador y una más por mí—, pero la frase del design es falsa y
alguien la puede leer como permiso.

### menor 3 — T4.1 pedía `progress/current.md` y la decisión acabó en `feature_list.json`

Las respuestas de Q1/Q2/Q4/Q5 **sí** están escritas, pero en el `status_note` de la ficha 383 en
`feature_list.json` de `origin/dev`, no donde la tarea pedía. El motivo que da la bitácora es
razonable (`current.md` es del leader y hay agentes en paralelo). Es una discrepancia de sitio, no
de sustancia; se arregla al cerrar BLOQUEANTE 2.

### menor 4 — El invariante `direccionLiteral === data.direccion` vive en un comentario

`BulkOrdenService.ts:876` escribe
`direccion: reparados.direccion ?? (direccionLiteral === "" ? null : direccionLiteral)`, apoyado en
que los dos son «el MISMO `.trim()` del mismo crudo». **Lo comprobé y hoy es cierto** por las tres
vías (`geoInputDesdeCantonDistrito:90`, `geo-resolucion.ts:227` y el schema
`direccion: z.string().trim()…`), y hay un test que lo cubre por la vía de sesión
(`creada.direccion === "avenida invierno"`). Pero si mañana un extractor recorta distinto, la
reparación se aplicaría sobre un texto y se escribiría otro **sin poner nada rojo por la vía API
key**, que no tiene ese caso. Una aserción espejo en `cargarViaApi` lo cerraría.

### menor 5 — Un rechazo de texto **tapa** el error de geografía de la misma fila

El bloque nuevo retorna antes de resolver geografía, así que una fila con un emoji **y** una
provincia inválida reporta solo el error de texto. Es coherente con el diagrama del design §5.2 y
la fila acaba en `error` igual, pero la tienda corrige una celda, re-sube y descubre la segunda.
Antes de esta ficha ese caso no existía (el emoji entraba), así que no es regresión.

### menor 6 — **T9 sigue sin hacer**, y es la única verificación de app que hay

No hay harness E2E en este repo, así que el checkpoint de Playwright es inaplicable; el sustituto
que el spec define es T9 y **nadie ha mirado la app**. Está medido en este repo que mirar la app
encuentra lo que la suite no. Lo que hay que hacer, tal cual: subir un XLSX de tres filas —una
normal, una con el destinatario en double-struck y una con un emoji en la dirección—, leer el
preview, confirmar, e imprimir la etiqueta de la reparada. **Es del humano, no del implementador.**

### menor 7 — Falta la entrada de 383 en `progress/history.md`

Pendiente de cierre (la escribe el leader), no deuda de la rama.

---

## Lo que está bien, y merece decirse

- **El hallazgo que corrige el encargo.** La ficha pedía `NFKC`; el backend midió que a ciegas
  **rompe** nueve code points que hoy imprimen, encontró el noveno que el design no preveía —`µ` →
  `μ` griega, «5 µg»— y en vez de obedecer la letra, cambió la regla y lo dejó escrito con su
  medición. Es exactamente lo que pide `docs/verification.md`.
- **La partición del artefacto.** El agujero que cerró —una llegada **transitiva** por
  `lib/types/carga-masiva.ts` que habría metido 22 592 caracteres de base64 en el bundle inicial de
  `/ordenes` **sin poner nada rojo**— es un fallo mudo de manual, y no lo detectaba ninguna guardia.
  Lo vio antes de escribir la primera línea.
- **La identidad referencial de la cobertura** en vez de un `toEqual`. Es la diferencia entre «hoy
  coinciden» y «no pueden divergir». Sobrevive a mi mutación.
- **La disciplina de `montoAjustado` copiada entera**, incluido el `delete` en
  `reclasificarOmitidas` — la lección de la 294 aplicada sin que nadie la pidiera dos veces.
- **La limitación de los chips se convierte en test.** Midió que el arreglo obvio **no arregla**
  (canonizar `«…»` deja los dos chips en dos) y dejó el test que fija la limitación con las
  instrucciones para el que la resuelva. Es la forma correcta de no esconder una deuda.
- **Los tests no se autoaprueban.** Literales escapados, conteos aseverados, dobles que se
  interrogan por lo que NO recibieron, y el mensaje del round-trip anclado a su emisor en un test
  aparte.
- **Cero migraciones y cero contrato nuevo** donde no hacía falta: la clave viaja solo cuando hay
  cambio, y una carga normal devuelve el resumen de antes, byte a byte.

---

## Qué hace falta para que esto sea `OK`

1. Que el humano responda **Q1** y ratifique o revoque **A2**, **A3** (y Q2), y que quede escrito.
2. Marcar `specs/383-…/tasks.md`, con T4.1 y T9 resueltos o reescritos.
3. *(al cerrar)* T9 mirado, entrada en `progress/history.md`, `feature_list.json` a `done`.

**Ni uno solo de estos pasos toca código.** El diff, tal como está, lo doy por bueno.

---

*Revisión del 2026-09-07. Gate propio: `INIT_EXIT=0`, 1776 archivos, 25 401 tests, 26 `skipped`
ajenos, 210/210 archivos de `tests/integration/db` ejecutados. Nueve mutaciones aplicadas al árbol
real y revertidas desde copia; árbol limpio al terminar; el `.env` copiado se borró.*
