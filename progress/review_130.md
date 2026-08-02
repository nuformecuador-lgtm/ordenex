# Review de la feature 130 — analítica: componentes de gráficas

> Revisión independiente contra `specs/130-analitica-componentes-graficas/`, `docs/` y
> `CHECKPOINTS.md`. Dos rondas. Persistido por el leader a partir del informe del reviewer
> (el reviewer no escribe archivos; midió y devolvió el veredicto).

## VEREDICTO FINAL: **APROBADO** — ronda 2, 2026-08-01

La ronda 1 **RECHAZÓ** con tres bloqueantes. Los tres están cerrados de verdad, no de palabra:
el reviewer **repitió sus tres mutaciones exactas y las tres se ponen rojas ahora**.

---

## 1. Ronda 1 — los tres bloqueantes (todos: test verde que no medía el requisito)

### B1 · R13 — se podía reintroducir el símbolo hardcodeado y todo quedaba verde
Mutación en `components/private/analytics/formato.ts`, caso `"moneda"`:
`return formatMonto(valor)` → `` `₡${numero(valor, {minimumFractionDigits: 2})}` `` ⇒ **42 passed**.

**Causa raíz**, y es lo interesante: con la config por defecto (`es-CR`/`CRC`), `formatMonto(3500)`
y un `₡` a mano dan **el mismo string byte a byte** (`"₡3 500,00"`). Ninguna aserción sobre la
salida por defecto puede separarlos. **El test no era flojo: era incapaz.** Con
`MONEDA_CURRENCY=USD` lo correcto sería `"USD 3 500,00"`.

### B2 · R20 — la cláusula «sin literal de idioma incrustado» no la medía nada
`new Intl.NumberFormat(monedaConfig.locale, …)` → `new Intl.NumberFormat("es-CR", …)`
⇒ **42 passed**. Es literalmente el punto de `CHECKPOINTS.md` «no se hardcodeó país, moneda ni
cuenta», y el mismo defecto que Q5 vino a arreglar en el componente compartido.

### B3 · El techo de segmentos del donut — cobertura CERO en código que evita un crash
Neutralizar `aplicarTopeSeries` en `GraficaDonut.tsx` ⇒ **43 passed**, ningún test se entera.

**Por qué era grave y no cosmético:** `paleta.ts:44-49` lanza `IndiceSerieFueraDeRangoError`
para todo índice `>= 5` **en cualquier `NODE_ENV`**, y `DonutLienzo.tsx:26` colorea por índice
de segmento. Sin ese recorte, un donut de 6+ categorías —el caso que el propio spec nombra,
`ordenes_por_estado` con **19** (I26)— **revienta en el navegador también en producción**.
Era código de seguridad *load-bearing* sin un solo test.

## 2. Ronda 2 — verificación de los arreglos (mutaciones repetidas por el reviewer)

| Mutación repetida | Resultado |
|---|---|
| B1 · `₡` hardcodeado en `formato.ts` | 🔴 `× con otra moneda configurada el valor NO lleva el simbolo del colon` |
| B2 · locale `"es-CR"` literal | 🔴 3 tests, las dos vías |
| B3 · neutralizar el recorte del donut | 🔴 `× con 6 categorias lanza SeriesExcedidasError fuera de produccion` + `× en produccion recorta a 5 segmentos, no revienta, y anuncia el recorte por texto` |
| **extra** · donut conservando los **últimos** 5 en vez de los primeros | 🔴 — la dirección de la enmienda también está pineada (`estado-0` presente / `estado-5` ausente), no sólo el conteo |
| `formatearValor` dividiendo el porcentaje entre 100 | 🔴 — R20-bis pineado |

### Matiz importante que el implementer no vio (anotado como dato, no como pega)

Con el escape `₡`, **el guard estático NO dispara**: `simbolos = /[₡€£¥]/` busca el glifo,
no la secuencia de escape. Lo cazó sólo la segunda vía (el test que recarga el módulo con
`MONEDA_CURRENCY=USD`). Con el glifo literal disparan las dos.
**Las «dos vías que se cubren entre sí» son ciertas pero ASIMÉTRICAS:** la vía de comportamiento
cubre a la estática, no al revés. R13 queda cerrado porque la de comportamiento cubre el 100 %
de lo que el usuario ve.

## 3. Enmienda R33-bis — ratificada por el humano

`requirements.md:355-378`. Verificada punto por punto: fechada (**2026-08-01**) y atribuida al
humano; redacción EARS; **los dos porqués separados y explícitos** (el tope de 5 porque
`paleta.ts` lanza para índice `>= MAX_SERIES` en cualquier `NODE_ENV`, producción incluida, y
porque repetir colores es lo que Q3 descartó; los primeros porque en una serie ordenada por
magnitud quedarse los últimos dejaría a la vista las 5 categorías más pequeñas escondiendo las
dominantes); y **alcance propio y explícito: sólo el donut** — R33 sigue intacta para
`GraficaBarras` y `GraficaLineas` (62 puntos, `PuntosExcedidosError`, conservar los últimos).
Explica además por qué las dos direcciones opuestas no son incoherencia: serie por magnitud vs.
serie temporal. **Nada insinuado.** Replicada en `tasks.md > T0.1` punto 4 para la 131.

## 4. Menores — todos atendidos

| | Hallazgo | Estado |
|---|---|---|
| **m1** | R28 se cumple, pero por un **default de recharts** (`isAnimationActive:"auto"` → `usePrefersReducedMotion`) que nadie fijó con prop ni pineó (`^3.10.1` abierto). El comentario del test («sencillamente no anima») era inexacto: el lienzo **sí** anima con la preferencia apagada. | Marcado **⚠ con dependencia externa**, comentario reescrito, riesgo residual dicho. |
| **m2** | R25 es materialmente autocumplido: el texto del vacío es 100 % del llamador y el test afirma lo que él mismo pasó. | De ✅ a **⚠ parcial**; se cierra con la 131. |
| **m3** | Los tres `lienzo/*.tsx` tienen 0 % de ejecución (consecuencia correcta de R41 + los `vi.mock`): `connectNulls={false}`, el mapeo de `Cell` y el throw de `varDeSerie` nunca se ejecutan. | Coherente con la spec; reforzaba B3, ya cerrado. |
| **m4** | Evidencia de R27 registrada pero no reproducible: el script vive fuera del repo y la conclusión se **infiere** del contenido de chunks. | Documentado cómo repetirla y que **`.next/app-build-manifest.json` es la vía preferible**. |
| **m5** | T8.3 se marcó `[x]` afirmando que «los tres artefactos existen», incluido `review_130.md`, **que no existía**: bookkeeping autocumplido. | Devuelta a `[ ]` por el implementer; **cerrada por el leader** al persistir este archivo. |
| **porcentaje** | La decisión de que viaje como **fracción** (0,842 = 84,2 %) es correcta y coherente con la 135 (`DefinicionMetrica.razon` no declara escala), pero estaba mal señalizada. | Promovida a **R20-bis** en `requirements.md`, en la trazabilidad y en `tasks.md > T0.1` p.3. |

## 5. Higiene del historial — menor, y peor de lo confesado

El implementer autoreportó que `07d8188b` («cierra los tres bloqueantes») arrastra también la
enmienda y los menores. El reviewer comprobó el reparto real y encontró la otra mitad, **no
reportada**: `5ad7b2f2` («enmienda R33-bis ratificada, R20-bis y menores») **no toca
`requirements.md` ni `tasks.md`** — su diff son sólo `feature_list.json`, `current.md` e
`impl_130.md`. **El mensaje del segundo commit describe un diff que no es el suyo**: quien haga
`git show 5ad7b2f2` buscando R33-bis no encuentra nada.

**Clasificado menor.** Viola `docs/conventions.md` («un commit por task lógica») y confunde a
quien lea el historial, pero no ensucia nada de lo que el arnés lee para decidir: en HEAD,
`requirements.md`, `tasks.md`, `impl_130.md`, `feature_list.json` y los tests son correctos y
coherentes. **No se reescribe historia**: hacerlo después de una review sería peor que el
defecto.

## 6. Verificación ejecutable

`./init.sh`: **typecheck 0 · lint 0 · 674 archivos / 8144 tests**. El total de archivos coincide
con la ronda 1 (674) y el `+8` en tests son exactamente los ocho nuevos: **no hay archivos
omitidos por *unhandled errors*, el conteo es creíble**.

Honestidad sobre la corrida del reviewer: salió `EXIT=1` con **6 rojos en 3 archivos**
(`recuperar-contrasena-form` ×4, `LoginForm`, `filter-component`). En aislado: **3 archivos /
72 tests, 0 rojos**. Ninguno menciona `analytics`, `KpiValorAnimado` ni `moneda` (`grep -c` → 0,
0, 0); dos ya flakearon midiendo la base; los tres son tests de temporización que tardaron
14–35 s bajo la suite completa. **Flakes por saturación, no regresión.** El leader lo confirmó
por su cuenta: `tests/unit/components` + `tests/components/Analytics*` + `KpiValorAnimado` →
**44 archivos / 506 tests, 0 rojos** en la segunda corrida, con el mismo total de archivos.

## 7. Resto del checklist

- **Decisiones de la puerta:** las cinco respetadas. Recharts directo sin `components/ui/chart*`
  (R39 con guard); theme-aware sólo por tokens y sin conmutador (R40); techo 5/62 con
  desbordamiento explícito y **sin** «otros» ni agregación temporal (R34); `TablaResumen` aporta
  formato por unidad y totales por función pura — **no** es un re-export vacío; `KpiValorAnimado`
  resuelve la moneda por `lib/config/moneda.ts`.
- **Consumidores del compartido:** verificado. Ruta sin moneda **byte-idéntica**; ruta con moneda
  `"₡ 3 500"` → `"₡3 500,00"`, exactamente lo que I31/Q5 autorizaron. Ningún E2E depende de ello
  (los `"₡150.00"` de `e2e/cierre*.spec.ts` salen de `money()`, no del KPI).
- **H1/H2/H3:** los tres siguen escritos y sin maquillar. H1 confirmado por grep: **cero** imports
  de `components/private/analytics` fuera del propio paquete y de `tests/`.
- **CHECKPOINTS:** specs con alternativas descartadas; sin tablas, migraciones ni RLS (feature de
  presentación pura); sin secretos; capas separadas con guard estático real; sin E2E,
  correctamente justificado.
- **`docs/conventions.md` / `docs/architecture.md`:** cumplidos salvo el menor del §5. La
  excepción a `architecture.md:136` está nombrada, fechada y atribuida al humano.
