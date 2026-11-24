// DAFRICA SAT · configuración. En local (localhost) habla con el emulador de pruebas, nunca con producción.
const local = ["localhost", "127.0.0.1"].includes(location.hostname);

export const CONFIG = {
  local,
  supabaseUrl: local ? location.origin : "https://sbocfjxamjmwabmqbeyw.supabase.co",
  // Clave PÚBLICA de Supabase (la misma que usa DAFRICA Control): sin sesión no da acceso a nada.
  supabaseKey: local ? "anon-local" : "sb_publishable_fb3jW4X72iBoPs_bfUA6Dw_y5_z06r0",
  // Misma sesión que DAFRICA Control: quien ya ha entrado allí no tiene que volver a entrar.
  sesionClave: "dafrica_web_session",
  loginProduccion: "../?mod=sat",
  version: "0.3.18",
};
