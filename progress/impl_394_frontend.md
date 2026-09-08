# impl 394 — la columna del Excel de cierres pasa a los intentos de ENTREGA (mitad FRONTEND)

**Ficha:** 394 · sin spec (`sdd: false`) · **sin migración** · la mitad de servidor ya está en `dev` (PR #741)
**Rol:** `frontend_dev`. Solo capa de presentación: la declaración de columnas de la hoja y sus
tests. El dato ya llegaba al borde como `CierreGestionDescargaDTO.intentosEntrega`.

---

## El encabezado, tal como sale en el Excel

```
Intentos de entrega
```

Columna **13.ª** de las 31, entre «Tienda» y «Resultado». Es el literal EXACTO —a la letra,
mayúsculas y todo— que ya llevan `novedades-descarga-columnas.ts`, `ayuda-descarga-columnas.ts` y
`lib/manifiesto/etiquetas-columnas.ts`. No se inventó sinónimo: que la misma cosa se llame igual
en las cuatro hojas es lo que impide que alguien las compare y crea que son dos datos distintos.

## Qué cambió, exactamente

La columna se **SUSTITUYE**, no se añade al lado:

```diff
- { clave: "intentosContactoTienda", encabezado: INTENTOS_CONTACTO_TIENDA_COL },  // "Intentos de contacto de la tienda"
+ { clave: "intentosEntrega",        encabezado: INTENTOS_ENTREGA_COL },          // "Intentos de entrega"
```

y la celda:

```diff
- intentosContactoTienda: gestion.intentosContactoTienda,
+ intentosEntrega: gestion.intentosEntrega,
```

**El `0` se emite tal cual.** Ni `|| null` ni `?? ""`: un cero es un dato conocido —«nadie ha
intentado entregarla todavía»— y una celda vacía diría «no se sabe». El `?? 0` ya lo resolvió el
borde de datos (el DTO promete un número y nunca `null`), así que aquí no hay nada que defender
salvo no estropearlo. Hay mutación que lo demuestra (M2 y M3, abajo).

**La posición no se movió.** La 13.ª, pegada a «Resultado», sigue siendo la correcta: es un dato
de la ORDEN que siempre se puebla, y «Resultado» tiene que quedar cerrando el bloque de las
catorce que siempre traen dato, porque es la celda que decide cuáles de las diecisiete siguientes
se llenan. Total de columnas: **31 antes y 31 después** — se sustituyó una, no se sumó ninguna.

**Sale igual por las DOS pantallas** («Cierres del día» y «Cierres de bodega»), sin tocar nada de
bodega: las dos consumen la MISMA declaración y el dato viaja por el DTO común (R26). El test de
bodega lo afirma con el número en la mano.

## `intentosContactoTienda` NO se borró

Con este cambio el campo del DTO se queda **sin consumidor de producción**, y eso es correcto y
está decidido: cinco archivos de test lo afirman, su cobertura es ajena a esta ficha, y borrarlo
se los llevaría por delante — en este repo eso ya costó una regresión en producción. Sale además
de la misma consulta que `fechaCreacionOrden`, así que no cuesta ni un round-trip. Sigue muy vivo
lo otro, que es distinto: la columna `orden.intentos_contacto` en /novedades.

En los fixtures los dos contadores llevan **valores distintos a propósito** (5 el mensajero, 3 o 2
la tienda): con los dos iguales, una celda que cogiera el equivocado pasaría en verde — que es
exactamente lo que pasó en la 385.

## La prosa de la cabecera, reescrita

El bloque «LOS INTENTOS SON DE LA TIENDA, Y POR ESO EL ENCABEZADO LO DICE» decía **lo contrario**
de lo que el humano firmó el 2026-09-08. Se reescribió entero como «LOS INTENTOS DE LA COLUMNA SON
LOS DE ENTREGA (ficha 394)», y **sin borrar el rastro**: dice qué había aquí del 2026-09-07 al
2026-09-08, por qué se cambió, y por qué se SUSTITUYE en vez de dejar las dos. Quien vea el nombre
viejo en un archivo descargado en septiembre tiene que poder averiguar aquí qué pasó, en vez de
concluir que se le perdió un dato.

---

## Archivos

### Producción (2)
| Archivo | Qué |
| --- | --- |
| `app/(app)/cierres-admin/_components/cierres-gestiones-fundida-descarga-columnas.ts` | la columna, la celda, la constante (`INTENTOS_CONTACTO_TIENDA_COL` → `INTENTOS_ENTREGA_COL`) y la prosa de la cabecera |
| `lib/interfaces/services/ICierresAdminService.ts` | **solo TSDoc**: el párrafo apuntaba a `INTENTOS_CONTACTO_TIENDA_COL`, que con este cambio deja de existir. Un puntero a un símbolo borrado es una mentira en prosa; se corrigió en tres líneas y no se tocó ni un tipo ni un campo |

### Tests (4)
| Archivo | Qué |
| --- | --- |
| `tests/unit/descarga/cierres-gestiones-fundida-descarga-columnas.test.ts` | la lista literal de 31 claves, la de 31 encabezados, el `toEqual` completo de la fila ENTREGADA, el índice 12, y el bloque de la 385 entero reescrito |
| `tests/components/descarga/CierresBodegaDescargaDetallada.test.tsx` | las aserciones de encabezado y de celda del borde de bodega (R26) |
| `tests/components/descarga/DescargarGestionesDialog.test.tsx` | la aserción de encabezado del diálogo |
| `tests/components/descarga/CierresAdminDescargaDetallada.test.tsx` | solo el comentario del recuento de 31, que nombraba la columna vieja |

**Ninguna aserción se relajó.** Se actualizaron —son el contrato de la hoja— y se **reforzaron**:
donde antes había un `toContain("Intentos de contacto de la tienda")`, ahora hay además un
`not.toContain(...)` de la misma cadena, para que la columna sustituida no pueda volver de
tapadillo. Y ninguna se cambió por su propia fuente: los encabezados se escriben a mano en el
test, nunca leídos de `INTENTOS_ENTREGA_COL` — comparar un texto contra la constante que lo genera
está siempre verde y no prueba nada.

Sin migraciones, sin tocar `feature_list.json` ni `progress/current.md`, sin tocar `components/`.

---

## Trazabilidad (el encargo no tiene `R<n>`; se numeran sus exigencias)

| Exigencia | Test |
| --- | --- |
| **F1** La columna sale de los intentos de ENTREGA | `cierres-gestiones-fundida-…test.ts` › «la columna de intentos es la de ENTREGA y se llama igual que en las otras tres hojas» |
| **F2** El encabezado es el literal «Intentos de entrega» | ídem (literal escrito a mano) · listas literales de 31 claves y 31 encabezados |
| **F3** Se SUSTITUYE: la de la tienda ya no está | `…test.ts` › «la hoja YA NO lleva los intentos de contacto de LA TIENDA (ficha 394)» · `CierresBodegaDescargaDetallada` y `DescargarGestionesDialog` (`not.toContain`) |
| **F4** El `0` se emite, no es un hueco | `…test.ts` › «los intentos salen tal cual, y el CERO se emite en vez de dejar la celda vacía» |
| **F5** La 13.ª posición se conserva y nada más se mueve | `…test.ts` › «las dos nuevas van en su sitio y NINGUNA existente cambia de orden relativo» (índice 12 + lista de contraste de las 29 anteriores) |
| **F6** Los DOS caminos emiten lo mismo (R26) | `CierresBodegaDescargaDetallada.test.tsx` › «descargar aquí llama al borde de BODEGA…» · `cierres-gestiones-paridad.test.ts` |
| **F7** La celda no coge el contador equivocado | los fixtures dan 5 al mensajero y 3/2 a la tienda; lo mide la mutación M1 |

---

## Verificación

### Mutaciones — 3/3 muertas, con autocomprobación

Arnés propio (en `scratchpad`, borrado tras usarse) que **aborta** si el texto a mutar no aparece
exactamente una vez, **aborta** si la mutación no cambió el archivo, **aborta** si la salida de
vitest no trae su línea de resultados —sin corrida no hay veredicto— y **restaura releyendo y
comparando byte a byte**.

```
M1 la celda vuelve a coger el contador de LA TIENDA (el fallo de la 385)  MUERTA  Tests  5 failed | 58 passed  (exit 1)
M2 el 0 se emite como NULO (|| null)                                      MUERTA  Tests  1 failed | 62 passed  (exit 1)
M3 el 0 se emite como CADENA VACIA (|| "")                                MUERTA  Tests  1 failed | 62 passed  (exit 1)
archivo restaurado byte a byte: OK
muertas 3/3
```

**M1 es el defecto original de la 385**, reproducido a la letra: la celda leyendo
`gestion.intentosContactoTienda`. Mata 5 casos en 2 archivos, incluido el del borde de bodega.

**El arnés se autodelató una vez, y eso es la prueba de que sirve.** En la primera corrida tras
reinstalar dependencias, `vitest` dejó de estar en el `PATH` y el arnés **abortó con exit 96**
(«vitest no emitio linea de resultados; sin corrida no hay veredicto») en vez de reportar tres
supervivientes o tres muertas inventadas. Se corrigió la invocación a `pnpm exec` y se repitió.

### Gate

`./init.sh --rapido` no era opción: el diff toca `app/(app)/cierres-admin/…cierres…` —nombre de
dinero— y `lib/interfaces/`. Se corrió el **completo**.

```
== Arnes SDD :: init (modo: completo) ==
✓ typecheck paso
✓ lint paso
 Test Files  1788 passed (1788)
      Tests  25592 passed | 26 skipped (25618)
✓ tests: sin rojos nuevos (0 archivo(s) rojo(s) sobre 1788 ejecutado(s), todos en el baseline conocido)
✓ .env presente
INIT_EXIT=0
```

- `INIT_EXIT` leído **de dentro del log**, no del chat, y sin `tail` en la escritura.
- **26 `skipped`** = exactamente los conocidos.
- El `.env` se copió al worktree antes de correr (si no, los ~134 archivos de
  `tests/integration/db` se saltan y el gate dice «OK» sin haber tocado la capa de datos) y **se
  borró antes de commitear**.
- `pnpm run db:generate` antes del gate.
- Los cinco archivos tocados corrieron DENTRO del gate, no saltados:
  `cierres-gestiones-fundida-…test.ts (33)`, `DescargarGestionesDialog (19)`,
  `CierresAdminDescargaDetallada (6)`, `CierresBodegaDescargaDetallada (3)`,
  `cierres-gestiones-paridad (2)`.

### El rojo de la primera corrida: medido, y NO era deuda ajena

La primera pasada del gate salió `INIT_EXIT=1` con **un** archivo rojo,
`tests/integration/db/analytics-daily-migration.test.ts` (4 casos, la guardia de drift de la 323).
**No se metió en `tests/baseline-rojos.json`**, y con razón: el propio error lo nombraba —

```
Motivo: no se encontro el CLI de Prisma en …\agent-a4c774503e18e88cf\node_modules\prisma\build\index.js
```

El worktree no tenía `node_modules` propio (`git worktree add` no lo trae). Se estaba trabajando
con el `node_modules` del árbol principal por resolución de ancestros y `PATH`, que basta para
`tsc`, `eslint` y `vitest` pero **no** para una guardia que busca el CLI de Prisma en una ruta
literal bajo el `cwd`. Se midió antes de concluir nada:

- `pnpm install` en el worktree (26 s, aislado) + `pnpm run db:generate`;
- ese archivo **AISLADO**: `Test Files 1 passed · Tests 63 passed`;
- gate completo repetido: **0 archivos rojos**, `INIT_EXIT=0`.

No era contención con el otro agente, no era flake y no era `dev` roto: era el entorno del
worktree, y la guardia hizo exactamente lo que se diseñó para hacer —ponerse roja en vez de
abstenerse en verde—.

---

## Lo que hay que decir aunque no lo pidiera el encargo

**El encargo (y `impl_394.md`) nombraban dos archivos de test a actualizar; son TRES.**
`tests/components/descarga/DescargarGestionesDialog.test.tsx:377` también afirmaba
`toContain("Intentos de contacto de la tienda")` y habría quedado rojo. Está corregido. El cuarto,
`CierresAdminDescargaDetallada.test.tsx`, solo tenía el nombre viejo en un comentario.

**Se tocó `lib/`, y solo un comentario.** El encargo pedía no tocarlo salvo que fuera
imprescindible. El TSDoc de `intentosContactoTienda` remitía a `INTENTOS_CONTACTO_TIENDA_COL`, la
constante que este cambio elimina: dejarlo habría sido un puntero a un símbolo borrado, que es la
clase de mentira en prosa que este repo persigue. Tres líneas, sin tocar tipos ni campos.

**Una corrección de número heredada de la 385:** la cabecera de
`CierresBodegaDescargaDetallada.test.tsx` decía «las 29 columnas» mientras su propia aserción
exigía 31. Puesto en 31.

---

## Veredicto

La hoja detallada de cierres lleva «Intentos de entrega» —los del mensajero, vigentes, el mismo
literal que las otras tres hojas— en lugar de los intentos de contacto de la tienda, con el `0`
emitido y por los dos caminos; gate completo verde (`INIT_EXIT=0`, 26 skipped conocidos, 0 rojos)
y 3/3 mutaciones muertas, incluida la que reproduce a la letra el defecto de la 385.
