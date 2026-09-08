# 383 — Normalizar al entrar los caracteres que la etiqueta no puede imprimir · tasks

> Leer antes: `requirements.md` (R1–R21 + las 6 asunciones sin firmar) y `design.md`.
> `[P]` = paralelizable con las tareas de su misma tanda.
> **Zona `fullstack`: se secuencia backend → frontend.** T0–T6 y T8 son backend; T7 es frontend.
> **Ninguna migración**: si alguien acaba escribiendo una, es que se ha salido del diseño.

---

## T0 — La medición que justifica el diseño (bloquea T2)

- [ ] **T0.1 — Medir qué hace `NFKC` sobre los 219 code points cubiertos.**
  Script de un solo uso (o test que imprime): recorrer `COBERTURA` code point a code point, aplicar
  `String.fromCodePoint(cp).normalize("NFKC")` y listar los que **dejan de estar cubiertos**.
  **Hecho cuando:** la lista está pegada en `progress/impl_383.md` con su conteo, y confirma o
  corrige lo que `design.md §3.2` espera (`¼ ½ ¾ ´ ¨ ¯ ¸ ˜`). Si el conteo saliera **0**, la
  justificación de A1 se cae y hay que **parar y avisar al humano** antes de seguir.
  *(evidencia de R4/R8)*

- [ ] **T0.2 [P] — Medir el bloque U+1D400–U+1D7FF.** Cuántos code points del bloque reparan a un
  carácter cubierto y cuántos no (los griegos).
  **Hecho cuando:** los dos conteos están en `progress/impl_383.md`, y `𝕠` (U+1D560) figura entre los
  reparables y `𝛂` (U+1D6C2) entre los no reparables.
  *(evidencia de R7)*

---

## T1 — Partir el artefacto de fuente (bloquea T2)

- [ ] **T1.1 — `scripts/fuente-etiqueta-a-base64.ts` emite dos archivos.**
  `lib/pdf/etiquetas-fuente-cobertura.ts` (solo `export const COBERTURA`, con la cabecera «ARCHIVO
  GENERADO — NO EDITAR A MANO») y `lib/pdf/etiquetas-fuente.ts` (importa `COBERTURA`, conserva
  `PESO_DECLARADO_*` y `fuenteEtiqueta`).
  **Hecho cuando:** correr el script no cambia ni un byte de la cobertura efectiva (`COBERTURA` es
  `toEqual` a la de hoy) y `git diff` de `etiquetas-fuente.ts` solo muestra el import y la línea
  borrada. *(R2)*

- [ ] **T1.2 — Abrir el predicado por su parámetro.** En `lib/pdf/etiquetas-fuente-registro.ts`:
  `type Cobertura`, `cubreCodePointEn`, `caracterNoCubiertoEn`, `cubreTextoEn`; los tres actuales
  quedan como envoltorios de una línea sobre `fuente.cobertura`.
  **Hecho cuando:** **cero** call sites tocados y `tests/unit/pdf/etiquetas-fuente.test.ts` verde sin
  modificarlo. *(R1)* · **depende de T1.1**

- [ ] **T1.3 — Ampliar la guardia de carga diferida.**
  `tests/unit/guards/etiqueta-fuente-diferida.guardia.test.ts` gana una aserción: ni
  `lib/utils/texto-imprimible-etiqueta.ts` ni `lib/types/carga-masiva.ts` nombran el ARTEFACTO
  (`'"@/lib/pdf/etiquetas-fuente"'`), y `lib/pdf/etiquetas-fuente-cobertura.ts` **no contiene**
  `base64`.
  **Hecho cuando:** el test falla si se le añade a `texto-imprimible-etiqueta.ts` un import del
  artefacto (mutación aplicada y revertida). *(R3)* · **depende de T1.1**

---

## T2 — El módulo puro (bloquea T3, T5, T6)

- [ ] **T2.1 — `lib/utils/texto-imprimible-etiqueta.ts`.** `evaluarTextoDeEtiqueta(texto, { reparar })`
  con el contrato de `design.md §4`. Recorrido **por code point** (`for…of`). Sin listas propias de
  caracteres, sin Prisma, sin React.
  **Hecho cuando:** typecheck verde y existen los tests de T2.2/T2.3. *(R4, R5, R6)* · **depende de
  T1.2**

- [ ] **T2.2 — Tests de la regla, con literales.**
  Casos: (a) `"\u{1D560}rfirio"` → `"orfirio"`; (b) `"ﬁn"` → `"fin"`; (c) `"½"` → **intacto**;
  (d) `"™"`, `"…"`, `"m²"` → **intactos**; (e) `"🙂"` → irreparable, `codePoint === 0x1F642`;
  (f) `"Ана"` (cirílico) → irreparable; (g) `"ñ"` precompuesta → intacta; (h) `reparar: false` sobre
  un reparable → devuelve irreparable, no lo repara.
  **Hecho cuando:** los 8 casos verdes y los esperados son **literales escapados**, nunca el
  resultado de llamar a la propia función. *(R4, R5, R6, R12)* · **depende de T2.1**

- [ ] **T2.3 [P] — Los dos barridos, sin salida temprana.**
  (a) los **219** code points cubiertos entran y salen idénticos, y el test afirma que evaluó 219;
  (b) el bloque U+1D400–U+1D7FF completo: cada code point o repara a algo cubierto o se rechaza, con
  los dos conteos de T0.2 como aserción, más los casos nombrados `𝕠` y `𝛂`.
  **Hecho cuando:** verdes, sin ningún `if (…) return;` dentro, y con el conteo aseverado.
  *(R7, R8)* · **depende de T2.1, T0.1, T0.2**

- [ ] **T2.4 [P] — Par suplente.** `"\u{1D560}"` se trata como **un** carácter: el `culpable` de un
  texto irreparable con un emoji tiene `length === 2` y su `codePointAt(0)` es el real.
  **Hecho cuando:** verde, y una mutación que cambie el `for…of` por `split("")` lo pone rojo.
  *(R6)* · **depende de T2.1**

---

## T3 — El mensaje, en un solo sitio (bloquea T5, T6)

- [ ] **T3.1 — `lib/utils/mensaje-caracter-no-imprimible.ts`.** `aislado(caracter)` (con `⁨` y
  `⁩` **escapados**) y `fraseCaracterNoImprimible(caracter, codePoint)`.
  **Hecho cuando:** test que afirma los dos aislantes y la notación `U+XXXX` sobre un carácter de
  ancho cero (`U+200B`). *(R14)*

- [ ] **T3.2 — El modal de la 382 compone desde el fragmento compartido.**
  `EtiquetasGuiaModal.tsx` deja de tener su propio `aislado` y usa el de `lib/`.
  **Hecho cuando:** `tests/components/EtiquetasGuiaModal.test.tsx` sigue **verde sin tocarlo**: el
  literal de la 382 no cambia ni un byte. *(R20)* · **depende de T3.1**

---

## T4 — Punto de decisión: parar y preguntar

- [ ] **T4.1 — Puerta de aprobación.** Antes de tocar `BulkOrdenService` y
  `CorregirDatosClienteService`, el humano tiene que responder **Q1** (¿reparar o rechazar en la
  carga?) y confirmar o revocar **A2** (la corrección rechaza) y **A3** (`num_remision` no se
  repara). T5 y T6 dependen de esa respuesta.
  **Hecho cuando:** la respuesta está escrita en `progress/current.md`. · **depende de T2, T3**

---

## T5 — Carga masiva, las dos vías (backend)

- [ ] **T5.1 — Contrato de salida.** `lib/types/carga-masiva.ts`: `TextoNormalizado` y
  `RowResult.textoNormalizado?`. Sin importar nada de `lib/pdf/`.
  **Hecho cuando:** typecheck verde y T1.3 sigue verde. *(R10)* · **depende de T4.1**

- [ ] **T5.2 — El corte en `resolveFila`.** Tras `filaCargaSchema.safeParse`, sobre `parsed.data`:
  `num_remision` con `reparar: false`; `destinatario`/`telefono`/`producto`/`direccion` con
  `reparar: true`. Se evalúan **todos** antes de decidir. Los reparados entran en `createData`.
  **Hecho cuando:** tests unitarios de `BulkOrdenService` con dobles: (a) fila con `𝕠` en
  destinatario → `creada`, y **`createData.destinatario === "orfirio"`**; (b) fila con emoji →
  `error` bajo la clave `destinatario`; (c) fila con `num_remision` double-struck → `error`;
  (d) lote de 3 con la del medio rota → 2 creadas + 1 error; (e) fila con dos campos rotos → **dos**
  claves en `errores`. *(R9, R12, R13)* · **depende de T5.1**

- [ ] **T5.3 — El aviso viaja en la fila.** La fila `creada` reparada trae `textoNormalizado` con
  `campo`, `original` y `aplicado`.
  **Hecho cuando:** test que lo afirma como literal, y **mutación**: borrar la emisión del aviso →
  rojo. *(R10)* · **depende de T5.2**

- [ ] **T5.4 — `reclasificarOmitidas` borra también el aviso.** Añadir
  `delete fila.textoNormalizado` junto al `delete fila.montoAjustado` existente.
  **Hecho cuando:** test «una fila reparada que resulta omitida por carrera queda `duplicada` y
  **sin** `textoNormalizado`». Es la lección de la 294 y **no** es opcional. *(R21)* · **depende de
  T5.3**

- [ ] **T5.5 [P] — Campos NO evaluados.** Test: fila con un emoji **solo** en `notas` → `creada`, y
  las notas se guardan con el emoji **intacto**. Ídem `provincia`/`canton_distrito` no evaluados por
  este camino.
  **Hecho cuando:** verde, y una mutación que añada `notas` a la lista lo pone rojo. *(R16)* ·
  **depende de T5.2**

- [ ] **T5.6 [P] — Vía API key, espejo.** Los mismos casos de T5.2/T5.3 sobre `cargarViaApi`: los
  errores salen en `summary.errores[]` y el aviso en `summary.filas[]`.
  **Hecho cuando:** verde. **Mutación obligatoria** (la lección M4b de la 382): aplicar la
  comprobación **solo** en `cargarMasiva` → el test de la vía API tiene que ponerse rojo. *(R15)* ·
  **depende de T5.2**

- [ ] **T5.7 [P] — Dry-run = carga real.** Test que corre el **mismo** lote con `dryRun: true` y
  `dryRun: false` y afirma que la clasificación por fila y los avisos son **iguales**.
  **Hecho cuando:** verde, y una mutación que salte la comprobación cuando `dryRun` lo pone rojo.
  *(R11)* · **depende de T5.2**

- [ ] **T5.8 [P] — No regresión.** Test con un lote **sin** ningún carácter fuera de cobertura: el
  `BulkSummary` es idéntico al de antes (ninguna clave nueva en ninguna fila).
  **Hecho cuando:** verde con `toEqual` sobre el objeto completo. *(R21)* · **depende de T5.2**

---

## T6 — Corrección de datos del cliente (backend)

- [ ] **T6.1 — El rechazo en el bloque 5.b.** En `CorregirDatosClienteService.corregir`, junto a
  `CAMPOS_NO_VACIABLES`: solo sobre los campos que **cambian**, solo
  `destinatario`/`telefonoDest`/`producto`/`direccion`, **antes** de la geografía y de cualquier
  escritura.
  **Hecho cuando:** test con doble de repositorio que afirma (a) `validation_error` con la clave del
  campo, y (b) **que el doble no recibió ninguna llamada de escritura** — no basta con mirar el
  status. *(R17)* · **depende de T4.1**

- [ ] **T6.2 — La sugerencia en el mensaje.** Texto reparable → `validation_error` cuyo mensaje
  contiene el valor reparado (`orfirio`), y **nada** se guarda.
  **Hecho cuando:** verde con el literal, y mutación «aplicar la reparación y devolver `ok`» → rojo.
  *(R18)* · **depende de T6.1**

- [ ] **T6.3 [P] — `notas` fuera.** Corregir **solo** `notas` con un emoji → `ok` y se guarda.
  **Hecho cuando:** verde. *(R19)* · **depende de T6.1**

- [ ] **T6.4 [P] — Nada más cambia.** Los tests vivos de las fichas 312/327/362 siguen verdes sin
  tocarlos, incluida `tests/unit/guards/corregir-datos-sin-rastro.guardia.test.ts`.
  **Hecho cuando:** verdes. · **depende de T6.1**

---

## T7 — Frontend (después de T5)

- [ ] **T7.1 — `carga-masiva-clasificacion.ts` transporta el aviso.** Nueva vista `normalizadas`,
  con los mismos guardas defensivos que `ajustadas` (descartar si `original === aplicado`, si falta
  alguno o si no son strings). **No** es un cuarto grupo: los tres conteos no cambian.
  **Hecho cuando:** test con `data` basura (no-objeto, `filas` no-array, entrada incompleta) → grupos
  vacíos y sin lanzar. *(R10)* · **depende de T5.3**

- [ ] **T7.2 — La línea del preview.** `OrdenesCargaPreview.tsx`, dentro del mismo `Alert` del aviso
  de céntimos: singular y plural, con un ejemplo `«original» → «aplicado»`. Vacío ⇒ no se pinta nada.
  **Hecho cuando:** test de componente que afirma el texto renderizado con una fila normalizada, y
  que **no** aparece nada con cero. *(R10, R11, R21)* · **depende de T7.1**

- [ ] **T7.3 [P] — Los chips y el export no se tocan.** Verificar que una fila en error por carácter
  no imprimible produce chip y aparece en el XLSX de errores con su `motivo_error`, **sin** cambiar
  `carga-masiva-error-chips.ts` ni `carga-masiva-export-errores.ts`.
  **Hecho cuando:** test de round-trip verde y el `git diff` de esos dos archivos **vacío**. *(R13)* ·
  **depende de T5.2**

---

## T8 — Cierre

- [ ] **T8.1 — Mutaciones.** Aplicar al árbol real, correr la suite relevante, revertir **desde
  copia** (nunca `git checkout`): (1) `NFKC` a la cadena entera; (2) quitar la comprobación de la vía
  API; (3) borrar el `delete fila.textoNormalizado`; (4) `split("")` en el recorrido; (5) devolver
  `ok` en la corrección reparando; (6) añadir `notas` a los campos evaluados; (7) quitar los
  aislantes bidi.
  **Hecho cuando:** las **7 muertas**, cada una con el archivo y el nombre del test que la mató
  escritos en `progress/impl_383.md`. Un arnés que reporte supervivientes sin haber ejecutado nada no
  vale: pegar la salida real.

- [ ] **T8.2 — Gate.** `./init.sh` completo, con `INIT_EXIT=$?` escrito **dentro** del log y en su
  propia línea, sin `tail` en la tubería. Contar los `skipped` y comprobar que
  `integration/db` **no** salta (si salta, falta `.env` y la corrida no vale).
  **Hecho cuando:** `INIT_EXIT=0` con los números pegados en `progress/impl_383.md`.

- [ ] **T8.3 — Informe y trazabilidad.** `progress/impl_383.md` con la tabla `R → test` de abajo ya
  rellenada con los nombres reales, las mediciones de T0 y las asunciones que el humano firmó o
  revocó en T4.1. **Commitearlo** (un informe sin commitear se lo lleva el primer `git checkout`).

- [ ] **T9 — Comprobación humana (no la hace el agente).** Subir un XLSX con tres filas: una normal,
  una con el destinatario en double-struck y una con un emoji en la dirección. Leer el preview,
  confirmar, y luego imprimir la etiqueta de la orden reparada. **Doce mil tests no sustituyen a
  mirar la app** — está medido en este repo.

---

## Mapa R → test

| R | Test |
| --- | --- |
| R1 | T1.2 · `etiquetas-fuente.test.ts` (sin tocar) + el caso «cambiar un rango cambia el veredicto de entrada» |
| R2 | T1.1 · guardia del `.ttf` en `etiqueta-fuente-diferida.guardia.test.ts` |
| R3 | T1.3 · guardia ampliada |
| R4 | T2.2 (c)(d)(g) · T2.3 (a) barrido de los 219 |
| R5 | T2.2 (a)(b) |
| R6 | T2.2 (e)(f) · T2.4 |
| R7 | T2.3 (b) barrido del bloque U+1D400 |
| R8 | T2.3 (a) |
| R9 | T5.2 (a) |
| R10 | T5.3 · T7.1 · T7.2 |
| R11 | T5.7 |
| R12 | T5.2 (c) · T2.2 (h) |
| R13 | T5.2 (b)(d)(e) · T7.3 |
| R14 | T3.1 |
| R15 | T5.6 (con su mutación) |
| R16 | T5.5 |
| R17 | T6.1 (b): el repositorio no recibe escritura |
| R18 | T6.2 |
| R19 | T6.3 |
| R20 | T3.2 (literal de la 382 intacto) · suite de la 382 y de la 282 verdes |
| R21 | T5.4 · T5.8 · T7.2 (con cero) |
