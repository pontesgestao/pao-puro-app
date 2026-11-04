import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const arquivo = resolve(process.env.DB_PATH || './data/paopuro.db');
mkdirSync(dirname(arquivo), { recursive: true });

export const db = new DatabaseSync(arquivo);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS produtos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  unidade TEXT NOT NULL DEFAULT 'UN',
  ean TEXT,
  estoque REAL NOT NULL DEFAULT 0,
  estoque_minimo REAL NOT NULL DEFAULT 0,
  custo_medio REAL NOT NULL DEFAULT 0,
  ultimo_custo REAL NOT NULL DEFAULT 0,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_produtos_ean ON produtos(ean);

-- Liga o código do produto no fornecedor ao produto da padaria (aprendido na 1ª entrada)
CREATE TABLE IF NOT EXISTS produto_vinculos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cnpj_fornecedor TEXT NOT NULL,
  codigo_fornecedor TEXT NOT NULL,
  produto_id INTEGER NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
  fator REAL NOT NULL DEFAULT 1,
  UNIQUE (cnpj_fornecedor, codigo_fornecedor)
);

CREATE TABLE IF NOT EXISTS notas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chave TEXT UNIQUE,
  modelo TEXT,
  numero TEXT,
  serie TEXT,
  data_emissao TEXT,
  fornecedor_cnpj TEXT,
  fornecedor_nome TEXT,
  valor_total REAL,
  origem TEXT,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS movimentos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  produto_id INTEGER NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL CHECK (tipo IN ('entrada','saida','ajuste')),
  quantidade REAL NOT NULL,
  custo_unitario REAL,
  nota_id INTEGER REFERENCES notas(id) ON DELETE SET NULL,
  observacao TEXT,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_mov_produto ON movimentos(produto_id);

CREATE TABLE IF NOT EXISTS contas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  descricao TEXT NOT NULL,
  fornecedor TEXT,
  valor REAL NOT NULL,
  vencimento TEXT NOT NULL,
  linha_digitavel TEXT,
  codigo_barras TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'aberta' CHECK (status IN ('aberta','paga')),
  pago_em TEXT,
  nota_id INTEGER REFERENCES notas(id) ON DELETE SET NULL,
  observacao TEXT,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_contas_venc ON contas(vencimento, status);

CREATE TABLE IF NOT EXISTS config (
  chave TEXT PRIMARY KEY,
  valor TEXT
);

CREATE TABLE IF NOT EXISTS sessoes (
  token TEXT PRIMARY KEY,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS avisos_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  data TEXT NOT NULL,
  telefone TEXT,
  sucesso INTEGER NOT NULL,
  detalhe TEXT,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

const PADROES = {
  whatsapp_numeros: '',
  aviso_horario: '08:00',
  aviso_dia_anterior: '0',
  aviso_atrasadas: '1',
  ultimo_aviso: '',
};

export function getConfig() {
  const out = { ...PADROES };
  for (const r of db.prepare('SELECT chave, valor FROM config').all()) out[r.chave] = r.valor;
  return out;
}

export function setConfig(obj) {
  const st = db.prepare('INSERT INTO config (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor');
  for (const [k, v] of Object.entries(obj)) {
    if (k in PADROES) st.run(k, String(v ?? ''));
  }
}

export function transacao(fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
