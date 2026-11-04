import { useEffect, useState } from 'react';
import { api, setToken } from '../api.js';
import { useCarregar } from '../util.js';
import { Cabecalho, Carregando, Erro, useToast } from '../components/ui.jsx';

const NOMES_PROVEDOR = {
  meta: 'WhatsApp Cloud API (Meta)',
  zapi: 'Z-API',
  evolution: 'Evolution API',
  callmebot: 'CallMeBot (grátis)',
  console: 'Modo teste (sem envio real)',
};

export default function Ajustes({ onSair }) {
  const cfg = useCarregar(() => api('/config'));
  const previa = useCarregar(() => api('/avisos/previa'));
  const [f, setF] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const toast = useToast();

  useEffect(() => { if (cfg.dados && !f) setF(cfg.dados); }, [cfg.dados, f]);

  const salvar = async () => {
    try {
      await api('/config', { method: 'PUT', body: {
        whatsapp_numeros: f.whatsapp_numeros, aviso_horario: f.aviso_horario,
        aviso_dia_anterior: f.aviso_dia_anterior, aviso_atrasadas: f.aviso_atrasadas,
      } });
      toast('Configurações salvas');
      previa.recarregar();
    } catch (e) { toast(e.message, 'erro'); }
  };

  const testar = async () => {
    setEnviando(true);
    try {
      await salvar();
      const r = await api('/avisos/teste', { method: 'POST' });
      if (r.motivo) toast(r.motivo, 'erro');
      else if (r.resultados?.every((x) => x.ok)) toast('Mensagem de teste enviada ✔');
      else toast(`Falha: ${r.resultados?.find((x) => !x.ok)?.erro}`, 'erro');
      cfg.recarregar();
    } catch (e) { toast(e.message, 'erro'); }
    setEnviando(false);
  };

  const tg = cfg.dados?.telegram;
  const temDestino = !!f?.whatsapp_numeros.trim() || (tg?.chats?.length > 0);

  const desconectar = async (chat) => {
    try { await api(`/telegram/chats/${chat.id}`, { method: 'DELETE' }); cfg.recarregar(); toast(`${chat.nome} desconectado`); }
    catch (e) { toast(e.message, 'erro'); }
  };

  return (
    <div className="pagina">
      <Cabecalho titulo="Ajustes" sub="Avisos de contas e preferências" />
      {cfg.carregando && !f && <Carregando />}
      {cfg.erro && <Erro texto={cfg.erro} onTentar={cfg.recarregar} />}

      {f && (
        <>
          <section className="secao">
            <h3>Aviso pelo Telegram (grátis)</h3>
            <div className="cartao">
              {!tg?.ativo && (
                <p className="texto-suave">
                  Desativado. Para ligar, crie um robô no Telegram com o <b>@BotFather</b> e coloque o token dele na
                  variável <code>TELEGRAM_BOT_TOKEN</code> do servidor (veja o README).
                </p>
              )}
              {tg?.ativo && tg.erro && <div className="alerta erro">{tg.erro}</div>}
              {tg?.ativo && tg.link && (
                <>
                  <p className="texto-suave" style={{ marginTop: 0 }}>
                    Toque no botão <b>no celular de quem vai receber os avisos</b>. O Telegram abre: toque em <b>Iniciar</b> e pronto.
                  </p>
                  <a className="btn primario grande" href={tg.link} target="_blank" rel="noreferrer">✈️ Conectar meu Telegram</a>
                  <h4>Recebendo avisos ({tg.chats.length})</h4>
                  {tg.chats.length === 0 && <p className="texto-suave">Ninguém conectado ainda. Depois de tocar em Iniciar no Telegram, volte aqui e atualize.</p>}
                  <ul className="lista compacta">
                    {tg.chats.map((c) => (
                      <li key={c.id} className="item">
                        <div className="item-principal"><strong>{c.nome}</strong></div>
                        <button className="btn-link" onClick={() => desconectar(c)}>Remover</button>
                      </li>
                    ))}
                  </ul>
                  <button className="btn-link" onClick={cfg.recarregar}>🔄 Atualizar lista</button>
                </>
              )}
            </div>
          </section>

          <section className="secao">
            <h3>Horário do aviso e WhatsApp</h3>
            <div className="cartao">
              <label className="campo">
                <span>{cfg.dados?.provedor === 'callmebot'
                  ? 'Números que recebem o aviso, cada um com sua chave do CallMeBot (um por linha)'
                  : 'Números de WhatsApp que recebem o aviso (um por linha, com DDD)'}{tg?.ativo && ' – opcional'}</span>
                <textarea rows={3} value={f.whatsapp_numeros} onChange={(e) => setF({ ...f, whatsapp_numeros: e.target.value })}
                  placeholder={cfg.dados?.provedor === 'callmebot' ? '(11) 98765-4321 = 123456\n(11) 91234-5678 = 654321' : '(11) 98765-4321\n(11) 91234-5678'} inputMode="tel" />
              </label>
              <label className="campo">
                <span>Horário do aviso</span>
                <input type="time" value={f.aviso_horario} onChange={(e) => setF({ ...f, aviso_horario: e.target.value })} />
              </label>
              <label className="check">
                <input type="checkbox" checked={f.aviso_dia_anterior === '1'} onChange={(e) => setF({ ...f, aviso_dia_anterior: e.target.checked ? '1' : '0' })} />
                <span>Avisar também um dia antes do vencimento</span>
              </label>
              <label className="check">
                <input type="checkbox" checked={f.aviso_atrasadas === '1'} onChange={(e) => setF({ ...f, aviso_atrasadas: e.target.checked ? '1' : '0' })} />
                <span>Lembrar das contas em atraso</span>
              </label>
              <div className="linha-botoes">
                <button className="btn primario" onClick={salvar}>Salvar</button>
                <button className="btn" onClick={testar} disabled={enviando || !temDestino}>{enviando ? 'Enviando…' : '📤 Enviar teste'}</button>
              </div>
              <p className="texto-suave">
                Serviço de envio: <b>{NOMES_PROVEDOR[cfg.dados?.provedor] || cfg.dados?.provedor}</b>
                {cfg.dados?.provedor === 'console' && ' – configure o provedor no servidor para enviar de verdade.'}
                {cfg.dados?.provedor === 'callmebot' && <> – cada número precisa ativar o CallMeBot e pegar a sua chave (veja o passo a passo no README).</>}
              </p>
            </div>
          </section>

          <section className="secao">
            <h3>Prévia da mensagem de hoje</h3>
            <pre className="previa-whats">{previa.dados?.texto || '…'}</pre>
          </section>

          {cfg.dados?.log?.length > 0 && (
            <section className="secao">
              <h3>Últimos envios</h3>
              <ul className="lista compacta">
                {cfg.dados.log.map((l) => (
                  <li key={l.id} className="item">
                    <div className="item-principal">
                      <strong>{l.telefone}</strong>
                      <span className="texto-suave">{new Date(l.criado_em + 'Z').toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}{l.detalhe ? ` · ${l.detalhe}` : ''}</span>
                    </div>
                    <div className="item-lado">{l.sucesso ? '✅' : '❌'}</div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      <section className="secao">
        <h3>Instalar no celular</h3>
        <div className="cartao texto-suave">
          <p><b>Android (Chrome):</b> menu ⋮ → <i>Instalar app</i> ou <i>Adicionar à tela inicial</i>.</p>
          <p><b>iPhone (Safari):</b> botão Compartilhar → <i>Adicionar à Tela de Início</i>.</p>
        </div>
      </section>

      <button className="btn perigo-claro grande" onClick={() => { setToken(null); onSair(); }}>Sair</button>
      <p className="rodape-marca">Pão Puro · desde 1973</p>
    </div>
  );
}
