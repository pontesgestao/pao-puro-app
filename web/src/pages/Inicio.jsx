import { api } from '../api.js';
import { brl, dataBr, num, rotuloVencimento, useCarregar, copiar } from '../util.js';
import { Carregando, Erro, useToast } from '../components/ui.jsx';

export default function Inicio({ ir }) {
  const { dados, erro, carregando, recarregar } = useCarregar(() => api('/resumo'));
  const toast = useToast();

  const saudacao = (() => {
    const h = new Date().getHours();
    return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
  })();

  return (
    <div className="pagina">
      <div className="topo-marca">
        <img src="/logo.png" alt="Pão Puro – desde 1973 – panificadora" />
      </div>
      <p className="saudacao">{saudacao}! {dados && <>Hoje é {new Date(dados.hoje + 'T12:00').toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}.</>}</p>

      <div className="acoes-principais">
        <button className="acao-grande" onClick={() => ir('notas', 'escanear')}>
          <span className="acao-icone">🧾</span>
          <strong>Escanear nota</strong>
          <small>Entrada no estoque</small>
        </button>
        <button className="acao-grande vermelho" onClick={() => ir('contas', 'escanear')}>
          <span className="acao-icone">▥</span>
          <strong>Ler boleto</strong>
          <small>Contas a pagar</small>
        </button>
      </div>

      {carregando && !dados && <Carregando />}
      {erro && <Erro texto={erro} onTentar={recarregar} />}

      {dados && (
        <>
          <div className="indicadores">
            <button className={`indicador ${dados.vencemHoje.qtd ? 'destaque' : ''}`} onClick={() => ir('contas')}>
              <small>Vencem hoje</small>
              <strong>{brl(dados.vencemHoje.total)}</strong>
              <span>{dados.vencemHoje.qtd} {dados.vencemHoje.qtd === 1 ? 'boleto' : 'boletos'}</span>
            </button>
            <button className={`indicador ${dados.atrasadas.qtd ? 'alerta-ind' : ''}`} onClick={() => ir('contas')}>
              <small>Em atraso</small>
              <strong>{brl(dados.atrasadas.total)}</strong>
              <span>{dados.atrasadas.qtd} {dados.atrasadas.qtd === 1 ? 'conta' : 'contas'}</span>
            </button>
            <button className="indicador" onClick={() => ir('contas')}>
              <small>Próximos 7 dias</small>
              <strong>{brl(dados.proximos7.total)}</strong>
              <span>{dados.proximos7.qtd} {dados.proximos7.qtd === 1 ? 'conta' : 'contas'}</span>
            </button>
          </div>

          <section className="secao">
            <h3>Para pagar hoje</h3>
            {dados.contasHoje.length === 0 ? (
              <p className="texto-suave cartao">Nenhuma conta vencendo hoje. ✅</p>
            ) : (
              <ul className="lista">
                {dados.contasHoje.map((c) => {
                  const r = rotuloVencimento(c.vencimento);
                  return (
                    <li key={c.id} className="item">
                      <div className="item-principal">
                        <strong>{c.fornecedor || c.descricao}</strong>
                        <span className={`etiqueta ${r.cls}`}>{r.texto}</span>
                      </div>
                      <div className="item-lado">
                        <strong>{brl(c.valor)}</strong>
                        {c.linha_digitavel && (
                          <button className="btn-link" onClick={async () => { await copiar(c.linha_digitavel); toast('Código copiado! Cole no app do banco.'); }}>
                            Copiar código
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {dados.estoqueBaixo.length > 0 && (
            <section className="secao">
              <h3>Estoque baixo</h3>
              <ul className="lista">
                {dados.estoqueBaixo.map((p) => (
                  <li key={p.id} className="item" onClick={() => ir('estoque')}>
                    <div className="item-principal"><strong>{p.nome}</strong><span className="texto-suave">mínimo {num(p.estoque_minimo)} {p.unidade}</span></div>
                    <div className="item-lado"><strong className="texto-vermelho">{num(p.estoque)} {p.unidade}</strong></div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="secao">
            <h3>Últimas notas lançadas</h3>
            {dados.ultimasNotas.length === 0 ? (
              <p className="texto-suave cartao">Nenhuma nota ainda. Toque em <b>Escanear nota</b> para começar.</p>
            ) : (
              <ul className="lista">
                {dados.ultimasNotas.map((n) => (
                  <li key={n.id} className="item" onClick={() => ir('notas')}>
                    <div className="item-principal"><strong>{n.fornecedor_nome || 'Fornecedor'}</strong><span className="texto-suave">Nº {n.numero || '—'} · {dataBr(n.data_emissao)}</span></div>
                    <div className="item-lado"><strong>{brl(n.valor_total)}</strong></div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
