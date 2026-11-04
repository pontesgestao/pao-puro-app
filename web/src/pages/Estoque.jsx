import { useState } from 'react';
import { api } from '../api.js';
import { brl, num, useCarregar } from '../util.js';
import { Cabecalho, Carregando, Erro, Folha, Vazio, useToast } from '../components/ui.jsx';

export default function Estoque() {
  const [busca, setBusca] = useState('');
  const { dados, erro, carregando, recarregar } = useCarregar(() => api(`/produtos?q=${encodeURIComponent(busca)}`), [busca]);
  const [aberto, setAberto] = useState(null);
  const [novo, setNovo] = useState(false);

  const valorTotal = (dados || []).reduce((s, p) => s + Math.max(p.estoque, 0) * p.custo_medio, 0);

  return (
    <div className="pagina">
      <Cabecalho titulo="Estoque" sub={dados ? `${dados.length} produtos · ${brl(valorTotal)} em estoque` : ' '}
        acao={<button className="btn pequeno primario" onClick={() => setNovo(true)}>＋ Produto</button>} />

      <input className="busca" type="search" placeholder="Buscar produto…" value={busca} onChange={(e) => setBusca(e.target.value)} />

      {carregando && !dados && <Carregando />}
      {erro && <Erro texto={erro} onTentar={recarregar} />}
      {dados?.length === 0 && (
        <Vazio icone="📦" titulo={busca ? 'Nada encontrado' : 'Estoque vazio'}
          texto={busca ? 'Tente outro nome.' : 'Os produtos são criados automaticamente quando você lança uma nota fiscal.'} />
      )}

      <ul className="lista">
        {dados?.map((p) => {
          const baixo = p.estoque_minimo > 0 && p.estoque <= p.estoque_minimo;
          return (
            <li key={p.id} className="item" onClick={() => setAberto(p.id)}>
              <div className="item-principal">
                <strong>{p.nome}</strong>
                <span className="texto-suave">{p.custo_medio > 0 ? `custo médio ${brl(p.custo_medio)}/${p.unidade}` : 'sem custo'}</span>
              </div>
              <div className="item-lado">
                <strong className={baixo ? 'texto-vermelho' : ''}>{num(p.estoque)} {p.unidade}</strong>
                {baixo && <span className="etiqueta atrasada">baixo</span>}
              </div>
            </li>
          );
        })}
      </ul>

      {aberto && <DetalheProduto id={aberto} onFechar={() => setAberto(null)} onMudou={recarregar} />}
      {novo && <NovoProduto onFechar={() => setNovo(false)} onSalvo={() => { setNovo(false); recarregar(); }} />}
    </div>
  );
}

function NovoProduto({ onFechar, onSalvo }) {
  const [f, setF] = useState({ nome: '', unidade: 'UN', estoque_minimo: '' });
  const [erro, setErro] = useState(null);
  const salvar = async () => {
    try { await api('/produtos', { method: 'POST', body: f }); onSalvo(); } catch (e) { setErro(e.message); }
  };
  return (
    <Folha titulo="Novo produto" onFechar={onFechar} rodape={<button className="btn primario grande" disabled={!f.nome} onClick={salvar}>Salvar</button>}>
      <label className="campo"><span>Nome</span><input value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} autoFocus /></label>
      <div className="linha-campos">
        <label className="campo"><span>Unidade</span>
          <select value={f.unidade} onChange={(e) => setF({ ...f, unidade: e.target.value })}>
            {['UN', 'KG', 'G', 'L', 'ML', 'CX', 'PCT', 'SC', 'DZ'].map((u) => <option key={u}>{u}</option>)}
          </select>
        </label>
        <label className="campo"><span>Estoque mínimo</span><input type="number" inputMode="decimal" value={f.estoque_minimo} onChange={(e) => setF({ ...f, estoque_minimo: e.target.value })} /></label>
      </div>
      {erro && <Erro texto={erro} />}
    </Folha>
  );
}

function DetalheProduto({ id, onFechar, onMudou }) {
  const { dados: p, erro, carregando, recarregar } = useCarregar(() => api(`/produtos/${id}`), [id]);
  const [mov, setMov] = useState(null); // saida | ajuste | entrada
  const [qtd, setQtd] = useState('');
  const [obs, setObs] = useState('');
  const [editando, setEditando] = useState(null);
  const toast = useToast();

  const registrar = async () => {
    try {
      await api(`/produtos/${id}/movimento`, { method: 'POST', body: { tipo: mov, quantidade: Number(qtd), observacao: obs } });
      toast('Estoque atualizado');
      setMov(null); setQtd(''); setObs('');
      recarregar(); onMudou();
    } catch (e) { toast(e.message, 'erro'); }
  };

  const salvarEdicao = async () => {
    try {
      await api(`/produtos/${id}`, { method: 'PUT', body: editando });
      setEditando(null); recarregar(); onMudou(); toast('Produto salvo');
    } catch (e) { toast(e.message, 'erro'); }
  };

  const rotulos = { entrada: 'Entrada', saida: 'Saída', ajuste: 'Ajuste' };

  return (
    <Folha titulo={p?.nome || 'Produto'} onFechar={onFechar}>
      {carregando && !p && <Carregando />}
      {erro && <Erro texto={erro} />}
      {p && !editando && (
        <>
          <div className="estoque-grande">
            <strong>{num(p.estoque)}</strong><span>{p.unidade} em estoque</span>
          </div>
          <dl className="dados">
            <dt>Custo médio</dt><dd>{brl(p.custo_medio)}/{p.unidade}</dd>
            <dt>Último custo</dt><dd>{brl(p.ultimo_custo)}/{p.unidade}</dd>
            <dt>Estoque mínimo</dt><dd>{p.estoque_minimo ? `${num(p.estoque_minimo)} ${p.unidade}` : '—'}</dd>
          </dl>
          {!mov ? (
            <div className="linha-botoes tres">
              <button className="btn" onClick={() => setMov('saida')}>➖ Saída</button>
              <button className="btn" onClick={() => setMov('ajuste')}>🔢 Contar</button>
              <button className="btn" onClick={() => setEditando({ nome: p.nome, unidade: p.unidade, ean: p.ean || '', estoque_minimo: p.estoque_minimo })}>✏️ Editar</button>
            </div>
          ) : (
            <div className="cartao">
              <label className="campo">
                <span>{mov === 'saida' ? `Quantidade que saiu (${p.unidade})` : `Quantidade contada na prateleira (${p.unidade})`}</span>
                <input type="number" inputMode="decimal" value={qtd} onChange={(e) => setQtd(e.target.value)} autoFocus />
              </label>
              <label className="campo"><span>Observação (opcional)</span><input value={obs} onChange={(e) => setObs(e.target.value)} placeholder={mov === 'saida' ? 'Ex.: produção do dia' : 'Ex.: inventário mensal'} /></label>
              <div className="linha-botoes">
                <button className="btn" onClick={() => setMov(null)}>Cancelar</button>
                <button className="btn primario" disabled={qtd === ''} onClick={registrar}>Registrar</button>
              </div>
            </div>
          )}
          <h4>Movimentações</h4>
          {p.movimentos.length === 0 && <p className="texto-suave">Nenhuma movimentação.</p>}
          <ul className="lista compacta">
            {p.movimentos.map((m) => (
              <li key={m.id} className="item">
                <div className="item-principal">
                  <strong>{rotulos[m.tipo]}{m.fornecedor_nome ? ` · ${m.fornecedor_nome}` : ''}</strong>
                  <span className="texto-suave">{new Date(m.criado_em + 'Z').toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}{m.observacao ? ` · ${m.observacao}` : ''}</span>
                </div>
                <div className={`item-lado ${m.quantidade < 0 ? 'texto-vermelho' : 'texto-verde'}`}>
                  {m.quantidade > 0 ? '+' : ''}{num(m.quantidade)} {p.unidade}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
      {editando && (
        <div>
          <label className="campo"><span>Nome</span><input value={editando.nome} onChange={(e) => setEditando({ ...editando, nome: e.target.value })} /></label>
          <div className="linha-campos">
            <label className="campo"><span>Unidade</span><input value={editando.unidade} onChange={(e) => setEditando({ ...editando, unidade: e.target.value })} /></label>
            <label className="campo"><span>Estoque mínimo</span><input type="number" inputMode="decimal" value={editando.estoque_minimo} onChange={(e) => setEditando({ ...editando, estoque_minimo: e.target.value })} /></label>
          </div>
          <label className="campo"><span>Código de barras (EAN)</span><input value={editando.ean} inputMode="numeric" onChange={(e) => setEditando({ ...editando, ean: e.target.value })} /></label>
          <div className="linha-botoes">
            <button className="btn" onClick={() => setEditando(null)}>Cancelar</button>
            <button className="btn primario" onClick={salvarEdicao}>Salvar</button>
          </div>
        </div>
      )}
    </Folha>
  );
}
