// Envio de mensagens de WhatsApp. O provedor é escolhido pela variável WHATSAPP_PROVIDER:
//   meta      – WhatsApp Cloud API oficial (Meta). Exige modelo (template) aprovado.
//   zapi      – Z-API (z-api.io)
//   evolution – Evolution API (auto-hospedada)
//   console   – apenas imprime no log (padrão, útil para testes)
import { soDigitos } from './boleto.js';

const env = (k, d = '') => process.env[k] ?? d;

export function provedorAtual() {
  return env('WHATSAPP_PROVIDER', 'console').toLowerCase();
}

/** Normaliza um telefone para o formato internacional só com dígitos (55 + DDD + número). */
export function normalizarTelefone(tel) {
  let d = soDigitos(tel);
  if (d.startsWith('0')) d = d.replace(/^0+/, '');
  if (d.length === 10 || d.length === 11) d = '55' + d;
  return d;
}

async function postJson(url, body, headers = {}) {
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  const txt = await resp.text();
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${txt.slice(0, 300)}`);
  try { return JSON.parse(txt); } catch { return txt; }
}

/**
 * Envia o aviso.
 * @param {string} telefone
 * @param {{texto: string, params: string[]}} msg  texto livre + parâmetros do template (Meta)
 */
export async function enviarWhatsApp(telefone, msg) {
  const para = normalizarTelefone(telefone);
  const provedor = provedorAtual();

  if (provedor === 'meta') {
    const url = `https://graph.facebook.com/${env('META_API_VERSION', 'v21.0')}/${env('META_PHONE_NUMBER_ID')}/messages`;
    const template = env('META_TEMPLATE_NAME');
    const body = template
      ? {
          messaging_product: 'whatsapp', to: para, type: 'template',
          template: {
            name: template,
            language: { code: env('META_TEMPLATE_LANG', 'pt_BR') },
            components: [{
              type: 'body',
              // Templates da Meta não aceitam quebra de linha nos parâmetros
              parameters: msg.params.map((p) => ({ type: 'text', text: String(p).replace(/\s*\n\s*/g, ' | ').slice(0, 1000) })),
            }],
          },
        }
      : { messaging_product: 'whatsapp', to: para, type: 'text', text: { body: msg.texto } };
    return postJson(url, body, { Authorization: `Bearer ${env('META_ACCESS_TOKEN')}` });
  }

  if (provedor === 'zapi') {
    const url = `https://api.z-api.io/instances/${env('ZAPI_INSTANCE')}/token/${env('ZAPI_TOKEN')}/send-text`;
    const headers = env('ZAPI_CLIENT_TOKEN') ? { 'Client-Token': env('ZAPI_CLIENT_TOKEN') } : {};
    return postJson(url, { phone: para, message: msg.texto }, headers);
  }

  if (provedor === 'evolution') {
    const base = env('EVOLUTION_URL').replace(/\/$/, '');
    const url = `${base}/message/sendText/${env('EVOLUTION_INSTANCE')}`;
    return postJson(url, { number: para, text: msg.texto }, { apikey: env('EVOLUTION_API_KEY') });
  }

  console.log(`[whatsapp:console] para ${para}:\n${msg.texto}\n`);
  return { simulado: true };
}
