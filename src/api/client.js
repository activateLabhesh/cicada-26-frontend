import { supabase } from "../lib/supabase";

const API_URL = import.meta.env.VITE_API_URL || `http://${window.location.hostname}:5000`;

export function getAdminKey() {
  return localStorage.getItem("cicada_admin_secret_key") || sessionStorage.getItem("cicada_admin_secret_key");
}

function setAdminKey(value) {
  if (value) {
    sessionStorage.setItem("cicada_admin_secret_key", value);
    localStorage.setItem("cicada_admin_secret_key", value);
  } else {
    sessionStorage.removeItem("cicada_admin_secret_key");
    localStorage.removeItem("cicada_admin_secret_key");
  }
}

let cachedToken = null;
let tokenExpiresAt = 0;

if (typeof window !== "undefined") {
  supabase.auth.getSession().then(({ data }) => {
    if (data?.session?.access_token) {
      cachedToken = data.session.access_token;
      tokenExpiresAt = data.session.expires_at ? data.session.expires_at * 1000 : Date.now() + 3600 * 1000;
    }
  });

  supabase.auth.onAuthStateChange((_event, session) => {
    if (session?.access_token) {
      cachedToken = session.access_token;
      tokenExpiresAt = session.expires_at ? session.expires_at * 1000 : Date.now() + 3600 * 1000;
    } else {
      cachedToken = null;
      tokenExpiresAt = 0;
    }
  });
}

export async function getValidToken(force = false) {
  if (!force && cachedToken && Date.now() < tokenExpiresAt - 30000) {
    return cachedToken;
  }
  try {
    const { data } = await supabase.auth.getSession();
    if (data?.session?.access_token) {
      cachedToken = data.session.access_token;
      tokenExpiresAt = data.session.expires_at ? data.session.expires_at * 1000 : Date.now() + 3600 * 1000;
      return cachedToken;
    }
  } catch {
    /* ignore session error */
  }
  return null;
}

export async function api(path, { method = "GET", body, admin = false } = {}) {
  const headers = {};

  const isFormData = typeof FormData !== "undefined" && body instanceof FormData;
  if (!isFormData) {
    headers["Content-Type"] = "application/json";
  }

  const token = await getValidToken();
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  if (admin) {
    const key = getAdminKey();
    if (key) headers["x-admin-key"] = key;
  }

  let res;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers,
      credentials: "include",
      body: body ? (isFormData ? body : JSON.stringify(body)) : undefined,
    });
  } catch (netErr) {
    throw new Error(`[Network Error: ${method} ${path}] Unable to connect to backend server at ${API_URL}. Details: ${netErr.message}`);
  }

  let json = null;
  try {
    json = await res.json();
  } catch {
    /* non-JSON response */
  }

  if (!res.ok) {
    let msg = "";
    if (json) {
      if (typeof json === "string") {
        msg = json;
      } else {
        const errorField = json.error || json.message || json.msg;
        const detailsField = json.detail || json.details || json.errors || json.validation_errors || json.data;
        
        let formattedDetails = "";
        if (detailsField) {
          if (Array.isArray(detailsField)) {
            formattedDetails = detailsField.map(d => {
              if (typeof d === "object" && d !== null) {
                const p = d.path?.join(".") || d.loc?.join(".") || d.field || "";
                const text = d.message || d.msg || JSON.stringify(d);
                return p ? `[${p}] ${text}` : text;
              }
              return String(d);
            }).join("; ");
          } else if (typeof detailsField === "object") {
            formattedDetails = Object.entries(detailsField).map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`).join("; ");
          } else {
            formattedDetails = String(detailsField);
          }
        }

        if (errorField && formattedDetails && errorField !== formattedDetails) {
          msg = `${errorField}: ${formattedDetails}`;
        } else {
          msg = formattedDetails || errorField || JSON.stringify(json);
        }
      }
    }
    const err = new Error(`[HTTP ${res.status} on ${method} ${path}] ${msg || res.statusText || 'Request failed'}`);
    err.status = res.status;
    err.data = json;
    err.endpoint = `${method} ${path}`;
    throw err;
  }
  return json;
}

export { API_URL, setAdminKey };
