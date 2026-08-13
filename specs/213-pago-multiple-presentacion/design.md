# Feature 213 — design

## §0. Lo que ya existe y no hay que construir

La 212 dejó el terreno hecho, y conviene no re-descubrirlo:

| Pieza | Dónde | Estado |
| --- | --- | --- |
| Tabla del desglose | `gestion_orden_pago` | en producción desde el 2026-08-13 15:12:20 |
| Borde de escritura que acepta el desglose | `lib/types/gestion-orden.ts:319-322` (`pagos: pagosSchema.optional()`) | listo |
| Las cinco reglas que relacionan monto / escalar / desglose | `validarRecaudoEntrega` (mismo archivo) | listo |
| Helpers de cuadre en céntimos enteros | `lib/utils/pagos-recaudo.ts` (`aCentimos`, `sumaCuadra`) | listos |
| Desglose en el DTO de las TRES lecturas | `CierreDetalleGestion.pagos` (`ICierreDiaService.ts:47`), proyectado con `orderBy: { metodo: "asc" }` en `CierreDiaRepository.ts:129` y `CierresAdminRepository.ts:126` | listo |

**Consecuencia:** esta feature no toca ni un repositorio, ni un servicio, ni el schema de zod, ni
la base. Es **una pieza nueva de formato + un editor + cinco puntos de consumo.**

## §1. La pieza única de formato (R14, R19)

Un helper **puro** que es la ÚNICA declaración de cómo se lee un desglose:

```ts
// lib/utils/descripcion-desglose-pago.ts  (nombre propuesto)
export function describirDesglosePago(
  pagos: readonly { metodo: MetodoPagoValue; monto: string }[],
): string | null
```

- `[]` → `null`, y cada sitio lo pinta con su propio marcador de ausencia (hoy `"—"` en las
  pantallas y `null` en las descargas: **son distintos a propósito**, un Excel no lleva guiones).
- 1 línea → `METODO_LABEL[metodo]` — idéntico a lo que se ve hoy (R11).
- 2+ líneas → `Efectivo ₡5.000,00 + Transferencia ₡3.000,00`, con el monto por
  `formatearMoneda` de `lib/config/moneda.ts` (R16) y el orden que ya trae el DTO (R12).

**Por qué en `lib/utils/` y no en un componente:** lo consumen dos archivos de columnas de
descarga (que no son React) y tres componentes. Un helper en `app/` no es importable desde
`lib/`; al revés sí. Y siendo puro, la mutación que le cambie el separador muere en un test de
unidad, no en cinco de componente.

**Por qué devuelve `string | null` y no un `ReactNode`:** las descargas escriben celdas de texto.
Un nodo obligaría a una segunda función para el Excel — es decir, la segunda declaración que R14
prohíbe.

### La alternativa descartada

**Un componente `<DesglosePago pagos={…} />` que renderice una lista apilada.** Se descarta: no
sirve para las descargas, así que habría dos declaraciones del formato (R14), y es exactamente el
defecto que la feature 188 documentó como R16 —«no dos declaraciones separadas del mismo
criterio»— y que costó una guardia entera. Si Q1 se resuelve a favor de apilar en la factura, la
forma correcta es que **el componente consuma el helper por línea**, no que reimplemente el
formato: el helper seguiría siendo la única fuente del par «etiqueta + monto».

## §2. El editor de captura (R1-R9b)

Estado local del panel, sustituyendo `const [metodoPago, setMetodoPago] = useState("")`
(`GestionarOrdenPanel.tsx:260`):

```ts
type LineaCaptura = { metodo: string; monto: string }; // strings: es un formulario
const [lineas, setLineas] = useState<LineaCaptura[]>([]);
```

- Al elegir `entregada` (`elegirResultado`, :436): `lineas = [{ metodo: "", monto: <total> }]` si
  hay cobro; `[]` si `sinCobro` (R9). El reset ya existe para los demás campos y esta línea se
  suma a él.
- **Una sola línea → monto no editable** (R2): se pinta con el total y `readOnly`, no `disabled`,
  para que siga siendo legible por lector de pantalla.
- «Añadir método» (R3) solo aparece MIENTRAS `lineas.length < METODO_PAGO_OPTIONS.length` (R4), y
  al pasar de 1 a 2 los montos se vuelven editables y el de la línea nueva queda vacío.
- Cada `Select` de método filtra los métodos ya usados en otras líneas (R4).
- El aviso de cuadre (R6) se calcula con `sumaCuadra(lineasNumericas, montoCobrar)` (R9b) y solo
  se muestra con 2+ líneas: con una sola, R2 lo hace imposible por construcción.

### El envío (R7, R8)

`buildRaw` (:334) y `buildFormData` (:378) dejan de mandar `metodoPago` y mandan `pagos`:

```ts
// buildRaw, rama "entregada"
pagos: lineasUtiles(lineas),        // filtra sin método o sin monto (R8)
// y NO se incluye metodoPago (R13 de la 212 rechaza las dos formas)
```

En `FormData` el desglose viaja como **JSON en una sola clave** (`fd.set("pagos", JSON.stringify(…))`).

> **Por qué JSON y no `append` repetido como las evidencias:** las fotos son `File`s, que no tienen
> otra forma de viajar; una línea de pago es un par de escalares y `getAll("pago[]")` obligaría a
> reconstruir la correspondencia metodo↔monto por índice, que es precisamente el error que
> `@@unique(gestion_id, metodo)` existe para hacer imposible. **Esto exige comprobar cómo lee el
> borde `pagos` desde `FormData` hoy** (la Server Action de la 212, `lib/actions/mis-asignaciones.ts`):
> si ya definió el formato, se usa ESE y este párrafo sobra. **Task 0 lo verifica antes de escribir
> nada** — es el punto donde esta feature podría chocar con la 212, y no se resuelve suponiendo.

### `sinCobro` y la trampa del `efectivo` forzado

`metodoPagoEfectivo = sinCobro ? "efectivo" : metodoPago` (:331) **desaparece**. Era la línea que
disfrazaba «sin cobro» de efectivo para satisfacer un enum obligatorio; con `pagos` opcional y
R14 de la 212, cero líneas es la representación correcta y el borde ya la acepta.

## §3. Los cinco puntos de consumo (R10-R13, R17-R19)

| Sitio | Hoy | Después |
| --- | --- | --- |
| `CierreDiaModule.tsx:886` | `g.metodoPago ? METODO_LABEL[g.metodoPago] : "—"` | `describirDesglosePago(g.pagos) ?? "—"` |
| `cierre-detalle-shared.tsx:898` | ídem | ídem |
| `cierre-factura.tsx:959` | `g.metodoPago ? \` · ${METODO_LABEL[g.metodoPago]}\` : ""` | prefijo ` · ` sobre el helper, `""` si `null` |
| `cierre-dia-descarga-columnas.ts:101` | `METODO_LABEL[...] ?? gestion.metodoPago` | `describirDesglosePago(gestion.pagos)` |
| `cierre-gestiones-descarga-columnas.ts:115` | ídem | ídem |

**Las líneas de la ficha estaban desfasadas** (decía 887 / 888 / 894 / 101 / 115): las tres
primeras se movieron a 886 / 898 / 959. Las de descarga sí coinciden. Verificado el 2026-08-13.

El `?? gestion.metodoPago` de las descargas —un fallback al `value` crudo del enum— **muere aquí**:
R15 lo prohíbe y con `METODO_LABEL` cubriendo el enum completo nunca podía dispararse.

## §4. Qué NO se toca, y por qué importa decirlo

- **`computeTotales` y los tres `total_*`** (R22): ya suman desde el desglose. El `min(P, E)` del
  pago al mensajero depende de `total_efectivo`; esta feature no entra ahí. Es la razón por la que
  esta ficha es *frontend* y no *fullstack*.
- **El retiro de la forma escalar** (R21): es la 214, y **solo cuando esta esté desplegada**. Los
  dos comentarios que dicen lo contrario se corrigen (R20).
- Las cinco fronteras inmunes de la 212 (R23).

## §5. Riesgos, y el que de verdad importa

1. **El editor manda `pagos` y el borde no lo lee de `FormData` como se supone.** Es el único
   riesgo que rompe la feature entera, y se despacha en la Task 0 leyendo la Server Action. No se
   escribe editor hasta saberlo.
2. **Los tests de las tres pantallas y las dos descargas construyen fixtures con `metodoPago`
   escalar.** ~15 archivos de fixtures según el censo de la 212. Un fixture que traiga `metodoPago`
   pero `pagos: []` pasará a mostrar `—` y pondrá rojos tests que hoy pasan: **eso no es una
   regresión, es el cambio pedido**, y hay que actualizar el fixture, no el código.
   > ⚠️ **Y aquí está el modo de fallo caro de este repo, dos veces documentado:** un fixture cuyos
   > dos valores coinciden tapa el defecto. Si al actualizar un doble se pone `pagos` **y** se deja
   > `metodoPago` con el mismo método, el test pasa igual leyendo cualquiera de los dos, y ya no
   > distingue si el código lee el correcto. Los dobles deben traer `metodoPago` **distinto** del
   > desglose (o `null`) para que la aserción tenga contenido.
3. **Contraste del aviso de descuadre**: si se pinta con la variante `destructive`, hereda la deuda
   medida de la **ficha 210** (3,30 de contraste, no pasa AA). Usar `text-destructive` sobre fondo
   normal —como los errores de campo que ya existen en el panel— y no la píldora.

## §6. Verificación prevista

- **Unidad, el helper**: 1 línea / 2 líneas / 3 líneas / vacío / orden del enum / formato de moneda.
  Es donde muere la mutación del separador y la del orden.
- **Componente, el editor**: arranque con una línea; monto no editable con una sola; añadir vuelve
  editables; no se repite método; quitar vuelve a R2; el descuadre se ve antes de enviar; sin cobro
  no manda método; el `FormData` enviado lleva `pagos` y **no** `metodoPago`.
- **Componente, las tres pantallas**: una línea se ve como hoy; dos líneas muestran ambas; cero
  líneas muestran `—`.
- **Unidad, las dos descargas**: la celda concatena; las constantes de columnas no se mueven (los
  tests que ya existen lo garantizan y deben seguir verdes sin tocarse).
- **Mutación obligatoria** (R19): cambiar el separador **solo en el helper** debe poner rojos a la
  vez un test de pantalla y uno de descarga. Si solo cae uno, R14 no está realmente atado y hay dos
  declaraciones del formato escondidas.
