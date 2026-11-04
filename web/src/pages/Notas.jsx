import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { brl, dataBr, num, cnpjFmt, useCarregar, lerArquivo } from '../util.js';
import { Cabecalho, Carregando, Erro, Folha, Vazio, useToast } from '../components/ui.jsx';
const Scanner = lazy(() => import('../components/Scanner.jsx'));

function chaveValida(c) {
  const d = String(c).replace(/\D/g, '');
  if (d.length !== 44) return false;
  let s = 0, p = 2;
  for (let i = 42; i >= 0; i--) { s += +d[i] * p; p = p === 9 ? 2 : p + 1; }
  const r = s % 11;
  return (r < 2 ? 0 : 11 - r) === +d[43];
}

export default function Notas({ acao, limparAcao }) {
  const lista = useCarregar(() => api('/notas'));
  const [etapa, setEtapa] = useState(null); // scanner | digitar | carregando | chave | revisao
  const [msgCarregando, setMsgCarregando] = useState('');
  const [identificado, setIdentificado] = useState(null);
  const [nota, setNota] = useState(null);
  const [origem, setOrigem] = useState(null);
  const [erro, setErro] = useState(null);
  const [detalhe, setDetalhe] = useState(null);
  const inputXml = useRef(null);
  const toast = useToast();

  useEffect(() => {
    if (acao === 'escanear') { setEtapa('scanner'); limparAcao(); }
  }, [acao, limparAcao]);

  const processarCodigo = async (codigo) => {
    setErro(null);
    setEtapa('carregando');
    setMsgCarregando('Identificando a nota…');
    try {
      const id = await api('/notas/identificar', { method: 'POST', body: { codigo } });
      setIdentificado(id);
      if (id.jaImportada) {
        setErro(`Esta nota já foi lançada no estoque em ${dataBr(id.jaImportada.criado_em)}.`);
        setEtapa('chave');
        return;
      }
      if (id.tipo === 'qrcode-nfce') {
        setMsgCarregando('Consultando a nota na SEFAZ…');
        try {
          const n = await api('/notas/consultar', { method: 'POST', body: { url: id.url } });
          setNota(n); setOrigem('qrcode'); setEtapa('revisao');
        } catch (e) {
          setErro(e.message);
          setEtapa('chave');
        }
        return;
      }
      if (id.tipo === 'desconhecido') {
        setErro('Esse código não parece ser de uma nota fiscal.');
        setEtapa(null);
        return;
      }
      setEtapa('chave');
    } catch (e) {
      setErro(e.message);
      setEtapa(null);
    }
  };

  const importarXml = async (e) => {
    const arq = e.target.files?.[0];
    e.target.value = '';
    if (!arq) return;
    setErro(null);
    setEtapa('carregando');
    setMsgCarregando('Lendo o XML…');
    try {
      const xml = await lerArquivo(arq, true);
      const n = await api('/notas/xml', { method: 'POST', body: { xml } });
      if (n.jaImportada) throw new Error(`Esta nota já foi lançada em ${dataBr(n.jaImportada.criado_em)}.`);
      setNota(n); setOrigem('xml'); setEtapa('revisao');
    } catch (err) {
      setErro(err.message);
      setEtapa(null);
    }
  };

  const lancarManual = async () => {
    setErro(null);
    try {
      const n = await api('/notas/manual', { method: 'POST', body: { chave: identificado?.chave || null } });
      setNota(n); setOrigem('manual'); setEtapa('revisao');
    } catch (e) { setErro(e.message); }
  };

  const fechar = () => { setEtapa(null); setNota(null); setIdentificado(null); };

  if (etapa === 'revisao' && nota) {
    return (
      <RevisaoNota
        nota={nota}
        origem={origem}
        onCancelar={fechar}
        onConcluido={(r) => {
          toast(`Estoque atualizado: ${r.itens} itens${r.contas ? ` · ${r.contas} contas a pagar criadas` : ''}`);
          fechar();
          lista.recarregar();
        }}
      />
    );
  }

  return (
    <div className="pagina">
      <Cabecalho titulo="Notas fiscais" sub="Entrada de mercadorias no estoque" />

      <div className="grade-acoes">
        <button className="btn primario grande" onClick={() => setEtapa('scanner')}>📷 Escanear nota ou cupom</button>
        <div className="linha-botoes">
          <button className="btn" onClick={() => inputXml.current.click()}>📄 Importar XML</button>
          <button className="btn" onClick={lancarManual}>✍️ Lançar à mão</button>
        </div>
        <input ref={inputXml} type="file" accept=".xml,text/xml,application/xml" hidden onChange={importarXml} />
      </div>

      {erro && etapa !== 'chave' && <Erro texto={erro} />}
      {etapa === 'carregando' && <Carregando texto={msgCarregando} />}

      <section className="secao">
        <h3>Notas lançadas</h3>
        {lista.carregando && !lista.dados && <Carregando />}
        {lista.erro && <Erro texto={lista.erro} onTentar={lista.recarregar} />}
        {lista.dados?.length === 0 && (
          <Vazio icone="🧾" titulo="Nenhuma nota lançada" texto="Escaneie o QR Code do cupom fiscal ou importe o XML da NF-e que o fornecedor envia por e-mail." />
        )}
        <ul className="lista">
          {lista.dados?.map((n) => (
            <li key={n.id} className="item" onClick={() => setDetalhe(n.id)}>
              <div className="item-principal">
                <strong>{n.fornecedor_nome || 'Fornecedor não informado'}</strong>
                <span className="texto-suave">{n.modelo === '65' ? 'NFC-e' : n.modelo === '55' ? 'NF-e' : 'Nota'} {n.numero ? `nº ${n.numero}` : ''} · {dataBr(n.data_emissao)} · {n.itens} itens</span>
              </div>
              <div className="item-lado"><strong>{brl(n.valor_total)}</strong></div>
            </li>
          ))}
        </ul>
      </section>

      {etapa === 'scanner' && (
        <Suspense fallback={<div className="scanner" />}><Scanner
          modo="nota"
          titulo="Escanear nota fiscal"
          validar={(t) => (/^https?:\/\//i.test(t) || t.includes('|') || chaveValida(t)) || 'Código lido não é de nota fiscal. Continue tentando…'}
          onLido={processarCodigo}
          onFechar={() => setEtapa(null)}
          onDigitar={() => setEtapa('digitar')}
        /></Suspense>
      )}

      {etapa === 'digitar' && <DigitarChave onFechar={() => setEtapa(null)} onOk={processarCodigo} />}

      {etapa === 'chave' && identificado && (
        <Folha titulo={identificado.info?.tipo || 'Nota fiscal'} onFechar={() => { setEtapa(null); setErro(null); }}>
          {identificado.info && (
            <dl className="dados">
              <dt>CNPJ do emitente</dt><dd>{cnpjFmt(identificado.info.cnpjEmitente)}</dd>
              <dt>Número / série</dt><dd>{identificado.info.numero} / {identificado.info.serie}</dd>
              <dt>Emissão</dt><dd>{identificado.info.anoMes.split('-').reverse().join('/')} · {identificado.info.uf}</dd>
            </dl>
          )}
          {erro && <div className="alerta aviso">{erro}</div>}
          {!identificado.jaImportada && (
            <>
              {identificado.tipo === 'chave' && (
                <p className="texto-suave">
                  O código de barras do DANFE só traz a chave da nota. Para puxar os itens automaticamente,
                  importe o <b>arquivo XML</b> (o fornecedor envia por e-mail) ou lance os itens à mão.
                </p>
              )}
              <div className="grade-acoes">
                <button className="btn primario" onClick={() => inputXml.current.click()}>📄 Importar XML desta nota</button>
                <button className="btn" onClick={lancarManual}>✍️ Lançar itens à mão</button>
                {identificado.tipo === 'qrcode-nfce' && (
                  <button className="btn" onClick={() => processarCodigo(identificado.url)}>🔄 Consultar SEFAZ de novo</button>
                )}
              </div>
            </>
          )}
        </Folha>
      )}

      {detalhe && <DetalheNota id={detalhe} onFechar={() => setDetalhe(null)} onExcluida={() => { setDetalhe(null); lista.recarregar(); toast('Nota excluída e estoque estornado'); }} />}
    </div>
  );
}

function DigitarChave({ onFechar, onOk }) {
  const [v, setV] = useState('');
  const d = v.replace(/\D/g, '');
  const ok = /^https?:\/\//i.test(v.trim()) || chaveValida(d);
  return (
    <Folha titulo="Digitar chave de acesso" onFechar={onFechar}
      rodape={<button className="btn primario grande" disabled={!ok} onClick={() => onOk(v.trim())}>Continuar</button>}>
      <label className="campo">
        <span>Chave de acesso (44 números) ou link do QR Code</span>
        <textarea rows={3} value={v} onChange={(e) => setV(e.target.value)} inputMode="numeric" placeholder="3526 1112 3456 7800 0199 5500 1000 0012 3410 0001 2345" />
      </label>
      <p className="texto-suave">{d.length}/44 dígitos {d.length === 44 && !chaveValida(d) && <span className="texto-vermelho">· chave inválida, confira os números</span>}</p>
    </Folha>
  );
}

function RevisaoNota({ nota, origem, onCancelar, onConcluido }) {
  const produtos = useCarregar(() => api('/produtos'));
  const [itens, setItens] = useState(() => nota.itens.map((it, i) => ({ ...it, _k: i, novoNome: it.descricao, novaUnidade: it.unidade })));
  const [cab, setCab] = useState({ fornecedor: nota.emitente?.nome || '', numero: nota.numero || '', data: nota.dataEmissao || '' });
  const [dups, setDups] = useState(() => (nota.duplicatas || []).map((d) => ({ ...d, marcar: !d.jaCadastrada })));
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState(null);

  const alterar = (k, campos) => setItens((l) => l.map((it) => (it._k === k ? { ...it, ...campos } : it)));
  const adicionar = () => setItens((l) => [...l, {
    _k: Date.now(), nItem: l.length + 1, codigo: '', descricao: '', novoNome: '', unidade: 'UN', novaUnidade: 'UN',
    quantidade: 1, valorUnitario: 0, valorTotal: 0, produtoId: null, fator: 1, manual: true,
  }]);

  const ativos = itens.filter((i) => !i.ignorar);
  const total = ativos.reduce((s, i) => s + Number(i.valorTotal || 0), 0);

  const confirmar = async () => {
    setErro(null);
    for (const it of ativos) {
      if (!it.produtoId && !String(it.novoNome || it.descricao).trim()) return setErro('Dê um nome para todos os produtos novos.');
      if (!(Number(it.quantidade) > 0)) return setErro(`Quantidade inválida em "${it.descricao || it.novoNome}".`);
    }
    setSalvando(true);
    try {
      const r = await api('/notas/confirmar', {
        method: 'POST',
        body: {
          origem,
          nota: { ...nota, numero: cab.numero, dataEmissao: cab.data, valorTotal: nota.valorTotal || total, emitente: { ...nota.emitente, nome: cab.fornecedor } },
          itens: itens.map((it) => ({ ...it, descricao: it.descricao || it.novoNome })),
          duplicatas: dups.filter((d) => d.marcar),
        },
      });
      onConcluido(r);
    } catch (e) {
      setErro(e.message);
      setSalvando(false);
    }
  };

  return (
    <div className="pagina com-rodape">
      <Cabecalho titulo="Conferir entrada" sub={origem === 'manual' ? 'Lançamento manual' : `${nota.modelo === '65' ? 'NFC-e' : 'NF-e'} · ${itens.length} itens`}
        acao={<button className="btn-link" onClick={onCancelar}>Cancelar</button>} />

      <div className="cartao">
        <label className="campo"><span>Fornecedor</span>
          <input value={cab.fornecedor} onChange={(e) => setCab({ ...cab, fornecedor: e.target.value })} placeholder="Nome do fornecedor" />
        </label>
        <div className="linha-campos">
          <label className="campo"><span>Nº da nota</span><input value={cab.numero} onChange={(e) => setCab({ ...cab, numero: e.target.value })} inputMode="numeric" /></label>
          <label className="campo"><span>Emissão</span><input type="date" value={cab.data} onChange={(e) => setCab({ ...cab, data: e.target.value })} /></label>
        </div>
        {nota.emitente?.cnpj && <p className="texto-suave">CNPJ {cnpjFmt(nota.emitente.cnpj)}</p>}
      </div>

      <p className="dica">Para cada item, escolha o produto do seu estoque. Na próxima nota desse fornecedor o app já lembra a escolha.</p>

      {itens.map((it) => (
        <ItemRevisao key={it._k} it={it} produtos={produtos.dados || []} onAlterar={(c) => alterar(it._k, c)} />
      ))}

      <button className="btn tracejado" onClick={adicionar}>＋ Adicionar item</button>

      {dups.length > 0 && (
        <section className="secao">
          <h3>Parcelas desta nota (duplicatas)</h3>
          <div className="cartao">
            {dups.map((d, i) => (
              <label key={i} className="check">
                <input type="checkbox" checked={d.marcar} disabled={d.jaCadastrada}
                  onChange={(e) => setDups((l) => l.map((x, j) => (j === i ? { ...x, marcar: e.target.checked } : x)))} />
                <span>Parcela {d.numero} · vence {dataBr(d.vencimento)} · <b>{brl(d.valor)}</b>{d.jaCadastrada && ' (já cadastrada)'}</span>
              </label>
            ))}
            <p className="texto-suave">As parcelas marcadas entram em <b>Contas a pagar</b> e geram aviso no WhatsApp no vencimento.</p>
          </div>
        </section>
      )}

      {erro && <Erro texto={erro} />}

      <div className="rodape-fixo">
        <div><small>{ativos.length} itens</small><strong>{brl(nota.valorTotal || total)}</strong></div>
        <button className="btn primario" disabled={salvando || (!ativos.length && !dups.some((d) => d.marcar))} onClick={confirmar}>
          {salvando ? 'Salvando…' : 'Dar entrada no estoque'}
        </button>
      </div>
    </div>
  );
}

function ItemRevisao({ it, produtos, onAlterar }) {
  const prod = produtos.find((p) => p.id === it.produtoId);
  const unidadeEstoque = prod?.unidade || it.novaUnidade || it.unidade;
  const qtdFinal = Number(it.quantidade || 0) * Number(it.fator || 1);

  return (
    <div className={`cartao item-nota ${it.ignorar ? 'ignorado' : ''}`}>
      <div className="item-nota-topo">
        {it.manual ? (
          <input className="input-titulo" value={it.descricao} placeholder="Descrição do item"
            onChange={(e) => onAlterar({ descricao: e.target.value, novoNome: e.target.value })} />
        ) : (
          <strong>{it.descricao}</strong>
        )}
        <label className="chave-ignorar">
          <input type="checkbox" checked={!it.ignorar} onChange={(e) => onAlterar({ ignorar: !e.target.checked })} />
          <span>{it.ignorar ? 'Ignorado' : 'Lançar'}</span>
        </label>
      </div>

      {it.manual ? (
        <div className="linha-campos tres">
          <label className="campo"><span>Qtd.</span><input type="number" inputMode="decimal" value={it.quantidade}
            onChange={(e) => onAlterar({ quantidade: e.target.value })} /></label>
          <label className="campo"><span>Unid.</span><input value={it.unidade}
            onChange={(e) => onAlterar({ unidade: e.target.value.toUpperCase(), novaUnidade: e.target.value.toUpperCase() })} /></label>
          <label className="campo"><span>Valor total</span><input type="number" inputMode="decimal" value={it.valorTotal}
            onChange={(e) => onAlterar({ valorTotal: e.target.value })} /></label>
        </div>
      ) : (
        <p className="texto-suave">
          {num(it.quantidade)} {it.unidade} × {brl(it.valorUnitario)} = <b>{brl(it.valorTotal)}</b>
          {it.codigo && <> · cód. {it.codigo}</>}
        </p>
      )}

      {!it.ignorar && (
        <>
          <label className="campo">
            <span>Produto no estoque {it.sugestao && <em className="selo">{it.sugestao === 'vinculo' ? 'lembrado' : 'pelo código EAN'}</em>}</span>
            <select value={it.produtoId || ''} onChange={(e) => {
              const id = Number(e.target.value) || null;
              const p = produtos.find((x) => x.id === id);
              onAlterar({ produtoId: id, sugestao: null, fator: p && p.unidade === it.unidade ? 1 : it.fator });
            }}>
              <option value="">＋ Criar produto novo</option>
              {produtos.map((p) => <option key={p.id} value={p.id}>{p.nome} ({p.unidade})</option>)}
            </select>
          </label>
          {!it.produtoId && (
            <div className="linha-campos">
              <label className="campo largo"><span>Nome do produto novo</span>
                <input value={it.novoNome} onChange={(e) => onAlterar({ novoNome: e.target.value })} /></label>
              <label className="campo"><span>Unidade</span>
                <input value={it.novaUnidade} onChange={(e) => onAlterar({ novaUnidade: e.target.value.toUpperCase() })} /></label>
            </div>
          )}
          <div className="conversao">
            <span>1 {it.unidade || 'UN'} =</span>
            <input type="number" inputMode="decimal" min="0" step="any" value={it.fator}
              onChange={(e) => onAlterar({ fator: e.target.value })} />
            <span>{unidadeEstoque}</span>
            <span className="conversao-resultado">→ entra <b>{num(qtdFinal)} {unidadeEstoque}</b></span>
          </div>
        </>
      )}
    </div>
  );
}

function DetalheNota({ id, onFechar, onExcluida }) {
  const { dados: n, erro, carregando } = useCarregar(() => api(`/notas/${id}`), [id]);
  const [confirmando, setConfirmando] = useState(false);

  const excluir = async () => {
    await api(`/notas/${id}`, { method: 'DELETE' });
    onExcluida();
  };

  return (
    <Folha titulo={n ? `${n.fornecedor_nome || 'Nota'}` : 'Nota'} onFechar={onFechar}
      rodape={n && (confirmando ? (
        <div className="linha-botoes">
          <button className="btn" onClick={() => setConfirmando(false)}>Voltar</button>
          <button className="btn perigo" onClick={excluir}>Confirmar exclusão</button>
        </div>
      ) : <button className="btn perigo-claro" onClick={() => setConfirmando(true)}>Excluir nota e estornar estoque</button>)}>
      {carregando && <Carregando />}
      {erro && <Erro texto={erro} />}
      {n && (
        <>
          <dl className="dados">
            <dt>Número</dt><dd>{n.numero || '—'} {n.serie && `(série ${n.serie})`}</dd>
            <dt>Emissão</dt><dd>{dataBr(n.data_emissao)}</dd>
            <dt>CNPJ</dt><dd>{cnpjFmt(n.fornecedor_cnpj) || '—'}</dd>
            <dt>Valor</dt><dd>{brl(n.valor_total)}</dd>
            <dt>Origem</dt><dd>{{ qrcode: 'QR Code (SEFAZ)', xml: 'Arquivo XML', manual: 'Manual' }[n.origem] || n.origem}</dd>
          </dl>
          <h4>Itens lançados</h4>
          <ul className="lista compacta">
            {n.movimentos.map((m) => (
              <li key={m.id} className="item">
                <div className="item-principal"><strong>{m.nome}</strong></div>
                <div className="item-lado">+{num(m.quantidade)} {m.unidade}</div>
              </li>
            ))}
          </ul>
          {n.contas.length > 0 && (
            <>
              <h4>Contas a pagar geradas</h4>
              <ul className="lista compacta">
                {n.contas.map((c) => (
                  <li key={c.id} className="item">
                    <div className="item-principal"><strong>{c.descricao}</strong><span className="texto-suave">vence {dataBr(c.vencimento)}</span></div>
                    <div className="item-lado">{brl(c.valor)}</div>
                  </li>
                ))}
              </ul>
            </>
          )}
          {n.chave && <p className="chave-acesso">{n.chave.replace(/(\d{4})/g, '$1 ')}</p>}
        </>
      )}
    </Folha>
  );
}
