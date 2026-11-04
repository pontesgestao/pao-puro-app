import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { brl, dataBr, rotuloVencimento, formatarLinha, copiar, useCarregar, hojeIso, diasAte } from '../util.js';
import { lerBoleto } from '../../../server/lib/boleto.js';
import { Cabecalho, Carregando, Erro, Folha, Vazio, useToast } from '../components/ui.jsx';
const Scanner = lazy(() => import('../components/Scanner.jsx'));

export default function Contas({ acao, limparAcao }) {
  const [aba, setAba] = useState('aberta');
  const lista = useCarregar(() => api(`/contas?status=${aba}`), [aba]);
  const [etapa, setEtapa] = useState(null); // scanner | digitar | form
  const [boleto, setBoleto] = useState(null);
  const [beneficiario, setBeneficiario] = useState('');
  const [aberta, setAberta] = useState(null);
  const [carregandoPdf, setCarregandoPdf] = useState(false);
  const [escolhaPdf, setEscolhaPdf] = useState(null);
  const inputPdf = useRef(null);
  const toast = useToast();

  useEffect(() => {
    if (acao === 'escanear') { setEtapa('scanner'); limparAcao(); }
  }, [acao, limparAcao]);

  const usarCodigo = async (codigo) => {
    try {
      const b = await api('/boletos/ler', { method: 'POST', body: { codigo } });
      if (!b.valido) { toast(b.erros[0] || 'Código inválido', 'erro'); return; }
      setBoleto(b); setBeneficiario(''); setEtapa('form');
    } catch (e) { toast(e.message, 'erro'); }
  };

  const importarPdf = async (e) => {
    const arq = e.target.files?.[0];
    e.target.value = '';
    if (!arq) return;
    setCarregandoPdf(true);
    try {
      const r = await api('/boletos/pdf', { method: 'POST', raw: await arq.arrayBuffer(), contentType: 'application/pdf' });
      if (!r.boletos.length) {
        toast('Não encontrei a linha digitável neste PDF. Use "Digitar".', 'erro');
      } else if (r.boletos.length === 1) {
        setBoleto(r.boletos[0]); setBeneficiario(r.beneficiario || ''); setEtapa('form');
      } else {
        setEscolhaPdf(r);
      }
    } catch (err) { toast(err.message, 'erro'); }
    setCarregandoPdf(false);
  };

  const pagar = async (c) => {
    await api(`/contas/${c.id}/pagar`, { method: 'POST', body: {} });
    toast(`${c.fornecedor || c.descricao} marcada como paga ✔`);
    setAberta(null); lista.recarregar();
  };

  // Agrupa contas abertas por situação
  const grupos = [];
  if (lista.dados && aba === 'aberta') {
    const add = (titulo, cls, itens) => itens.length && grupos.push({ titulo, cls, itens, total: itens.reduce((s, c) => s + c.valor, 0) });
    add('Em atraso', 'atrasada', lista.dados.filter((c) => diasAte(c.vencimento) < 0));
    add('Hoje', 'hoje', lista.dados.filter((c) => diasAte(c.vencimento) === 0));
    add('Próximos 7 dias', 'breve', lista.dados.filter((c) => { const d = diasAte(c.vencimento); return d > 0 && d <= 7; }));
    add('Mais adiante', '', lista.dados.filter((c) => diasAte(c.vencimento) > 7));
  } else if (lista.dados) {
    grupos.push({ titulo: 'Pagas', itens: lista.dados, total: lista.dados.reduce((s, c) => s + c.valor, 0) });
  }

  return (
    <div className="pagina">
      <Cabecalho titulo="Contas a pagar" sub="Boletos com aviso no WhatsApp no dia do vencimento" />

      <div className="grade-acoes">
        <button className="btn vermelho grande" onClick={() => setEtapa('scanner')}>📷 Ler código de barras do boleto</button>
        <div className="linha-botoes tres">
          <button className="btn" onClick={() => inputPdf.current.click()} disabled={carregandoPdf}>{carregandoPdf ? '⏳ Lendo…' : '📄 PDF'}</button>
          <button className="btn" onClick={() => setEtapa('digitar')}>⌨️ Digitar</button>
          <button className="btn" onClick={() => { setBoleto(null); setBeneficiario(''); setEtapa('form'); }}>✍️ Manual</button>
        </div>
        <input ref={inputPdf} type="file" accept="application/pdf,.pdf" hidden onChange={importarPdf} />
      </div>

      <div className="segmentos">
        <button className={aba === 'aberta' ? 'ativo' : ''} onClick={() => setAba('aberta')}>A pagar</button>
        <button className={aba === 'paga' ? 'ativo' : ''} onClick={() => setAba('paga')}>Pagas</button>
      </div>

      {lista.carregando && !lista.dados && <Carregando />}
      {lista.erro && <Erro texto={lista.erro} onTentar={lista.recarregar} />}
      {lista.dados?.length === 0 && (
        <Vazio icone={aba === 'aberta' ? '🎉' : '🗂️'} titulo={aba === 'aberta' ? 'Nenhuma conta em aberto' : 'Nenhuma conta paga ainda'}
          texto={aba === 'aberta' ? 'Leia o código de barras de um boleto para cadastrar.' : null} />
      )}

      {grupos.map((g) => (
        <section className="secao" key={g.titulo}>
          <h3 className={`grupo ${g.cls || ''}`}><span>{g.titulo}</span><span>{brl(g.total)}</span></h3>
          <ul className="lista">
            {g.itens.map((c) => {
              const r = rotuloVencimento(c.vencimento);
              return (
                <li key={c.id} className={`item conta ${aba === 'aberta' ? r.cls : ''}`} onClick={() => setAberta(c)}>
                  <div className="item-principal">
                    <strong>{c.fornecedor || c.descricao}</strong>
                    <span className="texto-suave">
                      {aba === 'paga' ? `Paga em ${dataBr(c.pago_em)}` : <>{dataBr(c.vencimento)} · <span className={`etiqueta ${r.cls}`}>{r.texto}</span></>}
                    </span>
                  </div>
                  <div className="item-lado"><strong>{brl(c.valor)}</strong></div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      {etapa === 'scanner' && (
        <Suspense fallback={<div className="scanner" />}><Scanner
          modo="boleto"
          titulo="Ler boleto"
          validar={(t) => lerBoleto(t).valido || 'Leitura incompleta, segure firme…'}
          onLido={(t) => { setEtapa(null); usarCodigo(t); }}
          onFechar={() => setEtapa(null)}
          onDigitar={() => setEtapa('digitar')}
        /></Suspense>
      )}
      {etapa === 'digitar' && <DigitarLinha onFechar={() => setEtapa(null)} onOk={(t) => { setEtapa(null); usarCodigo(t); }} />}
      {etapa === 'form' && (
        <FormConta boleto={boleto} beneficiario={beneficiario} onFechar={() => setEtapa(null)}
          onSalvo={(venc) => {
            setEtapa(null); setAba('aberta'); lista.recarregar();
            toast(diasAte(venc) === 0 ? 'Conta salva! Vence hoje – o aviso sai no WhatsApp.' : `Conta salva! Aviso no WhatsApp em ${dataBr(venc)}.`);
          }} />
      )}
      {escolhaPdf && (
        <Folha titulo="Vários boletos no PDF" onFechar={() => setEscolhaPdf(null)}>
          <p className="texto-suave">Escolha qual cadastrar:</p>
          <ul className="lista">
            {escolhaPdf.boletos.map((b) => (
              <li key={b.codigoBarras} className="item" onClick={() => { setBoleto(b); setBeneficiario(escolhaPdf.beneficiario || ''); setEscolhaPdf(null); setEtapa('form'); }}>
                <div className="item-principal"><strong>{brl(b.valor)}</strong><span className="texto-suave">vence {dataBr(b.vencimento)}</span></div>
                <div className="item-lado">{b.jaCadastrado ? 'já cadastrado' : '›'}</div>
              </li>
            ))}
          </ul>
        </Folha>
      )}
      {aberta && <DetalheConta c={aberta} onFechar={() => setAberta(null)} onPagar={pagar} onMudou={() => { setAberta(null); lista.recarregar(); }} />}
    </div>
  );
}

function DigitarLinha({ onFechar, onOk }) {
  const [v, setV] = useState('');
  const d = v.replace(/\D/g, '');
  const b = [44, 47, 48].includes(d.length) ? lerBoleto(d) : null;
  return (
    <Folha titulo="Digitar linha digitável" onFechar={onFechar}
      rodape={<button className="btn primario grande" disabled={!b?.valido} onClick={() => onOk(d)}>Continuar</button>}>
      <label className="campo">
        <span>Números do boleto (pode colar do e-mail ou do app do banco)</span>
        <textarea rows={3} inputMode="numeric" value={v} onChange={(e) => setV(e.target.value)} placeholder="00190.00009 01234.567890 12345.678901 2 12340000010000" autoFocus />
      </label>
      <p className="texto-suave">
        {d.length} dígitos
        {b && !b.valido && <span className="texto-vermelho"> · {b.erros[0]}</span>}
        {b?.valido && <span className="texto-verde"> · ✔ {brl(b.valor)}{b.vencimento && ` · vence ${dataBr(b.vencimento)}`}</span>}
      </p>
    </Folha>
  );
}

function FormConta({ boleto, beneficiario, onFechar, onSalvo }) {
  const [f, setF] = useState({
    fornecedor: beneficiario || '',
    descricao: '',
    valor: boleto?.valor ?? '',
    vencimento: boleto?.vencimento || hojeIso(),
    observacao: '',
  });
  const [erro, setErro] = useState(null);
  const [salvando, setSalvando] = useState(false);

  const salvar = async () => {
    setSalvando(true); setErro(null);
    try {
      await api('/contas', {
        method: 'POST',
        body: { ...f, valor: Number(f.valor), linha_digitavel: boleto?.linhaDigitavel, codigo_barras: boleto?.codigoBarras },
      });
      onSalvo(f.vencimento);
    } catch (e) { setErro(e.message); setSalvando(false); }
  };

  return (
    <Folha titulo={boleto ? 'Novo boleto' : 'Nova conta'} onFechar={onFechar}
      rodape={<button className="btn primario grande" disabled={salvando || !f.valor || !f.vencimento || !(f.fornecedor || f.descricao)} onClick={salvar}>{salvando ? 'Salvando…' : 'Salvar conta'}</button>}>
      {boleto && (
        <div className="boleto-lido">
          <span className="texto-suave">{boleto.banco}</span>
          <code>{formatarLinha(boleto.linhaDigitavel)}</code>
        </div>
      )}
      {boleto?.jaCadastrado && <div className="alerta aviso">Este boleto já está cadastrado ({boleto.jaCadastrado.descricao}).</div>}
      {boleto && !boleto.vencimento && <div className="alerta aviso">Este tipo de boleto não informa o vencimento no código. Confira a data abaixo.</div>}
      <label className="campo"><span>Fornecedor / beneficiário</span>
        <input value={f.fornecedor} onChange={(e) => setF({ ...f, fornecedor: e.target.value })} placeholder="Ex.: Moinho Santa Clara" autoFocus /></label>
      <div className="linha-campos">
        <label className="campo"><span>Valor (R$)</span>
          <input type="number" inputMode="decimal" step="0.01" value={f.valor} onChange={(e) => setF({ ...f, valor: e.target.value })} /></label>
        <label className="campo"><span>Vencimento</span>
          <input type="date" value={f.vencimento} onChange={(e) => setF({ ...f, vencimento: e.target.value })} /></label>
      </div>
      <label className="campo"><span>Descrição (opcional)</span>
        <input value={f.descricao} onChange={(e) => setF({ ...f, descricao: e.target.value })} placeholder="Ex.: Farinha – NF 1234" /></label>
      {erro && <Erro texto={erro} />}
    </Folha>
  );
}

function DetalheConta({ c, onFechar, onPagar, onMudou }) {
  const toast = useToast();
  const [confirmarExclusao, setConfirmarExclusao] = useState(false);
  const r = rotuloVencimento(c.vencimento);

  const textoWhats = `🍞 Pão Puro – boleto ${c.fornecedor || c.descricao}\nValor: ${brl(c.valor)}\nVencimento: ${dataBr(c.vencimento)}${c.linha_digitavel ? `\nCódigo: ${c.linha_digitavel}` : ''}`;

  return (
    <Folha titulo={c.fornecedor || c.descricao} onFechar={onFechar}
      rodape={c.status === 'aberta' ? (
        <button className="btn primario grande" onClick={() => onPagar(c)}>✔ Marcar como paga</button>
      ) : (
        <button className="btn grande" onClick={async () => { await api(`/contas/${c.id}/reabrir`, { method: 'POST' }); onMudou(); }}>Desfazer pagamento</button>
      )}>
      <div className="valor-grande">
        <strong>{brl(c.valor)}</strong>
        {c.status === 'aberta' ? <span className={`etiqueta ${r.cls}`}>{r.texto}</span> : <span className="etiqueta paga">Paga em {dataBr(c.pago_em)}</span>}
      </div>
      <dl className="dados">
        <dt>Vencimento</dt><dd>{dataBr(c.vencimento)}</dd>
        {c.descricao && c.descricao !== c.fornecedor && (<><dt>Descrição</dt><dd>{c.descricao}</dd></>)}
      </dl>
      {c.linha_digitavel && (
        <div className="boleto-lido">
          <code>{formatarLinha(c.linha_digitavel)}</code>
          <button className="btn primario" onClick={async () => { await copiar(c.linha_digitavel); toast('Código copiado! Cole no app do banco.'); }}>📋 Copiar código de barras</button>
        </div>
      )}
      <div className="linha-botoes">
        <a className="btn" href={`https://wa.me/?text=${encodeURIComponent(textoWhats)}`} target="_blank" rel="noreferrer">💬 Enviar no WhatsApp</a>
        {confirmarExclusao
          ? <button className="btn perigo" onClick={async () => { await api(`/contas/${c.id}`, { method: 'DELETE' }); onMudou(); }}>Confirmar</button>
          : <button className="btn perigo-claro" onClick={() => setConfirmarExclusao(true)}>🗑 Excluir</button>}
      </div>
    </Folha>
  );
}
