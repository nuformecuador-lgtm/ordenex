# Feature 94 — Mapa de paradas + ubicación viva del mensajero · tasks

> Checklist de pasos discretos y verificables. `[P]` = paralelizable con otra `[P]` sin conflicto de
> archivos. Base: `origin/dev` tras el merge de la 92 y la 93; worktree aislado (NO sobre `flow`).
> Cada `R<n>` termina mapeado a un test (ver `requirements.md`).

## Preparación

- [ ] **T0 — Verificar base.** `origin/dev` contiene `MiAsignacionDTO.secuenciaRuta`,
  `ruta.paradasSinOptimizar`, `MisAsignacionesModule` reordenado y `Orden.latitud/longitud`.
  *Hecho:* `git log` muestra 92 y 93 mergeadas; `pnpm db:generate` limpio; `./init.sh` en verde.
  **Bloquea todo lo demás.**

## Backend — coordenadas en el DTO (R1/R2)

- [ ] **T1 — Exponer `latitud`/`longitud` en el DTO del mensajero.** Depende de T0.
  - `GestionOrdenRepository.ts`: `WITH_ASIGNACION.select` += `latitud`, `longitud`; `toMiAsignacionRow`
    mapea con `toNumber()` null-safe; `MiAsignacionRow` += ambos campos.
  - `IMisAsignacionesService.ts` → `MiAsignacionDTO` += `latitud: number|null`, `longitud: number|null`.
  - `MisAsignacionesService`: propaga sin transformar (verificar que no rompe reordenado ni KPIs).
  - *Hecho:* typecheck verde; el DTO trae las coordenadas serializadas; el resto del contrato intacto.
- [ ] **T2 — Documentar la key en `.env.example`.** `[P]` (no colisiona con T1). Depende de T0.
  - Añadir sección "Google Maps JavaScript API (Feature 94)" con
    `NEXT_PUBLIC_GOOGLE_MAPS_JS_API_KEY` comentada y nota de restricción por referrer.
  - *Hecho:* `.env.example` trae la entrada comentada; nombre coincide con `loadMapsConfig` (T3).

## Config y loader del SDK

- [ ] **T3 — `lib/config/maps.ts` (`loadMapsConfig`).** `[P]`. Depende de T0.
  - Clon estructural de `route-optimization.ts`: nunca lanza, key ausente/vacía → `null` (R15).
  - *Hecho:* `tests/unit/config/maps-config.test.ts` cubre key presente/ausente/vacía.
- [ ] **T4 — `lib/maps/loader.ts` (`loadGoogleMaps`).** `[P]`. Depende de T0 + instalar
  `@googlemaps/js-api-loader` (`pnpm add`).
  - Wrapper idempotente sobre `Loader`; loader/`google` inyectable o stubbeable para test (R16).
  - *Hecho:* `tests/unit/lib/maps-loader.test.ts` prueba que una segunda carga no reinyecta el script.

## Frontend — hook de ubicación viva (R10-R14)

- [ ] **T5 — `hooks/useUbicacionEnVivo.ts`.** `[P]`. Depende de T0.
  - `watchPosition` al montar; actualiza `coords` (R11); `denegado`(code 1, R12)/`error`(R13);
    `clearWatch` al desmontar (R14); nunca lanza ni bloquea.
  - *Hecho:* cubierto por el test de componente (T7) con `navigator.geolocation` mockeado; guard de
    `clearWatch` verificado al desmontar.

## Frontend — componente del mapa (R3-R16)

- [ ] **T6 — `MapaParadasMensajero.tsx`.** Depende de T3, T4, T5, T1.
  - `apiKey === null` → placeholder degradado (R15).
  - Carga el SDK (T4), crea el mapa, marcadores numerados por `secuenciaRuta` (R4/R5), `null`
    distinguible (R6), paradas sin coordenadas omitidas + contador (R7), encuadre `fitBounds`
    (R8) / fallback (R9), marcador de ubicación viva vía `useUbicacionEnVivo` (R10-R13).
  - *Hecho:* `tests/components/MapaParadasMensajero.test.tsx` verde para R4-R16.
- [ ] **T7 — Tests de componente del mapa.** Depende de T6.
  - Mockea el loader (T4) y `navigator.geolocation`. Casos: con/sin coordenadas, `secuenciaRuta`
    null, permiso concedido/denegado/timeout, sin key, `clearWatch` al desmontar, loader idempotente.
  - *Hecho:* cubre R4-R16 según la tabla de trazabilidad.

## Integración en el módulo (R3)

- [ ] **T8 — Insertar el mapa en `MisAsignacionesModule.tsx` + bajar `apiKey`.** Depende de T6, T1.
  - Añadir prop `apiKey?: string | null` al módulo; renderizar `<MapaParadasMensajero>` dentro del
    guard `rol === "mensajero"`, en la sección "En reparto / por gestionar", sobre la grilla.
  - `page.tsx`: `loadMapsConfig()` server-side y pasar `apiKey` por props (NO tocar el guard de rol
    existente ni el flujo de `listarMisAsignaciones`).
  - *Hecho:* el mapa aparece solo para `mensajero`; `tests/components/MisAsignacionesModule.test.tsx`
    cubre R3 (mapa ausente para otros roles / presente para mensajero).

## Backend tests

- [ ] **T9 — Tests del DTO ampliado (R1/R2).** `[P]` con T5-T7. Depende de T1.
  - `gestion-orden-repository-asignaciones.test.ts`: Decimal→number null-safe (R1).
  - `mis-asignaciones-dto-coordenadas.test.ts`: coordenadas presentes en `porGestionar`/`porRecoger`
    sin romper `secuenciaRuta`/orden (R2).
  - *Hecho:* ambos tests verdes.

## Cierre

- [ ] **T10 — Verificación integral.** Depende de todas.
  - `./init.sh` en verde; suite de tests completa; typecheck limpio; lint limpio.
  - Mapa de trazabilidad `R1..R16 → test` completo en `progress/impl_94-mapa-paradas-mensajero.md`.
  - *Hecho:* CHECKPOINTS.md satisfecho; sin `console.log` ni marcadores de conflicto heredados.

---

### Grafo de dependencias (resumen)

```
T0 ─┬─ T1 ─┬─ T6 ── T7
    │       └─ T8
    ├─ T2 [P]
    ├─ T3 [P] ─ T6
    ├─ T4 [P] ─ T6
    ├─ T5 [P] ─ T6
    └─ T9 [P] (tras T1)
T6/T7/T8/T9 ── T10
```

Paralelizables tras T0: **T2, T3, T4, T5** (archivos disjuntos). T9 en paralelo tras T1.
</content>
