import { createContext, useCallback, useContext, useState } from 'react';

const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }) {
  const [msg, setMsg] = useState(null);
  const mostrar = useCallback((texto, tipo = 'ok') => {
    const id = Date.now();
    setMsg({ texto, tipo, id });
    setTimeout(() => setMsg((m) => (m?.id === id ? null : m)), 3200);
  }, []);
  return (
    <ToastCtx.Provider value={mostrar}>
      {children}
      {msg && <div className={`toast ${msg.tipo}`} role="status">{msg.texto}</div>}
    </ToastCtx.Provider>
  );
}

export function Folha({ titulo, onFechar, children, rodape }) {
  return (
    <div className="folha-fundo" onClick={onFechar}>
      <div className="folha" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={titulo}>
        <div className="folha-topo">
          <h2>{titulo}</h2>
          <button className="btn-icone" onClick={onFechar} aria-label="Fechar">✕</button>
        </div>
        <div className="folha-corpo">{children}</div>
        {rodape && <div className="folha-rodape">{rodape}</div>}
      </div>
    </div>
  );
}

export function Cabecalho({ titulo, sub, acao }) {
  return (
    <header className="cabecalho">
      <div>
        <h1>{titulo}</h1>
        {sub && <p>{sub}</p>}
      </div>
      {acao}
    </header>
  );
}

export const Carregando = ({ texto = 'Carregando…' }) => (
  <div className="carregando"><span className="spinner" />{texto}</div>
);

export const Vazio = ({ icone, titulo, texto, children }) => (
  <div className="vazio">
    <div className="vazio-icone">{icone}</div>
    <strong>{titulo}</strong>
    {texto && <p>{texto}</p>}
    {children}
  </div>
);

export const Erro = ({ texto, onTentar }) => (
  <div className="alerta erro">
    {texto}
    {onTentar && <button className="btn-link" onClick={onTentar}>Tentar de novo</button>}
  </div>
);
