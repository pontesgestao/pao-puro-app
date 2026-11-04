import { useEffect, useState } from 'react';
import { getToken } from './api.js';
import Login from './pages/Login.jsx';
import Inicio from './pages/Inicio.jsx';
import Notas from './pages/Notas.jsx';
import Estoque from './pages/Estoque.jsx';
import Contas from './pages/Contas.jsx';
import Ajustes from './pages/Ajustes.jsx';

const ABAS = [
  { id: 'inicio', rotulo: 'Início', icone: IconeCasa },
  { id: 'notas', rotulo: 'Notas', icone: IconeNota },
  { id: 'estoque', rotulo: 'Estoque', icone: IconeCaixa },
  { id: 'contas', rotulo: 'Contas', icone: IconeBoleto },
  { id: 'ajustes', rotulo: 'Ajustes', icone: IconeEngrenagem },
];

const lerHash = () => {
  const [aba, acao] = location.hash.replace(/^#\/?/, '').split('/');
  return { aba: ABAS.some((a) => a.id === aba) ? aba : 'inicio', acao: acao || null };
};

export default function App() {
  const [logado, setLogado] = useState(!!getToken());
  const [rota, setRota] = useState(lerHash);

  useEffect(() => {
    const onHash = () => setRota(lerHash());
    const onSair = () => setLogado(false);
    window.addEventListener('hashchange', onHash);
    window.addEventListener('paopuro:logout', onSair);
    return () => {
      window.removeEventListener('hashchange', onHash);
      window.removeEventListener('paopuro:logout', onSair);
    };
  }, []);

  const ir = (aba, acao) => {
    location.hash = `/${aba}${acao ? '/' + acao : ''}`;
  };
  // Remove a ação do endereço depois de executada, sem empilhar histórico
  const limparAcao = () => {
    history.replaceState(null, '', `#/${rota.aba}`);
    setRota((r) => ({ ...r, acao: null }));
  };

  if (!logado) return <Login onEntrar={() => setLogado(true)} />;

  const props = { ir, acao: rota.acao, limparAcao };
  return (
    <div className="app">
      <main className="conteudo">
        {rota.aba === 'inicio' && <Inicio {...props} />}
        {rota.aba === 'notas' && <Notas {...props} />}
        {rota.aba === 'estoque' && <Estoque {...props} />}
        {rota.aba === 'contas' && <Contas {...props} />}
        {rota.aba === 'ajustes' && <Ajustes {...props} onSair={() => setLogado(false)} />}
      </main>
      <nav className="abas">
        {ABAS.map(({ id, rotulo, icone: Icone }) => (
          <button key={id} className={rota.aba === id ? 'ativa' : ''} onClick={() => ir(id)}>
            <Icone />
            <span>{rotulo}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

const svg = { width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' };
function IconeCasa() {
  return <svg {...svg}><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /><path d="M10 21v-6h4v6" /></svg>;
}
function IconeNota() {
  return <svg {...svg}><path d="M6 2h9l4 4v16l-2.5-1.5L14 22l-2-1.5L10 22l-2.5-1.5L5 22V3a1 1 0 0 1 1-1Z" /><path d="M9 8h6M9 12h6M9 16h4" /></svg>;
}
function IconeCaixa() {
  return <svg {...svg}><path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5v-9Z" /><path d="M3 7.5 12 12l9-4.5M12 12v9" /></svg>;
}
function IconeBoleto() {
  return <svg {...svg}><rect x="2.5" y="5" width="19" height="14" rx="2" /><path d="M6 9v6M8.5 9v6M10.5 9v6M13.5 9v6M15.5 9v6M18 9v6" /></svg>;
}
function IconeEngrenagem() {
  return <svg {...svg}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" /></svg>;
}
