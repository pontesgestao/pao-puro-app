// Aviso pelo Telegram (grátis). Ativado quando TELEGRAM_BOT_TOKEN está definido.
// Quem quiser receber os avisos toca em "Conectar meu Telegram" no app: isso abre o robô com um
// código secreto (/start <código>) e o servidor guarda o chat dessa pessoa.
import { randomBytes } from 'node:crypto';
import { getConfig, setConfig } from '../db.js';

const token = () => process.env.TELEGRAM_BOT_TOKEN || '';
export const telegramAtivo = () => !!token();

let nomeRobo = null;

async function chamar(metodo, params = {}, timeoutMs = 20000) {
  const resp = await fetch(`https://api.telegram.org/bot${token()}/${metodo}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const j = await resp.json().catch(() => ({}));
  if (!j.ok) throw new Error(`Telegram: ${j.description || 'HTTP ' + resp.status}`);
  return j.result;
}

export function listarChats() {
  try { return JSON.parse(getConfig().telegram_chats || '[]'); } catch { return []; }
}
const salvarChats = (chats) => setConfig({ telegram_chats: JSON.stringify(chats) });

export function removerChat(id) {
  salvarChats(listarChats().filter((c) => String(c.id) !== String(id)));
}

function codigoConexao() {
  let { telegram_codigo: c } = getConfig();
  if (!c) {
    c = randomBytes(9).toString('base64url');
    setConfig({ telegram_codigo: c });
  }
  return c;
}

export async function infoTelegram() {
  if (!telegramAtivo()) return { ativo: false, chats: [] };
  if (!nomeRobo) {
    try { nomeRobo = (await chamar('getMe')).username; } catch (e) { return { ativo: true, erro: e.message, chats: listarChats() }; }
  }
  return { ativo: true, robo: nomeRobo, link: `https://t.me/${nomeRobo}?start=${codigoConexao()}`, chats: listarChats() };
}

/** Envia texto. A mensagem usa *negrito* (Markdown); se o Telegram recusar a formatação, envia sem ela. */
export async function enviarTelegram(chatId, texto) {
  try {
    return await chamar('sendMessage', { chat_id: chatId, text: texto, parse_mode: 'Markdown', disable_web_page_preview: true });
  } catch (e) {
    if (!/parse|entities/i.test(e.message)) throw e;
    return chamar('sendMessage', { chat_id: chatId, text: texto.replace(/\*/g, ''), disable_web_page_preview: true });
  }
}

/** Trata uma mensagem recebida pelo robô. Exportada para testes. */
export async function tratarMensagem(msg, { mensagemDoDia } = {}) {
  const texto = String(msg?.text || '').trim();
  const chat = msg?.chat;
  if (!chat) return;
  const conectado = listarChats().some((c) => String(c.id) === String(chat.id));

  if (texto.startsWith('/start')) {
    const codigo = texto.split(/\s+/)[1];
    if (codigo && codigo === getConfig().telegram_codigo) {
      if (!conectado) {
        const nome = [chat.first_name, chat.last_name].filter(Boolean).join(' ') || chat.title || chat.username || String(chat.id);
        salvarChats([...listarChats(), { id: chat.id, nome }]);
      }
      return enviarTelegram(chat.id, '✅ *Pronto!* Você vai receber aqui os avisos das contas a pagar da *Pão Puro*.\n\nEnvie /contas a qualquer momento para ver o que vence hoje.');
    }
    if (!conectado) return enviarTelegram(chat.id, 'Para receber os avisos, abra o app da Pão Puro → Ajustes → *Conectar meu Telegram*.');
  }

  if (!conectado) return;
  if (texto.startsWith('/contas')) {
    return enviarTelegram(chat.id, mensagemDoDia?.() || '✅ Nenhuma conta vencendo hoje nem em atraso.');
  }
  if (texto.startsWith('/sair')) {
    removerChat(chat.id);
    return enviarTelegram(chat.id, 'Você não vai mais receber avisos. Para voltar, use o botão no app.');
  }
  return enviarTelegram(chat.id, 'Comandos: /contas – contas de hoje · /sair – parar de receber avisos');
}

/** Fica ouvindo as mensagens enviadas ao robô (long polling). */
export async function iniciarTelegram(opcoes) {
  if (!telegramAtivo()) return;
  try {
    await chamar('deleteWebhook');
    await chamar('setMyCommands', { commands: [
      { command: 'contas', description: 'Contas que vencem hoje' },
      { command: 'sair', description: 'Parar de receber avisos' },
    ] }).catch(() => {});
    const info = await infoTelegram();
    console.log(`[telegram] robô @${info.robo} ativo`);
  } catch (e) {
    console.error('[telegram] não foi possível iniciar:', e.message);
  }
  let offset = 0;
  for (;;) {
    try {
      const updates = await chamar('getUpdates', { offset, timeout: 50, allowed_updates: ['message'] }, 65000);
      for (const u of updates) {
        offset = u.update_id + 1;
        await tratarMensagem(u.message, opcoes).catch((e) => console.error('[telegram]', e.message));
      }
    } catch (e) {
      console.error('[telegram] erro ao buscar mensagens:', e.message);
      await new Promise((r) => setTimeout(r, 10000));
    }
  }
}
