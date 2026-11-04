const CHAVE_TOKEN = 'paopuro_token';

export const getToken = () => {
  try { return localStorage.getItem(CHAVE_TOKEN); } catch { return null; }
};
export const setToken = (t) => {
  try { t ? localStorage.setItem(CHAVE_TOKEN, t) : localStorage.removeItem(CHAVE_TOKEN); } catch { /* ignore */ }
};

export async function api(caminho, { method = 'GET', body, raw, contentType } = {}) {
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (raw) {
    payload = raw;
    headers['Content-Type'] = contentType || 'application/octet-stream';
  } else if (body !== undefined) {
    payload = JSON.stringify(body);
    headers['Content-Type'] = 'application/json';
  }
  let resp;
  try {
    resp = await fetch(`/api${caminho}`, { method, headers, body: payload });
  } catch {
    throw new Error('Sem conexão com o servidor. Verifique a internet.');
  }
  const dados = await resp.json().catch(() => ({}));
  if (resp.status === 401 && caminho !== '/login') {
    setToken(null);
    window.dispatchEvent(new Event('paopuro:logout'));
  }
  if (!resp.ok) throw new Error(dados.erro || `Erro ${resp.status}`);
  return dados;
}
