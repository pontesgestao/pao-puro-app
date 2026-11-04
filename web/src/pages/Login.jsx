import { useState } from 'react';
import { api, setToken } from '../api.js';

export default function Login({ onEntrar }) {
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState(null);
  const [enviando, setEnviando] = useState(false);

  const entrar = async (e) => {
    e.preventDefault();
    setEnviando(true);
    setErro(null);
    try {
      const { token } = await api('/login', { method: 'POST', body: { senha } });
      setToken(token);
      onEntrar();
    } catch (err) {
      setErro(err.message);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="login">
      <img src="/logo.png" alt="Pão Puro – desde 1973 – panificadora" className="login-logo" />
      <form onSubmit={entrar} className="cartao">
        <h2>Gestão da padaria</h2>
        <p className="texto-suave">Estoque por nota fiscal e contas a pagar</p>
        <label className="campo">
          <span>Senha</span>
          <input type="password" value={senha} onChange={(e) => setSenha(e.target.value)} autoFocus autoComplete="current-password" />
        </label>
        {erro && <div className="alerta erro">{erro}</div>}
        <button className="btn primario grande" disabled={enviando || !senha}>{enviando ? 'Entrando…' : 'Entrar'}</button>
      </form>
    </div>
  );
}
