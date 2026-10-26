import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};

function uniqByCoord(rows: any[]) {
  const seen = new Set<string>();
  return rows.filter((x: any) => {
    const k = Number(x.lat).toFixed(5) + "," + Number(x.lon).toFixed(5);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function photonLabel(p: any) {
  const parts = [
    p?.name,
    [p?.street, p?.housenumber].filter(Boolean).join(" "),
    p?.postcode,
    p?.city || p?.town || p?.village || p?.locality,
    p?.county,
    p?.state,
    p?.country
  ].filter(Boolean);
  return [...new Set(parts.map(String))].join(", ");
}

async function searchPhoton(q: string) {
  const params = new URLSearchParams({
    q,
    limit: "8",
    lang: "es",
    lat: "42.546",
    lon: "-6.596",
    zoom: "6"
  });

  const res = await fetch("https://photon.komoot.io/api/?" + params.toString(), {
    headers: { "Accept": "application/json", "Accept-Language": "es" }
  });
  if (!res.ok) throw new Error("Photon HTTP " + res.status);

  const data = await res.json();
  const features = Array.isArray(data?.features) ? data.features : [];
  return features.map((f: any) => {
    const coords = f?.geometry?.coordinates || [];
    const p = f?.properties || {};
    return {
      nombre: p?.name || null,
      display_name: photonLabel(p) || p?.name || q,
      lat: Number(coords[1]),
      lon: Number(coords[0]),
      tipo: p?.type || p?.osm_value || null,
      fuente: "photon"
    };
  }).filter((x: any) => Number.isFinite(x.lat) && Number.isFinite(x.lon));
}

async function searchOpenMeteo(q: string) {
  const params = new URLSearchParams({
    name: q,
    count: "10",
    language: "es",
    format: "json"
  });

  const res = await fetch("https://geocoding-api.open-meteo.com/v1/search?" + params.toString(), {
    headers: { "Accept": "application/json" }
  });
  if (!res.ok) throw new Error("OpenMeteo HTTP " + res.status);

  const data = await res.json();
  const rows = Array.isArray(data?.results) ? data.results : [];

  return rows
    .filter((x: any) => !x?.country_code || String(x.country_code).toUpperCase() === "ES")
    .map((x: any) => ({
      nombre: x?.name || null,
      display_name: [
        x?.name,
        x?.admin4,
        x?.admin3,
        x?.admin2,
        x?.admin1,
        x?.country
      ].filter(Boolean).filter((v: any, i: number, a: any[]) => a.indexOf(v) === i).join(", "),
      lat: Number(x?.latitude),
      lon: Number(x?.longitude),
      tipo: x?.feature_code || null,
      fuente: "open-meteo"
    }))
    .filter((x: any) => Number.isFinite(x.lat) && Number.isFinite(x.lon));
}

async function searchNominatim(q: string) {
  const params = new URLSearchParams({
    format: "jsonv2",
    addressdetails: "1",
    countrycodes: "es",
    limit: "8",
    q
  });

  const res = await fetch("https://nominatim.openstreetmap.org/search?" + params.toString(), {
    headers: {
      "Accept": "application/json",
      "Accept-Language": "es",
      "User-Agent": "DAFRICA-Control/1.0"
    }
  });
  if (!res.ok) throw new Error("Nominatim HTTP " + res.status);

  const rows = await res.json();
  return Array.isArray(rows) ? rows.map((x: any) => ({
    nombre: x?.name || null,
    display_name: x?.display_name || null,
    lat: Number(x?.lat),
    lon: Number(x?.lon),
    tipo: x?.type || null,
    fuente: "nominatim"
  })).filter((x: any) => Number.isFinite(x.lat) && Number.isFinite(x.lon)) : [];
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Método no permitido", results: [] }), { status: 405, headers: cors });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const q = String(body?.q || "").trim();
    if (!q) {
      return new Response(JSON.stringify({ error: "Escribe una dirección o lugar.", results: [] }), { status: 400, headers: cors });
    }

    // Variantes: texto completo y, para pueblos pequeños, el primer bloque antes de la coma.
    const variants = [...new Set([
      q,
      q.split(",")[0]?.trim(),
      q.replace(/\b(provincia de|comunidad de|castilla y le[oó]n|españa)\b/gi, "").replace(/\s+,/g, ",").trim()
    ].filter(Boolean))];

    let all: any[] = [];
    const providers: string[] = [];

    for (const v of variants) {
      if (all.length >= 8) break;

      try {
        const x = await searchPhoton(v);
        if (x.length) {
          all.push(...x);
          providers.push("photon");
        }
      } catch {}

      if (all.length < 8) {
        try {
          const x = await searchOpenMeteo(v);
          if (x.length) {
            all.push(...x);
            providers.push("open-meteo");
          }
        } catch {}
      }

      if (all.length < 8) {
        try {
          const x = await searchNominatim(v);
          if (x.length) {
            all.push(...x);
            providers.push("nominatim");
          }
        } catch {}
      }
    }

    all = uniqByCoord(all).slice(0, 8);

    return new Response(JSON.stringify({
      results: all,
      providers: [...new Set(providers)],
      query: q
    }), { status: 200, headers: cors });
  } catch (e) {
    return new Response(JSON.stringify({
      results: [],
      providers: [],
      error: e instanceof Error ? e.message : "Error al buscar la dirección."
    }), { status: 200, headers: cors });
  }
});
