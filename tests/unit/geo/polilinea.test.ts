import { describe, it, expect } from "vitest";
import {
  codificarPolilinea,
  decodificarPolilinea,
  distanciaTotalM,
  distanciaHaversineKm,
} from "@/lib/geo/polilinea";

// Feature 92 (seguimiento) — codificador/decodificador del "Encoded Polyline Algorithm
// Format" de Google. Es el formato que permite dibujar una ruta SIN llamar a ningun
// proveedor: una polilinea no es mas que una lista de lat/lng comprimida.
//
// EL VECTOR DE ABAJO ES EL DE LA DOCUMENTACION OFICIAL DE GOOGLE. Si este test se pone rojo,
// la polilinea que generamos ha dejado de ser compatible con los decodificadores de terceros
// (google.maps, Leaflet, Mapbox) y el mapa dibujaria basura.

const PUNTOS_OFICIALES = [
  { lat: 38.5, lng: -120.2 },
  { lat: 40.7, lng: -120.95 },
  { lat: 43.252, lng: -126.453 },
];
const ENCODED_OFICIAL = "_p~iF~ps|U_ulLnnqC_mqNvxq`@";

describe("codificar — compatibilidad con el formato de Google", () => {
  it("reproduce EXACTAMENTE el vector de la documentacion oficial", () => {
    expect(codificarPolilinea(PUNTOS_OFICIALES)).toBe(ENCODED_OFICIAL);
  });

  it("una lista vacia produce una cadena vacia (no lanza)", () => {
    expect(codificarPolilinea([])).toBe("");
  });

  it("un solo punto se codifica como su posicion absoluta", () => {
    const encoded = codificarPolilinea([{ lat: 9.93, lng: -84.09 }]);
    expect(decodificarPolilinea(encoded)).toEqual([{ lat: 9.93, lng: -84.09 }]);
  });
});

describe("decodificar — inversa exacta", () => {
  it("decodifica el vector oficial a sus coordenadas", () => {
    const puntos = decodificarPolilinea(ENCODED_OFICIAL);
    expect(puntos).toHaveLength(3);
    puntos.forEach((p, i) => {
      expect(p.lat).toBeCloseTo(PUNTOS_OFICIALES[i].lat, 5);
      expect(p.lng).toBeCloseTo(PUNTOS_OFICIALES[i].lng, 5);
    });
  });

  it("ida y vuelta conserva las coordenadas con precision de ~1 m", () => {
    // Coordenadas reales de reparto urbano: la precision de 5 decimales debe bastar para
    // que dos paradas de la misma calle no colapsen en el mismo punto.
    const originales = [
      { lat: 9.93333, lng: -84.08333 },
      { lat: 9.93341, lng: -84.08298 },
      { lat: 9.94012, lng: -84.07711 },
    ];
    const vuelta = decodificarPolilinea(codificarPolilinea(originales));
    expect(vuelta).toHaveLength(originales.length);
    vuelta.forEach((p, i) => {
      expect(p.lat).toBeCloseTo(originales[i].lat, 5);
      expect(p.lng).toBeCloseTo(originales[i].lng, 5);
    });
  });

  it("cadena vacia -> lista vacia", () => {
    expect(decodificarPolilinea("")).toEqual([]);
  });

  it("una cadena TRUNCADA devuelve los puntos leidos, sin lanzar", () => {
    // El mapa es una ayuda visual: media ruta dibujada es mejor que una pantalla rota.
    const completa = codificarPolilinea(PUNTOS_OFICIALES);
    const truncada = completa.slice(0, completa.length - 3);
    expect(() => decodificarPolilinea(truncada)).not.toThrow();
    expect(decodificarPolilinea(truncada).length).toBeLessThan(3);
  });
});

describe("distancias", () => {
  it("la distancia total suma los tramos en linea recta", () => {
    const puntos = [
      { lat: 9.93, lng: -84.09 },
      { lat: 9.94, lng: -84.08 },
      { lat: 9.95, lng: -84.07 },
    ];
    const esperado = Math.round(
      (distanciaHaversineKm(puntos[0], puntos[1]) +
        distanciaHaversineKm(puntos[1], puntos[2])) *
        1000,
    );
    expect(distanciaTotalM(puntos)).toBe(esperado);
  });

  it("con menos de dos puntos la distancia es 0, nunca NaN", () => {
    expect(distanciaTotalM([])).toBe(0);
    expect(distanciaTotalM([{ lat: 9.93, lng: -84.09 }])).toBe(0);
  });
});
