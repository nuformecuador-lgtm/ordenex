# Feature 201 — tanda A: el helper de dinero legible

Rama `feature/201-dinero-legible`. Alcance: crear el helper y su test. **Ningún consumidor
migrado** (las siete copias de `money()` siguen intactas: tandas B y C).

## Archivos

| Archivo | Qué |
|---|---|
| `lib/config/moneda.ts` | **M** — `simbolo` + los dos separadores en `MonedaConfig`; `formatMontoString` nuevo; `SIN_MONTO_RAYA` nuevo; `formatMonto` reimplementado sobre la misma agrupación |
| `tests/unit/config/moneda-formato.test.ts` | **A** — 21 casos |
| `tests/unit/components/analytics-formato.test.ts` | **M** — 2 aserciones (caída de reimplementar `formatMonto`) |
| `tests/components/AnalyticsKpiCard.test.tsx` | **M** — 1 aserción (íd.) |
| `tests/components/PanelConciliacion.test.tsx` | **M** — el literal a mano del cuadre (íd.) |
| `components/shared/KpiValorAnimado.tsx` | **M** — SOLO un comentario que quedó falso |

## El formato

Por STRING, nunca por número. Se parte por el punto, se agrupa la parte entera de tres en
tres **desde la derecha** y los decimales se copian verbatim.

```
"13331832.72"    -> "₡13.331.832,72"      "1234567" -> "₡1.234.567"   (sin ",00")
"12345678901.99" -> "₡12.345.678.901,99"  "999"     -> "₡999"
"1500.50"        -> "₡1.500,50"           "1000"    -> "₡1.000"
"-4500.00"       -> "-₡4.500,00"          "0.10"    -> "₡0,10"
```

`Number(` / `parseFloat(` / `parseInt(` no aparecen en el módulo, y el propio test lo barre
con `tests/fixtures/money-safe.ts` (con contraprueba, para que el barrido no pase por no
mirar nada).

## Decisiones

**Marcador de nulo: NO se unifica.** `SIN_MONTO = "-"` (guion corto) es el de `formatMonto`;
las siete copias de `money()` pintan `"—"` (raya larga). Firma
`formatMontoString(value, sinMonto = SIN_MONTO)` y se exporta `SIN_MONTO_RAYA = "—"` para que
las tandas B/C pasen el suyo sin escribir el carácter a mano. Unificarlo cambiaría pantallas
que nadie pidió tocar.

**Lo que no tiene forma de decimal se pinta tal cual detrás del símbolo** (`"1.2.3"` →
`"₡1.2.3"`), que es lo que ya hacía `money()`. Devolver el marcador de ausencia diría "no hay
importe" cuando sí lo hay.

**Un separador en blanco no es configurable**: `readNonEmpty` trata `""` y `"   "` como
ausentes, igual que en el resto de `lib/config/**`. Consecuencia: el espacio fino de `Intl`
no se puede restaurar por entorno. Queda escrito en el test.

## Aviso: `formatMonto` SÍ tiene consumidores

El encargo pedía que la app quedara idéntica, y reimplementar `formatMonto` **no lo es**:
lo usan `components/private/analytics/formato.ts` (KPIs, tableros, panel de conciliación),
`KpiValorAnimado`, `EtiquetaGuia` y los dos PDF de etiquetas. Ahí el dinero pasa de
`₡3 500,00` (espacio duro de `Intl`) a `₡3.500,00` **desde esta tanda**. Se hizo porque la
instrucción era explícita y porque el objetivo de la feature es exactamente ése; las 3
aserciones que medían el aspecto viejo se actualizaron. Lo que sigue intacto son las siete
copias de `money()`.

## Verificación

- `pnpm exec vitest run tests/unit/config/moneda-formato.test.ts` → 21/21.
- `pnpm exec tsc --noEmit` → limpio.
- `pnpm exec vitest run tests/unit/guards` → 25 archivos, 274/274.
- Consumidores de `formatMonto` (analítica, etiquetas, PDF, tableros): 143 archivos,
  1661/1661.
- `pnpm exec eslint` sobre los 6 archivos → limpio.

### El test, matado con mutaciones

1. Separador también en la posición 0 (`["", ...grupos].join(sep)`, el `.999` clásico) →
   **11 de 21 rojos**.
2. Rellenar los decimales a dos (`.padEnd(2, "0")`) → **4 rojos** (los de "no inventes":
   `"1234567"`, `"1500.5"`).

Ambas revertidas; la suite vuelve a 21/21.

### Barridos money-safe: qué hay

`grep -rn "config/moneda" tests/unit/guards/` no devuelve **nada**. Los 10 archivos que usan
`LLAMADAS_PROHIBIDAS_EN_DINERO` barren censos explícitos de la feature 172/173; el único que
escanea árboles (`liquidacion-money-safe.test.ts`) mira `components/shared/liquidacion/**` y
los `lib/**` que casan `/[Ll]iquidacion/`. `lib/config/moneda.ts` no entra en ninguno: no
estaba vigilado y sigue sin estarlo desde fuera. Por eso el barrido se escribió **dentro** del
test nuevo. El `.toFixed(2)` de `formatMonto` no rompe nada (ningún barrido lo alcanza) y el
test propio exige que sea de escala 2.

`superficie-de-uso.guardia.test.ts` sólo censa Server Actions de `lib/actions/**` y
componentes, así que el export nuevo sin consumidores no la dispara (guardias en verde).

### Nota de ruido

En la primera pasada, `tests/unit/guards/no-embalaje.test.ts` (que recorre el repo entero
buscando la palabra) falló una vez y pasó en las tres siguientes, sola y en lote. Ningún
archivo de esta tanda contiene "embalaje". Flake, no regresión.
