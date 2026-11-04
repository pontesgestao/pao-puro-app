// Aviso diário por WhatsApp das contas que vencem hoje (e, opcionalmente, amanhã e atrasadas).
import cron from 'node-cron';
import { db, getConfig, setConfig } from './db.js';
import { enviarWhatsApp } from './lib/whatsapp.js';

export const TZ = process.env.TZ_APP || 'America/Sao_Paulo';

/** Data (AAAA-MM-DD) e hora (HH:MM) atuais no fuso da padaria. */
export function agoraLocal(d = new Date()) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(d).map((x) => [x.type, x.value]),
  );
  return { data: `${p.year}-${p.month}-${p.day}`, hora: `${p.hour}:${p.minute}` };
}

const somaDias = (iso, n) => {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const brl = (v) => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBr = (iso) => iso.split('-').reverse().join('/');

/** Monta a mensagem do dia. Retorna null se não houver nada a avisar. */
export function montarMensagem(hoje = agoraLocal().data, cfg = getConfig()) {
  const deHoje = db.prepare("SELECT * FROM contas WHERE status = 'aberta' AND vencimento = ? ORDER BY valor DESC").all(hoje);
  const amanha = cfg.aviso_dia_anterior === '1'
    ? db.prepare("SELECT * FROM contas WHERE status = 'aberta' AND vencimento = ? ORDER BY valor DESC").all(somaDias(hoje, 1))
    : [];
  const atrasadas = cfg.aviso_atrasadas === '1'
    ? db.prepare("SELECT * FROM contas WHERE status = 'aberta' AND vencimento < ? ORDER BY vencimento").all(hoje)
    : [];
  if (!deHoje.length && !amanha.length && !atrasadas.length) return null;

  const linha = (c) => `• ${c.fornecedor || c.descricao} – *${brl(c.valor)}*` +
    (c.linha_digitavel ? `\n  ${c.linha_digitavel}` : '');
  const total = (l) => l.reduce((s, c) => s + c.valor, 0);

  const partes = [`🍞 *Pão Puro – Contas a pagar*`, ''];
  if (deHoje.length) {
    partes.push(`📌 *Vencem HOJE (${dataBr(hoje)})* – ${brl(total(deHoje))}`, ...deHoje.map(linha), '');
  }
  if (amanha.length) {
    partes.push(`⏰ *Vencem amanhã (${dataBr(somaDias(hoje, 1))})* – ${brl(total(amanha))}`, ...amanha.map(linha), '');
  }
  if (atrasadas.length) {
    partes.push(`⚠️ *Em atraso* – ${brl(total(atrasadas))}`,
      ...atrasadas.map((c) => `• ${c.fornecedor || c.descricao} – ${brl(c.valor)} (venceu ${dataBr(c.vencimento)})`), '');
  }
  partes.push('Abra o app para copiar o código de barras e marcar como pago.');

  // Parâmetros para o template oficial da Meta (sem quebras de linha)
  const resumo = deHoje.map((c) => `${c.fornecedor || c.descricao} ${brl(c.valor)}`).join('; ') || 'nenhuma';
  return {
    texto: partes.join('\n'),
    params: [String(deHoje.length), brl(total(deHoje)), resumo],
    qtd: deHoje.length + amanha.length + atrasadas.length,
  };
}

/** Envia o aviso para todos os números cadastrados. */
export async function enviarAvisos({ forcar = false } = {}) {
  const cfg = getConfig();
  const { data } = agoraLocal();
  const numeros = cfg.whatsapp_numeros.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean);
  if (!numeros.length) return { enviado: false, motivo: 'Nenhum número de WhatsApp cadastrado.' };

  const msg = montarMensagem(data, cfg);
  if (!msg && !forcar) {
    setConfig({ ultimo_aviso: data });
    return { enviado: false, motivo: 'Nenhuma conta para avisar hoje.' };
  }
  const mensagem = msg || {
    texto: '🍞 *Pão Puro*\nTeste de aviso: nenhuma conta vence hoje. ✅',
    params: ['0', 'R$ 0,00', 'nenhuma'],
  };

  const log = db.prepare('INSERT INTO avisos_log (data, telefone, sucesso, detalhe) VALUES (?, ?, ?, ?)');
  const resultados = [];
  for (const tel of numeros) {
    try {
      await enviarWhatsApp(tel, mensagem);
      log.run(data, tel, 1, null);
      resultados.push({ telefone: tel, ok: true });
    } catch (e) {
      log.run(data, tel, 0, String(e.message).slice(0, 500));
      resultados.push({ telefone: tel, ok: false, erro: e.message });
    }
  }
  if (!forcar) setConfig({ ultimo_aviso: data });
  return { enviado: resultados.some((r) => r.ok), resultados, texto: mensagem.texto };
}

/** A cada 5 minutos verifica se já passou do horário e se o aviso de hoje já saiu. */
export function iniciarAgendador() {
  const verificar = async () => {
    try {
      const cfg = getConfig();
      const { data, hora } = agoraLocal();
      if (cfg.ultimo_aviso === data || hora < (cfg.aviso_horario || '08:00')) return;
      const r = await enviarAvisos();
      console.log(`[avisos] ${data} ${hora}:`, r.motivo || JSON.stringify(r.resultados));
    } catch (e) {
      console.error('[avisos] erro', e);
    }
  };
  cron.schedule('*/5 * * * *', verificar, { timezone: TZ });
  setTimeout(verificar, 5000);
}
